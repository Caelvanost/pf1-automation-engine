'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const SOURCE=fs.readFileSync(path.resolve(__dirname,'../scripts/ranged-melee.js'),'utf8');
const NS='pf1-automation-engine';
const user={id:'player',isGM:false,active:true,targets:new Set()};
const gm={id:'gm',isGM:true,active:true};
const manualChoices=[];
const settings=new Map([['genericEnabled',true],['autoRangedMeleePenalty',true],
 ['genericDebug',false]]);
let nativeCalls=0,scriptInvoked=0;
class ActionUse{
 constructor(actor,item,action,token,count=1){
  this.actor=actor;this.item=item;this.action=action;this.token=token;
  this.shared={attacks:Array.from({length:count},(_,i)=>({type:null,attackBonus:String(-5*i)})),
   chatAttacks:[],rollData:{},attackBonus:['1[Point Blank Shot]'],
   useOptions:{},formData:{}};
 }
 async addAttacks(){
  nativeCalls++;
  this.results=this.shared.attacks.map(a=>[...this.shared.attackBonus,a.attackBonus]);
  // Mimic actual PF1 ActionUse.addAttacks loop consuming attackBonus.
  this.shared.chatAttacks.push(...this.results.map(x=>({parts:x})));
  return this.results;
 }
}
const hooks=new Map(),ready=[];
const on=(name,fn)=>{const arr=hooks.get(name)??[];arr.push(fn);hooks.set(name,arr)};
const actor=(name,size,reach=5,owned=true)=>({
 name,uuid:'Actor.'+name,documentName:'Actor',
 system:{traits:{size},attributes:{reach:{total:reach},hp:{value:20}}},
 items:{contents:[]},statuses:new Set(),
 testUserPermission(u,role){return role==='OWNER'&&owned&&u.id==='player'}
});
const equipped=a=>{
 const item={type:'weapon',system:{equipped:true},actions:{contents:[{actionType:'mwak'}]}};
 a.items.contents.push(item);
};
const objects=[];
function token(id,x,disposition,actor,sceneId='scene'){
 const document={id,uuid:'Scene.'+sceneId+'.Token.'+id,disposition,
  parent:{id:sceneId}};
 const t={id,name:id,actor,document,
  getOccupiedCells(){return [{x,y:0}]},
  object:null};
 t.object=t;objects.push(t);return t;
}
const scene={id:'scene',grid:{units:'ft'}};
const grid={measurePath:([a,b])=>({distance:Math.abs(a.x-b.x)})};
let combat={combatants:[]};
const game={
 i18n:{lang:'en'},
 user,users:[user,gm],modules:new Map(),combat,
 settings:{get(_n,k){return settings.get(k)},
  register(_n,k,v){if(!settings.has(k))settings.set(k,v.default)}}
};
const mod={active:true,api:{
 scriptApprovals:{check(_actor,_item,call){return {approved:call._approved===true}}}
}};
game.modules.set(NS,mod);
const ctx={console,Promise,Date,Map,Set,WeakMap,WeakSet,Number,Object,
 game,Hooks:{on,once(name,fn){if(name==='ready')ready.push(fn);else on(name,fn)}},
 foundry:{applications:{api:{DialogV2:{wait:async()=>manualChoices.shift()??null}}}},
 canvas:{scene,grid,tokens:{placeables:objects}},pf1:{
  actionUse:{ActionUse},settings:{distance:{metric:false}}}};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(SOURCE,ctx,{filename:'ranged-melee.js'});
for(const fn of hooks.get('init')??[])fn();
for(const fn of ready)fn();
const API=mod.api.rangedMelee;
const f=actor('friend','med');
const enemy=actor('enemy','med');
const shooter=actor('shooter','med');
equipped(f);equipped(enemy);
const friendly=token('friend-token',10,1,f);
const target=token('target-token',5,-1,enemy);
const source=token('shooter-token',0,1,shooter);
game.combat.combatants=[
 {tokenId:'friend-token'},{tokenId:'target-token'},{tokenId:'shooter-token'}];
const weapon={name:'Longbow',uuid:shooter.uuid+'.Item.bow',documentName:'Item',
 actor:shooter};
const action={name:'Shoot',actionType:'rwak',hasAttack:true,item:weapon};
user.targets.add(target);
const begin=use=>{for(const fn of hooks.get('pf1CreateActionUse')??[])fn(use)};
const make=(count=1,actorDoc=shooter,itemDoc=weapon,actionDoc=action,origin=source)=>{
 const u=new ActionUse(actorDoc,itemDoc,actionDoc,origin,count);begin(u);return u;
};
function containsPenalty(parts,penalty){
 return parts.some(x=>{
  const text=String(x);
  return text.includes('('+penalty+')[Shooting into melee]')||
   text.includes(penalty+'[Shooting into melee]');
 });
}
function effectiveMeleePenalty(parts){
 return parts.reduce((total,x)=>{
  const text=String(x);
  if(!text.includes('[Shooting into melee'))return total;
  const parsed=Number(text.match(/\(?([+-]?\d+)\)?\[Shooting into melee/)?.[1]);
  return total+(Number.isFinite(parsed)?parsed:0);
 },0);
}
(async()=>{
 let u=make();
 assert.equal(u.shared.attackBonus.some(x=>String(x).includes('-4[Shooting into melee]')),true,
  'pre-roll common penalty is injected at pf1CreateActionUse (like range)');
 let result=await u.addAttacks();
 assert.equal(containsPenalty(result[0],-4),true,'engaged target gets -4 before roll');
 assert.equal(effectiveMeleePenalty(result[0]),-4);
 assert.equal(u.shared.attackBonus.length,1,'common penalty removed after roll');
 assert.equal(u.shared.attackBonus[0],'1[Point Blank Shot]','other shared bonuses preserved');
 assert.equal(u.shared.attacks[0].attackBonus,'0','attack instance restored after roll');
 assert.equal(API.lastDiagnostic().status,'engaged');
 assert.equal((await u.addAttacks())[0].some(p=>String(p).includes('Shooting into Melee')),false,
  'completed use does not receive the modifier twice');
 target.document.disposition=1;
 u=make();result=await u.addAttacks();
 assert.equal(containsPenalty(result[0],-4),false,'friendly target does not get penalty');
 target.document.disposition=-1;
 friendly.document.disposition=-1;
 u=make();result=await u.addAttacks();
 assert.equal(containsPenalty(result[0],-4),false,'no ally in melee');
 friendly.document.disposition=1;
 // All attacks of a verified SAME one-target full attack get separate parts.
 u=make(3);result=await u.addAttacks();
 assert.equal(result.length,3);
 assert.equal(result.every(parts=>containsPenalty(parts,-4)),true);
 assert.deepEqual(u.shared.attacks.map(a=>a.attackBonus),['0','-5','-10']);
 // Different native ActionUses are isolated, including concurrent actors.
 const otherShooter=actor('other-shooter','med');
 const otherSrc=token('other-shooter-token',-10,1,otherShooter);
 game.combat.combatants.push({tokenId:'other-shooter-token'});
 const otherWeapon={uuid:otherShooter.uuid+'.Item.crossbow',actor:otherShooter,documentName:'Item'};
 const otherAction={actionType:'rwak',hasAttack:true,item:otherWeapon};
 const a1=make(),a2=make(1,otherShooter,otherWeapon,otherAction,otherSrc);
 const results=await Promise.all([a1.addAttacks(),a2.addAttacks()]);
 assert.equal(containsPenalty(results[0][0],-4),true);
 assert.equal(containsPenalty(results[1][0],-4),true);
 // PF1 v11.11 real Actor system.traits.size shape observed in world:
 // {base:'med',value:4}, not the old string 'med'. Prepared value wins.
 const oldAllySize=f.system.traits.size;
 const oldTargetSize=enemy.system.traits.size;
 f.system.traits.size={base:'med',value:4};
 enemy.system.traits.size={base:'med',value:4};
 u=make();result=await u.addAttacks();
 assert.equal(effectiveMeleePenalty(result[0]),-4,
  'native PF1 object size must be resolved, not manual target size unknown');
 assert.equal(API.lastDiagnostic().status,'engaged');
 enemy.system.traits.size={base:'med',value:6};
 u=make();result=await u.addAttacks();
 assert.equal(effectiveMeleePenalty(result[0]),-2,
  'prepared native size value 6 is two categories larger');
 enemy.system.traits.size={base:'med',value:7};
 u=make();result=await u.addAttacks();
 assert.equal(effectiveMeleePenalty(result[0]),0,
  'prepared size change takes priority over base med');
 enemy.system.traits.size={base:'lg'};
 u=make();result=await u.addAttacks();
 assert.equal(effectiveMeleePenalty(result[0]),-4,
  'fallback to native base if prepared value is missing');
 enemy.system.traits.size={base:'unknown',value:'bad'};
 u=make();result=await u.addAttacks();
 assert.equal(API.lastDiagnostic().status,'manual',
  'unknown values still fail closed instead of assuming Medium');
 f.system.traits.size=oldAllySize;
 enemy.system.traits.size=oldTargetSize;
 // Size exemptions.
 enemy.system.traits.size='lg';u=make();result=await u.addAttacks();
 assert.equal(containsPenalty(result[0],-4),true,'one category larger still -4');
 enemy.system.traits.size='huge';u=make();result=await u.addAttacks();
 assert.equal(containsPenalty(result[0],-2),true,'two categories larger => -2');
 enemy.system.traits.size='grg';u=make();result=await u.addAttacks();
 assert.equal(result[0].some(p=>String(p).includes('Shooting into Melee')),false,
  'three categories larger => 0');
 enemy.system.traits.size='med';
 // 10 ft away from ally: no shooting into melee penalty even when threat
 // reaches 10 ft. The 10 ft size exception applies independently.
 friendly.getOccupiedCells=()=>[{x:15,y:0}];
 f.system.attributes.reach.total=15;
 enemy.system.attributes.reach.total=15;
 u=make();result=await u.addAttacks();
 assert.equal(result[0].some(p=>String(p).includes('Shooting into Melee')),false);
 friendly.getOccupiedCells=()=>[{x:10,y:0}];
 f.system.attributes.reach.total=5;enemy.system.attributes.reach.total=5;
 // Unknown reach, unarmed threat, neutral sides and missing targets fail closed.
 delete enemy.system.attributes.reach;
 delete f.system.attributes.reach;
 u=make();result=await u.addAttacks();
 assert.equal(result[0].some(p=>String(p).includes('Shooting into Melee')),false);
 assert.equal(API.lastDiagnostic().status,'manual');
 manualChoices.push(-2);
 u=make();result=await u.addAttacks();
 assert.equal(containsPenalty(result[0],-2),true,'explicit manual −2 before native roll');
 assert.equal(API.lastDiagnostic().status,'manual-choice');
 enemy.system.attributes.reach={total:5};
 f.system.attributes.reach={total:5};
 user.targets.clear();
 u=make();result=await u.addAttacks();
 assert.equal(API.lastDiagnostic().status,'manual');
 assert.equal(result[0].some(p=>String(p).includes('Shooting into Melee')),false);
 user.targets.add(target);
 // Explicit native attack-bonus dialog value wins.
 u=make();u.formData={'attack-bonus':'-4[Manual melee]'};
 await u.addAttacks();
 assert.equal(API.lastDiagnostic().status,'native-manual');
 // Automatic feat script runs in native PF1 toggle context without activation,
 // no hardcoding the feat name in PF1AE; grants only scoped current use.
 const preciseFeat={uuid:shooter.uuid+'.Item.feat',actor:shooter,
  documentName:'Item',scriptCalls:{contents:[]}};
 const call={id:'precise',category:'toggle',name:'PF1AE:rangedMelee:override',
  async execute(_arg,{rangedMelee}){
   scriptInvoked++;
   for(let i=0;i<rangedMelee.actionUse.shared.attacks.length;i++)
    rangedMelee.override({attackIndex:i,penalty:0,reason:'precise-shot'});
  }};
 preciseFeat.scriptCalls.contents=[call];shooter.items.contents.push(preciseFeat);
 u=make(2);result=await u.addAttacks();
 assert.equal(scriptInvoked,1);
 assert.equal(result.every(parts=>effectiveMeleePenalty(parts)===0),true,
  'index +4 corrections cancel the shared -4 for Precise Shot');
 assert.equal(result.every(parts=>parts.some(x=>String(x).includes('(+4)[Shooting into melee]'))),true);
 assert.equal(u.shared.attackBonus.length,1,'Precise Shot does not leave a shared modifier');
 assert.equal(u.shared.attacks.every((a,i)=>a.attackBonus===String(-5*i)),true);
 // Partial override, duplicate and ownership checks.
 shooter.items.contents.pop();
 u=make(2);
 assert.equal(API.prepareAttackOverride({actionUse:u,attackIndex:1,penalty:-2}),true);
 assert.throws(()=>API.prepareAttackOverride({actionUse:u,attackIndex:1,penalty:0}),/Duplicate/);
 result=await u.addAttacks();
 assert.equal(effectiveMeleePenalty(result[0]),-4);
 assert.equal(effectiveMeleePenalty(result[1]),-2,
  'partial override adjusts just the indexed attack while common -4 remains');
 assert.throws(()=>API.prepareAttackOverride({actionUse:u,attackIndex:0,penalty:0}),/completed/);
 u=make();assert.equal(API.prepareForCurrentUse({
  item:weapon,action,attackIndex:0,penalty:0}),true);
 result=await u.addAttacks();
 assert.equal(effectiveMeleePenalty(result[0]),0);
 // The common modifier added during use creation must be removed when
 // native user-entered bonuses take priority in the later action dialog.
 u=make();
 assert.equal(u.shared.attackBonus.length,2);
 u.formData={'attack-bonus':'-4[Manually entered]'};
 result=await u.addAttacks();
 assert.equal(effectiveMeleePenalty(result[0]),0);
 assert.equal(u.shared.attackBonus.length,1);
 // Target changes after the pre-roll hook: invalidate the early common
 // penalty; no stale penalty must leak into the new native roll.
 u=make();
 assert.equal(u.shared.attackBonus.length,2);
 target.document.disposition=1;
 result=await u.addAttacks();
 assert.equal(effectiveMeleePenalty(result[0]),0);
 assert.equal(u.shared.attackBonus.length,1);
 target.document.disposition=-1;
 // Coexists with range automation: that engine also uses shared.attackBonus,
 // and the cleanup must preserve its existing independently managed part.
 u=make();u.shared.attackBonus.push('-2[Range penalty]');
 result=await u.addAttacks();
 assert.equal(effectiveMeleePenalty(result[0]),-4);
 assert.equal(result[0].includes('-2[Range penalty]'),true);
 assert.equal(u.shared.attackBonus.includes('-2[Range penalty]'),true);
 const bad=make(1,actor('unowned','med',5,false),{
  uuid:'Actor.unowned.Item.bow',documentName:'Item',
  actor:null},action,source);
 assert.throws(()=>API.prepareAttackOverride({actionUse:bad,penalty:0}),/permitted/);
 // Mixed targets ambiguous and no blind -4.
 user.targets.add(friendly);
 u=make();result=await u.addAttacks();
 assert.equal(API.lastDiagnostic().status,'manual');
 assert.equal(result[0].some(p=>String(p).includes('Shooting into Melee')),false);
 user.targets.delete(friendly);
 // Synthetic metric scene with occupied cells uses 5ft=1.5m table conversion.
 scene.grid.units='m';
 grid.measurePath=([a,b])=>({distance:Math.abs(a.x-b.x)*0.3});
 u=make();result=await u.addAttacks();
 assert.equal(containsPenalty(result[0],-4),true);
 scene.grid.units='ft';grid.measurePath=([a,b])=>({distance:Math.abs(a.x-b.x)});
 // Foundry v13 ACTUAL TokenDocument API: a normal Token has no
 // getOccupiedCells(), but its document exposes grid offsets (i,j).
 const fLegacy=friendly.getOccupiedCells;
 const tLegacy=target.getOccupiedCells;
 const sLegacy=source.getOccupiedCells;
 friendly.getOccupiedCells=undefined;
 target.getOccupiedCells=undefined;
 source.getOccupiedCells=undefined;
 const centerBefore=grid.getCenterPoint;
 grid.getCenterPoint=({i,j})=>({x:j*5+2.5,y:i*5+2.5});
 friendly.document.getOccupiedGridSpaceOffsets=()=>[{i:0,j:2}];
 target.document.getOccupiedGridSpaceOffsets=()=>[{i:0,j:1}];
 source.document.getOccupiedGridSpaceOffsets=()=>[{i:0,j:0}];
 u=make();result=await u.addAttacks();
 assert.equal(effectiveMeleePenalty(result[0]),-4,
  'native v13 token grid offsets produce correct melee distance without getOccupiedCells');
 assert.equal(API.lastDiagnostic().status,'engaged');
 // If neither official nor compatibility geometry exists, surface
 // which ally could not be measured rather than guessing engagement.
 target.document.getOccupiedGridSpaceOffsets=()=>[];
 u=make();result=await u.addAttacks();
 assert.equal(API.lastDiagnostic().status,'manual');
 assert.equal(API.lastDiagnostic().uncertain?.[0]?.reason,
  'grid cells or path unavailable');
 target.document.getOccupiedGridSpaceOffsets=()=>[{i:0,j:1}];
 delete friendly.document.getOccupiedGridSpaceOffsets;
 delete target.document.getOccupiedGridSpaceOffsets;
 delete source.document.getOccupiedGridSpaceOffsets;
 friendly.getOccupiedCells=fLegacy;
 target.getOccupiedCells=tLegacy;
 source.getOccupiedCells=sLegacy;
 if(centerBefore===undefined)delete grid.getCenterPoint;
 else grid.getCenterPoint=centerBefore;
 // Native PF1 11.11: reach appears in getRollData().range.melee,
 // not on actor.system.attributes.reach. All three allies in the
 // reported world had missing legacy reach fields.
 const r1=f.system.attributes.reach;
 const r2=enemy.system.attributes.reach;
 delete f.system.attributes.reach;
 delete enemy.system.attributes.reach;
 f.getRollData=()=>({range:{melee:5,reach:10}});
 enemy.getRollData=()=>({range:{melee:5,reach:10}});
 u=make();result=await u.addAttacks();
 assert.equal(effectiveMeleePenalty(result[0]),-4,
  'native PF1 prepared melee reach works without legacy reach field');
 assert.equal(API.lastDiagnostic().status,'engaged');
 // Reached range can be larger than natural melee range; do not confuse
 // range.reach with range.melee for ordinary melee threats.
 f.getRollData=()=>({range:{melee:1,reach:15}});
 enemy.getRollData=()=>({range:{melee:1,reach:15}});
 u=make();result=await u.addAttacks();
 assert.equal(effectiveMeleePenalty(result[0]),0);
 assert.equal(API.lastDiagnostic().status,'not-engaged');
 f.getRollData=()=>({range:{melee:5}});
 enemy.getRollData=()=>({range:{melee:5}});
 u=make();result=await u.addAttacks();
 assert.equal(effectiveMeleePenalty(result[0]),-4);
 // Missing prepared and legacy reach still fails closed with details.
 f.getRollData=()=>({range:{}});
 enemy.getRollData=()=>({range:{}});
 u=make();result=await u.addAttacks();
 assert.equal(API.lastDiagnostic().status,'manual');
 assert.equal(API.lastDiagnostic().uncertain?.[0]?.reason,
  'melee threat or reach unknown');
 delete f.getRollData;
 delete enemy.getRollData;
 f.system.attributes.reach=r1;
 enemy.system.attributes.reach=r2;
 // Language is taken from the active Foundry client, not the world.
 // The exact same labels must work for the early shared penalty and
 // the later per-index corrections for Precise Shot.
 game.i18n.lang='fr';
 u=make();result=await u.addAttacks();
 assert.equal(result[0].some(v=>String(v).includes('-4[Tir dans le tas]')),true);
 assert.equal(result[0].some(v=>String(v).includes('[Shooting into melee]')),false);
 u=make(1);
 API.prepareAttackOverride({actionUse:u,attackIndex:0,penalty:0});
 result=await u.addAttacks();
 assert.equal(result[0].some(v=>String(v).includes('(+4)[Tir dans le tas]')),true);
 game.i18n.lang='fr-FR';
 u=make();result=await u.addAttacks();
 assert.equal(result[0].some(v=>String(v).includes('-4[Tir dans le tas]')),true);
 game.i18n.lang='en';
 u=make();result=await u.addAttacks();
 assert.equal(result[0].some(v=>String(v).includes('-4[Shooting into melee]')),true);
 game.i18n.lang='de';
 u=make();result=await u.addAttacks();
 assert.equal(result[0].some(v=>String(v).includes('-4[Shooting into melee]')),true);
 game.i18n.lang='en';
 // Melee attacks: never penalize.
 const melee={...action,actionType:'mwak'};
 u=make(1,shooter,weapon,melee);
 result=await u.addAttacks();
 assert.equal(result[0].some(p=>String(p).includes('Shooting into Melee')),false);
 console.log('PASS ranged-melee: native pre-roll -4/-2/0, no-false-engagement,');
 console.log(' full attacks, concurrent uses, exact per-index overrides, scripts,');
 console.log(' uncertain targets, metric and imperial, melee immunity, native manual.');
})().catch(error=>{console.error(error);process.exitCode=1});
