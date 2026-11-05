'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const events=new Map(),store=new Map([['genericEnabled',true],['genericDebug',true]]);
const messages=new Map(),docs=new Map(),resolved=[],log=[];
const gm={id:'gm',isGM:true,active:true};
const actor={id:'target',uuid:'Scene.scene.Token.token.Actor.target',name:'Harpy',documentName:'Actor'};
const item={uuid:'Actor.bard.Item.fascination',documentName:'Item'};
docs.set(actor.uuid,actor);docs.set(item.uuid,item);
const ctx={sourceActorUuid:'Actor.bard',sourceItemUuid:item.uuid,sourceActionId:'action1',saveType:'will',saveDC:16};
function message(id,total,card=false){
 const m={id,documentName:'ChatMessage',author:{id:'gm'},speaker:{actor:'target'},
   rolls:[{total}],flags:{},getFlag(n,k){return this.flags[n]?.[k]},
   async setFlag(n,k,v){(this.flags[n]??={})[k]=v;}};
 if(card)m.flags['pf1-automation-engine']={saveContext:ctx};
 messages.set(id,m);return m;
}
const game={user:gm,users:[gm],messages,modules:new Map(),
 settings:{get:(_,k)=>store.get(k),set:async(_,k,v)=>store.set(k,v),
 register:(_,k,c)=>{if(!store.has(k))store.set(k,c.default)}},
 socket:{on(){},emit(){}}};
game.users.get=id=>id==='gm'?gm:null;
game.modules.set('pf1-automation-engine',{active:true,api:{
 saveContext:{_fromNativeSaveOptions:(_,type,opt)=>opt?.reference==='ChatMessage.card'?{...ctx,sourceMessageId:'card'}:null,
 _consumeForNativeSave:()=>null,
 fromMessage:m=>m.getFlag('pf1-automation-engine','saveContext')},
 saveOutcomes:{resolve:async e=>(resolved.push(e),{processed:true})}
}});
const logFn=(...x)=>log.push(x);
const sandbox={console:{debug:logFn,log:logFn,warn:logFn,error:logFn,info:logFn},
 Map,Set,Promise,Date,setTimeout,clearTimeout,
 foundry:{utils:{deepClone:structuredClone,randomID:(()=>{let i=0;return()=>String(++i)})()}},
 Hooks:{on:(name,f)=>events.set(name,[...(events.get(name)??[]),f]),
 once:(name,f)=>events.set(name,[...(events.get(name)??[]),f]),callAll(){}},
 game,fromUuid:async uuid=>docs.get(uuid),canvas:{scene:null},
 ChatMessage:{implementation:{create:async()=>{throw Error('Unexpected extra summary')}}}};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../scripts/save-overrides.js'),'utf8'),sandbox);
for(const f of events.get('init')??[])f();
vm.runInContext('soResolve=async d=>({normalTotal:d.normalTotal,effectiveTotal:d.normalTotal,changed:false,candidates:[],winner:null,saveType:d.saveType,sourceItemUuid:d.sourceItemUuid,targetActorUuid:d.targetActorUuid})',sandbox);
async function fire(name,...a){for(const f of events.get(name)??[])await f(...a)}
const flush=()=>new Promise(r=>setTimeout(r,40));
(async()=>{
 message('card',0,true);
 await fire('pf1PreActorRollSave',actor,{reference:'ChatMessage.card'},'will');
 await fire('pf1ActorRollSave',actor,message('fail',11),'will');
 await flush();
 assert.equal(resolved.length,1);
 assert.equal(resolved[0].normalTotal,11);
 assert.equal(resolved[0].effectiveTotal,11);
 assert.equal(resolved[0].targetActorUuid,actor.uuid);
 await fire('pf1PreActorRollSave',actor,{},'will');
 await fire('pf1ActorRollSave',actor,message('manual',19),'will');
 await flush();assert.equal(resolved.length,1);
 await fire('pf1PreActorRollSave',actor,{reference:'ChatMessage.card'},'will');
 await fire('pf1PreActorRollSave',actor,{reference:'ChatMessage.card'},'will');
 await fire('pf1ActorRollSave',actor,message('ambiguous',8),'will');
 await flush();assert.equal(resolved.length,1,'Ambiguous saves must not receive a card outcome');
 const names=log.map(x=>String(x[0]));
 assert.equal(names.filter(x=>x.endsWith(' PRE')).length,4);
 assert.equal(names.filter(x=>x.endsWith(' POST')).length,3);
 assert(names.some(x=>x.endsWith(' PRE options')));
 console.log('PASS PF1 native PRE/POST ChatMessagePF, manual isolation, synthetic actor and ambiguous pairing');
})().catch(err=>{console.error(err);process.exitCode=1});
