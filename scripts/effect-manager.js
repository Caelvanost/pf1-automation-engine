/** PF1 Combat Automation v1.1.0 - gestion générique d'effets actifs.
 * Modèle: on duplique un ActiveEffect existant sur l'acteur source.
 * Les copies sont marquées et supprimées par ce module uniquement.
 * Les requêtes joueurs sont validées et exécutées par le MJ principal.
 */
const MODULE = 'pf1-automation-engine';
const SOCKET = `module.${MODULE}`;
const SCOPE = MODULE;
const STATE_KEY = 'managedEffects';
const handled = new Set();

function primaryGM() {
  return game.users.filter(u => u.active && u.isGM).sort((a,b) => a.id.localeCompare(b.id))[0];
}
function isPrimaryGM() { return primaryGM()?.id === game.user.id; }
const emText=(key,fallback)=>game.i18n?.localize?.('PF1AE.Effects.'+key)??fallback;
const emFormat=(key,data,fallback)=>game.i18n?.format?.('PF1AE.Effects.'+key,data)??fallback;
function warn(message) { ui.notifications.warn(`${emText('Prefix','PF1 Automation')} : ${message}`); }
function asActor(doc) {
  return doc?.actor ?? (doc?.documentName === 'Actor' ? doc : null);
}
async function resolveActor(uuid) { return asActor(await fromUuid(uuid)); }
function canOwn(user, actor) {
  return !!(user && actor?.testUserPermission(user, 'OWNER'));
}
function isValidKey(key) { return typeof key === 'string' && key.length > 0 && key.length <= 80 && /^[a-zA-Z0-9_-]+$/.test(key); }
function combatantFor(combat, actor, requestedId) {
  if (requestedId) {
    const c = combat?.combatants.get(requestedId);
    return c?.actor?.uuid === actor.uuid ? c : null;
  }
  return combat?.combatants.find(c => c.actor?.uuid === actor.uuid) ?? null;
}
async function runRequest(data, requester) {
  if (!isPrimaryGM()) return;
  if (game.modules.get('pf1-combat-automation')?.active) throw Error(emText('OldModule','Disable the old module before using the new one.'));
  if (!data || !['start','stop'].includes(data.op) || !isValidKey(data.key)) throw Error(emText('InvalidRequest','Invalid request or key.'));
  const source = await resolveActor(data.sourceUuid);
  if (!source || !canOwn(requester, source)) throw Error(emText('SourceDenied','Access to the source actor was denied.'));
  if (data.op === 'stop') return stopInternal(source, data.key);

  const combat = game.combat;
  const c = combatantFor(combat, source, data.combatantId);
  if (!combat?.started || !c || combat.id !== data.combatId) throw Error(emText('NoCombat','Source is not in the active combat.'));
  const template = source.effects.get(data.templateEffectId);
  if (!template) throw Error(emText('TemplateMissing','Effect template not found on the source actor.'));
  if (template.getFlag(SCOPE, 'managed')) throw Error(emText('TemporaryTemplate','A temporary copy cannot be used as a template.'));
  const durationTurns = Number(data.durationTurns);
  if (!Number.isInteger(durationTurns) || durationTurns < 1 || durationTurns > 100) throw Error(emText('InvalidDuration','Invalid duration (1 to 100 turns).'));
  if (!Array.isArray(data.targets) || data.targets.length === 0 || data.targets.length > 30) throw Error(emText('InvalidTargets','Invalid target list.'));
  const targets = [];
  for (const uuid of [...new Set(data.targets)]) {
    if (typeof uuid !== 'string' || uuid.length > 200) throw Error(emText('InvalidTargetUuid','Invalid target UUID.'));
    const actor = await resolveActor(uuid);
    if (!actor) throw Error(emFormat('TargetMissing',{uuid},`Target not found: ${uuid}`));
    targets.push(actor);
  }
  await stopInternal(source, data.key);
  const sessionId = foundry.utils.randomID();
  const created = [];
  try {
    for (const target of targets) {
      const effect = template.toObject();
      delete effect._id;
      effect.disabled = false;
      effect.flags ??= {};
      effect.flags[SCOPE] = { managed: true, sourceUuid: source.uuid, key: data.key, sessionId };
      effect.origin = source.uuid;
      // Pas de durée native : le gestionnaire se charge de l'expiration.
      delete effect.duration;
      const docs = await target.createEmbeddedDocuments('ActiveEffect', [effect]);
      if (docs[0]) created.push({ targetUuid: target.uuid, effectId: docs[0].id });
    }
    const state = source.getFlag(SCOPE, STATE_KEY) ?? [];
    state.push({
      sessionId, key: data.key, combatId: combat.id, combatantId: c.id,
      remainingTurns: durationTurns, label: template.name, effects: created
    });
    await source.setFlag(SCOPE, STATE_KEY, state);
  } catch (err) {
    await deleteCopies({ sessionId, effects: created });
    throw err;
  }
  console.info(`${MODULE} | Effet « ${data.key} » appliqué à ${created.length} acteur(s).`);
  return true;
}
async function deleteCopies(session) {
  for (const entry of session.effects ?? []) {
    try {
      const target = await resolveActor(entry.targetUuid);
      const effect = target?.effects.get(entry.effectId);
      if (effect?.getFlag(SCOPE,'managed') && effect.getFlag(SCOPE,'sessionId') === session.sessionId) {
        await target.deleteEmbeddedDocuments('ActiveEffect', [effect.id]);
      }
    } catch (e) { console.error(`${MODULE} | Suppression d'effet impossible`, e); }
  }
}
async function stopInternal(source, key) {
  const state = source.getFlag(SCOPE, STATE_KEY) ?? [];
  const removed = state.filter(x => x.key === key);
  for (const s of removed) await deleteCopies(s);
  if (removed.length) await source.setFlag(SCOPE, STATE_KEY, state.filter(x => x.key !== key));
  return !!removed.length;
}
function publicRequest(op, { actor, key, templateEffectId, targets, durationTurns = 1 } = {}) {
  const source = asActor(actor);
  if (!source || !isValidKey(key)) { warn(emText('InvalidActorOrKey','Invalid actor or key.')); return false; }
  if (!source.isOwner && !game.user.isGM) { warn(emText('NotOwner','You do not control this character.')); return false; }
  const data = {
    op, sourceUuid: source.uuid, key,
    templateEffectId, targets: (targets ?? [source]).map(t => asActor(t)?.uuid).filter(Boolean),
    durationTurns, combatId: game.combat?.id,
    combatantId: combatantFor(game.combat, source)?.id
  };
  if (isPrimaryGM()) return runRequest(data, game.user).catch(e => {warn(e.message); console.error(e); return false;});
  if (!primaryGM()) {warn(emText('GMRequired','A connected GM is required to manage effects.')); return false;}
  game.socket.emit(SOCKET, { ...data, requestId: foundry.utils.randomID(), userId: game.user.id });
  return true; // Demande envoyée, pas de confirmation d'application.
}

Hooks.once('ready', () => {
  const module = game.modules.get(MODULE);
  module.api = { ...(module.api ?? {}),
    startEffect: options => publicRequest('start', options),
    stopEffect: options => publicRequest('stop', options)
  };
  game.socket.on(SOCKET, data => {
    if (data?.channel === 'pf1ae-effect-groups-v1') return;
    if (!isPrimaryGM() || !data?.requestId || handled.has(data.requestId)) return;
    handled.add(data.requestId);
    if (handled.size > 1000) handled.clear();
    const requester = game.users.get(data.userId);
    if (!requester?.active) return;
    runRequest(data, requester).catch(err => console.error(`${MODULE} | Requête refusée : ${err.message}`));
  });
});

// Réduit la durée uniquement à la fin du tour du lanceur (pas à chaque changement d'acteur).
Hooks.on('combatTurnChange', async (combat, prior, current) => {
  if (!isPrimaryGM()) return;
  if (!Number.isInteger(prior?.round) || !Number.isInteger(current?.round)) return;
  if (current.round < prior.round || (current.round === prior.round && current.turn <= prior.turn)) return;
  const ownerCombatant = combat.combatants.get(prior.combatantId);
  const actor = ownerCombatant?.actor;
  if (!actor) return;
  const state = actor.getFlag(SCOPE, STATE_KEY) ?? [];
  if (!state.length) return;
  const next = [];
  for (const session of state) {
    if (session.combatId !== combat.id || session.combatantId !== prior.combatantId) {next.push(session); continue;}
    const remaining = Number(session.remainingTurns) - 1;
    if (remaining <= 0) await deleteCopies(session);
    else next.push({...session, remainingTurns: remaining});
  }
  await actor.setFlag(SCOPE, STATE_KEY, next);
});

// Nettoyage quand un combat est supprimé, sans toucher aux effets permanents.
Hooks.on('deleteCombat', async combat => {
  if (!isPrimaryGM()) return;
  for (const actor of [...new Set(combat.combatants.map(c => c.actor).filter(Boolean))]) {
    const state = actor.getFlag(SCOPE, STATE_KEY) ?? [];
    const removed = state.filter(s => s.combatId === combat.id);
    for (const session of removed) await deleteCopies(session);
    if (removed.length) await actor.setFlag(SCOPE, STATE_KEY, state.filter(s => s.combatId !== combat.id));
  }
});
