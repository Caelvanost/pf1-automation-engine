# PF1 Automation Engine v1.51.6

## Solidité (v1.51.6)

Solidité des créatures, contournement par adamantium réel sous 20, profil explicite d'objet inanimé et API de projection PV/brisé/détruit. Pas d'inférence depuis le type construct, pas de mutation d'Item ou de calcul de siège automatique. Voir [Damage resolution](docs/DAMAGE-RESOLUTION.md).

## Projectiles et armes de jet (v1.51.5)

Capture de la munition sélectionnée avant génération des attaques. Le lanceur transmet magie et alignements, mais pas ses seuils d'altération de contournement ni son matériau. Les propriétés propres du projectile sont enregistrées par attaque ; munitions mixtes sans identité finale explicite restent manuelles. Les armes de jet natives twak sans munition utilisent les propriétés de l'arme. Voir [Damage resolution](docs/DAMAGE-RESOLUTION.md).

## RD et armes naturelles (v1.51.4)

Les attaques naturelles natives de mêlée prennent en compte la RD/magie et RD/épique du porteur, sans attribuer un bonus d'altération artificiel. Matériaux et alignements explicites, sous-types et altération configurée sont traités séparément ; les propriétés sont enregistrées avec la carte. Les bonus externes non exposés et les équivalents épiques restent manuels. Voir [Damage resolution](docs/DAMAGE-RESOLUTION.md).

## Provenance persistante des propriétés d'attaque (v1.51.3)

Les propriétés de contournement prises en charge sont enregistrées dans la carte PF1 avant création du message et après résolution des jets. Les modifications ultérieures de l'arme ne changent pas le calcul. Une ancienne carte sans snapshot conserve les défenses simples mais nécessite un arbitrage si les propriétés historiques sont déterminantes. Aucun nouveau jet, aucune nouvelle carte. Voir [Damage resolution](docs/DAMAGE-RESOLUTION.md).

## RD combinées et alignements (v1.51.2)

Les RD à plusieurs critères sont évaluées en OU (`operator:true`) ou ET (`operator:false`). Alignements d'une arme de mêlée, surcharges de l'action et altération réelle +5. Une donnée inconnue ne bloque que si elle peut changer le total. La lecture des sous-types préparés et la convention des opérateurs restent à confirmer dans PF1 11.11 ; pas d'inférence depuis l'alignement personnel. La RD argent 1.51.1 est validée en jeu. Les tests de cette étape sont reportés.

## Identifiant natif de la RD argent (v1.51.1)

PF1 11.11 utilise `alchemicalSilver` comme critère de RD ; PF1AE le traite désormais comme `silver`, sans modifier les traits natifs. Le diagnostic réel acier / RD 5/alchemicalSilver / 19 dégâts doit donner 14. La v1.50.5 a réussi les 11 scénarios de validation en jeu rapportés ; la correction 1.51.1 reste à valider.

## RD de matériaux en mêlée (v1.51.0)

Premier volet : RD simples d'argent, fer froid et adamantium sur les armes de corps à corps sans munition ; matériau effectif natif et bonus d'altération +3/+4. Le cas acier / RD 5/argent / 12 dégâts doit donner 7. Le moteur conserve la plus forte RD non contournée. Les alignements, RD combinées, munitions, armes naturelles, solidité et provenance d'attaque immuable restent à traiter. Les sources ambiguës et personnalisées restent manuelles. Voir [Damage resolution](docs/DAMAGE-RESOLUTION.md).

## Application native des dégâts (v1.50.5)

Corrige le blocage `invalid-native-total` observé dans PF1 11.11 : le clonage par cible de DamagePartModel via `toObject()` perd le montant évalué hors schéma. PF1AE récupère les montants depuis les DamageRolls déjà évalués de la carte exacte, avec validation de l'index, des types, du bouton, du total et du critique. Aucun dé relancé, aucune modification du moteur de santé.

## Infobulle Foundry v13 (v1.50.4)

Corrige l'attribut natif `data-tooltip-text` utilisé par les jets intégrés dans les cartes PF1 v11.11. Le correctif précédent ciblait l'ancien `data-tooltip`, qui ne remplaçait pas le texte visible au survol dans Foundry v13. Vérification complémentaire sur les ancres de dégâts finalisées avant le rendu de la carte. Aucun changement de calcul, de sérialisation, de bouton ou de visibilité des jets. Les nouvelles cartes bénéficient du correctif.

## Présentation du multiplicateur (v1.50.3)

Le calcul validé en 1.50.2 est conservé. Dans l'infobulle des jets de dégâts PF1, le terme d'ajustement est remplacé visuellement par `(formule native) × multiplicateur = résultat`, avec indication séparée de l'arrondi global réparti entre les types. Les dés, bonus natifs, critiques, données du jet sérialisé et application des dégâts restent inchangés. Champ vide ou 1 : aucune modification d'affichage.

## Correctif des termes de dégâts (v1.50.2)

Foundry v13 crée les OperatorTerm statiques déjà évalués et immuables. PF1AE ne les évalue plus une seconde fois ; même protection pour NumericTerm. En cas d'autre incompatibilité, journal et notification explicites au lieu d'une interruption silencieuse. Les champs vide et 1 restent natifs.

## Multiplicateur neutre (v1.50.1)

Le champ de multiplicateur est vide par défaut (indication 1). Vide, invalide ou égal à 1 : aucun champ de multiplicateur n'est transmis dans le formulaire natif, aucun état de multiplication n'est conservé et les jets natifs sont laissés intacts, sans reconstruction ni terme ajouté. Les valeurs explicites différentes de 1 restent actives. Les règles indépendantes de combat sous l'eau continuent de s'appliquer.

## Multiplicateur de dégâts et défenses simples (v1.50.0)

Le multiplicateur de PF1AE remplaçant celui de Roll Bonuses est lu après la soumission native du formulaire, avec 1 par défaut, et conservé pendant les rafraîchissements du même dialogue. Les jets natifs complets (Force, altération, bonus circonstanciels, critique, etc.) sont multipliés après leur résolution, en conservant les dés et les types. L'arrondi porte sur le total, réparti entre les composantes. Les jets suivants sans multiplicateur reviennent à 1. La nouvelle option **Calcul automatique des défenses contre les dégâts** (désactivée par défaut) traite les défenses simples de PF1 lors de l'application directe d'une carte de dégâts typée ; Automate Damage doit être désactivé pour la tester. La fenêtre native d'application reste inchangée. Aucun double calcul, aucune nouvelle application directe des PV. Les cas complexes nécessitent un arbitrage ; voir [Damage resolution](docs/DAMAGE-RESOLUTION.md).

## Conditions génériques (v1.49.0)

Le registre PF1 reçoit six états supplémentaires compatibles avec les identifiants Improved Conditions. Fasciné applique −4 à Perception via le registre natif ; les cinq autres états sont des marqueurs dans ce jalon, sans automatisation de dégâts, niveaux négatifs ou déplacement. `api.conditions` déclare des conditions personnalisées persistantes (MJ, rechargement requis), applique/retire des ActiveEffects par source d'objet, prolonge leurs minuteries et expose leurs sources. Les états appartenant aux pistes natives restent hors de l'API d'application pour préserver leurs règles. Approbation MJ par objet/état pour application sur un acteur non possédé, sans code distant. Les Script Calls restent responsables des aptitudes. Voir [Conditions](docs/CONDITIONS.md).

## Validation automatique du moteur de santé (v1.48.2)

La macro de diagnostic n'est plus un prérequis manuel. Le MJ élu vérifie automatiquement la provenance native au démarrage ou à l'activation si aucune preuve compatible n'est enregistrée. Les preuves valides de la v1.46.3, 1.47.0, 1.48.0 et 1.48.1 sont migrées pour le même environnement. La preuve dépend désormais du build Foundry, du système/version PF1 et de la révision du contrat natif, pas de la version générale du module. Un changement de build compatible déclenche un nouveau test automatique. Les versions non prises en charge (PF1 autre que 11.11 ou Foundry hors v13) et Improved Conditions actif restent bloquants, avec avertissement MJ. Aucun changement de règles de santé ; macro de diagnostic conservée, exécutable lorsque le moteur est inactif ou au repos. Voir la documentation.

## Test de stabilisation sur clic (v1.48.1)

Le début du tour d'un acteur mourant crée une carte de chat de test de Constitution DD 10, visible du MJ et des propriétaires. Le jet natif n'est lancé qu'après clic autorisé, par le MJ élu, avec le malus de PV négatifs au moment du clic. Reçu persistant par acteur/combattant/round, carte à usage unique ; fin du tour, stabilisation ou mort rendent le bouton périmé. Aucun jet manqué n'est automatiquement rejoué ; arbitrage MJ si le tour est passé. Les dégâts continus identifiés conservent leur échec automatique sans jet. Aucun paramètre supplémentaire.

## Événement générique de santé (v1.48.0)

Le moteur ne contient aucune logique de classe, race, don ou aptitude particulière. Les Script Calls natifs `Après utilisation` nommés `PF1AE:health:changed` sont exécutés par le MJ élu après une variation réelle des PV, avant la réconciliation des états. Le contexte `event` expose les PV avant/après, les franchissements de seuils et le contexte de combat non ambigu ; `event.register()` et `event.unregister()` préparent des exceptions limitées à l'objet appelant. Les écritures sont validées après exécution du script. Le hook public `pf1aeHealthChanged` notifie la transition après réconciliation. Aucun traitement spécifique ni script d'aptitude livré. Mort non neutralisable. Approbation native/Trusted Table requise pour objets d'acteurs joueurs. Les libellés de paramètres ne portent plus la mention alpha.

## Agonie, stabilisation et actions éprouvantes (v1.47.0)

Deux options expérimentales indépendantes, désactivées par défaut, exigent le moteur de santé natif validé par le diagnostic. Test de Constitution DD 10 au début du tour, malus égal aux PV négatifs, 20 naturel réussi, échec automatique en présence de dégâts continus identifiés (un saignement PF1AE intégralement neutralisé ne suffit pas). Reçus persistants par combattant et round, perte directe de 1 PV (pas de RD, résistance ou PV temporaires). Soins effectifs stabilisant à PV négatifs et nouvelle perte de PV relançant l'agonie. Actions simples/attaques et actions complexes effectivement résolues : coût de 1 PV pour un acteur conscient hors de combat, sauf soins réels ; les cartes de soins différées et actions ambiguës restent à arbitrer. Les restrictions d'économie d'actions, récupération horaire et aptitudes particulières restent à venir. Voir la documentation de santé.

## Conditions de santé natives sans objets Buff (v1.46.3)

Le fournisseur expérimental utilise désormais des ActiveEffects directement attachés à l'acteur, construits comme les conditions PF1 natives et identifiés par des flags internes. Un seul effet automatique par condition primaire, même avec des causes létales/non létales simultanées. Les anciens Buffs techniques vérifiés sont migrés/nettoyés ; les filtres du HUD et du panneau DOM sont retirés. Une adaptation strictement ciblée de `ActorPF.setConditions` protège les contributions automatiques des appels indépendants en cas de collision ; les autres appels restent natifs. Les notifications `pf1ToggleActorCondition` reflètent les transitions réelles, notamment après guérison. Le nouveau diagnostic natif est obligatoire avant activation ; ne pas effacer d'états anciens d'origine inconnue.

## Panneau latéral : doublons d'états (v1.46.2)

Compatibilité avec les panneaux affichant séparément `.buff-list.buffs` et `.buff-list.conditions` : masque uniquement la ligne buff technique lorsque sa condition native primaire est présente et référence exactement le même ActiveEffect et le même acteur. Ne modifie ni les effets ni les autres buffs. Le panneau tiers est reconnu par sa structure HTML observée ; aucune dépendance à un nom traduit. Diagnostic de provenance à relancer après mise à jour.

## Présentation native des états de santé (v1.46.1)

Les buffs techniques restent des sources distinctes, mais leurs boutons supplémentaires sont masqués dans le HUD PF1. Les libellés utilisent le nom natif de l'état, sans préfixe PF1AE ; les doublons d'icône identique provenant des sources techniques sont filtrés, sans toucher aux autres buffs ou aux états indépendants. Les porteurs existants sont renommés lors de la réconciliation. Aucun changement de règles de santé ; refaire le diagnostic de provenance avant réactivation.

## Health Conditions — socle expérimental (1.46.0)

Nouveau service **`api.healthConditions`** : exceptions persistantes par UUID d'acteur, UUID d'objet et clé, séparation des contributions de PV létaux/non létaux, états natifs portés par des buffs dédiés, et mort officielle non neutralisable. Désactivé par défaut ; exige PF1 11.11, Foundry 13, Improved Conditions désactivé et un diagnostic de provenance réussi sur des acteurs temporaires liés/non liés. Ne retire jamais les états directs d'origine inconnue. Les actions éprouvantes, la stabilisation automatique et les scripts complets Férocité orque restent hors de ce premier jalon. Voir [documentation API, procédure de diagnostic et limites](docs/HEALTH-CONDITIONS.md).

## État natif Mort ⇄ combattant Vaincu (v1.45.0)

Dans les rencontres Foundry, l'ajout de l'état natif PF1 **Mort** à un token marque automatiquement son combattant **Vaincu**. Retirer **Mort** retire également **Vaincu**. Inversement, basculer **Vaincu** dans le suivi des rencontres ajoute ou retire l'état PF1 **Mort** sur le token.

- Le **MJ élu** effectue les mises à jour ; le service n'agit que sur les combattants possédant un token et un acteur.
- Les modifications utilisent les méthodes natives `Actor.toggleStatusEffect()` et `Combatant.update()`, sans modifier les PV ni créer d'effet personnalisé.
- Le statut natif `dead` / `pf1_dead` doit exister dans `CONFIG.statusEffects`; aucun effet de substitution n'est inventé.
- La synchronisation s'applique aux combattants partageant le même acteur, puisque les états natifs sont attachés à cet acteur.
- Le service n'automatise **pas** la mort par les PV à 0 (PF1 distingue notamment mourant, inconscient et mort).
- API de diagnostic : `game.modules.get("pf1-automation-engine").api.deathDefeated` (`isAvailable()`, `statusId()`, `isDead(actor)`, `reconcileActor(actor)`).

Tests automatisés (55 suites maintenues) et scénarios natifs simulés. Tester aussi dans Foundry avec un MJ connecté et un joueur propriétaire du token.



## Correction du dialogue d'utilisation par action (v1.44.1)

L'option `actionOptions.getSkipDialog(item, actionId)` est maintenant appliquée au début de `pf1.actionUse.ActionUse.prototype.process()`, après la sélection effective de l'action. C'est le point où PF1 11.11 consomme le paramètre natif `skipDialog`. La version 1.44.0 pouvait encore afficher le dialogue lorsque le hook `pf1CreateActionUse` n'arrivait pas à neutraliser le dialogue à temps. Les appels natifs, la consommation des ressources, les scripts et les cartes de chat ne sont pas réimplémentés. `libWrapper` est utilisé lorsqu'il est présent, sinon une enveloppe directe est installée.



## Ignorer le dialogue d'utilisation pour chaque action (v1.44.0)

Chaque action d'un objet PF1 dispose d'une case **Ignorer le dialogue** à la fin de son onglet **Utilisation**. Le sélecteur d'action native reste visible lorsque plusieurs actions existent. L'option ne masque que la fenêtre de configuration native de l'action sélectionnée, sans modifier les dialogues personnalisés, les jets, les charges, les Script Calls ni les cartes de chat. La préférence est enregistrée sous `flags.pf1-automation-engine.actionSkipDialog`, par identifiant d'action, et migrée rétrocompatiblement depuis `defaultActionSkipDialog`. Le sélecteur d'**Action par défaut** reste dans l'onglet Avancé, sans autre option de dialogue concurrente.

API publique : `api.actionOptions.getSkipDialog(item, actionId)`, `setSkipDialog(item, actionId, enabled)` et `isAvailable()`. Les anciennes méthodes `api.defaultAction.getSkipDialog()` et `setSkipDialog()` restent disponibles. [Documentation détaillée](docs/action-options.md).



## Correctif socket multijoueur Foundry (v1.43.1)

Le manifeste du module déclare désormais `"socket": true` pour activer le canal natif `module.pf1-automation-engine`. Cette correction permet aux requêtes des joueurs d'atteindre le MJ élu, notamment dans `api.effectGroups.approveTemplate()`, `applyGroup()`, `extendGroup()` et `stopGroup()`. Les autres sous-services partageant ce canal bénéficient de la même déclaration. **Redémarrer entièrement le serveur Foundry après installation** : F5 seul ne suffit pas. Les autorisations OWNER, la sélection du MJ élu et les scripts de barde restent inchangés. La suite de tests simule déjà deux clients et le chemin de réponse socket ; vérifier ensuite le fonctionnement sur votre serveur réel.



## Auras passives et bonus conditionnels de sauvegarde (v1.43.0)

Le moteur `api.proximityAuras` peut désormais enregistrer des auras **passives permanentes**, sans durée, et des bonus typés qui ne s'appliquent que lorsqu'un jet natif PF1 concerne un descripteur structuré précis. L'intégration se fait dans `pf1PreActorRollSave`, sans second jet ni changement permanent de sauvegarde. La contribution est calculée par différence avec les bonus typés natifs quand leur provenance est vérifiable ; en l'absence d'information suffisante, le moteur refuse une application incertaine. L'aura se suspend sur les états natifs `unconscious`, `dead` et `pf1_sleep`, puis redevient active au rétablissement.

Découverte automatique des Script Calls `PF1AE:aura:passive` validés, pour les acteurs et leurs tokens, sans macro d'installation. Aucune règle propre au paladin n'est codée dans le moteur ; l'exemple **Aura de courage** se trouve dans [`examples/aura-of-courage-passive.js`](examples/aura-of-courage-passive.js). Documentation : [`docs/passive-save-auras.md`](docs/passive-save-auras.md). Les auras temporaires, la lumière et Bouclier saint restent disponibles.



## Arme improvisée dans les groupes d'armes (v1.42.1)

L'éditeur natif des armes PF1 11.11 affiche une entrée supplémentaire **Arme improvisée** aux côtés des groupes d'armes. Elle est un **choix virtuel de l'interface**, car `system.weaponGroups` est un ensemble strict de valeurs du système qui ne contient pas `improvised`. Sa sélection enregistre directement et exclusivement la **propriété native** `system.properties.imp = true` ; la désélection la remet à `false`. Le contrôle demeure synchronisé avec la case native de la liste des propriétés d'arme, respecte les permissions et ne modifie jamais les groupes historiques ou le calcul des attaques.



## Auras défensives de proximité persistantes (v1.42.0)

Nouvelle API générique `game.modules.get("pf1-automation-engine").api.proximityAuras` : déclaration d'auras à partir de l'acteur, de son token et de l'objet source, alliés dynamiques, adjacence ou rayon mesuré par Foundry v13, bonus défensifs PF1 typés avec non-cumul natif (notamment les bonus de bouclier), durées persistantes et expiration au compte d'initiative, éclairage indépendant et événements de fin. Aucune logique de classe intégrée au moteur, aucune dépendance obligatoire à un module d'auras.

**Documentation complète** : [`docs/proximity-auras.md`](docs/proximity-auras.md). **Application Bouclier saint** : trois Scripts Calls natifs complets dans [`examples/holy-shield-use.js`](examples/holy-shield-use.js), [`examples/holy-shield-post-use.js`](examples/holy-shield-post-use.js) et [`examples/holy-shield-expired.js`](examples/holy-shield-expired.js).



## Action par défaut : uniquement dans Avancé et à partir de deux actions (v1.41.14)

L'option **Action par défaut** et sa case **Éviter le dialogue** apparaissent désormais **uniquement dans l'onglet Avancé** de la fiche native principale d'un Item PF1 contenant **au moins deux actions**. Elles sont volontairement absentes des objets avec zéro ou une action, de toutes les fenêtres d'édition d'attaque ou d'action individuelle et des fiches sans onglet Avancé. Aucun repli dans Détails/Actions/Description n'est autorisé. Les actions sélectionnées, leurs flags, le moteur de jets PF1 et l'usage des ressources ne changent pas.



## Escalade : perte native du bonus de Dextérité à la CA (v1.41.13)

Lorsque le mode de mouvement d'un token passe à **Escalade** (`movementAction: "climb"`), PF1AE crée sur son acteur un buff natif Pathfinder 1e nommé **Escalade — bonus de Dextérité à la CA perdu**, actif, visible sur le token et utilisant uniquement `system.changeFlags.loseDexToAC = true` : aucune pénalité fixe de −2, aucune baisse de caractéristique, et aucun état `Flat-Footed` ajouté.

Si l'acteur possède une **vitesse d'escalade positive** (`system.attributes.speed.climb.total`), conformément à la règle PF1, il conserve son bonus de Dextérité à la CA et le buff n'est pas appliqué. À la sortie du mode Escalade (sur le dernier token associé à l'acteur), le buff créé par PF1AE est retiré automatiquement. Un changement de vitesse d'escalade pendant l'ascension relance la vérification. Les autres buffs restent intacts.

Les tokens liés partageant un même acteur partagent également sa CA native ; PF1AE ne crée qu'un seul buff par acteur et le conserve tant qu'au moins l'un de ses tokens de la scène active est en mode Escalade. Sur des tokens non liés, le buff reste propre à l'acteur synthétique correspondant.



## Statut natif « Levitating » sur les tokens (v1.41.12)

Le statut PF1 natif **Levitating** appliqué depuis le HUD d'un token synchronise directement le mode de mouvement du TokenDocument en **fly**. Le moteur rapproche désormais les acteurs par leur UUID stable, même si la représentation de l'acteur du token diffère de celle de l'effet. Il réagit aussi aux mises à jour natives de l'acteur et des effets du token en complément des hooks ActiveEffect. Le retrait du dernier effet Levitating restitue le mode natif approprié. Aucun statut Flying ajouté et aucune capacité de vol horizontal créée.



## Lévitation → mode de déplacement Vol (v1.41.11)

Lorsqu'un acteur possède l'état natif **Levitation / Lévitation**, ses tokens utilisent automatiquement `TokenDocument.movementAction = "fly"` (mode **Vol**) dans Foundry. Le synchroniseur accepte les noms natifs anglais/français et identifiants `pf1_levitation` / `pf1_levitating`, prend en compte l'activation/la désactivation/la suppression d'effets, les sources multiples, le rechargement et le changement de scène.

Ceci ne crée **aucun effet Flying supplémentaire**, ne modifie pas les vitesses ni les jets, et ne confond pas les règles de *lévitation* avec le sort *vol* : en Pathfinder 1e, Lévitation permet le déplacement vertical mais pas le vol horizontal autonome. Le choix « Vol » est uniquement une synchronisation de l'indicateur de déplacement du token. Les effets natifs Flying et Swimming existants conservent leur fonctionnement.



## Abri aquatique via PF1 Waters (v1.41.10)

**PF1AE gère les bonus et les interdictions d'attaque.** PF1 Waters fournit uniquement l'état géométrique du token : sa Region, sa hauteur physique et la fraction réellement immergée. PF1AE lit en priorité l'API `game.modules.get("pf1-waters")?.api?.getTokenWaterState(token)`.

Face à un adversaire **situé hors de l'eau** :
- **moins de 50 % d'immersion** : aucun abri aquatique ;
- **de 50 % inclus à moins de 100 %** : **abri supérieur** (`improved`, +8 CA et +4 Réflexes dans les situations applicables) ;
- **100 % d'immersion** : **abri total** (`total`), ce qui bloque les attaques directes depuis la terre.

Le niveau d'abri ne se cumule pas avec celui des murs : PF1AE retient le plus protecteur. La vérification des bonus de CA existants et le traitement de la carte d'attaque native ne changent pas. Le bonus de Réflexes n'est pas appliqué indistinctement à tous les jets : il dépend toujours de la provenance et des protections reconnues par le pont de sauvegarde de PF1AE.

Quand PF1 Waters est désactivé ou son API indisponible, le moteur lit les Regions `flags.pf1-waters.waterRegion` avec un repli sur `flags.pf1-skull-and-shackles.waterRegion`, sans réactiver d'anciennes Regions désormais désactivées. Dans ce mode de secours, il respecte les profondeurs finies et `flags.pf1-waters.physicalHeight`.

Ce changement ne modifie ni la CA native de l'acteur, ni la position du token, ni les scripts des capacités. Les exceptions spécifiques à *liberté de mouvement* et les effets de sorts sans jet d'attaque ne sont pas étendus par cette version ; les cas particuliers restent à arbitrer par le MJ.

## Correction — sélection de l'action par défaut dans les fiches PF1 (v1.41.9)

L'option **Action par défaut** est désormais injectée dans les fiches **ApplicationV2** de Pathfinder 1e (système 11.11), en plus des anciens hooks d'affichage. Le contrôle est visible pour tout Item possédant **au moins une action native** (armes, équipement, dons, sorts, buffs et autres types compatibles) si le propriétaire peut éditer l'objet. PF1AE privilégie l'onglet **Avancé** ; s'il est absent, utilise **Actions**, **Détails**, **Description** ou le contenu de la fiche. L'insertion reste idempotente au rendu.

L'identifiant d'action préféré et l'option **ignorer le dialogue** continuent d'être enregistrés dans les flags existants `defaultActionId` et `defaultActionSkipDialog`. L'exécution continue de déléguer à `ItemPF.use`, sans lancer de second jet ni consommer de ressource supplémentaire. Les objets sans action native n'affichent logiquement pas de sélecteur d'action.



## Événements génériques d'expiration des défenses (v1.41.8)

Lorsqu'un modificateur de `api.defenseModifiers` est effectivement supprimé,
PF1AE produit un événement public `Hooks.callAll("pf1aeDefenseModifierExpired", event)`
après confirmation de l'écriture native sur l'Item source. Le payload inclut
`eventId`, `modifierKey`, `sourceItemUuid`, `defenderUuid`,
`attackerUuid`, `bonusType`, `value`, `reason`,
`reasonProvenance`, `expiredActorUuid` et une copie `modifier`.

Les raisons sont `death` (état PF1 `dead` confirmé), `rest`
(repos natif vérifié par `PF1AE:rest:daily`), `manual` et `other`
(provenance non classifiée). `remove({key,sourceItemUuid,defenderUuid})`
demeure compatible ; une demande `reason:"rest"` sans contexte de repos
authentifié est classée `other`.

Un Script Call natif sur l'Item source, en catégorie **Après Utilisation**,
nommé **`PF1AE:defense:expired`**, peut réagir sans macro ni listener
supplémentaire. En mode sécurisé, il nécessite l'approbation du MJ ;
en mode Table de confiance, son nom exact est autorisé. La suppression
persiste via des reçus sur l'Item, et le MJ élu distribue les événements
même après une mise à jour effectuée par un joueur, au F5 ou à la reconnexion.
Les reçus sont réclamés avant l'exécution pour éviter les doublons :
une fermeture brutale dans cette très courte fenêtre peut faire perdre
la notification plutôt que la rejouer. Aucun jet ni ressource consommée.

Les **trois scripts complets de Bastion du Bien** figurent dans
[EXAMPLES-BASTION-DU-BIEN.md](EXAMPLES-BASTION-DU-BIEN.md) :
activation, nettoyage vérifié au repos et message RP à la mort.
Le moteur reste indépendant de toute classe ou capacité particulière.



## Abri directionnel temporaire et pavois (v1.41.7)

Nouveau service générique `api.directionalCover` : enregistrement d'un bord protégé sur un Item source et un token précis, abris partiel/normal/amélioré/total, géométrie prudente par rayons depuis les cases occupées, expiration au début du prochain tour, nettoyage par le MJ élu et contrôles OWNER/MJ. Les protections suivent automatiquement les positions des tokens, sans `WallDocument`. Le moteur d'abris `api.coverPF1.inspect()` intègre ces protections ; son garde `cover-native-bridge.js` annule avant le jet les attaques directes avec abri total confirmé.

Les cas diagonaux mixtes et les situations 3D non prouvées restent indéterminés. Les sorts ciblés sans jet d'attaque, zones et effets d'étendue ne sont pas interceptés. Aucun changement à la CA native, aux dégâts, aux munitions ou aux bonus de Réflexes.

L'exemple de **Grant Total Cover** avec la boîte de dialogue à quatre directions et son Script Call natif complet est documenté dans [DIRECTIONAL-COVER.md](DIRECTIONAL-COVER.md). Le moteur ne contient aucune règle ni aucun nom propres au pavois.


## Défenses conditionnelles typées, fin permanente à la mort et Script Call de repos (v1.41.6)

Le service de provenance PF1 `api.nativeCover.inspectTypes({actor,defense,types})` lit les sources de la CA native via `getSourceDetails` pour les bonus typés, notamment **parade / deflection**. Le résultat permet à `api.attackResolution` de remplacer le bonus natif non cumulable par le meilleur bonus conditionnel applicable (par exemple CA 22 avec parade native +2 et Bastion du Bien +4 → CA effective 24 contre sa seule cible). Les sources ambiguës restent `uncertain` : aucun ajustement supposé et aucune mutation de la fiche.

Les modificateurs `expiresOnDeathOf` sont désormais **supprimés définitivement** des flags de l'objet source quand le statut PF1 `dead` de l'ennemi est confirmé ; zéro PV sans état mort ne suffit pas. Une réapparition de l'ennemi ne restaure pas le bonus.

Le Script Call natif nommé exactement **`PF1AE:rest:daily`**, de catégorie **Après Utilisation / `postUse`**, est découvert automatiquement parmi les objets de l'acteur et exécuté une fois par événement natif `pf1ActorRest` restaurant les utilisations quotidiennes. Il reçoit `event.type`, `event.actorUuid` et `event.rest` (avec `id`, `restoreDailyUses`, `before`, `after`, `nativeUpdates`). Le MJ élu exécute uniquement le code source natif de l'objet, après validation des approbations. En mode Table de confiance, ce nom exact bénéficie du même mécanisme de confiance que les abonnements PF1AE existants. Aucun abonnement manuel ni consommation de charges supplémentaire.

Les **deux Script Calls complets de Bastion du Bien** et leur configuration sont dans [EXAMPLES-BASTION-DU-BIEN.md](EXAMPLES-BASTION-DU-BIEN.md). Les règles spécifiques du paladin restent dans ces scripts ; les dégâts des alliés restent appliqués manuellement.



## Armes improvisées : propriété native PF1 dans la fiche d'arme (v1.41.5)

PF1AE présente désormais la propriété **Improvised Weapon / Arme improvisée** dans l'onglet **Statistiques / Details** des fiches d'Items de type `weapon` de PF1 v11.11. Le système PF1 utilise un `TypeDataField(BooleanField)` pour `system.properties`, et `imp` est une clé de `pf1.config.weaponProperties`. La fiche native inclut déjà une case nommée `system.properties.imp` dans « Propriétés de l'arme ». PF1AE **réutilise ce contrôle natif** et remplace uniquement son libellé par une version explicite assortie d'une aide contextuelle ; si une autre présentation de la fiche omet la case, PF1AE l'insère une seule fois.

Le mécanisme **n'enregistre aucun flag PF1AE** et n'a aucun listener d'écriture direct : il s'appuie sur le formulaire `submitOnChange` de la fiche PF1 pour sauvegarder `item.system.properties.imp` comme booléen natif. L'utilisateur peut modifier cette valeur uniquement lorsqu'il dispose des permissions d'édition de l'Item ; les autres utilisateurs voient une case désactivée. Les fiches d'armes indépendantes ou appartenant à un Actor fonctionnent de la même manière. Les autres types d'Items ne sont jamais modifiés. Les libellés français et anglais sont dans les locales PF1AE, avec chargement de `lang/en.json` en fallback pour les autres langues.

**Fonctionnalité purement déclarative :** aucun malus de −4, critique 20/×2, portée de lancer, don ou autre effet mécanique lié aux armes improvisées n'est automatisé ici. Les Script Calls peuvent consulter directement `item.system.properties.imp === true`. L'architecture utilise un service isolé `scripts/weapon-properties-ui.js` et le hook ApplicationV2 `renderApplication`, approprié à la fiche `WeaponSheetPF` de PF1 v11.11.


## Combat au corps à corps sous l'eau et multiplicateur de dégâts natif (v1.41.4)

PF1AE ajoute un service de **combat sous l'eau** à côté de l'automatisation existante des tirs à distance et des abris aquatiques. L'acteur doit être immergé, d'après l'API `waterAutomation.getState` de Skull & Shackles (ou le flag `flags.world.underwater` si l'API n'est pas disponible), et effectuer une attaque de corps à corps physique dont le type principal est clairement tranchant ou contondant.

- **Attaque tranchante/contondante sous l'eau** : **−2 au jet d'attaque** (étiquette « Combat sous l’eau ») et **dégâts physiques ×0,5**, arrondis à l'inférieur, avant le lancer natif PF1.
- **Attaque perforante** : aucun malus automatique ; les armes à types mixtes ou sans typage fiable sont laissées à l'arbitrage du MJ plutôt que d'appliquer une mauvaise pénalité.
- **Liberté de mouvement** : aucun malus aquatique automatique lorsque l'effet est identifiable sur l'acteur. Les circonstances particulières (déséquilibre, certains dons, attaquer avec une arme spécifiquement adaptée) restent sous contrôle MJ.
- **Dégâts non physiques (énergie)** : les lignes distinctement typées ne sont pas réduites par l'immersion.
- Les dés de l'arme et leurs bonus natifs sont réunis **avant** multiplication et arrondi afin d'obtenir, par exemple, `floor((1d8 + 4) * 0.5)`, au lieu de `floor(1d8 / 2) + 4`. Cela se fait dans `pf1PreDamageRoll`, pas après l'application des dégâts.

Le dialogue de lancer d'attaque PF1 contient maintenant **Multiplicateur de dégâts** (valeur par défaut **1**, accepte **0,5**, **2**, **3**, etc., jusqu'à **10**). Le résultat est appliqué aux parties de dégâts natives lors du lancer, y compris en cas de critique. Si le module **Roll Bonuses PF1** est encore actif, PF1AE désactive uniquement son ancien champ « Damage Multiplier » et ignore sa valeur de formulaire pour éviter le doublement. Les autres fonctionnalités de Roll Bonuses **ne sont pas encore migrées** : ne désactive pas ce module tant qu'elles te sont nécessaires. Une migration complète des différents types de bonus et des fonctions spéciales devra être réalisée séparément.

Deux paramètres de monde permettent d'activer/désactiver indépendamment les **malus de mêlée sous l'eau** et le **multiplicateur natif**. L'automatisation ne modifie aucun objet, effet persistant, CA ou points de vie. Le module est conçu pour Foundry VTT 13 / PF1 11.11.

## Synchronisation des modes de déplacement et états natifs PF1 (v1.41.3)

Foundry VTT v13 stocke le mode de déplacement sélectionné dans `TokenDocument.movementAction`. PF1 v11.11 gère ses conditions natives via la liste des états et `Actor.toggleStatusEffect()`. PF1AE synchronise maintenant **dans les deux sens** :

- **Effet natif PF1 « Vol » / « Flying » appliqué ou réactivé** → les tokens de l'acteur sur la scène passent en déplacement `fly`.
- **Effet « Nager » / « Swimming » appliqué ou réactivé** → déplacement `swim`.
- **Effet retiré ou désactivé** → retour à `walk` (ou à l'autre état de déplacement s'il est toujours présent).
- **Sélection du mouvement `fly` ou `swim` sur le token** → activation de l'état natif PF1 correspondant, et désactivation de l'autre. Un retour au mode `walk` désactive les deux états.
- L'état appartient à l'**Actor** (dans les règles PF1 du moteur). Si plusieurs tokens de cet acteur sont présents dans la même scène, le mode de mouvement est harmonisé entre eux.

Le module résout les identifiants de **vrais états natifs** depuis `CONFIG.statusEffects` (noms anglais/français), et ne crée pas d'effet personnalisé ou de capacité de déplacement. Si un état natif n'est pas disponible, il ne fabrique rien. La synchronisation n'accorde **aucune nouvelle vitesse** de vol ou de nage : elle concerne uniquement le mode de déplacement sélectionné et l'état actif sur le token.

Les événements `createActiveEffect`, `updateActiveEffect`, `deleteActiveEffect` et `updateToken` assurent la synchronisation, avec des garde-fous contre les boucles et l'exécution simultanée sur plusieurs clients. Lorsqu'un MJ est connecté, la mise à jour est effectuée uniquement par le MJ actif. Le module reste compatible avec les autres automatismes, notamment Skull & Shackles et les abris aquatiques.

## Historique — abri aquatique d'après les anciennes régions Skull & Shackles (v1.41.2)

**Ce correctif remplace entièrement le bonus automatique d'abri mou de v1.40.11.** Le flag `flags.world.underwater` indique que la base du token est sous l'eau, mais ne suffit pas à déterminer son degré d'immersion ni à accorder un abri.

PF1AE lit la région Skull & Shackles sur la scène :
- `flags["pf1-skull-and-shackles"].waterRegion.enabled === true`
- `flags["pf1-skull-and-shackles"].waterRegion.surface` (niveau de surface dans l'unité d'élévation de la scène)
- l'altitude de la **base** du token (`TokenDocument.elevation`) et sa hauteur de corps, estimée selon son empreinte (`max(width,height) × scene.grid.distance`).
- `RegionDocument.testPoint()` au **centre horizontal du token**, en utilisant l'élévation de la région, comme Skull & Shackles.

**Attaquant non immergé → cible dans la région :**
- si `base > surface - hauteur/2`, **aucun abri aquatique** ;
- si `surface - hauteur < base <= surface - hauteur/2`, **abri supérieur : +8 CA / +4 Réflexes** ;
- si `base <= surface - hauteur`, **abri total**, l'attaque directe est annulée.

Les seuils sont **inclusifs**. Exemple avec `surface = 0` et une créature de taille M représentée par 1×1 case sur grille de **1,50 m** : à **−0,75 m**, abri supérieur ; à **−1,50 m**, abri total. La même logique s'applique dans les scènes mesurées en pieds (1×1 / 5 ft : −2,5 ft, −5 ft), et aux autres niveaux de surface.

Le bonus aquatique **ne se cumule pas** avec un abri dû à un mur. Un attaquant lui-même sous la surface de l'eau ne donne aucun abri aquatique supplémentaire à une cible immergée. Les régions d'eau reconnues ne sont pas considérées comme des murs solides pour la géométrie 3D ; les régions inconnues restent indéterminées. L'abri normal, partiel, supérieur et total géométrique est conservé ; l'abri supérieur aquatique remplace un abri inférieur, l'abri total bloque l'attaque. Les diagnostics conservent la région et la profondeur. Une cible hors de la région ne reçoit aucun bonus aquatique, même avec un ancien flag `underwater=true`.

La vignette d'attaque native PF1 affiche le libellé existant « **Abri supérieur / +8 CA** » ou signale l'impossibilité d'une attaque directe en cas d'abri total. Les autres automatismes de **tir à travers l'eau**, y compris les malus en fonction de la distance immergée, ne changent pas. Les attaques d'opportunité restent manuelles.

## Tirs à travers l’eau

Avec **PF1 — Skull & Shackles v1.23.1+**, PF1AE mesure la portion du trajet d’un projectile située sous l’eau et applique automatiquement **–2 au jet d’attaque par tranche de 1,50 m / 5 ft d’eau traversée**.

Le calcul est effectué avant le jet natif PF1 et s’additionne aux malus de portée existants. Les élévations Foundry/Levels sont prises en compte. Les armes de jet sont exclues de ce calcul, car les règles PF1 les rendent inefficaces sous l’eau.

**Version 1.41.2 (experimental prerelease) · Foundry VTT 13.351 · Pathfinder 1e (PF1) 11.11**

Generic, rules-neutral automation services for native PF1 Item Script Calls. This module does not ship standalone example character scripts; abilities remain configured on their Foundry Items.

## Ranged attacks: target-border wall lines count as cover (v1.40.10)

Fix for a ranged-attack screenshot in which a wall starts at the top-left corner of the target and runs down its **left square border**. The attacker may select the most favorable corner, but **all four lines from that single chosen corner to the target's four corners must be considered**. A ray ending on a target corner strictly **inside an actual wall segment aligned to the target-square border** is a proven wall obstruction, even though the generic segment test labels an endpoint contact "ambiguous". Previously such a red ray was mistaken for a harmless wall-endpoint graze and a clear attacker angle could incorrectly result in zero cover.

The new **target-border contact** test is restricted to proper, positive-length wall segments coincident with a target boundary. Merely touching a loose wall tip, a zero-length wall, or a wall elsewhere in the scene does not count as proven wall cover. Native open doors are still nonblocking, reverse segment orientation is equivalent, and 3D checks still respect wall height. The existing rule for a **strictly greater than 50% visible** target silhouette controls whether ordinary confirmed cover is **partial (+2 CA)** or **normal (+4 CA)**. In the reproduced red/green ray geometry, the result is **normal +4 AC / +2 relevant Reflex**, displayed in the compact bilingual PF1 attack card.

## Diagonal wall endpoint: normal cover at 50% or less exposure (v1.40.9)

The 9×9 target-silhouette visibility estimator now **counts rays grazing a wall endpoint as uncertain**, instead of automatically calling them clear. In the southwest-melee-attacker / northeast-target screenshot case, the wall starts at their shared diagonal corner. Its endpoint-grazing rays must not artificially push visibility above the PF1 **strictly more than 50%** threshold. When the attacker cannot *verify* that more than half is exposed, ordinary wall cover stays **normal (+4 AC / +2 relevant Reflex)** rather than becoming partial (+2/+1). The rule also holds in 3D, preserving the grid-based full token height and center-of-attacker visibility origin.

The native target-card note for **normal cover** is now more compact: French **Abri** on the first line and **+4 CA** on the second; English (and every other Foundry locale) **Cover** then **+4 AC**. Special cover labels (partial, improved, soft, total) are unchanged, as is the rightmost compact card layout.

## Fix: direction-independent melee adjacency near a diagonal wall corner (v1.40.8)

PF1AE now computes the distance between the **occupied rectangles** of attacker and target using the correct left/right and top/bottom boundaries. Previously the wrong top/left boundary could classify an enemy diagonally adjacent to the **northeast of a southwest attacker** as **nonadjacent**, incorrectly invoking the *reach/ranged best-corner* cover rule. This caused a missing cover bonus in the native card even if a solid wall blocked some melee corner rays.

Adjacent melee now behaves symmetrically in all eight neighboring directions (including diagonal adjacency); a diagonal wall starting at the common corner and extending behind the attacker gives the appropriate partial/normal wall cover, and nonadjacent melee retains reach/ranged treatment. The fix does not alter native target-card styling, AC provenance, Actor AC, or manual attacks of opportunity.

## Pathfinder 1 melee cover and reach attacks (v1.40.7)

- **Adjacent melee attacks** (`mwak`, `msak`): use the Pathfinder 1 rule that *any* blocking wall ray drawn from *any* attacker-square corner to a corner of the defender's square establishes cover. Unlike ranged combat, the attacker cannot select one clear corner to negate a wall crossing from another. A creature between attacker and target does **not** give soft cover for adjacent melee.
- **Nonadjacent melee (reach weapons or natural reach):** use the ranged-cover corner-selection rule, including **soft cover +4 AC / +0 Reflex** from intervening creatures. The geometry engine determines adjacency from occupied squares, not from the weapon's label.
- **Large or larger melee creatures:** select an adjacent occupied attacker square and an adjacent target square that give the attacker the least cover, in accordance with PF1's special rule. Each square pair is evaluated with the normal adjacent melee corner rule; uncertain pairs are not guessed. This applies to both attacker and target being large; 3D body visibility still respects the original target's grid-footprint height.
- **Shared-border walls and doors:** a wall lying precisely on the common boundary between two adjacent squares is no longer dismissed as mere grazing. A full opaque wall / closed or locked door in 2D grants **total cover** and blocks a direct attack; an open door does not. In 3D a wall must span the attacker's source height and the whole target volume to confirm full shared-edge obstruction. Short and partial walls retain the usual categories.
- **Low wall proximity:** if both adjacent creatures are equally far from a low obstacle, neither may ignore it merely for being equally close; Pathfinder 1 only allows ignoring low cover when the attacker is **closer**.
- All existing **partial (+2 AC), normal (+4), improved (+8)** categories, windows, center-based visible-majority calculation, and compact bilingual native target-card label are retained. Total cover still aborts a direct attack before resolution. Actor CA is never permanently changed.

**Limits:** This updates the geometry and native attack-card processing. It does not currently intercept every system-generated *attack of opportunity* workflow; although Pathfinder 1 does not allow an AoO against a creature with cover relative to the attacker, that restriction still requires the corresponding native AoO event to be identifiable before PF1AE can cancel it automatically. Nonstandard combat maneuvers remain outside this melee attack bridge.

## Compact two-line cover label at right of native PF1 target (v1.40.6)

The cover indicator is now **the rightmost content within the existing native target row**, after the portrait and AC shield values, instead of appearing at the left. The two lines are **left-aligned inside the note**: `Abri partiel` / `+2 CA` in French; `Partial cover` / `+2 AC` in English. Normal, soft and improved cover labels use the same layout. Total cover displays only its name. The note is a regular flex item—not absolutely positioned over the token portrait or defense values—so it can use a compact width and will not cover native controls. Rerenders remain idempotent; no extra ChatMessage or Actor mutations occur.

## Compact, bilingual cover label inside native PF1 attack cards (v1.40.5)

On a confirmed single-target attack, the existing **native PF1 target thumbnail** now receives one small inline label with the diagnosed cover grade and AC bonus. It is placed inside the original attack card (no additional ChatMessage, separate PF1AE footer, or second roll). Examples:

- If Foundry language is French (`game.i18n.lang === "fr"`): **Abri partiel : +2 CA**, **Abri : +4 CA**, **Abri mou : +4 CA**, **Abri supérieur : +8 CA**.
- For English or **any other** Foundry language: **Partial cover : +2 AC**, **Cover : +4 AC**, **Soft cover : +4 AC**, **Improved cover : +8 AC**.
- If a pre-existing card is diagnosed as fully blocked, the label reads **Abri total** / **Total cover**, without an invented numeric AC bonus; native pre-attack cancellation still prevents a new total-cover direct attack.

The note is based on a **confirmed** cover diagnosis and does not assume that its displayed bonus was newly added to actor AC. It is still present if native AC source provenance is too ambiguous to safely replace a shield value. It is inserted only for the first attack summary of a full-attack action and is **idempotent** on later hooks or chat re-renders; previously stored native card content is updated, without changing Actor values, roll results or hit/miss resolution. Uncertain cover is not labeled with a guessed bonus.

## Visibility percentage measured from attacker's token center (v1.40.4)

The optional Pathfinder 1e **more-than-half-visible** reduction now measures the target's exposed occupied silhouette from the **horizontal center of the attacking token**, matching Foundry's usual map token-vision origin. Every 2D sample and every 3D vertical-body sample uses exactly this same center point (`(x+x2)/2, (y+y2)/2`). The attacker’s 3D sight/LOS height remains the observer elevation; target body height still follows the grid-footprint house rule.

**Important distinction:** PF1's native attack-corner rays still determine the legal attack angle, solid-wall total cover, reach behavior and other obstructions. They do **not** choose a different viewpoint for the 50% visible-area assessment. The new diagnostic `origins[].visibility.sourcePoint` identifies the center used, `source` is `attacker-token-center`, and the visible fraction is shared across eligible origins. No Actor AC is permanently changed.

This is a deterministic geometric approximation of Foundry's map visibility, **not** a readback of Foundry's rendered fog-of-war or sight polygon (which can involve extra module-specific settings and lights). It uses PF1AE's verified wall collision model, preserves uncertain collision handling, and does not classify native windows or soft cover by the generic majority rule.

## 3D token body height and closed-door cover (v1.40.3)

**House rule:** the target body occupies the same number of grid cells vertically as its larger horizontal footprint dimension. A 1×1 token on a 1.5 m grid is 1.5 m tall; a 2×2 token is 3 m tall. On a 5 ft grid these heights are 5 ft and 10 ft. The target's LOS-eye height is no longer mistaken for its full body height.

The 3D more-than-half-visible rule samples this full occupied body volume. A wall crossing the four native corner rays does not establish **total cover** unless its obstruction also spans all sampled body heights. Without trustworthy scene grid distance or wall geometry, PF1AE does not claim 3D total cover.

**Foundry doors:** Closed and locked doors are **ordinary solid walls** for cover, even if their sight/light settings or obsolete custom grade resemble a window. Open doors do not block. All standard 2D and 3D wall/height rules (including partial cover) apply to closed doors. Invalid/unknown door states remain uncertain. Nothing modifies the native door document.

## Partial cover when more than half the target is exposed (v1.40.2)

Under Pathfinder 1e, cover reduces to **partial cover (+2 AC / +1 relevant Reflex)** when **strictly more than half of the target remains visible**. The existing PF1 corner-ray test still establishes whether cover exists, selects the best attacker origin, and proves total cover before this new calculation runs.

For **ordinary wall cover only**, PF1AE now estimates the visible fraction of the target's occupied silhouette using a fixed 9×9 interior grid from each available attacker corner. In 3D it also samples five elevations between the target token's ground elevation and its reported LOS height, tracing obstructions at each sample's actual wall-crossing height. When more samples are unobstructed than blocked, confirmed **normal wall cover** is reduced to **partial**, with a diagnostic `origins[].visibility` containing `visibleFraction`, `visibleSamples` and `blockedSamples`. A fraction of **50% or less** retains normal cover.

**Important limitation:** Foundry does not expose a trustworthy anatomical visible-area percentage. In 2D the target's occupied grid rectangle is a body silhouette *proxy*; in 3D the reported LOS height provides an approximate vertical extent, not the model's true physical height. This is deterministic and testable, but cannot measure artwork pixels or actual anatomy. The GM can still explicitly classify an obstacle using `coverPF1.setWallGrade` when the rendered creature differs materially from its token footprint.

This does **not** downgrade total cover, creature-provided soft cover, windows/improved cover, explicitly classified partial/improved walls, or the separately defined size-dependent low-wall rule. Unknown collision geometry remains conservative; missing height data does not invent a visibility percentage. Actor AC is unchanged, and only the native target thumbnail displays the attack-specific adjustment.

## Opaque 2D walls, windows and low 3D obstacles (v1.40.1)

- **2D standard walls:** an ordinary wall has no finite height in the 2D model; every strictly crossed corner ray is considered solid. If *all* rays are blocked, the target has **total cover** and the native direct attack is cancelled. A shorter wall segment that blocks only some rays still grants normal cover +4 by the existing best-angle rule. A mere endpoint graze is not a proven wall crossing.
- **Native Foundry windows:** movement-blocking walls with explicitly unrestricted **sight and light** are treated as windows, giving **improved cover +8 AC / +4 qualifying Reflex** when a valid line crosses the segment. If the attacker occupies a square immediately adjacent to that window, the window supplies **no cover** (other intervening walls still count). Native window and an invisible movement-blocking wall with identical sense settings cannot be distinguished; use a regular wall or explicit cover grade when they should behave differently. A GM may explicitly classify a wall as `window` with `coverPF1.setWallGrade(wall.document, "window")`.
- **3D low walls:** a wall whose known `wall-height` upper and lower bounds form a height strictly **less than 3 ft** (feet scenes), or **less than 1 m** (metric scenes), grants **partial cover +2 AC / +1 qualifying Reflex** to a **Medium** target or **normal cover +4 AC / +2 qualifying Reflex** to a **Small** target when its projected corner rays intersect. The wall bottom must be at the target's elevation, the target must be within six squares (30 ft in a standard five-foot grid), and the attacker must be farther from the wall than the target. Unknown size/units/height or unverified geometry is not guessed. A low wall can still provide its cover grade when a sampled eye-height projectile ray passes over it.
- Pre-existing GM-classified `partial`/`improved` walls, native AC anti-stacking, best-angle selection, conditional Reflex-save source approval, and the single native chat thumbnail remain unchanged.

**GM macro:** select the relevant wall segments and use the existing README macro with `const grade = "window";` to override the automatic classification. Use `"normal"` to remove an override. A transparent native window is recognized only when both native **sight** and **light** restrictions are explicitly set to **None**.

## Explicit partial / improved wall cover (development branch)

PF1AE can now distinguish a **GM-classified wall** from ordinary full-height wall cover. This feature does **not** infer which percentage of a creature's body is visible from a 2D wall segment or a single 3D line-of-sight height, because that would produce inaccurate Pathfinder 1e adjudications.

- **Ordinary wall:** standard cover, **+4 AC / +2 Reflex**.
- **Partial-cover wall:** **+2 AC / +1 Reflex**.
- **Improved-cover wall:** **+8 AC / +4 Reflex**.
- **Interposed creature:** soft cover, **+4 AC / no Reflex bonus**.
- **Total cover:** direct attack still blocked only when ALL traced rays are fully obstructed by *ordinary solid* walls. A partial or improved-grade wall does not automatically create total cover.

The PF1 corner-ray detector still chooses the attacker's best origin, respects 2D/3D wall heights and preserves unknown-geometry safeguards. Graded-wall attack bonuses appear in the three native target AC thumbnail values **only when the geometry and native AC bonus provenance are confirmed**. This display does not mutate Actor AC. Reflex modifiers continue to use the existing explicitly reviewed, source-bound manual-cover save mechanism; no guessed automatic Reflex bonus is applied to an unrelated save.

**GM wall setup:** select one or more wall segments in the native Foundry Walls layer, then execute this *GM script macro* to assign their cover grade. Change `grade` to `"improved"`, `"normal"` (reset), or `"partial"`:

```js
const grade = "partial";
const cover = game.modules.get("pf1-automation-engine")?.api?.coverPF1;
if (!game.user.isGM || !cover?.setWallGrade) throw Error("PF1AE GM cover API unavailable");
const walls = canvas.walls.controlled;
if (!walls.length) throw Error("Select at least one wall segment");
for (const wall of walls) await cover.setWallGrade(wall.document, grade);
ui.notifications.info(`PF1AE: ${walls.length} wall(s) classified as ${grade}`);
```

The `flags.pf1-automation-engine.coverGrade` value is stored on the wall document, not on actors or tokens. Classification is an intentional GM rule call: use **partial** where most of the defender is still exposed and **improved** for exceptional protection such as an arrow slit. Never label every enclosing opaque wall as improved cover; unlike regular walls, improved-grade segments do not automatically prove total cover.

## Automatically choose the attacker's best cover angle (v1.39.13)

For ranged attacks and non-adjacent melee/reach attacks, PF1AE **automatically chooses the most favorable corner of the attacker's occupied square(s)**, as permitted by PF1e. When one origin has no strictly crossed wall or creature, and its only uncertain rays merely **graze wall endpoints or creature boundaries**, that origin is treated as a clean shot instead of returning `wall-or-creature-contact-ambiguous`. The target receives **no cover bonus** if the attacker can fire from that angle.

This reproduces the second live pier report: four attacker corners with strict wall crossings `[0,0,1,1]` and grazing rays `[2,2,1,1]` -> the attacker chooses corner 0 or 1 and the target **does not get +4**. In the previous pier position with strict blocking from *every* corner, the +4 normal cover remains confirmed. We do not dismiss unknown wall types, Levels collisions, roofs or unverified height/surface geometry as grazing-only: those remain uncertain. Adjacent melee uses its separate native PF1 cover determination.

The chat display remains unchanged from v1.39.12: only the three original target AC figures inside the native attack card are updated when cover is definitively confirmed, with no additional PF1AE footer.

## Thumbnail-only cover AC display (v1.39.12)

PF1AE now displays confirmed cover **only in the three existing PF1 target AC icons** inside the native chat card. It does not append a second "PF1AE — abri contre cette attaque" section below the roll. For Harpy, native AC 16 / touch 13 / flat-footed 13 with confirmed normal cover +4 displays **20 / 17 / 17** in the miniature.

The displayed AC values remain target-specific; the Actor's permanent AC, native attack/damage rolls and the canvas token are unchanged. Existing explicit typed cover is not added twice. Without confirmed cover or without identifiable target miniature HTML, PF1AE leaves the native card alone; it no longer inserts an "unverified" footer. In full attacks, the first attack's cover state owns the single target-summary thumbnail, with no extra per-roll cover section.

## Normal, touch and flat-footed cover AC in target thumbnail (v1.39.11)

The existing PF1 target miniature now presents **all three target AC figures adjusted for confirmed cover**: for Harpy, normal AC **16 → 20**, touch **13 → 17**, and flat-footed **13 → 17** when a +4 normal-cover bonus applies. The change only modifies the original chat-card HTML display; **the target Actor's AC totals and all native attack rolls remain unchanged**.

Each AC figure is calculated independently from the native target Actor total and only the missing explicit native `cover` bonus for its type (`normal`, `touch`, `flatFooted`). If a native type already includes +4 cover, that figure is not increased again. If the cover source breakdown for one type is uncertain, that figure stays unchanged while other supported types can be adjusted. Missing target markup or unverifiable cover keeps the miniature untouched. The summary reflects the first attack of a full attack; individual attack outcomes remain documented below.

## Cover-adjusted AC inside the native target thumbnail (v1.39.10)

The original PF1 target mini-card displays three defenses next to the target portrait (normal AC shield, touch AC and flat-footed AC). When confirmed normal/soft cover gives an **authoritative** effective defense for a single targeted attack, PF1AE now replaces **only the corresponding number** inside that target's native card: for example, Harpy normal AC **16** with cover **+4** is displayed as **20 in the shield icon**. Touch and flat-footed values remain untouched when normal AC is modified. The original target card and its avatar are preserved; the detailed cover calculation remains in the same native chat message below the attack result.

The change is persisted to the original `ChatMessage.content`, so it survives rerendering. It is scoped by the exact target Token UUID and expected original AC value. The source Actor's AC is never changed, and the native attack roll/damage are unaffected. When a full attack may have a different effective AC per roll, only the first attack sets the summary thumbnail; the footnotes continue to show individual values. Uncertain defense, absent target markup, missing native AC or unrelated targets are never rewritten.

## Simple cover-adjusted AC (v1.39.9)

For a confirmed normal or soft cover attack, PF1AE now computes the effective target AC from the native PF1 armor class and the **missing cover bonus**. It scans only native AC entries explicitly labelled `modifier: "cover"`; normal baseline, leather armor, Dexterity, Dodge, and entries marked `null`, `undefined` or `untyped` no longer prevent application.

Example from a live PF1 11.11 world: Harpy AC 16 with no explicit pre-existing cover + confirmed normal cover +4 results in **effective AC 20** on the native chat card (not merely an indicative value). If an explicit +4 cover modifier is already part of native AC, no second +4 is added. If typed cover source data is malformed or there are competing explicit cover entries, the outcome stays uncertain. A custom **untyped** bonus secretly intended to represent cover cannot be identified as cover automatically; in that unusual case, the GM must avoid applying it twice.

This remains a temporary, target-specific calculation. **The Actor's AC stays unchanged**, the PF1 attack roll is untouched, and no duplicate chat card or bonus is created. The existing proven 2D/3D ray geometry, total-cover cancellation, and early range cancellation are unchanged.

## Indicative cover AC when native breakdown is ambiguous (v1.39.8)

In the live Ezren → Harpy test, PF1AE v1.39.7 confirms normal cover (+4) in both 2D and 3D. Harpy has native normal AC 16, but native AC source analysis returns `untyped-or-unclassified-native-ac-source` for an existing item, so the strict defense resolver cannot prove that this AC excludes a cover bonus. The combat outcome remains `indeterminate` rather than risk doubling cover.

The native chat card now **shows the arithmetic reference** `Indicative AC with cover: 20` (`Native AC: 16 · Cover bonus: +4`) with a conspicuous warning that the number is **not verified** if native AC provenance is ambiguous. The native AC tooltip/icon, Actor, original attack roll, and automatic hit/miss state are untouched. When native provenance is verified, the card continues to show the definitive effective AC and avoids double-counting; uncertain cover geometry never produces an estimate.

## Proven cover despite grazing wall endpoints (v1.39.7)

In Pathfinder 1e, **ranged/reach cover** checks rays from each potential attacker-space corner to all target-space corners. PF1AE previously returned `uncertain / wall-or-creature-contact-ambiguous` whenever **any** ray grazed a wall, even if **every** possible origin also had a different, strictly obstructed ray. On the actual pier encounter, the attacker's four origins each produced at least one `solid` wall crossing while several other rays were tangent.

PF1AE now confirms normal +4 cover when every possible attacker origin has a proven wall crossing (or qualified soft cover) and cannot be entirely clear, even if other rays graze an endpoint. It still rejects speculative bonuses: when an origin has no proven obstruction and only grazing rays, the result stays `uncertain`. Total cover still requires every ray to be demonstrably blocked. The original chat card continues to show native AC and verified effective cover-adjusted AC without changing the target Actor.

## 3D cover with different attacker and target LOS heights (v1.39.6)

Foundry PF1 tokens on the same elevation may have different `losHeight` values (e.g. due to token size or other vision-height automation). Previously, 3D cover checks stopped before ray tracing with `different-sampled-attack-heights`; this prevented the target's effective AC from appearing in the native chat card at all. PF1AE now traces **sloping rays** across the battlefield and evaluates an intersected native wall at its actual crossing height, applying its verified vertical bounds and door/movement state.

An unobstructed sloping shot has no cover; a partially blocking wall intersected at a valid height can produce normal cover +4; a fully blocking wall can still prevent direct attack. Walls with unknown vertical bounds or grazing geometry remain uncertain and never grant an unverified +4. This applies to world cover mode **3D**, not just 2D. Existing message-annotation and no-double-counting behavior remains.

## Direct native-card cover AC delivery (v1.39.5)

PF1AE now also handles the PF1 `pf1PostActionUse` event **directly**, so a native attack card can display a verified cover-adjusted target AC even if the secondary `pf1AttackRoll` / `pf1aeAttackResolution` pairing was unavailable. The new fallback obtains the actual native ActionUse, selected target and ChatMessage, recomputes only the read-only cover assessment and evaluates native AC plus cover through the existing no-double-counting defense adapter. It queues an update to the **original** native message; no actor, roll or damage value is changed.

Example: native target AC **16** with verified normal cover **+4** produces an added **Target AC incl. cover: 20** row, explaining the native 16 and +4. The PF1 target shield icon may still display the unmodified native AC; PF1AE does not rewrite that system-owned icon. For uncertain corner geometry (common near docks or walls), it displays **Unverified (GM review)** instead of fabricating a +4; this separates visual token visibility from confirmed Pathfinder cover. This direct path and the original multiattack path deduplicate/serialize updates on the same message.

## Cover-adjusted target AC shown in native chat card (v1.39.4)

When a single target receives confirmed normal or soft cover in the PF1AE read-only cover evaluation, the **existing PF1 attack chat card** is annotated with the target's verified effective AC, e.g. **Target AC incl. cover: 24**, **Native AC: 20 · Cover bonus: +4**. This is a display of the defense resolution, **not** a change to the Actor's sheet or the native roll, and does not create another message.

When an existing typed native cover modifier is already included in the character's AC, the annotation shows the resulting effective AC unchanged, identifies that cover is already included and never adds +4 again. When the native AC sources cannot be trusted, it explicitly displays **Unverified (GM review)**, not a fabricated effective AC. Full attacks now receive separately numbered cover results within the same chat message, serialized to prevent concurrent chat-card updates from overwriting another attack. Total cover still prevents direct attacks before the native dialog.

## Elevation-aware action range (v1.39.3)

PF1AE's pre-dialog out-of-range cancellation now includes the **vertical separation** between attacker and the selected target. For instance, an adjacent target 2 m below a melee attacker with **1.5 m reach** is out of reach and the attack is stopped before the native dialog and resources. PF1 1-2-1 alternating diagonals apply in three dimensions whenever occupied grid-cell centres, square distance and vertical heights are all grid-aligned and the native 2D ruler agrees with that convention. This allows a one-square horizontal + one-square vertical diagonal, but charges two consecutive three-dimensional diagonals as three squares.

When elevations are fractional or the grid convention cannot be verified, only a **conservative lower bound** (the greater of native 2D distance and vertical distance) is used, preventing false cancellations. The action-specific feet/meters conversion, closest occupied squares of Large tokens, targeted spells/abilities, native dialog cancellation, and fail-open behavior for missing geometry or multiple targets remain unchanged.

## Native higher-ground checkbox (v1.39.2)

Enable **Precheck native higher-ground melee option** in PF1AE world settings and disable Roll Bonuses higher-ground automation to prevent competition over the same native PF1 attack checkbox.

PF1AE **does not inject any attack bonus**. When the attacker token has a strictly higher elevation than exactly one target, and the target is still within the PF1 native melee reach, PF1AE clicks the existing **Higher Ground / Position surélevée** checkbox as the attack dialog opens. PF1 itself applies the normal +1 if this option remains checked. The player can freely uncheck it; PF1AE does not recheck it after a manual change.

There is **no GM confirmation, token flag, macro, terrain-support check, special Trusted Table requirement, or separate damage/attack roll calculation**. The old `highGroundRequireSupport` setting remains registered but is hidden and ignored for migration compatibility. Detection uses the scene's measured token heights and native melee reach; it does not infer arbitrary environmental terrain from elevation. If the native checkbox cannot be uniquely identified in the dialog, PF1AE leaves it unchanged rather than modifying a different checkbox.

## Shooting into melee (v1.33.6)

**Trusted Table Mode approval fix (v1.33.6):** The exact native `toggle` Script Call `PF1AE:rangedMelee:override` is now eligible for the opt-in trusted-table allowlist, including elected-GM rolls for player-owned Actors. Actor/Item/Script Call identity checks remain mandatory. With Trusted Table Mode disabled, only an individually approved, unchanged native Script Call can run with GM privileges. The Precise Shot item script is unchanged.

PF1AE can now apply verified Pathfinder 1e ranged-into-melee attack penalties **before each native attack roll** using the same `pf1CreateActionUse` / `shared.attackBonus` pre-roll extension point as range increments for verified single-target engagements. A separate per-index correction is reserved for feat overrides or cases resolved later. The rule is **−4**, reduced to **−2** for targets two size categories larger and **0** for three sizes larger, and is avoided at 10 ft separation. Uncertain threat, faction or target associations defer to manual adjudication instead of guessing. The module does not hardcode feats: native Item Script Calls may supply exact-index penalty overrides, including **Precise Shot**. See [Ranged melee API and full Script Call](docs/RANGED-MELEE.md).

## Generic Bleed automation (v1.32.0)

**Native-status mode (v1.32.0):** Manually activated Bleed now stores its formula directly on the *native* Bleed ActiveEffect, not on a generated secondary Buff. The generic Bleed engine reads either native Bleed flags or existing Buff Bleed metadata. Rolled formulas are published as a single evaluated Foundry Roll message for Dice So Nice; fixed values post a compact chat result. Previously generated manual Buffs are migrated to native Bleed and removed. See [Bleed documentation](docs/BLEED.md).


**Compatibility fix (v1.31.1):** HP Bleed now always passes the required options object into PF1 Actor.applyDamage. When `pf1-automate-damage` is active, the call uses its existing dialog-origin bypass flag to avoid intercepting periodic Bleed damage as a selected-token chat-card attack. This prevents a third-party `undefined` config crash without bypassing PF1 native HP handling. Existing pending turn receipts are intentionally not retried automatically.

**Single Bleed icon on tokens (v1.31.0):** A generated manual Bleed Buff now uses PF1's native `system.hideFromToken: true` setting, so its neutral Buff icon is not displayed. On the native Bleed condition icon, PF1AE adds a local PIXI label with the **saved formula** (such as `1d4`), not the current die roll. Other Buffs and conditions are unchanged. Existing generated Buffs are migrated for GM-owned worlds when a GM opens the world. See [Bleed documentation](docs/BLEED.md).

PF1AE now supports **HP Bleed** declared on active native PF1 Buff Items via the `flags["pf1-automation-engine"].bleed` metadata. The elected GM processes the highest rolled HP Bleed at the beginning of the affected combatant's turn, routes reductions through individually approved `PF1AE:bleed:before` Item Script Calls, and applies remaining damage via native `ActorPF.applyDamage`. Persistent one-shot receipts prevent duplicate damage on F5, replay or Combat Tracker rewinds. See [Bleed documentation](docs/BLEED.md) for scope, limitations and a full Scarlet/Scarification Script Call example. Ability Bleed and Bleed stacking overrides are not yet implemented.

## Installation

**Recommended — Foundry VTT module installer:** Settings → Add-on Modules → Install Module → **Manifest URL**, paste:

```text
https://raw.githubusercontent.com/Caelvanost/pf1-automation-engine/main/module.json
```

The stable manifest points to the versioned ZIP asset of the [latest published release](https://github.com/Caelvanost/pf1-automation-engine/releases). It also enables subsequent module updates through Foundry. **Do not paste the ZIP download URL into the Manifest URL field.**

**Manual alternative:** extract the complete release ZIP into `Data/modules/pf1-automation-engine/` (the `module.json` must be at that directory's root), then enable PF1 Automation Engine in a PF1 11.11 world. A connected GM is required to perform authoritative mutations. `genericDebug` enables diagnostics; `genericEnabled` controls generic execution.

## Nouvelle restauration automatique des gestionnaires (v1.28.0)

Les Script Calls natifs `PF1AE:bootstrap` contenant un appel
`registerChatActionHandler(...)` sont découverts et restaurés
automatiquement sur le MJ élu, sans macro ni activation de l'objet. Les
scripts appartenant à des joueurs requièrent une **approbation exacte du MJ**
(ou l'activation explicite du mode Table de confiance), sans aucune
transmission de JavaScript dans le chat ou les sockets.

Voir [API de restauration Chat Actions](API-CHAT-ACTION-BOOTSTRAP.md) et
[exemple complet Utility Shot](examples/utility-shot-stop-bleeding.md).

## Persistent Chat Actions (v1.28.0)

PF1AE supplies `game.modules.get("pf1-automation-engine").api.chatActions`. The
[complete API and security guide](API-CHAT-ACTIONS.md) explains the
authenticated Actor-update transport, elected-GM execution, strict target
ownership, GM-bound stable handlers, pending/used states and F5 persistence.

A button cannot execute arbitrary message code. Register its stable handler
**on the elected GM**, using an approved/GM-owned `PF1AE:bootstrap` Script
Call. The handler must be bound to the exact originating `sourceItemUuid`.
When the GM disconnects, requests fail closed. An exception during handler
execution leaves a pending button that only the GM can review/reset.

## Services

| Service | API | Purpose |
| --- | --- | --- |
| Managed buffs | `api.effectGroups` | Apply/extend/stop source-linked effects on multiple targets, including those owned by other users |
| Turn and world-time timers | `api.generic`, `api.duration` | Persistent combat phase and elapsed-time expirations |
| PF1 saving throw context | `api.saveContext` | Identify genuine PF1 Action cards, IDs and save DC |
| Saving throw modification | `api.saveOverrides` | Countersong, Distraction and other effective-total overrides |
| Saving throw consequences | `api.saveOutcomes` | Source-bound native conditions, including Fascination and timed Stunned |
| Applied attack damage | `api.attackOutcomes` | Correlate a specific native attack-card strike with actual damage, then trigger a follow-up Item Action |
| Rest/discovery | `api.rest`, `api.discovery` | Native PF1 rest observability and approved event rules |

Read the precise APIs in [Effect Groups](API-EFFETS-GROUPES.md), [Save Outcomes](docs/SAVE-OUTCOMES.md) and [Attack Outcomes](docs/ATTACK-OUTCOMES.md). The engine requires a real native PF1 card to claim provenance; a bare HP update or a manual sheet save does not establish that provenance.

## Native damage bridge (v1.14.3)

PF1 11.11 can apply damage from the action card **without entering the `ApplyDamage._onApply` wrapper**. Earlier v1.14.1 rejected this path. The updated bridge listens to `pf1ApplyDamageTargetOptions` and `pf1ApplyDamage`, captures a precise card/attack index/target and follows the resulting `updateActor` event on the **same elected-GM client**. A fresh, unique pair of native hooks, exact source identity, consistent target UUID and positive effective damage are all required. Options may be cloned between hooks. The existing dialog wrapper remains available but is no longer the only success path; `ActorPF.applyDamage`'s non-configurable accessor is untouched.

Fail-closed: conflicting card or attack index, overlapping damage requests to one Actor, stale options, a different update user, missing authoritative native pre-hook or no proven damage cause the follow-up to be refused. Temporary HP-only absorption does not count as proven damage under the current bridge. Attribution when multiple unrelated updates happen in the same very short window cannot be guaranteed by public hooks; check the debug diagnostics and adjudicate manually if the source cannot be established. This remains an **experimental integration**, not a transactional damage receipt from PF1.

Enable debug and look for:

```text
[PF1AE][AttackOutcome] Direct native damage options captured (no dialog)
[PF1AE][AttackOutcome] pf1ApplyDamage received
[PF1AE][AttackOutcome] Native damage actor update observed
[PF1AE][AttackOutcome] Native damage applied; dispatching verified outcome
[PF1AE][AttackOutcome] Triggered source-specific follow-up Action
```

The follow-up PF1 Action can register `saveOutcomes` **before** posting its native save card. A failed Fortitude save for Stunning Fist creates the `stunned` condition, with source-combatant turn-start expiry if configured.

## Security and persistence

The elected GM owns world-setting registries. Remote registrations validate ownership of the source Actor; target ownership is not required. Follow-up actions must belong to the same source Actor. Each attack is bound to its native ChatMessage, Action ID, explicit zero-based attack index and target Actor UUID. Persistent states prevent double execution across F5 and GM changes. Ambiguous provenance is rejected.

## Debugging

```js
const api = game.modules.get('pf1-automation-engine')?.api;
console.table(api?.attackOutcomes?.list() ?? []);
console.table(api?.saveOutcomes?.list() ?? []);
console.table(api?.effectGroups?.listGroups() ?? []);
```

Verify the native SaveBridge startup logs (`Installed PF1 save hooks`, `PRE`, `POST`) when debugging saving throws. The damage bridge uses native PF1 hooks plus the actual actor update; never assume that a native damage PRE event alone means the target took damage.

## Documentation and tests

- [Attack Outcomes](docs/ATTACK-OUTCOMES.md)
- [Save Outcomes](docs/SAVE-OUTCOMES.md)
- [Turn-phase expirations](API-EXPIRATIONS.md)
- [Duration manager](API-DUREES.md)
- [Native PF1 rest](docs/PF1-NATIVE-REST.md)
- [API for Item Script Calls](API-SCRIPTS-OBJET.md)
- [Changelog](CHANGELOG.md)

The release workflow runs 21 maintained Node regression suites in isolation; seven historical suites are explicitly excluded because their fixtures or assertions still need maintenance. The separate **Legacy regression audit** workflow can run the full inventory for diagnosis and is not a release gate. Locally, run `node --test tests/*.test.cjs` for a full diagnostic inventory (legacy failures remain expected) or use the release workflow's per-file commands for the maintained gate. Live Foundry testing is additionally required for specific damage-dialog paths, permissions and overlapping updates. No standalone example scripts are distributed.

### PF1 synthetic Actor HP offsets (v1.14.4)

The native direct-damage bridge accepts `updateActor` changes in `system.attributes.hp.value` **or** `system.attributes.hp.offset` for linked and unlinked Token Actors. When available, the native `options.pf1.deltas.hp` and `_nasPrevHp` are checked for consistency. A negative offset is **not** sufficient to prove damage: the bridge requires a before/after loss of effective HP or an increase in nonlethal damage, and the verified attack card, action, attack index and target Actor UUID must match. No change to the public `attackOutcomes` API or Item Script Calls is necessary.

## Approved mechanical save-outcome templates (v1.15.0)

`saveOutcomes.register()` additionally accepts `onFailure.type = "templateEffect"`, copying an approved PF1 Buff or ActiveEffect with native mechanical changes to the precise save target after a failed save. Existing `linkedBuff` and bardic automations are unchanged. Use existing managed effect groups for deletion and persistent duration timers, with `stack`, `replace`, `refresh`, and `ignore` stacking policies. **Only fixed-value, GM-approved template mechanics are supported**; the new API rejects dynamic `parameters` rather than interpreting untrusted PF1 field paths. See [Template Save Outcomes](docs/TEMPLATE-SAVE-OUTCOMES.md).

## v1.18.0 — Declarative dynamic effects

The new `api.effects` service allows GM-authorized source Item Actions to create timed native PF1 mechanical buffs directly from validated numeric changes. `saveOutcomes.register` accepts `onFailure.type="dynamicEffect"`, while `linkedBuff` and `templateEffect` remain unchanged. See [Dynamic Effects](docs/DYNAMIC-EFFECTS.md).

## Effets automatiques sans approbation manuelle (v1.18.0)

Les buffs déclaratifs `dynamicEffect` ne requièrent plus l'appel préalable à `api.effects.approve()` lorsqu'ils restent dans la politique automatique (3 changements au maximum, valeurs de -10 à +10, chemins/types PF1 natifs vérifiés). Les modèles `templateEffect` passifs sont approuvés automatiquement lors de l'enregistrement, sous contrôle d'empreinte et sans exécuter de scripts. Les autorisations explicites existantes prévalent et une révocation bloque la capacité.

Les joueurs ne peuvent pas utiliser ce mode pour appliquer directement un malus à un ennemi sans sauvegarde vérifiée : le mode direct automatique est limité à leur propre Actor ; pour les adversaires, utiliser `saveOutcomes.dynamicEffect`. Voir [Dynamic Effects](docs/DYNAMIC-EFFECTS.md).

### Compatibilité Attack Outcomes → Save Outcomes (v1.18.0)

Les actions déclenchées par les dégâts peuvent désormais enregistrer `onFailure.type: linkedBuff`, `templateEffect` ou `dynamicEffect`. `attackOutcomes` ne valide que la liaison de la carte, de la source, de l’Action et des cibles ; `saveOutcomes` et `api.effects` valident les champs mécaniques, la durée et le cumul. L’objet `onFailure` est transmis intact.

### Expiration des effets au retrait d’un combat (v1.18.0)

La fin ou la suppression d’un Combat nettoie les états temporaires indépendants liés à son échéance de tour, ainsi que les groupes d’effets enregistrés. Les minuteurs de scripts sont annulés **sans lancer les scripts** ; les minuteurs en temps de jeu ne sont pas touchés. Lorsqu’une scène ou un token synthétique est indisponible, le nettoyage est conservé dans le registre pour un nouvel essai après reconnexion ou changement de scène. Les états permanents et les documents d’autres modules ne sont jamais identifiés par leur seul nom ou leur seul `statusId`. Voir [Nettoyage de combat](docs/COMBAT-CLEANUP.md).

## Abonnements aux événements de jets d’attaque (v1.18.0)

Les objets PF1 peuvent réagir sans utilisation manuelle : ajouter un **Script Call « Après utilisation » nommé exactement `PF1AE:attack:resolved`** dans l’Item concerné. Le moteur écoute les hooks natifs `pf1AttackRoll` et `pf1PostActionUse`, puis transmet chaque jet individuel évalué à l’appel de script. Aucune déduction de touche (`hit: null`) et aucun jet ou effet supplémentaire produit par le moteur. Voir [Attack Events](docs/ATTACK-EVENTS.md).

## Bootstrap persistant des Script Calls (v1.18.0)

Les Items peuvent demander la réinstallation de leur automatisation JavaScript après F5 via `api.bootstrap.register({actor,item,key,scriptId?})`. Les seules inscriptions persistantes sont restaurées sur le client propriétaire, en utilisant `ItemScriptCall.execute()` dans un contexte `bootstrap:restore` sans provoquer un véritable toggle. Pour un nettoyage sûr, le script appelle `bootstrap.listen(hook,callback)` au lieu de `Hooks.on()` brut. Voir [Bootstrap persistant](docs/BOOTSTRAP.md).
## Événements de dégâts natifs et critiques (v1.19.0)

Un objet peut réagir aux **dégâts effectivement appliqués par une attaque native**, sans être utilisé manuellement. Ajouter un Script Call « Après utilisation » nommé `PF1AE:damage:applied`, `PF1AE:damage:critical` ou `PF1AE:damage:zeroHP`. La détection utilise exclusivement le pont de dégâts `attackOutcomes` déjà présent ; un jet critique sans perte de PV ne suffit pas. Le MJ élu confirme l'application puis le propriétaire du personnage exécute son Script Call, sans transfert de code exécutable au MJ. Voir [l'API et le protocole de validation](docs/DAMAGE-EVENTS.md).

## Reprise MJ des scripts d'objets (v1.19.1)

Lorsque le propriétaire joueur d'un PJ se déconnecte, le MJ élu reprend l'exécution des Script Calls `PF1AE:damage:*` et des bootstraps persistants **uniquement si le Script Call natif a été explicitement approuvé** par le MJ. Le moteur compare l'UUID de l'acteur, de l'Item, l'ID du Script Call et **son contenu source sérialisé exact** avant toute exécution de secours. Toute édition impose une nouvelle approbation. Les scripts `PF1AE:attack:resolved` exécutés depuis une session MJ sur un PJ contrôlé par un joueur respectent la même protection. Voir [Documentation des approbations](docs/SCRIPT-FALLBACK-APPROVALS.md).

## v1.20.0 — Table de confiance (opt-in)

Activer **Table de confiance** dans les paramètres du monde (MJ seulement). Par défaut, ce mode est **désactivé** ; toutes les approbations explicites restent requises pour la reprise MJ des Script Calls des joueurs.

En mode Table de confiance, ajouter un Script Call natif **Basculer/toggle** nommé exactement `PF1AE:bootstrap` à une capacité suffit : PF1AE le découvre sur les acteurs disponibles, y compris les acteurs synthétiques accessibles via les scènes, et l'exécute **uniquement comme initialisation** avec `restoring:true`, `state:null` et `bootstrap.listen(...)`. Aucune activation de capacité, dépense de ressource, `item.use()` ou `setActive()`. Les scripts non nommés ou de catégorie différente ne sont jamais initialisés. Les anciens `api.bootstrap.register()` restent utilisables et sont dédupliqués avec la découverte automatique.

Les Script Calls exactement nommés `PF1AE:bootstrap`, `PF1AE:attack:resolved`, `PF1AE:damage:applied`, `PF1AE:damage:critical` et `PF1AE:damage:zeroHP` peuvent être repris par le MJ élu sans approbation individuelle en mode de confiance ; les autres scripts et le mode sécurisé ne changent pas. L'élection multijoueur, les contrôles de provenance des dégâts, les permissions de documents et la déduplication restent applicables.

**AVERTISSEMENT :** les JavaScript de capacités éditables par les joueurs peuvent être exécutés avec les privilèges du MJ pendant une reprise. N'activer ce mode que pour une table privée de confiance. Une scène, une reconnexion, la création/suppression/modification d'une capacité ou un changement de paramètre provoquent une synchronisation et un nettoyage des listeners suivis. Les hooks créés manuellement via `Hooks.on()` ne sont pas nettoyables par le moteur : utiliser `bootstrap.listen()`.

Voir [Bootstrap](docs/BOOTSTRAP.md) et [approbations MJ](docs/SCRIPT-FALLBACK-APPROVALS.md). La suite `tests/trusted-table.test.cjs` vérifie les transitions et les doublons simulés ; une validation en vraie session multijoueur Foundry reste requise.

## v1.21.0 — Assistante de portée native (expérimentale)

Le paramètre de monde MJ **Calcul automatique des pénalités de portée** est désactivé par défaut et indépendant de **Table de confiance**.

Pour une action d'attaque à distance de type `rwak` ou `twak` avec facteurs de portée (`range.maxIncrements > 1`), PF1AE intercepte **`pf1CreateActionUse`**, avant l'évaluation des jets. Lorsque **exactement une cible** et un token attaquant sur la même scène sont disponibles, il mesure la distance par `canvas.grid.measurePath()` entre les cellules occupées des tokens, lit la portée de l'action par `action.getRange({type:'single',rollData})`, et fournit à la configuration native le facteur calculé. Le moteur PF1 reste seul responsable de l'ajout du malus au jet via son pipeline `ActionDialog → ActionUse.applyConfig`. Aucun bonus n'est ajouté manuellement à la fiche ou après le jet.

Calcul : facteur 1 jusqu'à la première limite incluse ; facteur 2 : −2 ; facteur 3 : −4 ; etc. Le facteur maximal configuré sur l'action est conservé. Le réglage ne touche ni à la CA de contact ni aux coûts de Deadeye/Grit.

**Convention métrique de cette table** : 5 pieds = 1,5 m. Sont reconnues les unités de scène `m`, `mètre(s)`, `meter(s)`, `ft`, `foot`, `feet`, `pied(s)`. L'API `action.getRange()` retourne normalement la portée dans les unités **système PF1**, qui peuvent différer des unités de scène ; la conversion suit cette convention. Les unités inconnues, les cibles multiples, les actions sans facteur, les sorts et les données manquantes restent au comportement natif.

**Protection des modificateurs :** un réglage natif explicite du facteur ou du malus, ou l'option de contournement connue, empêche toute modification par PF1AE. L'outil n'intervient pas sur les jets déjà évalués. Une attaque hors portée affiche un avertissement et reste non modifiée : la configuration native détermine toujours si l'action est possible.

**Limite importante :** le point de jonction a été recoupé avec les signatures publiques PF1 et une copie GitHub de code PF1 plus récente ; le source *exact* du tag 11.11 n'a pas été directement récupérable ici. Le pipeline natif doit donc être vérifié sur une installation réelle PF1 11.11 avant de considérer la correction comme définitivement validée. Le comportement de la case **Skip Ranged Increment Checks**, notamment, doit être vérifié sur des jets réels. L'option reste désactivée par défaut afin de ne pas changer les parties existantes.


### v1.21.1 — Correction des pénalités de portée

PF1 11.11 peut initialiser `formData.rangePenalty` ou `config.rangePenalty` à **zéro** avant que le module ne calcule la portée. PF1AE interprétait à tort ce zéro comme un modificateur manuel et ignorait le jet. La valeur zéro est désormais traitée comme une absence de pénalité préexistante. Un **modificateur manuel non nul** reste prioritaire.

La détection de l'attaquant accepte un `TokenDocument` ou un `Token`, et `api.range.lastDiagnostic()` expose la dernière décision du calcul (facteur, pénalité ou raison du refus). Pour diagnostiquer après une attaque :

```js
console.log(game.modules.get('pf1-automation-engine')?.api?.range?.lastDiagnostic());
```

Les tests automatisés vérifient les valeurs zéro natives et les TokenDocuments. La compatibilité sur une véritable installation PF1 11.11 doit encore être confirmée en jeu.

### v1.21.2 — Malus de portée dans le jet, et correction pieds/mètres

Les versions 1.21.0–1.21.1 pouvaient afficher `status: configured` sans changer réellement le jet, parce que PF1 reconstruisait les valeurs du dialogue après `pf1CreateActionUse`. Le module utilise désormais **`shared.attackBonus`**, tableau officiellement consommé par `ActionUse.addAttacks()` pour construire les jets natifs : le terme `-2[Range Penalty]` est injecté une seule fois **avant le lancer** (attaque simple et attaque à outrance partageant une seule cible). Aucun changement de fiche, aucun recalcul après jet, et aucune modification de la CA de contact ou de Deadeye.

Une portée numérique explicitement configurée `20 ft` est lue directement avec son unité : **20 pieds = 6 mètres** selon la convention de la table. `getRange()` n'est utilisé que pour les portées exprimées par une formule, car son résultat dépend des unités système PF1 et ne doit pas effacer l'unité déclarée sur l'action.

Le réglage **Calcul automatique des pénalités de portée** reste opt-in. Les modificateurs de portée manuels non nuls existant avant l'action restent prioritaires ; ne pas ajouter manuellement une seconde pénalité dans le dialogue du même tir. Le diagnostic après tir affiche le facteur calculé : `game.modules.get('pf1-automation-engine').api.range.lastDiagnostic()`. Attention, l'étiquette dans le jet provient de la localisation PF1.

**Validation** : les tests CI simulent le hook natif et vérifient l'ajout dans `shared.attackBonus` ainsi que les conversions. Le résultat sur un vrai jet dans Foundry v13.351 / PF1 v11.11 doit être confirmé en jeu.

## v1.22.0 — Bilingual Foundry interface (English / Français)

PF1 Automation Engine ships `lang/en.json` and `lang/fr.json`. Foundry uses each connected client's configured language: there is no additional world-wide language option. Localized text includes module settings, warnings and notifications, effect-management errors, item-discovery messages, the saving-throw override chat summary, and the **actual range penalty label inside the attack roll**.

**Range bonus display:** for a 20-foot pistol attacking a single target at 9 meters, the pre-roll bonus is labelled `-2[Pénalité de portée]` in French and `-2[Range penalty]` in English. The technical subscription names `PF1AE:bootstrap`, `PF1AE:attack:resolved`, `PF1AE:damage:applied`, `PF1AE:damage:critical`, and `PF1AE:damage:zeroHP` do not change. Persisted API identifiers and keys remain language-neutral.

**Note:** Existing chat message contents are stored as HTML at the time of creation; they are not retroactively translated if a reader changes language later. Technical diagnostic logs and errors returned by third-party APIs can also remain in the language emitted by their source.

Translations are maintained as matching JSON keys with identical variable placeholders. The `i18n.test.cjs` regression validates both packs and reproduces a labeled pre-roll attack in both languages.


## v1.23.0 — Experimental loaded ammunition and Reload action

This first version implements an **opt-in core for configured firearms and crossbows**, preserving PF1 native inventory ammunition consumption. Activate **Automatic weapon reload tracking** in module settings. Open an actor-owned weapon sheet: a compact widget lets you configure capacity, PF1 ammunition selection, per-Action shot cost for a multi-barrel attack, and base reload action category. Saving the configuration creates one native PF1 reload Action without removing existing Actions. Loaded chamber markers, Reload and Unload controls appear on the Item sheet.

**Architecture B:** Reload reserves rounds already represented in the actor's native PF1 inventory. The inventory quantity decreases only on a successful attack through PF1's normal ammunition deduction. PF1AE then decrements the loaded slots; it does NOT separately subtract native inventory ammo. Only explicitly configured weapons are affected. Bows and thrown weapons retain native behavior. No existing weapon is automatically considered empty.

**Before-roll guard:** On configured weapon ActionUse instances, PF1AE intercepts generation of ChatAttack entries via the pf1CreateActionUse hook and aborts before attack rolls, chat, charges and ammo consumption if the loaded state is insufficient. A native per-Action shot cost can be configured to require two rounds for a simultaneous double-barrel attack. The source-exact PF1 11.11 integration still needs in-game verification: the public mirror inspected is a different source revision.

**Reload time:** The API reports a reload category derived from a configured base and explicit Rapid Reload and alchemical-cartridge inputs. It does **not** yet automatically detect which weapon a feat applies to, enforce the action economy, alter misfire thresholds, implement mixed-ammo barrels, or automatically trigger AoOs. A reminder is shown instead. These are known incomplete features, not automation guarantees.

**API:** game.modules.get('pf1-automation-engine').api.reload exposes getState(weapon), configure(weapon,options), canFire(weapon,action,attacks), reload(weapon,{ammoId,count,rapidReload}), unload(weapon,{count}) and timing(weapon,ammo,options).

**Multiplayer caution:** Locks are per-client and updates are best-effort, not atomic. Concurrent shots from multiple clients or interruptions between native ammo deduction and weapon state updates can require GM reconciliation. This version is experimental and disabled by default; do not enable globally until tested in a live multiplayer world.

**Double barrel:** Set capacity 2 and native Double barrel Action shot cost 2. One loaded barrel permits a single shot but blocks a double shot. The existing PF1 Full Attack button may still be required to produce two attack rolls for that Action.

Note that PF1 Action names are saved world data; an Action created as Reload or Recharger will not automatically change its stored name based on another connected user's locale. Notifications and settings do localize per client.

### v1.23.1 — Configuration du chargement des armes

Le panneau de rechargement se place désormais **sous l'en-tête natif de l'arme**, dans un encadré de taille limitée, sans grand espace vide. Les sélecteurs sont libellés, lisibles et adaptables aux petits écrans.

La liste **Action d'attaque** montre les actions présentes dans l'arme, y compris celles dont le type de munition n'est pas encore renseigné. La liste **Munition** montre les objets PF1 de type `ammo` accessibles dans l'inventaire de l'acteur, sans filtrage trompeur par le type de l'action. Les autres objets de butin ne sont pas des munitions PF1 natives.

**Prérequis pour enregistrer :** créer un objet de type *Munition* (PF1 `ammo`) dans l'inventaire de Zéphir et vérifier que l'action *Attaque* du pistolet utilise le même **type de munition** que cet objet. Le chargement PF1AE ne peut pas remplacer la configuration native nécessaire à la déduction PF1. Si ces valeurs manquent ou diffèrent, le bouton affiche désormais un message clair en français ou en anglais au lieu de créer un chargement trompeur.

Configurer **Capacité : 2**, choisir la munition, sélectionner facultativement **Double canon** et saisir **Projectiles nécessaires : 2**, choisir le temps de rechargement de base, puis enregistrer. Les attaques et les munitions compatibles restent à vérifier dans la vraie session PF1 11.11 ; l'option reste expérimentale et désactivée par défaut.

## v1.24.0 — Automatic reload configuration, no intrusive forms

The former large per-weapon configuration widget has been **removed**. The module adds a compact, absolutely positioned reload control inside the existing native weapon sheet header without changing the PF1 sheet grid or flex columns. For an uninitialized recognized weapon it shows an estimated `0 / capacity` and a Reload button. Clicking Reload for the first time initializes the loaded slot state and creates the PF1 Reload Action without requiring a separate save/configuration step.

Auto-detection uses the PF1 action's native `action.ammo.type` and `action.ammo.cost`. Capacity is **not** a universal numeric field in PF1 11.11's WeaponModel, so the module reads explicitly stated `Capacity 2` / `Capacité 2` from available weapon description text; otherwise it recognizes a small set of unambiguous simple pistol/musket/crossbow names, including the double-barrel pistol. Unknown, repeating or ambiguous weapons are **not** silently assigned a capacity: a GM can supply a capacity with the optional compact gear control, but a matching native ammo Action must exist.

Shot cost derives from the number of actual native attack instances multiplied by the native `action.ammo.cost`, which accommodates full attacks, Rapid Shot and the double-barrel PF1 setup with two attack instances. Manual per-action overrides previously stored in flags remain supported for compatibility. Native PF1 remains solely responsible for inventory ammo deductions.

The feat `Rapid Reload / Rechargement rapide` has no universal standardized chosen-weapon field in the inspected PF1 FeatModel. To prevent unjustified benefits, only a **weapon explicitly identified** in the feat's name (e.g. `Rechargement rapide (pistolet)`) or a GM-set `rapidReloadWeaponUuid` flag can qualify. An unqualified feat name is insufficient and never reduces all reloading times. This rule is advisory: action-economy expenditure is not mechanically enforced yet. Paper cartridges and misfire interactions remain future work. The engine stays **disabled by default** pending verification on real Foundry v13.351 / PF1 v11.11.

The API now includes `api.reload.infer(weapon)`, `api.reload.initialize(weapon)` and `api.reload.rapidReload(weapon)` for diagnostics.

## v1.24.1 — Reliable pre-roll unloaded-weapon guard

The v1.24.0 implementation attempted to patch an internal `pf1.components.ActionUse` prototype. When that optional global export was absent, the whole reload interception silently failed: **weapons could fire indefinitely without loading**. PF1AE now binds the official native `pf1CreateActionUse` hook without requiring any private constructor. For a tracked weapon it wraps **that ActionUse instance's** `generateChatAttacks()` and checks loaded chambers after PF1 has built/filtered native attack instances, but **before dice roll generation**. If insufficiently loaded, the module skips creating attack rolls and returns `false` at `pf1PreActionUse` to prevent ammo/charge deduction and chat. The first shot on a recognized but uninitialized weapon is also denied rather than free. Unsupported weapons are unchanged.

**Manual Reload Action (no automated cost):** create an ordinary native PF1 action on the weapon named **Recharger** or **Reload**, set its activation cost yourself and make sure it is not an attack. When that native action succeeds, PF1AE initializes the weapon if needed and loads one round. The module **does not create** any Reload action or determine action economy. The feat Rapid Reload and AoOs are reflected only in the native action configuration / GM ruling, not recalculated by PF1AE. An old generated Reload action with a stored action ID is still recognized.

The compact indicator displays chambers loaded and offers a GM-only capacity correction, plus unload when applicable. The extra Reload button was removed so users cannot bypass their native action.

**Requirements:** turn on the opt-in reload tracking setting; use a native PF1 ammo Item with matching `action.ammo.type` and a recognized weapon capacity. An unconfigured but recognizable pistol with a native ranged Action is denied with a warning until configuration is repaired. Use `game.modules.get('pf1-automation-engine').api.reload.lastDiagnostic()` after a shot to see whether it was blocked, authorized or unmanaged and why.

**Validation:** the 25-suite automated release gate simulates a native ActionUse that calls `pf1CreateActionUse` / `pf1PreActionUse` / `pf1PostActionUse`. This still requires a real Foundry 13.351 + PF1 11.11 test. Existing non-atomic cross-client operations remain experimental.


## v1.24.2 — Reload actions and standalone capabilities

**Fix:** Native Reload activation no longer depends on the unrelated \`genericEnabled\` world setting. It requires only the enabled PF1AE module and its explicit \`reloadEnabled\` world setting.

A user-defined, nonattack PF1 Action named \`Recharger\` or \`Reload\` on the **weapon** reloads that weapon by one round after successful use. Its activation cost is whatever the player sets in the native PF1 action. No native Reload Action is generated automatically. A **standalone actor feature / feat** named \`Recharger\` is also accepted (including its default nonattack \`Utiliser\` Action), provided the actor has **exactly one** eligible reloadable weapon. With multiple eligible weapons the module refuses the ambiguous operation and instructs the user to attach the Action to the weapon.

If the auto-inferred capacity or native ammo type cannot be determined, the reload is rejected with an explicit localized warning. \`api.reload.lastDiagnostic()\` now records \`reload-started\`, \`reloaded\`, \`reload-failed\` and \`reload-unresolved\` outcomes, in addition to attack guards.

One successful reload adds **one loaded slot** but **does not subtract** ammunition from inventory. Native PF1 still consumes the ammo only when fired. Concurrent clients can still cause non-atomic weapon/ammo updates, so this experimental feature remains opt-in and needs live verification.


## v1.24.3 — Reload ammo item diagnosis and native PF1 setup

**Use a native non-attack Action \`Recharger\` with ammo set to \`None / Aucune munition\`.** Inheriting the weapon's ammunition on a nonattack action may trigger a native PF1 11.11 error (\`action-use.mjs:628 Cannot read properties of null (reading 'ammo')\`), independent of PF1AE. The *attack action*, not the *reload action*, must consume ammunition.

Previously, the reload core rejected any PF1 native \`ammo\` Item with \`system.identified === false\`, even though ammunition need not be identified to be loaded. This extraneous check has been removed. Additionally, if the weapon points at a deleted, incompatible or empty native ammunition Item and its chamber is empty, the reload now selects a compatible accessible native ammo Item with sufficient quantity, setting the weapon's native \`system.ammo.default\` accordingly. Reload never invents ammo, never subtracts inventory at load, and never swaps already-loaded ammunition.

For debugging, run:
\`\`\`js
const weapon = game.actors.getName("Zéphir")?.items.find(i=>i.type==="weapon" && /double canon/i.test(i.name));
console.log(game.modules.get("pf1-automation-engine")?.api.reload.ammoDiagnostic(weapon));
\`\`\`
You may need to replace the actor and weapon names; the diagnostic displays the ammo subtype expected by PF1, the native default ID, each native ammunition stack's type and quantity, and reservations. \`api.reload.lastDiagnostic()\` now embeds this inventory report on reload failures. Empty inventory or incompatible ammunition types are legitimate errors requiring a compatible native PF1 ammunition Item on the actor.

**Still experimental:** the action must reach native \`pf1PostActionUse\`; no ammo is deducted during reloading, only when firing. Verify operation in the actual Foundry v13 / PF1 v11.11 world.

## v1.24.4 — Chargement dans la colonne latérale de l'arme

Le compteur des projectiles chargés n'est plus superposé à l'en-tête de la fiche. Il est intégré à la colonne latérale native du système PF1 **immédiatement sous Solidité (system.hardness)**, dans une section « Chargement » qui suit le défilement natif de la colonne. Les contrôles « Décharger » (si au moins un projectile est chargé) et le réglage facultatif de la capacité (MJ) y sont regroupés. L'implantation utilise la structure `.sidebar` du template PF1 de la fiche d'arme, sans modifier le quadrillage ni les onglets.

Un point d'insertion de secours reste dans la barre latérale lorsque le champ Solidité n'existe pas dans une variante de fiche. Aucune modification du comportement des tirs, munitions ou rechargements de v1.24.3. Tests automatisés uniquement ; à confirmer en session Foundry 13 + PF1 11.11.


## v1.24.5 — Linked native ammunition, including legacy loot/ammo

PF1 items imported from some older French compendiums can be **type `loot`, subtype `ammo`**, even though the native weapon Details tab already links them using **Munition par Défaut**. In PF1 11.11 the normal `ActionUse.getAmmo()` filters only type `ammo`, so the old stack was not available to fire, despite the valid link and quantity.

PF1AE now accepts either a native `ammo` Item of the matching ammunition subtype, or **exactly the linked legacy `loot / ammo` Item** from the weapon's native `system.ammo.default` field. The latter is permitted only if the weapon has a ranged attack Action with a native ammo type; it never authorizes arbitrary loot or mismatched weapons.

When firing with that linked legacy Item, PF1AE extends only the current `ActionUse.getAmmo()` choices so native PF1 `generateAttacks()` selects the **actual linked document ID**, preserving its native ammunition depletion by `subtractAmmo()`. No duplicate ammo Item is created; inventory quantity remains unchanged during reloading and is deducted once when firing.

The diagnostic `api.reload.ammoDiagnostic(weapon)` includes linked legacy ammunition with `itemType: 'loot'`, `linkedLegacy: true`, and `matches: true` when appropriate. UI stays under Solidité. **Recharger** Action should still use **Aucune munition**, while the weapon's attack Action uses its normal gunBullet type. The world Reload setting is still experimental and opt-in.

Note: if the native PF1 action itself is disabled because `Action.canUse` insists on the standard ammo item type, the native system may still require a matching standard `ammo` Item. This patch aims at the native action-use pipeline; full compatibility must be checked live.

## Upcoming 1.24.6: split Reload into PF1 Firearms & Reload (development preview)

The legacy `scripts/reload-core.js` is no longer imported on this **development branch**. It is replaced by `scripts/reload-adapter.js`, which registers the old `reloadEnabled` world setting for rollback and delegates legacy `api.reload` calls to `game.modules.get("pf1-firearms-and-reload")?.api?.reload`. It advertises `mod.api.reloadDelegated=true` only because no PF1AE reload hooks are installed. The range automation and other PF1AE core modules remain loaded. **Do not deploy the development branch to a live campaign.** The new module must be installed and active to obtain reload functionality; **no extra enable/disable setting exists in the new module**: activating it in Foundry's Manage Modules automatically enables its reload manager. Retain a Foundry world backup. Legacy weapon flags remain intact.


## v1.25.1 — Native PF1 Contact, offensive maneuvers and saves

The extra per-action **Défense ciblée / Target defense** selector has been removed. PF1 already provides the native **Contact** checkbox (`action.touch`), `action.isCombatManeuver` to identify CMD maneuvers, and `action.hasSave` / `action.save.type` to identify saving throw actions.

- **Offensive maneuver:** compare the native CMB roll to target CMD.
- **Contact checked:** compare the attack against touch AC.
- **Other attack:** use normal AC, unless an external provider supplies a verified special defense.
- **Save-only action:** no artificial attack roll or AC comparison; the attack-resolution service reports `pendingSave`, while the existing PF1AE saving-throw services handle the target's Fortitude/Reflex/Will save against the action DC.
- **Attack + save:** resolve the attack and saving throw independently.

No new action settings or native PF1 schema changes. Legacy `attackDefenseConfig` flags are ignored but not deleted. The provider registry and `resolveAttack()` remain available, and the service adds `classifyAction(action,actionUse?)` for integrations.

Full [generic attack-resolution API documentation](API-ATTACK-RESOLUTION.md).
## v1.25.0 — Generic attack resolution (PF1 / external provider API)

This historical v1.25.0 per-action selector is now retired. v1.25.1 uses native PF1 Contact/CMB/save fields instead; no PF1AE action override settings are necessary.

The existing \`PF1AE:attack:resolved\` Script Call and \`api.attackEvents\` retain their previous fields while gaining a verified natural d20 when available, a selected \`defense\`, \`resolution\`, \`targetResults\`, and an optional individual target actor/token reference. The public \`pf1aeAttackResolution\` hook fires independently of Script Call subscriptions. PF1 attack and damage rolls/cards are neither replaced nor recreated, and the damage pipeline is independent.

**External defense provider contract:** \`api.attackResolution.registerDefenseProvider({id,priority,resolve:context=>({type:'touch',reason:'...'}|null)})\` returns an unregister callback. Priority since v1.25.1: native CMB > native Contact > external providers > native ordinary attacks. Equal-priority incompatible providers or exceptions cause an indeterminate result. Provider exceptions are surfaced as diagnostics. No firearm/Deadeye/reload rules exist in this service; such modules must provide only their verified defense choice.

**Safety and limitations:** natural 1 always misses and natural 20 succeeds against the defense, while concealment can require a second verification before a final hit. An AC comparison may report \`defenseHit:true\` with \`hit:null\` if visibility is unverified. Multiple targets without proven roll correlation are indeterminate rather than duplicating a result. Runtime PF1 11.11 behavior, advanced touch-flat-footed variants and scene-based concealment still require live validation. All 27 regression suites run on every release.

Full public API, provider priorities, fields and examples: [API-ATTACK-RESOLUTION.md](API-ATTACK-RESOLUTION.md).

## v1.26.0 — Action par défaut des objets

Un objet PF1 possédant au moins deux actions affiche désormais un menu compact **« Action par défaut »** dans sa liste native des actions. Le choix initial **« Demander à chaque utilisation »** conserve exactement le comportement PF1. En choisissant une action, l'utilisation normale de l'objet transmet son véritable ID à `ItemPF.use({actionId})` et évite l'ouverture du sélecteur d'actions. L'exécution de l'action reste entièrement native : jets, attaque, sauvegardes, charges, consommations de munitions et appels de scripts sont conservés.

La préférence est stockée dans `flags.pf1-automation-engine.defaultActionId` sur l'objet lui-même ; elle est spécifique à chaque exemplaire, persiste après rechargement du monde et n'altère pas `system.actions`. Un joueur doit posséder les droits sur l'objet pour la modifier. Si l'action désignée est supprimée, PF1AE rend immédiatement la main au sélecteur natif au lieu de bloquer l'objet. Pour effacer la préférence, choisir « Demander à chaque utilisation ».

Un lancement qui indique explicitement `actionId`, ou utilise `skipDialog: true`, conserve la sémantique native de PF1. Les utilisations directes d'une action depuis sa propre ligne continuent de fonctionner. Aucun changement de classe PF1, de jet, d'économie d'action ou de déduction de ressources n'est introduit, hormis un enveloppement minimal et conditionnel de `ItemPF.use()`.

L'API `game.modules.get('pf1-automation-engine').api.defaultAction` expose `get(item)`, `set(item,actionId|null)`, `resolve(item,id)` et `installed()`. Le service est actif quand le module l'est et n'exige pas l'activation des automatisations génériques.

**Test manuel recommandé :** sur un objet contenant plusieurs actions, choisir l'une d'elles comme action par défaut, fermer la fiche, utiliser l'objet depuis la feuille du personnage, vérifier l'absence du sélecteur puis les jets et dépenses habituels. Tester également la sélection directe d'une autre action et la remise sur « Demander à chaque utilisation ».
