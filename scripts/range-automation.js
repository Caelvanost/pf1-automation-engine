/**
 * PF1AE ranged increment bridge — Foundry 13 / PF1 11.11.
 * Runs before native ActionUse.generateAttacks() at pf1CreateActionUse.
 * Only supplements unconfigured native range options; PF1 performs the roll.
 * No sheet mutation, damage change, or post-roll correction.
 */
const RA_NS='pf1-automation-engine';
const RA_SETTING='autoRangePenalties';
const RA_TAG='[PF1AE][Range]';
let raLastDiagnostic=null;
const RA_APPLIED=new WeakSet();
const raReport=(status,details={})=>{
  raLastDiagnostic={status,...details};
  raLog(status,details);
  return raLastDiagnostic;
};
const raLog=(message,details={})=>{
  try{if(game.settings.get(RA_NS,'genericDebug'))console.debug(RA_TAG,message,details);}
  catch(_){}
};
const raNormUnit=unit=>{
  const v=String(unit??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(['m','meter','meters','metre','metres'].includes(v))return 'm';
  if(['ft','foot','feet','pied','pieds'].includes(v))return 'ft';
  return null;
};
// Table convention: five feet = one 1.5m square (not SI feet conversion).
const raConvert=(value,from,to)=>{
  if(!Number.isFinite(value)||value<0||!from||!to)return null;
  return from===to?value:from==='ft'&&to==='m'?value*0.3:
    from==='m'&&to==='ft'?value/0.3:null;
};
const raEnabled=()=>game.modules.get(RA_NS)?.active===true &&
  game.settings.get(RA_NS,'genericEnabled')===true &&
  game.settings.get(RA_NS,RA_SETTING)===true;
const raScriptSkip=shared=>{
  const flags=[shared?.useOptions,shared?.config,shared?.formData];
  return flags.some(x=>x?.skipRangeIncrementChecks===true||
    x?.skipRangedIncrementChecks===true||x?.skipRangeIncrements===true);
};
const raOccupied=token=>{
  try{return token?.getOccupiedCells?.()??token?.object?.getOccupiedCells?.()??null;}
  catch(_){return null;}
};
function raDistance(token,target,grid){
  const a=raOccupied(token),b=raOccupied(target);
  const sources=Array.isArray(a)?a:(a&&typeof a[Symbol.iterator]==='function'?[...a]:[]);
  const targets=Array.isArray(b)?b:(b&&typeof b[Symbol.iterator]==='function'?[...b]:[]);
  if(!sources.length||!targets.length||typeof grid?.measurePath!=='function')return null;
  let min=Infinity;
  for(const from of sources)for(const to of targets){
    const dist=Number(grid.measurePath([from,to])?.distance);
    if(Number.isFinite(dist)&&dist>=0)min=Math.min(min,dist);
  }
  return Number.isFinite(min)?min:null;
}
function raCalculate(distance,increment,max){
  if(![distance,increment,max].every(Number.isFinite)||
     distance<0||increment<=0||!Number.isInteger(max)||max<1)return null;
  // Avoid floating-point spill-over at exact increment boundaries.
  const factor=Math.max(1,Math.ceil(distance/increment-1e-9));
  return {factor,penalty:factor===1?0:-2*(factor-1),outOfRange:factor>max};
}
function raApply(use){
  if(!raEnabled())return {skipped:'disabled'};
  const action=use?.action??use?.shared?.action;
  const shared=use?.shared;
  if(!action||!shared||!['rwak','twak'].includes(action.actionType)||
     action.isRanged!==true||action.hasAttack!==true)return {skipped:'not a ranged weapon attack'};
  if(raScriptSkip(shared))return {skipped:'skip increment checks'};
  const config=shared.config??{},formData=shared.formData??{},opts=shared.useOptions??{};
  // Native overrides and manual penalties always win; never stack a second modifier.
  // PF1 may initialise a zero rangePenalty in the native dialog data.
  // Zero is NOT a manually applied penalty and must not disable automation.
  // Preserve nonzero manual penalties, explicit increments and custom costs.
  if((Number.isFinite(opts.rangeIncrement)&&opts.rangeIncrement!==1)||
     (Number.isFinite(opts.rangeIncrementPenalty)&&opts.rangeIncrementPenalty!==2)||
     (Number.isFinite(formData.rangePenalty)&&formData.rangePenalty!==0)||
     (Number.isFinite(config.rangePenalty)&&config.rangePenalty!==0)||
     (Number.isFinite(config.rangeIncrement)&&config.rangeIncrement!==1))
    return {skipped:'explicit native range modifier'};
  const range=action.range??{};
  const max=Number(range.maxIncrements);
  if(!Number.isSafeInteger(max)||max<=1||!range.units||range.value==null)
    return {skipped:'no range increments'};
  const targets=[...(game.user?.targets??[])];
  if(targets.length!==1)return {skipped:'ambiguous targets',targets:targets.length};
  const origin=use.token?.object??use.token;
  const target=targets[0];
  const scene=globalThis.canvas?.scene;
  // ActionUse.token may be a TokenDocument (rather than its canvas Token);
  // Foundry canvas targets are Token objects. Accept either representation,
  // but never measure between different scenes.
  const tokenScene=token=>(token?.document??token)?.parent?.id ?? token?.scene?.id ?? null;
  if(!origin||!target||!scene||
     (tokenScene(origin)&&tokenScene(origin)!==scene.id)||
     (tokenScene(target)&&tokenScene(target)!==scene.id))
    return {skipped:'tokens not in current scene'};
  const sceneUnit=raNormUnit(scene.grid?.units);
  // Numeric action ranges already carry their own units. Read the source
  // units directly: action.getRange() may return an unexpected transformed
  // value under mixed metric/imperial PF1 settings. In particular, 20 ft
  // must always mean 6 m with this table's 5 ft = 1.5 m convention.
  // Only formula-valued ranges need PF1's getRange() evaluation.
  let increment,incrementUnit,rangeSource;
  const explicitUnit=raNormUnit(range.units);
  const numeric=typeof range.value==='number'||
    (typeof range.value==='string'&&/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(range.value.trim()));
  if(numeric&&explicitUnit){
    increment=Number(range.value);incrementUnit=explicitUnit;
    rangeSource='action.range.value';
  }else if(typeof action.getRange==='function'&&explicitUnit){
    increment=Number(action.getRange({type:'single',rollData:shared.rollData}));
    // PF1's getter returns values in system units for formula ranges.
    incrementUnit=globalThis.pf1?.settings?.distance?.metric===true?'m':'ft';
    rangeSource='action.getRange';
  }else{
    return {skipped:'unsupported action range units'};
  }
  if(!sceneUnit||!incrementUnit||!Number.isFinite(increment)||increment<=0)
    return {skipped:'unknown units or range'};
  const rawDistance=raDistance(origin,target,canvas.grid);
  const distance=raConvert(rawDistance,sceneUnit,incrementUnit);
  if(distance==null)return {skipped:'distance unavailable'};
  const result=raCalculate(distance,increment,max);
  if(!result)return {skipped:'invalid range calculation'};
  const debug={actor:use.actor?.name,item:use.item?.name,target:target.name,
    distance:rawDistance,sceneUnit,distanceInIncrementUnits:distance,
    increment,incrementUnit,rangeSource,max,...result};
  if(result.outOfRange){
    ui.notifications?.warn?.(game.i18n?.localize?.('PF1AE.Range.OutOfRange')??'PF1AE: Target out of range; attack unchanged.');
    raLog('Out of range; native workflow unchanged',debug);
    return {...result,skipped:'out of range'};
  }
  // PF1 ActionDialog may overwrite formData/config after this hook; the
  // stable pre-roll extension point is shared.attackBonus. ActionUse.addAttacks()
  // forwards it into ChatAttack.addAttack(extraParts), BEFORE dice evaluation.
  // Never also change rangeIncrement/rangePenalty: that would double-charge.
  if(RA_APPLIED.has(use))return {...result,skipped:'already injected',applied:false};
  if(result.factor>1){
    if(!Array.isArray(shared.attackBonus))
      return {skipped:'native attackBonus array unavailable'};
    // The native form's default increment stays 1. A GM-entered manual
    // range penalty can override only the native form; this module applies
    // its own checked distance once. Users should not enter another manual
    // range penalty for the same target.
    const label=game.i18n?.localize?.('PF1AE.Range.Penalty')??'Range penalty';
    shared.attackBonus.push(`-${-result.penalty}[${label}]`);
    RA_APPLIED.add(use);
  }
  raLog('Pre-roll range attack bonus injected',debug);
  return {...result,sceneDistance:rawDistance,sceneUnit,increment,incrementUnit,rangeSource,applied:result.factor>1};
}
Hooks.once('init',()=>{
  game.settings.register(RA_NS,RA_SETTING,{
    name:game.i18n?.localize?.('PF1AE.Settings.AutoRange.Name')??'Automatic ranged increment penalties',
    hint:game.i18n?.localize?.('PF1AE.Settings.AutoRange.Hint')??'Apply ranged increments to native PF1 attacks against one target.',
    scope:'world',config:true,restricted:true,type:Boolean,default:false
  });
  Hooks.on('pf1CreateActionUse',use=>{
    try{
      const result=raApply(use);
      raReport(result?.skipped??'configured',{
        reason:result?.skipped??null,
        factor:result?.factor??null,
        penalty:result?.penalty??null,
        sceneDistance:result?.sceneDistance??null,
        action:use?.action?.name??null,
        actor:use?.actor?.name??null,
        targets:game.user?.targets?.size??null
      });
    }catch(error){
      raReport('exception',{message:error.message});
      console.warn(RA_TAG,'Native range pre-roll failed; no change',error);
    }
  });
});
Hooks.once('ready',()=>{
  const mod=game.modules.get(RA_NS);
  if(!mod)return;
  mod.api??={};
  mod.api.range=Object.freeze({
    calculate:raCalculate,convert:raConvert,measure:raDistance,
    lastDiagnostic:()=>raLastDiagnostic?{...raLastDiagnostic}:null
  });
});
