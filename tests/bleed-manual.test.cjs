'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const SOURCE=fs.readFileSync(path.resolve(__dirname,'../scripts/bleed-manual.js'),'utf8');
const NS='pf1-automation-engine';
const users=[{id:'gm',isGM:true},{id:'gm2',isGM:true},{id:'player',isGM:false},{id:'stranger',isGM:false}];
const clients=[];
let counter=0,formEvaluations=0,formulaChecks=0;
const prompts=[],notices=[];
const settings=new Map([['genericEnabled',true]]);
const generated=[];
const Roll=class Roll{
 constructor(value){
  if(!Roll.validate(value))throw Error('Invalid formula');
  this.formula=value;
 }
 static validate(value){
  formulaChecks++;
  return /^(?:\d+|\d+d\d+(?:\+\d+)?)$/.test(value);
 }
 async evaluate(){formEvaluations++;return {total:1};}
};
function actor(name,owner,{synth=false}={}){
 const a={uuid:(synth?'Scene.scene.Token.token.Actor.':'Actor.')+name,
  documentName:'Actor',name,system:{conditions:{bleed:false}},
  items:{contents:[]},testUserPermission(user,permission){
   return permission==='OWNER'&&user.id===owner;
  },async createEmbeddedDocuments(kind,raw){
   assert.equal(kind,'Item');
   const created=raw.map(data=>{const buff=item(a,data.name,{flags:data.flags,active:false});
    Object.assign(buff.system,data.system??{});return buff;});
   generated.push(...created);
   return created;
  },async setCondition(key,state){
   assert.equal(key,'bleed');
   return toggle(initiator,a,state);
  }};
 return a;
}
let initiator=null;
function item(a,name,{flags={},active=true}={}){
 const b={id:String(++counter),uuid:a.uuid+'.Item.'+counter,name,actor:a,
  type:'buff',documentName:'Item',
  flags:structuredClone(flags),system:{active},activeState:active,
  getFlag(ns,key){return structuredClone(this.flags?.[ns]?.[key]??null)},
  async setFlag(ns,key,data){this.flags[ns]??={};this.flags[ns][key]=structuredClone(data);return data;},
  async update(change){
   if(change.name)this.name=change.name;
   if('system.active' in change){
    this.system.active=change['system.active'];this.activeState=change['system.active'];
   }
   if('system.hideFromToken' in change)
    this.system.hideFromToken=change['system.hideFromToken'];
  },
  async setActive(value){this.system.active=value;this.activeState=value;},
  async delete(){a.items.contents=a.items.contents.filter(x=>x!==this);},
  testUserPermission(user,permission){return a.testUserPermission(user,permission)}
 };
 a.items.contents.push(b);return b;
}
function client(user){
 const hooks=new Map(),once=new Map();
 const on=(registry,name,fn)=>{const list=registry.get(name)??[];
  list.push(fn);registry.set(name,list)};
 const mod={active:true,api:{bleed:{
  async configure({effect,type,formula,stacking}){
   assert.equal(type,'hp');assert.equal(stacking,'highest');
   assert.equal(Roll.validate(formula),true);
   await effect.setFlag(NS,'bleed',{enabled:true,type,formula,stacking});
  }
 }}};
 const game={user,modules:new Map([[NS,mod]]),
  settings:{get(_ns,key){return settings.get(key)}}};
 const ctx={console,Date,Map,Set,Promise,Roll,game,
  Hooks:{once:(name,fn)=>on(once,name,fn),on:(name,fn)=>on(hooks,name,fn)},
  ui:{notifications:{error:message=>notices.push(message)}},
  foundry:{applications:{api:{DialogV2:{
   async wait(config){
    prompts.push({user:user.id,config});
    return dialogs.shift()?.()??null;
   }
  }}}}};
 ctx.globalThis=ctx;vm.createContext(ctx);
 vm.runInContext(SOURCE,ctx,{filename:'bleed-manual.js'});
 for(const fn of once.get('init')??[])fn();
 for(const fn of once.get('ready')??[])fn();
 const out={hooks,user,mod,ctx};clients.push(out);return out;
}
const dialogs=[];
const gm=client(users[0]),gm2=client(users[1]),player=client(users[2]),stranger=client(users[3]);
const a=actor('test','player'),b=actor('synth','player',{synth:true});
async function signal(client,name,...args){
 for(const fn of client.hooks.get(name)??[])await fn(...args);
}
async function toggle(user,actor,state,options={}){
 const client=clients.find(c=>c.user.id===user.id);
 if(!client)throw Error('No user');
 initiator=user;
 const changes={system:{conditions:{bleed:state}}};
 await signal(client,'preUpdateActor',actor,changes,options,user.id);
 actor.system.conditions.bleed=state;
 // PF1 11.11 conditions are ActiveEffects: the author is present
 // on create/delete AE hooks, while the condition hook is broadcast.
 const nativeEffect={parent:actor,documentName:'ActiveEffect',
  statuses:new Set(['bleed']),_source:{statuses:['bleed']}};
 for(const c of clients)await signal(c,'pf1ToggleActorCondition',actor,'bleed',state);
 await signal(client,state?'createActiveEffect':'deleteActiveEffect',
  nativeEffect,options,user.id);
 for(const c of clients)await signal(c,'updateActor',actor,changes,options,user.id);
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,5));
const dialogValue=value=>()=>value;
(async()=>{
 // Foundry syntax validation never evaluates during input.
 const api=gm.mod.api.manualBleed;
 for(const s of ['1','3','1d4','1d6+2','2d4+1','2d6+1'])
  assert.equal(api.validate(s),s);
 assert.throws(()=>api.validate('1d4+' ),/invalide/i);
 assert.equal(formEvaluations,0);
 dialogs.push(dialogValue('3'));
 await toggle(users[0],a,true);await flush();
 assert.equal(prompts.length,1,'one DialogV2 on initiating GM');
 assert.equal(prompts[0].config.window.title,'🩸 Saignement');
 assert.equal(prompts[0].config.content.includes('value="1"'),true);
 assert.equal(generated.length,1);
 assert.equal(generated[0].name,'Saignement — 3');
 assert.equal(generated[0].getFlag(NS,'bleed').formula,'3');
 assert.equal(generated[0].getFlag(NS,'manualBleed').generated,true);
 assert.equal(generated[0].system.active,true);
 assert.equal(generated[0].system.hideFromToken,true,
  'generated manual Buff must not show a second token icon');
 assert.equal(formEvaluations,0,'no roll during form confirmation');
 // Native Bleed condition is visible while manual Buff is active.
 assert.equal(a.system.conditions.bleed,true);
 // Reload/reconnect is a new client without a fresh condition toggle.
 const refresh=client(users[0]);
 // Simulate the old browser being disconnected and its Hooks disposed.
 clients.splice(clients.indexOf(gm),1);
 await flush();
 assert.equal(prompts.length,1,'F5/ready must not reopen a dialog');
 // Removing native Bleed only deactivates generated manual Buffs.
 const external=item(a,'Bleed from ability',{active:true,
  flags:{[NS]:{bleed:{enabled:true,type:'hp',formula:'1d4',stacking:'highest'}}}});
 await toggle(users[0],a,false);await flush();
 assert.equal(generated[0].system.active,false);
 assert.equal(external.system.active,true,'other Bleed Buff remains untouched');
 // Opening while an inactive old manual Buff exists reuses it.
 dialogs.push(dialogValue('1d4'));
 await toggle(users[0],a,true);await flush();
 assert.equal(generated.length,1,'manual Buff reused');
 assert.equal(generated[0].getFlag(NS,'bleed').formula,'1d4');
 assert.equal(generated[0].system.hideFromToken,true,
  'reused manual Buff also hides its redundant icon');
 // Cancelling creates no Buff and removes the condition without recursion.
 await toggle(users[0],a,false);await flush();
 const previous=prompts.length;
 dialogs.push(dialogValue(null));
 await toggle(users[0],a,true);await flush();
 assert.equal(prompts.length,previous+1);
 assert.equal(a.system.conditions.bleed,false);
 assert.equal(generated.length,1);
 assert.equal(api.list(a).length,1);
 // Invalid formula shows an error and reopens, then Cancel safely.
 dialogs.push(dialogValue('1d4+'),dialogValue(null));
 const count=prompts.length;
 await toggle(users[0],a,true);await flush();
 assert.equal(prompts.length,count+2);
 assert.equal(notices.some(x=>/invalide/i.test(x)),true);
 assert.equal(a.system.conditions.bleed,false);
 assert.equal(generated.length,1);
 // Player is the only prompt recipient for their own Actor.
 const before=prompts.length;
 dialogs.push(dialogValue('2d6+1'));
 await toggle(users[2],a,true);await flush();
 assert.equal(prompts.length,before+1);
 assert.equal(prompts.at(-1).user,'player');
 assert.equal(generated[0].getFlag(NS,'bleed').formula,'2d6+1');
 await toggle(users[2],a,false);await flush();
 // Non-owner cannot open a form via a forged native broadcast.
 await signal(stranger,'pf1ToggleActorCondition',a,'bleed',true);
 await flush();
 assert.equal(prompts.length,before+1);
 // Synthetic Actor UUID is retained, unrelated to a world Actor UUID.
 dialogs.push(dialogValue('1d6+2'));
 await toggle(users[2],b,true);await flush();
 assert.equal(api.list(b).length,1);
 assert.equal(api.list(b)[0].actor.uuid,b.uuid);
 // Neither world load nor restored effects emit condition transitions.
 await signal(gm,'updateActor',b,{flags:{fake:'effect'}},{},users[0].id);
 await flush();
 assert.equal(prompts.length,before+2);
 // The original v1.29 Bleed engine is still the sole turn damage resolver:
 // only the API's configure method is used here, never Roll.evaluate().
 assert.equal(formEvaluations,0);
 console.log('PASS manual Bleed DialogV2: GM, player, two GMs, synthetic actors,');
 console.log(' syntax-only formulas, cancel, invalid/reopen, generated-only cleanup,');
 console.log(' no recursion, no duplicate Buff, no F5 dialog, no dice roll on input.');
})().catch(e=>{console.error(e);process.exitCode=1});
