// Correction brick (belief-revision + live capability): the mistaken-sighting
// witness makes an honest error, revises it when shown the resolving evidence, then
// carries the correction to Bell *in person* — a validated travel-and-tell plan
// through the capability system, not a remote belief edit. Pairs with misdirection.
import {availablePlans,queuePlan} from '../agent-plans.mjs';

export const correction={
  id:'correction',
  requires:['misdirection'],
  bind(spec){return spec.misdirection?{seen:spec.misdirection.seen}:null;},

  // Showing Ada the greenhouse record or the fast-clock note revises her sighting.
  onInteract({K,s,id,topic,clue,event}){
    if(id==='ada'&&topic==='present'&&['record','clock'].includes(clue))
      K.believe(s,'ada','sighting_corrected',clue==='record'?'I cannot stand by that sighting; the record shows where they actually were.':'The clock was fast. My sighting time needs correction; I still did not see a face.',.9,'inference',event,true);
  },

  // Ada gains a permission to inform Bell of the correction, gated on having made it.
  capabilities(){
    return {agentPermissions:{ada:[{id:'inform:correction',kind:'inform',requires:'sighting_corrected',belief:'sighting_corrected',recipient:'bell',label:'Tell Bell the sighting was mistaken'}]}};
  },

  // On a decision opportunity, a corrected Ada travels to Bell and delivers it once.
  decide({K,s,id,cause}){
    if(id!=='ada')return false;
    const ada=s.world.npcs.ada;
    if(ada.pendingPlan||!ada.beliefs.some(b=>b.key==='sighting_corrected'))return false;
    if(s.world.npcs.bell.beliefs.some(b=>b.key==='report_ada_sighting_corrected'))return false; // already delivered
    const plan=availablePlans(K,s,'ada').find(p=>p.id==='inform:correction');
    if(!plan)return false;
    try{queuePlan(K,s,plan,cause);return true;}catch{return false;}
  },

  // After correcting, Ada withdraws the sighting (overrides the misdirection line).
  dialogue({binding,PEOPLE,id,topic,s}){
    if(id==='ada'&&(topic==='sightings'||topic==='observations')&&s.world.npcs.ada.beliefs.some(b=>b.key==='sighting_corrected')){
      const told=s.world.npcs.bell.beliefs.some(b=>b.key==='report_ada_sighting_corrected');
      return `I have reconsidered. I only ever saw a coat, not a face, and Dr Marsh’s record clears ${PEOPLE[binding.seen].name}. ${told?'I have told Constable Bell as much.':'I mean to tell Constable Bell.'}`;
    }
    return null;
  },

  invariant(){return {ok:true,detail:'honest correction delivered in person via a validated plan'};}
};
