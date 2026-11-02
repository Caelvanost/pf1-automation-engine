# PF1 Automation Engine

Foundry VTT v13.351 · Pathfinder 1e 11.11

Version de développement **1.4.0** : découverte automatique des déclarations d’automatisation sur les objets PF1 avec **approbation du MJ**. Les scripts de capacité contiennent seuls la logique de classe.

> **Compatibilité** : l’identifiant technique demeure `pf1-combat-automation`, malgré le nouveau nom affiché. L’objectif est de préserver les paramètres, flags et macros installés avec la v1.3.0.

Installation : copier le dossier `pf1-combat-automation` dans `FoundryVTT/Data/modules/`, redémarrer puis activer **PF1 Automation Engine**.

Documentation : [API-DECOUVERTE.md](API-DECOUVERTE.md), [API-GENERIQUE.md](API-GENERIQUE.md) et [API-SCRIPTS-OBJET.md](API-SCRIPTS-OBJET.md).

Tests statiques : `node tests/discovery.test.cjs`. Les tests d’intégration dans Foundry restent à faire.
