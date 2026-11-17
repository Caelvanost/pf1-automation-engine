# PF1AE — Conditional defenses & cover (development draft)

Foundry VTT **13.351** · PF1 **11.11** · **not released / not production-ready**

## Existing PF1 services reused

- `api.attackResolution.resolveAttack` reads native `system.attributes.ac.normal|touch|flatFooted.total` and compares to the **already rolled** PF1 d20. This module does **not** roll another d20 or mutate an Actor's native CA.
- `api.saveContext._fromNativeSaveOptions` validates native `rollOptions.reference` from a PF1 ChatMessage and the exact source of a Reflex save.
- The PF1 `pf1PreActorRollSave(actor,rollOptions,saveId)` hook is used to add explicit source-bound Reflex cover bonuses *before* the system performs the saving throw.
- No automatic damage mitigation, concealment handling, or permanent class features.

## `api.defenseModifiers`

This API is independent of feats and classes. Persistent declarative records are stored on the actual **Item** source as `flags["pf1-automation-engine"].defenseModifiers`. Foundry's native document ownership and update permissions authorize writes; no sockets transmit executable JavaScript.

```js
const api=game.modules.get('pf1-automation-engine').api.defenseModifiers;
await api.register({
  key:'source-specific-defense',
  sourceItemUuid:item.uuid,
  defenderUuid:item.actor.uuid,
  attackerUuid:'Actor.verified-attacker-uuid', // optional
  bonusType:'deflection',
  value:4,
  defenses:['normal','touch','flatFooted'],
  reason:'source item condition',
  expiresOnDeathOf:'Actor.verified-attacker-uuid' // optional; confirmed dead status only
});
await api.remove({
  key:'source-specific-defense',
  sourceItemUuid:item.uuid,
  defenderUuid:item.actor.uuid
});
```

Keys are stable and idempotent for a given source Item; an update with the same key replaces only that source's record. Modifiers survive F5, reconnection and scene changes as Item document flags.

```js
const outcome=api.evaluate({
  defenderActor:targetActor,defenderUuid:targetActor.uuid,
  attackerUuid:attackerActor.uuid,
  defense:'normal', // normal|touch|flatFooted|ref
  nativeTypes:{deflection:2}, // VERIFIED breakdown of native PF1 bonuses
  nativeTypesComplete:false
});
// {status:'resolved',total:2,...} means 2 ADDITIONAL points,
// because +2 deflection is ALREADY present in the native CA.
```

**Typed stacking:** most named types use their highest bonus; `dodge`, `circumstance` and `untyped` are handled as stackable categories for this first draft. A typed bonus with no trustworthy native breakdown returns `status:'uncertain'` and **no effective value**. This protects against double-counting but currently prevents automatic application in many normal PF1 actors. Exact special stacking exceptions remain for future generic API work.

**Source restrictions:** the Item must belong to the defender Actor. The caller must have native owner authorization. Tokens using synthetic Actors retain their exact `Scene.<id>.Token.<id>.Actor.<id>` UUID. There are no class- or feat-specific handlers.

## `api.coverDetection`

```js
const cover=game.modules.get('pf1-automation-engine').api.coverDetection;
const automatic=cover.inspect({
  attacker:attackerToken,target:defenderToken,attackType:'ranged'
});
const explicit=cover.manual({
  type:'normal',reflexProtected:true,spreadBypasses:false
});
```

Cover mapping (PF1e):

| Type | Native CA addition | Reflex addition |
| --- | ---: | ---: |
| none | 0 | 0 |
| partial | 2 | 1 |
| normal | 4 | 2 |
| soft | 4 | 0 |
| improved | 8 | 4 |
| total | not numeric | not numeric |

A **confirmed** result is produced only for basic unobstructed same-elevation 1×1 square-grid circumstances with known, empty wall/region/tile collections and no creature in the possible intervening corridor. All walls, complex geometry, unknown obstacles, elevation differences, multi-square creatures and possible soft cover return **uncertain** or **impossible**. This is deliberately not a complete PF1 line-of-effect or corner-ray algorithm.

A manual result can be recorded by a GM only when the GM has verified the physical situation. Partial/improved cover and their visual conditions remain GM judgements. `improvedCoverEvasion` is a **diagnostic only**, never an automatic damage alteration. Total cover never becomes an arbitrary +AC.

### Attack resolution

The existing `attackResolution.resolveAttack` now accepts a verified `coverAssessment` and `nativeBonusTypes`; uncertain or total-cover assessments cause `resolution:'indeterminate'`. The legacy `coverBonus` option remains supported for existing consumers. This comparison takes place **after** PF1 has rolled the attack, without creating a new roll.

## Native Reflex-cover bridge — `api.coverSaves`

An authorised GM or defender owner may save a **manual cover choice** for an exact native attack/spell ChatMessage:

```js
await game.modules.get('pf1-automation-engine').api.coverSaves.setManual({
 message:sourceMessage,defenderActor:targetActor,
 selection:{type:'normal',reflexProtected:true,spreadBypasses:false}
});
```

The setting persists on the source ChatMessage. During a later **native Reflex save** with the **same** `rollOptions.reference`, the bridge validates its source using `saveContext` and includes `2[Cover]` / `2[Abri]` in native `rollOptions.bonus` **before** the d20. It leaves Fortitude, Will, unrelated sheet saves, and rolls without a verified source untouched. If native cover is already in the formula, no second bonus is added. It never performs a replacement save or edits damage.

**Important:** The API exists, but a usable native attack-dialog manual cover selector and verification of real PF1 11.11 interactions remain pending. Automatic geometry-to-Reflex integration is deliberately disabled until exact provenance and line of effect are established.

## Remaining required work before publication

1. Verify and integrate the native PF1 11.11 attack dialogue's actual lifecycle for automatic/manual cover selection without race conditions.
2. Implement the full PF1 corner-ray/wall/line-of-effect algorithms for ranged, adjacent melee, reach attacks, large/rectangular tokens, and soft cover.
3. Verify the native AC breakdown to support safe application of typed conditional modifiers without requiring external `nativeTypes` input.
4. Add source-specific results and reproducible provenance to native attack and saving throw chat cards, without spawning extra rolls or chat messages.
5. Develop and test source-dependent improved-cover evasion messaging, full expiry on verified resource-restoring rests, multisession and multiclient ownership; enforce all remaining permission cases.
6. Deliver and validate the full **Bastion du Bien** `postUse` Script Call with the precise native ability context and proper expiry. No paladin rule will be hardcoded in the engine.
7. Complete the requested rule regression matrix and real-world Foundry multiplayer manual acceptance testing.

**Release policy:** The working branch/PR remains a draft. Do not merge into `main` or publish a v1.35.0 ZIP until these integration gaps are addressed and the CI gate passes.
