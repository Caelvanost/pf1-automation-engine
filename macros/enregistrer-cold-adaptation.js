/** Macro MJ. Sélectionnez le token du cinétiste sur la scène avant exécution.
 * Les noms sont utilisés seulement pour rechercher les Items ; personnalisez si besoin.
 */
const api = game.modules.get('pf1-combat-automation')?.api?.generic;
if (!api) throw Error('Activez PF1 Combat Automation 1.3.0.');
if (!api.isLeader()) throw Error('Exécuter depuis le client MJ principal actif.');
const actor = canvas.tokens.controlled[0]?.actor;
if (!actor) throw Error('Sélectionnez le token du personnage.');
const cold = actor.items.find(i => i.name === 'Cold Adaptation');
const burn = actor.items.find(i => i.name === 'Burn');
if (!cold || !burn) throw Error('Cold Adaptation ou Burn introuvable : corrigez les noms dans la macro.');
const matching = [...(cold.scriptCalls?.contents ?? cold.scriptCalls?.values?.() ?? cold.system.scriptCalls ?? [])]
 .filter(s => s.category === 'use' && s.name === 'Synchroniser');
if (matching.length !== 1) throw Error(`Attendu un seul script « Synchroniser » (use) ; trouvé : ${matching.length}.`);
const scriptId = matching[0].id ?? matching[0]._id;
const prefix = `pf1ca-${actor.id}-${cold.id}`;
const target = {itemUuid:cold.uuid,scriptId,scriptCategory:'use'};
await api.register({id:`${prefix}-burn`,on:'updateItem',...target,filter:{itemUuid:burn.uuid,properties:['system.uses.value']}});
await api.register({id:`${prefix}-ready`,on:'ready',...target,filter:{}});
ui.notifications.info('Deux surveillances enregistrées pour ce personnage. Rechargez F5 pour tester ready.');
console.log('PF1CA | règles',api.listEvents().filter(r=>r.id.startsWith(prefix)));
