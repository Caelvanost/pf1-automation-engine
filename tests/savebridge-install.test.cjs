'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../scripts/save-overrides.js'),'utf8');
const hooks=new Map(),once=new Map(),settings=new Map([['genericDebug',true],['genericEnabled',false]]),log=[];
let hookSeq=0;
const game={modules:new Map([['pf1-automation-engine',{active:true,api:{}}]]),
 settings:{get:(_n,k)=>settings.get(k),register(_n,k,o){if(!settings.has(k))settings.set(k,o.default)}},
 users:[],user:{id:'gm',isGM:true},socket:{on(){}},messages:new Map()};
const env={game,Map,Set,Date,Promise,clearTimeout,setTimeout,
 foundry:{utils:{deepClone:structuredClone,randomID:()=> 'r123'}},
 console:{debug:(...a)=>log.push(a)},
 Hooks:{once:(k,f)=>once.set(k,f),on:(k,f)=>{
 const l=hooks.get(k)??[];l.push(f);hooks.set(k,l);return ++hookSeq;}}};
vm.createContext(env);vm.runInContext(src,env,{filename:'save-overrides.js'});
assert.equal(hooks.get('pf1PreActorRollSave'),undefined);
once.get('init')();
assert.equal(hooks.get('pf1PreActorRollSave').length,1);
assert.equal(hooks.get('pf1ActorRollSave').length,1);
assert.equal(hooks.get('createChatMessage').length,1);
assert(log.some(a=>a[0]==='[PF1AE][SaveBridge] Installed PF1 save hooks'));
once.get('ready')();
assert.equal(hooks.get('pf1PreActorRollSave').length,1,'No duplicate hook registration');
assert(log.some(a=>a[0]==='[PF1AE][SaveBridge] SaveBridge ready'));
const actor={uuid:'Actor.x',name:'NPC'};
hooks.get('pf1PreActorRollSave')[0](actor,{},'will');
hooks.get('pf1ActorRollSave')[0](actor,{id:'roll1'},'will');
assert(log.some(a=>a[0]==='[PF1AE][SaveBridge] PRE'));
assert(log.some(a=>a[0]==='[PF1AE][SaveBridge] POST'));
assert(log.some(a=>a[0]==='[PF1AE][SaveBridge] POST received but automation disabled'));
settings.set('genericEnabled',true);
hooks.get('pf1PreActorRollSave')[0](actor,{},'will');
assert(log.some(a=>a[0]==='[PF1AE][SaveBridge] PRE has no verified source card; save will not trigger outcomes'));
console.log('PASS SaveBridge startup, disabled PRE/POST diagnostics and idempotent listener registration');
