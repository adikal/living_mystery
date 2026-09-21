// The silk-scarf strangling — an ordinary object turned weapon (harm(asphyxiant) + marks). No blunt or
// bladed trace; death is by ligature, and the method is pinned by soft broad-band fibres matching a
// scarf the culprit kept. Same forensic skeleton as any traced weapon (the base sets seal ->
// trace_match:scarf from spec.weapon); this mechanism reframes the evidence and declares the fibre trace
// load-bearing.
import {mechanismModule} from '../mechanism.mjs';

export const scarf=mechanismModule({
 id:'scarf',
 bind:spec=>spec.weapon==='scarf'?{}:null,
 clues:[
  {id:'medical',title:'The medical examination',tags:['Method'],meta:{kind:'Observation'},
   text:()=>`Edmund was strangled — the throat shows the broad, soft impression of a ligature, not a cord or wire. There was no blow and no blade.`},
  {id:'fragment',affords:'harm',title:'The ligature impression',tags:['Method'],meta:{kind:'Physical trace'},
   text:()=>`The mark is wide and even, left by a smooth woven band drawn tight — a length of silk, not rope. Fine fibres were recovered from the skin.`},
  {id:'seal',affords:'marks',title:'The silk scarf',
   tags:({spec,PEOPLE})=>['Method',PEOPLE[spec.culprit].name],
   meta:({spec})=>({subject:spec.culprit,method:'scarf',kind:'Physical trace'}),
   text:({spec,LOCATIONS,PEOPLE})=>`A silk scarf kept in ${LOCATIONS[PEOPLE[spec.culprit].home].name} shows strained, distorted weave and sheds fibres identical to those taken from Edmund’s throat. Its keeper is ${PEOPLE[spec.culprit].name}.`}
 ],
 methodOptions:[['scarf','Silk scarf (ligature)']],
 forces:()=>['seal'],
 synopsis:({CASE})=>`Edmund Vale was strangled at his desk — no weapon, only the marks at his throat. ${CASE.synopsis}`
});
