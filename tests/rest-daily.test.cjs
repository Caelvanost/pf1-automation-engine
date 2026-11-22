'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../scripts/rest-daily.js'),'utf8');
const gm={id:'gm',isGM:true,active:true},player={id:'player',isGM:false,active:true};
const actor={documentName:'Actor',uuid:'Actor.paladin'};
const other={documentName:'Actor',uuid:'Actor.other'};
const item={documentName:'Item',uuid:'Actor.paladin.Item.bastion',actor};
const otherItem={documentName:'Item',uuid:'Actor.other.Item.other',actor:other};
const calls=[];
const call={id:'daily1',name:'PF1AE:rest:daily',category:'postUse',
 async execute(_action,context){calls.push(context.event)}};
item.scriptCalls={contents:[call]};
otherItem.scriptCalls={contents:[]};
actor.items={contents:[item]};other.items={contents:[otherItem]};
const records=new Map([[actor.uuid,actor],[other.uuid,other]]);
const module={api:{scriptApprovals:{check:()=>({approved:true})}}};
const ready=[];
const context={
 console,game:{user:gm,users:[gm,player],modules:new Map([['pf1-automation-engine',module]]),
 settings:{get(_ns,key){return key==='genericEnabled'}}},
 Hooks:{once(_name,fn){ready.push(fn)}},
 fromUuid:async uuid=>records.get(uuid)??null,
 foundry:{utils:{deepClone:structuredClone}},Set,Map,Object,Number,Array,Promise
};
context.globalThis=context;vm.createContext(context);
vm.runInContext(source,context,{filename:'rest-daily.js'});
for(const fn of ready)fn();
const api=module.api.restDaily;
const event=(id,actorUuid=actor.uuid,daily=true)=>({
 type:'pf1ActorRest',actorUuid,
 rest:{id,phase:'post',completed:true,restoreDailyUses:daily,
 options:{restoreDailyUses:daily},before:{items:[]},after:{items:[]}}
});
(async()=>{
 assert.equal(api.discover(actor).length,1);
 assert.equal((await api._dispatch(event('r1',actor.uuid,false))).skipped,'not-daily-rest');
 assert.equal(calls.length,0);
 let result=await api._dispatch(event('r1'));
 assert.equal(result.executed,1);
 assert.equal(calls[0].type,'pf1ActorRest');
 assert.equal(calls[0].actorUuid,actor.uuid);
 assert.equal(calls[0].itemUuid,item.uuid);
 assert.equal(calls[0].rest.options.restoreDailyUses,true);
 assert.equal((await api._dispatch(event('r1'))).skipped,'duplicate-rest');
 assert.equal(calls.length,1);
 assert.equal((await api._dispatch(event('r2',other.uuid))).executed,0);
 assert.equal(calls.length,1,'other Actor does not invoke paladin script');
 module.api.scriptApprovals.check=()=>({approved:false,reason:'not-approved'});
 result=await api._dispatch(event('r3'));
 assert.equal(result.blocked,1);
 assert.equal(calls.length,1,'secure mode approval respected');
 module.api.scriptApprovals.check=()=>({approved:true});
 call.name='Renamed';
 assert.equal(api.discover(actor).length,0);
 assert.equal((await api._dispatch(event('r4'))).executed,0);
 call.name='PF1AE:rest:daily';
 assert.equal((await api._dispatch(event('r5'))).executed,1);
 context.game.user=player;
 assert.equal((await api._dispatch(event('r6'))).skipped,'not-elected-GM');
 assert.equal(calls.length,2);
 console.log('PASS rest-daily: native discovery, actor isolation, daily-only, dedup, approval, edits and elected GM');
})().catch(e=>{console.error(e);process.exitCode=1});
