# PF1 Automation Engine — v1.11.1

**Foundry Virtual Tabletop 13.351 · Pathfinder 1st Edition system 11.11**

A lightweight, **rules-neutral automation engine** for Pathfinder 1e. It is deliberately **not** a universal spell or class-feature implementation.

## Philosophy: automate only what your table uses

The GM adds JavaScript to the **native PF1 Script Calls** of the **Spell** or **Class Feature** Items on the players' character sheets (**Advanced → Script Calls**, French UI: *Avancé → Appel de script*). These Item scripts implement their own Pathfinder rules, decide which targets are legal, and call the Engine for generic services such as:

- **Managed buffs/ActiveEffects** applied to one or several beneficiaries from an approved Actor-owned template **or a PF1 buff stored directly in a Compendium**.
- **Precise turn deadlines** (start/end of a particular combatant's turn), persistent across reloads.
- **Elapsed game-time durations** (seconds, rounds, minutes, hours) spanning combat and exploration.
- **Event-driven automations** linked to a named PF1 Item Script Call.
- **Save-result override infrastructure** with dynamic Actor flags, hearing/range checks and one elected-GM result comparison for annotated native PF1 saving throws.
- **Native PF1 actor rest hooks** (`pf1PreActorRest` and `pf1ActorRest`): before/after snapshots, 8-hour filtering, independent health/daily-recharge flags and player-to-GM relay.
- **GM approval, persistent registries, controlled player requests and one elected GM** when multiple GMs are connected.

No spell catalogue, class-specific handler, or exhaustive rule database is bundled. An ordinary GM can configure **only the spells/features actually needed in their campaign**, without modifying module source code.

## English documentation

**Start here:**

- **[Technical Guide — architecture, complete API reference, permissions, persistence and debugging](docs/TECHNICAL-GUIDE.md)**
- **[PF1 Item Script Recipes — 12 practical recipes for spells, class abilities, buffs, duration timers, maintenance and cleanup](docs/PF1-ITEM-SCRIPT-RECIPES.md)**
- **[Native PF1 Rest Hooks — actor rest events, complete vs partial rest, before/after state, Burn registration](docs/PF1-NATIVE-REST.md)**
- **[Compendium Buff Templates — GM approval, content fingerprints and caster Item Script Calls](docs/COMPENDIUM-BUFF-TEMPLATES.md)**
- **[Saving Throw Overrides — PF1 native hook behavior, Countersong integration, GM resolution and limitations](docs/SAVE-OVERRIDES.md)**

The technical guide explains why direct world-registry timer writes are reserved for the elected GM, while player-used spells should ordinarily call `api.effectGroups.applyGroup()` with a pre-approved Actor or Compendium buff template. The recipes include examples for both paths.

## Quick start

1. Install the Engine from the Foundry ZIP in `Data/modules/pf1-automation-engine/`; `module.json` must be at the folder root. Restart Foundry and enable the module.
2. On the actor's sheet, open the Spell or Class Feature Item and create a native PF1 **Use** or **After Use** Script Call.
3. For a timed bonus, create an actor-owned **buff Item** or ActiveEffect template with the actual PF1 modifiers, then have the **elected GM** approve its UUID via `api.effectGroups.approveTemplate()`.
4. In the spell/feature Item's script, call `api.effectGroups.applyGroup({actor,key,templateUuid,targets,duration})` or the precise-turn `timing` variant. Test using the actual player account.
5. Check the active groups/timers in the console; see the [recipes](docs/PF1-ITEM-SCRIPT-RECIPES.md).

~~~js
// Browser console: diagnostics
const mod = game.modules.get("pf1-automation-engine");
console.log({ version: mod?.version, leader: mod?.api?.generic?.isLeader() });
console.table(mod?.api?.effectGroups?.listGroups() ?? []);
console.table(mod?.api?.duration?.listTimers() ?? []);
console.table(mod?.api?.generic?.listTimers() ?? []);
~~~

**Permissions:** `duration.schedule()`, `generic.scheduleTurn()`, event registration and template approvals are GM-only. Player-originated `effectGroups` requests are validated by the elected GM. A `submitted:true` response means a request was sent, **not** that it succeeded.

**Clock:** Foundry/Seasons & Stars owns `game.time.worldTime`. The Engine observes this clock but never advances, pauses or resumes it. One PF1 round is six seconds.

## Save override fix — v1.11.1

PF1 abilities with `system.abilityType === "su"` are magical, and the native PF1 `system.tags` set now supplies sonic/language-dependent descriptors. The API accepts explicit `appliesTo:{magical:true,anyOf:["sonic","languageDependent"]}`, while legacy booleans keep their previous OR behavior.

`rollWithContext()` now **awaits the elected GM** and returns `{nativeResult,processed,normalTotal,effectiveTotal,changed,winner,candidates}`. The native PF1 roll still displays its original value; the module posts one effective-result chat summary and sets the original ChatMessage flag. See [Save Overrides](docs/SAVE-OVERRIDES.md).

## Saving throw overrides — new in v1.11.0

Data-only, persistent rules registered by the bard's/ability's PF1 Script Call can compare the **current** value of an Actor flag with an actual saving throw total, subject to source Item spell descriptors, range, scene, hearing and a live effect group. The elected GM produces one compact summary and a reusable `pf1aeSaveOverrideResolved` hook. There is no class-specific Countersong code in the engine.

**Important:** PF1's post-save hook lacks originating Item metadata and runs after the native roll is resolved. The Engine requires an explicitly **annotated** saving throw (`api.saveOverrides.rollWithContext`) to avoid accidentally applying Countersong to unrelated saves; a normal unannotated save remains untouched. This version exposes an effective result but does **not** rewrite native PF1 dice or completed action outcomes.

[See the full saving throw API and Countersong Script Call example](docs/SAVE-OVERRIDES.md).

## Approved Compendium buff templates — new in v1.10.0

An elected GM can now approve a PF1 `buff` stored in a Compendium. A player's PF1 Spell or Class Feature Script Call can then use its canonical `Compendium.scope.pack.Item.id` UUID directly in `effectGroups.applyGroup()`. No technical buff is required on the caster. Existing actor-owned templates and ActiveEffects work as before.

Every application resolves the current pack item and verifies its **exact canonical content fingerprint**; changing the template after approval requires new GM approval. The group creates tracked, embedded PF1 buff copies on each target and reuses the existing extension, expiry, cleanup, multiplayer and F5 behavior.

**[See the full Compendium template guide](docs/COMPENDIUM-BUFF-TEMPLATES.md).**

## PF1 native rest — new in v1.9.0

The Engine now observes PF1's native rest flow for the actor who actually rests, including rests initiated by a player. The before-rest hook captures health/resources **before PF1 commits its healing**, and the after-rest hook exposes both snapshots as `event.rest.before` and `event.rest.after` to approved Item Script Calls.

The Engine does not implement class mechanics or apply extra healing. A callback can filter on `rest.minHours:8`, `restoreHealth`, and `restoreDailyUses`; these are distinct options, not interchangeable evidence of a full rest.

**[Read the native-rest integration and GM registration guide](docs/PF1-NATIVE-REST.md).**

## Existing French technical references

The earlier API notes remain available as additional implementation references:

- [Generic events and timers](API-GENERIQUE.md)
- [World-time and combat durations v1.8.0](API-DUREES.md)
- [Multi-target effect groups](API-EFFETS-GROUPES.md)
- [Precise turn expiration](API-EXPIRATIONS.md)
- [PF1 native Item Script Calls](API-SCRIPTS-OBJET.md)
- [Namespace migration](MIGRATION-V1.5.md)

Some historical documents retain their original version headers; the English guides cover v1.8.0 core APIs; the [rest guide](docs/PF1-NATIVE-REST.md) documents the v1.9.0 addition.

## Contributing / building

The Windows build script is `build_release.ps1`. GitHub Actions runs the Node regression suite and produces an installable Foundry ZIP on pull requests or manual workflow runs. Developers should keep class, spell, ancestry and archetype rules **out of the Engine**; those belong in actor-owned PF1 Item scripts and templates.

**Compatibility:** target versions are Foundry v13.351 and PF1 11.11. The Engine was tested in a live world for the v1.8.0 duration and turn features. Native rest hooks in v1.9.0 require live-world acceptance testing, especially player-initiated rests and two-GM handoff. Other combinations and exceptional edge cases should be validated before use in a live campaign.
