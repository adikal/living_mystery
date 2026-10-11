// A spoken time is checked by the time it names, not its spelling: "half-past eleven" in the account allows "half past
// eleven" and "23:30"; a time from the detective's question ("9:30") allows "half past nine"; a new time is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerKernelCase, createSession, dispatch} from '../dist/engine.mjs';
import {prepareCharacterTurn, validateCharacterProposal} from '../dist/character-turn.mjs';

const kc = JSON.parse(readFileSync(new URL('../dist/cases/generated/mk-live-20261002-222517.json', import.meta.url), 'utf8'));
function ticketWith(statement, question = 'What is your account of last night?', deceptive = false) {
  const s = createSession(1, registerKernelCase(kc));
  if (s.world.player.location !== s.world.npcs.ada.location) dispatch(s, {type: 'move', to: s.world.npcs.ada.location});
  const t = prepareCharacterTurn(s, {person: 'ada', text: question, action: {type: 'ask', person: 'ada', topic: 'night'}});
  t.context.accounts[0] = {...t.context.accounts[0], statement, deceptive};
  t.context.player.utterance = question;
  return t;
}
const reply = (t, utterance) => {
  const a = t.context.accounts[0];
  return validateCharacterProposal(t, {plan: null, intent: a.deceptive ? 'deceive' : 'answer', account: a.id, utterance, claims: a.claims, sources: a.sources,
    trust: 'unchanged', belief: 'remember_only', engagement: 'continue', rationale: 'r'});
};
const timeFailure = v => !v.ok && /invented_time/.test(v.reason);

test('the same time in another spelling is not an invented time', () => {
  const t = ticketWith('We went on rather late, past half-past eleven.');
  assert.ok(!timeFailure(reply(t, 'We talked till gone half past eleven, love.')));
  assert.ok(!timeFailure(reply(t, 'We talked till eleven-thirty, love.')));
});
test('a time the detective gave as figures may be spoken in words', () => {
  const t = ticketWith('I was behind the bar all evening.', 'Was Dora here at 9:30?');
  assert.ok(!timeFailure(reply(t, 'At half past nine? Behind the bar, I was, love.')));
});
test('a time no one has given is still refused', () => {
  const t = ticketWith('I was behind the bar all evening.');
  assert.ok(timeFailure(reply(t, 'Behind the bar till ten o\u2019clock, love.')));
});

test('"half nine" is half past nine', () => {
  const t = ticketWith('Dora sat in my parlour from half nine till gone eleven.');
  assert.ok(!timeFailure(reply(t, 'From nine-thirty she sat there, love.')));
  assert.ok(!timeFailure(reply(t, 'From half past nine she sat there, love.')));
  assert.ok(timeFailure(reply(t, 'From half ten she sat there, love.')), 'a different time is still refused');
});

test('a deceptive account may embellish with an invented time (a lie, not a leak); an honest one may not', () => {
  const lie = ticketWith('I was behind the bar all evening.', 'What time did you lock up?', true);
  assert.ok(!timeFailure(reply(lie, 'Eleven o’clock, I should think, love.')), 'a liar pressed for a time may give one');
  const honest = ticketWith('I was behind the bar all evening.', 'What time did you lock up?', false);
  assert.ok(timeFailure(reply(honest, 'Eleven o’clock, I should think, love.')), 'an honest account may not invent a time');
});

test('hyphenated spellings on both sides ("quarter-to-one") are the same time', () => {
  const t = ticketWith('I left at a quarter to one.');
  assert.ok(!timeFailure(reply(t, 'I was gone by quarter-to-one, love.')));
});
