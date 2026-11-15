'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const code=fs.readFileSync(path.resolve(__dirname,'../scripts/bleed.js'),'utf8');
const NS='pf1-automation-engine';
const users=[{id:'gm-a',isGM:true,active:true},{id:'gm-b',isGM:true,active:true},{id:'player',isGM:false,active:true}];
users.get=id=>users.find(u=>u.id===id);
const rows=new Map([['genericEnabled',true],['genericDebug',false],['bleedTurnReceipts',[]]]);
const actors=[],combatants=[],emitted=[];
let sequence=0;
function createActor(name,{playerOwned=false,synth=false}={}){
 const actor={uuid:(synth?'Scene.scene.Token.t.Actor.':'Actor.')+name,documentName:'Actor',
  name,system:{attributes:{hp:{value:30,max:30,temp:0}}},items:{contents:[]},
  applied:[],
  testUserPermission(user,perm){return perm==='OWNER'&&playerOwned&&user.id==='player'},
  async applyDamage(value){
   this.applied.push(value);
   const hp=this.system.attributes.hp;
   const fromTemp=Math.min(hp.temp,value);hp.temp-=fromTemp;
   hp.value-=value-fromTemp;
   return this;
  }};
 actors.push(actor);return actor;
}
function buff(actor,name,formula,active=true){
 const item={uuid:actor.uuid+'.Item.'+name,documentName:'Item',type:'buff',
  actor,system:{active},activeState:active,flags:{},
  getFlag(ns,key){return this.flags[ns]?.[key]},
  async setFlag(ns,key,value){this.flags[ns]??={};this.flags[ns][key]=structuredClone(value);return this;},
  testUserPermission(user,perm){return perm==='OWNER'&&actor.testUserPermission(user,perm)},
  scriptCalls:{contents:[]}};
 actor.items.contents.push(item);
 return item;
}
function script(actor,id,name,fn){
 const item=buff(actor,'ability-'+id,'0');
 item.system.active=false;
 item.flags={};
 const call={id,category:'postUse',name,execute:fn,
  _source:{script:'// '+id}};
 item.scriptCalls.contents=[call];
 return {item,call};
}
const dice={};
const mockRoll=class Roll {
 constructor(formula){
  if(typeof formula!=='string'||!/^\d+(?:d\d+)?$/.test(formula))
   throw Error('Unsupported test formula');
  this.formula=formula;
 }
 async evaluate(){
  this.total=this.formula.includes('d')?
   (dice[this.formula]?.shift()??1):Number(this.formula);
  return this;
 }
};
function makeClient(user){
 const once=new Map(),hooks=new Map(),mod={active:true,api:{}};
 const ctx={};
 const on=(kind,name,fn)=>{(kind.get(name)??kind.set(name,[]).get(name)).push(fn)};
 const game={user,users,modules:new Map([[NS,mod]]),
  settings:{get(_ns,k){return structuredClone(rows.get(k))},
   register(_ns,k,{default:value}){if(!rows.has(k))rows.set(k,structuredClone(value))},
   async set(_ns,k,value){rows.set(k,structuredClone(value));return value}}};
 mod.api.scriptApprovals={check(actor,item,call){
  return {approved:!!call._approved,reason:'Unapproved'};
 }};
 const hooksApi={once(name,fn){on(once,name,fn)},on(name,fn){on(hooks,name,fn)},
  callAll(name,ev){emitted.push({name,ev})}};
 Object.assign(ctx,{game,Hooks:hooksApi,console,
  foundry:{utils:{deepClone:structuredClone}},Roll:mockRoll,Promise,Date,
  Object,Map,Set});
 ctx.globalThis=ctx;
 vm.createContext(ctx);
 vm.runInContext(code,ctx,{filename:'bleed.js'});
 for(const fn of once.get('init')??[])fn();
 for(const fn of once.get('ready')??[])fn();
 const instance={game,ctx,mod,hooks,fire:(combat,change)=>Promise.all((hooks.get('updateCombat')??[]).map(fn=>fn(combat,change)))};
 return instance;
}
const gm=makeClient(users[0]),gm2=makeClient(users[1]);
const api=gm.mod.api.bleed,second=gm2.mod.api.bleed;
let num=0;
function combat(actor,{round=1,id='combat',started=true}={}){
 const combatant={id:'combatant-'+(++num),actor};
 const c={id,round,turn:0,started,combatant};
 return c;
}
const cfg=async (effect,formula,stacking='highest')=>api.configure({effect,formula,stacking});
async function hit(c){return api.process(c)}
(async()=>{
 const a=createActor('a'),b=createActor('b',{playerOwned:true}),c=createActor('c',{synth:true});
 const first=buff(a,'fixed','3');
 await cfg(first,'3');
 assert.equal(api.isBleed(first),true);
 assert.equal(api.list(a).length,1);
 assert.equal((await hit(combat(a))).amount,3);
 assert.equal(a.applied.at(-1),3);
 assert.equal(a.system.attributes.hp.value,27);
 const aCombat=combat(a,{round:2});
 const variable=buff(a,'variable','1d4');
 await cfg(variable,'1d4');
 dice['1d4']=[4,1];
 const r=await hit(aCombat);
 assert.equal(r.amount,4,'highest rolled bleed wins this turn');
 assert.equal(r.effectUuid,variable.uuid);
 assert.equal(a.applied.length,2,'only one HP damage application per turn');
 aCombat.round=3;
 const next=await hit(aCombat);
 assert.equal(next.amount,3,'fixed 3 beats later random 1');
 const reducer=script(a,'reducer','PF1AE:bleed:before',async (_shared,{event})=>{
  assert.equal(event.type,'bleed:before');
  event.reduce(2);
 });
 reducer.call._approved=true;
 const a4=combat(a,{round:4});
 assert.equal((await hit(a4)).amount,1,'partial reduction');
 const negator=script(a,'negator','PF1AE:bleed:before',async (_shared,{event})=>event.negate());
 negator.call._approved=true;
 assert.equal((await hit(combat(a,{round:5}))).amount,0,'full negation');
 assert.equal(a.applied.length,4,'zero should not mutate HP');
 a.items.contents=a.items.contents.filter(x=>x!==negator.item);
 const excessive=script(a,'excess','PF1AE:bleed:before',async (_shared,{event})=>event.reduce(999));
 excessive.call._approved=true;
 assert.equal((await hit(combat(a,{round:6}))).amount,0,'reductions clamp at zero');
 assert.equal(a.applied.length,4);
 a.items.contents=a.items.contents.filter(x=>x!==reducer.item&&x!==excessive.item);
 const bBleed=buff(b,'b-bleed','2');
 await cfg(bBleed,'2');
 // A player's unapproved Script Call is ignored rather than run as GM.
 let unapprovedCalls=0;
 const unapproved=script(b,'unapproved','PF1AE:bleed:before',async()=>{unapprovedCalls++});
 const bc=combat(b,{round:1,id:'combat-b'});
 assert.equal((await hit(bc)).amount,2);
 assert.equal(unapprovedCalls,0,'player-owned Script Call without approval never runs');
 unapproved.call._approved=true;
 unapproved.call.execute=async (_s,{event})=>event.reduce(1);
 bc.round=2;
 assert.equal((await hit(bc)).amount,1,'approved player Item Script Call runs on GM');
 const firstEvent=emitted.filter(x=>x.name==='pf1aeBleedApplied').at(-1).ev;
 assert.equal(firstEvent.originalAmount,2);
 assert.equal(firstEvent.preventedAmount,1);
 assert.equal(firstEvent.appliedAmount,1);
 assert.equal(firstEvent.hpBefore,28);
 assert.equal(firstEvent.hpAfter,27);
 assert.equal(Object.isFrozen(firstEvent),true);
 const attached=script(b,'second','PF1AE:bleed:before',async (_s,{event})=>event.reduce(1));
 attached.call._approved=true;
 bc.round=3;
 assert.equal((await hit(bc)).amount,0,'multiple different reducers combine');
 const duplicate=script(b,'dup','PF1AE:bleed:before',async (_s,{event})=>{
  event.reduce(1);event.reduce(1);
 });
 duplicate.call._approved=true;
 bc.round=4;
 const failure=await hit(bc);
 assert.equal(failure.pending,true,'same Script Call cannot double reduce');
 assert.equal(rows.get('bleedTurnReceipts').at(-1).status,'pending');
 assert.equal((await hit(bc)).skipped,'already claimed','fails closed on retry');
 b.items.contents=b.items.contents.filter(x=>x!==attached.item&&x!==duplicate.item);
 const bcNew=combat(b,{round:5,id:'combat-b'});
 await hit(bcNew);const count=b.applied.length;
 await hit(bcNew);await second.process(bcNew);
 assert.equal(b.applied.length,count,'GM2 and repeated turn never reapply');
 bcNew.round=6;await hit(bcNew);
 bcNew.round=5;await hit(bcNew);
 assert.equal(b.applied.length,count+1,'Combat Tracker rollback does not double damage');
 const cc=combat(c,{round:1,id:'combat-c'});
 const cBuff=buff(c,'c-bleed','2');await cfg(cBuff,'2');
 const cResult=await hit(cc);
 assert.equal(cResult.applied,true,'synthetic token actor supported');
 cBuff.activeState=false;cc.round=2;
 assert.equal((await hit(cc)).skipped,'no configured HP Bleed buffs');
 cBuff.activeState=true;
 cBuff.system.active=false;cc.round=3;
 assert.equal((await hit(cc)).skipped,'no configured HP Bleed buffs');
 cBuff.system.active=true;
 cc.round=4;assert.equal((await hit(cc)).amount,2,'reactivation on new round');
 // Existing Native duration service controls activeState; disabled on expiry.
 cBuff.activeState=false;cc.round=5;assert.equal((await hit(cc)).skipped,'no configured HP Bleed buffs');
 await assert.rejects(cfg(cBuff,'1d4','sum'),/highest/i);
 await assert.rejects(api.configure({effect:cBuff,type:'str',formula:'2'}),/Only HP/i);
 await assert.rejects(cfg(cBuff,'2+??'),/Invalid bleed formula/i);
 // HP temporary pool and native Actor.applyDamage are preserved.
 cBuff.activeState=true;c.system.attributes.hp.temp=5;
 cc.round=6;await hit(cc);
 assert.equal(c.system.attributes.hp.temp,3);
 // Simulated reconnect: data in world settings, second client still elected
 // GM only if first disconnects; no replay even after its own F5.
 users[0].active=false;const gmReloaded=makeClient(users[1]);
 cc.round=6;const replay=await gmReloaded.mod.api.bleed.process(cc);
 assert.equal(replay.skipped,'already claimed');
 cc.round=7;
 assert.equal((await gmReloaded.mod.api.bleed.process(cc)).amount,2);
 const last=emitted.filter(x=>x.name==='pf1aeBleedApplied').at(-1).ev;
 assert.equal(last.actorUuid,c.uuid);
 assert.equal(last.combatantId,cc.combatant.id);
 // Run the ACTUAL documented Scarification Script Call in a sandbox for
 // each PF1 barbarian milestone, not a separately reimplemented formula.
 const docs=fs.readFileSync(path.resolve(__dirname,'../docs/BLEED.md'),'utf8');
 const scarCode=docs.match(/## Exemple complet[\s\S]*?```js\s*([\s\S]*?)```/)?.[1];
 assert.ok(scarCode,'documented Scarification Script Call must exist');
 for(const [level,expected] of [[3,1],[6,2],[9,3],[12,4],[15,6]]){
  let saved=6;
  const self={uuid:'Actor.croute',items:[{type:'class',name:'Barbare',
   system:{levels:level}}]};
  const ev={type:'bleed:before',bleedType:'hp',actorUuid:self.uuid,
   reduce(value){saved=Math.max(0,saved-value)},
   negate(){saved=0}};
  vm.runInNewContext(scarCode,{actor:self,event:ev,console},
   {filename:'scarification-example.js'});
  assert.equal(6-saved,expected,'Scarification level '+level);
 }
 // A class with an unrelated localized name is not silently treated
 // as barbarian; absence of a uniquely identified class fails safely.
 let badReduction=0;
 vm.runInNewContext(scarCode,{actor:{uuid:'Actor.croute',
  items:[{type:'class',name:'Mystery Class',system:{levels:15}}]},
  event:{type:'bleed:before',bleedType:'hp',actorUuid:'Actor.croute',
   reduce(){badReduction++},negate(){badReduction++}},console},
  {filename:'scarification-unidentified-class.js'});
 assert.equal(badReduction,0);
 console.log('PASS Bleed: fixed/ranged rolls, highest, partial/full/double reductions,');
 console.log(' GM approvals, multi-actor and synthetic actors, manual turn/rewind/F5,');
 console.log(' disabled/expired buff, temp HP, 2 GMs, dedup receipts, applied event.');
})().catch(err=>{console.error(err);process.exitCode=1});
