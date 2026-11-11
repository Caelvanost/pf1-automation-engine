'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'module.json'),'utf8'));
const bundles=Object.fromEntries((manifest.languages??[]).map(l=>[
  l.lang,JSON.parse(fs.readFileSync(path.join(root,l.path),'utf8')).PF1AE
]));
assert.deepEqual(Object.keys(bundles).sort(),['en','fr']);
const collect=(node,prefix='')=>Object.entries(node).flatMap(([key,value])=>{
 const full=prefix?prefix+'.'+key:key;
 return value&&typeof value==='object'?collect(value,full):[[full,value]];
});
const en=new Map(collect(bundles.en)),fr=new Map(collect(bundles.fr));
assert.deepEqual([...en.keys()].sort(),[...fr.keys()].sort(),'both languages have the same translation keys');
for(const [key,value] of en){
 assert.equal(typeof value,'string',key);
 assert.ok(value.trim(),key);
 assert.equal(typeof fr.get(key),'string',key);
 assert.ok(fr.get(key).trim(),key);
 for(const lang of [value,fr.get(key)]){
  const tokens=[...lang.matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort();
  const other=lang===value?fr.get(key):value;
  assert.deepEqual(tokens,[...other.matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort(),key+' placeholders');
 }
}
assert.equal(bundles.fr.Range.Penalty,'Pénalité de portée');
assert.equal(bundles.en.Range.Penalty,'Range penalty');
assert.notEqual(bundles.fr.Settings.TrustedTable.Name,bundles.en.Settings.TrustedTable.Name);
const scripts=['range-automation','generic-automation','script-approvals',
 'auto-discovery','effect-manager','module-migration','save-overrides'];
for(const name of scripts){
 const src=fs.readFileSync(path.join(root,'scripts',name+'.js'),'utf8');
 for(const key of src.matchAll(/PF1AE\.([A-Za-z][A-Za-z0-9.]+)/g)){
  // Some API identifiers inside strings are not translation keys. Validate
  // only names following game.i18n localize/format or the named helpers.
  const sub=src.slice(Math.max(0,key.index-60),key.index+key[0].length+20);
  if(!/localize|format/.test(sub))continue;
  assert.ok(en.has(key[1]),name+' missing EN '+key[1]);
  assert.ok(fr.has(key[1]),name+' missing FR '+key[1]);
 }
}
const rangeSource=fs.readFileSync(path.join(root,'scripts/range-automation.js'),'utf8');
const testLabel=(language)=>{
 const hooks={},settings=new Map([['genericEnabled',true],['autoRangePenalties',true],['genericDebug',false]]);
 const scene={id:'s',grid:{units:'m'}};
 const tok=(x)=>({document:{parent:scene},getOccupiedCells:()=>[{x,y:0}]});
 const actor=tok(0),target=tok(6);
 const data={action:{name:'Attack',actionType:'rwak',isRanged:true,hasAttack:true,
   range:{value:'20',units:'ft',maxIncrements:10}},
   actor:{name:'Hero'},item:{name:'Pistol'},token:actor,
   shared:{config:{rangeIncrement:1,rangeIncrementPenalty:2},formData:{},
   useOptions:{},rollData:{},attackBonus:[]}};
 const i18n={localize:key=>{
   const parts=key.split('.').slice(1);
   return parts.reduce((v,k)=>v?.[k],bundles[language])??key;
 }};
 const ctx={console,Map,Set,WeakSet,Number,Math,globalThis:null,
 game:{i18n,user:{targets:new Set([target])},modules:new Map([['pf1-automation-engine',{active:true,api:{}}]]),
  settings:{get:(_ns,key)=>settings.get(key),register:()=>{}}},
 canvas:{scene,grid:{measurePath:([a,b])=>({distance:Math.abs(a.x-b.x)*1.5})}},
 ui:{notifications:{warn:()=>{}}},
 Hooks:{once(name,fn){(hooks[name]??=[]).push(fn)},on(name,fn){(hooks[name]??=[]).push(fn)}}};
 ctx.globalThis=ctx;
 vm.createContext(ctx);vm.runInContext(rangeSource,ctx);
 for(const fn of hooks.init??[])fn();
 for(const fn of hooks.ready??[])fn();
 for(const fn of hooks.pf1CreateActionUse??[])fn(data);
 assert.deepEqual(data.shared.attackBonus,['-2['+bundles[language].Range.Penalty+']']);
};
testLabel('fr');testLabel('en');
console.log('PASS localization: manifest packs, key parity, placeholders, translated native attack labels in French and English');
