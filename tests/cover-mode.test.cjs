'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const registered=new Map(),init=[],ready=[];
const pf1ae={active:true,version:'1.36.0',api:{}};
const levels={active:true,version:'6.1.0'};
const wallHeight={active:true,version:'7.0.8'};
const betterRoofs={active:true,version:'3.0.0'};
const modules=new Map([['pf1-automation-engine',pf1ae],
 ['levels',levels],['wall-height',wallHeight],['betterroofs',betterRoofs]]);
const scene={id:'test',grid:{type:1},walls:{contents:[]},
 tiles:{contents:[]},regions:{contents:[]}};
let mode='2d',calls=0,collision=false;
const game={modules,settings:{
 register(_ns,key,config){registered.set(key,config)},
 get(_ns,key){return key==='coverGeometryMode'?mode:null}
}};
const ctx={console,game,foundry:{utils:{deepClone:structuredClone}},
 Hooks:{once(name,fn){(name==='init'?init:ready).push(fn)}},
 canvas:{scene,grid:{size:100},tokens:{placeables:[]}},
 CONFIG:{Levels:{API:{testCollision(){calls++;return collision}}}},
 Object,Number,Set,Map,Math};
ctx.globalThis=ctx;
vm.createContext(ctx);
for(const file of ['cover-mode.js','cover-pf1-rules.js']){
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../scripts/'+file),'utf8'),
  ctx,{filename:file});
}
for(const fn of init)fn();
for(const fn of ready)fn();
const settings=registered.get('coverGeometryMode');
assert.ok(settings);
assert.equal(settings.scope,'world');
assert.equal(settings.default,'2d');
assert.equal(settings.config,true);
assert.deepEqual(Object.keys(settings.choices),['2d','3d']);
const selected=pf1ae.api.coverMode,cover=pf1ae.api.coverPF1;
const token=(id,x,z=0)=>({document:{id,uuid:'Scene.test.Token.'+id,
 parent:{id:'test'},x,y:0,width:1,height:1,elevation:z},losHeight:z+5});
const attacker=token('a',0,0),target=token('b',300,10);
const inspect=()=>cover.inspect({attacker,target,attackType:'ranged'});
assert.equal(selected.get(),'2d');
assert.equal(selected.inspect().ready,true);
// Default 2D disregards both elevation and wall-height: wall geometry only.
scene.walls.contents.push({id:'wall',uuid:'Scene.test.Wall.w',
 c:[200,-100,200,150],move:1,door:0,ds:0,
 flags:{'wall-height':{bottom:100,top:110}}});
let r=inspect();
assert.equal(r.mode,'2d');
assert.equal(r.type,'total');
assert.equal(r.preventsDirectAttack,true);
assert.equal(calls,0,'2D never accesses Levels collision API');
scene.walls.contents.length=0;
scene.tiles.contents.push({id:'roof',overhead:true,flags:{betterroofs:{brMode:1}}});
r=inspect();
assert.equal(r.status,'confirmed','2D ignores overlaid/occlusion-only roof tiles');
assert.equal(r.type,'none');
assert.equal(r.mode,'2d');
assert.equal(calls,0);
scene.tiles.contents.length=0;
mode='3d';
assert.equal(selected.inspect().ready,true);
r=inspect();
assert.equal(r.status,'confirmed');
assert.equal(r.mode,'3d');
assert.ok(calls>0,'3D evaluates Levels collision samples');
collision={x:150,y:20,z:7};
r=inspect();
assert.equal(r.status,'uncertain','3D floor hit requires GM adjudication');
calls=0;
levels.active=false;
assert.equal(selected.inspect().ready,false);
r=inspect();
assert.equal(r.status,'uncertain');
assert.equal(r.reason,'3d-integration-unavailable');
assert.equal(r.providerReasons.includes('levels-inactive'),true);
assert.equal(calls,0,'no collisions with absent provider');
levels.active=true;
levels.version='6.2.0';
assert.equal(selected.inspect().ready,false);
assert.equal(selected.inspect().reasons.includes('levels-version-not-validated'),true);
levels.version='6.1.0';
wallHeight.active=false;
assert.equal(selected.inspect().ready,false);
wallHeight.active=true;
betterRoofs.active=false;
assert.equal(selected.inspect().ready,true,'Better Roofs optional');
betterRoofs.active=true;
mode='corrupt';
assert.equal(selected.get(),'2d','unsupported persisted setting fails back to 2D');
assert.equal(inspect().mode,'2d');
console.log('PASS cover modes: default world 2D, height/roof independent; optional exact-version 3D, unavailable fail closed');
