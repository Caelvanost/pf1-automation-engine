# Conditions — PF1 11.11 / Foundry 13

Disable Improved Conditions; its six identifiers are registered through the native pf1RegisterConditions hook without overwriting existing entries. No extra Buff Item is created. The engine is independent of the health setting, but shares its native setConditions source router. The revised router invalidates old health provenance proofs; automatic validation runs when the health setting is enabled, without a macro.

| ID | Mechanics in 1.49.0 |
| --- | --- |
| fascinated | Native -4 untyped Perception change; same numerical implementation as Improved Conditions. PF1 does not distinguish reactive Perception here. Restrictions, threats, repeat saves and waking by an ally remain GM/script adjudication. |
| burning | Marker only. Use existing bleed/ongoing damage or an appropriate source script; no automatic fire damage. |
| energyDrained | Marker only. Native PF1 negative levels remain authoritative; no additional penalties. |
| anchored | Marker only. |
| immobilized | Marker only. |
| slowed | Marker only. |

No automatic secondary slowed state or changes to native tracks. Movement and action enforcement belong to later rules releases.

API (source-specific, no ability-specific code):

~~~js
const conditions = game.modules.get("pf1-automation-engine").api.conditions;
await conditions.apply({
  sourceUuid: item.uuid,
  key: "my-effect",
  conditionId: "fascinated",
  targets: [...game.user.targets].map(t => t.actor),
  duration: { value: 2, unit: "rounds" }
});
~~~

Omit duration and timing for manual removal. Alternatively pass timing (endOfCurrentTurn, startOfNextTurn, endOfNextTurn, turnStart, turnEnd), combatId, combatantId, optional occurrences. Exactly one source combatant is required. The existing timer services schedule deletion of the exact effect. Reapplication of the same Item/key/condition/target is idempotent and does not refresh its duration. Apply results list each target, including immunity or duplicate results. Native PF1 condition immunity is checked; the object script is responsible for other legality (e.g. mind-affecting descriptors, range, saves). Native tracks and death are excluded from generic application, to avoid overriding exclusivity rules; use native/health-specific APIs.

The elected GM performs mutations. A player must own the source Item's Actor. For direct application to another Actor the GM must first approve the exact source Item and condition pair:
~~~js
const conditions = game.modules.get("pf1-automation-engine").api.conditions;
await conditions.approve({ sourceUuid: "Actor.ID.Item.ID", conditionId: "fascinated" });
~~~
Revoke with the same pair. Approval authorizes declarative application of that condition to other actors, not execution of code or arbitrary modifiers. Authenticated Actor update userId verifies requester; the response is acknowledged. Existing verified saveOutcomes paths continue to apply registered statuses directly and keep their original group lifecycle. Unknown status IDs now fail instead of silently creating a label-only effect; omit statusId intentionally for a plain ActiveEffect.

~~~js
await conditions.extend({sourceUuid:item.uuid,key:"my-effect",conditionId:"fascinated",rounds:1});
await conditions.remove({sourceUuid:item.uuid,key:"my-effect",conditionId:"fascinated"});
console.log(conditions.getSources(actor,"fascinated"));
console.log(conditions.has(actor,"fascinated"));
console.table(conditions.list());
~~~

Optional targets restrict remove/extend; otherwise all tracked Actor documents are searched. Extensions work on timed copies only; multi-target operations are not a distributed transaction. An independent native condition is never removed by source-specific cleanup. A manual native toggle controls only its independent native contribution, not protected managed sources; use the corresponding source removal or GM effect-sheet deletion to end them. Deleted source Items are cleaned on the elected GM and restored scene checks. Timers persist in the existing duration/initiative registries.

Custom definitions: elected GM only, persistent world setting, unique pf1ae- prefix, local image, optional bounded numeric untyped PF1 change targets. Definitions are immutable in this release; reload all clients to register the new entry before applying. No arbitrary formulas, macros, or tracks in custom definitions.
~~~js
await conditions.register({
  id:"pf1ae-example",name:"Exemple",
  img:"icons/svg/aura.svg",changes:[{target:"skill.per",value:-2}]
});
~~~

No runtime hot registration. Registration does not apply the condition to any Actor. Native registry mechanics are evaluated once per active status by PF1, even if multiple source effects supply it. Verify actual Foundry rendering and mechanics, source independence, timer and player-to-GM operation before campaign use.
