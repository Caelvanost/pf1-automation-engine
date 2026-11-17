'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.resolve(__dirname,'../scripts/cover-detection.js'),'utf8');
const ready=[];
const pf1aeModule={api:{}};
const game={modules:new Map([['pf1-automation-engine',pf1aeModule]])};
const scene={id:'s',grid:{type:1},walls:{contents:[]},regions:{contents:[]},tiles:{contents:[]}};
const grid={size:100};
const all=[];
function token(id,x,y,{w=1,h=1,z=0,sceneId='s'}={}){
 const t={actor:{uuid:'Actor.'+id},document:{id,uuid:'Scene.s.Token.'+id,
  x:x*100,y:y*100,width:w,height:h,elevation:z,parent:{id:sceneId}}};
 all.push(t);return t;
}
const ctx={console,game,Hooks:{once(_n,f){ready.push(f)}},
 canvas:{scene,grid,tokens:{placeables:all}},
 foundry:{utils:{deepClone:structuredClone}},Object,Math};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'cover-detection.js'});
for(const f of ready)f();
const api=pf1aeModule.api.coverDetection;
const source=token('archer',0,0),target=token('enemy',4,0);
const read=()=>api.inspect({attacker:source,target,attackType:'ranged'});
let result=read();
assert.equal(result.status,'confirmed');
assert.equal(result.type,'none');
assert.equal(result.acBonus,0);
assert.equal(result.reflexBonus,0);
const blocker=token('interposed',2,0);
result=read();
assert.equal(result.status,'uncertain');
assert.equal(result.type,null);
assert.equal(result.interposed.length,1);
blocker.document.y=200;
result=read();assert.equal(result.status,'confirmed');
scene.walls.contents.push({id:'wall'});
result=read();
assert.equal(result.status,'uncertain','never infer total cover from visibility or a wall');
assert.equal(result.acBonus,null);
scene.walls.contents=[];
scene.regions.contents.push({id:'region'});
assert.equal(read().status,'uncertain');
scene.regions.contents=[];
target.document.elevation=3;
assert.equal(read().status,'uncertain');
target.document.elevation=0;
target.document.width=2;
assert.equal(read().status,'uncertain');
target.document.width=1;
for(const [type,ac,ref] of [
 ['none',0,0],['partial',2,1],['normal',4,2],
 ['soft',4,0],['improved',8,4]
]){
 result=api.manual({type,reflexProtected:true});
 assert.equal(result.status,'manual');
 assert.equal(result.acBonus,ac);
 assert.equal(result.reflexBonus,ref);
 if(type==='improved')assert.equal(result.improvedCoverEvasion,true);
 else assert.equal(result.improvedCoverEvasion,false);
}
result=api.manual({type:'improved',reflexProtected:true,spreadBypasses:true});
assert.equal(result.reflexBonus,0,'spread bypasses cover on relevant save');
assert.equal(result.improvedCoverEvasion,false);
result=api.manual({type:'soft',reflexProtected:true});
assert.equal(result.reflexBonus,0,'soft cover never modifies Reflex');
result=api.manual({type:'total'});
assert.equal(result.preventsDirectAttack,true);
assert.equal(result.acBonus,null);
assert.equal(result.reflexBonus,null);
assert.throws(()=>api.manual({type:'concealment'}),/Unsupported/);
assert.equal(Object.isFrozen(result),true);
console.log('PASS cover-detection: conservative open grids, blockers, walls, elevations, all categories, Reflex, spread, improved and total cover');
