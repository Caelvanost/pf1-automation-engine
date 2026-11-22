/**
 * PF1AE — generic persistent conditional defenses (PF1e 11.11).
 * Only data-driven, source-bound modifiers; no class/feat logic and no
 * mutation of native AC or saving throws.
 *
 * Storage: native Foundry Item flags on the defender's own source Item.
 * Native Document permissions and server-side validation authorize writes;
 * no unauthenticated custom socket or world-setting mutation is required.
 */
const DM_NS='pf1-automation-engine';
const DM_FLAG='defenseModifiers';
const DM_RECEIPTS='defenseModifierExpiryReceipts';
const DM_REST_CONTEXTS=new Map();
const DM_TYPES=new Set(['deflection','cover','dodge','circumstance',
 'competence','enhancement','insight','luck','morale','natural',
 'profane','racial','resistance','sacred','shield','size','untyped']);
const DM_DEFENSES=new Set(['normal','touch','flatFooted','ref']);
const DM_STACKING=new Set(['dodge','circumstance','untyped']);
const DM_QUEUES=new Map();
let DM_LAST=null;
const dmClone=x=>foundry.utils.deepClone(x);
const dmKey=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(x);
const dmUuid=x=>typeof x==='string'&&x.length<=350&&
 /^(Actor\.[^.]+|Scene\.[^.]+\.Token\.[^.]+\.Actor\.[^.]+)(?:\..+)?$/.test(x);
const dmEnabled=()=>game.modules.get(DM_NS)?.active===true&&
 game.settings.get(DM_NS,'genericEnabled')===true;
const dmIdentity=d=>JSON.stringify([d.defenderUuid,d.sourceItemUuid,d.key]);
const dmFrom=(uuid)=>{
 try{return typeof fromUuidSync==='function'?fromUuidSync(uuid):null}
 catch(_){return null}
};
const dmSourceActor=(doc)=>doc?.documentName==='Actor'?doc:
 doc?.actor?.documentName==='Actor'?doc.actor:null;
const dmActor=(uuid)=>dmSourceActor(dmFrom(uuid));
const dmItems=(actor)=>[...(actor?.items?.contents??actor?.items?.values?.()??[])];
function dmValidate(data){
 return !!data&&typeof data==='object'&&!Array.isArray(data)&&
  Object.keys(data).every(k=>[
   'key','sourceItemUuid','defenderUuid','attackerUuid',
   'bonusType','value','defenses','reason','expiresOnDeathOf'].includes(k))&&
  dmKey(data.key)&&dmUuid(data.sourceItemUuid)&&dmUuid(data.defenderUuid)&&
  (data.attackerUuid==null||dmUuid(data.attackerUuid))&&
  (data.expiresOnDeathOf==null||dmUuid(data.expiresOnDeathOf))&&
  DM_TYPES.has(data.bonusType)&&Number.isSafeInteger(data.value)&&
  data.value>=-100&&data.value<=100&&
  Array.isArray(data.defenses)&&data.defenses.length>0&&data.defenses.length<=4&&
  data.defenses.every(x=>DM_DEFENSES.has(x))&&
  (data.reason==null||(typeof data.reason==='string'&&data.reason.length<=180));
}
function dmQueue(id,work){
 const before=DM_QUEUES.get(id)??Promise.resolve();
 const next=before.catch(()=>{}).then(work);
 DM_QUEUES.set(id,next);
 next.finally(()=>{if(DM_QUEUES.get(id)===next)DM_QUEUES.delete(id)})
  .catch(()=>{});
 return next;
}
async function dmOwnSource(data){
 if(!dmEnabled())throw Error('Defense service disabled');
 if(!dmValidate(data))throw Error('Invalid declarative defense modifier');
 const item=await fromUuid(data.sourceItemUuid);
 if(item?.documentName!=='Item'||item.actor?.uuid!==data.defenderUuid)
  throw Error('Source Item must belong to the defender Actor');
 if(!game.user?.isGM&&item.actor.testUserPermission?.(game.user,'OWNER')!==true)
  throw Error('Actor owner or GM required');
 if(typeof item.setFlag!=='function'||typeof item.getFlag!=='function')
  throw Error('Native Item flag persistence unavailable');
 return item;
}
async function dmRegister(data){
 const item=await dmOwnSource(data);
 const clean=dmClone(data);
 return dmQueue(item.uuid,async()=>{
  // Storage is authoritative on the Item. A second invocation of the same
  // stable source key replaces the record; never stacks duplicate copies.
  const records=item.getFlag(DM_NS,DM_FLAG)??[];
  if(!Array.isArray(records))throw Error('Invalid existing Item defense flags');
  const next=records.filter(x=>x.key!==clean.key);
  if(next.length>=100)throw Error('Too many modifiers on source Item');
  next.push(clean);
  await item.setFlag(DM_NS,DM_FLAG,next);
  return {id:dmIdentity(clean),record:dmClone(clean)};
 });
}
/**
 * Expiry receipts are stored alongside the removed records on the source
 * Item. The elected GM can recover pending notifications after F5 or when
 * the player's owning client performed the native write.
 * No executable source is sent over a custom socket.
 */
function dmReceipt(record,reason,expiredActorUuid=null,provenance='verified'){
 const eventId='dm:'+Date.now().toString(36)+':'+
  (foundry.utils?.randomID?.(16)??Math.random().toString(36).slice(2,18));
 return {
  eventId,type:'defenseModifierExpired',
  modifierKey:record.key,
  sourceItemUuid:record.sourceItemUuid,
  defenderUuid:record.defenderUuid,
  attackerUuid:record.attackerUuid??null,
  bonusType:record.bonusType,value:record.value,
  reason,reasonProvenance:provenance,
  expiredActorUuid:reason==='death'?expiredActorUuid:null,
  modifier:dmClone(record),delivery:'pending'
 };
}
function dmRestKey(actorUuid,itemUuid){return JSON.stringify([actorUuid,itemUuid]);}
async function dmWithVerifiedRest({actorUuid,itemUuid,restId},fn){
 if(!dmUuid(actorUuid)||!dmUuid(itemUuid)||
    typeof restId!=='string'||!restId||typeof fn!=='function')
  throw Error('Invalid verified native rest context');
 const key=dmRestKey(actorUuid,itemUuid);
 const previous=DM_REST_CONTEXTS.get(key);
 DM_REST_CONTEXTS.set(key,restId);
 try{return await fn()}
 finally{
  if(previous==null)DM_REST_CONTEXTS.delete(key);
  else DM_REST_CONTEXTS.set(key,previous);
 }
}
function dmReason(item,requested,restId){
 if(requested==null||requested==='manual'){
  const context=DM_REST_CONTEXTS.get(dmRestKey(item.actor.uuid,item.uuid));
  if(context&&(!restId||restId===context))
   return {reason:'rest',provenance:'verified-native-rest'};
  return {reason:'manual',provenance:'explicit-removal'};
 }
 if(requested==='rest'){
  const context=DM_REST_CONTEXTS.get(dmRestKey(item.actor.uuid,item.uuid));
  return context&&context===restId?
   {reason:'rest',provenance:'verified-native-rest'}:
   {reason:'other',provenance:'unverified-rest-declaration'};
 }
 // Death cannot be asserted by a caller. It is reserved for the confirmed
 // native condition path below.
 if(requested==='death')return {reason:'other',provenance:'unverified-death-declaration'};
 return {reason:'other',provenance:'unclassified'};
}
async function dmCommitRemoval(item,removed,next,reason,expiredActorUuid=null,provenance='verified'){
 if(!removed.length)return [];
 const oldReceipts=item.getFlag(DM_NS,DM_RECEIPTS)??[];
 if(!Array.isArray(oldReceipts))throw Error('Invalid defense expiration receipts');
 const events=removed.map(r=>dmReceipt(r,reason,expiredActorUuid,provenance));
 // Bound retained receipts: keep pending receipts and the newest delivered
 // events. A pending backlog must be resolved instead of silently truncated.
 const completed=oldReceipts.filter(e=>e.delivery!=='pending').slice(-150);
 const pending=oldReceipts.filter(e=>e.delivery==='pending');
 const receipts=[...completed,...pending,...events];
 // One native update commits the deleted record and the durable
 // notification together. Legacy mocks lacking update() retain sequential
 // writes with receipts added only after successful deletion.
 if(typeof item.update==='function'){
  await item.update({
   [`flags.${DM_NS}.${DM_FLAG}`]:next,
   [`flags.${DM_NS}.${DM_RECEIPTS}`]:receipts
  });
 }else{
  await item.setFlag(DM_NS,DM_FLAG,next);
  await item.setFlag(DM_NS,DM_RECEIPTS,receipts);
 }
 return events;
}
async function dmRemove({key,sourceItemUuid,defenderUuid,reason,restId}={}){
 if(!dmKey(key)||!dmUuid(sourceItemUuid)||!dmUuid(defenderUuid))
  throw Error('Invalid modifier identity');
 const item=await fromUuid(sourceItemUuid);
 if(item?.documentName!=='Item'||item.actor?.uuid!==defenderUuid)
  throw Error('Source Item/defender mismatch');
 if(!game.user?.isGM&&item.actor.testUserPermission?.(game.user,'OWNER')!==true)
  throw Error('Actor owner or GM required');
 return dmQueue(item.uuid,async()=>{
  const stored=item.getFlag(DM_NS,DM_FLAG)??[];
  if(!Array.isArray(stored))throw Error('Invalid existing defense flags');
  const removed=stored.filter(x=>x.key===key);
  if(!removed.length)return {removed:false};
  const classification=dmReason(item,reason,restId);
  const events=await dmCommitRemoval(item,removed,
   stored.filter(x=>x.key!==key),classification.reason,null,classification.provenance);
  // Only the elected GM publishes. A player write will be picked up
  // through native updateItem or on the next GM reconciliation.
  if(dmLeader())void dmDeliverReceipts(item).catch(e=>
   console.error('[PF1AE] Expiration notification failed',e));
  return {removed:true,eventIds:events.map(e=>e.eventId)};
 });
}
function dmRaw({defenderActor,defenderUuid}={}){
 const actor=defenderActor?.documentName==='Actor'?defenderActor:
  dmActor(defenderUuid);
 if(!actor||actor.uuid!==defenderUuid)return null;
 const records=[];
 for(const item of dmItems(actor)){
  const saved=item.getFlag?.(DM_NS,DM_FLAG)??[];
  if(!Array.isArray(saved))return null;
  for(const entry of saved){
   if(!dmValidate(entry)||entry.defenderUuid!==actor.uuid||
      entry.sourceItemUuid!==item.uuid)return null;
   records.push({...dmClone(entry),id:dmIdentity(entry)});
  }
 }
 return records;
}
function dmList({defenderActor,defenderUuid,attackerUuid,defense}={}){
 const all=dmRaw({defenderActor,defenderUuid});
 if(!all)return null;
 return all.filter(r=>(defense==null||r.defenses.includes(defense))&&
  (attackerUuid==null||r.attackerUuid==null||r.attackerUuid===attackerUuid));
}
function dmEvaluate({defenderActor,defenderUuid,attackerUuid,defense,nativeTypes,
 nativeTypesComplete=false}={}){
 if(!dmEnabled()||!dmUuid(defenderUuid)||!DM_DEFENSES.has(defense))
  return {status:'uncertain',reason:'defender or defense unavailable',total:null};
 const all=dmList({defenderActor,defenderUuid});
 if(!all)return {status:'uncertain',reason:'defender Item flags unavailable',total:null};
 if(!attackerUuid&&all.some(x=>x.attackerUuid&&x.defenses.includes(defense)))
  return {status:'uncertain',reason:'attacker identity unavailable',total:null};
 if(attackerUuid!=null&&!dmUuid(attackerUuid))
  return {status:'uncertain',reason:'invalid attacker identity',total:null};
 const candidates=all.filter(x=>x.defenses.includes(defense)&&
   (!x.attackerUuid||x.attackerUuid===attackerUuid));
 const used=[],suppressed=[],unknownTypes=[];
 let total=0;
 const byType=new Map();
 for(const entry of candidates){
  if(entry.expiresOnDeathOf){
   const expired=dmActor(entry.expiresOnDeathOf);
   if(!expired)return {status:'uncertain',reason:'expiration actor unavailable',total:null};
   if(expired.statuses?.has?.('dead'))continue;
  }
  const group=byType.get(entry.bonusType)??[];
  group.push(entry);byType.set(entry.bonusType,group);
 }
 for(const [type,entries] of byType){
  if(!DM_STACKING.has(type)&&!nativeTypesComplete&&
     !Object.hasOwn(nativeTypes??{},type)){
   unknownTypes.push(type);continue;
  }
  const native=Number(nativeTypes?.[type]??0);
  if(!Number.isFinite(native))return {
   status:'uncertain',reason:'invalid native bonus breakdown',total:null};
  if(DM_STACKING.has(type)){
   for(const item of entries){used.push(item);total+=item.value}
   continue;
  }
  const best=[...entries].filter(x=>x.value>=0)
   .sort((a,b)=>b.value-a.value)[0];
  if(best&&best.value>native){used.push(best);total+=best.value-Math.max(0,native)}
  if(best&&best.value<=native)suppressed.push(best);
  suppressed.push(...entries.filter(x=>x.value>=0&&x!==best));
  // PF1 typed penalties do not cancel a typed bonus in a stacking contest.
  for(const neg of entries.filter(x=>x.value<0)){used.push(neg);total+=neg.value}
 }
 const result={status:unknownTypes.length?'uncertain':'resolved',
  reason:unknownTypes.length?'Unverified native bonus types: '+unknownTypes.join(', '):null,
  total:unknownTypes.length?null:total,applied:used,
  suppressed,unknownTypes};
 DM_LAST=result;return dmClone(result);
}

/**
 * A confirmed PF1 dead condition permanently retires source-bound
 * conditional defenses. HP 0 alone never qualifies. Check at the moment
 * of the write, so transient / unrelated ActiveEffects cannot expire them.
 */
const dmLeader=()=>[...(game.users??[])].filter(u=>u.active&&u.isGM)
 .sort((a,b)=>a.id.localeCompare(b.id))[0]?.id===game.user?.id;
function dmWorldActors(){
 const found=new Map();
 for(const actor of game.actors?.contents??[])if(actor?.uuid)found.set(actor.uuid,actor);
 for(const scene of game.scenes?.contents??[]){
  for(const token of scene.tokens?.contents??[]){
   if(token.actorLink)continue;
   const actor=token.actor;
   if(actor?.uuid)found.set(actor.uuid,actor);
  }
 }
 return [...found.values()];
}
async function dmExpireConfirmed(target){
 if(!dmEnabled()||!dmLeader()||target?.documentName!=="Actor"||
    !target.statuses?.has?.("dead"))return {expired:0};
 let expired=0;
 for(const defender of dmWorldActors()){
  for(const item of dmItems(defender)){
   if(item?.documentName!=="Item")continue;
   const stored=item.getFlag?.(DM_NS,DM_FLAG);
   if(!Array.isArray(stored)||!stored.some(x=>x.expiresOnDeathOf===target.uuid))continue;
   await dmQueue(item.uuid,async()=>{
    if(!target.statuses?.has?.("dead"))return;
    const current=item.getFlag?.(DM_NS,DM_FLAG);
    if(!Array.isArray(current))return;
    const keep=current.filter(x=>x.expiresOnDeathOf!==target.uuid);
    if(keep.length===current.length)return;
    const removed=current.filter(x=>x.expiresOnDeathOf===target.uuid);
    await dmCommitRemoval(item,removed,keep,'death',target.uuid,
      'verified-native-dead-status');
    expired+=removed.length;
   });
  }
 }
 if(expired>0)void dmReconcileReceipts().catch(e=>
  console.error('[PF1AE] Death expiry notification error',e));
 return {expired};
}
/**
 * A durable source-bound outbox makes GM delivery independent of the actor
 * owner's browser. The elected GM claims an event BEFORE invoking any
 * executable script: concurrent hooks/F5/leader changes never replay it.
 * A crash during the small claim->invoke window may lose a notification;
 * at-most-once is intentional to prevent duplicate RP/chat messages.
 */
const dmCalls=item=>item?.scriptCalls?.contents??
 (typeof item?.scriptCalls?.values==='function'?[...item.scriptCalls.values()]:
  Array.isArray(item?.scriptCalls)?item.scriptCalls:item?.system?.scriptCalls??[]);
async function dmDeliverReceipts(item){
 if(!dmLeader()||!dmEnabled()||item?.documentName!=='Item')return {skipped:true};
 return dmQueue(item.uuid,async()=>{
  const current=item.getFlag?.(DM_NS,DM_RECEIPTS)??[];
  if(!Array.isArray(current))return {skipped:true};
  const pending=current.filter(e=>e?.delivery==='pending'&&
   e?.sourceItemUuid===item.uuid);
  let emitted=0,executed=0,blocked=0;
  for(const receipt of pending){
   if(!dmLeader())break;
   // An event may only be claimed when its actual source modifier is gone.
   const mods=item.getFlag?.(DM_NS,DM_FLAG)??[];
   if(!Array.isArray(mods)||mods.some(x=>x.key===receipt.modifierKey))continue;
   const latest=item.getFlag?.(DM_NS,DM_RECEIPTS)??[];
   if(!Array.isArray(latest)||!latest.some(e=>
      e.eventId===receipt.eventId&&e.delivery==='pending'))continue;
   const claimed=latest.map(e=>e.eventId===receipt.eventId?
    {...e,delivery:'claimed'}:e);
   await item.setFlag(DM_NS,DM_RECEIPTS,claimed);
   // Event has been irreversibly claimed, so publish only once.
   const {delivery,...payload}=receipt;
   const event=Object.freeze(dmClone(payload));
   try{Hooks.callAll?.('pf1aeDefenseModifierExpired',event);emitted++}
   catch(error){console.error('[PF1AE] Defense expiry hook failed',error)}
   const actor=item.actor??item.parent;
   if(actor?.uuid!==event.defenderUuid)continue;
   const matching=dmCalls(item).filter(call=>call?.category==='postUse'&&
     call?.name==='PF1AE:defense:expired'&&
     typeof call.execute==='function'&&(call.id??call._id));
   if(matching.length!==1){
    if(matching.length>1)console.warn('[PF1AE] Ambiguous defense expiry Script Call',item.uuid);
    continue;
   }
   const call=matching[0];
   const approval=game.modules.get(DM_NS)?.api?.scriptApprovals
     ?.check?.(actor,item,call);
   if(approval?.approved!==true){
    blocked++;
    console.warn('[PF1AE] Defense expiry Script Call not approved',{
     actorUuid:actor.uuid,itemUuid:item.uuid,scriptId:call.id??call._id,
     reason:approval?.reason??'approval-service-unavailable'
    });
    continue;
   }
   try{
    // Native PF1 Script Call executes on elected GM. The source and
    // fingerprint are checked by scriptApprovals, never from a socket.
    await call.execute({action:null},{event,state:null,
     api:game.modules.get(DM_NS)?.api?.defenseModifiers});
    executed++;
   }catch(error){
    console.error('[PF1AE] Expiration native Script Call failed',
      item.uuid,receipt.eventId,error);
   }
  }
  return {emitted,executed,blocked};
 });
}
async function dmReconcileReceipts(){
 if(!dmLeader()||!dmEnabled())return {skipped:true};
 const seen=new Set(),results=[];
 for(const actor of dmWorldActors()){
  for(const item of dmItems(actor)){
   if(item?.documentName!=='Item'||seen.has(item.uuid))continue;
   seen.add(item.uuid);
   if((item.getFlag?.(DM_NS,DM_RECEIPTS)??[]).some?.(r=>r.delivery==='pending'))
    results.push(await dmDeliverReceipts(item));
  }
 }
 return {results};
}
function dmCheckDeath(doc){
 const actor=doc?.documentName==="Actor"?doc:
  doc?.parent?.documentName==="Actor"?doc.parent:null;
 if(actor?.statuses?.has?.("dead"))
  void dmExpireConfirmed(actor).catch(e=>console.error("[PF1AE] Death expiration failed",e));
}
Hooks.once("init",()=>{
 if(typeof Hooks.on!=="function")return;
 for(const name of ["createActiveEffect","updateActiveEffect","deleteActiveEffect"])
  Hooks.on(name,dmCheckDeath);
 Hooks.on("updateActor",dmCheckDeath);
 // Foundry's native updateItem propagates a player-owned removal to the
 // elected GM, with its durable event receipt. No custom socket is needed.
 Hooks.on("updateItem",item=>{
  if(item?.getFlag?.(DM_NS,DM_RECEIPTS)?.some?.(x=>x.delivery==='pending'))
   void dmDeliverReceipts(item).catch(e=>
    console.error('[PF1AE] Expiration delivery failed',e));
 });
 Hooks.on("canvasReady",()=>{void dmReconcileReceipts().catch(console.error)});
 Hooks.on("updateUser",()=>{void dmReconcileReceipts().catch(console.error)});
});

Hooks.once('ready',()=>{
 const mod=game.modules.get(DM_NS);if(!mod)return;
 mod.api??={};
 mod.api.defenseModifiers=Object.freeze({
  register:dmRegister,remove:dmRemove,list:dmList,evaluate:dmEvaluate,
  _withVerifiedRest:dmWithVerifiedRest,
  expireConfirmed:dmExpireConfirmed,
  lastDiagnostic:()=>DM_LAST?dmClone(DM_LAST):null
 });
});

// Reconcile conditions present before the elected GM connected.
Hooks.once("ready",()=>{
 if(dmLeader()){
  for(const actor of dmWorldActors())dmCheckDeath(actor);
  void dmReconcileReceipts().catch(console.error);
 }
});
