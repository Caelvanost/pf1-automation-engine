/**
 * PF1 Automation Engine — persistent, source/action-bound saving throw outcomes.
 * Foundry v13 / PF1 11.11. GM-only resolver; never rolls any dice.
 * Separate from saveOverrides: this service only consumes its final result.
 */
const OUT_NS='pf1-automation-engine';
const OUT_REG='saveOutcomeRegistry';
const OUT_SOCKET='module.'+OUT_NS;
const OUT_CHANNEL='pf1ae-save-outcomes-v1';
const OUT_KEYS=/^[A-Za-z0-9_-]{1,80}$/;
const OUT_SEEN=new Set();
const OUT_PENDING=new Map();
let outTail=Promise.resolve();
const outEnabled=()=>game.modules.get(OUT_NS)?.active &&
  !game.modules.get('pf1-combat-automation')?.active && game.settings.get(OUT_NS,'genericEnabled');
const outLeader=()=>[...game.users].filter(x=>x.active&&x.isGM)
  .sort((a,b)=>a.id.localeCompare(b.id))[0]?.id===game.user.id;
const outLog=(event,details={})=>{
  if(game.settings.get(OUT_NS,'genericDebug'))console.debug('[PF1AE][SaveOutcome] '+event,details);
};
const outLedger=()=>game.settings.get(OUT_NS,OUT_REG)??[];
const outQueue=fn=>{
  const next=outTail.catch(()=>{}).then(fn);
  outTail=next.catch(()=>{});
  return next;
};
const outStr=(value,max=400)=>typeof value==='string' && value.length>0 && value.length<=max;
const outClone=value=>foundry.utils.deepClone(value);
function outActor(value){return value?.documentName==='Actor'?value:value?.actor??null;}
function outRuleId(actor,key){return actor+':'+key;}
function outActions(item){
  const actions=item?.system?.actions;
  if(!actions)return [];
  if(typeof actions.values==='function')return [...actions.values()];
  if(Array.isArray(actions))return actions;
  return Object.entries(actions).map(([key,value])=>({...value,id:value?.id??key}));
}
async function outValidate(payload,requester,remote=false){
  if(!outEnabled()||!outLeader())throw Error('Elected GM required.');
  const data=payload?.rule;
  if(!data || !OUT_KEYS.test(data.key??'') || !OUT_KEYS.test(data.groupKey??''))
    throw Error('Invalid save outcome key or groupKey.');
  const actor=await fromUuid(payload.actorUuid);
  if(actor?.documentName!=='Actor')throw Error('Source Actor not found.');
  if((remote||!requester?.isGM) && !actor.testUserPermission?.(requester,'OWNER'))
    throw Error('Requester does not own source Actor.');
  if(!outStr(data.sourceItemUuid) || !Array.isArray(data.targets) ||
      !data.targets.length || data.targets.length>30 ||
      !data.targets.every(x=>outStr(x)))throw Error('Source Item and 1–30 target Actor UUIDs required.');
  const item=await fromUuid(data.sourceItemUuid);
  if(item?.documentName!=='Item' || (item.actor??item.parent)?.uuid!==actor.uuid)
    throw Error('Source Item must belong to the registering Actor.');
  const actions=outActions(item);
  const actionId=data.sourceActionId??(actions.length===1?actions[0]?.id:null);
  if(!outStr(actionId,100) || !actions.some(x=>x.id===actionId))
    throw Error('A valid sourceActionId is required (unless Item has exactly one Action).');
  if(data.onFailure?.type!=='linkedBuff' ||
      !outStr(data.onFailure.name,120) || !outStr(data.onFailure.img,500))
    throw Error('onFailure must specify linkedBuff with name and img.');
  if(data.onSuccess!==undefined)throw Error('onSuccess is not implemented in this version.');
  if(data.onFailure.statusId!==undefined && data.onFailure.statusId!=='fascinated')
    throw Error('Only opt-in official fascinated status is supported.');
  const targets=[...new Set(data.targets)];
  for(const uuid of targets){
    const t=await fromUuid(uuid);
    if(t?.documentName!=='Actor')throw Error('Target must be a valid Actor UUID: '+uuid);
  }
  // An optional groupId binds the registration to a particular performance;
  // without it, the exact source Actor/group key is checked live on every save.
  if(data.groupId!==undefined && !outStr(data.groupId,100))throw Error('Invalid groupId.');
  if(data.sourceMessageId!==undefined && !outStr(data.sourceMessageId,100))
    throw Error('Invalid sourceMessageId.');
  return {
    id:outRuleId(actor.uuid,data.key),key:data.key,
    actorUuid:actor.uuid,groupKey:data.groupKey,
    groupId:data.groupId??null,
    sourceMessageId:data.sourceMessageId??null,
    sourceItemUuid:item.uuid,sourceActionId:actionId,
    targets,onFailure:{type:'linkedBuff',name:data.onFailure.name,img:data.onFailure.img,
      ...(data.onFailure.statusId?{statusId:data.onFailure.statusId}:{})}
  };
}
async function outRegister(payload,requester,remote=false){
  const rule=await outValidate(payload,requester,remote);
  return outQueue(async()=>{
    const list=outLedger();
    if(list.filter(x=>x.actorUuid===rule.actorUuid&&x.id!==rule.id).length>=50)
      throw Error('Maximum 50 outcome rules per Actor.');
    await game.settings.set(OUT_NS,OUT_REG,[...list.filter(x=>x.id!==rule.id),rule]);
    outLog('Registered',{id:rule.id,sourceItemUuid:rule.sourceItemUuid,
      sourceActionId:rule.sourceActionId,targets:rule.targets});
    return {registered:true,id:rule.id};
  });
}
async function outUnregister(payload,requester,remote=false){
  const actor=await fromUuid(payload.actorUuid);
  if(!outLeader()||!outEnabled()||actor?.documentName!=='Actor'||!OUT_KEYS.test(payload.key??''))
    throw Error('Invalid unregister request.');
  if((remote||!requester?.isGM) && !actor.testUserPermission?.(requester,'OWNER'))
    throw Error('Requester does not own source Actor.');
  const id=outRuleId(actor.uuid,payload.key);
  return outQueue(async()=>{
    await game.settings.set(OUT_NS,OUT_REG,outLedger().filter(r=>r.id!==id));
    outLog('Unregistered',{id});
    return {unregistered:true,id};
  });
}
async function outSend(op,data){
  if(!outEnabled())throw Error('Automation Engine disabled.');
  const actor=data?.actor;
  if(actor?.documentName!=='Actor'||(!actor.isOwner&&!game.user.isGM))
    throw Error('Source Actor ownership required.');
  const payload={actorUuid:actor.uuid};
  if(op==='register')payload.rule={...data,actor:undefined};
  else payload.key=data.key;
  if(outLeader())return op==='register'
    ?outRegister(payload,game.user):outUnregister(payload,game.user);
  const leader=[...game.users].filter(x=>x.active&&x.isGM)
    .sort((a,b)=>a.id.localeCompare(b.id))[0];
  if(!leader)throw Error('Active GM required.');
  const requestId=foundry.utils.randomID();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      OUT_PENDING.delete(requestId);
      reject(Error('SaveOutcome registration timed out waiting for the elected GM.'));
    },10000);
    OUT_PENDING.set(requestId,{resolve,reject,timer,leaderId:leader.id});
    game.socket.emit(OUT_SOCKET,{channel:OUT_CHANNEL,userId:game.user.id,
      op,requestId,...payload});
  });
}
async function outSocket(data){
  if(!outEnabled()||data?.channel!==OUT_CHANNEL||!outStr(data.requestId,100))return;
  if(data.op==='ack'){
    const pending=OUT_PENDING.get(data.requestId);
    if(!pending || data.recipientId!==game.user.id ||
        data.senderId!==pending.leaderId)return;
    clearTimeout(pending.timer);
    OUT_PENDING.delete(data.requestId);
    if(data.error)pending.reject(Error(String(data.error)));
    else pending.resolve(data.result??null);
    return;
  }
  if(!outLeader()||!['register','unregister'].includes(data.op)||
      OUT_SEEN.has(data.requestId))return;
  OUT_SEEN.add(data.requestId);
  if(OUT_SEEN.size>2000)OUT_SEEN.clear();
  const requester=game.users.get(data.userId);
  if(!requester?.active)return;
  let result=null,error=null;
  try{
    result=data.op==='register'
      ?await outRegister(data,requester,true)
      :await outUnregister(data,requester,true);
  }catch(err){
    error=err.message;
    console.error('[PF1AE][SaveOutcome] Socket request rejected',err);
  }
  game.socket.emit(OUT_SOCKET,{channel:OUT_CHANNEL,op:'ack',
    requestId:data.requestId,recipientId:requester.id,
    senderId:game.user.id,result,error});
}
/** Called from effectGroups after the parent is removed or expires. */
async function outGroupRemoved(actorUuid,groupKey){
  if(!outLeader())return;
  return outQueue(async()=>{
    const old=outLedger();
    const next=old.filter(r=>r.actorUuid!==actorUuid||r.groupKey!==groupKey);
    if(next.length!==old.length){
      await game.settings.set(OUT_NS,OUT_REG,next);
      outLog('Removing linked rules',{actorUuid,groupKey,removed:old.length-next.length});
    }
  });
}
/** No roll and no re-evaluation of spell DC. Call only from the GM resolver. */
async function outResolved(event){
  if(!outEnabled()||!outLeader())return;
  if(!event || !outStr(event.saveMessageId,100) ||
      !outStr(event.sourceMessageId,100) ||
      !outStr(event.sourceItemUuid) || !outStr(event.sourceActionId,100) ||
      !outStr(event.targetActorUuid) ||
      !Number.isFinite(event.normalTotal) ||
      !Number.isFinite(event.effectiveTotal) || !Number.isFinite(event.saveDC)){
    outLog('Skipped: incomplete or untrusted action/save/DC context',event);
    return {processed:false,reason:'incomplete context'};
  }
  const message=game.messages?.get(event.saveMessageId);
  const card=game.messages?.get(event.sourceMessageId);
  const target=await fromUuid(event.targetActorUuid);
  if(!message||!card||target?.documentName!=='Actor')return {processed:false,reason:'missing documents'};
  const cardContext=game.modules.get(OUT_NS)?.api?.saveContext?.fromMessage(card);
  if(!cardContext || cardContext.sourceItemUuid!==event.sourceItemUuid ||
      cardContext.sourceActionId!==event.sourceActionId ||
      cardContext.saveDC!==event.saveDC) {
    outLog('Skipped: source Action context mismatch',{saveMessageId:message.id});
    return {processed:false,reason:'source mismatch'};
  }
  const success=event.effectiveTotal>=event.saveDC;
  outLog('Save completed',{source:card.itemSource?.name??event.sourceItemUuid,
    action:event.sourceActionId,target:target.name,DC:event.saveDC,
    normal:event.normalTotal,effective:event.effectiveTotal,
    outcome:success?'SUCCESS':'FAILURE'});
  const rules=outLedger().filter(r=>r.sourceItemUuid===event.sourceItemUuid &&
    r.sourceActionId===event.sourceActionId &&
    (!r.sourceMessageId||r.sourceMessageId===card.id) &&
    r.targets.includes(target.uuid));
  if(!rules.length)return {processed:false,reason:'no matching rule'};
  const result=[];
  for(const rule of rules){
    const groups=game.modules.get(OUT_NS)?.api?.effectGroups?.listGroups?.()??[];
    const group=groups.find(g=>g.sourceUuid===rule.actorUuid&&g.key===rule.groupKey&&
      !g.pendingCleanup&&(!rule.groupId||g.id===rule.groupId));
    if(!group){outLog('Skipped: parent group inactive',{rule:rule.key});continue;}
    const prior=message.getFlag?.(OUT_NS,'saveOutcomes')??{};
    if(prior[rule.id]?.processed){
      result.push({...prior[rule.id],duplicate:true});continue;
    }
    if(success){
      const record={processed:true,success:true,ruleId:rule.id};
      await message.setFlag(OUT_NS,'saveOutcomes',{...prior,[rule.id]:record});
      outLog('No failure effect applied',{rule:rule.key,target:target.name});
      result.push(record);continue;
    }
    outLog('Rule matched: '+rule.key,{groupId:group.id,target:target.name});
    const applied=await game.modules.get(OUT_NS)?.api?.effectGroups?._createLinkedOutcome?.({
      sourceUuid:rule.actorUuid,groupId:group.id,key:rule.groupKey,
      targetUuid:target.uuid,sourceItemUuid:rule.sourceItemUuid,
      sourceActionId:rule.sourceActionId,
      outcomeId:event.saveMessageId+':'+rule.id,ruleId:rule.id,
      effect:{label:rule.onFailure.name,img:rule.onFailure.img,
        statusId:rule.onFailure.statusId??null}
    });
    if(!applied?.applied){
      outLog('Effect not applied',{rule:rule.key,reason:applied?.reason??'unknown'});
      continue;
    }
    const record={processed:true,success:false,ruleId:rule.id,
      effectUuid:applied.effectUuid,groupId:group.id};
    await message.setFlag(OUT_NS,'saveOutcomes',{
      ...(message.getFlag?.(OUT_NS,'saveOutcomes')??{}),[rule.id]:record
    });
    outLog('Linked effect created',{rule:rule.key,effect:rule.onFailure.name,
      target:target.name,effectUuid:applied.effectUuid,duplicate:applied.duplicate});
    result.push(record);
  }
  return {processed:!!result.length,success,results:result};
}
Hooks.once('init',()=>{
  game.settings.register(OUT_NS,OUT_REG,{scope:'world',config:false,type:Array,default:[]});
});
Hooks.once('ready',()=>{
  const mod=game.modules.get(OUT_NS);
  if(!mod)return;
  mod.api??={};
  mod.api.saveOutcomes=Object.freeze({
    register:data=>outSend('register',data),
    unregister:data=>outSend('unregister',data),
    list:()=>outClone(outLedger()),
    _onResolved:outResolved,
    _onGroupRemoved:outGroupRemoved
  });
  game.socket.on(OUT_SOCKET,data=>{
    if(data?.channel===OUT_CHANNEL)void outSocket(data);
  });
});
