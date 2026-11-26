# Health Conditions — native direct source alpha (PF1 11.11 / Foundry 13)

## Scope and guard

Opt-in foundation, not a full replacement for PF1 Improved Conditions. Refuses to activate with that module active, on other PF1 versions, or before the in-world provenance probe succeeds. Default disabled. No fake feats, damage recalculation or daily resource engine. The exact PF1 11.11 ActorPF.setConditions method is adapted only for collisions with a verified managed direct effect; every other request delegates to the original. Test in a copy of the world.

Installed PF1 11.11 sources confirm:
- ActorPF._preUpdate converts hp.value into hp.offset; BaseCharacterPF._detectHealthChange stores deltas in context.pf1.deltas.
- ActorPF.setConditions searches direct Actor.effects only. Its dying track contains dead, disabled, dying and stable; direct boolean true calls can remove other members. Disabled adds staggered; unconscious adds helpless; sleep adds unconscious and helpless.
- Direct ActiveEffects use PF1's native condition data: registry name, image, primary and secondary statuses, and pf1.autoDelete. The engine adds its private version-2 source flag and uses exact document UUIDs. No new Buff Item is created.
- ActorPF.performRest computes rechargeItems({period:"day"}) before pf1PreActorRest, commits item updates and emits pf1ActorRest. Koboldworks Resting 3.0.0.1 only changes healing updateData in pf1PreActorRest, not native item recharge.

## Runtime validation and activation

With Improved Conditions disabled, PF1AE loaded and the health setting still OFF, execute as elected GM in a **test world**:

```js
const api = game.modules.get("pf1-automation-engine").api.healthConditions;
try {
  const result = await api.probe();
  console.log("PF1AE health probe:", result);
  ui.notifications.info("Health provenance probe passed.");
} catch (error) {
  console.error(error);
  ui.notifications.error(error.message);
}
```

The probe creates a temporary actor, temporary scene, linked and unlinked tokens, and verifies that independent unconscious, prone, disabled, dying, staggered, sleep secondary, stable track and pre-existing track contributions survive removal of a native direct contribution. It verifies independent removal while the automatic source remains, native HUD toggle creation, and final-source removal without leftover status or technical Item. Temporary documents are deleted in finally. Failed probe invalidates previous proof. Proof is bound to the exact core, system and PF1AE version. Not a multiplayer test.

Only after successful probe enable **Health condition management**. No retroactive sweep of untouched actors: actor/Item/effect changes and explicitly requested reconciliation calculate current conditions. Actors carrying managed sources/records are restored on ready, after the new runtime proof. On migration, first disable the old health setting, update, rerun the probe and re-enable. Do not run competing automation of HP states. Before disabling PF1AE or re-enabling Improved Conditions, turn the health setting OFF while an elected GM is active so owned native effects, verified legacy carriers and exception records can be removed.

## Native direct provider (1.46.3)

No new technical Buff Items. Source flags identify direct native ActiveEffects by actor UUID, primary status and causes. One effect represents each automatic primary condition. Only exact, structurally verified owned effects are changed/deleted. The native setConditions lookup in PF1 11.11 would otherwise coalesce independent and automatic sources. The collision branch excludes owned direct effects from lookup, keeps native track expansion and immunities, and reports actual status transitions. Normal calls delegate to the native implementation. The provider is unavailable if the router is not installed; the runtime probe must succeed. The previous HUD/side-panel filters are removed; the sole presentation wrapper suppresses an identical duplicate managed token icon. Native condition notifications are emitted for actual creation/removal transitions, allowing external panels to refresh. Existing v1 Buff carriers are migrated on reconciliation or removed when disabled, only if verified. Unmarked direct conditions are never silently removed; if an older module created stale direct conditions, review them manually. Prone remains after healing until the creature stands. Actual third-party panel rendering and multiplayer require live validation.

## API

```js
const api = game.modules.get("pf1-automation-engine").api.healthConditions;
api.isAvailable();
api.diagnostics(actor);
api.list(actor);
await api.register({
  actor,
  sourceUuid: item.uuid,
  key: "temporary-health-exception",
  suppress: ["unconscious", "dying", "prone"],
  apply: ["disabled"],
  combatId: game.combat?.started ? game.combat.id : null
});
await api.unregister({actor, sourceUuid: item.uuid, key: "temporary-health-exception"});
await api.reconcile(actor);
```

Full Actor UUID including synthetic Actors. Source must be an active embedded Item on the exact Actor. Tuple Actor UUID, source UUID and unique key. Record persisted in independent flag paths on that Actor. Owner calls use native Actor document permissions and enqueue reconciliation on the elected GM; no remote privileged JS. GM calls return after processing; owner receives {queued:true}, not proof of completion. Queue serializes per-actor writes. Missing source, disabled source, ended combat and death invalidate records. Optional combatId is a cleanup boundary, NOT an initiative deadline. Use existing approved generic.scheduleTurn from the elected GM; automatic owner-to-GM timer and optional prompt orchestration are not implemented in alpha 1.

Allowed status IDs: disabled, dying, unconscious, prone, staggered. Dead is not accepted. Union of suppression requests takes precedence over apply requests for **lethal health contributions only**. Native secondary statuses cannot be selectively detached from primary (disabled -> staggered; unconscious -> helpless). If disabled and dying would both result, dying wins. Exception applications affect only nonpositive HP and never nonlethal contributions.

Normal living HP zero: disabled. Negative: dying (unless native stable is present), unconscious, prone. Nonlethal >0: equal HP gives staggered, greater HP gives separate unconscious and prone. Death: at or below -Constitution, Constitution <=0 or ability damage >= score; undead and constructs at <=0. Native Dead is applied directly, never removed automatically. PF1AE deathDefeated reconciles tracker. On health recovery a managed fall is converted to ordinary prone, never automatically stands the creature up. Existing direct effects and other Item effects are not deleted. Native stable is respected but not automatically created or removed.

Actor without normal health, wounds/vigor rules, invalid HP, free-text regeneration (enabled/suppressed state unknown), and actors flagged healthConditionsManual=true remain manual. Existing direct conditions created by another provider have unknown provenance; never silently adopted or deleted. Modified native source or legacy carrier fails closed during cleanup. Do not edit the engine-owned source documents or their flags.

## Limitations and next milestone

No automatic stabilization from healing, stabilization rolls, natural healing from negative HP, strenuous action costs, action economy enforcement, activation prompts, automatic expiration at turn end or complete Orc Ferocity recipe yet. No name-based Diehard or racial behavior. Such scripts require validated source provider and action/initiative path. No compatibility claim for concurrent Improved Conditions v2.4b or other HP-state writer. No changes to Automate Damage or Koboldworks Resting. Node suite is simulation, not Foundry integration proof. Actual probe plus two-client test (player owner, GM applies damage; linked/unlinked actors, rest, reload, combat deletion) required before campaign use.

## Agony and strenuous actions (1.47.0)

Enable the two additional world options only after the new version's health probe succeeds. Both default to false. PF1 Core Rulebook combat, pp. 189–191: at the beginning of each dying creature's turn, Constitution check DC 10, penalty equal to negative HP, natural 20 always succeeds; failure loses 1 actual HP. Identified ongoing damage (`bleed` status, active PF1AE HP bleed source, or explicit `flags.pf1-automation-engine.ongoingDamage: true` on an active embedded item/effect) causes automatic failure. A configured PF1AE bleed is joined through its existing turn processor and exact receipt. A fully prevented configured bleed alone does not force failure; missing/unverified bleed receipts require GM review. Arbitrary ongoing damage without a structured source remains a GM decision. Native ability check includes normal Constitution modifiers. No saving throw. Elected GM, persistent highest round receipt per exact actor/combatant, no re-roll on rewind/F5. A changed turn/HP or failed native roll leaves a pending receipt for review. Actual HP offset healing stabilizes a living negative-HP actor; further real HP loss removes plain native Stable, but does not delete an independently sourced complex effect. HP maximum changes and temporary HP expiry are not inferred as damage. Healing to nonnegative HP clears ordinary Stable. No hourly consciousness or unaided recovery automation yet.

Native `pf1PreActionUse` snapshots conscious disabled actor at nonpositive HP; `pf1PostActionUse` requests 1 actual HP loss for `standard`, `attack`, `aoo`, `full`, `round`. Move, swift/free/immediate and cancelled actions do not automatically charge. Special, minute/hour and ambiguous activations remain manual. Unchained action economy is not supported. An actual HP increase during resolution exempts the action. Healing action cards have deferred application and are explicitly left for GM adjudication rather than charging prematurely. Costs are submitted as data-only flags by the initiating owner, consumed by the elected GM in a per-Actor serialized queue, with receipt and real HP decrease committed together. Requests older than 30 seconds or incompatible with current health are marked review. Neither agony nor exertion is an attack; temporary HP, DR and Automate Damage must not absorb the direct HP loss. No blocking action economy yet. Native `api.healthConditions.diagnostics(actor)` exposes `agonyTurns` and `actionCosts`. Test linked and synthetic actors with two clients before production use.


## Generic health event (1.48.0)

PF1AE is a rules engine, not a repository of class, ancestry, feat or special ability implementations. All such rules belong in native Item Script Calls maintained outside the module.

Create a native **After Use / Après utilisation** Script Call, exact name **PF1AE:health:changed**. It is discovered on active embedded Items and invoked by the elected GM after an actual committed HP change, before automatic conditions are reconciled. This is a subscription name: do not call the Item's normal action merely to trigger it. On player-owned Actors the existing exact-source Script Call approval or Trusted Table Mode is required, even if the player is connected. No arbitrary remote code execution. Duplicate same-name calls are ignored. Example (a complete read-only Script Call):

```js
if (typeof event === "undefined" || event.type !== "health:changed") return;
console.log("Health changed", {
    actorUuid: event.actorUuid,
    hpBefore: event.hpBefore,
    hpAfter: event.hpAfter,
    enteredNegative: event.enteredNegative,
    recoveredNonnegative: event.recoveredNonnegative
});
```

The event contains immutable primitive fields: type, eventId, actorUuid, sourceUuid (calling Item only), hpBefore, hpAfter, hpDelta (signed), reason (native, agony, strenuous), userId, reducedToZero (>0 to <=0), enteredNegative (>=0 to <0), recoveredNonnegative (<0 to >=0), enteredPositive (<=0 to >0), constitution, deathByHealth, dead, nonliving, combatId, combatantId, round, activeCombatantId. Combat fields are null if no unique matching active Combatant exists. The native delta must be finite and nonzero; outdated HP snapshots are skipped, not replayed. A lethal event bypasses pre-condition scripts and is reported only after death reconciliation.

Within this Script Call, use event.register({key, suppress, apply, combatId}) or event.unregister({key}). These are synchronous staging operations bound to the calling Item and actor. The engine validates and commits only after the Script Call completes successfully while the HP snapshot and approval are still valid, then reconciles. Keys and statuses are the same as the public API; no exception can suppress Dead or independent conditions. No explicit reconcile call is needed. Do not call/await api.register(), api.unregister() or api.reconcile() on the same actor from inside the pre-condition script: those calls would re-enter the active queue and are deliberately rejected. Use the event-scoped operations instead. Do not save an event callback for later; its scope expires. For later lifecycle events/timers use the existing public API and generic scheduleTurn with the approved script and exact combatant. The module does not consume any special ability resource, present a special ability dialog or select its duration.

Public observer Hook: Hooks.on("pf1aeHealthChanged", (actor, event) => { /* read-only observation */ }); runs on elected GM after reconciliation and reports the same health transition (without mutating methods or sourceUuid). A Foundry Hook listener cannot delay reconciliation; use the awaited native Script Call for a pre-condition exception. No raw hook is emitted on ready or re-reconciliation. Real health loss from agony or strenuous action also traverses the event path. Duplicate notifications using the same native update context and actor/delta are suppressed; separate actors in bulk updates remain independent. No guarantee of exactly-once distributed delivery or replay of missed events while no GM is present. Validate linked/unlinked actors and approval paths in Foundry before campaign use.
