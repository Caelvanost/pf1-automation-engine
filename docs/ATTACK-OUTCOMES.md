# PF1 Attack Outcomes — v1.14.1 (expérimental)

**Fondement :** Foundry VTT 13, système PF1 11.11. L'implémentation surveille le hook PF1 `pf1ApplyDamageTargetOptions`, dont les arguments documentés sont `(app, target, options)` et dont les options sont envoyées ensuite à `ActorPF.applyDamage()`. La carte d'origine est fournie par `app.extraOptions.message`, et l'indice d'attaque par `app.extraOptions.attackIndex`. Le module ne déduit jamais la provenance d'une simple modification de PV.

## API publique

```js
await api.attackOutcomes.register({
  actor: monk,
  key: 'sf-unique-instance',
  groupKey: 'stunning-fist',
  sourceItemUuid: unarmedItem.uuid,
  sourceActionId: unarmedAction.id,
  attackIndex: 0, // indice réel de frappe dans la carte PF1
  targets: [victim.actor.uuid],
  onDamageApplied: {
    type:'triggerItemAction',
    itemUuid:stunningFist.uuid,
    actionId:saveAction.id,
    saveOutcome:{
      key:'sf-unique-instance',groupKey:'stunning-fist',
      sourceItemUuid:stunningFist.uuid,sourceActionId:saveAction.id,
      targets:[victim.actor.uuid],
      onFailure:{type:'linkedBuff',name:'Étourdi — Moine',img:stunningFist.img,
        statusId:'stunned',duration:{rounds:1,expire:'sourceTurnStart'}}
    }
  }
});
const attackUse=await unarmedItem.use({actionId:unarmedAction.id});
const message=attackUse?.shared?.message; // PF1 11.11
await api.attackOutcomes.bindAttack({actor:monk,key:'sf-unique-instance',sourceMessageId:message.id});
```

`register()` exige un Item et une Action réels appartenant à l'acteur source, un unique `attackIndex` dans une carte PF1, des UUID d'acteurs cibles valides et une Action de suivi du même acteur. Le seul `onDamageApplied.type` actuellement reconnu est `triggerItemAction`. `bindAttack()` est **fortement recommandé** : seul le message identifié est ensuite autorisé. Une requête d'un joueur propriétaire est transmise au MJ leader via socket avec accusé de réception ; le registre est stocké dans les paramètres du monde. `unregister({actor,key})` et `list()` sont également disponibles. Chaque instance doit utiliser une clé distincte. Les enregistrements expirent quatre heures après création ; ils sont vérifiés au chargement et supprimés à la prochaine opération de maintenance. Un enregistrement résolu est conservé 24 heures pour éviter les doublons.

## Déclenchement

Le module n'agit **qu'après** le retour réussi de `ActorPF.applyDamage()` et la constatation de dégâts effectifs sur les PV normaux ou en dégâts non létaux structurés. Une réduction des PV temporaires seule n'est pas retenue comme preuve suffisante. Les dégâts de type énergie, DR et immunités sont laissés à PF1 ; ce sont les valeurs réellement modifiées qui servent de vérification. Ce comportement est volontairement conservateur, notamment pour les variantes de points de vie et certains modèles PF1 non létaux.

La carte doit porter `itemSource` / `actionSource` structurés et l'indice d'attaque doit être présent dans les options natives du dialogue. L'acteur de cette carte, l'objet, l'Action, l'indice et l'Actor cible doivent correspondre strictement à **un seul** enregistrement en attente. Sinon le module n'agit pas, et journalise pourquoi. L'action native PF1 est déclenchée une seule fois avec `item.use({actionId,cost:0,chatMessage:true})`, sur le client MJ leader. La règle `saveOutcomes` est enregistrée **avant** la publication de la carte de sauvegarde ; la sauvegarde garde son DD et son résultat natifs.

## Limites et sécurité

- Le clic « Appliquer les dégâts » est considéré comme une validation opérationnelle de la frappe correspondante par le MJ : ce module ne sait pas reconstruire avec certitude le résultat du jet d'attaque contre la CA si les métadonnées natives ne le donnent pas. Sans provenance exacte, **aucune** sauvegarde supplémentaire n'est publiée.
- Une baisse de PV causée par un autre sort, une correction manuelle, ou un autre message ne peut pas déclencher la règle.
- Une attestation de dégâts envoyée par un joueur non-MJ est refusée : seul le MJ qui applique les dégâts peut faire parvenir une attestation exécutable au MJ leader. Cela évite de faire exécuter une Action par un joueur avec les permissions du MJ simplement via socket. Le comportement direct reste automatique lorsque le MJ applique les dégâts.
- Le moteur ne compense pas automatiquement les dégâts annulés ou corrigés ultérieurement. Si l'application des dégâts est modifiée après la publication de la sauvegarde, le MJ doit arbitrer.
- Un échec d'exécution après réservation de l'instance la place en `needsReview` pour empêcher des relances produisant plusieurs cartes. Résoudre le problème manuellement puis enregistrer une nouvelle tentative.
- L'API native `ItemPF.use()` peut exécuter des Script Calls embarqués dans l'Item avec les permissions de son exécutant. **Ne confier le déclenchement automatique qu'à des Items dont le MJ a validé les Script Calls.** Éviter toute exécution de code non fiable sur un acteur contrôlé par un joueur.
- Certains modules (notamment les automatismes de dégâts tiers) peuvent remplacer `ActorPF.applyDamage()` ; vérifier la compatibilité et l'ordre de chargement. Le module ne remplace plus `ActorPF.applyDamage()`, exposée par un accesseur non configurable. Il observe la fin du dialogue natif, après les hooks de provenance.
- Le Script Call « Utiliser » ne doit pas se réexécuter lorsque l'Action « Sauvegarde » est appelée. Ajouter un garde sur l'Action dans le Script Call.
- L'intégration avec « Déluge de coups » exige une entrée `attackIndex` propre à chaque frappe, sans relancer `use()` de l'attaque. Le présent module ne modifie pas le script Déluge existant.

## Protocole de test

1. Activer le debug générique et vérifier `Installed native damage bridge` au chargement.
2. Faire `register` puis `bindAttack` depuis le joueur propriétaire du moine ; vérifier la présence de la règle dans `api.attackOutcomes.list()`.
3. Lancer une attaque et **ne pas cliquer sur les dégâts** : aucune carte Vigueur.
4. Appliquer zéro dégât ou des dégâts intégralement absorbés : aucune carte.
5. Cliquer « Appliquer les dégâts » sur la **bonne** carte, pour le bon `attackIndex` et la bonne cible : une seule carte Vigueur.
6. Recliquer « Appliquer les dégâts » : pas de seconde carte.
7. Appliquer les dégâts d'une autre carte ou sur une autre cible : aucune carte liée.
8. Retester avec le joueur du moine déconnecté, le MJ appliquant les dégâts.
9. Faire rater le JS de Vigueur : `saveOutcomes` applique Étourdi pendant un round, jusqu'au prochain tour du moine.
10. Faire réussir le JS : aucun effet. Tester une cible immunisée : aucune condition ; consulter l'avertissement MJ.
11. Tester avec deux frappes d'un Déluge, en affectant Coup étourdissant à un seul indice ; aucune attaque supplémentaire.
12. Vérifier après F5, changement de scène et reconnexion du joueur ; avec plusieurs MJ, un seul doit publier la carte.
13. Retester Fascination, Countersong et Distraction pour vérifier l'absence de régression.

**Prérequis à la validation réelle :** confirmer que le dialogue PF1 11.11 de l'installation conserve bien `extraOptions.message` et `extraOptions.attackIndex` lors du hook `pf1ApplyDamageTargetOptions`, et que `ActorPF.applyDamage()` est la méthode appelée. La documentation publique expose ces champs, mais cela n'a pas encore été testé en direct dans votre monde.

## Exemple de Script Call complet

Voir [`scripts-exemples/coup-etourdissant-utilisation.js`](../scripts-exemples/coup-etourdissant-utilisation.js). Cet exemple exige l'ajustement du nom de l'arme et de la configuration native des charges. Il ne remplace pas automatiquement un ancien Script Call dont le code n'a pas été fourni.
## v1.14.1 — Protocole de validation de l'accesseur PF1

L'accesseur `ActorPF.prototype.applyDamage` n'est jamais assigné, redéfini ou remplacé, et son setter n'est pas appelé. Le pont observe `pf1.applications.ApplyDamage._onApply` uniquement si cette méthode est accessible et inscriptible. Pendant le dialogue, `pf1ApplyDamageTargetOptions(app,target,options)` attache les identifiants source; `pf1ApplyDamage(actor,options)` confirme que PF1 traite les mêmes options. Après la fin du dialogue, il mesure la variation réelle des PV/dégâts non létaux avant d'envoyer l'événement au MJ élu. En cas de désaccord, de dialogue annulé ou d'absence d'un hook, il refuse l'automatisation.

**Logs attendus :** `Installed native damage bridge`, `Native damage options annotated`, `pf1ApplyDamage received`, `Native damage dialog completed`, `Triggered source-specific follow-up Action`. Si `_onApply` est inaccessible ou non inscriptible, le module avertit et ne remplace pas l'accesseur Actor.

**Limites :** ce pont concerne le dialogue PF1 natif ; il ne détecte pas les dommages infligés par une macro externe appelant directement `ActorPF.applyDamage`. La simulation des hooks et de l'accesseur passe, mais le comportement exact de `_onApply` et la propagation des options restent à vérifier dans votre installation.
