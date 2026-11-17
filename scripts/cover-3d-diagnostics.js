/**
 * PF1AE — optional 3D cover-trajectory diagnostics (read-only).
 *
 * Supported inspected installations: Wall Height 7.0.8,
 * Levels 6.1.0, Better Roofs 3.0.0 on Foundry VTT 13 / PF1 11.11.
 *
 * This deliberately DOES NOT determine a PF1 cover bonus. Levels'
 * collision check concerns geometry and may represent movement rather
 * than ballistic line of effect. The origin heights and PF1 corner-ray
 * choices require further validation. Never feed this result directly
 * to attackResolution, coverSaves, or actor statistics.
 */
const C3_NS="pf1-automation-engine";
const C3_SUPPORTED=Object.freeze({
 "wall-height":"7.0.8",levels:"6.1.0",betterroofs:"3.0.0"
});
const C3_MAX_RAYS=64;
let C3_LAST=null;
const c3Doc=x=>x?.document??x;
const c3Finite=n=>typeof n==="number"&&Number.isFinite(n);
const c3Clone=x=>foundry.utils.deepClone(x);
const c3Module=id=>game.modules?.get?.(id);
const c3Compatible=id=>{
 const module=c3Module(id);
 return {id,active:module?.active===true,
  installedVersion:String(module?.version??"unknown"),
  testedVersion:C3_SUPPORTED[id],
  exactVersion:module?.active===true&&module?.version===C3_SUPPORTED[id]};
};
const c3Modules=()=>Object.keys(C3_SUPPORTED).map(c3Compatible);
const c3Collection=collection=>{
 if(!collection)return null;
 if(Array.isArray(collection))return collection;
 if(Array.isArray(collection.contents))return collection.contents;
 return typeof collection.values==="function"?[...collection.values()]:null;
};
function c3Result(status,reason,data={}){
 const result={status,reason,authoritative:false,
  coverType:null,acBonus:null,reflexBonus:null,
  modules:c3Modules(),...data};
 C3_LAST=c3Clone(result);
 return c3Clone(result);
}
function c3Bounds(token,scene,grid){
 const d=c3Doc(token);
 const size=grid?.size;
 if(!d||!c3Finite(d.x)||!c3Finite(d.y)||
    !c3Finite(size)||size<=0||
    !c3Finite(d.width)||d.width<=0||
    !c3Finite(d.height)||d.height<=0)return null;
 if(d.parent?.id!==scene.id)return null;
 return {id:d.uuid??d.id,
  x:d.x,y:d.y,width:d.width*size,height:d.height*size,
  elevation:c3Finite(d.elevation)?d.elevation:null};
}
function c3TokenHeight(token){
 const d=c3Doc(token);
 if(!c3Finite(d?.elevation))return null;
 // Wall Height adds losHeight to canvas Token placeables. This is a
 // *sight* height and an approximation of projectile launch height.
 const sight=token?.losHeight;
 if(c3Finite(sight)&&sight>=d.elevation)
  return {bottom:d.elevation,top:sight,source:"token.losHeight"};
 // No guessing a creature's actual physical height from its width.
 return {bottom:d.elevation,top:null,source:"unknown-token-height"};
}
function c3Corners(b){
 const inset=Math.min(0.01,Math.min(b.width,b.height)*0.0001);
 return [
  {x:b.x+inset,y:b.y+inset},
  {x:b.x+b.width-inset,y:b.y+inset},
  {x:b.x+b.width-inset,y:b.y+b.height-inset},
  {x:b.x+inset,y:b.y+b.height-inset}
 ];
}
function c3WallSummary(walls){
 return walls.map(w=>{
  const d=c3Doc(w);
  const raw=d?.flags?.["wall-height"];
  const bottom=raw?.bottom??-Infinity;
  const top=raw?.top??Infinity;
  const bounds=(typeof bottom==="number"&&typeof top==="number")?
    {bottom,top,known:bottom<=top}:null;
  return {id:d?.uuid??d?.id??null,
   bounds,door:d?.door??null,doorState:d?.ds??null,
   moveRestriction:d?.move??null,
   source:raw?"flags.wall-height":"unbounded-or-unconfigured"};
 });
}
function c3RoofSummary(tiles){
 return tiles.filter(tile=>{
  const d=c3Doc(tile);
  return d?.overhead===true||
    d?.flags?.betterroofs?.brMode||
    d?.flags?.levels?.blockSightMovement||
    d?.flags?.levels?.noCollision===true;
 }).map(tile=>{
  const d=c3Doc(tile);
  return {id:d?.uuid??d?.id??null,elevation:d?.elevation??null,
   rangeTop:d?.flags?.levels?.rangeTop??null,
   noCollision:d?.flags?.levels?.noCollision===true,
   blockingFlag:d?.flags?.levels?.blockSightMovement===true,
   betterRoofsMode:d?.flags?.betterroofs?.brMode??null,
   overhead:d?.overhead===true};
 });
}
function c3LevelsCollision(start,end){
 const levels=globalThis.CONFIG?.Levels;
 const fn=levels?.API?.testCollision;
 if(typeof fn!=="function")
  return {state:"unavailable",reason:"levels-collision-api-missing"};
 try{
  const collision=fn.call(levels.API,start,end,"collision");
  if(collision===false||collision===null)
   return {state:"clear",reason:"levels-reported-no-collision"};
  if(collision===true)
   return {state:"unknown",reason:"levels-returned-boolean-collision"};
  if(collision&&c3Finite(collision.x)&&
    c3Finite(collision.y)&&c3Finite(collision.z))
   return {state:"collision",point:{
    x:collision.x,y:collision.y,z:collision.z
   },reason:"levels-reported-3d-intersection"};
  return {state:"unknown",reason:"unexpected-levels-collision-response"};
 }catch(error){
  return {state:"error",reason:String(error?.message??error).slice(0,180)};
 }
}
function c3Inspect({attacker,target,scene,rayLimit=C3_MAX_RAYS}={}){
 const current=globalThis.canvas?.scene;
 const s=scene??current;
 const grid=globalThis.canvas?.grid;
 if(!s||s.id!==current?.id)return c3Result("impossible","scene-not-current");
 if(s.grid?.type!==1&&s.grid?.type!=="square")
  return c3Result("impossible","square-grid-required");
 if(!Number.isSafeInteger(rayLimit)||rayLimit<1||rayLimit>C3_MAX_RAYS)
  return c3Result("impossible","invalid-ray-limit");
 const a=c3Bounds(attacker,s,grid),b=c3Bounds(target,s,grid);
 if(!a||!b)return c3Result("impossible","invalid-token-space");
 const at=c3TokenHeight(attacker),bt=c3TokenHeight(target);
 if(!at||!bt)return c3Result("impossible","token-elevation-unavailable");
 const walls=c3Collection(s.walls);
 const tiles=c3Collection(s.tiles);
 const regions=c3Collection(s.regions);
 if(!walls||!tiles||!regions)
  return c3Result("unavailable","scene-geometry-collections-unavailable");
 const diagnostics={
  attacker:{...a,height:at},
  target:{...b,height:bt},
  walls:c3WallSummary(walls),tiles:c3RoofSummary(tiles),
  regions:regions.length,
  rays:[],warnings:[]
 };
 const moduleSet=c3Modules();
 const activeLevels=moduleSet.find(x=>x.id==="levels");
 const activeWall=moduleSet.find(x=>x.id==="wall-height");
 const activeRoof=moduleSet.find(x=>x.id==="betterroofs");
 if(!activeLevels.active)diagnostics.warnings.push("levels-module-inactive");
 if(activeLevels.active&&!activeLevels.exactVersion)
  diagnostics.warnings.push("untested-levels-version");
 if(activeWall.active&&!activeWall.exactVersion)
  diagnostics.warnings.push("untested-wall-height-version");
 if(activeRoof.active&&!activeRoof.exactVersion)
  diagnostics.warnings.push("untested-better-roofs-version");
 if(!activeWall.active&&walls.length)
  diagnostics.warnings.push("wall-height-inactive-wall-vertical-extent-unknown");
 if(!activeRoof.active&&diagnostics.tiles.some(t=>t.betterRoofsMode))
  diagnostics.warnings.push("better-roofs-flags-without-module");
 if(at.top===null||bt.top===null)
  diagnostics.warnings.push("physical-token-height-unverified");
 if(regions.length)diagnostics.warnings.push("region-physics-not-classified");
 if(diagnostics.tiles.some(t=>t.betterRoofsMode))
  diagnostics.warnings.push("roof-occlusion-is-not-proof-of-solid-cover");
 if(diagnostics.tiles.some(t=>t.noCollision))
  diagnostics.warnings.push("some-tiles-exempt-from-levels-collision");
 if(globalThis.game?.Levels3DPreview?._active)
  diagnostics.warnings.push("levels-3d-preview-active");
 const startCorners=c3Corners(a),endCorners=c3Corners(b);
 // Each corner is sampled at its token's known LOS height when available.
 // This is a diagnostic sample, NOT a full PF1 3D corner-ray volume.
 for(let i=0;i<startCorners.length;i++){
  for(let j=0;j<endCorners.length;j++){
   if(diagnostics.rays.length>=rayLimit)break;
   const start={...startCorners[i],z:at.top??at.bottom};
   const end={...endCorners[j],z:bt.top??bt.bottom};
   const check=activeLevels.active?
    c3LevelsCollision(start,end):
    {state:"unavailable",reason:"levels-module-inactive"};
   diagnostics.rays.push({originCorner:i,targetCorner:j,
    from:start,to:end,...check});
  }
 }
 diagnostics.counts={
  clear:diagnostics.rays.filter(r=>r.state==="clear").length,
  collision:diagnostics.rays.filter(r=>r.state==="collision").length,
  unknown:diagnostics.rays.filter(r=>!["clear","collision"].includes(r.state)).length
 };
 // These are *diagnostics*, never a validated PF1 cover category.
 const status=diagnostics.counts.unknown?
  "uncertain":diagnostics.counts.collision?"collision-detected":"sampled-clear";
 return c3Result(status,
  "diagnostic-only-native-geometry-not-pf1-cover-adjudication",diagnostics);
}
Hooks.once("ready",()=>{
 const module=game.modules.get(C3_NS);
 if(!module)return;
 module.api??={};
 module.api.cover3D=Object.freeze({
  inspect:options=>c3Inspect(options),
  integrations:()=>c3Modules(),
  lastDiagnostic:()=>C3_LAST?c3Clone(C3_LAST):null
 });
});
