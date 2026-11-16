/**
 * PF1AE v1.19.1 — GM-only, exact-content approvals for native PF1 ItemScriptCalls.
 * The approval grants only a named existing ItemScriptCall on a particular Actor.
 * It never accepts arbitrary executable code from a socket or external payload.
 */
const SA_NS='pf1-automation-engine', SA_SETTING='scriptFallbackApprovals';
const SA_TRUSTED='trustedTableMode';
const saTrusted=()=>game.settings.get(SA_NS,SA_TRUSTED)===true;
const SA_AUTO_NAMES=new Map([
 ['toggle',new Set(['PF1AE:bootstrap','PF1AE:rangedMelee:override'])],
 ['postUse',new Set(['PF1AE:attack:resolved','PF1AE:damage:applied',
  'PF1AE:damage:critical','PF1AE:damage:zeroHP',
  'PF1AE:bleed:before','PF1AE:bleed:applied'])]
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
 if(matches.length!==1||!['use','postUse','toggle'].includes(matches[0].category))
  throw Error('Script approval requires a unique native use/postUse/toggle Script Call.');
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

/** Only saved, embedded Actor Item Script Calls can be approved. */
function saDiscover(){
 const actors=new Map();
 const add=actor=>{
  if(actor?.documentName==='Actor'&&saSafe(actor.uuid))actors.set(actor.uuid,actor);
 };
 for(const actor of game.actors?.contents??[])add(actor);
 for(const scene of game.scenes?.contents??[]){
  for(const token of scene.tokens?.contents??[]){
   // World actors are already included. Unlinked token actors have distinct UUIDs.
   if(token.actorLink)continue;
   add(token.actor);
  }
 }
 const result=[],seen=new Set();
 for(const actor of actors.values()){
  for(const item of actor.items?.contents??[]){
   if(item?.documentName!=='Item'||(item.actor??item.parent)?.uuid!==actor.uuid)continue;
   for(const call of saCalls(item)){
    const id=saId(call);
    if(!saSafe(id))continue;
    const key=saKey(actor.uuid,item.uuid,id);
    if(seen.has(key))continue;
    seen.add(key);
    let supported=false,approved=false,reason='';
    try{
     if(typeof call.execute!=='function')throw Error('Native executable Script Call unavailable');
     const resolved=saFind(actor,item,id);
     if(resolved!==call)throw Error('Native Script Call identity mismatch');
     saFingerprint(call);
     supported=true;
     const record=saRows().find(x=>x.key===key);
     approved=!!record&&record.category===call.category&&
      record.name===call.name&&record.fingerprint===saFingerprint(call);
    }catch(error){reason=String(error?.message??error)}
    result.push({actorUuid:actor.uuid,itemUuid:item.uuid,scriptId:id,key,
     actorName:actor.name??actor.uuid,itemName:item.name??item.uuid,
     name:call.name??'',category:call.category??'',supported,approved,reason});
   }
  }
 }
 return result.sort((a,b)=>a.actorName.localeCompare(b.actorName)||
  a.itemName.localeCompare(b.itemName)||a.name.localeCompare(b.name)||
  a.scriptId.localeCompare(b.scriptId));
}
const saL=(key,fallback)=>{
 const k='PF1AE.ScriptApprovals.'+key;
 const translated=game.i18n?.localize?.(k);
 return translated&&translated!==k?translated:fallback;
};
function saRegisterMenu(){
 if(typeof FormApplication!=='function'||typeof game.settings.registerMenu!=='function')return;
 class ScriptApprovalForm extends FormApplication{
  static get defaultOptions(){
   return foundry.utils.mergeObject(super.defaultOptions,{
    id:'pf1ae-script-approvals',template:'modules/pf1-automation-engine/templates/script-approvals.hbs',
    width:790,height:650,resizable:true,closeOnSubmit:false,
    submitOnChange:false,submitOnClose:false
   });
  }
  get title(){return saL('Title','Script Approvals')}
  async getData(){
   this._entries=saDiscover();
   const trusted=saTrusted();
   return {scripts:this._entries.map((entry,index)=>({...entry,index,
     disabled:trusted||!saIsLeader()||!entry.supported})),
    trusted,canEdit:saIsLeader()&&!trusted,
    notice:trusted?saL('TrustedNotice','Disable Trusted Table Mode to edit individual approvals.'):
     saL('Help','Select saved native Script Calls to approve for GM fallback.'),
    empty:saL('Empty','No embedded Actor Item Script Calls were detected.'),
    actorLabel:saL('Actor','Actor'),itemLabel:saL('Item'),
    scriptLabel:saL('Script Call','Script Call'),categoryLabel:saL('Category','Category'),
    approveLabel:saL('Approved','Approved'),saveLabel:saL('Save','Save changes')};
  }
  async _updateObject(_event,formData){
   if(!saIsLeader()||saTrusted())throw Error('Individual approvals require secure mode and the elected GM.');
   const entries=this._entries??[];
   // Never approve a different Script Call substituted between display and save.
   for(let index=0;index<entries.length;index++){
    const entry=entries[index];
    if(!entry.supported)continue;
    const desired=formData['approval-'+index]===true||
     formData['approval-'+index]==='on';
    const actor=await fromUuid(entry.actorUuid),item=await fromUuid(entry.itemUuid);
    const call=saFind(actor,item,entry.scriptId);
    if(saKey(actor.uuid,item.uuid,saId(call))!==entry.key)
     throw Error('Script Call identity changed; reopen approvals.');
    if(desired){
     // The underlying native source must still be identical to the display snapshot.
     const current=saDiscover().find(x=>x.key===entry.key);
     if(!current?.supported)throw Error('Script Call changed; reopen approvals.');
     if(!current.approved)await saApprove(entry);
    }else if(saRows().some(row=>row.key===entry.key)){
     await saRevoke(entry);
    }
   }
   ui.notifications?.info?.(saL('Saved','Script approvals updated.'));
   this.render();
  }
 }
 game.settings.registerMenu(SA_NS,'scriptApprovalMenu',{
  name:saL('Title','Script Approvals'),
  label:saL('Button','Script Approvals'),
  hint:saL('MenuHint','Review and approve native Item Script Calls for secure mode.'),
  icon:'fas fa-shield-halved',type:ScriptApprovalForm,restricted:true
 });
}

Hooks.once('init',()=>{
 saRegisterMenu();
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
  discover:()=>saClone(saDiscover()),
  check:(actor,item,call)=>saCheck(actor,item,call)
 });
 // Bootstrap registrations can safely restore only after check() exists.
 Hooks.callAll?.('pf1aeScriptApprovalsReady');
});
