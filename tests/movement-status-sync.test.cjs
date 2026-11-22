'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

const hooks=new Map(),warnings=[],changes=[];
function fire(name,...args){
 for(const cb of hooks.get(name)??[])cb(...args);
}
const script=fs.readFileSync(
 path.resolve(__dirname,'../scripts/movement-status-sync.js'),'utf8');
const statuses=new Map([
 ['pf1_flying',{id:'pf1_flying',name:'Flying',label:'Vol'}],
 ['pf1_swimming',{id:'pf1_swimming',name:'Swimming',label:'Nager'}]
]);
const users={activeGM:{id:'GM'}};
const game={system:{id:'pf1'},user:{id:'GM',isGM:true},users,
 i18n:{localize:v=>v}};
const tokenDocs=[],scene={id:'s'};
const canvas={scene,tokens:{placeables:[]}};
const effects=[];
const actor={id:'actor',uuid:'Actor.actor',statuses:new Set(),
 effects:{contents:effects},isOwner:true,async toggleStatusEffect(id,{active}={}){
  assert.ok(statuses.has(id),'only native PF1 statuses may be toggled');
  changes.push({id,active});
  const effect=effects.find(e=>e.statuses.has(id));
  if(active&&!effect){
   const created={parent:actor,name:statuses.get(id).name,
    statuses:new Set([id]),disabled:false};
   effects.push(created);
   actor.statuses.add(id);
   fire('createActiveEffect',created);
  }else if(!active&&effect){
   effects.splice(effects.indexOf(effect),1);
   actor.statuses.delete(id);
   fire('deleteActiveEffect',effect);
  }
 }};
function token(id){
 const doc={id,uuid:'Scene.s.Token.'+id,actor,parent:{id:'s'},
  movementAction:'walk',async update(data){
   assert.ok(Object.hasOwn(data,'movementAction'));
   changes.push({token:id,movement:data.movementAction});
   this.movementAction=data.movementAction;
   fire('updateToken',this,data);
  }};
 tokenDocs.push(doc);
 canvas.tokens.placeables.push({document:doc});
 return doc;
}
const a=token('a'),b=token('b');
const ctx={console:{warn:(...args)=>warnings.push(args)},
 game,canvas,CONFIG:{statusEffects:statuses},
 Hooks:{on(name,cb){
  const list=hooks.get(name)??[];list.push(cb);hooks.set(name,list);
 }},Set,Map,Array,Object,String,Promise,Math};
ctx.globalThis=ctx;
vm.createContext(ctx);
vm.runInContext(script,ctx,{filename:'movement-status-sync.js'});
const tick=async()=>{await new Promise(resolve=>setImmediate(resolve));};
(async()=>{
 assert.equal(hooks.get('updateToken').length,1);
 assert.equal(hooks.get('createActiveEffect').length,1);
 // Effect => token movement, for both linked tokens.
 await actor.toggleStatusEffect('pf1_flying',{active:true});
 await tick();
 assert.equal(a.movementAction,'fly');
 assert.equal(b.movementAction,'fly');
 assert.equal(actor.statuses.has('pf1_flying'),true);
 assert.equal(actor.statuses.has('pf1_swimming'),false);
 // Switching movement action removes the old native PF1 effect and
 // enables the new one without a duplicate or infinite feedback loop.
 await a.update({movementAction:'swim'});
 await tick();
 assert.equal(actor.statuses.has('pf1_flying'),false);
 assert.equal(actor.statuses.has('pf1_swimming'),true);
 assert.equal(changes.filter(x=>x.id==='pf1_swimming'&&x.active).length,1);
 // The target action changes on the token that was switched.
 assert.equal(a.movementAction,'swim');
 // Effects removed from PF1 HUD => movement returns to walking.
 await actor.toggleStatusEffect('pf1_swimming',{active:false});
 await tick();
 assert.equal(a.movementAction,'walk');
 assert.equal(b.movementAction,'walk');
 // Movement => native PF1 effect then returning to walk removes it.
 await a.update({movementAction:'fly'});
 await tick();
 assert.equal(actor.statuses.has('pf1_flying'),true);
 await a.update({movementAction:'walk'});
 await tick();
 assert.equal(actor.statuses.has('pf1_flying'),false);
 // Add swim directly => both scene tokens update.
 await actor.toggleStatusEffect('pf1_swimming',{active:true});
 await tick();
 assert.equal(a.movementAction,'swim');
 assert.equal(b.movementAction,'swim');
 // PF1 effect disabled or re-enabled in effect sheet changes movement.
 const swimming=effects.find(e=>e.statuses.has('pf1_swimming'));
 swimming.disabled=true;
 actor.statuses.delete('pf1_swimming');
 fire('updateActiveEffect',swimming,{disabled:true});
 await tick();
 assert.equal(a.movementAction,'walk');
 swimming.disabled=false;
 actor.statuses.add('pf1_swimming');
 fire('updateActiveEffect',swimming,{disabled:false});
 await tick();
 assert.equal(a.movementAction,'swim');
 await actor.toggleStatusEffect('pf1_swimming',{active:false});
 await tick();
 // Levitation is a distinct native PF1 condition but selects Fly on
 // every scene token without adding a synthetic Flying status.
 const levitation={parent:actor,name:'Levitation',
  statuses:new Set(['pf1_levitation']),disabled:false};
 effects.push(levitation);
 actor.statuses.add('pf1_levitation');
 fire('createActiveEffect',levitation);
 await tick();
 assert.equal(a.movementAction,'fly');
 assert.equal(b.movementAction,'fly');
 assert.equal(actor.statuses.has('pf1_flying'),false,
  'Levitation must not synthesize native Flying');
 // Manually choosing walk or swim while levitating must not silently
 // create/remove a real PF1 effect or override Levitation.
 await a.update({movementAction:'walk'});
 await tick();
 assert.equal(a.movementAction,'fly','active Levitation retains Fly mode');
 assert.equal(actor.statuses.has('pf1_swimming'),false);
 const extraLevitation={parent:actor,name:'Lévitation',
  statuses:new Set(['pf1_levitating']),disabled:false};
 effects.push(extraLevitation);actor.statuses.add('pf1_levitating');
 fire('createActiveEffect',extraLevitation);
 await tick();
 levitation.disabled=true;actor.statuses.delete('pf1_levitation');
 fire('updateActiveEffect',levitation,{disabled:true});
 await tick();
 assert.equal(a.movementAction,'fly',
  'disabling one source cannot cancel another active Levitation');
 effects.splice(effects.indexOf(extraLevitation),1);
 actor.statuses.delete('pf1_levitating');
 fire('deleteActiveEffect',extraLevitation);
 await tick();
 assert.equal(a.movementAction,'walk',
  'last Levitation removal restores ordinary movement');
 assert.equal(b.movementAction,'walk');
 // Native flying still takes precedence when Levitation expires.
 await actor.toggleStatusEffect('pf1_flying',{active:true});
 levitation.disabled=false;
 actor.statuses.add('pf1_levitation');
 fire('updateActiveEffect',levitation,{disabled:false});
 await tick();
 effects.splice(effects.indexOf(levitation),1);
 actor.statuses.delete('pf1_levitation');
 fire('deleteActiveEffect',levitation);
 await tick();
 assert.equal(a.movementAction,'fly','native Flying keeps Fly movement');
 await actor.toggleStatusEffect('pf1_flying',{active:false});
 await tick();
 assert.equal(a.movementAction,'walk');
 // Reconcile an effect already present before reconnect/scene switch.
 effects.push(levitation);actor.statuses.add('pf1_levitation');
 a.movementAction='walk';b.movementAction='walk';
 fire('canvasReady');
 await tick();
 assert.equal(a.movementAction,'fly');
 assert.equal(b.movementAction,'fly');
 effects.splice(effects.indexOf(levitation),1);
 actor.statuses.delete('pf1_levitation');
 fire('deleteActiveEffect',levitation);
 await tick();
 // Non-leading player must not run a competing synchronization.
 game.user={id:'player',isGM:false};
 await a.update({movementAction:'fly'});
 await tick();
 assert.equal(actor.statuses.has('pf1_flying'),false);
 game.user={id:'GM',isGM:true};
 // Unknown token mode must not invent effects; no prior flying effect.
 await a.update({movementAction:'teleport'});
 await tick();
 assert.equal(actor.statuses.has('pf1_flying'),false);
 assert.equal(warnings.length,0,'no unexpected runtime warnings');
 assert.ok(changes.length<80,'finite loop / bounded event fan-out');
 console.log('PASS movement ↔ PF1 native flying/swimming status effects');
})().catch(error=>{console.error(error);process.exitCode=1;});
