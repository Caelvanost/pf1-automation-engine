/**
 * PF1AE basic damage resolution — exact PF1 11.11 / Foundry 13.
 * Opt-in; native actor.applyDamage still commits HP, THP and nonlethal.
 * No global chat state, no canvas selection, no ability-specific code.
 */
const DR_NS="pf1-automation-engine",DR_SETTING="automaticDamageDefenses";
const DR_AD="pf1-automate-damage";
const DR_ENERGY=new Set(["acid","cold","electric","fire","sonic"]);
const DR_PHYSICAL=new Set(["bludgeoning","piercing","slashing"]);
const DR_OTHER=new Set(["untyped","force"]);
const DR_TAGS=new Set(["precision","nonlethal","areaOfEffect"]);
const DR_SEEN=new WeakSet(),DR_LAST=new Map();
const drText=(fr,en)=>String(game.i18n?.lang??"").startsWith("fr")?fr:en;
const drAvailable=()=>game.release?.generation===13&&game.system?.id==="pf1"&&game.system?.version==="11.11"&&
 game.modules.get(DR_NS)?.active===true&&!game.modules.get(DR_AD)?.active&&
 game.settings.get(DR_NS,"genericEnabled")===true&&game.settings.get(DR_NS,DR_SETTING)===true;
const drArray=x=>Array.isArray(x)?x:x instanceof Set?[...x]:typeof x?.values==="function"?[...x.values()]:null;
const drCustom=x=>typeof x==="string"?x.trim().length>0:(drArray(x)?.length??0)>0;
function drFail(reason){return {supported:false,reason}}
function drIds(trait){
 if(trait==null)return [];
 if(drCustom(trait.custom))throw Error("custom-damage-trait");
 const ids=drArray(trait.standard??trait.value);
 if(!ids||ids.some(x=>typeof x!=="string"))throw Error("unverified-damage-trait");
 return ids;
}
function drEntries(trait){
 if(trait==null)return [];
 if(drCustom(trait.custom))throw Error("custom-resistance");
 const list=drArray(trait.value);
 if(!list)throw Error("unverified-resistance");
 return list.map(row=>{
  const types=drArray(row?.types);
  if(!types||types.some(t=>typeof t!=="string")||!Number.isSafeInteger(row.amount)||row.amount<0)
   throw Error("unverified-resistance-entry");
  return {amount:row.amount,types:types.filter(Boolean)};
 });
}
const drFloor=n=>Math.floor(n+Number.EPSILON*Math.max(1,Math.abs(n))*4);
function drComponents(input){
 if(!Array.isArray(input)||!input.length||input.length>500)throw Error("missing-typed-damage");
 return input.map(x=>{
  const amount=x?.value??x?.amount,types=drArray(x?.types??x?.damageType);
  if(!Number.isSafeInteger(amount)||amount<0||!types)throw Error("unverified-damage-component");
  const tags=[...new Set(types.filter(t=>DR_TAGS.has(t)))];
  const ids=[...new Set(types.filter(t=>!DR_TAGS.has(t)))];
  if(ids.length!==1||!DR_ENERGY.has(ids[0])&&!DR_PHYSICAL.has(ids[0])&&!DR_OTHER.has(ids[0]))
   throw Error("mixed-or-unsupported-damage-type");
  return {type:ids[0],amount,tags};
 });
}
function drPreview({actor,components,ratio=1,sourceKind=null,magic=null,asNonlethal=false}={}){
 try{
  if(!actor?.system?.traits)return drFail("missing-native-traits");
  if(ratio!==1&&ratio!==0.5)return drFail("unsupported-ratio");
  const rows=drComponents(components),traits=actor.system.traits;
  if(!asNonlethal&&rows.some(r=>r.tags.includes("nonlethal")))return drFail("mixed-or-unverified-nonlethal");
  // PF1 cannot separate lethal and nonlethal components in one HP call.
  if(asNonlethal&&rows.some(r=>r.tags.includes("nonlethal"))&&rows.some(r=>!r.tags.includes("nonlethal")))
   return drFail("mixed-nonlethal");
  if(Number(traits.hardness??0)>0)return drFail("hardness-next-stage");
  const immunity=new Set(drIds(traits.di)),vulnerability=new Set(drIds(traits.dv));
  const hasEnergy=rows.some(r=>DR_ENERGY.has(r.type));
  const energy=hasEnergy?drEntries(traits.eres):[];
  if(energy.some(r=>r.types.length!==1||!DR_ENERGY.has(r.types[0])))return drFail("complex-energy-resistance");
  // Group same energy type before applying the highest resistance ONCE.
  const groups=new Map();
  for(const r of rows)groups.set(r.type,(groups.get(r.type)??0)+r.amount);
  const result=[];
  let exact=0,rounded=0;
  for(const [type,raw] of groups){
   exact+=raw*ratio;
   const next=drFloor(exact),incoming=next-rounded;rounded=next;
   const immune=immunity.has(type);
   let amount=immune?0:incoming,resistance=0,extra=0;
   if(!immune&&DR_ENERGY.has(type)){
    resistance=Math.min(amount,Math.max(0,...energy.filter(r=>r.types[0]===type).map(r=>r.amount)));
    // No blanket ordering invented for combined vulnerability + resistance:
    // different PF1 effects explicitly define different orders.
    if(vulnerability.has(type)&&resistance>0&&amount>0)return drFail("combined-vulnerability-resistance");
    amount-=resistance;
    if(vulnerability.has(type)){extra=drFloor(amount*1.5)-amount;amount+=extra}
   }else if(!immune&&vulnerability.has(type)&&incoming>0)return drFail("non-energy-vulnerability");
   result.push({type,raw,incoming,immune,resistance,vulnerabilityBonus:extra,damageReduction:0,final:amount});
  }
  // Highest applicable weapon DR, once per hit. No DR on spell damage.
  let dr=0;
  const physical=result.filter(r=>DR_PHYSICAL.has(r.type)&&r.final>0);
  if(physical.length&&sourceKind!=="other"){
   const reductions=drEntries(traits.dr).filter(r=>r.amount>0);
   if(reductions.length&&sourceKind!=="weapon")return drFail("unknown-physical-source");
   if(reductions.length){
    if(physical.length!==1)return drFail("mixed-physical-damage");
    const type=physical[0].type;
    for(const entry of reductions){
     if(entry.types.length>1)return drFail("complex-damage-reduction");
     const bypass=entry.types[0];
     if(bypass&&bypass!=="magic"&&!DR_PHYSICAL.has(bypass))return drFail("material-alignment-damage-reduction");
     if(bypass==="magic"&&typeof magic!=="boolean")return drFail("unknown-magic-bypass");
     if(bypass===type||(bypass==="magic"&&magic===true))continue;
     dr=Math.max(dr,entry.amount);
    }
    const row=physical[0],applied=Math.min(row.final,dr);
    row.damageReduction=applied;row.final-=applied;dr=applied;
   }
  }
  return {supported:true,raw:rows.reduce((a,r)=>a+r.amount,0),ratio,incoming:rounded,
   total:result.reduce((a,r)=>a+r.final,0),damageReduction:dr,components:result};
 }catch(e){return drFail(String(e?.message??e))}
}
function drSource(options){
 const action=options.action,item=action?.item??options.item,type=action?.actionType;
 if(["mwak","rwak","twak"].includes(type)&&item?.type!=="spell"){
  let magic=null;
  if(Number.isFinite(action.enhancementBonus)){
   magic=action.enhancementBonus>0;
   // Ammo and innate magical natural attacks require their exact snapshot.
   // Do not assume a mundane attack merely because its launcher is +0.
   if(!magic&&(action.ammo?.type||item?.subType==="natural")){
    const innate=item?.subType==="natural"?action.actor?.system?.traits?.dr:null;
    if(innate&&!drCustom(innate.custom)&&drArray(innate.value)?.some(r=>drArray(r.types)?.includes("magic")))magic=true;
    else if(action.ammo?.type||drCustom(innate?.custom))magic=null;
   }
  }
  return {sourceKind:"weapon",magic};
 }
 if(item?.type==="spell"&&!["mwak","rwak","twak"].includes(type)||["msak","rsak"].includes(type))
  return {sourceKind:"other",magic:null};
 return {sourceKind:null,magic:null};
}
function drRemember(actor,result){
 if(!actor?.uuid)return;
 DR_LAST.set(actor.uuid,result);if(DR_LAST.size>200)DR_LAST.delete(DR_LAST.keys().next().value);
}
const DR_REASONS={
 "hardness-next-stage":["solidité","hardness"],
 "material-alignment-damage-reduction":["RD de matériau ou d’alignement","material/alignment DR"],
 "complex-damage-reduction":["RD complexe","complex DR"],
 "unknown-magic-bypass":["contournement magique non vérifié","unverified magic bypass"],
 "custom-resistance":["résistance personnalisée","custom resistance"],
 "custom-damage-trait":["défense personnalisée","custom defense"],
 "combined-vulnerability-resistance":["résistance et vulnérabilité simultanées","combined resistance and vulnerability"],
 "mixed-or-unsupported-damage-type":["type de dégâts mixte ou non pris en charge","mixed or unsupported damage type"],
 "native-card-total-mismatch":["total de carte incohérent","inconsistent card total"]
};
function drBlock(actor,options,result){
 drRemember(actor,result);
 // Do not silently apply full damage when a defense is unsupported.
 options.value=0;
 const [fr,en]=DR_REASONS[result.reason]??["cas non pris en charge","unsupported case"];
 console.warn("[PF1AE][Damage] Manual adjudication required",actor.uuid,result.reason);
 globalThis.ui?.notifications?.warn?.(drText(
  "PF1AE : dégâts non appliqués automatiquement ("+fr+"). Utilise la fenêtre native d’application des dégâts.",
  "PF1AE: automatic damage not applied ("+en+"). Use the native Apply Damage dialog."));
}
function drOnApply(actor,options){
 if(!drAvailable()||!options||DR_SEEN.has(options))return;
 // Native dialog already computes its own adjustments. Healing, direct
 // HP changes, bleed/agonies and explicit manual reductions stay native.
 if(options.dialog===true||options._pf1AutomateDamageDialog||options.value<=0||
    options.asWounds===true||options.reduction!==0||options.ratio!==1||
    options.interactive!==true||!options.message||!Array.isArray(options.instances)||!options.instances.length)return;
 if(game.settings.get("pf1","healthConfig")?.getActorConfig?.(actor)?.rules?.useWoundsAndVigor)return;
 DR_SEEN.add(options);
 const raw=options.instances.reduce((a,r)=>a+Number(r?.value),0);
 if(!Number.isSafeInteger(raw)||raw<0)return drBlock(actor,options,drFail("invalid-native-total"));
 const buttonRatio=Number(options.element?.dataset?.ratio);
 const ratio=buttonRatio===0.5||buttonRatio===1?buttonRatio:
  options.value===raw?1:options.value===Math.floor(raw/2)?0.5:null;
 if(ratio==null||Math.floor(raw*ratio)!==options.value)
  return drBlock(actor,options,drFail("native-card-total-mismatch"));
 const result=drPreview({actor,components:options.instances,ratio,...drSource(options),asNonlethal:options.asNonlethal===true});
 if(!result.supported)return drBlock(actor,options,result);
 drRemember(actor,result);
 // Native method applies ratio then reduction. Only pass the final value.
 options.value=result.total;options.ratio=1;options.reduction=0;
 options.pf1aeDamageResolution=result;
}
Hooks.once("init",()=>{
 game.settings.register(DR_NS,DR_SETTING,{scope:"world",config:true,restricted:true,type:Boolean,default:false,
  name:"PF1AE.Settings.AutomaticDamageDefenses.Name",hint:"PF1AE.Settings.AutomaticDamageDefenses.Hint"});
 Hooks.on("pf1ApplyDamage",drOnApply);
});
Hooks.once("ready",()=>{
 const mod=game.modules.get(DR_NS);if(!mod)return;mod.api??={};
 mod.api.damageResolution=Object.freeze({
  isAvailable:drAvailable,preview:drPreview,lastDiagnostic:actor=>DR_LAST.get(typeof actor==="string"?actor:actor?.uuid)??null
 });
 if(game.settings.get(DR_NS,DR_SETTING)&&game.modules.get(DR_AD)?.active)
  globalThis.ui?.notifications?.warn?.(drText("PF1AE : moteur de dégâts suspendu car Automate Damage est actif.","PF1AE: damage engine suspended because Automate Damage is active."));
});
