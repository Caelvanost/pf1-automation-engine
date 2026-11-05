/**
 * PF1 Automation Engine — generic, GM-approved, multi-target effects (v1.7.0).
 * A source actor may copy an approved ActiveEffect, actor-owned PF1 Item buff,
 * or GM-approved PF1 buff from a Compendium to allies.
 * The elected GM owns the world ledger and a single turn-phase expiration.
 * No character class, spell or feat rules live here.
 */
const EFFECT_NS = 'pf1-automation-engine';
const EFFECT_SOCKET = `module.${EFFECT_NS}`;
const EFFECT_CHANNEL = 'pf1ae-effect-groups-v1';
const GROUPS_SETTING = 'managedEffectGroups';
const TEMPLATES_SETTING = 'effectTemplateApprovals';
const EFFECT_MAX_TARGETS = 30;
const effectSeenRequests = new Set();
const effectPendingRequests = new Map();
const effectRecentApplications = new Map();
const EFFECT_REQUEST_TIMEOUT = 15000;
let effectMutationTail = Promise.resolve();

function effectQueue(fn) {
  const next = effectMutationTail.catch(() => {}).then(fn);
  effectMutationTail = next.catch(() => {});
  return next;
}
function effectPrimaryGM() {
  return [...game.users].filter(u => u.active && u.isGM)
    .sort((a,b) => a.id.localeCompare(b.id))[0] ?? null;
}
function effectIsLeader() { return effectPrimaryGM()?.id === game.user.id; }
function effectRequireLeader() {
  if (!game.user.isGM || !effectIsLeader()) throw Error('Opération réservée au MJ responsable.');
}
function effectEnabled() {
  return !!game.modules.get(EFFECT_NS)?.active &&
    !game.modules.get('pf1-combat-automation')?.active &&
    game.settings.get(EFFECT_NS, 'genericEnabled');
}
function effectGroups() { return game.settings.get(EFFECT_NS, GROUPS_SETTING) ?? {}; }
function effectApprovals() { return game.settings.get(EFFECT_NS, TEMPLATES_SETTING) ?? {}; }
function isEffectTemplate(doc) {
  return doc?.documentName === 'ActiveEffect' ||
    (doc?.documentName === 'Item' && doc.type === 'buff');
}
/** Only top-level Compendium Item documents may be shared between source actors. */
function effectTemplateKind(template) {
  if (!template?.uuid || typeof template.toObject !== 'function') return null;
  if (template.documentName === 'ActiveEffect' && template.parent?.documentName === 'Actor') {
    return 'activeEffect';
  }
  if (template.documentName !== 'Item' || template.type !== 'buff') return null;
  if (template.parent?.documentName === 'Actor') return 'actorBuff';
  // fromUuid() must resolve the actual pack document. An embedded or world
  // Item with a misleading .pack value or name is not a Compendium template.
  if (/^Compendium\.[^.]+\.[^.]+\.Item\.[^.]+$/.test(template.uuid)) {
    return 'compendiumBuff';
  }
  return null;
}
function effectDebug(event, details={}) {
  if (game.settings.get(EFFECT_NS,'genericDebug')) {
    console.debug(`[PF1AE][EffectGroup] ${event}`, details);
  }
}
const EFFECT_VOLATILE_ROOT_KEYS = new Set([
  '_id','_stats','ownership','folder','sort','pack'
]);
/**
 * Exact, canonical content fingerprint. Unlike a truncated hash, the full
 * comparison cannot silently accept collisions. Includes all Item/AE fields
 * except volatile top-level document identity/ownership/sorting metadata.
 * Script Calls inside .system and embedded effects remain fully covered.
 */
function effectCanonical(value) {
  if (Array.isArray(value)) return value.map(effectCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort()
        .filter(k=>value[k] !== undefined)
        .map(k=>[k,effectCanonical(value[k])])
    );
  }
  return value;
}
function effectRelevantData(template) {
  const raw=template.toObject();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw Error('Modèle invalide : toObject() ne renvoie pas des données Item/ActiveEffect.');
  }
  return effectCanonical(Object.fromEntries(
    Object.entries(raw).filter(([key])=>!EFFECT_VOLATILE_ROOT_KEYS.has(key))
  ));
}
/** FNV-1a 64-bit: compact diagnostic hash; exact fingerprint is authoritative. */
function effectContentHash(fingerprint) {
  let hash=0xcbf29ce484222325n;
  const mask=0xffffffffffffffffn;
  for (let i=0;i<fingerprint.length;i++) {
    hash=((hash ^ BigInt(fingerprint.charCodeAt(i))) * 0x100000001b3n) & mask;
  }
  return 'fnv1a64:' + hash.toString(16).padStart(16,'0');
}
function effectApprovalRecord(template, kind) {
  const fingerprint=JSON.stringify(effectRelevantData(template));
  return {
    uuid:template.uuid,
    templateType:kind,
    hash:effectContentHash(fingerprint),
    hashAlgorithm:'fnv1a64-v1;exact-canonical-json',
    fingerprint
  };
}
function effectTemplateCopy(template, kind) {
  const copy=foundry.utils.deepClone(template.toObject());
  delete copy._id; // Current behavior for actor-owned Items and ActiveEffects.
  if (kind === 'compendiumBuff') {
    // Pack provenance and world-document metadata must not be transferred.
    // Keep PF1 scriptCalls/actions IDs: other PF1 data may refer to them.
    for (const key of EFFECT_VOLATILE_ROOT_KEYS) delete copy[key];
    if (Array.isArray(copy.effects)) {
      // Nested ActiveEffects are newly embedded in a newly embedded Item.
      for (const effect of copy.effects) if (effect && typeof effect === 'object') delete effect._id;
    }
    copy.flags ??= {};
    if (copy.flags.core && typeof copy.flags.core === 'object') {
      delete copy.flags.core.sourceId;
    }
  }
  return copy;
}
async function effectResolveTemplate(uuid) {
  if (typeof uuid !== 'string' || !uuid || uuid.length>400) return null;
  try { return await fromUuid(uuid); }
  catch(error) {
    effectDebug('template-rejected',{uuid,reason:'fromUuid failed',error:error?.message});
    return null;
  }
}
function effectValidKey(key) {
  return typeof key === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(key);
}
function effectUuid(doc) { return typeof doc === 'string' ? doc : doc?.uuid; }
function effectActor(doc) {
  return doc?.documentName === 'Actor' ? doc : doc?.actor ??
    (doc?.parent?.documentName === 'Actor' ? doc.parent : null);
}
async function effectResolveActor(uuid) {
  if (typeof uuid !== 'string' || uuid.length > 400) return null;
  const doc = await fromUuid(uuid);
  return effectActor(doc);
}
function effectFingerprint(template) {
  // Legacy v1.9.x record: exact content of actor-owned template.
  return JSON.stringify({uuid:template.uuid,content:template.toObject()});
}
function effectOwnedBy(template, actor) {
  const kind=effectTemplateKind(template);
  return kind === 'compendiumBuff' || (
    (kind === 'actorBuff' || kind === 'activeEffect') &&
    template.parent?.uuid === actor.uuid
  );
}
/** Auto-validation is not unrestricted authority to execute player-authored scripts
 * on other Actors. A template that was not previously trusted by a GM must
 * be declarative (no Script Calls, executable ActiveEffect changes or macros).
 */
function effectHasExecutablePayload(template) {
  const raw=template.toObject();
  const populated=value=>Array.isArray(value) ? value.length>0 :
    !!(value && typeof value==='object' && Object.keys(value).length);
  if (populated(raw.system?.scriptCalls)) return true;
  if ((raw.effects??[]).some(e=>(e.changes??[]).some(c=>
    /(?:macro|script|command|execute)/i.test(String(c.key??''))))) return true;
  if ((raw.changes??[]).some(c=>
    /(?:macro|script|command|execute)/i.test(String(c.key??'')))) return true;
  if (Object.entries(raw.flags??{}).some(([key,value])=>
    !['core','pf1',EFFECT_NS].includes(key) && populated(value))) return true;
  return false;
}
async function effectAutoApprove(template, source, requester, explicitGM=false) {
  const kind=effectTemplateKind(template);
  if (!kind || !effectOwnedBy(template,source)) throw Error('Template/source association rejected.');
  const existing=effectApprovals()[template.uuid];
  if (existing) {
    try { effectCheckApproval(template); return template.uuid; }
    catch(error) {
      effectDebug('Existing template fingerprint changed',{uuid:template.uuid,reason:error.message});
    }
  }
  if (!explicitGM && effectHasExecutablePayload(template)) {
    effectDebug('Auto-approval REFUSED: executable template',{uuid:template.uuid,
      requester:requester?.id,source:source.uuid});
    throw Error('Automatic template approval rejected: executable scripts or macros require a pre-trusted template.');
  }
  const record=effectApprovalRecord(template,kind);
  await game.settings.set(EFFECT_NS,TEMPLATES_SETTING,{
    ...effectApprovals(),[template.uuid]:record});
  effectDebug('Auto-approved',{templateUuid:template.uuid,kind,source:source.uuid,
    requester:requester?.id});
  return template.uuid;
}
/** GM-only explicit trust remains available for advanced scripted templates.
 * Players may request a silent, strictly validated approval for passive ones.
 * A compendium template requires {actor,templateUuid} for owner verification.
 */
async function effectApproveInternal(data, requester, socketOrigin=false) {
  if (!effectEnabled() || !effectIsLeader()) throw Error('Elected GM required.');
  const uuid=effectUuid(data.templateUuid);
  const template=await effectResolveTemplate(uuid);
  const kind=effectTemplateKind(template);
  if (!kind) throw Error('Only actor-owned buffs/ActiveEffects or Compendium buffs are supported.');
  const directGM=!socketOrigin && requester?.isGM && effectIsLeader();
  const source=await effectResolveActor(data.sourceUuid??template.parent?.uuid);
  // A legacy call approveTemplate(compendiumUuid) has no source identity.
  // Perform a safe read-only preflight now; actual persisted authorization
  // happens at applyGroup when the GM can verify the source Actor OWNER.
  if (!directGM && !source && kind==='compendiumBuff' && !data.sourceUuid) {
    if (effectHasExecutablePayload(template))
      throw Error('Untrusted scripted Compendium template cannot be silently approved.');
    effectDebug('Compendium preflight passed; source OWNER checked on applyGroup',
      {templateUuid:template.uuid,requester:requester.id});
    return template.uuid;
  }
  if (!directGM && (!source || !source.testUserPermission?.(requester,'OWNER'))) {
    throw Error('Source Actor OWNER permission required for automatic approval.');
  }
  effectDebug('Source OWNER PASS',{requester:requester.id,source:source?.uuid});
  if (!directGM && !effectOwnedBy(template,source)) {
    throw Error('Template does not belong to the source (except shared Compendium buffs).');
  }
  // GM may intentionally approve a shared Compendium without a source Actor.
  if (directGM && !source) {
    const record=effectApprovalRecord(template,kind);
    await game.settings.set(EFFECT_NS,TEMPLATES_SETTING,{
      ...effectApprovals(),[template.uuid]:record});
    effectDebug('Auto-approved',{templateUuid:template.uuid,requester:requester.id,gm:true});
    return template.uuid;
  }
  return effectAutoApprove(template,source,requester,directGM);
}
function effectApproveTemplate(templateOrData) {
  const data=typeof templateOrData==='string' || templateOrData?.uuid
    ? {templateUuid:effectUuid(templateOrData)}
    : {templateUuid:effectUuid(templateOrData?.templateUuid??templateOrData?.template),
       sourceUuid:effectUuid(templateOrData?.actor??templateOrData?.source)};
  if (!data.templateUuid) throw Error('Template UUID required.');
  if (effectIsLeader()) return effectApproveInternal(data,game.user,false);
  return effectSendRemote('approve',data);
}
async function effectRevokeTemplate(templateUuid) {
  effectRequireLeader();
  const id=effectUuid(templateUuid);
  const approvals={...effectApprovals()};
  delete approvals[id];
  await game.settings.set(EFFECT_NS,TEMPLATES_SETTING,approvals);
}
function effectCheckApproval(template) {
  const approved=effectApprovals()[template.uuid];
  const kind=effectTemplateKind(template);
  if (!kind) {
    effectDebug('template-rejected',{uuid:template?.uuid,reason:'invalid template kind'});
    throw Error('Modèle refusé : type incompatible (buff PF1 ou ActiveEffect d’acteur requis).');
  }
  if (!approved) {
    effectDebug('template-rejected',{uuid:template.uuid,kind,reason:'not approved'});
    throw Error(`Modèle ${template.name} non approuvé par le MJ.`);
  }
  // Old actor-owned approvals are preserved without a world-setting migration.
  if (typeof approved === 'string') {
    if (kind !== 'compendiumBuff' && approved === effectFingerprint(template)) {
      effectDebug('template-legacy-approved',{uuid:template.uuid,kind});
      return;
    }
  } else if (approved && typeof approved === 'object') {
    const actual=effectApprovalRecord(template,kind);
    if (approved.uuid === actual.uuid &&
        approved.templateType === actual.templateType &&
        approved.hash === actual.hash &&
        approved.fingerprint === actual.fingerprint) {
      effectDebug('template-verified',{uuid:template.uuid,kind,hash:actual.hash});
      return;
    }
    effectDebug('template-modified',{uuid:template.uuid,kind,
      approvedHash:approved.hash,currentHash:actual.hash});
    throw Error(`Modèle ${template.name} modifié depuis son approbation MJ : nouvelle approbation requise.`);
  }
  effectDebug('template-modified',{uuid:template.uuid,kind,reason:'legacy approval mismatch'});
  throw Error(`Modèle ${template.name} non approuvé ou modifié depuis son approbation MJ.`);
}
function effectFindCombatant(actor, combat, combatantId) {
  if (!combat?.started) throw Error('Un combat démarré est nécessaire.');
  if (combatantId) {
    const entry=combat.combatants.get(combatantId);
    if (entry?.actor?.uuid !== actor.uuid) throw Error('Le combattant ne correspond pas à l’acteur source.');
    return entry;
  }
  const matches=[...combat.combatants.values()].filter(c=>c.actor?.uuid === actor.uuid);
  if (matches.length !== 1) throw Error('Le lanceur doit avoir exactement un combattant identifiable (renseigner combatantId).');
  return matches[0];
}
function effectIsAllowedTarget(requester, actor, source, scene) {
  if (actor.uuid === source.uuid) return true;
  if (actor.testUserPermission?.(requester,'OWNER')) return true;
  // For player-originating requests, only allied tokens in the active combat scene.
  // The GM approval gate remains mandatory for every source template.
  const friendly=globalThis.CONST?.TOKEN_DISPOSITIONS?.FRIENDLY ?? 1;
  return [...(scene?.tokens ?? [])].some(token =>
    token.actor?.uuid === actor.uuid && Number(token.disposition) === friendly);
}
async function effectValidateRequest(data, requester, socketOrigin) {
  if (!effectEnabled() || !effectIsLeader()) throw Error('Le moteur ou le MJ responsable est indisponible.');
  if (!data || !effectValidKey(data.key)) throw Error('Clé d’effet invalide (lettres, chiffres, _ et -).');
  const source=await effectResolveActor(data.sourceUuid);
  if (!source) throw Error('Acteur source introuvable.');
  // Never grant elevated GM privileges based on userId from an untrusted socket payload.
  const isDirectGM = !socketOrigin && requester?.isGM && effectIsLeader();
  if (!isDirectGM && !source.testUserPermission?.(requester,'OWNER')) {
    throw Error('Le demandeur ne possède pas le personnage source.');
  }
  effectDebug('Source OWNER PASS',{requester:requester?.id,source:source.uuid});
  const combat=data.combatId ? game.combats.get(data.combatId) : game.combat;
  const durationMode=data.duration != null;
  let combatant=null, timing=null, occurrences=null;
  if (durationMode) {
    if (data.timing != null) throw Error('Choisir duration OU timing, pas les deux.');
    const scale={seconds:1,rounds:6,minutes:60,hours:3600};
    const duration=data.duration;
    if (!duration || typeof duration!=='object' || Array.isArray(duration) ||
        !Object.hasOwn(scale,duration.unit) || !Number.isSafeInteger(duration.value) ||
        duration.value<1 || duration.value*scale[duration.unit]>31536000) {
      throw Error('Durée invalide : value positif et unit seconds|rounds|minutes|hours.');
    }
    if (!game.modules.get(EFFECT_NS)?.api?.duration) throw Error('API de durée v1.8.0 indisponible.');
  } else {
    combatant=effectFindCombatant(source,combat,data.combatantId);
    timing=data.timing ?? 'endOfCurrentTurn';
    if (!['endOfCurrentTurn','startOfNextTurn','endOfNextTurn','turnStart','turnEnd'].includes(timing)) {
      throw Error(`Moment d’expiration invalide : ${timing}`);
    }
    occurrences=data.occurrences ?? 1;
    if (!Number.isInteger(occurrences) || occurrences < 1 || occurrences > 10000) {
      throw Error('Occurrences invalides (1–10000).');
    }
    if (timing === 'endOfCurrentTurn' && combat.combatant?.id !== combatant.id) {
      throw Error('L’expiration en fin du tour actuel exige que ce soit le tour du lanceur.');
    }
  }
  const template=await effectResolveTemplate(data.templateUuid);
  if (!template) {
    effectDebug('template-rejected',{uuid:data.templateUuid,reason:'UUID not resolvable'});
    throw Error('Modèle introuvable : UUID invalide ou document supprimé.');
  }
  const templateKind=effectTemplateKind(template);
  if (!templateKind) {
    effectDebug('template-rejected',{uuid:data.templateUuid,reason:'non-buff or unsupported document'});
    throw Error('Modèle refusé : utiliser un buff PF1 (Actor ou Compendium) ou un ActiveEffect d’acteur.');
  }
  if (!effectOwnedBy(template,source)) {
    effectDebug('template-rejected',{uuid:data.templateUuid,kind:templateKind,reason:'other actor owner'});
    throw Error('Le modèle embarqué doit appartenir à l’acteur source (les buffs de Compendium sont partagés).');
  }
  // The elected GM validates and silently authorizes declarative templates.
  // Scripts/macros remain restricted to templates already explicitly trusted.
  await effectAutoApprove(template,source,requester,isDirectGM);
  // Snapshot once after approval, before any asynchronous removal or clone.
  // This avoids applying a mutated template to later targets in the same group.
  const templateData=effectTemplateCopy(template,templateKind);
  effectDebug('template-resolved',{uuid:template.uuid,kind:templateKind,sourceUuid:source.uuid});
  if (!Array.isArray(data.targetUuids) || !data.targetUuids.length || data.targetUuids.length>EFFECT_MAX_TARGETS) {
    throw Error(`Le nombre de bénéficiaires doit être compris entre 1 et ${EFFECT_MAX_TARGETS}.`);
  }
  const unique=[...new Set(data.targetUuids)];
  const targets=[];
  const scene=combat ? (typeof combat.scene === 'string' ? game.scenes?.get(combat.scene) :
    (combat.scene ?? game.scenes?.get(combat.sceneId) ?? game.scenes?.active ?? canvas.scene)) :
    (game.scenes?.active ?? canvas.scene);
  for (const uuid of unique) {
    const actor=await effectResolveActor(uuid);
    if (!actor) throw Error(`Bénéficiaire introuvable : ${uuid}`);
    // A player's permission is checked on the SOURCE only. The elected GM
    // executes target mutations, including other players' and GM-owned Actors.
    // Rule-specific range/hearing/sight decisions remain in the PF1 Item script.
    targets.push(actor);
  }
  return {source,template,templateKind,templateData,targets,combat,combatant,timing,occurrences,
    duration:durationMode ? {value:data.duration.value,unit:data.duration.unit} : null};
}
function effectDocumentFor(actor,copy) {
  if (copy.documentType === 'Item') return actor.items?.get(copy.documentId);
  if (copy.documentType === 'ActiveEffect') return actor.effects?.get(copy.documentId);
  return null;
}
async function effectDeleteCopies(copies, groupId) {
  const pending=[];
  for (const copy of copies) {
    const actor=await effectResolveActor(copy.actorUuid);
    if (!actor) {pending.push(copy);continue;}
    const doc=effectDocumentFor(actor,copy);
    if (!doc) continue; // It was removed independently; not a reason to fail cleanup.
    if (doc.getFlag?.(EFFECT_NS,'effectGroupId') !== groupId) {
      console.warn(`${EFFECT_NS} | Effet non reconnu, conservation`,doc.uuid);
      continue; // Never delete an unmarked or user-replaced object.
    }
    try {
      // A native PF1 buff may run important toggle-off scripts. Always turn it
      // off with the system's own API BEFORE removing the temporary Item.
      if (copy.documentType === 'Item' && (doc.activeState === true || doc.system?.active === true)) {
        if (typeof doc.setActive === 'function') {
          await doc.setActive(false,{[EFFECT_NS]:{skip:true}});
        } else {
          await doc.update({'system.active':false},{[EFFECT_NS]:{skip:true}});
        }
      }
      await doc.delete({[EFFECT_NS]:{skip:true}});
    } catch(error) {
      console.error(`${EFFECT_NS} | Suppression temporaire impossible : ${doc.uuid}`,error);
      pending.push(copy);
    }
  }
  return pending;
}
async function effectExpireGroupInternal(groupId, fromTimer=false, preserveSaveOverrides=false) {
  const ledger=effectGroups();
  const session=ledger[groupId];
  if (!session) return false;
  const pending=await effectDeleteCopies(session.copies ?? [],groupId);
  const next={...effectGroups()};
  if (pending.length) next[groupId]={...session,copies:pending,pendingCleanup:true};
  else delete next[groupId];
  await game.settings.set(EFFECT_NS,GROUPS_SETTING,next);
  // A rule tied to this group must stop influencing saves as soon as its
  // managed copies expire or are stopped. The registry is also checked
  // dynamically, so a cleanup failure never makes an orphan rule effective.
  if (!preserveSaveOverrides) {
    try {
      await game.modules.get(EFFECT_NS)?.api?.saveOverrides?._onGroupRemoved?.(
        session.sourceUuid,session.key);
      await game.modules.get(EFFECT_NS)?.api?.saveOutcomes?._onGroupRemoved?.(
        session.sourceUuid,session.key);
    } catch(error) {
      console.warn(EFFECT_NS + ' | Save override cleanup deferred',error);
    }
  }
  if (!fromTimer) {
    // Do not hold the group write queue while awaiting the timer write queue:
    // a concurrent due timer may be waiting on this group queue.
    const api=game.modules.get(EFFECT_NS).api;
    const timerService=session.duration ? api.duration : api.generic;
    void timerService.cancelTimer(session.timerId)
      .catch(error=>console.error(`${EFFECT_NS} | Annulation du minuteur échouée`,error));
  }
  if (pending.length) throw Error(`Nettoyage incomplet : ${pending.length} objet(s) temporairement indisponible(s).`);
  return true;
}
async function effectExpireGroup(groupId,opts={}) {
  effectRequireLeader();
  if (typeof groupId !== 'string' || groupId.length > 100) throw Error('Groupe invalide.');
  return effectQueue(()=>effectExpireGroupInternal(groupId,opts.fromTimer === true));
}
async function effectCanExpireGroup(groupId) {
  const session=effectGroups()[groupId];
  if (!session) return true; // Timer orphaned after cleanup: consume it safely.
  for (const copy of session.copies ?? []) {
    if (!await effectResolveActor(copy.actorUuid)) return false;
  }
  return true;
}
function effectValidateDurationGroupTimer(groupId) {
  effectRequireLeader();
  const group=effectGroups()[groupId];
  if (!group?.duration) throw Error('Groupe de durée non enregistré.');
  return true;
}
function effectValidateGroupTimer(groupId,combatId,combatantId) {
  effectRequireLeader();
  const group=effectGroups()[groupId];
  if (!group) throw Error(`Groupe d’effets non enregistré : ${groupId}`);
  if (group.combatId !== combatId || group.combatantId !== combatantId) {
    throw Error('Le groupe ne correspond pas au combat/combattant indiqué.');
  }
  return true;
}
async function effectStopByKeyInternal(sourceUuid,key,preserveSaveOverrides=false) {
  const entries=Object.values(effectGroups()).filter(g=>g.sourceUuid===sourceUuid && g.key===key);
  let count=0;
  for (const group of entries) {
    await effectExpireGroupInternal(group.id,false,preserveSaveOverrides);
    count++;
  }
  return count;
}
async function effectApplyInternal(data,requester,socketOrigin=false) {
  const ctx=await effectValidateRequest(data,requester,socketOrigin);
  // Serialize all world-ledger writes and template clones on the elected GM.
  // Reapplying the SAME source/group key is a replacement, not a true stop.
  // Keep its save-overrides registration across the replacement. A failed
  // application still leaves the rule inert until a valid group exists.
  await effectStopByKeyInternal(ctx.source.uuid,data.key,true);
  const id=foundry.utils.randomID();
  const timerId=`${ctx.duration?'duration-group':'effect-group'}:${id}`;
  const copies=[];
  try {
    for (const target of ctx.targets) {
      const copy=foundry.utils.deepClone(ctx.templateData);
      copy.flags ??= {};
      // Do not propagate discovery declarations, legacy managed markers or
      // privileged internal flags from the model to a recipient copy.
      copy.flags[EFFECT_NS]={
        effectGroupId:id,sourceUuid:ctx.source.uuid,
        templateUuid:ctx.template.uuid,key:data.key
      };
      let created;
      if (ctx.template.documentName === 'Item') {
        copy.system ??= {};
        copy.system.active=false;
        const docs=await target.createEmbeddedDocuments('Item',[copy],{[EFFECT_NS]:{skip:true}});
        created=docs[0];
        if (!created) throw Error(`Impossible de créer le buff chez ${target.name}.`);
        copies.push({actorUuid:target.uuid,documentId:created.id,documentType:'Item'});
        effectDebug('copy-created',{kind:ctx.templateKind,sourceTemplate:ctx.template.uuid,
          targetUuid:target.uuid,copyUuid:created.uuid,groupId:id});
        if (typeof created.setActive === 'function') {
          await created.setActive(true,{[EFFECT_NS]:{skip:true}});
        } else {
          await created.update({'system.active':true},{[EFFECT_NS]:{skip:true}});
        }
      } else {
        copy.disabled=false;
        delete copy.duration; // The engine, not Foundry's seconds, tracks expiry.
        const docs=await target.createEmbeddedDocuments('ActiveEffect',[copy],{[EFFECT_NS]:{skip:true}});
        created=docs[0];
        if (!created) throw Error(`Impossible de créer l’ActiveEffect chez ${target.name}.`);
        copies.push({actorUuid:target.uuid,documentId:created.id,documentType:'ActiveEffect'});
        effectDebug('copy-created',{kind:ctx.templateKind,sourceTemplate:ctx.template.uuid,
          targetUuid:target.uuid,copyUuid:created.uuid,groupId:id});
      }
    }
    const session={id,key:data.key,sourceUuid:ctx.source.uuid,templateUuid:ctx.template.uuid,
      combatId:ctx.duration?null:ctx.combat.id,combatantId:ctx.combatant?.id??null,timerId,
      timing:ctx.timing,occurrences:ctx.occurrences,duration:ctx.duration,copies};
    await game.settings.set(EFFECT_NS,GROUPS_SETTING,{...effectGroups(),[id]:session});
    const modApi=game.modules.get(EFFECT_NS).api;
    if (ctx.duration) {
      await modApi.duration.schedule({id:timerId,effectGroupId:id,duration:ctx.duration});
    } else {
      await modApi.generic.scheduleTurn({
        id:timerId,effectGroupId:id,combatId:ctx.combat.id,
        combatantId:ctx.combatant.id,timing:ctx.timing,occurrences:ctx.occurrences
      });
    }
    console.info(`${EFFECT_NS} | Groupe ${id} appliqué à ${copies.length} bénéficiaire(s).`);
    return {applied:true,groupId:id,targetCount:copies.length,timerId};
  } catch(error) {
    effectDebug('clone-failed',{kind:ctx.templateKind,uuid:ctx.template.uuid,
      groupId:id,error:error?.message});
    console.error(`${EFFECT_NS} | Erreur de clonage ${ctx.templateKind} : ${ctx.template.uuid}`,error);
    // Rollback best-effort: preserve recorded copies if some could not be removed.
    const pending=await effectDeleteCopies(copies,id);
    const groups={...effectGroups()};
    if (pending.length) groups[id]={id,key:data.key,sourceUuid:ctx.source.uuid,
      combatId:ctx.duration?null:ctx.combat.id,combatantId:ctx.combatant?.id??null,
      duration:ctx.duration,timerId,copies:pending,pendingCleanup:true};
    else delete groups[id];
    await game.settings.set(EFFECT_NS,GROUPS_SETTING,groups);
    throw error;
  }
}
/**
 * Internal elected-GM service: add one source-specific, durationless AE to a
 * live managed group. All mutations are serialized with group expiration.
 * External requests cannot invoke this through the group's socket channel.
 */
async function effectCreateLinkedOutcome(data) {
  effectRequireLeader();
  if (!effectEnabled() || !data || !effectValidKey(data.key) ||
      typeof data.sourceUuid !== 'string' ||
      typeof data.targetUuid !== 'string' ||
      typeof data.outcomeId !== 'string' || data.outcomeId.length>150) {
    throw Error('Invalid linked outcome request.');
  }
  return effectQueue(async()=>{
    const group=Object.values(effectGroups()).find(g=>g.id===data.groupId &&
      g.sourceUuid===data.sourceUuid && g.key===data.key && !g.pendingCleanup);
    if(!group) return {applied:false,reason:'parent group no longer active'};
    const target=await effectResolveActor(data.targetUuid);
    if(!target) return {applied:false,reason:'target Actor no longer available'};
    // Deduplicate by the actual tracked document, surviving F5 and GM handoff.
    for(const copy of group.copies??[]) {
      if(copy.actorUuid!==target.uuid)continue;
      const doc=effectDocumentFor(target,copy);
      if(doc && (doc.getFlag?.(EFFECT_NS,'outcomeId')===data.outcomeId ||
          (data.ruleId && doc.getFlag?.(EFFECT_NS,'outcomeRuleId')===data.ruleId)))
        return {applied:true,duplicate:true,groupId:group.id,effectUuid:doc.uuid};
    }
    const raw=data.effect;
    if(!raw || typeof raw.label!=='string' || raw.label.length>120 ||
       typeof raw.img!=='string' || raw.img.length>500)throw Error('Invalid outcome effect.');
    // PF1 v13 ActiveEffect is actor-embedded; avoid toggling the global
    // 'fascinated' status because unrelated sources may supply it too.
    const flags={[EFFECT_NS]:{
      effectGroupId:group.id,sourceUuid:group.sourceUuid,key:group.key,
      outcomeId:data.outcomeId,outcomeRuleId:data.ruleId,sourceItemUuid:data.sourceItemUuid,
      sourceActionId:data.sourceActionId
    }};
    // Only attach an official PF1 status when the current installed system
    // advertises that exact condition. Never toggle a global condition:
    // deleting this source-specific AE leaves other providers untouched.
    const registry=globalThis.pf1?.registry?.conditions;
    const official=registry instanceof Map || registry instanceof Set
      ? registry.has('fascinated') :
      (registry && typeof registry==='object' &&
        Object.prototype.hasOwnProperty.call(registry,'fascinated'));
    const requestedStatus=data.effect.statusId==='fascinated' && official
      ? ['fascinated'] : [];
    const created=(await target.createEmbeddedDocuments('ActiveEffect',[{
      name:raw.label,img:raw.img,icon:raw.img,disabled:false,
      origin:data.sourceItemUuid,changes:[],statuses:requestedStatus,flags
    }],{[EFFECT_NS]:{skip:true}}))?.[0];
    if(!created)throw Error('Linked ActiveEffect creation failed.');
    try {
      const updated={...effectGroups()};
      const current=updated[group.id];
      if(!current || current.pendingCleanup)throw Error('Parent group expired during effect creation.');
      const copies=[...(current.copies??[]),{
        actorUuid:target.uuid,documentType:'ActiveEffect',documentId:created.id
      }];
      updated[group.id]={...current,copies};
      await game.settings.set(EFFECT_NS,GROUPS_SETTING,updated);
    }catch(error){
      // If ledger persistence fails, never leave an orphan effect.
      try {await created.delete({[EFFECT_NS]:{skip:true}});}
      catch(cleanupError){console.error(`${EFFECT_NS} | Linked effect rollback failed`,cleanupError);}
      throw error;
    }
    effectDebug('linked-outcome-created',{groupId:group.id,targetUuid:target.uuid,
      effectUuid:created.uuid,outcomeId:data.outcomeId});
    return {applied:true,duplicate:false,groupId:group.id,effectUuid:created.uuid};
  });
}
/** Extend the existing group's timer without touching any beneficiary copies. */
async function effectExtendInternal(data,requester,socketOrigin=false) {
  if (!effectEnabled() || !effectIsLeader()) throw Error('Le MJ responsable est indisponible.');
  if (!effectValidKey(data?.key)) throw Error('Clé de groupe invalide.');
  if (!Number.isInteger(data.rounds) || data.rounds<1 || data.rounds>10000) {
    throw Error('Prolongation attendue : de 1 à 10000 rounds.');
  }
  const source=await effectResolveActor(data.sourceUuid);
  if (!source) throw Error('Acteur source introuvable.');
  const directGM=!socketOrigin && requester?.isGM && effectIsLeader();
  if (!directGM && !source.testUserPermission?.(requester,'OWNER')) {
    throw Error('Vous ne possédez pas ce personnage.');
  }
  const group=Object.values(effectGroups()).find(g=>
    g.sourceUuid===source.uuid && g.key===data.key && !g.pendingCleanup);
  if (!group) throw Error(`Aucun groupe actif à prolonger : ${data.key}.`);
  // Do not hold effectQueue here: timer expiration acquires the timer queue
  // BEFORE the group queue. Extending uses the timer queue only.
  const api=game.modules.get(EFFECT_NS).api;
  const extension=group.duration
    ? await api.duration.extendTimer(group.timerId,{duration:{value:data.rounds,unit:'rounds'}})
    : await api.generic.extendTimer(group.timerId,{rounds:data.rounds});
  return {extended:true,groupId:group.id,targetCount:group.copies?.length??0,
    rounds:data.rounds,targetRound:extension.targetRound??null,
    remainingSeconds:extension.remainingSeconds??null,timerId:group.timerId};
}
async function effectStopInternal(data,requester,socketOrigin) {
  if (!effectEnabled() || !effectIsLeader()) throw Error('Le MJ responsable est indisponible.');
  if (!effectValidKey(data?.key)) throw Error('Clé invalide.');
  const source=await effectResolveActor(data.sourceUuid);
  if (!source) throw Error('Acteur source introuvable.');
  if ((socketOrigin || !requester.isGM) && !source.testUserPermission?.(requester,'OWNER')) {
    throw Error('Personnage source non contrôlé.');
  }
  return {stopped:await effectStopByKeyInternal(source.uuid,data.key)};
}
function effectRequest(op,data) {
  const source=effectActor(data?.actor);
  if (!source || !effectValidKey(data?.key)) throw Error('Actor ou clé invalide.');
  if (!source.isOwner && !game.user.isGM) throw Error('Vous ne contrôlez pas cet acteur.');
  const combat=data.combatId ? game.combats.get(data.combatId) : game.combat;
  const combatantId=data.combatantId ?? ([...(combat?.combatants?.values?.() ?? [])].find(c=>c.actor?.uuid===source.uuid)?.id ?? null);
  const payload={channel:EFFECT_CHANNEL,op,requestId:foundry.utils.randomID(),userId:game.user.id,
    sourceUuid:source.uuid,key:data.key,combatId:combat?.id,combatantId};
  if (op === 'apply') {
    payload.templateUuid=effectUuid(data.templateUuid ?? data.template);
    payload.targetUuids=(data.targets ?? []).map(effectUuid);
    if (data.duration != null) {
      payload.duration=data.duration;
      if (data.timing != null) payload.timing=data.timing;
    } else {
      payload.timing=data.timing ?? 'endOfCurrentTurn';
      payload.occurrences=data.occurrences ?? 1;
    }
  } else if (op === 'extend') {
    payload.rounds=data.rounds ?? 1;
  }
  if (effectIsLeader()) {
    return op==='extend'
      ? effectExtendInternal(payload,game.user,false)
      : effectQueue(()=>op==='apply' ? effectApplyInternal(payload,game.user,false) : effectStopInternal(payload,game.user,false));
  }
  if (!effectPrimaryGM()) throw Error('Un MJ doit être connecté pour appliquer des effets.');
  // This is a request, not an acknowledgement of successful application.
  game.socket.emit(EFFECT_SOCKET,payload);
  return Promise.resolve({submitted:true,requestId:payload.requestId});
}
async function effectHandleSocket(data) {
  if (!effectIsLeader() || !effectEnabled() || data?.channel!==EFFECT_CHANNEL) return;
  if (!data.requestId || typeof data.requestId!=='string' || data.requestId.length>100) return;
  if (effectSeenRequests.has(data.requestId)) return;
  effectSeenRequests.add(data.requestId);
  if (effectSeenRequests.size > 2000) effectSeenRequests.clear();
  const requester=game.users.get(data.userId);
  if (!requester?.active || !['apply','stop','extend'].includes(data.op)) return;
  try {
    if (data.op==='extend') await effectExtendInternal(data,requester,true);
    else await effectQueue(()=>data.op==='apply' ? effectApplyInternal(data,requester,true) : effectStopInternal(data,requester,true));
  } catch(error) {
    console.error(`${EFFECT_NS} | Demande d’effet refusée : ${error.message}`,error);
  }
}
async function effectGroupsForDeletedCombat(combat) {
  if (!effectIsLeader()) return;
  return effectQueue(async()=>{
    const entries=Object.values(effectGroups()).filter(g=>g.combatId===combat.id);
    for (const group of entries) {
      try {await effectExpireGroupInternal(group.id,true);}
      catch(error){console.warn(`${EFFECT_NS} | Nettoyage de combat différé`,group.id,error);}
    }
  });
}

Hooks.once('init',()=>{
  game.settings.register(EFFECT_NS,GROUPS_SETTING,{scope:'world',config:false,type:Object,default:{}});
  game.settings.register(EFFECT_NS,TEMPLATES_SETTING,{scope:'world',config:false,type:Object,default:{}});
  Hooks.on('deleteCombat',combat=>{void effectGroupsForDeletedCombat(combat);});
});
Hooks.once('ready',()=>{
  const mod=game.modules.get(EFFECT_NS);
  mod.api ??= {};
  const api=Object.freeze({
    applyGroup:data=>effectRequest('apply',data),
    stopGroup:data=>effectRequest('stop',data),
    extendGroup:data=>effectRequest('extend',data),
    approveTemplate:effectApproveTemplate,
    revokeTemplate:effectRevokeTemplate,
    listApprovedTemplates:()=>Object.keys(effectApprovals()),
    listGroups:()=>foundry.utils.deepClone(Object.values(effectGroups())),
    _createLinkedOutcome:effectCreateLinkedOutcome, // GM internal; serial with expiry
    expireGroup:effectExpireGroup,
    canExpireGroup:effectCanExpireGroup,
    validateGroupTimer:effectValidateGroupTimer,
    validateDurationGroupTimer:effectValidateDurationGroupTimer
  });
  mod.api.effectGroups=api;
  game.socket.on(EFFECT_SOCKET,data=>{if(data?.channel===EFFECT_CHANNEL)void effectHandleSocket(data);});
});
