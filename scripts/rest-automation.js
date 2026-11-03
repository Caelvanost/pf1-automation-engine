/**
 * PF1 Automation Engine v1.9 — native PF1 rest bridge.
 * pf1PreActorRest(actor, options, updateData, itemUpdates) fires before writes;
 * pf1ActorRest has the same signature and fires after the native updates.
 *
 * The pre-hook snapshots actor state synchronously. Only registered, GM-approved
 * Item scripts execute on the elected GM; socket data never supplies source code.
 * No class-specific rules, health changes or resources are modified here.
 */
const REST_NS = "pf1-automation-engine";
const REST_CHANNEL = "pf1ae-native-rest-v1";
const REST_SOCKET = "module." + REST_NS;
const REST_MAX_PAYLOAD = 180000;
const REST_PENDING = new WeakMap();
const REST_COMPLETED = new WeakSet();
const REST_PROCESSED = new Set();
const REST_QUEUES = new Map();

const restEnabled = () => !!game.modules.get(REST_NS)?.active &&
  !game.modules.get("pf1-combat-automation")?.active &&
  !!game.settings.get(REST_NS, "genericEnabled");
const restPrimaryGM = () => [...game.users].filter(u => u.active && u.isGM)
  .sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
const restLeader = () => restPrimaryGM()?.id === game.user.id;
const restValidText = (s, n = 400) => typeof s === "string" && s.length > 0 && s.length <= n;
function restPlain(value, limit = 60000) {
  if (value === undefined || value === null) return null;
  try {
    const json = JSON.stringify(value);
    return json && json.length <= limit ? JSON.parse(json) : null;
  } catch (_) { return null; }
}
function restQueue(actorUuid, fn) {
  const previous = REST_QUEUES.get(actorUuid) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  REST_QUEUES.set(actorUuid, next);
  next.finally(() => {
    if (REST_QUEUES.get(actorUuid) === next) REST_QUEUES.delete(actorUuid);
  }).catch(() => {});
  return next;
}
/** Small, bounded snapshot. NOT a source-aware nonlethal damage ledger. */
function restSnapshot(actor) {
  const sys = actor?.system;
  if (!sys) return null;
  const items = [...(actor.items ?? [])].slice(0, 250).map(i => ({
    id: i.id, uuid: i.uuid, type: i.type,
    uses: restPlain(i.system?.uses, 1500),
    active: i.type === "buff" ? Boolean(i.system?.active) : null
  }));
  return restPlain({
    health: {
      hp: restPlain(sys.attributes?.hp, 12000),
      vigor: restPlain(sys.attributes?.vigor, 12000),
      wounds: restPlain(sys.attributes?.wounds, 12000)
    },
    resources: restPlain(sys.resources, 24000), items
  }, 75000);
}
function restOptions(options) {
  const hours = typeof options?.hours === "number" &&
    Number.isFinite(options.hours) && options.hours >= 0 ? options.hours : null;
  return { hours,
    restoreHealth: options?.restoreHealth === true,
    restoreDailyUses: options?.restoreDailyUses === true,
    longTermCare: options?.longTermCare === true };
}
function restSummary(options) {
  const {hours, restoreHealth, restoreDailyUses, longTermCare} = restOptions(options);
  const atLeastEightHours = hours !== null && hours >= 8;
  const isFullRest = atLeastEightHours && restoreHealth && restoreDailyUses;
  const kind = isFullRest ? "full" :
    restoreDailyUses && !restoreHealth ? "dailyRecharge" :
      restoreHealth || restoreDailyUses ? "partial" : "none";
  return {hours,restoreHealth,restoreDailyUses,longTermCare,atLeastEightHours,isFullRest,kind};
}
function restPayload(actor, options, updateData, itemUpdates, phase, record) {
  const update = restPlain(updateData, 60000);
  const items = restPlain(itemUpdates, 60000);
  return {
    channel: REST_CHANNEL, version: 1, phase,
    restId: record.restId, actorUuid: actor.uuid, requesterId: game.user.id,
    options: restOptions(options), before: record.before,
    after: phase === "post" ? restSnapshot(actor) : null,
    planned: {updateData: update, itemUpdates: items,
      truncated: (updateData != null && update === null) ||
        (itemUpdates != null && items === null)}
  };
}
function restSend(payload) {
  if (!restEnabled()) return;
  if (!restPrimaryGM()) {
    console.warn(REST_NS + " | Native rest not automated: no connected GM.");
    return;
  }
  try {
    const encoded = JSON.stringify(payload);
    if (encoded.length > REST_MAX_PAYLOAD) {
      console.warn(REST_NS + " | Rest notification too large; ignored.");
      return;
    }
    if (restLeader()) void restProcess(payload, false);
    else game.socket.emit(REST_SOCKET, payload);
  } catch (err) { console.error(REST_NS + " | Rest bridge error", err); }
}
function restOnPre(actor, options, updateData, itemUpdates) {
  // Never return false, block the rest, or modify PF1's update payload.
  try {
    if (!restEnabled() || actor?.documentName !== "Actor" ||
        !restValidText(actor.uuid) || !options || typeof options !== "object") return;
    if (REST_PENDING.has(options) || REST_COMPLETED.has(options)) return;
    const record = {restId: foundry.utils.randomID(), actorUuid: actor.uuid,
      before: restSnapshot(actor)};
    REST_PENDING.set(options, record);
    restSend(restPayload(actor, options, updateData, itemUpdates, "pre", record));
  } catch (err) { console.error(REST_NS + " | Pre-rest capture failed", err); }
}
function restOnPost(actor, options, updateData, itemUpdates) {
  try {
    if (!restEnabled() || actor?.documentName !== "Actor" ||
        !restValidText(actor.uuid) || !options || typeof options !== "object") return;
    if (REST_COMPLETED.has(options)) return;
    REST_COMPLETED.add(options);
    const record = REST_PENDING.get(options);
    REST_PENDING.delete(options);
    // An interrupted/missing pre-hook is not manufactured after the fact.
    const matched = record?.actorUuid === actor.uuid ? record : null;
    restSend(restPayload(actor, options, updateData, itemUpdates, "post",
      matched ?? {restId: foundry.utils.randomID(), before: null}));
  } catch (err) { console.error(REST_NS + " | Post-rest capture failed", err); }
}
async function restProcess(payload, socketOrigin) {
  if (!restEnabled() || !restLeader()) return;
  if (!payload || payload.channel !== REST_CHANNEL || payload.version !== 1 ||
      !["pre", "post"].includes(payload.phase) ||
      !restValidText(payload.restId, 80) ||
      !restValidText(payload.actorUuid) ||
      !restValidText(payload.requesterId, 100)) return;
  const requester = game.users.get(payload.requesterId);
  if (!requester?.active) return;
  const actor = await fromUuid(payload.actorUuid);
  if (actor?.documentName !== "Actor") return;
  // Socket userId is not cryptographically authenticated. Even if it claims a
  // GM, require ownership of the source actor for all relayed notifications.
  if (socketOrigin && !actor.testUserPermission?.(requester, "OWNER")) {
    console.warn(REST_NS + " | Rest rejected: non-owner requester.");
    return;
  }
  if (!socketOrigin && payload.requesterId !== game.user.id) return;
  if (!payload.options || typeof payload.options !== "object" ||
      typeof payload.options.restoreHealth !== "boolean" ||
      typeof payload.options.restoreDailyUses !== "boolean" ||
      typeof payload.options.longTermCare !== "boolean" ||
      !(payload.options.hours === null ||
        (typeof payload.options.hours === "number" &&
          Number.isFinite(payload.options.hours) && payload.options.hours >= 0))) return;
  for (const snapshot of [payload.before, payload.after]) {
    if (snapshot != null && (typeof snapshot !== "object" ||
        Array.isArray(snapshot))) return;
  }
  const marker = payload.restId + ":" + payload.phase;
  if (REST_PROCESSED.has(marker)) return;
  REST_PROCESSED.add(marker);
  if (REST_PROCESSED.size > 2000) {
    REST_PROCESSED.delete(REST_PROCESSED.values().next().value);
  }
  const rest = {
    id: payload.restId, phase: payload.phase,
    actorUuid: actor.uuid, initiatedBy: requester.id,
    completed: payload.phase === "post",
    options: restOptions(payload.options),
    ...restSummary(payload.options),
    before: restPlain(payload.before, 75000),
    after: payload.phase === "post" ? restPlain(payload.after, 75000) : null,
    nativeUpdates: {
      actor: restPlain(payload.planned?.updateData, 60000),
      items: restPlain(payload.planned?.itemUpdates, 60000),
      truncated: payload.planned?.truncated === true
    }
  };
  return restQueue(actor.uuid, async () => {
    if (!restEnabled() || !restLeader()) return;
    const generic = game.modules.get(REST_NS)?.api?.generic;
    if (!generic?._dispatchRestEvent) return;
    await generic._dispatchRestEvent({
      type: payload.phase === "pre" ? "pf1PreActorRest" : "pf1ActorRest",
      document: actor, documentUuid: actor.uuid, actorUuid: actor.uuid,
      itemUuid: null, changedPaths: [], buffState: null,
      round: null, combatId: null, combatantId: null, rest
    });
  });
}
Hooks.once("init", () => {
  Hooks.on("pf1PreActorRest", restOnPre);
  Hooks.on("pf1ActorRest", restOnPost);
});
Hooks.once("ready", () => {
  game.socket.on(REST_SOCKET, data => {
    if (data?.channel === REST_CHANNEL && restLeader()) {
      void restProcess(data, true).catch(err =>
        console.error(REST_NS + " | Rest socket rejected", err));
    }
  });
});
