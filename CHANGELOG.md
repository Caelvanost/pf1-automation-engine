## v1.9.0 — Native Pathfinder 1e actor rest hooks (experimental)

- Generic events `pf1PreActorRest` and `pf1ActorRest` can now be registered through `api.generic.register()` or approved Item discovery declarations.
- The new `scripts/rest-automation.js` bridge captures raw HP/vigor/wounds, item uses and resources synchronously before native PF1 writes, and provides post-rest snapshots and native update proposals to PF1 scripts via `event.rest`.
- Structured fields distinguish `hours >= 8`, `restoreHealth`, `restoreDailyUses`, `isFullRest` and `kind`; optional `filter.rest` predicates support precise subscriptions without baking in class rules.
- Player/secondary-GM rest notifications relay to the elected GM for ownership-gated dispatch of existing registered PF1 Item callbacks; correlation IDs, deduplication and serialized per-actor dispatch guard against duplicate triggers.
- No automatic healing, class-specific resource resets or kineticist logic in module code. Item scripts own their effects and resources.
- Added English `docs/PF1-NATIVE-REST.md`, runtime-neutral Node regression `tests/rest-hooks.test.cjs`, and CI ZIP verification.
- Native rest integration requires real-world acceptance tests before merging; v1.8.0 timers, duration handling and effect groups remain unchanged.

## v1.8.0 — Durées monde/combat
- Nouveau registre persistant `durationRegistry` et API `api.duration` pour les durées en secondes, rounds PF1 (6 s), minutes et heures.
- Échéances observant `updateWorldTime`, le Combat Tracker, les changements de rencontre et les F5 ; aucun changement de l'horloge du monde.
- Gestion des buffs natifs PF1, ActiveEffects, scripts de nettoyage PF1, effets multicibles approuvés même hors combat et prolongation sans réappliquer.
- Décompte commun en combat : `max(rounds × 6 s, delta du temps du monde)` pour éviter un double décompte d'un même intervalle.
- Compatibilité v1.7.1 : minuteurs de phase inchangés ; groupes historiques inchangés.
- Tests `duration.test.cjs` et `duration-group.test.cjs` ajoutés à la CI Windows.

# Changelog

## 1.7.1 — Échéances fixes et prolongation des groupes

- Les minuteurs de phase enregistrent désormais un `targetRound` calculé au déclenchement, qui ne change pas avec F5.
- Reconstitution et reprise des minuteurs v1.6/v1.7 encore en cours à partir du round/tour de création.
- `api.generic.extendTimer(id,{rounds:1})` : décaler une échéance existante, sans la réinitialiser (MJ responsable).
- `api.effectGroups.extendGroup({actor,key,rounds:1})` : prolonger le groupe sans réappliquer, désactiver ou recréer ses buffs. Autorisé depuis un personnage joueur sous contrôle du MJ via socket.
- Test automatisé : fin du tour du barde après rechargement en début de round, prolongation puis F5, migration des échéances existantes.



## 1.7.0 — Effets temporaires multi-bénéficiaires

- API générique `api.effectGroups` : modèles approuvés par le MJ, applications à plusieurs acteurs, gestion des copies de buffs natifs PF1 et ActiveEffects.
- Un groupe d’effets = un minuteur précis attaché au tour du lanceur (`endOfCurrentTurn`, `startOfNextTurn`, `endOfNextTurn`, `turnStart`, `turnEnd`).
- Envoi d’une demande non privilégiée par socket depuis le client joueur ; vérification de propriété et bénéficiaires par le MJ responsable.
- Nettoyage des copies marquées seulement, restauration après F5 et nettoyage de combat.
- Préservation des anciennes API `startEffect`, `stopEffect`, `schedule`, `scheduleTurn`, `expireEffectAt`.
- Tests Node : `tests/effect-groups.test.cjs`.

# Journal des modifications

## 1.6.0 — Expirations déterministes par phase de tour

- Nouveaux services `scheduleTurn`, `expireEffectAt` : fin du tour actuel, début du prochain tour, fin du prochain tour, et N-ième début/fin de tour.
- Désactivation automatique d’un Item buff PF1 ou d’un ActiveEffect, avec option explicite de suppression pour un ActiveEffect uniquement.
- Exécution isolée d’un script PF1 existant lors de l’expiration, sans utiliser la capacité.
- Persistance dans `timerRegistry`, sérialisation des écritures, déduplication des transitions et reprise des expirations dues si l’objet est temporairement indisponible.
- Compatibilité préservée de `schedule({unit: rounds|turns})`, `cancelTimer`, `register`, `unregister` et des anciennes déclarations.
- Tests de simulation de combat (incluant F5, remplacement du MJ et buffs).


## 1.5.1 — Nettoyage des automatisations spécifiques aux classes

- Suppression du script chargé `scripts/combat-hooks.js` (ancienne expiration liée à une classe).
- Suppression de la macro de démonstration spécifique `macros/enregistrer-cold-adaptation.js`.
- Retrait des exemples nommant des classes dans la documentation livrée.
- Conservation du moteur d’événements, de la découverte automatique, des minuteurs, des effets temporaires, de la migration d’ID et de toutes les API génériques.
- Aucune suppression des données `flags.world.*` écrites par les anciennes capacités : leur nettoyage relève maintenant du script de la capacité concernée.

**Attention :** les campagnes qui comptaient sur l’ancien hook de classe pour supprimer automatiquement un flag en fin de tour doivent recréer cette expiration avec un script PF1 d’objet, via le moteur générique et ses minuteurs.
