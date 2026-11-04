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
const SO_DESCRIPTOR_NAMES = new Set(['sonic','languageDependent','magical']);
function soNormalizeTag(tag) {
  if (typeof tag !== 'string') return null;
  const simple=tag.toLowerCase().replace(/[^a-z]/g,'');
  if(simple==='sonic')return 'sonic';
  if(simple==='languagedependent'||simple==='language')return 'language-dependent';
  return simple||null;
}
function soNormalizedDescriptors(data) {
  if(data==null)return [];
  // PF1 11.11 BaseItemModel.tags is Set<FreeText>. It can be an Array
  // after serialisation, or a flag object in converted/third-party content.
  const values = data instanceof Set || Object.prototype.toString.call(data)==='[object Set]'
    ? Array.from(data)
    : Array.isArray(data) ? data
    : typeof data==='string' ? data.split(/[,;|]/)
    : typeof data==='object' ? Object.entries(data)
      .flatMap(([key,v])=>v===true?[key]:
        typeof v==='string'?[v]:
        v && typeof v==='object'?[v]:[]) : [];
  return [...new Set(values.map(v=>
    soNormalizeTag(typeof v==='string'?v:
      typeof v?.id==='string'?v.id:
      typeof v?.value==='string'?v.value:
      typeof v?.name==='string'?v.name:null)
  ).filter(Boolean))];
}
function soTraits(item) {
  if(item?.documentName!=='Item')return null;
  const custom=item.getFlag?.(SO_NS,'saveTraits')??{};
  const system=item.system??{};
  // PF1 11.11 FeatModel.abilityType: "su" | "sp" | "ex" | "na".
  // BaseItemModel.tags: Set<FreeText>. Item text is NEVER parsed.
  const type=String(system.abilityType??'').toLowerCase().trim();
  const abilityType=type==='su'?'supernatural':
    type==='sp'?'spell-like':
    type==='ex'?'extraordinary':
    type==='na'?'natural':
    type||null;
  const descriptors=[...new Set([
    ...soNormalizedDescriptors(system.tags),
    ...soNormalizedDescriptors(system.descriptors),
    ...soNormalizedDescriptors(system.spellDescriptors),
    ...soNormalizedDescriptors(system.spell?.descriptors),
    ...soNormalizedDescriptors(custom.descriptors)
  ])];
  const magical=typeof custom.magical==='boolean'
    ?custom.magical
    :item.type==='spell'||type==='su'||type==='sp';
  return {
    magical, abilityType, descriptors,
    sonic:descriptors.includes('sonic'),
    languageDependent:descriptors.includes('language-dependent')
  };
}
/** Explicit allOf/anyOf plus legacy v1.11 sonic OR language semantics. */
function soPredicateConfig(appliesTo) {
  const current=appliesTo??{};
  const valid=Object.keys(current).every(k=>
    ['magical','sonic','languageDependent','allOf','anyOf'].includes(k));
  const booleans=['magical','sonic','languageDependent']
    .every(k=>current[k]===undefined||typeof current[k]==='boolean');
  const validList=list=>list==null||(Array.isArray(list)&&list.length<=8&&
    list.every(x=>SO_DESCRIPTOR_NAMES.has(x)));
  if(typeof current!=='object'||Array.isArray(current)||!valid||!booleans||
     !validList(current.anyOf)||!validList(current.allOf)) {
    throw Error('Invalid appliesTo: use magical:true and anyOf/allOf descriptor arrays.');
  }
  const legacyAny=[];
  if(current.sonic===true)legacyAny.push('sonic');
  if(current.languageDependent===true)legacyAny.push('languageDependent');
  return {
    magical:current.magical===true,
    anyOf:current.anyOf??legacyAny,
    allOf:current.allOf??[]
  };
}
function soMatchesPredicate(traits,appliesTo) {
  const rule=soPredicateConfig(appliesTo);
  const values={magical:traits.magical,sonic:traits.sonic,
    languageDependent:traits.languageDependent};
  if(rule.magical&&!values.magical)return {ok:false,reason:'source is not magical'};
  for(const k of rule.allOf)if(!values[k])return {
    ok:false,reason:'missing required '+k+' descriptor'
  };
  if(rule.anyOf.length && !rule.anyOf.some(k=>values[k]))return {
    ok:false,reason:'no matching anyOf descriptor: '+rule.anyOf.join(' OR ')
  };
  return {ok:true,reason:'matched'};
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
  const appliesTo=soPredicateConfig(data.appliesTo);
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
    appliesTo,
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
  if(!root || typeof root!=='object') {
    soLog('Dynamic replacement unavailable: missing Actor flag',{
      actor:actor.uuid,namespace:replacement.namespace,key:replacement.key});
    return null;
  }
  const raw=replacement.path.split('.').reduce((a,k)=>a?.[k],root);
  if(typeof raw!=='number'||!Number.isFinite(raw)) {
    soLog('Dynamic replacement unavailable: flag path is not a finite number',{
      actor:actor.uuid,path:replacement.path,raw});
    return null;
  }
  soLog('Dynamic replacement resolved: '+raw,{
    actor:actor.uuid,namespace:replacement.namespace,
    flag:replacement.key,path:replacement.path});
  return raw;
}
async function soFindCandidates(data) {
  if(!soEnabled()||!soLeader())return [];
  const target=await fromUuid(data.targetActorUuid);
  const item=await fromUuid(data.sourceItemUuid);
  if(target?.documentName!=='Actor'||item?.documentName!=='Item'||
     !soSaveId(data.saveType)) {
    soLog('Save rejected: missing Actor, source Item or valid saving throw',{
      actorUuid:data?.targetActorUuid,sourceItemUuid:data?.sourceItemUuid,
      saveType:data?.saveType});
    return [];
  }
  const traits=soTraits(item);
  if(!traits)return [];
  soLog('Save detected',{target:target.uuid,save:data.saveType});
  soLog('Source: '+item.name,{uuid:item.uuid});
  soLog('Source UUID: '+item.uuid);
  soLog('Source ability type: '+(traits.abilityType??'unknown'));
  soLog('Source tags: '+traits.descriptors.join(', '));
  soLog('Context',{magical:traits.magical,sonic:traits.sonic,
    languageDependent:traits.languageDependent});
  const scene=game.scenes?.active??canvas.scene;
  const targetToken=soTokenFromActor(target,scene,data.targetTokenUuid??null);
  if(!targetToken) {
    soLog('Save rejected: target token not in active scene',{
      target:target.uuid,scene:scene?.id,
      tokenUuid:data.targetTokenUuid??null});
    return [];
  }
  const rules=soRegistry().slice().sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
  const applicable=[];
  for(const rule of rules) {
    soLog('Checking rule: '+rule.key,{ruleId:rule.id,groupKey:rule.groupKey});
    if(!soGroupsFor(rule).length) {
      soLog('Rule rejected: linked effect group is not active',{rule:rule.id});
      continue;
    }
    const predicate=soMatchesPredicate(traits,rule.appliesTo);
    soLog('Source predicate: '+(predicate.ok?'PASS':'FAIL'),{
      rule:rule.id,reason:predicate.reason,
      magical:traits.magical,sonic:traits.sonic,
      languageDependent:traits.languageDependent
    });
    if(!predicate.ok) {
      soLog('Rule rejected: '+predicate.reason,{rule:rule.id});
      continue;
    }
    const source=await fromUuid(rule.sourceActorUuid);
    if(source?.documentName!=='Actor') {
      soLog('Rule rejected: source Actor not found',{rule:rule.id});
      continue;
    }
    soLog('Target deafened: '+soDeaf(target),{target:target.uuid});
    if(rule.requiresHearing && soDeaf(target)) {
      soLog('Rule rejected: target cannot hear source (deafened)',{rule:rule.id});
      continue;
    }
    const sourceToken=soTokenFromActor(source,scene);
    soLog('Source token: '+(sourceToken?.uuid??'missing'));
    soLog('Target token: '+(targetToken?.uuid??'missing'));
    if(!sourceToken) {
      soLog('Rule rejected: source token not in active scene',{rule:rule.id});
      continue;
    }
    if(source.uuid!==target.uuid) {
      const threshold=soRangeToScene(rule.range,rule.rangeUnits,scene);
      const distance=soDistance(sourceToken,targetToken,scene);
      soLog('Range check: '+(distance!==null&&threshold!==null&&distance<=threshold?'PASS':'FAIL'),{
        rule:rule.id,distance,maximumDistance:threshold,sceneUnits:scene.grid?.units});
      if(threshold===null||distance===null||distance>threshold) {
        soLog('Rule rejected: target out of range or distance unavailable',{
          rule:rule.id,distance,maximumDistance:threshold});
        continue;
      }
      if(rule.requiresHearing) {
        const blocked=soWallsBlock(sourceToken,targetToken,'sound');
        soLog('Hearing collision: '+(blocked===null?'unknown':blocked?'blocked':'clear'),{
          rule:rule.id});
        if(blocked!==false) {
          soLog('Rule rejected: target cannot hear source (sound blocked or unknown)',{
            rule:rule.id});
          continue;
        }
        soLog('Hearing check: PASS',{rule:rule.id});
      }
      if(rule.requiresSight && soWallsBlock(sourceToken,targetToken,'sight')!==false) {
        soLog('Rule rejected: sight blocked or unknown',{rule:rule.id});
        continue;
      }
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
  soLog('Normal save: '+normal);
  soLog('Replacement value: '+(winner?.value??'none'));
  soLog('Effective result: '+effective);
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
    const senderId=message.author?.id??null;
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
      const metadata={
        normalTotal:decision.normalTotal,
        effectiveTotal:decision.effectiveTotal,
        saveType:decision.saveType,sourceItemUuid:decision.sourceItemUuid,
        winner:decision.winner?.id??null
      };
      try {
        await message.setFlag?.(SO_NS,'saveOverride',metadata);
      } catch(error) {
        soLog('Could not flag original save message',{id:message.id,error:error.message});
      }
      // Other integrations may consume the effective result, but PF1 itself
      // has already finished its normal save calculation at this point.
      Hooks.callAll('pf1aeSaveOverrideResolved',actor,decision,message);
      await soSummary(message,decision,actor);
    }
  });
}
function soStorePre(actor,options,saveType) {
  if(!soEnabled()||!soSaveId(saveType))return;
  const key=actor.uuid+':'+saveType;
  const extra=options?.pf1aeSave;
  // An unannotated roll breaks the pending annotated sequence, including
  // a prior roll that was cancelled by PF1 before its post hook.
  if(!soText(extra?.sourceItemUuid)) {
    soPreRolls.delete(key);
    return;
  }
  const queue=(soPreRolls.get(key)??[]).filter(p=>
    Date.now()-p.createdAt<30000);
  queue.push({
    sourceItemUuid:extra.sourceItemUuid,createdAt:Date.now(),
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
  if(!pending || Date.now()-pending.createdAt>30000)return;
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
/** Roll with unambiguous item-origin metadata in the PF1 pre-save options.
 * This runs on the client allowed to roll for the target; it never adds any
 * bonus or changes the PF1 d20 result.
 */
async function soRollWithContext(data) {
  const actor=data?.actor;
  if(actor?.documentName!=='Actor' || (!actor.isOwner && !game.user.isGM)) {
    throw Error('The roller must own the target Actor.');
  }
  if(!soSaveId(data.saveType)||!soText(data.sourceItemUuid)) {
    throw Error('Save type and source Item UUID are required.');
  }
  // Players need not be able to read a restricted source Compendium. The
  // elected GM resolves and validates this UUID authoritatively post-roll.
  const options={...(data.options??{}),
    pf1aeSave:{sourceItemUuid:data.sourceItemUuid}};
  return actor.rollSavingThrow(data.saveType,options);
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
    rollWithContext:soRollWithContext, // owner-run native save with Item provenance
    requestRepeatSave:soRepeatSave, // GM explicit, never auto-scans buffs
    list:()=>soClone(soRegistry()),
    reconcile:soReconcile, // elected GM only
    _onGroupRemoved:soOnGroupRemoved
  });
  game.socket.on(SO_SOCKET,data=>{if(data?.channel===SO_CHANNEL)
    void soHandleSocket(data);});
});
