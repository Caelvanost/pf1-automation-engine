'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.resolve(__dirname,'../scripts/chat-action-bootstrap.js'),'utf8');
const approvals=fs.readFileSync(path.resolve(__dirname,'../scripts/script-approvals.js'),'utf8');
const NS='pf1-automation-engine';
const users=[
 {id:'gm-a',isGM:true,active:true},
 {id:'gm-b',isGM:true,active:true},
 {id:'player',isGM:false,active:true}
];
users.get=id=>users.find(u=>u.id===id);
const actor={uuid:'Actor.zephyr',documentName:'Actor',
 testUserPermission(user,level){return level==='OWNER'&&user.id==='player'}};
let source='approved source',executions=0,removed=0;
const call={id:'call-chat',category:'toggle',name:'PF1AE:bootstrap',
 _source:{id:'call-chat',category:'toggle',name:'PF1AE:bootstrap',script:source},
 async execute(shared,extra){
  assert.equal(shared.action,null,'native bootstrap does not use/toggle Item');
  assert.equal(extra.state,null,'native toggle is not simulated');
  assert.equal(extra.bootstrap.restoring,true);
  if(!extra.bootstrap.chatActions)return;
  extra.bootstrap.registerChatActionHandler('utility-shot.stop-bleeding',async context=>{
   executions++;
   if(!context.actor.bleed)return {ok:false,reason:'No bleed'};
   context.actor.bleed=false;return {ok:true};
  });
 }};
const item={uuid:actor.uuid+'.Item.utility',documentName:'Item',actor,
 scriptCalls:{contents:[call]}};
actor.items={contents:[item]};
const settings=new Map([['genericEnabled',true],['trustedTableMode',false],
 ['scriptFallbackApprovals',[]]]);
const docs=new Map([[actor.uuid,actor],[item.uuid,item]]);
const clients=[];
function client(user){
 const callbacks=new Map(),events=new Map(),handlers=new Map(),ctx={};
 const mod={active:true,api:{}};
 const hooks={once(name,fn){(callbacks.get(name)??callbacks.set(name,[]).get(name)).push(fn)},
 on(name,fn){(events.get(name)??events.set(name,[]).get(name)).push(fn)},
 callAll(name,...args){for(const fn of events.get(name)??[])fn(...args)}};
 const runtime={
  user,callbacks,events,handlers,mod,ctx,
  install(){
   for(const cb of callbacks.get('init')??[])cb();
   for(const cb of callbacks.get('ready')??[])cb();
  }
 };
 const game={
  user,users,actors:{contents:[actor]},scenes:{contents:[]},
  modules:new Map([[NS,mod]]),
  settings:{
   get(_ns,key){return settings.get(key)},
   register(_ns,key,options){if(!settings.has(key))settings.set(key,options.default)},
   async set(_ns,key,value){
    settings.set(key,value);
    for(const c of clients)
     for(const fn of c.events.get('updateSetting')??[])fn({});
    return value;
   }
  }
 };
 Object.assign(ctx,{console,Map,Set,Date,Promise,game,Hooks:hooks,
  fromUuid:async uuid=>docs.get(uuid)??null,
  foundry:{utils:{deepClone:structuredClone}}});
 ctx.globalThis=ctx;
 clients.push(runtime);
 vm.createContext(ctx);
 vm.runInContext(approvals,ctx,{filename:'script-approvals.js'});
 // Chat Actions core API is available by the time the new ready hook fires.
 mod.api.chatActions={
  registerHandler(key,fn,{sourceItemUuid}={}){
   assert.equal(sourceItemUuid,item.uuid,'exact source Item required');
   if(handlers.has(key))throw Error('Handler key collision');
   handlers.set(key,fn);
   return ()=>{
    if(handlers.get(key)===fn){handlers.delete(key);removed++;}
   };
  }
 };
 vm.runInContext(code,ctx,{filename:'chat-action-bootstrap.js'});
 runtime.install();
 return runtime;
}
const a=client(users[0]),b=client(users[1]),p=client(users[2]);
const api=c=>c.mod.api.chatActionBootstrap;
const key='utility-shot.stop-bleeding';
const scan=async()=>Promise.all(clients.map(c=>api(c).scan()));
(async()=>{
 // A player's native bootstrap is visible but cannot execute as GM without approval.
 await scan();
 assert.equal(a.handlers.size,0,'unapproved code must not run on GM');
 assert.equal(b.handlers.size,0);
 assert.equal(p.handlers.size,0,'player does not register GM handler');
 // Individual approval grants this exact Actor / Item / Script source.
 await a.mod.api.scriptApprovals.approve({actor,item,scriptId:call.id});
 await scan();
 assert.equal(a.handlers.size,1,'elected GM auto-registers approved declaration');
 assert.equal(b.handlers.size,0,'unelected GM never registers');
 assert.equal(p.handlers.size,0);
 const before=a.handlers.get(key);
 const target={bleed:true};
 assert.equal((await before({actor:target})).ok,true);
 assert.equal(target.bleed,false);
 const count=removed;
 await scan();await scan();
 assert.equal(a.handlers.get(key),before,'repeat restores do not duplicate');
 assert.equal(removed,count);
 // The script source changes before the update hook; even a stale closure
 // must reject the click without executing any player-edited code.
 const attempts=executions;
 call._source.script='modified without reapproval';
 const stale=await before({actor:{bleed:true}});
 assert.equal(stale.ok,false,'changed declaration invalidated at click-time');
 assert.equal(executions,attempts);
 await scan();
 assert.equal(a.handlers.size,0,'modification cleans up stale registered handler');
 // Reapproval explicitly accepts the NEW native script fingerprint.
 await a.mod.api.scriptApprovals.approve({actor,item,scriptId:call.id});
 await scan();
 assert.equal(a.handlers.size,1);
 assert.notEqual(a.handlers.get(key),before,'fresh handler installed');
 // Delete Script Call while the Item remains.
 item.scriptCalls.contents=[];
 await scan();
 assert.equal(a.handlers.size,0,'removing Script Call unregisters it');
 item.scriptCalls.contents=[call];
 await scan();
 assert.equal(a.handlers.size,1,'restoring native Script Call restores handler');
 // Delete Item from Actor / UUID resolution.
 actor.items.contents=[];
 docs.delete(item.uuid);
 await scan();
 assert.equal(a.handlers.size,0,'deleting Item unregisters handler');
 actor.items.contents=[item];docs.set(item.uuid,item);
 await scan();
 assert.equal(a.handlers.size,1);
 // Elected GM handover: the old GM cleans up, the new elected GM installs
 // from the same approved persistent Script Call without any manual macro.
 users[0].active=false;
 await scan();
 assert.equal(a.handlers.size,0);
 assert.equal(b.handlers.size,1);
 const newLeaderHandler=b.handlers.get(key);
 assert.equal((await newLeaderHandler({actor:{bleed:false}})).ok,false);
 // A second GM client after F5 automatically restores from the world item.
 const refreshed=client(users[1]);
 await api(refreshed).scan();
 assert.equal(refreshed.handlers.size,1,'new client restores without manual macro');
 // Switch off all GMs: no user becomes the elected executor.
 users[1].active=false;await scan();
 assert.equal(b.handlers.size,0);
 assert.equal(refreshed.handlers.size,0);
 // Trusted mode is explicit opt-in; it authorizes only PF1AE's exact native
 // bootstrap name, not arbitrary toggles or arbitrary JavaScript via socket.
 users[0].active=true;
 await a.mod.api.scriptApprovals.revoke({actor,item,scriptId:call.id});
 await scan();assert.equal(a.handlers.size,0,'revocation must block');
 settings.set('trustedTableMode',true);
 await scan();assert.equal(a.handlers.size,1,'explicit trusted mode approves named PF1AE bootstrap');
 settings.set('trustedTableMode',false);
 await scan();assert.equal(a.handlers.size,0,'disabling trusted mode revokes shortcut');
 const fake={...call,name:'Some Other Toggle'};
 item.scriptCalls.contents=[fake];
 settings.set('trustedTableMode',true);
 await scan();assert.equal(a.handlers.size,0,'other toggle names are not executed');
 item.scriptCalls.contents=[call];
 await scan();assert.equal(a.handlers.size,1);
 // Module disabled: no handlers remain active, even in trusted mode.
 a.mod.active=false;
 await api(a).scan();
 assert.equal(a.handlers.size,0,'disabled module removes handlers');
 console.log('PASS Chat Action Bootstrap: discovery, approvals, trusted on/off, edit/revoke/delete,');
 console.log(' GM election/F5, exact Item binding, click-time validation, cleanup and deduplication.');
})().catch(err=>{console.error(err);process.exitCode=1});
