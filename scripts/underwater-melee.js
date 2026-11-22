/**
 * PF1AE — underwater melee and native PF1 damage multipliers.
 * Foundry 13 / PF1 11.11: pf1CreateActionUse, renderApplication,
 * pf1PreDamageRoll. Never patches Actor/Item prototypes or saves data.
 *
 * PF1: slashing/bludgeoning melee attacks underwater: -2 attack and
 * half damage. Piercing normally is unaffected. Freedom of movement
 * ignores the water restriction. The generic user multiplier (0.5..10)
 * applies to native damage parts at roll time, including critical parts.
 */
const UM_NS="pf1-automation-engine";
const UM_WATER="pf1-skull-and-shackles";
const UM_SETTING="autoUnderwaterMelee";
const UM_MULT_SETTING="nativeDamageMultiplier";
const UM_FIELD="pf1ae-damage-multiplier";
const UM_OLD_FIELD="global-bonus_damage-multiplier";
const UM_APPLIED=new WeakSet();
const UM_WRAPPED=new WeakSet();
const UM_ACTION=new WeakMap();
const UM_SEEN_PARTS=new WeakSet();
let UM_LAST=null;
const umEnabled=key=>{
 try{return game.modules.get(UM_NS)?.active===true&&
   game.settings.get(UM_NS,"genericEnabled")===true&&
   game.settings.get(UM_NS,key)===true;}catch(_){return false;}
};
const umNorm=v=>String(v??"").toLowerCase().normalize("NFD")
 .replace(/[\u0300-\u036f]/g,"").replace(/[^a-z]/g,"");
const umI18n=(fr,en)=>String(game.i18n?.lang??"").startsWith("fr")?fr:en;
function umToken(v){return v?.document??v;}
function umSource(use){
 const direct=umToken(use?.token);
 if(direct?.parent?.id)return direct;
 const actor=use?.actor??use?.action?.actor;
 const active=actor?.getActiveTokens?.()??[];
 return active.length===1?umToken(active[0]):null;
}
function umWater(use){
 const token=umSource(use);
 if(!token)return false;
 const water=game.modules.get(UM_WATER);
 const api=water?.active?water.api?.waterAutomation:null;
 if(typeof api?.getState==="function"){
  try{
   const value=api.getState(token);
   if(typeof value?.underwater==="boolean")return value.underwater;
  }catch(error){console.warn("PF1AE | water state",error);}
 }
 return token.flags?.world?.underwater===true;
}
function umHasFreedom(actor){
 const normSet=new Set(["freedomofmovement","libertedemouvement"]);
 const statuses=actor?.statuses??new Set();
 if([...statuses].some(v=>normSet.has(umNorm(v))))return true;
 const effects=actor?.effects?.contents??
  (actor?.effects?.values?[...actor.effects.values()]:[]);
 return [...effects].some(e=>!e.disabled&&
  (normSet.has(umNorm(e.name??e.label))||
   [...(e.statuses??[])].some(v=>normSet.has(umNorm(v)))));
}
function umIsPhysicalMelee(action){
 if(action?.actionType!=="mwak"||action.hasAttack!==true)return false;
 const entries=action?.damage?.parts??[];
 // Only the primary weapon damage type governs underwater melee;
 // do not halve damage from unrelated energy or spell damage.
 const types=entries[0]?.types??action?.item?.system?.damageType??[];
 const raw=Array.isArray(types)?types:
  types?.values instanceof Set?[...types.values]:
  typeof types==="string"?types.split(/[,;/]/):[];
 const all=raw.map(umNorm);
 const pierce=new Set(["p","piercing","perforant","perforants"]);
 const blunt=new Set(["b","bludgeoning","contondant","contondants"]);
 const slash=new Set(["s","slashing","tranchant","tranchants"]);
 const known=all.filter(t=>pierce.has(t)||blunt.has(t)||slash.has(t));
 if(!known.length)return false; // Unclassified: never guess a penalty.
 return known.some(t=>blunt.has(t)||slash.has(t))&&
  !known.some(t=>pierce.has(t)); // Mixed weapons need a user decision.
}
function umBase(use){
 const action=use?.action??use?.shared?.action;
 if(!action?.hasAttack||!umIsPhysicalMelee(action))return null;
 if(!umWater(use))return null;
 if(umHasFreedom(use.actor??action.actor))return null;
 return {penalty:-2,multiplier:0.5,reason:"underwater-melee"};
}
function umApplyAttack(use){
 if(!umEnabled(UM_SETTING)||!use||UM_APPLIED.has(use))return;
 const details=umBase(use);
 if(!details)return;
 if(!Array.isArray(use.shared?.attackBonus))return;
 use.shared.attackBonus.push(
  `-2[${umI18n("Combat sous l’eau","Underwater melee")}]`);
 UM_APPLIED.add(use);
 UM_LAST={status:"attack-penalty",...details};
}
function umNumber(value){
 const x=typeof value==="number"?value:Number(String(value??"").trim()
  .replace(",","."));
 return Number.isFinite(x)&&x>=0&&x<=10?x:null;
}
function umSetAction(use){
 const action=use?.action??use?.shared?.action;
 if(!action)return;
 const user=umEnabled(UM_MULT_SETTING)?
  umNumber(use.formData?.[UM_FIELD]):null;
 const base=umEnabled(UM_SETTING)?umBase(use):null;
 // Preserve the exact individual modifiers for diagnostics. Multiply
 // once, never append an extra damage roll with fresh weapon dice.
 const multiplier=(user===null?1:user)*(base?.multiplier??1);
 UM_ACTION.set(action,{multiplier,user:user??1,base,
  actorUuid:use.actor?.uuid??null});
 UM_LAST={status:"damage-prepared",multiplier,
  underwater:!!base,attackPenalty:base?.penalty??0};
}
function umWrapDialog(use){
 if(!use||UM_WRAPPED.has(use))return;
 const old=use.createAttackDialog;
 if(typeof old!=="function")return;
 const guarded=async function(...args){
  const value=await old.apply(this,args);
  if(value!==null&&value!==undefined){
   // Roll Bonuses may still be active for other bonus families.
   // Remove only its old multiplier so the two cannot stack.
   if(this.formData&&Object.hasOwn(this.formData,UM_OLD_FIELD))
    delete this.formData[UM_OLD_FIELD];
   umSetAction(this);
  }
  return value;
 };
 try{
  Object.defineProperty(use,"createAttackDialog",{
   value:guarded,configurable:true,writable:true,enumerable:false});
  UM_WRAPPED.add(use);
 }catch(error){console.warn("PF1AE | multiplier dialog wrapper",error);}
}
function umIsDamagePhysical(part){
 const types=part?.damageType?.values??[];
 const all=Array.isArray(types)?types.map(umNorm):[];
 if(!all.length)return true; // Primary untyped damage follows weapon.
 return !all.some(t=>["fire","cold","acid","electricity","sonic",
  "force","feu","froid","acide","electricite","son"].includes(t));
}
function umMultiplyParts(action,parts){
 if(!Array.isArray(parts)||UM_SEEN_PARTS.has(parts))return;
 const info=UM_ACTION.get(action);
 if(!info||!Number.isFinite(info.multiplier)||
    info.multiplier===1)return;
 // Never edit the Item or the Actor: these are ephemeral damage
 // components supplied by PF1 immediately before it rolls the dice.
 let count=0;
 for(const part of parts){
  if(!part||typeof part.base!=="string"||!part.base.trim())continue;
  if(info.base&&!umIsDamagePhysical(part))continue;
  const k=info.multiplier;
  // PF1 dice parser supports floor(); PF1e rounds down. This retains
  // the native roll's dice, critical part and damage type metadata.
  // Native PF1 puts bonus formulas into the first part's "extra".
  // Combine these BEFORE flooring, so 1d8 + 4 becomes
  // floor((1d8 + 4) * 0.5), not floor(1d8 * 0.5) + 4.
  // Leave separately typed energy damage untouched under water.
  const extras=Array.isArray(part.extra)?part.extra.filter(v=>
   typeof v==="string"&&v.trim()):[];
  const combined=[part.base,...extras].map(v=>`(${v})`).join(" + ");
  part.base=`floor((${combined}) * ${k})`;
  if(Array.isArray(part.extra))part.extra=[];
  count++;
 }
 if(count){
  UM_SEEN_PARTS.add(parts);
  UM_LAST={...info,status:"damage-multiplied",parts:count};
 }
}
function umRender(app,[html]){
 const Klass=globalThis.pf1?.applications?.AttackDialog;
 if(!Klass||!(app instanceof Klass)||!umEnabled(UM_MULT_SETTING))return;
 const root=html;
 if(!root?.querySelector||root.querySelector(`input[name="${UM_FIELD}"]`))return;
 const old=root.querySelector(`input[name="${UM_OLD_FIELD}"]`);
 if(old){
  // Existing Roll Bonuses field is replaced, not duplicated.
  old.value="";
  old.disabled=true;
  old.closest?.(".form-group")?.remove?.();
 }
 const anchor=root.querySelector('input[name="damage-bonus"]')?.closest(".form-group");
 if(!anchor||!globalThis.document?.createElement)return;
 const group=document.createElement("div");
 group.className="form-group pf1ae-damage-multiplier";
 const label=document.createElement("label");
 label.textContent=umI18n("Multiplicateur de dégâts","Damage multiplier");
 const fields=document.createElement("div");
 fields.className="form-fields";
 const input=document.createElement("input");
 input.type="number";input.name=UM_FIELD;input.min="0";
 input.max="10";input.step="0.5";input.value="1";
 input.title=umI18n("1 = normal ; 0,5 = moitié ; 2 = double",
  "1 = normal; 0.5 = half; 2 = double");
 fields.appendChild(input);group.append(label,fields);anchor.after(group);
 app.setPosition?.();
}
Hooks.once("init",()=>{
 game.settings.register(UM_NS,UM_SETTING,{
  name:"PF1AE — Combat au corps à corps sous l’eau",
  hint:"Applique –2 à l’attaque et la moitié des dégâts pour les attaques tranchantes ou contondantes immergées, sauf exceptions PF1.",
  scope:"world",config:true,restricted:true,type:Boolean,default:true
 });
 game.settings.register(UM_NS,UM_MULT_SETTING,{
  name:"PF1AE — Multiplicateur de dégâts natif",
  hint:"Ajoute un champ au dialogue PF1. Remplace le multiplicateur de Roll Bonuses, sans désactiver les autres bonus du module.",
  scope:"world",config:true,restricted:true,type:Boolean,default:true
 });
 Hooks.on("pf1CreateActionUse",use=>{
  try{umApplyAttack(use);umWrapDialog(use);}
  catch(error){console.warn("PF1AE | underwater melee attack",error);}
 });
 Hooks.on("pf1PreDamageRoll",(action,_data,parts)=>{
  try{umMultiplyParts(action,parts);}
  catch(error){console.warn("PF1AE | native damage multiplier",error);}
 });
 Hooks.on("renderApplication",umRender);
});
Hooks.once("ready",()=>{
 const mod=game.modules.get(UM_NS);if(!mod)return;
 mod.api??={};
 mod.api.underwaterMelee=Object.freeze({
  preview:umBase,lastDiagnostic:()=>UM_LAST?{...UM_LAST}:null,
  apply:umApplyAttack,prepare:umSetAction,multiply:umMultiplyParts
 });
});
