'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.resolve(__dirname,'../scripts/cover-pf1-rules.js'),'utf8');
const ready=[];
const mod={api:{},active:true};
const modules=new Map([['pf1-automation-engine',mod]]);
const scene={id:'s',grid:{type:1},walls:{contents:[]},
 tiles:{contents:[]},regions:{contents:[]}};
const all=[];
const game={modules};
const ctx={console,game,Hooks:{once(_name,fn){ready.push(fn)}},
 canvas:{scene,grid:{size:100},tokens:{placeables:all}},
 foundry:{utils:{deepClone:structuredClone}},Object,Math,Set,Map,Number};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'cover-pf1-rules.js'});
for(const fn of ready)fn();
const api=mod.api.coverPF1;
const make=(id,x,y,{z=0,w=1,h=1,los=5}={})=>{
 const token={document:{id,uuid:'Scene.s.Token.'+id,parent:{id:'s'},
  x,y,width:w,height:h,elevation:z},losHeight:los};
 all.push(token);return token;
};
const attacker=make('attacker',0,0),target=make('target',300,0);
const check=(options={})=>api.inspect({attacker,target,...options});
let result=check();
assert.equal(result.status,'confirmed','empty known scene should have no cover');
assert.equal(result.type,'none');
assert.equal(result.acBonus,0);
assert.equal(result.origins.length,4);
assert.equal(result.origins.every(x=>x.traces.length===4),true);
assert.equal(api.lastDiagnostic().type,'none');
const wall=(id,x1,y1,x2,y2,{bottom=0,top=10,move=1,door=0,ds=0}={})=>({
 id,uuid:'Scene.s.Wall.'+id,c:[x1,y1,x2,y2],
 flags:{'wall-height':{bottom,top}},move,door,ds
});
scene.walls.contents.push(wall('full',200,-200,200,300));
result=check();
assert.equal(result.status,'uncertain','complete wall may block line of effect');
assert.equal(result.reason,'possible-total-cover');
scene.walls.contents.length=0;
scene.walls.contents.push(wall('partial',200,25,200,120));
result=check();
assert.equal(result.status,'confirmed','partial wall may protect only part of target');
assert.equal(result.type,'normal');
assert.equal(result.acBonus,4);
assert.equal(result.reflexBonus,2);
scene.walls.contents[0].flags['wall-height'].top=2;
result=check();
assert.equal(result.status,'confirmed');
assert.equal(result.type,'none','low wall below sample height cannot cover high ray');
scene.walls.contents[0].flags['wall-height'].top=10;
scene.walls.contents[0].door=1;
scene.walls.contents[0].ds=1;
result=check();
assert.equal(result.status,'confirmed');
assert.equal(result.type,'none','open door should not block');
scene.walls.contents[0].ds=0;
result=check();
assert.equal(result.type,'normal','closed door restores cover');
scene.walls.contents[0].move=0;
result=check();
assert.equal(result.status,'uncertain','passable wall may still represent a physical obstacle');
scene.walls.contents.length=0;
// Unknown provenance and vertical geometry must never grant +4 automatically.
target.document.elevation=10;
result=check();
assert.equal(result.status,'uncertain');
assert.equal(result.type,null);
target.document.elevation=0;
target.document.width=2;
assert.equal(check().status,'uncertain','Large defenders need full occupied square rules');
target.document.width=1;
scene.tiles.contents.push({id:'roof',overhead:true,flags:{betterroofs:{brMode:1}}});
assert.equal(check().status,'uncertain','roof visibility is not proof of a solid floor');
scene.tiles.contents.length=0;
scene.regions.contents.push({id:'untyped-region'});
assert.equal(check().status,'uncertain');
scene.regions.contents.length=0;
attacker.losHeight=undefined;
result=check();
assert.equal(result.status,'uncertain','unknown projectile height must fail closed');
attacker.losHeight=5;
target.losHeight=6;
result=check();
assert.equal(result.status,'uncertain','different sampled projectile elevations not inferred');
target.losHeight=5;
// Ranged and reach use the same selected-corner cover algorithm.
result=check({attackType:'reach'});
assert.equal(result.type,'none');
result=check({attackType:'melee'});
assert.equal(result.type,'none');
result=check({attackType:'ranged',projectileHeight:5});
assert.equal(result.type,'none');
// This engine only computes candidate defense adjustments; it must never
// write source documents or resolve any roll itself.
const snapshot=JSON.stringify(scene);
api.inspect({attacker,target});
assert.equal(JSON.stringify(scene),snapshot);
assert.equal(Object.isFrozen(result),false,'return safe clones to callers');
console.log('PASS cover PF1: corner selection, partial/total ambiguity, wall height, doors, reach, elevation, roof safety, no writes');
