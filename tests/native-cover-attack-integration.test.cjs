'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ready=[];
const api={};
const mod={active:true,api};
const target={documentName:'Actor',uuid:'Actor.target',sourceInfo:{},
 system:{attributes:{ac:{
  normal:{total:20},touch:{total:12},flatFooted:{total:18}
 }}},
 getSourceDetails(path){return this.sourceInfo[path]??[]}};
const attacker={documentName:'Actor',uuid:'Actor.attacker'};
const item={documentName:'Item',uuid:'Actor.attacker.Item.bow',actor:attacker};
const action={id:'shoot',item,actor:attacker,actionType:'rwak',hasAttack:true,
 touch:false,isCombatManeuver:false,hasSave:false};
const token={uuid:'Scene.s.Token.t',documentName:'Token',actor:target};
const game={modules:new Map([['pf1-automation-engine',mod]]),
 user:{id:'gm',isGM:true},
 settings:{get:()=>true},i18n:{localize:k=>k}};
const ctx={console,Hooks:{once(n,fn){if(n==='ready')ready.push(fn)},on(){}},
 game,pf1:{config:{maneuverActionTypes:new Set(['cmb'])}},
 foundry:{utils:{deepClone:structuredClone}},
 Map,Set,Object,Promise,Number};
ctx.globalThis=ctx;
vm.createContext(ctx);
for(const name of ['native-cover-provenance.js','attack-resolution.js']){
 vm.runInContext(fs.readFileSync(
  path.resolve(__dirname,'../scripts/'+name),'utf8'),ctx,{filename:name});
}
for(const fn of ready)fn();
const roll={total:23,dice:[{faces:20,results:[{result:14,active:true}]}]};
const cover={status:'confirmed',type:'normal',acBonus:4,source:'pf1-corner-rays'};
const resolve=()=>api.attackResolution.resolveAttack({
 actor:attacker,item,action,targetActor:target,targetToken:token,
 roll,coverAssessment:cover,concealmentCleared:true});
(async()=>{
 let result=await resolve();
 assert.equal(result.defense.baseValue,20);
 assert.equal(result.defense.value,24);
 assert.equal(result.defense.coverBonus,4);
 assert.equal(result.defense.nativeCoverProvenance.nativeCover,0);
 assert.equal(result.hit,false,'23 vs effective AC 24 is a miss');
 assert.equal(target.system.attributes.ac.normal.total,20);
 target.sourceInfo['system.attributes.ac.normal.total']=[
  {name:'Native cover',modifier:'cover',value:4,disabled:false}];
 result=await resolve();
 assert.equal(result.defense.value,20,'native +4 is already in total');
 assert.equal(result.defense.coverBonus,0);
 assert.equal(result.hit,true);
 target.sourceInfo['system.attributes.ac.normal.total']=[
  {name:'Homebrew nontyped bonus',modifier:null,value:4}];
 result=await resolve();
 assert.equal(result.resolution,'indeterminate');
 assert.equal(result.hit,null);
 assert.equal(result.defense.value,null);
 assert.equal(result.defense.nativeCoverProvenance.status,'uncertain');
 target.sourceInfo['system.attributes.ac.normal.total']=[];
 assert.equal((await resolve()).defense.value,24);
 console.log('PASS native cover + attack resolution integration: CA 20+4, already-included cover, unknown native sources, no actor mutation');
})().catch(e=>{console.error(e);process.exitCode=1});
