import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMechanism,mechanismModule,mechanismAffordances} from '../dist/mechanism.mjs';
import {makeCase} from '../dist/cases/bellweather.mjs';
import {createRuntime} from '../dist/engine-runtime.mjs';
import {buildSpec} from '../dist/cases/bellweather-configs.mjs';
import {searchInvestigation} from '../dist/investigation.mjs';
import {validateCase,sampleCases} from '../dist/casegen.mjs';

// Stage 2 + 4: a mechanism is an affordance-typed composition; the compiler checks each affordance-
// tagged clue leaves exactly its kernel predicate. The icicle is the first genuinely new object on top.

test('validateMechanism accepts a grammar-consistent mechanism',()=>{
 assert.ok(validateMechanism({id:'ok',clues:[{id:'t',affords:'times'}],claims:[{clue:'t',predicate:'death_time',value:'window'}]}));
});

test('validateMechanism rejects an affordance whose claim is the wrong predicate',()=>{
 assert.throws(()=>validateMechanism({id:'bad',clues:[{id:'t',affords:'times'}],claims:[{clue:'t',predicate:'trace_match',value:'x'}]}),/leaves death_time/);
});

test('validateMechanism rejects an unknown affordance',()=>{
 assert.throws(()=>mechanismModule({id:'bad',clues:[{id:'c',affords:'teleport'}]}),/unknown affordance/);
});

test('mechanismAffordances reports the shape an object exercises',()=>{
 const shape=mechanismAffordances({clues:[{id:'a',affords:'harm'},{id:'b',affords:'marks'},{id:'c'}]});
 assert.deepEqual(shape.sort(),['harm','marks']);
});

const icicleSpec=()=>buildSpec({culprit:'silas',weapon:'icicle',motive:'fraud',minute:1274,seen:'rowan'});
const solve=(cm,rt)=>{const s=rt.createSession();const w=searchInvestigation(s,rt);for(const a of w.actions.filter(a=>a.type!=='accuse'))rt.dispatch(s,a);return {s,ev:s.world.player.evidence.map(e=>e.clue)};};

test('The melting-icicle case validates and the vanished weapon is provable via the meltwater trace',()=>{
 const spec=icicleSpec();
 assert.ok(validateCase(spec).ok,'icicle case passes every obligation');
 const cm=makeCase(spec),rt=createRuntime(cm),B=rt.behavior;
 assert.ok(cm.CASE.methodOptions.some(o=>o[0]==='icicle'),'icicle is an offerable method');
 assert.match(cm.CLUES.medical.text,/no weapon/i,'the scene has no recovered weapon');
 assert.match(cm.CLUES.seal.text,/meltwater|casting-mould/i,'the method evidence is the mould/meltwater trace');
 const {s,ev}=solve(cm,rt);
 assert.equal(B.checkCase(s,{type:'accuse',suspect:'silas',method:'icicle',motive:'fraud',evidence:ev}).status,'supported');
 assert.equal(B.checkCase(s,{type:'accuse',suspect:'silas',method:'candlestick',motive:'fraud',evidence:ev}).status,'contradicted','a solid weapon is refuted by the weaponless wound');
});

test('The meltwater trace is a forced insight: removing it drops support',()=>{
 const r=validateCase(icicleSpec());
 assert.ok(r.obligations.forcedInsight.ok);
 assert.match(r.obligations.forcedInsight.detail,/seal/,'the mould/meltwater trace is load-bearing');
});

test('The seeded sampler produces validated icicle cases',()=>{
 const sampled=sampleCases(3,60);
 assert.ok(sampled.every(c=>c.report.ok),'every sampled case is validated');
 assert.ok(sampled.some(c=>c.spec.weapon==='icicle'),'the sample includes at least one icicle case');
});

test('New objects (scarf, chandelier) validate, are provable, and their insight is forced',()=>{
 for(const [weapon,forced] of [['scarf',/seal/],['chandelier',/rigging/]]){
  const spec=buildSpec({culprit:'silas',weapon,motive:'fraud',minute:1274,seen:'rowan'});
  const r=validateCase(spec);
  assert.ok(r.ok,`${weapon} validates`);
  assert.match(r.obligations.forcedInsight.detail,forced,`${weapon}: insight is load-bearing`);
  const cm=makeCase(spec),rt=createRuntime(cm),B=rt.behavior;
  assert.ok(cm.CASE.methodOptions.some(o=>o[0]===weapon),`${weapon} is offerable`);
  const {s,ev}=solve(cm,rt);
  assert.equal(B.checkCase(s,{type:'accuse',suspect:'silas',method:weapon,motive:'fraud',evidence:ev}).status,'supported',`${weapon} accusation supported`);
  assert.equal(B.checkCase(s,{type:'accuse',suspect:'silas',method:'seal',motive:'fraud',evidence:ev}).status,'contradicted',`a brass seal is refuted for a ${weapon} killing`);
 }
});

test('The catalogue now spans several method shapes in a single sample',()=>{
 const shapes=new Set(sampleCases(13,120).map(c=>c.spec.weapon));
 assert.ok(shapes.size>=4,`expected varied methods, saw ${[...shapes].join(',')}`);
 assert.ok([...shapes].some(w=>['poison','icicle','scarf','chandelier'].includes(w)),'at least one divergent object appears');
});
