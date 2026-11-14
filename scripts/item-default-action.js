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
function daRender(sheet,html){
 if(!daEnabled())return;
 const item=sheet?.document??sheet?.item??sheet?.object;
 if(item?.documentName!=='Item'||!daIsOwner(item))return;
 const actions=daActions(item);
 if(actions.length<2)return; // Native PF1 already uses the only action.
 const root=html?.[0]??html??sheet?.element?.[0]??sheet?.element;
 if(!root?.querySelector)return;
 // Add the preference to the very end of the native Advanced tab,
 // not to the Actions list. Never attach it to the tab navigation.
 const advanced=root.querySelector('.sheet-body .tab[data-tab="advanced"]')??
  root.querySelector('.tab[data-tab="advanced"]')??
  root.querySelector('.tab.advanced');
 if(!advanced||advanced.querySelector('[data-pf1ae-default-action]'))return;
 const section=document.createElement('section');
 section.dataset.pf1aeDefaultAction='true';
 section.className='pf1ae-default-action-section';
 section.style.cssText='margin:12px 0 0;padding:10px;border:1px solid var(--color-border-light-primary,#888);'+
  'border-radius:4px;box-sizing:border-box;clear:both;';
 const heading=document.createElement('h3');
 heading.style.cssText='margin:0 0 8px;font-size:14px;border-bottom:1px solid var(--color-border-light-primary,#888);padding-bottom:4px;';
 heading.textContent='PF1 Automation Engine — '+
  (game.i18n?.localize?.('PF1AE.DefaultAction.Label')??'Preferred action');
 const field=document.createElement('div');
 field.style.cssText='display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;';
 const label=document.createElement('label');
 label.style.cssText='font-size:12px;font-weight:600;flex:0 0 auto;';
 label.textContent=game.i18n?.localize?.('PF1AE.DefaultAction.Label')??'Preferred action';
 const select=document.createElement('select');
 select.dataset.pf1aeDefaultActionSelect='true';
 select.style.cssText='min-width:130px;max-width:100%;flex:1 1 170px;box-sizing:border-box;height:26px;font-size:12px;';
 const option=(id,text)=>{
  const o=document.createElement('option');o.value=id;o.textContent=text;select.append(o);
 };
 option('',game.i18n?.localize?.('PF1AE.DefaultAction.AskEachTime')??'Ask each time');
 for(const action of actions)option(action.id??action._id,action.name??action.id);
 const current=daPreference(item);
 if(current&&!daAction(item,current)){
  option(current,game.i18n?.localize?.('PF1AE.DefaultAction.MissingAction')??'Missing action (choose another)');
 }
 select.value=current??'';
 label.append(document.createTextNode(' '));
 // Avoid native form auto-submit and delegated handlers.
 for(const type of ['click','pointerdown','mousedown'])select.addEventListener(type,e=>e.stopPropagation());
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
 field.append(label,select);
 section.append(heading,field);
 advanced.append(section);
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
 Hooks.on('renderItemSheet',daRender);
 Hooks.on('renderItemSheetV2',daRender);
});
