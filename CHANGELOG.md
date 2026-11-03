# Changelog

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
