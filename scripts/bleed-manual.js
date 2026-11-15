/**
 * PF1AE v1.30.0 — manual native PF1 Bleed bridge.
 *
 * pf1ToggleActorCondition is the condition signal (not a blanket Actor
 * observer). preUpdateActor/updateActor supply local origin attribution:
 * PF1's condition hook has no userId and may fire on multiple clients.
 */
const MB_NS='pf1-automation-engine';
const MB_FLAG='manualBleed';
const MB_PENDING=new Map();
const MB_INFLIGHT=new Set();
const MB_SUPPRESS=new Map();
const MB_TTL=1200;

const mbEnabled=()=>{
 try{return game.modules.get(MB_NS)?.active===true &&
   game.settings.get(MB_NS,'genericEnabled')!==false}
 catch(_){return false}
};
const mbAuthorized=actor=>!!actor&&
 (game.user?.isGM===true||actor.testUserPermission?.(game.user,'OWNER')===true);
const mbKey=actor=>actor?.uuid??null;
const mbItems=actor=>[...(actor?.items?.contents??actor?.items?.values?.()??[])];
const mbManual=actor=>mbItems(actor).filter(i=>i?.type==='buff'&&
 i.getFlag?.(MB_NS,MB_FLAG)?.generated===true);
const mbNative=actor=>[...(actor?.effects?.contents??actor?.effects?.values?.()??[])]
 .find(effect=>effect?.documentName==='ActiveEffect'&&
   effect.statuses?.has?.('bleed')===true&&effect.disabled!==true)??null;
const mbActive=item=>item?.activeState===true||item?.system?.active===true;
const mbFormula=input=>{
 const formula=typeof input==='string'?input.trim():'';
 if(!formula||formula.length>100||typeof Roll?.validate!=='function'||
    !Roll.validate(formula))throw Error('Formule de saignement invalide.');
 // Construct, but do not evaluate. The original input is preserved.
 new Roll(formula);
 return formula;
};
const mbAEActor=effect=>{
 const parent=effect?.parent??effect?.actor;
 return parent?.documentName==='Actor'?parent:null;
};
const mbAEHasBleed=effect=>{
 const statuses=effect?.statuses;
 if(statuses?.has?.('bleed'))return true;
 const sourceStatuses=effect?._source?.statuses;
 return Array.isArray(sourceStatuses)&&sourceStatuses.includes('bleed');
};
const mbAEChange=(effect,changes,operation)=>{
 if(operation==='create')return mbAEHasBleed(effect)?true:null;
 if(operation==='delete')return mbAEHasBleed(effect)?false:null;
 const statuses=changes?.statuses??changes?.['statuses'];
 if(!Array.isArray(statuses))return null;
 return statuses.includes('bleed');
};
const mbChanged=(changes)=>{
 const data=changes?.system?.conditions?.bleed ??
  changes?.['system.conditions.bleed'] ??
  changes?.['system.conditions']?.bleed;
 return typeof data==='boolean'?data:null;
};
function mbPending(actor,state,kind){
 const key=mbKey(actor);
 if(!key)return;
 const old=MB_PENDING.get(key)??{};
 const entry={...old,actor,at:Date.now()};
 entry[kind]=state;
 MB_PENDING.set(key,entry);
}
const mbSuppressed=(actor,state)=>{
 const marker=MB_SUPPRESS.get(mbKey(actor));
 if(!marker)return false;
 if(Date.now()>marker.expires){MB_SUPPRESS.delete(mbKey(actor));return false}
 if(marker.state===state){MB_SUPPRESS.delete(mbKey(actor));return true}
 return false;
};
async function mbSetCondition(actor,state){
 const key=mbKey(actor);
 MB_SUPPRESS.set(key,{state,expires:Date.now()+4000});
 try{
  if(typeof actor.setCondition==='function')
   await actor.setCondition('bleed',state);
  else throw Error('Native PF1 Actor.setCondition unavailable.');
 }finally{
  // Guard remains briefly in case PF1 fires the native hook after the
  // setCondition Promise resolves. It expires automatically.
 }
}
async function mbDeactivate(item){
 if(typeof item.setActive==='function')await item.setActive(false);
 else await item.update({'system.active':false});
}
async function mbActivate(item){
 if(typeof item.setActive==='function')await item.setActive(true);
 else await item.update({'system.active':true});
}
function mbDialog(){
 const DialogV2=foundry?.applications?.api?.DialogV2;
 if(typeof DialogV2?.wait!=='function')
  throw Error('Foundry V13 DialogV2 unavailable.');
 return DialogV2;
}
async function mbPrompt(){
 const DialogV2=mbDialog();
 for(;;){
  const entry=await DialogV2.wait({
   window:{title:'🩸 Saignement'},
   content:'<div class="form-group"><label for="pf1ae-bleed-formula">Valeur du saignement</label>'+
    '<input id="pf1ae-bleed-formula" name="formula" type="text" value="1" '+
    'autocomplete="off" autofocus required />'+
    '<p class="hint">Exemples : 1, 1d4, 2d6+1</p></div>',
   buttons:[
    {action:'cancel',label:'Annuler',callback:()=>null},
    {action:'apply',label:'Appliquer',default:true,
     callback:(_event,button)=>button.form?.elements?.formula?.value??''}
   ],
   rejectClose:false,modal:true
  });
  if(entry===null||entry==='cancel')return null;
  try{return mbFormula(entry)}
  catch(error){ui.notifications?.error?.(error.message);}
 }
}
async function mbCreate(actor,formula){
 const api=game.modules.get(MB_NS)?.api?.bleed;
 if(typeof api?.configure!=='function')throw Error('PF1AE Bleed API unavailable.');
 if(!mbAuthorized(actor))throw Error('Actor OWNER permission is required.');
 const native=mbNative(actor);
 if(!native)throw Error('Native PF1 Bleed ActiveEffect not found.');
 // The native condition is the only mechanical source and only visible
 // status. Do not create an Item Buff (the extra neutral HUD icon).
 const configured=await api.configure({
  effect:native,type:'hp',formula,stacking:'highest'
 });
 await native.setFlag(MB_NS,MB_FLAG,{generated:true});
 // Migrate ONLY old generated manual Buffs. Never touch a spell/ability Buff.
 // Deactivate first; then delete legacy Items so they cannot linger in an
 // active-effects sidebar despite hideFromToken=true.
 for(const legacy of mbManual(actor)){
  if(mbActive(legacy))await mbDeactivate(legacy);
  if(typeof legacy.delete==='function')await legacy.delete();
 }
 return configured;
}
async function mbRemove(actor){
 if(!mbAuthorized(actor))return;
 // PF1 removes/disables the native status itself. Its flags go with it.
 // Existing generated v1.31 Buffs still get cleaned on manual removal.
 for(const legacy of mbManual(actor)){
  if(mbActive(legacy))await mbDeactivate(legacy);
  if(typeof legacy.delete==='function')await legacy.delete();
 }
}
async function mbMigrate(actor){
 if(!mbAuthorized(actor))return {migrated:false};
 const native=mbNative(actor);
 if(!native)return {migrated:false};
 const existing=native.getFlag?.(MB_NS,'bleed');
 const legacy=mbManual(actor).find(item=>
  item.getFlag?.(MB_NS,'bleed')?.enabled===true);
 if(!legacy)return {migrated:false};
 // Preserve a newer native configuration if one already exists.
 if(!existing?.enabled){
  const old=legacy.getFlag(MB_NS,'bleed');
  await game.modules.get(MB_NS)?.api?.bleed?.configure({
   effect:native,type:'hp',formula:old.formula,stacking:'highest'
  });
  await native.setFlag(MB_NS,MB_FLAG,{generated:true});
 }
 for(const item of mbManual(actor)){
  if(mbActive(item))await mbDeactivate(item);
  if(typeof item.delete==='function')await item.delete();
 }
 return {migrated:true};
}
async function mbMigrateAll(){
 if(!game.user?.isGM)return;
 const actors=new Map();
 const add=a=>{if(a?.documentName==='Actor'&&a.uuid)actors.set(a.uuid,a)};
 for(const actor of game.actors?.contents??[])add(actor);
 for(const scene of game.scenes?.contents??[])
  for(const token of scene.tokens?.contents??[])add(token.actor??token.object?.actor);
 for(const actor of actors.values())
  try{await mbMigrate(actor)}
  catch(error){console.warn('[PF1AE][ManualBleed] Migration deferred',actor.uuid,error)}
}
async function mbHandle(actor,state){
 const key=mbKey(actor);
 if(!key||MB_INFLIGHT.has(key)||!mbEnabled()||!mbAuthorized(actor)||
    mbSuppressed(actor,state))return;
 MB_INFLIGHT.add(key);
 try{
  if(!state){await mbRemove(actor);return}
  if(mbNative(actor)?.getFlag?.(MB_NS,MB_FLAG)?.generated===true)return;
  const formula=await mbPrompt();
  if(formula===null){
   await mbSetCondition(actor,false);
   return;
  }
  try{await mbCreate(actor,formula)}
  catch(error){
   ui.notifications?.error?.('Saignement : '+String(error.message??error));
   await mbSetCondition(actor,false);
  }
 }catch(error){
  console.error('[PF1AE][ManualBleed] Failed condition workflow',error);
  ui.notifications?.error?.('Saignement : '+String(error.message??error));
 }finally{MB_INFLIGHT.delete(key);}
}
function mbReconcile(actor){
 const key=mbKey(actor),entry=MB_PENDING.get(key);
 if(!entry||!mbEnabled())return;
 // Both the native PF1 hook and the authenticated local Actor update must
 // agree on the new state. The origin userId cannot be supplied by the
 // condition hook and is not accepted from a socket payload.
 if(entry.native!==entry.local)return;
 if(typeof entry.native!=='boolean'||Date.now()-entry.at>MB_TTL){
  MB_PENDING.delete(key);return;
 }
 MB_PENDING.delete(key);
 if(mbSuppressed(actor,entry.native))return;
 void mbHandle(actor,entry.native);
}
Hooks.once('init',()=>{
 Hooks.on('preUpdateActor',(actor,changes,options,userId)=>{
  if(!mbEnabled()||userId!==game.user?.id||!mbAuthorized(actor)||
     options?.[MB_NS]?.skipManualBleed===true)return;
  const state=mbChanged(changes);
  if(state===null)return;
  mbPending(actor,state,'local');
  mbReconcile(actor);
 });
 Hooks.on('pf1ToggleActorCondition',(actor,condition,state)=>{
  if(condition!=='bleed'||typeof state!=='boolean'||!mbEnabled())return;
  if(mbSuppressed(actor,state))return;
  mbPending(actor,state,'native');
  mbReconcile(actor);
 });
 // PF1 v11 models its native conditions as ActiveEffects. The
 // pf1ToggleActorCondition hook is emitted for these descendant changes,
 // not necessarily for changes to actor.system.conditions.
 for(const [name,operation] of [
  ['createActiveEffect','create'],
  ['deleteActiveEffect','delete'],
  ['updateActiveEffect','update']
 ]){
  Hooks.on(name,(effect,changesOrOptions,optionsOrUserId,userIdMaybe)=>{
   const actor=mbAEActor(effect);
   if(!actor||!mbAuthorized(actor))return;
   const changed=operation==='update'?changesOrOptions:null;
   const options=operation==='update'?optionsOrUserId:changesOrOptions;
   const userId=operation==='update'?userIdMaybe:optionsOrUserId;
   if(userId!==game.user?.id||
      options?.[MB_NS]?.skipManualBleed===true)return;
   const state=mbAEChange(effect,changed,operation);
   if(state===null)return;
   mbPending(actor,state,'local');
   mbReconcile(actor);
  });
 }
 Hooks.on('updateActor',(actor,changes,options,userId)=>{
  // Attribution check only for Bleed condition changes, not a generic
  // observer processing every Actor update.
  const state=mbChanged(changes);
  if(state===null||userId!==game.user?.id||
     options?.[MB_NS]?.skipManualBleed===true)return;
  mbPending(actor,state,'local');
  mbReconcile(actor);
 });
});
Hooks.once('ready',()=>{
 const mod=game.modules.get(MB_NS);if(!mod)return;
 mod.api??={};
 mod.api.manualBleed=Object.freeze({
  validate:mbFormula,
  list:mbManual,
  configure:mbCreate,
  native:mbNative,
  migrate:mbMigrate,
  deactivate:mbRemove
 });
 void mbMigrateAll();
});
