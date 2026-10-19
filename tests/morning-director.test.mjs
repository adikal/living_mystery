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
  Morning.install(caseTables(s).kernel, s, {}, s.events.at(-1).id, {refused: [needed.id]}, []);
  assert.ok(!Morning.concealable(s, kc, owner).includes(needed.id));
});

test('the line critic is shown what the speaker must not let slip: their private knowledge, beside what the line rests on', async () => {
  const {s, a, b} = questioned();
  const ka = Morning.knowledge(s, s.world.caseRecords, a, caseTables(s).behavior.morningCtx.people, caseTables(s).behavior.morningCtx.places);
  assert.ok(ka.private.length, 'the speaker has private knowledge in this case');
  let seen = null;
  const proposal = {agendas: {[a]: [{kind: 'meet', with: b, place: s.world.npcs[b].location, say: 'They asked me where I was.', because: [ka.sayable[0].id]}]}};
  await criticise(s, proposal, {lineCritic: async items => { seen = items; return {verdicts: {}}; }});
  const item = seen?.[`${a}:0`];
  if (!item) return assert.fail('the meeting reached the line critic');
  assert.deepEqual(item.private, ka.private.map(y => y.text));
  assert.deepEqual(item.knowledge, [ka.sayable[0].text]);
});


test('committed availability includes only pending and active concealments outside replanned actors', () => {
  const {kc, s} = questioned();
  s.world.flags.morning = {
    ...(s.world.flags.morning ?? {}), concealed: ['s_telegram'], agendas: {
      clara: [{kind: 'conceal', clue: 's_letter', state: 'pending'}],
      ada: [{kind: 'conceal', clue: 's_regbook', state: 'active'}],
      silas: [
        {kind: 'conceal', clue: 's_phone', state: 'done'},
        {kind: 'conceal', clue: 's_notebook', state: 'missed'},
      ],
    },
  };
  const available = Morning.concealmentAvailability(s, kc, {replanned: ['clara']});
  assert.deepEqual(available.alreadyConcealed, ['s_telegram']);
  assert.deepEqual(available.remainingCommitted, [{actor: 'ada', stepIndex: 0, clue: 's_regbook'}]);
  assert.deepEqual(available.hiddenRoots, ['s_regbook', 's_telegram']);
  const expectedAcquired = [...new Set([
    ...kc.signs.filter(x => x.kind === 'public').map(x => x.id),
    ...s.world.player.evidence.map(x => x.clue),
  ])].sort();
  assert.deepEqual(available.acquired, expectedAcquired);
});

test('every same-round concealment is checked cumulatively and failure cuts only that actor', async () => {
  const {s} = questioned();
  const proposal = {agendas: {
    clara: [
      {kind: 'conceal', clue: 's_telegram', because: ['k_att_a_clara_fear']},
      {kind: 'conceal', clue: 's_letter', because: ['k_att_a_clara_fear']},
    ],
    ada: [{kind: 'conceal', clue: 's_regbook', because: ['k_att_a_ada_work']}],
  }};
  const {plan, audit} = await criticise(s, proposal, {lineCritic: async () => assert.fail('no meetings to criticise')});
  assert.equal(audit.solvable['clara:s_telegram'], 'still solvable');
  assert.match(audit.solvable['clara:s_letter'], /false sign s_rowan_test has no reachable, true defeater/);
  assert.equal(audit.solvable['ada:s_regbook'], 'still solvable');
  assert.deepEqual(plan.clara.map(x => x.clue), ['s_telegram']);
  assert.deepEqual(plan.ada.map(x => x.clue), ['s_regbook']);
});

test('retained pending concealments constrain planning, while a replanned actor\'s old concealments do not', async () => {
  const {s} = questioned();
  s.world.flags.morning = {...(s.world.flags.morning ?? {}), agendas: {
    clara: [{kind: 'conceal', clue: 's_letter', state: 'pending'}],
  }};
  const retained = await criticise(s, {agendas: {
    ada: [{kind: 'conceal', clue: 's_regbook', because: ['k_att_a_ada_work']}],
  }}, {lineCritic: async () => assert.fail('no meetings to criticise')});
  assert.equal(retained.plan.ada, undefined);
  assert.match(retained.audit.solvable['ada:s_regbook'], /false sign s_rowan_test has no reachable, true defeater/);

  const replaced = await criticise(s, {agendas: {
    clara: [{kind: 'conceal', clue: 's_telegram', because: ['k_att_a_clara_fear']}],
  }}, {lineCritic: async () => assert.fail('no meetings to criticise')});
  assert.deepEqual(replaced.replanned, ['clara']);
  assert.equal(replaced.audit.solvable['clara:s_telegram'], 'still solvable');
  assert.deepEqual(replaced.plan.clara.map(x => x.clue), ['s_telegram']);
});

test('line-critic truncation runs before the concealment gate', async () => {
  const {kc, s, ctx} = questioned();
  const speaker = 'clara', listener = 'ada';
  const k = Morning.knowledge(s, kc, speaker, ctx.people, ctx.places);
  const proposal = {agendas: {[speaker]: [
    {kind: 'meet', with: listener, place: s.world.npcs[listener].location, say: 'The detective asked where I was.', because: [k.sayable[0].id]},
    {kind: 'conceal', clue: 's_telegram', because: ['k_att_a_clara_fear']},
  ]}};
  const {plan, audit} = await criticise(s, proposal, {lineCritic: async items => ({verdicts: Object.fromEntries(
    Object.keys(items).map(id => [id, {ok: false, why: 'unfounded'}]))})});
  assert.equal(plan.clara, undefined);
  assert.equal(audit.lines['clara:0'], 'unfounded');
  assert.equal(audit.solvable['clara:s_telegram'], undefined, 'the truncated concealment never reaches certification');
});


test('operational director failures leave state untouched and immediately retryable', async t => {
  const cases = [
    ['director transport', ({director}) => async () => { throw Error('offline'); }],
    ['director revision transport', ({invalidDirector}) => {
      let calls = 0;
      return async (url, init) => {
        if (++calls > 1) throw Error('revision offline');
        const body = JSON.parse(init.body);
        return {ok: true, json: async () => ({text: JSON.stringify(invalidDirector(JSON.parse(body.prompt)))})};
      };
    }],
    ['director timeout', () => async () => new Promise(() => {})],
    ['malformed director JSON', () => async () => ({ok: true, json: async () => ({text: '{not json'})})],
    ['malformed line-critic JSON', ({director}) => async (url, init) => {
      const body = JSON.parse(init.body);
      return body.system === DIRECTOR_PROMPT
        ? {ok: true, json: async () => ({text: JSON.stringify(director(JSON.parse(body.prompt)))})}
        : {ok: true, json: async () => ({text: '{not json'})};
    }],
    ['line-critic transport', ({director}) => async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.system !== DIRECTOR_PROMPT) throw Error('critic offline');
      return {ok: true, json: async () => ({text: JSON.stringify(director(JSON.parse(body.prompt)))})};
    }],
  ];
  for (const [label, failingFetch] of cases) await t.test(label, async () => {
    const {s, a, b} = questioned();
    s.world.minute = Math.max(s.world.minute, s.world.caseRecords.setting.day.start);
    const K = caseTables(s).kernel;
    Morning.install(K, s, {[b]: [{kind: 'stay', place: s.world.npcs[b].location, until: s.world.minute + 120, because: []}]}, s.events.at(-1)?.id);
    dispatch(s, {type: 'wait', minutes: 15});
    const director = c => ({agendas: {[a]: [{kind: 'meet', with: b, place: c.people[b].at, say: 'They asked me where I was.', because: [c.people[a].sayable[0].id]}]}, why: 'test'});
    const invalidDirector = c => ({agendas: {[a]: [{kind: 'meet', with: b, place: c.people[b].at, say: 'They asked me where I was.', because: [c.people[a].private[0].id]}]}, why: 'invalid'});
    const before = exportSession(s), morningBefore = structuredClone(s.world.flags.morning);
    const result = await directMorning(s, {fetchImpl: failingFetch({director, invalidDirector}), endpoint: 'x', timeoutMs: label.includes('timeout') ? 2 : 20});
    assert.equal(result.status, 'error');
    assert.match(result.error, /offline|timed out|malformed/i);
    assert.equal(exportSession(s), before, 'no event or world state is committed');
    assert.deepEqual(s.world.flags.morning, morningBefore, 'cadence and prior agendas are unchanged');
    assert.ok(s.world.flags.morning.agendas[b].some(x => x.state === 'pending'), 'the prior agenda remains pending');

    let retried = 0;
    const healthy = proxy(() => { retried++; return {agendas: {}, why: 'quiet'}; });
    const retry = await directMorning(s, {fetchImpl: healthy, endpoint: 'x', timeoutMs: 20});
    assert.equal(retry.status, 'empty');
    assert.ok(retried > 0, 'failure does not consume retry eligibility');
  });
});

test('an aborted director round remains stale without changing state', async () => {
  const {s} = questioned();
  s.world.minute = Math.max(s.world.minute, s.world.caseRecords.setting.day.start);
  const controller = new AbortController();
  controller.abort();
  const before = exportSession(s);
  const result = await directMorning(s, {fetchImpl: proxy(() => ({agendas: {}, why: 'quiet'})), signal: controller.signal, endpoint: 'x', timeoutMs: 20});
  assert.equal(result.status, 'stale');
  assert.equal(exportSession(s), before);
});

test('an intentional empty plan advances cadence without replacing prior agendas', async () => {
  const {s, b} = questioned();
  s.world.minute = Math.max(s.world.minute, s.world.caseRecords.setting.day.start);
  const K = caseTables(s).kernel;
  Morning.install(K, s, {[b]: [{kind: 'stay', place: s.world.npcs[b].location, until: s.world.minute + 120, because: []}]}, s.events.at(-1)?.id);
  dispatch(s, {type: 'wait', minutes: 15});
  const prior = structuredClone(s.world.flags.morning.agendas[b]);
  const result = await directMorning(s, {fetchImpl: proxy(() => ({agendas: {}, why: 'quiet'})), endpoint: 'x', timeoutMs: 20});
  assert.equal(result.status, 'empty');
  assert.equal(s.world.flags.morning.last, s.world.minute);
  assert.deepEqual(s.world.flags.morning.agendas[b], prior);
  assert.equal((await directMorning(s, {fetchImpl: proxy(() => ({agendas: {}, why: 'quiet'})), endpoint: 'x', timeoutMs: 20})).status, 'not_needed');
});
