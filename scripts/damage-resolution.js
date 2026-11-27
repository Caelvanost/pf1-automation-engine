/**
 * PF1AE damage resolution, material/alignment and combined DR — PF1 11.11 / Foundry 13.
 * Opt-in; native actor.applyDamage still commits HP, THP and nonlethal.
 * No global chat state, no canvas selection, no ability-specific code.
 */
const DR_NS="pf1-automation-engine",DR_SETTING="automaticDamageDefenses";
const DR_AD="pf1-automate-damage";
const DR_SOURCE_FLAG="damageSourceSnapshot",DR_SOURCE_SCHEMA=1;
const DR_PROJECTILES=new WeakMap(),DR_PROJECTILE_WRAPPED=new WeakSet();
const DR_ENERGY=new Set(["acid","cold","electric","fire","sonic"]);
const DR_PHYSICAL=new Set(["bludgeoning","piercing","slashing"]);
const DR_OTHER=new Set(["untyped","force"]);
// Native PF1 identifiers, not localized labels. Mithral counts as silver for DR.
const DR_MATERIALS=new Map([["silver",3],["coldIron",3],["adamantine",4]]);
const DR_SILVER=new Set(["silver","alchemicalSilver","mithral"]);
const DR_ALIGNMENTS=new Set(["lawful","chaotic","good","evil"]);
const DR_KNOWN_MATERIALS=new Set(["steel","iron","wood","stone","bone","silver","alchemicalSilver","mithral","coldIron","adamantine","natural","ordinaryAmmo"]);
const DR_TAGS=new Set(["precision","nonlethal","areaOfEffect"]);
const DR_SEEN=new WeakSet(),DR_LAST=new Map();
const drText=(fr,en)=>String(game.i18n?.lang??"").startsWith("fr")?fr:en;
const drAvailable=()=>game.release?.generation===13&&game.system?.id==="pf1"&&game.system?.version==="11.11"&&
 game.modules.get(DR_NS)?.active===true&&!game.modules.get(DR_AD)?.active&&
 game.settings.get(DR_NS,"genericEnabled")===true&&game.settings.get(DR_NS,DR_SETTING)===true;
const drArray=x=>Array.isArray(x)?x:x instanceof Set?[...x]:typeof x?.values==="function"?[...x.values()]:null;
const drCustom=x=>typeof x==="string"?x.trim().length>0:(drArray(x)?.length??0)>0;
function drFail(reason){return {supported:false,reason}}
function drIds(trait){
 if(trait==null)return [];
 if(drCustom(trait.custom))throw Error("custom-damage-trait");
 const ids=drArray(trait.standard??trait.value);
 if(!ids||ids.some(x=>typeof x!=="string"))throw Error("unverified-damage-trait");
 return ids;
}
function drEntries(trait){
 if(trait==null)return [];
 if(drCustom(trait.custom))throw Error("custom-resistance");
 const list=drArray(trait.value);
 if(!list)throw Error("unverified-resistance");
 return list.map(row=>{
  const types=drArray(row?.types);
  if(!types||types.some(t=>typeof t!=="string")||!Number.isSafeInteger(row.amount)||row.amount<0)
   throw Error("unverified-resistance-entry");
  return {amount:row.amount,types:types.filter(Boolean),operator:row.operator};
 });
}
const drFloor=n=>Math.floor(n+Number.EPSILON*Math.max(1,Math.abs(n))*4);
function drComponents(input){
 if(!Array.isArray(input)||!input.length||input.length>500)throw Error("missing-typed-damage");
 return input.map(x=>{
  const amount=x?.value??x?.amount,types=drArray(x?.types??x?.damageType);
  if(!Number.isSafeInteger(amount)||amount<0||!types)throw Error("unverified-damage-component");
  const tags=[...new Set(types.filter(t=>DR_TAGS.has(t)))];
  const ids=[...new Set(types.filter(t=>!DR_TAGS.has(t)))];
  if(ids.length!==1||!DR_ENERGY.has(ids[0])&&!DR_PHYSICAL.has(ids[0])&&!DR_OTHER.has(ids[0]))
   throw Error("mixed-or-unsupported-damage-type");
  return {type:ids[0],amount,tags};
 });
}
// A false answer is allowed only with a complete recognized material profile.
// Enhancement substitutes for material DR only, never for object hardness.
function drMaterialBypass(bypass,material){
 if(!material||!DR_MATERIALS.has(bypass))return null;
 const {normal,addons,enhancement}=material;
 if(Number.isSafeInteger(enhancement)&&enhancement>=DR_MATERIALS.get(bypass))return true;
 const extra=drArray(addons);
 if(typeof normal!=="string"||!extra||extra.some(x=>typeof x!=="string"))return null;
 const ids=[normal,...extra];
 if(ids.some(id=>bypass==="silver"?DR_SILVER.has(id):id===bypass))return true;
 if(!Number.isSafeInteger(enhancement)||enhancement<0||ids.some(id=>!DR_KNOWN_MATERIALS.has(id)))return null;
 return false;
}
// Three-valued predicate: true = bypass, false = reduction applies,
 // null = provenance unavailable. A verified decisive AND/OR branch suffices.
function drCriterion(id,{type,magic,material,alignment,epic}){
 const bypass=id==="alchemicalSilver"?"silver":id;
 if(DR_PHYSICAL.has(bypass))return {value:bypass===type};
 if(bypass==="magic")return {value:typeof magic==="boolean"?magic:null,reason:"unknown-magic-bypass"};
 if(bypass==="epic")return {value:typeof epic==="boolean"?epic:null,reason:"unknown-epic-bypass"};
 if(DR_MATERIALS.has(bypass))return {value:drMaterialBypass(bypass,material),reason:"unknown-material-bypass"};
 if(DR_ALIGNMENTS.has(bypass)){
  if(Number.isSafeInteger(alignment?.enhancement)&&alignment.enhancement>=5)return {value:true};
  const value=alignment?.values?.[bypass];
  return {value:typeof value==="boolean"?value:null,reason:"unknown-alignment-bypass"};
 }
 return {value:null,reason:"material-alignment-damage-reduction"};
}
function drEvaluateReduction(entry,context){
 if(!entry.types.length)return {value:false};
 if(entry.types.length>1&&typeof entry.operator!=="boolean")return {value:null,reason:"complex-damage-reduction"};
 const checks=entry.types.map(id=>drCriterion(id,context));
 // PF1-style boolean convention (also used by Automate Damage):
 // true = OR (any), false = AND (all). Single criterion ignores operator.
 if(entry.types.length===1)return checks[0];
 const any=entry.operator===true;
 if(checks.some(check=>check.value===any))return {value:any};
 const uncertain=checks.find(check=>check.value===null);
 if(uncertain)return uncertain;
 return {value:!any};
}
function drPreview({actor,components,ratio=1,sourceKind=null,magic=null,material=null,alignment=null,epic=null,asNonlethal=false}={}){
 try{
  if(!actor?.system?.traits)return drFail("missing-native-traits");
  if(ratio!==1&&ratio!==0.5)return drFail("unsupported-ratio");
  const rows=drComponents(components),traits=actor.system.traits;
  if(!asNonlethal&&rows.some(r=>r.tags.includes("nonlethal")))return drFail("mixed-or-unverified-nonlethal");
  // PF1 cannot separate lethal and nonlethal components in one HP call.
  if(asNonlethal&&rows.some(r=>r.tags.includes("nonlethal"))&&rows.some(r=>!r.tags.includes("nonlethal")))
   return drFail("mixed-nonlethal");
  if(Number(traits.hardness??0)>0)return drFail("hardness-next-stage");
  const immunity=new Set(drIds(traits.di)),vulnerability=new Set(drIds(traits.dv));
  const immuneNonlethal=asNonlethal&&immunity.has("nonlethal");
  // Modifier-tag defenses may involve only a fraction of a mixed roll.
  // Until exact provenance is available, require manual review rather
  // than guessing how much of a physical roll was precision damage.
  if(!immuneNonlethal&&rows.some(r=>r.amount>0&&r.tags.some(t=>t!=="nonlethal"&&(immunity.has(t)||vulnerability.has(t)))))
   return drFail("modifier-tag-defense");
  if(!immuneNonlethal&&asNonlethal&&vulnerability.has("nonlethal"))return drFail("non-energy-vulnerability");
  if(!immuneNonlethal&&sourceKind!=="other"&&rows.some(r=>r.type==="untyped"&&r.amount>0)&&
   drEntries(traits.dr).some(r=>r.amount>0))return drFail("untyped-with-damage-reduction");
  const hasEnergy=rows.some(r=>DR_ENERGY.has(r.type));
  const energy=hasEnergy&&!immuneNonlethal?drEntries(traits.eres):[];
  if(energy.some(r=>r.types.length!==1||!DR_ENERGY.has(r.types[0])))return drFail("complex-energy-resistance");
  // Group same energy type before applying the highest resistance ONCE.
  const groups=new Map();
  for(const r of rows)groups.set(r.type,(groups.get(r.type)??0)+r.amount);
  const result=[];
  let exact=0,rounded=0;
  for(const [type,raw] of groups){
   exact+=raw*ratio;
   const next=drFloor(exact),incoming=next-rounded;rounded=next;
   const immune=immuneNonlethal||immunity.has(type);
   let amount=immune?0:incoming,resistance=0,extra=0;
   if(!immune&&DR_ENERGY.has(type)){
    resistance=Math.min(amount,Math.max(0,...energy.filter(r=>r.types[0]===type).map(r=>r.amount)));
    // No blanket ordering invented for combined vulnerability + resistance:
    // different PF1 effects explicitly define different orders.
    if(vulnerability.has(type)&&resistance>0&&amount>0)return drFail("combined-vulnerability-resistance");
    amount-=resistance;
    if(vulnerability.has(type)){extra=drFloor(amount*1.5)-amount;amount+=extra}
   }else if(!immune&&vulnerability.has(type)&&incoming>0)return drFail("non-energy-vulnerability");
   result.push({type,raw,incoming,immune,resistance,vulnerabilityBonus:extra,damageReduction:0,final:amount});
  }
  // Highest applicable weapon DR, once per hit. No DR on spell damage.
  let dr=0;
  const physical=result.filter(r=>DR_PHYSICAL.has(r.type)&&r.final>0);
  if(physical.length&&sourceKind!=="other"){
   const reductions=drEntries(traits.dr).filter(r=>r.amount>0);
   if(reductions.length&&sourceKind!=="weapon")return drFail("unknown-physical-source");
   if(reductions.length){
    if(physical.length!==1)return drFail("mixed-physical-damage");
    const type=physical[0].type;
    // Only the strongest non-bypassed reduction applies. An unknown
    // criterion cannot change the result if its amount is already covered.
    const uncertain=[];
    for(const entry of reductions){
     const result=drEvaluateReduction(entry,{type,magic,material,alignment,epic});
     if(result.value===false)dr=Math.max(dr,entry.amount);
     else if(result.value===null)uncertain.push({amount:entry.amount,reason:result.reason});
    }
    const blocking=uncertain.find(entry=>Math.min(physical[0].final,entry.amount)>Math.min(physical[0].final,dr));
    if(blocking)return drFail(blocking.reason);
    const row=physical[0],applied=Math.min(row.final,dr);
    row.damageReduction=applied;row.final-=applied;dr=applied;
   }
  }
  return {supported:true,raw:rows.reduce((a,r)=>a+r.amount,0),ratio,incoming:rounded,
   total:result.reduce((a,r)=>a+r.final,0),damageReduction:dr,components:result};
 }catch(e){return drFail(String(e?.message??e))}
}
// Initial material adapter: manufactured melee weapons with no ammunition.
// PF1 11.11 exposes effective normalMaterial/addonMaterial on ItemAction.
// Do not use the launcher's material, localized labels or base material alone.
function drManufacturedMelee(action,item){
 return (action?.actionType==="mwak"&&action.isRanged!==true||action?.actionType==="twak")&&item?.type==="weapon"&&
    item.subType!=="natural"&&item.system?.subType!=="natural"&&action.ammo?.type===null;
}
function drMeleeEnhancement(action,item){
 const bonus=action.enhancementBonus;
 return Number.isSafeInteger(bonus)&&bonus>=0?bonus:
    bonus===null&&item.system?.enh===null?0:null;
}
function drMeleeMaterial(action,item){
 if(!drManufacturedMelee(action,item))return null;
 if(action.material?.normal?.custom!==false||
    item.system?.material?.base?.custom!==false||item.system?.material?.normal?.custom!==false)return null;
 const normal=action.normalMaterial,addons=drArray(action.addonMaterial);
 if(typeof normal!=="string"||!addons||addons.some(x=>typeof x!=="string"))return null;
 return {normal,addons:[...addons],enhancement:drMeleeEnhancement(action,item)};
}
// Explicit action overrides take precedence over item alignment flags.
// A creature's personal alignment is NOT the alignment subtype. Until the
// native prepared subtype contract is verified, accept a complete explicit
// prepared collection only; do not infer absence from a missing field.
function drAlignmentSubtypes(actor){
 const trait=actor?.system?.traits?.creatureSubtypes;
 const total=drArray(trait?.total);
 if(!total||total.some(id=>typeof id!=="string")||drCustom(trait?.custom))return null;
 return total;
}
function drMeleeAlignment(action,item,natural=false){
 if(!natural&&!drManufacturedMelee(action,item))return null;
 const enhancement=natural?drNaturalEnhancement(action):drMeleeEnhancement(action,item);
 const subtypes=drAlignmentSubtypes(action.actor??item.actor);
 const values={};
 for(const id of DR_ALIGNMENTS){
  const override=action.alignments?.[id],base=item.system?.alignments?.[id];
  const flag=typeof override==="boolean"?override:override===null&&typeof base==="boolean"?base:null;
  // A positive alignment on the weapon or a verified matching subtype is sufficient.
  // A negative weapon flag alone does not exclude a creature-subtype bypass.
  values[id]=flag===true||subtypes?.includes(id)?true:
   flag===false&&subtypes!==null&&enhancement!==null?false:null;
 }
 return {values,enhancement};
}
function drSourceKind(options){
 const action=options.action,item=action?.item??options.item,type=action?.actionType;
 if(["mwak","rwak","twak"].includes(type)&&item?.type!=="spell")return "weapon";
 if(item?.type==="spell"&&!["mwak","rwak","twak"].includes(type)||["msak","rsak"].includes(type))return "other";
 return null;
}
// PF1 identifies a natural attack by its native attack item subtype,
// not its name, damage dice, actor race or attack animation.
function drNatural(action,item){
 return action?.actionType==="mwak"&&action.isRanged!==true&&item?.type==="attack"&&
  (item.subType==="natural"||item.system?.subType==="natural")&&
  ![item.subType,item.system?.subType].some(x=>x!=null&&x!=="natural")&&
  (action.ammo?.type===null||action.ammo?.type===undefined&&!item.system?.ammo);
}
function drNaturalEnhancement(action){
 // Native ItemAction getter: null means no configured enhancement.
 // Do not infer the enhancement of an external buff from its name or total damage.
 const bonus=action.enhancementBonus;
 return Number.isSafeInteger(bonus)&&bonus>=0?bonus:bonus===null?0:null;
}
function drNaturalMaterial(action,item){
 // No fabricated material on an unconfigured natural attack. Require
 // effective native getters and reject custom material definitions.
 if(!item.system||action.material?.normal?.custom===true||
    item.system.material?.base?.custom===true||item.system.material?.normal?.custom===true)return null;
 const normal=action.normalMaterial,addons=drArray(action.addonMaterial);
 if(!(normal===null||typeof normal==="string"&&normal.length>0)||
    !addons||addons.some(x=>typeof x!=="string"))return null;
 return {normal:normal??"natural",addons:[...addons],enhancement:drNaturalEnhancement(action)};
}
function drInnateBypasses(actor){
 // Bestiary: the creature's own DR/magic or DR/epic gives its natural
 // weapons the corresponding quality, not an actual enhancement bonus.
 // No inheritance of material DR or alignment DR; subtype is separate.
 const trait=actor?.system?.traits?.dr;
 if(!trait)return {magic:null,epic:null};
 try{
  const rows=drEntries(trait).filter(row=>row.amount>0);
  const has=id=>rows.some(row=>row.types.includes(id));
  return {magic:has("magic")||has("epic"),epic:has("epic")};
 }catch(_){return {magic:null,epic:null};}
}
const drOr=(...values)=>values.includes(true)?true:values.every(x=>x===false)?false:null;
function drProjectile(action,item){
 return action?.actionType==="rwak"&&item?.type==="weapon"&&
  typeof action.ammo?.type==="string"&&action.ammo.type.length>0;
}
function drProjectileUnknown(){return {sourceKind:"weapon",magic:null,epic:null,material:null,alignment:null}}
function drAmmoProfile(action,item,entry){
 const selection=entry?.ammo,id=selection?.id;
 if(entry?.hasAmmo!==true||!drShortId(id))return {ammoId:null,...drProjectileUnknown()};
 const actor=action.actor??item.actor;
 // PF1FR's native getAmmo adapter supplies {id, document, data}.
 // Prefer the exact selected owned document; never use current default,
 // inventory search by name, or a later ammunition stack.
 const ammo=selection.document??actor?.items?.get?.(id);
 if(!ammo||ammo.id!==id||ammo.actor?.uuid!==actor?.uuid||
    ammo.uuid!==actor?.uuid+".Item."+id||
    !(ammo.type==="ammo"&&(!ammo.system?.subType||ammo.system.subType===action.ammo.type)||
      ammo.type==="loot"&&ammo.system?.subType==="ammo"&&item.system?.ammo?.default===id))
  return {ammoId:id,...drProjectileUnknown()};
 const sys=ammo.system,dict=sys?.flags?.dictionary,booleans=drArray(sys?.flags?.boolean);
 const flags=dict&&typeof dict==="object"&&!Array.isArray(dict)?dict:null;
 // Explicit PF1 item dictionary flags supported for legacy ammunition:
 // Material, Alignment, Enhancement (real numeric bonus, not total price),
 // plus Magic boolean. Do not treat arbitrary attack/damage bonuses as enhancement.
 const lookup=key=>{
  const matches=Object.entries(flags??{}).filter(([k])=>k.toLowerCase()===key.toLowerCase());
  return matches.length===1?matches[0][1]:matches.length===0?undefined:null;
 };
 const flagMagic=booleans?booleans.some(x=>typeof x==="string"&&x.toLowerCase()==="magic"):null;
 const rawEnh=lookup("Enhancement"),nativeEnh=sys?.enh;
 const declared=typeof rawEnh==="string"&&/^\d+$/.test(rawEnh.trim())?Number(rawEnh):rawEnh;
 const ownEnh=Number.isSafeInteger(nativeEnh)&&nativeEnh>=0?
  (rawEnh===undefined||declared===nativeEnh?nativeEnh:null):
  nativeEnh!=null?null:Number.isSafeInteger(declared)&&declared>=0?declared:
  rawEnh===undefined&&flags&&booleans&&!game.modules.get("ckl-roll-bonuses")?.active?0:null;
 const launcher=drMeleeEnhancement(action,item);
 const magic=drOr(launcher===null?null:launcher>0,ownEnh===null?null:ownEnh>0,flagMagic);
 const rawMat=lookup("Material"),normal=ammo.normalMaterial,addons=drArray(ammo.addonMaterial);
 let material=null;
 // Legacy dictionary flag and native getters are separate representations;
 // explicit conflicts are not silently reconciled.
 const validMat=typeof rawMat==="string"&&DR_KNOWN_MATERIALS.has(rawMat);
 if(sys?.material?.normal?.custom!==true&&sys?.material?.base?.custom!==true){
  if(typeof normal==="string"&&normal&&addons&&addons.every(x=>typeof x==="string")&&
     (rawMat===undefined||validMat&&(rawMat===normal||addons.includes(rawMat))))
   material={normal,addons:[...addons],enhancement:ownEnh};
  else if((normal==null||normal==="")&&(!addons||addons.length===0)&&flags&&
          (rawMat===undefined||validMat))
   material={normal:validMat?rawMat:"ordinaryAmmo",addons:[],enhancement:ownEnh};
 }
 const subtypes=drAlignmentSubtypes(actor),rawAlign=lookup("Alignment"),values={};
 for(const align of DR_ALIGNMENTS){
  const override=action.alignments?.[align],base=item.system?.alignments?.[align];
  const launch=typeof override==="boolean"?override:override===null&&typeof base==="boolean"?base:null;
  const ammoFlag=sys?.alignments?.[align];
  const explicit=DR_ALIGNMENTS.has(rawAlign)?rawAlign===align:rawAlign===undefined&&flags?false:null;
  const projectile=typeof ammoFlag==="boolean"?drOr(ammoFlag,explicit):explicit;
  values[align]=drOr(launch,projectile,subtypes===null?null:subtypes.includes(align));
 }
 // Only the projectile's own actual enhancement supplies the +3/+4/+5
 // thresholds. A launcher's +1 or explicit alignment is transmitted.
 return {ammoId:id,sourceKind:"weapon",magic,
  epic:ownEnh!==null&&ownEnh>=6?true:null,material,alignment:{values,enhancement:ownEnh}};
}
function drWrapProjectile(use){
 const action=use?.action??use?.shared?.action,item=action?.item??use?.item;
 if(!drProjectile(action,item)||DR_PROJECTILE_WRAPPED.has(use)||typeof use.generateChatAttacks!=="function")return;
 const native=use.generateChatAttacks;
 const wrapped=function(...args){
  // Selection is finalized at this native boundary (also used by PF1FR).
  // Capture before generation/consumption; leave native call/result intact.
  try{
   const attacks=this.shared?.attacks;
   DR_PROJECTILES.set(this,Array.isArray(attacks)&&attacks.length>0&&attacks.length<=500?
    attacks.map(entry=>drAmmoProfile(action,item,entry)):null);
  }catch(error){DR_PROJECTILES.set(this,null);console.warn("[PF1AE][Damage] Ammo snapshot unavailable",error);}
  return native.apply(this,args);
 };
 try{use.generateChatAttacks=wrapped;DR_PROJECTILE_WRAPPED.add(use);}
 catch(error){console.warn("[PF1AE][Damage] Ammo capture hook unavailable",error);}
}
function drProjectileProfiles(use,chatAttacks){
 const captured=DR_PROJECTILES.get(use),unknown={ammoId:null,...drProjectileUnknown()};
 if(!Array.isArray(captured)||captured.length!==chatAttacks.length)return chatAttacks.map(()=>unknown);
 // Uniform ammo/profile is independent of ordering. Mixed ammunition requires
 // explicit matching IDs on the final chat entries, never assumed index order.
 const first=JSON.stringify(captured[0]);
 if(captured.every(x=>JSON.stringify(x)===first))return captured;
 const byId=new Map();
 for(const profile of captured){
  if(!profile.ammoId)continue;
  const previous=byId.get(profile.ammoId);
  if(previous&&JSON.stringify(previous.profile)!==JSON.stringify(profile))previous.conflict=true;
  else if(!previous)byId.set(profile.ammoId,{profile,count:0,conflict:false});
  byId.get(profile.ammoId).count++;
 }
 const matched=chatAttacks.map(entry=>entry?.ammo?.id);
 if(matched.some(id=>!id||!byId.has(id)))return chatAttacks.map(()=>unknown);
 for(const [id,p] of byId)if(p.conflict||matched.filter(x=>x===id).length!==p.count)
  return chatAttacks.map(()=>unknown);
 return matched.map(id=>byId.get(id).profile);
}
function drSource(options){
 const action=options.action,item=action?.item??options.item;
 const sourceKind=drSourceKind(options);
 if(sourceKind==="weapon"){
  if(drProjectile(action,item))return drProjectileUnknown();
  if(drNatural(action,item)){
   const enhancement=drNaturalEnhancement(action);
   const innate=drInnateBypasses(action.actor??item.actor);
   // Epic is positive if proven, but an absent innate epic trait alone
   // cannot exclude all special-ability bonus equivalents.
   const epic=innate.epic===true||enhancement>=6?true:
    innate.epic===false&&enhancement===0?false:null;
   const magic=enhancement>0||innate.magic===true?true:
    enhancement===0&&innate.magic===false?false:null;
   return {sourceKind,magic,epic,material:drNaturalMaterial(action,item),
    alignment:drMeleeAlignment(action,item,true)};
  }
  let magic=null;
  if(Number.isFinite(action.enhancementBonus)){
   magic=action.enhancementBonus>0;
   // Ammo properties are not yet captured per attack.
   if(!magic&&action.ammo?.type)magic=null;
  }
  const material=drMeleeMaterial(action,item);
  if(magic===null&&material?.enhancement===0)magic=false;
  // Actual +6 proves epic for a manufactured melee weapon; equivalent
  // special ability bonus is not yet resolved, so otherwise unknown.
  const epic=drManufacturedMelee(action,item)&&drMeleeEnhancement(action,item)>=6?true:null;
  return {sourceKind:"weapon",magic,epic,material,alignment:drMeleeAlignment(action,item)};
 }
 return {sourceKind,magic:null,epic:null,material:null,alignment:null};
}
// Versioned data-only card snapshot. Capture at the native pre-display
// hook, after rolls are finalized and before the ChatMessage is created.
// Never reconstruct historical properties from a later item document.
const drShortId=x=>typeof x==="string"&&x.length>0&&x.length<=500;
const drBonus=x=>x===null||Number.isSafeInteger(x)&&x>=0;
const drTri=x=>x===null||typeof x==="boolean";
function drSourceIdentity(action,item){
 const actor=action?.actor??item?.actor;
 const actionId=action?.id??action?._id;
 if(!drShortId(actor?.uuid)||!drShortId(item?.uuid)||!drShortId(actionId)||
    !drShortId(item?.id)||item.uuid!==actor.uuid+".Item."+item.id||
    (item.actor?.uuid&&item.actor.uuid!==actor.uuid))return null;
 return {actorUuid:actor.uuid,itemUuid:item.uuid,itemId:item.id,actionId};
}
function drNormalizeSnapshot(data,allowPerAttack=true){
 if(!data||data.schema!==DR_SOURCE_SCHEMA||!data.source||
    !Number.isSafeInteger(data.attackCount)||data.attackCount<1||data.attackCount>500)return null;
 const {actorUuid,itemUuid,itemId,actionId}=data.source;
 if(![actorUuid,itemUuid,itemId,actionId].every(drShortId)||
    itemUuid!==actorUuid+".Item."+itemId)return null;
 const {sourceKind,magic,material,alignment}=data;
 // Additive optional field: schema-1 cards from 1.51.3 remain readable.
 const epic=Object.hasOwn(data,"epic")?data.epic:null;
 if(![null,"weapon","other"].includes(sourceKind)||!drTri(magic)||!drTri(epic))return null;
 if(sourceKind!=="weapon"&&(magic!==null||epic!==null||material!==null||alignment!==null))return null;
 let mat=null,align=null;
 if(material!==null){
  if(!material||!drShortId(material.normal)||!Array.isArray(material.addons)||
     material.addons.length>100||!material.addons.every(drShortId)||!drBonus(material.enhancement))return null;
  mat={normal:material.normal,addons:[...material.addons],enhancement:material.enhancement};
 }
 if(alignment!==null){
  if(!alignment||!drBonus(alignment.enhancement)||!alignment.values||
     ![...DR_ALIGNMENTS].every(id=>drTri(alignment.values[id])))return null;
  align={enhancement:alignment.enhancement,values:Object.fromEntries([...DR_ALIGNMENTS].map(id=>[id,alignment.values[id]]))};
 }
 if(mat&&align&&mat.enhancement!==align.enhancement)return null;
 const result={schema:DR_SOURCE_SCHEMA,source:{actorUuid,itemUuid,itemId,actionId},attackCount:data.attackCount,
  sourceKind,magic,epic,material:mat,alignment:align};
 if(Object.hasOwn(data,"perAttack")){
  if(!allowPerAttack||sourceKind!=="weapon"||!Array.isArray(data.perAttack)||data.perAttack.length!==data.attackCount)return null;
  result.perAttack=[];
  for(const entry of data.perAttack){
   if(!entry||entry.sourceKind!=="weapon"||!(entry.ammoId===null||drShortId(entry.ammoId)))return null;
   const profile=drNormalizeSnapshot({schema:DR_SOURCE_SCHEMA,source:data.source,attackCount:1,
    sourceKind:entry.sourceKind,magic:entry.magic,epic:entry.epic,material:entry.material,alignment:entry.alignment},false);
   if(!profile)return null;
   result.perAttack.push({ammoId:entry.ammoId,sourceKind:profile.sourceKind,magic:profile.magic,epic:profile.epic,
    material:profile.material,alignment:profile.alignment});
  }
 }
 return result;
}
function drCapture(use){
 if(game.release?.generation!==13||game.system?.id!=="pf1"||game.system?.version!=="11.11"||
    !game.modules.get(DR_NS)?.active||game.settings.get(DR_NS,"genericEnabled")!==true)return;
 const action=use?.action??use?.shared?.action,item=action?.item??use?.item;
 const chatData=use?.shared?.chatData,attacks=use?.shared?.chatAttacks;
 if(!chatData||typeof chatData!=="object"||!Array.isArray(attacks)||!attacks.length)return;
 const source=drSourceIdentity(action,item);
 if(!source)return;
 // If the action and use expose conflicting item/actor identities, do not
 // bind a snapshot to this card. No global last attack or pending queue.
 if(use.item?.uuid&&use.item.uuid!==source.itemUuid)return;
 if(use.actor?.uuid&&use.actor.uuid!==source.actorUuid)return;
 const profile=drSource({action,item});
 const snapshot=drNormalizeSnapshot({schema:DR_SOURCE_SCHEMA,source,attackCount:attacks.length,
  sourceKind:profile.sourceKind,magic:profile.magic,epic:profile.epic??null,material:profile.material??null,alignment:profile.alignment??null,
  ...(drProjectile(action,item)?{perAttack:drProjectileProfiles(use,attacks)}:{})});
 if(!snapshot)return;
 chatData.flags??={};chatData.flags[DR_NS]??={};
 // The native action can render repeatedly. Never overwrite the first
 // snapshot on the same chat data object with newer mutable properties.
 if(!Object.hasOwn(chatData.flags[DR_NS],DR_SOURCE_FLAG))
  chatData.flags[DR_NS][DR_SOURCE_FLAG]=snapshot;
}
function drSnapshotForCard(options){
 const message=options.message;
 const raw=message?.getFlag?.(DR_NS,DR_SOURCE_FLAG)??message?.flags?.[DR_NS]?.[DR_SOURCE_FLAG];
 if(raw==null)return {state:"missing",profile:null};
 const snapshot=drNormalizeSnapshot(raw);
 if(!snapshot)return {state:"invalid",profile:null};
 const source=snapshot.source,action=options.action,item=action?.item??options.item;
 const native=message.system??{};
 const ids=[
  [native.item?.id,source.itemId],[native.action?.id,source.actionId],
  [message.itemSource?.uuid,source.itemUuid],[message.actionSource?.id,source.actionId],
  [item?.uuid,source.itemUuid],[options.item?.uuid,source.itemUuid],
  [action?.id??action?._id,source.actionId],[action?.actor?.uuid,source.actorUuid],
  [item?.actor?.uuid,source.actorUuid]
 ];
 // Native actor may be a short ID rather than UUID. Only compare the
 // UUID-shaped form; short ID cannot certify synthetic actor identity.
 const nativeActor=typeof native.actor==="string"&&
  (native.actor.startsWith("Actor.")||native.actor.includes(".Actor."))?native.actor:null;
 if(nativeActor)ids.push([nativeActor,source.actorUuid]);
 if(ids.some(([actual,expected])=>actual!=null&&actual!==expected)||
    snapshot.attackCount!==message.systemRolls?.attacks?.length||
    !Number.isSafeInteger(options.attackIndex)||options.attackIndex<0||options.attackIndex>=snapshot.attackCount)
  return {state:"mismatch",profile:null};
 const liveIdentity=item?.uuid===source.itemUuid&&(action?.id??action?._id)===source.actionId;
 const cardIdentity=(message.itemSource?.uuid===source.itemUuid&&message.actionSource?.id===source.actionId)||
  (nativeActor===source.actorUuid&&native.item?.id===source.itemId&&native.action?.id===source.actionId);
 if(!liveIdentity&&!cardIdentity)return {state:"mismatch",profile:null};
 const p=snapshot.perAttack?.[options.attackIndex]??snapshot;
 return {state:"captured",profile:{sourceKind:p.sourceKind,magic:p.magic,epic:p.epic,
  material:p.material,alignment:p.alignment}};
}
function drRemember(actor,result){
 if(!actor?.uuid)return;
 DR_LAST.set(actor.uuid,result);if(DR_LAST.size>200)DR_LAST.delete(DR_LAST.keys().next().value);
}
const DR_REASONS={
 "hardness-next-stage":["solidité","hardness"],
 "damage-source-snapshot-missing":["ancienne carte sans propriétés d’attaque enregistrées","old card without recorded attack properties"],
 "damage-source-snapshot-invalid":["propriétés d’attaque enregistrées invalides","invalid recorded attack properties"],
 "damage-source-snapshot-mismatch":["provenance de la carte d’attaque incohérente","inconsistent attack card provenance"],
 "material-alignment-damage-reduction":["RD de matériau ou d’alignement non prise en charge","unsupported material/alignment DR"],
 "unknown-material-bypass":["matériau ou altération de l’arme non vérifié","unverified weapon material or enhancement"],
 "unknown-alignment-bypass":["alignement de l’arme ou sous-type du porteur non vérifié","unverified weapon alignment or wielder subtype"],
 "complex-damage-reduction":["RD complexe","complex DR"],
 "unknown-magic-bypass":["contournement magique non vérifié","unverified magic bypass"],
 "unknown-epic-bypass":["contournement épique non vérifié","unverified epic bypass"],
 "custom-resistance":["résistance personnalisée","custom resistance"],
 "custom-damage-trait":["défense personnalisée","custom defense"],
 "combined-vulnerability-resistance":["résistance et vulnérabilité simultanées","combined resistance and vulnerability"],
 "mixed-or-unsupported-damage-type":["type de dégâts mixte ou non pris en charge","mixed or unsupported damage type"],
 "native-card-total-mismatch":["total de carte incohérent","inconsistent card total"],
 "invalid-native-total":["montant de dégâts invalide","invalid damage amount"],
 "missing-native-card-context":["contexte de carte absent","missing card context"],
 "missing-native-card-rolls":["jets de la carte introuvables","missing card rolls"],
 "native-card-attack-mismatch":["attaque de la carte incohérente","inconsistent attack index"],
 "native-card-instance-mismatch":["composantes de dégâts incohérentes","inconsistent damage components"],
 "modifier-tag-defense":["immunité ou vulnérabilité à un modificateur de dégâts","damage modifier immunity or vulnerability"],
 "untyped-with-damage-reduction":["dégâts non typés avec RD","untyped damage with DR"]
};
function drBlock(actor,options,result){
 drRemember(actor,result);
 // Do not silently apply full damage when a defense is unsupported.
 options.value=0;
 const [fr,en]=DR_REASONS[result.reason]??["cas non pris en charge","unsupported case"];
 console.warn("[PF1AE][Damage] Manual adjudication required",actor.uuid,result.reason);
 globalThis.ui?.notifications?.warn?.(drText(
  "PF1AE : dégâts non appliqués automatiquement ("+fr+"). Utilise la fenêtre native d’application des dégâts.",
  "PF1AE: automatic damage not applied ("+en+"). Use the native Apply Damage dialog."));
}
// PF1 11.11 utils/chat.mjs builds DamagePartModel instances with .value
// assigned at runtime. ActorPF.static applyDamage then reconstructs each
// instance from i.toObject() per target. The schema contains only formula
// and types, so the evaluated .value is discarded by this native clone.
// Recover from the exact serialized attack's already evaluated DamageRolls,
// never from a formula, canvas selection, the last attack or a new dice roll.
function drCardComponents(options){
 const message=options.message,index=options.attackIndex;
 if(!Number.isSafeInteger(index)||index<0||!message?.uuid||
    (options.reference!=null&&options.reference!==message.uuid))
  throw Error("missing-native-card-context");
 const button=options.element,dataset=button?.dataset;
 if(dataset?.action!=="applyDamage")throw Error("missing-native-card-context");
 const buttonIndex=button.closest?.("[data-index]")?.dataset?.index;
 if(buttonIndex!=null&&String(index)!==String(buttonIndex))throw Error("native-card-attack-mismatch");
 if(![undefined,"","normal","critical"].includes(dataset.type))throw Error("native-card-attack-mismatch");
 if((dataset.type==="critical")!==(options.isCritical===true))throw Error("native-card-attack-mismatch");
 const attack=message.systemRolls?.attacks?.[index];
 if(!attack||!Array.isArray(attack.damage)||!attack.damage.length||
    (options.isCritical===true&&(!Array.isArray(attack.critDamage)||!attack.critDamage.length)))
  throw Error("missing-native-card-rolls");
 const rolls=[...attack.damage,...(options.isCritical===true?attack.critDamage:[])];
 if(rolls.length!==options.instances.length||rolls.length>500)throw Error("native-card-instance-mismatch");
 return rolls.map((roll,i)=>{
  const instance=options.instances[i],value=roll?.total;
  const types=drArray(roll?.damageType?.types),actual=drArray(instance?.types);
  if(!Number.isSafeInteger(value)||value<0||!types||!actual||
     types.some(x=>typeof x!=="string")||actual.some(x=>typeof x!=="string")||
     JSON.stringify([...new Set(types)].sort())!==JSON.stringify([...new Set(actual)].sort()))
   throw Error("native-card-instance-mismatch");
  // If a third-party module preserved .value, verify it rather than
  // silently overriding a conflicting evaluated amount.
  if(instance.value!=null&&instance.value!==value)throw Error("native-card-instance-mismatch");
  return {value,types};
 });
}
function drOnApply(actor,options){
 if(!drAvailable()||!options||DR_SEEN.has(options))return;
 // Native dialog already computes its own adjustments. Healing, direct
 // HP changes, bleed/agonies and explicit manual reductions stay native.
 if(options.dialog===true||options._pf1AutomateDamageDialog||options.value<=0||
    options.asWounds===true||options.reduction!==0||options.ratio!==1||
    options.interactive!==true||!options.message||!Array.isArray(options.instances)||!options.instances.length)return;
 if(game.settings.get("pf1","healthConfig")?.getActorConfig?.(actor)?.rules?.useWoundsAndVigor)return;
 DR_SEEN.add(options);
 let components;
 try{components=drCardComponents(options)}
 catch(error){return drBlock(actor,options,drFail(String(error?.message??error)))}
 const raw=components.reduce((a,r)=>a+r.value,0);
 if(!Number.isSafeInteger(raw)||raw<0)return drBlock(actor,options,drFail("invalid-native-total"));
 const ratio=Number(options.element.dataset.ratio);
 const buttonValue=Number(options.element.dataset.value);
 if((ratio!==0.5&&ratio!==1)||!Number.isSafeInteger(buttonValue)||
    buttonValue!==options.value||Math.floor(raw*ratio)!==options.value)
  return drBlock(actor,options,drFail("native-card-total-mismatch"));
 const saved=drSnapshotForCard(options);
 // Older cards can still use ordinary physical DR and energy defenses.
 // Never infer historical weapon magic/material/alignment from today's item.
 // A malformed or mismatched snapshot also cannot certify source kind.
 const profile=saved.profile??{sourceKind:saved.state==="missing"?drSourceKind(options):null,
  magic:null,material:null,alignment:null};
 const result=drPreview({actor,components,ratio,...profile,asNonlethal:options.asNonlethal===true});
 result.sourceSnapshot=saved.state;
 if(!result.supported){
  if(saved.state!=="captured"&&["unknown-magic-bypass","unknown-material-bypass","unknown-alignment-bypass","unknown-epic-bypass","unknown-physical-source"].includes(result.reason))
   result.reason="damage-source-snapshot-"+saved.state;
  return drBlock(actor,options,result);
 }
 drRemember(actor,result);
 // Native method applies ratio then reduction. Only pass the final value.
 options.value=result.total;options.ratio=1;options.reduction=0;
 options.pf1aeDamageResolution=result;
}
Hooks.once("init",()=>{
 game.settings.register(DR_NS,DR_SETTING,{scope:"world",config:true,restricted:true,type:Boolean,default:false,
  name:"PF1AE.Settings.AutomaticDamageDefenses.Name",hint:"PF1AE.Settings.AutomaticDamageDefenses.Hint"});
 Hooks.on("pf1CreateActionUse",use=>{
  if(game.release?.generation===13&&game.system?.id==="pf1"&&game.system?.version==="11.11"&&
     game.modules.get(DR_NS)?.active&&game.settings.get(DR_NS,"genericEnabled")===true)drWrapProjectile(use);
 });
 Hooks.on("pf1PreDisplayActionUse",drCapture);
 Hooks.on("pf1ApplyDamage",drOnApply);
});
Hooks.once("ready",()=>{
 const mod=game.modules.get(DR_NS);if(!mod)return;mod.api??={};
 mod.api.damageResolution=Object.freeze({
  isAvailable:drAvailable,preview:drPreview,
  sourceSnapshot:message=>drNormalizeSnapshot(message?.getFlag?.(DR_NS,DR_SOURCE_FLAG)??message?.flags?.[DR_NS]?.[DR_SOURCE_FLAG]),
  lastDiagnostic:actor=>DR_LAST.get(typeof actor==="string"?actor:actor?.uuid)??null
 });
 if(game.settings.get(DR_NS,DR_SETTING)&&game.modules.get(DR_AD)?.active)
  globalThis.ui?.notifications?.warn?.(drText("PF1AE : moteur de dégâts suspendu car Automate Damage est actif.","PF1AE: damage engine suspended because Automate Damage is active."));
});
