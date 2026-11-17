'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.resolve(__dirname,'../scripts/defense-modifiers.js'),'utf8');
const SETTINGS=new Map([['genericEnabled',true],['defenseModifierRegistry',[]],['genericDebug',false]]);
const ready=[],init=[],events=new Map();
const gm={id:'gm',active:true,isGM:true};
const player={id:'player',active:true,isGM:false};
const users=[gm,player];users.get=id=>users.find(u=>u.id===id);
const defender={documentName:'Actor',uuid:'Actor.paladin',testUserPermission(u,level){
 return level==='OWNER'&&u.id==='player';
}};
const source={documentName:'Item',uuid:'Actor.paladin.Item.bastion',actor:defender};
const entities=new Map([[defender.uuid,defender],[source.uuid,source]]);
const game={users,user:gm,modules:new Map([['pf1-automation-engine',{active:true,api:{}}]]),
 settings:{get(_ns,k){return SETTINGS.get(k)},async set(_ns,k,v){
 SETTINGS.set(k,structuredClone(v));return v;
 },register(_ns,k,o){if(!SETTINGS.has(k))SETTINGS.set(k,o.default)}},
 socket:{on(name,handler){events.set(name,handler)},emit(name,payload){events.get(name)?.(payload)}}};
const hooks={once(name,callback){(name==='init'?init:ready).push(callback)}};
const ctx={console,game,Hooks:hooks,Promise,Map,Set,Date,Number,Object,
 setTimeout,clearTimeout,fromUuid:async uuid=>entities.get(uuid)??null,
 foundry:{utils:{deepClone:structuredClone,randomID:()=>String(Date.now())}}};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'defense-modifiers.js'});
for(const f of init)f();
for(const f of ready)f();
const api=game.modules.get('pf1-automation-engine').api.defenseModifiers;
const make=(key,bonusType,value,attackerUuid='Actor.enemy')=>({
 key,defenderUuid:defender.uuid,sourceItemUuid:source.uuid,
 attackerUuid,bonusType,value,defenses:['normal','touch','flatFooted'],
 reason:'generic item-sourced condition'
});
(async()=>{
 const baseline=make('designated','deflection',4);
 const stored=await api.register(baseline);
 assert.ok(stored.id);
 assert.equal(SETTINGS.get('defenseModifierRegistry').length,1);
 await api.register(baseline);
 assert.equal(SETTINGS.get('defenseModifierRegistry').length,1,'idempotent');
 assert.equal(api.list({defenderUuid:defender.uuid}).length,1);
 let resolved=api.evaluate({defenderUuid:defender.uuid,
  attackerUuid:'Actor.enemy',defense:'normal'});
 assert.equal(resolved.status,'uncertain','unverified embedded deflection bonus must not stack');
 assert.equal(resolved.total,null);
 resolved=api.evaluate({defenderUuid:defender.uuid,
  attackerUuid:'Actor.enemy',defense:'normal',
  nativeTypes:{deflection:2}});
 assert.equal(resolved.status,'resolved');assert.equal(resolved.total,2,
  'native +2 and conditional +4 yield +2 additional');
 resolved=api.evaluate({defenderUuid:defender.uuid,
  attackerUuid:'Actor.other',defense:'normal',nativeTypesComplete:true});
 assert.equal(resolved.total,0,'wrong origin gets nothing');
 assert.equal(api.evaluate({defenderUuid:defender.uuid,
  defense:'normal'}).status,'uncertain','missing attacker for a designated bonus');
 // Different typed bonuses stack and same typed bonuses do not.
 await api.register(make('another-deflection','deflection',3));
 await api.register(make('different-type','sacred',3));
 resolved=api.evaluate({defenderUuid:defender.uuid,attackerUuid:'Actor.enemy',
  defense:'touch',nativeTypesComplete:true});
 assert.equal(resolved.total,7,'highest +4 deflection plus +3 sacred');
 assert.equal(resolved.suppressed.length,1);
 await api.register(make('circumstance-one','circumstance',1));
 await api.register(make('circumstance-two','circumstance',2));
 resolved=api.evaluate({defenderUuid:defender.uuid,attackerUuid:'Actor.enemy',
  defense:'flatFooted',nativeTypesComplete:true});
 assert.equal(resolved.total,10,'stackable circumstance +1 and +2');
 // User-owned item cannot register a defense on an unrelated Actor.
 await assert.rejects(()=>api.register({...baseline,key:'forged',
  defenderUuid:'Actor.stranger'}),/Source Item must belong/);
 await assert.rejects(()=>api.register({...baseline,key:'invalid',value:Infinity}),
  /Invalid declarative/);
 await assert.rejects(()=>api.register({...baseline,key:'function',callback:()=>42}),
  /Invalid declarative/);
 assert.equal((await api.remove({defenderUuid:defender.uuid,
  sourceItemUuid:source.uuid,key:'designated'})).removed,true);
 assert.equal(api.list({defenderUuid:defender.uuid}).length,4);
 assert.equal((await api.remove({defenderUuid:defender.uuid,
  sourceItemUuid:source.uuid,key:'designated'})).removed,false);
 // Fail closed without elected GM or service availability.
 gm.active=false;
 await assert.rejects(()=>api.register(make('not-authorized','deflection',2)),
  /No connected elected GM/);
 gm.active=true;
 SETTINGS.set('genericEnabled',false);
 await assert.rejects(()=>api.register(make('disabled','deflection',2)),
  /disabled/);
 SETTINGS.set('genericEnabled',true);
 console.log('PASS defense-modifiers: registry, identity, typed stacking, native checks, source filtering, security');
})().catch(error=>{console.error(error);process.exitCode=1});
