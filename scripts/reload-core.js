/**
 * PF1AE reload core, Foundry 13 / PF1 11.11.
 * Inventory model B: native PF1 consumes ammunition exactly once when firing.
 * Loaded rounds are reserved, not removed from inventory by reload.
 * Only explicitly configured weapons are intercepted.
 */
const RL_NS='pf1-automation-engine',RL_KEY='reloadState',RL_ENABLED='reloadEnabled';
const RL_ACTION='pf1ae-reload';
const RL_REJECT=Symbol('PF1AE_RELOAD_REJECT');
const RL_BUSY=new Set(),RL_SHOTS=new WeakMap(),RL_ABORT=new WeakSet();
const RL_FIRING=new Set();
const rlL=(key,data={})=>{
 const fallback={
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
const rlActions=weapon=>[...(weapon?.actions?.contents??weapon?.actions??[])];
const rlNativeAction=use=>{
 const item=use?.item??use?.action?.item;
 const state=rlState(item);
 return state?.actionId && use?.action?.id===state.actionId;
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
 for(const item of actor?.items??[]){
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
 const weapon=use?.item,state=rlState(weapon);
 if(!rlAllowed()||!state||rlNativeAction(use))return {managed:false};
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
async function rlCreateAction(weapon){
 const systemAction=globalThis.pf1?.models?.components?.Action;
 if(typeof systemAction?.create!=='function')
  throw Error('Native PF1 Action.create unavailable; no reload action was created.');
 const name=rlL('Action');
 const created=await systemAction.create({
  name:name==='Action'?'Reload / Recharger':name,
  actionType:'other',activation:{type:'standard',cost:1},
  ammo:{type:'none',cost:0}
 },{parent:weapon});
 const action=created?.[0];
 if(!action?.id)throw Error('Native reload action creation failed.');
 return action.id;
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
  let actionId=prev?.actionId;
  if(!actionId||!rlActions(weapon).some(x=>x.id===actionId))
   actionId=await rlCreateAction(weapon);
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
function rlTiming(state,ammo,options){
 // Reductions must be explicitly verified/configured per weapon and ammo.
 // No unverified character feat name inference.
 const ladder=['full','standard','move','free'];
 let position=ladder.indexOf(state.base);
 const reduction=(options?.rapidReload===true?1:0)+
   (ammo?.getFlag?.(RL_NS,'alchemicalPaper')===true?1:0);
 position=Math.min(3,position+reduction);
 return {action:ladder[position],provokes:true,reductions:reduction};
}
async function rlReload(weapon,{ammoId,count=1,rapidReload=false}={}){
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
  const timing=rlTiming(next,ammo,{rapidReload});
  if(timing.provokes)ui.notifications?.info?.(rlL('AoO'));
  if(globalThis.ChatMessage?.create){
   const msg=rlL('Reloaded',{loaded:slots.length,capacity:current.capacity});
   void ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),
     content:foundry.utils.escapeHTML?.(msg)??msg}).catch(err=>console.warn('[PF1AE][Reload] Chat',err));
  }
  Hooks.callAll('pf1aeReload', {actorUuid:actor.uuid,weaponUuid:weapon.uuid,
    ammoId:selected,count,loaded:slots.length,capacity:current.capacity,timing});
  return {...rlClone(next),timing};
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
function rlAbort(use,result){
 RL_ABORT.add(use);
 ui.notifications?.warn?.(rlL('Blocked',{loaded:result.loaded??0,
  needed:result.needed??'?'}));
 Hooks.callAll('pf1aeReloadFireDenied',{
  actorUuid:use.actor?.uuid,weaponUuid:use.item?.uuid,
  actionId:use.action?.id,loaded:result.loaded??0,needed:result.needed??null});
 throw RL_REJECT;
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
// Compact widget added without replacing PF1's native item sheet.
function rlSheetWidget(sheet,html){
 if(!rlAllowed())return;
 const weapon=sheet?.document??sheet?.item??sheet?.object;
 if(weapon?.type!=='weapon'||!rlActor(weapon)||!rlOwner(rlActor(weapon)))return;
 const root=html?.[0]??html??sheet?.element?.[0]??sheet?.element;
 if(!root?.querySelector||root.querySelector('[data-pf1ae-reload-widget]'))return;
 const host=root.querySelector('.window-content')??root;
 const actor=rlActor(weapon),state=rlState(weapon);
 const actions=rlActions(weapon).filter(a=>a?.hasAttack&&a.ammo?.type&&a.actionType==='rwak');
 if(!state&&!actions.length)return;
 const panel=document.createElement('section');
 panel.dataset.pf1aeReloadWidget='true';
 panel.style.cssText='padding:6px 10px;margin:5px 0;border:1px solid var(--color-border-light-primary,#888);border-radius:5px;font-size:0.9em;';
 const heading=document.createElement('div');
 heading.style.cssText='display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
 const name=document.createElement('strong');
 name.textContent=state?rlL('Loaded',{loaded:state.slots.length,capacity:state.capacity}):rlL('Configure');
 heading.append(name);panel.append(heading);
 const button=(text,handler)=>{
  const b=document.createElement('button');b.type='button';b.textContent=text;
  b.style.cssText='width:auto;min-width:70px;padding:2px 7px;';
  b.addEventListener('click',()=>{void Promise.resolve().then(handler)
   .then(()=>sheet.render?.(true)).catch(error=>ui.notifications?.warn?.(error.message));});
  heading.append(b);
 };
 if(state){
  const dots=document.createElement('span');
  dots.textContent=Array.from({length:state.capacity},(_,i)=>i<state.slots.length?'●':'○').join(' ');
  dots.setAttribute('aria-label',String(state.slots.length)+' / '+String(state.capacity));
  heading.append(dots);
  const count=document.createElement('input');count.type='number';
  count.min='1';count.max=String(state.capacity);count.value='1';
  count.style.cssText='width:48px;flex:none;';
  heading.append(count);
  button(rlL('Action'),()=>rlReload(weapon,{count:Number(count.value)}));
  button(rlL('Unload'),()=>rlUnload(weapon,{count:Number(count.value)}));
 }
 const details=document.createElement('details');
 const summary=document.createElement('summary');summary.textContent=rlL('Configure');details.append(summary);
 const fields=document.createElement('div');
 fields.style.cssText='display:flex;gap:5px;flex-wrap:wrap;align-items:center;';
 const field=(label,value,min=0,max=100)=>{
  const wrapper=document.createElement('label');wrapper.textContent=label+' ';
  const input=document.createElement('input');input.type='number';input.min=String(min);
  input.max=String(max);input.value=String(value);input.style.width='55px';
  wrapper.append(input);fields.append(wrapper);return input;
 };
 const capacity=field(rlL('Capacity'),state?.capacity??1,1,100);
 const ammo=document.createElement('select');
 for(const item of actor.items??[]){
  if(item.type!=='ammo'||item.inContainer)continue;
  const type=state?.ammoType??actions[0]?.ammo?.type;
  if(type&&item.system?.subType&&item.system.subType!==type)continue;
  const option=document.createElement('option');option.value=item.id;
  option.textContent=item.name??item.id;ammo.append(option);
 }
 ammo.value=weapon.system?.ammo?.default??ammo.options[0]?.value??'';
 const ammoWrap=document.createElement('label');
 ammoWrap.textContent=rlL('Ammo')+' ';ammoWrap.append(ammo);fields.append(ammoWrap);
 const actionChoice=document.createElement('select');
 const none=document.createElement('option');none.value='';none.textContent='—';actionChoice.append(none);
 for(const a of actions){const option=document.createElement('option');
  option.value=a.id;option.textContent=a.name??a.id;actionChoice.append(option);}
 fields.append(actionChoice);
 const cost=field(rlL('Shots'),2,1,100);
 const base=document.createElement('select');
 for(const key of ['free','move','standard','full']){
  const option=document.createElement('option');option.value=key;option.textContent=key;base.append(option);}
 base.value=state?.base??'standard';fields.append(base);
 details.append(fields);panel.append(details);
 const save=document.createElement('button');save.type='button';save.textContent=rlL('Save');
 save.addEventListener('click',()=>{void (async()=>{
   const selected=actor.items?.get(ammo.value);
   if(!selected)throw Error(rlL('Missing'));
   const costs={...(state?.actionCosts??{})};
   if(actionChoice.value)costs[actionChoice.value]=Number(cost.value);
   await rlConfigure(weapon,{capacity:Number(capacity.value),
    ammoType:selected.system?.subType??actions[0]?.ammo?.type,
    base:base.value,actionCosts:costs});
   await sheet.render?.(true);
  })().catch(error=>ui.notifications?.warn?.(error.message));});
 details.append(save);host.prepend(panel);
}
function rlInstall(){
 const proto=(globalThis.pf1?.components?.ActionUse??
  globalThis.pf1?.actionUse?.ActionUse)?.prototype;
 if(!proto?.process||!proto?.generateChatAttacks){
  console.warn('[PF1AE][Reload] Native PF1 ActionUse integration unavailable; automation disabled.');
  return;
 }
 if(proto.process.pf1aeReloadWrapped)return;
 const previousProcess=proto.process;
 proto.process=async function(...args){
  if(rlAllowed()&&rlNativeAction(this)){
   // This is an actual PF1 Action entry. PF1AE executes reloading instead
   // of native 'other' use to avoid a misleading chat card or resource cost.
   try{return await rlReload(this.item,{count:1});}
   catch(error){ui.notifications?.warn?.(error.message);return undefined;}
  }
  try{return await previousProcess.apply(this,args)}
  catch(error){if(error===RL_REJECT&&RL_ABORT.has(this))return undefined;throw error}
  finally{
   if(!this._pf1aeReloadPostUse)RL_FIRING.delete(this.item?.uuid);
  }
 };
 proto.process.pf1aeReloadWrapped=true;
 Hooks.on('pf1CreateActionUse',use=>{
  if(!rlAllowed()||!rlState(use?.item)||rlNativeAction(use))return;
  // Install per-use guard, after dialog selection and filtering but before
  // generateChatAttacks() rolls; abort with a private sentinel swallowed by
  // the process wrapper. No chat, ammo, Grit, item charges are spent.
  if(use.generateChatAttacks?.pf1aeReloadWrapped)return;
  const previous=use.generateChatAttacks;
  use.generateChatAttacks=async function(...args){
   const check=rlCheck(this);
   if(check.managed){
    if(!check.ok)rlAbort(this,check);
    RL_SHOTS.set(this,check);
    RL_FIRING.add(this.item.uuid);
   }
   return previous.apply(this,args);
  };
  use.generateChatAttacks.pf1aeReloadWrapped=true;
 });
 Hooks.on('pf1PostActionUse',use=>{
  if(RL_SHOTS.has(use))use._pf1aeReloadPostUse=true;
  void rlCommitShot(use);
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
  timing:(weapon,ammo,options)=>rlTiming(rlState(weapon),ammo,options)
 });
 rlInstall();
 Hooks.on('renderItemSheet',rlSheetWidget);
 Hooks.on('renderItemSheetV2',rlSheetWidget);
});
