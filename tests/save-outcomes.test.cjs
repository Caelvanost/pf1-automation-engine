const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const ns='pf1-automation-engine';
const ctxHooks={init:[],ready:[],events:new Map()};
const store=new Map();
const actors=new Map();
const docs=new Map();
let nextId=0;
const context={
  console,Map,Set,Date,Promise,setTimeout,clearTimeout,
  foundry:{utils:{deepClone:v=>structuredClone(v),randomID:()=>String(++nextId)}},
  Hooks:{once:(name,fn)=>ctxHooks[name].push(fn),on:(name,fn)=>ctxHooks.events.set(name,fn)},
  fromUuid:async uuid=>docs.get(uuid)??null,
  game:{user:{id:'gm',isGM:true,active:true},users:[{id:'gm',isGM:true,active:true}],
    settings:{get:(_ns,key)=>store.get(key),set:async(_ns,key,v)=>{store.set(key,v);return v;},
      register:(_ns,key,opts)=>{if(!store.has(key))store.set(key,opts.default);}},
    modules:new Map(),socket:{on:()=>{},emit:()=>{}},messages:new Map()},
  pf1:{registry:{conditions:new Map([['fascinated',{}]])}},
};
context.game.users.get=(id)=>context.game.users.find(x=>x.id===id);
store.set('genericEnabled',true);store.set('genericDebug',false);
context.game.modules.set(ns,{active:true,api:{}});
vm.createContext(context);
for(const file of ['effect-groups.js','save-outcomes.js']){
  vm.runInContext(fs.readFileSync(path.join(root,'scripts',file),'utf8'),context,{filename:file});
}
for(const fn of ctxHooks.init)fn();
for(const fn of ctxHooks.ready)fn();
const api=context.game.modules.get(ns).api;
function makeActor(id,name){
  const actor={documentName:'Actor',uuid:'Actor.'+id,id,name,isOwner:true,
    effects:new Map(),items:new Map(),testUserPermission:()=>true,
    createEmbeddedDocuments:async(type,values)=>{
      assert.equal(type,'ActiveEffect');
      return values.map(v=>{
        const obj={documentName:'ActiveEffect',id:'ef'+(++nextId),
          name:v.name,statuses:v.statuses,flags:v.flags,
          getFlag:(n,k)=>obj.flags?.[n]?.[k],
          delete:async()=>{actor.effects.delete(obj.id);docs.delete(obj.uuid);return true;}};
        obj.uuid=actor.uuid+'.ActiveEffect.'+obj.id;
        actor.effects.set(obj.id,obj);docs.set(obj.uuid,obj);return obj;
      });
    }
  };
  docs.set(actor.uuid,actor);actors.set(actor.uuid,actor);return actor;
}
const bard=makeActor('bard','Barde');
const janis=makeActor('janis','Janis');
const croute=makeActor('croute','Croûte');
const aram=makeActor('aram','Aram');
const source={documentName:'Item',uuid:bard.uuid+'.Item.fascination',actor:bard,
  system:{actions:{a:{id:'a',name:'Fascination'},b:{id:'b',name:'Other Action'}}}};
docs.set(source.uuid,source);
function message(id,actor,dc=16){
  const m={id,author:{id:'player'},speaker:{actor:actor?.id},flags:{},itemSource:source,
    getFlag(n,key){return this.flags?.[n]?.[key]},
    async setFlag(n,key,value){(this.flags[n]??={})[key]=value;return value;}};
  if(dc!=null) m.flags[ns]={saveContext:{sourceItemUuid:source.uuid,sourceActionId:'a',
    saveType:'will',saveDC:dc,sourceActorUuid:bard.uuid}};
  context.game.messages.set(id,m);return m;
}
context.game.modules.get(ns).api.saveContext={fromMessage:m=>m.getFlag(ns,'saveContext')};
api.generic={cancelTimer:async()=>true,extendTimer:async()=>({targetRound:12})};
const card=message('card',bard);
const cardOther=message('card-other',bard);
cardOther.flags[ns].saveContext.sourceActionId='b';
store.set('managedEffectGroups',{g1:{id:'g1',key:'fascinate',sourceUuid:bard.uuid,
  duration:null,timerId:'timer1',copies:[]}});
const event=(target,save,normal,effective,opts={})=>({
  sourceMessageId:opts.sourceMessageId??'card',
  saveMessageId:save,targetActorUuid:target.uuid,sourceItemUuid:source.uuid,
  sourceActionId:opts.sourceActionId??'a',saveType:'will',saveDC:opts.saveDC??16,
  normalTotal:normal,effectiveTotal:effective
});
(async()=>{
  const rule={actor:bard,key:'fascinate',groupKey:'fascinate',groupId:'g1',
    sourceItemUuid:source.uuid,sourceActionId:'a',
    targets:[janis.uuid,croute.uuid,aram.uuid],
    onFailure:{type:'linkedBuff',name:'Fasciné — Barde',img:'fascination.webp',statusId:'fascinated'}};
  const registered=await api.saveOutcomes.register(rule);
  assert.equal(registered.registered,true,'rule persisted on elected GM');
  assert.equal(api.saveOutcomes.list().length,1);
  // Regression PF1 v13: item.actions is a Collection<ItemAction>, while
  // system.actions can be missing or have stale/incompatible serialized data.
  const nativeAction={id:'real-fascination-action',name:'Fascination'};
  const nativeSingle={documentName:'Item',uuid:bard.uuid+'.Item.nativeSingle',actor:bard,
    actions:new Map([['collection-key-not-action-id',nativeAction]]),
    system:{actions:{incorrect:{id:'stale-action-id'}}}};
  docs.set(nativeSingle.uuid,nativeSingle);
  const discovered=context.outActions(nativeSingle);
  assert.equal(discovered.length,1,'native PF1 Collection yields one ItemAction');
  assert.equal(discovered[0],nativeAction,'returns the real ItemAction object');
  assert.equal(discovered[0].id,'real-fascination-action','uses real ItemAction.id, not Collection key');
  const nativeRule={...rule,key:'fascinate-native',sourceItemUuid:nativeSingle.uuid,
    sourceActionId:undefined,onFailure:{type:'linkedBuff',name:'Fasciné — Barde',img:'fascination.webp'}};
  let nativeRegistration=await api.saveOutcomes.register(nativeRule);
  assert.equal(nativeRegistration.registered,true,'auto-resolves unique native PF1 Action');
  let savedRule=api.saveOutcomes.list().find(r=>r.key==='fascinate-native');
  assert.equal(savedRule.sourceActionId,nativeAction.id,'registered ID matches chat actionSource.id');
  assert.equal(savedRule.onFailure.statusId,undefined,'missing statusId is valid');
  await api.saveOutcomes.unregister({actor:bard,key:'fascinate-native'});
  nativeRegistration=await api.saveOutcomes.register({...nativeRule,
    onFailure:{...nativeRule.onFailure,statusId:null}});
  savedRule=api.saveOutcomes.list().find(r=>r.key==='fascinate-native');
  assert.equal(nativeRegistration.registered,true,'null statusId is accepted');
  assert.equal(savedRule.onFailure.statusId,undefined,'null normalizes to omitted status');
  await api.saveOutcomes.unregister({actor:bard,key:'fascinate-native'});
  await assert.rejects(api.saveOutcomes.register({...nativeRule,
    onFailure:{...nativeRule.onFailure,statusId:'invented-condition'}}),
    /Not an official PF1 condition/,'unsupported statuses still rejected');
  const nativeMulti={...nativeSingle,uuid:bard.uuid+'.Item.nativeMulti',
    actions:new Map([['x',{id:'real-first'}],['y',{id:'real-second'}]])};
  docs.set(nativeMulti.uuid,nativeMulti);
  await assert.rejects(api.saveOutcomes.register({...nativeRule,
    sourceItemUuid:nativeMulti.uuid}),/valid sourceActionId/,
    'Items with multiple Actions still require explicit sourceActionId');
  await api.saveOutcomes.register({...nativeRule,key:'fascinate-multi',
    sourceItemUuid:nativeMulti.uuid,sourceActionId:'real-second'});
  savedRule=api.saveOutcomes.list().find(r=>r.key==='fascinate-multi');
  assert.equal(savedRule.sourceActionId,'real-second','explicit real Action ID retained');
  await api.saveOutcomes.unregister({actor:bard,key:'fascinate-multi'});
  // Legacy world data remains supported when item.actions is absent.
  assert.equal(context.outActions(source).length,2,'legacy system.actions fallback works');
  const roll11=message('roll11',janis);
  let res=await api.saveOutcomes._onResolved(event(janis,'roll11',11,11));
  assert.equal(res.success,false);
  assert.equal(janis.effects.size,1,'one source-specific effect created');
  assert.equal([...janis.effects.values()][0].name,'Fasciné — Barde');
  assert.equal([...janis.effects.values()][0].statuses[0],'fascinated');
  assert.equal(store.get('managedEffectGroups').g1.copies.length,1,'copy linked into group ledger');
  res=await api.saveOutcomes._onResolved(event(janis,'roll11',11,11));
  assert.equal(janis.effects.size,1,'same saving throw is idempotent');
  message('rollAgain',janis);
  await api.saveOutcomes._onResolved(event(janis,'rollAgain',10,10));
  assert.equal(janis.effects.size,1,'another failed roll of the same group does not stack its condition');
  assert.equal(res.results[0].duplicate,true);
  message('roll19',croute);
  res=await api.saveOutcomes._onResolved(event(croute,'roll19',19,19));
  assert.equal(res.success,true);
  assert.equal(croute.effects.size,0,'success does not apply effect');
  message('rollOverridden',aram);
  res=await api.saveOutcomes._onResolved(event(aram,'rollOverridden',11,23));
  assert.equal(res.success,true,'uses effective total, not original');
  assert.equal(aram.effects.size,0);
  message('roll8',aram);
  res=await api.saveOutcomes._onResolved(event(aram,'roll8',8,8));
  assert.equal(res.success,false);
  assert.equal(aram.effects.size,1,'second failed target receives own effect');
  message('rollWrongAction',janis);
  res=await api.saveOutcomes._onResolved(event(janis,'rollWrongAction',2,2,{sourceMessageId:'card-other',sourceActionId:'b'}));
  assert.equal(res.processed,false,'different Item action ignored');
  message('rollForgedDC',janis);
  res=await api.saveOutcomes._onResolved(event(janis,'rollForgedDC',2,2,{saveDC:17}));
  assert.equal(res.processed,false,'cannot change DC away from source card');
  const outsider=makeActor('outsider','Outsider');
  message('rollOutsider',outsider);
  res=await api.saveOutcomes._onResolved(event(outsider,'rollOutsider',2,2));
  assert.equal(res.processed,false,'only registered targets accepted');
  assert.equal(outsider.effects.size,0);
  const group=store.get('managedEffectGroups').g1;
  assert.equal(group.copies.length,2,'two failures attached');
  // Two different sources may supply the same PF1 condition. Each source
  // gets a separate AE, and ending one performance must preserve the other.
  const bard2=makeActor('bard2','Second Bard');
  const item2={documentName:'Item',uuid:bard2.uuid+'.Item.fascination',actor:bard2,
    system:{actions:{a:{id:'a',name:'Fascination'}}}};
  docs.set(item2.uuid,item2);
  store.set('managedEffectGroups',{...store.get('managedEffectGroups'),
    g3:{id:'g3',key:'fascinate',sourceUuid:bard2.uuid,
      duration:null,timerId:'timer3',copies:[]}});
  await api.saveOutcomes.register({...rule,actor:bard2,groupId:'g3',
    sourceItemUuid:item2.uuid,name:'Other Bard',
    onFailure:{...rule.onFailure,name:'Fasciné — Second Bard'}});
  const card3=message('card3',bard2);
  card3.flags[ns].saveContext.sourceActorUuid=bard2.uuid;
  card3.flags[ns].saveContext.sourceItemUuid=item2.uuid;
  const save3=message('roll3',janis);
  const second={...event(janis,'roll3',9,9),sourceMessageId:'card3',
    sourceItemUuid:item2.uuid};
  await api.saveOutcomes._onResolved(second);
  assert.equal(janis.effects.size,2,'two independent bard sources coexist');

  const expired=await api.effectGroups.expireGroup('g1',{fromTimer:true});
  assert.equal(expired,true);
  assert.equal(janis.effects.size,1,'ending bard 1 preserves bard 2 condition');
  assert.equal(aram.effects.size,0,'parent group cleanup Aram');
  assert.equal(api.saveOutcomes.list().length,1,'group removal unregisters only its own rule');
  await api.effectGroups.expireGroup('g3',{fromTimer:true});
  assert.equal(janis.effects.size,0,'second bard cleanup removes last condition');
  assert.equal(api.saveOutcomes.list().length,0);
  assert.equal(store.get('managedEffectGroups').g1,undefined);
  // Dynamic registry fallback: no official 'fascinated' condition must
  // still create an identified, non-global effect.
  context.pf1.registry.conditions=new Map();
  store.set('managedEffectGroups',{g2:{id:'g2',key:'fascinate',sourceUuid:bard.uuid,
    duration:null,timerId:'timer2',copies:[]}});
  const newRule={...rule,groupId:'g2'};
  await api.saveOutcomes.register(newRule);
  message('rollFallback',janis);
  await api.saveOutcomes._onResolved(event(janis,'rollFallback',6,6));
  assert.equal([...janis.effects.values()][0].statuses.length,0,'unknown status never fabricated');
  const extended=await api.effectGroups.extendGroup({actor:bard,key:'fascinate',rounds:1});
  assert.equal(extended.extended,true,'linked effect shares parent extension');
  assert.equal(janis.effects.size,1,'extend leaves linked effect active');
  const stopped=await api.effectGroups.stopGroup({actor:bard,key:'fascinate'});
  assert.equal(stopped.stopped,1,'stopGroup targets the active parent group');
  assert.equal(janis.effects.size,0,'stopGroup immediately cleans linked effect');
  console.log('PASS saveOutcomes: failed/success/overridden/multitarget/source-action/DC/dedup/group-expiry/official condition fallback');
})().catch(err=>{console.error(err);process.exitCode=1});
