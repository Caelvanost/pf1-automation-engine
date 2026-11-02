# Migration vers PF1 Automation Engine v1.5.0

**Versions ciblées : Foundry VTT v13.351 / PF1 11.11.**

## Avant toute installation

1. Effectuer une **sauvegarde du monde Foundry**, y compris `Data/worlds` et la configuration existante.
2. Désactiver **PF1 Combat Automation** (identifiant `pf1-combat-automation`) dans *Gestion des modules*. Ne pas activer les deux modules simultanément.
3. Extraire le ZIP v1.5.0 dans `Data/modules/pf1-automation-engine/`, avec `module.json` directement dans ce dossier.
4. Redémarrer l'hôte Foundry, activer **PF1 Automation Engine**, puis connecter un MJ principal.
5. Après chargement, vérifier la console F12 et exécuter :

```js
const mod = game.modules.get('pf1-automation-engine');
console.log(mod?.id, mod?.api?.migration?.status());
console.log(mod?.api?.generic?.listEvents());
console.log(mod?.api?.generic?.listTimers());
console.log(mod?.api?.discovery?.status());
```

## Fonctionnement du transfert

Lors du premier chargement par le **MJ principal actif**, `scripts/module-migration.js` :

- Lit les six paramètres du monde stockés sous l'ancien identifiant : `genericEnabled`, `genericDebug`, `eventRegistry`, `timerRegistry`, `autoDiscoveryEnabled`, `autoApprovals`.
- Copie les valeurs vers le nouveau namespace **uniquement si aucune valeur explicite nouvelle n'existe** ; la valeur `false` est conservée correctement.
- Copie les flags `flags.pf1-combat-automation` vers `flags.pf1-automation-engine` pour les acteurs, objets, effets actifs et tokens disponibles ; la copie comprend les objets des acteurs synthétiques des tokens non liés.
- Copie notamment `automations`, `tags`, `managedEffects` et les métadonnées d'effets temporaires, sans réinterpréter leurs règles.
- Met à jour les **macros script du monde** qui utilisent directement `game.modules.get('pf1-combat-automation')` ou les appels littéraux aux anciens namespaces de flags/settings. Leur code initial est enregistré dans le paramètre du monde `pf1-automation-engine.legacyMacroBackups` avant modification.
- N'efface **aucune donnée historique** ; un retour arrière demeure possible via la sauvegarde du monde et les anciens flags/settings.
- Enregistre `namespaceMigrationVersion = 1` seulement après une migration sans erreurs. Une migration interrompue peut être reprise au prochain chargement.

La copie ne parcourt **pas automatiquement les compendiums ni les scripts embarqués dans les capacités PF1**. Ces scripts restent inchangés pour respecter les personnalisations existantes. Un script qui contient en dur l'ancienne chaîne `game.modules.get('pf1-combat-automation')` doit être ajusté manuellement. Les scripts qui utilisent uniquement `actor`, `item`, les APIs génériques et les flags `world` continuent de fonctionner normalement.

## Retrouver les anciennes commandes de macro

Dans la console du MJ :

```js
const backup = game.settings.get('pf1-automation-engine', 'legacyMacroBackups');
console.log(backup); // id de la macro => commande d'origine
```

## API actuelle

```js
const api = game.modules.get('pf1-automation-engine').api;
api.generic.register(...);
api.generic.schedule(...);
api.discovery.approveItem(itemUuid);
```

**L'ancien accès `game.modules.get('pf1-combat-automation').api` ne peut pas être garanti** après la désinstallation de l'ancien module : ce n'est plus un identifiant de package installé. La migration met à jour les macros du monde aux appels littéraux connus et fournit l'inventaire des scripts d'objet à vérifier manuellement.

## Validation

1. Comparer `generic.listEvents()` et `generic.listTimers()` avant et après migration.
2. Contrôler les flags d'un objet PF1 existant : `item.getFlag('pf1-automation-engine', 'automations')`.
3. Tester une déclaration approuvée sur une propriété `updateItem`.
4. Recharger avec F5 : ne pas réexécuter la migration et vérifier le déclencheur `ready`.
5. Connecter un second MJ puis un joueur : seul le MJ principal exécute les scripts automatiques.
6. Tester une cible et un acteur provenant d'un token **non lié**.
7. Vérifier les effets temporaires historiques en combat ; ne pas les confondre avec la suppression des états `flags.world` d'autres scripts.

**Ne pas fusionner la Pull Request tant que ces tests en jeu ne sont pas validés.** Les tests unitaires ne remplacent pas une instance Foundry réelle.
