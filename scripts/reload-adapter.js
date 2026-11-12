/**
 * Backward-compatible PF1AE bridge for PF1 Firearms & Reload.
 * No PF1 reload event handlers are installed here.
 */
const OLD_NS="pf1-automation-engine", NEXT_NS="pf1-firearms-and-reload";
Hooks.once("init",()=>{
  // Retain the old world setting for saved data compatibility and rollback.
  game.settings.register(OLD_NS,"reloadEnabled",{
    name:"Legacy reload setting (deprecated)",
    hint:"Reload tracking moved to PF1 Firearms & Reload. This setting is retained only for rollback.",
    scope:"world",config:false,restricted:true,type:Boolean,default:false
  });
});
Hooks.once("ready",()=>{
  const mod=game.modules.get(OLD_NS);
  if(!mod)return;
  mod.api??={};
  // Explicitly signals to the new engine that PF1AE does NOT own reload hooks.
  mod.api.reloadDelegated=true;
  let notified=false;
  const bridge=Object.freeze(new Proxy({},{
    get(_target,key){
      if(!notified){
        notified=true;
        console.warn("[PF1AE] api.reload is deprecated. Use game.modules.get('pf1-firearms-and-reload').api.reload.");
      }
      const next=game.modules.get(NEXT_NS);
      const api=next?.active?next.api?.reload:null;
      const prop=api?.[key];
      return typeof prop==="function"?prop.bind(api):prop;
    },
    has(_target,key){return !!game.modules.get(NEXT_NS)?.api?.reload?.[key];}
  }));
  // Do not capture a stale reload API: the new module may initialize later.
  mod.api.reload=bridge;
});
