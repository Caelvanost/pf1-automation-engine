/**
 * PF1AE — shooting into melee. Foundry v13 / PF1 v11.11.
 * Native ActionUse.addAttacks() prepares shared.attacks[index].attackBonus
 * just before ChatAttack.addAttack evaluates each roll.
 * Fail closed on uncertain threats, alliances and per-index targets.
 */
const RM_NS='pf1-automation-engine',RM_SETTING='autoRangedMeleePenalty';
const RM_SCRIPT='PF1AE:rangedMelee:override';
const RM_OVERRIDES=new WeakMap(),RM_COMPLETED=new WeakSet();
// Explicit per-ActionUse lifecycle: native rollData.attackCount only counts
// PREPARED attacks. It is not evidence that a d20 was evaluated.
const RM_PHASE=new WeakMap();
const RM_COMMON=new WeakMap();
const RM_PENDING=new Set();
const rmPenaltyLabel=()=>String(game.i18n?.lang??'en').toLowerCase().split(/[-_]/)[0]==='fr'
 ?'Tir dans le tas':'Shooting into melee';
let RM_DIAGNOSTIC=null;
const rmReport=(status,details={})=>{
 RM_DIAGNOSTIC={status,...details,at:Date.now()};
 try{if(game.settings.get(RM_NS,'genericDebug'))console.debug('[PF1AE][RangedMelee]',RM_DIAGNOSTIC)}
 catch(_){}
 return RM_DIAGNOSTIC;
};
const rmEnabled=()=>game.modules.get(RM_NS)?.active===true&&
 game.settings.get(RM_NS,'genericEnabled')===true&&
 game.settings.get(RM_NS,RM_SETTING)===true;
const rmAuthorized=use=>use?.actor?.documentName==='Actor'&&
 use?.item?.documentName==='Item'&&use.item.actor?.uuid===use.actor.uuid&&
 (game.user?.isGM===true||use.actor.testUserPermission?.(game.user,'OWNER')===true);
const rmIdentity=use=>!!use&&typeof use==='object'&&
 rmAuthorized(use)&&use.action&&use.item&&
 (use.action.item?.uuid==null||use.action.item.uuid===use.item.uuid);
const rmAttack=use=>['rwak','twak','rsak'].includes(use?.action?.actionType)&&
 use?.action?.hasAttack===true;
// Remove only the EXACT part added by PF1AE, never a range/feat/native bonus.
function rmRemoveCommon(use){
 const record=RM_COMMON.get(use);
 if(!record)return null;
 const parts=use?.shared?.attackBonus;
 if(Array.isArray(parts)){
  const index=parts.indexOf(record.part);
  if(index!==-1)parts.splice(index,1);
 }
 RM_COMMON.delete(use);
 return record;
}
const rmCleanup=use=>{
 rmRemoveCommon(use);
 RM_OVERRIDES.delete(use);RM_PENDING.delete(use);RM_COMPLETED.add(use);
 RM_PHASE.set(use,'completed');
};
const rmItems=actor=>[...(actor?.items?.contents??actor?.items?.values?.()??[])];
const rmCalls=item=>[...(item?.scriptCalls?.contents??item?.scriptCalls?.values?.()??[])];
const rmValid=penalty=>Number.isSafeInteger(penalty)&&penalty>=-20&&penalty<=0;
function rmPrepare({actionUse,attackIndex=0,penalty,reason='external-script'}={}){
 if(!rmIdentity(actionUse)||!rmAttack(actionUse))
  throw Error('A permitted native ranged attack ActionUse is required.');
 if(!Number.isSafeInteger(attackIndex)||attackIndex<0||attackIndex>99||!rmValid(penalty))
  throw Error('Invalid attack index or ranged melee penalty.');
 // Only a registered use before native addAttacks() reaches its roll stage
 // may accept a new override. Native PF1 prepares rollData.attackCount
 // before calling addAttacks(): it MUST NOT be used as a roll indicator.
 // chatAttacks entries are created/filled by native ChatAttack.addAttack.
 const phase=RM_PHASE.get(actionUse);
 if(RM_COMPLETED.has(actionUse)||
    (phase!=='created'&&phase!=='preparing')||
    (actionUse?.shared?.chatAttacks?.length??0)>0||
    actionUse?.shared?.message!=null)
  throw Error('Attack already rolled or completed.');
 const records=RM_OVERRIDES.get(actionUse)??new Map();
 if(records.has(attackIndex))throw Error('Duplicate ranged melee override for this attack.');
 records.set(attackIndex,{penalty,reason:String(reason).slice(0,120)});
 RM_OVERRIDES.set(actionUse,records);
 return true;
}
function rmFindCurrent({item,action}={}){
 if(!item||!action||item.actor?.documentName!=='Actor')return null;
 const candidates=[...RM_PENDING].filter(use=>use.item===item&&
  use.action===action&&!RM_COMPLETED.has(use)&&rmAuthorized(use));
 return candidates.length===1?candidates[0]:null;
}
function rmPrepareCurrent({item,action,attackIndex=0,penalty,reason}={}){
 const actionUse=rmFindCurrent({item,action});
 if(!actionUse)throw Error('No unique currently pending ActionUse for Item and Action.');
 return rmPrepare({actionUse,attackIndex,penalty,reason});
}
const rmUnits=unit=>{
 const s=String(unit??'').toLowerCase();
 return ['ft','feet','foot'].includes(s)?'ft':['m','meter','meters','metre','metres'].includes(s)?'m':null;
};
const rmCells=(token,grid)=>{
 try{
  const document=token?.document??token;
  // Foundry V13 TokenDocument API. getOccupiedCells() is not a V13
  // Token method; its use caused every normal-scene distance to be null.
  const offsets=document?.getOccupiedGridSpaceOffsets?.();
  if(Array.isArray(offsets)&&offsets.length&&typeof grid?.getCenterPoint==='function'){
   const points=offsets.map(offset=>grid.getCenterPoint(offset));
   if(points.every(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)))
    return points;
  }
  // Compatibility with independently provided grid-cell geometries.
  const cells=token?.getOccupiedCells?.()??token?.object?.getOccupiedCells?.();
  return cells&&typeof cells[Symbol.iterator]==='function'?[...cells]:null;
 }catch(_){return null}
};
function rmDistance(a,b,grid){
 const aa=rmCells(a,grid),bb=rmCells(b,grid);
 if(!aa?.length||!bb?.length||typeof grid?.measurePath!=='function')return null;
 let best=Infinity;
 for(const p of aa)for(const q of bb){
  const n=Number(grid.measurePath([p,q])?.distance);
  if(Number.isFinite(n)&&n>=0)best=Math.min(best,n);
 }
 return Number.isFinite(best)?best:null;
}
function rmSize(actor){
 const data=actor?.system?.traits?.size;
 const order={fine:0,diminutive:1,tiny:2,sm:3,small:3,med:4,medium:4,lg:5,large:5,huge:6,grg:7,gargantuan:7,col:8,colossal:8};
 // PF1 v11.11 exposes size as {base:"med",value:4}; the numeric
 // value is the prepared size (including temporary size changes).
 // Preserve support for older string-valued fixtures and integrations.
 if(typeof data==='string'){
  const key=data.toLowerCase();
  return Object.hasOwn(order,key)?order[key]:null;
 }
 if(!data||typeof data!=='object')return null;
 if(Number.isInteger(data.value)&&data.value>=0&&data.value<=8)
  return data.value;
 if(typeof data.value==='string'){
  const key=data.value.toLowerCase();
  if(Object.hasOwn(order,key))return order[key];
 }
 if(typeof data.base==='string'){
  const key=data.base.toLowerCase();
  if(Object.hasOwn(order,key))return order[key];
 }
 return null;
}
const rmFaction=token=>{
 const x=(token.document??token)?.disposition;
 return x===1||x===-1?x:null;
};
const rmTokenScene=token=>(token?.document??token)?.parent?.id??token?.scene?.id;
const rmInCombat=token=>[...(game.combat?.combatants??[])].some(c=>
 c?.tokenId===(token?.document??token)?.id||
 c?.token?.uuid===(token?.document??token)?.uuid);
function rmCanThreaten(actor){
 if(!actor||actor.system?.attributes?.hp?.value<=0)return false;
 const statuses=actor.statuses;
 if(['dead','unconscious','paralyzed','stunned','helpless','petrified']
  .some(x=>statuses?.has?.(x)))return false;
 const melee=rmItems(actor).some(item=>{
  // PF1 NPCs frequently represent natural strikes as attack Items, not
  // equipped manufactured weapons. A natural attack can threaten even
  // when item.system.equipped is absent.
  const natural=item.system?.subType==='natural';
  const armed=item.type==='weapon'&&item.system?.equipped===true;
  const nativeAttack=item.type==='attack';
  if(!natural&&!armed&&!nativeAttack)return false;
  const actions=item.actions?.contents??item.system?.actions??[];
  return natural||[...actions].some(action=>
   ['mwak','msak'].includes(action?.actionType));
 });
 // No known attack is NOT proof a creature cannot threaten.
 return melee?true:null;
}
function rmNaturalMeleeReach(actor){
 // PF1 11.11 prepares natural melee reach in getRollData().range.melee;
 // it does not populate system.attributes.reach on ordinary characters.
 // Use the PF1 computed value rather than guessing 5 ft from size.
 let prepared;
 try{prepared=actor?.getRollData?.()?.range?.melee}
 catch(error){rmReport('reach-warning',{actorUuid:actor?.uuid,
  reason:String(error?.message??error)})}
 const candidates=[prepared,
  actor?.system?.attributes?.naturalReach?.total,
  actor?.system?.attributes?.naturalReach?.value,
  actor?.system?.attributes?.reach?.total,
  actor?.system?.attributes?.reach];
 for(const value of candidates){
  if(value===null||value===undefined||value==='')continue;
  const n=Number(value);
  if(Number.isFinite(n)&&n>0)return n;
 }
 return null;
}
function rmThreatens(from,to,unit,grid){
 const actor=from.actor;
 if(!actor)return null;
 const able=rmCanThreaten(actor);
 if(able!==true)return able;
 const n=rmNaturalMeleeReach(actor);
 if(n===null)return null;
 const distance=rmDistance(from,to,grid);
 if(distance==null)return null;
 // PF1's table convention: 5 ft = 1.5 m.
 const pf1Metric=globalThis.pf1?.settings?.distance?.metric===true;
 const limit=unit===(pf1Metric?'m':'ft')?n:
  pf1Metric?n/0.3:n*0.3;
 return distance<=limit+1e-6;
}
function rmJudge({origin,target,allTokens,grid,sceneUnit}={}){
 const unit=rmUnits(sceneUnit);
 if(!origin||!target||!unit||!grid)return {status:'manual',reason:'missing token, grid or units'};
 const side=rmFaction(origin),enemy=rmFaction(target);
 if(side==null||enemy==null||side===enemy)return {status:'manual',reason:'faction relationship unverified'};
 const targetSize=rmSize(target.actor);
 if(targetSize==null)return {status:'manual',reason:'target size unknown'};
 const friends=(allTokens??[]).filter(t=>t!==origin&&t!==target&&rmFaction(t)===side);
 let ambiguity=false,penalties=[];
 const uncertain=[];
 for(const ally of friends){
  if(!rmInCombat(ally)||!rmInCombat(target))continue;
  const dist=rmDistance(ally,target,grid);
  if(dist==null){
   ambiguity=true;
   uncertain.push({ally:ally.name??ally.id,reason:'grid cells or path unavailable'});
   continue;
  }
  // An ally at 10 ft or farther cannot trigger this penalty, even
  // if it has exceptional reach. Do not require their threat data.
  if(dist>=(unit==='m'?3:10)-1e-6)continue;
  const aThreat=rmThreatens(ally,target,unit,grid);
  const tThreat=rmThreatens(target,ally,unit,grid);
  // PF1 engagement needs EITHER creature to threaten the other.
  // A verified true suffices even when the other creature's capability
  // is unknown (for example an unarmed ally facing an armed target).
  if(aThreat!==true&&tThreat!==true){
   if(aThreat===null||tThreat===null){
    ambiguity=true;
    uncertain.push({ally:ally.name??ally.id,
     reason:'melee threat or reach unknown',
     allyThreat:aThreat,targetThreat:tThreat,
     allyHasMeleeAttack:rmCanThreaten(ally.actor),
     targetHasMeleeAttack:rmCanThreaten(target.actor),
     allyReach:rmNaturalMeleeReach(ally.actor),
     targetReach:rmNaturalMeleeReach(target.actor),
     allyReachData:ally.actor?.getRollData?.()?.range??null,
     targetReachData:target.actor?.getRollData?.()?.range??null});
   }
   continue;
  }
  const allySize=rmSize(ally.actor);
  if(allySize==null){
   ambiguity=true;
   uncertain.push({ally:ally.name??ally.id,reason:'ally size unknown'});
   continue;
  }
  const delta=targetSize-allySize;
  penalties.push(delta>=3?0:delta===2?-2:-4);
 }
 if(ambiguity)return {status:'manual',
  reason:'uncertain threat or token geometry',uncertain};
 if(!penalties.length)return {status:'not-engaged',penalty:0};
 return {status:'engaged',penalty:Math.min(...penalties)};
}
function rmSelectTarget(use){
 const targets=[...(game.user?.targets??[])];
 if(targets.length!==1)return {reason:'multiple or missing targets'};
 const target=targets[0];
 const origin=use.token?.object??use.token;
 const scene=globalThis.canvas?.scene;
 if(!origin||!scene||!target||rmTokenScene(origin)!==scene.id||
    rmTokenScene(target)!==scene.id)return {reason:'target or shooter not in current scene'};
 return {origin,target,scene};
}
// Same pre-roll path as range-automation.js: PF1 forwards the shared
// attackBonus array into every native ChatAttack.addAttack(extraParts).
// Only a verified single-target COMMON penalty is added at this hook.
// Script Call overrides are discovered later when the native indexed
// attack list exists; they apply a temporary per-index DIFFERENCE.
function rmCreateUse(use){
 if(!rmAuthorized(use))return;
 RM_PENDING.add(use);
 if(!RM_PHASE.has(use))RM_PHASE.set(use,'created');
 if(!rmEnabled()||!rmIdentity(use)||!rmAttack(use))return;
 const shared=use.shared;
 if(!Array.isArray(shared?.attackBonus))return;
 const context=rmSelectTarget(use);
 if(context.reason){
  rmReport('manual',{reason:context.reason,stage:'pf1CreateActionUse'});
  return;
 }
 const decision=rmJudge({origin:context.origin,target:context.target,
  allTokens:canvas?.tokens?.placeables??[],grid:canvas.grid,
  sceneUnit:context.scene.grid?.units});
 if(decision.status!=='engaged'||!rmValid(decision.penalty)||
    decision.penalty===0||rmNativeManual(use)){
  rmReport(decision.status,{stage:'pf1CreateActionUse',
   reason:decision.reason??null,uncertain:decision.uncertain??[],
   penalty:decision.penalty??null,injected:false});
  return;
 }
 if(RM_COMMON.has(use))return;
 const part=String(decision.penalty)+'['+rmPenaltyLabel()+']';
 shared.attackBonus.push(part);
 RM_COMMON.set(use,{part,penalty:decision.penalty,targetId:
  context.target?.document?.uuid??context.target?.id,
  actorUuid:use.actor.uuid});
 rmReport('engaged',{stage:'pf1CreateActionUse',
  penalty:decision.penalty,injected:true,target:context.target?.name});
}
function rmNativeManual(use){
 const form=use?.formData??use?.shared?.formData??{};
 const configs=[use?.shared?.useOptions??{},use?.shared?.config??{}];
 const explicitlySet=[
  form['ranged-melee-penalty'],form['shooting-into-melee'],form['shoot-into-melee'],
  ...configs.map(x=>x.rangedMeleePenalty)
 ].some(x=>x!==undefined&&x!==null&&x!=='');
 if(explicitlySet)return true;
 // Generic native attack bonus may contain the already-entered -4;
 // prefer manual resolution rather than charging twice.
 return typeof form['attack-bonus']==='string'&&form['attack-bonus'].trim().length>0;
}
async function rmManualPrompt(target){
 const DialogV2=globalThis.foundry?.applications?.api?.DialogV2;
 if(typeof DialogV2?.wait!=='function')return null;
 const name=String(target?.name??'Target').replace(/[&<>"]/g,ch=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
 const result=await DialogV2.wait({
  window:{title:'Shooting into Melee — PF1AE'},
  content:'<p>Engagement cannot be determined reliably for <strong>'+
    name+'</strong>. Choose the shooting-into-melee penalty for this '+
    'one-target ActionUse (before any dice roll).</p>',
  buttons:[
   {action:'none',label:'No penalty (0)',callback:()=>0},
   {action:'reduced',label:'−2',callback:()=>-2},
   {action:'normal',label:'−4',callback:()=>-4},
   {action:'manual',label:'Do not modify',callback:()=>null}
  ],
  rejectClose:false,modal:true
 });
 return [0,-2,-4].includes(result)?result:null;
}
async function rmNativeScripts(use){
 const owner=use.actor;
 for(const item of rmItems(owner)){
  const candidates=rmCalls(item).filter(c=>c.name===RM_SCRIPT&&c.category==='toggle'&&
   typeof c.execute==='function');
  if(candidates.length!==1)continue;
  const call=candidates[0];
  if(game.user.isGM&&[...game.users].some(u=>!u.isGM&&
     owner.testUserPermission?.(u,'OWNER'))){
   const check=game.modules.get(RM_NS)?.api?.scriptApprovals?.check;
   if(typeof check!=='function'||check(owner,item,call)?.approved!==true){
    rmReport('override-refused',{reason:'unapproved GM fallback',itemUuid:item.uuid});
    continue;
   }
  }
  const scope=Object.freeze({
   actionUse:use,actorUuid:owner.uuid,itemUuid:item.uuid,
   override({attackIndex=0,penalty,reason=RM_SCRIPT}={}){
    if(item.actor?.uuid!==owner.uuid||!rmAuthorized(use))
     throw Error('Script Call actor and item identity changed');
    return rmPrepare({actionUse:use,attackIndex,penalty,reason});
   }
  });
  try{await call.execute({action:null},{rangedMelee:scope,state:null})}
  catch(error){rmReport('override-refused',{reason:String(error?.message??error),itemUuid:item.uuid})}
 }
}
async function rmBeforeRoll(use,wrapped,args){
 const phase=RM_PHASE.get(use);
 // A completed ActionUse may be invoked natively again, but never reuse
 // PF1AE overrides. A concurrent invocation on the SAME use must not
 // start another native d20 sequence while scripts are still preparing.
 if(phase==='preparing'||phase==='rolling')
  throw Error('Attack already rolling or being prepared.');
 if(phase==='completed'||RM_COMPLETED.has(use))
  return wrapped(...args);
 if(!rmEnabled()||!rmIdentity(use)||!rmAttack(use)||
    !Array.isArray(use.shared?.attacks)||phase!=='created'){
  if(!rmEnabled()||!rmIdentity(use)||!rmAttack(use))rmRemoveCommon(use);
  // A registered use remains closed even when the setting was disabled
  // before the roll, or when native attack preparation was cancelled.
  if(phase==='created'){
   RM_PHASE.set(use,'rolling');
   try{return await wrapped(...args)}
   finally{rmCleanup(use)}
  }
  return wrapped(...args);
 }
 // Set phase synchronously before any await. This prevents a second
 // addAttacks() invocation from racing during an async Script Call.
 RM_PHASE.set(use,'preparing');
 const attacks=use.shared.attacks;
 const context=rmSelectTarget(use);
 let decision=context.reason?{status:'manual',reason:context.reason}:
  rmJudge({origin:context.origin,target:context.target,
   allTokens:canvas?.tokens?.placeables??[],grid:canvas.grid,
   sceneUnit:context.scene.grid?.units});
 // A change of target, geometry or engagement between create and roll
 // invalidates the early shared bonus. The late path handles the new
 // evidence per index, without leaving a stale common -4.
 let common=RM_COMMON.get(use)??null;
 const targetId=context.target?.document?.uuid??context.target?.id;
 if(common&&(
  common.actorUuid!==use.actor.uuid||common.targetId!==targetId||
  decision.status!=='engaged'||decision.penalty!==common.penalty)){
  rmRemoveCommon(use);common=null;
 }
 await rmNativeScripts(use);
 const overrides=RM_OVERRIDES.get(use)??new Map();
 if(rmNativeManual(use)){
  rmRemoveCommon(use);
  rmReport('native-manual',{reason:'explicit native attack bonus or melee modifier'});
  RM_PHASE.set(use,'rolling');
  try{return await wrapped(...args)}
  finally{rmCleanup(use)}
 }
 if(decision.status==='manual'&&context.target&&overrides.size===0&&
    game.settings.get(RM_NS,'manualRangedMeleePrompt')===true){
  try{
   const selected=await rmManualPrompt(context.target);
   if(selected!==null)
    decision={status:'manual-choice',penalty:selected,
     reason:'explicit user selection after ambiguous engagement'};
  }catch(error){
   rmReport('manual',{reason:'manual dialog unavailable: '+String(error?.message??error)});
  }
 }
 const original=attacks.map(a=>a.attackBonus);
 const changed=[];
 try{
  for(let index=0;index<attacks.length;index++){
   if(attacks[index].type==='manyshot')continue;
   const chosen=overrides.get(index);
   if(decision.status!=='engaged'&&decision.status!=='manual-choice')continue;
   const effective=chosen?chosen.penalty:decision.penalty;
   if(effective==null)continue;
   // With a common -4 already injected into shared.attackBonus,
   // Precise Shot (effective 0) becomes a +4 per-index correction.
   // Without one, the index receives the full -4/-2 as before.
   const delta=effective-(common?.penalty??0);
   if(!Number.isSafeInteger(delta)||delta===0)continue;
   const before=String(attacks[index].attackBonus??'').trim();
   const label=rmPenaltyLabel();
   attacks[index].attackBonus=(before?before+' + ':'')+
    '('+(delta>0?'+':'')+delta+')['+label+']';
   changed.push(index);
  }
  rmReport(decision.status,{penalty:decision.penalty??null,
   commonPenalty:common?.penalty??0,appliedIndices:changed,
   overrides:[...overrides.keys()],target:context.target?.name??null,
   reason:decision.reason??null,uncertain:decision.uncertain??[],
   stage:'addAttacks'});
  RM_PHASE.set(use,'rolling');
  return await wrapped(...args);
 }finally{
  attacks.forEach((a,i)=>{a.attackBonus=original[i]});
  rmCleanup(use);
 }
}
function rmInstall(){
 const C=globalThis.pf1?.actionUse?.ActionUse;
 const proto=C?.prototype;
 if(typeof proto?.addAttacks!=='function'){
  rmReport('unavailable',{reason:'PF1 ActionUse.addAttacks not found'});return;
 }
 const original=proto.addAttacks;
 if(original.pf1aeRangedMeleeWrapped)return;
 const handler=async function(...args){return rmBeforeRoll(this,original.bind(this),args)};
 handler.pf1aeRangedMeleeWrapped=true;
 proto.addAttacks=handler;
}
Hooks.once('init',()=>{
 game.settings.register(RM_NS,RM_SETTING,{
  name:game.i18n?.localize?.('PF1AE.Settings.RangedMelee.Name')??'Automatic shooting into melee penalty',
  hint:game.i18n?.localize?.('PF1AE.Settings.RangedMelee.Hint')??'Apply verified Pathfinder 1e engagement penalties before ranged attack dice; ambiguous cases require manual resolution.',
  scope:'world',config:true,restricted:true,type:Boolean,default:true
 });
 game.settings.register(RM_NS,'manualRangedMeleePrompt',{
  name:game.i18n?.localize?.('PF1AE.Settings.RangedMeleePrompt.Name')??'Ask when melee engagement is uncertain',
  hint:game.i18n?.localize?.('PF1AE.Settings.RangedMeleePrompt.Hint')??'Before rolling against one target, ask for 0 / -2 / -4 if engagement cannot be verified. Multi-target ambiguity is never guessed.',
  scope:'world',config:true,restricted:true,type:Boolean,default:true
 });
 Hooks.on('pf1CreateActionUse',use=>{
  try{rmCreateUse(use)}
  catch(error){rmRemoveCommon(use);
   rmReport('exception',{stage:'pf1CreateActionUse',reason:String(error?.message??error)});
   console.warn('[PF1AE][RangedMelee] Pre-roll preparation failed',error);
  }
 });
 Hooks.on('pf1PostActionUse',use=>rmCleanup(use));
});
Hooks.once('ready',()=>{
 const mod=game.modules.get(RM_NS);if(!mod)return;
 mod.api??={};
 mod.api.rangedMelee=Object.freeze({
  prepareAttackOverride:rmPrepare,prepareForCurrentUse:rmPrepareCurrent,
  cancelPreparedAttackOverride({actionUse,attackIndex}={}){
   if(!rmAuthorized(actionUse))return false;
   if(attackIndex===undefined){rmCleanup(actionUse);return true}
   return RM_OVERRIDES.get(actionUse)?.delete(attackIndex)??false;
  },
  lastDiagnostic:()=>RM_DIAGNOSTIC?{...RM_DIAGNOSTIC}:null,
  judge:rmJudge
 });
 rmInstall();
});
