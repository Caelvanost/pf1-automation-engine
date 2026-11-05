'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const moduleSource=fs.readFileSync(path.join(__dirname,'..','scripts','effect-groups.js'),'utf8');
const NS='pf1-automation-engine',ledger=new Map(),documents=new Map(),listeners=[];
const users=[{id:'gm',name:'GM',isGM:true,active:true},{id:'p1',name:'Bard player',isGM:false,active:true},{id:'p2',name:'Another player',isGM:false,active:true}];
users.get=id=>users.find(u=>u.id===id);
let count=0;
function actor(name,owner){
 const a={documentName:'Actor',uuid:'Actor.'+name,id:name,name,isOwner:owner==='p1',
 items:new Map(),effects:new Map(),
 testUserPermission:(user,level)=>level==='OWNER'&&(user.isGM||user.id===owner),
 async createEmbeddedDocuments(type,data){
  return data.map(x=>{
   const id='effect-'+(++count),target=this;
   const copy={id,documentName:type,uuid:target.uuid+'.'+type+'.'+id,
    flags:x.flags,system:{...x.system,active:false},
    getFlag:(ns,k)=>copy.flags?.[ns]?.[k],
    async setActive(v){this.system.active=v;},
    async delete(){(type==='Item'?target.items:target.effects).delete(id);}};
   (type==='Item'?target.items:target.effects).set(id,copy);
   return copy;
  });
 }};
 documents.set(a.uuid,a);return a;
}
const bard=actor('bard','p1'),gmAlly=actor('gmAlly','gm'),playerAlly=actor('playerAlly','p2'),notOwned=actor('notOwned','p2');
function buff(source,name,scripted=false){
 const data={name,type:'buff',system:{scriptCalls:scripted?[{id:'bad',script:'x'}]:[]},flags:{}};
 const item={documentName:'Item',type:'buff',uuid:source.uuid+'.Item.'+name,
 parent:source,actor:source,name,toObject:()=>structuredClone(data)};
 documents.set(item.uuid,item);return item;
}
const safe=buff(bard,'safe'),unsafe=buff(bard,'unsafe',true),foreign=buff(notOwned,'foreign');
function client(user){
 const hooks={};
 const api={duration:{schedule:async()=>{},cancelTimer:async()=>{},extendTimer:async()=>({remainingSeconds:60})},
 generic:{scheduleTurn:async()=>{},cancelTimer:async()=>{},extendTimer:async()=>({targetRound:2})}};
 const mod={active:true,api};
 const game={user,users,combat:null,combats:new Map(),scenes:{active:null},modules:new Map([[NS,mod]]),
 settings:{
  register(_ns,key,cfg){if(!ledger.has(key))ledger.set(key,structuredClone(cfg.default));},
  get(_ns,key){return key==='genericEnabled'?true:key==='genericDebug'?false:ledger.get(key);},
  async set(_ns,key,value){ledger.set(key,structuredClone(value));}
 },
 socket:{
  on(topic,callback){listeners.push({topic,callback});},
  emit(topic,data){for(const l of listeners)if(l.topic===topic)void l.callback(data);}
 }};
 const context={game,canvas:{scene:null},Date,Map,Set,Promise,setTimeout,clearTimeout,
 Hooks:{once:(name,fn)=>{(hooks[name]??=[]).push(fn);},on:()=>{}},
 foundry:{utils:{deepClone:structuredClone,randomID:()=>String(++count)}},
 fromUuid:async uuid=>documents.get(uuid),console};
 vm.createContext(context);
 vm.runInContext(moduleSource,context,{filename:'effect-groups.js'});
 return {mod,async start(){for(const name of ['init','ready'])for(const f of hooks[name]??[])await f();}};
}
(async()=>{
 const gm=client(users[0]),player=client(users[1]);await gm.start();await player.start();
 const e=player.mod.api.effectGroups;
 assert.equal(await e.approveTemplate(safe.uuid),safe.uuid);
 const args={actor:bard,key:'inspire',templateUuid:safe.uuid,targets:[gmAlly,playerAlly],duration:{value:1,unit:'minutes'}};
 const first=await e.applyGroup(args);
 assert.equal(first.applied,true);
 assert.equal(first.targetCount,2);
 assert.equal(gmAlly.items.size,1);
 assert.equal(playerAlly.items.size,1);
 assert.equal((await e.applyGroup(args)).groupId,first.groupId,'double click must not duplicate group');
 assert.equal(gmAlly.items.size,1);
 assert.equal((await e.extendGroup({actor:bard,key:'inspire',rounds:1})).extended,true);
 assert.equal((await e.stopGroup({actor:bard,key:'inspire'})).stopped,1);
 assert.equal(gmAlly.items.size,0);
 assert.equal(playerAlly.items.size,0);
 await assert.rejects(e.approveTemplate(unsafe.uuid),/executable/i);
 await assert.rejects(e.applyGroup({...args,templateUuid:unsafe.uuid}),/executable/i);
 await assert.rejects(async()=>e.applyGroup({...args,actor:notOwned,templateUuid:foreign.uuid}),/contrôlez|OWNER/i);
 await assert.rejects(async()=>e.stopGroup({actor:notOwned,key:'inspire'}),/contrôlez|OWNER/i);
 const compendium={documentName:'Item',type:'buff',name:'Inspire Courage',
 uuid:'Compendium.pf1.buffs.Item.example',toObject:()=>({name:'Inspire Courage',type:'buff',system:{scriptCalls:[]},flags:{}})};
 documents.set(compendium.uuid,compendium);
 assert.equal(await e.approveTemplate(compendium.uuid),compendium.uuid,'compendium preflight');
 assert.equal((await e.applyGroup({...args,key:'compendium',templateUuid:compendium.uuid})).applied,true);
 await e.stopGroup({actor:bard,key:'compendium'});
 console.log('PASS: silent GM authority, non-owned targets, acknowledgements, source OWNER, compendium, de-duplication, expiry and no interactive dialog');
})().catch(error=>{console.error(error);process.exitCode=1});
