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
        if (this.failCreation) throw Error('Simulated target clone failure');
        const result=[];
        for(const data of objects){
          const docId=`copy-${++uid}`;
          const doc={id:docId,uuid:`${actor.uuid}.${kind}.${docId}`,parent:actor,actor,documentName:kind,
            name:data.name,type:data.type,system:structuredClone(data.system??{}),disabled:data.disabled??false,
            flags:structuredClone(data.flags??{}),creationInput:structuredClone(data),lastActive:null,deleted:false,
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

function makePackBuff() {
  const uuid="Compendium.pf1ae-test.buff-templates.Item.InspireABC";
  const raw={
    _id:"InspireABC",name:"Inspire Courage (Compendium)",type:"buff",
    img:"icons/songs.svg",
    folder:"old-folder",sort:4,
    ownership:{default:0},_stats:{modifiedTime:123},
    flags:{core:{sourceId:uuid},example:{approved:true}},
    system:{
      active:false,description:{value:"A generic test buff."},
      actions:[{_id:"scriptA",name:"An action"}],
      scriptCalls:[{_id:"scriptCallA",name:"On toggle",category:"toggle"}],
      changes:[{key:"system.attributes.ac.normal.total",value:"1"}]
    },
    effects:[{_id:"EmbeddedEffectOriginal",name:"Associated Effect",changes:[]}]
  };
  return {
    id:"InspireABC",uuid,documentName:"Item",type:"buff",pack:"pf1ae-test.buff-templates",
    name:raw.name,parent:null,raw,
    toObject(){return structuredClone(raw);}
  };
}
async function testCompendium(){
  const e=makeHarness();
  await e.start();
  const api=e.api();
  const source=e.actors[0],ally1=e.actors[1],ally2=e.actors[2];
  const pack=makePackBuff();
  e.documents.set(pack.uuid,pack);
  // Reject an unapproved pack model (the caster has NO technical buff).
  await assert.rejects(()=>api.effectGroups.applyGroup({
    actor:source,key:"inspire-courage",templateUuid:pack.uuid,
    targets:[ally1,ally2],timing:"endOfNextTurn"
  }),/non approuv/);
  assert.equal(source.items.size,1,"only the preexisting actor-owned test template");
  const approved=await api.effectGroups.approveTemplate(pack.uuid);
  assert.equal(approved,pack.uuid);
  const record=e.game.settings.get(NS,"effectTemplateApprovals")[pack.uuid];
  assert.equal(record.uuid,pack.uuid);
  assert.equal(record.templateType,"compendiumBuff");
  assert.match(record.hash,/^fnv1a64:[a-f0-9]{16}$/);
  assert.ok(record.fingerprint.includes("Inspire Courage"));
  assert.ok(record.fingerprint.includes("scriptCallA"));

  // A single Compendium template becomes two distinct actor-embedded buffs.
  const applied=await api.effectGroups.applyGroup({
    actor:source,key:"inspire-courage",templateUuid:pack.uuid,
    targets:[ally1,ally2],timing:"endOfNextTurn"
  });
  assert.equal(applied.applied,true);assert.equal(applied.targetCount,2);
  const copies=[...ally1.items.values(),...ally2.items.values()];
  assert.equal(copies.length,2);
  assert.notEqual(copies[0].uuid,copies[1].uuid);
  assert.ok(copies.every(c=>c.system.active === true));
  assert.ok(copies.every(c=>c.parent?.documentName === "Actor"));
  assert.equal(copies[0].getFlag(NS,"effectGroupId"),applied.groupId);
  assert.equal(copies[1].getFlag(NS,"effectGroupId"),applied.groupId);
  assert.equal(copies[0].creationInput._id,undefined,"pack _id never reused");
  assert.equal(copies[0].creationInput.ownership,undefined);
  assert.equal(copies[0].creationInput.folder,undefined);
  assert.equal(copies[0].creationInput.sort,undefined);
  assert.equal(copies[0].creationInput._stats,undefined);
  assert.equal(copies[0].creationInput.effects[0]._id,undefined);
  assert.equal(copies[0].creationInput.system.scriptCalls[0]._id,"scriptCallA",
    "PF1 script call IDs must not be stripped");
  assert.equal(copies[0].creationInput.flags.core.sourceId,undefined,
    "pack source provenance must not be inherited");
  assert.equal(pack.raw.system.active,false,"Compendium template must remain inactive");
  assert.equal(pack.raw._id,"InspireABC","Compendium item must remain unmodified");
  assert.equal(api.effectGroups.listGroups().length,1);
  assert.equal(api.generic.listTimers()[0].targetRound,2);

  // Reload while a group is active, then finish the caster's next turn.
  await e.transition(1,1,"A","B");
  await e.transition(2,0,"B","A");
  const reload=makeHarness({storage:e.storage,documents:e.documents,
    users:e.users,actors:e.actors,combat:e.combat,scene:e.scene});
  await reload.start();
  assert.equal(reload.api().effectGroups.listGroups().length,1);
  assert.equal(reload.api().generic.listTimers()[0].targetRound,2);
  await reload.transition(2,1,"A","B");
  assert.equal(ally1.items.size,0);
  assert.equal(ally2.items.size,0);
  assert.ok(copies.every(c=>c.deleted===true));
  assert.ok(copies.every(c=>c.lastActive===false));
  assert.equal(reload.api().effectGroups.listGroups().length,0);
  assert.equal(reload.api().generic.listTimers().length,0);

  // A second pack-based group supports extension without reapplying copies.
  await reload.transition(3,0,"B","A");
  const extendedGroup=await reload.api().effectGroups.applyGroup({
    actor:source,key:"inspire-extended",templateUuid:pack.uuid,
    targets:[ally1,ally2],timing:"endOfNextTurn"
  });
  const extendedCopies=[...ally1.items.values(),...ally2.items.values()];
  const extension=await reload.api().effectGroups.extendGroup({
    actor:source,key:"inspire-extended",rounds:1
  });
  assert.equal(extension.extended,true);
  assert.equal(reload.api().generic.listTimers()[0].targetRound,5);
  await reload.transition(3,1,"A","B");
  await reload.transition(4,0,"B","A");
  await reload.transition(4,1,"A","B");
  assert.ok(extendedCopies.every(c=>!c.deleted));
  assert.ok(extendedCopies.every(c=>c.lastActive===true),
    "extendGroup does not toggle or recreate buffs");
  await reload.api().effectGroups.stopGroup({actor:source,key:"inspire-extended"});
  await reload.wait();
  assert.ok(extendedCopies.every(c=>c.deleted===true));
  assert.equal(reload.api().effectGroups.listGroups().length,0);
  assert.equal(reload.api().generic.listTimers().length,0);

  // Content mutates after approval: the exact canonical fingerprint fails.
  const before=e.game.settings.get(NS,"effectTemplateApprovals")[pack.uuid];
  pack.raw.name="Inspire Courage (Revised)";
  pack.name=pack.raw.name;
  pack.raw.system.changes[0].value="2";
  pack.raw.flags.example.approved=false;
  await assert.rejects(()=>reload.api().effectGroups.applyGroup({
    actor:source,key:"changed-pack",templateUuid:pack.uuid,targets:[ally1],
    timing:"endOfCurrentTurn"
  }),/modifié depuis son approbation/);
  assert.equal(ally1.items.size,0);
  await reload.api().effectGroups.approveTemplate(pack.uuid);
  const after=e.game.settings.get(NS,"effectTemplateApprovals")[pack.uuid];
  assert.notEqual(after.hash,before.hash);
  assert.notEqual(after.fingerprint,before.fingerprint);
  await reload.api().effectGroups.applyGroup({
    actor:source,key:"reapproved-pack",templateUuid:pack.uuid,targets:[ally1],
    timing:"startOfNextTurn"
  });
  assert.equal(ally1.items.size,1);
  await reload.api().effectGroups.stopGroup({actor:source,key:"reapproved-pack"});
  await reload.wait();
  assert.equal(ally1.items.size,0);

  // Reordering object keys and modifying excluded pack metadata is harmless.
  pack.raw.folder="new-folder";
  pack.raw._stats.modifiedTime=987654;
  pack.raw.ownership.default=2;
  await reload.api().effectGroups.applyGroup({
    actor:source,key:"metadata-change",templateUuid:pack.uuid,targets:[ally1],
    timing:"startOfNextTurn"
  });
  await reload.api().effectGroups.stopGroup({actor:source,key:"metadata-change"});
  await reload.wait();

  const invalidPack={...makePackBuff(),id:"Spell",type:"spell",
    uuid:"Compendium.pf1ae-test.buff-templates.Item.Spell"};
  invalidPack.raw.type="spell";
  invalidPack.toObject=()=>structuredClone(invalidPack.raw);
  e.documents.set(invalidPack.uuid,invalidPack);
  await assert.rejects(()=>reload.api().effectGroups.approveTemplate(invalidPack.uuid),/Modèle refusé/);
  await assert.rejects(()=>reload.api().effectGroups.applyGroup({
    actor:source,key:"nonbuff",templateUuid:invalidPack.uuid,
    targets:[ally1],timing:"startOfNextTurn"
  }),/Modèle refusé/);
  await assert.rejects(()=>reload.api().effectGroups.approveTemplate("Compendium.unknown.pack.Item.missing"),/Modèle refusé/);
  await assert.rejects(()=>reload.api().effectGroups.applyGroup({
    actor:source,key:"missing",templateUuid:"Compendium.unknown.pack.Item.missing",
    targets:[ally1],timing:"startOfNextTurn"
  }),/Modèle introuvable/);

  // Existing ACTOR buff approvals can still be read in the v1.9 legacy format.
  const actorBuff=e.actors.templates.buffTemplate;
  const registry=e.game.settings.get(NS,"effectTemplateApprovals");
  const oldFingerprint=JSON.stringify({
    uuid:actorBuff.uuid,content:actorBuff.toObject()
  });
  await reload.game.settings.set(NS,"effectTemplateApprovals",
    {...registry,[actorBuff.uuid]:oldFingerprint});
  const legacy=await reload.api().effectGroups.applyGroup({
    actor:source,key:"legacy-actor-buff",templateUuid:actorBuff.uuid,
    targets:[ally1],timing:"startOfNextTurn"
  });
  assert.equal(legacy.applied,true);
  await reload.api().effectGroups.stopGroup({actor:source,key:"legacy-actor-buff"});
  await reload.wait();

  // A player may use approved pack models via the existing socket bridge.
  await reload.transition(4,1,"A","B");
  await reload.transition(5,0,"B","A");
  const player=makeHarness({storage:e.storage,documents:e.documents,
    users:e.users,actors:e.actors,combat:e.combat,scene:e.scene,
    socket:reload.socket,user:e.users[2]});
  await player.start();
  const submitted=await player.api().effectGroups.applyGroup({
    actor:source,key:"player-compendium",templateUuid:pack.uuid,
    targets:[ally1,ally2],timing:"endOfCurrentTurn"
  });
  assert.equal(submitted.submitted,true);
  await reload.wait();
  assert.equal(ally1.items.size,1);
  assert.equal(ally2.items.size,1);
  assert.equal(reload.api().effectGroups.listGroups().length,1);
  await reload.api().effectGroups.stopGroup({actor:source,key:"player-compendium"});
  await reload.wait();
  assert.equal(ally1.items.size,0);

  // Cloning failure must rollback already-created copies safely.
  ally2.failCreation=true;
  await assert.rejects(()=>reload.api().effectGroups.applyGroup({
    actor:source,key:"clone-failure",templateUuid:pack.uuid,
    targets:[ally1,ally2],timing:"endOfCurrentTurn"
  }),/Simulated target clone failure/);
  assert.equal(ally1.items.size,0);
  assert.equal(reload.api().effectGroups.listGroups().length,0);
  ally2.failCreation=false;

  // No world Item or other Actor's buff is a freely transferable template.
  const wrongOwner={
    id:"foreign",uuid:ally1.uuid+".Item.foreign",documentName:"Item",
    type:"buff",name:"Foreign Actor Buff",parent:ally1,
    toObject(){return {_id:this.id,name:this.name,type:this.type,system:{active:false},flags:{}};}
  };
  e.documents.set(wrongOwner.uuid,wrongOwner);
  await reload.api().effectGroups.approveTemplate(wrongOwner.uuid);
  await assert.rejects(()=>reload.api().effectGroups.applyGroup({
    actor:source,key:"foreign-actor",templateUuid:wrongOwner.uuid,
    targets:[ally2],timing:"endOfCurrentTurn"
  }),/doit appartenir/);

  const debugLogs=reload.log.map(x=>x[0]).filter(x=>typeof x==="string");
  assert.ok(debugLogs.some(x=>x.includes("Erreur de clonage")),
    "cloning errors must be logged");
  console.log("PASS v1.10: Compendium approval, copies, F5, turn expiry, extend, stop, hash, validation, player relay, rollback, legacy actor approvals");
}
testCompendium().catch(err=>{console.error(err);process.exitCode=1;});
