import test from 'node:test';
import assert from 'node:assert/strict';
import {artifactModule} from '../dist/case-artifact.mjs';

// M0: an artifact is data; artifactModule compiles it into a brick via the composition compiler, and
// carries depth metadata (gates, inversion, inference-hop depth) for the later obligations.

const sample=()=>artifactModule({
 id:'deep-fragment',
 observations:[
  {id:'oil',title:'A film on the sill',text:'A faint oil film on the east windowsill.',tags:['Trace'],meta:{kind:'Physical trace'},at:'manor',object:{label:'the windowsill',description:'Look at the sill'}},
  {id:'toxA',title:'The toxicology note',text:'A slow alkaloid; hours between dose and collapse.',tags:['Time'],meta:{kind:'Observation'},at:'surgery',
   claim:{predicate:'death_time',value:'window',key:'death',subject:'edmund',interval:{start:1270,end:1278}},gate:{requires:'oil'}},
 ],
 origins:{toxA:'examination'},
 routes:{all:['toxA']},
 forces:['toxA'],
 inversion:{anchor:'toxA',naive:'cleared by the death-time alibi',reReads:['oil']},
});

test('artifactModule compiles observations into clues + typed claims',()=>{
 const m=sample();
 const CLUES={},OBJECTS={},LOCATIONS={manor:{objects:[]},surgery:{objects:[]}},evidenceClaims={},CASE={proofRoutes:[{all:['medical']}],methodOptions:[]};
 const set=(id,title,text,tags,extra)=>{CLUES[id]={title,text,tags,...extra};};
 m.content({set,CLUES,OBJECTS,LOCATIONS,CASE,evidenceClaims,spec:{},binding:{}});
 assert.equal(CLUES.oil.text,'A faint oil film on the east windowsill.','neutral observation text (announces nothing)');
 assert.deepEqual(evidenceClaims.toxA?.[0]?.predicate,'death_time','the observation carries its derived claim');
 assert.ok(LOCATIONS.surgery.objects.includes('toxA'),'placed at its location');
 assert.ok(CASE.proofRoutes[0].all.includes('toxA'),'on the proof route');
});

test('artifactModule exposes forces and depth metadata (gates, inversion, hops)',()=>{
 const m=sample();
 assert.deepEqual(m.forces({}),['toxA'],'load-bearing observation declared');
 assert.deepEqual(m.artifact.gates,[{clue:'toxA',requires:['oil']}],'discovery gate captured');
 assert.equal(m.artifact.inversion.anchor,'toxA','inversion anchor captured');
 assert.equal(m.artifact.hops.oil,1,'a claimless observation is one hop');
});

test('artifactModule grounds the moved claim via origins in prehistory',()=>{
 const m=sample();
 const events=[{id:'e1',data:{occurrence:'examination'}}];
 const origins={};const origin=(k,ev)=>{origins[k]=ev;};
 const record=()=>{throw Error('no new occurrences in this fragment');};
 m.prehistory({record,origin,s:{events},spec:{},binding:{}});
 assert.equal(origins.toxA,'e1','the toxicology claim is grounded on the examination occurrence');
});
