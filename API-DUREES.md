# PF1 Automation Engine v1.8.0 — Durées dans le temps du monde et en combat

**Compatibilité ciblée** : Foundry VTT v13.351 ; Pathfinder 1e 11.11. Aucune règle de classe n'est codée dans le module. **1 round PF1 = 6 secondes.**

## Responsabilités distinctes

- **Seasons & Stars** (ou Foundry) reste le propriétaire de `game.time.worldTime` et de ses commandes d'avancement, pause et reprise. PF1 Automation Engine ne déclenche aucune pause, reprise, ou modification de l'heure du monde.
- **Durations v1.8.0** observe les changements via `updateWorldTime`, `updateCombat`, `combatTurnChange`, `deleteCombat` et `ready`. Les échéances sont stockées dans `pf1-automation-engine.durationRegistry` (paramètre de monde) et exécutées uniquement par le MJ élu.
- Les anciens minuteurs **de phase de tour** (`scheduleTurn`, `endOfNextTurn`, etc.) restent dans `timerRegistry` et conservent leur comportement. Aucun minuteur existant n'est converti silencieusement.

## Nouvelle API (`api.duration`)

```js
const mod=game.modules.get('pf1-automation-engine');
const duration=mod.api.duration;
console.log(duration.secondsPerRound); // 6

// MJ responsable : expiration d'un buff natif PF1 ou d'un ActiveEffect.
await duration.schedule({
  id:`temp:${buff.uuid}`,
  effectUuid:buff.uuid,
  duration:{value:3,unit:'rounds'} // 18 secondes hors combat
});

// ActiveEffect : désactiver (défaut) ou supprimer à échéance.
await duration.schedule({
  id:`poison:${effect.uuid}`,
  effectUuid:effect.uuid,
  effectAction:'delete',
  duration:{value:5,unit:'minutes'}
});

// Appeler seulement un script PF1 « Expiration » sans item.use().
await duration.schedule({
  id:`expire-script:${capacite.uuid}`,
  itemUuid:capacite.uuid,
  scriptCategory:'use',
  scriptId:'Expiration',
  duration:{value:30,unit:'seconds'}
});

// Prolonger / annuler / diagnostiquer : MJ responsable uniquement.
await duration.extendTimer(`temp:${buff.uuid}`,{duration:{value:1,unit:'rounds'}});
await duration.cancelTimer(`temp:${buff.uuid}`);
console.table(duration.listTimers());
await duration.reconcile();
```

Unités prises en charge : `seconds`, `rounds` (6 s), `minutes` (60 s), `hours` (3 600 s). La durée est un entier positif et ne peut dépasser 365 jours.

## Buffs multicibles hors combat (script PF1 du lanceur)

Comme auparavant, le **MJ responsable approuve d'abord** le modèle de buff/ActiveEffect présent sur le lanceur (`api.effectGroups.approveTemplate(template.uuid)`). L'approbation est invalidée lorsque le modèle change. L'API existante gère les requêtes joueurs avec validation d'ownership et des cibles alliées.

```js
const mod=game.modules.get('pf1-automation-engine');
const result=await mod.api.effectGroups.applyGroup({
  actor,
  key:'bonus-provisoire',
  templateUuid:template.uuid,
  targets:[actor,...allies],
  duration:{value:3,unit:'rounds'}
});
// Trois rounds = 18 secondes hors combat, puis durée de combat si une
// rencontre démarre avant l'expiration.
```

Pour prolonger de 1 round **sans interrompre le buff** :

```js
await mod.api.effectGroups.extendGroup({actor,key:'bonus-provisoire',rounds:1});
```

⚠️ Si tu utilises `timing:'endOfNextTurn'`, tu demandes **une échéance de tour précise**, qui nécessite toujours un combat. Si tu utilises `duration:{value:1,unit:'rounds'}`, tu demandes **six secondes de durée**, qui fonctionne aussi hors combat. N'envoie pas `timing` et `duration` ensemble.

Les répliques de buffs de groupe basées sur une `duration` ne sont pas retirées lorsque la rencontre est supprimée : le temps restant repasse à l'horloge du monde. Les buffs des groupes historiques basés sur `timing` restent liés au combat, conformément à leur fonctionnement antérieur.

## Passage combat ↔ exploration

Un minuteur de durée suit un seul chronomètre logique :

1. **Hors combat** : le nombre de secondes écoulées est la progression positive de `game.time.worldTime`. Les changements de date de Seasons & Stars sont donc pris en compte sans appeler son API privée.
2. **Pendant le combat** : chaque round supplémentaire vaut 6 secondes. Le moteur utilise `max(rounds*6, progression du worldTime pendant le combat)` pour ne jamais déduire deux fois le temps qui s'est écoulé simultanément dans Foundry et dans le Combat Tracker.
3. **Après le combat** : le solde restant reprend à l'heure du monde courante, même si la rencontre est terminée ou supprimée. La suppression d'un combat n'entraîne pas la suppression de l'effet.
4. **Après F5** : les points de départ (horloge/rounds) sont stockés dans `durationRegistry`. Au `ready`, le MJ responsable recalcule les échéances et tente les nettoyages échus.

Les changements d'heure *en arrière* n'accordent pas de durée supplémentaire. Une avance manuelle de 10 minutes peut expirer immédiatement un effet de 2 minutes : aucune mise à jour seconde par seconde n'est nécessaire.

### Limites à connaître

- La durée commence au moment où l'API est appelée. En combat, elle est comptée sur les **changements de rounds complets** ; elle ne remplace pas une expiration à la fin d'un *tour précis*. Pour cette dernière, utiliser `scheduleTurn()`.
- Les buffs PF1 possédant déjà une durée ou des scripts natifs ne sont **pas enrôlés automatiquement**. La capacité PF1 (ou le MJ) doit appeler `api.duration.schedule()` ou `applyGroup({duration:...})` ; cela évite les conflits avec les automatisations natives de PF1.
- Si une autre extension augmente rétroactivement l'heure du monde **après** la clôture du combat pour les mêmes secondes déjà comptées, cette mise à jour tardive est indistinguable d'une nouvelle avance manuelle. Tester le flux exact de Seasons & Stars utilisé sur la table. Le moteur n'ajoute jamais lui-même ces secondes.
- Si le MJ responsable est déconnecté pendant le combat puis qu'un autre compte reprend, les échéances sont récupérées à partir des rounds enregistrés. Les transitions où le document Combat a entièrement disparu avant que le nouveau MJ puisse le lire ne permettent pas de reconstituer les rounds manquants avec certitude.
- Les clients joueurs **ne peuvent pas écrire directement** les minuteurs de durée. Pour une capacité joueur multicible, utiliser `effectGroups.applyGroup({duration})`, dont la demande est validée côté MJ. `submitted:true` confirme l'envoi, pas l'application effective.
- Les minuteurs sont persistés dans des settings `world`, qui n'offrent pas de verrou distribué transactionnel. L'élection du MJ évite les doubles traitements dans les cas ordinaires, mais les bascules simultanées extrêmes restent à tester.

## Contrôles rapides dans Foundry

```js
const mod=game.modules.get('pf1-automation-engine');
console.log({version:mod.version,leader:mod.api.generic.isLeader(),
  worldTime:game.time.worldTime,combats:[...game.combats].filter(c=>c.started).length});
console.table(mod.api.duration.listTimers());
console.table(mod.api.effectGroups.listGroups());
```

### Plan de validation v1.8.0

1. Hors combat, programmer un effet pour `3 rounds` ; avancer l'horloge de 17 secondes puis 1 seconde. Il reste actif jusqu'à la 18e seconde.
2. Programmer un effet pour `2 minutes`, avancer l'heure de 3 minutes avec Seasons & Stars : expiration une fois.
3. Programmer un groupe de buffs PF1 sur 2 alliés **hors combat** ; vérifier les bonus, prolonger de 1 round puis supprimer à l'échéance.
4. Programmer une durée de 4 rounds hors combat ; avancer de 6 s, commencer un combat, jouer deux rounds, terminer le combat et avancer le reste : expiration une fois au bon moment.
5. Faire F5 en combat, puis tester à deux MJ (déconnexion/reconnexion du MJ responsable).
6. Vérifier que les délais `endOfNextTurn` de la v1.7.1, Cold Adaptation et Burn restent inchangés.
7. Vérifier qu'aucune commande de temps ou de pause de Seasons & Stars n'est envoyée par le module.
