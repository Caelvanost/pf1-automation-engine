'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const calls={init:[],ready:[],events:new Map()};
const hooks={once(k,cb){calls[k].push(cb);},on(k,cb){const v=calls.events.get(k)??[];v.push(cb);calls.events.set(k,v)}};
const user={id:'player',isGM:false};
const api={};
const settings={genericEnabled:true,genericDebug:false};
const ctx={console,Date,Number,Map,Set,WeakSet,Promise,Hooks:hooks,
 game:{user,modules:new Map([['pf1-automation-engine',{active:true,api}]]),
 settings:{get:(_ns,key)=>settings[key]}}};
const outcomes=[];
const rogue={documentName:'Actor',uuid:'Scene.a.Token.b.Actor.rogue',
 items:new Map(),testUserPermission:(u,permission)=>u===user&&permission==='OWNER',
 getActiveTokens:()=>[{document:{documentName:'Token',uuid:'Scene.a.Token.b',actor:{uuid:'Scene.a.Token.b.Actor.rogue'}}}]};
const weapon={documentName:'Item',uuid:rogue.uuid+'.Item.rapier',actor:rogue};
const attack={id:'rapier-attack',item:weapon,actor:rogue};
let reacting=false, damageUses=0;
const reactive={documentName:'Item',uuid:rogue.uuid+'.Item.reaction',actor:rogue,
 actions:new Map([['damage',{id:'damage'}]]),
 async use(options){assert.deepEqual(options,{actionId:'damage',cost:0,chatMessage:true});damageUses++;},
 scriptCalls:{contents:[{id:'reaction',name:'PF1AE:attack:resolved',category:'postUse',
 async execute(shared,extra){
   outcomes.push(extra.event);
   assert.equal(extra.event.hit,null);
   assert.equal(extra.event.actorUuid,rogue.uuid);
   assert.equal(extra.event.itemUuid,weapon.uuid);
   assert.equal(extra.event.type,'attack:resolved');
   assert.equal(extra.api.subscriptionName,'PF1AE:attack:resolved');
   // Generic Item chooses whether its existing native action should fire.
   // 22 is an arbitrary unit-test predicate, NOT a hit/AC rule.
   if(extra.event.roll.total===22) await reactive.use({actionId:'damage',cost:0,chatMessage:true});
   if(!reacting){reacting=true;
     // Simulate a recursively generated attack while the reaction runs.
     for(const cb of calls.events.get('pf1AttackRoll'))cb(attack,{total:30,id:'reaction-roll'},{});
     for(const cb of calls.events.get('pf1PostActionUse'))cb({action:attack},null);
   }
 }}]}};
rogue.items.set('reactive',reactive);
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../scripts/attack-events.js'),'utf8'),ctx,{filename:'attack-events.js'});
for(const f of calls.init)f();for(const f of calls.ready)f();
assert.equal(calls.events.get('pf1AttackRoll').length,1);
assert.equal(calls.events.get('pf1PostActionUse').length,1);
const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
(async()=>{
 const first={id:'roll1',total:22,formula:'1d20+8'},second={id:'roll2',total:13,formula:'1d20+3'};
 for(const cb of calls.events.get('pf1AttackRoll')){cb(attack,first,{});cb(attack,first,{});cb(attack,second,{attackIndex:1});}
 assert.equal(outcomes.length,0,'Wait until native postActionUse, not a partial attack');
 const message={documentName:'ChatMessage',id:'native-card'};
 const token={documentName:'Token',uuid:'Scene.a.Token.target',actor:{uuid:'Actor.target'}};
 for(const cb of calls.events.get('pf1PostActionUse'))cb({action:attack,shared:{targets:[token]}},message);
 await tick();
 assert.equal(outcomes.length,2,'Full attack emits separate, deduplicated individual events');
 assert.equal(outcomes[0].roll.total,22);
 assert.equal(outcomes[1].roll.total,13);
 assert.equal(outcomes[0].sourceMessageId,'native-card');
 assert.equal(outcomes[1].attackIndex,1);
 assert.equal(outcomes[0].attackIndex,null,'Never invent attack index');
 assert.equal(outcomes[0].targets[0].tokenUuid,'Scene.a.Token.target');
 assert.equal(outcomes[0].attackerTokenUuid,'Scene.a.Token.b');
 assert.equal(outcomes.length,2,'Recursive attack ignored');
 assert.equal(damageUses,1,'Existing native damage action used once, without another attack roll');
 assert.equal(api.attackEvents.listSubscriptions(rogue).length,1);
 // Same action, new roll instance, a second successful use.
 for(const cb of calls.events.get('pf1AttackRoll'))cb(attack,{total:12},{});
 for(const cb of calls.events.get('pf1PostActionUse'))cb({action:attack},message);
 await tick();
 assert.equal(outcomes.length,3);
 // Duplicate declarations on one item are refused, no extra execution.
 reactive.scriptCalls.contents.push({...reactive.scriptCalls.contents[0],id:'reaction2'});
 for(const cb of calls.events.get('pf1AttackRoll'))cb(attack,{total:14},{});
 for(const cb of calls.events.get('pf1PostActionUse'))cb({action:attack},message);
 await tick();
 assert.equal(outcomes.length,3);
 reactive.scriptCalls.contents.pop();
 user.isGM=false;
 rogue.testUserPermission=()=>false;
 for(const cb of calls.events.get('pf1AttackRoll'))cb(attack,{total:14},{});
 for(const cb of calls.events.get('pf1PostActionUse'))cb({action:attack},message);
 await tick();
 assert.equal(outcomes.length,3,'Nonowner client must not execute scripts');
 console.log('PASS attack events: PF1 native hooks, two full attacks, no hit assumption, recursion, permissions, duplicate subscriptions');
})().catch(e=>{console.error(e);process.exitCode=1});
