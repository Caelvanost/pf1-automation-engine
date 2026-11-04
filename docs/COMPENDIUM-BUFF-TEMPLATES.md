# Compendium PF1 Buff Templates — Effect Groups v1.10.0

**Target:** Foundry VTT v13.351 / Pathfinder 1e 11.11.

A GM-approved PF1 `buff` Item inside a **Compendium** can now serve as the template for an effect group. The caster no longer needs a technical buff embedded on their Actor. This feature does not add any class or spell rules: resource use, legal targets and ability duration belong in the original PF1 Item script.

## Supported models

| Template source | Can approve? | Can apply? |
| --- | --- | --- |
| Actor-owned PF1 buff Item | Yes | Yes, if it belongs to the caster |
| Actor-owned ActiveEffect | Yes | Yes, if it belongs to the caster |
| PF1 buff Item in a Compendium | **Yes** | **Yes**, with prior elected-GM approval |
| Non-buff Compendium Item | No | No |
| World Item not actor-owned | No | No |
| Missing or invalid UUID | No | No |

Compendium source Items are **never** activated or altered. The module uses `fromUuid()` to resolve the approved template, `toObject()` to clone data onto each Actor and native PF1 `setActive(true)` on each newly embedded Item.

## One-time GM approval

From the **elected GM** console, approve the exact Compendium Item:

~~~js
const api = game.modules.get("pf1-automation-engine")?.api;
if (!api?.generic?.isLeader()) throw Error("Use the elected GM account.");

const templateUuid = "Compendium.my-module.buff-templates.Item.XXXXXXXX";
await api.effectGroups.approveTemplate(templateUuid);
~~~

Approval records in the existing world setting `effectTemplateApprovals` contain the template UUID, the source type (`activeEffect`, `actorBuff` or `compendiumBuff`), a compact diagnostic hash and the full **exact canonical content fingerprint**. Comparison of the complete fingerprint, **not the short hash alone**, is authoritative; hash collisions cannot silently approve changed template content.

All relevant `toObject()` properties, including `name`, `type`, `system`, `effects`, `flags` and PF1 Script Calls, are covered. Volatile root fields (`_id`, `_stats`, `ownership`, `sort`, `folder` and `pack`) are excluded. Object key ordering is normalized.

When pack content changes, use is rejected until the GM reapproves the template. Prior v1.9.x actor-owned approvals stored as legacy fingerprint **strings remain accepted** without a migration.

## PF1 player Script Call example — Inspire Courage

**Do not call `approveTemplate()` from the player's Script Call.** It is GM-only. Instead, approve once through the GM, then put this into the caster's PF1 Item under *Advanced → Script Calls*:

~~~js
const api = game.modules.get("pf1-automation-engine")?.api;
const bard = item?.actor ?? actor;
if (!bard || !api?.effectGroups) throw Error("Automation Engine unavailable.");

const templateUuid = "Compendium.my-module.buff-templates.Item.XXXXXXXX";
const allies = [...game.user.targets].map(t => t.actor).filter(Boolean);
if (!allies.length) throw Error("Select at least one ally.");

const result = await api.effectGroups.applyGroup({
  actor: bard,
  key: "inspire-courage",
  templateUuid,
  targets: allies,
  timing: "endOfNextTurn"
});

if (result.submitted) {
  ui.notifications.info("Effect application requested from the GM.");
} else if (result.applied) {
  console.log("Group applied:", result.groupId);
}
~~~

PF1 legality, audio range, duration of the ability, resources and action economy are still the responsibility of this **Item script**.

For continuation and cleanup:

~~~js
await api.effectGroups.extendGroup({
  actor: bard, key: "inspire-courage", rounds: 1
});
await api.effectGroups.stopGroup({
  actor: bard, key: "inspire-courage"
});
~~~

A player receives `{submitted:true}` when the request was sent, not necessarily applied. The elected GM validates and executes the existing socket request.

Choose **either** a precise turn boundary (`timing:"endOfNextTurn"`, combat required) **or** an elapsed game-time duration (`duration:{value:3,unit:"rounds"}`, including outside combat); never combine both.

## Cloning and persistence

- The GM resolves the current pack Item and verifies its exact content fingerprint on each new `applyGroup()`.
- One sanitized `toObject()` snapshot is made **before** asynchronous per-target cloning.
- Pack-specific identity, ownership and nested effect IDs are removed. PF1 action and Script Call IDs are preserved.
- Each target receives a **new actor-embedded PF1 buff** and a unique Item ID; the pack template stays inactive.
- Copies are tagged with the existing `flags.pf1-automation-engine.effectGroupId` and source-template UUID.
- Existing world registries continue to manage expiration, `extendGroup()`, `stopGroup()`, F5 recovery and deletion.
- Cleanup turns off each embedded PF1 buff using the native toggle API and deletes only verified marked copies.
- A partial cloning failure triggers the existing best-effort rollback; cloning errors are logged.

## Debug

Enable **Generic automation debug logs** in Foundry. Messages distinguish:

- `template-approved`, `template-verified` — kind, UUID and hash
- `template-rejected` — invalid type, incorrect owner or missing UUID
- `template-modified` — approved vs current hash
- `template-resolved` — source actor and template kind
- `copy-created` — target Actor and embedded Item UUID
- `clone-failed` — cause and group ID; also logged as an error

~~~js
const api = game.modules.get("pf1-automation-engine").api;
console.table(api.effectGroups.listGroups());
console.table(api.generic.listTimers());
console.table(api.duration.listTimers());
console.log(api.effectGroups.listApprovedTemplates());
~~~

## Foundry acceptance checklist

1. Existing actor-owned buff and ActiveEffect templates behave unchanged.
2. New Compendium buff is approved, copied to two Actor targets and activated natively.
3. The caster does not need an embedded technical buff.
4. The Compendium Item itself remains unchanged.
5. `endOfNextTurn` expires correctly after F5 and reloading the Combat Tracker.
6. `extendGroup()` and `stopGroup()` behave identically for copied pack buffs.
7. Elapsed-time durations, 6-second extension and combat/exploration transitions are unchanged.
8. Editing a pack Item invalidates the previous approval until a GM reapproves it.
9. Non-buffs, missing UUIDs and a foreign actor-owned template are rejected cleanly.
10. Player socket requests, two-GM leadership and safe rollback on a failed clone continue to work.

The module stays rules-neutral and does not alter spell or class features.

See also [Technical Guide](TECHNICAL-GUIDE.md), [PF1 Item Script Recipes](PF1-ITEM-SCRIPT-RECIPES.md), [Native PF1 Rest Hooks](PF1-NATIVE-REST.md).
