# Silent EffectGroup requests — v1.12.6

**Target:** Foundry VTT 13.351, PF1 11.11.

The elected GM validates and mutates documents without showing any interactive confirmation. The PF1 Item Script Call chooses the legal targets under Pathfinder 1 rules (allied creatures, range, hearing, line of sight etc.). The engine **does not** infer allies or validate spell-specific target legality: the caller supplies the Actor UUIDs.

## Public API — unchanged names

~~~js
const api = game.modules.get('pf1-automation-engine').api;
const templateUuid = 'Compendium.pf1.buffs.Item.3p34GJemfcLdKckV';

// Explicit approval is optional for safe, declarative templates. It is silent:
await api.effectGroups.approveTemplate(templateUuid);

// The promise resolves AFTER the elected GM completes the mutation.
const applied = await api.effectGroups.applyGroup({
  actor: bard, key:'inspire-courage', templateUuid,
  targets: [bard, ally1, ally2], duration:{value:1,unit:'minutes'}
});
// applied: {applied:true,groupId,targetCount,timerId}

await api.effectGroups.extendGroup({actor:bard,key:'inspire-courage',rounds:1});
await api.effectGroups.stopGroup({actor:bard,key:'inspire-courage'});
~~~

An approval call with a template UUID accepts actor-owned PF1 buff Items and ActiveEffects by inferring the template's parent Actor and requiring that the requester has OWNER permission.

For a Compendium buff, the legacy string-only approval performs a *read-only preflight* on a passive template, since there is no source Actor to authenticate. Actual authorization happens on applyGroup, which checks that the requester owns the source Actor, resolves the template, verifies its contents and authorizes it on the GM. To authorize immediately, supply approveTemplate({actor:bard,templateUuid}). This addition does not change the required calls in existing bardic Script Calls.

**Security:** a player cannot automatically authorize a template with executable PF1 Script Calls, macro execution changes or untrusted module flags. The elected GM rejects such requests silently with a logged error rather than giving players authority to run code on actors they do not own. Previously GM-trusted scripted templates remain usable while their content fingerprint is unchanged. A GM can deliberately approve an advanced scripted template through the API as a configuration action; there is no gameplay confirmation window.

## Permissions and target scope

- The elected GM is the only client that mutates other Actors or the persistent world group registry.
- Players must own the **source Actor**, not every target. All remote approve/apply/extend/stop actions are verified on the elected GM.
- A player cannot stop groups belonging to another Actor or use an embedded template from an unowned Actor.
- applyGroup accepts 1–30 target Actor UUIDs, all independently resolved by the GM. Rule-specific validation — ally/enemy, range, hearing, sight and other Pathfinder restrictions — remains the calling Item Script's responsibility.
- When saveOutcomes resolves a verified failed native saving throw, the elected GM already creates the source-specific linked effect directly. No dialog, approval or second socket route is needed for that service.

## Duplicate clicks and acknowledgements

Every remote operation contains a random requestId; only the leader processes it, and returns an ack with the final result or error to the specific requester. Duplicate request IDs are ignored. Distinct but otherwise identical applyGroup requests received within one second in the same combat state reuse the still-active group rather than duplicating its buffs. Future reapplications preserve the normal group-key replacement behavior.

## Debugging

Enable **Generic automation debug logs** in the module settings. Examples:

~~~text
[PF1AE][EffectGroup] Remote request {operation: 'apply', ...}
[PF1AE][EffectGroup] Source OWNER PASS {requester: ..., source: ...}
[PF1AE][EffectGroup] Auto-approved {templateUuid: ..., source: ...}
[PF1AE][EffectGroup] Applied to 3 targets {...}
[PF1AE][SaveOutcome] Applying linked buff automatically {...}
[PF1AE][SaveOutcome] Linked effect created {...}
~~~

## Live multiplayer acceptance checklist

1. Player 1 owns the bard, Player 2 owns one ally, the GM owns another. Activate Inspiration vaillante; all *rule-eligible* allies should receive their buffs without any confirmation window.
2. Maintain the performance, extend the same group, then stop it. All copies must be removed and requests must return acknowledged success.
3. Trigger Fascination from the bard, then fail a native PF1 Will save on a GM-controlled enemy. The source-specific Fasciné effect should appear automatically and disappear when fascinate stops.
4. Confirm an unowned source Actor and untrusted executable template are rejected, without applying anything.
5. Verify Countersong, Distraction and Inspiration talentueuse; especially ensure save overrides use the final effective result.

The bundled Node tests use simulated Foundry document/socket APIs. Real PF1 v13 live-world and Nevela compatibility testing is still required.
