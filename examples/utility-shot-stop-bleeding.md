# Utility Shot — Stop Bleeding (PF1AE v1.28.0)

Ce dossier donne les Script Calls complets du **gestionnaire automatique** et
un exemple autonome de publication de bouton, sans macro MJ. L'API est
générique et ne contient aucune règle de pistolier : la logique Bleed reste
dans les Script Calls du personnage.

Attention : le code exact des Script Calls actuels de Zéphir n'est pas
présent dans le dépôt. Pour ne pas supprimer *Blast Lock* et *Scoot
Unattended Object*, conserve le Script Call `Utility Shot - Prepare`
actuel ainsi que les branches fonctionnelles de ton `PF1AE:attack:resolved`
et ajoute les traitements ci-dessous dans les emplacements prévus.

## 1. Utility Shot - Prepare — Utilisation

**Aucun changement nécessaire** : le script actuel propose déjà les trois
choix et stocke le mode dans `world.utilityShotPending`.

Ne remplace pas son fonctionnement natif PF1/PF1FR de sélection du tir,
de l'attaque, des munitions et des ressources.

## 2. PF1AE:bootstrap — Basculer

**Nom exact :** `PF1AE:bootstrap`.

Ajouter ce Script Call sur **l'Item Utility Shot de Zéphir**.
Il n'est pas nécessaire d'activer cet Item, d'enregistrer le gestionnaire
manuellement, de lancer une macro ou d'appeler `api.bootstrap.register()`.

Lorsque l'acteur appartient à un joueur, le MJ doit approuver ce Script Call
dans le système existant d'approbation de PF1AE. L'approbation reste valable
après F5, mais est invalidée après modification du code lorsque le mode
Table de confiance est désactivé.

Script complet, à copier-coller :

~~~js
if (
  typeof bootstrap !== "undefined" &&
  bootstrap?.restoring === true &&
  bootstrap?.chatActions === true
) {
  bootstrap.registerChatActionHandler(
    "utility-shot.stop-bleeding",
    async ({ actor: target, requester }) => {
      // Ce contrôle est spécifique à Utility Shot : il n'est PAS dans PF1AE.
      const bleeding =
        target?.statuses?.has("bleed") === true ||
        target?.system?.conditions?.bleed === true;

      if (!bleeding) {
        return {
          ok: false,
          reason: "The selected character has no Bleed condition."
        };
      }

      if (typeof target.setCondition !== "function") {
        return {
          ok: false,
          reason: "PF1 Actor.setCondition is unavailable."
        };
      }

      // Toutes les préconditions doivent être vérifiées AVANT la mutation.
      // Les contrôles MJ/OWNER sont effectués par le moteur Chat Actions.
      await target.setCondition("bleed", false);

      return {
        ok: true,
        confirmation:
          requester.name + " stopped bleeding on " + target.name + "."
      };
    }
  );
}
~~~

**Important :** ce script n'exécute aucune capacité lors de la découverte.
Il enregistre simplement une fonction pour les futurs clics autorisés.
Les fonctions ne sont disponibles que sur le MJ élu. La source du script,
son UUID d'Item et son approbation sont revérifiés au clic.

## 3. PF1AE:attack:resolved — Après Utilisation

**Nom exact :** `PF1AE:attack:resolved`.

Cette version **autonome** traite la publication de la carte Stop Bleeding
après l'attaque native. Elle ne contient pas la logique des deux autres
options. Si un Script Call de ce nom existe déjà, **fusionne le traitement
dans celui-ci** avant qu'il efface `world.utilityShotPending`.
Ne crée pas deux souscriptions identiques sur le même Item.

Script complet autonome Stop Bleeding :

~~~js
const sourceActor =
  typeof actor !== "undefined"
    ? actor
    : (typeof item !== "undefined" ? item?.actor : null);

const automation =
  game.modules.get("pf1-automation-engine")?.api;

if (
  sourceActor &&
  automation?.chatActions &&
  typeof event !== "undefined" &&
  event?.type === "attack:resolved"
) {
  const pending = sourceActor.getFlag(
    "world",
    "utilityShotPending"
  );

  const choice =
    typeof pending === "string"
      ? pending
      : pending?.choice ??
        pending?.option ??
        pending?.mode ??
        pending?.type ??
        null;

  const normalized = String(choice ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, " ");

  if (
    normalized === "stop bleeding" ||
    normalized === "arrêter le saignement"
  ) {
    const utilityShot = [...sourceActor.items].find(
      entry => entry.name === "Utility Shot"
    );

    const expectedWeapon =
      pending?.weaponUuid ??
      pending?.firearmUuid ??
      null;

    const correctWeapon =
      !expectedWeapon ||
      expectedWeapon === event.itemUuid;

    const attackKey = String(
      event.sourceMessageId ??
      event.roll?.id ??
      ""
    );

    const alreadyCreated =
      attackKey &&
      sourceActor.getFlag(
        "world",
        "utilityShotStopBleedingCard"
      ) === attackKey;

    if (utilityShot && correctWeapon && !alreadyCreated) {
      await automation.chatActions.create({
        actor: sourceActor,
        sourceItem: utilityShot,
        title: "Utility Shot — Stop Bleeding",
        content:
          "Sélectionnez un unique token par clic gauche, " +
          "puis utilisez le bouton pour arrêter le saignement.",
        buttons: [
          {
            id: "stop-bleeding",
            label: "Arrêter le saignement",
            icon: "fa-solid fa-heart-pulse",
            handlerKey: "utility-shot.stop-bleeding",
            targetMode: "controlled",
            permission: "OWNER",
            exactOne: true,
            once: true
          }
        ]
      });

      if (attackKey) {
        await sourceActor.setFlag(
          "world",
          "utilityShotStopBleedingCard",
          attackKey
        );
      }
    }
  }
}
~~~

Ce script ne modifie pas les actions natives du pistolet. Il ne faut pas
supprimer la logique actuelle qui gère les autres modes ni les conditions
d'activation de `Utility Shot`.

## 4. Tests pratiques

1. Installer PF1AE v1.28.0 et recharger Foundry sur le MJ et les joueurs.
2. Vérifier que le Script Call `PF1AE:bootstrap` existe dans **Basculer**,
   sur le même Item Utility Shot, puis l'approuver si le personnage appartient
   à un joueur. **Ne pas lancer de macro**.
3. Dans la console du MJ, vérifier :
   `game.modules.get("pf1-automation-engine").api.chatActionBootstrap.status()`.
4. Le mode Stop Bleeding est préparé et le pistolet effectue une attaque
   native, qui publie la carte avec le bouton.
5. Le joueur propriétaire sélectionne son token d'un clic gauche (sans T).
   Si Bleed n'est pas présent, le bouton reste disponible.
6. Ajouter la condition native PF1 Bleed ; le clic suivant doit la retirer,
   publier la confirmation et désactiver le bouton.
7. Vérifier un non-propriétaire, double clic, F5, reconnexion et changement
   de MJ. Tous les contrôles et flags restent pris en charge par PF1AE.

La portée et l'adjacence sont laissées à la discrétion du MJ pour ce test.
