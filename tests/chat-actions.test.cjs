'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../scripts/chat-actions.js'),'utf8');
const NS='pf1-automation-engine';
const userGM={id:'gm',isGM:true,active:true};
const userP={id:'player',isGM:false,active:true,targets:new Set()};
const userX={id:'other',isGM:false,active:true,targets:new Set()};
const users=[userGM,userP,userX];
users.get=id=>users.find(x=>x.id===id);
let sequence=0,effects=0,confirmations=0;
const ids=()=>String(++sequence);
const world={
 source:{uuid:'Actor.source',documentName:'Actor',owners:['player'],flags:{},statuses:new Set()},
 target:{uuid:'Actor.target',documentName:'Actor',owners:['player'],flags:{},statuses:new Set()},
 enemy:{uuid:'Actor.enemy',documentName:'Actor',owners:['other'],flags:{},statuses:new Set()}
};
const messages=new Map(),clients=[];
function clone(v){return structuredClone(v)}
function client(user){
 const once=new Map(),listeners=new Map(),ctx={};
 let selected=[],targeted=[];
 function actorFor(data){
  return {uuid:data.uuid,documentName:'Actor',statuses:data.statuses,name:data.uuid,
   testUserPermission(requester,level){return level==='OWNER'&&data.owners.includes(requester.id)},
   getFlag(ns,key){return clone(data.flags[ns]?.[key]??null)},
   async setFlag(ns,key,value){
    if(!user.isGM&&!data.owners.includes(user.id))throw Error('Server denied Actor UPDATE');
    data.flags[ns]??={};data.flags[ns][key]=clone(value);
    const changed={flags:{[ns]:{[key]:clone(value)}}};
    for(const other of clients){
     const otherActor=other.actorFor(data);
     Promise.resolve().then(async()=>{
      for(const hook of other.listeners.get('updateActor')??[])
       await hook(otherActor,changed,{},user.id);
     }).catch(error=>{console.error('async updateActor hook failed',error);process.exitCode=1});
    }
    return this;
   },
   async setCondition(id,value){
    if(!user.isGM&&!data.owners.includes(user.id))throw Error('Server denied condition change');
    if(value===false)data.statuses.delete(id);
    else data.statuses.add(id);
    effects++;
   }
  };
 }
 function itemFor(){
  return {uuid:'Actor.source.Item.utility',documentName:'Item',
   actor:actorFor(world.source),name:'Utility Shot'};
 }
 function tokenFor(data){
  return {uuid:'Scene.s.Token.'+data.uuid.split('.')[1],documentName:'Token',
   actor:actorFor(data)};
 }
 const token=(data)=>({actor:actorFor(data),document:tokenFor(data)});
 const messagesFacade={get(id){return messages.get(id)}};
 const chatClass={
  getSpeaker({actor}){return {actor:actor.uuid}},
  async create(data){
   if(!user.isGM)throw Error('Only the GM can create authoritative Chat Actions');
   const id=ids();
   const message={id,uuid:'ChatMessage.'+id,user,content:data.content,
    flags:clone(data.flags??{}),
    getFlag(ns,key){return clone(this.flags[ns]?.[key]??null)},
    async setFlag(ns,key,value){
     if(!user.isGM)throw Error('Server denied ChatMessage UPDATE');
     this.flags[ns]??={};
     this.flags[ns][key]=clone(value);
     return this;
    }};
   messages.set(id,message);
   if(!data.flags)confirmations++;
   return message;
  }
 };
 const map=new Map([[NS,{active:true,api:{}}]]);
 const game={user,users,modules:map,messages:messagesFacade};
 const canvas={tokens:{get controlled(){return selected}}};
 const actorDoc=data=>actorFor(data);
 const byUuid=async uuid=>{
  if(uuid==='Actor.source.Item.utility')return itemFor();
  for(const data of Object.values(world)){
   if(uuid===data.uuid)return actorFor(data);
   if(uuid===tokenFor(data).uuid)return tokenFor(data);
  }
  return null;
 };
 const hooks={
  once(name,fn){(once.get(name)??once.set(name,[]).get(name)).push(fn)},
  on(name,fn){(listeners.get(name)??listeners.set(name,[]).get(name)).push(fn)}
 };
 Object.assign(ctx,{
  console,Date,Map,Set,Promise,setTimeout,clearTimeout,
  game,canvas,ChatMessage:chatClass,
  foundry:{utils:{randomID:ids,deepClone:clone}},fromUuid:byUuid,Hooks:hooks,
  ui:{notifications:{warn(error){throw Error('Unexpected UI warning: '+error)}}}
 });
 ctx.globalThis=ctx;
 vm.createContext(ctx);
 vm.runInContext(source,ctx,{filename:'chat-actions.js'});
 const obj={ctx,game,actorFor,itemFor,tokenFor,token,once,listeners,
  select(...values){selected=values.map(data=>token(data))},
  target(...values){targeted=values.map(data=>token(data));user.targets=new Set(targeted)}};
 clients.push(obj);
 for(const fn of once.get('ready')??[])fn();
 return obj;
}
const gm=client(userGM),player=client(userP),other=client(userX);
const handlerOptions={sourceItemUuid:'Actor.source.Item.utility'};
gm.game.modules.get(NS).api.chatActions.registerHandler('test.stop',async ({actor})=>{
 if(!actor.statuses.has('bleed'))return {ok:false,reason:'No Bleed'};
 await actor.setCondition('bleed',false);
 return {ok:true,confirmation:'Bleeding stopped'};
},handlerOptions);
const apiGM=gm.game.modules.get(NS).api.chatActions;
const apiP=player.game.modules.get(NS).api.chatActions;
const apiX=other.game.modules.get(NS).api.chatActions;
const props={
 actor:player.actorFor(world.source),sourceItem:player.itemFor(),
 title:'Utility Shot — Stop Bleeding',content:'Choose a bleeding ally.',
 buttons:[{id:'stop',label:'Stop bleeding',handlerKey:'test.stop',
  icon:'fa-solid fa-heart-pulse',once:true,targetMode:'controlled',
  permission:'OWNER',exactOne:true}]
};
async function create(){const r=await apiP.create(props);return messages.get(r.id)}
const state=m=>m.getFlag(NS,'chatActions');
async function reject(p,pattern){await assert.rejects(p,pattern)}
(async()=>{
 const msg=await create();
 assert.equal(msg.user.id,'gm','GM, not player, owns persisted flags');
 assert.equal(state(msg).buttons[0].status,'ready');
 player.select();
 await reject(apiP.click(msg.id,'stop'),/exactly one/i);
 player.select(world.target,world.target);
 await reject(apiP.click(msg.id,'stop'),/exactly one/i);
 player.select(world.enemy);
 await reject(apiP.click(msg.id,'stop'),/OWNER/i);
 other.select(world.target);
 await reject(apiX.click(msg.id,'stop'),/OWNER/i);
 player.select(world.target);
 const denied=await apiP.click(msg.id,'stop');
 assert.equal(denied.ok,false,'no Bleed must not consume button');
 assert.equal(state(msg).buttons[0].status,'ready');
 assert.equal(effects,0);
 world.target.statuses.add('bleed');
 assert.equal((await apiP.click(msg.id,'stop')).ok,true);
 assert.equal(world.target.statuses.has('bleed'),false);
 assert.equal(effects,1);
 assert.equal(confirmations,1);
 assert.equal(state(msg).buttons[0].status,'used');
 await reject(apiP.click(msg.id,'stop'),/already been used/i);
 assert.equal(effects,1,'one-shot resolves only once');
 const contested=await create();
 world.target.statuses.add('bleed');
 player.select(world.target);gm.select(world.target);
 const results=await Promise.allSettled([
  apiP.click(contested.id,'stop'),apiGM.click(contested.id,'stop')
 ]);
 assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value?.ok).length,1,
  'only one concurrent GM/player click can resolve');
 assert.equal(effects,2,'no duplicate condition mutation');
 assert.equal(state(contested).buttons[0].status,'used');
 // The card author and target owner can be different players. Only
 // ownership of the SELECTED actor authorizes a click.
 const crossOwner=await create();
 world.enemy.statuses.add('bleed');
 other.select(world.enemy);
 assert.equal((await apiX.click(crossOwner.id,'stop')).ok,true,
  'a different player can act on their own target');
 assert.equal(world.enemy.statuses.has('bleed'),false);
 assert.equal(state(crossOwner).buttons[0].status,'used');
 // Direct attempts to forge another user's identity through payload flags
 // cannot bypass the server-authenticated userId of updateActor.
 other.select(world.target);
 await reject(other.actorFor(world.target).setFlag(NS,'chatActionClickRequest',{
  requestId:'forged',messageId:msg.id,buttonId:'stop',
  tokenUuids:[other.tokenFor(world.target).uuid],userId:'player'
 }),/Server denied/);
 // A fresh client (F5/reconnect) installs its own UI and request handlers.
 const refreshed=client(userP),fresh=refreshed.game.modules.get(NS).api.chatActions;
 const next=await create();
 world.target.statuses.add('bleed');
 refreshed.select(world.target);
 assert.equal((await fresh.click(next.id,'stop')).ok,true);
 assert.equal(effects,4);
 refreshed.select();
 await reject(fresh.click(next.id,'stop'),/already been used/i);
 // Different scene: no selected token; never apply action to a stale target.
 const nextScene=await create();
 refreshed.select();
 await reject(fresh.click(nextScene.id,'stop'),/exactly one/i);
 assert.equal(state(nextScene).buttons[0].status,'ready');
 // Targeted mode uses T rather than controlled tokens.
 const targeted=await apiP.create({...props,buttons:[{...props.buttons[0],
  id:'target',targetMode:'targeted'}]});
 const targetMsg=messages.get(targeted.id);
 player.select();player.target(world.target);
 world.target.statuses.add('bleed');
 assert.equal((await apiP.click(targetMsg.id,'target')).ok,true);
 assert.equal(effects,5);
 // An older v1.27.0 Chat Actions card remains valid even without
 // createdBy and after its original publisher loses their former role.
 const legacy=await create();
 const legacyState=state(legacy);
 delete legacyState.createdBy;
 await legacy.setFlag(NS,'chatActions',legacyState);
 world.target.statuses.add('bleed');
 player.select(world.target);
 assert.equal((await apiP.click(legacy.id,'stop')).ok,true);
 assert.equal(state(legacy).buttons[0].status,'used');
 assert.equal(effects,6,'legacy card resolved via currently authorized GM handler');
 // Missing GM handlers: fail closed, no card created.
 await reject(apiP.create({...props,buttons:[{...props.buttons[0],
  id:'unknown',handlerKey:'unregistered'}]}),/handler unavailable/i);
 // Handler throws after entering the critical section: persistent pending,
 // manual GM-only reset required.
 gm.game.modules.get(NS).api.chatActions.registerHandler('test.fail',
  async()=>{throw Error('Partial side effect may have happened')},handlerOptions);
 const failure=await apiP.create({...props,buttons:[{...props.buttons[0],
  id:'fail',handlerKey:'test.fail'}]});
 const failMsg=messages.get(failure.id);
 player.select(world.target);
 await reject(apiP.click(failMsg.id,'fail'),/pending GM review/i);
 assert.equal(state(failMsg).buttons[0].status,'pending');
 await reject(apiP.click(failMsg.id,'fail'),/already been used or is pending/i);
 await reject(apiP.reset({messageId:failMsg.id,buttonId:'fail'}),/elected GM/);
 assert.equal(await apiGM.reset({messageId:failMsg.id,buttonId:'fail'}),true);
 assert.equal(state(failMsg).buttons[0].status,'ready');
 // Foundry v13 render hook reconstructs buttons from stored message flags.
 // No listener from an Item Script Call is required on the viewing client.
 const htmlClient=client(userX);
 function fakeDom(){
  const container={
   children:[],
   querySelector(selector){
    if(selector==='[data-pf1ae-chat-actions]')
     return this.children.find(x=>x.dataset?.pf1aeChatActions)??null;
    return null;
   },
   append(node){this.children.push(node)}
  };
  return {container,
   querySelector(selector){return selector==='.message-content'?container:null;}};
 }
 htmlClient.ctx.document={
  createElement(tag){return {tag,children:[],dataset:{},style:{},
   className:'',disabled:false,listeners:{},
   append(...children){this.children.push(...children)},
   setAttribute(name,value){this[name]=value},
   addEventListener(name,fn){this.listeners[name]=fn}
  }},
  createTextNode(value){return {textContent:value}}
 };
 const renderFn=htmlClient.listeners.get('renderChatMessageHTML')[0];
 const readyHTML=fakeDom();
 renderFn(nextScene,readyHTML);
 assert.equal(readyHTML.container.children.length,1);
 assert.equal(readyHTML.container.children[0].children.length,1);
 assert.equal(readyHTML.container.children[0].children[0].disabled,false,
  'available button reconstructed in a fresh client');
 const usedHTML=fakeDom();
 renderFn(msg,usedHTML);
 assert.equal(usedHTML.container.children[0].children[0].disabled,true,
  'used button reconstructed disabled after reconnect');
 renderFn(msg,usedHTML);
 assert.equal(usedHTML.container.children.length,1,'render must be idempotent');
 console.log('PASS Chat Actions: authenticated requests, GM message authority, OWNER/GM permissions,');
 console.log(' controlled/targeted, single selection, Bleed success/failure, atomic once, concurrency,');
 console.log(' cross-owner permissions, forged user denial, F5, scene change, missing handler and GM reset.');
})().catch(err=>{console.error(err);process.exitCode=1});
