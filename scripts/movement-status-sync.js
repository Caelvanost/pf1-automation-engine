/**
 * PF1AE — Foundry v13 / PF1 v11.11 movement ↔ native status synchronization.
 * The token's selected movement is TokenDocument.movementAction.
 * PF1's own status registry and Actor.toggleStatusEffect are authoritative;
 * no duplicate or synthetic "Fly"/"Swim" effects are created.
 */
const MS_NS="pf1-automation-engine";
const MS_ACTIONS=new Set(["fly","swim"]);
const MS_BUSY_ACTORS=new Set();
const MS_BUSY_TOKENS=new Set();

function msKey(doc){
 return doc?.uuid??(doc?.parent?.id&&doc?.id?
  doc.parent.id+"."+doc.id:doc?.id);
}
function msNorm(value){
 return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLowerCase().replace(/[^a-z]/g,"");
}
const MS_NAMES={
 fly:new Set(["fly","flying","vol","voler","envol","envolant","pf1flying","pf1fly"]),
 swim:new Set(["swim","swimming","nage","nager","nageant","pf1swimming","pf1swim"])
};
function msTypeFromText(value){
 const norm=msNorm(value);
 return norm&&MS_NAMES.fly.has(norm)?"fly":
  norm&&MS_NAMES.swim.has(norm)?"swim":null;
}
function msRegistryEntries(){
 const registry=globalThis.CONFIG?.statusEffects;
 if(!registry)return [];
 const entries=registry instanceof Map?[...registry.entries()]:
  Array.isArray(registry)?registry.map((v,i)=>[String(v?.id??i),v]):
  Object.entries(registry);
 return entries.map(([key,val])=>({
  id:String(val?.id??key),
  name:String(val?.name??val?.label??""),
  label:String(val?.label??val?.name??"")
 }));
}
function msResolve(){
 const result=new Map(),entries=msRegistryEntries();
 for(const type of MS_ACTIONS){
  const matches=entries.filter(e=>
   msTypeFromText(e.id)===type||
   msTypeFromText(e.name)===type||
   msTypeFromText(e.label)===type||
   msTypeFromText(game.i18n?.localize?.(e.name))===type||
   msTypeFromText(game.i18n?.localize?.(e.label))===type);
  // Stable native IDs before translated labels. Never invent an ID.
  matches.sort((a,b)=>{
   const score=e=>msTypeFromText(e.id)===type?0:1;
   return score(a)-score(b)||a.id.localeCompare(b.id);
  });
  if(matches.length)result.set(type,matches[0].id);
 }
 return result;
}
/**
 * PF1 Levitation is a separate native effect, NOT the Flying condition.
 * It implies the token's selected Foundry movement mode is Fly, but does
 * not grant a fly speed, horizontal movement or standard flight mechanics.
 * Never synthesize or toggle a Levitation/Flying status to implement this.
 */
const MS_LEVITATION_NAMES=new Set([
 // PF1 native condition: "Levitating" (not a required spell or Buff).
 "levitating","levitation","pf1levitating","pf1levitation"
]);
const msLevitationText=x=>MS_LEVITATION_NAMES.has(msNorm(x));
function msLevitationIds(){
 const result=new Set();
 for(const status of msRegistryEntries()){
  if([status.id,status.name,status.label,
   game.i18n?.localize?.(status.name),
   game.i18n?.localize?.(status.label)].some(msLevitationText))
   result.add(status.id);
 }
 return result;
}
function msEffectIsLevitation(effect,ids=msLevitationIds()){
 if(!effect)return false;
 const statuses=effect.statuses instanceof Set?[...effect.statuses]:
  Array.isArray(effect.statuses)?effect.statuses:[];
 return [effect.name,effect.label,...statuses].some(msLevitationText)||
  statuses.some(id=>ids.has(id));
}
function msIsLevitating(actor){
 const ids=msLevitationIds();
 const statuses=actor?.statuses;
 if(statuses&&[...statuses].some(id=>ids.has(id)||msLevitationText(id)))
  return true;
 const effects=actor?.effects?.contents??
  (actor?.effects?.values?[...actor.effects.values()]:actor?.effects??[]);
 return Array.from(effects).some(effect=>
  !effect.disabled&&msEffectIsLevitation(effect,ids));
}
function msTypeFromEffect(effect,ids){
 if(!effect)return null;
 const statuses=effect.statuses instanceof Set?[...effect.statuses]:
  Array.isArray(effect.statuses)?effect.statuses:[];
 for(const [type,id] of ids){
  if(statuses.includes(id))return type;
 }
 const idMatches=statuses.map(msTypeFromText).filter(Boolean);
 if(idMatches.length)return idMatches[0];
 // Some native PF1 effects expose their label but not a statuses Set.
 return msTypeFromText(effect.name??effect.label);
}
function msIsActive(actor,type,ids){
 const id=ids.get(type);
 if(!id)return false;
 if(actor?.statuses?.has?.(id))return true;
 const effects=actor?.effects?.contents??
  (actor?.effects?.values?[...actor.effects.values()]:actor?.effects??[]);
 return Array.from(effects).some(e=>
  !e.disabled&&msTypeFromEffect(e,ids)===type);
}
function msActorTokens(actor){
 const scene=globalThis.canvas?.scene;
 const tokens=globalThis.canvas?.tokens?.placeables??[];
 // TokenDocument.actor may be another wrapper of the same synthetic Actor.
 // Compare stable Actor UUID instead of JS object identity, which fails
 // with native token HUD statuses and some PF1 v11.11 sheet contexts.
 return tokens.map(t=>t?.document??t).filter(doc=>
  actor?.uuid&&doc?.actor?.uuid===actor.uuid&&
  (!scene||doc.parent?.id===scene.id));
}
function msCanWrite(actor){
 if(game.system?.id!=="pf1")return false;
 const gm=game.users?.activeGM;
 if(gm)return gm.id===game.user?.id;
 return Boolean(actor?.isOwner||game.user?.isGM);
}
async function msSetMovement(doc,type){
 if(!doc||typeof doc.update!=="function"||
   doc.movementAction===type)return;
 const key=msKey(doc);
 if(!key||MS_BUSY_TOKENS.has(key))return;
 MS_BUSY_TOKENS.add(key);
 try{await doc.update({movementAction:type});}
 finally{MS_BUSY_TOKENS.delete(key);}
}
async function msSyncFromEffect(effect,operation){
 const parent=effect?.parent;
 const actor=parent?.actor??(parent?.uuid&&parent?.statuses?parent:null);
 if(!actor||!msCanWrite(actor))return;
 const ids=msResolve();
 const levitation=msEffectIsLevitation(effect);
 const type=levitation?"fly":msTypeFromEffect(effect,ids);
 if(!type||(!ids.has(type)&&!levitation))return;
 const key=msKey(actor);
 if(!key||MS_BUSY_ACTORS.has(key))return;
 MS_BUSY_ACTORS.add(key);
 try{
  // Check the Actor's remaining effects rather than treating deletion
  // of one condition as deletion of every source of the same movement.
  const statusActive=type==="fly"?
   (msIsActive(actor,"fly",ids)||msIsLevitating(actor)):
   msIsActive(actor,type,ids);
  // When the effect becomes inactive, the other native movement effect,
  // if still active, takes priority. Otherwise return to normal walk.
  let movement=statusActive?type:
   (type==="swim"?
      (msIsActive(actor,"fly",ids)||msIsLevitating(actor)):
      msIsActive(actor,"swim",ids))?
    (type==="fly"?"swim":"fly"):"walk";
  // Disabling/removing one condition must not override an unrelated,
  // manually selected movement type.
  for(const token of msActorTokens(actor)){
   if(!statusActive&&token.movementAction!==type)continue;
   await msSetMovement(token,movement);
  }
 }catch(error){console.warn("PF1AE | movement effect sync",error);}
 finally{MS_BUSY_ACTORS.delete(key);}
}
async function msSyncFromMovement(token,changed){
 // A native HUD status can change without movementAction appearing in the
 // token update. Detect the existing Levitating state on those updates.
 const actor=token?.actor;
 if(actor&&msCanWrite(actor)&&msIsLevitating(actor)){
  if(token.movementAction!=="fly")await msSetMovement(token,"fly");
  if(!Object.prototype.hasOwnProperty.call(changed??{},"movementAction"))return;
 }
 if(!Object.prototype.hasOwnProperty.call(changed??{},"movementAction"))return;
 if(!actor||!msCanWrite(actor))return;
 const next=token.movementAction;
 if(typeof next!=="string")return;
 // An active native Levitation condition overrides manual Walk/Swim mode,
 // but never creates a distinct Flying status.
 if(msIsLevitating(actor)){
  if(next!=="fly")await msSetMovement(token,"fly");
  return;
 }
 const ids=msResolve();
 const key=msKey(actor);
 if(!key||MS_BUSY_ACTORS.has(key)||MS_BUSY_TOKENS.has(msKey(token)))return;
 // No native PF1 status available: do not synthesize a foreign effect.
 if(MS_ACTIONS.has(next)&&!ids.has(next))return;
 if(typeof actor.toggleStatusEffect!=="function")return;
 MS_BUSY_ACTORS.add(key);
 try{
  // Only remove status effects associated with this synchronization.
  // PF1 native toggleStatusEffect preserves status effects' semantics.
  for(const type of MS_ACTIONS){
   const id=ids.get(type);
   if(!id)continue;
   const active=msIsActive(actor,type,ids);
   const wanted=type===next;
   if(active!==wanted)await actor.toggleStatusEffect(id,{active:wanted});
  }
  // Native PF1 statuses belong to the Actor. Its linked scene tokens
  // therefore need a consistent movement action after switching one.
  for(const sibling of msActorTokens(actor)){
   if(sibling===token)continue;
   await msSetMovement(sibling,next);
  }
 }catch(error){console.warn("PF1AE | movement action sync",error);}
 finally{MS_BUSY_ACTORS.delete(key);}
}
Hooks.on("updateToken",(token,changes)=>{
 void msSyncFromMovement(token,changes);
});
// PF1 can apply native conditions through an Actor update rather than
// emit a distinct createActiveEffect event on every token-hud path.
Hooks.on("updateActor",actor=>{
 if(!actor||!msCanWrite(actor)||!msIsLevitating(actor))return;
 for(const token of msActorTokens(actor))
  void msSetMovement(token,"fly").catch(error=>
   console.warn("PF1AE | Levitating actor sync",error));
});
Hooks.on("createActiveEffect",effect=>{
 void msSyncFromEffect(effect,"create");
});
Hooks.on("updateActiveEffect",effect=>{
 void msSyncFromEffect(effect,"update");
});
Hooks.on("deleteActiveEffect",effect=>{
 void msSyncFromEffect(effect,"delete");
});

/** Restore existing native Levitation on a scene switch or page reload. */
async function msReconcileLevitationTokens(){
 const unique=new Set();
 for(const placeable of globalThis.canvas?.tokens?.placeables??[]){
  const doc=placeable?.document??placeable;
  const actor=doc?.actor;
  if(!actor||!msCanWrite(actor)||!msIsLevitating(actor))continue;
  const key=msKey(doc);
  if(!key||unique.has(key))continue;
  unique.add(key);
  await msSetMovement(doc,"fly");
 }
}
Hooks.on("canvasReady",()=>{
 void msReconcileLevitationTokens().catch(error=>
  console.warn("PF1AE | Levitation scene sync",error));
});
Hooks.on("createToken",doc=>{
 const actor=doc?.actor;
 if(actor&&msCanWrite(actor)&&msIsLevitating(actor))
  void msSetMovement(doc,"fly").catch(error=>
   console.warn("PF1AE | Levitation token sync",error));
});
Hooks.once?.("ready",()=>{
 void msReconcileLevitationTokens().catch(error=>
  console.warn("PF1AE | Levitation ready sync",error));
});
