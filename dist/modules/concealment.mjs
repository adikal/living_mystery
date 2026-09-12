import {recordKnowledgeSupport} from '../forensics.mjs';
// Concealment brick (live behavioral thread, exercises the capability + Director
// system): once the culprit senses the detective is pressing on the motive
// documents, they fetch the carbon copy they legitimately know about and hide it
// in the vestry drawer. A co-located witness can observe the retrieval. The plan
// runs through agent-plans/admission; the invariant guarantees the concealed item
// is optional (a proof route without it survives), so hiding it never dead-ends.
import {availablePlans,queuePlan} from '../agent-plans.mjs';

export const concealment={
  id:'concealment',
  bind(spec){return spec.culprit?{object:'folio',from:'manor',location:'vestry',to:'drawer'}:null;},

  // The culprit legitimately knows where the incriminating copy is kept.
  prehistory({roles,K,s,record}){
    const e=s.events.find(e=>e.actor===roles.culprit&&e.data.occurrence==='document_observation').id;
    recordKnowledgeSupport(K,s,roles.culprit,'knows_copy_location','The carbon copy of the transfers is kept in Edmund’s study.',e);
    K.believe(s,roles.culprit,'knows_copy_location','The carbon copy of the transfers is kept in Edmund’s study.',.9,'observation',e,true);
  },

  capabilities({roles}){
    return {agentPermissions:{[roles.culprit]:[{
      id:'conceal:folio',requires:'senses_scrutiny',knownBy:'knows_copy_location',
      object:'folio',from:'manor',location:'vestry',to:'drawer',
      label:'Move the carbon copy to the vestry drawer'}]}};
  },

  // Pressing the culprit on the estate documents makes them sense scrutiny.
  onInteract({K,s,id,topic,clue,roles,event}){
    if(id!==roles.culprit)return;
    if(topic==='accounts'||(topic==='present'&&['ledger','folio'].includes(clue)))
      K.believe(s,id,'senses_scrutiny','The detective is pressing on the estate documents.',.9,'inference',event,true);
  },

  // On a decision opportunity, a rattled culprit queues the concealment plan.
  decide({K,s,id,cause,roles}){
    if(id!==roles.culprit)return false;
    const npc=s.world.npcs[id];
    if(npc.pendingPlan||!npc.beliefs.some(b=>b.key==='senses_scrutiny')||s.world.objects.folio!=='manor')return false;
    const plan=availablePlans(K,s,id).find(p=>p.id==='conceal:folio');
    if(!plan)return false;
    try{queuePlan(K,s,plan,cause);return true;}catch{return false;}
  },

  // Coherence: the concealed object must be optional — a route without it survives.
  invariant({runtime}){
    const ok=runtime.CASE.proofRoutes.some(r=>!r.all.includes('folio'));
    return {ok,detail:ok?'a proof route survives without the concealable copy':'hiding the copy would remove the last route'};
  }
};
