/**
 * PF1AE — conditional native saving-throw bonuses and passive aura discovery.
 * Foundry 13.351 / PF1 11.11. No class, feat or spell-specific rules.
 * No roll replacement, no permanent save changes, and no arbitrary sockets.
 */
const PAS_NS="pf1-automation-engine";
const PAS_SUBSCRIPTION="PF1AE:aura:passive";
const PAS_SEEN=new Map();
const PAS_APPLIED=new WeakMap();
const PAS_LAST=new Map();
let PAS_SCANNING=Promise.resolve();
const pasList=x=>[...(x?.contents??x?.values?.()??x??[])];
const pasLeader=()=>[...(game.users??[])].filter(u=>u.active&&u.isGM)
 .sort((a,b)=>a.id.localeCompare(b.id))[0]?.id===game.user?.id;
const pasEnabled=()=>game.modules.get(PAS_NS)?.active===true;
const pasApi=()=>game.modules.get(PAS_NS)?.api?.proximityAuras;
const pasId=x=>typeof x==="string"&&/^[a-zA-Z0-9_-]{1,80}$/.test(x);
const pasCalls=item=>pasList(item?.scriptCalls??item?.system?.scriptCalls);
const pasSourceItem=(uuid)=>{
 try{return typeof fromUuidSync==="function"?fromUuidSync(uuid):null}
 catch(_){return null}
};
function pasActors(){
 const map=new Map();
 for(const actor of pasList(game.actors))if(actor?.uuid)map.set(actor.uuid,actor);
 for(const scene of pasList(game.scenes))
  for(const token of pasList(scene.tokens))
   if(token?.actor?.uuid)map.set(token.actor.uuid,token.actor);
 return [...map.values()];
}
function pasTokenFor(actor){
 const active=game.scenes?.active??globalThis.canvas?.scene;
 const scenes=[...(active?[active]:[]),...pasList(game.scenes).filter(s=>s!==active)];
 for(const scene of scenes)
  for(const token of pasList(scene.tokens))
   if(token?.actor?.uuid===actor.uuid)return token;
 return null;
}
function pasAllowed(actor,item,call){
 if(call?.category!=="postUse"||call.name!==PAS_SUBSCRIPTION||
  typeof call.execute!=="function"||!call.id&&!call._id)return false;
 return game.modules.get(PAS_NS)?.api?.scriptApprovals?.check?.(actor,item,call)
  ?.approved===true;
}
let PAS_DISCOVERING=null;
function pasDiscover(){
 if(PAS_DISCOVERING)return PAS_DISCOVERING;
 const task=pasDiscoverImpl();
 PAS_DISCOVERING=task;
 void task.finally(()=>{
  if(PAS_DISCOVERING===task)PAS_DISCOVERING=null;
 }).catch(()=>{});
 return task;
}
async function pasDiscoverImpl(){
 if(!pasEnabled()||!pasLeader()||!pasApi())return {skipped:true};
 const found=new Set();let installed=0,blocked=0;
 for(const actor of pasActors()){
  const token=pasTokenFor(actor);
  if(!token)continue;
  for(const item of pasList(actor.items)){
   if(item?.documentName!=="Item"||item.system?.disabled===true)continue;
   const matches=pasCalls(item).filter(call=>call?.category==="postUse"&&
    call.name===PAS_SUBSCRIPTION);
   if(matches.length!==1)continue;
   const call=matches[0],key=item.uuid+"|"+(call.id??call._id);
   found.add(key);
   if(!pasAllowed(actor,item,call)){blocked++;PAS_SEEN.delete(key);continue;}
   const source=call._source??call.toObject?.()??null;
   // Changes to the approved saved script invalidate the current cache.
   const fingerprint=JSON.stringify([source,token.uuid,actor.uuid]);
   if(PAS_SEEN.get(key)===fingerprint)continue;
   try{
    // Native Script Call is run ONLY after the engine's exact-content
    // approval check. No script text is evaluated by PF1AE.
    await call.execute({action:null},{
     restoring:true,sourceItemUuid:item.uuid,emitterActorUuid:actor.uuid,
     emitterTokenUuid:token.uuid,api:pasApi()});
    PAS_SEEN.set(key,fingerprint);installed++;
   }catch(error){
    console.error("[PF1AE][PassiveAuras] approved Script Call failed",item.uuid,error);
   }
  }
 }
 for(const key of [...PAS_SEEN.keys()])
  if(!found.has(key))PAS_SEEN.delete(key);
 return {installed,blocked};
}
function pasScanSoon(){
 if(!pasLeader())return;
 PAS_SCANNING=PAS_SCANNING.catch(()=>{}).then(pasDiscover);
 void PAS_SCANNING.catch(error=>console.error("[PF1AE][PassiveAuras] discovery",error));
}
const pasNormalize=x=>{
 if(typeof x!=="string")return null;
 const t=x.toLowerCase().trim().replace(/[^a-z-]/g,"");
 if(t==="fear"||t==="terreur"||t==="peur")return "fear";
 return t||null;
};
function pasDescriptors(input){
 const arr=input instanceof Set||Object.prototype.toString.call(input)==="[object Set]"
  ?[...input]:Array.isArray(input)?input:
  typeof input==="string"?input.split(/[,;|]/):
  input&&typeof input==="object"?
   Object.entries(input).flatMap(([k,v])=>v===true?[k]:
    typeof v==="string"?[v]:[]):[];
 return arr.map(x=>pasNormalize(typeof x==="string"?x:x?.id??x?.value??x?.name))
  .filter(Boolean);
}
function pasNativeSource(actor,options,save){
 const bridge=game.modules.get(PAS_NS)?.api?.saveContext;
 let source=null;
 if(options?.reference){
  try{source=bridge?._fromNativeSaveOptions?.(actor,save,options)}
  catch(_){}
 }
 const explicit=options?.pf1aeSave;
 const ref=source?.sourceItemUuid??explicit?.sourceItemUuid??null;
 if(!ref)return {status:"unknown",reason:"No verified save source Item"};
 const item=pasSourceItem(ref);
 if(item?.documentName!=="Item")return {status:"unknown",reason:"Save source Item unavailable"};
 const actionId=source?.sourceActionId??explicit?.sourceActionId??null;
 const stored=item.system?.actions;
 const action=actionId&&(stored?.get?.(actionId)??stored?.[actionId])||null;
 const custom=item.getFlag?.(PAS_NS,"saveTraits");
 if(custom?.descriptors!=null&&!Array.isArray(custom.descriptors))
  return {status:"unknown",reason:"Invalid explicit descriptor metadata"};
 const descriptors=[...new Set([
  ...pasDescriptors(item.system?.tags),
  ...pasDescriptors(item.system?.descriptors),
  ...pasDescriptors(item.system?.spellDescriptors),
  ...pasDescriptors(item.system?.spell?.descriptors),
  ...pasDescriptors(action?.tags),
  ...pasDescriptors(action?.descriptors),
  ...pasDescriptors(custom?.descriptors)])];
 if(!descriptors.length)return {status:"unknown",reason:"Save source has no structured descriptors"};
 return {status:"resolved",item,descriptors};
}
/**
 * PF1 native source breakdown: SourceInfo records carry modifier and value.
 * If PF1 does not supply a verified breakdown, do not guess from the total
 * or from a roll formula, because contextual bonuses can already apply.
 */
function pasNativeBonus(actor,saveId,type){
 if(typeof actor?.getSourceDetails!=="function")
  return {status:"uncertain",reason:"PF1 source details unavailable"};
 let sources;
 try{sources=actor.getSourceDetails(
  "system.attributes.savingThrows."+saveId+".total")}
 catch(_){return {status:"uncertain",reason:"PF1 source details exception"}}
 if(!Array.isArray(sources)||!sources.length)
  return {status:"uncertain",reason:"No verified save modifier provenance"};
 const matching=sources.filter(s=>s?.modifier===type);
 if(matching.some(s=>!Number.isFinite(Number(s.value))))
  return {status:"uncertain",reason:"Invalid native typed contribution"};
 const positive=Math.max(0,...matching.map(s=>Number(s.value)));
 return {status:"resolved",value:positive};
}
function pasEvaluate(actor,options,saveId){
 if(!pasEnabled()||!["fort","ref","will"].includes(saveId)||!actor?.uuid)
  return {status:"skipped"};
 const source=pasNativeSource(actor,options,saveId);
 if(source.status!=="resolved")return source;
 const auras=pasApi()?.getSavingThrowAuras?.(actor,saveId,source.descriptors)??[];
 if(!auras.length)return {status:"skipped",reason:"No matching aura"};
 const byType=new Map();
 for(const aura of auras){
  const data=aura.savingThrowBonus;
  byType.set(data.bonusType,Math.max(byType.get(data.bonusType)??0,data.value));
 }
 let extra=0;
 const details=[];
 for(const [type,maximum] of byType){
  if(type==="dodge"||type==="circumstance"||type==="untyped"){
   // A future generic plugin can implement stacking; never guess here.
   return {status:"uncertain",reason:"Unsupported conditional stacking type: "+type};
  }
  const baseline=pasNativeBonus(actor,saveId,type);
  if(baseline.status!=="resolved")return baseline;
  const delta=Math.max(0,maximum-baseline.value);
  extra+=delta;
  details.push({type,maximum,native:baseline.value,effective:delta});
 }
 return {status:"resolved",extra,details,
  sourceItemUuid:source.item.uuid,descriptors:source.descriptors,
  labels:auras.map(a=>a.label).filter(Boolean)};
}
function pasPreRoll(actor,options,saveId){
 if(!options||typeof options!=="object")return;
 if(PAS_APPLIED.has(options))return;
 // PF1 11.11 exposes condition immunities natively. When the save source
 // has a verified descriptor matching one, the native roll is unnecessary.
 // Never infer immunity from name/HTML or from an aura's bonus.
 const source=pasNativeSource(actor,options,saveId);
 if(source.status==="resolved"){
  const immune=actor?.getConditionImmunities?.();
  if(immune&&typeof immune.has==="function"&&
   source.descriptors.some(descriptor=>immune.has(descriptor))){
   PAS_LAST.set(actor?.uuid+":"+saveId,{
    status:"immune",descriptor:source.descriptors.find(d=>immune.has(d)),
    reason:"PF1 native condition immunity"});
   return false; // PF1 calls Hooks.call() before its native d20Roll.
  }
 }
 const result=pasEvaluate(actor,options,saveId);
 PAS_LAST.set(actor?.uuid+":"+saveId,result);
 if(result.status!=="resolved"||result.extra<=0)return;
 const previous=options.bonus;
 if(previous!=null&&!["string","number"].includes(typeof previous))return;
 const current=previous==null||previous===""?"0":String(previous);
 options.bonus="("+current+") + "+result.extra;
 options.pf1aeConditionalAura={
  value:result.extra,sourceItemUuid:result.sourceItemUuid,
  details:result.details,labels:result.labels
 };
 PAS_APPLIED.set(options,result);
}
function pasPostRoll(actor,message,saveId){
 const result=PAS_LAST.get(actor?.uuid+":"+saveId);
 if(result?.status!=="resolved"||result.extra<=0||
  message?.documentName!=="ChatMessage")return;
 // Annotate the already-created native PF1 message, never create a new roll.
 void message.setFlag?.(PAS_NS,"conditionalAuraSave",{
  value:result.extra,details:result.details,labels:result.labels
 }).catch?.(error=>console.warn("[PF1AE][PassiveAuras] message annotation",error));
}
function pasRenderSaveAnnotation(message,html){
 const data=message?.getFlag?.(PAS_NS,"conditionalAuraSave");
 if(!data||!Number.isFinite(data.value)||data.value<=0)return;
 const root=html?.querySelector?html:html?.[0]?.querySelector?html[0]:null;
 const host=root?.querySelector?.(".message-content")??root;
 if(!host||typeof host.append!=="function"||
    host.querySelector?.('[data-pf1ae-aura-save]'))return;
 if(typeof document?.createElement!=="function")return;
 const node=document.createElement("p");
 node.dataset.pf1aeAuraSave="true";
 node.className="notes pf1ae-aura-save";
 const key="PF1AE.PassiveAuras.SaveAnnotation";
 const type=String(data.details?.[0]?.type??"");
 node.textContent=game.i18n?.format?.(key,{value:data.value,type})??
  "Aura conditionnelle : +"+data.value+" ("+type+")";
 host.append(node);
}
Hooks.on("renderChatMessageHTML",pasRenderSaveAnnotation);
Hooks.on("pf1PreActorRollSave",pasPreRoll);
Hooks.on("pf1ActorRollSave",pasPostRoll);
for(const name of ["canvasReady","createToken","deleteToken","createActor",
 "deleteActor","createItem","deleteItem","updateUser"])
 Hooks.on(name,pasScanSoon);
Hooks.on("updateItem",(item,changes)=>{
 if(changes?.system?.scriptCalls||changes?.system?.disabled||changes?.name)
  pasScanSoon();
});
Hooks.on("updateActor",(actor,changes)=>{
 if(changes?.system?.classes||changes?.system?.details?.level||
  changes?.system?.attributes?.hp)pasScanSoon();
});
Hooks.once("ready",()=>{
 const mod=game.modules.get(PAS_NS);
 if(!mod)return;
 mod.api??={};
 mod.api.conditionalSaveAuras=Object.freeze({
  evaluate:pasEvaluate,discover:pasDiscover,
  lastDiagnostic:(actorUuid,saveId)=>PAS_LAST.get(actorUuid+":"+saveId)??null
 });
 pasScanSoon();
});
