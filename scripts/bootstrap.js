/** PF1 Automation Engine — persistent opt-in ItemScriptCall runtime bootstrap.
 * Foundry v13 / PF1 v11.11. Runs only native ItemScriptCall.execute().
 * Bootstrap scripts execute on the owning client, never on a GM via socket.
 */
const BS_NS = 'pf1-automation-engine';
const BS_SETTING = 'bootstrapRegistry';
const BS_SOCKET = `module.${BS_NS}`;
const BS_CHANNEL = 'pf1ae-bootstrap-v1';
const BS_KEYS = /^[A-Za-z0-9_-]{1,80}$/;
const BS_PENDING = new Map();
const BS_ACTIVE = new Map();
const BS_INFLIGHT = new Map();
const BS_REQUESTS = new Map();
let bsWrite = Promise.resolve();
const bsDebug = (event, details={}) => {
  try { if (game.settings.get(BS_NS,'genericDebug')) console.debug(`[PF1AE][Bootstrap] ${event}`, details); }
  catch (_) { /* init */ }
};
const bsLeader = () => [...game.users].filter(u=>u.active && u.isGM)
  .sort((a,b)=>a.id.localeCompare(b.id))[0] ?? null;
const bsIsLeader = () => bsLeader()?.id === game.user.id;
const bsValidText = (s,max=400) => typeof s==='string' && s.length>0 && s.length<=max;
const bsEnabled = () => game.modules.get(BS_NS)?.active && game.settings.get(BS_NS,'genericEnabled');
const bsList = () => game.settings.get(BS_NS,BS_SETTING) ?? [];
const bsId = (actorUuid,itemUuid,key) => JSON.stringify([actorUuid,itemUuid,key]);
const bsActor = x => x?.documentName === 'Actor' ? x : x?.actor ?? null;
const bsOwned = (actor,user) => user?.isGM || actor?.testUserPermission?.(user,'OWNER') === true;
// Select exactly one active executor for each Actor. Prefer a player owner;
// if no player owner is online, fall back to the elected GM.
function bsExecutor(actor){
  const owners=[...game.users].filter(u=>u.active&&!u.isGM&&bsOwned(actor,u))
    .sort((a,b)=>a.id.localeCompare(b.id));
  return owners[0]?.id??bsLeader()?.id??null;
}
const bsCalls = item => item?.scriptCalls?.contents ??
  (typeof item?.scriptCalls?.values==='function' ? [...item.scriptCalls.values()] :
    Array.isArray(item?.scriptCalls) ? item.scriptCalls : item?.system?.scriptCalls ?? []);
const bsClone = x => foundry.utils.deepClone(x);
function bsScript(item,scriptId) {
  const calls=[...bsCalls(item)].filter(c=>c?.category==='toggle' && typeof c.execute==='function');
  const matches=scriptId
    ? calls.filter(c=>(c.id??c._id)===scriptId)
    : calls.filter(c=>c.name==='PF1AE:bootstrap');
  const candidates=matches.length ? matches : (!scriptId && calls.length===1 ? calls : []);
  if(candidates.length!==1)throw Error('Bootstrap requires one unambiguous native toggle Script Call. Supply scriptId or name it PF1AE:bootstrap.');
  return candidates[0];
}
async function bsResolve(actorUuid,itemUuid,scriptId,requester) {
  const [actor,item] = await Promise.all([fromUuid(actorUuid),fromUuid(itemUuid)]);
  if(actor?.documentName!=='Actor' || item?.documentName!=='Item' ||
      (item.actor??item.parent)?.uuid!==actor.uuid)throw Error('Missing Actor/Item or invalid source ownership.');
  if(!bsOwned(actor,requester))throw Error('Source Actor OWNER permission required.');
  return {actor,item,script:bsScript(item,scriptId)};
}
function bsPayload(data) {
  const actorUuid=data?.actorUuid??bsActor(data?.actor)?.uuid;
  const itemUuid=data?.itemUuid??data?.item?.uuid;
  if(!bsValidText(actorUuid) || !bsValidText(itemUuid) || !BS_KEYS.test(data?.key??''))
    throw Error('Invalid bootstrap Actor, Item or key.');
  if(data.scriptId!=null && !bsValidText(data.scriptId,120))throw Error('Invalid native Script Call ID.');
  return {actorUuid,itemUuid,key:data.key,scriptId:data.scriptId??null,id:bsId(actorUuid,itemUuid,data.key)};
}
function bsQueue(fn){const next=bsWrite.catch(()=>{}).then(fn);bsWrite=next.catch(()=>{});return next;}
function bsCleanup(id){
  const runtime=BS_ACTIVE.get(id);if(!runtime)return;
  BS_ACTIVE.delete(id);
  for(const {hook,fn} of runtime.hooks){try{Hooks.off(hook,fn)}catch(e){console.warn('[PF1AE][Bootstrap] Hook removal failed',id,hook,e)}}
  for(const fn of runtime.cleanup){try{fn()}catch(e){console.warn('[PF1AE][Bootstrap] Cleanup callback failed',id,e)}}
}
async function bsPersist(op,payload,requester){
  if(!bsIsLeader() || !game.user.isGM)throw Error('Elected GM required for bootstrap persistence.');
  if(!requester?.active)throw Error('Inactive requester');
  // An unregister may need to remove a stale entry after the Item was deleted.
  let scriptId=null;
  if(op==='register'){
    const resolved=await bsResolve(payload.actorUuid,payload.itemUuid,payload.scriptId,requester);
    scriptId=resolved.script.id??resolved.script._id;
    if(!bsValidText(scriptId,120))throw Error('Native script ID missing.');
  }else{
    const actor=await fromUuid(payload.actorUuid);
    if(actor?.documentName!=='Actor'||!bsOwned(actor,requester))throw Error('Source Actor OWNER permission required.');
  }
  return bsQueue(async()=>{
    const existing=bsList();const previous=existing.find(x=>x.id===payload.id);
    if(op==='register'){
      if(previous){
        if(previous.scriptId!==scriptId)throw Error('Bootstrap identity already used for a different Script Call.');
        bsDebug('Skipped duplicate',{id:payload.id});
        return {registered:true,duplicate:true,id:payload.id,actorUuid:payload.actorUuid,itemUuid:payload.itemUuid,key:payload.key};
      }
      const record={id:payload.id,actorUuid:payload.actorUuid,itemUuid:payload.itemUuid,
        key:payload.key,scriptId,enabled:true};
      await game.settings.set(BS_NS,BS_SETTING,[...existing,record]);
      bsDebug('Registered',record);
      return {registered:true,id:record.id,actorUuid:record.actorUuid,itemUuid:record.itemUuid,key:record.key};
    }
    if(previous)await game.settings.set(BS_NS,BS_SETTING,existing.filter(x=>x.id!==payload.id));
    bsCleanup(payload.id);
    bsDebug('Unregistered',{id:payload.id});
    return {unregistered:true,id:payload.id,alreadyAbsent:!previous};
  });
}
async function bsSend(op,data){
  const payload=bsPayload(data);
  const actor=await fromUuid(payload.actorUuid);
  if(!bsOwned(actor,game.user))throw Error('You do not own this actor.');
  const gm=bsLeader();if(!gm)throw Error('An active GM is required.');
  if(bsIsLeader())return bsPersist(op,payload,game.user);
  const requestId=foundry.utils.randomID();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{BS_PENDING.delete(requestId);reject(Error('Bootstrap GM request timeout.'))},15000);
    BS_PENDING.set(requestId,{resolve,reject,timer,leaderId:gm.id});
    game.socket.emit(BS_SOCKET,{channel:BS_CHANNEL,op,requestId,userId:game.user.id,payload});
  });
}
async function bsReceive(data){
  if(!data||data.channel!==BS_CHANNEL||!bsValidText(data.requestId,100))return;
  if(data.op==='ack'){
    const p=BS_PENDING.get(data.requestId);
    if(!p||data.recipientId!==game.user.id||data.senderId!==p.leaderId)return;
    clearTimeout(p.timer);BS_PENDING.delete(data.requestId);
    data.error?p.reject(Error(data.error)):p.resolve(data.result);return;
  }
  if(!bsIsLeader()||!['register','unregister'].includes(data.op)||BS_REQUESTS.has(data.requestId))return;
  BS_REQUESTS.set(data.requestId,true);
  if(BS_REQUESTS.size>2000)BS_REQUESTS.clear();
  const requester=game.users.get(data.userId);
  if(!requester?.active)return;
  let result,error;
  try {
    const payload=bsPayload(data.payload);
    result=await bsPersist(data.op,payload,requester);
  } catch(e){error=e.message;bsDebug('Request refused',{requestId:data.requestId,error});}
  game.socket.emit(BS_SOCKET,{channel:BS_CHANNEL,op:'ack',requestId:data.requestId,
    recipientId:requester.id,senderId:game.user.id,result,error});
}
async function bsRestoreOne(record){
  if(!record?.enabled || !bsValidText(record.id,1200) ||
     record.id!==bsId(record.actorUuid,record.itemUuid,record.key))return {skipped:'invalid record'};
  if(BS_INFLIGHT.has(record.id))return BS_INFLIGHT.get(record.id);
  const job=(async()=>{
    const actor=await fromUuid(record.actorUuid);
    if(!actor){bsCleanup(record.id);bsDebug('Missing Actor/Item',{id:record.id,actorUuid:record.actorUuid});return {skipped:'missing Actor'};}
    // Restores run on the owner client; never execute a player's JS as the GM
    // merely because the GM holds the world registry.
    if(!bsOwned(actor,game.user) || bsExecutor(actor)!==game.user.id) {
      bsCleanup(record.id);return {skipped:'not elected Actor executor'};
    }
    if(BS_ACTIVE.has(record.id)){bsDebug('Skipped duplicate',{id:record.id});return {skipped:'already active'};}
    const item=await fromUuid(record.itemUuid);
    if(!item || (item.actor??item.parent)?.uuid!==actor.uuid){
      bsCleanup(record.id);bsDebug('Missing Actor/Item',{id:record.id,itemUuid:record.itemUuid});return {skipped:'missing Item'};
    }
    let call;try{call=bsScript(item,record.scriptId)}catch(e){
      bsCleanup(record.id);bsDebug('Missing Actor/Item',{id:record.id,error:e.message});return {skipped:'missing Script Call'};
    }
    const runtime={hooks:[],cleanup:[]};
    // Use explicit cleanup and tracked subscriptions to prevent permanent
    // listeners after unregister. A Script that calls raw Hooks.on itself
    // is responsible for unregistering its raw hook.
    const scope=Object.freeze({
      bootstrap:true,restoring:true,id:record.id,key:record.key,
      actorUuid:actor.uuid,itemUuid:item.uuid,
      listen(hook,fn){
        if(!bsValidText(hook,120)||typeof fn!=='function')throw Error('Invalid bootstrap hook/handler.');
        if(runtime.hooks.some(x=>x.hook===hook&&x.fn===fn))return;
        Hooks.on(hook,fn);runtime.hooks.push({hook,fn});
      },
      onCleanup(fn){if(typeof fn!=='function')throw Error('Cleanup must be a function');runtime.cleanup.push(fn);}
    });
    try {
      await call.execute({action:null},{bootstrap:scope,restoring:true,
        state:null,event:Object.freeze({type:'bootstrap:restore',actorUuid:actor.uuid,itemUuid:item.uuid,key:record.key}),
        api:game.modules.get(BS_NS)?.api?.bootstrap});
      BS_ACTIVE.set(record.id,runtime);
      bsDebug('Restored',{id:record.id,actorUuid:actor.uuid,itemUuid:item.uuid});
      return {restored:true,id:record.id};
    }catch(e){
      for(const {hook,fn} of runtime.hooks)Hooks.off(hook,fn);
      for(const fn of runtime.cleanup)try{fn()}catch(_){}
      console.error('[PF1AE][Bootstrap] Restore failed',record.id,e);
      return {skipped:'execution failed',error:e.message};
    }
  })();
  BS_INFLIGHT.set(record.id,job);
  try{return await job}finally{BS_INFLIGHT.delete(record.id)}
}
async function bsRestoreAll(){
  if(!bsEnabled())return {restored:0,skipped:0,disabled:true};
  const records=bsList();bsDebug('Restoring persistent scripts',{count:records.length});
  const known=new Set(records.map(r=>r.id));
  for(const id of [...BS_ACTIVE.keys()])if(!known.has(id))bsCleanup(id);
  let restored=0,skipped=0;
  for(const record of records){const r=await bsRestoreOne(record);r.restored?restored++:skipped++;}
  return {restored,skipped,total:records.length};
}
Hooks.once('init',()=>{
  game.settings.register(BS_NS,BS_SETTING,{scope:'world',config:false,type:Array,default:[],
    onChange:()=>{void bsRestoreAll()}});
  Hooks.on('canvasReady',()=>{void bsRestoreAll()});
  Hooks.on('updateUser',(_user,changes)=>{if(Object.hasOwn(changes??{},'active'))void bsRestoreAll()});
  Hooks.on('deleteItem',item=>{
    for(const record of bsList().filter(x=>x.itemUuid===item?.uuid))bsCleanup(record.id);
  });
});
Hooks.once('ready',()=>{
  const mod=game.modules.get(BS_NS);mod.api??={};
  mod.api.bootstrap=Object.freeze({register:data=>bsSend('register',data),
    unregister:data=>bsSend('unregister',data),list:()=>bsClone(bsList()),restoreAll:bsRestoreAll});
  game.socket.on(BS_SOCKET,data=>{if(data?.channel===BS_CHANNEL)void bsReceive(data)});
  void bsRestoreAll();
});