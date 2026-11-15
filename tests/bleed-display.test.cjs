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
 width:32,height:32,children:[],addChild(child){this.children.push(child)}});
const bleedIcon=sprite(bleedSrc),otherIcon=sprite('icons/svg/aura.svg');
const token=new FakeToken();
token.id='token-1';token.actor=a;token.effects={children:[otherIcon,bleedIcon]};
const game={
 user:{id:'gm',isGM:true},actors:{contents:[a]},scenes:{contents:[]},
 modules:new Map([[NS,{active:true,api}],['lib-wrapper',{active:false}]])
};
const ctx={console,Map,Set,Promise,Date,game,PIXI:{Text:FakeText},
 canvas:{tokens:{placeables:[token]}},CONFIG:{
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
 // A spell-generated Buff is not treated as manual even if it has Bleed flags.
 a.items.contents=[unrelated];
 assert.equal(api.bleedDisplay.formula(a),null);
 console.log('PASS bleed-display: native Bleed icon formula overlay, single marker,');
 console.log(' redraw/update/reconnect-safe, migration, and other Buff isolation.');
})().catch(error=>{console.error(error);process.exitCode=1});
