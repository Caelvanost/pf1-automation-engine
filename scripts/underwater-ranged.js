/**
 * PF1AE — ranged attacks through water.
 * Pathfinder 1e: non-thrown ranged attacks take -2 per 5 ft / 1.5 m
 * of water crossed, in addition to normal range penalties.
 *
 * Geometry is provided by PF1 — Skull & Shackles waterAutomation API.
 * Foundry 13 / PF1 11.11.
 */
const UW_NS="pf1-automation-engine";
const UW_SETTING="autoUnderwaterRangedPenalty";
const UW_WATER_MODULE="pf1-skull-and-shackles";
const UW_TAG="[PF1AE][UnderwaterRanged]";
const UW_APPLIED=new WeakSet();
let UW_LAST=null;

const uwLog=(message,details={})=>{
  try{if(game.settings.get(UW_NS,"genericDebug"))console.debug(UW_TAG,message,details);}
  catch(_){}
};

const uwEnabled=()=>{
  try{
    return game.modules.get(UW_NS)?.active===true &&
      game.settings.get(UW_NS,"genericEnabled")===true &&
      game.settings.get(UW_NS,UW_SETTING)===true;
  }catch(_){return false;}
};

const uwNormUnit=unit=>{
  const v=String(unit??"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  if(["m","meter","meters","metre","metres"].includes(v))return "m";
  if(["ft","foot","feet","pied","pieds"].includes(v))return "ft";
  return null;
};

const uwStepForUnit=unit=>unit==="m"?1.5:unit==="ft"?5:null;

function uwTargetList(use){
  const raw=use?.shared?.targets??use?.targets;
  if(Array.isArray(raw)&&raw.length)return raw;
  if(raw&&typeof raw[Symbol.iterator]==="function"){
    const values=[...raw];
    if(values.length)return values;
  }
  return [...(game.user?.targets??[])];
}

function uwToken(value){
  if(!value)return null;
  return value?.document??value;
}

function uwSource(use){
  const direct=uwToken(use?.token);
  if(direct?.parent?.id)return direct;
  const actor=use?.actor;
  const active=actor?.getActiveTokens?.()??[];
  return active.length===1?uwToken(active[0]):null;
}

function uwCalculate(distance,unit){
  const step=uwStepForUnit(uwNormUnit(unit));
  if(!Number.isFinite(distance)||distance<=1e-6||!step)return null;
  // "Par case submergée traversée" : toute fraction d'une tranche compte.
  const increments=Math.max(1,Math.ceil(distance/step-1e-9));
  return {increments,step,penalty:-2*increments};
}

function uwMeasure(use){
  const water=game.modules.get(UW_WATER_MODULE);
  const api=water?.active?water.api?.waterAutomation:null;
  if(typeof api?.measureProjectileWaterDistance!=="function")
    return {skipped:"water geometry API unavailable"};

  const targets=uwTargetList(use);
  if(targets.length!==1)return {skipped:"ambiguous targets",targets:targets.length};

  const source=uwSource(use);
  const target=uwToken(targets[0]);
  const scene=globalThis.canvas?.scene;
  if(!source||!target||!scene||
     source.parent?.id!==scene.id||target.parent?.id!==scene.id)
    return {skipped:"tokens not in current scene"};

  let measured;
  try{
    measured=api.measureProjectileWaterDistance({source,target});
  }catch(error){
    console.warn(UW_TAG,"Water path measurement failed",error);
    return {skipped:"water geometry failure"};
  }

  const distance=Number(measured?.distance);
  const unit=uwNormUnit(measured?.unit);
  if(!Number.isFinite(distance)||distance<=1e-6)
    return {skipped:"no submerged path",distance:Math.max(0,distance||0),unit};

  const calc=uwCalculate(distance,unit);
  if(!calc)return {skipped:"unknown water distance units",distance,unit};

  return {
    distance,unit,
    totalDistance:Number(measured?.totalDistance),
    fraction:Number(measured?.fraction),
    touchedRegionIds:Array.isArray(measured?.touchedRegionIds)?measured.touchedRegionIds:[],
    source,target,
    ...calc
  };
}

function uwApply(use){
  if(!uwEnabled())return {skipped:"disabled"};
  const action=use?.action??use?.shared?.action;
  const shared=use?.shared;
  if(!action||!shared||action.hasAttack!==true)
    return {skipped:"not an attack"};

  // PF1 rule: thrown weapons are ineffective underwater. This file only
  // automates the requested distance penalty for non-thrown ranged attacks.
  if(action.actionType==="twak")return {skipped:"thrown weapon rule handled separately"};
  if(!["rwak","rsak"].includes(action.actionType))
    return {skipped:"not a qualifying ranged attack"};

  if(UW_APPLIED.has(use))return {skipped:"already injected"};
  if(!Array.isArray(shared.attackBonus))
    return {skipped:"native attackBonus array unavailable"};

  const result=uwMeasure(use);
  if(result.skipped)return result;

  const key="PF1AE.UnderwaterRanged.Penalty";
  const localized=game.i18n?.localize?.(key);
  const label=localized&&localized!==key?localized:"Underwater shot";
  shared.attackBonus.push(`${result.penalty}[${label}]`);
  UW_APPLIED.add(use);

  uwLog("Pre-roll underwater penalty injected",{
    actor:use?.actor?.name,
    item:use?.item?.name,
    target:result.target?.name,
    distance:result.distance,
    unit:result.unit,
    increments:result.increments,
    penalty:result.penalty,
    fraction:result.fraction
  });

  return {...result,applied:true};
}

Hooks.once("init",()=>{
  game.settings.register(UW_NS,UW_SETTING,{
    name:game.i18n?.localize?.("PF1AE.UnderwaterRanged.SettingsName")??"Automatic underwater ranged penalties",
    hint:game.i18n?.localize?.("PF1AE.UnderwaterRanged.SettingsHint")??"Apply -2 per 5 ft / 1.5 m of water actually crossed.",
    scope:"world",
    config:true,
    restricted:true,
    type:Boolean,
    default:true
  });

  Hooks.on("pf1CreateActionUse",use=>{
    try{
      const result=uwApply(use);
      UW_LAST={
        status:result?.skipped??"applied",
        reason:result?.skipped??null,
        distance:result?.distance??null,
        unit:result?.unit??null,
        increments:result?.increments??null,
        penalty:result?.penalty??null,
        actor:use?.actor?.name??null,
        action:use?.action?.name??null,
        at:Date.now()
      };
    }catch(error){
      UW_LAST={status:"exception",message:String(error?.message??error),at:Date.now()};
      console.warn(UW_TAG,"Underwater ranged automation failed; native attack unchanged",error);
    }
  });
});

Hooks.once("ready",()=>{
  const mod=game.modules.get(UW_NS);
  if(!mod)return;
  mod.api??={};
  mod.api.underwaterRanged=Object.freeze({
    calculate:uwCalculate,
    measureActionUse:uwMeasure,
    lastDiagnostic:()=>UW_LAST?{...UW_LAST}:null
  });
});
