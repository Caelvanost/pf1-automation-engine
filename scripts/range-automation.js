/**
 * PF1AE ranged increment bridge — Foundry 13 / PF1 11.11.
 * Runs before native ActionUse.generateAttacks() at pf1CreateActionUse.
 * Only supplements unconfigured native range options; PF1 performs the roll.
 * No sheet mutation, damage change, or post-roll correction.
 */
const RA_NS='pf1-automation-engine';
const RA_SETTING='autoRangePenalties';
const RA_TAG='[PF1AE][Range]';
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
  if(!Array.isArray(a)||!Array.isArray(b)||!a.length||!b.length||
     typeof grid?.measurePath!=='function')return null;
  let min=Infinity;
  for(const from of a)for(const to of b){
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
  return {factor,penalty:-2*(factor-1),outOfRange:factor>max};
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
  if((Number.isFinite(opts.rangeIncrement)&&opts.rangeIncrement!==1)||
     Number.isFinite(opts.rangeIncrementPenalty)&&opts.rangeIncrementPenalty!==2||
     Number.isFinite(formData.rangePenalty)||
     Number.isFinite(config.rangePenalty)||
     Number.isFinite(config.rangeIncrement)&&config.rangeIncrement!==1)
    return {skipped:'explicit native range modifier'};
  const range=action.range??{};
  const max=Number(range.maxIncrements);
  if(!Number.isSafeInteger(max)||max<=1||!range.units||range.value==null)
    return {skipped:'no range increments'};
  const targets=[...(game.user?.targets??[])];
  if(targets.length!==1)return {skipped:'ambiguous targets',targets:targets.length};
  const origin=use.token?.object??use.token;
  const target=targets[0];
  const scene=canvas?.scene;
  if(!origin||!target||!scene||origin.document?.parent?.id!==scene.id||
     target.document?.parent?.id!==scene.id)return {skipped:'tokens not in current scene'};
  const sceneUnit=raNormUnit(scene.grid?.units);
  // The action's getRange returns PF1 system-distance units, not raw input
  // units. For older actions without getRange, require a numeric raw value
  // and use the declared action unit instead.
  let increment,incrementUnit;
  if(typeof action.getRange==='function'){
    increment=Number(action.getRange({type:'single',rollData:shared.rollData}));
    incrementUnit=globalThis.pf1?.settings?.distance?.metric===true?'m':'ft';
  }else{
    increment=Number(range.value);incrementUnit=raNormUnit(range.units);
  }
  if(!sceneUnit||!incrementUnit||!Number.isFinite(increment)||increment<=0)
    return {skipped:'unknown units or range'};
  const rawDistance=raDistance(origin,target,canvas.grid);
  const distance=raConvert(rawDistance,sceneUnit,incrementUnit);
  if(distance==null)return {skipped:'distance unavailable'};
  const result=raCalculate(distance,increment,max);
  if(!result)return {skipped:'invalid range calculation'};
  const debug={actor:use.actor?.name,item:use.item?.name,target:target.name,
    distance:rawDistance,sceneUnit,increment,incrementUnit,max,...result};
  if(result.outOfRange){
    ui.notifications?.warn?.('PF1AE: cible hors de portée — attaque non modifiée. Vérifiez la cible et la portée.');
    raLog('Out of range; native workflow unchanged',debug);
    return {...result,skipped:'out of range'};
  }
  // A single explicit native increment is supplied before the dialog and
  // before roll evaluation. PF1's applyConfig owns the attack bonus.
  if(result.factor>1){
    config.rangeIncrement=result.factor;
    config.rangeIncrementPenalty=2;
    // PF1's native dialog may provide a manual rangePenalty; leave its
    // semantics intact. No attackBonus string is injected here.
  }
  raLog('Native range increment configured',debug);
  return {...result,applied:result.factor>1};
}
Hooks.once('init',()=>{
  game.settings.register(RA_NS,RA_SETTING,{
    name:'Calcul automatique des pénalités de portée',
    hint:'Applique le facteur de portée au jet natif PF1 des attaques à distance avec une seule cible. Ignoré si le jet possède déjà un modificateur natif explicite. Requiert une grille en mètres ou pieds.',
    scope:'world',config:true,restricted:true,type:Boolean,default:false
  });
  Hooks.on('pf1CreateActionUse',use=>{
    try{return raApply(use);}
    catch(error){console.warn(RA_TAG,'Native range pre-roll failed; no change',error);}
  });
});
Hooks.once('ready',()=>{
  const mod=game.modules.get(RA_NS);
  if(!mod)return;
  mod.api??={};
  mod.api.range=Object.freeze({calculate:raCalculate,convert:raConvert,measure:raDistance});
});
