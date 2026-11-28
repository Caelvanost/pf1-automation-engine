/**
 * PF1AE — ammunition properties, PF1 11.11 / Foundry 13.
 * The native Item document remains authoritative for quantity and consumption.
 * No global prototype patch, re-roll, or permanent alteration of the launcher.
 */
const AP_NS="pf1-automation-engine",AP_RB="ckl-roll-bonuses",AP_FLAG="ammunitionProperties";
const AP_SETTING="ammunitionBonuses";
const AP_MATERIALS=["ordinaryAmmo","steel","iron","wood","stone","bone","alchemicalSilver","silver","mithral","coldIron","adamantine"];
const AP_ALIGN=["good","evil","lawful","chaotic"];
const AP_PHYSICAL=["slashing","piercing","bludgeoning"];
const AP_WRAPPED=new WeakSet(),AP_OUTPUTS=new WeakMap();
let AP_LAST=null,AP_SHEET_LAST=null;
const apText=(fr,en)=>String(game.i18n?.lang??"").startsWith("fr")?fr:en;
const apArray=x=>Array.isArray(x)?x:typeof x?.values==="function"?[...x.values()]:null;
const apEligible=item=>item?.type==="ammo"||item?.type==="loot"&&
 (item.subType==="ammo"||item.system?.subType==="ammo");
const apSupported=()=>game.release?.generation===13&&game.system?.id==="pf1"&&game.system?.version==="11.11"&&game.modules.get(AP_NS)?.active===true;
const apEnabled=()=>apSupported()&&game.settings.get(AP_NS,"genericEnabled")===true&&game.settings.get(AP_NS,AP_SETTING)===true&&!game.modules.get(AP_RB)?.active;
const apReadFlag=(item,ns,key)=>item?.getFlag?.(ns,key)??item?.flags?.[ns]?.[key];
const apNumber=x=>Number.isSafeInteger(x)&&x>=0&&x<=100?x:
 typeof x==="string"&&/^\s*\+?\d+\s*$/.test(x)&&Number(x)<=100?Number(x):null;
function apNormalize(raw){
 if(!raw||raw.schema!==1||apNumber(raw.enhancement)===null||typeof raw.masterwork!=="boolean"||
    typeof raw.magic!=="boolean"||!AP_MATERIALS.includes(raw.material)||
    !raw.alignments||!AP_ALIGN.every(k=>typeof raw.alignments[k]==="boolean"))return null;
 const enhancement=apNumber(raw.enhancement);
 return {schema:1,enhancement,masterwork:raw.masterwork||enhancement>0,magic:raw.magic||enhancement>0,
  material:raw.material==="silver"?"alchemicalSilver":raw.material,
  alignments:Object.fromEntries(AP_ALIGN.map(k=>[k,raw.alignments[k]]))};
}
function apLegacy(item){
 if(!apEligible(item))return {supported:false,reason:"not-ammo"};
 const sys=item.system??{},dict=sys.flags?.dictionary??{},bool=apArray(sys.flags?.boolean)??[];
 const lookup=k=>{
  const matches=Object.entries(dict).filter(([key])=>key.toLowerCase()===k.toLowerCase());
  return matches.length===1?matches[0][1]:matches.length===0?undefined:null;
 };
 const rb=key=>apReadFlag(item,AP_RB,key);
 const present=x=>x!==undefined&&x!==null&&x!==""&&x!==false&&!(Array.isArray(x)&&x.length===0);
 const rbEnh=rb("ammo-enhancement"),stack=rb("ammo-enhancement-stacks"),native=sys.enh,old=lookup("Enhancement");
 const declared=[native,old,rbEnh].filter(present).map(apNumber);
 const issues=[];
 if(declared.some(x=>x===null)||new Set(declared).size>1)issues.push("enhancement-conflict-or-formula");
 if(present(stack)&&apNumber(stack)!==0)issues.push("stacking-enhancement");
 for(const key of ["ammo-attack","ammo-damage","ammo-bane-creature-type","ammo-bane-creature-subtype","ammo-effect"])
  if(present(rb(key)))issues.push(key);
 const rawMat=lookup("Material"),normal=item.normalMaterial,addons=apArray(item.addonMaterial)??[];
 if(sys.material?.normal?.custom===true||sys.material?.base?.custom===true||addons.length||
    rawMat!==undefined&&!AP_MATERIALS.includes(rawMat)||normal!=null&&normal!==""&&!AP_MATERIALS.includes(normal)||
    rawMat!==undefined&&normal&&rawMat!==normal)issues.push("material-conflict-or-custom");
 const rawAlign=lookup("Alignment");
 if(rawAlign!==undefined&&!AP_ALIGN.includes(rawAlign))issues.push("custom-alignment");
 const profile=apNormalize({schema:1,enhancement:declared[0]??0,masterwork:sys.masterwork===true,
  magic:bool.some(v=>typeof v==="string"&&v.toLowerCase()==="magic"),
  material:AP_MATERIALS.includes(rawMat)?rawMat:AP_MATERIALS.includes(normal)?normal:"ordinaryAmmo",
  alignments:Object.fromEntries(AP_ALIGN.map(k=>[k,sys.alignments?.[k]===true||rawAlign===k]))});
 return {supported:!!profile&&!issues.length,profile,issues,source:"legacy"};
}
function apInspect(item){
 if(!apEligible(item))return {supported:false,reason:"not-ammo"};
 const raw=apReadFlag(item,AP_NS,AP_FLAG);
 if(raw==null)return apLegacy(item);
 const profile=apNormalize(raw);
 return profile?{supported:true,profile,source:"pf1ae",issues:[]}:{supported:false,reason:"invalid-ammo-profile"};
}
async function apSave(item,raw){
 if(!apSupported()||!apEligible(item)||typeof item.setFlag!=="function"||
    !(game.user?.isGM||item.isOwner===true))throw Error("PF1AE: ammo owner required");
 const profile=apNormalize(raw);
 if(!profile)throw Error("PF1AE: invalid ammunition properties");
 if(game.modules.get(AP_RB)?.active)throw Error("PF1AE: disable Roll Bonuses before configuring replacement ammo bonuses");
 await item.setFlag(AP_NS,AP_FLAG,profile);
 return apInspect(item);
}
function apDelta({launcherEnh,launcherMasterwork,ammoEnh,ammoMasterwork}={}){
 if(![launcherEnh,ammoEnh].every(x=>Number.isSafeInteger(x)&&x>=0)||
    ![launcherMasterwork,ammoMasterwork].every(x=>typeof x==="boolean"))return null;
 const attack=Math.max(launcherEnh,ammoEnh,launcherMasterwork?1:0,ammoMasterwork?1:0)-
  Math.max(launcherEnh,launcherMasterwork?1:0);
 return {attack,damage:Math.max(launcherEnh,ammoEnh)-launcherEnh};
}
function apExactAmmo(use,atk,index){
 const entry=use.shared?.attacks?.[index];
 if(!entry||entry!==atk&&atk?.ammo?.id!==entry.ammo?.id||entry.hasAmmo!==true)return null;
 const selection=entry.ammo,actor=use.actor??use.action?.actor??use.item?.actor;
 const id=selection?.id,doc=selection?.document??actor?.items?.get?.(id);
 if(typeof id!=="string"||!apEligible(doc)||doc.id!==id||!actor?.uuid||doc.actor?.uuid!==actor.uuid||
    doc.uuid!==actor.uuid+".Item."+id)return null;
 if(doc.type==="loot"&&use.item?.system?.ammo?.default!==id)return null;
 if(doc.type==="ammo"&&doc.system?.subType&&doc.system.subType!==use.action?.ammo?.type)return null;
 return doc;
}
function apAdjust(use,original,atk,index){
 if(!apEnabled()||!original||typeof original!=="object"||!Number.isSafeInteger(index)||index<0)return original;
 const action=use.action,item=use.item??action?.item;
 if(action?.actionType!=="rwak"||item?.type!=="weapon"||!action.ammo?.type)return original;
 const ammo=apExactAmmo(use,atk,index);
 if(!ammo)return original;
 const data=apInspect(ammo),profile=data.profile;
 if(!data.supported||!profile){
  AP_LAST={status:"manual-ammo-properties",ammoId:ammo.id,issues:data.issues??[data.reason]};
  console.warn("[PF1AE][Ammo] Unsupported ammunition properties",AP_LAST);
  return original;
 }
 const base=action.enhancementBonus,launcherEnh=Number.isSafeInteger(base)&&base>=0?base:base===null&&item.system?.enh===null?0:null;
 const launcherMasterwork=item.system?.masterwork;
 const delta=apDelta({launcherEnh,launcherMasterwork,ammoEnh:profile.enhancement,ammoMasterwork:profile.masterwork||ammo.system?.masterwork===true});
 if(!delta){AP_LAST={status:"unknown-launcher",ammoId:ammo.id};return original;}
 if(!delta.attack&&!delta.damage){AP_LAST={status:"neutral",ammoId:ammo.id,index,...delta};return original;}
 const primary=apArray(action.damage?.parts?.[0]?.types);
 if(!Array.isArray(original["attack.normal"])||!Array.isArray(original["damage.normal"])||
    delta.damage>0&&(!primary||primary.length!==1||!AP_PHYSICAL.includes(primary[0]))){
  AP_LAST={status:"unverified-native-conditional-parts",ammoId:ammo.id,index,...delta};
  console.warn("[PF1AE][Ammo] Native conditional parts unavailable",AP_LAST);
  globalThis.ui?.notifications?.warn?.(apText("PF1AE : bonus de munition non appliqué, structure native à vérifier.","PF1AE: ammunition bonus not applied; native structure needs verification."));
  return original;
 }
 // Copy only the affected arrays; the native result may be reused across
 // attacks. No mutation of shared arrays, no duplicate bonus on repeated calls.
 if(AP_OUTPUTS.has(original))return original;
 const result={...original,"attack.normal":[...original["attack.normal"]],"damage.normal":[...original["damage.normal"]]};
 const label=apText("Munition PF1AE","PF1AE ammunition");
 if(delta.attack)result["attack.normal"].push(delta.attack+"["+label+"]");
 if(delta.damage)result["damage.normal"].push([delta.damage+"["+label+"]",[...primary],false]);
 AP_OUTPUTS.set(result,true);
 AP_LAST={status:"applied",ammoId:ammo.id,index,...delta};
 return result;
}
function apWrap(use){
 if(!apEnabled()||!use||AP_WRAPPED.has(use)||typeof use._getConditionalParts!=="function")return;
 const native=use._getConditionalParts;
 try{
  Object.defineProperty(use,"_getConditionalParts",{configurable:true,writable:true,value:function(atk,options,...rest){
   const result=native.call(this,atk,options,...rest);
   // PF1's synchronous conditional-parts contract; do not invent async results.
   if(result?.then)return result;
   return apAdjust(this,result,atk,options?.index??0);
  }});
  AP_WRAPPED.add(use);
 }catch(error){console.warn("[PF1AE][Ammo] Conditional wrapper unavailable",error);}
}
function apSheetSection(app,rendered){
 // ApplicationV2's window.content is the full sheet, whereas the render
 // argument can be an individual part, and navigation also uses data-tab.
 const roots=[app?.window?.content,rendered,app?.element,app?.form]
  .map(root=>root?.querySelector?root:root?.[0]?.querySelector?root[0]:null)
  .filter(Boolean);
 const selectors=['.tab.details[data-tab="details"]','.tab[data-tab="details"]','.tab.details',
  'section[data-tab="details"]','div[data-tab="details"]:not(.item):not([role="tab"])'];
 for(const root of roots){
  for(const selector of selectors){
   const section=root.matches?.(selector)?root:root.querySelector(selector);
   if(section&&!section.closest?.("nav")&&!section.matches?.('a,button,[role="tab"]'))return section;
  }
  // Native subtype control anchors the Details content even when the
  // particular PF1 sheet variant uses different tab classes.
  const subtype=root.querySelector('select[name="system.subType"]');
  const section=subtype?.closest?.(".tab,section[data-tab],div[data-tab]");
  if(section&&!section.closest?.("nav")&&section.dataset?.tab==="details")return section;
 }
 return null;
}
function apRender(app,rendered,hook="unknown"){
 if(!apSupported())return;
 const item=app?.item??app?.document??app?.object;
 if(!apEligible(item))return;
 const section=apSheetSection(app,rendered);
 AP_SHEET_LAST={hook,itemId:item.id??null,itemType:item.type,subType:item.subType??item.system?.subType??null,
  sheetClass:app?.constructor?.name??null,status:section?"details-found":"details-not-found"};
 if(!section)return;
 if(section.querySelector("[data-pf1ae-ammunition]")){
  AP_SHEET_LAST.status="already-rendered";return;
 }
 const doc=section.ownerDocument,data=apInspect(item),profile=data.profile;
 const box=doc.createElement("fieldset");box.dataset.pf1aeAmmunition="true";
 const legend=doc.createElement("legend");legend.textContent=apText("Propriétés de munition — PF1AE","Ammunition properties — PF1AE");box.append(legend);
 const info=doc.createElement("p");info.className="hint";
 const conflict=game.modules.get(AP_RB)?.active===true;
 info.textContent=conflict?apText("Roll Bonuses actif : bonus PF1AE suspendus. Désactive-le pour enregistrer ces propriétés.","Roll Bonuses active: PF1AE bonuses suspended. Disable it to save these properties."):
 data.issues?.length?apText("Migration incomplète : "+data.issues.join(", ")+". Vérifier les valeurs avant enregistrement.","Incomplete migration: "+data.issues.join(", ")+". Review before saving."):
 apText("Le bonus d’altération ne se cumule pas avec celui du lanceur. Enregistrer pour conserver les propriétés.","Enhancement does not stack with the launcher. Save to persist properties.");
 box.append(info);
 if(!profile){section.append(box);AP_SHEET_LAST.status="invalid-profile";return;}
 const enabled=(app.isEditable===true||app.isEditable===undefined&&app.options?.editable===true)&&
  (item.isOwner===true||game.user?.isGM===true)&&!conflict;
 const controls={};
 const field=(key,label,input)=>{
  const row=doc.createElement("div");row.className="form-group";
  const l=doc.createElement("label");l.textContent=label;
  input.disabled=!enabled;input.dataset.pf1aeAmmoField=key;
  row.append(l,input);box.append(row);controls[key]=input;
 };
 const n=doc.createElement("input");n.type="number";n.min="0";n.max="100";n.step="1";n.value=String(profile.enhancement);
 field("enhancement",apText("Altération réelle","Actual enhancement"),n);
 const checkbox=(key,label,value)=>{const x=doc.createElement("input");x.type="checkbox";x.checked=value;field(key,label,x);};
 checkbox("masterwork",apText("De maître","Masterwork"),profile.masterwork);
 checkbox("magic",apText("Magique","Magic"),profile.magic);
 const select=doc.createElement("select");
 const fr={ordinaryAmmo:"Ordinaire",steel:"Acier",iron:"Fer",wood:"Bois",stone:"Pierre",bone:"Os",alchemicalSilver:"Argent alchimique",mithral:"Mithral",coldIron:"Fer froid",adamantine:"Adamantium"};
 for(const id of AP_MATERIALS.filter(x=>x!=="silver")){
  const option=doc.createElement("option");option.value=id;option.textContent=apText(fr[id],id);select.append(option);
 }
 select.value=profile.material;field("material",apText("Matériau","Material"),select);
 const frAlign={good:"Bien",evil:"Mal",lawful:"Loi",chaotic:"Chaos"};
 for(const id of AP_ALIGN)checkbox(id,apText(frAlign[id],id),profile.alignments[id]);
 const save=doc.createElement("button");save.type="button";save.disabled=!enabled;
 save.textContent=apText("Enregistrer les propriétés","Save properties");
 save.addEventListener("click",async ev=>{
  ev.preventDefault();ev.stopPropagation();save.disabled=true;
  try{
   if(data.issues?.length&&!globalThis.confirm?.(apText("Les bonus hérités non pris en charge resteront dans les flags, mais PF1AE ne les appliquera pas. Enregistrer quand même ?","Unsupported legacy bonuses remain stored but PF1AE will not apply them. Save anyway?")))return;
   await apSave(item,{schema:1,enhancement:n.value,masterwork:controls.masterwork.checked,magic:controls.magic.checked,
    material:select.value,alignments:Object.fromEntries(AP_ALIGN.map(k=>[k,controls[k].checked]))});
   globalThis.ui?.notifications?.info?.(apText("Propriétés de munition enregistrées.","Ammunition properties saved."));
  }catch(error){globalThis.ui?.notifications?.warn?.(String(error.message??error));}
  finally{save.disabled=!enabled;}
 });
 box.append(save);
 // Prefer placement immediately below the native ammunition controls,
 // rather than after the potentially long Statistics/Aura/Advanced area.
 const ammoType=section.querySelector('select[name="system.ammoType"]')??
  section.querySelector('select[name="system.ammo.type"]')??
  section.querySelector('select[name="system.subType"]');
 const group=ammoType?.closest?.(".form-group");
 if(group&&typeof group.after==="function"&&section.contains?.(group))group.after(box);
 else if(typeof section.prepend==="function")section.prepend(box);
 else section.append(box);
 AP_SHEET_LAST.status="rendered";AP_SHEET_LAST.editable=enabled;
}
function apOnRender(hook,app,rendered){
 try{apRender(app,rendered,hook);}
 catch(error){
  AP_SHEET_LAST={...(AP_SHEET_LAST??{}),hook,status:"render-error",error:String(error?.message??error)};
  console.warn("[PF1AE][Ammo] Sheet rendering failed",error);
 }
}
Hooks.once("init",()=>{
 game.settings.register(AP_NS,AP_SETTING,{scope:"world",config:true,restricted:true,type:Boolean,default:true,
  name:"PF1AE.Settings.AmmunitionBonuses.Name",hint:"PF1AE.Settings.AmmunitionBonuses.Hint"});
 Hooks.on("pf1CreateActionUse",apWrap);
});
for(const hook of ["renderApplicationV2","renderApplication","renderItemSheetPF","renderLootSheetPF","renderItemSheet"])
 Hooks.on(hook,(app,rendered)=>apOnRender(hook,app,rendered));
Hooks.once("ready",()=>{
 const mod=game.modules.get(AP_NS);if(!mod)return;mod.api??={};
 mod.api.ammunition=Object.freeze({isAvailable:apEnabled,inspect:apInspect,save:apSave,previewBonus:apDelta,lastDiagnostic:()=>AP_LAST,sheetDiagnostic:()=>AP_SHEET_LAST?{...AP_SHEET_LAST}:null});
});
