import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCase} from '../dist/cases/bellweather.mjs';
import {createRuntime} from '../dist/engine-runtime.mjs';
import {buildSpec,specFromId,PROTECTOR} from '../dist/cases/bellweather-configs.mjs';
import {findContradictions} from '../dist/claims.mjs';
import {validateCase,sampleCases} from '../dist/casegen.mjs';

// A collusion case: the culprit's protector actively lies to give them a false alibi. It is a second,
// social lie layered on the physical solve — caught by the contradiction engine and broken like any lie.
const colludeSpec=()=>buildSpec({culprit:'rowan',weapon:'knife',motive:'eviction',minute:1314,seen:'clara',collusion:true});

test('Collusion is gated: it only arises for a culprit who has a protector',()=>{
 assert.throws(()=>buildSpec({culprit:'silas',weapon:'seal',motive:'fraud',minute:1274,seen:'rowan',collusion:true}),/Invalid spec/);
 const spec=colludeSpec();
 assert.equal(spec.collusion,true);
 assert.equal(spec.id,'gen-rowan-knife-eviction-1314-clara-collusion');
 assert.equal(specFromId(spec.id)?.collusion,true,'collusion round-trips through the id');
 const cm=makeCase(spec);
 assert.equal(cm.model.personas[PROTECTOR.rowan].stance,'shielding-ally','the protector is a shielding ally');
 assert.equal(cm.model.personas.silas.stance,'truthful','a non-protector stays truthful');
});

test('A colluding ally is still a solvable, validated case (the lie is social, not a physical hole)',()=>{
 assert.ok(validateCase(colludeSpec()).ok);
});

test('The ally’s false alibi for the culprit is caught as a contradiction and clears when the record is presented',()=>{
 const cm=makeCase(colludeSpec()),rt=createRuntime(cm),cat=cm.model.evidenceClaims;
 const s=rt.createSession();
 rt.dispatch(s,{type:'move',to:'vestry'});
 rt.dispatch(s,{type:'inspect',object:'delivery'}); // receipt: the culprit (rowan) was at the manor
 rt.dispatch(s,{type:'move',to:'manor'}); // confront the ally where she is
 assert.equal(findContradictions(s,cat).length,0,'no contradiction before the ally speaks');
 rt.dispatch(s,{type:'ask',person:'clara',topic:'night'}); // clara: "rowan was with me at the greenhouse"
 const caught=findContradictions(s,cat);
 assert.equal(caught.length,1,'the ally’s false alibi for the culprit conflicts with the record');
 assert.ok(caught.some(r=>r.left.subject==='rowan'||r.right.subject==='rowan'),'the conflict is about the culprit’s whereabouts');
 rt.dispatch(s,{type:'present',person:'clara',clue:'delivery',tone:'private'});
 assert.ok(s.world.npcs.clara.beliefs.some(b=>b.key==='alibi_broken'),'the ally concedes the cover story');
 assert.equal(findContradictions(s,cat).length,0,'the concession supersedes the lie and clears the board');
});

test('Without collusion the same protector stays truthful and tells no alibi lie',()=>{
 const cm=makeCase(buildSpec({culprit:'rowan',weapon:'knife',motive:'eviction',minute:1314,seen:'clara'}));
 assert.equal(cm.model.personas.clara.stance,'truthful');
 const rt=createRuntime(cm),cat=cm.model.evidenceClaims,s=rt.createSession();
 rt.dispatch(s,{type:'move',to:'vestry'});
 rt.dispatch(s,{type:'inspect',object:'delivery'});
 rt.dispatch(s,{type:'move',to:'manor'});
 rt.dispatch(s,{type:'ask',person:'clara',topic:'night'});
 assert.equal(findContradictions(s,cat).length,0,'a non-colluding protector introduces no contradiction');
});

test('The seeded sampler produces at least one validated collusion case',()=>{
 const sampled=sampleCases(11,40);
 assert.ok(sampled.every(c=>c.report.ok),'every sampled case is validated');
 const collusion=sampled.filter(c=>c.spec.collusion);
 assert.ok(collusion.length>0,'the sample includes at least one collusion case');
 assert.ok(collusion.every(c=>PROTECTOR[c.spec.culprit]),'collusion only for culprits with a protector');
});
