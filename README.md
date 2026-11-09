# PF1 Automation Engine

**Version 1.16.1 · Foundry VTT 13.351 · Pathfinder 1e (PF1) 11.11**

A generic automation module for PF1 Item Script Calls. It provides reusable, persistent services while leaving the rules of individual spells, feats and class abilities in the relevant PF1 Items. It does **not** include ready-to-use character-specific ability scripts.

> **Status:** The latest native save and damage bridges are experimental and require testing in a live PF1 11.11 world. A registered outcome does not mean an attack, save or damage application was successfully resolved.

## Features

| Service | Public API | Purpose |
| --- | --- | --- |
| Multiple-target effects | `api.effectGroups` | Apply, extend and stop tracked PF1 buff/ActiveEffect groups across actors, using an elected GM to perform authorized writes |
| Timers and durations | `api.generic`, `api.duration` | Turn-start/end deadlines and elapsed-world-time durations, including F5 persistence |
| Saving throw context | `api.saveContext` | Verify native PF1 source Action cards, saving throw type and DC |
| Save overrides | `api.saveOverrides` | Resolve a final effective saving throw total, including data-driven effects such as Countersong and Distraction |
| Save outcomes | `api.saveOutcomes` | Apply source-bound PF1 conditions after a **real** native saving throw, based on the effective total |
| Attack outcomes | `api.attackOutcomes` | Wait for **verified damage application** from a specific native PF1 attack card before triggering a follow-up Item Action |
| Native rest | `api.rest` | Observe PF1 rest and resource/health changes without replacing the system's rest mechanics |
| Discovery / event automation | `api.discovery`, `api.generic` | Register approved generic rules and Item Script Call callbacks |

The API list is an overview; consult the linked reference documents for exact signatures and prerequisites.

## Installation

1. Install the ZIP with `module.json` at the root of `Data/modules/pf1-automation-engine/`.
2. Enable **PF1 Automation Engine** in a Foundry v13 world running **PF1 11.11**.
3. Keep an active GM connected for authoritative mutations and world-setting writes.
4. Create any rules-specific scripts within the appropriate PF1 Item's native **Advanced → Script Calls** (`Avancé → Appels de script`). There is no separate script-installation step in this repository.

The module supports multiple connected GMs by electing a single executor. Players may request permitted operations for source Actors they **own**; target Actors need not be owned by the requester. A request can still be refused when provenance, template trust or other validations fail.

## Getting started

Retrieve the API from an Item Script Call:

```js
const api = game.modules.get("pf1-automation-engine")?.api;
if (!api) throw new Error("PF1 Automation Engine is unavailable.");
```

### Managed effects

Use `api.effectGroups.applyGroup({actor,key,templateUuid,targets,timing})` for a precise combat-turn expiry, or provide `duration` for elapsed game time. `extendGroup()` and `stopGroup()` operate on the same actor/group key. The elected GM validates source ownership and approved template data without an interactive approval dialog. Executable, untrusted templates are not silently authorized.

See [Effect Groups](API-EFFETS-GROUPES.md), [Silent multi-player operations](docs/SILENT-EFFECT-GROUPS.md), and [Compendium buff templates](docs/COMPENDIUM-BUFF-TEMPLATES.md).

### Native saving throws and conditions

`saveContext` identifies the source **Item Action** on a native PF1 chat card. The SaveBridge listens to `pf1PreActorRollSave` and `pf1ActorRollSave`, preserves the native roll, resolves optional `saveOverrides` and then calls `saveOutcomes` using the **final effective total**. Manual sheet saves without verified card provenance never trigger source-bound outcomes.

`api.saveOutcomes.register()` binds an effect to an exact source Item, Action ID and target Actor UUID. A durationless `linkedBuff` remains tied to an active `effectGroups` session (e.g. Fascination). A `linkedBuff` with `onFailure.duration` is an independent timed condition (e.g. Stunning Fist / `stunned`), with an optional source turn-start or turn-end expiry. Native conditions are checked against the installed PF1 registry; uncertain immunity verification fails closed for new conditions.

See [Native save context](docs/NATIVE-SAVE-CONTEXT.md), [Save Overrides](docs/SAVE-OVERRIDES.md), [Distraction](docs/DISTRACTION.md), and [Save Outcomes](docs/SAVE-OUTCOMES.md).

### Native attacks and applied damage

`api.attackOutcomes.register()` and `bindAttack()` track one specific PF1 attack **ChatMessage**, Item Action and attack index. The damage bridge correlates PF1's damage dialog/options with the matching card, then checks whether an application **actually changed the target's damage state**. It does not infer an attack from arbitrary HP loss. On confirmation, it can register a `saveOutcomes` rule and request a follow-up PF1 Item Action (for example, the Fortitude save on Stunning Fist).

PF1 v11.11 may expose `ActorPF.applyDamage` as a non-configurable accessor. The engine **does not replace that accessor**. Instead, the experimental damage bridge observes the native ApplyDamage dialog completion and corroborates source data using PF1 hooks. Missing or ambiguous provenance causes a safe refusal, not a guessed trigger.

See [Attack Outcomes: API, provenance, limitations and tests](docs/ATTACK-OUTCOMES.md).

### Durations, rest and events

Timers are persisted in hidden world settings. Turn-boundary timers follow the appropriate combatant; elapsed timers follow Foundry `game.time.worldTime` (a PF1 round is 6 seconds). The module never advances the world clock. Native PF1 rest observation does not duplicate healing.

See [Duration API](API-DUREES.md), [Turn-phase expirations](API-EXPIRATIONS.md), [Native rest](docs/PF1-NATIVE-REST.md), and [Generic automation](API-GENERIQUE.md).

## Debugging

Enable the module's **generic debug** setting, then open each affected client's browser console. On F5, look for:

```text
[PF1AE][SaveBridge] Installed PF1 save hooks
[PF1AE][SaveBridge] SaveBridge ready
[PF1AE][AttackOutcome] Installed native damage bridge
```

Every native PF1 saving throw should log `[PF1AE][SaveBridge] PRE` and `POST`, even without a matching outcome. An Action-card save with verified context is eligible for `saveOutcomes`. The attack bridge logs card binding, native damage corroboration and triggered follow-up actions.

For registry inspection:

```js
const api = game.modules.get("pf1-automation-engine")?.api;
console.table(api?.effectGroups?.listGroups() ?? []);
console.table(api?.saveOutcomes?.list() ?? []);
console.table(api?.attackOutcomes?.list() ?? []);
console.table(api?.generic?.listTimers() ?? []);
console.table(api?.duration?.listTimers() ?? []);
```

If PRE/POST appears but no result is applied, inspect source-card provenance, Action ID, target UUID, `genericEnabled`, the elected GM, PF1 condition registry and immunities. For attack outcomes, confirm the exact attack index and the completed damage-dialog path.

## Documentation

- [Technical architecture and permissions](docs/TECHNICAL-GUIDE.md)
- [Native PF1 Item Script Call conventions](API-SCRIPTS-OBJET.md)
- [Save Outcomes](docs/SAVE-OUTCOMES.md)
- [Attack Outcomes](docs/ATTACK-OUTCOMES.md)
- [Native rest](docs/PF1-NATIVE-REST.md)
- [Compendium templates](docs/COMPENDIUM-BUFF-TEMPLATES.md)
- [Full changelog](CHANGELOG.md)

The reference material includes API usage notes. **Standalone example scripts are not distributed in this repository**; individual ability scripts should be maintained with the relevant Foundry world or character Item. The generic engine intentionally remains independent of the bard, monk or any other specific class.

## Testing and compatibility

The regression tests are in `tests/*.test.cjs`; run with `node --test tests/*.test.cjs`. GitHub Actions builds an installable module archive. Simulated tests do not establish that a particular PF1 11.11 damage dialog or Action card will expose every metadata field in a user's world; verify source attribution, multiclicks, private saves, immunities, permission boundaries, reconnections, and turn expiry in Foundry before relying on automatic consequences in play.

## License and maintenance

Version history: [CHANGELOG.md](CHANGELOG.md). Issues and changes: [GitHub repository](https://github.com/Caelvanost/pf1-automation-engine).

### Native PF1 direct damage update (v1.14.3)

An attack card may apply its damage without entering `ApplyDamage._onApply`. The module now correlates `pf1ApplyDamageTargetOptions`, `pf1ApplyDamage`, and the resulting `updateActor` to preserve a verified native card/action/attack-index/target chain. A mere HP decrease never triggers an outcome. A very short correlation window and ambiguity checks are essential because PF1 does not expose a permanent transaction ID across these hooks. See [Attack Outcomes](docs/ATTACK-OUTCOMES.md).

### PF1 synthetic actor HP offsets (v1.14.4)

The damage bridge recognizes both `hp.value` and `hp.offset` updates on native `updateActor`, including synthetic unlinked tokens. Native `options.pf1.deltas.hp.offset` and `_nasPrevHp` are checked where present. An offset alone never triggers an outcome: the bridge requires a verified provenance chain and effective HP loss or actual nonlethal damage. All `attackOutcomes` API signatures and Item Script Calls remain unchanged.

## Approved mechanical templates after a saving throw (v1.15.0)

The existing `saveOutcomes.register` now also accepts `onFailure:{type:'templateEffect',templateUuid,duration,stacking}`. A native PF1 saving-throw failure clones an **approved, unchanged** PF1 Item Buff or Actor ActiveEffect with its own mechanical changes. Copies use existing `effectGroups`, `ItemPF.setActive`, the world ledger and duration/turn timers. Stacking modes: `stack`, `replace`, `refresh`, `ignore`, with a shared target key that may span multiple source Actors. **Dynamic `parameters` are not supported in v1.15.0**; supply fixed-value models approved in Foundry. The `linkedBuff` API, bardic automations and all existing save/damage bridges remain unchanged. [Full template effect API](docs/TEMPLATE-SAVE-OUTCOMES.md).

## Dynamic native PF1 effects — v1.16.1

PF1AE now provides `api.effects.approve/apply/revoke/listApprovals` for GM-approved, temporary native PF1 mechanical buffs without a precreated Item or ActiveEffect template. The approval is tied to an Item Action fingerprint and an explicit mechanical target/modifier/magnitude allowlist. `saveOutcomes.register` now supports `onFailure.type:'dynamicEffect'` after verified native saving throws. Existing `linkedBuff` and `templateEffect` are unchanged. For API, security limitations and acceptance steps see [Dynamic Effects](docs/DYNAMIC-EFFECTS.md).

## Effets automatiques sans approbation manuelle

Avec `saveOutcomes.dynamicEffect`, un effet purement déclaratif n'exige plus d'appel préalable à `api.effects.approve()` dans les limites par défaut : au plus **3 changements**, valeur absolue **≤ 10**, et types/champs reconnus par PF1. Les modèles `templateEffect` passifs et source-bound non encore approuvés sont approuvés automatiquement et leur empreinte reste contrôlée. Les effets directs demandés par un joueur sans autorisation explicite sont limités à son propre acteur ; pour affecter un ennemi, employer le jet natif vérifié par `saveOutcomes`. Les restrictions explicites et révocations MJ prévalent.
