/**
 * PF1 Automation Engine — approval-gated, generic item declaration discovery.
 * Class-neutral; never evaluates code stored in flags. Only approved PF1 scripts run.
 */
const DISC_NS = 'pf1-automation-engine'; // Persistent namespace after v1.5.0 migration.
const DISC_FLAG = 'automations';
const DISC_APPROVALS = 'autoApprovals';
const DISC_ENABLED = 'autoDiscoveryEnabled';
const DISC_DEBUG = 'genericDebug';
const discovered = new Map();
let scanPromise = null;
let scanOwner = null;
const discLeader = () => game.users.filter(u => u.active && u.isGM)
  .sort((a,b) => a.id.localeCompare(b.id))[0]?.id === game.user.id;
const discLog = (...a) => { if (game.settings.get(DISC_NS, DISC_DEBUG)) console.debug('PF1 Auto Discovery |',...a); };
const declarations = item => item?.getFlag?.(DISC_NS, DISC_FLAG);
const isItem = doc => doc?.documentName === 'Item';
const enabledDiscovery = () => !game.modules.get('pf1-combat-automation')?.active && game.settings.get(DISC_NS, DISC_ENABLED) && game.settings.get(DISC_NS, 'genericEnabled');
const approvals = () => game.settings.get(DISC_NS, DISC_APPROVALS) ?? {};
function ownItems() {
  const found = new Map();
  function add(item) { if (isItem(item) && item.uuid) found.set(item.uuid, item); }
  for (const item of game.items ?? []) add(item);
  for (const actor of game.actors ?? []) for (const item of actor.items ?? []) add(item);
  // Synthetic actors of unlinked tokens are distinct from world actors.
  for (const scene of game.scenes ?? []) for (const tok of scene.tokens ?? []) {
    if (tok.actorLink) continue;
    for (const item of tok.actor?.items ?? []) add(item);
  }
  return [...found.values()];
}
function scriptSnapshot(item) {
  const system = item?.system ?? {};
  const calls = system.scriptCalls ?? [];
  const actions = system.actions ?? [];
  const asArray = x => Array.isArray(x) ? x : Object.values(x ?? {});
  return {
    scriptCalls: asArray(calls).map(c => ({_id:c?._id, id:c?.id,name:c?.name,category:c?.category,type:c?.type,value:c?.value})),
    actions: asArray(actions).map(a => ({_id:a?._id,id:a?.id,name:a?.name,script:a?.script,command:a?.command}))
  };
}
async function signature(item) {
  const decl = declarations(item);
  if (!Array.isArray(decl) || decl.length > 50) throw Error('La déclaration automations doit contenir au maximum 50 règles.');
  const targets = [...new Set(decl.map(d => d?.itemUuid ?? item.uuid))].sort();
  const sources = [];
  for (const uuid of targets) {
    const target = uuid === item.uuid ? item : await fromUuid(uuid);
    if (!isItem(target)) throw Error(`Objet de script indisponible : ${uuid}`);
    sources.push({uuid, scripts:scriptSnapshot(target)});
  }
  // Exact string comparison (not weak/attackable non-cryptographic hash).
  return JSON.stringify({source:item.uuid,decl,sources});
}
async function refresh(item) {
  if (!isItem(item) || !discLeader()) return;
  discovered.delete(item.uuid);
  if (!enabledDiscovery()) return;
  const decl = declarations(item);
  if (!Array.isArray(decl) || !decl.length) return;
  const approval = approvals()[item.uuid];
  if (!approval) {discLog('Déclaration en attente d’approbation',item.uuid);return;}
  try {
    if (await signature(item) !== approval) {discLog('Approbation périmée',item.uuid);return;}
    const api = game.modules.get(DISC_NS)?.api?.generic;
    if (!api?.validateRule) return;
    const entries = decl.map((d,i) => ({
      ...api.validateRule({
        ...d,
        id: `auto:${item.uuid}:${d.id ?? i}`,
        itemUuid: d.itemUuid ?? item.uuid
      }),
      autoSourceUuid: item.uuid
    }));
    if (new Set(entries.map(e=>e.id)).size !== entries.length) throw Error('Identifiants de règles en double');
    discovered.set(item.uuid, entries);
    discLog('Déclarations chargées',item.uuid,entries.length);
  } catch (err) {console.warn('PF1 Auto Discovery | Déclaration ignorée',item.uuid,err);}
}
async function scan() {
  if (!enabledDiscovery() || !discLeader()) return;
  if (scanPromise) return scanPromise;
  scanPromise = (async()=>{
    discovered.clear();
    for (const item of ownItems()) {
      if (Array.isArray(declarations(item)) && declarations(item).length) await refresh(item);
    }
    scanOwner = game.user.id;
    discLog('Scan terminé', [...discovered.values()].reduce((s,a)=>s+a.length,0));
  })();
  try {await scanPromise;} finally {scanPromise=null;}
}
async function ensureScanned() {
  if (!discLeader() || !enabledDiscovery()) return;
  if (scanPromise) return scanPromise;
  if (scanOwner !== game.user.id) return scan();
}
function listApproved() {
  return [...discovered.values()].flat().map(d => foundry.utils.deepClone(d));
}
async function stillApproved(entry) {
  if (!discLeader() || !enabledDiscovery()) return false;
  const item = await fromUuid(entry.autoSourceUuid);
  if (!isItem(item)) return false;
  const old = approvals()[entry.autoSourceUuid];
  if (!old) return false;
  try {return (await signature(item)) === old;}
  catch(err) {discLog('Script indisponible :',err.message); return false;}
}
function assertGM() {
  if (!game.user.isGM || !discLeader()) throw Error('Opération réservée au MJ principal actif.');
}
async function approveItem(itemUuid) {
  assertGM();
  const item = await fromUuid(itemUuid);
  if (!isItem(item)) throw Error(`Objet introuvable : ${itemUuid}`);
  const decl = declarations(item);
  if (!Array.isArray(decl) || !decl.length) throw Error('Aucune déclaration automations sur cet objet.');
  const api = game.modules.get(DISC_NS)?.api?.generic;
  if (!api?.validateRule || !api?.validateTarget) throw Error('Le moteur générique n’est pas initialisé.');
  for (let i=0;i<decl.length;i++) {
    const r = api.validateRule({...decl[i],id:`auto:${item.uuid}:${decl[i].id ?? i}`,itemUuid:decl[i].itemUuid??item.uuid});
    await api.validateTarget(r);
  }
  const fingerprint = await signature(item);
  await game.settings.set(DISC_NS, DISC_APPROVALS, {...approvals(),[item.uuid]:fingerprint});
  await refresh(item);
  return listApproved().filter(x=>x.autoSourceUuid===item.uuid).length;
}
async function revokeItem(itemUuid) {
  assertGM();
  const next={...approvals()};delete next[itemUuid];
  await game.settings.set(DISC_NS,DISC_APPROVALS,next);
  discovered.delete(itemUuid);
}
async function changedItem(item, op='update') {
  if (!discLeader() || !enabledDiscovery()) return;
  if (op === 'delete') {discovered.delete(item.uuid);return;}
  await refresh(item);
  // A target script may have changed, invalidating approvals in other objects.
  // Recheck before executing in stillApproved(), even if cached entries remain.
}
Hooks.once('init',()=>{
  game.settings.register(DISC_NS,DISC_ENABLED,{name:game.i18n?.localize?.('PF1AE.Settings.AutoDiscovery.Name')??'Automatically discover item automations',hint:game.i18n?.localize?.('PF1AE.Settings.AutoDiscovery.Hint')??'Item declarations require explicit GM approval before execution.',scope:'world',config:true,type:Boolean,default:true,onChange:()=>{scanOwner=null;discovered.clear();}});
  game.settings.register(DISC_NS,DISC_APPROVALS,{scope:'world',config:false,type:Object,default:{},onChange:()=>{scanOwner=null;discovered.clear();}});
  const mod=game.modules.get(DISC_NS);
  mod.api ??= {};
  mod.api.discovery=Object.freeze({scan,ensureScanned,changedItem,listApproved,stillApproved,approveItem,revokeItem,status:()=>({enabled:enabledDiscovery(),approved:Object.keys(approvals()).length,active:listApproved().length})});
});
