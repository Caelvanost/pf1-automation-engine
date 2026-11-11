/**
 * PF1AE reload core, Foundry 13 / PF1 11.11.
 * Inventory model B: native PF1 consumes ammunition exactly once when firing.
 * Loaded rounds are reserved, not removed from inventory by reload.
 * Only explicitly configured weapons are intercepted.
 */
const RL_NS='pf1-automation-engine',RL_KEY='reloadState',RL_ENABLED='reloadEnabled';
const RL_ACTION='pf1ae-reload';
const RL_BUSY=new Set(),RL_SHOTS=new WeakMap(),RL_DENIED=new WeakSet();
const RL_FIRING=new Set();
let RL_LAST=null;
const rlL=(key,data={})=>{
 const fallback={
  Action:'Reload',
  AutoUnavailable:'Unable to infer weapon capacity or native ammunition automatically',
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
 game.settings.get(RL_NS,'genericEnabled')===true &&
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
const rlNativeAction=use=>{
 const item=use?.item??use?.action?.item;
 const state=rlState(item);
 if(item?.type!=='weapon'||use?.action?.hasAttack)return false;
 if(state?.actionId&&use.action?.id===state.actionId)return true;
 return /^(?:recharger|reload)(?:\s|$)/i.test(String(use?.action?.name??'').trim());
};
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
 if(ammo?.type!=='ammo'||ammo?.inContainer||ammo?.system?.identified===false)return 0;
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
async function rlReload(weapon,{ammoId,count=1}={}){
 const actor=rlActor(weapon),state=rlState(weapon);
 if(!state)throw Error(rlL('Unconfigured'));
 if(!rlOwner(actor))throw Error('Actor OWNER permission required.');
 if(!rlAllowed())throw Error('Automatic reload is disabled.');
 if(!Number.isSafeInteger(count)||count<1)throw Error('Invalid reload quantity.');
 return rlLock(weapon,async()=>{
  const current=rlState(weapon);
  if(count>current.capacity-current.slots.length)throw Error(rlL('OutOfCapacity'));
  const selected=ammoId??weapon.system?.ammo?.default;
  const ammo=rlAmmo(actor,selected);
  if(!ammo||rlAvailable(weapon,selected,current)<count)throw Error(rlL('Insufficient'));
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
   item.system?.identified!==false&&item.system?.subType===ammoType);
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
// The only sheet integration is an absolutely positioned compact control.
// It is not inserted into the sheet's columns, flex sizing or tab structure.
function rlSheetWidget(sheet,html){
 if(!rlAllowed())return;
 const weapon=sheet?.document??sheet?.item??sheet?.object;
 if(weapon?.type!=='weapon'||!rlActor(weapon)||!rlOwner(rlActor(weapon)))return;
 const native=rlAttackActions(weapon);
 if(!native.length&&!rlState(weapon))return;
 const root=html?.[0]??html??sheet?.element?.[0]??sheet?.element;
 if(!root?.querySelector||root.querySelector('[data-pf1ae-reload-widget]'))return;
 const header=root.querySelector('.sheet-header')??root.querySelector('header.sheet-header');
 if(!header)return;
 const container=document.createElement('div');
 container.dataset.pf1aeReloadWidget='true';
 container.style.cssText='position:absolute;top:5px;right:7px;z-index:8;display:flex;align-items:center;gap:4px;padding:3px 5px;border-radius:5px;background:var(--color-bg-option,#e7dfcc);box-shadow:0 1px 3px #0005;max-width:55%;';
 if(!header.style.position)header.style.position='relative';
 const state=rlState(weapon),inferred=rlInfer(weapon);
 const status=document.createElement('span');
 status.style.cssText='white-space:nowrap;font-size:11px;line-height:1.2;';
 status.textContent=state?state.slots.length+' / '+state.capacity:
   inferred.ok?'0 / '+inferred.capacity:'— / ?';
 status.title=state?rlL('Loaded',{loaded:state.slots.length,capacity:state.capacity}):
   (inferred.ok?rlL('InitialStatus'):rlL('AutoUnavailable'));
 container.append(status);
 const button=(label,fn)=>{
  const b=document.createElement('button');b.type='button';b.textContent=label;
  b.style.cssText='width:auto;min-width:0;max-width:none;flex:0 0 auto;margin:0;padding:2px 5px;font-size:11px;line-height:1.15;';
  b.addEventListener('click',event=>{
   event.stopPropagation();event.preventDefault();
   void Promise.resolve().then(fn).then(()=>sheet.render?.(true))
    .catch(err=>ui.notifications?.warn?.(err.message));
  });
  container.append(b);
 };
 // The user-defined native Reload action triggers loading through post-use.
 if(state?.slots.length)button(rlL('Unload'),()=>rlUnload(weapon,{count:1}));
 if(game.user?.isGM){
  // Optional correction exists only if automated capacity could not be read
  // or the GM deliberately needs to override it; never a mandatory form.
  button('⚙',async()=>{
   const current=rlState(weapon),guess=rlInfer(weapon);
   const input=await Dialog.prompt({
    title:rlL('Capacity'),
    content:'<label>'+rlL('Capacity')+' <input name="capacity" type="number" min="1" max="100" value="'+
      (current?.capacity??guess.capacity??1)+'"></label>',
    callback:html=>Number(html.find?.('[name="capacity"]')?.val?.()??
      html.querySelector?.('[name="capacity"]')?.value)
   });
   if(input==null)return;
   const inferredAmmo=current?.ammoType??guess.ammoType;
   if(!inferredAmmo)throw Error(rlL('AutoUnavailable'));
   await rlConfigure(weapon,{capacity:input,ammoType:inferredAmmo,
    base:current?.base??guess.base??'standard',actionCosts:current?.actionCosts??{}});
  });
 }
 header.append(container);
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
  if(!rlAllowed()||use?.item?.type!=='weapon')return;
  if(rlNativeAction(use)){
   // One round loaded after the user's manually configured native action.
   void rlAutoConfigure(use.item).then(()=>rlReload(use.item,{count:1}))
    .catch(error=>ui.notifications?.warn?.(error.message));
  }else if(RL_SHOTS.has(use))void rlCommitShot(use);
 });
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
  lastDiagnostic:()=>RL_LAST?{...RL_LAST}:null
 });
 rlInstall();
 Hooks.on('renderItemSheet',rlSheetWidget);
 Hooks.on('renderItemSheetV2',rlSheetWidget);
});
