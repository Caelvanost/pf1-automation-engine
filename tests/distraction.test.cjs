const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../scripts/save-overrides.js'),'utf8');
const regs=new Map();let collision=false,distance=18,sceneUnit='ft';
const scene={id:'s',grid:{units:'ft'},tokens:[]};
const mods=new Map([['pf1-automation-engine',{active:true,api:{effectGroups:{listGroups:()=>[{sourceUuid:'Actor.bard',key:'distraction',copies:[{}]},{sourceUuid:'Actor.bard2',key:'distraction',copies:[{}]},{sourceUuid:'Actor.bard',key:'countersong',copies:[{}]}]}}}]]);
const flags={pf1DistractionState:{checkTotal:23},pf1CountersongState:{checkTotal:23}};
const makeActor=(id,x)=>({documentName:'Actor',uuid:'Actor.'+id,id, name:id, statuses:new Set(),system:{conditions:{}},getFlag(ns,key){return flags[key]},hasCondition(k){return this.statuses.has(k)}});
const bard=makeActor('bard'),bard2=makeActor('bard2'),target=makeActor('target');
const tokens=[bard,bard2,target].map((actor,i)=>({uuid:'Scene.s.Token.'+actor.id,actor,actorId:actor.id,x:i*100,y:0,width:1,height:1}));scene.tokens=tokens;
const item={documentName:'Item',type:'spell',uuid:'Actor.caster.Item.illusion',name:'Illusion',system:{school:'ill',subschool:new Set(['pattern']),tags:new Set(),actions:{foo:{tags:new Set(['figment'])}}},getFlag:()=>null};
const context={console,Set,Map,Date,Number,Object,Array,String,Promise,Math,JSON,
  Hooks:{once:()=>{}},foundry:{utils:{deepClone:structuredClone,randomID:()=> 'random'}},
  game:{user:{id:'gm',isGM:true},users:[{id:'gm',active:true,isGM:true}],modules:mods,
    settings:{get:(ns,k)=> k==='genericEnabled'?true:k==='genericDebug'?false:k==='saveOverrideRegistry'?Array.from(regs.values()):[],set:async()=>{}},scenes:{active:scene}},
  canvas:{scene,grid:{size:100,measurePath:()=>({distance})}},
  CONFIG:{Canvas:{polygonBackends:{sight:{testCollision:()=>collision},sound:{testCollision:()=>collision}}}},
  fromUuid:async id=>({[bard.uuid]:bard,[bard2.uuid]:bard2,[target.uuid]:target,[item.uuid]:item})[id]??null,
};
vm.createContext(context);vm.runInContext(src,context,{filename:'save-overrides.js'});
const rule={id:'Actor.bard:distraction',key:'distraction',groupKey:'distraction',sourceActorUuid:bard.uuid,range:30,rangeUnits:'ft',requiresSight:true,appliesTo:{magical:true,anyOf:['pattern','figment'],allOf:[]},mode:'higher-result',priority:0,replacement:{type:'actorFlag',namespace:'world',key:'pf1DistractionState',path:'checkTotal'},label:'Distraction'};
async function candidates(){return context.soFindCandidates({targetActorUuid:target.uuid,sourceItemUuid:item.uuid,saveType:'will',sourceActionId:'foo'})}
async function main(){
  regs.set('d',rule);
  assert.equal(context.soValidation({...rule,actor:bard},bard).requiresSight,true);
  assert.equal(context.soMatchesPredicate({magical:true,pattern:true,figment:false,sonic:false,languageDependent:false},rule.appliesTo).ok,true);
  assert.equal(context.soMatchesPredicate({magical:true,pattern:false,figment:true,sonic:false,languageDependent:false},rule.appliesTo).ok,true);
  assert.equal(context.soMatchesPredicate({magical:true,pattern:false,figment:false},rule.appliesTo).ok,false);
  assert.equal(context.soMatchesPredicate({magical:false,pattern:true,figment:false},rule.appliesTo).ok,false);
  assert.equal((await candidates()).length,1,'pattern should match');
  assert.equal((await context.soResolve({targetActorUuid:target.uuid,sourceItemUuid:item.uuid,sourceActionId:'foo',saveType:'will',normalTotal:12})).effectiveTotal,23);
  assert.equal((await context.soResolve({targetActorUuid:target.uuid,sourceItemUuid:item.uuid,sourceActionId:'foo',saveType:'will',normalTotal:24})).effectiveTotal,24);
  collision=true;assert.equal((await candidates()).length,0,'blocked sight');collision=false;
  target.statuses.add('blind');assert.equal((await candidates()).length,0,'blind target');target.statuses.clear();
  distance=31;assert.equal((await candidates()).length,0,'out of range');distance=18;
  scene.grid.units='m';distance=9.2;assert.equal((await candidates()).length,0,'metric out of range');distance=8;assert.equal((await candidates()).length,1,'metric inside');scene.grid.units='ft';
  item.system.subschool=new Set(['figment']);assert.equal((await candidates()).length,1,'figment subschool');
  item.system.subschool=new Set(['shadow']);assert.equal((await candidates()).length,0,'structured subschool must override action tag');
  item.system.subschool=new Set(['pattern']);item.system.school='evo';assert.equal((await candidates()).length,0,'non-illusion school with structured subschool');item.system.subschool=new Set();item.system.tags=new Set(['pattern']);assert.equal((await candidates()).length,0,'non-illusion school must reject even explicit tags');item.system.school='ill';
  item.system.subschool=new Set();item.system.tags=new Set(['pattern']);assert.equal((await candidates()).length,1,'tag fallback');
  item.system.tags=new Set(['other']);item.system.subschool=new Set(['pattern']);item.type='feat';item.system.abilityType='ex';assert.equal((await candidates()).length,0,'nonmagical type');item.system.abilityType='su';assert.equal((await candidates()).length,1,'supernatural type');item.type='spell';delete item.system.abilityType;
  item.system.actions.foo.tags=new Set();item.system.subschool=new Set();item.system.tags=new Set(['sonic']);
  assert.equal((await candidates()).length,0,'sonic is not illusion pattern');
  regs.set('c',{...rule,id:'Actor.bard:countersong',key:'countersong',groupKey:'countersong',requiresSight:false,requiresHearing:true,appliesTo:{magical:true,anyOf:['sonic'],allOf:[]},replacement:{type:'actorFlag',namespace:'world',key:'pf1CountersongState',path:'checkTotal'}});
  assert.equal((await candidates()).length,1,'Countersong sonic regression');
  item.system.tags=new Set(['pattern']);assert.equal((await candidates()).length,1,'Distraction only');
  item.system.tags=new Set(['pattern','sonic']);assert.equal((await candidates()).length,2,'both effects coexist');
  regs.set('d2',{...rule,id:'Actor.bard2:distraction',sourceActorUuid:bard2.uuid,replacement:{type:'actorFlag',namespace:'world',key:'pf1DistractionState',path:'checkTotal'}});
  assert.equal((await candidates()).length,3,'multiple bards');
  // A self-target may have one token, not two separate tokens.
  regs.delete('d2');regs.delete('c');rule.sourceActorUuid=target.uuid;rule.id='Actor.target:distraction';
  mods.get('pf1-automation-engine').api.effectGroups.listGroups=()=>[{sourceUuid:target.uuid,key:'distraction',copies:[{}]}];
  item.system.tags=new Set(['pattern']);assert.equal((await candidates()).length,1,'self sight allowed');
  target.statuses.add('blind');assert.equal((await candidates()).length,0,'blind self rejected');
  console.log('PASS 20 scenarios: anyOf, structured subschool, sight, blindness, range, dynamic flag, multi-bard, Countersong, self');
}
main().catch(e=>{console.error(e);process.exitCode=1});