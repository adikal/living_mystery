import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerKernelCase, createSession, dispatch, caseTables} from '../dist/engine.mjs';

// a case kept for tests after it left the menu is read from the archive
const load = f => JSON.parse(readFileSync(new URL(f === 'mk-live-20261002-222517.json' ? `../dist/cases/archive/2026-10/${f}` : `../dist/cases/generated/${f}`, import.meta.url), 'utf8'));
const truthOf = kc => kc.question.candidates.find(h => h.id === kc.question.truth).facts.actor;

// Collect every reachable clue by examining and asking, in dependency order, with the plain (scripted) actions.
function gatherAll(s, kc) {
  const T = caseTables(s);
  for (let round = 0; round < 12; round++) {
    const before = s.world.player.evidence.length;
    for (const x of kc.signs) {
      if (s.world.player.evidence.some(e => e.clue === x.id)) continue;
      if (T.OBJECTS[x.id] && x.at && T.LOCATIONS[x.at]) {
        if (s.world.player.location !== x.at) dispatch(s, {type: 'move', to: x.at});
        dispatch(s, {type: 'inspect', object: x.id});
      } else if (x.speaker && s.world.npcs[x.speaker]) {
        const where = s.world.npcs[x.speaker].travel?.to ?? s.world.npcs[x.speaker].location;
        if (s.world.player.location !== where && T.LOCATIONS[where]) dispatch(s, {type: 'move', to: where});
        for (const [topic] of [...(T.CASE.topicsFor?.[x.speaker] ?? []), ...T.behavior.followupOptions(s, x.speaker)])
          dispatch(s, {type: 'ask', person: x.speaker, topic});
      }
    }
    if (s.world.player.evidence.length === before) break;
  }
}

test('stress follows the history: the culprit, still standing as the field narrows, is the most stressed suspect', () => {
  const kc = load('mk-live-20261002-235614.json'), s = createSession(1, registerKernelCase(kc)), truth = truthOf(kc);
  const start = Object.fromEntries(Object.entries(s.world.npcs).map(([p, n]) => [p, n.stress]));
  assert.ok(Object.values(start).every(v => v === start[truth]), 'everyone starts equally calm');
  gatherAll(s, kc);
  const st = caseTables(s).behavior.caseStatus(s);
  assert.deepEqual(st.remaining, [truth], 'the gathered evidence settles it');
  const suspects = kc.question.candidates.map(h => h.facts.actor);
  assert.ok(s.world.npcs[truth].stress > start[truth]);
  for (const p of suspects) if (p !== truth) assert.ok(s.world.npcs[truth].stress >= s.world.npcs[p].stress, `${p} is not more stressed than the culprit`);
  assert.ok(s.events.some(e => e.kind === 'emotion' && e.changes.some(c => c.path === `npcs.${truth}.stress`)), 'changes are events (they replay)');
});

test('Bell says which held clue cannot be read yet', () => {
  const kc = load('mk-live-20261002-224855.json'), s = createSession(1, registerKernelCase(kc));
  const x = kc.signs.find(y => (y.needs || []).length && !(y.requires || []).length && caseTables(s).OBJECTS[y.id]);
  if (s.world.player.location !== x.at) dispatch(s, {type: 'move', to: x.at});
  dispatch(s, {type: 'inspect', object: x.id});
  const v = caseTables(s).behavior.checkCase(s, {type: 'accuse', suspect: truthOf(kc), method: kc.answer.method, motive: kc.answer.motive});
  assert.equal(v.supported, false);
  assert.match(v.feedback, new RegExp(caseTables(s).CLUES[x.id].title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(v.feedback, /depends on/);
});

test('the accusation goes to whoever the setting makes constable, at their post (no fixed person or place)', () => {
  const kc = load('mk-live-20261002-224855.json');
  const other = kc.people.map(p => p.id).find(p => p !== kc.victim && !kc.question.candidates.some(h => h.facts.actor === p) && p !== 'bell');
  kc.setting.roles = {...(kc.setting.roles || {}), constable: other};
  kc.id = kc.id + '-alt-constable';
  const s = createSession(1, registerKernelCase(kc)), T = caseTables(s);
  assert.equal(T.CASE.constable, other);
  const post = s.world.npcs[other].location;
  assert.equal(s.world.player.location, post, 'the investigation starts at the constable\'s post');
  assert.ok((T.CASE.topicsFor[other] || []).some(([t]) => t === 'case'), 'the constable briefs');
  const away = Object.keys(T.LOCATIONS).find(l => l !== post);
  dispatch(s, {type: 'move', to: away});
  dispatch(s, {type: 'accuse', suspect: kc.question.candidates[0].facts.actor, method: kc.answer.method, motive: kc.answer.motive});
  const r = s.events.filter(e => e.kind === 'rejected').at(-1);
  assert.match(r.playerText, new RegExp(T.PEOPLE[other].name.split(' ').at(-1)), 'told to take it to the constable by name');
});

test('everyone starts where the history leaves them this morning, and the detective starts with the constable', () => {
  for (const f of ['mk-live-20261002-224855.json', 'mk-live-20261002-225824.json', 'mk-live-20261002-222517.json']) {
    const kc = load(f), s = createSession(1, registerKernelCase(kc)), T = caseTables(s), morning = kc.setting.day.morning;
    for (const [pid, n] of Object.entries(s.world.npcs)) {
      const odd = kc.signs.find(x => x.kind === 'behavior' && x.about === pid && T.LOCATIONS[x.at]);
      const last = kc.events.filter(e => (e.agent === pid || (e.others || []).includes(pid)) && e.start >= morning && T.LOCATIONS[e.place]).sort((a, b) => a.start - b.start).at(-1);
      const want = odd?.at ?? last?.place ?? n.location;
      assert.equal(n.location, want, `${f}: ${pid}`);
    }
    assert.equal(s.world.player.location, s.world.npcs[T.CASE.constable].location, `${f}: the detective meets the constable`);
  }
});

test('hints follow the solution: the first hint leads toward a sign the solution needs, not a neutral account', () => {
  const kc = load('mk-live-20261002-235614.json'), s = createSession(1, registerKernelCase(kc)), T = caseTables(s);
  const h = T.behavior.hints(s), x = kc.signs.find(y => y.id === h.id);
  assert.ok(x, h.id);
  assert.ok(!x.sighting && !x.surface && !x.morning, `hinted ${h.id}, a neutral account`);
});

test('people present when the detective finds something remember seeing it (and nobody elsewhere does)', () => {
  const kc = load('mk-live-20261002-235614.json'), s = createSession(1, registerKernelCase(kc)), T = caseTables(s);
  const x = kc.signs.find(y => T.OBJECTS[y.id] && !(y.requires || []).length && Object.values(s.world.npcs).some(n => n.location === y.at));
  if (s.world.player.location !== x.at) dispatch(s, {type: 'move', to: x.at});
  dispatch(s, {type: 'inspect', object: x.id});
  const found = s.events.find(e => e.kind === 'evidence' && e.data.clue === x.id);
  for (const [p, n] of Object.entries(s.world.npcs))
    assert.equal(n.memories.includes(found.id), n.location === x.at && !n.travel, p);
});

test('a character may ask the detective to be clearer once, not twice running', async () => {
  const {validateCharacterProposal} = await import('../dist/character-turn.mjs');
  const ticket = {context: {character: {conversation: {lastIntent: 'clarify'}}}};
  const r = validateCharacterProposal(ticket, {intent: 'clarify'});
  assert.equal(r.ok, false);
  assert.match(r.reason, /^repeated_clarify/);
});

test('a person knows what they did this morning: their own completed steps are in their memories and their perspective', async () => {
  const Morning = await import('../dist/morning.mjs');
  const {prepareCharacterTurn} = await import('../dist/character-turn.mjs');
  const kc = load('mk-live-20261002-235614.json'), s = createSession(1, registerKernelCase(kc)), T = caseTables(s), ctx = T.behavior.morningCtx;
  const pid = Morning.actors(s, kc, ctx.roles, ctx.victim).find(p => s.world.npcs[p].location !== s.world.player.location);
  const to = Object.keys(T.LOCATIONS).find(l => l !== s.world.npcs[pid].location && l !== s.world.player.location);
  const id = Morning.install(T.kernel, s, {[pid]: [{kind: 'go', place: to, because: []}]}, s.events.at(-1).id, {});
  T.kernel.decide(s, pid, id);
  dispatch(s, {type: 'wait', minutes: 60});
  const done = s.events.find(e => e.actor === pid && e.data?.morning && e.data.step?.state === 'done');
  assert.ok(done && s.world.npcs[pid].memories.includes(done.id), 'remembered');
  if (s.world.player.location !== s.world.npcs[pid].location) dispatch(s, {type: 'move', to: s.world.npcs[pid].location});
  const t = prepareCharacterTurn(s, {person: pid, text: 'Where have you been this morning?', action: null});
  assert.ok(t.context.character.didToday.some(x => x.did.startsWith('I went to')), JSON.stringify(t.context.character.didToday));
});
