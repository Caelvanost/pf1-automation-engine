# PF1 Automation Engine v1.7.0 — Effets multi-bénéficiaires

**Environnement ciblé :** Foundry VTT 13.351 · Pathfinder 1e 11.11.

Ce service reste **indépendant des classes** : aucune règle d'inspiration, de résistance, de sort ou de capacité n'est codée dans le module. L'objet PF1 et ses scripts déterminent la mécanique ; le module transporte un modèle d'effet approuvé vers plusieurs acteurs et le retire à une échéance liée au tour du lanceur.

## 1. Fonctionnement

Un MJ approuve un **modèle** présent sur la fiche de l'acteur source :

- un **ActiveEffect** Foundry intégré à l'acteur ;
- un **Item PF1 de type `buff`** intégré à l'acteur.

Le module stocke l'empreinte exacte du modèle dans un paramètre de monde. Une modification du modèle, de ses bonus ou de ses scripts PF1 **invalide l'approbation**.

Au déclenchement, le script de l'objet PF1 peut appeler `api.effectGroups.applyGroup(...)`. Le MJ responsable vérifie le lanceur, le modèle approuvé, le combat et les bénéficiaires. Il crée une copie pour chaque bénéficiaire et inscrit **un minuteur** `scheduleTurn()` pour le groupe entier. À l'expiration, il supprime uniquement les copies identifiées par un marqueur de propriété du module ; les buffs permanents, objets d'origine et effets d'autres modules restent intacts.

Les groupes et les minuteurs sont stockés dans les paramètres `world` et survivent à F5. Une cible momentanément introuvable reporte le nettoyage au prochain passage de tour/chargement. Si le combat est supprimé, le moteur tente également de nettoyer les copies.

## 2. API

```js
const mod = game.modules.get('pf1-automation-engine');
const groups = mod.api.effectGroups;

// MJ élu, une fois par modèle approuvé
await groups.approveTemplate(templateUuid);
// Revoir / révoquer une approbation (MJ élu)
await groups.revokeTemplate(templateUuid);
groups.listApprovedTemplates();

// Depuis une capacité PF1, un script natif, ou une macro
const result = await groups.applyGroup({
  actor,                       // acteur source (ou token avec .actor)
  key: 'temporary-bonus',      // clé stable par acteur, 1–80 caractères [a-zA-Z0-9_-]
  templateUuid: template.uuid, // buff PF1 OU ActiveEffect sur l'acteur source
  targets: [actor, ...allies], // Actors ou Tokens, 1 à 30 bénéficiaires
  timing: 'endOfCurrentTurn',  // expiration lors de la transition vers le suivant
  occurrences: 1              // pour turnStart/turnEnd
});

// Stopper plus tôt (par exemple un script de désactivation de capacité)
await groups.stopGroup({ actor, key: 'temporary-bonus' });

// Diagnostics
console.table(groups.listGroups());
console.table(mod.api.generic.listTimers());
```

Un autre appel `applyGroup()` avec la **même** paire `(sourceUuid, key)` remplace le groupe précédent. Des clés différentes peuvent coexister. Les effets ajoutés sur les cibles ne sont jamais supprimés en masse : le moteur vérifie leur `flags.pf1-automation-engine.effectGroupId` avant chaque suppression.

Les moments possibles sont `endOfCurrentTurn`, `startOfNextTurn`, `endOfNextTurn`, `turnStart` et `turnEnd` (voir [API-EXPIRATIONS.md](API-EXPIRATIONS.md)). `endOfCurrentTurn` exige que le combattant du lanceur soit actif au moment de l'application.

Pour les **buffs PF1**, le moteur crée un Item temporaire inactif puis utilise `setActive(true)` (ou `system.active = true` si nécessaire) ; à l'expiration, il appelle d’abord `setActive(false)` pour les scripts natifs de désactivation, puis **supprime uniquement cette copie temporaire**. Les éventuels scripts natifs *Basculer* du buff peuvent s'exécuter : vérifier le modèle approuvé.

Pour les **ActiveEffects**, il crée une copie activée sans durée native, afin que le minuteur de phase reste la seule autorité. Les copies sont supprimées à l'expiration.

## 3. Exemple complet — configuration MJ

1. Sur le personnage source, créer un modèle ActiveEffect ou un buff PF1 contenant uniquement les bonus voulus. Donner au buff un nom reconnaissable, par exemple `Bonus temporaire de groupe`. Pour les buffs, contrôler les scripts *Basculer* présents sur le modèle.
2. Depuis la console du MJ responsable, après avoir sélectionné son token :

```js
const source = canvas.tokens.controlled[0]?.actor;
const template = [...source.items].find(i =>
  i.type === 'buff' && i.name === 'Bonus temporaire de groupe');
// Pour un ActiveEffect à la place :
// const template = [...source.effects].find(e => e.name === 'Bonus temporaire de groupe');
if (!template) throw Error('Modèle introuvable sur le personnage source.');
await game.modules.get('pf1-automation-engine').api.effectGroups.approveTemplate(template.uuid);
console.log('Modèle approuvé :', template.uuid);
```

3. Dans la capacité PF1 : **Avancé → Appel de script → Utiliser** (ou le script d'action approprié), intégrer le script ci-dessous. Le joueur cible les alliés dans Foundry avant d'utiliser la capacité.

```js
const caster = actor ?? item?.actor;
if (!caster) throw Error('Acteur introuvable.');
const template = [...caster.items].find(i =>
  i.type === 'buff' && i.name === 'Bonus temporaire de groupe');
if (!template) throw Error('Buff modèle introuvable.');
const allies = [...game.user.targets].map(t => t.actor).filter(Boolean);
if (!allies.length) throw Error('Cibler au moins un bénéficiaire.');
const result = await game.modules.get('pf1-automation-engine').api.effectGroups.applyGroup({
  actor: caster,
  key: 'bonus-temporaire-groupe',
  templateUuid: template.uuid,
  targets: allies,
  timing: 'endOfCurrentTurn'
});
if (result.submitted) {
  ui.notifications.info('Demande envoyée au MJ ; application non encore confirmée.');
}
```

**Précision :** le service ne dépense aucune ressource et ne joue aucune performance ; les règles et coûts restent dans l'objet PF1, comme précédemment. La copie d'un buff PF1 n'est pas la même chose que l'ajout de l'Item de classe à la fiche des bénéficiaires.

## 4. Autorisations et sécurité

- Les approbations de modèles ne peuvent être enregistrées que par **le MJ élu**.
- Une demande initiée par un joueur doit concerner un acteur qu'il possède et un modèle appartenant à cet acteur, **déjà approuvé et inchangé**.
- Le serveur MJ traite les requêtes sockets comme des requêtes **non privilégiées**, même si le champ `userId` prétend être celui d'un MJ.
- Un joueur peut cibler son propre acteur, un acteur qu'il possède ou un token **amical** de la scène du combat. Un acteur hostile est refusé. Le MJ élu peut appliquer des effets à d'autres cibles si le besoin de jeu l'exige.
- Les données socket ne contiennent pas de code JavaScript ni de contenu de buff. Le MJ résout l'UUID du modèle et valide son empreinte avant de cloner quoi que ce soit.
- Foundry ne fournit pas ici une signature cryptographique de l'expéditeur d'un message socket ; un `userId` transmis dans le message n'est pas une preuve d'identité. Cette API atténue le risque par les approbations MJ et les restrictions d'ownership/cibles, mais elle n'est **pas** un sandbox contre un client malveillant. À utiliser dans une table de jeu de confiance.
- Un appel direct par le MJ retourne `{applied:true, groupId, targetCount, timerId}`. Depuis le joueur, il retourne seulement `{submitted:true, requestId}` : le retour ne confirme **pas** que le MJ a accepté la demande.

## 5. Compatibilité et limites

- Les anciennes API `startEffect()` et `stopEffect()` **restent inchangées** et continuent de fonctionner selon leur ancien gestionnaire (`durationTurns`). Le nouveau service se trouve sous `api.effectGroups` ; il ne remplace pas silencieusement les anciens comportements.
- `scheduleTurn()`, `expireEffectAt()`, les événements et la découverte automatique sont conservés.
- Le module ne fusionne pas les bonus de deux effets différents. Il applique des copies distinctes, dont le cumul des bonus est régi par PF1.
- Le nettoyage est effectué au passage du tour dans `combatTurnChange`, donc après l'enregistrement du changement de tour par Foundry.
- Un `endOfCurrentTurn` demandé quelques instants avant un changement de tour peut échouer si la transition a lieu avant la confirmation du MJ ; le moteur n'invente pas de tours rétroactifs.
- Si un groupe ne peut être nettoyé entièrement, les copies restantes sont conservées dans le registre et l'expiration est réessayée. Un objet retiré manuellement est ignoré ; un objet dont le marqueur a été effacé n'est **jamais** supprimé automatiquement.
- Tester le cas des buffs avec des scripts *Basculer*, des acteurs synthétiques de tokens non liés, et deux MJ avant de l'utiliser en production. Les tests Node isolés ne remplacent pas ces vérifications.

## 6. Plan de test Foundry

1. Installer la version 1.7.0 dans le dossier `Data/modules/pf1-automation-engine` après sauvegarde du monde.
2. Approuver un ActiveEffect modèle avec le MJ responsable ; cibler deux alliés ; déclencher depuis la capacité du personnage. Les deux effets doivent être visibles et actifs ; un seul minuteur de groupe doit apparaître.
3. Terminer le tour du lanceur ; vérifier que les deux copies disparaissent et que les autres effets préexistants restent en place.
4. Répéter avec un buff PF1 natif, vérifier l'application de ses bonus, puis la suppression de la copie à l'échéance.
5. Tester `startOfNextTurn` et `endOfNextTurn`, puis faire F5 avec un groupe actif.
6. Répéter avec deux MJ et un joueur ; vérifier qu'un seul MJ crée et supprime les copies.
7. Modifier volontairement un modèle après son approbation : son utilisation doit être refusée jusqu'à une nouvelle approbation par le MJ.
8. Tester `stopGroup()` avant échéance et une cible momentanément indisponible, puis vérifier `listGroups()` et `listTimers()`.
