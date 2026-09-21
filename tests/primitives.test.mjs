import test from 'node:test';
import assert from 'node:assert/strict';
import {PRIMITIVE_ALGEBRA_VERSION,ENTITY_SORTS,CONSTRAINT,PREDICATE_COMPILERS,occurrenceFacts,IDX} from '../dist/primitives.mjs';
import {evaluate} from '../dist/symbolic.mjs';

const model={variables:{suspect:{labels:['clara','rowan','silas']},method:{labels:['seal','candlestick','knife']},motive:{labels:['fraud','inheritance','eviction']},manner:{labels:['murder','accident']}},travel:{manor:0,greenhouse:5}};

test('The primitive algebra exposes a versioned, noun-free kernel',()=>{
 assert.equal(PRIMITIVE_ALGEBRA_VERSION,1);
 assert.deepEqual(ENTITY_SORTS,['person','place','object','document','time','belief']);
 assert.equal(IDX(model,'method','knife'),2);
});

test('Constraint primitives compile to finite formulas that evaluate correctly',()=>{
 assert.equal(evaluate(CONSTRAINT.within('time',{start:1270,end:1278}),{time:1274}),true);
 assert.equal(evaluate(CONSTRAINT.within('time',{start:1270,end:1278}),{time:1300}),false);
 assert.equal(evaluate(CONSTRAINT.is(model,'method','knife'),{method:2}),true);
 assert.equal(evaluate(CONSTRAINT.isNot(model,'motive','eviction'),{motive:2}),false);
 // soleAt pins the suspect within the window.
 assert.equal(evaluate(CONSTRAINT.soleAt(model,'silas',{start:1270,end:1278}),{suspect:2,time:1274}),true);
 assert.equal(evaluate(CONSTRAINT.soleAt(model,'silas',{start:1270,end:1278}),{suspect:0,time:1274}),false);
});

test('Claim predicates are thin compositions of the constraint primitives',()=>{
 assert.deepEqual(PREDICATE_COMPILERS.crime_method({value:'seal'},model),CONSTRAINT.is(model,'method','seal'));
 assert.deepEqual(PREDICATE_COMPILERS.motive_class({value:'eviction'},model),CONSTRAINT.isNot(model,'motive','eviction'));
 assert.equal(PREDICATE_COMPILERS.location({value:'manor'},model),null,'being at the scene adds no exoneration');
 assert.equal(PREDICATE_COMPILERS.clock_offset(),null,'a parameter-only claim adds no constraint');
 // crime_motive gates on its required companion (the confrontation memo needs a document).
 assert.equal(PREDICATE_COMPILERS.crime_motive({value:'fraud',requiresAny:['ledger']},model,{selected:[]}),null);
 assert.deepEqual(PREDICATE_COMPILERS.crime_motive({value:'fraud',requiresAny:['ledger']},model,{selected:['ledger']}),CONSTRAINT.is(model,'motive','fraud'));
});

test('Occurrence-fact vocabulary grounds beliefs in typed occurrences',()=>{
 assert.deepEqual(occurrenceFacts({actor:'silas',data:{occurrence:'fatal_action',method:'seal',deathMinute:1274}}),[['killing','silas','seal',1274]]);
 assert.deepEqual(occurrenceFacts({data:{occurrence:'clock_check',offset:12}}),[['clock_offset',12]]);
 assert.deepEqual(occurrenceFacts({data:{occurrence:'nothing'}}),[]);
});
