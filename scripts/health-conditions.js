/**
 * Health conditions foundation, PF1 11.11 / Foundry 13.
 * Opt-in, runtime-probed provider. Never deletes direct actor conditions.
 * Health contributions are direct native ActiveEffects, with source flags.
 * Native stabilization, turn checks and optional strenuous-action HP loss.
 */
const HC_NS="pf1-automation-engine";
const HC_ENABLED="healthConditionsEnabled";
const HC_PROOF="healthConditionsProof";
const HC_RECORDS="healthExceptions";
const HC_SOURCE="healthConditionSource";
const HC_AGONY="healthAgonyEnabled",HC_STRAIN="healthStrenuousEnabled";
const HC_AGONY_TURNS="healthAgonyTurns",HC_ACTION_COSTS="healthActionCosts";
const HC_INTERNAL="pf1aeHealthConditionsInternal";
const HC_ALLOWED=new Set(["disabled","dying","unconscious","prone","staggered"]);
const HC_WORK=new Map();
const HC_EVENT_CALL="PF1AE:health:changed",HC_EVENT_HOOK="pf1aeHealthChanged";
const HC_EVENT_ACTIVE=new Set(),HC_EVENT_OPTIONS=new WeakMap();
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
     !item||item.isActive===false||item.activeState===false||!Array.isArray(r.suppress)||!Array.isArray(r.apply)||
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
// PF1 Core Rulebook, combat: disability, dying, stable characters.
// Loss of a hit point is not an attack or an application of damage.
// Use native Actor.update (not applyDamage, DR or temporary HP absorption).
function hcAgonyEnabled(){return hcAvailability().available&&hcSetting(HC_AGONY,false)===true}
function hcStrainEnabled(){return hcAvailability().available&&hcSetting(HC_STRAIN,false)===true}
function hcNativeStableEffects(actor){
 // Stable is a physiological state, not a persistent immunity to dying.
 // Clear only plain direct native stable conditions, never an Item effect,
 // scripted duration, overlay or effect with unrelated statuses/changes.
 return hcArray(actor.effects).filter(e=>e.parent?.uuid===actor.uuid&&
  e.getFlag?.("pf1","autoDelete")===true&&!e.origin&&!e.changes?.length&&
  !e.getFlag?.("core","overlay")&&hcExactStatuses(e.statuses,["stable"])&&
  !e.duration?.seconds&&!e.duration?.rounds&&!e.duration?.turns);
}
async function hcClearStable(actor){
 const ids=hcNativeStableEffects(actor).map(e=>e.id);
 if(ids.length)await actor.deleteEmbeddedDocuments("ActiveEffect",ids);
}
async function hcStabilize(actor){
 const s=hcSnapshot(actor);
 if(!s.supported||s.dead||s.nonliving||s.hp>=0)return false;
 if(!s.stable){
  // Object form avoids clearing a separately sourced track state.
  await actor.setCondition("stable",{});
  if(!actor.statuses.has("stable"))throw Error("Native stabilization condition not applied.");
 }
 return true;
}
async function hcHealthTransition(actor,delta,expectedHp){
 if(!hcAgonyEnabled()||!hcLeader())return;
 const s=hcSnapshot(actor);
 if(!s.supported||s.nonliving||s.dead||s.hp!==expectedHp)return;
 if(s.hp>=0){await hcClearStable(actor);return}
 // PF1 BaseCharacterPF reports actual HP offset deltas, not hp.max
 // changes or temporary HP expiry. Do not infer damage from a new max.
 if(delta>0)await hcStabilize(actor);
 else if(delta<0)await hcClearStable(actor);
}
// Generic incoming health event. A real, committed HP change is required;
// no discovery on ready, no fake attacks, and no translated ability names.
function hcEvent(actor,before,after,reason,userId=null){
 const s=hcSnapshot(actor);
 if(!s.supported||!Number.isFinite(before)||!Number.isFinite(after)||before===after||s.hp!==after)return null;
 const matches=[];
 for(const combat of hcArray(game.combats)){
  if(!combat.started)continue;
  const combatants=hcArray(combat.combatants);
  for(const c of combatants)if(c.actor?.uuid===actor.uuid)matches.push({combat,c});
 }
 const match=matches.length===1?matches[0]:null,combat=match?.combat;
 return Object.freeze({type:"health:changed",eventId:foundry.utils.randomID(),actorUuid:actor.uuid,
  hpBefore:before,hpAfter:after,hpDelta:after-before,reason,userId,
  reducedToZero:before>0&&after<=0,enteredNegative:before>=0&&after<0,
  recoveredNonnegative:before<0&&after>=0,enteredPositive:before<=0&&after>0,
  constitution:s.con,deathByHealth:s.deathByHealth,dead:s.dead,nonliving:s.nonliving,
  combatId:combat?.id??null,combatantId:match?.c.id??null,
  round:combat?.round??null,activeCombatantId:combat?.combatant?.id??null});
}
function hcEventCalls(item){
 return hcArray(item?.scriptCalls??item?.system?.scriptCalls).filter(c=>
  c.category==="postUse"&&c.name===HC_EVENT_CALL&&typeof c.execute==="function");
}
function hcEventSourceActive(actor,item){
 return hcItem(actor,item?.uuid)===item&&item.isActive!==false&&item.activeState!==false;
}
function hcEventApproved(actor,item,call){
 // Same native Script Call approval policy as the bleed service, including
 // Trusted Table Mode. Never execute arbitrary code from a remote message.
 const owners=hcArray(game.users).some(u=>!u.isGM&&actor.testUserPermission?.(u,"OWNER")===true);
 if(!owners)return true;
 return hcModule()?.api?.scriptApprovals?.check?.(actor,item,call)?.approved===true;
}
function hcEventCurrent(actor,event){
 const s=hcSnapshot(actor);
 return hcLeader()&&hcAvailability().available&&s.supported&&s.hp===event.hpAfter;
}
async function hcRunHealthEvent(actor,event){
 if(!event||!hcEventCurrent(actor,event)||event.dead)return;
 if(HC_EVENT_ACTIVE.has(actor.uuid))return;
 HC_EVENT_ACTIVE.add(actor.uuid);
 try{
  for(const item of hcArray(actor.items).sort((a,b)=>a.uuid.localeCompare(b.uuid))){
   if(!hcEventCurrent(actor,event)||hcSnapshot(actor).dead)break;
   if(!hcEventSourceActive(actor,item))continue;
   const calls=hcEventCalls(item);
   if(calls.length!==1)continue;
   const call=calls[0];
   if(!hcEventApproved(actor,item,call))continue;
   let open=true;
   const changes=new Map();
   // Only the calling embedded Item can write its own exception keys.
   // Stage writes until the native script completes; no recursive queue
   // awaits, and failed scripts cannot commit a staged exception.
   const assertOpen=()=>{
    if(!open||!hcEventCurrent(actor,event)||!hcEventSourceActive(actor,item))
     throw Error("Health event scope expired.");
   };
   const context=Object.freeze({...event,sourceUuid:item.uuid,
    register(options={}){
     assertOpen();
     const {key}=options;
     if(!hcValidText(key,100))throw Error("Invalid health exception key.");
     const {id,row}=hcBuildRecord(actor,item.uuid,key,options);
     changes.set(id,row);
     return {staged:true,id};
    },
    unregister({key}={}){
     assertOpen();
     if(!hcValidText(key,100))throw Error("Invalid health exception key.");
     const id=hcRecordId(item.uuid,key);changes.set(id,null);
     return {staged:true,id};
    }
   });
   try{
    await call.execute({action:null},{event:context,api:hcModule().api.healthConditions});
    open=false;
    if(!hcEventCurrent(actor,event)||hcSnapshot(actor).dead||!hcEventSourceActive(actor,item)||
       hcEventCalls(item)[0]!==call||!hcEventApproved(actor,item,call))continue;
    const update={};
    for(const [id,row] of changes)update["flags."+HC_NS+"."+HC_RECORDS+"."+(row?id:"-="+id)]=row;
    if(Object.keys(update).length)await actor.update(update,hcInternal());
   }catch(error){
    console.warn("[PF1AE][HealthConditions] Health Script Call failed",item.uuid,error);
   }finally{open=false}
  }
 }finally{HC_EVENT_ACTIVE.delete(actor.uuid)}
}
function hcNotifyHealthEvent(actor,event){
 if(!event||!hcEventCurrent(actor,event))return;
 // Read-only notification AFTER the final reconciliation. Foundry hooks
 // are synchronous notifications, not a way to delay the state engine.
 Hooks.callAll?.(HC_EVENT_HOOK,actor,event);
}
async function hcProcessHealthEvent(actor,before,after,reason,userId=null,{transition=true}={}){
 const event=hcEvent(actor,before,after,reason,userId);
 if(!event)return null;
 if(transition)await hcHealthTransition(actor,event.hpDelta,after);
 if(!event.dead)await hcRunHealthEvent(actor,event);
 return event;
}

function hcOngoingDamage(actor,bleedInfo=null){
 // An explicit generic source means continuous damage is in effect.
 if([...hcArray(actor.items),...hcArray(actor.effects)].some(d=>
  hcFlag(d,"ongoingDamage")===true&&d.isActive!==false&&d.activeState!==false&&
  d.disabled!==true&&d.isSuppressed!==true))return true;
 if(bleedInfo?.appliedAmount>0)return true;
 if(!actor.statuses?.has?.("bleed"))return false;
 // An existing native Bleed condition with no configured amount is still
 // a recognized ongoing source. But a proven, fully prevented configured
 // bleed must not cause automatic failure on its own.
 if(bleedInfo?.appliedAmount===0){
  const sources=new Set(bleedInfo.sourceUuids);
  return [...actor.allApplicableEffects()].some(e=>e.statuses?.has?.("bleed")&&
   e.disabled!==true&&e.isSuppressed!==true&&!sources.has(e.uuid)&&!sources.has(e.parent?.uuid));
 }
 return true;
}
function hcDying(actor){
 const p=hcPlan(actor);
 return p.supported&&!p.dead&&!p.nonliving&&p.hp<0&&!p.stable&&
  p.wanted.some(r=>r.status==="dying"&&r.cause==="lethal");
}
function hcLang(fr,en){return String(game.i18n?.lang??"en").toLowerCase().startsWith("fr")?fr:en}
function hcWarn(msg,detail){console.warn("[PF1AE][HealthConditions] "+msg,detail);globalThis.ui?.notifications?.warn?.(msg)}
async function hcReport(actor,message){
 try{
  if(typeof globalThis.ChatMessage?.create!=="function")return;
  await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:message});
 }catch(e){console.warn("[PF1AE][HealthConditions] Chat display failed",e)}
}
// Use an actor-scoped high-water receipt per combatant. Claim before the
// native roll. Never retry a pending claim after failure/reload/rewind.
const hcTurnKey=(combatId,combatantId)=>hcRecordId(combatId,combatantId);
const hcTurnCurrent=(combat,entry)=>Boolean(combat?.started&&combat.round===entry.round&&
 combat.combatant?.id===entry.combatantId&&combat.combatant?.actor?.uuid===entry.actorUuid);
async function hcAgonyTurn(actor,entry,combat,bleedInfo=null){
 if(!hcAgonyEnabled()||!hcLeader()||!hcTurnCurrent(combat,entry)||!hcDying(actor))return {skipped:"not-dying-or-turn-changed"};
 const key=hcTurnKey(entry.combatId,entry.combatantId),path="flags."+HC_NS+"."+HC_AGONY_TURNS+"."+key;
 const old=hcFlag(actor,HC_AGONY_TURNS)?.[key];
 if(Number.isInteger(old?.round)&&old.round>=entry.round)return {skipped:"already-claimed"};
 const receipt={...entry,state:"pending"};
 await actor.update({[path]:receipt},hcInternal());
 const initial=hcSnapshot(actor);
 if(!hcAgonyEnabled()||!hcDying(actor)||!hcTurnCurrent(combat,entry)||!hcLeader())return {pending:true};
 let success=false,natural=null,total=null;
 const ongoing=hcOngoingDamage(actor,bleedInfo);
 if(!ongoing){
  // rollAbilityTest builds the native Constitution check, including typed
  // modifiers. The v11.11 d20Roll bonus option is consumed before evaluation.
  const message=await actor.rollAbilityTest("con",{skipDialog:true,dc:10,
   bonus:String(initial.hp)+"["+hcLang("PV négatifs","Negative HP")+"]"});
  const roll=message?.rolls?.[0];
  natural=roll?.natural;total=roll?.total;
  if(!Number.isFinite(natural)||!Number.isFinite(total)||natural<1||natural>20||roll?.isStatic===true)
   throw Error("Native Constitution roll not verified; pending agony receipt requires GM review.");
  success=natural===20||total>=10;
 }
 // No late mutation after turn advance, healing, death, GM handover or
 // unrelated damage during an asynchronous roll. Pending receipt is manual.
 const current=hcSnapshot(actor);
 if(!hcAgonyEnabled()||!hcLeader()||!hcTurnCurrent(combat,entry)||!hcDying(actor)||
    current.hp!==initial.hp)return {pending:true};
 const done={...receipt,state:"applied",success,ongoing,natural,total};
 let healthEvent=null;
 if(success){
  await hcStabilize(actor);
  await actor.update({[path]:done},hcInternal());
 }else{
  // Atomic Actor update: receipt and -1 real HP in the same mutation.
  await actor.update({[path]:done,"system.attributes.hp.value":current.hp-1},hcInternal());
  healthEvent=await hcProcessHealthEvent(actor,current.hp,actor.system.attributes.hp.value,"agony",game.user.id,{transition:false});
 }
 await hcReconcileInternal(actor);
 hcNotifyHealthEvent(actor,healthEvent);
 await hcReport(actor,success?hcLang("Agonie : état stabilisé.","Dying: stabilized."):
  ongoing?hcLang("Agonie : échec automatique (dégâts continus), −1 PV.","Dying: automatic failure (ongoing damage), −1 HP."):
  hcLang("Agonie : échec, −1 PV.","Dying: failed check, −1 HP."));
 return done;
}
let HC_TURN_TAIL=Promise.resolve();
function hcScheduleAgony(combat){
 if(!hcAgonyEnabled()||!hcLeader()||!combat?.started||!Number.isInteger(combat.round)||combat.round<1)return;
 const combatant=combat.combatant,actor=combatant?.actor;
 if(!actor?.uuid||!combatant?.id)return;
 const entry={combatId:combat.id,combatantId:combatant.id,actorUuid:actor.uuid,round:combat.round};
 // Snapshot the turn at hook time, rather than processing a later turn.
 HC_TURN_TAIL=HC_TURN_TAIL.catch(()=>{}).then(async()=>{
  if(!hcTurnCurrent(combat,entry)||!hcLeader()||!hcDying(actor))return;
  // Existing Bleed engine uses its own persistent turn receipt; join it
  // before agony if configured, so death or HP penalty reflects that loss.
  const bleed=hcModule()?.api?.bleed;
  let bleedInfo=null;
  const sources=bleed?.list?.(actor)??[];
  if(sources.length){
   const r=await bleed.process(combat);
   const receipt=bleed.receipts?.().find(x=>x.combatId===entry.combatId&&
    x.combatantId===entry.combatantId&&x.round===entry.round&&x.actorUuid===entry.actorUuid);
   if(r?.pending||receipt?.status!=="applied"||!Number.isFinite(receipt?.appliedAmount))
    throw Error("Bleed outcome not verified; agony requires GM review.");
   bleedInfo={appliedAmount:receipt.appliedAmount,sourceUuids:sources.map(d=>d.uuid)};
  }
  if(!hcTurnCurrent(combat,entry))return;
  return hcEnqueue(actor,current=>hcAgonyTurn(current,entry,combat,bleedInfo));
 }).catch(error=>console.warn("[PF1AE][HealthConditions] Agony turn requires review",entry,error));
}
const HC_STRENUOUS=new Set(["standard","attack","aoo","full","round"]);
const HC_ACTIONS=new WeakMap();
function hcBeforeAction(use){
 if(!hcStrainEnabled()||!use?.actor||!use.action||!hcOwned(use.actor))return;
 const actor=use.actor,s=hcSnapshot(actor),type=use.action.activation?.type;
 if(!s.supported||s.dead||s.nonliving||s.hp>0||
    actor.statuses?.has?.("unconscious")||actor.statuses?.has?.("helpless")||
    !actor.statuses?.has?.("disabled")||!HC_STRENUOUS.has(type))return;
 if(hcSettingForActor(actor)==null||game.settings.get("pf1","unchainedActionEconomy")===true)return;
 // The pre-hook is synchronous; no HP mutation or resource consumption here.
 if(!HC_ACTIONS.has(use))HC_ACTIONS.set(use,{actorUuid:actor.uuid,hp:s.hp,type,
  id:foundry.utils.randomID(),healing:use.action.actionType==="heal"});
}
async function hcAfterAction(use){
 const record=HC_ACTIONS.get(use);
 if(!record||record.completed)return;
 record.completed=true; // native ActionUse is one local process, not per attack
 if(!hcStrainEnabled())return;
 const actor=use.actor,s=hcSnapshot(actor);
 if(actor.uuid!==record.actorUuid||!s.supported||s.dead||s.hp>record.hp||s.hp>0)return;
 // A healing card is posted before its actual healing is applied in PF1.
 // Do not assume it healed the actor, nor charge before the card resolves.
 // Explicit GM adjudication for this path until target-specific damage bridge.
 if(record.healing){
  hcWarn(hcLang("Action de soin à PV négatifs : vérifier manuellement la perte de 1 PV après application des soins.",
   "Healing action at nonpositive HP: adjudicate the 1 HP cost after actual healing."),actor.uuid);
  return;
 }
 if(![...hcArray(game.users)].some(u=>u.active&&u.isGM)&&!hcLeader()){
  hcWarn(hcLang("Aucun MJ connecté : perte de PV à arbitrer manuellement.","No active GM: adjudicate the HP loss manually."),actor.uuid);return;
 }
 const path="flags."+HC_NS+"."+HC_ACTION_COSTS+"."+record.id;
 // Request is data only. The actor owner is already permitted to edit HP.
 // The elected GM consumes the receipt in its per-actor serialized queue.
 await actor.update({[path]:{actorUuid:actor.uuid,state:"pending",type:record.type,
  hpAtStart:record.hp,hpAtCompletion:s.hp,createdAt:Date.now()}});
}
async function hcConsumeActionCosts(actor){
 if(!hcStrainEnabled()||!hcLeader())return;
 const ledger=hcFlag(actor,HC_ACTION_COSTS)??{};
 for(const [id,r] of Object.entries(ledger)){
  if(!/^[a-zA-Z0-9]{1,64}$/.test(id)||r?.state!=="pending")continue;
  const path="flags."+HC_NS+"."+HC_ACTION_COSTS+"."+id,s=hcSnapshot(actor);
  const age=Date.now()-r.createdAt;
  // Never replay stale/ambiguous requests, apply to another actor, or charge
  // a dead/recovered actor. The GM can inspect any review receipt.
  if(r.actorUuid!==actor.uuid||!HC_STRENUOUS.has(r.type)||!Number.isFinite(age)||age<0||age>30000||
     !Number.isFinite(r.hpAtStart)||!Number.isFinite(r.hpAtCompletion)||r.hpAtStart>0||
     r.hpAtCompletion>r.hpAtStart||!s.supported||s.dead||s.nonliving||s.hp>0){
   await actor.update({[path+".state"]:"review"},hcInternal());continue;
  }
  if(!hcLeader()||!hcStrainEnabled())return;
  // Receipt and HP loss commit together: no separate retry of a charge.
  await actor.update({[path+".state"]:"applied","system.attributes.hp.value":s.hp-1},hcInternal());
  const event=await hcProcessHealthEvent(actor,s.hp,actor.system.attributes.hp.value,"strenuous",game.user.id);
  await hcReconcileInternal(actor);hcNotifyHealthEvent(actor,event);
  await hcReport(actor,hcLang("Action éprouvante : −1 PV.","Strenuous action: −1 HP."));
 }
 // Keep bounded applied history without deleting unresolved review rows.
 const completed=Object.entries(hcFlag(actor,HC_ACTION_COSTS)??{}).filter(([,r])=>r?.state==="applied")
  .sort((a,b)=>b[1].createdAt-a[1].createdAt);
 const cleanup={};
 for(const [id] of completed.slice(200))if(/^[a-zA-Z0-9]{1,64}$/.test(id))cleanup["flags."+HC_NS+"."+HC_ACTION_COSTS+".-="+id]=null;
 if(Object.keys(cleanup).length)await actor.update(cleanup,hcInternal());
}

async function hcReconcileInternal(actor){
 if(!hcLeader()||!hcAvailability().available)return {skipped:"unavailable"};
 if(!actor||hcFlag(actor,"healthProbe"))return {skipped:"no-actor"};
 if(hcAgonyEnabled()){
  const s=hcSnapshot(actor);
  if(s.supported&&!s.nonliving&&!s.dead&&s.hp>=0)await hcClearStable(actor);
 }
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
function hcEnqueue(actor,task){
 if(!actor?.uuid||!hcLeader()||!hcAvailability().available)return Promise.resolve({skipped:"unavailable"});
 const key=actor.uuid,prior=HC_WORK.get(key)??Promise.resolve();
 const next=prior.catch(()=>{}).then(async()=>{
  const current=await fromUuid(key);
  if(!current)return {skipped:"actor-missing"};
  return task(current);
 });
 HC_WORK.set(key,next);
 next.then(()=>{if(HC_WORK.get(key)===next)HC_WORK.delete(key)},error=>{
  if(HC_WORK.get(key)===next)HC_WORK.delete(key);
  console.warn("[PF1AE][HealthConditions] Reconcile failed",key,error);
 });
 return next;
}
function hcQueue(actor){return hcEnqueue(actor,hcReconcileInternal)}
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
function hcBuildRecord(actor,sourceUuid,key,options){
 const id=hcRecordId(sourceUuid,key),source=hcItem(actor,sourceUuid);
 if(!source||source.isActive===false||source.activeState===false)throw Error("Source must be an active embedded Item on this exact Actor.");
 const s=hcSnapshot(actor);
 if(!s.supported||s.dead)throw Error("Actor cannot receive a health exception: "+(s.reason??"dead"));
 const suppress=hcPolicyList(options.suppress),apply=hcPolicyList(options.apply);
 if(!suppress.length&&!apply.length)throw Error("Empty health exception.");
 const combatId=options.combatId??null;
 if(combatId!=null&&(!hcValidText(combatId,100)||!hcCombatActive(combatId)))throw Error("Combat is not active.");
 const row={actorUuid:actor.uuid,sourceUuid,key,suppress,apply,combatId};
 return {id,row};
}
async function hcRegister(options){
 const availability=hcAvailability();
 if(!availability.available)throw Error("Health Conditions unavailable: "+availability.reason);
 const {actor,sourceUuid,key}=await hcResolve(options);
 if(HC_EVENT_ACTIVE.has(actor.uuid))throw Error("Use event.register() inside a health Script Call.");
 const {id,row}=hcBuildRecord(actor,sourceUuid,key,options);
 // Individual flat flag path; parallel exceptions cannot replace the registry.
 await actor.update({["flags."+HC_NS+"."+HC_RECORDS+"."+id]:row});
 return {registered:true,id,...(hcLeader()?await hcQueue(actor):{queued:true})};
}
async function hcUnregister(options){
 const {actor,id}=await hcResolve(options);
 if(HC_EVENT_ACTIVE.has(actor.uuid))throw Error("Use event.unregister() inside a health Script Call.");
 // Remove only this source/key tuple. Allow cleanup even when provider disabled.
 await hcDropRecords(actor,[id],{internal:false});
 return {unregistered:true,id,...(hcLeader()?await hcQueue(actor):{queued:true})};
}
async function hcRequestReconcile(actor){
 if(!hcAvailability().available)throw Error("Health Conditions unavailable: "+hcAvailability().reason);
 if(!hcOwned(actor))throw Error("Actor OWNER permission required.");
 if(HC_EVENT_ACTIVE.has(actor.uuid))throw Error("Health event reconciliation is automatic after the Script Call.");
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
   agonyEnabled:hcAgonyEnabled(),strenuousEnabled:hcStrainEnabled(),
   agonyTurns:hcFlag(actor,HC_AGONY_TURNS)??{},actionCosts:hcFlag(actor,HC_ACTION_COSTS)??{},
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
const hcOnActor=(actor,changed,options,userId)=>{
 if(options?.[HC_INTERNAL]||hcFlag(actor,"healthProbe"))return;
 const delta=options?.pf1?.deltas?.hp?.offset,expected=actor.system?.attributes?.hp?.value;
 const real=Number.isFinite(delta)&&delta!==0&&Number.isFinite(expected);
 if(real&&options&&typeof options==="object"&&hcLeader()&&hcAvailability().available){
  // A bulk update may reuse the same options object for different actors.
  const key=JSON.stringify([actor.uuid,expected,delta]);
  let seen=HC_EVENT_OPTIONS.get(options);
  if(!seen)HC_EVENT_OPTIONS.set(options,seen=new Set());
  if(seen.has(key))return;
  seen.add(key);
 }
 void hcEnqueue(actor,async current=>{
  const event=real?await hcProcessHealthEvent(current,expected-delta,expected,"native",userId??null):null;
  // Reconcile and notify before processing a queued action cost (it may
  // produce a separate health event with a different committed HP value).
  const result=await hcReconcileInternal(current);
  hcNotifyHealthEvent(current,event);
  await hcConsumeActionCosts(current);
  return result;
 });
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
 game.settings.register(HC_NS,HC_AGONY,{scope:"world",config:true,type:Boolean,default:false,
  name:"PF1AE.Settings.HealthAgony.Name",hint:"PF1AE.Settings.HealthAgony.Hint"});
 game.settings.register(HC_NS,HC_STRAIN,{scope:"world",config:true,type:Boolean,default:false,
  name:"PF1AE.Settings.HealthStrenuous.Name",hint:"PF1AE.Settings.HealthStrenuous.Hint"});
});
Hooks.once("ready",()=>{
 const mod=hcModule();if(!mod)return;
 hcInstallNativeRouter();hcInstallDisplay();
 mod.api??={};
 mod.api.healthConditions=Object.freeze({
  isAvailable:()=>hcAvailability().available,diagnostics:hcDiagnostics,
  eventHook:HC_EVENT_HOOK,subscriptionName:HC_EVENT_CALL,
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
 Hooks.on("updateCombat",(combat,changes)=>{void hcRestore();
  if(Object.hasOwn(changes??{},"round")||Object.hasOwn(changes??{},"turn"))hcScheduleAgony(combat);
 });
 Hooks.on("combatTurnChange",(combat,prior,current)=>{
  if(prior?.round!==current?.round||prior?.combatantId!==current?.combatantId)hcScheduleAgony(combat);
 });
 Hooks.on("pf1PreActionUse",hcBeforeAction);
 Hooks.on("pf1PostActionUse",use=>{void hcAfterAction(use).catch(e=>console.warn("[PF1AE][HealthConditions] Action cost requires review",e))});
 Hooks.on("deleteCombat",()=>{void hcRestore()});
 Hooks.on("canvasReady",()=>{void hcRestore()});
 Hooks.on("updateUser",(_u,c)=>{if(Object.hasOwn(c??{},"active"))void hcRestore()});
 void hcRestore();
});
