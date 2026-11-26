/**
 * Health conditions foundation, PF1 11.11 / Foundry 13.
 * Opt-in, runtime-probed provider. Never deletes direct actor conditions.
 * Health contributions are native transferable effects on dedicated PF1 buffs.
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
 if(!globalThis.pf1?.registry?.conditions?.get||!hcModule()?.api?.generic?.isLeader)
  return {available:false,reason:"native-registry-or-generic-unavailable"};
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
const hcSourceKey=(cause,status)=>cause+":"+status;
function hcSource(item,actor){
 const f=hcFlag(item,HC_SOURCE);
 if(item?.type!=="buff"||f?.version!==1||f.actorUuid!==actor?.uuid||
    !["lethal","nonlethal","probe"].includes(f.cause)||!HC_ALLOWED.has(f.status))return null;
 return f;
}
function hcSourceItems(actor){
 return hcArray(actor.items).filter(i=>hcSource(i,actor));
}
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
 // A deactivated native buff can legitimately have no tracker. Any other
 // effect, added status or mechanical change is unknown provenance.
 return effects.every(e=>e.getFlag?.("pf1","tracker")===true&&
  hcExactStatuses(e.statuses,ids)&&!(e.changes?.length));
}
function hcEffectIsValid(item,actor,status){
 const effect=item?.effect??hcArray(item?.effects).find(e=>e.getFlag?.("pf1","tracker")===true);
 if(!hcSafeCarrier(item,actor)||!effect||effect.transfer!==true||effect.disabled===true||effect.isSuppressed===true||
    !hcStatusIds(status).every(id=>effect.statuses?.has?.(id)))return false;
 // Foundry v13 applies transfer effects from Items, not as Actor.effects.
 const applicable=typeof actor.allApplicableEffects==="function"?[...actor.allApplicableEffects()]:[];
 return applicable.some(e=>e.uuid===effect.uuid)&&hcStatusIds(status).every(id=>actor.statuses?.has?.(id));
}
function hcNativeName(status){
 const condition=pf1.registry.conditions.get(status);
 return game.i18n?.localize?.(condition.name)??condition.name;
}
async function hcCreateSource(actor,cause,status){
 const condition=pf1.registry.conditions.get(status),ids=hcStatusIds(status);
 const name=hcNativeName(status);
 const f={version:1,actorUuid:actor.uuid,cause,status};
 const [item]=await actor.createEmbeddedDocuments("Item",[{
  name,type:"buff",img:condition.texture,
  flags:{[HC_NS]:{[HC_SOURCE]:f}},
  system:{subType:"temp",active:true,conditions:ids,hideFromToken:false},
  effects:[{name,img:condition.texture,type:"buff",transfer:true,disabled:false,
   statuses:ids,flags:{pf1:{tracker:true}},duration:{startTime:game.time.worldTime}}]
 }],hcInternal());
 if(!item)throw Error("Could not create native health contribution.");
 if(!hcEffectIsValid(item,actor,status)){
  await item.delete(hcInternal());
  throw Error("Native transferable health effect could not be verified: "+status);
 }
 return item;
}
// Presentation only: keep native PF1 status choices and normal buffs.
// PF1 11.11 TokenHUDPF._getStatusEffectChoices adds buff-<item id> entries
// in addition to the native condition choices. Managed carriers need no
// separate button, even if inactive. Never filter ordinary buff entries.
function hcDisplayCarrier(item,actor){
 try{return Boolean(item&&actor&&hcSafeCarrier(item,actor))}
 catch(_){return false}
}
function hcFilterHudChoices(choices,actor){
 if(!choices||!actor)return choices;
 const hidden=hcArray(actor.items).filter(i=>hcDisplayCarrier(i,actor));
 if(!hidden.length)return choices;
 const result={...choices};
 for(const item of hidden)delete result["buff-"+item.id];
 return result;
}
// Foundry draws temporary ActiveEffects on tokens. PF1's own isTemporary
// getter implements hideFromToken and overlay visibility. Preserve that
// decision and suppress only duplicate *managed* icons of the same native
// primary status/image, never an ordinary effect or a different condition.
function hcVisibleCarrier(effect,nativeVisible,original){
 if(!nativeVisible)return nativeVisible;
 const actor=effect.actor??effect.parent?.actor;
 if(!hcDisplayCarrier(effect.parent,actor))return nativeVisible;
 if(effect.disabled===true||effect.isSuppressed===true)return nativeVisible;
 if(effect.getFlag?.("core","overlay")===true)return nativeVisible;
 const f=hcSource(effect.parent,actor);
 if(!effect.img||!effect.uuid||typeof actor?.allApplicableEffects!=="function")return nativeVisible;
 for(const other of actor.allApplicableEffects()){
  if(other===effect||other.uuid===effect.uuid||other.disabled===true||
     other.isSuppressed===true||other.img!==effect.img||!other.statuses?.has?.(f.status))continue;
  // Call the unwrapped native getter directly, avoiding recursion.
  if(!original.call(other))continue;
  if(!hcDisplayCarrier(other.parent,actor))return false;
  const of=hcSource(other.parent,actor);
  if(of.status!==f.status)continue;
  if(other.getFlag?.("core","overlay")===true||String(other.uuid)<String(effect.uuid))return false;
 }
 return nativeVisible;
}
const HC_DISPLAY_MARK=Symbol.for("pf1ae.healthConditionDisplay");
function hcInstallDisplay(){
 if(game.system?.id!=="pf1"||game.system?.version!=="11.11"||game.release?.generation!==13)return;
 const hud=globalThis.CONFIG?.Token?.hudClass?.prototype;
 const fn=hud?._getStatusEffectChoices;
 if(typeof fn==="function"&&!fn[HC_DISPLAY_MARK]){
  // PF1's configured HUD subclass, not a global TokenHUD replacement.
  const wrapped=function(...args){
   return hcFilterHudChoices(fn.apply(this,args),this.actor);
  };
  Object.defineProperty(wrapped,HC_DISPLAY_MARK,{value:true});
  hud._getStatusEffectChoices=wrapped;
 }
 const effect=globalThis.CONFIG?.ActiveEffect?.documentClass?.prototype;
 const descriptor=effect&&Object.getOwnPropertyDescriptor(effect,"isTemporary");
 if(descriptor?.configurable&&typeof descriptor.get==="function"&&!descriptor.get[HC_DISPLAY_MARK]){
  const original=descriptor.get;
  const get=function(){
   const visible=original.call(this);
   return hcVisibleCarrier(this,visible,original);
  };
  Object.defineProperty(get,HC_DISPLAY_MARK,{value:true});
  Object.defineProperty(effect,"isTemporary",{...descriptor,get});
 }
}
// Update existing v1.46.0 carriers in place, not via recreation, so source
// provenance, exception keys, duration and independent states survive.
async function hcNormalizeCarrierLabel(item,actor){
 if(!hcDisplayCarrier(item,actor))return;
 const f=hcSource(item,actor),name=hcNativeName(f.status);
 if(item.name!==name)await item.update({name},hcInternal());
 const effect=item.effect??hcArray(item.effects)[0];
 if(effect&&effect.name!==name)await effect.update({name},hcInternal());
}
function hcExternalStatus(actor,status){
 const applicable=typeof actor.allApplicableEffects==="function"?[...actor.allApplicableEffects()]:[];
 return applicable.some(e=>e.disabled!==true&&e.isSuppressed!==true&&
  e.statuses?.has?.(status)&&!hcSafeCarrier(e.parent,actor));
}
async function hcDeleteSource(item,actor){
 if(!hcSafeCarrier(item,actor))
  throw Error("Managed health buff has unknown provenance or was modified; GM review required: "+item.uuid);
 await item.delete(hcInternal());
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
 const existing=hcSourceItems(actor).filter(i=>hcSource(i,actor).cause!=="probe");
 if(!plan.supported){
  // When a previously managed actor is explicitly returned to manual mode,
  // only our own sources are removed; external conditions are never altered.
  for(const item of existing)await hcDeleteSource(item,actor);
  return {skipped:plan.reason};
 }
 if(plan.deathByHealth&&!actor.statuses?.has?.("dead")){
  // Object form avoids PF1 setConditions' boolean track-clearing branch.
  // Never remove Dead here, even on healing; resurrection remains explicit.
  await actor.setCondition("dead",{overlay:true});
  if(!actor.statuses?.has?.("dead"))throw Error("Native Dead condition was not applied.");
  await hcModule()?.api?.deathDefeated?.reconcileActor?.(actor);
 }
 if(plan.dead){
  await hcDropRecords(actor,rows.valid.map(r=>r.id));
 }
 const wanted=new Map(plan.wanted.map(r=>[hcSourceKey(r.cause,r.status),r]));
 const kept=new Set(),remove=[];
 for(const item of existing){
  const f=hcSource(item,actor),key=hcSourceKey(f.cause,f.status);
  if(wanted.has(key)&&!kept.has(key)&&hcEffectIsValid(item,actor,f.status)){
   kept.add(key);await hcNormalizeCarrierLabel(item,actor);
  }
  else remove.push(item);
 }
 // Validate obsolete carriers before creating replacements or deleting any.
 for(const item of remove)if(!hcSafeCarrier(item,actor))throw Error("Modified health carrier needs GM review: "+item.uuid);
 for(const [key,r] of wanted)if(!kept.has(key))await hcCreateSource(actor,r.cause,r.status);
 // Recovery does not stand a fallen creature up. Convert only a verified
 // health-created fall to an ordinary native prone condition before cleanup.
 // A suppression during negative HP removes only our own fall contribution.
 if(!plan.wanted.some(r=>r.status==="prone")&&
    remove.some(i=>{const f=hcSource(i,actor);return f.status==="prone"&&
      (plan.dead||plan.hp>=0||f.cause==="nonlethal")})&&!hcExternalStatus(actor,"prone")){
  await actor.setCondition("prone",true);
  if(!hcExternalStatus(actor,"prone"))throw Error("Could not retain the physical prone state after recovery.");
 }
 for(const item of remove)await hcDeleteSource(item,actor);
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
 return hcSourceItems(actor).length>0||Object.keys(hcFlag(actor,HC_RECORDS)??{}).length>0;
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
  for(const item of hcSourceItems(actor))if(hcSource(item,actor).cause!=="probe")
   await hcDeleteSource(item,actor).catch(e=>console.warn("[PF1AE][HealthConditions] Cleanup needs GM review",e));
  await hcDropRecords(actor,Object.keys(hcFlag(actor,HC_RECORDS)??{}).filter(id=>/^[a-f0-9]+$/.test(id)));
 }
}
function hcDiagnostics(actor){
 const availability=hcAvailability();
 return {...availability,provider:hcProvider(),proof:hcSetting(HC_PROOF,""),
  fingerprint:hcFingerprint(),...(actor?{actorUuid:actor.uuid,plan:hcPlan(actor),
   records:hcRecords(actor).valid,owned:hcSourceItems(actor).map(i=>({uuid:i.uuid,...hcSource(i,actor)})),
   external:[...HC_ALLOWED,"dead","stable"].filter(s=>hcExternalStatus(actor,s))}:{})};
}
// Explicit runtime proof on disposable world and synthetic Actors. The
// provider stays disabled unless both paths preserve independent conditions.
async function hcProbeOne(actor,baseActor=null){
 const checks=[];
 const checkIsolation=()=>{if(baseActor&&([...HC_ALLOWED,"sleep","stable","dead"].some(s=>baseActor.statuses?.has?.(s))||hcSourceItems(baseActor).length))throw Error("Synthetic Actor leaked to world Actor.")};
 for(const status of ["unconscious","prone","disabled","dying","staggered"]){
  const item=await hcCreateSource(actor,"probe",status);
  if(!hcEffectIsValid(item,actor,status))throw Error("Transfer verification failed: "+status);
  checkIsolation();
  await actor.setCondition(status,true);
  checkIsolation();
  if(!hcExternalStatus(actor,status))throw Error("Native independent condition was coalesced: "+status);
  await hcDeleteSource(item,actor);
  if(!actor.statuses?.has?.(status)||!hcExternalStatus(actor,status))throw Error("Independent condition lost: "+status);
  await actor.setCondition(status,false);
  checks.push(status);
 }
 // Also prove an independent secondary condition from a different primary.
 await actor.setCondition("sleep",true);
 const unconscious=await hcCreateSource(actor,"probe","unconscious");
 await hcDeleteSource(unconscious,actor);
 if(!actor.statuses?.has?.("sleep")||!actor.statuses?.has?.("unconscious"))
  throw Error("Sleep provenance lost.");
 await actor.setCondition("sleep",false);
 checks.push("sleep-secondary");
 const dying=await hcCreateSource(actor,"probe","dying");
 await actor.setCondition("stable",true);
 await hcDeleteSource(dying,actor);
 if(!actor.statuses?.has?.("stable"))throw Error("Stable track lost.");
 await actor.setCondition("stable",false);
 checks.push("stable-track");
 // In the opposite order, creating a transferred state must not let
 // native condition-track cleanup erase a pre-existing independent state.
 await actor.setCondition("stable",true);
 const carrier=await hcCreateSource(actor,"probe","disabled");
 checkIsolation();
 if(!hcExternalStatus(actor,"stable"))throw Error("Creating source erased independent track state.");
 await hcDeleteSource(carrier,actor);
 if(!hcExternalStatus(actor,"stable"))throw Error("Removing source erased independent track state.");
 await actor.setCondition("stable",false);
 checks.push("preexisting-track");
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
 hcInstallDisplay();
 mod.api??={};
 mod.api.healthConditions=Object.freeze({
  isAvailable:()=>hcAvailability().available,diagnostics:hcDiagnostics,
  list:actor=>hcRecords(actor).valid.map(r=>({...r,suppress:[...r.suppress],apply:[...r.apply]})),
  register:hcRegister,unregister:hcUnregister,reconcile:hcRequestReconcile,probe:hcProbe
 });
 Hooks.on("updateActor",hcOnActor);
 Hooks.on("updateItem",hcOnItem);
 Hooks.on("createItem",(item,options)=>hcOnItem(item,null,options));
 Hooks.on("deleteItem",(item,options)=>hcOnItem(item,null,options));
 Hooks.on("updateActiveEffect",hcOnEffect);
 Hooks.on("createActiveEffect",(effect,options)=>hcOnEffect(effect,null,options));
 Hooks.on("deleteActiveEffect",(effect,options)=>hcOnEffect(effect,null,options));
 Hooks.on("updateCombat",()=>{void hcRestore()});
 Hooks.on("deleteCombat",()=>{void hcRestore()});
 Hooks.on("canvasReady",()=>{void hcRestore()});
 Hooks.on("updateUser",(_u,c)=>{if(Object.hasOwn(c??{},"active"))void hcRestore()});
 void hcRestore();
});
