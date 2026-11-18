/**
 * PF1AE — Generic tactical positioning (read-only).
 * Foundry VTT 13.351 / PF1 11.11.
 *
 * This is intentionally NOT a feat/class-specific automation and never writes
 * attack bonuses or actor data. A Script Call may query the result before
 * deciding how its own Item ability interacts with PF1's native rules.
 */
const TP_NS='pf1-automation-engine';
const TP_SETTING='tacticalPositioningEnabled';
const TP_EPS=1e-6;
let TP_LAST=null;
const tpEnabled=()=>game.modules.get(TP_NS)?.active===true&&
 game.settings.get(TP_NS,'genericEnabled')===true&&
 game.settings.get(TP_NS,TP_SETTING)===true;
const tpDoc=t=>t?.document??t;
const tpScene=t=>tpDoc(t)?.parent?.id??tpDoc(t)?.parent?.uuid??null;
const tpSide=t=>tpDoc(t)?.disposition;
const tpId=t=>tpDoc(t)?.uuid??tpDoc(t)?.id??null;
const tpNum=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
function tpResult(status,reason,extra={}){
 return Object.freeze({
  status,flanking:status==='flanking'?true:status==='not-flanking'?false:null,
  bonus:status==='flanking'?2:status==='not-flanking'?0:null,
  reason,allies:Object.freeze([...(extra.allies??[])]),
  candidates:extra.candidates??0,
  uncertain:Object.freeze([...(extra.uncertain??[])])
 });
}
function tpReport(result){
 TP_LAST=result;
 try{if(game.settings.get(TP_NS,'genericDebug'))
  console.debug('[PF1AE][TacticalPositioning]',result);}
 catch(_){}
 return result;
}
const tpFail=(reason,extra)=>tpReport(tpResult('uncertain',reason,extra));
const tpOut=(reason,extra)=>tpReport(tpResult('not-flanking',reason,extra));
function tpBounds(t,grid){
 const d=tpDoc(t),size=tpNum(grid?.size);
 const x=tpNum(d?.x),y=tpNum(d?.y);
 const w=tpNum(d?.width),h=tpNum(d?.height);
 if(size===null||size<=0||x===null||y===null||
    w===null||w<=0||h===null||h<=0)return null;
 return {left:x,right:x+w*size,top:y,bottom:y+h*size,
  center:{x:x+w*size/2,y:y+h*size/2}};
}
function tpPointInBox(p,b){
 return p.x>b.left+TP_EPS&&p.x<b.right-TP_EPS&&
  p.y>b.top+TP_EPS&&p.y<b.bottom-TP_EPS;
}
/**
 * PF1 flanking geometry: the line connecting both attackers' centers must
 * cross OPPOSITE borders of the defender's space, including opposite corners.
 * Liang-Barsky clipping is exact for square-grid axis-aligned TokenDocuments.
 */
function tpOppositeBorders(a,b,bounds){
 const dx=b.x-a.x,dy=b.y-a.y;
 let enter=0,exit=1;
 for(const [p,q] of [
  [-dx,a.x-bounds.left],[dx,bounds.right-a.x],
  [-dy,a.y-bounds.top],[dy,bounds.bottom-a.y]
 ]){
  if(Math.abs(p)<=TP_EPS){
   if(q<0)return false;
   continue;
  }
  const r=q/p;
  if(p<0)enter=Math.max(enter,r);
  else exit=Math.min(exit,r);
  if(enter>exit-TP_EPS)return false;
 }
 if(enter<=TP_EPS||exit>=1-TP_EPS)return false;
 const first={x:a.x+enter*dx,y:a.y+enter*dy};
 const last={x:a.x+exit*dx,y:a.y+exit*dy};
 // For corner crossings, touching both opposite x or y boundaries also
 // counts; brushing one border without traversing the interior does not.
 return (Math.abs(first.x-bounds.left)<=TP_EPS&&
          Math.abs(last.x-bounds.right)<=TP_EPS)||
        (Math.abs(first.x-bounds.right)<=TP_EPS&&
          Math.abs(last.x-bounds.left)<=TP_EPS)||
        (Math.abs(first.y-bounds.top)<=TP_EPS&&
          Math.abs(last.y-bounds.bottom)<=TP_EPS)||
        (Math.abs(first.y-bounds.bottom)<=TP_EPS&&
          Math.abs(last.y-bounds.top)<=TP_EPS);
}
const tpUnit=u=>{
 const s=String(u??'').toLowerCase();
 return ['ft','feet','foot'].includes(s)?'ft':
  ['m','metre','metres','meter','meters'].includes(s)?'m':null;
};
function tpOccupied(t,grid){
 const d=tpDoc(t);
 const offsets=d?.getOccupiedGridSpaceOffsets?.();
 if(!Array.isArray(offsets)||offsets.length===0||
    typeof grid?.getCenterPoint!=='function')return null;
 const points=offsets.map(x=>grid.getCenterPoint(x));
 return points.every(p=>tpNum(p?.x)!==null&&tpNum(p?.y)!==null)?
  points:null;
}
function tpDistance(a,b,grid){
 const aa=tpOccupied(a,grid),bb=tpOccupied(b,grid);
 if(!aa||!bb||typeof grid?.measurePath!=='function')return null;
 let shortest=Infinity;
 for(const start of aa)for(const end of bb){
  try{
   const d=tpNum(grid.measurePath([start,end])?.distance);
   if(d!==null&&d>=0)shortest=Math.min(shortest,d);
  }catch(_){return null}
 }
 return Number.isFinite(shortest)?shortest:null;
}
function tpCanThreaten(actor){
 if(actor?.documentName!=='Actor')return null;
 const hp=actor.system?.attributes?.hp?.value;
 if(typeof hp==='number'&&hp<=0)return false;
 const disabled=['dead','unconscious','paralyzed','stunned','helpless','petrified'];
 if(disabled.some(x=>actor.statuses?.has?.(x)))return false;
 const items=[...(actor.items?.contents??actor.items?.values?.()??[])];
 let evidence=false;
 for(const item of items){
  const natural=item.system?.subType==='natural';
  const armed=item.type==='weapon'&&item.system?.equipped===true;
  const attack=item.type==='attack';
  if(!natural&&!armed&&!attack)continue;
  const actions=[...(item.actions?.contents??item.system?.actions??[])];
  if(natural||actions.some(x=>['mwak','msak'].includes(x?.actionType)))
   evidence=true;
 }
 // A missing equipped weapon is not proof of inability to threaten
 // (unarmed strikes, special attacks, etc.).
 return evidence?true:null;
}
function tpReach(actor,sceneUnit){
 if(sceneUnit!=='ft'&&sceneUnit!=='m')return null;
 let prepared=null;
 try{prepared=actor?.getRollData?.()?.range?.melee}
 catch(_){}
 const values=[prepared,
  actor?.system?.attributes?.naturalReach?.total,
  actor?.system?.attributes?.naturalReach?.value,
  actor?.system?.attributes?.reach?.total,
  actor?.system?.attributes?.reach];
 for(const v of values){
  const n=Number(v);
  if(v===null||v===undefined||v===''||!Number.isFinite(n)||n<=0)continue;
  // PF1 prepared melee reach is already in the active scene units.
  // Never derive its units from pf1.settings.distance.metric: that optional
  // flag can be undefined in a metric scene. Re-conversion would reduce
  // native 1.5 m reach to 0.45 m and incorrectly reject a legal flank.
  return n;
 }
 return null;
}
function tpThreatens(token,target,grid,unit){
 const actor=token?.actor;
 const ability=tpCanThreaten(actor);
 if(ability!==true)return ability;
 const reach=tpReach(actor,unit);
 const distance=tpDistance(token,target,grid);
 if(reach===null||distance===null)return null;
 // This only establishes positive natural melee reach. An equipped
 // reach-only weapon or an undocumented minimum reach is ambiguous;
 // do not infer special weapon threat arcs from a token's size.
 return distance<=reach+TP_EPS;
}
function tpCheckFlanking({attacker,target,allies}={}){
 if(!tpEnabled())return tpFail('service-disabled');
 if(!attacker||!target||attacker===target)
  return tpFail('invalid-attacker-or-target');
 const scene=globalThis.canvas?.scene;
 const grid=globalThis.canvas?.grid;
 const sceneId=scene?.id;
 if(!sceneId||tpScene(attacker)!==sceneId||tpScene(target)!==sceneId)
  return tpFail('tokens-not-in-current-scene');
 const gridType=scene?.grid?.type;
 if(gridType!==1&&gridType!=='square')return tpFail('unsupported-grid');
 const unit=tpUnit(scene?.grid?.units);
 if(!unit||!grid)return tpFail('unknown-grid-units');
 const disposition=tpSide(attacker),opposition=tpSide(target);
 if(![1,-1].includes(disposition)||![1,-1].includes(opposition)||
  disposition===opposition)return tpFail('factions-unverified');
 const attackerBounds=tpBounds(attacker,grid);
 const defenderBounds=tpBounds(target,grid);
 if(!attackerBounds||!defenderBounds)return tpFail('token-geometry-unavailable');
 const tElev=tpNum(tpDoc(target)?.elevation);
 const aElev=tpNum(tpDoc(attacker)?.elevation);
 if(aElev===null||tElev===null||aElev!==tElev)
  return tpFail('elevation-unverified');
 if(tpPointInBox(attackerBounds.center,defenderBounds))
  return tpFail('overlapping-token-centers');
 const firstThreat=tpThreatens(attacker,target,grid,unit);
 if(firstThreat===false)return tpOut('attacker-cannot-threaten');
 if(firstThreat!==true)return tpFail('attacker-threat-unknown');
 const candidates=allies===undefined?
  globalThis.canvas?.tokens?.placeables:allies;
 if(!Array.isArray(candidates))return tpFail('allies-unavailable');
 const ids=new Set([tpId(attacker),tpId(target)]);
 const uncertain=[];
 const successful=[];
 let eligible=0;
 for(const ally of candidates){
  const id=tpId(ally);
  if(!id||ids.has(id)||tpScene(ally)!==sceneId||
     tpSide(ally)!==disposition)continue;
  ids.add(id);eligible++;
  const allyBounds=tpBounds(ally,grid);
  if(!allyBounds){uncertain.push({id,reason:'ally-geometry-unknown'});continue;}
  const elev=tpNum(tpDoc(ally)?.elevation);
  if(elev===null||elev!==tElev){
   uncertain.push({id,reason:'ally-elevation-unverified'});continue;
  }
  if(!tpOppositeBorders(attackerBounds.center,allyBounds.center,defenderBounds))
   continue;
  const threatened=tpThreatens(ally,target,grid,unit);
  if(threatened===true)successful.push(id);
  else if(threatened===null)
   uncertain.push({id,reason:'ally-threat-unknown'});
 }
 if(successful.length)return tpReport(tpResult('flanking','opposite-borders',{
  allies:successful,candidates:eligible,uncertain}));
 if(uncertain.length)return tpFail('flanking-uncertain',{
  candidates:eligible,uncertain});
 return tpOut('no-qualified-opposite-ally',{candidates:eligible});
}
/**
 * Synchronize PF1's existing Attack Dialog "Flanking" checkbox only when
 * the native geometry returns a definite true/false. An old preset true must
 * not survive a confirmed not-flanking position. Uncertain results remain
 * untouched, and players can still change the value inside the dialog.
 * No independent +2 bonus is applied by PF1AE.
 */
function tpPrecheck(use){
 if(!tpEnabled())return false;
 if(!use||use?.actor?.documentName!=='Actor'||
    use?.item?.documentName!=='Item'||
    use.item.actor?.uuid!==use.actor.uuid||
    !['mwak','msak'].includes(use.action?.actionType)||
    use.action?.hasAttack!==true||
    !use.shared?.useOptions||typeof use.shared.useOptions!=='object')return false;
 const targets=[...(game.user?.targets??[])];
 if(targets.length!==1)return false;
 const attacker=use.token?.object??use.token;
 if(!attacker||attacker.actor?.uuid!==use.actor.uuid)return false;
 const result=tpCheckFlanking({attacker,target:targets[0]});
 // Preserve all unknown outcomes: absence of evidence is not evidence
 // of a confirmed invalid flank and must not override another module.
 if(result.flanking===null)return false;
 const desired=result.flanking===true;
 if(use.shared.useOptions.flanking===desired)return false;
 // This hook runs before the attack dialog is shown; do not touch the
 // checkbox or user edits once the native dialog is open.
 use.shared.useOptions.flanking=desired;
 return true;
}
Hooks.once('init',()=>{
 Hooks.on('pf1CreateActionUse',use=>{
  try{tpPrecheck(use)}catch(error){
   console.warn('[PF1AE][TacticalPositioning] Native precheck skipped',error);
  }
 });
 game.settings.register(TP_NS,TP_SETTING,{
  name:game.i18n?.localize?.('PF1AE.Settings.TacticalPositioning.Name')??
   'Tactical positioning detection',
  hint:game.i18n?.localize?.('PF1AE.Settings.TacticalPositioning.Hint')??
   'Detect flanking and precheck the native melee-attack option when certain; never add a bonus independently.',
  scope:'world',config:true,restricted:true,type:Boolean,default:true
 });
});
Hooks.once('ready',()=>{
 const module=game.modules.get(TP_NS);
 if(!module)return;
 module.api??={};
 module.api.tacticalPositioning=Object.freeze({
  checkFlanking:options=>tpCheckFlanking(options),
  precheck:use=>tpPrecheck(use),
  lastDiagnostic:()=>TP_LAST?structuredClone(TP_LAST):null
 });
});
