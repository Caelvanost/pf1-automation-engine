# Approbations de Script Calls pour reprise automatique par le MJ (v1.19.1)

Le propriétaire joueur connecté exécute normalement ses scripts d'objets. Lorsque **tous** les propriétaires joueurs d'un Actor sont déconnectés, le MJ élu peut exécuter ses automatisations **uniquement si chaque Script Call exécuté par le MJ a été approuvé explicitement**.

Une simple permission OWNER sur la fiche ne constitue jamais une approbation du code exécutable avec les droits MJ.

## Approbation par le MJ — directement dans Foundry

Depuis la console F12 de la session du **MJ élu** (le premier MJ connecté, classé par ID), après avoir ouvert la fiche concernée :

```javascript
const api = game.modules.get("pf1-automation-engine")?.api;
if (!api?.scriptApprovals) throw new Error("PF1AE v1.19.1 requis.");

// Adapter ces deux noms à la fiche, sans jamais faire appel à eval().
const actor = game.actors.getName("Zéphir");
if (!actor) throw new Error("Personnage introuvable.");

const item = actor.items.getName("Grit");
if (!item) throw new Error("Capacité introuvable.");

const calls = item.scriptCalls?.contents ??
  (typeof item.scriptCalls?.values === "function" ? [...item.scriptCalls.values()] : []);

const call = calls.find(c =>
  c.category === "postUse" &&
  c.name === "PF1AE:damage:applied"
);
if (!call) throw new Error("Script Call damage:applied introuvable.");

console.log(await api.scriptApprovals.approve({
  actor,
  item,
  scriptId: call.id ?? call._id
}));
```

**Le code n'est pas transmis à PF1AE :** il est relu directement dans l'Item natif du monde par le MJ élu. Les données sauvegardées du Script Call sont conservées intégralement dans l'empreinte d'approbation. L'API rejette les modèles qui ne fournissent pas de données de script sérialisables.

L'approbation est enregistrée dans les paramètres du monde `scriptFallbackApprovals`. Elle survit à F5, reconnexion et changements de scène.

## API

- `await api.scriptApprovals.approve({actor,item,scriptId})` — **MJ élu uniquement** ; remplace l'approbation de ce script par son contenu exact actuel.
- `await api.scriptApprovals.revoke({actor,item,scriptId})` — MJ élu uniquement ; retire l'approbation.
- `api.scriptApprovals.list()` — liste les approbations stockées.
- `api.scriptApprovals.check(actor,item,call)` — vérifie localement l'identité et l'empreinte exacte du Script Call natif ; retourne `{approved,reason?}`.

L'identité d'une approbation est le triplet `[actorUuid,itemUuid,scriptId]`, comprenant les UUID complets des Actors synthétiques de tokens non liés.

**Attention :** si le joueur modifie le code ou une donnée sauvegardée de son Script Call, l'empreinte ne correspond plus, et le MJ doit **réapprouver** explicitement. Le code modifié ne reçoit jamais d'approbation tacite.

### Quels abonnements approuver ?

- `PF1AE:damage:applied`, `PF1AE:damage:critical`, `PF1AE:damage:zeroHP` : Script Calls `postUse` du PJ qui doivent fonctionner en l'absence du propriétaire.
- `PF1AE:attack:resolved` : Script Calls `postUse` d'un PJ lorsque le MJ joue ses attaques.
- `PF1AE:bootstrap` : Script Call `toggle` déjà enregistré dans le bootstrap, à restaurer quand le joueur est absent.

Les appels `Utilisation`, `Après utilisation` et `Basculer` ordinaires ne sont pas altérés.

## Sécurité et transfert d'exécution

- Le joueur propriétaire élu est prioritaire. Si aucun propriétaire joueur n'est connecté, le MJ élu reprend les automatisations approuvées. Un PNJ sans aucun propriétaire joueur reste exécuté par le MJ élu, comme auparavant.
- Le service `damageEvents` vérifie la provenance native, les PV et la transaction avec le MJ élu avant l'envoi. Le client MJ **refuse les notifications de dégâts arrivant comme de simples paquets socket**, même si le paquet prétend provenir du leader. Seule une attestation native locale du pont de dégâts peut démarrer l'exécution MJ.
- Les identifiants de dégâts ont un registre de déduplication persistant. Lorsqu'une session change de responsable, le nouveau client revérifie l'exécuteur élu. Les Script Calls ne sont pas transmis comme du code dans les messages socket.
- Le bootstrap retire les listeners enregistrés via `bootstrap.listen()` lorsque le joueur revient ou lorsqu'une modification du script invalide son approbation. Un listener installé directement avec `Hooks.on()` dans un ancien script ne peut pas être retiré automatiquement.
- L'exécution d'un Script Call est du JavaScript complet : le MJ doit **examiner réellement le code** avant l'approbation. L'approbation est une décision de confiance explicite et ne constitue pas un bac à sable.

## Protocole réel Foundry 13 / PF1 11.11

1. Avec un joueur connecté et le MJ connecté, appliquer des dégâts : le joueur propriétaire reçoit l'événement ; le MJ ne lance pas ce script.
2. Déconnecter ce joueur et appliquer de nouveaux dégâts sans approbation : le moteur affiche `GM fallback Script Call refused` avec la raison précise.
3. Approuver la capacité dans la console MJ, puis appliquer des dégâts natifs : une seule exécution sur le MJ élu.
4. Activer un second MJ : le second ne doit pas exécuter le script.
5. Modifier le Script Call, appliquer à nouveau des dégâts : refus immédiat et demande de réapprobation.
6. Réapprouver, tester un Actor synthétique de token non lié et un Actor lié.
7. Reconnecter le joueur pendant le combat : nouveaux événements sur son client, sans doublon sur le MJ.
8. Tester F5, changement de scène, édition d'un bootstrap actif et deux applications simultanées : aucun listener supplémentaire, aucun saut de contrôle.
9. Vérifier aussi les abonnements d'attaque et les anciens scripts de sauvegarde/effets.

**Limite connue :** les sockets Foundry natifs ne fournissent pas de preuve cryptographique d'origine. Les événements de dégâts exécutés sur le MJ proviennent uniquement du chemin de confirmation natif local ; les propriétaires reçoivent des notifications destinées à leur propre client. Une garantie exactement-une-fois après une panne réseau au milieu d'un Script Call demanderait un protocole d'accusé de réception transactionnel supplémentaire. Ce changement ne promet pas cette garantie en cas de coupure en plein traitement.

## Exception explicite : Table de confiance (v1.20.0)

Le MJ peut activer le réglage de monde `trustedTableMode` dans les paramètres de PF1 Automation Engine. **Désactivé par défaut**, il conserve toutes les approbations déjà enregistrées sans les modifier ni les supprimer.

Lorsque le mode est activé, `scriptApprovals.check(actor,item,call)` continue de contrôler le document Actor, l'Item qui lui appartient, l'identité exacte du Script Call natif et sa catégorie. Pour ces **seuls noms exacts**, il autorise la reprise MJ sans empreinte individuelle :
- `toggle` : `PF1AE:bootstrap`
- `postUse` : `PF1AE:attack:resolved`, `PF1AE:damage:applied`, `PF1AE:damage:critical`, `PF1AE:damage:zeroHP`

Les Script Calls ordinaires, les noms ressemblants et les catégories non reconnues demeurent soumis à la validation individuelle. Une modification d'un script PF1AE reconnu n'impose pas de nouvelle approbation en mode de confiance ; le retour au mode sécurisé remet immédiatement en vigueur les approbations exactes antérieures.

**Risque assumé :** un joueur autorisé à éditer une capacité peut fournir du JavaScript qui sera ensuite exécuté avec les privilèges du MJ élu. Ne jamais activer ce mode dans un monde public ou avec des joueurs non fiables. Les vérifications de provenance native des dégâts, de permissions des documents, d'élection du client, de déduplication et d'absence de récursion ne sont pas désactivées. L'interprétation des sockets Foundry ne constitue pas une authentification cryptographique.
