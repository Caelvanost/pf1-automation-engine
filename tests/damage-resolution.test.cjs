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
 const {critical=[],half=false,index=0,ammoEntries=null,chatAmmoIds=null,afterGenerate=null,...overrides}=extra;
 const all=[...parts,...critical],raw=all.reduce((a,r)=>a+r.value,0),value=Math.floor(raw*(half?.5:1));
 const instances=all.map(r=>{
  const native=new DamagePartModel({types:r.types});native.value=r.value;
  return new DamagePartModel(native.toObject());
 });
 const attacks=Array.from({length:index+1},()=>({damage:[roll(c(99,'cold'))],critDamage:[]}));
 attacks[index]={damage:parts.map(roll),critDamage:critical.map(roll)};
 const options={value,ratio:1,reduction:0,interactive:true,
  message:{uuid:'ChatMessage.m',systemRolls:{attacks}},reference:'ChatMessage.m',attackIndex:index,
  isCritical:critical.length>0,instances,
  element:{dataset:{action:'applyDamage',type:critical.length?'critical':'normal',ratio:half?'0.5':'1',value:String(value)},
   closest:()=>({dataset:{index:String(index)}})},
  action:{actionType:'mwak',enhancementBonus:0,item:{type:'weapon'}},...overrides};
 const action=options.action,item=action?.item;
 if(item&&action){
  item.id??='w';item.actor??=action.actor??{uuid:'Actor.source'};
  item.actor.uuid??='Actor.source';action.actor??=item.actor;
  action.id??='a';item.uuid??=item.actor.uuid+'.Item.'+item.id;
  options.item??=item;
  options.message.system={actor:item.actor.uuid,item:{id:item.id},action:{id:action.id}};
  const data={flags:{pf1:{native:true},[ns]:{unrelated:'keep'}}};
  const use={action,item,shared:{chatData:data,chatAttacks:attacks,attacks:ammoEntries},generateChatAttacks(){return 'native-result'}};
  if(chatAmmoIds)attacks.forEach((a,i)=>a.ammo={id:chatAmmoIds[i]});
  hooks.get('pf1CreateActionUse')(use);
  assert.equal(use.generateChatAttacks(),'native-result');
  afterGenerate?.(use);
  hooks.get('pf1PreDisplayActionUse')(use);
  // Simulate persistence and subsequent reload, not shared object pointers.
  options.message.flags=JSON.parse(JSON.stringify(data.flags));
 }
 return options;
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
 actor:{system:{traits:{creatureSubtypes:{total:new Set(),custom:[]}}}},
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
assert.equal(hit(),7);assert.equal(hit(melee('silver')),12);assert.equal(hit(melee('steel',[],1)),12);
t.dr.value=[{amount:5,types:['good']}];
assert.equal(hit(),7);
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
assert.equal(hit(),7);
assert.equal(hit(melee('alchemicalSilver')),12);
assert.equal(hit(melee('steel',[],1)),12);
t.dr.value=[{amount:5,types:['alchemicalSilver','magic'],operator:false}];
assert.equal(hit(),7);
assert.equal(hit(melee('alchemicalSilver')),7);
assert.equal(hit(melee('steel',[],1)),7);
assert.equal(hit(melee('alchemicalSilver',[],1)),12);
assert.equal(hit(melee('steel',[],3)),12);
assert.equal(hit(melee('steel',[],3),{critical:[c(12,'slashing')]}),24);
assert.equal(hit(melee(),{half:true}),1);
const aligned=(id,base=false,override=null,enh=null,subtypes=[])=>{
 const action=melee('steel',[],enh);
 action.item.system.alignments[id]=base;
 action.alignments[id]=override;
 action.actor.system.traits.creatureSubtypes.total=new Set(subtypes);
 return action;
};
for(const id of ['good','evil','lawful','chaotic']){
 t.dr.value=[{amount:5,types:[id],operator:true}];
 assert.equal(hit(aligned(id)),7);
 assert.equal(hit(aligned(id,true)),12,'inherit item alignment');
 assert.equal(hit(aligned(id,false,true)),12,'positive action override');
 assert.equal(hit(aligned(id,true,false)),7,'negative action override');
 assert.equal(hit(aligned(id,false,null,4)),7);
 assert.equal(hit(aligned(id,false,null,5)),12,'+5 actual enhancement');
 assert.equal(hit(aligned(id,false,null,null,[id])),12,'matching prepared subtype');
 const unknown=aligned(id);delete unknown.actor.system.traits.creatureSubtypes;
 assert.equal(hit(unknown),0);assert.equal(api.lastDiagnostic(actor).reason,'unknown-alignment-bypass');
 unknown.actor.system.details={alignment:id};
 assert.equal(hit(unknown),0,'personal alignment not subtype');
 unknown.alignments[id]=true;assert.equal(hit(unknown),12,'explicit positive bypass works without subtype data');
 assert.equal(hit(melee('steel',[],5,{actionType:'rwak'})),0,'ranged provenance deferred');
}
t.dr.value=[{amount:5,types:['good','alchemicalSilver'],operator:false}];
assert.equal(hit(aligned('good',true)),7);
assert.equal(hit(melee('alchemicalSilver')),7);
const both=aligned('good',true);both.normalMaterial='alchemicalSilver';
assert.equal(hit(both),12);
assert.equal(hit(melee('steel',[],5)),12);
t.dr.value[0].operator=true;
assert.equal(hit(aligned('good',true)),12);
assert.equal(hit(melee('alchemicalSilver')),12);
assert.equal(hit(),7);
t.dr.value=[{amount:5,types:['slashing','magic'],operator:true}];
assert.equal(hit(),12);
t.dr.value[0].operator=false;assert.equal(hit(),7);assert.equal(hit(melee('steel',[],1)),12);
t.dr.value=[{amount:5,types:['slashing','unrecognized'],operator:true}];
assert.equal(hit(),12,'known true OR unknown is true');
t.dr.value[0].operator=false;
assert.equal(hit(),0);assert.equal(api.lastDiagnostic(actor).reason,'material-alignment-damage-reduction');
t.dr.value=[{amount:5,types:['piercing','unrecognized'],operator:false}];
assert.equal(hit(),7,'known false AND unknown is false');
t.dr.value=[{amount:5,types:['piercing','unrecognized'],operator:true}];
assert.equal(hit(),0);assert.equal(api.lastDiagnostic(actor).reason,'material-alignment-damage-reduction');
t.dr.value.push({amount:6,types:[]});
assert.equal(hit(),6,'unknown weaker DR cannot affect highest known RD');
t.dr.value=[{amount:5,types:['silver','magic']}];
assert.equal(hit(),0);assert.equal(api.lastDiagnostic(actor).reason,'complex-damage-reduction');
t.dr.value=[{amount:5,types:['good']}];
assert.equal(preview([c(12,'slashing')],{alignment:{values:{good:true},enhancement:0}}).total,12);
assert.equal(preview([c(12,'slashing')],{alignment:{values:{good:false},enhancement:0}}).total,7);
// Native chat source snapshot regression: live source mutation, persistence,
 // distinct cards and attacks, old cards, unknown values and mismatches.
const flag='damageSourceSnapshot';
t.dr.value=[{amount:5,types:['alchemicalSilver']}];
const original=melee('alchemicalSilver');
const cardA=opts([c(19,'slashing')],{action:original});
assert.equal(cardA.message.flags[ns].unrelated,'keep');
assert.equal(cardA.message.flags.pf1.native,true);
assert.equal(api.sourceSnapshot(cardA.message).material.normal,'alchemicalSilver');
original.normalMaterial='steel';original.enhancementBonus=0;
assert.equal(apply(cardA).value,19,'captured silver survives live mutation');
assert.equal(api.lastDiagnostic(actor).sourceSnapshot,'captured');
const cardB=opts([c(19,'slashing')],{action:original});
assert.equal(apply(cardB).value,14,'subsequent steel card independent');
const copy=api.sourceSnapshot(cardB.message);copy.material.normal='silver';
assert.equal(api.sourceSnapshot(cardB.message).material.normal,'steel','read API returns detached data');
const cardC=opts([c(12,'slashing')],{action:melee('steel',[],3),index:2});
cardC.action.enhancementBonus=0;
assert.equal(apply(cardC).value,12,'nonfirst attack preserves enhancement');
const repeat=opts([c(12,'slashing')],{action:melee('silver')});
const repeatData={flags:repeat.message.flags};
repeat.action.normalMaterial='steel';
hooks.get('pf1PreDisplayActionUse')({action:repeat.action,item:repeat.item,shared:{chatData:repeatData,chatAttacks:[{}]}});
assert.equal(apply(repeat).value,12,'repeat display does not overwrite');
const old=opts([c(12,'slashing')],{action:melee('silver')});
delete old.message.flags[ns][flag];
assert.equal(apply(old).value,0);assert.equal(api.lastDiagnostic(actor).reason,'damage-source-snapshot-missing');
t.dr.value=[{amount:5,types:['slashing']}];
const oldBasic=opts([c(12,'slashing')],{action:melee()});
delete oldBasic.message.flags[ns][flag];
assert.equal(apply(oldBasic).value,12,'old card simple physical DR still works');
t.dr.value=[{amount:5,types:['magic']}];
const mag=opts([c(12,'slashing')],{action:melee('steel',[],1)});
mag.action.enhancementBonus=0;
assert.equal(apply(mag).value,12);
const oldMag=opts([c(12,'slashing')],{action:melee('steel',[],1)});
delete oldMag.message.flags[ns][flag];
assert.equal(apply(oldMag).value,0);assert.equal(api.lastDiagnostic(actor).reason,'damage-source-snapshot-missing');
t.dr.value=[{amount:5,types:['good']}];
const holy=opts([c(12,'slashing')],{action:aligned('good',true)});
holy.action.item.system.alignments.good=false;
assert.equal(apply(holy).value,12);
t.dr.value=[{amount:5,types:['silver']}];
for(const change of [
 o=>o.message.flags[ns][flag].schema=99,
 o=>o.message.flags[ns][flag].material.addons={},
 o=>o.message.flags[ns][flag].magic="true"
]){
 const o=opts([c(12,'slashing')],{action:melee('silver')});
 change(o);assert.equal(apply(o).value,0);
 assert.equal(api.lastDiagnostic(actor).reason,'damage-source-snapshot-invalid');
}
for(const change of [
 o=>o.message.system.action.id='different',
 o=>o.message.system.actor='Actor.different',
 o=>o.action.item.uuid='Actor.other.Item.w',
 o=>o.message.flags[ns][flag].attackCount=2
]){
 const o=opts([c(12,'slashing')],{action:melee('silver')});
 change(o);assert.equal(apply(o).value,0);
 assert.equal(api.lastDiagnostic(actor).reason,'damage-source-snapshot-mismatch');
}
const noLive=opts([c(12,'slashing')],{action:melee('silver')});
delete noLive.action;delete noLive.item;
assert.equal(apply(noLive).value,12,'exact native card IDs suffice after deletion');
const noIdentity=opts([c(12,'slashing')],{action:melee('silver')});
delete noIdentity.action;delete noIdentity.item;delete noIdentity.message.system;
assert.equal(apply(noIdentity).value,0);assert.equal(api.lastDiagnostic(actor).reason,'damage-source-snapshot-mismatch');
settings.set('automaticDamageDefenses',false);
const whileOff=opts([c(12,'slashing')],{action:melee('silver')});
assert.ok(api.sourceSnapshot(whileOff.message),'capture independent of opt-in');
settings.set('automaticDamageDefenses',true);
whileOff.action.normalMaterial='steel';
assert.equal(apply(whileOff).value,12);
t.dr.value=[];t.eres.value=[{amount:5,types:['fire']}];
const oldEnergy=opts([c(12,'fire')]);delete oldEnergy.message.flags[ns][flag];
assert.equal(apply(oldEnergy).value,7);
// Natural weapons: native attack item, no name-based logic.
const natural=(enh=null,ownDR=[],subtypes=[])=>{
 const action=melee('steel',[],enh);
 action.item.type='attack';action.item.subType='natural';
 action.item.system.subType='natural';
 delete action.item.system.material;
 action.normalMaterial=null;action.addonMaterial=[];
 action.actor.system.traits.dr={value:ownDR,custom:''};
 action.actor.system.traits.creatureSubtypes.total=new Set(subtypes);
 return action;
};
const own=(...types)=>({amount:5,types,operator:true});
t.eres.value=[];
t.dr.value=[{amount:5,types:['magic']}];
assert.equal(hit(natural()),7,'mundane natural attack');
assert.equal(hit(natural(null,[own('magic')])),12,'own DR/magic qualifies natural weapon');
assert.equal(hit(natural(null,[own('epic')])),12,'own DR/epic counts as magical');
assert.equal(hit(natural(null,[own('silver')])),7,'material DR not inherited as magic');
assert.equal(hit(natural(null,[own('good')])),7,'alignment DR not inherited as magic');
assert.equal(hit(natural(1)),12,'configured enhancement +1');
const manufactured=melee();manufactured.actor.system.traits.dr={value:[own('magic')],custom:''};
assert.equal(hit(manufactured),7,'own magic DR does not enhance manufactured weapon');
const unspecified=natural();delete unspecified.actor.system.traits.dr;
assert.equal(hit(unspecified),0);assert.equal(api.lastDiagnostic(actor).reason,'unknown-magic-bypass');
const custom=natural();custom.actor.system.traits.dr.custom='special';
assert.equal(hit(custom),0);assert.equal(hit(natural(1,[own('magic')])),12);
t.dr.value=[{amount:5,types:['alchemicalSilver']}];
assert.equal(hit(natural(null,[own('alchemicalSilver')])),7,'own DR/silver does not make claws silver');
assert.equal(hit(natural(null,[own('magic')])),7,'innate magic not a numeric enhancement');
assert.equal(hit(natural(2)),7);assert.equal(hit(natural(3)),12);
const silverClaws=natural();silverClaws.addonMaterial=['alchemicalSilver'];
assert.equal(hit(silverClaws),12,'explicit native material property');
t.dr.value=[{amount:5,types:['coldIron']}];
assert.equal(hit(natural(3)),12);
t.dr.value=[{amount:5,types:['adamantine']}];
assert.equal(hit(natural(3)),7);assert.equal(hit(natural(4)),12);
t.dr.value=[{amount:5,types:['good']}];
assert.equal(hit(natural(null,[own('good')])),7,'own DR/good is not subtype good');
assert.equal(hit(natural(null,[],['good'])),12);
assert.equal(hit(natural(4)),7);assert.equal(hit(natural(5)),12);
const naturalHoly=natural();naturalHoly.alignments.good=true;
assert.equal(hit(naturalHoly),12);
t.dr.value=[{amount:5,types:['epic']}];
assert.equal(hit(natural()),7);assert.equal(hit(natural(null,[own('epic')])),12);
assert.equal(hit(natural(null,[own('magic')])),7);
assert.equal(hit(natural(5)),0);assert.equal(api.lastDiagnostic(actor).reason,'unknown-epic-bypass');
assert.equal(hit(natural(6)),12);
const epicNatural=natural(null,[own('epic')]);
const epicCard=opts([c(12,'slashing')],{action:epicNatural});
assert.equal(api.sourceSnapshot(epicCard.message).epic,true);
epicNatural.actor.system.traits.dr.value=[];
assert.equal(apply(epicCard).value,12,'persist innate epic from original attack');
const older=opts([c(12,'slashing')],{action:natural(null,[own('epic')])});
delete older.message.flags[ns][flag].epic;
assert.equal(api.sourceSnapshot(older.message).epic,null,'old snapshot stays valid');
assert.equal(apply(older).value,0);assert.equal(api.lastDiagnostic(actor).reason,'unknown-epic-bypass');
const malformedEpic=opts([c(12,'slashing')],{action:natural(null,[own('epic')])});
malformedEpic.message.flags[ns][flag].epic='true';
assert.equal(apply(malformedEpic).value,0);assert.equal(api.lastDiagnostic(actor).reason,'damage-source-snapshot-invalid');
t.dr.value=[{amount:5,types:['magic','good'],operator:false}];
assert.equal(hit(natural(null,[own('magic')],['good'])),12);
assert.equal(hit(natural(null,[own('magic')],[])),7);
t.dr.value[0].operator=true;
assert.equal(hit(natural(null,[],['good'])),12);
const magicCard=opts([c(12,'slashing')],{action:natural(null,[own('magic')])});
magicCard.action.actor.system.traits.dr.value=[];
t.dr.value=[{amount:5,types:['magic']}];
assert.equal(apply(magicCard).value,12);
assert.equal(hit(natural(null,[own('magic')]),{critical:[c(12,'slashing')]}),24);
assert.equal(hit(natural(),{half:true}),1);
// Projectiles: source selection on shared.attacks, native document identity,
 // own enhancement versus launcher, persistence and heterogeneous pairing.
const ranged=(enh=null,normal='steel')=>melee(normal,[],enh,{actionType:'rwak',isRanged:true,ammo:{type:'arrow',cost:1}});
const ammo=(action,id,dict={},bool=[],extra={})=>{
 const actor=action.actor;actor.uuid??='Actor.source';
 const doc={id,uuid:actor.uuid+'.Item.'+id,actor,type:'ammo',
  system:{subType:action.ammo.type,flags:{dictionary:dict,boolean:new Set(bool)},...extra}};
 return {hasAmmo:true,ammo:{id,document:doc}};
};
const shoot=(action,entry,extra={})=>apply(opts([c(12,'piercing')],{action,ammoEntries:[entry],...extra})).value;
t.dr.value=[{amount:5,types:['silver']}];
let bow=ranged(5,'silver'),arrow=ammo(bow,'a');
assert.equal(shoot(bow,arrow),7,'launcher silver and +5 do not transfer material bypass');
assert.equal(shoot(bow,ammo(bow,'a',{Material:'alchemicalSilver'})),12);
assert.equal(shoot(bow,ammo(bow,'a',{Enhancement:3})),12);
assert.equal(shoot(bow,ammo(bow,'a',{Enhancement:2})),7);
t.dr.value=[{amount:5,types:['magic']}];
assert.equal(shoot(bow,arrow),12,'magic launcher transfers magic');
bow=ranged();assert.equal(shoot(bow,ammo(bow,'a')),7);
assert.equal(shoot(bow,ammo(bow,'a',{},['Magic'])),12);
assert.equal(shoot(bow,ammo(bow,'a',{Enhancement:1})),12);
t.dr.value=[{amount:5,types:['good']}];
bow=ranged(5);assert.equal(shoot(bow,ammo(bow,'a')),7,'launcher +5 is not alignment');
bow.alignments.good=true;assert.equal(shoot(bow,ammo(bow,'a')),12);
bow.alignments.good=null;assert.equal(shoot(bow,ammo(bow,'a',{Alignment:'good'})),12);
assert.equal(shoot(bow,ammo(bow,'a',{Enhancement:5})),12);
t.dr.value=[{amount:5,types:['silver']}];
bow=ranged();arrow=ammo(bow,'a',{Material:'alchemicalSilver'});
const ordinary=ammo(bow,'b');
const mixed=opts([c(12,'piercing')],{action:bow,index:1,ammoEntries:[arrow,ordinary],chatAmmoIds:['b','a']});
assert.equal(api.sourceSnapshot(mixed.message).perAttack[1].ammoId,'a');
assert.equal(apply(mixed).value,12,'explicit chat ammo identity, not assumed ordering');
const ambiguous=opts([c(12,'piercing')],{action:bow,index:1,ammoEntries:[arrow,ordinary]});
assert.equal(apply(ambiguous).value,0);assert.equal(api.lastDiagnostic(actor).reason,'unknown-material-bypass');
const uniform=opts([c(12,'piercing')],{action:bow,index:1,ammoEntries:[arrow,arrow],
 afterGenerate(){arrow.ammo.document.system.flags.dictionary.Material='steel';}});
assert.equal(apply(uniform).value,12,'capture before generation/consumption');
assert.equal(api.sourceSnapshot(uniform.message).perAttack[0].material.normal,'alchemicalSilver');
const badAmmo=ammo(bow,'a',{Material:'alchemicalSilver'});badAmmo.ammo.document.uuid='Actor.other.Item.a';
assert.equal(shoot(bow,badAmmo),0);
const missing=opts([c(12,'piercing')],{action:bow});
assert.equal(apply(missing).value,0);
const invalid=opts([c(12,'piercing')],{action:bow,ammoEntries:[ordinary]});
invalid.message.flags[ns][flag].perAttack=[];
assert.equal(apply(invalid).value,0);assert.equal(api.lastDiagnostic(actor).reason,'damage-source-snapshot-invalid');
const gun=ranged();gun.ammo.type='gunBullet';gun.item.system.ammo={default:'bullet'};
const bullet=ammo(gun,'bullet',{Material:'alchemicalSilver'},[],{subType:'ammo'});
bullet.ammo.document.type='loot';
assert.equal(shoot(gun,bullet),12,'PF1FR explicitly linked legacy ammo');
gun.item.system.ammo.default='other';assert.equal(shoot(gun,bullet),0);
const thrown=melee('steel',[],3,{actionType:'twak',isRanged:true});
assert.equal(hit(thrown),12,'actual thrown weapon enhancement');
assert.equal(hit(melee('alchemicalSilver',[],null,{actionType:'twak',isRanged:true})),12);
console.log('PASS damage resolution: native traits, material DR, per-hit maximum RD/ER, immunity, vulnerability, ratio, conflict, manual fallback');
