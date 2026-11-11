# PF1AE — Événements de dégâts réellement appliqués (v1.19.0)

**Compatibilité :** Foundry VTT v13 / PF1 v11.11.

## Architecture

Le seul composant qui écoute les hooks natifs \`pf1ApplyDamageTargetOptions\`, \`pf1ApplyDamage\` et \`updateActor\` reste \`scripts/attack-outcomes.js\`. Il établit la provenance via la carte native structurée (Item et ItemAction), \`attackIndex\`, l'Actor cible, le hook d'application et les PV effectivement modifiés. Une fois validé par le MJ élu, il publie le hook **interne** \`pf1aeVerifiedDamage\`. \`scripts/damage-events.js\` n'installe donc **aucun second pont de dégâts**.

La validation existante de \`api.attackOutcomes\` reste inchangée : une frappe peut aussi déclencher son Action de sauvegarde, indépendamment de ces abonnements. \`damageEvents\` fonctionne même si aucune règle \`attackOutcomes.register()\` n'est présente.

Le service refuse les événements sans perte **effective** de PV normaux, même si l'attaque a été déclarée, si \`pf1ApplyDamage\` s'est produit, ou si seul le champ \`hp.offset\` a changé sans changement réel de \`hp.value\`. Les PV temporaires seuls, les dégâts non létaux seuls et un dialogue annulé ne produisent pas d'événements dans cette version. Ces types de dégâts pourront être proposés ultérieurement avec une sémantique distincte. Les informations incertaines valent \`null\`, jamais une touche inventée.

## Abonnement déclaratif dans une capacité

Créer un **Appel de script PF1 : « Après utilisation »** sur l'objet qui doit réagir. Son nom doit être exactement l'un des suivants :

| Nom du Script Call | Déclenchement |
|---|---|
| \`PF1AE:damage:applied\` | Chaque perte de PV normaux vérifiée |
| \`PF1AE:damage:critical\` | Perte de PV normaux vérifiée avec \`critMult > 1\` |
| \`PF1AE:damage:zeroHP\` | Perte vérifiée faisant passer la cible de PV > 0 à PV ≤ 0 |

L'objet abonné n'est jamais utilisé pour installer l'abonnement. PF1AE parcourt les Items du propriétaire de l'attaque ; aucune inscription \`bootstrap.register()\` n'est requise. Ce mécanisme survit naturellement à F5/reconnexion/changement de scène car les Script Calls restent stockés dans l'Item. Des noms identiques en doublon sur un même Item sont ignorés, avec diagnostic.

**Recommandation :** pour une capacité qui a plusieurs conditions possibles, utiliser **un seul** \`PF1AE:damage:applied\` et examiner \`event.critical\` et \`event.reducedToZero\`, afin d'éviter de compter plusieurs fois un même projectile satisfaisant deux conditions.

## Événement

\`\`\`js
{
  eventId: "unique-native-damage-receipt",
  type: "damage:applied",
  actorUuid: "Actor....",
  itemUuid: "Actor....Item....",
  actionId: "action-id",
  sourceMessageId: "card-id",
  attackIndex: 0,
  targetActorUuid: "Scene.scene.Token.token.Actor.actor",
  damageApplied: true,
  hpBefore: 12,
  hpAfter: -3,
  hpDelta: -15,
  tempHpLoss: 0,
  critical: true,
  critMult: 4,
  criticalHitConfirmed: null,
  reducedToZero: true
}
\`\`\`

- \`critical: true\` signifie **application depuis la colonne de dégâts critique selon \`options.critMult > 1\`** ; ce n'est **pas** une preuve de confirmation du critique contre la CA. Une menace seule ne produit aucun événement sans dégâts effectifs. Un \`critMult\` absent donne \`critical: null\` et aucun \`damage:critical\`. Les résultats observés dans PF1 v11.11 sont 0 pour la colonne normale et 4 pour un critique ×4. L'indication \`@critMult\` utilisée dans les formules de dés ne doit pas être confondue avec une attestation de succès d'attaque.
- \`reducedToZero\` indique uniquement la transition **strictement positive → 0 ou moins**. Ce n'est pas une assertion de mort définitive, d'inconscience ou d'éligibilité à une ressource de classe.
- \`attackIndex\` vient du contexte natif et distingue les frappes d'une attaque à outrance. \`targetActorUuid\` peut être un Actor synthétique de token non lié.
- Les dégâts de zone ou multi-cibles ne produisent des événements distincts que si le pont reçoit **par cible** un contexte natif non ambigu avec le même \`attackIndex\` et le bon Actor UUID. Aucune cible ou frappe n'est déduite automatiquement.

## Script Call générique prêt à copier-coller

Dans **Après utilisation**, nom exact : \`PF1AE:damage:applied\`.

\`\`\`javascript
if (typeof event !== "undefined" && event?.type === "damage:applied") {
  const engine = game.modules.get("pf1-automation-engine")?.api?.damageEvents;
  if (!engine) throw new Error("PF1AE Damage Events indisponible.");

  console.log("[Capacité] Dégâts d'attaque vérifiés", {
    evenement: event.eventId,
    attaquant: event.actorUuid,
    arme: event.itemUuid,
    cible: event.targetActorUuid,
    degatsPV: -event.hpDelta,
    critique: event.critical,
    confirmationDeCritique: event.criticalHitConfirmed,
    passageAZero: event.reducedToZero
  });

  // Toute condition de classe, don ou capacité reste dans l'objet.
  // Aucune ressource n'est modifiée par cet exemple de diagnostic.
}
\`\`\`

Il est possible ensuite de modifier une ressource native d'un Item avec \`await item.update({"system.uses.value": nextValue})\` **après vérification des règles** ; ne pas confondre le total du jet ou \`critMult\` avec une validation réglementaire. Si le Script Call s'abonne également à \`damage:critical\` et \`damage:zeroHP\`, les deux notifications ont le **même** \`eventId\` et doivent être dédupliquées par la capacité.

## Sécurité, persistance et multijoueur

- La confirmation des dégâts appartient au pont natif PF1 existant. Seul un MJ initiant l'application fournit une attestation acceptée par le MJ élu. Le service ne fait jamais confiance à un changement manuel de PV ni à une requête de joueur qui annonce elle-même des dégâts.
- Le **MJ élu** vérifie à nouveau la carte, l'Action, l'Item, son propriétaire et les PV effectifs de la cible. Si son client ne peut pas corroborer l'état actuel après un bref délai, il refuse.
- Chaque application possède un \`eventId\` distinct. Le MJ élu stocke les identifiants déjà traités dans \`damageEventReceipts\` (paramètre de monde), avec fenêtre 24 h et plafond 1 500 ; deux clics ayant entraîné **deux vraies pertes** sont bien **deux applications**, sauf si la même transaction est rejouée.
- Le propriétaire joueur connecté, élu de façon stable entre les propriétaires actifs, exécute les Script Calls sur **son propre client**. Les scripts d'Item possédés par un joueur **ne sont jamais évalués sur le client MJ**. Pour un PNJ sans propriétaire joueur, le MJ élu exécute son Script Call. Sans joueur propriétaire connecté, le MJ élu peut exécuter les Script Calls **seulement après approbation explicite et vérification du contenu exact** via `api.scriptApprovals.approve()`. L'absence ou l'obsolescence de l'approbation produit un refus journalisé.
- La livraison se fait sur \`module.pf1-automation-engine\`, avec une nouvelle enveloppe \`pf1ae-damage-events-v1\`. Le destinataire revérifie ses permissions, la carte et l'Action puis déduplique en session. Le transport socket Foundry ne fournit **pas d'authentification cryptographique de l'expéditeur** : un client hostile pourrait forger un paquet et tromper son propre Script Call. Le moteur ne lui accorde pas de droits MJ ; une attribution autoritaire de ressources à des joueurs non fiables exigerait un canal authentifié supplémentaire.
- Aucune logique de classe ne se trouve dans le module. Pas de jets ni de carte de dégâts supplémentaires.

## Protocole réel Foundry

1. Activer \`genericEnabled\` et \`genericDebug\` et créer sur une capacité le Script Call de diagnostic.
2. Effectuer une attaque normale et appliquer les dégâts depuis la carte native. Contrôler \`damage:applied\`, \`critical:false\` pour \`critMult:0\`.
3. Tester les **dégâts critiques** depuis leur colonne, \`critMult:4\`, avec perte réelle de PV : contrôler \`damage:critical\`. Un jet de confirmation sans dégâts ne doit rien faire.
4. Réduire une cible de 12 à 5, puis de 12 à −3 ; seul le second essai doit produire \`damage:zeroHP\`. De 0 à −5 ne doit pas reproduire cet événement.
5. Tester un dialogue annulé, des dégâts 0, des PV temporaires absorbant tout, et un changement manuel de PV : aucun événement.
6. Tester une attaque à outrance de plusieurs frappes, deux applications successives depuis une même carte, puis un token non lié \`Scene...Token...Actor...\` avec \`hp.offset\`.
7. Tester PJ propriétaire + MJ appliquant les dégâts, puis deux MJ, F5, changement de scène et reconnexion : comparer les identifiants de transaction et le client destinataire.
8. Confirmer les logs \`[PF1AE][DamageEvents]\` et la conservation des mécanismes existants Coup étourdissant, saveOutcomes, attackEvents et bootstrap.

**Limites :** aucun test Node ne peut prouver la structure exacte des dialogues de votre installation PF1 v11.11. Un changement des hooks, des propriétés de carte ou de \`critMult\` peut conduire à une absence prudente de notification plutôt qu'une attribution incorrecte.

## v1.19.1 — Reprise par le MJ

La sélection d'exécuteur est alignée avec le bootstrap : un joueur propriétaire connecté est élu en priorité ; sinon, le MJ élu prend la relève. Avant d'exécuter chaque Script Call d'un acteur possédé par un joueur, le MJ vérifie une approbation de code explicite via `api.scriptApprovals.check(actor,item,call)`. Le code source modifié est refusé jusqu'à une nouvelle approbation. Les notifications `notify` reçues via socket ne peuvent **pas** déclencher directement un Script Call sur le MJ. Voir [Approbations de secours](SCRIPT-FALLBACK-APPROVALS.md).
