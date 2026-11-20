'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const callbacks=new Map(),ready=[],init=[],alerts=[],cards=[];
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
 async createAttackDialog(){ native.dialog++;return {}; }
 async process(){
  // PF1 11.11's hook occurs INSIDE process, before createAttackDialog.
  callbacks.get('pf1CreateActionUse')?.(this);
  const form=await this.createAttackDialog();
  if(!form)return undefined;
  native.process++;
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
 Hooks:{on(n,fn){callbacks.set(n,fn)},once(n,fn){if(n==='ready')ready.push(fn);else if(n==='init')init.push(fn)}},
 ui:{notifications:{warn(msg){alerts.push(msg)}}},
 Set,Map,Object,Number,Math};
ctx.globalThis=ctx;vm.createContext(ctx);
for(const filename of ['cover-pf1-rules.js','melee-reach.js','cover-native-bridge.js'])
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../scripts/'+filename),'utf8'),
  ctx,{filename});
for(const fn of init)fn();
for(const fn of ready)fn();
assert.equal(typeof callbacks.get('pf1CreateActionUse'),'function');
const before=callbacks.get('pf1PreActionUse');
const after=callbacks.get('pf1aeAttackResolution');
assert.equal(typeof before,'function');
assert.equal(typeof after,'function');
assert.equal(pf1aeModule.api.coverNativeBridge.earlyGateMode(),'native-dialog-hook');
const originalPrototypeProcess=NativeActionUse.prototype.process;
const originalPrototypeDialog=NativeActionUse.prototype.createAttackDialog;
callbacks.get('pf1CreateActionUse')(actionUse);
assert.equal(NativeActionUse.prototype.process,originalPrototypeProcess,
 'the native ActionUse process prototype must never be modified');
assert.equal(NativeActionUse.prototype.createAttackDialog,originalPrototypeDialog,
 'the native ActionUse dialog prototype must never be modified');
const onceGuard=actionUse.createAttackDialog;
callbacks.get('pf1CreateActionUse')(actionUse);
assert.equal(actionUse.createAttackDialog,onceGuard,'dialog guard is idempotent');
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
const base={sourceMessageId:'message',rollIndex:0,targetResults:[{targetTokenUuid:target.document.uuid,
 coverDiagnosis:{status:'confirmed',type:'normal',acBonus:4},
 defense:{baseValue:17,value:21,coverBonus:4}}]};
const html=pf1aeModule.api.coverNativeBridge.cardSection(base);
assert.ok(html.includes('21'));
assert.ok(html.includes('17'));
// PF1 11.x native target thumbnail: only the correct target's NORMAL
// shield is updated; touch and flat-footed 13, and other targets, stay.
const nativeThumbnail='<div class="attack-targets">'+
 '<div class="target" data-uuid="'+target.document.uuid+'">'+
 '<img class="target-image" src="harpy.webp">'+
 '<div class="ac"><div class="normal" data-tooltip="PF1.ACNormal">'+
 '<i class="fa-solid fa-shield-alt" inert></i><span class="value">17</span></div>'+
 '<div class="touch"><i class="fa-solid fa-hand-point-up"></i>'+
 '<span class="value">13</span></div>'+
 '<div class="flatFooted"><span class="value">13</span></div></div></div>'+
 '<div class="target" data-uuid="Scene.s.Token.else">'+
 '<div class="ac"><div class="normal"><span class="value">17</span>'+
 '</div></div></div></div>';
const patch=pf1aeModule.api.coverNativeBridge.patchTargetAC;
const altered=patch(nativeThumbnail,base);
assert.ok(altered.includes('data-pf1ae-cover-native-ac="17"'));
assert.ok(altered.includes('title="AC with cover: 21"'));
assert.equal((altered.match(/>21<\/span>/g)??[]).length,1);
assert.equal((altered.match(/>13<\/span>/g)??[]).length,2);
assert.equal((altered.match(/>17<\/span>/g)??[]).length,1,
 'another target with same AC must stay unchanged');
assert.equal(patch(altered,base),altered,
 'already adjusted target thumbnail cannot be modified again');
 // In native PF1 the same cover applies to normal, touch and flat-footed.
 // Harpy 16 / 13 / 13 against +4 normal cover => 20 / 17 / 17.
 const priorSystem=target.actor.system;
 const priorCoverApi=pf1aeModule.api.nativeCover;
 target.actor.system={attributes:{ac:{
  normal:{total:16},touch:{total:13},flatFooted:{total:13}
 }}};
 pf1aeModule.api.nativeCover={inspect:({defense})=>({
  status:'resolved',nativeCover:0,defense
 })};
 const harpyThumbnail=nativeThumbnail.replace(
  '<span class="value">17</span></div><div class="touch">',
  '<span class="value">16</span></div><div class="touch">');
 const harpyEvent={...base,targetResults:[{
  ...base.targetResults[0],
  defense:{baseValue:16,value:20,coverBonus:4,type:'normal'}
 }]};
 const harpyAdjusted=patch(harpyThumbnail,harpyEvent);
 assert.ok(harpyAdjusted.includes('data-pf1ae-cover-native-ac="16"'));
 assert.equal((harpyAdjusted.match(/>20<\/span>/g)??[]).length,1);
 assert.equal((harpyAdjusted.match(/>17<\/span>/g)??[]).length,3,
  'touch and flat-footed both become 17, plus unrelated target 17');
 assert.equal(patch(harpyAdjusted,harpyEvent),harpyAdjusted,
  'all three adjusted values remain stable after second render');
 // Explicitly graded partial and improved cover use the same native
 // thumbnail positions without modifying the actor's baseline CA.
 for(const [coverType,bonus,normal,touch] of [
  ['partial',2,18,15],['improved',8,24,21]
 ]){
  const classified={...harpyEvent,targetResults:[{
   ...harpyEvent.targetResults[0],
   coverDiagnosis:{status:'confirmed',type:coverType,acBonus:bonus},
   defense:{baseValue:16,value:normal,coverBonus:bonus,type:'normal'}
  }]};
  const classifiedHtml=patch(harpyThumbnail,classified);
  assert.ok(classifiedHtml.includes('title="AC with cover: '+normal+'"'),
   coverType+': standard CA in target thumbnail');
  assert.equal((classifiedHtml.match(new RegExp('>'+touch+'<\\/span>','g'))??[]).length,2,
   coverType+': touch and flat-footed CA both updated');
  assert.equal(patch(classifiedHtml,classified),classifiedHtml,
   coverType+': repeated attack hook does not double cover');
 }

 // Existing +4 typed cover on touch but not normal/flatFooted: touch
 // must stay native 13 while the other two receive their missing +4.
 pf1aeModule.api.nativeCover={inspect:({defense})=>({
  status:'resolved',nativeCover:defense==='touch'?4:0,defense
 })};
 const byType=patch(harpyThumbnail,harpyEvent);
 assert.equal((byType.match(/>17<\/span>/g)??[]).length,2,
  'flat-footed changes, touch already contains its cover and remains 13');
 assert.ok(byType.includes('<div class="touch"><i class="fa-solid fa-hand-point-up"></i><span class="value">13</span>'));
 // If one native cover source is ambiguous, leave only that single AC
 // figure unchanged; other verified defenses can still be displayed.
 pf1aeModule.api.nativeCover={inspect:({defense})=>
  defense==='touch'?{status:'uncertain'}:
  {status:'resolved',nativeCover:0}
 };
 const partial=patch(harpyThumbnail,harpyEvent);
 assert.equal((partial.match(/>17<\/span>/g)??[]).length,2);
 assert.ok(partial.includes('<div class="touch"><i class="fa-solid fa-hand-point-up"></i><span class="value">13</span>'));
 target.actor.system=priorSystem;
 pf1aeModule.api.nativeCover=priorCoverApi;

assert.equal(patch(nativeThumbnail,{...base,rollIndex:1}),nativeThumbnail,
 'different full-attack rolls cannot overwrite summary thumbnail');
const wrongDef={...base,targetResults:[{...base.targetResults[0],
 defense:{baseValue:18,value:22,coverBonus:4}}]};
assert.equal(patch(nativeThumbnail,wrongDef),nativeThumbnail,
 'must not replace native AC when the baseline differs');
const unknown={...base,targetResults:[{...base.targetResults[0],
 defense:{baseValue:17,value:null,coverBonus:4}}]};
assert.equal(patch(nativeThumbnail,unknown),nativeThumbnail,
 'unknown effective AC cannot overwrite shield');
const noCover={...base,targetResults:[{...base.targetResults[0],
 coverDiagnosis:{status:'uncertain',reason:'unknown-geometry'}}]};
assert.equal(patch(nativeThumbnail,noCover),nativeThumbnail,
 'unverified cover cannot overwrite shield');
// Update the persisted native message itself, not only the visible DOM.
const thumbnailCard={id:'thumbnail-card',documentName:'ChatMessage',
 user:{id:'player'},content:nativeThumbnail,updates:0,
 async update({content}){this.content=content;this.updates++}};
system.messages.set(thumbnailCard.id,thumbnailCard);
const thumbnailEvent={...base,sourceMessageId:thumbnailCard.id};
after(thumbnailEvent);
after(base);
(async()=>{
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(thumbnailCard.updates,1);
 assert.ok(thumbnailCard.content.includes('title="AC with cover: 21"'));
 assert.ok(!thumbnailCard.content.includes('pf1ae-cover-result'),
  'cover must be shown only in the native target thumbnail');
 after(thumbnailEvent);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(thumbnailCard.updates,1,
  'repeated event does not produce a second write or footer');
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
 const reachApi=pf1aeModule.api.meleeReach;
 // Zether's rapier regression: native melee range is 1.5 on a metric
 // scene, regardless of a missing/false PF1 global metric preference.
 const previousUnits=scene.grid.units;
 const previousGridDistance=scene.grid.distance;
 const previousMeasure=ctx.canvas.grid.measurePath;
 const previousMetric=ctx.pf1.settings.distance.metric;
 const previousRange=action.range;
 const previousGetRange=action.getRange;
 scene.grid.units='m';
 scene.grid.distance=1.5;
 ctx.canvas.grid.measurePath=([a,b])=>({
  distance:Math.hypot(b.x-a.x,b.y-a.y)/100*1.5
 });
 ctx.pf1.settings.distance.metric=undefined;
 action.range={value:0,units:'melee'};
 action.getRange=({type})=>type==='max'?1.5:0;
 target.document.x=100;
 let rapier=reachApi.inspectActionUse(actionUse);
 assert.equal(rapier.status,'in-reach',
  'rapier adjacent at 1.5 m must be allowed');
 assert.equal(rapier.maximumReach,1.5,
  'native melee 1.5 must not be interpreted as feet');
 assert.equal(rapier.rangeUnit,'m');
 assert.deepEqual(await actionUse.process(),{used:true},
  'rapier at 1.5 m must open native dialog and proceed');
 target.document.x=200;
 rapier=reachApi.inspectActionUse(actionUse);
 assert.equal(rapier.status,'out-of-reach',
  'rapier at 3 m must remain outside normal reach');
 const rapierSnapshot={...native};
 assert.equal(await actionUse.process(),undefined,
  'out-of-reach rapier must cancel before native dialog');
 assert.deepEqual(native,rapierSnapshot);
 // Different-elevation melee: x/y adjacent (1.5 m), but 2 m apart
 // vertically is OUT of a 1.5 m reach. Block before native dialog.
 target.document.x=100;
 attacker.document.elevation=2;
 let elevated=reachApi.inspectActionUse(actionUse);
 assert.equal(elevated.status,'out-of-reach',
  '1.5 m reach cannot strike adjacent target 2 m below');
 assert.equal(elevated.horizontalDistance,1.5);
 assert.equal(elevated.verticalDistance,2);
 assert.equal(elevated.distance,2,'conservative lower bound is sufficient');
 const elevatedNative={...native};
 assert.equal(await actionUse.process(),undefined,
  'vertical out-of-reach cancels before dialog, rolls and ammo');
 assert.deepEqual(native,elevatedNative);
 // PF1 first vertical diagonal is one square: adjacent and 1.5 m above
 // is still within one-square reach (no Euclidean overblocking).
 attacker.document.elevation=1.5;
 elevated=reachApi.inspectActionUse(actionUse);
 assert.equal(elevated.status,'in-reach');
 assert.equal(elevated.distance,1.5);
 assert.equal(elevated.distanceMode,'pf1-3d-grid');
 assert.deepEqual(await actionUse.process(),{used:true});
 // Two vertical diagonals count as 1+2 squares: 4.5 m instead of 3.
 action.getRange=({type})=>type==='max'?3:0;
 attacker.document.elevation=3;
 target.document.x=200;
 elevated=reachApi.inspectActionUse(actionUse);
 assert.equal(elevated.horizontalDistance,3);
 assert.equal(elevated.verticalDistance,3);
 assert.equal(elevated.distance,4.5);
 assert.equal(elevated.distanceMode,'pf1-3d-grid');
 assert.equal(elevated.status,'out-of-reach');
 const diagonalNative={...native};
 assert.equal(await actionUse.process(),undefined);
 assert.deepEqual(native,diagonalNative);
 // Non-grid-aligned heights use a safe lower bound rather than a
 // wrongly quantized diagonal: 0.75m height and 1.5m adjacent is legal.
 target.document.x=100;
 attacker.document.elevation=0.75;
 action.getRange=({type})=>type==='max'?1.5:0;
 elevated=reachApi.inspectActionUse(actionUse);
 assert.equal(elevated.status,'in-reach');
 assert.equal(elevated.distanceMode,'3d-lower-bound');
 // Missing elevation must stay uncertain and never forcibly cancel.
 attacker.document.elevation=NaN;
 assert.equal(reachApi.inspectActionUse(actionUse).status,'uncertain');
 attacker.document.elevation=0;
 target.document.x=200;
 action.getRange=({type})=>type==='max'?1.5:0;
 scene.grid.units=previousUnits;
 ctx.canvas.grid.measurePath=previousMeasure;
 if(previousGridDistance===undefined)delete scene.grid.distance;
 else scene.grid.distance=previousGridDistance;
 ctx.pf1.settings.distance.metric=previousMetric;
 action.range=previousRange;
 action.getRange=previousGetRange;
 target.document.x=300;
 const meleeInitial={...native};
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
 // Elevation exceeding reach must now block; unverifiable native
 // range and multiple targets still never block.
 target.document.elevation=10;
 assert.equal(reachApi.inspectActionUse(actionUse).status,'out-of-reach');
 const elevatedAgain={...native};
 assert.equal(await actionUse.process(),undefined);
 assert.deepEqual(native,elevatedAgain);
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
 // Mixed units regression: Cold Blast is explicitly 30 ft, while the
 // scene is metric and PF1 getRange may return a system-converted value.
 const oldMeasure=ctx.canvas.grid.measurePath;
 const oldSceneUnit=scene.grid.units;
 const oldMetric=ctx.pf1.settings.distance.metric;
 scene.grid.units='m';
 ctx.canvas.grid.measurePath=([a,b])=>({
  distance:Math.hypot(b.x-a.x,b.y-a.y)/100*1.5
 });
 ctx.pf1.settings.distance.metric=true;
 action.actionType='save';
 action.hasAttack=false;
 action.hasRange=true;
 action.hasTemplate=false;
 action.range={value:30,units:'ft'};
 action.getRange=({type})=>type==='max'?9:0;
 target.document.x=500; // five 1.5 m squares = 7.5 m.
 let metric=actionRange.inspectActionUse(actionUse);
 assert.equal(metric.status,'in-range','30 ft reaches 7.5 m');
 assert.equal(metric.maximumReach,9);
 assert.equal(metric.rangeUnit,'ft');
 assert.equal(metric.source,'action.range.value');
 assert.deepEqual(await actionUse.process(),{used:true});
 target.document.x=600; // exactly 9 m.
 assert.equal(actionRange.inspectActionUse(actionUse).status,'in-range',
  '30 ft includes its exact 9 m boundary');
 // Cold Blast still uses declared ft units, but vertical difference also
 // matters. A target 2m horizontally / 10m vertically is over 30ft.
 target.document.x=100;
 target.document.elevation=10;
 const coldVertical=actionRange.inspectActionUse(actionUse);
 assert.equal(coldVertical.status,'out-of-range');
 assert.equal(coldVertical.maximumReach,9);
 assert.equal(coldVertical.verticalDistance,10);
 const coldVerticalNative={...native};
 assert.equal(await actionUse.process(),undefined);
 assert.deepEqual(native,coldVerticalNative);
 target.document.elevation=0;
 target.document.x=700; // 10.5 m, outside 30 ft.
 const coldSnapshot={...native};
 metric=actionRange.inspectActionUse(actionUse);
 assert.equal(metric.status,'out-of-range');
 assert.equal(metric.maximumReach,9);
 assert.equal(await actionUse.process(),undefined);
 assert.deepEqual(native,coldSnapshot,
  'out-of-range metric scene spell does not spend resources');
 ctx.pf1.settings.distance.metric=false;
 assert.equal(actionRange.inspectActionUse(actionUse).maximumReach,9,
  'literal feet must not depend on global system preference');
 // Inverse conversion: a 9 m action on a scene measured in feet.
 scene.grid.units='ft';
 ctx.canvas.grid.measurePath=oldMeasure;
 action.range={value:'9',units:'m'};
 target.document.x=500; // 25 ft; 9 m = 30 ft PF1.
 assert.equal(actionRange.inspectActionUse(actionUse).status,'in-range');
 target.document.x=700; // 35 ft.
 assert.equal(actionRange.inspectActionUse(actionUse).status,'out-of-range');
 // Range increments still represent total ranged-weapon maximum.
 scene.grid.units='m';
 ctx.canvas.grid.measurePath=([a,b])=>({
  distance:Math.hypot(b.x-a.x,b.y-a.y)/100*1.5
 });
 action.actionType='rwak';
 action.hasAttack=true;
 action.isRanged=true;
 action.range={value:20,units:'ft',maxIncrements:5};
 target.document.x=1000; // 15m < 100ft = 30m.
 assert.equal(actionRange.inspectActionUse(actionUse).maximumReach,30);
 assert.equal(actionRange.inspectActionUse(actionUse).status,'in-range');
 action.range.maxIncrements=null;
 assert.equal(actionRange.inspectActionUse(actionUse).status,'uncertain',
  'unknown weapon increment count must never cancel');
 ctx.canvas.grid.measurePath=oldMeasure;
 scene.grid.units=oldSceneUnit;
 ctx.pf1.settings.distance.metric=oldMetric;
 action.range=undefined;
 action.isRanged=false;
 action.actionType='mwak';
 action.hasAttack=true;
 action.hasRange=false;
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cards.length,0,
  'cards without a native target miniature must not gain a footer');
 assert.equal(card.content,'<article class="pf1-chat">PF1 native attack card</article>');
 after(base);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cards.length,0,'repeated cover event must not add footers');
 // Attack 2 from the same full attack must append its own effective CA.
 const second={...base,rollIndex:1,targetResults:[{
  ...base.targetResults[0],
  defense:{baseValue:18,value:22,coverBonus:4}
 }]};
 after(second);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cards.length,0,
  'later full-attack results do not append redundant footer sections');
 after(second);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cards.length,0,'duplicate attack 2 event is a no-op');
 // Two events dispatched back-to-back must serialize message updates.
 const third={...base,rollIndex:2,targetResults:[{
  ...base.targetResults[0],
  defense:{baseValue:19,value:23,coverBonus:4}
 }]};
 const fourth={...base,rollIndex:3,targetResults:[{
  ...base.targetResults[0],
  defense:{baseValue:20,value:24,coverBonus:4}
 }]};
 after(third);after(fourth);
 await new Promise(resolve=>setImmediate(resolve));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cards.length,0,
  'concurrent cover events do not append any chat-footer sections');
 // Native typed +4 already incorporated: show the original effective AC,
 // explain the existing cover instead of adding another 4.
 const already={...base,rollIndex:4,targetResults:[{
  ...base.targetResults[0],
  defense:{baseValue:24,value:24,coverBonus:0}
 }]};
 assert.ok(pf1aeModule.api.coverNativeBridge.cardSection(already)
  .includes('Already included in native AC'));
 // Unknown native provenance must not invent a final AC.
 const unverified={...base,rollIndex:5,targetResults:[{
  ...base.targetResults[0],defense:{baseValue:20,value:null,coverBonus:4}
 }]};
 const unverifiedHtml=pf1aeModule.api.coverNativeBridge.cardSection(unverified);
 assert.ok(unverifiedHtml.includes('Unverified (GM review)'));
 assert.ok(!unverifiedHtml.includes('Target AC incl. cover: 24'));
 const scenario={...base,rollIndex:6,targetResults:[{
  ...base.targetResults[0],
  coverDiagnosis:{status:'confirmed',type:'normal',acBonus:4},
  defense:{baseValue:16,value:null,coverBonus:4,uncertain:true,
   nativeCoverProvenance:{status:'uncertain',reason:'untyped-or-unclassified-native-ac-source'}}
 }]};
 const preview=pf1aeModule.api.coverNativeBridge.cardSection(scenario);
 assert.ok(preview.includes('Indicative AC with cover: 20'));
 assert.ok(preview.includes('Native AC: 16'));
 assert.ok(preview.includes('Cover bonus: +4'));
 assert.ok(preview.includes('Not verified:'));
 assert.ok(!preview.includes('Target AC incl. cover: 20'));

 const total={...base,targetResults:[{targetTokenUuid:target.document.uuid,
  coverDiagnosis:{status:'confirmed',type:'total',
   preventsDirectAttack:true},defense:{baseValue:17,value:null}}]};
 assert.ok(pf1aeModule.api.coverNativeBridge.cardSection(total).includes('Total cover: direct attack is blocked'));
 const uncertainGeometry=pf1aeModule.api.coverNativeBridge.cardSection({
  ...base,targetResults:[{...base.targetResults[0],
   coverDiagnosis:{status:'uncertain',reason:'wall-or-creature-contact-ambiguous'},
   defense:{baseValue:16,value:16,coverBonus:0}}]});
 assert.ok(uncertainGeometry.includes('Unverified (GM review)'));
 assert.ok(!uncertainGeometry.includes('Target AC incl. cover: 20'));
 // Native card fallback: intentionally do NOT emit a pf1AttackRoll event.
 // The actual PF1 post-use hook must still annotate verified cover CA.
 const originalCover=pf1aeModule.api.coverPF1;
 const originalResolution=pf1aeModule.api.attackResolution;
 const postUseCard={id:'native-postuse',documentName:'ChatMessage',
  user:{id:'player'},content:nativeThumbnail.replace(
   '<span class="value">17</span></div><div class="touch">',
   '<span class="value">16</span></div><div class="touch">'),
  updates:0,async update({content}){this.content=content;this.updates++}};
 system.messages.set(postUseCard.id,postUseCard);
 pf1aeModule.api.coverPF1={inspect:()=>({
  status:'confirmed',type:'normal',acBonus:4
 })};
 pf1aeModule.api.attackResolution={async resolveAttack(){
  return {defense:{baseValue:16,value:20,coverBonus:4}};
 }};
 action.actionType='mwak';
 action.hasAttack=true;
 action.isCombatManeuver=false;
 actionUse.shared.targets=[target];
 await pf1aeModule.api.coverNativeBridge.annotateNativePostUse(
  actionUse,postUseCard);
 assert.equal(postUseCard.updates,1,
  'a native post-use card receives the cover result without paired roll event');
 assert.ok(postUseCard.content.includes('data-pf1ae-cover-native-ac="16"'));
 assert.ok(postUseCard.content.includes('title="AC with cover: 20"'));
 assert.ok(!postUseCard.content.includes('pf1ae-cover-result'),
  'no PF1AE footer appended to native card');
 await pf1aeModule.api.coverNativeBridge.annotateNativePostUse(
  actionUse,postUseCard);
 assert.equal(postUseCard.updates,1,'repeated native callback is idempotent');
 // Ambiguous corner/contact geometry displays unknown instead of +4.
 const uncertainCard={...postUseCard,id:'uncertain-postuse',
  content:nativeThumbnail.replace(
   '<span class="value">17</span></div><div class="touch">',
   '<span class="value">16</span></div><div class="touch">'),updates:0,
  async update({content}){this.content=content;this.updates++}};
 system.messages.set(uncertainCard.id,uncertainCard);
 pf1aeModule.api.coverPF1={inspect:()=>({
  status:'uncertain',reason:'wall-or-creature-contact-ambiguous'
 })};
 await pf1aeModule.api.coverNativeBridge.annotateNativePostUse(
  actionUse,uncertainCard);
 assert.equal(uncertainCard.updates,0,
  'uncertain cover leaves native thumbnail unchanged, no footer');
 assert.ok(!uncertainCard.content.includes('pf1ae-cover-result'));
 pf1aeModule.api.coverPF1=originalCover;
 pf1aeModule.api.attackResolution=originalResolution;
 assert.equal(actor.uuid,'Actor.a');

 // With libWrapper + PF1 Improved Conditions simulated as a
 // prototype chain, the instance gate never registers with libWrapper,
 // and it never cuts an already-started prototype wrapper call.
 let registrationCount=0,nextCalls=0;
 class WrappedActionUse{
  async createAttackDialog(){return {}}
  async process(){
   lwHooks.get('pf1CreateActionUse')?.(this);
   const form=await this.createAttackDialog();
   if(!form)return undefined;
   nextCalls++;return 'next-wrapper';
  }
 }
 const originalMethod=WrappedActionUse.prototype.process;
 const lwMod={active:true,api:{
  coverPF1:{inspect:()=>({status:'confirmed',type:'total',preventsDirectAttack:true})},
  actionRange:{inspectActionUse:()=>({status:'uncertain'})}
 }};
 const lwActor={uuid:'Actor.source',getActiveTokens:()=>[lwSource]};
 const lwSource={document:{uuid:'Scene.s.Token.lwsource',parent:{id:'s'},
  x:0,y:0,width:1,height:1,elevation:0},actor:lwActor};
 const lwTarget={document:{uuid:'Scene.s.Token.lwtarget',parent:{id:'s'},
  x:300,y:0,width:1,height:1,elevation:0},actor:{uuid:'Actor.target'}};
 const lwGame={modules:new Map([
  ['pf1-automation-engine',lwMod],['lib-wrapper',{active:true}],
  ['pf1-improved-conditions',{active:true}]
 ]),settings:{get(){return true}},
  user:{targets:new Set([lwTarget])},i18n:{localize:k=>k}};
 const lwReady=[],lwInit=[],lwHooks=new Map();
 const lwCtx={console,game:lwGame,
  pf1:{actionUse:{ActionUse:WrappedActionUse},
   config:{maneuverActionTypes:new Set()}},
  libWrapper:{register(){registrationCount++}},
  Hooks:{once(name,fn){if(name==='ready')lwReady.push(fn);
   else if(name==='init')lwInit.push(fn)},
   on(name,fn){lwHooks.set(name,fn)}},
  ui:{notifications:{warn(){}}},
  Set,WeakSet,Map,Object,Number,Math};
 lwCtx.globalThis=lwCtx;
 vm.createContext(lwCtx);
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,
  '../scripts/cover-native-bridge.js'),'utf8'),lwCtx);
 for(const callback of lwInit)callback();
 for(const callback of lwReady)callback();
 assert.equal(registrationCount,0,
  'PF1AE must not register any libWrapper process wrapper');
 assert.equal(WrappedActionUse.prototype.process,originalMethod,
  'other modules retain the full prototype process chain');
 assert.equal(lwMod.api.coverNativeBridge.earlyGateMode(),'native-dialog-hook');
 const lwUse=Object.assign(new WrappedActionUse(),{
  actor:lwActor,
  action:{actionType:'rwak',hasAttack:true,isCombatManeuver:false,
   actor:lwActor},token:lwSource,shared:{targets:[lwTarget]}
 });
 lwHooks.get('pf1CreateActionUse')(lwUse);
 assert.equal(await lwUse.process(),undefined,
  'confirmed total cover exits the native process at dialog creation');
 assert.equal(nextCalls,0,'forbidden use never invokes modifier dialog or rolls');
 lwMod.api.coverPF1.inspect=()=>({status:'confirmed',type:'none',
  preventsDirectAttack:false});
 assert.equal(await lwUse.process(),'next-wrapper',
  'valid use calls the pre-existing prototype chain');
 assert.equal(nextCalls,1);
 const another=Object.assign(new WrappedActionUse(),{
  actor:lwActor,action:lwUse.action,token:lwSource,
  shared:{targets:[lwTarget]}});
 lwHooks.get('pf1CreateActionUse')(another);
 assert.equal(await another.process(),'next-wrapper',
  'new instance always receives its own guard');
 assert.equal(nextCalls,2);
 console.log('PASS native cover bridge and universal 3D action range: melee elevation, PF1 diagonals, spells, abilities, ranged weapons and no resource usage');
})().catch(error=>{console.error(error);process.exitCode=1});
