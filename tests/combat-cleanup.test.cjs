'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const NS='pf1-automation-engine',root=path.resolve(__dirname,'..');
const data=new Map([['genericEnabled',true],['genericDebug',false],['durationRegistry',[]]]);
const docs=new Map(),actors=new Map(),scenes=new Map(),users=[
 {id:'a-gm',active:true,isGM:true},{id:'z-gm',active:true,isGM:true}];
users.get=id=>users.find(u=>u.id===id);
let seq=0,removed=0;
function actor(uuid){
 const a={documentName:'Actor',uuid,id:uuid.split('.').at(-1),name:uuid,isOwner:true,
 items:new Map(),effects:new Map(),getConditionImmunities:()=>new Set(),
 async createEmbeddedDocuments(type,items){return items.map(d=>{
   const id='e'+(++seq),map=type==='Item'?a.items:a.effects;
   const e={id,uuid:a.uuid+'.'+type+'.'+id,documentName:type,parent:a,
     name:d.name,origin:d.origin,flags:d.flags,system:d.system??{},
     statuses:new Set(d.statuses??[]),changes:d.changes??[],
     _stats:{createdTime:Date.now()-100000},
     getFlag(ns,key){return this.flags?.[ns]?.[key]},
     async delete(){if(!map.has(id))throw Error('already removed');map.delete(id);docs.delete(this.uuid);removed++;},
     async setActive(x){this.system.active=x}};
   map.set(id,e);docs.set(e.uuid,e);return e;
 })}};
 docs.set(uuid,a);return a;
}
const monk=actor('Actor.Monk'),other=actor('Actor.Other'),victim=actor('Actor.Victim'),
 synthetic=actor('Scene.scene.Token.token.Actor.Victim');
for(const a of [monk,other,victim])actors.set(a.uuid,a);
scenes.set('scene',{tokens:new Map([['token',{actorLink:false,actor:synthetic}]])});
const c1={id:'m',actor:monk},c2={id:'o',actor:other},combats=new Map();
let current;
function combat(id){return {id,uuid:'Combat.'+id,started:true,round:1,turn:0,
 combatants:new Map([['m',c1],['o',c2]]),turns:[c1,c2]};}
current=combat('first');combats.set(current.id,current);
function world(user=users[0]){
 const events=new Map(),once=new Map();
 const mod={active:true,api:{duration:{
  schedule:async x=>{data.set('durationRegistry',[...data.get('durationRegistry'),structuredClone(x)]);return x.id},
  cancelTimer:async id=>data.set('durationRegistry',data.get('durationRegistry').filter(x=>x.id!==id)),
  listTimers:()=>structuredClone(data.get('durationRegistry'))}}};
 const game={user,users,actors,scenes,combats,combat:current,modules:new Map([[NS,mod]]),
  settings:{register(_ns,k,x){if(!data.has(k))data.set(k,structuredClone(x.default))},
   get(_ns,k){return data.get(k)},async set(_ns,k,v){data.set(k,structuredClone(v));return v}},
  socket:{on(){},emit(){}}};
 const ctx={console,Date,Promise,Map,Set,setTimeout,clearTimeout,
   game,canvas:{scene:null},pf1:{registry:{conditions:new Map([['stunned',{}]])}},
   fromUuid:async id=>docs.get(id)??null,
   foundry:{utils:{deepClone:structuredClone,randomID:()=>String(++seq)}},
   Hooks:{once(k,fn){once.set(k,[...(once.get(k)??[]),fn])},
     on(k,fn){events.set(k,[...(events.get(k)??[]),fn])}}};
 vm.createContext(ctx);
 for(const file of ['effect-groups.js','generic-automation.js'])
  vm.runInContext(fs.readFileSync(path.join(root,'scripts',file),'utf8'),ctx,{filename:file});
 return {game,api:mod.api,async start(){for(const k of ['init','ready'])for(const fn of once.get(k)??[])await fn()},
  async fire(k,...args){for(const fn of events.get(k)??[])await fn(...args)},
  async sync(){await mod.api.generic._recoverCombatCleanup()}};
}
function source(src=monk,target=victim,key='stun',duration={rounds:1,expire:'sourceTurnStart'}){
 return {sourceUuid:src.uuid,targetUuid:target.uuid,key,outcomeId:'save'+(++seq)+':'+key,
  ruleId:src.uuid+':'+key,sourceItemUuid:src.uuid+'.Item.fist',
  sourceActionId:'save',effect:{label:'Stunned',img:'stunned.webp',statusId:'stunned',duration}};
}
const exists=(actor,uuid)=>actor.effects.has(uuid.split('.').at(-1));
(async()=>{
 const w=world();await w.start();const api=w.api;
 const normal=await api.effectGroups._createTimedOutcome(source());
 assert(exists(victim,normal.effectUuid));
 current.round=2;current.turn=0;
 await w.fire('combatTurnChange',current,{round:1,turn:1,combatantId:'o'},
   {round:2,turn:0,combatantId:'m'});
 await new Promise(r=>setTimeout(r,25));
 assert(!exists(victim,normal.effectUuid),'turn-start expiry still works');
 current.round=1;current.turn=0;
 const ending=await api.effectGroups._createTimedOutcome(source(monk,synthetic,'ending'));
 const elapsed=await api.effectGroups._createTimedOutcome(source(other,synthetic,'elapsed',
  {seconds:60,expire:'elapsed'}));
 const permanent=(await victim.createEmbeddedDocuments('ActiveEffect',[{name:'Permanent',flags:{},
  origin:'External.Item',statuses:['stunned']}]))[0];
 const foreign=(await synthetic.createEmbeddedDocuments('ActiveEffect',[{name:'Unmanaged',flags:{},
  origin:'External.Item',statuses:['stunned']}]))[0];
 const script={documentName:'Item',uuid:monk.uuid+'.Item.script',actor:monk,name:'Script',
   system:{actions:[{id:'a',script:'void 0'}]}};
 docs.set(script.uuid,script);
 await api.generic.scheduleTurn({id:'callback',itemUuid:script.uuid,actionId:'a',
  combatId:current.id,combatantId:'m',timing:'turnStart'});
 const managed=(await victim.createEmbeddedDocuments('Item',[{
  name:'Managed',system:{active:true},flags:{[NS]:{effectGroupId:'g1'}}}]))[0];
 managed.type='buff';
 data.set('managedEffectGroups',{g1:{id:'g1',combatId:current.id,
  sourceUuid:monk.uuid,key:'a',timerId:'groupTimer',combatantId:'m',
  copies:[{actorUuid:victim.uuid,documentType:'Item',documentId:managed.id}]}});
 data.set('timerRegistry',[...api.generic.listTimers(),
  {id:'groupTimer',unit:'phase',combatId:current.id,effectGroupId:'g1'}]);
 combats.delete(current.id);current.started=false;w.game.combat=null;
 await w.fire('deleteCombat',current);await w.sync();
 assert(!exists(synthetic,ending.effectUuid),'unlinked target cleaned');
 assert(exists(synthetic,elapsed.effectUuid),'elapsed effect from second source persists');
 assert(exists(synthetic,foreign.uuid),'unmanaged effect untouched');
 assert(exists(victim,permanent.uuid),'permanent status untouched');
 assert(!victim.items.has(managed.id),'managed effectGroups buff removed');
 assert.equal(api.generic.listTimers().length,0,'combat timers removed');
 assert.equal(data.get('durationRegistry').length,1,'world-time timer preserved');
 // Missing target retains a cleanupPending timer, including across F5.
 current=combat('retry');combats.set(current.id,current);w.game.combat=current;
 const pending=await api.effectGroups._createTimedOutcome(source(monk,victim,'pending'));
 const doc=docs.get(pending.effectUuid);docs.delete(pending.effectUuid);
 combats.delete(current.id);current.started=false;w.game.combat=null;
 await w.fire('deleteCombat',current);await w.sync();
 assert(api.generic.listTimers().find(t=>t.id===pending.timerId)?.cleanupPending);
 docs.set(doc.uuid,doc);
 const reloaded=world();reloaded.game.combat=null;await reloaded.start();await reloaded.sync();
 assert(!exists(victim,pending.effectUuid),'reconnection deletes pending condition');
 assert(!reloaded.api.generic.listTimers().some(t=>t.id===pending.timerId));
 // Historical v1.16.2 outcome without a timer is safe to clean by full flags.
 const old=(await victim.createEmbeddedDocuments('ActiveEffect',[{
  name:'Legacy',origin:monk.uuid+'.Item.fist',statuses:['stunned'],
  flags:{[NS]:{sourceUuid:monk.uuid,key:'legacy',outcomeId:'old:legacy',
    outcomeRuleId:monk.uuid+':legacy',sourceItemUuid:monk.uuid+'.Item.fist',
    sourceActionId:'save',timerId:'outcome:lost'}}}]))[0];
 await reloaded.sync();assert(!exists(victim,old.uuid),'legacy orphan repaired');
 // Stopped combat without deletion.
 current=combat('stopped');combats.set(current.id,current);reloaded.game.combat=current;
 const stopped=await reloaded.api.effectGroups._createTimedOutcome(source(monk,victim,'stopped'));
 current.started=false;
 await reloaded.fire('updateCombat',current,{round:0,turn:null});await reloaded.sync();
 assert(!exists(victim,stopped.effectUuid));
 // Only the elected GM may perform cleanup.
 current=combat('leaders');combats.set(current.id,current);reloaded.game.combat=current;
 const leaderOnly=await reloaded.api.effectGroups._createTimedOutcome(source(monk,victim,'leader'));
 const second=world(users[1]);second.game.combat=current;await second.start();
 combats.delete(current.id);current.started=false;
 const before=removed;await second.fire('deleteCombat',current);await second.sync();
 assert.equal(removed,before,'nonleader must not delete');
 await reloaded.fire('deleteCombat',current);await reloaded.sync();
 assert(!exists(victim,leaderOnly.effectUuid));
 console.log('PASS combat cleanup: turn, deleted/stopped combat, synthetic, permanent, foreign, group, elapsed, script cancellation, F5, orphans and elected GM');
})().catch(e=>{console.error(e);process.exitCode=1});
