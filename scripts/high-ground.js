/**
 * PF1AE 1.39 — Higher ground (+1 melee attack), Foundry VTT 13 / PF1 11.11.
 * Read-only geometry; native PF1 rolls all attack dice. No actor/Item updates.
 *
 * A higher token elevation alone does NOT prove advantageous terrain (flight,
 * hovering, multi-level interiors). Default safe mode requires a GM-confirmed
 * support flag on the ATTACKER TokenDocument:
 *   token.document.setFlag("pf1-automation-engine","highGroundSupported",true)
 *
 * Trusted Table Mode skips the per-token GM confirmation, but retains the
 * geometric, airborne, melee-only and no-stacking safeguards.
 * "Require terrain confirmation" may be disabled in world settings to treat
 * small positive token elevations as elevated ground (a deliberate GM choice).
 * Never stack with native/other-module higher-ground bonuses.
 */
const HG_NS="pf1-automation-engine";
const HG_EPS=1e-6;
const HG_MARKER="1[PF1AE Higher Ground]";
const HG_APPLIED=new WeakSet();
let hgLast=null;
const hgNum=n=>typeof n==="number"&&Number.isFinite(n)?n:null;
const hgDoc=t=>t?.document??t;
const hgUnit=u=>{
 const v=String(u??"").trim().toLowerCase();
 return ["ft","feet","foot"].includes(v)?"ft":
 ["m","meter","meters","metre","metres"].includes(v)?"m":null;
};
const hgResult=(status,reason,extra={})=>Object.freeze({
 status,bonus:status==="confirmed"?1:0,reason,...extra
});
const hgReport=r=>{
 hgLast=r;
 try{if(game.settings.get(HG_NS,"genericDebug"))console.debug("[PF1AE][HighGround]",r)}
 catch(_){}
 return r;
};
const hgEnabled=()=>{
 try{return game.modules.get(HG_NS)?.active===true&&
 game.settings.get(HG_NS,"genericEnabled")===true&&
 game.settings.get(HG_NS,"autoHighGround")===true}
 catch(_){return false}
};
const hgCollection=x=>Array.isArray(x)?x:
 Array.isArray(x?.contents)?x.contents:
 typeof x?.values==="function"?[...x.values()]:[];
const hgPoints=(token,grid,scene)=>{
 const d=hgDoc(token),size=hgNum(grid?.size);
 if(!d||d.parent?.id!==scene?.id||size===null||size<=0||
  !Number.isInteger(d.width)||!Number.isInteger(d.height)||
  d.width<1||d.height<1||d.width>16||d.height>16||
  hgNum(d.x)===null||hgNum(d.y)===null||
  Math.abs(d.x/size-Math.round(d.x/size))>HG_EPS||
  Math.abs(d.y/size-Math.round(d.y/size))>HG_EPS)return null;
 const result=[];
 for(let y=0;y<d.height;y++)for(let x=0;x<d.width;x++)
  result.push({x:d.x+(x+.5)*size,y:d.y+(y+.5)*size});
 return result;
};
const hgFlying=token=>{
 const a=token?.actor,d=hgDoc(token);
 return ["flying","fly","hovering","levitate","levitating"].some(s=>
  a?.statuses?.has?.(s)===true||d?.statuses?.has?.(s)===true)||
  a?.system?.attributes?.movement?.fly?.total>0&&
  (d?.flags?.[HG_NS]?.currentlyFlying===true);
};
const hgTerrainConfirmed=token=>{
 const d=hgDoc(token);
 return d?.getFlag?.(HG_NS,"highGroundSupported")===true||
  d?.flags?.[HG_NS]?.highGroundSupported===true;
};
function hgInspect({attacker,target,action,actor}={}){
 if(!hgEnabled())return hgResult("skipped","disabled");
 if(!action||!["mwak","msak"].includes(action.actionType)||
  action.hasAttack!==true||action.isCombatManeuver===true)
  return hgResult("skipped","not-melee-attack");
 const s=canvas?.scene,g=canvas?.grid;
 if(!s||!g||!["square",1].includes(s.grid?.type)||
    !hgUnit(s.grid?.units)||typeof g.measurePath!=="function")
  return hgResult("uncertain","grid-unavailable");
 if(!attacker||!target||!actor?.uuid||
  attacker.actor?.uuid!==actor.uuid||
  target.actor?.uuid===actor.uuid)
  return hgResult("uncertain","token-actor-unverified");
 const a=hgDoc(attacker),t=hgDoc(target);
 const ae=hgNum(a?.elevation),te=hgNum(t?.elevation);
 if(ae===null||te===null)return hgResult("uncertain","elevation-unavailable");
 if(ae<=te+HG_EPS)return hgResult("not-elevated","attacker-not-higher");
 if(hgFlying(attacker))return hgResult("uncertain","airborne-attacker");
 const sceneSquare=hgNum(s.grid?.distance);
 if(sceneSquare===null||sceneSquare<=0)
  return hgResult("uncertain","grid-distance-unavailable");
 const delta=ae-te;
 if(delta>sceneSquare+HG_EPS)
  return hgResult("uncertain","vertical-separation-too-large");
 const aPts=hgPoints(attacker,g,s),tPts=hgPoints(target,g,s);
 if(!aPts?.length||!tPts?.length)
  return hgResult("uncertain","occupied-squares-unavailable");
 let distance=Infinity;
 for(const p of aPts)for(const q of tPts){
  let n;
  try{n=g.measurePath([p,q])?.distance}catch(_){
   return hgResult("uncertain","measurement-failed");
  }
  if(hgNum(n)===null||n<0)return hgResult("uncertain","measurement-unavailable");
  distance=Math.min(distance,n);
 }
 if(distance<HG_EPS)return hgResult("uncertain","overlapping-tokens");
 // PF1 native getRange(max) for melee is prepared in scene units.
 let reach;
 try{reach=action.getRange?.({type:"max"})}catch(_){}
 if(hgNum(reach)===null||reach<=0)
  return hgResult("uncertain","native-reach-unavailable");
 if(distance>reach+HG_EPS)
  return hgResult("not-eligible","melee-target-out-of-reach",
   {distance,reach,unit:hgUnit(s.grid.units)});
 let requireEvidence=true;
 try{requireEvidence=game.settings.get(HG_NS,"highGroundRequireSupport")!==false}
 catch(_){}
 // Trusted Table Mode is an explicit GM world-wide opt-in: no
 // per-token GM confirmation is required while it is enabled.
 // Geometry, reach and airborne safeguards remain mandatory.
 let trustedTable=false;
 try{trustedTable=game.settings.get(HG_NS,"trustedTableMode")===true}
 catch(_){}
 if(requireEvidence&&!trustedTable&&!hgTerrainConfirmed(attacker))
  return hgResult("uncertain","terrain-support-not-confirmed",
   {distance,reach,elevationDifference:delta});
 return hgResult("confirmed","supported-higher-ground",
  {distance,reach,elevationDifference:delta,unit:hgUnit(s.grid.units)});
}
function hgFromUse(use){
 const action=use?.action??use?.shared?.action;
 const actor=use?.actor??action?.actor??use?.item?.actor;
 const raw=hgCollection(use?.shared?.targets??use?.targets);
 const targets=raw.length?raw:hgCollection(game.user?.targets);
 if(targets.length!==1)return hgResult("uncertain","single-target-required");
 const target=targets[0]?.object??targets[0];
 const token=use?.token?.object??use?.token;
 const active=actor?.getActiveTokens?.()??[];
 const attacker=token?.actor?.uuid===actor?.uuid?token:
  active.length===1?active[0]:null;
 return hgInspect({attacker,target,actor,action});
}
function hgNativeAlreadyApplied(use){
 const shared=use?.shared??{};
 const values=[...(Array.isArray(shared.attackBonus)?shared.attackBonus:[])];
 // Explicitly avoid duplicating an already prepared higher-ground bonus.
 return values.some(x=>/higher[ -]?ground|high[ -]?ground|position sur[eé]lev[eé]e/i.test(String(x)))||
  shared.useOptions?.highGround===true||
  shared.useOptions?.higherGround===true||
  shared.formData?.highGround===true||
  shared.formData?.higherGround===true;
}
function hgPrepare(use){
 const result=hgReport(hgFromUse(use));
 if(result.status!=="confirmed"||HG_APPLIED.has(use))return result;
 if(!Array.isArray(use?.shared?.attackBonus))return hgReport(hgResult("uncertain","native-attack-bonus-unavailable"));
 if(hgNativeAlreadyApplied(use))return hgReport(hgResult("skipped","native-or-external-bonus-present"));
 use.shared.attackBonus.push(HG_MARKER);
 HG_APPLIED.add(use);
 return result;
}
Hooks.once("init",()=>{
 game.settings.register(HG_NS,"autoHighGround",{
  name:"PF1AE.Settings.HighGround.Name",
  hint:"PF1AE.Settings.HighGround.Hint",
  scope:"world",config:true,type:Boolean,restricted:true,default:false
 });
 game.settings.register(HG_NS,"highGroundRequireSupport",{
  name:"PF1AE.Settings.HighGroundRequireSupport.Name",
  hint:"PF1AE.Settings.HighGroundRequireSupport.Hint",
  scope:"world",config:true,type:Boolean,restricted:true,default:true
 });
 Hooks.on("pf1CreateActionUse",use=>{
  try{hgPrepare(use)}catch(error){
   console.warn("[PF1AE][HighGround] Native preparation skipped",error);
  }
 });
});
Hooks.once("ready",()=>{
 const mod=game.modules.get(HG_NS);
 if(!mod)return;
 mod.api??={};
 mod.api.highGround=Object.freeze({
  inspect:hgInspect,inspectActionUse:hgFromUse,
  prepare:hgPrepare,lastDiagnostic:()=>hgLast
 });
});
