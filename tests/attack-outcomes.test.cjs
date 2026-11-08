'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'../scripts/attack-outcomes.js');
const calls={init:[],ready:[],events:new Map()},store=new Map([['genericEnabled',true],['genericDebug',true]]);
const docs=new Map(),messages=new Map();const gm={id:'gm',isGM:true,active:true};const player={id:'player',isGM:false,active:true};
const actors={},api={},events=[],log=[];let seq=0;
const game={user:gm,users:[gm,player],messages,modules:new Map([['pf1-automation-engine',{active:true,api}]]),settings:{
 get:(_,key)=>store.get(key),set:async(_,key,value)=>(store.set(key,structuredClone(value)),value),
 register:(_,key,opt)=>{if(!store.has(key))store.set(key,opt.default)}},socket:{on(){},emit(){}}};
game.users.get=id=>game.users.find(x=>x.id===id);
const Hooks={once:(name,fn)=>calls[name].push(fn),on:(name,fn)=>{
 calls.events.set(name,[...(calls.events.get(name)??[]),fn]);return seq++}};
const ctx={game,Hooks,Map,Set,Promise,Date,Number,clearTimeout,setTimeout,console:{
 log:(...x)=>log.push(x),debug:(...x)=>log.push(x),warn:(...x)=>log.push(x),error:(...x)=>log.push(x)},
 foundry:{utils:{deepClone:structuredClone,randomID:()=>String(++seq)}},
 fromUuid:async id=>docs.get(id)??null,
 ChatMessage:{getSpeakerActor:sp=>docs.get(sp.actorUuid)??null},
 CONFIG:{Actor:{documentClass:null}}};
function actor(id){const a={uuid:'Actor.'+id,name:id,documentName:'Actor',isOwner:true,
  system:{attributes:{hp:{value:20,temp:0,nonlethal:0}}},
  testUserPermission:(u,role)=>u===player||u===gm,
  async applyDamage(value,options={}){if(value>0)this.system.attributes.hp.value-=value;return this;}};
 docs.set(a.uuid,a);return a;}
const monk=actor('Monk'),target=actor('Harpy');
// PF1 11.11 exposes a NON-CONFIGURABLE accessor. The setter must never run.
function ActorPF(){}
let nativeApplyDamage=async function(value,options={}){
 for(const hook of calls.events.get('pf1ApplyDamage')??[])hook(this,options);
 if(value>0)this.system.attributes.hp.value-=value;
 return this;
};
Object.defineProperty(ActorPF.prototype,'applyDamage',{
 configurable:false,enumerable:false,
 get(){return nativeApplyDamage},
 set(){throw Error('Must not invoke ActorPF.applyDamage setter')}
});
Object.setPrototypeOf(target,ActorPF.prototype);delete target.applyDamage;
ctx.CONFIG.Actor.documentClass=ActorPF;
const ApplyDamage={_onApply:async function(){
 const options={};
 for(const hook of calls.events.get('pf1ApplyDamageTargetOptions')??[])
   hook(this,{actor:this.actor},options);
 return this.actor.applyDamage(this.value,options);
}};
ctx.pf1={applications:{ApplyDamage}};
const attackAction={id:'attack-0'},saveAction={id:'save'};
const attack={documentName:'Item',id:'unarmed',uuid:monk.uuid+'.Item.unarmed',name:'Unarmed strike',actor:monk,actions:new Map([[attackAction.id,attackAction]])};
let fired=0,saved=0;const stun={documentName:'Item',id:'stun',uuid:monk.uuid+'.Item.stun',actor:monk,
 actions:new Map([[saveAction.id,saveAction]]),use:async ({actionId,cost,chatMessage})=>{assert.equal(actionId,'save');assert.equal(cost,0);assert.equal(chatMessage,true);fired++;return true}};
docs.set(attack.uuid,attack);docs.set(stun.uuid,stun);
const card={id:'attack-card',documentName:'ChatMessage',speaker:{actorUuid:monk.uuid},itemSource:attack,actionSource:attackAction,
 testUserPermission:()=>true};messages.set(card.id,card);
api.saveOutcomes={register:async x=>{saved++;assert.equal(x.sourceActionId,'save');return {registered:true}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
(async()=>{
 for(const cb of calls.init)cb();for(const cb of calls.ready)cb();
 const req={actor:monk,key:'stunning-fist',groupKey:'stunning-fist',sourceItemUuid:attack.uuid,
 sourceActionId:attackAction.id,attackIndex:0,targets:[target.uuid],
 onDamageApplied:{type:'triggerItemAction',itemUuid:stun.uuid,actionId:saveAction.id,
 saveOutcome:{key:'stunning-fist',groupKey:'stunning-fist',sourceItemUuid:stun.uuid,
 sourceActionId:saveAction.id,targets:[target.uuid],onFailure:{type:'linkedBuff',statusId:'stunned'}}}};
 assert.equal((await api.attackOutcomes.register(req)).registered,true);
 const apply=async (card,index,value,actorRef=target)=>{
  const app={extraOptions:{message:card,attackIndex:index},actor:actorRef,value};
  await ApplyDamage._onApply.call(app);
  await new Promise(r=>setTimeout(r,20));
 };
 await apply(card,0,0);assert.equal(fired,0,'No damage must not trigger');
 await apply(card,1,4);assert.equal(fired,0,'Different attack index must not trigger');
 await apply(card,0,3);assert.equal(fired,1,'Correct card damage triggers once');
 assert.equal(saved,1,'SaveOutcome must register before the save action');
 await apply(card,0,2);assert.equal(fired,1,'Duplicate damage must not trigger twice');
 const registry=api.attackOutcomes.list();assert.equal(registry[0].state,'done');
 assert.equal(registry[0].sourceMessageId,card.id);
 await assert.rejects(api.attackOutcomes.register({...req,key:'bad',sourceActionId:'wrong'}),/Source Action/);
 await assert.rejects(api.attackOutcomes.register({...req,key:'bad',targets:['Actor.missing']}),/Invalid target/);
 await assert.rejects(api.attackOutcomes.register({...req,key:'bad',attackIndex:undefined}),/attackIndex/);
 console.log('PASS attack outcomes: native provenance, applied damage, attack index, duplicate protection, action validation');
})().catch(e=>{console.error(e);process.exitCode=1});