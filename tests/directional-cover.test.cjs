'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const text=fs.readFileSync(path.resolve(__dirname,'../scripts/directional-cover.js'),'utf8');
const gm={id:'gm',active:true,isGM:true};
const owner={id:'player',active:true,isGM:false};
const battle={id:'battle',started:true,round:2,turn:0,turns:[],
 combatants:new Map(),combatant:null};
const actor={uuid:'Actor.guard',documentName:'Actor',items:{contents:[]},
 testUserPermission(u,kind){return kind==='OWNER'&&u.id==='player'}};
const enemy={uuid:'Actor.enemy',documentName:'Actor'};
const item={uuid:'Actor.guard.Item.shield',documentName:'Item',actor,
 system:{equipped:true},stored:[],
 getFlag(){return this.stored;},async setFlag(_ns,_flag,value){
  this.stored=structuredClone(value);return value;
 }};
actor.items.contents.push(item);
const combatant={id:'guard',actor};
battle.turns=[combatant,{id:'enemy',actor:enemy}];
battle.combatants.set('guard',combatant);
battle.combatants.set('enemy',battle.turns[1]);
battle.combatant=combatant;
const scene={id:'scene',grid:{size:100},tokens:{contents:[]}};
const token=(id,who,x,y,w=1,h=1,z=0)=>({
 uuid:'Scene.scene.Token.'+id,id,documentName:'Token',actor:who,
 x,y,width:w,height:h,elevation:z,parent:scene
});
const guard=token('guard',actor,300,300);
const foeNorth=token('north',enemy,300,200);
const foeSouth=token('south',enemy,300,400);
const foeEast=token('east',enemy,400,300);
const foeWest=token('west',enemy,200,300);
const foeDiagonal=token('diagonal',enemy,400,200);
scene.tokens.contents.push(guard,foeNorth,foeSouth,foeEast,foeWest,foeDiagonal);
const docs=new Map([[actor.uuid,actor],[item.uuid,item],
 ...scene.tokens.contents.map(t=>[t.uuid,t])]);
const listeners=new Map(),ready=[],init=[];
const hooks={
 once(type,fn){(type==='init'?init:ready).push(fn)},
 on(name,fn){listeners.set(name,[...(listeners.get(name)??[]),fn])}
};
const mod={active:true,api:{}};
const game={user:gm,users:[gm,owner],modules:new Map([['pf1-automation-engine',mod]]),
 settings:{get(){return true}},combat:battle,combats:new Map([[battle.id,battle]]),
 scenes:{contents:[scene]},actors:{contents:[actor,enemy]},i18n:{localize:k=>k}};
const ctx={console,game,Hooks:hooks,canvas:{scene,grid:{size:100}},
 fromUuid:async u=>docs.get(u)??null,fromUuidSync:u=>docs.get(u)??null,
 foundry:{utils:{deepClone:structuredClone}},Set,Map,Object,Number,Promise};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(text,ctx,{filename:'directional-cover.js'});
for(const f of init)f();
for(const f of ready)f();
const api=mod.api.directionalCover;
const register=(edge,extras={})=>api.register({
 key:'guarded',sourceItemUuid:item.uuid,defenderUuid:actor.uuid,
 tokenUuid:guard.uuid,protectedEdge:edge,coverType:'total',
 combatId:battle.id,combatantId:'guard',requireEquipped:true,
 exceptions:{targetedSpells:true},...extras
});
const inspect=(foe,opts={})=>api.inspect({
 attacker:foe,target:guard,attackType:'ranged',
 action:{hasAttack:true,actionType:'rwak'},...opts
});
(async()=>{
 for(const [edge,front,back] of [
  ['north',foeNorth,foeSouth],['south',foeSouth,foeNorth],
  ['east',foeEast,foeWest],['west',foeWest,foeEast]]){
  await register(edge);
  assert.equal(inspect(front).status,'confirmed',edge+' direct blocks');
  assert.equal(inspect(front).preventsDirectAttack,true);
  assert.equal(inspect(back).status,'not-applicable',edge+' reverse clear');
 }
 await register('north');
 assert.equal(inspect(foeEast).status,'not-applicable','lateral is not blocked');
 assert.equal(inspect(foeDiagonal).status,'uncertain',
  'diagonal corner rays are conservatively indeterminate');
 assert.equal(inspect(foeNorth,{action:{hasAttack:false}}).status,'not-applicable',
  'targeted spells without attack rolls are unaffected');
 assert.equal(inspect(foeNorth,{attackType:'area'}).status,'not-applicable');
 assert.equal(api.list({defenderActor:actor,defenderUuid:actor.uuid}).length,1);
 const big=token('big',actor,300,300,2,2);
 docs.set(big.uuid,big);scene.tokens.contents.push(big);
 await register('north',{tokenUuid:big.uuid,key:'large'});
 assert.equal(api.list({defenderActor:actor,defenderUuid:actor.uuid}).length,2);
 const high=token('high',enemy,300,200,1,1,10);
 assert.equal(api.inspect({attacker:high,target:guard,attackType:'ranged'}).status,
  'uncertain','unverified elevation blocks automatic conclusion');
 battle.round=3;battle.turn=0;
 assert.equal(api.list({defenderActor:actor,defenderUuid:actor.uuid}).length,0,
  'protection automatically inert at start of next turn');
 await api.cleanup();
 assert.equal(item.stored.length,0,'persistent cleanup removes expired records');
 battle.round=4;battle.turn=0;
 await register('west');
 item.system.equipped=false;
 assert.equal(api.list({defenderActor:actor,defenderUuid:actor.uuid}).length,0,
  'unequipped required source becomes ineffective');
 await api.cleanup();
 assert.equal(item.stored.length,0,'unequipping removes the record');
 item.system.equipped=true;
 await register('west');
 battle.started=false;
 assert.equal(inspect(foeWest).status,'not-applicable','ended combat cannot retain cover');
 await api.cleanup();
 assert.equal(item.stored.length,0);
 console.log('PASS directional cover: four edges, diagonal, targeted spell exception, large tokens, elevation, persistence and expiry');
})().catch(e=>{console.error(e);process.exitCode=1});
