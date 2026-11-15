# Utility Shot — Stop Bleeding (exemple)

Foundry v13.351 / PF1 11.11 / PF1AE v1.27.0.

Cet exemple conserve le Script Call « Utility Shot - Prepare » de Zéphir, qui
enregistre déjà world.utilityShotPending, ainsi que le jet natif de son pistolet.
Il ne modifie pas le traitement des munitions de PF1 Firearms & Reload.

IMPORTANT : le Script Call exact de Zéphir n'est pas stocké dans ce dépôt.
Le script d'attaque ci-dessous est un exemple autonome pour Stop Bleeding,
pas un remplacement garanti sans régression du Script Call actuel qui traite
également Blast Lock et Scoot Unattended Object.

## 1. Utility Shot - Prepare

Catégorie : Utilisation.

Aucune adaptation nécessaire : conserver intégralement la version déjà
fonctionnelle, qui prépare le choix dans world.utilityShotPending avant le
tir natif. L'API Chat Actions intervient seulement après le jet.

## 2. Script Call PF1AE:bootstrap (GM)

Catégorie : Basculer. Nom exact : PF1AE:bootstrap.

Créer un objet « Service Utility Shot » sur un acteur contrôlé exclusivement
par le MJ. Placer ce script sur cet objet et l'activer pour le faire
enregistrer dans le registre Bootstrap. Après F5, le gestionnaire sera
réinstallé sur le client MJ.

~~~js
const api=game.modules.get("pf1-automation-engine")?.api;
if(!api?.bootstrap||!api?.chatActions){
  throw Error("PF1AE Bootstrap / Chat Actions unavailable.");
}

if(typeof bootstrap!=='undefined'&&bootstrap?.restoring){
  if(!game.user.isGM)throw Error("This bootstrap must run on a GM client.");
  const zephyr=[...game.actors.contents].find(a=>a.name==="Zéphir");
  const utilityShot=zephyr?.items?.find(i=>i.name==="Utility Shot");
  if(!utilityShot){
    throw Error("Zéphir's Utility Shot Item not found.");
  }

  const unregister=api.chatActions.registerHandler(
    "utility-shot.stop-bleeding",
    async ({actor:target,requester})=>{
      const bleeding=target.statuses?.has("bleed")===true||
        target.system?.conditions?.bleed===true;
      if(!bleeding){
        return {ok:false,reason:"The selected character is not bleeding."};
      }
      if(typeof target.setCondition!=="function"){
        return {ok:false,reason:"PF1 setCondition API unavailable."};
      }
      await target.setCondition("bleed",false);
      return {ok:true,
        confirmation:requester.name+" stopped bleeding on "+target.name+"."};
    },
    {sourceItemUuid:utilityShot.uuid}
  );
  bootstrap.onCleanup(unregister);
  return;
}

if(typeof state!=='undefined'&&state===true){
  await api.bootstrap.register({actor,item,key:"zephyr-utility-chat"});
}else if(typeof state!=='undefined'&&state===false){
  await api.bootstrap.unregister({actor,item,key:"zephyr-utility-chat"});
}
~~~

Le MJ seul peut exécuter le gestionnaire enregistré ; les joueurs
déclenchent une demande authentifiée à travers l'acteur dont ils sont OWNER.

## 3. Script Call PF1AE:attack:resolved (publication)

Catégorie : Après Utilisation. Nom exact : PF1AE:attack:resolved.

Cet exemple ne touche pas aux autres modes d'Utility Shot. Intégrer ce
traitement dans le Script Call existant AVANT qu'il efface le flag Pending.
Ne pas créer deux Script Calls de ce nom sur un même Item : PF1AE refuse
les souscriptions ambiguës.

~~~js
const actorPF=typeof actor!=='undefined'?actor:(typeof item!=='undefined'?item?.actor:null);
const api=game.modules.get("pf1-automation-engine")?.api;
if(actorPF&&api?.chatActions&&typeof event!=="undefined"&&event?.type==="attack:resolved"){
  const pending=actorPF.getFlag("world","utilityShotPending");
  const choice=typeof pending==="string"?pending:
    pending?.choice??pending?.option??pending?.mode??pending?.type??null;
  const mode=String(choice??"").trim().toLowerCase().replace(/[_-]/g," ");
  if(mode==="stop bleeding"||mode==="arrêter le saignement"){
    const utilityShot=[...actorPF.items].find(i=>i.name==="Utility Shot");
    const weaponUuid=pending?.weaponUuid??pending?.firearmUuid??null;
    const correctWeapon=!weaponUuid||weaponUuid===event.itemUuid;
    const attackKey=String(event.sourceMessageId??event.roll?.id??"");
    const alreadyCreated=attackKey&&
      actorPF.getFlag("world","utilityShotStopBleedingCard")===attackKey;

    if(utilityShot&&correctWeapon&&!alreadyCreated){
      await api.chatActions.create({
        actor:actorPF,
        sourceItem:utilityShot,
        title:"Utility Shot — Stop Bleeding",
        content:"Sélectionnez un personnage qui saigne avec un clic gauche sur "+
          "son token, puis cliquez sur le bouton.",
        buttons:[{
          id:"stop-bleeding",
          label:"Arrêter le saignement",
          icon:"fa-solid fa-heart-pulse",
          once:true,
          handlerKey:"utility-shot.stop-bleeding",
          targetMode:"controlled",
          permission:"OWNER",
          exactOne:true
        }]
      });
      if(attackKey){
        await actorPF.setFlag("world","utilityShotStopBleedingCard",attackKey);
      }
    }
  }
}
~~~

Il n'y a aucune logique de tir, de consommation de munitions ou
d'attaqueIndex dans ces scripts. En attaque à outrance, la correspondance
avec un jet reste choisie manuellement comme dans l'automatisation de Zéphir.
Blast Lock et Scoot restent dans le script actuel.

## 4. Vérification

Tester un joueur propriétaire et un MJ, un non-propriétaire, aucun token,
plusieurs tokens, un acteur sans Bleed, un acteur avec Bleed, deux clics
concurrents, puis F5 et reconnexion. Un refus avant mutation ne consomme
pas le bouton. Une exception en cours de mutation laisse un état pending
et demande une vérification par le MJ avant reset.

L'adjacence est laissée à l'appréciation du MJ.
