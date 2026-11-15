/**
 * PF1 Automation Engine — persistent, generic Chat Actions.
 * Foundry v13 / PF1 v11.11.
 *
 * Authority model:
 * - Players submit requests by updating an Actor they OWN. The Foundry
 *   server authenticates the updateActor hook's userId; no socket sender
 *   field, message flag, or client-supplied user ID is trusted.
 * - The elected GM creates authoritative ChatMessages, validates the click,
 *   reserves one-shot actions in message flags, and invokes ONLY an already
 *   registered local GM handler.
 * - Handler code is NEVER serialized in a message or transmitted over sockets.
 * - A crash/error after claiming a button leaves it pending (fail closed);
 *   only a GM can explicitly reset it after checking any partial effects.
 */
const CA_NS='pf1-automation-engine';
const CA_FLAG='chatActions';
const CA_CREATE='chatActionCreateRequest';
const CA_CLICK='chatActionClickRequest';
const CA_ACK='chatActionAck';
const CA_HANDLERS=new Map();
const CA_BUSY=new Set();
const CA_SEEN=new Set();
const CA_PENDING=new Map();
const CA_IDENT=/^[a-zA-Z0-9_.-]{1,120}$/;
const CA_BUTTON=/^[a-zA-Z0-9_-]{1,80}$/;
const caLeader=()=>[...game.users].filter(u=>u.isGM&&u.active)
 .sort((a,b)=>a.id.localeCompare(b.id))[0]??null;
const caIsLeader=()=>game.user?.isGM===true&&caLeader()?.id===game.user.id;
const caPermission=(actor,user,level='OWNER')=>
 !!user&&(user.isGM===true||(level==='OWNER'&&
 actor?.testUserPermission?.(user,'OWNER')===true));
const caId=()=>foundry.utils.randomID();
const caField=(change,key)=>change?.flags?.[CA_NS]?.[key]??
 change?.['flags.'+CA_NS+'.'+key]??null;
const caText=(value,max=180)=>typeof value==='string'&&
 value.length>0&&value.length<=max;
const caEscape=value=>String(value).replace(/[&<>"']/g,ch=>
 ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const caError=error=>error instanceof Error?error.message:String(error);
function caButtons(input){
 if(!Array.isArray(input)||input.length<1||input.length>8)
  throw Error('Chat Actions requires 1-8 buttons.');
 const unique=new Set();
 return input.map(raw=>{
  if(!raw||!CA_BUTTON.test(raw.id)||unique.has(raw.id))
   throw Error('Invalid or duplicate chat button ID.');
  unique.add(raw.id);
  const handler=raw.handlerKey??raw.handler??raw.id;
  if(!CA_IDENT.test(handler)||!caText(raw.label,100))
   throw Error('Chat button requires a label and a registered handler key.');
  const targetMode=raw.targetMode??'controlled';
  const permission=raw.permission??'OWNER';
  if(!['controlled','targeted'].includes(targetMode)||
     !['OWNER','GM'].includes(permission))throw Error('Invalid target mode or permission.');
  const icon=typeof raw.icon==='string'&&
    /^fa-(solid|regular) fa-[a-z0-9-]{1,60}$/.test(raw.icon)
     ?raw.icon:'fa-solid fa-hand-pointer';
  return {id:raw.id,handler,label:raw.label,icon,
   targetMode,permission,once:raw.once!==false,
   exactOne:raw.exactOne!==false,status:'ready',uses:0};
 });
}
function caRegisterHandler(key,handler,{sourceItemUuid}={}){
 if(!game.user?.isGM)throw Error('Register Chat Actions handlers on the GM client only.');
 if(!CA_IDENT.test(key)||typeof handler!=='function'||
    !caText(sourceItemUuid,500))
  throw Error('A handler function and its allowed sourceItemUuid are required.');
 CA_HANDLERS.set(key,{run:handler,sourceItemUuid});
 return ()=>{if(CA_HANDLERS.get(key)?.run===handler)CA_HANDLERS.delete(key);};
}
function caValidateSource(actor,item,requester){
 if(actor?.documentName!=='Actor'||item?.documentName!=='Item'||
    (item.actor??item.parent)?.uuid!==actor.uuid)
  throw Error('Chat Action source Item must belong to the source Actor.');
 if(!caPermission(actor,requester))throw Error('Source Actor OWNER permission required.');
}
function caValidateHandlers(buttons,sourceItemUuid){
 for(const button of buttons){
  const registered=CA_HANDLERS.get(button.handler);
  if(!registered||registered.sourceItemUuid!==sourceItemUuid)
   throw Error('GM handler unavailable or not bound to the source Item: '+button.handler);
 }
}
function caData(actor,item,title,content,buttons){
 if(!caText(title,120)||typeof content!=='string'||content.length>4000)
  throw Error('Invalid Chat Action title or content.');
 const sourceItemUuid=item.uuid;
 const parsed=caButtons(buttons);
 caValidateHandlers(parsed,sourceItemUuid);
 return {version:1,sourceActorUuid:actor.uuid,sourceItemUuid,
  buttons:parsed,title,createdAt:Date.now()};
}
async function caCreateGM(actor,item,title,content,buttons,requester){
 if(!caIsLeader())throw Error('An elected GM must create Chat Action messages.');
 caValidateSource(actor,item,requester);
 const state=caData(actor,item,title,content,buttons);
 const safe='<div class="pf1ae-chat-card"><strong>'+
  caEscape(title)+'</strong><p>'+caEscape(content)+'</p></div>';
 return ChatMessage.create({content:safe,
  speaker:ChatMessage.getSpeaker({actor}),
  flags:{[CA_NS]:{[CA_FLAG]:state}}});
}
function caAwait(actor,kind,payload){
 const requestId=caId();
 if(CA_PENDING.has(requestId))throw Error('Duplicate request identifier.');
 const packet={...payload,requestId};
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{
   CA_PENDING.delete(requestId);
   reject(Error('Chat Action GM request timed out.'));
  },15000);
  CA_PENDING.set(requestId,{resolve,reject,timer,actorUuid:actor.uuid});
  const key=kind==='create'?CA_CREATE:CA_CLICK;
  void actor.setFlag(CA_NS,key,packet).catch(error=>{
   clearTimeout(timer);CA_PENDING.delete(requestId);reject(error);
  });
 });
}
async function caCreate({actor,sourceItem,title,content,buttons}={}){
 if(!actor||!sourceItem)throw Error('Actor and sourceItem are required.');
 caValidateSource(actor,sourceItem,game.user);
 const prepared=caButtons(buttons);
 if(!caText(title,120)||typeof content!=='string'||content.length>4000)
  throw Error('Invalid Chat Action title or content.');
 if(caIsLeader())return caCreateGM(actor,sourceItem,title,content,prepared,game.user);
 if(!caLeader())throw Error('No GM connected to create a Chat Action card.');
 return caAwait(actor,'create',{sourceItemUuid:sourceItem.uuid,title,
  content,buttons:prepared});
}
function caSelected(mode){
 if(mode==='targeted')return [...(game.user?.targets??[])];
 return [...(canvas?.tokens?.controlled??[])];
}
function caTargetTokens(mode,exactOne){
 const tokens=caSelected(mode);
 if((exactOne&&tokens.length!==1)||(!exactOne&&(tokens.length<1||tokens.length>10)))
  throw Error(exactOne?'Select exactly one token.':'Select between 1 and 10 tokens.');
 if(tokens.some(t=>!t.actor||!t.document?.uuid))
  throw Error('Every selected token must have an Actor.');
 return tokens;
}
async function caClick(messageId,buttonId){
 const message=game.messages?.get(messageId);
 const state=message?.getFlag(CA_NS,CA_FLAG);
 const button=state?.buttons?.find(b=>b.id===buttonId);
 if(!button||!CA_BUTTON.test(buttonId))throw Error('Unknown Chat Action.');
 if(button.status!=='ready')throw Error('This chat button has already been used or is pending.');
 const tokens=caTargetTokens(button.targetMode,button.exactOne);
 const actors=tokens.map(t=>t.actor);
 if(actors.some(actor=>!caPermission(actor,game.user,button.permission)))
  throw Error('Insufficient OWNER permission on the selected Actor.');
 if(caIsLeader())return caExecute(messageId,buttonId,tokens.map(t=>t.document.uuid),game.user);
 if(!caLeader())throw Error('A GM must be connected for Chat Actions.');
 // Each owner makes an authenticated Foundry document update. For multiple
 // targets the first one is the request carrier; GM revalidates every target.
 return caAwait(actors[0],'click',{messageId,buttonId,
  tokenUuids:tokens.map(t=>t.document.uuid)});
}
async function caTokens(uuids,carrierActor,requester,button){
 if(!Array.isArray(uuids)||uuids.length<1||uuids.length>10||
    (button.exactOne&&uuids.length!==1))throw Error('Invalid target count.');
 const tokens=[];
 for(const uuid of uuids){
  if(!caText(uuid,500))throw Error('Invalid target token UUID.');
  const token=await fromUuid(uuid);
  if(!token?.actor||token.actor.documentName!=='Actor'||
     !caPermission(token.actor,requester,button.permission))
   throw Error('Selected Actor is missing or OWNER permission was revoked.');
  tokens.push(token);
 }
 if(carrierActor&&tokens[0].actor.uuid!==carrierActor.uuid)
  throw Error('The authenticated Actor request does not match the target.');
 return tokens;
}
async function caExecute(messageId,buttonId,tokenUuids,requester,carrierActor=null){
 if(!caIsLeader())throw Error('Only the elected GM may execute Chat Actions.');
 const key=messageId+'/'+buttonId;
 if(CA_BUSY.has(key))throw Error('This chat action is already in progress.');
 CA_BUSY.add(key);
 let claimed=false;
 try{
  const message=game.messages?.get(messageId);
  const state=message?.getFlag(CA_NS,CA_FLAG);
  const button=state?.buttons?.find(b=>b.id===buttonId);
  if(!button||button.status!=='ready')throw Error('Chat button already resolved or pending.');
  const sourceActor=await fromUuid(state.sourceActorUuid);
  const sourceItem=await fromUuid(state.sourceItemUuid);
  caValidateSource(sourceActor,sourceItem,game.users.get(message.user?.id??message.user)??game.user);
  const entry=CA_HANDLERS.get(button.handler);
  if(!entry||entry.sourceItemUuid!==sourceItem.uuid)
   throw Error('Approved GM handler not available for this source Item.');
  const tokens=await caTokens(tokenUuids,carrierActor,requester,button);
  const next=foundry.utils.deepClone(state);
  const slot=next.buttons.find(b=>b.id===buttonId);
  slot.status='pending';slot.claimedAt=Date.now();slot.claimedBy=requester.id;
  await message.setFlag(CA_NS,CA_FLAG,next);
  claimed=true;
  let outcome;
  try{
   outcome=await entry.run(Object.freeze({
    message,button:Object.freeze({...button}),requester,
    actor:tokens[0].actor,token:tokens[0],
    targets:Object.freeze(tokens.map(t=>t.actor)),
    sourceActor,sourceItem
   }));
  }catch(error){
   // A script may have mutated documents before throwing. Never permit a
   // second execution automatically: leave the persisted pending state.
   console.error('[PF1AE][ChatActions] Handler failed; GM review required',error);
   throw Error('Handler failed; button locked pending GM review: '+caError(error));
  }
  if(outcome?.ok===false){
   const rejected=foundry.utils.deepClone(message.getFlag(CA_NS,CA_FLAG));
   rejected.buttons.find(b=>b.id===buttonId).status='ready';
   await message.setFlag(CA_NS,CA_FLAG,rejected);
   claimed=false;
   return {ok:false,reason:String(outcome.reason??'Action conditions not met.')};
  }
  const completed=foundry.utils.deepClone(message.getFlag(CA_NS,CA_FLAG));
  const resultButton=completed.buttons.find(b=>b.id===buttonId);
  resultButton.status=button.once?'used':'ready';
  resultButton.uses=(resultButton.uses??0)+1;
  resultButton.usedAt=Date.now();
  await message.setFlag(CA_NS,CA_FLAG,completed);
  claimed=false;
  if(typeof outcome?.confirmation==='string'&&outcome.confirmation.length<=500)
   await ChatMessage.create({content:caEscape(outcome.confirmation)});
  return {ok:true,uses:resultButton.uses};
 }finally{
  CA_BUSY.delete(key);
  // A pending claim is deliberately persistent if an unexpected error occurs.
  if(claimed)console.warn('[PF1AE][ChatActions] Pending button requires GM review',key);
 }
}
async function caReset({messageId,buttonId}={}){
 if(!caIsLeader())throw Error('Only the elected GM can reset a pending button.');
 const message=game.messages?.get(messageId);
 const state=message?.getFlag(CA_NS,CA_FLAG);
 const button=state?.buttons?.find(b=>b.id===buttonId);
 if(!button||button.status!=='pending')throw Error('Only pending buttons can be reset.');
 if(CA_BUSY.has(messageId+'/'+buttonId))throw Error('Execution is still in progress.');
 const fresh=foundry.utils.deepClone(state);
 fresh.buttons.find(b=>b.id===buttonId).status='ready';
 await message.setFlag(CA_NS,CA_FLAG,fresh);
 return true;
}
function caRender(message,html){
 const state=message?.getFlag(CA_NS,CA_FLAG);
 if(state?.version!==1||!Array.isArray(state.buttons))return;
 const root=html?.[0]??html;
 if(!root?.querySelector)return;
 const parent=root.querySelector('.message-content')??root;
 if(parent.querySelector('[data-pf1ae-chat-actions]'))return;
 const wrap=document.createElement('div');
 wrap.dataset.pf1aeChatActions='true';
 wrap.className='pf1ae-chat-actions';
 wrap.style.cssText='display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;';
 for(const button of state.buttons){
  if(!CA_BUTTON.test(button.id))continue;
  const element=document.createElement('button');
  element.type='button';
  element.dataset.actionId=button.id;
  element.className='pf1ae-chat-action';
  element.style.cssText='display:inline-flex;align-items:center;gap:5px;padding:4px 8px;';
  element.disabled=button.status!=='ready';
  const icon=document.createElement('i');
  icon.className=/^fa-(solid|regular) fa-[a-z0-9-]{1,60}$/.test(button.icon)
   ?button.icon:'fa-solid fa-hand-pointer';
  icon.setAttribute('aria-hidden','true');
  element.append(icon,document.createTextNode(' '+button.label+
   (button.status==='used'?' ✓':button.status==='pending'?' …':'')));
  element.addEventListener('click',async event=>{
   event.preventDefault();event.stopPropagation();
   element.disabled=true;
   try{
    const result=await caClick(message.id,button.id);
    if(result?.ok===false)throw Error(result.reason);
   }catch(error){
    ui.notifications?.warn?.(caError(error));
   }finally{
    const live=game.messages?.get(message.id)?.getFlag(CA_NS,CA_FLAG);
    element.disabled=live?.buttons?.find(b=>b.id===button.id)?.status!=='ready';
   }
  });
  wrap.append(element);
 }
 parent.append(wrap);
}
function caAck(actor,data,userId){
 if(!data||!CA_IDENT.test(data.requestId??''))return;
 if(caLeader()?.id!==userId)return; // Authenticated Foundry update userId
 const pending=CA_PENDING.get(data.requestId);
 if(!pending||pending.actorUuid!==actor.uuid)return;
 CA_PENDING.delete(data.requestId);clearTimeout(pending.timer);
 data.ok?pending.resolve(data.result):pending.reject(Error(data.error??'Chat Action refused.'));
}
async function caOnActorUpdate(actor,changes,_options,userId){
 const ack=caField(changes,CA_ACK);
 if(ack)caAck(actor,ack,userId);
 if(!caIsLeader())return;
 for(const [kind,field] of [['create',CA_CREATE],['click',CA_CLICK]]){
  const packet=caField(changes,field);
  if(!packet||!CA_IDENT.test(packet.requestId??''))continue;
  const key=actor.uuid+'/'+kind+'/'+packet.requestId;
  if(CA_SEEN.has(key))continue;
  CA_SEEN.add(key);
  if(CA_SEEN.size>3000)CA_SEEN.clear();
  // userId is the real authenticated requester supplied by Foundry's
  // updateActor hook, NOT a client-provided string in the actor flag.
  const requester=game.users.get(userId);
  let result,error;
  try{
   if(!requester?.active||!caPermission(actor,requester))
    throw Error('Authenticated OWNER permission required.');
   if(kind==='create'){
    const sourceItem=await fromUuid(packet.sourceItemUuid);
    const message=await caCreateGM(actor,sourceItem,packet.title,
     packet.content,packet.buttons,requester);
    result={id:message.id,uuid:message.uuid};
   }else{
    result=await caExecute(packet.messageId,packet.buttonId,
     packet.tokenUuids,requester,actor);
   }
  }catch(err){error=caError(err);}
  try{
   await actor.setFlag(CA_NS,CA_ACK,{requestId:packet.requestId,
    ok:!error,result,error});
  }catch(err){
   console.error('[PF1AE][ChatActions] Could not send authenticated acknowledgement',err);
  }
 }
}
Hooks.once('ready',()=>{
 const mod=game.modules.get(CA_NS);
 if(!mod)return;
 mod.api??={};
 mod.api.chatActions=Object.freeze({
  create:caCreate,registerHandler:caRegisterHandler,
  click:caClick,reset:caReset,
  getState:messageId=>game.messages?.get(messageId)?.getFlag(CA_NS,CA_FLAG)??null
 });
 Hooks.on('renderChatMessageHTML',caRender);
 Hooks.on('updateActor',caOnActorUpdate);
});
