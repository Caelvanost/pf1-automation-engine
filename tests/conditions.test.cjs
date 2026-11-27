"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const ns="pf1-automation-engine",source=fs.readFileSync(path.resolve(__dirname,"../scripts/conditions.js"),"utf8");
const hooks=new Map(),settings=new Map([["genericEnabled",true]]),docs=new Map(),actors=new Map(),timers=new Map();
const on=(n,fn)=>hooks.set(n,[...(hooks.get(n)??[]),fn]);
const fire=(n,...args)=>{for(const fn of hooks.get(n)??[])fn(...args)};
let seq=0;
class Registry extends Map{
 register(namespace,id,data){assert.equal(this.has(id),false);this.set(id,{id,namespace,...data,statuses:new Set(data.statuses??[])});}
}
const registry=new Registry();
registry.register("pf1","prone",{name:"Prone",texture:"prone.svg"});
registry.register("pf1","unconscious",{name:"Unconscious",texture:"unconscious.svg",statuses:["helpless"]});
registry.register("pf1","helpless",{name:"Helpless",texture:"helpless.svg"});
registry.register("pf1","dead",{name:"Dead",texture:"dead.svg",track:"dying"});
const gm={id:"gm",isGM:true,active:true},player={id:"player",active:true},other={id:"other",active:true};
const users=new Map([[gm.id,gm],[player.id,player],[other.id,other]]);
const duration={async schedule(d){timers.set(d.id,d)},listTimers:()=>[...timers.values()],async cancelTimer(id){timers.delete(id)},async extendTimer(id){assert.ok(timers.has(id));return {extended:true}}};
const addon={active:true,api:{healthConditions:{nativeRouterAvailable:()=>true},duration,generic:{...duration,scheduleTurn:duration.schedule}}};
const game={system:{id:"pf1",version:"11.11"},release:{generation:13},user:gm,users,actors,scenes:new Map(),combats:new Map(),
 modules:new Map([[ns,addon]]),settings:{register(_n,k,d){if(!settings.has(k))settings.set(k,d.default)},get(_n,k){return settings.get(k)},async set(_n,k,v){settings.set(k,v)}}};
const ctx={console,game,pf1:{registry:{conditions:registry}},Hooks:{on,once:on},fromUuid:async id=>docs.get(id),
 foundry:{utils:{randomID:()=>"id"+ ++seq}},setTimeout,clearTimeout};
ctx.globalThis=ctx;vm.runInNewContext(source,ctx);fire("pf1RegisterConditions",registry);fire("init");fire("ready");
const api=addon.api.conditions;
function actor(id,owner){
 const a={uuid:id,documentName:"Actor",effects:new Map(),items:new Map(),immunities:new Set(),
  getConditionImmunities(){return this.immunities},testUserPermission:u=>u?.id===owner,
  get statuses(){return new Set([...this.effects.values()].filter(e=>!e.disabled).flatMap(e=>[...e.statuses]))},
  allApplicableEffects(){return this.effects.values()},
  async update(c){this.lastUpdate=c;fire("updateActor",this,c,{},game.user.id)},
  async createEmbeddedDocuments(type,rows){
   assert.equal(type,"ActiveEffect");return rows.map(r=>{
    const id="e"+ ++seq,e={...r,id,uuid:this.uuid+".ActiveEffect."+id,parent:this,documentName:"ActiveEffect",statuses:new Set(r.statuses),
     async delete(){a.effects.delete(id);docs.delete(this.uuid)},getFlag(n,k){return this.flags?.[n]?.[k]}};
    this.effects.set(id,e);docs.set(e.uuid,e);return e;
   });
  }};
 actors.set(id,a);docs.set(id,a);return a;
}
function item(a,id){const i={uuid:a.uuid+".Item."+id,documentName:"Item",actor:a};a.items.set(id,i);docs.set(i.uuid,i);return i}
const tick=async()=>{for(let i=0;i<80;i++)await Promise.resolve()};
(async()=>{
 assert.equal(api.isAvailable(),true);assert.equal(registry.get("fascinated").mechanics.changes[0].formula,"-4");
 for(const id of ["burning","energyDrained","anchored","immobilized","slowed"])assert.equal(registry.get(id).mechanics.changes.length,0);
 const a=actor("Actor.a","player"),b=actor("Actor.b","other"),s=actor("Scene.sc.Token.t.Actor.b","other");
 const i=item(a,"i"),j=item(a,"j");
 await api.register({id:"pf1ae-test",name:"Test",img:"icons/svg/aura.svg",changes:[{target:"skill.per",value:-2}]});
 assert.equal(registry.has("pf1ae-test"),false);
 const next=new Registry();fire("pf1RegisterConditions",next);assert.equal(next.get("pf1ae-test").mechanics.changes[0].formula,"-2");
 await assert.rejects(api.register({id:"dead",name:"Bad",img:"icons/svg/aura.svg"}));
 await assert.rejects(api.apply({sourceUuid:i.uuid,key:"x",conditionId:"dead",targets:[b]}));
 const d={sourceUuid:i.uuid,key:"x",conditionId:"fascinated",targets:[b,s],duration:{value:2,unit:"rounds"}};
 await api.apply(d);assert.equal(b.effects.size,1);assert.equal(s.effects.size,1);assert.equal(timers.size,2);
 assert.equal(api.has(b,"fascinated"),true);assert.equal(api.getSources(b,"fascinated")[0].sourceUuid,i.uuid);
 const again=await api.apply(d);assert.equal(again.results.every(r=>r.duplicate),true);assert.equal(b.effects.size,1);
 await api.apply({...d,sourceUuid:j.uuid});assert.equal(b.effects.size,2);
 await api.extend({...d,rounds:1});assert.equal(timers.size,4);
 const flagged=[...b.effects.values()].find(e=>e.flags[ns].conditionSource.sourceUuid===i.uuid);
 const foreign=[...b.effects.values()].find(e=>e.flags[ns].conditionSource.sourceUuid===j.uuid);
 const timerId=flagged.flags[ns].conditionSource.timerId;
 flagged.flags[ns].conditionSource.timerId=foreign.flags[ns].conditionSource.timerId;
 await assert.rejects(api.remove({...d,targets:[b]}));assert.equal(b.effects.size,2);assert.equal(timers.size,4);
 await assert.rejects(api.extend({...d,targets:[b],rounds:1}));
 flagged.flags[ns].conditionSource.timerId=timerId;
 await api.remove(d);assert.equal(b.effects.size,1);assert.equal(api.has(b,"fascinated"),true);assert.equal(timers.size,2);
 assert.equal(api._protectedStatus([...b.effects.values()][0],b),"fascinated");
 b.immunities.add("prone");const immune=await api.apply({...d,conditionId:"prone",targets:[b]});assert.equal(immune.results[0].immune,true);
 await api.approve({sourceUuid:i.uuid,conditionId:"fascinated"});
 // Real hook user ID, not arbitrary fields; non-owner and unapproved cross-target refused.
 const send=async (user,data,id)=>{fire("updateActor",a,{["flags."+ns+".conditionRequest"]:{op:"apply",requestId:id,data}}, {},user.id);await tick();return a.lastUpdate["flags."+ns+".conditionAck"]};
 const data={sourceUuid:i.uuid,key:"remote",conditionId:"fascinated",targets:[b.uuid]};
 assert.equal((await send(other,data,"denied")).ok,false);
 assert.equal((await send(player,{...data,conditionId:"prone"},"noapproval")).ok,false);
 assert.equal((await send(player,data,"allowed")).ok,true);
 const remote=[...b.effects.values()].find(e=>e.flags[ns].conditionSource.key==="remote");
 assert.ok(remote);
 await api.remove({sourceUuid:i.uuid,key:"remote",conditionId:"fascinated"});assert.equal(b.effects.size,1);
 docs.delete(j.uuid);fire("deleteItem",j);await tick();assert.equal(b.effects.size,0);assert.equal(s.effects.size,0);
 await api.apply({sourceUuid:i.uuid,key:"independent",conditionId:"unconscious",targets:[b]});
 assert.equal(api.has(b,"helpless"),true);assert.equal(api.getSources(b,"helpless")[0].managed,true);
 await api.remove({sourceUuid:i.uuid,key:"independent",conditionId:"unconscious"});
 assert.equal(api.has(b,"helpless"),false);
 game.modules.set("pf1-improved-conditions",{active:true});
 const conflict=new Registry();fire("pf1RegisterConditions",conflict);assert.equal(conflict.size,0);assert.equal(api.isAvailable(),false);
 console.log("PASS native condition registry, custom definitions, source identity, timers, immunity, authenticated requests, cleanup and conflict guard");
})().catch(e=>{console.error(e);process.exitCode=1});
