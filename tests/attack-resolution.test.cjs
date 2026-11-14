'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.resolve(__dirname,'../scripts/attack-resolution.js'),'utf8');
const hooks={ready:[],render:[]};
const api={},actor={id:'attacker',uuid:'Actor.attacker'};
const item={id:'weapon',uuid:'Actor.attacker.Item.weapon',actor,
 flags:{attackDefenseConfig:{atk:'flatFooted'}},getFlag(_ns,key){return this.flags[key]}};
const action={id:'atk',item,actor,actionType:'rwak',hasAttack:true,touch:false,
 isCombatManeuver:false,hasSave:false};
const target={uuid:'Actor.target',system:{attributes:{
 ac:{normal:{total:20},touch:{total:12},flatFooted:{total:18}},
 cmd:{total:23}}}};
const token={uuid:'Scene.scene.Token.target',documentName:'Token',actor:target};
const ctx={console,Map,Set,Number,Promise,game:{user:{isGM:true},
 modules:new Map([['pf1-automation-engine',{active:true,api}]]),
 i18n:{localize:k=>k}},
 pf1:{config:{maneuverActionTypes:new Set(['cmb'])}},
 Hooks:{once:(n,fn)=>{if(n==='ready')hooks.ready.push(fn)},on:(n,fn)=>hooks.render.push(n)}};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'attack-resolution.js'});
for(const fn of hooks.ready)fn();
const ar=api.attackResolution;
const dice=(natural,total)=>({total,dice:[{faces:20,results:[{result:natural,active:true}]}]});
const run=(natural,total,options={})=>ar.resolveAttack({
 actor,item,action,targetActor:target,targetToken:token,roll:dice(natural,total),
 sourceMessageId:'card1',attackIndex:0,concealmentCleared:true,...options});
(async()=>{
 // Native attack type is enough; old stored PF1AE overrides MUST be ignored.
 let r=await run(12,23);
 assert.equal(r.defense.type,'normal');
 assert.equal(r.defense.value,20);
 assert.equal(r.hit,true);
 assert.equal(r.defense.provider,'pf1-native');
 assert.equal(ar.getActionDefenseConfig,undefined);
 assert.equal(ar.classifyAction(action).kind,'attack');
 assert.equal(ar.classifyAction(action).defenseType,'normal');
 assert.equal(ar.setActionDefenseConfig,undefined);
 assert.equal(hooks.render.length,0,'no duplicate selector on native Item sheets');
 assert.equal(item.flags.attackDefenseConfig.atk,'flatFooted','old flags preserved, not applied');
 // Checkbox Contact is authoritative even in presence of external provider.
 action.touch=true;
 assert.equal(ar.classifyAction(action).defenseType,'touch');
 const removeOverride=ar.registerDefenseProvider({id:'wrong-override',priority:900,
  resolve:()=>({type:'normal'})});
 r=await run(9,15);assert.equal(r.defense.type,'touch');assert.equal(r.defense.value,12);
 assert.equal(r.defense.provider,'pf1-native');removeOverride();
 action.touch=false;
 r=await run(9,15,{actionUse:{shared:{touch:true}}});
 assert.equal(r.defense.type,'touch','native ActionUse touch override');
 r=await run(9,15);assert.equal(r.hit,false);
 // Manœuvre offensive targets CMD independently of action name or source Item.
 const trip={id:'trip',item,actor,actionType:'cmb',isCombatManeuver:true,hasAttack:true,hasSave:false};
 assert.equal(ar.classifyAction(trip).defenseType,'cmd');
 r=await run(10,23,{action:trip});assert.equal(r.defense.type,'cmd');assert.equal(r.hit,true);
 const overrideCmd=ar.registerDefenseProvider({id:'touch-exception',priority:100,
  resolve:()=>({type:'touch'})});
 r=await run(10,20,{action:trip});
 assert.equal(r.defense.type,'cmd');assert.equal(r.hit,false);
 overrideCmd();
 // Save only: no AC/CMD comparison; use pre-existing PF1 save pipeline.
 const save={id:'save',item,actor,actionType:'other',hasAttack:false,hasSave:true,
  save:{type:'ref',dc:'18'},isCombatManeuver:false,touch:false};
 assert.equal(ar.classifyAction(save).kind,'save');
 assert.equal(ar.classifyAction(save).saveType,'ref');
 r=await run(20,99,{action:save});
 assert.equal(r.resolution,'pendingSave');assert.equal(r.hit,null);
 assert.equal(r.defense.value,null);assert.equal(r.save.type,'ref');
 const mixed={...action,id:'mixed',hasSave:true,save:{type:'fort',dc:'17'}};
 assert.equal(ar.classifyAction(mixed).kind,'attackAndSave');
 r=await run(11,21,{action:mixed});
 assert.equal(r.defense.type,'normal','attack + save first resolves attack');
 assert.equal(r.resolution,'success');
 // Critical distinction natural 1 vs 20 and total.
 assert.equal((await run(1,99)).hit,false);
 assert.equal((await run(20,2)).hit,true);
 assert.equal((await run(10,19)).hit,false);
 assert.equal((await run(10,20)).hit,true);
 assert.equal((await run(10,21)).hit,true);
 assert.equal((await run(10,20,{concealmentPending:true})).resolution,'pendingConcealment');
 assert.equal((await run(10,20,{concealmentCleared:false})).hit,null);
 assert.equal((await run(10,20,{additionalCheckPending:true})).hit,null);
 assert.equal((await run(10,20,{coverBonus:4})).defense.value,24);
 assert.equal((await run(10,20,{coverBonus:4})).hit,false);
 // Missing actual natural d20, target, defense and total fail closed.
 assert.equal((await ar.resolveAttack({item,actor,action,roll:{total:25},targetActor:target})).resolution,'indeterminate');
 assert.equal((await run(11,25,{targetActor:null,targetToken:null})).hit,null);
 assert.equal((await run(11,25,{targetActor:{system:{attributes:{}}},targetToken:null})).hit,null);
 assert.equal((await run(11,null,{roll:{dice:[{faces:20,results:[{result:11}]}]}})).hit,null);
 assert.equal(ar.getNaturalD20(dice(1,9)),1);
 assert.equal(ar.getNaturalD20({dice:[{faces:20,results:[{result:7},{result:8}]}]}),null);
 // External provider is required for specialized rules, no firearm logic here.
 const stop=ar.registerDefenseProvider({id:'test-external',priority:100,resolve:()=>({
  type:'touch',reason:'special verified external case'})});
 r=await run(10,15);assert.equal(r.defense.provider,'test-external');assert.equal(r.defense.type,'touch');
 const conflict=ar.registerDefenseProvider({id:'test-conflict',priority:100,resolve:()=>({type:'normal'})});
 r=await run(10,15);assert.equal(r.resolution,'indeterminate');assert.match(r.reason,/conflicting providers/);
 conflict();stop();
 const failure=ar.registerDefenseProvider({id:'bad-provider',priority:50,resolve:()=>{throw Error('bad')}}); 
 r=await run(10,15);assert.equal(r.resolution,'indeterminate');assert.match(r.reason,/provider failure/);
 failure();
 const pending=ar.registerDefenseProvider({id:'async-provider',priority:10,resolve:async()=>({type:'flatFooted'})});
 r=await run(10,19);assert.equal(r.defense.type,'flatFooted');pending();
 assert.equal(ar.listDefenseProviders().length,0);
 assert.equal((await run(10,20)).defense.type,'normal');
 // Native values and final target actor survive even for synthetic tokens.
 r=await run(10,21);assert.equal(r.targetTokenUuid,token.uuid);
 assert.equal(r.targetActorUuid,target.uuid);assert.equal(r.attackIndex,0);
 assert.equal(r.sourceMessageId,'card1');
 assert.equal(ar.lastDiagnostic().defense.type,'normal');
 const multi=await Promise.all([run(11,25),run(11,15)]);
 assert.deepEqual(multi.map(x=>x.hit),[true,false]);
 assert.doesNotMatch(src,/gunBullet|Deadeye|misfire|firstRangeIncrement|firearm-first/);
 console.log('PASS attack resolution: native Contact, CMB, save-only, mixed actions, d20, cover, provider conflicts and no duplicate UI');
})().catch(e=>{console.error(e);process.exitCode=1});
