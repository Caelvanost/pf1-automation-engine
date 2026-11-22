'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.resolve(__dirname,'../scripts/native-cover-provenance.js'),'utf8');
const once=[],mod={api:{}};
const ctx={console,Hooks:{once(_n,fn){once.push(fn)}},game:{modules:new Map([['pf1-automation-engine',mod]])},
 foundry:{utils:{deepClone:structuredClone}},Object,Number,Map,Set};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(code,ctx,{filename:'native-cover-provenance.js'});
for(const callback of once)callback();
const api=mod.api.nativeCover;
const actor={
 system:{attributes:{ac:{normal:{total:21},touch:{total:14},flatFooted:{total:18}}}},
 sourceInfo:{},
 getSourceDetails(path){return this.sourceInfo[path]??[]}
};
function set(sources,defense='normal'){
 actor.sourceInfo['system.attributes.ac.'+defense+'.total']=sources;
}
let r=api.inspect({actor});
assert.equal(r.status,'resolved');
assert.equal(r.nativeCover,0,'empty native breakdown => no typed cover');
set([{name:'Armor',modifier:'armor',value:5},
 {name:'Dexterity',modifier:'dodge',value:2}]);
assert.equal(api.inspect({actor}).nativeCover,0);
set([{name:'Cover from wall',modifier:'cover',value:4,disabled:false},
 {name:'Suppressed cover',modifier:'cover',value:2,disabled:true},
 {name:'Armor',modifier:'armor',value:5}]);
r=api.inspect({actor});
assert.equal(r.status,'resolved');
assert.equal(r.nativeCover,4);
assert.equal(r.coverSourceCount,1);
set([{name:'Cover 1',modifier:'cover',value:2},
 {name:'Cover 2',modifier:'cover',value:4}]);
assert.equal(api.inspect({actor}).status,'uncertain','two cover sources not automatically summed');
set([{name:'Custom bonus',modifier:null,value:2}]);
r=api.inspect({actor});
assert.equal(r.status,'resolved',
 'untyped native AC source does not imply a cover modifier');
assert.equal(r.nativeCover,0);
set([{name:'Other',modifier:'mystery',value:3}]);
assert.equal(api.inspect({actor}).status,'resolved',
 'only explicitly cover-typed native sources affect cover baseline');
set([
 {name:'Armure de cuir',value:'Max. Dex +6',modifier:null},
 {name:'Dodge (Don)',value:1,modifier:'dodge'},
 {name:'Armure de cuir (Armure)',value:2,modifier:'base',disabled:false},
 {name:'Miscellaneous Notes (Divers)',value:1,modifier:'untyped'},
 {name:'Dextérité',value:2,modifier:null},
 {name:'Base',value:10,modifier:undefined}
]);
r=api.inspect({actor});
assert.equal(r.status,'resolved',
 'real Harpy PF1 native source details should be supported');
assert.equal(r.nativeCover,0,'no explicit cover entry in Harpy AC');
set([{name:'Manual typed cover',modifier:'cover',value:'4'}]);
assert.equal(api.inspect({actor}).status,'uncertain');
set([{name:'Suppressed',modifier:'cover',value:4,disabled:true}]);
assert.equal(api.inspect({actor}).nativeCover,0);
set([{name:'Negative',modifier:'cover',value:-2}]);
assert.equal(api.inspect({actor}).status,'uncertain');
set([{name:'Cover',modifier:'cover',value:2}], 'touch');
assert.equal(api.inspect({actor,defense:'touch'}).nativeCover,2);
assert.equal(api.inspect({actor,defense:'cmd'}).status,'uncertain');
assert.equal(api.inspect({actor:{system:actor.system}}).status,'uncertain');
assert.equal(api.lastDiagnostic().status,'uncertain');
set([{name:'Deflection ring',modifier:'deflection',value:2},
 {name:'Armor',modifier:'armor',value:5}]);
let typed=api.inspectTypes({actor,defense:'normal',types:['deflection','sacred']});
assert.equal(typed.status,'resolved');
assert.equal(typed.nativeTypes.deflection,2,'native typed baseline is retained');
assert.equal(typed.nativeTypes.sacred,0,'verified absent type is zero');
set([{name:'Deflection 1',modifier:'deflection',value:1},
 {name:'Deflection 2',modifier:'deflection',value:2}]);
typed=api.inspectTypes({actor,defense:'normal',types:['deflection']});
assert.equal(typed.status,'uncertain','ambiguous same-type native sources fail closed');
set([{name:'Deflection penalty',modifier:'deflection',value:-1}]);
typed=api.inspectTypes({actor,defense:'normal',types:['deflection']});
assert.equal(typed.status,'uncertain','negative source cannot be treated as positive baseline');
assert.equal(actor.system.attributes.ac.normal.total,21,'never modify native sheet AC');
console.log('PASS native-cover provenance: PF1 normal and untyped AC details, typed cover deduplication, malformed cover and no writes');
