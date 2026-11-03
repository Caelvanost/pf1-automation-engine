# PF1 Automation Engine v1.7.1

Foundry VTT v13.351 · Pathfinder 1e 11.11.

Moteur générique : événements persistants, scripts PF1 isolés, découverte des automatisations approuvées, expirations de tour et **groupes d’effets temporaires sur plusieurs acteurs** (ActiveEffects et buffs natifs PF1).

Le module ne contient aucune règle spécifique aux classes. Toutes les règles sont dans les capacités PF1.

**Nouveau :** [API-EFFETS-GROUPES.md](API-EFFETS-GROUPES.md) (approbation d’un modèle par le MJ, `api.effectGroups.applyGroup()`, `stopGroup()`, `extendGroup()` et expirations programmées).

Pour les expirations de phase, voir [API-EXPIRATIONS.md](API-EXPIRATIONS.md). Pour l’installation et la migration des identifiants historiques, voir [MIGRATION-V1.5.md](MIGRATION-V1.5.md).

**v1.7.1** : chaque expiration de tour dispose d’une échéance de round persistante (`targetRound`). Les scripts PF1 peuvent prolonger les groupes avec `extendGroup({actor,key,rounds:1})` sans recréer les buffs.
