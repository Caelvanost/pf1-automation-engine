/** Generic persistent automation services. Foundry VTT v13. No class rules. */
const NS = 'pf1-combat-automation';
const REG = 'eventRegistry';
const TIMERS = 'timerRegistry';
const ENABLED = 'genericEnabled';
const DEBUG = 'genericDebug';
const EVENT_TYPES = new Set(['updateActor','updateItem','createItem','deleteItem','createActiveEffect','updateActiveEffect','deleteActiveEffect','ready','combatTurnChange']);
const activeRuns = new Set();
const activeActorRuns = new Set();
const processed = new Set();
const queues = new Map();
const uid = () => foundry.utils.randomID();
const log = (...args) => { if (game.settings.get(NS, DEBUG)) console.debug(`${NS} |`, ...args); };
const primary = () => game.users.filter(u=>u.active && u.isGM).sort((a,b)=>a.id.localeCompare(b.id))[0];
const leader = () => primary()?.id === game.user.id;
const enabled = () => game.settings.get(NS, ENABLED);
const getRegistry = () => game.settings.get(NS, REG) ?? [];
const getTimers = () => game.settings.get(NS, TIMERS) ?? [];
const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const safeText = (s, max=200) => typeof s === 'string' && s.length > 0 && s.length <= max;
const clone = o => foundry.utils.deepClone(o);
const normalizeUUID = doc => doc?.uuid ?? (typeof doc === 'string' ? doc : null);
const actorFor = doc => doc?.documentName === 'Actor' ? doc : doc?.actor ?? doc?.parent?.actor ?? (doc?.parent?.documentName === 'Actor' ? doc.parent : null);
const paths = (obj, prefix='') => {
  if (!obj || typeof obj !== 'object') return prefix ? [prefix] : [];
  return Object.entries(obj).flatMap(([k,v])=> paths(v, prefix ? `${prefix}.${k}` : k).length ? paths(v, prefix ? `${prefix}.${k}` : k) : [prefix ? `${prefix}.${k}` : k]);
};
function isMatch(rule, ev) {
  if (rule.on !== ev.type) return false;
  const f = rule.filter ?? {};
  if (f.actorUuid && f.actorUuid !== ev.actorUuid) return false;
  if (f.documentUuid && f.documentUuid !== ev.documentUuid) return false;
  if (f.itemUuid && f.itemUuid !== ev.itemUuid) return false;
  if (f.tag) {
    const tags = ev.document?.getFlag?.(NS,'tags') ?? [];
    if (!Array.isArray(tags) || !tags.includes(f.tag)) return false;
  }
  if (f.properties?.length && !f.properties.some(p=>ev.changedPaths.some(c=>c===p || c.startsWith(`${p}.`) || p.startsWith(`${c}.`)))) return false;
  if (f.buffState && f.buffState !== ev.buffState) return false;
  return true;
}
function serialize(ev) { return { type:ev.type, actorUuid:ev.actorUuid, itemUuid:ev.itemUuid, documentUuid:ev.documentUuid, changedPaths:ev.changedPaths, buffState:ev.buffState, round:ev.round, combatId:ev.combatId, combatantId:ev.combatantId }; }
function appendQueue(key, fn) {
  const last = queues.get(key) ?? Promise.resolve();
  const next = last.catch(()=>{}).then(fn);
  queues.set(key,next);
  next.finally(()=>{ if(queues.get(key)===next) queues.delete(key); }).catch(()=>{});
  return next;
}
function actionScript(item, actionId) {
  // Different PF1 builds may store scripts in different action fields.
  const actions = item.system?.actions;
  const list = Array.isArray(actions) ? actions : Object.values(actions ?? {});
  const action = list.find(a=>a?._id===actionId || a?.id===actionId || a?.name===actionId);
  if (!action) throw Error(`Action PF1 introuvable (${actionId}) sur ${item.name}`);
  const candidates = [action.script?.command, action.script?.code, action.script, action.command, action.data?.script?.command];
  const code = candidates.find(c=>typeof c==='string' && c.trim());
  if (!code) throw Error(`Script introuvable pour l'action ${actionId}. Vérifier le champ dans la version PF1 installée.`);
  return code;
}
// PF1 11.11: script-call entries are ItemScriptCall models in item.scriptCalls.
const CATEGORIES = {use:'use',afterUse:'postUse',postUse:'postUse',toggle:'toggle'};
function scriptCall(item, entry) {
  const category = CATEGORIES[entry.scriptCategory];
  if (!category) throw Error(`Catégorie PF1 inconnue : ${entry.scriptCategory}`);
  const calls = item.scriptCalls;
  const list = calls?.contents ?? (typeof calls?.values === 'function' ? [...calls.values()] : Array.isArray(calls) ? calls : item.system?.scriptCalls ?? []);
  const matches = list.filter(c => c.category === category &&
    (c.id === entry.scriptId || c._id === entry.scriptId || c.name === entry.scriptId));
  if (!matches.length) throw Error(`Appel de script PF1 '${entry.scriptId}' (${category}) introuvable sur ${item.name}`);
  if (matches.length !== 1) throw Error(`Nom de script ambigu : ${entry.scriptId} (${matches.length} correspondances). Utiliser son ID.`);
  const call = matches[0];
  if (typeof call.execute !== 'function') throw Error(`Le script ${entry.scriptId} n'est pas un modèle PF1 exécutable`);
  return call;
}
function resolveTarget(item, entry) {
  if (entry.scriptId) return scriptCall(item,entry);
  return actionScript(item,entry.actionId);
}
async function runHandler(entry, ev) {
  const key = entry.id;
  if (activeRuns.has(key)) {log('Récursion évitée',key);return;}
  const item = await fromUuid(entry.itemUuid);
  if (!item || item.documentName !== 'Item') {console.warn(NS,'Item de script introuvable',entry.itemUuid);return;}
  const actor = actorFor(item) ?? (entry.actorUuid ? await fromUuid(entry.actorUuid) : null);
  if (!actor) {console.warn(NS,'Actor de script introuvable',entry.id);return;}
  // Script code is GM-approved. Never accept arbitrary code in event payload.
  if (activeActorRuns.has(actor.uuid)) {log('Cycle d’acteur évité',actor.uuid);return;}
  activeRuns.add(key);
  activeActorRuns.add(actor.uuid);
  try {
    const scriptEvent = Object.freeze(clone(serialize(ev)));
    if (entry.scriptId) {
      const call = scriptCall(item, entry);
      // PF1's own execution path sets actor/item/token via the Macro delegate.
      // Only this call is run; item.use() and item.executeScriptCalls() are not invoked.
      await call.execute({action:null}, {event:scriptEvent, state:ev.buffState ?? null, api:game.modules.get(NS).api.generic});
    } else {
      const code = actionScript(item, entry.actionId);
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const fn = new AsyncFunction('actor','item','event','api','token','game','canvas','ui','ChatMessage','foundry', `"use strict";\n${code}`);
      await fn.call(null, actor, item, scriptEvent, game.modules.get(NS).api.generic, actor.getActiveTokens?.()[0] ?? null, game, canvas, ui, ChatMessage, foundry);
    }
    log('Script exécuté',entry.id,ev.type);
  } catch(err) {console.error(`${NS} | Échec script ${entry.id}`,err);} finally {activeRuns.delete(key);activeActorRuns.delete(actor.uuid);}
}
async function dispatch(ev) {
  if (!enabled() || !leader()) return;
  if (ev.actorUuid && activeActorRuns.has(ev.actorUuid)) return;
  const matched = getRegistry().filter(r=>isMatch(r,ev));
  for (const entry of matched) await appendQueue(entry.id,()=>runHandler(entry,ev));
}
function event(type,doc,change={}) {
  const a = actorFor(doc);
  const item = doc?.documentName === 'Item' ? doc : null;
  const pathsChanged = paths(change);
  const disabled = change?.disabled;
  return { type, document:doc, documentUuid:doc?.uuid ?? null, actorUuid:a?.uuid ?? null, itemUuid:item?.uuid ?? null, changedPaths:pathsChanged, buffState: type.includes('ActiveEffect') ? (type === 'createActiveEffect' ? 'active' : type === 'deleteActiveEffect' ? 'inactive' : disabled===true ? 'inactive' : disabled===false ? 'active' : null) : null };
}
function validateRule(data) {
  if (!obj(data) || !safeText(data.id,100) || !EVENT_TYPES.has(data.on)) throw Error('Déclaration événement invalide');
  if (!safeText(data.itemUuid,300) || !(safeText(data.actionId,120) !== safeText(data.scriptId,120))) throw Error('Item et exactement un de actionId/scriptId requis');
  if(data.scriptId && !CATEGORIES[data.scriptCategory]) throw Error('Catégorie de script invalide (use, postUse, afterUse ou toggle)');
  const f = data.filter ?? {};
  if (!obj(f)) throw Error('Filtre invalide');
  for (const k of Object.keys(f)) if (!['actorUuid','documentUuid','itemUuid','tag','properties','buffState'].includes(k)) throw Error(`Filtre inconnu ${k}`);
  if (f.properties && (!Array.isArray(f.properties) || f.properties.length>30 || f.properties.some(p=>!safeText(p,150)))) throw Error('Propriétés invalides');
  return {id:data.id,on:data.on,itemUuid:data.itemUuid,actionId:data.actionId??null,scriptId:data.scriptId??null,scriptCategory:data.scriptCategory??null,actorUuid:data.actorUuid??null,filter:clone(f)};
}
function requireGM() { if (!game.user.isGM) throw Error('Opération réservée au MJ'); if (!leader()) throw Error('Utiliser le MJ principal actif'); }
async function register(data) {
  requireGM(); const r=validateRule(data);
  const item = await fromUuid(r.itemUuid);
  if (item?.documentName !== 'Item') throw Error('Item de script introuvable');
  resolveTarget(item,r);
  const list=getRegistry().filter(x=>x.id!==r.id);list.push(r);
  await game.settings.set(NS, REG, list);
  return r.id;
}
async function unregister(id) {requireGM();await game.settings.set(NS,REG,getRegistry().filter(x=>x.id!==id));}
function validTimer(data) {
  if (!obj(data)||!safeText(data.id,100)||!safeText(data.itemUuid,300)||!(safeText(data.actionId,120) !== safeText(data.scriptId,120))) throw Error('Minuteur invalide');
  if(data.scriptId && !CATEGORIES[data.scriptCategory]) throw Error('Catégorie de script invalide');
  if (!['rounds','turns'].includes(data.unit)||!Number.isInteger(data.amount)||data.amount<1||data.amount>10000) throw Error('Durée invalide');
  const combat = data.combatId ? game.combats.get(data.combatId) : game.combat;
  if (!combat?.started) throw Error('Combat actif requis');
  const combattant = data.combatantId ? combat.combatants.get(data.combatantId) : combat.combatant;
  if (!combattant) throw Error('Combattant requis');
  if (data.unit==='turns' && !combattant) throw Error('Combattant requis pour les tours');
  return {id:data.id,itemUuid:data.itemUuid,actionId:data.actionId??null,scriptId:data.scriptId??null,scriptCategory:data.scriptCategory??null,actorUuid:normalizeUUID(data.actorUuid)??combattant.actor?.uuid??null,combatId:combat.id,combatantId:combattant.id,unit:data.unit,amount:data.amount,remaining:data.amount,createdRound:combat.round,createdTurn:combat.turn,lastPosition:`${combat.round}:${combat.turn}`};
}
async function schedule(data) {
  requireGM(); const timer=validTimer(data);
  const item=await fromUuid(timer.itemUuid);if(!item||item.documentName!=='Item')throw Error('Item introuvable');resolveTarget(item,timer);
  const list=getTimers().filter(t=>t.id!==timer.id);list.push(timer);await game.settings.set(NS,TIMERS,list);return timer.id;
}
async function cancelTimer(id) {requireGM();await game.settings.set(NS,TIMERS,getTimers().filter(t=>t.id!==id));}
async function advanceTimers(combat,prior,current) {
  if (!leader()||!enabled()) return;
  if (!Number.isInteger(prior?.round)||!Number.isInteger(current?.round))return;
  if (current.round<prior.round || (current.round===prior.round && current.turn<=prior.turn))return;
  const cursor=`${current.round}:${current.turn}`;
  const list=getTimers();const pending=[];const expired=[];
  for (const t of list) {
    if(t.combatId!==combat.id){pending.push(t);continue;}
    if(t.lastPosition===cursor){pending.push(t);continue;}
    const decrement=t.unit==='rounds'?Math.max(0,current.round-prior.round):(prior.combatantId===t.combatantId?1:0);
    const remaining=t.remaining-decrement;
    if (remaining<=0) expired.push(t); else pending.push({...t,remaining,lastPosition:cursor});
  }
  // Commit removal before invoking scripts; re-entrant updates cannot fire same expiry twice.
  if (expired.length || pending.length!==list.length || pending.some((t,i)=>t!==list[i])) await game.settings.set(NS,TIMERS,pending);
  for (const t of expired) await runHandler(t,{type:'expiry',round:current.round,combatId:combat.id,combatantId:t.combatantId,actorUuid:t.actorUuid,itemUuid:t.itemUuid,documentUuid:t.itemUuid,changedPaths:[],buffState:null});
}
function install() {
  Hooks.on('updateActor',(doc,change,options)=>{if(options?.[NS]?.skip)return;void dispatch(event('updateActor',doc,change));});
  Hooks.on('updateItem',(doc,change,options)=>{if(options?.[NS]?.skip)return;void dispatch(event('updateItem',doc,change));});
  Hooks.on('createItem',(doc,options)=>{if(options?.[NS]?.skip)return;void dispatch(event('createItem',doc));});
  Hooks.on('deleteItem',(doc,options)=>{if(options?.[NS]?.skip)return;void dispatch(event('deleteItem',doc));});
  for (const name of ['createActiveEffect','updateActiveEffect','deleteActiveEffect']) Hooks.on(name,(doc,changeOrOptions,options)=>{if((options??changeOrOptions)?.[NS]?.skip)return;void dispatch(event(name,doc,name==='updateActiveEffect'?changeOrOptions:{}));});
  Hooks.on('combatTurnChange',(combat,prior,current)=>{void advanceTimers(combat,prior,current);void dispatch({type:'combatTurnChange',documentUuid:combat.uuid,actorUuid:combat.combatants.get(prior.combatantId)?.actor?.uuid??null,itemUuid:null,changedPaths:['round','turn'],round:current.round,combatId:combat.id,combatantId:prior.combatantId,buffState:null});});
  Hooks.on('deleteCombat',async combat=>{if(!enabled()||!leader())return;const old=getTimers();if(old.some(t=>t.combatId===combat.id))await game.settings.set(NS,TIMERS,old.filter(t=>t.combatId!==combat.id));});
}
Hooks.once('init',()=>{
  game.settings.register(NS,ENABLED,{name:'Activer les automatisations génériques',hint:'Active les événements persistants, synchronisations et minuteurs.',scope:'world',config:true,type:Boolean,default:true});
  game.settings.register(NS,DEBUG,{name:'Logs de diagnostic des automatisations',scope:'world',config:true,type:Boolean,default:false});
  game.settings.register(NS,REG,{scope:'world',config:false,type:Array,default:[]});
  game.settings.register(NS,TIMERS,{scope:'world',config:false,type:Array,default:[]});
  install();
});
Hooks.once('ready',()=>{
  game.modules.get(NS).api ??= {};
  game.modules.get(NS).api.generic = Object.freeze({register,unregister,schedule,cancelTimer,listEvents:()=>clone(getRegistry()),listTimers:()=>clone(getTimers()),isLeader:leader});
  if(leader()&&enabled())void dispatch({type:'ready',documentUuid:null,actorUuid:null,itemUuid:null,changedPaths:[],buffState:null});
});
