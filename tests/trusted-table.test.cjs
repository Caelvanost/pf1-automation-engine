'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const approval=fs.readFileSync(path.join(root,'scripts/script-approvals.js'),'utf8');
const bootstrap=fs.readFileSync(path.join(root,'scripts/bootstrap.js'),'utf8');
const NS='pf1-automation-engine';
const settings=new Map([['genericEnabled',true],['genericDebug',false]]);
const users=[
 {id:'gm1',isGM:true,active:true},
 {id:'gm2',isGM:true,active:true},
 {id:'p1',isGM:false,active:true},
 {id:'p2',isGM:false,active:true}
];
users.get=id=>users.find(x=>x.id===id);
const docs=new Map(), clients=new Map(), changes=new Map();
let executions=[];
function actor(id,owners=[]){
 const a={id,uuid:'Actor.'+id,documentName:'Actor',items:new Map(),
  testUserPermission(u,level){return level==='OWNER'&&owners.includes(u.id)}};
 docs.set(a.uuid,a);return a;
}
const hero=actor('hero',['p1','p2']);
const npc=actor('npc',[]);
const synthetic=actor('synthetic',['p1']);
synthetic.uuid='Scene.s.Token.t.Actor.synthetic';
docs.set(synthetic.uuid,synthetic);
function item(a,id,calls){
 const i={id,uuid:a.uuid+'.Item.'+id,documentName:'Item',actor:a,
  scriptCalls:{contents:calls}};
 a.items.set(id,i);docs.set(i.uuid,i);return i;
}
function nativeCall(id,name,category='toggle'){
 return {id,name,category,_source:{id,name,category,script:'listener '+id},
  async execute(shared,params){
   assert.equal(shared.action,null);
   assert.equal(params.restoring,true);
   assert.equal(params.state,null);
   assert.equal(params.event.type,'bootstrap:restore');
   executions.push({script:id,client:params.bootstrap.actorUuid,owner:params.bootstrap.id});
   params.bootstrap.listen('pf1PostActionUse',()=>{});
  }};
}
const a=nativeCall('a','PF1AE:bootstrap');
const b=nativeCall('b','PF1AE:bootstrap');
const ignored=nativeCall('ignored','Not a PF1AE bootstrap');
const wrong=nativeCall('wrong','PF1AE:bootstrap','use');
const main=item(hero,'main',[a,b,ignored,wrong]);
item(npc,'npc-item',[nativeCall('npc-call','PF1AE:bootstrap')]);
const synthItem=item(synthetic,'synth-item',[nativeCall('synth-call','PF1AE:bootstrap')]);
const scene={tokens:{contents:[{actor:synthetic}]}};
function client(user){
 const callbacks=new Map(),events=new Map(),mod={active:true,api:{}};
 const ctx={console,Date,Map,Set,Promise,setTimeout,clearTimeout,
  foundry:{utils:{randomID:()=>String(Math.random()),deepClone:structuredClone}},
  fromUuid:async id=>docs.get(id)??null,
  Hooks:{
   once(name,fn){if(!callbacks.has(name))callbacks.set(name,[]);callbacks.get(name).push(fn)},
   on(name,fn){if(!events.has(name))events.set(name,[]);events.get(name).push(fn)},
   off(name,fn){events.set(name,(events.get(name)??[]).filter(x=>x!==fn))}
  },
  game:{user,users,modules:new Map([[NS,mod]]),
   actors:{contents:[hero,npc]},scenes:{contents:[scene]},
   settings:{
    get(_ns,key){return settings.get(key)},
    register(_ns,key,options){
     if(!settings.has(key))settings.set(key,structuredClone(options.default));
     if(!changes.has(key))changes.set(key,[]);
     changes.get(key).push(options.onChange);
    },
    async set(_ns,key,value){
     settings.set(key,structuredClone(value));
     for(const fn of changes.get(key)??[])fn?.();
     return value;
    }
   },
   socket:{on(){},emit(){}}
  }};
 const c={user,ctx,callbacks,events,mod};
 vm.createContext(ctx);vm.runInContext(approval,ctx);vm.runInContext(bootstrap,ctx);
 clients.set(user.id,c);return c;
}
for(const u of users)client(u);
for(const c of clients.values())for(const fn of c.callbacks.get('init')??[])fn();
for(const c of clients.values())for(const fn of c.callbacks.get('ready')??[])fn();
const wait=()=>new Promise(r=>setTimeout(r,50));
const fire=(name,...args)=>{
 for(const c of clients.values())for(const fn of c.events.get(name)??[])fn(...args);
};
const count=(who)=>clients.get(who).events.get('pf1PostActionUse')?.length??0;
const restore=async()=>{await Promise.all([...clients.values()].map(c=>c.mod.api.bootstrap.restoreAll()))};
(async()=>{
 assert.equal(settings.get('trustedTableMode'),false,'secure default');
 await restore();assert.equal(executions.length,0,'no auto execution in secure mode');
 const secure=clients.get('gm1').mod.api.scriptApprovals.check(hero,main,a);
 assert.equal(secure.approved,false,'unapproved secure mode denies GM fallback');
 await clients.get('gm1').ctx.game.settings.set(NS,'trustedTableMode',true);
 await wait();await restore();
 assert.equal(count('p1'),3,'first player gets two abilities and synthetic token');
 assert.equal(count('p2'),0,'second owner is not elected');
 assert.equal(count('gm1'),1,'GM owns the NPC only');
 assert.equal(count('gm2'),0,'second GM does not run duplicate hooks');
 assert.equal(clients.get('p1').mod.api.bootstrap.listAutomatic().length,4);
 assert.equal(clients.get('gm1').mod.api.scriptApprovals.check(hero,main,a).approved,true);
 assert.equal(clients.get('gm1').mod.api.scriptApprovals.check(hero,main,ignored).approved,false);
 await restore();await restore();
 assert.equal(count('p1'),3,'F5-style replay is idempotent');
 // Native script modifications trigger a targeted replacement, no old hook.
 a._source.script='modified trusted bootstrap';
 fire('updateItem',main);await wait();
 assert.equal(count('p1'),3,'a changed native call replaces its listener');
 // Addition and deletion use only the changed Item.
 const extra=item(hero,'extra',[nativeCall('extra','PF1AE:bootstrap')]);
 fire('createItem',extra);await wait();
 assert.equal(count('p1'),4,'newly-created Item discovered automatically');
 hero.items.delete('extra');docs.delete(extra.uuid);
 fire('deleteItem',extra);await wait();
 assert.equal(count('p1'),3,'removed Item cleans tracked hooks');
 // Owner departure -> only GM1 takes over; no individual approval in trusted mode.
 users.get('p1').active=false;
 users.get('p2').active=false;
 fire('updateUser',users.get('p1'),{active:false});await wait();await restore();
 assert.equal(count('p1'),0);
 assert.equal(count('gm1'),4,'GM takes over the hero and the synthetic token');
 assert.equal(count('gm2'),0);
 users.get('p2').active=true;
 fire('updateUser',users.get('p2'),{active:true});await wait();await restore();
 assert.equal(count('gm1'),2,'GM relinquishes hero but still owns NPC and synthetic token');
 assert.equal(count('p2'),2,'second player becomes elected hero owner');
 users.get('p1').active=true;
 fire('updateUser',users.get('p1'),{active:true});await wait();await restore();
 assert.equal(count('p2'),0,'newly elected p1 replaces p2');
 assert.equal(count('p1'),3,'p1 now owns the hero and synthetic token');
 // Switching back never deletes secure-mode registry; auto hooks disappear.
 await clients.get('gm1').ctx.game.settings.set(NS,'trustedTableMode',false);
 await wait();await restore();
 assert.equal(count('p1'),0);
 assert.equal(count('gm1'),0);
 assert.equal(clients.get('gm1').mod.api.bootstrap.listAutomatic().length,0);
 assert.equal(clients.get('gm1').mod.api.scriptApprovals.check(hero,main,a).approved,false);
 // Ordinary registered scripts still work in secure mode after toggle.
 await clients.get('gm1').mod.api.bootstrap.register({actor:hero,item:main,key:'legacy',scriptId:'a'});
 await wait();await restore();
 assert.equal(count('p1'),1,'secure-mode manual registration preserved');
 await clients.get('gm1').ctx.game.settings.set(NS,'trustedTableMode',true);
 await wait();await restore();
 assert.equal(count('p1'),3,'manual+automatic never duplicate the same call');
 await clients.get('gm1').ctx.game.settings.set(NS,'trustedTableMode',false);
 await wait();await restore();
 assert.equal(count('p1'),1,'secure registration survives mode switching');
 console.log('PASS trusted-table: opt-in, multi-call, synthetic, live edit, add/delete, two GMs, owner handoff, secure mode, no duplicates');
})().catch(err=>{console.error(err);process.exitCode=1});
