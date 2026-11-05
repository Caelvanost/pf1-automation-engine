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
const SC_RENDERED = new WeakSet();
const SC_WRAPPED = [];
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
  if(!message)return null;
  const existing=message.getFlag?.(SC_NS,'saveContext');
  if(scNormalizeContext(existing))return scNormalizeContext(existing);
  // PF1 ChatMessagePF.actionSource/itemSource are authoritative. When
  // a player cannot resolve a GM-owned Item, the card still stores native
  // structured Item/Action IDs and the source's speaker Actor identity.
  const item=message.itemSource??null;
  const action=message.actionSource??null;
  const native=message.system??{};
  const itemId=item?.id??native.item?.id;
  const actionId=action?.id??native.action?.id;
  const actor= item?.actor ?? (typeof ChatMessage?.getSpeakerActor==='function'
    ? ChatMessage.getSpeakerActor(message.speaker) : null);
  const actorUuid=actor?.uuid??(
    typeof native.actor==='string' &&
      (native.actor.startsWith('Actor.') || native.actor.includes('.Actor.'))
      ?native.actor:null);
  const sourceItemUuid=item?.uuid??(actorUuid && itemId ? actorUuid+'.Item.'+itemId : null);
  const saveType=scSaveType(native.save?.type??action?.save?.type);
  const dc=native.save?.dc??action?.save?.dc??null;
  if(!actorUuid||!sourceItemUuid||!actionId||!saveType)return null;
  return scNormalizeContext({sourceActorUuid:actorUuid,
    sourceItemUuid,sourceActionId:actionId,saveType,saveDC:dc});
}
function scMessageFromReference(reference) {
  if(!reference)return null;
  if(reference.documentName==='ChatMessage')return reference;
  if(typeof reference!=='string'||reference.length>400)return null;
  // Native PF1: reference = cm.uuid (typically ChatMessage.<id>).
  const id=reference.startsWith('ChatMessage.') ? reference.slice('ChatMessage.'.length)
    : (/^[A-Za-z0-9]{16,24}$/.test(reference)?reference:null);
  if(!id)return null;
  return game.messages?.get(id)??null;
}
/** Synchronous and deterministic: no browser DOM or click timing required. */
function scFromNativeSaveOptions(actor,saveType,options) {
  if(!scEnabled()||!options?.reference)return null;
  const message=scMessageFromReference(options.reference);
  if(!message) {
    scLog('Native save reference could not be resolved',{reference:options.reference,actor:actor?.uuid});
    return null;
  }
  const context=scNormalizeContext(scFromMessage(message));
  if(!context || context.saveType!==scSaveType(saveType)){
    scLog('Native source card missing or save type mismatch',{messageId:message.id,saveType});
    return null;
  }
  scLog('Native PF1 save action intercepted',{messageId:message.id,actorUuid:actor.uuid});
  scLog('Message: '+message.id);
  scLog('Action source: '+(message.actionSource?.name??message.itemSource?.name??'unknown'));
  scLog('Item UUID: '+context.sourceItemUuid);
  scLog('Action ID: '+context.sourceActionId);
  scLog('Save: '+context.saveType);
  scLog('DC: '+context.saveDC);
  scLog('Targets: '+JSON.stringify(message.system?.targets??[]));
  scLog('Source context restored',{actorUuid:actor.uuid,sourceMessageId:message.id,...context});
  return {sourceMessageId:message.id,...context};
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
function scRenderTargetResults(message, html) {
  if(!html?.querySelectorAll)return;
  const results=message.getFlag?.(SC_NS,'targetSaveResults')??[];
  if(!Array.isArray(results))return;
  for(const targetRow of html.querySelectorAll('.attack-targets .target[data-uuid]')){
    const uuid=targetRow.dataset?.uuid;
    const entry=results.find(r=>r.targetUuid===uuid)??null;
    if(!entry||entry.display!==true||!Number.isFinite(entry.effectiveTotal))continue;
    const selector='.saving-throws [data-save="'+entry.saveType+'"], .saving-throws [data-saving-throw="'+entry.saveType+'"]';
    const saveNode=targetRow.querySelector(selector);
    if(!saveNode)continue;
    // This is a display value for the matched target, not a change to the
    // RollPF formula or ChatMessage roll. It survives re-render/F5.
    let value=saveNode.querySelector('.value');
    if(!value && typeof document!=='undefined' && document.createElement) {
      value=saveNode.querySelector('.pf1ae-effective-result');
      if(!value) {
        value=document.createElement('span');
        value.classList.add('pf1ae-effective-result');
        saveNode.append(value);
      }
    }
    if(!value)continue;
    value.textContent=String(entry.effectiveTotal);
    value.setAttribute('title','Effective saving throw: '+entry.effectiveTotal+
      ' (native roll '+entry.normalTotal+')');
    value.dataset.pf1aeEffective='true';
    scLog('Target card result displayed',{targetUuid:uuid,
      normalTotal:entry.normalTotal,effectiveTotal:entry.effectiveTotal});
  }
}
function scRenderMessage(message,html) {
  if(!scEnabled())return;
  scRenderTargetResults(message,html);
}
function scOnRendered(message,html) {
  if(!scEnabled()||!html?.addEventListener)return;
  scRenderMessage(message,html);
  // The render listener is only the fallback for older PF1 workflows.
  // Native roll options.reference is the primary, exact source correlation.
  const context=scNormalizeContext(scFromMessage(message));
  if(!context||SC_RENDERED.has(html))return;
  SC_RENDERED.add(html);
  scLog('Source message detected',{messageId:message.id});
  scLog('Item: '+(message.itemSource?.name??'unknown'));
  scLog('Item UUID: '+context.sourceItemUuid);
  scLog('Action ID: '+context.sourceActionId);
  scLog('Save: '+context.saveType+' DC '+(context.saveDC??'?'));
  html.addEventListener('click',event=>{
    const clicked=scIsSaveButton(event);
    if(!clicked)return;
    if(game.settings.get(SC_NS,'genericDebug'))
      console.debug('[PF1AE][SaveBridge] Saving throw requested',{handler:'native chat button',sourceMessageId:message.id});
    const actors=scAllowedActors(message,clicked);
    if(!actors.size){scLog('Save button: no identifiable target (ignored)',{messageId:message.id});return;}
    SC_CURRENT.push({context,sourceMessageId:message.id,expires:Date.now()+SC_MAX_CLICK_AGE,
      actors,used:new Set()});
    if(SC_CURRENT.length>16)SC_CURRENT.shift();
    scLog('Native PF1 save button detected',{messageId:message.id,saveType:context.saveType,
      sourceItemUuid:context.sourceItemUuid,sourceActionId:context.sourceActionId,
      allowedActors:[...actors]});
  },true);
}
/**
 * Wrapper for diagnostic visibility only. The actual provenance flows through
 * rollOptions.reference, which is preserved by the original PF1 handler.
 * This does not replace native callbacks or alter their results.
 */
function scTrackNativeCall(label,args) {
  // Only a compatibility fallback. PF1 rollOptions.reference is the primary
  // source, independent of the exact native handler or its return shape.
  let cm=null,actors=new Set();
  if(label==='targetSavingThrowClick') {
    cm=args.find(a=>a?.documentName==='ChatMessage' ||
      (a?.itemSource && a?.actionSource))??null;
    const specific=args.find(a=>a?.documentName==='Actor'&&a.uuid);
    if(specific)actors.add(specific.uuid);
    const token=args.find(a=>a?.actor?.documentName==='Actor'&&a.uuid);
    if(token)actors.add(token.actor.uuid);
  } else {
    const button=args[1];
    const id=button?.closest?.('.chat-message[data-message-id]')?.dataset?.messageId;
    cm=id?game.messages?.get(id):null;
    const targetUuid=button?.closest?.('[data-uuid]')?.dataset?.uuid;
    if(targetUuid){
      const token=typeof fromUuidSync==='function'?fromUuidSync(targetUuid):null;
      if(token?.actor?.uuid)actors.add(token.actor.uuid);
    }
    if(!actors.size) {
      for(const t of canvas?.tokens?.controlled??[])if(t.actor?.uuid)actors.add(t.actor.uuid);
      if(!actors.size && game.user?.character?.uuid)actors.add(game.user.character.uuid);
    }
  }
  const context=scNormalizeContext(scFromMessage(cm));
  if(!context||!actors.size)return;
  SC_CURRENT.push({context,sourceMessageId:cm.id,
    expires:Date.now()+Math.min(SC_MAX_CLICK_AGE,30000),actors,used:new Set()});
  if(SC_CURRENT.length>16)SC_CURRENT.shift();
  scLog('Source message detected',{id:cm.id});
  scLog('Item: '+(cm.itemSource?.name??'unknown'));
  scLog('Item UUID: '+context.sourceItemUuid);
  scLog('Action ID: '+context.sourceActionId);
  scLog('Save: '+context.saveType+' DC '+context.saveDC);
  scLog('Targets: '+JSON.stringify([...actors]));
}
function scWrap(object,key,label) {
  const original=object?.[key];
  if(typeof original!=='function'||original.__pf1aeWrapped)return false;
  const wrapped=function(...args){
    scLog(label+' intercepted',{argumentsCount:args.length});
    if(game.settings.get(SC_NS,'genericDebug'))
      console.debug('[PF1AE][SaveBridge] Saving throw requested',{handler:label,argumentsCount:args.length});
    try {scTrackNativeCall(label,args);}
    catch(error){scLog('Native handler context tracing failed',{error:error.message});}
    return original.apply(this,args);
  };
  Object.defineProperty(wrapped,'__pf1aeWrapped',{value:true});
  try {
    object[key]=wrapped;
    if(object[key]!==wrapped)return false;
    SC_WRAPPED.push({object,key,original,wrapped});
    scLog(label+' wrapper installed',{arity:original.length});
    return true;
  } catch(error){scLog(label+' cannot be wrapped',{reason:error.message});return false;}
}
function scInstallNativeWrappers() {
  // v11.10 API: targetSavingThrowClick(...). Some PF1 builds use the newer
  // Action chat handler. Do not guess parameters: delegate ALL original args.
  const old=globalThis.pf1?.utils?.chat;
  const newActions=globalThis.pf1?.chat?.Actions;
  const legacyWrapped=scWrap(old,'targetSavingThrowClick','targetSavingThrowClick');
  const actionWrapped=scWrap(newActions,'onRollSave','Actions.onRollSave');
  const matched=legacyWrapped||actionWrapped;
  if(!matched)scLog('No exported native save handler to wrap: reference hook remains active');
}
function scRestoreNativeWrappers() {
  for(const entry of SC_WRAPPED.splice(0))if(entry.object[entry.key]===entry.wrapped)
    entry.object[entry.key]=entry.original;
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
  Hooks.on('updateChatMessage',(message)=>{
    if(message.getFlag?.(SC_NS,'targetSaveResults') && typeof document!=='undefined') {
      // The native chat app normally re-renders after message.update().
      // Also refresh the current node for installations whose chat cards
      // are updated in-place rather than recreated.
      for(const el of document.querySelectorAll(`.chat-message[data-message-id="${message.id}"]`))
        scRenderTargetResults(message,el);
    }
  });
});
Hooks.once('ready',()=>{
  const mod=game.modules.get(SC_NS);
  if(!mod)return;
  mod.api??={};
  scInstallNativeWrappers();
  mod.api.saveContext=Object.freeze({
    _fromNativeSaveOptions:scFromNativeSaveOptions,
    _restoreWrappers:scRestoreNativeWrappers,
    _consumeForNativeSave:scConsume,
    fromMessage:message=>scNormalizeContext(scFromMessage(message))
  });
});
