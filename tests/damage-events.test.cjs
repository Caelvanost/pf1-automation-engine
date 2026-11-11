'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const hooks=new Map(),ready=[],init=[],store=new Map([['genericEnabled',true],['genericDebug',false]]);
const docs=new Map(),messages=new Map(),emissions=[];
const gm={id:'gm',active:true,isGM:true},gm2={id:'gm2',active:true,isGM:true};
const player={id:'player',active:true,isGM:false};
const users=[gm,gm2,player];users.get=id=>users.find(x=>x.id===id);
let seed=0;
const scriptCalls=[];
const game={user:gm,users,messages,modules:new Map(),
 settings:{get:(_,key)=>store.get(key),register:(_,key,opt)=>{if(!store.has(key))store.set(key,opt.default)},
 set:async(_,key,value)=>{store.set(key,structuredClone(value));return value}},
 socket:{on(channel,fn){const list=hooks.get('socket:'+channel)??[];
  list.push(fn);hooks.set('socket:'+channel,list)},
 emit(channel,data){emissions.push({channel,data})}}};
const Hooks={once(name,fn){(name==='ready'?ready:init).push(fn)},
 on(name,fn){const list=hooks.get(name)??[];list.push(fn);hooks.set(name,list)},
 callAll(name,payload){for(const fn of hooks.get(name)??[])fn(payload)}};
const ctx={game,Hooks,Map,Set,WeakSet,WeakMap,Promise,Date,Number,setTimeout,clearTimeout,console,
 foundry:{utils:{randomID:()=>String(++seed),deepClone:structuredClone}},
 fromUuid:async uuid=>docs.get(uuid)??null,
 ChatMessage:{getSpeakerActor:sp=>docs.get(sp?.actorUuid)??null}};
function actor(uuid,hp=20){
 const a={id:uuid.split('.').at(-1),uuid,documentName:'Actor',name:uuid,
  system:{attributes:{hp:{value:hp,temp:0,nonlethal:0,offset:0}}},
  items:new Map(),testUserPermission:()=>false};
 docs.set(uuid,a);return a;
}
const source=actor('Actor.Source'),target=actor('Actor.Target',12),
 synthetic=actor('Scene.scene.Token.token.Actor.synthetic',11);
const weapon={documentName:'Item',id:'weapon',uuid:source.uuid+'.Item.weapon',actor:source};
const action={id:'attack'};
weapon.actions=new Map([['attack',action]]);
docs.set(weapon.uuid,weapon);
const card={documentName:'ChatMessage',id:'attack-card',itemSource:weapon,actionSource:action,
 speaker:{actorUuid:source.uuid}};
messages.set(card.id,card);
const feature={documentName:'Item',id:'feature',uuid:source.uuid+'.Item.feature',actor:source,
 scriptCalls:{contents:[
 {id:'any',category:'postUse',name:'PF1AE:damage:applied',
  async execute(_shared,{event}){scriptCalls.push(event)}},
 {id:'crit',category:'postUse',name:'PF1AE:damage:critical',
  async execute(_shared,{event}){scriptCalls.push(event)}},
 {id:'zero',category:'postUse',name:'PF1AE:damage:zeroHP',
  async execute(_shared,{event}){scriptCalls.push(event)}}
 ]}};
source.items.set('feature',feature);docs.set(feature.uuid,feature);
game.modules.set('pf1-automation-engine',{active:true,api:{}});
vm.createContext(ctx);
for(const file of ['attack-outcomes.js','damage-events.js'])
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../scripts/',file),'utf8'),ctx,{filename:file});
for(const cb of init)cb();for(const cb of ready)cb();
assert.equal((hooks.get('pf1ApplyDamage')??[]).length,1,'Only original bridge listens to native apply hook');
assert.equal((hooks.get('pf1ApplyDamageTargetOptions')??[]).length,1);
assert.equal((hooks.get('updateActor')??[]).length,1);
assert.equal((hooks.get('pf1aeVerifiedDamage')??[]).length,1);
const wait=()=>new Promise(r=>setTimeout(r,35));
let index=0;
async function damage(recipient,{loss=0,critMult=0,attackIndex=0,from=gm,offset=false,
 cardRef=card,doPre=true}={}){
 const before=recipient.system.attributes.hp.value;
 const options={critMult,pf1:{deltas:{hp:{offset:-loss}}},_nasPrevHp:before};
 const app={extraOptions:{message:cardRef,attackIndex}};
 for(const fn of hooks.get('pf1ApplyDamageTargetOptions')??[])fn(app,{actor:recipient},options);
 if(doPre)for(const fn of hooks.get('pf1ApplyDamage')??[])fn(recipient,options);
 recipient.system.attributes.hp.value=before-loss;
 if(offset)recipient.system.attributes.hp.offset-=loss;
 for(const fn of hooks.get('updateActor')??[])fn(recipient,
  {system:{attributes:{hp:offset?{offset:-loss}:{value:before-loss}}}},
  options,from.id);
 await wait();
 return store.get('damageEventReceipts')??[];
}
(async()=>{
 // Normal strike, no crit, 12 -> 5.
 let receipts=await damage(target,{loss:7,critMult:0});
 assert.equal(receipts.length,1);
 assert.equal(scriptCalls.length,1);
 assert.equal(scriptCalls[0].type,'damage:applied');
 assert.equal(scriptCalls[0].critical,false);
 assert.equal(scriptCalls[0].hpBefore,12);assert.equal(scriptCalls[0].hpAfter,5);
 assert.equal(scriptCalls[0].hpDelta,-7);assert.equal(scriptCalls[0].reducedToZero,false);
 // Crit damage on separate native application, crosses 0.
 await damage(target,{loss:8,critMult:4,attackIndex:1});
 assert.equal(scriptCalls.length,4,'Applied + critical + zeroHP');
 assert.deepEqual(scriptCalls.slice(1).map(x=>x.type),[
  'damage:applied','damage:critical','damage:zeroHP']);
 assert.equal(scriptCalls[1].critMult,4);assert.equal(scriptCalls[1].critical,true);
 assert.equal(scriptCalls[1].hpBefore,5);assert.equal(scriptCalls[1].hpAfter,-3);
 assert.equal(scriptCalls[1].attackIndex,1);
 assert.equal(scriptCalls[1].criticalHitConfirmed,null);
 // Already <=0 -> further damage does not yield zeroHP event.
 await damage(target,{loss:2,critMult:0});
 assert.equal(scriptCalls.length,5);
 assert.equal(scriptCalls.at(-1).reducedToZero,false);
 // Zero damage (including critical roll) or missing native pre must not notify.
 await damage(target,{loss:0,critMult:4});
 assert.equal(scriptCalls.length,5);
 await damage(target,{loss:1,critMult:4,doPre:false});
 assert.equal(scriptCalls.length,5);
 // Solely temporary HP loss produces no user event.
 const before=target.system.attributes.hp.value;
 const tmp={extraOptions:{message:card,attackIndex:0}};
 target.system.attributes.hp.temp=6;
 for(const fn of hooks.get('pf1ApplyDamageTargetOptions')??[])fn(tmp,{actor:target},{critMult:4});
 for(const fn of hooks.get('pf1ApplyDamage')??[])fn(target,{critMult:4});
 target.system.attributes.hp.temp=2;
 for(const fn of hooks.get('updateActor')??[])fn(target,{system:{attributes:{hp:{temp:2}}}},{},gm.id);
 await wait();assert.equal(scriptCalls.length,5);
 assert.equal(target.system.attributes.hp.value,before);
 // Synthetic target: native PF1 hp.offset, effective HP 11->6.
 await damage(synthetic,{loss:5,critMult:0,offset:true});
 assert.equal(scriptCalls.length,6);
 assert.equal(scriptCalls.at(-1).targetActorUuid,synthetic.uuid);
 assert.equal(scriptCalls.at(-1).hpBefore,11);
 assert.equal(scriptCalls.at(-1).hpAfter,6);
 // A native application twice from SAME card is two distinct receipts.
 await damage(synthetic,{loss:1,critMult:0,offset:true});
 assert.equal(scriptCalls.length,7);
 // Contradictory message provenance rejected.
 const falseCard={...card,id:'incorrect',itemSource:{...weapon,uuid:'Actor.Other.Item.weapon'}};
 messages.set(falseCard.id,falseCard);
 await damage(synthetic,{loss:1,critMult:0,cardRef:falseCard});
 assert.equal(scriptCalls.length,7);
 // A manual HP update never has the two native hooks.
 synthetic.system.attributes.hp.value-=1;
 for(const fn of hooks.get('updateActor')??[])fn(synthetic,
  {system:{attributes:{hp:{value:synthetic.system.attributes.hp.value}}}},{},gm.id);
 await wait();assert.equal(scriptCalls.length,7);
 // Original bridge still supports registered attack outcomes and does not
 // generate an extra native action when there is no registration.
 assert.equal(game.modules.get('pf1-automation-engine').api.attackOutcomes.list().length,0);
 assert.equal(game.modules.get('pf1-automation-engine').api.damageEvents.listSubscriptions(source).length,3);
 // Player-owned source: GM emits, owner runs; GM must never execute player's code.
 source.testUserPermission=(u,role)=>u===player&&role==='OWNER';
 await damage(synthetic,{loss:1,critMult:0});
 assert.equal(scriptCalls.length,7);
 const notify=emissions.filter(e=>e.data.channel==='pf1ae-damage-events-v1').at(-1)?.data;
 assert(notify,'Leader must notify player owner');
 assert.equal(notify.recipientId,player.id);
 assert.equal(notify.leaderId,gm.id);
 game.user=player;
 for(const fn of hooks.get('socket:module.pf1-automation-engine')??[])fn(notify);
 await wait();assert.equal(scriptCalls.length,8);
 // Repeat packet and send to wrong user: never reexecute.
 for(const fn of hooks.get('socket:module.pf1-automation-engine')??[])fn(notify);
 await wait();assert.equal(scriptCalls.length,8);
 game.user=gm;
 // With two GMs, the nonleader cannot certify its own local events.
 game.user=gm2;
 const prior=scriptCalls.length;
 await damage(synthetic,{loss:1,critMult:0,from:gm2});
 assert.equal(scriptCalls.length,prior);
 game.user=gm;
 // The original bridge sends its GM attestation to leader for processing.
 const incoming=emissions.filter(x=>x.data.op==='damage').at(-1)?.data;
 assert(incoming&&incoming.userId==='gm2');
 for(const fn of hooks.get('socket:module.pf1-automation-engine')??[])fn(incoming);
 await wait();
 assert.equal((store.get('damageEventReceipts')??[]).length>=7,true);
 console.log('PASS damage events: native applied/critical/zeroHP, synthetic offsets, no manual/zero/temp, repeated card, player delivery, two GMs');
})().catch(err=>{console.error(err);process.exitCode=1});
