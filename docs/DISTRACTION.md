# Distraction via generic saveOverrides (v1.12.2)

Target: Foundry VTT 13.351, PF1 11.11. This adds **no** spell-specific handler and does not alter PF1 native scripts, dice, chat cards, or actor prototypes.

## Native PF1 structured fields

* `system.school`: spell school, `ill` for illusion.
* `system.subschool`: `Set<string>`; `pattern` and `figment` are recognized directly. If present, this structured field is authoritative over freeform tags.
* `system.tags`: `Set<FreeText>`; falls back to exact tag names `pattern` and `figment` when there is no structured subschool. The **specific source action**, if known, may additionally contribute `tags` / `descriptors`; unrelated actions are not scanned.
* `system.abilityType`: PF1 feat `su` and `sp` are magical; `ex` / `na` are not. Spells are magical by default. Explicit module `saveTraits` flags retain their existing precedence.
* A spell with an explicit school other than `ill` never qualifies for Distraction by tags alone.

## Public Script Call

Register **after** the `distraction` group is established (registration may precede the group's creation, but remains inert until the group exists):

```js
await api.saveOverrides.register({
  actor: bard,
  key: 'distraction',
  groupKey: 'distraction',
  range: 30,
  rangeUnits: 'ft',
  requiresSight: true,
  appliesTo: {
    magical: true,
    anyOf: ['pattern', 'figment']
  },
  mode: 'higher-result',
  priority: 0,
  label: 'Distraction',
  replacement: {
    type: 'actorFlag',
    namespace: 'world',
    key: 'pf1DistractionState',
    path: 'checkTotal'
  }
});
```

The registered rule is intentionally inert unless the matching `effectGroups` group is live. Once stopped or expired it stops applying. The *current* `world.pf1DistractionState.checkTotal` is read for **each** resolved save, not at registration time. Multiple providers choose the highest valid result. Countersong's legacy and explicit descriptor predicates are unchanged.

## Visibility check

The **target who makes the save must see the providing bard**, not the illusion source. When `requiresSight` is true the target must not have the normalized PF1 condition `blind` (also checks Foundry `blinded` status for compatibility). A target different from the bard must have valid scene tokens, be within 30 ft (converted into the current scene's units) and have no `sight`-type collision on the ray from **target center → bard center** through `CONFIG.Canvas.polygonBackends.sight.testCollision`. Missing geometry/backend/collision information fails closed. A bard targeting themself passes range and sight if not blind.

Note: this is a wall/line-of-sight and blindness check, not a complete simulation of darkness, invisibility, lighting or other vision restrictions. The GM must adjudicate those conditions; automated applicability is not proof of actual visual perception. Test v13 wall types/one-way walls in your installed environment.

## Manual repeat saves

There is intentionally **no** persistent-effect tracker, automatic repeat-save prompt, or effect removal. If an ongoing effect permits a new save, the GM can post/use the originating PF1 action again; the same native save override will apply if the source, range, group and sight remain eligible.

## Diagnostics and acceptance

Enable the module's `genericDebug` setting. Console records `Save detected`, `Source`, `Context` (including `pattern`, `figment`, `school`, `subschools`), `Checking rule`, `Source predicate`, `Range check`, `Sight`, `Dynamic replacement`, and the normal/effective totals. Rejection logs identify a missing source descriptor, blindness, range, or obstructed/unknown sight.

Acceptance checklist in real Foundry:

1. PF1 pattern illusion: normal Will 12, Distraction Perform 23, target within 30 ft and sight clear → effective 23 shown on original chat card.
2. PF1 figment illusion: same behavior. Other illusions → not eligible.
3. Target >30 ft, behind a wall, or blinded → unchanged native result.
4. Self-target, 9 m grid, and one-way wall direction → verify correct eligibility.
5. Two bard sources and simultaneous Countersong → highest eligible result wins; sonic-only source uses Countersong, pattern-only uses Distraction.
6. Change `pf1DistractionState.checkTotal` from 17 to 24 and roll again → new value applied.
7. Stop `effectGroups.stopGroup({actor:bard,key:'distraction'})` or let group expire → rule no longer applies.
8. Player 1 bard, Player 2 target, GM controlling monster → one native result and correctly updated chat card; verify after F5.

The code-level test `node tests/distraction.test.cjs` covers simulated cases, **not** a live Foundry world.