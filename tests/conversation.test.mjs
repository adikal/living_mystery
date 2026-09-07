import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,dispatch,commit,followupOptions,exportSession,importSession,diagnostics} from '../dist/engine.mjs';

test('Conversation holds one speaker across schedule boundaries and survives save/restore',()=>{
  const s=createSession();
  dispatch(s,{type:'move',to:'manor'});
  dispatch(s,{type:'ask',person:'clara',topic:'alibi'});
  for(let i=0;i<12;i++)dispatch(s,{type:'ask',person:'clara',topic:'source'});
  assert.equal(s.world.npcs.clara.location,'manor');
  assert.equal(s.world.player.conversation,'clara');
  assert.ok(s.events.some(e=>e.kind==='movement'&&e.actor==='silas'));
  const restored=importSession(exportSession(s));
  for(const state of [s,restored])dispatch(state,{type:'endConversation'});
  assert.deepEqual(restored,s);
  assert.equal(s.world.player.conversation,null);
  assert.equal(s.world.npcs.clara.travel.to,'inn');
  assert.deepEqual(diagnostics(s).errors,[]);
});

test('Evidence-triggered plans wait until conversation ends; waiting releases the speaker',()=>{
  const s=createSession();dispatch(s,{type:'move',to:'manor'});dispatch(s,{type:'inspect',object:'accounts'});
  dispatch(s,{type:'move',to:'vestry'});dispatch(s,{type:'present',person:'silas',clue:'ledger'});
  assert.equal(s.world.npcs.silas.location,'vestry');
  assert.equal(s.world.npcs.silas.travel,null);
  dispatch(s,{type:'ask',person:'silas',topic:'alibi'});
  assert.equal(s.world.npcs.silas.location,'vestry');
  dispatch(s,{type:'wait',minutes:1});
  assert.equal(s.world.player.conversation,null);
  assert.equal(s.world.npcs.silas.travel.to,'manor');
  assert.deepEqual(diagnostics(s).errors,[]);
});

test('One observations question retains witnessed actions, with a distinct source follow-up',()=>{
  const s=createSession();dispatch(s,{type:'move',to:'manor'});dispatch(s,{type:'ask',person:'clara',topic:'alibi'});
  assert.ok(!followupOptions(s,'clara').some(([key])=>key==='observations'));
  assert.ok(followupOptions(s,'clara').some(([key,label])=>key==='source'&&label==='What is your account based on?'));
  commit(s,{kind:'belief',title:'Witness fixture',changes:{'npcs.clara.beliefs':[...s.world.npcs.clara.beliefs,{key:'saw_folio_taken'}]}});
  dispatch(s,{type:'ask',person:'clara',topic:'sightings'});
  assert.match(s.events.findLast(e=>e.kind==='speech'&&e.actor==='clara').data.assertion,/Silas take the red folio/);
});

test('Clara explains her stated alibi without revealing an unmentioned relationship',()=>{
  const s=createSession();dispatch(s,{type:'move',to:'manor'});
  dispatch(s,{type:'ask',person:'clara',topic:'alibi'});
  const alibi=s.events.findLast(e=>e.kind==='speech'&&e.actor==='clara');
  for(let i=0;i<2;i++){
    dispatch(s,{type:'ask',person:'clara',topic:'source'});
    const reply=s.events.findLast(e=>e.kind==='speech'&&e.actor==='clara');
    assert.match(reply.data.assertion,/own recollection/);
    assert.doesNotMatch(reply.data.assertion,/Rowan|greenhouse|meeting/);
    assert.ok(reply.parents.includes(alibi.id));
  }
  dispatch(s,{type:'ask',person:'clara',topic:'accounts'});
  dispatch(s,{type:'ask',person:'clara',topic:'source'});
  assert.doesNotMatch(s.events.findLast(e=>e.kind==='speech'&&e.actor==='clara').data.assertion,/Rowan|alone|greenhouse/);
  assert.deepEqual(diagnostics(s).errors,[]);
});

test('Source questions after sightings do not jump to unrelated case testimony',()=>{
  for(const [person,to] of [['clara','manor'],['ada','inn'],['silas','vestry'],['rowan','greenhouse'],['iris','surgery'],['bell','square']]){
    const s=createSession();if(to!=='square')dispatch(s,{type:'move',to});
    dispatch(s,{type:'ask',person,topic:'sightings'});
    dispatch(s,{type:'ask',person,topic:'source'});
    const reply=s.events.findLast(e=>e.kind==='speech'&&e.actor===person);
    assert.match(reply.data.assertion,/personally observed today/);
    assert.doesNotMatch(reply.data.assertion,/coat|loan|death|private life|evening/);
  }
});

test('Rejected actions neither release an engaged NPC nor start a conversation',()=>{
  const s=createSession();dispatch(s,{type:'move',to:'manor'});dispatch(s,{type:'ask',person:'clara',topic:'alibi'});
  for(let i=0;i<12;i++)dispatch(s,{type:'ask',person:'clara',topic:'source'});
  for(const action of [{type:'move',to:'manor'},{type:'move',to:'missing'},{type:'inspect',object:'clock'},{type:'ask',person:'clara',topic:'weapon'}]){
    const before=structuredClone(s.world);dispatch(s,action);assert.deepEqual(s.world,before);
  }
  const t=createSession();dispatch(t,{type:'move',to:'vestry'});
  const before=structuredClone(t.world);dispatch(t,{type:'ask',person:'silas',topic:'challenge_delivery'});assert.deepEqual(t.world,before);
});

test('Sightings alone do not unlock questions about unmentioned case testimony',()=>{
  for(const [person,to,followup] of [['ada','inn','identity'],['rowan','greenhouse','coat']]){
    const s=createSession();dispatch(s,{type:'move',to});dispatch(s,{type:'ask',person,topic:'sightings'});
    assert.ok(!followupOptions(s,person).some(([key])=>key===followup));
    dispatch(s,{type:'ask',person,topic:'night'});
    assert.ok(followupOptions(s,person).some(([key])=>key===followup));
  }
});
