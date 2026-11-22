# PF1AE v1.41.6 — Bastion du Bien (Bouclier béni / Sacred Shield)

Ces exemples sont **des Script Calls natifs PF1 sur le même objet**, jamais des règles codées dans le moteur générique. Référence : Pathfinder 1e, *Art de la guerre*, archétype Bouclier béni.

**Configuration de l'objet Bastion du Bien** : activité native qui consomme ses utilisations quotidiennes (celles de Châtiment du Mal), avec une cible unique et une action rapide. Ne pas dupliquer les dépenses de ressources dans les scripts.

- Script Call **Après Utilisation** `Bastion du Bien - Activation` : code ci-dessous ;
- Script Call **Après Utilisation** nommé exactement `PF1AE:rest:daily` : code de nettoyage ci-dessous.
- En mode sécurisé, le MJ approuve précisément le second Script Call dans **Approbations des scripts** ; en mode **Table de confiance**, son nom et sa catégorie sont autorisés automatiquement. Aucune macro d'inscription.
- En l'absence de cible unique, d'alignement confirmé ou de niveau de paladin lisible, le script d'activation ne crée pas de défense. La consommation native de l'utilisation, déjà effectuée, n'est pas annulée.
- Les dégâts subis par les alliés sont réduits **manuellement** par le MJ dans la carte native (aucune automatisation).
- L'immersion, les abris et les types de CA sont gérés par PF1AE ; le script n'altère jamais `actor.system.attributes.ac`.
- La validation fonctionnelle dans Foundry 13.351 / PF1 11.11 reste nécessaire pour confirmer les chemins de caractéristiques/classes selon la fiche du personnage.

## Après Utilisation — Bastion du Bien - Activation

```javascript
// Pathfinder 1e — Bouclier béni : Bastion du Bien
// Exécuter uniquement lors de l'utilisation native de la capacité.
const pf1ae = game.modules.get("pf1-automation-engine")?.api;
if (!actor || !item || item.actor?.uuid !== actor.uuid ||
    !pf1ae?.defenseModifiers?.register) {
  ui.notifications.error("PF1AE : capacité ou service de défense indisponible.");
  return;
}
const selected = [...(game.user?.targets ?? [])];
if (selected.length !== 1 || !selected[0]?.actor?.uuid) {
  ui.notifications.warn("Bastion du Bien : désignez une seule cible.");
  return;
}
const target = selected[0].actor;
const rawAlignment = String(target.system?.details?.alignment ?? "")
  .trim().toLowerCase();
const evil = new Set(["le", "ne", "ce"]);
if (!evil.has(rawAlignment)) {
  ui.notifications.info("Bastion du Bien : cible non mauvaise ou alignement inconnu. Utilisation dépensée sans effet.");
  return;
}
const levelFromClass = actor.items?.find(i =>
  i.type === "class" &&
  (i.system?.tag === "paladin" ||
   /^paladin$/i.test(String(i.name ?? "").trim()))
);
const level = Number(
  actor.classes?.paladin?.level ??
  levelFromClass?.system?.level ??
  levelFromClass?.system?.levels
);
const charisma = Number(actor.system?.abilities?.cha?.mod);
if (!Number.isFinite(level) || level < 1 || !Number.isFinite(charisma)) {
  ui.notifications.error("Bastion du Bien : niveau de paladin ou modificateur de Charisme indisponible.");
  return;
}
// PF1 Bouclier béni : bonus de parade égal au bonus de Charisme,
// augmenté de +1 tous les 4 niveaux de paladin, maximum +6.
const deflection = Math.min(6, Math.max(0, charisma) + Math.floor(level / 4));
if (deflection <= 0) {
  ui.notifications.info("Bastion du Bien : aucun bonus de parade positif à appliquer.");
  return;
}
const key = "bastion-" + String(target.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50);
await pf1ae.defenseModifiers.register({
  key, sourceItemUuid: item.uuid, defenderUuid: actor.uuid,
  attackerUuid: target.uuid, expiresOnDeathOf: target.uuid,
  bonusType: "deflection", value: deflection,
  defenses: ["normal", "touch", "flatFooted"],
  reason: "Bastion du Bien"
});
const safe = value => String(value).replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const radius = level >= 11 ? "6 m" : "3 m";
await ChatMessage.create({
  speaker: ChatMessage.getSpeaker({actor}),
  content: `<p><strong>Bastion du Bien</strong> — ${safe(actor.name)}</p>
    <p>Cible désignée : <strong>${safe(target.name)}</strong>.</p>
    <p>Parade conditionnelle : <strong>+${deflection} CA</strong> contre cette cible uniquement.</p>
    <p>Alliés dans un rayon de ${radius} : moitié des dégâts des attaques de cette cible (application manuelle).</p>`
});
```

## Après Utilisation — PF1AE:rest:daily

```javascript
// Exécuté par PF1AE après le repos natif qui restaure les usages quotidiens.
// Si le Script Call est lancé par une utilisation normale, il ne fait rien.
if (typeof event === "undefined" ||
    event?.type !== "pf1ActorRest" ||
    event?.actorUuid !== actor?.uuid ||
    event?.rest?.completed !== true ||
    event?.rest?.restoreDailyUses !== true) {
  return;
}
const service = game.modules.get("pf1-automation-engine")
  ?.api?.defenseModifiers;
if (!service?.list || !service?.remove || !item?.uuid) return;
const modifiers = service.list({
  defenderActor: actor, defenderUuid: actor.uuid
}) ?? [];
for (const modifier of modifiers) {
  if (modifier.sourceItemUuid !== item.uuid ||
      !String(modifier.key).startsWith("bastion-")) continue;
  await service.remove({
    key: modifier.key,
    sourceItemUuid: item.uuid,
    defenderUuid: actor.uuid
  });
}
```

## API et sécurité

`api.nativeCover.inspectTypes({actor,defense,types})` analyse les contributions explicitement typées de `ActorPF.getSourceDetails()` à la CA native (`normal`, `touch`, `flatFooted`). En cas de provenance ambiguë, la défense reste indéterminée ; la fiche n'est pas modifiée.

`api.restDaily.discover(actor)` expose les appels `postUse` nommés `PF1AE:rest:daily` présents sur les objets de l'acteur. Le moteur utilise l'événement natif post-repos `pf1ActorRest` (avec `rest.id`, `restoreDailyUses`, `before`, `after`, `nativeUpdates`). Un repos avec uniquement restauration des PV ne déclenche jamais ce nettoyage.

`api.defenseModifiers.expireConfirmed(actor)` retire définitivement les défenses dont `expiresOnDeathOf` correspond à un acteur portant l'état PF1 `dead`. Les simples PV à zéro ne provoquent pas d'expiration.
