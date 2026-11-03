/**
 * PF1 Automation Engine v1.8.0 — persistent game-time durations.
 *
 * Pure observer: never pauses, resumes, sets, or advances the world clock.
 * The WorldTime clock belongs to Foundry and installed calendar modules.
 * Outside combat, the canonical elapsed time is game.time.worldTime.
 * During combat, the greater of (elapsed combat rounds * 6s) and (elapsed
 * world seconds) is used: a Foundry round clock and a calendar clock must
 * not charge the same elapsed time twice.
 *
 * This module deliberately stores its own registry. Legacy v1.7 phase
 * timers and group sessions are not migrated or reinterpreted.
 */
const DURATION_NS = 'pf1-automation-engine';
const DURATION_REGISTRY = 'durationRegistry';
const DURATION_SECONDS_PER_ROUND = 6;
const DURATION_UNITS = Object.freeze({seconds:1,rounds:6,minutes:60,hours:3600});
const DURATION_MAX_SECONDS = 31536000;
let durationTail = Promise.resolve();

const durationLeader = () => [...game.users].filter(u => u.active && u.isGM)
  .sort((a,b)=>a.id.localeCompare(b.id))[0]?.id === game.user.id;
const durationEnabled = () => !!game.modules.get(DURATION_NS)?.active &&
  !game.modules.get('pf1-combat-automation')?.active &&
  game.settings.get(DURATION_NS,'genericEnabled');
const durationRead = () => game.settings.get(DURATION_NS,DURATION_REGISTRY) ?? [];
const durationClone = value => foundry.utils.deepClone(value);
const durationString = (value,max=300) => typeof value==='string' && value.length>0 && value.length<=max;
const durationObject = value => !!value && typeof value==='object' && !Array.isArray(value);
const durationUuid = value => typeof value==='string' ? value : value?.uuid;
const durationActor = doc => doc?.documentName==='Actor' ? doc : doc?.actor ??
  (doc?.parent?.documentName==='Actor' ? doc.parent : null);
const durationWorldTime = () => {
  const value=Number(game.time?.worldTime);
  if (!Number.isFinite(value)) throw Error('Horloge du monde Foundry indisponible.');
  return value;
};
const durationRequireGM = () => {
  if (!game.user.isGM || !durationLeader()) throw Error('Opération réservée au MJ responsable.');
};
function durationQueue(action) {
  const next=durationTail.catch(()=>{}).then(action);
  durationTail=next.catch(()=>{});
  return next;
}
function durationActiveCombat(ignoreId=null) {
  const selected=game.combat;
  if (selected?.started && selected.id!==ignoreId) return selected;
  return [...(game.combats?.contents ?? game.combats?.values?.() ?? [])]
    .find(c=>c?.started && c.id!==ignoreId) ?? null;
}
function durationSeconds(duration) {
  if (!durationObject(duration) || !Object.hasOwn(DURATION_UNITS,duration.unit) ||
      !Number.isSafeInteger(duration.value) || duration.value<1) {
    throw Error('Durée invalide : {value: entier positif, unit: seconds|rounds|minutes|hours}.');
  }
  const seconds=duration.value*DURATION_UNITS[duration.unit];
  if (!Number.isSafeInteger(seconds) || seconds>DURATION_MAX_SECONDS) {
    throw Error('Durée supérieure à la limite autorisée (365 jours).');
  }
  return seconds;
}
function durationTargetKind(data) {
  const kinds=['effectUuid','effectGroupId','itemUuid'].filter(key=>data[key]!=null);
  if (kinds.length!==1) throw Error('Une seule cible est autorisée : effet, groupe OU script PF1.');
  return kinds[0];
}
function durationFindScript(item, data) {
  const cats={use:'use',afterUse:'postUse',postUse:'postUse',toggle:'toggle'};
  const category=cats[data.scriptCategory];
  if (!category || !durationString(data.scriptId,120)) throw Error('Script PF1 : catégorie et identifiant requis.');
  const calls=item.scriptCalls;
  const list=calls?.contents ?? (typeof calls?.values==='function'?[...calls.values()]:[]);
  const matches=list.filter(c=>c.category===category &&
    (c.id===data.scriptId || c._id===data.scriptId || c.name===data.scriptId));
  if (matches.length!==1 || typeof matches[0].execute!=='function') {
    throw Error('Appel de script PF1 introuvable ou ambigu.');
  }
  return matches[0];
}
async function durationTarget(data) {
  const kind=durationTargetKind(data);
  if (kind==='effectUuid') {
    if (!durationString(data.effectUuid,400)) throw Error('UUID effet invalide.');
    const doc=await fromUuid(data.effectUuid);
    if (!durationActor(doc) || !(doc?.documentName==='ActiveEffect' ||
        (doc?.documentName==='Item' && doc.type==='buff'))) {
      throw Error('Effet attendu : buff PF1 ou ActiveEffect appartenant à un acteur.');
    }
    const effectAction=data.effectAction ?? 'disable';
    if (!['disable','delete'].includes(effectAction) || (doc.documentName==='Item' && effectAction==='delete')) {
      throw Error('Action non autorisée pour cet effet (disable ou delete pour ActiveEffect).');
    }
    return {effectUuid:doc.uuid,effectAction};
  }
  if (kind==='effectGroupId') {
    if (!durationString(data.effectGroupId,100)) throw Error('Identifiant de groupe invalide.');
    const groups=game.modules.get(DURATION_NS)?.api?.effectGroups;
    if (!groups?.validateDurationGroupTimer?.(data.effectGroupId)) {
      throw Error('Groupe non enregistré ou incompatible.');
    }
    return {effectGroupId:data.effectGroupId};
  }
  if (!durationString(data.itemUuid,400) || !durationString(data.scriptId,120)) {
    throw Error('Un objet et un script PF1 sont requis.');
  }
  const item=await fromUuid(data.itemUuid);
  if (item?.documentName!=='Item' || !durationActor(item)) throw Error('Item PF1 intégré à un acteur requis.');
  durationFindScript(item,data);
  return {itemUuid:item.uuid,scriptId:data.scriptId,scriptCategory:data.scriptCategory};
}
/** Return a non-mutating projection of a timer at the current game clock. */
function durationProject(timer,now,combat,ignoreCombatId=null) {
  if (timer.due) return timer;
  const running=combat && combat.started && combat.id!==ignoreCombatId ? combat : null;
  if (timer.mode==='world') {
    const delta=Math.max(0,now-timer.worldAnchor);
    const remaining=Math.max(0,timer.remainingSeconds-delta);
    if (running) {
      return {...timer,mode:'combat',combatId:running.id,roundAnchor:running.round,
        maxRound:running.round,combatWorldAnchor:now,remainingAtCombatStart:remaining,
        remainingSeconds:remaining,worldAnchor:null,due:remaining<=0};
    }
    if (!delta) return timer;
    return {...timer,remainingSeconds:remaining,worldAnchor:now,due:remaining<=0};
  }
  if (timer.mode==='combat') {
    const tracked=game.combats?.get?.(timer.combatId) ?? null;
    const alive=tracked?.started && tracked.id!==ignoreCombatId;
    const oldMax=Number.isInteger(timer.maxRound)?timer.maxRound:timer.roundAnchor;
    const maxRound=Math.max(oldMax,Number.isInteger(tracked?.round)?tracked.round:oldMax);
    const roundElapsed=Math.max(0,maxRound-timer.roundAnchor)*DURATION_SECONDS_PER_ROUND;
    const worldElapsed=Math.max(0,now-timer.combatWorldAnchor);
    // A calendar might also advance worldTime by 6 seconds each combat round.
    const elapsed=Math.max(roundElapsed,worldElapsed);
    const remaining=Math.max(0,timer.remainingAtCombatStart-elapsed);
    if (!alive) {
      // Rebase to the world clock, without modifying it. If Seasons & Stars
      // has already advanced worldTime during combat, the max() above
      // prevents consuming these seconds twice.
      const {combatId,roundAnchor,maxRound:unused,combatWorldAnchor,remainingAtCombatStart,...rest}=timer;
      return {...rest,mode:'world',worldAnchor:now,remainingSeconds:remaining,due:remaining<=0};
    }
    if (maxRound===oldMax && remaining===timer.remainingSeconds) return timer;
    return {...timer,maxRound,remainingSeconds:remaining,due:remaining<=0};
  }
  return {...timer,due:true}; // corrupt state, preserve until reviewed
}
async function durationExpire(timer) {
  if (!durationLeader() || !durationEnabled()) throw Error('MJ responsable indisponible.');
  if (timer.effectGroupId) {
    const api=game.modules.get(DURATION_NS)?.api?.effectGroups;
    if (!api?.expireGroup) throw Error('Gestionnaire de groupes indisponible.');
    await api.expireGroup(timer.effectGroupId,{fromTimer:true});
    return;
  }
  if (timer.effectUuid) {
    const doc=await fromUuid(timer.effectUuid);
    if (!doc) return; // already removed by another action
    if (!durationActor(doc)) throw Error('Effet sans acteur propriétaire.');
    if (doc.documentName==='Item') {
      if (doc.type!=='buff') throw Error('Le document a changé de type.');
      if (doc.activeState===false || doc.system?.active===false) return;
      if (typeof doc.setActive==='function') await doc.setActive(false,{[DURATION_NS]:{skip:true}});
      else await doc.update({'system.active':false},{[DURATION_NS]:{skip:true}});
    } else if (doc.documentName==='ActiveEffect') {
      if (timer.effectAction==='delete') await doc.delete({[DURATION_NS]:{skip:true}});
      else if (!doc.disabled) await doc.update({disabled:true},{[DURATION_NS]:{skip:true}});
    } else throw Error('Document non compatible avec une expiration.');
    return;
  }
  const item=await fromUuid(timer.itemUuid);
  if (!item || !durationActor(item)) throw Error('Script PF1 temporairement indisponible.');
  const call=durationFindScript(item,timer);
  await call.execute({action:null},{event:Object.freeze({type:'expiry',timing:'duration',
    worldTime:durationWorldTime(),seconds:timer.durationSeconds,actorUuid:durationActor(item)?.uuid,
    itemUuid:item.uuid}),state:null,api:game.modules.get(DURATION_NS).api.generic});
}
async function durationReconcileInternal(ignoreCombatId=null) {
  if (!durationEnabled() || !durationLeader()) return;
  const now=durationWorldTime();
  const combat=durationActiveCombat(ignoreCombatId);
  const timers=durationRead();
  const projected=timers.map(timer=>durationProject(timer,now,combat,ignoreCombatId));
  if (JSON.stringify(projected)!==JSON.stringify(timers)) {
    await game.settings.set(DURATION_NS,DURATION_REGISTRY,projected);
  }
  for (const timer of projected.filter(t=>t.due)) {
    if (!durationEnabled() || !durationLeader()) return;
    try {
      await durationExpire(timer);
      const next=durationRead().filter(t=>t.id!==timer.id);
      await game.settings.set(DURATION_NS,DURATION_REGISTRY,next);
    } catch(error) {
      // Keep due:true for retries after reconnection or document restoration.
      console.error(`${DURATION_NS} | Expiration de durée ${timer.id} en attente`,error);
    }
  }
}
function durationReconcile(ignoreCombatId=null) {
  return durationQueue(()=>durationReconcileInternal(ignoreCombatId));
}
async function durationSchedule(data) {
  durationRequireGM();
  if (!durationObject(data) || !durationString(data.id,100)) throw Error('Identifiant de durée invalide.');
  const seconds=durationSeconds(data.duration);
  const target=await durationTarget(data);
  const combat=durationActiveCombat();
  const now=durationWorldTime();
  return durationQueue(async()=>{
    // Do not reconcile here: a group may be holding its own mutation queue.
    const timer={id:data.id,unit:'duration',durationSeconds:seconds,remainingSeconds:seconds,
      due:false,...target,...(combat?.started?{
        mode:'combat',combatId:combat.id,roundAnchor:combat.round,maxRound:combat.round,
        combatWorldAnchor:now,remainingAtCombatStart:seconds
      }:{mode:'world',worldAnchor:now})};
    await game.settings.set(DURATION_NS,DURATION_REGISTRY,
      [...durationRead().filter(t=>t.id!==timer.id),timer]);
    return timer.id;
  });
}
async function durationExtend(id,{duration}={}) {
  durationRequireGM();
  if (!durationString(id,100)) throw Error('Identifiant de minuteur invalide.');
  const seconds=durationSeconds(duration);
  return durationQueue(async()=>{
    await durationReconcileInternal();
    const list=durationRead();
    const index=list.findIndex(t=>t.id===id);
    if (index<0 || list[index].due) throw Error('Minuteur absent ou expiré.');
    const timer=list[index];
    const updated={...timer,remainingSeconds:timer.remainingSeconds+seconds,
      ...(timer.mode==='combat' ? {remainingAtCombatStart:timer.remainingAtCombatStart+seconds}:{}),
      durationSeconds:timer.durationSeconds+seconds};
    if (updated.durationSeconds>DURATION_MAX_SECONDS) throw Error('Durée totale trop longue.');
    await game.settings.set(DURATION_NS,DURATION_REGISTRY,
      list.map(t=>t.id===id?updated:t));
    return {extended:true,id,seconds,remainingSeconds:updated.remainingSeconds};
  });
}
async function durationCancel(id) {
  durationRequireGM();
  if (!durationString(id,100)) throw Error('Identifiant de minuteur invalide.');
  return durationQueue(async()=>{
    const list=durationRead();
    if (list.some(t=>t.id===id)) {
      await game.settings.set(DURATION_NS,DURATION_REGISTRY,list.filter(t=>t.id!==id));
    }
  });
}
function durationList() {
  const now=durationWorldTime();
  const combat=durationActiveCombat();
  return durationClone(durationRead().map(t=>durationProject(t,now,combat)));
}
Hooks.once('init',()=>{
  game.settings.register(DURATION_NS,DURATION_REGISTRY,{scope:'world',config:false,type:Array,default:[]});
  Hooks.on('updateWorldTime',()=>{void durationReconcile();});
  Hooks.on('combatTurnChange',()=>{void durationReconcile();});
  Hooks.on('updateCombat',()=>{void durationReconcile();});
  Hooks.on('createCombat',()=>{void durationReconcile();});
  Hooks.on('deleteCombat',combat=>{void durationReconcile(combat.id);});
});
Hooks.once('ready',()=>{
  const mod=game.modules.get(DURATION_NS);
  mod.api ??= {};
  mod.api.duration=Object.freeze({
    schedule:durationSchedule,
    scheduleEffect:durationSchedule,
    extendTimer:durationExtend,
    cancelTimer:durationCancel,
    listTimers:durationList,
    reconcile:()=>durationReconcile(),
    secondsPerRound:DURATION_SECONDS_PER_ROUND
  });
  void durationReconcile();
});
