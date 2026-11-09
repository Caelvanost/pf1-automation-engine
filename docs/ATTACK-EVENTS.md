# PF1AE v1.17.0 — Abonnements déclaratifs aux attaques

## Hooks PF1 v11.11 vérifiés

PF1 expose `pf1AttackRoll(action, roll, context)` après l'évaluation **individuelle** d'un jet d'attaque et `pf1PostActionUse(actionUse, chatMessage)` après l'utilisation d'une Action et la publication éventuelle de sa carte. Le pont écoute les deux hooks une seule fois et traite les jets à la fin de l'Action native. Aucun nouveau système de jet ou de carte n'est créé.

**`attack:resolved` signifie « jet évalué et utilisation terminée », pas « attaque touchée ».** PF1 ne garantit pas au hook le résultat d'une comparaison à la CA. Ainsi `event.hit` vaut toujours `null` et `attack:hit` n'est pas émis.

## Déclaration automatique dans un Item

Dans l'Item qui doit réagir aux attaques de son propriétaire, créer un **Appel de script** natif PF1, catégorie **Après utilisation** (`postUse`), avec le nom exact :

```text
PF1AE:attack:resolved
```

L'objet n'a pas besoin d'être utilisé. PF1AE découvre l'abonnement en parcourant les Items de l'acteur attaquant. L'abonnement survit à F5, aux changements de scène et à la reconnexion car il repose sur un Script Call natif enregistré dans l'Item. Renommer ou supprimer cet appel le désactive immédiatement. Si plusieurs appels d'un même Item portent ce nom, le module ignore cet Item au lieu de produire un doublon.

## Script Call générique complet, prêt à copier-coller

Coller le code suivant dans **Après utilisation**, sous le nom `PF1AE:attack:resolved`.

```javascript
// Réagit aux jets d'attaque du personnage sans activer manuellement cet Item.
if (typeof event !== "undefined" && event?.type === "attack:resolved") {
  const api = game.modules.get("pf1-automation-engine")?.api;
  if (!api?.attackEvents) throw new Error("PF1AE Attack Events indisponible.");

  console.log("[Objet réactif] Jet natif", {
    attaquant: event.actorUuid,
    arme: event.itemUuid,
    action: event.actionId,
    indice: event.rollIndex,
    resultat: event.roll.total,
    cible: event.targets[0]?.actorUuid ?? null,
    touche: event.hit
  });

  // Ici, aucune attaque ou dégât n'est lancé automatiquement :
  // event.hit vaut null car PF1 ne confirme pas la touche via ce hook.
  // Après une vérification fiable propre à la capacité, on peut
  // employer l'action native déjà configurée sur cet Item :
  //
  // const authorized = false; // À remplacer par les règles de la capacité
  // const damageAction = [...item.actions.values()].find(a => a.name === "Dégâts");
  // if (authorized && damageAction) {
  //   await item.use({ actionId: damageAction.id, cost: 0, chatMessage: true });
  // }
}
```

L'appel natif `item.use({actionId, cost:0, chatMessage:true})` s'appuie sur le traitement de PF1 v11.11 et produit sa carte habituelle. N'utiliser `cost:0` que si aucune dépense supplémentaire ne doit avoir lieu.

## Contexte `event`

| Champ | Contenu |
|---|---|
| `type` | `attack:resolved` |
| `actorUuid` | UUID de l'Actor attaquant, y compris Actor synthétique `Scene...Token...Actor...` |
| `itemUuid`, `actionId` | Item et Action de l'attaque |
| `attackerTokenUuid` | UUID si l'attaquant possède un seul token actif, sinon `null` |
| `sourceMessageId` | Identifiant de la carte native, si fournie à `pf1PostActionUse` |
| `rollIndex` | Index des jets **observés** dans cette utilisation (0, 1, …) |
| `attackIndex` | Indice explicitement fourni par le hook, sinon `null`, non déduit de `rollIndex` |
| `roll` | `{id,total,formula}` ; informations disponibles uniquement |
| `targets` | Tokens / Actors transmis explicitement par le contexte ou l'Action ; tableau éventuellement vide |
| `hit` | **Toujours `null`**, aucune touche inventée |
| `isAutoTriggered` | `false` (réservé pour évolution future) |

Les cibles d'une utilisation à plusieurs frappes ne sont pas nécessairement liées à chaque frappe individuelle. Le script doit vérifier lui-même l'identité de sa cible. Aucun ciblage ne provient artificiellement du dernier token sélectionné par le MJ.

## Multijoueur, permissions et anti-récursion

- Les hooks de jet PF1 sont pris sur le **client qui effectue le jet**. Un client ne traite que les attaques de son propre Actor (`OWNER` ou MJ). Le système ne transfère **aucun script exécutable** par socket.
- Une seule installation des hooks PF1 par client, pas une installation par Item ou par Script Call. Une instance `Roll` est traitée une seule fois sur ce client.
- Les appels d'un acteur sont exécutés en série. Les jets générés pendant l'exécution d'un script réactif sont ignorés pour éviter les boucles.
- Les jets d'une utilisation interrompue ne sont pas délivrés ; les enregistrements transitoires expirent après 120 s.
- Il n'y a **pas d'exécution centralisée par MJ élu** dans cette version, car le hook de jet est local. Les scripts fonctionnent avec les permissions natives du lanceur. Pour modifier un ennemi, conserver la chaîne autoritaire `attackOutcomes` → `saveOutcomes`.
- Le hook ne confirme pas une touche. Il faut donc conserver l'arbitrage du MJ ou utiliser une preuve native de dégâts appliqués vérifiée séparément. Le module ne lance jamais de dégâts automatiquement.

## Protocole Foundry v13 / PF1 v11.11

Tester successivement : attaque simple, attaque à outrance (une notification par jet), attaque d'opportunité par une Action native, Action annulée, acteur non lié, F5/reconnexion et changement de scène, deux clients joueurs + MJ, abonnement dupliqué et action lancée par le Script Call. Pour chaque essai, vérifier le nombre d'appels et les UUIDs, puis confirmer que `hit` reste `null` si la réussite contre la CA n'est pas disponible. Les tests Node simulent ces hooks ; ils ne remplacent pas le test réel des cartes PF1.
