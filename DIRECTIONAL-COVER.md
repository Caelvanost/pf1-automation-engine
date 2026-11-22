# PF1AE — Abris directionnels temporaires (v1.41.7)

## Architecture

`api.directionalCover` fournit un service générique : `register()`, `remove()`, `list()`, `inspect()`, `chooseEdge()` et `cleanup()`. Les données résident dans le flag natif `flags.pf1-automation-engine.directionalCover` de l'Item source appartenant au défenseur. Aucune mutation de `system.attributes.ac`, aucun `WallDocument` ou script transmis par socket.

### Déclaration `register`

```js
await game.modules.get("pf1-automation-engine").api.directionalCover.register({
  key: "my-directional-effect",
  sourceItemUuid: item.uuid,
  defenderUuid: actor.uuid,
  tokenUuid: token.document.uuid,
  protectedEdge: "north", // north|east|south|west, bords du plateau et non orientation du token
  coverType: "total", // partial|normal|improved|total
  duration: "startOfNextTurn",
  combatId: game.combat.id,
  combatantId: game.combat.combatant.id,
  requireEquipped: true, // seulement si l'objet source le nécessite
  exceptions: { targetedSpells: true },
  reason: "Protection directionnelle"
});
```

La durée est ancrée au combat et au combattant actifs. L'API exige le tour du personnage, ne programme aucune échéance fictive hors combat et écrit sur l'Item source par les permissions natives OWNER/MJ. Le mode `startOfNextTurn` est calculé comme le début du prochain tour du porteur ; à ce moment, les effets deviennent immédiatement inapplicables, même avant leur nettoyage persistant par le MJ élu.

`inspect({attacker,target,attackType,action,actionUse})` utilise les rectangles des tokens et 16 rayons entre coins intérieurs. L'abri total n'est confirmé que si toutes les trajectoires traversent strictement le bord protégé. Les diagonales, les tangences, les élévations différentes et les géométries non certifiées restent `uncertain` plutôt que bloquées abusivement. Les protections suivent les déplacements puisque le bord est recalculé depuis le TokenDocument actuel.

Le service est intégré à `api.coverPF1.inspect()` et au garde pré-jets existant de `cover-native-bridge.js`. Il ne change pas les bonus d'abri existants et n'accorde pas de bonus de Réflexes fictif pour l'abri total. Seuls les jets d'attaque directs pris en charge par le pipeline natif (armes, attaques de contact, rayons) sont interceptés. Les sorts directement ciblés sans jet d'attaque, zones et étendues ne sont pas annulés.

Le mode générique `partial`, `normal` et `improved` ne se cumule pas : le grade le plus fort est conservé lorsqu'un calcul géométrique est confirmé. Les sources de CA sont toujours évaluées par les contrôles existants pour éviter un double comptage.

## Exemple : Pavois — Grant Total Cover

Dans la fiche d'objet **Pavois**, configurer une action native nommée `Grant Total Cover`, coût **action simple**, sans attaque, sans dégâts ni charge. Ajouter le Script Call ci-dessous en catégorie **Utilisation**. Il est important de ne **pas** le placer en `Après Utilisation` : cette dernière catégorie ne peut pas annuler rétroactivement une dépense. La sélection n'est pas une promesse que le moteur PF1 annule l'action lui-même, mais elle précède la création de la défense. L'objet ne doit donc pas consommer de charges à l'utilisation.

Ce script reste propre au pavois. Le moteur générique ignore les noms du bouclier et de l'action.

```javascript
// Pavois PF1 — Grant Total Cover (Script Call : Utilisation)
const dc = game.modules.get("pf1-automation-engine")?.api?.directionalCover;
if (!actor || !item || !dc?.register || !dc?.chooseEdge) {
  ui.notifications.error("PF1AE : abri directionnel indisponible.");
  return;
}
if (item.actor?.uuid !== actor.uuid || item.system?.equipped !== true) {
  ui.notifications.warn("Grant Total Cover : le pavois doit être équipé.");
  return;
}
const combat = game.combat;
if (!combat?.started || combat.combatant?.actor?.uuid !== actor.uuid) {
  ui.notifications.warn("Grant Total Cover : activer pendant le tour du porteur dans un combat.");
  return;
}
// Priorité au token transmis par PF1, puis au token contrôlé et enfin
// au token unique représentant cet acteur sur la scène.
const direct = token?.document?.uuid && token.actor?.uuid === actor.uuid ? token : null;
const controlled = (canvas.tokens?.controlled ?? []).filter(t => t.actor?.uuid === actor.uuid);
const active = (actor.getActiveTokens?.() ?? []).filter(t => t.document?.parent?.id === canvas.scene?.id);
const source = direct ?? (controlled.length === 1 ? controlled[0] :
  active.length === 1 ? active[0] : null);
if (!source?.document?.uuid) {
  ui.notifications.warn("Grant Total Cover : sélectionnez un token unique du porteur.");
  return;
}
const edge = await dc.chooseEdge();
if (!edge) return; // L'utilisateur a annulé la sélection.
const labels = {north:"Nord",east:"Est",south:"Sud",west:"Ouest"};
try {
  await dc.register({
    key:"tower-shield-total-cover",
    sourceItemUuid:item.uuid,
    defenderUuid:actor.uuid,
    tokenUuid:source.document.uuid,
    protectedEdge:edge,
    coverType:"total",
    duration:"startOfNextTurn",
    combatId:combat.id,
    combatantId:combat.combatant.id,
    requireEquipped:true,
    exceptions:{targetedSpells:true},
    reason:"Pavois — abri total"
  });
} catch (error) {
  console.error("[PF1AE][Tower Shield] Grant Total Cover",error);
  ui.notifications.error("Grant Total Cover : impossible d'activer la protection.");
  return;
}
const escape = value => String(value).replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
await ChatMessage.create({
  speaker:ChatMessage.getSpeaker({actor}),
  content:`<p><strong>Pavois — Abri total</strong></p>
    <p>Porteur : ${escape(actor.name)}<br>
    Bord protégé : <strong>${labels[edge]}</strong><br>
    Protection : abri total directionnel<br>
    Durée : jusqu'au début du prochain tour.</p>`
});
```

## Limites de validation

Le moteur d'attaques PF1 n'emploie pas automatiquement ce service pour les sorts de zone, étendues et effets sans jet d'attaque ; ils demeurent soumis aux règles natives et à l'arbitrage du MJ. Les tirs diagonaux dont certains rayons traversent le bord et d'autres non ne sont pas bloqués automatiquement. Les élévations différentes et les interactions avec Levels restent indéterminées plutôt qu'inventer un mur vertical 3D.

L'indicateur graphique sur le bord du token n'est pas inclus dans cette version (non essentiel au calcul). La sélection est montrée par une boîte de dialogue à quatre directions, avec annulation. Une vérification manuelle dans Foundry v13/PF1 11.11 demeure nécessaire pour confirmer le moment exact du Script Call `use` et le comportement de l'action simple dans une configuration de fiche réelle.
