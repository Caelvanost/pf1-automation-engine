/**
 * PF1AE generic attack resolution — no firearm-specific rules.
 * Foundry v13 / PF1 v11.11. Optional service: never changes AC, attacks or HP.
 */
const AR_NS='pf1-automation-engine',AR_FLAG='attackDefenseConfig';
const AR_TYPES=new Set(['auto','normal','touch','flatFooted','cmd','manual']);
const AR_PROVIDERS=new Map();
let AR_LAST=null;
const arActions=item=>[...(item?.actions?.contents??item?.actions?.values?.()??item?.actions??[])];
const arGet=(item,action)=>{
 const id=typeof action==='string'?action:action?.id??action?._id;
 return item?.getFlag?.(AR_NS,AR_FLAG)?.[id]??'auto';
};
async function arSet(item,action,type){
 const id=typeof action==='string'?action:action?.id??action?._id;
 if(!AR_TYPES.has(type)||!id||!arActions(item).some(a=>(a.id??a._id)===id))
  throw Error('Invalid PF1 action or defense setting.');
 const actor=item?.actor??item?.parent;
 if(!game.user?.isGM&&!actor?.testUserPermission?.(game.user,'OWNER'))
  throw Error('Actor OWNER permission required.');
 const data={...(item.getFlag?.(AR_NS,AR_FLAG)??{})};
 if(type==='auto')delete data[id];else data[id]=type;
 await item.setFlag(AR_NS,AR_FLAG,data);
 return type;
}
const arNatural=roll=>{
 if(!roll||typeof roll!=='object')return null;
 const dice=Array.isArray(roll.dice)?roll.dice:[];
 const d20=dice.filter(d=>Number(d?.faces)===20);
 if(d20.length!==1)return null;
 const results=d20[0]?.results?.filter(r=>r?.active!==false&&r?.discarded!==true&&r?.rerolled!==true)??[];
 if(results.length!==1)return null;
 const n=Number(results[0]?.result);
 return Number.isSafeInteger(n)&&n>=1&&n<=20?n:null;
};
const arValue=(actor,type)=>{
 const attrs=actor?.system?.attributes;
 const value=type==='cmd'?attrs?.cmd?.total:
   attrs?.ac?.[type==='flatFooted'?'flatFooted':type]?.total;
 return typeof value==='number'&&Number.isFinite(value)?value:null;
};
function arNative(action,actionUse){
 if(action?.isCombatManeuver===true||globalThis.pf1?.config?.maneuverActionTypes?.has?.(action?.actionType))
  return {type:'cmd',provider:'pf1-native',reason:'native combat maneuver'};
 if(actionUse?.shared?.touch===true||action?.touch===true)
  return {type:'touch',provider:'pf1-native',reason:'native touch attack'};
 if(action?.hasAttack===true&&['mwak','rwak','msak','rsak','twak'].includes(action?.actionType))
  return {type:'normal',provider:'pf1-native',reason:'native attack'};
 return null;
}
const arRegister=provider=>{
 if(!provider||typeof provider.id!=='string'||!provider.id.trim()||
    provider.id.length>128||typeof provider.resolve!=='function'||
    !Number.isFinite(provider.priority??0))throw Error('Invalid defense provider.');
 const id=provider.id.trim();
 // Stable ID may be registered again after F5/module reinitialization.
 if(AR_PROVIDERS.has(id))throw Error('Defense provider ID already registered: '+id);
 AR_PROVIDERS.set(id,{id,priority:provider.priority??0,resolve:provider.resolve});
 return ()=>arUnregister(id);
};
const arUnregister=id=>AR_PROVIDERS.delete(id);
function arProviders(){return [...AR_PROVIDERS.values()]
 .sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id))
 .map(({id,priority})=>({id,priority}));}
async function arSelect(context){
 const item=context.item??context.action?.item;
 const action=context.action??context.actionUse?.action;
 const explicit=arGet(item,action);
 if(!AR_TYPES.has(explicit))return {type:null,reason:'invalid saved defense'};
 if(explicit==='manual')return {type:'manual',provider:'item',reason:'explicit manual choice'};
 if(explicit!=='auto')return {type:explicit,provider:'item',reason:'explicit action choice'};
 // Per-attack overrides are deliberately not accepted as arbitrary caller
 // input: a trusted external module should register a provider instead.
 const byPriority=new Map(),errors=[];
 for(const provider of [...AR_PROVIDERS.values()].sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id))){
  try{
   const result=await provider.resolve(Object.freeze({...context}));
   if(result==null)continue;
   if(!result||!AR_TYPES.has(result.type)||result.type==='auto')
    {errors.push(provider.id+': invalid defense type');continue;}
   const value={type:result.type,provider:provider.id,priority:provider.priority,
    reason:typeof result.reason==='string'?result.reason.slice(0,250):'external provider'};
   const group=byPriority.get(provider.priority)??[];
   group.push(value);byPriority.set(provider.priority,group);
  }catch(e){errors.push(provider.id+': '+String(e?.message??e).slice(0,250));}
 }
 if(errors.length)return {type:null,reason:'provider failure: '+errors.join('; '),errors};
 if(byPriority.size){
  const highest=Math.max(...byPriority.keys()),choices=byPriority.get(highest);
  if(new Set(choices.map(c=>c.type)).size>1)
   return {type:null,reason:'conflicting providers at priority '+highest,conflicts:choices};
  return choices[0];
 }
 return arNative(action,context.actionUse)??{type:null,reason:'native defense unavailable'};
}
function arOutcome({natural,total,defense,context}){
 const base={natural,total,defense,hit:null,defenseHit:null,
  resolution:'indeterminate',reason:null};
 if(defense.type==='manual')return {...base,reason:'manual resolution requested'};
 if(!defense.type||defense.value==null)
  return {...base,reason:defense.reason??'target defense unavailable'};
 if(natural==null||total==null)return {...base,reason:'native d20 result or final total unavailable'};
 const success=natural===20?true:natural===1?false:total>=defense.value;
 const result={...base,defenseHit:success};
 if(!success)return {...result,hit:false,resolution:'failure'};
 // Concealment differs from armor-class cover. A successful comparison is
 // NOT definitive proof of a hit if concealment remains unresolved.
 if(context?.concealmentPending===true || context?.concealment==='unknown')
  return {...result,resolution:'pendingConcealment',reason:'concealment requires a separate roll'};
 if(context?.additionalCheckPending===true)
  return {...result,reason:'additional target-specific check required'};
 // Without a confirmed visibility state, report AC success, not a certain hit.
 if(context?.concealmentCleared!==true&&context?.concealment!=='none')
  return {...result,resolution:'success',reason:'defense beaten; concealment unverified'};
 return {...result,hit:true,resolution:'success'};
}
async function arResolve(context={}){
 const action=context.action??context.actionUse?.action;
 const item=context.item??action?.item??context.actionUse?.item;
 const actor=context.actor??item?.actor??context.actionUse?.actor;
 const targetToken=context.targetToken??null;
 const targetActor=context.targetActor??targetToken?.actor??null;
 const roll=context.roll??null;
 const natural=context.natural??arNatural(roll);
 const value=context.total??roll?.total;
 const total=typeof value==='number'&&Number.isFinite(value)?value:null;
 const selected=await arSelect({...context,item,action,actor,targetToken,targetActor,roll});
 const baseValue=selected.type&&selected.type!=='manual'
   ?arValue(targetActor,selected.type):null;
 // Cover is a modifier to the defense (not concealment); allow a verified
 // external caller to pass its actual numeric bonus, without altering PF1.
 const cover=typeof context.coverBonus==='number'&&Number.isFinite(context.coverBonus)
   &&context.coverBonus>=0&&context.coverBonus<=100?context.coverBonus:0;
 const defense={...selected,value:baseValue==null?null:baseValue+cover,
   baseValue,coverBonus:cover};
 const result=arOutcome({natural,total,defense,context});
 const final={...result,actorUuid:actor?.uuid??null,itemUuid:item?.uuid??null,
  actionId:action?.id??action?._id??null,
  targetActorUuid:targetActor?.uuid??null,targetTokenUuid:targetToken?.document?.uuid??targetToken?.uuid??null,
  attackIndex:Number.isSafeInteger(context.attackIndex)?context.attackIndex:null,
  sourceMessageId:context.sourceMessageId??null};
 AR_LAST=final;return final;
}
function arSheet(sheet,html){
 const item=sheet?.document??sheet?.item??sheet?.object;
 if(!item||!arActions(item).some(a=>a?.hasAttack||a?.isCombatManeuver))return;
 const root=html?.[0]??html??sheet?.element?.[0]??sheet?.element;
 if(!root?.querySelectorAll)return;
 for(const row of root.querySelectorAll('.item-groups-list.actions .action-part[data-action-id]')){
  if(row.nextElementSibling?.dataset?.pf1aeDefense==='true')continue;
  const actionId=row.dataset.actionId,action=arActions(item).find(a=>a.id===actionId);
  if(!action||(action.hasAttack!==true&&action.isCombatManeuver!==true))continue;
  const wrap=document.createElement('label');
  wrap.dataset.pf1aeDefense='true';
  wrap.style.cssText='display:flex;align-items:center;gap:4px;min-width:0;flex:0 1 auto;padding:0 3px;font-size:11px;';
  const caption=document.createElement('span');
  caption.textContent=game.i18n?.localize?.('PF1AE.AttackResolution.TargetDefense')??'Target defense';
  caption.style.cssText='white-space:nowrap;';
  const select=document.createElement('select');
  select.style.cssText='font-size:11px;max-width:135px;min-width:80px;width:auto;height:22px;padding:0 2px;';
  const current=arGet(item,action);
  for(const type of AR_TYPES){
   const option=document.createElement('option');option.value=type;
   option.textContent=game.i18n?.localize?.('PF1AE.AttackResolution.'+type)??type;
   select.append(option);
  }
  select.value=AR_TYPES.has(current)?current:'auto';
  select.addEventListener('click',e=>e.stopPropagation());
  select.addEventListener('change',event=>{
   event.stopPropagation();const next=select.value;
   void arSet(item,action,next).catch(error=>{
    select.value=current;ui.notifications?.warn?.(error.message);
   });
  });
  wrap.append(caption,select);
  // An additional list row avoids flex overflow in native PF1 action rows.
  const li=document.createElement('li');
  li.dataset.pf1aeDefense='true';
  li.style.cssText='list-style:none;display:flex;justify-content:flex-end;padding:2px 5px;min-height:24px;';
  li.append(wrap);row.insertAdjacentElement('afterend',li);
 }
}
Hooks.once('ready',()=>{
 const mod=game.modules.get(AR_NS);if(!mod)return;mod.api??={};
 mod.api.attackResolution=Object.freeze({
  registerDefenseProvider:arRegister,unregisterDefenseProvider:arUnregister,
  listDefenseProviders:arProviders,resolveAttack:arResolve,
  getActionDefenseConfig:arGet,setActionDefenseConfig:arSet,
  lastDiagnostic:()=>AR_LAST?{...AR_LAST}:null,
  getNaturalD20:arNatural
 });
 Hooks.on('renderItemSheet',arSheet);
 Hooks.on('renderItemSheetV2',arSheet);
});
