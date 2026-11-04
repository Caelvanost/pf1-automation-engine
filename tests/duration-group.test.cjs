'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const groupSource=fs.readFileSync(path.join(root,'scripts/effect-groups.js'),'utf8');
const durationSource=fs.readFileSync(path.join(root,'scripts/duration-manager.js'),'utf8');
const NS='pf1-automation-engine';
let uid=0;
function makeWorld(){
  const docs=new Map(), storage=new Map(), users=[
    {id:'a',active:true,isGM:true},{id:'p',active:true,isGM:false}];
  users.get=id=>users.find(u=>u.id===id);
  const actors=[];
  for(const [id,name] of [['caster','Barde'],['ally1','Allié 1'],['ally2','Allié 2']]) {
    const actor={uuid:`Actor.${id}`,id,name,documentName:'Actor',isOwner:true,items:new Map(),effects:new Map(),
      testUserPermission(user){return user.isGM || (id==='caster' && user.id==='p');},
      async createEmbeddedDocuments(type,objects){
        const created=[];
        for(const data of objects){
          const copy={id:`c${++uid}`,documentName:type,type:data.type,name:data.name,actor,parent:actor,
            system:structuredClone(data.system??{}),flags:structuredClone(data.flags??{}),disabled:data.disabled??false,
            toObject(){return {name:this.name,type:this.type,system:structuredClone(this.system),flags:structuredClone(this.flags)};},
            getFlag(ns,key){return this.flags[ns]?.[key];},
            async setActive(v){this.system.active=v;this.activations.push(v);},activations:[],
            async update(changes){if('system.active'in changes)this.system.active=changes['system.active'];if('disabled'in changes)this.disabled=changes.disabled;},
            async delete(){this.deleted=true;(type==='Item'?actor.items:actor.effects).delete(this.id);docs.delete(this.uuid);}
          };
          copy.uuid=`${actor.uuid}.${type}.${copy.id}`;
          (type==='Item'?actor.items:actor.effects).set(copy.id,copy);docs.set(copy.uuid,copy);created.push(copy);
        }
        return created;
      }
    };
    docs.set(actor.uuid,actor);actors.push(actor);
  }
  const caster=actors[0];
  const template={id:'inspire',name:'Inspire Courage',documentName:'Item',type:'buff',parent:caster,
    uuid:`${caster.uuid}.Item.inspire`,system:{active:false},flags:{},
    toObject(){return {_id:this.id,name:this.name,type:this.type,system:structuredClone(this.system),flags:{}};}};
  caster.items.set(template.id,template);docs.set(template.uuid,template);
  const compendiumTemplate={
    id:"compendium-inspire",name:"Inspire Courage (Pack)",
    documentName:"Item",type:"buff",parent:null,
    pack:"pf1ae-test.buff-templates",
    uuid:"Compendium.pf1ae-test.buff-templates.Item.InspireABC",
    system:{active:false,description:{value:"An approved shared buff."}},flags:{},
    toObject(){return {_id:this.id,name:this.name,type:this.type,
      system:structuredClone(this.system),flags:structuredClone(this.flags)};}
  };
  docs.set(compendiumTemplate.uuid,compendiumTemplate);
  const scene={id:'S',tokens:actors.map(a=>({actor:a,disposition:1}))};
  return {docs,storage,users,actors,caster,template,compendiumTemplate,scene,
    clock:{worldTime:1000},socket:new Map()};
}
function createClient(world,user){
  const module={active:true,api:{generic:{cancelTimer:async()=>{}}}};
  const game={modules:new Map([[NS,module]]),user,users:world.users,combat:null,combats:new Map(),scenes:{active:world.scene},time:world.clock,
    settings:{
      register(ns,key,o){const id=`${ns}.${key}`;if(!world.storage.has(id))world.storage.set(id,structuredClone(o.default));},
      get(ns,key){if(key==='genericEnabled')return true;return world.storage.get(`${ns}.${key}`);},
      async set(ns,key,val){world.storage.set(`${ns}.${key}`,structuredClone(val));return val;}
    },
    socket:{on(topic,fn){world.socket.set(topic,[...(world.socket.get(topic)??[]),fn]);},emit(topic,data){for(const fn of world.socket.get(topic)??[])fn(data);}}
  };
  const handlers=new Map();
  const Hooks={on(name,fn){handlers.set(name,[...(handlers.get(name)??[]),fn]);},once(name,fn){this.on(name,fn);},async fire(name,...args){for(const fn of handlers.get(name)??[])await fn(...args);}};
  const ctx={game,Hooks,fromUuid:async uuid=>world.docs.get(uuid)??null,canvas:{scene:world.scene},foundry:{utils:{
    deepClone:structuredClone,randomID:()=>`g${++uid}`}},console};
  vm.runInNewContext(groupSource,ctx,{filename:'effect-groups.js'});
  vm.runInNewContext(durationSource,ctx,{filename:'duration-manager.js'});
  async function flush(){for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));}
  async function start(){await Hooks.fire('init');await Hooks.fire('ready');await flush();}
  async function tick(dt){world.clock.worldTime+=dt;await Hooks.fire('updateWorldTime',world.clock.worldTime,dt);await flush();}
  return {game,start,tick,flush,api:()=>module.api};
}
async function test(){
  const world=makeWorld();const gm=createClient(world,world.users[0]);await gm.start();
  await gm.api().effectGroups.approveTemplate(world.template.uuid);
  await gm.api().effectGroups.approveTemplate(world.compendiumTemplate.uuid);
  const group=await gm.api().effectGroups.applyGroup({actor:world.caster,key:'inspire',
    templateUuid:world.compendiumTemplate.uuid,targets:world.actors.slice(1),
    duration:{value:2,unit:'rounds'}});
  assert.equal(group.applied,true);assert.equal(group.targetCount,2);
  assert.equal(gm.api().duration.listTimers()[0].remainingSeconds,12);
  const copies=world.actors.slice(1).map(a=>[...a.items.values()][0]);
  assert.deepEqual(copies.map(c=>c.system.active),[true,true]);
  assert.equal(world.compendiumTemplate.system.active,false,
    'source pack buff remains inactive through timed effect application');
  assert.ok(copies.every(c=>c.parent?.documentName==='Actor'),
    'pack buffs are created as embedded PF1 Item copies');
  await gm.tick(6);
  assert.equal(world.actors[1].items.size,1);
  const ext=await gm.api().effectGroups.extendGroup({actor:world.caster,key:'inspire',rounds:1});
  assert.equal(ext.extended,true);
  assert.equal(gm.api().duration.listTimers()[0].remainingSeconds,12);
  assert.deepEqual(copies.map(c=>c.activations),[[true],[true]],'extension must not toggle buffs');

  // F5 disconnects the old browser: its socket listener must be removed.
  // Otherwise this harness would simulate two concurrent sessions with the
  // SAME elected GM user id, which Foundry does not retain across an F5.
  world.socket.clear();
  const reload=createClient(world,world.users[0]);await reload.start();
  assert.equal(reload.api().effectGroups.listGroups().length,1);
  await reload.tick(11);assert.deepEqual(copies.map(c=>c.deleted),[undefined,undefined]);
  await reload.tick(1);
  assert.deepEqual(copies.map(c=>c.deleted),[true,true]);
  assert.deepEqual(copies.map(c=>c.activations),[[true,false],[true,false]]);
  assert.equal(reload.api().effectGroups.listGroups().length,0);
  assert.equal(reload.api().duration.listTimers().length,0);

  // Player request uses the existing GM validation + socket gate.
  const player=createClient(world,world.users[1]);await player.start();
  const submitted=await player.api().effectGroups.applyGroup({actor:world.caster,key:'by-player',
    templateUuid:world.compendiumTemplate.uuid,targets:[world.actors[1]],
    duration:{value:1,unit:'minutes'}});
  assert.equal(submitted.submitted,true);
  await reload.flush();
  assert.equal(world.actors[1].items.size,1);
  const extended=await player.api().effectGroups.extendGroup({actor:world.caster,key:'by-player',rounds:1});
  assert.equal(extended.submitted,true);
  await reload.flush();
  assert.equal(reload.api().duration.listTimers()[0].remainingSeconds,66);
  await reload.tick(66);
  assert.equal(world.actors[1].items.size,0);
  assert.equal(reload.api().effectGroups.listGroups().length,0);
  console.log('PF1 Automation Engine v1.8.0: duration group tests OK');
}
test().catch(e=>{console.error(e);process.exitCode=1;});
