'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root=path.resolve(__dirname,'..');
const groupSource=fs.readFileSync(path.join(root,'scripts/effect-groups.js'),'utf8');
const engineSource=fs.readFileSync(path.join(root,'scripts/generic-automation.js'),'utf8');
const NS='pf1-automation-engine';
let uid=0;
function makeHarness(shared) {
  const storage=shared?.storage ?? new Map();
  const documents=shared?.documents ?? new Map();
  const users=shared?.users ?? [
    {id:'a',name:'MJ',active:true,isGM:true},
    {id:'b',name:'Assistant',active:true,isGM:true},
    {id:'p',name:'Joueur',active:true,isGM:false}
  ];
  users.get=id=>users.find(u=>u.id===id);
  const socket=shared?.socket ?? new Map();
  const hooks=new Map();
  const log=[];
  const user=shared?.user ?? users[0];
  const gameModule={active:true,api:{migration:{whenReady:async()=>{}},discovery:{scan:async()=>{},ensureScanned:async()=>{},listApproved:()=>[],stillApproved:async()=>true}}};
  const actors=shared?.actors ?? makeActors(documents,users);
  const combat=shared?.combat ?? makeCombat(actors);
  const scene=shared?.scene ?? makeScene(actors);
  combat.scene=scene;
  const game={user,users,modules:new Map([[NS,gameModule]]),combats:new Map([[combat.id,combat]]),combat,scenes:new Map([[scene.id,scene]]),
    settings:{
      register(ns,key,opts){if(!storage.has(`${ns}.${key}`))storage.set(`${ns}.${key}`,structuredClone(opts.default));},
      get(ns,key){return storage.get(`${ns}.${key}`);},
      async set(ns,key,v){storage.set(`${ns}.${key}`,structuredClone(v));return v;}
    },
    socket:{
      on(topic,fn){socket.set(topic,[...(socket.get(topic)??[]),fn]);},
      emit(topic,data){for(const fn of socket.get(topic)??[]) fn(data);}
    }
  };
  const Hooks={on(name,fn){hooks.set(name,[...(hooks.get(name)??[]),fn]);},once(name,fn){this.on(name,fn);},async fire(name,...args){for(const fn of hooks.get(name)??[])await fn(...args);}};
  const ctx={game,Hooks,fromUuid:async uuid=>documents.get(uuid)??null,canvas:{scene},ui:{notifications:{}},ChatMessage:{},
    foundry:{utils:{deepClone:structuredClone,randomID:()=>`id-${++uid}`}},console:{log:(...x)=>log.push(x),info:(...x)=>log.push(x),warn:(...x)=>log.push(x),debug:(...x)=>log.push(x),error:(...x)=>log.push(x)}};
  vm.runInNewContext(groupSource,ctx,{filename:'effect-groups.js'});
  vm.runInNewContext(engineSource,ctx,{filename:'generic-automation.js'});
  async function wait(){for(let i=0;i<20;i++)await new Promise(r=>setTimeout(r,0));}
  async function start(){await Hooks.fire('init');await Hooks.fire('ready');await wait();}
  async function transition(round,turn,previous,next){
    const old={round:combat.round,turn:combat.turn,combatantId:previous};
    const current={round,turn,combatantId:next};
    combat.round=round;combat.turn=turn;combat.combatant=combat.combatants.get(next);
    await Hooks.fire('combatTurnChange',combat,old,current); await wait();
  }
  return {start,wait,transition,game,actors,combat,scene,documents,storage,log,socket,users,api:()=>gameModule.api};
}
function collection(){return new Map();}
function makeActors(documents,users){
  const actors=[];
  for(const [id,name] of [['source','Source'],['ally1','Allié 1'],['ally2','Allié 2'],['enemy','Ennemi']]){
    const actor={id,name,uuid:`Actor.${id}`,documentName:'Actor',items:collection(),effects:collection(),isOwner:true,
      testUserPermission(user,rank){return id==='source' && user.id==='p' || user.isGM || (id==='ally1' && user.id==='p');},
      async createEmbeddedDocuments(kind,objects){
        const result=[];
        for(const data of objects){
          const docId=`copy-${++uid}`;
          const doc={id:docId,uuid:`${actor.uuid}.${kind}.${docId}`,parent:actor,actor,documentName:kind,
            name:data.name,type:data.type,system:structuredClone(data.system??{}),disabled:data.disabled??false,
            flags:structuredClone(data.flags??{}),lastActive:null,deleted:false,
            getFlag(ns,key){return this.flags?.[ns]?.[key];},
            async update(changes){if('system.active'in changes)this.system.active=changes['system.active'];if('disabled'in changes)this.disabled=changes.disabled;},
            async setActive(v){this.system.active=v;this.lastActive=v;},
            async delete(){this.deleted=true;(kind==='Item'?actor.items:actor.effects).delete(this.id);documents.delete(this.uuid);}
          };
          (kind==='Item'?actor.items:actor.effects).set(docId,doc);
          documents.set(doc.uuid,doc);result.push(doc);
        }
        return result;
      }
    };
    documents.set(actor.uuid,actor);actors.push(actor);
  }
  const source=actors[0];
  const effectTemplate={id:'tmpl-a',uuid:`${source.uuid}.ActiveEffect.tmpl-a`,name:'Test effect',documentName:'ActiveEffect',parent:source,flags:{},
    toObject(){return {_id:'tmpl-a',name:this.name,disabled:true,flags:{},duration:{rounds:10},changes:[{key:'system.attributes.ac.normal.total',mode:2,value:'1'}]};}};
  const buffTemplate={id:'tmpl-b',uuid:`${source.uuid}.Item.tmpl-b`,name:'Test buff',documentName:'Item',type:'buff',parent:source,flags:{},
    toObject(){return {_id:'tmpl-b',name:'Test buff',type:'buff',system:{active:true},flags:{},systemActive:1};}};
  source.effects.set(effectTemplate.id,effectTemplate);source.items.set(buffTemplate.id,buffTemplate);
  documents.set(effectTemplate.uuid,effectTemplate);documents.set(buffTemplate.uuid,buffTemplate);
  actors.templates={effectTemplate,buffTemplate};
  return actors;
}
function makeCombat(actors){
  const combat={id:'C',started:true,round:1,turn:0,combatants:new Map([
    ['A',{id:'A',actor:actors[0]}],['B',{id:'B',actor:actors[1]}]
  ])};
  combat.combatant=combat.combatants.get('A');return combat;
}
function makeScene(actors){
  return {id:'S',tokens:[{actor:actors[0],disposition:1},{actor:actors[1],disposition:1},{actor:actors[2],disposition:1},{actor:actors[3],disposition:-1}]};
}
async function test(){
  const e=makeHarness();await e.start();
  const api=e.api();
  assert.equal(api.generic.isLeader(),true);
  assert.equal(typeof api.effectGroups.applyGroup,'function');
  await assert.rejects(()=>api.effectGroups.applyGroup({actor:e.actors[0],key:'test',templateUuid:e.actors.templates.effectTemplate.uuid,targets:[e.actors[1]],timing:'endOfCurrentTurn'}),/non approuvé/);
  await api.effectGroups.approveTemplate(e.actors.templates.effectTemplate.uuid);
  await api.effectGroups.approveTemplate(e.actors.templates.buffTemplate.uuid);
  assert.equal(api.effectGroups.listApprovedTemplates().length,2);

  const r=await api.effectGroups.applyGroup({actor:e.actors[0],key:'test',templateUuid:e.actors.templates.effectTemplate.uuid,
    targets:[e.actors[1],e.actors[2]],timing:'endOfCurrentTurn'});
  assert.equal(r.applied,true);assert.equal(r.targetCount,2);
  assert.equal(e.actors[1].effects.size,1);assert.equal(e.actors[2].effects.size,1);
  assert.equal(api.generic.listTimers().length,1);
  await e.transition(1,1,'A','B');
  assert.equal(e.actors[1].effects.size,0,'first ally cleaned at end of caster turn');
  assert.equal(e.actors[2].effects.size,0,'second ally cleaned at end of caster turn');
  assert.equal(api.generic.listTimers().length,0);
  assert.equal(api.effectGroups.listGroups().length,0);

  // PF1 buffs are native Items activated by setActive(true), then entirely removed.
  await e.transition(2,0,'B','A');
  const p=await api.effectGroups.applyGroup({actor:e.actors[0],key:'buff',templateUuid:e.actors.templates.buffTemplate.uuid,
    targets:[e.actors[0],e.actors[1]],timing:'endOfNextTurn'});
  assert.equal(e.actors[0].items.size,2);
  assert.equal(e.actors[1].items.size,1);
  assert.equal([...e.actors[1].items.values()][0].lastActive,true);
  const buffCopy=[...e.actors[1].items.values()][0];
  await e.transition(2,1,'A','B');
  assert.equal(buffCopy.deleted,false);
  await e.transition(3,0,'B','A');
  assert.equal(buffCopy.deleted,false);
  await e.transition(3,1,'A','B');
  assert.equal(buffCopy.deleted,true);
  assert.equal(buffCopy.lastActive,false,'PF1 buff native toggle-off runs before deletion');
  assert.equal(e.actors[0].items.size,1);
  assert.equal(api.effectGroups.listGroups().length,0);

  // Restore timers and managed group state after F5 and change GM leader.
  await e.transition(4,0,'B','A');
  const r2=await api.effectGroups.applyGroup({actor:e.actors[0],key:'reload',templateUuid:e.actors.templates.effectTemplate.uuid,
    targets:[e.actors[1]],timing:'startOfNextTurn'});
  assert.equal(e.actors[1].effects.size,1);
  const reload=makeHarness({storage:e.storage,documents:e.documents,users:e.users,actors:e.actors,combat:e.combat,scene:e.scene});
  await reload.start();
  assert.equal(reload.api().generic.listTimers().length,1);
  await reload.transition(4,1,'A','B');assert.equal(e.actors[1].effects.size,1);
  await reload.transition(5,0,'B','A');
  assert.equal(e.actors[1].effects.size,0);
  assert.equal(reload.api().effectGroups.listGroups().length,0);

  // A player (not GM) may only submit requests, not alter world state directly.
  await reload.transition(5,1,'A','B');await reload.transition(6,0,'B','A');
  const player=makeHarness({storage:e.storage,documents:e.documents,users:e.users,actors:e.actors,combat:e.combat,scene:e.scene,socket:reload.socket,user:e.users[2]});
  await player.start();
  const sent=await player.api().effectGroups.applyGroup({actor:e.actors[0],key:'player',templateUuid:e.actors.templates.effectTemplate.uuid,
    targets:[e.actors[1],e.actors[2]],timing:'endOfCurrentTurn'});
  assert.equal(sent.submitted,true);
  await reload.wait();
  assert.equal(e.actors[1].effects.size,1);
  assert.equal(e.actors[2].effects.size,1);
  assert.equal(player.api().generic.isLeader(),false);
  await assert.rejects(()=>player.api().effectGroups.approveTemplate(e.actors.templates.buffTemplate.uuid),/MJ responsable/);
  // The elected GM may apply a negative effect; a player request may only affect allies.
  await assert.rejects(()=>reload.api().effectGroups.applyGroup({actor:e.actors[0],key:'unapproved',templateUuid:'NOPE',targets:[e.actors[1]]}),/modèle/i);
  await player.api().effectGroups.applyGroup({actor:e.actors[0],key:'attack',templateUuid:e.actors.templates.effectTemplate.uuid,
    targets:[e.actors[3]],timing:'endOfCurrentTurn'});
  await reload.wait();
  assert.equal(e.actors[3].effects.size,0);
  // A second MJ cannot execute group mutations while the primary GM is online.
  const assistant=makeHarness({storage:e.storage,documents:e.documents,users:e.users,actors:e.actors,combat:e.combat,scene:e.scene,user:e.users[1]});
  await assistant.start();
  assert.equal(assistant.api().generic.isLeader(),false);
  await assert.rejects(()=>assistant.api().effectGroups.approveTemplate(e.actors.templates.effectTemplate.uuid),/MJ responsable/);
  await reload.transition(6,1,'A','B');
  assert.equal(e.actors[1].effects.size,0);
  assert.equal(e.actors[2].effects.size,0);

  // Source approval invalidates after template changes.
  e.actors.templates.effectTemplate.name='Modified';
  await reload.transition(7,0,'B','A');
  await assert.rejects(()=>reload.api().effectGroups.applyGroup({actor:e.actors[0],key:'changed',templateUuid:e.actors.templates.effectTemplate.uuid,targets:[e.actors[1]],timing:'endOfCurrentTurn'}),/non approuvé|modifié/);
  console.log('PF1 Automation Engine v1.7.0: multi-target effects tests OK');
}
test().catch(e=>{console.error(e);process.exitCode=1});
