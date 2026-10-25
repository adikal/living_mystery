// The playtest interface: the player sees what a person would and nothing more, and a case can be solved through it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PlaytestGame} from '../tools/playtest/game.mjs';
import {hintFollower} from '../tools/playtest/scripted.mjs';

const CASES = ['mk-live-20261002-235614.json', 'mk-live-20261002-224855.json', 'mk-live-20261002-225824.json'];
const file = f => new URL(['mk-live-20261002-222517.json', 'mk-live-20261002-235614.json'].includes(f) ? `../dist/cases/archive/2026-10/${f}` : `../dist/cases/generated/${f}`, import.meta.url).pathname;

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

test('every menu case passes the scripted-player publication gate (a quoted question may name someone else)', async () => {
  const {scriptedChecks} = await import('../tools/playtest/scripted.mjs');
  const index = JSON.parse(readFileSync(new URL('../dist/cases/generated/index.json', import.meta.url), 'utf8'));
  for (const e of index) {
    const out = await scriptedChecks(new URL(`../dist/cases/generated/${e.file}`, import.meta.url).pathname);
    assert.deepEqual(out.problems, [], e.title);
  }
});
