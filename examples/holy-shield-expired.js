/*
 * Bouclier saint — Script Call PF1 natif : APRÈS UTILISATION.
 * Nom EXACT du Script Call : PF1AE:aura:expired
 * Il est invoqué par PF1AE à l'expiration, pas par le joueur.
 * Approuver cette exécution côté MJ si Trusted Table Mode est désactivé.
 */
(async()=>{
const expired=typeof event!=="undefined"?event:null;
if(!expired||expired.type!=="proximityAuraExpired"||
 expired.key!=="holy-shield"||expired.reason!=="duration")return;
const owner=typeof actor!=="undefined"?actor:
 (typeof item!=="undefined"?item?.actor:null);
if(!owner||owner.uuid!==expired.emitterActorUuid)return;
const sourceItem=typeof item!=="undefined"?item:null;
if(sourceItem?.uuid!==expired.sourceItemUuid)return;
await ChatMessage.create({
 speaker:ChatMessage.getSpeaker({actor:owner}),
 content:`<p>La lumière sacrée qui émanait du bouclier de <strong>${owner.name}</strong> faiblit puis s’éteint. La protection divine de ses alliés s’estompe : <em>Bouclier saint prend fin.</em></p>`
});

})().catch(error=>{
 console.error('[PF1AE][HolyShield] Native Script Call',error);
 ui.notifications?.error?.(error.message);
});
