/*
 * Bouclier saint — Script Call PF1 natif : UTILISATION.
 * Configurer l'action native de la capacité comme ACTION SIMPLE.
 * Ne pas lier cette action aux charges d'Imposition des mains :
 * elles sont débitées UNE SEULE FOIS dans le Script Call après utilisation.
 */
const sourceItem=typeof item!=="undefined"?item:
 (typeof action!=="undefined"?action?.item:null);
const owner=typeof actor!=="undefined"?actor:sourceItem?.actor;
if(!owner||!sourceItem)throw Error("Bouclier saint : acteur ou objet manquant.");
const normalize=x=>String(x??"").normalize("NFD")
 .replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const inventory=[...(owner.items?.contents??owner.items?.values?.()??[])];
const paladinClass=inventory.find(i=>i.type==="class"&&
 (normalize(i.system?.tag)==="paladin"||normalize(i.name)==="paladin"));
const level=Number(paladinClass?.system?.level??owner.classes?.paladin?.level??
 owner.system?.classes?.paladin?.level??0);
if(!Number.isInteger(level)||level<4)
 throw Error("Bouclier saint nécessite au moins 4 niveaux de paladin.");
const shield=inventory.find(i=>i.type==="equipment"&&
 i.system?.equipmentType==="shield"&&i.system?.equipped!==false&&
 i.system?.active!==false);
if(!shield)throw Error("Bouclier saint : aucun bouclier équipé.");
const base=Number(shield.system?.armor?.base??shield.system?.armor?.value);
const enhancement=Number(shield.system?.enh??shield.system?.armor?.enh??0);
if(!Number.isFinite(base)||base<0||!Number.isFinite(enhancement)||enhancement<0)
 throw Error("Bouclier saint : bonus réel du bouclier indisponible.");
const layOnHands=inventory.find(i=>i!==sourceItem&&
 (["layonhands","impositiondesmains"].includes(normalize(i.system?.tag))||
  ["layonhands","impositiondesmains"].includes(normalize(i.name))));
if(!layOnHands||!Number.isInteger(Number(layOnHands.system?.uses?.value))||
 Number(layOnHands.system.uses.value)<2)
 throw Error("Bouclier saint : il faut deux utilisations d'Imposition des mains.");
const service=game.modules.get("pf1-automation-engine")?.api?.proximityAuras;
if(!service)throw Error("PF1AE proximityAuras n'est pas disponible.");
if(service.list({sourceItemUuid:sourceItem.uuid})
 .some(a=>a.key==="holy-shield"))
 throw Error("Bouclier saint est déjà actif : durée et charges inchangées.");
