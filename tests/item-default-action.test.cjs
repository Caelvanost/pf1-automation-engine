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
const actionApi=modules.get('pf1-automation-engine').api.actionOptions;
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
 // Per-action permission and unknown action checks.
 await assert.rejects(()=>actionApi.setSkipDialog(item,'unknown',true),
  /no longer exists/);
 // No permissions => reject set, existing use still delegated.
 context.game.user.isGM=false;
 item.testUserPermission=()=>false;
 await assert.rejects(()=>api.set(item,'a'),/OWNER/);
 await assert.rejects(()=>api.setSkipDialog(item,true),/OWNER/);
 await assert.rejects(()=>actionApi.setSkipDialog(item,'reload',true),/OWNER/);
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
 // New per-action API does not depend on the preferred default action.
 assert.equal(actionApi.isAvailable(),true);
 assert.equal(actionApi.getSkipDialog(item,'reload'),false);
 assert.equal(await actionApi.setSkipDialog(item,'reload',true),true);
 assert.equal(actionApi.getSkipDialog(item,'reload'),true);
 assert.equal(item.flags.actionSkipDialog.reload,true);
 assert.equal(await item.use({actionId:'reload'}),'used:reload');
 assert.equal(uses.at(-1).options.skipDialog,true,
  'explicitly selected action goes directly through native ItemPF.use');
 const selectedReload=makeActionUse(actions.get('reload'));
 preRoll(selectedReload);
 assert.equal(Object.keys(await selectedReload.createAttackDialog()).length,0);
 assert.equal(await actionApi.setSkipDialog(item,'reload',false),false);
 assert.equal(actionApi.getSkipDialog(item,'reload'),false);
 assert.equal(await item.use({actionId:'reload'}),'used:reload');
 assert.equal(uses.at(-1).options.skipDialog,undefined);
 const defaultOnly=new ItemPF();
 defaultOnly.actions=new Map([['heal',{id:'heal',name:'Se soigner'}]]);
 await actionApi.setSkipDialog(defaultOnly,'heal',true);
 assert.equal(await defaultOnly.use(),'used:heal');
 assert.equal(uses.at(-1).options.skipDialog,true,
  'single-action item uses native skipDialog without a selector');
 const defaultRoll=makeActionUse(actions.get('reload'));
 preRoll(defaultRoll);
 assert.deepEqual(await defaultRoll.createAttackDialog(),{from:'native'},
  'non opted-in actions remain fully native');
 // A one-action Item works with the native code; wrapper never creates actions.
 actions.delete('a');actions.delete('reload');actions.set('only',{id:'only',name:'Only'});
 assert.equal(await item.use(),'used:only');
 assert.equal(nativeSelector.length,4);
 assert.equal(render.has('renderItemSheet'),true);
 assert.equal(render.has('renderItemSheetV2'),true);
 assert.equal(render.has('renderItemActionSheet'),true,
  'action editor hook is registered');
 assert.equal(render.has('renderApplication'),true,
  'PF1 ItemSheetV2 ApplicationV2 generic render hook must be registered');
 // Exercise the real render hook against simulated PF1 ApplicationV2
 // ItemSheets and reject action/attack dialog windows.
 class FakeNode {
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.style={};
   this.className='';this.value='';this.type='';this.disabled=false;
   this.listeners={};this.parentElement=null;}
  append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n)}}
  setAttribute(){}
  addEventListener(name,fn){this.listeners[name]=fn}
  remove(){if(this.parentElement)this.parentElement.children.splice(
   this.parentElement.children.indexOf(this),1)}
  contains(node){return node===this||this.children.some(n=>n===node||
   n.contains?.(node)===true)}
  closest(){return null}
  querySelector(selector){
   if(selector==='[data-pf1ae-default-action]')
    return this.find(n=>n.dataset?.pf1aeDefaultAction==='true');
   if(selector==='input[type="checkbox"]')
    return this.find(n=>n.type==='checkbox');
   if(selector==='[data-pf1ae-action-skip-dialog]')
    return this.find(n=>n.dataset?.pf1aeActionSkipDialog==='true');
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
 class FakeItemSheetPF {
  constructor(item,advanced=true){
   this.item=item;
   const page=new FakeNode('div'),panel=new FakeNode('div');
   page.querySelector=sel=>
    (sel==='.sheet-body .tab[data-tab="advanced"]'&&advanced)?panel:
    sel==='[data-pf1ae-default-action]'?
     panel.querySelector('[data-pf1ae-default-action]'):null;
   this.window={content:page};
   this.panel=panel;
  }
 }
 context.pf1.applications.item={ItemSheetPF:FakeItemSheetPF};
 const actionChoice=render.get('renderApplication');
 for(const type of ['weapon','equipment','feat','buff','spell']){
  const trial=new ItemPF();trial.type=type;
  trial.actions=new Map([['one',{id:'one',name:'Only action'}]]);
  const sheet=new FakeItemSheetPF(trial);
  actionChoice(sheet,sheet.window.content);
  assert.equal(sheet.panel.children.length,0,
   type+' with a single action must have no default-action control');
  trial.actions.set('two',{id:'two',name:'Second action'});
  actionChoice(sheet,sheet.window.content);
  assert.ok(sheet.panel.querySelector('[data-pf1ae-default-action]'),
   type+' with multiple actions shows control in Advanced tab');
  const count=sheet.panel.children.length;
  actionChoice(sheet,sheet.window.content);
  assert.equal(sheet.panel.children.length,count,
   type+' render must be idempotent');
  trial.actions.delete('two');
  actionChoice(sheet,sheet.window.content);
  assert.equal(sheet.panel.children.length,0,
   type+' hiding a single remaining action also clears a stale control');
 }
 // Native PF1 FormApplication ItemActionSheet exposes item, action and
 // isEditable. Inject only in Use tab, never on the Item sheet or another tab.
 class ItemActionSheet {
  constructor(item,action,withUsage=true){
   this.item=item;this.action=action;this.isEditable=true;
   const root=new FakeNode('div');
   const usage=new FakeNode('section');
   root.querySelector=sel=>
    sel==='.tab[data-tab="use"]'&&withUsage?usage:
    sel==='[data-pf1ae-action-skip-dialog]'?
     usage.querySelector('[data-pf1ae-action-skip-dialog]'):null;
   usage.querySelector=sel=>
    sel==='[data-pf1ae-action-skip-dialog]'?
     usage.find(node=>node.dataset?.pf1aeActionSkipDialog==='true'):
    sel==='input[type="checkbox"]'?
     usage.find(node=>node.type==='checkbox'):null;
   this.window={content:root};this.usage=usage;
  }
 }
 context.pf1.applications.component={ItemActionSheet};
 const actionRender=render.get('renderItemActionSheet');
 const parent=new ItemPF();
 parent.actions=new Map([
  ['prepare',{id:'prepare',name:'Préparer'}],
  ['consume',{id:'consume',name:'Consommer'}]
 ]);
 assert.equal(await actionApi.setSkipDialog(parent,'prepare',true),true);
 assert.equal(actionApi.getSkipDialog(parent,'consume'),false);
 const prepareSheet=new ItemActionSheet(parent,parent.actions.get('prepare'));
 actionRender(prepareSheet,prepareSheet.window.content);
 assert.equal(prepareSheet.usage.children.length,1,'only one PF1-like form-group appended');
 let skipControl=prepareSheet.usage.querySelector('input[type="checkbox"]');
 assert.equal(skipControl.checked,true,'per-action checked state');
 actionRender(prepareSheet,prepareSheet.window.content);
 assert.equal(prepareSheet.usage.children.length,1,'no duplicate after rerender');
 const consumeSheet=new ItemActionSheet(parent,parent.actions.get('consume'));
 actionRender(consumeSheet,consumeSheet.window.content);
 assert.equal(consumeSheet.usage.querySelector('input[type="checkbox"]').checked,false);
 // Action-specific UI edits save by internal action ID, not by translated name.
 skipControl=consumeSheet.usage.querySelector('input[type="checkbox"]');
 skipControl.checked=true;
 skipControl.listeners.change({stopPropagation(){}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(actionApi.getSkipDialog(parent,'consume'),true);
 parent.actions.get('consume').name='Boire';
 assert.equal(actionApi.getSkipDialog(parent,'consume'),true,'renaming retains flag');
 const noUsage=new ItemActionSheet(parent,parent.actions.get('consume'),false);
 actionRender(noUsage,noUsage.window.content);
 assert.equal(noUsage.usage.children.length,0,'no injection outside Use tab');
 consumeSheet.isEditable=false;
 actionRender(consumeSheet,consumeSheet.window.content);
 assert.equal(consumeSheet.usage.querySelector('input[type="checkbox"]').disabled,true);
 parent.actions.set('copy',{id:'copy',name:'Préparer (copie)'});
 assert.equal(actionApi.getSkipDialog(parent,'copy'),false,
  'new ID never inherits existing action preference');
 parent.actions.delete('prepare');
 render.get('updateItem')(parent,{system:{actions:[]}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(parent.flags.actionSkipDialog?.prepare,undefined);
 assert.equal(actionApi.getSkipDialog(parent,'consume'),true);
 const copiedItem=new ItemPF();
 copiedItem.actions=new Map(parent.actions);
 copiedItem.flags=structuredClone(parent.flags);
 assert.equal(actionApi.getSkipDialog(copiedItem,'consume'),true,
  'flags and stable action IDs survive item duplication');
 // Legacy data migrates to a per-action boolean without changing default ID.
 const migrated=new ItemPF();
 migrated.actions=new Map([['one',{id:'one'}],['two',{id:'two'}]]);
 migrated.flags.defaultActionId='two';
 migrated.flags.defaultActionSkipDialog=true;
 assert.equal(actionApi.getSkipDialog(migrated,'two'),true);
 assert.equal(await actionApi.migrate(migrated),true);
 assert.equal(migrated.flags.defaultActionSkipDialog,undefined);
 assert.equal(migrated.flags.actionSkipDialog.two,true);
 assert.equal(migrated.flags.defaultActionId,'two');
 assert.equal(actionApi.getSkipDialog(migrated,'one'),false);
 // Action-edit and attack-edit windows can expose the parent Item but
 // must never receive the top-level Item's default-action interface.
 const parentItem=new ItemPF();
 parentItem.actions=new Map([
  ['one',{id:'one',name:'Attack'}],
  ['two',{id:'two',name:'Special attack'}]
 ]);
 const actionEditor={document:parentItem,action:parentItem.actions.get('one'),
  window:{content:new FakeNode('div')}};
 actionEditor.window.content.querySelector=sel=>
  sel==='.sheet-body .tab[data-tab="advanced"]'?new FakeNode('div'):null;
 actionChoice(actionEditor,actionEditor.window.content);
 assert.equal(actionEditor.window.content.children.length,0,
  'an Action edit window referencing an Item is not its ItemSheet');
 class FakeAttackSheet extends FakeItemSheetPF {}
 const attackSheet=new FakeAttackSheet(parentItem);
 attackSheet.action=parentItem.actions.get('one');
 actionChoice(attackSheet,attackSheet.window.content);
 assert.equal(attackSheet.panel.children.length,0,
  'a native attack/action editor is excluded even if subclassed');
 // An item with several actions but no Advanced tab must not receive
 // an injected section in Details, Actions or the outer form.
 const noAdvanced=new FakeItemSheetPF(parentItem,false);
 actionChoice(noAdvanced,noAdvanced.window.content);
 assert.equal(noAdvanced.panel.children.length,0,
  'no Advanced tab means no default-action UI or fallback');
 const noActions=new ItemPF();noActions.actions=new Map();
 const emptySheet=new FakeItemSheetPF(noActions);
 actionChoice(emptySheet,emptySheet.window.content);
 assert.equal(emptySheet.panel.children.length,0);
 context.document=initialDocument;

 assert.equal(item.flags.defaultActionId,'reload','only the custom Item flag was used');
 assert.equal(src.includes("advanced.querySelectorAll('input, select, textarea')"),true,'locate actual native Advanced fields');
 assert.equal(src.includes("row.insertAdjacentElement('afterend',section)"),true,'insert inside last field container');
 assert.equal(src.includes("heading.className='section-header'"),true,'native style heading');
 assert.equal(src.includes("group.className='form-group'"),true,'native form layout');
 assert.equal(src.includes("t('Hint')"),true,'localized help text');
 assert.equal(src.includes("skipGroup.className='form-group'"),false,
  'legacy Advanced skip option was removed');
 assert.equal(src.includes("t('SkipDialogHint')"),false,
  'legacy checkbox hint was removed');
 assert.equal(src.includes("section.append(heading,group,hint)"),true,
  'Advanced keeps only the default action selector');
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
 const liveOptions=liveModules.get('pf1-automation-engine').api.actionOptions;
 await liveOptions.setSkipDialog(liveItem,'x',true);
 assert.equal(await liveItem.use({actionId:'x',source:'action-hud'}),'x');
 assert.equal(wrappedCalls.at(-1).skipDialog,true,
  'libWrapper permits per-action explicit quick use');
 assert.equal(wrappedCalls.at(-1).source,'action-hud',
  'other native use options survive wrapper');
 await liveOptions.setSkipDialog(liveItem,'x',false);
 assert.equal(await liveItem.use({actionId:'x'}),'x');
 assert.equal(wrappedCalls.at(-1).skipDialog,undefined,
  'unchecking restores native path under libWrapper');
 assert.equal(await liveSelector.open({document:liveItem}),'y');
 assert.equal(registered.length,2,'no duplicate registration');
 assert.equal(liveApi.status().itemUse,true);
 assert.equal(liveApi.status().selector,true);
 console.log('PASS optional libWrapper: native PF1 public class path, WRAPPER and MIXED, default action and explicit action');
 console.log('PASS default Item action: native selector bypass, explicit action, skipDialog, missing action fallback, permissions, persistence, deactivate, single action');
})().catch(e=>{console.error(e);process.exitCode=1});
