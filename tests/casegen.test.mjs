import test from 'node:test';
import assert from 'node:assert/strict';
import {CONFIGS} from '../dist/cases/bellweather-configs.mjs';
import {validateCase,validateAll} from '../dist/casegen.mjs';
import {sampleCases} from '../dist/casegen.mjs';
import {buildSpec} from '../dist/cases/bellweather-configs.mjs';
import {makeCase} from '../dist/cases/bellweather.mjs';
import {createRuntime} from '../dist/engine-runtime.mjs';
import {searchInvestigation} from '../dist/investigation.mjs';

test('Every authored configuration satisfies all four generation obligations',()=>{
 const {ok,reports}=validateAll(CONFIGS);
 assert.equal(reports.length,CONFIGS.length);
 for(const r of reports){
  assert.ok(r.obligations.physical.ok,`${r.spec} physical: ${r.obligations.physical.detail}`);
  assert.ok(r.obligations.epistemic.ok,`${r.spec} epistemic: ${r.obligations.epistemic.detail}`);
  assert.ok(r.obligations.reachability.ok,`${r.spec} reachability: ${r.obligations.reachability.detail}`);
  assert.ok(r.obligations.distinguishability.ok,`${r.spec} distinguishability: ${r.obligations.distinguishability.detail}`);
  assert.ok(r.ok,`${r.spec} overall`);
 }
 assert.ok(ok);
});

// Teeth: the check must fail when discrimination is genuinely absent, even though
// the case still physically solves. Removing the innocents' alibi claims leaves a
// solvable case whose discoverable evidence no longer excludes them.
test('Distinguishability is evidence-driven, not name-driven: removing the alibi claims fails it while the case still solves',()=>{
 const spec=CONFIGS[0];
 const caseModule=makeCase(spec);
 caseModule.model.evidenceClaims.record=[];
 const report=validateCase(spec,{caseModule,runtime:createRuntime(caseModule)});
 assert.ok(report.obligations.physical.ok);
 assert.ok(report.obligations.reachability.ok,'the case still solves without the discoverable alibi');
 assert.equal(report.obligations.distinguishability.ok,false,'no discoverable alibi => not distinguishable');
 assert.equal(report.ok,false);
});

// The discoverable bundle, graded by the real accusation rubric, convicts the
// culprit and no innocent — the discrimination is playable, not just abstract.
test('The discoverable bundle convicts only the true culprit',()=>{
 for(const spec of CONFIGS){
  const runtime=createRuntime(makeCase(spec));
  const witness=searchInvestigation(runtime.createSession(),runtime);
  assert.equal(witness.status,'route_found',`${spec.id} solvable`);
  const accuse=witness.actions.find(a=>a.type==='accuse');
  const play=runtime.createSession();
  for(const action of witness.actions.filter(a=>a.type!=='accuse'))runtime.dispatch(play,action);
  assert.equal(runtime.behavior.checkCase(play,{...accuse,suspect:spec.culprit}).supported,true,`${spec.id} culprit supported`);
  for(const innocent of runtime.SUSPECTS.filter(s=>s!==spec.culprit))
   assert.equal(runtime.behavior.checkCase(play,{...accuse,suspect:innocent}).supported,false,`${spec.id} innocent ${innocent} unsupported`);
 }
});

test('The seeded sampler returns only validated, distinct case specifications',()=>{
 const sampled=sampleCases(7,5);
 assert.equal(sampled.length,5,'sampler filled the request from the validated space');
 const ids=new Set();
 for(const {spec,report} of sampled){
  assert.ok(report.ok,`${spec.id} passes every obligation`);
  for(const o of Object.values(report.obligations))assert.ok(o.ok);
  assert.ok(!ids.has(spec.id),'distinct specifications');ids.add(spec.id);
  // Red-herring invariant: the mistaken sighting always implicates an innocent.
  assert.notEqual(spec.misdirection.seen,spec.culprit);
 }
});

test('Sampling is deterministic in the seed',()=>{
 const a=sampleCases(42,4).map(s=>s.spec.id);
 const b=sampleCases(42,4).map(s=>s.spec.id);
 assert.deepEqual(a,b);
});

test('The sampler rejects contradictory specifications rather than emitting them',()=>{
 // A crime minute before the world start forces a prehistory time reversal.
 const report=validateCase(buildSpec({culprit:'silas',weapon:'seal',motive:'fraud',minute:1201,seen:'rowan'}));
 assert.equal(report.obligations.physical.ok,false);
 assert.equal(report.ok,false);
 // With only that impossible minute available, the sampler yields nothing.
 assert.equal(sampleCases(3,5,{minutes:[1201]}).length,0);
});

test('A generated case resolves lazily, is save/reload-safe, solves, and fails closed on a bad id',async()=>{
 const {generateCase,createSession,dispatch,exportSession,importSession,diagnostics,runtimeFor}=await import('../dist/engine.mjs');
 const {investigateReachability}=await import('../dist/director-turn.mjs');
 const gen=generateCase(11);
 assert.ok(gen&&gen.id.startsWith('gen-'),'generator returns a validated id');
 const s=createSession(17,gen.id);
 assert.equal(s.world.caseId,gen.id);
 assert.equal(JSON.stringify(importSession(exportSession(s)).world),JSON.stringify(s.world),'save/reload safe from the id alone');
 const route=investigateReachability(s);
 assert.equal(route.status,'route_found');
 for(const a of route.actions)dispatch(s,a);
 assert.equal(s.world.status,'solved');
 assert.ok(diagnostics(s).ok);
 assert.throws(()=>runtimeFor('gen-nope-nope-nope-1274-clara'),/Unknown case/);
});
