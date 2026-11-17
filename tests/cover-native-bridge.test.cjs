'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const callbacks=new Map(),ready=[],alerts=[],cards=[];
const pf1aeModule={active:true,api:{}};
const scene={id:'s',grid:{type:1,units:'ft'},walls:{contents:[]},tiles:{contents:[]},regions:{contents:[]}};
const tokens=[],system={modules:new Map([['pf1-automation-engine',pf1aeModule]]),
 settings:{get(_n,k){return k==='genericEnabled'?true:'2d'}},
 user:{id:'player',isGM:false,targets:new Set()},
 messages:new Map(),i18n:{localize:k=>k}};
const actor={uuid:'Actor.a',getActiveTokens(){return [attacker]}};
const enemy={uuid:'Actor.b'};
function token(id,x,who){
 const d={uuid:'Scene.s.Token.'+id,id,x,y:0,width:1,height:1,elevation:0,
  parent:{id:'s'}};
 const t={document:d,actor:who,losHeight:5};
 tokens.push(t);return t;
}
const attacker=token('a',0,actor),target=token('b',300,enemy);
const action={actionType:'rwak',hasAttack:true,isCombatManeuver:false,
 getRange({type}){return type==='max'?this.testMaxRange??5:0},
 actor,item:{actor}};
const actionUse={action,actor,token:attacker.document,
 shared:{targets:[target]}};
const native={process:0,dialog:0,ammo:8,magazine:6,posts:0};
class NativeActionUse {
 async process(){
  native.process++;
  native.dialog++;
  native.ammo--;
  native.magazine--;
  native.posts++;
  return {used:true};
 }
}
Object.setPrototypeOf(actionUse,NativeActionUse.prototype);
const ctx={console,game:system,canvas:{scene,grid:{size:100,measurePath([a,b]){
 return {distance:Math.hypot(b.x-a.x,b.y-a.y)/100*5};
 }},tokens:{placeables:tokens}},
 pf1:{settings:{distance:{metric:false}},
  config:{maneuverActionTypes:new Set(['cmb'])},
  actionUse:{ActionUse:NativeActionUse}},
 foundry:{utils:{deepClone:structuredClone}},
 CONST:{WALL_MOVEMENT_TYPES:{NONE:0,NORMAL:20}},
 Hooks:{on(n,fn){callbacks.set(n,fn)},once(n,fn){if(n==='ready')ready.push(fn)}},
 ui:{notifications:{warn(msg){alerts.push(msg)}}},
 Set,Map,Object,Number,Math};
ctx.globalThis=ctx;vm.createContext(ctx);
for(const filename of ['cover-pf1-rules.js','melee-reach.js','cover-native-bridge.js'])
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../scripts/'+filename),'utf8'),
  ctx,{filename});
for(const fn of ready)fn();
const before=callbacks.get('pf1PreActionUse');
const after=callbacks.get('pf1aeAttackResolution');
assert.equal(typeof before,'function');
assert.equal(typeof after,'function');
assert.equal(pf1aeModule.api.coverNativeBridge.earlyGateMode(),'prototype');
assert.equal(before(actionUse),undefined,'empty battlefield does not block');
scene.walls.contents.push({id:'wall',c:[200,-200,200,300],
 uuid:'Scene.s.Wall.w',move:20,door:0,ds:0});
const diagnosis=pf1aeModule.api.coverNativeBridge.preview(actionUse);
assert.equal(diagnosis?.status,'confirmed');
assert.equal(diagnosis?.type,'total');
assert.equal(diagnosis?.preventsDirectAttack,true);
assert.equal(before(actionUse),false,'PF1 cancellable pre-use hook blocks total cover');
assert.equal(alerts.length,1);
scene.walls.contents[0].move=1;
assert.notEqual(before(actionUse),false,
 'legacy movement value must not cancel an attack on uncertain geometry');
scene.walls.contents[0].move=20;
assert.equal(before(actionUse),false,
 'native Foundry 13 wall movement value blocks again');
scene.walls.contents[0].ds=1;scene.walls.contents[0].door=1;
assert.equal(before(actionUse),undefined,'open door does not block');
scene.walls.contents[0].door=0;scene.walls.contents[0].ds=0;
const otherTarget=token('c',400,{uuid:'Actor.c'});
actionUse.shared.targets.push(otherTarget);
assert.equal(before(actionUse),undefined,'multiple targets never blocked globally');
actionUse.shared.targets.pop();
tokens.splice(tokens.indexOf(otherTarget),1);
actionUse.shared.targets=[];
scene.walls.contents[0].door=0;
scene.walls.contents[0].ds=0;
system.user.targets.add(target);
assert.equal(before(actionUse),false,'single active target is supported when action targets missing');
system.user.targets.clear();
scene.walls.contents[0].c=[200,0,200,10];
assert.notEqual(before(actionUse),false,'uncertain/partial wall is not cancelled');
scene.walls.contents.length=0;
const card={id:'message',documentName:'ChatMessage',user:{id:'player'},
 content:'<article class="pf1-chat">PF1 native attack card</article>',
 async update(value){this.content=value.content;cards.push(value.content)}};
system.messages.set('message',card);
const base={sourceMessageId:'message',targetResults:[{targetTokenUuid:target.document.uuid,
 coverDiagnosis:{status:'confirmed',type:'normal',acBonus:4},
 defense:{baseValue:17,value:21,coverBonus:4}}]};
const html=pf1aeModule.api.coverNativeBridge.cardSection(base);
assert.ok(html.includes('21'));
assert.ok(html.includes('17'));
after(base);
(async()=>{
 // Native ActionUse.process must be short-circuited before ANY dialog,
 // ammo/magazine consumption, native roll or message.
 scene.walls.contents.push({id:'blocked',c:[200,-200,200,300],
  uuid:'Scene.s.Wall.early',move:20,door:0,ds:0});
 actionUse.shared.targets=[target];
 system.user.targets.add(target);
 const initial={...native};
 assert.equal(await actionUse.process(),undefined,
  'total-cover interception returns native cancellation shape');
 assert.deepEqual(native,initial,
  'no native processing, modifier dialog, ammo, magazine or message');
 assert.equal(alerts.length,4,'one early cancellation warning');
 // Open door lets native pipeline execute normally and consume one shot.
 scene.walls.contents[0].door=1;
 scene.walls.contents[0].ds=1;
 assert.deepEqual(await actionUse.process(),{used:true});
 assert.equal(native.process,1);
 assert.equal(native.dialog,1);
 assert.equal(native.ammo,initial.ammo-1);
 assert.equal(native.magazine,initial.magazine-1);
 assert.equal(native.posts,1);
 // Multi-target and uncertain geometry also retain native behavior.
 scene.walls.contents[0].door=0;
 scene.walls.contents[0].ds=0;
 actionUse.shared.targets=[target,{document:{
  id:'third',uuid:'Scene.s.Token.third',parent:{id:'s'},
  x:400,y:0,width:1,height:1,elevation:0},actor:{uuid:'Actor.third'}}];
 assert.deepEqual(await actionUse.process(),{used:true});
 assert.equal(native.process,2);
 actionUse.shared.targets=[target];
 scene.walls.contents[0].move=1;
 assert.deepEqual(await actionUse.process(),{used:true});
 assert.equal(native.process,3);
 scene.walls.contents.length=0;
 system.user.targets.clear();
 // Melee max-range gate is before the native modifier dialog and resources.
 action.actionType='mwak';
 action.testMaxRange=5;
 actionUse.shared.targets=[target];
 const meleeInitial={...native};
 const reachApi=pf1aeModule.api.meleeReach;
 let reach=reachApi.inspectActionUse(actionUse);
 assert.equal(reach.status,'out-of-reach');
 assert.equal(reach.distance,15);
 assert.equal(reach.maximumReach,5);
 assert.equal(await actionUse.process(),undefined);
 assert.deepEqual(native,meleeInitial,
  'out-of-reach melee spends no charges or ammo and opens no dialog');
 assert.equal(before(actionUse),false,
  'native pre-use remains a secondary melee reach safety gate');
 // Adjacent, normal reach and action-specific polearm reach.
 target.document.x=100;
 assert.equal(reachApi.inspectActionUse(actionUse).status,'in-reach');
 assert.deepEqual(await actionUse.process(),{used:true});
 target.document.x=200;
 action.testMaxRange=10;
 assert.equal(reachApi.inspectActionUse(actionUse).status,'in-reach');
 assert.deepEqual(await actionUse.process(),{used:true});
 action.testMaxRange=5;
 assert.equal(reachApi.inspectActionUse(actionUse).status,'out-of-reach');
 const snapshot={...native};
 assert.equal(await actionUse.process(),undefined);
 assert.deepEqual(native,snapshot);
 // Check closest square, not center, for Large rectangular targets.
 target.document.x=100;
 target.document.width=3;
 assert.equal(reachApi.inspectActionUse(actionUse).status,'in-reach');
 assert.deepEqual(await actionUse.process(),{used:true});
 target.document.width=1;
 target.document.x=300;
 // Different elevations, missing range and multiple targets must not block.
 target.document.elevation=10;
 assert.equal(reachApi.inspectActionUse(actionUse).status,'uncertain');
 assert.deepEqual(await actionUse.process(),{used:true});
 target.document.elevation=0;
 action.testMaxRange=null;
 action.getRange=()=>null;
 assert.equal(reachApi.inspectActionUse(actionUse).status,'uncertain');
 assert.deepEqual(await actionUse.process(),{used:true});
 action.getRange=({type})=>type==='max'?5:0;
 actionUse.shared.targets=[target,{...target,document:{...target.document,
  uuid:'Scene.s.Token.extra',id:'extra'},actor:{uuid:'Actor.other'}}];
 assert.equal(reachApi.inspectActionUse(actionUse).status,'uncertain');
 assert.deepEqual(await actionUse.process(),{used:true});
 // Only the requested single-target melee action is gated.
 actionUse.shared.targets=[target];
 action.actionType='rwak';
 assert.equal(reachApi.inspectActionUse(actionUse).status,'uncertain');
 assert.deepEqual(await actionUse.process(),{used:true});
 action.actionType='mwak';
 // Generic ranged spells and abilities use their PF1-native maximum range.
 const actionRange=pf1aeModule.api.actionRange;
 target.document.x=300;
 action.actionType='save';
 action.hasAttack=false;
 action.hasRange=true;
 action.hasTemplate=false;
 action.getRange=({type})=>type==='max'?10:0;
 const beforeSpell={...native};
 assert.equal(actionRange.inspectActionUse(actionUse).status,'out-of-range');
 assert.equal(await actionUse.process(),undefined,
  'targeted spell outside 10 ft is rejected before native processing');
 assert.deepEqual(native,beforeSpell,
  'rejected spell spends no slots/charges and posts no card');
 assert.equal(before(actionUse),false,'late safety gate also rejects distant spells');
 target.document.x=200;
 assert.equal(actionRange.inspectActionUse(actionUse).status,'in-range');
 assert.deepEqual(await actionUse.process(),{used:true},
  'targeted spell at exactly maximum range proceeds');
 target.document.x=300;
 action.actionType='ability';
 action.getRange=({type})=>type==='max'?20:0;
 assert.equal(actionRange.inspectActionUse(actionUse).status,'in-range');
 assert.deepEqual(await actionUse.process(),{used:true},
  'ability with its own larger maximum range proceeds');
 action.actionType='rwak';
 action.hasAttack=true;
 action.getRange=({type})=>type==='max'?10:0;
 const priorRanged={...native};
 assert.equal(actionRange.inspectActionUse(actionUse).status,'out-of-range');
 assert.equal(await actionUse.process(),undefined,
  'ranged weapon outside full native maximum distance is rejected');
 assert.deepEqual(native,priorRanged,'out of range does not consume ammunition');
 // Personal, template, and unbounded/unknown ranges cannot be inferred.
 action.actionType='save';
 action.hasAttack=false;
 action.hasRange=false;
 assert.equal(actionRange.inspectActionUse(actionUse).status,'uncertain');
 assert.deepEqual(await actionUse.process(),{used:true},
  'personal/non-ranged action is never cancelled by target proximity');
 action.hasRange=true;
 action.hasTemplate=true;
 assert.equal(actionRange.inspectActionUse(actionUse).status,'uncertain');
 assert.deepEqual(await actionUse.process(),{used:true},
  'template location is not interchangeable with selected token');
 action.hasTemplate=false;
 action.getRange=()=>Infinity;
 assert.equal(actionRange.inspectActionUse(actionUse).status,'uncertain');
 assert.deepEqual(await actionUse.process(),{used:true},
  'unbounded action range remains unrestricted');
 action.actionType='mwak';
 action.hasAttack=true;
 action.hasRange=false;
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cards.length,1);
 assert.ok(card.content.startsWith('<article class="pf1-chat">'));
 assert.ok(card.content.includes('data-pf1ae-cover="1"'));
 assert.ok(card.content.includes('21'));
 after(base);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cards.length,1,'do not append duplicate annotations');
 const total={...base,targetResults:[{targetTokenUuid:target.document.uuid,
  coverDiagnosis:{status:'confirmed',type:'total',
   preventsDirectAttack:true},defense:{baseValue:17,value:null}}]};
 assert.ok(pf1aeModule.api.coverNativeBridge.cardSection(total).includes('PF1AE.Cover.TotalCardWarning'));
 assert.equal(pf1aeModule.api.coverNativeBridge.cardSection({
  ...base,targetResults:[{...base.targetResults[0],
   coverDiagnosis:{status:'uncertain'}}]}),null);
 assert.equal(actor.uuid,'Actor.a');
 console.log('PASS native cover bridge and universal action range: melee, targeted spells, abilities, ranged weapons, template safety, no resource usage');
})().catch(error=>{console.error(error);process.exitCode=1});
