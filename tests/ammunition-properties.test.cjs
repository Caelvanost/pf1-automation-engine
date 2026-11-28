'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ns='pf1-automation-engine',mod={active:true,api:{}},rb={active:false},hooks=new Map(),settings=new Map([['genericEnabled',true]]);
const game={release:{generation:13},system:{id:'pf1',version:'11.11'},i18n:{lang:'fr'},user:{isGM:true},modules:new Map([[ns,mod],['ckl-roll-bonuses',rb]]),settings:{register(_n,k,o){settings.set(k,o.default)},get(_n,k){return settings.get(k)}}};
const ctx={game,console,Hooks:{once:(n,fn)=>hooks.set(n,fn),on:(n,fn)=>hooks.set(n,fn)}};
ctx.globalThis=ctx;vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../scripts/ammunition-properties.js'),'utf8'),ctx);
hooks.get('init')();hooks.get('ready')();
const api=mod.api.ammunition,actor={uuid:'Actor.a'};
const ammo=(enh=0,mw=false)=>({id:'m',uuid:'Actor.a.Item.m',actor,type:'ammo',isOwner:true,system:{subType:'arrow',masterwork:mw,flags:{dictionary:{Enhancement:String(enh)},boolean:[]}},flags:{},getFlag(n,k){return this.flags[n]?.[k]},async setFlag(n,k,v){(this.flags[n]??={})[k]=v}});
const native={"attack.normal":["2[native]"],"damage.normal":[["1d6",["piercing"],false]]};
function use(launcher,projectile,masterwork=false){
 const entry={hasAmmo:true,ammo:{id:projectile.id,document:projectile}};
 const item={type:'weapon',actor,system:{enh:launcher,masterwork}};
 return {actor,item,action:{actionType:'rwak',enhancementBonus:launcher,ammo:{type:'arrow'},damage:{parts:[{types:new Set(['piercing'])}]}},shared:{attacks:[entry]},_getConditionalParts(){return native}};
}
const run=(launcher,projectile,masterwork=false)=>{
 const u=use(launcher,projectile,masterwork);hooks.get('pf1CreateActionUse')(u);
 return u._getConditionalParts(u.shared.attacks[0],{index:0});
};
assert.equal(api.previewBonus({launcherEnh:1,launcherMasterwork:true,ammoEnh:3,ammoMasterwork:true}).damage,2);
assert.equal(api.previewBonus({launcherEnh:0,launcherMasterwork:true,ammoEnh:3,ammoMasterwork:true}).attack,2);
assert.equal(api.previewBonus({launcherEnh:0,launcherMasterwork:false,ammoEnh:0,ammoMasterwork:true}).attack,1);
assert.equal(run(3,ammo(1)),native);
assert.equal(run(2,ammo(2)),native);
let result=run(1,ammo(3));
assert.equal(result['attack.normal'][1],'2[Munition PF1AE]');
assert.equal(result['damage.normal'][1][0],'2[Munition PF1AE]');
assert.equal(result['damage.normal'][1][1][0],'piercing');
assert.equal(native['damage.normal'].length,1);
assert.equal(run(0,ammo(3),true)['attack.normal'][1],'2[Munition PF1AE]');
assert.equal(run(0,ammo(0,true))['attack.normal'][1],'1[Munition PF1AE]');
assert.equal(run(0,ammo(0,true))['damage.normal'].length,1);
rb.active=true;assert.equal(run(0,ammo(3)),native);rb.active=false;
settings.set('ammunitionBonuses',false);assert.equal(run(0,ammo(3)),native);settings.set('ammunitionBonuses',true);
const legacy=ammo();delete legacy.system.flags.dictionary.Enhancement;
legacy.flags['ckl-roll-bonuses']={'ammo-enhancement':'3'};
assert.equal(api.inspect(legacy).profile.enhancement,3);
legacy.flags['ckl-roll-bonuses']['ammo-enhancement-stacks']='2';
assert.equal(api.inspect(legacy).supported,false);assert.equal(run(0,legacy),native);
delete legacy.flags['ckl-roll-bonuses']['ammo-enhancement-stacks'];
legacy.flags['ckl-roll-bonuses']['ammo-enhancement']='@cl';
assert.equal(api.inspect(legacy).supported,false);
const bad=ammo(3);bad.uuid='Actor.other.Item.m';assert.equal(run(0,bad),native);
const unknown=use(0,ammo(3));unknown.action.damage.parts=[];hooks.get('pf1CreateActionUse')(unknown);
assert.equal(unknown._getConditionalParts(unknown.shared.attacks[0],{index:0}),native);
// Regression: ApplicationV2 may expose document, window.content and a
// navigation element with the same data-tab as the real Details pane.
class SheetNode{
 constructor(tag='div',doc=null){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.listeners={};this.parent=null;}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
 prepend(node){node.parent=this;this.children.unshift(node);}
 addEventListener(name,fn){this.listeners[name]=fn;}
 matches(selector){
  if(selector==='a,button,[role="tab"]')return this.tagName==='a'||this.tagName==='button';
  if(selector==='nav')return this.tagName==='nav';
  if(selector==='[data-pf1ae-ammunition]')return !!this.dataset.pf1aeAmmunition;
  if(selector==='.tab.details[data-tab="details"]'||selector==='.tab[data-tab="details"]'||selector==='.tab.details')
   return this.className==='tab details';
  if(selector==='section[data-tab="details"]')return this.tagName==='section'&&this.dataset.tab==='details';
  if(selector.startsWith('div[data-tab="details"]'))return this.tagName==='div'&&this.dataset.tab==='details';
  return false;
 }
 querySelector(selector){
  for(const child of this.children){if(child.matches(selector))return child;const found=child.querySelector(selector);if(found)return found;}
  return null;
 }
 closest(selector){for(let node=this;node;node=node.parent)if(node.matches(selector))return node;return null;}
}
const document={createElement(tag){return new SheetNode(tag,this)}};
const root=document.createElement('form'),nav=document.createElement('nav'),tab=document.createElement('a'),details=document.createElement('section');
tab.dataset.tab='details';details.dataset.tab='details';details.className='tab details';nav.append(tab);root.append(nav,details);
const loot=ammo(0);loot.type='loot';loot.subType='ammo';loot.system.subType='arrow';
assert.equal(api.inspect(loot).supported,true,'native loot document subtype getter');
const sheet={document:loot,window:{content:root},isEditable:true};
hooks.get('renderApplicationV2')(sheet,nav);
let box=details.querySelector('[data-pf1ae-ammunition]');
assert.ok(box,'panel appears in Details even when hook provides navigation part');
assert.equal(nav.querySelector('[data-pf1ae-ammunition]'),null);
assert.equal(api.sheetDiagnostic().status,'rendered');
assert.equal(api.sheetDiagnostic().editable,true);
assert.equal(box.children.filter(x=>x.className==='form-group').length,8);
hooks.get('renderLootSheetPF')(sheet,root);
assert.equal(details.children.filter(x=>x.dataset.pf1aeAmmunition).length,1,'no duplicate panel');
assert.equal(api.sheetDiagnostic().status,'already-rendered');
const root2=document.createElement('form'),details2=document.createElement('section');
details2.dataset.tab='details';root2.append(details2);
rb.active=true;
hooks.get('renderApplicationV2')({item:loot,element:root2,isEditable:true},root2);
assert.equal(api.sheetDiagnostic().editable,false);
assert.ok(details2.querySelector('[data-pf1ae-ammunition]'),'visible while Roll Bonuses active');
rb.active=false;
const other=ammo();other.type='loot';other.system.subType='gear';
const root3=document.createElement('form'),details3=document.createElement('section');details3.dataset.tab='details';root3.append(details3);
hooks.get('renderApplicationV2')({item:other,element:root3,isEditable:true},root3);
assert.equal(details3.querySelector('[data-pf1ae-ammunition]'),null,'ordinary loot unchanged');
hooks.get('renderApplicationV2')({document:loot,element:document.createElement('form'),isEditable:true},null);
assert.equal(api.sheetDiagnostic().status,'details-not-found');
(async()=>{
 const p=ammo(0);
 await api.save(p,{schema:1,enhancement:3,masterwork:false,magic:false,material:'alchemicalSilver',alignments:{good:true,evil:false,lawful:false,chaotic:false}});
 const profile=api.inspect(p).profile;assert.equal(profile.enhancement,3);assert.equal(profile.masterwork,true);assert.equal(profile.magic,true);
 assert.equal(profile.material,'alchemicalSilver');assert.equal(run(1,p)['damage.normal'][1][0],'2[Munition PF1AE]');
 rb.active=true;await assert.rejects(api.save(p,profile));rb.active=false;
 game.user={isGM:false};p.isOwner=false;await assert.rejects(api.save(p,profile));
 console.log('PASS ammunition properties: legacy inspection, persistence, native conditional parts, enhancement nonstacking, masterwork and conflict');
})().catch(e=>{console.error(e);process.exitCode=1;});
