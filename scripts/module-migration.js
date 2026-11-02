/**
 * One-time, non-destructive namespace migration for Foundry VTT v13.
 * No class rules. Copies existing world settings and flags before enabling new services.
 * Legacy values are intentionally retained for rollback.
 */
const MIG_NEW = 'pf1-automation-engine';
const MIG_OLD = 'pf1-combat-automation';
const MIG_VERSION = 'namespaceMigrationVersion';
const MIG_BACKUPS = 'legacyMacroBackups';
const MIG_KEYS = ['genericEnabled', 'genericDebug', 'eventRegistry', 'timerRegistry',
  'autoDiscoveryEnabled', 'autoApprovals'];
let migrationTask = null;
let migrationRunning = false;

const isMigrationLeader = () => game.users.filter(u => u.active && u.isGM)
  .sort((a, b) => a.id.localeCompare(b.id))[0]?.id === game.user.id;

function worldSetting(namespace, key) {
  const world = game.settings.storage.get('world');
  const serialized = world?.getItem?.(`${namespace}.${key}`);
  if (serialized === null || serialized === undefined) return {present: false};
  return {present: true, value: JSON.parse(serialized)};
}

function allMigrationDocuments() {
  const documents = new Map();
  const add = doc => { if (doc?.uuid && doc.update) documents.set(doc.uuid, doc); };
  const addActor = actor => {
    add(actor);
    for (const item of actor?.items ?? []) add(item);
    for (const effect of actor?.effects ?? []) add(effect);
  };
  for (const item of game.items ?? []) add(item);
  for (const actor of game.actors ?? []) addActor(actor);
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) {
      add(token);
      if (!token.actorLink) addActor(token.actor);
    }
  }
  return [...documents.values()];
}

function rewriteMacroReferences(source) {
  if (typeof source !== 'string') return source;
  // Only update literal module lookups and documented namespaced setting/flag calls.
  // Never interpret or evaluate macro code.
  return source
    .replace(/game\.modules\.get\(\s*([\"'`])pf1-combat-automation\1\s*\)/g,
      `game.modules.get('${MIG_NEW}')`)
    .replace(/(\b(?:getFlag|setFlag|unsetFlag)\s*\(\s*)([\"'`])pf1-combat-automation\2/g,
      `$1'${MIG_NEW}'`)
    .replace(/(\bgame\.settings\.(?:get|set)\s*\(\s*)([\"'`])pf1-combat-automation\2/g,
      `$1'${MIG_NEW}'`);
}

async function migrateMacros(report) {
  const priorBackups = game.settings.get(MIG_NEW, MIG_BACKUPS) ?? {};
  const backups = {...priorBackups};
  const candidates = [];
  for (const macro of game.macros ?? []) {
    if (macro.type !== 'script' || typeof macro.command !== 'string') continue;
    const updated = rewriteMacroReferences(macro.command);
    if (updated === macro.command) continue;
    if (!Object.hasOwn(backups, macro.id)) backups[macro.id] = macro.command;
    candidates.push({macro, updated});
  }
  // Persist originals before the first write so macros can be restored manually.
  if (candidates.length) await game.settings.set(MIG_NEW, MIG_BACKUPS, backups);
  for (const {macro, updated} of candidates) {
    try {
      await macro.update({command: updated}, {[MIG_NEW]: {skip:true}});
      report.macros++;
    } catch (err) {
      report.errors.push(`Macro ${macro.name}: ${err.message}`);
      console.error(`${MIG_NEW} | Migration macro échouée`, macro.name, err);
    }
  }
}

function mergedFlags(doc) {
  const prior = doc?.flags?.[MIG_OLD];
  if (!prior || typeof prior !== 'object' || Array.isArray(prior)) return null;
  const current = doc?.flags?.[MIG_NEW] ?? {};
  // Preserve explicitly configured values in the new namespace.
  const next = foundry.utils.mergeObject(foundry.utils.deepClone(prior),
    foundry.utils.deepClone(current), {inplace:false, overwrite:true});
  if (JSON.stringify(next) === JSON.stringify(current)) return null;
  return next;
}

async function migrateNamespace() {
  if (!isMigrationLeader()) return {skipped: 'non-primary-GM'};
  if (game.modules.get(MIG_OLD)?.active) {
    const message = `Désactiver d'abord l'ancien module ${MIG_OLD} pour éviter deux moteurs concurrents.`;
    ui.notifications.error(message);
    throw new Error(message);
  }
  if (Number(game.settings.get(MIG_NEW, MIG_VERSION)) >= 1) return {skipped: 'already-migrated'};

  migrationRunning = true;
  const report = {settings: 0, documents: 0, macros: 0, errors: []};
  try {
    for (const key of MIG_KEYS) {
      const oldRecord = worldSetting(MIG_OLD, key);
      const newRecord = worldSetting(MIG_NEW, key);
      if (!oldRecord.present || newRecord.present) continue;
      await game.settings.set(MIG_NEW, key, foundry.utils.deepClone(oldRecord.value));
      report.settings++;
    }
    for (const doc of allMigrationDocuments()) {
      const flags = mergedFlags(doc);
      if (!flags) continue;
      try {
        await doc.update({[`flags.${MIG_NEW}`]: flags}, {[MIG_NEW]: {skip: true}});
        report.documents++;
      } catch (err) {
        report.errors.push(`${doc.uuid}: ${err.message}`);
        console.error(`${MIG_NEW} | Migration flags échouée`, doc.uuid, err);
      }
    }
    await migrateMacros(report);
    // Do not mark the migration done if even one document could not be copied.
    if (report.errors.length) throw new Error(`${report.errors.length} documents non migrés ; nouvelle tentative au prochain chargement.`);
    await game.settings.set(MIG_NEW, MIG_VERSION, 1);
    if (report.settings || report.documents || report.macros) {
      console.info(`${MIG_NEW} | Migration réussie :`, report);
      ui.notifications.info('PF1 Automation Engine : paramètres et flags transférés. Les données historiques sont conservées.');
    }
    return report;
  } finally {
    migrationRunning = false;
  }
}

function whenMigrationReady() {
  if (!migrationTask) migrationTask = migrateNamespace().catch(err => {
    console.error(`${MIG_NEW} | Migration interrompue`, err);
    throw err;
  });
  return migrationTask;
}

Hooks.once('init', () => {
  game.settings.register(MIG_NEW, MIG_BACKUPS, {
    name:'Sauvegarde des macros avant migration',
    hint:'Copies des commandes des macros réécrites par la migration du module.',
    scope:'world', config:false, type:Object, default:{}
  });
  game.settings.register(MIG_NEW, MIG_VERSION, {
    name:'Migration de l’identifiant de module',
    hint:'État technique de reprise des paramètres et flags du module précédent.',
    scope:'world', config:false, type:Number, default:0
  });
  const module = game.modules.get(MIG_NEW);
  module.api ??= {};
  module.api.migration = Object.freeze({
    whenReady:whenMigrationReady,
    status:() => ({complete: Number(game.settings.get(MIG_NEW, MIG_VERSION)) >= 1,
      running:migrationRunning, oldModuleActive: !!game.modules.get(MIG_OLD)?.active})
  });
});

Hooks.once('ready', () => { void whenMigrationReady().catch(() => {}); });
