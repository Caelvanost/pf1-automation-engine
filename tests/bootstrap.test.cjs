'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../scripts/bootstrap.js'),'utf8');
const approvalSource=fs.readFileSync(path.resolve(__dirname,'../scripts/script-approvals.js'),'utf8');
const ns='pf1-automation-engine',setting=new Map([['genericEnabled',true],['genericDebug',false]]);
const users=[{id:'gm',isGM:true,active:true},{id:'player',isGM:false,active:true},{id:'other',isGM:false,active:true}];
users.get=id=>users.find(u=>u.id===id);
const actor={documentName:'Actor',uuid:'Scene.s.Token.t.Actor.a',
 testUserPermission:(user,perm)=>perm==='OWNER'&&user.id==='player'};
let installed=0,removed=0,handled=0,lastContext=null;
const call={id:'toggle-1',category:'toggle',name:'PF1AE:bootstrap',
 _source:{id:'toggle-1',category:'toggle',name:'PF1AE:bootstrap',script:'// owner-controlled native bootstrap'},
 async execute(shared,extra){
 installed++;lastContext=extra;assert.equal(shared.action,null);
 assert.equal(extra.bootstrap.restoring,true);assert.equal(extra.state,null);
 extra.bootstrap.listen('pf1CreateActionUse',()=>{handled++});
 extra.bootstrap.onCleanup(()=>{removed++});
}};
const item={documentName:'Item',uuid:actor.uuid+'.Item.i',actor,scriptCalls:{contents:[call]}};
const docs=new Map([[actor.uuid,actor],[item.uuid,item]]);
const instances=new Map(),onChanges=new Map();
function client(user){
 const callbacks=new Map(),events=new Map(),mod={active:true,api:{}};
 const ctx={console,Date,Map,Set,Promise,setTimeout,clearTimeout,
  foundry:{utils:{randomID:()=>`${user.id}-${Math.random()}`,deepClone:structuredClone}},
  fromUuid:async id=>docs.get(id)??null,
  Hooks:{once(name,fn){(callbacks.get(name)??callbacks.set(name,[]).get(name)).push(fn)},
   on(name,fn){(events.get(name)??events.set(name,[]).get(name)).push(fn)},
   off(name,fn){const list=events.get(name)??[];events.set(name,list.filter(x=>x!==fn))}},
  game:{user,users,modules:new Map([[ns,mod]]),
   settings:{get(_ns,key){return setting.get(key)},register(_ns,key,options){if(!setting.has(key))setting.set(key,structuredClone(options.default));onChanges.set(user.id+':'+key,options.onChange)},
     async set(_ns,key,value){setting.set(key,structuredClone(value));for(const [id,cb] of onChanges){if(id.endsWith(':'+key))cb?.()}return value}},
   socket:{on(_name,fn){instance.socket=fn},emit(_name,data){for(const c of instances.values())c.socket?.(data)}}
  }};
 const instance={user,ctx,events,callbacks,mod,socket:null};
 vm.createContext(ctx);
 vm.runInContext(approvalSource,ctx,{filename:'script-approvals.js'});
 vm.runInContext(source,ctx,{filename:'bootstrap.js'});
 instances.set(user.id,instance);return instance;
}
const gm=client(users[0]),player=client(users[1]),other=client(users[2]);
for(const c of instances.values())for(const fn of c.callbacks.get('init')??[])fn();
for(const c of instances.values())for(const fn of c.callbacks.get('ready')??[])fn();
const wait=()=>new Promise(r=>setTimeout(r,35));
(async()=>{
 const api=player.mod.api.bootstrap;
 assert.deepEqual(api.list(),[]);
 const registered=await api.register({actor,item,key:'example'});
 assert.equal(registered.registered,true);
 await wait();
 assert.equal(api.list().length,1,'World persistence');
 assert.equal(installed,1,'Only the player owner runs the script, not GM or other player');
 assert.equal(gm.events.get('pf1CreateActionUse')?.length??0,0);
 assert.equal(player.events.get('pf1CreateActionUse')?.length,1);
 assert.equal(other.events.get('pf1CreateActionUse')?.length??0,0);
 assert.equal(lastContext.event.type,'bootstrap:restore');
 for(let i=0;i<3;i++)await api.restoreAll();
 assert.equal(installed,1,'restoreAll is idempotent');
 assert.equal(player.events.get('pf1CreateActionUse')?.length,1);
 player.events.get('pf1CreateActionUse')[0]();assert.equal(handled,1);
 const again=await api.register({actor,item,key:'example'});
 assert.equal(again.duplicate,true);assert.equal(api.list().length,1);
 const denied=other.mod.api.bootstrap.register({actor,item,key:'bad'});
 await assert.rejects(denied,/own/i);
 await api.unregister({actor,item,key:'example'});
 await wait();
 assert.equal(api.list().length,0);
 assert.equal(player.events.get('pf1CreateActionUse')?.length,0,'tracked hook removed');
 assert.equal(removed,1,'cleanup callback called');
 await api.restoreAll();assert.equal(installed,1);
 const gone=await api.unregister({actor,item,key:'example'});
 assert.equal(gone.alreadyAbsent,true);
 await api.register({actor,item,key:'removed-item'});
 await wait();assert.equal(installed,2);
 docs.delete(item.uuid);
 await api.unregister({actor,item,key:'removed-item'});
 await wait();assert.equal(api.list().length,0,'Unregister tolerates missing Item');
 assert.equal(player.events.get('pf1CreateActionUse')?.length,0);
 // Orphan entries do not crash or run arbitrary code.
 await gm.ctx.game.settings.set(ns,'bootstrapRegistry',[{id:JSON.stringify([actor.uuid,item.uuid,'orphan']),actorUuid:actor.uuid,itemUuid:item.uuid,key:'orphan',scriptId:'toggle-1',enabled:true}]);
 await wait();const result=await api.restoreAll();
 assert.equal(result.restored,0);
 assert.equal(installed,2);
 // Offline owner: never run player-editable script as GM without approval.
 docs.set(item.uuid,item);users[1].active=false;
 await gm.mod.api.bootstrap.restoreAll();assert.equal(installed,2);
 assert.equal(gm.events.get('pf1CreateActionUse')?.length??0,0);
 await gm.mod.api.scriptApprovals.approve({actor,item,scriptId:call.id});
 await gm.mod.api.bootstrap.restoreAll();assert.equal(installed,3);
 assert.equal(gm.events.get('pf1CreateActionUse')?.length,1);
 // Exact content modification invalidates approval and removes active hooks.
 call._source.script='// modified without renewed approval';
 await gm.mod.api.bootstrap.restoreAll();
 assert.equal(gm.events.get('pf1CreateActionUse')?.length??0,0);
 await gm.mod.api.scriptApprovals.approve({actor,item,scriptId:call.id});
 await gm.mod.api.bootstrap.restoreAll();assert.equal(installed,4);
 assert.equal(gm.events.get('pf1CreateActionUse')?.length,1);
 users[1].active=true;
 await gm.mod.api.bootstrap.restoreAll();
 assert.equal(gm.events.get('pf1CreateActionUse')?.length,0,'GM yields execution to online owner');
 // Regression: bootstrap's ready callback runs before script-approvals.
 users[1].active=false;
 setting.set('scriptFallbackApprovals',[]);
 const startupId=JSON.stringify([actor.uuid,item.uuid,'startup-race']);
 setting.set('bootstrapRegistry',[{id:startupId,actorUuid:actor.uuid,
  itemUuid:item.uuid,key:'startup-race',scriptId:call.id,enabled:true}]);
 const startup=client(users[0]);
 const warnings=[];
 startup.ctx.console={...console,warn:(...args)=>warnings.push(args)};
 startup.ctx.Hooks.callAll=(name,...args)=>{
  for(const fn of startup.events.get(name)??[])fn(...args);
 };
 for(const fn of startup.callbacks.get('init')??[])fn();
 const readyHandlers=startup.callbacks.get('ready');
 assert.equal(readyHandlers.length,2);
 readyHandlers[1](); // bootstrap ready before approval service
 const premature=await startup.mod.api.bootstrap.restoreAll();
 assert.equal(premature.deferred,true,'restoration must wait for approval API');
 assert.equal(installed,4,'no player-controlled code ran as GM before approval');
 assert.equal(warnings.length,0,'no misleading warning during startup');
 readyHandlers[0](); // service ready, signal automatically resumes restoration
 await wait();
 assert.equal(typeof startup.mod.api.scriptApprovals.check,'function');
 assert.equal(installed,4,'unapproved script remains blocked after service appears');
 assert.equal(warnings.some(args=>args[1]?.reason==='Script approval service unavailable'),
  false,'startup race never produces misleading unavailability warning');
 assert.equal(warnings.some(args=>args[1]?.reason==='No GM approval for offline-player fallback'),
  true,'actual unapproved execution is still refused');
 await startup.mod.api.scriptApprovals.approve({actor,item,scriptId:call.id});
 const recovered=await startup.mod.api.bootstrap.restoreAll();
 assert.equal(recovered.restored,1,'approved script can be restored');
 assert.equal(installed,5,'script runs exactly once after GM approval');
 const dedup=await startup.mod.api.bootstrap.restoreAll();
 assert.equal(dedup.restored,0,'subsequent restores remain idempotent');
 assert.equal(installed,5,'no duplicate script execution');
 console.log('PASS bootstrap readiness: deferred startup, secure approval, signal and idempotence');
 console.log('PASS bootstrap: persistent owner restore, idempotence, cleanup, orphan, permissions, synthetic UUID, single executor');
})().catch(e=>{console.error(e);process.exitCode=1});