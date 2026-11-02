# Journal des modifications

## 1.5.1 — Nettoyage des automatisations spécifiques aux classes

- Suppression du script chargé `scripts/combat-hooks.js` (ancienne expiration liée à une classe).
- Suppression de la macro de démonstration spécifique `macros/enregistrer-cold-adaptation.js`.
- Retrait des exemples nommant des classes dans la documentation livrée.
- Conservation du moteur d’événements, de la découverte automatique, des minuteurs, des effets temporaires, de la migration d’ID et de toutes les API génériques.
- Aucune suppression des données `flags.world.*` écrites par les anciennes capacités : leur nettoyage relève maintenant du script de la capacité concernée.

**Attention :** les campagnes qui comptaient sur l’ancien hook de classe pour supprimer automatiquement un flag en fin de tour doivent recréer cette expiration avec un script PF1 d’objet, via le moteur générique et ses minuteurs.
