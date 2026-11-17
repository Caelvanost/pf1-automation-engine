/**
 * PF1AE cover geometry selection (world setting).
 * 2D is the safe default for ordinary PF1 grid battles.
 * 3D is optional; missing/incompatible providers fail closed.
 */
const CM_NS="pf1-automation-engine";
const CM_SETTING="coverGeometryMode";
const CM_SUPPORTED=Object.freeze({levels:"6.1.0","wall-height":"7.0.8",betterroofs:"3.0.0"});
function cmMode(){
 try{return game.settings.get(CM_NS,CM_SETTING)==="3d"?"3d":"2d"}
 catch(_){return "2d"}
}
function cmProviders(){
 const read=id=>{
  const module=game.modules?.get?.(id);
  return {id,active:module?.active===true,version:module?.version??null,
   testedVersion:CM_SUPPORTED[id],
   exactTestedVersion:module?.active===true&&module?.version===CM_SUPPORTED[id]};
 };
 const levels=read("levels"),wallHeight=read("wall-height"),betterRoofs=read("betterroofs");
 return {levels,wallHeight,betterRoofs};
}
function cmInspect(){
 const mode=cmMode(),providers=cmProviders();
 const reasons=[];
 if(mode==="3d"){
  if(!providers.levels.active)reasons.push("levels-inactive");
  if(!providers.wallHeight.active)reasons.push("wall-height-inactive");
  if(providers.levels.active&&!providers.levels.exactTestedVersion)
   reasons.push("levels-version-not-validated");
  if(providers.wallHeight.active&&!providers.wallHeight.exactTestedVersion)
   reasons.push("wall-height-version-not-validated");
  if(providers.betterRoofs.active&&!providers.betterRoofs.exactTestedVersion)
   reasons.push("better-roofs-version-not-validated");
  if(typeof globalThis.CONFIG?.Levels?.API?.testCollision!=="function")
   reasons.push("levels-collision-api-unavailable");
 }
 return {mode,ready:mode==="2d"||reasons.length===0,
  reasons,providers};
}
Hooks.once("init",()=>{
 game.settings.register(CM_NS,CM_SETTING,{
  name:"PF1AE.Settings.CoverGeometryMode.Name",
  hint:"PF1AE.Settings.CoverGeometryMode.Hint",
  scope:"world",config:true,type:String,default:"2d",
  choices:{
   "2d":"PF1AE.Settings.CoverGeometryMode.TwoD",
   "3d":"PF1AE.Settings.CoverGeometryMode.ThreeD"
  },
  requiresReload:false
 });
});
Hooks.once("ready",()=>{
 const mod=game.modules?.get?.(CM_NS);
 if(!mod)return;
 mod.api??={};
 mod.api.coverMode=Object.freeze({get:cmMode,inspect:cmInspect});
});
