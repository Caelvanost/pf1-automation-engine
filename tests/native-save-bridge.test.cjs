'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const hooks=new Map(),store=new Map([['genericEnabled',true],['genericDebug',false]]);
const documents=new Map(),messages=new Map(),events=[];
const gm={id:'gm',isGM:true,active:true};
const target={id:'target',uuid:'Actor.target',documentName:'Actor',name:'Target'};
const item={uuid:'Actor.bard.Item.fascinate',documentName:'Item'};
documents.set(target.uuid,target);documents.set(item.uuid,item);
const sourceContext={sourceActorUuid:'Actor.bard',sourceItemUuid:item.uuid,
  sourceActionId:'action1',saveType:'will',saveDC:16};
const makeMessage=(id,total,saveType='will')=>{
  const m={id,documentName:'ChatMessage',author:{id:'gm'},
    speaker:{actor:target.id},rolls:[{total}],system:{subject:{save:saveType}},flags:{},
    getFlag(ns,key){return this.flags[ns]?.[key]},
    async setFlag(ns,key,val){(this.flags[ns]??={})[key]=val}};
  messages.set(id,m);return m;
};
const card=makeMessage('card',0);card.flags['pf1-automation-engine']={saveContext:sourceContext};
const game={user:gm,users:[gm],messages,modules:new Map(),socket:{on:()=>{},emit:()=>{}},
  settings:{get:(ns,key)=>store.get(key),
    set:async(ns,key,val)=>store.set(key,val),
    register:(ns,key,options)=>{if(!store.has(key))store.set(key,options.default)}}};
game.users.get=id=>id===gm.id?gm:null;
game.modules.set('pf1-automation-engine',{active:true,api:{
  saveContext:{
    _fromNativeSaveOptions:(actor,type,options)=>options.reference==='ChatMessage.card'
      ?{...sourceContext,sourceMessageId:'card'}:null,
    fromMessage:m=>m.getFlag('pf1-automation-engine','saveContext')
  },saveOutcomes:{resolve:async event=>{events.push(event);return {processed:true}}}
}});
const ctx={console,Map,Set,Promise,Date,setTimeout,clearTimeout,
  game,fromUuid:async uuid=>documents.get(uuid),canvas:{scene:null},
  foundry:{utils:{deepClone:v=>structuredClone(v),randomID:()=>String(Math.random())}},
  Hooks:{once:(name,fn)=>hooks.set(name,[...(hooks.get(name)??[]),fn]),
    on:(name,fn)=>hooks.set(name,[...(hooks.get(name)??[]),fn]),callAll:()=>{}},
  ChatMessage:{implementation:{create:async()=>{throw Error('Unexpected save override summary')}}}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../scripts/save-overrides.js'),'utf8'),ctx);
for(const f of hooks.get('init')??[])f();
vm.runInContext('soResolve=async d=>({normalTotal:d.normalTotal,effectiveTotal:d.normalTotal,changed:false,candidates:[],winner:null,saveType:d.saveType,sourceItemUuid:d.sourceItemUuid,targetActorUuid:d.targetActorUuid})',ctx);
async function fire(name,...args){for(const f of hooks.get(name)??[])await f(...args)}
async function wait(ms=230){await new Promise(resolve=>setTimeout(resolve,ms))}
(async()=>{
  const opts={reference:'ChatMessage.card'};
  await fire('pf1PreActorRollSave',target,opts,'will');
  const failed=makeMessage('failed',11);
  await fire('createChatMessage',failed,{},gm.id);
  await fire('pf1ActorRollSave',target,{total:11},'will');
  await wait();
  assert.equal(events.length,1);
  assert.equal(events[0].normalTotal,11);
  assert.equal(events[0].effectiveTotal,11);
  assert.equal(events[0].saveMessageId,'failed');
  assert.equal(events[0].sourceActionId,'action1');
  await fire('pf1PreActorRollSave',target,opts,'will');
  await fire('pf1ActorRollSave',target,{total:19},'will');
  await fire('createChatMessage',makeMessage('success',19),{},gm.id);
  await wait();
  assert.equal(events.length,2);
  assert.equal(events[1].normalTotal,19);
  await fire('pf1PreActorRollSave',target,opts,'will');
  await fire('createChatMessage',makeMessage('unrelated',8,'fort'),{},gm.id);
  await fire('pf1ActorRollSave',target,{total:8},'will');
  await wait(1650);
  assert.equal(events.length,2,'unrelated save may not inherit source card');
  console.log('PASS SaveBridge: pending PF1 save correlation, delayed message, no override, unrelated isolation');
})().catch(error=>{console.error(error);process.exitCode=1});
