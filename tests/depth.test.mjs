import test from 'node:test';
import assert from 'node:assert/strict';
import {checkFairPlay,validateCase,discoveryDepth,checkDiscoveryDepth} from '../dist/casegen.mjs';
import {acquisitionDomain} from '../dist/investigation.mjs';
import {buildSpec} from '../dist/cases/bellweather-configs.mjs';

// M1: fair-play — every inference premise (a clue another claim `requires`) must be acquirable.

test('fair-play holds for a normal generated case (its requires-chains are all acquirable)',()=>{
 const r=validateCase(buildSpec({culprit:'silas',weapon:'seal',motive:'fraud',minute:1274,seen:'rowan',structure:'clockwork'}));
 assert.ok(r.obligations.fairPlay.ok,r.obligations.fairPlay.detail);
});

test('fair-play has teeth: an inference standing on an unreachable premise is rejected',()=>{
 const acquirable={
  baseWorld:()=>({flags:{},objects:{}}),
  model:{LOCATIONS:{room:{objects:['deskObj']}},OBJECTS:{deskObj:{clue:'desk'}},CASE:{id:'mock'},testimonyClues:[],modules:[],
   evidenceClaims:{good:[{predicate:'trace_match',value:'v',requires:'desk'}]}}};
 assert.ok(checkFairPlay(acquirable).ok,'a premise that has an inspectable object is fair');
 const unreachable={...acquirable,model:{...acquirable.model,
   evidenceClaims:{bad:[{predicate:'trace_match',value:'v',requires:'ghost'}]}}};
 const r=checkFairPlay(unreachable);
 assert.equal(r.ok,false);
 assert.match(r.detail,/ghost/);
});

test('fair-play credits discovery-gate closure: a gated premise is fair if its own prerequisites are earnable',()=>{
 const gated={
  baseWorld:()=>({flags:{lockedObjects:['hiddenObj']},objects:{}}),
  model:{LOCATIONS:{room:{objects:['keyObj','hiddenObj']}},OBJECTS:{keyObj:{clue:'key'},hiddenObj:{clue:'hidden'}},CASE:{id:'mock'},testimonyClues:[],
   modules:[{module:{artifact:{gates:[{clue:'hidden',requires:['key']}]}}}],
   evidenceClaims:{concl:[{predicate:'trace_match',value:'v',requires:'hidden'}]}}};
 assert.ok(checkFairPlay(gated).ok,'a locked premise is fair when its gate prerequisite (key) is acquirable');
});

test('acquisitionDomain includes a gated clue with its gate prerequisites as requires (reachability v2)',()=>{
 const model={LOCATIONS:{room:{objects:['keyObj','hiddenObj']}},OBJECTS:{keyObj:{clue:'key'},hiddenObj:{clue:'hidden'}},CASE:{id:'mock'},gates:{hiddenObj:['key']}};
 const world={flags:{lockedObjects:['hiddenObj']},objects:{}};
 const dom=acquisitionDomain(model,world);
 const hidden=dom.find(d=>d.clue==='hidden');
 assert.ok(hidden,'the gated clue is reachable (not permanently skipped)');
 assert.deepEqual(hidden.requires,['key'],'gated behind its prerequisite');
 assert.ok(dom.find(d=>d.clue==='key'),'the key clue is directly acquirable');
});

test('discovery-depth measures gate-hops and only enforces a declared target',()=>{
 const cm=gates=>({model:{gates,modules:[{module:{forces:()=>['deep']}}]}});
 const chain={key:[],mid:['key'],deep:['mid']};
 assert.equal(discoveryDepth(cm(chain)).maxForcedDepth,2,'deep sits 2 gate-hops behind key->mid->deep');
 assert.ok(checkDiscoveryDepth(cm(chain),{}).ok,'no target => informational pass');
 assert.ok(checkDiscoveryDepth(cm(chain),{depthTarget:2}).ok,'meets the target');
 assert.equal(checkDiscoveryDepth(cm({}),{depthTarget:2}).ok,false,'a flat case fails a declared depth target (teeth)');
});

import {emptyArtifact,addObservation,gate,interpolate,forceClues,declareInversion,pipe} from '../dist/operators.mjs';

test('operators deepen an artifact: add, gate, interpolate a hidden hop, force, declare inversion',()=>{
 let a=emptyArtifact('deep');
 a=addObservation(a,{id:'tox',title:'Toxicology',text:'A slow dose.',at:'surgery',claim:{predicate:'death_time',value:'window'}},{onRoute:true});
 a=addObservation(a,{id:'vessel',title:'Washed vessel',text:'A too-clean decanter.',at:'manor'});
 a=gate(a,'tox',['vessel']);                       // tox hidden until the vessel is noticed
 assert.deepEqual(a.observations.find(o=>o.id==='tox').gate.requires,['vessel']);
 assert.ok(a.routes.all.includes('tox'));
 // interpolate a hidden intermediate "dregs" between vessel and tox -> deepen the chain by one hop
 a=interpolate(a,{id:'dregs',title:'Discarded dregs',text:'Leaves in the compost.',at:'manor',after:['vessel'],decisive:'tox'});
 assert.deepEqual(a.observations.find(o=>o.id==='dregs').gate.requires,['vessel']);
 assert.deepEqual(a.observations.find(o=>o.id==='tox').gate.requires,['dregs'],'tox is now gated behind the interpolated dregs');
 a=forceClues(a,'tox');a=declareInversion(a,{anchor:'tox',naive:'the death-time alibi clears the culprit',reReads:['vessel']});
 assert.deepEqual(a.forces,['tox']);
 assert.equal(a.inversion.anchor,'tox');
});

test('inversion obligation is N/A (passes) for cases that declare no inversion',()=>{
 const r=validateCase(buildSpec({culprit:'silas',weapon:'seal',motive:'fraud',minute:1274,seen:'rowan'}));
 assert.ok(r.obligations.inversion.ok);
 assert.match(r.obligations.inversion.detail,/no inversion declared/);
});
