/**
 * PF1AE 1.35 — native PF1 11.11 AC source provenance adapter.
 *
 * PF1 ActorPF.getSourceDetails("system.attributes.ac.TYPE.total")
 * returns the source breakdown used by the system's sheet tooltip.
 * A missing/non-numeric or ambiguous entry makes cover baseline unknown.
 * A typed 'cover' source is read ONLY, never applied to an Actor.
 *
 * The native adapter deliberately cannot prove semantic intent of
 * custom untyped bonuses, manual sheet edits or third-party overrides.
 * It declines uncertain categories rather than double adding cover.
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
 const cover=[];
 for(const entry of entries){
  if(!entry||typeof entry!=="object")
   return ncResult("uncertain","invalid-native-source-entry");
  const type=entry.modifier;
  const name=typeof entry.name==="string"?entry.name:"";
  // A bonus with no reliable type could represent cover,
  // regardless of its apparent label. Do not infer the answer.
  if(type==null||type==="untyped"||type==="misc"){
   if(typeof entry.value==="number"&&entry.value===0)continue;
   return ncResult("uncertain","untyped-or-unclassified-native-ac-source",{
    ambiguousSource:name.slice(0,120)});
  }
  if(typeof type!=="string"||!NC_KNOWN.has(type))
   return ncResult("uncertain","unknown-native-ac-modifier-type",{
    modifier:String(type).slice(0,70)});
  if(type!=="cover")continue;
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
Hooks.once("ready",()=>{
 const mod=game.modules.get(NC_NS);
 if(!mod)return;mod.api??={};
 mod.api.nativeCover=Object.freeze({
  inspect:ncInspect,lastDiagnostic:()=>NC_LAST?ncClean(NC_LAST):null
 });
});
