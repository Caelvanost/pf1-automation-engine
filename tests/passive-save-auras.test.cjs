'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../scripts/passive-save-auras.js'),'utf8');
const hooks=new Map(),ready=[],msgs=[];
const on=(n,fn)=>hooks.set(n,[...(hooks.get(n)??[]),fn]);
const fire=(n,...args)=>(hooks.get(n)??[]).forEach(f=>f(...args));
const gm={id:'a',isGM:true,active:true},otherGM={id:'b',isGM:true,active:true};
const player={id:'p',isGM:false,active:true};
const world={id:'s',tokens:{contents:[]}};
const notes=[];
const pf1Module={active:true,api:{scriptApprovals:{check:()=>({approved:true})}}};
const game={user:gm,users:[gm,otherGM,player],
 modules:new Map([['pf1-automation-engine',pf1Module]]),
 scenes:{active:world,contents:[world]},actors:{contents:[]},
 messages:new Map()};
const actor={uuid:'Actor.pal',documentName:'Actor',items:{contents:[]}};
const beneficiary={uuid:'Actor.friend',documentName:'Actor',items:{contents:[]},
 sources:[{modifier:'base',value:5}],getSourceDetails(){return this.sources}};
game.actors.contents.push(actor,beneficiary);
const token={uuid:'Scene.s.Token.pal',actor};
world.tokens.contents.push(token);
const traitItem=(id,tags,type='spell')=>({
 uuid:'Actor.enemy.Item.'+id,documentName:'Item',type,system:{tags,
  actions:{}},getFlag:()=>null});
const fearMagic=traitItem('fear-magic',['fear'],'spell');
const fearEx=traitItem('fear-natural',['fear'],'feat');
const charm=traitItem('charm',['charm']);
const compulsion=traitItem('compulsion',['compulsion']);
const poison=traitItem('poison',['poison']);
const noTraits=traitItem('none',[]);
const map=new Map([fearMagic,fearEx,charm,compulsion,poison,noTraits]
 .map(item=>[item.uuid,item]));
let execCount=0,allow=true;
const nativeCall={id:'passive',category:'postUse',
 name:'PF1AE:aura:passive',_source:{command:'api.register({...})'},
 async execute(_action,{api,emitterTokenUuid}){
  execCount++;assert.equal(emitterTokenUuid,token.uuid);
  return api.register({key:'generic-passive'});
 }};
const sourceItem={uuid:'Actor.pal.Item.feature',documentName:'Item',actor,
 system:{disabled:false},scriptCalls:{contents:[nativeCall]}};
actor.items.contents.push(sourceItem);
const active=[
 {label:'Generic bravery',savingThrowBonus:{bonusType:'morale',value:4,
  saves:['fort','ref','will'],appliesTo:{descriptors:['fear']}}}
];
const auras={getSavingThrowAuras(_actor,id,descriptors){
 return descriptors.includes('fear')?active.filter(a=>a.savingThrowBonus.saves.includes(id)):[];
},async register(){return {created:true}}};
pf1Module.api.proximityAuras=auras;
const ctx={game,console,Hooks:{on,once:(n,fn)=>{if(n==='ready')ready.push(fn)}},
 fromUuidSync:id=>map.get(id)??null,
 Object,Set,Map,WeakMap,Promise,Number,Date};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'passive-save-auras.js'});
ready.forEach(fn=>fn());
const api=pf1Module.api.conditionalSaveAuras;
const optionsFor=(item,bonus=0)=>({bonus,pf1aeSave:{sourceItemUuid:item.uuid}});
const evalSave=(item,saveId='will',bonus=0)=>api.evaluate(beneficiary,
 optionsFor(item,bonus),saveId);
(async()=>{
 await api.discover();
 assert.equal(execCount,1,'one approved passive script on GM');
 await api.discover();assert.equal(execCount,1,'no duplicate after scene rescan');
 game.user=otherGM;
 await api.discover();assert.equal(execCount,1,'secondary GM never executes scripts');
 game.user=player;
 const forSave=optionsFor(fearMagic,'1');
 fire('pf1PreActorRollSave',beneficiary,forSave,'will');
 assert.equal(forSave.bonus,'(1) + 4');
 assert.equal(forSave.pf1aeConditionalAura.value,4);
 fire('pf1PreActorRollSave',beneficiary,forSave,'will');
 assert.equal(forSave.bonus,'(1) + 4','same native roll options never duplicate');
 assert.equal(evalSave(fearMagic).extra,4);
 beneficiary.sources.push({modifier:'morale',value:2});
 assert.equal(evalSave(fearMagic).extra,2,'native +2 becomes effective +2');
 beneficiary.sources[1].value=4;
 assert.equal(evalSave(fearMagic).extra,0,'native +4 takes precedence');
 beneficiary.sources[1].value=5;
 assert.equal(evalSave(fearMagic).extra,0,'native +5 takes precedence');
 beneficiary.sources[1].value=2;
 active.push({...active[0],label:'Second matching aura'});
 assert.equal(evalSave(fearMagic).extra,2,'two morale auras do not stack');
 for(const id of ['fort','ref','will'])
  assert.equal(evalSave(fearEx,id).extra,2,
   'nonmagical fear qualifies '+id);
 for(const item of [charm,compulsion,poison])
  assert.equal(evalSave(item).status,'skipped',
   'unrelated structured descriptor does not match');
 assert.equal(evalSave(noTraits).status,'unknown',
  'no descriptor => no bonus');
 beneficiary.sources=[];
 assert.equal(evalSave(fearMagic).status,'uncertain',
  'missing native provenance must fail closed');
 beneficiary.sources=[{modifier:'base',value:5},{modifier:'morale',value:2}];
 // A verified native PF1 immunity to the condition type fear cancels
 // the existing native save; there is no second roll or invented success.
 beneficiary.getConditionImmunities=()=>new Set(['fear']);
 const immunityOptions=optionsFor(fearMagic,'0');
 const preResult=hooks.get('pf1PreActorRollSave')[0](
  beneficiary,immunityOptions,'will');
 assert.equal(preResult,false,'native fear immunity cancels PF1 save');
 assert.equal(immunityOptions.bonus,'0','immune creature has no aura roll bonus');
 beneficiary.getConditionImmunities=()=>new Set();
 // Existing native ChatMessage carries only an annotation, no new roll.
 const msg={documentName:'ChatMessage',flags:{},
  async setFlag(_ns,k,v){this.flags[k]=v;msgs.push(v)}};
 const o=optionsFor(fearMagic,'0');
 fire('pf1PreActorRollSave',beneficiary,o,'will');
 assert.equal(o.bonus,'(0) + 2');
 fire('pf1ActorRollSave',beneficiary,msg,'will');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(msg.flags.conditionalAuraSave.value,2,
  'annotation belongs to same native PF1 ChatMessage');
 assert.equal(msgs.length,1,'never creates a second roll');
 // Fingerprint-based approval protects changed scripts.
 pf1Module.api.scriptApprovals.check=()=>({approved:false});
 game.user=gm;token.uuid='Scene.s.Token.other';await api.discover();
 assert.equal(execCount,1,'unapproved modified native script never runs');
 pf1Module.api.scriptApprovals.check=()=>({approved:true});
 await api.discover();
 assert.equal(execCount,2,'approved native script is discoverable on changed token');
 console.log('PASS passive-save-auras: native pre-roll, structured fear, morale stacking, fail closed, discovery, multiplayer, chat');
})().catch(err=>{console.error(err);process.exitCode=1});
