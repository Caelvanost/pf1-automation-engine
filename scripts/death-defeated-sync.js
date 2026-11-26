/**
 * PF1AE — bidirectional native Dead ⇄ Combatant defeated synchronization.
 * Foundry v13 / Pathfinder 1e v11.11.
 *
 * Operates only on an elected GM and on combatants with a real token Actor.
 * Uses PF1 Actor.toggleStatusEffect and Combatant.update; never creates a
 * replacement ActiveEffect or changes HP.
 */
const DDS_NS='pf1-automation-engine';
const DDS_HANDLING=new Set();
const DDS_CHANGE_OPTION='pf1aeDeathDefeatedSync';

function ddsLeader(){
 const users=[...(game.users?.contents??game.users??[])];
 return users.filter(u=>u.active&&u.isGM).sort((a,b)=>
  String(a.id).localeCompare(String(b.id)))[0]??null;
}
function ddsEnabled(){
 return game.modules.get(DDS_NS)?.active===true&&
  ddsLeader()?.id===game.user?.id;
}
const ddsEntries=()=>{
 const registry=globalThis.CONFIG?.statusEffects;
 if(!registry)return [];
 return registry instanceof Map?[...registry.entries()]:
  Array.isArray(registry)?registry.map((e,i)=>[String(e?.id??i),e]):
  Object.entries(registry);
};
function ddsDeadId(){
 const special=globalThis.CONFIG?.specialStatusEffects?.DEFEATED;
 const entries=ddsEntries().map(([key,data])=>String(data?.id??key));
 // PF1's native Dead condition may be 'dead' or 'pf1_dead'.
 // Never synthesize an unregistered condition from a translated label.
 for(const id of ['dead','pf1_dead']){
  if(entries.includes(id))return id;
 }
 if(typeof special==='string'&&['dead','pf1_dead'].includes(special)&&
  entries.includes(special))return special;
 return null;
}
const ddsArray=value=>{
 if(Array.isArray(value))return value;
 if(value?.contents)return value.contents;
 if(typeof value?.values==='function')return [...value.values()];
 return [...(value??[])];
};
function ddsIsDead(actor,id=ddsDeadId()){
 if(!actor||!id)return null;
 if(actor.statuses?.has?.(id))return true;
 // Some PF1 condition documents are exposed as native ActiveEffects.
 return ddsArray(actor.effects).some(effect=>
  effect?.disabled!==true&&effect?.statuses?.has?.(id));
}
function ddsActor(combatant){
 // Token-specific synthetic Actors take precedence over world Actor.
 return combatant?.token?.actor??combatant?.actor??null;
}
function ddsCombatants(actor){
 if(!actor?.uuid)return [];
 const result=[];
 for(const combat of ddsArray(game.combats)){
  for(const combatant of ddsArray(combat?.combatants)){
   const other=ddsActor(combatant);
   if(other?.uuid===actor.uuid&&combatant?.token)result.push(combatant);
  }
 }
 return result;
}
function ddsLog(error){
 console.warn('[PF1AE][DeadDefeated] synchronization failed',error);
}
async function ddsGuard(actor,operation){
 const key=actor?.uuid;
 if(!key||!ddsEnabled()||DDS_HANDLING.has(key))return;
 DDS_HANDLING.add(key);
 try{await operation();}
 catch(error){ddsLog(error);}
 finally{DDS_HANDLING.delete(key);}
}
async function ddsFromDead(actor){
 if(!ddsEnabled()||!ddsDeadId())return;
 await ddsGuard(actor,async()=>{
  const wanted=ddsIsDead(actor);
  if(typeof wanted!=='boolean')return;
  for(const combatant of ddsCombatants(actor)){
   if(Boolean(combatant.isDefeated??combatant.defeated)===wanted)continue;
   await combatant.update({defeated:wanted},{[DDS_CHANGE_OPTION]:true});
  }
 });
}
async function ddsFromDefeated(combatant,change,options){
 if(!ddsEnabled()||options?.[DDS_CHANGE_OPTION]===true||
    !Object.prototype.hasOwnProperty.call(change??{},'defeated'))return;
 const actor=ddsActor(combatant),id=ddsDeadId();
 if(!actor||!id||typeof actor.toggleStatusEffect!=='function'||
    !combatant?.token)return;
 await ddsGuard(actor,async()=>{
  const wanted=change.defeated===true;
  const current=ddsIsDead(actor,id);
  if(current===null)return;
  if(current!==wanted)await actor.toggleStatusEffect(id,{active:wanted});
  // A linked Actor may be represented by multiple tokens in encounters.
  // Every such combatant must reflect the same native Actor condition.
  for(const sibling of ddsCombatants(actor)){
   if(sibling.id===combatant.id&&sibling.parent?.id===combatant.parent?.id)continue;
   if(Boolean(sibling.isDefeated??sibling.defeated)===wanted)continue;
   await sibling.update({defeated:wanted},{[DDS_CHANGE_OPTION]:true});
  }
 });
}
const ddsRelevantEffect=effect=>{
 const id=ddsDeadId();
 return id&&effect?.statuses?.has?.(id);
};
function ddsOnEffect(effect,change){
 // An update can REMOVE the only Dead status from an existing native
 // ActiveEffect: its new statuses no longer contain the ID, so inspect the
 // changed statuses field as well before reconciling.
 if(!ddsRelevantEffect(effect)&&
    !Object.prototype.hasOwnProperty.call(change??{},'statuses'))return;
 const actor=effect?.parent;
 if(actor?.documentName==='Actor')void ddsFromDead(actor);
}
function ddsOnActor(actor,changed){
 if(!actor||!ddsDeadId())return;
 const attrs=changed?.system?.attributes;
 if(changed?.statuses!==undefined||changed?.effects!==undefined||
    attrs?.conditions?.dead!==undefined||
    changed?.['system.attributes.conditions.dead']!==undefined){
  void ddsFromDead(actor);
 }
}
Hooks.once('ready',()=>{
 if(!game.modules.get(DDS_NS))return;
 const module=game.modules.get(DDS_NS);
 module.api??={};
 module.api.deathDefeated=Object.freeze({
  isAvailable:()=>ddsEnabled()&&Boolean(ddsDeadId()),
  statusId:ddsDeadId,
  isDead:ddsIsDead,
  reconcileActor:ddsFromDead
 });
 // Running on all clients but mutating exclusively on elected GM avoids
 // privilege escalation and socket request spoofing.
 Hooks.on('createActiveEffect',ddsOnEffect);
 Hooks.on('updateActiveEffect',ddsOnEffect);
 Hooks.on('deleteActiveEffect',ddsOnEffect);
 Hooks.on('updateActor',ddsOnActor);
 Hooks.on('updateCombatant',(c,changes,options)=>
  void ddsFromDefeated(c,changes,options));
 Hooks.on('createCombatant',c=>{
  const actor=ddsActor(c);
  if(actor&&ddsIsDead(actor)===true)void ddsFromDead(actor);
 });
});
