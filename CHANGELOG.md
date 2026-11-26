# 1.48.0 — Événement générique de santé et libellés de paramètres

- Retire `(alpha)` de tous les libellés de paramètres FR/EN ; le statut expérimental reste au niveau de la release.
- Script Call natif `PF1AE:health:changed` (Après utilisation) : PV avant/après, seuils et contexte combat ; exécution MJ élu après variation réelle et avant application des états. Approbations existantes et Trusted Table. Pas de capacité spéciale codée dans le moteur.
- `event.register()` / `event.unregister()` préparent des exceptions par objet appelant, sans réentrer dans la file de réconciliation. Écritures validées après succès du script ; échec ou contexte périmé n'applique pas les exceptions préparées. Mort non interceptable.
- Hook public `pf1aeHealthChanged(actor,event)` après réconciliation, également sur pertes de PV internes dues à l'agonie et aux actions éprouvantes. Pas de rejeu sur ready, soins/dégâts sans changement réel ou modification du maximum.
- Tests de simulation, régression et documentation. Validation Foundry réelle à effectuer.

# 1.47.0 — Agonie, stabilisation et actions éprouvantes (alpha)

- Options séparées, désactivées par défaut, dépendantes du diagnostic de santé natif. Règles PF1 : Constitution DD 10 avec malus de PV négatifs, réussite naturelle 20, perte de 1 PV en cas d'échec, échec automatique pour dégâts continus identifiés. Exécution par MJ élu au début du tour, reçu persistant par acteur/combatant/round, sans rejeu après échec ou retour en arrière.
- Soins réels (delta HP natif) stabilisent sous 0 PV ; nouvelle perte de PV relance l'agonie. À 0 ou plus, retrait du seul état Stable natif direct ordinaire, préservation des sources externes complexes. Aucun changement de règle de mort.
- Coût direct de 1 PV après `pf1PostActionUse` pour les actions éprouvantes identifiables entreprises hors de combat mais conscient. Demande native sur acteur, MJ élu, reçu et perte de PV atomiques, aucun coût pour mouvement ou action annulée. Les soins via carte différée, types ambigus, récupération hors combat et restrictions complètes restent manuels.
- Aucun remplacement d'Automate Damage dans cette version : les pertes de PV ne passent pas par son intercepteur. Les futures étapes de remplacement sont documentées séparément.

# 1.46.3 — Conditions natives de santé sans Buff technique

- Remplace les objets Buff techniques par des ActiveEffects natifs directs identifiés par une provenance persistante, un par condition primaire ; causes létales/non létales séparées dans les flags. Migration des anciens porteurs vérifiés, sans effacer les effets indépendants.
- Adaptation de `ActorPF.setConditions` limitée aux collisions avec une contribution automatique directe, prenant en compte les pistes natives, immunités et effets indépendants. Délégation native sinon. Protection validée par un nouveau diagnostic sur tokens liés/non liés avant activation.
- Rétablit les notifications natives des transitions réelles de conditions lors de création/retrait des contributions automatiques ; la guérison retire les états appartenant au moteur mais ne relève pas automatiquement une créature à terre. Aucun retrait d'états directs de provenance inconnue.
- Retire les filtres HUD et panneau HTML ajoutés pour les buffs techniques. Conserve uniquement le filtrage d'icône identique lorsqu'une autre source visible fournit le même état.
- Tests de simulation, régression et diagnostic réel obligatoire. Les actions éprouvantes et la stabilisation automatique restent hors périmètre.

# 1.46.2 — Affichage des états dans le panneau latéral

- Corrige le doublon observé hors TokenHUD : une ligne buff temporaire et une ligne condition native pointent vers le même ActiveEffect.
- Filtrage visuel par UUID d'acteur (lié ou synthétique), ID de buff, provenance PF1AE validée, UUID d'effet relatif ou complet et identifiant de condition primaire. Lignes natives, états secondaires et buffs ordinaires conservés.
- Réapplique le filtre lors du rendu du panneau sans modifier ses documents ni ses gestionnaires ; retire le masquage si la condition native disparaît. Tests de simulation, vérification visuelle réelle requise.

# 1.46.1 — Présentation native des états de santé

- Retire uniquement les entrées `buff-<id>` des porteurs de santé PF1AE du HUD PF1 ; conserve les choix natifs et les buffs ordinaires.
- Libellés natifs, sans préfixe PF1AE ; mise à jour des porteurs existants sans changer leurs UUID, statuts ou provenance.
- Filtre les icônes identiques des porteurs techniques lorsque le même état primaire est déjà représenté par un effet visible. Respecte les réglages natifs de visibilité et les overlays ; aucune suppression mécanique d'état.
- Tests de simulation supplémentaires. Diagnostic de provenance à relancer après mise à jour ; contrôle visuel dans Foundry requis.

# 1.46.0 — Socle expérimental (alpha 1) Health Conditions

- API générique `healthConditions` : registre persistant par acteur/objet/clé, politique de suppression ciblée des contributions de PV létaux, sources non létales séparées, réconciliation MJ élu et nettoyage des sources orphelines.
- ActiveEffects transférés depuis des buffs natifs dédiés : pas de suppression des états indépendants ni de don fictif. Mort native au seuil officiel des créatures ordinaires, jamais neutralisée ni retirée automatiquement.
- Désactivé par défaut, incompatible avec Improved Conditions actif, validation de provenance native obligatoire sur un acteur temporaire lié et non lié. Créatures à régénération libre et variantes blessures/vigueur restent manuelles.
- Sources installées PF1 11.11 et Koboldworks Resting 3.0.0.1 vérifiées ; documentation, diagnostic et tests de simulation. 56 suites maintenues. Les actions éprouvantes, la stabilisation automatique et Férocité orque complète ne sont pas encore livrées.

# 1.45.0 — Synchronisation générique Mort ⇄ Vaincu

- Ajoute la synchronisation bidirectionnelle **état natif PF1 « Mort »** ↔ **combattant « Vaincu »** dans les rencontres Foundry 13.
- Sur création/suppression/modification de l'état Mort (ActiveEffect ou état d'Actor), met à jour le champ natif `Combatant.defeated`. Sur changement de `Combatant.defeated`, utilise `Actor.toggleStatusEffect()` pour appliquer ou retirer l'état natif Mort.
- Exécution exclusive sur le MJ élu et protection contre la récursion ; prise en charge des acteurs synthétiques de tokens et combattants liés à un même acteur.
- Ne déduit pas la mort des PV et ne modifie pas la logique PF1 de mourant, inconscient ou stable.
- Nouveaux tests de régression des deux directions, permissions du MJ élu, non-récursion, suppression d'effet et absence de condition native. Passage du registre CI à 55 suites.

# 1.44.1 — Correction de l'exécution directe des actions

- Corrige l'option « Ignorer le dialogue » de v1.44.0, qui pouvait laisser apparaître la fenêtre native malgré la case cochée.
- Étend le mécanisme existant avec une enveloppe de `pf1.actionUse.ActionUse.prototype.process()`. L'action étant déjà sélectionnée, transmet directement le paramètre natif `{skipDialog:true}` à PF1 11.11 **avant** la décision d'afficher la fenêtre.
- Conserve le sélecteur d'actions, `ItemPF.use`, les Script Calls, consommations, jets et cartes de chat natifs ; ne masque pas les dialogues personnalisés des scripts.
- Fonctionne avec et sans libWrapper. Conserve le hook `pf1CreateActionUse` comme compatibilité de secours.
- Tests de régression supplémentaires des paramètres de `process()` pour actions sélectionnées, scripts et publication, y compris via libWrapper.

# 1.44.0 — Ignorer le dialogue individuellement par action

- Case « Ignorer le dialogue » dans l'onglet Utilisation de chaque fenêtre `ItemActionSheet`, avec aide et traduction FR/EN.
- Préférence par identifiant natif d'action dans `flags.pf1-automation-engine.actionSkipDialog` ; nettoyage des actions supprimées, permissions OWNER, et comportement indépendant du nom.
- Généralisation dans `item-default-action.js` de l'interception `pf1CreateActionUse` et `createAttackDialog` ; les sélecteurs natifs ne sont pas supprimés, les dialogues personnalisés restent intacts.
- Conserve Action par défaut dans Avancé et retire l'ancienne option concurrente « Ignorer le dialogue » ; migration de `defaultActionSkipDialog` et compatibilité API historique.
- Ajout de `api.actionOptions`, documentation, et scénarios de tests par action et non-régression des autres automatisations.

# 1.43.1 — Correction du canal socket Foundry joueur → MJ

- Ajoute `"socket": true` au manifeste natif `module.json` : Foundry enregistre et relaie désormais le canal `module.pf1-automation-engine` entre clients.
- Corrige la cause des expirations `EffectGroup request timed out waiting for elected GM.` sur les requêtes `effectGroups.approveTemplate`, `applyGroup`, `extendGroup` et `stopGroup`, sous réserve que le MJ élu soit connecté et que les permissions de la requête soient valides.
- Le même canal profite aux services `saveOverrides`, `saveOutcomes`, `attackOutcomes`, `dynamicEffects`, `damageEvents` et `bootstrap`.
- Aucune modification des sockets, des vérifications OWNER, des automatisations de barde ou des règles de traitement de buffs. La mise à jour doit être suivie d’un **redémarrage complet du serveur Foundry**, puis d’une reconnexion des clients MJ/joueur.
- Ajoute un contrôle de déclaration socket aux tests multiclients existants et une vérification du manifeste embarqué dans les ZIP des pipelines GitHub.

# 1.43.0 — Auras passives génériques et bonus conditionnels aux sauvegardes

- `api.proximityAuras` accepte `savingThrowBonus`, `lifecycle.mode:"passive"`, `requiresAlive`, `requiresConscious` et `minimumClassLevel`, sans logique de classe codée.
- Application avant le jet natif via `pf1PreActorRollSave`, source structurée des descripteurs, groupes de bonus typés et non-cumul.
- Diagnostics explicites si le descripteur de la sauvegarde ou la contribution native au type de bonus est inconnue.
- Découverte automatique des Script Calls natifs `PF1AE:aura:passive` autorisés par le MJ ; pas de nouvelle action ni ressource.
- Exemple copiable d'Aura de courage (niveau 3, rayon PF1 de 3 m/10 ft, moral +4 contre `fear`) et documentation sur l'immunité personnelle.
- Tests de portée/statuts/conditions, de jets natifs, du cumul de moral, de la sauvegarde des données, et du multijoueur. Non-régression de Bouclier saint.

# 1.42.1 — Groupe d'armes virtuel « Arme improvisée »

- Ajoute « Arme improvisée » aux choix visibles dans la section des groupes d'une fiche d'arme PF1 11.11.
- Active/désactive la propriété native `system.properties.imp` en enregistrant l'Item ; ne force pas une valeur inconnue dans le champ `weaponGroups` à énumération restreinte.
- Synchronisation avec la case de propriété d'arme existante, respect des permissions et rendu sans doublons.
- Tests de régression de la présence du choix, de la persistance et du basculement de `imp`.

# 1.42.0 — API générique d'auras défensives persistantes

- `api.proximityAuras.register/stop/list/reconcile`, source native Item, UUID de token et d'acteur, clés idempotentes.
- Bénéficiaires alliés recalculés via grille v13, cases réellement occupées et distance native ; mouvement, arrivée et sortie.
- Buffs natifs PF1 typés : bonus de bouclier via `sac/shield` sans somme de CA calculée, expiration et nettoyages uniquement des effets détenus par PF1AE.
- Durées au compte d'initiative ou temps du monde, persistance F5 et déconnexions, MJ élu pour les effets.
- Lumière temporaire indépendante du token via AmbientLight (éclairage initial et éclairages d'autres modules conservés).
- Outbox d'expiration, hook `pf1aeProximityAuraExpired` et Script Call natif approuvé `PF1AE:aura:expired`, aucun message RP émis par le moteur.
- Tests `proximity-auras.test.cjs`, documentation de l'API, trois Scripts Calls complets de Bouclier saint (L'Art de la guerre, p. 60).

# 1.41.14 — Action par défaut : uniquement dans Avancé, si plusieurs actions

- UI réservée aux fiches natives Item PF1, pas aux éditeurs d'actions/attaques.
- Insertion exclusivement dans l'onglet Avancé, sans repli vers Détails/Actions/Description.
- Affichage uniquement si l'objet possède au moins deux actions natives ; retrait du contrôle lors d'un rerender si le nombre descend à une.
- Persistance des préférences et délégation à ItemPF.use inchangées ; tests de non-régression par type de fiche.

# 1.41.13 — Escalade et perte native du bonus de Dextérité à la CA

- Mouvement token `climb` : buff PF1 natif (`system.changeFlags.loseDexToAC = true`), visible sur token, aucune pénalité Off-balance −2 ni condition Flat-Footed.
- Une vitesse d'escalade positive conserve la Dextérité à la CA selon la règle de base PF1 ; changement de vitesse recalculé.
- Activation/retrait automatiques, buff unique par acteur, isolation par flag PF1AE, conservation des buffs non gérés.
- Tests sur entrée/sortie du mode Escalade, plusieurs tokens liés, vitesse d'escalade, buff désactivé, autres effets.

# 1.41.12 — Détection exacte du statut natif Levitating sur les tokens

- Prise en compte explicite du statut `Levitating` attribué depuis le HUD natif PF1 et synchronisation de `TokenDocument.movementAction` vers `fly`.
- Correspondance des tokens par UUID d'acteur stable, ainsi que réconciliation sur les mises à jour natives `updateActor` et `updateToken` lorsque le HUD ne produit pas un hook distinct d'effet.
- Tests du libellé exact `Levitating`, acteurs synthétiques ayant différents objets JS, mises à jour de HUD et retrait de l'effet.
- Aucun nouvel effet Flying, aucune modification des règles ou vitesses de déplacement de PF1.

# 1.41.11 — Lévitation native synchronisée avec le mouvement Vol

- Un effet PF1 natif Levitation/Lévitation actif place automatiquement le token en mode de mouvement `fly`, sans appliquer ni créer l'état Flying.
- Reconnaissance des noms anglais/français, statuts PF1, effets multiples, suppression/désactivation et scène/reconnexion.
- Le mode Vol ne confère aucune vitesse horizontale ou autre mécanique du sort Vol ; règles de Lévitation inchangées.
- Régressions ajoutées au test de synchronisation des effets natifs et mouvements.

# 1.41.10 — Abri aquatique selon l'immersion de PF1 Waters

- Source prioritaire : API PF1 Waters `getTokenWaterState()`, avec hauteur physique personnalisée et profondeur réellement occupée.
- Attaque venant de la terre : immersion ≥ 50 % et < 100 % = abri supérieur (+8 CA / +4 Réflexes applicables) ; immersion totale = abri total.
- PF1AE seul gère l'évaluation du niveau d'abri, le non-cumul, la comparaison de CA native et le blocage des attaques directes ; aucun bonus injecté dans PF1 Waters.
- Compatibilité des anciennes scènes conservée : flags canoniques `pf1-waters.waterRegion` puis historiques `pf1-skull-and-shackles.waterRegion`, avec désactivation prioritaire.
- Régressions couvrant seuils d'immersion, hauteur du token, fonds limités, désactivation et cas d'attaquant déjà dans l'eau.

# 1.41.9 — Restauration de l'option « Action par défaut » pour les fiches Item PF1 v11.11

- Rendu pris en charge via `renderApplication` (Foundry ApplicationV2) en complément des hooks `renderItemSheet` et `renderItemSheetV2`.
- Sélecteur proposé dès la première action native et non plus seulement à partir de deux actions.
- Emplacement de repli si la fiche n'expose pas l'onglet « Avancé » ; prise en charge des types d'objets PF1 compatibles avec une action native.
- Persistance inchangée, protection contre les doublons et aucun changement au moteur de jets ou de consommation.
- Régressions de rendu par type d'objet, feuille sans Avancé et idempotence.

# 1.41.8 — Expirations défensives génériques avec événements persistants

- Hook public `pf1aeDefenseModifierExpired` après suppression confirmée, avec identité, copie du modificateur et raison vérifiée (`death`, `rest`, `manual`, `other`).
- Reçus d'expiration persistants sur l'Item source et distribution par le MJ élu via `updateItem` natif, avec déduplication et reprise au démarrage/F5.
- Script Call `PF1AE:defense:expired` découvert automatiquement uniquement sur l'Item source, `postUse`, avec approbation exacte et mode Table de confiance.
- Les suppressions exécutées par `PF1AE:rest:daily` reçoivent une provenance de repos authentifiée ; suppression manuelle rétrocompatible, raison forgée classée `other`.
- Trois scripts complets Bastion du Bien documentés sans aucune règle spécifique codée dans PF1AE.
- Tests de mort confirmée, suppression manuelle/repos, refus des scripts non approuvés, persistance, source et acteur synthétique ; 52 suites maintenues.

# 1.41.7 — Abris directionnels temporaires (pavois)

- Nouveau service générique `api.directionalCover` : déclarations Item-sources, bord N/E/S/O, types d'abri, permission OWNER/MJ, persistance native, expiration absolue au début du prochain tour et nettoyage des effets obsolètes.
- Lecture de la géométrie des rectangles occupés et rayons entre coins intérieurs. Les attaques dont toutes les trajectoires franchissent le bord protégé reçoivent un abri total confirmé ; incertitude sur les diagonales mixtes/élévations non vérifiées.
- Pont vers `coverPF1.inspect()` et garde natif pré-jet `cover-native-bridge.js`, sans murs réels, CA ou bonus de Réflexes artificiels.
- Sélecteur natif DialogV2 à quatre directions et exemple complet de l'action `Grant Total Cover` dans `DIRECTIONAL-COVER.md`.
- Régressions dédiées, documentation et traductions FR/EN ; validation manuelle requise pour le cycle exact du Script Call PF1 et les scènes complexes.

# 1.41.6 — Provenance typée des défenses, Script Call de repos et expiration définitive

- Vérification des bonus typés déjà présents dans les CA natives normale/contact/prise au dépourvu par `api.nativeCover.inspectTypes()` ; intégration aux défense conditionnelles sans double cumul de parade et sans réécrire l'Actor. Sources indéterminées : diagnostic `uncertain` conservé.
- Découverte et exécution automatiques des Script Calls natifs `postUse` nommés `PF1AE:rest:daily` sur l'Actor effectuant un repos quotidien, avec les événements et snapshots du pont `pf1ActorRest`, filtrage par acteur, approbations de sécurité et déduplication.
- Expiration persistante irréversible des modificateurs `expiresOnDeathOf` lors de l'observation d'un statut `dead` confirmé, et réconciliation au retour du MJ.
- Tests de provenance de parade, comparaison native de CA, découverte du repos et suppression définitive à la mort ; maintenance des contrôles de packaging / publication.
- Documentation de l'API et exemples complets Bastion du Bien (activation et nettoyage sans macro d'inscription).

# 1.41.5 — Marqueur natif d'arme improvisée sur les fiches PF1

- Utilise **directement** `system.properties.imp` (champ booléen natif `WeaponModel.properties`), et **aucun flag PF1AE**.
- Réutilise l'input natif `name="system.properties.imp"` présent dans « Propriétés de l'arme » de PF1 v11.11, avec libellé détaillé et indication de fonction. Repli sans doublon lorsque le contrôle natif est absent.
- Injection via `renderApplication` pour les seules fiches natives `pf1.applications.item.WeaponSheetPF`. Sauvegarde par le `submitOnChange` natif de PF1 : aucun listener de modification persistant, pas de socket et aucune modification des règles de combat.
- Respecte `isEditable` et `isOwner`, les rerenders, la réouverture, les armes autonomes et celles d'un acteur ; aucune injection sur les autres types d'Items.
- Traductions française et anglaise, avec fallback explicite du fichier `lang/en.json` lorsque le client ne dispose pas de la chaîne localisée.
- Tests de régression dédiés (affichage, état, permissions, rerenders, localisation, types d'Items, contrôle natif et repli), intégrés au workflow de packaging et à la publication GitHub.

# 1.41.4 — Combat de mêlée sous l'eau et multiplicateur natif de dégâts

- Attaques de mêlée **tranchantes ou contondantes** effectuées par un acteur immergé : **–2 au jet d'attaque** via `pf1CreateActionUse.shared.attackBonus` et **dégâts physiques ×0,5** via le hook natif `pf1PreDamageRoll`, arrondis au plancher après les bonus de dégâts applicables.
- Détection de l'immersion par `Skull & Shackles.waterAutomation.getState` (avec fallback sur le flag `world.underwater`), sans mutation de la fiche ou des objets.
- Attaques perforantes non pénalisées ; types ambigus et inconnus laissés intacts ; liberté de mouvement identifiable sur l'acteur ignorée pour les malus aquatiques. Lignes séparées de dégâts d'énergie non réduites.
- Nouveau champ **Multiplicateur de dégâts** intégré au dialogue natif PF1 : 1 (normal), 0,5 (moitié), 2 (double), etc. La valeur se combine au multiplicateur aquatique sans cumul d'arrondis intermédiaires ; aucune duplication de dés ou modification après le jet.
- Remplacement du champ **Damage Multiplier** de Roll Bonuses lorsque présent (ancien contrôle neutralisé et valeur de formulaire purgée). **Les autres fonctions de Roll Bonuses restent indépendantes et ne sont pas migrées par cette version.**
- Deux paramètres de monde indépendants et tests de régression dédiés intégrés aux workflows Windows et de publication.

# 1.41.3 — Synchronisation bidirectionnelle entre Vol/Nager et le déplacement Foundry

- **PF1 effet natif Vol / Flying activé** → `TokenDocument.movementAction = "fly"` ; **Nager / Swimming activé** → `"swim"`.
- **Effet natif désactivé ou supprimé** → mouvement normal `"walk"` (ou autre effet de déplacement toujours présent).
- **Mode de déplacement `fly` / `swim` sélectionné sur un token** → activation de l'état natif PF1 correspondant par `Actor.toggleStatusEffect()`, désactivation de l'état incompatible. Retour à `walk` → désactivation de Vol et Nager.
- Identifiants d'états résolus depuis le registre natif `CONFIG.statusEffects` sans effets artificiels ou nouveaux modes de vitesse. Libellés anglais et français acceptés.
- Seul le MJ actif synchronise les modifications en présence d'un MJ connecté ; protections contre les boucles d'événements et les effets dupliqués. Plusieurs tokens du même acteur sur la scène utilisent le même mode.
- Tests de régression dédiés ajoutés au workflow de construction Windows ; aucune modification aux vitesses, abris, tirs ou malus aquatiques.

# 1.41.2 — Abri aquatique selon profondeur et niveau d'eau Skull & Shackles

- Remplace l'**abri mou +4 CA automatique** fondé sur `flags.world.underwater` (v1.40.11) par la détermination de la profondeur réelle dans une Region d'eau Skull & Shackles (`flags["pf1-skull-and-shackles"].waterRegion.enabled/surface`).
- Pour une attaque depuis la terre ferme, la base du token cible à une altitude **≤ surface − hauteur/2** (mais strictement > surface − hauteur) donne **abri supérieur +8 CA / +4 Réflexes** ; **≤ surface − hauteur** donne **abri total** et empêche l'attaque directe.
- Seuils inclusifs, indépendants du niveau absolu de l'eau. La hauteur de corps est calculée comme la taille occupée en cases × la distance de grille : 1×1 / 1,50 m → −0,75 m (poitrine), −1,50 m (immersion complète) si surface à 0 m.
- Vérifie l'appartenance à la Region via `RegionDocument.testPoint()` au centre 2D du token (élévation de la Region), conformément à Skull & Shackles ; un flag `underwater` isolé ne confère plus d'abri.
- N'applique pas d'abri de surface si l'attaquant est lui-même immergé. Les abris des murs restent effectifs et non cumulables. Une région d'eau connue n'est pas un obstacle de région 3D ; les régions non reconnues restent indéterminées.
- Vérifie les seuils en pieds et en mètres, les niveaux de surface non nuls, le mode 3D avec Levels et la carte d'attaque native ; aucun changement aux pénalités des tirs traversant l'eau de la v1.41.1.

# 1.41.1 — Libellé du tir sous l’eau

- Le libellé du malus de tir sous l’eau est désormais explicitement bilingue :
  - Foundry en français : **Tir sous l’eau**
  - Toute autre langue : **Underwater shot**
- Le comportement ne dépend plus du fallback de traduction de Foundry.

# 1.41.0 — Tirs à distance à travers l’eau

- Ajout d’un calcul automatique du malus PF1 des attaques à distance traversant une zone d’eau.
- Règle appliquée : **–2 au jet d’attaque par tranche entamée de 1,50 m / 5 ft d’eau traversée**, en plus des malus normaux de portée.
- La longueur immergée est fournie par l’API `waterAutomation` de **PF1 — Skull & Shackles** et tient compte de l’emprise des Regions d’eau ainsi que des élévations Foundry/Levels.
- Le malus est injecté avant le jet dans `shared.attackBonus` : aucun Actor ni objet n’est modifié.
- Fonctionne pour les attaques à distance natives PF1 de type `rwak` et `rsak`.
- Les armes de jet (`twak`) ne sont pas modifiées ici : la règle PF1 les rend inefficaces sous l’eau et fera l’objet d’un blocage dédié séparé.
- Nouveau réglage de monde **Malus automatiques des tirs à travers l’eau**, activé par défaut.
- Nouvelle API `underwaterRanged` pour diagnostics et calculs.

## v1.40.11 — Skull & Shackles underwater token grants soft cover

- Read the **exact generic token flag** `flags.world.underwater === true` from the targeted TokenDocument, as written by Skull & Shackles v1.23.0 water regions. No required runtime dependency on the campaign module; no Actor or TokenDocument mutation.
- A submerged **target** gets intrinsic **soft cover +4 AC / +0 Reflex** in ranged, adjacent melee, melee touch and reach attacks, including when no interposed creature is present. The attacking token's own flag never grants the defender cover. The bonus disappears as soon as the target's flag is false or absent.
- Apply nonstacking precedence: underwater replaces none/partial (+2 AC) with soft (+4 AC); keep confirmed normal wall cover (+4 AC and +2 Reflex), improved cover (+8) and total cover/direct-attack cancellation. Preserve uncertain geometry without guessing a weaker wall category.
- Reuse the existing native two-line localized card display: **Abri mou / +4 CA** in French and **Soft cover / +4 AC** otherwise. No new chat message or permanent AC change.
- Add geometry and native PF1 ActionUse tests for 2D/3D, melee/ranged/touch, strict boolean flag, disappearance, wall precedence and card label.

## v1.40.10 — Ranged cover when a red ray reaches the target's wall border

- Fix PF1 ranged and nonadjacent melee/reach corner-ray analysis for a wall **running along the target's square border**. A ray to a target corner lying strictly **inside** the actual wall segment is an obstruction, not just a harmless wall-tip graze. One obstructed target-corner ray from the chosen attacker origin establishes cover, even when other lines from that same origin are clear.
- Preserve the best attacker corner, strict 50%-visibility check from attacker token center, normal +4 CA / +2 qualifying Reflex versus partial +2/+1, 2D/3D wall-height semantics, soft cover, and native bilingual card display.
- Preserve conservative treatment of isolated wall-tip contacts, zero-length walls, unverified geometry and open doors. No Actor AC mutation or attacks-of-opportunity automation.
- Add regression for the supplied screenshot's green/red rays, reverse wall orientation, zero-length wall and open door; verify +4 cover through the PF1 native ActionUse bridge.

## v1.40.9 — Treat wall endpoint visibility rays as uncertain; shorten normal cover label

- Fix the strict PF1 more-than-half-visible test near a diagonal wall corner: a ray that touches the wall endpoint **is not proof of visibility**. Previously nine grazing samples in a 9×9 measurement could artificially raise the exposed fraction to 55.6%, incorrectly reducing cover to partial (+2 AC). These samples now count as unknown; an unproven majority cannot override normal wall cover (+4 AC).
- Preserve the attacker's token-center observer origin, 2D and 3D silhouette/body-height sampling, genuine more-than-half partial cover, wall/door geometry and native actor-AC safety.
- Shorten only the **normal-cover** native card label to `Abri` above `+4 CA` in French, or `Cover` above `+4 AC` for all other languages; keep specific partial, soft, improved and total grade descriptions.
- Extend regression tests for the screenshot's diagonal corner with visibility diagnostics and both localized card labels.

## v1.40.8 — Fix melee cover for diagonal adjacency near walls

- Correct the attacker/target occupied-rectangle separation calculation: compare each left edge against the **other square's right edge**, and each top edge against the **other square's bottom edge**.
- Fix a direction-dependent bug whereby a southwest melee attacker striking a northeast diagonally adjacent target (and some other orientations) was incorrectly classified as a **nonadjacent/reach** attacker. This incorrectly selected the best clear ranged corner and could omit melee wall cover and its native card label.
- Preserve PF1 adjacent-melee all-corners wall cover for corner-ending walls, windows and doors. Actual nonadjacent attacks still use reach/ranged rules and intervening-creature soft cover.
- Test eight different cardinal/diagonal adjacent orientations, a truly nonadjacent reach attack, the screenshot's diagonally adjacent wall-corner layout in 2D/3D, and the same layout through the native ActionUse bridge.
- Leave manual Attacks of Opportunity untouched as requested.

## v1.40.7 — Pathfinder 1 melee cover and reach attacks

- For **adjacent melee** attacks, check all attacker-square corners: one confirmed wall-blocked corner establishes cover despite another clear corner. Adjacent interposed creatures never grant soft cover.
- For **nonadjacent melee/reach** attacks, use the ranged-cover best-corner method and include soft cover from other creature tokens.
- For **Large or larger melee combatants** (attacker and/or defender), evaluate adjacent choices of occupied squares and choose the most favorable legal pair. Preserve original token-center visibility and target body height for the 3D majority-visible rule; avoid invented bonuses for unresolved geometry.
- Detect walls **coincident with the shared edge** of two adjacent squares. An opaque full shared-border wall or closed/locked door proves total cover in 2D and prevents the direct attack; open doors do not. Verify full-height blocking for shared-border total cover in 3D.
- Correct low-obstacle proximity: equal distance from the obstacle does not let the attacker ignore it; an attacker must be strictly closer. Medium (+2) and Small (+4) 3D low-wall melee cases are covered by regression.
- Native Pathfinder 1 `mwak`/`msak` attacks receive the same cover evaluation, localized two-line native target-card note, and total-cover gate as ranged attacks.
- No automatic interception of independently triggered Attacks of Opportunity or nonstandard combat maneuvers in this release; standard PF1 cover/AoO constraints remain documented.
- Extend dedicated geometry, native ActionUse melee/touch, reach soft-cover, square-choice and closed/open door regression tests.

## v1.40.6 — Right-hand two-line cover label in native target miniature

- Move the localized cover indicator from the far left to the **rightmost child** of the existing PF1 native attack-target miniature, after the portrait and AC display, as requested from the Foundry screenshot.
- Render the cover grade and bonus on **two short lines**, text aligned **left** within the label (e.g. `Abri partiel` above `+2 CA`), automatically in French when Foundry language is `fr` and English otherwise.
- Use normal inline flex layout with no absolute positioning over the portrait, icons, or AC values. Existing native attack-roll and target controls remain unchanged.
- Preserve confirmed-cover-only labels, total cover naming, single-card updates and nonduplication, native PF1 thumbnail AC adjustments, and no Actor or attack-roll changes.
- Add regression tests verifying compact two-line alignment and that the note appears after the target's AC and before the selected target's closing tag.

## v1.40.5 — Bilingual compact cover note in native attack card

- Embed one compact **cover grade and AC bonus** note inside the existing native PF1 target thumbnail: **Abri partiel : +2 CA / Partial cover : +2 AC**, **Abri normal : +4 CA / Normal cover : +4 AC**, with equivalent soft (+4), improved (+8), and total-cover (no invented numeric AC) labels.
- Use French labels only when Foundry language is `fr`, and English for all other languages. Add matching keys to the French and English module translations.
- Persist the label in the native ChatMessage content for stable rerenders; never append a separate footer or duplicate note when multiple hooks resolve the same attack. Label the first attack summary in full attacks only.
- A confirmed cover diagnosis may be labeled even when native AC provenance is too ambiguous to update the shield numerically. Uncertain cover never receives an invented label/bonus.
- Preserve PF1 native combat values, total-cover prevention, target-specific AC thumbnail adjustment, normal/soft/improved/partial distinctions, and no changes to Actor data.
- Add regressions for French, English and other language fallback, all grades, total cover, uncertain source defense, repeat hooks and nonduplication.

## v1.40.4 — Visible target fraction from attacker token center

- Compute PF1's **more-than-half-visible** partial-cover threshold from the **center of the attacking token**, matching the typical Foundry map vision origin. Use the same center for every sample in 2D and for every body-height slice in 3D.
- Keep native PF1 attack-corner ray tracing independent for best attack angle, line of effect, total cover and reached targets; the center is only used to estimate the visible fraction of the defender's occupied area.
- Publish the observer origin and shared visible fraction in `origins[].visibility.sourcePoint` and `origins[].visibility.source` for diagnostics. Large attackers still retain every PF1 selectable attack corner, without moving their vision source to one of those corners.
- Preserve 3D grid-based body height, closed-door wall treatment, window rules, soft cover, uncertain geometry and native attack-card AC-only modifications. The geometry approximates map sight; it does not inspect Foundry's rendered fog or arbitrary third-party visibility effects.
- Extend 2D/3D regressions for center-origin ray sampling, stable visible fractions across attack corners, and Large attackers.

## v1.40.3 — Grid-footprint body height and closed doors as walls

- Use the target's occupied horizontal grid footprint as its 3D body height: 1×1 token = one grid-distance (1.5 m on a metric 1.5 m grid), 2×2 token = two grid-distances (3 m). The target's eye/LOS height is no longer used as its total body height.
- Apply the visible-majority rule across that body volume. A fully blocked eye-height attack ray does not by itself prove total cover if higher body samples remain exposed; preserve strict total cover when all target body samples and corner rays are blocked.
- Closed and locked Foundry doors are ordinary solid walls for cover regardless of window-like settings or stale GM cover-grade flags; open doors provide no obstruction. Standard normal/partial wall cover rules still apply to a partly exposed creature.
- Preserve 2D behavior, window rules on actual windows, normal/soft/improved cover, native thumbnail display, Actor immutability and conservative unknown geometry.
- Add 2D/3D closed, locked and open door tests, body-height and metric-grid tests, and total-cover regression guards.

## v1.40.2 — Partial cover when a majority of the target remains exposed

- Implement the Pathfinder 1e **strictly more than half visible** criterion for partial cover: automatically reduce ordinary wall cover from **+4 AC / +2 qualifying Reflex** to **+2 AC / +1 qualifying Reflex** when the selected attacker origin has a verified majority-exposed target silhouette.
- Use a fixed grid of interior target-space samples in 2D and five vertically spaced samples in 3D, tracing actual supported native wall crossings. The sample-based silhouette is a deterministic proxy for the target's occupied space, not an anatomical or pixel-perfect measurement.
- Evaluate the rule after the existing total-cover check, and before the best-angle selection. Preserve native soft cover, windows, improved cover, GM-classified wall grades and special size-dependent low walls, without stacking modifiers or changing Actor AC.
- Keep ordinary cover at **50% visible or less**, and avoid reductions for unknown wall/height geometry or uncertain creature boundaries. Include per-origin visibility diagnostics when computed.
- Add regression cases for majority-visible targets in 2D/3D, majority-obscured targets, existing windows, solid walls and conservative geometry.

## v1.40.1 — Default 2D walls, native windows and 3D low-wall sizes

- Keep ordinary 2D walls unbounded by default: verified full corner-ray blockage confirms **total cover**, while partial ray obstruction continues to grant normal cover and corner-only grazing remains nonblocking.
- Recognize movement-blocking, sight/light-transparent **native window segments** (or explicit GM `coverGrade=window`) as **improved cover +8 AC / +4 Reflex**, not total cover. Adjacent attackers ignore the window's cover without ignoring other wall obstacles.
- Recognize verified ground-based 3D walls strictly below **3 ft** or **1 m**, depending on scene units. Within the Pathfinder low-obstacle range, and when the attacker is farther from the wall, automatically classify **Medium targets as partial cover (+2/+1)** and **Small targets as normal cover (+4/+2)**. A low wall may protect even when the sampled eye-height ray clears its upper edge.
- Retain conservative handling when target size, scene units, geometric details, wall-type provenance, or Levels collision cannot be verified; retain GM overrides and native thumbnail-only display without modifying Actors or attack rolls.
- Extend geometry tests for 2D opaque walls without height metadata, window adjacency, automatic native window recognition, feet/meters low walls and strict thresholds.

## v1.40.0 — GM-classified partial and improved cover

- Recognize Pathfinder 1e **partial** wall cover (+2 AC, +1 cover-related Reflex) and **improved** wall cover (+8 AC, +4 cover-related Reflex), alongside ordinary (+4/+2), soft (+4/+0) and total cover.
- Keep native Foundry 13 wall collision and 2D/3D verified height checks. Wall grade is persisted in `flags.pf1-automation-engine.coverGrade` only by explicit GM classification; never infer body exposure from a single 3D eye-height ray.
- Preserve the attacker's best available PF1 corner choice. Partial/soft/normal/improved grades do not by themselves prove total cover; only fully proven ordinary solid-wall obstruction blocks direct attack.
- Update all three native PF1 target thumbnail AC numbers for confirmed partial/improved cover, with no Actor/roll mutations and no redundant chat footer. Keep native cover-provenance nonstacking.
- Expose `coverPF1.setWallGrade(wallDocument, "partial" | "normal" | "improved")` to GM scripts; document a ready-to-use selected-wall macro.
- Retain manual, source-bound Reflex save modifier review: attack geometry alone cannot identify whether a particular Reflex effect benefits from cover.
- Add automated grade and thumbnail regressions and a PR workflow for cover-specific tests.

## v1.39.13 — Best-angle attacker choice for cover

- Automatically choose the **most favorable origin corner** for ranged and non-adjacent melee/reach attacks when resolving cover on the PF1 square grid.
- If an attacker corner has no strictly blocked projectile ray and the only uncertainties are exact wall-endpoint or creature-boundary grazing contacts, treat that corner as a clear angle: confirmed **no cover**. Another origin showing blocked rays does not force +4 when the attacker has a better origin.
- Reproduce the user's second pier diagnostic in 2D and 3D: four origins with confirmed wall crossings `[0,0,1,1]` and grazing contacts `[2,2,1,1]` now yield `attacker-selected-best-grazing-angle` and no cover. The previous case where all four origins had proven blockers still yields normal cover +4.
- Only specific tangent/corner grazing contacts can be discounted. Unknown movement wall, wall type/height, Levels collision, roof and other unverifiable geometry remain uncertain; total cover and adjacent melee logic are unchanged.
- Preserve the v1.39.12 native thumbnail-only AC display, typed cover nonstacking, range guards, actor-sheet immutability and roll safety.
- Extend maintained geometry tests for the second pier's exact ray counts and for walls of unverified movement type.

## v1.39.12 — Only show cover in native target AC icons

- Remove the redundant "PF1AE — abri contre cette attaque" footer from newly posted PF1 attack chat cards. The user can already see all three effective cover-adjusted AC values inside the target miniature as of v1.39.11.
- Preserve the native target thumbnail-only display: normal, touch and flat-footed AC, with per-type explicit cover nonstacking. Do not mutate the Actor, token, rolls or damage.
- Native post-use fallback and paired attack-resolution events use the same serialized thumbnail writer and no longer append separate cover sections, including on full attacks or when cover geometry cannot be verified. If no matching native target markup exists, leave the original ChatMessage untouched.
- Retain the internal formatting helper as a diagnostic API only; it is never inserted into the chat card. Test no-footer behavior for verified and uncertain cover, repeated events, a card without target markup and native post-use without a paired roll event.
- Keep all proven cover geometry, reach and total-cover cancellation unchanged.

## v1.39.11 — Include cover in all three native PF1 target miniature AC figures

- Fix v1.39.10's overly limited display: confirmed normal/soft cover applies to normal, touch and flat-footed AC. The original PF1 target chat miniature now shows **Harpy 20 / 17 / 17** rather than 20 / 13 / 13 when native AC is 16 / 13 / 13 and none of the three figures already includes cover.
- Read all three native target Actor AC totals without changing documents. Inspect explicit native cover sources independently for normal/touch/flatFooted and add only the missing amount to the corresponding displayed figure; never stack the same explicit cover twice.
- Preserve the actual attack's authoritative resolved defense when available. A missing or ambiguous cover breakdown for one AC does not cause an unverified number to be displayed for that type.
- Continue changing only the original persisted ChatMessage target-thumbnail values scoped by Token UUID; do not change the target Actor, roll results, damage, token, or other target miniatures. Keep per-attack details on full attacks.
- Extend the native-cover bridge regression with Harpy 16/13/13 -> 20/17/17 and a per-type already-covered and uncertain-case guard; preserve prior range/geometry, chat and deduplication tests.

## v1.39.10 — Show cover-adjusted AC directly in the native target miniature

- In response to Ezren attacking Harpy, display the effective cover-adjusted target AC inside the **native PF1 chat target shield**, changing its visible **16 to 20** when the same attack has a confirmed normal cover +4. The detail row "CA cible avec abri : 20" remains for transparency.
- Update the existing persistent ChatMessage content, not the Actor's AC, any dice result, or the live Canvas token. The targeted replacement uses the native PF1 `.attack-targets .target[data-uuid] .ac .normal .value` structure and requires matching target UUID, original displayed AC, confirmed cover, and effective defense. Other targets and the touch/flat-footed icons (13/13 in the live report) remain unchanged.
- For touch and flat-footed attack types, update only the corresponding native defense figure. Keep the thumbnail stable on subsequent full-attack roll outcomes, with separately numbered PF1AE cover detail for each attack.
- Degrade safely: if target markup is unsupported or multiple candidates exist, keep the native miniature unchanged rather than replacing an arbitrary number. Verified cover geometry and no-double-counting are unchanged.
- Extend maintained regression for the native PF1 target thumbnail, UUID scoping, other defense icons, manual notes, repeated events and existing message updates.
- Experimental: test with live Foundry 13 / PF1 11.11 target card and verify the native target UI still behaves correctly.

## v1.39.9 — Simplify cover AC using only explicit native cover sources

- Resolve the actual PF1 11.11 breakdown supplied by Harpy: `Armure de cuir` has `modifier:null` as an item header, while its +2 armor contribution has `modifier:"base"`; Dexterity and base AC also have null/undefined modifiers. These normal entries previously triggered `untyped-or-unclassified-native-ac-source` and prevented an otherwise confirmed +4 from being applied.
- Only recognize native source entries **explicitly tagged `modifier:"cover"`** as existing cover. Ignore unrelated typed, null, undefined and untyped native AC entries for the purpose of cover stacking. A native +4 `cover` still prevents a duplicate +4.
- With a confirmed cover and no explicit native cover, use **native AC +4** as the effective defense and display that value on the existing native attack chat card. Harpy native AC 16 + confirmed normal cover 4 = target-specific AC 20. Native actor AC and attack roll are not modified.
- Preserve uncertain outcomes for malformed or conflicting explicit cover entries and unverifiable geometry. Custom untyped modifiers that actually encode cover remain the GM's responsibility, because they cannot be distinguished from generic untyped bonuses by this deliberately simple rule.
- Regression test now reproduces all six original Harpy source entries, verifies native baseline cover 0 and existing typed-cover no-double-counting, and retains failure for malformed typed cover.

## v1.39.8 — Display a qualified cover AC when native AC source provenance is uncertain

- Live confirmation: v1.39.7 cover geometry is now correct (`confirmed / normal / acBonus:4`) for Ezren attacking Harpy, but the native PF1 AC baseline is `16` with a source classed as `untyped-or-unclassified-native-ac-source`, so the native damage/attack resolution correctly declines to invent a definitive `defense.value`.
- Add a **display-only** fallback for this precise situation: the native attack chat card shows `Indicative AC with cover: 20`, `Native AC: 16`, `Cover bonus: +4` and an explicit **unverified** warning. This is arithmetic information for the GM, not a proven effective target defense. Existing native source bonuses could already incorporate cover.
- Do not alter the PF1 actor's AC, roll, attack result, cover geometry, or auto-hit/miss adjudication. A verified native cover baseline still yields an authoritative effective AC with correct nonstacking. Uncertain geometry and missing native base AC still do not fabricate a numeric value.
- Add a regression matching confirmed normal cover +4, AC 16 and ambiguous native source, while preserving the existing tests for truly verified AC and unknown cover geometry.

## v1.39.7 — Prove partial cover even if some rays graze wall endpoints

- Fix a confirmed live pier case: in both 2D and 3D the detector reported `uncertain / wall-or-creature-contact-ambiguous`, though ray diagnostics showed all four attacker origins had at least one definite `solid` wall crossing; other rays merely `wall-grazed`.
- Determine cover on **all potential origin corners** before allowing an unknown tangent ray to prevent a decision. If every origin has at least one strictly proven obstruction, cover is confirmed (normal +4 for walls, soft +4 if a proven soft-only origin exists), regardless of other tangent rays. This uses the same Pathfinder 1e target-corner rule.
- Total cover remains strictly limited to cases where every ray from every origin is solid-blocked; an uncertain ray can never be promoted into total cover. If any origin lacks a proven obstacle and has uncertain rays, keep the result uncertain; no speculative +4.
- Add a ray-level regression with a partial pier-edge wall between token squares: at least one solid ray for every origin plus endpoint-grazing rays, which must produce normal cover +4. An isolated tangent without proven blocking does not confirm normal cover.
- Preserve previous native-card effective AC rendering, no double-application, actor-sheet immutability, elevation and range safety.

## v1.39.6 — Fix 3D cover at different native token LOS heights

- Reproduce live player diagnostic from a pier scene: both attacker and target token elevation are `0`, but PF1AE cover detection returns `uncertain / different-sampled-attack-heights` and therefore never annotates the target's effective AC on the native PF1 chat card.
- In 3D cover mode, stop requiring equal attacker and target `losHeight` values when their scene elevations are equal. A difference in sampled eye height produces a sloping projectile ray, not inherently an unresolvable attack.
- For walls whose native movement/door state is verified, calculate the ray height at each strictly crossed XY wall segment and evaluate the actual `wall-height` vertical bounds. Confirm normal cover +4 when a partial wall obstructs, no cover for a low wall below the shot, and total cover for a fully blocking wall.
- Keep uncertain results on tangent/grazing rays, unknown bounds, roofs and unverified Levels collisions. Do not infer cover solely from Foundry partial token visibility; do not change Actor AC, native roll, resources or add a second chat message.
- Extend maintained PF1 corner-ray tests for different token LOS heights at the same 0 elevation, partial/low/full walls and unknown wall bounds. Native chat card presentation remains provided by the v1.39.5 post-use integration.
- Experimental: live scene with Better Roofs/Levels and wall-height flags still needs confirmation; if the new cover reason is another `uncertain` category, diagnostic will identify it.

## v1.39.5 — Reliable native chat-card cover AC after weapon use

- Fix missing target effective AC annotations on valid native Pathfinder attack cards that do not produce a matching PF1AE `pf1AttackRoll` resolution event. The post-use chat-card route now directly inspects a single targeted attack, its geometry and target Actor defense, and displays the **confirmed cover-adjusted AC** on the existing ChatMessage.
- Example: the target's native PF1 shield still shows **16** (unchanged character defense), while a separate **Target AC incl. cover: 20** annotation shows 16 + verified +4 against that specific attack. We do not overwrite the native target shield icon or change the Actor's sheet values.
- Native PF1 cover already included in typed AC sources is detected and not added a second time. If the engine cannot verify the native bonus provenance or cover geometry (e.g. edge/corner rays around a dock), it shows an **Unverified** message rather than inventing a number.
- The new direct post-use route reuses existing serialized/idempotent chat updates and coexists with the detailed per-attack event route. Cover blocking, action range, attack rolls, ammo/charges, and the underlying PF1 chat card remain untouched.
- Add regression testing for a native chat card without any PF1AE attack-roll event and for uncertain cover geometry.
- Experimental: verify the card update on live Foundry VTT 13 / PF1 11.11, and inspect the exact cover geometry if partial vision yields an uncertain result.

## v1.39.4 — Display the target's cover-adjusted AC in the native attack chat card

- Display **Target AC incl. cover**, **Native AC**, and the confirmed cover modifier (+4 when normal/soft cover) directly on the original PF1 chat card for a single targeted attack; no new chat message, attack roll, Actor sheet mutation or additional AC modifier.
- Recognize when native PF1 AC sources already include the cover bonus (e.g. native 24 with typed +4 cover) and explicitly label it as already included, avoiding a second +4. When native AC source provenance is uncertain, show an unverified effective AC instead of displaying a guessed number.
- For full attacks and sequential roll-resolution events, append distinct per-attack effective-AC entries and serialize asynchronous ChatMessage updates so that simultaneous events do not overwrite one another; deduplicate repeated events by attack index and target UUID.
- Preserve early total-cover cancellation before attack rolls and other existing geometry and range checks.
- Expand the cover-native-bridge regression suite to verify effective CA, same-card multiattack entries, duplicate events, simultaneous events, existing cover and unknown source safety.
- Experimental: user verification required with real PF1 11.11 chat cards and specific cover layouts.

## v1.39.3 — 3D elevation-aware action range cancellation (experimental)

- Correct an omission in the action range gate: v1.39.2 returned `uncertain` whenever attacker/target elevations differed, so a melee attacker with 1.5 m reach could attack a target 2 m below while standing in an adjacent square.
- Include the absolute elevation difference in the range calculation on square grids. When all three axes are measured in whole grid-square increments and the native 2D ruler agrees with the PF1 alternating-diagonal convention, measure in three dimensions using the first diagonal = 1 square, second diagonal = 2 squares rule. One horizontal + one vertical grid step remains one diagonal; two consecutive 3D diagonals consume three grid squares.
- For fractional or unverifiable grid distances, use a conservative lower bound `max(native horizontal distance, absolute elevation difference)` to avoid incorrectly rejecting legal moves. Unverifiable elevation remains `uncertain` and never blocks.
- Preserve action-specific feet/meters conversions, melee reach from native PF1, ranged spell/ability/weapon ranges, closest occupied squares of Large targets, and early native dialogue cancellation without resource expenditure. Expose `distance`, `horizontalDistance`, `verticalDistance` and `distanceMode` in the existing action-range API.
- Extend maintained regression tests for 1.5 m reach vs 2 m elevation difference (no dialog or ammo), one 3D diagonal, two 3D diagonals, fractional elevation, missing elevation, and Cold Blast 30 ft on a metric map with target vertically beyond 9 m. Verify on live PF1 11.11.

## v1.39.2 — Use PF1 native Higher Ground checkbox only (experimental)

- Replace the v1.39.0/1.39.1 injected `1[PF1AE Higher Ground]` attack bonus with **native attack-dialog checkbox preselection only**. PF1 retains responsibility for its own normal +1.
- When a melee attacker has higher token elevation than one target within native PF1 melee reach, find the existing Higher Ground / Position surélevée checkbox in the native AttackDialog at render time and click it via the native handler. Leave already checked boxes as-is; preserve the player's ability to uncheck after rendering and never reapply on re-render.
- Remove all GM terrain support confirmations, token flags, Trusted Table requirements and separate bonuses. Old `highGroundRequireSupport` setting is hidden and ignored to preserve Foundry world settings registration.
- Keep opt-in `autoHighGround` setting (default false), melee-only and basic native reach checks. Disable Roll Bonuses handling for this checkbox to prevent competing automation.
- Add regression verifying correct native checkbox click, no `shared.attackBonus` mutation, manual deselection persistence, unsupported actions, reach, altitude, disabled setting and fallback when checkbox cannot be recognized.
- This version identifies the checkbox by its native attributes or displayed label, rather than guessing undocumented `shared.useOptions` fields. Verify live compatibility with PF1 11.11 dialog HTML. 

## v1.39.1 — Trusted Table Mode bypasses high-ground GM confirmation (experimental)

- When the existing world setting `trustedTableMode` is explicitly enabled, the higher-ground engine no longer requires the GM's per-token `highGroundSupported` flag. In secure mode, the previous confirmation behavior remains unchanged.
- All safety checks remain active regardless of mode: melee-only action, single target, confirmed positive elevation difference, non-flying attacker, square-grid geometry and native melee reach. The setting only affects the extra terrain-support confirmation.
- Add regression tests for trusted-table true/false, correct no-flag +1 in trusted mode, airborne and out-of-reach rejection, and restoration of confirmation when trusted mode is disabled.
- Native PF1 melee attack dialogs already provide a manual higher-ground checkbox. This patch **does not change that checkbox** because its internal field/ownership was not verified in PF1 11.11. Keep that manual checkbox unchecked when PF1AE has already injected its +1 modifier to avoid duplicate application; native checkbox integration is a separate compatibility change.

## v1.39.0 — Higher-ground melee attack automation (experimental)

- Add an opt-in +1 higher-ground modifier for verified single-target melee attacks in Pathfinder 1e. It injects a single labeled native `shared.attackBonus` part on `pf1CreateActionUse`, without extra attack rolls, card edits, actor mutation or weapon changes. Ranged attacks and maneuvers do not gain this bonus.
- Compare attacker/target elevation, grid-square geometry, native effective melee reach and a bounded one-square vertical difference. The safer default also requires an explicit GM token flag `pf1-automation-engine.highGroundSupported=true` as proof of supported terrain, to avoid granting +1 to a creature simply flying above an enemy. A separate opt-out setting permits elevation-only adjudication when the GM chooses.
- Preserve unknown or conflicting situations without guessing, do not inject a duplicate higher-ground modifier when a recognized native/external bonus exists, and leave other combat modules' native roll workflow untouched. Disable Roll Bonuses higher-ground automation when enabling this module.
- Export `game.modules.get("pf1-automation-engine").api.highGround.inspect`, `inspectActionUse`, `prepare`, and `lastDiagnostic`; add dedicated regression covering metric scenes, verified terrain, unconfirmed terrain, flying, overreach, ranged attacks, disabled settings and no duplicates.
- Experimental compatibility: native dialog higher-ground checkbox integration and special 3D support surfaces require live PF1 11.11 validation; this version does **not** set that checkbox. Manual use of the native higher-ground checkbox at the same time as this injected bonus would double count.

## v1.38.6 — Correct metric-scene flanking threat reach (experimental)

- Fix incorrect flanking denial on metric Foundry scenes when native PF1 melee threat reach is already expressed in scene units (e.g. 1.5 m). The tactical positioning engine previously inferred imperial units whenever `pf1.settings.distance.metric` was false or unavailable, converting legal 1.5 m reach to 0.45 m.
- Use the native prepared reach directly in scene units; retain strict opposite-border geometry, same elevation, valid attack/threat evidence, and the existing native flanking checkbox. Never add an independent attack bonus.
- Add regression cases for flanking by two opposite adjacent allies at native 1.5 m on a metric scene with undefined and false global metric preferences; verify truly insufficient reach does not qualify, and preserve previous feet-grid and Large creature tests.
- Experimental: real-world verification needed for special reach weapons and conditional threatening, which remain conservative.

## v1.38.5 — Correct native melee reach on metric scenes (experimental)

- Fix incorrect rejection of standard melee actions such as Zether's rapier on scenes measured in meters. Native PF1 melee `getRange({type:"max"})` already provides effective melee reach in scene units (1.5 m for adjacent standard-sized attacks), but PF1AE previously assumed feet if `pf1.settings.distance.metric` was unset, reducing the limit to 0.45 m.
- Use the scene's configured units for native melee reach when the action does not specify a numeric explicit distance in feet/meters. Explicit numeric feet/meters ranges (including Bharrik's Cold Blast) still convert from their own declared units; other ranged ability/spell formulas keep their existing behavior.
- Add a maintained native-dialog regression: rapier at 1.5 m allowed with unchanged native dialog; at 3 m rejected without resource cost, even when global metric mode is unavailable.
- Experimental: verify in live Foundry VTT 13.351 / PF1 11.11 with different token sizes and modules.

## v1.38.4 — Correct explicit feet/meters action range on mixed-unit scenes (experimental)

- Fix false out-of-range cancellation for actions such as Bharrik's **Cold Blast**, configured at 30 ft on a metric scene: a numeric `action.range.value` with an explicit `range.units` is now converted directly from those declared action units into scene units, without assuming `getRange({type:"max"})` uses the same units.
- Retain PF1's native `getRange({type:"max"})` for formulaic/calculated ranges in system-configured units (including variable spell ranges), and retain native melee reach behavior where no numeric action range is configured.
- For ranged weapons with a numeric first increment, require a valid native `range.maxIncrements` and multiply to obtain the full legal maximum; unknown increment count returns uncertain rather than incorrectly cancelling.
- Add regression tests for 30 ft = 9 m, the exact boundary and 10.5 m rejection; reverse meter-to-feet conversion; independent system metric preference; and ranged-weapon increments. Preserve early dialog cancellation and libWrapper coexistence.
- Experimental: verify live PF1 11.11 behavior with action-specific formulae, dynamic bonuses and unusual target geometries.

## v1.38.3 — Block before PF1 attack dialog using native hook timing (experimental)

- Correct the actual PF1 11.11 lifecycle: `pf1CreateActionUse` executes **inside** `ActionUse.process()`, after initial requirements/ammo auto-selection but before the attack dialog. Wrapping `process` from that hook (v1.38.2) is too late to stop its current invocation.
- Attach an idempotent instance-local `createAttackDialog()` guard from the same hook. For confirmed total cover or out-of-range target, return `null`, the native dialog-cancel result that causes PF1 `process()` to exit before attack rolls, ammo/charge expenditure, Script Calls and chat publication.
- Preserve all ActionUse prototype methods and libWrapper chains, including PF1 Improved Conditions. Authorized and uncertain actions use the original dialog.
- Update maintained native bridge regression to simulate the real system's hook-inside-process ordering, no dialog display, no ammo/magazine consumption, and other modules' native call chain.
- Caveat: `skipDialog: true` bypasses `createAttackDialog()`; these uses still rely on the native `pf1PreActionUse` fallback. `autoSelectAmmo()` precedes the hook and may select a default ammunition item, but no ammo quantity is spent on rejected dialog actions.

## v1.38.2 — Instance-local pre-use gate avoids libWrapper conflict (experimental)

- Fix live warning when PF1 Improved Conditions and PF1AE both wrap `ActionUse.prototype.process`: PF1AE no longer registers WRAPPER/MIXED or modifies that shared prototype at all. The previous intentional early cancellation broke competing wrapper chaining.
- Attach an idempotent per-ActionUse `process` guard on the PF1 11.11 `pf1CreateActionUse` hook. A confirmed impossible action is stopped before the native process begins; allowed/uncertain actions call the already-installed native/third-party method chain unchanged.
- Preserve total-cover, melee reach and targeted spell/ability range checks, early cancellation before modifier dialogs, ammunition/charges, dice and chat, plus the existing late native pre-use safety fallback.
- Add maintained regression coverage with simulated libWrapper and PF1 Improved Conditions, asserting no process prototype patch, no libWrapper registration, idempotent instance-local guards, safe early rejection and forwarding of legitimate attacks.
- Experimental: verify in live Foundry 13.351/PF1 11.11; execution paths that do not raise the native creation hook remain guarded only by the existing native pre-use fallback.

## v1.38.1 — libWrapper MIXED chain-safe action cancellation (experimental)

- Fix libWrapper registration of `pf1.actionUse.ActionUse.prototype.process`: switch from `WRAPPER` (requires every invocation to call the next function) to `MIXED` (supports intentional short-circuit on verified forbidden actions).
- Retain early cancellation of proven total-cover and out-of-range actions before native PF1 attack modifier dialogs, resource expenditure or chat cards. Valid and uncertain actions continue through the next wrapper normally.
- Add regression coverage for the real libWrapper registration type, cancelled-call short-circuit and valid-action forwarding in the maintained native bridge suite. Existing prototype fallback remains unchanged.
- Experimental: test in Foundry VTT 13.351 / PF1 11.11 with libWrapper enabled and report any competing overrides.

## v1.38.0 — Generic action range gate for spells and other abilities (experimental)

- Extend the existing `ActionUse.process()` pre-dialog range gate to all **single-target actions with a native measurable range**, including targeted spells, non-attack abilities and ranged attacks. Continue supporting ordinary melee reach and the existing total-cover gate.
- Use PF1 `action.getRange({type:"max"})` in configured system units, including native spell-level scaling and maximum ranged weapon increments. Measure the shortest occupied-square grid distance in Foundry without altering roll formulas or actors.
- Reject **only** verified distances above native maximum range, before dialog, charges/spell slots/ammunition, rolls or chat message creation; localized FR/EN notification.
- Skip non-measurable or self-only ranges, template/area placements, unknown elevations/units, ambiguous actor/target provenance and multiple targets instead of guessing or blocking legitimate casting.
- Preserve the `api.meleeReach` Script Call entry point and add `api.actionRange`. Extend the maintained regression test to exercise targeted spell, ability, ranged action, template, unknown range and full resource-safety scenarios.
- Experimental, requires live PF1 11.11 acceptance for special ranges, targeted spells and third-party template modules.

## v1.37.0 — Native melee reach rejection before attack dialog (experimental)

- Add a class-agnostic `api.meleeReach.inspect` and `inspectActionUse` read-only engine for PF1 11.11 melee weapon/spell attack maximum reach. Use native `action.getRange({type:"max"})` so natural reach, reach weapons and action-specific adjustments are not hardcoded.
- Measure nearest occupied square centers between grid-aligned rectangular tokens using the Foundry square-grid `measurePath`, supporting large creatures and native diagonal distance rules; convert the system and scene units conservatively.
- Reuse the early `ActionUse.process()` interception from v1.36.3: an unequivocal single-target out-of-reach melee attack is rejected before the attack modifier dialog, dice, ChatMessage or charges. Retain the native `pf1PreActionUse` safety fallback.
- Fail open with an explicit `uncertain` result if native action reach, actor/token identity, square footprint, exact measurement, scene units or elevation cannot be verified. Ranged, maneuvers and multi-target uses remain untouched. This initial gate only checks maximum reach; minimum reach limitations (polearm dead zone) remain a separate rules extension.
- Add regression coverage for ordinary reach, increased action reach, Large targets, uncertain cases, no resource consumption and native pipeline preservation. Keep the pre-existing 45 maintained CI suites.
- Experimental: requires real Foundry 13.351 / PF1 11.11 validation with special feats, dynamic size effects and third-party attack modules.

## v1.36.3 — Cancel proven total-cover attacks before PF1 modifier dialog (experimental)

- Intercept PF1 11.11 `ActionUse.process()` before native requirements, auto ammo selection, roll-data preparation, attack modifier dialog, dice rolls, ammo/charge deductions or chat posts. Proven single-target direct total cover aborts the action immediately with one warning and zero resource changes.
- Use `libWrapper` when active; otherwise use a guarded prototype wrapper. Retain `pf1PreActionUse` as a secondary cancellable safety gate for other entry paths; this hook is too late to prevent the attack dialog.
- Preserve normal PF1 pipeline for uncertain geometry, open doors, untargeted/multitarget actions, spells with no direct attack and unsupported action types.
- Extend maintained native bridge regression to assert blocked attacks do not open the dialog, alter ammo or magazine values, or post a card; validate allowed actions retain native behavior.
- Experimental live-Foundry testing is required, including PF1 weapon reload adapters and third-party wrappers.

## v1.36.2 — Fix Foundry v13 wall movement classification (experimental)

- Read `CONST.WALL_MOVEMENT_TYPES.NONE/NORMAL` at runtime instead of treating obsolete `move=1` as a blocking wall. Foundry 13 uses `NORMAL=20`; this corrects the false `unclassified-wall` result on ordinary 2D solid walls, which prevented proven total cover from cancelling direct attacks.
- Retain uncertainty for movement-passable walls, missing runtime constants, unsupported restrictions, and tangential or unknown intersections; do not invent a physical obstruction or cancel uncertain attacks.
- Update the PF1 corner-ray, native pre-use cancellation and 2D/3D mode regression fixtures to real Foundry 13 wall values; test normal walls, nonstandard legacy values, and native cancellation.
- This remains an experimental release: complex corner geometry and live PF1 11.11 multiplayer acceptance still require verification.

## v1.36.1 — Native attack-card effective AC and proven total-cover cancellation (experimental)

- Fix attack-card visibility of cover: annotate the **same native PF1 attack ChatMessage** with the target-specific native and effective AC calculated by PF1AE after the attack roll. Native sheet AC remains unchanged. When the native bonus provenance cannot be verified, display review status rather than claim an incorrect effective AC.
- When a **single-target, direct weapon/touch attack** has confirmed total cover from every legal PF1 corner ray, the cancellable **pf1PreActionUse** hook returns false before native ammo/resource expenditure and the action is not performed. This requires an unambiguous attacker/target token; uncertain and multiple-target cases do not cancel globally.
- Complete solid wall obstruction is now classed as `total` rather than `possible-total-cover` only when *every* permitted ray is blocked with no uncertain or grazing rays.
- Existing PF1 2D/default and optional 3D mode settings preserved. Known issue: when PF1 produces a card without ownership/provenance or an attack bypasses native use hooks, the bridge refuses to alter it; actual UI behavior must be validated in-world. Native cards are **annotated**, not overwritten.
- Experimental release for Foundry 13.351 / PF1 11.11; 45 maintained CI suites.

## v1.36.0 — Configurable 2D / optional 3D cover detection

- Add a **world setting** for PF1 cover geometry: **2D by default**, optionally **3D** for verified Levels 6.1.0 + Wall Height 7.0.8 installations (Better Roofs 3.0.0 optional).
- In 2D, ray classification uses the square-grid plan and native wall segments and door states; ignores token elevation, Wall Height wall heights and roof occlusion to support ordinary 2D maps.
- In 3D, enable existing height-aware wall tests and Levels collision checks. Missing/incompatible providers yield an uncertain result, never silently applying 2D cover when 3D is requested.
- Preserve class-neutral Item Script Call design, native AC source provenance, and no double bonus. Add FR/EN labels and 2D/3D regression tests.
- This is an **experimental prerelease**: complex roof/vertical line-of-effect cases and real Foundry multiplayer still require acceptance tests.

## v1.35.0 — Experimental conditional defenses and 3D cover (prerelease)

- **TEST RELEASE — NOT FULLY VALIDATED IN LIVE FOUNDRY**. The 43 maintained automated suites passed on the development branch. Please test in a backed-up world; report discrepancies in PF1 11.11 prepared AC source breakdown and Levels/Wall Height/Better Roofs 3D geometry.
- Add generic, source-bound conditional defensive modifiers stored in Item flags, source-aware Reflex cover bridge, and 3D read-only trajectory diagnostics.
- Add preliminary Pathfinder 1e corner-ray cover interpretation for ranged/reach/adjacent melee, walls, doors, soft cover, token footprints up to 8×8 and conservative inter-floor Levels checks.
- Inspect native PF1 AC source details to apply only the *incremental* cover bonus in attack resolution, without changing native character sheets or re-rolling an attack. Ambiguous native AC sources or geometry remain indeterminate.
- **Known limitations:** real Foundry multiplayer integration not yet checked; complex roof/sloping-wall interactions, some large melee cases, manual in-dialog selector, chat diagnostics and full ability lifecycle remain incomplete. This is not a blanket automatic cover system.

## v1.34.0 — Official minor release: Tactical Positioning Engine

- Publish the previously tested **generic tactical positioning and native PF1 Flanking checkbox preselection** as a SemVer **minor** version instead of a patch.
- **No functional or API changes** from v1.33.15; all existing behavior, scripts, settings, and data remain unchanged.
- Preserve the v1.33.15 release as historical reference; v1.34.0 is the official version for the new feature.

## v1.33.15 — Generic tactical positioning and native Flanking precheck

- Add a **class-neutral, feat-neutral** tactical positioning service with `api.tacticalPositioning.checkFlanking({attacker,target,allies?})`.
- Analyze PF1e square-grid opposite-side/corner geometry, occupied spaces for Large creatures, PF1 prepared melee reach, actor melee threat, allegiance, elevation and conservative unknown cases. Return a structured `flanking`/`not-flanking`/`uncertain` diagnostic without changing attack math.
- At `pf1CreateActionUse`, **preselect the existing native PF1 Flanking checkbox** (`shared.useOptions.flanking=true`) for a verified single-target melee attack. The attack dialog remains user-editable; **the native system alone applies +2**, and PF1AE never injects its own second bonus.
- Native Flanking preselection setting in French/English, enabled by default and independently disableable. Uncertain, non-melee or multi-target actions remain unchanged.
- No specific feat or class automation is introduced: exceptions continue to belong exclusively in Item Script Calls.
- Include geometry, reach, uncertainties and native checkbox integration regression tests, plus installation ZIP content checks.

See [Tactical positioning API and limitations](docs/TACTICAL-POSITIONING.md).

## v1.33.14 — Clean effective shooting-into-melee roll parts

- Native ranged attack rolls now display the **final per-attack melee penalty** only: `-4[Tir dans le tas]`, `-2[Tir dans le tas]`, or no melee penalty for `penalty:0` (English: `Shooting into melee`).
- Preserve the early creation-time shared modifier for context, but remove only that PF1AE-owned part after native Script Calls finish and before native `ActionUse.addAttacks()`; inject exactly one effective per-index part instead of showing `-4` plus compensating `+4`.
- Temporarily suppress the native exact `0` attack-bonus placeholder for affected attacks, restoring all original `shared.attacks` data after resolution, cancellation, or error.
- Retain distinct overrides per attack index, the v1.33.13 preparation/roll/completed lifecycle, all actor/item/Script Call approval checks, native manual options, and coexistence with independent feat, range and other attack bonuses.
- Keep override `reason` values in diagnostics without showing them in roll formulas.
- Add regression coverage for mixed `0`, `-2`, `-4` full attacks, clean Precise Shot, exact formula parts and unchanged numeric results.

## v1.33.13 — Precise Shot attack preparation lifecycle

- Fix native `PF1AE:rangedMelee:override` Script Calls being refused when PF1's already-prepared `shared.rollData.attackCount` exists before a single d20 is rolled.
- Replace the attack-count heuristic with an explicit per-`ActionUse` lifecycle (`created` → `preparing` → `rolling` → `completed`), plus a native `ChatAttack.attack`/`critConfirm` roll-object and message guard. Empty native ChatAttack placeholders are permitted. Once native `addAttacks()` starts, no further overrides may be registered.
- Reject same-`ActionUse` concurrent entry during asynchronous preparation/rolling, and close the override window permanently after normal completion or native cancellation.
- Preserve exact per-index Precise Shot (+4 against the shared −4), other attack bonuses, full attacks, and parallel independent `ActionUse` objects. Native reuse never reopens the window.
- Keep trusted-table mode and per-call secure-mode approvals unchanged. No modification to the Precise Shot Script Call.
- Add explicit regression coverage for non-null native `attackCount`, post-start rejection, cancellation, reuse, simultaneous uses, and unaffected attack bonuses.

## v1.33.12 — PF1 rich Bleed tooltip integration

- Use PF1's documented `renderPF1ExtendedTooltip(sheet, id, template)` hook to localize the Bleed title in system extended tooltips before they are displayed.
- Use a guarded DOM insertion observer for the separate token effect popover, which does not trigger PIXI effect-sprite hover events. Match the Bleed heading and an active token with a configured formula; leave other condition tooltips unchanged.
- Display `Saignement - 1d4` with a French interface or `Bleed - 1d4` otherwise. Preserve status identity, descriptive content, durations, and damage automation.
- Replace the previous incorrect PIXI pointer event test with regression checks for both PF1 tooltip rendering and DOM insertion.

## v1.33.11 — PF1 rich Bleed token tooltip

- Fix the separate PF1e rich condition popover on the token's Bleed miniature (the one showing Active, Max duration and stopping conditions), not just the default Foundry tooltip.
- Show the localized title `Saignement - 1d4` in French or `Bleed - 1d4` in English/other locales, using the same configured formula already shown on the native effect.
- Update the popover title when it is inserted after hover and when its content is recreated; leave the description, duration, mechanical condition, and other status tooltips unchanged.
- Add regression tests for the rich popover, French and English fallback, lifecycle and isolation.

## v1.33.10 — Native Bleed thumbnail hover label

- Correct the native effect miniature hover tooltip: `Saignement - 1d4` for French and `Bleed - 1d4` for all other locales.
- Use Foundry's `data-tooltip-text` instead of relying on `title` and `aria-label`; also update nested effect-icon anchors used by PF1 layouts.
- Recalculate the hover text after formula changes and remove stale overrides when Bleed is no longer configured.
- Preserve the original native condition, formula, damage processing and icon.
- Extend regression checks for localized hover tooltips.

## v1.33.9 — Localized native Bleed effect names

- The native Bleed ActiveEffect name now includes its configured formula when set: `Saignement - 1d4` in French or `Bleed - 1d4` otherwise.
- Render local-language names in the token HUD and native actor effect rows, while leaving the original status identity and icon unchanged.
- Updates when the formula changes and defaults to English for non-French Foundry clients.
- Regression coverage for formula-bearing effect names in both languages, and for local display updates.
- No changes to Bleed damage, chat announcements or script authorization.

## v1.33.8 — Localized Bleed messages and native condition badges

- Bleed chat messages are now a single localized damage sentence: **« XXX subit N points de saignement ! »** in French and **“XXX takes N points of bleed damage!”** in English (default for other languages).
- Show the effective bleed HP damage after approved reductions, without a Rolled/Prevented/HP damage breakdown. Preserve real dice roll cards and Dice So Nice integration.
- Display the saved Bleed formula (fixed value or dice expression) on the existing native Bleed condition icon and in the selected token's native status HUD. No extra Buff or duplicate condition is created.
- Add regression coverage for French, English fallback, HUD badges, live updates, stale badges and unrelated icons.
- Keep the existing native PF1 HP damage application, stacked Bleed resolution, GM-authorized Script Calls and persistent turn receipts unchanged.

## v1.33.7 — Script Call approval manager and localized settings

- Add a GM-only **Script Approvals** settings menu for all discovered native embedded Actor Item Script Calls; checkboxes approve/revoke the exact stored call in secure mode.
- Show disabled checkboxes while Trusted Table Mode is active; existing approvals remain stored.
- Keep strict Actor/Item/native Script Call identity and exact source fingerprint validation. A changed script must be approved again; edits during the open dialog are rejected.
- Localize the new menu and ranged-melee configuration in French and English (English fallback for other Foundry languages).
- Add regression tests for discovery, granting, revocation, trust-mode read-only state, stale source and modified identity.
- No change to the Precise Shot Script Call.

## v1.33.6 — Trusted Table Mode permits exact ranged-melee override Script Calls

- Add **only** `PF1AE:rangedMelee:override` to the trusted-table allowlist for native `toggle` Script Calls, beside `PF1AE:bootstrap`. This fixes elected-GM fallback refusals for Precise Shot on a player-owned Actor.
- Preserve exact Actor/Item/native Script Call identity checks, category matching and the existing opt-in setting; no blanket trust for arbitrary Script Calls.
- Preserve secure mode: explicit per-call approval remains necessary, and changing approved source invalidates the approval.
- Add regression tests for both modes, substituted Actor/Item/Call identity, category restrictions, modified source and full GM-side attack resolution: the authorized Precise Shot override cancels the −4 penalty, whereas unauthorized code leaves it intact.
- No changes to the existing Precise Shot Script Call, attack mechanics, or melee detection logic.

## v1.33.5 — Localized shooting-into-melee roll label

- Rename only the native attack-roll modifier tag: `Shooting into melee` when the Foundry client language is English or anything other than French, and `Tir dans le tas` for French (including `fr-FR`).
- Apply the same localized tag to the early shared penalty and later per-index overrides (including Precise Shot). No change to actual penalties, attack timing, rules or settings.
- Extend regression coverage for French, English, fallback language and per-index corrections.

## v1.33.4 — Native PF1 computed melee reach and NPC natural attacks

- Fix the reported three-ally diagnostic `melee threat or reach unknown`: PF1 11.11 exposes computed melee reach at `actor.getRollData().range.melee`, while `system.attributes.reach` is absent on standard actors. Prefer the prepared PF1 value; retain legacy attributes only as fallbacks, never assume a guessed 5-ft reach.
- Recognize melee threats from native PF1 NPC `attack` Items and natural attacks, rather than requiring every threat to be an explicitly equipped manufactured weapon. Unknown threat still triggers manual adjudication.
- Enrich per-ally diagnostics with `allyHasMeleeAttack`, `targetHasMeleeAttack`, and each actor's prepared range data to distinguish lacking a melee action from lacking an allonge value.
- Add regression cases for native reach with no legacy attribute, reach-weapon versus natural melee reach, and safe uncertainty on missing data. No changes to attack modifiers, range penalty integration or other PF1AE features.

## v1.33.3 — Foundry v13 token geometry compatibility

- Fix the real-world `uncertain threat or token geometry` warning after the v1.33.2 size fix: Foundry v13 Token objects do not expose `getOccupiedCells()`. Use native `TokenDocument.getOccupiedGridSpaceOffsets()`, convert cells to measured center points with `canvas.grid.getCenterPoint()`, then measure with the existing `canvas.grid.measurePath()`.
- Keep the former `getOccupiedCells` compatibility path for custom integrations but do not depend on that nonstandard method on normal Foundry v13 tokens.
- Return detailed `uncertain` entries in `api.rangedMelee.lastDiagnostic()` for each unresolved ally, distinguishing missing grid geometry, unknown threat/reach, and missing ally size; retain fail-closed behavior instead of inventing a −4.
- Add regression cases for actual v13 TokenDocument offsets without `getOccupiedCells`, distance-based engagement, and detailed uncertainty output. Existing Native PF1 range penalties, Precise Shot and firearm automation are unaffected.

## v1.33.2 — Native PF1 v11.11 creature size compatibility

- Fix 'target size unknown' during shooting into melee against correctly configured PF1 actors. Native PF1 v11.11 exposes `system.traits.size` as `{base:'med',value:4}`, rather than the legacy `'med'` string.
- Prefer PF1's prepared integer `size.value` (including size-changing effects), then accept a prepared string size or `size.base` as fallbacks. Unknown values remain uncertain and do not invent a size category.
- Preserve ranged penalty timing, Precise Shot overrides, target verification and all other existing automation.
- Add regression coverage for size object values 4/6/7, temporary size changes, base fallback and invalid size data.

## v1.33.1 — Reuse native range-style pre-roll bonus for shooting into melee

- Move the automatic, proven single-target shooting-into-melee penalty to `pf1CreateActionUse` and `shared.attackBonus`, the same native pre-roll path as PF1AE range increments. No document mutation or post-roll math.
- Retain a narrow `ActionUse.addAttacks` bridge only for delayed manual decisions, geometry/target changes, and feat-specific per-attack overrides.
- When a common −4 is present, a Precise Shot per-index override to 0 supplies a temporary +4 **correction**, not another standalone negative/positive penalty; other attacks preserve their common −4. Restore exact per-index values and remove only PF1AE's shared part after resolution.
- If the target changes, the native attack dialog provides its own manual bonus, or the rule is disabled, discard the stale shared modifier before rolling. Preserve range increment and other independently registered bonuses.
- Extend regression tests for creation-hook injection, partial/full attack overrides, coexistence with ranged increments, retargeting, duplicate prevention and native manual precedence. No change to PF1FR defense, ammo, grit or bleed mechanics.

## v1.33.0 — Shooting into melee: pre-roll penalty and temporary overrides

- Add a generic per-attack PF1 ranged-into-melee penalty resolved at native ActionUse.addAttacks, before ChatAttack.addAttack evaluates dice; restore the original attack data after the native use.
- Pathfinder rules: −4 into melee, −2 if the target is two sizes larger, 0 if at least three; 10-foot separation exception. Only apply when target, faction, grid distance, size and reach are sufficiently verified; otherwise require manual resolution.
- Add public api.rangedMelee.prepareAttackOverride(), prepareForCurrentUse(), cancelPreparedAttackOverride(), judge() and lastDiagnostic(). Exact native ActionUse/actor/item/index association, duplicate refusal and transient cleanup.
- Allow native toggle Item Script Calls named PF1AE:rangedMelee:override to prepare overrides automatically for their own character. GM execution of player-owned native code continues to require exact Script Call approval; never transmit JavaScript over sockets.
- No class/feat-specific logic in the module. Complete Precise Shot feat Script Call and live test checklist in docs/RANGED-MELEE.md.
- Keep PF1FR weapon defense, Deadeye, ammo, Grit and existing range increment calculations independent. New world setting to enable or disable this one rule.
- When one target is selected but engagement data is uncertain, an optional pre-roll DialogV2 requests an explicit 0, −2, −4 or unchanged decision. No guessed modifier for multiple targets.
- Add maintained regression tests for single/full attacks, multiple simultaneous native uses, per-index overrides, unknown engagement, size exceptions, metric/imperial and manual native modifiers.

## v1.32.0 — Native Bleed status, visible dice and chat result

- The DialogV2 manual Bleed workflow now saves the formula and `manualBleed.generated` metadata **on the existing native Bleed ActiveEffect**. It no longer creates a second Buff/item, eliminating its redundant neutral icon in effects panels, not only on the token.
- The HP Bleed engine supports both native Bleed ActiveEffects and existing configured PF1 Buffs, retaining highest-roll stacking, approved reductions, native damage application, and persistent one-application-per-turn receipts.
- Evaluated Bleed dice use the SAME Foundry `Roll` for `toMessage()`, making the result visible and available to Dice So Nice without rerolling. Fixed values receive a compact chat card. Both show original, prevented and applied HP damage.
- Chat publication occurs only after native damage and the persisted applied receipt, so a chat-display failure cannot reapply HP on reconnect.
- Automatically migrates older `manualBleed.generated` Buffs to native Bleed metadata and removes only those generated Buffs after successful transfer, preserving Buffs from abilities and spells.
- Token label reads the formula from native Bleed flags and retains backwards-compatible Buff fallback.
- Extended regression tests for native flags, migration-safe visual behavior and evaluated-roll chat publication.

## v1.31.1 — Bleed integration with PF1 Automate Damage

- Fix crash in third-party PF1 Automate Damage 2.1b's `ActorPF.applyDamage` libWrapper: its wrapper unconditionally reads `config._pf1AutomateDamageDialog`, but Bleed previously omitted the second `options` parameter.
- Bleed now always passes an options object to native PF1 `ActorPF.applyDamage(amount, options)`. If `pf1-automate-damage` is enabled, it sets the integration's existing dialog-origin marker so periodic Bleed damage bypasses chat-card/selected-token interception and applies to the actual bleeding Actor.
- Added a regression that reproduces the exact `undefined config` crash and verifies one application, correct actor targeting and plain native options when the third-party integration is disabled.
- Existing `pending` receipts are **not automatically reset or retried**: a previous failed transaction may have partially mutated the Actor. The GM must verify the exact turn/HP before any manual reconciliation.

## v1.31.0 — One Bleed icon with its formula

- Generated `manualBleed` Buffs automatically set the native PF1 `system.hideFromToken` flag, keeping their mechanics active while suppressing the redundant neutral Buff marker.
- Decorates **only** the native Bleed status icon on tokens with the saved formula (`3`, `1d4`, `2d6+1`), never the last random roll result.
- Reuses the native status icon; no second condition or ActiveEffect is created. Token redraws update the formula in place without accumulating labels. Other statuses and ability/spell-generated Buffs remain untouched.
- During GM startup, automatically hides older `manualBleed.generated` Buffs that predate this setting, including linked and scene-local synthetic Actors.
- Adds dedicated graphical regression tests and reuses native PF1 Buff/condition lifecycle; HP damage processing and security remain unchanged.

## v1.30.1 — Bleed did not apply at the start of a turn

- Listen to Foundry v13 `combatTurnChange` after Combat updates, in addition to `updateCombat`, processing only on the elected GM. Existing persistent turn receipts prevent duplicate damage when both hooks fire.
- Respect PF1 Buff `activeState` as the authoritative activation getter even if a stale `system.active` disagrees.
- Add `api.bleed.diagnostic(game.combat)` with actor/Buff eligibility, active combatant, GM authority and pending/applied receipt inspection to diagnose existing-world configurations safely.
- Extend the maintained Bleed regression suite with real turn hook simulation, multiple GMs, stale state, deduplication and diagnostics. No direct HP mutations and no change to Scarification rules.

## v1.30.0 — Manual native Bleed condition DialogV2

- When a user manually enables the native PF1 `bleed` condition, their originating client opens a `DialogV2` for an HP Bleed formula (default `1`). The native `pf1ToggleActorCondition` hook is paired with a local authenticated Actor update to prevent opening the dialog on every connected client.
- Validate with Foundry 13 `Roll.validate` without evaluating any dice; an invalid formula is rejected without changing Buffs, and cancellation returns the native condition to disabled.
- Generate or reuse **one** native PF1 Buff carrying `manualBleed.generated: true`, configure it through the v1.29.0 Bleed API, and activate it with PF1's Item API. Disabling native Bleed deactivates **only** generated manual Buffs, leaving ability/spell/attack Bleed Buffs untouched.
- Add native Bleed Script Calls `PF1AE:bleed:before` and `PF1AE:bleed:applied` to the explicit Trusted Table Mode allowlist; normal mode remains fingerprint-approval gated.
- Safeguards for user origin, OWNER rights, non-linked tokens, duplicate dialogs, internal condition removal recursion and F5. No second damage engine.
- New maintained regression suite `bleed-manual.test.cjs`. See `docs/BLEED.md` for complete behavior and manual verification.

## v1.29.0 — Generic HP Bleed infrastructure

- Adds an opt-in HP Bleed metadata flag on native PF1 Buffs, with API `api.bleed.configure/get/isBleed/list/process/receipts`.
- At the beginning of an affected combatant's turn, the elected GM rolls all eligible HP bleed formulas using Foundry Roll, selects the highest result, and applies the remaining damage through native PF1 `ActorPF.applyDamage` rather than writing HP directly.
- Approved native `postUse` Script Calls `PF1AE:bleed:before` can apply a bounded `event.reduce(n)` or `event.negate()` once per Script Call; unapproved player-owned scripts are never run with GM privileges.
- Emits informative `PF1AE:bleed:applied` Script Calls and `pf1aeBleedApplied` Hooks, with original/prevented/applied amounts and HP snapshots.
- Stores persistent world turn receipts `pending/applied` *before* mutations to avoid duplicate damage after F5, multiple GMs, duplicate updates or Combat Tracker rewinds. A failed pre-damage handler leaves a `pending` receipt requiring GM review, not automatic retry.
- Supports active Buffs on linked and synthetic Actor documents. Existing native Buff enable/disable and separate duration management determine eligibility.
- Does not embed class/archetype/feat rules in the module. Includes a copy-paste Scarification Script Call and a Foundry verification protocol in `docs/BLEED.md`.
- HP Bleed only; ability damage/drain and stacking overrides are deferred, not silently implemented.

## v1.28.2 — English module description

- Translate the short Foundry module description into English while retaining its module-wide feature coverage.
- No functional changes; Bleed automation is not described as an existing feature.

## v1.28.1 — Description courte du module

- Remplace la description centrée sur les Chat Actions par une présentation synthétique des fonctionnalités actuellement présentes : attaques et dégâts, sauvegardes, effets et durées, repos, portée, scripts persistants, actions par défaut et boutons multijoueurs sécurisés.
- Aucun changement fonctionnel ; le système générique de saignement envisagé n'est pas annoncé comme déjà implémenté.

## v1.28.0 — Déclaration automatique des gestionnaires Chat Actions sur le MJ élu

- Découverte automatique des Script Calls natifs `toggle` nommés exactement `PF1AE:bootstrap` sur les Items des acteurs du monde et tokens synthétiques.
- Un contexte `bootstrap.chatActions` expose `bootstrap.registerChatActionHandler(key, handler)`, sans macro, sans activation d'objet ni modification du document.
- L'exécution du code sur le MJ élu est conditionnée à l'approbation exacte `scriptApprovals.check()` pour un acteur appartenant à un joueur, même si ce joueur est connecté. Le mode Table de confiance ne donne accès qu'au nom et à la catégorie approuvés et reste désactivé par défaut.
- Une déclaration est identifiée par les UUID Actor/Item/Script Call et son code sauvegardé exact ; révocation, édition, suppression, changement de MJ, F5 et reconnexion invalident les handlers et les restaurent selon les permissions.
- Revérification de l'approbation au clic, interdiction d'écraser la clé d'un autre gestionnaire, maintien des anciens messages Chat Actions.
- Les boutons continuent d'être arbitrés par le MJ avec les protections existantes contre le double clic et les mutations partielles.
- Documentation et exemple complet Utility Shot ; aucune règle de pistolier intégrée au moteur.

## v1.27.0 — Boutons persistants génériques dans le chat

- Ajoute l'API publique `api.chatActions` : `create`, `registerHandler`, `click`, `getState`, `reset` (récupération MJ explicite).
- Les boutons sont reconstruits depuis les flags de ChatMessage via `renderChatMessageHTML` sur tous les clients, y compris après F5, reconnexion et changement de scène.
- Les joueurs soumettent des demandes via des mises à jour d'acteur authentifiées par Foundry ; le MJ élu revalide OWNER/GM, sélection controlled/targeted et provenance, sans accorder de confiance à des identifiants d'utilisateur transmis par socket.
- Les cartes et leur état partagé sont créés et modifiés par le MJ élu. Réservation persistante `pending`, déduplication locale, état `used` après succès, retour à `ready` pour un refus métier explicite ; une exception conserve le blocage jusqu'à révision manuelle.
- Les gestionnaires ne sont enregistrés que côté MJ, liés à un UUID précis d'objet source ; aucun code JavaScript n'est contenu dans la carte ou transmis par le réseau.
- Ajoute documentation, exemple Utility Shot — Stop Bleeding et tests couvrant permissions, concurrence, F5, cible et échec sécurisé.
- Ce système est une extension générique : aucune règle de classe ou de capacité n'est codée dans PF1AE.

## v1.26.8 — Ordre de démarrage Bootstrap / Script Approvals

- Retarde la restauration persistante des scripts jusqu'à la disponibilité de l'API d'approbation MJ `scriptApprovals.check()`.
- Émet l'événement interne `pf1aeScriptApprovalsReady` après initialisation du service, puis reprend la restauration sans faux avertissement `Script approval service unavailable`.
- Empêche toute restauration prématurée d'un script de joueur par un MJ et conserve l'exigence d'une autorisation correspondant exactement au contenu du script.
- Ne supprime pas les runtimes existants lors d'une attente temporaire d'initialisation, et préserve les protections contre les doublons.
- Ajoute des tests reproduisant un `ready` inversé et vérifiant les refus légitimes.

## v1.26.7 — libWrapper facultatif et diagnostic ItemPF

- Résout la classe native PF1 via `pf1.documents.item.ItemPF`, et non `ItemBasePF` via `CONFIG.Item.documentClass`.
- En présence de libWrapper, utilise `libWrapper.register()` pour `ItemPF.use` (type `WRAPPER`) et `ActionSelector.open` (type `MIXED`). Sans libWrapper, les wrappers directs ciblent le bon prototype.
- Déclare `lib-wrapper` dans `relationships.recommends` : recommandation facultative, aucune dépendance obligatoire.
- Empêche les enregistrements multiples, ajoute `api.defaultAction.status()` pour indiquer les modes d'installation et corrige `installed()`.
- Laisse inchangé le hook PF1 natif `pf1CreateActionUse` et les flags persistés d'action par défaut / Skip dialog.
- Tests automatisés avec et sans libWrapper ; validation en jeu après mise à jour recommandée.

## v1.26.6 — Correction de Skip dialog dans le pipeline PF1

- Intercepte la création de la fenêtre de configuration au hook PF1 natif `pf1CreateActionUse` pour l'action par défaut lorsque la case Skip dialog est cochée.
- Corrige le cas où `ItemPF.use()` capture `skipDialog=false` avant la sélection d'action asynchrone, puis continue à ouvrir le dialogue malgré la préférence.
- Retourne un formulaire vide valide dans le flux PF1 ; conserve les calculs de jets, scripts, templates, validations et consommation de ressources natifs.
- Les autres actions et les utilisations sans option cochée conservent le dialogue normal.
- Tests supplémentaires ciblant directement l'ouverture du dialogue d'`ActionUse` et le choix d'action.
- Validation réelle dans Foundry VTT v13 / PF1 v11.11 nécessaire.

## v1.26.5 — Skip dialog pour l'action par défaut

- Ajoute une case « Skip dialog » dans la section PF1 Automation Engine de l'onglet Avancé, activable lorsqu'une action par défaut valide est sélectionnée.
- Sauvegarde ce réglage indépendamment par Item via le flag `defaultActionSkipDialog`, désactivé par défaut.
- Lors d'une utilisation normale de l'Item sans action explicite, transmet `{actionId, skipDialog:true}` à la méthode native `ItemPF.use()` si la case est cochée.
- Ne modifie pas les utilisations avec action explicitement imposée, les consommations ni les jets ; si l'action par défaut est absente, le comportement natif est préservé.
- Ajoute les libellés et descriptions FR/EN, la gestion des permissions et les tests de non-régression.
- Validation en interface Foundry VTT 13 / PF1 11.11 encore nécessaire.

## v1.26.4 — Présentation native, langues utilisateur et sélection automatique

- Présentation du réglage dans une section semblable aux autres sections de l'onglet Avancé, avec en-tête et groupe de formulaire natifs, sans carte encadrée.
- Libellés et explications FR/EN chargés via game.i18n pour chaque client.
- Interception supplémentaire du sélecteur natif ActionSelector.open pour les utilisations qui ne passent pas par ItemPF.use, avec retour de l'identifiant d'action enregistré ; si la préférence manque ou est invalide, le sélecteur normal reste disponible.
- Le moteur PF1 garde l'exécution, la consommation et le dialogue de configuration des jets. Vérification en jeu nécessaire.

## v1.26.3 — Correction du panneau d'action par défaut coupé

- Insère le réglage directement après le dernier champ natif de l'onglet « Avancé », dans son conteneur de contenu, plutôt qu'après un conteneur éventuellement masqué par PF1 ou Little Helper.
- Supprime le faux espace de défilement et les surcharges CSS de scrolling qui n'avaient pas permis d'accéder au sélecteur.
- Préserve la sélection d'action, les permissions et les appels natifs PF1.
- À vérifier manuellement dans Foundry v13 / PF1 v11.11 avec Little Helper.

## v1.26.2 — Défilement de l'onglet Avancé

- Insère la section « Action par défaut » à l'intérieur du conteneur défilant natif de l'onglet « Avancé » lorsqu'il existe.
- Ajoute une marge de défilement en bas pour accéder au sélecteur dans les fenêtres d'objet de faible hauteur.
- Conserve le choix enregistré et le comportement natif de l'utilisation d'objet.
- Correctif à confirmer visuellement sur Foundry 13 / PF1 11.11 avec le module Little Helper.

## v1.26.1 — Sélection de l'action par défaut dans l'onglet Avancé

- Déplace le sélecteur d'action par défaut de la liste native des actions vers une section « PF1 Automation Engine — Action par défaut » en bas de l'onglet « Avancé » des fiches d'objet contenant plusieurs actions.
- Conserve les paramètres enregistrés, les permissions OWNER, les traductions et la délégation native à `ItemPF.use()`.
- Compatibilité visée : Foundry VTT 13.351 et PF1 11.11 ; vérification finale de l'interface à effectuer en jeu.

## v1.26.0 — Action par défaut des objets PF1

- Ajoute un choix « Action par défaut » / « Demander à chaque utilisation » dans la liste native d'actions des objets possédant plusieurs actions.
- Enregistre l'identifiant de l'action choisie sur chaque objet, sans modification de son schéma PF1.
- Transmet l'ID à `ItemPF.use()`, évite le menu uniquement lors de l'utilisation ordinaire de l'objet et conserve les jets et consommations natives.
- Respecte les lancements directs d'une autre action et les appels demandant explicitement `skipDialog: true`.
- Si l'action sauvegardée est supprimée, rétablit automatiquement le sélecteur natif ; la correction reste possible dans la fiche.
- Prend en charge les permissions OWNER et les fiches V2, sans dépendre des automatisations génériques.
- Ajoute une API diagnostique et une suite de tests de non-régression ; 28 suites dans le contrôle CI.

## v1.25.1 — Utiliser les défenses et jets de sauvegarde natifs PF1

- Supprime le sélecteur « Défense ciblée » ajouté à la fiche par PF1AE : la case native **Contact** définit déjà l'attaque de contact.
- Détecte `action.isCombatManeuver` (manœuvre offensive) et compare le jet à la **DMD**, indépendamment du nom de l'action.
- Privilégie `action.touch` et le choix temporaire `ActionUse.shared.touch` pour comparer à la **CA de contact** ; utilise sinon la CA normale ou un fournisseur externe vérifié.
- Une action qui demande uniquement un jet de sauvegarde n'est jamais considérée comme une attaque contre la CA : état `pendingSave`, délégation au système PF1 et aux services PF1AE existants de sauvegardes.
- Les actions mixtes (attaque et jet de sauvegarde) conservent deux résolutions indépendantes.
- Retire les méthodes API de configuration de défense et leurs traductions ; les flags historiques `attackDefenseConfig` restent présents mais sont ignorés pour éviter une migration destructrice.
- Ajoute `api.attackResolution.classifyAction(action,actionUse?)` ; le contrat public des fournisseurs demeure disponible.
- Étend les tests de non-régression pour Contact, manœuvre, sauvegarde seule, action mixte, anciennes configurations et absence de contrôles dupliqués.

## v1.25.0 — Résolution générique des attaques et manœuvres

- Ajoute `api.attackResolution` : comparaison indépendante des jets PF1 à la CA normale, de contact, prise au dépourvu ou DMD ; gestion des 1 et 20 naturels et des données manquantes.
- Fournisseurs de défense asynchrones enregistrables, priorités explicites, erreurs et conflits diagnostiqués, désenregistrement et conservation du choix explicite de la fiche.
- Ajoute « Défense ciblée » aux actions natives, en conservant les modèles de données PF1 ; configuration persistante par Item/action ID, traduite FR/EN.
- Enrichit les événements existants `PF1AE:attack:resolved` sans retirer les anciens champs : `roll.natural`, `defense`, `resolution`, `targetResults`, UUID cible, et hook indépendant `pf1aeAttackResolution`.
- N'invente ni correspondance des attaques à plusieurs cibles, ni résultat naturel, ni succès final de camouflage non vérifié ; aucun calcul spécifique aux armes à feu.
- Garde la résolution indépendante des dégâts et des pénalités de portée natives ; documentation publique `API-ATTACK-RESOLUTION.md`.
- Deux nouvelles suites (moteur et intégration aux hooks) ; la CI passe de 25 à 27 suites automatisées.

## Unreleased v1.24.6 — Reload responsibility extraction (branch only)

- Removed `scripts/reload-core.js` from Foundry esmodules (no duplicate attack/reload hooks).
- Added lazy deprecated `api.reload` delegation to `pf1-firearms-and-reload`.
- Preserved old reload world setting invisibly for rollback; it no longer controls firearm reload functionality. The standalone module works automatically as soon as it is active in Foundry. No additional settings toggle exists.
- Range automation, attack/damage events, bootstrap and generic automations are unchanged.
- **Development only:** requires integration and live Foundry tests before release.

## v1.24.5 — Munitions PF1 liées, y compris objets de butin anciens

- Utilise en priorité la munition réelle associée à l'arme dans le champ natif « Munition par défaut ».
- Reconnaît les anciennes balles de type `loot`, sous-type `ammo`, **uniquement si l'objet est celui lié au pistolet** et que l'attaque définit un type de munition.
- Au tir, fournit le même objet à la sélection de munitions native de PF1, sans créer d'objet en double : la consommation par PF1 s'effectue une fois sur son identifiant réel.
- Maintient le nombre chargé indépendamment de la quantité d'inventaire, sans déduire de munition lors de Recharger.
- Le diagnostic liste désormais les munitions liées héritées et indique `linkedLegacy: true`.
- Test de régression : 54 balles `loot/ammo` associées, rechargement, consommation native 54 → 53, chargeur 1 → 0.
- Aucun changement d'interface : « Chargement » reste sous « Solidité ».

## v1.24.4 — Interface : Chargement sous Solidité

- Déplace la section de chargement du coin supérieur droit de l'en-tête vers le volet gauche de la fiche d'arme, immédiatement sous la ligne native « Solidité ».
- Présente le titre « Chargement », le compteur de munitions et les boutons compacts de déchargement et correction de capacité dans la même section.
- Conserve la mise en page et le défilement natifs de la fiche PF1 ; prévoit un ancrage de secours dans la barre latérale si le champ de solidité est absent.
- Ajoute la traduction du titre de section en français et anglais ; test de régression sur l'ancrage dans la sidebar.
- Aucun changement de la logique de consommation ou de rechargement.

## v1.24.3 — Rechargement : correction de la détection des munitions et diagnostic

- Supprime le refus injustifié des munitions natives PF1 non identifiées.
- Si la référence par défaut est périmée, incompatible ou épuisée et que le chargeur est vide, recherche une pile compatible avec assez de munitions et met à jour la référence native.
- Conserve les munitions déjà chargées ; aucun remplacement silencieux de leur identité.
- Ajoute `api.reload.ammoDiagnostic(weapon)` pour afficher le type attendu, les piles d'inventaire, les quantités et les réservations.
- Améliore le message d'échec : distinguer l'absence réelle de munitions natives d'une référence invalide.
- Documente le réglage obligatoire de l'action native `Recharger` : **Aucune munition** ; ne pas hériter des munitions de l'arme sur cette action non offensive, car PF1 11.11 peut planter dans `action-use.mjs`.
- Tests de régression sur les munitions non identifiées et les références périmées.

## v1.24.2 — Capacité Recharger fonctionnelle

- Retire la dépendance incorrecte aux automatisations génériques : le suivi du chargement dépend uniquement de son propre paramètre de monde.
- Reconnaît les actions natives non offensives `Recharger` / `Reload` directement sur les armes, ainsi qu'une capacité autonome `Recharger` sur un personnage possédant une seule arme rechargeable compatible.
- Évite de choisir une arme arbitraire quand plusieurs sont éligibles : avertissement clair et utilisation conseillée de l'action sur l'arme.
- Ajoute un diagnostic de rechargement et des notifications traduites en cas d'échec.
- Test de régression : capacité autonome, paramètre d'automatisations génériques désactivé et absence de consommation de munitions au rechargement.

## v1.24.1 — Correction du blocage des tirs sans chargement

- Corrige la cause d'une absence totale de blocage : l'ancien patch exigeait un constructeur interne ActionUse non exporté ; les hooks PF1 n'étaient alors jamais installés.
- Branche directement les hooks natifs `pf1CreateActionUse` et `pf1PreActionUse` pour refuser un tir **avant le jet, le chat et la consommation native**, sans modifier de prototype PF1.
- Considère le premier tir d'une arme à feu reconnue, mais pas encore chargée, comme impossible (0 projectile chargé).
- Utilise uniquement une action native `Recharger` / `Reload` créée par le joueur ; ne crée plus d'action, n'applique plus automatiquement le don Rechargement rapide et ne détermine plus le coût en actions.
- Retire le bouton de rechargement direct du widget pour ne pas contourner l'action native ; ajoute un diagnostic de blocage `api.reload.lastDiagnostic()`.
- Tests mis à jour : tir initial interdit, tir interdit à vide, double canon, action Recharger native et consommation des munitions une seule fois.

## v1.24.0 — Chargement automatique sans configuration obligatoire

- Supprime le grand formulaire de configuration de rechargement qui déformait la fiche PF1 ; le remplace par un contrôle discret dans l'en-tête de l'arme.
- Déduit la consommation par tir de `action.ammo.cost` et du nombre d'attaques natives ; conserve les anciens réglages manuels quand ils existent.
- Initialise automatiquement l'arme au premier rechargement en détectant son type de munition et sa capacité lorsqu'elle est explicitement décrite (ou correspond à un modèle simple connu), sans considérer toutes les armes inconnues comme capacité 1.
- Refuse les armes avec données contradictoires/incomplètes et conserve une correction facultative du MJ.
- Détecte Rechargement rapide uniquement si le choix de l'arme est explicite ; ne confère pas de réduction universelle à un don sans choix documenté.
- Régression : capacité du pistolet double canon, munition native, initialisation répétée et sélection de don.
- Limites inchangées : coûts d'actions non imposés mécaniquement, mélange de munitions et atomicité multijoueur non garantis.

## v1.23.1 — Correctif de l'interface de rechargement

- Corrige le filtre trop restrictif qui masquait les actions PF1 sans type de munition configuré.
- Affiche les objets de type munition de l'inventaire séparément et explique les prérequis natifs PF1 quand la sélection est vide.
- Refuse proprement une configuration avec une munition incompatible avec le type natif de l'action (sans modification de la fiche).
- Réorganise les contrôles en colonnes adaptables, place le panneau sous l'en-tête de la fiche et empêche l'agrandissement involontaire du panneau dans les mises en page flex.
- Traductions françaises et anglaises des libellés, messages d'aide et temps de rechargement.
- Étend le test de régression des listes d'actions et de munitions. Fonction de rechargement toujours expérimentale et opt-in.

## v1.23.0 — Noyau expérimental de rechargement natif

- Paramètre de monde opt-in indépendant de la portée et de la Table de confiance, sans migration automatique des armes existantes.
- Suivi persistant des chambres chargées sur l'Item, choix des objets de munitions PF1 natifs et réservation sans consommation au rechargement.
- Action PF1 de rechargement créée sans doublon, widget compact sur les fiches d'armes et API de recharge/décharge.
- Contrôle avant génération des jets des armes configurées, avec refus avant carte de chat, jets d'attaque et consommation native ; coûts par action configurables pour les doubles canons.
- Tests couvrant refus, rechargement partiel, consommation native et réduction de temps déclarative.
- LIMITATIONS : validation en session PF1 11.11 à faire ; dons et temps d'action non automatiquement appliqués, enrayement et cartouches mélangées non intégrés, non-atomicité multijoueur.

## v1.22.0 — Traductions françaises et anglaises dans Foundry

- Ajoute les ressources natives `lang/en.json` et `lang/fr.json` déclarées dans `module.json`, selon la langue de session de chaque client.
- Remplace la clé brute `PF1.Range.Penalty` dans le jet par un libellé traduit **Pénalité de portée / Range penalty**, conservant le calcul réel du malus pré-jet.
- Traduit les paramètres visibles (automatisations génériques, journaux, découverte, Table de confiance, portée, migration), les notifications de portée et de migration, et les messages de validation des effets/découvertes.
- Traduit le résumé du jet de sauvegarde produit dans le chat dans la langue du client créateur de ce résumé.
- Ajoute un test de parité et de format des traductions (clés, variables) et des simulations de jets dans les deux langues ; vérifie que les langues sont présentes dans le ZIP.
- Aucun changement de mécanique PF1, des noms techniques de Script Calls ou des valeurs de paramètres du monde.

## v1.21.2 — Correction du malus réel et de la conversion pieds/mètres

- Utilise le véritable chemin pré-jet : `pf1CreateActionUse` → `shared.attackBonus` → `ChatAttack.addAttack(extraParts)`, sans se reposer sur des données de dialogue susceptibles d'être écrasées.
- Lit les portées numériques directement dans leurs unités déclarées : 20 pieds = 6 mètres selon la grille Pathfinder de la table, au lieu d'une conversion système intermédiaire donnant un facteur excessif.
- Déduplication par instance d'action, préservation des bonus conditionnels, des scripts Deadeye, et des modificateurs de portée manuels préexistants.
- Étend les tests pour un facteur 2 à 9 m, les unités françaises, les portées numériques et les attaques répétées. Aucun changement des paramètres utilisateurs existants.

## v1.21.1 — Correctif d'application de portée native

- Corrige l'exclusion accidentelle des jets lorsque PF1 initialise la pénalité de portée à zéro.
- Accepte Token et TokenDocument pour le contrôle de scène et la mesure des cellules.
- Expose le dernier diagnostic via `api.range.lastDiagnostic()` pour identifier les cas où le moteur laisse volontairement l'attaque au système natif.
- Étend la suite de régression, conserve le paramètre opt-in et l'indépendance de Deadeye.

## v1.21.0 — Assistance de portée avant jet (optionnelle, expérimentale)

- Nouveau réglage de monde indépendant du mode Table de confiance pour les attaques d'armes à distance `rwak` et `twak`, désactivé par défaut.
- Intégration native pré-évaluation via `pf1CreateActionUse` ; sans modification des armes, des cartes déjà générées, des CA ni des scripts Deadeye.
- Mesures des cellules occupées et conversion pieds/mètres selon 5 ft = 1,5 m ; garde stricte pour les cibles ambiguës, les modificateurs manuels et les actions sans incréments.
- Test de régression dédié ; inclusion dans le workflow de publication et de construction de ZIP.
- Source native exacte du tag PF1 11.11 et comportement de la case Skip à confirmer en test Foundry réel avant activation généralisée.

## v1.20.0 — Mode « Table de confiance » et bootstrap natif automatique

- Ajoute un paramètre de monde désactivé par défaut, visible et modifiable par le MJ, avec un avertissement explicite sur l'exécution du JavaScript des joueurs sous privilèges MJ.
- Découvre les Script Calls **toggle** nommés exactement `PF1AE:bootstrap` dans les Items des acteurs du monde et des acteurs synthétiques disponibles ; initialise via `ItemScriptCall.execute()` sans basculer l'Item.
- Restaure les listeners suivis sur F5, reconnexion, transition d'exécutant et changement de scène ; événements ciblés pour les créations, éditions, suppressions et acteurs/tokens disponibles.
- Compare la source native des scripts, nettoie les anciennes fonctions lors d'une modification, évite les doublons avec les inscriptions sécurisées existantes et conserve ces dernières lors des changements de mode.
- En mode Table de confiance seulement, contourne les approbations individuelles pour les catégories et noms natifs stricts `PF1AE:bootstrap`, `PF1AE:attack:resolved` et `PF1AE:damage:*` connus. Les autres scripts restent soumis aux contrôles historiques ; la provenance native et les gardes de déduplication ne changent pas.
- Test dédié de multi-exécution, acteurs synthétiques, remplacement, sécurité et bascule des modes ; ajout à la barrière de release.
- Préserve les API existantes de PF1AE, les contextes Utilisation/Après Utilisation/Basculer et le manifeste GitHub permanent.

## v1.19.3 — Audit des tests et fiabilisation de la publication

- Le workflow de release vérifie désormais que les 28 suites de tests existantes sont explicitement réparties entre 21 suites obligatoires et 7 suites historiques exclues ; tout nouveau fichier de test exige une décision de maintenance explicite avant publication.
- Ajoute un workflow manuel `Legacy regression audit (diagnostic)` qui exécute tous les tests et affiche le résultat de chaque suite dans le résumé GitHub Actions, en signalant correctement un échec si une suite échoue.
- Met à jour le README, les métadonnées de version et l'URL du ZIP de release.
- Aucun changement des API ni de la logique d'automatisation PF1 ; les sept suites historiques restent à remettre en conformité.

## v1.19.2 — Attribution du module

- Corrige le nom de l'auteur affiché par Foundry VTT dans `module.json` : **Caelvanost** remplace **Module personnalisé**.
- Met à jour le numéro de version et l'URL du ZIP GitHub pour la release v1.19.2.
- Aucun changement du comportement ou des API du moteur.

## v1.19.1 — Exécution de secours MJ des Script Calls, sous approbation exacte

- `damageEvents` élit désormais le joueur propriétaire connecté le plus prioritaire, ou le MJ élu lorsque tous les joueurs propriétaires sont déconnectés ; les PNJ sans propriétaire joueur restent exécutés par le MJ élu.
- Nouveau service partagé `api.scriptApprovals.approve/revoke/list/check` : l'approbation MJ d'un Script Call est liée à l'UUID de l'acteur, de l'Item et à l'ID natif du script, ainsi qu'au contenu exact sérialisé. Toute édition invalide l'autorisation.
- Un refus explicite et journalisé bloque un Script Call non approuvé ou modifié lors d'une reprise MJ. Aucun JavaScript ne circule sur le socket d'approbation.
- Le même contrôle est appliqué au bootstrap persistant et aux abonnements `attack:resolved` exécutés par un MJ sur un PJ possédé par un joueur.
- `bootstrap` retire les hooks restaurés devenus non approuvés lors de la modification de l'Item.
- Les notifications de dégâts ne sont jamais exécutées sur le MJ à partir d'un socket `notify` non authentifié : seule la confirmation locale du MJ élu peut invoquer sa reprise.
- Tests de transition joueur/MJ, reconnexion, doublons et empreintes dans les suites `damage-events` et `bootstrap`.
- `module.json` v1.19.1 et ZIP de release correspondant. Aucun changement aux règles de classe.

## v1.19.0 — Événements génériques de dégâts confirmés (critiques et PV à zéro)

- Pont de dégâts natif unique : `attackOutcomes` émet un événement interne après corrélation carte/Action/attaque/cible, appel de dégâts PF1 et perte réelle de PV.
- Nouveau `api.damageEvents`, abonnements déclaratifs `PF1AE:damage:applied`, `PF1AE:damage:critical` et `PF1AE:damage:zeroHP` dans les Script Calls natifs « Après utilisation ».
- Conservation de `options.critMult`, des PV effectifs avant/après et prise en charge des tokens synthétiques et de `hp.offset` ; `criticalHitConfirmed` reste inconnu.
- Journal de déduplication persistant sur le MJ élu et livraison aux propriétaires joueurs sans faire exécuter leurs scripts avec les droits MJ.
- Rejet conservateur des applications annulées, ambiguës, sans perte de PV normaux ou absorbées uniquement par les PV temporaires.
- Nouvelle suite de tests et documentation `docs/DAMAGE-EVENTS.md`.
- `module.json` versionné en v1.19.0 avec l'URL de release GitHub correspondante ; APIs antérieures préservées.

## v1.18.0 — Bootstrap persistant des Script Calls

- Nouvelle API opt-in `api.bootstrap.register/unregister/list/restoreAll` et registre de monde géré par le MJ élu.
- Restauration après F5, reconnexion et changements de scène via `ItemScriptCall.execute(shared,extraParams)` avec le contexte `bootstrap/restoring`, sans basculer l’Item.
- Un seul client propriétaire exécute le bootstrap d’un acteur ; fallback MJ élu, anti-doublons et listeners suivis nettoyés par `unregister()`.
- UUID synthétiques complets, permissions OWNER, références invalides ignorées, aucune analyse des textes des Script Calls.
- Suite de régression bootstrap, documentation détaillée et exemple complet de script générique.
- Aucun changement aux moteurs existants : attaques, sauvegardes, buffs, durées ou autres Script Calls.

## v1.17.0 — Événements génériques de jets d’attaque pour Item Script Calls

- Ajout du pont natif `pf1AttackRoll` / `pf1PostActionUse` : un événement `attack:resolved` par jet évalué, émis après la fin de l’action native.
- Abonnement déclaratif par un Script Call PF1 `postUse` nommé `PF1AE:attack:resolved` ; découverte automatique sur les Items de l’acteur, sans hooks installés par les objets.
- Contexte d’attaque normalisé et prudent : attaquant, Item, Action, token, jet, ordre et cibles explicites ; `hit: null` faute de touche fiable.
- Protections contre doublons, récursion, abonnements en double et exécution par client sans droits.
- Un nouveau test automatisé couvre les attaques multiples, le déclenchement après utilisation native, les tokens synthétiques et les permissions.
- Aucun changement aux SaveBridge, attackOutcomes, saveOutcomes, Fascination, durées, conditions ou autres services.

## v1.16.3 — Nettoyage sécurisé des effets lors de la fin de combat

- Quand un combat est supprimé **ou arrêté** (`deleteCombat` / `updateCombat` non démarré), les minuteurs de phase sont traités **avant** leur retrait du registre ; les minuteurs de Script Call sont simplement annulés, sans exécution.
- Les ActiveEffects indépendants `saveOutcomes.linkedBuff` ne sont supprimés que si `timerId`, `outcomeId`, règle, acteur et Item/Action sources correspondent aux marqueurs PF1AE. Les buffs et effets sans ces marqueurs sont préservés.
- Les groupes `effectGroups` sont nettoyés par leur service existant ; si leur cible est inaccessible, une entrée `cleanupPending` est conservée pour une nouvelle tentative.
- Reprise persistante des nettoyages après F5, reconnexion ou `canvasReady`, même lorsqu'un combat a déjà été retiré de `game.combats`.
- Détection conservatrice des conditions orphelines antérieures à la version 1.16.3 : reconnaissance complète des flags et de l'origine, absence des minuteurs dans les **deux** registres, et délai de sécurité de 30 secondes depuis la création du document.
- Une expiration normale d'ActiveEffect en échec est désormais mise en attente pour nouvel essai, au lieu de perdre son minuteur.
- Nouveau test `combat-cleanup.test.cjs` : 13 suites de tests réussies (dont les 12 précédentes), avec acteurs synthétiques, plusieurs sources/MJ, échéances de tour, durée écoulée, orphelins et buffs d'autres sources.
- **Aucune modification des API publiques**, de Fascination, Coup étourdissant, Crushing Blow, `attackOutcomes`, `dynamicEffect` ou `templateEffect`.

## v1.16.2 — Interopérabilité attackOutcomes / saveOutcomes

- `attackOutcomes` accepte désormais les conséquences `linkedBuff`, `templateEffect` et `dynamicEffect`, comme `saveOutcomes`.
- Conservation de l’intégralité de l’objet déclaratif `saveOutcome` jusqu’à `saveOutcomes.register()` ; seul l’acteur source autoritaire et la cible des dégâts vérifiés sont imposés côté MJ.
- Conservation des vérifications Item, Action, index de frappe, carte native, Actor UUID (y compris synthétique) et déduplication.
- Tests d’intégration : échec/réussite `dynamicEffect`, copie mécanique, `templateEffect`, `linkedBuff`, acteur synthétique et minuteur.
- Aucun changement aux Script Calls de personnages.

## v1.16.1 — Approbation automatique des effets déclaratifs

- Supprime l'étape `api.effects.approve()` pour les nouveaux `dynamicEffect` déclaratifs respectant des limites strictes (3 changements, amplitude ≤ 10).
- Autorise automatiquement les modèles passifs `templateEffect` nouveaux, après validation de leur association à la source ; refuse les scripts/macros et les empreintes existantes modifiées.
- Préserve les approbations explicites, qui restent prioritaires ; `revoke` crée désormais une interdiction persistante plutôt que de réactiver le mode automatique.
- Pour les joueurs non-MJ, les effets directs sans autorisation explicite restent limités à soi-même, avec carte PF1 source obligatoire ; les malus adverses passent par un jet vérifié `saveOutcomes`.
- Conserve SaveBridge, attackOutcomes, Fascination, Coup étourdissant, Countersong, Distraction, durées, cumul et tokens synthétiques.

## v1.16.0 — GM-authorized dynamic PF1 mechanical buffs

- New `api.effects.approve/apply/revoke/listApprovals` API, exact ItemAction grants and numeric mechanical limits.
- Native PF1 buff `system.changes` creation with declarative `ItemChange` entries; no arbitrary script or formula execution.
- New `saveOutcomes` consequence `dynamicEffect` after verified native saves.
- Reuse group ledger and timers for persistence, expiry and four stacking modes.
- Preserve attackOutcomes, linkedBuff, templateEffect, bard automations and synthetic Actor UUIDs.
- Additional native-mock regression suite; real PF1 derived-stat verification remains necessary.

## v1.15.0 — Approved mechanical template effects after native saving throws

- Add generic `saveOutcomes.onFailure.type="templateEffect"` for PF1 Item Buff and ActiveEffect templates with mechanical changes, preserving all current `linkedBuff` behavior.
- Require exact fingerprint-based GM approval on registration and again before cloning, with unchanged source Actor/ItemAction and synthetic target verification.
- Reuse `effectGroups` copy ledger, native `setActive` and deletion, world-duration timers and turn-phase timers; persistent after F5/leader handoff.
- Support `stack`, `replace`, `refresh`, `ignore` (same-target global key across sources), serialized GM-authoritative deduplication and safe rollback.
- Accept only fixed-value approved mechanics; reject dynamic `parameters` in this version until PF1 native data paths are precisely verified.
- Add mechanical PF1 Buff and ActiveEffect regression tests, including successes, failures, synthetic targets, approval/fingerprint rejection, stacking and expiration.
- No modifications to Attack Outcomes, SaveBridge, Fascination, Countersong, Distraction or Stunning Fist Script Calls.

## v1.14.4 — Synthetic PF1 Actor damage confirmation (hp.offset)

- Accept both nested and flattened `updateActor` changes to `system.attributes.hp.value` and `system.attributes.hp.offset`, alongside temporary HP and nonlethal damage fields.
- Inspect PF1-native `options.pf1.deltas.hp.offset` and `_nasPrevHp` where provided, and verify against the effective Actor HP before/after rather than inferring damage from an offset alone.
- Maintain exact native attack-card/ItemAction/index/synthetic-target provenance, elected-GM authority, one-shot deduplication and short-lived direct-damage candidates.
- Add an unlinked Token Actor regression: 11 effective HP, 5 damage, `hp.offset=-5`, 6 HP remaining -> one follow-up Fortitude Action. An offset-only update with no actual loss remains ineligible.
- No public API or bard/monk Item Script Call changes. Local Foundry VTT v13/PF1 11.11 testing still required.

## v1.14.3 — Native direct damage correlation bridge

- Preserve exact native PF1 attack provenance when damage options arrive without entering tracked `ApplyDamage._onApply`.
- Correlate native `pf1ApplyDamageTargetOptions` and `pf1ApplyDamage` hooks by exact target, card, Action and attack index, tolerating options cloned between hooks only for one immediate unambiguous candidate.
- Verify actual damage in `updateActor` after the native damage PRE hook, with short timeouts and diagnostics for expected and received IDs.
- Keep previous dialog-based completion as a second path; never touch the non-configurable `ActorPF.applyDamage` accessor.
- Keep elected-GM authorization, persistent deduplication, native save outcomes, conditions and existing bard abilities unchanged.
- Expand attack outcome tests to cover direct damage, cloned options, wrong attack index and unrelated HP updates.
- This remains an experimental hook-based link and does not claim a transaction ID supplied by PF1.

## v1.14.1 — PF1 11.11 native damage dialog completion bridge

- Stop assigning `ActorPF.prototype.applyDamage`: the installed method is exposed via a non-configurable accessor. Never invoke its setter or redefine its descriptor.
- Observe the native `ApplyDamage._onApply` completion instead, while requiring both `pf1ApplyDamageTargetOptions` and `pf1ApplyDamage` provenance and verified post-application damage.
- Fail closed on missing native hooks, ambiguous target operations, interrupted dialogs, zero/fully absorbed damage and unrecognized native dialog APIs.
- Preserve attackOutcomes, saveOutcomes, SaveBridge, Fascination, Countersong, Distraction and condition timers.
- Regression simulation covers a non-configurable accessor and verifies no setter invocation.

## v1.14.0 — Source-bound attack damage outcomes (experimental)

- Add `api.attackOutcomes.register/bindAttack/unregister/list`, with source ItemAction, attack index and target validation, persistent GM-owned registry, socket acknowledgements, and deduplication.
- Correlate native `pf1ApplyDamageTargetOptions` to the specific Action ChatMessage and wrap PF1 `ActorPF.applyDamage()` without altering its result.
- Trigger the configured PF1 follow-up Action only after actual HP/nonlethal damage, after registering `saveOutcomes`; no saving throw on a miss or uncommitted damage.
- Guard against ambiguous sources, wrong target, duplicate clicks, non-GM remote attestation and interrupted execution.
- Preserve all existing v1.13.0 bardic automations and native save pipeline.
- Add Node test coverage and a complete configurable Stunning Fist example; live Foundry testing required.

## v1.13.0 — Generic PF1 save-outcome conditions and timed effects (experimental)

- Replace hardcoded fascinated-only validation with live `pf1.registry.conditions` status validation, preserving legacy Fascination.
- Add optional `onFailure.duration` for conditions independent of a parent group, including `rounds`/`seconds` and source turn-start/turn-end expiration.
- Use existing elected-GM timers and actor-specific ActiveEffect deletion. In combat, source-turn boundaries are used; outside combat durations use world time.
- Use PF1 actor `getConditionImmunities()` for native stunned and other condition immunity; fail closed and warn if immunity cannot be determined.
- Preserve source Action, real save DC, effectiveTotal, message-based deduplication and native PF1 save card behavior.
- Consume each target in a standalone rule after its verified saving throw; linked Fascination remains managed by its parent effect group.
- Requires a live-world acceptance test of stunning fist timing, token actors, and PF1 v11.11 conditions.

## v1.12.9 — SaveBridge bootstrapping and universal PF1 hook diagnostics

- Install native PF1 PRE/POST hooks unconditionally at init, with a guarded ready fallback and strict single-install protection.
- Emit `Installed PF1 save hooks` at initialization and `SaveBridge ready` at ready when generic debugging is enabled.
- Log native PRE/POST at callback entry, *before* the `genericEnabled` feature gate: logs now explain when a save was received but processing is disabled.
- No changes to source-card correlation, result resolution, Countersong, Distraction, Fascination Script Calls, or the Pathfinder 1 system.
- Add an isolated initialization regression test with no registered rules and `genericEnabled=false`.
- Runtime testing remains necessary to distinguish disabled automation from an unloaded module script.

## v1.12.8 — Native PF1 PRE/POST saving throw lifecycle bridge

- Log native `pf1PreActorRollSave` and `pf1ActorRollSave` for every enabled save, regardless of source context.
- Read the actual `ChatMessagePF` from POST and use its native roll total.
- Correlate PRE to POST only when one unambiguous pending save exists for an Actor/save type; fail closed on concurrent ambiguity.
- Preserve structured source-card provenance via `rollOptions.reference` / saveContext and suppress manual sheet rolls.
- Dispatch verified final totals through elected GM to `saveOutcomes`, including saves with no matching override.
- Preserve Countersong/Distraction effective totals, per-message idempotence and native card display.

## v1.12.8 — Native PF1 SaveBridge post-roll correlation (candidate)

- Add explicit `SaveBridge` diagnostics at native save click, pre-save hook, post-save, GM context validation and final outcome dispatch.
- Correlate PF1 d20-roll results that do not return ChatMessage objects to their separately created saving-throw ChatMessage, only when author, Actor speaker, actual rolls and structured save type match one pending native source-card save.
- Support message creation both before and shortly after `pf1ActorRollSave` without inspecting localized chat text, guessing a source Item or processing unrelated sheet saves.
- Install diagnostics for both `targetSavingThrowClick` and `Actions.onRollSave` when available, preserving native PF1 handlers.
- Keep the single elected-GM `saveOverrides` → final result → `saveOutcomes.resolve` pipeline, including saves with no applicable override.
- Add regression tests for delayed chat messages, no-override Fascination, and unrelated saving throws.
- Live PF1 11.11 click-handler/source-message acceptance testing is still required; no system files were modified.

## v1.12.6 — Silent, GM-authoritative multi-target automation

- `effectGroups.applyGroup`, `extendGroup` and `stopGroup` requests from owners now await a GM-leader socket acknowledgement and return actual success/error; no interactive GM approval.
- `effectGroups.approveTemplate(uuid)` can silently approve passive actor-owned templates from owner clients; compendium calls without an inferred source perform a non-authorizing preflight. `applyGroup` performs the source OWNER check and auto-validates and auto-approves eligible passive templates, including Compendium buffs.
- Reject automatic approval of templates with executable Script Calls, macro changes or untrusted module flags unless previously GM-trusted. Preserve precise canonical fingerprint comparison for all approved templates.
- Validate source Actor OWNER, Item/ActiveEffect provenance, source template contents and target documents on elected GM; **target ownership is not required** for source-owner initiated applications.
- Ignore identical re-application while the original group remains active within a short duplicate-click window; keep request-ID replay suppression and existing group-key replacement behavior.
- Keep saveOverrides and saveOutcomes pipelines unchanged; linked failure effects remain created by GM immediately and removed with the group.
- Note: rule-specific range/visibility/hearing requirements remain the responsibility of the initiating PF1 Item Script Call.

## v1.12.5 — Save Outcomes dispatch for all source-verified native PF1 saves

- Add one elected-GM `saveOutcomes.resolve(event)` dispatcher, invoked after final saveOverrides resolution for **every** verified native PF1 Action-card saving throw, including when no override applies (`changed:false`). No class-specific logic or extra rolls.
- Pass exact Action chat message ID, native save ChatMessage ID, source Item/Action, saving-throw type, source card DC, target Actor, and both normal/effective totals. No speculative DC recalculation.
- Reuse the existing GM socket route of `saveOverrides`; direct outcome resolution is GM-only. Preserve idempotent per-message outcome flags and separate source-specific linked effects.
- Retry briefly while the GM receives the Action ChatMessage; add diagnostics for missing source, uncorrelated rolls, unavailable services and absent numeric DC.
- Preserve Countersong, Distraction and native PF1 roll handling. No changes to Fascination Script Call.
- Simulated integration tests cover no-override failure/success, upgraded success after Countersong, source isolation, duplicate delivery and manual sheet saves. Real Foundry acceptance remains required.

## v1.12.4 — Save Outcomes PF1 ItemAction lookup and optional status fix

- Prefer the native `ItemPF.actions` Collection over legacy `system.actions` in `saveOutcomes.register()`; retain the actual `ItemAction.id` for native Action-card correlation.
- Infer `sourceActionId` only for Items with exactly one Action; still require the caller's explicit ID when multiple Actions exist.
- Accept missing or `null` `onFailure.statusId`; preserve optional official `fascinated` status and fallback to source-specific ActiveEffect when not registered by PF1.
- Add positive/negative regression tests for single/multiple Actions and status ID validation. No changes to the saving throw resolution, Countersong or Distraction pipelines.

## v1.12.3 — Generic source-bound save outcomes (experimental)

- Add `api.saveOutcomes.register/unregister/list` for exact Item+Action+target save consequences, using the *verified* native PF1 Action card's DC and `saveOverrides.effectiveTotal`.
- On failure create one minimal, source-specific, embedded ActiveEffect and attach its document to the parent `managedEffectGroups` copies ledger; group maintenance, expiration and stop manage the linked effect.
- Optional `fascinated` status is applied only if found in the active PF1 condition registry; never toggle a global status manually.
- Add elected-GM socket acknowledgements, ownership checks, persistent rule registry, per-message processing flags, persistent effect-level outcome IDs and safe replay.
- Add positive/negative simulated tests, preservation of existing native save pipeline, documentation and explicit test limitations.
- No 24-hour immunity, automatic repeat-save workflow or modifications to system PF1 files.

## v1.12.2 — Generic Distraction/illusion save-override support (candidate)

- Preserve the validated v1.12.1 native PF1 action-card save workflow.
- Add generic `pattern` and `figment` descriptors to `anyOf`/`allOf`, extracting `SpellModel.subschool` and respecting explicit illusion school `ill`; fall back to explicit Item tags where structured subschools are unavailable.
- Check sight **from the saving Actor towards the providing Actor** using the Foundry v13 polygon backend; reject blinded targets, blocked lines of sight and unavailable collision data. Self-target sight is allowed unless blind.
- Keep feet/metres conversion, dynamic actor flags, the linked `effectGroups` lifecycle and highest-result winner intact.
- No repeat-save scheduler or persistent-effect tracking.
- Requires live Foundry testing with an illusion Pattern and Figment source and multiple clients.

## v1.12.1 — Native PF1 source-reference integration hotfix (experimental)

- Restore source provenance from PF1 `rollOptions.reference` during `pf1PreActorRollSave`, using the actual originating Action ChatMessage and its `itemSource`, `actionSource`, `system.save.type` and `system.save.dc`. This no longer depends on a browser click/render hook.
- Optional reversible compatibility wrappers log `targetSavingThrowClick` or `Actions.onRollSave` and delegate **all native arguments** to the original without changing its output.
- After GM validation, update the original public Action ChatMessage with a per-target effective saving throw display. Keep the original PF1 dice roll and avoid writing private or blind totals into public flags.
- Preserve existing manual `rollWithContext`, multi-target/GM relay, source message validation, persistent save deduplication and normal unannotated sheet saves.
- Add simulated exact Captivating Song Will 16, Countersong 23, target display 23, two different targets, no override, wrapper diagnostic and F5 regressions.
- **Foundry acceptance pending:** upstream versions expose different native handler names and the live PF1 chat renderer was not available to test here.

## v1.12.0 — Native PF1 action chat-card saving throw context (experimental)

- Preserve source Actor/Item/Action and save type/DC in the native PF1 action ChatMessage through `pf1PreDisplayActionUse` and guarded message creation.
- Under Foundry v13's `renderChatMessageHTML`, observe the original save-button click in capture phase; never replace PF1 roll handlers or Actor prototypes.
- Restore the source on native `pf1PreActorRollSave`, then delegate the original `pf1ActorRollSave` to the existing elected-GM resolver.
- Cross-check the persisted source ChatMessage Item/Action/save identity on the elected GM before applying conditional Countersong.
- Record normal and effective result even when no override applies (no extra chat). Preserve native whispered/blind visibility on summary messages.
- Handle multiple targets, independent actors, F5, action IDs, socket deduplication and manual unannotated saves.
- Add `scripts/save-context.js`, `tests/native-save-context.test.cjs` and `docs/NATIVE-SAVE-CONTEXT.md`.
- **Limit:** exact PF1 11.11 button DOM compatibility and actual live workflow must be tested in Foundry before merging.

## v1.11.1 — Native PF1 supernatural/sonic save-overrides hotfix

- Resolve PF1 11.11 feat `system.abilityType: "su"` as magical; parse `system.tags` (Set), arrays, objects and strings in addition to structured spell descriptors.
- Make generic `appliesTo.anyOf` and `appliesTo.allOf` explicit. Existing `{magical:true,sonic:true,languageDependent:true}` registrations retain their OR semantics.
- `rollWithContext()` awaits elected-GM resolution, returning `normalTotal`, `effectiveTotal`, `nativeResult`, `processed` and winning source. It does not falsify native dice or retroactively alter finished PF1 actions.
- Add detailed debug logs for source traits, predicate rejection, range, hearing, current Actor flag, normal/effective totals and message-processing failures.
- Use modern Foundry v13 `ChatMessage.author` rather than deprecated `ChatMessage.user`.
- Cover exact Harpy Captivating Song (Su + Set sonic tags), Will 7 vs Countersong 10, Will 17 vs 10 and non-sonic supernatural negative control, including player↔elected GM socket reply and chat summary.
- PR remains draft pending live Foundry confirmation.

## v1.11.0 — Persistent saving throw result override infrastructure (experimental)

- Adds `api.saveOverrides`: data-only, GM-resolved, persistent rules attached to `effectGroups` and source Actor flags; never serializes JavaScript callbacks.
- Observes native PF1 `pf1PreActorRollSave(actor,rollOptions,save)` and `pf1ActorRollSave(actor,result,save)` hooks. Only **annotated** saving throws with an explicit Item origin are processed.
- Dynamic replacement value comes from an Actor flag each time, not a cached value. `higher-result` compares actual save total to all eligible replacement results, without modifying native save bonuses.
- Optional sonic / language-dependent / magical predicates from Item data, 30-ft scene range via grid measurePath, hearing/deafness and sound wall checks, and multiple sources.
- GM validates actor-owned player socket requests and actual chat message totals, deduplicates decisions with persistent message IDs, and emits `pf1aeSaveOverrideResolved` with a compact chat summary.
- Linked override rules are removed on effect-group expiration/stop, and inert when the group is missing.
- Explicit `requestRepeatSave` bridge: a GM Item script may roll a known ongoing effect; no automatic save generation against arbitrary buffs.
- Adds English `docs/SAVE-OVERRIDES.md` and `tests/save-overrides.test.cjs` to CI.
- **Limitation:** PF1's post-save hook runs after core d20 resolution. Effective totals are published to consuming scripts, not retroactively injected into PF1's already-completed outcomes. No unannotated automatic source deduction.

## v1.10.0 — Approved PF1 buff templates from Compendiums

- `api.effectGroups.approveTemplate()` accepts actor-owned ActiveEffects, actor-owned PF1 buffs, and Compendium PF1 `buff` Items.
- New approval records store template UUID, source type, diagnostic hash, and exact canonical content fingerprint. Changes to `name`, `type`, `system`, `effects`, `flags` or other relevant content invalidate approval until reapproved.
- Legacy v1.9 Actor template fingerprint-string approvals remain valid.
- `applyGroup()` resolves Compendium templates with `fromUuid()`, snapshots sanitized `toObject()` once, and creates separately tracked, natively activated PF1 embedded buff copies on each target.
- Pack identity/ownership metadata and nested embedded ActiveEffect IDs are not cloned; PF1 action and Script Call IDs are retained.
- Existing source ownership checks, player socket authorization, `extendGroup()`, `stopGroup()`, phase expirations, F5 recovery and safe rollback are preserved.
- New debug categories for approval, modified templates, source type, copies and cloning errors.
- Adds `tests/compendium-templates.test.cjs` and Compendium coverage in duration-group tests and CI. See `docs/COMPENDIUM-BUFF-TEMPLATES.md`.

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