/** Generic persistent automation services. Foundry VTT v13. No class rules. */
const NS = 'pf1-automation-engine';
const REG = 'eventRegistry';
const TIMERS = 'timerRegistry';
const ENABLED = 'genericEnabled';
const DEBUG = 'genericDebug';
const EVENT_TYPES = new Set(['updateActor','updateItem','createItem','deleteItem','createActiveEffect','updateActiveEffect','deleteActiveEffect','ready','combatTurnChange','pf1PreActorRest','pf1ActorRest']);
const REST_EVENTS = new Set(['pf1PreActorRest','pf1ActorRest']);
const activeRuns = new Set();
const activeActorRuns = new Set();
const activeActorCompletion = new Map();
const processed = new Set();
const queues = new Map();
const uid = () => foundry.utils.randomID();
const log = (...args) => { if (game.settings.get(NS, DEBUG)) console.debug(`${NS} |`, ...args); };
const primary = () => game.users.filter(u=>u.active && u.isGM).sort((a,b)=>a.id.localeCompare(b.id))[0];
const leader = () => primary()?.id === game.user.id;
const enabled = () => !game.modules.get('pf1-combat-automation')?.active && game.settings.get(NS, ENABLED);
const getRegistry = () => game.settings.get(NS, REG) ?? [];
const getTimers = () => game.settings.get(NS, TIMERS) ?? [];
const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const safeText = (s, max=200) => typeof s === 'string' && s.length > 0 && s.length <= max;
const clone = o => foundry.utils.deepClone(o);
const normalizeUUID = doc => doc?.uuid ?? (typeof doc === 'string' ? doc : null);
const actorFor = doc => doc?.documentName === 'Actor' ? doc : doc?.actor ?? doc?.parent?.actor ?? (doc?.parent?.documentName === 'Actor' ? doc.parent : null);
const paths = (obj, prefix='') => {
  if (!obj || typeof obj !== 'object') return prefix ? [prefix] : [];
  return Object.entries(obj).flatMap(([k,v])=> paths(v, prefix ? `${prefix}.${k}` : k).length ? paths(v, prefix ? `${prefix}.${k}` : k) : [prefix ? `${prefix}.${k}` : k]);
};
function isMatch(rule, ev) {
  if (rule.on !== ev.type) return false;
  const f = rule.filter ?? {};
  if (f.actorUuid && f.actorUuid !== ev.actorUuid) return false;
  if (f.documentUuid && f.documentUuid !== ev.documentUuid) return false;
  if (f.itemUuid && f.itemUuid !== ev.itemUuid) return false;
  if (f.tag) {
    const tags = ev.document?.getFlag?.(NS,'tags') ?? [];
    if (!Array.isArray(tags) || !tags.includes(f.tag)) return false;
  }
  if (f.properties?.length && !f.properties.some(p=>ev.changedPaths.some(c=>c===p || c.startsWith(`${p}.`) || p.startsWith(`${c}.`)))) return false;
  if (f.buffState && f.buffState !== ev.buffState) return false;
  // Rest conditions are a subscription filter, NOT Pathfinder rest rules.
  // Native PF1 options control health and daily recharge independently.
  if (f.rest) {
    const r=ev.rest;
    if (!r) return false;
    if (f.rest.minHours!=null && !(r.hours>=f.rest.minHours)) return false;
    if (f.rest.maxHours!=null && !(r.hours<=f.rest.maxHours)) return false;
    for (const name of ['restoreHealth','restoreDailyUses','atLeastEightHours','isFullRest']) {
      if (f.rest[name]!=null && r[name]!==f.rest[name]) return false;
    }
    if (f.rest.kind && r.kind!==f.rest.kind) return false;
  }
  return true;
}
function serialize(ev) { return { type:ev.type, actorUuid:ev.actorUuid, itemUuid:ev.itemUuid, documentUuid:ev.documentUuid, changedPaths:ev.changedPaths, buffState:ev.buffState, round:ev.round, combatId:ev.combatId, combatantId:ev.combatantId, phase:ev.phase ?? null, timing:ev.timing ?? null, rest:ev.rest ? clone(ev.rest) : null }; }
function appendQueue(key, fn) {
  const last = queues.get(key) ?? Promise.resolve();
  const next = last.catch(()=>{}).then(fn);
  queues.set(key,next);
  next.finally(()=>{ if(queues.get(key)===next) queues.delete(key); }).catch(()=>{});
  return next;
}
function actionScript(item, actionId) {
  // Different PF1 builds may store scripts in different action fields.
  const actions = item.system?.actions;
  const list = Array.isArray(actions) ? actions : Object.values(actions ?? {});
  const action = list.find(a=>a?._id===actionId || a?.id===actionId || a?.name===actionId);
  if (!action) throw Error(`Action PF1 introuvable (${actionId}) sur ${item.name}`);
  const candidates = [action.script?.command, action.script?.code, action.script, action.command, action.data?.script?.command];
  const code = candidates.find(c=>typeof c==='string' && c.trim());
  if (!code) throw Error(`Script introuvable pour l'action ${actionId}. Vérifier le champ dans la version PF1 installée.`);
  return code;
}
// PF1 11.11: script-call entries are ItemScriptCall models in item.scriptCalls.
const CATEGORIES = {use:'use',afterUse:'postUse',postUse:'postUse',toggle:'toggle'};
function scriptCall(item, entry) {
  const category = CATEGORIES[entry.scriptCategory];
  if (!category) throw Error(`Catégorie PF1 inconnue : ${entry.scriptCategory}`);
  const calls = item.scriptCalls;
  const list = calls?.contents ?? (typeof calls?.values === 'function' ? [...calls.values()] : Array.isArray(calls) ? calls : item.system?.scriptCalls ?? []);
  const matches = list.filter(c => c.category === category &&
    (c.id === entry.scriptId || c._id === entry.scriptId || c.name === entry.scriptId));
  if (!matches.length) throw Error(`Appel de script PF1 '${entry.scriptId}' (${category}) introuvable sur ${item.name}`);
  if (matches.length !== 1) throw Error(`Nom de script ambigu : ${entry.scriptId} (${matches.length} correspondances). Utiliser son ID.`);
  const call = matches[0];
  if (typeof call.execute !== 'function') throw Error(`Le script ${entry.scriptId} n'est pas un modèle PF1 exécutable`);
  return call;
}
function resolveTarget(item, entry) {
  if (entry.scriptId) return scriptCall(item,entry);
  return actionScript(item,entry.actionId);
}
async function runHandler(entry, ev) {
  const key = entry.id;
  if (activeRuns.has(key)) {log('Récursion évitée',key);return;}
  if (entry.autoSourceUuid && !await game.modules.get(NS)?.api?.discovery?.stillApproved(entry)) {log('Approbation absente ou périmée',entry.id);return;}
  const item = await fromUuid(entry.itemUuid);
  if (!item || item.documentName !== 'Item') {console.warn(NS,'Item de script introuvable',entry.itemUuid);return;}
  const actor = actorFor(item) ?? (entry.actorUuid ? await fromUuid(entry.actorUuid) : null);
  if (!actor) {console.warn(NS,'Actor de script introuvable',entry.id);return;}
  // Script code is GM-approved. Never accept arbitrary code in event payload.
  // Rest notifications must NOT be lost when PF1's own actor update has
  // another registered callback in flight. Regular update hooks still use
  // the existing recursion guard.
  if (REST_EVENTS.has(ev.type)) {
    while (activeActorRuns.has(actor.uuid)) {
      const pending=activeActorCompletion.get(actor.uuid);
      if (!pending) break;
      await pending;
    }
  }
  if (activeActorRuns.has(actor.uuid)) {log('Cycle d’acteur évité',actor.uuid);return;}
  activeRuns.add(key);
  activeActorRuns.add(actor.uuid);
  let releaseActor;
  activeActorCompletion.set(actor.uuid,new Promise(resolve => {releaseActor=resolve;}));
  try {
    const scriptEvent = Object.freeze(clone(serialize(ev)));
    if (entry.scriptId) {
      const call = scriptCall(item, entry);
      // PF1's own execution path sets actor/item/token via the Macro delegate.
      // Only this call is run; item.use() and item.executeScriptCalls() are not invoked.
      await call.execute({action:null}, {event:scriptEvent, state:ev.buffState ?? null, api:game.modules.get(NS).api.generic});
    } else {
      const code = actionScript(item, entry.actionId);
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const fn = new AsyncFunction('actor','item','event','api','token','game','canvas','ui','ChatMessage','foundry', `"use strict";\n${code}`);
      await fn.call(null, actor, item, scriptEvent, game.modules.get(NS).api.generic, actor.getActiveTokens?.()[0] ?? null, game, canvas, ui, ChatMessage, foundry);
    }
    log('Script exécuté',entry.id,ev.type);
  } catch(err) {console.error(`${NS} | Échec script ${entry.id}`,err);} finally {
    activeRuns.delete(key);
    activeActorRuns.delete(actor.uuid);
    activeActorCompletion.delete(actor.uuid);
    releaseActor?.();
  }
}
async function dispatch(ev) {
  if (!enabled() || !leader()) return;
  if (ev.actorUuid && activeActorRuns.has(ev.actorUuid) && !REST_EVENTS.has(ev.type)) return;
  const discovery = game.modules.get(NS)?.api?.discovery;
  await discovery?.ensureScanned();
  const matched = [...getRegistry(), ...(discovery?.listApproved() ?? [])].filter(r=>isMatch(r,ev));
  for (const entry of matched) await appendQueue(entry.id,()=>runHandler(entry,ev));
}
function event(type,doc,change={}) {
  const a = actorFor(doc);
  const item = doc?.documentName === 'Item' ? doc : null;
  const pathsChanged = paths(change);
  const disabled = change?.disabled;
  return { type, document:doc, documentUuid:doc?.uuid ?? null, actorUuid:a?.uuid ?? null, itemUuid:item?.uuid ?? null, changedPaths:pathsChanged, buffState: type.includes('ActiveEffect') ? (type === 'createActiveEffect' ? 'active' : type === 'deleteActiveEffect' ? 'inactive' : disabled===true ? 'inactive' : disabled===false ? 'active' : null) : null };
}
function validateRule(data) {
  if (!obj(data) || !safeText(data.id,300) || !EVENT_TYPES.has(data.on)) throw Error('Déclaration événement invalide');
  if (!safeText(data.itemUuid,300) || !(safeText(data.actionId,120) !== safeText(data.scriptId,120))) throw Error('Item et exactement un de actionId/scriptId requis');
  if(data.scriptId && !CATEGORIES[data.scriptCategory]) throw Error('Catégorie de script invalide (use, postUse, afterUse ou toggle)');
  const f = data.filter ?? {};
  if (!obj(f)) throw Error('Filtre invalide');
  for (const k of Object.keys(f)) if (!['actorUuid','documentUuid','itemUuid','tag','properties','buffState','rest'].includes(k)) throw Error(`Filtre inconnu ${k}`);
  if (f.properties && (!Array.isArray(f.properties) || f.properties.length>30 || f.properties.some(p=>!safeText(p,150)))) throw Error('Propriétés invalides');
  if (f.rest != null) {
    if (!REST_EVENTS.has(data.on) || !obj(f.rest)) throw Error('Le filtre rest exige un événement de repos.');
    for (const k of Object.keys(f.rest)) {
      if (!['minHours','maxHours','restoreHealth','restoreDailyUses','atLeastEightHours','isFullRest','kind'].includes(k)) {
        throw Error(`Filtre rest inconnu : ${k}`);
      }
    }
    for (const k of ['minHours','maxHours']) {
      if (f.rest[k]!=null && (!Number.isFinite(f.rest[k]) || f.rest[k]<0 || f.rest[k]>8760)) {
        throw Error(`Durée de repos invalide : ${k}`);
      }
    }
    if (f.rest.minHours!=null && f.rest.maxHours!=null && f.rest.maxHours<f.rest.minHours) {
      throw Error('minHours doit être inférieur ou égal à maxHours.');
    }
    for (const k of ['restoreHealth','restoreDailyUses','atLeastEightHours','isFullRest']) {
      if (f.rest[k]!=null && typeof f.rest[k]!=='boolean') throw Error(`Filtre rest invalide : ${k}`);
    }
    if (f.rest.kind!=null && !['full','partial','dailyRecharge','none'].includes(f.rest.kind)) {
      throw Error('Type de repos inconnu.');
    }
  }
  return {id:data.id,on:data.on,itemUuid:data.itemUuid,actionId:data.actionId??null,scriptId:data.scriptId??null,scriptCategory:data.scriptCategory??null,actorUuid:data.actorUuid??null,filter:clone(f)};
}
function requireGM() { if (!game.user.isGM) throw Error('Opération réservée au MJ'); if (!leader()) throw Error('Utiliser le MJ principal actif'); }
async function register(data) {
  requireGM(); const r=validateRule(data);
  const item = await fromUuid(r.itemUuid);
  if (item?.documentName !== 'Item') throw Error('Item de script introuvable');
  resolveTarget(item,r);
  const list=getRegistry().filter(x=>x.id!==r.id);list.push(r);
  await game.settings.set(NS, REG, list);
  return r.id;
}
async function unregister(id) {requireGM();await game.settings.set(NS,REG,getRegistry().filter(x=>x.id!==id));}
function validTimer(data) {
  if (!obj(data)||!safeText(data.id,100)||!safeText(data.itemUuid,300)||!(safeText(data.actionId,120) !== safeText(data.scriptId,120))) throw Error('Minuteur invalide');
  if(data.scriptId && !CATEGORIES[data.scriptCategory]) throw Error('Catégorie de script invalide');
  if (!['rounds','turns'].includes(data.unit)||!Number.isInteger(data.amount)||data.amount<1||data.amount>10000) throw Error('Durée invalide');
  const combat = data.combatId ? game.combats.get(data.combatId) : game.combat;
  if (!combat?.started) throw Error('Combat actif requis');
  const combattant = data.combatantId ? combat.combatants.get(data.combatantId) : combat.combatant;
  if (!combattant) throw Error('Combattant requis');
  if (data.unit==='turns' && !combattant) throw Error('Combattant requis pour les tours');
  return {id:data.id,itemUuid:data.itemUuid,actionId:data.actionId??null,scriptId:data.scriptId??null,scriptCategory:data.scriptCategory??null,actorUuid:normalizeUUID(data.actorUuid)??combattant.actor?.uuid??null,combatId:combat.id,combatantId:combattant.id,unit:data.unit,amount:data.amount,remaining:data.amount,createdRound:combat.round,createdTurn:combat.turn,lastPosition:`${combat.round}:${combat.turn}`};
}
async function schedule(data) {
  requireGM(); const timer=validTimer(data);
  const item=await fromUuid(timer.itemUuid);if(!item||item.documentName!=='Item')throw Error('Item introuvable');resolveTarget(item,timer);
  return appendQueue('__pf1_timer_write__',async()=>{
    const list=getTimers().filter(t=>t.id!==timer.id);list.push(timer);
    await game.settings.set(NS,TIMERS,list);return timer.id;
  });
}
async function cancelTimer(id) {
  requireGM();
  return appendQueue('__pf1_timer_write__',async()=>{
    const existing=getTimers();
    if(existing.some(t=>t.id===id)) await game.settings.set(NS,TIMERS,existing.filter(t=>t.id!==id));
  });
}
/**
 * Turn boundaries (Foundry v13): combatTurnChange is fired AFTER the database update.
 * We deliberately count combatant IDs, not initiative list indexes, so reordering
 * initiatives or skipping a defeated combatant doesn't redirect an expiration.
 *
 * No PF1 class rules in this file. One timer targets ONE approved script OR ONE
 * PF1 buff / ActiveEffect document. Writes are GM-only and persistent in TIMERS.
 */
const TURN_TIMINGS = new Set(['endOfCurrentTurn','startOfNextTurn','endOfNextTurn','turnStart','turnEnd']);
const EFFECT_ACTIONS = new Set(['disable','delete']);

function resolveCombat(data) {
  const combat = data.combatId ? game.combats.get(data.combatId) : game.combat;
  if (!combat?.started) throw Error('Combat démarré requis pour une expiration en phase de tour.');
  const combattant = data.combatantId ? combat.combatants.get(data.combatantId) : combat.combatant;
  if (!combattant) throw Error('Combattant de référence introuvable dans le combat.');
  return {combat, combattant};
}

/** Validate that a document is an expirable ActiveEffect or a native PF1 buff. */
function isExpirable(doc) {
  return doc?.documentName === 'ActiveEffect' || (doc?.documentName === 'Item' && doc.type === 'buff');
}

/**
 * Absolute, durable round deadline for phase timers. It is calculated ONCE
 * from the casting turn and is never derived from the combat's current round
 * again on reconnect. A remaining-hit counter alone can lose a transition
 * while no elected GM client is listening.
 */
function targetPhaseRound(combat, combattant, phase, amount, createdTurn=combat.turn, createdRound=combat.round) {
  const index = combat.turns?.findIndex(c=>c.id===combattant.id) ?? -1;
  if (index<0 || !Number.isInteger(createdTurn) || !Number.isInteger(createdRound)) return null;
  const active = index===createdTurn;
  const laterThisRound = index>createdTurn;
  const first = phase==='turnStart'
    ? createdRound+(active || !laterThisRound ? 1 : 0)
    : createdRound+(!active && !laterThisRound ? 1 : 0);
  return first + amount - 1;
}
/** Safely backfill an absolute deadline for phase timers written in v1.6/v1.7. */
function getTargetRound(timer,combat) {
  if (Number.isInteger(timer.targetRound)) return timer.targetRound;
  if (timer.unit!=='phase' || !Number.isInteger(timer.createdRound) || !Number.isInteger(timer.createdTurn)) return null;
  const combattant=combat?.combatants?.get(timer.combatantId);
  if (!combattant) return null;
  return targetPhaseRound(combat,combattant,timer.phase,timer.amount,timer.createdTurn,timer.createdRound);
}
function pastTargetPhase(timer,combat) {
  const target=getTargetRound(timer,combat);
  if (!Number.isInteger(target) || !combat?.started) return false;
  if (combat.round>target) return true;
  if (combat.round<target) return false;
  const index=combat.turns?.findIndex(c=>c.id===timer.combatantId) ?? -1;
  return index>=0 && Number.isInteger(combat.turn) &&
    (timer.phase==='turnStart' ? combat.turn>=index : combat.turn>index);
}
function phaseConfig(timing, combat, combattant, occurrences) {
  if (!TURN_TIMINGS.has(timing)) throw Error(`Moment d'expiration inconnu : ${timing}`);
  const active = combat.combatant?.id === combattant.id;
  if (timing === 'endOfCurrentTurn') {
    if (!active) throw Error('endOfCurrentTurn exige que le combattant choisi joue actuellement.');
    return {phase:'turnEnd', amount:1};
  }
  if (timing === 'startOfNextTurn') return {phase:'turnStart', amount:1};
  if (timing === 'endOfNextTurn') return {phase:'turnEnd', amount:active ? 2 : 1};
  if (!Number.isInteger(occurrences) || occurrences < 1 || occurrences > 10000) {
    throw Error('occurrences doit être un entier de 1 à 10000.');
  }
  return {phase:timing,amount:occurrences};
}

/**
 * Schedule a precise start/end boundary for a script callback OR an effect.
 * - Script: itemUuid + one of actionId or scriptId (+ scriptCategory).
 * - Effect: effectUuid for a PF1 buff or an ActiveEffect, default disable.
 * Use an explicit unique id: scheduling the same id replaces the old timer.
 * The write must originate with the elected GM, never from a player socket.
 */
async function scheduleTurn(data) {
  requireGM();
  if (!obj(data) || !safeText(data.id,100)) throw Error('Identifiant du minuteur invalide.');
  const {combat, combattant} = resolveCombat(data);
  const timing = data.timing ?? 'startOfNextTurn';
  const {phase,amount} = phaseConfig(timing,combat,combattant,data.occurrences ?? 1);
  const effectMode = data.effectUuid !== undefined && data.effectUuid !== null;
  const groupMode = data.effectGroupId !== undefined && data.effectGroupId !== null;
  if (effectMode && groupMode) throw Error('Choisir un effet OU un groupe, jamais les deux.');
  let target;
  if (groupMode) {
    if (!safeText(data.effectGroupId,100) || data.itemUuid || data.actionId || data.scriptId) {
      throw Error('Une expiration de groupe exige effectGroupId seul.');
    }
    const groups = game.modules.get(NS)?.api?.effectGroups;
    if (!groups?.validateGroupTimer) throw Error('Gestionnaire de groupes indisponible.');
    groups.validateGroupTimer(data.effectGroupId, combat.id, combattant.id);
    target = {effectGroupId:data.effectGroupId};
  } else if (effectMode) {
    if (!safeText(data.effectUuid,400) || data.itemUuid || data.scriptId || data.actionId) {
      throw Error('Une expiration d’effet exige effectUuid, sans script associé.');
    }
    const action=data.effectAction ?? 'disable';
    if (!EFFECT_ACTIONS.has(action)) throw Error('effectAction inconnu : disable ou delete.');
    const effect = await fromUuid(data.effectUuid);
    if (!isExpirable(effect)) throw Error(`Effet temporaire introuvable ou incompatible : ${data.effectUuid}`);
    if (effect.documentName === 'Item' && action === 'delete') {
      throw Error('La suppression d’un objet buff est interdite : utiliser effectAction: disable.');
    }
    if (!effect.parent || !actorFor(effect)) {
      throw Error('Effet sans acteur propriétaire : ne pas expirer un modèle d’objet ou de compendium.');
    }
    target = {effectUuid:data.effectUuid,effectAction:action};
  } else {
    if (!safeText(data.itemUuid,400) || !(safeText(data.actionId,120) !== safeText(data.scriptId,120))) {
      throw Error('Le minuteur exige effectUuid OU itemUuid et un seul script (actionId/scriptId).');
    }
    if (data.scriptId && !CATEGORIES[data.scriptCategory]) throw Error('Catégorie PF1 invalide.');
    const item = await fromUuid(data.itemUuid);
    if (item?.documentName !== 'Item') throw Error(`Objet de script introuvable : ${data.itemUuid}`);
    resolveTarget(item,data);
    if (!actorFor(item) && !data.actorUuid) throw Error('Le script exige un acteur ou actorUuid.');
    target = {itemUuid:data.itemUuid,actionId:data.actionId??null,scriptId:data.scriptId??null,
      scriptCategory:data.scriptCategory??null,actorUuid:normalizeUUID(data.actorUuid)??combattant.actor?.uuid??null};
  }
  const timer = {
    id:data.id,unit:'phase',timing,phase,amount,remaining:amount,
    combatId:combat.id,combatantId:combattant.id,
    createdRound:combat.round,createdTurn:combat.turn,
    targetRound:targetPhaseRound(combat,combattant,phase,amount),
    lastPosition:`${combat.round}:${combat.turn}`,
    ...target
  };
  return appendQueue('__pf1_timer_write__',async()=>{
    const old=getTimers();
    await game.settings.set(NS,TIMERS,[...old.filter(t=>t.id!==timer.id),timer]);
    return timer.id;
  });
}

/** Extend a pending phase timer without creating new effects or resetting its anchor. */
async function extendTimer(id,{rounds=1}={}) {
  requireGM();
  if (!safeText(id,100) || !Number.isInteger(rounds) || rounds<1 || rounds>10000) {
    throw Error('Identifiant de minuteur ou nombre de rounds invalide.');
  }
  return appendQueue('__pf1_timer_write__',async()=>{
    const timers=getTimers();
    const index=timers.findIndex(t=>t.id===id);
    if (index<0) throw Error(`Minuteur à prolonger introuvable : ${id}`);
    const timer=timers[index];
    if (timer.unit!=='phase' || timer.due) throw Error('Seul un minuteur de phase non expiré peut être prolongé.');
    const combat=game.combats.get(timer.combatId);
    if (!combat?.started || !combat.combatants.get(timer.combatantId)) throw Error('Combat ou combattant de référence introuvable.');
    const prior=getTargetRound(timer,combat);
    if (!Number.isInteger(prior) || pastTargetPhase(timer,combat)) {
      throw Error('Échéance déjà passée ou non reconstructible.');
    }
    const targetRound=prior+rounds;
    if (targetRound>100000000) throw Error('Échéance trop lointaine.');
    // The current copies, group identity and template approval remain untouched.
    const updated={...timer,targetRound,remaining:Math.max(1,Number(timer.remaining)||1)+rounds};
    const next=[...timers];next[index]=updated;
    await game.settings.set(NS,TIMERS,next);
    return {extended:true,id,rounds,targetRound,effectGroupId:timer.effectGroupId??null};
  });
}

/**
 * An independently-timed SaveOutcome has a strong, source-bound identity.
 * Never infer module ownership from an effect name, a PF1 status, or a timer
 * pointing at an arbitrary document. Legacy v1.13+ outcomes have these flags.
 */
function isManagedTimedOutcome(effect,timerId=null) {
  if (effect?.documentName!=='ActiveEffect' || !actorFor(effect)) return false;
  const flag=key=>effect.getFlag?.(NS,key) ?? effect.flags?.[NS]?.[key];
  const id=flag('timerId');
  return safeText(id,100) && id.startsWith('outcome:') &&
    (timerId===null || id===timerId) &&
    safeText(flag('outcomeId'),150) && safeText(flag('outcomeRuleId'),300) &&
    safeText(flag('sourceUuid'),400) && safeText(flag('sourceItemUuid'),400) &&
    safeText(flag('sourceActionId'),120) && safeText(flag('key'),80) &&
    !flag('effectGroupId') && effect.origin===flag('sourceItemUuid');
}
async function cleanupCombatEffectTimer(timer) {
  const effect=await fromUuid(timer.effectUuid);
  if (!effect) {
    // Distinguish a deleted effect from an actor which cannot currently be
    // resolved (e.g. an unlinked token on an unloaded scene).
    const marker='.ActiveEffect.',at=timer.effectUuid?.lastIndexOf(marker)??-1;
    if(at>=0) {
      const actor=await fromUuid(timer.effectUuid.slice(0,at));
      const effectId=timer.effectUuid.slice(at+marker.length);
      if(actor?.documentName==='Actor' && !actor.effects?.get(effectId))
        return {complete:true,alreadyRemoved:true};
    }
    return {complete:false,reason:'target temporarily unresolved'};
  }
  if (!isManagedTimedOutcome(effect,timer.id)) {
    console.warn(`${NS} | Refus de suppression : effectUuid non reconnu comme outcome PF1AE`,
      {timerId:timer.id,effectUuid:timer.effectUuid});
    return {complete:true,refused:true}; // retire seulement notre minuteur
  }
  try {
    await effect.delete({[NS]:{skip:true}});
    log('Condition indépendante nettoyée lors de la fin de combat',timer.id,effect.uuid);
    return {complete:true};
  } catch(error) {
    console.warn(`${NS} | Suppression de condition reportée`,timer.id,error);
    return {complete:false,reason:error?.message};
  }
}
/** On combat closure only document timers may clean documents. A callback
 * timer is cancelled, NEVER dispatched or evaluated against a removed combat.
 * Keep failed cleanup timers in persistent storage for later reconnection.
 */
async function cleanupCombatTimersInternal(combatId,reason='deleteCombat') {
  if (!leader() || !enabled() || !safeText(combatId,100)) return;
  const snapshot=getTimers();
  const affected=snapshot.filter(t=>t.combatId===combatId);
  const keep=[];
  for (const t of affected) {
    if (!leader()) return;
    if (t.effectGroupId) {
      const groups=game.modules.get(NS)?.api?.effectGroups;
      if (!groups?.expireGroup) {
        keep.push({...t,cleanupPending:true});continue;
      }
      try {
        await groups.expireGroup(t.effectGroupId,{fromTimer:true});
      } catch(error) {
        console.warn(`${NS} | Nettoyage de groupe différé`,t.id,error);
        keep.push({...t,cleanupPending:true});
      }
    } else if (t.effectUuid) {
      const result=await cleanupCombatEffectTimer(t);
      if (!result.complete) keep.push({...t,cleanupPending:true});
    } else {
      // PF1 Item Script Call timer: cancel, never execute on combat deletion.
      log('Minuteur de script annulé sans exécution',t.id,reason);
    }
  }
  // effectGroups may have persisted a group whose timer was already absent.
  const groups=game.modules.get(NS)?.api?.effectGroups;
  for (const group of groups?.listGroups?.()??[]) {
    if (group.combatId!==combatId || affected.some(t=>t.effectGroupId===group.id)) continue;
    try {await groups.expireGroup(group.id,{fromTimer:true});}
    catch(error){console.warn(`${NS} | Groupe sans minuteur : nettoyage différé`,group.id,error);}
  }
  const ids=new Set(affected.map(t=>t.id));
  const next=[...getTimers().filter(t=>!ids.has(t.id)),...keep];
  if (affected.length) await game.settings.set(NS,TIMERS,next);
  log('Nettoyage de combat terminé',{combatId,reason,timers:affected.length,pending:keep.length});
}
function cleanupCombatTimers(combatId,reason) {
  if(!leader()||!enabled())return Promise.resolve();
  return appendQueue('__pf1_timer_write__',()=>cleanupCombatTimersInternal(combatId,reason));
}
/** A v1.16.2 deleteCombat could discard an outcome timer before deleting
 * its ActiveEffect. Scan only strongly flagged managed independent outcomes
 * whose timer ID is missing from BOTH persistent timer registries. This is
 * intentionally conservative; missing scenes can be retried on canvasReady.
 */
async function cleanupLegacyOrphanedOutcomesInternal() {
  if(!leader()||!enabled())return {removed:0,deferred:0};
  const duration=game.modules.get(NS)?.api?.duration;
  if(typeof duration?.listTimers!=='function')return {removed:0,deferred:0};
  const registered=new Set([...getTimers().map(t=>t.id),
    ...duration.listTimers().map(t=>t.id)]);
  const actors=new Map();
  const addActor=actor=>{if(actor?.documentName==='Actor' && actor.uuid)actors.set(actor.uuid,actor);};
  for(const actor of game.actors?.values?.()??[])addActor(actor);
  for(const scene of game.scenes?.values?.()??[]) {
    for(const token of scene.tokens?.values?.()??[]) {
      if(token.actorLink===false)addActor(token.actor);
    }
  }
  let removed=0,deferred=0;
  for (const actor of actors.values()) {
    for (const effect of actor.effects?.values?.()??[]) {
      if(!isManagedTimedOutcome(effect) || registered.has(effect.getFlag?.(NS,'timerId')??effect.flags?.[NS]?.timerId))continue;
      // A freshly-created outcome may not have scheduled its timer yet.
      // Do not race the createEmbeddedDocuments -> scheduleTurn transaction.
      const createdAt=Number(effect._stats?.createdTime??effect._source?._stats?.createdTime);
      if(!Number.isFinite(createdAt) || Date.now()-createdAt<30000) {
        deferred++;log('Orphelin potentiel : création récente ou date inconnue',effect.uuid);continue;
      }
      try {
        await effect.delete({[NS]:{skip:true}});removed++;
        log('Ancienne condition orpheline nettoyée',effect.uuid);
      }catch(error){deferred++;console.warn(`${NS} | Orphelin conservé pour nouvel essai`,effect.uuid,error);}
    }
  }
  return {removed,deferred};
}
function recoverCombatCleanup() {
  if(!leader()||!enabled())return Promise.resolve();
  return appendQueue('__pf1_timer_write__',async()=>{
    const closures=new Set(getTimers().filter(t=>t.combatId &&
      (t.cleanupPending || !game.combats?.get?.(t.combatId)?.started))
      .map(t=>t.combatId));
    // Older versions may have deleted a group timer but left its group.
    // Reconcile the group ledger independently of the timer registry.
    const groups=game.modules.get(NS)?.api?.effectGroups;
    for(const group of groups?.listGroups?.()??[]) {
      if(group.combatId && !game.combats?.get?.(group.combatId)?.started)
        closures.add(group.combatId);
    }
    for(const combatId of closures) await cleanupCombatTimersInternal(combatId,'reconnect/reconcile');
    await cleanupLegacyOrphanedOutcomesInternal();
  });
}
/** Convenience wrapper for a direct effect expiration; no script will execute. */
async function expireEffectAt(data) {
  if (!obj(data)) throw Error('Options d’expiration invalides.');
  if (!safeText(data.effectUuid,400)) throw Error('effectUuid est requis.');
  return scheduleTurn(data);
}

function isForward(prior,current) {
  return Number.isInteger(prior?.round) && Number.isInteger(current?.round) &&
    Number.isInteger(prior?.turn) && Number.isInteger(current?.turn) &&
    (current.round > prior.round || (current.round === prior.round && current.turn > prior.turn));
}

/** The callback is due on a transition, not at the moment it is registered. */
function phaseHit(t,prior,current) {
  return t.phase === 'turnEnd' ? prior.combatantId === t.combatantId :
    t.phase === 'turnStart' ? current.combatantId === t.combatantId : false;
}

async function canExecuteTimer(t) {
  try {
    if (t.effectGroupId) {
      const groups=game.modules.get(NS)?.api?.effectGroups;
      return !!groups && await groups.canExpireGroup(t.effectGroupId);
    }
    if (t.effectUuid) {
      const effect=await fromUuid(t.effectUuid);
      return isExpirable(effect) && !!actorFor(effect);
    }
    const item=await fromUuid(t.itemUuid);
    if (item?.documentName !== 'Item') return false;
    const actor=actorFor(item) ?? (t.actorUuid ? await fromUuid(t.actorUuid) : null);
    return actor?.documentName === 'Actor';
  } catch(error) {
    log('Cible temporairement indisponible',t.id,error);
    return false;
  }
}

async function executeTimer(t,combat) {
  if (!leader() || !enabled()) return;
  if (t.effectGroupId) {
    const groups=game.modules.get(NS)?.api?.effectGroups;
    if (!groups?.expireGroup) throw Error('Service de groupes temporairement indisponible.');
    await groups.expireGroup(t.effectGroupId,{fromTimer:true});
    log('Groupe expiré',t.id,t.effectGroupId,t.phase);
    return;
  }
  if (t.effectUuid) {
    const effect=await fromUuid(t.effectUuid);
    if (!isExpirable(effect)) return;
    if (t.id?.startsWith('outcome:') && !isManagedTimedOutcome(effect,t.id)) {
      console.warn(`${NS} | Minuteur outcome non propriétaire, suppression refusée`,t.id,t.effectUuid);
      return;
    }
    try {
      // PF1 ItemBuffPF.setActive is the native way to switch a buff off.
      if (effect.documentName === 'Item') {
        if (effect.type !== 'buff') throw Error('Seuls les Items PF1 de type buff peuvent être désactivés.');
        if (effect.activeState === false || effect.system?.active === false) return;
        if (typeof effect.setActive === 'function') {
          await effect.setActive(false,{[NS]:{skip:true}});
        } else {
          await effect.update({'system.active':false},{[NS]:{skip:true}});
        }
      } else if (t.effectAction === 'delete') {
        await effect.delete({[NS]:{skip:true}});
      } else if (!effect.disabled) {
        await effect.update({disabled:true},{[NS]:{skip:true}});
      }
      log('Effet expiré',t.id,t.effectUuid,t.phase);
    } catch(error) {console.error(`${NS} | Expiration de l'effet ${t.id} impossible`,error);throw error;}
    return;
  }
  await runHandler(t,{
    type:'expiry',phase:t.phase,timing:t.timing,round:combat?.round ?? null,
    combatId:t.combatId,combatantId:t.combatantId,
    actorUuid:t.actorUuid ?? null,itemUuid:t.itemUuid,documentUuid:t.itemUuid,
    changedPaths:[],buffState:null
  });
}

/**
 * Handles expired callbacks from a previous session whose document was missing
 * when their turn elapsed. Keep them queued until the document comes back.
 * The timer is removed from world settings before side effects are executed,
 * preventing duplicate callbacks when two clients see the same transition.
 */
async function runDueTimers(list,combat,forceWrite=false) {
  const keep=[]; const ready=[];
  for (const timer of list) {
    if (!timer.due) {keep.push(timer);continue;}
    if (await canExecuteTimer(timer)) ready.push(timer);
    else keep.push(timer);
  }
  if (ready.length || forceWrite) await game.settings.set(NS,TIMERS,keep);
  const retry=[];
  for (const timer of ready) {
    try { await executeTimer(timer,combat); }
    catch(error) {
      console.error(`${NS} | Expiration ${timer.id} à réessayer`,error);
      if (timer.effectGroupId || timer.effectUuid) retry.push({...timer,due:true});
    }
  }
  if (retry.length) {
    // This code already runs inside the timer write queue; do not queue recursively.
    const current=getTimers();
    await game.settings.set(NS,TIMERS,[...current,...retry.filter(t=>!current.some(x=>x.id===t.id))]);
  }
}
async function advanceTimers(combat,prior,current) {
  if (!leader()||!enabled()) return;
  if (!isForward(prior,current)) return; // Rewinds never fire a new expiry.
  return appendQueue('__pf1_timer_write__',async()=>{
    if (!leader() || !enabled()) return;
    const cursor=`${current.round}:${current.turn}`;
    const old=getTimers();
    const updated=[];
    let changed=false;
    for (const t of old) {
      if(t.combatId!==combat.id || t.due || t.lastPosition===cursor) {updated.push(t);continue;}
      if (t.unit==='phase') {
        // For phase expirations, an absolute round is authoritative. Unlike a
        // relative hit-counter this cannot restart or drift after an F5.
        const target=getTargetRound(t,combat);
        if (Number.isInteger(target)) {
          const hit=phaseHit(t,prior,current);
          const boundaryRound=t.phase==='turnEnd'?prior.round:current.round;
          const due=(hit && boundaryRound>=target) || current.round>target;
          const next={...t,targetRound:target,lastPosition:cursor,
            remaining:due?0:Math.max(1,target-combat.round+(t.phase==='turnEnd'?1:0))};
          if (due) next.due=true;
          updated.push(next);changed=true;
          continue;
        }
      }
      const decrement=t.unit==='phase'?Number(phaseHit(t,prior,current)):
        t.unit==='rounds'?Math.max(0,current.round-prior.round):
          (prior.combatantId===t.combatantId?1:0);
      if (!decrement) {updated.push(t);continue;}
      const remaining=t.remaining-decrement;
      const next={...t,remaining,lastPosition:cursor};
      if (remaining<=0) next.due=true;
      updated.push(next);changed=true;
    }
    // Retry any previously due timer (including a document which reappeared).
    await runDueTimers(updated,combat,changed);
  });
}
/** Recheck pending expirations on F5 without advancing the combat clock. */
async function resumeDueTimers() {
  if (!leader() || !enabled()) return;
  return appendQueue('__pf1_timer_write__',async()=>{
    if (!leader() || !enabled()) return;
    const list=getTimers();
    // Reconstruct old pending timers and detect expirations whose boundary
    // elapsed while no elected GM was running. Never restart from the round
    // currently shown by the Combat Tracker after a page reload.
    let modified=false;
    const checked=list.map(t=>{
      if (t.due || t.unit!=='phase') return t;
      const combat=game.combats.get(t.combatId);
      if (!combat?.started) return t;
      const targetRound=getTargetRound(t,combat);
      if (!Number.isInteger(targetRound)) return t;
      const due=pastTargetPhase({...t,targetRound},combat);
      if (t.targetRound===targetRound && !due) return t;
      modified=true;
      return {...t,targetRound,...(due?{due:true,remaining:0}:{})};
    });
    if (modified) await game.settings.set(NS,TIMERS,checked);
    if (checked.some(t=>t.due)) await runDueTimers(checked,null);
  });
}
function install() {
  Hooks.on('updateActor',(doc,change,options)=>{if(options?.[NS]?.skip)return;void dispatch(event('updateActor',doc,change));});
  Hooks.on('updateItem',(doc,change,options)=>{if(options?.[NS]?.skip)return;void (async()=>{await game.modules.get(NS)?.api?.discovery?.changedItem(doc);await dispatch(event('updateItem',doc,change));})();});
  Hooks.on('createItem',(doc,options)=>{if(options?.[NS]?.skip)return;void (async()=>{await game.modules.get(NS)?.api?.discovery?.changedItem(doc,'create');await dispatch(event('createItem',doc));})();});
  Hooks.on('deleteItem',(doc,options)=>{if(options?.[NS]?.skip)return;void (async()=>{await dispatch(event('deleteItem',doc));await game.modules.get(NS)?.api?.discovery?.changedItem(doc,'delete');})();});
  for (const name of ['createActiveEffect','updateActiveEffect','deleteActiveEffect']) Hooks.on(name,(doc,changeOrOptions,options)=>{if((options??changeOrOptions)?.[NS]?.skip)return;void dispatch(event(name,doc,name==='updateActiveEffect'?changeOrOptions:{}));});
  Hooks.on('combatTurnChange',(combat,prior,current)=>{
    void advanceTimers(combat,prior,current);
    // Foundry v13 may provide incomplete prior turn history immediately after
    // reconnect. Do not let event dispatch itself fail on a null prior state.
    void dispatch({type:'combatTurnChange',documentUuid:combat.uuid,
      actorUuid:combat.combatants.get(prior?.combatantId)?.actor?.uuid??null,
      itemUuid:null,changedPaths:['round','turn'],round:current?.round??combat.round,
      combatId:combat.id,combatantId:prior?.combatantId??null,buffState:null});
  });
  // A fresh client can miss its first combatTurnChange after F5. The document
  // update is authoritative: recheck persisted ABSOLUTE phase deadlines once
  // the Combat's round/turn changes, independent of transition history.
  // resumeDueTimers and advanceTimers use the same serialized write queue.
  Hooks.on('updateCombat',(combat,changes)=>{
    if(!combat?.id)return;
    if (!combat.started) {
      // Also handle combats stopped without deleting the Combat document.
      void cleanupCombatTimers(combat.id,'combatStopped').catch(e=>
        console.error(`${NS} | Nettoyage d'un combat arrêté`,e));
    } else if (Object.hasOwn(changes??{},'round') || Object.hasOwn(changes??{},'turn')) {
      void resumeDueTimers();
    }
  });
  Hooks.on('deleteCombat',combat=>{void cleanupCombatTimers(combat?.id,'deleteCombat').then(()=>recoverCombatCleanup()).catch(e=>console.error(`${NS} | Erreur de nettoyage de combat`,e));});
  Hooks.on('canvasReady',()=>{void recoverCombatCleanup();});
}
Hooks.once('init',()=>{
  game.settings.register(NS,ENABLED,{name:'Activer les automatisations génériques',hint:'Active les événements persistants, synchronisations et minuteurs.',scope:'world',config:true,type:Boolean,default:true});
  game.settings.register(NS,DEBUG,{name:'Logs de diagnostic des automatisations',scope:'world',config:true,type:Boolean,default:false});
  game.settings.register(NS,REG,{scope:'world',config:false,type:Array,default:[]});
  game.settings.register(NS,TIMERS,{scope:'world',config:false,type:Array,default:[]});
  install();
});
Hooks.once('ready',async()=>{
  game.modules.get(NS).api ??= {};
  game.modules.get(NS).api.generic = Object.freeze({register,unregister,schedule,scheduleTurn,expireEffectAt,extendTimer,cancelTimer,listEvents:()=>clone(getRegistry()),listTimers:()=>clone(getTimers()),isLeader:leader,
    _recoverCombatCleanup:recoverCombatCleanup,
    _cleanupCombatTimers:cleanupCombatTimers,
    validateRule,validateTarget:async r=>{const i=await fromUuid(r.itemUuid);if(i?.documentName!=='Item')throw Error('Objet de script introuvable');return resolveTarget(i,r);},
    // Internal rest bridge. It accepts only typed PF1 rest notifications from
    // rest-automation.js; never an arbitrary script or generic event payload.
    _dispatchRestEvent: ev => {
      if (!REST_EVENTS.has(ev?.type) || !safeText(ev.actorUuid,400) ||
          ev.documentUuid!==ev.actorUuid || !obj(ev.rest)) {
        throw Error('Événement de repos interne invalide.');
      }
      return dispatch(ev);
    }});
  try { await game.modules.get(NS).api.migration?.whenReady(); }
  catch(error) { console.error(`${NS} | Automatisations suspendues : échec de migration`, error); return; }
  await game.modules.get(NS).api.discovery?.scan();
  await recoverCombatCleanup();
  await resumeDueTimers();
  if(leader()&&enabled())void dispatch({type:'ready',documentUuid:null,actorUuid:null,itemUuid:null,changedPaths:[],buffState:null});
});
