# PF1 Automation Engine v1.6.0 — Expirations au début et à la fin des tours

**Compatibilité :** Foundry VTT v13.351 · Pathfinder 1e 11.11. Cette API ne contient aucune règle de classe. Les effets, leur durée et les éventuels calculs de capacité sont déterminés par la fiche PF1 ou par le MJ, jamais par le moteur.

## Principe

Dans Foundry v13, le hook `combatTurnChange(combat, prior, current)` se produit **après** l'enregistrement du nouveau tour. Le moteur utilise `prior.combatantId` pour repérer la fin du tour précédent et `current.combatantId` pour repérer le début du suivant. L'expiration intervient lors de ce passage de tour, et non quelques secondes avant.

Les minuteurs sont persistés dans `game.settings` (scope *world*, clé `pf1-automation-engine.timerRegistry`). Ils survivent au rechargement F5, suivent le **combattant par ID** (même si l'initiative est réordonnée) et ne sont exécutés que par le MJ élu. Les écritures de ce registre sont sérialisées côté MJ. Une deuxième annonce du même passage de tour ne doit pas provoquer un deuxième déclenchement.

## API publique

```js
const api = game.modules.get('pf1-automation-engine').api.generic;

await api.scheduleTurn({ ... });       // script PF1 OU effet direct
await api.expireEffectAt({ ... });     // raccourci pour un effet direct
await api.cancelTimer('identifiant'); // compatible avec les anciens minuteurs
console.table(api.listTimers());     // anciens minuteurs + expirations de phase
```

`api.schedule()` et toutes les fonctions des versions précédentes restent disponibles. **Les fonctions qui écrivent les minuteurs sont réservées au MJ principal actif.** Un script exécuté directement par un joueur ne peut pas appeler cette API d'écriture dans la v1.6.0 ; prévoir une intervention MJ ou un flux de déclaration approuvé avant de généraliser aux actions des joueurs.

## Moments pris en charge

| `timing` | Moment précis | Condition |
| --- | --- | --- |
| `endOfCurrentTurn` | Lorsqu'on quitte **le tour en cours** du combattant choisi | Le combattant doit être actif au moment de l'enregistrement |
| `startOfNextTurn` | Lorsque ce combattant **commence son prochain tour** | Fonctionne qu'il ait déjà joué ou non ce round |
| `endOfNextTurn` | Lorsque ce combattant **termine son prochain tour**, pas la fin du tour actuellement en cours | Si le combattant est déjà actif, ignore sa fin de tour actuelle |
| `turnStart` | Au début de sa N-ième prochaine prise de tour | `occurrences: N` (1 par défaut) |
| `turnEnd` | À sa N-ième prochaine fin de tour | `occurrences: N` (1 par défaut) |

Utiliser `combatantId` plutôt qu'un index de tour. Les événements `turnStart`/`turnEnd` sont comptés à partir des transitions observées **après** l'enregistrement ; il n'y a pas de déclenchement rétroactif.

## 1. Expirer un buff PF1 sans exécuter de script utilisateur

Exemple neutre de macro MJ, avec un token sélectionné et un combat actif :

```js
const api = game.modules.get('pf1-automation-engine').api.generic;
const actor = canvas.tokens.controlled[0]?.actor;
if (!actor) throw Error('Sélectionner un token.');

const combattant = game.combat?.combatants.find(c => c.actor?.uuid === actor.uuid);
if (!combattant) throw Error('Acteur absent du combat en cours.');

const buff = [...actor.items].find(i => i.type === 'buff' && i.system?.active);
if (!buff) throw Error('Aucun buff PF1 actif pour ce test.');

await api.expireEffectAt({
  id: `expire:${buff.uuid}`,  // stable : remplace le minuteur précédent de même ID
  effectUuid: buff.uuid,      // UUID du buff PF1 (Item, type buff)
  combatId: game.combat.id,
  combatantId: combattant.id,
  timing: 'startOfNextTurn',
  effectAction: 'disable'     // par défaut ; un buff PF1 n'est jamais supprimé
});
```

Le moteur désactive un buff PF1 par `ItemBuffPF.setActive(false)` lorsque cette méthode existe ; à défaut, il met `system.active` à `false`. Ce changement peut produire les hooks et appels de scripts « Basculer » **natifs** de PF1. Il ne lance pas l'action « Utiliser » du buff et n'ajoute aucune règle de classe.

## 2. Expirer un ActiveEffect Foundry

```js
await api.expireEffectAt({
  id: `fin:${effect.uuid}`,
  effectUuid: effect.uuid, // ActiveEffect intégré à un acteur
  combatId: game.combat.id,
  combatantId: combattant.id,
  timing: 'endOfCurrentTurn',
  effectAction: 'disable' // ou 'delete' pour supprimer cet ActiveEffect
});
```

**Sécurité :** `effectAction: 'delete'` est refusé pour les Items de type buff afin de ne pas supprimer la capacité elle-même. Les effets de modèle ou de compendium sans acteur propriétaire sont refusés.

## 3. Lancer uniquement le script PF1 `Expiration`

Le script doit déjà exister dans **Avancé → Appel de script** sur l'objet PF1 ; il porte seul la logique qui doit nettoyer les flags et effets de sa capacité.

```js
await api.scheduleTurn({
  id: `fin-script:${capacite.uuid}`,
  itemUuid: capacite.uuid,
  scriptCategory: 'use',
  scriptId: 'Expiration',     // de préférence ID interne du script
  combatId: game.combat.id,
  combatantId: combattant.id,
  timing: 'endOfNextTurn'
});
```

Le moteur appelle **uniquement** cet `ItemScriptCall.execute(...)`, sans `item.use()`, jet de dés, dépense de charges, ou carte dans le chat générés par une utilisation normale. Le script peut récupérer `event.type === 'expiry'`, `event.phase` (`turnStart` / `turnEnd`) et `event.timing`.

Il reste possible de cibler une action PF1 ancienne en remplaçant `scriptCategory` et `scriptId` par `actionId`.

## Persistance et garanties

- `scheduleTurn()` et `expireEffectAt()` insèrent ou remplacent un minuteur portant le même `id` ; `cancelTimer(id)` l'annule.
- Les minuteurs inscrits dans `timerRegistry` sont rechargés au `ready`. Le compteur n'est pas diminué par un simple F5.
- Le MJ responsable est élu comme auparavant ; chaque expiration est retirée du registre **avant** l'écriture ou l'appel du script pour éviter une double exécution. Si un script provoque ensuite une erreur, le minuteur n'est pas relancé automatiquement : vérifier la console.
- Si l'objet ou l'acteur cible **n'est plus résoluble au moment prévu**, le minuteur reste marqué `due: true`. Il sera réessayé au prochain passage de tour ou au prochain `ready`. Ne pas supprimer manuellement un minuteur `due` sauf si sa cible a définitivement disparu.
- Le contexte d'écriture `{ 'pf1-automation-engine': {skip:true} }` empêche une boucle de surveillances générée par les écritures directes d'expiration, sans empêcher les hooks natifs du système PF1.
- Les minuteurs associés à un combat supprimé sont annulés, sans modifier automatiquement les effets survivants. Pour un combat terminé prématurément, prévoir une résolution hors combat.
- Les **sauts manuels** de plusieurs tours, les allers-retours dans l'ordre d'initiative, et les modifications d'initiative hors `combatTurnChange` ne sont pas tous interprétables : le moteur n'invente pas de tours manquants. Les retours en arrière ne déclenchent pas d'expirations.
- Les `game.settings` de Foundry ne constituent pas un verrou transactionnel distribué. La version a été testée avec des simulateurs Node ; tester une vraie table avec deux MJ avant de considérer les transitions de responsabilité comme garanties.

## Vérifications dans le monde

1. Copier le ZIP dans `Data/modules/pf1-automation-engine/`, après sauvegarde du monde, puis redémarrer Foundry.
2. Connecter un seul MJ, sélectionner un token avec un buff actif et un combat démarré ; enregistrer une expiration `endOfCurrentTurn` et faire avancer le Combat Tracker d'un tour. Le buff doit être désactivé **une fois**.
3. Réactiver un buff et enregistrer `startOfNextTurn` ; vérifier qu'il reste actif à la fin du tour en cours et se désactive quand ce combattant rejoue.
4. Vérifier `endOfNextTurn` et un script PF1 `Expiration` qui écrit dans la console ; il ne doit pas être exécuté à la fin du tour actuel.
5. Enregistrer un minuteur, faire F5, puis avancer l'initiative : le minuteur doit survivre et expirer au moment prévu.
6. Connecter un joueur et un assistant MJ, puis refaire la transition. Une seule écriture d'effet doit être observée. Vérifier aussi une déconnexion du MJ élu suivie de la relève par l'autre MJ.
7. Tester avec un token non lié (acteur synthétique), puis contrôler `api.listTimers()` et la console (`genericDebug: true`).

## Expirations de groupes (v1.7.0)

Le service `api.effectGroups` construit un unique minuteur de phase pour un groupe de copies multi-bénéficiaires. Le champ interne `effectGroupId` est réservé aux minuteries créées/validées par ce service côté MJ. Pour activer ce service depuis une capacité PF1, utiliser `api.effectGroups.applyGroup()` plutôt que programmer manuellement une expiration par cible. Voir [API-EFFETS-GROUPES.md](API-EFFETS-GROUPES.md).
