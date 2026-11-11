'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../scripts/range-automation.js'),'utf8');
const settings=new Map([['genericEnabled',true],['genericDebug',false],['autoRangePenalties',true]]);
const hooks=new Map();
const scene={id:'s',grid:{units:'m'}};
const token=(id,points)=>({name:id,document:{parent:scene},getOccupiedCells:()=>points});
const attacker=token('Hero',[{x:0,y:0}]);
let target=token('Enemy',[{x:4,y:0}]);
const targets=new Set([target]);
const grid={measurePath([a,b]){return {distance:Math.hypot(b.x-a.x,b.y-a.y)*(scene.grid.units==='ft'?5:1.5)}}};
const warnings=[];
const context={console,Math,Number,Set,globalThis:null,
 game:{user:{targets},modules:new Map([['pf1-automation-engine',{active:true,api:{}}]]),
 settings:{register(_ns,key,cfg){if(!settings.has(key))settings.set(key,cfg.default)},
 get(_ns,key){return settings.get(key)}}},
 canvas:{scene,grid},pf1:{settings:{distance:{metric:false}}},
 ui:{notifications:{warn:(msg)=>warnings.push(msg)}},
 Hooks:{once(name,fn){if(!hooks.has(name))hooks.set(name,[]);hooks.get(name).push(fn)},
 on(name,fn){if(!hooks.has(name))hooks.set(name,[]);hooks.get(name).push(fn)}}
};
context.globalThis=context;
vm.createContext(context);vm.runInContext(source,context);
for(const cb of hooks.get('init')??[])cb();
for(const cb of hooks.get('ready')??[])cb();
const makeUse=(dist=6,{units='ft',sceneUnits='m',value=20,actionType='rwak',max=10,metric=false,withRange=true}={})=>{
  attacker.document.parent=scene;
  context.pf1.settings.distance.metric=metric;
  scene.grid.units=sceneUnits;
  target=token('Enemy',[{x:dist/(scene.grid.units==='m'?1.5:5),y:0}]);
  targets.clear();targets.add(target);
  const config={rangeIncrement:1,rangeIncrementPenalty:2};
  const action={name:'Ranged attack',actionType,isRanged:true,hasAttack:true,
    range:{value:String(value),units,maxIncrements:max},
    ...(withRange?{getRange(){return metric?Number(value)*(units==='ft'?0.3:1):Number(value)*(units==='m'?1/0.3:1)}}:{})};
  return {actor:{name:'Hero'},item:{name:'Weapon'},token:attacker,
   action,shared:{config,formData:{},useOptions:{},rollData:{}}};
};
const hook=hooks.get('pf1CreateActionUse')[0];
const api=context.game.modules.get('pf1-automation-engine').api.range;
const check=(distance,expected,options)=>{
 const use=makeUse(distance,options);
 hook(use);
 assert.equal(use.shared.config.rangeIncrement,expected.factor);
 if(expected.penalty)assert.equal((use.shared.config.rangeIncrement-1)*2,-expected.penalty);
};
check(0,{factor:1,penalty:0});
check(6,{factor:1,penalty:0});
check(6.00001,{factor:2,penalty:-2});
check(12,{factor:2,penalty:-2});
check(13.5,{factor:3,penalty:-4});
check(19.5,{factor:4,penalty:-6});
assert.equal(api.calculate(20,20,10).penalty,0);
assert.equal(api.calculate(20.0001,20,10).penalty,-2);
assert.equal(api.calculate(201,20,10).outOfRange,true);
assert.equal(api.calculate(6+1e-11,6,10).factor,1);
assert.equal(api.convert(20,'ft','m'),6);
assert.equal(api.convert(6,'m','ft'),20);
const metric=makeUse(30,{value:20,units:'m',metric:true});
hook(metric);assert.equal(metric.shared.config.rangeIncrement,2);
const feet=makeUse(40,{units:'ft',sceneUnits:'ft',value:20,metric:false});
hook(feet);assert.equal(feet.shared.config.rangeIncrement,2);
const thrown=makeUse(12,{actionType:'twak',max:5});
hook(thrown);assert.equal(thrown.shared.config.rangeIncrement,2);
const outside=makeUse(210);
hook(outside);assert.equal(outside.shared.config.rangeIncrement,1);
assert.equal(warnings.length,1);
const noIncrement=makeUse(12,{max:1});
hook(noIncrement);assert.equal(noIncrement.shared.config.rangeIncrement,1);
const melee=makeUse(12,{actionType:'mwak'});
hook(melee);assert.equal(melee.shared.config.rangeIncrement,1);
const spell=makeUse(12,{actionType:'rsak'});
hook(spell);assert.equal(spell.shared.config.rangeIncrement,1);
const skipped=makeUse(12);skipped.shared.useOptions.skipRangeIncrementChecks=true;
hook(skipped);assert.equal(skipped.shared.config.rangeIncrement,1);
const overridden=makeUse(12);overridden.shared.config.rangeIncrement=3;
hook(overridden);assert.equal(overridden.shared.config.rangeIncrement,3);
const manual=makeUse(12);manual.shared.formData.rangePenalty=7;
hook(manual);assert.equal(manual.shared.config.rangeIncrement,1);
const nativeDefault=makeUse(9);
nativeDefault.shared.formData.rangePenalty=0;
nativeDefault.shared.config.rangePenalty=0;
hook(nativeDefault);
assert.equal(nativeDefault.shared.config.rangeIncrement,2,'PF1 native zero defaults must not block automation');
assert.equal(nativeDefault.shared.formData.rangePenalty,2,'native range penalty must enter the roll');
const tokenDocument=makeUse(9);
tokenDocument.token={documentName:'Token',parent:scene,object:attacker};
hook(tokenDocument);
assert.equal(tokenDocument.shared.formData.rangePenalty,2,'ActionUse.token may be TokenDocument');
assert.equal(context.game.modules.get('pf1-automation-engine').api.range.lastDiagnostic().status,'configured');
const ambiguous=makeUse(12);targets.add(token('Second',[{x:4,y:0}]));
hook(ambiguous);assert.equal(ambiguous.shared.config.rangeIncrement,1);
targets.clear();hook(ambiguous);assert.equal(ambiguous.shared.config.rangeIncrement,1);
const misplaced=makeUse(12);misplaced.token.document.parent={id:'other'};
hook(misplaced);assert.equal(misplaced.shared.config.rangeIncrement,1);
const cancelled=makeUse(12);settings.set('autoRangePenalties',false);
hook(cancelled);assert.equal(cancelled.shared.config.rangeIncrement,1);
settings.set('autoRangePenalties',true);
const repeat=makeUse(12);hook(repeat);hook(repeat);
assert.equal(repeat.shared.config.rangeIncrement,2,'one native modifier only');
assert.equal(repeat.shared.formData.rangePenalty,2,'native formData also receives penalty for skipDialog');
assert.equal(repeat.shared.attackBonus,undefined,'no custom attack bonus');
console.log('PASS native range: boundaries, metric, feet, thrown, targets, out-of-range, skip, manual, no duplication');
