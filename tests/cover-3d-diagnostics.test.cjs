'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.resolve(__dirname,'../scripts/cover-3d-diagnostics.js'),'utf8');
const ready=[];
const pf1ae={active:true,version:'1.35.0',api:{}};
const wallHeight={active:true,version:'7.0.8'};
const levels={active:true,version:'6.1.0'};
const betterRoofs={active:true,version:'3.0.0'};
const modules=new Map([
 ['pf1-automation-engine',pf1ae],
 ['wall-height',wallHeight],['levels',levels],['betterroofs',betterRoofs]
]);
const walls={contents:[{id:'wall-1',uuid:'Scene.s.Wall.wall-1',
 flags:{'wall-height':{bottom:0,top:5}},door:1,ds:0,move:1}]};
const tiles={contents:[{id:'roof',uuid:'Scene.s.Tile.roof',elevation:10,
 overhead:true,flags:{betterroofs:{brMode:1},levels:{rangeTop:15}}}]};
const regions={contents:[]};
const scene={id:'s',grid:{type:1},walls,tiles,regions};
const collisionCalls=[];
let response={x:200,y:100,z:5};
const LEVELS={API:{testCollision(a,b,type){
 collisionCalls.push({a,b,type});return response;
}}};
function token(id,x,y,z,{w=1,h=1,losHeight=z+5}={}){
 return {document:{id,uuid:'Scene.s.Token.'+id,parent:{id:'s'},
 x,y,width:w,height:h,elevation:z},losHeight};
}
const attacker=token('attacker',0,0,0);
const target=token('target',300,0,0);
const game={modules};
const ctx={console,game,Hooks:{once(_name,fn){ready.push(fn)}},
 canvas:{scene,grid:{size:100}},CONFIG:{Levels:LEVELS},
 foundry:{utils:{deepClone:structuredClone}},Object,Math,Number};
ctx.globalThis=ctx;
vm.createContext(ctx);
vm.runInContext(script,ctx,{filename:'cover-3d-diagnostics.js'});
for(const f of ready)f();
const api=pf1ae.api.cover3D;
assert.equal(typeof api.inspect,'function');
assert.equal(api.integrations().length,3);
assert.equal(api.integrations().every(x=>x.exactVersion),true);
let result=api.inspect({attacker,target});
assert.equal(result.status,'collision-detected');
assert.equal(result.authoritative,false);
assert.equal(result.coverType,null);
assert.equal(result.acBonus,null);
assert.equal(result.reflexBonus,null);
assert.equal(result.rays.length,16,'four source corners x four target corners');
assert.equal(result.counts.collision,16);
assert.equal(collisionCalls.length,16);
assert.equal(collisionCalls.every(x=>x.type==='collision'),true,'Levels collision, never sight');
assert.equal(result.rays.every(x=>x.from.z===5&&x.to.z===5),true);
assert.equal(result.walls[0].bounds.bottom,0);
assert.equal(result.walls[0].bounds.top,5);
assert.equal(result.tiles[0].betterRoofsMode,1);
assert.equal(result.warnings.includes('roof-occlusion-is-not-proof-of-solid-cover'),true);
assert.equal(api.lastDiagnostic().rays.length,16);
response=false;
result=api.inspect({attacker,target});
assert.equal(result.status,'sampled-clear');
assert.equal(result.counts.clear,16);
assert.equal(result.authoritative,false,
 'no native bonus even if all diagnostic rays appear clear');
response=true;
result=api.inspect({attacker,target});
assert.equal(result.status,'uncertain');
assert.equal(result.counts.unknown,16,
 'boolean Levels hit is not an authoritative collision point');
response={x:20,y:10,z:2};
target.document.width=2;target.document.height=3;
result=api.inspect({attacker,target});
assert.equal(result.rays.length,16,'large and rectangular tokens remain diagnostic only');
assert.equal(result.target.width,200);
assert.equal(result.target.height,300);
target.document.width=1;target.document.height=1;
response=false;
const missingHeight=token('unknown-height',300,0,0,{losHeight:null});
result=api.inspect({attacker,target:missingHeight});
assert.equal(result.status,'sampled-clear');
assert.equal(result.warnings.includes('physical-token-height-unverified'),true);
levels.active=false;
result=api.inspect({attacker,target});
assert.equal(result.status,'uncertain');
assert.equal(result.rays[0].state,'unavailable');
assert.equal(result.warnings.includes('levels-module-inactive'),true);
levels.active=true;
levels.version='6.2.0';
result=api.inspect({attacker,target});
assert.equal(result.warnings.includes('untested-levels-version'),true);
levels.version='6.1.0';
const oldFn=LEVELS.API.testCollision;
LEVELS.API.testCollision=()=>{throw new Error('collision unavailable')};
result=api.inspect({attacker,target});
assert.equal(result.status,'uncertain');
assert.equal(result.rays[0].state,'error');
LEVELS.API.testCollision=oldFn;
tiles.contents.push({id:'no-collision',elevation:0,
 flags:{levels:{noCollision:true}}});
result=api.inspect({attacker,target});
assert.equal(result.warnings.includes('some-tiles-exempt-from-levels-collision'),true);
tiles.contents.pop();
regions.contents.push({id:'region-1'});
result=api.inspect({attacker,target});
assert.equal(result.warnings.includes('region-physics-not-classified'),true);
regions.contents.pop();
result=api.inspect({attacker,target,rayLimit:65});
assert.equal(result.status,'impossible');
assert.equal(result.reason,'invalid-ray-limit');
result=api.inspect({attacker,target,scene:{id:'other'}});
assert.equal(result.status,'impossible');
assert.equal(result.reason,'scene-not-current');
const before=JSON.stringify({walls:walls.contents,tiles:tiles.contents});
api.inspect({attacker,target});
assert.equal(JSON.stringify({walls:walls.contents,tiles:tiles.contents}),before,
 'pure read-only scene inspection');
console.log('PASS cover-3d diagnostics: versions, 3D corner rays, Levels collision, Wall Height, Better Roofs, uncertainties, no bonus writes');
