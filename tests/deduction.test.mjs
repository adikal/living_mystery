import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCase} from '../dist/cases/bellweather.mjs';
import {createRuntime} from '../dist/engine-runtime.mjs';
import {buildSpec} from '../dist/cases/bellweather-configs.mjs';
import {findContradictions} from '../dist/claims.mjs';
import {compileExplanation,enumerateExplanations} from '../dist/forensics.mjs';
import {CONFIGS} from '../dist/cases/bellweather-configs.mjs';
import {validateCase} from '../dist/casegen.mjs';

const setup=()=>{const cm=makeCase(buildSpec({culprit:'silas',weapon:'seal',motive:'fraud',minute:1274,seen:'rowan'}));return {cm,rt:createRuntime(cm),cat:cm.model.evidenceClaims};};

test('A typed alibi lie is caught as a contradiction against the physical record, and clears on revision',()=>{
 const {rt,cat}=setup();
 const s=rt.createSession();
 rt.dispatch(s,{type:'move',to:'vestry'});
 // Only the physical receipt, no testimony yet: no contradiction.
 rt.dispatch(s,{type:'inspect',object:'delivery'});
 assert.equal(findContradictions(s,cat).length,0);
 // Hearing the culprit's (false) alibi puts vestry vs the manor receipt into conflict.
 rt.dispatch(s,{type:'ask',person:'silas',topic:'night'});
 const caught=findContradictions(s,cat);
 assert.equal(caught.length,1);
 assert.equal(caught[0].left.subject,'silas');
 assert.deepEqual([caught[0].left.value,caught[0].right.value].sort(),['manor','vestry']);
 // Challenging the receipt forces a revision; the superseding claim clears the contradiction.
 rt.dispatch(s,{type:'ask',person:'silas',topic:'challenge_delivery'});
 rt.dispatch(s,{type:'ask',person:'silas',topic:'night'});
 assert.equal(findContradictions(s,cat).length,0,'a revision supersedes the lie and clears the conflict');
});

test('A truthful innocent account produces no contradiction with the record',()=>{
 const {rt,cat}=setup();
 const s=rt.createSession();
 // Clara is innocent here; her greenhouse account agrees with Dr Marsh's record.
 rt.dispatch(s,{type:'move',to:'surgery'});
 rt.dispatch(s,{type:'inspect',object:'record'});
 rt.dispatch(s,{type:'move',to:'manor'});
 if(rt.behavior && s.world.npcs.clara.location==='manor'&&!s.world.npcs.clara.travel)rt.dispatch(s,{type:'ask',person:'clara',topic:'night'});
 assert.equal(findContradictions(s,cat).filter(r=>r.left.subject==='clara'||r.right.subject==='clara').length,0);
});

test('Motive is a multi-hop chain: neither the estate document nor the memo pins it alone',()=>{
 const {cm}=setup();
 const model=cm.model.forensics,cat=cm.model.evidenceClaims;
 const motiveCount=sel=>new Set(enumerateExplanations(compileExplanation(model,Object.fromEntries(sel.map(x=>[x,cat[x]??[]])),sel),model).map(a=>a.motive)).size;
 assert.ok(motiveCount(['ledger'])>1,'the ledger only narrows the motive');
 assert.ok(motiveCount(['intent'])>1,'the confrontation memo needs a document to pin the motive');
 assert.equal(motiveCount(['ledger','intent']),1,'document + memo together pin the exact motive');
});

test('The multi-hop obligation holds for every authored configuration',()=>{
 for(const cfg of CONFIGS){
  const r=validateCase(cfg);
  assert.ok(r.obligations.multihop.ok,`${cfg.id}: ${r.obligations.multihop.detail}`);
  assert.match(r.obligations.multihop.detail,/motive and means each require ≥2 clues/);
 }
});
