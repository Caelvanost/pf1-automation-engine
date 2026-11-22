'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../scripts/weapon-properties-ui.js'),'utf8');
const fr=JSON.parse(fs.readFileSync(path.join(__dirname,'../lang/fr.json'),'utf8'));
const en=JSON.parse(fs.readFileSync(path.join(__dirname,'../lang/en.json'),'utf8'));
class Node{
 constructor(tag='div'){this.tagName=tag;this.nodeType=1;this.childNodes=[];this.className='';
  this.textContent='';this.disabled=false;this.checked=false;this.name='';this.ownerDocument=null;
  this.isConnected=true;this.parent=null;}
 appendChild(node){node.parent=this;this.childNodes.push(node);return node;}
 remove(){this.parent?.childNodes.splice(this.parent.childNodes.indexOf(this),1);}
 closest(selector){if(selector==='label')return this.parent?.tagName==='label'?this.parent:null;return null;}
 querySelector(selector){
  const match=x=>selector==='input[type="checkbox"][name="system.properties.imp"]'?
   x.tagName==='input'&&x.type==='checkbox'&&x.name==='system.properties.imp':
   selector==='.pf1ae-improvised-label'?x.className==='pf1ae-improvised-label':
   selector==='.pf1ae-improvised-hint'?x.className==='pf1ae-improvised-hint':
   selector==='.pf1ae-weapon-improvised'?x.className.includes('pf1ae-weapon-improvised'):
   selector==='.weapon-properties.form-group.stacked'?x.className.includes('weapon-properties'):
   selector==='.weapon-properties'?x.className.includes('weapon-properties'):false;
  const walk=n=>{for(const x of n.childNodes){if(x.nodeType!==1)continue;if(match(x))return x;const z=walk(x);if(z)return z;}return null;};
  return walk(this);
 }
}
class TextNode{constructor(txt,parent){this.nodeType=3;this.textContent=txt;this.parent=parent;}
 remove(){this.parent?.childNodes.splice(this.parent.childNodes.indexOf(this),1);}}
class WeaponSheetPF{};
function createHarness(language='fr',native=true){
 const hooks=new Map(),calls={fetch:0,updates:0,debug:0};
 const item={type:'weapon',isOwner:true,system:{properties:{imp:false}},async update(data){
  calls.updates++;assert.ok(Object.hasOwn(data,'system.properties.imp'));
  this.system.properties.imp=data['system.properties.imp'];
 }};
 const app=new WeaponSheetPF();app.item=item;app.isEditable=true;
 const section=new Node('div');section.className='tab details';section.dataset={tab:'details'};
 const propertySlot=new Node('div');propertySlot.className='weapon-properties form-group stacked';
 section.appendChild(propertySlot);
 const root=new Node('form');
 root.querySelector=selector=>
  selector==='.tab.details[data-tab="details"]'?section:
  selector==='[data-tab="details"]'?section:null;
 app.window={content:root};
 let input=null,existingLabel=null;
 if(native){
  existingLabel=new Node('label');existingLabel.className='checkbox';
  input=new Node('input');input.type='checkbox';input.name='system.properties.imp';
  existingLabel.appendChild(input);
  existingLabel.appendChild(new TextNode('Improvised',existingLabel));
  propertySlot.appendChild(existingLabel);
 }
 class OtherSheetPF{};
 const lookup=key=>{
  if(language==='fr')return key.endsWith('Label')?fr.PF1AE.Weapon.Improvised.Label:fr.PF1AE.Weapon.Improvised.Hint;
  if(language==='en')return key.endsWith('Label')?en.PF1AE.Weapon.Improvised.Label:en.PF1AE.Weapon.Improvised.Hint;
  return key;
 };
 const ctx={
  console:{debug(){calls.debug++;}},
  document:{createElement:tag=>new Node(tag)},
  pf1:{applications:{item:{WeaponSheetPF}}},
  game:{system:{id:'pf1'},i18n:{localize:lookup},settings:{get:()=>false}},
  fetch:async url=>{calls.fetch++;assert.equal(url,'modules/pf1-automation-engine/lang/en.json');
   return {ok:true,json:async()=>en};},
  Hooks:{on(name,fn){const a=hooks.get(name)??[];a.push(fn);hooks.set(name,a);}},
  Promise,Array,Set,Map,Object,String,
 };
 ctx.globalThis=ctx;
 vm.createContext(ctx);vm.runInContext(script,ctx,{filename:'weapon-properties-ui.js'});
 const enhance=(sheet=app)=>vm.runInContext('wpuEnhance',ctx)(sheet,[root]);
 return {hooks,ctx,app,item,section,propertySlot,existingLabel,input,calls,enhance,
  async simulateNativeSubmit(control){
   // PF1 v11.11 ItemSheetV2 form.submitOnChange uses named inputs.
   assert.equal(control.name,'system.properties.imp');
   await item.update({'system.properties.imp':control.checked});
  }};
}
(async()=>{
 const h=createHarness('fr');
 assert.equal(h.hooks.get('renderApplication').length,1,
  'only one ApplicationV2 render hook per module load');
 await h.enhance();
 assert.equal(h.input.checked,false);
 assert.equal(h.existingLabel.querySelector('.pf1ae-improvised-label').textContent,'Arme improvisée');
 assert.equal(h.existingLabel.querySelector('.pf1ae-improvised-hint').textContent,
  'Cette arme est considérée comme une arme improvisée.');
 assert.equal(h.existingLabel.querySelector('input[type="checkbox"][name="system.properties.imp"]'),h.input,
  'keep the same native PF1 input, no second input');
 assert.equal(h.existingLabel.childNodes.filter(n=>n.tagName==='input').length,1);
 h.input.checked=true;await h.simulateNativeSubmit(h.input);
 assert.equal(h.item.system.properties.imp,true);
 await h.enhance();assert.equal(h.input.checked,true,'reopening reads stored native property');
 assert.equal(h.existingLabel.childNodes.filter(n=>n.className==='pf1ae-improvised-label').length,1);
 assert.equal(h.existingLabel.childNodes.filter(n=>n.className==='pf1ae-improvised-hint').length,1);
 h.input.checked=false;await h.simulateNativeSubmit(h.input);
 assert.equal(h.item.system.properties.imp,false);
 // Read-only viewer gets same value but cannot change native field.
 h.item.system.properties.imp=true;h.app.isEditable=false;await h.enhance();
 assert.equal(h.input.checked,true);assert.equal(h.input.disabled,true);
 // Native permissions independent from sheet editable state.
 h.app.isEditable=true;h.item.isOwner=false;await h.enhance();assert.equal(h.input.disabled,true);
 h.item.isOwner=true;await h.enhance();assert.equal(h.input.disabled,false);
 // Different item types, and other app types, must not be affected.
 for(const type of ['spell','feat','buff','equipment']){
  h.item.type=type;const before=h.existingLabel.childNodes.length;
  await h.enhance();assert.equal(h.existingLabel.childNodes.length,before);
 }
 h.item.type='weapon';
 const other=new (class OtherSheetPF{})();other.item=h.item;
 const before=h.existingLabel.childNodes.length;await h.enhance(other);
 assert.equal(h.existingLabel.childNodes.length,before);
 assert.equal(h.calls.updates,2,'enhancement itself never persists anything');
 const english=createHarness('en');await english.enhance();
 assert.equal(english.existingLabel.querySelector('.pf1ae-improvised-label').textContent,
  'Improvised Weapon');
 const fallback=createHarness('es');await fallback.enhance();
 assert.equal(fallback.existingLabel.querySelector('.pf1ae-improvised-label').textContent,
  'Improvised Weapon');
 assert.equal(fallback.existingLabel.querySelector('.pf1ae-improvised-hint').textContent,
  'This weapon is considered an improvised weapon.');
 assert.equal(fallback.calls.fetch,1);
 await fallback.enhance();assert.equal(fallback.calls.fetch,1,'English bundle fetched once');
 // Alternate weapon layouts do not have the native checkbox.
 const alternate=createHarness('fr',false);await alternate.enhance();
 let control=alternate.propertySlot.querySelector('input[type="checkbox"][name="system.properties.imp"]');
 assert.ok(control);assert.equal(control.checked,false);
 await alternate.enhance();
 assert.equal(alternate.propertySlot.childNodes.length,1,'fallback has no duplicates');
 control.checked=true;await alternate.simulateNativeSubmit(control);
 await alternate.enhance();assert.equal(control.checked,true,'fallback state persists');
 alternate.app.isEditable=false;await alternate.enhance();
 assert.equal(control.disabled,true);
 // Missing details area must not throw or persist anything.
 const missing=createHarness('en',false);
 missing.app.window.content.querySelector=()=>null;
 await missing.enhance();assert.equal(missing.calls.updates,0);
 console.log('PASS improvised weapon UI: native model, edit/read-only, rerenders, fallback, locales, non-weapons');
})().catch(error=>{console.error(error);process.exitCode=1;});
