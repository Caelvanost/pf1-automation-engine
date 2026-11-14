/** PF1AE attack events — PF1 11.11 native hooks, one local rolling client.
 * An Item subscribes by naming a native postUse Script Call
 * "PF1AE:attack:resolved". No JS hook is installed by character scripts.
 * No rule, automatic damage, hit prediction, or ChatMessage creation here.
 */
const AE_NS = 'pf1-automation-engine';
const AE_SUBSCRIPTION = 'PF1AE:attack:resolved';
const AE_PENDING = new Map();
const AE_QUEUES = new Map();
const AE_BUSY = new Set();
const AE_ROLL_SEEN = new WeakSet();
const AE_MAX_PENDING = 100;
const AE_TTL = 120000;
let aeInstalled = false;
const aeLog = (...parts) => {
  try { if (game.settings.get(AE_NS, 'genericDebug')) console.debug('[PF1AE][AttackEvents]', ...parts); }
  catch (_) { /* during init */ }
};
const aeEnabled = () => game.modules.get(AE_NS)?.active &&
  game.settings.get(AE_NS, 'genericEnabled');
const aeItems = actor => actor?.items?.values?.() ?? [];
const aeCalls = item => item?.scriptCalls?.contents ??
  (typeof item?.scriptCalls?.values === 'function' ? [...item.scriptCalls.values()] :
  (Array.isArray(item?.scriptCalls) ? item.scriptCalls : item?.system?.scriptCalls ?? []));
const aeActorOwner = actor => game.user?.isGM ||
  actor?.testUserPermission?.(game.user, 'OWNER') === true;
const aeSource = action => {
  const item = action?.item ?? action?.parent;
  const actor = action?.actor ?? item?.actor;
  if (item?.documentName !== 'Item' || actor?.documentName !== 'Actor' || !item.uuid || !actor.uuid)
    return null;
  return {item, actor, actionId:action.id ?? action._id ?? null};
};
const aeKey = source => `${source.actor.uuid}|${source.item.uuid}|${source.actionId}`;
const aeSubscribers = actor => {
  const found = [];
  for (const item of aeItems(actor)) {
    const matches = [...aeCalls(item)].filter(c => c?.category === 'postUse' && c?.name === AE_SUBSCRIPTION);
    if (matches.length > 1) {
      console.warn('[PF1AE][AttackEvents] Duplicate subscription on Item; skipped', item.uuid);
      continue;
    }
    if (matches.length === 1 && typeof matches[0].execute === 'function') found.push({item,call:matches[0]});
  }
  return found;
};
const aeToken = value => {
  const candidate = value?.document ?? value;
  if (!candidate || typeof candidate.uuid !== 'string' ||
      (candidate.documentName !== 'Token' && candidate.documentName !== 'TokenDocument')) return null;
  return {tokenUuid:candidate.uuid, actorUuid:candidate.actor?.uuid ?? null};
};
const aeTargets = (context, actionUse) => {
  const fromContext = context?.targets ?? context?.targetTokens ?? [];
  const fromUse = actionUse?.shared?.targets ?? actionUse?.targets ?? [];
  const asList = value => Array.isArray(value) ? value :
    (value instanceof Set ? [...value] : []);
  const contextList=asList(fromContext);
  const list = contextList.length ? contextList : asList(fromUse);
  const result = [];
  for (const value of list) {
    const t = aeToken(value);
    if (t && !result.some(v => v.tokenUuid === t.tokenUuid)) result.push(t);
  }
  return result;
};
function aePrune() {
  const now = Date.now();
  for (const [key,entry] of AE_PENDING) {
    if (now-entry.createdAt > AE_TTL) AE_PENDING.delete(key);
  }
}
/** PF1 hook: post-roll, NOT hit confirmation. Local rolling-client hook. */
function aeOnAttackRoll(action,roll,context={}) {
  if (!aeEnabled() || !roll || typeof roll !== 'object' || AE_ROLL_SEEN.has(roll)) return;
  const source = aeSource(action);
  if (!source || !source.actionId || !aeActorOwner(source.actor) || AE_BUSY.has(source.actor.uuid)) return;
  if (!aeSubscribers(source.actor).length) return;
  AE_ROLL_SEEN.add(roll);
  aePrune();
  const key = aeKey(source);
  let entry = AE_PENDING.get(key);
  if (!entry) {
    entry = {source,rolls:[],createdAt:Date.now()};
    AE_PENDING.set(key,entry);
  }
  if (entry.rolls.length >= AE_MAX_PENDING) {
    console.warn('[PF1AE][AttackEvents] Too many pending attacks; discarded', key);
    AE_PENDING.delete(key);return;
  }
  const total = Number(roll.total);
  entry.rolls.push({rollId:typeof roll.id === 'string' ? roll.id : null,
    total:Number.isFinite(total) ? total : null,
    formula:typeof roll.formula === 'string' ? roll.formula.slice(0,500) : null,
    nativeRoll:roll,
    natural:game.modules.get(AE_NS)?.api?.attackResolution?.getNaturalD20?.(roll)??null,
    explicitIndex:Number.isSafeInteger(context?.attackIndex) && context.attackIndex >= 0 ? context.attackIndex : null,
    contextTargets:aeTargets(context,null)});
  aeLog('Attack roll evaluated', {actorUuid:source.actor.uuid, itemUuid:source.item.uuid,
    actionId:source.actionId,rollCount:entry.rolls.length});
}
async function aeDeliver(source,results,actionUse,message) {
  const subs = aeSubscribers(source.actor);
  const msg = message?.documentName === 'ChatMessage' ? message : null;
  const targets = aeTargets(null,actionUse);
  const attackerTokens = source.actor.getActiveTokens?.() ?? [];
  const attackerToken = attackerTokens.length === 1 ? aeToken(attackerTokens[0])?.tokenUuid ?? null : null;
  const resolutionApi=game.modules.get(AE_NS)?.api?.attackResolution;
  const action=actionUse?.action??actionUse?.shared?.action;
  const nativeChatAttacks=actionUse?.shared?.chatAttacks;
  const nativeIndicesKnown=Array.isArray(nativeChatAttacks)&&
    nativeChatAttacks.length===results.length;
  for (let i=0;i<results.length;i++) {
    const result=results[i];
    const resultTargets=result.contextTargets.length?result.contextTargets:targets;
    const attackIndex=result.explicitIndex??(nativeIndicesKnown?i:null);
    const paired=[];
    for(const target of resultTargets){
      let token=null,actor=null;
      try{
       token=typeof fromUuid==='function'?await fromUuid(target.tokenUuid):null;
       actor=token?.actor??null;
      }catch(error){aeLog('Target resolution failed',{tokenUuid:target.tokenUuid,error:String(error)});}
      // PF1's generic roll hook is not sufficient proof of mapping one
      // attack to several targets: refuse to reuse an ambiguous roll.
      if(resultTargets.length!==1){
        paired.push({targetTokenUuid:target.tokenUuid,targetActorUuid:actor?.uuid??target.actorUuid,
          resolution:'indeterminate',hit:null,reason:'multiple targets without verified per-target roll mapping',
          attackIndex,defense:null,roll:{natural:result.natural,total:result.total}});
        continue;
      }
      if(!resolutionApi?.resolveAttack)continue;
      try{
        paired.push(await resolutionApi.resolveAttack({
          actor:source.actor,item:source.item,action,actionUse,roll:result.nativeRoll,
          natural:result.natural,total:result.total,attackerToken,
          targetToken:token,targetActor:actor,attackIndex,
          sourceMessageId:msg?.id??null,
          // Never silently assert concealment was checked.
          // Visibility/concealment is separate from the AC comparison.
        }));
      }catch(error){
        paired.push({targetTokenUuid:target.tokenUuid,targetActorUuid:actor?.uuid??target.actorUuid,
          resolution:'indeterminate',hit:null,reason:'resolution error: '+String(error?.message??error),
          attackIndex,defense:null});
      }
    }
    const single=paired.length===1?paired[0]:null;
    const event=Object.freeze({
      type:'attack:resolved',actorUuid:source.actor.uuid,itemUuid:source.item.uuid,
      actionId:source.actionId,attackerTokenUuid:attackerToken,
      sourceMessageId:msg?.id??null,
      rollIndex:i,attackIndex,
      roll:{id:result.rollId,total:result.total,formula:result.formula,natural:result.natural},
      defense:single?.defense??null,
      hit:single?.hit??null,
      resolution:single?.resolution??'indeterminate',
      targetActorUuid:single?.targetActorUuid??null,
      targetTokenUuid:single?.targetTokenUuid??null,
      targetResults:paired,
      targets:resultTargets,isAutoTriggered:false
    });
    Hooks.callAll?.('pf1aeAttackResolution',event);
    for (const {item,call} of subs) {
      // The rolling client handles its own hook; when a GM handles an Actor
      // owned by any player, never execute unapproved player-editable code
      // with GM privileges (online and offline cases alike).
      if (!aeActorOwner(source.actor)) break;
      if(game.user.isGM&&[...game.users].some(u=>!u.isGM&&
         source.actor.testUserPermission?.(u,'OWNER')===true)){
        const approval=game.modules.get(AE_NS)?.api?.scriptApprovals?.check?.(source.actor,item,call)
          ??{approved:false,reason:'Script approval service unavailable'};
        if(!approval.approved){
          console.warn('[PF1AE][AttackEvents] GM Script Call refused',
            {actorUuid:source.actor.uuid,itemUuid:item.uuid,
              scriptId:call.id??call._id,reason:approval.reason});
          continue;
        }
      }
      try {
        await call.execute({action:null},{event,api:game.modules.get(AE_NS).api.attackEvents});
        aeLog('Item subscriber executed', {itemUuid:item.uuid, rollIndex:i, callId:call.id});
      } catch(error) {
        console.error('[PF1AE][AttackEvents] Subscriber error', item.uuid, error);
      }
    }
  }
}
/** PF1 hook: fires after native action use and chat card publication. */
function aeOnPostActionUse(actionUse,message) {
  if (!aeEnabled()) return;
  const action = actionUse?.action ?? actionUse?.shared?.action;
  const source = aeSource(action);
  if (!source || !aeActorOwner(source.actor) || AE_BUSY.has(source.actor.uuid)) return;
  const key = aeKey(source);
  const entry = AE_PENDING.get(key);
  if (!entry) return;
  AE_PENDING.delete(key);
  const previous = AE_QUEUES.get(source.actor.uuid) ?? Promise.resolve();
  const next = previous.catch(()=>{}).then(async()=>{
    if (AE_BUSY.has(source.actor.uuid)) return;
    AE_BUSY.add(source.actor.uuid);
    try { await aeDeliver(source,entry.rolls,actionUse,message); }
    finally { AE_BUSY.delete(source.actor.uuid); }
  });
  AE_QUEUES.set(source.actor.uuid,next);
  void next.catch(error=>console.error('[PF1AE][AttackEvents] Dispatch error',error));
}
function aeInstall() {
  if (aeInstalled) return;
  aeInstalled=true;
  Hooks.on('pf1AttackRoll',aeOnAttackRoll);
  Hooks.on('pf1PostActionUse',aeOnPostActionUse);
  aeLog('Native attack hooks installed');
}
Hooks.once('init',aeInstall);
Hooks.once('ready',()=>{
  const mod=game.modules.get(AE_NS);
  if(!mod)return;
  mod.api ??= {};
  mod.api.attackEvents=Object.freeze({
    subscriptionName:AE_SUBSCRIPTION,
    listSubscriptions:actor => aeSubscribers(actor).map(x=>({itemUuid:x.item.uuid,scriptId:x.call.id??x.call._id??null})),
  });
  aeLog('Ready: declarative attack subscriptions enabled');
});
