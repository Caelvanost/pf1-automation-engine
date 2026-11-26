# Health Conditions — alpha 1 (PF1 11.11 / Foundry 13)

## Scope and guard

Opt-in foundation, not a full replacement for PF1 Improved Conditions. Refuses to activate with that module active, on other PF1 versions, or before the in-world provenance probe succeeds. Default disabled. No global interception of ActorPF.setCondition(), fake feats, damage recalculation or daily resource engine. Test in a copy of the world.

Installed PF1 11.11 sources confirm:
- ActorPF._preUpdate converts hp.value into hp.offset; BaseCharacterPF._detectHealthChange stores deltas in context.pf1.deltas.
- ActorPF.setConditions searches direct Actor.effects only. Its dying track contains dead, disabled, dying and stable; direct boolean true calls can remove other members. Disabled adds staggered; unconscious adds helpless; sleep adds unconscious and helpless.
- ItemBuffPF.getRawEffectData, _updateTrackingEffect and ActiveEffectPF.isSuppressed implement native transferable Item effects. A temporary buff is used exclusively as a source carrier, not a fictional feat. Native secondary statuses and applicability are verified.
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

The probe creates a temporary actor, temporary scene (not your live encounter), linked and unlinked tokens, and verifies that independent unconscious, prone, disabled, dying, staggered, sleep secondary, stable track and pre-existing track contributions survive removal of a managed carrier. Temporary documents are deleted in finally. Failed probe invalidates previous proof. Proof is bound to the exact core, system and PF1AE version. Not a multiplayer test.

Only after successful probe enable **Health condition management (alpha)**. No retroactive sweep of untouched actors: actor/Item/effect changes and explicitly requested reconciliation calculate current conditions. Actors carrying managed sources/records are restored on ready. Do not run competing automation of HP states. Before disabling PF1AE or re-enabling Improved Conditions, turn the health setting OFF while an elected GM is active so owned carriers and exception records can be removed.

## Native presentation (1.46.1)

PF1's TokenHUDPF adds a separate buff-ID choice for every buff, including technical carriers. The engine filters only verified managed health carrier choices; native condition choices and all other buffs remain. Carrier names use the native localized condition label and old names are normalized in place on reconciliation. PF1's native ActiveEffectPF.isTemporary decision is preserved; only duplicate visible managed icons of the same primary condition and image are suppressed. Independent effects, overlays, source ownership, statuses and mechanical application are unchanged. The carrier Items remain on the Actor for provenance. Repeat the runtime probe after upgrading, then validate actual HUD and token display on linked/unlinked Actors. Do not edit the technical carriers.

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

Actor without normal health, wounds/vigor rules, invalid HP, free-text regeneration (enabled/suppressed state unknown), and actors flagged healthConditionsManual=true remain manual. Existing direct conditions created by another provider have unknown provenance; never silently adopted or deleted. Repurposed carrier with changes, actions, scripts, extra ActiveEffects or additional statuses fails closed during cleanup. Do not edit managed carriers.

## Limitations and next milestone

No automatic stabilization from healing, stabilization rolls, natural healing from negative HP, strenuous action costs, action economy enforcement, activation prompts, automatic expiration at turn end or complete Orc Ferocity recipe yet. No name-based Diehard or racial behavior. Such scripts require validated source provider and action/initiative path. No compatibility claim for concurrent Improved Conditions v2.4b or other HP-state writer. No changes to Automate Damage or Koboldworks Resting. Node suite is simulation, not Foundry integration proof. Actual probe plus two-client test (player owner, GM applies damage; linked/unlinked actors, rest, reload, combat deletion) required before campaign use.
