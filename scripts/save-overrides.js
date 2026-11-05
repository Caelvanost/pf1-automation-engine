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
const soPendingRollResolutions = new Map();
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
const SO_DESCRIPTOR_NAMES = new Set(['sonic','languageDependent','magical','pattern','figment']);
function soNormalizeTag(tag) {
  if (typeof tag !== 'string') return null;
  const raw=tag.toLowerCase().trim();
  const simple=raw.replace(/[^a-z]/g,'');
  if(simple==='sonic')return 'sonic';
  if(simple==='pattern'||simple==='figment')return simple;
  if(simple==='languagedependent'||simple==='language')return 'language-dependent';
  return raw.replace(/\s+/g,'-')||null;
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
function soTraits(item,sourceActionId=null) {
  if(item?.documentName!=='Item')return null;
  const custom=item.getFlag?.(SO_NS,'saveTraits')??{};
  const system=item.system??{};
  // Actions are keyed records in PF1. Only inspect the exact action that
  // generated this save, never descriptors from unrelated Item actions.
  const action=sourceActionId && Object.prototype.hasOwnProperty.call(system.actions??{},sourceActionId)
    ?system.actions[sourceActionId]:null;
  // PF1 11.11 FeatModel.abilityType: "su" | "sp" | "ex" | "na".
  // BaseItemModel.tags: Set<FreeText>. Item text is NEVER parsed.
  const type=String(system.abilityType??'').toLowerCase().trim();
  const abilityType=type==='su'?'supernatural':
    type==='sp'?'spell-like':
    type==='ex'?'extraordinary':
    type==='na'?'natural':
    type||null;
  // SpellModel.subschool is a structured Set<string> (PF1 11.11).
  // Prefer it over freeform tags: tags alone cannot override a contrary
  // explicit spell subschool selection. School 'ill' identifies illusion.
  const subschools=soNormalizedDescriptors(system.subschool);
  const school=String(system.school??'').toLowerCase().trim();
  const hasStructuredSubschool=item.type==='spell' && subschools.length>0;
  const descriptors=[...new Set([
    ...soNormalizedDescriptors(system.tags),
    ...soNormalizedDescriptors(action?.tags),
    ...soNormalizedDescriptors(action?.descriptors),
    ...soNormalizedDescriptors(system.descriptors),
    ...soNormalizedDescriptors(system.spellDescriptors),
    ...soNormalizedDescriptors(system.spell?.descriptors),
    ...soNormalizedDescriptors(custom.descriptors)
  ])];
  const validIllusionSchool=item.type!=='spell'||!school||school==='ill';
  const pattern=validIllusionSchool && (hasStructuredSubschool
    ? subschools.includes('pattern') : descriptors.includes('pattern'));
  const figment=validIllusionSchool && (hasStructuredSubschool
    ? subschools.includes('figment') : descriptors.includes('figment'));
  const magical=typeof custom.magical==='boolean'
    ?custom.magical
    :item.type==='spell'||type==='su'||type==='sp';
  return {
    magical, abilityType, descriptors,
    sonic:descriptors.includes('sonic'),
    languageDependent:descriptors.includes('language-dependent'),
    pattern,figment,school,subschools
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
    languageDependent:traits.languageDependent,pattern:traits.pattern,figment:traits.figment};
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
function soBlind(actor) {
  // PF1 uses the normalized 'blind' condition ID, while Foundry may expose
  // a 'blinded' status. Never infer blindness from arbitrary buff names.
  return Boolean(actor?.statuses?.has?.('blind') ||
    actor?.statuses?.has?.('blinded') ||
    actor?.system?.conditions?.blind || actor?.system?.conditions?.blinded ||
    actor?.hasCondition?.('blind'));
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
  const traits=soTraits(item,data.sourceActionId??null);
  if(!traits)return [];
  soLog('Save detected',{target:target.uuid,save:data.saveType});
  soLog('Source: '+item.name,{uuid:item.uuid});
  soLog('Source UUID: '+item.uuid);
  soLog('Source ability type: '+(traits.abilityType??'unknown'));
  soLog('Source tags: '+traits.descriptors.join(', '));
  soLog('Context',{magical:traits.magical,sonic:traits.sonic,
    languageDependent:traits.languageDependent,pattern:traits.pattern,
    figment:traits.figment,school:traits.school,subschools:traits.subschools});
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
      languageDependent:traits.languageDependent,pattern:traits.pattern,figment:traits.figment
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
    if(rule.requiresSight) {
      const blind=soBlind(target);
      soLog('Sight: '+(blind?'FAIL (blind)':'condition PASS'),{rule:rule.id,target:target.uuid});
      if(blind) {
        soLog('Rule '+rule.key+' rejected: target cannot see provider (blind)',{rule:rule.id});
        continue;
      }
    }
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
      if(rule.requiresSight) {
        // Distraction: observer TARGET must see provider SOURCE. Direction
        // matters for one-way vision-blocking walls. Use v13 sight backend.
        const blocked=soWallsBlock(targetToken,sourceToken,'sight');
        soLog('Sight: '+(blocked===false?'PASS':blocked===true?'FAIL (wall)':'FAIL (unknown)'),{rule:rule.id});
        if(blocked!==false) {
          soLog('Rule '+rule.key+' rejected: target cannot see provider',{rule:rule.id});
          continue;
        }
      }
    }
    if(rule.requiresSight && source.uuid===target.uuid)
      soLog('Sight: PASS (self, not blind)',{rule:rule.id});
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
    // Preserve original saving throw privacy including blind/GM rolls.
    whisper:Array.isArray(message?.whisper)?[...message.whisper]:[],
    blind:message?.blind===true,
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
/**
 * Update only the public action card, and only after authoritative GM
 * verification. Private/GM/blind rolls never write their totals to a
 * potentially public source card, preventing leaks via readable flags.
 */
async function soUpdateSourceCard(card, actor, data, decision, message) {
  if(!card || !data.sourceMessageId)return;
  if(message.blind===true || (message.whisper?.length??0)>0) {
    soLog('Source card update withheld: private or blind save',{
      sourceMessageId:card.id,targetActorUuid:actor.uuid});
    return;
  }
  const targets=card.system?.targets??[];
  const expected=Array.isArray(targets)?targets:[];
  // Prefer the exact PF1 token target of the action card; options.token
  // may not be provided for older PF1 save handlers.
  let targetUuid=expected.includes(data.targetTokenUuid)?data.targetTokenUuid:null;
  if(!targetUuid)for(const uuid of expected){
    try{
      const doc=await fromUuid(uuid);
      if(doc?.actor?.uuid===actor.uuid || doc?.actorId===actor.id){
        targetUuid=uuid;break;
      }
    }catch(error){soLog('Target UUID lookup failed',{uuid,error:error.message});}
  }
  if(!targetUuid){
    soLog('Source card target not identified; no card mutation',{
      cardId:card.id,targetActorUuid:actor.uuid});
    return;
  }
  await soWrites(async()=>{
    const previous=card.getFlag?.(SO_NS,'targetSaveResults');
    const list=Array.isArray(previous)?previous:[];
    const old=list.find(x=>x.targetUuid===targetUuid && x.saveType===decision.saveType);
    // No override, no previous display => leave native PF1 untouched.
    if(!decision.changed && !old)return;
    const newRecord={targetUuid,targetActorUuid:actor.uuid,
      saveType:decision.saveType,normalTotal:decision.normalTotal,
      effectiveTotal:decision.effectiveTotal,changed:decision.changed,
      // If an earlier save was replaced, refresh that display even when the
      // latest native roll is already higher (avoid stale Countersong totals).
      display:true,originalMessageId:message.id,
      sourceActionId:data.sourceActionId??null};
    const updated=list.filter(x=>!(x.targetUuid===targetUuid &&
      x.saveType===decision.saveType));
    updated.push(newRecord);
    await card.setFlag(SO_NS,'targetSaveResults',updated);
    soLog('Action card target result updated',{
      cardId:card.id,targetUuid,normalTotal:decision.normalTotal,
      effectiveTotal:decision.effectiveTotal});
  });
}
/**
 * One authoritative dispatch for every verified native PF1 card save, whether
 * or not a Save Override rule matches. Never accepts player-supplied totals:
 * the elected GM has already read the saved native ChatMessage itself.
 */
async function soDispatchSaveOutcome({actor,card,message,context,normalTotal,effectiveTotal,saveType}) {
  if(!soLeader()||!card||!message||!context)return;
  const event={
    saveMessageId:message.id,sourceMessageId:card.id,
    sourceItemUuid:context.sourceItemUuid,sourceActionId:context.sourceActionId,
    targetActorUuid:actor.uuid,saveType,
    saveDC:context.saveDC,normalTotal,effectiveTotal
  };
  if(!Number.isFinite(event.saveDC)) {
    soLog('SaveOutcome not dispatched: source card has no numeric DC',event);
    return;
  }
  if(game.settings.get(SO_NS,'genericDebug'))
    console.debug('[PF1AE][SaveOutcome] Dispatching resolved save',event);
  const service=game.modules.get(SO_NS)?.api?.saveOutcomes;
  if(!service?.resolve) {
    soLog('SaveOutcome unavailable; no outcome dispatcher registered',event);
    return;
  }
  try { return await service.resolve(event); }
  catch(error) { console.error('[PF1AE][SaveOutcome] Dispatch failed',error); }
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
    let sourceCard=null;
    let verifiedContext=null;
    if(data.sourceMessageId) {
      // The GM re-reads persisted PF1 action-card provenance rather than
      // trusting a socket-supplied Item or Action ID.
      let card=game.messages?.get(data.sourceMessageId)??null;
      for(let n=0;!card&&n<8;n++) {
        await new Promise(resolve=>setTimeout(resolve,120));
        card=game.messages?.get(data.sourceMessageId)??null;
      }
      sourceCard=card;
      const context=card && game.modules.get(SO_NS)?.api?.saveContext?.fromMessage(card);
      if(!context || context.sourceItemUuid!==data.sourceItemUuid ||
          context.sourceActionId!==data.sourceActionId ||
          context.saveType!==data.saveType) {
        soLog('Native save rejected: source card context mismatch',{
          messageId:data.sourceMessageId,actorUuid:data.actorUuid,
          claimedItem:data.sourceItemUuid,claimedAction:data.sourceActionId});
        return null;
      }
      verifiedContext=context;
      soLog('Source context restored',{sourceMessageId:data.sourceMessageId,
        sourceItemUuid:context.sourceItemUuid,sourceActionId:context.sourceActionId,
        saveDC:context.saveDC});
    }
    if(soDone().includes(data.messageId)) {
      const original=game.messages?.get(data.messageId);
      const saved=original?.getFlag?.(SO_NS,'saveOverride');
      if(saved && Number.isFinite(saved.effectiveTotal)) {
        if(sourceCard && verifiedContext) {
          await soDispatchSaveOutcome({actor,card:sourceCard,message:original,
            context:verifiedContext,normalTotal:saved.normalTotal,
            effectiveTotal:saved.effectiveTotal,saveType:data.saveType});
        }
        return {
          normalTotal:saved.normalTotal,effectiveTotal:saved.effectiveTotal,
          changed:saved.effectiveTotal>saved.normalTotal,
          winner:saved.winner??null,
          candidates:saved.candidates??[],
          saveType:data.saveType,sourceItemUuid:data.sourceItemUuid,
          targetActorUuid:actor.uuid
        };
      }
      soLog('Roll already processed',{messageId:data.messageId});
      return null;
    }
    // Message arrives asynchronously at clients; retry a few times.
    let message=null;
    for(let n=0;n<8;n++){
      message=game.messages?.get(data.messageId)??null;
      if(message)break;
      await new Promise(resolve=>setTimeout(resolve,120));
    }
    if(!message) {
      soLog('Roll rejected: chat message not found',{messageId:data.messageId});
      return null;
    }
    const senderId=message.author?.id??null;
    if(senderId!==requester.id) {
      soLog('Roll rejected: ChatMessage author mismatch',{
        messageId:message.id,author:senderId,requester:requester.id});
      return null;
    }
    if(message.speaker?.actor && message.speaker.actor!==actor.id) {
      soLog('Roll rejected: ChatMessage speaker Actor mismatch',{
        messageId:message.id,speaker:message.speaker?.actor,actor:actor.id});
      return null;
    }
    const normal=soMessageTotal(message);
    if(normal===null) {
      soLog('Roll rejected: ChatMessage has no finite roll total',{messageId:message.id});
      return null;
    }
    const decision=await soResolve({
      targetActorUuid:actor.uuid,saveType:data.saveType,
      sourceActionId:data.sourceActionId??null,
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
    {
      // A contextual native save always has a decision flag, even when no
      // override applies. No extra chat is posted if candidates are empty.
      const metadata={
        processed:true,
        normalTotal:decision.normalTotal,
        effectiveTotal:decision.effectiveTotal,
        changed:decision.changed,
        saveType:decision.saveType,sourceItemUuid:decision.sourceItemUuid,
        winner:decision.winner?.id??null,
        candidates:decision.candidates,
        sourceMessageId:data.sourceMessageId??null,
        sourceActionId:data.sourceActionId??null,
        saveDC:Number.isFinite(data.saveDC)?data.saveDC:null
      };
      try {
        await message.setFlag?.(SO_NS,'saveOverride',metadata);
      } catch(error) {
        soLog('Could not flag original save message',{id:message.id,error:error.message});
      }
      // Always dispatch on a verified native card even when no Save Override
      // candidates apply (changed:false, normalTotal===effectiveTotal).
      await soDispatchSaveOutcome({actor,card:sourceCard,message,
        context:verifiedContext,normalTotal:decision.normalTotal,
        effectiveTotal:decision.effectiveTotal,saveType:data.saveType});
      Hooks.callAll('pf1aeSaveOverrideResolved',actor,decision,message);
      if(sourceCard) {
        try {await soUpdateSourceCard(sourceCard,actor,data,decision,message);}
        catch(error){
          soLog('Action card effective result update failed',{
            sourceMessageId:sourceCard.id,error:error.message});
          console.warn('[PF1AE][SaveOverride] Could not update source action card',error);
        }
      }
      if(decision.candidates.length)await soSummary(message,decision,actor);
    }
    return {...decision,sourceMessageId:data.sourceMessageId??null,
      sourceActionId:data.sourceActionId??null,
      saveDC:Number.isFinite(data.saveDC)?data.saveDC:null};
  });
}
function soStorePre(actor,options,saveType) {
  if(!soEnabled()||!soSaveId(saveType)||!actor?.uuid)return;
  const key=actor.uuid+':'+saveType;
  const bridge=game.modules.get(SO_NS)?.api?.saveContext;
  // PF1's own onRollSave/targetSavingThrowClick passes reference: cm.uuid
  // through actor.rollSavingThrow and pf1PreActorRollSave rollOptions.
  // This is the primary path: persisted source per roll, no DOM dependency.
  const nativeContext=!options?.pf1aeSave
    ?bridge?._fromNativeSaveOptions(actor,saveType,options):null;
  // Legacy DOM fallback ONLY for editions with no reference property.
  // An explicit sheet save has no reference and no native card click.
  const clickContext=!options?.pf1aeSave && !options?.reference
    ?bridge?._consumeForNativeSave(actor,saveType):null;
  const restored=nativeContext??clickContext;
  const extra=options?.pf1aeSave??(restored ?{
    sourceItemUuid:restored.sourceItemUuid,
    sourceMessageId:restored.sourceMessageId,
    sourceActionId:restored.sourceActionId,
    saveDC:restored.saveDC
  }:null);
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
    sourceMessageId:extra.sourceMessageId??null,
    sourceActionId:extra.sourceActionId??null,
    saveDC:Number.isFinite(extra.saveDC)?extra.saveDC:null,
    helper:extra.helper===true,
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
  if(!pending || Date.now()-pending.createdAt>30000){
    soLog('Native save without correlated action card; ignored',{actorUuid:actor?.uuid,saveType});
    return;
  }
  if(pending.helper)return; // rollWithContext explicitly awaits the GM decision.
  const messageId=result?.documentName==='ChatMessage' ? result.id :
    (result?.message?.documentName==='ChatMessage' ? result.message.id :
      (result?.chatMessage?.documentName==='ChatMessage' ? result.chatMessage.id :
        (typeof result?.id==='string' && game.messages?.get(result.id)?.documentName==='ChatMessage'
          ?result.id:null)));
  if(!messageId){
    soLog('Native save has no identifiable ChatMessage; ignored',{
      actorUuid:actor?.uuid,saveType,resultType:result?.constructor?.name??typeof result});
    return;
  }
  const payload={
    channel:SO_CHANNEL,op:'roll',userId:game.user.id,
    requestId:foundry.utils.randomID(),actorUuid:actor.uuid,
    saveType,sourceItemUuid:pending.sourceItemUuid,
    sourceMessageId:pending.sourceMessageId,
    sourceActionId:pending.sourceActionId,
    saveDC:pending.saveDC,
    targetTokenUuid:pending.tokenUuid,messageId
  };
  if(soLeader())void soProcessRoll(payload,game.user).catch(error=>
    console.error('[PF1AE][SaveOverride] Roll processing failed',error));
  else game.socket.emit(SO_SOCKET,payload);
}
const soSeenRequests=new Set();
async function soHandleSocket(data) {
  if(!soEnabled()||data?.channel!==SO_CHANNEL||
     !soText(data.requestId,100))return;
  // A response is consumed only by its original client's matching pending
  // request, never by other clients. Only the currently elected GM can
  // create a matching positive result under the normal trusted-table model.
  if(data.op==='roll-result') {
    if(data.recipientId!==game.user.id)return;
    const pending=soPendingRollResolutions.get(data.requestId);
    if(!pending)return;
    if(data.senderId!==pending.leaderId)return;
    clearTimeout(pending.timer);
    soPendingRollResolutions.delete(data.requestId);
    pending.resolve(data.decision??null);
    return;
  }
  if(!soLeader()||soSeenRequests.has(data.requestId))return;
  soSeenRequests.add(data.requestId);
  if(soSeenRequests.size>2000)soSeenRequests.clear();
  const requester=game.users.get(data.userId);
  if(!requester?.active)return;
  try {
    if(data.op==='register')await soRegisterInternal(data,requester,true);
    if(data.op==='unregister')await soUnregisterInternal(data,requester,true);
    if(data.op==='roll') {
      const decision=await soProcessRoll(data,requester,true);
      game.socket.emit(SO_SOCKET,{
        channel:SO_CHANNEL,op:'roll-result',
        requestId:data.requestId,recipientId:requester.id,
        senderId:game.user.id,decision:decision?soClone(decision):null
      });
    }
  } catch(error) {
    console.error('[PF1AE][SaveOverride] Request rejected: '+error.message,error);
    if(data.op==='roll')game.socket.emit(SO_SOCKET,{
      channel:SO_CHANNEL,op:'roll-result',
      requestId:data.requestId,recipientId:requester.id,
      senderId:game.user.id,decision:null
    });
  }
}
/** Await elected-GM validation and comparison for a newly completed chat roll. */
async function soAwaitResolution(payload) {
  if(soLeader())return soProcessRoll(payload,game.user,false);
  const gm=[...game.users].filter(u=>u.active&&u.isGM)
    .sort((a,b)=>a.id.localeCompare(b.id))[0];
  if(!gm)throw Error('No elected GM is connected to resolve the save.');
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      soPendingRollResolutions.delete(payload.requestId);
      reject(Error('Save override resolution timed out waiting for the elected GM.'));
    },10000);
    soPendingRollResolutions.set(payload.requestId,{
      resolve,reject,timer,leaderId:gm.id
    });
    game.socket.emit(SO_SOCKET,payload);
  });
}
/**
 * Roll natively, then await the elected GM's authoritative effective total.
 * Return BOTH the original PF1 ChatMessage and effective decision. Never
 * alter the original die, PF1 roll formula, or already-finished PF1 outcomes.
 */
async function soRollWithContext(data) {
  const actor=data?.actor;
  if(actor?.documentName!=='Actor' || (!actor.isOwner && !game.user.isGM)) {
    throw Error('The roller must own the target Actor.');
  }
  if(!soSaveId(data.saveType)||!soText(data.sourceItemUuid)) {
    throw Error('Save type and source Item UUID are required.');
  }
  const options={...(data.options??{}),
    pf1aeSave:{sourceItemUuid:data.sourceItemUuid,helper:true}};
  const nativeResult=await actor.rollSavingThrow(data.saveType,options);
  if(!nativeResult)return {
    nativeResult:null,processed:false,reason:'native save cancelled'
  };
  const originalMessage=game.messages?.get(nativeResult.id)??nativeResult;
  if(!soText(originalMessage?.id,100) ||
     (originalMessage.documentName&&originalMessage.documentName!=='ChatMessage')) {
    return {
      nativeResult,processed:false,reason:'native save did not create a chat message',
      normalTotal:soMessageTotal(nativeResult),effectiveTotal:null
    };
  }
  const payload={
    channel:SO_CHANNEL,op:'roll',userId:game.user.id,
    requestId:foundry.utils.randomID(),actorUuid:actor.uuid,
    saveType:data.saveType,sourceItemUuid:data.sourceItemUuid,
    targetTokenUuid:options.token?.uuid??actor.token?.uuid??null,
    messageId:originalMessage.id
  };
  const decision=await soAwaitResolution(payload);
  if(!decision) {
    soLog('Roll was not resolved by elected GM',{
      messageId:originalMessage.id,sourceItemUuid:data.sourceItemUuid});
    return {
      nativeResult,processed:false,reason:'GM could not validate the native chat roll',
      normalTotal:soMessageTotal(originalMessage),effectiveTotal:null
    };
  }
  return {nativeResult,processed:true,...decision};
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
    getResultForMessage:messageId=>{
      const message=game.messages?.get(messageId);
      return message?.getFlag?.(SO_NS,'saveOverride')??null;
    },
    _onGroupRemoved:soOnGroupRemoved
  });
  game.socket.on(SO_SOCKET,data=>{if(data?.channel===SO_CHANNEL)
    void soHandleSocket(data);});
});
