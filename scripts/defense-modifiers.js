/**
 * PF1AE conditional defense modifiers — general rule engine only.
 * No feat, class, spell, damage, or native sheet AC mutations.
 * Registry is stored as immutable JSON in a world setting. Writes are
 * serialized on the elected GM; player owners request their OWN defenses.
 */
const DM_NS='pf1-automation-engine';
const DM_REG='defenseModifierRegistry';
const DM_CHANNEL='pf1ae-defenses-v1';
const DM_SOCKET='module.'+DM_NS;
const DM_TYPES=new Set(['deflection','cover','dodge','circumstance',
 'competence','enhancement','insight','luck','morale','natural',
 'profane','racial','resistance','sacred','shield','size','untyped']);
const DM_DEFENSES=new Set(['normal','touch','flatFooted','ref']);
const DM_STACKING=new Set(['dodge','circumstance','untyped']);
const DM_PENDING=new Map();
let DM_SEQUENCE=Promise.resolve(),DM_LAST=null;
const dmClone=x=>foundry.utils.deepClone(x);
const dmRegistry=()=>game.settings.get(DM_NS,DM_REG)??[];
const dmLeader=()=>[...game.users].filter(u=>u.active&&u.isGM)
 .sort((a,b)=>a.id.localeCompare(b.id))[0]??null;
const dmIamLeader=()=>dmLeader()?.id===game.user?.id;
const dmEnabled=()=>game.modules.get(DM_NS)?.active===true&&
 game.settings.get(DM_NS,'genericEnabled')===true;
const dmKey=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(x);
const dmUUID=x=>typeof x==='string'&&x.length<=350&&
 /^(Actor\.[^.]+|Scene\.[^.]+\.Token\.[^.]+\.Actor\.[^.]+)(?:\..+)?$/.test(x);
const dmActorUuid=x=>x?.documentName==='Actor'?x.uuid:x?.actor?.uuid??null;
const dmValidDetails=d=>d&&typeof d==='object'&&!Array.isArray(d)&&
 Object.keys(d).every(k=>['key','sourceItemUuid','defenderUuid','attackerUuid',
 'bonusType','value','defenses','reason','expiresOnDeathOf'].includes(k))&&
 dmKey(d.key)&&dmUUID(d.sourceItemUuid)&&dmUUID(d.defenderUuid)&&
 (d.attackerUuid==null||dmUUID(d.attackerUuid))&&
 (d.expiresOnDeathOf==null||dmUUID(d.expiresOnDeathOf))&&
 DM_TYPES.has(d.bonusType)&&Number.isSafeInteger(d.value)&&
 d.value>=-100&&d.value<=100&&
 Array.isArray(d.defenses)&&d.defenses.length>0&&d.defenses.length<=4&&
 d.defenses.every(v=>DM_DEFENSES.has(v))&&
 (d.reason==null||(typeof d.reason==='string'&&d.reason.length<=180));
const dmId=d=>JSON.stringify([d.defenderUuid,d.sourceItemUuid,d.key]);
const dmQueue=work=>{
 const run=DM_SEQUENCE.catch(()=>{}).then(work);
 DM_SEQUENCE=run.catch(()=>{});return run;
};
async function dmActor(uuid){
 const doc=await fromUuid(uuid);
 return doc?.documentName==='Actor'?doc:
  doc?.actor?.documentName==='Actor'?doc.actor:null;
}
async function dmCheck(data,user){
 if(!dmValidDetails(data))throw Error('Invalid declarative defense modifier: '+String(data?.key??'missing-key'));
 const [source,defender]=await Promise.all([
  fromUuid(data.sourceItemUuid),dmActor(data.defenderUuid)]);
 if(source?.documentName!=='Item'||source.actor?.uuid!==defender?.uuid||
    defender?.uuid!==data.defenderUuid)
  throw Error('Source Item must belong to its defender Actor');
 if(!user?.isGM&&defender.testUserPermission?.(user,'OWNER')!==true)
  throw Error('Actor owner or GM required');
 return defender;
}
async function dmMutation(op,data,user){
 if(!dmEnabled()||!dmIamLeader())throw Error('Elected GM required');
 if(op==='register'){
  await dmCheck(data,user);
  const id=dmId(data),record={...dmClone(data),id};
  const next=dmRegistry().filter(x=>x.id!==id);
  if(next.length>=500)throw Error('Defense registry limit reached');
  next.push(record);
  await game.settings.set(DM_NS,DM_REG,next);
  return {id,record:dmClone(record)};
 }
 if(op==='remove'){
  if(!data||!dmUUID(data.defenderUuid)||!dmUUID(data.sourceItemUuid)||
     !dmKey(data.key))throw Error('Invalid defense removal identity');
  const defender=await dmActor(data.defenderUuid);
  if(!defender?.uuid||(!user?.isGM&&
      defender.testUserPermission?.(user,'OWNER')!==true))
   throw Error('Actor owner or GM required');
  const id=dmId(data),existing=dmRegistry().find(x=>x.id===id);
  if(!existing)return {removed:false,id};
  await dmCheck(existing,user);
  await game.settings.set(DM_NS,DM_REG,dmRegistry().filter(x=>x.id!==id));
  return {removed:true,id};
 }
 throw Error('Unsupported defense registry mutation');
}
async function dmRequest(op,data){
 if(!dmEnabled())throw Error('Defense service disabled');
 if(dmIamLeader())return dmQueue(()=>dmMutation(op,data,game.user));
 const gm=dmLeader();
 if(!gm)throw Error('No connected elected GM');
 const id=foundry.utils.randomID();
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{
   DM_PENDING.delete(id);reject(Error('Defense GM request timed out'));
  },15000);
  DM_PENDING.set(id,{resolve,reject,timer});
  game.socket.emit(DM_SOCKET,{channel:DM_CHANNEL,op,id,
   userId:game.user.id,data:dmClone(data)});
 });
}
function dmList({defenderUuid,attackerUuid,defense}={}){
 if(!dmEnabled())return [];
 const matching=dmRegistry().filter(r=>
  (!defenderUuid||r.defenderUuid===defenderUuid)&&
  (!defense||r.defenses.includes(defense))&&
  (attackerUuid==null||!r.attackerUuid||r.attackerUuid===attackerUuid));
 return dmClone(matching);
}
function dmEvaluate({defenderUuid,attackerUuid,defense,nativeTypes,
 nativeTypesComplete=false}={}){
 if(!dmUUID(defenderUuid)||!DM_DEFENSES.has(defense))
  return {status:'uncertain',reason:'defender or defense type unknown',
   total:null,applied:[],suppressed:[]};
 if(attackerUuid!=null&&!dmUUID(attackerUuid))
  return {status:'uncertain',reason:'attacker identity unknown',
   total:null,applied:[],suppressed:[]};
 const candidates=dmList({defenderUuid,attackerUuid,defense});
 if(attackerUuid==null&&candidates.some(x=>x.attackerUuid))
  return {status:'uncertain',reason:'attack origin unknown',
   total:null,applied:[],suppressed:[]};
 const byType=new Map();
 for(const item of candidates){
  const list=byType.get(item.bonusType)??[];list.push(item);byType.set(item.bonusType,list);
 }
 // A native armor-class total does NOT expose a trustworthy breakdown of
 // its embedded bonus types. Fail closed rather than double-applying them.
 const known=nativeTypes??{};
 const applied=[],suppressed=[],unknown=[];
 let total=0;
 for(const [type,items] of byType){
  const special=DM_STACKING.has(type);
  if(!special&&(!nativeTypesComplete&&!Object.hasOwn(known,type))){
   unknown.push(type);continue;
  }
  const native=Number(known[type]??0);
  if(!Number.isFinite(native))return {
   status:'uncertain',reason:'invalid native bonus breakdown',
   total:null,applied:[],suppressed:[]};
  if(special){
   for(const item of items){applied.push(item);total+=item.value}
   continue;
  }
  // Highest bonus of a given type; most severe typed penalty is retained
  // separately and never silently cancelled by a positive bonus.
  const positives=items.filter(x=>x.value>=0).sort((a,b)=>b.value-a.value);
  const negatives=items.filter(x=>x.value<0);
  const best=positives[0];
  if(best&&best.value>native){applied.push(best);total+=best.value-Math.max(0,native)}
  for(const p of negatives){applied.push(p);total+=p.value}
  suppressed.push(...positives.filter(x=>x!==best));
  if(best&&best.value<=native)suppressed.push(best);
 }
 const answer={status:unknown.length?'uncertain':'resolved',
  reason:unknown.length?'native bonus type breakdown unverified: '+unknown.join(', '):null,
  total:unknown.length?null:total,applied:dmClone(applied),
  suppressed:dmClone(suppressed),unknownTypes:unknown};
 DM_LAST=answer;return answer;
}
async function dmReceive(payload){
 if(payload?.channel!==DM_CHANNEL||typeof payload.id!=='string')return;
 if(payload.op==='ack'&&payload.to===game.user.id){
  const pending=DM_PENDING.get(payload.id);
  if(!pending)return;
  clearTimeout(pending.timer);DM_PENDING.delete(payload.id);
  if(payload.ok)pending.resolve(payload.result);
  else pending.reject(Error(String(payload.error??'Defense request refused')));
  return;
 }
 if(!dmIamLeader()||!['register','remove'].includes(payload.op))return;
 const user=game.users.get?.(payload.userId)??[...game.users].find(u=>u.id===payload.userId);
 if(!user?.active)return;
 let result=null,error=null;
 try{result=await dmQueue(()=>dmMutation(payload.op,payload.data,user))}
 catch(e){error=String(e?.message??e)}
 game.socket.emit(DM_SOCKET,{channel:DM_CHANNEL,op:'ack',
  to:payload.userId,id:payload.id,ok:error===null,result,error});
}
Hooks.once('init',()=>{
 game.settings.register(DM_NS,DM_REG,{scope:'world',config:false,type:Array,default:[]});
});
Hooks.once('ready',()=>{
 const module=game.modules.get(DM_NS);if(!module)return;
 module.api??={};
 module.api.defenseModifiers=Object.freeze({
  register:data=>dmRequest('register',data),
  remove:data=>dmRequest('remove',data),
  list:options=>dmList(options),
  evaluate:options=>dmEvaluate(options),
  lastDiagnostic:()=>DM_LAST?dmClone(DM_LAST):null
 });
 game.socket.on(DM_SOCKET,dmReceive);
});
