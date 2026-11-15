# PF1AE — Shooting into Melee v1.33.0

Foundry VTT 13.351, Pathfinder 1e 11.11, and optional PF1 Firearms & Reload.

## Pathfinder rules and limitations

A ranged attack against an enemy in melee with a friendly creature suffers **−4**. The penalty falls to **−2** when the target is two sizes larger than that ally and disappears if three or more sizes larger. It can also be avoided when the target (or the part aimed at) is at least **10 feet** from the nearest friendly creature. In PF1, engaged melee means **enemies where either threatens the other**: mere adjacency does not suffice.

Rules reference: https://pathfinder.d20srd.org/coreRulebook/combat.html

The automation does not identify feats, classes or traits. Cover, concealment, ranged increment penalties, full-attack bonuses, PF1FR's firearms touch AC, Grit and ammunition are independent.

## Native pre-roll point

PF1 11.11 ActionUse.addAttacks loops over shared.attacks. For each attack it calls ChatAttack.addAttack with extraParts containing shared.attackBonus and the **indexed** atk.attackBonus. PF1's pf1PreActionUse hook is called **after** the ChatAttack rolls have been generated, so it is too late.

PF1AE wraps native ActionUse.addAttacks, adds a temporary **per-index** attack bonus on each attack's in-memory object before the roll, and restores its original bonus in finally. It uses pf1CreateActionUse for identity tracking and pf1PostActionUse for cleanup. No document modification or post-roll arithmetic occurs.

## Automatic detection: conservative policy

The engine examines one explicit target from the attacker's native user.targets, scene identity, occupied grid cells and measured distance, PF1 token disposition, actor size, known numeric reach, equipped melee weapons and Combat Tracker participation.

It applies -4 or -2 only if this provides positive evidence of a melee threat between an opposed target and a friendly combatant **within 10 feet**. If a relation, reach, geometry or attack target is uncertain, it reports status "manual" and does **not** invent a penalty. Neutral tokens, complex allegiances, grapple, vertical geometry, special reach dead zones and third-party movement/range rules can require GM adjudication.

If the native attack dialog already specifies a melee penalty or a generic attack-bonus entry, PF1AE leaves native data alone to prevent doubling. A full attack against one explicitly targeted creature can apply the modifier independently to each generated index. If individual attacks change targets without a verified per-index mapping, the game master should handle those attacks manually. PF1AE does not guess a per-index target.

World setting: **PF1AE: Automatic shooting into melee penalty** (enabled by default, independent of range automation).

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
  rangedMelee.actorUuid === actor?.uuid
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

The engine invokes this code only on its originating actor and can execute it on the elected GM for a player-owned actor **only after the existing exact Script Call approval check**. Trusted Table Mode does not automatically grant this new Script Call any privilege; the setting is never enabled for the user. Code is never transmitted via sockets.

No ammunition, Grit, actor statistics or weapon settings are changed.

## Diagnostics

~~~js
game.modules.get("pf1-automation-engine")?.api?.rangedMelee?.lastDiagnostic()
~~~

Possible results include: engaged, not-engaged, manual, native-manual, unavailable, override-refused. The engine does not flood chat. The existing genericDebug world setting enables additional console traces.

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
