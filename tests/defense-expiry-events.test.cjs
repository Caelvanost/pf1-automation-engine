'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../scripts/defense-modifiers.js'),'utf8');
const gm={id:'gm',isGM:true,active:true},player={id:'player',isGM:false,active:true};
const logged=[],scripts=[],events=[],hookFns=new Map(),ready=[],init=[];
const Hooks={
 once(name,fn){(name==='init'?init:ready).push(fn)},
 on(name,fn){hookFns.set(name,[...(hookFns.get(name)??[]),fn])},
 callAll(name,ev){if(name==='pf1aeDefenseModifierExpired')events.push(ev)}
};
const moduleApi={active:true,api:{scriptApprovals:{check:()=>({approved:true})}}};
const game={user:gm,users:[gm,player],modules:new Map([['pf1-automation-engine',moduleApi]]),
 settings:{get(_n,key){return key==='genericEnabled'}},actors:{contents:[]},
 scenes:{contents:[]}};
const actor=(uuid)=>({uuid,documentName:'Actor',statuses:new Set(),
 items:{contents:[]},testUserPermission(u,permission){
  return permission==='OWNER'&&u.id==='player';}});
const pal=actor('Actor.pal'),foe=actor('Actor.foe'),extra=actor('Actor.extra');
game.actors.contents.push(pal,foe,extra);
const docs=new Map([[pal.uuid,pal],[foe.uuid,foe],[extra.uuid,extra]]);
const call={id:'post',category:'postUse',name:'PF1AE:defense:expired',
 async execute(_action,ctx){scripts.push(ctx.event)}};
function makeItem(who,id){
 const item={
  uuid:who.uuid+'.Item.'+id,documentName:'Item',actor:who,
  flags:{defenseModifiers:[],defenseModifierExpiryReceipts:[]},
  scriptCalls:{contents:[call]},
  getFlag(_ns,k){return this.flags[k]},
  async update(changes){
   if(this.failUpdate)throw Error('native write failed');
   for(const [key,val] of Object.entries(changes)){
    const suffix=key.split('.').at(-1);
    this.flags[suffix]=structuredClone(val);
   }
   for(const fn of hookFns.get('updateItem')??[])fn(this);
  },
  async setFlag(_ns,key,value){
   this.flags[key]=structuredClone(value);
   for(const fn of hookFns.get('updateItem')??[])fn(this);
  }
 };
 who.items.contents.push(item);docs.set(item.uuid,item);
 return item;
}
const item=makeItem(pal,'bastion');
const secondItem=makeItem(extra,'shield');
const ctx={console:{...console,warn(...x){logged.push(x)},error(...x){logged.push(x)}},
 game,Hooks,
 fromUuid:async id=>docs.get(id)??null,fromUuidSync:id=>docs.get(id)??null,
 foundry:{utils:{deepClone:structuredClone,randomID:(()=>{let n=0;return()=>String(++n).padStart(10,'0')})()}},
 Object,Math,Set,Map,Number,Promise,Date};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'defense-modifiers.js'});
init.forEach(fn=>fn());ready.forEach(fn=>fn());
const api=moduleApi.api.defenseModifiers;
const record=(key,source=item,attacker=foe)=>({
 key,sourceItemUuid:source.uuid,defenderUuid:source.actor.uuid,
 attackerUuid:attacker.uuid,bonusType:'deflection',value:4,
 defenses:['normal','touch','flatFooted'],expiresOnDeathOf:attacker.uuid
});
async function flush(){
 await api.reconcilePending();
 await new Promise(r=>setTimeout(r,0));
}
(async()=>{
 await api.register(record('bastion-1'));
 await api.register(record('bastion-2'));
 await api.register(record('independent',secondItem));
 await api.expireConfirmed(foe);
 assert.equal(events.length,0,'zero HP with no native dead does not notify');
 assert.equal(item.flags.defenseModifiers.length,2);
 foe.statuses.add('dead');
 assert.equal((await api.expireConfirmed(foe)).expired,3);
 await flush();
 assert.equal(events.length,3,'one event for each deleted record across two actors');
 assert.equal(scripts.length,3,'each Item executes its own call, not others');
 assert.equal(events.every(e=>e.reason==='death'&&e.expiredActorUuid===foe.uuid),true);
 assert.equal(events.every(e=>e.type==='defenseModifierExpired'&&
  e.sourceItemUuid===e.modifier.sourceItemUuid&&
  e.defenderUuid===e.modifier.defenderUuid),true);
 assert.equal(new Set(events.map(e=>e.eventId)).size,3);
 const saved=events.length;
 await api.expireConfirmed(foe);await flush();
 assert.equal(events.length,saved,'repeated death hooks do not double emit');
 foe.statuses.delete('dead');
 assert.equal(item.flags.defenseModifiers.length,0,'resurrection cannot restore the bonus');
 await api.register({...record('manual-1'),expiresOnDeathOf:null});
 await api.remove({key:'manual-1',sourceItemUuid:item.uuid,defenderUuid:pal.uuid});
 await flush();
 assert.equal(events.at(-1).reason,'manual');
 assert.equal(events.at(-1).expiredActorUuid,null);
 await api.register({...record('rest-1'),expiresOnDeathOf:null});
 await api._withVerifiedRest({actorUuid:pal.uuid,itemUuid:item.uuid,restId:'native-rest-1'},()=>
  api.remove({key:'rest-1',sourceItemUuid:item.uuid,defenderUuid:pal.uuid}));
 await flush();
 assert.equal(events.at(-1).reason,'rest');
 assert.equal(events.at(-1).reasonProvenance,'verified-native-rest');
 await api.register({...record('unverified'),expiresOnDeathOf:null});
 await api.remove({key:'unverified',sourceItemUuid:item.uuid,defenderUuid:pal.uuid,
  reason:'rest',restId:'forged'});
 await flush();
 assert.equal(events.at(-1).reason,'other','unverified rest reason must be neutral');
 await api.register({...record('failed'),expiresOnDeathOf:null});
 item.failUpdate=true;
 await assert.rejects(()=>api.remove({key:'failed',sourceItemUuid:item.uuid,
  defenderUuid:pal.uuid}),/native write failed/);
 item.failUpdate=false;
 await flush();
 assert.equal(events.filter(e=>e.modifierKey==='failed').length,0);
 assert.equal(item.flags.defenseModifiers.some(e=>e.key==='failed'),true);
 await api.register({...record('player-delete'),expiresOnDeathOf:null});
 game.user=player;
 await api.remove({key:'player-delete',sourceItemUuid:item.uuid,defenderUuid:pal.uuid});
 assert.equal(events.some(e=>e.modifierKey==='player-delete'),false,
  'player does not publish a privileged script locally');
 game.user=gm;
 await flush();
 assert.equal(events.filter(e=>e.modifierKey==='player-delete').length,1,
  'elected GM discovers pending receipt on native Item');
 moduleApi.api.scriptApprovals.check=()=>({approved:false,reason:'secure-mode'});
 await api.register({...record('blocked'),expiresOnDeathOf:null});
 const priorScripts=scripts.length;
 await api.remove({key:'blocked',sourceItemUuid:item.uuid,defenderUuid:pal.uuid});
 await flush();
 assert.equal(scripts.length,priorScripts,'unapproved scripts do not execute');
 assert.equal(events.at(-1).modifierKey,'blocked','public hook still fires');
 moduleApi.api.scriptApprovals.check=()=>({approved:true});
 call.name='Changed by owner';
 await api.register({...record('edited'),expiresOnDeathOf:null});
 await api.remove({key:'edited',sourceItemUuid:item.uuid,defenderUuid:pal.uuid});
 await flush();
 assert.equal(scripts.length,priorScripts,'renamed Script Call cannot receive event');
 call.name='PF1AE:defense:expired';
 await api.reconcilePending();
 assert.equal(scripts.length,priorScripts,'claimed receipt cannot replay');
 const synthetic=actor('Scene.s.Token.t.Actor.synthetic');
 game.scenes.contents=[{tokens:{contents:[{actorLink:false,actor:synthetic}]}}];
 const syn=makeItem(synthetic,'source');
 docs.set(synthetic.uuid,synthetic);
 await api.register(record('synthetic',syn,foe));
 foe.statuses.add('dead');
 await api.expireConfirmed(foe);await flush();
 assert.equal(events.at(-1).defenderUuid,synthetic.uuid);
 console.log('PASS defense expiry events: death, rest provenance, manual, errors, native player-GM recovery, approval, synthetic actors and dedup');
})().catch(e=>{console.error(e);process.exitCode=1});
