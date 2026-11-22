/**
 * PF1AE — declarative native PF1 weapon property presentation.
 *
 * PF1 v11.11 WeaponModel: "properties" is a TypeDataField(BooleanField).
 * Its existing WeaponSheetPF template already creates:
 *   <input name="system.properties.imp" type="checkbox">
 *
 * This module ONLY clarifies that native input and adds a localized hint.
 * PF1 ItemSheetV2's form.submitOnChange handles persistence/permissions;
 * no separate Item.update, socket, flag or combat automation is necessary.
 */
const WPU_NS="pf1-automation-engine";
const WPU_NAME="system.properties.imp";
const WPU_SELECTOR='input[type="checkbox"][name="system.properties.imp"]';
const WPU_MARKER="pf1ae-weapon-improvised";
const WPU_LABEL_KEY="PF1AE.Weapon.Improvised.Label";
const WPU_HINT_KEY="PF1AE.Weapon.Improvised.Hint";
let wpuEnglishPromise;

function wpuDebug(message,error){
 try{
  if(game.settings.get(WPU_NS,"genericDebug"))
   console.debug("[PF1AE][WeaponProperties]",message,error??"");
 }catch(_){}
}

function wpuFallbackEnglish(){
 if(!wpuEnglishPromise){
  // Foundry normally merges the English language in game.i18n._fallback.
  // Read the module's bundled en.json as a reliable fallback even when
  // another client language has no PF1AE translation for these keys.
  wpuEnglishPromise=Promise.resolve().then(async()=>{
   const response=await fetch("modules/"+WPU_NS+"/lang/en.json");
   if(!response?.ok)throw new Error("English locale unavailable");
   const json=await response.json();
   return json?.PF1AE?.Weapon?.Improvised??{};
  }).catch(error=>{
   wpuDebug("Bundled English fallback unavailable",error);
   return {};
  });
 }
 return wpuEnglishPromise;
}

async function wpuStrings(){
 const fallback=await wpuFallbackEnglish();
 const lookup=(key,leaf)=>{
  const localized=game.i18n?.localize?.(key);
  if(typeof localized==="string"&&localized.trim()&&localized!==key)
   return localized;
  const builtIn=game.i18n?._fallback?.PF1AE?.Weapon?.Improvised?.[leaf];
  return (typeof builtIn==="string"&&builtIn.trim()?builtIn:null)??
    (typeof fallback?.[leaf]==="string"&&fallback[leaf].trim()?fallback[leaf]:key);
 };
 return {label:lookup(WPU_LABEL_KEY,"Label"),hint:lookup(WPU_HINT_KEY,"Hint")};
}
function wpuRoot(app,rendered){
 const first=Array.isArray(rendered)?rendered[0]:rendered;
 const candidate=app?.window?.content??first??app?.element;
 return candidate?.querySelector?candidate:
  candidate?.[0]?.querySelector?candidate[0]:null;
}
function wpuEligible(app){
 if(game.system?.id!=="pf1"||app?.item?.type!=="weapon")return false;
 const klass=globalThis.pf1?.applications?.item?.WeaponSheetPF;
 // The PF1 v11.11 sheet uses Foundry V13 ApplicationV2.
 // No class => no unverified injection into another game's item sheet.
 return typeof klass==="function"&&app instanceof klass;
}
function wpuCreate(tag,klass,text){
 const node=document.createElement(tag);
 node.className=klass;
 node.textContent=text;
 return node;
}
function wpuDecorateNative(input,strings,editable){
 const label=input.closest?.("label");
 if(!label)return false;
 // The PF1 template puts a text node after this native checkbox.
 // Replace only this text node; retain the original input and its name.
 for(const child of [...label.childNodes]){
  if(child.nodeType===3)child.remove();
 }
 let title=label.querySelector?.(".pf1ae-improvised-label");
 if(!title){
  title=wpuCreate("span","pf1ae-improvised-label",strings.label);
  label.appendChild(title);
 }else title.textContent=strings.label;
 let hint=label.querySelector?.(".pf1ae-improvised-hint");
 if(!hint){
  hint=wpuCreate("small","pf1ae-improvised-hint",strings.hint);
  label.appendChild(hint);
 }else hint.textContent=strings.hint;
 input.disabled=!editable;
 return true;
}
function wpuFallbackInput(section,strings,checked,editable){
 const slot=section.querySelector(".weapon-properties.form-group.stacked")??
  section.querySelector(".weapon-properties")??section;
 if(slot.querySelector?.("."+WPU_MARKER))return;
 const label=wpuCreate("label","checkbox "+WPU_MARKER,"");
 const input=document.createElement("input");
 input.type="checkbox";
 input.name=WPU_NAME;
 input.checked=checked;
 input.disabled=!editable;
 label.appendChild(input);
 label.appendChild(wpuCreate("span","pf1ae-improvised-label",strings.label));
 label.appendChild(wpuCreate("small","pf1ae-improvised-hint",strings.hint));
 slot.appendChild(label);
}
/**
 * Enhance existing PF1 v11.11 weapon checkbox, or gracefully provide it
 * when an alternate weapon template omits the native property list.
 * Not an Item change handler: Foundry's native form is authoritative.
 */
async function wpuEnhance(app,rendered){
 if(!wpuEligible(app))return;
 const root=wpuRoot(app,rendered);
 if(!root)return;
 const section=root.querySelector('.tab.details[data-tab="details"]')??
  root.querySelector('[data-tab="details"]');
 if(!section)return;
 const strings=await wpuStrings();
 // A rerender might have replaced the window content while awaiting
 // locale loading. Never mutate detached sheet markup after F5.
 if(!root.isConnected&&root.ownerDocument?.contains?.(root)===false)return;
 const editable=app.isEditable===true&&app.item?.isOwner===true;
 const check=section.querySelector(WPU_SELECTOR);
 if(check){
  check.checked=app.item.system?.properties?.imp===true;
  if(wpuDecorateNative(check,strings,editable))return;
  // Never create a duplicate input even if template changed its label.
  check.disabled=!editable;
  return;
 }
 wpuFallbackInput(section,strings,
  app.item.system?.properties?.imp===true,editable);
}
Hooks.on("renderApplication",(app,rendered)=>{
 void wpuEnhance(app,rendered).catch(error=>
  wpuDebug("Weapon property enhancement failed",error));
});
