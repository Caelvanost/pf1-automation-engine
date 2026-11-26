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
const module={active:true,api:{}};
const game={user:users[0],users,modules:new Map([['pf1-automation-engine',module]]),
 combats:new Map()};
const context={game,CONFIG:{statusEffects:[{id:'dead',name:'Mort'},{id:'unconscious'}]},
 Hooks:{on,once:on},console};
context.globalThis=context;
vm.runInNewContext(src,context,{filename:'death-defeated-sync.js'});
fire('ready');
const api=module.api.deathDefeated;
assert.equal(api.statusId(),'dead');
assert.equal(api.isAvailable(),true);
assert.equal(hooks.get('updateCombatant').length,1);
assert.equal(hooks.get('createActiveEffect').length,1);
const actors=[];
function makeActor(name){
 const actor={documentName:'Actor',id:name,uuid:'Actor.'+name,
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
 // No registered native Dead condition -> fail closed.
 context.CONFIG.statusEffects=[{id:'unconscious'}];
 assert.equal(api.isAvailable(),false);
 assert.equal(api.statusId(),null);
 console.log('PASS: native Dead and Combatant defeated bidirectional GM-only sync, deduplication, linked combatants, non-death neutrality, missing registry and no encounter');
})().catch(error=>{console.error(error);process.exitCode=1});
