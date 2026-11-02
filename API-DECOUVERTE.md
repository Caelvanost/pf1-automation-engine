# PF1 Automation Engine v1.5.1 — Déclarations automatiques

Version visée : Foundry VTT 13.351, Pathfinder 1e 11.11.

## Compatibilité

Depuis la v1.5.0, le nom, le dossier Foundry et l'identifiant technique sont **`pf1-automation-engine`**. La migration automatique copie les données de `pf1-combat-automation` lors du premier démarrage sur un monde existant. Ne pas activer les deux modules en même temps.

La v1.4.0 conserve `register`, `unregister`, `schedule`, `cancelTimer`, `listEvents`, `listTimers`, `isLeader`, `startEffect` et `stopEffect` et le fonctionnement des scripts d'objet (`scriptCategory` `use`, `postUse`/`afterUse`, `toggle`).

## Déclaration sur un objet PF1

Une capacité ou tout autre Item peut porter **plusieurs** déclarations dans :

`flags.pf1-automation-engine.automations`

Exemple générique (ne contient **aucune** logique de classe) :

```json
[
  {
    "id": "observe-resource",
    "on": "updateItem",
    "scriptCategory": "use",
    "scriptId": "Synchroniser",
    "filter": {
      "itemUuid": "Actor.XXXX.Item.YYYY",
      "properties": ["system.uses.value"]
    }
  },
  {
    "id": "sync-on-ready",
    "on": "ready",
    "scriptCategory": "use",
    "scriptId": "Synchroniser"
  }
]
```

L'Item qui contient ces flags fournit par défaut le script à exécuter : `itemUuid` est facultatif dans ses déclarations. Il est possible de le renseigner pour désigner un autre Item. La forme des filtres et des événements est exactement celle de `api.generic.register` ; l'ID local devient un ID unique préfixé par le UUID de l'Item déclarant.

Un script d'action reste également possible avec `actionId` à la place de `scriptCategory` et `scriptId`.

## Sécurité : approbation MJ obligatoire

Un joueur propriétaire d'une fiche peut parfois modifier les flags et les scripts qu'elle contient. Le moteur **ne donne jamais automatiquement les privilèges du MJ** à ces modifications.

1. Le MJ ajoute et examine les déclarations sur l'objet (une macro peut aider à écrire `setFlag`).
2. Le MJ **approuve explicitement** l'état des déclarations ET le contenu des scripts cibles :

```js
const mod = game.modules.get('pf1-automation-engine');
const item = canvas.tokens.controlled[0].actor.items.getName('Nom de la capacité');
await mod.api.discovery.approveItem(item.uuid);
```

3. Sur chaque événement, seul le MJ principal vérifie que les flags et les scripts correspondent toujours exactement à l'état approuvé, puis exécute le script sélectionné. Une modification des scripts ou des déclarations invalide immédiatement l'approbation. Il faut réapprouver après vérification. Une modification de ressource **sur un autre objet surveillé** ne révoque pas l'approbation.
4. Les approbations sont stockées dans un paramètre world et survivent à F5. La découverte analyse les objets du monde et les objets des acteurs, y compris les objets des acteurs synthétiques des tokens non liés accessibles dans les scènes.

La révocation est possible :

```js
await mod.api.discovery.revokeItem(item.uuid);
```

L'approbation ne constitue pas une isolation de code : le MJ reste responsable de l'audit du script approuvé. Pour conserver la compatibilité, les anciennes déclarations manuelles faites par un MJ via `register()` demeurent valides indépendamment de ce mécanisme.

## API de découverte

```js
const discovery = game.modules.get('pf1-automation-engine').api.discovery;
await discovery.scan();                   // rafraîchissement du registre en mémoire
await discovery.approveItem(item.uuid);  // approbation après vérification par MJ
await discovery.revokeItem(item.uuid);
discovery.status();                      // {enabled, approved, active}
discovery.listApproved();                // déclarations actives, copie
```

Le menu Paramètres du module propose la bascule **Découverte automatique des automatisations des objets**. Les logs détaillés restent désactivés par défaut.

Les déclarations n'ont pas besoin d'être ajoutées à `api.register()`. Après approbation, elles sont découvertes au `ready` et aux événements `createItem`, `updateItem`, `deleteItem`; elles sont restaurées automatiquement après F5.

## Exemple de macro MJ neutre

Voir `macros/declaration-automatique-generique.js` pour poser deux règles, les approuver, puis tester après F5. Adapter les deux UUID et le nom du script aux objets de votre monde.

## Validation

1. Sauvegarder le monde et l'ancienne version. Installer la 1.5.1, puis ouvrir Foundry avec **un seul MJ**.
2. Vérifier que `game.modules.get('pf1-automation-engine').api.generic` contient les méthodes existantes et que `api.discovery` est présent.
3. Poser les déclarations sur une capacité contenant un script `Synchroniser`, puis appeler `approveItem` en MJ.
4. Modifier `system.uses.value` de l'objet surveillé et confirmer **une seule** exécution du script. Un changement sur un autre objet ne doit rien déclencher.
5. F5 : le script déclaré pour `ready` doit s'exécuter, et la surveillance `updateItem` doit être restaurée.
6. Changer le script `Synchroniser` (sans utiliser l'objet) : il ne doit plus s'exécuter avant une nouvelle approbation.
7. Ouvrir une session joueur puis un second MJ : seul le MJ principal traite les événements. En cas de changement de leader, vérifier après rechargement.
8. Tester un token non lié en sélectionnant l'acteur synthétique du token. Tester également les expirations génériques et le gestionnaire d’effets temporaires.

## Limites

Ce code a été validé statiquement avec Node.js. Il n'a pas été testé dans le client Foundry réel. Les comportements sous conflits de MJ, snapshots des acteurs synthétiques de scènes non chargées et courses de mise à jour demandent un test d'intégration. L'API conserve les limitations existantes des minuteurs sur les sauts manuels d'initiative.
