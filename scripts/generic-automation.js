/** Generic persistent automation services. Foundry VTT v13. No class rules. */
const NS = 'pf1-automation-engine';
const REG = 'eventRegistry';
const TIMERS = 'timerRegistry';
const ENABLED = 'genericEnabled';
const DEBUG = 'genericDebug';
const EVENT_TYPES = new Set(['updateActor','updateItem','createItem','deleteItem','createActiveEffect','updateActiveEffect','deleteActiveEffect','ready','combatTurnChange']);
const activeRuns = new Set();
const activeActorRuns = new Set();
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
  return true;
}
function serialize(ev) { return { type:ev.type, actorUuid:ev.actorUuid, itemUuid:ev.itemUuid, documentUuid:ev.documentUuid, changedPaths:ev.changedPaths, buffState:ev.buffState, round:ev.round, combatId:ev.combatId, combatantId:ev.combatantId, phase:ev.phase ?? null, timing:ev.timing ?? null }; }
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
  if (activeActorRuns.has(actor.uuid)) {log('Cycle d’acteur évité',actor.uuid);return;}
  activeRuns.add(key);
  activeActorRuns.add(actor.uuid);
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
  } catch(err) {console.error(`${NS} | Échec script ${entry.id}`,err);} finally {activeRuns.delete(key);activeActorRuns.delete(actor.uuid);}
}
async function dispatch(ev) {
  if (!enabled() || !leader()) return;
  if (ev.actorUuid && activeActorRuns.has(ev.actorUuid)) return;
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
  for (const k of Object.keys(f)) if (!['actorUuid','documentUuid','itemUuid','tag','properties','buffState'].includes(k)) throw Error(`Filtre inconnu ${k}`);
  if (f.properties && (!Array.isArray(f.properties) || f.properties.length>30 || f.properties.some(p=>!safeText(p,150)))) throw Error('Propriétés invalides');
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
    lastPosition:`${combat.round}:${combat.turn}`,
    ...target
  };
  return appendQueue('__pf1_timer_write__',async()=>{
    const old=getTimers();
    await game.settings.set(NS,TIMERS,[...old.filter(t=>t.id!==timer.id),timer]);
    return timer.id;
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
    } catch(error) {console.error(`${NS} | Expiration de l'effet ${t.id} impossible`,error);}
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
      if (timer.effectGroupId) retry.push({...timer,due:true});
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
    if (list.some(t=>t.due)) await runDueTimers(list,null);
  });
}
function install() {
  Hooks.on('updateActor',(doc,change,options)=>{if(options?.[NS]?.skip)return;void dispatch(event('updateActor',doc,change));});
  Hooks.on('updateItem',(doc,change,options)=>{if(options?.[NS]?.skip)return;void (async()=>{await game.modules.get(NS)?.api?.discovery?.changedItem(doc);await dispatch(event('updateItem',doc,change));})();});
  Hooks.on('createItem',(doc,options)=>{if(options?.[NS]?.skip)return;void (async()=>{await game.modules.get(NS)?.api?.discovery?.changedItem(doc,'create');await dispatch(event('createItem',doc));})();});
  Hooks.on('deleteItem',(doc,options)=>{if(options?.[NS]?.skip)return;void (async()=>{await dispatch(event('deleteItem',doc));await game.modules.get(NS)?.api?.discovery?.changedItem(doc,'delete');})();});
  for (const name of ['createActiveEffect','updateActiveEffect','deleteActiveEffect']) Hooks.on(name,(doc,changeOrOptions,options)=>{if((options??changeOrOptions)?.[NS]?.skip)return;void dispatch(event(name,doc,name==='updateActiveEffect'?changeOrOptions:{}));});
  Hooks.on('combatTurnChange',(combat,prior,current)=>{void advanceTimers(combat,prior,current);void dispatch({type:'combatTurnChange',documentUuid:combat.uuid,actorUuid:combat.combatants.get(prior.combatantId)?.actor?.uuid??null,itemUuid:null,changedPaths:['round','turn'],round:current.round,combatId:combat.id,combatantId:prior.combatantId,buffState:null});});
  Hooks.on('deleteCombat',combat=>{if(!enabled()||!leader())return;void appendQueue('__pf1_timer_write__',async()=>{const old=getTimers();if(old.some(t=>t.combatId===combat.id))await game.settings.set(NS,TIMERS,old.filter(t=>t.combatId!==combat.id));});});
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
  game.modules.get(NS).api.generic = Object.freeze({register,unregister,schedule,scheduleTurn,expireEffectAt,cancelTimer,listEvents:()=>clone(getRegistry()),listTimers:()=>clone(getTimers()),isLeader:leader,validateRule,validateTarget:async r=>{const i=await fromUuid(r.itemUuid);if(i?.documentName!=='Item')throw Error('Objet de script introuvable');return resolveTarget(i,r);}});
  try { await game.modules.get(NS).api.migration?.whenReady(); }
  catch(error) { console.error(`${NS} | Automatisations suspendues : échec de migration`, error); return; }
  await game.modules.get(NS).api.discovery?.scan();
  await resumeDueTimers();
  if(leader()&&enabled())void dispatch({type:'ready',documentUuid:null,actorUuid:null,itemUuid:null,changedPaths:[],buffState:null});
});
