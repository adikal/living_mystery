// Showing one person's account to another (play-testing, A Fall Before Midnight, November 8): the detective's line
// keeps the account its speaker's ("You told me..." is said only to the speaker), and the listener relates it to what
// they know themselves: their own account of an event they both took part in, or their own statement already told that
// the case records as showing it untrue.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {registerKernelCase, createSession, dispatch, caseTables} from '../dist/engine.mjs';

const dir = new URL('../dist/cases/generated/', import.meta.url);
const menu = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')).map(e => e.file);
const load = f => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const start = kc => { const s = createSession(1, registerKernelCase(kc)), T = caseTables(s); return {s, T, K: T.kernel}; };
const goTo = (s, pid) => { const at = s.world.npcs[pid].location; if (s.world.player.location !== at) dispatch(s, {type: 'move', to: at}); };
const give = (s, K, ids) => { for (const id of ids) if (!K.has(s, id)) K.addEvidence(s, id, s.events.at(-1).id, 'test'); };
const said = (s, actor, listener) => s.events.findLast(e => e.kind === 'speech' && e.actor === actor
  && (actor === 'player' ? e.data?.listener === listener : e.data?.listener === 'player')).data.assertion;
const LISTENER_SAID = /\byou('ve| have| had| now)? (told|said|say|mentioned|claimed|claim)\b/i;

for (const f of menu) {
  test(`${f}: an account put to anyone but its speaker never gives it to the listener`, () => {
    const kc = load(f);
    for (const x of kc.signs.filter(y => y.kind === 'testimony' && y.speaker)) {
      for (const pid of [x.to, ...kc.people.map(p => p.id)].filter(p => p && p !== x.speaker).slice(0, 4)) {
        const {s, K} = start(kc);
        if (!s.world.npcs[pid]) continue;
        give(s, K, [x.id]);
        goTo(s, pid);
        dispatch(s, {type: 'present', person: pid, clue: x.id, tone: 'private'});
        const line = said(s, 'player', pid);
        assert.ok(!LISTENER_SAID.test(line), `${x.id} to ${pid}: "${line}"`);
      }
    }
  });
}

// the case of the November 8 play, archived since with its records intact
const FALL = '../archive/2026-10/mk-live-20261003-133036.json';

test('the constable shown Pike\'s morning answers with his own account of being fetched', () => {
  const kc = load(FALL), {s, K, T} = start(kc), bell = T.CASE.constable;
  const pike = kc.signs.find(x => x.morning && x.speaker === 'rowan'), his = kc.signs.find(x => x.morning && x.speaker === bell);
  assert.ok(pike && his, 'both mornings are published');
  give(s, K, [pike.id]);
  goTo(s, bell);
  dispatch(s, {type: 'present', person: bell, clue: pike.id, tone: 'private'});
  assert.equal(said(s, bell), his.text, 'not yet told: he gives it now');
  assert.ok(K.has(s, his.id));
  dispatch(s, {type: 'present', person: bell, clue: pike.id, tone: 'private'});
  assert.equal(said(s, bell), `As I told you: ${his.text.replace(/^[“"]|[”"]$/g, '')}`);
});

test('a listener whose statement, already told, shows the account untrue says so; one not yet told is kept back', () => {
  const kc = load(FALL), call = kc.signs.find(x => x.id === 's_call'), dora = kc.signs.find(x => x.id === 's_surface_dora');
  assert.ok(call.defeats.includes('s_dora'), 'the exchange call shows the postmistress was not at her board');
  for (const told of [false, true]) {
    const {s, K} = start(kc);
    give(s, K, [...call.requires, dora.id, ...(told ? [call.id] : [])]);
    goTo(s, 'edmund');
    dispatch(s, {type: 'present', person: 'edmund', clue: dora.id, tone: 'private'});
    const reply = said(s, 'edmund'), plain = t => t.replace(/[“”"]/g, '');
    if (told) assert.ok(plain(reply).includes(plain(call.text)), reply);
    else assert.ok(!reply.includes(call.text) && !/exchange|telephone|call/i.test(reply), reply);
  }
});

test('the culprit caught in a lie with nothing written for it minimises, never giving the reasons behind it', () => {
  const kc = load(FALL), call = kc.signs.find(x => x.id === 's_call'), dora = kc.signs.find(x => x.id === 's_dora');
  delete call.reactions;
  const {s, K} = start(kc);
  give(s, K, [...call.requires, call.id, dora.id]);
  goTo(s, 'dora');
  dispatch(s, {type: 'present', person: 'dora', clue: call.id, tone: 'private'});
  const reply = said(s, 'dora');
  const reasons = kc.attitudes.filter(a => a.agent === 'dora').map(a => a.content.split(/\s+/).slice(1, 5).join(' '));
  assert.ok(!reasons.some(r => reply.includes(r)), reply);
  assert.match(reply, /proves nothing/);
});

test('the culprit minimises in their own published words when the case has them', () => {
  const kc = load(FALL), call = kc.signs.find(x => x.id === 's_call'), dora = kc.signs.find(x => x.id === 's_dora');
  delete call.reactions;
  kc.minimise = {dora: ['Well. I may have misremembered. It signifies nothing, Inspector.']};
  const {s, K} = start(kc);
  give(s, K, [...call.requires, call.id, dora.id]);
  goTo(s, 'dora');
  dispatch(s, {type: 'present', person: 'dora', clue: call.id, tone: 'private'});
  assert.equal(said(s, 'dora'), kc.minimise.dora[0]);
});
