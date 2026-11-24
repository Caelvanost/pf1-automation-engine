/*
 * Aura de courage — Script Call NATIF, catégorie « Après Utilisation »
 * Nom EXACT : PF1AE:aura:passive
 * Découverte automatique par PF1AE au chargement/reconnexion (approbation
 * requise si Table de confiance désactivée). Aucune macro manuelle.
 *
 * Cette capacité ne consomme aucune action ni utilisation.
 * Immunité personnelle : configurer l'immunité native PF1 « fear »
 * dans la fiche du paladin (voir docs/passive-save-auras.md).
 */
(async()=>{
  const mod=game.modules.get("pf1-automation-engine");
  const api=mod?.api?.proximityAuras;
  if(!api)throw Error("PF1AE : service proximityAuras indisponible.");
  const source=typeof item!=="undefined"?item:null;
  const owner=typeof actor!=="undefined"?actor:source?.actor;
  if(!source?.uuid||!owner?.uuid)throw Error("Aura de courage : source native introuvable.");
  const validScenes=[
   ...(game.scenes?.active?[game.scenes.active]:[]),
   ...[...(game.scenes?.contents??[])].filter(s=>s!==game.scenes?.active)
  ];
  const available=validScenes.flatMap(scene=>
   [...(scene.tokens?.contents??[])].filter(t=>t.actor?.uuid===owner.uuid));
  const emitter=available[0];
  if(!emitter?.uuid)return; // Sera découvert au placement du token.
  const units=String(emitter.parent?.grid?.units??"ft").toLowerCase();
  const metric=["m","meter","meters","metre","metres","mètre","mètres"].includes(units);
  const feet=["ft","foot","feet","pied","pieds"].includes(units);
  if(!metric&&!feet)throw Error("Aura de courage : unités de grille non reconnues.");
  const distance=metric?3:10; // PF1 : 3 m = 10 ft = deux cases.
  await api.register({
   key:"aura-of-courage",
   sourceItemUuid:source.uuid,
   emitterActorUuid:owner.uuid,
   emitterTokenUuid:emitter.uuid,
   beneficiaries:{kind:"allies",excludeEmitter:true},
   range:{kind:"radius",distance},
   savingThrowBonus:{
    value:4,bonusType:"morale",
    saves:["fort","ref","will"],
    appliesTo:{descriptors:["fear"]}
   },
   lifecycle:{
    mode:"passive",requiresConscious:true,requiresAlive:true,
    minimumClassLevel:{classTag:"paladin",level:3}
   },
   label:"Aura de courage"
  });
})().catch(error=>{
 console.error("[PF1AE][Aura de courage]",error);
 ui.notifications?.warn?.(error.message);
});
