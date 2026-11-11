# PF1 Automation Engine

**Version 1.21.2 · Foundry VTT 13.351 · Pathfinder 1e (PF1) 11.11**

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

The release workflow runs 21 maintained Node regression suites in isolation; seven historical suites are explicitly excluded because their fixtures or assertions still need maintenance. The separate **Legacy regression audit** workflow can run the full inventory for diagnosis and is not a release gate. Locally, run `node --test tests/*.test.cjs` for a full diagnostic inventory (legacy failures remain expected) or use the release workflow's per-file commands for the maintained gate. Live Foundry testing is additionally required for specific damage-dialog paths, permissions and overlapping updates. No standalone example scripts are distributed.

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

## Reprise MJ des scripts d'objets (v1.19.1)

Lorsque le propriétaire joueur d'un PJ se déconnecte, le MJ élu reprend l'exécution des Script Calls `PF1AE:damage:*` et des bootstraps persistants **uniquement si le Script Call natif a été explicitement approuvé** par le MJ. Le moteur compare l'UUID de l'acteur, de l'Item, l'ID du Script Call et **son contenu source sérialisé exact** avant toute exécution de secours. Toute édition impose une nouvelle approbation. Les scripts `PF1AE:attack:resolved` exécutés depuis une session MJ sur un PJ contrôlé par un joueur respectent la même protection. Voir [Documentation des approbations](docs/SCRIPT-FALLBACK-APPROVALS.md).

## v1.20.0 — Table de confiance (opt-in)

Activer **Table de confiance** dans les paramètres du monde (MJ seulement). Par défaut, ce mode est **désactivé** ; toutes les approbations explicites restent requises pour la reprise MJ des Script Calls des joueurs.

En mode Table de confiance, ajouter un Script Call natif **Basculer/toggle** nommé exactement `PF1AE:bootstrap` à une capacité suffit : PF1AE le découvre sur les acteurs disponibles, y compris les acteurs synthétiques accessibles via les scènes, et l'exécute **uniquement comme initialisation** avec `restoring:true`, `state:null` et `bootstrap.listen(...)`. Aucune activation de capacité, dépense de ressource, `item.use()` ou `setActive()`. Les scripts non nommés ou de catégorie différente ne sont jamais initialisés. Les anciens `api.bootstrap.register()` restent utilisables et sont dédupliqués avec la découverte automatique.

Les Script Calls exactement nommés `PF1AE:bootstrap`, `PF1AE:attack:resolved`, `PF1AE:damage:applied`, `PF1AE:damage:critical` et `PF1AE:damage:zeroHP` peuvent être repris par le MJ élu sans approbation individuelle en mode de confiance ; les autres scripts et le mode sécurisé ne changent pas. L'élection multijoueur, les contrôles de provenance des dégâts, les permissions de documents et la déduplication restent applicables.

**AVERTISSEMENT :** les JavaScript de capacités éditables par les joueurs peuvent être exécutés avec les privilèges du MJ pendant une reprise. N'activer ce mode que pour une table privée de confiance. Une scène, une reconnexion, la création/suppression/modification d'une capacité ou un changement de paramètre provoquent une synchronisation et un nettoyage des listeners suivis. Les hooks créés manuellement via `Hooks.on()` ne sont pas nettoyables par le moteur : utiliser `bootstrap.listen()`.

Voir [Bootstrap](docs/BOOTSTRAP.md) et [approbations MJ](docs/SCRIPT-FALLBACK-APPROVALS.md). La suite `tests/trusted-table.test.cjs` vérifie les transitions et les doublons simulés ; une validation en vraie session multijoueur Foundry reste requise.

## v1.21.0 — Assistante de portée native (expérimentale)

Le paramètre de monde MJ **Calcul automatique des pénalités de portée** est désactivé par défaut et indépendant de **Table de confiance**.

Pour une action d'attaque à distance de type `rwak` ou `twak` avec facteurs de portée (`range.maxIncrements > 1`), PF1AE intercepte **`pf1CreateActionUse`**, avant l'évaluation des jets. Lorsque **exactement une cible** et un token attaquant sur la même scène sont disponibles, il mesure la distance par `canvas.grid.measurePath()` entre les cellules occupées des tokens, lit la portée de l'action par `action.getRange({type:'single',rollData})`, et fournit à la configuration native le facteur calculé. Le moteur PF1 reste seul responsable de l'ajout du malus au jet via son pipeline `ActionDialog → ActionUse.applyConfig`. Aucun bonus n'est ajouté manuellement à la fiche ou après le jet.

Calcul : facteur 1 jusqu'à la première limite incluse ; facteur 2 : −2 ; facteur 3 : −4 ; etc. Le facteur maximal configuré sur l'action est conservé. Le réglage ne touche ni à la CA de contact ni aux coûts de Deadeye/Grit.

**Convention métrique de cette table** : 5 pieds = 1,5 m. Sont reconnues les unités de scène `m`, `mètre(s)`, `meter(s)`, `ft`, `foot`, `feet`, `pied(s)`. L'API `action.getRange()` retourne normalement la portée dans les unités **système PF1**, qui peuvent différer des unités de scène ; la conversion suit cette convention. Les unités inconnues, les cibles multiples, les actions sans facteur, les sorts et les données manquantes restent au comportement natif.

**Protection des modificateurs :** un réglage natif explicite du facteur ou du malus, ou l'option de contournement connue, empêche toute modification par PF1AE. L'outil n'intervient pas sur les jets déjà évalués. Une attaque hors portée affiche un avertissement et reste non modifiée : la configuration native détermine toujours si l'action est possible.

**Limite importante :** le point de jonction a été recoupé avec les signatures publiques PF1 et une copie GitHub de code PF1 plus récente ; le source *exact* du tag 11.11 n'a pas été directement récupérable ici. Le pipeline natif doit donc être vérifié sur une installation réelle PF1 11.11 avant de considérer la correction comme définitivement validée. Le comportement de la case **Skip Ranged Increment Checks**, notamment, doit être vérifié sur des jets réels. L'option reste désactivée par défaut afin de ne pas changer les parties existantes.


### v1.21.1 — Correction des pénalités de portée

PF1 11.11 peut initialiser `formData.rangePenalty` ou `config.rangePenalty` à **zéro** avant que le module ne calcule la portée. PF1AE interprétait à tort ce zéro comme un modificateur manuel et ignorait le jet. La valeur zéro est désormais traitée comme une absence de pénalité préexistante. Un **modificateur manuel non nul** reste prioritaire.

La détection de l'attaquant accepte un `TokenDocument` ou un `Token`, et `api.range.lastDiagnostic()` expose la dernière décision du calcul (facteur, pénalité ou raison du refus). Pour diagnostiquer après une attaque :

```js
console.log(game.modules.get('pf1-automation-engine')?.api?.range?.lastDiagnostic());
```

Les tests automatisés vérifient les valeurs zéro natives et les TokenDocuments. La compatibilité sur une véritable installation PF1 11.11 doit encore être confirmée en jeu.

### v1.21.2 — Malus de portée dans le jet, et correction pieds/mètres

Les versions 1.21.0–1.21.1 pouvaient afficher `status: configured` sans changer réellement le jet, parce que PF1 reconstruisait les valeurs du dialogue après `pf1CreateActionUse`. Le module utilise désormais **`shared.attackBonus`**, tableau officiellement consommé par `ActionUse.addAttacks()` pour construire les jets natifs : le terme `-2[Range Penalty]` est injecté une seule fois **avant le lancer** (attaque simple et attaque à outrance partageant une seule cible). Aucun changement de fiche, aucun recalcul après jet, et aucune modification de la CA de contact ou de Deadeye.

Une portée numérique explicitement configurée `20 ft` est lue directement avec son unité : **20 pieds = 6 mètres** selon la convention de la table. `getRange()` n'est utilisé que pour les portées exprimées par une formule, car son résultat dépend des unités système PF1 et ne doit pas effacer l'unité déclarée sur l'action.

Le réglage **Calcul automatique des pénalités de portée** reste opt-in. Les modificateurs de portée manuels non nuls existant avant l'action restent prioritaires ; ne pas ajouter manuellement une seconde pénalité dans le dialogue du même tir. Le diagnostic après tir affiche le facteur calculé : `game.modules.get('pf1-automation-engine').api.range.lastDiagnostic()`. Attention, l'étiquette dans le jet provient de la localisation PF1.

**Validation** : les tests CI simulent le hook natif et vérifient l'ajout dans `shared.attackBonus` ainsi que les conversions. Le résultat sur un vrai jet dans Foundry v13.351 / PF1 v11.11 doit être confirmé en jeu.
