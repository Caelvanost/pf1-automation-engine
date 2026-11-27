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
const UM_DISPLAY="pf1aeDamageMultiplierDisplay";
const UM_DISPLAY_WRAPPED=Symbol.for("pf1ae.damageMultiplierDisplay");
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
  try{
   await umMultiplyAttacks(this,this.shared?.chatAttacks,info);
  }catch(error){
   UM_LAST={...info,status:"damage-multiplier-error",error:String(error?.message??error)};
   console.error("PF1AE | damage multiplier failed",error);
   globalThis.ui?.notifications?.error?.(umI18n(
    "PF1AE : impossible de multiplier les dégâts. Attaque interrompue ; détails dans la console (F12).",
    "PF1AE: damage multiplier failed. Attack interrupted; see console (F12)."));
   throw error;
  }
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
  const nativeCorrection=index===0?correction:0;
  exact+=(raw+nativeCorrection)*factor;
  const next=umFloor(exact),total=next-rounded;rounded=next;
  return {roll,total,factor,nativeCorrection};
 });
 return {rows,exact,rounded};
}
function umDiceSignature(roll){
 return JSON.stringify((roll.dice??[]).map(d=>({faces:d.faces,number:d.number,results:d.results})));
}
// Persist display metadata in Roll.options, including the native serialized
// inline-roll data. It never replaces authoritative terms or totals.
function umDisplayRecord(roll,total,factor,correction,adjusted){
 return {version:1,formula:String(roll.formula??""),originalTotal:roll.total,total,factor,correction,
  adjusted,termCount:roll.terms.length};
}
function umDisplayData(roll){
 const d=roll?.options?.[UM_DISPLAY];
 if(d?.version!==1||typeof d.formula!=="string"||!d.formula||d.formula.length>10000||
    ![d.originalTotal,d.total,d.factor,d.correction].every(Number.isFinite)||
    d.factor<0||d.factor>10||d.total!==roll.total||!Number.isSafeInteger(d.termCount)||
    d.termCount<1||typeof d.adjusted!=="boolean")return null;
 const terms=roll.terms;
 if(!Array.isArray(terms)||terms.length!==d.termCount+(d.adjusted?2:0))return null;
 if(d.adjusted){
  const op=terms.at(-2),num=terms.at(-1),delta=d.total-d.originalTotal;
  if(op?.operator!==(delta<0?"-":"+")||num?.number!==Math.abs(delta))return null;
  const flavor=String(num.flavor??num.options?.flavor??"");
  if(!["Multiplicateur de dégâts","Damage multiplier"].some(label=>flavor===label+" ×"+d.factor))return null;
 }else if(d.total!==d.originalTotal)return null;
 return d;
}
function umDisplayFormula(d){
 const native=d.correction===0?d.formula:
  umI18n("min. natif : ","native minimum: ")+String(d.originalTotal+d.correction);
 return "("+native+") × "+String(d.factor);
}
function umDisplaySummary(d){
 const raw=(d.originalTotal+d.correction)*d.factor;
 const shown=Math.round(raw*1e10)/1e10;
 const parts=[umDisplayFormula(d)+" = "+shown];
 if(Math.abs(raw-d.total)>1e-8)parts.push(umI18n("Arrondi global (répartition) : ","Global rounding (allocation): ")+d.total);
 if(d.correction!==0)parts.push(umI18n("Formule initiale : ","Original formula: ")+d.formula);
 return parts.join(" — ");
}
const umEscapeTooltip=s=>s.replace(/[&<>"\']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function umInstallDisplay(){
 const proto=globalThis.pf1?.dice?.DamageRoll?.prototype;
 if(!proto||proto[UM_DISPLAY_WRAPPED])return;
 const nativeTooltip=proto.getTooltip,nativeAnchor=proto.toAnchor;
 if(typeof nativeTooltip!=="function"||typeof nativeAnchor!=="function")return;
 // Only the PF1 DamageRoll class and rolls with verified metadata.
 const tooltip=async function(...args){
  const html=await nativeTooltip.apply(this,args),d=umDisplayData(this);
  if(!d||typeof html!=="string"||!globalThis.document?.createElement)return html;
  try{
   const template=globalThis.document.createElement("template");
   template.innerHTML=html;
   const wrapper=template.content.querySelector(".dice-tooltip .wrapper");
   if(!wrapper)return html;
   if(d.adjusted){
    const row=wrapper.querySelector("section.tooltip-part:last-child");
    const flavor=row?.querySelector(".part-flavor")?.textContent?.trim();
    const expected=String(this.terms.at(-1).flavor??this.terms.at(-1).options?.flavor??"");
    // Match the exact last native numeric adjustment row; fail visually
    // closed if the native template or another module changes its layout.
    if(!row||flavor!==expected)return html;
    row.remove();
   }
   const section=globalThis.document.createElement("section");
   section.className="tooltip-part pf1ae-damage-multiplier-summary";
   const header=globalThis.document.createElement("header");
   header.className="part-header";
   header.textContent=umDisplaySummary(d);
   section.append(header);wrapper.append(section);
   return template.innerHTML;
  }catch(error){console.warn("PF1AE | multiplier tooltip display",error);return html;}
 };
 const anchor=function(...args){
  const a=nativeAnchor.apply(this,args),d=umDisplayData(this);
  if(d&&a?.setAttribute){
   const current=a.getAttribute?.("data-tooltip");
   if(current==null||current===this.formula)a.setAttribute("data-tooltip",umEscapeTooltip(umDisplaySummary(d)));
   if(a.getAttribute?.("title")===this.formula)a.setAttribute("title",umDisplaySummary(d));
  }
  return a;
 };
 try{
  Object.defineProperties(proto,{
   getTooltip:{value:tooltip,configurable:true,writable:true},
   toAnchor:{value:anchor,configurable:true,writable:true},
   [UM_DISPLAY_WRAPPED]:{value:true,configurable:true}
  });
 }catch(error){console.warn("PF1AE | multiplier display integration unavailable",error);}
}
async function umRollWithTotal(roll,total,factor,correction=0){
 if(roll.total===total){
  if(factor!==1||correction!==0)roll.options[UM_DISPLAY]=umDisplayRecord(roll,total,factor,correction,false);
  return roll;
 }
 // Deterministic adjustment; preserve evaluated dice and damage metadata.
 const delta=total-roll.total;
 const {OperatorTerm,NumericTerm}=foundry.dice.terms;
 const op=new OperatorTerm({operator:delta<0?"-":"+"});
 const num=new NumericTerm({number:Math.abs(delta),options:{flavor:
  umI18n("Multiplicateur de dégâts","Damage multiplier")+" ×"+factor}});
 // Foundry v13 creates static terms such as OperatorTerm already evaluated
 // and immutable. Evaluating them again throws before the attack card exists.
 // RollTerm._evaluated is the v13 evaluation flag; only evaluate new,
 // unevaluated deterministic terms. Never evaluate the original dice.
 for(const term of [op,num]){
  if(term._evaluated!==true&&term.isEvaluated!==true)await term.evaluate();
  if(term._evaluated!==true&&term.isEvaluated!==true)
   throw Error("PF1AE: deterministic adjustment term is not evaluated.");
 }
 const signature=umDiceSignature(roll);
 const scaled=roll.constructor.fromTerms([...roll.terms,op,num],{...roll.options,
  [UM_DISPLAY]:umDisplayRecord(roll,total,factor,correction,true)});
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
  const normalRolls=await Promise.all(n.rows.map(r=>umRollWithTotal(r.roll,r.total,r.factor,r.nativeCorrection)));
  const critRolls=c?await Promise.all(c.rows.map(r=>umRollWithTotal(r.roll,r.total,r.factor,r.nativeCorrection))):null;
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
 umInstallDisplay();
 const mod=game.modules.get(UM_NS);if(!mod)return;
 mod.api??={};
 mod.api.underwaterMelee=Object.freeze({
  preview:umBase,lastDiagnostic:()=>UM_LAST?{...UM_LAST}:null,
  apply:umApplyAttack,prepare:umSetAction,multiply:umMultiplyAttacks
 });
});
