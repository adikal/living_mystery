import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCase} from '../dist/cases/bellweather.mjs';
import {createRuntime} from '../dist/engine-runtime.mjs';
import {buildSpec} from '../dist/cases/bellweather-configs.mjs';
import {searchInvestigation} from '../dist/investigation.mjs';
import {validateCase,sampleCases} from '../dist/casegen.mjs';

const poisonSpec=()=>buildSpec({culprit:'silas',weapon:'poison',motive:'fraud',minute:1274,seen:'rowan'});
const solve=(cm,rt)=>{const s=rt.createSession();const w=searchInvestigation(s,rt);for(const a of w.actions.filter(a=>a.type!=='accuse'))rt.dispatch(s,a);return {s,ev:s.world.player.evidence.map(e=>e.clue)};};

test('A poisoning case validates and the poison method is offerable and provable',()=>{
 const spec=poisonSpec();
 assert.equal(spec.id,'gen-silas-poison-fraud-1274-rowan');
 assert.ok(validateCase(spec).ok,'poison case passes every generation obligation');
 const cm=makeCase(spec),rt=createRuntime(cm),B=rt.behavior;
 assert.ok(cm.CASE.methodOptions.some(o=>o[0]==='poison'),'poison is an offerable method');
 const {s,ev}=solve(cm,rt);
 assert.equal(B.checkCase(s,{type:'accuse',suspect:'silas',method:'poison',motive:'fraud',evidence:ev}).status,'supported','poison accusation is accepted');
 assert.equal(B.checkCase(s,{type:'accuse',suspect:'silas',method:'knife',motive:'fraud',evidence:ev}).status,'contradicted','a bladed method is refuted by the toxicology');
});

test('The signature divergence is a delayed death made load-bearing via toxicology',()=>{
 const cm=makeCase(poisonSpec());
 assert.ok(cm.CLUES.toxicology,'a toxicology finding is produced');
 assert.match(cm.CLUES.toxicology.text,/administ/i,'toxicology fixes the administration window');
 assert.deepEqual(cm.model.evidenceClaims.medical,[],'the death observation carries no time pin');
 assert.match(cm.CLUES.seal.text,/tainted decanter/i,'the method evidence is the tainted vessel, not a blunt trace');
});

test('The toxicology insight is forced: removing it drops the accusation’s support',()=>{
 const spec=poisonSpec();
 const r=validateCase(spec);
 assert.ok(r.obligations.forcedInsight.ok,'the forced-insight obligation holds');
 assert.match(r.obligations.forcedInsight.detail,/toxicology/,'toxicology is the load-bearing insight');
 // Teeth: solve, then re-grade the winning bundle without toxicology — it must lose support.
 const cm=makeCase(spec),rt=createRuntime(cm),B=rt.behavior;
 const {s,ev}=solve(cm,rt);
 assert.equal(B.checkCase(s,{type:'accuse',suspect:'silas',method:'poison',motive:'fraud',evidence:ev}).status,'supported','supported with toxicology');
 assert.notEqual(B.checkCase(s,{type:'accuse',suspect:'silas',method:'poison',motive:'fraud',evidence:ev.filter(c=>c!=='toxicology')}).status,'supported','not supported without it');
});

test('Poison is spec-local: a non-poison case offers no poison method',()=>{
 const cm=makeCase(buildSpec({culprit:'silas',weapon:'seal',motive:'fraud',minute:1274,seen:'rowan'}));
 assert.ok(!cm.CASE.methodOptions.some(o=>o[0]==='poison'),'poison is not offered when the method is a physical weapon');
});

test('The seeded sampler produces validated poisoning cases',()=>{
 const sampled=sampleCases(5,40);
 assert.ok(sampled.every(c=>c.report.ok),'every sampled case is validated');
 assert.ok(sampled.some(c=>c.spec.weapon==='poison'),'the sample includes at least one poisoning case');
});
