/**
 * PF1AE v1.19.1 — GM-only, exact-content approvals for native PF1 ItemScriptCalls.
 * The approval grants only a named existing ItemScriptCall on a particular Actor.
 * It never accepts arbitrary executable code from a socket or external payload.
 */
const SA_NS='pf1-automation-engine', SA_SETTING='scriptFallbackApprovals';
const SA_TRUSTED='trustedTableMode';
const saTrusted=()=>game.settings.get(SA_NS,SA_TRUSTED)===true;
const SA_AUTO_NAMES=new Map([
 ['toggle',new Set(['PF1AE:bootstrap'])],
 ['postUse',new Set(['PF1AE:attack:resolved','PF1AE:damage:applied',
  'PF1AE:damage:critical','PF1AE:damage:zeroHP'])]
]);
const saLeader=()=>[...game.users].filter(u=>u.active&&u.isGM)
 .sort((a,b)=>a.id.localeCompare(b.id))[0]??null;
const saIsLeader=()=>game.user?.isGM&&saLeader()?.id===game.user.id;
const saCalls=item=>item?.scriptCalls?.contents??
 (typeof item?.scriptCalls?.values==='function'?[...item.scriptCalls.values()]:
 (Array.isArray(item?.scriptCalls)?item.scriptCalls:item?.system?.scriptCalls??[]));
const saId=c=>c?.id??c?._id??null;
const saKey=(actorUuid,itemUuid,scriptId)=>JSON.stringify([actorUuid,itemUuid,scriptId]);
const saRows=()=>game.settings.get(SA_NS,SA_SETTING)??[];
const saSafe=x=>typeof x==='string'&&x.length>0&&x.length<=500;
const saClone=x=>foundry.utils.deepClone(x);
/** Get complete native persisted source, never a function body or JS supplied by a client.
 * If the native ItemScriptCall does not expose serializable saved data, fail closed.
 */
function saFingerprint(call){
 const native=call?._source??(typeof call?.toObject==='function'?call.toObject():null);
 if(!native||typeof native!=='object'||Array.isArray(native))throw Error('Native Script Call source unavailable: cannot approve GM execution.');
 const serialized=JSON.stringify(native);
 if(!serialized||serialized.length>300000)throw Error('Invalid or oversized native Script Call source.');
 // Require an actual saved script payload (not an execute() function).
 const hasScript=Object.keys(native).some(k=>['script','command','code','value','content'].includes(k));
 if(!hasScript)throw Error('No serialized Script Call code found; GM fallback refused.');
 return JSON.stringify({id:saId(call),category:call.category,name:call.name,source:native});
}
function saFind(actor,item,scriptId){
 if(actor?.documentName!=='Actor'||item?.documentName!=='Item'||
    (item.actor??item.parent)?.uuid!==actor.uuid||!saSafe(scriptId))
   throw Error('Script approval Actor/Item ownership invalid.');
 const matches=[...saCalls(item)].filter(c=>saId(c)===scriptId&&typeof c.execute==='function');
 if(matches.length!==1||!['postUse','toggle'].includes(matches[0].category))
  throw Error('Script approval requires a unique native postUse/toggle Script Call.');
 return matches[0];
}
async function saApprove(data){
 if(!saIsLeader())throw Error('Only the elected GM may approve executable scripts.');
 const actorUuid=data?.actorUuid??data?.actor?.uuid;
 const itemUuid=data?.itemUuid??data?.item?.uuid;
 if(!saSafe(actorUuid)||!saSafe(itemUuid)||!saSafe(data?.scriptId))
  throw Error('Invalid script approval identity.');
 const actor=await fromUuid(actorUuid),item=await fromUuid(itemUuid);
 const call=saFind(actor,item,data.scriptId);
 const fingerprint=saFingerprint(call),key=saKey(actorUuid,itemUuid,data.scriptId);
 const rows=saRows().filter(x=>x.key!==key);
 rows.push({key,actorUuid,itemUuid,scriptId:data.scriptId,category:call.category,
  name:call.name,fingerprint,approvedBy:game.user.id,approvedAt:Date.now()});
 await game.settings.set(SA_NS,SA_SETTING,rows);
 return {approved:true,actorUuid,itemUuid,scriptId:data.scriptId};
}
async function saRevoke(data){
 if(!saIsLeader())throw Error('Only the elected GM may revoke script approvals.');
 const actorUuid=data?.actorUuid??data?.actor?.uuid;
 const itemUuid=data?.itemUuid??data?.item?.uuid;
 if(!saSafe(actorUuid)||!saSafe(itemUuid)||!saSafe(data?.scriptId))
  throw Error('Invalid script approval identity.');
 const key=saKey(actorUuid,itemUuid,data.scriptId);
 const rows=saRows(),remaining=rows.filter(x=>x.key!==key);
 if(rows.length!==remaining.length)await game.settings.set(SA_NS,SA_SETTING,remaining);
 return {revoked:true};
}
/** Never silently reapprove modified source. Compare EXACT saved JSON and identity. */
function saCheck(actor,item,call){
 try {
  const id=saId(call);
  if(!saSafe(id))return {approved:false,reason:'Missing native Script Call id'};
  const resolved=saFind(actor,item,id),key=saKey(actor.uuid,item.uuid,id);
  if(resolved!==call)return {approved:false,reason:'Script Call identity changed'};
  // Trusted Table Mode is an explicit world-wide GM decision. Only native
  // Script Calls with an exact PF1AE category and subscription name bypass
  // individual approval; the Actor/Item/Call identity was validated above.
  if(saTrusted() && SA_AUTO_NAMES.get(call.category)?.has(call.name))
   return {approved:true,trustedTableMode:true};
  const record=saRows().find(x=>x.key===key);
  if(!record)return {approved:false,reason:'No GM approval for offline-player fallback'};
  if(record.category!==call.category||record.name!==call.name||
     record.fingerprint!==saFingerprint(call))
   return {approved:false,reason:'Script Call modified after GM approval; reapprove required'};
  return {approved:true};
 }catch(err){return {approved:false,reason:err.message};}
}
Hooks.once('init',()=>{
 game.settings.register(SA_NS,SA_SETTING,{scope:'world',config:false,type:Array,default:[]});
 game.settings.register(SA_NS,SA_TRUSTED,{
  name:game.i18n?.localize?.('PF1AE.Settings.TrustedTable.Name')??'Trusted Table Mode — automatic PF1AE scripts',
  hint:game.i18n?.localize?.('PF1AE.Settings.TrustedTable.Hint')??'WARNING: Player-editable JavaScript can execute with GM privileges in this mode.',
  scope:'world',config:true,restricted:true,type:Boolean,default:false,
  onChange:()=>{
   // Reconcile without mutating the persistent secure-mode registry.
   void game.modules.get(SA_NS)?.api?.bootstrap?.restoreAll?.();
  }
 });
});
Hooks.once('ready',()=>{
 const mod=game.modules.get(SA_NS);if(!mod)return;
 mod.api??={};
 mod.api.scriptApprovals=Object.freeze({
  approve:saApprove,revoke:saRevoke,list:()=>saClone(saRows()),
  check:(actor,item,call)=>saCheck(actor,item,call)
 });
});
