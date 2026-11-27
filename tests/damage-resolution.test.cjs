'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ns='pf1-automation-engine',mod={active:true,api:{}},ad={active:false},hooks=new Map(),settings=new Map([['genericEnabled',true]]);
const warnings=[],game={release:{generation:13},system:{id:'pf1',version:'11.11'},i18n:{lang:'fr'},
 modules:new Map([[ns,mod],['pf1-automate-damage',ad]]),
 settings:{register(_n,k,o){settings.set(k,o.default)},get(_n,k){return settings.get(k)}}};
const ctx={game,console,ui:{notifications:{warn:m=>warnings.push(m)}},Hooks:{once:(n,fn)=>hooks.set(n,fn),on:(n,fn)=>hooks.set(n,fn)}};
ctx.globalThis=ctx;vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../scripts/damage-resolution.js'),'utf8'),ctx);
hooks.get('init')();hooks.get('ready')();
const api=mod.api.damageResolution,actor={uuid:'Scene.s.Token.t.Actor.a',system:{traits:{di:{standard:new Set(),custom:[]},dv:{standard:new Set(),custom:[]},eres:{value:[],custom:''},dr:{value:[],custom:''},hardness:0}}};
const t=actor.system.traits,c=(value,...types)=>({value,types:new Set(types)});
const preview=(components,extra={})=>api.preview({actor,components,sourceKind:'weapon',magic:false,...extra});
// Reproduce the actual PF1 11.11 clone: .value is not a schema field,
// so toObject() drops it. The serialized DamageRolls keep their totals.
class DamagePartModel{
 constructor(data){this.formula=data.formula??"";this.types=new Set(data.types)}
 toObject(){return {formula:this.formula,types:[...this.types]}}
}
const roll=r=>({total:r.value,damageType:new DamagePartModel({types:r.types})});
const opts=(parts,extra={})=>{
 const {critical=[],half=false,index=0,...overrides}=extra;
 const all=[...parts,...critical],raw=all.reduce((a,r)=>a+r.value,0),value=Math.floor(raw*(half?.5:1));
 const instances=all.map(r=>{
  const native=new DamagePartModel({types:r.types});native.value=r.value;
  return new DamagePartModel(native.toObject());
 });
 const attacks=Array.from({length:index+1},()=>({damage:[roll(c(99,'cold'))],critDamage:[]}));
 attacks[index]={damage:parts.map(roll),critDamage:critical.map(roll)};
 return {value,ratio:1,reduction:0,interactive:true,
  message:{uuid:'ChatMessage.m',systemRolls:{attacks}},reference:'ChatMessage.m',attackIndex:index,
  isCritical:critical.length>0,instances,
  element:{dataset:{action:'applyDamage',type:critical.length?'critical':'normal',ratio:half?'0.5':'1',value:String(value)},
   closest:()=>({dataset:{index:String(index)}})},
  action:{actionType:'mwak',enhancementBonus:0,item:{type:'weapon'}},...overrides};
};
const apply=o=>{hooks.get('pf1ApplyDamage')(actor,o);return o};
assert.equal(settings.get('automaticDamageDefenses'),false);
t.eres.value=[{amount:5,types:['fire']},{amount:3,types:['fire']}];
assert.equal(preview([c(4,'fire'),c(4,'fire')]).total,3,'highest resistance once per attack and type');
assert.equal(preview([c(4,'fire'),c(4,'cold')]).total,4);
t.dr.value=[{amount:5,types:[]},{amount:3,types:[]}];
assert.equal(preview([c(14,'slashing'),c(8,'fire')]).total,12,'highest DR once and energy separate');
assert.equal(preview([c(14,'slashing')],{sourceKind:'other'}).total,14,'spell damage ignores DR');
t.dr.value=[{amount:5,types:['magic']},{amount:2,types:[]}];
assert.equal(preview([c(14,'slashing')],{magic:true}).total,12);
assert.equal(preview([c(14,'slashing')],{magic:false}).total,9);
assert.equal(preview([c(14,'slashing')],{magic:null}).supported,false);
t.dr.value=[{amount:5,types:['slashing']}];
assert.equal(preview([c(14,'slashing')]).total,14);
assert.equal(preview([c(14,'piercing')]).total,9);
t.di.standard.add('fire');assert.equal(preview([c(8,'fire'),c(3,'cold')]).total,3);t.di.standard.clear();
t.dv.standard.add('cold');assert.equal(preview([c(3,'cold')]).total,4);
t.dv.standard.add('fire');assert.equal(preview([c(8,'fire')]).supported,false,'ambiguous ordering deferred');
t.dv.standard.clear();t.dr.value=[];t.eres.value=[];
assert.equal(preview([c(3,'fire'),c(3,'cold')],{ratio:.5}).total,3,'whole attack rounded once');
assert.equal(preview([c(7,'slashing','piercing')]).supported,false);
assert.equal(preview([c(7,'fire','nonlethal')]).supported,false);
assert.equal(preview([c(7,'fire','nonlethal')],{asNonlethal:true}).total,7);
t.di.standard.add('nonlethal');assert.equal(preview([c(7,'slashing')],{asNonlethal:true}).total,0);t.di.standard.clear();
t.di.standard.add('precision');assert.equal(preview([c(7,'slashing','precision')]).reason,'modifier-tag-defense');t.di.standard.clear();
t.dr.value=[{amount:5,types:[]}];assert.equal(preview([c(7,'untyped')]).reason,'untyped-with-damage-reduction');t.dr.value=[];
assert.equal(preview([c(3,'abilityDamage')]).supported,false);
t.hardness=5;assert.equal(preview([c(8,'fire')]).supported,false);t.hardness=0;
t.eres.value=[{amount:5,types:['fire']}];
assert.equal(apply(opts([c(8,'fire')])).value,8,'disabled by default');
settings.set('automaticDamageDefenses',true);
ad.active=true;assert.equal(api.isAvailable(),false);assert.equal(apply(opts([c(8,'fire')])).value,8);ad.active=false;
assert.equal(api.isAvailable(),true);
let o=apply(opts([c(8,'fire')]));assert.equal(o.value,3);assert.equal(o.reduction,0);assert.equal(o.ratio,1);
assert.equal(apply(o).value,3,'same native context never double processed');
o=apply(opts([c(8,'fire')],{half:true}));assert.equal(o.value,0,'half damage before resistance');
t.eres.value=[];t.dr.value=[];
o=opts([c(16,'slashing')]);assert.equal(o.instances[0].value,undefined);
assert.equal(apply(o).value,16,'actual native schema clone does not block unmitigated damage');
t.dr.value=[{amount:5,types:[]}];t.eres.value=[{amount:5,types:['fire']}];
assert.equal(apply(opts([c(14,'slashing'),c(8,'fire')],{index:2})).value,12,'exact nonfirst attack and separate defenses');
assert.equal(apply(opts([c(14,'slashing')],{half:true})).value,2);
assert.equal(apply(opts([c(14,'slashing')],{critical:[c(11,'slashing'),c(8,'fire')]})).value,23,'normal and critical rolls combined, DR once');
o=opts([c(16,'slashing')]);o.instances[0].value=16;
assert.equal(apply(o).value,11,'preserved runtime value verified');
o=opts([c(16,'slashing')]);o.instances[0].value=12;
assert.equal(apply(o).value,0);assert.equal(api.lastDiagnostic(actor).reason,'native-card-instance-mismatch');
o=opts([c(16,'slashing')]);o.instances[0].types=new Set(['fire']);
assert.equal(apply(o).value,0);assert.equal(api.lastDiagnostic(actor).reason,'native-card-instance-mismatch');
o=opts([c(16,'slashing')]);o.attackIndex=1;
assert.equal(apply(o).value,0);assert.equal(api.lastDiagnostic(actor).reason,'native-card-attack-mismatch');
o=opts([c(16,'slashing')]);delete o.message.systemRolls;
assert.equal(apply(o).value,0);assert.equal(api.lastDiagnostic(actor).reason,'missing-native-card-rolls');
o=opts([c(16,'slashing')]);o.value=15;
assert.equal(apply(o).value,0);assert.equal(api.lastDiagnostic(actor).reason,'native-card-total-mismatch');
o=opts([c(16,'slashing')]);o.element.dataset.type='critical';
assert.equal(apply(o).value,0);assert.equal(api.lastDiagnostic(actor).reason,'native-card-attack-mismatch');
t.dr.value=[];t.eres.value=[{amount:5,types:['fire']}];

assert.equal(apply(opts([c(8,'fire')],{dialog:true,reduction:5})).value,8,'native dialog untouched');
assert.equal(apply(opts([c(8,'fire')],{reduction:2})).value,8,'manual reduction untouched');
assert.equal(apply(opts([c(8,'fire')],{value:-8})).value,-8,'healing untouched');
assert.equal(apply({value:8,ratio:1,reduction:0}).value,8,'raw damage untouched');
// Native live diagnostic, Foundry 13.351 / PF1 11.11, Water Naga.
// The action's enhancement is null for this mundane steel weapon.
const melee=(normal='steel',addons=[],enh=null,extra={})=>({
 actionType:'mwak',normalMaterial:normal,addonMaterial:addons,
 material:{normal:{custom:false},addon:[]},enhancementBonus:enh,
 alignments:{lawful:null,chaotic:null,good:null,evil:null},
 ammo:{type:null,cost:0,misfire:null},
 item:{type:'weapon',system:{enh,material:{base:{value:'steel',custom:false},
   normal:{value:'',custom:false},addon:[]},alignments:{lawful:false,chaotic:false,good:false,evil:false}}},
 ...extra
});
const hit=(action=melee(),extra={})=>apply(opts([c(12,'slashing')],{action,...extra})).value;
t.eres.value=[];
t.dr.value=[{amount:5,types:['silver'],operator:true}];
assert.equal(hit(),7,'live regression: steel vs Water Naga RD 5/silver, null enhancement');
assert.equal(hit(melee('silver')),12);
assert.equal(hit(melee('mithral')),12);
assert.equal(hit(melee('steel',['alchemicalSilver'])),12,'effective addon bypass');
assert.equal(hit(melee('steel',[],2)),7);
assert.equal(hit(melee('steel',[],3)),12);
assert.equal(hit(melee('steel',[],null),{half:true}),1,'half before RD');
assert.equal(hit(melee(),{critical:[c(12,'slashing')]}),19,'DR once on critical');
assert.equal(hit(melee(),{index:2}),7);
t.dr.value.push({amount:3,types:[]});
assert.equal(hit(melee('silver')),9,'highest remaining RD after bypass');
assert.equal(hit(),7,'DR never stacks');
t.dr.value=[{amount:5,types:['coldIron'],operator:true}];
assert.equal(hit(),7);assert.equal(hit(melee('coldIron')),12);
assert.equal(hit(melee('steel',[],3)),12);
t.dr.value=[{amount:5,types:['adamantine'],operator:true}];
assert.equal(hit(melee('adamantine')),12);assert.equal(hit(melee('steel',[],3)),7);
assert.equal(hit(melee('steel',[],4)),12);
t.hardness=5;assert.equal(hit(melee('steel',[],4)),0);
assert.equal(api.lastDiagnostic(actor).reason,'hardness-next-stage');t.hardness=0;
t.dr.value=[{amount:5,types:['magic']}];
assert.equal(hit(),7,'native null enhancement is mundane for verified melee');
assert.equal(hit(melee('steel',[],1)),12);
t.dr.value=[{amount:5,types:['silver']}];
assert.equal(hit(melee('unknownCustom')),0);
assert.equal(api.lastDiagnostic(actor).reason,'unknown-material-bypass');
assert.equal(hit(melee('steel',['unknownAddon'])),0);
assert.equal(hit(melee('steel',[],null,{material:{normal:{custom:true}}})),0);
assert.equal(hit(melee('silver',[],null,{actionType:'rwak'})),0,'do not use launcher material');
assert.equal(hit(melee('steel',[],5,{actionType:'rwak'})),0,'launcher enhancement does not bypass material DR');
assert.equal(hit(melee('silver',[],null,{ammo:{type:'arrow'}})),0);
assert.equal(hit(melee('silver',[],null,{item:{type:'attack',subType:'natural'}})),0);
o=apply(opts([c(9,'slashing')]));assert.equal(o.value,0);assert.ok(warnings.length);assert.equal(api.lastDiagnostic(actor).reason,'unknown-material-bypass');
t.dr.value=[{amount:5,types:['silver','magic'],operator:true}];
assert.equal(hit(),0);assert.equal(api.lastDiagnostic(actor).reason,'complex-damage-reduction');
t.dr.value=[{amount:5,types:['good']}];
assert.equal(hit(),0);assert.equal(api.lastDiagnostic(actor).reason,'material-alignment-damage-reduction');
// Exact second live report: native RD criterion alchemicalSilver, 19 slashing,
// steel, null enhancement. Both preview and native application must agree.
t.dr.value=[{amount:5,types:['alchemicalSilver'],operator:true}];
const before=JSON.stringify(t.dr);
const silverPreview=preview([c(19,'slashing')],{material:{normal:'steel',addons:[],enhancement:0}});
assert.equal(silverPreview.supported,true);
assert.equal(silverPreview.total,14);
assert.equal(silverPreview.damageReduction,5);
const steelHit=apply(opts([c(19,'slashing')],{action:melee()}));
assert.equal(steelHit.value,14);
assert.equal(api.lastDiagnostic(actor).damageReduction,5);
for(const material of ['alchemicalSilver','silver','mithral'])assert.equal(hit(melee(material)),12);
assert.equal(hit(melee('steel',['alchemicalSilver'])),12);
assert.equal(hit(melee('steel',[],2)),7);
assert.equal(hit(melee('steel',[],3)),12);
assert.equal(hit(melee(),{half:true}),1);
assert.equal(hit(melee(),{critical:[c(12,'slashing')]}),19);
assert.equal(hit(melee('unknownCustom')),0);
assert.equal(api.lastDiagnostic(actor).reason,'unknown-material-bypass');
assert.equal(JSON.stringify(t.dr),before,'native traits are unchanged');
t.dr.value.push({amount:3,types:[]});
assert.equal(hit(melee('alchemicalSilver')),9);
assert.equal(hit(),7);
t.dr.value=[{amount:5,types:['alchemicalSilver','magic'],operator:true}];
assert.equal(hit(),0);
assert.equal(api.lastDiagnostic(actor).reason,'complex-damage-reduction');
console.log('PASS damage resolution: native traits, material DR, per-hit maximum RD/ER, immunity, vulnerability, ratio, conflict, manual fallback');
