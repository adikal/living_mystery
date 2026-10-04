import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerKernelCase, createSession, dispatch, caseTables, exportSession, diagnostics} from '../dist/engine.mjs';
import {context, criticise, stillSolvable, directMorning, DIRECTOR_PROMPT} from '../dist/morning-director.mjs';
import * as Morning from '../dist/morning.mjs';

const load = () => JSON.parse(readFileSync(new URL('../dist/cases/generated/mk-live-20261002-235614.json', import.meta.url), 'utf8'));
function questioned() {
  const kc = load(), s = createSession(1, registerKernelCase(kc)), T = caseTables(s), ctx = T.behavior.morningCtx;
  const [a, b] = Morning.actors(s, kc, ctx.roles, ctx.victim);
  for (const p of [a, b]) { if (s.world.player.location !== s.world.npcs[p].location) dispatch(s, {type: 'move', to: s.world.npcs[p].location}); dispatch(s, {type: 'ask', person: p, topic: 'night'}); }
  return {kc, s, ctx, a, b};
}
const proxy = (director, critic = items => ({verdicts: Object.fromEntries(Object.keys(items).map(k => [k, {ok: true}]))})) => async (url, init) => {
  const body = JSON.parse(init.body), prompt = JSON.parse(body.prompt);
  const out = body.system === DIRECTOR_PROMPT ? director(prompt) : critic(prompt);
  return {ok: true, json: async () => ({text: JSON.stringify(out)})};
};

test('each person sees only their own history and what they may say; the village sees whom the detective questioned', () => {
  const {s, a, b} = questioned();
  const c = context(s);
  assert.ok(c.people[a].sayable.some(x => x.text.startsWith('I told the detective')));
  assert.ok(!c.people[a].sayable.some(x => x.id.startsWith(`k_said_`) && c.people[b].sayable.some(y => y.id === x.id)), 'what b said is not a\'s to repeat');
  // only someone who was there saw the detective question b; it reaches others only by being told
  const bName = s.world.caseRecords.people.find(p => p.id === b).name, bAt = s.world.npcs[b].location;
  const knows = p => c.people[p]?.sayable.some(x => x.id === 'k_village_questioned' && x.text.includes(bName));
  for (const p of Object.keys(c.people)) if (p !== b) assert.equal(knows(p), s.world.npcs[p].location === bAt, `${p} ${s.world.npcs[p].location} vs ${bAt}`);
});

test('critics: code drops what cannot be done, the line critic drops what is said without grounds, a step after a failure is dropped', async () => {
  const {s, a, b} = questioned();
  const ka = Morning.knowledge(s, s.world.caseRecords, a, caseTables(s).behavior.morningCtx.people, caseTables(s).behavior.morningCtx.places);
  const proposal = {agendas: {
    [a]: [{kind: 'meet', with: b, place: s.world.npcs[b].location, say: 'They asked me where I was.', because: [ka.sayable[0].id]},
          {kind: 'go', place: 'inn', because: []}],
    [b]: [{kind: 'go', place: 'nowhere', because: []}]}};
  const {plan, audit} = await criticise(s, proposal, {lineCritic: async items => ({verdicts: Object.fromEntries(Object.keys(items).map(k => [k, {ok: false, why: 'test'}]))})});
  assert.ok(audit.code.some(e => e.includes('nowhere')));
  assert.equal(plan[a], undefined, 'the rejected meeting and everything after it are dropped');
  assert.equal(audit.lines[`${a}:0`], 'test');
});

test('a concealment is admitted only if the case still certifies without the clue', () => {
  const kc = load();
  const results = kc.signs.filter(x => ['document', 'item', 'record', 'trace'].includes(x.kind)).map(x => stillSolvable(kc, [x.id]).ok);
  assert.ok(results.includes(true) && results.includes(false), 'some clues can go, others the solution needs');
});

test('the director runs detached: installs a checked plan, and nothing if the world changed meanwhile', async () => {
  const {s, a, b} = questioned();
  s.world.minute = Math.max(s.world.minute, s.world.caseRecords.setting.day.start);
  const director = c => ({agendas: {[a]: [{kind: 'go', place: Object.keys(c.places).find(p => p !== c.people[a].at), because: [c.people[a].private[0].id]}]}, why: 'test'});
  const r = await directMorning(s, {fetchImpl: proxy(director), endpoint: 'http://x/'});
  assert.equal(r.status, 'accepted');
  assert.ok(s.world.flags.morning.agendas[a]);
  assert.equal((await directMorning(s, {fetchImpl: proxy(director), endpoint: 'http://x/'})).status, 'not_needed', 'not again at once');
  // stale: the player acts while the director is thinking
  dispatch(s, {type: 'wait', minutes: 16});
  const slow = proxy(c => { dispatch(s, {type: 'look'}); return director(c); });
  assert.equal((await directMorning(s, {fetchImpl: slow, endpoint: 'http://x/'})).status, 'stale');
});

test('the village re-plans every 15 minutes, and sooner (after 5) when the detective shows someone a clue or finds one about them', async () => {
  const {kc, s, a} = questioned();
  s.world.minute = Math.max(s.world.minute, kc.setting.day.start);
  const empty = proxy(() => ({agendas: {}, why: 'quiet'}));
  assert.equal((await directMorning(s, {fetchImpl: empty, endpoint: 'x'})).status, 'empty');
  dispatch(s, {type: 'wait', minutes: 6});
  assert.equal((await directMorning(s, {fetchImpl: empty, endpoint: 'x'})).status, 'not_needed', 'nothing has happened');
  // the detective finds and shows a clue that concerns someone
  const x = kc.signs.find(y => ['document', 'item', 'record', 'trace'].includes(y.kind) && !(y.requires || []).length && (y.about || y.claim?.person || y.claim?.a));
  if (s.world.player.location !== x.at) dispatch(s, {type: 'move', to: x.at});
  dispatch(s, {type: 'inspect', object: x.id});
  const r = await directMorning(s, {fetchImpl: empty, endpoint: 'x'});
  assert.equal(r.status, 'empty');
  assert.match(r.audit.trigger, /found|showed/);
  dispatch(s, {type: 'wait', minutes: 15});
  assert.equal((await directMorning(s, {fetchImpl: empty, endpoint: 'x'})).audit.trigger, 'time');
});

test('the newest judgement wins: re-planned and rejected, an earlier meeting does not run on', async () => {
  const {s, a, b} = questioned();
  s.world.minute = Math.max(s.world.minute, s.world.caseRecords.setting.day.start);
  const meet = c => ({agendas: {[a]: [{kind: 'meet', with: b, place: c.people[b].at, say: 'They asked me where I was.', because: [c.people[a].sayable[0].id]}]}, why: 't'});
  assert.equal((await directMorning(s, {fetchImpl: proxy(meet), endpoint: 'x'})).status, 'accepted');
  const pending = () => (s.world.flags.morning.agendas[a] ?? []).some(x => ['pending', 'active'].includes(x.state));
  assert.ok(pending());
  // the next round plans the same meeting, and the line critic now rejects it
  const no = async items => ({verdicts: Object.fromEntries(Object.keys(items).map(k => [k, {ok: false, why: 'unfounded'}]))});
  const r = await criticise(s, meet(context(s)), {lineCritic: no});
  assert.deepEqual(r.plan, {});
  assert.deepEqual(r.replanned, [a]);
  const K = caseTables(s).kernel;
  Morning.install(K, s, r.plan, s.events.at(-1).id, r.audit, r.replanned);
  assert.ok(!pending(), 'the rejected line is not said later');
  assert.ok(diagnostics(s).ok);
  // a round that plans for nobody leaves plans alone
  Morning.install(K, s, {[b]: [{kind: 'go', place: s.world.npcs[a].location, because: []}]}, s.events.at(-1).id);
  Morning.install(K, s, {}, s.events.at(-1).id);
  assert.ok(s.world.flags.morning.agendas[b].some(x => x.state === 'pending'));
});

test('the code critic\'s reasons go back to the director once, and the mended plan is used', async () => {
  const {s, a, b} = questioned();
  s.world.minute = Math.max(s.world.minute, s.world.caseRecords.setting.day.start);
  const seen = [];
  const director = c => {
    seen.push(c);
    const cite = c.previous_attempt ? c.people[a].sayable[0].id : c.people[a].private[0].id;   // first rests on private history
    return {agendas: {[a]: [{kind: 'meet', with: b, place: c.people[b].at, say: 'They asked me where I was.', because: [cite]}]}, why: 't'};
  };
  const r = await directMorning(s, {fetchImpl: proxy(director), endpoint: 'x'});
  assert.equal(seen.length, 2);
  assert.ok(seen[1].rejected.some(e => e.includes('may say')));
  assert.equal(r.status, 'accepted');
  assert.ok(r.audit.revised.length);
  assert.equal(r.plan[a][0].kind, 'meet');
});

test('a plan starts when it is made', async () => {
  const {s, a} = questioned();
  s.world.minute = Math.max(s.world.minute, s.world.caseRecords.setting.day.start);
  const away = c => ({agendas: {[a]: [{kind: 'go', place: Object.keys(c.places).find(p => p !== c.people[a].at && c.places[p]), because: [c.people[a].private[0].id]}]}, why: 't'});
  const r = await directMorning(s, {fetchImpl: proxy(away), endpoint: 'x'});
  assert.equal(r.status, 'accepted');
  assert.ok(s.world.npcs[a].travel, 'already on the way');
  assert.ok(diagnostics(s).ok);
});

test('a concealment the kernel refused is not offered to the director again', async () => {
  const {s, a} = questioned();
  const kc = s.world.caseRecords;
  const needed = kc.signs.find(x => ['document', 'item', 'record', 'trace'].includes(x.kind) && !stillSolvable(kc, [x.id]).ok);
  const owner = Morning.actors(s, kc, caseTables(s).behavior.morningCtx.roles, caseTables(s).behavior.morningCtx.victim).find(p => Morning.concealable(s, kc, p).includes(needed.id));
  if (!owner) return;   // nobody here could hide it
  Morning.install(caseTables(s).kernel, s, {}, s.events.at(-1).id, {solvable: {[`${owner}:${needed.id}`]: 'the case needs it'}}, []);
  assert.ok(!Morning.concealable(s, kc, owner).includes(needed.id));
});
