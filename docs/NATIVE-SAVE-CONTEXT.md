# Native Pathfinder 1e Action Card Saving Throw Context (v1.12.0)

**Target:** Foundry VTT 13.351 / PF1 11.11. This is a module-only extension of the existing saveOverrides resolver. It does not change PF1 system files, Harpy Items or bardic Script Calls.

## Verified API contracts and limits

- PF1's ActionUse exposes `item`, `action`, `actor` and `shared.chatData`. The `pf1PreDisplayActionUse(actionUse)` hook occurs before posting its chat card.
- PF1's `ChatMessagePF` exposes `itemSource` and `actionSource`; a source action provides `save.type`, an Action ID and a computed DC.
- PF1's `targetSavingThrowClick` implements the native target-save button.
- Native saves emit `pf1PreActorRollSave(actor,options,save)` and `pf1ActorRollSave(actor,result,save)`.
- Foundry v13's `renderChatMessageHTML(message,html,context)` receives a native HTMLElement.

The module uses a **capture-phase click listener** on the existing PF1 action card. It does not intercept the native button's behavior, change dice/formulas, add bonus parts, skip dialogs, change roll modes, alter notes, replace Actor prototypes or modify PF1 code.

**Testing limit:** integration tests simulate those published APIs. The installed PF1 11.11 chat button's exact dataset and class attributes cannot be inspected here, so the click selector needs in-world validation. Unrecognized clicks fail closed.

## Action card context

At `pf1PreDisplayActionUse` the module puts the following JSON-compatible data into `actionUse.shared.chatData.flags["pf1-automation-engine"].saveContext`. A guarded `preCreateChatMessage` fallback reads the PF1 message's linked Item/Action.

~~~js
{
  sourceActorUuid: "Actor.HARPY",
  sourceItemUuid: "Actor.HARPY.Item.CAPTIVATING_SONG",
  sourceActionId: "ACTION_ID",
  saveType: "will",
  saveDC: 16
}
~~~

The context survives F5 and is visible in each target's copy of the ChatMessage. Descriptors are **not duplicated**; the elected GM re-resolves the original Item and its `system.tags` / `system.abilityType`.

## Native player workflow

1. Harpy uses Captivating Song normally; PF1 creates its existing action chat card.
2. Player clicks the native save control on that action card. The module observes this click and remembers its persisted Item/Action/save context, scoped to eligible target Actors on the player's client.
3. PF1 remains responsible for the **single** real save and its full native dialog, contextual bonuses, notes and chat privacy.
4. At `pf1PreActorRollSave` the module restores the source context to its existing pre/post event queue. At `pf1ActorRollSave` it sends the native save message ID to the elected GM.
5. The GM validates the original save's message author, actor speaker and persisted **source action card**. Item UUID, Action ID and save type must match.
6. The established `saveOverrides` resolver computes the effective result, publishes `pf1aeSaveOverrideResolved` and marks the original save message. When a matching candidate exists, a separate summary shows the effective total.

~~~js
const result=saveMessage.getFlag("pf1-automation-engine","saveOverride");
// {
//   processed:true,normalTotal:16,effectiveTotal:23,changed:true,
//   sourceMessageId,sourceItemUuid,sourceActionId,saveDC,
//   winner,candidates,...
// }
~~~

Or read `api.saveOverrides.getResultForMessage(saveMessage.id)`.

**Scope:** the original PF1 save die stays at 16. This module cannot retroactively rewrite a finished native PF1 spell resolution, since the system's post-save hook runs after the roll. Any downstream outcome resolver must consume the published effective result.

## Special cases

- **Manual sheet save:** has no source card click and is never attributed to a spell.
- **Non-sonic/language source:** a contextual native save records `processed:true, normalTotal:18, effectiveTotal:18, changed:false` but causes **no new summary**.
- **Several targets:** each Actor makes its own native save against the same persisted source message; different save message IDs are processed independently, with no duplicate summary.
- **Two actions on one Item:** separate Action ID and DC are retained.
- **F5/reconnection:** the action card flag is persisted and restored on the new client.
- **Whispered/blind saves:** summary copies the original save's `whisper` and `blind` settings, avoiding leakage of hidden totals.
- **Explicit rollWithContext:** remains supported; its helper marker prevents a second post-save processing pass.

## Debugging

Enable **Generic automation debug logs**. On the card-rendering/rolling client:

~~~text
[PF1AE][SaveContext] Source message detected
[PF1AE][SaveContext] Item: Captivating Song
[PF1AE][SaveContext] Item UUID: ...
[PF1AE][SaveContext] Action ID: ...
[PF1AE][SaveContext] Save: will DC 16
[PF1AE][SaveContext] Native PF1 save button detected
[PF1AE][SaveContext] Source context restored
~~~

On the elected GM:

~~~text
[PF1AE][SaveOverride] Source context restored
[PF1AE][SaveOverride] Save detected
[PF1AE][SaveOverride] Source predicate: PASS
[PF1AE][SaveOverride] Dynamic replacement resolved: 23
[PF1AE][SaveOverride] Normal save: 16
[PF1AE][SaveOverride] Effective result: 23
~~~

Inspect a source card:

~~~js
const card=game.messages.contents.findLast(m=>m.itemSource?.name==="Captivating Song");
console.log({
  item:card?.itemSource?.uuid,
  action:card?.actionSource?.id,
  saveContext:card?.getFlag("pf1-automation-engine","saveContext")
});
~~~

If the card's source is found but the native-save-button log does not appear, inspect the installed PF1 save button's dataset/CSS class to identify a selector incompatibility.

## Implementation files

- `scripts/save-context.js` — persisted source metadata and capture-phase native save click correlation.
- `scripts/save-overrides.js` — elected-GM validation, contextual save decision flags, private summaries.
- `tests/native-save-context.test.cjs` — simulated end-to-end tests (two players, privacy, F5, manual and non-sonic saves).
- `module.json` — loads the bridge in v1.12.0.

Related: [Saving Throw Overrides](SAVE-OVERRIDES.md), [Technical Guide](TECHNICAL-GUIDE.md).
