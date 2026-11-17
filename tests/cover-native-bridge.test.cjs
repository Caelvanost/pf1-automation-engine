'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const callbacks=new Map(),ready=[],alerts=[],cards=[];
const pf1aeModule={active:true,api:{}};
const scene={id:'s',grid:{type:1},walls:{contents:[]},tiles:{contents:[]},regions:{contents:[]}};
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
const ctx={console,game:system,canvas:{scene,grid:{size:100},tokens:{placeables:tokens}},
 pf1:{config:{maneuverActionTypes:new Set(['cmb'])},
  actionUse:{ActionUse:NativeActionUse}},
 foundry:{utils:{deepClone:structuredClone}},
 CONST:{WALL_MOVEMENT_TYPES:{NONE:0,NORMAL:20}},
 Hooks:{on(n,fn){callbacks.set(n,fn)},once(n,fn){if(n==='ready')ready.push(fn)}},
 ui:{notifications:{warn(msg){alerts.push(msg)}}},
 Set,Map,Object,Number,Math};
ctx.globalThis=ctx;vm.createContext(ctx);
for(const filename of ['cover-pf1-rules.js','cover-native-bridge.js'])
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
 console.log('PASS native cover bridge: early process cancellation with no dialog/ammo/magazine, native fallback, multi-target safety, card annotation');
})().catch(error=>{console.error(error);process.exitCode=1});
