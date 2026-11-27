/**
 * Generic native conditions, PF1 11.11 / Foundry 13.
 * Registry definitions and source-specific native ActiveEffects; no spell or
 * special ability rules. Player-to-GM requests use authenticated Actor writes.
 */
const CN="pf1-automation-engine",DEFS="customConditionDefinitions",APPROVALS="conditionApprovals";
const SOURCE="conditionSource",REQUEST="conditionRequest",ACK="conditionAck";
const builtins=Object.freeze({
 fascinated:{texture:"fascinated",changes:[{target:"skill.per",formula:"-4",type:"untyped"}],
  journal:"Compendium.pf1.pf1e-rules.JournalEntry.NSqfXaj4MevUR2uJ.JournalEntryPage.Hy0MHwpRRr5QxVj5"},
 burning:{texture:"burning"},energyDrained:{texture:"energyDrained",
  journal:"Compendium.pf1.pf1e-rules.JournalEntry.NSqfXaj4MevUR2uJ.JournalEntryPage.onMPh2re6fIeNgNr"},
 anchored:{texture:"anchored"},immobilized:{texture:"immobilized"},slowed:{texture:"slowed"}
});
const arr=x=>Array.isArray(x)?x:x?.contents??(typeof x?.values==="function"?[...x.values()]:[]);
const api=()=>game.modules.get(CN)?.api;
const gm=()=>arr(game.users).filter(u=>u.isGM&&u.active).sort((a,b)=>a.id.localeCompare(b.id))[0];
const leader=()=>game.user?.isGM===true&&gm()?.id===game.user.id;
const compatible=()=>game.system?.id==="pf1"&&game.system?.version==="11.11"&&game.release?.generation===13&&
 !game.modules.get("pf1-improved-conditions")?.active;
const registry=()=>globalThis.pf1?.registry?.conditions;
const available=()=>compatible()&&game.settings.get(CN,"genericEnabled")===true&&
 api()?.healthConditions?.nativeRouterAvailable?.()===true&&typeof registry()?.get==="function";
const flag=(d,k)=>d?.getFlag?.(CN,k)??d?.flags?.[CN]?.[k];
const setting=k=>game.settings.get(CN,k)??[];
const uuid=d=>typeof d==="string"?d:d?.uuid;
const idOk=s=>typeof s==="string"&&/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(s);
const keyOk=s=>typeof s==="string"&&/^[a-zA-Z0-9_-]{1,80}$/.test(s);
const uuidOk=s=>typeof s==="string"&&s.length>0&&s.length<=400;
const exact=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const statuses=id=>[...new Set([id,...(registry()?.get(id)?.statuses??[])])];
const permission=(a,u)=>Boolean(u?.active&&(u.isGM||a?.testUserPermission?.(u,"OWNER")));
const actorDoc=async id=>{if(!uuidOk(id))throw Error("Invalid Actor UUID.");const a=await fromUuid(id);
 if(a?.documentName!=="Actor"||a.uuid!==id)throw Error("Exact Actor unavailable: "+id);return a};
const itemDoc=async id=>{if(!uuidOk(id))throw Error("Invalid source Item UUID.");const i=await fromUuid(id),a=i?.actor??i?.parent;
 if(i?.documentName!=="Item"||i.uuid!==id||a?.documentName!=="Actor")throw Error("Embedded source Item required.");return {item:i,actor:a}};
const validSource=i=>i.isActive!==false&&i.activeState!==false;
let settingsRegistered=false;
function registerSettings(){
 if(settingsRegistered)return;settingsRegistered=true;
 game.settings.register(CN,DEFS,{scope:"world",config:false,type:Array,default:[]});
 game.settings.register(CN,APPROVALS,{scope:"world",config:false,type:Array,default:[]});
}
function definition(data){
 // GM-only declarative definitions. No secondary statuses, tracks, arbitrary
 // paths, script calls, flags, rolls or formulas from a player request.
 if(!/^pf1ae-[a-z][a-z0-9_-]{0,63}$/.test(data?.id??"")||typeof data.name!=="string"||
  !data.name.trim()||data.name.length>100||/[<>]/.test(data.name)||
  typeof data.img!=="string"||! /^(?:icons|systems|modules)\/[a-zA-Z0-9_./ -]+\.(?:svg|png|webp|jpg|jpeg)$/i.test(data.img)||
  data.img.includes(".."))throw Error("Invalid custom condition ID, name or local image.");
 const changes=data.changes??[];
 if(!Array.isArray(changes)||changes.length>12||changes.some(c=>
  !/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(c?.target??"")||!Number.isSafeInteger(c.value)||
  Math.abs(c.value)>100||c.target.includes("..")||c.target.split(".").some(k=>["__proto__","prototype","constructor"].includes(k))))
  throw Error("Condition changes must be bounded numeric PF1 change targets.");
 return {id:data.id,name:data.name.trim(),img:data.img,changes:changes.map(c=>({target:c.target,value:c.value}))};
}
function registerNative(reg){
 registerSettings();
 if(!compatible())return;
 for(const [id,d] of Object.entries(builtins)){
  if(reg.has(id))continue; // do not overwrite a native/third-party entry
  reg.register(CN,id,{name:"PF1AE.Conditions."+id,texture:"modules/"+CN+"/icons/conditions/"+d.texture+".svg",
   journal:d.journal??null,mechanics:{changes:d.changes??[],flags:[],contexts:[]},track:null});
 }
 for(const raw of setting(DEFS)){
  try{
   const d=definition(raw);
   if(reg.has(d.id))throw Error("Condition ID already registered: "+d.id);
   reg.register(CN,d.id,{name:d.name,texture:d.img,track:null,
    mechanics:{changes:d.changes.map(c=>({target:c.target,formula:String(c.value),type:"untyped"})),flags:[],contexts:[]}});
  }catch(e){console.warn("[PF1AE][Conditions] Invalid custom definition",e)}
 }
}
Hooks.on("pf1RegisterConditions",registerNative);
Hooks.once("init",registerSettings);
let tail=Promise.resolve();
function queue(fn){const next=tail.catch(()=>{}).then(fn);tail=next.catch(()=>{});return next}
function requireGM(){if(!leader()||!compatible())throw Error("Compatible system and elected GM required.")}
async function register(data){
 requireGM();const d=definition(data);
 return queue(async()=>{
  if(registry()?.has(d.id)||setting(DEFS).some(x=>x.id===d.id))throw Error("Condition ID already exists.");
  await game.settings.set(CN,DEFS,[...setting(DEFS),d]);
  // PF1 builds CONFIG.statusEffects and condition metadata in init.
  // Never hot-mutate a live world registry across clients.
  return {registered:true,id:d.id,reloadRequired:true};
 });
}
function condition(id){
 if(!idOk(id))throw Error("Invalid condition ID.");
 const c=registry()?.get(id);
 if(!c)throw Error("PF1 condition not registered: "+id);
 // Tracked conditions (dying, fear, movement, etc.) have mutual-exclusion
 // semantics in PF1. Do not silently override these rules via this API.
 if(statuses(id).some(x=>x==="dead"||registry().get(x)?.track))
  throw Error("Tracked conditions require native/health-specific handling: "+id);
 return c;
}
async function approve(data){
 requireGM();const {item}=await itemDoc(uuid(data?.sourceUuid));condition(data?.conditionId);
 const r={sourceUuid:item.uuid,conditionId:data.conditionId};
 return queue(async()=>{
  const rows=setting(APPROVALS).filter(x=>x.sourceUuid!==r.sourceUuid||x.conditionId!==r.conditionId);
  await game.settings.set(CN,APPROVALS,[...rows,r]);return {approved:true,...r};
 });
}
async function revoke(data){
 requireGM();const sourceUuid=uuid(data?.sourceUuid),conditionId=data?.conditionId;
 return queue(async()=>{await game.settings.set(CN,APPROVALS,setting(APPROVALS).filter(x=>x.sourceUuid!==sourceUuid||x.conditionId!==conditionId));return {revoked:true}});
}
function owned(e,actor){
 const f=flag(e,SOURCE);
 if(!f||f.version!==1||f.targetUuid!==actor?.uuid||e.parent?.uuid!==actor.uuid||
    !uuidOk(f.sourceUuid)||!uuidOk(f.sourceActorUuid)||!keyOk(f.key)||!idOk(f.conditionId)||
    e.origin!==f.sourceUuid||e.transfer===true||e.changes?.length||!e.statuses?.size||
    !registry()?.has(f.conditionId)||!exact(e.statuses,statuses(f.conditionId)))return null;
 return f;
}
// Existing save-outcome AEs also have source-specific lifetime. Protect
// their native status from unrelated manual setCondition calls. Track states
// remain in the native track engine (not supported by this generic router).
function protectedStatus(e,actor){
 const f=owned(e,actor);if(f)return f.conditionId;
 const sourceItemUuid=flag(e,"sourceItemUuid"),outcomeId=flag(e,"outcomeId");
 if(!sourceItemUuid||!outcomeId||e.origin!==sourceItemUuid||e.parent?.uuid!==actor?.uuid||
    e.transfer===true||e.changes?.length||!e.statuses?.size)return null;
 for(const id of e.statuses){
  try{condition(id);if(exact(e.statuses,statuses(id)))return id}catch(_){}
 }
 return null;
}
function allActors(){
 const rows=new Map();
 for(const a of arr(game.actors))if(a?.uuid)rows.set(a.uuid,a);
 for(const scene of arr(game.scenes))for(const t of arr(scene.tokens))if(t.actor?.uuid)rows.set(t.actor.uuid,t.actor);
 return [...rows.values()];
}
function sources(a,id){
 if(!a?.uuid)return [];
 const effects=typeof a.allApplicableEffects==="function"?[...a.allApplicableEffects()]:arr(a.effects);
 return effects.filter(e=>e.disabled!==true&&e.isSuppressed!==true&&(!id||e.statuses?.has?.(id)))
  .map(e=>({effectUuid:e.uuid,statuses:[...(e.statuses??[])],sourceUuid:owned(e,a)?.sourceUuid??e.origin??null,
   managed:Boolean(owned(e,a)),key:owned(e,a)?.key??null}));
}
function timing(data,source){
 if(data.duration!=null&&data.timing!=null)throw Error("Choose duration OR timing.");
 if(data.duration!=null){
  const d=data.duration,scale={seconds:1,rounds:6,minutes:60,hours:3600};
  if(!Object.hasOwn(scale,d.unit??"")||!Number.isSafeInteger(d.value)||d.value<1||d.value*scale[d.unit]>31536000)
   throw Error("Invalid elapsed duration.");
  return {kind:"duration",duration:{value:d.value,unit:d.unit}};
 }
 if(data.timing!=null){
  if(!["endOfCurrentTurn","startOfNextTurn","endOfNextTurn","turnStart","turnEnd"].includes(data.timing))
   throw Error("Invalid turn timing.");
  const combat=data.combatId?game.combats?.get(data.combatId):game.combat;
  const matches=arr(combat?.combatants).filter(c=>c.actor?.uuid===source.uuid&&(!data.combatantId||c.id===data.combatantId));
  const occurrences=data.occurrences??1;
  if(!combat?.started||matches.length!==1||!Number.isInteger(occurrences)||occurrences<1||occurrences>10000||
   (data.timing==="endOfCurrentTurn"&&combat.combatant?.id!==matches[0].id))throw Error("Unambiguous source combatant required.");
  return {kind:"turn",combatId:combat.id,combatantId:matches[0].id,timing:data.timing,occurrences};
 }
 return {kind:"manual"};
}
function match(e,a,d){
 const f=owned(e,a);
 return f&&f.sourceUuid===d.sourceUuid&&f.sourceActorUuid===d.sourceActorUuid&&f.key===d.key&&f.conditionId===d.conditionId;
}
function timerApi(f){return f.timerKind==="duration"?api()?.duration:api()?.generic}
async function removeEffect(e,a){
 const f=owned(e,a);if(!f)throw Error("Modified source; GM review required.");
 await e.delete();
 // Timer callbacks may be running. Do not wait on their queue in the
 // delete hook; direct removal here can safely cancel the exact timer.
 if(f.timerId)await timerApi(f)?.cancelTimer(f.timerId);
}
async function run(op,data,requester,authActor=null){
 if(!available()||!leader())throw Error("Conditions engine unavailable.");
 const {item,actor:source}=await itemDoc(data.sourceUuid);
 if(!permission(source,requester)||authActor&&authActor.uuid!==source.uuid)throw Error("Authenticated source OWNER required.");
 if(!keyOk(data.key))throw Error("Invalid source key.");
 const c=condition(data.conditionId);
 if(op==="apply"&&!validSource(item))throw Error("Source Item inactive.");
 const query={sourceUuid:item.uuid,sourceActorUuid:source.uuid,key:data.key,conditionId:data.conditionId};
 const explicit=data.targets!=null;
 if(explicit&&(!Array.isArray(data.targets)||!data.targets.length||data.targets.length>30||data.targets.some(x=>!uuidOk(x))))
  throw Error("1–30 exact target Actor UUIDs required.");
 if(op==="apply"&&!explicit)throw Error("Explicit targets required.");
 const targets=explicit?await Promise.all([...new Set(data.targets)].map(actorDoc)):allActors();
 if(op==="apply"){
  const approved=setting(APPROVALS).some(r=>r.sourceUuid===item.uuid&&r.conditionId===data.conditionId);
  if(targets.some(t=>!permission(t,requester))&&!approved)throw Error("Cross-owner condition application requires GM approval for this Item and condition.");
  const duration=timing(data,source);
  const copies=[],results=[];
  try{
   for(const target of targets){
    if(!leader()||!available())throw Error("Conditions authority changed.");
    const existing=arr(target.effects).find(e=>match(e,target,query));
    if(existing){results.push({targetUuid:target.uuid,effectUuid:existing.uuid,duplicate:true});continue}
    const immunities=target.getConditionImmunities?.();
    if(typeof immunities?.has!=="function")throw Error("PF1 condition immunity API unavailable.");
    if(statuses(query.conditionId).some(id=>immunities.has(id))){
     results.push({targetUuid:target.uuid,immune:true});continue;
    }
    const timerId=duration.kind==="manual"?null:"condition:"+foundry.utils.randomID();
    const flags={version:1,...query,targetUuid:target.uuid,timerId,timerKind:duration.kind};
    const [e]=await target.createEmbeddedDocuments("ActiveEffect",[{name:c.name,img:c.texture,origin:item.uuid,
     statuses:statuses(query.conditionId),transfer:false,disabled:false,changes:[],flags:{[CN]:{[SOURCE]:flags}}}]);
    if(!e)throw Error("Native condition creation failed.");
    copies.push([e,target]);
    if(!owned(e,target)||!statuses(query.conditionId).every(id=>target.statuses?.has?.(id)))throw Error("Native condition verification failed.");
    if(duration.kind==="duration")await api().duration.schedule({id:timerId,effectUuid:e.uuid,effectAction:"delete",duration:duration.duration});
    if(duration.kind==="turn")await api().generic.scheduleTurn({id:timerId,effectUuid:e.uuid,effectAction:"delete",
     combatId:duration.combatId,combatantId:duration.combatantId,timing:duration.timing,occurrences:duration.occurrences});
    results.push({targetUuid:target.uuid,effectUuid:e.uuid,timerId});
   }
   return {applied:true,results};
  }catch(error){
   for(const [e,target] of copies)try{await removeEffect(e,target)}catch(cleanup){console.warn("[PF1AE][Conditions] Rollback needs GM review",e.uuid,cleanup)}
   throw error;
  }
 }
 if(op!=="remove"&&op!=="extend")throw Error("Unknown condition operation.");
 if(op==="extend"&&(!Number.isInteger(data.rounds)||data.rounds<1||data.rounds>10000))throw Error("Positive extension in rounds required.");
 const result=[];
 for(const a of targets)for(const e of arr(a.effects)){
  if(!match(e,a,query))continue;
  const f=owned(e,a);
  if(op==="remove"){await removeEffect(e,a);result.push(e.uuid)}
  else{
   if(!f.timerId)throw Error("Cannot extend an untimed condition.");
   const ext=f.timerKind==="duration"?{duration:{value:data.rounds,unit:"rounds"}}:{rounds:data.rounds};
   await timerApi(f).extendTimer(f.timerId,ext);result.push(e.uuid);
  }
 }
 return {[op==="remove"?"removed":"extended"]:result.length,effects:result};
}
const pending=new Map(),seen=new Set();
function field(changes,key){return changes?.flags?.[CN]?.[key]??changes?.["flags."+CN+"."+key]}
function ack(actor,r,userId){
 const p=pending.get(r?.requestId);
 if(!p||p.actorUuid!==actor.uuid||gm()?.id!==userId)return;
 pending.delete(r.requestId);clearTimeout(p.timer);
 r.ok?p.resolve(r.result):p.reject(Error(r.error??"Condition request refused."));
}
function onActor(actor,changes,options,userId){
 const response=field(changes,ACK);if(response)ack(actor,response,userId);
 const r=field(changes,REQUEST);
 if(!r||!leader()||!keyOk(r.requestId)||!["apply","remove","extend"].includes(r.op))return;
 const k=actor.uuid+"/"+r.requestId;
 if(seen.has(k))return;seen.add(k);if(seen.size>3000)seen.clear();
 void queue(async()=>{
  let result,error;
  try{
   const user=game.users.get?.(userId)??arr(game.users).find(u=>u.id===userId);
   if(!permission(actor,user))throw Error("Authenticated OWNER required.");
   result=await run(r.op,r.data,user,actor);
  }catch(e){error=String(e?.message??e)}
  await actor.update({["flags."+CN+"."+ACK]:{requestId:r.requestId,ok:!error,result:result??null,error:error??null}});
 }).catch(e=>console.warn("[PF1AE][Conditions] Acknowledgement failed",e));
}
async function request(op,d){
 if(!available())throw Error("Conditions engine unavailable.");
 const {item,actor}=await itemDoc(uuid(d?.sourceUuid));
 if(!permission(actor,game.user))throw Error("Source OWNER required.");
 const data={sourceUuid:item.uuid,key:d.key,conditionId:d.conditionId,targets:d.targets?.map(uuid),
  duration:d.duration,timing:d.timing,combatId:d.combatId,combatantId:d.combatantId,occurrences:d.occurrences,rounds:d.rounds};
 // Only JSON data is transmitted, no script or mechanical payload.
 const payload=JSON.parse(JSON.stringify(data));
 if(leader())return queue(()=>run(op,payload,game.user,actor));
 if(!gm())throw Error("Active GM required.");
 const requestId=foundry.utils.randomID();
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(requestId);reject(Error("Condition request timed out."))},15000);
  pending.set(requestId,{actorUuid:actor.uuid,resolve,reject,timer});
  actor.update({["flags."+CN+"."+REQUEST]:{requestId,op,data:payload}}).catch(e=>{
   pending.delete(requestId);clearTimeout(timer);reject(e);
  });
 });
}
function cleanup(sourceUuid=null){
 if(!available()||!leader())return;
 void queue(async()=>{
  for(const a of allActors())for(const e of arr(a.effects)){
   const f=owned(e,a);if(!f||sourceUuid&&f.sourceUuid!==sourceUuid)continue;
   const source=await fromUuid(f.sourceUuid);
   if(source?.documentName==="Item"&&(source.actor??source.parent)?.uuid===f.sourceActorUuid)continue;
   try{await removeEffect(e,a)}catch(error){console.warn("[PF1AE][Conditions] Orphan cleanup needs GM review",e.uuid,error)}
  }
 }).catch(e=>console.warn("[PF1AE][Conditions] Cleanup failed",e));
}
Hooks.once("ready",()=>{
 const mod=game.modules.get(CN);if(!mod)return;mod.api??={};
 mod.api.conditions=Object.freeze({
  isAvailable:available,register,approve,revoke,
  apply:d=>request("apply",d),remove:d=>request("remove",d),extend:d=>request("extend",d),
  has:(a,id)=>a?.statuses?.has?.(id)===true,
  list:()=>arr(registry()).map(c=>({id:c.id,name:c.name,img:c.texture,track:c.track??null,namespace:c.namespace})),
  getSources:sources,_protectedStatus:protectedStatus
 });
 Hooks.on("updateActor",onActor);
 Hooks.on("deleteItem",item=>cleanup(item.uuid));
 Hooks.on("canvasReady",()=>cleanup());
 Hooks.on("updateUser",(_u,c)=>{if(Object.hasOwn(c??{},"active"))cleanup()});
 cleanup();
});
