// A rejected free-text turn ends in the person's own words (the case's declines), and the same words do not repeat at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerKernelCase, createSession, dispatch, caseTables} from '../dist/engine.mjs';
import {prepareCharacterTurn, applyCharacterTurn} from '../dist/character-turn.mjs';
import {NEUTRAL_LINE} from '../dist/kernel.mjs';

const base = () => JSON.parse(readFileSync(new URL('../dist/cases/archive/2026-10/mk-live-20261002-235614.json', import.meta.url), 'utf8'));
function setup(declinesFor) {
  const kc = base(), pid = kc.people.map(p => p.id).find(p => p !== kc.victim && p !== kc.setting.roles.constable);
  kc.id += `-declines-${Object.keys(declinesFor(pid)).length}`; kc.declines = declinesFor(pid);
  const s = createSession(1, registerKernelCase(kc));
  if (s.world.player.location !== s.world.npcs[pid].location) dispatch(s, {type: 'move', to: s.world.npcs[pid].location});
  return {s, pid};
}
const rejectedTurn = (s, pid, text) => {
  const t = prepareCharacterTurn(s, {person: pid, text, action: null});
  applyCharacterTurn(s, t, {audit: {status: 'fallback', reason: 'rejected', context: t.context, attempts: []}, proposal: null});
  return s.events.findLast(e => e.kind === 'speech' && e.actor === pid).data.assertion;
};

test('a rejected free-text turn ends with the person\'s own decline, rotating', () => {
  const lines = ['Couldn\'t say, I\'m sure.', 'Not my place to say, detective.', 'I never noticed, to be honest.'];
  const plain = setup(() => ({}));
  assert.equal(rejectedTurn(plain.s, plain.pid, 'What colour is the sky?'), NEUTRAL_LINE, 'no declines: the stock line');
  const {s, pid} = setup(p => ({[p]: lines}));
  const said = [rejectedTurn(s, pid, 'Who did it?'), rejectedTurn(s, pid, 'Really, who?'), rejectedTurn(s, pid, 'Tell me.')];
  assert.deepEqual(said, lines, 'each decline in turn, none repeated at once');
  assert.ok(caseTables(s).behavior.isDecline(pid, said[0]));
});

// A rejected free-text account choice is audit evidence only. The safe fallback declines rather than promoting an
// account whose relevance or wording did not pass review.
const rejectedChoosing = (s, pid, text, pick) => {
  const t = prepareCharacterTurn(s, {person: pid, text, action: null});
  const account = pick(t.context.accounts);
  const response = JSON.stringify({plan: null, intent: account.deceptive ? 'deceive' : 'answer', account: account.id, utterance: 'Something embellished.',
    claims: account.claims, sources: account.sources, trust: 'unchanged', belief: 'remember_only', engagement: 'continue', rationale: 'r'});
  applyCharacterTurn(s, t, {audit: {status: 'fallback', reason: 'rejected', context: t.context,
    attempts: [{generation: {response}, validation: 'pass', critic: {response: '{"verdict":"reject","violations":["embellished"]}'}}]}, proposal: null});
  return {account, said: s.events.findLast(e => e.kind === 'speech' && e.actor === pid).data.assertion};
};

test('a rejected free-text account choice declines without committing that account', () => {
  const lines = ['Couldn\'t say, I\'m sure.'];
  const {s, pid} = setup(p => ({[p]: lines}));
  const first = rejectedChoosing(s, pid, 'Tell me about last night, in detail.', accounts => accounts[0]);
  assert.equal(first.said, lines[0]);
  assert.ok(!s.world.player.evidence.some(e => e.clue === first.account.accountTopic));
  const again = rejectedChoosing(s, pid, 'And once more?', accounts => accounts.find(a => a.id === first.account.id) ?? accounts[0]);
  assert.equal(again.account.id, first.account.id);
  assert.equal(again.said, lines[0]);
});
