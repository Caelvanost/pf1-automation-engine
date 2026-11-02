const vm=require('node:vm');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const root=require('node:path').join(__dirname,'../scripts');
const callbacks=new Map();const onceCallbacks=new Map();
const Hooks={on(name,cb){(callbacks.get(name)||callbacks.set(name,[]).get(name)).push(cb);},once(name,cb){(onceCallbacks.get(name)||onceCallbacks.set(name,[]).get(name)).push(cb);}};
const emitted=async(name,...args)=>{for(const cb of [...(onceCallbacks.get(name)??[]),...(callbacks.get(name)??[])]) await cb(...args);onceCallbacks.delete(name)};
const saved=new Map();const modules=new Map([['pf1-combat-automation',{id:'pf1-combat-automation',api:{}}]]);
let calls=0;
const actor={uuid:'Actor.A',documentName:'Actor',items:[],getActiveTokens:()=>[],testUserPermission:()=>true};
const source={uuid:'Actor.A.Item.S',documentName:'Item',name:'passif',actor,system:{scriptCalls:[{_id:'CALL',name:'Synchroniser',category:'use',value:'return 1;'}],actions:[]},getFlag(ns,k){return this.flags?.[ns]?.[k]},flags:{}};
const target={uuid:'Actor.A.Item.T',documentName:'Item',name:'res',actor,system:{uses:{value:1}},getFlag(){return null}};
source.scriptCalls={contents:[{id:'CALL',name:'Synchroniser',category:'use',execute:async()=>{calls++}}]};
actor.items=[source,target];
const docs=new Map([[source.uuid,source],[target.uuid,target],[actor.uuid,actor]]);
const users=[{id:'GM1',active:true,isGM:true}];
const game={users, user:users[0],modules,settings:{register(ns,key,def){saved.set(`${ns}.${key}`,{value:structuredClone(def.default),def})},get(ns,key){return saved.get(`${ns}.${key}`)?.value},async set(ns,key,value){const v=saved.get(`${ns}.${key}`);assert(v);v.value=structuredClone(value);v.def.onChange?.(value);}},items:[],actors:[actor],scenes:[],combats:{get:()=>null}};
const sandbox={Hooks,game,foundry:{utils:{deepClone:structuredClone,randomID:()=>String(Math.random())}},console,fromUuid:async u=>docs.get(u),ChatMessage:{},ui:{notifications:{}},canvas:{},setTimeout};
for(const file of ['auto-discovery.js','generic-automation.js']){
 const ctx=vm.createContext(sandbox);
 new vm.Script(`(function(){${fs.readFileSync(root+'/'+file,'utf8')}\n})();`,{filename:file}).runInContext(ctx);
}
(async()=>{
 await emitted('init');
 source.flags['pf1-combat-automation']={automations:[
  {id:'watch',on:'updateItem',scriptCategory:'use',scriptId:'Synchroniser',filter:{itemUuid:target.uuid,properties:['system.uses.value']}},
  {id:'startup',on:'ready',scriptCategory:'use',scriptId:'Synchroniser'}
 ]};
 await emitted('ready');
 assert.equal(calls,0,'Unapproved declarations must not execute');
 const api=game.modules.get('pf1-combat-automation').api;
 assert.equal(await api.discovery.approveItem(source.uuid),2);
 await emitted('updateItem',target,{system:{uses:{value:2}}},{});
 await new Promise(r=>setTimeout(r,10));
 assert.equal(calls,1,'approved updateItem fires once');
 await emitted('updateItem',target,{system:{uses:{max:3}}},{});
 await new Promise(r=>setTimeout(r,10));
 assert.equal(calls,1,'other property should not trigger');
 source.system.scriptCalls[0].value='return 2;';
 await emitted('updateItem',target,{system:{uses:{value:3}}},{});
 await new Promise(r=>setTimeout(r,10));
 assert.equal(calls,1,'script changed invalidates approval');
 await api.discovery.approveItem(source.uuid);
 await emitted('updateItem',target,{system:{uses:{value:4}}},{});
 await new Promise(r=>setTimeout(r,10));
 assert.equal(calls,2,'new approved snapshot triggers');
 console.log('PASS: no unapproved execution; approved updateItem once; filter; invalidated script requires reapproval');
})().catch(e=>{console.error(e);process.exit(1)});
