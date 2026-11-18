'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const settings=new Map([['genericEnabled',true],['genericDebug',false]]);
const hooks=new Map(),ready=[],init=[];
const mod={active:true,api:{}};
const scene={id:'s',grid:{type:1,units:'m',distance:1.5}};
const grid={size:100,measurePath([a,b]){
 return {distance:Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y))/100*1.5};
}};
const actor={uuid:'Actor.a',statuses:new Set(),getActiveTokens(){return [attacker]}};
const enemy={uuid:'Actor.b'};
function makeToken(id,x,elevation,who){
 const document={uuid:'Scene.s.Token.'+id,parent:{id:'s'},
  x,y:0,width:1,height:1,elevation,flags:{}};
 return {document,actor:who};
}
const attacker=makeToken('a',0,1.5,actor);
const target=makeToken('b',100,0,enemy);
const action={actionType:'mwak',hasAttack:true,isCombatManeuver:false,
 getRange({type}){return type==='max'?1.5:0}};
const item={actor,documentName:'Item'};
const world={modules:new Map([['pf1-automation-engine',mod]]),
 user:{targets:new Set([target])},settings:{
 get(_ns,key){return settings.get(key)},
 register(_ns,key,config){if(!settings.has(key))settings.set(key,config.default)}
}};
const ctx={console,game:world,canvas:{scene,grid},Hooks:{
 once(name,cb){(name==='init'?init:ready).push(cb)},
 on(name,cb){hooks.set(name,cb)}},
 Set,Map,WeakSet,Object,Number,Math};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.resolve(__dirname,
 '../scripts/high-ground.js'),'utf8'),ctx,{filename:'high-ground.js'});
init.forEach(fn=>fn());ready.forEach(fn=>fn());
const api=mod.api.highGround;
const use=()=>({action,actor,item,token:attacker,
 shared:{targets:[target],attackBonus:[],useOptions:{}}});
settings.set('autoHighGround',true);
let u=use(),r=api.inspectActionUse(u);
assert.equal(r.status,'uncertain','elevation alone does not prove a platform');
assert.equal(r.reason,'terrain-support-not-confirmed');
hooks.get('pf1CreateActionUse')(u);
assert.equal(u.shared.attackBonus.length,0,'unconfirmed terrain injects no bonus');
// Trusted Table Mode is the GM's world opt-in and bypasses only the
// per-token terrain confirmation; no other melee eligibility check.
settings.set('trustedTableMode',true);
u=use();
r=api.inspectActionUse(u);
assert.equal(r.status,'confirmed',
 'trusted table allows supported-height detection without token flag');
hooks.get('pf1CreateActionUse')(u);
assert.deepEqual(Array.from(u.shared.attackBonus),['1[PF1AE Higher Ground]'],
 'trusted-table mode permits one native +1 attack part');
attacker.actor.statuses.add('flying');
assert.equal(api.inspectActionUse(use()).reason,'airborne-attacker',
 'trusted table cannot bypass airborne safeguard');
attacker.actor.statuses.clear();
target.document.x=200;
assert.equal(api.inspectActionUse(use()).reason,'melee-target-out-of-reach',
 'trusted table cannot bypass reach');
target.document.x=100;
settings.set('trustedTableMode',false);
assert.equal(api.inspectActionUse(use()).reason,'terrain-support-not-confirmed',
 'disabling trusted table restores GM confirmation requirement');
attacker.document.flags['pf1-automation-engine']={highGroundSupported:true};
u=use();r=api.inspectActionUse(u);
assert.equal(r.status,'confirmed');
assert.equal(r.bonus,1);
hooks.get('pf1CreateActionUse')(u);
assert.deepEqual(Array.from(u.shared.attackBonus),['1[PF1AE Higher Ground]']);
hooks.get('pf1CreateActionUse')(u);
assert.equal(u.shared.attackBonus.length,1,'idempotent registration');
u=use();u.shared.attackBonus.push('1[Higher Ground]');
hooks.get('pf1CreateActionUse')(u);
assert.equal(u.shared.attackBonus.length,1,'no duplicate with native/other module');
u=use();u.shared.useOptions.highGround=true;
hooks.get('pf1CreateActionUse')(u);
assert.equal(u.shared.attackBonus.length,0,'native checked option wins');
u=use();attacker.document.elevation=0;
assert.equal(api.inspectActionUse(u).status,'not-elevated');
hooks.get('pf1CreateActionUse')(u);
assert.equal(u.shared.attackBonus.length,0);
attacker.document.elevation=1.5;
target.document.elevation=3;
assert.equal(api.inspectActionUse(use()).status,'not-elevated',
 'lower attacker receives no high-ground bonus');
target.document.elevation=0;
attacker.actor.statuses.add('flying');
assert.equal(api.inspectActionUse(use()).status,'uncertain');
attacker.actor.statuses.clear();
attacker.document.elevation=3;
assert.equal(api.inspectActionUse(use()).reason,'vertical-separation-too-large');
attacker.document.elevation=1.5;
target.document.x=200;
assert.equal(api.inspectActionUse(use()).reason,'melee-target-out-of-reach');
target.document.x=100;
action.actionType='rwak';
assert.equal(api.inspectActionUse(use()).status,'skipped');
action.actionType='mwak';
settings.set('highGroundRequireSupport',false);
attacker.document.flags['pf1-automation-engine'].highGroundSupported=false;
assert.equal(api.inspectActionUse(use()).status,'confirmed',
 'GM may explicitly opt into elevation-only mode');
settings.set('autoHighGround',false);
assert.equal(api.inspectActionUse(use()).status,'skipped');
console.log('PASS high-ground: trusted table bypasses token confirmation only, metric melee +1, no stacking, airborne and reach safety');
