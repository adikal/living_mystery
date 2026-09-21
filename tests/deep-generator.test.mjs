import test from 'node:test';
import assert from 'node:assert/strict';
import {deepSpec,deepSpecWith,generateDeepCase} from '../dist/deep-generator.mjs';
import {composeDeepCase} from '../dist/llm-composer.mjs';
import {validateCase} from '../dist/casegen.mjs';
import {caseTables,createSession} from '../dist/engine.mjs';
import {acquisitionDomain,searchInvestigation} from '../dist/investigation.mjs';
import {makeCase} from '../dist/cases/bellweather.mjs';

// M4: the deterministic deep generator is the reliable engine; the LLM composer picks who/why + flavor
// over it and always falls back to the certified deterministic deep case.

test('every deterministic deep case is fully certified, genuinely deep, and has a fair inversion',()=>{
 for(let seed=1;seed<=12;seed++){
  const spec=deepSpec(seed);const r=validateCase(spec);
  assert.ok(r.ok,`deep-${seed} certified`);
  assert.ok(r.obligations.discoveryDepth.maxForcedDepth>=5,`deep-${seed}: load-bearing clue >=5 gate-hops deep`);
  assert.ok(r.obligations.inversion.ok,`deep-${seed}: fair inversion`);
  assert.ok(r.obligations.fairPlay.ok,`deep-${seed}: fair-play`);
 }
});

test('deep cases spread across culprits and are reload-stable',()=>{
 const culprits=new Set([...Array(20)].map((_,i)=>deepSpec(i+1).culprit));
 assert.ok(culprits.size>=2,`culprit spread ${[...culprits]}`);
 assert.equal(deepSpec(9).misdirection.seen,deepSpec(9).misdirection.seen,'deterministic');
});

test('deep cases span multiple shapes (time / motive / means anchors), all certified',()=>{
 const shapes=new Set([...Array(30)].map((_,i)=>deepSpec(i+1).shape));
 assert.ok(shapes.size>=3,`expected >=3 deep shapes, saw ${[...shapes]}`);
 for(const shape of ['delayed-poison','buried-motive','hidden-means']){
  assert.ok(shapes.has(shape),`shape ${shape} appears`);
  // find a seed producing this shape and confirm it validates with a fair inversion
  for(let seed=1;seed<=40;seed++){const spec=deepSpec(seed);if(spec.shape===shape){const r=validateCase(spec);assert.ok(r.ok&&r.obligations.inversion.ok,`${shape} certified with fair inversion`);break;}}
 }
});

test('the deep composer uses the LLM who/why and stays certified',async()=>{
 const llm=async()=>JSON.stringify({reasoning:'x',spec:{culprit:'rowan',motive:'eviction'},title:'The Bitter Draught',synopsis:'A death recorded too late.'});
 const r=await composeDeepCase(llm,{seed:3});
 assert.equal(r.source,'llm');
 assert.equal(r.spec.culprit,'rowan');
 assert.equal(r.spec.motive,'eviction');
 assert.ok(r.report.ok,'still fully certified');
 assert.equal(r.flavor.title,'The Bitter Draught');
});

test('the deep composer falls back to a certified deterministic deep case when the model fails',async()=>{
 const r=await composeDeepCase(async()=>'not json',{seed:4,attempts:2});
 assert.equal(r.source,'fallback');
 assert.ok(r.report.ok,'the fallback deep case is certified');
 assert.ok(r.spec.deep);
});

test('generateDeepCase returns a startable deep id',()=>{
 const g=generateDeepCase(11);
 assert.match(g.id,/^deep-\d+$/);
 assert.ok(g.title);
});

test('deep cases carry red-herring fog that is present but load-free (never forced, never blocks the solve)',()=>{
 const FOG=['loveletter','winebill','stoppedclock','muddyboots','tornticket','saltcellar'];
 let sawFog=false;
 for(let seed=1;seed<=8;seed++){
  const spec=deepSpec(seed);
  const rt=caseTables(spec.id),world=createSession(1,spec.id).world;
  const domain=acquisitionDomain(rt,world);
  const fogHere=FOG.filter(id=>rt.CLUES[id]);
  if(fogHere.length){
   sawFog=true;
   assert.ok(domain.length<=30,`domain within the 30-clue bitset budget (was ${domain.length})`);
   // no red herring is forced by any composed module
   const forced=new Set((makeCase(spec).model.modules??[]).flatMap(m=>m.module?.forces?m.module.forces({}):[]));
   for(const id of fogHere)assert.ok(!forced.has(id),`red herring ${id} is not load-bearing`);
   // the case still solves with the fog in place (the route ignores it)
   const sess=createSession(1,spec.id);
   assert.equal(searchInvestigation(sess,rt).status,'route_found',`deep-${seed} solvable despite fog`);
  }
 }
 assert.ok(sawFog,'at least one sampled deep case carried fog');
});
