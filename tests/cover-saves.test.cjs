'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const coverSource=fs.readFileSync(path.resolve(__dirname,'../scripts/cover-detection.js'),'utf8');
const source=fs.readFileSync(path.resolve(__dirname,'../scripts/cover-saves.js'),'utf8');
const init=[],ready=[],hooks=new Map();
const register=(name,fn)=>{const list=hooks.get(name)??[];list.push(fn);hooks.set(name,list)};
const gm={id:'gm',isGM:true},owner={id:'player',isGM:false};
const actor={uuid:'Actor.target',documentName:'Actor',
 testUserPermission(u,level){return u===owner&&level==='OWNER'}};
const message={documentName:'ChatMessage',id:'message-id',flags:{},setFlag:async function(_ns,key,v){
 this.flags[key]=structuredClone(v);return v;
},getFlag(_ns,key){return this.flags[key]}};
const messages=new Map([[message.id,message]]);
const setting=new Map([['genericEnabled',true],['genericDebug',false]]);
const mod={active:true,api:{saveContext:{
 fromMessage:()=>({saveType:'ref',sourceMessageId:message.id}),
 _fromNativeSaveOptions:(a,id,options)=>id==='ref'&&options.reference==='ChatMessage.'+message.id?
  {saveType:'ref',sourceMessageId:message.id}:null
}}};
const game={user:gm,i18n:{lang:'fr'},messages,
 modules:new Map([['pf1-automation-engine',mod]]),
 settings:{get(_ns,key){return setting.get(key)}}};
const ctx={console,game,foundry:{utils:{deepClone:structuredClone}},
 Hooks:{once(name,fn){(name==='init'?init:ready).push(fn)},on:register},
 Object,Math,Number,Set,Map,WeakSet};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(coverSource,ctx,{filename:'cover-detection.js'});
vm.runInContext(source,ctx,{filename:'cover-saves.js'});
for(const fn of init)fn();
for(const fn of ready)fn();
const api=mod.api.coverSaves;
const pre=hooks.get('pf1PreActorRollSave')?.[0];
assert.equal(typeof pre,'function');
const roll=(bonus='')=>({reference:'ChatMessage.'+message.id,bonus});
(async()=>{
 for(const [type,bonus] of [['partial',1],['normal',2],['soft',0],['improved',4]]){
  await api.setManual({message,defenderActor:actor,
   selection:{type,reflexProtected:true,spreadBypasses:false}});
  const options=roll('6[Native save bonus]');
  pre(actor,options,'ref');
  if(bonus>0){
   assert.equal(options.bonus.includes(bonus+'[Abri]'),true,
    'add the exactly calculated PF1 cover bonus natively');
   assert.equal(options.bonus.includes('6[Native save bonus]'),true);
  }else assert.equal(options.bonus,'6[Native save bonus]');
  pre(actor,options,'ref');
  assert.equal((String(options.bonus).match(/\[Abri\]/g)??[]).length,bonus>0?1:0,
   'native roll options not double charged');
 }
 await api.setManual({message,defenderActor:actor,
  selection:{type:'improved',reflexProtected:true,spreadBypasses:true}});
 let options=roll('6[Native save bonus]');
 pre(actor,options,'ref');
 assert.equal(options.bonus,'6[Native save bonus]','spread bypasses cover');
 await api.setManual({message,defenderActor:actor,
  selection:{type:'normal',reflexProtected:true,spreadBypasses:false}});
 options=roll('2[Cover]');
 pre(actor,options,'ref');
 assert.equal(options.bonus,'2[Cover]','native cover is authoritative, no duplicate');
 options=roll('3[Other]');
 pre(actor,options,'fort');
 assert.equal(options.bonus,'3[Other]','no Fortitude bonus from cover');
 options={bonus:'3[Other]'};
 pre(actor,options,'ref');
 assert.equal(options.bonus,'3[Other]','unsourced roll remains untouched');
 game.user={id:'stranger',isGM:false};
 await assert.rejects(()=>api.setManual({message,defenderActor:actor,
  selection:{type:'partial',reflexProtected:true,spreadBypasses:false}}),
  /owner or GM/);
 game.user=owner;
 await api.setManual({message,defenderActor:actor,
  selection:{type:'partial',reflexProtected:true,spreadBypasses:false}});
 assert.equal(message.flags.coverReflexSelections[actor.uuid].type,'partial');
 game.user=gm;
 setting.set('genericEnabled',false);
 options=roll();
 pre(actor,options,'ref');
 assert.equal(options.bonus,'','disabled service does not touch native roll');
 console.log('PASS cover-saves: PF1 native pre-save, manual cover, spread, no duplicate, permissions, fail closed');
})().catch(error=>{console.error(error);process.exitCode=1});
