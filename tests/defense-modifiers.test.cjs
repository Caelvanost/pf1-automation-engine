'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.resolve(__dirname,'../scripts/defense-modifiers.js'),'utf8');
const gm={id:'gm',active:true,isGM:true},player={id:'player',isGM:false};
const SETTINGS=new Map([['genericEnabled',true]]);
const mod={active:true,api:{}};
const game={user:gm,modules:new Map([['pf1-automation-engine',mod]]),
 settings:{get(_ns,k){return SETTINGS.get(k)}}};
const actor={documentName:'Actor',uuid:'Actor.paladin',items:{contents:[]},
 testUserPermission(u,role){return role==='OWNER'&&u.id==='player'}};
const item={documentName:'Item',uuid:'Actor.paladin.Item.bastion',
 actor,flags:{},getFlag(_ns,k){return this.flags[k]},
 async setFlag(_ns,k,v){this.flags[k]=structuredClone(v);return v}};
actor.items.contents.push(item);
const enemy={documentName:'Actor',uuid:'Actor.enemy',statuses:new Set()};
const others={documentName:'Actor',uuid:'Actor.other',statuses:new Set()};
game.actors={contents:[actor,enemy,others]};
game.users=[gm,player];
const registry=new Map([[actor.uuid,actor],[item.uuid,item],[enemy.uuid,enemy],[others.uuid,others]]);
const ready=[];
const ctx={console,game,Hooks:{once(_name,fn){ready.push(fn)}},
 fromUuid:async uuid=>registry.get(uuid)??null,
 fromUuidSync:uuid=>registry.get(uuid)??null,
 foundry:{utils:{deepClone:structuredClone}},
 Object,Math,Set,Map,Number,Promise,Date};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'defense-modifiers.js'});
for(const fn of ready)fn();
const api=mod.api.defenseModifiers;
const make=(key,bonusType,value,attackerUuid='Actor.enemy')=>({
 key,defenderUuid:actor.uuid,sourceItemUuid:item.uuid,
 attackerUuid,bonusType,value,defenses:['normal','touch','flatFooted'],
 reason:'generic source condition'});
const evaluate=(defense='normal',options={})=>api.evaluate({
 defenderActor:actor,defenderUuid:actor.uuid,
 attackerUuid:enemy.uuid,defense,...options});
(async()=>{
 let value=make('designated','deflection',4);
 const created=await api.register(value);
 assert.ok(created.id,'persistent identity returned');
 assert.equal(item.getFlag('pf1-automation-engine','defenseModifiers').length,1);
 await api.register(value);
 assert.equal(item.flags.defenseModifiers.length,1,'idempotent by source key');
 assert.equal(api.list({defenderActor:actor,defenderUuid:actor.uuid}).length,1);
 let result=evaluate();
 assert.equal(result.status,'uncertain','unknown native deflection bonus refuses double count');
 assert.equal(result.total,null);
 result=evaluate('normal',{nativeTypes:{deflection:2}});
 assert.equal(result.status,'resolved');
 assert.equal(result.total,2,'native +2 plus conditional +4 => +2 additional');
 result=evaluate('normal',{attackerUuid:others.uuid,nativeTypesComplete:true});
 assert.equal(result.total,0,'targeted rule only protects against designated attacker');
 assert.equal(api.evaluate({defenderActor:actor,defenderUuid:actor.uuid,
  defense:'normal'}).status,'uncertain');
 await api.register(make('lesser','deflection',3));
 await api.register(make('sacred-one','sacred',3));
 result=evaluate('touch',{nativeTypesComplete:true});
 assert.equal(result.total,7,'highest +4 deflection plus +3 sacred');
 assert.equal(result.suppressed.length,1);
 await api.register(make('circ-one','circumstance',1));
 await api.register(make('circ-two','circumstance',2));
 result=evaluate('flatFooted',{nativeTypesComplete:true});
 assert.equal(result.total,10,'different bonus type and two stackable circumstances');
 result=evaluate('normal',{nativeTypes:{deflection:4,sacred:3,circumstance:0}});
 assert.equal(result.total,3,'avoid duplicate native typed bonuses');
 // Generic confirmed death permanently removes the source record;
 // zero HP alone is NOT proof of death.
 const expiring={...make('death-expire','untyped',5),expiresOnDeathOf:enemy.uuid};
 await api.register(expiring);
 result=evaluate('normal',{nativeTypesComplete:true});
 assert.equal(result.total,15);
 enemy.statuses.add('dead');
 result=evaluate('normal',{nativeTypesComplete:true});
 assert.equal(result.total,10,'confirmed dead target disables only expiring modifier');
 const expired=await api.expireConfirmed(enemy);
 assert.equal(expired.expired,1,'confirmed death removes source record');
 enemy.statuses.delete('dead');
 assert.equal(evaluate('normal',{nativeTypesComplete:true}).total,10,
  'resurrection cannot reactivate an expired conditional bonus');
 await assert.rejects(()=>api.register({...value,key:'forged',
  defenderUuid:others.uuid}),/Source Item must belong/);
 await assert.rejects(()=>api.register({...value,key:'invalid',value:Infinity}),
  /Invalid declarative/);
 await assert.rejects(()=>api.register({...value,key:'callback',callback:()=>99}),
  /Invalid declarative/);
 // Native server permissions on Item flags remain the authority.
 game.user={id:'stranger',isGM:false};
 await assert.rejects(()=>api.register(make('noowner','deflection',1)),
  /owner or GM/);
 game.user=player;
 await api.register(make('player-owned','untyped',1));
 assert.equal(item.flags.defenseModifiers.length,6);
 assert.equal((await api.remove({key:'designated',defenderUuid:actor.uuid,
  sourceItemUuid:item.uuid})).removed,true);
 assert.equal((await api.remove({key:'designated',defenderUuid:actor.uuid,
  sourceItemUuid:item.uuid})).removed,false);
 assert.equal(item.flags.defenseModifiers.length,5);
 SETTINGS.set('genericEnabled',false);
 await assert.rejects(()=>api.register(make('disabled','untyped',1)),/disabled/);
 SETTINGS.set('genericEnabled',true);
 assert.equal(api.list({defenderActor:actor,defenderUuid:actor.uuid}).length,5);
 console.log('PASS defense-modifiers: owner-authorized native Item flags, persistent identities, source filtering, stacking, native baseline, expiration');
})().catch(error=>{console.error(error);process.exitCode=1});
