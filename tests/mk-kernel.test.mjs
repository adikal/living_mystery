import test from 'node:test';
import assert from 'node:assert/strict';
import {certify, survivors, analyse, threadDepths, closureDependent} from '../dist/mk/kernel.mjs';

// The mystery kernel (docs/mystery-kernel.md): code computes eliminations, truth, reachability, depth,
// threads, misdirection and justification from typed records. Mirrors tools/refine-c/test_refine.py. Claims follow
// docs/claims.md (version 2); what everyone knows (the crime window here) is a public sign.

const base = () => ({
  claims_version: 2,
  setting: {name: 'Test', places: [{id: 'gallery'}, {id: 'cottage'}, {id: 'inn'}],
    links: [{a: 'gallery', b: 'cottage', minutes: 10}, {a: 'cottage', b: 'inn', minutes: 15}]},
  rules: [{id: 'r_trim', text: 'wicks are trimmed hourly', knowledge: 'acquirable'}],
  people: [{id: 'tom', traits: {handed: 'left'}}, {id: 'wife', traits: {handed: 'right'}}, {id: 'cox', traits: {handed: 'right'}}, {id: 'keeper', traits: {}}],
  objects: [{id: 'gallery_key'}, {id: 'smugglers'}], vocabulary: {relations: [{rel: 'owes'}, {rel: 'paid_by'}, {rel: 'hates'}]},
  relations: [{a: 'tom', rel: 'owes', b: 'keeper'}], holdings: [{person: 'tom', item: 'gallery_key'}],
  question: {text: 'who pushed the keeper?', truth: 'h_tom',
    candidates: [{id: 'h_tom', facts: {actor: 'tom'}}, {id: 'h_wife', facts: {actor: 'wife'}}, {id: 'h_cox', facts: {actor: 'cox'}}],
    crime: {event: 'e_push', place: 'gallery', window: [1320, 1440]}},
  attitudes: [{id: 'a_tom', agent: 'tom', mode: 'fears'}, {id: 'a_wife', agent: 'wife', mode: 'intends'},
    {id: 'a_cox', agent: 'cox', mode: 'intends'}, {id: 'a_kp', agent: 'keeper', mode: 'intends'}],
  events: [{id: 'e_push', type: 'push', agent: 'tom', others: ['keeper'], place: 'gallery', start: 1400, end: 1402, causedBy: 'a_tom'},
    {id: 'e_wife', type: 'sleep', agent: 'wife', place: 'cottage', start: 1300, end: 1500, causedBy: 'a_wife'},
    {id: 'e_cox', type: 'drink', agent: 'cox', place: 'inn', start: 1300, end: 1500, causedBy: 'a_cox'}],
  signs: [
    {id: 's_wife', kind: 'testimony', speaker: 'cox', text: 'She never left the cottage.', claim: {pred: 'wasAt', person: 'wife', place: 'cottage', from: 1310, to: 1450}},
    {id: 's_cox', kind: 'record', text: 'The inn ledger.', claim: {pred: 'wasAt', person: 'cox', place: 'inn', from: 1310, to: 1450}},
    {id: 's_debt', kind: 'document', text: 'An IOU from Tom to the keeper.', claim: {pred: 'related', a: 'tom', rel: 'owes', b: 'keeper'}},
    {id: 's_holds', kind: 'record', text: 'Tom holds the gallery key.', claim: {pred: 'had', person: 'tom', item: 'gallery_key'}},
    {id: 'pub_window', kind: 'public', text: 'The keeper died between ten and midnight.', claim: {pred: 'crimeBetween', from: 1320, to: 1440}}]
});

// A false alibi from the wife (twist), defeated by the lamp log behind a key and a rule.
const twist = () => {
  const c = base();
  c.attitudes.push({id: 'a_wife_protect', agent: 'wife', mode: 'wants', content: 'protect tom'});
  c.signs.push({id: 's_alibi', kind: 'testimony', speaker: 'wife', because: ['a_wife_protect'], text: 'Tom was with me all night.',
    // with a 10-minute walk, at the cottage from 22:09 to 23:51 leaves no minute of 22:00 to 24:00 for the gallery
    claim: {pred: 'wasAt', person: 'tom', place: 'cottage', from: 1329, to: 1431}});
  c.signs.push({id: 's_key', kind: 'item', text: 'A key.'});
  c.signs.push({id: 's_log', kind: 'record', text: 'Lamp log.', requires: ['s_key'], needs: ['r_rule'], unlock: 'the key opens the log cabinet',
    reading: 'the manual says wicks are trimmed hourly', claim: {pred: 'wasAt', person: 'tom', place: 'gallery', from: 1400, to: 1402}, defeats: ['s_alibi']});
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
  const c = base(); c.signs = c.signs.filter(x => ['s_wife', 'pub_window'].includes(x.id));
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

test('rule signs teach only existing acquirable rules without needs', () => {
  let c = twist();
  let ruleSign = c.signs.find(x => x.id === 'r_rule');
  Object.assign(ruleSign, {requires: ['s_key'], unlock: 'the key opens the manual cabinet'});
  let r = certify(c);
  assert.ok(r.ok, JSON.stringify(r.errors));

  c = twist();
  c.signs.find(x => x.id === 'r_rule').rule = 'r_missing';
  assert.ok(certify(c).errors.includes('rule sign r_rule: rule must name an existing acquirable rule'));

  c = twist();
  ruleSign = c.signs.find(x => x.id === 'r_rule');
  Object.assign(ruleSign, {needs: ['r_trim'], reading: 'the manual explains itself'});
  assert.ok(certify(c).errors.includes("rule sign r_rule: must have no 'needs'; use 'requires' to model access"));
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

test('a trait clue rules out only those the player knows lack the trait', () => {
  const c = base(), glove = {id: 's_glove', kind: 'trace', text: 'A left-hand glove.', claim: {pred: 'culpritTrait', trait: 'handed', value: 'left'}};
  c.signs = [...c.signs.filter(x => ['s_debt', 's_holds'].includes(x.id)), glove];
  const r = certify(c); assert.equal(r.ok, false, 'nothing the player knows says who is right-handed');
  c.signs.push(...['wife', 'cox'].map(p => ({id: `pub_${p}`, kind: 'public', text: `${p} is right-handed.`, claim: {pred: 'hasTrait', person: p, trait: 'handed', value: 'right'}})));
  const ok = certify(c); assert.ok(ok.ok, JSON.stringify(ok.errors)); assert.deepEqual(ok.surface, ['h_tom']);
});

test('motive and means are detected; a world-fact relation rules nobody out', () => {
  const c = twist();
  c.relations.push({a: 'tom', rel: 'paid_by', b: 'smugglers'});
  c.signs.push({id: 's_pay', kind: 'document', text: 'A payment note.', requires: ['s_key'], unlock: 'the key opens his chest',
    claim: {pred: 'related', a: 'tom', rel: 'paid_by', b: 'smugglers'}});
  c.signs.push({id: 's_keyring', kind: 'trace', text: 'Whoever did it had the gallery key.', claim: {pred: 'culpritHad', item: 'gallery_key'}});
  const r = certify(c);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepEqual(r.motive, ['s_debt', 's_pay']); assert.deepEqual(r.means, ['s_keyring']);
  assert.equal(r.threads.h_wife, 0);
});

test('a false world fact is caught as an undefended false sign', () => {
  const c = twist();
  c.signs.push({id: 's_bad', kind: 'document', text: 'A note.', claim: {pred: 'related', a: 'wife', rel: 'paid_by', b: 'smugglers'}});
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
  d.signs.push({id: 's_hate', kind: 'testimony', speaker: 'cox', text: 'She hated him.', claim: {pred: 'related', a: 'wife', rel: 'hates', b: 'keeper'}});
  assert.equal(certify(d).ok, false, "an innocent's motive does not count as the culprit's");
});

test('a clue the history does not decide is refused, and an old case must be migrated', () => {
  const c = twist(); c.signs.find(x => x.id === 's_log').claim = {pred: 'wasAt', person: 'tom', place: 'gallery', from: 1395, to: 1405};
  assert.ok(certify(c).errors.some(e => e.includes('does not decide the claim of s_log')));
  const old = base(); delete old.claims_version;
  assert.match(certify(old).errors[0], /migrate the case/);
});

test('claims that cannot all be true need a recorded defeat, for every kind of claim', () => {
  const c = base();
  c.signs.push({id: 's_gone', kind: 'record', text: 'The key was handed in at nine.', claim: {pred: 'had', person: 'tom', item: 'gallery_key', when: 'never', from: 1300, to: 1500}});
  const r = certify(c);
  assert.ok(r.errors.some(e => e.includes('s_gone, s_holds cannot all be true')), JSON.stringify(r.errors));
});
