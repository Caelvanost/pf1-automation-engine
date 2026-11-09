'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const NS='pf1-automation-engine';
const root=path.resolve(__dirname,'..'),calls={init:[],ready:[]};
const settings=new Map([['genericEnabled',true],['genericDebug',false]]);
const documents=new Map(),messages=new Map(),timers=new Map();
let sequence=0;
const gm={id:'gm',isGM:true,active:true};
const ctx={console,Map,Set,Promise,Date,setTimeout,clearTimeout,
 foundry:{utils:{deepClone:structuredClone,randomID:()=>String(++sequence)}},
 Hooks:{once:(key,fn)=>calls[key].push(fn),on(){}},
 fromUuid:async uuid=>documents.get(uuid)??null,
 game:{user:gm,users:[gm],messages,combat:null,combats:new Map(),
 settings:{get:(_,key)=>settings.get(key),register:(_,key,opts)=>{if(!settings.has(key))settings.set(key,structuredClone(opts.default))},
 async set(_,key,value){settings.set(key,structuredClone(value));return value}},
 modules:new Map(),socket:{on(){},emit(){}}}};
ctx.game.users.get=id=>id==='gm'?gm:null;
ctx.game.modules.set(NS,{active:true,api:{}});
ctx.pf1={registry:{conditions:new Map([['stunned',{}],['fascinated',{}]])},config:{buffTargets:{ac:{category:'defense'}}}};
vm.createContext(ctx);
for(const script of ['effect-groups.js','dynamic-effects.js','save-outcomes.js','attack-outcomes.js'])
 vm.runInContext(fs.readFileSync(path.join(root,'scripts',script),'utf8'),ctx,{filename:script});
for(const cb of calls.init)cb();for(const cb of calls.ready)cb();
const api=ctx.game.modules.get(NS).api;
api.duration={schedule:async data=>(timers.set(data.id,structuredClone(data)),data.id),
 cancelTimer:async id=>timers.delete(id)};
api.generic={scheduleTurn:async data=>(timers.set(data.id,structuredClone(data)),data.id),
 cancelTimer:async id=>timers.delete(id)};
function makeActor(uuid){
 const actor={documentName:'Actor',id:uuid.split('.').at(-1),name:uuid,uuid,isOwner:true,
 items:new Map(),effects:new Map(),testUserPermission:()=>true,
 async createEmbeddedDocuments(type,list){return list.map(input=>{
  const id='copy'+(++sequence),collection=type==='Item'?actor.items:actor.effects;
  const doc={id,uuid:uuid+'.'+type+'.'+id,documentName:type,type:input.type,
   name:input.name,system:structuredClone(input.system??{}),disabled:input.disabled,
   changes:structuredClone(input.changes??[]),flags:structuredClone(input.flags),
   getFlag:(n,k)=>doc.flags?.[n]?.[k],
   async setActive(state){this.system.active=state},
   async update(change){if('system.active' in change)this.system.active=change['system.active']},
   async delete(){collection.delete(id);documents.delete(doc.uuid)}};
  collection.set(id,doc);documents.set(doc.uuid,doc);return doc;
 })}};
 documents.set(uuid,actor);return actor;
}
const caster=makeActor('Actor.Monk'),target=makeActor('Actor.Target');
const synthetic=makeActor('Scene.scene.Token.token.Actor.synthetic');
const permanent={id:'permanent',uuid:'Actor.Target.Item.permanent',
 system:{active:true},getFlag:()=>null};
target.items.set(permanent.id,permanent);
const saveItem={documentName:'Item',uuid:'Actor.Monk.Item.ability',actor:caster,
 actions:new Map([['saving',{id:'saving'}]])};
documents.set(saveItem.uuid,saveItem);
let mechanical=-4;
const template={uuid:'Actor.Monk.Item.approvedBuff',documentName:'Item',type:'buff',
 name:'Approved mechanical buff',parent:caster,actor:caster,
 toObject:()=>({name:'Approved mechanical buff',type:'buff',
  system:{active:false,scriptCalls:[],changes:[{target:'ac',value:mechanical}]},flags:{}})};
documents.set(template.uuid,template);
const activeTemplate={uuid:'Actor.Monk.ActiveEffect.approvedAE',
 documentName:'ActiveEffect',name:'Approved mechanical ActiveEffect',parent:caster,
 toObject:()=>({name:'Approved mechanical ActiveEffect',disabled:true,
  changes:[{key:'system.attributes.ac',mode:2,value:'-2',priority:20}],flags:{}})};
documents.set(activeTemplate.uuid,activeTemplate);
const card={id:'card',flags:{[NS]:{saveContext:{
 sourceItemUuid:saveItem.uuid,sourceActionId:'saving',saveDC:16}}},
 getFlag(n,k){return this.flags[n]?.[k]}};
messages.set(card.id,card);
api.saveContext={fromMessage:m=>m.getFlag(NS,'saveContext')};
function event(id,total,recipient=target){
 const m={id,flags:{},getFlag(n,k){return this.flags[n]?.[k]},
 async setFlag(n,k,v){(this.flags[n]??={})[k]=v}};
 messages.set(id,m);
 return {saveMessageId:id,sourceMessageId:card.id,sourceItemUuid:saveItem.uuid,
  sourceActionId:'saving',targetActorUuid:recipient.uuid,normalTotal:total,
  effectiveTotal:total,saveDC:16};
}
function rule(key,recipient=target,mode='stack',tpl=template){
 return {actor:caster,key,groupKey:key,sourceItemUuid:saveItem.uuid,
  sourceActionId:'saving',targets:[recipient.uuid],
  onFailure:{type:'templateEffect',templateUuid:tpl.uuid,
   duration:{seconds:60,expire:'elapsed'},stacking:{mode,key:'shared-ac'}}};
}
(async()=>{
 let triggered=0;
 saveItem.use=async ({actionId,cost,chatMessage})=>{
   assert.equal(actionId,'saving');
   assert.equal(cost,0);
   assert.equal(chatMessage,true);
   triggered++;
   return true;
 };
 const strikeAction={id:'strike'};
 const strikeItem={documentName:'Item',id:'unarmed',
   uuid:caster.uuid+'.Item.unarmed',actor:caster,
   actions:new Map([[strikeAction.id,strikeAction]])};
 documents.set(strikeItem.uuid,strikeItem);
 const strikeCard={id:'strike-card',documentName:'ChatMessage',
   itemSource:strikeItem,actionSource:strikeAction,speaker:{actor:caster.id}};
 messages.set(strikeCard.id,strikeCard);
 target.getConditionImmunities=()=>new Set();
 synthetic.getConditionImmunities=()=>new Set();
 async function attack(key,consequence,recipient=target){
   const request={actor:caster,key,groupKey:key,
     sourceItemUuid:strikeItem.uuid,sourceActionId:strikeAction.id,
     attackIndex:0,targets:[recipient.uuid],
     onDamageApplied:{type:'triggerItemAction',itemUuid:saveItem.uuid,
       actionId:'saving',saveOutcome:{key,groupKey:key,
         sourceItemUuid:saveItem.uuid,sourceActionId:'saving',
         targets:[recipient.uuid],onFailure:consequence}}};
   assert.equal((await api.attackOutcomes.register(request)).registered,true);
   assert.equal((await api.attackOutcomes.bindAttack({actor:caster,key,
      sourceMessageId:strikeCard.id})).bound,true);
   ctx.__damage={
     context:{actorUuid:caster.uuid,sourceItemUuid:strikeItem.uuid,
       sourceActionId:strikeAction.id,sourceMessageId:strikeCard.id,
       attackIndex:0,targetUuid:recipient.uuid,
       delta:{provenDamage:true,hitPointLoss:5}},
     userId:gm.id,requestId:'damage-'+key,targetUuid:recipient.uuid
   };
   const result=await vm.runInContext('aoResolveDamage(__damage)',ctx);
   assert.equal(result.processed,true);
   const rule=api.saveOutcomes.list().find(x=>x.key===key);
   assert(rule,'Missing SaveOutcome '+key);
   assert.equal(rule.sourceItemUuid,saveItem.uuid);
   assert.equal(rule.sourceActionId,'saving');
   assert.deepEqual([...rule.targets],[recipient.uuid]);
   return rule;
 }
 const dynamic={type:'dynamicEffect',name:'Defense weakened',img:'penalty.webp',
   changes:[{target:'ac',modifier:'penalty',value:-4}],
   duration:{seconds:60,expire:'elapsed'},
   stacking:{mode:'replace',key:'shared-crushing-ac'}};
 const saved=await attack('dynamic-failed',dynamic);
 assert.equal(saved.onFailure.type,'dynamicEffect');
 assert.deepEqual(structuredClone(saved.onFailure.changes),dynamic.changes);
 assert.deepEqual(structuredClone(saved.onFailure.duration),dynamic.duration);
 assert.deepEqual(structuredClone(saved.onFailure.stacking),dynamic.stacking);
 assert.equal((await api.saveOutcomes.resolve(event('failed-dynamic',11))).success,false);
 const buff=[...target.items.values()].find(i=>i.id!=='permanent');
 assert(buff,'Failed native save must generate a mechanical buff');
 assert.equal(buff.system.active,true);
 assert.deepEqual(structuredClone(buff.system.changes),[
   {target:'ac',type:'penalty',formula:'-4',operator:'add'}]);
 assert.equal([...timers.values()][0].duration.value,60);
 await api.saveOutcomes.resolve(event('failed-dynamic',11));
 assert.equal(target.items.size,2,'Duplicate save should not add buff');
 await attack('dynamic-success',dynamic);
 assert.equal((await api.saveOutcomes.resolve(event('success-dynamic',21))).success,true);
 assert.equal(target.items.size,2,'Successful save cannot add buff');
 const tpl={type:'templateEffect',templateUuid:template.uuid,
   duration:{seconds:60,expire:'elapsed'},stacking:{mode:'stack'}};
 assert.equal((await attack('template-failed',tpl,synthetic)).onFailure.templateUuid,template.uuid);
 await api.saveOutcomes.resolve(event('failed-template',7,synthetic));
 assert.equal(synthetic.items.size,1,'Template applies to synthetic Actor');
 const linked={type:'linkedBuff',name:'Stunned',img:'stunned.webp',
   statusId:'stunned',duration:{seconds:6,expire:'elapsed'}};
 await attack('linked-failed',linked);
 await api.saveOutcomes.resolve(event('failed-linked',9));
 assert.equal(target.effects.size,1,'linkedBuff remains supported');
 assert.equal(triggered,4,'Exactly one native save action per proven attack');
 assert.equal(target.items.has('permanent'),true);
 console.log('PASS full attack->save->buff: dynamic fail/success, template, linked, replay, synthetic and timer');
})().catch(e=>{console.error(e);process.exitCode=1});
