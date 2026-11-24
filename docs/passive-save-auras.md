# PF1AE — Auras passives et sauvegardes conditionnelles (v1.43.0)

**Système** : Foundry 13.351 et PF1 11.11. Les auras passives réutilisent `api.proximityAuras` et le moteur existant de proximité. Aucun bonus permanent aux caractéristiques de sauvegarde d'un acteur n'est créé.

## API générique

```js
await game.modules.get("pf1-automation-engine").api.proximityAuras.register({
 key:"passive-example",
 sourceItemUuid:item.uuid,
 emitterActorUuid:actor.uuid,
 emitterTokenUuid:token.document.uuid,
 beneficiaries:{kind:"allies",excludeEmitter:true},
 range:{kind:"radius",distance:10}, // unités de la scène (10 ft = 3 m PF1)
 savingThrowBonus:{
  bonusType:"morale",value:4,
  saves:["fort","ref","will"],
  appliesTo:{descriptors:["fear"]}
 },
 lifecycle:{
  mode:"passive",
  requiresAlive:true,
  requiresConscious:true,
  minimumClassLevel:{classTag:"paladin",level:3} // FACULTATIF, générique
 },
 label:"Aura passive"
});
```

Aucune règle de paladin n'existe dans le code du moteur. `savingThrowBonus` peut exister à la place de `defense` ; une aura passive n'a ni `duration` ni `started`. Les auras temporaires et les lumières de Bouclier saint restent prises en charge. Les conditions de niveau de classe sont des métadonnées déclaratives, sans nom de classe connu du moteur.

Les contrôles `requiresAlive` et `requiresConscious` lisent les **états natifs de l'acteur** : `dead`, `unconscious`, `sleep`, `pf1_sleep` et `asleep`. Les points de vie ne suffisent jamais à déduire l'inconscience. Pour une utilisation fiable, un effet d'inconscience doit réellement activer son état Foundry. Le système PF1 n'active pas forcément de statut automatiquement à 0 PV.

## Sauvegardes natives et non-cumul

- Le hook **`pf1PreActorRollSave(actor,options,saveType)`** applique une seule fois le complément numérique dans `options.bonus` **avant le jet natif**. Aucun jet secondaire, aucune réécriture de résultat et aucune mutation de `actor.system.attributes.savingThrows`.
- Les descripteurs sont lus depuis la **source structurée** du jet : `game.modules.get(...).api.saveContext._fromNativeSaveOptions`, ou `options.pf1aeSave.sourceItemUuid` ; les `system.tags`, `system.descriptors`, `system.spellDescriptors`, `action.tags` et le flag existant `flags.pf1-automation-engine.saveTraits.descriptors` sont pris en charge. Aucun texte HTML n'est analysé.
- Le bonus `morale` est comparé à la contribution typée native renvoyée par `actor.getSourceDetails("system.attributes.savingThrows.<type>.total")`. Seul **`max(0, meilleurBonusAura − bonusMoralNatif)`** est ajouté. Plusieurs auras du même type ne s'additionnent pas.
- Si la source ou la provenance typée est introuvable, le moteur n'invente **aucun bonus** : `game.modules.get("pf1-automation-engine").api.conditionalSaveAuras.lastDiagnostic(actorUuid,"will")` fournit `status` et `reason`. Les sources non magiques sont prises en charge dès lors qu'elles portent le descripteur structuré `fear`.
- Les résultats positifs sont inscrits comme métadonnée sur la carte native `flags.pf1-automation-engine.conditionalAuraSave` et rendus sous forme de note localisée FR/EN sur cette même carte ; le moteur ne publie aucune nouvelle carte de jet.
- Lorsque `actor.getConditionImmunities()` contient un descripteur de la source reconnue (`fear` par exemple), le hook pré-jet PF1 annule la sauvegarde native. Le moteur ne crée jamais une immunité à partir d’un simple bonus d’aura.
- Les types déclaratifs qui exigeraient un empilement particulier (dodge/circumstance/untyped) sont volontairement refusés pour les sauvegardes conditionnelles avant une implémentation explicitement correcte.

## Découverte des Script Calls

Sur l'objet de capacité, ajouter **un Script Call natif**, catégorie **Après utilisation** (`postUse`), nommé **exactement `PF1AE:aura:passive`**. Copiez le script complet [`examples/aura-of-courage-passive.js`](../examples/aura-of-courage-passive.js).

Le MJ élu scanne les capacités après chargement, placement/suppression de token, changement de scène, création d'objet, reconnexion et changement d'état pertinent. Le Script Call n'est exécuté par le MJ que si `api.scriptApprovals.check` l'autorise : approbation explicite du script natif exact, ou **Table de confiance** activée. Les scripts ne sont jamais transmis via un socket de joueur. Un cache de source et token empêche les réexécutions inutiles ; `proximityAuras.register()` est idempotent.

### Configuration Aura de courage

- Paladin niveau 3 minimum. Aucun coût d'action ni utilisation.
- Portée **3 m ou 10 ft** (PF1 : deux cases de 1,50 m / 5 ft).
- Alliés uniquement, autre que le paladin.
- Moral +4 à Volonté, Vigueur et Réflexes uniquement contre un effet portant un descripteur `fear` vérifié.
- Inactivité quand l'émetteur est mort ou inconscient ; réactivation automatique au réveil.
- Pas de message RP automatique.

**Immunité personnelle** : PF1 11.11 expose l’immunité native **Fear / Terreur** (`fear`) et `actor.getConditionImmunities()`. Configurer l’immunité `fear` dans la section native **Immunités aux états** du paladin, ou via un effet de classe natif équivalent. Lorsqu’un jet est identifié comme provenant d’un effet `fear` structuré, PF1AE annule la sauvegarde native si le système confirme cette immunité : aucun second jet ni nouveau type d’immunité.

**Point restant à vérifier en jeu :** une immunité configurée de façon permanente dans les traits du personnage n’est pas automatiquement désactivée par PF1 lors d’une perte de conscience. Les bénéfices *aux alliés* sont suspendus automatiquement grâce aux statuts ; pour l’immunité *personnelle*, il faut configurer son activation/désactivation dans PF1 ou la gérer manuellement tant qu’un effet natif conditionnel sûr n’a pas été validé. Ne pas laisser une immunité de classe active lorsque la capacité ne fonctionne plus.

**Limitations à valider sur une instance PF1 11.11** : la provenance `getSourceDetails` doit renvoyer effectivement les composantes typées des sauvegardes. Certaines capacités tierces peuvent fournir des bonus contextuels qui ne sont pas décrits ; le moteur signale alors une incertitude au lieu de calculer à l'aveugle. Le contrôle d'immunité native aux jets de sauvegarde contre la terreur reste sous la responsabilité du système et du MJ. Les tests automatisés couvrent les mécaniques et le format des objets, mais ne reproduisent pas la totalité du pipeline réel de PF1.
