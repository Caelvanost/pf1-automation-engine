'use strict';
/** Native PF1 action-card origin integration test. Node mock of Foundry v13
 * hooks, PF1 ActionUse and PF1 Actor.rollSavingThrow; NOT a live PF1 test. */
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const engine=fs.readFileSync(path.join(__dirname,'../scripts/save-overrides.js'),'utf8');
const bridge=fs.readFileSync(path.join(__dirname,'../scripts/save-context.js'),'utf8');
const NS='pf1-automation-engine';
const users=[
  {id:'GM',isGM:true,active:true},
  {id:'BARD',isGM:false,active:true},
  {id:'P1',isGM:false,active:true},
  {id:'P2',isGM:false,active:true}
];
users.get=id=>users.find(u=>u.id===id);
const log=[],messages=new Map(),socket=new Map(),settings=new Map(),summaries=[];
const gmActor={id:'H',uuid:'Actor.H',name:'Harpy',documentName:'Actor'};
const bard={id:'B',uuid:'Actor.B',name:'Bard',documentName:'Actor',
  system:{conditions:{}},statuses:new Set(),
  getFlag(ns,key){return ns==='world'&&key==='pf1CountersongState'?{checkTotal:23}:null;},
  testUserPermission(user){return user.isGM||user.id==='BARD';}
};
function target(id,user){
  return {id,uuid:'Actor.'+id,name:'Janis '+id,documentName:'Actor',
    system:{conditions:{}},statuses:new Set(),isOwner:true,
    testUserPermission(u){return u.isGM||u.id===user;}};
}
const p1=target('P1','P1'),p2=target('P2','P2');
const sourceItem={id:'S',uuid:'Actor.H.Item.S',name:'Captivating Song',
  documentName:'Item',type:'feat',actor:gmActor,
  system:{abilityType:'su',tags:new Set(['sonic','mind-affecting','charm'])},
  getFlag(){return null;}};
const otherItem={...sourceItem,id:'N',uuid:'Actor.H.Item.N',
  name:'Unrelated Supernatural',system:{abilityType:'su',tags:new Set(['charm'])}};
const docs=new Map([gmActor,bard,p1,p2,sourceItem,otherItem].map(d=>[d.uuid,d]));
const scene={id:'scene',grid:{units:'ft'},tokens:[]};
function token(actor,x) {return {uuid:'Scene.scene.Token.'+actor.id,center:{x,y:0},actor};}
scene.tokens.push(token(bard,0),token(p1,60),token(p2,80));
const groups=[{id:'countersong-group',sourceUuid:bard.uuid,key:'countersong',
  pendingCleanup:false,copies:[{actorUuid:p1.uuid},{actorUuid:p2.uuid}]}];
let sequence=0;
function client(user){
  const listeners=new Map();
  const mod={active:true,api:{effectGroups:{listGroups:()=>groups}}};
  const game={user,users,modules:new Map([[NS,mod]]),messages,actors:new Map([p1,p2,bard].map(a=>[a.id,a])),
    scenes:{active:scene},
    settings:{
      register(ns,key,spec){
        if(!settings.has(ns+'.'+key))settings.set(ns+'.'+key,structuredClone(spec.default));
      },
      get(ns,key){
        if(key==='genericEnabled')return true;
        if(key==='genericDebug')return false;
        return settings.get(ns+'.'+key);
      },
      async set(ns,key,value){settings.set(ns+'.'+key,structuredClone(value));return value;}
    },
    socket:{
      on(ch,fn){socket.set(ch,[...(socket.get(ch)??[]),fn]);},
      emit(ch,payload){for(const fn of socket.get(ch)??[])fn(structuredClone(payload));}
    }
  };
  const Hooks={
    on(n,fn){listeners.set(n,[...(listeners.get(n)??[]),fn]);},
    once(n,fn){this.on(n,fn);},
    callAll(n,...args){for(const fn of listeners.get(n)??[])fn(...args);return true;},
    async fire(n,...args){for(const fn of listeners.get(n)??[])await fn(...args);}
  };
  const canvas={scene,tokens:{controlled:[]},grid:{
    size:10,measurePath(pts){return {distance:Math.hypot(
      pts[0].x-pts[1].x,pts[0].y-pts[1].y)/10};}
  }};
  const ChatMessage={implementation:{
    getSpeaker({actor}){return {actor:actor.id};},
    async create(d){
      const m={id:'sum-'+(++sequence),content:d.content,
        whisper:d.whisper,blind:d.blind};
      summaries.push(m);return m;
    }
  }};
  const context={Hooks,game,canvas,ChatMessage,
    CONFIG:{Canvas:{polygonBackends:{
      sound:{testCollision(){return false;}},
      sight:{testCollision(){return false;}}
    }}},
    foundry:{utils:{deepClone:structuredClone,randomID:()=>'nonce-'+(++sequence)}},
    fromUuid:async id=>docs.get(id)??null,
    setTimeout,clearTimeout,
    console:{debug:(...a)=>log.push(a),warn:(...a)=>log.push(a),error:(...a)=>log.push(a)}
  };
  vm.runInNewContext(engine,context,{filename:'save-overrides.js'});
  vm.runInNewContext(bridge,context,{filename:'save-context.js'});
  return {game,Hooks,api:()=>mod.api,start:async()=>{
    await Hooks.fire('init');await Hooks.fire('ready');
  }};
}
const nativeMessage=(user,actor,total,{blind=false,whisper=[]}={})=>{
  const m={id:'save-'+(++sequence),documentName:'ChatMessage',
    author:{id:user.id},speaker:{actor:actor.id},
    rolls:[{total}],blind,whisper,flags:{},
    getFlag(ns,key){return this.flags?.[ns]?.[key]??null;},
    async setFlag(ns,key,value){
      this.flags[ns]??={};this.flags[ns][key]=value;return this;
    }};
  messages.set(m.id,m);return m;
};
function renderButton(client,card,actor,action='target-save'){
  const html={handlers:{},addEventListener(type,handler,capture){
    assert.equal(capture,true);this.handlers[type]=handler;
  }};
  return client.Hooks.fire('renderChatMessageHTML',card,html,{}).then(()=>{
    const button={dataset:{action,actorId:actor.id},parentElement:html,
      closest(){return this;},getAttribute(){return ''}};
    html.handlers.click({target:button,currentTarget:html});
  });
}
async function settle(){for(let i=0;i<30;i++)await new Promise(r=>setTimeout(r,0));}
(async()=>{
  const gm=client(users[0]),bardClient=client(users[1]),
    pc1=client(users[2]),pc2=client(users[3]);
  for(const c of [gm,bardClient,pc1,pc2])await c.start();
  await gm.api().saveOverrides.register({actor:bard,key:'countersong',groupKey:'countersong',
    range:30,rangeUnits:'ft',requiresHearing:true,
    appliesTo:{magical:true,anyOf:['sonic','languageDependent']},
    replacement:{type:'actorFlag',namespace:'world',
      key:'pf1CountersongState',path:'checkTotal'}});
  const a1={id:'A1',hasSave:true,save:{type:'will',dc:16},getDC(){return 16}};
  const use={item:sourceItem,action:a1,shared:{rollData:{},chatData:{}}};
  await gm.Hooks.fire('pf1PreDisplayActionUse',use);
  const persisted=structuredClone(use.shared.chatData.flags);
  assert.equal(persisted[NS].saveContext.sourceItemUuid,sourceItem.uuid);
  assert.equal(persisted[NS].saveContext.sourceActionId,'A1');
  assert.equal(persisted[NS].saveContext.saveDC,16);
  const card={id:'source-card',itemSource:sourceItem,actionSource:a1,flags:persisted,
    targets:scene.tokens.slice(1),system:{save:{dc:16}},
    getFlag(ns,key){return this.flags?.[ns]?.[key]??null;}};
  messages.set(card.id,card);
  async function doSave(client,actor,normal,privacy){
    actor.rollSavingThrow=async(type,options)=>{
      await client.Hooks.fire('pf1PreActorRollSave',actor,options,type);
      const m=nativeMessage(client.game.user,actor,normal,privacy);
      await client.Hooks.fire('pf1ActorRollSave',actor,m,type);
      return m;
    };
    return actor.rollSavingThrow('will',{});
  }
  // An ordinary sheet save is NOT annotated.
  const manual=await doSave(pc1,p1,16);
  await settle();
  assert.equal(manual.getFlag(NS,'saveOverride'),null);
  assert.equal(summaries.length,0);
  // Native card click: existing PF1 roller remains the one that rolls.
  await renderButton(pc1,card,p1);
  const saved=await doSave(pc1,p1,16);
  await settle();
  const decision=saved.getFlag(NS,'saveOverride');
  assert.equal(decision?.processed,true);
  assert.equal(decision.normalTotal,16);
  assert.equal(decision.effectiveTotal,23);
  assert.equal(decision.changed,true);
  assert.equal(decision.sourceActionId,'A1');
  assert.equal(decision.saveDC,16);
  assert.equal(decision.sourceMessageId,card.id);
  assert.equal(saved.rolls[0].total,16);
  assert.equal(summaries.length,1);
  assert.match(summaries[0].content,/Result used: 23/);
  // Second player, same source card, distinct save, private chat summary.
  await renderButton(pc2,card,p2);
  const otherSave=await doSave(pc2,p2,16,{whisper:['GM'],blind:true});
  await settle();
  assert.equal(otherSave.getFlag(NS,'saveOverride').effectiveTotal,23);
  assert.equal(summaries.length,2);
  assert.equal(summaries[1].blind,true);
  assert.deepEqual(summaries[1].whisper,['GM']);
  // A new client after F5 can recover from persisted source card metadata.
  const reloaded=client(users[2]);await reloaded.start();
  await renderButton(reloaded,card,p1,'rollSavingThrow');
  const recovered=await doSave(reloaded,p1,17);
  await settle();
  assert.equal(recovered.getFlag(NS,'saveOverride').effectiveTotal,23);
  // An unrelated supernatural source has no valid candidates => no spam.
  const otherAction={id:'N1',hasSave:true,save:{type:'will',dc:15},getDC(){return 15}};
  const otherUse={item:otherItem,action:otherAction,shared:{rollData:{},chatData:{}}};
  await gm.Hooks.fire('pf1PreDisplayActionUse',otherUse);
  const noOverrideCard={...card,id:'unrelated-card',itemSource:otherItem,
    actionSource:otherAction,flags:structuredClone(otherUse.shared.chatData.flags)};
  messages.set(noOverrideCard.id,noOverrideCard);
  await renderButton(pc1,noOverrideCard,p1);
  const before=summaries.length;
  const unrelated=await doSave(pc1,p1,18);
  await settle();
  assert.equal(unrelated.getFlag(NS,'saveOverride').normalTotal,18);
  assert.equal(unrelated.getFlag(NS,'saveOverride').effectiveTotal,18);
  assert.equal(unrelated.getFlag(NS,'saveOverride').changed,false);
  assert.equal(summaries.length,before);
  console.log('PASS native ActionUse→ChatMessage→player save: Will 16, Countersong 23 = effective 23');
  console.log('PASS second target and blind GM whisper: one summary per PF1 save, privacy retained');
  console.log('PASS F5 re-render, source action ID and save DC persist');
  console.log('PASS unrelated sheet save: no context, no override');
  console.log('PASS non-sonic action save: effective 18=18, no additional chat');
})().catch(error=>{console.error(error);process.exitCode=1;});
