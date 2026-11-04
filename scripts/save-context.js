/**
 * PF1 Automation Engine — native PF1 action-chat save context bridge.
 * Target: Foundry v13.351 / PF1 11.11.
 *
 * Observes PF1's ActionUse before the native chat card is created and the
 * built-in action-card save control in renderChatMessageHTML. The native PF1
 * event listener remains the sole roller. We only correlate an action-card
 * click to pf1PreActorRollSave on THIS client; each ChatMessage persists the
 * source Item/Action context and every target independently resolves a save.
 *
 * No modification of PF1 classes, prototypes, dice, chat HTML, or event
 * propagation. Fail closed for ambiguous/unknown selectors or actors.
 */
const SC_NS='pf1-automation-engine';
const SC_MAX_CLICK_AGE=120000;
const SC_CURRENT=[];
const scLog=(name,data={})=>{
  if(game.modules.get(SC_NS)?.active && game.settings.get(SC_NS,'genericDebug'))
    console.debug('[PF1AE][SaveContext] '+name,data);
};
const scEnabled=()=>game.modules.get(SC_NS)?.active &&
  !game.modules.get('pf1-combat-automation')?.active &&
  game.settings.get(SC_NS,'genericEnabled');
const scSaveType=value=>{
  const t=String(value??'').toLowerCase().trim();
  if(['will','ref','fort'].includes(t))return t;
  if(t==='reflex')return 'ref';
  if(t==='fortitude')return 'fort';
  return null;
};
function scContext(item,action,dc=null) {
  if(item?.documentName!=='Item' || !item.uuid ||
      !item.actor?.uuid || !action?.id)return null;
  const saveType=scSaveType(action.save?.type);
  if(!saveType)return null;
  const raw=dc??action.save?.dc;
  const numeric=typeof raw==='number'?raw:
    (typeof raw==='string' && /^\s*\d+(?:\.\d+)?\s*$/.test(raw)?Number(raw):null);
  return {
    sourceActorUuid:item.actor.uuid,
    sourceItemUuid:item.uuid,
    sourceActionId:action.id,
    saveType,
    saveDC:Number.isFinite(numeric)?numeric:null
  };
}
function scFromActionUse(actionUse) {
  if(!actionUse?.action?.hasSave)return null;
  let dc=null;
  try {
    const calculated=actionUse.action.getDC?.(actionUse.shared?.rollData);
    if(Number.isFinite(calculated))dc=calculated;
  } catch(error) {scLog('DC unavailable at action-use hook',{error:error.message});}
  return scContext(actionUse.item,actionUse.action,dc);
}
function scFromMessage(message) {
  const existing=message.getFlag?.(SC_NS,'saveContext');
  if(existing && typeof existing==='object' &&
      typeof existing.sourceItemUuid==='string' &&
      scSaveType(existing.saveType) && existing.sourceActionId)return existing;
  const item=message.itemSource;
  const action=message.actionSource;
  const data=scContext(item,action,message.system?.save?.dc);
  return data;
}
function scNormalizeContext(context) {
  if(!context || typeof context!=='object')return null;
  const {sourceActorUuid,sourceItemUuid,sourceActionId}=context;
  if(![sourceActorUuid,sourceItemUuid,sourceActionId].every(
      x=>typeof x==='string'&&x.length>0&&x.length<500))return null;
  const saveType=scSaveType(context.saveType);
  if(!saveType)return null;
  return {sourceActorUuid,sourceItemUuid,sourceActionId,saveType,
    saveDC:Number.isFinite(context.saveDC)?context.saveDC:null};
}
function scOnPreAction(actionUse) {
  if(!scEnabled())return;
  const info=scFromActionUse(actionUse);
  if(!info)return;
  // PF1 11.11 ActionUse.shared.chatData is passed to ChatMessage.create.
  // This hook is late in the action-use pipeline; never fabricate a chat
  // document or call postMessage() a second time.
  const chatData=actionUse.shared?.chatData;
  if(chatData && typeof chatData==='object') {
    chatData.flags??={};
    chatData.flags[SC_NS]??={};
    chatData.flags[SC_NS].saveContext=info;
    scLog('Source context attached to ActionUse chat data',info);
  }
}
function scOnPreCreateMessage(message,data,_options,userId) {
  if(!scEnabled()||userId!==game.user?.id)return;
  if(message.getFlag?.(SC_NS,'saveContext'))return;
  const info=scFromMessage(message);
  if(!info)return;
  message.updateSource?.({['flags.'+SC_NS+'.saveContext']:info});
  scLog('Source context attached to ChatMessage', {messageId:message.id,...info});
}
function scAllowedActors(message,element) {
  const ids=new Set();
  // Native PF1 target buttons are associated with target tokens. Prefer
  // explicit dataset IDs and the currently selected tokens. No broad "next
  // save on this client" default: unrelated sheet rolls remain unannotated.
  const ds=element?.dataset??{};
  const id=ds.actorId??ds.actorUuid??null;
  if(id){
    const actor=game.actors?.get?.(id)??null;
    ids.add(actor?.uuid??id);
  }
  const tokenId=ds.tokenId??ds.tokenUuid;
  if(tokenId){
    const token=canvas?.scene?.tokens?.get?.(tokenId)??
      [...(canvas?.scene?.tokens??[])].find(t=>t.uuid===tokenId);
    if(token?.actor?.uuid)ids.add(token.actor.uuid);
  }
  // Existing PF1 target list is embedded in the action ChatMessage.
  for(const token of message.targets??[]) {
    if(token?.actor?.uuid)ids.add(token.actor.uuid);
  }
  for(const token of canvas?.tokens?.controlled??[]) {
    if(token?.actor?.uuid)ids.add(token.actor.uuid);
  }
  // Foundry's assigned character can be a chat-save target without token
  // selection, but only when this client is that actor's owner.
  if(game.user?.character?.isOwner && game.user.character.uuid) {
    ids.add(game.user.character.uuid);
  }
  return ids;
}
function scIsSaveButton(event) {
  const target=event.target;
  if(!target?.closest)return null;
  // Some PF1 templates place a data-action on a parent element while a
  // clicked child has an unrelated data-action. Walk up instead of trusting
  // only closest('[data-action]') and keep native handlers untouched.
  let el=target;
  while(el && el!==event.currentTarget) {
    const raw=[el.dataset?.action,el.dataset?.save,el.getAttribute?.('class')]
      .filter(Boolean).join(' ').toLowerCase();
    if(/(^|[-_\s])(save|saving|saves|savingthrow|saving-throw|rollsave|roll-save|target-save|targetsave|saveroll|rollsavingthrow|targetsavingthrow)([-_\s]|$)/.test(raw)) {
      return el;
    }
    el=el.parentElement;
  }
  return null;
}
function scOnRendered(message,html) {
  if(!scEnabled()||!html?.addEventListener)return;
  const context=scNormalizeContext(scFromMessage(message));
  if(!context)return;
  scLog('Source message detected',{messageId:message.id});
  scLog('Item: '+(message.itemSource?.name??'unknown'));
  scLog('Item UUID: '+context.sourceItemUuid);
  scLog('Action ID: '+context.sourceActionId);
  scLog('Save: '+context.saveType+' DC '+(context.saveDC??'?'));
  // Native button events bubble. Capturing the click before PF1's normal
  // listener starts allows the engine's pre-roll hook to correlate metadata.
  html.addEventListener('click',event=>{
    const clicked=scIsSaveButton(event);
    if(!clicked)return;
    const actors=scAllowedActors(message,clicked);
    if(!actors.size){scLog('Save button: no identifiable target (ignored)',{messageId:message.id});return;}
    SC_CURRENT.push({context,sourceMessageId:message.id,expires:Date.now()+SC_MAX_CLICK_AGE,
      actors,used:new Set()});
    if(SC_CURRENT.length>16)SC_CURRENT.shift();
    scLog('Native PF1 save button detected',{messageId:message.id,saveType:context.saveType,
      sourceItemUuid:context.sourceItemUuid,sourceActionId:context.sourceActionId,
      allowedActors:[...actors]});
    // Never preventDefault, stopPropagation, call rollSavingThrow, or change
    // the native event: all roll options remain exclusively owned by PF1.
  },true);
}
function scConsume(actor,saveType) {
  if(!scEnabled()||!actor?.uuid)return null;
  const now=Date.now();
  for(let i=SC_CURRENT.length-1;i>=0;i--){
    const c=SC_CURRENT[i];
    if(c.expires<now || c.used.size>=c.actors.size){SC_CURRENT.splice(i,1);continue;}
    if(c.context.saveType!==saveType || !c.actors.has(actor.uuid)||c.used.has(actor.uuid))continue;
    c.used.add(actor.uuid);
    scLog('Source context restored',{actorUuid:actor.uuid,sourceMessageId:c.sourceMessageId,
      ...c.context});
    return {sourceMessageId:c.sourceMessageId,...c.context};
  }
  return null;
}
Hooks.once('init',()=>{
  Hooks.on('pf1PreDisplayActionUse',scOnPreAction);
  Hooks.on('preCreateChatMessage',scOnPreCreateMessage);
  Hooks.on('renderChatMessageHTML',scOnRendered);
});
Hooks.once('ready',()=>{
  const mod=game.modules.get(SC_NS);
  if(!mod)return;
  mod.api??={};
  mod.api.saveContext=Object.freeze({
    _consumeForNativeSave:scConsume,
    fromMessage:message=>scNormalizeContext(scFromMessage(message))
  });
});
