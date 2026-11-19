/**
 * PF1AE — PF1 11.11 native "Higher Ground" checkbox preselection.
 *
 * Absolutely no attack bonus injection or Item/Actor writes.
 * The user retains full control of the native attack dialog checkbox.
 * A simple positive Token elevation and verified melee reach are enough.
 *
 * The checkbox is a native AttackDialog flag, not a documented UseOptions
 * property. Locate it in the rendered dialog by its own label or attribute
 * and invoke the real checkbox click handler so PF1 processes it normally.
 */
const HG_NS="pf1-automation-engine";
const HG_EPS=1e-6;
let hgLast=null;
const HG_TOUCHED=new WeakSet();
const hgFinite=n=>typeof n==="number"&&Number.isFinite(n);
const hgDoc=t=>t?.document??t;
const hgList=x=>Array.isArray(x)?x:
 Array.isArray(x?.contents)?x.contents:
 typeof x?.values==="function"?[...x.values()]:[];
const hgReport=result=>{
 hgLast=result;
 try{if(game.settings.get(HG_NS,"genericDebug"))
  console.debug("[PF1AE][HigherGround]",result)}
 catch(_){}
 return result;
};
const hgEnabled=()=>{
 try{return game.modules.get(HG_NS)?.active===true&&
  game.settings.get(HG_NS,"genericEnabled")===true&&
  game.settings.get(HG_NS,"autoHighGround")===true}
 catch(_){return false}
};
const hgResult=(status,reason,extra={})=>Object.freeze({
 status,eligible:status==="eligible",reason,...extra
});
function hgPoints(token,grid,scene){
 const d=hgDoc(token),size=grid?.size;
 if(!d||d.parent?.id!==scene?.id||!hgFinite(size)||size<=0||
  !hgFinite(d.x)||!hgFinite(d.y)||
  !Number.isInteger(d.width)||!Number.isInteger(d.height)||
  d.width<1||d.height<1||d.width>16||d.height>16||
  Math.abs(d.x/size-Math.round(d.x/size))>HG_EPS||
  Math.abs(d.y/size-Math.round(d.y/size))>HG_EPS)return null;
 const pts=[];
 for(let y=0;y<d.height;y++)for(let x=0;x<d.width;x++)
  pts.push({x:d.x+(x+.5)*size,y:d.y+(y+.5)*size});
 return pts;
}
function hgInspect({attacker,target,action,actor}={}){
 if(!hgEnabled())return hgResult("skipped","disabled");
 if(!action||!["mwak","msak"].includes(action.actionType)||
   action.hasAttack!==true||action.isCombatManeuver===true)
  return hgResult("skipped","not-melee-attack");
 const scene=canvas?.scene,grid=canvas?.grid;
 if(!scene||!grid||
  ![1,"square"].includes(scene.grid?.type)||
  typeof grid.measurePath!=="function")
  return hgResult("uncertain","grid-unavailable");
 if(!actor?.uuid||attacker?.actor?.uuid!==actor.uuid||
  !target||attacker?.actor?.uuid===target?.actor?.uuid)
  return hgResult("uncertain","attacker-or-target-unavailable");
 const a=hgDoc(attacker),t=hgDoc(target);
 if(!hgFinite(a?.elevation)||!hgFinite(t?.elevation))
  return hgResult("uncertain","elevation-unavailable");
 const elevationDifference=a.elevation-t.elevation;
 if(elevationDifference<=HG_EPS)
  return hgResult("not-elevated","attacker-not-higher");
 const aa=hgPoints(attacker,grid,scene),bb=hgPoints(target,grid,scene);
 if(!aa?.length||!bb?.length)
  return hgResult("uncertain","token-squares-unavailable");
 let distance=Infinity;
 for(const p of aa)for(const q of bb){
  let n;
  try{n=grid.measurePath([p,q])?.distance}
  catch(_){return hgResult("uncertain","grid-measurement-failed")}
  if(!hgFinite(n)||n<0)
   return hgResult("uncertain","grid-measurement-unavailable");
  distance=Math.min(distance,n);
 }
 if(!hgFinite(distance)||distance<=HG_EPS)
  return hgResult("uncertain","overlapping-tokens");
 let reach;
 try{reach=action.getRange?.({type:"max"})}
 catch(_){return hgResult("uncertain","native-reach-failed")}
 if(!hgFinite(reach)||reach<=0)
  return hgResult("uncertain","native-reach-unavailable");
 // Native PF1 melee getRange(max) and canvas.grid.measurePath both use the
 // scene's own distance units (not pf1.settings.distance.metric).
 if(distance>reach+HG_EPS||elevationDifference>reach+HG_EPS)
  return hgResult("out-of-reach","target-out-of-melee-reach",{
   distance,reach,elevationDifference
  });
 return hgResult("eligible","attacker-higher-and-in-melee-reach",{
  distance,reach,elevationDifference
 });
}
function hgFromUse(use){
 const action=use?.action??use?.shared?.action;
 const actor=use?.actor??action?.actor??use?.item?.actor;
 const list=hgList(use?.shared?.targets??use?.targets);
 const targets=list.length?list:hgList(game.user?.targets);
 if(targets.length!==1)return hgResult("uncertain","single-target-required");
 const target=targets[0]?.object??targets[0];
 const from=use?.token?.object??use?.token;
 const active=actor?.getActiveTokens?.()??[];
 const attacker=from?.actor?.uuid===actor?.uuid?from:
  active.length===1?active[0]:null;
 return hgInspect({attacker,target,actor,action});
}
const hgNormalize=s=>String(s??"").normalize("NFD")
 .replace(/[\u0300-\u036f]/g,"").toLowerCase();
const HG_LABEL=/\b(?:higher[ -]?ground|high[ -]?ground|sur[eé]lev[eé]|surelev|hauteur dominante)\b/i;
function hgCheckboxText(input,root){
 // Prefer native input data/name/id, its label and surrounding form-group.
 // Do not match an arbitrary checkbox using a general 'height' substring.
 const attr=["name","id","data-flag","data-key","aria-label"].map(key=>
  input.getAttribute?.(key)??"").join(" ");
 const label=input.closest?.("label")||
  (input.id&&root.querySelector?.('label[for="'+CSS.escape(input.id)+'"]'))||
  input.parentElement;
 const text=String(label?.textContent??"").slice(0,240);
 return hgNormalize(attr+" "+text);
}
function hgFindCheckbox(root){
 const inputs=[...(root?.querySelectorAll?.('input[type="checkbox"]')??[])];
 const matches=inputs.filter(input=>HG_LABEL.test(hgCheckboxText(input,root)));
 return matches.length===1?matches[0]:null;
}
function hgDialogRoot(html){
 if(html?.querySelectorAll)return html;
 if(html?.[0]?.querySelectorAll)return html[0];
 return null;
}
function hgPrecheckDialog(app,html){
 if(!hgEnabled())return hgReport(hgResult("skipped","disabled"));
 if(!app||HG_TOUCHED.has(app))return hgReport(hgResult("skipped","already-processed"));
 const use=app.actionUse;
 if(!use||!use.action||!use.actor)
  return hgReport(hgResult("uncertain","native-action-use-unavailable"));
 const diagnosis=hgFromUse(use);
 if(!diagnosis.eligible)return hgReport(diagnosis);
 const root=hgDialogRoot(html);
 const checkbox=hgFindCheckbox(root);
 if(!checkbox)return hgReport(hgResult("uncertain","native-higher-ground-checkbox-not-found"));
 HG_TOUCHED.add(app);
 if(checkbox.checked)
  return hgReport(hgResult("prechecked","already-checked",{diagnosis}));
 if(checkbox.disabled)
  return hgReport(hgResult("uncertain","native-higher-ground-checkbox-disabled"));
 // Click triggers PF1's own flag handler, exactly like a player click.
 // Never set attackBonus, rollData, shared.useOptions or app.flags.
 checkbox.click();
 return hgReport(hgResult("prechecked","native-checkbox-clicked",{diagnosis}));
}
Hooks.once("init",()=>{
 game.settings.register(HG_NS,"autoHighGround",{
  name:"PF1AE.Settings.HighGround.Name",
  hint:"PF1AE.Settings.HighGround.Hint",
  scope:"world",config:true,type:Boolean,restricted:true,default:false
 });
 // Keep the legacy world setting registered to preserve old world data,
 // but it is deliberately not consulted by the simplified detector.
 game.settings.register(HG_NS,"highGroundRequireSupport",{
  name:"PF1AE.Settings.HighGroundRequireSupport.Name",
  hint:"PF1AE.Settings.HighGroundRequireSupport.Hint",
  scope:"world",config:false,type:Boolean,restricted:true,default:false
 });
 Hooks.on("renderAttackDialog",(app,html)=>{
  try{hgPrecheckDialog(app,html)}
  catch(error){console.warn("[PF1AE][HighGround] Dialog precheck skipped",error)}
 });
});
Hooks.once("ready",()=>{
 const mod=game.modules.get(HG_NS);
 if(!mod)return;
 mod.api??={};
 mod.api.highGround=Object.freeze({
  inspect:hgInspect,inspectActionUse:hgFromUse,
  precheckDialog:hgPrecheckDialog,lastDiagnostic:()=>hgLast
 });
});
