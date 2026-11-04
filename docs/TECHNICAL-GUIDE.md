# PF1 Automation Engine v1.10.0 — Technical Guide (English)

**Target environment:** Foundry Virtual Tabletop **v13.351**; Pathfinder 1st Edition system **11.11**.  
**Module ID:** `pf1-automation-engine`.  
**Scope:** reusable automation infrastructure, not a spell compendium or a collection of hardcoded class features.

> **Design contract:** Game Masters decide which spells, feats, traits, and class features need automation. They attach JavaScript to the *existing PF1 Item* on the relevant character sheet. The module provides lifecycle events, approved effect distribution, precise turn deadlines, persistent game-time durations, and cleanup; the Item script decides all PF1 rules.

This document describes the API **as implemented in v1.10.0**, including the v1.9.0 native PF1 actor-rest event bridge. It is not a promise that every native PF1 spell or action is automatically supported. Start with [PF1 Item Script Recipes](PF1-ITEM-SCRIPT-RECIPES.md) if you want copy-and-adapt examples.

## Contents

1. [What this module does and does not do](#1-what-this-module-does-and-does-not-do)
2. [Requirements and installation](#2-requirements-and-installation)
3. [The item-first workflow](#3-the-item-first-workflow)
4. [Finding PF1 Script Calls and their execution context](#4-finding-pf1-script-calls-and-their-execution-context)
5. [Public API map and permissions](#5-public-api-map-and-permissions)
6. [Multi-target effects — api.effectGroups](#6-multi-target-effects--apieffectgroups)
7. [World/combat durations — api.duration](#7-worldcombat-durations--apiduration)
8. [Exact turn deadlines — api.generic](#8-exact-turn-deadlines--apigeneric)
9. [Persistent event subscriptions and discovery](#9-persistent-event-subscriptions-and-discovery)
10. [Legacy managed effects](#10-legacy-managed-effects)
11. [Persistence, timing and multiplayer behavior](#11-persistence-timing-and-multiplayer-behavior)
12. [Security model](#12-security-model)
13. [Debugging and recovery](#13-debugging-and-recovery)
14. [Integration and regression checklist](#14-integration-and-regression-checklist)
15. [Source layout and further reading](#15-source-layout-and-further-reading)
16. [Native PF1 actor rest — v1.9.0](#16-native-pf1-actor-rest--v190)

## 1. What this module does and does not do

**It does:**

- Let approved scripts associated with PF1 Items run on selected Foundry and **native PF1 actor-rest** events.
- Create tracked copies of an approved PF1 **buff Item** or Foundry **ActiveEffect** on selected actors.
- Expire those copies together, at a precise turn boundary or after an elapsed game-time duration.
- Track elapsed time across exploration, Foundry combat rounds, page reloads, and ordinary GM handoffs.
- Keep its persistent records in world settings.
- Elect one active GM to process shared state, to avoid normal two-GM duplication.

**It does not:**

- Implement or maintain a database of PF1 spells, domains, archetypes, or class abilities.
- Compute spell parameters such as caster level, save DC, bonuses, damage, legal targets, line of effect, concentration, or resource cost. The Item script/GM is responsible.
- Automatically enroll every spell/buff that exists on a PF1 sheet.
- Automatically run an Item's normal PF1 **Use** action, roll attacks, consume spell slots, post spell cards, or pay class-feature resources when an automation callback fires.
- Automatically make arbitrary single-effect timer writes from a player account. Those operations require the elected GM; the supported player-request path for distribution is `effectGroups`.
- Replace Foundry's world clock or the Seasons & Stars calendar.
- Guarantee protection against intentionally malicious JavaScript already approved by a GM.

**Implementation rule:** never put a spell-specific conditional in `scripts/generic-automation.js`, `scripts/duration-manager.js`, or `scripts/effect-groups.js`. Store the rule, resource checks, target selection, effect key, and template in the actual spell/feature Item.

## 2. Requirements and installation

- Foundry VTT 13.351 (tested target, not a guarantee for all v13 point releases).
- Pathfinder 1e system 11.11 (tested target).
- At least one **connected active GM** for persistent automation and effect distribution.
- The `pf1-automation-engine` module enabled in the world.

To install the release ZIP, extract it to `Data/modules/pf1-automation-engine/` so `module.json` sits directly inside that directory. Restart Foundry and enable the module in **Manage Modules**. Back up the world before upgrading. Do not simultaneously activate the older `pf1-combat-automation` module: the generic services intentionally disable themselves when the legacy module is active.

Check installation in the browser console (F12):

~~~js
const mod = game.modules.get("pf1-automation-engine");
console.log({
  installed: !!mod,
  active: mod?.active,
  version: mod?.version,
  leader: mod?.api?.generic?.isLeader()
});
console.log(Object.keys(mod?.api ?? {}));
~~~

The v1.8.0 public services include `generic`, `duration`, `effectGroups`, `discovery`, plus the older effect-manager API. Other modules may contribute additional names; use the existence checks above rather than assuming the module is ready during Foundry's `init` hook.

World settings include an **Enable generic automations** switch and a **Generic automation debug logs** switch. Automatic Item declaration discovery has its own enable switch.

## 3. The item-first workflow

A GM configuring **one** character's spell or feature should:

1. Open the actor's sheet and locate or create the relevant **Spell** or **Class Feature/Ability** Item. Work on the *actor-owned copy*, not merely a compendium template.
2. Open the Item's **Advanced → Script Calls** area (French PF1 UI: **Avancé → Appel de script**). Add the appropriate script under **Use**, **After Use**, or **Toggle**, according to when that Item should run its own automation.
3. Put only the ability-specific rules in that script. Call `game.modules.get("pf1-automation-engine").api` for infrastructure.
4. If the feature distributes a buff, create a separate PF1 **buff Item** (or actor-owned ActiveEffect) on the source actor containing the actual mechanical modifiers.
5. Have the elected GM approve that template **once**, *after* its modifiers/scripts are final.
6. Test as the controlling **player** and as the **GM**. Check the resulting effects, timers, permissions, and cleanup.
7. Repeat only for Items the table actually uses.

A Spell Item and a Class Feature Item can both host native PF1 Script Calls. An embedded *buff template* is a separate Item used as the payload; attaching a script to a spell does **not** automatically turn that spell into a buff.

**Important lifecycle distinction:** a native PF1 **Use** script is invoked by the PF1 system as part of the Item's normal use workflow. In contrast, an Engine **event or expiration** invokes only the named script callback. It does not call `item.use()` again. Keep ordinary spell expenditure and spell resolution in the normal PF1 workflow to avoid duplicate execution.

## 4. Finding PF1 Script Calls and their execution context

PF1 11.11 exposes native `ItemScriptCall` models through `item.scriptCalls`; stored script data appears under `item.system.scriptCalls`. Typical categories:

| PF1 category | API `scriptCategory` | Meaning |
| --- | --- | --- |
| Use | `use` | Native Item use, or callback selected for engine execution |
| After Use | `postUse` or alias `afterUse` | Native after-use script |
| Toggle | `toggle` | Native toggle script; useful for native PF1 buff activation/deactivation |

Find the actor-owned Item and inspect its scripts:

~~~js
const actor = canvas.tokens.controlled[0]?.actor;
if (!actor) throw Error("Select a token.");
const item = [...actor.items].find(i => i.name === "MY SPELL OR FEATURE");
if (!item) throw Error("Item not found on selected actor.");

console.table([...(item.scriptCalls?.contents ?? [])].map(c => ({
  id: c.id ?? c._id,
  name: c.name,
  category: c.category,
  type: c.type
})));
console.log("Actor UUID:", actor.uuid, "Item UUID:", item.uuid);
~~~

Prefer the script's **stable internal ID** as `scriptId`; its exact name is also accepted when unique. A callback must select **exactly one** of `scriptId` (with category) or `actionId` (legacy PF1 action script). An ambiguity is an error; it is not resolved arbitrarily.

Within a **native PF1 Item Script Call**, the PF1 system supplies its usual context (including `actor`, `item`, `token`, `shared` and `action`, depending on the call). Engine-triggered calls additionally receive an `event` and `state` plus `api` for the generic service. Because script-call context depends on execution origin, resolve the source actor defensively:

~~~js
const source = item?.actor ?? actor;
const mod = game.modules.get("pf1-automation-engine");
if (!source || !mod?.active || !mod.api?.effectGroups) {
  throw Error("PF1 actor or Automation Engine is unavailable.");
}
// Use source.uuid for stable source identity.
~~~

For a native callback dispatched from `generic.register()`, `event` contains fields such as `type`, `actorUuid`, `itemUuid`, `documentUuid`, `changedPaths`, `buffState`, `round`, `combatId`, `combatantId`, `phase`, and `timing` (fields may be `null`).

**Do not assume** a PF1 Item's current script-call editor exposes the same variable list for every script category. Validate simple console logging in a test Item before relying on exotic variables.

## 5. Public API map and permissions

~~~js
const engine = game.modules.get("pf1-automation-engine")?.api;
if (!engine) throw Error("Automation Engine is not ready.");

const { generic, duration, effectGroups, discovery } = engine;
~~~

| Service | Operation | Who may initiate it |
| --- | --- | --- |
| `effectGroups` | `applyGroup({ actor, key, templateUuid, targets, duration })` | GM or source-owning player; player request is reviewed by elected GM |
| `effectGroups` | `applyGroup({ actor, key, templateUuid, targets, timing })` | Same; combat required |
| `effectGroups` | `extendGroup({ actor, key, rounds })` | GM or source-owning player |
| `effectGroups` | `stopGroup({ actor, key })` | GM or source-owning player |
| `effectGroups` | `approveTemplate(uuid)`, `revokeTemplate(uuid)` | Elected GM only |
| `effectGroups` | `listGroups()`, `listApprovedTemplates()` | Read-only inspection |
| `duration` | `schedule(...)`, `extendTimer(...)`, `cancelTimer(id)` | Elected GM only |
| `duration` | `listTimers()`, `reconcile()` | Inspection/reconciliation; only elected GM mutates |
| `generic` | `scheduleTurn(...)`, `expireEffectAt(...)`, `extendTimer(...)` | Elected GM only |
| `generic` | `schedule(...)`, `cancelTimer(id)` | Elected GM only |
| `generic` | `register(...)`, `unregister(id)` | Elected GM only |
| `generic` | `listTimers()`, `listEvents()`, `isLeader()` | Inspection |
| `discovery` | `approveItem(uuid)`, `revokeItem(uuid)` | Elected GM only |
| `discovery` | `scan()`, `listApproved()`, `status()` | Primarily leader-managed discovery/inspection |

**Player authors should prefer `effectGroups`** for timed effects distributed from a spell/feature. A player calling `duration.schedule()` or `generic.scheduleTurn()` directly will receive a permission error, even if they own the character Item.

`effectGroups.applyGroup()` can target a single actor (including the caster), provided the approved template and permission checks pass. That is the practical player-safe pattern for a one-target timed buff in v1.8.0.

## 6. Multi-target effects — api.effectGroups

**Purpose:** Clone one GM-approved actor-owned buff/ActiveEffect to 1–30 selected beneficiaries, register the group, then remove **only those marked copies** at expiry or on explicit stop.

### 6.1 GM approval of a template

Create and configure a PF1 **buff Item** or Foundry **ActiveEffect** on the source actor. From the console of the **elected GM**:

~~~js
const engine = game.modules.get("pf1-automation-engine").api;
const actor = canvas.tokens.controlled[0]?.actor;
if (!actor) throw Error("Select the caster's token.");
const template = [...actor.items].find(i =>
  i.type === "buff" && i.name === "Protective Ward - Template"
);
if (!template) throw Error("Create the caster-owned buff template first.");

await engine.effectGroups.approveTemplate(template.uuid);
console.log("Approved:", template.uuid);
~~~

An embedded ActiveEffect can also be approved using its UUID.

Approval captures an **exact snapshot** of the template data, including its PF1 scripts. Modifying any part of the template after approval invalidates that approval. The elected GM must approve it again. Approval does not authorize arbitrary text/code submitted by players.

### 6.2 Player-safe invocation from the spell/feature

Example **PF1 Use Script Call** for a hypothetical ward spell (the script chooses targets; PF1 range and spell legality remain the author's responsibility):

~~~js
const source = item?.actor ?? actor;
const template = [...source.items].find(i =>
  i.type === "buff" && i.name === "Protective Ward - Template"
);
if (!template) throw Error("Approved ward template is missing.");

// Replace with your own PF1-valid target selection.
// This sample targets the caster only.
const beneficiaries = [source];

const result = await game.modules.get("pf1-automation-engine")
  .api.effectGroups.applyGroup({
    actor: source,
    key: "protective-ward",
    templateUuid: template.uuid,
    targets: beneficiaries,
    duration: { value: 3, unit: "rounds" }
  });

if (result.submitted) {
  ui.notifications.info("Ward application requested from the GM.");
} else if (result.applied) {
  console.log("Ward group:", result.groupId, result.targetCount);
}
~~~

On the elected GM account, a successful call returns `{applied:true, groupId, targetCount, timerId}`. On a player account, `{submitted:true, requestId}` means **only that the request was sent**, not that the GM accepted or applied it. Rejections are logged on the GM client. Do not consume additional resources or assert application solely because `submitted` is true.

When applied again with the **same source actor and key**, the old group is stopped first and new copies are created. Use `extendGroup()` to lengthen an existing group instead of recalling `applyGroup()`.

### 6.3 Duration mode vs turn-boundary mode

Choose **one**:

~~~js
// Game-time duration: works outside combat, too.
await engine.effectGroups.applyGroup({
  actor: source, key: "protective-ward",
  templateUuid: template.uuid, targets: [source],
  duration: { value: 1, unit: "minutes" }
});

// OR precise combat turn boundary:
await engine.effectGroups.applyGroup({
  actor: source, key: "protective-ward",
  templateUuid: template.uuid, targets: [source],
  combatantId: casterCombatant.id,
  timing: "endOfNextTurn"
});
~~~

The `duration` case consumes **60 elapsed game seconds**, including 10 full PF1 rounds at 6 seconds each. The `timing` case expires at a **specific combatant's turn boundary**; it is not interchangeable with 60 seconds. Never send `timing` and `duration` together.

Permitted `timing` values: `endOfCurrentTurn`, `startOfNextTurn`, `endOfNextTurn`, `turnStart`, and `turnEnd`. For `turnStart`/`turnEnd`, use `occurrences: N` when needed.

### 6.4 Extend, stop, inspect

~~~js
// Player-safe requests; the same key must be used every time.
await engine.effectGroups.extendGroup({
  actor: source, key: "protective-ward", rounds: 1
});
await engine.effectGroups.stopGroup({
  actor: source, key: "protective-ward"
});

// Diagnostic copies, no direct mutation:
console.table(engine.effectGroups.listGroups());
console.log(engine.effectGroups.listApprovedTemplates());
~~~

`extendGroup({rounds:1})` extends a phase deadline by one combat round, or a duration group by **6 game seconds**. The beneficiaries and existing buff Items stay unchanged.

Groups are recorded in `managedEffectGroups`. Each created copy receives a marker in `flags.pf1-automation-engine`. Cleanup is deliberately restricted to these copies. A modified or missing marker prevents unsafe deletion.

### 6.5 Target permissions

The elected GM validates the **source actor**, approved template, and all target UUIDs. For player-originated requests, the player must own the source actor. Eligible targets include the source, player-owned actors, or friendly tokens in the relevant scene, subject to server-side checks. This is **not** an implementation of PF1 spell targeting; scripts must independently enforce range, sight, sound, consent, and the spell's legal target types. Maximum **30** target UUIDs per request.

## 7. World/combat durations — api.duration

**Purpose:** Schedule an expiration in elapsed PF1 game time, independent of whether combat currently exists.

~~~js
const duration = game.modules.get("pf1-automation-engine").api.duration;
console.log(duration.secondsPerRound); // 6
~~~

### 7.1 Units and validation

Valid values are positive **integers** with units `seconds`, `rounds`, `minutes`, or `hours`. The maximum combined duration is **365 days**. One PF1 round is **6 seconds**.

### 7.2 Elected-GM-only direct effect timer

~~~js
// buff is an ACTOR-OWNED PF1 Item of type "buff".
const timerId = "ward-expiry:" + buff.uuid;
await duration.schedule({
  id: timerId,
  effectUuid: buff.uuid,
  effectAction: "disable",
  duration: { value: 1, unit: "minutes" }
});
~~~

Accepted targets are exactly **one** of:

- `effectUuid`: actor-owned PF1 buff Item or ActiveEffect. `effectAction:"disable"` is the default; `"delete"` is valid only for ActiveEffects, **never** a PF1 buff Item.
- `effectGroupId`: internal tracked group, normally scheduled by `effectGroups.applyGroup`; do **not** fabricate these IDs.
- `itemUuid` + `scriptCategory` + `scriptId`: actor-owned PF1 Item and a unique native Script Call to invoke on expiry.

### 7.3 Run only a PF1 cleanup script

~~~js
await duration.schedule({
  id: "cleanup:" + feature.uuid,
  itemUuid: feature.uuid,
  scriptCategory: "use",
  scriptId: "Expiration",
  duration: { value: 30, unit: "seconds" }
});
~~~

The script named `Expiration` must exist on that Item. This callback runs as a **script**, not as a normal Item use. It gets an `event` with `type:"expiry"`, `timing:"duration"`, `worldTime`, `seconds`, `actorUuid` and `itemUuid`. For a player-operated feature, use the `effectGroups` request path unless the elected GM intentionally schedules this callback.

### 7.4 Extension, cancellation and status

~~~js
await duration.extendTimer("ward-expiry:" + buff.uuid, {
  duration: { value: 2, unit: "rounds" }
});
console.table(duration.listTimers());
await duration.cancelTimer("ward-expiry:" + buff.uuid);
await duration.reconcile(); // elected GM rechecks currently due timers
~~~

`schedule()` with an existing `id` replaces that timer. `extendTimer()` adds to the **remaining** time and total, without resetting the original clock. `cancelTimer()` removes the deadline; it does **not** disable the effect. `listTimers()` returns a projected, deep-cloned view at the current game clock.

### 7.5 Clock model

- **Outside combat:** elapsed time derives from positive advances of `game.time.worldTime`. Foundry and Seasons & Stars remain the clock owners.
- **During combat:** elapsed time is the greater of (elapsed complete rounds × 6 seconds) and elapsed world time since combat entry; it is **not their sum**.
- **Leaving combat:** remaining seconds continue against the world clock.
- **F5 / reconnect:** registered anchors and remaining time are kept in world settings (`durationRegistry`); the elected GM rechecks them.
- **Clock rewinds:** moving world time backwards does not grant an effect extra time.

**Caveats:** an external module applying a *late, retrospective* world-time catch-up after combat may produce additional elapsed time that the Engine cannot distinguish from a new manual advance. Multiple simultaneous combats and atypical token ownership/initiative changes need table-specific verification. This is a game-time clock, **not** a wall-clock countdown.

## 8. Exact turn deadlines — api.generic

Use this service when the effect must end **at the start/end of the caster's turn**, rather than after N × 6 seconds. These functions require an active, started Combat and are **GM-only**.

~~~js
const generic = game.modules.get("pf1-automation-engine").api.generic;

// Direct PF1 buff or ActiveEffect expiration:
await generic.expireEffectAt({
  id: "turn-expiry:" + buff.uuid,
  effectUuid: buff.uuid,
  combatId: game.combat.id,
  combatantId: casterCombatant.id,
  timing: "endOfNextTurn",
  effectAction: "disable"
});
~~~

Timing values:

| Timing | Boundary |
| --- | --- |
| `endOfCurrentTurn` | Leave the currently active chosen combatant's turn (it must currently be that combatant's turn) |
| `startOfNextTurn` | The chosen combatant next begins a turn |
| `endOfNextTurn` | The chosen combatant next completes a future turn; if it is their turn now, their current turn end does not count |
| `turnStart` | Nth subsequent start, with `occurrences:N` |
| `turnEnd` | Nth subsequent end, with `occurrences:N` |

The actual target is anchored as an absolute `targetRound` in `timerRegistry`. In v1.8.0, the engine also rechecks absolute phase deadlines on combat document updates after F5, to recover cases where `combatTurnChange` supplies incomplete history.

For a direct script callback instead of an effect UUID:

~~~js
await generic.scheduleTurn({
  id: "turn-cleanup:" + feature.uuid,
  itemUuid: feature.uuid,
  scriptCategory: "use",
  scriptId: "Expiration",
  combatId: game.combat.id,
  combatantId: casterCombatant.id,
  timing: "startOfNextTurn"
});
~~~

Other methods:

- `generic.extendTimer(id, {rounds:1})`: postpone an existing **phase** deadline; elected GM only.
- `generic.cancelTimer(id)`: cancel phase or legacy timer; elected GM only.
- `generic.listTimers()`: inspect phase/legacy timers.
- `generic.schedule({id,itemUuid,scriptCategory,scriptId,unit:"rounds"|"turns",amount,...})`: older combat-only counter timers; do **not** confuse with `duration.schedule()` for exploration time.

**Use the service that matches the question:** turn boundary → `generic.scheduleTurn()`; actual elapsed rounds/minutes → `duration.schedule()`; effects triggered by players and cloned from templates → `effectGroups.applyGroup()`.

## 9. Persistent event subscriptions and discovery

### 9.1 Manual event subscription

GM-only `generic.register()` links a Foundry event to a script already stored on an Item.

~~~js
const generic = game.modules.get("pf1-automation-engine").api.generic;

await generic.register({
  id: "feature-sync:" + feature.uuid,
  on: "updateActor",
  itemUuid: feature.uuid, // contains the native Script Call
  scriptCategory: "use",
  scriptId: "Synchronize",
  filter: {
    actorUuid: feature.actor.uuid,
    properties: ["system.resources"]
  }
});
~~~

Supported `on` values: `updateActor`, `updateItem`, `createItem`, `deleteItem`, `createActiveEffect`, `updateActiveEffect`, `deleteActiveEffect`, `ready` and `combatTurnChange`.

Filters: `actorUuid`, `documentUuid`, `itemUuid`, `tag`, `properties` (array of matching or parent/child data paths), and `buffState` (`active`/`inactive`). Fields omitted from `filter` impose no extra restriction. Tags are taken from the triggering document's `flags.pf1-automation-engine.tags`.

~~~js
console.table(generic.listEvents());
await generic.unregister("feature-sync:" + feature.uuid);
~~~

`ready` runs when the elected GM's client initializes the world; registering a new ready subscription mid-session does **not** run it retroactively. The event listener executes **only** the approved script callback, not a normal PF1 Item use.

### 9.2 Declarative Item discovery (optional)

Item flags can carry event **declarations** so the GM does not need to maintain an external macro for every subscription. The declaration is **not executable code**. The elected GM must explicitly approve the current declaration/script snapshot.

Example, from an elected-GM setup macro for an actor-owned feature:

~~~js
await feature.setFlag("pf1-automation-engine", "automations", [{
  id: "sync-resources",
  on: "updateActor",
  scriptCategory: "use",
  scriptId: "Synchronize",
  filter: {
    actorUuid: feature.actor.uuid,
    properties: ["system.resources"]
  }
}]);

await game.modules.get("pf1-automation-engine")
  .api.discovery.approveItem(feature.uuid);
~~~

The system discovers candidate declarations on world Items, actor-owned Items, and synthetic actors for unlinked scene tokens. `discovery.approveItem(itemUuid)` validates declarations and their target scripts; it stores a precise snapshot of the declaration **and referenced Item scripts**. Editing either invalidates approval until the GM reapproves it.

~~~js
const d = game.modules.get("pf1-automation-engine").api.discovery;
console.log(d.status());
console.table(d.listApproved());
await d.revokeItem(feature.uuid);
~~~

At most **50** rules may be declared on one Item. Rule IDs must be unique. Discovery is an *opt-in event-registration system*, not a UI for automatically converting arbitrary spell descriptions into scripts.

## 10. Legacy managed effects

The older effect-manager API (`api.startEffect` / `api.stopEffect`) exists for backward compatibility and uses its original turn-count logic. Do not assume its `durationTurns` option behaves like the newer game-time `duration` objects. For new player-authored spells and class features, prefer `api.effectGroups`, which provides template approval, tracking, turn deadlines, and v1.8.0 durations.

Old world migration and identifier compatibility are described in [MIGRATION-V1.5.md](../MIGRATION-V1.5.md). Do not simultaneously run `pf1-combat-automation` and `pf1-automation-engine`.

## 11. Persistence, timing and multiplayer behavior

The Engine maintains distinct registries in world settings:

| World setting | Meaning |
| --- | --- |
| `eventRegistry` | Manually registered event subscriptions |
| `timerRegistry` | Legacy combat counters and precise phase deadlines |
| `durationRegistry` | Elapsed-time deadlines in seconds, including combat/world anchors |
| `managedEffectGroups` | Multitarget group identities and managed copies |
| `effectTemplateApprovals` | Approved exact template snapshots |
| `autoApprovals` | Approved declarative Item event rules |
| `genericEnabled` / `genericDebug` | Generic engine and debug settings |
| `autoDiscoveryEnabled` | Declarative discovery switch |

The **elected GM** is the connected, active GM with the lexicographically smallest Foundry user ID. Other GMs can inspect state, but they should not independently write the timer registries. All clients read the same world settings, and the leader handles cleanup. Ordinary disconnection/reconnection and handoff with two GMs were validated during v1.8.0 testing; settings are not distributed transactional locks and exotic simultaneous handoffs may still race.

**Re-entrancy:** handlers suppress selected recursive executions and serialize timer writes. Authors should still design scripts to be idempotent. For direct updates that must not trigger the Engine's own subscription handlers, pass options:

~~~js
await someDocument.update(
  { "system.example": 1 },
  { "pf1-automation-engine": { skip: true } }
);
~~~

This suppresses the Engine's generic hook dispatch, **not** all Foundry/PF1 system hooks. It should be used selectively.

## 12. Security model

- Only the elected GM can approve Item declaration snapshots, approve buff templates, and write generic/duration timers directly.
- Player effect-group requests refer to **UUIDs**, approved templates and source actors. They do not contain arbitrary executable source text.
- A player request must pass source actor ownership, target eligibility, valid key, duration/timing validation and template fingerprint checks.
- Native Item scripts themselves run with the context/permissions of their execution path. GM-executed approved callbacks can perform privileged actions; the approval step is a **trust decision**, not a JavaScript sandbox.
- The existing Foundry socket request format does **not** cryptographically prove the remote sender's claimed `userId`. Use this module in a trusted game group and do not describe its socket checks as a general security boundary against hostile clients.
- Do not paste unreviewed JavaScript from another source into an actor's scripts. Back up actor Items before changing templates.

## 13. Debugging and recovery

**Start here:**

~~~js
const mod = game.modules.get("pf1-automation-engine");
const api = mod?.api;
console.log({
  version: mod?.version,
  active: mod?.active,
  leader: api?.generic?.isLeader(),
  user: game.user.name,
  worldTime: game.time.worldTime,
  combat: game.combat?.id,
  round: game.combat?.round,
  turn: game.combat?.turn
});
console.table(api?.generic?.listTimers() ?? []);
console.table(api?.duration?.listTimers() ?? []);
console.table(api?.effectGroups?.listGroups() ?? []);
console.table(api?.generic?.listEvents() ?? []);
~~~

| Symptom | Likely cause / next step |
| --- | --- |
| `api` is undefined | Module inactive or world not at `ready` |
| `Only elected GM` / permission error | Running a direct writer from a player or second GM; use `effectGroups`, or have the elected GM perform setup |
| `submitted:true` but no buff appears | Request queued, not guaranteed successful; inspect elected GM console for rejection and check approval/ownership |
| `Template not approved or modified` | Approve the actor-owned model again after finishing edits |
| `No target script / ambiguous script` | Check `item.scriptCalls` ID, category and exact name; use stable ID |
| Timer missing in `generic.listTimers()` | It may be a **duration** timer instead; inspect `api.duration.listTimers()` |
| Buff expires only after an initiative rewind | Confirm v1.8.0 including the post-F5 `updateCombat` phase reconciliation fix; retest normal forward turn advancement |
| Effect remains after it should expire | Inspect timer's `due`, target UUID availability, GM connectivity, errors and copied Item flags |
| Timer survived but effect did not | PF1 native duration/other automation may also be controlling the effect; avoid competing expiry systems |
| Extra elapsed time when combat ends | Check whether the calendar performed a retrospective world-time catch-up |
| Event not firing after script edit | Declarative approval snapshot was invalidated; reapprove the Item |

Some `generic` phase timers with unavailable target documents remain `due:true` for retry. Duration expirations also keep failed attempts for later reconciliation. Be careful when manually deleting registry entries: that can strand a buff with no automatic cleanup.

## 14. Integration and regression checklist

Test new Item scripts in a **copy of the world** and document the results. At minimum:

- [ ] Verify the Item's Script Call runs exactly when its native Use/After Use/Toggle behavior requires.
- [ ] Verify PF1 resource, slot, action and target restrictions independently of the automation engine.
- [ ] Approve the exact actor-owned buff/ActiveEffect template from the elected GM.
- [ ] Trigger the script as a **player**. Check the GM receives and accepts the effect-group request.
- [ ] Verify only intended beneficiaries receive the modifiers and that pre-existing Items remain unchanged.
- [ ] Test end-of-turn expiration in a real Combat.
- [ ] Test F5 **before** the expiration boundary, then advance forward once; no rewind should be required.
- [ ] Test a duration outside combat using Seasons & Stars or Foundry's world time.
- [ ] Test partial-duration combat → exploration and exploration → combat transitions.
- [ ] Test group extension without creating duplicate buff copies.
- [ ] Test two connected GMs, leader disconnect, second-GM takeover, and reconnect.
- [ ] Verify `generic.listTimers()`, `duration.listTimers()`, `effectGroups.listGroups()` are cleaned up.
- [ ] If using Item declaration discovery, modify a script and verify approval becomes invalid.
- [ ] Check actor-linked vs synthetic token behavior for your table.

**Validated on the project's real Foundry table for v1.8.0:** one-minute world-time expiration, persistence after F5, 1 minute / 10 rounds conversion, combat → exploration carryover, extension outside combat, six two-GM scenarios, and the post-F5 `endOfNextTurn` fix for an Inspiration-type multicaster effect. Other edge cases still warrant regression tests.

## 15. Source layout and further reading

| File | Responsibility |
| --- | --- |
| `scripts/generic-automation.js` | Persistent event dispatch, legacy turn counters, absolute phase expiration and post-F5 phase reconciliation |
| `scripts/duration-manager.js` | Persistent game-time durations spanning combat and exploration |
| `scripts/effect-groups.js` | GM-approved template cloning, secure-ish player requests, group lifecycle and cleanup |
| `scripts/auto-discovery.js` | Approved declarative event rules on PF1 Items |
| `scripts/effect-manager.js` | Legacy managed-effect API |
| `scripts/module-migration.js` | Old namespace migration |
| `tests/*.test.cjs` | Node simulation coverage |
| `.github/workflows/build-zip.yml` | Windows build, tests and release ZIP artifact |

For practical snippets, see [PF1 Item Script Recipes](PF1-ITEM-SCRIPT-RECIPES.md). Existing French-language references remain available in [API-GENERIQUE.md](../API-GENERIQUE.md), [API-EXPIRATIONS.md](../API-EXPIRATIONS.md), [API-EFFETS-GROUPES.md](../API-EFFETS-GROUPES.md), [API-DUREES.md](../API-DUREES.md), and [API-SCRIPTS-OBJET.md](../API-SCRIPTS-OBJET.md).

## 16. Native PF1 actor rest — v1.9.0

The engine now accepts two additional `generic.register()` event names:

- `pf1PreActorRest` — an observational callback with a **synchronous before-rest snapshot** captured before native PF1 writes.
- `pf1ActorRest` — an observational callback after PF1 has applied the actor's native rest and daily-recharge changes; receives **before and after** snapshots.

The initiating client may be a player. Rest notifications are relayed to the elected GM, which resolves the actor, checks relay ownership and dispatches only existing registered Item scripts. Notifications are deduplicated per rest/phase and serialized per actor. No kineticist/Burn rules are part of the runtime.

### Register an eight-hour full-rest callback (GM setup)

~~~js
const api = game.modules.get("pf1-automation-engine").api.generic;
const feature = game.actors.getName("EXAMPLE CHARACTER")
  .items.getName("EXAMPLE FEATURE");

await api.register({
  id: "complete-rest:" + feature.uuid,
  on: "pf1ActorRest",
  itemUuid: feature.uuid,
  scriptCategory: "use",
  scriptId: "Repos complet",
  filter: {
    actorUuid: feature.actor.uuid,
    rest: { minHours: 8, restoreHealth: true, restoreDailyUses: true }
  }
});
~~~

The Script Call should inspect `event.rest.hours`, `event.rest.kind`,
`event.rest.atLeastEightHours`, `event.rest.isFullRest`,
`event.rest.before`, `event.rest.after` and
`event.rest.nativeUpdates`. The classification reflects the native rest
**options**; it does not determine when a specific class feature recovers.

**Prevent double healing:** the module does not modify health. The PF1 post-rest
script must not zero all nonlethal damage or apply the native rest's healing
again. An ability that must selectively remove its own nonlethal damage needs
source-specific attribution tracked by the Item's own script.

**Limits:** native rest events are transient, not persistent timers; an absent GM may miss a player's rest. The synchronous pre-hook cannot wait for the asynchronously relayed Item callback, so it is not suitable as a native veto. The socket's claimed user ID is not cryptographically authenticated. Test ownership and GM failover in a trusted table.

**Full documentation:** [Native PF1 Rest Hooks](PF1-NATIVE-REST.md) contains the native hook signatures, full event schema, rest-kind table, filters, and a Burn Item registration example.

**Compatibility discipline:** this guide documents current v1.9.0 behavior. Any future actor-sheet scripting UI, universal player-side timer relay, automatic caster-level formula parsing or spell database would be a separate feature, not part of this API.


## 17. Compendium buff templates — v1.10.0

The elected GM may approve a PF1 Item of type `buff` directly from a Compendium via `api.effectGroups.approveTemplate("Compendium.scope.pack.Item.id")`. The Compendium item remains unmodified; the Engine makes **new actor-embedded PF1 buff copies** on targets and manages their activation, group flags and expiration. The source Actor **does not** need to carry a technical buff.

Existing actor-owned buffs and ActiveEffects preserve source-actor ownership requirements and the previous clone flow. Newly approved templates store a structured record with the UUID, template type, diagnostic hash and **exact canonical content fingerprint**. The full fingerprint is checked on every application and invalidates approval when model content changes. Existing v1.9.x fingerprint-string approvals continue to work.

The Compendium path is available to **player-originated effect-group requests** only after approval by the elected GM. Calling `approveTemplate()` from a player's Script Call is not supported; use a GM setup macro and a separate player-side `effectGroups.applyGroup()` invocation.

**Documentation and examples:** [Compendium Buff Templates](COMPENDIUM-BUFF-TEMPLATES.md).
