# Dynamic Effects — PF1 Automation Engine 1.16.0

Foundry VTT 13 / PF1 11.11. No buff template is required. The engine generates temporary, active, native PF1 Item buffs with **mechanical** ItemChange entries. It reuses the persistent managed-effect group ledger, existing timer services, and all four stacking policies.

## Native ItemChange format

Input `{target, modifier, value}` is strictly converted to native PF1 `system.changes`: `{target, type:modifier, formula:String(value), operator:'add'}`. This is a literal number, not executable script or evaluated custom expression. The engine calls `setActive(true)` where supported; Foundry/PF1 performs its normal data preparation and modifier stacking.

Allowed targets in this version: `ac`, `tac`, `ffac`, `mattack`, `rattack`, `nattack`, `fort`, `ref`, `will`, `str`, `dex`, `con`, `int`, `wis`, `cha`, `landSpeed`, `damage`, `wdamage`. Only targets present in `pf1.config.buffTargets` on the running system are accepted.

Allowed modifiers: `penalty`, `untyped`, `dodge`, `deflection`, `enh`, `morale`, `luck`, `sacred`, `profane`, `insight`, `competence`, `circumstance`, `resist`. Native exclusions are respected. Values must be finite integers in [-100,100]; `penalty` accepts negative or zero and other types positive or zero. Null, arbitrary keys, JS, formulas and unchecked paths are rejected. Other modifiers require separate verification.

## 1. GM approval — no buff template

An elected GM explicitly grants an Item Action permission to apply specific mechanical changes within capped magnitudes:

```javascript
const api=game.modules.get('pf1-automation-engine').api;
await api.effects.approve({
  actor:sourceActor,
  approvalKey:'defense-debuff',
  sourceItemUuid:sourceItem.uuid,
  sourceActionId:saveAction.id,
  channels:['save','direct'],
  allowed:[{target:'ac',modifier:'penalty',maxAbs:6}]
});
```

The grant includes an exact snapshot of the source Item Action. It is reverified before every use; changing the Action requires reapproval. It is stored in the world. Only the elected GM can call `approve` and `revoke({actor,approvalKey})`. `api.effects.listApprovals()` shows current grants.

## 2. Direct effects

```javascript
const wisdomMod=Number(actor.system.abilities.wis.mod);
if(!Number.isSafeInteger(wisdomMod))throw Error('Invalid Wisdom modifier');
const penalty=-Math.max(0,wisdomMod);
await api.effects.apply({
  actor,
  sourceItemUuid:item.uuid,
  sourceActionId:action.id,
  approvalKey:'defense-debuff',
  sourceMessageId:nativeActionCard.id, // required when invoked by a player
  targets:[targetActor],
  effect:{
    name:'Défenses affaiblies',img:item.img,
    changes:[{target:'ac',modifier:'penalty',value:penalty}],
    duration:{seconds:60,expire:'elapsed'},
    stacking:{mode:'replace',key:'shared-defense-penalty'}
  }
});
```

Direct requests are executed on the elected GM. A non-GM requires Actor OWNER permission, the prior GM grant, and an existing native chat card identifying the exact Item and Action. The service does NOT determine whether an attack hit or damage occurred: use the verified attack/save workflow when appropriate. `requestId` is an optional idempotency token; if omitted, the API generates one.

## 3. After a native save failure

```javascript
await api.saveOutcomes.register({
  actor,key:'defense-save',groupKey:'defense-save',
  sourceItemUuid:item.uuid,sourceActionId:saveAction.id,
  targets:[targetActor.uuid],
  onFailure:{
    type:'dynamicEffect',approvalKey:'defense-debuff',
    name:'Défenses affaiblies',img:item.img,
    changes:[{target:'ac',modifier:'penalty',value:-4}],
    duration:{seconds:60,expire:'elapsed'},
    stacking:{mode:'replace',key:'shared-defense-penalty'}
  }
});
```

`saveOutcomes` validates the grant at registration, validates the ItemAction again at execution, and handles only verified native PF1 saves with exact source Item/Action/DC/target context. `saveOverrides` still supplies the final `effectiveTotal`. Existing `linkedBuff` and `templateEffect` outcomes are unchanged.

## 4. Duration and stacking

`{seconds:60,expire:'elapsed'}`, `{rounds:10,expire:'elapsed'}`, `{rounds:1,expire:'sourceTurnStart'}` or `sourceTurnEnd`. The elapsed clock is Foundry world time; rounds are six seconds outside combat. Timers survive F5/reconnect via the existing persistent registry.

Modes are `stack` (new copy), `replace` (replace tracked copy), `refresh` (same mechanics and expiration category; timer reset), `ignore` (preserve prior). Keys are shared across sources for the same target UUID. Only managed, flagged copies are eligible for removal. Permanent and unrelated buffs are unaffected. Actor UUIDs are never substituted: synthetic `Scene.Token.Actor` IDs are preserved.

## 5. In-Foundry acceptance tests

1. On a test Actor with CA 16 and no competing modifiers, approve and create an `ac/penalty/-4` buff; verify the *calculated* CA becomes 12.
2. Advance 60 seconds of **world time**, check the buff is deleted and CA returns to 16; repeat with F5/reconnection before expiry.
3. Test an unlinked token independently of its world base Actor.
4. Exercise `stack`, `replace`, `refresh`, `ignore` including two sources sharing a stacking key and double-clicks.
5. On a real native saving throw card, test failure (mechanical buff), success (none), unrelated manual save (none), and a modified or unapproved Action (rejected).
6. Test zero, positive and negative values, `Infinity`, `NaN`, invalid target paths, noninteger and >100 magnitudes.
7. Verify Stunning Fist, Fascination, Countersong, Distraction, `attackOutcomes`, `templateEffect`, and existing expiry pipelines remain unaffected.

The automated tests use a mocked Foundry/PF1 runtime and cannot prove the real PF1 11.11 sheet recalculates until these in-world checks are performed.

## Security limitation

The core Foundry `game.socket` callback does not cryptographically authenticate the remote `userId` payload. GM allowlists, source-action snapshots, ownership checks and native source-card checks narrow possible behavior but are **not a complete protection against a deliberately modified hostile client**. For adversarial clients, restrict direct effects to GM or add a server-authenticated transport. Do not treat player-supplied socket fields as sufficient proof of identity.
