/**
 * PF1AE native cover bridge for PF1 11.11.
 *
 * Gate ActionUse.process() BEFORE checkRequirements(), autoSelectAmmo(),
 * attack-dialog construction and all expenditure. Native pf1PreActionUse
 * remains a secondary safety gate; it occurs AFTER the attack is rolled.
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
 * Intercept the process entry point instead, before PF1 checks requirements,
 * auto-selects ammunition or displays its dialog.
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
function cbOutOfReach(actionUse){
 if(!cbEnable())return false;
 const api=game.modules.get(CB_NS)?.api?.meleeReach;
 if(typeof api?.inspectActionUse!=="function")return false;
 try{return api.inspectActionUse(actionUse)?.status==="out-of-reach"}
 catch(error){
  console.warn("[PF1AE][MeleeReach] Conservative check unavailable",error);
  return false;
 }
}
function cbNotifyOutOfReach(){
 const localized=game.i18n?.localize?.("PF1AE.MeleeReach.OutOfReach");
 ui.notifications?.warn?.(localized&&localized!=="PF1AE.MeleeReach.OutOfReach"?
  localized:"Target is beyond this melee attack's reach.");
}
function cbNotifyBlocked(){
 const message=game.i18n?.localize?.("PF1AE.Cover.TotalBlocked")??
  "Total cover: no direct line of effect. Attack cancelled.";
 ui.notifications?.warn?.(message);
}
let cbGateInstallation=null;
function cbInstallEarlyGate(){
 if(cbGateInstallation)return;
 const ActionUse=globalThis.pf1?.actionUse?.ActionUse;
 const proto=ActionUse?.prototype;
 if(!proto||typeof proto.process!=="function"){
  console.warn("[PF1AE][CoverBridge] PF1 ActionUse.process unavailable; early cover gate disabled");
  return;
 }
 // Prefer libWrapper for composition with other modules; use a guarded
 // prototype fallback when libWrapper is not present.
 if(game.modules?.get?.("lib-wrapper")?.active&&
    typeof globalThis.libWrapper?.register==="function"){
  try{
   globalThis.libWrapper.register(CB_NS,
    "pf1.actionUse.ActionUse.prototype.process",
    async function(wrapped,...args){
     if(cbTotalBlocked(this)){cbNotifyBlocked();return undefined}
     if(cbOutOfReach(this)){cbNotifyOutOfReach();return undefined}
     return wrapped(...args);
    },"WRAPPER");
   cbGateInstallation="lib-wrapper";
   return;
  }catch(error){
   console.warn("[PF1AE][CoverBridge] libWrapper registration failed",error);
   // Do not install a competing replacement over an unknown wrapper.
   return;
  }
 }
 const original=proto.process;
 const descriptor=Object.getOwnPropertyDescriptor(proto,"process");
 if(descriptor&&!descriptor.writable&&!descriptor.set){
  console.warn("[PF1AE][CoverBridge] ActionUse.process is not writable");
  return;
 }
 const guard=async function(...args){
  if(cbTotalBlocked(this)){cbNotifyBlocked();return undefined}
  if(cbOutOfReach(this)){cbNotifyOutOfReach();return undefined}
  return original.apply(this,args);
 };
 try{
  proto.process=guard;
  if(proto.process===guard)cbGateInstallation="prototype";
 }catch(error){
  console.warn("[PF1AE][CoverBridge] Early gate installation failed",error);
 }
}
function cbPreActionUse(actionUse){
 // Fallback safety check for integrations bypassing ActionUse.process.
 if(cbTotalBlocked(actionUse)){
  cbNotifyBlocked();
  return false;
 }
 if(cbOutOfReach(actionUse)){
  cbNotifyOutOfReach();
  return false;
 }
}
const cbNumber=n=>typeof n==="number"&&Number.isFinite(n)?n:null;
function cbPresentation(event){
 if(!event||!event.sourceMessageId||
    !Array.isArray(event.targetResults)||event.targetResults.length!==1)return null;
 const result=event.targetResults[0];
 if(!result?.targetTokenUuid||!result?.coverDiagnosis)return null;
 const cover=result.coverDiagnosis;
 const defense=result.defense;
 if(cover.status!=="confirmed")return null;
 const native=cbNumber(defense?.baseValue);
 const effective=cbNumber(defense?.value);
 const added=cbNumber(defense?.coverBonus);
 const isTotal=cover.type==="total"&&cover.preventsDirectAttack===true;
 if(!isTotal&&native===null)return null;
 // No user-provided HTML: all text is constant and numbers verified.
 const safe=(v)=>String(v);
 const title=game.i18n?.localize?.("PF1AE.Cover.CardTitle")??"PF1AE cover";
 const nativeLabel=game.i18n?.localize?.("PF1AE.Cover.NativeAC")??"Native AC";
 const effectiveLabel=game.i18n?.localize?.("PF1AE.Cover.EffectiveAC")??"Effective AC";
 const pending=game.i18n?.localize?.("PF1AE.Cover.PendingAC")??"Unverified (GM review)";
 const blocked=game.i18n?.localize?.("PF1AE.Cover.TotalCardWarning")??"Total cover detected after the roll: review and disregard this direct attack.";
 const bonus=added===null?"?":added>0?"+"+safe(added):safe(added);
 const content=isTotal?
  '<strong>'+blocked+'</strong>':
  nativeLabel+': <strong>'+safe(native)+'</strong> · '+
  effectiveLabel+': <strong>'+(effective===null?pending:safe(effective))+
  '</strong> ('+bonus+')';
 return '<section class="pf1ae-cover-result" data-pf1ae-cover="1" style="border-top:1px solid var(--color-border-light-primary,#999);margin-top:0.5rem;padding-top:0.4rem">'+
  '<strong>'+title+'</strong><div>'+content+'</div></section>';
}
async function cbOnResolved(event){
 if(!cbEnable()||!event?.sourceMessageId)return;
 const section=cbPresentation(event);
 if(!section)return;
 const card=game.messages?.get?.(event.sourceMessageId);
 if(!card||card.documentName!=="ChatMessage"||
  typeof card.content!=="string"||typeof card.update!=="function")return;
 // Only the author (or GM) may update the original message.
 if(!game.user?.isGM&&card.user?.id!==game.user?.id&&
   card.user!==game.user?.id)return;
 const source=card.content;
 // The event arrives after native PF1 has posted the card.
 if(source.includes('data-pf1ae-cover="1"'))return;
 try{await card.update({content:source+section})}
 catch(error){console.warn("[PF1AE][CoverBridge] Card annotation unavailable",error)}
}
Hooks.on("pf1PreActionUse",cbPreActionUse);
Hooks.on("pf1aeAttackResolution",event=>{void cbOnResolved(event)});
Hooks.once("ready",()=>{
 cbInstallEarlyGate();
 const mod=game.modules?.get?.(CB_NS);
 if(!mod)return;mod.api??={};
 mod.api.coverNativeBridge=Object.freeze({
  preview:actionUse=>cbGeometry(actionUse)?.assessment??null,
  earlyGateMode:()=>cbGateInstallation,
  previewReach:actionUse=>game.modules.get(CB_NS)?.api?.meleeReach?.
   inspectActionUse?.(actionUse)??null,
  cardSection:event=>cbPresentation(event)
 });
});
