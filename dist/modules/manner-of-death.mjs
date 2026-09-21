// Manner-of-death, re-expressed as a declarative COMPOSITION (Phase 2) and compiled into a brick.
// The culprit stages the scene so the death first reads as non-criminal — a fall (accident) or
// self-inflicted (suicide). Before an accusation is accepted the player must establish murder via Dr
// Marsh's finding that the injury contradicts the staged appearance; the gate lives in assessAccusation.
// This file now carries only DATA + the per-manner language; the fact-bearing behaviour is produced by
// the shared composition compiler, proving the schema is adequate for a real, live brick.
import {moduleFromComposition} from '../composition.mjs';
import {OBJECTS} from '../objects.mjs';

const MANNER={
  accident:{scene:'found at the foot of the study steps — at first glance, a fall',stage:'arranges the study to look like a fall',find:'finds the injury inconsistent with a fall',
    coroner:'The wound’s depth and angle are inconsistent with a fall on the study steps. Whatever the scene was arranged to suggest, this injury was deliberately inflicted — Edmund was killed.',
    marsh:'I examined Edmund myself. The scene was made to look like a fall, but the wound tells another story — the angle and depth are wrong for it. This was no accident.'},
  suicide:{scene:'found slumped at his desk — at first glance, by his own hand',stage:'arranges the scene to look self-inflicted',find:'finds the wound could not be self-inflicted',
    coroner:'The angle and force of the wound make it impossible to self-inflict, and the weapon was not in Edmund’s hand. Whatever the scene was arranged to suggest, he was killed by another.',
    marsh:'I examined Edmund myself. It was staged to look self-inflicted, but the angle and force are impossible by his own hand. This was murder.'}
};

export const mannerOfDeath=moduleFromComposition({
  id:'manner-of-death',
  bind:spec=>MANNER[spec.manner]?{apparent:spec.manner}:null,
  clues:[{
    id:'coroner',
    title:'Dr Marsh’s finding on the death',
    text:({binding})=>MANNER[binding.apparent].coroner,
    tags:['Manner of death'],
    meta:{kind:'Observation'},
    at:'surgery',
    object:{label:'Dr Marsh’s manner finding',description:'Read the coroner’s conclusion on the death'}
  }],
  claims:[{clue:'coroner',predicate:'manner_evidence',value:'murder'}],
  routes:{all:['coroner']},
  forces:()=>['coroner'],
  synopsis:({binding,CASE})=>`Edmund Vale was ${MANNER[binding.apparent].scene}. ${CASE.synopsis}`,
  occurrences:[
    {id:'stage',actor:({spec})=>spec.culprit,
     title:({spec,K,binding})=>`${K.model.PEOPLE[spec.culprit].name} ${MANNER[binding.apparent].stage}`,
     changes:({binding})=>({'flags.apparentManner':binding.apparent}),
     data:({binding})=>({occurrence:'stage_scene',apparent:binding.apparent,location:'manor'}),
     after:['fatal_action']},
    {id:'finding',actor:'iris',
     title:({binding})=>`Dr Marsh ${MANNER[binding.apparent].find}`,
     data:({binding})=>({occurrence:'manner_finding',manner:'murder',apparent:binding.apparent}),
     after:['examination','@stage'],
     origin:'coroner'}
  ],
  dialogue:({binding,id,topic,clue})=>(id==='iris'&&(topic==='night'||topic==='sightings'||(topic==='present'&&clue==='coroner')))?MANNER[binding.apparent].marsh:null,
  invariant:({runtime,spec})=>{
    // Coherence guardrail: the staging is WOUND-based — an accident stages a fall (blunt injury) and a
    // suicide stages a self-inflicted wound (sharp injury). It is a logical contradiction to stage a
    // poisoning, a strangling, or a fall (chandelier) this way, so reject those combinations.
    const harm=(OBJECTS[spec.weapon]?.affords||[]).find(a=>a.a==='harm')?.kind;
    const fit=spec.manner==='accident'?harm==='blunt':spec.manner==='suicide'?harm==='sharp':true;
    if(!fit)return {ok:false,detail:`manner "${spec.manner}" cannot stage a ${harm} method (accident stages a blunt fall; suicide stages a sharp self-wound)`};
    const routes=runtime.CASE.proofRoutes;const ok=routes.length>0&&routes.every(r=>r.all.includes('coroner'));
    return {ok,detail:ok?'coroner finding gates every proof route (murder must be established first)':'coroner finding is not required on every proof route'};
  }
});
