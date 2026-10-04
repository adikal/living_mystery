import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerKernelCase, createSession, dispatch, caseTables, diagnostics} from '../dist/engine.mjs';
import * as Morning from '../dist/morning.mjs';

const load = () => JSON.parse(readFileSync(new URL('../dist/cases/generated/mk-live-20261002-235614.json', import.meta.url), 'utf8'));
function setup() {
  const kc = load(), s = createSession(1, registerKernelCase(kc)), T = caseTables(s), K = T.kernel, ctx = T.behavior.morningCtx;
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
  const who = Morning.actors(s, kc, ctx.roles, ctx.victim).find(p => Morning.concealable(s, kc, p).length
    && kc.attitudes.some(a => a.agent === p && ['fears', 'wants', 'hides', 'intends'].includes(a.mode)));
  assert.ok(who, 'someone in the case has a clue of theirs to hide');
  const clue = Morning.concealable(s, kc, who)[0], reason = kc.attitudes.find(a => a.agent === who && ['fears', 'wants', 'hides', 'intends'].includes(a.mode));
  const r = Morning.check(s, kc, ctx, {agendas: {[who]: [{kind: 'conceal', clue, because: [`k_att_${reason.id}`]}]}});
  assert.ok(r.ok, r.errors.join('; '));
  Morning.install(K, s, r.plan, null);
  dispatch(s, {type: 'wait', minutes: 60});
  assert.ok(s.world.flags.morning.concealed.includes(clue));
  const at = kc.signs.find(x => x.id === clue).at;
  if (s.world.player.location !== at) dispatch(s, {type: 'move', to: at});
  dispatch(s, {type: 'inspect', object: clue});
  assert.ok(!s.world.player.evidence.some(e => e.clue === clue), 'gone');
  assert.ok(diagnostics(s).ok);
});

test('nobody hides a clue in front of the detective: they linger, and give up when the hour is out', () => {
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
