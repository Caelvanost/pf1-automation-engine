# Save Outcomes — v1.12.3 experimental

**Target:** Foundry VTT v13.351 / PF1 system v11.11. The original PF1 action-card saving throw is the only dice roll. This service handles *consequences* after the elected GM resolves the final `saveOverrides.effectiveTotal`.

## API

The PF1 Item's **Use/After Use** Script Call can register an outcome rule. Supply the **actor-owned** source Item, its **exact Action ID** (mandatory when the Item has multiple Actions), and the Actor UUIDs of the targets validated by that Script Call:

```js
const api = game.modules.get('pf1-automation-engine').api;
// `bard`, `item`, `action` and `targetRefs` are variables determined by the
// caller's native PF1 Script Call; they are not injected by this module.
await api.saveOutcomes.register({
  actor: bard,
  key: 'fascinate',
  groupKey: 'fascinate',
  sourceItemUuid: item.uuid,
  sourceActionId: action?.id ?? null,
  targets: targetRefs.map(t => t.actorUuid),
  onFailure: {
    type: 'linkedBuff',
    name: `Fasciné — ${bard.name}`,
    img: item.img,
    // Optional: only added if *this installation* explicitly declares this
    // condition in `pf1.registry.conditions`:
    statusId: 'fascinated'
  }
});
```

`register` and `unregister` **await the elected GM's acknowledgement**, including when called by a non-GM player through the module socket. A returned `{registered:true,id}` means the rule is persisted, not merely submitted. Explicitly register **before** allowing the targets to click the native saving throw. The Item's Script Call is responsible for target legality and range; this service does not inspect target names, execute the Action again, or compute a saving throw DC.

For extra protection against a *previous casting* of the same Item and Action, optionally provide `sourceMessageId` (the UUID-free ID of the specific originating native ChatMessage), and/or `groupId` (the id of the specific `effectGroups` session). If the group is already created, pass both whenever available. A registration without `groupId` matches the live group by `actor.uuid` plus `groupKey`, which makes it compatible with the existing player socket workflow but is less restrictive when several casts are active.

To remove a rule manually:

```js
await api.saveOutcomes.unregister({actor:bard,key:'fascinate'});
```

The GM can inspect the persistent records using `api.saveOutcomes.list()`.

## Linked lifecycle

1. Start or maintain the managed `effectGroups` group whose `actor` and `key` match the outcome rule. The `groupKey` is the *same* key passed to `effectGroups.applyGroup/stopGroup/extendGroup`, not a separate group.
2. The player clicks the **native PF1 Will save** on the originating Action ChatMessage.
3. The existing `save-context` and `saveOverrides` code validates Item/Action provenance and resolves the real chat roll.
4. The elected GM calls `saveOutcomes` using the **source card's actual saveDC** and the **final effectiveTotal**; there is no second roll.
5. A failed save (`effectiveTotal < saveDC`) creates one embedded ActiveEffect, with the requested name and image and identifying `flags.pf1-automation-engine`. This is an intentionally source-specific effect, not a global condition toggle.
6. The new document ID is added **atomically with respect to group expiry** to `managedEffectGroups[groupId].copies`. Consequently `extendGroup` leaves the effect intact; `stopGroup` and normal expiration delete exactly the identified document.
7. Success causes no new effect. No 24-hour immunity or automatic repeat saving throws are implemented.

The optional `statusId:'fascinated'` is **only honored** if the installed `pf1.registry.conditions.has('fascinated')` (or equivalent registry object) is true. Otherwise the linked ActiveEffect is created with an empty `statuses` collection. Do not assume the installed PF1 system defines an official `fascinated` status. The item remains visible and source-identifiable even without such a system condition. Foundry v13 associates `statuses` with individual ActiveEffects; when PF1 recomputes its condition set, deleting one source-specific effect leaves any other provider of the same status intact. [Foundry v13 ActiveEffect documentation](https://foundryvtt.com/api/v13/classes/foundry.documents.ActiveEffect.html).

## Persistence, security and deduplication

- The rule registry is a hidden **world setting** (`saveOutcomeRegistry`). The exact effect is an **embedded ActiveEffect** on its target; the relationship and copies are stored in the existing `managedEffectGroups` setting.
- The **original save ChatMessage** gets a `flags.pf1-automation-engine.saveOutcomes[ruleId]` processing record. An exact `outcomeId` is also stored on the linked effect. Both checks prevent a reprocessed save from applying a second effect, including after F5 or a GM handover.
- If processing the result is interrupted between applying an effect and setting the ChatMessage flag, replaying the same save is safe: the group ledger identifies the already-created effect.
- A rule is only eligible when the **GM-verified** source item UUID, source action ID, target Actor UUID, real numeric source-card DC, and live managed group all match. A manual sheet save does not supply this verified context, and does nothing.
- Only the elected GM performs registry writes and creates the effects. Remote register/unregister operations check ownership of the source Actor and receive an explicit GM acknowledgement.
- Rule registration does not grant a player control over a target's sheet; effect changes are applied on the GM client. As with existing `effectGroups`, the trusted Actor Script Call remains responsible for legal target determination.

## Known limits / live-world acceptance

- The module creates a **minimal ActiveEffect with no mechanical change entries**; it optionally supplies a PF1 condition status if the *installed registry* contains the ID. Verify in Foundry that the chosen PF1 condition has the intended mechanical and visual behavior.
- This prototype has simulated tests for target isolation, action isolation, raw vs overridden totals, deduplication, missing DC and group expiration. A real player/GM/player session, scene changes, disconnected players, and the native card rendering **must still be tested**.
- If the source ChatMessage does **not** provide a finite numeric computed DC in its verified `saveContext`, the module **fails closed**. It will not compute a replacement DC or apply the effect.
- An old chat card for the same Item/Action can be processed again after a new group is started if no `sourceMessageId` or `groupId` was registered. Provide a specific `sourceMessageId` when the Script Call can obtain it.
- Group reapplication is currently a replacement, not maintenance: for an ongoing bardic performance call `extendGroup` rather than `applyGroup` again; reapplying removes existing linked effects.

## Diagnostics

Enable the module's `genericDebug` setting. Key events:

```text
[PF1AE][SaveOutcome] Registered
[PF1AE][SaveOutcome] Save completed { source, action, target, DC, normal, effective, outcome }
[PF1AE][SaveOutcome] Rule matched: fascinate
[PF1AE][SaveOutcome] Linked effect created
[PF1AE][SaveOutcome] No failure effect applied
[PF1AE][SaveOutcome] Removing linked rules
```

The existing effect-group engine logs creation/deletion of group-owned documents. For diagnosis, inspect the save message's `saveOutcomes` flag and the exact group's `copies` array.

## v1.13.0 — Generic timed native conditions

`onFailure.statusId` accepts a condition identifier from the **live** `pf1.registry.conditions`. The existing historical `fascinated` fallback remains. PF1 v11.11 uses `stunned` for the condition and `stun` for its immunity category. The system's `actor.getConditionImmunities()` resolves the latter; absent or unusable immunity data causes new conditions to be refused with a warning for GM adjudication.

```js
await api.saveOutcomes.register({
  actor: monk, key: "stunning-fist", groupKey: "stunning-fist",
  sourceItemUuid: item.uuid, sourceActionId: saveAction.id,
  targets: [target.actor.uuid],
  onFailure: {
    type: "linkedBuff",
    name: `Étourdi — ${monk.name}`,
    img: item.img,
    statusId: "stunned",
    duration: { rounds: 1, expire: "sourceTurnStart" }
  }
});
```

When `duration` is provided, this is an **independent effect** and no active parent `effectGroups` group is required. On failure, the elected GM creates a source-specific ActiveEffect and schedules its deletion with `generic.scheduleTurn` at the **start of the source combatant's next turn**. For a timed effect, `groupKey` remains a rule-identity namespace; `groupId` may be omitted. On success, no effect is created. Each verified target's pending registration is consumed once resolved. A duplicate native save message is still guarded by the ChatMessage's saveOutcomes flag and the effect's outcomeId.

A duration may be `{rounds:1,expire:"sourceTurnStart"}`, `{rounds:N,expire:"sourceTurnEnd"}`, `{rounds:N,expire:"elapsed"}`, or `{seconds:N,expire:"elapsed"}`. Outside combat, round duration falls back to elapsed Foundry world time at six seconds per round; the world clock must advance.

The module does **not** perform or confirm melee attacks, damage, resource expenditures or extra actions. The source PF1 Script Call must do those checks and register the rule **before** publishing the native Fortitude save Action card, using `item.use({actionId: saveAction.id})` when its system workflow supports that call. Resource consumption must be handled once by the Script Call. A successful hit is not inferred from the save card.
