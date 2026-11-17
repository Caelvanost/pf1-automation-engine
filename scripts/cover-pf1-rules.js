/**
 * PF1AE — PF1e square-grid cover interpretation.
 *
 * PHASE 1: read-only, conservative adjudication for unambiguous flat,
 * same-elevation 1×1 token spaces, native wall segments and interposed
 * creatures. No feat/class logic, no attacks, no saving throws or writes.
 *
 * Ranged/reach: for EACH choice of attacker-space corner, test all four
 * target-space corners. If there is one wholly clear origin, no cover.
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
 const result={status,reason,type,acBonus:bonus,
  reflexBonus:type==="normal"?2:type==="none"||type==="soft"?0:null,
  authoritative:status==="confirmed",
  source:"pf1-corner-rays",...extra};
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
  !cpFinite(d.width)||!cpFinite(d.height)||d.width!==1||d.height!==1)
  return null;
 return {id:d.uuid??d.id,x:d.x,y:d.y,
  x2:d.x+size,y2:d.y+size,elevation:d.elevation};
}
function cpCorners(s){
 // PF1 corners are actual grid intersections, not inset sample points.
 return [{x:s.x,y:s.y},{x:s.x2,y:s.y},
  {x:s.x2,y:s.y2},{x:s.x,y:s.y2}];
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
function cpWallData(wall,height){
 const d=cpDoc(wall);
 const coords=d?.c;
 if(!Array.isArray(coords)||coords.length!==4||
  !coords.every(cpFinite))return {kind:"unknown",reason:"wall-coordinates"};
 if(d.door!==undefined&&d.door!==0){
  if(d.ds===1)return {kind:"open",reason:"door-open"};
  if(d.ds!==0&&d.ds!==2)return {kind:"unknown",reason:"door-state"};
 }
 // Foundry v13 move restriction: NONE=0, NORMAL=1.
 // A non-physical or movement-passable wall is not inferred as ballistic.
 if(d.move===0)return {kind:"unknown",reason:"movement-passable-wall"};
 if(d.move!==1)return {kind:"unknown",reason:"wall-movement-restriction"};
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
function cpInterpret({attacker,target,attackType="ranged",scene,
 tokens,projectileHeight=null}={}){
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
 if(a.elevation!==t.elevation)
  return cpResult("uncertain","vertical-shot-requires-3d-adjudication");
 const height=cpFinite(projectileHeight)?projectileHeight:
  cpFinite(attacker?.losHeight)&&
  cpFinite(target?.losHeight)&&
  attacker.losHeight===target.losHeight?
   attacker.losHeight:null;
 if(height===null)return cpResult("uncertain","projectile-height-unverified");
 const walls=cpCollection(s.walls),tiles=cpCollection(s.tiles);
 const regions=cpCollection(s.regions);
 const all=tokens??globalThis.canvas?.tokens?.placeables;
 if(!walls||!tiles||!regions||!Array.isArray(all))
  return cpResult("uncertain","scene-collections-unavailable");
 if(tiles.some(tile=>{
  const d=cpDoc(tile);
  return d?.overhead||d?.flags?.levels?.blockSightMovement||
    d?.flags?.betterroofs?.brMode||d?.flags?.levels?.rangeTop!=null;
 }))return cpResult("uncertain","roof-or-floor-line-of-effect-unverified");
 if(regions.length)return cpResult("uncertain","region-collision-unverified");
 const blockingWalls=[];
 const ambiguousWalls=[];
 for(const wall of walls){
  const value=cpWallData(wall,height);
  if(value.kind==="solid")blockingWalls.push(value);
  else if(value.kind==="unknown")ambiguousWalls.push({...value,id:cpDoc(wall)?.uuid??cpDoc(wall)?.id});
 }
 const blockers=[];
 if(attackType!=="melee"){
  for(const other of all){
   const d=cpDoc(other);
   if(!d||d.id===cpDoc(attacker)?.id||d.id===cpDoc(target)?.id||
       d.parent?.id!==s.id)continue;
   if(d.elevation!==a.elevation)
    return cpResult("uncertain","intervening-creature-height-unverified");
   const rect=cpSpace(other,s,grid.size);
   if(!rect)return cpResult("uncertain","intervening-large-creature-unverified");
   blockers.push(rect);
  }
 }
 const dx=Math.max(a.x-t.x,t.x-a.x2,0);
 const dy=Math.max(a.y-t.y,t.y-a.y2,0);
 const adjacent=dx<=CP_EPS&&dy<=CP_EPS;
 const method=attackType==="melee"&&adjacent?"adjacent-melee":"ranged-or-reach";
 const cornerResults=[];
 const as=cpCorners(a),ts=cpCorners(t);
 for(let i=0;i<4;i++){
  const traces=[];
  for(let j=0;j<4;j++){
   const from=as[i],to=ts[j];
   const crossed=[];
   const uncertainty=[];
   for(const w of blockingWalls){
    const cross=cpSegment(from,to,w.a,w.b);
    if(cross==="cross")crossed.push({kind:"solid",id:w.id});
    else if(cross==="ambiguous")uncertainty.push("wall-grazed:"+w.id);
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
   traces.push({targetCorner:j,blocked:crossed,uncertain:uncertainty});
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
 if(method!=="adjacent-melee"&&considered.some(r=>r.clear))
  return cpResult("confirmed","attacker-selected-clear-corner",{
   type:"none",method,origins:cornerResults});
 if(method==="adjacent-melee"&&considered.every(r=>r.clear))
  return cpResult("confirmed","all-adjacent-melee-rays-clear",{
   type:"none",method,origins:cornerResults});
 // A solid obstruction along every ray may indicate total cover,
 // but PF1 total cover depends on line of effect, not a ray count.
 // Equally, an unknown/grazing ray may be the only clear option.
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
   type:"none",method,origins:cornerResults});
 // A wall that obstructs ALL rays at EVERY permitted origin could
 // eliminate line of effect entirely: don't downgrade to +4 CA.
 if(considered.every(o=>o.traces.every(r=>
    r.blocked.some(x=>x.kind==="solid"))))
  return cpResult("uncertain","possible-total-cover",{
   method,origins:cornerResults});
 return cpResult("confirmed","pf1-corner-rays-obstructed",{
  type:selected.solid?"normal":"soft",method,
  selectedOrigin:selected.originCorner,origins:cornerResults});
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
