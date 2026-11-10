# PF1 Automation Engine v1.5.1 — Appels de script d'objet

## Structure réelle PF1 11.11

Les appels sont stockés sur l'objet dans `item.system.scriptCalls` et exposés sous forme de modèles `ItemScriptCall` dans `item.scriptCalls`. Chaque entrée comprend `_id`, `name`, `category`, `type` et `value`. Les catégories vérifiées sont `use` (Utiliser), `postUse` (Après utilisation) et `toggle` (Basculer). L'alias `afterUse` est accepté par l'API puis normalisé en `postUse`. Le moteur appelle **uniquement** `ItemScriptCall.execute(shared, extraParams)` pour conserver la sémantique d'exécution PF1. Il n'appelle ni `item.use()` ni `item.executeScriptCalls()`. Il n'active pas automatiquement de cartes, attaques ou coûts, mais les *effets explicitement programmés dans le script* restent exécutés.

## API

```js
const api = game.modules.get('pf1-automation-engine').api.generic;
await api.register({
  id: 'my-watch', on: 'updateItem',
  itemUuid: 'Actor.XXX.Item.YYY', // objet qui contient le script
  scriptCategory: 'use',
  scriptId: 'Synchroniser', // nom exact ou, de préférence, ID PF1 _id
  filter: {itemUuid:'Actor.XXX.Item.ZZZ', properties:['system.uses.value']}
});
await api.register({
  id: 'my-ready', on: 'ready', itemUuid:'Actor.XXX.Item.YYY',
  scriptCategory:'use', scriptId:'Synchroniser'
});
```

Une action préexistante reste valide via `{itemUuid,actionId}`. Ne fournissez **pas** simultanément `actionId` et `scriptId`. Pour les minuteurs, `api.schedule({id,itemUuid,scriptCategory,scriptId,unit:'rounds',amount:1})` fonctionne de la même manière (combat actif requis). Les fonctions `unregister(id)`, `cancelTimer(id)`, `listEvents()`, `listTimers()`, `isLeader()` sont conservées. Enregistrement réservé au MJ principal.

Les variables du script d'objet utilisent le mécanisme natif PF1 : `actor`, `item`, `token`, `shared`, `action`, ainsi que `event`, `state` et `api` ajoutés par le moteur. `state` vaut `active`, `inactive` ou `null` suivant l'événement. Pour `ready`, `event.type === 'ready'`.

## Installation et validation

1. Sauvegarder le monde. Installer le module dans `Data/modules/pf1-automation-engine`, avec `module.json` à la racine, puis redémarrer Foundry v13.351 avec PF1 11.11.
2. Vérifier que l’API est disponible : `game.modules.get('pf1-automation-engine').api.generic`.
3. Dans un objet PF1 de test, créer un appel de script nommé `Synchroniser` sous « Avancé → Appel de script → Utiliser ». Ce script peut simplement écrire un message dans la console ; il ne doit pas lancer de jets ni modifier de ressources pour ce premier test.
4. Enregistrer avec `api.register()` un déclencheur `updateItem` surveillant `system.uses.value` d’un autre objet, ainsi qu’un déclencheur `ready`, tous deux ciblant le script du premier objet.
5. Modifier la propriété surveillée : vérifier qu’un seul appel `Synchroniser` survient, sans utilisation de l’objet. Vérifier qu’une propriété non surveillée ne déclenche rien.
6. Recharger F5 : vérifier que `ready` déclenche le script et que les deux enregistrements persistent dans `api.listEvents()`.
7. Connecter un joueur puis un second MJ. Vérifier qu’un seul MJ responsable exécute les scripts ; observer la console F12 en cas d’erreur.
8. Vérifier qu’un script modifiant un document ne provoque pas de boucle de mises à jour.

La macro d’exemple `macros/declaration-automatique-generique.js` illustre l’enregistrement déclaratif avec approbation MJ.

## Limites

Les sources PF1 11.11 confirment la méthode `ItemScriptCall.execute`, mais l'intégration complète avec votre monde doit être testée en situation. Les documents manquants ne sont pas supprimés du registre ; un avertissement est émis. Les écritures de script sont exécutées dans les privilèges du MJ : n'enregistrez que des scripts de capacités approuvés. Le contrôle ne constitue pas un sandbox contre un script dangereux déjà écrit par le MJ.

Attention : `ready` ne rejoue pas rétroactivement une déclaration créée pendant la session ; faites F5. Pour un acteur avec plusieurs tokens non liés, sélectionnez son token exact lors de l'enregistrement.

## Abonnement automatique à une attaque native (v1.17.0)

Un Item peut contenir un appel de script **Après utilisation** (`postUse`) nommé exactement `PF1AE:attack:resolved`. Cet appel est exécuté après chaque jet individuel confirmé par `pf1AttackRoll` puis `pf1PostActionUse` d'un autre Item du même acteur. L'Item abonné n'a pas à être utilisé. La variable `event` contient le jet et la provenance, avec `hit:null` (touche inconnue). Voir [la documentation complète](docs/ATTACK-EVENTS.md).

## Restauration persistante des listeners (v1.18.0)

Voir [docs/BOOTSTRAP.md](docs/BOOTSTRAP.md) pour l’API `api.bootstrap`, le contexte natif `ItemScriptCall.execute(...,{bootstrap,restoring,event,state:null})`, la restauration opt-in après F5 et `bootstrap.listen()` pour nettoyer les hooks lors de la désactivation de l’Item.