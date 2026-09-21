// The melting-icicle murder — the first genuinely new object built on the affordance grammar, and a
// classic "the weapon isn't there" case. Affordances: harm(blunt) + marks + vanishes. Because the ice
// blade melts, no weapon is recovered; the method is pinned instead by the casting-mould and meltwater
// the culprit left where the blade was formed, plus a weaponless blunt wound. The base case already sets
// seal -> trace_match:icicle (from spec.weapon), so this mechanism only reframes the evidence, offers the
// method, and declares the mould/meltwater trace load-bearing (forced-insight: remove it and the method
// can no longer be pinned). Expressed as a mechanism so its affordances are validated against the kernel.
import {mechanismModule} from '../mechanism.mjs';

export const icicle=mechanismModule({
 id:'icicle',
 bind:spec=>spec.weapon==='icicle'?{}:null,
 clues:[
  {id:'medical',title:'The medical examination',tags:['Method'],meta:{kind:'Observation'},
   text:()=>`Edmund died of a single blunt blow to the head — yet no weapon lies anywhere in the study. The wound is smooth and cold-rounded, as from a hard object that was carried off or simply melted away.`},
  {id:'fragment',affords:'harm',title:'The weaponless wound',tags:['Method'],meta:{kind:'Physical trace'},
   text:()=>`The blow left no paint, metal or splinter — nothing a seal, a candlestick or a blade would shed. Its clean, cold-smoothed edges are consistent only with a blunt object of ice, since gone.`},
  {id:'seal',affords:'marks',title:'The casting-mould and the meltwater',
   tags:({spec,PEOPLE})=>['Method',PEOPLE[spec.culprit].name],
   meta:({spec})=>({subject:spec.culprit,method:'icicle',kind:'Physical trace'}),
   text:({spec,LOCATIONS,PEOPLE})=>`In ${LOCATIONS[PEOPLE[spec.culprit].home].name}: a shallow zinc casting-mould and a ring of meltwater in the cold-store, where a blade of ice was formed and kept until the meeting. Its keeper is ${PEOPLE[spec.culprit].name}.`}
 ],
 methodOptions:[['icicle','Icicle (melted away)']],
 forces:()=>['seal'],
 synopsis:({CASE})=>`Edmund Vale lay dead of a blunt blow — yet the study held no weapon at all. ${CASE.synopsis}`
});
