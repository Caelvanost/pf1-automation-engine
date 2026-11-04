/**
 * PF1 Automation Engine: persistent, data-driven saving-throw replacement.
 * Foundry v13 / PF1 11.11. No class rules and no serialized JavaScript.
 *
 * Native PF1 hook signatures:
 * pf1PreActorRollSave(actor, rollOptions, saveId)   [cancellable]
 * pf1ActorRollSave(actor, result, saveId)           [post-roll]
 *
 * The post hook occurs AFTER d20Roll has created its chat result. This engine
 * never changes the native roll or pretends to retroactively alter PF1 action
 * resolution. It records/shows an authoritative effective total for consumers.
 */
const SO_NS = 'pf1-automation-engine';
const SO_SETTING = 'saveOverrideRegistry';
const SO_DONE_SETTING = 'saveOverrideProcessed';
const SO_CHANNEL = 'pf1ae-save-overrides-v1';
const SO_SOCKET = 'module.' + SO_NS;
const SO_CACHE_LIMIT = 200;
const soPreRolls = new Map();
const soQueue = new Map();
let soWriteTail=Promise.resolve();

const soClone = value => foundry.utils.deepClone(value);
const soLeader = () => [...game.users].filter(u => u.active && u.isGM)
  .sort((a,b) => a.id.localeCompare(b.id))[0]?.id === game.user.id;
const soEnabled = () => game.modules.get(SO_NS)?.active &&
  !game.modules.get('pf1-combat-automation')?.active &&
  game.settings.get(SO_NS,'genericEnabled');
const soLog = (event, data={}) => {
  if (game.settings.get(SO_NS,'genericDebug')) console.debug('[PF1AE][SaveOverride] ' + event,data);
};
const soRegistry = () => game.settings.get(SO_NS,SO_SETTING) ?? [];
const soDone = () => game.settings.get(SO_NS,SO_DONE_SETTING) ?? [];
const soText = (x,max=400) => typeof x === 'string' && x.length>0 && x.length<=max;
const soKey = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(x);
const soSaveId = id => ['fort','ref','will'].includes(id);
const soUUID = x => typeof x === 'string' ? x : x?.uuid;
function soWrites(fn) {
  const next=soWriteTail.catch(()=>{}).then(fn);
  soWriteTail=next.catch(()=>{});
  return next;
}
function soActorQueue(uuid,fn) {
  const previous=soQueue.get(uuid) ?? Promise.resolve();
  const next=previous.catch(()=>{}).then(fn);
  soQueue.set(uuid,next);
  next.finally(()=>{if(soQueue.get(uuid)===next)soQueue.delete(uuid);}).catch(()=>{});
  return next;
}
function soRequireGM() {
  if(!game.user.isGM || !soLeader()) throw Error('Only the elected GM can perform this operation.');
}
function soNormalizedDescriptors(data) {
  if (!data) return [];
  // PF1 descriptors are structured on spells; custom traits must be
  // explicitly configured instead of guessed from item descriptions/names.
  const values=Array.isArray(data) ? data :
    typeof data === 'string' ? [data] :
    typeof data === 'object' ? Object.entries(data)
      .filter(([,v])=>v===true).map(([k])=>k) : [];
  const normalized=values.filter(x=>typeof x==='string').map(x=>
    x.toLowerCase().replace(/[^a-z]/g,''));
  return [...new Set(normalized.map(x=>
    x==='languagedependent' ? 'language-dependent' : x
  ))];
}
function soTraits(item) {
  if (item?.documentName !== 'Item') return null;
  const custom=item.getFlag?.(SO_NS,'saveTraits') ?? {};
  const native = item.system?.descriptors ?? item.system?.spellDescriptors ??
    item.system?.spell?.descriptors ?? [];
  const descriptors=soNormalizedDescriptors(custom.descriptors ?? native);
  const magical=typeof custom.magical==='boolean' ? custom.magical :
    item.type==='spell' || ['sp','su'].includes(item.system?.abilityType);
  return {magical,descriptors};
}
function soValidation(data, source) {
  if (!source || source.documentName!=='Actor' || !soText(source.uuid)) {
    throw Error('A source Actor is required.');
  }
  if(!soKey(data?.key) || !soKey(data?.groupKey)) {
    throw Error('A stable rule key and groupKey are required.');
  }
  if(data.sourceActorUuid && data.sourceActorUuid!==source.uuid) {
    throw Error('The source Actor UUID does not match the registered Actor.');
  }
  const range=Number(data.range);
  if(!Number.isFinite(range) || range<0 || range>10000) {
    throw Error('Range must be a finite non-negative number.');
  }
  if(!['ft','m'].includes(data.rangeUnits??'ft')) {
    throw Error('Range units must be ft or m.');
  }
  if (!['higher-result'].includes(data.mode??'higher-result')) {
    throw Error('Unsupported replacement mode.');
  }
  if (data.predicate != null || data.replacementProvider != null ||
      data.getReplacementValue != null) {
    throw Error('Executable predicates/providers cannot be persisted. Use appliesTo and replacement.actorFlag.');
  }
  const appliesTo=data.appliesTo??{};
  if(typeof appliesTo!=='object'||Array.isArray(appliesTo)||
     Object.keys(appliesTo).some(k=>!['magical','sonic','languageDependent'].includes(k)) ||
     Object.values(appliesTo).some(v=>typeof v!=='boolean')) {
    throw Error('Unsupported appliesTo predicate.');
  }
  if (!data.replacement || data.replacement.type!=='actorFlag' ||
      !soText(data.replacement.namespace,80) ||
      !soText(data.replacement.key,120) ||
      !soText(data.replacement.path,120) ||
      !/^[A-Za-z0-9_.-]+$/.test(data.replacement.path)) {
    throw Error('Use replacement:{type:"actorFlag",namespace,key,path}.');
  }
  const priority=data.priority??0;
  if(!Number.isSafeInteger(priority) || priority<-100 || priority>100) {
    throw Error('Priority must be an integer between -100 and 100.');
  }
  const id=source.uuid+':'+data.key;
  return {
    id,key:data.key,sourceActorUuid:source.uuid,groupKey:data.groupKey,
    range,rangeUnits:data.rangeUnits??'ft',
    requiresHearing:data.requiresHearing===true,
    requiresSight:data.requiresSight===true,
    appliesTo:{
      magical:appliesTo.magical===true,
      sonic:appliesTo.sonic===true,
      languageDependent:appliesTo.languageDependent===true
    },
    mode:data.mode??'higher-result',priority,
    replacement:{
      type:'actorFlag',
      namespace:data.replacement.namespace,
      key:data.replacement.key,
      path:data.replacement.path
    },
    label:soText(data.label??'',100) ? data.label : data.key
  };
}
function soWire(data) {
  const actor=data?.actor;
  if (!actor || actor.documentName!=='Actor') throw Error('Actor document required.');
  if (!actor.isOwner && !game.user.isGM) throw Error('You do not own the source Actor.');
  return {sourceActorUuid:actor.uuid, rule:{
    ...data,actor:undefined,sourceActorUuid:actor.uuid
  }};
}
async function soRegisterInternal(payload,requester,remote=false) {
  if(!soLeader() || !soEnabled()) throw Error('Elected GM unavailable.');
  const actor=await fromUuid(payload.sourceActorUuid);
  if(!actor || actor.documentName!=='Actor') throw Error('Source Actor not found.');
  if(remote || !requester?.isGM) {
    if(!actor.testUserPermission?.(requester,'OWNER')) {
      throw Error('Requester does not own source Actor.');
    }
  }
  const rule=soValidation(payload.rule,actor);
  // It is safe for the item script to register before an asynchronous
  // effectGroups.applyGroup request has finished. A rule is inert unless
  // the source's group is live; stopping that group prunes the rule.
  return soWrites(async()=>{
    const current=soRegistry();
    const own=current.filter(r=>r.sourceActorUuid===actor.uuid && r.id!==rule.id);
    if(own.length>=50) throw Error('Maximum 50 save overrides per Actor.');
    await game.settings.set(SO_NS,SO_SETTING,
      [...current.filter(r=>r.id!==rule.id),rule]);
    soLog('Registered',{id:rule.id,groupKey:rule.groupKey});
    return {registered:true,id:rule.id};
  });
}
async function soUnregisterInternal(payload,requester,remote=false) {
  if(!soLeader() || !soEnabled()) throw Error('Elected GM unavailable.');
  const actor=await fromUuid(payload.sourceActorUuid);
  if(actor?.documentName!=='Actor') throw Error('Source Actor not found.');
  if((remote||!requester?.isGM) && !actor.testUserPermission?.(requester,'OWNER')) {
    throw Error('Requester does not own source Actor.');
  }
  if(!soKey(payload.key)) throw Error('Invalid override key.');
  const id=actor.uuid+':'+payload.key;
  return soWrites(async()=>{
    await game.settings.set(SO_NS,SO_SETTING,soRegistry().filter(r=>r.id!==id));
    soLog('Unregistered',{id});
    return {unregistered:true,id};
  });
}
function soSend(op, data) {
  if(!soEnabled()) throw Error('Automation Engine is disabled.');
  const payload=soWire(data);
  if(soLeader()) {
    return op==='register'
      ? soRegisterInternal(payload,game.user)
      : soUnregisterInternal({sourceActorUuid:payload.sourceActorUuid,key:data.key},game.user);
  }
  if(![...game.users].some(u=>u.active&&u.isGM)) throw Error('An active GM is required.');
  const request={
    channel:SO_CHANNEL,op,userId:game.user.id,
    requestId:foundry.utils.randomID(),...payload,
    ...(op==='unregister'?{key:data.key}:{})
  };
  game.socket.emit(SO_SOCKET,request);
  return Promise.resolve({submitted:true,requestId:request.requestId});
}
async function soOnGroupRemoved(sourceUuid,groupKey) {
  if(!soLeader())return;
  return soWrites(async()=>{
    const remaining=soRegistry().filter(r=>
      !(r.sourceActorUuid===sourceUuid && r.groupKey===groupKey));
    if(remaining.length!==soRegistry().length) {
      await game.settings.set(SO_NS,SO_SETTING,remaining);
      soLog('Group removed: deleted linked overrides',{sourceUuid,groupKey});
    }
  });
}
function soGroupsFor(rule) {
  return game.modules.get(SO_NS)?.api?.effectGroups?.listGroups()?.filter(g=>
    g.sourceUuid===rule.sourceActorUuid && g.key===rule.groupKey &&
    !g.pendingCleanup && (g.copies??[]).length>0
  ) ?? [];
}
async function soReconcile() {
  soRequireGM();
  return soWrites(async()=>{
    const old=soRegistry();
    const next=old.filter(r=>soGroupsFor(r).length>0);
    if(next.length!==old.length) await game.settings.set(SO_NS,SO_SETTING,next);
    return {removed:old.length-next.length,remaining:next.length};
  });
}
function soDeaf(actor) {
  const s=actor?.statuses;
  return Boolean(s?.has?.('deafened') || s?.has?.('deaf') ||
    actor?.system?.conditions?.deafened || actor?.system?.conditions?.deaf);
}
function soTokenCenter(token) {
  const doc=token?.document ?? token;
  if(token?.center?.x!=null) return token.center;
  if(doc?.object?.center?.x!=null)return doc.object.center;
  const size=canvas?.grid?.size;
  if(!Number.isFinite(doc?.x)||!Number.isFinite(doc?.y)||
      !Number.isFinite(size))return null;
  return {x:doc.x+size*(doc.width??1)/2,y:doc.y+size*(doc.height??1)/2};
}
function soTokenFromActor(actor,scene,explicitUuid=null) {
  if(!scene) return null;
  for(const doc of scene.tokens??[]) {
    if(explicitUuid && doc.uuid!==explicitUuid)continue;
    if(doc.actor?.uuid===actor.uuid ||
      (doc.actorId===actor.id && !actor.isToken))return doc.object??doc;
  }
  return null;
}
function soRangeToScene(range, units, scene) {
  const sceneUnits=(scene?.grid?.units??'').toLowerCase().trim();
  if(['ft','feet','foot'].includes(sceneUnits))return units==='ft'?range:range*3.280839895;
  if(['m','meter','meters','metre','metres','mètre','mètres'].includes(sceneUnits))return units==='m'?range:range*0.3048;
  return null;
}
function soDistance(source,target,scene) {
  if(!canvas?.grid?.measurePath || canvas?.scene?.id!==scene?.id)return null;
  const a=soTokenCenter(source),b=soTokenCenter(target);
  if(!a||!b)return null;
  const path=canvas.grid.measurePath([a,b],{gridSpaces:true});
  if(Number.isFinite(path?.distance))return path.distance;
  if(Array.isArray(path?.segments)) {
    const total=path.segments.reduce((acc,seg)=>acc+(Number(seg.distance)||0),0);
    return Number.isFinite(total)?total:null;
  }
  return null; // Never use raw pixel Euclidean distance as a fallback.
}
function soWallsBlock(source,target,type) {
  const backend=CONFIG?.Canvas?.polygonBackends?.[type];
  if(typeof backend?.testCollision!=='function')return null;
  const a=soTokenCenter(source),b=soTokenCenter(target);
  if(!a||!b)return null;
  try {return !!backend.testCollision(a,b,{mode:'any',type});}
  catch(error){soLog('Collision test failed',{type,error:error.message});return null;}
}
function soReadFlag(actor,replacement) {
  const root=actor.getFlag?.(replacement.namespace,replacement.key);
  if(!root || typeof root!=='object') return null;
  const raw=replacement.path.split('.').reduce((a,k)=>a?.[k],root);
  return typeof raw==='number' && Number.isFinite(raw) ? raw : null;
}
async function soFindCandidates(data) {
  if(!soEnabled()||!soLeader())return [];
  const target=await fromUuid(data.targetActorUuid);
  const item=await fromUuid(data.sourceItemUuid);
  if(target?.documentName!=='Actor'||item?.documentName!=='Item'||
     !soSaveId(data.saveType))return [];
  const traits=soTraits(item);
  if(!traits)return [];
  soLog('Save detected',{target:target.uuid,save:data.saveType,
    sourceItem:item.uuid,traits});
  const scene=game.scenes?.active??canvas.scene;
  const targetToken=soTokenFromActor(target,scene,data.targetTokenUuid??null);
  if(!targetToken)return [];
  const rules=soRegistry().sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
  const applicable=[];
  for(const rule of rules) {
    if(!soGroupsFor(rule).length)continue;
    if(rule.appliesTo.magical && !traits.magical)continue;
    const anyRequested=rule.appliesTo.sonic||rule.appliesTo.languageDependent;
    if(anyRequested && !(
      rule.appliesTo.sonic && traits.descriptors.includes('sonic') ||
      rule.appliesTo.languageDependent && traits.descriptors.includes('language-dependent')
    ))continue;
    const source=await fromUuid(rule.sourceActorUuid);
    if(source?.documentName!=='Actor')continue;
    if(rule.requiresHearing && soDeaf(target)) {
      soLog('Hearing check: deafened',{target:target.uuid,rule:rule.id});
      continue;
    }
    const sourceToken=soTokenFromActor(source,scene);
    if(!sourceToken)continue;
    if(source.uuid!==target.uuid) {
      const threshold=soRangeToScene(rule.range,rule.rangeUnits,scene);
      const distance=soDistance(sourceToken,targetToken,scene);
      if(threshold===null||distance===null||distance>threshold) {
        soLog('Target out of range or distance unavailable',{rule:rule.id,distance,threshold});
        continue;
      }
      soLog('Target in range',{rule:rule.id,distance,threshold});
      if(rule.requiresHearing) {
        const blocked=soWallsBlock(sourceToken,targetToken,'sound');
        if(blocked!==false)continue; // Unknown collision API => fail closed.
        soLog('Hearing check passed',{rule:rule.id});
      }
      if(rule.requiresSight && soWallsBlock(sourceToken,targetToken,'sight')!==false)continue;
    }
    const value=soReadFlag(source,rule.replacement);
    if(value===null)continue;
    applicable.push({
      id:rule.id,key:rule.key,groupKey:rule.groupKey,sourceActorUuid:source.uuid,
      sourceName:source.name,label:rule.label,value,priority:rule.priority
    });
    soLog('Replacement candidate',{rule:rule.id,value});
  }
  return applicable;
}
async function soResolve(data) {
  soRequireGM();
  const normal=Number(data?.normalTotal);
  if(!Number.isFinite(normal))throw Error('A real finite saving throw total is required.');
  if(!soSaveId(data.saveType)||!soText(data.targetActorUuid)||
     !soText(data.sourceItemUuid))throw Error('Target, save type and source Item UUID required.');
  const candidates=await soFindCandidates(data);
  const winner=candidates.slice().sort((a,b)=>b.value-a.value||b.priority-a.priority||
    a.id.localeCompare(b.id))[0]??null;
  const effective=Math.max(normal,...candidates.map(c=>c.value));
  const changed=effective>normal;
  soLog('Resolved',{normal,replacement:winner?.value??null,effective,candidates:candidates.length});
  return {normalTotal:normal,effectiveTotal:effective,changed,
    winner:changed?winner:null,candidates,saveType:data.saveType,
    targetActorUuid:data.targetActorUuid,sourceItemUuid:data.sourceItemUuid};
}
function soEscape(text) {
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
async function soSummary(message,decision,target) {
  if(!decision.candidates.length)return null;
  const lines=[
    '<strong>Saving Throw Override</strong>',
    '<div>'+soEscape(target.name)+': '+soEscape(decision.saveType.toUpperCase())+
      ' saving throw '+decision.normalTotal+'</div>',
    ...decision.candidates.map(c=>
      '<div>'+soEscape(c.label)+' ('+soEscape(c.sourceName)+'): '+c.value+'</div>'),
    '<div><strong>Result used: '+decision.effectiveTotal+'</strong>'+
      (decision.changed ? ' (replaced)' : ' (normal roll retained)')+'</div>'
  ];
  return ChatMessage.implementation.create({
    content:lines.join(''),
    speaker:ChatMessage.implementation.getSpeaker({actor:target}),
    flags:{[SO_NS]:{saveOverride:{
      originalMessageId:message?.id??null,
      normalTotal:decision.normalTotal,
      effectiveTotal:decision.effectiveTotal,
      sourceItemUuid:decision.sourceItemUuid,
      winner:decision.winner?.id??null
    }}}
  });
}
function soMessageTotal(message) {
  if(!message)return null;
  const values=[
    message.rolls?.[0]?.total,
    message.roll?.total,
    message.total
  ];
  return values.find(x=>typeof x==='number'&&Number.isFinite(x))??null;
}
async function soProcessRoll(data,requester,remote=false) {
  if(!soEnabled()||!soLeader())return;
  if(!soSaveId(data?.saveType)||!soText(data?.actorUuid)||
     !soText(data?.sourceItemUuid) || !soText(data?.messageId,100))return;
  const actor=await fromUuid(data.actorUuid);
  if(actor?.documentName!=='Actor')return;
  if(remote && !actor.testUserPermission?.(requester,'OWNER'))return;
  if(!requester?.active)return;
  return soActorQueue(actor.uuid,async()=>{
    if(soDone().includes(data.messageId))return;
    // Message arrives asynchronously at clients; retry a few times.
    let message=null;
    for(let n=0;n<8;n++){
      message=game.messages?.get(data.messageId)??null;
      if(message)break;
      await new Promise(resolve=>setTimeout(resolve,120));
    }
    if(!message)return;
    const senderId=message.user?.id??message.user;
    if(senderId!==requester.id)return;
    if(message.speaker?.actor && message.speaker.actor!==actor.id)return;
    const normal=soMessageTotal(message);
    if(normal===null)return;
    const decision=await soResolve({
      targetActorUuid:actor.uuid,saveType:data.saveType,
      sourceItemUuid:data.sourceItemUuid,targetTokenUuid:data.targetTokenUuid,
      normalTotal:normal
    });
    // Deduplicate persistent message IDs even after a secondary GM takes over.
    await soWrites(async()=>{
      const list=soDone();
      if(list.includes(message.id))return;
      await game.settings.set(SO_NS,SO_DONE_SETTING,
        [...list,message.id].slice(-SO_CACHE_LIMIT));
    });
    if(decision.candidates.length) {
      await soSummary(message,decision,actor);
    }
  });
}
function soStorePre(actor,options,saveType) {
  if(!soEnabled()||!soSaveId(saveType))return;
  const extra=options?.pf1aeSave;
  if(!soText(extra?.sourceItemUuid))return; // No origin => no guesses.
  const key=actor.uuid+':'+saveType;
  const queue=soPreRolls.get(key)??[];
  queue.push({
    sourceItemUuid:extra.sourceItemUuid,
    tokenUuid:options.token?.uuid??actor.token?.uuid??null
  });
  soPreRolls.set(key,queue.slice(-20));
}
function soReadPost(actor,result,saveType) {
  if(!soEnabled()||!soSaveId(saveType))return;
  const key=actor?.uuid+':'+saveType;
  const queue=soPreRolls.get(key)??[];
  const pending=queue.shift();
  if(!queue.length)soPreRolls.delete(key);
  if(!pending)return;
  const messageId=result?.id??null;
  if(!messageId)return; // Non-chat result: manual GM resolve remains available.
  const payload={
    channel:SO_CHANNEL,op:'roll',userId:game.user.id,
    requestId:foundry.utils.randomID(),actorUuid:actor.uuid,
    saveType,sourceItemUuid:pending.sourceItemUuid,
    targetTokenUuid:pending.tokenUuid,messageId
  };
  if(soLeader())void soProcessRoll(payload,game.user).catch(error=>
    console.error('[PF1AE][SaveOverride] Roll processing failed',error));
  else game.socket.emit(SO_SOCKET,payload);
}
const soSeenRequests=new Set();
async function soHandleSocket(data) {
  if(!soLeader()||!soEnabled()||data?.channel!==SO_CHANNEL ||
     !soText(data.requestId,100)||soSeenRequests.has(data.requestId))return;
  soSeenRequests.add(data.requestId);
  if(soSeenRequests.size>2000)soSeenRequests.clear();
  const requester=game.users.get(data.userId);
  if(!requester?.active)return;
  try {
    if(data.op==='register')await soRegisterInternal(data,requester,true);
    if(data.op==='unregister')await soUnregisterInternal(data,requester,true);
    if(data.op==='roll')await soProcessRoll(data,requester,true);
  } catch(error) {
    console.error('[PF1AE][SaveOverride] Request rejected: '+error.message,error);
  }
}
async function soRepeatSave(data) {
  soRequireGM();
  if(data?.nonInstantaneous!==true||!Number.isFinite(data.dc) ||
      !soSaveId(data.saveType)||!soText(data.targetActorUuid)||
      !soText(data.sourceItemUuid)) {
    throw Error('Repeat save requires explicit nonInstantaneous=true, DC, target, save type and source Item.');
  }
  const actor=await fromUuid(data.targetActorUuid);
  const source=await fromUuid(data.sourceItemUuid);
  if(actor?.documentName!=='Actor'||source?.documentName!=='Item') {
    throw Error('Repeat save actor or source Item not found.');
  }
  // The calling script, not this engine, establishes persistence and DC.
  // PF1 handles the actual native save and chat card.
  return actor.rollSavingThrow(data.saveType,{
    skipDialog:false,
    pf1aeSave:{sourceItemUuid:source.uuid}
  });
}
Hooks.once('init',()=>{
  game.settings.register(SO_NS,SO_SETTING,
    {scope:'world',config:false,type:Array,default:[]});
  game.settings.register(SO_NS,SO_DONE_SETTING,
    {scope:'world',config:false,type:Array,default:[]});
  Hooks.on('pf1PreActorRollSave',soStorePre);
  Hooks.on('pf1ActorRollSave',soReadPost);
});
Hooks.once('ready',()=>{
  const mod=game.modules.get(SO_NS);
  if(!mod)return;
  mod.api??={};
  mod.api.saveOverrides=Object.freeze({
    register:data=>soSend('register',data),
    unregister:data=>soSend('unregister',data),
    getApplicable:data=>soFindCandidates(data), // GM-authoritative
    resolve:soResolve, // elected GM only; does NOT alter native RollPF
    requestRepeatSave:soRepeatSave, // GM explicit, never auto-scans buffs
    list:()=>soClone(soRegistry()),
    reconcile:soReconcile, // elected GM only
    _onGroupRemoved:soOnGroupRemoved
  });
  game.socket.on(SO_SOCKET,data=>{if(data?.channel===SO_CHANNEL)
    void soHandleSocket(data);});
});
