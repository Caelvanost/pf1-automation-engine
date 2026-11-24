/*
 * Bouclier saint — Script Call PF1 natif : APRÈS UTILISATION.
 * L'action native doit être configurée comme ACTION SIMPLE et ne doit
 * consommer aucune charge automatiquement. Ce script débite 2 utilisations
 * d'Imposition des mains et enregistre l'aura après l'action native.
 */
(async()=>{
const sourceItem=typeof item!=="undefined"?item:
 (typeof action!=="undefined"?action?.item:null);
const owner=typeof actor!=="undefined"?actor:sourceItem?.actor;
if(!owner||!sourceItem)throw Error("Bouclier saint : objet ou acteur absent.");
const api=game.modules.get("pf1-automation-engine")?.api?.proximityAuras;
if(!api)throw Error("PF1AE proximityAuras indisponible.");
const key="holy-shield";
if(api.list({sourceItemUuid:sourceItem.uuid}).some(a=>a.key===key))return;
const norm=x=>String(x??"").normalize("NFD")
 .replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const inventory=[...(owner.items?.contents??owner.items?.values?.()??[])];
const paladin=inventory.find(i=>i.type==="class"&&
 (norm(i.system?.tag)==="paladin"||norm(i.name)==="paladin"));
const level=Number(paladin?.system?.level??owner.classes?.paladin?.level??
 owner.system?.classes?.paladin?.level??0);
if(!Number.isInteger(level)||level<4)
 throw Error("Bouclier saint : niveau de paladin insuffisant.");
const shield=inventory.find(i=>i.type==="equipment"&&
 i.system?.equipmentType==="shield"&&i.system?.equipped!==false&&
 i.system?.active!==false);
if(!shield)throw Error("Bouclier saint : bouclier équipé introuvable.");
const base=Number(shield.system?.armor?.base??shield.system?.armor?.value);
const enhance=Number(shield.system?.enh??shield.system?.armor?.enh??0);
if(!Number.isFinite(base)||base<0||!Number.isFinite(enhance)||enhance<0)
 throw Error("Bouclier saint : bonus de bouclier non vérifiable.");
const shieldBonus=Math.floor(base+enhance);
if(shieldBonus<=0)throw Error("Bouclier saint : bonus de bouclier nul.");
const hands=inventory.find(i=>i!==sourceItem&&
 (["layonhands","impositiondesmains"].includes(norm(i.system?.tag))||
 ["layonhands","impositiondesmains"].includes(norm(i.name))));
const charges=Number(hands?.system?.uses?.value);
if(!hands||!Number.isInteger(charges)||charges<2)
 throw Error("Bouclier saint : deux utilisations d'Imposition des mains requises.");
const selected=typeof token!=="undefined"?token?.document??token:null;
const fromUse=typeof actionUse!=="undefined"?
 actionUse?.token?.document??actionUse?.token:null;
const candidates=[fromUse,selected,
 ...[...(canvas?.tokens?.controlled??[])].map(t=>t.document),
 ...[...(canvas?.tokens?.placeables??[])].map(t=>t.document)];
const emit=candidates.find(t=>t?.uuid&&t.actor?.uuid===owner.uuid);
if(!emit)throw Error("Bouclier saint : token émetteur introuvable dans la scène.");
const scene=emit.parent??canvas.scene;
if(!scene?.id)throw Error("Bouclier saint : scène absente.");
const cha=Number(owner.system?.abilities?.cha?.mod);
if(!Number.isFinite(cha))throw Error("Bouclier saint : bonus de Charisme absent.");
const rounds=3+Math.max(0,Math.trunc(cha));
const unit=String(scene.grid?.units??"ft").toLowerCase();
const inFeet=["ft","feet","foot","pieds","pied"].includes(unit);
const length=m=>inFeet?m*3.280839895:m;
const radius=level>=20?6:level>=11?3:null;
const daylight=level>=11;
const data={
 key,sourceItemUuid:sourceItem.uuid,
 emitterActorUuid:owner.uuid,emitterTokenUuid:emit.uuid,
 beneficiaries:{kind:"allies",excludeEmitter:true},
 range:radius===null?{kind:"adjacent"}:{kind:"radius",distance:length(radius)},
 defense:{bonusType:"shield",value:shieldBonus},
 duration:{rounds},
 light:daylight?
 {bright:length(18),dim:length(36)}:
 {bright:length(6),dim:length(12)},
 label:"Bouclier saint — protection divine"
};
// Native PF1 document update is the ONLY debit (exactly two charges).
// If registration fails, compensate only if the charge count is still ours.
await hands.update({"system.uses.value":charges-2});
try{
 await api.register(data);
}catch(error){
 if(Number(hands.system?.uses?.value)===charges-2)
  await hands.update({"system.uses.value":charges});
 throw error;
}
await ChatMessage.create({
 speaker:ChatMessage.getSpeaker({actor:owner,token:emit.object??emit}),
 content:`<p><strong>${owner.name}</strong> lève son bouclier dans un éclat de foi. Une lumière ${daylight?"éclatante":"douce"} rayonne autour de lui, et ses alliés proches sont enveloppés d’une protection sacrée. <em>Bouclier saint : +${shieldBonus} de bouclier, ${rounds} rounds.</em></p>`
});

})().catch(error=>{
 console.error('[PF1AE][HolyShield] Native Script Call',error);
 ui.notifications?.error?.(error.message);
});
