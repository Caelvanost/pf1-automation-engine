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
const modules=new Map([['pf1-automation-engine',{active:true,api:{}}]]);
const context={console,Map,Set,Promise,CONFIG:{Item:{documentClass:ItemPF}},pf1:{documents:{ItemPF}},
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
 // Default is "ask every time": no behavior changes whatsoever.
 assert.equal(await item.use({foo:42}),'native-select');
 assert.equal(nativeSelector.length,1);
 assert.equal(uses.at(-1).options.foo,42);
 await api.set(item,'b');
 assert.equal(api.get(item),'b');
 assert.equal(await item.use({foo:99}),'used:b');
 assert.equal(nativeSelector.length,1,'default action bypasses only native selector');
 assert.equal(uses.at(-1).options.foo,99,'all native options preserved');
 // Explicit action selection never gets replaced.
 assert.equal(await item.use({actionId:'reload',other:true}),'used:reload');
 assert.equal(uses.at(-1).actionId,'reload');
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
 assert.equal(await item.use(),'native-select');
 await assert.rejects(()=>api.set(item,'unknown'),/no longer exists/);
 // No permissions => reject set, existing use still delegated.
 context.game.user.isGM=false;
 item.testUserPermission=()=>false;
 await assert.rejects(()=>api.set(item,'a'),/OWNER/);
 context.game.user.isGM=true;
 await api.set(item,'reload');
 assert.equal(await item.use(),'used:reload');
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
 assert.equal(item.flags.defaultActionId,'reload','only the custom Item flag was used');
 assert.equal(src.includes("advanced.querySelectorAll('input, select, textarea')"),true,'locate actual native Advanced fields');
 assert.equal(src.includes("row.insertAdjacentElement('afterend',section)"),true,'insert inside last field container');
 assert.equal(src.includes("scrollHost.style.overflowY='auto'"),false,'never override PF1 scrolling');
 assert.equal(src.includes('pf1aeDefaultActionSpacer'),false,'do not add spacer outside PF1 scroll area');
 assert.equal(src.includes('eval('),false);
 assert.equal(src.includes('generateChatAttacks'),false);
 assert.equal(src.includes('subtractAmmo'),false);
 console.log('PASS default Item action: native selector bypass, explicit action, skipDialog, missing action fallback, permissions, persistence, deactivate, single action');
})().catch(e=>{console.error(e);process.exitCode=1});
