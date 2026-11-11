## v1.24.2 — Capacité Recharger fonctionnelle

- Retire la dépendance incorrecte aux automatisations génériques : le suivi du chargement dépend uniquement de son propre paramètre de monde.
- Reconnaît les actions natives non offensives `Recharger` / `Reload` directement sur les armes, ainsi qu'une capacité autonome `Recharger` sur un personnage possédant une seule arme rechargeable compatible.
- Évite de choisir une arme arbitraire quand plusieurs sont éligibles : avertissement clair et utilisation conseillée de l'action sur l'arme.
- Ajoute un diagnostic de rechargement et des notifications traduites en cas d'échec.
- Test de régression : capacité autonome, paramètre d'automatisations génériques désactivé et absence de consommation de munitions au rechargement.

## v1.24.1 — Correction du blocage des tirs sans chargement

- Corrige la cause d'une absence totale de blocage : l'ancien patch exigeait un constructeur interne ActionUse non exporté ; les hooks PF1 n'étaient alors jamais installés.
- Branche directement les hooks natifs `pf1CreateActionUse` et `pf1PreActionUse` pour refuser un tir **avant le jet, le chat et la consommation native**, sans modifier de prototype PF1.
- Considère le premier tir d'une arme à feu reconnue, mais pas encore chargée, comme impossible (0 projectile chargé).
- Utilise uniquement une action native `Recharger` / `Reload` créée par le joueur ; ne crée plus d'action, n'applique plus automatiquement le don Rechargement rapide et ne détermine plus le coût en actions.
- Retire le bouton de rechargement direct du widget pour ne pas contourner l'action native ; ajoute un diagnostic de blocage `api.reload.lastDiagnostic()`.
- Tests mis à jour : tir initial interdit, tir interdit à vide, double canon, action Recharger native et consommation des munitions une seule fois.

## v1.24.0 — Chargement automatique sans configuration obligatoire

- Supprime le grand formulaire de configuration de rechargement qui déformait la fiche PF1 ; le remplace par un contrôle discret dans l'en-tête de l'arme.
- Déduit la consommation par tir de `action.ammo.cost` et du nombre d'attaques natives ; conserve les anciens réglages manuels quand ils existent.
- Initialise automatiquement l'arme au premier rechargement en détectant son type de munition et sa capacité lorsqu'elle est explicitement décrite (ou correspond à un modèle simple connu), sans considérer toutes les armes inconnues comme capacité 1.
- Refuse les armes avec données contradictoires/incomplètes et conserve une correction facultative du MJ.
- Détecte Rechargement rapide uniquement si le choix de l'arme est explicite ; ne confère pas de réduction universelle à un don sans choix documenté.
- Régression : capacité du pistolet double canon, munition native, initialisation répétée et sélection de don.
- Limites inchangées : coûts d'actions non imposés mécaniquement, mélange de munitions et atomicité multijoueur non garantis.

## v1.23.1 — Correctif de l'interface de rechargement

- Corrige le filtre trop restrictif qui masquait les actions PF1 sans type de munition configuré.
- Affiche les objets de type munition de l'inventaire séparément et explique les prérequis natifs PF1 quand la sélection est vide.
- Refuse proprement une configuration avec une munition incompatible avec le type natif de l'action (sans modification de la fiche).
- Réorganise les contrôles en colonnes adaptables, place le panneau sous l'en-tête de la fiche et empêche l'agrandissement involontaire du panneau dans les mises en page flex.
- Traductions françaises et anglaises des libellés, messages d'aide et temps de rechargement.
- Étend le test de régression des listes d'actions et de munitions. Fonction de rechargement toujours expérimentale et opt-in.

## v1.23.0 — Noyau expérimental de rechargement natif

- Paramètre de monde opt-in indépendant de la portée et de la Table de confiance, sans migration automatique des armes existantes.
- Suivi persistant des chambres chargées sur l'Item, choix des objets de munitions PF1 natifs et réservation sans consommation au rechargement.
- Action PF1 de rechargement créée sans doublon, widget compact sur les fiches d'armes et API de recharge/décharge.
- Contrôle avant génération des jets des armes configurées, avec refus avant carte de chat, jets d'attaque et consommation native ; coûts par action configurables pour les doubles canons.
- Tests couvrant refus, rechargement partiel, consommation native et réduction de temps déclarative.
- LIMITATIONS : validation en session PF1 11.11 à faire ; dons et temps d'action non automatiquement appliqués, enrayement et cartouches mélangées non intégrés, non-atomicité multijoueur.

## v1.22.0 — Traductions françaises et anglaises dans Foundry

- Ajoute les ressources natives `lang/en.json` et `lang/fr.json` déclarées dans `module.json`, selon la langue de session de chaque client.
- Remplace la clé brute `PF1.Range.Penalty` dans le jet par un libellé traduit **Pénalité de portée / Range penalty**, conservant le calcul réel du malus pré-jet.
- Traduit les paramètres visibles (automatisations génériques, journaux, découverte, Table de confiance, portée, migration), les notifications de portée et de migration, et les messages de validation des effets/découvertes.
- Traduit le résumé du jet de sauvegarde produit dans le chat dans la langue du client créateur de ce résumé.
- Ajoute un test de parité et de format des traductions (clés, variables) et des simulations de jets dans les deux langues ; vérifie que les langues sont présentes dans le ZIP.
- Aucun changement de mécanique PF1, des noms techniques de Script Calls ou des valeurs de paramètres du monde.

## v1.21.2 — Correction du malus réel et de la conversion pieds/mètres

- Utilise le véritable chemin pré-jet : `pf1CreateActionUse` → `shared.attackBonus` → `ChatAttack.addAttack(extraParts)`, sans se reposer sur des données de dialogue susceptibles d'être écrasées.
- Lit les portées numériques directement dans leurs unités déclarées : 20 pieds = 6 mètres selon la grille Pathfinder de la table, au lieu d'une conversion système intermédiaire donnant un facteur excessif.
- Déduplication par instance d'action, préservation des bonus conditionnels, des scripts Deadeye, et des modificateurs de portée manuels préexistants.
- Étend les tests pour un facteur 2 à 9 m, les unités françaises, les portées numériques et les attaques répétées. Aucun changement des paramètres utilisateurs existants.

## v1.21.1 — Correctif d'application de portée native

- Corrige l'exclusion accidentelle des jets lorsque PF1 initialise la pénalité de portée à zéro.
- Accepte Token et TokenDocument pour le contrôle de scène et la mesure des cellules.
- Expose le dernier diagnostic via `api.range.lastDiagnostic()` pour identifier les cas où le moteur laisse volontairement l'attaque au système natif.
- Étend la suite de régression, conserve le paramètre opt-in et l'indépendance de Deadeye.

## v1.21.0 — Assistance de portée avant jet (optionnelle, expérimentale)

- Nouveau réglage de monde indépendant du mode Table de confiance pour les attaques d'armes à distance `rwak` et `twak`, désactivé par défaut.
- Intégration native pré-évaluation via `pf1CreateActionUse` ; sans modification des armes, des cartes déjà générées, des CA ni des scripts Deadeye.
- Mesures des cellules occupées et conversion pieds/mètres selon 5 ft = 1,5 m ; garde stricte pour les cibles ambiguës, les modificateurs manuels et les actions sans incréments.
- Test de régression dédié ; inclusion dans le workflow de publication et de construction de ZIP.
- Source native exacte du tag PF1 11.11 et comportement de la case Skip à confirmer en test Foundry réel avant activation généralisée.

## v1.20.0 — Mode « Table de confiance » et bootstrap natif automatique

- Ajoute un paramètre de monde désactivé par défaut, visible et modifiable par le MJ, avec un avertissement explicite sur l'exécution du JavaScript des joueurs sous privilèges MJ.
- Découvre les Script Calls **toggle** nommés exactement `PF1AE:bootstrap` dans les Items des acteurs du monde et des acteurs synthétiques disponibles ; initialise via `ItemScriptCall.execute()` sans basculer l'Item.
- Restaure les listeners suivis sur F5, reconnexion, transition d'exécutant et changement de scène ; événements ciblés pour les créations, éditions, suppressions et acteurs/tokens disponibles.
- Compare la source native des scripts, nettoie les anciennes fonctions lors d'une modification, évite les doublons avec les inscriptions sécurisées existantes et conserve ces dernières lors des changements de mode.
- En mode Table de confiance seulement, contourne les approbations individuelles pour les catégories et noms natifs stricts `PF1AE:bootstrap`, `PF1AE:attack:resolved` et `PF1AE:damage:*` connus. Les autres scripts restent soumis aux contrôles historiques ; la provenance native et les gardes de déduplication ne changent pas.
- Test dédié de multi-exécution, acteurs synthétiques, remplacement, sécurité et bascule des modes ; ajout à la barrière de release.
- Préserve les API existantes de PF1AE, les contextes Utilisation/Après Utilisation/Basculer et le manifeste GitHub permanent.

## v1.19.3 — Audit des tests et fiabilisation de la publication

- Le workflow de release vérifie désormais que les 28 suites de tests existantes sont explicitement réparties entre 21 suites obligatoires et 7 suites historiques exclues ; tout nouveau fichier de test exige une décision de maintenance explicite avant publication.
- Ajoute un workflow manuel `Legacy regression audit (diagnostic)` qui exécute tous les tests et affiche le résultat de chaque suite dans le résumé GitHub Actions, en signalant correctement un échec si une suite échoue.
- Met à jour le README, les métadonnées de version et l'URL du ZIP de release.
- Aucun changement des API ni de la logique d'automatisation PF1 ; les sept suites historiques restent à remettre en conformité.

## v1.19.2 — Attribution du module

- Corrige le nom de l'auteur affiché par Foundry VTT dans `module.json` : **Caelvanost** remplace **Module personnalisé**.
- Met à jour le numéro de version et l'URL du ZIP GitHub pour la release v1.19.2.
- Aucun changement du comportement ou des API du moteur.

## v1.19.1 — Exécution de secours MJ des Script Calls, sous approbation exacte

- `damageEvents` élit désormais le joueur propriétaire connecté le plus prioritaire, ou le MJ élu lorsque tous les joueurs propriétaires sont déconnectés ; les PNJ sans propriétaire joueur restent exécutés par le MJ élu.
- Nouveau service partagé `api.scriptApprovals.approve/revoke/list/check` : l'approbation MJ d'un Script Call est liée à l'UUID de l'acteur, de l'Item et à l'ID natif du script, ainsi qu'au contenu exact sérialisé. Toute édition invalide l'autorisation.
- Un refus explicite et journalisé bloque un Script Call non approuvé ou modifié lors d'une reprise MJ. Aucun JavaScript ne circule sur le socket d'approbation.
- Le même contrôle est appliqué au bootstrap persistant et aux abonnements `attack:resolved` exécutés par un MJ sur un PJ possédé par un joueur.
- `bootstrap` retire les hooks restaurés devenus non approuvés lors de la modification de l'Item.
- Les notifications de dégâts ne sont jamais exécutées sur le MJ à partir d'un socket `notify` non authentifié : seule la confirmation locale du MJ élu peut invoquer sa reprise.
- Tests de transition joueur/MJ, reconnexion, doublons et empreintes dans les suites `damage-events` et `bootstrap`.
- `module.json` v1.19.1 et ZIP de release correspondant. Aucun changement aux règles de classe.

## v1.19.0 — Événements génériques de dégâts confirmés (critiques et PV à zéro)

- Pont de dégâts natif unique : `attackOutcomes` émet un événement interne après corrélation carte/Action/attaque/cible, appel de dégâts PF1 et perte réelle de PV.
- Nouveau `api.damageEvents`, abonnements déclaratifs `PF1AE:damage:applied`, `PF1AE:damage:critical` et `PF1AE:damage:zeroHP` dans les Script Calls natifs « Après utilisation ».
- Conservation de `options.critMult`, des PV effectifs avant/après et prise en charge des tokens synthétiques et de `hp.offset` ; `criticalHitConfirmed` reste inconnu.
- Journal de déduplication persistant sur le MJ élu et livraison aux propriétaires joueurs sans faire exécuter leurs scripts avec les droits MJ.
- Rejet conservateur des applications annulées, ambiguës, sans perte de PV normaux ou absorbées uniquement par les PV temporaires.
- Nouvelle suite de tests et documentation `docs/DAMAGE-EVENTS.md`.
- `module.json` versionné en v1.19.0 avec l'URL de release GitHub correspondante ; APIs antérieures préservées.

## v1.18.0 — Bootstrap persistant des Script Calls

- Nouvelle API opt-in `api.bootstrap.register/unregister/list/restoreAll` et registre de monde géré par le MJ élu.
- Restauration après F5, reconnexion et changements de scène via `ItemScriptCall.execute(shared,extraParams)` avec le contexte `bootstrap/restoring`, sans basculer l’Item.
- Un seul client propriétaire exécute le bootstrap d’un acteur ; fallback MJ élu, anti-doublons et listeners suivis nettoyés par `unregister()`.
- UUID synthétiques complets, permissions OWNER, références invalides ignorées, aucune analyse des textes des Script Calls.
- Suite de régression bootstrap, documentation détaillée et exemple complet de script générique.
- Aucun changement aux moteurs existants : attaques, sauvegardes, buffs, durées ou autres Script Calls.

## v1.17.0 — Événements génériques de jets d’attaque pour Item Script Calls

- Ajout du pont natif `pf1AttackRoll` / `pf1PostActionUse` : un événement `attack:resolved` par jet évalué, émis après la fin de l’action native.
- Abonnement déclaratif par un Script Call PF1 `postUse` nommé `PF1AE:attack:resolved` ; découverte automatique sur les Items de l’acteur, sans hooks installés par les objets.
- Contexte d’attaque normalisé et prudent : attaquant, Item, Action, token, jet, ordre et cibles explicites ; `hit: null` faute de touche fiable.
- Protections contre doublons, récursion, abonnements en double et exécution par client sans droits.
- Un nouveau test automatisé couvre les attaques multiples, le déclenchement après utilisation native, les tokens synthétiques et les permissions.
- Aucun changement aux SaveBridge, attackOutcomes, saveOutcomes, Fascination, durées, conditions ou autres services.

## v1.16.3 — Nettoyage sécurisé des effets lors de la fin de combat

- Quand un combat est supprimé **ou arrêté** (`deleteCombat` / `updateCombat` non démarré), les minuteurs de phase sont traités **avant** leur retrait du registre ; les minuteurs de Script Call sont simplement annulés, sans exécution.
- Les ActiveEffects indépendants `saveOutcomes.linkedBuff` ne sont supprimés que si `timerId`, `outcomeId`, règle, acteur et Item/Action sources correspondent aux marqueurs PF1AE. Les buffs et effets sans ces marqueurs sont préservés.
- Les groupes `effectGroups` sont nettoyés par leur service existant ; si leur cible est inaccessible, une entrée `cleanupPending` est conservée pour une nouvelle tentative.
- Reprise persistante des nettoyages après F5, reconnexion ou `canvasReady`, même lorsqu'un combat a déjà été retiré de `game.combats`.
- Détection conservatrice des conditions orphelines antérieures à la version 1.16.3 : reconnaissance complète des flags et de l'origine, absence des minuteurs dans les **deux** registres, et délai de sécurité de 30 secondes depuis la création du document.
- Une expiration normale d'ActiveEffect en échec est désormais mise en attente pour nouvel essai, au lieu de perdre son minuteur.
- Nouveau test `combat-cleanup.test.cjs` : 13 suites de tests réussies (dont les 12 précédentes), avec acteurs synthétiques, plusieurs sources/MJ, échéances de tour, durée écoulée, orphelins et buffs d'autres sources.
- **Aucune modification des API publiques**, de Fascination, Coup étourdissant, Crushing Blow, `attackOutcomes`, `dynamicEffect` ou `templateEffect`.

## v1.16.2 — Interopérabilité attackOutcomes / saveOutcomes

- `attackOutcomes` accepte désormais les conséquences `linkedBuff`, `templateEffect` et `dynamicEffect`, comme `saveOutcomes`.
- Conservation de l’intégralité de l’objet déclaratif `saveOutcome` jusqu’à `saveOutcomes.register()` ; seul l’acteur source autoritaire et la cible des dégâts vérifiés sont imposés côté MJ.
- Conservation des vérifications Item, Action, index de frappe, carte native, Actor UUID (y compris synthétique) et déduplication.
- Tests d’intégration : échec/réussite `dynamicEffect`, copie mécanique, `templateEffect`, `linkedBuff`, acteur synthétique et minuteur.
- Aucun changement aux Script Calls de personnages.

## v1.16.1 — Approbation automatique des effets déclaratifs

- Supprime l'étape `api.effects.approve()` pour les nouveaux `dynamicEffect` déclaratifs respectant des limites strictes (3 changements, amplitude ≤ 10).
- Autorise automatiquement les modèles passifs `templateEffect` nouveaux, après validation de leur association à la source ; refuse les scripts/macros et les empreintes existantes modifiées.
- Préserve les approbations explicites, qui restent prioritaires ; `revoke` crée désormais une interdiction persistante plutôt que de réactiver le mode automatique.
- Pour les joueurs non-MJ, les effets directs sans autorisation explicite restent limités à soi-même, avec carte PF1 source obligatoire ; les malus adverses passent par un jet vérifié `saveOutcomes`.
- Conserve SaveBridge, attackOutcomes, Fascination, Coup étourdissant, Countersong, Distraction, durées, cumul et tokens synthétiques.

## v1.16.0 — GM-authorized dynamic PF1 mechanical buffs

- New `api.effects.approve/apply/revoke/listApprovals` API, exact ItemAction grants and numeric mechanical limits.
- Native PF1 buff `system.changes` creation with declarative `ItemChange` entries; no arbitrary script or formula execution.
- New `saveOutcomes` consequence `dynamicEffect` after verified native saves.
- Reuse group ledger and timers for persistence, expiry and four stacking modes.
- Preserve attackOutcomes, linkedBuff, templateEffect, bard automations and synthetic Actor UUIDs.
- Additional native-mock regression suite; real PF1 derived-stat verification remains necessary.

## v1.15.0 — Approved mechanical template effects after native saving throws

- Add generic `saveOutcomes.onFailure.type="templateEffect"` for PF1 Item Buff and ActiveEffect templates with mechanical changes, preserving all current `linkedBuff` behavior.
- Require exact fingerprint-based GM approval on registration and again before cloning, with unchanged source Actor/ItemAction and synthetic target verification.
- Reuse `effectGroups` copy ledger, native `setActive` and deletion, world-duration timers and turn-phase timers; persistent after F5/leader handoff.
- Support `stack`, `replace`, `refresh`, `ignore` (same-target global key across sources), serialized GM-authoritative deduplication and safe rollback.
- Accept only fixed-value approved mechanics; reject dynamic `parameters` in this version until PF1 native data paths are precisely verified.
- Add mechanical PF1 Buff and ActiveEffect regression tests, including successes, failures, synthetic targets, approval/fingerprint rejection, stacking and expiration.
- No modifications to Attack Outcomes, SaveBridge, Fascination, Countersong, Distraction or Stunning Fist Script Calls.

## v1.14.4 — Synthetic PF1 Actor damage confirmation (hp.offset)

- Accept both nested and flattened `updateActor` changes to `system.attributes.hp.value` and `system.attributes.hp.offset`, alongside temporary HP and nonlethal damage fields.
- Inspect PF1-native `options.pf1.deltas.hp.offset` and `_nasPrevHp` where provided, and verify against the effective Actor HP before/after rather than inferring damage from an offset alone.
- Maintain exact native attack-card/ItemAction/index/synthetic-target provenance, elected-GM authority, one-shot deduplication and short-lived direct-damage candidates.
- Add an unlinked Token Actor regression: 11 effective HP, 5 damage, `hp.offset=-5`, 6 HP remaining -> one follow-up Fortitude Action. An offset-only update with no actual loss remains ineligible.
- No public API or bard/monk Item Script Call changes. Local Foundry VTT v13/PF1 11.11 testing still required.

## v1.14.3 — Native direct damage correlation bridge

- Preserve exact native PF1 attack provenance when damage options arrive without entering tracked `ApplyDamage._onApply`.
- Correlate native `pf1ApplyDamageTargetOptions` and `pf1ApplyDamage` hooks by exact target, card, Action and attack index, tolerating options cloned between hooks only for one immediate unambiguous candidate.
- Verify actual damage in `updateActor` after the native damage PRE hook, with short timeouts and diagnostics for expected and received IDs.
- Keep previous dialog-based completion as a second path; never touch the non-configurable `ActorPF.applyDamage` accessor.
- Keep elected-GM authorization, persistent deduplication, native save outcomes, conditions and existing bard abilities unchanged.
- Expand attack outcome tests to cover direct damage, cloned options, wrong attack index and unrelated HP updates.
- This remains an experimental hook-based link and does not claim a transaction ID supplied by PF1.

## v1.14.1 — PF1 11.11 native damage dialog completion bridge

- Stop assigning `ActorPF.prototype.applyDamage`: the installed method is exposed via a non-configurable accessor. Never invoke its setter or redefine its descriptor.
- Observe the native `ApplyDamage._onApply` completion instead, while requiring both `pf1ApplyDamageTargetOptions` and `pf1ApplyDamage` provenance and verified post-application damage.
- Fail closed on missing native hooks, ambiguous target operations, interrupted dialogs, zero/fully absorbed damage and unrecognized native dialog APIs.
- Preserve attackOutcomes, saveOutcomes, SaveBridge, Fascination, Countersong, Distraction and condition timers.
- Regression simulation covers a non-configurable accessor and verifies no setter invocation.

## v1.14.0 — Source-bound attack damage outcomes (experimental)

- Add `api.attackOutcomes.register/bindAttack/unregister/list`, with source ItemAction, attack index and target validation, persistent GM-owned registry, socket acknowledgements, and deduplication.
- Correlate native `pf1ApplyDamageTargetOptions` to the specific Action ChatMessage and wrap PF1 `ActorPF.applyDamage()` without altering its result.
- Trigger the configured PF1 follow-up Action only after actual HP/nonlethal damage, after registering `saveOutcomes`; no saving throw on a miss or uncommitted damage.
- Guard against ambiguous sources, wrong target, duplicate clicks, non-GM remote attestation and interrupted execution.
- Preserve all existing v1.13.0 bardic automations and native save pipeline.
- Add Node test coverage and a complete configurable Stunning Fist example; live Foundry testing required.

## v1.13.0 — Generic PF1 save-outcome conditions and timed effects (experimental)

- Replace hardcoded fascinated-only validation with live `pf1.registry.conditions` status validation, preserving legacy Fascination.
- Add optional `onFailure.duration` for conditions independent of a parent group, including `rounds`/`seconds` and source turn-start/turn-end expiration.
- Use existing elected-GM timers and actor-specific ActiveEffect deletion. In combat, source-turn boundaries are used; outside combat durations use world time.
- Use PF1 actor `getConditionImmunities()` for native stunned and other condition immunity; fail closed and warn if immunity cannot be determined.
- Preserve source Action, real save DC, effectiveTotal, message-based deduplication and native PF1 save card behavior.
- Consume each target in a standalone rule after its verified saving throw; linked Fascination remains managed by its parent effect group.
- Requires a live-world acceptance test of stunning fist timing, token actors, and PF1 v11.11 conditions.

## v1.12.9 — SaveBridge bootstrapping and universal PF1 hook diagnostics

- Install native PF1 PRE/POST hooks unconditionally at init, with a guarded ready fallback and strict single-install protection.
- Emit `Installed PF1 save hooks` at initialization and `SaveBridge ready` at ready when generic debugging is enabled.
- Log native PRE/POST at callback entry, *before* the `genericEnabled` feature gate: logs now explain when a save was received but processing is disabled.
- No changes to source-card correlation, result resolution, Countersong, Distraction, Fascination Script Calls, or the Pathfinder 1 system.
- Add an isolated initialization regression test with no registered rules and `genericEnabled=false`.
- Runtime testing remains necessary to distinguish disabled automation from an unloaded module script.

## v1.12.8 — Native PF1 PRE/POST saving throw lifecycle bridge

- Log native `pf1PreActorRollSave` and `pf1ActorRollSave` for every enabled save, regardless of source context.
- Read the actual `ChatMessagePF` from POST and use its native roll total.
- Correlate PRE to POST only when one unambiguous pending save exists for an Actor/save type; fail closed on concurrent ambiguity.
- Preserve structured source-card provenance via `rollOptions.reference` / saveContext and suppress manual sheet rolls.
- Dispatch verified final totals through elected GM to `saveOutcomes`, including saves with no matching override.
- Preserve Countersong/Distraction effective totals, per-message idempotence and native card display.

## v1.12.8 — Native PF1 SaveBridge post-roll correlation (candidate)

- Add explicit `SaveBridge` diagnostics at native save click, pre-save hook, post-save, GM context validation and final outcome dispatch.
- Correlate PF1 d20-roll results that do not return ChatMessage objects to their separately created saving-throw ChatMessage, only when author, Actor speaker, actual rolls and structured save type match one pending native source-card save.
- Support message creation both before and shortly after `pf1ActorRollSave` without inspecting localized chat text, guessing a source Item or processing unrelated sheet saves.
- Install diagnostics for both `targetSavingThrowClick` and `Actions.onRollSave` when available, preserving native PF1 handlers.
- Keep the single elected-GM `saveOverrides` → final result → `saveOutcomes.resolve` pipeline, including saves with no applicable override.
- Add regression tests for delayed chat messages, no-override Fascination, and unrelated saving throws.
- Live PF1 11.11 click-handler/source-message acceptance testing is still required; no system files were modified.

## v1.12.6 — Silent, GM-authoritative multi-target automation

- `effectGroups.applyGroup`, `extendGroup` and `stopGroup` requests from owners now await a GM-leader socket acknowledgement and return actual success/error; no interactive GM approval.
- `effectGroups.approveTemplate(uuid)` can silently approve passive actor-owned templates from owner clients; compendium calls without an inferred source perform a non-authorizing preflight. `applyGroup` performs the source OWNER check and auto-validates and auto-approves eligible passive templates, including Compendium buffs.
- Reject automatic approval of templates with executable Script Calls, macro changes or untrusted module flags unless previously GM-trusted. Preserve precise canonical fingerprint comparison for all approved templates.
- Validate source Actor OWNER, Item/ActiveEffect provenance, source template contents and target documents on elected GM; **target ownership is not required** for source-owner initiated applications.
- Ignore identical re-application while the original group remains active within a short duplicate-click window; keep request-ID replay suppression and existing group-key replacement behavior.
- Keep saveOverrides and saveOutcomes pipelines unchanged; linked failure effects remain created by GM immediately and removed with the group.
- Note: rule-specific range/visibility/hearing requirements remain the responsibility of the initiating PF1 Item Script Call.

## v1.12.5 — Save Outcomes dispatch for all source-verified native PF1 saves

- Add one elected-GM `saveOutcomes.resolve(event)` dispatcher, invoked after final saveOverrides resolution for **every** verified native PF1 Action-card saving throw, including when no override applies (`changed:false`). No class-specific logic or extra rolls.
- Pass exact Action chat message ID, native save ChatMessage ID, source Item/Action, saving-throw type, source card DC, target Actor, and both normal/effective totals. No speculative DC recalculation.
- Reuse the existing GM socket route of `saveOverrides`; direct outcome resolution is GM-only. Preserve idempotent per-message outcome flags and separate source-specific linked effects.
- Retry briefly while the GM receives the Action ChatMessage; add diagnostics for missing source, uncorrelated rolls, unavailable services and absent numeric DC.
- Preserve Countersong, Distraction and native PF1 roll handling. No changes to Fascination Script Call.
- Simulated integration tests cover no-override failure/success, upgraded success after Countersong, source isolation, duplicate delivery and manual sheet saves. Real Foundry acceptance remains required.

## v1.12.4 — Save Outcomes PF1 ItemAction lookup and optional status fix

- Prefer the native `ItemPF.actions` Collection over legacy `system.actions` in `saveOutcomes.register()`; retain the actual `ItemAction.id` for native Action-card correlation.
- Infer `sourceActionId` only for Items with exactly one Action; still require the caller's explicit ID when multiple Actions exist.
- Accept missing or `null` `onFailure.statusId`; preserve optional official `fascinated` status and fallback to source-specific ActiveEffect when not registered by PF1.
- Add positive/negative regression tests for single/multiple Actions and status ID validation. No changes to the saving throw resolution, Countersong or Distraction pipelines.

## v1.12.3 — Generic source-bound save outcomes (experimental)

- Add `api.saveOutcomes.register/unregister/list` for exact Item+Action+target save consequences, using the *verified* native PF1 Action card's DC and `saveOverrides.effectiveTotal`.
- On failure create one minimal, source-specific, embedded ActiveEffect and attach its document to the parent `managedEffectGroups` copies ledger; group maintenance, expiration and stop manage the linked effect.
- Optional `fascinated` status is applied only if found in the active PF1 condition registry; never toggle a global status manually.
- Add elected-GM socket acknowledgements, ownership checks, persistent rule registry, per-message processing flags, persistent effect-level outcome IDs and safe replay.
- Add positive/negative simulated tests, preservation of existing native save pipeline, documentation and explicit test limitations.
- No 24-hour immunity, automatic repeat-save workflow or modifications to system PF1 files.

## v1.12.2 — Generic Distraction/illusion save-override support (candidate)

- Preserve the validated v1.12.1 native PF1 action-card save workflow.
- Add generic `pattern` and `figment` descriptors to `anyOf`/`allOf`, extracting `SpellModel.subschool` and respecting explicit illusion school `ill`; fall back to explicit Item tags where structured subschools are unavailable.
- Check sight **from the saving Actor towards the providing Actor** using the Foundry v13 polygon backend; reject blinded targets, blocked lines of sight and unavailable collision data. Self-target sight is allowed unless blind.
- Keep feet/metres conversion, dynamic actor flags, the linked `effectGroups` lifecycle and highest-result winner intact.
- No repeat-save scheduler or persistent-effect tracking.
- Requires live Foundry testing with an illusion Pattern and Figment source and multiple clients.

## v1.12.1 — Native PF1 source-reference integration hotfix (experimental)

- Restore source provenance from PF1 `rollOptions.reference` during `pf1PreActorRollSave`, using the actual originating Action ChatMessage and its `itemSource`, `actionSource`, `system.save.type` and `system.save.dc`. This no longer depends on a browser click/render hook.
- Optional reversible compatibility wrappers log `targetSavingThrowClick` or `Actions.onRollSave` and delegate **all native arguments** to the original without changing its output.
- After GM validation, update the original public Action ChatMessage with a per-target effective saving throw display. Keep the original PF1 dice roll and avoid writing private or blind totals into public flags.
- Preserve existing manual `rollWithContext`, multi-target/GM relay, source message validation, persistent save deduplication and normal unannotated sheet saves.
- Add simulated exact Captivating Song Will 16, Countersong 23, target display 23, two different targets, no override, wrapper diagnostic and F5 regressions.
- **Foundry acceptance pending:** upstream versions expose different native handler names and the live PF1 chat renderer was not available to test here.

## v1.12.0 — Native PF1 action chat-card saving throw context (experimental)

- Preserve source Actor/Item/Action and save type/DC in the native PF1 action ChatMessage through `pf1PreDisplayActionUse` and guarded message creation.
- Under Foundry v13's `renderChatMessageHTML`, observe the original save-button click in capture phase; never replace PF1 roll handlers or Actor prototypes.
- Restore the source on native `pf1PreActorRollSave`, then delegate the original `pf1ActorRollSave` to the existing elected-GM resolver.
- Cross-check the persisted source ChatMessage Item/Action/save identity on the elected GM before applying conditional Countersong.
- Record normal and effective result even when no override applies (no extra chat). Preserve native whispered/blind visibility on summary messages.
- Handle multiple targets, independent actors, F5, action IDs, socket deduplication and manual unannotated saves.
- Add `scripts/save-context.js`, `tests/native-save-context.test.cjs` and `docs/NATIVE-SAVE-CONTEXT.md`.
- **Limit:** exact PF1 11.11 button DOM compatibility and actual live workflow must be tested in Foundry before merging.

## v1.11.1 — Native PF1 supernatural/sonic save-overrides hotfix

- Resolve PF1 11.11 feat `system.abilityType: "su"` as magical; parse `system.tags` (Set), arrays, objects and strings in addition to structured spell descriptors.
- Make generic `appliesTo.anyOf` and `appliesTo.allOf` explicit. Existing `{magical:true,sonic:true,languageDependent:true}` registrations retain their OR semantics.
- `rollWithContext()` awaits elected-GM resolution, returning `normalTotal`, `effectiveTotal`, `nativeResult`, `processed` and winning source. It does not falsify native dice or retroactively alter finished PF1 actions.
- Add detailed debug logs for source traits, predicate rejection, range, hearing, current Actor flag, normal/effective totals and message-processing failures.
- Use modern Foundry v13 `ChatMessage.author` rather than deprecated `ChatMessage.user`.
- Cover exact Harpy Captivating Song (Su + Set sonic tags), Will 7 vs Countersong 10, Will 17 vs 10 and non-sonic supernatural negative control, including player↔elected GM socket reply and chat summary.
- PR remains draft pending live Foundry confirmation.

## v1.11.0 — Persistent saving throw result override infrastructure (experimental)

- Adds `api.saveOverrides`: data-only, GM-resolved, persistent rules attached to `effectGroups` and source Actor flags; never serializes JavaScript callbacks.
- Observes native PF1 `pf1PreActorRollSave(actor,rollOptions,save)` and `pf1ActorRollSave(actor,result,save)` hooks. Only **annotated** saving throws with an explicit Item origin are processed.
- Dynamic replacement value comes from an Actor flag each time, not a cached value. `higher-result` compares actual save total to all eligible replacement results, without modifying native save bonuses.
- Optional sonic / language-dependent / magical predicates from Item data, 30-ft scene range via grid measurePath, hearing/deafness and sound wall checks, and multiple sources.
- GM validates actor-owned player socket requests and actual chat message totals, deduplicates decisions with persistent message IDs, and emits `pf1aeSaveOverrideResolved` with a compact chat summary.
- Linked override rules are removed on effect-group expiration/stop, and inert when the group is missing.
- Explicit `requestRepeatSave` bridge: a GM Item script may roll a known ongoing effect; no automatic save generation against arbitrary buffs.
- Adds English `docs/SAVE-OVERRIDES.md` and `tests/save-overrides.test.cjs` to CI.
- **Limitation:** PF1's post-save hook runs after core d20 resolution. Effective totals are published to consuming scripts, not retroactively injected into PF1's already-completed outcomes. No unannotated automatic source deduction.

## v1.10.0 — Approved PF1 buff templates from Compendiums

- `api.effectGroups.approveTemplate()` accepts actor-owned ActiveEffects, actor-owned PF1 buffs, and Compendium PF1 `buff` Items.
- New approval records store template UUID, source type, diagnostic hash, and exact canonical content fingerprint. Changes to `name`, `type`, `system`, `effects`, `flags` or other relevant content invalidate approval until reapproved.
- Legacy v1.9 Actor template fingerprint-string approvals remain valid.
- `applyGroup()` resolves Compendium templates with `fromUuid()`, snapshots sanitized `toObject()` once, and creates separately tracked, natively activated PF1 embedded buff copies on each target.
- Pack identity/ownership metadata and nested embedded ActiveEffect IDs are not cloned; PF1 action and Script Call IDs are retained.
- Existing source ownership checks, player socket authorization, `extendGroup()`, `stopGroup()`, phase expirations, F5 recovery and safe rollback are preserved.
- New debug categories for approval, modified templates, source type, copies and cloning errors.
- Adds `tests/compendium-templates.test.cjs` and Compendium coverage in duration-group tests and CI. See `docs/COMPENDIUM-BUFF-TEMPLATES.md`.

## v1.9.0 — Native Pathfinder 1e actor rest hooks (experimental)

- Generic events `pf1PreActorRest` and `pf1ActorRest` can now be registered through `api.generic.register()` or approved Item discovery declarations.
- The new `scripts/rest-automation.js` bridge captures raw HP/vigor/wounds, item uses and resources synchronously before native PF1 writes, and provides post-rest snapshots and native update proposals to PF1 scripts via `event.rest`.
- Structured fields distinguish `hours >= 8`, `restoreHealth`, `restoreDailyUses`, `isFullRest` and `kind`; optional `filter.rest` predicates support precise subscriptions without baking in class rules.
- Player/secondary-GM rest notifications relay to the elected GM for ownership-gated dispatch of existing registered PF1 Item callbacks; correlation IDs, deduplication and serialized per-actor dispatch guard against duplicate triggers.
- No automatic healing, class-specific resource resets or kineticist logic in module code. Item scripts own their effects and resources.
- Added English `docs/PF1-NATIVE-REST.md`, runtime-neutral Node regression `tests/rest-hooks.test.cjs`, and CI ZIP verification.
- Native rest integration requires real-world acceptance tests before merging; v1.8.0 timers, duration handling and effect groups remain unchanged.

## v1.8.0 — Durées monde/combat
- Nouveau registre persistant `durationRegistry` et API `api.duration` pour les durées en secondes, rounds PF1 (6 s), minutes et heures.
- Échéances observant `updateWorldTime`, le Combat Tracker, les changements de rencontre et les F5 ; aucun changement de l'horloge du monde.
- Gestion des buffs natifs PF1, ActiveEffects, scripts de nettoyage PF1, effets multicibles approuvés même hors combat et prolongation sans réappliquer.
- Décompte commun en combat : `max(rounds × 6 s, delta du temps du monde)` pour éviter un double décompte d'un même intervalle.
- Compatibilité v1.7.1 : minuteurs de phase inchangés ; groupes historiques inchangés.
- Tests `duration.test.cjs` et `duration-group.test.cjs` ajoutés à la CI Windows.

# Changelog

## 1.7.1 — Échéances fixes et prolongation des groupes

- Les minuteurs de phase enregistrent désormais un `targetRound` calculé au déclenchement, qui ne change pas avec F5.
- Reconstitution et reprise des minuteurs v1.6/v1.7 encore en cours à partir du round/tour de création.
- `api.generic.extendTimer(id,{rounds:1})` : décaler une échéance existante, sans la réinitialiser (MJ responsable).
- `api.effectGroups.extendGroup({actor,key,rounds:1})` : prolonger le groupe sans réappliquer, désactiver ou recréer ses buffs. Autorisé depuis un personnage joueur sous contrôle du MJ via socket.
- Test automatisé : fin du tour du barde après rechargement en début de round, prolongation puis F5, migration des échéances existantes.



## 1.7.0 — Effets temporaires multi-bénéficiaires

- API générique `api.effectGroups` : modèles approuvés par le MJ, applications à plusieurs acteurs, gestion des copies de buffs natifs PF1 et ActiveEffects.
- Un groupe d’effets = un minuteur précis attaché au tour du lanceur (`endOfCurrentTurn`, `startOfNextTurn`, `endOfNextTurn`, `turnStart`, `turnEnd`).
- Envoi d’une demande non privilégiée par socket depuis le client joueur ; vérification de propriété et bénéficiaires par le MJ responsable.
- Nettoyage des copies marquées seulement, restauration après F5 et nettoyage de combat.
- Préservation des anciennes API `startEffect`, `stopEffect`, `schedule`, `scheduleTurn`, `expireEffectAt`.
- Tests Node : `tests/effect-groups.test.cjs`.

# Journal des modifications

## 1.6.0 — Expirations déterministes par phase de tour

- Nouveaux services `scheduleTurn`, `expireEffectAt` : fin du tour actuel, début du prochain tour, fin du prochain tour, et N-ième début/fin de tour.
- Désactivation automatique d’un Item buff PF1 ou d’un ActiveEffect, avec option explicite de suppression pour un ActiveEffect uniquement.
- Exécution isolée d’un script PF1 existant lors de l’expiration, sans utiliser la capacité.
- Persistance dans `timerRegistry`, sérialisation des écritures, déduplication des transitions et reprise des expirations dues si l’objet est temporairement indisponible.
- Compatibilité préservée de `schedule({unit: rounds|turns})`, `cancelTimer`, `register`, `unregister` et des anciennes déclarations.
- Tests de simulation de combat (incluant F5, remplacement du MJ et buffs).


## 1.5.1 — Nettoyage des automatisations spécifiques aux classes

- Suppression du script chargé `scripts/combat-hooks.js` (ancienne expiration liée à une classe).
- Suppression de la macro de démonstration spécifique `macros/enregistrer-cold-adaptation.js`.
- Retrait des exemples nommant des classes dans la documentation livrée.
- Conservation du moteur d’événements, de la découverte automatique, des minuteurs, des effets temporaires, de la migration d’ID et de toutes les API génériques.
- Aucune suppression des données `flags.world.*` écrites par les anciennes capacités : leur nettoyage relève maintenant du script de la capacité concernée.

**Attention :** les campagnes qui comptaient sur l’ancien hook de classe pour supprimer automatiquement un flag en fin de tour doivent recréer cette expiration avec un script PF1 d’objet, via le moteur générique et ses minuteurs.