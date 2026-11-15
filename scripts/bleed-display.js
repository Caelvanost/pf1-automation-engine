/**
 * PF1AE — Bleed: single native condition icon with a formula badge.
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
 const formula=bvFormula(token.actor);
 if(!formula)return;
 if(typeof PIXI?.Text!=='function')return;
 const sprite=bvSprite(token);
 if(!sprite)return;
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
 const mod=game.modules.get(BV_NS);mod.api??={};
 mod.api.bleedDisplay=Object.freeze({
  formula:bvFormula,
  refresh:token=>bvPaint(token),
  hideGenerated:()=>bvRestoreHiding()
 });
});
