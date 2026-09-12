import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {buildSpec,specFromId,CONFIGS} from '../dist/cases/bellweather-configs.mjs';
import {makeCase} from '../dist/cases/bellweather.mjs';
import {createRuntime} from '../dist/engine-runtime.mjs';
import {compileCrimeHistory,validateKnowledge,validateEvidence,compileExplanation,enumerateExplanations,excludeExplanation} from '../dist/forensics.mjs';
import {validateCase,validateCaseWithSolver} from '../dist/casegen.mjs';
import {searchInvestigation} from '../dist/investigation.mjs';
import {evaluate} from '../dist/symbolic.mjs';
import {verifyDirectorTurn} from '../dist/director-turn.mjs';
const spec=structure=>buildSpec({culprit:'silas',weapon:'seal',motive:'fraud',minute:1274,seen:'rowan',structure});
const solve=q=>{
 const p=spawnSync('.venv/bin/python',['-c','import json,sys; from server.symbolic_solver import solve; print(json.dumps(solve(json.load(sys.stdin))))'],{input:JSON.stringify(q),encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);
};
const skip=spawnSync('.venv/bin/python',['-c','import z3']).status!==0?'Install server/requirements-solver.txt':false;

test('Structured source checks reject existing but unrelated sources and invented content',()=>{
 const m=makeCase(spec('trace')),r=createRuntime(m),s=r.createSession();
 assert.equal(validateKnowledge(s,m.PEOPLE).ok,true);
 const wrong=structuredClone(s);wrong.world.npcs.clara.beliefs[0].sourceId=s.world.npcs.ada.beliefs[0].sourceId;
 assert.equal(validateKnowledge(wrong,m.PEOPLE).ok,false);
 assert.throws(()=>r.kernel.believe(s,'ada','invented','I saw the killing.',1,'observation',s.world.npcs.ada.beliefs[0].sourceId,true),/not supported/);
 const poisoned=structuredClone(m.model.evidenceClaims);poisoned.record[0].subject='silas';
 assert.equal(validateEvidence(s,poisoned).ok,false);
 const fake=structuredClone(s);fake.world.flags.evidenceOrigins.medical=fake.world.flags.evidenceOrigins.clock;
 assert.equal(validateEvidence(fake,m.model.evidenceClaims).ok,false);
});

test('Clock correction does not claim to establish identity or whereabouts',()=>{
 const r=createRuntime(makeCase(spec('trace'))),s=r.createSession();
 r.dispatch(s,{type:'move',to:'inn'});r.dispatch(s,{type:'inspect',object:'clock'});r.dispatch(s,{type:'present',person:'ada',clue:'clock'});
 assert.match(s.world.npcs.ada.beliefs.find(b=>b.key==='sighting_corrected').text,/still did not see a face/);
});

test('Each structural variant has independently replayable routes and reload-safe identity',()=>{
 for(const structure of ['trace','cleanup','clockwork']){
  const sp=spec(structure),report=validateCase(sp);
  assert.equal(report.ok,true,JSON.stringify(report.obligations));assert.deepEqual(specFromId(sp.id),sp);
  assert.ok(report.obligations.routes.results.length>=2);
  const r=createRuntime(makeCase(sp)),s=r.createSession();
  if(structure==='cleanup')assert.equal(s.world.flags.weaponWiped,true);
  for(const route of r.CASE.proofRoutes){
   const play=r.createSession(),w=searchInvestigation(play,{...r,CASE:{...r.CASE,proofRoutes:[route]}});
   assert.equal(w.status,'route_found',route.id);
   for(const a of w.actions)r.dispatch(play,a);
   assert.equal(play.world.status,'solved');assert.deepEqual(r.importSession(r.exportSession(play)),play);
  }
 }
});

test('Missing calibration leaves timing contradictory; the independent route bypasses it',()=>{
 const r=createRuntime(makeCase(spec('clockwork'))),m=r.kernel.model;
 const q=ids=>compileExplanation(m.forensics,m.evidenceClaims,ids);
 const without=enumerateExplanations(q(['medical','fragment','seal','watch','ledger']),m.forensics);
 assert.equal(without.length,3,'uncalibrated watch cannot identify the killer');
 assert.equal(enumerateExplanations(q(['medical','fragment','seal','watch','clock','ledger']),m.forensics).length,1);
 const wrong=structuredClone(m.evidenceClaims);wrong.clock[0].value=0;
 assert.equal(enumerateExplanations(compileExplanation(m.forensics,wrong,['medical','fragment','seal','watch','clock','ledger']),m.forensics).length,0);
});

test('Accusation checks selected acquired evidence and all competing dimensions',()=>{
 const r=createRuntime(makeCase(spec('trace'))),s=r.createSession(),w=searchInvestigation(s,r);
 assert.equal(r.checkCase(s,w.actions.at(-1)).status,'ambiguous','unacquired IDs cannot constrain explanations');
 for(const a of w.actions.slice(0,-1))r.dispatch(s,a);
 const a=w.actions.at(-1),verdict=r.checkCase(s,a);
 assert.equal(verdict.supported,true);assert.equal(verdict.alternatives.length,1);
 assert.equal(r.checkCase(s,{...a,method:'knife'}).status,'contradicted');
 assert.equal(r.checkCase(s,{...a,evidence:a.evidence.filter(id=>id!=='ledger')}).status,'ambiguous');
 const missing=r.checkCase(s,{...a,evidence:['medical']});
 assert.doesNotMatch(missing.feedback,/carbon copy|damaged meeting object|Silas|vestry/);
 const wrongTruth={...r.CASE,culprit:'rowan',method:'knife'};Object.assign(r.CASE,wrongTruth);
 assert.equal(r.checkCase(s,a).supported,true,'hidden solution labels are not the grader');
});

test('Real Z3 and finite evaluation agree; physical tampering is unsatisfiable',{skip},async()=>{
 for(const structure of ['trace','cleanup','clockwork']){
  const sp=spec(structure),report=await validateCaseWithSolver(sp,{solve});
  assert.equal(report.ok,true,JSON.stringify(report));
  assert.deepEqual(report.solver.checks.map(c=>c.result.status),['sat','sat','unsat']);
 }
 const r=createRuntime(makeCase(spec('trace'))),s=r.createSession(),q=compileCrimeHistory(s,r);
 q.constraints.push({id:'impossible_time',label:'Death after the evening',formula:{op:'ge',args:[{var:'death'},1440]},sources:[]});
 assert.equal(solve(q).status,'unsat');
 const tampered=structuredClone(s),fatal=tampered.events.find(e=>e.data.occurrence==='fatal_action');fatal.data.deathMinute+=1;
 assert.equal(solve(compileCrimeHistory(tampered,r)).status,'unsat');
});

test('No solver, timeout and fabricated witnesses cannot receive Z3 certification',async()=>{
 assert.equal((await validateCaseWithSolver(spec('trace'))).ok,false);
 for(const solve of [()=>({status:'unknown'}),()=>{throw Error('offline');},()=>({status:'sat',witness:{}})])assert.equal((await validateCaseWithSolver(spec('trace'),{solve})).ok,false);
});

test('Director verifies history and excludes competing explanations with AI off',{skip},async()=>{
 const r=createRuntime(makeCase(CONFIGS[0])),base=r.createSession(),trial=structuredClone(base);
 for(const a of searchInvestigation(trial,r).actions)r.dispatch(trial,a);
 const kinds=[];
 const result=await verifyDirectorTurn(base,trial,{timeoutMs:60000,fetchImpl:async(url,options)=>{
  const {queries}=JSON.parse(options.body);kinds.push(...queries.map(q=>q.query.kind));
  return {ok:true,json:async()=>({results:queries.map(q=>({...q,result:solve(q.query)}))})};
 }});
 assert.equal(result.status,'verified',result.reason);assert.ok(kinds.includes('crime-history'));assert.equal(kinds.filter(k=>k==='crime-explanation').length,2);
});

test('Failed history verification is never reused as a certificate',async()=>{
 const {commitDirectedTurn}=await import('../dist/director-turn.mjs');
 const r=createRuntime(makeCase(CONFIGS[0])),s=r.createSession();let historyChecks=0;
 const fetchImpl=async(url,options)=>{
  const {queries}=JSON.parse(options.body);historyChecks+=queries.filter(q=>q.query.kind==='crime-history').length;
  return {ok:true,json:async()=>({results:queries.map(q=>({...q,result:{status:'unsat'}}))})};
 };
 for(let attempt=0;attempt<2;attempt++){
  const trial=structuredClone(s);r.dispatch(trial,{type:'look'});
  const result=await commitDirectedTurn(s,trial,{fetchImpl});assert.equal(result.status,'reject');
 }
 assert.equal(historyChecks,2);
});

test('An empty future observation interval cannot certify an entrance watch',()=>{
 const r=createRuntime(makeCase(spec('cleanup'))),s=r.createSession();
 const gate=s.events.find(e=>e.data.occurrence==='entrance_watch');gate.data.start=5000;gate.data.end=5010;
 const q=compileCrimeHistory(s,r);
 assert.ok(q.constraints.some(c=>evaluate(c.formula,{death:s.world.flags.deathMinute})===false));
});

test('Generated identifiers cannot request unbounded prehistory execution',()=>{
 assert.equal(specFromId('gen-silas-seal-fraud-999999999999-rowan'),null);
 assert.equal(specFromId('gen-silas-seal-fraud-01274-rowan'),null);
 assert.throws(()=>buildSpec({culprit:'silas',weapon:'seal',motive:'fraud',minute:1440,seen:'rowan'}),/Invalid/);
 assert.equal(validateCase({id:'invalid'}).ok,false);
});

test('A null solver response is unresolved rather than an uncaught exception',async()=>{
 const result=await validateCaseWithSolver(spec('trace'),{solve:async()=>null});
 assert.equal(result.ok,false);assert.equal(result.solver.status,'unresolved');
});
