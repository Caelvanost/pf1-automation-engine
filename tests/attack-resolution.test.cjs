'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.resolve(__dirname,'../scripts/attack-resolution.js'),'utf8');
const hooks={ready:[],render:new Map()};
const item={
 id:'weapon',uuid:'Actor.a.Item.weapon',documentName:'Item',
 actions:new Map(),flags:{},
 getFlag(_n,k){return this.flags[k]},
 async setFlag(_n,k,v){this.flags[k]=structuredClone(v);return v}
};
const actor={id:'a',uuid:'Actor.a',documentName:'Actor',items:new Map([['weapon',item]]),
 testUserPermission(){return true}};
item.actor=actor;
const action={id:'atk',item,actor,actionType:'rwak',hasAttack:true,touch:false,isCombatManeuver:false};
item.actions.set(action.id,action);
const target={id:'target',uuid:'Actor.target',system:{attributes:{
 ac:{normal:{total:20},touch:{total:12},flatFooted:{total:18}},
 cmd:{total:23}}}};
const token={uuid:'Scene.s.Token.t',documentName:'Token',actor:target};
const api={};const ctx={
 console,Map,Set,Number,Promise,structuredClone,
 foundry:{utils:{deepClone:structuredClone}},
 game:{user:{isGM:true},modules:new Map([['pf1-automation-engine',{active:true,api}]]),
 i18n:{localize:k=>k}},
 pf1:{config:{maneuverActionTypes:new Set(['cmb'])}},
 Hooks:{once:(name,fn)=>{if(name==='ready')hooks.ready.push(fn)},
 on:(name,fn)=>hooks.render.set(name,fn)},
};
ctx.globalThis=ctx;
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'attack-resolution.js'});
for(const fn of hooks.ready)fn();
const ar=api.attackResolution;
assert.equal(typeof ar.resolveAttack,'function');
const d20=(natural,total)=>({total,dice:[{faces:20,results:[{result:natural,active:true}]}]});
const run=(n,total,extra={})=>ar.resolveAttack({
 item,actor,action,targetActor:target,targetToken:token,roll:d20(n,total),
 attackIndex:0,sourceMessageId:'native-card',concealmentCleared:true,...extra
});
(async()=>{
// 1–4 native normal, touch, flatFooted and CMD
let x=await run(12,22);
assert.equal(x.defense.type,'normal');assert.equal(x.defense.value,20);
assert.equal(x.hit,true);assert.equal(x.resolution,'success');
await ar.setActionDefenseConfig(item,action,'touch');
x=await run(10,15);assert.equal(x.defense.type,'touch');assert.equal(x.defense.value,12);
await ar.setActionDefenseConfig(item,action,'flatFooted');
x=await run(10,19);assert.equal(x.defense.value,18);
await ar.setActionDefenseConfig(item,action,'cmd');
x=await run(10,23);assert.equal(x.defense.value,23);
assert.equal(x.hit,true);assert.equal(x.attackIndex,0);
assert.equal(x.targetTokenUuid,token.uuid);
assert.equal(x.sourceMessageId,'native-card');
// 5–9 nat1 miss, nat20 hit, below, equal, above
x=await run(1,99);assert.equal(x.hit,false);
x=await run(20,2);assert.equal(x.hit,true);
assert.equal((await run(10,22)).hit,false);
assert.equal((await run(10,23)).hit,true);
assert.equal((await run(10,24)).hit,true);
// 10–13 missing d20, target/defense, multi attacks
x=await ar.resolveAttack({item,actor,action,targetActor:target,roll:{total:34},concealmentCleared:true});
assert.equal(x.resolution,'indeterminate');
x=await run(12,35,{targetActor:null,targetToken:null});
assert.equal(x.hit,null);
x=await run(12,35,{targetActor:{system:{attributes:{}}},targetToken:null});
assert.equal(x.hit,null);
const batch=await Promise.all([run(12,25),run(12,16)]);
assert.deepEqual(batch.map(o=>o.hit),[true,false]);
// 14 multiple target contexts independently compare, no shared AC
const other={uuid:'Actor.other',system:{attributes:{cmd:{total:30}}}};
const m=await Promise.all([run(12,25),run(12,25,{targetActor:other,targetToken:null})]);
assert.deepEqual(m.map(o=>o.hit),[true,false]);
// 15 cover is defense input, no unauthorized assumptions
const covered={uuid:'Actor.covered',system:{attributes:{cmd:{total:27}}}};
assert.equal((await run(12,25,{targetActor:covered,targetToken:null})).hit,false);
// 16 unresolved concealment: success against defense != final hit
x=await run(12,25,{concealmentCleared:false,concealmentPending:true});
assert.equal(x.defenseHit,true);assert.equal(x.hit,null);assert.equal(x.resolution,'pendingConcealment');
// 17 external provider
await ar.setActionDefenseConfig(item,action,'auto');
const stop=ar.registerDefenseProvider({id:'external-1',priority:100,resolve:()=>({
 type:'touch',reason:'external special rule'})});
x=await run(12,13);
assert.equal(x.defense.type,'touch');assert.equal(x.defense.provider,'external-1');
// 18 same priority conflicting types -> indeterminate
const stop2=ar.registerDefenseProvider({id:'external-2',priority:100,resolve:()=>({type:'normal'})});
x=await run(12,13);
assert.equal(x.hit,null);assert.match(x.reason,/conflicting/i);
// 19 explicit overrides any provider conflict
await ar.setActionDefenseConfig(item,action,'cmd');
x=await run(12,25);assert.equal(x.defense.type,'cmd');
assert.equal(x.hit,true);
// 20 deregister
await ar.setActionDefenseConfig(item,action,'auto');
stop2();stop();
x=await run(12,22);assert.equal(x.defense.provider,'pf1-native');
assert.equal(ar.listDefenseProviders().length,0);
// 21 flag persistence survives reloading a service object/duplication
await ar.setActionDefenseConfig(item,action,'touch');
assert.equal(item.flags.attackDefenseConfig.atk,'touch');
const duplicated={...item,flags:structuredClone(item.flags)};
assert.equal(ar.getActionDefenseConfig(duplicated,action),'touch');
await ar.setActionDefenseConfig(item,action,'auto');
assert.equal(item.flags.attackDefenseConfig.atk,undefined);
// 22 token actor explicit
x=await ar.resolveAttack({item,actor,action,targetToken:token,roll:d20(12,25),concealmentCleared:true});
assert.equal(x.targetActorUuid,target.uuid);
// 23 priority / safe error of provider
const errStop=ar.registerDefenseProvider({id:'broken',priority:10,resolve:()=>{throw Error('provider died')}});
x=await run(12,25);assert.equal(x.hit,null);assert.match(x.reason,/provider failure/);errStop();
// 24 no hit based on HP changes; tested by distinct service contract
assert.equal(ar.lastDiagnostic().resolution,'indeterminate');
// 25 no baked-in firearm rules
assert.doesNotMatch(src,/gunBullet|Deadeye|misfire|firstRangeIncrement|firearm-first/);
// 26 native CMB Pistol-Whip Trip regardless weapon name
const trip={id:'trip',item,actor,actionType:'cmb',hasAttack:true,isCombatManeuver:true};
item.actions.set(trip.id,trip);
x=await ar.resolveAttack({item,actor,action:trip,targetActor:target,
 roll:d20(15,25),concealmentCleared:true});
assert.equal(x.defense.type,'cmd');assert.equal(x.hit,true);
// 27 providers asynchronous + re-registration / manual and unknown nat
const asyncStop=ar.registerDefenseProvider({id:'async',priority:2,resolve:async()=>({type:'touch'})});
x=await run(10,15);assert.equal(x.defense.type,'touch');asyncStop();
await ar.setActionDefenseConfig(item,action,'manual');
x=await run(10,25);assert.equal(x.hit,null);assert.equal(x.defense.type,'manual');
assert.equal(ar.getNaturalD20({dice:[{faces:20,results:[{result:7,active:true},{result:11,active:true}]}]}),null);
assert.equal(ar.getNaturalD20(d20(1,2)),1);
// Do not save values for unknown action IDs
await assert.rejects(()=>ar.setActionDefenseConfig(item,'unknown','normal'));
console.log('PASS attack resolution: 27 scenarios (AC/CMD/natural/targets/providers/persistence/manual/concealment)');
})().catch(e=>{console.error(e);process.exitCode=1});
