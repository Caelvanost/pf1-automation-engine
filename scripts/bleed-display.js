/**
 * PF1AE — Bleed: native condition icon and selected-token HUD formula badges.
 * Uses PF1's native Buff hide-from-token setting.
 */
const BV_NS='pf1-automation-engine';
const BV_MANUAL='manualBleed';
const BV_BADGE='pf1aeBleedFormulaBadge';
const bvItems=actor=>[...(actor?.items?.contents??actor?.items?.values?.()??[])];
const bvManual=actor=>bvItems(actor).filter(item=>
 item.type==='buff'&&item.getFlag?.(BV_NS,BV_MANUAL)?.generated===true);
const bvEnabled=()=>game.modules.get(BV_NS)?.active===true;
const bvLive=item=>item.activeState===true||
 (item.activeState==null&&item.system?.active===true);
const bvFormula=actor=>{
 if(!actor)return null;
 const native=[...(actor?.effects?.contents??actor?.effects?.values?.()??[])]
  .find(e=>e?.statuses?.has?.('bleed')===true&&e.disabled!==true);
 const nativeValue=native?.getFlag?.(BV_NS,'bleed')?.formula;
 const item=bvManual(actor).find(bvLive);
 const value=nativeValue??item?.getFlag?.(BV_NS,'bleed')?.formula;
 return typeof value==='string'&&value.length>0&&value.length<=100?value:null;
};

/** Client-language label; never rely on the world-persisted name for translations. */
function bvLabel(actor){
 const formula=bvFormula(actor);
 if(!formula)return null;
 const lang=String(game.i18n?.lang??'en').toLowerCase();
 return (lang==='fr'||lang.startsWith('fr-')?'Saignement':'Bleed')+' - '+formula;
}
function bvNative(actor){
 return [...(actor?.effects?.contents??actor?.effects?.values?.()??[])]
  .find(effect=>effect?.statuses?.has?.('bleed')===true&&effect.disabled!==true)??null;
}
/** Adapt the native effect row in actor/effects sheets without changing its UUID or statuses. */
function bvSheet(app,element){
 if(!bvEnabled())return;
 const actor=app?.actor??app?.document?.actor??
  (app?.document?.documentName==='Actor'?app.document:null);
 const native=bvNative(actor),label=bvLabel(actor);
 if(!native?.id||!label)return;
 const root=element?.querySelectorAll?element:
  element?.[0]?.querySelectorAll?element[0]:null;
 if(!root)return;
 const escapeId=String(native.id).replace(/[^a-zA-Z0-9_-]/g,'');
 const rows=root.querySelectorAll(
  '[data-effect-id="'+escapeId+'"], [data-document-id="'+escapeId+'"]'
 );
 for(const row of rows){
  const target=row.querySelector?.('.effect-name, .item-name, .name, [data-role="effect-name"]');
  if(target){
   target.textContent=label;
   target.setAttribute?.('title',label);
   target.setAttribute?.('data-tooltip-text',label);
  }
 }
}


/**
 * PF1 v11 exposes renderPF1ExtendedTooltip(sheet,id,template) before mounting
 * a system-owned extended tooltip. Do not rely on PIXI icon hover events:
 * native PF1 effects can be noninteractive sprites.
 */
const bvBleedHeading=text=>/^(?:Bleed|Saignement)(?:\\s*[-–—]\\s*.*)?$/i.test(
 String(text??'').trim()
);
function bvReplaceHeading(root,label){
 if(!root||!label)return false;
 const nodes=[root,...(root.querySelectorAll?.('*')??[])];
 // Work from innermost nodes to avoid overwriting all tooltip contents.
 for(let index=nodes.length-1;index>=0;index--){
  const node=nodes[index];
  if(node.nodeType===3||!node.textContent)continue;
  if(node.children?.length>0)continue;
  const value=String(node.textContent).trim();
  if(!bvBleedHeading(value))continue;
  if(value===label)return false;
  node.textContent=label;
  return true;
 }
 return false;
}
function bvSystemExtendedTooltip(sheet,id,template){
 if(!bvEnabled())return;
 const actor=sheet?.actor??sheet?.document;
 if(actor?.documentName!=='Actor')return;
 const label=bvLabel(actor);
 if(!label)return;
 const root=template?.content??template;
 if(!root)return;
 const identifier=String(id??'').toLowerCase();
 if(!identifier.includes('bleed')){
  // Some PF1 extended tooltips use generic identifiers. Require a native
  // Bleed label within the fragment rather than touching unrelated effects.
  const nodes=[...(root.querySelectorAll?.('*')??[])];
  if(!nodes.some(node=>node.children?.length===0&&bvBleedHeading(node.textContent)))return;
 }
 bvReplaceHeading(root,label);
}
/**
 * Fallback for PF1's separately mounted token-condition popovers.
 * Monitor actual DOM insertions; do NOT wait for pointerover on PIXI sprites.
 */
let BV_TOOLTIP_DOM_OBSERVER=null;
function bvTooltipActor(){
 const hovered=canvas?.tokens?.hovered?.actor;
 if(bvLabel(hovered))return hovered;
 const controlled=(canvas?.tokens?.controlled??[]).filter(token=>bvLabel(token.actor));
 if(controlled.length===1)return controlled[0].actor;
 return null;
}
function bvTooltipCandidate(root){
 const element=root?.nodeType===3?root.parentElement:root;
 if(!element||element.nodeType!==1)return false;
 const tooltip=element.closest?.(
  '[role="tooltip"], [id*="tooltip"], [class*="tooltip"], '+
  '[class*="popover"], [class*="condition-info"]'
 );
 if(tooltip)return true;
 // PF1 custom popover templates need not contain the word tooltip in CSS.
 // The screenshot's duration/termination rows provide stronger identity.
 let current=element;
 for(let i=0;i<5&&current;i++,current=current.parentElement){
  const value=String(current.textContent??'');
  if(value.length>5000)break;
  if(/Max duration|Might stop with|Durée max|Durée maximale/i.test(value))
   return true;
 }
 return false;
}
function bvPatchDomTooltip(root){
 const actor=bvTooltipActor(),label=bvLabel(actor);
 if(!label||!root)return false;
 const el=root.nodeType===3?root.parentElement:root;
 if(!el||el.nodeType!==1)return false;
 const nodes=[el,...(el.querySelectorAll?.('*')??[])];
 for(let i=nodes.length-1;i>=0;i--){
  const node=nodes[i];
  if(node.children?.length>0||!bvBleedHeading(node.textContent))continue;
  if(!bvTooltipCandidate(node))continue;
  if(node.textContent===label)return false;
  node.textContent=label;
  return true;
 }
 return false;
}
function bvInstallTooltipObserver(){
 if(BV_TOOLTIP_DOM_OBSERVER||typeof MutationObserver!=='function'||
    !document?.body)return;
 BV_TOOLTIP_DOM_OBSERVER=new MutationObserver(mutations=>{
  for(const record of mutations){
   if(record.type==='characterData'){
    bvPatchDomTooltip(record.target);
    continue;
   }
   for(const node of record.addedNodes??[])bvPatchDomTooltip(node);
  }
 });
 BV_TOOLTIP_DOM_OBSERVER.observe(document.body,{
  childList:true,subtree:true,characterData:true
 });
}

const bvIconSources=actor=>{
 const sources=new Set();
 const add=s=>{if(typeof s==='string'&&s.length>0)sources.add(s)};
 const native=(CONFIG.statusEffects??[]).find(e=>e.id==='bleed');
 add(native?.img);add(native?.icon);
 for(const effect of actor?.effects?.contents??actor?.effects?.values?.()??[]){
  if(effect.statuses?.has?.('bleed')){
   add(effect.img);add(effect.icon);add(effect._source?.img);
  }
 }
 return sources;
};
const bvSrc=sprite=>{
 const texture=sprite?.texture;
 return [
  sprite?.src,sprite?.icon,sprite?.name,
  texture?.label,texture?.source?.label,
  texture?.source?.resource?.url,texture?.source?.resource?.src,
  texture?.baseTexture?.resource?.url,
  texture?.baseTexture?.resource?.src
 ].filter(x=>typeof x==='string');
};
const bvNormalized=s=>typeof s==='string'?
 s.split('?')[0].replace(/^https?:\/\/[^/]+\//,'').replace(/^\//,''):null;
function bvSprite(token){
 const candidates=bvIconSources(token?.actor);
 if(!candidates.size)return null;
 // Match a REAL native Bleed sprite rather than an arbitrary icon slot.
 const paths=new Set([...candidates].map(bvNormalized));
 const children=token?.effects?.children??[];
 return children.find(sprite=>{
  if(typeof sprite?.addChild!=='function'||!sprite.texture)return false;
  return bvSrc(sprite).some(src=>paths.has(bvNormalized(src)));
 })??null;
}
function bvPaint(token){
 if(!bvEnabled()||!token?.actor)return;
 if(typeof PIXI?.Text!=='function')return;
 const sprite=bvSprite(token);
 if(!sprite)return;
 const formula=bvFormula(token.actor);
 const label=bvLabel(token.actor);
 if(label){sprite.title=label;sprite.accessibleTitle=label;}
 if(!formula){
  for(const child of [...(sprite.children??[])]){
   if(child?.[BV_BADGE]===true){sprite.removeChild?.(child);child.destroy?.();}
  }
  return;
 }
 const previous=sprite.children?.find(child=>child?.[BV_BADGE]===true);
 if(previous){
  if(previous.text!==formula)previous.text=formula;
  return;
 }
 const size=Math.max(9,Math.min(17,Math.round((sprite.width||32)*0.44)));
 const badge=new PIXI.Text({
  text:formula,
  style:{
   fontFamily:'Arial',fontSize:size,fontWeight:'bold',
   fill:0xffffff,stroke:{color:0x080808,width:3},
   align:'center'
  }
 });
 badge[BV_BADGE]=true;
 badge.anchor?.set?.(0.5,1);
 badge.x=(sprite.width||32)/2;
 badge.y=(sprite.height||32)-1;
 badge.eventMode='none';
 sprite.addChild(badge);
}

/** Render the formula on the native Bleed control in the selected-token HUD.
 * Never edit the Actor, native ActiveEffect or CONFIG.statusEffects.
 */
function bvHud(hud,element){
 if(!bvEnabled())return;
 const actor=hud?.object?.actor??hud?.actor??hud?.document?.actor;
 if(!actor)return;
 const formula=bvFormula(actor);
 const root=element?.querySelectorAll?element:
  element?.[0]?.querySelectorAll?element[0]:
  hud?.element?.querySelectorAll?hud.element:null;
 if(!root)return;
 // Foundry V13 palette uses data-status-id; compatibility selectors are
 // restricted to exact Bleed controls, never arbitrary effect icons.
 const controls=root.querySelectorAll(
  '[data-status-id="bleed"], [data-effect-id="bleed"], [data-condition="bleed"]'
 );
 for(const control of controls){
  const existing=control.querySelector?.('.pf1ae-bleed-hud-value');
  if(!formula){
   existing?.remove?.();
   // Remove our tooltip override, allowing Foundry's native status label.
   control.removeAttribute?.('data-tooltip-text');
   for(const icon of control.querySelectorAll?.('[data-tooltip-text]')??[]){
    if(icon.classList?.contains?.('pf1ae-bleed-hud-value'))continue;
    icon.removeAttribute?.('data-tooltip-text');
   }
   continue;
  }
  const localized=bvLabel(actor);
  control.title=localized;
  control.setAttribute?.('aria-label',localized);
  // Foundry V13 TooltipManager reads data-tooltip-text, not title or
  // aria-label. Preserve the native data-tooltip key and avoid HTML.
  control.setAttribute?.('data-tooltip-text',localized);
  // Some PF1 skins put the hover anchor on the icon nested in the
  // status control. Override that exact icon's tooltip as well.
  for(const icon of control.querySelectorAll?.('[data-tooltip], [data-tooltip-text]')??[]){
   if(icon.classList?.contains?.('pf1ae-bleed-hud-value'))continue;
   icon.setAttribute?.('data-tooltip-text',localized);
  }
  if(existing){existing.textContent=formula;continue;}
  if(typeof document?.createElement!=='function')continue;
  const badge=document.createElement('span');
  badge.className='pf1ae-bleed-hud-value';
  badge.textContent=formula;
  // Purely decorative: clicks still reach the native effect control.
  badge.style.cssText='position:absolute;bottom:0;right:0;pointer-events:none;'+
   'font-size:11px;font-weight:700;color:white;background:#161616cc;'+
   'padding:0 2px;border-radius:3px;line-height:1.1;z-index:2';
  if(control.style&&!control.style.position)control.style.position='relative';
  control.appendChild(badge);
 }
}

const bvTokens=actor=>{
 const result=new Map();
 for(const token of canvas?.tokens?.placeables??[]){
  if(token?.actor?.uuid===actor?.uuid)
   result.set(token.id??token.document?.uuid,token);
 }
 return [...result.values()];
};
async function bvHideBuff(item){
 if(!bvEnabled()||item?.type!=='buff'||
    item.getFlag?.(BV_NS,BV_MANUAL)?.generated!==true||
    item.system?.hideFromToken===true)return false;
 const actor=item.actor??item.parent;
 if(!actor||(!game.user?.isGM&&
    !actor.testUserPermission?.(game.user,'OWNER')))return false;
 await item.update({'system.hideFromToken':true});
 return true;
}
async function bvRestoreHiding(){
 if(!game.user?.isGM||!bvEnabled())return;
 const actors=new Map();
 const add=actor=>{if(actor?.documentName==='Actor'&&actor.uuid)
  actors.set(actor.uuid,actor)};
 for(const actor of game.actors?.contents??game.actors?.values?.()??[])add(actor);
 for(const scene of game.scenes?.contents??game.scenes?.values?.()??[])
  for(const token of scene.tokens?.contents??scene.tokens?.values?.()??[])
   add(token.actor??token.object?.actor);
 for(const actor of actors.values()){
  for(const item of bvManual(actor)){
   try{await bvHideBuff(item)}
   catch(error){console.warn('[PF1AE][BleedDisplay] Cannot hide manual Buff',item.uuid,error)}
  }
 }
}

/** Bring existing native Bleed condition names up to date on world load.
 * Only the elected active GM writes, avoiding conflicting client locales.
 */
async function bvRestoreNames(){
 if(!bvEnabled()||game.user?.isGM!==true)return;
 const leader=[...(game.users??[])].filter(u=>u.active&&u.isGM)
  .sort((a,b)=>a.id.localeCompare(b.id))[0];
 if(leader&&leader.id!==game.user.id)return;
 const actors=new Map();
 const add=actor=>{if(actor?.documentName==='Actor'&&actor.uuid)
  actors.set(actor.uuid,actor);};
 for(const actor of game.actors?.contents??[])add(actor);
 for(const scene of game.scenes?.contents??[])
  for(const token of scene.tokens?.contents??[])add(token.actor??token.object?.actor);
 for(const actor of actors.values()){
  const effect=bvNative(actor),name=bvLabel(actor);
  if(!effect||!name||typeof effect.update!=='function'||effect.name===name)continue;
  // Never rename an unrelated unconfigured native bleed status.
  if(effect.getFlag?.(BV_NS,'bleed')?.enabled!==true)continue;
  try{await effect.update({name});}
  catch(error){console.warn('[PF1AE][BleedDisplay] Cannot update native effect name',effect.uuid,error);}
 }
}

function bvInstall(){
 const klass=CONFIG.Token?.objectClass??globalThis.Token;
 const prototype=klass?.prototype;
 if(typeof prototype?.drawEffects!=='function')return;
 const lib=game.modules.get('lib-wrapper');
 if(lib?.active&&typeof globalThis.libWrapper?.register==='function'){
  try{
   globalThis.libWrapper.register(BV_NS,'Token.prototype.drawEffects',async function(wrapped,...args){
    const result=await wrapped(...args);
    bvPaint(this);
    return result;
   },'WRAPPER');
   return;
  }catch(error){console.warn('[PF1AE][BleedDisplay] libWrapper fallback',error)}
 }
 const original=prototype.drawEffects;
 if(original?.pf1aeBleedWrapped)return;
 const wrapped=async function(...args){
  const result=await original.apply(this,args);
  bvPaint(this);
  return result;
 };
 wrapped.pf1aeBleedWrapped=true;
 prototype.drawEffects=wrapped;
}
Hooks.once('ready',()=>{
 if(!bvEnabled())return;
 bvInstall();
 Hooks.on('drawToken',token=>bvPaint(token));
 Hooks.on('renderTokenHUD',(hud,element)=>bvHud(hud,element));
 Hooks.on('renderPF1ExtendedTooltip',bvSystemExtendedTooltip);
 bvInstallTooltipObserver();
 Hooks.on('renderActorSheet',(app,element)=>bvSheet(app,element));
 Hooks.on('renderActiveEffectConfig',(app)=>{
  const effect=app?.document;
  if(effect?.statuses?.has?.('bleed')!==true)return;
  const label=bvLabel(effect.parent??effect.actor);
  if(label&&app.window)app.window.title=label;
 });
 Hooks.on('refreshToken',token=>bvPaint(token));
 Hooks.on('updateActiveEffect',effect=>{
  if(effect?.statuses?.has?.('bleed')!==true)return;
  for(const token of bvTokens(effect.parent??effect.actor))bvPaint(token);
 });
 Hooks.on('updateItem',item=>{
  if(item?.getFlag?.(BV_NS,BV_MANUAL)?.generated!==true)return;
  for(const token of bvTokens(item.actor??item.parent))
   bvPaint(token);
  if(item.system?.hideFromToken!==true)
   void bvHideBuff(item).catch(error=>
    console.warn('[PF1AE][BleedDisplay] Could not hide generated Buff',error));
 });
 void bvRestoreHiding();
 void bvRestoreNames();
 const mod=game.modules.get(BV_NS);mod.api??={};
 mod.api.bleedDisplay=Object.freeze({
  formula:bvFormula,
  label:bvLabel,
  sheet:(app,element)=>bvSheet(app,element),
  refresh:token=>bvPaint(token),
  hud:(hud,element)=>bvHud(hud,element),
  hideGenerated:()=>bvRestoreHiding(),
  refreshNames:()=>bvRestoreNames(),
  richTooltip:(root)=>bvPatchDomTooltip(root),
  extendedTooltip:(sheet,id,template)=>bvSystemExtendedTooltip(sheet,id,template)
 });
});
