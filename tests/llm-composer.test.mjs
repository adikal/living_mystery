import test from 'node:test';
import assert from 'node:assert/strict';
import {composeCase,composerPrompt,parseComposition,palette,rejectionFeedback} from '../dist/llm-composer.mjs';
import {validateCase} from '../dist/casegen.mjs';
import {WEAPONS} from '../dist/cases/bellweather-configs.mjs';

// A mock LLM is just an async (prompt)=>string. Scripting its replies lets us exercise the whole
// propose -> compile -> validate -> repair -> fallback loop deterministically, with no network.
const scripted=(...replies)=>{let i=0;const seen=[];return {llm:async prompt=>{seen.push(prompt);return replies[Math.min(i++,replies.length-1)];},seen};};
const asJson=o=>JSON.stringify(o);

test('a valid first proposal is compiled and validated (source: llm)',async()=>{
 const {llm}=scripted(asJson({reasoning:'poisoning by the ally-protected culprit',spec:{culprit:'rowan',weapon:'poison',motive:'inheritance',minute:1310,seen:'silas',structure:'clockwork',manner:'overt',collusion:true},title:'The Bitter Vintage',synopsis:'A quiet death at the desk.'}));
 const r=await composeCase(llm,{seed:1});
 assert.equal(r.source,'llm');
 assert.equal(r.attempts,1);
 assert.ok(r.report.ok,'the composed case is validated by the oracle');
 assert.equal(r.spec.weapon,'poison');
 assert.equal(r.flavor.title,'The Bitter Vintage','non-authoritative flavor is carried through');
});

test('an invalid proposal is repaired using structured feedback on the next round',async()=>{
 // First reply is invalid (collusion with a culprit who has no protector); second is valid.
 const bad=asJson({reasoning:'x',spec:{culprit:'silas',weapon:'seal',motive:'fraud',minute:1274,seen:'rowan',collusion:true}});
 const good=asJson({reasoning:'y',spec:{culprit:'silas',weapon:'seal',motive:'fraud',minute:1274,seen:'rowan'}});
 const {llm,seen}=scripted(bad,good);
 const r=await composeCase(llm,{seed:2});
 assert.equal(r.source,'llm');
 assert.equal(r.attempts,2,'succeeded on the repair round');
 assert.match(seen[1],/REJECTED/,'the repair prompt carried the rejection');
 assert.equal(r.trail[0].rejected,'buildSpec','the first round was rejected at compile time');
});

test('garbage output is reported as a parse rejection and still repaired',async()=>{
 const good=asJson({reasoning:'y',spec:{culprit:'clara',weapon:'knife',motive:'eviction',minute:1300,seen:'silas'}});
 const {llm,seen}=scripted('I cannot help with that.',good);
 const r=await composeCase(llm,{seed:3});
 assert.equal(r.source,'llm');
 assert.equal(r.trail[0].rejected,'parse');
 assert.match(seen[1],/JSON object/,'the repair prompt asked for valid JSON');
});

test('if the model never produces a valid case, it falls back to the deterministic sampler',async()=>{
 const {llm}=scripted('nonsense');
 const r=await composeCase(llm,{seed:5,attempts:3});
 assert.equal(r.source,'fallback');
 assert.equal(r.trail.length,3,'it exhausted its attempts before falling back');
 assert.ok(r.report.ok,'the fallback case is certified');
});

test('results are cached per seed (prep-time memoization; the model is called once)',async()=>{
 let calls=0;
 const good=asJson({reasoning:'y',spec:{culprit:'clara',weapon:'candlestick',motive:'fraud',minute:1305,seen:'rowan'}});
 const llm=async()=>{calls++;return good;};
 const cache=new Map();
 const a=await composeCase(llm,{seed:9,cache});
 const b=await composeCase(llm,{seed:9,cache});
 assert.equal(calls,1,'the cached seed did not call the model again');
 assert.equal(a.spec.id,b.spec.id);
});

test('the palette is a closed set over the kernel — no invented vocabulary',()=>{
 const p=palette();
 assert.deepEqual(p.weapons,Object.keys(WEAPONS));
 assert.deepEqual(p.motives,['fraud','inheritance','eviction']);
 assert.deepEqual(p.manners,['overt','accident','suicide']);
 assert.ok(composerPrompt().includes('MUST NOT invent'),'the prompt forbids invention');
});

test('rejectionFeedback surfaces failing obligations by name',()=>{
 const fb=rejectionFeedback({report:{ok:false,obligations:{multihop:{ok:false,detail:'motive needs two clues'},physical:{ok:true}}}});
 assert.match(fb,/multihop: motive needs two clues/);
});
