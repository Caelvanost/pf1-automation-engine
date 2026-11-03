'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const dir=path.resolve(__dirname,'..');
const sources=['scripts/effect-groups.js','scripts/generic-automation.js'].map(x=>fs.readFileSync(path.join(dir,x),'utf8'));
const NS='pf1-automation-engine';
let id=0;
function setup(shared={}) {
  const storage=shared.storage??new Map();
  const docs=shared.docs??new Map();
  const users=shared.users??[{id:'gm',active:true,isGM:true},{id:'player',active:true,isGM:false}];
  users.get=x=>users.find(u=>u.id===x);
  const sourceUser=shared.user??users[0];
  const actors=shared.actors??['Barde','Ally 1','Ally 2'].map((name,i)=>{
    const actor={name,id:`a${i}`,uuid:`Actor.a${i}`,documentName:'Actor',items:new Map(),effects:new Map(),isOwner:i===0,
      testUserPermission(u){return !!u.isGM || (u.id==='player'&&i===0);},
      async createEmbeddedDocuments(kind,objects){
        const result=[];
        for(const obj of objects) {
          const doc={id:`copy-${++id}`,parent:actor,actor,documentName:kind,name:obj.name,
            type:obj.type,system:structuredClone(obj.system??{}),flags:structuredClone(obj.flags??{}),
            disabled:obj.disabled??false,deleteCount:0,getFlag(ns,key){return this.flags[ns]?.[key];},
            async setActive(v){this.system.active=v;},
            async update(changes){if('system.active' in changes)this.system.active=changes['system.active'];},
            async delete(){this.deleteCount++;(kind==='Item'?actor.items:actor.effects).delete(this.id);docs.delete(this.uuid);}
          };
          doc.uuid=`${actor.uuid}.${kind}.${doc.id}`;
          (kind==='Item'?actor.items:actor.effects).set(doc.id,doc);docs.set(doc.uuid,doc);
          result.push(doc);
        }
        return result;
      }
    };
    docs.set(actor.uuid,actor);return actor;
  });
  if (!shared.actors) {
    const model={id:'model',name:'Inspire Courage',documentName:'Item',type:'buff',parent:actors[0],
      uuid:`${actors[0].uuid}.Item.model`,
      toObject(){return {_id:'model',name:this.name,type:this.type,flags:{},system:{active:false}};}};
    docs.set(model.uuid,model);actors[0].items.set(model.id,model);
  }
  const template=actors[0].items.get('model');
  const combat=shared.combat??{id:'C',started:true,round:1,turn:1,combatants:new Map()};
  if (!shared.combat){
    combat.combatants.set('npc',{id:'npc',actor:actors[1]});
    combat.combatants.set('bard',{id:'bard',actor:actors[0]});
    combat.turns=[combat.combatants.get('npc'),combat.combatants.get('bard')];
    combat.combatant=combat.combatants.get('bard');
  }
  const scene=shared.scene??{id:'S',tokens:actors.map(actor=>({actor,disposition:1}))};
  combat.scene=scene;
  const callbacks=new Map();
  const Hooks={on(name,fn){callbacks.set(name,[...(callbacks.get(name)??[]),fn]);},once(name,fn){this.on(name,fn);},async fire(name,...args){for(const fn of callbacks.get(name)??[]) await fn(...args);}};
  const sockets=shared.sockets??new Map();
  const mod={active:true,api:{migration:{whenReady:async()=>{}},discovery:{scan:async()=>{},ensureScanned:async()=>{},listApproved:()=>[],stillApproved:async()=>true}}};
  const game={user:sourceUser,users,modules:new Map([[NS,mod]]),combat,combats:new Map([['C',combat]]),scenes:new Map([['S',scene]]),
    settings:{
      register(ns,key,options){if(!storage.has(`${ns}.${key}`)) storage.set(`${ns}.${key}`,structuredClone(options.default));},
      get(ns,key){return storage.get(`${ns}.${key}`);},
      async set(ns,key,data){storage.set(`${ns}.${key}`,structuredClone(data));return data;}
    },
    socket:{on(channel,fn){sockets.set(channel,[...(sockets.get(channel)??[]),fn]);},emit(channel,payload){for(const fn of sockets.get(channel)??[])fn(payload);}}
  };
  const ctx={game,Hooks,fromUuid:async uuid=>docs.get(uuid)??null,canvas:{scene},ui:{notifications:{}},
    foundry:{utils:{randomID:()=>`new-${++id}`,deepClone:structuredClone}},CONST:{TOKEN_DISPOSITIONS:{FRIENDLY:1}},console};
  for(let i=0;i<sources.length;i++)vm.runInNewContext(sources[i],ctx,{filename:['effect-groups','generic-automation'][i]});
  async function settle(){for(let i=0;i<20;i++) await new Promise(resolve=>setTimeout(resolve,0));}
  async function start(){await Hooks.fire('init');await Hooks.fire('ready');await settle();}
  async function transition(round,turn){
    const before={round:combat.round,turn:combat.turn,combatantId:combat.combatant.id};
    combat.round=round;combat.turn=turn;
    combat.combatant=combat.turns[turn];
    await Hooks.fire('combatTurnChange',combat,before,{round,turn,combatantId:combat.combatant.id});
    await settle();
  }
  return {start,settle,transition,Hooks,api:()=>mod.api,game,actors,template,combat,storage,docs,scene,users,sockets,
    currentCopies:()=>actors[1].items.size+actors[2].items.size};
}
async function test() {
  const s=setup();await s.start();
  await s.api().effectGroups.approveTemplate(s.template.uuid);
  const applied=await s.api().effectGroups.applyGroup({actor:s.actors[0],key:'inspire-courage',
    templateUuid:s.template.uuid,targets:[s.actors[1],s.actors[2]],timing:'endOfNextTurn'});
  assert.equal(applied.targetCount,2);
  assert.equal(s.currentCopies(),2);
  assert.equal(s.api().generic.listTimers()[0].targetRound,2,'deadline anchored to cast round');
  // End caster turn in r1, then r2 starts. Refresh while it is not the bard's turn.
  await s.transition(2,0);
  assert.equal(s.currentCopies(),2);
  const shared={storage:s.storage,docs:s.docs,actors:s.actors,combat:s.combat,scene:s.scene,users:s.users,sockets:s.sockets};
  let reloaded=setup(shared);await reloaded.start();
  assert.equal(reloaded.api().generic.listTimers()[0].targetRound,2,'deadline persisted across F5');
  assert.equal(reloaded.api().generic.listTimers()[0].due??false,false,'not due early after F5');
  await reloaded.transition(2,1);
  assert.equal(s.currentCopies(),2,'buffs remain at start of bard turn');
  await reloaded.transition(3,0);
  assert.equal(s.currentCopies(),0,'expiration at end of bard round 2, not round 3');
  assert.equal(reloaded.api().generic.listTimers().length,0);
  assert.equal(reloaded.api().effectGroups.listGroups().length,0);
  // The next group is extended at the bard's next turn by exactly one round.
  await reloaded.transition(3,1);
  await reloaded.api().effectGroups.applyGroup({actor:s.actors[0],key:'inspire-courage',
    templateUuid:s.template.uuid,targets:[s.actors[1],s.actors[2]],timing:'endOfNextTurn'});
  assert.equal(reloaded.api().generic.listTimers()[0].targetRound,4);
  await reloaded.transition(4,0);
  await reloaded.transition(4,1);
  const copiesBefore=s.actors[1].items.get([...s.actors[1].items.keys()][0]);
  const extended=await reloaded.api().effectGroups.extendGroup({actor:s.actors[0],key:'inspire-courage',rounds:1});
  assert.equal(extended.extended,true);
  assert.equal(extended.targetRound,5);
  assert.equal(s.actors[1].items.get(copiesBefore.id),copiesBefore,'same original buff; no duplication');
  assert.equal(reloaded.api().effectGroups.listGroups().length,1);
  await reloaded.transition(5,0);
  assert.equal(s.currentCopies(),2,'extended past original deadline');
  const afterExtensionReload=setup(shared);await afterExtensionReload.start();
  assert.equal(afterExtensionReload.api().generic.listTimers()[0].targetRound,5,'extension survives F5');
  await afterExtensionReload.transition(5,1);
  assert.equal(s.currentCopies(),2);
  await afterExtensionReload.transition(6,0);
  assert.equal(s.currentCopies(),0,'extended group expires at end of round 5');
  // A previously-created v1.7.0 timer can be recovered from creation data.
  await afterExtensionReload.transition(6,1);
  await afterExtensionReload.api().effectGroups.applyGroup({actor:s.actors[0],key:'inspire-courage',
    templateUuid:s.template.uuid,targets:[s.actors[1]],timing:'endOfNextTurn'});
  const entry=afterExtensionReload.api().generic.listTimers()[0];
  delete entry.targetRound;
  await afterExtensionReload.game.settings.set(NS,'timerRegistry',[entry]);
  await afterExtensionReload.transition(7,0);
  const legacy=setup(shared);await legacy.start();
  assert.equal(legacy.api().generic.listTimers()[0].targetRound,7,'legacy v1.7 timer migrated without resetting round');
  await legacy.transition(7,1);await legacy.transition(8,0);
  assert.equal(s.currentCopies(),0,'legacy timer expires as originally promised');
  // Explicit player socket: submitting a maintenance action extends the GM's
  // deadline rather than recreating the active effect on the allies.
  await legacy.transition(8,1);
  await legacy.api().effectGroups.applyGroup({actor:s.actors[0],key:'inspire-courage',
    templateUuid:s.template.uuid,targets:[s.actors[1]],timing:'endOfNextTurn'});
  const sockets=new Map();
  const gm=setup({...shared,sockets});await gm.start();
  const player=setup({...shared,sockets,user:s.users[1]});await player.start();
  const oldGroup=gm.api().effectGroups.listGroups()[0].id;
  const sent=await player.api().effectGroups.extendGroup({actor:s.actors[0],key:'inspire-courage',rounds:1});
  assert.equal(sent.submitted,true,'player request is queued for GM processing');
  await gm.settle();
  assert.equal(gm.api().generic.listTimers()[0].targetRound,10,'GM accepted round extension');
  assert.equal(gm.api().effectGroups.listGroups()[0].id,oldGroup,'group identity preserved');
  assert.equal(s.currentCopies(),1,'no extra buff copy after player extension');
  await assert.rejects(()=>gm.api().effectGroups.extendGroup({actor:s.actors[0],key:'missing-group',rounds:1}),/Aucun groupe/);
  // Regression reported in Foundry v13: after F5 in round 2, the first
  // end-of-bard-turn sometimes arrives without usable turn history. Absolute
  // round deadlines must still expire on updateCombat (not on rewind/replay).
  const interrupted=setup();
  await interrupted.start();
  await interrupted.api().effectGroups.approveTemplate(interrupted.template.uuid);
  await interrupted.api().effectGroups.applyGroup({
    actor:interrupted.actors[0],key:'inspire-courage',
    templateUuid:interrupted.template.uuid,
    targets:[interrupted.actors[1],interrupted.actors[2]],
    timing:'endOfNextTurn'
  });
  await interrupted.transition(2,0);
  const restored=setup({
    storage:interrupted.storage,docs:interrupted.docs,actors:interrupted.actors,
    combat:interrupted.combat,scene:interrupted.scene,users:interrupted.users
  });
  await restored.start();
  assert.equal(restored.api().generic.listTimers()[0].targetRound,2);
  assert.equal(restored.currentCopies(),2);
  // A non-turn update must not expire the buff.
  await restored.Hooks.fire('updateCombat',restored.combat,{name:'renamed'});
  await restored.settle();
  assert.equal(restored.currentCopies(),2);
  // First transition after F5 may have incomplete prior metadata.
  restored.combat.round=2;restored.combat.turn=1;
  restored.combat.combatant=restored.combat.turns[1];
  await restored.Hooks.fire('combatTurnChange',restored.combat,
    {round:null,turn:null,combatantId:null},
    {round:2,turn:1,combatantId:'bard'});
  await restored.Hooks.fire('updateCombat',restored.combat,{turn:1});
  await restored.settle();
  assert.equal(restored.currentCopies(),2,'not expired at start of bard turn');
  restored.combat.round=3;restored.combat.turn=0;
  restored.combat.combatant=restored.combat.turns[0];
  await restored.Hooks.fire('combatTurnChange',restored.combat,
    {round:null,turn:null,combatantId:null},
    {round:3,turn:0,combatantId:'npc'});
  await restored.Hooks.fire('updateCombat',restored.combat,{round:3,turn:0});
  await restored.settle();
  assert.equal(restored.currentCopies(),0,
    'updateCombat expires group exactly at end of bard round 2 after F5');
  assert.equal(restored.api().generic.listTimers().length,0);
  assert.equal(restored.api().effectGroups.listGroups().length,0);
  // Duplicate hooks after the expiration are harmless.
  await restored.Hooks.fire('updateCombat',restored.combat,{round:3});
  await restored.settle();
  assert.equal(restored.currentCopies(),0);
  console.log('v1.7.1: F5, round extension, player socket, originals, legacy recovery OK');
}
test().catch(e=>{console.error(e);process.exitCode=1});
