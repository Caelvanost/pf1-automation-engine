/**
 * PF1AE generic attack resolution — no firearm-specific rules.
 * Foundry v13 / PF1 v11.11. Optional service: never changes AC, attacks or HP.
 */
const AR_NS='pf1-automation-engine';
const AR_TYPES=new Set(['normal','touch','flatFooted','cmd','manual']);
const AR_PROVIDERS=new Map();
let AR_LAST=null;
// PF1 native action.touch, action.isCombatManeuver and action.hasSave are
// authoritative. Legacy attackDefenseConfig flags from v1.25.0 are ignored,
// but are left untouched in the world to avoid destructive migration.
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
function arClassify(action,actionUse=null){
 const maneuver=action?.isCombatManeuver===true||
  !!globalThis.pf1?.config?.maneuverActionTypes?.has?.(action?.actionType);
 const attack=maneuver||action?.hasAttack===true;
 const save=action?.hasSave===true;
 const touch=!maneuver&&(actionUse?.shared?.touch===true||action?.touch===true);
 return {
  kind:attack?(save?'attackAndSave':'attack'):(save?'save':'other'),
  defenseType:attack?(maneuver?'cmd':(touch?'touch':'normal')):null,
  saveType:save?(action.save?.type??null):null,
  hasAttack:attack,hasSave:save
 };
}
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
 const action=context.action??context.actionUse?.action;
 // Native combat maneuver always targets CMD; the system has already
 // resolved the category of the action (including a trip maneuver).
 if(action?.isCombatManeuver===true||
  globalThis.pf1?.config?.maneuverActionTypes?.has?.(action?.actionType))
  return {type:'cmd',provider:'pf1-native',reason:'native combat maneuver'};
 // A pure saving-throw action has NO attack roll to compare against AC.
 // PF1AE saveContext/saveOutcomes handle the eventual native target saves.
 if(action?.hasSave===true&&action?.hasAttack!==true)
  return {type:null,provider:'pf1-native',reason:'native saving throw action; use saveContext/saveOutcomes',
   save:{type:action.save?.type??null,dc:null}};
 // The native PF1 "Contact" checkbox (including ActionUse touch override)
 // is authoritative. Other modules must not silently override an explicit
 // PF1 touch attack with a different AC.
 if(context.actionUse?.shared?.touch===true||action?.touch===true)
  return {type:'touch',provider:'pf1-native',reason:'native Contact checkbox'};
 const byPriority=new Map(),errors=[];
 for(const provider of [...AR_PROVIDERS.values()].sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id))){
  try{
   const result=await provider.resolve(Object.freeze({...context}));
   if(result==null)continue;
   if(!result||!AR_TYPES.has(result.type))
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
  return {...base,reason:defense.reason??'target defense unavailable',
   resolution:defense.save?'pendingSave':'indeterminate'};
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
 const final={...result,save:selected.save??null,actorUuid:actor?.uuid??null,itemUuid:item?.uuid??null,
  actionId:action?.id??action?._id??null,
  targetActorUuid:targetActor?.uuid??null,targetTokenUuid:targetToken?.document?.uuid??targetToken?.uuid??null,
  attackIndex:Number.isSafeInteger(context.attackIndex)?context.attackIndex:null,
  sourceMessageId:context.sourceMessageId??null};
 AR_LAST=final;return final;
}
Hooks.once('ready',()=>{
 const mod=game.modules.get(AR_NS);if(!mod)return;mod.api??={};
 mod.api.attackResolution=Object.freeze({
  registerDefenseProvider:arRegister,unregisterDefenseProvider:arUnregister,
  listDefenseProviders:arProviders,resolveAttack:arResolve,
  lastDiagnostic:()=>AR_LAST?{...AR_LAST}:null,
  getNaturalD20:arNatural,classifyAction:arClassify
 });
});
