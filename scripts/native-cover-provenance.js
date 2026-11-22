/**
 * PF1AE 1.35 — native PF1 11.11 AC source provenance adapter.
 *
 * PF1 ActorPF.getSourceDetails("system.attributes.ac.TYPE.total")
 * returns the source breakdown used by the system's sheet tooltip.
 * Only explicit native 'cover' modifiers are considered pre-existing
 * cover. Ordinary base, armor, Dodge and untyped AC breakdown entries are
 * not cover: do not reject them. This is read-only, never changes Actor AC.
 *
 * Custom bonuses entered as untyped might already include cover; such
 * custom world overrides are outside this simple integration's scope.
 */
const NC_NS="pf1-automation-engine";
const NC_PATHS=Object.freeze({
 normal:"system.attributes.ac.normal.total",
 touch:"system.attributes.ac.touch.total",
 flatFooted:"system.attributes.ac.flatFooted.total"
});
const NC_KNOWN=new Set([
 "untyped","armor","shield","natural","deflection","dodge",
 "circumstance","enhancement","insight","luck","morale","profane",
 "racial","resistance","sacred","size","competence","cover",
 "trait","inherent","base","penalty","misc"
]);
let NC_LAST=null;
const ncClean=x=>foundry.utils.deepClone(x);
function ncResult(status,reason,details={}){
 const result={status,reason,nativeCover:null,...details};
 NC_LAST=ncClean(result);
 return ncClean(result);
}
function ncInspect({actor,defense="normal"}={}){
 if(!actor||typeof actor.getSourceDetails!=="function")
  return ncResult("uncertain","native-source-breakdown-unavailable");
 const path=NC_PATHS[defense];
 if(!path)return ncResult("uncertain","unsupported-defense-type");
 const ac=actor.system?.attributes?.ac?.[defense]?.total;
 if(typeof ac!=="number"||!Number.isFinite(ac))
  return ncResult("uncertain","native-ac-total-unavailable");
 let entries=null;
 try{entries=actor.getSourceDetails(path)}
 catch(error){return ncResult("uncertain","native-source-details-failed",{
  error:String(error?.message??error).slice(0,150)})}
 if(!Array.isArray(entries))
  return ncResult("uncertain","native-source-details-invalid");
 // Only explicit PF1 `modifier: "cover"` sources can count as already
 // applied cover. PF1 11.11 represents ordinary base AC, armor metadata,
 // dodge caps and other sources with null / undefined / "untyped"
 // modifiers. Those are not evidence of cover and must not block +4.
 const cover=[];
 for(const entry of entries){
  if(!entry||typeof entry!=="object")
   return ncResult("uncertain","invalid-native-source-entry");
  if(entry.modifier!=="cover")continue;
  if(entry.disabled===true)continue;
  if(typeof entry.value!=="number"||!Number.isFinite(entry.value))
   return ncResult("uncertain","non-numeric-native-cover-source");
  cover.push(entry.value);
 }
 // A set of active typed cover sources can include negative modifiers.
 // Treat negative cover sources as ambiguous, since their stacking
 // and conversion into the native total are not proven by a tooltip.
 if(cover.some(x=>x<0))
  return ncResult("uncertain","negative-native-cover-source-unverified");
 if(cover.length>1)
  return ncResult("uncertain","multiple-native-cover-sources-unverified");
 return ncResult("resolved","native-pf1-typed-ac-sources",{
  nativeCover:cover[0]??0,defense,path,
  evidenceCount:entries.length,coverSourceCount:cover.length
 });
}

/**
 * Native source provenance for other conditional AC bonus types.
 * Source details belong to each PF1 AC variant, never to the actor's
 * global bonus ledger. Fail closed on ambiguous or untyped contributions.
 */
function ncInspectTypes({actor,defense="normal",types=[]}={}){
  if(!Array.isArray(types)||types.some(t=>typeof t!=="string"||!NC_KNOWN.has(t)))
    return {status:"uncertain",reason:"invalid-requested-native-bonus-types"};
  const unique=[...new Set(types)];
  if(!unique.length)return {status:"resolved",nativeTypes:{},defense};
  const base=ncInspect({actor,defense});
  if(base.status!=="resolved")return {status:"uncertain",reason:base.reason};
  const path=NC_PATHS[defense];
  let entries;
  try{entries=actor.getSourceDetails(path)}catch(_){
    return {status:"uncertain",reason:"native-source-details-failed"};
  }
  if(!Array.isArray(entries))return {status:"uncertain",reason:"native-source-details-invalid"};
  const nativeTypes={};
  for(const type of unique){
    const sources=entries.filter(e=>e?.modifier===type&&e.disabled!==true);
    if(sources.some(e=>typeof e.value!=="number"||!Number.isFinite(e.value)||e.value<0))
      return {status:"uncertain",reason:"ambiguous-native-"+type+"-source"};
    // PF1 source-details are contributions, not a guarantee of stacking
    // when more than one non-stacking source reports the same bonus type.
    if(sources.length>1&&!["dodge","circumstance","untyped"].includes(type))
      return {status:"uncertain",reason:"multiple-native-"+type+"-sources"};
    nativeTypes[type]=["dodge","circumstance","untyped"].includes(type)
      ?sources.reduce((n,e)=>n+e.value,0):(sources[0]?.value??0);
  }
  return {status:"resolved",reason:"native-pf1-typed-ac-sources",
    defense,path,nativeTypes,evidenceCount:entries.length};
}

Hooks.once("ready",()=>{
 const mod=game.modules.get(NC_NS);
 if(!mod)return;mod.api??={};
 mod.api.nativeCover=Object.freeze({
  inspect:ncInspect,
  inspectTypes:ncInspectTypes,lastDiagnostic:()=>NC_LAST?ncClean(NC_LAST):null
 });
});
