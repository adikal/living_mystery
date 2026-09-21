// Poisoning, re-expressed as a declarative COMPOSITION (Phase 2/4). A divergent crime shape where the
// fatal act and the death are separated in time — and the separation is now LOAD-BEARING, not flavor:
//   * The medical examination observes death at a LATER time and carries no forensic time pin.
//   * A toxicology finding pins the fatal window to when the lethal dose was administered (spec.minute),
//     which is the window the records (delivery, greenhouse alibi) are read against.
// So the player cannot establish opportunity from "when Edmund died"; they must reach the toxicology
// insight. The forced-insight obligation checks exactly this (removing toxicology drops the accusation's
// support). Method is pinned by the same trace_match/crime_method predicates as any weapon (residue +
// the tainted vessel). Unlike manner-of-death this OVERRIDES clues and MOVES a claim (resetClaims).
import {mechanismModule} from '../mechanism.mjs';

export const poisoning=mechanismModule({
  id:'poisoning',
  bind:spec=>spec.weapon==='poison'?{}:null,
  clues:[
    {id:'medical',title:'The medical examination',tags:['Method'],meta:{kind:'Observation'},
     text:()=>`Edmund was found dead at his desk — no wound, no sign of a struggle. The examination alone cannot say when he was attacked, only that he was poisoned.`},
    {id:'toxicology',affords:'times',title:'The toxicology finding',tags:['Time','Method'],meta:{kind:'Observation'},at:'surgery',
     object:{label:'The toxicology finding',description:'Read the analysis of the dose and its timing'},
     text:({spec,time})=>`Analysis identifies a lethal dose of a bitter alkaloid and, from how far it had metabolised, fixes when it was administered at about ${time(spec.minute)}. That administration window — not the moment he was found — is when the killer acted, and it is what the records must be read against.`},
    {id:'fragment',affords:'transfer',title:'The residue beneath the desk',tags:['Method'],meta:{kind:'Physical trace'},
     text:({spec})=>`A bitter residue under the desk matches the dregs in the ${spec.weaponName}. It is consistent with the alkaloid the toxicology identified in Edmund.`},
    {id:'seal',affords:'transfer',title:'The tainted vessel',
     tags:({spec,PEOPLE})=>['Method',PEOPLE[spec.culprit].name],
     meta:({spec})=>({subject:spec.culprit,method:'poison',kind:'Physical trace'}),
     text:({spec,LOCATIONS,PEOPLE})=>`The ${spec.weaponName} kept in ${LOCATIONS[PEOPLE[spec.culprit].home].name} holds dregs of the same alkaloid found in the residue and in Edmund. Its keeper is ${PEOPLE[spec.culprit].name}.`}
  ],
  // Move the fatal-window pin off the (misleading) death observation onto the toxicology finding, and
  // make toxicology load-bearing on every route.
  resetClaims:['medical'],
  claims:[{clue:'toxicology',predicate:'death_time',value:'window',key:'death',subject:'edmund',interval:({spec})=>({start:spec.minute-4,end:spec.minute+4})}],
  origins:{toxicology:'examination'},
  routes:{all:['toxicology']},
  forces:()=>['toxicology'],
  methodOptions:[['poison','Tainted decanter']],
  synopsis:({CASE})=>`Edmund Vale was found dead at his desk — no wound, no struggle. ${CASE.synopsis}`,
  invariant:({runtime})=>{const ok=runtime.CASE.methodOptions.some(o=>o[0]==='poison');return {ok,detail:ok?'poison is an offerable method for this case':'poison method option is missing'};}
});
