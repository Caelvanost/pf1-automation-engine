/**
 * PF1 Automation Engine — Attack Outcomes (v1.14.0).
 * Fail-closed tracking for source-specific attacks whose damage is manually
 * applied from PF1's native ApplyDamage dialog. Only the elected GM mutates
 * the persistent registry or executes a subsequent PF1 ItemAction.
 *
 * Important: pf1ApplyDamage is PRE-application. We observe the *returned*
 * ActorPF.applyDamage promise and actual HP/nonlethal changes instead.
 * Damage source is established by the native dialog's structured message and
 * attack index (pf1ApplyDamageTargetOptions), never by an arbitrary HP update.
 */
const AO_NS='pf1-automation-engine';
const AO_REG='attackOutcomeRegistry';
const AO_SOCKET='module.'+AO_NS;
const AO_CHANNEL='pf1ae-attack-outcomes-v1';
const AO_PENDING=new Map();
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
  if(typeof sc!=='object'||sc.sourceItemUuid!==trigger.uuid||
     sc.sourceActionId!==on.actionId||!aoKey(sc.key)||!aoKey(sc.groupKey)||
     sc.onFailure?.type!=='linkedBuff'||!Array.isArray(sc.targets)||
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
 // PF1's hook is fired just before options are passed to ActorPF.applyDamage.
 // Preserve the existing options and attach provenance for the wrapping client.
 options.pf1aeAttackOutcome=context;
 aoLog('Native damage options annotated',{
   sourceMessageId:context.sourceMessageId,attackIndex:context.attackIndex,
   targetUuid:context.targetUuid});
}
function aoInstallDamageBridge(){
 if(aoInstalled)return;
 aoInstalled=true;
 Hooks.on('pf1ApplyDamageTargetOptions',aoOnApplyOptions);
 // CONFIG.Actor.documentClass is PF1's installed actor class. Do not replace
 // system files; wrap its method once and preserve original return semantics.
 const prototype=CONFIG.Actor?.documentClass?.prototype;
 const original=prototype?.applyDamage;
 if(typeof original!=='function'){
   console.warn('[PF1AE][AttackOutcome] ActorPF.applyDamage unavailable; native bridge disabled');
   return;
 }
 if(original.pf1aeAttackOutcomeWrapped)return;
 async function wrappedApplyDamage(value,options={}){
   const context=options?.pf1aeAttackOutcome??null;
   const before=context?aoDamageSnapshot(this):null;
   const result=await original.call(this,value,options);
   if(context && aoActive()&&result!==false){
     const delta=aoDamageDelta(before,aoDamageSnapshot(this));
     aoLog('Damage applied',{actorUuid:this.uuid,sourceMessageId:context.sourceMessageId,
       value,delta});
     // Provenance is part of native PF1 ApplyDamage options, not a chat-text
     // or a coincidental health update.
     if(delta.provenDamage&&this.uuid===context.targetUuid){
       // A player may apply damage; delivery is performed by the GM leader.
       const requestId=foundry.utils.randomID();
       const msg={channel:AO_CHANNEL,op:'damage',requestId,userId:game.user.id,
         context:{...context,delta},targetUuid:this.uuid};
       if(aoLeader())void aoResolveDamage(msg).catch(e=>console.error('[PF1AE][AttackOutcome] Resolve failure',e));
       else game.socket.emit(AO_SOCKET,msg);
     }
   }
   return result;
 }
 wrappedApplyDamage.pf1aeAttackOutcomeWrapped=true;
 prototype.applyDamage=wrappedApplyDamage;
 aoLog('Installed native damage bridge',{hook:'pf1ApplyDamageTargetOptions',method:'ActorPF.applyDamage'});
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
      const result=await game.modules.get(AO_NS)?.api?.saveOutcomes?.register({
        actor:source,key:so.key,groupKey:so.groupKey,
        sourceItemUuid:so.sourceItemUuid,sourceActionId:so.sourceActionId,
        targets:[data.targetUuid],onFailure:so.onFailure
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