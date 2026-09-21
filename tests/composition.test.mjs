import test from 'node:test';
import assert from 'node:assert/strict';
import {moduleFromComposition} from '../dist/composition.mjs';
import {makeCase} from '../dist/cases/bellweather.mjs';
import {buildSpec} from '../dist/cases/bellweather-configs.mjs';

// Phase 2: a composition is pure data; the compiler turns it into the same fact-bearing artifacts a
// hand-authored brick produces. These tests pin the compiler contract with a synthetic composition,
// then assert the two live bricks that were re-expressed as compositions still behave correctly.

test('content: a composition adds clues, typed claims, route membership, method options and placement',()=>{
 const m=moduleFromComposition({
  id:'t',
  clues:[{id:'x',title:'X',text:({spec})=>`hi ${spec.tag}`,tags:['T'],meta:{kind:'Observation'},at:'vestry',object:{label:'L',description:'D'}}],
  claims:[{clue:'x',predicate:'p',value:'v',requires:'y'}],
  routes:{all:['x']},
  methodOptions:[['poison','Tainted decanter']],
  synopsis:({CASE})=>`prefix. ${CASE.synopsis}`
 });
 const CLUES={},OBJECTS={},LOCATIONS={vestry:{objects:[]}},evidenceClaims={},CASE={proofRoutes:[{all:['base']}],methodOptions:[],synopsis:'S'};
 const set=(id,title,text,tags,extra)=>{CLUES[id]={title,text,tags,...extra};};
 m.content({set,CLUES,OBJECTS,LOCATIONS,CASE,evidenceClaims,spec:{tag:'z'},binding:{}});
 assert.equal(CLUES.x.text,'hi z','text thunk resolved with ctx');
 assert.equal(CLUES.x.kind,'Observation');
 assert.deepEqual(evidenceClaims.x,[{predicate:'p',value:'v',requires:'y'}],'typed claim attached');
 assert.ok(CASE.proofRoutes[0].all.includes('x'),'clue appended to the proof route');
 assert.ok(LOCATIONS.vestry.objects.includes('x'),'inspectable object placed at its location');
 assert.equal(OBJECTS.x.clue,'x','object wired to its clue');
 assert.ok(CASE.methodOptions.some(o=>o[0]==='poison'),'method option offered');
 assert.equal(CASE.synopsis,'prefix. S','synopsis composed');
});

test('prehistory: occurrences link to existing occurrence types and to intra-composition ids',()=>{
 const m=moduleFromComposition({
  id:'t',
  occurrences:[
   {id:'o1',actor:({spec})=>spec.who,title:'first',data:{occurrence:'foo'},after:['fatal_action']},
   {id:'o2',actor:'y',title:'second',after:['@o1'],origin:'ck'}
  ]
 });
 const events=[{id:'e1',data:{occurrence:'fatal_action'}}];
 const recorded=[];const record=(actor,title,changes,data,parents)=>{const id='r'+recorded.length;recorded.push({id,actor,title,changes,data,parents});return id;};
 const origins={};const origin=(k,ev)=>{origins[k]=ev;};
 m.prehistory({record,origin,s:{events},spec:{who:'x'},binding:{}});
 assert.equal(recorded[0].actor,'x','actor thunk resolved');
 assert.deepEqual(recorded[0].parents,['e1'],'linked to the existing occurrence type');
 assert.deepEqual(recorded[1].parents,['r0'],'linked to the intra-composition occurrence');
 assert.equal(origins.ck,recorded[1].id,'origin mapped to the producing occurrence id');
});

test('adequacy: the manner-of-death brick is composition-derived and still gates the case',()=>{
 const cm=makeCase(buildSpec({culprit:'silas',weapon:'seal',motive:'fraud',minute:1274,seen:'rowan',manner:'accident'}));
 assert.ok(cm.CLUES.coroner,'the composition produced the coroner clue');
 const cc=cm.model.evidenceClaims.coroner;
 assert.equal(cc.length,1,'one manner_evidence claim compiled');
 assert.equal(cc[0].predicate,'manner_evidence');
 assert.equal(cc[0].value,'murder');
 assert.ok(cm.CASE.proofRoutes.every(r=>r.all.includes('coroner')),'coroner gates every route');
});

test('adequacy: the poisoning brick is composition-derived and overrides the method evidence',()=>{
 const cm=makeCase(buildSpec({culprit:'silas',weapon:'poison',motive:'fraud',minute:1274,seen:'rowan'}));
 assert.match(cm.CLUES.toxicology.text,/administered/i,'the composition added the toxicology finding');
 assert.match(cm.CLUES.seal.text,/tainted decanter/i,'the composition overrode the vessel clue');
 assert.deepEqual(cm.model.evidenceClaims.medical,[],'the death observation carries no time pin (moved to toxicology)');
 assert.ok(cm.CASE.methodOptions.some(o=>o[0]==='poison'),'the composition offered the poison method');
});
