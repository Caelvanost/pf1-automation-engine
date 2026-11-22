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
 return tokens.map(t=>t?.document??t).filter(doc=>
  doc?.actor&&doc.actor===actor&&
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
 const actor=effect?.parent;
 if(!actor||!msCanWrite(actor))return;
 const ids=msResolve();
 const type=msTypeFromEffect(effect,ids);
 if(!type||!ids.has(type))return;
 const key=msKey(actor);
 if(!key||MS_BUSY_ACTORS.has(key))return;
 MS_BUSY_ACTORS.add(key);
 try{
  const statusActive=operation==="delete"?false:
   !effect.disabled&&msIsActive(actor,type,ids);
  // When the effect becomes inactive, the other native movement effect,
  // if still active, takes priority. Otherwise return to normal walk.
  let movement=statusActive?type:
   msIsActive(actor,type==="fly"?"swim":"fly",ids)?
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
 if(!Object.prototype.hasOwnProperty.call(changed??{},"movementAction"))return;
 const actor=token?.actor;
 if(!actor||!msCanWrite(actor))return;
 const next=token.movementAction;
 if(typeof next!=="string")return;
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
 }catch(error){console.warn("PF1AE | movement action sync",error);}
 finally{MS_BUSY_ACTORS.delete(key);}
}
Hooks.on("updateToken",(token,changes)=>{
 void msSyncFromMovement(token,changes);
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
