# PF1AE — Saignement (Bleed), première version : PV

**Compatibilité cible :** Foundry VTT 13.351, Pathfinder 1e 11.11, PF1 Automation Engine 1.31.0.

Ce service constitue un moteur **générique**, sans règle codée pour une classe, un archétype ou un don. Le comportement de **Scarification du Balafré enragé** est fourni uniquement sous forme d'un Script Call complet, à placer sur l'objet du personnage.

## Règles PF1 retenues

Au début de chacun des tours d'une victime, les saignements actifs infligent le montant indiqué. Pour des effets de même nature, seul le pire s'applique ; les effets de types différents ne sont pas traités dans cette version. La formule de chaque Buff HP est évaluée une fois **à chaque tour**, puis la valeur obtenue la plus élevée est appliquée. Les maxima théoriques des dés ne sont donc jamais utilisés artificiellement pour comparer des effets aléatoires.

**Portée de cette version :** `type: "hp"` et `stacking: "highest"` uniquement. Les variantes `str/dex/con/int/wis/cha`, `abilityDamage`, `abilityDrain`, `stacking:"sum"` et `stacking:"independent"` sont explicitement refusées. Le simple état `bleed` sans Buff configuré n'inflige pas de dégâts automatiques ; il faut associer un Buff natif marqué.

## Buff PF1 et métadonnées

Sur un acteur, créer un **objet de type Buff** intitulé, par exemple, « Saignement — 1d4 », puis **l'activer** sur la fiche.

Le Buff doit contenir :

```js
flags["pf1-automation-engine"].bleed = {
  enabled: true,
  type: "hp",
  formula: "1d4",
  stacking: "highest"
};
```

La méthode de configuration évite l'édition manuelle des flags. Après avoir créé le Buff sur la fiche et obtenu sa référence, le MJ peut lancer la commande complète suivante dans sa console :

```js
const actor = game.actors.getName("Croûte");
if (!actor) throw Error("Acteur Croûte introuvable");

const buff = actor.items.find(i =>
  i.type === "buff" && i.name === "Saignement — 1d4"
);
if (!buff) throw Error("Buff Saignement — 1d4 introuvable");

const api = game.modules
  .get("pf1-automation-engine")?.api?.bleed;
if (!api) throw Error("API Bleed indisponible");

await api.configure({
  effect: buff,
  type: "hp",
  formula: "1d4",
  stacking: "highest"
});

console.log("Buff configuré", api.get(buff));
console.log("Tous les saignements actifs", api.list(actor));
```

D'autres objets peuvent aussi appeler `api.bleed.configure({effect,formula:"3"})` ; le service exige que l'objet soit un Buff PF1 déjà intégré à un acteur. **La méthode configure() ne l'active pas**, ne règle pas sa durée et n'applique pas ses dégâts.

**Éligibilité :** le Buff est ignoré si `activeState===false` ou `system.active===false`. L'expiration d'un Buff peut être gérée normalement par sa durée PF1 ou par `api.duration`. Le moteur Bleed ne crée pas de temporisateur parallèle et ne retire pas un Buff simplement après lui avoir infligé des dégâts.

## Exécution, autorité et déduplication

Sur chaque `updateCombat` modifiant le round ou le tour, **le MJ élu** exécute le pipeline suivant, avec verrouillage sériel :

1. Lire le combattant courant (y compris son acteur synthétique si token non lié).
2. Relever tous les Buffs HP actifs marqués.
3. Réserver une entrée persistante `pending` dans le réglage mondial `bleedTurnReceipts` avec `[combatId,combatantId,round]` **avant** tout jet ou effet.
4. Tirer une fois chaque formule avec `Roll.evaluate()` et retenir la valeur la plus élevée.
5. Exécuter les Script Calls approuvés de catégorie `postUse`, nom exact `PF1AE:bleed:before`, avec une API contrôlée `event.reduce(n)` / `event.negate()`.
6. Vérifier que le Buff est toujours actif, que le MJ conserve l'autorité, puis appeler `await actor.applyDamage(montant)`. Le moteur n'écrit jamais directement dans les PV : le système PF1 gère les PV temporaires et ses variantes de dégâts.
7. Consigner le reçu `applied`, puis émettre l'événement informatif `pf1aeBleedApplied` et les Script Calls `PF1AE:bleed:applied`.

Une même entrée `[combatId,combatantId,round]` n'est jamais retraitée après F5, reconnexion, double `updateCombat`, replay socket, bascule de MJ ou retour en arrière dans le Combat Tracker.

### Échec et récupération

Un échec inattendu peut survenir **après** qu'un acteur a été partiellement modifié. Pour prévenir des dégâts répétés, le reçu reste `pending` : le moteur ne tente pas de nouvelle application automatiquement. Le MJ doit consulter le reçu et les PV avant toute intervention manuelle. L'API `receipts()` permet l'audit sans modifier les reçus :

```js
console.table(
  game.modules.get("pf1-automation-engine").api.bleed.receipts()
);
```

Aucune fonction automatique de relance ou suppression de reçu n'est exposée, volontairement. Le moteur conserve au plus les **5000 reçus les plus récents** ; des campagnes très longues peuvent nécessiter une politique de conservation plus élaborée.

### Permissions des Script Calls

Les noms natifs reconnus sont :

- **Après Utilisation :** `PF1AE:bleed:before` (modification avant dégâts).
- **Après Utilisation :** `PF1AE:bleed:applied` (notification après dégâts).

Pour un acteur possédé par un joueur, le MJ élu n'exécute un de ces Script Calls **que si** le service existant `scriptApprovals.check(actor,item,call)` l'approuve avec correspondance exacte du contenu sauvegardé. Le mode Table de confiance ne leur accorde pas d'exception implicite ; il ne faut jamais l'activer pour contourner une approbation. Les effets proprement dits proviennent seulement du Buff, jamais d'un texte JavaScript fourni par socket ou flag client.

`event.reduce(n)` et `event.negate()` ne peuvent être appelés qu'une seule fois par Script Call. Les réductions sont bornées à 0 et aucun ajustement positif ou montant négatif n'est accepté. Les notifications `bleed:applied` sont immuables et ne permettent aucune modification de dégâts.

## Exemple complet : Scarification (Ext) du Balafré enragé

**Objet :** `Scarification`, sur Croûte.

**Catégorie : Après Utilisation. Nom exact : `PF1AE:bleed:before`.**

Le script s'appuie sur les **objets de classe réels** de l'acteur (type PF1 `class`). Les champs `system.levels` / `system.level` sont lus sur l'objet ; le script ne déduit jamais le niveau d'après le niveau total. Il cherche le nom « Barbare » ou « Barbarian » et accepte aussi un tag explicite `barbarian` ; **si la fiche utilise un autre nom ou si la classe est ambiguë, il refuse silencieusement la réduction et logue un avertissement** plutôt que de supposer un niveau.

```js
if (
  typeof event !== "undefined" &&
  event?.type === "bleed:before" &&
  event?.bleedType === "hp"
) {
  const owner = typeof actor !== "undefined"
    ? actor
    : (typeof item !== "undefined" ? item?.actor : null);

  if (!owner || event.actorUuid !== owner.uuid) {
    console.warn("[Scarification] Wrong actor context");
  } else {
    const classes = [...owner.items].filter(i => i.type === "class");
    const barbarian = classes.filter(i => {
      const names = [
        i.name,
        i.system?.tag,
        i.system?.identifier
      ].filter(v => typeof v === "string");
      return names.some(v => /^(barbare|barbarian)$/i.test(v.trim()));
    });

    if (barbarian.length !== 1) {
      console.warn(
        "[Scarification] Barbarian class not uniquely identified",
        classes.map(i => ({
          name: i.name,
          levels: i.system?.levels,
          tag: i.system?.tag
        }))
      );
    } else {
      const raw = barbarian[0].system?.levels
        ?? barbarian[0].system?.level;

      const level = Number(raw);

      if (!Number.isInteger(level) || level < 1) {
        console.warn("[Scarification] Invalid Barbarian level", raw);
      } else if (level >= 15) {
        // L'API sélectionne par défaut le seul effet HP dominant.
        // Avec des effets distincts non cumulables, il n'y a donc
        // qu'un effet HP à ignorer dans cet événement de tour.
        event.negate();
      } else if (level >= 3) {
        const ignored = 1 + Math.floor((level - 3) / 3);
        event.reduce(ignored);
      }
    }
  }
}
```

**Rappel :** l'annulation complète d'un effet par round au niveau 15 ne constitue **pas** une annulation de tous les saignements de types différents : l'API v1.29.0 ne traite que les saignements HP. Si les types indépendants deviennent disponibles, il faudra adapter le script pour mémoriser son choix d'un seul effet par round.

Le Script Call doit être approuvé par le MJ via le service PF1AE `scriptApprovals.approve`, puisque le moteur fait exécuter ce code sur le MJ élu lorsque la victime appartient à un joueur. Une modification du script nécessite une nouvelle approbation.

## Tests Foundry réels — checklist

- [ ] Installer la version v1.29.0 et confirmer `game.modules.get("pf1-automation-engine").api.bleed`.
- [ ] Créer et activer un Buff « Saignement — 3 » sur un personnage ; configurer `formula:"3"`.
- [ ] Commencer un combat ; avancer le tracker au **début** du tour de cet acteur et vérifier exactement 3 PV de dégâts via l'API native.
- [ ] Refaire avec `formula:"1d4"` ; vérifier un nouveau jet au prochain tour.
- [ ] Activer simultanément un Buff « Saignement — 2 » et un « Saignement — 4 » : seul le plus fort de ces deux montants doit s'appliquer.
- [ ] Tester sur deux acteurs, puis sur un token **non lié**.
- [ ] Activer Scarification sur Croûte, créer et approuver le Script Call `PF1AE:bleed:before`.
- [ ] Vérifier les réductions attendues aux niveaux 3, 6, 9, 12 et 15, sans modifier le script.
- [ ] Tester Bleed sans Buff, puis avec Buff désactivé et Buff expiré : aucun dégât.
- [ ] Tester PV temporaires et, si utilisée, la variante Vigueur/Blessures.
- [ ] Avancer le tracker, le reculer puis le remettre au même tour : aucun second dégât.
- [ ] F5 du MJ, reconnexion et second MJ connecté : une seule application par round.
- [ ] Modifier le code de Scarification sans le réapprouver : le moteur doit **ignorer** ce Script Call.
- [ ] Vérifier l'événement `pf1aeBleedApplied` avec montants d'origine, empêchés, appliqués et les PV avant/après.
- [ ] Activer temporairement les logs `genericDebug` pour examiner la sélection du plus haut effet et le reçu `pending/applied`.

Ce protocole reste nécessaire : les tests Node ne prouvent pas à eux seuls la compatibilité avec toutes les variantes de fiches et de combats PF1 11.11.

## Interface automatique : condition native Bleed (v1.30.0)

En activant manuellement la condition native PF1 `bleed` depuis sa fiche/token,
**le client ayant lancé cette modification** affiche la fenêtre `🩸 Saignement`.
On entre une valeur ou formule (par défaut `1`, par exemple `3`,
`1d4`, `1d6+2`, `2d6+1`), puis on choisit **Appliquer** ou **Annuler**.

- La formule est contrôlée syntaxiquement avec `Roll.validate()` **sans jet**.
- **Appliquer** : crée/réutilise un Buff PF1 `Saignement — formule` portant
  `flags["pf1-automation-engine"].manualBleed.generated === true`.
  Il est configuré par `api.bleed.configure()`, puis activé avec l'API PF1.
- **Annuler** ou fermer : aucun Buff créé ; retour de la condition native à
  `false` sans ouverture d'une autre fenêtre.
- **Retrait manuel** de la condition : désactive seulement le Buff identifié
  `manualBleed.generated`. Les Buffs de saignement d'attaques, sorts ou autres
  capacités ne sont jamais supprimés par cette interface.
- Une seule fenêtre est ouverte pour l'utilisateur **auteur de l'opération**.
  PF1 v11.11 expose `pf1ToggleActorCondition(actor,condition,state)` sans
  `userId`, ce qui impose de le corréler aux hooks de mise à jour d'Actor
  fournis par Foundry. Une modification distante ou un F5 ne doit pas ouvrir
  de fenêtre.
- Un Buff provenant d'une autre capacité ne doit pas être confondu avec
  le Buff manuel. Celui-ci est la source des dégâts ; la condition native
  n'est que sa représentation visuelle.

**Limite de détection :** PF1 ne fournit pas dans son hook de condition
l'intention explicite « utilisateur a cliqué dans l'interface ». Une
macro externe qui active la condition en utilisant exactement le même chemin
natif et les mêmes options non marquées qu'un clic manuel peut également
être considérée comme une action locale. Les automatisations internes de
PF1AE évitent la récursion. Pour garantir une exclusion explicite lors
d'intégrations tierces, les appels de mise à jour d'Actor peuvent utiliser
l'option `{ "pf1-automation-engine": { skipManualBleed: true } }` lorsque
le mécanisme PF1 la transmet.

En cas d'échec pendant la création du Buff, le moteur essaie de retirer
le Buff nouvellement créé et de désactiver la condition native. Un Buff
existant marqué `manualBleed` est réutilisé ; aucun Buff étranger ne
peut être modifié.

### Table de confiance

En activant **volontairement** `trustedTableMode`, les Script Calls
`postUse` officiels `PF1AE:bleed:before` et
`PF1AE:bleed:applied` figurent désormais dans `SA_AUTO_NAMES`.
Lorsque ce réglage est désactivé, une approbation exacte par le MJ
reste obligatoire.

### Vérification en jeu de la fenêtre

1. Sur un acteur lié possédé par le MJ, activer la condition native `bleed`.
2. Vérifier **une seule** fenêtre `🩸 Saignement`, valeur préremplie `1`.
3. Entrer `3`, valider : Buff PF1 `Saignement — 3`, actif et marqué
   `manualBleed.generated`.
4. Retirer la condition : seul ce Buff doit être désactivé.
5. Refaire avec `1d4` puis `2d6+1` ; aucune formule ne doit être lancée
   lors de sa validation. Le moteur v1.29 réalise les jets au début des tours.
6. Tester une formule invalide ; la fenêtre réapparaît avec un message d'erreur.
7. Annuler ; condition désactivée, aucun nouveau Buff créé.
8. Tester un personnage joueur propriétaire et un token non lié.
9. Connecter deux MJ et un joueur : seul l'auteur de l'activation voit la fenêtre.
10. Vérifier F5, reconnexion, et réactivation rapide : pas de fenêtre à la
    synchronisation et pas de boucle de désactivation.
11. Ajouter un autre Buff Bleed de sort et retirer la condition manuelle :
    le Buff de sort reste actif.
12. Tester `PF1AE:bleed:before` et `PF1AE:bleed:applied` avec le mode Table
    de confiance activé puis désactivé et les approbations exactes.


## Diagnostic début de tour (v1.30.1)

À partir de la v1.30.1, le moteur se connecte également au hook Foundry 13
`combatTurnChange`, déclenché **après** le changement de tour, avec relecture
de l'acteur courant et protection contre les doubles exécutions par le reçu
persistant `[combatId,combatantId,round]`. `updateCombat` est conservé.

Sur le client **MJ élu**, après avoir sélectionné un combattant dans
le Combat Tracker, exécuter :

```js
const api = game.modules.get("pf1-automation-engine")?.api?.bleed;
console.log("Bleed diagnostic", api?.diagnostic(game.combat));
console.table(api?.diagnostic(game.combat)?.buffs ?? []);
```

Le champ `status` distingue notamment le module désactivé, un mauvais
MJ, un combat non démarré, une absence de Buff éligible, ou un reçu
`pending/applied` déjà présent. **Ne pas relancer un reçu pending**
automatiquement : il peut correspondre à une application de dégâts
partiellement achevée. Une fiche ayant uniquement la condition native Bleed
sans Buff configuré ne subit pas de dégâts automatiques.

`activeState` est la source native PF1 d'activation du Buff : un
`system.active` ancien ou incohérent ne doit pas désactiver le
moteur malgré un `activeState=true`.

Après mise à jour, avancer **sur un nouveau round** pour tester un Buff
existant : les reçus des tours déjà résolus ne sont pas supprimés
ni rejoués.

## Affichage : une seule icône Bleed avec la valeur (v1.31.0)

Lorsqu'un Buff créé automatiquement par la fenêtre Bleed est actif,
il conserve toutes ses règles mécaniques et ses métadonnées :
`flags["pf1-automation-engine"].manualBleed.generated === true`.
Mais PF1AE lui applique désormais le réglage **natif PF1**
`system.hideFromToken: true` (« Hide from token »).

Ainsi, le token affiche uniquement **l'icône de condition native Bleed**,
avec la **formule** (`1`, `1d4`, `2d6+1`, etc.) superposée
grâce à un texte PIXI local, sans créer d'autre état. La valeur
correspond à la formule enregistrée, **pas au résultat du dernier tour**.
Le comportement de dégâts reste entièrement celui de `api.bleed`.

Les Buffs plus anciens ayant `manualBleed.generated: true` sont corrigés
automatiquement au démarrage du MJ, y compris pour les acteurs de tokens
non liés. Les autres Buffs de capacités et de sorts ne sont pas modifiés.

**Limite :** l'étiquette s'affiche sur l'icône du token lorsqu'elle peut être
identifiée sans ambiguïté dans les sprites des effets de Foundry v13. Elle
ne remplace pas les contrôles de condition du HUD ou les badges de modules
tiers. Si un thème ou module remplace complètement le rendu des icônes, elle
peut ne pas apparaître plutôt que de recouvrir une autre condition.

### Test d'affichage

1. Activer Bleed manuellement, saisir `1d4` et valider.
2. Vérifier que **seule** l'icône Bleed est présente sur le token, avec
   `1d4` superposé. Il ne doit pas y avoir d'icône Buff neutre.
3. Vérifier sur la fiche que le Buff `Saignement — 1d4` existe, est actif,
   possède le flag `manualBleed` et son option « Hide from token » cochée.
4. Avancer de plusieurs tours : la formule reste `1d4` sur l'icône ;
   le résultat des dégâts change selon les dés.
5. Désactiver puis réactiver le saignement avec `2d6+1` : la même icône
   native doit afficher la nouvelle formule, sans deuxième marqueur.
6. Tester sur deux clients, après F5, sur un token non lié et sur un personnage
   qui possède également un autre Buff issu d'une capacité.
7. Mettre à jour depuis un ancien Buff manuel `v1.30.1` :
   il doit automatiquement passer en « Hide from token ».
