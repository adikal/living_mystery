import test from 'node:test';
import assert from 'node:assert/strict';
import {certify, survivors, analyse, threadDepths, closureDependent} from '../dist/mk/kernel.mjs';

// The mystery kernel (docs/mystery-kernel.md): code computes eliminations, truth, reachability, depth,
// threads, misdirection and justification from typed records. Mirrors tools/refine-c/test_refine.py.

const base = () => ({
  setting: {name: 'Test', places: [{id: 'gallery'}, {id: 'cottage'}, {id: 'inn'}],
    links: [{a: 'gallery', b: 'cottage', minutes: 10}, {a: 'cottage', b: 'inn', minutes: 15}]},
  rules: [{id: 'r_trim', text: 'wicks are trimmed hourly', knowledge: 'acquirable'}],
  people: [{id: 'tom', traits: {handed: 'left'}}, {id: 'wife', traits: {handed: 'right'}}, {id: 'cox', traits: {handed: 'right'}}, {id: 'keeper', traits: {}}],
  objects: [], relations: [{a: 'tom', rel: 'owes', b: 'keeper'}], possession: [{person: 'tom', item: 'gallery_key'}],
  question: {text: 'who pushed the keeper?', truth: 'h_tom',
    candidates: [{id: 'h_tom', facts: {actor: 'tom'}}, {id: 'h_wife', facts: {actor: 'wife'}}, {id: 'h_cox', facts: {actor: 'cox'}}],
    crime: {event: 'e_push', place: 'gallery', window: [1320, 1440]}},
  attitudes: [{id: 'a_tom', agent: 'tom', mode: 'fears'}, {id: 'a_wife', agent: 'wife', mode: 'intends'},
    {id: 'a_cox', agent: 'cox', mode: 'intends'}, {id: 'a_kp', agent: 'keeper', mode: 'intends'}],
  events: [{id: 'e_push', type: 'push', agent: 'tom', others: ['keeper'], place: 'gallery', start: 1400, end: 1402, causedBy: 'a_tom'},
    {id: 'e_wife', type: 'sleep', agent: 'wife', place: 'cottage', start: 1300, end: 1500, causedBy: 'a_wife'},
    {id: 'e_cox', type: 'drink', agent: 'cox', place: 'inn', start: 1300, end: 1500, causedBy: 'a_cox'}],
  signs: [
    {id: 's_wife', kind: 'testimony', speaker: 'cox', text: 'She never left the cottage.', claim: {kind: 'place', person: 'wife', place: 'cottage', start: 1310, end: 1450}},
    {id: 's_cox', kind: 'record', text: 'The inn ledger.', claim: {kind: 'place', person: 'cox', place: 'inn', start: 1310, end: 1450}},
    {id: 's_debt', kind: 'document', text: 'An IOU from Tom to the keeper.', claim: {kind: 'relation', a: 'tom', rel: 'owes', b: 'keeper'}},
    {id: 's_holds', kind: 'record', text: 'Tom holds the gallery key.', claim: {kind: 'possession', person: 'tom', item: 'gallery_key'}}]
});

// A false alibi from the wife (twist), defeated by the lamp log behind a key and a rule.
const twist = () => {
  const c = base();
  c.attitudes.push({id: 'a_wife_protect', agent: 'wife', mode: 'wants', content: 'protect tom'});
  c.signs.push({id: 's_alibi', kind: 'testimony', speaker: 'wife', because: ['a_wife_protect'], text: 'Tom was with me all night.',
    claim: {kind: 'place', person: 'tom', place: 'cottage', start: 1330, end: 1430}});
  c.signs.push({id: 's_key', kind: 'item', text: 'A key.'});
  c.signs.push({id: 's_log', kind: 'record', text: 'Lamp log.', requires: ['s_key'], needs: ['r_rule'], unlock: 'the key opens the log cabinet',
    reading: 'the manual says wicks are trimmed hourly', claim: {kind: 'place', person: 'tom', place: 'gallery', start: 1395, end: 1405}, defeats: ['s_alibi']});
  c.signs.push({id: 'r_rule', kind: 'rule', rule: 'r_trim', text: 'The keeper manual.'});
  return c;
};

test('a trivial surface certifies with a unique answer at depth 0', () => {
  const r = certify(base());
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepEqual(r.surface, ['h_tom']);
  assert.equal(r.solveDepth, 0);
  assert.equal(r.twist, false);
});

test('an ambiguous case is rejected', () => {
  const c = base(); c.signs = c.signs.slice(0, 1);
  const r = certify(c);
  assert.equal(r.ok, false); assert.ok(r.errors.some(e => e.includes('not unique')));
});

test('physical consistency: one place at a time, travel takes time', () => {
  let c = base(); c.events.push({id: 'e_x', agent: 'tom', place: 'inn', start: 1395, end: 1405, causedBy: 'a_tom'});
  assert.ok(certify(c).errors.some(e => e.includes('two places')));
  c = base(); c.events.push({id: 'e_x', agent: 'tom', place: 'inn', start: 1380, end: 1395, causedBy: 'a_tom'});
  assert.ok(certify(c).errors.some(e => e.includes('cannot travel')));
});

test('every intentional event needs its causing attitude', () => {
  const c = base(); c.events[1].causedBy = null;
  assert.ok(certify(c).errors.some(e => e.includes('no causing attitude')));
});

test('a false alibi is a certified twist, overturned deeper; reading costs a step', () => {
  const r = certify(twist());
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(r.twist, true); assert.ok(!r.surface.includes('h_tom'));
  assert.deepEqual(r.falseSigns, ['s_alibi']);
  assert.equal(r.solveDepth, 2);          // key (0) -> log access (1) -> read with the manual (+1)
  assert.ok(r.key.includes('s_log'));
  assert.deepEqual(r.threads, {truth: 2, h_wife: 0, h_cox: 0});
});

test('a lie needs the speaker’s reason and a deeper defeater', () => {
  let c = twist(); delete c.signs.find(x => x.id === 's_alibi').because;
  assert.ok(certify(c).errors.some(e => e.includes('cites no attitude')));
  c = twist(); delete c.signs.find(x => x.id === 's_log').defeats;
  assert.ok(certify(c).errors.some(e => e.includes('no reachable, true defeater')));
});

test('access and reading edges need in-world reasons', () => {
  const c = twist(); delete c.signs.find(x => x.id === 's_log').unlock;
  assert.ok(certify(c).errors.some(e => e.includes("no 'unlock'")));
});

test('trait claims are evaluated by code against people', () => {
  const c = base(); c.signs = [...c.signs.filter(x => ['s_debt', 's_holds'].includes(x.id)), {id: 's_glove', kind: 'trace', text: 'A left-hand glove.', claim: {kind: 'trait', trait: 'handed', value: 'left'}}];
  const r = certify(c); assert.ok(r.ok, JSON.stringify(r.errors)); assert.deepEqual(r.surface, ['h_tom']);
});

test('motive and means are detected; a world-fact relation rules nobody out', () => {
  const c = twist();
  c.relations.push({a: 'tom', rel: 'paid_by', b: 'smugglers'});
  c.signs.push({id: 's_pay', kind: 'document', text: 'A payment note.', requires: ['s_key'], unlock: 'the key opens his chest',
    claim: {kind: 'relation', a: 'tom', rel: 'paid_by', b: 'smugglers'}});
  c.signs.push({id: 's_keyring', kind: 'trace', text: 'Only one gallery key was issued.', claim: {kind: 'possession', item: 'gallery_key'}});
  const r = certify(c);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepEqual(r.motive, ['s_debt', 's_pay']); assert.deepEqual(r.means, ['s_keyring']);
  assert.equal(r.threads.h_wife, 0);
});

test('a false world fact is caught as an undefended false sign', () => {
  const c = twist();
  c.signs.push({id: 's_bad', kind: 'document', text: 'A note.', claim: {kind: 'relation', a: 'wife', rel: 'paid_by', b: 'smugglers'}});
  const r = certify(c); assert.equal(r.ok, false); assert.ok(r.errors.some(e => e.includes('s_bad')));
});

test('spoken times must match the timeline; a trace lies where it was made', () => {
  let c = base(); c.signs[0].text = 'She was home by 9:00 in the morning.';
  assert.ok(certify(c).errors.some(e => e.includes('matches no event')));
  c = base(); c.signs[0].text = 'She never left after 23:20.';
  assert.ok(certify(c).ok);
  c = base(); c.signs.push({id: 's_mark', kind: 'trace', text: 'A scuff.', at: 'inn', source: 'e_push'});
  assert.ok(certify(c).errors.some(e => e.includes('lies where it was made')));
});

test('removing a sign removes everything that depends on it', () => {
  const c = twist(), A = analyse(c);
  assert.deepEqual([...closureDependent(c, 's_key')].sort(), ['s_key', 's_log']);
  // without the key the lie is never defeated, so the truth never survives
  assert.equal(threadDepths(c, A, closureDependent(c, 's_key')).truth, null);
  // on the surface the lie clears the culprit and the alibis clear the others: nobody survives yet
  assert.deepEqual(survivors(c, A, 0), []);
});

test('motive, means and opportunity pillars are reported, and a missing motive fails', () => {
  const r = certify(base());
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepEqual(r.pillarSigns, {motive: ['s_debt'], means: ['s_holds']});
  assert.deepEqual(r.pillars, {opportunity: 0, means: 0, motive: 0});
  const c = base(); c.signs = c.signs.filter(x => x.id !== 's_debt');
  const bad = certify(c); assert.equal(bad.ok, false); assert.ok(bad.errors.some(e => e.includes('MOTIVE')));
  const d = base(); d.signs = d.signs.filter(x => x.id !== 's_debt');
  d.signs.push({id: 's_hate', kind: 'testimony', speaker: 'cox', text: 'She hated him.', claim: {kind: 'relation', a: 'wife', rel: 'hates', b: 'keeper'}});
  assert.equal(certify(d).ok, false, "an innocent's motive does not count as the culprit's");
});
