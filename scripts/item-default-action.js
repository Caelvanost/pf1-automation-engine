/**
 * PF1AE — optional preferred Item action.
 * Foundry VTT 13 / PF1 11.11: delegates to native ItemPF.use({actionId}).
 * No action roll/charge/script implementation is replaced.
 */
const DA_NS='pf1-automation-engine';
const DA_FLAG='defaultActionId';
const DA_SKIP_FLAG='defaultActionSkipDialog';
const DA_OPTIONS_FLAG='actionSkipDialog';
const DA_OPTIONS_MARK='pf1ae-action-skip-dialog';
let DA_PATCHED=null;
const daActions=item=>[...(item?.actions?.contents??item?.actions?.values?.()??item?.actions??[])];
const daEnabled=()=>game.modules.get(DA_NS)?.active===true;
const daPreference=item=>{
 const saved=item?.getFlag?.(DA_NS,DA_FLAG);
 return typeof saved==='string'&&saved.length>0?saved:null;
};
const daValidId=id=>typeof id==='string'&&id.length>0&&id.length<=150&&
 !['__proto__','constructor','prototype'].includes(id);
const daStoredOptions=item=>{
 const value=item?.getFlag?.(DA_NS,DA_OPTIONS_FLAG);
 return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
};
function daGetActionSkip(item,actionId){
 if(!daValidId(actionId)||!daAction(item,actionId))return false;
 const saved=daStoredOptions(item);
 if(Object.prototype.hasOwnProperty.call(saved,actionId))
  return saved[actionId]===true;
 // Legacy preference applies ONLY to its original default action.
 return daPreference(item)===actionId&&item?.getFlag?.(DA_NS,DA_SKIP_FLAG)===true;
}
const daSkipDialog=item=>daGetActionSkip(item,daPreference(item));
async function daPersistOptions(item,next){
 if(Object.keys(next).length)await item.setFlag(DA_NS,DA_OPTIONS_FLAG,next);
 else await item.unsetFlag(DA_NS,DA_OPTIONS_FLAG);
}
async function daMigrateLegacy(item){
 if(!item||!daIsOwner(item))return false;
 const legacy=item.getFlag?.(DA_NS,DA_SKIP_FLAG);
 if(legacy!==true&&legacy!==false)return false;
 const id=daPreference(item),options={...daStoredOptions(item)};
 if(id&&daAction(item,id)&&!Object.prototype.hasOwnProperty.call(options,id))
  options[id]=legacy===true;
 if(id&&daAction(item,id))await daPersistOptions(item,options);
 await item.unsetFlag(DA_NS,DA_SKIP_FLAG);
 return true;
}
async function daSetActionSkip(item,actionId,enabled){
 if(!item||!daIsOwner(item))throw Error('Item OWNER permission required.');
 if(!daValidId(actionId)||!daAction(item,actionId))
  throw Error('Selected action no longer exists on this Item.');
 if(typeof enabled!=='boolean')throw TypeError('Skip dialog must be a boolean.');
 // Preserve the former default-action preference before retiring its flag.
 const options={...daStoredOptions(item)};
 const legacyId=daPreference(item),legacy=item.getFlag?.(DA_NS,DA_SKIP_FLAG);
 if(legacyId&&daAction(item,legacyId)&&
    !Object.prototype.hasOwnProperty.call(options,legacyId)&&legacy===true)
  options[legacyId]=true;
 if(enabled)options[actionId]=true;
 else delete options[actionId];
 await daPersistOptions(item,options);
 if(legacy!=null)await item.unsetFlag(DA_NS,DA_SKIP_FLAG);
 return enabled;
}
async function daSetSkipDialog(item,enabled){
 if(!item||!daIsOwner(item))throw Error('Item OWNER permission required.');
 if(typeof enabled!=='boolean')throw TypeError('Skip dialog must be a boolean.');
 const id=daPreference(item);
 // Compatibility with old callers that set the legacy flag before selecting
 // a default action. The next actionable read/migration will resolve it.
 if(!id||!daAction(item,id)){
  if(enabled)await item.setFlag(DA_NS,DA_SKIP_FLAG,true);
  else await item.unsetFlag(DA_NS,DA_SKIP_FLAG);
  return enabled;
 }
 return daSetActionSkip(item,id,enabled);
}
async function daPruneOptions(item){
 if(!daIsOwner(item))return false;
 const previous=daStoredOptions(item);
 const valid=new Set(daActions(item).map(a=>a.id??a._id));
 const next=Object.fromEntries(Object.entries(previous)
  .filter(([id,v])=>valid.has(id)&&v===true));
 if(Object.keys(previous).length===Object.keys(next).length)return false;
 await daPersistOptions(item,next);
 return true;
}
const daAction=(item,id)=>id ? item?.actions?.get?.(id) ??
 daActions(item).find(a=>(a.id??a._id)===id)??null:null;
const daIsOwner=item=>game.user?.isGM===true||
 item?.testUserPermission?.(game.user,'OWNER')===true||
 item?.actor?.testUserPermission?.(game.user,'OWNER')===true;
async function daSet(item,actionId){
 if(!item||!daIsOwner(item))throw Error('Item OWNER permission required.');
 const id=actionId==null||actionId===''?null:String(actionId);
 if(id&&!daAction(item,id))throw Error('Selected action no longer exists on this Item.');
 if(!id){await item.unsetFlag(DA_NS,DA_FLAG);return null;}
 await item.setFlag(DA_NS,DA_FLAG,id);
 return id;
}
// PF1 11.11 publishes the actual ItemPF constructor under documents.item.
// CONFIG.Item.documentClass is ItemBasePF, which does not implement use().
const DA_USE_PATH='pf1.documents.item.ItemPF.prototype.use';
const DA_SELECTOR_PATH='pf1.applications.ActionSelector.open';
let DA_SELECTOR_PATCHED=null;
const daItemClass=()=>globalThis.pf1?.documents?.item?.ItemPF??
 globalThis.pf1?.documents?.ItemPF??null;
const daWrapperAvailable=()=>game.modules.get('lib-wrapper')?.active===true&&
 typeof globalThis.libWrapper?.register==='function';
function daUse(item,options,next){
 if(!daEnabled()||!options||typeof options!=='object')return next(options);
 const explicit=options.actionId;
 if(explicit!=null){
  if(options.skipDialog===true||!daGetActionSkip(item,explicit))return next(options);
  return next({...options,skipDialog:true});
 }
 if(options.skipDialog===true)return next(options);
 const id=daPreference(item);
 if(!id){
  // Single-action items can skip immediately without a selector.
  const actions=daActions(item);
  if(actions.length===1&&daGetActionSkip(item,actions[0].id??actions[0]._id))
   return next({...options,skipDialog:true});
  return next(options);
 }
 if(!daAction(item,id)){
  console.warn('[PF1AE][DefaultAction] Saved action missing: native selector restored',
   {itemUuid:item.uuid,actionId:id});
  return next(options);
 }
 return next({...options,actionId:id,
  ...(daGetActionSkip(item,id)?{skipDialog:true}:{})});
}
function daInstall(){
 if(!daEnabled())return false;
 if(DA_PATCHED?.mode==='libWrapper')return true;
 if((DA_PATCHED?.mode==='direct'||DA_PATCHED?.mode==='external')&&
    DA_PATCHED.proto?.use===DA_PATCHED.wrapper)return true;
 const cls=daItemClass();
 // Do not incorrectly patch ItemBasePF, which has no use() method.
 if(!cls||typeof cls.prototype?.use!=='function')return false;
 if(daWrapperAvailable()){
  try{
   const registerId=globalThis.libWrapper.register(
    DA_NS,DA_USE_PATH,function(wrapped,options={},...args){
     return daUse(this,options,nextOptions=>wrapped(nextOptions,...args));
    },'WRAPPER');
   DA_PATCHED={mode:'libWrapper',target:DA_USE_PATH,registerId};
   return true;
  }catch(error){
   console.warn('[PF1AE][DefaultAction] libWrapper registration failed; using direct fallback.',error);
  }
 }
 const proto=cls.prototype;
 if(proto.use?.pf1aeDefaultActionWrapped){
  DA_PATCHED={mode:'external',proto,wrapper:proto.use};
  return true;
 }
 const native=proto.use;
 const wrapper=function(options={},...args){
  return daUse(this,options,nextOptions=>native.call(this,nextOptions,...args));
 };
 Object.defineProperty(wrapper,'pf1aeDefaultActionWrapped',{value:true});
 Object.defineProperty(wrapper,'pf1aeOriginalUse',{value:native});
 try{
  proto.use=wrapper;
  if(proto.use!==wrapper)return false;
  DA_PATCHED={mode:'direct',proto,native,wrapper};
  return true;
 }catch(error){
  console.warn('[PF1AE][DefaultAction] Direct ItemPF.use fallback failed.',error);
  return false;
 }
}
function daInstallSelector(){
 if(DA_SELECTOR_PATCHED?.mode==='libWrapper')return true;
 if((DA_SELECTOR_PATCHED?.mode==='direct'||DA_SELECTOR_PATCHED?.mode==='external')&&
    DA_SELECTOR_PATCHED.selector?.open===DA_SELECTOR_PATCHED.wrapper)return true;
 const selector=globalThis.pf1?.applications?.ActionSelector;
 if(!selector||typeof selector.open!=='function')return false;
 const resolve=(options,next)=>{
  const item=options?.document??options?.item;
  if(daEnabled()&&item?.documentName==='Item'){
   const id=daPreference(item);
   if(id&&daAction(item,id))return Promise.resolve(id);
  }
  return next();
 };
 if(daWrapperAvailable()){
  try{
   const registerId=globalThis.libWrapper.register(
    DA_NS,DA_SELECTOR_PATH,function(wrapped,options,...args){
     return resolve(options,()=>wrapped(options,...args));
    },'MIXED'); // A valid default deliberately bypasses the picker.
   DA_SELECTOR_PATCHED={mode:'libWrapper',target:DA_SELECTOR_PATH,registerId};
   return true;
  }catch(error){
   console.warn('[PF1AE][DefaultAction] Selector libWrapper registration failed; using direct fallback.',error);
  }
 }
 if(selector.open.pf1aeDefaultActionWrapped){
  DA_SELECTOR_PATCHED={mode:'external',selector,wrapper:selector.open};
  return true;
 }
 const native=selector.open;
 const wrapper=function(options,...args){
  return resolve(options,()=>native.call(this,options,...args));
 };
 Object.defineProperty(wrapper,'pf1aeDefaultActionWrapped',{value:true});
 selector.open=wrapper;
 DA_SELECTOR_PATCHED={mode:'direct',selector,native,wrapper};
 return selector.open===wrapper;
}
const daInstallStatus=()=>({
 itemUse:DA_PATCHED?.mode==='libWrapper'||
  (!!DA_PATCHED?.proto&&DA_PATCHED.proto.use===DA_PATCHED.wrapper),
 selector:DA_SELECTOR_PATCHED?.mode==='libWrapper'||
  (!!DA_SELECTOR_PATCHED?.selector&&DA_SELECTOR_PATCHED.selector.open===DA_SELECTOR_PATCHED.wrapper),
 mode:DA_PATCHED?.mode??'unavailable',
 selectorMode:DA_SELECTOR_PATCHED?.mode??'unavailable'
});
/**
 * PF1's ItemPF.use resolves skipDialog BEFORE awaiting ActionSelector.open.
 * When ActionSelector chooses our default, the already captured option can
 * still be false. Use PF1's native pre-roll hook to suppress only the
 * configuration UI on the selected ActionUse, leaving process(), attack
 * preparation, script calls and deductions entirely native.
 */
function daConfigureActionUse(actionUse){
 if(!daEnabled()||!actionUse||typeof actionUse.createAttackDialog!=='function')return;
 const item=actionUse.item??actionUse.shared?.item;
 const action=actionUse.action??actionUse.shared?.action;
 const id=action?.id??action?._id;
 if(!id||!daGetActionSkip(item,id))return;
 if(actionUse.pf1aeDefaultActionDialogWrapped)return;
 const native=actionUse.createAttackDialog;
 const wrapped=async function(...args){
  // The preference may change between hook dispatch and dialog creation.
  if(daEnabled()&&daGetActionSkip(item,id)){
   if(this.shared)this.shared.skipDialog=true;
   return {}; // Valid empty native PF1 dialog result; defaults remain in effect.
  }
  return native.apply(this,args);
 };
 Object.defineProperty(actionUse,'pf1aeDefaultActionDialogWrapped',{value:true});
 actionUse.createAttackDialog=wrapped;
}
/**
 * Only the top-level native PF1 Item sheet owns this control. In particular,
 * action/attack editors can expose their parent Item and are also
 * ApplicationV2 instances; the generic render hook must never inject there.
 */
function daIsItemSheet(sheet){
 if(sheet?.action||sheet?.actionId||sheet?.itemAction)return false;
 const itemSheets=globalThis.pf1?.applications?.item;
 const base=itemSheets?.abstract?.ItemSheetPF??itemSheets?.ItemSheetPF;
 if(typeof base==='function')return sheet instanceof base;
 // Defensive fallback when the PF1 public base has not been exported.
 // Never treat an arbitrary ApplicationV2 that references an Item as a sheet.
 const name=sheet?.constructor?.name??'';
 return /SheetPF(?:_|$)/.test(name)&&
  !/(?:Action|Attack|Dialog|Selector)/i.test(name);
}
function daRender(sheet,html){
 if(!daEnabled()||!daIsItemSheet(sheet))return;
 const item=sheet?.document??sheet?.item??sheet?.object;
 if(item?.documentName!=='Item'||!daIsOwner(item))return;
 const candidate=sheet?.window?.content??html?.[0]??html??
  sheet?.element?.[0]??sheet?.element;
 const root=candidate?.querySelector?candidate:
  candidate?.[0]?.querySelector?candidate[0]:null;
 if(!root)return;
 const existing=root.querySelector('[data-pf1ae-default-action]');
 const actions=daActions(item);
 // A native action selector is only useful if there is a choice.
 if(actions.length<=1){
  existing?.remove?.();
  return;
 }
 // Absolutely no fallback to Actions, Details, Description or the root:
 // the control is exclusively part of the native Advanced tab content.
 const advanced=[
  '.sheet-body .tab[data-tab="advanced"]',
  '.tab[data-tab="advanced"]',
  '.tab.advanced'
 ].map(selector=>root.querySelector(selector))
  .find(el=>el&&typeof el.append==='function'&&
   !el.closest?.('nav, .tabs, .sheet-navigation'));
 if(!advanced){
  existing?.remove?.();
  return;
 }
 if(existing){
  if(advanced.contains?.(existing))return;
  existing.remove?.();
 }
 const t=key=>game.i18n.localize('PF1AE.DefaultAction.'+key);
 // Use the same native heading and form layout as the other PF1 Advanced
 // sections (e.g. Script and Little Helper), without a bordered card.
 const section=document.createElement('div');
 section.dataset.pf1aeDefaultAction='true';
 section.className='pf1ae-default-action';
 section.style.cssText='margin-top:10px;clear:both;width:100%;box-sizing:border-box;';
 const heading=document.createElement('h3');
 heading.className='section-header';
 heading.style.cssText='margin:0 0 6px;padding-bottom:3px;border-bottom:1px solid var(--color-border-light-primary,#888);';
 const icon=document.createElement('i');
 icon.className='fa-solid fa-crosshairs';
 icon.setAttribute('aria-hidden','true');
 heading.append(icon,document.createTextNode(' '+t('Section')));
 const group=document.createElement('div');
 group.className='form-group';
 group.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0;';
 const label=document.createElement('label');
 label.textContent=t('Label');
 label.style.cssText='flex:0 0 auto;min-width:0;';
 const fields=document.createElement('div');
 fields.className='form-fields';
 fields.style.cssText='flex:1 1 160px;min-width:0;';
 const select=document.createElement('select');
 select.dataset.pf1aeDefaultActionSelect='true';
 select.setAttribute('aria-label',t('Label'));
 select.style.cssText='width:100%;min-width:120px;box-sizing:border-box;';
 const option=(id,text)=>{
  const node=document.createElement('option');
  node.value=id;node.textContent=text;select.append(node);
 };
 option('',t('AskEachTime'));
 for(const action of actions)option(action.id??action._id,action.name??action.id);
 const current=daPreference(item);
 if(current&&!daAction(item,current))option(current,t('MissingAction'));
 select.value=current??'';
 for(const type of ['click','pointerdown','mousedown'])
  select.addEventListener(type,event=>event.stopPropagation());
 select.addEventListener('change',event=>{
  event.stopPropagation();
  const selected=select.value,previous=daPreference(item)??'';
  select.disabled=true;
  void daSet(item,selected).then(()=>{
   select.disabled=false;

  }).catch(error=>{
   select.value=previous;select.disabled=false;
   ui.notifications?.warn?.(error.message);
  });
 });
 fields.append(select);group.append(label,fields);
 const hint=document.createElement('p');
 hint.className='notes';
 hint.textContent=t('Hint');
 hint.style.cssText='margin:3px 0 0;font-size:12px;';
 section.append(heading,group,hint);
 // Insert in the native content flow rather than after an outer scroll wrapper.
 const nativeFields=[...advanced.querySelectorAll('input, select, textarea')]
  .filter(el=>!el.closest('[data-pf1ae-default-action]'));
 const last=nativeFields.at(-1);
 const row=last?.closest('.form-group, .form-group-stacked, .form-row, .form-field')??
  last?.parentElement;
 if(row?.parentElement&&advanced.contains(row.parentElement)){
  row.insertAdjacentElement('afterend',section);
 }else{
  advanced.append(section);
 }
}
/**
 * Native PF1 11.11 ItemActionSheet is a FormApplication with getters
 * action, item and isEditable. The Use tab is resolved through its native
 * tab navigation by data-tab, not through a global CSS or parent Item sheet.
 */
function daIsActionSheet(sheet){
 const cls=globalThis.pf1?.applications?.component?.ItemActionSheet;
 if(typeof cls==='function')return sheet instanceof cls;
 return sheet?.constructor?.name==='ItemActionSheet'&&
  sheet?.action?.id!=null&&sheet?.item?.documentName==='Item';
}
function daActionUsageTab(root){
 const candidates=['use','usage','utilisation'];
 for(const key of candidates){
  const tab=root.querySelector('.tab[data-tab="'+key+'"]');
  if(tab&&typeof tab.append==='function'&&!tab.closest?.('nav, .tabs, .sheet-navigation'))
   return tab;
 }
 // Native tab-key mapping, for forks that rename the ID while keeping
 // the Use/Usage/Utilisation label. Never inject into another tab.
 const nav=[...root.querySelectorAll?.('[data-tab]')??[]]
  .filter(node=>node.closest?.('nav, .tabs, .sheet-navigation'));
 const match=nav.find(node=>/^(use|usage|utilisation)$/i.test(
  String(node.textContent??'').trim()));
 const key=match?.dataset?.tab;
 return key?root.querySelector('.tab[data-tab="'+CSS.escape(key)+'"]'):null;
}
function daRenderActionSheet(sheet,html){
 if(!daEnabled()||!daIsActionSheet(sheet))return;
 const item=sheet.item,action=sheet.action;
 const id=action?.id??action?._id;
 if(!id||!daAction(item,id))return;
 const candidate=html?.[0]??html??sheet?.element?.[0]??sheet?.element;
 const root=candidate?.querySelector?candidate:
  candidate?.[0]?.querySelector?candidate[0]:null;
 if(!root)return;
 const tab=daActionUsageTab(root);
 const previous=root.querySelector('[data-pf1ae-action-skip-dialog]');
 if(!tab){previous?.remove?.();return}
 if(previous&&!tab.contains(previous))previous.remove();
 const editable=daIsOwner(item)&&sheet.isEditable!==false;
 const existing=tab.querySelector('[data-pf1ae-action-skip-dialog]');
 if(existing){
  const box=existing.querySelector('input[type="checkbox"]');
  if(box){box.checked=daGetActionSkip(item,id);box.disabled=!editable}
  return;
 }
 const t=key=>game.i18n.localize('PF1AE.ActionOptions.'+key);
 const section=document.createElement('div');
 section.dataset.pf1aeActionSkipDialog='true';
 section.className='form-group pf1ae-action-skip-dialog';
 const label=document.createElement('label');
 label.style.cssText='display:flex;align-items:center;gap:6px';
 const box=document.createElement('input');
 box.type='checkbox';
 box.checked=daGetActionSkip(item,id);
 box.disabled=!editable;
 box.setAttribute('aria-label',t('SkipDialog'));
 const text=document.createElement('span');
 text.textContent=t('SkipDialog');
 label.append(box,text);
 const hint=document.createElement('p');
 hint.className='notes';
 hint.textContent=t('Hint');
 box.setAttribute('title',t('Hint'));
 for(const type of ['click','pointerdown','mousedown'])
  box.addEventListener(type,event=>event.stopPropagation());
 box.addEventListener('change',event=>{
  event.stopPropagation();
  const desired=box.checked,previous=daGetActionSkip(item,id);
  box.disabled=true;
  void daSetActionSkip(item,id,desired).then(()=>{
   box.disabled=!daIsOwner(item)||sheet.isEditable===false;
  }).catch(error=>{
   box.checked=previous;
   box.disabled=!daIsOwner(item)||sheet.isEditable===false;
   globalThis.ui?.notifications?.warn?.(error.message);
  });
 });
 section.append(label,hint);
 tab.append(section); // bottom of the native Use tab
}
Hooks.once('ready',()=>{
 const mod=game.modules.get(DA_NS);
 if(!mod)return;
 mod.api??={};
 mod.api.actionOptions=Object.freeze({
  getSkipDialog:daGetActionSkip,setSkipDialog:daSetActionSkip,
  migrate:daMigrateLegacy,prune:daPruneOptions,
  isAvailable:()=>daEnabled()&&daInstallStatus().itemUse===true
 });
 mod.api.defaultAction=Object.freeze({
  get:daPreference,set:daSet,resolve:daAction,
  getSkipDialog:daSkipDialog,setSkipDialog:daSetSkipDialog,
  installed:()=>daInstallStatus().itemUse===true,
  status:daInstallStatus
 });
 if(!daInstall()){
  console.warn('[PF1AE][DefaultAction] PF1 ItemPF.use not available on the PF1 ItemPF class during ready.');
 }
 if(!daInstallSelector()){
  console.warn('[PF1AE][DefaultAction] PF1 ActionSelector.open not available during ready.');
 }
 Hooks.on('pf1CreateActionUse',daConfigureActionUse);
 Hooks.on('renderItemSheet',daRender);
 Hooks.on('renderItemSheetV2',daRender);
 // PF1 native ItemSheetV2 subclasses emit renderApplication; only those
 // sheets with an Advanced tab and multiple actions are eligible.
 Hooks.on('renderApplication',daRender);
 Hooks.on('renderItemActionSheet',daRenderActionSheet);
 Hooks.on('renderApplication',daRenderActionSheet);
 Hooks.on('updateItem',(item,change)=>{
  if(change?.system?.actions!=null)
   void daPruneOptions(item).catch(error=>
    console.warn('[PF1AE][ActionOptions] prune failed',error));
 });
 // Only the elected GM migrates pre-existing world-owned Items, preserving
 // the historical setting for imported/compendium Items until first edit.
 const leader=[...(game.users??[])].filter(user=>user.active&&user.isGM)
  .sort((a,b)=>String(a.id).localeCompare(String(b.id)))[0];
 if(leader?.id===game.user?.id){
  for(const actor of game.actors??[])
   for(const item of actor.items??[])
    if(item.getFlag?.(DA_NS,DA_SKIP_FLAG)!=null)
     void daMigrateLegacy(item).catch(error=>
      console.warn('[PF1AE][ActionOptions] migration failed',item.uuid,error));
 }

});
