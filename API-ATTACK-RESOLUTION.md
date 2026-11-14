# PF1AE — Generic Attack Resolution API (v1.25.1)

**Scope:** Foundry VTT 13.351, PF1 system 11.11. This module resolves generic attacks and combat maneuvers; it does **not** implement firearms, Deadeye, misfire, reload, firearm touch-range rules, alchemical cartridges or any specialized combat feat. Specialized modules provide a **defense choice**, not an attack-roll implementation.

## API entry point

```javascript
const api=game.modules.get('pf1-automation-engine')?.api?.attackResolution;
```

Available after Foundry's `ready` lifecycle:
- `registerDefenseProvider({id,priority=0,resolve:async context=>choice|null})` returns an unregister callback.
- `unregisterDefenseProvider(id)` returns `boolean`.
- `listDefenseProviders()` returns an array of `{id,priority}`, descending priority.
- `resolveAttack(context)` returns a Promise containing the result of one attack/target pair.
- `classifyAction(action,actionUse?)` returns the native PF1 `{kind,defenseType,saveType,hasAttack,hasSave}` classification, with `kind: 'attack'|'save'|'attackAndSave'|'other'`.
- `getNaturalD20(nativeRoll)` returns an integer 1–20 if **exactly one** active d20 result is unambiguous; otherwise `null`.
- `lastDiagnostic()` returns the last locally resolved result.

## Registering a defense provider

```javascript
const api=game.modules.get('pf1-automation-engine').api.attackResolution;
const unregister=api.registerDefenseProvider({
 id:'my-special-defense-module',
 priority:100,
 async resolve(context) {
  if (!context.action || !context.targetActor) return null;
  // Apply your own verified specialized rules here, using the actual
  // action, target and (if required) single attackIndex/roll.
  return {type:'touch',reason:'verified special rule'};
 }
});
// On hot disable/unload: unregister();
// Or: api.unregisterDefenseProvider('my-special-defense-module');
```

**Provider contract:** `resolve(context)` may be synchronous or asynchronous and must return `null` for irrelevant attacks. Otherwise it returns `{type,reason?}`, where `type` is one of `normal`, `touch`, `flatFooted`, `cmd`, `manual`. The framework records the provider ID itself (do not trust external `provider` fields). Priorities must be finite numbers; a duplicate ID is rejected in the same session. Two providers at the same top priority choosing different defenses cause `indeterminate`, never an arbitrary winner. Exceptions in any provider are recorded and produce an indeterminate result; they do not silently fall back.

**Priority:** Native PF1 combat maneuver (`cmd`) > native **Contact** checkbox or ActionUse touch override (`touch`) > external providers by numeric priority > ordinary native attack (`normal`) > indeterminate. No PF1AE defense selector, no action flags and no manual defense override exist in v1.25.1. A pure saving-throw action reports `pendingSave` to this attack service, while PF1AE's existing `saveContext` and `saveOutcomes` services evaluate the native target saving throw separately. A mixed attack-and-save action follows both paths independently.

**Registration lifecycle:** Register **once** on your own module's `ready`, retain the unregister callback, and unregister on disable/change. On browser F5 the JS Map is recreated; the same callback must not register twice within one running client.

## Context

`resolveAttack(context)` and providers receive:

| Field | Meaning |
|---|---|
| `actor` | Attacker Actor document, if available |
| `item` | Native PF1 parent Item |
| `action` | Native PF1 Action model |
| `actionUse` | Native PF1 ActionUse object after the attack's process |
| `attackerToken` | Token UUID (when uniquely available on the existing event path) |
| `targetToken` | Actual Target Token document/object, if resolved |
| `targetActor` | Target Actor document, including synthetic Token Actor |
| `attackIndex` | Verified index when provided by PF1 or native chat-attack count corresponds; otherwise null |
| `sourceMessageId` | Native ChatMessage ID |
| `roll` | Actual native d20 attack Roll object (not the crit-confirmation/damage Roll) |
| `natural` | Optional explicit native d20 integer, otherwise parsed safely from `roll.dice` |
| `total` | Optional native final attack total, otherwise `roll.total` |
| `coverBonus` | Optional **verified** numeric situational defense modifier, 0–100; the API adds it to the selected defense without changing PF1 |
| `concealmentPending` | True if a separate concealment miss-chance roll remains necessary |
| `concealmentCleared` | True only when absence/passing of concealment has been **verified** |
| `additionalCheckPending` | True for another verified unresolved step |

Do **not** assume `targetToken`, `attackerToken`, `attackIndex` or native `roll.dice` always exists. Return `null` from a provider if the evidence needed for your special rule is absent. In particular, a Deadeye-like feature should inspect its own action/target/roll and return a choice only when its prerequisite is established; the core does not compute these rules.

## Results

```javascript
{
 actorUuid:'Actor....',itemUuid:'Actor....Item....',actionId:'actionId',
 attackIndex:0,sourceMessageId:'chatId',targetActorUuid:'Actor....',
 targetTokenUuid:'Scene....Token....',
 natural:16,total:23,
 defense:{type:'cmd',value:19,baseValue:19,coverBonus:0,
          provider:'pf1-native',reason:'native combat maneuver'},
 defenseHit:true, // success against defense, prior to any concealment
 hit:null,        // final hit NOT yet verified
 resolution:'success',
 reason:'defense beaten; concealment unverified'
}
```

`resolution` values: `success`, `failure`, `indeterminate`, `pendingConcealment`, and `pendingSave` (pure save action with no attack roll). A natural 1 fails; a natural 20 succeeds against the selected defense; otherwise `total >= defense.value`. The defense values are read from PF1's prepared attributes:
- `normal`: `targetActor.system.attributes.ac.normal.total`
- `touch`: `targetActor.system.attributes.ac.touch.total`
- `flatFooted`: `targetActor.system.attributes.ac.flatFooted.total`
- `cmd`: `targetActor.system.attributes.cmd.total`

The native PF1 total already contains its own attack bonuses and penalties; `coverBonus` is only applied if explicitly verified and supplied. Concealment requires a separate success check: `defenseHit` and `hit` are distinct. When concealment has **not** been verified, a successful defense comparison yields `resolution:'success',defenseHit:true,hit:null`; `hit:true` requires a verified cleared concealment flag. A miss is definitive (`hit:false`). A missing target, defense, final total or natural d20 may force `indeterminate`.

### Existing native attack events and Script Calls

PF1AE reuses `pf1AttackRoll` and `pf1PostActionUse`. The existing `PF1AE:attack:resolved` **postUse** Script Call still receives one event **per native attack roll** with its original fields:

`type,actorUuid,itemUuid,actionId,attackerTokenUuid,sourceMessageId,rollIndex,attackIndex,roll,hit,targets,isAutoTriggered`.

New additive fields: `roll.natural`, `defense`, `resolution`, `targetActorUuid`, `targetTokenUuid`, `targetResults`. `targetResults` contains individual target/attack-pair results and may have zero entries when no target is known. The module also emits the generic `pf1aeAttackResolution` Hook once per attack with this same event **even without any Script Call subscriber**.

For several targets and **no verified roll-to-target pairing**, every pair is marked `indeterminate`. The module never duplicates one native attack result across several targets arbitrarily. The original `event.hit` remains `true`, `false` or `null`. Existing scripts receiving old event fields are not required to change.

The resolution engine **never** applies damage, never changes AC/conditions, and does not infer a hit from HP changes. `PF1AE:damage:applied` stays independent. The existing source Message ID is retained when available.

## Notes / remaining validation

- The generic PF1 models were audited against the published PF1 source mirror; the runtime behavior on the user's precise PF1 11.11 build should still be verified in Foundry.
- Dynamic cover and concealment must be supplied by a verified upstream provider/caller; they are not automatically inferred from arbitrary scene geometry.
- Flat-footed touch and special CMD variants are separate situational mechanics; no unsupported native values are invented.
- This module intentionally declines to resolve ambiguous multi-target attacks or unknown natural d20s. Advanced mapping to individual PF1 ChatAttack IDs should follow actual live metadata validation.
- PF1's native `Action.touch`, `Action.isCombatManeuver`, `Action.hasAttack` and `Action.hasSave` are authoritative. No extra selector or Item schema modification is required. The older `attackDefenseConfig` flags are no longer used; they remain on existing Items as non-destructive historical data.
- Saving throw actions **must not** be resolved by comparing their caster's attack total to AC. Use the native source Action's Fortitude/Reflex/Will and DC, and PF1AE's separate saving throw pipeline to resolve target saves.
