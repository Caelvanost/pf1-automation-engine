'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.resolve(__dirname,'../scripts/proximity-auras.js'),'utf8');
const callbacks=new Map(),ready=[],expiry=[],rps=[],warnings=[];
function fire(event,...args){for(const fn of callbacks.get(event)??[])fn(...args)}
const gm={id:'GM',active:true,isGM:true};
const player={id:'player',active:true,isGM:false};
const mod={active:true,api:{scriptApprovals:{check:()=>({approved:true})}}};
const docs=new Map(),actors=[],items=[],scenes=[];
let id=0;
const randomID=()=>String(++id).padStart(16,'0');
const game={user:gm,users:[gm,player],
 modules:new Map([['pf1-automation-engine',mod]]),
 actors:{contents:actors},scenes:{contents:scenes,get:id=>scenes.find(s=>s.id===id)},
 time:{worldTime:100},combat:null};
const Hooks={on(name,fn){callbacks.set(name,[...(callbacks.get(name)??[]),fn])},
 once(name,fn){if(name==='ready')ready.push(fn)},callAll(name,event){
  if(name==='pf1aeProximityAuraExpired')expiry.push(event)}};
const actor=(slug)=>{
 const a={documentName:'Actor',uuid:'Actor.'+slug,name:slug,items:{contents:[]},
  testUserPermission(user,p){return p==='OWNER'&&user.id==='player'},
  async createEmbeddedDocuments(kind,raw){
   assert.equal(kind,'Item');
   return raw.map(data=>{
    const buff={...structuredClone(data),id:randomID(),documentName:'Item',
     actor:a,uuid:a.uuid+'.Item.buff'+id,
     getFlag(ns,key){return this.flags?.[ns]?.[key]}};
    a.items.contents.push(buff);fire('createItem',buff);return buff;
   });
  },
  async deleteEmbeddedDocuments(kind,ids){
   assert.equal(kind,'Item');
   for(const itemId of ids){
    const ix=a.items.contents.findIndex(x=>x.id===itemId);
    if(ix>=0){const [doc]=a.items.contents.splice(ix,1);fire('deleteItem',doc)}
   }
  }
 };
 actors.push(a);docs.set(a.uuid,a);return a;
};
const pal=actor('pal'),friend=actor('friend'),far=actor('far'),enemy=actor('foe');
const source={documentName:'Item',uuid:pal.uuid+'.Item.holy',actor:pal,
 name:'Sample generic aura',flags:{},scriptCalls:{contents:[]},
 getFlag(ns,key){return this.flags[key]},
 async setFlag(ns,key,value){this.flags[key]=structuredClone(value);fire('updateItem',this)},
 async update(values){
  for(const [key,value] of Object.entries(values))
   this.flags[key.split('.').at(-1)]=structuredClone(value);
  fire('updateItem',this);
 }};
pal.items.contents.push(source);docs.set(source.uuid,source);
source.scriptCalls.contents.push({id:'end',category:'postUse',
 name:'PF1AE:aura:expired',async execute(a,c){rps.push(c.event)}});
const scene={id:'s',grid:{size:100,distance:5,units:'ft',
 getCenterPoint(o){return {x:o.i*100+50,y:o.j*100+50}},
 measurePath([a,b]){
  const x=Math.abs(a.x-b.x)/100,y=Math.abs(a.y-b.y)/100;
  return {distance:5*Math.max(x,y)};
 }},
 tokens:{contents:[]},lights:{contents:[]},
 async createEmbeddedDocuments(type,raw){
  assert.equal(type,'AmbientLight');
  return raw.map(data=>{
   const light={...structuredClone(data),id:randomID(),
    getFlag(ns,key){return this.flags?.[ns]?.[key]}};
   this.lights.contents.push(light);return light;
  });
 },
 async deleteEmbeddedDocuments(type,ids){
  assert.equal(type,'AmbientLight');
  this.lights.contents=this.lights.contents.filter(x=>!ids.includes(x.id));
 },
 async updateEmbeddedDocuments(type,updates){
  assert.equal(type,'AmbientLight');
  for(const update of updates){
   const light=this.lights.contents.find(x=>x.id===update._id);
   assert.ok(light);
   light.x=update.x;light.y=update.y;
   light.config.bright=update['config.bright'];
   light.config.dim=update['config.dim'];
  }
 }};
scenes.push(scene);
function token(name,who,i,j,w=1,h=1,disposition=1){
 const t={id:name,uuid:'Scene.s.Token.'+name,x:i*100,y:j*100,
  width:w,height:h,actor:who,disposition,
  getOccupiedGridSpaceOffsets(){
   const points=[];
   for(let dx=0;dx<this.width;dx++)for(let dy=0;dy<this.height;dy++)
    points.push({i:Math.round(this.x/100)+dx,j:Math.round(this.y/100)+dy});
   return points;
  }};
 scene.tokens.contents.push(t);docs.set(t.uuid,t);return t;
}
const emit=token('emit',pal,0,0);
const ally=token('ally',friend,1,0);
const distant=token('distant',far,3,0);
const hostile=token('hostile',enemy,1,1,1);hostile.disposition=-1;
const preexisting={id:'prior-light',x:10,y:10,config:{bright:5,dim:10},
 getFlag:()=>undefined};
scene.lights.contents.push(preexisting);
const ctx={game,Hooks,foundry:{utils:{deepClone:structuredClone,randomID}},
 fromUuid:async id=>docs.get(id)??null,
 console:{...console,warn:(...args)=>warnings.push(args),
 error:(...args)=>warnings.push(args)}};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'proximity-auras.js'});
ready.forEach(f=>f());
const api=mod.api.proximityAuras;
const definition={
 key:'generic-test',sourceItemUuid:source.uuid,emitterActorUuid:pal.uuid,
 emitterTokenUuid:emit.uuid,
 beneficiaries:{kind:'allies',excludeEmitter:true},
 range:{kind:'adjacent'},
 defense:{bonusType:'shield',value:4},
 duration:{rounds:3},
 light:{bright:20,dim:40},label:'Shield Test'
};
const buffs=a=>a.items.contents.filter(x=>x.getFlag?.('pf1-automation-engine',
 'proximityAuraSource')===source.uuid+'|generic-test');
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 // Registered by a player owner; only elected GM mutates recipients.
 game.user=player;
 const firstRegistration=await api.register(definition);
 const repeatedRegistration=await api.register(definition);
 assert.equal(firstRegistration.created,true,'first use creates one aura');
 assert.equal(repeatedRegistration.created,false,
  'duplicate native use cannot trigger another resource debit');
 assert.equal(source.flags.proximityAuras.length,1,'stable key idempotent');
 const started=source.flags.proximityAuras[0].started.worldTime;
 assert.equal(started,100,'duration starts exactly once');
 assert.equal(buffs(friend).length,0,'player cannot write unrelated Actor');
 game.user=gm;
 await api.reconcile();
 assert.equal(buffs(friend).length,1);
 assert.equal(buffs(pal).length,0,'exclude emitter');
 assert.equal(buffs(far).length,0,'out of range');
 assert.equal(buffs(enemy).length,0,'hostile excluded');
 const change=buffs(friend)[0].system.changes[0];
 assert.equal(change.target,'ac');
 assert.equal(change.subTarget,'sac');
 assert.equal(change.modifier,'shield');
 assert.equal(change.formula,'4');
 assert.equal(Math.max(2,+change.formula),4,'native shield typed stacking');
 assert.equal(buffs(friend)[0].system.active,true);
 assert.equal(scene.lights.contents.length,2);
 assert.equal(scene.lights.contents[0],preexisting);
 const owned=scene.lights.contents[1];
 assert.equal(owned.config.bright,20);
 // Move an ally into range, then out: no duration reset.
 distant.x=100;
 await api.reconcile();
 assert.equal(buffs(far).length,1);
 distant.x=500;
 await api.reconcile();
 assert.equal(buffs(far).length,0);
 assert.equal(source.flags.proximityAuras[0].started.worldTime,started);
 // Occupied squares, not token centers: a Large emitter protects a
 // one-square target next to its second occupied grid square.
 emit.width=2;
 ally.x=200;
 await api.reconcile();
 assert.equal(buffs(friend).length,1,
  'Large token grants adjacency from any occupied square');
 emit.width=1;
 ally.x=100;
 await api.reconcile();
 // Moving the source moves its independent AmbientLight with the aura.
 emit.x=100;ally.x=200;
 await api.reconcile();
 assert.equal(buffs(friend).length,1);
 assert.equal(scene.lights.contents[1].x,150);
 assert.equal(scene.lights.contents[0],preexisting);
 await api.reconcile();
 assert.equal(buffs(friend).length,1,'no duplicate after F5-like restore');
 // No extra event when active but still before expiry.
 game.time.worldTime=117;
 await api.reconcile();
 assert.equal(source.flags.proximityAuras.length,1);
 game.time.worldTime=118;
 await api.reconcile();
 await tick();
 assert.equal(source.flags.proximityAuras.length,0);
 assert.equal(buffs(friend).length,0);
 assert.equal(scene.lights.contents.length,1,'own light removed');
 assert.equal(scene.lights.contents[0],preexisting,'external light untouched');
 assert.equal(expiry.length,1);
 assert.equal(rps.length,1,'RP postUse subscription called by elected GM');
 assert.equal(expiry[0].reason,'duration');
 await api.reconcile();
 assert.equal(rps.length,1,'receipt delivered at most once');
 // Combat expiry uses source turn, not ally movement or world time.
 game.time.worldTime=200;
 game.combat={id:'combat',started:true,round:3,turn:1,
  combatants:{contents:[{id:'pal-combatant',actor:pal}]}};
 emit.x=0;ally.x=100;
 await api.register({...definition,key:'combat-test',light:null});
 const combatAura=source.flags.proximityAuras[0];
 assert.equal(combatAura.started.round,3);
 game.combat.round=5;game.combat.turn=1;
 await api.reconcile();
 assert.equal(source.flags.proximityAuras.length,1);
 game.combat.round=6;game.combat.turn=0;
 await api.reconcile();
 assert.equal(source.flags.proximityAuras.length,1,'not before source turn');
 game.combat.turn=1;
 await api.reconcile();
 assert.equal(source.flags.proximityAuras.length,0,'expire at same initiative');
 // Stopping a separate aura emits a single manual event and cleans up.
 game.combat=null;
 await api.register({...definition,key:'manual-test',light:null});
 await api.reconcile();
 assert.equal((await api.stop({sourceItemUuid:source.uuid,
  key:'manual-test'})).removed,true);
 await api.reconcile();
 assert.equal(rps.length,3);
 assert.equal(rps.at(-1).reason,'manual');
 // Source token removal fails closed without deleting third-party lights.
 await api.register({...definition,key:'missing-source'});
 scene.tokens.contents=scene.tokens.contents.filter(t=>t!==emit);
 await api.reconcile();
 assert.equal(source.flags.proximityAuras.length,0);
 assert.equal(scene.lights.contents.length,1);
 // Players cannot activate auras on another actor, even through source IDs.
 game.user={id:'stranger',isGM:false,active:true};
 await assert.rejects(()=>api.register(definition),/OWNER/);
 game.user=gm;
 await assert.rejects(()=>api.register({...definition,callback:()=>1}),/Invalid/);
 assert.equal(warnings.length,0,'no unexpected runtime failures');
 console.log('PASS proximity auras: distance, adjacency, dynamic roster, typed shield, light safety, duration, GM-only reconciliation, expiry RP, receipt idempotency');
})().catch(e=>{console.error(e);process.exitCode=1});
