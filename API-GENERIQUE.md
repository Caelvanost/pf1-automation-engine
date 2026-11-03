# API générique — PF1 Automation Engine 1.6.0

Compatible Foundry VTT 13 / Pathfinder 1. Aucun traitement propre à une classe dans `generic-automation.js`.

## Installation

Décompresser `pf1-automation-engine` dans `Data/modules/`, redémarrer Foundry, activer le module.
Le gestionnaire générique d’effets temporaires `effect-manager.js` reste disponible avec ses API existantes. L’ancien hook de classe `combat-hooks.js` a été retiré à partir de la version 1.5.1 : les expirations propres à une capacité doivent être déclarées dans ses scripts PF1.

Dans Configuration des modules, les options de monde **Activer les automatisations génériques** et **Logs de diagnostic** sont disponibles.

## API

```js
const api = game.modules.get('pf1-automation-engine')?.api?.generic;
```

Toutes les opérations d'écriture de déclarations (`register`, `unregister`, `schedule`, `scheduleTurn`, `expireEffectAt`, `extendTimer`, `extendTimer`, `cancelTimer`) sont **réservées au MJ principal actif**. C'est volontaire : un script persisté est exécuté avec les permissions de ce MJ. Aucun script ne peut être fourni en clair dans une déclaration. Les scripts exécutés doivent exister sur un Item PF1 et être approuvés par le MJ : scripts d’action (`actionId`) ou appels de script natifs (`scriptCategory`, `scriptId`). 

- `await api.register({ id, on, itemUuid, actionId, actorUuid?, filter? })` : ajoute ou remplace une surveillance persistante.
- `await api.unregister(id)` : supprime une surveillance.
- `await api.schedule({id,itemUuid,actionId,actorUuid?,combatId?,combatantId?,unit:'rounds'|'turns',amount})` : ajoute/remplace une expiration persistante.
- `await api.scheduleTurn({id,timing,combatantId,...})` : cible le début/fin exact d’un tour avec un script PF1 ou un effet direct.
- `await api.expireEffectAt({id,effectUuid,timing,combatantId,...})` : désactive un buff PF1 ou un ActiveEffect à un moment précis.
- `await api.cancelTimer(id)` : annule l'expiration.
- `api.listEvents()` et `api.listTimers()` : listes en lecture seule (copies).
- `api.isLeader()` : booléen.

`on` accepte `updateActor`, `updateItem`, `createItem`, `deleteItem`, `createActiveEffect`, `updateActiveEffect`, `deleteActiveEffect`, `ready`, `combatTurnChange`.

`filter` accepte `actorUuid`, `documentUuid`, `itemUuid`, `tag`, `properties` (tableau de chemins, recherche de préfixe), `buffState` (`active` / `inactive`). Les tags sont les chaînes du flag `flags.pf1-automation-engine.tags` sur le document à surveiller. Pour les buffs PF1 représentés par ActiveEffect, surveiller `createActiveEffect`, `updateActiveEffect` et `deleteActiveEffect`. Si un buff PF1 est représenté par un Item, utiliser `updateItem` et un filtre sur sa propriété d'activation.

Pour exécuter un appel de script natif de l’objet, indiquer `scriptCategory` (`use`, `postUse` / `afterUse` ou `toggle`) et `scriptId` au lieu de `actionId`. Voir `API-SCRIPTS-OBJET.md`.

Les scripts d'actions doivent être accessibles à partir des entrées de `item.system.actions` et de leur `id`, `_id` ou `name`. Le moteur cherche le texte dans `action.script.command`, `action.script.code`, `action.script`, `action.command`, puis `action.data.script.command`. **La structure interne des actions varie selon la version du système PF1 : vérifier dans la console la structure de l'action réelle avant de déclarer.** Le module signale explicitement les scripts introuvables au lieu de les inventer.

Le code s'exécute avec les variables de contexte : `actor`, `item`, `event`, `api`, `token`, `game`, `canvas`, `ui`, `ChatMessage`, `foundry`. `event` fournit les champs sérialisables `type`, `actorUuid`, `itemUuid`, `documentUuid`, `changedPaths`, `buffState`, `round`, `combatId`, `combatantId`. L'événement `expiry` est transmis pour une expiration. Le moteur ne lance **pas** l'action PF1 (jets, dépenses de ressources, etc.) : il exécute uniquement son script associé.

## Exemples de déclarations (à exécuter depuis une macro MJ)

### Synchronisation d'une capacité passive

Créer dans l'Item de capacité une action script `Synchroniser` et y placer le recalcul voulu. Exécuter une fois par le MJ :

```js
const api = game.modules.get('pf1-automation-engine').api.generic;
const capacite = game.actors.getName('PERSONNAGE').items.getName('CAPACITÉ');
await api.register({
  id: `passif:${capacite.uuid}`,
  on: 'updateActor',
  itemUuid: capacite.uuid,
  actionId: 'Synchroniser',
  filter: {actorUuid: capacite.actor.uuid, properties:['system.resources']}
});
await api.register({
  id: `passif-ready:${capacite.uuid}`,
  on: 'ready',
  itemUuid: capacite.uuid,
  actionId: 'Synchroniser'
});
```

`ready` s'exécute à chaque chargement du monde par le MJ principal. L'activation du module en cours de session nécessite une reconnexion pour provoquer le prochain `ready`.

### Expiration d'un effet

Dans une macro MJ (ou par une commande de mise en place approuvée par le MJ) :

```js
await api.schedule({
  id:'effet-temporaire:identifiant-unique',
  itemUuid: capacite.uuid,
  actionId:'Expiration',
  actorUuid:capacite.actor.uuid,
  unit:'rounds',
  amount:1,
  combatId:game.combat.id,
  combatantId:game.combat.combatant.id
});
```

Le script d'action `Expiration` doit restaurer lui-même l'état voulu. Le moteur ne connaît pas les valeurs de statistiques ou de ressources.

`rounds` compte les changements de numéro de round et `turns` compte les fins de tour **du combattant choisi**. Le compteur est conservé dans les paramètres du monde après F5. Cela ne correspond pas à une horloge temps réel et requiert des tours avancés normalement. Lors de modifications manuelles du Combat Tracker, les sauts, tours supprimés, changements d'initiative et retours en arrière peuvent demander une correction manuelle : inspecter `listTimers()`.

## Cas de validation génériques

**Synchronisation** : placer une entrée `Synchroniser` dans les appels de scripts PF1 de l’objet. Surveiller une propriété d’un autre objet via `updateItem`, et déclarer `ready` pour resynchroniser au chargement. Le comportement métier appartient au script de l’objet.

**Expiration** : un script `Expiration` enregistré sur un Item peut être ciblé par un minuteur `schedule({unit:'rounds',amount:1,...})`. Il restaure lui-même l’état voulu ; le moteur ne calcule aucune règle de capacité.

## Sécurité, limites et diagnostic

- Un MJ principal (plus petit ID parmi les MJ actifs) écrit les registres et exécute les scripts. L'accès en tant que joueur aux écritures des registres n'est pas implémenté dans cette version : le MJ doit enregistrer les abonnements et minuteurs. Cela évite toute exécution arbitraire de scripts de joueurs avec les permissions MJ.
- Les registres sont stockés dans les paramètres **world** de Foundry, pas dans le navigateur ; ils sont persistants après reconnexion et changement de scène. Les `Actor.uuid` et `Item.uuid` permettent de cibler les acteurs de tokens liés **ou non liés** si leur document existe encore.
- Un même abonnement ne peut pas réentrer dans son propre script pendant son exécution. Les événements produits par des **abonnements différents** peuvent toutefois se déclencher mutuellement : écrire des scripts idempotents, et passer `{ 'pf1-automation-engine': {skip:true} }` comme options de `update()` lorsque les changements doivent être ignorés par ce moteur.
- Le gestionnaire de scripts ne peut pas garantir l'absence de toute double écriture sous déconnexions/réconnexions simultanées de MJ : les paramètres world ne sont pas transactionnels. En cas de changement de MJ principal au milieu d'une exécution, surveiller les logs.
- Le moteur ne modifie pas les calculs des capacités et ne garantit pas qu'une action PF1 préexistante expose son script dans un des champs pris en charge ; voir diagnostic navigateur.
- Les logs détaillés sont désactivés par défaut. Les erreurs de script restent affichées dans la console.

### Expirations précises (v1.6.0)

Consulter [API-EXPIRATIONS.md](API-EXPIRATIONS.md) pour les cinq timings, les exemples de scripts PF1, les buffs, les ActiveEffects, les garanties et les limites de sécurité.

## Groupes d’effets multi-cibles (v1.7.0)

Voir [API-EFFETS-GROUPES.md](API-EFFETS-GROUPES.md) pour l’approbation MJ des modèles, l’application sécurisée depuis une capacité PF1 et le nettoyage automatique à une échéance de tour via `api.effectGroups.applyGroup()` et `stopGroup()`.

### Extension de minuteur (v1.7.1)

`await api.extendTimer(timerId,{rounds:1})` décale une échéance de phase existante d'un round. Cet appel est **réservé au MJ responsable** ; dans un script de PJ, préférer la requête autorisée `game.modules.get('pf1-automation-engine').api.effectGroups.extendGroup({actor,key,rounds:1})`. Ni les copies d'effets ni la liste des bénéficiaires ne sont modifiées.
