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
 const bonus=type==="partial"?2:type==="normal"||type==="soft"?4:type==="improved"?8:type==="none"?0:null;
 const configuredMode=game.modules?.get?.(CP_NS)?.api?.coverMode?.get?.()??"2d";
 const result={status,reason,type,acBonus:bonus,
  reflexBonus:type==="partial"?1:type==="normal"?2:type==="improved"?4:type==="none"||type==="soft"?0:null,
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
// Only GM-classified wall grades; never guess cover from token visibility.
function cpWallGrade(wall){
 const d=cpDoc(wall),grade=d?.flags?.[CP_NS]?.coverGrade;
 // A closed or locked door is a wall, even if its sight/light settings
 // resemble a window or a stale GM flag asks for a different cover grade.
 // Open and unknown door states are handled by cpWallData.
 if(d?.door!==undefined&&d.door!==0&&
    (d.ds===0||d.ds===2))return "solid";
 if(grade==="partial"||grade==="improved"||grade==="window")return grade;
 // Foundry v13's native Window preset: blocks movement but explicitly
 // allows sight and light. An invisible movement wall is geometrically
 // identical; a GM may override its treatment via the coverGrade flag.
 const movement=globalThis.CONST?.WALL_MOVEMENT_TYPES;
 const sense=globalThis.CONST?.WALL_SENSE_TYPES;
 if(cpFinite(movement?.NORMAL)&&cpFinite(sense?.NONE)&&
    d?.move===movement.NORMAL&&d.sight===sense.NONE&&
    d.light===sense.NONE)return "window";
 return "solid";
}
function cpWallSegment(wall){
 const c=cpDoc(wall)?.c;
 return Array.isArray(c)&&c.length===4&&c.every(cpFinite)?
  [{x:c[0],y:c[1]},{x:c[2],y:c[3]}]:null;
}
function cpDistanceToSegment(point,a,b){
 const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
 const k=den>0?Math.max(0,Math.min(1,
  ((point.x-a.x)*dx+(point.y-a.y)*dy)/den)):0;
 return Math.hypot(point.x-a.x-k*dx,point.y-a.y-k*dy);
}
function cpDistanceToWall(space,wall){
 const seg=cpWallSegment(wall);
 if(!seg)return Infinity;
 const center={x:(space.x+space.x2)/2,y:(space.y+space.y2)/2};
 return cpDistanceToSegment(center,...seg);
}
function cpWindowAdjacent(attacker,wall){
 // Center-to-window <= 0.75 square: adjacent cardinal and diagonal squares.
 return cpDistanceToWall(attacker,wall)<=attacker.size*0.75+CP_EPS;
}
function cpSizeGrade(target){
 const d=cpDoc(target);
 const size=target?.actor?.system?.traits?.size??
  target?.actor?.system?.details?.size??
  d?.actor?.system?.traits?.size;
 const code=String(size?.value??size??"").toLowerCase();
 if(["med","medium","m"].includes(code))return "partial";
 if(["sm","small","s"].includes(code))return "solid";
 return null;
}
function cpLowWallGrade(wall,attacker,target,targetToken,scene,grid){
 const d=cpDoc(wall),bounds=d?.flags?.["wall-height"];
 if(!cpFinite(bounds?.bottom)||!cpFinite(bounds?.top)||
    bounds.top<bounds.bottom)return null;
 const units=String(scene?.grid?.units??"").toLowerCase();
 // Scene distances and wall-height elevations share the scene's units.
 const threshold=["m","meter","meters","metre","metres"].includes(units)?1:
  ["ft","feet","foot","pieds"].includes(units)?3:null;
 if(threshold===null)return null;
 const height=bounds.top-bounds.bottom;
 if(height>=threshold-CP_EPS||height<=CP_EPS||
   Math.abs(bounds.bottom-target.elevation)>CP_EPS)return null;
 // PF1 low obstacles only protect creatures sufficiently close to them,
 // and not when the attacker is closer to the obstacle than the defender.
 const dt=cpDistanceToWall(target,wall);
 const da=cpDistanceToWall(attacker,wall);
 const distanceUnits=cpFinite(scene.grid.distance)&&scene.grid.distance>0?
  scene.grid.distance:null;
 if(distanceUnits===null)return null;
 const maxSquares=6;
 if(dt>maxSquares*grid.size+CP_EPS||da<=dt+CP_EPS)return null;
 return cpSizeGrade(targetToken);
}
function cpWallData(wall,height,mode,{grade=null,lowCover=false}={}){
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
  id:d.uuid??d.id,grade:grade??cpWallGrade(d)};
 if(lowCover)return {kind:"solid",
  a:{x:coords[0],y:coords[1]},b:{x:coords[2],y:coords[3]},
  id:d.uuid??d.id,grade:grade??cpWallGrade(d)};
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
  b:{x:coords[2],y:coords[3]},id:d.uuid??d.id,grade:grade??cpWallGrade(d)};
}

function cpSlopedWall(from,to,wall,startHeight,endHeight,{grade=null,lowCover=false}={}){
 const d=cpDoc(wall),coords=d?.c;
 if(!Array.isArray(coords)||coords.length!==4||!coords.every(cpFinite))
  return {kind:"unknown",reason:"wall-coordinates"};
 const a={x:coords[0],y:coords[1]},b={x:coords[2],y:coords[3]};
 const crossing=cpSegment(from,to,a,b);
 if(crossing==="clear")return {kind:"clear"};
 if(crossing==="ambiguous")return {kind:"unknown",reason:"wall-grazed"};
 if(lowCover)return {kind:"solid",grade:grade??cpWallGrade(d)};
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
 return {kind:"solid",grade:grade??cpWallGrade(d)};
}
/**
 * Estimate the unobstructed fraction of the TARGET'S OCCUPIED SILHOUETTE,
 * not the proportion of clear PF1 target-corner rays. Corner rays still
 * decide whether cover exists or whether a direct attack is prohibited.
 *
 * 2D: uniform samples through the occupied footprint. This is a proxy for
 * the projected body, not a measurement from an actor artwork/portrait.
 * 3D: sample the footprint and the vertical span from token elevation to
 * its verified LOS height. Missing heights leave normal cover unchanged.
 *
 * Never downgrade creature-provided soft cover, special wall grades,
 * windows, or an unknown wall intersection to partial cover. We use the
 * strict >50% criterion from PF1e, and retain normal cover whenever the
 * estimate cannot be trusted.
 */
// House rule: a token's occupied height equals its occupied horizontal
// size in grid cells. 1x1 on a 1.5 m grid = 1.5 m, 2x2 = 3 m.
// Using the target's LOS eye height here would misrepresent its body.
function cpTokenBodyHeight(space,scene){
 const distance=scene?.grid?.distance;
 if(!cpFinite(distance)||distance<=0||
    !cpFinite(space?.width)||!cpFinite(space?.height)||
    space.width<=0||space.height<=0)return null;
 return Math.max(space.width,space.height)*distance;
}
function cpVisibleMajority({from,targetSpace,sceneWalls,wallOptions,mode,
 sourceHeight,targetBodyHeight,targetElevation}){
 if(mode==="3d"&&(!cpFinite(sourceHeight)||
    !cpFinite(targetBodyHeight)||!cpFinite(targetElevation)||
    targetBodyHeight<=CP_EPS))return null;
 // Dense vertical samples catch the narrow exposed strip above a wall.
// Five samples can incorrectly call a 5ft target totally blocked by a
// 4ft wall when the line of sight originates below the wall top.
 const slices=mode==="3d"?21:1;
 const side=9;
 let clear=0,blocked=0,unknown=0;
 for(let z=0;z<slices;z++){
  const toHeight=mode==="3d"?targetElevation+
   targetBodyHeight*(z+0.5)/slices:null;
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){
   const to={x:targetSpace.x+(targetSpace.x2-targetSpace.x)*(x+0.5)/side,
    y:targetSpace.y+(targetSpace.y2-targetSpace.y)*(y+0.5)/side};
   let obstructed=false,ambiguous=false;
   for(const wall of sceneWalls){
    const opts=wallOptions.get(wall);
    if(!opts||opts.grade==="adjacent-window")continue;
    const segment=cpWallSegment(wall);
    if(!segment)return null;
    const cross=cpSegment(from,to,...segment);
    if(cross==="clear"||cross==="ambiguous")continue;
    // Special cover applies only when the sampled ray actually crosses
    // that segment; unrelated walls elsewhere in the scene are harmless.
    if(opts.grade!=="solid"||opts.lowCover)return null;
    const known=cpWallData(wall,sourceHeight,"2d",opts);
    if(known.kind==="unknown")return null;
    if(known.kind==="open")continue;
    if(mode==="3d"){
     const hit=cpSlopedWall(from,to,wall,sourceHeight,toHeight,opts);
     if(hit.kind==="unknown"){
      if(hit.reason==="wall-height-boundary"){
       ambiguous=true;break;
      }
      return null;
     }
     if(hit.kind==="clear")continue;
    }
    obstructed=true;break;
   }
   if(ambiguous)unknown++;
   else if(obstructed)blocked++;
   else clear++;
  }
 }
 const count=clear+blocked+unknown;
 return count?{visibleFraction:clear/count,samples:count,
  visibleSamples:clear,blockedSamples:blocked,uncertainSamples:unknown,
  bodyHeight:mode==="3d"?targetBodyHeight:null,
  bodyTop:mode==="3d"?targetElevation+targetBodyHeight:null,
  // An ambiguous boundary sample can neither prove visibility nor
  // prove total obstruction. Only positive evidence supports downgrades.
  majority:clear>count/2}:null;
}
function cpInterpret({attacker,target,attackType="ranged",scene,
 tokens,projectileHeight=null,mode,
 meleeSquareSelection=false,visibilityCenterOverride=null,
 targetBodyHeightOverride=null}={}){
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
 const wallOptions=new Map();
 for(const wall of walls){
  const explicit=cpWallGrade(wall);
  const low=selectedMode==="3d"&&explicit==="solid"?
   cpLowWallGrade(wall,a,t,target,s,grid):null;
  const grade=low??(explicit==="window"&&cpWindowAdjacent(a,wall)?
   "adjacent-window":explicit);
  const options={grade,lowCover:low!==null};
  wallOptions.set(wall,options);
  // An adjacent window does not confer improved cover. Any other wall
  // on the same ray continues to be considered independently.
  if(grade==="adjacent-window")continue;
  const value=cpWallData(wall,sourceHeight,sloped?"2d":selectedMode,options);
  if(sloped&&value.kind==="solid")slopedWalls.push(wall);
  else if(value.kind==="solid")blockingWalls.push(value);
  else if(value.kind==="unknown")ambiguousWalls.push({
   ...value,id:cpDoc(wall)?.uuid??cpDoc(wall)?.id
  });
 }
 // PF1e: melee against a nonadjacent target (natural reach or reach
 // weapon) uses ranged cover rules, INCLUDING interposed creatures.
 // Adjacent melee sees walls but does NOT gain soft cover from creatures.
 const dx=Math.max(a.x-t.x,t.x-a.x2,0);
 const dy=Math.max(a.y-t.y,t.y-a.y2,0);
 const adjacent=dx<=CP_EPS&&dy<=CP_EPS;
 const method=attackType==="melee"&&adjacent?"adjacent-melee":"ranged-or-reach";
 // Big creatures can pick a square occupied by either participant for
 // melee cover. Resolve each adjacent square pair independently; the
 // attacker can use the most favorable legal choice.
 if(method==="adjacent-melee"&&!meleeSquareSelection&&
   (a.width>1||a.height>1||t.width>1||t.height>1)){
  const pairs=[];
  for(let ay=0;ay<a.height;ay++)for(let ax=0;ax<a.width;ax++)
   for(let ty=0;ty<t.height;ty++)for(let tx=0;tx<t.width;tx++){
    const ox=a.x+ax*a.size,oy=a.y+ay*a.size;
    const px=t.x+tx*t.size,py=t.y+ty*t.size;
    const deltaX=Math.max(ox-(px+t.size),px-(ox+a.size),0);
    const deltaY=Math.max(oy-(py+t.size),py-(oy+a.size),0);
    if(deltaX>CP_EPS||deltaY>CP_EPS)continue;
    pairs.push({ax,ay,tx,ty,ox,oy,px,py});
   }
  if(!pairs.length||pairs.length>100)return cpResult("uncertain",
   "adjacent-melee-large-square-pairs-unverified",{method});
  const originalCenter={x:(a.x+a.x2)/2,y:(a.y+a.y2)/2};
  const fullBodyHeight=selectedMode==="3d"?cpTokenBodyHeight(t,s):null;
  const resolved=pairs.map(pair=>{
   const attackerSquare={...attacker,document:{
    ...cpDoc(attacker),x:pair.ox,y:pair.oy,width:1,height:1}};
   const targetSquare={...target,document:{
    ...cpDoc(target),x:pair.px,y:pair.py,width:1,height:1}};
   const assessment=cpInterpret({attacker:attackerSquare,
    target:targetSquare,attackType:"melee",scene:s,tokens:all,
    projectileHeight,mode:selectedMode,meleeSquareSelection:true,
    visibilityCenterOverride:originalCenter,
    targetBodyHeightOverride:fullBodyHeight});
   return {pair:{attacker:[pair.ax,pair.ay],target:[pair.tx,pair.ty]},
    assessment};
  });
  const usable=resolved.filter(x=>x.assessment.status==="confirmed");
  // A demonstrated fully unprotected square is enough to establish no
  // cover, even when a different candidate is uncertain.
  const none=usable.find(x=>x.assessment.type==="none");
  if(none)return cpResult("confirmed","large-melee-chosen-clear-square",{
   type:"none",method:"adjacent-melee-large-squares",
   squareChoice:none.pair,candidateCount:pairs.length,mode:selectedMode});
  if(usable.length!==resolved.length)return cpResult("uncertain",
   "large-melee-square-choice-unverified",{
    method:"adjacent-melee-large-squares",candidateCount:pairs.length});
  const rank={partial:2,normal:4,soft:4,improved:8,total:100};
  const best=resolved.sort((x,y)=>
   (rank[x.assessment.type]??100)-(rank[y.assessment.type]??100))[0];
  return cpResult("confirmed","large-melee-chosen-occupied-square",{
   type:best.assessment.type,method:"adjacent-melee-large-squares",
   squareChoice:best.pair,candidateCount:pairs.length,
   mode:selectedMode});
 }
 const blockers=[];
 if(method!=="adjacent-melee"){
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
    if(cross==="cross")crossed.push({kind:w.grade??"solid",id:w.id});
    else if(cross==="ambiguous")uncertainty.push("wall-grazed:"+w.id);
   }
   for(const w of slopedWalls){
    const result=cpSlopedWall(from,to,w,sourceHeight,targetHeight,
     wallOptions.get(w));
    const id=cpDoc(w)?.uuid??cpDoc(w)?.id;
    if(result.kind==="solid")crossed.push({kind:result.grade??"solid",id});
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
  const partial=traces.some(r=>r.blocked.some(x=>x.kind==="partial"));
  const improved=traces.some(r=>r.blocked.some(x=>x.kind==="improved"));
  const rank={partial:2,soft:4,solid:4,improved:8,window:8};
  const grade=traces.flatMap(r=>r.blocked).reduce((value,hit)=>
   Math.max(value,rank[hit.kind]??0),0);
  const coverType=grade===8?"improved":grade===4?(solid?"normal":"soft"):
   grade===2?"partial":null;
  cornerResults.push({originCorner:i,traces,unknown,solid,soft,partial,improved,
   coverType,clear:!unknown&&!coverType});
 }
 // PF1 adjacent melee considers all attacker origins, unlike the
 // attacker-selected corner for ranged and non-adjacent melee attacks.
 const considered=method==="adjacent-melee"?cornerResults:
  cornerResults;
 // For 3D, an eye-height ray hitting a wall does not prove total
 // cover if the token's body extends ABOVE that wall. First inspect
 // target-space samples across its whole occupied vertical volume.
 // The 2D total-cover rule remains unchanged.
 const targetBodyHeight=selectedMode==="3d"?
  (cpFinite(targetBodyHeightOverride)?targetBodyHeightOverride:
   cpTokenBodyHeight(t,s)):null;
 // Foundry v13 token vision originates from the center of the occupied
 // token space. For PF1AE's >50% visible-body house rule, sample every
 // ray from that ONE point, regardless of which corner would be best for
 // the attack's PF1 line-of-effect adjudication. Do not switch back to
 // a corner when the attacker is Large or a ray is grazing a wall.
 const visibilitySource=visibilityCenterOverride??{
  x:(a.x+a.x2)/2,
  y:(a.y+a.y2)/2
 };
 let centerVisibility;
 for(const origin of considered){
  // Preserve the v1.39.13 best-grazing-angle ruling for flat
  // sightlines. Sloped 3D rays need a separate body-volume inspection:
  // a clear eye-level ray can still hide the lower target silhouette.
  // 2D still requires proven corner-ray cover before body sampling.
  if((origin.unknown&&!origin.coverType&&
       !(selectedMode==="3d"&&sloped))||
     (selectedMode==="2d"&&!origin.coverType))continue;
  if((origin.coverType&&origin.coverType!=="normal")||
     origin.soft||origin.partial||origin.improved||
     origin.unknown&&origin.traces.some(ray=>
      ray.uncertain.some(u=>!u.startsWith("wall-grazed:")&&
       !u.startsWith("creature-grazed:"))))continue;
  if(origin.traces.some(ray=>ray.blocked.some(hit=>hit.kind!=="solid")))
   continue;
  if(origin.traces.some(ray=>ray.uncertain.some(u=>
    u.startsWith("creature-grazed:"))))continue;
  if(centerVisibility===undefined)
   centerVisibility=cpVisibleMajority({
    from:visibilitySource,targetSpace:t,sceneWalls:walls,
    wallOptions,mode:selectedMode,sourceHeight,targetBodyHeight,
    targetElevation:t.elevation
   })??null;
  const visibility=centerVisibility;
  if(visibility){
   origin.visibility={...visibility,
    source:"attacker-token-center",
    sourcePoint:{...visibilitySource}};
   if(visibility.majority&&visibility.blockedSamples>0){
    origin.coverType="partial";
    origin.partial=true;
    origin.clear=false;
   }else if(selectedMode==="3d"&&!origin.coverType&&
       visibility.blockedSamples>0){
    // A clear eye-height ray can still pass over a wall that hides
    // most of the target's body. Do not infer no cover from eyes alone.
    origin.coverType="normal";
    origin.solid=true;
    origin.clear=false;
   }
  }
 }
 // Best-angle convention for ranged / non-adjacent melee: the
 // attacker selects the most favorable occupied-square corner.
 // A ray that merely touches a wall endpoint (or creature boundary)
 // is not a PROVEN crossing. Where an origin has no definite blockers
 // and its only uncertainties are such grazing contacts, treat it as
 // the clear best angle. Unknown wall classification, Levels collisions,
 // roof/height ambiguity and other uncertain geometry remain uncertain.
 const bestGrazeOnly=method!=="adjacent-melee"?
  considered.find(o=>o.unknown&&!o.coverType&&o.traces.every(ray=>
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
 // A confirmed total obstruction requires all four corner rays to
 // cross solid walls AND, in 3D, a proven zero visible body volume.
 // Missing scale data never justifies suppressing a direct attack.
 if(considered.length>0&&considered.every(o=>o.traces.every(r=>
    r.blocked.some(x=>x.kind==="solid")))&&
    (selectedMode==="2d"||considered.every(o=>
      o.visibility?.visibleSamples===0&&
      o.visibility?.uncertainSamples===0)))
  return cpResult("confirmed","every-direct-ray-blocked-by-solid-walls",{
   type:"total",method,origins:cornerResults,
   multilevel,sourceHeight,targetHeight,mode:selectedMode});
 // Adjacent melee is stricter than ranged: if ANY line from ANY
 // corner crosses a wall, cover applies. A clear origin does not cancel
 // a wall crossing from another corner. Partial/improved types are kept.
 if(method==="adjacent-melee"){
  const covered=considered.filter(o=>o.coverType);
  const unverifiable=considered.some(o=>o.traces.some(r=>
   r.uncertain.some(u=>!u.startsWith("wall-grazed:"))));
  if(unverifiable)return cpResult("uncertain",
   "adjacent-melee-collision-unverified",{method,origins:cornerResults});
  if(covered.length){
   const weights={partial:2,normal:4,improved:8};
   const selected=[...covered].sort((x,y)=>
    (weights[y.coverType]??0)-(weights[x.coverType]??0))[0];
   return cpResult("confirmed","adjacent-melee-any-corner-wall-cover",{
    type:selected.coverType,method,selectedOrigin:selected.originCorner,
    origins:cornerResults,multilevel,sourceHeight,targetHeight,
    mode:selectedMode});
  }
  return cpResult("confirmed","adjacent-melee-no-wall-cover",{
   type:"none",method,origins:cornerResults,
   multilevel,sourceHeight,targetHeight,mode:selectedMode});
 }
 const guaranteed=considered.length>0&&considered.every(o=>o.coverType);
 if(guaranteed){
  // Attacker chooses the least-protected origin; do not downgrade wall
  // cover just because a different corner also crosses a creature.
  const weight={partial:2,soft:4,normal:4,improved:8};
  const selected=[...considered].sort((a,b)=>
   weight[a.coverType]-weight[b.coverType]||
   a.originCorner-b.originCorner)[0];
  const type=selected.coverType;
  return cpResult("confirmed","every-origin-has-proven-obstruction",{
   type,method,selectedOrigin:selected.originCorner,origins:cornerResults,
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
   ({partial:2,normal:4,soft:4,improved:8}[x.coverType]??0)-
  ({partial:2,normal:4,soft:4,improved:8}[y.coverType]??0));
 const selected=best[0];
 if(!selected?.coverType)
  return cpResult("confirmed","no-cover",{
   type:"none",method,origins:cornerResults,
   multilevel,sourceHeight,targetHeight});
 return cpResult("confirmed","pf1-corner-rays-obstructed",{
  type:selected.coverType,method,
  selectedOrigin:selected.originCorner,origins:cornerResults,
  multilevel,sourceHeight,targetHeight});

}
Hooks.once("ready",()=>{
 const module=game.modules.get(CP_NS);
 if(!module)return;
 module.api??={};
 module.api.coverPF1=Object.freeze({
  inspect:options=>cpInterpret(options),
  lastDiagnostic:()=>CP_LAST?cpClone(CP_LAST):null,
  setWallGrade:async(wall,grade)=>{
   if(!game.user?.isGM)throw Error("GM required to classify a wall");
   const doc=cpDoc(wall);
   if(doc?.documentName!=="Wall")throw Error("Wall document required");
   if(![null,"partial","normal","improved","window"].includes(grade))
    throw Error("Unsupported wall cover grade");
   return grade===null||grade==="normal"?
    doc.unsetFlag(CP_NS,"coverGrade"):
    doc.setFlag(CP_NS,"coverGrade",grade);
  }
 });
});
