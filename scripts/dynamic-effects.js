/** PF1AE v1.16 — GM-authorized declarative native PF1 buffs. */
const FX_NS='pf1-automation-engine';
const FX_REG='dynamicEffectApprovals',FX_SOCKET='module.'+FX_NS,FX_CHANNEL='pf1ae-dynamic-effects-v1';
const FX_PENDING=new Map(),FX_SEEN=new Set(),FX_KEYS=/^[a-zA-Z0-9_-]{1,80}$/;
const FX_TARGETS=new Set(['ac','tac','ffac','mattack','rattack','nattack','fort','ref','will',
'str','dex','con','int','wis','cha','landSpeed','damage','wdamage']);
const FX_MODIFIERS=new Set(['penalty','untyped','dodge','deflection','enh','morale','luck','sacred',
'profane','insight','competence','circumstance','resist']);
const fxLeader=()=>[...game.users].filter(u=>u.active&&u.isGM).sort((a,b)=>a.id.localeCompare(b.id))[0]?.id===game.user.id;
const fxEnabled=()=>game.modules.get(FX_NS)?.active&&game.settings.get(FX_NS,'genericEnabled');
const fxRead=()=>game.settings.get(FX_NS,FX_REG)??{};
function fxSafeId(x,max=400){return typeof x==='string'&&x.length>0&&x.length<=max;}
function fxActor(x){return x?.documentName==='Actor'?x:x?.actor??null;}
function fxActions(item){const a=item?.actions??item?.system?.actions;return a?.values?[...a.values()]:Array.isArray(a)?a:Object.values(a??{});}
function fxValidateChanges(changes){
 if(!Array.isArray(changes)||changes.length<1||changes.length>12)throw Error('1–12 mechanical changes required.');
 return changes.map(c=>{
  if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['target','modifier','value'].includes(k)))
   throw Error('Dynamic changes allow only target, modifier and value.');
  if(!FX_TARGETS.has(c.target)||!FX_MODIFIERS.has(c.modifier))throw Error('PF1 change target/modifier is not allowlisted.');
  const native=globalThis.pf1?.config?.buffTargets??globalThis.CONFIG?.PF1?.buffTargets;
  if(!native||!Object.hasOwn(native,c.target))throw Error('Unsupported native PF1 target: '+c.target);
  if(native[c.target].untyped&&c.modifier!=='untyped')throw Error('PF1 target requires untyped modifier: '+c.target);
  if(native[c.target].types?.exclude?.includes(c.modifier))throw Error('PF1 modifier excluded on '+c.target);
  if(typeof c.value!=='number'||!Number.isFinite(c.value)||Math.abs(c.value)>100||!Number.isSafeInteger(c.value))
    throw Error('Finite integer mechanical value in [-100,100] required.');
  if(c.modifier==='penalty'&&c.value>0)throw Error('A penalty cannot be positive.');
  if(c.modifier!=='penalty'&&c.value<0)throw Error('Negative values must use penalty modifier.');
  return {target:c.target,modifier:c.modifier,value:c.value};
 });
}
function fxFingerprint(item,actionId){
 const a=fxActions(item).find(x=>(x.id??x._id)===actionId);
 if(!a)throw Error('Specified native PF1 source Action does not exist.');
 return JSON.stringify({itemUuid:item.uuid,actionId,action:a.toObject?.()??a});
}
async function fxCheck(data){
 if(!fxEnabled()||!fxLeader())throw Error('Elected GM is required.');
 if(!FX_KEYS.test(data?.approvalKey??''))throw Error('Approval key required.');
 const source=await fromUuid(data.sourceUuid),item=await fromUuid(data.sourceItemUuid);
 if(source?.documentName!=='Actor'||item?.documentName!=='Item'||(item.actor??item.parent)?.uuid!==source.uuid)
  throw Error('Invalid source Item/Actor binding.');
 const fingerprint=fxFingerprint(item,data.sourceActionId);
 return {source,item,fingerprint};
}
async function fxAuthorize(data){
 const {fingerprint}=await fxCheck(data),record=fxRead()[data.sourceUuid+':'+data.approvalKey];
 if(!record||record.sourceItemUuid!==data.sourceItemUuid||record.sourceActionId!==data.sourceActionId||
    record.fingerprint!==fingerprint||!record.channels.includes(data.channel??'direct'))
  throw Error('Unapproved or modified PF1 source Action.');
 const changes=fxValidateChanges(data.changes);
 for(const c of changes)
  if(!record.allowed.some(a=>a.target===c.target&&a.modifier===c.modifier&&Math.abs(c.value)<=a.maxAbs))
   throw Error('Mechanical change exceeds GM authorization.');
 return {authorized:true,changes};
}
async function fxApprove(data){
 if(!fxLeader()||!game.user.isGM)throw Error('GM-only approval.');
 const sourceUuid=data?.actor?.uuid??data?.sourceUuid;
 const {fingerprint}=await fxCheck({...data,sourceUuid});
 const channels=data.channels??['direct','save'];
 if(!Array.isArray(channels)||!channels.length||channels.some(c=>!['direct','save'].includes(c)))
  throw Error('Invalid approval channels.');
 if(!Array.isArray(data.allowed)||!data.allowed.length||data.allowed.length>12)throw Error('An explicit allowlist is required.');
 const allowed=data.allowed.map(a=>{
  if(!a||Object.keys(a).some(k=>!['target','modifier','maxAbs'].includes(k))||
     !FX_TARGETS.has(a.target)||!FX_MODIFIERS.has(a.modifier)||
     !Number.isSafeInteger(a.maxAbs)||a.maxAbs<0||a.maxAbs>100)throw Error('Invalid approval limit.');
  fxValidateChanges([{target:a.target,modifier:a.modifier,value:a.modifier==='penalty'?-a.maxAbs:a.maxAbs}]);
  return {target:a.target,modifier:a.modifier,maxAbs:a.maxAbs};
 });
 const key=sourceUuid+':'+data.approvalKey;
 await game.settings.set(FX_NS,FX_REG,{...fxRead(),[key]:{
  sourceUuid,sourceItemUuid:data.sourceItemUuid,sourceActionId:data.sourceActionId,
  fingerprint,channels:[...new Set(channels)],allowed}});
 return {approved:true,key};
}
async function fxRevoke({actor,approvalKey}){
 if(!fxLeader()||!game.user.isGM)throw Error('GM-only revoke.');
 const key=actor?.uuid+':'+approvalKey,records={...fxRead()};delete records[key];
 await game.settings.set(FX_NS,FX_REG,records);return {revoked:true};
}
async function fxApplyOnGM(data,requester){
 if(!fxLeader())throw Error('Elected GM required.');
 const {source}=await fxCheck(data);
 if(!requester?.active||(!requester.isGM&&!source.testUserPermission?.(requester,'OWNER')))
  throw Error('Source Actor OWNER permission required.');
 const {changes}=await fxAuthorize({...data,channel:'direct'});
 // Player-originating requests additionally require the exact PF1 source card.
 // A self-declared socket userId alone does not authenticate the sender.
 if(!requester.isGM){
  const card=game.messages?.get(data.sourceMessageId);
  const cardItem=card?.itemSource?.uuid??card?.item?.uuid;
  const cardAction=card?.actionSource?.id??card?.action?.id;
  if(!fxSafeId(data.sourceMessageId,100)||!card||cardItem!==data.sourceItemUuid||cardAction!==data.sourceActionId)
   throw Error('Native PF1 source Action card required for player direct effects.');
 }
 if(!Array.isArray(data.targets)||!data.targets.length||data.targets.length>30)throw Error('1–30 target UUIDs required.');
 if(!fxSafeId(data.requestId,100))throw Error('requestId required for idempotency.');
 const out=[];
 for(const targetUuid of [...new Set(data.targets)]){
  const target=await fromUuid(targetUuid);
  if(target?.documentName!=='Actor')throw Error('Unknown target Actor '+targetUuid);
  const result=await game.modules.get(FX_NS).api.effectGroups._createDynamicOutcome({
   sourceUuid:source.uuid,sourceItemUuid:data.sourceItemUuid,sourceActionId:data.sourceActionId,
   approvalKey:data.approvalKey,channel:'direct',targetUuid:target.uuid,key:data.approvalKey,
   outcomeId:data.requestId+':'+target.uuid,ruleId:data.approvalKey,
   name:data.effect.name,img:data.effect.img,changes,
   duration:data.effect.duration,stacking:data.effect.stacking});
  out.push({targetUuid:target.uuid,...result});
 }
 return {processed:true,results:out};
}
async function fxApply(data){
 if(!fxEnabled())throw Error('PF1 Automation Engine disabled.');
 const actor=fxActor(data?.actor);
 if(!actor||(!actor.isOwner&&!game.user.isGM))throw Error('Source Actor ownership required.');
 const targets=(data.targets??[]).map(t=>typeof t==='string'?t:t?.uuid);
 const changes=fxValidateChanges(data.effect?.changes),requestId=data.requestId??foundry.utils.randomID();
 const payload={sourceUuid:actor.uuid,sourceItemUuid:data.sourceItemUuid,
  sourceActionId:data.sourceActionId,approvalKey:data.approvalKey,targets,
  sourceMessageId:data.sourceMessageId??null,
  effect:{name:data.effect.name,img:data.effect.img,duration:data.effect.duration,
    stacking:data.effect.stacking},changes,requestId};
 if(fxLeader())return fxApplyOnGM(payload,game.user);
 const leader=[...game.users].filter(x=>x.active&&x.isGM).sort((a,b)=>a.id.localeCompare(b.id))[0];
 if(!leader)throw Error('Active GM required.');
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{FX_PENDING.delete(requestId);reject(Error('Dynamic effect GM request timeout.'));},12000);
  FX_PENDING.set(requestId,{timer,resolve,reject,leaderId:leader.id});
  game.socket.emit(FX_SOCKET,{channel:FX_CHANNEL,op:'apply',userId:game.user.id,...payload});
 });
}
async function fxSocket(data){
 if(!fxEnabled()||data?.channel!==FX_CHANNEL||!fxSafeId(data.requestId,100))return;
 if(data.op==='ack'){
  const p=FX_PENDING.get(data.requestId);
  if(!p||data.recipientId!==game.user.id||data.senderId!==p.leaderId)return;
  clearTimeout(p.timer);FX_PENDING.delete(data.requestId);
  if(data.error)p.reject(Error(data.error));else p.resolve(data.result);return;
 }
 if(!fxLeader()||data.op!=='apply'||FX_SEEN.has(data.requestId))return;
 FX_SEEN.add(data.requestId);if(FX_SEEN.size>2000)FX_SEEN.clear();
 const requester=game.users.get(data.userId);
 if(!requester?.active)return;
 let result,error;
 try{result=await fxApplyOnGM(data,requester)}
 catch(e){error=e.message;console.warn('[PF1AE][Effects] Rejected:',error);}
 game.socket.emit(FX_SOCKET,{channel:FX_CHANNEL,op:'ack',requestId:data.requestId,
  recipientId:requester.id,senderId:game.user.id,result,error});
}
Hooks.once('init',()=>game.settings.register(FX_NS,FX_REG,{scope:'world',config:false,type:Object,default:{}}));
Hooks.once('ready',()=>{
 const mod=game.modules.get(FX_NS);mod.api??={};
 mod.api.effects=Object.freeze({approve:fxApprove,revoke:fxRevoke,apply:fxApply,
  listApprovals:()=>foundry.utils.deepClone(fxRead()),
  _authorize:fxAuthorize,_validateChanges:fxValidateChanges});
 game.socket.on(FX_SOCKET,data=>{if(data?.channel===FX_CHANNEL)void fxSocket(data)});
});
