# PF1 Automation Engine

Foundry VTT v13.351 · Pathfinder 1e 11.11

**Version 1.5.0 : migration de l’identifiant technique vers `pf1-automation-engine`.**

L’ancien identifiant `pf1-combat-automation` n’est plus utilisé par le module. Le nouveau dossier d’installation doit impérativement être `Data/modules/pf1-automation-engine/`.

**Avant l’installation :** sauvegarder le monde, désactiver l’ancien module, extraire le ZIP dans le nouveau dossier, puis activer PF1 Automation Engine. Seul le MJ principal copie les paramètres et flags historiques au premier chargement. Les anciens enregistrements sont conservés pour le retour arrière.

Voir [MIGRATION-V1.5.md](MIGRATION-V1.5.md) pour les consignes détaillées et les limitations concernant les références codées dans les capacités PF1.

## Construire le ZIP Windows

Depuis la racine du dépôt :

```powershell
.\build_release.bat
```

Ou directement :

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build_release.ps1
```

L’archive est produite sous `dist/pf1-automation-engine-v1.5.0.zip`. Le numéro de version provient de `module.json`. Le script exclut les fichiers Git et les outils de développement, vérifie les chemins du manifeste et contrôle la syntaxe JavaScript si Node.js est installé.

## Tests

```powershell
node tests/discovery.test.cjs
node tests/migration.test.cjs
```

## Documentation

- [MIGRATION-V1.5.md](MIGRATION-V1.5.md)
- [API-DECOUVERTE.md](API-DECOUVERTE.md)
- [API-GENERIQUE.md](API-GENERIQUE.md)
- [API-SCRIPTS-OBJET.md](API-SCRIPTS-OBJET.md)

**Les tests d’intégration en multijoueur sous Foundry réel restent à effectuer avant fusion.**
