# PF1AE `api.proximityAuras` — Foundry VTT 13.351 / PF1 11.11

Service **générique** : aucune règle de classe/archétype, aucune dépendance à Little Helper ou à un autre gestionnaire d'auras. Les déclarations sont persistées sous les flags de **l'objet source** et le MJ élu synchronise les buffs natifs de PF1 sur les bénéficiaires, ainsi que des **AmbientLight** indépendantes du token (l'éclairage du token n'est jamais remplacé).

## API publique

```js
const auras=game.modules.get("pf1-automation-engine")?.api?.proximityAuras;
const result=await auras.register({
  key:"unique-stable-per-source",
  emitterActorUuid:actor.uuid,
  emitterTokenUuid:token.document.uuid,
  sourceItemUuid:item.uuid,
  beneficiaries:{kind:"allies",excludeEmitter:true},
  range:{kind:"adjacent"}, // ou {kind:"radius",distance:10}
  defense:{bonusType:"shield",value:4},
  duration:{rounds:5},
  light:{bright:20,dim:40}, // facultatif, valeurs dans les unités de scène
  label:"Protection divine" // facultatif
});
console.log(result.created); // true si première création ; false si doublon

await auras.stop({sourceItemUuid:item.uuid,key:"unique-stable-per-source"});
auras.list({sourceItemUuid:item.uuid});
await auras.reconcile(); // diagnostic / remise en cohérence MJ
```

Les longueurs `range.distance`, `light.bright` et `light.dim` sont exprimées dans les **unités natives de la scène**, sans conversion cachée. Pour Bouclier saint, les scripts d'exemple convertissent les mètres en pieds quand la scène utilise `ft`.

### Sémantique et sécurité

- Les acteurs ciblés doivent être des **tokens amicaux** (`disposition === 1`), dans la scène du token émetteur. Le champ `excludeEmitter` exclut **tous les tokens du même acteur** lorsqu'il est vrai.
- `adjacent` = distance d'au plus **une case**, avec distance positive et cases réellement occupées ; `radius` = distance native inférieure ou égale au rayon. Utilisation de `getOccupiedGridSpaceOffsets`, `grid.getCenterPoint` et `grid.measurePath` Foundry v13 ; aucune moyenne des centres pour les grands tokens. En scène sans grille, repli vers une mesure native des centres.
- Les bonus sont des **buffs PF1 natifs** : `system.changes` avec `target:"ac"`, `modifier` typé et `subTarget:"sac"` pour les boucliers. PF1 gère le non-cumul de type `shield` et les défenses normale / prise au dépourvu. Les totaux dérivés de CA ne sont jamais directement modifiés.
- `register` est autorisé au **MJ** ou au **propriétaire** de l'objet source appartenant à l'émetteur. La déclaration persistée déclenche le recalcul côté MJ. Les bénéficiaires non propriétaires n'ont pas à recevoir de scripts.
- Même paire `(sourceItemUuid,key)` = **une seule aura** ; une seconde déclaration identique ne réinitialise ni sa durée ni ses ressources. Le résultat `created` vaut `false` sur un doublon : le Script Call de la capacité ne doit débiter ses ressources que si `created === true`. `stop` retire cette aura sans toucher aux autres.
- Pendant un combat, la durée est mesurée au **même compte d'initiative** après N rounds ; hors combat, N × 6 secondes de `game.time.worldTime`. Les déplacements ne prolongent rien. Le MJ vérifie aussi les expirations lors des mises à jour de tour, de temps, de token, de scène et au rechargement.
- Les lumières sont des **documents AmbientLight séparés** créés avec le flag `proximityAuraSource` ; leur position suit l'émetteur et seules les lumières identifiées comme appartenant au service sont supprimées. Les lumières natives des tokens et des autres modules restent inchangées.
- Les buffs et lumières portent un identifiant propriétaire et sont réconciliés par le seul MJ élu, sans duplication. Les sources de vérité restent des **flags d'Item natifs**, pas une mémoire du client.
- Les événements de fin sont persistés en outbox. Le MJ **réserve un événement avant exécution** (au plus une publication). Le hook `pf1aeProximityAuraExpired` reçoit `{type,eventId,key,reason,sourceItemUuid,emitterActorUuid,emitterTokenUuid,record}` où `reason` vaut `duration`, `manual` ou `emitterMissing`.

### Script Call natif à la fin

Créer sur l'**objet source**, en catégorie **Après utilisation** (`postUse`), un Script Call avec pour **nom exact** :

`PF1AE:aura:expired`

Ce Script Call reçoit une variable `event` et peut publier son propre message RP. Le moteur ne crée **aucun message**. En mode d'approbation stricte, faire approuver ce script au MJ ; le mode *Trusted Table* reconnaît son nom exact. La livraison est au plus une fois même après F5, déconnexion du lanceur ou changement de MJ.

## Bouclier saint — configuration de l'objet

Référence : *L'Art de la guerre*, p. 60, archétype **Bouclier béni**.

Créer une capacité native de paladin avec une **action simple**, sans coût de charge automatique (ni sur cette action, ni liée automatiquement à Imposition des mains). Les deux utilisations sont vérifiées avant action et débitées **une seule fois** dans le script *Après utilisation*, seulement si la déclaration de l'aura a effectivement créé une nouvelle instance ; un doublon ne coûte aucune charge supplémentaire. Équiper un bouclier `equipmentType:"shield"` avec ses valeurs réelles de protection. Les prérequis, la valeur et les portées sont propres aux scripts de l'objet, **pas** au moteur générique.

Trois scripts complets et séparés (prêts à copier-coller) :

1. **Utilisation** : [`examples/holy-shield-use.js`](../examples/holy-shield-use.js) — vérifie prérequis et ressources avant la résolution.
2. **Après utilisation** : [`examples/holy-shield-post-use.js`](../examples/holy-shield-post-use.js) — consomme 2 utilisations d'Imposition des mains, déclare l'aura, puis publie le RP après la carte native.
3. **Après utilisation**, **nom de Script Call exact** `PF1AE:aura:expired` : [`examples/holy-shield-expired.js`](../examples/holy-shield-expired.js) — publie le RP de disparition après l'expiration réglementaire.

| Niveaux | Portée | Lumière | Durée |
| --- | --- | --- | --- |
| 4–10 | Adjacent | *Lumière* (6 m vive, 6 m faible supplémentaires) | 3 + bonus CHA rounds |
| 11–19 | 3 m | *Lumière du jour* (18 m vive, 18 m faible supplémentaires) | idem |
| 20 | 6 m | *Lumière du jour* | idem |

Le bonus transmis est le **bonus de bouclier** équipé **avec son altération**. PF1AE ne crée aucun nouveau type de bonus artificiel ni de règle de paladin.

### Limites à vérifier en situation réelle

- Le système PF1 11.11 doit effectivement agréger le changement de buff `sac/shield` avec celui de l'équipement. Les tests de ce dépôt confirment la **structure** native créée et l'absence de somme manuelle, mais un contrôle en combat sur les CA dérivées du système reste nécessaire.
- Pour la compatibilité aux scènes hors grille, les distances entre centres sont utilisées, sans tenter de simuler des cases inexistantes.
- Les objets ayant des champs non standards pour le bonus d'armure de bouclier ou les charges doivent être mis en conformité avec les structures PF1 de l'exemple ; le script échoue explicitement s'il ne peut pas établir le bonus ou les charges.
