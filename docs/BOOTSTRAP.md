# PF1AE v1.18.0 — Bootstrap persistant des Script Calls PF1

## Fonctionnement

L'API `game.modules.get('pf1-automation-engine').api.bootstrap` propose `register`, `unregister`, `list` et `restoreAll`.

Un Item s'inscrit volontairement à l'aide de `register({actor,item,key,scriptId?})`, généralement depuis son Script Call natif **Basculer / toggle** lors de l'activation. Aucun code de Script Call n'est analysé, aucun script non inscrit n'est exécuté. L'identité durable est le triplet `(actorUuid, itemUuid, key)` enregistré dans le paramètre de monde `bootstrapRegistry` par le MJ élu. Les UUID synthétiques de forme `Scene.<id>.Token.<id>.Actor.<id>` sont conservés sans les transformer en Actors de monde.

Le service utilise l'API native **`ItemScriptCall.execute(shared,extraParams)`** ; il n'appelle pas `executeScriptCalls('toggle')`, `item.use()` ou `item.setActive()`. Ainsi aucune activation/désactivation réelle n'est simulée. La catégorie doit être `toggle`. Si un seul script toggle existe, `scriptId` peut être omis ; sinon le script cible doit s'appeler `PF1AE:bootstrap`, ou être désigné par son ID natif exact. `register()` ne rejoue pas lui-même l'activation de l'Item.

À `ready`, à la préparation du canvas et après une mise à jour du registre ou de la présence des utilisateurs, `restoreAll()` ne parcourt que les **inscriptions** persistantes. Chaque script reçoit `bootstrap` (objet), `restoring:true`, `state:null`, `event.type:'bootstrap:restore'`. Le Script Call doit explicitement différencier ce cas de l'utilisation humaine de Basculer.

Pour éviter le doublon multijoueur, un seul client exécute le bootstrap d'un acteur : premier propriétaire non-MJ connecté (ID trié), sinon le MJ élu. Le registre est persistant ; les hooks en mémoire ne le sont pas. Le retour du joueur propriétaire fait céder la place au MJ lors d'une restauration. Les données de persistance passent par le MJ élu ; le script local s'exécute avec les droits du client responsable, jamais sous privilèges MJ simplement parce que ce dernier a reçu une demande socket.

## Exemple complet : Script Call « Basculer »

Le code suivant **ne connaît aucune mécanique de capacité**. Il installe uniquement un listener de démonstration suivi. Le service retire automatiquement les hooks installés via `bootstrap.listen` lors de `unregister()`.

```javascript
// Script Call PF1 — catégorie « Basculer » (toggle).
// Utiliser ce script dans l'objet qui demande la restauration au F5.
const engine = game.modules.get('pf1-automation-engine')?.api?.bootstrap;
if (!engine) throw new Error('PF1AE bootstrap indisponible.');
const key = 'my-item-listener';

function install(scope) {
  scope.listen('pf1CreateActionUse', (actionUse) => {
    // Exemple générique. Mettre ici les vérifications propres à la capacité.
    console.debug('[Exemple] Action native observée', actionUse);
  });
}

if (typeof bootstrap !== 'undefined' && bootstrap?.restoring === true) {
  // F5/reconnexion : NE PAS basculer l'Item et NE PAS consommer de charge.
  install(bootstrap);
} else if (state === true) {
  // Activation volontaire : l'inscription persiste et appelle install()
  // sur le client responsable via la mise à jour du registre.
  await engine.register({actor,item,key});
} else if (state === false) {
  // Désactivation volontaire : suppression du registre ET des hooks suivis.
  await engine.unregister({actor,item,key});
}
```

**Important :** les variables injectées par PF1 dépendent du contexte natif du Script Call. Le `state` de « Basculer » représente l'état activé/désactivé dans les Script Calls habituels de votre installation ; vérifiez qu'il est effectivement booléen. Le bootstrap de PF1AE fournit explicitement `restoring:true` et `state:null`. Il ne faut pas appeler `Hooks.on()` directement dans le script restauré si l'on veut que `unregister()` puisse nettoyer le listener ; employer `bootstrap.listen(name,callback)` et facultativement `bootstrap.onCleanup(callback)`.

## API

```js
const api = game.modules.get('pf1-automation-engine').api.bootstrap;
await api.register({actor,item,key:'my-item-listener'});
await api.unregister({actor,item,key:'my-item-listener'});
console.table(api.list());
await api.restoreAll();
```

Les résultats d'enregistrement contiennent `registered`, `id`, `actorUuid`, `itemUuid`, `key` et facultativement `duplicate`. `unregister` retourne `unregistered`, `id` et `alreadyAbsent` le cas échéant. `restoreAll` fournit un bilan (`restored`, `skipped`, `total`). Les appels de restauration répétés ne réinstallent pas un listener actif.

## Sécurité et limites

- Chaque demande vérifie les liens UUID Actor/Item, le Script Call toggle natif et la permission OWNER de l'utilisateur. Le registre n'autorise aucune exécution de code via des données socket.
- La vérification du demandeur repose, comme plusieurs services préexistants, sur le champ `userId` du message socket Foundry. **Ce n'est pas une authentification cryptographique** : dans une table accueillant des clients réellement adversariaux, un transport authentifié est nécessaire. Ne pas considérer la simple permission OWNER côté client comme une barrière anti-triche complète.
- Les scripts s'exécutent avec les privilèges ordinaires de leur propriétaire ; aucun nouveau pouvoir d'écriture sur un PNJ n'est accordé. Le code fourni dans un Item déjà éditable par un joueur reste de la responsabilité du MJ.
- Un Item ou Actor momentanément indisponible est ignoré avec un diagnostic. Une inscription orpheline n'est pas supprimée automatiquement (un acteur synthétique peut redevenir accessible après un changement de scène) ; son propriétaire peut la désenregistrer, même si l'Item a été supprimé.
- Les hooks créés par un `Hooks.on()` non suivi appartiennent au script utilisateur et **ne peuvent pas être nettoyés par PF1AE**. Utiliser `bootstrap.listen()` pour bénéficier de la gestion de cycle de vie.
- L'élection d'un client propriétaire est recalculée lorsque la liste des utilisateurs actifs change. Des reconnects très rapprochés peuvent nécessiter une relance de `restoreAll()` ; les tests multi-clients réels restent indispensables.

## Protocole de test Foundry

1. Depuis un joueur propriétaire, activer un Item équipé du Script Call ci-dessus. Vérifier `[PF1AE][Bootstrap] Registered` et `Restored` (activer `genericDebug`).
2. Lancer une action PF1 puis vérifier une seule notification du script ; faire F5 et recommencer.
3. En console, exécuter trois fois `await game.modules.get('pf1-automation-engine').api.bootstrap.restoreAll()` : le listener ne doit pas se multiplier.
4. Désactiver l'Item, vérifier `Unregistered`, recharger F5 : aucun listener réinstallé.
5. Répéter avec un token non lié, puis un changement de scène et une reconnexion.
6. Supprimer l'Item après enregistrement ; le scan doit ignorer l'entrée sans erreur bloquante et `unregister({actor,item,key})` doit permettre de la supprimer tant que l'Actor existe.
7. Connecter un joueur propriétaire et deux MJ : un seul client exécute le Script Call. Déconnecter le joueur, vérifier la reprise du MJ puis son retrait au retour du joueur.
8. Vérifier que les Script Calls Utilisation, Après utilisation et Basculer classiques continuent de fonctionner sans modification.

Les tests Node simulent Foundry ; ils ne certifient pas les variables réelles de Basculer ni le comportement multi-client complet sur votre installation PF1 v11.11.
## v1.19.1 — Exécution de secours approuvée

Sur un acteur possédé par un joueur mais dont tous les propriétaires joueurs sont déconnectés, le MJ élu ne restaure un Script Call `toggle` que si sa version enregistrée a été approuvée explicitement dans `api.scriptApprovals`. Modifier l'Item invalide immédiatement l'empreinte ; les listeners suivis sont retirés par la restauration déclenchée sur `updateItem`. Au retour du joueur, le MJ désinstalle ses listeners et le client joueur reprend la restauration. Voir [Approbations de secours](SCRIPT-FALLBACK-APPROVALS.md).

## Mode Table de confiance — v1.20.0

**Réglage de monde** : dans la configuration du module, activer **Table de confiance — exécution automatique des scripts PF1AE**. Le mode est désactivé par défaut ; seuls les MJ peuvent modifier ce paramètre. Une alerte décrit la possibilité qu'un script édité par un joueur s'exécute avec les privilèges du MJ en son absence.

En mode de confiance, une capacité peut simplement contenir un Script Call natif de catégorie **Basculer** (`toggle`), nommé **exactement `PF1AE:bootstrap`**. Le moteur le trouve automatiquement et installe ses listeners au chargement, sans `api.bootstrap.register()`, sans clic sur la capacité et sans consommer de charge. Exemple minimal de **contenu complet du Script Call Basculer** :

```javascript
if (typeof bootstrap !== 'undefined' && bootstrap?.restoring === true) {
  bootstrap.listen('pf1PostActionUse', (actionUse, message) => {
    // Vérifier ici les identités Actor/Item/Action avant toute conséquence.
    // Ne pas déclencher de jet, de dégâts ou de dépense de ressource sans
    // contrôle propre à la capacité.
  });
}
```

Le moteur fournit `bootstrap`, `restoring:true`, `state:null` et `event.type='bootstrap:restore'` à `ItemScriptCall.execute({action:null}, extraParams)`. Il n'appelle jamais `item.use()`, `item.setActive()` ou `executeScriptCalls('toggle')` pour initialiser une capacité.

Le client élu est le premier propriétaire joueur connecté, ou sinon le premier MJ connecté (tri stable des identifiants). Plusieurs capacités et différents acteurs ont des abonnements indépendants. Un acteur de token non lié est découvert lorsque son token/actor est accessible. Les inscriptions manuelles existantes restent dans `bootstrapRegistry` et ne sont pas effacées en changeant de mode.

La découverte complète est réalisée au démarrage et aux changements de scène/présence ; les événements ciblés `createItem`, `updateItem`, `deleteItem` et ceux des acteurs/tokens évitent des scans du monde à chaque modification. Les listeners `bootstrap.listen()` sont remplacés si le script natif change ou si le client élu change. Les hooks déclarés via `Hooks.on()` directement ne sont pas suivis, donc ne peuvent pas être nettoyés.

Diagnostic optionnel : `game.modules.get('pf1-automation-engine').api.bootstrap.listAutomatic()` liste les bootstraps découverts **sur le client courant**. Cette liste n'est pas persistée ; `list()` expose seulement les inscriptions manuelles sécurisées.

Le mode sécurisé ne découvre rien automatiquement et conserve l'ancien régime des approbations individuelles. Les scripts `PF1AE:damage:*` et `PF1AE:attack:resolved` gardent leurs vérifications de provenance et de non-duplication, que le mode soit actif ou non.
