const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const OLD='pf1-combat-automation';
const NEW='pf1-automation-engine';
const callbacks=new Map();
const Hooks={once(name,cb){(callbacks.get(name)||callbacks.set(name,[]).get(name)).push(cb);}};
const memory=new Map();
const settings=new Map();
function oldSetting(key,value){memory.set(`${OLD}.${key}`,JSON.stringify(value));}
const gameSettings={
  storage:new Map([['world',{getItem:key=>memory.get(key)??null}]]),
  register(ns,key,def){settings.set(`${ns}.${key}`,structuredClone(def.default));},
  get(ns,key){return settings.get(`${ns}.${key}`)},
  async set(ns,key,value){settings.set(`${ns}.${key}`,structuredClone(value));memory.set(`${ns}.${key}`,JSON.stringify(value));}
};
const docs=[];
const makeDoc=(uuid,flags={})=>{
  const doc={uuid,flags:structuredClone(flags),updates:0,async update(data,opts){
    assert.equal(opts[NEW].skip,true);
    assert(data[`flags.${NEW}`]);
    this.flags[NEW]=structuredClone(data[`flags.${NEW}`]);this.updates++;
  }};
  docs.push(doc);return doc;
};
const item=makeDoc('Actor.A.Item.1',{[OLD]:{automations:[{id:'a',on:'ready'}],tags:['test']}});
const effect=makeDoc('Actor.A.ActiveEffect.E',{[OLD]:{managed:true,sessionId:'old-session'}});
const actor=makeDoc('Actor.A',{[OLD]:{managedEffects:[{key:'timed',sessionId:'old-session'}]}});
actor.items=[item];actor.effects=[effect];
const synthetic=makeDoc('Scene.S.Token.T.Actor',{[OLD]:{managedEffects:[{key:'unlinked'}]}});
synthetic.items=[makeDoc('Scene.S.Token.T.Actor.Item.I',{[OLD]:{automations:[{id:'s',on:'ready'}]}})];synthetic.effects=[];
const modules=new Map([[NEW,{id:NEW,active:true,api:{}}]]);
const macro={id:'macro1',type:'script',command:`const api = game.modules.get('${OLD}').api.generic;\nawait actor.setFlag('${OLD}', 'tags', []);`,
  async update(data){this.command=data.command;this.updated=true;}};
const users=[{id:'GM',active:true,isGM:true}];
const game={modules,users,user:users[0],settings:gameSettings,items:[],actors:[actor],scenes:[{tokens:[{uuid:'Scene.S.Token.T',actorLink:false,actor:synthetic,flags:{},update:async()=>{}}]}],macros:[macro]};
const sandbox={Hooks,game,console,ui:{notifications:{info(){},error(){}}},foundry:{utils:{deepClone:structuredClone,mergeObject:(oldValue,newValue)=>({...oldValue,...newValue})}}};
const source=fs.readFileSync(path.join(__dirname,'../scripts/module-migration.js'),'utf8');
vm.runInNewContext(source,sandbox,{filename:'module-migration.js'});
(async()=>{
  oldSetting('genericEnabled',false);
  oldSetting('eventRegistry',[{id:'resource-watch',on:'updateItem'}]);
  oldSetting('timerRegistry',[{id:'expiry-1',unit:'rounds',amount:2}]);
  oldSetting('autoApprovals',{'Actor.A.Item.1':'snapshot'});
  for(const cb of callbacks.get('init')) await cb();
  assert.equal(settings.get(`${NEW}.namespaceMigrationVersion`),0);
  const result=await modules.get(NEW).api.migration.whenReady();
  assert.equal(result.settings,4);
  assert.equal(result.documents,5);
  assert.equal(result.macros,1);
  assert.equal(settings.get(`${NEW}.genericEnabled`),false);
  assert.equal(settings.get(`${NEW}.eventRegistry`)[0].id,'resource-watch');
  assert.deepEqual(item.flags[NEW].tags,['test']);
  assert.equal(actor.flags[NEW].managedEffects[0].sessionId,'old-session');
  assert.equal(effect.flags[NEW].managed,true);
  assert(synthetic.flags[NEW].managedEffects.length);
  assert.equal(settings.get(`${NEW}.namespaceMigrationVersion`),1);
  assert.equal(memory.get(`${OLD}.genericEnabled`),'false','legacy values retained');
  assert(macro.command.includes(`game.modules.get('${NEW}')`));
  assert(macro.command.includes(`actor.setFlag('${NEW}'`));
  const backup=settings.get(`${NEW}.legacyMacroBackups`);
  assert(backup.macro1.includes(`${OLD}`));
  const second=await modules.get(NEW).api.migration.whenReady();
  assert.equal(second,result,'idempotence in same session');
  assert.equal(item.updates,1);
  console.log('PASS: new namespace; settings incl false; item/actor/effect/synthetic flags; macro backups; idempotence');
})().catch(e=>{console.error(e);process.exit(1)});
