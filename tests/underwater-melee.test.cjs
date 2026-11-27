'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const handlers=new Map(),ready=[],init=[];
const mod={active:true,api:{}},water={active:true,api:{waterAutomation:{getState:d=>({underwater:d.elevation<0})}}};
const settings=new Map([['genericEnabled',true],['autoUnderwaterMelee',true],['nativeDamageMultiplier',true]]);
const game={modules:new Map([['pf1-automation-engine',mod],['pf1-skull-and-shackles',water]]),
 settings:{get(_n,k){return settings.get(k)},register(_n,k,o){settings.set(k,o.default)}},i18n:{lang:'fr'}};
const actor={uuid:'Actor.swimmer',statuses:new Set(),effects:{contents:[]}};
const token={id:'t',uuid:'Scene.x.Token.t',parent:{id:'x'},elevation:0,flags:{world:{underwater:true}}};
const action={actionType:'mwak',hasAttack:true,actor,damage:{parts:[{types:new Set(['slashing'])}]}};
// Reproduce Foundry v13's immutable static terms, not permissive stubs.
let operatorEvaluations=0,numericEvaluations=0,preEvaluatedNumeric=true;
class Op{
 constructor(d){Object.assign(this,d);this._evaluated=true}
 evaluate(){operatorEvaluations++;throw Error("The OperatorTerm has already been evaluated and is now immutable")}
}
class Num{
 constructor(d){Object.assign(this,d);this._evaluated=preEvaluatedNumeric}
 evaluate(){numericEvaluations++;if(this._evaluated)throw Error("The NumericTerm has already been evaluated and is now immutable");this._evaluated=true;return this}
}
class DamageRoll{
 constructor(total,types,kind='normal',dice=[]){this.total=total;this.options={damageType:types,type:kind};this.dice=dice;this.terms=[{number:total,dice}];this.formula='1d8 + 4'}
 async getTooltip(){return '<native-tooltip>'}
 toAnchor(){const attrs=new Map([['data-tooltip',this.formula],['data-roll','serialized-native-roll']]);return {getAttribute:k=>attrs.get(k)??null,setAttribute:(k,v)=>attrs.set(k,v)}}
 static fromTerms(terms,options){
  for(const term of terms)if(term instanceof Op||term instanceof Num)assert.equal(term._evaluated,true,"adjustment must already be evaluated");
  const r=new DamageRoll(0,options.damageType,options.type);
  r.options=options;r.terms=terms;r.dice=terms.flatMap(t=>t.dice??[]);
  let total=0,sign=1;for(const t of terms){if(t.operator)sign=t.operator==='-'?-1:1;else total+=sign*t.number}
  r.total=total;r.formula=terms.map(t=>t.operator??String(t.number)+(t.options?.flavor?"["+t.options.flavor+"]":"")).join(" ");return r;
 }
}
const dice=[{number:1,faces:8,results:[{result:5,active:true}]}];
const roll=(n,type='slashing',kind='normal')=>new DamageRoll(n,[type],kind,dice);
const makeAttack=(normal,critical=[])=>({damage:{rolls:normal,total:normal.reduce((s,r)=>s+r.total,0)},
 critDamage:{rolls:critical,total:[...normal,...critical].reduce((s,r)=>s+r.total,0)}});
function base(form,attacks=[makeAttack([roll(12)])]){
 return {action,actor,token,shared:{attackBonus:[],rollData:{},chatAttacks:[]},
  async createAttackDialog(){return form},
  async generateChatAttacks(){this.shared.chatAttacks=attacks;return true}};
}
const ctx={game,console,pf1:{dice:{DamageRoll}},foundry:{dice:{terms:{OperatorTerm:Op,NumericTerm:Num}}},
 Hooks:{once(n,fn){(n==='init'?init:ready).push(fn)},on(n,fn){handlers.set(n,fn)}},Object,Array,Set,Map,WeakSet,WeakMap,Math,String,Number,JSON};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../scripts/underwater-melee.js'),'utf8'),ctx);
for(const f of init)f();for(const f of ready)f();
const FIELD='pf1ae-damage-multiplier',OLD='global-bonus_damage-multiplier',api=mod.api.underwaterMelee;
async function execute(use,{skip=false}={}){
 handlers.get('pf1CreateActionUse')(use);
 const form=skip?{}:await use.createAttackDialog();
 if(form===null)return;
 use.formData=form;
 await use.generateChatAttacks();return use.shared.chatAttacks[0];
}
(async()=>{
 assert.ok(api);assert.equal(handlers.has('pf1PreDamageRoll'),false);
 let use=base({[FIELD]:'2',[OLD]:'3'}),a=await execute(use);
 assert.equal(a.damage.total,24,'all evaluated bonuses included');assert.equal(a.damage.rolls[0].total,24);
 assert.equal(a.damage.rolls[0].dice[0].results[0].result,5);assert.equal(Object.hasOwn(use.formData,OLD),false);
 const scaled=a.damage.rolls[0],meta=scaled.options.pf1aeDamageMultiplierDisplay;
 assert.equal(meta.formula,'1d8 + 4');assert.equal(meta.factor,2);assert.equal(meta.originalTotal,12);
 assert.equal(scaled.toAnchor().getAttribute('data-tooltip'),'(1d8 + 4) × 2 = 24');
 assert.equal(scaled.toAnchor().getAttribute('data-roll'),'serialized-native-roll');
 let tooltipRemoved=0,appended=null,expectedFlavor=scaled.terms.at(-1).options.flavor;
 const row={querySelector:q=>q==='.part-flavor'?{textContent:expectedFlavor}:null,remove(){tooltipRemoved++}};
 const wrapper={querySelector:q=>q==='section.tooltip-part:last-child'?row:null,append(s){appended=s}};
 ctx.document={createElement(tag){
  if(tag==='template')return {innerHTML:'',content:{querySelector:q=>q==='.dice-tooltip .wrapper'?wrapper:null}};
  return {tag,children:[],append(x){this.children.push(x)}};
 }};
 await scaled.getTooltip();assert.equal(tooltipRemoved,1);assert.equal(appended.children[0].textContent,'(1d8 + 4) × 2 = 24');
 expectedFlavor='Other bonus';tooltipRemoved=0;appended=null;
 assert.equal(await scaled.getTooltip(),'<native-tooltip>');assert.equal(tooltipRemoved,0);assert.equal(appended,null);
 expectedFlavor=scaled.terms.at(-1).options.flavor;
 const restored=DamageRoll.fromTerms(scaled.terms,JSON.parse(JSON.stringify(scaled.options)));
 assert.equal(restored.toAnchor().getAttribute('data-tooltip'),'(1d8 + 4) × 2 = 24');
 assert.equal(restored.total,24);
 restored.options.pf1aeDamageMultiplierDisplay.formula='<img src=x>';
 assert.equal(restored.toAnchor().getAttribute('data-tooltip'),'(&lt;img src=x&gt;) × 2 = 24');
 restored.options.pf1aeDamageMultiplierDisplay.formula='1d8 + 4';
 assert.equal(operatorEvaluations,0);assert.equal(numericEvaluations,0);
 preEvaluatedNumeric=false;
 const other=await execute(base({[FIELD]:'2'}));assert.equal(other.damage.total,24);
 assert.equal(operatorEvaluations,0);assert.equal(numericEvaluations,1);
 preEvaluatedNumeric=true;
 await use.generateChatAttacks();assert.equal(a.damage.total,24,'no duplicate scaling');
 // Neutral choices must not reach PF1's form or touch a single native
 // roll, even when the native total uses a special damage correction.
 const fromTerms=DamageRoll.fromTerms;
 DamageRoll.fromTerms=()=>{throw Error("Neutral action must not reconstruct rolls")};
 for(const form of [{},{[FIELD]:''},{[FIELD]:null},{[FIELD]:'abc'},{[FIELD]:false},
                    {[FIELD]:'1'},{[FIELD]:1},{[FIELD]:'1,0'}]){
  const native=makeAttack([roll(12)],[roll(7,'slashing','crit')]);
  const normal=native.damage.rolls,critical=native.critDamage.rolls;
  const terms=normal[0].terms;
  use=base(form,[native]);
  a=await execute(use);
  assert.equal(Object.hasOwn(use.formData,FIELD),false,'neutral field absent');
  assert.equal(a,native);assert.equal(a.damage.rolls,normal);
  assert.equal(a.critDamage.rolls,critical);assert.equal(a.damage.rolls[0].terms,terms);
  assert.equal(a.damage.total,12);assert.equal(a.critDamage.total,19);
  assert.equal(Object.hasOwn(a.damage.rolls[0].options,'pf1aeDamageMultiplierDisplay'),false);
  assert.equal(a.damage.rolls[0].toAnchor().getAttribute('data-tooltip'),'1d8 + 4');
  assert.equal(api.lastDiagnostic().status,'native-unmodified');
  assert.equal((await api.multiply(use,[native])).scaled,0,'no retained scaling state');
 }
 const minimum=makeAttack([roll(-2)]);
 minimum.damage.total=1;minimum.damage.nonlethal=true;
 use=base({[FIELD]:'1'},[minimum]);a=await execute(use);
 assert.equal(a,minimum);assert.equal(a.damage.total,1);
 assert.equal(a.damage.rolls[0].total,-2);assert.equal(a.damage.nonlethal,true);
 a=await execute(base({[FIELD]:'3'}),{skip:true});assert.equal(a.damage.total,12);
 DamageRoll.fromTerms=fromTerms;
 a=await execute(base({[FIELD]:'0'}));assert.equal(a.damage.total,0,'explicit zero only');
 a=await execute(base({[FIELD]:'0,5'},[makeAttack([roll(3),roll(3,'fire')],[roll(3,'slashing','crit')])]));
 assert.equal(a.damage.total,3,'floor whole damage, not each component');
 assert.equal(a.damage.rolls.reduce((s,r)=>s+r.total,0),3);
 assert.match(a.damage.rolls[0].toAnchor().getAttribute('data-tooltip'),/× 0\.5 = 1\.5 — Arrondi global \(répartition\) : 1/);
 assert.match(a.damage.rolls[1].toAnchor().getAttribute('data-tooltip'),/× 0\.5 = 1\.5 — Arrondi global \(répartition\) : 2/);
 assert.equal(a.critDamage.total,4,'critical includes normal damage and rounds once');
 assert.equal(a.critDamage.rolls[0].options.type,'crit');
 a=await execute(base({[FIELD]:'2'},[makeAttack([roll(12)],[roll(11,'slashing','crit')])]));
 assert.equal(a.damage.total,24);assert.equal(a.critDamage.total,46);
 token.elevation=-1;
 use=base({[FIELD]:'1'},[makeAttack([roll(9),roll(5,'electric')])]);a=await execute(use);
 assert.equal(use.shared.attackBonus.length,1);assert.match(use.shared.attackBonus[0],/^-2\[/);
 assert.equal(a.damage.total,9);assert.equal(a.damage.rolls[0].total,4);assert.equal(a.damage.rolls[1].total,5);
 assert.equal(Object.hasOwn(use.formData,FIELD),false,'neutral manual field absent even underwater');
 a=await execute(base({[FIELD]:''},[makeAttack([roll(9),roll(5,'electric')])]));assert.equal(a.damage.total,9,'blank preserves independent aquatic rules');
 a=await execute(base({[FIELD]:'2'},[makeAttack([roll(9),roll(5,'fire')])]));
 assert.equal(a.damage.total,19);assert.equal(a.damage.rolls[0].total,9);assert.equal(a.damage.rolls[1].total,10);
 actor.statuses.add('freedomOfMovement');use=base({});a=await execute(use);assert.equal(a.damage.total,12);assert.equal(use.shared.attackBonus.length,0);actor.statuses.clear();
 action.damage.parts[0].types=new Set(['piercing']);use=base({});a=await execute(use);assert.equal(a.damage.total,12);assert.equal(use.shared.attackBonus.length,0);
 action.damage.parts[0].types=new Set(['slashing']);token.elevation=0;
 const cancelled=base(null);await execute(cancelled);assert.equal(cancelled.shared.chatAttacks.length,0);
 const left=base({[FIELD]:'2'}),right=base({[FIELD]:'3'});
 const both=await Promise.all([execute(left),execute(right)]);assert.equal(both[0].damage.total,24);assert.equal(both[1].damage.total,36);
 class AttackDialog{constructor(use){this.actionUse=use}}
 const uiUse=base({[FIELD]:0,[OLD]:3}),dialog=new AttackDialog(uiUse);
 let installed,removed=0;
 const old={value:'3',disabled:false,closest:()=>({remove(){removed++}})};
 const root={querySelector(q){if(q.includes(FIELD))return null;if(q.includes(OLD))return old;
  if(q.includes('damage-bonus'))return {closest:()=>({after:g=>installed=g})};return null}};
 ctx.pf1.applications={AttackDialog};
 ctx.document={createElement(tag){return {tag,children:[],listeners:{},appendChild(x){this.children.push(x)},
  append(...xs){this.children.push(...xs)},addEventListener(n,fn){this.listeners[n]=fn}}}};
 handlers.get('renderApplication')(dialog,[root]);assert.equal(removed,1);
 let input=installed.children[1].children[0];assert.equal(input.value,'');assert.equal(input.placeholder,'1');
 input.value='2';input.listeners.input();
 handlers.get('renderApplication')(dialog,[root]);input=installed.children[1].children[0];assert.equal(input.value,'2');
 input.value='';input.listeners.input();
 a=await execute(uiUse);assert.equal(a.damage.total,12,'blank UI overrides coerced numeric zero');assert.equal(Object.hasOwn(uiUse.formData,FIELD),false);
 settings.set('nativeDamageMultiplier',false);
 use=base({[FIELD]:3,[OLD]:2});a=await execute(use);assert.equal(a.damage.total,12);assert.equal(use.formData[OLD],2,'disabled feature does not remove other module data');
 settings.set('nativeDamageMultiplier',true);
 const original=DamageRoll.fromTerms;DamageRoll.fromTerms=()=>new DamageRoll(0,['slashing']);
 use=base({[FIELD]:2});await assert.rejects(execute(use),/reconstruction/);assert.equal(use.shared.chatAttacks[0].damage.total,12);
 assert.equal(api.lastDiagnostic().status,"damage-multiplier-error");assert.match(api.lastDiagnostic().error,/reconstruction/);
 DamageRoll.fromTerms=original;
 console.log('PASS native damage multiplier: form ordering, default one, rerenders, complete bonus totals, typed aggregate rounding, critical, underwater, no rerolls');
})().catch(error=>{console.error(error);process.exitCode=1;});
