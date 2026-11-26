"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const src=fs.readFileSync(path.resolve(__dirname,"../scripts/health-conditions.js"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../module.json"),"utf8"));
assert.ok(manifest.esmodules.includes("scripts/health-conditions.js"));
const NS="pf1-automation-engine",hooks=new Map(),settings=new Map(),registered=new Map();
const on=(n,fn)=>hooks.set(n,[...(hooks.get(n)??[]),fn]);
const fire=(n,...args)=>{for(const fn of hooks.get(n)??[])fn(...args)};
const gm={id:"gm",isGM:true},player={id:"player",isGM:false};
const conditions=new Map(["dead","stable","disabled","dying","unconscious","prone","staggered","sleep","helpless"].map(id=>[id,{name:id,texture:id+".svg",statuses:new Set(id==="disabled"?["staggered"]:id==="unconscious"?["helpless"]:id==="sleep"?["helpless","unconscious"]:[])}]));
conditions.trackedConditions=()=>[["dead","disabled","dying","stable"]];
let seq=0,deadSync=0;
const notifications=[];
const addon={version:manifest.version,api:{generic:{isLeader:()=>game.user===gm},deathDefeated:{reconcileActor:async()=>{deadSync++}}}};
const improved={active:false},actors=new Map(),scenes=new Map(),documents=new Map(),combats=new Map();
const game={version:"13.351",release:{generation:13},system:{id:"pf1",version:"11.11"},
 user:gm,modules:new Map([[NS,addon],["pf1-improved-conditions",improved]]),
 actors,scenes,combats,time:{worldTime:0},i18n:{localize:k=>k},
 settings:{register(ns,k,c){registered.set(k,c);settings.set(k,c.default)},
 get(ns,k){if(ns==="pf1")return {getActorConfig:()=>({rules:{useWoundsAndVigor:false}})};return settings.get(k)},
 async set(ns,k,v){settings.set(k,v);registered.get(k)?.onChange?.(v)}}};
function clone(x){return JSON.parse(JSON.stringify(x))}
function put(root,key,value){
 const parts=key.split(".");let target=root;
 for(const p of parts.slice(0,-1)){target[p]??={};target=target[p]}
 const last=parts.at(-1);
 if(last.startsWith("-="))delete target[last.slice(2)];else target[last]=value;
}
function merge(a,b){for(const [k,v] of Object.entries(b??{})){if(v&&typeof v==="object"&&!Array.isArray(v)){a[k]??={};merge(a[k],v)}else a[k]=v}return a}
class TestActor{
 async setCondition(id,value,context){return this.setConditions({[id]:value},context)}
 async toggleStatusEffect(id,{active}={}){return this.setCondition(id,active??!this.statuses.has(id))}
 getConditionImmunities(){return new Set()}
 _conditionToggleNotify(rows){for(const [id,value] of Object.entries(rows))fire("pf1ToggleActorCondition",this,id,value)}
 async setConditions(conditions={},context={}){
  const rows=clone(conditions),remove=[],create=[],result={};
  for(const track of contextPf1.registry.conditions.trackedConditions()){
   const enabled=track.find(s=>rows[s]===true);
   if(enabled)for(const s of track)if(s!==enabled)rows[s]=false;
  }
  for(const [id,value] of Object.entries(rows)){
   if(!contextPf1.registry.conditions.has(id))continue;
   const old=this.statuses.has(id)?this.effects.find(e=>e.statuses.has(id)):null;
   if(value&&!old){
    const c=contextPf1.registry.conditions.get(id),data={name:c.name,img:c.texture,
     statuses:[id,...c.statuses],flags:{pf1:{autoDelete:true}}};
    if(value?.overlay){delete value.overlay;data.flags.core={overlay:true}}
    if(typeof value!=="boolean")merge(data,value);
    create.push(data);result[id]=value;
   }else if(!value&&old){remove.push(old.id);result[id]=false}
  }
  context.pf1??={};context.pf1.updateConditionTracks=false;
  if(remove.length)await this.deleteEmbeddedDocuments("ActiveEffect",remove,context);
  if(create.length)await this.createEmbeddedDocuments("ActiveEffect",create,context);
  this._conditionToggleNotify(result);
  return result;
 }
}
const contextPf1={registry:{conditions},documents:{actor:{ActorPF:TestActor}}};
function makeActor(uuid,{type="npc",hp=5,con=14,nonlethal=0,flags={},traits={living:true},owner=true}={}){
 const actor={uuid,id:uuid.split(".").at(-1),documentName:"Actor",type,flags:clone(flags),items:new Map(),effects:[],
 system:{attributes:{hp:{value:hp,max:20,nonlethal}},abilities:{con:{total:con,damage:0}},traits},
 getFlag(ns,key){return this.flags?.[ns]?.[key]},testUserPermission(){return owner},
 get statuses(){return new Set([...this.allApplicableEffects()].flatMap(e=>e.disabled?[]:[...e.statuses]))},
 *allApplicableEffects(){yield* this.effects;for(const item of this.items.values())if(item.isActive!==false)yield* item.effects??[]},
 async update(changed,options={}){for(const [k,v] of Object.entries(changed))put(this,k,v);fire("updateActor",this,changed,options,game.user.id);return this},
 async createEmbeddedDocuments(kind,rows,options={}){
  if(kind==="ActiveEffect"){
   const effects=rows.map(row=>{
    const id="e"+ ++seq;
    const effect={...clone(row),id,uuid:this.uuid+".ActiveEffect."+id,parent:this,actor:this,disabled:false,
     statuses:new Set(row.statuses),getFlag(ns,k){return this.flags?.[ns]?.[k]},
     async update(changed,o={}){for(const [k,v] of Object.entries(changed))put(this,k,v);fire("updateActiveEffect",this,changed,o,game.user.id);return this}};
    this.effects.push(effect);return effect;
   });
   for(const e of effects)fire("createActiveEffect",e,options,game.user.id);
   return effects;
  }
  assert.equal(kind,"Item");
  const items=[];
  for(const row of rows){
   const id="i"+(++seq);
   const item={...clone(row),id,uuid:this.uuid+".Item."+id,documentName:"Item",actor:this,parent:this,actions:[],scriptCalls:[],
    getFlag(ns,k){return this.flags?.[ns]?.[k]},get isActive(){return this.system?.active!==false},
    async update(changed,o={}){Object.assign(this,changed);fire("updateItem",this,changed,o,game.user.id);return this},
    async delete(o={}){actor.items.delete(id);fire("deleteItem",this,o,game.user.id)}};
   item.effects=(row.effects??[]).map((e,n)=>({...e,uuid:item.uuid+".ActiveEffect."+n,parent:item,actor:this,statuses:new Set(e.statuses),getFlag(ns,k){return this.flags?.[ns]?.[k]},async update(changed,o={}){Object.assign(this,changed);fire("updateActiveEffect",this,changed,o,game.user.id);return this}}));
   item.effect=item.effects[0];this.items.set(id,item);items.push(item);fire("createItem",item,options,game.user.id);
  }
  return items;
 },
 async deleteEmbeddedDocuments(kind,ids,options={}){
  assert.equal(kind,"ActiveEffect");
  const removed=this.effects.filter(e=>ids.includes(e.id));
  this.effects=this.effects.filter(e=>!ids.includes(e.id));
  for(const e of removed)fire("deleteActiveEffect",e,options,game.user.id);
  return removed;
 },
 async getTokenDocument(data){return {toObject:()=>({actorId:this.id,actorLink:data.actorLink})}},
 async delete(){actors.delete(this.id);documents.delete(this.uuid)}
 };
 Object.setPrototypeOf(actor,TestActor.prototype);
 documents.set(uuid,actor);if(uuid.startsWith("Actor."))actors.set(actor.id,actor);
 return actor;
}
function trait(actor,id){
 const item={id,uuid:actor.uuid+".Item."+id,documentName:"Item",type:"feat",actor,parent:actor,isActive:true,effects:[]};
 actor.items.set(id,item);return item;
}
class TestHud{
 constructor(actor){this.actor=actor}
 _getStatusEffectChoices(){
  return Object.fromEntries([...conditions.keys()].map(id=>[id,{id,isActive:this.actor.statuses.has(id)}]).concat(
   [...this.actor.items.values()].filter(i=>i.type==="buff").map(i=>["buff-"+i.id,{title:i.name,isActive:i.isActive}])));
 }
}
class TestEffect{get isTemporary(){return this.visible!==false}}
const CONFIG={Token:{hudClass:TestHud},ActiveEffect:{documentClass:TestEffect}};
const context={game,CONFIG,pf1:contextPf1,Hooks:{on,once:on,callAll:fire},console,
 fromUuid:async uuid=>documents.get(uuid),foundry:{utils:{randomID:()=>"request"+ ++seq,deepClone:clone,mergeObject:merge}},
 Actor:{implementation:{create:async data=>makeActor("Actor.probe"+ ++seq,{flags:data.flags})}},
 Scene:{implementation:{create:async()=>{
  const id="scene"+ ++seq;
  const scene={id,tokens:new Map(),async createEmbeddedDocuments(kind,rows){
   assert.equal(kind,"Token");
   return rows.map(row=>{
    const tokenId="token"+ ++seq,base=actors.get(row.actorId);
    const actor=row.actorLink?base:makeActor("Scene."+id+".Token."+tokenId+".Actor."+base.id,{flags:base.flags});
    const token={id:tokenId,actor};this.tokens.set(tokenId,token);return token;
   });
  },async delete(){for(const t of this.tokens.values())if(t.actor.uuid.startsWith("Scene."))documents.delete(t.actor.uuid);scenes.delete(id)}};
  scenes.set(id,scene);return scene;
 }}}
};
context.globalThis=context;
vm.runInNewContext(src,context);fire("init");fire("ready");
const api=addon.api.healthConditions;
const tick=async()=>{for(let i=0;i<30;i++)await new Promise(r=>setTimeout(r,0))};
const has=(actor,status)=>actor.statuses.has(status);
const owned=actor=>actor.effects.filter(e=>e.flags?.[NS]?.healthConditionSource?.version===2);
const legacy=actor=>[...actor.items.values()].filter(i=>i.flags?.[NS]?.healthConditionSource);
on("pf1ToggleActorCondition",(actor,id,value)=>notifications.push([actor.uuid,id,value]));
(async()=>{
 assert.equal(api.isAvailable(),false);
 assert.equal(registered.get("healthConditionsEnabled").default,false);
 const a=makeActor("Actor.a");
 await a.update({"system.attributes.hp.value":0});await tick();assert.equal(owned(a).length,0);
 improved.active=true;await assert.rejects(api.probe());improved.active=false;
 const proof=await api.probe();assert.equal(proof.passed,true);
 assert.equal(proof.linked.length,9);assert.equal(proof.unlinked.length,9);
 assert.equal(scenes.size,0);assert.equal(actors.size,1);
 await game.settings.set(NS,"healthConditionsEnabled",true);
 assert.equal(api.isAvailable(),true);
 await api.reconcile(a);
 assert.equal(has(a,"disabled"),true);assert.equal(has(a,"staggered"),true);
 assert.equal(has(a,"dead"),false);assert.equal(has(a,"dying"),false);
 const carrier=owned(a)[0];
 assert.equal(carrier.name,"disabled");assert.equal(carrier.parent,a);assert.equal(legacy(a).length,0);
 assert.equal(carrier.flags.pf1.autoDelete,true);
 const [ordinary]=await a.createEmbeddedDocuments("Item",[{name:"Ordinary buff",type:"buff",system:{active:true}}]);
 const hud=new TestHud(a)._getStatusEffectChoices();assert.equal(hud.disabled.isActive,true);
 assert.equal(Object.keys(hud).filter(k=>k.startsWith("buff-")).length,1);assert.equal(hud["buff-"+ordinary.id].title,"Ordinary buff");
 const getter=Object.getOwnPropertyDescriptor(TestEffect.prototype,"isTemporary").get;
 assert.equal(getter.call(carrier),true);carrier.visible=false;assert.equal(getter.call(carrier),false);carrier.visible=true;
 await a.setCondition("disabled",true);
 const direct=a.effects.find(e=>e!==carrier&&e.statuses.has("disabled"));
 assert.ok(direct);assert.equal(getter.call(carrier),false);assert.equal(getter.call(direct),true);
 await a.setCondition("disabled",false);assert.equal(a.effects.includes(direct),false);assert.equal(has(a,"disabled"),true);
 assert.equal(getter.call(carrier),true);
 // Old carrier migration: a verified v1 Item is deleted, no native state
 // or ordinary buff is lost and the v2 effect retains its identity.
 const [old]=await a.createEmbeddedDocuments("Item",[{name:"PF1AE — disabled",type:"buff",
  flags:{[NS]:{healthConditionSource:{version:1,actorUuid:a.uuid,cause:"lethal",status:"disabled"}}},
  system:{active:true,conditions:["disabled","staggered"]},
  effects:[{name:"disabled",img:"disabled.svg",transfer:true,statuses:["disabled","staggered"],flags:{pf1:{tracker:true}}}]}]);
 await api.reconcile(a);assert.equal(a.items.has(old.id),false);assert.equal(owned(a)[0],carrier);
 assert.equal(a.items.has(ordinary.id),true);assert.equal(has(a,"disabled"),true);
 const s1=trait(a,"source1"),s2=trait(a,"source2");
 await a.update({"system.attributes.hp.value":-3});await tick();
 for(const s of ["dying","unconscious","prone"])assert.equal(has(a,s),true);
 assert.equal(has(a,"disabled"),false);
 await a.setCondition("prone",true);await a.setCondition("sleep",true);
 const r1={actor:a,sourceUuid:s1.uuid,key:"one",suppress:["dying","unconscious","prone"],apply:["disabled"]};
 const r2={actor:a,sourceUuid:s2.uuid,key:"two",suppress:["dying","unconscious"],apply:["disabled"]};
 await api.register(r1);await api.register(r2);
 assert.equal(api.list(a).length,2);
 assert.equal(has(a,"disabled"),true);assert.equal(has(a,"dying"),false);
 assert.equal(has(a,"unconscious"),true,"sleep is independent");
 assert.equal(has(a,"prone"),true,"trip is independent");assert.equal(has(a,"sleep"),true);
 await api.unregister(r1);assert.equal(api.list(a).length,1);assert.equal(has(a,"dying"),false);
 await a.setCondition("sleep",false);await tick();assert.equal(has(a,"unconscious"),false);
 await a.update({"system.attributes.hp.nonlethal":2});await tick();assert.equal(has(a,"unconscious"),true);
 // Lethal and nonlethal causes share one native primary effect.
 const proneCarriers=owned(a).filter(e=>e.flags[NS].healthConditionSource.status==="prone");
 assert.equal(proneCarriers.length,1);
 assert.equal(proneCarriers[0].flags[NS].healthConditionSource.causes.length,2);
 await a.update({"system.attributes.hp.nonlethal":0});await tick();assert.equal(has(a,"unconscious"),false);
 game.user=player;
 const rp=await api.register(r1);assert.equal(rp.queued,true);assert.equal(api.list(a).length,2);
 await api.unregister(r1);assert.equal(api.list(a).length,1);
 game.user=gm;await api.reconcile(a);assert.equal(has(a,"dying"),false);
 a.items.delete(s2.id);fire("deleteItem",s2,{},gm.id);await tick();
 assert.equal(api.list(a).length,0);assert.equal(has(a,"dying"),true);assert.equal(has(a,"stable"),false);
 await a.update({"system.attributes.hp.value":5});await tick();
 assert.equal(has(a,"unconscious"),false);assert.equal(has(a,"helpless"),false);assert.equal(has(a,"dying"),false);assert.equal(has(a,"prone"),true);assert.equal(owned(a).length,0);assert.equal(legacy(a).length,0);
 assert.ok(notifications.some(([uuid,id,v])=>uuid===a.uuid&&id==="unconscious"&&v===false));
 assert.ok(notifications.some(([uuid,id,v])=>uuid===a.uuid&&id==="dying"&&v===false));
 const b=makeActor("Actor.b",{hp:-3});const sb=trait(b,"ferocity");
 await api.reconcile(b);
 await api.register({actor:b,sourceUuid:sb.uuid,key:"exception",suppress:["dying","unconscious","prone"],apply:["disabled"]});
 assert.equal(has(b,"disabled"),true);
 await assert.rejects(api.register({actor:b,sourceUuid:sb.uuid,key:"never",suppress:["dead"]}));
 await b.update({"system.attributes.hp.value":-14});await tick();
 assert.equal(has(b,"dead"),true);assert.equal(owned(b).length,0);assert.equal(api.list(b).length,0);assert.ok(deadSync>=1);
 await b.update({"system.attributes.hp.value":3});await tick();assert.equal(has(b,"dead"),true);
 const undead=makeActor("Actor.undead",{hp:0,con:null,traits:{undead:true,living:false}});
 await api.reconcile(undead);assert.equal(has(undead,"dead"),true);
 const construct=makeActor("Actor.construct",{hp:0,con:null,traits:{construct:true,living:false}});
 await api.reconcile(construct);assert.equal(has(construct,"dead"),true);
 const regen=makeActor("Actor.regen",{hp:-25,traits:{living:true,regen:"5 (acid)"}});
 assert.equal((await api.reconcile(regen)).skipped,"regeneration-manual");assert.equal(has(regen,"dead"),false);
 const st=makeActor("Actor.stable",{hp:-2});
 await st.setCondition("stable",true);await api.reconcile(st);
 assert.equal(has(st,"dying"),false);assert.equal(has(st,"stable"),true);assert.equal(has(st,"unconscious"),true);
 const synth=makeActor("Scene.s.Token.t.Actor.a",{hp:-1});const ss=trait(synth,"x");
 await api.register({actor:synth,sourceUuid:ss.uuid,key:"unique",suppress:["unconscious","prone","dying"],apply:["disabled"]});
 assert.equal(has(synth,"disabled"),true);assert.equal(has(a,"disabled"),false);
 assert.equal(legacy(synth).length,0);assert.equal(owned(synth)[0].parent,synth);
 const combat={id:"c",started:true};combats.set("c",combat);
 await api.register({actor:synth,sourceUuid:ss.uuid,key:"combat-bound",combatId:"c",suppress:["dying"]});
 combats.delete("c");await api.reconcile(synth);assert.equal(api.list(synth).length,1);
 await assert.rejects(api.register({actor:synth,sourceUuid:s1.uuid,key:"bad",suppress:["dying"]}));
 const noOwner=makeActor("Actor.noowner",{owner:false});const sn=trait(noOwner,"no");
 game.user=player;await assert.rejects(api.register({actor:noOwner,sourceUuid:sn.uuid,key:"x",suppress:["dying"]}));game.user=gm;
 improved.active=true;assert.equal(api.isAvailable(),false);await assert.rejects(api.reconcile(a));
 improved.active=false;await game.settings.set(NS,"healthConditionsEnabled",false);await tick();
 assert.equal(owned(st).length,0);assert.equal(has(st,"stable"),true);assert.equal(api.isAvailable(),false);
 console.log("PASS direct native health source policy, protected native routing, notifications, legacy migration, independent conditions, linked/synthetic actors and opt-in probe (simulation)");
})().catch(err=>{console.error(err);process.exitCode=1});
