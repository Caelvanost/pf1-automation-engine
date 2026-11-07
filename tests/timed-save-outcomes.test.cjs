'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),ns='pf1-automation-engine';
const calls={init:[],ready:[]},store=new Map([['genericEnabled',true],['genericDebug',false]]),docs=new Map(),messages=new Map();
let seq=0;const gm={id:'gm',isGM:true,active:true};
const ctx={console,Map,Set,Date,Promise,setTimeout,clearTimeout,
 foundry:{utils:{deepClone:structuredClone,randomID:()=>String(++seq)}},
 Hooks:{once:(k,f)=>calls[k].push(f),on:()=>{}},fromUuid:async id=>docs.get(id)??null,
 game:{user:gm,users:[gm],messages,settings:{
  get:(_,k)=>store.get(k),set:async(_,k,v)=>(store.set(k,v),v),
  register:(_,k,v)=>{if(!store.has(k))store.set(k,v.default)}
 },modules:new Map(),socket:{on:()=>{},emit:()=>{}},combat:null},
 pf1:{registry:{conditions:new Map([['stunned',{}],['fascinated',{}],['shaken',{}]])}}};
ctx.game.users.get=id=>id==='gm'?gm:null;ctx.game.modules.set(ns,{active:true,api:{}});
vm.createContext(ctx);
for(const p of ['effect-groups.js','save-outcomes.js'])
 vm.runInContext(fs.readFileSync(path.join(root,'scripts',p),'utf8'),ctx,{filename:p});
for(const f of calls.init)f();for(const f of calls.ready)f();
const api=ctx.game.modules.get(ns).api,combatTimers=[],worldTimers=[];
api.generic={scheduleTurn:async data=>(combatTimers.push(data),data.id),cancelTimer:async()=>{}};
api.duration={schedule:async data=>(worldTimers.push(data),data.id),cancelTimer:async()=>{}};
function actor(id,name){
 const a={documentName:'Actor',uuid:'Actor.'+id,id,name,isOwner:true,
  effects:new Map(),items:new Map(),immunities:new Set(),
  testUserPermission:()=>true,getConditionImmunities(){return this.immunities},
  async createEmbeddedDocuments(_type,arr){return arr.map(data=>{
   const e={documentName:'ActiveEffect',id:'effect'+(++seq),uuid:'',parent:a,flags:data.flags,
    statuses:new Set(data.statuses),name:data.name,img:data.img,
    getFlag(ns,key){return this.flags?.[ns]?.[key]},
    async delete(){a.effects.delete(this.id);docs.delete(this.uuid)}};
   e.uuid=a.uuid+'.ActiveEffect.'+e.id;a.effects.set(e.id,e);docs.set(e.uuid,e);return e;
  })}};docs.set(a.uuid,a);return a;
}
const monk=actor('monk','Moine'),harpy=actor('harpy','Harpy');
const action={id:'save-action'},use={id:'use-action'};
const item={documentName:'Item',uuid:monk.uuid+'.Item.stun',actor:monk,
 actions:new Map([[use.id,use],[action.id,action]]),img:'stun.webp'};docs.set(item.uuid,item);
function card(id){
 const m={id,flags:{[ns]:{saveContext:{sourceItemUuid:item.uuid,sourceActionId:action.id,saveDC:16}}},
 getFlag(ns,k){return this.flags?.[ns]?.[k]},async setFlag(ns,k,v){(this.flags[ns]??={})[k]=v}};
 messages.set(id,m);return m;
}
api.saveContext={fromMessage:card=>card.getFlag(ns,'saveContext')};
function evt(id,total,target=harpy){
 messages.set(id,{id,flags:{},getFlag(ns,k){return this.flags[ns]?.[k]},
 async setFlag(ns,k,v){(this.flags[ns]??={})[k]=v}});
 return {saveMessageId:id,sourceMessageId:'card',sourceItemUuid:item.uuid,
 sourceActionId:action.id,targetActorUuid:target.uuid,normalTotal:total,effectiveTotal:total,saveDC:16};
}
const rule={actor:monk,key:'stunning-fist',groupKey:'stunning-fist',sourceItemUuid:item.uuid,
 sourceActionId:action.id,targets:[harpy.uuid],
 onFailure:{type:'linkedBuff',name:'Étourdi — Moine',img:'stun.webp',
 statusId:'stunned',duration:{rounds:1,expire:'sourceTurnStart'}}};
(async()=>{
 card('card');ctx.game.combat={id:'combat',started:true,combatants:[{id:'source',actor:monk}],round:1,turn:0};
 assert.equal((await api.saveOutcomes.register(rule)).registered,true);
 assert.equal((await api.saveOutcomes.resolve(evt('fail',11))).success,false);
 assert.equal(harpy.effects.size,1);
 assert.equal([...harpy.effects.values()][0].statuses.has('stunned'),true);
 assert.equal(combatTimers[0].combatantId,'source');assert.equal(combatTimers[0].timing,'turnStart');
 assert.equal(combatTimers[0].occurrences,1);
 assert.equal(api.saveOutcomes.list().length,0,'Timed rule consumed after the save');
 await api.saveOutcomes.resolve(evt('fail',11));
 assert.equal(harpy.effects.size,1,'Duplicate save is idempotent');
 await api.saveOutcomes.register(rule);await api.saveOutcomes.resolve(evt('success',20));
 assert.equal(harpy.effects.size,1,'Success applies no new effect');
 assert.equal(api.saveOutcomes.list().length,0);
 harpy.immunities.add('stunned');
 await api.saveOutcomes.register(rule);await api.saveOutcomes.resolve(evt('immune',8));
 assert.equal(harpy.effects.size,1,'Immune target receives no condition');
 assert.equal(api.saveOutcomes.list().length,0,'Immune save consumes one-shot rule');
 assert.equal(messages.get('immune').getFlag(ns,'saveOutcomes')[monk.uuid+':stunning-fist'].rejected,true);
 harpy.immunities.clear();ctx.game.combat=null;
 await api.saveOutcomes.register(rule);await api.saveOutcomes.resolve(evt('outside',8));
 assert.equal(worldTimers.length,1);assert.equal(worldTimers[0].duration.value,6);
 assert.equal(harpy.effects.size,2);
 await assert.rejects(api.saveOutcomes.register({...rule,
 onFailure:{...rule.onFailure,statusId:'not-a-condition'}}),/Not an official PF1 condition/);
 console.log('PASS timed stunned: native status, source-turn expiry, immunity, replay, success, outside combat');
})().catch(e=>{console.error(e);process.exitCode=1});
