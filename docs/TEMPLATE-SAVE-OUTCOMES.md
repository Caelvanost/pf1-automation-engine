# Save Outcomes — approved mechanical templates (v1.15.0)

**Environment:** Foundry VTT v13 / Pathfinder 1e system v11.11. This is a reusable consequence service: no Crushing Blow or other feat mechanics are hard-coded.

## API

```js
const api=game.modules.get('pf1-automation-engine')?.api;
await api.saveOutcomes.register({
  actor: sourceActor,
  key: 'unique-attempt',
  groupKey: 'unique-attempt',
  sourceItemUuid: abilityItem.uuid,
  sourceActionId: savingThrowAction.id,
  targets: [targetActor.uuid],
  onFailure: {
    type: 'templateEffect',
    templateUuid: approvedBuff.uuid,
    duration: {seconds:60,expire:'elapsed'},
    stacking: {mode:'replace',key:'shared-ac-penalty'}
  }
});
```

The registered `key` identifies one save-outcome rule. The source Action ID must correspond to a real PF1 ItemAction, and the target UUID may be a synthetic `Scene.Token.Actor` UUID. The source Action card must be verified by SaveBridge; the model is copied **only after a failed native saving throw** using the final effective total. Do not create a condition when the card is merely published.

`groupKey` remains required but a time-limited template does not need a currently active managed performance group. Existing `onFailure.type:'linkedBuff'` works unchanged.

## Models and approval

The template must be an Actor-owned PF1 `Item` of `type:'buff'`, an Actor-owned `ActiveEffect`, or a proper Compendium Item of `type:'buff'`. Actor-owned templates must belong to the ability's source Actor. Other Actors may receive copies regardless of ownership.

From a GM client, approve the exact original model:

```js
await api.effectGroups.approveTemplate({
  actor: sourceActor,
  templateUuid: approvedBuff.uuid
});
```

Model approvals are stored using the existing exact canonical fingerprint. `templateEffect` registration **does not approve the model**; the elected GM rechecks the fingerprint both at registration and immediately before cloning. Any edits after approval cause a refusal until the model is reapproved. Do not approve untrusted executable Script Calls.

For a PF1 buff, the module clones its native `system` data, adds PF1AE source flags, creates an Item on the target and calls `setActive(true)`. An ActiveEffect retains its declarative `changes` and is created enabled. No permanent or unrelated document is replaced.

## Duration and stacking

- `{seconds:60,expire:'elapsed'}`: 60 seconds of **Foundry game time**; the world clock must advance.
- `{rounds:10,expire:'elapsed'}`: 10 × 6 seconds of game time.
- `{rounds:1,expire:'sourceTurnStart'}` or `sourceTurnEnd`: next relevant start/end of the source combatant's turn when combat is active; outside combat fallback is elapsed game time.

Uses existing `effectGroups`, `duration` and `generic` timer services, persisted in world settings and reloaded on F5. On expiry, the exact managed PF1 buff copy is deactivated and deleted; an ActiveEffect is deleted. An unavailable token or scene may defer cleanup, rather than deleting an unrelated document.

| Stacking mode | Behavior |
| --- | --- |
| `stack` | Allow independent copies per confirmed outcome |
| `replace` | Create a new copy, then disable/delete the old managed copy with the same key; roll back on cleanup error |
| `refresh` | Keep existing copy and reset its timer; require the same template and expiration mode |
| `ignore` | Keep the existing copy without creating another |

For modes other than `stack`, `stacking.key` is required and consists of 1–80 ASCII letters, digits, underscore or hyphen. Key matching is on the **target Actor UUID**, not source Actor; independent casters applying the same stacking key intentionally interact. Conflicting multiple copies result in a refusal rather than an arbitrary selection.

The elected GM serializes mutations and deduplicates with the native save ChatMessage flag, outcome ID and exact managed copy flags. Socket-supplied values are never trusted as executable code.

## Dynamic values — not implemented yet

`onFailure.parameters` is **rejected** in v1.15.0. For now, configure a fixed mechanical value on the actual PF1 buff/ActiveEffect model and approve that version. The system neither rewrites unverified PF1 AC bonus paths nor executes arbitrary JavaScript passed to GM. A later dynamic version must validate an explicit allowlist of native PF1 11.11 change targets and numeric ranges before touching a copied document.

## Testing

In Foundry, test a GM-approved fixed-value buff with a failed/successful save, linked and unlinked Actors, time advancement (60 seconds), turn boundaries, all four stacking modes, multiple sources sharing a key, changes to an approved template, duplicate save clicks, deletion, and F5/GM handoff. Verify the buff mechanically changes the target's derived stats, not merely the item's name. Follow the existing `attackOutcomes` + native save workflow without changing the scripted attack.

Non-regression: Fascination (group-linked), Countersong, Distraction, one-round Stunned and direct native attack damage including synthetic HP offsets.
