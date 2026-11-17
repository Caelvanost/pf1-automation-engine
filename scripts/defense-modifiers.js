/**
 * PF1AE — generic persistent conditional defenses (PF1e 11.11).
 * Only data-driven, source-bound modifiers; no class/feat logic and no
 * mutation of native AC or saving throws.
 *
 * Storage: native Foundry Item flags on the defender's own source Item.
 * Native Document permissions and server-side validation authorize writes;
 * no unauthenticated custom socket or world-setting mutation is required.
 */
const DM_NS='pf1-automation-engine';
const DM_FLAG='defenseModifiers';
const DM_TYPES=new Set(['deflection','cover','dodge','circumstance',
 'competence','enhancement','insight','luck','morale','natural',
 'profane','racial','resistance','sacred','shield','size','untyped']);
const DM_DEFENSES=new Set(['normal','touch','flatFooted','ref']);
const DM_STACKING=new Set(['dodge','circumstance','untyped']);
const DM_QUEUES=new Map();
let DM_LAST=null;
const dmClone=x=>foundry.utils.deepClone(x);
const dmKey=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(x);
const dmUuid=x=>typeof x==='string'&&x.length<=350&&
 /^(Actor\.[^.]+|Scene\.[^.]+\.Token\.[^.]+\.Actor\.[^.]+)(?:\..+)?$/.test(x);
const dmEnabled=()=>game.modules.get(DM_NS)?.active===true&&
 game.settings.get(DM_NS,'genericEnabled')===true;
const dmIdentity=d=>JSON.stringify([d.defenderUuid,d.sourceItemUuid,d.key]);
const dmFrom=(uuid)=>{
 try{return typeof fromUuidSync==='function'?fromUuidSync(uuid):null}
 catch(_){return null}
};
const dmSourceActor=(doc)=>doc?.documentName==='Actor'?doc:
 doc?.actor?.documentName==='Actor'?doc.actor:null;
const dmActor=(uuid)=>dmSourceActor(dmFrom(uuid));
const dmItems=(actor)=>[...(actor?.items?.contents??actor?.items?.values?.()??[])];
function dmValidate(data){
 return !!data&&typeof data==='object'&&!Array.isArray(data)&&
  Object.keys(data).every(k=>[
   'key','sourceItemUuid','defenderUuid','attackerUuid',
   'bonusType','value','defenses','reason','expiresOnDeathOf'].includes(k))&&
  dmKey(data.key)&&dmUuid(data.sourceItemUuid)&&dmUuid(data.defenderUuid)&&
  (data.attackerUuid==null||dmUuid(data.attackerUuid))&&
  (data.expiresOnDeathOf==null||dmUuid(data.expiresOnDeathOf))&&
  DM_TYPES.has(data.bonusType)&&Number.isSafeInteger(data.value)&&
  data.value>=-100&&data.value<=100&&
  Array.isArray(data.defenses)&&data.defenses.length>0&&data.defenses.length<=4&&
  data.defenses.every(x=>DM_DEFENSES.has(x))&&
  (data.reason==null||(typeof data.reason==='string'&&data.reason.length<=180));
}
function dmQueue(id,work){
 const before=DM_QUEUES.get(id)??Promise.resolve();
 const next=before.catch(()=>{}).then(work);
 DM_QUEUES.set(id,next);
 next.finally(()=>{if(DM_QUEUES.get(id)===next)DM_QUEUES.delete(id)})
  .catch(()=>{});
 return next;
}
async function dmOwnSource(data){
 if(!dmEnabled())throw Error('Defense service disabled');
 if(!dmValidate(data))throw Error('Invalid declarative defense modifier');
 const item=await fromUuid(data.sourceItemUuid);
 if(item?.documentName!=='Item'||item.actor?.uuid!==data.defenderUuid)
  throw Error('Source Item must belong to the defender Actor');
 if(!game.user?.isGM&&item.actor.testUserPermission?.(game.user,'OWNER')!==true)
  throw Error('Actor owner or GM required');
 if(typeof item.setFlag!=='function'||typeof item.getFlag!=='function')
  throw Error('Native Item flag persistence unavailable');
 return item;
}
async function dmRegister(data){
 const item=await dmOwnSource(data);
 const clean=dmClone(data);
 return dmQueue(item.uuid,async()=>{
  // Storage is authoritative on the Item. A second invocation of the same
  // stable source key replaces the record; never stacks duplicate copies.
  const records=item.getFlag(DM_NS,DM_FLAG)??[];
  if(!Array.isArray(records))throw Error('Invalid existing Item defense flags');
  const next=records.filter(x=>x.key!==clean.key);
  if(next.length>=100)throw Error('Too many modifiers on source Item');
  next.push(clean);
  await item.setFlag(DM_NS,DM_FLAG,next);
  return {id:dmIdentity(clean),record:dmClone(clean)};
 });
}
async function dmRemove({key,sourceItemUuid,defenderUuid}={}){
 if(!dmKey(key)||!dmUuid(sourceItemUuid)||!dmUuid(defenderUuid))
  throw Error('Invalid modifier identity');
 const item=await fromUuid(sourceItemUuid);
 if(item?.documentName!=='Item'||item.actor?.uuid!==defenderUuid)
  throw Error('Source Item/defender mismatch');
 if(!game.user?.isGM&&item.actor.testUserPermission?.(game.user,'OWNER')!==true)
  throw Error('Actor owner or GM required');
 return dmQueue(item.uuid,async()=>{
  const stored=item.getFlag(DM_NS,DM_FLAG)??[];
  const next=stored.filter(x=>x.key!==key);
  if(stored.length===next.length)return {removed:false};
  await item.setFlag(DM_NS,DM_FLAG,next);
  return {removed:true};
 });
}
function dmRaw({defenderActor,defenderUuid}={}){
 const actor=defenderActor?.documentName==='Actor'?defenderActor:
  dmActor(defenderUuid);
 if(!actor||actor.uuid!==defenderUuid)return null;
 const records=[];
 for(const item of dmItems(actor)){
  const saved=item.getFlag?.(DM_NS,DM_FLAG)??[];
  if(!Array.isArray(saved))return null;
  for(const entry of saved){
   if(!dmValidate(entry)||entry.defenderUuid!==actor.uuid||
      entry.sourceItemUuid!==item.uuid)return null;
   records.push({...dmClone(entry),id:dmIdentity(entry)});
  }
 }
 return records;
}
function dmList({defenderActor,defenderUuid,attackerUuid,defense}={}){
 const all=dmRaw({defenderActor,defenderUuid});
 if(!all)return null;
 return all.filter(r=>(defense==null||r.defenses.includes(defense))&&
  (attackerUuid==null||r.attackerUuid==null||r.attackerUuid===attackerUuid));
}
function dmEvaluate({defenderActor,defenderUuid,attackerUuid,defense,nativeTypes,
 nativeTypesComplete=false}={}){
 if(!dmEnabled()||!dmUuid(defenderUuid)||!DM_DEFENSES.has(defense))
  return {status:'uncertain',reason:'defender or defense unavailable',total:null};
 const all=dmList({defenderActor,defenderUuid});
 if(!all)return {status:'uncertain',reason:'defender Item flags unavailable',total:null};
 if(!attackerUuid&&all.some(x=>x.attackerUuid&&x.defenses.includes(defense)))
  return {status:'uncertain',reason:'attacker identity unavailable',total:null};
 if(attackerUuid!=null&&!dmUuid(attackerUuid))
  return {status:'uncertain',reason:'invalid attacker identity',total:null};
 const candidates=all.filter(x=>x.defenses.includes(defense)&&
   (!x.attackerUuid||x.attackerUuid===attackerUuid));
 const used=[],suppressed=[],unknownTypes=[];
 let total=0;
 const byType=new Map();
 for(const entry of candidates){
  if(entry.expiresOnDeathOf){
   const expired=dmActor(entry.expiresOnDeathOf);
   if(!expired)return {status:'uncertain',reason:'expiration actor unavailable',total:null};
   if(expired.statuses?.has?.('dead'))continue;
  }
  const group=byType.get(entry.bonusType)??[];
  group.push(entry);byType.set(entry.bonusType,group);
 }
 for(const [type,entries] of byType){
  if(!DM_STACKING.has(type)&&!nativeTypesComplete&&
     !Object.hasOwn(nativeTypes??{},type)){
   unknownTypes.push(type);continue;
  }
  const native=Number(nativeTypes?.[type]??0);
  if(!Number.isFinite(native))return {
   status:'uncertain',reason:'invalid native bonus breakdown',total:null};
  if(DM_STACKING.has(type)){
   for(const item of entries){used.push(item);total+=item.value}
   continue;
  }
  const best=[...entries].filter(x=>x.value>=0)
   .sort((a,b)=>b.value-a.value)[0];
  if(best&&best.value>native){used.push(best);total+=best.value-Math.max(0,native)}
  if(best&&best.value<=native)suppressed.push(best);
  suppressed.push(...entries.filter(x=>x.value>=0&&x!==best));
  // PF1 typed penalties do not cancel a typed bonus in a stacking contest.
  for(const neg of entries.filter(x=>x.value<0)){used.push(neg);total+=neg.value}
 }
 const result={status:unknownTypes.length?'uncertain':'resolved',
  reason:unknownTypes.length?'Unverified native bonus types: '+unknownTypes.join(', '):null,
  total:unknownTypes.length?null:total,applied:used,
  suppressed,unknownTypes};
 DM_LAST=result;return dmClone(result);
}
Hooks.once('ready',()=>{
 const mod=game.modules.get(DM_NS);if(!mod)return;
 mod.api??={};
 mod.api.defenseModifiers=Object.freeze({
  register:dmRegister,remove:dmRemove,list:dmList,evaluate:dmEvaluate,
  lastDiagnostic:()=>DM_LAST?dmClone(DM_LAST):null
 });
});
