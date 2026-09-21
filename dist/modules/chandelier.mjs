// The rigged chandelier — a set-and-leave killing (harm(fall) + times + marks). The culprit sabotages
// the fixing and leaves; the chandelier falls later, so "who was in the room when it fell" is the wrong
// question. Like the poisoning, the fatal window is when the killer ACTED (rigged it), not when Edmund
// died: the sabotage evidence fixes that window (times -> death_time, grounded on the examination), while
// the culprit's filing tool ties them to the rigging. Both the timing insight and the tool trace are
// load-bearing.
import {mechanismModule} from '../mechanism.mjs';

export const chandelier=mechanismModule({
 id:'chandelier',
 bind:spec=>spec.weapon==='chandelier'?{}:null,
 clues:[
  {id:'medical',title:'The medical examination',tags:['Method'],meta:{kind:'Observation'},
   text:()=>`Edmund was crushed beneath the study chandelier. Death itself says nothing about who was present — a rigged fall needs no one in the room when it comes down.`},
  {id:'rigging',affords:'times',title:'The sabotaged fixing',tags:['Time','Method'],meta:{kind:'Observation'},at:'surgery',
   object:{label:'The sabotaged fixing',description:'Examine the chain fixing and when it was tampered'},
   text:({spec,time})=>`The chain link was filed almost through and set to give way under strain. The bright, un-oxidised cut and the disturbed dust date the tampering to about ${time(spec.minute)} — that is when the killer acted, whatever hour the fixture finally fell.`},
  {id:'fragment',affords:'harm',title:'The failed chain',tags:['Method'],meta:{kind:'Physical trace'},
   text:()=>`The break is no metal fatigue: the link bears fresh, deliberate file-marks. The fall was engineered, not accidental.`},
  {id:'seal',affords:'marks',title:'The culprit’s file',
   tags:({spec,PEOPLE})=>['Method',PEOPLE[spec.culprit].name],
   meta:({spec})=>({subject:spec.culprit,method:'chandelier',kind:'Physical trace'}),
   text:({spec,LOCATIONS,PEOPLE})=>`A file kept in ${LOCATIONS[PEOPLE[spec.culprit].home].name} carries brass swarf matching the chain link, and its teeth match the cut marks. Its keeper is ${PEOPLE[spec.culprit].name}.`}
 ],
 resetClaims:['medical'],
 claims:[{clue:'rigging',predicate:'death_time',value:'window',key:'death',subject:'edmund',interval:({spec})=>({start:spec.minute-4,end:spec.minute+4})}],
 origins:{rigging:'examination'},
 routes:{all:['rigging']},
 forces:()=>['rigging','seal'],
 methodOptions:[['chandelier','Rigged chandelier (fall)']],
 synopsis:({CASE})=>`Edmund Vale lay crushed beneath the fallen study chandelier — at first glance a dreadful accident. ${CASE.synopsis}`
});
