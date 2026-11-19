'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const settings=new Map([['genericEnabled',true],['genericDebug',false]]);
const hooks=new Map(),init=[],ready=[];
const mod={active:true,api:{}};
const scene={id:'s',grid:{type:1,units:'m',distance:1.5}};
const grid={size:100,measurePath([a,b]){
 return {distance:Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y))/100*1.5}
}};
const actor={uuid:'Actor.a',getActiveTokens(){return [attacker]}};
const enemy={uuid:'Actor.b'};
function token(id,x,elevation,who){
 const document={uuid:'Scene.s.Token.'+id,parent:{id:'s'},
  x,y:0,width:1,height:1,elevation};
 return {document,actor:who};
}
const attacker=token('a',0,1.5,actor),target=token('b',100,0,enemy);
const action={actionType:'mwak',hasAttack:true,isCombatManeuver:false,
 getRange({type}){return type==='max'?1.5:0}};
const world={modules:new Map([['pf1-automation-engine',mod]]),
 user:{targets:new Set([target])},settings:{
 get(_ns,key){return settings.get(key)},
 register(_ns,key,v){if(!settings.has(key))settings.set(key,v.default)}
}};
const ctx={console,game:world,canvas:{scene,grid},Hooks:{
 once(name,fn){(name==='init'?init:ready).push(fn)},
 on(name,fn){hooks.set(name,fn)}},Set,Map,WeakSet,Object,Number,Math};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.resolve(__dirname,
 '../scripts/high-ground.js'),'utf8'),ctx,{filename:'high-ground.js'});
init.forEach(fn=>fn());ready.forEach(fn=>fn());
settings.set('autoHighGround',true);
const api=mod.api.highGround;
const use=()=>({action,actor,token:attacker,shared:{
 targets:[target],attackBonus:[],useOptions:{}
}});
const checkbox=({label='Position surélevée',checked=false,disabled=false}={})=>{
 const input={checked,disabled,id:'higher-ground',clicks:0,
  getAttribute(key){return key==='name'?'flags.higherGround':key==='id'?'higher-ground':null},
  closest(key){return key==='label'?{textContent:label}:null},
  click(){this.clicks++;this.checked=!this.checked}};
 const root={querySelectorAll(query){
  if(query==='input[type="checkbox"]')return [input];
  if(query==='label[for]')return [];
  return [];
 }};
 return {root,input};
};
const render=hooks.get('renderAttackDialog');
assert.equal(typeof render,'function','native attack dialog render hook registered');
let a=use(),d=checkbox(),app={actionUse:a};
assert.equal(api.inspectActionUse(a).status,'eligible');
render(app,d.root);
assert.equal(d.input.checked,true,'native higher-ground checkbox prechecked');
assert.equal(d.input.clicks,1,'native checkbox clicked instead of adding a bonus');
assert.deepEqual(Array.from(a.shared.attackBonus),[],
 'PF1AE must never inject a +1 attack modifier');
render(app,d.root);
assert.equal(d.input.clicks,1,'idempotent on dialog rerender');
// Native checkbox remains manually editable after preselection.
d.input.click();
assert.equal(d.input.checked,false,'player can uncheck without PF1AE restoring it');
render(app,d.root);
assert.equal(d.input.checked,false,'manual correction persists on rerender');
// Native prechecked states must not be toggled off.
a=use();d=checkbox({checked:true});render({actionUse:a},d.root);
assert.equal(d.input.checked,true);
assert.equal(d.input.clicks,0,'existing checked state left unchanged');
a=use();d=checkbox({label:'Something else'});
render({actionUse:a},d.root);
assert.equal(d.input.checked,true,
 'a real native higherGround field is recognized even with translated label');
// No +1 even for trusted world mode: there is NO confirmation logic.
settings.set('trustedTableMode',true);
assert.equal(api.inspectActionUse(use()).status,'eligible');
settings.set('trustedTableMode',false);
assert.equal(api.inspectActionUse(use()).status,'eligible');
settings.set('highGroundRequireSupport',true);
assert.equal(api.inspectActionUse(use()).status,'eligible',
 'legacy support setting is intentionally ignored');
settings.set('highGroundRequireSupport',false);
// No false positive for level or lower attackers, ranged and out of reach.
attacker.document.elevation=0;
a=use();d=checkbox();render({actionUse:a},d.root);
assert.equal(d.input.checked,false);
attacker.document.elevation=1.5;target.document.elevation=3;
assert.equal(api.inspectActionUse(use()).status,'not-elevated');
target.document.elevation=0;
target.document.x=200;
a=use();d=checkbox();render({actionUse:a},d.root);
assert.equal(api.inspectActionUse(a).status,'out-of-reach');
assert.equal(d.input.checked,false);
target.document.x=100;action.actionType='rwak';
a=use();d=checkbox();render({actionUse:a},d.root);
assert.equal(d.input.checked,false,'ranged cannot precheck melee higher ground');
action.actionType='mwak';
// No checkbox found -> fail open, never any bonus.
a=use();d=checkbox();d.input.getAttribute=()=>null;d.input.id=null;
d.input.closest=()=>({textContent:'Other modifier'});
render({actionUse:a},d.root);
assert.equal(d.input.checked,false);
assert.equal(api.lastDiagnostic().reason,'native-higher-ground-checkbox-not-found');
settings.set('autoHighGround',false);
assert.equal(api.inspectActionUse(use()).status,'skipped');
console.log('PASS high-ground: native checkbox only, editable, no +1, no GM flag, metric reach, no invalid precheck');
