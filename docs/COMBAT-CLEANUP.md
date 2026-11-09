# Cycle de vie des effets temporaires — PF1AE 1.16.3

Environnement : Foundry VTT 13 / PF1 11.11.

## Pourquoi ce correctif ?

`effectCreateTimedOutcome` crée un `ActiveEffect` indépendant pour les conditions temporaires (par exemple `stunned`) et programme son échéance via `api.generic.scheduleTurn({effectUuid,effectAction:'delete',combatId,combatantId,...})`. Avant 1.16.3, le hook `deleteCombat` supprimait directement le minuteur du registre `timerRegistry` sans retirer l'effet. Le hook séparé d'`effectGroups` nettoyait uniquement les effets des groupes.

## Suppression et arrêt d'un combat

Seul le MJ élu traite les minuteurs du `combatId` concerné :

1. **Minuteur de script** : annulation sans évaluation ni exécution de capacité.
2. **Minuteur de groupe** : `effectGroups.expireGroup({fromTimer:true})`, avec désactivation et suppression des copies strictement reconnues.
3. **Minuteur d'effet indépendant** : résolution de `effectUuid`, vérification de l'acteur propriétaire, puis correspondance stricte des marqueurs `timerId`, `outcomeId`, `outcomeRuleId`, `sourceUuid`, `sourceItemUuid`, `sourceActionId`, `key` et `origin`.
4. **Cible indisponible** ou erreur de suppression : minuteur conservé avec `cleanupPending:true`, réessayé après reconnexion, au chargement ou lors de `canvasReady`.

Les combats **arrêtés sans suppression** sont également traités via `updateCombat` lorsque `combat.started` devient faux. Les minuteurs du registre `durationRegistry` en secondes de jeu restent indépendants : une fin de combat ne les raccourcit pas.

## Nettoyage des anciennes conditions orphelines

Une v1.16.2 pouvait supprimer un minuteur de combat sans supprimer son `ActiveEffect`. Lors du chargement et du retour sur une scène, le MJ élu recherche les conditions historiques parmi les acteurs du monde et les acteurs synthétiques accessibles. Pour retirer un effet, **toutes** les conditions sont nécessaires : marqueurs PF1AE complets, `origin` correspondant à l'Item source, absence du minuteur dans les registres de phase et de durée, ancienneté du document d'au moins 30 secondes.

Si un acteur est inaccessible, si `_stats.createdTime` est absent ou si les flags sont incomplets, le module ne supprime rien automatiquement. Ces cas demandent une vérification MJ plutôt qu'une suppression arbitraire.

## Diagnostics et validation

Activer `genericDebug`. Rechercher notamment `Condition indépendante nettoyée lors de la fin de combat`, `Minuteur de script annulé sans exécution`, `Nettoyage de combat terminé`, `Ancienne condition orpheline nettoyée`, et les avertissements relatifs aux nettoyages différés.

Dans Foundry, tester les situations suivantes : Étourdi sur un combattant jusqu'à son prochain tour, combat supprimé avant son tour, combat arrêté sans suppression, token non lié, changement de scène, F5, seconde source différente, état permanent, durée de 60 secondes d'un effet dynamique, buffs `effectGroups`, minuteur de Script Call et deux MJ connectés. Les tests Node simulent Foundry et n'établissent pas à eux seuls un comportement réel en partie.

Aucune API publique de `attackOutcomes`, `saveOutcomes`, `dynamicEffect`, `templateEffect` ou `effectGroups` n'est modifiée.
