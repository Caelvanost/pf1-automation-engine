# Native Pathfinder 1e Rest Hooks — PF1 Automation Engine v1.9.0

**Target:** Foundry VTT 13.351 / PF1 system 11.11. The module remains strictly class-neutral. Rest-specific behavior belongs in PF1 Item scripts, not in the engine.

## Native PF1 contract

The PF1 ActorPF.performRest() implementation calculates updates and calls the following hooks, in this order:

~~~js
// Immediately before native PF1 writes, synchronous and cancellable:
Hooks.call("pf1PreActorRest", actor, options, updateData, itemUpdates);

// After native Item and Actor writes have completed:
Hooks.callAll("pf1ActorRest", actor, options, updateData, itemUpdates);
~~~

The same normalized options object is passed to both hooks for a given rest. In the target PF1 implementation it contains hours (default 8), restoreHealth (default true), restoreDailyUses (default true), and longTermCare (default false). The two restoration flags are **independent**. An 8-hour rest is not automatically the same thing as a health restoration or a daily-resource recharge.

The Engine does not call ActorPF.performRest(), heal damage, recharge resources, modify the native rest updates, or advance game time.

## 1. Register a post-rest callback

On the actor's **Burn** Item (or any Spell or Class Feature), add a native PF1 Script Call named **Repos complet**, category **Use** (Avancé → Appel de script). Its code is specific to that Item.

From the **elected GM** console, select the character token and execute:

~~~js
const api = game.modules.get("pf1-automation-engine").api.generic;
if (!api.isLeader()) throw Error("This must be run by the elected GM.");

const actor = canvas.tokens.controlled[0]?.actor;
if (!actor) throw Error("Select the actor's token.");

const feature = [...actor.items].find(i => i.name === "Burn");
if (!feature) throw Error("The actor does not have a Burn Item.");

console.table([...(feature.scriptCalls?.contents ?? [])].map(call => ({
  id: call.id, name: call.name, category: call.category
})));

await api.register({
  id: "rest-complete:" + feature.uuid,
  on: "pf1ActorRest",
  itemUuid: feature.uuid,
  scriptCategory: "use",
  scriptId: "Repos complet",  // Prefer its stable ID if available.
  filter: {
    actorUuid: actor.uuid,
    rest: {
      minHours: 8,
      restoreHealth: true,
      restoreDailyUses: true
    }
  }
});
~~~

The sample defines **full rest for its own subscription** as 8+ hours with both restoration options enabled. This is a configurable filter, **not a hardcoded kineticist rule**. If your specific ability should trigger after 8h regardless of the other toggles, set only:

~~~js
filter: {
  actorUuid: actor.uuid,
  rest: { minHours: 8 }
}
~~~

Registration is persistent in the world settings. Only the elected GM may register or unregister a callback. Item scripts remain on the actor-owned PF1 Item.

## 2. Optional pre-rest callback

To receive a notification carrying a snapshot taken **before** native PF1 healing:

~~~js
await api.register({
  id: "rest-before:" + feature.uuid,
  on: "pf1PreActorRest",
  itemUuid: feature.uuid,
  scriptCategory: "use",
  scriptId: "Capture avant repos", // Separate native PF1 Script Call.
  filter: { actorUuid: actor.uuid }
});
~~~

The Engine's hook listener takes the **snapshot synchronously**. However, the registered Item's callback executes **asynchronously on the elected GM**, which might be *after* PF1 has already committed the rest. Do not use this Engine callback as a native cancellation/veto hook, and do not expect it to modify PF1's pending updateData.

## 3. Structured event available to the Item script

The registered PF1 script receives the Engine's **event** parameter. Example shape (health numbers are illustrative, not a promised PF1 schema):

~~~js
{
  type: "pf1ActorRest",
  actorUuid: "Actor.A",
  documentUuid: "Actor.A",
  rest: {
    id: "one-rest-id",             // shared by pre and post notifications
    phase: "post",                // "pre" for pf1PreActorRest
    completed: true,             // false for pre
    actorUuid: "Actor.A",
    initiatedBy: "user-id",

    options: {
      hours: 8,
      restoreHealth: true,
      restoreDailyUses: true,
      longTermCare: false
    },

    hours: 8,
    restoreHealth: true,
    restoreDailyUses: true,
    longTermCare: false,

    atLeastEightHours: true,
    isFullRest: true,            // 8h+ AND both restoration options
    kind: "full",                // full|partial|dailyRecharge|none

    before: {
      health: {
        hp: { value: 12, max: 20, nonlethal: 5 },
        vigor: null,
        wounds: null
      },
      resources: {},
      items: [{ id: "...", uuid: "...", type: "feat", uses: null, active: null }]
    },

    after: {                     // null on pre event
      health: {
        hp: { value: 14, max: 20, nonlethal: 3 },
        vigor: null,
        wounds: null
      },
      resources: {},
      items: []
    },

    nativeUpdates: {
      actor: {},                 // snapshot of PF1 updateData
      items: [],                 // snapshot of PF1 itemUpdates
      truncated: false
    }
  }
}
~~~

The Engine copies **existing** actor health objects (HP, vigor, wounds), actor resources and up to 250 Item usage/active fields. It does not invent source-specific damage data. If the native PF1 actor stores nonlethal damage under system.attributes.hp.nonlethal, the value is included in both snapshots.

If the pre-hook was not observed, rest.before is **null**, not a fabricated copy of post-rest data. Very large or non-serializable update payloads can be omitted; nativeUpdates.truncated signals that omission.

### Classification, not game logic

| Native options | At least 8 hours? | kind | isFullRest |
| --- | --- | --- | --- |
| 8h, restoreHealth true, restoreDailyUses true | Yes | full | true |
| 4h, restoreHealth true, restoreDailyUses true | No | partial | false |
| 8h, restoreHealth true, restoreDailyUses false | Yes | partial | false |
| 8h, restoreHealth false, restoreDailyUses true | Yes | dailyRecharge | false |
| 8h, restoreHealth false, restoreDailyUses false | Yes | none | false |

The flags are descriptions of **requested native PF1 operations**, not decisions that a particular feat, class ability or spell has recovered.

### Filtering options

The optional filter.rest object accepts minHours and maxHours (finite non-negative numbers), restoreHealth, restoreDailyUses, atLeastEightHours and isFullRest (booleans), and kind (full, partial, dailyRecharge or none).

A rest filter may only be attached to pf1PreActorRest or pf1ActorRest. Normally also set filter.actorUuid to avoid responding to another character's rest.

## 4. Example script content: "Repos complet" on Burn

This is deliberately a **skeleton**. The game-specific script must know which Burn resources and own-effect markers it is responsible for, and which PF1 rest options permit its recovery.

~~~js
if (event?.type !== "pf1ActorRest") return;
const rest = event.rest;
if (!rest?.completed || !rest.atLeastEightHours) return;

const owner = item?.actor ?? actor;
if (!owner || owner.uuid !== event.actorUuid) return;

// Choose the feature's actual requirements; do not guess from the name.
if (!rest.restoreDailyUses) return;

const beforeNonlethal = rest.before?.health?.hp?.nonlethal ?? null;
const afterNonlethal = rest.after?.health?.hp?.nonlethal ?? null;
console.log("Native PF1 rest:", {
  hours: rest.hours,
  kind: rest.kind,
  beforeNonlethal,
  afterNonlethal
});

// Add source-specific Burn resource reset and owned-effect cleanup HERE.
// Never erase the actor's entire nonlethal-damage total.
// Never apply native PF1 rest healing a second time.
~~~

**Why no blanket Burn healing?** Other sources can contribute to an actor's total nonlethal damage. When restoreHealth is true, PF1 may already reduce that total before the post hook runs. Without a separate source-specific ledger, the Engine cannot identify which remaining points came from Burn. Blindly setting all nonlethal damage to zero can erase unrelated damage; blindly subtracting Burn points *after* PF1 healing can double-heal. The Item script must track **its own** sources, flags and effects and compare the before/after snapshots.

No kineticist rule is present in the Engine runtime.

## 5. Multiclient execution and safety

- Native PF1 rest hooks fire on the **initiating client**, including when a **player** triggers rest through their sheet.
- The pre-hook stores a snapshot immediately on that client.
- When the initiator is not the elected GM, a **structured message** (no JavaScript source) is sent over the module socket.
- The elected GM resolves the actor from its UUID and requires OWNER permission for relayed requests, including those claiming a GM user ID.
- The elected GM runs only the **already registered Item script**; automatic Item declaration discovery remains protected by its approval snapshot.
- Rest notifications have unique IDs and separate pre/post deduplication. Execution is serialized per actor; generic recursion and no-double-writes safeguards remain in force.
- The bridge does not force changes to the actor or its items. Registered scripts must be **idempotent**, and can suppress Engine re-entrant update subscriptions by passing this existing Foundry option when appropriate:

~~~js
await someDocument.update(
  { "flags.myCampaign.ownResource": 0 },
  { "pf1-automation-engine": { skip: true } }
);
~~~

**Security limitation:** the basic Foundry module socket does not cryptographically authenticate the user ID supplied in a message. The permission checks are not a JavaScript sandbox against a deliberately malicious socket client. Use the module in a trusted group. A missing elected GM means no automation is guaranteed at that moment. Rest events are **transient** and not replayed after reconnect/F5; only normal registered subscriptions are persisted.

**Ordering limitation:** the Engine's asynchronous pre Item callback cannot veto or modify PF1's synchronous native rest. The **pre-state snapshot** is what is guaranteed to be captured before the PF1 changes, not the completion of the callback.

## 6. Suggested real-world validation

1. Register the new post-rest listener on an actor-owned feature; verify an 8-hour **full** rest triggered by the **player** calls the script exactly once.
2. Try 4h with both restoration flags enabled; full-rest filter must not fire.
3. Try 8h with healing disabled (daily recharge only), then 8h with daily recharge disabled (healing only); full-rest filter must not fire.
4. Register a pre-rest callback; compare before/after health and nonlethal values for an actor that had nonlethal damage before resting.
5. Repeat with **two GMs**; disconnect the elected GM and ensure the secondary GM takes over once.
6. Confirm an unrelated actor's rest cannot fire a callback filtered on this actor.
7. Verify generic timing, effect groups, duration timers, auto discovery and F5 behavior remain unchanged.

### Console inspection

~~~js
const api = game.modules.get("pf1-automation-engine").api.generic;
console.log("Elected GM:", api.isLeader());
console.table(api.listEvents().filter(e =>
  e.on === "pf1ActorRest" || e.on === "pf1PreActorRest"
));
~~~

Source: native PF1 ActorPF.performRest hook contract; Engine runtime scripts/generic-automation.js and scripts/rest-automation.js; tests/rest-hooks.test.cjs.

See also: [Technical Guide](TECHNICAL-GUIDE.md), [Item Script Recipes](PF1-ITEM-SCRIPT-RECIPES.md).
