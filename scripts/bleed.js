/**
 * PF1AE — generic PF1 Bleed damage engine (HP only).
 * Begin-turn GM-authoritative processing, not a parallel damage engine.
 * All mechanical class-specific reductions live in approved native Item
 * Script Calls named PF1AE:bleed:before (postUse).
 */
const BL_NS='pf1-automation-engine';
const BL_FLAG='bleed';
const BL_LEDGER='bleedTurnReceipts';
const BL_PRE='PF1AE:bleed:before';
const BL_POST='PF1AE:bleed:applied';
const BL_RUN=new Set();
let BL_TAIL=Promise.resolve();
const blEnabled=()=>{
 try{return game.modules.get(BL_NS)?.active===true&&game.settings.get(BL_NS,'genericEnabled')!==false}
 catch(_){return false}
};
const blLeader=()=>[...game.users].filter(u=>u.active&&u.isGM)
 .sort((a,b)=>a.id.localeCompare(b.id))[0]?.id===game.user?.id&&game.user?.isGM===true;
const blDebug=(label,detail)=>{
 try{if(game.settings.get(BL_NS,'genericDebug'))console.debug('[PF1AE][Bleed] '+label,detail)}
 catch(_){}
};
const blItems=actor=>[...(actor?.items?.contents??actor?.items?.values?.()??[])];
const blCalls=item=>[...(item?.scriptCalls?.contents??item?.scriptCalls?.values?.()??item?.system?.scriptCalls??[])];
const blSource=effect=>effect?.actor??effect?.parent;
const blIsBuff=effect=>effect?.documentName==='Item'&&effect.type==='buff';
const blIsNativeBleed=effect=>effect?.documentName==='ActiveEffect'&&
 effect.statuses?.has?.('bleed')===true;
const blIsSource=effect=>blIsBuff(effect)||blIsNativeBleed(effect);
const blConfig=effect=>{
 if(!blIsSource(effect))return null;
 const data=effect.getFlag?.(BL_NS,BL_FLAG);
 if(!data||data.enabled!==true||data.type!=='hp'||
    typeof data.formula!=='string'||!data.formula.trim()||
    data.formula.length>100||data.stacking!=='highest')return null;
 // PF1 ItemBuffPF.activeState is the authoritative native activation
 // accessor. A stale/absent system.active must not veto an active Buff.
 if(blIsBuff(effect)&&(effect.activeState===false||
   (effect.activeState==null&&effect.system?.active===false)))return null;
 if(blIsNativeBleed(effect)&&effect.disabled===true)return null;
 // Built-in PF1 item time tracking remains authoritative: an inactive Buff
 // is not a candidate; existing PF1AE duration service may deactivate it.
 return {enabled:true,type:'hp',formula:data.formula,stacking:'highest'};
};
const blEffects=actor=>[...(actor?.effects?.contents??actor?.effects?.values?.()??[])];
const blList=actor=>[...blItems(actor),...blEffects(actor)].filter(item=>blConfig(item)!==null);
const blReceipt=(combat,combatant)=>JSON.stringify([combat.id,combatant.id,combat.round]);
const blRows=()=>game.settings.get(BL_NS,BL_LEDGER)??[];
const blEligible=()=>blEnabled()&&blLeader();
const blQueue=fn=>{
 const task=BL_TAIL.catch(()=>{}).then(fn);
 BL_TAIL=task.catch(()=>{});
 return task;
};
const blMaxRows=5000;
const blUpdateReceipt=async (key,state,payload={})=>{
 const rows=blRows().filter(x=>x.key!==key);
 rows.push({key,status:state,updatedAt:Date.now(),...payload});
 await game.settings.set(BL_NS,BL_LEDGER,rows.slice(-blMaxRows));
};
const blOwner=actor=>[...game.users].some(user=>!user.isGM&&
 actor.testUserPermission?.(user,'OWNER')===true);
function blSubscribers(actor,name){
 const subscriptions=[];
 for(const item of blItems(actor)){
  const matches=blCalls(item).filter(c=>c?.category==='postUse'&&
   c?.name===name&&typeof c.execute==='function');
  if(matches.length===1)subscriptions.push({item,call:matches[0]});
  else if(matches.length>1)console.warn('[PF1AE][Bleed] Duplicate Script Calls skipped',item.uuid,name);
 }
 return subscriptions;
}
async function blRoll(formula){
 if(typeof Roll!=='function')throw Error('Native Foundry Roll unavailable.');
 const roll=await (new Roll(formula)).evaluate({async:true});
 const value=Number(roll.total);
 if(!Number.isSafeInteger(value)||value<0||value>100000)
  throw Error('Bleed formula must evaluate to a nonnegative integer <= 100000.');
 return {amount:value,roll,formula};
}
const blDamage=async (actor,amount)=>{
 if(amount===0)return true;
 // The native PF1 ActorPF.applyDamage handles temporary HP, Vigor/Wounds,
 // and other actor-specific hit point variants. Do not manually update HP.
 if(typeof actor.applyDamage!=='function')
  throw Error('Native PF1 Actor.applyDamage unavailable; bleed not applied.');
 // Always provide an options object. PF1 Automate Damage v2.1 wraps
 // ActorPF.applyDamage and immediately reads config._pf1AutomateDamageDialog;
 // omitting config crashes before native PF1 can update HP.
 // Its own dialog-path marker bypasses its selected-token/card interception,
 // ensuring this periodic bleed hits the specified actor only.
 const options={};
 if(game.modules.get('pf1-automate-damage')?.active===true)
  options._pf1AutomateDamageDialog=true;
 const result=await actor.applyDamage(amount,options);
 if(result===false)throw Error('Native PF1 damage was cancelled.');
 return true;
};
function blHasDice(roll){
 return Array.isArray(roll?.dice)&&roll.dice.length>0;
}
const blChatText=(actor,amount)=>{
 // The elected GM's Foundry language controls the chat announcement.
 // Other locales explicitly fall back to English, never to untranslated keys.
 const locale=String(game.i18n?.lang??'en').toLowerCase();
 const french=locale==='fr'||locale.startsWith('fr-');
 const safeName=foundry.utils.escapeHTML?.(actor.name??'Actor')??
  String(actor.name??'Actor').replace(/[&<>"']/g,'');
 const text=french?'subit {amount} points de saignement !':
  'takes {amount} points of bleed damage!';
 return '<p>🩸 <strong>'+safeName+'</strong> '+
  text.replace('{amount}','<strong>'+amount+'</strong>')+'</p>';
};
async function blAnnounce(actor,roll,original,remaining){
 const summary=blChatText(actor,remaining);
 const speaker=ChatMessage.getSpeaker({actor});
 if(blHasDice(roll)&&typeof roll?.toMessage==='function'){
  // This publishes a real Foundry dice roll; Dice So Nice can animate it
  // without rolling twice or introducing any new damage resolution.
  await roll.toMessage({speaker,flavor:summary});
 }else{
  await ChatMessage.create({speaker,content:summary});
 }
}
function blHealth(actor){
 const hp=actor?.system?.attributes?.hp;
 return typeof hp?.value==='number'?hp.value:null;
}
async function blSubscribersRun(actor,name,base,controller){
 for(const {item,call} of blSubscribers(actor,name)){
  if(!blEligible())throw Error('Bleed GM authority changed during turn.');
  const verify=game.modules.get(BL_NS)?.api?.scriptApprovals?.check;
  if(blOwner(actor)){
   if(typeof verify!=='function'||verify(actor,item,call)?.approved!==true){
    blDebug('Unapproved bleed Script Call skipped',{actorUuid:actor.uuid,itemUuid:item.uuid,
     scriptId:call.id??call._id,name});
    continue;
   }
  }
  const id=JSON.stringify([item.uuid,call.id??call._id]);
  let used=false;
  const control=Object.freeze({
   ...base,
   get amount(){return controller.amount},
   reduce(value){
    if(name!==BL_PRE)throw Error('Bleed applied event is read-only.');
    if(used)throw Error('This Script Call has already adjusted the bleed event.');
    if(!Number.isSafeInteger(value)||value<0)throw Error('Expected nonnegative integer reduction.');
    used=true;controller.amount=Math.max(0,controller.amount-value);
   },
   negate(){
    if(name!==BL_PRE)throw Error('Bleed applied event is read-only.');
    if(used)throw Error('This Script Call has already adjusted the bleed event.');
    used=true;controller.amount=0;
   }
  });
  try{
   await call.execute({action:null},{event:control,
    api:game.modules.get(BL_NS)?.api?.bleed});
  }catch(error){
   // Before is fail-closed: do not apply damage if a potentially
   // important mitigation failed; persist the pending receipt for review.
   if(name===BL_PRE)throw Error('Bleed before handler failed '+id+': '+String(error?.message??error));
   console.error('[PF1AE][Bleed] Applied notification failed',id,error);
  }
 }
}
async function blProcess(combat){
 if(!blEligible()||!combat?.started||!Number.isInteger(combat.round)||
    combat.round<1||!Number.isInteger(combat.turn)||!combat.combatant)return {skipped:'no active turn'};
 const combatant=combat.combatant;
 const actor=combatant.actor;
 if(actor?.documentName!=='Actor')return {skipped:'no actor'};
 const key=blReceipt(combat,combatant);
 if(BL_RUN.has(key)||blRows().some(r=>r.key===key))
  return {skipped:'already claimed'};
 const candidates=blList(actor);
 if(!candidates.length)return {skipped:'no configured HP Bleed buffs'};
 // Reserve BEFORE rolls, scripts or damage. A failure leaves pending state
 // rather than causing a duplicate mutation on F5 or Combat Tracker rewind.
 await blUpdateReceipt(key,'pending',{combatId:combat.id,combatantId:combatant.id,
  round:combat.round,actorUuid:actor.uuid});
 BL_RUN.add(key);
 blDebug('Bleed turn started',{key,actorUuid:actor.uuid});
 try{
  const rolled=[];
  for(const effect of candidates){
   const data=blConfig(effect);
   if(!data)continue; // removed or disabled during asynchronous evaluation
   rolled.push({effect,...await blRoll(data.formula)});
  }
  blDebug('Candidate effects',rolled.map(x=>({effectUuid:x.effect.uuid,amount:x.amount})));
  if(!rolled.length){
   await blUpdateReceipt(key,'skipped',{reason:'no active buff'});
   return {skipped:'no active buff'};
  }
  rolled.sort((a,b)=>b.amount-a.amount||a.effect.uuid.localeCompare(b.effect.uuid));
  const winner=rolled[0];
  blDebug('Highest effect selected',{effectUuid:winner.effect.uuid,originalAmount:winner.amount});
  const controller={amount:winner.amount};
  const immutable=Object.freeze({
   eventId:key,type:'bleed:before',actorUuid:actor.uuid,effectUuid:winner.effect.uuid,
   bleedType:'hp',originalAmount:winner.amount,
   combatId:combat.id,combatantId:combatant.id,round:combat.round
  });
  // Event.amount is a read-only live getter and changes only via reduce()/negate().
  const eventBase=Object.freeze({...immutable,
   get amount(){return controller.amount}});
  blDebug('Before modifiers',{key,amount:controller.amount});
  await blSubscribersRun(actor,BL_PRE,eventBase,controller);
  if(!blEligible())throw Error('Bleed GM authority changed before native damage.');
  // Fail closed on a buff that was removed during the async pre-damage stage.
  if(!blConfig(winner.effect))throw Error('Bleed source removed while processing.');
  const original=winner.amount,remaining=controller.amount;
  const hpBefore=blHealth(actor);
  if(remaining>0)await blDamage(actor,remaining);
  // Document was mutated: persist applied status before any optional
  // after-application notifications.
  await blUpdateReceipt(key,'applied',{
   combatId:combat.id,combatantId:combatant.id,round:combat.round,
   actorUuid:actor.uuid,effectUuid:winner.effect.uuid,
   originalAmount:original,appliedAmount:remaining
  });
  blDebug('Prevented '+(original-remaining),{key});
  // Roll cards are posted only AFTER damage and the applied receipt are
  // saved. A chat failure must never reapply damage or leave a false pending
  // receipt. roll.toMessage uses the SAME evaluated Roll (Dice So Nice).
  try{await blAnnounce(actor,winner.roll,original,remaining)}
  catch(error){console.warn('[PF1AE][Bleed] Chat display failed; HP already applied',error)}
  blDebug('Applied '+remaining+' HP',{key});
  const after=Object.freeze({
   eventId:key,type:'bleed:applied',actorUuid:actor.uuid,effectUuid:winner.effect.uuid,
   bleedType:'hp',originalAmount:original,preventedAmount:original-remaining,
   appliedAmount:remaining,hpBefore,hpAfter:blHealth(actor),
   combatId:combat.id,combatantId:combatant.id,round:combat.round
  });
  Hooks.callAll?.('pf1aeBleedApplied',after);
  await blSubscribersRun(actor,BL_POST,after,controller);
  return {applied:true,amount:remaining,prevented:original-remaining,effectUuid:winner.effect.uuid};
 }catch(error){
  console.error('[PF1AE][Bleed] Turn failed; receipt remains pending for GM review',key,error);
  return {pending:true,error:String(error?.message??error)};
 }finally{BL_RUN.delete(key)}
}
async function blConfigure({effect,type='hp',formula,stacking='highest'}={}){
 if(!blIsSource(effect)||blSource(effect)?.documentName!=='Actor')
  throw Error('Bleed configure requires an embedded PF1 Buff or native Bleed ActiveEffect.');
 if(!game.user?.isGM&&!blSource(effect)?.testUserPermission?.(game.user,'OWNER'))
  throw Error('Actor OWNER permission required.');
 if(type!=='hp'||stacking!=='highest')throw Error('Only HP Bleed with highest stacking is supported.');
 if(typeof formula!=='string'||!formula.trim()||formula.length>100)
  throw Error('Bleed formula must be a nonempty string <=100 characters.');
 // Verify syntax without rolling or mutating HP.
 if(typeof Roll!=='function')throw Error('Native Foundry Roll is unavailable.');
 try{new Roll(formula)}catch(e){throw Error('Invalid bleed formula: '+e.message)}
 if(blIsNativeBleed(effect)&&effect.disabled===true)
  throw Error('Cannot configure a disabled native Bleed condition.');
 await effect.setFlag(BL_NS,BL_FLAG,{enabled:true,type,formula,stacking});
 // The native ActiveEffect's actual name is updated, so PF1's effect lists
 // show the formula even in views that do not expose a render hook.
 // Client-side display overlays adapt it to each user's Foundry locale.
 if(blIsNativeBleed(effect)&&typeof effect.update==='function'){
  const locale=String(game.i18n?.lang??'en').toLowerCase();
  const label=(locale==='fr'||locale.startsWith('fr-')?'Saignement':'Bleed')+
   ' - '+formula;
  if(effect.name!==label)await effect.update({name:label});
 }
 return effect.getFlag(BL_NS,BL_FLAG);
}
function blScheduleTurn(combat,source){
 if(!blEligible()||!combat?.started)return;
 // The persistent [combat, combatant, round] receipt is the authoritative
 // deduplication gate for concurrent updateCombat/turn-change hooks.
 void blQueue(async()=>{
  blDebug('Turn event received',{source,combatId:combat.id,round:combat.round,
   turn:combat.turn,combatantId:combat.combatant?.id,
   actorUuid:combat.combatant?.actor?.uuid});
  const result=await blProcess(combat);
  blDebug('Turn outcome',{source,result});
 }).catch(error=>console.error('[PF1AE][Bleed] Combat hook failed',source,error));
}
function blTurnHook(combat,change){
 if(!Object.hasOwn(change??{},'round')&&!Object.hasOwn(change??{},'turn'))return;
 blScheduleTurn(combat,'updateCombat');
}
function blTurnChangeHook(combat,prior,current){
 // Foundry V13 emits this on all clients AFTER the Combat is updated.
 // Do not process on players or on a second GM.
 if(prior?.round===current?.round&&
    prior?.combatantId===current?.combatantId)return;
 blScheduleTurn(combat,'combatTurnChange');
}
function blDiagnostic(combat=game.combat){
 const actor=combat?.combatant?.actor;
 const entries=actor?[...blItems(actor).filter(blIsBuff),...blEffects(actor).filter(blIsNativeBleed)].map(item=>({
  name:item.name,uuid:item.uuid,
  activeState:item.activeState,systemActive:item.system?.active,
  metadata:item.getFlag?.(BL_NS,BL_FLAG)??null,
  eligible:blConfig(item)!==null
 })):[];
 const key=combat?.combatant&&Number.isInteger(combat.round)
  ?blReceipt(combat,combat.combatant):null;
 const receipt=key?blRows().find(x=>x.key===key)??null:null;
 return {
  moduleEnabled:blEnabled(),isElectedGM:blLeader(),
  combatId:combat?.id??null,started:combat?.started??false,
  round:combat?.round??null,turn:combat?.turn??null,
  combatantId:combat?.combatant?.id??null,
  actorUuid:actor?.uuid??null,actorType:actor?.documentName??null,
  hp:blHealth(actor),buffs:entries,receipt,
  status:!blEnabled()?'module disabled':!blLeader()?'not elected GM':
   !combat?.started?'combat not started':!actor?'no combatant Actor':
   entries.some(x=>x.eligible)?(receipt?'turn receipt already exists':'ready for turn change'):
   'no active configured HP Bleed Buff'
 };
}
Hooks.once('init',()=>{
 game.settings.register(BL_NS,BL_LEDGER,{scope:'world',config:false,type:Array,
  default:[]});
 Hooks.on('updateCombat',blTurnHook);
 Hooks.on('combatTurnChange',blTurnChangeHook);
});
Hooks.once('ready',()=>{
 const mod=game.modules.get(BL_NS);if(!mod)return;
 mod.api??={};
 mod.api.bleed=Object.freeze({
  configure:blConfigure,
  get:effect=>blConfig(effect),
  isBleed:effect=>blConfig(effect)!==null,
  list:actor=>blList(actor),
  process:combat=>blQueue(()=>blProcess(combat)),
  receipts:()=>foundry.utils.deepClone(blRows()),
  diagnostic:blDiagnostic
 });
});
