import test from 'node:test';
import assert from 'node:assert/strict';
import {AFFORDANCES,AFFORDANCE_VERSION,HARM_KINDS,affordanceLeaves,PREDICATE_COMPILERS} from '../dist/primitives.mjs';
import {OBJECTS,mechanismSignature} from '../dist/objects.mjs';
import {makeCase} from '../dist/cases/bellweather.mjs';
import {buildSpec,WEAPONS} from '../dist/cases/bellweather-configs.mjs';

// Stage 1 + 3: a finite affordance grammar in the kernel, and the existing methods re-expressed on top
// of it. The grammar is the bounded, decidable core; objects are the unbounded surface that project
// onto it. These tests pin both halves.

test('the affordance grammar is finite, versioned, and every affordance reduces to a known kernel predicate',()=>{
 assert.equal(AFFORDANCE_VERSION,1);
 const preds=new Set(Object.keys(PREDICATE_COMPILERS));
 for(const [name,spec] of Object.entries(AFFORDANCES)){
  assert.ok(typeof spec.role==='string'&&spec.role,`${name} has a role`);
  if(spec.leaves)assert.ok(preds.has(spec.leaves),`${name} leaves a validated predicate (${spec.leaves})`);
 }
 assert.ok(HARM_KINDS.includes('toxic')&&HARM_KINDS.includes('blunt'),'harm kinds cover the classics');
});

test('every catalogued object declares only known affordances and harm kinds (fail-closed at load)',()=>{
 for(const [id,o] of Object.entries(OBJECTS))for(const af of o.affords){
  assert.ok(AFFORDANCES[af.a],`${id}: known affordance ${af.a}`);
  if(af.a==='harm')assert.ok(HARM_KINDS.includes(af.kind),`${id}: known harm kind ${af.kind}`);
 }
});

test('the weapon catalog is derived from the affordance-annotated object catalog',()=>{
 assert.deepEqual(Object.keys(WEAPONS),Object.keys(OBJECTS));
 for(const id of Object.keys(OBJECTS)){
  assert.equal(WEAPONS[id].name,OBJECTS[id].name);
  assert.equal(WEAPONS[id].injury,OBJECTS[id].injury);
 }
});

test('adequacy: each existing method’s affordance signature is realised in the built case evidence',()=>{
 for(const weapon of ['seal','candlestick','knife','poison']){
  const cm=makeCase(buildSpec({culprit:'silas',weapon,motive:'fraud',minute:1274,seen:'rowan'}));
  const present=new Set(Object.values(cm.model.evidenceClaims).flat().map(c=>c.predicate));
  const sig=mechanismSignature(weapon);
  assert.ok(sig.leaves.length>0,`${weapon}: has an evidence signature`);
  for(const pred of sig.leaves)
   assert.ok(present.has(pred),`${weapon}: mechanism leaves ${pred}, which is present in the case evidence`);
 }
});
