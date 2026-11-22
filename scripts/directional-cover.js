/**
 * PF1AE — generic temporary directional cover, Foundry 13 / PF1 11.11.
 * Item-owned native flags: no walls, no actor AC mutations, no arbitrary JS.
 * A strict corner-ray intersection proves total cover, otherwise fail closed.
 */
const DC_NS="pf1-automation-engine",DC_FLAG="directionalCover";
const DC_EDGES=new Set(["north","east","south","west"]);
const DC_COVERS=new Set(["total","improved","normal","partial"]);
const DC_QUEUE=new Map();
let DC_LAST=null;
const dcClone=x=>foundry.utils.deepClone(x);
const dcFinite=x=>typeof x==="number"&&Number.isFinite(x);
const dcDoc=x=>x?.document??x;
const dcItems=a=>a?.items?.contents??
 (typeof a?.items?.values==="function"?[...a.items.values()]:Array.isArray(a?.items)?a.items:[]);
const dcLeader=()=>[...(game.users??[])].filter(u=>u.active&&u.isGM)
 .sort((a,b)=>a.id.localeCompare(b.id))[0]?.id===game.user?.id;
const dcEnabled=()=>game.modules.get(DC_NS)?.active===true&&
 game.settings.get(DC_NS,"genericEnabled")===true;
function dcQueue(key,work){
 const previous=DC_QUEUE.get(key)??Promise.resolve();
 const next=previous.catch(()=>{}).then(work);
 DC_QUEUE.set(key,next);
 next.finally(()=>{if(DC_QUEUE.get(key)===next)DC_QUEUE.delete(key)}).catch(()=>{});
 return next;
}
function dcRect(token){
 const d=dcDoc(token);
 const grid=d?.parent?.grid?.size??canvas?.scene?.grid?.size??canvas?.grid?.size;
 if(!dcFinite(grid)||grid<=0||!dcFinite(d?.x)||!dcFinite(d?.y)||
  !dcFinite(d?.width)||!dcFinite(d?.height)||
  d.width<=0||d.height<=0)return null;
 return {left:d.x,top:d.y,right:d.x+d.width*grid,
  bottom:d.y+d.height*grid,sceneId:d.parent?.id??null,
  elevation:d.elevation??null};
}
function dcValid(data){
 return data&&typeof data==="object"&&!Array.isArray(data)&&
  Object.keys(data).every(k=>[
   "key","sourceItemUuid","defenderUuid","tokenUuid","protectedEdge",
   "coverType","duration","combatId","combatantId","targetRound",
   "exceptions","reason","requireEquipped"].includes(k))&&
  typeof data.key==="string"&&/^[a-zA-Z0-9_-]{1,80}$/.test(data.key)&&
  typeof data.sourceItemUuid==="string"&&data.sourceItemUuid.length<450&&
  typeof data.defenderUuid==="string"&&data.defenderUuid.length<450&&
  typeof data.tokenUuid==="string"&&data.tokenUuid.length<450&&
  DC_EDGES.has(data.protectedEdge)&&DC_COVERS.has(data.coverType)&&
  data.duration==="startOfNextTurn"&&
  (data.requireEquipped===undefined||typeof data.requireEquipped==="boolean")&&
  typeof data.combatId==="string"&&data.combatId.length<100&&
  typeof data.combatantId==="string"&&data.combatantId.length<100&&
  Number.isSafeInteger(data.targetRound)&&data.targetRound>=0&&
  (!data.exceptions||(
    Object.keys(data.exceptions).every(k=>k==="targetedSpells")&&
    typeof data.exceptions.targetedSpells==="boolean"))&&
  (data.reason==null||(typeof data.reason==="string"&&data.reason.length<=150));
}
function dcCombat(record){
 const combat=game.combats?.get?.(record.combatId);
 if(!combat?.started||!combat.combatants?.get?.(record.combatantId))
  return null;
 return combat;
}
function dcActive(record){
 const combat=dcCombat(record);
 if(!combat)return false;
 if(combat.round>record.targetRound)return false;
 if(combat.round<record.targetRound)return true;
 const index=combat.turns?.findIndex(c=>c.id===record.combatantId)??-1;
 return index>=0&&Number.isInteger(combat.turn)&&combat.turn<index;
}
function dcFindToken(uuid){
 if(typeof fromUuidSync==="function"){
  try{
   const d=fromUuidSync(uuid);
   if(d?.documentName==="Token")return d;
  }catch(_){}
 }
 for(const scene of game.scenes?.contents??[]){
  for(const token of scene.tokens?.contents??[])
   if(token.uuid===uuid)return token;
 }
 return null;
}
function dcEquipped(item,record){
 // Equipment rules belong to the source declaration, not this service.
 return record?.requireEquipped!==true||item?.system?.equipped===true;
}
function dcRecords(actor){
 const results=[];
 for(const item of dcItems(actor)){
  const rows=item?.getFlag?.(DC_NS,DC_FLAG)??[];
  if(!Array.isArray(rows))continue;
  for(const record of rows){
   if(!dcValid(record)||record.sourceItemUuid!==item.uuid||
      record.defenderUuid!==actor.uuid)continue;
   results.push({record,item});
  }
 }
 return results;
}
function dcList({defenderActor,defenderUuid,activeOnly=true}={}){
 const actor=defenderActor?.documentName==="Actor"?defenderActor:
  (typeof fromUuidSync==="function"?fromUuidSync(defenderUuid):null);
 if(!actor||actor.uuid!==defenderUuid)return [];
 return dcRecords(actor).filter(({record,item})=>
   !activeOnly||(dcActive(record)&&dcEquipped(item,record)&&
     !!dcFindToken(record.tokenUuid))).map(({record})=>dcClone(record));
}
async function dcRegister(data){
 if(!dcEnabled())throw Error("Directional cover automation disabled");
 const item=await fromUuid(data?.sourceItemUuid);
 const actor=item?.actor??item?.parent;
 if(item?.documentName!=="Item"||actor?.documentName!=="Actor"||
    actor.uuid!==data?.defenderUuid)throw Error("Source Item/Actor mismatch");
 if(!game.user?.isGM&&!actor.testUserPermission?.(game.user,"OWNER"))
  throw Error("Owner or GM required");
 if(data?.requireEquipped===true&&item?.system?.equipped!==true)
  throw Error("Source Item must be equipped");
 const token=await fromUuid(data?.tokenUuid);
 if(token?.documentName!=="Token"||token.actor?.uuid!==actor.uuid)
  throw Error("Token/Actor mismatch");
 const combat=game.combat;
 if(!combat?.started||combat.id!==data.combatId||
    combat.combatant?.id!==data.combatantId||
    combat.combatant?.actor?.uuid!==actor.uuid)
  throw Error("Must act on this character's current combat turn");
 const record={
  key:data.key,sourceItemUuid:item.uuid,defenderUuid:actor.uuid,
  tokenUuid:token.uuid,protectedEdge:data.protectedEdge,
  coverType:data.coverType??"total",duration:"startOfNextTurn",
  combatId:combat.id,combatantId:combat.combatant.id,
  targetRound:combat.round+1,
  exceptions:data.exceptions??{},requireEquipped:data.requireEquipped===true,
  reason:data.reason??"Directional cover"
 };
 if(!dcValid(record))throw Error("Invalid directional cover declaration");
 return dcQueue(item.uuid,async()=>{
  const current=item.getFlag(DC_NS,DC_FLAG)??[];
  if(!Array.isArray(current))throw Error("Corrupt directional cover flags");
  const keep=current.filter(x=>x.key!==record.key);
  if(keep.length>=50)throw Error("Too many directional covers");
  await item.setFlag(DC_NS,DC_FLAG,[...keep,record]);
  return dcClone(record);
 });
}
async function dcRemove({sourceItemUuid,defenderUuid,key}={}){
 const item=await fromUuid(sourceItemUuid);
 const actor=item?.actor??item?.parent;
 if(item?.documentName!=="Item"||actor?.uuid!==defenderUuid)
  throw Error("Source Item/Actor mismatch");
 if(!game.user?.isGM&&!actor.testUserPermission?.(game.user,"OWNER"))
  throw Error("Owner or GM required");
 return dcQueue(item.uuid,async()=>{
  const rows=item.getFlag(DC_NS,DC_FLAG)??[];
  if(!Array.isArray(rows))return {removed:false};
  const keep=rows.filter(x=>x.key!==key);
  if(keep.length===rows.length)return {removed:false};
  await item.setFlag(DC_NS,DC_FLAG,keep);
  return {removed:true};
 });
}
function dcEdge(rect,side){
 switch(side){
  case "north":return {a:{x:rect.left,y:rect.top},b:{x:rect.right,y:rect.top}};
  case "south":return {a:{x:rect.left,y:rect.bottom},b:{x:rect.right,y:rect.bottom}};
  case "west":return {a:{x:rect.left,y:rect.top},b:{x:rect.left,y:rect.bottom}};
  case "east":return {a:{x:rect.right,y:rect.top},b:{x:rect.right,y:rect.bottom}};
 }
}
function dcSegmentCross(a,b,c,d){
 const cross=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
 const a1=cross(a,b,c),a2=cross(a,b,d);
 const b1=cross(c,d,a),b2=cross(c,d,b);
 const eps=1e-6;
 if(Math.abs(a1)<eps||Math.abs(a2)<eps||Math.abs(b1)<eps||Math.abs(b2)<eps)
  return "uncertain";
 return (a1*a2<0&&b1*b2<0)?"cross":"clear";
}
function dcGeometry(attacker,target,edge){
 const a=dcRect(attacker),d=dcRect(target);
 if(!a||!d||!a.sceneId||a.sceneId!==d.sceneId)
  return {status:"uncertain",reason:"unverified-token-geometry"};
 if(!dcFinite(a.elevation)||!dcFinite(d.elevation)||a.elevation!==d.elevation)
  return {status:"uncertain",reason:"3d-line-of-effect-unverified"};
 const line=dcEdge(d,edge);
 if(!line)return {status:"uncertain",reason:"invalid-protected-edge"};
 const origins=[
  {x:a.left,y:a.top},{x:a.right,y:a.top},
  {x:a.left,y:a.bottom},{x:a.right,y:a.bottom}
 ];
 // Sample interior endpoints, not exactly on the boundary: a wall-like
 // barrier must interrupt EVERY possible corner ray before total cover.
 const e=Math.max(0.01,Math.min(d.right-d.left,d.bottom-d.top)/1000);
 const ends=[
  {x:d.left+e,y:d.top+e},{x:d.right-e,y:d.top+e},
  {x:d.left+e,y:d.bottom-e},{x:d.right-e,y:d.bottom-e}
 ];
 let crosses=0,clears=0,unknown=0;
 for(const start of origins)for(const finish of ends){
  const hit=dcSegmentCross(start,finish,line.a,line.b);
  if(hit==="cross")crosses++;else if(hit==="clear")clears++;else unknown++;
 }
 if(crosses===16)return {status:"confirmed",crosses,clears,unknown};
 if(crosses===0&&unknown===0)return {status:"not-applicable",crosses,clears,unknown};
 return {status:"uncertain",reason:"mixed-or-grazing-corner-rays",
  crosses,clears,unknown};
}
function dcInspect({attacker,target,attackType="ranged",action,actionUse}={}){
 const defender=target?.actor??dcDoc(target)?.actor;
 if(!dcEnabled()||!defender?.uuid)return {status:"not-applicable"};
 const targetDoc=dcDoc(target),sourceDoc=dcDoc(attacker);
 if(!targetDoc?.uuid||!sourceDoc?.uuid)return {status:"uncertain",reason:"token-unavailable"};
 // Targeted spells (without an attack roll) and area effects are outside
 // this direct-attack bridge. Rays/touch attacks are handled as attacks.
 if(!["ranged","melee","reach"].includes(attackType))
  return {status:"not-applicable"};
 if(action?.hasAttack===false)return {status:"not-applicable"};
 if(action?.hasTemplate===true&&action?.hasAttack!==true)
  return {status:"not-applicable"};
 const candidates=dcRecords(defender).filter(({record,item})=>
  record.tokenUuid===targetDoc.uuid&&dcActive(record)&&dcEquipped(item,record));
 if(!candidates.length)return {status:"not-applicable"};
 let uncertain=null;
 for(const {record} of candidates){
  const geometry=dcGeometry(attacker,target,record.protectedEdge);
  if(geometry.status==="confirmed"){
   const bonuses={partial:[2,1],normal:[4,2],improved:[8,4],total:[null,null]};
   const [acBonus,reflexBonus]=bonuses[record.coverType];
   const result={status:"confirmed",type:record.coverType,acBonus,reflexBonus,
    preventsDirectAttack:record.coverType==="total",source:"directional-cover",
    reason:record.reason,protectedEdge:record.protectedEdge,
    key:record.key,geometry};
   DC_LAST=dcClone(result);return result;
  }
  if(geometry.status==="uncertain")uncertain={status:"uncertain",
    reason:geometry.reason,source:"directional-cover",geometry};
 }
 return uncertain??{status:"not-applicable"};
}
async function dcCleanup(){
 if(!dcLeader())return;
 for(const actor of [...(game.actors?.contents??[]),
  ...(game.scenes?.contents??[]).flatMap(scene=>
   (scene.tokens?.contents??[]).filter(t=>!t.actorLink).map(t=>t.actor))]){
  if(!actor?.uuid)continue;
  for(const item of dcItems(actor)){
   const rows=item?.getFlag?.(DC_NS,DC_FLAG);
   if(!Array.isArray(rows)||!rows.length)continue;
   await dcQueue(item.uuid,async()=>{
    const current=item.getFlag(DC_NS,DC_FLAG)??[];
    if(!Array.isArray(current))return;
    const keep=current.filter(r=>dcValid(r)&&dcActive(r)&&
      dcEquipped(item,r)&&!!dcFindToken(r.tokenUuid));
    if(keep.length!==current.length)await item.setFlag(DC_NS,DC_FLAG,keep);
   });
  }
 }
}
async function dcChooseEdge(){
 const Dialog=foundry?.applications?.api?.DialogV2;
 if(typeof Dialog?.wait!=="function")throw Error("Foundry DialogV2 unavailable");
 return Dialog.wait({
  window:{title:game.i18n?.localize?.("PF1AE.DirectionalCover.ChooseTitle")??"Choose protected edge"},
  content:"<p>"+(game.i18n?.localize?.("PF1AE.DirectionalCover.ChooseHint")??"Choose an edge of your token's space.")+"</p>",
  buttons:["north","east","south","west"].map(edge=>({
   action:edge,label:game.i18n?.localize?.("PF1AE.DirectionalCover."+edge)??edge,
   callback:()=>edge
  })).concat([{action:"cancel",label:game.i18n?.localize?.("Cancel")??"Cancel",
    callback:()=>null}]),
  close:()=>null
 });
}
Hooks.once("init",()=>{
 for(const name of ["combatTurnChange","updateCombat","deleteCombat",
   "updateItem","deleteItem","deleteToken","canvasReady","updateUser"])
  Hooks.on(name,()=>{void dcCleanup().catch(e=>console.warn("[PF1AE][DirectionalCover] Cleanup",e))});
});
Hooks.once("ready",()=>{
 const mod=game.modules.get(DC_NS);if(!mod)return;
 mod.api??={};
 mod.api.directionalCover=Object.freeze({
  register:dcRegister,remove:dcRemove,list:dcList,inspect:dcInspect,
  chooseEdge:dcChooseEdge,cleanup:dcCleanup,
  lastDiagnostic:()=>DC_LAST?dcClone(DC_LAST):null
 });
 void dcCleanup().catch(e=>console.warn("[PF1AE][DirectionalCover] Restore cleanup",e));
});
