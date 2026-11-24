/**
 * PF1AE — persistent, data-driven proximity auras. Foundry 13 / PF1 11.11.
 * The source Item stores declarations. The elected GM reconciles generated
 * native PF1 Buff Items and separate AmbientLight documents. No character
 * class, spell, item name or executable script is hardcoded here.
 */
const PA_NS="pf1-automation-engine";
const PA_RECORDS="proximityAuras";
const PA_RECEIPTS="proximityAuraReceipts";
const PA_OWNED="proximityAuraSource";
const PA_END_SUBSCRIPTION="PF1AE:aura:expired";
const PA_BONUS_TYPES=new Set(["shield","armor","deflection","dodge","natural","sacred",
 "profane","morale","luck","insight","resistance","competence","circumstance","untyped"]);
const PA_QUEUE=new Map();
const paClone=x=>foundry.utils.deepClone(x);
const paList=x=>[...(x?.contents??x?.values?.()??x??[])];
const paLeader=()=>[...(game.users??[])].filter(u=>u.active&&u.isGM)
 .sort((a,b)=>a.id.localeCompare(b.id))[0]?.id===game.user?.id;
const paUuid=x=>typeof x==="string"&&x.length<=350&&
 /^(Actor\.[^.]+|Scene\.[^.]+\.Token\.[^.]+(?:\.Actor\.[^.]+)?)(?:\..+)?$/.test(x);
const paKey=x=>typeof x==="string"&&/^[a-zA-Z0-9_-]{1,80}$/.test(x);
const paActive=()=>game.modules.get(PA_NS)?.active===true;
const paTokens=scene=>paList(scene?.tokens);
const paActorToken=t=>t?.actor??null;
const paCenter=(token,scene)=>{
 const size=Number(scene?.grid?.size);
 if(!Number.isFinite(size)||size<=0)return null;
 const w=Number(token?.width),h=Number(token?.height);
 if(!Number.isFinite(w)||!Number.isFinite(h))return null;
 return {x:token.x+w*size/2,y:token.y+h*size/2};
};
function paValidate(input){
 if(!input||typeof input!=="object"||Array.isArray(input))return false;
 if(!Object.keys(input).every(k=>["key","emitterActorUuid","emitterTokenUuid",
  "sourceItemUuid","beneficiaries","range","defense","duration","light","label","started"].includes(k)))return false;
 if(!paKey(input.key)||!paUuid(input.emitterActorUuid)||
  !paUuid(input.emitterTokenUuid)||!paUuid(input.sourceItemUuid))return false;
 if(!input.beneficiaries||input.beneficiaries.kind!=="allies"||
  typeof input.beneficiaries.excludeEmitter!=="boolean")return false;
 if(!input.range||!["adjacent","radius"].includes(input.range.kind)||
  (input.range.kind==="radius"&&
   (!Number.isFinite(input.range.distance)||input.range.distance<=0||
    input.range.distance>500)))return false;
 if(!input.defense||!PA_BONUS_TYPES.has(input.defense.bonusType)||
  !Number.isSafeInteger(input.defense.value)||input.defense.value<0||
  input.defense.value>100)return false;
 if(input.started!=null&&(!Number.isFinite(input.started.worldTime)||
   (input.started.combatId!=null&&(!Number.isSafeInteger(input.started.round)||
   !Number.isSafeInteger(input.started.turn)))))return false;
 if(!input.duration||!Number.isSafeInteger(input.duration.rounds)||
  input.duration.rounds<1||input.duration.rounds>10000)return false;
 if(input.light!=null&&(!Number.isFinite(input.light.bright)||
  !Number.isFinite(input.light.dim)||input.light.bright<0||
  input.light.dim<input.light.bright||input.light.dim>500||
  (input.light.color!=null&&!/^#[0-9a-fA-F]{6}$/.test(input.light.color))))return false;
 return input.label==null||(typeof input.label==="string"&&input.label.length<=120);
}
function paLock(id,fn){
 const before=PA_QUEUE.get(id)??Promise.resolve();
 const next=before.catch(()=>{}).then(fn);
 PA_QUEUE.set(id,next);
 void next.finally(()=>{if(PA_QUEUE.get(id)===next)PA_QUEUE.delete(id)}).catch(()=>{});
 return next;
}
function paScene(tokenUuid){
 const match=/^Scene\.([^.]+)\.Token\.([^.]+)/.exec(tokenUuid);
 if(!match)return null;
 return game.scenes?.get?.(match[1])??
  paList(game.scenes).find(x=>x.id===match[1])??null;
}
function paToken(scene,tokenUuid){
 return paTokens(scene).find(t=>t.uuid===tokenUuid)??null;
}
function paCurrentSource(record){
 const scene=paScene(record.emitterTokenUuid);
 const token=paToken(scene,record.emitterTokenUuid);
 return {scene,token};
}
function paCells(scene,token){
 const grid=scene?.grid;
 const offsets=token?.getOccupiedGridSpaceOffsets?.();
 if(!Array.isArray(offsets)||!offsets.length||
  typeof grid?.getCenterPoint!=="function")return null;
 const points=offsets.map(offset=>{
  const obj=grid.getCenterPoint(offset);
  return {x:obj?.x,y:obj?.y};
 });
 return points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))?points:null;
}
function paDistance(scene,a,b){
 const grid=scene?.grid;
 if(!grid||typeof grid.measurePath!=="function")return null;
 const first=paCells(scene,a),second=paCells(scene,b);
 // For gridless scenes the native API reports no occupied cells; measure
 // the token centers, using the native ruler rather than hand-rolled units.
 const origins=first??[paCenter(a,scene)];
 const targets=second??[paCenter(b,scene)];
 if(origins.some(x=>!x)||targets.some(x=>!x))return null;
 let shortest=Infinity;
 for(const from of origins)for(const to of targets){
  const length=grid.measurePath([from,to])?.distance;
  if(typeof length==="number"&&Number.isFinite(length))
   shortest=Math.min(shortest,length);
 }
 return Number.isFinite(shortest)?shortest:null;
}
function paInRange(record,scene,source,target){
 if(source.uuid===target.uuid)return !record.beneficiaries.excludeEmitter;
 const d=paDistance(scene,source,target);
 if(d==null)return false; // no guessing when native grid unavailable
 if(record.range.kind==="adjacent"){
  const cell=Number(scene.grid?.distance);
  return Number.isFinite(cell)&&cell>0&&d>0&&d<=cell+1e-6;
 }
 return d<=record.range.distance+1e-6;
}
function paRecipients(record){
 const {scene,token:source}=paCurrentSource(record);
 if(!scene||!source)return [];
 const seen=new Map();
 for(const token of paTokens(scene)){
  const actor=paActorToken(token);
  if(!actor?.uuid)continue;
  if(record.beneficiaries.excludeEmitter&&actor.uuid===record.emitterActorUuid)
   continue;
  if(token.uuid!==source.uuid&&
   (source.disposition!==1||token.disposition!==1))continue;
  if(!paInRange(record,scene,source,token))continue;
  seen.set(actor.uuid,actor);
 }
 return [...seen.values()];
}
function paWorldActors(){
 const map=new Map();
 for(const actor of paList(game.actors))if(actor?.uuid)map.set(actor.uuid,actor);
 for(const scene of paList(game.scenes))
  for(const token of paTokens(scene)){
   const actor=paActorToken(token);
   if(actor?.uuid)map.set(actor.uuid,actor);
  }
 return [...map.values()];
}
function paSourceItems(){
 const result=new Map();
 for(const actor of paWorldActors()){
  for(const item of paList(actor?.items)){
   if(item?.documentName!=="Item"||!item.uuid)continue;
   if(paList(item.getFlag?.(PA_NS,PA_RECORDS)).length||
      paList(item.getFlag?.(PA_NS,PA_RECEIPTS)).some(x=>x.delivery==="pending"))
    result.set(item.uuid,item);
  }
 }
 return [...result.values()];
}
function paSnapshot(){
 const map=new Map();
 for(const item of paSourceItems())
  for(const aura of paList(item.getFlag(PA_NS,PA_RECORDS))){
   if(paValidate(aura)&&aura.sourceItemUuid===item.uuid&&
    item.actor?.uuid===aura.emitterActorUuid)
    map.set(item.uuid+"|"+aura.key,{item,aura});
  }
 return map;
}
function paTiming(record){
 const combat=game.combat;
 const now=Number(game.time?.worldTime??0);
 const sourceCombatant=combat?.started?
  paList(combat.combatants).find(c=>c.actor?.uuid===record.emitterActorUuid):null;
 return {worldTime:now,combatId:sourceCombatant?combat.id:null,
  round:sourceCombatant?Number(combat.round):null,
  turn:sourceCombatant?Number(combat.turn):null,
  combatantId:sourceCombatant?.id??null};
}
function paExpired(record){
 const start=record.started;
 if(!start||!Number.isFinite(start.worldTime))return true;
 const combat=game.combat;
 if(start.combatId&&combat?.started&&combat.id===start.combatId){
  const round=Number(combat.round),turn=Number(combat.turn);
  // X full rounds end just before the source's same initiative count.
  return Number.isFinite(round)&&round-start.round>=record.duration.rounds&&
    (round-start.round>record.duration.rounds||turn>=start.turn);
 }
 return Number(game.time?.worldTime??0)-start.worldTime>=record.duration.rounds*6;
}
function paOwned(document,identity){
 return document?.getFlag?.(PA_NS,PA_OWNED)===identity;
}
function paBuffData(record){
 const shield=record.defense.bonusType==="shield";
 return {name:record.label??"Aura défensive temporaire",
  type:"buff",img:"icons/svg/shield.svg",
  system:{buffType:"temp",active:true,hideFromToken:false,
   changes:[{formula:String(record.defense.value),operator:"add",
    target:"ac",subTarget:shield?"sac":"ac",
    modifier:record.defense.bonusType,priority:0}],
   changeFlags:{}},
  flags:{[PA_NS]:{[PA_OWNED]:record.sourceItemUuid+"|"+record.key}}};
}
function paSameBuff(item,record){
 const change=item.system?.changes?.[0];
 return item.system?.active===true&&
  change?.formula===String(record.defense.value)&&
  change?.modifier===record.defense.bonusType&&
  change?.subTarget===(record.defense.bonusType==="shield"?"sac":"ac");
}
async function paSyncBuffs(records){
 const desired=new Map();
 for(const {aura} of records.values()){
  for(const actor of paRecipients(aura)){
   const identity=aura.sourceItemUuid+"|"+aura.key;
   const map=desired.get(actor.uuid)??new Map();
   map.set(identity,aura);desired.set(actor.uuid,map);
  }
 }
 for(const actor of paWorldActors()){
  const target=desired.get(actor.uuid)??new Map();
  const generated=paList(actor.items).filter(item=>
   typeof item?.getFlag?.(PA_NS,PA_OWNED)==="string");
  const seen=new Set(),remove=[];
  for(const buff of generated){
   const identity=buff.getFlag(PA_NS,PA_OWNED);
   const record=target.get(identity);
   if(!record||seen.has(identity)||!paSameBuff(buff,record)){
    if(buff.id)remove.push(buff.id);
   }else seen.add(identity);
  }
  if(remove.length)await actor.deleteEmbeddedDocuments("Item",remove);
  const create=[...target.entries()].filter(([key])=>!seen.has(key))
   .map(([,record])=>paBuffData(record));
  if(create.length)await actor.createEmbeddedDocuments("Item",create);
 }
}
function paLightPosition(scene,token){
 const c=paCenter(token,scene);
 return c?{x:c.x,y:c.y}:null;
}
async function paSyncLights(records){
 const wanted=new Map();
 for(const {aura} of records.values()){
  if(!aura.light)continue;
  const {scene,token}=paCurrentSource(aura);
  if(!scene||!token)continue;
  const pos=paLightPosition(scene,token);
  if(!pos)continue;
  const id=aura.sourceItemUuid+"|"+aura.key;
  const byScene=wanted.get(scene.id)??new Map();
  byScene.set(id,{record:aura,...pos});
  wanted.set(scene.id,byScene);
 }
 for(const scene of paList(game.scenes)){
  const intended=wanted.get(scene.id)??new Map();
  const existing=paList(scene.lights).filter(light=>
   typeof light?.getFlag?.(PA_NS,PA_OWNED)==="string");
  const remove=[],update=[],seen=new Set();
  for(const light of existing){
   const id=light.getFlag(PA_NS,PA_OWNED),target=intended.get(id);
   if(!target||seen.has(id)){if(light.id)remove.push(light.id);continue;}
   seen.add(id);
   const cfg=target.record.light;
   if(light.x!==target.x||light.y!==target.y||
      light.config?.bright!==cfg.bright||light.config?.dim!==cfg.dim)
    update.push({_id:light.id,x:target.x,y:target.y,
     "config.bright":cfg.bright,"config.dim":cfg.dim});
  }
  if(remove.length)await scene.deleteEmbeddedDocuments("AmbientLight",remove);
  if(update.length)await scene.updateEmbeddedDocuments("AmbientLight",update);
  const create=[...intended].filter(([id])=>!seen.has(id)).map(([id,v])=>({
   x:v.x,y:v.y,config:{bright:v.record.light.bright,dim:v.record.light.dim,
    color:v.record.light.color??null},
   flags:{[PA_NS]:{[PA_OWNED]:id}}
  }));
  if(create.length)await scene.createEmbeddedDocuments("AmbientLight",create);
 }
}
function paEvent(record,reason){
 return {eventId:"pa:"+Date.now().toString(36)+":"+
  (foundry.utils.randomID?.(16)??Math.random().toString(36).slice(2)),
  type:"proximityAuraExpired",key:record.key,
  sourceItemUuid:record.sourceItemUuid,emitterActorUuid:record.emitterActorUuid,
  emitterTokenUuid:record.emitterTokenUuid,reason,record:paClone(record),
  delivery:"pending"};
}
async function paFinish(item,key,reason){
 return paLock(item.uuid,async()=>{
  const records=paList(item.getFlag(PA_NS,PA_RECORDS));
  const record=records.find(x=>x.key===key);
  if(!record)return {removed:false};
  const receipts=paList(item.getFlag(PA_NS,PA_RECEIPTS));
  if(receipts.length>250)throw Error("Aura receipt backlog requires cleanup");
  const receipt=paEvent(record,reason);
  await item.update({
   ["flags."+PA_NS+"."+PA_RECORDS]:records.filter(x=>x.key!==key),
   ["flags."+PA_NS+"."+PA_RECEIPTS]:[...receipts,receipt]
  });
  return {removed:true,eventId:receipt.eventId};
 });
}
function paCalls=item=>paList(item?.scriptCalls??item?.system?.scriptCalls);
async function paDeliver(item){
 if(!paLeader())return;
 return paLock("delivery:"+item.uuid,async()=>{
  const entries=paList(item.getFlag(PA_NS,PA_RECEIPTS));
  for(const receipt of entries.filter(e=>e.delivery==="pending")){
   const live=paList(item.getFlag(PA_NS,PA_RECORDS));
   if(live.some(x=>x.key===receipt.key))continue;
   const latest=paList(item.getFlag(PA_NS,PA_RECEIPTS));
   if(!latest.some(e=>e.eventId===receipt.eventId&&e.delivery==="pending"))continue;
   await item.setFlag(PA_NS,PA_RECEIPTS,latest.map(e=>
    e.eventId===receipt.eventId?{...e,delivery:"claimed"}:e));
   const {delivery,...payload}=receipt;
   const event=Object.freeze(paClone(payload));
   Hooks.callAll?.("pf1aeProximityAuraExpired",event);
   const calls=paCalls(item).filter(c=>
    c.category==="postUse"&&c.name===PA_END_SUBSCRIPTION&&
    typeof c.execute==="function");
   if(calls.length!==1)continue;
   const check=game.modules.get(PA_NS)?.api?.scriptApprovals?.check?.(
    item.actor,item,calls[0]);
   if(check?.approved!==true){
    console.warn("[PF1AE][Aura] expiration Script Call not approved",item.uuid);
    continue;
   }
   try{
    await calls[0].execute({action:null},{
     event,state:null,api:game.modules.get(PA_NS)?.api?.proximityAuras});
   }catch(error){console.error("[PF1AE][Aura] expiry Script Call",error);}
  }
 });
}
async function paReconcile(){
 if(!paLeader()||!paActive())return {skipped:true};
 return paLock("reconcile",async()=>{
  const snapshots=paSnapshot();
  for(const {item,aura} of snapshots.values()){
   let reason=null;
   if(paExpired(aura))reason="duration";
   else if(!paCurrentSource(aura).token)reason="emitterMissing";
   if(reason)await paFinish(item,aura.key,reason);
  }
  const active=paSnapshot();
  await paSyncBuffs(active);
  await paSyncLights(active);
  for(const item of paSourceItems())await paDeliver(item);
  return {auras:active.size};
 });
}
function paReconcileSoon(){
 if(!paLeader())return;
 void paReconcile().catch(error=>console.error("[PF1AE][Aura] reconciliation",error));
}
async function paRegister(data){
 if(!paActive()||!paValidate(data)||data.started!=null)
  throw Error("Invalid proximity aura declaration");
 const item=await fromUuid(data.sourceItemUuid);
 if(item?.documentName!=="Item"||item.actor?.uuid!==data.emitterActorUuid)
  throw Error("Aura source Item does not belong to emitter Actor");
 if(!game.user?.isGM&&item.actor?.testUserPermission?.(game.user,"OWNER")!==true)
  throw Error("Aura source Actor OWNER permission required");
 const {token}=paCurrentSource(data);
 if(!token||token.actor?.uuid!==data.emitterActorUuid)
  throw Error("Emitter token and Actor identity mismatch");
 const record=paClone({...data,started:paTiming(data)});
 const stored=await paLock(item.uuid,async()=>{
  const current=paList(item.getFlag(PA_NS,PA_RECORDS));
  if(current.length>=30&&!current.some(x=>x.key===record.key))
   throw Error("Too many active auras on source Item");
  // Idempotent repeated calls must NEVER restart an existing duration.
  const old=current.find(x=>x.key===record.key);
  if(old&&paValidate(old))return old;
  await item.setFlag(PA_NS,PA_RECORDS,[
   ...current.filter(x=>x.key!==record.key),record]);
  return record;
 });
 paReconcileSoon();
 return paClone(stored);
}
async function paStop({sourceItemUuid,key}={}){
 if(!paUuid(sourceItemUuid)||!paKey(key))throw Error("Invalid aura identity");
 const item=await fromUuid(sourceItemUuid);
 if(item?.documentName!=="Item")throw Error("Aura source Item unavailable");
 if(!game.user?.isGM&&item.actor?.testUserPermission?.(game.user,"OWNER")!==true)
  throw Error("Aura source Actor OWNER permission required");
 const result=await paFinish(item,key,"manual");
 paReconcileSoon();
 return result;
}
function paListPublic({sourceItemUuid}={}){
 const list=[...paSnapshot().values()].map(e=>paClone(e.aura));
 return sourceItemUuid?list.filter(e=>e.sourceItemUuid===sourceItemUuid):list;
}
for(const event of ["updateToken","createToken","deleteToken","updateItem",
 "createItem","deleteItem","updateCombat","combatTurnChange","deleteCombat",
 "updateWorldTime","canvasReady","updateUser","updateActor"])
 Hooks.on(event,paReconcileSoon);
Hooks.once("ready",()=>{
 const mod=game.modules.get(PA_NS);
 if(!mod)return;
 mod.api??={};
 mod.api.proximityAuras=Object.freeze({
  register:paRegister,stop:paStop,list:paListPublic,reconcile:paReconcile
 });
 paReconcileSoon();
});
