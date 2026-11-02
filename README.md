# PF1 Automation Engine

Foundry VTT v13.351 · Pathfinder 1e 11.11

Version de développement **1.4.0** : découverte automatique des déclarations d’automatisation sur les objets PF1 avec **approbation du MJ**. Les scripts de capacité contiennent seuls la logique de classe.

> **Compatibilité** : l’identifiant technique demeure `pf1-combat-automation`, malgré le nouveau nom affiché. L’objectif est de préserver les paramètres, flags et macros installés avec la v1.3.0.

Installation : copier le dossier `pf1-combat-automation` dans `FoundryVTT/Data/modules/`, redémarrer puis activer **PF1 Automation Engine**.

Documentation : [API-DECOUVERTE.md](API-DECOUVERTE.md), [API-GENERIQUE.md](API-GENERIQUE.md) et [API-SCRIPTS-OBJET.md](API-SCRIPTS-OBJET.md).

Tests statiques : `node tests/discovery.test.cjs`. Les tests d’intégration dans Foundry restent à faire.

## Construire le ZIP installable (Windows)

Depuis la racine du dépôt (PowerShell) :

```powershell
.\build_release.bat
```

Ou directement avec PowerShell 5.1+ :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build_release.ps1
```

Le script lit la **version** et l'**identifiant technique** dans `module.json`, contrôle les fichiers référencés et génère `dist/pf1-automation-engine-v1.4.0.zip` (le numéro est adapté à la version du manifeste). Node.js est facultatif : s'il est installé, la syntaxe des sources JavaScript est vérifiée avant la création de l'archive.

Le ZIP contient `module.json` **directement à sa racine**, avec les répertoires d'exécution ; il exclut notamment `.git`, les outils, les tests et les archives précédentes. Pour installer manuellement, **extraire son contenu** dans `FoundryVTT/Data/modules/pf1-combat-automation/` : le dossier doit contenir `module.json` sans niveau supplémentaire. Redémarrer Foundry, puis activer le module. L'identifiant interne historique est volontairement préservé.

Options :

```powershell
.\build_release.ps1 -OutputDirectory "C:\Temp\Foundry"
.\build_release.ps1 -SkipSyntaxCheck
```

Pour lancer des tests Node indépendamment de la création du ZIP :

```powershell
node tests/discovery.test.cjs
```
