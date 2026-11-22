/**
 * PF1AE — optional preferred Item action.
 * Foundry VTT 13 / PF1 11.11: delegates to native ItemPF.use({actionId}).
 * No action roll/charge/script implementation is replaced.
 */
const DA_NS='pf1-automation-engine';
const DA_FLAG='defaultActionId';
const DA_SKIP_FLAG='defaultActionSkipDialog';
let DA_PATCHED=null;
const daActions=item=>[...(item?.actions?.contents??item?.actions?.values?.()??item?.actions??[])];
const daEnabled=()=>game.modules.get(DA_NS)?.active===true;
const daPreference=item=>{
 const saved=item?.getFlag?.(DA_NS,DA_FLAG);
 return typeof saved==='string'&&saved.length>0?saved:null;
};
const daSkipDialog=item=>item?.getFlag?.(DA_NS,DA_SKIP_FLAG)===true;
async function daSetSkipDialog(item,enabled){
 if(!item||!daIsOwner(item))throw Error('Item OWNER permission required.');
 if(typeof enabled!=='boolean')throw TypeError('Skip dialog must be a boolean.');
 if(!enabled){await item.unsetFlag(DA_NS,DA_SKIP_FLAG);return false;}
 await item.setFlag(DA_NS,DA_SKIP_FLAG,true);
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
 if(!daEnabled()||!options||typeof options!=='object'||
    options.actionId!=null||options.skipDialog===true)return next(options);
 const id=daPreference(item);
 if(!id)return next(options);
 if(!daAction(item,id)){
  console.warn('[PF1AE][DefaultAction] Saved action missing: native selector restored',
   {itemUuid:item.uuid,actionId:id});
  return next(options);
 }
 return next({...options,actionId:id,
  ...(daSkipDialog(item)?{skipDialog:true}:{})});
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
 const id=daPreference(item);
 if(!id||!daSkipDialog(item)||!daAction(item,id)||
    (action?.id??action?._id)!==id)return;
 if(actionUse.pf1aeDefaultActionDialogWrapped)return;
 const native=actionUse.createAttackDialog;
 const wrapped=async function(...args){
  // The preference may change between hook dispatch and dialog creation.
  if(daEnabled()&&daSkipDialog(item)&&daPreference(item)===id){
   if(this.shared)this.shared.skipDialog=true;
   return {}; // Valid empty native PF1 dialog result; defaults remain in effect.
  }
  return native.apply(this,args);
 };
 Object.defineProperty(actionUse,'pf1aeDefaultActionDialogWrapped',{value:true});
 actionUse.createAttackDialog=wrapped;
}
function daRender(sheet,html){
 if(!daEnabled())return;
 const item=sheet?.document??sheet?.item??sheet?.object;
 if(item?.documentName!=='Item'||!daIsOwner(item))return;
 const actions=daActions(item);
 // A single native action is also configurable (e.g. skip-dialog), and
 // not all PF1 Item types expose two or more actions.
 if(actions.length===0)return;
 // Foundry v13/PF1 11.11 item sheets are ApplicationV2. Their official
 // renderApplication hook supplies an HTMLElement, and window.content is
 // the most reliable currently connected root. Legacy renderItemSheet
 // continues to supply jQuery HTML.
 const candidate=sheet?.window?.content??html?.[0]??html??
  sheet?.element?.[0]??sheet?.element;
 const root=candidate?.querySelector?candidate:
  candidate?.[0]?.querySelector?candidate[0]:null;
 if(!root)return;
 // Some ItemSheetV2 types have no Advanced tab (or render its contents
 // lazily). Fall back to a real content pane, never a nav tab anchor.
 const advanced=[
  '.sheet-body .tab[data-tab="advanced"]',
  '.tab[data-tab="advanced"]',
  '.tab.advanced',
  '.sheet-body .tab[data-tab="actions"]',
  '.tab[data-tab="actions"]',
  '.sheet-body .tab[data-tab="details"]',
  '.tab[data-tab="details"]',
  '.sheet-body .tab[data-tab="description"]',
  '.tab[data-tab="description"]',
  '.sheet-body',
  'form'
 ].map(selector=>root.querySelector(selector))
  .find(el=>el&&typeof el.append==='function')??root;
 if(root.querySelector('[data-pf1ae-default-action]'))return;
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
   skip.disabled=!selected;
  }).catch(error=>{
   select.value=previous;select.disabled=false;
   ui.notifications?.warn?.(error.message);
  });
 });
 fields.append(select);group.append(label,fields);
 const skipGroup=document.createElement('div');
 skipGroup.className='form-group';
 skipGroup.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-width:0;';
 const skipLabel=document.createElement('label');
 skipLabel.style.cssText='display:flex;align-items:center;gap:6px;min-width:0;cursor:pointer;';
 const skip=document.createElement('input');
 skip.type='checkbox';
 skip.dataset.pf1aeDefaultActionSkipDialog='true';
 skip.checked=daSkipDialog(item);
 skip.disabled=!current||!daAction(item,current);
 skip.setAttribute('aria-label',t('SkipDialog'));
 const skipText=document.createElement('span');
 skipText.textContent=t('SkipDialog');
 skipLabel.append(skip,skipText);
 skipGroup.append(skipLabel);
 const skipHint=document.createElement('p');
 skipHint.className='notes';
 skipHint.style.cssText='margin:2px 0 0;font-size:12px;';
 skipHint.textContent=t('SkipDialogHint');
 for(const type of ['click','pointerdown','mousedown'])
  skip.addEventListener(type,event=>event.stopPropagation());
 skip.addEventListener('change',event=>{
  event.stopPropagation();
  const checked=skip.checked,previous=daSkipDialog(item);
  skip.disabled=true;
  void daSetSkipDialog(item,checked).then(()=>{
   skip.disabled=!daPreference(item);
  }).catch(error=>{
   skip.checked=previous;
   skip.disabled=!daPreference(item);
   ui.notifications?.warn?.(error.message);
  });
 });
 const hint=document.createElement('p');
 hint.className='notes';
 hint.textContent=t('Hint');
 hint.style.cssText='margin:3px 0 0;font-size:12px;';
 section.append(heading,group,hint,skipGroup,skipHint);
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
Hooks.once('ready',()=>{
 const mod=game.modules.get(DA_NS);
 if(!mod)return;
 mod.api??={};
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
 // PF1 v11.11 WeaponSheetPF, EquipmentSheetPF, FeatSheetPF and other
 // ItemSheetV2 descendants primarily emit the generic ApplicationV2
 // render callback; V1-only hooks do not cover all Item types.
 Hooks.on('renderApplication',daRender);
});
