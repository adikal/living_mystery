import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSpec,specFromId} from '../dist/cases/bellweather-configs.mjs';
import {validateCase,sampleCases} from '../dist/casegen.mjs';
import {makeCase} from '../dist/cases/bellweather.mjs';
import {createRuntime} from '../dist/engine-runtime.mjs';
import {searchInvestigation} from '../dist/investigation.mjs';
import {crimeModel,compileExplanation,enumerateExplanations} from '../dist/forensics.mjs';

const mannerSpec=()=>buildSpec({culprit:'silas',weapon:'seal',motive:'fraud',minute:1274,seen:'rowan',manner:'accident'});
const overtSpec=()=>buildSpec({culprit:'silas',weapon:'seal',motive:'fraud',minute:1274,seen:'rowan'});

test('The forensic model declares dimensions as data; manner appears only for a staged case',()=>{
 const overt=crimeModel(overtSpec()),staged=crimeModel(mannerSpec());
 // Behaviour-preserving: overt keeps exactly the three discrete dimensions + time, with labels.
 assert.deepEqual(Object.keys(overt.variables).sort(),['method','motive','suspect','time']);
 assert.deepEqual(overt.variables.suspect.labels,['clara','rowan','silas']);
 assert.equal(overt.variables.manner,undefined,'no manner dimension for an overt case');
 assert.deepEqual(staged.variables.manner.labels,['murder','accident'],'staged case adds the manner dimension');
 // The generic enumerator ranges over whatever discrete variables are declared.
 const q=compileExplanation(staged,{},[]);
 const rows=enumerateExplanations(q,staged);
 assert.ok(rows.every(r=>['murder','accident'].includes(r.manner)),'explanations carry a manner label');
 assert.ok(new Set(rows.map(r=>r.manner)).size===2,'with no evidence both manners survive');
});

test('A staged-accident case is admissible and its coroner clue is load-bearing on every route',()=>{
 const spec=mannerSpec();
 assert.equal(spec.id,'gen-silas-seal-fraud-1274-rowan-accident');
 assert.equal(specFromId(spec.id)?.id,spec.id,'the -accident id round-trips');
 const report=validateCase(spec);
 assert.ok(report.ok,'all obligations pass: '+Object.entries(report.obligations).filter(([,o])=>!o.ok).map(([k,o])=>`${k}:${o.detail}`).join('; '));
 const {CASE}=makeCase(spec);
 assert.ok(CASE.proofRoutes.length>0&&CASE.proofRoutes.every(r=>r.all.includes('coroner')),'coroner is required on every declared route');
});

test('Manner is an investigative gate: the accusation is blocked until murder is established',()=>{
 const spec=mannerSpec(),cm=makeCase(spec),rt=createRuntime(cm),B=rt.behavior;
 const s=rt.createSession();
 const witness=searchInvestigation(s,rt);
 assert.equal(witness.status,'route_found');
 for(const a of witness.actions.filter(a=>a.type!=='accuse'))rt.dispatch(s,a);
 const acquired=s.world.player.evidence.map(e=>e.clue);
 assert.ok(acquired.includes('coroner'),'the winning route acquires the coroner finding');
 const accuse=sel=>B.checkCase(s,{type:'accuse',suspect:spec.culprit,method:spec.weapon,motive:spec.motive,evidence:sel});
 const gated=accuse(acquired.filter(c=>c!=='coroner'));
 assert.equal(gated.status,'gated');
 assert.equal(gated.supported,false,'without the coroner finding the death still reads as an accident');
 const solved=accuse(acquired);
 assert.equal(solved.status,'supported');
 assert.equal(solved.supported,true);
 assert.equal(solved.alternatives.length,1,'once murder is established, exactly one explanation remains');
});

test('An overt case is unaffected: no manner variable, no gate',()=>{
 const spec=overtSpec(),cm=makeCase(spec),rt=createRuntime(cm),B=rt.behavior;
 assert.ok(!cm.CASE.proofRoutes.some(r=>r.all.includes('coroner')),'no coroner clue in an overt case');
 const s=rt.createSession();
 const witness=searchInvestigation(s,rt);
 for(const a of witness.actions.filter(a=>a.type!=='accuse'))rt.dispatch(s,a);
 const acquired=s.world.player.evidence.map(e=>e.clue);
 const verdict=B.checkCase(s,{type:'accuse',suspect:spec.culprit,method:spec.weapon,motive:spec.motive,evidence:acquired});
 assert.equal(verdict.supported,true);
 assert.notEqual(verdict.status,'gated','overt cases never gate on manner');
});

test('The seeded sampler produces validated manner-of-death cases',()=>{
 const sampled=sampleCases(7,10);
 assert.ok(sampled.every(c=>c.report.ok),'every sampled case is validated');
 const manner=sampled.filter(c=>c.spec.manner==='accident');
 assert.ok(manner.length>0,'the sample includes at least one staged-accident case');
 assert.ok(manner.every(c=>c.spec.id.includes('-accident')),'manner cases carry the -accident id marker');
});

test('Staged-suicide is a second manner flavor: validated, id round-trips, and gated like accident',()=>{
 const spec=buildSpec({culprit:'silas',weapon:'knife',motive:'fraud',minute:1274,seen:'rowan',manner:'suicide'});
 assert.equal(spec.id,'gen-silas-knife-fraud-1274-rowan-suicide');
 assert.equal(specFromId(spec.id)?.manner,'suicide');
 assert.ok(validateCase(spec).ok,'staged-suicide validates');
 const cm=makeCase(spec),rt=createRuntime(cm),B=rt.behavior;
 assert.ok(cm.CASE.proofRoutes.every(r=>r.all.includes('coroner')),'coroner gates every route');
 const s=rt.createSession(),witness=searchInvestigation(s,rt);
 for(const a of witness.actions.filter(a=>a.type!=='accuse'))rt.dispatch(s,a);
 const acquired=s.world.player.evidence.map(e=>e.clue);
 const accuse=sel=>B.checkCase(s,{type:'accuse',suspect:spec.culprit,method:spec.weapon,motive:spec.motive,evidence:sel});
 assert.equal(accuse(acquired.filter(c=>c!=='coroner')).status,'gated','without the coroner finding it still reads as suicide');
 assert.equal(accuse(acquired).status,'supported','establishing murder unlocks the accusation');
});

test('Coherence guardrail: an incoherent manner×method combination is rejected by the oracle',()=>{
 // A chandelier already IS a fall; staging it as an accidental fall is a logical contradiction.
 const bad=validateCase(buildSpec({culprit:'silas',weapon:'chandelier',motive:'fraud',minute:1274,seen:'rowan',manner:'accident'}));
 assert.equal(bad.ok,false,'chandelier + staged-fall is rejected');
 assert.equal(bad.obligations.modules.ok,false,'the manner brick invariant catches it');
 assert.match(bad.obligations.modules.detail,/cannot stage a fall method/);
 // Poison has no wound to stage as self-inflicted.
 assert.equal(validateCase(buildSpec({culprit:'silas',weapon:'poison',motive:'fraud',minute:1274,seen:'rowan',manner:'suicide'})).ok,false,'poison + staged-suicide is rejected');
});
