const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ns='pf1-automation-engine',hooks={init:[],ready:[],events:new Map()},store=new Map([['genericEnabled',true],['genericDebug',false]]);
const docs=new Map(),calls=[],gm={id:'gm',active:true,isGM:true};
const bard={documentName:'Actor',id:'bard',uuid:'Actor.bard',name:'Bard',testUserPermission:()=>true};
const janis={documentName:'Actor',id:'janis',uuid:'Actor.janis',name:'Janis',testUserPermission:()=>true};
const source={documentName:'Item',uuid:'Actor.bard.Item.fascination',name:'Fascination',actor:bard};
for(const x of [bard,janis,source])docs.set(x.uuid,x);
const ctx={console,Map,Set,Promise,Date,setTimeout,clearTimeout,
  foundry:{utils:{deepClone:v=>structuredClone(v),randomID:()=>String(calls.length+1)}},
  Hooks:{once:(name,fn)=>hooks[name].push(fn),on:(name,fn)=>hooks.events.set(name,fn),callAll:()=>{}},
  fromUuid:async id=>docs.get(id)??null,canvas:{scene:null},
  ChatMessage:{implementation:{create:async()=>{throw Error('Unexpected summary')}}},
  game:{user:gm,users:[gm],modules:new Map(),messages:new Map(),socket:{on:()=>{},emit:()=>{}},
    settings:{get:(_ns,k)=>store.get(k),set:async(_ns,k,v)=>store.set(k,v),
      register:(_ns,k,opts)=>{if(!store.has(k))store.set(k,opts.default)}}}};
ctx.game.users.get=id=>id==='gm'?gm:null;
ctx.game.modules.set(ns,{active:true,api:{
  saveContext:{fromMessage:m=>m.getFlag(ns,'saveContext')},
  saveOutcomes:{resolve:async e=>{calls.push(e);return {processed:true}}}}});
function message(id,total,sourceCard=false){
  const x={id,documentName:'ChatMessage',author:{id:'gm'},speaker:{actor:'janis'},
    rolls:[{total}],flags:{},
    getFlag(n,k){return this.flags?.[n]?.[k]},
    async setFlag(n,k,v){(this.flags[n]??={})[k]=v;return v}};
  if(sourceCard)x.flags[ns]={saveContext:{sourceActorUuid:bard.uuid,
    sourceItemUuid:source.uuid,sourceActionId:'a',saveType:'will',saveDC:16}};
  ctx.game.messages.set(id,x);return x;
}
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../scripts/save-overrides.js'),'utf8'),ctx);
for(const fn of hooks.init)fn();
vm.runInContext('soResolve=async d=>({normalTotal:d.normalTotal,effectiveTotal:d.normalTotal,changed:false,candidates:[],winner:null,saveType:d.saveType,sourceItemUuid:d.sourceItemUuid,targetActorUuid:d.targetActorUuid})',ctx);
const payload=id=>({actorUuid:janis.uuid,sourceItemUuid:source.uuid,sourceActionId:'a',
  sourceMessageId:'source-card',saveType:'will',messageId:id,saveDC:16});
(async()=>{
  message('source-card',0,true);
  message('failed',11);
  await ctx.soProcessRoll(payload('failed'),gm);
  assert.equal(calls.at(-1).effectiveTotal,11);
  assert.equal(calls.at(-1).saveDC,16);
  assert.equal(calls.at(-1).sourceMessageId,'source-card');
  assert.equal(calls.at(-1).saveMessageId,'failed');
  message('succeeded',19);
  await ctx.soProcessRoll(payload('succeeded'),gm);
  assert.equal(calls.at(-1).effectiveTotal,19);
  assert.equal(calls.length,2,'dispatch without override on success and failure');
  vm.runInContext('soResolve=async d=>({normalTotal:d.normalTotal,effectiveTotal:22,changed:true,candidates:[],winner:null,saveType:d.saveType,sourceItemUuid:d.sourceItemUuid,targetActorUuid:d.targetActorUuid})',ctx);
  message('countersong',8);
  await ctx.soProcessRoll(payload('countersong'),gm);
  assert.equal(calls.at(-1).normalTotal,8);
  assert.equal(calls.at(-1).effectiveTotal,22);
  message('manual',5);
  const count=calls.length;
  await ctx.soProcessRoll({...payload('manual'),sourceMessageId:null},gm);
  assert.equal(calls.length,count,'no dispatch for manual sheet saves');
  await ctx.soProcessRoll(payload('failed'),gm);
  assert.equal(calls.at(-1).saveMessageId,'failed','replay delegates idempotence to saveOutcomes');
  console.log('PASS native save outcomes: no-override failure/success, replaced total, sheet isolation, replay');
})().catch(err=>{console.error(err);process.exitCode=1});
