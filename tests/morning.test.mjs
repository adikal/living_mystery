import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerKernelCase, createSession, dispatch, caseTables, diagnostics, worldAt, exportSession, importSession} from '../dist/engine.mjs';
import * as Morning from '../dist/morning.mjs';

const load = () => JSON.parse(readFileSync(new URL('../dist/cases/generated/mk-live-20261002-235614.json', import.meta.url), 'utf8'));
// Red herrings' explanations unmarked: the register book becomes an ordinary concealable clue for Ada (see below).
const loadWithoutHerrings = () => { const kc = load(); for (const x of kc.signs) delete x.explainedBy; return kc; };
function setup(kc = load()) {
  const s = createSession(1, registerKernelCase(kc)), T = caseTables(s), K = T.kernel, ctx = T.behavior.morningCtx;
  return {kc, s, T, K, ctx};
}
const heard = (s, pid) => s.events.filter(e => e.kind === 'speech' && e.data?.listener === pid && e.actor !== 'player');

test('the code critic rejects what a person cannot do or know', () => {
  const {kc, s, ctx} = setup();
  const [a, b] = Morning.actors(s, kc, ctx.roles, ctx.victim);
  const k = Morning.knowledge(s, kc, a, ctx.people, ctx.places);
  const bad = Morning.check(s, kc, ctx, {agendas: {
    [ctx.victim]: [{kind: 'go', place: 'inn', because: [k.private[0].id]}],                       // the victim does nothing
    [ctx.roles.constable]: [{kind: 'go', place: 'inn', because: ['x']}],                          // the constable keeps his post
    [a]: [{kind: 'go', place: 'inn', because: ['k_ev_not_theirs']}],                              // cites what they do not know
    [b]: [{kind: 'meet', with: a, place: 'inn', say: 'Hello.', because: [Morning.knowledge(s, kc, b, ctx.people, ctx.places).private[0].id]}]}});
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(e => e.includes(ctx.victim)) && bad.errors.some(e => e.includes(ctx.roles.constable)));
  assert.ok(bad.errors.some(e => e.includes('cite their own knowledge')));
  assert.ok(bad.errors.some(e => e.includes('may say')), 'gossip may not rest on private history');
  // nor on a mix: one sayable citation does not license a private one
  dispatch(s, {type: 'move', to: s.world.npcs[a].location}); dispatch(s, {type: 'ask', person: a, topic: 'night'});
  const k2 = Morning.knowledge(s, kc, a, ctx.people, ctx.places);
  const mixed = Morning.check(s, kc, ctx, {agendas: {[a]: [{kind: 'meet', with: b, place: s.world.npcs[a].location, say: 'x.', because: [k2.sayable[0].id, k2.private[0].id]}]}});
  assert.ok(mixed.errors.some(e => e.includes('only on what they may say')));
});

test('agendas run on the game clock: people walk, meet only if both are there, and the listener can pass it on', () => {
  const {kc, s, K, ctx} = setup();
  dispatch(s, {type: 'move', to: 'square'});
  const [a, b] = Morning.actors(s, kc, ctx.roles, ctx.victim).filter(p => s.world.npcs[p].location !== 'square');
  // a has told the detective something (so has something to pass on)
  dispatch(s, {type: 'move', to: s.world.npcs[a].location}); dispatch(s, {type: 'ask', person: a, topic: 'night'});
  const ka = Morning.knowledge(s, kc, a, ctx.people, ctx.places), kb = Morning.knowledge(s, kc, b, ctx.people, ctx.places);
  const said = ka.sayable[0];
  assert.ok(said, 'what they told the detective is sayable');
  const r = Morning.check(s, kc, ctx, {agendas: {
    [a]: [{kind: 'meet', with: b, place: s.world.npcs[b].location, say: 'The detective has been asking where we all were.', because: [said.id]}],
    [b]: [{kind: 'stay', until: s.world.minute + 50, because: [kb.private[0].id]}]}});
  assert.ok(r.ok, r.errors.join('; '));
  Morning.install(K, s, r.plan, null);
  dispatch(s, {type: 'wait', minutes: 60});
  assert.equal(heard(s, b).length, 1, `${b} was told`);
  assert.ok(Morning.news(s, b, ctx.people).length >= 1);
  dispatch(s, {type: 'move', to: s.world.npcs[b].location});
  dispatch(s, {type: 'ask', person: b, topic: 'news'});
  assert.match(s.events.findLast(e => e.kind === 'speech' && e.actor === b && e.data.listener === 'player').data.assertion, /told me this morning/);
  assert.ok(diagnostics(s).ok);
  const ids = new Set(s.events.map(e => e.id));
  for (const e of s.events.filter(e => e.data?.morning)) assert.ok(e.parents.length && e.parents.every(p => ids.has(p)), `${e.title} has its causes`);
});

test('a meeting with someone who is not there is recorded as missed, never assumed', () => {
  const {kc, s, K, ctx} = setup();
  const [a, b] = Morning.actors(s, kc, ctx.roles, ctx.victim);
  dispatch(s, {type: 'move', to: s.world.npcs[a].location}); dispatch(s, {type: 'ask', person: a, topic: 'night'});
  const ka = Morning.knowledge(s, kc, a, ctx.people, ctx.places), kb = Morning.knowledge(s, kc, b, ctx.people, ctx.places);
  const elsewhere = Object.keys(ctx.places).find(p => p !== s.world.npcs[b].location && p !== s.world.npcs[a].location);
  const r = Morning.check(s, kc, ctx, {agendas: {
    [a]: [{kind: 'meet', with: b, place: s.world.npcs[a].location, say: 'A word, if you please.', because: [ka.sayable[0].id]}],
    [b]: [{kind: 'go', place: elsewhere, because: [kb.private[0].id]}]}});
  assert.ok(r.ok, r.errors.join('; '));
  Morning.install(K, s, r.plan, null);
  dispatch(s, {type: 'wait', minutes: 45});
  assert.equal(heard(s, b).length, 0);
  assert.equal(s.world.flags.morning.agendas[a][0].state, 'missed');
});

test('a concealed clue cannot be examined afterwards, and someone present saw it go', () => {
  const {kc, s, K, ctx} = setup();
  const who = Morning.actors(s, kc, ctx.roles, ctx.victim).find(p => Morning.concealable(s, kc, p).some(c => Morning.stillSolvable(kc, [c]).ok)
    && kc.attitudes.some(a => a.agent === p && ['fears', 'wants', 'hides', 'intends'].includes(a.mode)));
  assert.ok(who, 'someone in the case has a safe clue of theirs to hide');
  const clue = Morning.concealable(s, kc, who).find(c => Morning.stillSolvable(kc, [c]).ok);
  const reason = kc.attitudes.find(a => a.agent === who && ['fears', 'wants', 'hides', 'intends'].includes(a.mode));
  const r = Morning.check(s, kc, ctx, {agendas: {[who]: [{kind: 'conceal', clue, because: [`k_att_${reason.id}`]}]}});
  assert.ok(r.ok, r.errors.join('; '));
  Morning.install(K, s, r.plan, null);
  dispatch(s, {type: 'wait', minutes: 60});
  assert.ok(s.world.flags.morning.concealed.includes(clue));
  const executionAudit = s.world.flags.morning.agendas[who][0].executionAudit;
  assert.equal(executionAudit.phase, 'execution');
  assert.equal(executionAudit.actor, who);
  assert.equal(executionAudit.stepIndex, 0);
  assert.equal(executionAudit.clue, clue);
  assert.equal(executionAudit.ok, true);
  assert.deepEqual(executionAudit.errors, []);
  assert.equal(executionAudit.checks.actualPostCommit.ok, true);
  assert.equal(executionAudit.checks.allCommitmentsProjection.ok, true);
  assert.ok(executionAudit.hiddenRoots.includes(clue));
  assert.ok(executionAudit.removed.includes(clue));
  assert.deepEqual(JSON.parse(JSON.stringify(executionAudit)), executionAudit, 'the execution audit is JSON-safe');
  const action = s.events.find(e => e.data?.executionAudit?.clue === clue && e.actor === who);
  assert.ok(action, 'the concealment action persists its audit');
  assert.deepEqual(action.data.executionAudit, executionAudit);
  assert.deepEqual(action.data.step.executionAudit, executionAudit);
  assert.deepEqual(new Set(action.changes.map(change => change.path)), new Set(['flags.morning', 'flags.evidenceExpiry']));
  const prefix = worldAt(s, action.index);
  assert.equal(prefix.flags.morning.agendas[who][0].state, 'done');
  assert.deepEqual(prefix.flags.morning.agendas[who][0].executionAudit, executionAudit);
  assert.ok(prefix.flags.morning.concealed.includes(clue), 'concealed membership is present at the action boundary');
  assert.equal(prefix.flags.evidenceExpiry[clue], action.minute - 1, 'expiry is present at the same action boundary');
  const memory = s.events[action.index + 1];
  assert.equal(memory.kind, 'memory');
  assert.deepEqual(memory.parents, [action.id]);
  assert.ok(!s.events.some(e => e.title === 'A clue is gone'), 'concealment needs no follow-up mutation');
  const at = kc.signs.find(x => x.id === clue).at;
  if (s.world.player.location !== at) dispatch(s, {type: 'move', to: at});
  dispatch(s, {type: 'inspect', object: clue});
  assert.ok(!s.world.player.evidence.some(e => e.clue === clue), 'gone');
  assert.ok(diagnostics(s).ok);
  assert.deepEqual(importSession(exportSession(s)), s, 'concealment survives export/import replay');
});

test('nobody hides a clue in front of the detective: they linger, and give up when the half-hour plan is out', () => {
  const {kc, s, K, ctx} = setup();
  const who = Morning.actors(s, kc, ctx.roles, ctx.victim).find(p => Morning.concealable(s, kc, p).length
    && kc.attitudes.some(a => a.agent === p && ['fears', 'wants', 'hides', 'intends'].includes(a.mode)));
  const clue = Morning.concealable(s, kc, who)[0], reason = kc.attitudes.find(a => a.agent === who && ['fears', 'wants', 'hides', 'intends'].includes(a.mode));
  const at = kc.signs.find(x => x.id === clue).at;
  if (s.world.player.location !== at) dispatch(s, {type: 'move', to: at});
  const r = Morning.check(s, kc, ctx, {agendas: {[who]: [{kind: 'conceal', clue, because: [`k_att_${reason.id}`]}]}});
  Morning.install(K, s, r.plan, null);
  dispatch(s, {type: 'wait', minutes: 60});
  assert.ok(!(s.world.flags.morning.concealed ?? []).includes(clue), 'not while the detective watched');
  assert.ok(s.events.some(e => e.playerText?.includes('lingers')));
  assert.equal(s.world.flags.morning.agendas[who][0].state, 'missed');
});

test('after a clue is concealed, hints and leads never point at it or at what needs it, and the case can still be solved', async () => {
  const {autoplay} = await import('./kernel-autoplay.mjs');
  const {stillSolvable} = await import('../dist/morning-director.mjs');
  const {kc, s, K, ctx, T} = setup();
  const who = Morning.actors(s, kc, ctx.roles, ctx.victim).find(p => Morning.concealable(s, kc, p).some(c => stillSolvable(kc, [c]).ok)
    && kc.attitudes.some(a => a.agent === p && ['fears', 'wants', 'hides', 'intends'].includes(a.mode)));
  const clue = Morning.concealable(s, kc, who).find(c => stillSolvable(kc, [c]).ok), reason = kc.attitudes.find(a => a.agent === who && ['fears', 'wants', 'hides', 'intends'].includes(a.mode));
  Morning.install(K, s, Morning.check(s, kc, ctx, {agendas: {[who]: [{kind: 'conceal', clue, because: [`k_att_${reason.id}`]}]}}).plan, null);
  dispatch(s, {type: 'wait', minutes: 60});
  assert.ok(s.world.flags.morning.concealed.includes(clue));
  const removed = new Set(stillSolvable(kc, [clue]).removed);
  // follow the hints to the end: they never point at what is gone, and the accusation succeeds
  for (let i = 0; i < 200 && s.world.status !== 'solved'; i++) {
    const h = T.behavior.hints(s);
    assert.ok(!removed.has(h.id), `hint points at ${h.id}, which is gone`);
    const st = T.behavior.caseStatus(s);
    if (st.opportunity && st.means && st.motive) { { const post = s.world.npcs[ctx.roles.constable].location; if (s.world.player.location !== post) dispatch(s, {type: 'move', to: post}); } dispatch(s, {type: 'accuse', suspect: st.lead, method: kc.answer.method, motive: kc.answer.motive}); break; }
    const x = kc.signs.find(y => y.id === h.id);
    if (!x) break;
    if (x.kind === 'testimony') {
      const pid = x.speaker, menu = [...(T.CASE.topicsFor?.[pid] ?? []), ...T.behavior.followupOptions(s, pid)], q = h.levels.at(-1).match(/“([^”]+)”/)?.[1];
      if (s.world.player.location !== s.world.npcs[pid].location) dispatch(s, {type: 'move', to: s.world.npcs[pid].location});
      const m = menu.find(([, l]) => l === q) ?? menu.find(([t]) => t === x.id);
      if (m) dispatch(s, {type: 'ask', person: pid, topic: m[0]}); else dispatch(s, {type: 'present', person: pid, clue: (x.requires || [])[0], tone: 'private'});
    } else { if (s.world.player.location !== x.at) dispatch(s, {type: 'move', to: x.at}); dispatch(s, {type: 'inspect', object: x.id}); }
  }
  assert.equal(s.world.status, 'solved');
});

test('a found clue is news only when it concerns someone who can act, other than its own speaker', () => {
  const {kc, s, ctx} = setup();
  const free = new Set(Morning.actors(s, kc, ctx.roles, ctx.victim));
  const find = id => { s.events.push({kind: 'evidence', data: {clue: id}}); const r = Morning.significant(s, kc, ctx); s.events.pop(); return r; };
  // someone's own account names nobody but themselves
  const own = kc.signs.find(x => x.speaker && ![x.about, x.to, x.claim?.person, x.claim?.a, x.claim?.b].some(p => p && p !== x.speaker));
  if (own) assert.equal(find(own.id), null, 'their own story is ordinary questioning');
  // a sign pointing only at the constable or the victim moves nobody
  const fixed = kc.signs.find(x => !x.speaker && x.about && !free.has(x.about) && ![x.claim?.person, x.claim?.a, x.claim?.b, x.to].some(p => free.has(p))
    && !free.has(kc.events.find(e => e.id === x.source)?.agent));
  if (fixed) assert.equal(find(fixed.id), null);
  const pointed = kc.signs.find(x => !x.speaker && free.has(x.about));
  assert.match(find(pointed.id), new RegExp(`concerns .*${pointed.about}`));
});

test('going where one already is and staying there is no plan; place names read mid-sentence', () => {
  const {kc, s, ctx} = setup();
  const [a] = Morning.actors(s, kc, ctx.roles, ctx.victim), here = s.world.npcs[a].location;
  const why = [Morning.knowledge(s, kc, a, ctx.people, ctx.places).private[0].id];
  const r = Morning.check(s, kc, ctx, {agendas: {[a]: [{kind: 'go', place: here, because: why}, {kind: 'stay', place: here, until: s.world.minute + 20, because: why}]}});
  assert.equal(r.ok, true);
  assert.equal(r.plan[a], undefined);
});

test('nobody plans to hide anything where the constable is posted', () => {
  const {kc, s, ctx} = setup();
  const post = s.world.npcs[ctx.roles.constable].location;
  for (const pid of Morning.actors(s, kc, ctx.roles, ctx.victim)) {
    const clue = Morning.concealable(s, kc, pid).find(id => kc.signs.find(x => x.id === id).at === post);
    const why = kc.attitudes.find(a => a.agent === pid && ['fears', 'wants', 'hides', 'intends'].includes(a.mode));
    if (!clue || !why) continue;
    const r = Morning.check(s, kc, ctx, {agendas: {[pid]: [{kind: 'conceal', clue, because: [`k_att_${why.id}`]}]}});
    assert.ok(r.errors.some(e => e.includes('in front of the constable')), JSON.stringify(r.errors));
    return;
  }
  // build the situation: move a concealable clue of someone's to the post
  const pid = Morning.actors(s, kc, ctx.roles, ctx.victim).find(p => Morning.concealable(s, kc, p).length && kc.attitudes.some(a => a.agent === p && ['fears', 'wants', 'hides', 'intends'].includes(a.mode)));
  const clue = Morning.concealable(s, kc, pid)[0], why = kc.attitudes.find(a => a.agent === pid && ['fears', 'wants', 'hides', 'intends'].includes(a.mode));
  const kc2 = {...kc, signs: kc.signs.map(x => x.id === clue ? {...x, at: post} : x)};
  const r = Morning.check(s, kc2, ctx, {agendas: {[pid]: [{kind: 'conceal', clue, because: [`k_att_${why.id}`]}]}});
  assert.ok(r.errors.some(e => e.includes('in front of the constable')), JSON.stringify(r.errors));
});


test('availability keeps an acquired false sign, exposing defeater cancellation', () => {
  const {kc, s} = setup();
  s.world.player.evidence.push({clue: 's_rowan_test'});
  s.world.flags.morning = {
    ...(s.world.flags.morning ?? {}),
    concealed: ['s_rowan_test'],
    agendas: {rowan: [{kind: 'conceal', clue: 's_rowan_retract', state: 'pending'}]},
  };
  const audit = Morning.certifyConcealments(s, kc, {
    phase: 'execution', actor: 'rowan', stepIndex: 0, clue: 's_rowan_retract',
    additionalConcealments: ['s_rowan_retract'],
  });
  assert.deepEqual(audit.alreadyConcealed, ['s_rowan_test']);
  assert.deepEqual(audit.remainingCommitted, [{actor: 'rowan', stepIndex: 0, clue: 's_rowan_retract'}]);
  assert.deepEqual(audit.hiddenRoots, ['s_rowan_retract', 's_rowan_test']);
  assert.deepEqual(audit.removed, ['s_rowan_retract'], 'the acquired direct root remains available');
  assert.equal(audit.ok, false);
  assert.ok(audit.errors.some(e => e.includes('false sign s_rowan_test has no reachable, true defeater')));
});

test('execution refuses a concealment when another retained commitment makes the live case unsafe', () => {
  const {kc, s, K, ctx} = setup(loadWithoutHerrings());
  const plans = {
    clara: [{kind: 'conceal', clue: 's_letter', because: ['k_att_a_clara_fear']}],
    ada: [{kind: 'conceal', clue: 's_regbook', because: ['k_att_a_ada_work']}],
  };
  const checked = Morning.check(s, kc, ctx, {agendas: plans});
  assert.ok(checked.ok, checked.errors.join('; '));
  Morning.install(K, s, checked.plan, s.events.at(-1)?.id);
  s.world.npcs.ada.location = kc.signs.find(x => x.id === 's_regbook').at;
  const expiry = structuredClone(s.world.flags.evidenceExpiry ?? {});
  Morning.step(K, s, ctx, 'ada', s.events.at(-1)?.id);
  const step = s.world.flags.morning.agendas.ada[0], audit = step.executionAudit;
  assert.equal(step.state, 'missed');
  assert.equal(step.why, 'no longer safely concealable');
  assert.ok(audit.checks.actualPostCommit.ok, 'on its own the clue could go: only the other pending plan makes it unsafe');
  assert.ok(!(s.world.flags.morning.refused ?? []).includes('s_regbook'), 'a failure that depends on another pending plan is not permanent');
  assert.deepEqual(s.world.flags.evidenceExpiry ?? {}, expiry);
  assert.ok(!(s.world.flags.morning.concealed ?? []).includes('s_regbook'));
  assert.equal(audit.ok, false);
  assert.deepEqual(audit.remainingCommitted, [
    {actor: 'ada', stepIndex: 0, clue: 's_regbook'},
    {actor: 'clara', stepIndex: 0, clue: 's_letter'},
  ]);
  assert.deepEqual(audit.hiddenRoots, ['s_letter', 's_regbook']);
  assert.ok(audit.removed.includes('s_rowan_retract'));
  assert.deepEqual(JSON.parse(JSON.stringify(audit)), audit);
});

test('an already found clue is missed and the next concealment is re-certified independently', () => {
  // (recorded under the rules before the doctor was barred from hiding anything: see the next test)
  const rules = {...Morning.CONCEALMENT_RULES};
  Morning.CONCEALMENT_RULES.examinerMayConceal = true;
  try { alreadyFoundIsMissed(); } finally { Object.assign(Morning.CONCEALMENT_RULES, rules); }
});

test('the doctor hides nothing in the morning unless she is a suspect', () => {
  const {kc, s} = setup();
  assert.deepEqual(Morning.concealable(s, kc, 'iris'), []);
  const suspect = structuredClone(kc);
  suspect.question.candidates[0].facts.actor = 'iris';
  assert.ok(Morning.concealable(s, suspect, 'iris').length > 0);
});

function alreadyFoundIsMissed() {
  const {kc, s, K, ctx} = setup();
  const proposal = {agendas: {iris: [
    {kind: 'conceal', clue: 's_medical', because: ['k_att_a_iris_duty']},
    {kind: 'conceal', clue: 's_daybook', because: ['k_att_a_iris_duty']},
  ]}};
  const checked = Morning.check(s, kc, ctx, proposal);
  assert.ok(checked.ok, checked.errors.join('; '));
  Morning.install(K, s, checked.plan, s.events.at(-1)?.id);
  s.world.player.evidence.push({clue: 's_medical'}); // found after planning, before Iris acts
  Morning.step(K, s, ctx, 'iris', s.events.at(-1)?.id);
  const [found, concealed] = s.world.flags.morning.agendas.iris;
  assert.equal(found.state, 'missed');
  assert.equal(found.why, 'already found');
  assert.equal(concealed.state, 'done');
  assert.equal(concealed.executionAudit.ok, true);
  assert.ok(concealed.executionAudit.acquired.includes('s_medical'));
  assert.deepEqual(concealed.executionAudit.remainingCommitted, [{actor: 'iris', stepIndex: 1, clue: 's_daybook'}]);
  assert.ok(!(s.world.flags.morning.concealed ?? []).includes('s_medical'));
  assert.ok(s.world.flags.morning.concealed.includes('s_daybook'));
  assert.equal(s.world.flags.evidenceExpiry?.s_medical, undefined);
}

test('execution refuses a lone defeater concealment even when the all-commitment projection passes', () => {
  const {kc, s, K, ctx} = setup();
  const plan = {
    rowan: [{kind: 'conceal', place: 'greenhouse', clue: 's_rowan_retract', because: []}],
    clara: [{kind: 'conceal', place: 'greenhouse', clue: 's_rowan_test', because: []}],
  };
  Morning.install(K, s, plan, s.events.at(-1)?.id);
  const checkOptions = {
    phase: 'execution', actor: 'rowan', stepIndex: 0, clue: 's_rowan_retract',
    additionalConcealments: ['s_rowan_retract'],
  };
  const actualPostCommit = Morning.certifyConcealments(s, kc, {...checkOptions, includeCommitments: false});
  const allCommitmentsProjection = Morning.certifyConcealments(s, kc, checkOptions);
  assert.deepEqual(actualPostCommit.remainingCommitted, []);
  assert.deepEqual(actualPostCommit.hiddenRoots, ['s_rowan_retract']);
  assert.equal(actualPostCommit.ok, false, 'the false sign loses its only reachable true defeater');
  assert.equal(allCommitmentsProjection.ok, true, 'concealing the false sign too masks that failure');
  assert.deepEqual(allCommitmentsProjection.hiddenRoots, ['s_rowan_retract', 's_rowan_test']);

  const expiry = structuredClone(s.world.flags.evidenceExpiry ?? {});
  Morning.step(K, s, ctx, 'rowan', s.events.at(-1)?.id);
  const step = s.world.flags.morning.agendas.rowan[0], audit = step.executionAudit;
  assert.equal(step.state, 'missed');
  assert.equal(step.why, 'no longer safely concealable');
  assert.equal(audit.ok, false);
  assert.equal(audit.checks.actualPostCommit.ok, false);
  assert.equal(audit.checks.allCommitmentsProjection.ok, true);
  assert.deepEqual(audit.remainingCommitted, [
    {actor: 'clara', stepIndex: 0, clue: 's_rowan_test'},
    {actor: 'rowan', stepIndex: 0, clue: 's_rowan_retract'},
  ], 'top-level projection fields remain compatible');
  assert.ok(audit.errors.some(error => error.includes('actual post-commit state: false sign s_rowan_test')));
  assert.deepEqual(s.world.flags.evidenceExpiry ?? {}, expiry);
  assert.ok(!(s.world.flags.morning.concealed ?? []).includes('s_rowan_retract'));
  assert.ok(s.world.flags.morning.refused.includes('s_rowan_retract'));
  assert.deepEqual(JSON.parse(JSON.stringify(audit)), audit);
});


function nearHorizonConcealment({constable = false} = {}) {
  const {kc, s, K, ctx} = setup();
  const who = Morning.actors(s, kc, ctx.roles, ctx.victim).find(pid => Morning.concealable(s, kc, pid).some(clue => Morning.stillSolvable(kc, [clue]).ok)
    && kc.attitudes.some(a => a.agent === pid && ['fears', 'wants', 'hides', 'intends'].includes(a.mode)));
  const clue = Morning.concealable(s, kc, who).find(id => Morning.stillSolvable(kc, [id]).ok);
  const reason = kc.attitudes.find(a => a.agent === who && ['fears', 'wants', 'hides', 'intends'].includes(a.mode));
  const at = kc.signs.find(x => x.id === clue).at;
  const elsewhere = Object.keys(ctx.places).find(place => place !== at);
  s.world.npcs[who].location = at;
  s.world.npcs[who].travel = null;
  s.world.player.location = constable ? elsewhere : at;
  if (constable) {
    s.world.npcs[ctx.roles.constable].location = elsewhere;
    s.world.npcs[ctx.roles.constable].travel = null;
  }
  const plannedAt = s.world.minute, deadline = plannedAt + Morning.HORIZON;
  const checked = Morning.check(s, kc, ctx, {agendas: {[who]: [
    {kind: 'stay', until: deadline - 1, because: []},
    {kind: 'conceal', clue, because: [`k_att_${reason.id}`]},
  ]}});
  assert.ok(checked.ok, checked.errors.join('; '));
  assert.equal(checked.plan[who][1].until, deadline, 'concealment retains the original absolute planning deadline');
  Morning.install(K, s, checked.plan, s.events.at(-1)?.id);
  if (constable) s.world.npcs[ctx.roles.constable].location = at;
  s.world.minute = deadline - 1;
  Morning.step(K, s, ctx, who, s.events.at(-1)?.id);
  assert.equal(s.world.flags.morning.agendas[who][1].state, 'active');
  return {kc, s, K, ctx, who, clue, at, elsewhere, deadline};
}

test('a detective-blocked concealment near the horizon is missed at the original deadline even if the detective leaves', () => {
  const {s, K, ctx, who, clue, elsewhere, deadline} = nearHorizonConcealment();
  s.world.player.location = elsewhere;
  s.world.minute = deadline;
  Morning.step(K, s, ctx, who, s.events.at(-1)?.id);
  const step = s.world.flags.morning.agendas[who][1];
  assert.equal(step.state, 'missed');
  assert.equal(step.why, 'the detective stayed', 'the detective kept them from it until the plan ran out');
  assert.ok(!(s.world.flags.morning.concealed ?? []).includes(clue));
  assert.equal(s.world.flags.evidenceExpiry?.[clue], undefined);
});

test('a constable-blocked concealment near the horizon is missed at the original deadline', () => {
  const {s, K, ctx, who, clue, deadline} = nearHorizonConcealment({constable: true});
  s.world.minute = deadline;
  Morning.step(K, s, ctx, who, s.events.at(-1)?.id);
  const step = s.world.flags.morning.agendas[who][1];
  assert.equal(step.state, 'missed');
  assert.equal(step.why, 'the constable stayed');
  assert.ok(!(s.world.flags.morning.concealed ?? []).includes(clue));
  assert.equal(s.world.flags.evidenceExpiry?.[clue], undefined);
});

test('an acquired dependent remains valid when its physical prerequisite is concealed', () => {
  const {kc, s} = setup();
  s.world.player.evidence.push({clue: 's_iris_test'});
  const projected = Morning.projectAvailability(kc, ['s_iris_test'], ['s_bandage']);
  assert.deepEqual(projected.removed, ['s_bandage']);
  const acquired = projected.caseRecords.signs.find(x => x.id === 's_iris_test');
  assert.ok(acquired, 'the acquired testimony remains in the notebook');
  assert.deepEqual(acquired.requires, [], 'the retained notebook evidence no longer depends on its concealed source');
  const audit = Morning.certifyConcealments(s, kc, {phase: 'planning', additionalConcealments: ['s_bandage']});
  assert.equal(audit.ok, true, audit.errors.join('; '));

  const unknown = Morning.certifyConcealments(s, kc, {phase: 'planning', additionalConcealments: ['missing_sign']});
  assert.equal(unknown.ok, false, 'unknown concealments still fail closed');
  assert.match(unknown.errors[0], /unknown concealed signs/);
});


test('a held sign that needs a concealed sign stays in the case but can no longer be read, in the engine and the certifier alike', async () => {
  const {analyse} = await import('../dist/mk/kernel.mjs');
  const {kc} = setup();
  const ids = new Set(kc.signs.map(x => x.id));
  const reader = kc.signs.find(x => (x.needs ?? []).some(n => ids.has(n) && kc.signs.find(y => y.id === n).kind !== 'public'));
  assert.ok(reader, 'the case has a sign that needs another sign');
  const needed = reader.needs.find(n => ids.has(n));
  const projected = Morning.projectAvailability(kc, [reader.id], [needed]);
  const kept = projected.caseRecords.signs.find(x => x.id === reader.id);
  assert.ok(kept, 'the held sign stays in the case');
  assert.ok(kept.needs.includes(needed), 'its interpretation dependency is kept');
  assert.ok(!analyse(projected.caseRecords).understood.has(reader.id), 'so the kernel cannot read it');
  assert.ok(!Morning.unavailableSigns(kc, [reader.id], [needed]).includes(reader.id), 'held evidence is never removed');
  assert.ok(Morning.unavailableSigns(kc, [], [needed]).includes(reader.id), 'unheld, it goes with what it needs');
});

test('one clue is concealed once: another person cannot plan it, and an executed duplicate is missed', () => {
  const {kc, s, K, ctx} = setup();
  const motive = pid => kc.attitudes.find(a => a.agent === pid && ['fears', 'wants', 'hides', 'intends'].includes(a.mode));
  const actors = Morning.actors(s, kc, ctx.roles, ctx.victim).filter(motive);
  const pair = actors.flatMap(a => actors.filter(b => b !== a).map(b => [a, b]))
    .map(([a, b]) => [a, b, Morning.concealable(s, kc, a).find(c => Morning.concealable(s, kc, b).includes(c) && Morning.stillSolvable(kc, [c]).ok)])
    .find(([, , c]) => c);
  if (!pair) return;   // no clue concerns two people who could act in this case
  const [a, b, clue] = pair;
  const plan = Morning.check(s, kc, ctx, {agendas: {[a]: [{kind: 'conceal', clue, because: [`k_att_${motive(a).id}`]}]}});
  assert.ok(plan.ok, plan.errors.join('; '));
  Morning.install(K, s, plan.plan, s.events.at(-1)?.id);
  assert.ok(!Morning.concealable(s, kc, b).includes(clue), 'already planned by someone else');
  assert.ok(Morning.concealable(s, kc, a).includes(clue), 'its planner may plan it again when replanned');
  // an older save can still hold two plans for one clue: the second to arrive finds it gone
  s.world.flags.morning = {...s.world.flags.morning, concealed: [clue],
    agendas: {...s.world.flags.morning.agendas, [b]: [{kind: 'conceal', clue, place: kc.signs.find(x => x.id === clue).at, because: [], state: 'pending', until: s.world.minute + 60}]}};
  s.world.npcs[b].location = kc.signs.find(x => x.id === clue).at; s.world.npcs[b].travel = null;
  s.world.player.location = Object.keys(ctx.places).find(p => p !== s.world.npcs[b].location);
  Morning.step(K, s, ctx, b, s.events.at(-1)?.id);
  const step = s.world.flags.morning.agendas[b][0];
  assert.deepEqual([step.state, step.why], ['missed', 'already gone']);
  assert.equal(s.world.flags.morning.concealed.filter(c => c === clue).length, 1);
});

test('a concealment that could only start at the deadline is not admitted', () => {
  const {kc, s, ctx} = setup();
  const who = Morning.actors(s, kc, ctx.roles, ctx.victim).find(pid => Morning.concealable(s, kc, pid).length
    && kc.attitudes.some(a => a.agent === pid && ['fears', 'wants', 'hides', 'intends'].includes(a.mode)));
  if (!who) return;
  const clue = Morning.concealable(s, kc, who)[0], at = kc.signs.find(x => x.id === clue).at;
  const reason = kc.attitudes.find(a => a.agent === who && ['fears', 'wants', 'hides', 'intends'].includes(a.mode));
  s.world.npcs[who].location = at; s.world.npcs[who].travel = null;
  const end = s.world.minute + Morning.HORIZON;
  const checked = Morning.check(s, kc, ctx, {agendas: {[who]: [{kind: 'stay', until: end, because: []}, {kind: 'conceal', clue, because: [`k_att_${reason.id}`]}]}});
  assert.ok(checked.errors.some(e => e.includes('before the plan ends')), checked.errors.join('; '));
});

test('a kept concealment without a deadline (an older save) gets one from the round that made it, never later', () => {
  const {kc, s, K, ctx} = setup();
  const [a, b] = Morning.actors(s, kc, ctx.roles, ctx.victim);
  const made = s.world.minute - 7;
  s.world.flags.morning = {agendas: {[a]: [{kind: 'conceal', clue: kc.signs[0].id, place: kc.signs[0].at, because: [], state: 'pending'}]}, concealed: [], last: made};
  Morning.install(K, s, {[b]: [{kind: 'stay', place: s.world.npcs[b].location, until: s.world.minute + 10, because: []}]}, s.events.at(-1)?.id, {}, [b]);
  assert.equal(s.world.flags.morning.agendas[a][0].until, made + Morning.HORIZON);
  Morning.install(K, s, {}, s.events.at(-1)?.id, {}, [b]);
  assert.equal(s.world.flags.morning.agendas[a][0].until, made + Morning.HORIZON, 'later rounds do not move it');
});

test('what explains a red herring is never anyone\'s to hide', () => {
  const {kc, s} = setup();
  const explains = new Set(kc.signs.filter(x => x.kind === 'behavior').flatMap(x => x.explainedBy ?? []));
  assert.ok(explains.has('s_regbook'));
  for (const p of kc.people.map(x => x.id)) for (const id of Morning.concealable(s, kc, p)) assert.ok(!explains.has(id), `${p} may hide ${id}`);
  assert.ok(Morning.concealable(s, loadWithoutHerrings(), 'ada').includes('s_regbook'), 'the same clue is concealable when it explains nothing');
});
