'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.resolve(__dirname,'../scripts/death-defeated-sync.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../module.json'),'utf8'));
assert.ok(manifest.esmodules.includes('scripts/death-defeated-sync.js'),'Service shipped in manifest');
const hooks=new Map(),writes=[],users=[
 {id:'gm',isGM:true,active:true},{id:'player',isGM:false,active:true}
];
const on=(name,fn)=>hooks.set(name,[...(hooks.get(name)??[]),fn]);
const fire=(name,...args)=>{for(const fn of hooks.get(name)??[])fn(...args)};
const addon={active:true,api:{}};
const settings=new Map(),registered=new Map();
const game={settings:{register(ns,key,config){registered.set(key,config);settings.set(key,config.default)},get(ns,key){return settings.get(key)}},user:users[0],users,modules:new Map([['pf1-automation-engine',addon]]),
 combats:new Map()};
const context={game,CONFIG:{statusEffects:[{id:'dead',name:'Mort'},{id:'unconscious'}]},
 Hooks:{on,once:on},console};
context.globalThis=context;
vm.runInNewContext(src,context,{filename:'death-defeated-sync.js'});
fire('init');
fire('ready');
assert.equal(registered.get('npcDeathAtZero').default,false);
assert.equal(registered.get('npcDeathAtZero').scope,'world');
const api=addon.api.deathDefeated;
assert.equal(api.statusId(),'dead');
assert.equal(api.isAvailable(),true);
assert.equal(hooks.get('updateCombatant').length,1);
assert.equal(hooks.get('createActiveEffect').length,1);
const actors=[];
function makeActor(name){
 const actor={documentName:'Actor',id:name,uuid:'Actor.'+name,
  type:'npc',system:{attributes:{hp:{value:10}}},flags:{},
  getFlag(ns,key){return actor.flags[key]},
  statuses:new Set(),effects:[],calls:[],
  async toggleStatusEffect(id,{active}={}){
   actor.calls.push({id,active});writes.push('toggle:'+name+':'+active);
   if(active)actor.statuses.add(id);else actor.statuses.delete(id);
   const effect={parent:actor,statuses:new Set([id]),disabled:false};
   if(active)fire('createActiveEffect',effect);
   else fire('deleteActiveEffect',effect);
  }};
 actors.push(actor);return actor;
}
function makeCombatant(id,actor){
 const token={id:'token-'+id,actor};
 const c={id,token,actor,defeated:false,isDefeated:false,updateCalls:[],
  async update(changes,options={}){
   writes.push('combatant:'+id+':'+changes.defeated);
   c.updateCalls.push({changes,options});
   c.defeated=changes.defeated;c.isDefeated=changes.defeated;
   fire('updateCombatant',c,changes,options);
  }};
 return c;
}
const tick=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setTimeout(resolve,0))};
(async()=>{
 const actor=makeActor('pirate');
 const c=makeCombatant('1',actor);
 game.combats.set('combat',{id:'combat',combatants:new Map([[c.id,c]])});
 // Status 'Mort' -> defeated, including deleting native effect.
 actor.statuses.add('dead');
 fire('createActiveEffect',{parent:actor,statuses:new Set(['dead']),disabled:false});
 await tick();
 assert.equal(c.isDefeated,true);
 assert.equal(c.updateCalls.length,1);
 assert.equal(c.updateCalls[0].options.pf1aeDeathDefeatedSync,true);
 assert.equal(actor.calls.length,0,'status-driven update does not toggle status again');
 actor.statuses.delete('dead');
 fire('deleteActiveEffect',{parent:actor,statuses:new Set(['dead'])});
 await tick();
 assert.equal(c.isDefeated,false);
 assert.equal(c.updateCalls.length,2);
 // Defeated -> Dead, and reverse; ensure no update bounce.
 await c.update({defeated:true});
 await tick();
 assert.equal(actor.statuses.has('dead'),true);
 assert.deepEqual(actor.calls.map(x=>x.active),[true]);
 assert.equal(c.updateCalls.length,3,'no redundant combatant writes from nested effect hook');
 await c.update({defeated:false});
 await tick();
 assert.equal(actor.statuses.has('dead'),false);
 assert.deepEqual(actor.calls.map(x=>x.active),[true,false]);
 // Irrelevant Actor and effect status must not change a combatant.
 await c.update({defeated:true});
 await tick();
 const prior=c.updateCalls.length;
 fire('updateActor',actor,{system:{attributes:{hp:{value:1}}}});
 fire('createActiveEffect',{parent:actor,statuses:new Set(['unconscious'])});
 await tick();
 assert.equal(c.updateCalls.length,prior);
 // An actor shared by 2 linked tokens synchronizes both combat entries.
 const sibling=makeCombatant('2',actor);
 game.combats.get('combat').combatants.set(sibling.id,sibling);
 actor.statuses.delete('dead');
 fire('updateActor',actor,{statuses:['unconscious']});
 await tick();
 assert.equal(c.isDefeated,false);
 assert.equal(sibling.isDefeated,false);
 actor.statuses.add('dead');
 fire('updateActor',actor,{statuses:['dead']});
 await tick();
 assert.equal(c.isDefeated,true);
 assert.equal(sibling.isDefeated,true);
 // One combatant manually changed while the shared Actor is already dead:
 // reconciles every linked combatant even if no status toggle is needed.
 sibling.defeated=false;sibling.isDefeated=false;
 await c.update({defeated:true});
 await tick();
 assert.equal(sibling.isDefeated,true);
 // Updating an existing effect may remove its Dead status rather than delete
 // the entire effect; detect the changed statuses field.
 actor.statuses.delete('dead');
 fire('updateActiveEffect',{parent:actor,statuses:new Set(),disabled:false},
  {statuses:[]});
 await tick();
 assert.equal(c.isDefeated,false);
 assert.equal(sibling.isDefeated,false);
 actor.statuses.add('dead');
 fire('createActiveEffect',{parent:actor,statuses:new Set(['dead'])});
 await tick();
 // Remove status from one linked combatant propagates via native Actor.
 await sibling.update({defeated:false});await tick();
 assert.equal(actor.statuses.has('dead'),false);
 assert.equal(c.isDefeated,false);
 // Player client cannot write GM-owned combatants or apply status.
 game.user=users[1];
 const writesBefore=writes.length;
 actor.statuses.add('dead');
 fire('createActiveEffect',{parent:actor,statuses:new Set(['dead'])});
 await c.update({defeated:false});
 await tick();
 assert.equal(writes.length,writesBefore+1,'only explicit simulated player update occurs');
 // Elected GM unavailable -> no changes.
 game.user=users[0];users[0].active=false;
 actor.statuses.delete('dead');
 const beforeNoGM=c.updateCalls.length;
 fire('deleteActiveEffect',{parent:actor,statuses:new Set(['dead'])});
 await tick();
 assert.equal(c.updateCalls.length,beforeNoGM);
 users[0].active=true;
 // No encounter membership -> no updates.
 game.combats.clear();actor.statuses.add('dead');
 const beforeNoCombat=c.updateCalls.length;
 fire('createActiveEffect',{parent:actor,statuses:new Set(['dead'])});
 await tick();
 assert.equal(c.updateCalls.length,beforeNoCombat);
 // Optional house rule: lethal HP changes only, NPCs only, native status.
 const npc=makeActor('zero-hp'),pc=makeActor('pc'),exempt=makeActor('exempt');
 pc.type='character';exempt.flags.ignoreAutoNpcDeath=true;
 const nc=makeCombatant('npc-zero',npc);
 const nc2=makeCombatant('npc-linked',npc);
 game.combats.set('hp-combat',{combatants:new Map([[nc.id,nc],[nc2.id,nc2]])});
 npc.system.attributes.hp.value=0;
 fire('updateActor',npc,{system:{attributes:{hp:{value:0}}}});
 await tick();
 assert.equal(npc.statuses.has('dead'),false,'off by default');
 settings.set('npcDeathAtZero',true);
 fire('updateActor',npc,{system:{attributes:{hp:{nonlethal:50}}}});
 await tick();
 assert.equal(npc.statuses.has('dead'),false,'nonlethal-only change is not a trigger');
 npc.system.attributes.hp.value=1;
 fire('updateActor',npc,{'system.attributes.hp.value':1});
 await tick();assert.equal(npc.calls.length,0);
 npc.system.attributes.hp.value=0;
 fire('updateActor',npc,{'system.attributes.hp.value':0});
 await tick();
 assert.equal(npc.statuses.has('dead'),true);
 assert.equal(nc.isDefeated,true);assert.equal(nc2.isDefeated,true);
 assert.deepEqual(npc.calls.map(x=>x.active),[true]);
 fire('updateActor',npc,{'system.attributes.hp.value':0});
 await tick();assert.equal(npc.calls.length,1,'no duplicate native status');
 npc.system.attributes.hp.value=5;
 fire('updateActor',npc,{'system.attributes.hp.value':5});
 await tick();assert.equal(npc.statuses.has('dead'),true,'healing is not resurrection');
 await nc.update({defeated:false});await tick();
 assert.equal(npc.statuses.has('dead'),false,'manual removal remains possible');
 for(const other of [pc,exempt]){
  other.system.attributes.hp.value=-2;
  fire('updateActor',other,{system:{attributes:{hp:{value:-2}}}});
 }
 await tick();assert.equal(pc.calls.length,0);assert.equal(exempt.calls.length,0);
 const outside=makeActor('outside-combat');
 outside.system.attributes.hp.value=-4;
 game.user=users[1];
 fire('updateActor',outside,{'system.attributes.hp.value':-4});
 await tick();assert.equal(outside.calls.length,0,'player cannot apply rule');
 game.user=users[0];
 fire('updateActor',outside,{'system.attributes.hp.value':-4});
 await tick();assert.equal(outside.statuses.has('dead'),true,'outside combat also works');
 const invalid=makeActor('invalid-hp');
 invalid.system.attributes.hp.value=null;
 fire('updateActor',invalid,{'system.attributes.hp.value':null});
 await tick();assert.equal(invalid.calls.length,0,'invalid HP fails closed');
 // No registered native Dead condition -> fail closed.
 context.CONFIG.statusEffects=[{id:'unconscious'}];
 assert.equal(api.isAvailable(),false);
 assert.equal(api.statusId(),null);
 console.log('PASS: native Dead and Combatant defeated bidirectional GM-only sync, deduplication, linked combatants, non-death neutrality, missing registry, no encounter, optional NPC-at-zero house rule');
})().catch(error=>{console.error(error);process.exitCode=1});
