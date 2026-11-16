# Tactical Positioning Engine — PF1AE v1.33.15

Foundry VTT **13.351** · Pathfinder 1e system **11.11**

This service implements **general PF1e flanking geometry**, not any feat or class feature. There is no hardcoded Outflank, Pack Flanking or other feat behavior.

## Native attack dialog integration

At the native `pf1CreateActionUse` hook, PF1AE considers only an **actor-owned melee attack** (`mwak` or `msak`) with exactly one targeted token. If flanking is **verified**, it sets:

```js
actionUse.shared.useOptions.flanking = true;
```

This is the **native PF1 Flanking checkbox**. The user can uncheck it in the attack dialog, and the PF1 system applies the standard **+2 melee attack bonus** when selected. PF1AE **never adds a second +2** or rewrites the actor/item/weapon. This follows the same native hook and checkbox contract used by Roll Bonuses PF1.

The checkbox is **not preselected** if the analysis is uncertain, if targets are missing/multiple, or if the action is not a melee attack. An already checked option is left alone. Only the creation-time hook writes the initial checkbox; it does not force the value back on during later roll stages.

The setting **Détection automatique de la prise en tenaille / Automatic flanking detection** is enabled by default and can be disabled independently.

## Query API for Item Script Calls

```js
const tp = game.modules.get("pf1-automation-engine")?.api?.tacticalPositioning;
const result = tp?.checkFlanking({ attacker: attackingToken, target: targetToken });
```

**Result contract**

```js
{
  status: "flanking" | "not-flanking" | "uncertain",
  flanking: true | false | null,
  bonus: 2 | 0 | null, // INFORMATIVE only: never injected by this API
  reason: "opposite-borders", // otherwise a diagnostic reason
  allies: ["Scene....Token...."], // qualifying ally token UUIDs
  candidates: 1,
  uncertain: []
}
```

`tp.lastDiagnostic()` retrieves the last result for debugging.

### Conservative checks

- Only **square grids** with recognized metres or feet are supported.
- The attacker and target must be tokens in the current scene, with verified opposing dispositions (friendly/hostile).
- A qualifying ally must be on the attacker's side, in the same scene, and on the opposite boundary or corner of the target's occupied square/rectangle.
- Attacker and qualifying ally must both be able to threaten the target, using native prepared **melee reach** and grid distance.
- When missing reach/attacks/elevation prevent a reliable result, the service returns `uncertain`; it never guesses `true`.
- The current version requires equal token elevation; more complex three-dimensional threat arcs are deliberately not inferred.
- The engine does not attempt to infer exceptional flanking rules granted by feats, class features, weapon special properties, or other Script Calls. Those belong in Item scripts.

## Compatibility and limitations

- It does not modify native PF1 melee attack math or add an attack bonus itself.
- Roll Bonuses also prechecks the native `shared.useOptions.flanking` option. Both modules may coexist without stacking this particular +2; for a single authoritative detector, disable the overlapping flanking detector in Roll Bonuses.
- The result is conservative. An unknown threat is not proof that a character can flank.
- Diagnose a scene with `api.tacticalPositioning.lastDiagnostic()` or activate **Automation diagnostic logs**.

This initial release includes automated tests for normal/diagonal flanking, large tokens, natural reach, disabled threats, uncertain states, native checkbox preselection, manual opt-out and no double bonus.
