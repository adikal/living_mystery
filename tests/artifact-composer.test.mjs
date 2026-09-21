import test from 'node:test';
import assert from 'node:assert/strict';
import {composeArtifactCase} from '../dist/llm-composer.mjs';
import {expandArtifact} from '../dist/case-artifact.mjs';

// (b): the LLM authors a full deep artifact (a discovery chain of neutral observations gating a forced
// anchor + an inversion); the engine certifies it, repairs, and falls back to a deterministic deep case.

const goodArtifact=()=>JSON.stringify({
 reasoning:'poison hidden behind the washed cup',
 spec:{culprit:'silas',weapon:'poison',motive:'fraud',minute:1274,seen:'rowan',structure:'trace',manner:'overt'},
 observations:[
  {id:'vessel',title:'Rinsed decanter',text:'The study decanter has been rinsed spotless.',at:'manor'},
  {id:'dregs',title:'Discarded dregs',text:'Damp dregs tipped into the compost behind the manor.',at:'manor'}],
 gates:{dregs:['vessel'],toxicology:['dregs']},
 forces:['toxicology'],
 inversion:{anchor:'toxicology',naive:'the recorded time of death is an alibi',reReads:['medical','vessel']},
 title:'The Bitter Hour',synopsis:'A quiet poisoning, its true hour hidden.'});

test('a well-formed LLM artifact is compiled and certified (source: llm-artifact), genuinely deep',async()=>{
 const r=await composeArtifactCase(async()=>goodArtifact(),{seed:5});
 assert.equal(r.source,'llm-artifact');
 assert.ok(r.report.ok,'the LLM-authored artifact passes every obligation');
 assert.ok(r.report.obligations.discoveryDepth.maxForcedDepth>=2,'the anchor is gated >=2 hops deep');
 assert.ok(r.report.obligations.inversion.ok,'fair inversion');
 assert.equal(r.flavor.title,'The Bitter Hour');
});

test('a malformed LLM artifact falls back to a certified deterministic deep case',async()=>{
 const r=await composeArtifactCase(async()=>'not json at all',{seed:6,attempts:2});
 assert.equal(r.source,'fallback');
 assert.ok(r.report.ok,'the fallback deep case is certified');
 assert.ok(r.spec.deep);
});

test('expandArtifact rejects malformed artifacts (guards the LLM surface)',()=>{
 assert.throws(()=>expandArtifact({observations:[{id:'obsx',text:'ok',at:'manor'}]}),/2–6 observations/);
 assert.throws(()=>expandArtifact({observations:[{id:'BAD ID',text:'t',at:'manor'},{id:'obsy',text:'t',at:'manor'}]}),/bad observation id/);
 assert.throws(()=>expandArtifact({observations:[{id:'obsa',text:'t',at:'manor'},{id:'obsb',text:'t',at:'manor'}],inversion:{anchor:'obsa'}}),/no load-bearing/);
 assert.throws(()=>expandArtifact({observations:[{id:'obsa',text:'t',at:'manor'},{id:'obsb',text:'t',at:'manor'}],forces:['obsa']}),/no inversion/);
});
