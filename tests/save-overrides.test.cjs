'use strict';
/** Regression suite for persistent, data-driven save-result overrides. */
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const SOURCE=fs.readFileSync(path.join(__dirname,'../scripts/save-overrides.js'),'utf8');
const NS='pf1-automation-engine';
const world={
  settings:new Map(), documents:new Map(), chats:[],
  messages:new Map(), callbacks:new Map(),socket:new Map(),groups:[],
  soundBlocked:false,sightBlocked:false,nextId:0,debug:false
};
const users=[
  {id:'a',name:'Primary GM',isGM:true,active:true},
  {id:'b',name:'Secondary GM',isGM:true,active:true},
  {id:'p1',name:'Bard owner',isGM:false,active:true},
  {id:'p2',name:'Target owner',isGM:false,active:true}
];
users.get=id=>users.find(u=>u.id===id);
const owners={bard:['p1'],bard2:['p1'],target:['p2'],far:['p2']};
const actors={};
for(const name of ['bard','bard2','target','far']){
  actors[name]={
    id:name,name,uuid:'Actor.'+name,documentName:'Actor',isOwner:true,
    statuses:new Set(),system:{conditions:{}},
    flags:{world:{pf1CountersongState:{checkTotal:name==='bard'?23:27}}},
    getFlag(ns,key){return this.flags?.[ns]?.[key]??null;},
    testUserPermission(user,level){return user?.isGM || owners[name]?.includes(user?.id);}
  };
  world.documents.set(actors[name].uuid,actors[name]);
}
function token(name,x){
  return {uuid:'Scene.scene1.Token.'+name,actor:actors[name],center:{x,y:0}};
}
const tokens=[token('bard',0),token('bard2',20),token('target',200),token('far',400)];
const scene={id:'scene1',grid:{units:'ft'},tokens};
for(const [name,descriptor] of [['sonic','sonic'],['language','language-dependent'],['fire','fire']]){
  const item={
    id:name,uuid:'Actor.caster.Item.'+name,
    name:'Test '+name,documentName:'Item',type:'spell',
    system:{descriptors:[descriptor]},getFlag(){return null;}
  };
  world.documents.set(item.uuid,item);
}
function newClient(user){
  const hooks=new Map(),logs=[];
  const mod={active:true,api:{effectGroups:{listGroups:()=>world.groups}}};
  const game={
    user,users,modules:new Map([[NS,mod]]),
    scenes:{active:scene},messages:world.messages,
    settings:{
      register(ns,key,info){
        const k=ns+'.'+key;
        if(!world.settings.has(k))world.settings.set(k,structuredClone(info.default));
      },
      get(ns,key){
        if(key==='genericEnabled')return true;
        if(key==='genericDebug')return world.debug;
        return world.settings.get(ns+'.'+key);
      },
      async set(ns,key,value){
        world.settings.set(ns+'.'+key,structuredClone(value));return value;
      }
    },
    socket:{
      on(name,fn){world.socket.set(name,[...(world.socket.get(name)??[]),fn]);},
      emit(name,data){
        for(const fn of world.socket.get(name)??[])fn(structuredClone(data));
      }
    }
  };
  const Hooks={
    on(name,fn){hooks.set(name,[...(hooks.get(name)??[]),fn]);},
    once(name,fn){this.on(name,fn);},
    callAll(name,...args){for(const fn of hooks.get(name)??[])fn(...args);return true;},
    async fire(name,...args){for(const fn of hooks.get(name)??[])await fn(...args);}
  };
  const canvas={
    scene,grid:{
      size:10,
      measurePath(points){
        const a=points[0],b=points[1];
        return {distance:Math.hypot(a.x-b.x,a.y-b.y)/10};
      }
    }
  };
  const CONFIG={Canvas:{polygonBackends:{
    sound:{testCollision(){return world.soundBlocked;}},
    sight:{testCollision(){return world.sightBlocked;}}
  }}};
  const ChatMessage={implementation:{
    getSpeaker({actor}){return {actor:actor?.id??null};},
    async create(data){
      const id='summary-'+(++world.nextId);
      const message={id,content:data.content,flags:data.flags,speaker:data.speaker,user:{id:'a'}};
      world.chats.push(message);return message;
    }
  }};
  const context={game,Hooks,canvas,CONFIG,ChatMessage,
    fromUuid:async id=>world.documents.get(id)??null,
    foundry:{utils:{deepClone:structuredClone,randomID:()=> 'req-'+(++world.nextId)}},
    console:{debug:(...args)=>logs.push(args),error:(...args)=>logs.push(args),warn:(...args)=>logs.push(args)},
    setTimeout,clearTimeout,Date,Promise,Number};
  vm.runInNewContext(SOURCE,context,{filename:'save-overrides.js'});
  async function start(){await Hooks.fire('init');await Hooks.fire('ready');}
  return {game,Hooks,logs,start,api:()=>mod.api.saveOverrides};
}
async function settle(){for(let i=0;i<15;i++)await new Promise(r=>setTimeout(r,0));}
function group(actor,key='countersong') {
  world.groups.push({id:'group-'+actor.id,key,sourceUuid:actor.uuid,
    pendingCleanup:false,copies:[{actorUuid:actors.target.uuid}]});
}
function rule(actor,key='countersong') {
  return {actor,key,groupKey:'countersong',
    sourceActorUuid:actor.uuid,range:30,rangeUnits:'ft',
    requiresHearing:true,requiresSight:false,
    appliesTo:{magical:true,sonic:true,languageDependent:true},
    mode:'higher-result',priority:0,label:'Countersong',
    replacement:{
      type:'actorFlag',namespace:'world',key:'pf1CountersongState',
      path:'checkTotal'
    }
  };
}
(async()=>{
 const gm=newClient(users[0]),gm2=newClient(users[1]),
   bardPlayer=newClient(users[2]),targetPlayer=newClient(users[3]);
 await gm.start();await gm2.start();await bardPlayer.start();await targetPlayer.start();
 group(actors.bard);
 // The player can register, but it is written by one elected GM over socket.
 const sent=await bardPlayer.api().register(rule(actors.bard));
 assert.equal(sent.submitted,true);
 await settle();
 assert.equal(gm.api().list().length,1);
 assert.equal(gm.api().list()[0].replacement.key,'pf1CountersongState');

 // Exact real-world regression: Captivating Song (Su, PF1 system.tags Set)
 // and one Countersong at 10 versus an ordinary Will total of 7.
 const harpyItem={
   id:'captivating-song',uuid:'Actor.harpy.Item.captivating-song',
   name:'Captivating Song',documentName:'Item',type:'feat',
   system:{abilityType:'su',tags:new Set(['sonic','mind-affecting','charm'])},
   getFlag(){return null;}
 };
 world.documents.set(harpyItem.uuid,harpyItem);
 actors.bard.flags.world.pf1CountersongState.checkTotal=10;
 world.debug=true;
 let testDecision=await gm.api().resolve({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:harpyItem.uuid,normalTotal:7
 });
 assert.equal(testDecision.normalTotal,7);
 assert.equal(testDecision.effectiveTotal,10,'Su + sonic countersong overrides 7');
 assert.equal(testDecision.winner?.value,10);
 testDecision=await gm.api().resolve({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:harpyItem.uuid,normalTotal:17
 });
 assert.equal(testDecision.effectiveTotal,17,'higher native Will remains 17');
 const plainSupernatural={
   ...harpyItem,id:'other-su',uuid:'Actor.harpy.Item.other-su',
   name:'Other Supernatural Ability',
   system:{abilityType:'su',tags:new Set(['mind-affecting','charm'])}
 };
 world.documents.set(plainSupernatural.uuid,plainSupernatural);
 testDecision=await gm.api().resolve({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:plainSupernatural.uuid,normalTotal:7
 });
 assert.equal(testDecision.effectiveTotal,7,'Su without sonic/language is ignored');

 // Actual helper API regression: helper must await the elected GM, return
 // effectiveTotal and leave the native PF1 ChatMessage roll at 7.
 let nextSave=7;
 actors.target.rollSavingThrow=async(saveType,options)=>{
   const id='harpy-'+(++world.nextId);
   const message={id,documentName:'ChatMessage',
     author:{id:'p2'},speaker:{actor:actors.target.id},
     rolls:[{total:nextSave}],
     flags:{},
     getFlag(ns,key){return this.flags?.[ns]?.[key]??null;},
     async setFlag(ns,key,value){this.flags[ns]??={};this.flags[ns][key]=value;}
   };
   await targetPlayer.Hooks.fire('pf1PreActorRollSave',actors.target,options,saveType);
   world.messages.set(id,message);
   await targetPlayer.Hooks.fire('pf1ActorRollSave',actors.target,message,saveType);
   return message;
 };
 const first=await targetPlayer.api().rollWithContext({
   actor:actors.target,saveType:'will',
   sourceItemUuid:harpyItem.uuid,options:{}
 });
 assert.equal(first.processed,true);
 assert.equal(first.normalTotal,7);
 assert.equal(first.effectiveTotal,10);
 assert.equal(first.nativeResult.rolls[0].total,7,
   'PF1 roll remains an authentic normal 7');
 assert.equal(world.chats.length,1,'one chat summary for Su sonic Will');
 assert.match(world.chats[0].content,/Result used: 10/);
 assert.equal(first.nativeResult.getFlag(NS,'saveOverride').effectiveTotal,10);
 nextSave=17;
 const second=await targetPlayer.api().rollWithContext({
   actor:actors.target,saveType:'will',
   sourceItemUuid:harpyItem.uuid,options:{}
 });
 assert.equal(second.effectiveTotal,17);
 assert.match(world.chats[1].content,/Result used: 17/);
 nextSave=7;
 const unrelated=await targetPlayer.api().rollWithContext({
   actor:actors.target,saveType:'will',
   sourceItemUuid:plainSupernatural.uuid,options:{}
 });
 assert.equal(unrelated.effectiveTotal,7);
 assert.equal(world.chats.length,2,'no extra chat summary for non-sonic effect');
 const debugText=gm.logs.map(v=>String(v[0])).join('\n');
 for(const expected of ['Source: Captivating Song','Source ability type: supernatural',
   'Source tags: sonic','Dynamic replacement resolved: 10',
   'Normal save: 7','Effective result: 10',
   'Rule rejected: no matching anyOf descriptor']) {
   assert.ok(debugText.includes(expected),'Expected debug event: '+expected);
 }
 world.debug=false;
 world.chats.length=0;
 actors.bard.flags.world.pf1CountersongState.checkTotal=23;

 let evaluation=await gm.api().resolve({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:'Actor.caster.Item.sonic',normalTotal:17
 });
 assert.equal(evaluation.effectiveTotal,23,'higher performance replaces save');
 assert.equal(evaluation.changed,true);
 assert.equal(evaluation.winner.sourceActorUuid,actors.bard.uuid);

 evaluation=await gm.api().resolve({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:'Actor.caster.Item.sonic',normalTotal:26
 });
 assert.equal(evaluation.effectiveTotal,26,'higher save is never reduced');
 assert.equal(evaluation.changed,false);

 let candidates=await gm.api().getApplicable({
   targetActorUuid:actors.far.uuid,saveType:'will',
   sourceItemUuid:'Actor.caster.Item.sonic'
 });
 assert.equal(candidates.length,0,'out-of-range target skipped');

 // Metric scenes use Foundry grid measurements with converted thresholds.
 scene.grid.units='m';
 const targetToken=tokens.find(t=>t.actor===actors.target);
 targetToken.center.x=80; // mock grid reports 8 meters
 candidates=await gm.api().getApplicable({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:'Actor.caster.Item.sonic'
 });
 assert.equal(candidates.length,1,'8 meters is inside 30 ft range');
 targetToken.center.x=100; // mock grid reports 10 meters
 candidates=await gm.api().getApplicable({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:'Actor.caster.Item.sonic'
 });
 assert.equal(candidates.length,0,'10 meters is outside 30 ft range');
 scene.grid.units='ft';
 targetToken.center.x=200;

 actors.target.statuses.add('deafened');
 candidates=await gm.api().getApplicable({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:'Actor.caster.Item.sonic'
 });
 assert.equal(candidates.length,0,'deafened target skipped');
 actors.target.statuses.clear();

 world.soundBlocked=true;
 candidates=await gm.api().getApplicable({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:'Actor.caster.Item.sonic'
 });
 assert.equal(candidates.length,0,'sound wall blocks effect');
 world.soundBlocked=false;

 candidates=await gm.api().getApplicable({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:'Actor.caster.Item.fire'
 });
 assert.equal(candidates.length,0,'ordinary magical effect is not sonic/language');
 candidates=await gm.api().getApplicable({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:'Actor.caster.Item.language'
 });
 assert.equal(candidates.length,1,'language-dependent spell qualifies');
 candidates=await gm.api().getApplicable({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:'Actor.caster.Item.sonic'
 });
 assert.equal(candidates.length,1,'sonic spell qualifies');

 // Bard's own target is eligible if it can hear; no wall/distance required.
 candidates=await gm.api().getApplicable({
   targetActorUuid:actors.bard.uuid,saveType:'fort',
   sourceItemUuid:'Actor.caster.Item.sonic'
 });
 assert.equal(candidates.length,1);

 // Refresh the current value from the actor flag on EVERY saving throw.
 actors.bard.flags.world.pf1CountersongState.checkTotal=18;
 evaluation=await gm.api().resolve({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:'Actor.caster.Item.sonic',normalTotal:20
 });
 assert.equal(evaluation.effectiveTotal,20,'stale original value must not survive');
 actors.bard.flags.world.pf1CountersongState.checkTotal=23;

 // Multiple countersongs: one summary and the best replacement, not stacking.
 group(actors.bard2);
 await gm.api().register(rule(actors.bard2));
 evaluation=await gm.api().resolve({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:'Actor.caster.Item.sonic',normalTotal:15
 });
 assert.equal(evaluation.candidates.length,2);
 assert.equal(evaluation.effectiveTotal,27);
 assert.equal(evaluation.winner.sourceActorUuid,actors.bard2.uuid);
 assert.equal(evaluation.winner.value,27);

 // Native PF1 post-save hooks (actor,result,save): only an annotated
 // roll may be resolved. GM verifies the actual ChatMessage roll total.
 world.messages.set('m1',{id:'m1',author:{id:'p2'},
   speaker:{actor:actors.target.id},rolls:[{total:17}]});
 const annotated={pf1aeSave:{sourceItemUuid:'Actor.caster.Item.sonic'},
   token:tokens.find(t=>t.actor===actors.target)};
 await targetPlayer.Hooks.fire('pf1PreActorRollSave',actors.target,annotated,'will');
 await targetPlayer.Hooks.fire('pf1ActorRollSave',actors.target,world.messages.get('m1'),'will');
 await settle();
 assert.equal(world.chats.length,1,'one summary for one saving throw, two bard rules');
 assert.ok(world.chats[0].content.includes('Result used: 27'));
 // Duplicated delivery (different event ID, same original message) is ignored.
 await targetPlayer.Hooks.fire('pf1PreActorRollSave',actors.target,annotated,'will');
 await targetPlayer.Hooks.fire('pf1ActorRollSave',actors.target,world.messages.get('m1'),'will');
 await settle();
 assert.equal(world.chats.length,1);

 // An unrelated unannotated native save does NOT get a replacement.
 world.messages.set('m2',{id:'m2',author:{id:'p2'},
   speaker:{actor:actors.target.id},rolls:[{total:12}]});
 await targetPlayer.Hooks.fire('pf1PreActorRollSave',actors.target,{},'will');
 await targetPlayer.Hooks.fire('pf1ActorRollSave',actors.target,world.messages.get('m2'),'will');
 await settle();
 assert.equal(world.chats.length,1);

 // Reload after F5: world registrations are rehydrated, not JS functions.
 const reloadedGM=newClient(users[0]);await reloadedGM.start();
 evaluation=await reloadedGM.api().resolve({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:'Actor.caster.Item.sonic',normalTotal:17
 });
 assert.equal(evaluation.effectiveTotal,27);
 assert.equal(reloadedGM.api().list().length,2);

 // Expired group must cease to apply, then be pruned from world settings.
 world.groups=world.groups.filter(g=>g.sourceUuid!==actors.bard2.uuid);
 evaluation=await reloadedGM.api().resolve({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:'Actor.caster.Item.sonic',normalTotal:17
 });
 assert.equal(evaluation.effectiveTotal,23);
 await reloadedGM.api()._onGroupRemoved(actors.bard2.uuid,'countersong');
 assert.equal(reloadedGM.api().list().length,1);
 world.groups=[];
 await reloadedGM.api()._onGroupRemoved(actors.bard.uuid,'countersong');
 assert.equal(reloadedGM.api().list().length,0);
 evaluation=await reloadedGM.api().resolve({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:'Actor.caster.Item.sonic',normalTotal:17
 });
 assert.equal(evaluation.effectiveTotal,17);

 // Reject executable providers, code from sockets and unsupported schemes.
 await assert.rejects(()=>gm.api().register({...rule(actors.bard),
   replacementProvider:async()=>99}),/cannot be persisted/);
 await assert.rejects(()=>gm.api().register({...rule(actors.bard),
   replacement:{type:'function',code:'return 99'}}),/replacement/);

 // Secondary GM takeover: former leader no longer handles socket commands.
 users[0].active=false;
 group(actors.bard);
 const playerSent=await bardPlayer.api().register(rule(actors.bard));
 assert.equal(playerSent.submitted,true);
 await settle();
 assert.equal(gm2.api().list().length,1);
 evaluation=await gm2.api().resolve({
   targetActorUuid:actors.target.uuid,saveType:'will',
   sourceItemUuid:'Actor.caster.Item.sonic',normalTotal:17
 });
 assert.equal(evaluation.effectiveTotal,23);
 assert.equal(world.chats.length,1,'no duplicate messages on GM handoff');
 console.log('PASS v1.11 saveOverrides: dynamic result, range/hearing, descriptors, dual bard, F5, player hook and GM failover');
})().catch(err=>{console.error(err);process.exitCode=1;});
