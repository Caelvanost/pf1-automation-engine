'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../scripts/duration-manager.js'),'utf8');
const NS='pf1-automation-engine';
function harness(shared={}) {
  const storage=shared.storage ?? new Map();
  const docs=shared.docs ?? new Map();
  const users=shared.users ?? [{id:'a',active:true,isGM:true},{id:'b',active:true,isGM:true},{id:'p',active:true,isGM:false}];
  const user=shared.user ?? users[0];
  const clock=shared.clock ?? {worldTime:1000};
  const combats=shared.combats ?? new Map();
  const modules=new Map();
  const groups={expireCalls:[],valid:new Set()};
  const effectGroups=shared.effectGroups ?? {
    validateDurationGroupTimer(id){return groups.valid.has(id);},
    async expireGroup(id){groups.expireCalls.push(id);}
  };
  const mod={active:true,api:{effectGroups}};
  modules.set(NS,mod);
  const game={user,users,modules,combats,combat:shared.combat ?? null,time:clock,
    settings:{
      register(ns,key,opts){const id=`${ns}.${key}`;if(!storage.has(id))storage.set(id,structuredClone(opts.default));},
      get(ns,key){if(key==='genericEnabled')return true;return storage.get(`${ns}.${key}`);},
      async set(ns,key,val){storage.set(`${ns}.${key}`,structuredClone(val));return val;}
    }
  };
  const callbacks=new Map();
  const Hooks={
    on(name,fn){callbacks.set(name,[...(callbacks.get(name)??[]),fn]);},
    once(name,fn){this.on(name,fn);},
    async fire(name,...args){for(const fn of callbacks.get(name)??[])await fn(...args);}
  };
  const ctx={game,Hooks,fromUuid:async id=>docs.get(id)??null,
    foundry:{utils:{deepClone:structuredClone}},console};
  vm.runInNewContext(source,ctx,{filename:'duration-manager.js'});
  async function flush(){for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));}
  async function start(){await Hooks.fire('init');await Hooks.fire('ready');await flush();}
  async function tick(seconds){clock.worldTime+=seconds;await Hooks.fire('updateWorldTime',clock.worldTime,seconds);await flush();}
  async function round(combat,newRound){combat.round=newRound;await Hooks.fire('combatTurnChange',combat,{},{});await flush();}
  async function begin(combat){combat.started=true;game.combat=combat;combats.set(combat.id,combat);await Hooks.fire('updateCombat',combat,{started:true});await flush();}
  async function end(combat){combat.started=false;await Hooks.fire('updateCombat',combat,{started:false});await flush();game.combat=null;}
  return {start,flush,tick,round,begin,end,game,groups,storage,docs,users,clock,combats,api:()=>mod.api.duration};
}
function createBuff(e,name='Buff'){
  const a={uuid:`Actor.${name}`,documentName:'Actor'};
  const buff={uuid:`Actor.${name}.Item.buff`,documentName:'Item',type:'buff',actor:a,system:{active:true},activeState:true,
    activation:[],async setActive(active){this.activation.push(active);this.activeState=active;this.system.active=active;}};
  e.docs.set(buff.uuid,buff);return buff;
}
function createAE(e,name='Effect'){
  const a={uuid:`Actor.${name}`,documentName:'Actor'};
  const doc={uuid:`Actor.${name}.ActiveEffect.abc`,documentName:'ActiveEffect',parent:a,disabled:false,deleted:false,
    async update(changes){this.disabled=changes.disabled;},async delete(){this.deleted=true;e.docs.delete(this.uuid);}};
  e.docs.set(doc.uuid,doc);return doc;
}
const combat=id=>({id,started:false,round:1});
async function test(){
  // 1 PF1 round is exactly 6 world-time seconds outside combat.
  const e=harness();await e.start();
  const buff=createBuff(e,'R1');
  assert.equal(e.api().secondsPerRound,6);
  await e.api().schedule({id:'out',effectUuid:buff.uuid,duration:{value:3,unit:'rounds'}});
  assert.equal(e.api().listTimers()[0].remainingSeconds,18);
  await e.tick(17);assert.equal(buff.system.active,true);
  await e.tick(1);assert.equal(buff.system.active,false);
  assert.equal(e.api().listTimers().length,0);
  await e.tick(120);assert.deepEqual(buff.activation,[false]);

  // Pause & backward time cannot restore or refresh an already spent interval.
  const a=createAE(e,'Rewind');
  await e.api().schedule({id:'rewind',effectUuid:a.uuid,duration:{value:1,unit:'minutes'},effectAction:'delete'});
  await e.tick(30);assert.equal(a.deleted,false);
  await e.tick(-15);await e.tick(15);assert.equal(a.deleted,false);
  await e.tick(30);assert.equal(a.deleted,true);

  // 2. F5 outside combat must recover the original absolute world time.
  const f=createAE(e,'Reload');
  await e.api().schedule({id:'reload',effectUuid:f.uuid,duration:{value:1,unit:'minutes'}});
  await e.tick(20);
  const reload=harness({storage:e.storage,docs:e.docs,clock:e.clock,combats:e.combats,users:e.users});
  await reload.start();
  assert.equal(reload.api().listTimers().find(t=>t.id==='reload').remainingSeconds,40);
  await reload.tick(40);assert.equal(f.disabled,true);

  // 3. World -> combat -> world, no double count when worldTime also
  // advances by 6 seconds per combat round (Foundry-native clock).
  const c=combat('C1');
  const x=createAE(reload,'Transition');
  await reload.api().schedule({id:'transition',effectUuid:x.uuid,duration:{value:4,unit:'rounds'}});
  await reload.tick(6);assert.equal(reload.api().listTimers()[0].remainingSeconds,18);
  await reload.begin(c);
  assert.equal(reload.api().listTimers()[0].mode,'combat');
  await reload.tick(6);await reload.round(c,2);
  assert.equal(reload.api().listTimers()[0].remainingSeconds,12,'same 6 seconds must not count twice');
  const reloadCombat=harness({storage:reload.storage,docs:reload.docs,clock:reload.clock,combats:reload.combats,combat:c,users:reload.users});
  await reloadCombat.start();
  await reloadCombat.tick(6);await reloadCombat.round(c,3);
  assert.equal(reloadCombat.api().listTimers()[0].remainingSeconds,6);
  await reloadCombat.end(c);
  assert.equal(reloadCombat.api().listTimers()[0].mode,'world');
  await reloadCombat.tick(6);
  assert.equal(x.disabled,true);
  assert.equal(reloadCombat.api().listTimers().length,0);

  // 4. Combat starts with world-time frozen, expired combat rounds count after F5.
  const d=combat('C2');await reloadCombat.begin(d);
  const z=createBuff(reloadCombat,'Combat');
  await reloadCombat.api().schedule({id:'combat',effectUuid:z.uuid,duration:{value:2,unit:'rounds'}});
  await reloadCombat.round(d,2);
  assert.equal(reloadCombat.api().listTimers()[0].remainingSeconds,6);
  // Simulate an undetected round change while the GM is disconnected.
  d.round=3;
  const f5=harness({storage:reloadCombat.storage,docs:reloadCombat.docs,clock:reloadCombat.clock,combats:reloadCombat.combats,combat:d,users:reloadCombat.users});
  await f5.start();
  assert.equal(z.system.active,false);
  assert.equal(f5.api().listTimers().length,0);

  // 5. Group callback + safe extension, no reapplication.
  await f5.end(d);
  const g=createAE(f5,'GroupOther');
  f5.api();
  f5.game.modules.get(NS).api.effectGroups.validateDurationGroupTimer=id=>id==='groupA';
  const expirations=[];
  f5.game.modules.get(NS).api.effectGroups.expireGroup=async id=>expirations.push(id);
  await f5.api().schedule({id:'groupTimer',effectGroupId:'groupA',duration:{value:1,unit:'rounds'}});
  await f5.api().extendTimer('groupTimer',{duration:{value:2,unit:'rounds'}});
  assert.equal(f5.api().listTimers()[0].remainingSeconds,18);
  await f5.tick(17);assert.equal(expirations.length,0);
  await f5.tick(1);assert.deepEqual(expirations,['groupA']);
  assert.equal(f5.api().listTimers().length,0);

  // 6. Isolated item script target, no item.use() and no resources spent.
  let scriptRuns=0;
  const actor={uuid:'Actor.script',documentName:'Actor'};
  const item={uuid:'Actor.script.Item.feat',documentName:'Item',actor,
    scriptCalls:{contents:[{id:'sync',category:'use',async execute(){scriptRuns++;}}]}};
  f5.docs.set(item.uuid,item);
  await f5.api().schedule({id:'script',itemUuid:item.uuid,scriptId:'sync',scriptCategory:'use',duration:{value:6,unit:'seconds'}});
  await f5.tick(6);assert.equal(scriptRuns,1);

  // 7. Only elected GM can write; offline GM blocked, and invalid input rejected.
  const assistant=harness({storage:f5.storage,docs:f5.docs,clock:f5.clock,combats:f5.combats,users:f5.users,user:f5.users[1]});
  await assistant.start();
  assert.equal(assistant.api().listTimers().length,0);
  await assert.rejects(()=>assistant.api().schedule({id:'bad',effectUuid:g.uuid,duration:{value:1,unit:'rounds'}}),/MJ responsable/);
  await assert.rejects(()=>f5.api().schedule({id:'bad',effectUuid:g.uuid,duration:{value:0,unit:'rounds'}}),/Durée invalide/);
  assert.equal(f5.clock.worldTime, e.clock.worldTime, 'module never modifies the world clock directly');
  console.log('PF1 Automation Engine v1.8.0: duration tests OK');
}
test().catch(error=>{console.error(error);process.exitCode=1;});
