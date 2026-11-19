/**
 * PF1AE — conservative action range gate for Foundry 13 / PF1 11.11.
 *
 * Pure inspection; never changes Actor, Item, ChatMessage, ammo or charge.
 * A confirmed out-of-range single-target action may be rejected
 * by the existing ActionUse.process early gate.
 *
 * For explicit numeric ranges, action.range.value and range.units are
 * authoritative; formulaic ranges use native getRange() in system units.
 * Native square-grid measurePath checks the closest occupied
 * square centres, including large and rectangular tokens. Vertical token
 * separation is included using Pathfinder's alternating-diagonal 3D rule
 * when grid measurements are consistent; else a conservative lower bound.
 *
 * Unverifiable geometry/range never blocks an action.
 */
const MR_NS="pf1-automation-engine";
const MR_EPS=1e-6;
const mrFinite=n=>typeof n==="number"&&Number.isFinite(n);
const mrDoc=t=>t?.document??t;
const mrList=x=>Array.isArray(x)?x:Array.isArray(x?.contents)?x.contents:
 typeof x?.values==="function"?[...x.values()]:[];
const mrUnits=u=>{
 const s=String(u??"").trim().toLowerCase();
 if(["ft","feet","foot"].includes(s))return "ft";
 if(["m","meter","meters","metre","metres"].includes(s))return "m";
 return null;
};
const mrUncertain=(reason,extra={})=>Object.freeze({
 status:"uncertain",outOfReach:null,reason,...extra
});
const mrMode=()=>globalThis.pf1?.settings?.distance?.metric===true?"m":"ft";
function mrOccupied(token,scene,grid){
 const d=mrDoc(token),size=grid?.size;
 if(!d||d.parent?.id!==scene.id||!mrFinite(size)||size<=0||
  !mrFinite(d.x)||!mrFinite(d.y)||!mrFinite(d.elevation)||
  !Number.isInteger(d.width)||!Number.isInteger(d.height)||
  d.width<1||d.height<1||d.width>16||d.height>16||
  Math.abs(d.x/size-Math.round(d.x/size))>MR_EPS||
  Math.abs(d.y/size-Math.round(d.y/size))>MR_EPS)return null;
 const points=[];
 for(let y=0;y<d.height;y++)for(let x=0;x<d.width;x++)
  points.push({x:d.x+(x+0.5)*size,y:d.y+(y+0.5)*size});
 return points;
}
/**
 * PF1 3D grid distance: use the alternating 1/2 square diagonal rule,
 * including vertical diagonals, when all three axes occupy whole squares.
 * Foundry's 2D grid ruler must agree with PF1's expected horizontal result
 * before we extend it to 3D. Otherwise use a safe LOWER BOUND:
 * max(native planar distance, vertical separation). This can miss some
 * impossible 3D attacks, but can never forbid a legal diagonal.
 */
function mrThreeDimensional(p,q,vertical,scene,grid,planar){
 if(vertical<=MR_EPS)return {distance:planar,mode:"planar"};
 const lower=Math.max(planar,vertical);
 const size=grid?.size,step=scene?.grid?.distance;
 if(!mrFinite(step)||step<=0||!mrFinite(size)||size<=0)
  return {distance:lower,mode:"3d-lower-bound"};
 const x=Math.abs(p.x-q.x)/size,y=Math.abs(p.y-q.y)/size,z=vertical/step;
 const whole=n=>Math.abs(n-Math.round(n))<=MR_EPS;
 if(![x,y,z].every(whole))return {distance:lower,mode:"3d-lower-bound"};
 const axes=[Math.round(x),Math.round(y),Math.round(z)];
 const horizontal=Math.max(axes[0],axes[1])+
  Math.floor(Math.min(axes[0],axes[1])/2);
 // Never impose a 3D diagonal rule when the scene's native 2D grid uses
 // another diagonal convention or custom measurement.
 if(Math.abs(planar-horizontal*step)>MR_EPS)
  return {distance:lower,mode:"3d-lower-bound"};
 axes.sort((a,b)=>b-a);
 const counted=(axes[0]+Math.floor(axes[1]/2))*step;
 return {distance:Math.max(lower,counted),mode:"pf1-3d-grid"};
}
function mrInspect({attacker,target,action,actor,scene,grid}={}){
 const s=scene??globalThis.canvas?.scene;
 const g=grid??globalThis.canvas?.grid;
 if(!s||s.id!==globalThis.canvas?.scene?.id||
  !g||typeof g.measurePath!=="function"||
  (s.grid?.type!==1&&s.grid?.type!=="square"))
  return mrUncertain("square-grid-measurement-unavailable");
 const isMelee=["mwak","msak"].includes(action?.actionType)&&
  action?.hasAttack===true&&action?.isCombatManeuver!==true;
 // PF1 hasRange documents genuine measured spell/ability/weapon ranges.
 // Never constrain actions without a native numeric range, or template
 // placements where the origin/destination is chosen after process().
 if(!action||(!isMelee&&action.hasRange!==true))
  return mrUncertain("action-has-no-measurable-range");
 if(action.hasTemplate===true)
  return mrUncertain("template-placement-unverified");
 if(!attacker||!target||!actor?.uuid||
  attacker.actor?.uuid!==actor.uuid||
  attacker.actor?.uuid===target.actor?.uuid)
  return mrUncertain("actor-token-provenance-unavailable");
 const a=mrDoc(attacker),t=mrDoc(target);
 if(!mrFinite(a?.elevation)||!mrFinite(t?.elevation))
  return mrUncertain("elevation-unverified");
 // Token elevations are expressed in the scene's grid distance units.
 const verticalDistance=Math.abs(a.elevation-t.elevation);
 const unit=mrUnits(s.grid?.units),systemUnit=mrMode();
 if(!unit)return mrUncertain("scene-distance-unit-unverified");
 const aa=mrOccupied(attacker,s,g),bb=mrOccupied(target,s,g);
 if(!aa||!bb)return mrUncertain("token-footprint-unverified");
 if(a.x===t.x&&a.y===t.y)
  return mrUncertain("overlapping-tokens");
 // A literal range has its own units. Do not infer them from the
 // world/system metric preference: a 30 ft spell on a metric scene is 9 m.
 // Native getRange() is retained for formulaic/PF1-calculated ranges, where
 // its result is expressed in the PF1 configured system distance units.
 const declared=mrUnits(action.range?.units);
 const raw=action.range?.value;
 const literal=(typeof raw==="number"&&mrFinite(raw))||
  (typeof raw==="string"&&/^(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)$/.test(raw.trim()));
 // For native melee/reach actions PF1 returns effective reach in the
 // active scene's distance units (e.g. 1.5 on an m scene). The former
 // system-distance preference fallback treated that as 1.5 ft and reduced
 // a rapier's normal reach to 0.45 m.
 // Only explicit numeric values with explicit ft/m units bypass this rule.
 let max,minimum=0,rangeUnit=isMelee?unit:systemUnit,
  rangeSource="action.getRange";
 if(literal&&declared){
  max=Number(raw);rangeUnit=declared;rangeSource="action.range.value";
  // A ranged WEAPON's numeric range is one increment, not its total range.
  // Only multiply when the native increment count is explicitly available.
  if(["rwak","twak"].includes(action.actionType)&&action.isRanged===true){
   const increments=action.range?.maxIncrements;
   if(!Number.isSafeInteger(increments)||increments<1)
    return mrUncertain("ranged-weapon-max-increments-unverified");
   max*=increments;
  }
 }else{
  try{max=action.getRange?.({type:"max"})}
  catch(_){return mrUncertain("native-range-evaluation-failed")}
  if(!mrFinite(max)||max<=0)
   return mrUncertain("native-maximum-range-unavailable");
  try{
   const m=action.getRange?.({type:"min"});
   if(mrFinite(m)&&m>=0)minimum=m;
  }catch(_){/* an absent minimum does not affect maximum-range checks */}
 }
 if(!mrFinite(max)||max<=0)return mrUncertain("native-maximum-range-unavailable");
 const scale=rangeUnit===unit?1:rangeUnit==="ft"?0.3:1/0.3;
 const maxScene=max*scale,minScene=minimum*scale;
 if(!mrFinite(maxScene)||maxScene<=0)
  return mrUncertain("invalid-range-conversion");
 let distance=Infinity,horizontalDistance=Infinity,distanceMode="planar";
 // Measure every occupied cell pair, including 3D separation, to select
 // the closest potential melee/contact point for Large tokens.
 for(const p of aa)for(const q of bb){
  let measured;
  try{measured=g.measurePath([p,q])?.distance}
  catch(_){return mrUncertain("grid-path-measurement-failed")}
  if(!mrFinite(measured)||measured<0)
   return mrUncertain("grid-path-distance-unverified");
  horizontalDistance=Math.min(horizontalDistance,measured);
  const result=mrThreeDimensional(p,q,verticalDistance,s,g,measured);
  if(result.distance<distance-MR_EPS){
   distance=result.distance;
   distanceMode=result.mode;
  }
 }
 if(!mrFinite(distance))return mrUncertain("distance-unverified");
 const tooFar=distance>maxScene+MR_EPS;
 const status=tooFar?(isMelee?"out-of-reach":"out-of-range"):
  (isMelee?"in-reach":"in-range");
 return Object.freeze({
  status,outOfReach:tooFar,outOfRange:tooFar,
  reason:tooFar?"beyond-native-action-range":"within-native-action-range",
  distance,horizontalDistance,verticalDistance,distanceMode,
  maximumReach:maxScene,minimumReach:minScene,unit,
  source:rangeSource,rangeUnit,actionType:action.actionType??null,
  attackerTokenUuid:a.uuid,
  targetTokenUuid:t.uuid
 });
}
function mrFromActionUse(use){
 const action=use?.action??use?.shared?.action;
 const actor=use?.actor??action?.actor??action?.item?.actor;
 if(!action||!actor?.uuid)return mrUncertain("action-actor-unavailable");
 const raw=mrList(use?.shared?.targets??use?.targets);
 const targets=raw.length?raw:mrList(game.user?.targets);
 if(targets.length!==1)return mrUncertain("single-target-required");
 const target=targets[0]?.object??targets[0];
 const candidate=use?.token?.object??use?.token;
 const active=actor.getActiveTokens?.()??[];
 const attacker=candidate?.actor?.uuid===actor.uuid?candidate:
  active.length===1?active[0]:null;
 return mrInspect({attacker,target,actor,action});
}
Hooks.once("ready",()=>{
 const mod=game.modules?.get?.(MR_NS);
 if(!mod)return;
 mod.api??={};
 const api=Object.freeze({
  inspect:mrInspect,inspectActionUse:mrFromActionUse
 });
 mod.api.meleeReach=api; // Retain existing Script Call API.
 mod.api.actionRange=api; // Generic spells, abilities and ranged attacks.
});
