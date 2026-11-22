/**
 * PF1AE — native ItemScriptCall daily-rest discovery.
 * A PF1 Item may declare ONE postUse Script Call named PF1AE:rest:daily.
 * No registration macros, item.use(), socket-transmitted JS, or custom
 * privilege escalation. The native rest bridge supplies the event.
 */
const RD_NS="pf1-automation-engine";
const RD_NAME="PF1AE:rest:daily";
const RD_SEEN=new Set();
const rdLeader=()=>[...game.users].filter(u=>u.active&&u.isGM)
  .sort((a,b)=>a.id.localeCompare(b.id))[0]?.id===game.user?.id;
const rdCalls=item=>item?.scriptCalls?.contents??
  (typeof item?.scriptCalls?.values==="function"?[...item.scriptCalls.values()]:
    Array.isArray(item?.scriptCalls)?item.scriptCalls:item?.system?.scriptCalls??[]);
const rdItems=actor=>actor?.items?.contents??
  (typeof actor?.items?.values==="function"?[...actor.items.values()]:
    Array.isArray(actor?.items)?actor.items:[]);
const rdClone=x=>foundry.utils.deepClone(x);
function rdDiscover(actor){
  if(actor?.documentName!=="Actor")return [];
  const found=[];
  for(const item of rdItems(actor)){
    if(item?.documentName!=="Item"||(item.actor??item.parent)?.uuid!==actor.uuid)continue;
    for(const call of rdCalls(item)){
      if(call?.category=== "postUse"&&call?.name===RD_NAME&&
         typeof call.execute==="function"&&(call.id??call._id)){
        found.push({actor,item,call});
      }
    }
  }
  return found;
}
async function rdDispatch(event){
  if(!rdLeader()||game.settings.get(RD_NS,"genericEnabled")!==true)return {skipped:"not-elected-GM"};
  if(event?.type!=="pf1ActorRest"||event.rest?.phase!=="post"||
     event.rest?.restoreDailyUses!==true||!event.rest?.completed||
     typeof event.actorUuid!=="string"||typeof event.rest?.id!=="string")
    return {skipped:"not-daily-rest"};
  const actor=await fromUuid(event.actorUuid);
  if(actor?.documentName!=="Actor"||actor.uuid!==event.actorUuid)
    return {skipped:"actor-unavailable"};
  const marker=actor.uuid+":"+event.rest.id;
  if(RD_SEEN.has(marker))return {skipped:"duplicate-rest"};
  RD_SEEN.add(marker);
  if(RD_SEEN.size>1000)RD_SEEN.delete(RD_SEEN.values().next().value);
  let executed=0,blocked=0;
  const approvals=game.modules.get(RD_NS)?.api?.scriptApprovals;
  for(const {item,call} of rdDiscover(actor)){
    // Validate exact current native source even if the item changed during
    // rest. Secure mode requires individual approval; Trusted Table Mode
    // uses the exact-name/category allowlist from script-approvals.js.
    const authorized=approvals?.check?.(actor,item,call);
    if(!authorized?.approved){
      blocked++;
      console.warn("[PF1AE][Daily rest] Script not approved",{
        actorUuid:actor.uuid,itemUuid:item.uuid,scriptId:call.id??call._id,
        reason:authorized?.reason??"approval service unavailable"});
      continue;
    }
    try{
      const scriptedEvent=Object.freeze(rdClone({
        type:"pf1ActorRest",actorUuid:actor.uuid,itemUuid:item.uuid,
        rest:event.rest
      }));
      // Execute the actual PF1 ItemScriptCall, not the parent Item action.
      const execute=()=>call.execute({action:null},{
        event:scriptedEvent,state:null,
        api:game.modules.get(RD_NS)?.api?.generic
      });
      const defenses=game.modules.get(RD_NS)?.api?.defenseModifiers;
      // Verified rest provenance is available only while PF1AE executes
      // the approved native Script Call from an authenticated rest event.
      if(typeof defenses?._withVerifiedRest==='function')
        await defenses._withVerifiedRest({
          actorUuid:actor.uuid,itemUuid:item.uuid,restId:event.rest.id
        },execute);
      else await execute();
      executed++;
    }catch(error){
      console.error("[PF1AE][Daily rest] Native ItemScriptCall failed",{
        actorUuid:actor.uuid,itemUuid:item.uuid,scriptId:call.id??call._id},error);
    }
  }
  return {executed,blocked,actorUuid:actor.uuid,restId:event.rest.id};
}
Hooks.once("ready",()=>{
  const mod=game.modules.get(RD_NS);
  if(!mod)return;
  mod.api??={};
  mod.api.restDaily=Object.freeze({
    discover:actor=>rdDiscover(actor).map(({item,call})=>({
      itemUuid:item.uuid,scriptId:call.id??call._id,name:call.name
    })),
    _dispatch:rdDispatch
  });
});
