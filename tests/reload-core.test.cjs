'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.resolve(__dirname,'../scripts/reload-core.js'),'utf8');
const listeners=new Map(),once=new Map(),settings=new Map([
 ['genericEnabled',true],['reloadEnabled',true]]);
const count={rolls:0,charges:0,nativeAmmo:0,messages:0,warns:0};
const uuid='Actor.a.Item.w';
const actor={id:'a',uuid:'Actor.a',documentName:'Actor',items:new Map(),
 testUserPermission(){return true}};
const ammo={id:'am',type:'ammo',system:{quantity:8,subType:'gunBullet',abundant:false},
 getFlag(){return false}};
actor.items.set('am',ammo);
const weapon={id:'w',uuid,type:'weapon',actor,actions:[],system:{ammo:{default:'am'}},
 flags:{},getFlag(_n,k){return this.flags[k]},
 async setFlag(_n,k,value){this.flags[k]=structuredClone(value);return this.flags[k]},
 async update(data){if(data['system.ammo.default'])this.system.ammo.default=data['system.ammo.default']},
};
actor.items.set('w',weapon);
const events={on(n,fn){(listeners.get(n)??listeners.set(n,[]).get(n)).push(fn)},
 once(n,fn){(once.get(n)??once.set(n,[]).get(n)).push(fn)},
 callAll(n,...args){for(const fn of listeners.get(n)??[])fn(...args)},
 call(n,...args){let allowed=true;for(const fn of listeners.get(n)??[]){
  if(fn(...args)===false)allowed=false;
 }return allowed}};
const actionType={create:async(data,{parent})=>{
 const a={...data,id:'reloadA',item:parent,hasAttack:false};
 parent.actions.push(a);return [a];
}};
class ActionUse{
 constructor(action,attacks=1){
  this.action=action;this.item=weapon;this.actor=actor;
  this.shared={attacks:Array.from({length:attacks},()=>({
   hasAmmo:true,ammo:{id:'am'}
  }))};
 }
 async generateChatAttacks(){if(this.action.hasAttack)count.rolls++}
 async process(){
  events.callAll('pf1CreateActionUse',this);
  await this.generateChatAttacks();
  // Native hook occurs after generation, before any ammo/charge cost.
  if(events.call('pf1PreActionUse',this)===false)return;
  if(this.action.hasAttack){
   const cost=this.shared.attacks.length*this.action.ammo.cost;
   count.nativeAmmo+=cost;
   ammo.system.quantity-=cost;
   count.charges++;
  }
  events.callAll('pf1PostActionUse',this,null);
  return this;
 }
}
const t=(id,cost=1)=>({id,name:id,item:weapon,actionType:'rwak',
 hasAttack:true,ammo:{type:'gunBullet',cost}});
const simple=t('shot'),double=t('double');
weapon.actions.push(simple,double);
const context={console,Math,Number,Map,Set,WeakMap,WeakSet,Symbol,
 structuredClone,globalThis:null,foundry:{utils:{deepClone:structuredClone,
 escapeHTML:x=>x}},game:{user:{isGM:true},modules:new Map([[
 'pf1-automation-engine',{active:true,api:{}}]]),
 settings:{get:(_ns,k)=>settings.get(k),register:(_ns,k,opt)=>{
  if(!settings.has(k))settings.set(k,opt.default)}}},
 Hooks:events,ui:{notifications:{warn(){count.warns++},info(){}}},
 ChatMessage:{getSpeaker:()=>({}),async create(){count.messages++}},
 pf1:{models:{components:{Action:actionType}},components:{ActionUse}},
};
context.globalThis=context;vm.createContext(context);vm.runInContext(code,context);
(async()=>{
 for(const fn of once.get('init')??[])fn();
 for(const fn of once.get('ready')??[])fn();
 const api=context.game.modules.get('pf1-automation-engine').api.reload;
 // Automatic weapon setup uses native action ammo and a conservative
 // capacity parse; it never requires a full custom configuration form.
 const originalName=weapon.name;
 weapon.name='Pistolet à double canon';
 weapon.system.description={value:'<p>Misfire 1–2 (5 ft.); Capacity 2</p>'};
 assert.equal(api.infer(weapon).ok,true);
 assert.equal(api.infer(weapon).capacity,2);
 assert.equal(api.infer(weapon).ammoId,'am');
 assert.equal(api.infer(weapon).source,'description');
 const auto=await api.initialize(weapon);
 assert.equal(auto.capacity,2);
 assert.equal(weapon.actions.length,2,'automatic setup never creates a native Action');
 assert.equal(api.infer(weapon).capacity,2);
 assert.equal((await api.initialize(weapon)).capacity,2,'idempotent automatic init');
 weapon.name=originalName;
 await weapon.unsetFlag?.('pf1-automation-engine','reloadState');
 weapon.flags={};
 
 // Auto setup deliberately ignores unconfigured actions and non-ammo loot.
 context.actor=actor;context.weapon=weapon;
 const rawChoice=vm.runInContext('rlAttackActions(weapon)',context);
 assert.equal(rawChoice.length,2);
 const incomplete={id:'incomplete',name:'Unconfigured attack',
   actionType:'rwak',hasAttack:true,ammo:{type:null,cost:0}};
 weapon.actions.push(incomplete);
 assert.equal(vm.runInContext('rlAttackActions(weapon)',context).length,2);
 weapon.actions.pop();
 const ammoOptions=vm.runInContext('rlItems(actor).filter(x=>x.type==="ammo")',context);
 assert.equal(ammoOptions.length,1,'native PF1 ammo Item found');
 actor.items.set('loot',{id:'loot',type:'loot',system:{quantity:99}});
 assert.equal(vm.runInContext('rlItems(actor).filter(x=>x.type==="ammo")',context).length,1,
   'generic loot is not native ammunition');
 actor.items.delete('loot');
 // First use of a recognized but never reloaded pistol must be refused.
 weapon.name='Pistolet à double canon';
 await new ActionUse(simple,1).process();
 assert.equal(count.rolls,0,'first-ever attack must not become a free shot');
 assert.equal(count.nativeAmmo,0,'first-ever denied shot does not consume inventory');
 assert.equal(api.lastDiagnostic().status,'blocked');
 weapon.name=originalName;
 let state=await api.configure(weapon,{capacity:2,ammoType:'gunBullet',
  base:'standard',actionCosts:{double:2}});
 assert.equal(state.slots.length,0);
 assert.equal(weapon.actions.length,2,'configure does not add a Reload action');
 await api.configure(weapon,{capacity:2,ammoType:'gunBullet',
  base:'standard',actionCosts:{double:2}});
 assert.equal(weapon.actions.length,2,'still no automatic Reload action');
 const fire=async(action,n=1)=>new ActionUse(action,n).process();
 await fire(simple);
 assert.equal(count.rolls,0,'empty weapon refuses BEFORE roll');
 assert.equal(count.nativeAmmo,0);assert.equal(count.charges,0);
 const reloadAction={id:'manual-reload',name:'Recharger',actionType:'other',
  hasAttack:false,ammo:{type:null,cost:0}};
 weapon.actions.push(reloadAction);
 await fire(reloadAction);
 await new Promise(r=>setImmediate(r));
 assert.equal(api.getState(weapon).slots.length,1,'manually created native Reload action loads one');
 assert.equal(ammo.system.quantity,8,'no inventory consumption at reload');
 await fire(double,2);
 assert.equal(count.rolls,0,'double shot denied with one loaded');
 assert.equal(count.nativeAmmo,0);
 await fire(simple);
 await new Promise(r=>setImmediate(r));
 assert.equal(count.rolls,1,'single shot actually rolls');
 assert.equal(count.nativeAmmo,1,'PF1 consumes one native ammo once');
 assert.equal(ammo.system.quantity,7);
 assert.equal(api.getState(weapon).slots.length,0,'loaded state decremented after native shot');
 await api.reload(weapon,{count:2});
 assert.equal(api.getState(weapon).slots.length,2);
 await fire(double,2);await new Promise(r=>setImmediate(r));
 assert.equal(count.rolls,2);
 assert.equal(count.nativeAmmo,3,'double shot consumed two, not four');
 assert.equal(api.getState(weapon).slots.length,0);
 assert.equal(ammo.system.quantity,5);
 await api.reload(weapon,{count:1});
 await assert.rejects(()=>api.reload(weapon,{count:2}),/capacity/i);
 assert.equal(api.getState(weapon).slots.length,1);
 await api.unload(weapon,{count:1});
 assert.equal(api.getState(weapon).slots.length,0);
 settings.set('reloadEnabled',false);
 await fire(simple);
 assert.equal(count.rolls,3,'module disabled => native PF1 allowed');
 settings.set('reloadEnabled',true);
 assert.equal(api.getState(weapon).slots.length,0,'world flag remains persisted');
 assert.equal(typeof api.timing,'undefined','action economy belongs to native Reload');
 console.log('PASS reload core: manual Reload, empty/double pre-roll denial, native ammo once, load/unload and opt-out');
})().catch(error=>{console.error(error);process.exitCode=1});
