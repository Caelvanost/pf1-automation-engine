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
vm.createContext(ctx);
for(const script of ['effect-groups.js','save-outcomes.js'])
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
 await api.saveOutcomes.register(rule('auto-passive'));
 await api.saveOutcomes.unregister({actor:caster,key:'auto-passive'});
 await api.effectGroups.approveTemplate({actor:caster,templateUuid:template.uuid});
 await api.effectGroups.approveTemplate({actor:caster,templateUuid:activeTemplate.uuid});
 await assert.rejects(api.saveOutcomes.register({...rule('arbitrary'),
  onFailure:{...rule('arbitrary').onFailure,parameters:{acPenalty:4}}}),/parameters/);
 await api.saveOutcomes.register(rule('first'));
 const failed=await api.saveOutcomes.resolve(event('failed',11));
 assert.equal(failed.success,false);
 assert.equal(target.items.size,2);
 const first=[...target.items.values()].find(x=>x.id!=='permanent');
 assert.equal(first.system.active,true);
 assert.equal(first.system.changes[0].value,-4);
 assert.equal(timers.size,1);
 assert.equal([...timers.values()][0].duration.value,60);
 await api.saveOutcomes.resolve(event('failed',11));
 assert.equal(target.items.size,2,'Replay is idempotent');
 await api.saveOutcomes.register(rule('success'));
 await api.saveOutcomes.resolve(event('passed',19));
 assert.equal(target.items.size,2,'Success never adds effects');
 await api.saveOutcomes.register(rule('ignore',target,'ignore'));
 await api.saveOutcomes.resolve(event('ignored',9));
 assert.equal(target.items.size,2);
 const originalGroup=api.effectGroups.listGroups().find(g=>g.targetUuid===target.uuid);
 await api.saveOutcomes.register(rule('refresh',target,'refresh'));
 await api.saveOutcomes.resolve(event('refreshed',9));
 assert.equal(api.effectGroups.listGroups().find(g=>g.targetUuid===target.uuid).id,originalGroup.id);
 await api.saveOutcomes.register(rule('replace',target,'replace'));
 await api.saveOutcomes.resolve(event('replaced',9));
 assert.equal(target.items.size,2);
 assert.equal(target.items.has('permanent'),true);
 const replacement=[...target.items.values()].find(x=>x.id!=='permanent');
 assert.notEqual(first.id,replacement.id);
 await api.effectGroups.expireGroup(api.effectGroups.listGroups().find(g=>g.targetUuid===target.uuid).id);
 assert.equal(target.items.size,1,'Expiry deletes only managed copy');
 await api.saveOutcomes.register(rule('synthetic',synthetic));
 await api.saveOutcomes.resolve(event('synthetic-fail',9,synthetic));
 assert.equal(synthetic.items.size,1);
 await api.effectGroups.expireGroup(api.effectGroups.listGroups().find(g=>g.targetUuid===synthetic.uuid).id);
 assert.equal(synthetic.items.size,0);
 await api.saveOutcomes.register(rule('activeeffect',synthetic,'stack',activeTemplate));
 await api.saveOutcomes.resolve(event('ae-fail',9,synthetic));
 assert.equal(synthetic.effects.size,1);
 assert.equal([...synthetic.effects.values()][0].changes[0].value,'-2');
 await api.effectGroups.expireGroup(api.effectGroups.listGroups().find(g=>g.targetUuid===synthetic.uuid).id);
 assert.equal(synthetic.effects.size,0);
 mechanical=-8;
 await assert.rejects(api.saveOutcomes.register(rule('modified')),/modifié|approved|approval/i);
 console.log('PASS templateEffect: GM approvals, fixed mechanical buff/AE, failure/success, replay, synthetic, stacking, refresh, replacement, expiration and fingerprint changes');
})().catch(error=>{console.error(error);process.exitCode=1});
