// The playtest interface: the player sees what a person would and nothing more, and a case can be solved through it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PlaytestGame} from '../tools/playtest/game.mjs';

const CASES = ['mk-live-20261002-235614.json', 'mk-live-20261002-224855.json', 'mk-live-20261002-225824.json'];
const file = f => new URL(f === 'mk-live-20261002-222517.json' ? `../dist/cases/archive/2026-10/${f}` : `../dist/cases/generated/${f}`, import.meta.url).pathname;

// A player that follows the most explicit hint, choosing by what it can see (labels, question texts, names).
async function hintFollower(g, maxSteps = 200) {
  for (let i = 0; i < maxSteps && !g.done; i++) {
    let r = await g.act({type: 'hint'});
    while (g.hint.level < 3) r = await g.act({type: 'hint'});
    const hint = r.observation.just_happened.find(n => n.speaker === 'Hint').text, o = r.observation;
    const quoted = (hint.match(/“([^”]+)”/) ?? [])[1];
    const place = o.map.find(m => hint.includes(m.name) || hint.toLowerCase().includes(m.name.toLowerCase().replace(/^the /, '')));
    const person = Object.values(g.T.PEOPLE).find(p => hint.includes(p.name));
    const pid = person && Object.keys(g.T.PEOPLE).find(k => g.T.PEOPLE[k] === person);
    if (/^Take your notebook/.test(hint) || g.hint.key === 'accuse') {
      const post = g.s.world.npcs[g.T.CASE.constable].location;
      if (o.place !== post) await g.act({type: 'move', to: post});
      const kc = g.records;
      await g.act({type: 'accuse', suspect: g.T.behavior.caseStatus(g.s).lead, method: kc.answer.method, motive: kc.answer.motive});
      continue;
    }
    if (/^Examine/.test(hint)) {
      if (place && o.place !== place.place) { await g.act({type: 'move', to: place.place}); continue; }
      const thing = g.observe().things_here.find(t => t.label === quoted || hint.includes(t.label));
      if (thing) { await g.act({type: 'examine', thing: thing.id}); continue; }
    }
    if (pid && /^(Ask|Show)/.test(hint)) {
      const where = g.s.world.npcs[pid].travel?.to ?? g.s.world.npcs[pid].location;
      if (o.place !== where) { await g.act({type: 'move', to: where}); continue; }
      const here = g.observe().people_here.find(p => p.id === pid);
      const q = here?.questions.find(x => x.text === quoted);
      if (q) { await g.act({type: 'ask', person: pid, question: q.id}); continue; }
      const item = g.observe().inventory.find(e => hint.includes(e.title));
      if (item) { await g.act({type: 'show', person: pid, item: item.id}); continue; }
    }
    if (place && o.place !== place.place) { await g.act({type: 'move', to: place.place}); continue; }
    await g.act({type: 'wait', minutes: 5});
  }
  return g;
}

test('the observation holds only what a person can see: no record ids, no truth, no hidden leads', async () => {
  for (const f of CASES) {
    const g = await PlaytestGame.create(file(f), {ai: false, director: false});
    const kc = g.records, locked = new Set(g.s.world.flags.lockedObjects);
    await hintFollower(g, 25);
    const text = JSON.stringify(g.observe());
    for (const x of kc.signs) assert.ok(!text.includes(`"${x.id}"`) && !text.includes(`:${x.id}`), `${f}: record id ${x.id} visible`);
    for (const id of locked) if (g.s.world.flags.lockedObjects.includes(id))
      assert.ok(!text.includes(kc.signs.find(x => x.id === id).title), `${f}: hidden lead ${id} visible`);
    assert.ok(!/"truth"|"deceptive"|"culprit"|"claim"/.test(text), `${f}: truth labels visible`);
  }
});

test('a case can be solved through the interface alone (a hint-following player, no AI)', async () => {
  for (const f of CASES) {
    const g = await hintFollower(await PlaytestGame.create(file(f), {ai: false, director: false, budget: {actions: 400, minutes: 24 * 60}}));
    assert.equal(g.outcome, 'solved', `${f}: ${g.outcome} after ${g.actions} actions; last hint ${g.hint.key}`);
    const rep = g.report();
    assert.equal(rep.trace.at(-1).accusation?.suspect, rep.truth);
    assert.ok(rep.trace.every(t => t.status && Array.isArray(t.new_evidence)), 'every step is traced');
  }
});

test('handles are opaque and refuse what is not here', async () => {
  const g = await PlaytestGame.create(file(CASES[0]), {ai: false, director: false});
  assert.match((await g.act({type: 'examine', thing: 't999'})).error, /nothing like that/);
  assert.match((await g.act({type: 'ask', person: 'nobody', question: 'q1'})).error, /not here/);
  assert.match((await g.act({type: 'fly'})).error, /Unknown action/);
  assert.equal(g.actions, 0, 'refused actions cost nothing');
});
