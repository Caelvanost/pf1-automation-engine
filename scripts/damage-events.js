/**
 * PF1AE v1.19 — generic verified damage notifications.
 * This service does NOT observe PF1 damage hooks. attack-outcomes.js alone
 * correlates the native card, per-target damage request and Actor HP update,
 * then emits pf1aeVerifiedDamage on the elected GM.
 */
const DE_NS='pf1-automation-engine';
const DE_REG='damageEventReceipts';
const DE_SOCKET='module.'+DE_NS;
const DE_CHANNEL='pf1ae-damage-events-v1';
const DE_TYPES=new Set(['damage:applied','damage:critical','damage:zeroHP']);
const DE_SEEN=new Set();
const DE_ACTIVE=new Set();
const DE_MAX_RECEIPTS=1500;
const DE_EXPIRY=86400000;
let deWrite=Promise.resolve();
const deValid=(s,max=400)=>typeof s==='string'&&s.length>0&&s.length<=max;
const deLog=(msg,details={})=>{try{if(game.settings.get(DE_NS,'genericDebug'))
 console.debug('[PF1AE][DamageEvents] '+msg,details)}catch(_){}};
const deLeader=()=>[...game.users].filter(u=>u.active&&u.isGM)
 .sort((a,b)=>a.id.localeCompare(b.id))[0]??null;
const deIsLeader=()=>deLeader()?.id===game.user.id;
const deEnabled=()=>!!game.modules.get(DE_NS)?.active&&game.settings.get(DE_NS,'genericEnabled');
const deQueue=fn=>{const next=deWrite.catch(()=>{}).then(fn);deWrite=next.catch(()=>{});return next;};
const deCopy=value=>foundry.utils.deepClone(value);
const deCalls=item=>item?.scriptCalls?.contents??
 (typeof item?.scriptCalls?.values==='function'?[...item.scriptCalls.values()]:
 (Array.isArray(item?.scriptCalls)?item.scriptCalls:item?.system?.scriptCalls??[]));
function deSubscribers(actor,type){
 const found=[];
 for(const item of actor.items?.values?.()??[]){
  const calls=[...deCalls(item)].filter(c=>c?.category==='postUse'&&c?.name==='PF1AE:'+type);
  if(calls.length>1){deLog('Duplicate Script Calls ignored',{itemUuid:item.uuid,type});continue;}
  if(calls.length===1&&typeof calls[0].execute==='function')
   found.push({item,call:calls[0]});
 }
 return found;
}
/** A player-owned actor executes its scripts only on its elected player.
 * An NPC with no player owner executes on the elected GM.
 * This deliberately never executes a player-owned Item's code as GM.
 */
function deExecutor(actor){
 const playerOwners=[...game.users].filter(u=>!u.isGM&&
   actor.testUserPermission?.(u,'OWNER')===true);
 const online=playerOwners.filter(u=>u.active).sort((a,b)=>a.id.localeCompare(b.id));
 if(online.length)return online[0].id;
 if(playerOwners.length)return null; // Never privilege-escalate player code to GM.
 return deLeader()?.id??null;
}
const deReceipts=()=>game.settings.get(DE_NS,DE_REG)??[];
const deMessage=id=>game.messages?.get(id)??null;
function deCardSource(card){
 if(card?.documentName!=='ChatMessage')return null;
 const item=card.itemSource,action=card.actionSource;
 const actor=item?.actor??(typeof ChatMessage?.getSpeakerActor==='function'?
   ChatMessage.getSpeakerActor(card.speaker):null);
 if(actor?.documentName!=='Actor'||item?.documentName!=='Item')return null;
 const itemUuid=item.uuid??(actor.uuid&&item.id?actor.uuid+'.Item.'+item.id:null);
 const actionId=action?.id??action?._id;
 return deValid(actor.uuid)&&deValid(itemUuid)&&deValid(actionId,100)
  ?{actorUuid:actor.uuid,itemUuid,actionId}:null;
}
function deEvent(payload){
 const c=payload?.context,e=c?.evidence,d=c?.delta;
 if(!deValid(payload?.requestId,120)||!deValid(c?.sourceMessageId,100)||
    !deValid(c?.actorUuid)||!deValid(c?.sourceItemUuid)||
    !deValid(c?.sourceActionId,100)||!deValid(c?.targetUuid)||
    c.targetUuid!==payload.targetUuid||
    !Number.isSafeInteger(c.attackIndex)||c.attackIndex<0||
    !d?.provenDamage||!e)return null;
 const hpBefore=Number(e.hpBefore),hpAfter=Number(e.hpAfter);
 const hpLoss=Number(d.hitPointLoss);
 // A reliable positive real HP decrease is required; temp HP and nonlethal
 // alone cannot generate a grit-like critical/zeroHP notification.
 if(!Number.isFinite(hpBefore)||!Number.isFinite(hpAfter)||
    !Number.isFinite(hpLoss)||hpLoss<=0||
    hpBefore-hpAfter!==hpLoss)return null;
 const mult=e.critMult;
 const critMult=mult==null?null:Number(mult);
 if(critMult!=null&&(!Number.isSafeInteger(critMult)||critMult<0||critMult>100))return null;
 const critical=critMult==null?null:critMult>1;
 const card=deMessage(c.sourceMessageId),src=deCardSource(card);
 if(!src||src.actorUuid!==c.actorUuid||src.itemUuid!==c.sourceItemUuid||
    src.actionId!==c.sourceActionId)return null;
 const event={eventId:payload.requestId,type:'damage:applied',
  actorUuid:src.actorUuid,itemUuid:src.itemUuid,actionId:src.actionId,
  sourceMessageId:card.id,attackIndex:c.attackIndex,
  targetActorUuid:c.targetUuid,critical,critMult,
  criticalHitConfirmed:null, // Critical-damage column != verified attack confirmation.
  hpBefore,hpAfter,hpDelta:hpAfter-hpBefore,
  tempHpLoss:Number.isFinite(Number(d.tempHpLoss))?Number(d.tempHpLoss):null,
  reducedToZero:hpBefore>0&&hpAfter<=0,
  damageApplied:true};
 return event;
}
async function deRecipientDispatch(event,recipientId){
 if(!deEnabled()||game.user.id!==recipientId)return;
 if(DE_SEEN.has(event.eventId)||DE_ACTIVE.has(event.actorUuid))return;
 const actor=await fromUuid(event.actorUuid);
 if(actor?.documentName!=='Actor'||deExecutor(actor)!==game.user.id)return;
 // Recheck native card provenance on this client; events are not self-certifying.
 const src=deCardSource(deMessage(event.sourceMessageId));
 if(!src||src.actorUuid!==actor.uuid||src.itemUuid!==event.itemUuid||
   src.actionId!==event.actionId)return;
 if(!Number.isSafeInteger(event.attackIndex)||event.attackIndex<0||
   !deValid(event.targetActorUuid))return;
 const target=await fromUuid(event.targetActorUuid);
 if(target?.documentName!=='Actor')return;
 if(!(Number.isFinite(event.hpBefore)&&Number.isFinite(event.hpAfter)&&
      event.hpBefore>event.hpAfter&&event.hpDelta===event.hpAfter-event.hpBefore))return;
 DE_SEEN.add(event.eventId);if(DE_SEEN.size>3000)DE_SEEN.clear();
 DE_ACTIVE.add(actor.uuid);
 try {
  const kinds=['damage:applied'];
  if(event.critical===true)kinds.push('damage:critical');
  if(event.reducedToZero===true)kinds.push('damage:zeroHP');
  for(const type of kinds){
   const scriptEvent=Object.freeze({...deCopy(event),type});
   for(const {item,call} of deSubscribers(actor,type)){
    try{
     await call.execute({action:null},{
      event:scriptEvent,api:game.modules.get(DE_NS)?.api?.damageEvents
     });
     deLog('Script Call delivered',{type,itemUuid:item.uuid,eventId:event.eventId});
    }catch(err){console.error('[PF1AE][DamageEvents] Item Script Call failed',item.uuid,err)}
   }
  }
 }finally{DE_ACTIVE.delete(actor.uuid);}
}
async function deProvenDamage(payload){
 if(!deIsLeader()||!deEnabled()||!game.user.isGM)return;
 const event=deEvent(payload);
 if(!event){deLog('Unverified or non-HP damage refused', {requestId:payload?.requestId});return;}
 // Verify target UUID and effective current HP on leader: especially important
 // when the applying GM differs from the elected GM.
 const target=await fromUuid(event.targetActorUuid);
 if(target?.documentName!=='Actor')return;
 let matches=false;
 for(let i=0;i<6;i++){
  const value=Number((await fromUuid(event.targetActorUuid))?.system?.attributes?.hp?.value);
  if(Number.isFinite(value)&&value===event.hpAfter){matches=true;break;}
  if(i<5)await new Promise(resolve=>setTimeout(resolve,120));
 }
 if(!matches){deLog('Target HP state not corroborated on leader; refused',event);return;}
 await deQueue(async()=>{
  const now=Date.now(),seen=deReceipts().filter(r=>r?.at>now-DE_EXPIRY);
  if(seen.some(r=>r.id===event.eventId)){deLog('Duplicate native damage ignored',event.eventId);return;}
  seen.push({id:event.eventId,at:now,actorUuid:event.actorUuid,
   targetActorUuid:event.targetActorUuid,sourceMessageId:event.sourceMessageId});
  await game.settings.set(DE_NS,DE_REG,seen.slice(-DE_MAX_RECEIPTS));
  const actor=await fromUuid(event.actorUuid),recipientId=deExecutor(actor??{});
  if(!recipientId){deLog('No eligible player owner online; event not executed',event);return;}
  if(recipientId===game.user.id)await deRecipientDispatch(event,recipientId);
  else game.socket.emit(DE_SOCKET,{channel:DE_CHANNEL,op:'notify',
   leaderId:game.user.id,recipientId,event});
 });
}
function deSocket(data){
 if(!deEnabled()||data?.channel!==DE_CHANNEL||data?.op!=='notify'||
    data.recipientId!==game.user.id||data.leaderId!==deLeader()?.id)return;
 // Local executable ItemScriptCall always runs with the actor OWNER's
 // permissions. No player-provided JS is ever passed over the socket.
 const e=data.event;
 if(!e||!deValid(e.eventId,120)||!deValid(e.actorUuid)||
    !deValid(e.targetActorUuid))return;
 void deRecipientDispatch(e,data.recipientId);
}
Hooks.once('init',()=>{
 game.settings.register(DE_NS,DE_REG,{scope:'world',config:false,type:Array,default:[]});
});
Hooks.once('ready',()=>{
 const module=game.modules.get(DE_NS);if(!module)return;
 module.api??={};
 module.api.damageEvents=Object.freeze({
  subscriptionNames:['PF1AE:damage:applied','PF1AE:damage:critical','PF1AE:damage:zeroHP'],
  listSubscriptions:actor=>[...DE_TYPES].flatMap(type=>deSubscribers(actor,type)
    .map(({item,call})=>({type,itemUuid:item.uuid,scriptId:call.id??call._id??null})))
 });
 Hooks.on('pf1aeVerifiedDamage',payload=>{
  void deProvenDamage(payload).catch(err=>console.error('[PF1AE][DamageEvents] Verify/dispatch failed',err));
 });
 game.socket.on(DE_SOCKET,deSocket);
 deLog('Ready: subscribed to verified attack-outcomes damage only');
});
