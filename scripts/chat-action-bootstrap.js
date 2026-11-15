/**
 * PF1AE — elected-GM Chat Actions bootstrap declarations.
 *
 * A native toggle Script Call named PF1AE:bootstrap is only executed on the
 * elected GM for Chat Actions when GM-owned or individually source-approved
 * (or trustedTableMode explicitly enabled). It is never toggled/activated.
 * Every handler is tied to the exact Actor / Item / Script Call source.
 */
const CAB_NS='pf1-automation-engine';
const CAB_NAME='PF1AE:bootstrap';
const CAB_KEY=/^[a-zA-Z0-9_.-]{1,120}$/;
const CAB_ACTIVE=new Map();
const CAB_BUSY=new Map();
let CAB_SCAN=Promise.resolve();
const cabLeader=()=>[...game.users].filter(u=>u.active&&u.isGM)
 .sort((a,b)=>a.id.localeCompare(b.id))[0]??null;
const cabEnabled=()=>game.modules.get(CAB_NS)?.active===true&&
 game.settings.get(CAB_NS,'genericEnabled')!==false;
const cabElected=()=>cabEnabled()&&game.user?.isGM===true&&
 cabLeader()?.id===game.user.id;
const cabCalls=item=>item?.scriptCalls?.contents??
 (typeof item?.scriptCalls?.values==='function'?[...item.scriptCalls.values()]:
  Array.isArray(item?.scriptCalls)?item.scriptCalls:item?.system?.scriptCalls??[]);
const cabId=call=>call?.id??call?._id;
const cabSerial=call=>{
 const source=call?._source??(typeof call?.toObject==='function'?call.toObject():null);
 if(!source||typeof source!=='object'||Array.isArray(source))
  return null;
 return JSON.stringify({id:cabId(call),category:call.category,name:call.name,source});
};
const cabOwnedByPlayer=actor=>[...game.users].some(u=>!u.isGM&&
 actor.testUserPermission?.(u,'OWNER')===true);
function cabApproval(actor,item,call){
 if(!cabElected())return {approved:false,reason:'Not elected GM'};
 if((item.actor??item.parent)?.uuid!==actor.uuid||
    call.category!=='toggle'||call.name!==CAB_NAME||!cabSerial(call))
  return {approved:false,reason:'Invalid native bootstrap declaration'};
 if(!cabOwnedByPlayer(actor))return {approved:true};
 const check=game.modules.get(CAB_NS)?.api?.scriptApprovals?.check;
 return typeof check==='function'?check(actor,item,call):
  {approved:false,reason:'Script Approvals service unavailable'};
}
function cabActors(){
 const actors=new Map();
 const add=a=>{if(a?.documentName==='Actor'&&typeof a.uuid==='string')
  actors.set(a.uuid,a)};
 for(const actor of game.actors?.contents??game.actors?.values?.()??[])add(actor);
 for(const scene of game.scenes?.contents??game.scenes?.values?.()??[])
  for(const token of scene?.tokens?.contents??scene?.tokens?.values?.()??[])
   add(token.actor??token.object?.actor);
 if(globalThis.canvas?.scene)
  for(const token of globalThis.canvas.scene.tokens?.contents??
       globalThis.canvas.scene.tokens?.values?.()??[])
   add(token.actor??token.object?.actor);
 return [...actors.values()];
}
function cabDeclarations(){
 const records=[];
 for(const actor of cabActors())
  for(const item of actor.items?.contents??actor.items?.values?.()??[]){
   if(item?.documentName!=='Item')continue;
   for(const call of cabCalls(item)){
    if(call?.category!== 'toggle'||call.name!==CAB_NAME||
       typeof call.execute!=='function'||!cabId(call))continue;
    const fingerprint=cabSerial(call);
    if(!fingerprint)continue;
    const id=JSON.stringify([actor.uuid,item.uuid,cabId(call)]);
    records.push({id,actor,item,call,fingerprint});
   }
  }
 return records;
}
function cabCleanup(id){
 const entry=CAB_ACTIVE.get(id);
 if(!entry)return;
 CAB_ACTIVE.delete(id);
 for(const stop of entry.cleanup.reverse())
  try{stop()}catch(error){console.warn('[PF1AE][ChatActionBootstrap] cleanup failed',id,error)}
}
function cabCleanupAll(){for(const id of [...CAB_ACTIVE.keys()])cabCleanup(id)}
function cabLive(record){
 const {actor,item,call,fingerprint}=record;
 if(!cabElected()||(item.actor??item.parent)?.uuid!==actor.uuid||
    !cabCalls(item).includes(call)||cabSerial(call)!==fingerprint)return false;
 return cabApproval(actor,item,call).approved===true;
}
async function cabRestoreOne(record){
 const {id,actor,item,call,fingerprint}=record;
 if(!cabElected()||!cabApproval(actor,item,call).approved){
  cabCleanup(id);return {skipped:'not approved'};
 }
 const existing=CAB_ACTIVE.get(id);
 if(existing?.fingerprint===fingerprint&&existing.call===call&&cabLive(record))
  return {skipped:'already registered'};
 cabCleanup(id);
 if(CAB_BUSY.has(id))return CAB_BUSY.get(id);
 const job=(async()=>{
  const cleanup=[],keys=new Set();
  const scope=Object.freeze({
   bootstrap:true,restoring:true,chatActions:true,
   actorUuid:actor.uuid,itemUuid:item.uuid,
   scriptId:cabId(call),id,
   registerChatActionHandler(key,handler,{sourceItemUuid}={}){
    if(!CAB_KEY.test(key)||typeof handler!=='function')
     throw Error('Invalid Chat Action handler declaration.');
    const bound=sourceItemUuid??item.uuid;
    // The declaration may only bind handlers to its OWN item. No arbitrary
    // player item or unrelated handler key can be impersonated.
    if(bound!==item.uuid)throw Error('Chat handler source must be its declaring Item.');
    if(keys.has(key))throw Error('Duplicate handler in the same Script Call.');
    if(!cabLive(record))throw Error('Chat Action declaration no longer approved.');
    const chat=game.modules.get(CAB_NS)?.api?.chatActions;
    if(!chat?.registerHandler)throw Error('Chat Actions service unavailable.');
    const wrapped=async context=>{
     // Approval fingerprint and exact live Script Call identity are rechecked
     // on EVERY click. A stale UI cannot re-enable edited script code.
     if(!cabLive(record))return {ok:false,reason:'Chat Action Script Call approval expired.'};
     return handler(context);
    };
    const unregister=chat.registerHandler(key,wrapped,{sourceItemUuid:item.uuid});
    keys.add(key);cleanup.push(unregister);
    return unregister;
   },
   onCleanup(fn){
    if(typeof fn!=='function')throw Error('Expected cleanup callback.');
    cleanup.push(fn);
   },
   // No raw Hooks listeners in the GM Chat Actions bootstrap context.
   listen(){throw Error('Use regular Bootstrap for event listeners.')}
  });
  try{
   // Native PF1 script execution ONLY. No activation, state mutation, eval,
   // arbitrary JavaScript loaded from messages, or socket code execution.
   await call.execute({action:null},{bootstrap:scope,restoring:true,
    state:null,event:Object.freeze({type:'bootstrap:chat-actions',
     actorUuid:actor.uuid,itemUuid:item.uuid,scriptId:cabId(call)}),
    api:game.modules.get(CAB_NS)?.api?.chatActions});
   if(!cabLive(record))throw Error('Declaration changed during registration.');
   CAB_ACTIVE.set(id,{fingerprint,call,cleanup,keys:[...keys]});
   return {restored:true,id,keys:[...keys]};
  }catch(error){
   for(const stop of cleanup.reverse())try{stop()}catch(_){}
   console.warn('[PF1AE][ChatActionBootstrap] Skipped declaration',id,error);
   return {skipped:'declaration rejected',reason:String(error?.message??error)};
  }
 })();
 CAB_BUSY.set(id,job);
 try{return await job}finally{CAB_BUSY.delete(id)}
}
async function cabReconcile(){
 if(!cabElected()){cabCleanupAll();return {restored:0,disabled:true}};
 const records=cabDeclarations();
 const wanted=new Set(records.map(x=>x.id));
 for(const id of CAB_ACTIVE.keys())if(!wanted.has(id))cabCleanup(id);
 let restored=0,skipped=0;
 for(const record of records){
  const result=await cabRestoreOne(record);
  result.restored?restored++:skipped++;
 }
 return {restored,skipped,discovered:records.length,
  registered:[...CAB_ACTIVE.values()].reduce((n,x)=>n+x.keys.length,0)};
}
function cabScan(){
 CAB_SCAN=CAB_SCAN.catch(()=>{}).then(cabReconcile);
 return CAB_SCAN;
}
Hooks.once('ready',()=>{
 const mod=game.modules.get(CAB_NS);
 if(!mod)return;
 mod.api??={};
 mod.api.chatActionBootstrap=Object.freeze({
  scan:cabScan,
  status:()=>({leader:cabElected(),declarations:CAB_ACTIVE.size,
   handlers:[...CAB_ACTIVE.values()].reduce((n,x)=>n+x.keys.length,0)})
 });
 for(const hook of ['createItem','updateItem','deleteItem',
  'createActor','updateActor','deleteActor',
  'createToken','updateToken','deleteToken',
  'canvasReady','updateUser','updateSetting']){
  Hooks.on(hook,()=>{
   // Queue and coalesce naturally; a live check guards against stale code.
   void cabScan().catch(e=>console.error('[PF1AE][ChatActionBootstrap] Scan failed',e));
  });
 }
 Hooks.on('pf1aeScriptApprovalsReady',()=>{void cabScan()});
 void cabScan();
});
