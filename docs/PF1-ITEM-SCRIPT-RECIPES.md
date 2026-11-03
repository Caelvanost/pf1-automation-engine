# PF1 Automation Engine — Item Script Recipes (English)

**Foundry VTT 13.351 · Pathfinder 1e 11.11 · Engine v1.8.0**

This cookbook is written for Game Masters who want to automate **only the spells and class features actually used by their players**. All examples are deliberately generic: the GM defines actual Pathfinder rules, bonuses, costs, legal targets and durations inside the Item and its associated buff templates.

**Read first:** [Technical Guide](TECHNICAL-GUIDE.md) for complete API semantics, permission boundaries, data persistence, and limitations.

> **Most important rule:** You do **not** need to edit the Engine source or create a custom module for each spell. Edit an actor-owned PF1 **Spell** or **Class Feature** Item; put the JavaScript in **Advanced → Script Calls** (French: **Avancé → Appel de script**); let that script call the Engine's API. Where a timed bonus is needed, attach the modifiers to a *separate actor-owned PF1 buff Item* or ActiveEffect template.

## Before you begin: three things to distinguish

1. **Spell/feature Item** — the Item the player uses. Contains a native **Use** or **After Use** Script Call that starts automation. It remains on the character sheet.
2. **Buff/ActiveEffect template** — a different, caster-owned effect containing the PF1 mechanics (AC bonus, attack bonus, condition, etc.). The elected GM approves it.
3. **Managed copy** — a temporary copy created by the Engine on the beneficiaries, then removed at the expiration or by `stopGroup()`.

A Spell Item is **not automatically** a PF1 buff template. Model approval is not optional for player-originated effect distribution.

### Recommended setup for each new automated spell/feature

- [ ] Add the intended Spell/Class Feature Item to the **caster's actor sheet**.
- [ ] Configure its normal PF1 action/casting rules and resource costs using the PF1 system.
- [ ] Add a **Use** or **After Use** Script Call with a descriptive name, e.g. `Apply Ward`.
- [ ] If necessary, create a separate **PF1 buff Item** on the caster containing the actual numerical modifiers, e.g. `Ward - Template`. Leave that template inactive.
- [ ] Ask the **elected GM** to approve the buff/ActiveEffect template once.
- [ ] Put one of the recipes below inside the Spell/Class Feature Item's Script Call.
- [ ] Test it while logged in as the **player**, not just while using the GM account.
- [ ] Confirm cleanup and timers via the console tools below.

## Recipe 1 — Confirm the Engine and source actor

Place this short check at the beginning of your Item scripts:

~~~js
const source = item?.actor ?? actor;
const mod = game.modules.get("pf1-automation-engine");
if (!source) throw Error("No actor is associated with this PF1 Item.");
if (!mod?.active || !mod.api?.effectGroups) {
  throw Error("PF1 Automation Engine is not ready.");
}
const engine = mod.api;
~~~

**What this does:** fails explicitly if the script is being called without an actor or without the module enabled. You can then use `source` and `engine` throughout the script.

**Note:** PF1 native Item scripts provide their own `actor`/`item` context. Engine-triggered script callbacks may additionally expose `event`, `state` and `api`. Do not assume the same variables are always present in a standalone console macro.

## Recipe 2 — First player-safe timed spell (self-only)

**Goal:** a character uses a spell; a preconfigured PF1 buff is copied to them for three rounds; it disappears without the GM needing to track it manually.

### A. Setup (GM)

On the caster's sheet create:

- A **Spell Item** named, for this example, `Minor Ward`.
- A separate PF1 **buff Item** named `Minor Ward - Template`.
- Any attack/AC/save/etc. modifier belongs in the **buff template**, *not* in the Engine.
- Keep the template inactive and avoid native duration automation that would compete with the Engine.

Select the caster's token and execute this **once** from the **elected GM** console:

~~~js
const caster = canvas.tokens.controlled[0]?.actor;
if (!caster) throw Error("Select the caster's token.");
const template = [...caster.items].find(i =>
  i.type === "buff" && i.name === "Minor Ward - Template"
);
if (!template) throw Error("Buff template missing.");

await game.modules.get("pf1-automation-engine")
  .api.effectGroups.approveTemplate(template.uuid);

console.log("Template approved:", template.uuid);
~~~

If you later change the template, approve it again.

### B. Script inside the Spell Item

In `Minor Ward` → **Advanced → Script Calls → Use**, paste:

~~~js
const source = item?.actor ?? actor;
const engine = game.modules.get("pf1-automation-engine")?.api;
if (!source || !engine?.effectGroups) throw Error("Automation unavailable.");

const template = [...source.items].find(i =>
  i.type === "buff" && i.name === "Minor Ward - Template"
);
if (!template) throw Error("Minor Ward template missing.");

const result = await engine.effectGroups.applyGroup({
  actor: source,
  key: "minor-ward",
  templateUuid: template.uuid,
  targets: [source],
  duration: { value: 3, unit: "rounds" }
});

if (result.submitted) {
  ui.notifications.info("Minor Ward requested from GM.");
} else if (result.applied) {
  ui.notifications.info("Minor Ward applied.");
}
~~~

**Expected:** the GM approves the *template* ahead of time, not each cast. The player's own casting workflow invokes the script. The player's call sends a request to the elected GM. A temporary buff appears on the caster; its **18 seconds** of PF1 game time continue in and out of combat.

**Important:** `result.submitted` is **not** proof that the buff was applied. If no buff appears, inspect the elected GM console. The Engine does not deduct spell slots or check whether the caster was allowed to cast this spell; PF1's native spell system and your Item script govern those rules.

## Recipe 3 — A spell affecting several targeted allies

**Goal:** copy the same approved template to multiple friendly targets without maintaining a separate timer per ally.

**Setup:** create a caster-owned PF1 buff named `Shared Protection - Template`, configure its modifiers and approve it as in Recipe 2.

In the source Spell Item's Script Call:

~~~js
const source = item?.actor ?? actor;
const engine = game.modules.get("pf1-automation-engine")?.api;
if (!source || !engine?.effectGroups) throw Error("Automation unavailable.");

const template = [...source.items].find(i =>
  i.type === "buff" && i.name === "Shared Protection - Template"
);
if (!template) throw Error("Shared Protection template missing.");

// In Foundry, players can target tokens with the targeting controls.
// The Engine verifies friendly/owned target eligibility on the GM side.
const allies = [...game.user.targets]
  .map(t => t.actor)
  .filter(Boolean);

// Optional spell-specific checks go here: range, line of effect,
// legal target count, conditions, caster level, etc.
if (!allies.length) throw Error("Target at least one ally.");

const result = await engine.effectGroups.applyGroup({
  actor: source,
  key: "shared-protection",
  templateUuid: template.uuid,
  targets: allies,
  duration: { value: 2, unit: "minutes" }
});

if (result.submitted) {
  ui.notifications.info("Protection request sent to GM.");
}
~~~

The Engine creates a marked copy on each beneficiary and registers **one group timer**. It does **not** automatically calculate spell range or validate that PF1 considers those creatures allies. The module's own source/target authorization checks are a different matter from PF1 targeting rules.

**Target count:** 1–30 unique actor UUIDs. The GM may reject non-friendly or unauthorized targets; rejection appears in the GM console. If two targeted tokens share the same actor UUID, they produce one beneficiary entry.

## Recipe 4 — A concentration-style feature ending at a turn boundary

**Goal:** the effect ends at the **end of the caster's next turn**, not after a wall-clock minute.

The configuration is the same as Recipe 3, except it needs an **active Combat** and a unique combatant corresponding to the caster.

~~~js
const source = item?.actor ?? actor;
const engine = game.modules.get("pf1-automation-engine")?.api;
if (!source || !engine?.effectGroups) throw Error("Automation unavailable.");

const template = [...source.items].find(i =>
  i.type === "buff" && i.name === "Sustained Effect - Template"
);
if (!template) throw Error("Effect template missing.");

const combat = game.combat;
if (!combat?.started) throw Error("A started combat is required.");
const mine = [...combat.combatants].filter(c => c.actor?.uuid === source.uuid);
if (mine.length !== 1) {
  throw Error("The caster needs one identifiable combatant.");
}

const targets = [source]; // Adapt using PF1-valid targets.

const result = await engine.effectGroups.applyGroup({
  actor: source,
  key: "sustained-effect",
  templateUuid: template.uuid,
  targets,
  combatId: combat.id,
  combatantId: mine[0].id,
  timing: "endOfNextTurn"
});

console.log("Sustained effect result:", result);
~~~

**Timing is precise:** if used on the caster's turn in round 1, `endOfNextTurn` means *the end of their turn in round 2*, not the end of their current round 1 turn. The v1.8.0 Engine includes the phase-deadline recheck needed after an F5 reload.

Use `duration:{value:1,unit:"rounds"}` instead only when the actual rule states **six seconds of elapsed game time**. Never include both `timing` and `duration` in one request.

## Recipe 5 — Maintain an existing ability without recreating its buffs

**Goal:** a PF1 feature spends another resource/round to maintain its current effect. The original buff copies remain on the same recipients.

Make a **separate native Script Call** (or separate PF1 Item action) for the maintenance action, then:

~~~js
const source = item?.actor ?? actor;
if (!source) throw Error("Missing caster.");

const result = await game.modules.get("pf1-automation-engine")
  .api.effectGroups.extendGroup({
    actor: source,
    key: "sustained-effect", // Exactly the same key as Recipe 4
    rounds: 1
  });

if (result.submitted) {
  ui.notifications.info("Extension requested from GM.");
} else {
  console.log("Extended existing group:", result.groupId);
}
~~~

For a turn-bound group, the deadline moves one round later. For a `duration` group, the remaining time increases by **6 seconds**. This method neither re-applies the buff nor resets targets.

**Rules remain in the Item:** paying an extra round of performance, concentration or another resource is not handled by `extendGroup()`. Verify and pay those costs through the PF1 Item's normal workflow.

## Recipe 6 — Manually stop an existing spell/feature effect

A source-owning player can request the removal of the group they originally applied:

~~~js
const source = item?.actor ?? actor;
const result = await game.modules.get("pf1-automation-engine")
  .api.effectGroups.stopGroup({
    actor: source,
    key: "shared-protection"
  });
console.log("Stop request/result:", result);
~~~

The group lookup uses **source actor UUID + effect key**. A different character with a similarly named spell cannot stop another caster's group by supplying the same key alone.

Stopping cancels the associated group timer and removes only copies that are still marked as belonging to that group. If the player is not the elected GM, the result is a **submitted request**, subject to GM processing.

**Never replace** `stopGroup()` with a loop that deletes every buff named `Shared Protection`: names are not trustworthy ownership markers and you could destroy permanent or unrelated items.

## Recipe 7 — A GM-controlled spell with a direct expiration timer

Sometimes a GM runs a monster's ability, a scene effect, or a spell from the **elected GM** console. In this case a direct timer can deactivate a PF1 buff already present on the actor, without cloning a group:

~~~js
const engine = game.modules.get("pf1-automation-engine").api;
if (!engine.generic.isLeader()) {
  throw Error("Run this setup from the elected GM account.");
}

const caster = canvas.tokens.controlled[0]?.actor;
const buff = [...(caster?.items ?? [])].find(i =>
  i.type === "buff" && i.name === "Encounter Ward" && i.system?.active
);
if (!buff) throw Error("Activate Encounter Ward on the selected actor.");

await engine.duration.schedule({
  id: "encounter-ward:" + buff.uuid,
  effectUuid: buff.uuid,
  effectAction: "disable",
  duration: { value: 1, unit: "minutes" }
});
~~~

This is appropriate for **GM-run** effects. It **will fail** if pasted unchanged into a script executed by a player, because `duration.schedule` is a privileged writer.

An ActiveEffect can use `effectAction:"delete"` to remove the effect document, but a PF1 Item of type `buff` can only be deactivated through the direct effect-timer APIs.

## Recipe 8 — Trigger a cleanup Script Call after a duration

**Goal:** execute cleanup logic stored in the source feature Item when time expires, without activating the Item a second time.

**GM setup:**

1. Add a native PF1 Script Call to the actor-owned feature, named `Expiration`, category **Use**.
2. Implement its desired cleanup behavior there (for instance clearing a feature-specific actor flag).
3. The elected GM schedules *that script*, not the Item's `use()` action.

~~~js
const engine = game.modules.get("pf1-automation-engine").api;
if (!engine.generic.isLeader()) throw Error("Elected GM required.");

const feature = canvas.tokens.controlled[0]?.actor?.items.find(
  i => i.name === "Scene Ability"
);
if (!feature) throw Error("Scene Ability missing.");

await engine.duration.schedule({
  id: "script-expiry:" + feature.uuid,
  itemUuid: feature.uuid,
  scriptCategory: "use",
  scriptId: "Expiration", // Prefer the stable script-call ID
  duration: { value: 30, unit: "seconds" }
});
~~~

**Example content of the Item's own `Expiration` Script Call:**

~~~js
console.log("Expiry callback executed for PF1 Item:", item?.name);
console.log("Engine event:", typeof event === "undefined" ? null : event);
// Replace this logging with YOUR feature-specific cleanup.
~~~

The callback receives `event.type === "expiry"`. For elapsed-time expiry `event.timing` is `"duration"`. It is not a second spell cast, and it does not automatically trigger resource use or a chat card.

For turn-exact cleanup instead, the elected GM can use `engine.generic.scheduleTurn({itemUuid,scriptCategory,scriptId,combatId,combatantId,timing:"endOfNextTurn",id})`.

## Recipe 9 — A passive feature reacting to actor updates

**Goal:** a class feature script recalculates its own state only when relevant actor resources change, including after reload. No spell/class rule belongs in the module.

### A. Create the callback

On the actor-owned **Class Feature** Item, add a native **Use** Script Call named `Synchronize`. Make its logic **idempotent**: re-running it should not stack a bonus or duplicate an ActiveEffect.

For initial testing, log the event:

~~~js
console.log("Synchronize callback:", item?.name);
console.log("Event:", typeof event === "undefined" ? null : event);
~~~

### B. GM registers it once

~~~js
const feature = canvas.tokens.controlled[0]?.actor?.items.find(
  i => i.name === "Reactive Feature"
);
if (!feature) throw Error("Feature not found.");

const api = game.modules.get("pf1-automation-engine").api.generic;
if (!api.isLeader()) throw Error("Elected GM required.");

await api.register({
  id: "reactive:" + feature.uuid,
  on: "updateActor",
  itemUuid: feature.uuid,
  scriptCategory: "use",
  scriptId: "Synchronize",
  filter: {
    actorUuid: feature.actor.uuid,
    properties: ["system.resources"]
  }
});

await api.register({
  id: "reactive-ready:" + feature.uuid,
  on: "ready",
  itemUuid: feature.uuid,
  scriptCategory: "use",
  scriptId: "Synchronize"
});
~~~

`ready` triggers on a future reload, not immediately at registration. For this example, call the script's normal setup or reload to test.

The Engine doesn't know what the passive feature does; the `Synchronize` script is responsible for interpreting PF1 statistics and applying appropriate changes.

## Recipe 10 — Put the subscription declaration on the feature itself

If you prefer **one per-Item configuration** instead of keeping a separate console macro, store the same rule as Item flags and have the elected GM approve it.

~~~js
// Elected-GM setup macro. "feature" is an actor-owned PF1 Item.
await feature.setFlag("pf1-automation-engine", "automations", [
  {
    id: "sync-resources",
    on: "updateActor",
    scriptCategory: "use",
    scriptId: "Synchronize",
    filter: {
      actorUuid: feature.actor.uuid,
      properties: ["system.resources"]
    }
  },
  {
    id: "sync-on-ready",
    on: "ready",
    scriptCategory: "use",
    scriptId: "Synchronize"
  }
]);

await game.modules.get("pf1-automation-engine")
  .api.discovery.approveItem(feature.uuid);
~~~

The discovery service identifies declarations on PF1 Items and loads only those whose current declaration **and referenced script definitions** match a stored elected-GM approval.

**After editing the script or rule:** rerun `discovery.approveItem(feature.uuid)`. The old approval is intentionally invalid. Up to 50 rules are supported on one Item.

This approach is particularly useful when a GM wants to configure only a few specific capabilities on each player's character sheet.

## Recipe 11 — Build durations from a spell's own variables

The Engine accepts an **explicit integer duration**; it does not parse PF1 spell text or caster level for you.

An Item script can calculate duration **before** invoking the Engine:

~~~js
const source = item?.actor ?? actor;

// Example only: replace with a caster-level value obtained from the
// actual PF1 system/item configuration of this particular spell.
const casterLevel = 5;
if (!Number.isSafeInteger(casterLevel) || casterLevel < 1) {
  throw Error("Invalid caster level.");
}
const duration = {
  value: casterLevel,
  unit: "minutes"
};

// Then use the player-safe path:
const template = [...source.items].find(i =>
  i.type === "buff" && i.name === "Scaling Ward - Template"
);
if (!template) throw Error("Template missing.");

await game.modules.get("pf1-automation-engine")
  .api.effectGroups.applyGroup({
    actor: source,
    key: "scaling-ward",
    templateUuid: template.uuid,
    targets: [source],
    duration
  });
~~~

The constant `casterLevel = 5` is merely an **illustrative placeholder**. It is **not** a suggested PF1 system data path, nor a rule built into the module. Replace it with a validated value specific to the Item and game rules.

**Use numeric integers:** `{value:1.5,unit:"minutes"}` is invalid. To represent 90 seconds, use `{value:90,unit:"seconds"}`.

## Recipe 12 — Diagnostics for a particular actor or Item

Open the browser console on the GM account:

~~~js
const engine = game.modules.get("pf1-automation-engine")?.api;
const source = canvas.tokens.controlled[0]?.actor;

console.log({
  moduleVersion: game.modules.get("pf1-automation-engine")?.version,
  user: game.user.name,
  electedGM: engine?.generic?.isLeader(),
  actor: source?.name,
  actorUuid: source?.uuid,
  worldTime: game.time.worldTime,
  currentRound: game.combat?.round,
  currentTurn: game.combat?.turn
});

console.table(engine?.generic?.listTimers() ?? []);
console.table(engine?.duration?.listTimers() ?? []);
console.table(engine?.effectGroups?.listGroups() ?? []);
console.table(engine?.generic?.listEvents() ?? []);
console.log("Discovery:", engine?.discovery?.status());
~~~

To inspect group copies for the selected caster:

~~~js
console.table(
  game.modules.get("pf1-automation-engine")
    .api.effectGroups.listGroups()
    .filter(g => g.sourceUuid === source.uuid)
    .map(g => ({
      key: g.key,
      groupId: g.id,
      targetCount: g.copies?.length,
      timerId: g.timerId,
      duration: g.duration,
      timing: g.timing
    }))
);
~~~

### Common questions

**"Why does my player's direct `duration.schedule()` call fail?"**  
The API writes a persistent world registry and is GM-only. For player-used spells and class features, the supported pattern is `effectGroups.applyGroup()` using a previously approved template—even for a single-target buff.

**"Can I put a script in a Spell Item instead of creating a separate module?"**  
Yes. The spell's native PF1 Script Call initiates the request. If the spell grants a tracked numerical buff, store that buff's modifiers in a separate actor-owned PF1 buff Item/ActiveEffect template.

**"Does `applyGroup()` cast the spell or spend spell slots?"**  
No. It manages copies and expiration only. Normal PF1 Item usage and Item scripts must enforce casting and resources.

**"Why didn't `submitted:true` apply anything?"**  
That value means the request was transmitted. Look at the elected GM console for a refused request (approval, ownership, targets, maximum 30, invalid timing/duration).

**"Why did approval stop working after editing my buff?"**  
Any change to the approved template invalidates its exact snapshot. Reapprove it.

**"Why are my effects applied twice?"**  
Check whether the PF1 native spell script, an Engine event subscription, the legacy effect manager, or another module is also creating effects. Give each feature **one owner** for application and cleanup.

**"Will effects keep their remaining duration after combat or F5?"**  
Elapsed-time durations are designed to persist across those transitions and have been tested in the target environment. Turn-boundary timers instead follow the referenced combatant and an absolute target round. Unusual late calendar catch-up, missing combatants and unlinked synthetic tokens need specific regression testing.

**"Can I save these scripts in my own compendium?"**  
They are native PF1 Item scripts, so Item copies can carry their script text. However, **approval is tied to the actual actor-owned Item/template UUID and its contents**. Copying a template to another actor or modifying its script generally requires fresh approval.

## Authoring standards for a reusable table

- Give every effect a unique, stable **`key` per source actor**: lowercase ASCII letters, digits, hyphens or underscores, maximum 80 characters.
- Use stable UUIDs and internal Script Call IDs; avoid deleting items by name.
- Keep PF1 game rules, spell-specific target checks and resource costs **in the Item script**.
- Make callbacks idempotent and use `stopGroup()` for safe cleanup.
- Never pass untrusted source code through sockets, flags, or timer requests.
- Have the elected GM approve exact templates and event declarations after editing.
- Test as the actual player, then reload F5, finish the expected turn once, and verify timers are gone.
- Keep world-specific macros and customized spells outside the generic engine repository unless they demonstrate the API without embedding game-specific logic.

---

**Reference:** [Full Technical Guide](TECHNICAL-GUIDE.md) · [v1.8.0 duration API](../API-DUREES.md) · [Group effect API](../API-EFFETS-GROUPES.md) · [Precise turn expiration API](../API-EXPIRATIONS.md) · [Native PF1 Script Call notes](../API-SCRIPTS-OBJET.md).
