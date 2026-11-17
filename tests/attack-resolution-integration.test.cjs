'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const events=new Map(),lifecycle=new Map(),published=[],delivered=[];
const hooks={
 on(name,fn){const arr=events.get(name)??[];arr.push(fn);events.set(name,arr);},
 once(name,fn){const arr=lifecycle.get(name)??[];arr.push(fn);lifecycle.set(name,arr);},
 callAll(name,...args){for(const fn of events.get(name)??[])fn(...args)}
};
const user={id:'p',isGM:false};
const item={id:'i',uuid:'Actor.p.Item.i',documentName:'Item',
 actions:new Map(),flags:{},actor:null,
 getFlag(_ns,k){return this.flags[k]},
 async setFlag(_ns,k,v){this.flags[k]=structuredClone(v);return v}};
const actor={uuid:'Actor.p',documentName:'Actor',items:new Map([['i',item]]),
 testUserPermission(_u,p){return p==='OWNER'},getActiveTokens(){return activeAttackTokens}};
item.actor=actor;
const action={id:'trip',item,actor,actionType:'cmb',hasAttack:true,isCombatManeuver:true};
item.actions.set('trip',action);
const target={uuid:'Actor.enemy',documentName:'Actor',system:{attributes:{
 ac:{normal:{total:25},touch:{total:17},flatFooted:{total:24}},
 cmd:{total:19}}}};
const token={uuid:'Scene.s.Token.enemy',documentName:'Token',actor:target};
token.object={actor:target,document:{uuid:token.uuid,parent:{id:'s'},
 id:'enemy',x:300,y:0,width:1,height:1,elevation:0},losHeight:5};
const attackerToken={uuid:'Scene.s.Token.player',documentName:'Token',actor};
attackerToken.object={actor,document:{uuid:attackerToken.uuid,parent:{id:'s'},
 id:'player',x:0,y:0,width:1,height:1,elevation:0},losHeight:5};
const activeAttackTokens=[attackerToken];
const target2={uuid:'Scene.s.Token.other',documentName:'Token',
 actor:{uuid:'Actor.other',system:{attributes:{cmd:{total:30}}}}};
const coverInspections=[];
const api={coverPF1:{inspect(options){coverInspections.push(options);return {
 status:'confirmed',type:'normal',acBonus:4,reflexBonus:2,
 source:'pf1-corner-rays'};}}};
const context={console,Map,Set,WeakSet,Promise,Date,Number,structuredClone,
 pf1:{config:{maneuverActionTypes:new Set(['cmb'])}},
 foundry:{utils:{deepClone:structuredClone}},
 Hooks:hooks,
 fromUuid:async uuid=>uuid===token.uuid?token:uuid===target2.uuid?target2:
 uuid===attackerToken.uuid?attackerToken:null,
 game:{user,users:new Map([['p',user]]),settings:{get:(_ns,k)=>k==='genericEnabled'?true:false},
 modules:new Map([['pf1-automation-engine',{active:true,api}]]),
 i18n:{localize:k=>k}},
};
context.globalThis=context;
vm.createContext(context);
for(const file of ['attack-resolution.js','attack-events.js'])
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../scripts/'+file),'utf8'),context,{filename:file});
for(const fn of lifecycle.get('init')??[])fn();
for(const fn of lifecycle.get('ready')??[])fn();
assert.equal(events.get('pf1AttackRoll')?.length,1);
assert.equal(events.get('pf1PostActionUse')?.length,1);
hooks.on('pf1aeAttackResolution',e=>published.push(e));
const call={id:'sub',name:'PF1AE:attack:resolved',category:'postUse',
 async execute(_shared,{event}){delivered.push(event)}};
const sub={id:'sub',uuid:'Actor.p.Item.sub',documentName:'Item',actor,
 scriptCalls:{contents:[call]}};
actor.items.set('sub',sub);
const roll=(nat,total)=>({id:'r'+nat,total,formula:'1d20+7',
 dice:[{faces:20,results:[{result:nat,active:true}]}]});
const tick=()=>new Promise(r=>setTimeout(r,15));
(async()=>{
 const message={id:'card',documentName:'ChatMessage'};
 hooks.callAll('pf1AttackRoll',action,roll(16,23),{attackIndex:0,targets:[token]});
 hooks.callAll('pf1PostActionUse',{action,shared:{targets:[token],chatAttacks:[{}]}},message);
 await tick();
 assert.equal(delivered.length,1);
 assert.equal(published.length,1);
 const e=delivered[0];
 assert.equal(e.type,'attack:resolved');
 assert.equal(e.actionId,'trip');
 assert.equal(e.roll.natural,16);
 assert.equal(e.defense.type,'cmd');
 assert.equal(e.defense.value,19);
 assert.equal(e.targetResults.length,1);
 assert.equal(e.targetResults[0].defenseHit,true);
 assert.equal(e.targetTokenUuid,token.uuid);
 assert.equal(e.sourceMessageId,'card');
 assert.equal(e.attackIndex,0);
 assert.equal(e.resolution,'success');
 assert.equal(e.hit,null,'unverified concealment never prematurely confirms final hit');
 // Multi-target roll must not be reused as authoritative for both targets.
 hooks.callAll('pf1AttackRoll',action,roll(8,21),{targets:[token,target2]});
 hooks.callAll('pf1PostActionUse',{action,shared:{targets:[token,target2]}},message);
 await tick();
 assert.equal(published[1].targetResults.length,2);
 assert.equal(published[1].targetResults.every(o=>o.hit===null&&o.resolution==='indeterminate'),true);
 // No scripted item subscriber is needed for the public resolution hook.
 actor.items.delete('sub');
 hooks.callAll('pf1AttackRoll',action,roll(4,11),{targets:[token]});
 hooks.callAll('pf1PostActionUse',{action,shared:{targets:[token]}},message);
 await tick();
 assert.equal(published.length,3);
 assert.equal(delivered.length,2,'no stale Script Call callback');
 assert.equal(published[2].defense.value,19);
 // The PF1 corner-ray service is evaluated for the exact single-target
 // ranged action and carried through the native post-roll resolution.
 const ranged={id:'arrow',item,actor,actionType:'rwak',hasAttack:true,
  touch:false,isCombatManeuver:false};
 item.actions.set('arrow',ranged);
 hooks.callAll('pf1AttackRoll',ranged,roll(12,29),{
  attackIndex:0,targets:[token]});
 hooks.callAll('pf1PostActionUse',{
  action:ranged,shared:{targets:[token],chatAttacks:[{}]}},message);
 await tick();
 const covered=published[3]?.targetResults?.[0];
 assert.equal(coverInspections.length,1,'exactly one cover inspection');
 assert.equal(covered?.coverDiagnosis?.type,'normal');
 assert.equal(covered?.defense?.baseValue,25);
 assert.equal(covered?.defense?.coverAssessment?.acBonus,4);
 assert.equal(covered?.defense?.value,null,
  'no guessed native cover baseline; comparison must not claim a hit');
 assert.equal(covered?.resolution,'indeterminate');
 assert.equal(target.system.attributes.ac.normal.total,25,
  'native sheet AC must remain unchanged');

 console.log('PASS attack resolution integration: existing Script Call, CMD, natural d20, target pair, no subscriber');
})().catch(e=>{console.error(e);process.exitCode=1});
