/**
 * PF1 Automation Engine — Attack Outcomes (v1.19.0).
 * Fail-closed tracking for source-specific attacks whose damage is manually
 * applied from PF1's native ApplyDamage dialog. Only the elected GM mutates
 * the persistent registry or executes a subsequent PF1 ItemAction.
 *
 * The pf1ApplyDamage hook is PRE-application; verify native dialog completion
 * and final actor resources instead of replacing ActorPF.applyDamage.
 * Damage source is established by the native dialog's structured message and
 * attack index (pf1ApplyDamageTargetOptions), never by an arbitrary HP update.
 */
const AO_NS='pf1-automation-engine';
const AO_REG='attackOutcomeRegistry';
const AO_SOCKET='module.'+AO_NS;
const AO_CHANNEL='pf1ae-attack-outcomes-v1';
const AO_PENDING=new Map();
const AO_ACTIVE_DIALOGS=new WeakSet();
const AO_DIALOG_DAMAGE=new WeakMap();
const AO_SOURCE_OPTIONS=new WeakMap();
const AO_DIRECT_OPTIONS=new Map();
const AO_DIRECT_PENDING=new Map();
const AO_DIRECT_TTL=1800,AO_OPTIONS_WINDOW=700;
function aoDescribe(x){
 return x?{sourceMessageId:x.sourceMessageId??null,sourceItemUuid:x.sourceItemUuid??null,
   sourceActionId:x.sourceActionId??null,attackIndex:x.attackIndex??null,
   targetUuid:x.targetUuid??null}:null;
}
function aoDifferent(a,b){
 return !a||!b||['sourceMessageId','sourceItemUuid','sourceActionId','attackIndex','targetUuid']
   .some(k=>a[k]!==b[k]);
}
function aoDrop(record){
 if(record?.timer)clearTimeout(record.timer);
 for(const [key,items] of AO_DIRECT_OPTIONS){
  const kept=items.filter(x=>x!==record);
  if(kept.length)AO_DIRECT_OPTIONS.set(key,kept);else AO_DIRECT_OPTIONS.delete(key);
 }
 if(record&&AO_DIRECT_PENDING.get(record.context.targetUuid)===record)
  AO_DIRECT_PENDING.delete(record.context.targetUuid);
}
function aoPrepareDirect(record){
 const key=record.context.targetUuid;
 const items=(AO_DIRECT_OPTIONS.get(key)??[])
   .filter(x=>!x.completed&&aoNow()-x.createdAt<=AO_OPTIONS_WINDOW);
 for(const other of items){other.conflicted=true;record.conflicted=true;}
 record.createdAt=aoNow();record.completed=false;
 items.push(record);AO_DIRECT_OPTIONS.set(key,items);
 record.timer=setTimeout(()=>{
  aoDrop(record);
  aoLog('Direct native damage candidate expired',{
   requestId:record.requestId,expected:aoDescribe(record.context)});
 },AO_DIRECT_TTL);
}
/** PF1 v11.11 unlinked tokens update hp.offset; Foundry changes can be
 * represented as nested objects or flattened dotted-path changes.
 */
function aoUpdateField(object,path){
 if(!object||typeof object!=='object')return undefined;
 if(Object.prototype.hasOwnProperty.call(object,path))return object[path];
 return path.split('.').reduce((value,key)=>value?.[key],object);
}
function aoUpdateHasDamage(changes){
 return ['system.attributes.hp.value','system.attributes.hp.offset',
  'system.attributes.hp.nonlethal','system.attributes.hp.nl',
  'system.attributes.hp.temp'].some(key=>aoUpdateField(changes,key)!==undefined);
}
function aoNativeCritMult(options){
 const value=options?.critMult;
 if(value==null||value==='')return null;
 const n=Number(value);
 return Number.isSafeInteger(n)&&n>=0&&n<=100?n:null;
}
/** Snapshot taken from the same Actor before and after native PF1 damage. */
function aoDamageEvidence(record,after){
 return {hpBefore:Number.isFinite(record.before?.hp)?record.before.hp:null,
  hpAfter:Number.isFinite(after?.hp)?after.hp:null,
  tempHpBefore:Number.isFinite(record.before?.temp)?record.before.temp:null,
  tempHpAfter:Number.isFinite(after?.temp)?after.temp:null,
  nonlethalBefore:Number.isFinite(record.before?.nonlethal)?record.before.nonlethal:null,
  nonlethalAfter:Number.isFinite(after?.nonlethal)?after.nonlethal:null,
  critMult:record.critMult??null};
}
function aoOffsetEvidence(options){
 const hp=options?.pf1?.deltas?.hp??{};
 const raw=aoUpdateField(hp,'offset');
 const offset=raw==null?null:Number(raw);
 const previous=options?._nasPrevHp==null?null:Number(options._nasPrevHp);
 return {offset:Number.isFinite(offset)?offset:null,
   previousHp:Number.isFinite(previous)?previous:null};
}
/** A changed offset is never proof on its own: compare effective actor HP. */
function aoConfirmNativeDelta(record,actor,changes,options){
 const after=aoDamageSnapshot(actor);
 const delta=aoDamageDelta(record.before,after);
 const pre=record.nativeEvidence??aoOffsetEvidence(null);
 const post=aoOffsetEvidence(options);
 const evidence={pre,post,before:record.before,after,
   changedOffset:aoUpdateField(changes,'system.attributes.hp.offset')??null,
   changedValue:aoUpdateField(changes,'system.attributes.hp.value')??null};
 const described=pre.offset??post.offset;
 if(described!=null&&described>=0&&delta.hitPointLoss>0)
   return {delta:{...delta,provenDamage:false},evidence,
     reason:'PF1 native HP delta contradicts the observed effective HP loss'};
 for(const item of [pre,post]){
   if(item.previousHp!=null&&Number.isFinite(record.before.hp)&&
      item.previousHp!==record.before.hp)
     return {delta:{...delta,provenDamage:false},evidence,
       reason:'Native prior HP does not match the before-damage snapshot'};
 }
 return {delta,evidence,reason:null};
}
function aoAfterNativeActorUpdate(actor,changes,options,userId){
 if(!aoActive()||!actor?.uuid||!aoUpdateHasDamage(changes))return;
 const record=AO_DIRECT_PENDING.get(actor.uuid);
 if(!record)return;
 const invalid=record.completed||record.conflicted||!record.nativePre||
   record.actor?.uuid!==actor.uuid||aoNow()-record.createdAt>AO_DIRECT_TTL||
   !game.user.isGM||(userId&&userId!==game.user.id);
 if(invalid){
  aoLog('Direct native damage update rejected',{expected:aoDescribe(record.context),
    actual:{targetUuid:actor.uuid,userId},nativePre:record.nativePre,
    conflicted:record.conflicted});
  aoDrop(record);return;
 }
 const confirmed=aoConfirmNativeDelta(record,actor,changes,options);
 const {delta,evidence,reason}=confirmed;
 aoLog('Native damage actor update observed',{
  requestId:record.requestId,expected:aoDescribe(record.context),
  actual:{targetUuid:actor.uuid,userId},delta,evidence,reason});
 if(reason){
  aoLog('Native PF1 HP delta refused',{requestId:record.requestId,reason,evidence});
  aoDrop(record);return;
 }
 if(!delta.provenDamage)return;
 record.completed=true;aoDrop(record);
 aoLog('Native damage applied; dispatching verified outcome',{
   requestId:record.requestId,expected:aoDescribe(record.context),delta});
 const payload={channel:AO_CHANNEL,op:'damage',requestId:record.requestId,
   userId:game.user.id,context:{...record.context,delta,
   evidence:aoDamageEvidence(record,evidence.after)},targetUuid:actor.uuid};
 if(aoLeader())void aoResolveDamage(payload).catch(e=>
    console.error('[PF1AE][AttackOutcome] Direct damage dispatch failed',e));
 else game.socket.emit(AO_SOCKET,payload);
}

const AO_SEEN=new Map();
const AO_MAX=200;
const AO_TIMEOUT=15000;
let aoWriteTail=Promise.resolve();
let aoInstalled=false;
const aoActive=()=>!!game.modules.get(AO_NS)?.active &&
  !game.modules.get('pf1-combat-automation')?.active && game.settings.get(AO_NS,'genericEnabled');
const aoLeaderUser=()=>[...game.users].filter(u=>u.active&&u.isGM)
  .sort((a,b)=>a.id.localeCompare(b.id))[0]??null;
const aoLeader=()=>aoLeaderUser()?.id===game.user.id;
const aoLog=(message,details={})=>{
  try{if(game.settings.get(AO_NS,'genericDebug'))console.debug('[PF1AE][AttackOutcome] '+message,details)}
  catch(e){/* settings not yet registered */}
};
const aoEntries=()=>game.settings.get(AO_NS,AO_REG)??[];
const aoSafe=(x,max=400)=>typeof x==='string'&&x.length>0&&x.length<=max;
const aoKey=x=>aoSafe(x,80)&&/^[A-Za-z0-9_-]+$/.test(x);
const aoUuid=x=>typeof x==='string'?x:x?.uuid;
const aoActor=x=>x?.documentName==='Actor'?x:x?.actor??null;
const aoClone=x=>foundry.utils.deepClone(x);
const aoQueue=fn=>{const next=aoWriteTail.catch(()=>{}).then(fn);aoWriteTail=next.catch(()=>{});return next};
const aoNow=()=>Date.now();
const aoActions=item=>{
 const c=item?.actions??item?.system?.actions;
 return c?.values?[...c.values()]:Array.isArray(c)?c:Object.values(c??{});
};
const aoActionId=a=>a?.id??a?._id??null;
const aoMessage=v=>{
 if(v?.documentName==='ChatMessage')return v;
 if(typeof v==='string'){
   const id=v.startsWith('ChatMessage.')?v.slice(12):v;
   return game.messages?.get(id)??null;
 }
 return null;
};
function aoCardSource(card){
 if(card?.documentName!=='ChatMessage')return null;
 const item=card.itemSource,action=card.actionSource;
 const actionId=aoActionId(action);
 const actor=item?.actor??(typeof ChatMessage?.getSpeakerActor==='function'
   ?ChatMessage.getSpeakerActor(card.speaker):null);
 const actorUuid=actor?.uuid??null;
 const itemId=item?.id??card.system?.item?.id;
 const itemUuid=item?.uuid??(actorUuid&&itemId?actorUuid+'.Item.'+itemId:null);
 if(!aoSafe(actorUuid)||!aoSafe(itemUuid)||!aoSafe(actionId,100))return null;
 return {actorUuid,itemUuid,actionId};
}
function aoDamageSnapshot(actor){
 const hp=actor?.system?.attributes?.hp??{};
 return {hp:Number(hp.value),temp:Number(hp.temp),nonlethal:Number(hp.nonlethal??hp.nl)};
}
function aoDamageDelta(before,after){
 const loss=(Number.isFinite(before.hp)&&Number.isFinite(after.hp))
   ?Math.max(0,before.hp-after.hp):0;
 const nonlethal=(Number.isFinite(before.nonlethal)&&Number.isFinite(after.nonlethal))
   ?Math.max(0,after.nonlethal-before.nonlethal):0;
 const tempLoss=(Number.isFinite(before.temp)&&Number.isFinite(after.temp))
   ?Math.max(0,before.temp-after.temp):0;
 return {hitPointLoss:loss,nonlethalDamage:nonlethal,tempHpLoss:tempLoss,
   // Temporary HP-only absorption is not definitive damage to the creature.
   provenDamage:loss>0||nonlethal>0};
}
function aoSourceMatches(rule,source,card,index,targetUuid){
 return rule.state==='pending'&&rule.sourceItemUuid===source.itemUuid&&
   rule.sourceActionId===source.actionId&&rule.actorUuid===source.actorUuid&&
   rule.targets.includes(targetUuid)&&
   (rule.sourceMessageId==null||rule.sourceMessageId===card.id)&&
   rule.attackIndex===index;
}
async function aoValidate(data,user,remote=false){
 if(!aoActive()||!aoLeader())throw Error('Elected GM and active module required');
 if(!data||!aoKey(data.key)||!aoKey(data.groupKey)||
    !aoSafe(data.sourceItemUuid)||!aoSafe(data.sourceActionId,100)||
    !Array.isArray(data.targets)||!data.targets.length||data.targets.length>30)
    throw Error('Invalid attack outcome identity, Action or targets');
 const actor=await fromUuid(data.actorUuid);
 if(actor?.documentName!=='Actor')throw Error('Source Actor not found');
 if((remote||!user?.isGM)&&!actor.testUserPermission?.(user,'OWNER'))
    throw Error('Requester does not own source Actor');
 const item=await fromUuid(data.sourceItemUuid);
 if(item?.documentName!=='Item'||(item.actor??item.parent)?.uuid!==actor.uuid)
    throw Error('Attack Item must belong to source Actor');
 if(!aoActions(item).some(a=>aoActionId(a)===data.sourceActionId))
    throw Error('Source Action does not exist');
 const targets=[...new Set(data.targets)];
 if(!targets.every(x=>aoSafe(x)))throw Error('Invalid target UUIDs');
 for(const uuid of targets){const target=await fromUuid(uuid);
   if(target?.documentName!=='Actor')throw Error('Invalid target Actor '+uuid)}
 const on=data.onDamageApplied;
 if(on?.type!=='triggerItemAction'||!aoSafe(on.itemUuid)||!aoSafe(on.actionId,100))
    throw Error('Only triggerItemAction is supported');
 const trigger=await fromUuid(on.itemUuid);
 if(trigger?.documentName!=='Item'||(trigger.actor??trigger.parent)?.uuid!==actor.uuid||
    !aoActions(trigger).some(a=>aoActionId(a)===on.actionId))
    throw Error('Trigger Action must belong to source Actor');
 if(!Number.isInteger(data.attackIndex)||data.attackIndex<0||data.attackIndex>99)
    throw Error('Explicit zero-based attackIndex required for multiple attacks');
 if(data.sourceMessageId!=null&&!aoSafe(data.sourceMessageId,100))
    throw Error('Invalid sourceMessageId');
 const output={id:actor.uuid+':'+data.key,actorUuid:actor.uuid,key:data.key,
   groupKey:data.groupKey,sourceItemUuid:item.uuid,sourceActionId:data.sourceActionId,
   sourceMessageId:data.sourceMessageId??null,attackIndex:data.attackIndex,
   targets,onDamageApplied:{type:'triggerItemAction',itemUuid:trigger.uuid,
     actionId:on.actionId,saveOutcome:on.saveOutcome??null},
   state:'pending',createdAt:aoNow(),expiresAt:aoNow()+1000*60*60*4};
 // SaveOutcome registration is never accepted from a remote client as script.
 // This is pure serializable data, still revalidated by saveOutcomes.register.
 if(on.saveOutcome!=null){
  const sc=on.saveOutcome;
  // Validate only the native action/target linkage. SaveOutcomes and
  // api.effects validate all consequence-specific fields on the elected GM.
  if(!sc||typeof sc!=='object'||Array.isArray(sc)||
     sc.sourceItemUuid!==trigger.uuid||sc.sourceActionId!==on.actionId||
     !aoKey(sc.key)||!aoKey(sc.groupKey)||
     !['linkedBuff','templateEffect','dynamicEffect'].includes(sc.onFailure?.type)||
     !Array.isArray(sc.targets)||sc.targets.length<1||
     !sc.targets.every(t=>targets.includes(t)))
    throw Error('Invalid SaveOutcome configuration');
 }
 return output;
}
async function aoRegister(payload,user,remote=false){
 const rule=await aoValidate(payload.data,user,remote);
 return aoQueue(async()=>{
  const list=aoEntries().filter(r=>r.id!==rule.id);
  if(list.length>=AO_MAX)throw Error('Maximum attack rules reached');
  await game.settings.set(AO_NS,AO_REG,[...list,rule]);
  aoLog('Registered',{id:rule.id,attackIndex:rule.attackIndex,targets:rule.targets});
  return {registered:true,id:rule.id};
 });
}
async function aoRemove(payload,user,remote=false){
 const source=await fromUuid(payload.actorUuid);
 if(!aoLeader()||source?.documentName!=='Actor'||!aoKey(payload.key)||
   ((remote||!user?.isGM)&&!source.testUserPermission?.(user,'OWNER')))
   throw Error('Unauthorized unregister');
 const id=source.uuid+':'+payload.key;
 return aoQueue(async()=>{
  await game.settings.set(AO_NS,AO_REG,aoEntries().filter(r=>r.id!==id));
  return {unregistered:true,id};
 });
}
async function aoBind(payload,user,remote=false){
 const source=await fromUuid(payload.actorUuid);
 if(!aoLeader()||source?.documentName!=='Actor'||!aoKey(payload.key)||
   ((remote||!user?.isGM)&&!source.testUserPermission?.(user,'OWNER')))
   throw Error('Unauthorized binding');
 const card=aoMessage(payload.sourceMessageId);
 const info=aoCardSource(card);
 if(!info)throw Error('Native attack card lacks Item/Action provenance');
 const id=source.uuid+':'+payload.key;
 return aoQueue(async()=>{
  const rules=aoEntries(),r=rules.find(x=>x.id===id&&x.state==='pending');
  if(!r||r.actorUuid!==info.actorUuid||r.sourceItemUuid!==info.itemUuid||
    r.sourceActionId!==info.actionId)throw Error('Attack card does not match registration');
  await game.settings.set(AO_NS,AO_REG,rules.map(x=>x.id===id
    ?{...x,sourceMessageId:card.id}:x));
  aoLog('Bound native attack card',{id,messageId:card.id});
  return {bound:true,id,sourceMessageId:card.id};
 });
}
async function aoRequest(op,data){
 if(!aoActive())throw Error('Automation disabled');
 const actor=aoActor(data?.actor);
 if(!actor||(!actor.isOwner&&!game.user.isGM))throw Error('Source ownership required');
 const payload={actorUuid:actor.uuid};
 if(op==='register')payload.data={...data,actor:undefined,actorUuid:actor.uuid};
 else {payload.key=data.key;if(op==='bind')payload.sourceMessageId=data.sourceMessageId;}
 if(aoLeader())return aoOperation(op,payload,game.user,false);
 const leader=aoLeaderUser();if(!leader)throw Error('Connected GM required');
 const requestId=foundry.utils.randomID();
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{AO_PENDING.delete(requestId);reject(Error('Attack outcome GM timeout'))},AO_TIMEOUT);
  AO_PENDING.set(requestId,{resolve,reject,timer,leaderId:leader.id});
  game.socket.emit(AO_SOCKET,{channel:AO_CHANNEL,op,requestId,userId:game.user.id,...payload});
 });
}
function aoOperation(op,payload,user,remote){
 if(op==='register')return aoRegister(payload,user,remote);
 if(op==='unregister')return aoRemove(payload,user,remote);
 if(op==='bind')return aoBind(payload,user,remote);
 throw Error('Unknown attack outcome operation');
}
async function aoSocket(data){
 if(!aoActive()||data?.channel!==AO_CHANNEL||!aoSafe(data.requestId,100))return;
 if(data.op==='ack'){
  const waiting=AO_PENDING.get(data.requestId);
  if(!waiting||data.recipientId!==game.user.id||data.senderId!==waiting.leaderId)return;
  clearTimeout(waiting.timer);AO_PENDING.delete(data.requestId);
  if(data.error)waiting.reject(Error(data.error));else waiting.resolve(data.result);
  return;
 }
 if(!aoLeader()||!['register','unregister','bind'].includes(data.op)||AO_SEEN.has(data.requestId))return;
 AO_SEEN.set(data.requestId,aoNow());if(AO_SEEN.size>1000)AO_SEEN.clear();
 const requester=game.users.get(data.userId);if(!requester?.active)return;
 let result,error;
 try{result=await aoOperation(data.op,data,requester,true)}
 catch(e){error=e.message;console.error('[PF1AE][AttackOutcome] Request rejected',e)}
 game.socket.emit(AO_SOCKET,{channel:AO_CHANNEL,op:'ack',recipientId:requester.id,
  senderId:game.user.id,requestId:data.requestId,result,error});
}
function aoAppContext(app,target,options){
 const extra=app?.extraOptions??{};
 const card=aoMessage(extra.message??options.message??extra.reference);
 const source=aoCardSource(card);
 const index=extra.attackIndex??options.attackIndex;
 const targetActor=aoActor(target?.actor??target)??aoActor(target?.token);
 const attackIndex=Number(index);
 if(!source||!Number.isSafeInteger(attackIndex)||attackIndex<0||!targetActor?.uuid){
   aoLog('Native damage provenance incomplete; automatic outcome refused',{
     messageId:card?.id??null,attackIndex:index,targetUuid:targetActor?.uuid??null});
   return null;
 }
 // app has the actual native Action damage source, not a guessed chat text.
 return {sourceMessageId:card.id,sourceItemUuid:source.itemUuid,
   sourceActionId:source.actionId,actorUuid:source.actorUuid,
   attackIndex,targetUuid:targetActor.uuid};
}

function aoOnApplyOptions(app,target,options){
 if(!aoActive()||!options||typeof options!=='object')return;
 const context=aoAppContext(app,target,options);
 if(!context)return;
 options.pf1aeAttackOutcome=context;
 const actor=aoActor(target?.actor??target)??aoActor(target?.token);
 const attempts=AO_DIALOG_DAMAGE.get(app)??[];
 const record={context,actor,before:aoDamageSnapshot(actor),nativePre:false,
   conflicted:false,requestId:foundry.utils.randomID(),critMult:aoNativeCritMult(options)};
 if(!AO_ACTIVE_DIALOGS.has(app)){
   aoPrepareDirect(record);
   AO_SOURCE_OPTIONS.set(options,record);
   aoLog('Direct native damage options captured (no dialog)',{
     requestId:record.requestId,expected:aoDescribe(context),trackedDialog:false});
   return;
 }
 for(const prior of attempts)if(prior.actor?.uuid===actor?.uuid){
   prior.conflicted=true;record.conflicted=true;
 }
 attempts.push(record);
 AO_DIALOG_DAMAGE.set(app,attempts);
 AO_SOURCE_OPTIONS.set(options,record);
 aoLog('Native damage options annotated',{sourceMessageId:context.sourceMessageId,
   attackIndex:context.attackIndex,targetUuid:context.targetUuid,requestId:record.requestId});
}
function aoOnNativeApplyDamage(actor,options){
 const uuid=actor?.uuid,carried=options?.pf1aeAttackOutcome??null;
 let record=options&&AO_SOURCE_OPTIONS.get(options);
 let matchMethod=record?'same options object':null;
 const recent=(AO_DIRECT_OPTIONS.get(uuid)??[])
   .filter(x=>!x.completed&&aoNow()-x.createdAt<=AO_OPTIONS_WINDOW);
 if(!record&&carried){
  const matches=recent.filter(x=>!aoDifferent(x.context,carried));
  if(matches.length===1){record=matches[0];matchMethod='copied provenance';}
 }
 if(!record&&recent.length===1){
  // PF1 may clone options between the two hooks. Only one immediate,
  // non-conflicting native per-target context is acceptable.
  const candidate=recent[0];
  const card=aoMessage(options?.message??options?.reference);
  const messageId=card?.id??(typeof options?.reference==='string'
    ?options.reference.replace(/^ChatMessage\./,''):null);
  if((messageId&&messageId!==candidate.context.sourceMessageId)||
     (options?.attackIndex!=null&&Number(options.attackIndex)!==candidate.context.attackIndex)||
     (carried&&aoDifferent(candidate.context,carried)))candidate.conflicted=true;
  else if(!candidate.conflicted){record=candidate;matchMethod='unique adjacent native hooks';}
 }
 if(!record){
  aoLog('pf1ApplyDamage without matching card context',{
    expected:recent.map(x=>aoDescribe(x.context)),actual:{
      targetUuid:uuid,sourceMessageId:carried?.sourceMessageId??null,
      attackIndex:options?.attackIndex??carried?.attackIndex??null,
      reference:options?.reference??null},candidateCount:recent.length});
  return;
 }
 if(record.context.targetUuid!==uuid||record.actor?.uuid!==uuid||record.conflicted){
  record.conflicted=true;
  aoLog('pf1ApplyDamage actor/provenance mismatch',{expected:aoDescribe(record.context),
    actual:{targetUuid:uuid,sourceMessageId:carried?.sourceMessageId??null,
      attackIndex:options?.attackIndex??null},matchMethod});
  return;
 }
 const nativeCrit=aoNativeCritMult(options);
 if(record.critMult!=null&&nativeCrit!=null&&record.critMult!==nativeCrit){
  record.conflicted=true;
  aoLog('Conflicting native critical multiplier',{requestId:record.requestId});return;
 }
 if(nativeCrit!=null)record.critMult=nativeCrit;
 record.nativePre=true;
 record.nativeEvidence=aoOffsetEvidence(options);
 aoLog('pf1ApplyDamage received',{requestId:record.requestId,matchMethod,
    expected:aoDescribe(record.context),actual:{targetUuid:uuid},
    nativeEvidence:record.nativeEvidence});
 if(record.createdAt){
  const previous=AO_DIRECT_PENDING.get(uuid);
  if(previous&&previous!==record){
    previous.conflicted=true;record.conflicted=true;
    aoLog('Overlapping native damage applications; refused',{
      first:aoDescribe(previous.context),second:aoDescribe(record.context)});
  }else AO_DIRECT_PENDING.set(uuid,record);
 }
}

async function aoFinishNativeDialog(app,completed){
 const attempts=AO_DIALOG_DAMAGE.get(app)??[];
 AO_DIALOG_DAMAGE.delete(app);
 if(!completed){
   aoLog('Native damage dialog cancelled/failed; no outcome',{attempts:attempts.length});return;
 }
 for(const record of attempts){
   const {context,actor,before}=record;
   if(!record.nativePre||record.conflicted||!actor||actor.uuid!==context.targetUuid){
     aoLog('Damage unverified; outcome refused',{sourceMessageId:context.sourceMessageId,
       targetUuid:context.targetUuid,nativePre:record.nativePre,conflicted:record.conflicted});
     continue;
   }
   const delta=aoDamageDelta(before,aoDamageSnapshot(actor));
   aoLog('Native damage dialog completed',{sourceMessageId:context.sourceMessageId,
     attackIndex:context.attackIndex,targetUuid:actor.uuid,delta});
   if(!delta.provenDamage)continue;
   const payload={channel:AO_CHANNEL,op:'damage',requestId:record.requestId,userId:game.user.id,
     context:{...context,delta,evidence:aoDamageEvidence(record,aoDamageSnapshot(actor))},targetUuid:actor.uuid};
   if(aoLeader())await aoResolveDamage(payload);
   else game.socket.emit(AO_SOCKET,payload);
 }
}
/**
 * PF1's ActorPF.prototype.applyDamage is a NON-CONFIGURABLE accessor in v11.11.
 * Do not invoke its setter or replace it. Observe the native ApplyDamage
 * dialogue's completion and corroborate both native provenance hooks instead.
 */
function aoInstallDamageBridge(){
 if(aoInstalled)return;
 aoInstalled=true;
 Hooks.on('pf1ApplyDamageTargetOptions',aoOnApplyOptions);
 Hooks.on('pf1ApplyDamage',aoOnNativeApplyDamage);
 Hooks.on('updateActor',aoAfterNativeActorUpdate);
 const klass=globalThis.pf1?.applications?.ApplyDamage;
 const staticDesc=klass&&Object.getOwnPropertyDescriptor(klass,'_onApply');
 const protoDesc=klass?.prototype&&Object.getOwnPropertyDescriptor(klass.prototype,'_onApply');
 const holder=typeof staticDesc?.value==='function'&&staticDesc.writable?klass:
   typeof protoDesc?.value==='function'&&protoDesc.writable?klass.prototype:null;
 if(!holder){
   console.warn('[PF1AE][AttackOutcome] ApplyDamage._onApply unavailable; native hooks and updateActor fallback remain installed; ActorPF.applyDamage untouched.');
   aoLog('Installed native damage bridge',{hooks:['pf1ApplyDamageTargetOptions','pf1ApplyDamage','updateActor'],completion:'verified actor-update fallback',actorAccessor:'untouched'});
   return;
 }
 const original=holder._onApply;
 if(original?.pf1aeAttackDialogWrapped)return;
 const wrapper=async function(...args){
   const app=this;
   if(!app||typeof app!=='object')return original.apply(this,args);
   AO_ACTIVE_DIALOGS.add(app);
   let completed=false;
   try{
     const result=await original.apply(this,args);
     completed=true;return result;
   }finally{
     AO_ACTIVE_DIALOGS.delete(app);
     try{await aoFinishNativeDialog(app,completed)}
     catch(error){console.error('[PF1AE][AttackOutcome] Native damage completion bridge failed',error)}
   }
 };
 wrapper.pf1aeAttackDialogWrapped=true;
 holder._onApply=wrapper;
 aoLog('Installed native damage bridge',{hooks:['pf1ApplyDamageTargetOptions','pf1ApplyDamage'],
   completion:'ApplyDamage._onApply plus native actor-update fallback',actorAccessor:'untouched',static:holder===klass});
}
async function aoResolveDamage(data){
 if(!aoLeader()||!aoActive())return {processed:false,reason:'not elected GM'};
 const c=data.context,card=aoMessage(c?.sourceMessageId),info=aoCardSource(card);
 if(!info||info.itemUuid!==c.sourceItemUuid||info.actionId!==c.sourceActionId||
    info.actorUuid!==c.actorUuid||!aoSafe(data.targetUuid)||
    c.targetUuid!==data.targetUuid||!Number.isSafeInteger(c.attackIndex)||
    !c.delta?.provenDamage)
    return {processed:false,reason:'invalid proven native damage context'};
 const sender=game.users.get(data.userId);
 if(!sender?.active||!sender.isGM) {
    console.warn('[PF1AE][AttackOutcome] Non-GM damage attestation cannot be verified on the leader; review required');
    return {processed:false,reason:'GM-authoritative damage attestation required',requiresGM:true};
  }
 // Corroborated native damage also feeds class-neutral Item subscriptions.
 // No additional low-level PF1 damage hooks are installed.
 Hooks.callAll?.('pf1aeVerifiedDamage',{requestId:data.requestId,
   sourceUserId:data.userId,context:{...c,sourceMessageId:card.id},
   targetUuid:data.targetUuid});
 return aoQueue(async()=>{
  const entries=aoEntries();
  const matches=entries.filter(r=>aoSourceMatches(r,info,card,c.attackIndex,data.targetUuid)&&r.expiresAt>aoNow());
  if(matches.length!==1){
    aoLog('No unique pending attack; skipped',{messageId:card.id,count:matches.length});
    return {processed:false,reason:'ambiguous or unregistered attack'};
  }
  const rule=matches[0];
  // Re-check ownership and the Item's actual Action on the leader.
  const source=await fromUuid(rule.actorUuid),trigger=await fromUuid(rule.onDamageApplied.itemUuid);
  if(source?.documentName!=='Actor'||trigger?.documentName!=='Item'||
     (trigger.actor??trigger.parent)?.uuid!==source.uuid||
     !aoActions(trigger).some(a=>aoActionId(a)===rule.onDamageApplied.actionId))
    return {processed:false,reason:'trigger no longer valid'};
  const next=entries.map(r=>r.id===rule.id?{...r,state:'triggering',
    sourceMessageId:card.id,damageTargetUuid:data.targetUuid,triggeredAt:aoNow()}:r);
  await game.settings.set(AO_NS,AO_REG,next);
  try{
    const so=rule.onDamageApplied.saveOutcome;
    if(so){
      // Preserve the complete declarative rule. Never trust a client-
      // supplied Actor or target in place of the GM-verified damage target.
      const result=await game.modules.get(AO_NS)?.api?.saveOutcomes?.register({
        ...so,actor:source,targets:[data.targetUuid]
      });
      if(!result?.registered)throw Error('SaveOutcome registration rejected');
    }
    // The triggering Action must be separate from the attack Action.
    if(trigger.uuid===rule.sourceItemUuid && rule.onDamageApplied.actionId===rule.sourceActionId)
      throw Error('Triggering the original attack Action is prohibited');
    if(typeof trigger.use!=='function')throw Error('PF1 Item.use unavailable');
    await trigger.use({actionId:rule.onDamageApplied.actionId,cost:0,chatMessage:true});
    await game.settings.set(AO_NS,AO_REG,aoEntries().map(r=>r.id===rule.id
      ?{...r,state:'done',completedAt:aoNow()}:r));
    aoLog('Triggered source-specific follow-up Action',{ruleId:rule.id,
      targetUuid:data.targetUuid,sourceMessageId:card.id});
    return {processed:true,triggered:true,id:rule.id};
  }catch(error){
    // Fail closed: keep the claim instead of repeating a potentially published
    // PF1 action, and surface explicit GM repair instructions.
    console.error('[PF1AE][AttackOutcome] Trigger failed; pending GM review',error);
    await game.settings.set(AO_NS,AO_REG,aoEntries().map(r=>r.id===rule.id
      ?{...r,state:'needsReview',reason:error.message}:r));
    return {processed:false,reason:error.message,requiresGM:true};
  }
 });
}
async function aoClean(){
 if(!aoLeader()||!aoActive())return;
 return aoQueue(async()=>{
  const entries=aoEntries(),threshold=aoNow();
  const next=entries.filter(r=>r.state==='needsReview'||
    (r.state==='pending'&&r.expiresAt>threshold)||
    (r.state==='done'&&r.completedAt>threshold-86400000)||
    (r.state==='triggering'&&r.triggeredAt>threshold-86400000));
  if(next.length!==entries.length)await game.settings.set(AO_NS,AO_REG,next);
 });
}
Hooks.once('init',()=>{
 game.settings.register(AO_NS,AO_REG,{scope:'world',config:false,type:Array,default:[]});
});
Hooks.once('ready',()=>{
 const mod=game.modules.get(AO_NS);if(!mod)return;
 mod.api??={};
 mod.api.attackOutcomes=Object.freeze({
   register:data=>aoRequest('register',data),
   unregister:data=>aoRequest('unregister',data),
   bindAttack:data=>aoRequest('bind',data),
   list:()=>aoClone(aoEntries()),
   _resolveDamage:aoResolveDamage // Elected GM internal; never called from Script Calls
 });
 game.socket.on(AO_SOCKET,data=>{
   if(data?.channel!==AO_CHANNEL)return;
   if(data.op==='damage'){
     if(aoLeader())void aoResolveDamage(data).catch(e=>console.error('[PF1AE][AttackOutcome] Damage dispatch failed',e));
   }else void aoSocket(data);
 });
 aoInstallDamageBridge();
 void aoClean();
});