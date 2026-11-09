// Behaviour found in play-testing, fixed for every case (published or newly generated): the briefing in medium and hard
// cases points only to the doctor; an innocent caught in an untrue account says why; red herrings can always be
// understood (pressed, the person gives the reason; the closing file explains what was left); stress follows being
// pressed; and model replies are not lost over claims, common knowledge or what the person has already said.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {registerKernelCase, createSession, dispatch, caseTables} from '../dist/engine.mjs';
import {claimOf, claimTrue, actorOf} from '../dist/mk/kernel.mjs';
import {prepareCharacterTurn, proposeCharacterTurn, applyCharacterTurn, CHARACTER_CRITIC} from '../dist/character-turn.mjs';
import {setLlmConfig} from '../dist/llm.mjs';
import {inSentence} from '../dist/places.mjs';

const dir = new URL('../dist/cases/generated/', import.meta.url);
const files = readdirSync(dir).filter(f => f.startsWith('mk-') && f.endsWith('.json'));
const load = f => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const start = kc => { const s = createSession(1, registerKernelCase(kc)), T = caseTables(s); return {s, T, K: T.kernel, B: T.behavior}; };
const goTo = (s, pid) => { const at = s.world.npcs[pid].location; if (s.world.player.location !== at) dispatch(s, {type: 'move', to: at}); };
const give = (s, K, ids) => { for (const id of ids) if (!K.has(s, id)) K.addEvidence(s, id, s.events.at(-1).id, 'test'); };
const lastWords = (s, pid) => s.events.findLast(e => e.kind === 'speech' && e.actor === pid && e.data?.listener === 'player').data.assertion;
const culprit = kc => actorOf(kc.question.candidates.find(c => c.id === kc.question.truth));
const herrings = kc => kc.signs.filter(x => x.kind === 'behavior' && arr(x.explainedBy).some(e => kc.signs.some(y => y.id === e))
  && x.about !== culprit(kc) && kc.people.some(p => p.id === x.about));
// an attitude and those it rests on (the same person's)
const chain = (kc, pid, ids) => { const out = [], todo = [...ids];
  while (todo.length) { const id = todo.shift(), a = kc.attitudes.find(x => x.id === id && x.agent === pid); if (a && !out.includes(a)) { out.push(a); todo.push(...arr(a.because)); } }
  return out; };
const arr = v => (Array.isArray(v) ? v : []);
// the words an attitude contributes to a reason, however it is introduced ("I wanted to", "she feared that")
const gist = a => String(a.content).replace(/[.]+$/, '').replace(/^(to|that) /i, '').split(/\s+/).slice(1, 6).join(' ');

for (const f of files) {
  const kc = load(f);
  test(`${f}: in a ${kc.difficulty?.level ?? 'unlevelled'} case the briefing names ${kc.difficulty?.level === 'easy' ? 'at most one person' : 'only the doctor'}`, () => {
    const {s, T} = start(kc), c = T.CASE.constable, doctor = (kc.setting?.roles ?? {}).examiner ?? 'iris';
    goTo(s, c);
    dispatch(s, {type: 'ask', person: c, topic: 'case'});
    const rest = lastWords(s, c).slice(T.CASE.synopsis.length);
    const bare = Object.values(T.LOCATIONS).reduce((t, l) => t.replaceAll(inSentence(l), '').replaceAll(l.name, ''), rest);
    const named = Object.entries(T.PEOPLE).filter(([, p]) => [p.name, p.address].some(n => n && bare.includes(n))).map(([id]) => id);
    assert.ok(named.length <= 1, rest);
    if (kc.difficulty?.level !== 'easy') assert.ok(named.every(id => id === doctor), `named ${named}: ${rest}`);
  });

  test(`${f}: an innocent caught in an untrue account concedes and says why`, () => {
    const lies = kc.signs.filter(x => x.kind === 'testimony' && x.speaker !== culprit(kc) && claimOf(x) && !claimTrue(kc, claimOf(x))
      && arr(x.because).length && kc.signs.some(d => arr(d.defeats).includes(x.id)));
    for (const lie of lies) {
      const {s, K} = start(kc), defeater = kc.signs.find(d => arr(d.defeats).includes(lie.id));
      give(s, K, [lie.id, defeater.id]);
      goTo(s, lie.speaker);
      dispatch(s, {type: 'present', person: lie.speaker, clue: defeater.id});
      const said = lastWords(s, lie.speaker), why = chain(kc, lie.speaker, lie.because);
      assert.ok(why.some(a => said.includes(gist(a))), `${lie.id}: "${said}" gives none of ${why.map(a => a.content)}`);
    }
  });

  // a red herring whose explanation is opened by putting the behaviour itself to them (the slate shown to the
  // landlady) is answered with that explanation at once; the others are words only until it is found
  const openedByIt = b => arr(b.explainedBy).map(e => kc.signs.find(y => y.id === e)).some(y => y?.kind === 'testimony'
    && y.speaker === b.about && arr(y.requires).length && arr(y.requires).every(r => r === b.id));

  test(`${f}: a red herring that opens its own explanation gives it when put to them`, () => {
    for (const b of herrings(kc).filter(openedByIt)) {
      const {s, K} = start(kc);
      give(s, K, [b.id]);
      goTo(s, b.about);
      dispatch(s, {type: 'ask', person: b.about, topic: `why:${b.id}`});
      assert.ok(arr(b.explainedBy).some(e => K.has(s, e)), `${b.id}: put to them, its explanation is given`);
    }
  });

  test(`${f}: pressed about a red herring, the person gives its innocent reason (words only)`, () => {
    for (const b of herrings(kc).filter(b => !openedByIt(b))) {
      const {s, K} = start(kc);
      give(s, K, [b.id]);
      goTo(s, b.about);
      dispatch(s, {type: 'ask', person: b.about, topic: `why:${b.id}`});
      const first = lastWords(s, b.about);
      dispatch(s, {type: 'ask', person: b.about, topic: `why:${b.id}`});
      const second = lastWords(s, b.about);
      assert.notEqual(second, first, `${b.id}: pressed again, the same words`);
      assert.match(second, /nothing to do with/, `${b.id}: ${second}`);
      assert.ok(!arr(b.explainedBy).some(e => K.has(s, e)), 'the explaining clue is still the player\'s to find');
      dispatch(s, {type: 'ask', person: b.about, topic: `why:${b.id}`});
      assert.match(lastWords(s, b.about), /^As I told you/);
    }
  });

  test(`${f}: the closing file explains every red herring and innocent lie the player did not get to the bottom of`, () => {
    const {s, T, K, B} = start(kc);
    give(s, K, T.investigationSupport.proofRoutes[0].all);
    const r = B.checkCase(s, {type: 'accuse', suspect: T.CASE.culprit, method: kc.answer?.method, motive: kc.answer?.motive, evidence: []});
    assert.equal(r.status, 'supported');
    for (const b of herrings(kc).filter(b => !arr(b.explainedBy).some(e => K.has(s, e))))
      assert.ok(r.feedback.includes(`${T.PEOPLE[b.about].name} (`) && r.feedback.includes(b.title), `${b.id} unexplained`);
    for (const lie of kc.signs.filter(x => x.kind === 'testimony' && x.speaker !== culprit(kc) && claimOf(x) && !claimTrue(kc, claimOf(x)) && arr(x.because).length))
      assert.ok(r.feedback.includes(`(${lie.title})`), `${lie.id}: why ${T.PEOPLE[lie.speaker]?.name} lied is not told`);
  });

  test(`${f}: following the hints leads to what explains each red herring the player has seen`, () => {
    for (const b of herrings(kc)) {
      const {s, K, B} = start(kc), explains = new Set(arr(b.explainedBy));
      // everything that leads to an explanation (its prerequisites, and theirs)
      const leads = new Set(), walk = id => { const x = kc.signs.find(y => y.id === id); if (!x || leads.has(id)) return; leads.add(id); arr(x.requires).forEach(walk); };
      explains.forEach(walk);
      give(s, K, [b.id]);
      let found = false;
      for (let n = 0; n < 80 && !found; n++) {
        const h = B.hints(s);
        if (leads.has(h.id)) {
          found = true;
          if (explains.has(h.id) || !kc.signs.find(x => x.id === h.id)?.claim) assert.ok(h.levels.length >= 2);
        } else if (h.id === 'accuse' || !kc.signs.some(x => x.id === h.id)) break;
        else { give(s, K, [h.id]); B.afterAction(s, s.events.at(-1).id); }
      }
      assert.ok(found, `${b.id}: the hints never lead to ${[...explains]}`);
    }
  });
}

test('being pressed raises stress: shown what bears on them, and an exchange that cools', () => {
  const kc = load(files.find(f => load(f).signs.some(x => x.kind === 'behavior' && x.explainedBy?.length)));
  const b = herrings(kc)[0], {s, K, B} = start(kc);
  give(s, K, [b.id]);
  goTo(s, b.about);
  B.afterAction(s, s.events.at(-1).id);
  const before = s.world.npcs[b.about].stress;
  dispatch(s, {type: 'ask', person: b.about, topic: `why:${b.id}`});
  const pressedOnce = s.world.npcs[b.about].stress;
  assert.ok(pressedOnce > before, `${before} -> ${pressedOnce}`);
  B.pressed(s, b.about, s.events.at(-1).id);
  assert.ok(s.world.npcs[b.about].stress > pressedOnce);
});

const activeStore = () => { const m = new Map(), store = {getItem: k => m.get(k), setItem: (k, v) => m.set(k, v)};
  setLlmConfig({endpoint: 'http://127.0.0.1:8787', enabled: true}, store); return store; };
const critics = [];
const respond = p => async (_url, init) => {
  const body = JSON.parse(init.body);
  if (body.system === CHARACTER_CRITIC) critics.push(JSON.parse(body.prompt));
  return {ok: true, json: async () => ({text: body.system === CHARACTER_CRITIC ? '{"verdict":"pass","violations":[]}' : JSON.stringify(p)})};
};

test('a reply that leaves out its account\'s claims and sources is completed by code, and a cooler exchange costs more trust', async () => {
  const kc = load(files[0]), {s} = start(kc);
  const pid = kc.signs.find(x => x.kind === 'testimony' && x.surface && x.speaker !== caseTables(s).CASE.constable).speaker;
  goTo(s, pid);
  const t = prepareCharacterTurn(s, {person: pid, text: 'Where were you last night?'});
  const a = t.context.accounts.find(x => (t.context.player.requiredAccounts ?? []).includes(x.id)) ?? t.context.accounts[0];
  const p = {plan: null, intent: a.deceptive ? 'deceive' : 'answer', account: a.id, utterance: a.statement, claims: [], sources: [],
    trust: 'cooler', belief: 'remember_only', engagement: 'continue', rationale: 'Answer.'};
  const r = await proposeCharacterTurn(t, {store: activeStore(), fetchImpl: respond(p)});
  assert.equal(r.audit.status, 'accepted', JSON.stringify(r.audit.attempts.map(x => x.validation)));
  assert.deepEqual(r.proposal.sources, a.sources);
  const trust = s.world.npcs[pid].trust;
  applyCharacterTurn(s, t, r);
  assert.ok(trust - s.world.npcs[pid].trust > .1, `${trust} -> ${s.world.npcs[pid].trust}`);
});

test('the fact-checker is given common knowledge and what the person has already told', async () => {
  const kc = load(files[0]), {s, K} = start(kc);
  const told = kc.signs.find(x => x.kind === 'testimony' && x.surface && x.speaker !== caseTables(s).CASE.constable);
  give(s, K, [told.id]);
  goTo(s, told.speaker);
  const t = prepareCharacterTurn(s, {person: told.speaker, text: 'Is that so?'});
  assert.ok(t.context.toldAccounts.includes(told.text));
  assert.ok(t.context.publicFacts.length > 0);
  const p = {plan: null, intent: 'refuse', account: null, utterance: 'I have nothing to tell you about that.', claims: [], sources: [],
    trust: 'unchanged', belief: 'remember_only', engagement: 'continue', rationale: 'Decline.'};
  critics.length = 0;
  const r = await proposeCharacterTurn(t, {store: activeStore(), fetchImpl: respond(p)});
  assert.equal(r.audit.status, 'accepted');
  assert.deepEqual(critics.at(-1).toldAccounts, t.context.toldAccounts);
  assert.deepEqual(critics.at(-1).publicFacts, t.context.publicFacts);
  applyCharacterTurn(s, t, r);   // the applied check rebuilds the same fact-checker input
  assert.match(CHARACTER_CRITIC, /a decline: with account null/);
});

// ---- Paste Pearls at the Pump (play of 25 October): a doctor's kept clues, her expertise, and the dialogue fixes ----
const PEARLS = ['archive/2026-10'].map(d => new URL(`../dist/cases/${d}/mk-live-20261002-235614.json`, import.meta.url))
  .find(u => { try { readFileSync(u); return true; } catch { return false; } });
const pearls = () => JSON.parse(readFileSync(PEARLS, 'utf8'));

test('what a person keeps opens where they are and is handed over, cascading to what it opens', () => {
  const kc = pearls(), {s, K, T} = start(kc);
  assert.equal(T.OBJECTS.s_notebook.follows, 'iris', 'the notebook is with the doctor, not at the square');
  give(s, K, ['s_jonah_test', 's_bandage']);
  goTo(s, 'iris');
  dispatch(s, {type: 'ask', person: 'iris', topic: 's_iris_test'});
  assert.ok(K.has(s, 's_iris_test'));
  for (const kept of ['s_notebook', 's_wound', 's_daybook']) assert.ok(K.has(s, kept), `${kept} handed over`);
  assert.ok(s.events.some(e => e.kind === 'evidence' && e.data?.clue === 's_notebook' && /hands it over/.test(e.data?.source ?? '')));
});

test('a lead someone keeps points to that person and the hint names them', () => {
  const kc = pearls(), {s, K, B} = start(kc);
  give(s, K, ['s_jonah_test', 's_bandage', 's_iris_test']);
  B.afterAction(s, s.events.at(-1).id);
  assert.ok(s.events.some(e => /should open something with Dr Marsh/.test(e.playerText ?? '')), 'points to the doctor');
  const h = B.hints(s);
  if (['s_notebook', 's_wound', 's_daybook'].includes(h.id)) assert.match(h.levels[1], /^Go and see Dr Marsh/);
});

test('shown a clue that needs her own finding, the doctor compares it: wait, hand over, or confirm', () => {
  const kc = pearls();
  let {s, K} = start(kc);
  give(s, K, ['s_hound']); goTo(s, 'iris');
  dispatch(s, {type: 'present', person: 'iris', clue: 's_hound'});
  assert.match(lastWords(s, 'iris'), /cannot do that for you yet/);
  ({s, K} = start(kc));
  give(s, K, ['s_hound', 's_wound']); goTo(s, 'iris');
  dispatch(s, {type: 'present', person: 'iris', clue: 's_hound'});
  assert.match(lastWords(s, 'iris'), /it fits what I found/);
  // earned but not yet held: she hands it over (a copy of the case where her notes wait only for the hound)
  const open = pearls(); open.signs.find(x => x.id === 's_wound').requires = ['s_hound'];
  ({s, K} = start(open));
  give(s, K, ['s_hound']); goTo(s, 'iris');
  dispatch(s, {type: 'present', person: 'iris', clue: 's_hound'});
  assert.ok(K.has(s, 's_wound'), 'her notes are handed over');
});

test('a follow-up in her own words can still be answered with the comparison', () => {
  const kc = pearls(), {s, K} = start(kc);
  give(s, K, ['s_hound', 's_wound']); goTo(s, 'iris');
  dispatch(s, {type: 'present', person: 'iris', clue: 's_hound'});
  const t = prepareCharacterTurn(s, {person: 'iris', text: 'could that be the murder weapon?'});
  assert.ok(t.context.accounts.some(a => a.id === 'present:s_hound:private'));
  assert.ok((t.context.player.relevantAccounts ?? []).includes('present:s_hound:private'));
});

test('figures written on the evidence shown may be repeated, and a neutral reaction offers no unrelated account', async () => {
  const kc = pearls(), {s, K} = start(kc);
  give(s, K, ['s_docket']); goTo(s, 'dora');
  const t = prepareCharacterTurn(s, {person: 'dora', text: 'Who made this call?', action: {type: 'present', person: 'dora', clue: 's_docket', tone: 'private'}});
  const a = t.context.accounts[0];
  const p = {plan: null, intent: a.deceptive ? 'deceive' : 'answer', account: a.id, utterance: 'Bellweather 12 to Holborn 4471, connected 23.10: that is the docket, plain enough.',
    claims: a.claims, sources: a.sources, trust: 'unchanged', belief: 'remember_only', engagement: 'continue', rationale: 'React.'};
  const {validateCharacterProposal} = await import('../dist/character-turn.mjs');
  const v = validateCharacterProposal(t, p);
  assert.ok(v.ok || !/changed_numbers/.test(v.reason), v.reason);
  const {s: s2, K: K2} = start(kc);
  give(s2, K2, ['s_letter']); goTo(s2, 'edmund');
  const t2 = prepareCharacterTurn(s2, {person: 'edmund', text: 'Look at this letter.', action: {type: 'present', person: 'edmund', clue: 's_letter', tone: 'private'}});
  assert.ok(!t2.context.accounts.some(x => x.id === 'ask:s_saw_edmund_hugo_manor'), 'a sighting is no answer to a blackmail letter');
});

test('a question built on a clue quotes its title', () => {
  const kc = pearls(), {s, K, B} = start(kc);
  give(s, K, ['s_jonah_test', 's_bandage']); goTo(s, 'iris');
  const labels = B.followupOptions(s, 'iris').map(([, l]) => l);
  assert.ok(labels.includes('Now that I have seen ‘Under the glove’, what can you tell me?'), labels.join(' | '));
});

test('a free question about what the person has already told, whose replies are all rejected, is answered with its recap', async () => {
  // November 8 playtests: one reply in ten was a stock "nothing to tell" to a question about the person's own story
  for (const f of files) {
    const kc = load(f), {s} = start(kc);
    const told = kc.signs.find(x => x.kind === 'testimony' && x.surface && x.speaker !== caseTables(s).CASE.constable);
    if (!told) continue;
    goTo(s, told.speaker);
    dispatch(s, {type: 'ask', person: told.speaker, topic: 'night'});
    const before = lastWords(s, told.speaker);
    const t = prepareCharacterTurn(s, {person: told.speaker, text: 'Are you quite certain of that? Think carefully, please.'});
    const a = t.context.accounts.find(x => x.statement.includes(before) || /^As I told you/.test(x.statement));
    if (!a) continue;
    const p = {plan: null, intent: a.deceptive ? 'deceive' : 'answer', account: a.id, utterance: 'Something embellished beyond the account.',
      claims: a.claims, sources: a.sources, trust: 'unchanged', belief: 'remember_only', engagement: 'continue', rationale: 'Answer.'};
    const reject = async (_url, init) => ({ok: true, json: async () => ({text: JSON.parse(init.body).system === CHARACTER_CRITIC
      ? '{"verdict":"reject","violations":["embellished"]}' : JSON.stringify(p)})});
    const r = await proposeCharacterTurn(t, {store: activeStore(), fetchImpl: reject});
    assert.equal(r.proposal, null);
    const held = s.world.player.evidence.length;
    applyCharacterTurn(s, t, r);
    const said = lastWords(s, told.speaker);
    assert.match(said, /^As I (told you|have admitted)/, 'a reference back, marked as one');
    assert.equal(s.world.player.evidence.length, held, 'nothing new enters the notebook');
    const plain = t => t.replace(/^As I told you:\s*/, '').replace(/[“”"]/g, '');
    assert.ok(plain(said).includes(plain(before)) && !caseTables(s).behavior.isDecline(told.speaker, said), `${f}: ${said}`);
    return;
  }
  assert.fail('no case had a told evening account to refer back to');
});

test('the constable remembers his verdict on an accusation: it is in his side of the conversation', () => {
  const kc = load(files[0]), {s, T} = start(kc), c = T.CASE.constable;
  goTo(s, c);
  const innocent = kc.question.candidates.map(actorOf).find(p => p && p !== culprit(kc));
  dispatch(s, {type: 'accuse', suspect: innocent, method: kc.answer?.method, motive: kc.answer?.motive});
  const verdict = s.events.findLast(e => e.kind === 'rejected' && e.data?.speaker === c);
  assert.ok(verdict, 'the accusation was turned down');
  const t = prepareCharacterTurn(s, {person: c, text: 'Why did you say that?'});
  const said = t.context.character.history.findLast(h => h.speaker === c);
  assert.ok(said.text.includes(verdict.data.reason), said.text);
});

test('pressed again on what they have already answered, a person changes tack instead of repeating themselves', async () => {
  const {CHANGE_TACK} = await import('../dist/character-turn.mjs');
  const kc = load(files[0]);
  delete kc.pressed;                               // the plain line: the case's own lines are tested below
  const {s} = start(kc);
  const told = kc.signs.find(x => x.kind === 'testimony' && x.surface && x.speaker !== caseTables(s).CASE.constable);
  goTo(s, told.speaker);
  dispatch(s, {type: 'ask', person: told.speaker, topic: 'night'});
  const before = lastWords(s, told.speaker);
  const reject = p => async (_url, init) => ({ok: true, json: async () => ({text: JSON.parse(init.body).system === CHARACTER_CRITIC
    ? '{"verdict":"reject","violations":["embellished"]}' : JSON.stringify(p)})});
  const replies = [];
  for (let i = 0; i < 3; i++) {
    const t = prepareCharacterTurn(s, {person: told.speaker, text: `Are you quite certain? (${i})`});
    const a = t.context.accounts.find(x => x.statement.includes(before) || /^As I told you/.test(x.statement));
    assert.ok(a, 'the account told is still available');
    const p = {plan: null, intent: a.deceptive ? 'deceive' : 'answer', account: a.id, utterance: 'Something embellished.',
      claims: a.claims, sources: a.sources, trust: 'unchanged', belief: 'remember_only', engagement: 'continue', rationale: 'x'};
    applyCharacterTurn(s, t, await proposeCharacterTurn(t, {store: activeStore(), fetchImpl: reject(p)}));
    replies.push(lastWords(s, told.speaker));
  }
  assert.ok(replies.includes(CHANGE_TACK), replies.join(' | '));
  assert.ok(replies.every((r, i) => i === 0 || r !== replies[i - 1]), 'never the same words twice running');
});


test('pressed again, a person changes tack in their own published words when the case has them', async () => {
  const kc = load(files[0]);
  const told = kc.signs.find(x => x.kind === 'testimony' && x.surface && x.speaker !== kc.setting?.roles?.constable);
  kc.pressed = {[told.speaker]: ['Answered that, I have. Show me something and we will talk.', 'Nothing new there, unless you have something to show me.']};
  const {s} = start(kc);
  goTo(s, told.speaker);
  dispatch(s, {type: 'ask', person: told.speaker, topic: 'night'});
  const before = lastWords(s, told.speaker), replies = [];
  for (let i = 0; i < 3; i++) {
    const t = prepareCharacterTurn(s, {person: told.speaker, text: `Are you quite sure? (${i})`});
    const a = t.context.accounts.find(x => x.statement.includes(before) || /^As I told you/.test(x.statement));
    const p = {plan: null, intent: a.deceptive ? 'deceive' : 'answer', account: a.id, utterance: 'Something embellished.',
      claims: a.claims, sources: a.sources, trust: 'unchanged', belief: 'remember_only', engagement: 'continue', rationale: 'x'};
    const reject = async (_url, init) => ({ok: true, json: async () => ({text: JSON.parse(init.body).system === CHARACTER_CRITIC
      ? '{"verdict":"reject","violations":["embellished"]}' : JSON.stringify(p)})});
    applyCharacterTurn(s, t, await proposeCharacterTurn(t, {store: activeStore(), fetchImpl: reject}));
    replies.push(lastWords(s, told.speaker));
  }
  assert.ok(replies.some(r => kc.pressed[told.speaker].includes(r)), replies.join(' | '));
});

test('a person may say where a record of their own making is, if the detective may look at it now', async () => {
  // November 8 play: asked where her envelope of fibres was, the doctor could only guess; her notes lie at her surgery
  const {validateCharacterProposal} = await import('../dist/character-turn.mjs');
  const kc = load('mk-live-20261108-121102.json'), {s, T} = start(kc), doctor = kc.setting.roles.examiner;
  goTo(s, doctor);
  const t = prepareCharacterTurn(s, {person: doctor, text: 'Where are your notes on the body?'});
  const notes = t.context.ownThings?.find(x => /notes/i.test(x.title));
  assert.ok(notes, JSON.stringify(t.context.ownThings));
  const reply = {plan: null, intent: 'answer', account: null, utterance: `They are at ${notes.where}, with the rest of my papers.`, claims: [], sources: [],
    trust: 'unchanged', belief: 'remember_only', engagement: 'continue', rationale: 'x'};
  assert.ok(!/no_account_fact/.test(validateCharacterProposal(t, {...reply, intent: 'clarify'}).reason ?? ''), 'naming where it is is allowed');
  const culprit = actorOf(kc.question.candidates.find(c => c.id === kc.question.truth));
  assert.deepEqual(T.behavior.ownThings(s, culprit), [], 'never the culprit');
});

test('a reference back quotes the part of the account the question is about', async () => {
  const kc = load('mk-live-20261108-121102.json'), doctor = kc.setting.roles.examiner;
  const exam = kc.signs.find(x => x.id === 's_exam');
  exam.text = `${exam.text.replace(/[”"]$/, '')} I've put them in an envelope for you.`;   // a long account, one sentence asked about
  const {s} = start(kc);
  goTo(s, doctor);
  dispatch(s, {type: 'ask', person: doctor, topic: exam.id});
  const t = prepareCharacterTurn(s, {person: doctor, text: 'Where is the envelope?'});
  const a = t.context.accounts.find(x => x.statement.includes('envelope'));
  const p = {plan: null, intent: 'answer', account: a.id, utterance: 'On my desk.', claims: a.claims, sources: a.sources,
    trust: 'unchanged', belief: 'remember_only', engagement: 'continue', rationale: 'x'};
  const reject = async (_url, init) => ({ok: true, json: async () => ({text: JSON.parse(init.body).system === CHARACTER_CRITIC
    ? '{"verdict":"reject","violations":["invented"]}' : JSON.stringify(p)})});
  applyCharacterTurn(s, t, await proposeCharacterTurn(t, {store: activeStore(), fetchImpl: reject}));
  const said = lastWords(s, doctor);
  assert.match(said, /^As I told you: .*envelope/);
  assert.ok(said.length < exam.text.length / 2, said);
});
