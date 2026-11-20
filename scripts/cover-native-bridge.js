/**
 * PF1AE native cover bridge for PF1 11.11.
 *
 * Intercept createAttackDialog on each ActionUse via pf1CreateActionUse,
 * so forbidden uses exit before attack rolls and resource expenditure.
 * PF1 11.11 triggers that hook inside process, after autoSelectAmmo.
 * Native pf1PreActionUse remains a secondary post-dialog safety gate.
 * Cancel ONLY proven single-target direct attacks. Never guess uncertainty.
 *
 * Post-action: annotate the existing PF1 ChatMessage with the evaluated
 * target-specific effective AC, never alter the Actor's native AC and
 * never create an additional ChatMessage or roll.
 */
const CB_NS="pf1-automation-engine";
const CB_MAX=120;
const cbDoc=value=>value?.document??value;
const cbToken=value=>{
 const d=cbDoc(value);
 if(d?.documentName==="Token"||d?.documentName==="TokenDocument"||
   (typeof d?.uuid==="string"&&d?.parent?.id&&
    typeof d?.x==="number"&&typeof d?.y==="number"))
  return value?.object??value;
 return null;
};
const cbList=value=>Array.isArray(value)?value:
 value?.contents&&Array.isArray(value.contents)?value.contents:
 typeof value?.values==="function"?[...value.values()]:[];
const cbEnable=()=>{
 try{return game.modules.get(CB_NS)?.active===true&&
  game.settings.get(CB_NS,"genericEnabled")===true}
 catch(_){return false}
};
function cbGeometry(actionUse){
 const action=actionUse?.action??actionUse?.shared?.action;
 if(!action||action.hasAttack!==true||
   action.isCombatManeuver===true||
   globalThis.pf1?.config?.maneuverActionTypes?.has?.(action.actionType))
  return null;
 const kind=["rwak","rsak","twak"].includes(action.actionType)?"ranged":
  ["mwak","msak"].includes(action.actionType)?"melee":null;
 if(!kind)return null;
 const actor=actionUse?.actor??action?.actor??action?.item?.actor;
 if(!actor?.uuid)return null;
 const raw=cbList(actionUse?.shared?.targets??actionUse?.targets);
 // Explicit action-use targets are preferred; only fall back to exactly one
 // current user target if PF1 has not yet collected its target list.
 const selected=raw.length?raw:cbList(game.user?.targets);
 if(selected.length!==1)return null;
 const target=cbToken(selected[0]);
 if(!target?.document?.uuid||target?.actor?.uuid===actor.uuid)return null;
 const candidate=cbToken(actionUse?.token);
 // A TokenDocument without a canvas placeable may lack actor provenance;
 // never select it over the one real active token for this Actor.
 const source=candidate?.actor?.uuid===actor.uuid?candidate:null;
 const active=actor.getActiveTokens?.()??[];
 const attacker=source??(active.length===1?cbToken(active[0]):null);
 if(!attacker?.document?.uuid||attacker.actor?.uuid!==actor.uuid)return null;
 const cover=game.modules.get(CB_NS)?.api?.coverPF1;
 if(!cover?.inspect)return null;
 let assessment;
 try{assessment=cover.inspect({attacker,target,attackType:kind})}
 catch(error){console.warn("[PF1AE][CoverBridge] Pre-attack assessment error",error);return null}
 return {assessment,attacker,target,kind};
}
/**
 * PF1 11.11 calls pf1CreateActionUse via callAll (not cancellable), then
 * opens AttackDialog, rolls attacks, and only then calls pf1PreActionUse.
 * Attach an instance-local createAttackDialog guard via pf1CreateActionUse.
 * The system has already entered process() by the time this hook runs.
 * Never replace ActionUse.prototype.process, which other modules wrap.
 *
 * Return undefined, the same return shape as cancelling the native dialog.
 * Do not invoke wrapped/original: no ammo, charge, attack, or chat writes.
 */
function cbTotalBlocked(actionUse){
 if(!cbEnable())return false;
 const assessment=cbGeometry(actionUse)?.assessment;
 return assessment?.status==="confirmed"&&assessment?.type==="total"&&
  assessment?.preventsDirectAttack===true;
}
function cbOutOfRange(actionUse){
 if(!cbEnable())return false;
 const api=game.modules.get(CB_NS)?.api?.actionRange;
 if(typeof api?.inspectActionUse!=="function")return false;
 try{return ["out-of-reach","out-of-range"].includes(
  api.inspectActionUse(actionUse)?.status)}
 catch(error){
  console.warn("[PF1AE][ActionRange] Conservative check unavailable",error);
  return false;
 }
}
function cbNotifyOutOfRange(){
 const key="PF1AE.ActionRange.OutOfRange";
 const localized=game.i18n?.localize?.(key);
 ui.notifications?.warn?.(localized&&localized!==key?
  localized:"Target is beyond this action's maximum range. Action cancelled.");
}
function cbNotifyBlocked(){
 const message=game.i18n?.localize?.("PF1AE.Cover.TotalBlocked")??
  "Total cover: no direct line of effect. Attack cancelled.";
 ui.notifications?.warn?.(message);
}
// PF1 11.11 raises pf1CreateActionUse INSIDE process(), after autoSelectAmmo
// and immediately before generateAttacks and createAttackDialog.
// Replacing process here is too late. Replace only createAttackDialog on the
// instance so a rejected action returns null (native 'dialog cancelled') before
// rolls, post-use scripts and resource deductions. Never change the prototype
// or register a libWrapper wrapper on ActionUse.process.
const CB_INSTANCE_GUARDS=new WeakSet();
let cbGateInstallation=null;
function cbAttachEarlyGate(actionUse){
 if(!actionUse||typeof actionUse!=="object"||
  CB_INSTANCE_GUARDS.has(actionUse)||
  typeof actionUse.createAttackDialog!=="function")return false;
 const native=actionUse.createAttackDialog;
 const guarded=async function(...args){
  if(cbTotalBlocked(this)){cbNotifyBlocked();return null}
  if(cbOutOfRange(this)){cbNotifyOutOfRange();return null}
  return native.apply(this,args);
 };
 try{
  Object.defineProperty(actionUse,"createAttackDialog",{
   value:guarded,writable:true,configurable:true,enumerable:false
  });
  CB_INSTANCE_GUARDS.add(actionUse);
  return true;
 }catch(error){
  console.warn("[PF1AE][EarlyGate] ActionUse dialog could not be guarded",error);
  return false;
 }
}
function cbInstallEarlyGate(){
 if(cbGateInstallation)return;
 Hooks.on("pf1CreateActionUse",cbAttachEarlyGate);
 cbGateInstallation="native-dialog-hook";
}
function cbPreActionUse(actionUse){
 // Fallback safety check for integrations bypassing ActionUse.process.
 if(cbTotalBlocked(actionUse)){
  cbNotifyBlocked();
  return false;
 }
 if(cbOutOfRange(actionUse)){
  cbNotifyOutOfRange();
  return false;
 }
}
const cbNumber=n=>typeof n==="number"&&Number.isFinite(n)?n:null;
const CB_CHAT_QUEUES=new Map();
const cbLabel=(key,fallback)=>{
 const value=game.i18n?.localize?.(key);
 return typeof value==="string"&&value!==key?value:fallback;
};
function cbKey(event,result){
 const uuid=result?.targetTokenUuid;
 const index=event?.rollIndex;
 if(typeof uuid!=="string"||!/^[A-Za-z0-9_.-]{1,200}$/.test(uuid)||
  !Number.isSafeInteger(index)||index<0||index>99)return null;
 return String(index)+":"+uuid;
}
function cbPresentation(event){
 if(!event||!event.sourceMessageId||
   !Array.isArray(event.targetResults)||event.targetResults.length!==1)return null;
 const result=event.targetResults[0];
 const key=cbKey(event,result);
 if(!key||!result?.coverDiagnosis)return null;
 const cover=result.coverDiagnosis,defense=result.defense;
 // Uncertain cover is displayed as a diagnostic, never as a guessed +4.
 // This is important around dock edges, roof and wall corners where
 // native token sight alone cannot prove a PF1 cover bonus.
 const uncertain=cover.status==="uncertain";
 if(!uncertain&&(cover.status!=="confirmed"||
    !["normal","soft","total"].includes(cover.type)))return null;
 const isTotal=!uncertain&&cover.type==="total"&&cover.preventsDirectAttack===true;
 const native=cbNumber(defense?.baseValue);
 const effective=cbNumber(defense?.value);
 const declared=cbNumber(cover.acBonus);
 const added=cbNumber(defense?.coverBonus);
 if(!isTotal&&native===null)return null;
 // Display ONLY a previously evaluated defense. Never recompute a new
 // combat outcome by adding cover to sheet AC here: native cover can
 // already be part of the sheet total and source provenance can be unknown.
 const title=cbLabel("PF1AE.Cover.CardTitle","PF1AE — cover");
 const nativeLabel=cbLabel("PF1AE.Cover.NativeAC","Native AC");
 const effectiveLabel=cbLabel("PF1AE.Cover.EffectiveAC","Target AC incl. cover");
 const bonusLabel=cbLabel("PF1AE.Cover.CoverBonus","Cover bonus");
 const includedLabel=cbLabel("PF1AE.Cover.AlreadyIncluded","Already included in native AC");
 const uncertainLabel=cbLabel("PF1AE.Cover.PendingAC","Unverified (GM review)");
 const estimateLabel=cbLabel("PF1AE.Cover.EstimatedAC","Indicative AC with cover");
 const estimateWarning=cbLabel("PF1AE.Cover.EstimatedACWarning",
  "Not verified: the native AC may already contain cover or other uncertain bonuses");
 const blocked=cbLabel("PF1AE.Cover.TotalCardWarning",
  "Total cover: direct attack is blocked");
 const attackLabel=cbLabel("PF1AE.Cover.AttackNumber","Attack");
 const suffix=' · '+attackLabel+' '+String(event.rollIndex+1);
 let content;
 if(isTotal){
  content='<strong>'+blocked+'</strong>';
 }else if(uncertain){
  content='<strong>'+effectiveLabel+': '+uncertainLabel+'</strong>'+
   '<div>'+nativeLabel+': '+String(native)+
   ' · '+cbLabel("PF1AE.Cover.UncertainGeometry","Cover geometry cannot be verified")+'</div>';
 }else{
  const bonus=declared===null?'?':'+'+String(declared);
  const included=effective!==null&&declared!==null&&added===0&&declared>0;
  // Present an explicitly NON-AUTHORITATIVE arithmetic estimate if the
  // spatial cover is proved but native source provenance is ambiguous.
  // Never turn this into defense.value or resolve a hit/miss from it.
  // Existing PF1 AC may already include an untyped cover bonus.
  const indicative=effective===null&&declared!==null&&declared>=0&&
   defense?.uncertain===true&&native!==null&&
   !defense?.coverAssessment?.preventsDirectAttack;
  const estimate=indicative?native+declared:null;
  const actual=effective===null?uncertainLabel:String(effective);
  content=indicative?
   '<strong>'+estimateLabel+': '+String(estimate)+'</strong>'+
   '<div>'+nativeLabel+': '+String(native)+' · '+bonusLabel+': '+bonus+'</div>'+
   '<div>'+estimateWarning+'</div>':
   '<strong>'+effectiveLabel+': '+actual+'</strong>'+
   '<div>'+nativeLabel+': '+String(native)+
   ' · '+bonusLabel+': '+bonus+
   (included?' ('+includedLabel+')':'')+'</div>';
 }
 return '<section class="pf1ae-cover-result" data-pf1ae-cover="1" '+
  'data-pf1ae-cover-key="'+key+'" '+
  'style="border-top:1px solid var(--color-border-light-primary,#999);'+
  'margin-top:0.5rem;padding-top:0.4rem">'+
  '<strong>'+title+suffix+'</strong><div>'+content+'</div></section>';
}
/**
 * Update only the displayed defense number within the native PF1 target
 * miniature. The card template has:
 *   .attack-targets > .target[data-uuid] .ac .normal > span.value
 * Its other siblings are touch and flatFooted: never rewrite those when
 * changing normal AC. This string transform runs on the persistent
 * ChatMessage.content, so Foundry rerenders retain the new display.
 *
 * Restrict to the exact UUID and to a native numeric value equal to the
 * already-resolved baseline AC. This avoids rewriting unrelated chat HTML
 * or an unrelated target (and avoids double application on repeat events).
 * First roll owns the summary thumbnail for a multiattack card; individual
 * attack outcomes keep their distinct values in the PF1AE footnotes.
 */
/**
 * Display-only cover adjustment of the three PF1 native AC figures. Native
 * Actor values are read, never mutated. Existing explicit 'cover' entries
 * are subtracted PER defense type; the same +4 cannot be counted twice.
 * The first attack owns the target summary thumbnail. Later full-attack
 * rolls retain their individual detailed defense lines.
 */
function cbNativeThumbnailValues(event){
 const entry=event?.targetResults?.[0],cover=entry?.coverDiagnosis;
 if(event?.rollIndex!==0||event?.targetResults?.length!==1||
    cover?.status!=="confirmed"||
    !["normal","soft"].includes(cover.type))return null;
 const uuid=entry.targetTokenUuid;
 const tokens=globalThis.canvas?.tokens?.placeables??[];
 const token=tokens.find(t=>t?.document?.uuid===uuid);
 const actor=token?.actor;
 const bonus=cbNumber(cover.acBonus);
 const values={};
 if(actor&&bonus!==null&&bonus>=0){
  const provenance=game.modules.get(CB_NS)?.api?.nativeCover;
  for(const type of ["normal","touch","flatFooted"]){
   const base=cbNumber(actor.system?.attributes?.ac?.[type]?.total);
   if(base===null)continue;
   // No guessing when a typed native cover source is ambiguous.
   let existing;
   try{existing=provenance?.inspect?.({actor,defense:type})}
   catch(_){continue}
   if(existing?.status!=="resolved"||cbNumber(existing.nativeCover)===null)
    continue;
   values[type]={base,effective:base+Math.max(0,bonus-existing.nativeCover)};
  }
 }
 // The resolved defense is authoritative for the attack's actual AC
 // type and remains available even if the token placeable is missing.
 const defense=entry.defense,type=defense?.type??"normal";
 const base=cbNumber(defense?.baseValue),effective=cbNumber(defense?.value);
 if(["normal","touch","flatFooted"].includes(type)&&
    base!==null&&effective!==null){
  // An authoritative resolved total wins over read-only estimation.
  values[type]={base,effective};
 }
 return Object.keys(values).length?values:null;
}
function cbPatchOneDefense(source,event,defenseType,base,effective){
 if(base===effective)return source;
 const uuid=event.targetResults[0].targetTokenUuid;
 if(typeof uuid!=="string")return source;
 const open=/<div\\b[^>]*>/gi;
 const targets=[];
 let match;
 while((match=open.exec(source))){
  const tag=match[0];
  const classes=tag.match(/\\bclass\\s*=\\s*(["'])(.*?)\\1/i)?.[2]??"";
  if(!classes.split(/\\s+/).includes("target"))continue;
  const id=tag.match(/\\bdata-uuid\\s*=\\s*(["'])(.*?)\\1/i)?.[2];
  if(id!==uuid)continue;
  targets.push({start:match.index,after:open.lastIndex});
 }
 if(targets.length!==1)return source;
 const regionStart=targets[0].after;
 const next=source.slice(regionStart).search(
  /<div\\b[^>]*\\bclass\\s*=\\s*["'][^"']*\\btarget\\b[^"']*["'][^>]*>/i);
 const regionEnd=next<0?source.length:regionStart+next;
 const region=source.slice(regionStart,regionEnd);
 const acTag=/<div\\b[^>]*\\bclass\\s*=\\s*(["'])[^"']*\\bac\\b[^"']*\\1[^>]*>/i.exec(region);
 if(!acTag)return source;
 const acRegion=region.slice(acTag.index+acTag[0].length);
 const defenseTags=[...acRegion.matchAll(/<div\\b[^>]*\\bclass\\s*=\\s*(["'])([^"']*)\\1[^>]*>/gi)];
 const found=defenseTags.find(t=>t[2].split(/\\s+/).includes(defenseType));
 if(!found)return source;
 const after=acRegion.slice(found.index+found[0].length);
 const span=/<span\\b([^>]*\\bclass\\s*=\\s*(["'])[^"']*\\bvalue\\b[^"']*\\2[^>]*)>(\\s*)(-?\\d+)(\\s*)<\\/span>/i.exec(after);
 if(!span||after.slice(0,span.index).includes("<div")||
    Number(span[4])!==base)return source;
 const absoluteStart=regionStart+acTag.index+acTag[0].length+
  found.index+found[0].length+span.index;
 const title=cbLabel("PF1AE.Cover.ThumbnailTitle","AC with cover");
 const safeTitle=String(title).replace(/[&"<>]/g,c=>
  ({"&":"&amp;",'"':"&quot;","<":"&lt;",">":"&gt;"}[c]));
 const changed='<span'+span[1]+' data-pf1ae-cover-native-ac="'+base+
  '" title="'+safeTitle+': '+effective+'">'+span[3]+effective+
  span[5]+'</span>';
 return source.slice(0,absoluteStart)+changed+
  source.slice(absoluteStart+span[0].length);
}
function cbPatchTargetAC(source,event){
 if(typeof source!=="string")return source;
 const values=cbNativeThumbnailValues(event);
 if(!values)return source;
 let result=source;
 for(const type of ["normal","touch","flatFooted"]){
  const data=values[type];
  if(data)result=cbPatchOneDefense(result,event,type,data.base,data.effective);
 }
 return result;
}
async function cbOnResolved(event,messageOverride=null){
 if(!cbEnable()||!event?.sourceMessageId)return;
 const section=cbPresentation(event);
 if(!section)return;
 const messageId=event.sourceMessageId;
 const prior=CB_CHAT_QUEUES.get(messageId)??Promise.resolve();
 // Full attacks dispatch multiple resolution hooks without awaiting the
 // callback. Serialize updates so every attack has its own CA display and
 // no two writes overwrite each other.
 const operation=prior.catch(()=>{}).then(async()=>{
  const card=messageOverride?.id===messageId?messageOverride:
   game.messages?.get?.(messageId);
  if(!card||card.documentName!=="ChatMessage"||
   typeof card.content!=="string"||typeof card.update!=="function")return;
  if(!game.user?.isGM&&card.user?.id!==game.user?.id&&
     card.user!==game.user?.id)return;
  const source=card.content;
  const key=cbKey(event,event.targetResults?.[0]);
  if(!key)return;
  const already=source.includes('data-pf1ae-cover-key="'+key+'"');
  const content=cbPatchTargetAC(source,event)+(already?"":section);
  if(content===source)return;
  try{await card.update({content})}
  catch(error){console.warn("[PF1AE][CoverBridge] Card annotation unavailable",error)}
 });
 CB_CHAT_QUEUES.set(messageId,operation);
 void operation.finally(()=>{
  if(CB_CHAT_QUEUES.get(messageId)===operation)CB_CHAT_QUEUES.delete(messageId);
 });
 await operation;
}
/**
 * Direct post-use fallback for PF1 native chat cards.
 *
 * The previous chat display depended solely on the secondary
 * pf1AttackRoll -> pf1aeAttackResolution event chain. Some native PF1
 * attacks create a valid card without exposing the expected paired roll
 * event to PF1AE, so no cover line was shown at all. This hook has the
 * actual completed ActionUse and ChatMessage and only computes a read-only
 * target defense. Existing detailed per-roll events still work.
 */
async function cbOnNativePostUse(actionUse,message){
 if(!cbEnable()||message?.documentName!=="ChatMessage"||
    typeof message?.id!=="string")return;
 const action=actionUse?.action??actionUse?.shared?.action;
 const actor=actionUse?.actor??action?.actor??action?.item?.actor;
 if(!action||!actor?.uuid)return;
 const geometry=cbGeometry(actionUse);
 if(!geometry?.target?.actor?.uuid||!geometry.assessment)return;
 const cover=geometry.assessment;
 if(cover.status!=="confirmed"&&cover.status!=="uncertain")return;
 if(cover.status==="confirmed"&&
    !["normal","soft"].includes(cover.type))return;
 const api=game.modules.get(CB_NS)?.api?.attackResolution;
 if(typeof api?.resolveAttack!=="function")return;
 let defense=null;
 try{
  const evaluated=await api.resolveAttack({
   actor,action,actionUse,targetActor:geometry.target.actor,
   targetToken:geometry.target,
   ...(cover.status==="confirmed"?{coverAssessment:cover}:{})
  });
  defense=evaluated?.defense??null;
 }catch(error){
  console.warn("[PF1AE][CoverBridge] Native cover defense unavailable",error);
  return;
 }
 const tokenUuid=geometry.target.document?.uuid;
 if(!tokenUuid||!defense)return;
 const event={
  sourceMessageId:message.id,rollIndex:0,
  targetResults:[{targetTokenUuid:tokenUuid,coverDiagnosis:cover,
   defense}]
 };
 // Reuse the serialized, deduplicated normal chat writer. If the richer
 // attack event was already written, this fallback does nothing.
 await cbOnResolved(event,message);
}
Hooks.once("init",cbInstallEarlyGate);
Hooks.on("pf1PreActionUse",cbPreActionUse);
Hooks.on("pf1aeAttackResolution",event=>{void cbOnResolved(event)});
Hooks.on("pf1PostActionUse",(use,message)=>{
 void cbOnNativePostUse(use,message).catch(error=>
  console.warn("[PF1AE][CoverBridge] Native post-use fallback failed",error));
});
Hooks.once("ready",()=>{
 const mod=game.modules?.get?.(CB_NS);
 if(!mod)return;mod.api??={};
 mod.api.coverNativeBridge=Object.freeze({
  preview:actionUse=>cbGeometry(actionUse)?.assessment??null,
  earlyGateMode:()=>cbGateInstallation,
  previewReach:actionUse=>game.modules.get(CB_NS)?.api?.meleeReach?.
   inspectActionUse?.(actionUse)??null,
  previewRange:actionUse=>game.modules.get(CB_NS)?.api?.actionRange?.
   inspectActionUse?.(actionUse)??null,
  cardSection:event=>cbPresentation(event),
  patchTargetAC:(content,event)=>cbPatchTargetAC(content,event),
  annotateNativePostUse:(use,message)=>cbOnNativePostUse(use,message)
 });
});
