'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.resolve(__dirname,'../scripts/item-default-action.js'),'utf8');
const ready=[],render=new Map(),uses=[],nativeSelector=[];
const actions=new Map([
 ['a',{id:'a',name:'Attack'}],['b',{id:'b',name:'Two barrels'}],
 ['reload',{id:'reload',name:'Reload'}]
]);
class ItemPF{
 constructor(){this.documentName='Item';this.uuid='Actor.x.Item.gun';this.actions=actions;this.flags={};this.actor=null;}
 getFlag(ns,k){return this.flags[k]??null}
 async setFlag(ns,k,v){this.flags[k]=v;return v}
 async unsetFlag(ns,k){delete this.flags[k]}
 testUserPermission(_user,p){return p==='OWNER'}
 async use({actionId,...options}={}){
  if(!this.actions.size)throw Error('Native: no action');
  if(actionId){
   if(!this.actions.has(actionId))throw Error('Native: action missing');
   uses.push({actionId,options,kind:'explicit'});return 'used:'+actionId;
  }
  if(this.actions.size>1&&options.skipDialog!==true){
   nativeSelector.push('opened');
   uses.push({actionId:null,options,kind:'selector'});return 'native-select';
  }
  const first=this.actions.keys().next().value;
  uses.push({actionId:first,options,kind:'native-default'});return 'used:'+first;
 }
}
let selectorOpenCalls=0;
const ActionSelector={async open(){selectorOpenCalls++;return 'a';}};
const modules=new Map([['pf1-automation-engine',{active:true,api:{}}]]);
const context={console,Map,Set,Promise,CONFIG:{Item:{documentClass:ItemPF}},pf1:{documents:{ItemPF},applications:{ActionSelector}},
 game:{modules,user:{isGM:true},i18n:{localize:k=>k}},
 Hooks:{once(n,cb){if(n==='ready')ready.push(cb)},on(n,cb){render.set(n,cb)}},
 ui:{notifications:{warn(msg){throw Error('unexpected warning: '+msg)}}}};
context.globalThis=context;
vm.createContext(context);vm.runInContext(src,context,{filename:'item-default-action.js'});
for(const cb of ready)cb();
const api=modules.get('pf1-automation-engine').api.defaultAction;
const item=new ItemPF();
(async()=>{
 assert.equal(api.installed(),true);
 assert.equal(api.status().mode,'direct','without libWrapper PF1AE uses the direct fallback');
 assert.equal(api.status().itemUse,true);
 assert.equal(api.status().selector,true);

 // Default is "ask every time": no behavior changes whatsoever.
 assert.equal(await item.use({foo:42}),'native-select');
 assert.equal(nativeSelector.length,1);
 assert.equal(uses.at(-1).options.foo,42);
 await api.set(item,'b');
 assert.equal(api.get(item),'b');
 assert.equal(await item.use({foo:99}),'used:b');
 assert.equal(nativeSelector.length,1,'default action bypasses only native selector');
 assert.equal(uses.at(-1).options.foo,99,'all native options preserved');
 // Explicit opt-in skips only the default action's native configuration dialog.
 assert.equal(api.getSkipDialog(item),false);
 await api.setSkipDialog(item,true);
 assert.equal(api.getSkipDialog(item),true);
 assert.equal(await item.use({source:'hotbar'}),'used:b');
 assert.equal(uses.at(-1).options.skipDialog,true,'skipDialog passed into PF1 native use');
 assert.equal(uses.at(-1).options.source,'hotbar'); 
 // PF1 native ItemPF.use may have captured skipDialog=false before awaiting
 // ActionSelector.open. Confirm the actual ActionUse dialog method is skipped.
 const preRoll=render.get('pf1CreateActionUse');
 assert.equal(typeof preRoll,'function','must subscribe to PF1 pre-dialog ActionUse hook');
 let opened=0;
 const makeActionUse=(action)=>({
  item,action,shared:{item,action,skipDialog:false},
  async createAttackDialog(){opened++;return {from:'native'};}
 });
 const selectedUse=makeActionUse(actions.get('b'));
 preRoll(selectedUse);
 assert.equal(Object.keys(await selectedUse.createAttackDialog()).length,0);
 assert.equal(opened,0,'chosen action must not open the native configuration dialog');
 assert.equal(selectedUse.shared.skipDialog,true,'native shared context records quick use');
 const otherUse=makeActionUse(actions.get('reload'));
 preRoll(otherUse);
 assert.deepEqual(await otherUse.createAttackDialog(),{from:'native'});
 assert.equal(opened,1,'other actions still display their configuration dialog');

 await api.setSkipDialog(item,false);
 assert.equal(api.getSkipDialog(item),false);
 assert.equal(await item.use(),'used:b'); 
 const normalUse=makeActionUse(actions.get('b'));
 preRoll(normalUse);
 assert.deepEqual(await normalUse.createAttackDialog(),{from:'native'});
 assert.equal(opened,2,'unchecked option restores native dialog');

 assert.equal(uses.at(-1).options.skipDialog,undefined,'unchecked leaves PF1 dialog alone');
 // Explicit action selection never gets replaced.
 assert.equal(await item.use({actionId:'reload',other:true}),'used:reload');
 assert.equal(uses.at(-1).actionId,'reload');
 await api.setSkipDialog(item,true);
 assert.equal(await item.use({actionId:'reload'}),'used:reload');
 assert.equal(uses.at(-1).options.skipDialog,undefined,'explicit action does not inherit default skip');
 await api.setSkipDialog(item,false);
 // Explicit skipDialog preference respects native semantics rather than forcing a different action.
 assert.equal(await item.use({skipDialog:true}),'used:a');
 assert.equal(uses.at(-1).kind,'native-default');
 // Action deletion: fall back to selector, preserving the stale flag for correction.
 actions.delete('b');
 assert.equal(await item.use({reason:'deleted'}),'native-select');
 assert.equal(nativeSelector.length,2);
 assert.equal(api.get(item),'b');
 await api.set(item,'');
 assert.equal(api.get(item),null);
 await api.setSkipDialog(item,true);
 assert.equal(await item.use(),'native-select');
 assert.equal(uses.at(-1).options.skipDialog,undefined,'no default action never skips native selector');
 await api.setSkipDialog(item,false);
 await assert.rejects(()=>api.set(item,'unknown'),/no longer exists/);
 // No permissions => reject set, existing use still delegated.
 context.game.user.isGM=false;
 item.testUserPermission=()=>false;
 await assert.rejects(()=>api.set(item,'a'),/OWNER/);
 await assert.rejects(()=>api.setSkipDialog(item,true),/OWNER/);
 context.game.user.isGM=true;
 await api.set(item,'reload');
 assert.equal(await ActionSelector.open({document:item}),'reload','native selector direct call honors preferred action');
 assert.equal(selectorOpenCalls,0,'native selector not opened when preference valid');
 assert.equal(await item.use(),'used:reload');
 // A deleted selected action falls back to the true native selector.
 await item.setFlag('pf1-automation-engine','defaultActionId','deleted');
 assert.equal(await ActionSelector.open({document:item}),'a');
 assert.equal(selectorOpenCalls,1);
 await api.set(item,'reload');
 // No global game setting required, but module deactivation restores native path.
 modules.get('pf1-automation-engine').active=false;
 assert.equal(await item.use(),'native-select');
 modules.get('pf1-automation-engine').active=true;
 // A one-action Item works with the native code; wrapper never creates actions.
 actions.delete('a');actions.delete('reload');actions.set('only',{id:'only',name:'Only'});
 assert.equal(await item.use(),'used:only');
 assert.equal(nativeSelector.length,4);
 assert.equal(render.has('renderItemSheet'),true);
 assert.equal(render.has('renderItemSheetV2'),true);
 assert.equal(render.has('renderApplication'),true,
  'PF1 ItemSheetV2 ApplicationV2 generic render hook must be registered');
 // Exercise the real daRender path with synthetic DOM primitives: unlike
 // the old static checks, this catches missing tabs, duplicate injection
 // and the single-action filter on different PF1 sheet types.
 class FakeNode {
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.style={};
   this.className='';this.value='';this.type='';this.disabled=false;
   this.listeners={};this.parentElement=null;}
  append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n)}}
  setAttribute(){}
  addEventListener(name,fn){this.listeners[name]=fn}
  querySelector(selector){
   if(selector==='[data-pf1ae-default-action]')
    return this.find(n=>n.dataset?.pf1aeDefaultAction==='true');
   return null;
  }
  querySelectorAll(){return []}
  find(test){
   for(const n of this.children){if(test(n))return n;
    const found=n.find?.(test);if(found)return found}
   return null;
  }
 }
 const initialDocument=context.document;
 context.document={
  createElement:tag=>new FakeNode(tag),
  createTextNode:text=>({textContent:text})
 };
 const actionChoice=render.get('renderApplication');
 // Item type-independent: armor, feat, buff and spells with native actions.
 for(const type of ['weapon','equipment','feat','buff','spell']){
  const trial=new ItemPF();
  trial.type=type;trial.actions=new Map([['one',{id:'one',name:'Only action'}]]);
  const page=new FakeNode('div'),details=new FakeNode('div');
  page.querySelector=sel=>sel==='.tab[data-tab="details"]'?details:
   sel==='[data-pf1ae-default-action]'?
    details.querySelector('[data-pf1ae-default-action]'):null;
  const app={document:trial,window:{content:page}};
  actionChoice(app,page);
  assert.ok(details.querySelector('[data-pf1ae-default-action]'),
   type+' PF1 V2 sheet supports one action');
  const count=details.children.length;
  actionChoice(app,page);
  assert.equal(details.children.length,count,type+' render is idempotent');
 }
 const fallback=new FakeNode('form');
 fallback.querySelector=sel=>sel==='form'?fallback:
  sel==='[data-pf1ae-default-action]'?
   fallback.find(n=>n.dataset?.pf1aeDefaultAction==='true'):null;
 const fallbackItem=new ItemPF();
 fallbackItem.type='feat';
 fallbackItem.actions=new Map([['one',{id:'one',name:'Only action'}]]);
 actionChoice({item:fallbackItem,window:{content:fallback}},fallback);
 assert.ok(fallback.querySelector('[data-pf1ae-default-action]'),
  'missing Advanced and Details tabs falls back to visible sheet content');
 context.document=initialDocument;

 assert.equal(item.flags.defaultActionId,'reload','only the custom Item flag was used');
 assert.equal(src.includes("advanced.querySelectorAll('input, select, textarea')"),true,'locate actual native Advanced fields');
 assert.equal(src.includes("row.insertAdjacentElement('afterend',section)"),true,'insert inside last field container');
 assert.equal(src.includes("heading.className='section-header'"),true,'native style heading');
 assert.equal(src.includes("group.className='form-group'"),true,'native form layout');
 assert.equal(src.includes("t('Hint')"),true,'localized help text');
 assert.equal(src.includes("skipGroup.className='form-group'"),true,'native checkbox layout');
 assert.equal(src.includes("t('SkipDialogHint')"),true,'localized checkbox hint');
 assert.equal(src.includes("scrollHost.style.overflowY='auto'"),false,'never override PF1 scrolling');
 assert.equal(src.includes('pf1aeDefaultActionSpacer'),false,'do not add spacer outside PF1 scroll area');
 assert.equal(src.includes('eval('),false);
 assert.equal(src.includes('generateChatAttacks'),false);
 assert.equal(src.includes('subtractAmmo'),false);
 // Simulate PF1 11.11's actual public class path and an active libWrapper.
 // CONFIG.Item.documentClass is ItemBasePF and intentionally lacks use().
 const registered=[];
 const wrappedCalls=[];
 class LiveItemPF{
  constructor(){
   this.documentName='Item';
   this.actions=new Map([['x',{id:'x',name:'Blast'}],['y',{id:'y',name:'Pulse'}]]);
   this.flags={defaultActionId:'y',defaultActionSkipDialog:true};
   this.uuid='Actor.live.Item.x';
  }
  getFlag(_ns,key){return this.flags[key]??null;}
  async setFlag(_ns,key,value){this.flags[key]=value;return value;}
  async unsetFlag(_ns,key){delete this.flags[key];}
  testUserPermission(){return true;}
  async use(options={}){wrappedCalls.push(options);return options.actionId??'native-selector';}
 }
 const liveSelector={async open(){return 'native-choice';}};
 const fakeLibWrapper={
  register(packageId,target,fn,type){
   registered.push({packageId,target,type});
   let owner,key;
   if(target==='pf1.documents.item.ItemPF.prototype.use'){
    owner=LiveItemPF.prototype;key='use';
   }else if(target==='pf1.applications.ActionSelector.open'){
    owner=liveSelector;key='open';
   }else throw Error('Unexpected wrapper target: '+target);
   const original=owner[key];
   owner[key]=function(...args){
    return fn.call(this,(...replaced)=>original.apply(this,replaced),...args);
   };
   return registered.length;
  }
 };
 const liveReady=[];
 const liveModules=new Map([
  ['pf1-automation-engine',{active:true,api:{}}],
  ['lib-wrapper',{active:true}]
 ]);
 const liveContext={
  console,Map,Set,Promise,
  CONFIG:{Item:{documentClass:class ItemBasePF{}}},
  pf1:{documents:{item:{ItemPF:LiveItemPF}},applications:{ActionSelector:liveSelector}},
  libWrapper:fakeLibWrapper,
  game:{modules:liveModules,user:{isGM:true},i18n:{localize:key=>key}},
  Hooks:{once(name,fn){if(name==='ready')liveReady.push(fn)},on(){}},
  ui:{notifications:{warn(){} }}
 };
 liveContext.globalThis=liveContext;
 vm.createContext(liveContext);
 vm.runInContext(src,liveContext,{filename:'item-default-action-libwrapper.js'});
 for(const cb of liveReady)cb();
 const liveApi=liveModules.get('pf1-automation-engine').api.defaultAction;
 assert.equal(liveApi.installed(),true,'libWrapper installation reports success');
 assert.equal(liveApi.status().mode,'libWrapper');
 assert.equal(liveApi.status().selectorMode,'libWrapper');
 assert.deepEqual(registered.map(x=>[x.target,x.type]),[
  ['pf1.documents.item.ItemPF.prototype.use','WRAPPER'],
  ['pf1.applications.ActionSelector.open','MIXED']
 ]);
 const liveItem=new LiveItemPF();
 assert.equal(await liveItem.use({caller:'sheet'}),'y');
 assert.equal(wrappedCalls.at(-1).actionId,'y');
 assert.equal(wrappedCalls.at(-1).skipDialog,true);
 assert.equal(wrappedCalls.at(-1).caller,'sheet');
 assert.equal(await liveItem.use({actionId:'x'}),'x');
 assert.equal(wrappedCalls.at(-1).skipDialog,undefined,'explicit action preserved');
 assert.equal(await liveSelector.open({document:liveItem}),'y');
 assert.equal(registered.length,2,'no duplicate registration');
 assert.equal(liveApi.status().itemUse,true);
 assert.equal(liveApi.status().selector,true);
 console.log('PASS optional libWrapper: native PF1 public class path, WRAPPER and MIXED, default action and explicit action');
 console.log('PASS default Item action: native selector bypass, explicit action, skipDialog, missing action fallback, permissions, persistence, deactivate, single action');
})().catch(e=>{console.error(e);process.exitCode=1});
