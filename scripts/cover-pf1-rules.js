/**
 * PF1AE — PF1e square-grid cover interpretation.
 *
 * PHASE 1: read-only, conservative adjudication for unambiguous flat,
 * same-elevation 1×1 token spaces, native wall segments and interposed
 * creatures. No feat/class logic, no attacks, no saving throws or writes.
 *
 * Ranged/reach: for EACH choice of attacker-space corner, test all four
 * target-space corners. Use the best available origin for the attacker;
 * endpoint-grazing rays without strict blockers count as a clear angle.
 * Unknown wall or 3D collisions are never optimistically dismissed.
 * Adjacent melee: all four attacker corners matter; creature interposition
 * does NOT confer soft cover for adjacent melee.
 *
 * Wall height and Levels 3D are never inferred from 2D alone; supported
 * obstacles must have known 3D extents or be unbounded. Unknown surfaces
 * and other atypical geometry return "uncertain", never a numeric bonus.
 */
const CP_NS="pf1-automation-engine";
const CP_EPS=1e-7;
let CP_LAST=null;
const cpDoc=t=>t?.document??t;
const cpFinite=n=>typeof n==="number"&&Number.isFinite(n);
const cpClone=x=>foundry.utils.deepClone(x);
const cpCollection=x=>Array.isArray(x)?x:
 Array.isArray(x?.contents)?x.contents:
 typeof x?.values==="function"?[...x.values()]:null;
const cpAllowedAttack=new Set(["ranged","melee","reach"]);
function cpResult(status,reason,extra={}){
 const type=status==="confirmed"?extra.type??null:null;
 const bonus=type==="normal"||type==="soft"?4:type==="none"?0:null;
 const configuredMode=game.modules?.get?.(CP_NS)?.api?.coverMode?.get?.()??"2d";
 const result={status,reason,type,acBonus:bonus,
  reflexBonus:type==="normal"?2:type==="none"||type==="soft"?0:null,
  authoritative:status==="confirmed",
  preventsDirectAttack:status==="confirmed"&&type==="total",
  mode:configuredMode,source:"pf1-corner-rays",...extra};
 if(status!=="confirmed"){
  result.type=null;result.acBonus=null;result.reflexBonus=null;
  result.authoritative=false;
 }
 CP_LAST=cpClone(result);
 return cpClone(result);
}
function cpSpace(token,scene,size){
 const d=cpDoc(token);
 if(!d||d.parent?.id!==scene.id||!cpFinite(size)||size<=0||
  !cpFinite(d.x)||!cpFinite(d.y)||!cpFinite(d.elevation)||
  !cpFinite(d.width)||!cpFinite(d.height)||
  !Number.isInteger(d.width)||!Number.isInteger(d.height)||
  d.width<1||d.height<1||d.width>8||d.height>8)
  return null;
 return {id:d.uuid??d.id,x:d.x,y:d.y,
  x2:d.x+size*d.width,y2:d.y+size*d.height,
  width:d.width,height:d.height,size,elevation:d.elevation};
}
function cpCorners(s){
 // Outer corners of the target's entire occupied PF1 space.
 return [{x:s.x,y:s.y},{x:s.x2,y:s.y},
  {x:s.x2,y:s.y2},{x:s.x,y:s.y2}];
}
function cpOriginCorners(s){
 // PF1: a Large or larger attacker may choose a corner of ANY square
 // it occupies. Unique grid intersections, including internal vertices.
 const list=[];
 for(let row=0;row<=s.height;row++)
  for(let col=0;col<=s.width;col++)
   list.push({x:s.x+col*s.size,y:s.y+row*s.size,
    gridCol:col,gridRow:row});
 return list;
}
function cpOrientation(a,b,c){
 return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
}
function cpSegment(a,b,c,d){
 // Strict proper crossings prove wall/creature interposition. Touching,
 // collinearity, corner hits and zero-length lines are ambiguous.
 const ab1=cpOrientation(a,b,c),ab2=cpOrientation(a,b,d);
 const cd1=cpOrientation(c,d,a),cd2=cpOrientation(c,d,b);
 const near=n=>Math.abs(n)<=CP_EPS;
 const touch=near(ab1)||near(ab2)||near(cd1)||near(cd2);
 if(touch){
  const overlap=(u,v,w)=>w>=Math.min(u,v)-CP_EPS&&w<=Math.max(u,v)+CP_EPS;
  const on=(p,q,r)=>near(cpOrientation(p,q,r))&&
   overlap(p.x,q.x,r.x)&&overlap(p.y,q.y,r.y);
  return (on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))?
   "ambiguous":"clear";
 }
 return ab1*ab2<0&&cd1*cd2<0?"cross":"clear";
}
function cpInside(point,rect){
 return point.x>rect.x+CP_EPS&&point.x<rect.x2-CP_EPS&&
  point.y>rect.y+CP_EPS&&point.y<rect.y2-CP_EPS;
}
function cpTokenCross(a,b,rect){
 if(cpInside(a,rect)||cpInside(b,rect))return "ambiguous";
 const corners=cpCorners(rect);
 let crosses=0,ambiguous=false;
 for(let i=0;i<4;i++){
  const val=cpSegment(a,b,corners[i],corners[(i+1)%4]);
  if(val==="ambiguous")ambiguous=true;
  else if(val==="cross")crosses++;
 }
 if(ambiguous)return "ambiguous";
 return crosses>=2?"cross":"clear";
}
function cpWallData(wall,height,mode){
 const d=cpDoc(wall);
 const coords=d?.c;
 if(!Array.isArray(coords)||coords.length!==4||
  !coords.every(cpFinite))return {kind:"unknown",reason:"wall-coordinates"};
 if(d.door!==undefined&&d.door!==0){
  if(d.ds===1)return {kind:"open",reason:"door-open"};
  if(d.ds!==0&&d.ds!==2)return {kind:"unknown",reason:"door-state"};
 }
 // Foundry v13 uses WALL_MOVEMENT_TYPES.NORMAL=20 (not 1).
 // Read the runtime constants instead of accepting obsolete numeric fixtures.
 // A passable wall may still block projectiles; keep that case uncertain.
 const movement=globalThis.CONST?.WALL_MOVEMENT_TYPES;
 if(!movement||!cpFinite(movement.NONE)||!cpFinite(movement.NORMAL))
  return {kind:"unknown",reason:"wall-movement-constants-unavailable"};
 if(d.move===movement.NONE)
  return {kind:"unknown",reason:"movement-passable-wall"};
 if(d.move!==movement.NORMAL)
  return {kind:"unknown",reason:"wall-movement-restriction"};
 if(mode==="2d")return {kind:"solid",
  a:{x:coords[0],y:coords[1]},b:{x:coords[2],y:coords[3]},
  id:d.uuid??d.id};
 const bounds=d.flags?.["wall-height"];
 const bottom=bounds?.bottom??-Infinity;
 const top=bounds?.top??Infinity;
 if(typeof bottom!=="number"||typeof top!=="number"||
  Number.isNaN(bottom)||Number.isNaN(top)||bottom>top)
  return {kind:"unknown",reason:"wall-vertical-bounds"};
 if(height===null)return {kind:"unknown",reason:"projectile-height-unverified"};
 if(height<bottom-CP_EPS||height>top+CP_EPS)
  return {kind:"open",reason:"above-or-below-wall"};
 if(Math.abs(height-bottom)<CP_EPS||Math.abs(height-top)<CP_EPS)
  return {kind:"unknown",reason:"wall-height-boundary"};
 return {kind:"solid",a:{x:coords[0],y:coords[1]},
  b:{x:coords[2],y:coords[3]},id:d.uuid??d.id};
}

function cpSlopedWall(from,to,wall,startHeight,endHeight){
 const d=cpDoc(wall),coords=d?.c;
 if(!Array.isArray(coords)||coords.length!==4||!coords.every(cpFinite))
  return {kind:"unknown",reason:"wall-coordinates"};
 const a={x:coords[0],y:coords[1]},b={x:coords[2],y:coords[3]};
 const crossing=cpSegment(from,to,a,b);
 if(crossing==="clear")return {kind:"clear"};
 if(crossing==="ambiguous")return {kind:"unknown",reason:"wall-grazed"};
 const dx=to.x-from.x,dy=to.y-from.y;
 const wx=b.x-a.x,wy=b.y-a.y;
 const denom=dx*wy-dy*wx;
 if(Math.abs(denom)<=CP_EPS)return {kind:"unknown",reason:"sloped-wall-parallel"};
 const fraction=((a.x-from.x)*wy-(a.y-from.y)*wx)/denom;
 if(!cpFinite(fraction)||fraction<=0||fraction>=1)
  return {kind:"unknown",reason:"sloped-wall-parameter"};
 const height=startHeight+(endHeight-startHeight)*fraction;
 const bottom=d.flags?.["wall-height"]?.bottom??-Infinity;
 const top=d.flags?.["wall-height"]?.top??Infinity;
 if(typeof bottom!=="number"||typeof top!=="number"||
    Number.isNaN(bottom)||Number.isNaN(top)||bottom>top)
  return {kind:"unknown",reason:"wall-vertical-bounds"};
 if(height<bottom-CP_EPS||height>top+CP_EPS)return {kind:"clear"};
 if(Math.abs(height-bottom)<=CP_EPS||Math.abs(height-top)<=CP_EPS)
  return {kind:"unknown",reason:"wall-height-boundary"};
 return {kind:"solid"};
}
function cpInterpret({attacker,target,attackType="ranged",scene,
 tokens,projectileHeight=null,mode}={}){
 const configured=game.modules?.get?.(CP_NS)?.api?.coverMode;
 const selectedMode=mode??configured?.get?.()??"2d";
 if(selectedMode!=="2d"&&selectedMode!=="3d")
  return cpResult("uncertain","invalid-cover-geometry-mode",{mode:selectedMode});
 if(selectedMode==="3d"){
  const status=configured?.inspect?.();
  if(!status?.ready)return cpResult("uncertain",
   "3d-integration-unavailable",{mode:selectedMode,
    providerReasons:status?.reasons??["cover-mode-api-missing"]});
 }
 const s=scene??globalThis.canvas?.scene;
 const grid=globalThis.canvas?.grid;
 if(!s||s.id!==globalThis.canvas?.scene?.id)
  return cpResult("uncertain","scene-unavailable");
 if(s.grid?.type!==1&&s.grid?.type!=="square")
  return cpResult("uncertain","square-grid-required");
 if(!cpAllowedAttack.has(attackType))
  return cpResult("uncertain","attack-type-unavailable");
 const a=cpSpace(attacker,s,grid?.size),t=cpSpace(target,s,grid?.size);
 if(!a||!t)return cpResult("uncertain","multi-square-or-invalid-token-space");
 const multilevel=selectedMode==="3d"&&a.elevation!==t.elevation;
 const levelsApi=globalThis.CONFIG?.Levels?.API;
 const levelsActive=game.modules?.get?.("levels")?.active===true;
 if(multilevel&&(!levelsActive||typeof levelsApi?.testCollision!=="function"))
  return cpResult("uncertain","multilevel-levels-api-required");
 const sourceHeight=selectedMode==="2d"?null:
  cpFinite(projectileHeight)?projectileHeight:
  cpFinite(attacker?.losHeight)?attacker.losHeight:null;
 const targetHeight=selectedMode==="2d"?null:
  cpFinite(projectileHeight)?projectileHeight:
  cpFinite(target?.losHeight)?target.losHeight:null;
 if(selectedMode==="3d"&&(sourceHeight===null||targetHeight===null))
  return cpResult("uncertain","projectile-height-unverified",{mode:selectedMode});
 // Tokens on equal ground elevation may have different LOS eye heights.
 // Evaluate the sloping projectile ray at each wall intersection instead.
 const sloped=selectedMode==="3d"&&sourceHeight!==targetHeight;
 const walls=cpCollection(s.walls),tiles=cpCollection(s.tiles);
 const regions=cpCollection(s.regions);
 const all=tokens??globalThis.canvas?.tokens?.placeables;
 if(!walls||!tiles||!regions||!Array.isArray(all))
  return cpResult("uncertain","scene-collections-unavailable");
 if(selectedMode==="3d"&&tiles.some(tile=>{
  const d=cpDoc(tile);
  return d?.overhead||d?.flags?.levels?.blockSightMovement||
    d?.flags?.betterroofs?.brMode||d?.flags?.levels?.rangeTop!=null;
 }))return cpResult("uncertain","roof-or-floor-line-of-effect-unverified");
 if(selectedMode==="3d"&&regions.length)
  return cpResult("uncertain","region-collision-unverified",{mode:selectedMode});
 const blockingWalls=[];
 const ambiguousWalls=[];
 const slopedWalls=[];
 for(const wall of walls){
  const value=cpWallData(wall,sourceHeight,sloped?"2d":selectedMode);
  if(sloped&&value.kind==="solid")slopedWalls.push(wall);
  else if(value.kind==="solid")blockingWalls.push(value);
  else if(value.kind==="unknown")ambiguousWalls.push({
   ...value,id:cpDoc(wall)?.uuid??cpDoc(wall)?.id
  });
 }
 const blockers=[];
 if(attackType!=="melee"){
  for(const other of all){
   const d=cpDoc(other);
   if(!d||d.id===cpDoc(attacker)?.id||d.id===cpDoc(target)?.id||
       d.parent?.id!==s.id)continue;
   if(selectedMode==="3d"&&d.elevation!==a.elevation)
    return cpResult("uncertain","intervening-creature-height-unverified",
     {mode:selectedMode});
   const rect=cpSpace(other,s,grid.size);
   if(!rect)return cpResult("uncertain","intervening-large-creature-unverified");
   blockers.push(rect);
  }
 }
 const dx=Math.max(a.x-t.x,t.x-a.x2,0);
 const dy=Math.max(a.y-t.y,t.y-a.y2,0);
 const adjacent=dx<=CP_EPS&&dy<=CP_EPS;
 const method=attackType==="melee"&&adjacent?"adjacent-melee":"ranged-or-reach";
 if(method==="adjacent-melee"&&
  (a.width>1||a.height>1||t.width>1||t.height>1)&&
  walls.length>0)
  return cpResult("uncertain","large-creature-adjacent-melee-square-selection");
 const cornerResults=[];
 const as=cpOriginCorners(a),ts=cpCorners(t);
 for(let i=0;i<as.length;i++){
  const traces=[];
  for(let j=0;j<4;j++){
   const from=as[i],to=ts[j];
   const crossed=[];
   let nativeSurfaceState="not-requested";
   if(multilevel){
    try{
     const native=levelsApi.testCollision(
      {x:from.x,y:from.y,z:sourceHeight},
      {x:to.x,y:to.y,z:targetHeight},"collision");
     if(native===false||native===null)nativeSurfaceState="clear";
     else if(native===true||
       (native&&Number.isFinite(native.x)&&
        Number.isFinite(native.y)&&Number.isFinite(native.z)))
      nativeSurfaceState="collision";
     else nativeSurfaceState="unknown";
    }catch(_){nativeSurfaceState="unknown"}
   }
   const uncertainty=[];
   if(nativeSurfaceState==="collision")uncertainty.push("levels-3d-collision");
   if(nativeSurfaceState==="unknown")uncertainty.push("levels-collision-unknown");
   for(const w of blockingWalls){
    const cross=cpSegment(from,to,w.a,w.b);
    if(cross==="cross")crossed.push({kind:"solid",id:w.id});
    else if(cross==="ambiguous")uncertainty.push("wall-grazed:"+w.id);
   }
   for(const w of slopedWalls){
    const result=cpSlopedWall(from,to,w,sourceHeight,targetHeight);
    const id=cpDoc(w)?.uuid??cpDoc(w)?.id;
    if(result.kind==="solid")crossed.push({kind:"solid",id});
    else if(result.kind==="unknown")uncertainty.push(result.reason+":"+id);
   }
   for(const w of ambiguousWalls){
    const d=walls.find(x=>(cpDoc(x)?.uuid??cpDoc(x)?.id)===w.id);
    const coords=cpDoc(d)?.c;
    if(Array.isArray(coords)&&coords.length===4&&coords.every(cpFinite)){
     const cross=cpSegment(from,to,
      {x:coords[0],y:coords[1]},{x:coords[2],y:coords[3]});
     if(cross!=="clear")uncertainty.push("unclassified-wall:"+w.id);
    }else uncertainty.push("wall-geometry-unavailable");
   }
   if(method!=="adjacent-melee")
    for(const cr of blockers){
     const cross=cpTokenCross(from,to,cr);
     if(cross==="cross")crossed.push({kind:"soft",id:cr.id});
     if(cross==="ambiguous")uncertainty.push("creature-grazed:"+cr.id);
    }
   traces.push({targetCorner:j,blocked:crossed,uncertain:uncertainty,
    nativeSurfaceState});
  }
  const unknown=traces.some(r=>r.uncertain.length);
  const solid=traces.some(r=>r.blocked.some(x=>x.kind==="solid"));
  const soft=traces.some(r=>r.blocked.some(x=>x.kind==="soft"));
  cornerResults.push({originCorner:i,traces,unknown,solid,soft,
   clear:!unknown&&!solid&&!soft});
 }
 // PF1 adjacent melee considers all attacker origins, unlike the
 // attacker-selected corner for ranged and non-adjacent melee attacks.
 const considered=method==="adjacent-melee"?cornerResults:
  cornerResults;
 // Best-angle convention for ranged / non-adjacent melee: the
 // attacker selects the most favorable occupied-square corner.
 // A ray that merely touches a wall endpoint (or creature boundary)
 // is not a PROVEN crossing. Where an origin has no definite blockers
 // and its only uncertainties are such grazing contacts, treat it as
 // the clear best angle. Unknown wall classification, Levels collisions,
 // roof/height ambiguity and other uncertain geometry remain uncertain.
 const bestGrazeOnly=method!=="adjacent-melee"?
  considered.find(o=>o.unknown&&!o.solid&&!o.soft&&o.traces.every(ray=>
   ray.blocked.length===0&&ray.uncertain.every(u=>
    u.startsWith("wall-grazed:")||u.startsWith("creature-grazed:")))):
  null;
 if(bestGrazeOnly)
  return cpResult("confirmed","attacker-selected-best-grazing-angle",{
   type:"none",method,selectedOrigin:bestGrazeOnly.originCorner,
   origins:cornerResults,multilevel,sourceHeight,targetHeight,
   mode:selectedMode});
 if(method!=="adjacent-melee"&&considered.some(r=>r.clear))
  return cpResult("confirmed","attacker-selected-clear-corner",{
   type:"none",method,origins:cornerResults,
   multilevel,sourceHeight,targetHeight,mode:selectedMode});
 if(method==="adjacent-melee"&&considered.every(r=>r.clear))
  return cpResult("confirmed","all-adjacent-melee-rays-clear",{
   type:"none",method,origins:cornerResults,
   multilevel,sourceHeight,targetHeight,mode:selectedMode});
 // A strict wall/creature crossing proves at least partial cover for a
 // particular origin even if another ray only grazes a wall endpoint.
 // Unknown rays can change an otherwise clear origin into covered, but
 // cannot erase a proven blocking ray from that SAME origin.
 //
 // PF1 ranged/reach: the attacker may choose any occupied-square corner.
 // Therefore +4 is proven only when EVERY possible origin has at least
 // one definitively obstructed ray to a target corner.
 //
 // Total cover must remain strict: only fully proven solid obstruction
 // across every ray can establish that no direct ray gets through.
 if(considered.length>0&&considered.every(o=>o.traces.every(r=>
    r.blocked.some(x=>x.kind==="solid"))))
  return cpResult("confirmed","every-direct-ray-blocked-by-solid-walls",{
   type:"total",method,origins:cornerResults,
   multilevel,sourceHeight,targetHeight,mode:selectedMode});
 const guaranteed=considered.length>0&&considered.every(o=>o.solid||o.soft);
 if(guaranteed){
  // A selected origin with a proven soft-only blocker is sufficient to
  // establish cover, but not necessarily a solid-wall cover bonus.
  const softOnly=considered.some(o=>!o.solid&&o.soft);
  const type=softOnly?"soft":"normal";
  return cpResult("confirmed","every-origin-has-proven-obstruction",{
   type,method,origins:cornerResults,
   multilevel,sourceHeight,targetHeight,mode:selectedMode
  });
 }
 // There is an origin without a proven blocker. An ambiguous ray on
 // that origin could still establish cover, so do not guess +0 or +4.
 if(considered.some(r=>r.unknown))
  return cpResult("uncertain","wall-or-creature-contact-ambiguous",{
   method,origins:cornerResults});
 const best=method==="adjacent-melee"?considered:
  [...considered].sort((x,y)=>
   (x.solid?1:0)-(y.solid?1:0)||
   (x.soft?1:0)-(y.soft?1:0));
 const selected=best[0];
 if(!selected?.solid&&!selected?.soft)
  return cpResult("confirmed","no-cover",{
   type:"none",method,origins:cornerResults,
   multilevel,sourceHeight,targetHeight});
 return cpResult("confirmed","pf1-corner-rays-obstructed",{
  type:selected.solid?"normal":"soft",method,
  selectedOrigin:selected.originCorner,origins:cornerResults,
  multilevel,sourceHeight,targetHeight});

}
Hooks.once("ready",()=>{
 const module=game.modules.get(CP_NS);
 if(!module)return;
 module.api??={};
 module.api.coverPF1=Object.freeze({
  inspect:options=>cpInterpret(options),
  lastDiagnostic:()=>CP_LAST?cpClone(CP_LAST):null
 });
});
