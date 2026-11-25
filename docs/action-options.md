# API PF1AE — option « Ignorer le dialogue » par action (v1.44.0)

**Environnement :** Foundry v13.351, Pathfinder 1e v11.11. Cette fonctionnalité étend `scripts/item-default-action.js`, sans ajouter de second intercepteur concurrent.

## Interface

Dans la fenêtre native de configuration d'une **action** (`pf1.applications.component.ItemActionSheet`, propriété `sheet.action`), l'onglet **Utilisation** comporte une case **Ignorer le dialogue** à la fin de son contenu. L'option est décochée par défaut. Elle utilise les conventions de la fiche PF1 (`form-group`, `notes`) et est traduite en français et anglais.

Le sélecteur **Action par défaut** reste dans l'onglet **Avancé** de la fiche d'objet et ne s'affiche que si l'objet possède plus d'une action. L'ancienne case Ignore dialog de l'onglet Avancé a été retirée, sans perdre sa préférence.

Les actions individuelles se distinguent par leur **ID**, jamais par leur nom. Les flags sont stockés directement sur l'Item natif sous `flags.pf1-automation-engine.actionSkipDialog`, par exemple :

```json
{
  "actionSkipDialog": {
    "action-prepare": true,
    "action-consume": true
  }
}
```

Les actions absentes ou non configurées renvoient `false` par défaut. Les préférences sont conservées par les mécanismes habituels de duplication/import/export/compendium d'Items Foundry, dans la mesure où leurs flags et IDs d'actions sont préservés. Une action **dupliquée dans le même objet** reçoit un ID différent et ne copie pas automatiquement la préférence. Au changement de `system.actions`, un nettoyage retire les ID devenus inexistants.

## API

```js
const {actionOptions, defaultAction} =
  game.modules.get("pf1-automation-engine").api;

// Interrogation immédiate, sans mutation.
const enabled=actionOptions.getSkipDialog(item, actionId);

// Mise à jour persistante ; nécessite la permission OWNER sur l'Item ou l'Actor.
await actionOptions.setSkipDialog(item, actionId, true);
await actionOptions.setSkipDialog(item, actionId, false);

// Le module est actif et l'enveloppe native ItemPF.use est installée.
const available=actionOptions.isAvailable();

// Opérations de maintenance (également exposées pour diagnostics).
await actionOptions.migrate(item);
await actionOptions.prune(item);

// API historiques toujours prises en charge :
await defaultAction.set(item, actionId);
defaultAction.get(item);
defaultAction.getSkipDialog(item);
await defaultAction.setSkipDialog(item, true);
```

Les fonctions `getSkipDialog` renvoient un booléen. `setSkipDialog` renvoie la valeur choisie et rejette une action inexistante, un réglage non booléen, ou l'absence de permission OWNER. `migrate` et `prune` renvoient `true` si une modification a été effectuée.

### Migration

Pour les objets configurés avec `defaultActionId` et `defaultActionSkipDialog`, la lecture continue de respecter la préférence historique tant qu'elle n'a pas été migrée. La migration affecte le booléen à l'action qui était définie par défaut et retire le flag historique après sauvegarde. L'ID de l'action par défaut n'est pas modifié. La migration peut être répétée sans modifier les nouvelles préférences.

### Résolution native

- **Une seule action** : si cochée, `ItemPF.use` reçoit `skipDialog:true`.
- **Action explicitement appelée** : si cochée, `ItemPF.use({actionId})` reçoit `skipDialog:true`.
- **Plusieurs actions sans défaut** : le sélecteur PF1 est conservé. Une fois l'action choisie, le hook natif `pf1CreateActionUse` remplace uniquement l'appel à `ActionUse.createAttackDialog()` pour cette instance sélectionnée, en retournant `{}` (résultat vide valide). Le processus `ActionUse.process()`, les scripts, jets, ressources et cartes de chat restent natifs.
- **Action par défaut** : le sélecteur est contourné comme dans PF1AE 1.43.1 ; l'option par action détermine ensuite l'affichage du dialogue.
- Les **dialogues personnalisés** ouverts par les scripts d'objets ne sont pas interceptés.

Les hooks s'appuient sur les classes publiques PF1 11.11 et sur les éléments de navigation des onglets ; l'injection ne doit jamais être déplacée vers une autre section si le véritable onglet d'utilisation ne peut être identifié.

## Vérification dans Foundry

Après installation de v1.44.0, ouvrir une action de l'objet de mutagène, vérifier la case en bas d'**Utilisation**, puis cocher indépendamment « Préparer » et « Consommer ». La sélection d'action doit continuer à s'afficher ; le dialogue du script de choix de caractéristique de « Préparer » reste visible. Sur « Consommer », le buff et la carte native doivent fonctionner sans dialogue PF1. Enfin, vérifier « Se soigner » avec une action unique, ses charges et le message RP après la carte native.

Les tests automatisés simulent les comportements PF1, mais la structure exacte des onglets de l'instance locale et le comportement complet du pipeline natif doivent être validés dans Foundry.
