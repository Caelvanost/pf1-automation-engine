# Auto-restauration sécurisée des Chat Actions — v1.28.0

**Aucune macro et aucune activation d'objet ne sont nécessaires.**

Un Item PF1 comportant un Script Call natif de catégorie **Basculer** (code `toggle`) nommé exactement **`PF1AE:bootstrap`** peut déclarer ses gestionnaires de boutons de chat. Le module recherche ces scripts au démarrage du monde, après F5, reconnexion du MJ, changement de MJ élu et après modification/suppression des documents.

## Architecture

1. `chat-action-bootstrap.js` découvre les Items des acteurs et des tokens synthétiques ; seuls les Script Calls `toggle` nommés `PF1AE:bootstrap` sont pris en compte.
2. Le **MJ élu** (le MJ actif dont l'ID est le premier dans le tri alphabétique) vérifie la provenance Actor/Item/Script Call, la source enregistrée et les autorisations du système `scriptApprovals`.
3. Pour les acteurs possédés par des joueurs, **une approbation explicite du Script Call dans PF1AE** est requise, sauf si le MJ a volontairement activé le mode Table de confiance. Ce mode n'est jamais activé par PF1AE.
4. Le MJ invoque le Script Call **natif** avec `call.execute({action:null}, {...})` dans un contexte spécial `bootstrap.chatActions===true`. Aucun état `state=true`, aucun clic sur l'objet, aucune activation ni émission de code sur socket.
5. Le Script Call appelle `bootstrap.registerChatActionHandler(key, fn)`. PF1AE l'enregistre exclusivement dans la mémoire du MJ élu, avec l'UUID exact de l'Item déclarant. Le code n'est pas persisté dans le chat ou envoyé par socket : la **déclaration native persistée** est la source de vérité.
6. Chaque clic utilise l'API Chat Actions v1.27.0, dont l'arbitrage MJ, la vérification OWNER, l'état `pending/used` et les protections contre les exécutions concurrentes sont conservés.

## Script Call complet — déclaration d'un gestionnaire

**Catégorie : Basculer. Nom exact : `PF1AE:bootstrap`.**

```js
if (typeof bootstrap !== "undefined" &&
    bootstrap?.restoring === true &&
    bootstrap?.chatActions === true) {
  bootstrap.registerChatActionHandler(
    "my-ability.some-effect",
    async ({actor: target}) => {
      // Logique générique de votre capacité.
      if (!target) return {ok:false,reason:"No target"};
      // Vérifier les préconditions AVANT de modifier l'acteur.
      return {ok:true,confirmation:"Action resolved"};
    }
  );
}
```

L'enregistrement est automatique, et le gestionnaire n'existe que sur le MJ élu. Le nom/identité exact du Script Call et son code sont protégés par la vérification d'approbation. Il ne doit pas y avoir de `api.bootstrap.register()`, `state=true`, `Hooks.on()` ou macro MJ dans cette déclaration.

## Cas particulier : acteur possédé par un joueur

Le MJ **doit approuver la source exacte une fois**, par son système existant `scriptApprovals.approve({actor,item,scriptId})`, ou activer volontairement le mode Table de confiance. Approuver une version n'autorise **pas** une nouvelle version du script : toute modification exige une nouvelle approbation lorsque le mode Table de confiance est désactivé.

La restauration n'est pas assimilée à une prise de contrôle générale de l'acteur : elle permet exclusivement à du code de Script Call **déjà approuvé** de déclarer les fonctions identifiées. Le MJ valide les permissions de chaque demande au moment du clic. Un script non approuvé n'est pas exécuté sur le MJ, même si le propriétaire du personnage est en ligne.

## Cycle de vie

- Ouverture du monde, F5, reconnexion : scan automatique ; pas de doublons.
- Changement de MJ : ancien MJ désenregistre les fonctions, nouveau MJ les restaure.
- Modification/suppression de Script Call ou Item/Actor, révocation : fonctions retirées. Les fonctions déjà en cours d'exécution restent soumises aux contraintes de cohérence du module.
- Désactivation du module : aucun gestionnaire actif lors de la réconciliation.
- Anciennes cartes : les identifiants de gestionnaire et UUID de source existants restent compatibles. Une carte dont l'Item source n'existe plus ne peut plus être exécutée.
- Gestionnaire absent : refus explicite ; le bouton n'est pas consommé.
- Erreur après mutation partielle : état persistant `pending`, à examiner par le MJ avant un `reset`.

## API publique

```js
const moduleApi = game.modules.get("pf1-automation-engine")?.api;
await moduleApi.chatActionBootstrap.scan();        // diagnostic ou réconciliation facultative
console.table(moduleApi.chatActionBootstrap.status());
```

L'API `chatActions.create()/click()/getState()/reset()` et le format des boutons ne changent pas. La nouvelle méthode `bootstrap.registerChatActionHandler()` n'existe **que dans le contexte sécurisé** d'un Script Call natif approuvé exécuté par le MJ élu ; elle n'est pas une méthode globale permettant à un joueur d'installer du code arbitraire.

[Exemples Utility Shot complets](examples/utility-shot-stop-bleeding.md).

## Limites et précautions

Le modèle Foundry repose sur le MJ élu connecté pour les mutations des messages et des acteurs. Il n'existe pas de processus d'autorité hors ligne. Au moment d'une bascule simultanée de MJ, des vérifications d'élection et de source bloquent une exécution devenue invalide. Pour une opération critique, vérifier que la synchronisation du changement de MJ s'est achevée avant un clic.

La sécurité d'un gestionnaire approuvé dépend de son code : garder les validations de la capacité et les préconditions côté MJ avant tout effet. Les approbations du mode Table de confiance élargissent volontairement les possibilités d'exécution de scripts joueurs ; elles ne doivent être activées qu'en connaissance de cause.
