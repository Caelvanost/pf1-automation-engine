'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const handlers=new Map(),ready=[],init=[];
const mod={active:true,api:{}},water={active:true,api:{waterAutomation:{getState(d){
 return {underwater:d.elevation<0};
}}}};
const settings=new Map([['genericEnabled',true],
 ['autoUnderwaterMelee',true],['nativeDamageMultiplier',true]]);
const game={modules:new Map([['pf1-automation-engine',mod],
 ['pf1-skull-and-shackles',water]]),
 settings:{get(_n,k){return settings.get(k)},register(_n,k,o){settings.set(k,o.default)}},
 i18n:{lang:'fr'}};
const actor={uuid:'Actor.swimmer',statuses:new Set(),effects:{contents:[]}};
const token={id:'t',uuid:'Scene.x.Token.t',parent:{id:'x'},
 x:0,y:0,elevation:-1,flags:{world:{underwater:true}}};
const action={actionType:'mwak',hasAttack:true,actor,
 damage:{parts:[{types:['slashing'],formula:'1d8+4'}]}};
const base=()=>({action,actor,token,shared:{attackBonus:[],rollData:{}},
 formData:{'pf1ae-damage-multiplier':'1'},
 async createAttackDialog(){return {ok:true}}});
const ctx={game,console,Hooks:{once(n,fn){(n==='init'?init:ready).push(fn)},
 on(n,fn){handlers.set(n,fn)}},Object,Array,Set,Map,WeakSet,WeakMap,Math,String,Number};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../scripts/underwater-melee.js'),'utf8'),ctx);
for(const f of init)f();for(const f of ready)f();
assert.ok(mod.api.underwaterMelee,'service is registered');
function open(use){
 handlers.get('pf1CreateActionUse')(use);
 return use.createAttackDialog();
}
function damage(parts){
 handlers.get('pf1PreDamageRoll')(action,{},parts);
 return parts;
}
(async()=>{
 let use=base();await open(use);
 assert.equal(use.shared.attackBonus.length,1);
 assert.match(use.shared.attackBonus[0],/^-2\[/);
 handlers.get('pf1CreateActionUse')(use);
 assert.equal(use.shared.attackBonus.length,1,'idempotent attack penalty');
 let parts=[{base:'1d8',extra:['4'],damageType:{values:['slashing']},type:'normal'}];
 damage(parts);
 assert.equal(parts[0].base,'floor((((1d8)) + ((4))) * 0.5)'.replace('((1d8))','(1d8)').replace('((4))','(4)'),
  'weapon dice and extra bonus halved together and rounded down');
 assert.equal(parts[0].extra.length,0,'all extras are merged into same half-damage roll');
 damage(parts);
 assert.equal((parts[0].base.match(/floor\(/g)||[]).length,1,'same part list processed once');
 // Piercing attack unaffected.
 const pierce={...action,damage:{parts:[{types:['piercing']}]}};
 const pUse={...base(),action:pierce};
 await open(pUse);
 assert.equal(pUse.shared.attackBonus.length,0);
 // No water: no underwater penalty, but user-requested x2 still applies.
 token.elevation=0;
 const user=base();user.formData['pf1ae-damage-multiplier']='2';
 await open(user);assert.equal(user.shared.attackBonus.length,0);
 parts=[{base:'1d6',extra:['3'],damageType:{values:['slashing']},type:'normal'}];
 damage(parts);assert.match(parts[0].base,/\* 2\)/);
 // User x2 and water x0.5 cancel to x1.
 token.elevation=-1;
 const cancel=base();cancel.formData['pf1ae-damage-multiplier']='2';
 await open(cancel);
 parts=[{base:'1d6',extra:['3'],damageType:{values:['slashing']},type:'normal'}];
 damage(parts);assert.equal(parts[0].base,'1d6');
 // Freedom of movement exempts melee penalties.
 actor.statuses.add('freedomOfMovement');
 const freedom=base();await open(freedom);
 assert.equal(freedom.shared.attackBonus.length,0);
 actor.statuses.clear();
 // Mixed slashing + piercing -> no automatic guess.
 action.damage.parts[0].types=['slashing','piercing'];
 const mixed=base();await open(mixed);
 assert.equal(mixed.shared.attackBonus.length,0);
 action.damage.parts[0].types=['slashing'];
 // Nonphysical energy components are excluded from underwater halving.
 const splash=base();await open(splash);
 parts=[{base:'1d8',extra:['4'],damageType:{values:['slashing']},type:'normal'},
 {base:'1d6',extra:[],damageType:{values:['fire']},type:'nonCrit'}];
 damage(parts);
 assert.match(parts[0].base,/\* 0.5\)/);
 assert.equal(parts[1].base,'1d6');
 // Native PF1 AttackDialog: own control replaces Roll Bonuses' field,
 // leaving its other conditional bonuses operational.
 class AttackDialog{}
 const nativeDialog=new AttackDialog();
 let removed=0,installed=null;
 const oldInput={value:'3',disabled:false,
  closest:()=>({remove(){removed++;}})};
 const anchorGroup={after(group){installed=group;}};
 const root={querySelector(selector){
  if(selector.includes('pf1ae-damage-multiplier'))return null;
  if(selector.includes('global-bonus_damage-multiplier'))return oldInput;
  if(selector.includes('damage-bonus'))return {closest:()=>anchorGroup};
  return null;
 }};
 const oldPf1=ctx.pf1,oldDocument=ctx.document;
 ctx.pf1={applications:{AttackDialog}};
 ctx.document={createElement(tag){
  return {tagName:tag,children:[],appendChild(x){this.children.push(x)},
   append(...xs){this.children.push(...xs)}};
 }};
 handlers.get('renderApplication')(nativeDialog,[root]);
 assert.equal(removed,1);
 assert.equal(oldInput.disabled,true);
 assert.ok(installed,'our multiplier control inserted next to damage bonus');
 assert.equal(installed.children[1].children[0].name,'pf1ae-damage-multiplier');
 assert.equal(installed.children[1].children[0].value,'1');
 ctx.pf1=oldPf1;ctx.document=oldDocument;
 const rollback=base();rollback.formData['global-bonus_damage-multiplier']='3';
 await open(rollback);
 assert.equal(Object.hasOwn(rollback.formData,'global-bonus_damage-multiplier'),false,
  'legacy Roll Bonuses multiplier value removed to avoid stacking');
 // Inactive setting completely removes rule.
 settings.set('autoUnderwaterMelee',false);
 const disabled=base();await open(disabled);
 assert.equal(disabled.shared.attackBonus.length,0);
 assert.equal(mod.api.underwaterMelee.preview(disabled)?.penalty,-2,
  'diagnostic can still inspect a rule while disabled');
 console.log('PASS underwater melee: -2, half-damage native formula, x2, piercing, freedom, energy and idempotence');
})().catch(error=>{console.error(error);process.exitCode=1;});
