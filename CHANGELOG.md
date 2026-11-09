## v1.15.0 — Native mechanical template effects after a PF1 saving throw

- Add `saveOutcomes.onFailure.type='templateEffect'` for approved mechanical PF1 Item Buff and ActiveEffect models.
- Require fingerprint-based GM approval on registration and application; retain strict source Actor/ItemAction provenance and target Actor UUIDs.
- Reuse existing `effectGroups` storage, PF1 buff activation/deactivation, persistent duration and turn-boundary expiration.
- Support `stack`, `replace`, `refresh`, `ignore` and deduplication by save message/outcome, including multiple sources sharing a stacking key on one target.
- Reject arbitrary `parameters` in this first version; fixed-value approved mechanics only.
- Preserve all `linkedBuff` paths including Fascination and timed Stunning Fist, SaveBridge, countersong, distraction and Attack Outcomes.
- Add simulated regression coverage; real Foundry 13/PF1 11.11 validation is still required.

## v1.14.4 — PF1 synthetic Actor HP offset confirmation

- Recognize both nested and flattened updates to `system.attributes.hp.value` and `system.attributes.hp.offset`.
- Confirm native `options.pf1.deltas.hp.offset` and `_nasPrevHp` against effective Actor HP before/after, never equating a negative offset alone with applied damage.
- Preserve exact native attack card/ItemAction/index/target identity, including unlinked Scene.Token.Actor UUIDs; no changes to public API, multiclick deduplication or GM authority.
- Regression: 11 effective HP -> 6 HP with offset -5 triggers exactly one follow-up; no effective HP loss triggers none.
- No changes to Fascination, saveOutcomes, timers or character Item Script Calls. Live PF1 11.11 validation remains necessary.

## v1.14.3 — Direct native attack damage bridge

- Preserve exact native Action-card provenance when damage options arrive outside tracked `ApplyDamage._onApply`.
- Correlate native target-options and pre-apply hooks with a real actor update, tolerating cloned options only for a unique, recent candidate.
- Reject wrong attack index, ambiguous actor updates, stale options and no proven HP/nonlethal damage; no changes to the `ActorPF.applyDamage` accessor.
- Keep `saveOutcomes`, Fascination, bard automations, source-specific duration and elected-GM deduplication intact.
- Add direct-damage regression coverage; live PF1 11.11 validation remains essential.

## v1.14.2 — README refresh and removal of standalone example scripts

- Rewrite the README around the current public APIs, installation, debugging, permissions and compatibility requirements.
- Remove the standalone `scripts-exemples/coup-etourdissant-utilisation.js` script from the repository.
- Replace the deleted script link in `docs/ATTACK-OUTCOMES.md` with Item Script Call integration guidance.
- No runtime JavaScript, Foundry hooks, save resolution or automation behavior changed.

## v1.14.1 — Non-configurable ActorPF accessor damage bridge

- Never assign to or redefine the non-configurable `ActorPF.prototype.applyDamage` accessor (getter and setter remain native).
- Observe the native PF1 ApplyDamage dialogue's completion, corroborate the per-target and pre-apply hooks, then inspect actual damage.
- Fail closed for missing provenance, ambiguous target operations, cancelled dialogs and fully absorbed damage.
- Preserve saveOutcomes, Fascination, Countersong, Distraction, temporary conditions and source-specific deduplication.
- Test the non-configurable getter/setter and refuse to invoke its setter; live PF1 11.11 acceptance remains necessary.

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