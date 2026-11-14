/**
 * PF1AE — optional preferred Item action.
 * Foundry VTT 13 / PF1 11.11: delegates to native ItemPF.use({actionId}).
 * No action roll/charge/script implementation is replaced.
 */
const DA_NS='pf1-automation-engine';
const DA_FLAG='defaultActionId';
let DA_PATCHED=null;
const daActions=item=>[...(item?.actions?.contents??item?.actions?.values?.()??item?.actions??[])];
const daEnabled=()=>game.modules.get(DA_NS)?.active===true;
const daPreference=item=>{
 const saved=item?.getFlag?.(DA_NS,DA_FLAG);
 return typeof saved==='string'&&saved.length>0?saved:null;
};
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
function daInstall(){
 if(!daEnabled())return false;
 // PF1 11.11's ItemPF.use is the single native entry point that displays
 // ActionSelector.open only when actionId is absent.
 const cls=globalThis.pf1?.documents?.ItemPF??globalThis.CONFIG?.Item?.documentClass;
 const proto=cls?.prototype;
 if(!proto||typeof proto.use!=='function')return false;
 if(proto.use.pf1aeDefaultActionWrapped)return true;
 const native=proto.use;
 const wrapper=async function(options={}){
  // Do not interfere with explicit action selection or callers requesting
  // native skipDialog semantics. Leave Item.use options intact.
  if(!daEnabled()||!options||typeof options!=='object'||
    options.actionId!=null||options.skipDialog===true)
   return native.call(this,options);
  const id=daPreference(this);
  if(!id)return native.call(this,options);
  // An action deleted after configuration cannot leave the Item unusable.
  if(!daAction(this,id)){
   console.warn('[PF1AE][DefaultAction] Saved action missing: native selector restored',
    {itemUuid:this.uuid,actionId:id});
   return native.call(this,options);
  }
  return native.call(this,{...options,actionId:id});
 };
 Object.defineProperty(wrapper,'pf1aeDefaultActionWrapped',{value:true});
 Object.defineProperty(wrapper,'pf1aeOriginalUse',{value:native});
 proto.use=wrapper;
 DA_PATCHED={proto,native,wrapper};
 return true;
}
function daInstallSelector(){
 const selector=globalThis.pf1?.applications?.ActionSelector;
 if(!selector||typeof selector.open!=='function')return false;
 if(selector.open.pf1aeDefaultActionWrapped)return true;
 const native=selector.open;
 const wrapper=function(options,...args){
  // Selector.open is the authoritative entry point for the PF1 multi-action
  // picker. Some sheet buttons and integrations call it directly, without
  // entering ItemPF.use(). Return the native action ID so PF1 still owns rolls.
  const item=options?.document??options?.item;
  if(daEnabled()&&item?.documentName==='Item'){
   const id=daPreference(item);
   if(id&&daAction(item,id))return Promise.resolve(id);
  }
  return native.call(this,options,...args);
 };
 Object.defineProperty(wrapper,'pf1aeDefaultActionWrapped',{value:true});
 selector.open=wrapper;
 return true;
}
function daRender(sheet,html){
 if(!daEnabled())return;
 const item=sheet?.document??sheet?.item??sheet?.object;
 if(item?.documentName!=='Item'||!daIsOwner(item))return;
 const actions=daActions(item);
 if(actions.length<2)return;
 const root=html?.[0]??html??sheet?.element?.[0]??sheet?.element;
 if(!root?.querySelector)return;
 const advanced=root.querySelector('.sheet-body .tab[data-tab="advanced"]')??
  root.querySelector('.tab[data-tab="advanced"]')??
  root.querySelector('.tab.advanced');
 if(!advanced||advanced.querySelector('[data-pf1ae-default-action]'))return;
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
Hooks.once('ready',()=>{
 const mod=game.modules.get(DA_NS);
 if(!mod)return;
 mod.api??={};
 mod.api.defaultAction=Object.freeze({
  get:daPreference,set:daSet,resolve:daAction,
  installed:()=>DA_PATCHED?.proto?.use===DA_PATCHED?.wrapper
 });
 if(!daInstall()){
  console.warn('[PF1AE][DefaultAction] PF1 Item.use not available during ready.');
 }
 if(!daInstallSelector()){
  console.warn('[PF1AE][DefaultAction] PF1 ActionSelector.open not available during ready.');
 }
 Hooks.on('renderItemSheet',daRender);
 Hooks.on('renderItemSheetV2',daRender);
});
