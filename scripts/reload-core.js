/**
 * PF1AE reload core, Foundry 13 / PF1 11.11.
 * Inventory model B: native PF1 consumes ammunition exactly once when firing.
 * Loaded rounds are reserved, not removed from inventory by reload.
 * Only explicitly configured weapons are intercepted.
 */
const RL_NS='pf1-automation-engine',RL_KEY='reloadState',RL_ENABLED='reloadEnabled';
const RL_ACTION='pf1ae-reload';
const RL_BUSY=new Set(),RL_SHOTS=new WeakMap(),RL_DENIED=new WeakSet();
const RL_RELOAD_SEEN=new WeakSet();
const RL_FIRING=new Set();
let RL_LAST=null;
const rlL=(key,data={})=>{
 const fallback={
  Action:'Reload',
  AutoUnavailable:'Unable to infer weapon capacity or native ammunition automatically',
  ReloadFailed:'Reload failed',
  Loading:'Loading',
  AmmoGuidance:'Check that the actor has native PF1 ammo Items of the matching subtype, with positive quantity.',
  InitialStatus:'Reloading will initialize this weapon automatically',
  Loaded:'Loaded: {loaded}/{capacity}',Unload:'Unload',
  Configure:'Configure reload',Capacity:'Capacity',Ammo:'Ammunition',
  Shots:'Shots for Action',Save:'Save',
  Empty:'Weapon is not sufficiently loaded.',
  Insufficient:'Not enough ammunition available to reload.',
  OutOfCapacity:'Weapon capacity exceeded.',
  Reloaded:'Weapon reloaded: {loaded}/{capacity}.',
  Blocked:'Attack blocked: {loaded} loaded; {needed} required.',
  AoO:'Reloading may provoke an attack of opportunity.',
  Missing:'Weapon or ammunition is unavailable.',
  Unconfigured:'Weapon reload tracking is not configured.'
 }[key]??key;
 const ref='PF1AE.Reload.'+key;
 const translated=Object.keys(data).length?game.i18n?.format?.(ref,data):game.i18n?.localize?.(ref);
 if(!translated||translated===ref)return fallback.replace(/\{(\w+)\}/g,(_,k)=>data[k]??'');
 return translated;
};
const rlAllowed=()=>game.modules.get(RL_NS)?.active===true &&
 game.settings.get(RL_NS,RL_ENABLED)===true;
const rlActor=weapon=>weapon?.actor??(weapon?.parent?.documentName==='Actor'?weapon.parent:null);
const rlOwner=actor=>game.user?.isGM||actor?.testUserPermission?.(game.user,'OWNER');
const rlClone=o=>foundry.utils.deepClone(o);
const rlState=weapon=>{
 const s=weapon?.getFlag?.(RL_NS,RL_KEY);
 if(!s || s.schema!==1 || !Number.isSafeInteger(s.capacity)||s.capacity<1||s.capacity>100 ||
  !Array.isArray(s.slots)||s.slots.length>s.capacity)return null;
 if(s.slots.some(x=>typeof x?.ammoId!=='string'||!x.ammoId))return null;
 return rlClone(s);
};
const rlActions=weapon=>[...(weapon?.actions?.contents??weapon?.actions?.values?.()??weapon?.actions??[])];
const rlReloadName=name=>/^(?:recharger|reload)(?:\s|$)/i.test(String(name??'').trim());
function rlReloadRequest(use){
 const item=use?.item??use?.action?.item;
 if(!item||!use?.action)return {candidate:false,weapon:null};
 const state=rlState(item);
 const named=rlReloadName(use.action.name)||
  (!use.action.hasAttack&&rlReloadName(item.name));
 const legacy=!!state?.actionId&&use.action.id===state.actionId;
 if(!named&&!legacy)return {candidate:false,weapon:null};
 if(use.action.hasAttack)return {candidate:true,weapon:null,
  reason:'Reload must be a non-attack PF1 action.'};
 if(item.type==='weapon')return {candidate:true,weapon:item};
 // A character ability can reload its ONLY eligible weapon. Never choose
 // between multiple pistols/crossbows without explicit association.
 const actor=use.actor??rlActor(item);
 const weapons=rlItems(actor).filter(x=>x?.type==='weapon'&&
  (rlState(x)||rlInfer(x).ok));
 if(weapons.length===1)return {candidate:true,weapon:weapons[0]};
 return {candidate:true,weapon:null,reason:weapons.length>1?
  'Multiple compatible weapons: place the Reload action on the specific weapon.':
  'No compatible weapon with native ammunition and capacity could be found.'};
}
const rlNativeAction=use=>rlReloadRequest(use).candidate;
const rlCompatible=(item,capacity)=>{
 if(item?.type!=='weapon'||!rlActor(item)||!Number.isSafeInteger(capacity)||capacity<1||capacity>100)
  throw Error('An actor-owned weapon and capacity 1–100 are required.');
};
const rlType=(weapon,state,action)=>state?.ammoType??action?.ammo?.type??weapon?.system?.ammo?.type??null;
const rlAmmo=(actor,id)=>actor?.items?.get(id)??null;
const rlQuantity=item=>Number(item?.system?.quantity??0);
const rlReservations=(actor,ammoId,except)=>{
 let reserved=0;
 for(const item of rlItems(actor)){
  if(item.id===except?.id)continue;
  const s=rlState(item);
  if(s)reserved+=s.slots.filter(x=>x.ammoId===ammoId).length;
 }
 return reserved;
};
function rlAvailable(weapon,ammoId,state){
 const actor=rlActor(weapon),ammo=rlAmmo(actor,ammoId);
 if(ammo?.type!=='ammo'||ammo?.inContainer)return 0;
 const chosenType=state.ammoType;
 if(chosenType&&ammo.system?.subType&&ammo.system.subType!==chosenType)return 0;
 if(ammo.system?.abundant===true)return Infinity;
 const own=state.slots.filter(x=>x.ammoId===ammoId).length;
 return Math.max(0,rlQuantity(ammo)-rlReservations(actor,ammoId,weapon)-own);
}
const rlLock=async(weapon,fn)=>{
 const key=weapon.uuid;
 if(!key||RL_BUSY.has(key))throw Error('Weapon operation already in progress.');
 RL_BUSY.add(key);
 try{return await fn()}finally{RL_BUSY.delete(key)}
};
function rlNeeded(use,state){
 const action=use.action;
 if(!action?.hasAttack||!['rwak','twak'].includes(action.actionType))return 0;
 if(action.actionType==='twak')return 0; // thrown weapon, not loaded
 if(!action.ammo?.type || action.ammo.cost<=0)return 0;
 const explicit=state.actionCosts?.[action.id];
 if(Number.isSafeInteger(explicit)&&explicit>=1)return explicit;
 // Count all actual attacks, including rapid shot/iteratives and possible
 // unselected ammunition. If reliable attack data is unavailable, fail closed.
 const attacks=use.shared?.attacks;
 if(!Array.isArray(attacks)||!attacks.length)return null;
 return attacks.length*Math.max(1,Number(action.ammo.cost)||1);
}
function rlCheck(use){
 const weapon=use?.item;
 if(!rlAllowed()||weapon?.type!=='weapon'||rlNativeAction(use))return {managed:false};
 const stored=rlState(weapon),inferred=stored?null:rlInfer(weapon);
 if(!stored&&!inferred?.ok){
  // A known firearm/crossbow with an attack must not silently fire because
  // its native ammo configuration is incomplete. Explicitly deny it.
  const label=String(weapon?.name??'');
  const recognizable=/(?:pistol|pistolet|musket|mousquet|crossbow|arbal[eè]te)/i.test(label);
  const ranged=rlActions(weapon).some(a=>a?.actionType==='rwak');
  if(recognizable&&ranged)return {managed:true,ok:false,needed:1,loaded:0,
    reason:inferred?.reason??'missing PF1 native ammo data'};
  return {managed:false,reason:inferred?.reason??'unsupported'};
 }
 // Recognized but never reloaded means EMPTY, not unmanaged.
 const state=stored??{schema:1,capacity:inferred.capacity,ammoType:inferred.ammoType,
   slots:[],actionCosts:{}};
 const needed=rlNeeded(use,state);
 if(needed===0)return {managed:false};
 if(needed===null)return {managed:true,ok:false,reason:'unknown attack count'};
 if(RL_FIRING.has(weapon.uuid))
  return {managed:true,ok:false,needed,loaded:state.slots.length,
    reason:'another shot is being processed'};
 const actual=(use.shared?.attacks??[]).reduce((sum,a)=>sum+(a?.hasAmmo?
   Math.max(1,Number(use.action?.ammo?.cost)||1):0),0);
 if(actual!==needed)return {managed:true,ok:false,needed,
   loaded:state.slots.length,reason:'native ammo usage differs from configured cost'};
 const selected=weapon?.system?.ammo?.default;
 const ammo=rlAmmo(rlActor(weapon),selected);
 const loaded=state.slots.filter(x=>x.ammoId===selected).length;
 // The native PF1 action will consume from its default ammunition Item;
 // forbid firing a different loaded ammo or an inventory deficit.
 const available=ammo?.system?.abundant?Infinity:rlQuantity(ammo);
 const ok=!!selected&&!!ammo&&loaded>=needed&&available>=needed&&
  (use.shared?.attacks??[]).every(x=>x?.ammo?.id===selected);
 return {managed:true,ok,needed,loaded,selected,
   reason:ok?null:'insufficient loaded ammo or native ammunition inventory'};
}
async function rlConfigure(weapon,{capacity,ammoType,base='standard',actionCosts={},initialLoaded=0}={}){
 rlCompatible(weapon,capacity);
 const actor=rlActor(weapon);
 if(!rlOwner(actor))throw Error('Actor OWNER permission required.');
 if(!['free','move','standard','full'].includes(base))throw Error('Invalid reload action economy.');
 if(typeof ammoType!=='string'||!ammoType)throw Error('Native PF1 ammunition subtype required.');
 if(!Number.isSafeInteger(initialLoaded)||initialLoaded<0||initialLoaded>capacity)
  throw Error('Invalid initial loaded count.');
 for(const [key,value] of Object.entries(actionCosts)){
  if(!rlActions(weapon).some(a=>a.id===key)||!Number.isSafeInteger(value)||value<1||value>capacity)
   throw Error('Invalid shot cost; select an existing Action ID.');
 }
 return rlLock(weapon,async()=>{
  const prev=rlState(weapon);
  // Preserve legacy ID; user manages native Reload action and its cost.
  const actionId=prev?.actionId??null;
  // Preserve loaded slot identity on changes. Never silently empty a weapon.
  const slots=prev?.slots??[];
  if(slots.length>capacity)throw Error('Unload before decreasing capacity.');
  if(initialLoaded>0&&!prev){
   const id=weapon.system.ammo?.default,ammo=rlAmmo(actor,id);
   if(!ammo||rlQuantity(ammo)<initialLoaded||ammo.system?.subType!==ammoType)
    throw Error('Choose enough native default ammunition before initializing loaded rounds.');
   slots.push(...Array.from({length:initialLoaded},()=>({ammoId:id})));
  }
  const state={schema:1,capacity,ammoType,base,actionId,actionCosts,slots};
  await weapon.setFlag(RL_NS,RL_KEY,state);
  return rlClone(state);
 });
}
function rlAmmoDiagnostic(weapon){
 const actor=rlActor(weapon),state=rlState(weapon),inferred=rlInfer(weapon);
 const ammoType=state?.ammoType??inferred?.ammoType??
  rlAttackActions(weapon)[0]?.ammo?.type??null;
 const selectedId=weapon?.system?.ammo?.default??null;
 const inventory=rlItems(actor).filter(x=>x?.type==='ammo').map(item=>({
  id:item.id,name:item.name??null,subType:item.system?.subType??null,
  quantity:rlQuantity(item),inContainer:!!item.inContainer,
  abundant:item.system?.abundant===true,
  reserved:rlReservations(actor,item.id,weapon)+
   (state?.slots??[]).filter(slot=>slot.ammoId===item.id).length,
  matches:!!ammoType&&item.system?.subType===ammoType
 }));
 return {weapon:weapon?.name??null,weaponUuid:weapon?.uuid??null,
  capacity:state?.capacity??inferred.capacity??null,
  loaded:state?.slots?.length??0,ammoType,
  selectedId,selectedName:inventory.find(x=>x.id===selectedId)?.name??null,
  inferReason:inferred.ok?null:inferred.reason??null,
  inventory};
}
function rlChooseAmmo(weapon,state,ammoId){
 const actor=rlActor(weapon);
 if(ammoId){
  const ammo=rlAmmo(actor,ammoId);
  if(ammo?.type==='ammo'&&ammo?.system?.subType===state.ammoType)
   return ammoId;
  throw Error('The chosen ammunition is missing or incompatible.');
 }
 const def=weapon.system?.ammo?.default;
 const defaultAmmo=rlAmmo(actor,def);
 if(defaultAmmo?.type==='ammo'&&defaultAmmo.system?.subType===state.ammoType&&
   rlAvailable(weapon,def,state)>0)return def;
 // Never change ammo identity while another cartridge is loaded.
 if(state.slots.length>0)return def;
 const other=rlItems(actor).find(x=>x?.type==='ammo'&&!x.inContainer&&
  x.system?.subType===state.ammoType&&rlAvailable(weapon,x.id,state)>0);
 return other?.id??def??null;
}
async function rlReload(weapon,{ammoId,count=1}={}){
 const actor=rlActor(weapon),state=rlState(weapon);
 if(!state)throw Error(rlL('Unconfigured'));
 if(!rlOwner(actor))throw Error('Actor OWNER permission required.');
 if(!rlAllowed())throw Error('Automatic reload is disabled.');
 if(!Number.isSafeInteger(count)||count<1)throw Error('Invalid reload quantity.');
 return rlLock(weapon,async()=>{
  const current=rlState(weapon);
  if(count>current.capacity-current.slots.length)throw Error(rlL('OutOfCapacity'));
  const selected=rlChooseAmmo(weapon,current,ammoId);
  const ammo=rlAmmo(actor,selected);
  const available=selected?rlAvailable(weapon,selected,current):0;
  if(!ammo||available<count){
   const diag=rlAmmoDiagnostic(weapon);
   console.warn('[PF1AE][Reload] Insufficient compatible ammunition',diag);
   throw Error(rlL('Insufficient')+' — '+rlL('AmmoGuidance'));
  }
  const slots=[...current.slots,...Array.from({length:count},()=>({ammoId:selected}))];
  // Keep native default ammo aligned with the loaded cartridge.
  // Mixed ammo remains unsupported in the initial integration.
  if(new Set(slots.map(x=>x.ammoId)).size!==1)
   throw Error('Mixed ammunition is not supported in this version.');
  const previousDefault=weapon.system?.ammo?.default;
  const next={...current,slots};
  await weapon.setFlag(RL_NS,RL_KEY,next);
  try{
   if(previousDefault!==selected)await weapon.update({'system.ammo.default':selected});
  }catch(error){
   try{await weapon.setFlag(RL_NS,RL_KEY,current)}catch(rollbackError){
    console.error('[PF1AE][Reload] Rollback failed',rollbackError);
   }
   throw error;
  }
  // Action economy and AoOs are managed by the user-defined native Action.
  if(globalThis.ChatMessage?.create){
   const msg=rlL('Reloaded',{loaded:slots.length,capacity:current.capacity});
   void ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),
     content:foundry.utils.escapeHTML?.(msg)??msg}).catch(err=>console.warn('[PF1AE][Reload] Chat',err));
  }
  Hooks.callAll('pf1aeReload', {actorUuid:actor.uuid,weaponUuid:weapon.uuid,
    ammoId:selected,count,loaded:slots.length,capacity:current.capacity});
  return rlClone(next);
 });
}
async function rlUnload(weapon,{count=1}={}){
 const actor=rlActor(weapon);
 if(!rlOwner(actor))throw Error('Actor OWNER permission required.');
 if(!rlAllowed())throw Error('Automatic reload is disabled.');
 return rlLock(weapon,async()=>{
  const state=rlState(weapon);
  if(!state||!Number.isSafeInteger(count)||count<1||count>state.slots.length)
   throw Error('Invalid unload count.');
  const slots=state.slots.slice(0,-count),next={...state,slots};
  await weapon.setFlag(RL_NS,RL_KEY,next);
  Hooks.callAll('pf1aeUnload',{actorUuid:actor.uuid,weaponUuid:weapon.uuid,
    count,loaded:slots.length});
  return rlClone(next);
 });
}
function rlDeny(use,result){
 RL_DENIED.add(use);
 ui.notifications?.warn?.(rlL('Blocked',{
  loaded:result.loaded??0,needed:result.needed??'?'}));
 RL_LAST={status:'blocked',actor:use.actor?.name??null,weapon:use.item?.name??null,
  action:use.action?.name??null,...result};
 console.warn('[PF1AE][Reload] Attack blocked before dice',result);
 Hooks.callAll('pf1aeReloadFireDenied',{
  actorUuid:use.actor?.uuid,weaponUuid:use.item?.uuid,
  actionId:use.action?.id,loaded:result.loaded??0,
  needed:result.needed??null,reason:result.reason??null});
}
async function rlCommitShot(use){
 const actor=use.actor,weapon=use.item;
 const state=rlState(weapon),result=RL_SHOTS.get(use);
 if(!state||!result)return;
 const after=state.slots.slice(result.needed);
 // This happens after native PF1 subtractAmmo() succeeds and post-use
 // occurs. A failed server update must not invent or restore inventory ammo.
 try{
  await rlLock(weapon,()=>weapon.setFlag(RL_NS,RL_KEY,{...state,slots:after}));
  Hooks.callAll('pf1aeReloadShot',{actorUuid:actor?.uuid,weaponUuid:weapon.uuid,
    actionId:use.action?.id,spent:result.needed,loaded:after.length});
 }catch(error){console.error('[PF1AE][Reload] Shot state update failed',error);}
 finally{RL_FIRING.delete(weapon.uuid);}
}
// Automatic but conservative PF1 weapon inference. Capacity is generally
// printed in the compendium description, not in a universal WeaponModel field.
const rlItems=actor=>[...(actor?.items?.contents??actor?.items?.values?.()??actor?.items??[])];
const rlAttackActions=weapon=>[...(weapon?.actions?.contents??weapon?.actions?.values?.()??weapon?.actions??[])].filter(action=>
  action?.actionType==='rwak'&&action?.hasAttack===true&&action?.ammo?.type&&
  Number(action?.ammo?.cost)>0);
const rlPlain=html=>String(html??'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ')
  .replace(/\s+/g,' ').trim();
function rlInfer(weapon){
 if(weapon?.type!=='weapon'||!rlActor(weapon))return {ok:false,reason:'not a weapon'};
 const actions=rlAttackActions(weapon);
 if(!actions.length)return {ok:false,reason:'no native ranged ammunition action'};
 const types=[...new Set(actions.map(a=>a.ammo.type))];
 if(types.length!==1)return {ok:false,reason:'ambiguous native ammunition types'};
 const ammoType=types[0];
 const name=String(weapon.name??'').toLowerCase();
 const descriptions=[
  weapon.system?.description?.value,weapon.system?.description?.unidentified,
  weapon.system?.description?.summary,weapon.system?.description?.notes,
  weapon.system?.source?.text
 ].map(rlPlain).join(' ');
 const capMatch=descriptions.match(/(?:capacity|capacite|capacité)\s*:?\s*(\d{1,3})\b/i);
 let capacity=capMatch?Number(capMatch[1]):null;
 let source=capMatch?'description':null;
 if(!capacity){
  if(/double[-\s]barrel(?:ed)?\s+(?:pistol|musket)|(?:pistolet|mousquet)\s+(?:à\s+)?double\s+canon/i.test(name)){
   capacity=2;source='recognized double-barrel weapon';
  }else if(/(?:crossbow|arbalète|arbalete|pistol|pistolet|musket|mousquet)/i.test(name)&&
           !/(?:repeating|répétition|repetition|multiple|multi)/i.test(name)){
   capacity=1;source='recognized single-load weapon';
  }
 }
 if(!Number.isSafeInteger(capacity)||capacity<1||capacity>100)
  return {ok:false,reason:'capacity not structurally available; requires explicit GM override'};
 const actor=rlActor(weapon);
 const candidates=rlItems(actor).filter(item=>item?.type==='ammo'&&!item.inContainer&&
   item.system?.subType===ammoType);
 const defaultId=weapon.system?.ammo?.default;
 const ammo=candidates.find(x=>x.id===defaultId)??candidates[0];
 if(!ammo)return {ok:false,capacity,ammoType,reason:'no matching native PF1 ammunition Item'};
 const kind=/arbalète lourde|arbalete lourde|heavy crossbow|mousquet|musket/i.test(name)?'full':
  /arbalète légère|arbalete legere|light crossbow|hand crossbow|arbalète de poing/i.test(name)?'move':
  'standard';
 return {ok:true,capacity,ammoType,ammoId:ammo.id,base:kind,source};
}
async function rlAutoConfigure(weapon){
 const existing=rlState(weapon);if(existing)return existing;
 const inferred=rlInfer(weapon);
 if(!inferred.ok)throw Error(rlL('AutoUnavailable')+': '+inferred.reason);
 const configured=await rlConfigure(weapon,{
  capacity:inferred.capacity,ammoType:inferred.ammoType,
  base:inferred.base,actionCosts:{}
 });
 if(weapon.system?.ammo?.default!==inferred.ammoId)
  await weapon.update({'system.ammo.default':inferred.ammoId});
 return configured;
}
// PF1 11.11 weapon sheets expose a persistent .sidebar. Insert the reload
// status immediately AFTER the native Hardness (Solidité) descriptor, not
// into the header or into the grid containing the sheet's tabs.
function rlSheetWidget(sheet,html){
 if(!rlAllowed())return;
 const weapon=sheet?.document??sheet?.item??sheet?.object;
 if(weapon?.type!=='weapon'||!rlActor(weapon)||!rlOwner(rlActor(weapon)))return;
 if(!rlAttackActions(weapon).length&&!rlState(weapon))return;
 const root=html?.[0]??html??sheet?.element?.[0]??sheet?.element;
 if(!root?.querySelector)return;
 const sidebar=root.matches?.('.sidebar')?root:root.querySelector('.sidebar');
 if(!sidebar||sidebar.querySelector('[data-pf1ae-reload-widget]'))return;
 const state=rlState(weapon),inferred=rlInfer(weapon);
 const container=document.createElement('section');
 container.dataset.pf1aeReloadWidget='true';
 container.className='pf1ae-reload-sidebar';
 container.style.cssText='display:flex;flex-direction:column;flex:0 0 auto;gap:3px;'+
  'padding:4px 3px 5px;margin:4px 0 6px;min-height:0;max-width:100%;'+
  'border-top:1px solid var(--color-border,#888);'+
  'border-bottom:1px solid var(--color-border,#888);';
 const heading=document.createElement('h5');
 heading.textContent=rlL('Loading');
 heading.style.cssText='margin:0 0 2px;line-height:1.3;';
 container.append(heading);
 const content=document.createElement('div');
 content.style.cssText='display:flex;align-items:center;justify-content:space-between;'+
  'gap:5px;min-width:0;flex-wrap:wrap;';
 const status=document.createElement('span');
 status.textContent=state?state.slots.length+' / '+state.capacity:
  inferred.ok?'0 / '+inferred.capacity:'— / ?';
 status.title=state?rlL('Loaded',{loaded:state.slots.length,capacity:state.capacity}):
  inferred.ok?rlL('InitialStatus'):rlL('AutoUnavailable');
 status.style.cssText='font-weight:600;white-space:nowrap;flex:1 1 auto;';
 content.append(status);
 const actions=document.createElement('div');
 actions.style.cssText='display:flex;gap:3px;flex:0 0 auto;align-items:center;';
 const button=(label,tooltip,fn)=>{
  const element=document.createElement('button');
  element.type='button';element.textContent=label;element.title=tooltip;
  element.style.cssText='font:inherit;font-size:12px;line-height:1;min-width:24px;'+
   'width:auto;min-height:22px;height:22px;margin:0;padding:2px 5px;flex:0 0 auto;';
  element.addEventListener('click',event=>{
   event.preventDefault();event.stopPropagation();
   void Promise.resolve().then(fn).then(()=>sheet.render?.(true))
    .catch(error=>ui.notifications?.warn?.(error.message));
  });
  actions.append(element);
 };
 if(state?.slots.length)button('−',rlL('Unload'),()=>rlUnload(weapon,{count:1}));
 if(game.user?.isGM)button('⚙',rlL('Capacity'),async()=>{
  const current=rlState(weapon),guess=rlInfer(weapon);
  const chosen=await Dialog.prompt({
   title:rlL('Capacity'),
   content:'<label>'+rlL('Capacity')+
    ' <input name="capacity" type="number" min="1" max="100" value="'+
    (current?.capacity??guess.capacity??1)+'"></label>',
   callback:html=>Number(html.find?.('[name="capacity"]')?.val?.()??
    html.querySelector?.('[name="capacity"]')?.value)
  });
  if(chosen==null)return;
  const ammoType=current?.ammoType??guess.ammoType;
  if(!ammoType)throw Error(rlL('AutoUnavailable'));
  await rlConfigure(weapon,{capacity:chosen,ammoType,
   base:current?.base??guess.base??'standard',actionCosts:current?.actionCosts??{}});
 });
 content.append(actions);container.append(content);
 // PF1 physical item sidebar adds its hardness row with a protected input
 // named system.hardness. Using that stable field is language-independent.
 const hardness=sidebar.querySelector('input[name="system.hardness"]');
 const hp=sidebar.querySelector('input[name="system.hp.value"]');
 const anchor=hardness?.closest('.descriptor')??hardness?.closest('label')??
  hp?.closest('.descriptor')??hp?.closest('.range-value');
 if(anchor?.parentElement===sidebar)anchor.insertAdjacentElement('afterend',container);
 else{
  // Future sheet variations: remain in the sidebar, never spill into the tabs.
  const firstCheckbox=sidebar.querySelector('.descriptor.checkbox');
  if(firstCheckbox?.parentElement===sidebar)sidebar.insertBefore(container,firstCheckbox);
  else sidebar.append(container);
 }
}
function rlInstall(){
 // Works with private as well as public PF1 ActionUse classes. No prototype
 // monkey-patching or dependency on undocumented global exports.
 Hooks.on('pf1CreateActionUse',use=>{
  if(!rlAllowed()||use?.item?.type!=='weapon'||
     rlNativeAction(use)||typeof use.generateChatAttacks!=='function')return;
  if(use.generateChatAttacks.pf1aeReloadWrapped)return;
  const original=use.generateChatAttacks;
  const guarded=async function(...args){
   const check=rlCheck(this);
   RL_LAST={status:check.managed?(check.ok?'authorized':'blocked'):'unmanaged',
    actor:this.actor?.name??null,weapon:this.item?.name??null,
    action:this.action?.name??null,...check};
   if(check.managed){
    if(!check.ok){rlDeny(this,check);return;}
    RL_SHOTS.set(this,check);
    RL_FIRING.add(this.item.uuid);
   }
   try{return await original.apply(this,args)}
   catch(error){
    RL_SHOTS.delete(this);
    RL_FIRING.delete(this.item?.uuid);
    throw error;
   }
  };
  guarded.pf1aeReloadWrapped=true;
  use.generateChatAttacks=guarded;
 });
 // Called after attack generation but before native inventory/charge
 // deductions. Return false to stop normal PF1 processing.
 Hooks.on('pf1PreActionUse',use=>{
  if(RL_DENIED.has(use)){
   RL_DENIED.delete(use);
   RL_FIRING.delete(use?.item?.uuid);
   return false;
  }
 });
 Hooks.on('pf1PostActionUse',use=>{
  if(!rlAllowed())return;
  const request=rlReloadRequest(use);
  if(request.candidate){
   if(RL_RELOAD_SEEN.has(use))return;
   RL_RELOAD_SEEN.add(use);
   if(!request.weapon){
    RL_LAST={status:'reload-unresolved',action:use.action?.name??null,
     item:use.item?.name??null,reason:request.reason??'unknown weapon'};
    ui.notifications?.warn?.(rlL('ReloadFailed')+': '+RL_LAST.reason);
    return;
   }
   const weapon=request.weapon;
   RL_LAST={status:'reload-started',weapon:weapon.name??null,
    action:use.action?.name??null};
   void (async()=>{
    try{
     await rlAutoConfigure(weapon);
     const next=await rlReload(weapon,{count:1});
     RL_LAST={status:'reloaded',weapon:weapon.name??null,
      loaded:next.slots.length,capacity:next.capacity};
    }catch(error){
     RL_LAST={status:'reload-failed',weapon:weapon.name??null,
      reason:String(error?.message??error),ammo:rlAmmoDiagnostic(weapon)};
     console.warn('[PF1AE][Reload] Native Reload action failed',RL_LAST);
     ui.notifications?.warn?.(rlL('ReloadFailed')+': '+RL_LAST.reason);
    }
   })();
   return;
  }
  if(use?.item?.type==='weapon'&&RL_SHOTS.has(use))void rlCommitShot(use);
 });;
}
Hooks.once('init',()=>{
 game.settings.register(RL_NS,RL_ENABLED,{
  name:game.i18n?.localize?.('PF1AE.Settings.ReloadEnabled.Name')??'Automatic weapon reload tracking',
  hint:game.i18n?.localize?.('PF1AE.Settings.ReloadEnabled.Hint')??'Opt-in reload tracking for configured PF1 weapons.',
  scope:'world',config:true,restricted:true,type:Boolean,default:false
 });
});
Hooks.once('ready',()=>{
 const mod=game.modules.get(RL_NS);
 if(!mod)return;
 mod.api??={};
 mod.api.reload=Object.freeze({
  getState:weapon=>rlState(weapon),
  canFire:(weapon,action,attacks=1)=>{
   const state=rlState(weapon);
   const needed=state?.actionCosts?.[action?.id]??Math.max(1,attacks)*(action?.ammo?.cost??1);
   return {ok:!!state&&state.slots.length>=needed,needed,loaded:state?.slots.length??0};
  },
  configure:rlConfigure,reload:rlReload,unload:rlUnload,
  infer:rlInfer,initialize:rlAutoConfigure,
  lastDiagnostic:()=>RL_LAST?{...RL_LAST}:null,
  ammoDiagnostic:rlAmmoDiagnostic
 });
 rlInstall();
 Hooks.on('renderItemSheet',rlSheetWidget);
 Hooks.on('renderItemSheetV2',rlSheetWidget);
});
