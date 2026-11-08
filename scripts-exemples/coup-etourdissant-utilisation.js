/**
 * Script Call PF1 v11.11 — Coup étourdissant / Utilisation (EXEMPLE COMPLET).
 * Installer uniquement sur l'action « Utiliser » de la capacité.
 * IMPORTANT : configurez la capacité pour déduire AUTOMATIQUEMENT 1 utilisation
 * lors de l'usage natif de cette action (autoDeductCharges=true), et configurez
 * l'action « Sauvegarde » avec coût 0. Ne doublez pas les dépenses.
 * 
 * Déluge : NE PAS appeler ce Script Call pour ajouter une frappe. Depuis
 * Déluge de coups, enregistrer la règle attackOutcomes pour l'indice exact
 * de la frappe choisie, sans rappeler attackItem.use().
 */
await (async () => {
  const ENGINE_ID = 'pf1-automation-engine';
  // À ADAPTER À VOTRE PERSONNAGE (nom exact de l'objet mains nues).
  const UNARMED_ITEM_NAME = 'Attaque à mains nues';
  const USE_ACTION_NAME = 'Utiliser';
  const SAVE_ACTION_NAME = 'Sauvegarde';
  const ATTACK_INDEX = 0; // Indice zéro de la frappe dans la carte native.
  const getActions = (it) => [...(it.actions?.values?.() ?? [])];
  const choose = (it, name) => getActions(it).filter(a => a.name === name);
  const api = game.modules.get(ENGINE_ID)?.api;
  const monk = actor ?? item.actor;
  const stunningFist = item;
  if (!api?.attackOutcomes || !api?.saveOutcomes) {
    throw new Error('PF1 Automation Engine v1.14.0 requis.');
  }
  if (!monk?.uuid || stunningFist?.actor?.uuid !== monk.uuid) {
    throw new Error('Coup étourdissant doit appartenir au moine.');
  }
  const saveActions = choose(stunningFist, SAVE_ACTION_NAME);
  const useActions = choose(stunningFist, USE_ACTION_NAME);
  if (saveActions.length !== 1 || useActions.length !== 1) {
    throw new Error('Configurer exactement une action Utiliser et une action Sauvegarde.');
  }
  const saveAction = saveActions[0];
  const useAction = useActions[0];
  // L'action de sauvegarde repasse éventuellement par le Script Call « Utilisation ».
  // En ce cas elle ne doit pas relancer l'attaque, ni la consommation du pouvoir.
  if (typeof action === 'undefined' || !action?.id) {
    throw new Error('Contexte Action PF1 absent : arrêt sécurisé pour éviter la récursion.');
  }
  if (action.id === saveAction.id) return;
  if (action.id !== useAction.id) return;
  const targets = [...game.user.targets];
  if (targets.length !== 1 || !targets[0].actor?.uuid) {
    throw new Error('Cibler exactement une créature avant Coup étourdissant.');
  }
  const target = targets[0].actor;
  const attackItems = [...monk.items].filter(it => it.name === UNARMED_ITEM_NAME);
  if (attackItems.length !== 1) {
    throw new Error('Objet d’attaque à mains nues absent ou ambigu : ' + UNARMED_ITEM_NAME);
  }
  const attackItem = attackItems[0];
  const attackActions = getActions(attackItem).filter(a => a.hasAttack);
  if (attackActions.length !== 1) {
    throw new Error('Choisir explicitement une seule action d’attaque à mains nues.');
  }
  const attackAction = attackActions[0];
  if (!stunningFist.autoDeductCharges || !stunningFist.hasFiniteCharges) {
    throw new Error('Configurer Coup étourdissant : 1 utilisation déduite par la fonction native PF1.');
  }
  const combat = game.combat;
  if (!combat?.started) {
    throw new Error('Le Script Call proposé nécessite un combat actif pour la limite de 1/round.');
  }
  const attempted = await monk.getFlag(ENGINE_ID, 'stunningFistLastAttempt');
  const roundId = `${combat.id}:${combat.round}`;
  if (attempted === roundId) {
    throw new Error('Coup étourdissant a déjà été tenté pendant ce round.');
  }
  // La dépense de la tentative est gérée par l'action « Utiliser » native PF1,
  // avant le lancement de l'attaque. Le flag empêche une seconde déclaration.
  await monk.setFlag(ENGINE_ID, 'stunningFistLastAttempt', roundId);
  const key = 'sf-' + foundry.utils.randomID(14);
  const config = {
    actor: monk,
    key,
    groupKey: 'stunning-fist',
    sourceItemUuid: attackItem.uuid,
    sourceActionId: attackAction.id,
    attackIndex: ATTACK_INDEX,
    targets: [target.uuid],
    onDamageApplied: {
      type: 'triggerItemAction',
      itemUuid: stunningFist.uuid,
      actionId: saveAction.id,
      saveOutcome: {
        key, // unique pour chaque frappe enregistrée
        groupKey: 'stunning-fist',
        sourceItemUuid: stunningFist.uuid,
        sourceActionId: saveAction.id,
        targets: [target.uuid],
        onFailure: {
          type: 'linkedBuff',
          name: `Étourdi — ${monk.name}`,
          img: stunningFist.img,
          statusId: 'stunned',
          duration: { rounds: 1, expire: 'sourceTurnStart' }
        }
      }
    }
  };
  // Enregistrer avant l'attaque pour qu'une application des dégâts très rapide
  // ne soit pas perdue sur un autre client.
  await api.attackOutcomes.register(config);
  try {
    const attackUse = await attackItem.use({actionId: attackAction.id});
    const card = attackUse?.shared?.message;
    if (!card?.id) {
      throw new Error('PF1 n’a pas renvoyé le ChatMessage de l’attaque : liaison impossible.');
    }
    await api.attackOutcomes.bindAttack({actor: monk, key, sourceMessageId: card.id});
    console.debug('[PF1AE][StunningFist] Attaque liée', {key, cardId:card.id, target:target.uuid});
  } catch (err) {
    // Attention : ne pas rendre la tentative après une attaque manquée/annulée.
    await api.attackOutcomes.unregister({actor:monk,key}).catch(console.error);
    throw err;
  }
})();