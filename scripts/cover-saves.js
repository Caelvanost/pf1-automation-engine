/**
 * PF1AE — native, source-bound Reflex cover modifier.
 * Only an explicitly reviewed, persistent ChatMessage cover selection can
 * affect a PF1 roll: pre-save hook appends bonus BEFORE the native d20 roll.
 * No parallel save roll, permanent actor bonus, or damage change.
 */
const CS_NS='pf1-automation-engine';
const CS_FLAG='coverReflexSelections';
let CS_LAST=null;
const CS_HANDLED=new WeakSet();
const csEnabled=()=>game.modules.get(CS_NS)?.active===true&&
 game.settings.get(CS_NS,'genericEnabled')===true;
const csMessage=ref=>{
 if(!ref||typeof ref!=='string')return null;
 const id=ref.startsWith('ChatMessage.')?ref.slice('ChatMessage.'.length):ref;
 return game.messages?.get?.(id)??null;
};
const csKey=x=>typeof x==='string'&&x.length>0&&x.length<350;
function csReport(status,extra={}){
 CS_LAST={status,...extra};
 try{if(game.settings.get(CS_NS,'genericDebug'))console.debug('[PF1AE][CoverReflex]',CS_LAST)}
 catch(_){}
 return CS_LAST;
}
function csSelection(selection){
 if(!selection||typeof selection!=='object'||
    !['none','partial','normal','soft','improved','total'].includes(selection.type)||
    typeof selection.reflexProtected!=='boolean'||
    typeof selection.spreadBypasses!=='boolean')throw Error('Invalid explicit cover decision');
 return {type:selection.type,reflexProtected:selection.reflexProtected,
  spreadBypasses:selection.spreadBypasses};
}
async function csSetManual({message,defenderActor,selection}={}){
 if(!csEnabled())throw Error('Cover service disabled');
 if(message?.documentName!=='ChatMessage'||
    defenderActor?.documentName!=='Actor')throw Error('Native source message and defender required');
 if(!game.user?.isGM&&
    defenderActor.testUserPermission?.(game.user,'OWNER')!==true)
  throw Error('Defender owner or GM required');
 const info=game.modules.get(CS_NS)?.api?.saveContext?.fromMessage?.(message);
 if(!info||info.saveType!=='ref')throw Error('Source message does not request a Reflex save');
 const checked=csSelection(selection);
 const stored=message.getFlag?.(CS_NS,CS_FLAG)??{};
 const next={...stored,[defenderActor.uuid]:checked};
 await message.setFlag(CS_NS,CS_FLAG,next);
 return {messageId:message.id,defenderUuid:defenderActor.uuid,...checked};
}
function csBeforeSave(actor,options,saveId){
 if(!csEnabled()||saveId!=='ref'||!options||typeof options!=='object')return;
 if(CS_HANDLED.has(options))return;
 const api=game.modules.get(CS_NS)?.api;
 const provenance=api?.saveContext?._fromNativeSaveOptions?.(actor,saveId,options);
 if(!csKey(provenance?.sourceMessageId)){
  csReport('source-unknown');return;
 }
 const message=game.messages?.get?.(provenance.sourceMessageId);
 if(!message){csReport('message-missing');return}
 const selection=message.getFlag?.(CS_NS,CS_FLAG)?.[actor.uuid];
 if(!selection){csReport('no-explicit-selection');return}
 let cover;
 try{cover=api?.coverDetection?.manual?.(csSelection(selection))}
 catch(error){csReport('invalid-selection',{reason:String(error?.message??error)});return}
 if(cover?.status!=='manual'){csReport('cover-unknown');return}
 if(cover.type==='total'){csReport('total-cover-manual-adjudication');return}
 const bonus=cover.reflexBonus;
 if(!Number.isSafeInteger(bonus)||bonus<=0){
  csReport('not-applicable',{type:cover.type});return;
 }
 const current=options.bonus??'';
 if(typeof current!=='string'&&typeof current!=='number'){
  csReport('native-bonus-unsupported');return;
 }
 // A native or third-party explicitly listed cover part is authoritative.
 // Never inject a second cover modifier even if we cannot parse its amount.
 if(/\[(?:PF1AE Cover|Cover|Abri|Abri normal|Abri partiel)\]/i.test(String(current))){
  csReport('native-cover-already-present');return;
 }
 const part=String(bonus)+'['+
  (String(game.i18n?.lang??'en').toLowerCase().startsWith('fr')?'Abri':'Cover')+']';
 const before=String(current).trim();
 options.bonus=before?before+' + '+part:part;
 CS_HANDLED.add(options);
 csReport('native-pre-save-applied',{sourceMessageId:message.id,defenderUuid:actor.uuid,
  type:cover.type,bonus,improvedCoverEvasion:cover.improvedCoverEvasion,
  source:'manual'});
}
Hooks.once('init',()=>{
 Hooks.on('pf1PreActorRollSave',csBeforeSave);
});
Hooks.once('ready',()=>{
 const mod=game.modules.get(CS_NS);if(!mod)return;
 mod.api??={};
 mod.api.coverSaves=Object.freeze({
  setManual:csSetManual,lastDiagnostic:()=>CS_LAST?{...CS_LAST}:null
 });
});
