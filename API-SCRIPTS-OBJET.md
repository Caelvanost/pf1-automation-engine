# PF1 Combat Automation v1.3.0 — Appels de script d'objet

## Structure réelle PF1 11.11

Les appels sont stockés sur l'objet dans `item.system.scriptCalls` et exposés sous forme de modèles `ItemScriptCall` dans `item.scriptCalls`. Chaque entrée comprend `_id`, `name`, `category`, `type` et `value`. Les catégories vérifiées sont `use` (Utiliser), `postUse` (Après utilisation) et `toggle` (Basculer). L'alias `afterUse` est accepté par l'API puis normalisé en `postUse`. Le moteur appelle **uniquement** `ItemScriptCall.execute(shared, extraParams)` pour conserver la sémantique d'exécution PF1. Il n'appelle ni `item.use()` ni `item.executeScriptCalls()`. Il n'active pas automatiquement de cartes, attaques ou coûts, mais les *effets explicitement programmés dans le script* restent exécutés.

## API

```js
const api = game.modules.get('pf1-combat-automation').api.generic;
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

1. Faites une sauvegarde du dossier du module 1.2.0 et des données du monde. Remplacez le dossier et redémarrez Foundry v13.351 avec PF1 11.11.
2. Vérifiez la version 1.3.0 dans la gestion des modules. Vérifiez que la surveillance Gather Power et le gestionnaire d'effets existants continuent à fonctionner.
3. Dans Cold Adaptation > Avancé > Appel de script > Utiliser, vérifiez la présence d'une unique entrée `Synchroniser`. Sélectionnez le token, puis exécutez en MJ la macro `macros/enregistrer-cold-adaptation.js` (copiez son contenu dans une macro Script).
4. Modifiez `system.uses.value` sur l'objet Burn. Le script `Synchroniser` doit être appelé une fois sans activer Cold Adaptation comme capacité.
5. Rechargez F5 sur le MJ : `Synchroniser` doit se relancer lors de `ready`, et les deux entrées doivent rester dans `api.listEvents()`.
6. Connectez un joueur et un second MJ simultanément. Une seule exécution doit se produire sous le MJ principal (ID le plus petit parmi les MJ actifs). Vérifiez les logs en activant les diagnostics du module ; déconnectez/reconnectez le MJ principal puis rechargez l'autre client.
7. Vérifiez qu'une mise à jour effectuée par le script lui-même ne crée pas de boucle. Pour diagnostiquer, consultez la console F12.

## Limites

Les sources PF1 11.11 confirment la méthode `ItemScriptCall.execute`, mais l'intégration complète avec votre monde doit être testée en situation. Les documents manquants ne sont pas supprimés du registre ; un avertissement est émis. Les écritures de script sont exécutées dans les privilèges du MJ : n'enregistrez que des scripts de capacités approuvés. Le contrôle ne constitue pas un sandbox contre un script dangereux déjà écrit par le MJ.

Attention : `ready` ne rejoue pas rétroactivement une déclaration créée pendant la session ; faites F5. Pour un acteur avec plusieurs tokens non liés, sélectionnez son token exact lors de l'enregistrement.
