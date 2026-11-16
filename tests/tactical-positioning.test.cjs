'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const SOURCE=fs.readFileSync(path.resolve(__dirname,'../scripts/tactical-positioning.js'),'utf8');
const ns='pf1-automation-engine';
const settings=new Map([['genericEnabled',true],['genericDebug',false]]);
const init=[],ready=[];
const modules=new Map([[ns,{active:true,api:{}}]]);
const events=new Map();
const hooks={once(name,callback){(name==='init'?init:ready).push(callback)},
 on(name,callback){const list=events.get(name)??[];list.push(callback);events.set(name,list)}};
const user={id:'player',isGM:false,targets:new Set()};
const game={user,modules,i18n:{lang:'fr'},settings:{
 get(_ns,key){return settings.get(key)},
 register(_ns,key,def){if(!settings.has(key))settings.set(key,def.default)}
}};
const scene={id:'scene',grid:{type:1,units:'ft'}};
const grid={size:100,
 getCenterPoint({i,j}){return {x:(j+.5)*100,y:(i+.5)*100}},
 measurePath([a,b]){return {distance:Math.hypot(b.x-a.x,b.y-a.y)/100*5}}};
const tokens=[];
function actor(id,{reach=5,armed=true,disabled=false}={}){
 return {documentName:'Actor',uuid:'Actor.'+id,
  system:{attributes:{hp:{value:disabled?0:15},reach:{total:reach}}},
  statuses:new Set(),getRollData(){return {range:{melee:reach}}},
  items:{contents:armed?[{type:'weapon',system:{equipped:true},
   actions:{contents:[{actionType:'mwak'}]}}]:[]}};
}
function token(id,col,row,side,opts={}){
 const a=opts.actor??actor(id,opts);
 const w=opts.width??1,h=opts.height??1;
 const d={id,uuid:'Scene.scene.Token.'+id,parent:{id:opts.scene??'scene'},
  x:col*100,y:row*100,width:w,height:h,elevation:opts.elevation??0,
  disposition:side,
  getOccupiedGridSpaceOffsets(){
   const cells=[];
   for(let i=row;i<row+h;i++)for(let j=col;j<col+w;j++)
    cells.push({i,j});
   return cells;
  }};
 const t={id,document:d,actor:a};tokens.push(t);return t;
}
const ctx={console,game,Hooks:hooks,Number,Object,Math,Set,Map,Date,
 structuredClone,canvas:{scene,grid,tokens:{placeables:tokens}},
 pf1:{settings:{distance:{metric:false}}}};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(SOURCE,ctx,{filename:'tactical-positioning.js'});
for(const f of init)f();
for(const f of ready)f();
const api=modules.get(ns).api.tacticalPositioning;
const check=(attacker,target,allies)=>api.checkFlanking({attacker,target,...(allies?{allies}:{})});
const center=token('target',1,1,-1);
const left=token('attacker',0,1,1);
const right=token('ally',2,1,1);
const up=token('upper',1,0,1);
const diagonal=token('diagonal',2,2,1);
(async()=>{
 let value=check(left,center,[right]);
 assert.equal(value.status,'flanking');
 assert.equal(value.flanking,true);
 assert.equal(value.bonus,2);
 assert.equal(value.reason,'opposite-borders');
 assert.equal(value.allies[0],right.document.uuid);
 assert.equal(center.actor.system.attributes.hp.value,15,
  'read-only: actor data is unchanged');
 assert.equal(api.lastDiagnostic().reason,'opposite-borders');
 value=check(left,center,[up]);
 assert.equal(value.status,'not-flanking','adjacent but not opposite fails');
 assert.equal(value.bonus,0);
 value=check(left,center,[left]);
 assert.equal(value.flanking,false,'same token not its own flanking ally');
 // Diagonally opposite corners qualify under PF1 grid flanking.
 const northWest=token('northwest',0,0,1);
 value=check(northWest,center,[diagonal]);
 assert.equal(value.flanking,true,'diagonal opposite corners qualify');
 // An ally may be on the opposite side yet cannot provide a flank when
 // the attacker has no melee attack or sufficient reach.
 left.actor.system.attributes.reach.total=2;
 left.actor.getRollData=()=>({range:{melee:2}});
 value=check(left,center,[right]);
 assert.equal(value.status,'not-flanking');
 assert.equal(value.reason,'attacker-cannot-threaten');
 left.actor.system.attributes.reach.total=5;
 left.actor.getRollData=()=>({range:{melee:5}});
 right.actor.statuses.add('stunned');
 value=check(left,center,[right]);
 assert.equal(value.flanking,false,'stunned ally cannot threaten');
 right.actor.statuses.delete('stunned');
 right.actor.items.contents=[];
 value=check(left,center,[right]);
 assert.equal(value.status,'uncertain',
  'unarmed or unknown threat cannot be inferred');
 assert.equal(value.uncertain[0].reason,'ally-threat-unknown');
 right.actor.items.contents.push({type:'attack',actions:{contents:[{actionType:'mwak'}]}});
 value=check(left,center,[right]);
 assert.equal(value.flanking,true);
 // An attacker and ally must be on the same grid elevation to infer a
 // flank. Different elevations require manual GM decision.
 right.document.elevation=10;
 value=check(left,center,[right]);
 assert.equal(value.status,'uncertain');
 right.document.elevation=0;
 // A Large defender has a rectangular space, not a center square.
 const big=token('large',1,1,-1,{width:2,height:2});
 const bigLeft=token('big-left',0,2,1);
 const bigRight=token('big-right',3,2,1);
 value=check(bigLeft,big,[bigRight]);
 assert.equal(value.flanking,true,'large defender opposite borders');
 value=check(bigLeft,big,[up]);
 assert.equal(value.flanking,false,
  'same side or cross-adjacent position does not flank large target');
 // Native reach can extend to allow a flanking partner at distance.
 const reachAlly=token('reach-ally',3,1,1,{reach:10});
 value=check(left,center,[reachAlly]);
 assert.equal(value.flanking,true,'10 ft natural reach supports distant partner');
 reachAlly.actor.getRollData=()=>({range:{melee:5}});
 value=check(left,center,[reachAlly]);
 assert.equal(value.flanking,false,'out-of-reach ally fails');
 // The API never guesses on unsupported grids, faction ambiguity or
 // missing native grid measurement.
 scene.grid.type=2;
 value=check(left,center,[right]);
 assert.equal(value.status,'uncertain');
 assert.equal(value.reason,'unsupported-grid');
 scene.grid.type=1;
 const oldMeasure=grid.measurePath;
 grid.measurePath=null;
 value=check(left,center,[right]);
 assert.equal(value.status,'uncertain','unavailable path is not a no-flank proof');
 grid.measurePath=oldMeasure;
 center.document.disposition=0;
 value=check(left,center,[right]);
 assert.equal(value.status,'uncertain');
 center.document.disposition=-1;
 right.document.parent.id='different-scene';
 value=check(left,center,[right]);
 assert.equal(value.flanking,false,'off-scene ally is ignored');
 right.document.parent.id='scene';
 settings.set('tacticalPositioningEnabled',false);
 value=check(left,center,[right]);
 assert.equal(value.status,'uncertain');
 assert.equal(value.reason,'service-disabled');
 settings.set('tacticalPositioningEnabled',true);
 // The scan automatically includes independent local friendly tokens
 // but must never count friendly tokens on the wrong side.
 const otherSide=token('enemy-ally',2,1,-1);
 value=check(left,center);
 assert.equal(value.flanking,true);
 assert.equal(value.allies.includes(otherSide.document.uuid),false);
 assert.equal(Object.isFrozen(value),true);
 assert.equal(Object.isFrozen(value.allies),true);
 assert.equal(game.settings.get(ns,'tacticalPositioningEnabled'),true);
 // Native PF1 AttackDialog has a Flanking checkbox driven by the
 // ActionUse's shared.useOptions.flanking (used by Roll Bonuses as well).
 // PF1AE must preselect it, NOT inject a second attack bonus.
 const nativeItem={documentName:'Item',uuid:left.actor.uuid+'.Item.sword',
  actor:left.actor};
 const meleeAction={actionType:'mwak',hasAttack:true,item:nativeItem};
 const makeUse=(options={flanking:false},action=meleeAction)=>({
  actor:left.actor,item:nativeItem,action,token:left,
  shared:{useOptions:options,attackBonus:['1[Other feat bonus]']}
 });
 user.targets=new Set([center]);
 let use=makeUse();
 const precheckHook=events.get('pf1CreateActionUse')?.[0];
 assert.equal(typeof precheckHook,'function','register native ActionUse creation hook');
 precheckHook(use);
 assert.equal(use.shared.useOptions.flanking,true,
  'verified flank prechecks the native PF1 checkbox even when default false');
 assert.deepEqual(Array.from(use.shared.attackBonus),['1[Other feat bonus]'],
  'no extra +2 inserted; native system owns the attack formula');
 assert.equal(api.precheck(use),false,'do not touch an already checked option');
 use=makeUse();
 user.targets=new Set([center,otherSide]);
 precheckHook(use);
 assert.equal(use.shared.useOptions.flanking,false,
  'no precheck with multiple targets');
 user.targets=new Set([center]);
 use=makeUse();
 right.actor.items.contents=[];
 // Alternative eligible allies (northwest+diagonal) still exist in world,
 // so isolate the explicit list via temporary off-scene dispositions.
 for(const t of tokens)if(![left,center,right].includes(t))
  t.document.disposition=0;
 precheckHook(use);
 assert.equal(use.shared.useOptions.flanking,false,
  'uncertain threat must not check the native option');
 right.actor.items.contents.push({type:'attack',actions:{contents:[{actionType:'mwak'}]}});
 for(const t of tokens)if(![left,center,right].includes(t))
  t.document.disposition=t===otherSide?-1:1;
 use=makeUse({flanking:false},{actionType:'rwak',hasAttack:true,item:nativeItem});
 precheckHook(use);
 assert.equal(use.shared.useOptions.flanking,false,
  'never precheck melee flanking for a ranged attack');
 use=makeUse();
 settings.set('tacticalPositioningEnabled',false);
 precheckHook(use);
 assert.equal(use.shared.useOptions.flanking,false,
  'disabled detection must not alter native attack options');
 settings.set('tacticalPositioningEnabled',true);
 // Player explicitly unchecks the preselected option in the subsequent
 // native dialog; PF1AE doesn't intercept or reinstate it during rolling.
 use=makeUse();
 precheckHook(use);
 use.shared.useOptions.flanking=false;
 assert.equal(use.shared.useOptions.flanking,false,
  'user remains able to uncheck the native option');
 console.log('PASS tactical-positioning: PF1 geometry, corners, large targets, reach, uncertainty, native checkbox preselection');
})().catch(error=>{console.error(error);process.exitCode=1});
