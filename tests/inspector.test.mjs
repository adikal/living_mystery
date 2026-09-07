import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,dispatch,commit} from '../dist/engine.mjs';
import {perspectiveAt,missedAt} from '../dist/inspector.mjs';

const move=(s,to)=>dispatch(s,{type:'move',to});
test('Perspective retains witnessed positions without exposing offstage movement or future observations',()=>{
  const s=createSession(),start=s.events.length-1;
  assert.deepEqual(Object.keys(perspectiveAt(s,start,'bell').seen),['player']);
  move(s,'manor');
  const arrived=s.events.length-1;
  assert.equal(perspectiveAt(s,arrived,'bell').seen.player.location,'square');
  assert.equal(perspectiveAt(s,arrived,'bell').seen.player.departed,true);
  assert.equal(perspectiveAt(s,arrived,'clara').seen.player.location,'manor');
  assert.equal(perspectiveAt(s,start,'clara').seen.player,undefined);
  const frozen=JSON.stringify(s);
  perspectiveAt(s,start,'bell');missedAt(s,start);
  assert.equal(JSON.stringify(s),frozen);
});

test('Missed clues follow acquired evidence and the selected time, not the live ending',()=>{
  const s=createSession(),start=s.events.length-1;
  move(s,'manor');const visit=s.events.length-1;
  assert.ok(missedAt(s,visit).clues.some(c=>c.clue==='medical'));
  dispatch(s,{type:'inspect',object:'body'});
  assert.ok(!missedAt(s,s.events.length-1).clues.some(c=>c.clue==='medical'));
  assert.ok(missedAt(s,visit).clues.some(c=>c.clue==='medical'));
  assert.deepEqual(missedAt(s,start).clues,[]);
});

test('Moved folio is reported where recoverable rather than as an inspectable absent object',()=>{
  const s=createSession();move(s,'manor');move(s,'vestry');
  commit(s,{kind:'action',title:'Fixture: folio hidden',changes:{'objects.folio':'drawer'}});
  const report=missedAt(s,s.events.length-1);
  assert.equal(report.clues.filter(c=>c.clue==='folio').length,1);
  assert.equal(report.clues.find(c=>c.clue==='folio').location,'vestry');
  assert.match(report.moved.status,/discoverable/);
});

test('Offstage encounters and unused follow-ups are bounded by the replay cursor',()=>{
  const s=createSession();move(s,'manor');const before=s.events.length-1;
  dispatch(s,{type:'wait',minutes:60});
  assert.equal(missedAt(s,before).encounters.length,0);
  assert.ok(missedAt(s,s.events.length-1).encounters.some(e=>e.actor==='ada'));
  move(s,'inn');dispatch(s,{type:'inspect',object:'clock'});
  assert.ok(missedAt(s,s.events.length-1).followups.some(f=>f.person==='ada'));
  dispatch(s,{type:'present',person:'ada',clue:'clock'});
  assert.ok(!missedAt(s,s.events.length-1).followups.some(f=>f.person==='ada'));
});

test('Closed-case review does not advertise locked investigation actions as available',()=>{
  const s=createSession();move(s,'manor');
  commit(s,{kind:'resolution',title:'Fixture: case closed',changes:{status:'solved','objects.folio':'drawer'}});
  const report=missedAt(s,s.events.length-1);
  assert.ok(report.clues.length>0);
  assert.ok(report.clues.every(c=>c.status==='Case closed · review only'));
  assert.equal(report.moved.status,'Case closed · review only');
});
