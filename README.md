# PF1 Automation Engine

**Version 1.19.0 · Foundry VTT 13.351 · Pathfinder 1e (PF1) 11.11**

Generic, rules-neutral automation services for native PF1 Item Script Calls. This module does not ship standalone example character scripts; abilities remain configured on their Foundry Items.

## Installation

**Recommended — Foundry VTT module installer:** Settings → Add-on Modules → Install Module → **Manifest URL**, paste:

```text
https://raw.githubusercontent.com/Caelvanost/pf1-automation-engine/main/module.json
```

The stable manifest points to the versioned ZIP asset of the [latest published release](https://github.com/Caelvanost/pf1-automation-engine/releases). It also enables subsequent module updates through Foundry. **Do not paste the ZIP download URL into the Manifest URL field.**

**Manual alternative:** extract the complete release ZIP into `Data/modules/pf1-automation-engine/` (the `module.json` must be at that directory's root), then enable PF1 Automation Engine in a PF1 11.11 world. A connected GM is required to perform authoritative mutations. `genericDebug` enables diagnostics; `genericEnabled` controls generic execution.

## Services

| Service | API | Purpose |
| --- | --- | --- |
| Managed buffs | `api.effectGroups` | Apply/extend/stop source-linked effects on multiple targets, including those owned by other users |
| Turn and world-time timers | `api.generic`, `api.duration` | Persistent combat phase and elapsed-time expirations |
| PF1 saving throw context | `api.saveContext` | Identify genuine PF1 Action cards, IDs and save DC |
| Saving throw modification | `api.saveOverrides` | Countersong, Distraction and other effective-total overrides |
| Saving throw consequences | `api.saveOutcomes` | Source-bound native conditions, including Fascination and timed Stunned |
| Applied attack damage | `api.attackOutcomes` | Correlate a specific native attack-card strike with actual damage, then trigger a follow-up Item Action |
| Rest/discovery | `api.rest`, `api.discovery` | Native PF1 rest observability and approved event rules |

Read the precise APIs in [Effect Groups](API-EFFETS-GROUPES.md), [Save Outcomes](docs/SAVE-OUTCOMES.md) and [Attack Outcomes](docs/ATTACK-OUTCOMES.md). The engine requires a real native PF1 card to claim provenance; a bare HP update or a manual sheet save does not establish that provenance.

## Native damage bridge (v1.14.3)

PF1 11.11 can apply damage from the action card **without entering the `ApplyDamage._onApply` wrapper**. Earlier v1.14.1 rejected this path. The updated bridge listens to `pf1ApplyDamageTargetOptions` and `pf1ApplyDamage`, captures a precise card/attack index/target and follows the resulting `updateActor` event on the **same elected-GM client**. A fresh, unique pair of native hooks, exact source identity, consistent target UUID and positive effective damage are all required. Options may be cloned between hooks. The existing dialog wrapper remains available but is no longer the only success path; `ActorPF.applyDamage`'s non-configurable accessor is untouched.

Fail-closed: conflicting card or attack index, overlapping damage requests to one Actor, stale options, a different update user, missing authoritative native pre-hook or no proven damage cause the follow-up to be refused. Temporary HP-only absorption does not count as proven damage under the current bridge. Attribution when multiple unrelated updates happen in the same very short window cannot be guaranteed by public hooks; check the debug diagnostics and adjudicate manually if the source cannot be established. This remains an **experimental integration**, not a transactional damage receipt from PF1.

Enable debug and look for:

```text
[PF1AE][AttackOutcome] Direct native damage options captured (no dialog)
[PF1AE][AttackOutcome] pf1ApplyDamage received
[PF1AE][AttackOutcome] Native damage actor update observed
[PF1AE][AttackOutcome] Native damage applied; dispatching verified outcome
[PF1AE][AttackOutcome] Triggered source-specific follow-up Action
```

The follow-up PF1 Action can register `saveOutcomes` **before** posting its native save card. A failed Fortitude save for Stunning Fist creates the `stunned` condition, with source-combatant turn-start expiry if configured.

## Security and persistence

The elected GM owns world-setting registries. Remote registrations validate ownership of the source Actor; target ownership is not required. Follow-up actions must belong to the same source Actor. Each attack is bound to its native ChatMessage, Action ID, explicit zero-based attack index and target Actor UUID. Persistent states prevent double execution across F5 and GM changes. Ambiguous provenance is rejected.

## Debugging

```js
const api = game.modules.get('pf1-automation-engine')?.api;
console.table(api?.attackOutcomes?.list() ?? []);
console.table(api?.saveOutcomes?.list() ?? []);
console.table(api?.effectGroups?.listGroups() ?? []);
```

Verify the native SaveBridge startup logs (`Installed PF1 save hooks`, `PRE`, `POST`) when debugging saving throws. The damage bridge uses native PF1 hooks plus the actual actor update; never assume that a native damage PRE event alone means the target took damage.

## Documentation and tests

- [Attack Outcomes](docs/ATTACK-OUTCOMES.md)
- [Save Outcomes](docs/SAVE-OUTCOMES.md)
- [Turn-phase expirations](API-EXPIRATIONS.md)
- [Duration manager](API-DUREES.md)
- [Native PF1 rest](docs/PF1-NATIVE-REST.md)
- [API for Item Script Calls](API-SCRIPTS-OBJET.md)
- [Changelog](CHANGELOG.md)

Run `node --test tests/*.test.cjs` for Node regression tests. Live Foundry testing is additionally required for each specific damage-dialog path, permissions and overlapping updates. No standalone example scripts are distributed.

### PF1 synthetic Actor HP offsets (v1.14.4)

The native direct-damage bridge accepts `updateActor` changes in `system.attributes.hp.value` **or** `system.attributes.hp.offset` for linked and unlinked Token Actors. When available, the native `options.pf1.deltas.hp` and `_nasPrevHp` are checked for consistency. A negative offset is **not** sufficient to prove damage: the bridge requires a before/after loss of effective HP or an increase in nonlethal damage, and the verified attack card, action, attack index and target Actor UUID must match. No change to the public `attackOutcomes` API or Item Script Calls is necessary.

## Approved mechanical save-outcome templates (v1.15.0)

`saveOutcomes.register()` additionally accepts `onFailure.type = "templateEffect"`, copying an approved PF1 Buff or ActiveEffect with native mechanical changes to the precise save target after a failed save. Existing `linkedBuff` and bardic automations are unchanged. Use existing managed effect groups for deletion and persistent duration timers, with `stack`, `replace`, `refresh`, and `ignore` stacking policies. **Only fixed-value, GM-approved template mechanics are supported**; the new API rejects dynamic `parameters` rather than interpreting untrusted PF1 field paths. See [Template Save Outcomes](docs/TEMPLATE-SAVE-OUTCOMES.md).

## v1.18.0 — Declarative dynamic effects

The new `api.effects` service allows GM-authorized source Item Actions to create timed native PF1 mechanical buffs directly from validated numeric changes. `saveOutcomes.register` accepts `onFailure.type="dynamicEffect"`, while `linkedBuff` and `templateEffect` remain unchanged. See [Dynamic Effects](docs/DYNAMIC-EFFECTS.md).

## Effets automatiques sans approbation manuelle (v1.18.0)

Les buffs déclaratifs `dynamicEffect` ne requièrent plus l'appel préalable à `api.effects.approve()` lorsqu'ils restent dans la politique automatique (3 changements au maximum, valeurs de -10 à +10, chemins/types PF1 natifs vérifiés). Les modèles `templateEffect` passifs sont approuvés automatiquement lors de l'enregistrement, sous contrôle d'empreinte et sans exécuter de scripts. Les autorisations explicites existantes prévalent et une révocation bloque la capacité.

Les joueurs ne peuvent pas utiliser ce mode pour appliquer directement un malus à un ennemi sans sauvegarde vérifiée : le mode direct automatique est limité à leur propre Actor ; pour les adversaires, utiliser `saveOutcomes.dynamicEffect`. Voir [Dynamic Effects](docs/DYNAMIC-EFFECTS.md).

### Compatibilité Attack Outcomes → Save Outcomes (v1.18.0)

Les actions déclenchées par les dégâts peuvent désormais enregistrer `onFailure.type: linkedBuff`, `templateEffect` ou `dynamicEffect`. `attackOutcomes` ne valide que la liaison de la carte, de la source, de l’Action et des cibles ; `saveOutcomes` et `api.effects` valident les champs mécaniques, la durée et le cumul. L’objet `onFailure` est transmis intact.

### Expiration des effets au retrait d’un combat (v1.18.0)

La fin ou la suppression d’un Combat nettoie les états temporaires indépendants liés à son échéance de tour, ainsi que les groupes d’effets enregistrés. Les minuteurs de scripts sont annulés **sans lancer les scripts** ; les minuteurs en temps de jeu ne sont pas touchés. Lorsqu’une scène ou un token synthétique est indisponible, le nettoyage est conservé dans le registre pour un nouvel essai après reconnexion ou changement de scène. Les états permanents et les documents d’autres modules ne sont jamais identifiés par leur seul nom ou leur seul `statusId`. Voir [Nettoyage de combat](docs/COMBAT-CLEANUP.md).

## Abonnements aux événements de jets d’attaque (v1.18.0)

Les objets PF1 peuvent réagir sans utilisation manuelle : ajouter un **Script Call « Après utilisation » nommé exactement `PF1AE:attack:resolved`** dans l’Item concerné. Le moteur écoute les hooks natifs `pf1AttackRoll` et `pf1PostActionUse`, puis transmet chaque jet individuel évalué à l’appel de script. Aucune déduction de touche (`hit: null`) et aucun jet ou effet supplémentaire produit par le moteur. Voir [Attack Events](docs/ATTACK-EVENTS.md).

## Bootstrap persistant des Script Calls (v1.18.0)

Les Items peuvent demander la réinstallation de leur automatisation JavaScript après F5 via `api.bootstrap.register({actor,item,key,scriptId?})`. Les seules inscriptions persistantes sont restaurées sur le client propriétaire, en utilisant `ItemScriptCall.execute()` dans un contexte `bootstrap:restore` sans provoquer un véritable toggle. Pour un nettoyage sûr, le script appelle `bootstrap.listen(hook,callback)` au lieu de `Hooks.on()` brut. Voir [Bootstrap persistant](docs/BOOTSTRAP.md).
## Événements de dégâts natifs et critiques (v1.19.0)

Un objet peut réagir aux **dégâts effectivement appliqués par une attaque native**, sans être utilisé manuellement. Ajouter un Script Call « Après utilisation » nommé `PF1AE:damage:applied`, `PF1AE:damage:critical` ou `PF1AE:damage:zeroHP`. La détection utilise exclusivement le pont de dégâts `attackOutcomes` déjà présent ; un jet critique sans perte de PV ne suffit pas. Le MJ élu confirme l'application puis le propriétaire du personnage exécute son Script Call, sans transfert de code exécutable au MJ. Voir [l'API et le protocole de validation](docs/DAMAGE-EVENTS.md).
