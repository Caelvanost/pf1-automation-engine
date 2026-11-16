'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.resolve(__dirname,'../scripts/bleed-display.js'),'utf8');
const NS='pf1-automation-engine';
const hooks=new Map(),api={};
let updates=0;
class FakeToken{
 async drawEffects(){return this;}
}
class FakeText{
 constructor({text,style}){this.text=text;this.style=style;this.anchor={set(){}};}
}
const marker=(actor,formula,{hidden=true,active=true}={})=>{
 const flags={[NS]:{manualBleed:{generated:true},
  bleed:{enabled:true,type:'hp',formula,stacking:'highest'}}};
 return {id:'manual',uuid:actor.uuid+'.Item.manual',type:'buff',
  actor,flags,activeState:active,system:{active,hideFromToken:hidden},
  getFlag(ns,key){return this.flags[ns]?.[key]},
  async update(change){
   updates++;
   if('system.hideFromToken' in change)
    this.system.hideFromToken=change['system.hideFromToken'];
  }};
};
const other=(actor)=>({id:'other',type:'buff',actor,activeState:true,
 system:{active:true,hideFromToken:false},
 getFlag(){return null},
 async update(){throw Error('Unrelated buff must never be edited');}});
const a={uuid:'Actor.test',documentName:'Actor',items:{contents:[]},
 testUserPermission(){return false}};
const manual=marker(a,'1d4',{hidden:false});
const unrelated=other(a);
a.items.contents.push(manual,unrelated);
const bleedSrc='systems/pf1/icons/conditions/bleed.webp';
const sprite=(src)=>({texture:{source:{resource:{url:src}}},
 width:32,height:32,children:[],handlers:{},
 on(name,callback){this.handlers[name]=callback;},
 addChild(child){this.children.push(child)},
 removeChild(child){this.children=this.children.filter(x=>x!==child)}});
const bleedIcon=sprite(bleedSrc),otherIcon=sprite('icons/svg/aura.svg');
const token=new FakeToken();
token.id='token-1';token.actor=a;token.effects={children:[otherIcon,bleedIcon]};
const game={
 user:{id:'gm',isGM:true},actors:{contents:[a]},scenes:{contents:[]},
 modules:new Map([[NS,{active:true,api}],['lib-wrapper',{active:false}]])
};
const richTitle={
 nodeType:1,textContent:'Saignement',children:[],
 closest(){return richTooltip;},parentElement:null
};
const otherTitle={nodeType:1,textContent:'Blessé',children:[]};
const richTooltip={
 nodeType:1,textContent:'Saignement Active: 6 seconds Max duration: Infinity years',
 children:[richTitle],querySelectorAll(){return [richTitle]}
};
richTitle.parentElement=richTooltip;
let tooltipMutation=null;
class FakeMutationObserver{
 constructor(callback){tooltipMutation=callback}
 observe(_root,options){assert.equal(options.subtree,true)}
 disconnect(){}
}
const document={
 body:{},
 createElement(){return {className:'',textContent:'',style:{},remove(){this.removed=true}}}
};
const ctx={console,Map,Set,Promise,Date,game,document,
 MutationObserver:FakeMutationObserver,PIXI:{Text:FakeText},
 canvas:{tokens:{placeables:[token],controlled:[token],hovered:token}},CONFIG:{
 statusEffects:[{id:'bleed',img:bleedSrc},{id:'prone',img:'icons/svg/aura.svg'}],
 Token:{objectClass:FakeToken}
},Hooks:{
 once(name,fn){(hooks.get(name)??hooks.set(name,[]).get(name)).push(fn)},
 on(name,fn){(hooks.get(name)??hooks.set(name,[]).get(name)).push(fn)}
}};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'bleed-display.js'});
(async()=>{
 for(const fn of hooks.get('ready')??[])fn();
 await new Promise(r=>setTimeout(r,5));
 assert.equal(manual.system.hideFromToken,true,'existing generated Buff auto-hidden at world open');
 assert.equal(unrelated.system.hideFromToken,false,'other Buff unmodified');
 assert.equal(updates,1,'only manual Buff migration updates item');
 assert.equal(api.bleedDisplay.formula(a),'1d4');
 await token.drawEffects();
 assert.equal(otherIcon.children.length,0,'unrelated status icon not decorated');
 assert.equal(bleedIcon.children.length,1,'native Bleed icon gets one overlay');
 assert.equal(bleedIcon.children[0].text,'1d4');
 await token.drawEffects();
 assert.equal(bleedIcon.children.length,1,'redraw is idempotent');
 manual.flags[NS].bleed.formula='2d6+1';
 await token.drawEffects();
 assert.equal(bleedIcon.children.length,1);
 assert.equal(bleedIcon.children[0].text,'2d6+1',
  'formula updates existing badge without duplicating an icon');
 // The icon is recreated by Foundry on AE draw and the badge follows it.
 const replacement=sprite(bleedSrc);token.effects.children=[otherIcon,replacement];
 await token.drawEffects();
 assert.equal(replacement.children.length,1,'new native icon gets badge after redraw');
 assert.equal(replacement.children[0].text,'2d6+1');
 manual.activeState=false;
 token.effects.children=[otherIcon,sprite(bleedSrc)];
 await token.drawEffects();
 assert.equal(token.effects.children[1].children.length,0,
  'inactive manual Buff does not display an outdated badge');
 manual.activeState=true;
 // If there is no native Bleed icon, do not overlay unrelated conditions.
 token.effects.children=[otherIcon];
 await token.drawEffects();
 assert.equal(otherIcon.children.length,0);
 // The native ActiveEffect wins over any legacy Buff formula.
 a.effects={contents:[{id:'bleed-native',documentName:'ActiveEffect',statuses:new Set(['bleed']),
  disabled:false,name:'Bleed',flags:{[NS]:{bleed:{enabled:true,formula:'2d4+1'}}},
  async update(change){if(change.name)this.name=change.name;},
  getFlag(ns,key){return this.flags[ns]?.[key]??null}
 }]};
 assert.equal(api.bleedDisplay.formula(a),'2d4+1');
 assert.equal(api.bleedDisplay.label(a),'Bleed - 2d4+1');
 a.effects.contents[0].disabled=true;
 assert.equal(api.bleedDisplay.formula(a),'2d6+1',
  'disabled native condition does not replace legacy fallback');
 a.effects.contents[0].disabled=false;
 // A spell-generated Buff is not treated as manual even if it has Bleed flags.
 a.items.contents=[unrelated];
 assert.equal(api.bleedDisplay.formula(a),'2d4+1',
  'native Bleed flags remain sufficient with no Item Buff');
 // Selected-token native status picker shows the same formula.
 const hudControl={style:{},children:[],attributes:{},
  setAttribute(name,value){this.attributes[name]=value},
  removeAttribute(name){delete this.attributes[name]},
  appendChild(child){this.children.push(child)},
  querySelector(selector){return selector==='.pf1ae-bleed-hud-value'?
   this.children.find(c=>c.className==='pf1ae-bleed-hud-value')??null:null}};
 const hudRoot={querySelectorAll(selector){
  assert.match(selector,/data-status-id/);return [hudControl];
 }};
 const hud={object:{actor:a}};
 const event=hooks.get('renderTokenHUD')?.[0];
 assert.equal(typeof event,'function','token HUD render listener installed');
 event(hud,hudRoot);
 assert.equal(hudControl.children.length,1);
 assert.equal(hudControl.children[0].textContent,'2d4+1');
 assert.equal(hudControl.attributes['aria-label'],'Bleed - 2d4+1');
 assert.equal(hudControl.attributes['data-tooltip-text'],'Bleed - 2d4+1',
  'Foundry hover reads data-tooltip-text, not native title');
 assert.equal(hudControl.children[0].style.cssText.includes('pointer-events:none'),true);
 a.effects.contents[0].flags={[NS]:{bleed:{enabled:true,formula:'5'}}};
 event(hud,hudRoot);
 assert.equal(hudControl.children.length,1,'HUD value updates without duplicate');
 assert.equal(hudControl.children[0].textContent,'5');
 assert.equal(hudControl.attributes['data-tooltip-text'],'Bleed - 5');
 game.i18n={lang:'fr'};
 event(hud,hudRoot);
 assert.equal(hudControl.attributes['aria-label'],'Saignement - 5');
 assert.equal(hudControl.attributes['data-tooltip-text'],'Saignement - 5');
 assert.equal(api.bleedDisplay.label(a),'Saignement - 5');
 const effectName={textContent:'Bleed',setAttribute(name,value){this[name]=value}};
 const sheetRow={querySelector(){return effectName}};
 const sheetRoot={querySelectorAll(){return [sheetRow]}};
 api.bleedDisplay.sheet({actor:a},sheetRoot);
 assert.equal(effectName.textContent,'Saignement - 5');
 assert.equal(effectName['data-tooltip-text'],'Saignement - 5');
 game.i18n.lang='de';
 api.bleedDisplay.sheet({actor:a},sheetRoot);
 assert.equal(effectName.textContent,'Bleed - 5','non-French locale gets English name');
 game.i18n.lang='fr';
 // Removing bleed clears the HUD badge while leaving other status controls alone.
 a.effects.contents[0].disabled=true;
 event(hud,hudRoot);
 assert.equal(hudControl.children[0].removed,true);
 assert.equal(hudControl.attributes['data-tooltip-text'],undefined,
  'stale hover override removed when effect disabled');
 a.effects.contents[0].disabled=false;
 // Existing native Bleed conditions are renamed on GM migration without recreation.
 a.effects.contents[0].name='Bleed';
 await api.bleedDisplay.refreshNames();
 assert.equal(a.effects.contents[0].name,'Saignement - 5');

 // Official PF1 extended tooltip hook modifies the unmounted fragment.
 const extended=hooks.get('renderPF1ExtendedTooltip')?.[0];
 assert.equal(typeof extended,'function');
 game.i18n.lang='fr';
 const extendedTitle={nodeType:1,textContent:'Saignement',children:[]};
 const template={content:{nodeType:11,textContent:'',querySelectorAll(){return [extendedTitle]}}};
 extended({actor:a},'condition-bleed',template);
 assert.equal(extendedTitle.textContent,'Saignement - 5');
 extendedTitle.textContent='Bleed';
 game.i18n.lang='de';
 extended({actor:a},'condition-bleed',template);
 assert.equal(extendedTitle.textContent,'Bleed - 5','English fallback on PF1 hook');
 const noBleed={nodeType:1,textContent:'Fatigued',children:[]};
 const foreignTemplate={content:{nodeType:11,textContent:'',querySelectorAll(){return [noBleed]}}};
 extended({actor:a},'condition-fatigue',foreignTemplate);
 assert.equal(noBleed.textContent,'Fatigued','unrelated effect stays untouched');
 // The real on-token PF1 tooltip is a DOM popover inserted AFTER hover,
 // not an interactive PIXI sprite.
 game.i18n.lang='fr';
 richTitle.textContent='Saignement';
 tooltipMutation([{type:'childList',addedNodes:[richTooltip]}]);
 assert.equal(richTitle.textContent,'Saignement - 5');
 assert.equal(otherTitle.textContent,'Blessé');
 richTitle.textContent='Saignement';
 tooltipMutation([{type:'characterData',target:{nodeType:3,parentElement:richTitle}}]);
 assert.equal(richTitle.textContent,'Saignement - 5');
 game.i18n.lang='de';
 richTitle.textContent='Bleed';
 tooltipMutation([{type:'childList',addedNodes:[richTooltip]}]);
 assert.equal(richTitle.textContent,'Bleed - 5');
 console.log('PASS bleed-display: native Bleed icon formula overlay, single marker,');
 console.log(' redraw/update/reconnect-safe, migration, and other Buff isolation.');
})().catch(error=>{console.error(error);process.exitCode=1});
