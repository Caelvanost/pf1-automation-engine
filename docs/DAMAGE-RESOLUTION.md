# Native damage multiplier and basic damage resolution (1.50.0)

Foundry 13 / PF1 11.11. The manual multiplier in PF1AE replaces only the Roll Bonuses damage multiplier; other Roll Bonuses options remain available. Native ActionUse.createAttackDialog returns the form BEFORE assigning this.formData. Empty, missing and invalid input default to 1; explicit 0 is supported. Input persists within the same dialog even on native refresh. No global last multiplier or shared Action state. Skip-dialog uses default 1. The native rollDamage hook occurs before Strength, enhancement, typed changes and extraParts (including situational bonus and Power Attack); it is no longer used for multiplication. After native generateChatAttacks, PF1AE scales complete evaluated DamageRoll totals with deterministic adjustment terms via native Roll.fromTerms, preserving die results, damage type, critical type. If reconstruction cannot be verified, abort before resources are consumed instead of re-rolling. The whole normal or critical total is rounded down once, with incremental allocation to typed components; critical total includes the normal component. Native minimum damage is normalized before scaling. This multiplier scales existing evaluated damage, not the PF1 rule of rolling extra critical dice. The underwater physical multiplier uses the same path; separate energy components are not halved.

New world setting Automatic damage defenses defaults to false. Enable for testing only with Automate Damage disabled. Direct typed native chat-card applications are resolved through pf1ApplyDamage before the original HP update. The native method remains responsible for temporary HP, nonlethal damage, actual HP and the health engine. No canvas selection lookup, no global pending card. The native Apply Damage dialog already handles many defenses; PF1AE leaves it untouched to avoid double application. Manual reductions/ratios and raw direct HP damage, healing, wounds/vigor remain native. Card full/half selection is validated against typed instances and applied once.

Supported: exact standard damage type per component (slashing, piercing, bludgeoning, acid, cold, electric, fire, sonic, force, untyped); standard immunity; highest ER per energy type per attack; standard energy vulnerability (x1.5 on non-immune damage); highest applicable basic weapon DR, bypassed by exact physical type or known magic. Nonweapon spells/touch damage ignore DR. Same energy damage components are aggregated before resistance. Only a single eligible physical type with DR is automatically processed. Multiple attacks are separate applications. Ambiguous source/mixed types, non-energy vulnerability, combined ER and vulnerability (some effects specify order), custom traits, hardness, material/alignment/complex DR, unverified magic/ammo, unsupported ability types, mismatched totals, mixed lethal/nonlethal: automatic application is cancelled (0 to native applyDamage) and the GM is warned to use the native dialog and adjust manually. No complete Automate Damage replacement yet. No massive damage checks or ability damage migration in this stage. Native dialog currently has its own existing limitations.

Read-only API:
~~~js
const damage = game.modules.get("pf1-automation-engine").api.damageResolution;
const result = damage.preview({
  actor,
  components: [
    {value:14,types:["slashing"]},
    {value:8,types:["fire"]}
  ],
  sourceKind:"weapon", magic:true, ratio:1
});
console.log(result);
console.log(damage.lastDiagnostic(actor));
~~~
Preview returns supported/reason or incoming, total, per-type immunity, resistance, vulnerabilityBonus and damageReduction. No document mutation. The actual hook changes only options.value/ratio/reduction and supplies a diagnostic field. No automatic chat report of "applied" before native HP update completes.

Live tests: multiplier blank/re-render/skip dialog/x2/x0.5 including Strength and situational bonus; critical and mixed typed components; multiple attacks; PF1 Waters underwater and active Roll Bonuses; native full/half chat buttons; two linked/unlinked targets with different defenses; manual dialog; Automate Damage enabled/disabled. Future phases cover advanced bypasses/hardness, ability damage, custom types and migration.
