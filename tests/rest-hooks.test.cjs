"use strict";

/**
 * Native PF1 actor-rest bridge integration regression, Foundry v13 simulation.
 * Run: node tests/rest-hooks.test.cjs
 * No class-specific automation belongs in the production module.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const modules = [
  fs.readFileSync(path.join(root, "scripts/generic-automation.js"), "utf8"),
  fs.readFileSync(path.join(root, "scripts/rest-automation.js"), "utf8")
];
const NS = "pf1-automation-engine";
const storage = new Map();
const users = [
  {id:"gmA",name:"GM A",active:true,isGM:true},
  {id:"gmB",name:"GM B",active:true,isGM:true},
  {id:"player",name:"Player",active:true,isGM:false},
  {id:"stranger",name:"Stranger",active:true,isGM:false}
];
users.get = id => users.find(u => u.id === id);
const bus = new Map();
const docs = new Map();
const calls = [];
let id = 0;
const actor = {
  id:"A",uuid:"Actor.A",documentName:"Actor",name:"Character",
  system:{attributes:{hp:{value:22,max:30,nonlethal:7}},resources:{daily:{value:2,max:5}}},
  items:[],
  testUserPermission(user,perm){
    return perm === "OWNER" && (user.isGM || user.id === "player");
  },
  getActiveTokens(){return [];}
};
const feature = {
  id:"F",uuid:"Actor.A.Item.F",documentName:"Item",name:"Rest callback",
  actor,parent:actor,type:"feat",system:{scriptCalls:[],actions:[]},
  scriptCalls:{contents:[{
    id:"rest-script",category:"use",name:"On Rest",
    async execute(_shared,extra){calls.push(JSON.parse(JSON.stringify(extra.event)));}
  }]},
  getFlag(){return null;}
};
actor.items.push(feature);
docs.set(actor.uuid,actor);
docs.set(feature.uuid,feature);

function client(user){
  const callbacks = new Map();
  const mod = {id:NS,active:true,api:{
    migration:{whenReady:async()=>{}},
    discovery:{scan:async()=>{},ensureScanned:async()=>{},
      listApproved:()=>[],stillApproved:async()=>true}
  }};
  const game = {
    user,users,modules:new Map([[NS,mod]]),
    combat:null,combats:new Map(),time:{worldTime:0},
    settings:{
      register(ns,k,opt){
        if(!storage.has(ns+"."+k))storage.set(ns+"."+k,structuredClone(opt.default));
      },
      get(ns,k){return storage.get(ns+"."+k);},
      async set(ns,k,value){
        storage.set(ns+"."+k,structuredClone(value));
        return value;
      }
    },
    socket:{
      on(channel,fn){
        bus.set(channel,[...(bus.get(channel)??[]),fn]);
      },
      emit(channel,payload){
        // Socket messages are broadcast to all connected clients.
        for(const fn of bus.get(channel)??[]) fn(structuredClone(payload));
      }
    }
  };
  const Hooks={
    on(name,fn){callbacks.set(name,[...(callbacks.get(name)??[]),fn]);},
    once(name,fn){this.on(name,fn);},
    async fire(name,...args){
      for(const fn of [...(callbacks.get(name)??[])]) await fn(...args);
    }
  };
  const errors = [];
  const consoleMock = {
    log(){},info(){},debug(){},warn(){},
    error(...args){errors.push(args);}
  };
  const sandbox = {game,Hooks,foundry:{utils:{
      deepClone:structuredClone,
      randomID:()=>"id-"+(++id)
    }},
    fromUuid:async uuid=>docs.get(uuid)??null,
    console:consoleMock,canvas:{},ui:{notifications:{}},
    ChatMessage:{},setTimeout
  };
  const ctx = vm.createContext(sandbox);
  for(let i=0;i<modules.length;i++){
    new vm.Script("(function(){"+modules[i]+"\n})();",{
      filename:i?"rest-automation.js":"generic-automation.js"
    }).runInContext(ctx);
  }
  async function start(){
    await Hooks.fire("init");
    await Hooks.fire("ready");
    await settle();
  }
  return {game,Hooks,start,errors,api:()=>mod.api.generic};
}
async function settle(){
  for(let i=0;i<20;i++)await new Promise(resolve=>setTimeout(resolve,0));
}
async function runRest(origin,opts,newHealth=0,newDaily=5,duplicate=false){
  const changes = {system:{attributes:{hp:{value:30,nonlethal:newHealth}}}};
  const itemChanges = [{_id:"F",system:{uses:{value:newDaily}}}];
  await origin.Hooks.fire("pf1PreActorRest",actor,opts,changes,itemChanges);
  // Simulate PF1 applying only the subsystems enabled in its rest options.
  if (opts.restoreHealth === true) {
    actor.system.attributes.hp.value=30;
    actor.system.attributes.hp.nonlethal=newHealth;
  }
  if (opts.restoreDailyUses === true) actor.system.resources.daily.value=newDaily;
  await origin.Hooks.fire("pf1ActorRest",actor,opts,changes,itemChanges);
  if(duplicate){
    await origin.Hooks.fire("pf1ActorRest",actor,opts,changes,itemChanges);
  }
  await settle();
}
(async()=>{
  const leader=client(users[0]);
  const secondGM=client(users[1]);
  const player=client(users[2]);
  await leader.start();await secondGM.start();await player.start();
  assert.equal(leader.api().isLeader(),true);
  assert.equal(secondGM.api().isLeader(),false);
  assert.equal(player.api().isLeader(),false);

  const rules = [
    {id:"pre",on:"pf1PreActorRest",itemUuid:feature.uuid,
      scriptCategory:"use",scriptId:"rest-script",
      filter:{actorUuid:actor.uuid}},
    {id:"post",on:"pf1ActorRest",itemUuid:feature.uuid,
      scriptCategory:"use",scriptId:"rest-script",
      filter:{actorUuid:actor.uuid}},
    {id:"full",on:"pf1ActorRest",itemUuid:feature.uuid,
      scriptCategory:"use",scriptId:"rest-script",
      filter:{actorUuid:actor.uuid,rest:{
        minHours:8,restoreHealth:true,restoreDailyUses:true,isFullRest:true
      }}}
  ];
  for(const rule of rules) await leader.api().register(rule);
  assert.equal(leader.api().listEvents().length,3);

  // Player-triggered FULL native rest: pre snapshot must survive PF1 healing.
  const complete={hours:8,restoreHealth:true,restoreDailyUses:true,longTermCare:false};
  await runRest(player,complete,1,5,true);
  assert.equal(calls.length,3,"pre, generic post and qualified full-rest once");
  const pre=calls.find(x=>x.type==="pf1PreActorRest");
  const posts=calls.filter(x=>x.type==="pf1ActorRest");
  assert.equal(pre.rest.completed,false);
  assert.equal(pre.rest.before.health.hp.nonlethal,7);
  assert.equal(pre.rest.after,null);
  assert.equal(pre.rest.hours,8);
  assert.equal(pre.rest.atLeastEightHours,true);
  assert.equal(pre.rest.isFullRest,true);
  assert.equal(pre.rest.kind,"full");
  assert.equal(posts.length,2);
  assert.equal(posts[0].rest.before.health.hp.nonlethal,7);
  assert.equal(posts[0].rest.after.health.hp.nonlethal,1);
  assert.equal(posts[0].rest.nativeUpdates.actor.system.attributes.hp.value,30);
  assert.equal(posts[0].rest.nativeUpdates.items[0]._id,"F");
  assert.equal(posts[0].rest.initiatedBy,"player");
  assert.equal(posts[0].rest.id,pre.rest.id,"pre/post correlation by same native options");
  assert.equal(actor.system.attributes.hp.nonlethal,1,"engine does not heal itself");

  // A four-hour rest is NOT classified as full even with both restore flags.
  calls.length=0;
  await runRest(player,{hours:4,restoreHealth:true,restoreDailyUses:true,longTermCare:false},3);
  assert.equal(calls.length,2,"full-rest-only rule did not run");
  assert.equal(calls[1].rest.kind,"partial");
  assert.equal(calls[1].rest.isFullRest,false);
  assert.equal(calls[1].rest.atLeastEightHours,false);

  // Recharge daily uses only (8 hours) must NOT trigger full-rest rule.
  calls.length=0;
  await runRest(player,{hours:8,restoreHealth:false,restoreDailyUses:true,longTermCare:false},4);
  assert.equal(calls.length,2);
  assert.equal(calls[1].rest.kind,"dailyRecharge");
  assert.equal(calls[1].rest.atLeastEightHours,true);
  assert.equal(calls[1].rest.restoreHealth,false);
  assert.equal(calls[1].rest.isFullRest,false);

  // Healing alone over 8h still isn't "full" in our *option classification*.
  calls.length=0;
  await runRest(player,{hours:8,restoreHealth:true,restoreDailyUses:false,longTermCare:false},2);
  assert.equal(calls.length,2);
  assert.equal(calls[1].rest.kind,"partial");

  // Identical native post hook for the same options object is deduplicated.
  calls.length=0;
  await runRest(player,{hours:8,restoreHealth:true,restoreDailyUses:true,longTermCare:false},0,5,true);
  assert.equal(calls.length,3);
  assert.equal(new Set(calls.map(x=>x.rest.id)).size,1);

  // Duplicate socket packet with same correlation id cannot execute again.
  const previous=calls.length;
  const observed=calls[1].rest;
  const fakeReplay={
    channel:"pf1ae-native-rest-v1",version:1,phase:"post",
    restId:observed.id,actorUuid:actor.uuid,requesterId:"player",
    options:observed.options,before:observed.before,after:observed.after,
    planned:{updateData:{},itemUpdates:[]}
  };
  player.game.socket.emit("module."+NS,fakeReplay);
  await settle();
  assert.equal(calls.length,previous,"duplicate rest event ID/phase rejected");

  // Another player cannot submit rest notifications about an unowned actor.
  player.game.socket.emit("module."+NS,{...fakeReplay,
    restId:"malicious-rest",requesterId:"stranger"});
  await settle();
  assert.equal(calls.length,previous,"actor ownership validated by elected GM");

  // A non-leader GM can initiate native rest; it is processed once by leader.
  calls.length=0;
  await runRest(secondGM,{hours:8,restoreHealth:true,restoreDailyUses:true,longTermCare:false});
  assert.equal(calls.length,3);

  // Leader transfer, with no change to registered world subscriptions.
  users[0].active=false;
  assert.equal(secondGM.api().isLeader(),true);
  calls.length=0;
  await runRest(player,{hours:8,restoreHealth:true,restoreDailyUses:true,longTermCare:false});
  assert.equal(calls.length,3,"new elected GM handles player native rest");

  // A native rest is a distinct event, and must not be dropped while an
  // unrelated actor-update subscription is executing asynchronously.
  let signalSlowStart;
  const slowStarted = new Promise(resolve => {signalSlowStart=resolve;});
  let releaseSlow;
  const slowDone = new Promise(resolve => {releaseSlow=resolve;});
  feature.scriptCalls.contents.push({
    id:"slow-script",category:"use",name:"Slow resource sync",
    async execute(){signalSlowStart();await slowDone;}
  });
  await secondGM.api().register({
    id:"slow-sync",on:"updateActor",itemUuid:feature.uuid,
    scriptCategory:"use",scriptId:"slow-script",
    filter:{actorUuid:actor.uuid}
  });
  void secondGM.Hooks.fire("updateActor",actor,
    {system:{attributes:{hp:{value:1}}}},{});
  await slowStarted;
  calls.length=0;
  await runRest(player,{hours:8,restoreHealth:true,restoreDailyUses:true,longTermCare:false});
  assert.equal(calls.length,0,"rest waits while the actor's other script is in flight");
  releaseSlow();
  await settle();
  assert.equal(calls.length,3,"pre and post rest callbacks are not lost while actor was busy");

  // Strict validation: rest predicates only on rest events.
  await assert.rejects(()=>secondGM.api().register({
    id:"bad",on:"updateItem",itemUuid:feature.uuid,
    scriptCategory:"use",scriptId:"rest-script",
    filter:{rest:{minHours:8}}
  }),/filtre rest/);
  await assert.rejects(()=>secondGM.api().register({
    id:"bad",on:"pf1ActorRest",itemUuid:feature.uuid,
    scriptCategory:"use",scriptId:"rest-script",
    filter:{rest:{restoreHealth:"yes"}}
  }),/rest invalide/);

  assert.deepEqual(leader.errors,[]);
  assert.deepEqual(secondGM.errors,[]);
  assert.deepEqual(player.errors,[]);
  console.log("PASS rest-hooks: player/GM origin, phase order, 8h classification, snapshot, dedupe, ownership, leadership");
})().catch(err=>{console.error(err);process.exitCode=1;});
