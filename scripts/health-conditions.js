/**
 * Health conditions foundation, PF1 11.11 / Foundry 13.
 * Opt-in, runtime-probed provider. Never deletes direct actor conditions.
 * Health contributions are direct native ActiveEffects, with source flags.
 * No translated-name matching, fake feats, damage recalculation or action costs.
 */
const HC_NS="pf1-automation-engine";
const HC_ENABLED="healthConditionsEnabled";
const HC_PROOF="healthConditionsProof";
const HC_RECORDS="healthExceptions";
const HC_SOURCE="healthConditionSource";
const HC_INTERNAL="pf1aeHealthConditionsInternal";
const HC_ALLOWED=new Set(["disabled","dying","unconscious","prone","staggered"]);
const HC_WORK=new Map();
const hcArray=v=>Array.isArray(v)?v:v?.contents??(typeof v?.values==="function"?[...v.values()]:[]);
const hcModule=()=>game.modules.get(HC_NS);
const hcLeader=()=>hcModule()?.api?.generic?.isLeader?.()===true&&game.user?.isGM===true;
const hcInternal=()=>({[HC_INTERNAL]:true,pf1:{updateConditionTracks:false}});
const hcFlag=(d,k)=>d?.getFlag?.(HC_NS,k)??d?.flags?.[HC_NS]?.[k];
const hcSetting=(k,d)=>{try{return game.settings.get(HC_NS,k)??d}catch(_){return d}};
const hcFingerprint=()=>[game.version??game.release?.version??"",game.system?.id,game.system?.version,hcModule()?.version??""].join("|");
function hcProvider(){
 if(game.release?.generation!==13||game.system?.id!=="pf1"||game.system?.version!=="11.11")
  return {available:false,reason:"unsupported-system"};
 if(game.modules.get("pf1-improved-conditions")?.active)
  return {available:false,reason:"improved-conditions-conflict"};
 if(!globalThis.pf1?.registry?.conditions?.get||!hcModule()?.api?.generic?.isLeader||!HC_ROUTER_READY)
  return {available:false,reason:"native-router-registry-or-generic-unavailable"};
 return {available:true,reason:null};
}
function hcAvailability(){
 const p=hcProvider();if(!p.available)return p;
 if(hcSetting(HC_ENABLED,false)!==true)return {available:false,reason:"disabled"};
 if(hcSetting(HC_PROOF,"")!==hcFingerprint())return {available:false,reason:"runtime-probe-required"};
 return p;
}
function hcSnapshot(actor){
 if(!["character","npc"].includes(actor?.type))return {supported:false,reason:"unsupported-actor-type"};
 if(hcFlag(actor,"healthProbe")===true)return {supported:false,reason:"probe-actor"};
 if(hcFlag(actor,"healthConditionsManual")===true)return {supported:false,reason:"manual-actor"};
 const rules=hcSettingForActor(actor);
 if(!rules||rules.useWoundsAndVigor)return {supported:false,reason:"unknown-or-variant-health"};
 const hp=actor.system?.attributes?.hp,traits=actor.system?.traits,con=actor.system?.abilities?.con;
 if(!hp||!Number.isFinite(hp.value)||!Number.isFinite(hp.max)||hp.max<=0||
    !Number.isFinite(hp.nonlethal)||hp.nonlethal<0)
  return {supported:false,reason:"invalid-hp"};
 const nonliving=traits?.undead===true||traits?.construct===true;
 if(!nonliving&&traits?.living!==true)return {supported:false,reason:"unknown-creature-type"};
 // PF1 stores regeneration as free text, not a reliable enabled/suppressed state.
 // Do not guess whether the creature can die or how damage is converted.
 if(String(traits?.regen??"").trim())return {supported:false,reason:"regeneration-manual"};
 if(!nonliving&&(!Number.isFinite(con?.total)||!Number.isFinite(con?.damage??0)))
  return {supported:false,reason:"invalid-constitution"};
 const deathByHealth=nonliving?hp.value<=0:
  con.total<=0||(con.damage??0)>=con.total||hp.value<=-con.total;
 return {supported:true,hp:hp.value,max:hp.max,nonlethal:hp.nonlethal,
  con:nonliving?null:con.total,nonliving,deathByHealth,
  dead:deathByHealth||actor.statuses?.has?.("dead")===true,
  stable:actor.statuses?.has?.("stable")===true};
}
function hcSettingForActor(actor){
 try{return game.settings.get("pf1","healthConfig")?.getActorConfig?.(actor)?.rules??null}
 catch(_){return null}
}
function hcRecordId(sourceUuid,key){
 return Array.from(sourceUuid+"\u0000"+key,c=>c.codePointAt(0).toString(16).padStart(6,"0")).join("");
}
function hcValidText(v,n){return typeof v==="string"&&v.length>0&&v.length<=n&&!v.includes("\u0000")}
function hcItem(actor,uuid){return hcArray(actor?.items).find(i=>i.uuid===uuid)}
function hcCombatActive(id){
 const combat=game.combats?.get?.(id);
 return Boolean(combat?.started);
}
function hcRecords(actor){
 const raw=hcFlag(actor,HC_RECORDS)??{};
 const valid=[],invalid=[];
 for(const [id,r] of Object.entries(raw)){
  if(!/^[a-f0-9]+$/.test(id))continue;
  const item=hcItem(actor,r?.sourceUuid);
  if(!hcValidText(r?.sourceUuid,400)||!hcValidText(r?.key,100)||
     id!==hcRecordId(r.sourceUuid,r.key)||r.actorUuid!==actor.uuid||
     !item||item.isActive===false||!Array.isArray(r.suppress)||!Array.isArray(r.apply)||
     [...r.suppress,...r.apply].some(s=>!HC_ALLOWED.has(s))||
     (r.combatId!=null&&!hcCombatActive(r.combatId))){
   invalid.push(id);continue;
  }
  valid.push({id,...r});
 }
 return {valid,invalid};
}
function hcPlan(actor,records=hcRecords(actor).valid){
 const s=hcSnapshot(actor);
 if(!s.supported)return {...s,wanted:[],suppress:[],apply:[]};
 if(s.dead)return {...s,wanted:[],suppress:[],apply:[]};
 const lethal=new Set(),nonlethal=new Set(),suppress=new Set(),apply=new Set();
 if(!s.nonliving){
  if(s.hp===0)lethal.add("disabled");
  if(s.hp<0){
   if(!s.stable)lethal.add("dying");
   lethal.add("unconscious");lethal.add("prone");
  }
  // An exception is a policy for lethal HP states, never for nonlethal damage.
  if(s.hp<=0){
   for(const r of records){
    for(const id of r.suppress)suppress.add(id);
    for(const id of r.apply)apply.add(id);
   }
   for(const id of apply)lethal.add(id);
   for(const id of suppress)lethal.delete(id);
   // Mutually exclusive track. Default to the more restrictive state.
   if(lethal.has("dying"))lethal.delete("disabled");
  }
  if(s.nonlethal>0){
   if(s.nonlethal>s.hp){nonlethal.add("unconscious");nonlethal.add("prone")}
   else if(s.nonlethal===s.hp)nonlethal.add("staggered");
  }
 }
 return {...s,suppress:[...suppress],apply:[...apply],
  wanted:[...lethal].map(status=>({cause:"lethal",status})).concat(
   [...nonlethal].map(status=>({cause:"nonlethal",status})))};
}
// v1 flags are supported exclusively for safe migration/cleanup of old Items.
function hcSource(item,actor){
 const f=hcFlag(item,HC_SOURCE);
 if(item?.type!=="buff"||f?.version!==1||f.actorUuid!==actor?.uuid||
    !["lethal","nonlethal","probe"].includes(f.cause)||!HC_ALLOWED.has(f.status))return null;
 return f;
}
function hcSourceItems(actor){return hcArray(actor?.items).filter(i=>hcSource(i,actor))}
function hcStatusIds(status){
 const c=pf1.registry.conditions.get(status);
 if(!c)throw Error("Native PF1 condition unavailable: "+status);
 return [...new Set([status,...(c.statuses??[])])];
}
function hcExactStatuses(statuses,expected){
 return JSON.stringify([...(statuses??[])].sort())===JSON.stringify([...expected].sort());
}
function hcSafeCarrier(item,actor){
 const f=hcSource(item,actor);if(!f)return false;
 const ids=hcStatusIds(f.status),effects=hcArray(item.effects);
 if(hcArray(item.scriptCalls).length||hcArray(item.actions).length||
    (item.system?.changes??[]).length||!hcExactStatuses(item.system?.conditions,ids)||effects.length>1)return false;
 return effects.every(e=>e.getFlag?.("pf1","tracker")===true&&
  hcExactStatuses(e.statuses,ids)&&!(e.changes?.length));
}
function hcDirectSource(effect,actor){
 const f=hcFlag(effect,HC_SOURCE);
 if(!effect||effect.parent?.uuid!==actor?.uuid||f?.version!==2||
    f.actorUuid!==actor.uuid||!HC_ALLOWED.has(f.status)||
    !Array.isArray(f.causes)||!f.causes.length||
    f.causes.some(c=>!["lethal","nonlethal","probe"].includes(c)))return null;
 return f;
}
function hcSourceEffects(actor){return hcArray(actor?.effects).filter(e=>hcDirectSource(e,actor))}
function hcSafeDirect(effect,actor){
 const f=hcDirectSource(effect,actor);
 return Boolean(f&&effect.getFlag?.("pf1","autoDelete")===true&&
  effect.transfer!==true&&!effect.origin&&!effect.changes?.length&&
  !effect.getFlag?.("core","overlay")&&hcExactStatuses(effect.statuses,hcStatusIds(f.status)));
}
function hcDirectValid(effect,actor){
 const f=hcDirectSource(effect,actor);
 return Boolean(f&&hcSafeDirect(effect,actor)&&effect.disabled!==true&&effect.isSuppressed!==true&&
  [...actor.allApplicableEffects()].some(e=>e.uuid===effect.uuid)&&
  hcStatusIds(f.status).every(id=>actor.statuses?.has?.(id)));
}
function hcNativeData(status){
 const c=pf1.registry.conditions.get(status);
 return {name:c.name,img:c.texture,statuses:hcStatusIds(status),flags:{pf1:{autoDelete:true}}};
}
async function hcCreateSource(actor,causes,status){
 const data=hcNativeData(status);
 data.transfer=false;
 data.flags[HC_NS]={[HC_SOURCE]:{version:2,actorUuid:actor.uuid,causes:[...new Set(causes)],status}};
 const [effect]=await actor.createEmbeddedDocuments("ActiveEffect",[data],hcInternal());
 if(!effect)throw Error("Could not create native health condition.");
 if(!hcDirectValid(effect,actor)){
  if(hcSafeDirect(effect,actor))await actor.deleteEmbeddedDocuments("ActiveEffect",[effect.id],hcInternal());
  throw Error("Native direct health effect could not be verified: "+status);
 }
 return effect;
}
function hcExternalStatus(actor,status){
 const applicable=typeof actor.allApplicableEffects==="function"?[...actor.allApplicableEffects()]:[];
 return applicable.some(e=>e.disabled!==true&&e.isSuppressed!==true&&e.statuses?.has?.(status)&&
  !hcSafeDirect(e,actor)&&!hcSafeCarrier(e.parent,actor));
}
async function hcDeleteSource(effect,actor){
 if(!hcSafeDirect(effect,actor))throw Error("Modified native health effect; GM review required: "+effect.uuid);
 await actor.deleteEmbeddedDocuments("ActiveEffect",[effect.id],hcInternal());
}
async function hcDeleteLegacy(item,actor){
 if(!hcSafeCarrier(item,actor))throw Error("Modified legacy health buff; GM review required: "+item.uuid);
 await item.delete(hcInternal());
}
// PF1 11.11 ActorPF.setConditions searches this.effects.find(ae => ...).
// A native request must never coalesce with our automatic source or delete it.
// Adapt ONLY calls that intersect a managed direct effect, including track
// expansion. Ordinary calls use the original PF1 implementation untouched.
// The collision branch follows the 11.11 native semantics: registry,
// immunities, boolean-only track expansion, overlay data, document CRUD and
// native notification. No temporary mutation of the Actor or its Collection.
let HC_ROUTER_READY=false;
const HC_ROUTER_MARK=Symbol.for("pf1ae.healthConditionNativeRouter");
async function hcRouteConditions(actor,original,conditions={},context={}){
 const owned=hcSourceEffects(actor);
 if(!owned.length)return original(conditions,context);
 const next=foundry.utils.deepClone(conditions);
 for(const track of pf1.registry.conditions.trackedConditions()){
  const enabled=track.find(id=>next[id]===true);
  if(enabled)for(const id of track)if(id!==enabled)next[id]=false;
 }
 if(!Object.keys(next).some(id=>owned.some(e=>e.statuses?.has?.(id))))return original(conditions,context);
 if(owned.some(e=>!hcSafeDirect(e,actor)))throw Error("Modified PF1AE health source: GM review required.");
 const autoIds=new Set(owned.map(e=>e.id)),deletes=new Set(),creates=[],result={};
 const before=new Set(actor.statuses);
 const immunities=actor.getConditionImmunities();
 for(const [id,value] of Object.entries(next)){
  if(!pf1.registry.conditions.has(id))continue;
  if(value===true&&immunities.has(id))continue;
  // This is the only semantic change from native lookup: owned effects are
  // excluded. An independent native effect remains a separate document.
  const prior=actor.statuses.has(id)?actor.effects.find(e=>!autoIds.has(e.id)&&e.statuses.has(id)):null;
  if(value&&!prior){
   let data=hcNativeData(id);
   if(value?.overlay){delete value.overlay;data.flags.core={overlay:true}}
   if(typeof value!=="boolean")data=foundry.utils.mergeObject(data,value);
   creates.push(data);result[id]=value;
  }else if(!value&&prior){deletes.add(prior.id);result[id]=false}
 }
 context.pf1??={};context.pf1.updateConditionTracks=false;
 if(deletes.size)await actor.deleteEmbeddedDocuments("ActiveEffect",[...deletes],context);
 if(creates.length)await actor.createEmbeddedDocuments("ActiveEffect",creates,context);
 // A document source can change without a visible status transition.
 // Notify only real transitions, not false while another source remains.
 const after=new Set(actor.statuses),changed={};
 for(const id of new Set([...before,...after]))if(pf1.registry.conditions.has(id)&&before.has(id)!==after.has(id))changed[id]=after.has(id);
 actor._conditionToggleNotify(changed);
 return result;
}
function hcInstallNativeRouter(){
 if(game.system?.id!=="pf1"||game.system?.version!=="11.11"||game.release?.generation!==13)return;
 const proto=globalThis.pf1?.documents?.actor?.ActorPF?.prototype,fn=proto?.setConditions;
 if(typeof fn!=="function")return;
 if(fn[HC_ROUTER_MARK]){HC_ROUTER_READY=true;return}
 try{
  if(game.modules.get("lib-wrapper")?.active&&typeof globalThis.libWrapper?.register==="function"){
   globalThis.libWrapper.register(HC_NS,"pf1.documents.actor.ActorPF.prototype.setConditions",function(wrapped,conditions,context){
    return hcRouteConditions(this,wrapped,conditions,context);
   },"MIXED");
  }else{
   const wrapped=function(conditions,context){return hcRouteConditions(this,fn.bind(this),conditions,context)};
   Object.defineProperty(wrapped,HC_ROUTER_MARK,{value:true});
   proto.setConditions=wrapped;
  }
  HC_ROUTER_READY=true;
 }catch(error){console.warn("[PF1AE][HealthConditions] Native condition router unavailable",error)}
}
// Owned direct effects use native status data. Only an identical visible
// external source suppresses our duplicate token icon; no HUD/DOM patch.
const HC_DISPLAY_MARK=Symbol.for("pf1ae.healthConditionDisplay");
function hcVisibleDirect(effect,nativeVisible,original){
 if(!nativeVisible)return nativeVisible;
 const actor=effect.actor??effect.parent;
 if(!hcSafeDirect(effect,actor)||effect.disabled===true||effect.isSuppressed===true)return nativeVisible;
 const f=hcDirectSource(effect,actor);
 for(const other of actor.allApplicableEffects()){
  if(other===effect||other.uuid===effect.uuid||other.disabled===true||
     other.isSuppressed===true||other.img!==effect.img||!other.statuses?.has?.(f.status)||!original.call(other))continue;
  if(!hcSafeDirect(other,actor)||String(other.uuid)<String(effect.uuid))return false;
 }
 return nativeVisible;
}
function hcInstallDisplay(){
 if(game.system?.id!=="pf1"||game.system?.version!=="11.11"||game.release?.generation!==13)return;
 const effect=globalThis.CONFIG?.ActiveEffect?.documentClass?.prototype;
 const descriptor=effect&&Object.getOwnPropertyDescriptor(effect,"isTemporary");
 if(descriptor?.configurable&&typeof descriptor.get==="function"&&!descriptor.get[HC_DISPLAY_MARK]){
  const original=descriptor.get,get=function(){return hcVisibleDirect(this,original.call(this),original)};
  Object.defineProperty(get,HC_DISPLAY_MARK,{value:true});
  Object.defineProperty(effect,"isTemporary",{...descriptor,get});
 }
}
// Our CRUD suppresses PF1 track cleanup; that also suppresses its native
// notifications. Emit the real status changes after owned document CRUD,
// locally on each client, so condition panels can refresh on healing.
// Never send a false event if another source still supplies that status.
function hcNotifyOwnedEffect(effect,created,options){
 if(!options?.[HC_INTERNAL])return;
 const actor=effect?.actor??effect?.parent;
 if(!hcDirectSource(effect,actor))return;
 for(const id of effect.statuses){
  const active=actor.statuses?.has?.(id)===true;
  if(created){
   if(!active||[...actor.allApplicableEffects()].some(e=>e.uuid!==effect.uuid&&
      e.disabled!==true&&e.isSuppressed!==true&&e.statuses?.has?.(id)))continue;
  }else if(active)continue;
  Hooks.callAll?.("pf1ToggleActorCondition",actor,id,active);
 }
}
function hcNotifyLegacyDelete(item,options){
 if(!options?.[HC_INTERNAL])return;
 const actor=item?.actor??item?.parent,f=hcSource(item,actor);
 if(!f)return;
 for(const id of hcStatusIds(f.status))if(!actor.statuses?.has?.(id))Hooks.callAll?.("pf1ToggleActorCondition",actor,id,false);
}
async function hcDropRecords(actor,ids,{internal=true}={}){
 if(!ids.length)return;
 const updates={};
 for(const id of ids)updates["flags."+HC_NS+"."+HC_RECORDS+".-="+id]=null;
 await actor.update(updates,internal?hcInternal():{});
}
async function hcReconcileInternal(actor){
 if(!hcLeader()||!hcAvailability().available)return {skipped:"unavailable"};
 if(!actor||hcFlag(actor,"healthProbe"))return {skipped:"no-actor"};
 const rows=hcRecords(actor);
 await hcDropRecords(actor,rows.invalid);
 const plan=hcPlan(actor,rows.valid);
 const existing=hcSourceEffects(actor).filter(e=>!hcDirectSource(e,actor).causes.includes("probe"));
 const legacy=hcSourceItems(actor).filter(i=>hcSource(i,actor).cause!=="probe");
 // Validate all owned documents before touching any, never adopt unmarked
 // direct conditions. Legacy buffs are removed only if structurally verified.
 for(const e of existing)if(!hcSafeDirect(e,actor))throw Error("Modified native health effect: "+e.uuid);
 for(const i of legacy)if(!hcSafeCarrier(i,actor))throw Error("Modified legacy health buff: "+i.uuid);
 if(!plan.supported){
  for(const e of existing)await hcDeleteSource(e,actor);
  for(const i of legacy)await hcDeleteLegacy(i,actor);
  return {skipped:plan.reason};
 }
 if(plan.deathByHealth&&!actor.statuses?.has?.("dead")){
  await actor.setCondition("dead",{overlay:true});
  if(!actor.statuses?.has?.("dead"))throw Error("Native Dead condition was not applied.");
  await hcModule()?.api?.deathDefeated?.reconcileActor?.(actor);
 }
 if(plan.dead)await hcDropRecords(actor,rows.valid.map(r=>r.id));
 // One direct effect per native primary, even when both lethal and
 // nonlethal health rules contribute. Preserve the separate cause flags.
 const wanted=new Map();
 for(const row of plan.wanted){
  if(!wanted.has(row.status))wanted.set(row.status,new Set());
  wanted.get(row.status).add(row.cause);
 }
 const kept=new Set(),remove=[];
 for(const e of existing){
  const f=hcDirectSource(e,actor),causes=wanted.get(f.status);
  if(causes&&!kept.has(f.status)&&hcDirectValid(e,actor)){
   kept.add(f.status);
   if(!hcExactStatuses(f.causes,causes))await e.update({["flags."+HC_NS+"."+HC_SOURCE+".causes"]:[...causes]},hcInternal());
  }else remove.push(e);
 }
 for(const [status,causes] of wanted)if(!kept.has(status))await hcCreateSource(actor,causes,status);
 // A recovered creature does not automatically stand. Convert our
 // physical fall into an independent native prone effect before cleanup.
 const falling=remove.some(e=>{const f=hcDirectSource(e,actor);return f.status==="prone"&&
  (plan.dead||plan.hp>=0||f.causes.includes("nonlethal"))})||
  legacy.some(i=>{const f=hcSource(i,actor);return f.status==="prone"&&
   (plan.dead||plan.hp>=0||f.cause==="nonlethal")});
 if(!wanted.has("prone")&&falling&&!hcExternalStatus(actor,"prone")){
  await actor.setCondition("prone",true);
  if(!hcExternalStatus(actor,"prone"))throw Error("Could not retain the physical prone state after recovery.");
 }
 for(const e of remove)await hcDeleteSource(e,actor);
 for(const i of legacy)await hcDeleteLegacy(i,actor);
 return {reconciled:true,plan};
}
function hcQueue(actor){
 if(!actor?.uuid||!hcLeader()||!hcAvailability().available)return Promise.resolve({skipped:"unavailable"});
 const key=actor.uuid,prior=HC_WORK.get(key)??Promise.resolve();
 const next=prior.catch(()=>{}).then(async()=>{
  const current=await fromUuid(key);
  if(!current)return {skipped:"actor-missing"};
  return hcReconcileInternal(current);
 });
 HC_WORK.set(key,next);
 next.then(()=>{if(HC_WORK.get(key)===next)HC_WORK.delete(key)},error=>{
  if(HC_WORK.get(key)===next)HC_WORK.delete(key);
  console.warn("[PF1AE][HealthConditions] Reconcile failed",key,error);
 });
 return next;
}
function hcOwned(actor){return game.user?.isGM===true||actor?.testUserPermission?.(game.user,"OWNER")===true}
async function hcResolve(options){
 const actor=options?.actor??(options?.actorUuid?await fromUuid(options.actorUuid):null);
 if(!actor||actor.documentName!=="Actor"||!hcOwned(actor))throw Error("Actor OWNER permission required.");
 const sourceUuid=options.sourceUuid,key=options.key;
 if(!hcValidText(sourceUuid,400)||!hcValidText(key,100))throw Error("Invalid source UUID or key.");
 return {actor,sourceUuid,key,id:hcRecordId(sourceUuid,key)};
}
function hcPolicyList(value){
 if(value==null)return [];
 if(!Array.isArray(value)||value.some(s=>!HC_ALLOWED.has(s)))throw Error("Unsupported health condition (Dead cannot be suppressed or applied).");
 return [...new Set(value)];
}
async function hcRegister(options){
 const availability=hcAvailability();
 if(!availability.available)throw Error("Health Conditions unavailable: "+availability.reason);
 const {actor,sourceUuid,key,id}=await hcResolve(options);
 const source=hcItem(actor,sourceUuid);
 if(!source||source.isActive===false)throw Error("Source must be an active embedded Item on this exact Actor.");
 const s=hcSnapshot(actor);
 if(!s.supported||s.dead)throw Error("Actor cannot receive a health exception: "+(s.reason??"dead"));
 const suppress=hcPolicyList(options.suppress),apply=hcPolicyList(options.apply);
 if(!suppress.length&&!apply.length)throw Error("Empty health exception.");
 const combatId=options.combatId??null;
 if(combatId!=null&&(!hcValidText(combatId,100)||!hcCombatActive(combatId)))throw Error("Combat is not active.");
 const row={actorUuid:actor.uuid,sourceUuid,key,suppress,apply,combatId};
 // Individual flat flag path; parallel exceptions cannot replace the registry.
 await actor.update({["flags."+HC_NS+"."+HC_RECORDS+"."+id]:row});
 return {registered:true,id,...(hcLeader()?await hcQueue(actor):{queued:true})};
}
async function hcUnregister(options){
 const {actor,id}=await hcResolve(options);
 // Remove only this source/key tuple. Allow cleanup even when provider disabled.
 await hcDropRecords(actor,[id],{internal:false});
 return {unregistered:true,id,...(hcLeader()?await hcQueue(actor):{queued:true})};
}
async function hcRequestReconcile(actor){
 if(!hcAvailability().available)throw Error("Health Conditions unavailable: "+hcAvailability().reason);
 if(!hcOwned(actor))throw Error("Actor OWNER permission required.");
 if(hcLeader())return hcQueue(actor);
 // Native Actor update, no custom player-to-GM executable payload.
 await actor.update({["flags."+HC_NS+".healthReconcileRequest"]:foundry.utils.randomID()});
 return {queued:true};
}
function hcActors(){
 const actors=new Map();
 for(const actor of hcArray(game.actors))if(actor?.uuid)actors.set(actor.uuid,actor);
 for(const scene of hcArray(game.scenes))for(const token of hcArray(scene.tokens)){
  const actor=token.actor;
  if(actor?.uuid)actors.set(actor.uuid,actor);
 }
 return [...actors.values()];
}
function hcTracked(actor){
 return hcSourceEffects(actor).length>0||hcSourceItems(actor).length>0||Object.keys(hcFlag(actor,HC_RECORDS)??{}).length>0;
}
async function hcRestore(){
 if(!hcLeader()||!hcAvailability().available)return;
 for(const actor of hcActors())if(hcTracked(actor))await hcQueue(actor).catch(()=>{});
}
async function hcDisable(){
 if(!hcLeader())return;
 for(const actor of hcActors()){
  await HC_WORK.get(actor.uuid)?.catch(()=>{});
  if(hcSetting(HC_ENABLED,false)===true)return;
  for(const effect of hcSourceEffects(actor))if(!hcDirectSource(effect,actor).causes.includes("probe"))
   await hcDeleteSource(effect,actor).catch(e=>console.warn("[PF1AE][HealthConditions] Cleanup needs GM review",e));
  for(const item of hcSourceItems(actor))if(hcSource(item,actor).cause!=="probe")
   await hcDeleteLegacy(item,actor).catch(e=>console.warn("[PF1AE][HealthConditions] Legacy cleanup needs GM review",e));
  await hcDropRecords(actor,Object.keys(hcFlag(actor,HC_RECORDS)??{}).filter(id=>/^[a-f0-9]+$/.test(id)));
 }
}
function hcDiagnostics(actor){
 const availability=hcAvailability();
 return {...availability,provider:hcProvider(),proof:hcSetting(HC_PROOF,""),
  fingerprint:hcFingerprint(),...(actor?{actorUuid:actor.uuid,plan:hcPlan(actor),
   records:hcRecords(actor).valid,owned:hcSourceEffects(actor).map(e=>({uuid:e.uuid,...hcDirectSource(e,actor)})),
   legacy:hcSourceItems(actor).map(i=>({uuid:i.uuid,...hcSource(i,actor)})),
   actualStatuses:[...actor.statuses],
   external:[...HC_ALLOWED,"dead","stable"].filter(s=>hcExternalStatus(actor,s))}:{})};
}
// Explicit runtime proof on disposable world and synthetic Actors. The
// provider stays disabled unless both paths preserve independent conditions.
async function hcProbeOne(actor,baseActor=null){
 const checks=[];
 const checkIsolation=()=>{if(baseActor&&([...HC_ALLOWED,"sleep","stable","dead"].some(s=>baseActor.statuses?.has?.(s))||hcSourceEffects(baseActor).length||hcSourceItems(baseActor).length))throw Error("Synthetic Actor leaked to world Actor.")};
 for(const status of ["unconscious","prone","disabled","dying","staggered"]){
  const item=await hcCreateSource(actor,["probe"],status);
  if(!hcDirectValid(item,actor))throw Error("Native direct effect verification failed: "+status);
  checkIsolation();
  await actor.setCondition(status,true);
  checkIsolation();
  if(!hcExternalStatus(actor,status))throw Error("Native independent condition was coalesced: "+status);
  await actor.setCondition(status,false);
  if(hcExternalStatus(actor,status)||!actor.statuses?.has?.(status)||!hcDirectValid(item,actor))throw Error("Native removal changed automatic source: "+status);
  await actor.toggleStatusEffect(status,{active:true});
  if(!hcExternalStatus(actor,status))throw Error("HUD/native toggle did not preserve independent source: "+status);
  await hcDeleteSource(item,actor);
  if(!actor.statuses?.has?.(status)||!hcExternalStatus(actor,status))throw Error("Independent condition lost: "+status);
  await actor.setCondition(status,false);
  checks.push(status);
 }
 // Also prove an independent secondary condition from a different primary.
 await actor.setCondition("sleep",true);
 const unconscious=await hcCreateSource(actor,["probe"],"unconscious");
 await hcDeleteSource(unconscious,actor);
 if(!actor.statuses?.has?.("sleep")||!actor.statuses?.has?.("unconscious"))
  throw Error("Sleep provenance lost.");
 await actor.setCondition("sleep",false);
 checks.push("sleep-secondary");
 const dying=await hcCreateSource(actor,["probe"],"dying");
 await actor.setCondition("stable",true);
 await hcDeleteSource(dying,actor);
 if(!actor.statuses?.has?.("stable"))throw Error("Stable track lost.");
 await actor.setCondition("stable",false);
 checks.push("stable-track");
 // In the opposite order, creating a transferred state must not let
 // native condition-track cleanup erase a pre-existing independent state.
 await actor.setCondition("stable",true);
 const carrier=await hcCreateSource(actor,["probe"],"disabled");
 checkIsolation();
 if(!hcExternalStatus(actor,"stable"))throw Error("Creating source erased independent track state.");
 await hcDeleteSource(carrier,actor);
 if(!hcExternalStatus(actor,"stable"))throw Error("Removing source erased independent track state.");
 await actor.setCondition("stable",false);
 checks.push("preexisting-track");
 // Removing the final health source must actually remove native statuses.
 const last=await hcCreateSource(actor,["probe"],"unconscious");
 await hcDeleteSource(last,actor);
 if(actor.statuses?.has?.("unconscious")||actor.statuses?.has?.("helpless")||hcSourceEffects(actor).length||hcSourceItems(actor).length)throw Error("Final native status or technical Item remained after cleanup.");
 checks.push("final-source-removal");
 checkIsolation();
 return checks;
}
let HC_PROBING=false;
async function hcProbe(){
 if(!hcLeader()||!hcProvider().available)throw Error("Probe requires elected GM, exact PF1 and no Improved Conditions.");
 if(hcSetting(HC_ENABLED,false)===true)throw Error("Disable Health Conditions before running the probe.");
 if(HC_PROBING)throw Error("Health Conditions probe already running.");
 HC_PROBING=true;
 let actor,scene,result;
 try{
  await game.settings.set(HC_NS,HC_PROOF,"");
  actor=await Actor.implementation.create({name:"PF1AE temporary health probe",type:"npc",
   flags:{[HC_NS]:{healthProbe:true}}});
  if(!actor)throw Error("Temporary actor creation failed.");
  scene=await Scene.implementation.create({name:"PF1AE temporary health probe",navigation:false,
   active:false,width:1000,height:1000});
  const linkedProto=await actor.getTokenDocument({actorLink:true,x:0,y:0});
  const [linkedToken]=await scene.createEmbeddedDocuments("Token",[linkedProto.toObject()]);
  if(linkedToken?.actor?.uuid!==actor.uuid)throw Error("Linked Actor creation failed.");
  const linked=await hcProbeOne(linkedToken.actor);
  const proto=await actor.getTokenDocument({actorLink:false,x:100,y:100});
  const [token]=await scene.createEmbeddedDocuments("Token",[proto.toObject()]);
  if(!token?.actor||token.actor.uuid===actor.uuid)throw Error("Synthetic Actor creation failed.");
  const unlinked=await hcProbeOne(token.actor,actor);
  if(actor.statuses?.has?.("unconscious")||actor.statuses?.has?.("prone"))throw Error("Synthetic Actor leaked to world Actor.");
  result={passed:true,linked,unlinked,fingerprint:hcFingerprint()};
 }finally{
  try{if(scene)await scene.delete();}finally{try{if(actor)await actor.delete();}finally{HC_PROBING=false;}}
 }
 await game.settings.set(HC_NS,HC_PROOF,hcFingerprint());
 return result;
}
const hcOnActor=(actor,changed,options)=>{
 if(options?.[HC_INTERNAL]||hcFlag(actor,"healthProbe"))return;
 void hcQueue(actor);
};
const hcOnItem=(item,change,options)=>{
 if(options?.[HC_INTERNAL]||hcFlag(item?.actor??item?.parent,"healthProbe"))return;
 void hcQueue(item?.actor??item?.parent);
};
const hcOnEffect=(effect,change,options)=>{
 const actor=effect?.actor??(effect?.parent?.documentName==="Actor"?effect.parent:effect?.parent?.actor);
 if(options?.[HC_INTERNAL]||hcFlag(actor,"healthProbe"))return;
 void hcQueue(actor);
};
Hooks.once("init",()=>{
 game.settings.register(HC_NS,HC_ENABLED,{scope:"world",config:true,type:Boolean,default:false,
  name:"PF1AE.Settings.HealthConditions.Name",hint:"PF1AE.Settings.HealthConditions.Hint",
  onChange:value=>{if(value)void hcRestore();else void hcDisable()}});
 game.settings.register(HC_NS,HC_PROOF,{scope:"world",config:false,type:String,default:""});
});
Hooks.once("ready",()=>{
 const mod=hcModule();if(!mod)return;
 hcInstallNativeRouter();hcInstallDisplay();
 mod.api??={};
 mod.api.healthConditions=Object.freeze({
  isAvailable:()=>hcAvailability().available,diagnostics:hcDiagnostics,
  list:actor=>hcRecords(actor).valid.map(r=>({...r,suppress:[...r.suppress],apply:[...r.apply]})),
  register:hcRegister,unregister:hcUnregister,reconcile:hcRequestReconcile,probe:hcProbe
 });
 Hooks.on("updateActor",hcOnActor);
 Hooks.on("updateItem",hcOnItem);
 Hooks.on("createItem",(item,options)=>hcOnItem(item,null,options));
 Hooks.on("deleteItem",(item,options)=>{hcNotifyLegacyDelete(item,options);hcOnItem(item,null,options)});
 Hooks.on("updateActiveEffect",hcOnEffect);
 Hooks.on("createActiveEffect",(effect,options)=>{hcNotifyOwnedEffect(effect,true,options);hcOnEffect(effect,null,options)});
 Hooks.on("deleteActiveEffect",(effect,options)=>{hcNotifyOwnedEffect(effect,false,options);hcOnEffect(effect,null,options)});
 Hooks.on("updateCombat",()=>{void hcRestore()});
 Hooks.on("deleteCombat",()=>{void hcRestore()});
 Hooks.on("canvasReady",()=>{void hcRestore()});
 Hooks.on("updateUser",(_u,c)=>{if(Object.hasOwn(c??{},"active"))void hcRestore()});
 void hcRestore();
});
