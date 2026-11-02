/** Exemple MJ: enregistrer une surveillance déclarative sur une capacité PF1. */
if (!game.user.isGM) throw new Error('Macro réservée au MJ.');
const module = game.modules.get('pf1-combat-automation');
if (!module?.active) throw new Error('Activez PF1 Automation Engine.');
const actor = canvas.tokens.controlled[0]?.actor;
if (!actor) throw new Error('Sélectionnez un token.');
const source = actor.items.getName('NOM_CAPACITE_SCRIPT');
const observed = actor.items.getName('NOM_OBJET_SURVEILLE');
if (!source || !observed) throw new Error('Adaptez les deux noms de capacités dans la macro.');
await source.setFlag('pf1-combat-automation', 'automations', [
  { id: 'resource-change', on: 'updateItem', scriptCategory: 'use',
    scriptId: 'Synchroniser', filter: { itemUuid: observed.uuid, properties: ['system.uses.value'] } },
  { id: 'world-ready', on: 'ready', scriptCategory: 'use', scriptId: 'Synchroniser' }
]);
const count = await module.api.discovery.approveItem(source.uuid);
ui.notifications.info(`${count} automatisation(s) approuvée(s) pour ${source.name}. Rechargez F5 pour vérifier ready.`);
