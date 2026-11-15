/**
 * PF1AE — shooting into melee. Foundry v13 / PF1 v11.11.
 * Native ActionUse.addAttacks() prepares shared.attacks[index].attackBonus
 * just before ChatAttack.addAttack evaluates each roll.
 * Fail closed on uncertain threats, alliances and per-index targets.
 */
const RM_NS='pf1-automation-engine',RM_SETTING='autoRangedMeleePenalty';
const RM_SCRIPT='PF1AE:rangedMelee:override';
const RM_OVERRIDES=new WeakMap(),RM_COMPLETED=new WeakSet();
const RM_COMMON=new WeakMap();
const RM_PENDING=new Set();
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
};
const rmItems=actor=>[...(actor?.items?.contents??actor?.items?.values?.()??[])];
const rmCalls=item=>[...(item?.scriptCalls?.contents??item?.scriptCalls?.values?.()??[])];
const rmValid=penalty=>Number.isSafeInteger(penalty)&&penalty>=-20&&penalty<=0;
function rmPrepare({actionUse,attackIndex=0,penalty,reason='external-script'}={}){
 if(!rmIdentity(actionUse)||!rmAttack(actionUse))
  throw Error('A permitted native ranged attack ActionUse is required.');
 if(!Number.isSafeInteger(attackIndex)||attackIndex<0||attackIndex>99||!rmValid(penalty))
  throw Error('Invalid attack index or ranged melee penalty.');
 if(RM_COMPLETED.has(actionUse)||actionUse?.shared?.chatAttacks?.length||
    actionUse?.shared?.rollData?.attackCount!=null)
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
const rmCells=token=>{
 try{
  const cells=token?.getOccupiedCells?.()??token?.object?.getOccupiedCells?.();
  return cells&&typeof cells[Symbol.iterator]==='function'?[...cells]:null;
 }catch(_){return null}
};
function rmDistance(a,b,grid){
 const aa=rmCells(a),bb=rmCells(b);
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
 return typeof data==='string'&&Object.hasOwn(order,data.toLowerCase())?order[data.toLowerCase()]:null;
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
 const weapons=rmItems(actor).filter(i=>
  i.type==='weapon'&&i.system?.equipped===true&&
  (i.system?.subType==='natural'||
   i.actions?.contents?.some(a=>['mwak','msak'].includes(a.actionType))||
   i.system?.actions?.some(a=>['mwak','msak'].includes(a.actionType))));
 // Unknown melee threat is NOT proof of no engagement.
 return weapons.length>0?true:null;
}
function rmThreatens(from,to,unit,grid){
 const actor=from.actor;
 if(!actor)return null;
 const able=rmCanThreaten(actor);
 if(able!==true)return able;
 const reach=actor.system?.attributes?.reach;
 const n=Number(typeof reach==='object'?reach?.total:reach);
 if(!Number.isFinite(n)||n<=0)return null;
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
 for(const ally of friends){
  if(!rmInCombat(ally)||!rmInCombat(target))continue;
  const dist=rmDistance(ally,target,grid);
  if(dist==null){ambiguity=true;continue;}
  // An ally at 10 ft or farther cannot trigger this penalty, even
  // if it has exceptional reach. Do not require their threat data.
  if(dist>=(unit==='m'?3:10)-1e-6)continue;
  const aThreat=rmThreatens(ally,target,unit,grid);
  const tThreat=rmThreatens(target,ally,unit,grid);
  // PF1 engagement needs EITHER creature to threaten the other.
  // A verified true suffices even when the other creature's capability
  // is unknown (for example an unarmed ally facing an armed target).
  if(aThreat!==true&&tThreat!==true){
   if(aThreat===null||tThreat===null)ambiguity=true;
   continue;
  }
  const allySize=rmSize(ally.actor);
  if(allySize==null){ambiguity=true;continue;}
  const delta=targetSize-allySize;
  penalties.push(delta>=3?0:delta===2?-2:-4);
 }
 if(ambiguity)return {status:'manual',reason:'uncertain threat or token geometry'};
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
   reason:decision.reason??null,penalty:decision.penalty??null,
   injected:false});
  return;
 }
 if(RM_COMMON.has(use))return;
 const part=String(decision.penalty)+'[PF1AE Shooting into Melee]';
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
 if(!rmEnabled()||!rmIdentity(use)||!rmAttack(use)||RM_COMPLETED.has(use)||
    !Array.isArray(use.shared?.attacks)){
  // If the setting was disabled after creation or a once-valid ActionUse
  // became invalid, never leave a previously injected common modifier.
  if(!rmEnabled()||!rmIdentity(use)||!rmAttack(use))rmRemoveCommon(use);
  return wrapped(...args);
 }
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
  rmCleanup(use);return wrapped(...args);
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
   const label=common?'PF1AE Shooting into Melee Override':
    'PF1AE Shooting into Melee';
   attacks[index].attackBonus=(before?before+' + ':'')+
    '('+delta+')['+label+']';
   changed.push(index);
  }
  rmReport(decision.status,{penalty:decision.penalty??null,
   commonPenalty:common?.penalty??0,appliedIndices:changed,
   overrides:[...overrides.keys()],target:context.target?.name??null,
   reason:decision.reason??null,stage:'addAttacks'});
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
  name:'PF1AE: Automatic shooting into melee penalty',
  hint:'Apply verified Pathfinder 1e engagement penalties before ranged attack dice; ambiguous cases require manual resolution.',
  scope:'world',config:true,restricted:true,type:Boolean,default:true
 });
 game.settings.register(RM_NS,'manualRangedMeleePrompt',{
  name:'PF1AE: Ask when melee engagement is uncertain',
  hint:'Before rolling against one target, ask for 0 / -2 / -4 if engagement cannot be verified. Multi-target ambiguity is never guessed.',
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
