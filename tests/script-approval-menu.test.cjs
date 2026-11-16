'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../scripts/script-approvals.js'),'utf8');
const locales=['en','fr'].map(lang=>JSON.parse(fs.readFileSync(path.resolve(__dirname,'../lang/'+lang+'.json'),'utf8')));
const ns='pf1-automation-engine';
const settings=new Map(),registrations=new Map(),lifecycle=new Map();
const users=[{id:'gm',active:true,isGM:true},{id:'player',active:true,isGM:false}];
const actor={documentName:'Actor',uuid:'Actor.hero',name:'Hero'};
const script={id:'precise',name:'PF1AE:rangedMelee:override',category:'toggle',
 _source:{id:'precise',script:'native original'},execute(){}};
const useScript={id:'use1',name:'Custom use',category:'use',
 _source:{id:'use1',script:'native use'},execute(){}};
const item={documentName:'Item',uuid:'Actor.hero.Item.feat',name:'Precise Shot',actor,
 scriptCalls:{contents:[script,useScript]}};
actor.items={contents:[item]};
const docs=new Map([[actor.uuid,actor],[item.uuid,item]]);
class FormApplication{
 static get defaultOptions(){return {}}
 constructor(){this.renderCount=0}
 render(){this.renderCount++;return this}
}
const game={user:users[0],users,actors:{contents:[actor]},scenes:{contents:[]},
 modules:new Map([[ns,{api:{}}]]),i18n:{localize:key=>key},
 settings:{
  get:(_ns,k)=>settings.get(k),
  register:(_ns,k,options)=>{registrations.set(k,options);if(!settings.has(k))settings.set(k,options.default)},
  registerMenu:(_ns,k,options)=>registrations.set(k,options),
  set:async(_ns,k,value)=>{settings.set(k,structuredClone(value));return value}
 }};
const ctx={console,FormApplication,game,Date,Map,Set,ui:{notifications:{info(){}}},
 foundry:{utils:{deepClone:structuredClone,mergeObject:(a,b)=>({...a,...b})}},
 Hooks:{once:(k,cb)=>lifecycle.set(k,cb),callAll(){}},
 fromUuid:async uuid=>docs.get(uuid)};
vm.createContext(ctx);vm.runInContext(source,ctx,{filename:'script-approvals.js'});
lifecycle.get('init')();lifecycle.get('ready')();
const api=game.modules.get(ns).api.scriptApprovals;
(async()=>{
 const discovered=api.discover();
 assert.equal(discovered.length,2,'native toggle and use calls are discovered');
 assert.equal(discovered.every(x=>x.supported),true);
 assert.equal(api.check(actor,item,script).approved,false,'secure mode initially denies');
 const menu=registrations.get('scriptApprovalMenu');
 assert.ok(menu?.type,'GM menu registered');
 const form=new menu.type();
 let data=await form.getData();
 assert.equal(data.scripts.length,2);assert.equal(data.canEdit,true);
 assert.equal(data.scripts.every(x=>x.approved===false),true);
 await form._updateObject(null,{'approval-0':'on','approval-1':'on'});
 assert.equal(api.check(actor,item,script).approved,true,'secure approval granted');
 assert.equal(api.check(actor,item,useScript).approved,true,'use category separately authorized');
 assert.equal(settings.get('scriptFallbackApprovals').length,2);
 await form.getData();
 await form._updateObject(null,{});
 assert.equal(api.check(actor,item,script).approved,false,'unchecked call revoked');
 assert.equal(settings.get('scriptFallbackApprovals').length,0);
 settings.set('trustedTableMode',true);
 data=await form.getData();
 assert.equal(data.canEdit,false,'trusted mode is read-only');
 await assert.rejects(form._updateObject(null,{'approval-0':'on'}),/secure mode/);
 settings.set('trustedTableMode',false);
 data=await form.getData();
 script._source.script='changed after dialog opened';
 const changedIndex=data.scripts.find(x=>x.scriptId==='precise').index;
 await assert.rejects(form._updateObject(null,{['approval-'+changedIndex]:'on'}),/changed/);
 assert.equal(api.check(actor,item,script).approved,false,'stale source cannot be approved');
 const replacement={...script};
 item.scriptCalls.contents[0]=replacement;
 assert.equal(api.check(actor,item,script).approved,false,'old call identity rejected');
 item.scriptCalls.contents[0]=script;
 await api.approve({actor,item,scriptId:script.id});
 assert.equal(api.check(actor,item,script).approved,true);
 script._source.script='modified again';
 assert.equal(api.check(actor,item,script).approved,false,'fingerprint invalidates approval');
 for(const locale of locales){
  assert.ok(locale.PF1AE.ScriptApprovals.Title);
  assert.ok(locale.PF1AE.Settings.RangedMelee.Name);
  assert.ok(locale.PF1AE.Settings.RangedMeleePrompt.Name);
 }
 console.log('PASS script-approval-menu: discovery, secure approvals, revocation, trusted read-only, source/identity checks, translations');
})().catch(error=>{console.error(error);process.exitCode=1});
