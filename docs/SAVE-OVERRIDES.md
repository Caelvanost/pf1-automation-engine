# Saving Throw Overrides — PF1 Automation Engine v1.11.0

**Target:** Foundry VTT 13.351 / Pathfinder 1e system 11.11.

This service provides **conditional replacement of saving throw totals** from persistent, GM-resolved rules. It does **not** add modifiers to the saving throw and does not hardcode any bard/kineticist/feat mechanics.

## PF1 hooks, verified contracts and a critical limitation

The PF1 hook interface exposes:

~~~js
// Before d20Roll. A PF1 hook callback may cancel the roll.
pf1PreActorRollSave(actor, rollOptions, saveId)

// After d20Roll. result can be a ChatMessage or a non-chat data object.
pf1ActorRollSave(actor, result, saveId)
~~~

The target's actor and save ID (fort/ref/will) are explicit in both hooks. **The post hook does not include the originating spell/ability, and the pre hook's roll options do not guarantee an originating Item UUID.** A save from a generic sheet button is therefore **not automatically classified** as sonic, language-dependent, or even magical. The module must not infer origins from flavor text or from a combatant merely being affected by a performance.

In PF1, the post hook occurs **after** d20Roll has produced its result, often including a chat message. The engine **cannot retroactively change the underlying RollPF dice or any action outcome PF1 already calculated**. It instead publishes a separately identified **effective total**, stores that total in the original message flags when permitted, and emits a reusable event:

~~~js
Hooks.on("pf1aeSaveOverrideResolved", (targetActor, decision, originalMessage) => {
  console.log(decision.normalTotal, decision.effectiveTotal, decision.winner);
});
~~~

For an effect whose save success/mitigation is resolved by another automation, that automation must explicitly consume `effectiveTotal`. The Engine posts **one compact summary** per annotated native save, regardless of how many valid replacement rules exist.

**Implementation consequence:** the native save must have **verified source Item context**. A normal unannotated saving throw is deliberately left untouched.

## API overview

Available after Foundry's `ready` hook:

| API | Purpose | Permissions |
| --- | --- | --- |
| `api.saveOverrides.register(data)` | Store a source Actor's conditional replacement rule linked to a group | Elected GM or source-owning player via GM socket |
| `api.saveOverrides.unregister({actor,key})` | Remove one rule | Same |
| `api.saveOverrides.getApplicable({targetActorUuid,saveType,sourceItemUuid,targetTokenUuid?})` | Evaluate valid range, hearing, source descriptors, group and current flag | **Authoritative only on elected GM** |
| `api.saveOverrides.resolve({targetActorUuid,saveType,sourceItemUuid,normalTotal,targetTokenUuid?})` | Compare valid replacement totals, select winner | Elected GM only |
| `api.saveOverrides.rollWithContext({actor,saveType,sourceItemUuid,options?})` | Roll the actor's **native** PF1 save with explicit source Item context | Actor owner / GM |
| `api.saveOverrides.requestRepeatSave({targetActorUuid,saveType,sourceItemUuid,nonInstantaneous:true,dc})` | Explicitly ask PF1 to roll another save, **never a background scan** | Elected GM only |
| `api.saveOverrides.list()` | Inspect persisted data-only rules | All clients |
| `api.saveOverrides.reconcile()` | Delete orphan rules lacking active groups | Elected GM only |

`register()` accepts **data**, never JavaScript function predicates or callbacks. It does not serialize function closures from the client; such callbacks could not survive F5 and would be unsafe to run on another GM. Use an actor flag for dynamic replacement.

## 1. Register Countersong on the bard's PF1 Item

**Existing script prerequisites (outside the Engine):** the bard's Countersong Script Call already starts/maintains the performance, rolls the chosen Perform skill each round, records its current total in the bard's `world.pf1CountersongState.checkTotal` and creates a tracked `effectGroups` group named `countersong`. Keep that script unchanged except for the following registration block.

Add this **after the group has been requested/created**, in the **same native PF1 Item Script Call** or an auxiliary use callback. It is safe to register while the player's group request is still being processed; the saved rule is inert until a live group is present.

~~~js
// Add this to the existing "Contre-chant (Repré)" PF1 Script Call.
// Keep your existing ability activation, skill roll and group code.
const api = game.modules.get("pf1-automation-engine")?.api;
const bard = item?.actor ?? actor;
if (!api?.saveOverrides || !bard) {
  throw Error("PF1 Automation Engine v1.11.0 is required.");
}
await api.saveOverrides.register({
  actor: bard,
  key: "countersong",
  groupKey: "countersong",
  range: 30,
  rangeUnits: "ft",
  requiresHearing: true,
  appliesTo: {
    magical: true,
    sonic: true,
    languageDependent: true
  },
  mode: "higher-result",
  priority: 0,
  label: "Countersong",
  replacement: {
    type: "actorFlag",
    namespace: "world",
    key: "pf1CountersongState",
    path: "checkTotal"
  }
});
~~~

This **does not** store the current result (for example 23). On every resolution, the elected GM reads **the latest** `bard.getFlag("world","pf1CountersongState").checkTotal`. The value can change every round. It must be a finite numeric value.

The registration key is unique **per source Actor**. Two bards may both register `countersong`, and each can maintain a distinct current value. Among all applicable rules, `Math.max(normalSaveTotal,...replacementTotals)` determines the result. The winner and provenance appear in the chat summary.

When `effectGroups.stopGroup({actor:bard,key:"countersong"})`, combat expiration, or group deletion occurs, the Engine removes the linked registration from its world setting. It also checks that the group is still active **on every roll** so an orphan cannot grant a replacement.

**Important:** only the group lifecycle is shared with the core engine. Performance activation cost, maximum rounds, how the Perform result changes, target eligibility by the PF1 ability description, and the 8+ round rules are all the original Item's responsibility.

## 2. Provide the origin of the saving throw

This is the necessary explicit context step: PF1's native post hook does not identify which spell caused the save. From the **target owner's** PF1 macro or Script Call, roll the save through the helper:

~~~js
const api = game.modules.get("pf1-automation-engine")?.api;
const target = canvas.tokens.controlled[0]?.actor;
if (!target || !api?.saveOverrides) throw Error("Select the saving Actor.");

await api.saveOverrides.rollWithContext({
  actor: target,
  saveType: "will",
  sourceItemUuid: "Actor.CASTER.Item.SONIC_SPELL",
  options: {skipDialog: false}
});
~~~

The source Item UUID may be an actual Item or a Compendium Item. Its **structured descriptors** and magical type are checked by the GM. The helper calls **PF1's native** `actor.rollSavingThrow(saveType,{...options,pf1aeSave:{sourceItemUuid}})`, so the normal d20 save and chat output remain intact. The pre and post hooks correlate the source context on the rolling client and send the saved ChatMessage ID to the elected GM. The GM reads the **actual stored roll total**, not a client-supplied numeric value.

The result comparison is reported after PF1 posts its normal roll. The original chat message may receive:

~~~js
message.getFlag("pf1-automation-engine","saveOverride")
// {normalTotal:17, effectiveTotal:23, saveType:"will", sourceItemUuid:..., winner:...}
~~~

Unannotated normal saves, saves without a stored chat message, and saves without an identifiable structured Item source do **not** receive automatic overrides. They can still be evaluated explicitly by an elected-GM script through `api.saveOverrides.resolve(...)`.

### Source effect descriptors (PF1 data)

The resolver reads Item data rather than parsing prose:

- `item.system.descriptors` (PF1 structured spell descriptors; may be an array).
- If unavailable, `item.system.spellDescriptors` or `item.system.spell.descriptors`.
- A deliberate GM-authored item flag `flags.pf1-automation-engine.saveTraits` may override otherwise missing metadata:
  `{magical:true,descriptors:["sonic"]}` or `{magical:true,descriptors:["language-dependent"]}`.

Supported normalized descriptors include `sonic` and `language-dependent` (with `language` / `languageDependent` aliases). The `magical` test accepts native PF1 Item `type:"spell"` and abilities explicitly typed `sp` or `su`; other items must provide valid structured metadata. A missing or ambiguous provenance fails **closed** (no replacement).

The source item flag is not executable code. The GM must ensure that manual metadata faithfully represents the actual effect and that the request really corresponds to that effect. The ordinary module socket is not a cryptographic security boundary against hostile clients.

## 3. Range, scene, hearing and conditions

The Engine rechecks **every** save, using the current scene and actor tokens:

- **30 ft / 9.144 m** maximum range, using `canvas.grid.measurePath()` rather than Euclidean pixel distance.
- Scene grid units `ft`/`feet` or `m`/`meters` are converted as needed.
- Only currently visible/available scene tokens are considered. Missing token, unknown grid unit, missing Foundry measurement API or another scene => no replacement.
- For `requiresHearing:true`, the target is excluded if deafened (`statuses` or PF1 condition flags).
- The sound collision backend (`CONFIG.Canvas.polygonBackends.sound.testCollision()`) must confirm an unobstructed sound path. Missing/throwing API => fails closed.
- The bard is eligible for their **own** Countersong if they can hear, even without a sound-wall check from themselves to themselves.
- Optional `requiresSight:true` uses the sight collision backend in the same conservative way.

**Token size note:** the current conservative implementation measures token **centers**, not nearest occupied squares. On very large tokens, this may reject targets that are within 30 ft of the token's edge. This is preferable to erroneously granting protection out of range; future improvements can adapt `TokenPF.getOccupiedCells()` without changing the stored rule schema.

## 4. Example resolution

| Normal PF1 save | Current Countersong | Effective total |
| ---: | ---: | ---: |
| 17 | 23 | **23** |
| 26 | 23 | **26** |
| 15 | Bard A: 20, Bard B: 27 | **27** |

The **normal PF1 save is still displayed**. If any rule applies, a separate compact message contains the normal save, the current values and bard names, and **Result used**. There is only **one message** for all valid candidate rules; repeating delivery of the same native message ID is ignored.

The summary is a **record of an effective save comparison**, not proof that PF1 itself retconned the effects of its own finished action. Any automation that checks save-versus-DC must read the published decision or original message flag before making a final rules decision.

## 5. Noninstantaneous sonic / language effects: explicit repeat save

Countersong also grants an additional saving throw each round against qualifying ongoing noninstantaneous effects. PF1's native save hook does not reliably expose *which ongoing buff* grants a save, the DC, or whether an effect was instantaneous. **The engine never loops over all buffs or invents extra saving throws.**

A GM or trusted, ability-specific Item Script may request an explicitly identified reroll:

~~~js
const api = game.modules.get("pf1-automation-engine").api;
await api.saveOverrides.requestRepeatSave({
  targetActorUuid: "Actor.TARGET",
  saveType: "will",
  sourceItemUuid: "Actor.CASTER.Item.SONIC_EFFECT",
  nonInstantaneous: true,
  dc: 18
});
~~~

The caller must first verify the effect is ongoing, has a legitimate additional save, is sonic/language-dependent, grants saving throws, and that the beneficiary can hear the performance that round. The method only invokes a native save; **it does not independently decide whether the effect ends or evaluate the DC for you**.

## 6. Security and multiplayer

The user who actually rolls the save posts PF1's normal chat message. The elected GM then resolves the message ID, verifies actor ownership and the message author, reads the actual persisted Roll total and evaluates the registered data-only rules against the **GM's current world state**. The resulting summary is produced by the elected GM.

- Registrations persist in `saveOverrideRegistry` world setting and survive F5.
- A bounded history of processed native chat message IDs persists as `saveOverrideProcessed` for deduplication across reconnections and GM handoffs.
- Socket requests have duplicate-ID suppression and are never allowed to inject executable callback functions.
- All final decisions come from the elected GM. The non-GM client only provides source Item metadata and a chat message reference; it cannot submit the replacement total.
- Save rules are linked to tracked `effectGroups` groups and become inert immediately when those groups no longer exist.
- The underlying Foundry module socket does not cryptographically authenticate claimed sender IDs. This integration is intended for trusted groups.
- The post-roll hook is **observational**. Replacing PF1 core outcome resolution would require a deeper supported API hook or integration with the specific calling spell's save/DC resolver.

## 7. GM debugging

Enable **Generic automation debug logs** in the module settings. Entries use prefix `[PF1AE][SaveOverride]`:

- `Save detected`
- `Target in range` / `Target out of range or distance unavailable`
- `Hearing check passed` / `Hearing check: deafened`
- `Replacement candidate`
- `Resolved`
- `Registered` / `Group removed: deleted linked overrides`

~~~js
const api = game.modules.get("pf1-automation-engine").api.saveOverrides;
console.table(api.list());
const candidates = await api.getApplicable({
  targetActorUuid: "Actor.TARGET",
  saveType: "will",
  sourceItemUuid: "Actor.CASTER.Item.SONIC_SPELL"
});
console.table(candidates);
~~~

`getApplicable()` is authoritative when called by the elected GM, whose scene, group registry and actor flags are evaluated; it otherwise returns no candidates.

## 8. Acceptance tests

- [ ] With 24 from Countersong and 17 normal save, effective total is 24.
- [ ] With 18 from Countersong and 22 normal save, total stays 22.
- [ ] Target beyond 30 ft, deafened, or blocked by sound wall: no replacement.
- [ ] Ordinary magical non-sonic/non-language spell: no replacement.
- [ ] Sonic spell: eligible. Language-dependent spell: eligible.
- [ ] Two bards (20 and 27): one decision with effective total 27.
- [ ] Ending the source group: registered rule removed/inert.
- [ ] Save after F5: registered rule and dynamic current check still apply.
- [ ] Player 1 bard, player 2 saver, two GMs: only the elected GM posts a summary.
- [ ] Unannotated save from the normal sheet button: no guess/no replacement.
- [ ] Verify natural 1/20 consequences remain under PF1 rules; replacement total **does not change the die face**.
- [ ] Verify no extra saves are scheduled for persistent buffs without explicit Item provenance and DC.

**Reference:** [PF1 Automation Engine Technical Guide](TECHNICAL-GUIDE.md) · [Compendium Buff Templates](COMPENDIUM-BUFF-TEMPLATES.md). This feature is additive to v1.10.0.
