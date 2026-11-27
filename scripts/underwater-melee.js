/**
 * PF1AE — underwater melee and native PF1 damage multipliers.
 * Foundry 13 / PF1 11.11: per-ActionUse wrappers on native dialog and
 * generateChatAttacks. Scale complete evaluated rolls without rerolling.
 *
 * PF1: slashing/bludgeoning melee attacks underwater: -2 attack and
 * half damage. Piercing normally is unaffected. Freedom of movement
 * ignores the water restriction. The generic user multiplier (0.5..10)
 * applies after all native damage bonuses, including critical parts.
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
const UM_SCALED_ATTACKS=new WeakSet();
const UM_DIALOG_VALUES=new WeakMap();
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
  types instanceof Set?[...types]:
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
 if(typeof value!=="number"&&typeof value!=="string")return null;
 const raw=typeof value==="string"?value.trim().replace(",","."):value;
 if(raw==="")return null; // Number("") would incorrectly yield zero.
 const x=Number(raw);
 return Number.isFinite(x)&&x>=0&&x<=10?x:null;
}
function umSetAction(use){
 const user=umEnabled(UM_MULT_SETTING)?(umNumber(use.formData?.[UM_FIELD])??1):1;
 const base=umEnabled(UM_SETTING)?umBase(use):null;
 const info={multiplier:user*(base?.multiplier??1),user,base,actorUuid:use.actor?.uuid??null};
 // Neutral manual input and no aquatic penalty: retain no scaling state.
 if(user===1&&!base){
  UM_ACTION.delete(use);
  UM_LAST={status:"native-unmodified",actorUuid:info.actorUuid};
  return info;
 }
 UM_ACTION.set(use,info);UM_LAST={...info,status:"damage-prepared"};return info;
}
function umWrapUse(use){
 if(!use||UM_WRAPPED.has(use))return;
 const dialog=use.createAttackDialog,generate=use.generateChatAttacks;
 if(typeof dialog!=="function"||typeof generate!=="function")return;
 // PF1 only assigns this.formData after createAttackDialog resolves.
 const guarded=async function(...args){
  const form=await dialog.apply(this,args);
  if(form&&typeof form==="object"&&umEnabled(UM_MULT_SETTING)){
   const raw=UM_DIALOG_VALUES.has(this)?UM_DIALOG_VALUES.get(this):form[UM_FIELD];
   const factor=umNumber(raw);
   // Do not inject a neutral multiplier into PF1's submitted form.
   // Preserve an explicit zero and all valid non-neutral choices.
   if(factor===null||factor===1)delete form[UM_FIELD];
   else form[UM_FIELD]=factor;
   delete form[UM_OLD_FIELD];
  }
  return form;
 };
 const complete=async function(...args){
  const info=umSetAction(this);
  // A true pass-through: no inspection, allocation, or reconstruction of
  // native rolls, including crits and PF1's minimum damage adjustments.
  if(info.user===1&&!info.base)return generate.apply(this,args);
  const result=await generate.apply(this,args);
  await umMultiplyAttacks(this,this.shared?.chatAttacks,info);
  return result;
 };
 try{
  Object.defineProperties(use,{
   createAttackDialog:{value:guarded,configurable:true,writable:true,enumerable:false},
   generateChatAttacks:{value:complete,configurable:true,writable:true,enumerable:false}
  });
  UM_WRAPPED.add(use);
 }catch(error){console.warn("PF1AE | multiplier action-use wrapper",error);}
}
function umIsDamagePhysical(roll,index){
 const types=roll?.options?.damageType??roll?.damageType?.types??[];
 const ids=(typeof types==="string"?[types]:[...types]).map(umNorm);
 return ids.some(t=>["slashing","piercing","bludgeoning","s","p","b"].includes(t))||
  index===0&&(!ids.length||ids.every(t=>t==="untyped"));
}
const umFloor=n=>Math.floor(n+Number.EPSILON*Math.max(1,Math.abs(n))*4);
const umSum=rolls=>rolls.reduce((sum,r)=>sum+Number(r.total),0);
function umNativeCorrection(data,rolls,previousRaw=0){
 const sum=previousRaw+umSum(rolls),diff=Number(data.total)-sum;
 if(!Number.isFinite(sum)||!Number.isFinite(diff))throw Error("Invalid native damage total.");
 if(diff===0)return 0;
 // Normalize native minimum damage (1 nonlethal) before scaling.
 if(sum<1&&data.total===1)return diff;
 throw Error("Native damage total differs from evaluated components.");
}
function umAllocate(rolls,info,start=0,roundedStart=0,correction=0){
 let exact=start,rounded=roundedStart;
 const rows=rolls.map((roll,index)=>{
  const raw=Number(roll.total);
  if(!Number.isFinite(raw))throw Error("Invalid native damage roll.");
  const factor=info.user*(info.base&&umIsDamagePhysical(roll,index)?0.5:1);
  exact+=(raw+(index===0?correction:0))*factor;
  const next=umFloor(exact),total=next-rounded;rounded=next;
  return {roll,total,factor};
 });
 return {rows,exact,rounded};
}
function umDiceSignature(roll){
 return JSON.stringify((roll.dice??[]).map(d=>({faces:d.faces,number:d.number,results:d.results})));
}
async function umRollWithTotal(roll,total,factor){
 if(roll.total===total)return roll;
 // Deterministic adjustment; preserve evaluated dice and damage metadata.
 const delta=total-roll.total;
 const {OperatorTerm,NumericTerm}=foundry.dice.terms;
 const op=await new OperatorTerm({operator:delta<0?"-":"+"}).evaluate();
 const num=await new NumericTerm({number:Math.abs(delta),options:{flavor:
  umI18n("Multiplicateur de dégâts","Damage multiplier")+" ×"+factor}}).evaluate();
 const signature=umDiceSignature(roll);
 const scaled=roll.constructor.fromTerms([...roll.terms,op,num],{...roll.options});
 // Never evaluate the reconstructed roll containing dice.
 if(!(scaled instanceof roll.constructor)||scaled.total!==total||
    umDiceSignature(scaled)!==signature||umDiceSignature(roll)!==signature||
    JSON.stringify(scaled.options.damageType)!==JSON.stringify(roll.options.damageType)||
    scaled.options.type!==roll.options.type)
  throw Error("PF1AE: evaluated damage roll reconstruction could not be verified.");
 return scaled;
}
async function umMultiplyAttacks(use,attacks,info=UM_ACTION.get(use)){
 if(!info||!Array.isArray(attacks)||info.user===1&&!info.base)return {scaled:0};
 const updates=[];
 // Stage the entire action, never leave only some attacks multiplied.
 for(const attack of attacks){
  if(!attack||UM_SCALED_ATTACKS.has(attack))continue;
  const normal=attack.damage,crit=attack.critDamage;
  if(!Array.isArray(normal?.rolls)||!normal.rolls.length)continue;
  const nr=normal.rolls,cr=Array.isArray(crit?.rolls)?crit.rolls:[];
  const correction=umNativeCorrection(normal,nr);
  const n=umAllocate(nr,info,0,0,correction);
  const c=cr.length?umAllocate(cr,info,n.exact,n.rounded,
   umNativeCorrection(crit,cr,umSum(nr))-correction):null;
  const normalRolls=await Promise.all(n.rows.map(r=>umRollWithTotal(r.roll,r.total,r.factor)));
  const critRolls=c?await Promise.all(c.rows.map(r=>umRollWithTotal(r.roll,r.total,r.factor))):null;
  updates.push({attack,normal,crit,normalRolls,critRolls,normalTotal:n.rounded,critTotal:c?.rounded});
 }
 for(const u of updates){
  u.normal.rolls=u.normalRolls;u.normal.total=u.normalTotal;
  if(u.critRolls){u.crit.rolls=u.critRolls;u.crit.total=u.critTotal}
  UM_SCALED_ATTACKS.add(u.attack);
 }
 UM_LAST={...info,status:"damage-multiplied",attacks:updates.length};
 return {scaled:updates.length};
}
function umRender(app,htmlArg){
 const Klass=globalThis.pf1?.applications?.AttackDialog;
 if(!Klass||!(app instanceof Klass)||!umEnabled(UM_MULT_SETTING))return;
 const root=htmlArg?.[0]??htmlArg;
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
 const group=globalThis.document.createElement("div");
 group.className="form-group pf1ae-damage-multiplier";
 const label=globalThis.document.createElement("label");
 label.textContent=umI18n("Multiplicateur de dégâts","Damage multiplier");
 const fields=globalThis.document.createElement("div");
 fields.className="form-fields";
 const input=globalThis.document.createElement("input");
 input.type="number";input.name=UM_FIELD;input.min="0";
 input.max="10";input.step="any";
 const use=app.actionUse;
 input.placeholder="1";
 input.value=String(use&&UM_DIALOG_VALUES.has(use)?UM_DIALOG_VALUES.get(use):"");
 if(use){
  const remember=()=>UM_DIALOG_VALUES.set(use,input.value);
  remember();input.addEventListener("input",remember);input.addEventListener("change",remember);
 }
 input.title=umI18n("Vide ou 1 = jet natif inchangé ; 0,5 = moitié ; 2 = double",
  "Empty or 1 = unchanged native roll; 0.5 = half; 2 = double");
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
  try{umApplyAttack(use);umWrapUse(use);}
  catch(error){console.warn("PF1AE | underwater melee attack",error);}
 });
 Hooks.on("renderApplication",umRender);
});
Hooks.once("ready",()=>{
 const mod=game.modules.get(UM_NS);if(!mod)return;
 mod.api??={};
 mod.api.underwaterMelee=Object.freeze({
  preview:umBase,lastDiagnostic:()=>UM_LAST?{...UM_LAST}:null,
  apply:umApplyAttack,prepare:umSetAction,multiply:umMultiplyAttacks
 });
});
