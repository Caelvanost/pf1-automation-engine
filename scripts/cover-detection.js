/**
 * PF1AE PF1e cover assessment. Geometry is authoritative only when the
 * observable scene contains no walls/regions/levels and same-elevation
 * square-grid tokens have unambiguous positions. Otherwise return uncertain.
 * This module does NOT use vision as line of effect, and NEVER mutates AC.
 */
const CV_NS='pf1-automation-engine';
const CV_TYPES=Object.freeze({
 none:{ac:0,ref:0},partial:{ac:2,ref:1},
 normal:{ac:4,ref:2},soft:{ac:4,ref:0},
 improved:{ac:8,ref:4},total:{ac:null,ref:null}
});
let CV_LAST=null;
const cvCopy=r=>foundry.utils.deepClone(r);
const cvDoc=t=>t?.document??t;
const cvScene=t=>cvDoc(t)?.parent?.id??null;
const cvNum=n=>typeof n==='number'&&Number.isFinite(n)?n:null;
const cvBounds=(t,grid)=>{
 const d=cvDoc(t),size=cvNum(grid?.size),x=cvNum(d?.x),
  y=cvNum(d?.y),w=cvNum(d?.width),h=cvNum(d?.height);
 if(size===null||size<=0||x===null||y===null||
  w===null||w<=0||h===null||h<=0)return null;
 return {l:x,r:x+w*size,t:y,b:y+h*size,
  c:{x:x+w*size/2,y:y+h*size/2}};
};
const cvSide=(a,b,c)=> (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function cvCrossesInterior(a,b,box){
 // Liang–Barsky exact segment / rectangular token intersection.
 let enter=0,exit=1;const dx=b.x-a.x,dy=b.y-a.y;
 for(const [p,q] of [[-dx,a.x-box.l],[dx,box.r-a.x],
  [-dy,a.y-box.t],[dy,box.b-a.y]]){
  if(Math.abs(p)<1e-8){if(q<=0)return false;continue}
  const z=q/p;
  if(p<0)enter=Math.max(enter,z);
  else exit=Math.min(exit,z);
  if(enter>=exit-1e-8)return false;
 }
 return enter<1-1e-8&&exit>1e-8;
}
function cvResult(type,status,reason,{certainty=null,source='geometry',
 affected=true,spread=false,interposed=[]}={}){
 const rule=CV_TYPES[type]??null;
 const applicable=affected&&!(spread===true);
 const ac=(status==='confirmed'||status==='manual')&&rule?rule.ac:null;
 const ref=ac===null?null:applicable?rule.ref:0;
 const result=Object.freeze({type:type??null,status,reason,source,
  acBonus:ac,reflexBonus:ref,
  preventsDirectAttack:type==='total'&&(status==='confirmed'||status==='manual'),
  improvedCoverEvasion:type==='improved'&&applicable&&
   (status==='confirmed'||status==='manual'),
  certainty:certainty??(status==='confirmed'||status==='manual'?'verified':'unknown'),
  interposed:Object.freeze([...interposed])});
 CV_LAST=result;return result;
}
function cvManual({type,reflexProtected=false,spreadBypasses=false}={}){
 if(!Object.hasOwn(CV_TYPES,type))throw Error('Unsupported PF1e cover category');
 if(type==='total')return cvResult(type,'manual','GM determined no direct line of effect');
 return cvResult(type,'manual','GM-selected cover category',{
  source:'manual',affected:reflexProtected,spread:spreadBypasses});
}
function cvInspect({attacker,target,attackType='ranged',scene,
 tokens}={}){
 const s=scene??globalThis.canvas?.scene;
 const grid=globalThis.canvas?.grid;
 const a=cvDoc(attacker),t=cvDoc(target);
 if(!a||!t||!s)return cvResult(null,'impossible','missing-scene-or-tokens');
 if(!['ranged','melee','reach'].includes(attackType))
  return cvResult(null,'impossible','unsupported-attack-type');
 if(cvScene(attacker)!==s.id||cvScene(target)!==s.id)
  return cvResult(null,'impossible','tokens-in-different-scenes');
 if(s.grid?.type!==1&&s.grid?.type!=='square')
  return cvResult(null,'impossible','square-grid-required');
 if(cvNum(a.elevation)===null||cvNum(t.elevation)===null||
    a.elevation!==t.elevation)
  return cvResult(null,'uncertain','elevation-or-three-dimensional-line-unknown');
 const ab=cvBounds(attacker,grid),tb=cvBounds(target,grid);
 if(!ab||!tb)return cvResult(null,'impossible','occupied-space-unavailable');
 // Non-square / oversized tokens need individual PF1 grid corner selection.
 // The detector conservatively avoids inventing that choice here.
 if(a.width!==1||a.height!==1||t.width!==1||t.height!==1)
  return cvResult(null,'uncertain','multi-square-corner-choice-not-resolved');
 // This is a necessary condition, not a proof of cover: door states, wall
 // heights, wall-sense restrictions, region obstacles and roof levels matter.
 if(!s.walls||!s.regions||!s.tiles)
  return cvResult(null,'uncertain','scene-obstacle-collections-unavailable');
 const walls=[...(s.walls.contents??s.walls.values?.()??[])];
 if(walls.length)return cvResult(null,'uncertain',
  'wall-line-of-effect-unverified');
 const regions=[...(s.regions.contents??s.regions.values?.()??[])];
 if(regions.length)return cvResult(null,'uncertain',
  'region-obstacles-unverified');
 const tiles=[...(s.tiles.contents??s.tiles.values?.()??[])];
 if(tiles.some(t=>t?.overhead===true||t?.roof===true))
  return cvResult(null,'uncertain','overhead-obstacle-unverified');
 // No geometry data is not evidence of an obstacle. Search for creature
 // candidates; report them rather than assuming a midpoint is PF1 soft cover.
 const all=tokens??globalThis.canvas?.tokens?.placeables;
 if(!Array.isArray(all))return cvResult(null,'uncertain',
  'interposed-tokens-unavailable');
 const candidates=[];
 for(const other of all){
  const d=cvDoc(other);
  if(d?.id===a.id||d?.id===t.id||cvScene(other)!==s.id)continue;
  const ob=cvBounds(other,grid);
  if(!ob)return cvResult(null,'uncertain','interposed-token-geometry-unknown');
  if(cvNum(d.elevation)!==cvNum(t.elevation))continue;
  // Any token intersecting the possible corner-ray corridor MAY confer
  // cover. Without the full PF1 corner-ray test, flag uncertainty instead
  // of claiming absence from a clear center ray.
  const corridor={l:Math.min(ab.l,tb.l),r:Math.max(ab.r,tb.r),
   t:Math.min(ab.t,tb.t),b:Math.max(ab.b,tb.b)};
  const intersects=ob.r>corridor.l&&ob.l<corridor.r&&
   ob.b>corridor.t&&ob.t<corridor.b;
  if(intersects)candidates.push(d.uuid??d.id);
 }
 if(candidates.length)return cvResult(null,'uncertain',
  'possible-soft-cover-requires-corner-rays',{
   interposed:candidates});
 // No scene walls, no region obstacle, no token along the center segment.
 // Only a basic, empty, same-level 1x1 scene is proved unobstructed here.
 return cvResult('none','confirmed','clear-basic-square-grid');
}
Hooks.once('ready',()=>{
 const module=game.modules.get(CV_NS);
 if(!module)return;module.api??={};
 module.api.coverDetection=Object.freeze({
  inspect:options=>cvInspect(options),
  manual:options=>cvManual(options),
  categories:()=>cvCopy(CV_TYPES),
  lastDiagnostic:()=>CV_LAST?cvCopy(CV_LAST):null
 });
});
