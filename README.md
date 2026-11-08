# PF1 Automation Engine — v1.12.9

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

## Native save outcomes dispatch (v1.12.5)

`api.saveOutcomes.resolve(event)` is GM-only and called automatically by the
existing `saveOverrides` elected-GM handler for **every** native Action-card save
with verified source metadata, even when no override matches. The native PF1
save is never re-rolled. Fate is determined from the final effective total
against the numeric DC stored on the source PF1 Action card. The originating
`sourceMessageId` and generated `saveMessageId` remain distinct and are
required. Never call `resolve()` directly from a player Script Call.

## Distraction (v1.12.2)

Distraction can use the existing `saveOverrides.register()` API with `appliesTo: {magical:true,anyOf:["pattern","figment"]}` and `requiresSight:true`. See [Distraction API and testing](docs/DISTRACTION.md). This release does not add persistent-effect tracking or automatic repeat saves.

## Save Outcomes (v1.12.3 experimental)

Generic GM-authoritative consequences of native PF1 saving throws. After the existing Save Override resolver provides `effectiveTotal`, a registered rule can apply an **individually identified ActiveEffect** to an exact target on failure. The effect is stored as a managed copy of its parent `effectGroups` session, so maintenance, expiry and stopping the parent group preserve and remove it correctly. Includes socket acknowledgement, source Action/Item matching, target matching, deduplication and verified Action-card DC. No second save roll or automatic 24-hour immunity.

See [Save Outcomes API — Fascination recipe and limitations](docs/SAVE-OUTCOMES.md).

## Save Outcomes Action lookup fix — v1.12.4

`saveOutcomes.register()` now reads the native PF1 `item.actions` Collection first and uses `item.system.actions` only as a legacy fallback. For a single `ItemAction`, `sourceActionId` can be omitted and its real `id` is retained for matching native Action-card save context. On multi-Action Items, pass the explicit `sourceActionId`. `onFailure.statusId` can be omitted or `null`; the optional `"fascinated"` status is included only if PF1 registers that condition. The final save-resolution pipeline remains unchanged.

## Silent multi-target automation (v1.12.6)

The elected GM now automatically processes player-owned source Actor group requests; no interactive approval button or dialog is involved. `applyGroup`, `extendGroup` and `stopGroup` return **acknowledged results**, not `{submitted:true}`. Targets may be owned by different players or by the GM. The item Script Call must still select rule-legal targets (range, hearing and sight); engine GM-side validation checks provenance, template restrictions and source ownership.

`approveTemplate(templateUuid)` silently approves eligible passive, actor-owned templates on player request. For Compendium buffs, `approveTemplate(templateUuid)` performs a passive-template preflight without privileged approval; `applyGroup` checks source Actor OWNER and approves automatically. The optional `approveTemplate({actor,templateUuid})` form performs source-owner validation immediately. Previously GM-trusted advanced scripted templates retain their approval. Newly requested templates with executable Script Calls or macros are rejected instead of allowing a player to run arbitrary code on GM-controlled Actors.

See [Silent EffectGroup requests](docs/SILENT-EFFECT-GROUPS.md) for the API, safety restrictions, debugging and multiplayer test plan.

## English documentation

**Start here:**

- **[Technical Guide — architecture, complete API reference, permissions, persistence and debugging](docs/TECHNICAL-GUIDE.md)**
- **[PF1 Item Script Recipes — 12 practical recipes for spells, class abilities, buffs, duration timers, maintenance and cleanup](docs/PF1-ITEM-SCRIPT-RECIPES.md)**
- **[Native PF1 Rest Hooks — actor rest events, complete vs partial rest, before/after state, Burn registration](docs/PF1-NATIVE-REST.md)**
- **[Compendium Buff Templates — GM approval, content fingerprints and caster Item Script Calls](docs/COMPENDIUM-BUFF-TEMPLATES.md)**
- **[Saving Throw Overrides — PF1 native hook behavior, Countersong integration, GM resolution and limitations](docs/SAVE-OVERRIDES.md)**

The technical guide explains why direct world-registry timer writes are reserved for the elected GM, while player-used spells should ordinarily call `api.effectGroups.applyGroup()` with a validated Actor or Compendium buff template. The recipes include examples for both paths.

## Quick start

1. Install the Engine from the Foundry ZIP in `Data/modules/pf1-automation-engine/`; `module.json` must be at the folder root. Restart Foundry and enable the module.
2. On the actor's sheet, open the Spell or Class Feature Item and create a native PF1 **Use** or **After Use** Script Call.
3. For a timed bonus, create an actor-owned **buff Item** or ActiveEffect template with the actual PF1 modifiers, then let `applyGroup()` automatically validate its contents. Explicit `approveTemplate()` is optional for eligible passive templates.
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

## Native action card save reference fix — v1.12.1

The native PF1 saving throw button normally forwards the source Action ChatMessage UUID in the `reference` roll option. `saveOverrides` now resolves that message directly during `pf1PreActorRollSave` (no HTML dependency). It verifies `itemSource`, `actionSource`, `save.type` and `save.dc`, then delegates one native save to the elected GM.

When a public save is **improved** by an override, the Engine persists the per-target effective result on the originating action ChatMessage and displays it beside the corresponding target. The genuine PF1 roll is never altered. Private/blind saves never write their totals to a public card. A guarded wrapper for older `targetSavingThrowClick` implementations logs the actual native handler call without replacing the original function's behavior.

See [Native Save Context](docs/NATIVE-SAVE-CONTEXT.md) for test instructions and limitations. The final UI requires acceptance testing in the actual PF1 11.11 installation.

## Native PF1 action-card saving throws — v1.12.0

The Engine now preserves the source Item/Action, saving throw type and DC on **native PF1 action chat cards** and restores this context when a player clicks PF1's original save control. All rolling remains native (dialogs, bonuses, conditional modifiers, chat mode, privacy). The already-validated elected-GM `saveOverrides` resolver produces the effective result and at most one summary per save. Manual sheet saves are deliberately unannotated.

**[Native Save Context API, limitations and in-world acceptance instructions](docs/NATIVE-SAVE-CONTEXT.md).** A live check of the installed PF1 11.11 chat control's DOM is required; CI exercises simulated PF1 hooks only.

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

## Native PF1 SaveBridge v1.12.8

The engine observes the verified `pf1PreActorRollSave(actor,options,saveType)` and `pf1ActorRollSave(actor,ChatMessagePF,saveType)` hooks. Enable generic debug logging to see `SaveBridge PRE`, `PRE options`, `POST`, and `Source context restored`. Only a verified source-card context is routed to the elected GM and to `saveOutcomes`; manual sheet rolls are ignored. Simultaneous ambiguous rolls fail closed.

## SaveBridge initialization diagnostics (v1.12.9)

On F5 with **genericDebug enabled**, the browser console should display
`[PF1AE][SaveBridge] Installed PF1 save hooks` and
`[PF1AE][SaveBridge] SaveBridge ready`, including the `genericEnabled` setting.
For **every** native PF1 save, PRE and POST logs should appear even if the
**genericEnabled** automation toggle is off. In that case the logs explicitly
report `automation disabled` and no buffs/overrides/outcomes are processed.
An empty rules registry never prevents hook installation. A missing installation
message after F5 suggests the module file did not execute at initialization;
check the browser console for module import errors and installed source version.

## Timed official PF1 conditions after a save (v1.13.0)

`api.saveOutcomes.register()` now accepts `onFailure.statusId` for IDs present in the *current* `pf1.registry.conditions` and `onFailure.duration:{rounds:1,expire:'sourceTurnStart'}` for standalone effects such as Stunning Fist. Other duration modes: `sourceTurnEnd` or `elapsed`, and `{seconds:N,expire:'elapsed'}`. During combat a source turn-boundary timer is used; outside combat a round is six elapsed game seconds. Standalone timed outcomes do **not** need an active `effectGroups` group and are consumed once per target. Existing undurationed Fascination remains linked to its parent group. Unknown immunity data rejects newly requested conditions with a GM warning; no silent bypass. See `docs/SAVE-OUTCOMES.md`.

## Attack Outcomes — v1.14.0 (experimental)

`api.attackOutcomes` tracks exact PF1 Action chat cards and the native damage-application dialog. It triggers a configured follow-up ItemAction only after verified, applied damage to a registered target. See [API, limitations and tests](docs/ATTACK-OUTCOMES.md) and the [complete configurable Stunning Fist Script Call](scripts-exemples/coup-etourdissant-utilisation.js). A confirmed native PF1 message and attack index are mandatory; no HP-only inference. Live PF1 v11.11 acceptance remains required.
## v1.14.1 — Native PF1 damage dialog bridge

The non-configurable `ActorPF.prototype.applyDamage` getter/setter is untouched. Attack Outcomes now waits for the native `pf1.applications.ApplyDamage._onApply` handler to finish and requires matching `pf1ApplyDamageTargetOptions` and `pf1ApplyDamage` hooks for the exact card, attack index and target, followed by observed actual HP/nonlethal loss. No simple HP watcher, no direct Actor prototype assignment. See [Attack Outcomes](docs/ATTACK-OUTCOMES.md).
