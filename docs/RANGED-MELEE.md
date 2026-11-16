# PF1AE — Shooting into Melee v1.33.5

Foundry VTT 13.351, Pathfinder 1e 11.11, and optional PF1 Firearms & Reload.

## Pathfinder rules and limitations

A ranged attack against an enemy in melee with a friendly creature suffers **−4**. The penalty falls to **−2** when the target is two sizes larger than that ally and disappears if three or more sizes larger. It can also be avoided when the target (or the part aimed at) is at least **10 feet** from the nearest friendly creature. In PF1, engaged melee means **enemies where either threatens the other**: mere adjacency does not suffice.

Rules reference: https://pathfinder.d20srd.org/coreRulebook/combat.html

The automation does not identify feats, classes or traits. Cover, concealment, ranged increment penalties, full-attack bonuses, PF1FR's firearms touch AC, Grit and ammunition are independent.

## Native pre-roll point

PF1 11.11 ActionUse.addAttacks loops over shared.attacks. For each attack it calls ChatAttack.addAttack with extraParts containing shared.attackBonus and the **indexed** atk.attackBonus. PF1's pf1PreActionUse hook is called **after** the ChatAttack rolls have been generated, so it is too late.

For a **verified single-target** ranged use, PF1AE now uses exactly the **same extension point as range penalties**: `pf1CreateActionUse`, adding `-4[PF1AE Shooting into Melee]` (or `-2`) to `shared.attackBonus` before the native attack dialog and dice. The original native `ActionUse.addAttacks` loop consumes that shared part for each roll.

The existing `ActionUse.addAttacks` bridge is retained only for late manual dialogue decisions, changes in target/geometry, and **indexed exceptions**. An indexed override is applied as a *difference from the common bonus*; for example, Precise Shot's penalty 0 adds a +4 correction to an attack inheriting the common −4. This preserves per-attack decisions without changing any Actor or Item documents. All temporary index bonuses are restored in `finally`; only the exact PF1AE melee shared part is removed after use, never a range/feat/native part. `pf1PostActionUse` also cleans abandoned tracked uses.

## Automatic detection: conservative policy

The engine examines one explicit target from the attacker's native user.targets, scene identity, occupied grid cells and measured distance, PF1 token disposition, actor size, known numeric reach, equipped melee weapons and Combat Tracker participation.

It applies -4 or -2 only if this provides positive evidence of a melee threat between an opposed target and a friendly combatant **within 10 feet**. If a relation, reach, geometry or attack target is uncertain, it reports status "manual" and does **not** invent a penalty. For **exactly one selected target**, an optional native Foundry DialogV2 asks for an explicit pre-roll choice (0, −2, −4 or no modification). Multiple targets are never assigned a guessed common penalty. Neutral tokens, complex allegiances, grapple, vertical geometry, special reach dead zones and third-party movement/range rules can require GM adjudication.

If the native attack dialog already specifies a melee penalty or a generic attack-bonus entry, PF1AE leaves native data alone to prevent doubling. A full attack against one explicitly targeted creature receives the common modifier on all its native attacks. If a specific attack needs an approved exception, its correction is applied by attack index. If individual attacks change targets without a verified per-index mapping, the game master should handle those attacks manually. PF1AE does not guess a per-index target.

World settings: **PF1AE: Automatic shooting into melee penalty** (enabled by default, independent of range automation) and **PF1AE: Ask when melee engagement is uncertain** (enabled by default). These prompts require a single selected target; a missing DialogV2 leaves the attack unchanged.

## API

~~~js
const api=game.modules.get("pf1-automation-engine").api.rangedMelee;

api.prepareAttackOverride({
  actionUse,               // exact live PF1 native instance
  attackIndex: 0,          // zero-based
  penalty: 0,
  reason: "my-feat"
});

api.prepareForCurrentUse({
  item: weapon,
  action: attackAction,
  attackIndex: 1,
  penalty: -2,
  reason: "partial-exception"
});

api.cancelPreparedAttackOverride({ actionUse, attackIndex: 0 });

console.log(api.lastDiagnostic());
~~~

Only integers from -20 to 0 are accepted. The engine requires exact native Actor/Item/Action ownership and the locally authorized user. The same index cannot receive two competing overrides. Prepared overrides are tied to the native ActionUse WeakMap and discarded at completion/cancellation or on browser reload. An attempt to override a completed attack is refused.

Priorities: **manual native modifier > exact-index authorized override > general PF1AE rule > explicit manual decision on uncertainty**.

## Complete Precise Shot / Tir de précision Script Call

Place on the **feat Item**.

- Category: **Basculer** (toggle)
- Exact Script Call name: **PF1AE:rangedMelee:override**

This dedicated native Script Call is discovered and invoked **automatically** on the owning attacker's client during pre-roll processing, without item activation or startup macros. The module does not recognize the item's name: this script supplies the feat-specific rule. The ordinary Bootstrap phase is not used because the final native ActionUse attacks exist only after the attack dialog and before the rolls.

~~~js
if (
  typeof rangedMelee !== "undefined" &&
  rangedMelee?.actionUse &&
  rangedMelee.actorUuid === rangedMelee.actionUse.actor?.uuid
) {
  const nativeUse = rangedMelee.actionUse;
  const attacks = nativeUse.shared?.attacks ?? [];

  for (let attackIndex = 0; attackIndex < attacks.length; attackIndex++) {
    if (attacks[attackIndex]?.type === "manyshot") continue;

    rangedMelee.override({
      attackIndex,
      penalty: 0,
      reason: "precise-shot"
    });
  }
}
~~~

The engine invokes this code only on its originating actor and can execute it on the elected GM for a player-owned actor **only after the existing exact Script Call approval check**. The shared engagement penalty can already be present when this Script Call runs; `rangedMelee.override({penalty:0})` automatically neutralizes that specific attack through a matching correction. Trusted Table Mode does not automatically grant this new Script Call any privilege; the setting is never enabled for the user. Code is never transmitted via sockets.

No ammunition, Grit, actor statistics or weapon settings are changed.

## Diagnostics

~~~js
game.modules.get("pf1-automation-engine")?.api?.rangedMelee?.lastDiagnostic()
~~~

Possible results include: engaged, not-engaged, manual, manual-choice, native-manual, unavailable, override-refused. The engine does not flood chat. The existing genericDebug world setting enables additional console traces.

## Foundry live checks

1. Shooter with a ranged weapon, allied equipped melee fighter, hostile target; both combatants in Combat Tracker, explicit known reach and non-neutral token disposition. Target only the enemy; verify labeled **−4 in the native attack formula**.
2. Move the ally to at least 10 ft. Verify no penalty. Test target two/three sizes larger for -2/0.
3. Test adjacent creatures who do not actually threaten each other; neutral disposition; unknown reach: no invented modifier, diagnostic is manual or not-engaged.
4. Test a single shot, full attack, sequential attacks, multiple weapons, and multiple simultaneous actors.
5. Multiple target selection: diagnostic manual, never re-use one guessed penalty for all.
6. Add the Precise Shot Script Call above; verify penalty 0 without consumption of resources. Try -2 partial override and duplicate override.
7. PF1FR: firearm touch/normal AC, Deadeye Grit, double-barrel shooting and reload unchanged. Pistol-Whip (melee) must receive no penalty.
8. Native manually entered penalty must not be doubled.
9. Reconnect/F5, abort attack before roll, confirm no stale override is applied to subsequent uses.
10. With player-owned feat on GM fallback, check unapproved Script Call refused. Approve exact code, test again.
11. Inspect lastDiagnostic() on uncertainty; verify metric (1.5m square) and imperial (5ft square) scenes.

Automated tests validate the isolated ActionUse path; actual Foundry/PF1FR live verification remains necessary. If the native system is unable to associate a reliable target to an individual generated attack, PF1AE declines to infer one.

### v1.33.1 — Vérification du chemin commun

Sur un tir vers une cible engagée, un bonus `-4[PF1AE Shooting into Melee]` doit être présent dans `shared.attackBonus` **dès `pf1CreateActionUse`**, à côté d'un éventuel bonus de portée indépendant. Avec Tir de précision, la formule de chaque attaque peut montrer le −4 commun et un +4 de correction : **leur somme est 0**. Après la résolution, aucun bonus temporaire de mêlée ne doit rester sur l'ActionUse. Un changement de cible ou un bonus manuel tardif doit invalider le −4 préparé.

### v1.33.2 — Taille native PF1 11.11

Les acteurs Pathfinder 1e 11.11 exposent la taille sous la forme `system.traits.size = {base: "med", value: 4}`. Le moteur utilise en priorité la taille **calculée** `value` (y compris sous un effet changeant de taille), et `base` seulement en repli. Les anciens champs de taille sous forme de chaîne restent acceptés. Un champ inconnu continue de produire un diagnostic `manual` plutôt qu'une supposition.

Pour contrôler la taille de la cible sélectionnée :

```js
console.log([...game.user.targets][0]?.actor?.system?.traits?.size)
```

La Harpy de l'exemple utilisateur est `{base:"med", value:4}` et doit désormais être reconnue comme Moyenne. Cette correction ne préjuge pas de l'allonge et de la menace, vérifiées ensuite indépendamment.

### v1.33.3 — Géométrie officielle Foundry 13

La mesure des distances utilise désormais `TokenDocument.getOccupiedGridSpaceOffsets()` et `canvas.grid.getCenterPoint()` avant `canvas.grid.measurePath()`. L'ancien `getOccupiedCells()` n'est pas une méthode standard des tokens Foundry v13 : elle n'est conservée que pour d'éventuelles intégrations compatibles.

Si l'engagement ne peut toujours pas être déterminé, le diagnostic inclut `uncertain`, détaillant la raison pour chaque allié concerné : `grid cells or path unavailable`, `melee threat or reach unknown`, ou `ally size unknown`. La politique d'automatisation reste prudente : aucun −4 n'est inventé si la vérification échoue.

```js
console.dir(game.modules.get("pf1-automation-engine").api.rangedMelee.lastDiagnostic(), {depth: 5})
```

### v1.33.4 — Allonge native PF1 et attaques naturelles

PF1 v11.11 expose l'allonge de mêlée calculée via
`actor.getRollData().range.melee`, plutôt que systématiquement via
`actor.system.attributes.reach`. PF1AE privilégie la valeur calculée,
avec un repli compatible pour d'éventuels anciens champs. Une valeur absente
ne devient **jamais** automatiquement « 1,50 m » : le diagnostic reste
`manual` tant que la menace n'est pas établie.

Les attaques naturelles et les objets natifs de type `attack` utilisés
notamment par les PNJ sont désormais pris en compte dans la recherche de
sources d'attaque de mêlée. Les nouveaux champs `allyHasMeleeAttack`,
`targetHasMeleeAttack`, `allyReachData` et `targetReachData`
permettent de distinguer une arme ou attaque non reconnue d'une allonge
inconnue.

```js
const t=[...game.user.targets][0];
console.log("PF1 computed melee reach",t?.actor?.getRollData?.()?.range);
console.table(game.modules.get("pf1-automation-engine")
  ?.api?.rangedMelee?.lastDiagnostic()?.uncertain??[]);
```

**Validation dans Foundry :** recommencer le tir contre la harpie après
installation v1.33.4. En cas de refus, inspecter les champs détaillés
plutôt que forcer un malus pour des alliés incapables de menacer.

### v1.33.5 — Libellé de malus localisé

Le libellé dans les formules de jet d'attaque utilise la langue du **client Foundry** : `Shooting into melee` en anglais (et par défaut), `Tir dans le tas` en français, y compris `fr-FR`. La même traduction s'applique aux corrections par index de Tir de précision. Les valeurs de malus et leur application ne changent pas.
