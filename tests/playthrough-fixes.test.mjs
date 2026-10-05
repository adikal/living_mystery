// Fixes from a human play of Sealing Wax and Steel (October 2026): a familiar name in a character's own account; a
// guarded "I've said more than I ought" after a refused name; an innocent secret explained by the wrong reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {registerKernelCase, createSession, dispatch, caseTables} from '../dist/engine.mjs';
import {prepareCharacterTurn, proposeCharacterTurn, validateCharacterProposal, CHARACTER_PROMPT} from '../dist/character-turn.mjs';
import {BW_PEOPLE, BW_ROLE_WORDS} from '../dist/cases/village.mjs';

const dir = new URL('../dist/cases/generated/', import.meta.url);
const load = rel => JSON.parse(readFileSync(new URL(rel, dir), 'utf8'));
const CASE = 'mk-live-20261002-222517.json';
const session = () => { const s = createSession(1, registerKernelCase(load(CASE))); return {s, T: caseTables(s)}; };
const goTo = (s, pid) => { if (s.world.player.location !== s.world.npcs[pid].location) dispatch(s, {type: 'move', to: s.world.npcs[pid].location}); };
const reply = (account, utterance, intent = 'refuse') => ({plan: null, intent, account: account?.id ?? null, utterance,
  claims: account?.claims ?? [], sources: account?.sources ?? [], trust: 'unchanged', belief: 'remember_only', engagement: 'continue', rationale: 'r'});

test('a familiar name in an account puts that person in play: naming her properly is allowed', () => {
  const {s} = session();
  goTo(s, 'ada');
  dispatch(s, {type: 'ask', person: 'ada', topic: 'night'});      // "... Dora sat in the back parlour ..."
  const t = prepareCharacterTurn(s, {person: 'ada', text: 'who is Dora?', action: null});
  const v = validateCharacterProposal(t, reply(null, 'Dora? That is Miss Pruett, love, the postmistress.', 'clarify'));
  assert.ok(v.ok || !/wrong_or_new_name/.test(v.reason), v.reason);
});

test('every familiar name a published case uses for a person is declared in the setting', () => {
  const files = [...readdirSync(dir).filter(f => f.startsWith('mk-')), ...readdirSync(new URL('live/', dir)).filter(f => f.startsWith('mk-')).map(f => `live/${f}`)];
  for (const f of files) {
    const text = JSON.stringify(load(f));
    for (const [pid, p] of Object.entries(BW_PEOPLE)) {
      const word = pid[0].toUpperCase() + pid.slice(1), forms = [p.name, p.address, ...p.name.split(' '), ...(BW_ROLE_WORDS[pid] ?? [])];
      if (new RegExp(`\\b${word}\\b`).test(text) && !forms.some(x => x?.toLowerCase() === word.toLowerCase()))
        assert.fail(`${f}: "${word}" names ${p.name} but is not declared in BW_ROLE_WORDS`);
    }
  }
});

test('after code-check failures alone, the third attempt is an ordinary retry, not a guarded decline', async () => {
  const {s} = session();
  goTo(s, 'ada');
  const t = prepareCharacterTurn(s, {person: 'ada', text: 'who is the solicitor?', action: null});
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body), prompt = JSON.parse(body.prompt);
    if (body.system === CHARACTER_PROMPT) seen.push(prompt.revisionFeedback ?? []);
    // a reply with a number no account gives: refused by code, before the fact-checker
    return {ok: true, json: async () => ({text: JSON.stringify(reply(null, 'Oh, 42 years I have known him, love.'))})};
  };
  const mem = new Map([['living-mystery.llm.enabled', '1'], ['living-mystery.llm.endpoint', 'http://127.0.0.1:1/']]);
  await proposeCharacterTurn(t, {store: {getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v)}, fetchImpl});
  assert.equal(seen.length, 3);
  assert.ok(!seen[2].some(v => /previous replies revealed/.test(v)), 'no guarded instruction after code checks alone');
});

test('an innocent secret is explained by the attitude behind that behaviour', () => {
  const {T} = session();
  const why = T.behavior.innocentReason('ada', 'b_ada_cash');
  assert.match(why.content, /owes the vicar/);
});

// From the bug detectors over recorded playtests: replies refused because the name check did not know a familiar form of
// a place ("the Rook"), or did not know that the examiner, like the constable, is known to everyone after a death.
test('a keeper is in play once any form of their place is mentioned, and the setting roles always are', () => {
  const {s} = session();
  goTo(s, 'edmund');
  const t = prepareCharacterTurn(s, {person: 'edmund', text: 'What time did they close the Rook last night?', action: null});
  const keeper = validateCharacterProposal(t, reply(null, 'Ask Mrs Finch, old thing; I was in my cups.', 'refuse'));
  assert.ok(keeper.ok || !/wrong_or_new_name/.test(keeper.reason), keeper.reason);
  const examiner = validateCharacterProposal(t, reply(null, 'Dr Marsh would know better than I, dear fellow.', 'refuse'));
  assert.ok(examiner.ok || !/wrong_or_new_name/.test(examiner.reason), examiner.reason);
  const stranger = validateCharacterProposal(t, reply(null, 'Mr Voss was there, I think.', 'refuse'));
  assert.ok(!stranger.ok && /wrong_or_new_name/.test(stranger.reason), 'someone not in play is still refused');
});

test('a reply word for word the same as one the person already gave is refused', () => {
  const {s} = session();
  goTo(s, 'ada');
  const t = prepareCharacterTurn(s, {person: 'ada', text: 'Anything else?', action: null});
  t.context.character.history = [{speaker: 'ada', text: '“I keep myself to myself, love.”'}];
  const v = validateCharacterProposal(t, reply(null, 'I keep myself to myself, love.', 'refuse'));
  assert.ok(!v.ok && /repeated_reply/.test(v.reason), v.reason);
});
