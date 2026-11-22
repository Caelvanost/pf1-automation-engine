'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.resolve(__dirname,'../scripts/cover-pf1-rules.js'),'utf8');
const ready=[];
const mod={api:{coverMode:{get:()=>"3d",inspect:()=>({ready:true,reasons:[]})}},active:true};
const modules=new Map([['pf1-automation-engine',mod]]);
const scene={id:'s',grid:{type:1,distance:5,units:'ft'},walls:{contents:[]},
 tiles:{contents:[]},regions:{contents:[]}};
const all=[];
const game={modules};
const ctx={console,game,Hooks:{once(_name,fn){ready.push(fn)}},
 canvas:{scene,grid:{size:100},tokens:{placeables:all}},
 foundry:{utils:{deepClone:structuredClone}},
 CONST:{WALL_MOVEMENT_TYPES:{NONE:0,NORMAL:20}},Object,Math,Set,Map,Number};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'cover-pf1-rules.js'});
for(const fn of ready)fn();
const api=mod.api.coverPF1;
const make=(id,x,y,{z=0,w=1,h=1,los=5}={})=>{
 const token={document:{id,uuid:'Scene.s.Token.'+id,parent:{id:'s'},
  x,y,width:w,height:h,elevation:z},losHeight:los};
 all.push(token);return token;
};
const attacker=make('attacker',0,0),target=make('target',300,0);
const check=(options={})=>api.inspect({attacker,target,...options});
let result=check();
assert.equal(result.status,'confirmed','empty known scene should have no cover');
assert.equal(result.type,'none');
assert.equal(result.acBonus,0);
assert.equal(result.origins.length,4);
assert.equal(result.origins.every(x=>x.traces.length===4),true);
assert.equal(api.lastDiagnostic().type,'none');
const wall=(id,x1,y1,x2,y2,{bottom=0,top=10,move=20,door=0,ds=0}={})=>({
 id,uuid:'Scene.s.Wall.'+id,c:[x1,y1,x2,y2],
 flags:{'wall-height':{bottom,top}},move,door,ds
});
// Skull & Shackles water level: the region surface is 0 ft, the
// target's token-height model is 1 cell = 5 ft, and it is in the
// region. Test strict inclusive chest/full altitude boundaries.
const waterRegion={id:'water-a',uuid:'Scene.s.Region.water-a',
 parent:{id:'s'},elevation:0,
 flags:{'pf1-skull-and-shackles':{waterRegion:{enabled:true,surface:0}}},
 testPoint:({x,y})=>x>=200&&x<500&&y>=-100&&y<150};
scene.regions.contents.push(waterRegion);
target.document.flags={world:{underwater:true}};
target.document.elevation=-2.49;
result=check({mode:'2d'});
assert.equal(result.type,'none','above chest threshold no water cover');
target.document.elevation=-2.5;
for(const attackType of ['ranged','melee']){
 result=check({attackType,mode:'2d'});
 assert.equal(result.status,'confirmed');
 assert.equal(result.type,'improved','chest-deep from land grants improved cover');
 assert.equal(result.acBonus,8);
 assert.equal(result.reflexBonus,4);
 assert.equal(result.aquaticCover?.immersion,'chest');
 assert.equal(result.aquaticCover?.depth,2.5);
 assert.equal(result.aquaticCover?.bodyHeight,5);
}
assert.equal(api.lastDiagnostic().type,'improved');
target.document.elevation=-4.99;
assert.equal(check({mode:'2d'}).type,'improved',
 'below chest but not fully submerged remains improved cover');
target.document.elevation=-5;
for(const attackType of ['ranged','melee']){
 result=check({attackType,mode:'2d'});
 assert.equal(result.type,'total','full submersion blocks land-based direct attack');
 assert.equal(result.preventsDirectAttack,true);
 assert.equal(result.aquaticCover?.immersion,'full');
}
// Being in water yourself negates aquatic cover to an underwater
// target, even when the target is fully immersed.
attacker.document.flags={world:{underwater:true}};
assert.equal(check({mode:'2d'}).type,'none',
 'underwater attacker against underwater target: no surface cover');
attacker.document.flags.world.underwater=false;
// A stale generic underwater flag does not grant surface cover when
// a token is outside all Skull & Shackles water regions.
target.document.x=600;
assert.equal(check({mode:'2d'}).type,'none');
target.document.x=300;
// A target at exactly the surface is not chest-deep.
target.document.elevation=0;
assert.equal(check({mode:'2d'}).type,'none');
// Canonical PF1 Waters Region flags work without Skull & Shackles API.
waterRegion.flags['pf1-waters']={waterRegion:{enabled:true,surface:0,depth:12}};
target.document.elevation=-2.5;
assert.equal(check({mode:'2d'}).type,'improved',
 'canonical PF1 Waters Region grants improved cover at half immersion');
assert.equal(check({mode:'2d'}).source,'water-region-fallback');
target.document.elevation=-5;
assert.equal(check({mode:'2d'}).type,'total',
 'canonical PF1 Waters Region grants total cover fully submerged');
waterRegion.flags['pf1-waters'].waterRegion.enabled=false;
assert.equal(check({mode:'2d'}).type,'none',
 'disabled canonical Region overrides an enabled old Skull & Shackles flag');
waterRegion.flags['pf1-waters'].waterRegion.enabled=true;
waterRegion.flags['pf1-waters'].waterRegion.depth=2;
target.document.elevation=-5;
assert.equal(check({mode:'2d'}).type,'none',
 'being entirely below the actual bottom is not immersion');
waterRegion.flags['pf1-waters'].waterRegion.depth=12;
// Prefer the active Waters API: explicit physical token height wins.
const waters={active:true,api:{getTokenWaterState(token){
 const doc=token?.document??token,physicalHeight=doc.id==='target'?2:5;
 const base=doc.elevation, top=base+physicalHeight;
 const fraction=Math.max(0,Math.min(1,
   (Math.min(top,0)-Math.max(base,-12))/physicalHeight));
 return {inWater:fraction>0,immersion:fraction,tokenBottom:base,
   tokenHeight:physicalHeight,surface:0,regionId:'water-a',
   region:waterRegion};
}}};
modules.set('pf1-waters',waters);
target.document.elevation=-0.99;
assert.equal(check({mode:'2d'}).type,'none',
 'less than half immersion is no water cover');
target.document.elevation=-1;
result=check({mode:'2d'});
assert.equal(result.type,'improved');
assert.equal(result.acBonus,8);
assert.equal(result.reflexBonus,4);
assert.equal(result.source,'pf1-waters');
assert.equal(result.aquaticCover.immersionFraction,0.5);
assert.equal(result.aquaticCover.bodyHeight,2);
target.document.elevation=-2;
assert.equal(check({mode:'2d'}).type,'total',
 'full body immersion prevents direct attacks from land');
attacker.document.elevation=-1;
assert.equal(check({mode:'2d'}).type,'none',
 'aquatic surface cover is unavailable against an immersed attacker');
attacker.document.elevation=0;
// An active API stating OUTSIDE must win over stale Region flags.
waters.api.getTokenWaterState=()=>({
 inWater:false,immersion:0,tokenBottom:0,tokenHeight:2,surface:null,regionId:null
});
assert.equal(check({mode:'2d'}).type,'none');
modules.delete('pf1-waters');
delete waterRegion.flags['pf1-waters'];
target.document.elevation=0;
// Restore normal geometry tests, and separate water setup from their
// existing deliberately comprehensive wall/movement regression suite.
target.document.elevation=0;
target.document.flags.world.underwater=false;
// Metric threshold regression: one square is 1.50m; chest at -0.75m,
// full immersion at -1.50m, boundaries inclusive.
scene.grid.distance=1.5;scene.grid.units='m';
target.document.elevation=-0.75;
result=check({mode:'2d'});
assert.equal(result.type,'improved','1.50m token: -0.75m is chest deep');
assert.equal(result.aquaticCover.bodyHeight,1.5);
target.document.elevation=-1.5;
assert.equal(check({mode:'2d'}).type,'total',
 '1.50m token: -1.50m is fully submerged');
// A different surface datum translates both boundaries identically.
waterRegion.flags['pf1-skull-and-shackles'].waterRegion.surface=3;
target.document.elevation=2.25;
assert.equal(check({mode:'2d'}).type,'improved');
target.document.elevation=1.5;
assert.equal(check({mode:'2d'}).type,'total');
// Water-region diagnostics must be compatible with 3D mode and
// Levels when the attacker and target have different elevations.
const waterLevelModule={active:true};
modules.set('levels',waterLevelModule);
ctx.CONFIG={Levels:{API:{testCollision:()=>false}}};
target.document.elevation=2.25;
result=check({mode:'3d'});
assert.equal(result.status,'confirmed');
assert.equal(result.type,'improved',
 'recognized water Regions must not invalidate known 3D geometry');
assert.equal(result.reflexBonus,4);
target.document.elevation=1.5;
assert.equal(check({mode:'3d'}).type,'total');
modules.delete('levels');delete ctx.CONFIG;
scene.grid.distance=5;scene.grid.units='ft';
target.document.elevation=0;
waterRegion.flags['pf1-skull-and-shackles'].waterRegion.surface=0;
scene.regions.contents.length=0;
scene.walls.contents.push(wall('full',200,-200,200,300));
result=check();
assert.equal(result.status,'confirmed','complete wall proves no direct line of effect');
assert.equal(result.type,'total');
assert.equal(result.preventsDirectAttack,true);
assert.equal(result.acBonus,null);
assert.equal(result.preventsDirectAttack,true,
 'total wall cover remains authoritative');
target.document.flags.world.underwater=false;
// A normal 2D wall without any wall-height flags still blocks all
// direct rays and proves total cover by default.
delete scene.walls.contents[0].flags['wall-height'];
result=check({mode:'2d'});
assert.equal(result.type,'total','2D unbounded wall gives total cover');
scene.walls.contents[0].flags['wall-height']={bottom:0,top:10};
// Native Foundry window (movement-blocking, sight/light-transparent) is
// improved cover from a distance, but not immediately beside its opening.
scene.walls.contents[0].sight=0;
scene.walls.contents[0].light=0;
ctx.CONST.WALL_SENSE_TYPES={NONE:0,NORMAL:20};
result=check({mode:'2d'});
assert.equal(result.type,'improved','native v13 window gives improved cover');
assert.equal(result.acBonus,8);
assert.equal(result.reflexBonus,4);
assert.equal(result.preventsDirectAttack,false);
attacker.document.x=100;
result=check({mode:'2d'});
assert.equal(result.type,'none','adjacent attacker ignores window cover');
attacker.document.x=0;
delete scene.walls.contents[0].sight;
delete scene.walls.contents[0].light;
result=check({mode:'2d'});
assert.equal(result.type,'total','ordinary wall is still opaque');
// Foundry doors are walls when closed or locked, regardless of a
// window-like sight/light setup or stale special-cover classification.
// Open doors permit direct attacks.
scene.walls.contents[0].door=1;
scene.walls.contents[0].sight=0;
scene.walls.contents[0].light=0;
scene.walls.contents[0].flags['pf1-automation-engine']={coverGrade:'window'};
for(const ds of [0,2]){
 scene.walls.contents[0].ds=ds;
 for(const mode of ['2d','3d']){
  result=check({mode});
  assert.equal(result.type,'total',
   mode+': closed/locked door must be an ordinary solid wall');
  assert.equal(result.preventsDirectAttack,true);
 }
}
scene.walls.contents[0].ds=1;
for(const mode of ['2d','3d']){
 result=check({mode});
 assert.equal(result.type,'none',mode+': open door must be unobstructed');
}
scene.walls.contents[0].door=0;
scene.walls.contents[0].ds=0;
delete scene.walls.contents[0].sight;
delete scene.walls.contents[0].light;
delete scene.walls.contents[0].flags['pf1-automation-engine'];
// GM window classification is supported when the native senses have
// deliberately custom values.
scene.walls.contents[0].flags['pf1-automation-engine']={coverGrade:'window'};
result=check({mode:'2d'});
assert.equal(result.type,'improved');
delete scene.walls.contents[0].flags['pf1-automation-engine'];
// Foundry v13 normal movement walls are 20; legacy 1 must not be trusted.
scene.walls.contents[0].move=1;
result=check();
assert.equal(result.status,'uncertain','unsupported legacy movement value is not a solid wall');
scene.walls.contents[0].move=20;
assert.equal(check().type,'total','native normal movement value preserves total cover');
scene.walls.contents.length=0;
// A segment hides less than half the occupied silhouette from the
// attacker's best available square corner. PF1 partial cover +2/+1
// applies although at least one formal target-corner ray is blocked.
scene.walls.contents.push(wall('majority-visible',200,55,200,120));
for(const mode of ['2d','3d']){
 result=check({attackType:'ranged',mode});
 assert.equal(result.status,'confirmed');
 const expected=mode==='2d'?'none':'partial';
 assert.equal(result.type,expected,
  mode+': PF1 corner rays determine attack availability; center determines the majority fraction');
 assert.equal(result.acBonus,mode==='2d'?0:2);
 assert.equal(result.reflexBonus,mode==='2d'?0:1);
 assert.ok(result.origins.some(o=>o.visibility?.majority===true),
  mode+': target silhouette majority evidence must be present');
 const views=result.origins.filter(o=>o.visibility).map(o=>o.visibility);
 assert.ok(views.length>0);
 assert.ok(views.every(v=>v.source==='attacker-token-center'),
  mode+': visibility diagnostics must identify the vision origin');
 assert.ok(views.every(v=>v.sourcePoint.x===50&&v.sourcePoint.y===50),
  mode+': all visibility rays originate at token center, not corners');
 assert.ok(views.every(v=>v.visibleFraction===views[0].visibleFraction),
  mode+': all candidate attack origins share a single visibility fraction');
}
// At or below half exposed, do not discount otherwise confirmed normal
// wall cover. This is distinct from merely counting four corner rays.
scene.walls.contents[0].c=[200,10,200,120];
result=check({mode:'2d'});
assert.equal(result.type,'normal','no partial when at most half remains exposed');
// Preserve total cover and exceptional window classifications.
scene.walls.contents.length=0;
scene.walls.contents.push(wall('partial',200,25,200,120));
result=check();
assert.equal(result.status,'confirmed','wall may protect more than half of the target from center');
assert.equal(result.type,'normal');
assert.equal(result.acBonus,4);
assert.equal(result.reflexBonus,2);
// No water Region means no special aquatic bonus, even with stale flag.
target.document.flags.world.underwater=true;
result=check();
assert.equal(result.type,'normal');
target.document.flags.world.underwater=false;
// A wall may be explicitly graded by the GM: do not infer this
// from its 2D segment or from the token's visual silhouette.
scene.walls.contents[0].flags['pf1-automation-engine']={coverGrade:'partial'};
result=check();
assert.equal(result.status,'confirmed');
assert.equal(result.type,'partial');
assert.equal(result.acBonus,2);
assert.equal(result.reflexBonus,1);
// A stale underwater flag alone must never replace partial wall cover.
target.document.flags.world.underwater=true;
result=check();
assert.equal(result.type,'partial');
target.document.flags.world.underwater=false;
scene.walls.contents[0].flags['pf1-automation-engine'].coverGrade='improved';
result=check();
assert.equal(result.status,'confirmed');
assert.equal(result.type,'improved');
assert.equal(result.acBonus,8);
assert.equal(result.reflexBonus,4);
assert.equal(result.preventsDirectAttack,false,
 'classified improved cover must never be mistaken for total cover');
target.document.flags.world.underwater=true;
result=check();
assert.equal(result.type,'improved');
assert.equal(result.acBonus,8);
target.document.flags.world.underwater=false;
delete scene.walls.contents[0].flags['pf1-automation-engine'];
scene.walls.contents[0].flags['wall-height'].top=2;
result=check();
assert.equal(result.status,'confirmed');
assert.equal(result.type,'none','low wall below sample height cannot cover high ray');
// In 3D a short ground-based wall (< 3 ft) grants partial cover to
// Medium targets and standard cover to Small ones even when the token's
// sight ray passes above it. The attacker must be farther from the
// wall, and the defender must lie within the low-obstacle PF1 limit.
scene.grid.units='ft';
scene.grid.distance=5;
attacker.document.x=-100; // Attacker farther from the wall than defender
target.actor={system:{traits:{size:'med'}}};
result=check({mode:'3d'});
assert.equal(result.type,'partial','2ft wall vs Medium grants partial cover');
assert.equal(result.acBonus,2);
assert.equal(result.reflexBonus,1);
target.actor.system.traits.size='sm';
result=check({mode:'3d'});
assert.equal(result.type,'normal','2ft wall vs Small grants normal cover');
assert.equal(result.acBonus,4);
// Threshold is strict, so exactly 3ft is not a low wall.
scene.walls.contents[0].flags['wall-height'].top=3;
result=check({mode:'3d'});
assert.equal(result.type,'partial','3ft wall is not a size-based low wall; normal visibility can still give partial cover');
scene.walls.contents[0].flags['wall-height'].top=2;
// Metric scenes use 1m instead of 3ft; grid remains 100 pixels/cell.
scene.grid.units='m';
scene.grid.distance=1.5;
scene.walls.contents[0].flags['wall-height'].top=0.8;
result=check({mode:'3d'});
assert.equal(result.type,'normal','0.8m wall gives normal cover to Small target');
scene.walls.contents[0].flags['wall-height'].top=1;
result=check({mode:'3d'});
assert.equal(result.type,'none','1m wall is not a low wall and the test attacker at 5m can see completely above it');
scene.grid.units='ft';
scene.grid.distance=5;
scene.walls.contents[0].flags['wall-height'].top=2;
target.actor.system.traits.size='lg';
result=check({mode:'3d'});
assert.equal(result.type,'partial','Large PF1 size does not trigger M/P low-wall grade, but 1x1 token body visibility gives generic partial cover');
target.actor=null;
attacker.document.x=0;
delete scene.grid.units;
// Foundry always provides a scene grid distance. Preserve it for body
// height calculations in subsequent 3D tests.
scene.grid.distance=5;
scene.walls.contents[0].flags['wall-height'].top=10;
scene.walls.contents[0].door=1;
scene.walls.contents[0].ds=1;
result=check();
assert.equal(result.status,'confirmed');
assert.equal(result.type,'none','open door should not block');
scene.walls.contents[0].ds=0;
result=check();
assert.equal(result.type,'normal','closed door is a wall and hides most of the target from token center');
scene.walls.contents[0].move=0;
result=check();
assert.equal(result.status,'uncertain','passable wall may still represent a physical obstacle');
scene.walls.contents.length=0;
// Live pier regression: every attacker corner has a strict wall crossing
// to at least one target corner, while other rays graze its endpoints.
// The grazes cannot invalidate independently proven partial cover.
scene.walls.contents.push(wall('pier-edge',200,0,200,100));
result=check({attackType:'ranged'});
assert.equal(result.status,'confirmed',
 'proven obstruction from every origin must win over unrelated grazing rays');
assert.equal(result.reason,'every-origin-has-proven-obstruction');
assert.equal(result.type,'normal');
assert.equal(result.acBonus,4);
assert.equal(result.reflexBonus,2);
assert.equal(result.origins.length,4);
assert.ok(result.origins.every(o=>o.solid),
 'each attacker origin has at least one strict blocked ray');
assert.ok(result.origins.some(o=>o.unknown),
 'the regression must include genuinely grazing rays');
// A grazing wall with NO strict intersection from at least one possible
// origin is still uncertain: a tangent alone does not prove +4.
scene.walls.contents[0].c=[200,0,200,0];
result=check({attackType:'ranged'});
assert.notEqual(result.type,'normal',
 'zero-length wall endpoint must not award confirmed wall cover');
scene.walls.contents.length=0;
// Ranged screenshot regression: the wall starts at the upper-left
// corner of the target and follows its left square BORDER. Rays drawn
// from the best attacker corner to the target's lower-left corner
// terminate on the wall (red), while rays to the right-hand target
// corners are unobstructed (green). Some rays clear, but this is cover.
scene.walls.contents.length=0;
attacker.document.x=0;attacker.document.y=0;
target.document.x=200;target.document.y=200;
scene.walls.contents.push(wall('screenshot-ranged-edge',200,200,200,400));
for(const mode of ['2d','3d']){
 result=check({attackType:'ranged',mode});
 assert.equal(result.status,'confirmed',
  'ranged border cover must be confirmed: '+JSON.stringify(result));
 assert.equal(result.type,'normal',
  'best attack corner still has a ray passing through target-border wall: '+
  JSON.stringify({mode,reason:result.reason,origins:result.origins}));
 assert.equal(result.acBonus,4);
 assert.equal(result.reflexBonus,2);
 assert.ok(result.origins.every(o=>o.traces.some(r=>r.blocked.length>0)),
  'every attacker corner has at least one blocked target-corner ray');
 assert.ok(result.origins.some(o=>o.traces.some(r=>r.blocked.length===0)),
  'other rays from the same corner remain visibly clear');
 const majority=result.origins.map(o=>o.visibility).find(Boolean);
 assert.ok(majority&&!majority.majority,
  'target is not proven >50% exposed from attacker token center');
}
// Reverse wall direction: the result cannot depend on endpoint order.
scene.walls.contents[0].c=[200,400,200,200];
result=check({attackType:'ranged',mode:'2d'});
assert.equal(result.type,'normal','reverse border-wall direction is identical');
assert.equal(result.acBonus,4);
// A zero-length tip, unlike a positive-length wall along the border,
// cannot establish a definitively obstructed target-corner ray.
scene.walls.contents[0].c=[200,300,200,300];
result=check({attackType:'ranged',mode:'2d'});
assert.notEqual(result.type,'normal',
 'single point at corner cannot prove normal cover');
// An open door coinciding with the target border is still passable.
scene.walls.contents[0].c=[200,200,200,400];
scene.walls.contents[0].door=1;
scene.walls.contents[0].ds=1;
result=check({attackType:'ranged',mode:'2d'});
assert.equal(result.type,'none','open target-border door cannot grant cover');
scene.walls.contents.length=0;
attacker.document.x=0;attacker.document.y=0;
target.document.x=300;target.document.y=0;
// Actual second pier diagnostic: origin solid rays [0,0,1,1],
// endpoint-grazing rays [2,2,1,1]. The attacker automatically chooses
// corner 0 or 1: no strictly blocked ray => no cover.
scene.walls.contents.push(wall('pier-best-angle',300,0,300,50));
for(const mode of ['2d','3d']){
 result=check({attackType:'ranged',mode});
 assert.equal(result.status,'confirmed',
  mode+': best attacker angle should resolve tangent-only origins');
 assert.equal(result.reason,'attacker-selected-best-grazing-angle');
 assert.equal(result.type,'none',mode+': do not award +4 for optional worse angle');
 assert.equal(result.acBonus,0);
 assert.ok([0,1].includes(result.selectedOrigin));
 assert.equal(JSON.stringify(result.origins.map(o=>o.traces.filter(t=>
  t.blocked.some(b=>b.kind==='solid')).length)),
  '[0,0,1,1]','matches actual pier solid ray counts');
 assert.equal(JSON.stringify(result.origins.map(o=>o.traces.filter(t=>
  t.uncertain.some(u=>u.startsWith('wall-grazed:'))).length)),
  '[2,2,1,1]','matches actual pier grazing ray counts');
}
// Unverified movement/door/surface geometry must NOT turn into a
// favorable clear origin merely because there is no proven crossing.
scene.walls.contents[0].move=0;
result=check({attackType:'ranged',mode:'2d'});
assert.equal(result.status,'uncertain',
 'unclassified wall still needs GM review');
scene.walls.contents.length=0;
// Unknown provenance and vertical geometry must never grant +4 automatically.
target.document.elevation=10;
result=check();
assert.equal(result.status,'uncertain');
assert.equal(result.type,null);
const levels={active:true,version:'6.1.0'};
modules.set('levels',levels);
ctx.CONFIG={Levels:{API:{testCollision:()=>false}}};
result=check();
assert.equal(result.status,'confirmed',
 'unobstructed multi-elevation rays validated by Levels collision');
assert.equal(result.type,'none');
assert.equal(result.multilevel,true);
ctx.CONFIG.Levels.API.testCollision=()=>({x:150,y:0,z:5});
result=check();
assert.equal(result.status,'uncertain',
 'Levels 3D surface hit cannot be treated as clear or only +4');
ctx.CONFIG.Levels.API.testCollision=()=>true;
assert.equal(check().status,'uncertain','unexpected collision type remains unknown');
modules.delete('levels');
target.document.elevation=0;
target.document.width=2;
target.document.height=2;
result=check();
assert.equal(result.status,'confirmed','unobstructed Large defender has no cover');
assert.equal(result.type,'none');
assert.equal(result.origins.length,4,'one-square attacker still has 4 origin corners');
target.document.width=1;
target.document.height=1;
attacker.document.width=2;
attacker.document.height=2;
result=check();
assert.equal(result.status,'confirmed');
assert.equal(result.type,'none');
assert.equal(result.origins.length,9,
 'Large attacker may select corners of any occupied square');
attacker.document.width=1;
attacker.document.height=1;
scene.tiles.contents.push({id:'roof',overhead:true,flags:{betterroofs:{brMode:1}}});
assert.equal(check().status,'uncertain','roof visibility is not proof of a solid floor');
scene.tiles.contents.length=0;
scene.regions.contents.push({id:'untyped-region'});
assert.equal(check().status,'uncertain');
scene.regions.contents.length=0;
attacker.losHeight=undefined;
result=check();
assert.equal(result.status,'uncertain','unknown projectile height must fail closed');
attacker.losHeight=5;
target.losHeight=6;
result=check();
assert.equal(result.status,'confirmed',
 'different native LOS heights must not force unknown cover on an empty scene');
assert.equal(result.type,'none');
assert.equal(result.sourceHeight,5);
assert.equal(result.targetHeight,6);
// A partial wall 2/3 of the way to the target, top 10, still protects.
scene.walls.contents.push(wall('slope-partial',200,25,200,120,
 {bottom:0,top:10}));
result=check();
assert.equal(result.status,'confirmed',
 'sloping shot must classify wall cover from attacker token center');
assert.equal(result.type,'normal');
assert.equal(result.acBonus,4);
// The same wall too low for the ray must not falsely grant +4.
scene.walls.contents[0].flags['wall-height'].top=2;
result=check();
assert.equal(result.status,'confirmed');
assert.equal(result.type,'none');
scene.walls.contents[0].flags['wall-height'].top=10;
scene.walls.contents.length=0;
// A full-height solid wall across the complete corridor remains total.
scene.walls.contents.push(wall('slope-full',200,-200,200,300,
 {bottom:0,top:10}));
result=check();
assert.equal(result.status,'confirmed');
assert.equal(result.type,'total','sloping full wall debug: '+
 JSON.stringify(result.origins.map(o=>({grade:o.coverType,unknown:o.unknown,
 visibility:o.visibility,traces:o.traces.map(t=>({blocked:t.blocked,uncertain:t.uncertain}))}))));
scene.walls.contents.length=0;
// An unknown wall vertical boundary is not proof of +4.
scene.walls.contents.push(wall('slope-unknown',200,25,200,120,
 {bottom:0,top:10}));
scene.walls.contents[0].flags['wall-height'].top='unknown';
result=check();
assert.equal(result.status,'uncertain');
scene.walls.contents.length=0;
target.losHeight=5;
// Ranged and reach use the same selected-corner cover algorithm.
result=check({attackType:'reach'});
assert.equal(result.type,'none');
result=check({attackType:'melee'});
assert.equal(result.type,'none');
result=check({attackType:'ranged',projectileHeight:5});
assert.equal(result.type,'none');
// Body-height house rule: a 1×1 token is 5ft high on this grid,
// and a 2×2 token is 10ft high, independent of token.losHeight.
scene.walls.contents.length=0;
target.document.width=1;
target.document.height=1;
attacker.losHeight=3;
target.losHeight=3;
scene.walls.contents.push(wall('body-size',275,-200,275,300,
 {bottom:0,top:4}));
result=check({mode:'3d'});
assert.equal(result.type,'normal','5ft body behind 4ft wall retains normal cover');
assert.equal(result.origins[0].visibility.bodyHeight,5);
assert.equal(result.origins[0].visibility.bodyTop,5);
target.document.width=2;
target.document.height=2;
result=check({mode:'3d'});
assert.equal(result.type,'partial','10ft body extends above 4ft wall: '+
 JSON.stringify(result.origins.map(o=>({type:o.coverType,unknown:o.unknown,
  visibility:o.visibility}))));
assert.equal(result.acBonus,2);
assert.equal(result.origins[0].visibility.bodyHeight,10);
assert.equal(result.origins[0].visibility.bodyTop,10);
assert.ok(result.origins.some(o=>o.visibility.majority));
// A wall higher than the entire Large body still fully prevents attack.
scene.walls.contents[0].flags['wall-height'].top=12;
result=check({mode:'3d'});
assert.equal(result.type,'total','fully blocked 10ft body keeps total cover; diagnosis='+
 JSON.stringify(result.origins.map(o=>({corner:o.originCorner,cover:o.coverType,
  vis:o.visibility,blocked:o.traces.map(t=>t.blocked)}))));
// LOS-eye height must never stretch or shrink the sampled body height.
scene.walls.contents[0].flags['wall-height'].top=4;
target.losHeight=7;
result=check({mode:'3d'});
assert.equal(result.type,'partial','LOS independent body cover: '+result.reason+' '+
 JSON.stringify(result.origins.map(o=>({type:o.coverType,unknown:o.unknown,
 visibility:o.visibility}))));
assert.equal(result.origins[0].visibility.bodyHeight,10);
// Metric 1.5m grid: M=1.5m and Large=3m in physical vertical volume.
scene.grid.units='m';
scene.grid.distance=1.5;
target.document.width=1;
target.document.height=1;
result=check({mode:'3d'});
assert.equal(result.origins[0].visibility.bodyHeight,1.5);
target.document.width=2;
target.document.height=2;
result=check({mode:'3d'});
assert.equal(result.origins[0].visibility.bodyHeight,3);
// No trustworthy grid distance -> do not invent a 3D total-cover proof.
delete scene.grid.distance;
scene.walls.contents[0].flags['wall-height'].top=12;
result=check({mode:'3d'});
assert.notEqual(result.type,'total');
scene.grid.distance=5;
scene.grid.units='ft';
scene.walls.contents.length=0;
target.document.width=1;
target.document.height=1;
target.losHeight=5;
attacker.losHeight=5;
// The center of a Large attacker token is NOT any of its nine
// selectable PF1 attack-square corners. Their attack rays must remain
// independent, while the visibility percentage has one stable origin.
scene.grid.distance=5;
scene.grid.units='ft';
scene.walls.contents.length=0;
scene.walls.contents.push(wall('center-check',200,35,200,120));
attacker.document.width=2;
attacker.document.height=2;
result=check({mode:'2d',attackType:'ranged'});
assert.equal(result.origins.length,9,
 'large attacker must still retain all nine PF1 attack corners');
const largeViews=result.origins.filter(o=>o.visibility).map(o=>o.visibility);
assert.ok(largeViews.length>0,'large attacker needs visible-area diagnostics');
assert.ok(largeViews.every(v=>v.sourcePoint.x===100&&v.sourcePoint.y===100),
 'large attacker visibility must originate from center (100,100)');
assert.ok(largeViews.every(v=>v.visibleFraction===largeViews[0].visibleFraction));
assert.equal(result.origins.some(o=>o.originCorner!==4),true,
 'the PF1 ray tracing corners must remain available');
attacker.document.width=1;
attacker.document.height=1;
scene.walls.contents.length=0;
// Screenshot regression: attacker at bottom-left, target at top-right,
// vertical wall starts at their shared diagonal corner and runs down.
// This is the same 1x1 square arrangement as a selected melee token
// next to a wall corner and a diagonally adjacent enemy.
scene.walls.contents.length=0;
attacker.document.x=0;attacker.document.y=100;
target.document.x=100;target.document.y=0;
scene.walls.contents.push(wall('diagonal-corner',100,100,100,300));
result=check({attackType:'melee',mode:'2d'});
assert.equal(result.method,'adjacent-melee');
assert.equal(result.status,'confirmed');
assert.equal(result.type,'normal',
 'at most half of northeast target exposed behind corner wall from southwest attacker center; '+JSON.stringify({
 reason:result.reason,origins:result.origins?.map(o=>({origin:o.originCorner,type:o.coverType,
 visibility:o.visibility}))}));
assert.equal(result.acBonus,4);
const diagVisibility=result.origins.map(o=>o.visibility).find(Boolean);
assert.ok(diagVisibility,'diagonal endpoint test must measure target exposure');
assert.ok(diagVisibility.uncertainSamples>0,
 'rays grazing the wall endpoint must be uncertain, not visible');
assert.equal(diagVisibility.majority,false,
 'a wall endpoint cannot make more than half provably visible');
assert.ok(diagVisibility.visibleFraction<=0.5);
result=check({attackType:'melee',mode:'3d'});
assert.equal(result.status,'confirmed');
assert.equal(result.type,'normal',
 '3D diagonal corner wall hides at least half body; '+JSON.stringify({
 reason:result.reason,origins:result.origins?.map(o=>({origin:o.originCorner,type:o.coverType,
 visibility:o.visibility}))}));
attacker.document.y=0;
target.document.x=300;target.document.y=0;
scene.walls.contents.length=0;
// Adjacency is symmetric: flipping either axis must never turn a
// touch- or corner-adjacent melee attack into nonadjacent reach.
scene.walls.contents.length=0;
for(const [ax,ay,tx,ty] of [
 [0,0,100,0], [100,0,0,0],
 [0,0,0,100], [0,100,0,0],
 [0,0,100,100], [100,100,0,0],
 [0,100,100,0], [100,0,0,100]
]){
 attacker.document.x=ax;attacker.document.y=ay;
 target.document.x=tx;target.document.y=ty;
 result=check({attackType:'melee',mode:'2d'});
 assert.equal(result.method,'adjacent-melee',
  'melee adjacent squares must be orientation-independent: '+
  [ax,ay,tx,ty].join(','));
 assert.equal(result.type,'none');
}
attacker.document.x=0;attacker.document.y=0;
target.document.x=300;target.document.y=0;
result=check({attackType:'melee',mode:'2d'});
assert.equal(result.method,'ranged-or-reach',
 'true nonadjacent melee still uses reach/ranged corner selection');
// A full wall exactly ON the shared edge cannot be mistaken for a
// harmless endpoint grazing ray. Closed doors are solid; open ones clear.
scene.walls.contents.length=0;
target.document.x=100;target.document.y=0;
scene.walls.contents.push(wall('shared-door',100,0,100,100,
 {door:1,ds:0}));
result=check({attackType:'melee',mode:'2d'});
assert.equal(result.type,'total',
 'adjacent closed door along shared boundary blocks all direct attacks');
assert.equal(result.preventsDirectAttack,true);
result=check({attackType:'melee',mode:'3d'});
assert.equal(result.type,'total',
 'full-height closed adjacent door blocks body in 3D');
scene.walls.contents[0].ds=2;
assert.equal(check({attackType:'melee',mode:'2d'}).type,'total',
 'locked door is also a solid shared border');
scene.walls.contents[0].ds=1;
assert.equal(check({attackType:'melee',mode:'2d'}).type,'none',
 'open adjacent door leaves melee line of effect');
scene.walls.contents[0].ds=0;
scene.walls.contents[0].door=0;
// Low obstacle dividing adjacent squares: equal distances do NOT
// allow either creature to ignore the obstacle under PF1.
scene.walls.contents[0].flags['wall-height'].top=2;
target.actor={system:{traits:{size:"med"}}};
result=check({attackType:'melee',mode:'3d'});
assert.equal(result.type,'partial',
 'adjacent Medium target receives size-based partial cover over 2ft wall');
target.actor.system.traits.size="sm";
result=check({attackType:'melee',mode:'3d'});
assert.equal(result.type,'normal',
 'adjacent Small target receives normal cover over 2ft wall');
target.actor=null;
scene.walls.contents[0].flags['wall-height'].top=10;
scene.walls.contents[0].c=[100,0,100,50];
result=check({attackType:'melee',mode:'2d'});
assert.equal(result.status,'confirmed');
assert.notEqual(result.type,'total',
 'partial shared edge must not be classified as a whole sealed wall');
scene.walls.contents.length=0;
// Melee PF1: adjacent melee checks wall crossings from ANY attacker
// corner, whereas nonadjacent melee/reach chooses the best corner.
scene.walls.contents.length=0;
target.document.x=100;target.document.y=100;
scene.walls.contents.push(wall('melee-corner',100,10,100,90));
result=check({attackType:'melee',mode:'2d'});
assert.equal(result.status,'confirmed');
assert.equal(result.method,'adjacent-melee');
assert.equal(result.type,'partial',
 'a blocked corner grants adjacent melee cover, reduced when the target is mostly visible');
// No intervening-creature soft cover for adjacent melee.
scene.walls.contents.length=0;
const intervening=make('melee-interposed',100,0);
result=check({attackType:'melee',mode:'2d'});
assert.equal(result.type,'none','adjacent melee ignores creature soft cover');
// Melee through reach is governed by ranged cover, including creatures.
target.document.x=300;target.document.y=0;
intervening.document.x=150;intervening.document.y=0;
result=check({attackType:'melee',mode:'2d'});
assert.equal(result.method,'ranged-or-reach');
assert.equal(result.type,'soft',
 'nonadjacent melee uses creature soft cover');
assert.equal(result.acBonus,4);
assert.equal(result.reflexBonus,0);
// Large melee attackers/targets may choose the most favorable
// adjacent occupied square, rather than becoming uncertain near walls.
all.splice(all.indexOf(intervening),1);
target.document.x=200;target.document.y=0;
attacker.document.width=2;attacker.document.height=2;
target.document.width=2;target.document.height=2;
result=check({attackType:'melee',mode:'2d'});
assert.equal(result.status,'confirmed');
assert.equal(result.method,'adjacent-melee-large-squares');
assert.equal(result.type,'none');
scene.walls.contents.push(wall('large-corner',200,110,200,195));
result=check({attackType:'melee',mode:'2d'});
assert.equal(result.status,'confirmed',
 'large adjacent selection must handle walls instead of returning unknown');
assert.equal(result.type,'none',
 'large attacker selects an unobstructed neighboring square');
attacker.document.width=1;attacker.document.height=1;
target.document.width=1;target.document.height=1;
target.document.x=300;target.document.y=0;
scene.walls.contents.length=0;
// This engine only computes candidate defense adjustments; it must never
// write source documents or resolve any roll itself.
const snapshot=JSON.stringify(scene);
api.inspect({attacker,target});
assert.equal(JSON.stringify(scene),snapshot);
assert.equal(Object.isFrozen(result),false,'return safe clones to callers');
console.log('PASS cover PF1: sloping token LOS heights, partial/full/low walls, corners, elevations, roofs and no writes');
