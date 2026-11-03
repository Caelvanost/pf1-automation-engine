'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const SOURCE = fs.readFileSync(path.join(__dirname, '../scripts/generic-automation.js'), 'utf8');
const NS = 'pf1-automation-engine';

function env(shared) {
  const storage=shared?.storage ?? new Map();
  const documents=shared?.documents ?? new Map();
  const users=shared?.users ?? [{id:'a',active:true,isGM:true},{id:'b',active:true,isGM:true}];
  const client=shared?.user ?? users[0];
  const logs=[];
  const hooks=new Map();
  const comp={id:'combat1',round:1,turn:0,started:true};
  const actors=[{id:'actorA',uuid:'Actor.actorA',documentName:'Actor',name:'A'},{id:'actorB',uuid:'Actor.actorB',documentName:'Actor',name:'B'}];
  comp.combatants=new Map([
    ['A',{id:'A',actor:actors[0]}],
    ['B',{id:'B',actor:actors[1]}]
  ]);
  comp.combatant=comp.combatants.get('A');
  const module={id:NS,active:true,api:{discovery:{scan:async()=>{},ensureScanned:async()=>{},listApproved:()=>[],stillApproved:async()=>true},migration:{whenReady:async()=>{}}}};
  const game={
    user:client,users, modules:new Map([[NS,module]]),combats:new Map([[comp.id,comp]]),combat:comp,
    settings:{
      register(ns,k,opt){if(!storage.has(ns+'.'+k))storage.set(ns+'.'+k,structuredClone(opt.default));},
      get(ns,k){return storage.get(ns+'.'+k)},
      async set(ns,k,v){storage.set(ns+'.'+k,structuredClone(v));return v;}
    }
  };
  const Hooks={
    on(name,fn){hooks.set(name,[...(hooks.get(name)??[]),fn]);},
    once(name,fn){this.on(name,fn);},
    async fire(name,...args){for(const fn of hooks.get(name)??[])await fn(...args);}
  };
  const ctx={Hooks,game,foundry:{utils:{deepClone:structuredClone,randomID:()=> 'mockID'}},
    fromUuid:async id=>documents.get(id),ChatMessage:{},canvas:{},ui:{},
    console:{log:(...x)=>logs.push(x),debug:(...x)=>logs.push(x),info:(...x)=>logs.push(x),warn:(...x)=>logs.push(x),error:(...x)=>logs.push(x)}
  };
  vm.runInNewContext(SOURCE,ctx,{filename:'generic-automation.js'});
  async function tick() {
    for(let i=0;i<10;i++) await new Promise(resolve=>setTimeout(resolve,0));
  }
  async function start(){await Hooks.fire('init'); await Hooks.fire('ready');await tick();}
  async function advance({round,turn,previous,next}) {
    const prior={round:comp.round,turn:comp.turn,combatantId:previous};
    const current={round,turn,combatantId:next};
    comp.round=round;comp.turn=turn;comp.combatant=comp.combatants.get(next);
    await Hooks.fire('combatTurnChange',comp,prior,current);
    await tick();
  }
  function effect(id, kind='ActiveEffect') {
    const actor=actors[0];
    const doc=kind==='Item'? {
      id,uuid:id,documentName:'Item',type:'buff',name:'Buff',system:{active:true},activeState:true,parent:actor,actor,
      async setActive(value,opts){this.system.active=value;this.activeState=value;this.writes=(this.writes??0)+1;this.lastOptions=opts;}
    } : {
      id,uuid:id,documentName:'ActiveEffect',parent:actor,disabled:false,
      async update(data,opts){Object.assign(this,data);this.writes=(this.writes??0)+1;this.lastOptions=opts;},
      async delete(opts){this.removed=true;this.writes=(this.writes??0)+1;this.lastOptions=opts;documents.delete(id);}
    };
    documents.set(id,doc);return doc;
  }
  return {start,tick,advance,game,comp,documents,effect,logs,actors,storage,
    api:()=>module.api.generic};
}
async function main(){
  let e=env();await e.start();
  let api=e.api();
  assert.equal(typeof api.scheduleTurn,'function');
  assert.equal(typeof api.expireEffectAt,'function');
  assert.equal(typeof api.schedule,'function');
  assert.equal(typeof api.cancelTimer,'function');
  const atEnd=e.effect('Actor.actorA.ActiveEffect.end');
  const atNextStart=e.effect('Actor.actorA.ActiveEffect.start');
  const atNextEnd=e.effect('Actor.actorA.ActiveEffect.nextEnd');
  const buff=e.effect('Actor.actorA.Item.buff','Item');
  await api.expireEffectAt({id:'atEnd',effectUuid:atEnd.uuid,timing:'endOfCurrentTurn',combatantId:'A'});
  await api.expireEffectAt({id:'atStart',effectUuid:atNextStart.uuid,timing:'startOfNextTurn',combatantId:'A'});
  await api.expireEffectAt({id:'atNextEnd',effectUuid:atNextEnd.uuid,timing:'endOfNextTurn',combatantId:'A'});
  await api.expireEffectAt({id:'buff',effectUuid:buff.uuid,timing:'endOfCurrentTurn',combatantId:'A'});
  assert.equal(api.listTimers().length,4);
  await e.advance({round:1,turn:1,previous:'A',next:'B'});
  assert.equal(atEnd.disabled,true,'end of current turn expires on A departure');
  assert.equal(buff.system.active,false,'PF1 buff is turned off');
  assert.equal(buff.writes,1);
  assert.equal(atNextStart.disabled,false);
  assert.equal(atNextEnd.disabled,false);
  assert.equal(api.listTimers().length,2);
  await e.advance({round:2,turn:0,previous:'B',next:'A'});
  assert.equal(atNextStart.disabled,true,'next start fires when A becomes active');
  assert.equal(atNextEnd.disabled,false);
  await e.advance({round:2,turn:1,previous:'A',next:'B'});
  assert.equal(atNextEnd.disabled,true,'next end skips current end');
  assert.equal(api.listTimers().length,0);
  await e.advance({round:2,turn:1,previous:'A',next:'B'});
  assert.equal(atNextEnd.writes,1,'repeated transition is idempotent');

  // Scheduling another combatant mid-turn expires at their very next turn end.
  const targetB=e.effect('Actor.actorB.ActiveEffect.targetB');
  await api.expireEffectAt({id:'future',effectUuid:targetB.uuid,timing:'endOfNextTurn',combatantId:'A'});
  await e.advance({round:3,turn:0,previous:'B',next:'A'});
  assert.equal(targetB.disabled,false);
  await e.advance({round:3,turn:1,previous:'A',next:'B'});
  assert.equal(targetB.disabled,true);

  // Legacy schedule(unit: turns) continues to run scripts on A's turn end.
  let callbackCount=0;
  const callbackActor=e.actors[0];
  const scriptItem={uuid:'Actor.actorA.Item.callback',documentName:'Item',name:'Callback',actor:callbackActor,
    scriptCalls:[{id:'call1',name:'Expiration',category:'use',execute:async()=>{callbackCount++}}]};
  e.documents.set(scriptItem.uuid,scriptItem);
  await api.schedule({id:'legacy',itemUuid:scriptItem.uuid,scriptCategory:'use',scriptId:'call1',unit:'turns',amount:1,combatantId:'A'});
  await e.advance({round:4,turn:0,previous:'B',next:'A'});
  assert.equal(callbackCount,0);
  await e.advance({round:4,turn:1,previous:'A',next:'B'});
  assert.equal(callbackCount,1);

  // New phase timer can execute ONLY the selected native PF1 script.
  await e.advance({round:5,turn:0,previous:'B',next:'A'});
  await api.scheduleTurn({id:'script',itemUuid:scriptItem.uuid,scriptCategory:'use',scriptId:'call1',timing:'startOfNextTurn',combatantId:'A'});
  await e.advance({round:5,turn:1,previous:'A',next:'B'});
  assert.equal(callbackCount,1);
  await e.advance({round:6,turn:0,previous:'B',next:'A'});
  assert.equal(callbackCount,2);

  // Missing target at expiry => persisted due; becomes available after F5.
  const missing=e.effect('Actor.actorA.ActiveEffect.missing');
  await api.expireEffectAt({id:'retry',effectUuid:missing.uuid,timing:'endOfCurrentTurn',combatantId:'A'});
  e.documents.delete(missing.uuid);
  await e.advance({round:6,turn:1,previous:'A',next:'B'});
  assert.equal(api.listTimers().find(t=>t.id==='retry')?.due,true,'expiry is retained if its document disappears');
  e.documents.set(missing.uuid,missing);
  // Reloading the GM client rehydrates the persisted registry and executes due.
  const e2=env({storage:e.storage,documents:e.documents,users:e.game.users,user:e.game.user});
  await e2.start();
  assert.equal(missing.disabled,true,'pending expiry retried at F5 ready');
  assert.equal(e2.api().listTimers().some(t=>t.id==='retry'),false);

  // GM selection: secondary GM never executes or schedules timers.
  const secondary=env({storage:e2.storage,documents:e2.documents,users:e2.game.users,user:e2.game.users[1]});
  await secondary.start();
  assert.equal(secondary.api().isLeader(),false);
  await assert.rejects(()=>secondary.api().expireEffectAt({id:'forbidden',effectUuid:missing.uuid,timing:'startOfNextTurn',combatantId:'A'}),/MJ principal actif/);
  assert.equal(secondary.api().listTimers().some(t=>t.id==='forbidden'),false);

  // Wrong target types and destructive buff deletion are rejected.
  await assert.rejects(()=>e2.api().expireEffectAt({id:'wrong',effectUuid:buff.uuid,timing:'startOfNextTurn',effectAction:'delete'}),/interdite/);
  await assert.rejects(()=>e2.api().expireEffectAt({id:'wrong',effectUuid:missing.uuid,timing:'endOfCurrentTurn',combatantId:'B'}),/joue actuellement/);

  // Cancel never performs a callback.
  await e2.api().expireEffectAt({id:'cancel',effectUuid:atEnd.uuid,timing:'startOfNextTurn',combatantId:'A'});
  await e2.api().cancelTimer('cancel');
  assert.equal(e2.api().listTimers().some(t=>t.id==='cancel'),false);

  console.log('PF1 Automation Engine v1.6.0: turn-phase tests OK');
}
main().catch(e=>{console.error(e);process.exitCode=1});
