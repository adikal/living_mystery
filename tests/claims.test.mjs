import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,dispatch,commit,worldAt,exportSession,importSession,diagnostics,followupOptions} from '../dist/engine.mjs';
import {claimsAt,claimRelations,relation,validateClaim} from '../dist/claims.mjs';
import {at} from '../dist/cases/last-bell-claims.mjs';
const move=(s,to)=>dispatch(s,{type:'move',to});
const ask=(s,person,topic)=>dispatch(s,{type:'ask',person,topic});
const inspect=(s,object)=>dispatch(s,{type:'inspect',object});
const healthy=s=>assert.deepEqual(diagnostics(s).errors,[]);

test('Claims compare overlapping physical presence, not non-overlapping journeys',()=>{
  const alibi=at('a','silas','vestry',1260,1290),receipt=at('b','silas','manor',1272,1272);
  assert.ok(validateClaim(alibi));assert.equal(relation(alibi,receipt),'conflicts');
  assert.equal(relation(alibi,{...receipt,interval:{start:1291,end:1291}}),null);
  assert.equal(relation(alibi,{...receipt,value:'vestry'}),'supports');
  assert.equal(relation(alibi,{...receipt,subject:'clara'}),null);
  assert.equal(validateClaim({...alibi,interval:{start:10,end:2}}),false);
});

test('Recorded receipt unlocks cross-examination; revision is retained without erasing the original',()=>{
  const s=createSession();move(s,'vestry');ask(s,'silas','alibi');
  assert.ok(!followupOptions(s,'silas').some(([id])=>id==='challenge_delivery'));
  inspect(s,'delivery');const before=s.events.length-1;
  assert.ok(claimRelations(claimsAt(s)).some(r=>r.kind==='conflicts'));
  ask(s,'silas','challenge_delivery');
  assert.ok(s.world.npcs.silas.beliefs.some(b=>b.key==='alibi_challenged'));
  assert.ok(claimsAt(s).some(c=>c.key==='silas_alibi'&&c.value==='vestry'&&c.superseded));
  assert.ok(claimsAt(s).some(c=>c.key==='silas_alibi'&&c.value==='manor'&&!c.superseded));
  assert.ok(claimRelations(claimsAt(s,before)).some(r=>r.kind==='conflicts'));
  ask(s,'silas','alibi');assert.match(s.events.findLast(e=>e.kind==='speech'&&e.actor==='silas').data.assertion,/acknowledged/);
  const restored=importSession(exportSession(s));assert.deepEqual(restored,s);healthy(s);
});

test('Unavailable cross-examination and offstage claims never expose knowledge',()=>{
  const s=createSession();move(s,'vestry');const minute=s.world.minute;ask(s,'silas','challenge_delivery');assert.equal(s.world.minute,minute);
  commit(s,{kind:'speech',title:'Private claim fixture',actor:'silas',data:{listener:'clara',claims:[at('secret','silas','manor',1272,1272)]}});
  assert.equal(claimsAt(s).length,0);healthy(s);
});

test('Ada carries a correction to Bell through movement and a real conversation',()=>{
  const s=createSession();dispatch(s,{type:'wait',minutes:60});move(s,'inn');inspect(s,'clock');
  dispatch(s,{type:'present',person:'ada',clue:'clock'});const before=s.events.length-1;
  assert.equal(s.world.npcs.bell.beliefs.find(b=>b.key==='adas_account').truth,false);
  assert.ok(s.world.npcs.ada.beliefs.some(b=>b.key==='needs_correction'));
  const restored=importSession(exportSession(s));dispatch(s,{type:'wait',minutes:30});dispatch(restored,{type:'wait',minutes:30});
  assert.deepEqual(restored,s);assert.equal(s.world.flags.adaCorrectionDelivered,true);
  const belief=s.world.npcs.bell.beliefs.find(b=>b.key==='adas_account');assert.equal(belief.truth,true);
  assert.equal(s.events.find(e=>e.id===belief.sourceId).title,'Ada corrects her report to Bell');
  assert.equal(worldAt(s,before).npcs.bell.beliefs.find(b=>b.key==='adas_account').truth,false);healthy(s);
});

test('A cooperative witness reports an observed action; a remote witness gains no knowledge',()=>{
  const s=createSession();move(s,'manor');inspect(s,'accounts');move(s,'vestry');
  // Isolate the perception-driven policy from the already-tested reassurance route.
  commit(s,{kind:'relationship',title:'Fixture: earned Clara cooperation',changes:{'npcs.clara.trust':.8}});
  dispatch(s,{type:'present',person:'silas',clue:'ledger'});dispatch(s,{type:'wait',minutes:30});
  assert.ok(s.world.npcs.clara.beliefs.some(b=>b.key==='saw_folio_taken'));
  assert.ok(!s.world.npcs.iris.beliefs.some(b=>b.key==='saw_folio_taken'));
  assert.equal(s.world.flags.claraReportedFolio,true);
  const b=s.world.npcs.bell.beliefs.find(b=>b.key==='clara_folio_report');assert.ok(b);assert.equal(b.sourceType,'testimony');
  const d=s.events.find(e=>e.kind==='decision'&&e.actor==='clara'&&e.data.selected==='report');assert.ok(d.data.knowledgeUsed.includes('saw_folio_taken'));healthy(s);
});

test('Clara can retract a cover story after documentary challenge',()=>{
  const s=createSession();move(s,'surgery');inspect(s,'record');move(s,'manor');ask(s,'clara','alibi');
  assert.ok(claimRelations(claimsAt(s)).some(r=>r.kind==='conflicts'&&r.left.subject==='clara'));
  ask(s,'clara','challenge_record');assert.equal(s.world.npcs.clara.disclosed,true);
  assert.ok(claimsAt(s).some(c=>c.key==='clara_alibi'&&c.value==='greenhouse'&&!c.superseded));healthy(s);
});

test('Structured claims reject malformed save metadata and preserve older evidence projection',async()=>{
  const {playerClaims}=await import('../dist/engine.mjs');
  const s=createSession();move(s,'vestry');inspect(s,'delivery');
  const save=JSON.parse(exportSession(s));const e=save.events.find(e=>e.kind==='evidence');
  delete e.data.claims;
  const legacy=importSession(JSON.stringify(save));assert.ok(playerClaims(legacy).some(c=>c.key==='receipt'));
  e.data.claims=[{key:'broken'}];assert.throws(()=>importSession(JSON.stringify(save)),/structured claim/);
});

test('A threatened Clara refuses documentary follow-up until cooperation is repaired',()=>{
  const s=createSession();move(s,'surgery');inspect(s,'record');move(s,'manor');ask(s,'clara','alibi');
  dispatch(s,{type:'present',person:'clara',clue:'record',tone:'press'});
  // She remains engaged after the threat; the challenge cannot silently repair trust.
  ask(s,'clara','challenge_record');
  assert.equal(s.world.npcs.clara.disclosed,false);
  assert.match(s.events.findLast(e=>e.kind==='speech'&&e.actor==='clara').data.assertion,/threat/);
  dispatch(s,{type:'present',person:'clara',clue:'record',tone:'private'});
  assert.equal(s.world.npcs.clara.disclosed,true);healthy(s);
});

test('Plans respond to cooperation rather than broadcasting every observed action',()=>{
  const s=createSession();move(s,'manor');inspect(s,'accounts');move(s,'vestry');
  dispatch(s,{type:'present',person:'silas',clue:'ledger'});dispatch(s,{type:'wait',minutes:30});
  assert.ok(s.world.npcs.clara.beliefs.some(b=>b.key==='saw_folio_taken'));
  assert.ok(!s.world.flags.claraReportedFolio);
  assert.ok(!s.world.npcs.bell.beliefs.some(b=>b.key==='clara_folio_report'));healthy(s);
});

test('Corrected testimony is recorded as spoken and identity clarification persists',()=>{
  const s=createSession();move(s,'inn');inspect(s,'clock');dispatch(s,{type:'present',person:'ada',clue:'clock'});ask(s,'ada','night');
  const entry=s.world.player.evidence.find(e=>e.clue==='ada');assert.match(entry.text,/21:03/);
  assert.ok(!claimsAt(s).some(c=>c.speaker==='ada'&&!c.superseded&&c.value==='rowan'));
  const t=createSession();move(t,'inn');ask(t,'ada','night');ask(t,'ada','identity');ask(t,'ada','night');
  assert.match(t.events.findLast(e=>e.kind==='speech'&&e.actor==='ada').data.assertion,/unidentified/);healthy(t);
});

test('Asking about accounts alone does not acquire an alibi that was never stated',()=>{
  const s=createSession();move(s,'vestry');ask(s,'silas','accounts');
  assert.ok(!s.world.player.evidence.some(e=>e.clue==='alibi'));
});
