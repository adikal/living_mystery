import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {certify} from '../dist/mk/kernel.mjs';
import {exportSession, importSession, caseTables, dispatch} from '../dist/engine.mjs';
import {autoplay} from './kernel-autoplay.mjs';

// Every published generated case (dist/cases/generated) must certify and play through the real engine.
const dir = new URL('../dist/cases/generated/', import.meta.url);
const index = existsSync(new URL('index.json', dir)) ? JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')) : [];
const load = f => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));

test('generated cases are published', () => { assert.ok(index.length >= 1, 'at least one generated case in dist/cases/generated'); });

for (const entry of index) {
  test(`${entry.id}: certified, gated, solvable only with the truth, and save-safe`, () => {
    const kc = load(entry.file), cert = certify(kc);
    assert.ok(cert.ok, JSON.stringify(cert.errors));
    assert.ok(cert.solveDepth >= 3, `deep enough (solve depth ${cert.solveDepth})`);
    const truth = kc.question.candidates.find(h => h.id === kc.question.truth).facts.actor;

    const run = autoplay(kc, {accuse: truth});
    const rt = caseTables(run.session);
    assert.ok(rt.CASE.kernel && rt.PEOPLE[kc.setting.roles.constable] && rt.LOCATIONS[kc.question.crime.place], 'plays in the Bellweather setting');
    assert.deepEqual(run.session.world.flags.lockedObjects, [], 'every hidden lead was eventually earned');
    assert.ok(run.session.events.some(e => e.title === 'A further lead opens up'), 'leads open during play');
    assert.equal(run.solved, true, `the true culprit is accepted: ${run.reply}`);

    for (const h of kc.question.candidates.filter(h => h.id !== kc.question.truth)) {
      const wrong = autoplay(kc, {accuse: h.facts.actor});
      assert.equal(wrong.solved, false, `accusing ${h.facts.actor} must fail`);
    }
    // every pillar is needed: without the motive (or means) evidence, or naming the wrong method or motive, Bell refuses
    const pil = cert.pillarSigns;
    const noMotive = autoplay(kc, {accuse: truth, drop: pil.motive});
    assert.equal(noMotive.solved, false, 'no motive evidence, no case');
    assert.ok(['no_motive', 'ambiguous'].includes(noMotive.verdict.status), noMotive.verdict.status);
    const noMeans = autoplay(kc, {accuse: truth, drop: pil.means});
    assert.equal(noMeans.solved, false, 'no means evidence, no case');
    const okMethods = kc.answer.methods ?? [kc.answer.method], okMotives = kc.answer.motives ?? [kc.answer.motive];
    const otherMethod = rt.CASE.methodOptions.map(([id]) => id).find(id => !okMethods.includes(id));
    const wrongHow = autoplay(kc, {accuse: truth, method: otherMethod});
    assert.equal(wrongHow.verdict.status, 'wrong_method');
    const otherMotive = rt.CASE.motiveOptions.map(([id]) => id).find(id => !okMotives.includes(id));
    const wrongWhy = autoplay(kc, {accuse: truth, motive: otherMotive}).verdict;
    assert.equal(wrongWhy.status, 'wrong_motive');
    assert.match(wrongWhy.feedback, /Read ‘.+’/, 'a wrong reason points back to the motive evidence held');
    // every answer the evidence fairly supports is accepted, not only the generator's label
    for (const motive of okMotives) assert.equal(autoplay(kc, {accuse: truth, motive}).verdict.status, 'supported', motive);
    assert.match(run.reply, /how it was done and why/);
    // saves carry the full case records, so a reload plays the same case
    const restored = importSession(exportSession(run.session));
    assert.equal(restored.world.caseId, kc.id);
    assert.equal(restored.world.status, 'solved');
  });

  test(`${entry.id}: the surface is gated and characters answer in the case's terms`, () => {
    const kc = load(entry.file);
    const start = autoplay(kc, {maxSteps: 0}).session;
    const hidden = kc.signs.filter(s => s.kind !== 'testimony' && (s.requires || []).length).map(s => s.id);
    assert.deepEqual([...start.world.flags.lockedObjects].sort(), hidden.sort(), 'gated clues start hidden');
    // every character has memories of the executed night and beliefs from their attitudes
    const withAttitudes = new Set(kc.attitudes.map(a => a.agent));
    for (const pid of Object.keys(start.world.npcs).filter(p => withAttitudes.has(p)))
      assert.ok(start.world.npcs[pid].beliefs.some(b => b.key.startsWith('mk_')), `${pid} holds beliefs from the case`);
    // asking Bell for guidance works at the square
    dispatch(start, {type: 'ask', person: 'bell', topic: 'night'});
    assert.ok(start.events.some(e => e.kind === 'speech' && e.actor === 'bell'));
  });
}

test('kernel-case records cannot inject markup into the UI', async () => {
  const {sanitizeRecords} = await import('../dist/cases/kernel-case.mjs');
  const bad = {id: 'mk-x', signs: [{text: '<img src=x onerror=alert(1)>', title: 'a" onclick="x'}]};
  const out = sanitizeRecords(bad);
  assert.ok(!/[<>"]/.test(JSON.stringify(out.signs[0].text) .slice(1, -1)) && !out.signs[0].title.includes('"'));
  assert.equal(out.id, 'mk-x');
});

test('showing evidence: generated lines first, kind templates as fallback; reactions per person, else by relation', async () => {
  const {registerKernelCase, createSession, caseTables, dispatch} = await import('../dist/engine.mjs');
  const kc = JSON.parse(readFileSync(new URL('../dist/cases/archive/mk-bw-letter.json', import.meta.url), 'utf8'));
  const doc = kc.signs.find(x => x.kind === 'document'), beh = kc.signs.find(x => x.kind === 'behavior' && x.about);
  doc.show = 'I found this letter. Do you recognise the hand?'; delete kc.signs.find(x => x.kind === 'trace').show;
  const trace = kc.signs.find(x => x.kind === 'trace');
  doc.reactions = {rowan: 'Never seen it in my life.'};
  kc.id = 'mk-test-show';
  const s = autoplay(kc).session, B = caseTables(s).behavior;
  assert.equal(B.presentLine(s, 'rowan', doc.id), doc.show, 'generated show line');
  assert.match(B.presentLine(s, 'rowan', trace.id), /^I noticed .* at .*\?$/, 'trace template');
  assert.equal(B.presentLine(s, beh.about, beh.id), beh.confront || B.presentLine(s, beh.about, beh.id), 'own behaviour is a confrontation');
  assert.ok(!B.presentLine(s, 'rowan', doc.id).includes(doc.text.slice(0, 40)), 'never reads the clue out');
  // present it: the written reaction is used; someone else gets a relation-aware template
  for (const pid of ['rowan', 'ada']) {
    const w = s.world.npcs[pid].location; if (s.world.player.location !== w) dispatch(s, {type: 'move', to: w});
    dispatch(s, {type: 'present', person: pid, clue: doc.id});
  }
  const said = pid => s.events.findLast(e => e.kind === 'speech' && e.actor === pid)?.data.assertion;
  assert.equal(said('rowan'), 'Never seen it in my life.');
  // someone else: a reply worked out from the history (elsewhere at the time) or the one neutral line, never a guess
  assert.match(said('ada'), /^(I wasn’t at .* then, so I can’t tell you anything about it\.|I can’t help you with that\.|Yes, I know .*\.|Yes\. I was at .* then\.)$/);
  assert.doesNotMatch(said('ada'), /I don’t know anything about/);
});

// The case from a real playtest (A Supper at Vale Manor): the fixes it prompted.
test('playtest fixes: a completing clue delivers the account, proof draws a concession, the culprit reacts to a broken alibi', () => {
  const kc = JSON.parse(readFileSync(new URL('./fixtures/mk-supper.json', import.meta.url), 'utf8'));
  const give = (s, ...ids) => { for (const id of ids) dispatch(s, {type: 'inspect', object: id}); };
  const run = autoplay(kc, {maxSteps: 0}), s = run.session;
  const say = pid => s.events.findLast(e => e.kind === 'speech' && e.actor === pid)?.data?.assertion ?? '';
  const has = id => s.world.player.evidence.some(e => e.clue === id);
  // Bell shown the slate gives his account at once (no "Ask me.")
  dispatch(s, {type: 'move', to: 'inn'}); give(s, 'b_ada_thumb', 'x_bare_nail', 's_slate');
  dispatch(s, {type: 'move', to: 'square'});
  dispatch(s, {type: 'present', person: 'bell', clue: 's_slate', tone: 'private'});
  assert.ok(has('s_bell_ada'), 'Bell’s account is delivered by showing the slate');
  assert.doesNotMatch(say('bell'), /Ask me/);
  // Ada, having held back the name, concedes it when shown the glove
  dispatch(s, {type: 'move', to: 'inn'}); give(s, 's_parlour_glove');
  dispatch(s, {type: 'ask', person: 'ada', topic: 's_ada_clara'});
  dispatch(s, {type: 'present', person: 'ada', clue: 's_parlour_glove', tone: 'private'});
  assert.match(say('ada'), /Clara|Miss Vale/, 'the concession names the person she protected');
  dispatch(s, {type: 'ask', person: 'ada', topic: 's_ada_clara'});
  assert.match(say('ada'), /Clara|Miss Vale/, 'and she keeps to it afterwards');
  // the culprit, shown the account that breaks his alibi, answers with a written reaction, not a stock line
  dispatch(s, {type: 'move', to: 'vestry'});
  dispatch(s, {type: 'present', person: 'silas', clue: 's_bell_ada', tone: 'private'});
  assert.doesNotMatch(say('silas'), /I can only tell you what I saw myself/);
  // the doctor gives the time of death and places the poison hours earlier
  const med = kc.signs.find(x => x.id === 's_medical_iris').text;
  assert.match(med, /twenty to one/); assert.match(med, /hours/);
  // the spare key on the cupboard card is explained by the constable
  assert.ok(kc.signs.some(x => x.loose_end && x.speaker === 'bell' && x.requires.includes('s_vestry_cupboard')));
});

test('playtest fixes (Bitter Cordial): hints never endorse a misled lead; people are where their behaviour is seen; the ending explains the motive', () => {
  const kc = JSON.parse(readFileSync(new URL('./fixtures/mk-cordial.json', import.meta.url), 'utf8'));
  const run = autoplay(kc, {maxSteps: 0}), s = run.session, B = run.runtime.behavior;
  assert.equal(s.world.npcs.hugo.location, 'boathouse', 'Hugo is at the boathouse, where he is seen patting his pocket');
  let saw = false;
  for (let i = 0; i < 150 && !saw; i++) {
    const st = B.caseStatus(s), h = B.hints(s);
    if (st.lead === 'clara') { saw = true; assert.match(h.levels[0], /may not be true/); assert.doesNotMatch(h.levels[0], /Only Clara/); }
    const x = kc.signs.find(q => q.id === h.id); if (!x) break;
    if (x.kind === 'testimony') { dispatch(s, {type: 'move', to: s.world.npcs[x.speaker].location}); dispatch(s, {type: 'ask', person: x.speaker, topic: x.id}); }
    else { dispatch(s, {type: 'move', to: x.at}); dispatch(s, {type: 'inspect', object: x.id}); }
  }
  assert.ok(saw, 'the misdirection was reached');
  assert.match(run.runtime.CASE.truth, /living husband/, 'the ending says what the blackmail was about');
});

test('the examiner shown her own notes gives her findings, and remembers the examination', () => {
  const kc = JSON.parse(readFileSync(new URL('./fixtures/mk-rook.json', import.meta.url), 'utf8'));
  const run = autoplay(kc, {maxSteps: 0}), s = run.session;
  const notes = kc.signs.find(x => x.medical && x.kind === 'record'), doctor = kc.setting.roles.examiner;
  const exam = kc.events.find(e => e.type === 'examination' && e.agent === doctor);
  assert.ok(exam && notes.source === exam.id, 'the notes come from the examination event');
  dispatch(s, {type: 'move', to: notes.at}); dispatch(s, {type: 'inspect', object: notes.id});
  if (s.world.player.location !== s.world.npcs[doctor].location) dispatch(s, {type: 'move', to: s.world.npcs[doctor].location});
  dispatch(s, {type: 'present', person: doctor, clue: notes.id, tone: 'private'});
  const said = s.events.findLast(e => e.kind === 'speech' && e.actor === doctor).data.assertion;
  assert.equal(said, kc.signs.find(x => x.medical && x.kind === 'testimony').text);
  assert.ok(s.world.npcs[doctor].memories.some(id => s.events.find(e => e.id === id)?.title?.match(/examin/i)), 'she remembers it');
});

test('showing someone a clue about themselves addresses them, never speaks of them in the third person', async () => {
  const {registerKernelCase, createSession, caseTables} = await import('../dist/engine.mjs');
  const kc = JSON.parse(readFileSync(new URL('./fixtures/mk-rook.json', import.meta.url), 'utf8'));
  const s = createSession(1, registerKernelCase(kc)), B = caseTables(s).behavior;
  const names = Object.fromEntries(kc.people.map(p => [p.id, p.name]));
  for (const x of kc.signs.filter(x => x.kind === 'testimony' && x.claim?.person && x.claim.person !== x.speaker)) {
    const line = B.presentLine(s, x.claim.person, x.id);
    assert.match(line, /\byou\b/i, x.id);
    assert.ok(!line.includes(names[x.claim.person]), `${x.id}: ${line}`);
  }
});

test('clue titles read naturally in template lines; people the history never mentions are not in the case', async () => {
  const {registerKernelCase, createSession, caseTables} = await import('../dist/engine.mjs');
  const kc = JSON.parse(readFileSync(new URL('./fixtures/mk-halt.json', import.meta.url), 'utf8'));
  const rt = registerKernelCase(kc), s = createSession(1, rt), B = caseTables(s).behavior;
  for (const x of kc.signs.filter(x => x.kind !== 'testimony')) {
    const line = B.presentLine(s, kc.setting.roles.constable, x.id);
    assert.doesNotMatch(line, /^I (found|noticed) [a-z]*[A-Z][a-z]+ (in|at|on|from)\b/, `${x.id}: ${line}`);
  }
  const mentioned = new Set(kc.people.map(p => p.id));
  for (const pid of Object.keys(s.world.npcs)) assert.ok(mentioned.has(pid) || pid === kc.setting.roles.constable, pid);
});

test('a character may ask what the detective means once, then must answer, evade or refuse', async () => {
  const {validateCharacterProposal} = await import('../dist/character-turn.mjs');
  const mk = history => ({person: 'dora', action: null, context: {accounts: [], cast: {people: [], places: []}, player: {utterance: 'when?'},
    character: {plans: [], history}}});
  const p = {plan: null, intent: 'clarify', account: null, utterance: 'When was what?', claims: [], sources: [], trust: 'unchanged', belief: 'remember_only', engagement: 'continue', rationale: ''};
  const asked = [{speaker: 'player', text: 'when did you last see him'}, {speaker: 'dora', intent: 'clarify', text: 'What do you mean?'}, {speaker: 'player', text: 'when'}];
  assert.match(validateCharacterProposal(mk(asked), p).reason ?? '', /already asked/, 'a question answered with another question');
  assert.doesNotMatch(validateCharacterProposal(mk(asked), {...p, utterance: 'I cannot say.'}).reason ?? '', /already asked/, 'declining is fine');
  const declined = [{speaker: 'player', text: 'what was in it'}, {speaker: 'dora', intent: 'clarify', text: 'I cannot speak to that.'}, {speaker: 'player', text: 'who has it?'}];
  assert.doesNotMatch(validateCharacterProposal(mk(declined), p).reason ?? '', /already asked/, 'a decline is not a question');
  const long = [{speaker: 'dora', intent: 'clarify', text: 'What do you mean?'}, {speaker: 'player', text: 'a'}, {speaker: 'dora', text: 'b.'}, {speaker: 'player', text: 'c'}];
  assert.doesNotMatch(validateCharacterProposal(mk(long), p).reason ?? '', /already asked/, 'only the reply just before counts');
});

test('a menu question the history gives nothing to answer is asked, and answered with the neutral line', async () => {
  const {registerKernelCase, createSession, dispatch} = await import('../dist/engine.mjs');
  const {prepareCharacterTurn, applyCharacterTurn} = await import('../dist/character-turn.mjs');
  const {NEUTRAL_LINE} = await import('../dist/kernel.mjs');
  const kc = JSON.parse(readFileSync(new URL('../dist/cases/generated/mk-live-20261002-235614.json', import.meta.url), 'utf8'));
  const s = createSession(1, registerKernelCase(kc)), bell = kc.setting.roles.constable;
  if (s.world.player.location !== s.world.npcs[bell].location) dispatch(s, {type: 'move', to: s.world.npcs[bell].location});
  const {caseTables} = await import('../dist/engine.mjs');
  assert.ok(!caseTables(s).CASE.topicsFor[bell].some(([k]) => k === 'night'), 'the menu does not offer a question the history cannot answer');
  const action = {type: 'ask', person: bell, topic: 'night'};
  const t = prepareCharacterTurn(s, {person: bell, text: 'What is your account of last night?', action});
  assert.equal(t.context.accounts.length, 0, 'nothing in the history: no account to choose');
  applyCharacterTurn(s, t, {audit: {...t.context && {status: 'fallback', reason: 'disabled', context: t.context, attempts: []}}, proposal: null});
  assert.equal(s.events.findLast(e => e.kind === 'speech' && e.actor === bell).data.assertion, NEUTRAL_LINE);
});

test('the night question gives the evening account first; the morning account is a published account like the evening one', async () => {
  const {registerKernelCase, createSession, dispatch, caseTables} = await import('../dist/engine.mjs');
  const kc = JSON.parse(readFileSync(new URL('../dist/cases/generated/mk-live-20261002-235614.json', import.meta.url), 'utf8'));
  const s = createSession(1, registerKernelCase(kc)), doc = kc.setting.roles.examiner, B = caseTables(s).behavior;
  if (s.world.player.location !== s.world.npcs[doc].location) dispatch(s, {type: 'move', to: s.world.npcs[doc].location});
  dispatch(s, {type: 'ask', person: doc, topic: 'night'});
  const night = s.events.findLast(e => e.kind === 'speech' && e.actor === doc).data.assertion;
  assert.notEqual(night, kc.signs.find(x => x.medical && x.kind === 'testimony').text, 'the findings are not her account of last night');
  const morning = kc.signs.find(x => x.morning && x.speaker === doc);
  assert.ok(morning, 'publishing wrote her morning');
  assert.ok(caseTables(s).CASE.topicsFor[doc].some(([k]) => k === 'morning'), 'the menu offers it');
  assert.ok(B.freeTextTopics(s, doc).includes(morning.id), 'and free text can use it');
  dispatch(s, {type: 'ask', person: doc, topic: 'morning'});
  assert.equal(s.events.findLast(e => e.kind === 'speech' && e.actor === doc).data.assertion, morning.text);
  const culprit = kc.question.candidates.find(h => h.id === kc.question.truth).facts.actor;
  for (const x of kc.signs.filter(x => x.morning)) assert.equal(Boolean(x.deceptive), x.speaker === culprit || x.surface_checked === 'cover', x.id);
});

test('questions about last night never give an account of this morning; a repeated question is answered with a reference back', async () => {
  const {registerKernelCase, createSession, dispatch} = await import('../dist/engine.mjs');
  const kc = JSON.parse(readFileSync(new URL('../dist/cases/generated/mk-live-20261002-235614.json', import.meta.url), 'utf8'));
  const s = createSession(1, registerKernelCase(kc));
  const morningIds = new Set(kc.signs.filter(x => x.morning).map(x => x.text));   // the morning summaries
  for (const p of kc.people.map(p => p.id).filter(p => s.world.npcs[p])) {
    if (s.world.player.location !== s.world.npcs[p].location) dispatch(s, {type: 'move', to: s.world.npcs[p].location});
    for (const t of ['night', 'more', 'more']) {
      dispatch(s, {type: 'ask', person: p, topic: t});
      const said = s.events.findLast(e => e.kind === 'speech' && e.actor === p)?.data.assertion;
      assert.ok(!morningIds.has(said), `${p} ${t}: ${said}`);
    }
    if (kc.signs.some(x => x.morning && x.speaker === p)) {
      dispatch(s, {type: 'ask', person: p, topic: 'morning'}); dispatch(s, {type: 'ask', person: p, topic: 'morning'});
      assert.match(s.events.findLast(e => e.kind === 'speech' && e.actor === p).data.assertion, /^As I told you: /);
    }
  }
});

test('leads that open together say what opened once, then each its own line', async () => {
  const {registerKernelCase, createSession, dispatch} = await import('../dist/engine.mjs');
  const kc = JSON.parse(readFileSync(new URL('../dist/cases/generated/mk-live-20261002-235614.json', import.meta.url), 'utf8'));
  // three leads behind one key, in one place, with a shared opening line (as publishing writes it)
  const key = kc.signs.find(x => x.kind === 'item' && !x.requires?.length) ?? kc.signs.find(x => !x.requires?.length && x.kind !== 'testimony');
  const leads = kc.signs.filter(x => x.kind !== 'testimony' && x.id !== key.id).slice(0, 3);
  for (const [i, x] of leads.entries()) Object.assign(x, {requires: [key.id], at: key.at, unlock_lead: 'The key opens the room.', unlock: `Line ${i}.`});
  kc.id = 'mk-test-unlock';
  const s = createSession(1, registerKernelCase(kc));
  if (s.world.player.location !== key.at) dispatch(s, {type: 'move', to: key.at});
  dispatch(s, {type: 'inspect', object: key.id});
  const text = s.events.findLast(e => e.title === 'A further lead opens up')?.data?.playerText ?? s.events.findLast(e => e.title === 'A further lead opens up')?.playerText ?? '';
  assert.equal((String(JSON.stringify(s.events.filter(e => e.title === 'A further lead opens up'))).match(/The key opens the room\./g) || []).length, 1, 'said once');
});

test('every account with no prerequisite can be reached from the Talk menu alone, in every published case', async () => {
  const {registerKernelCase, createSession, dispatch, caseTables} = await import('../dist/engine.mjs');
  const {readdirSync} = await import('node:fs');
  const dirs = ['../dist/cases/generated/', '../dist/cases/generated/live/'];
  const files = dirs.flatMap(d => { try { return readdirSync(new URL(d, import.meta.url)).filter(f => f.startsWith('mk-') && f.endsWith('.json')).map(f => new URL(d + f, import.meta.url)); } catch { return []; } });
  for (const f of files) {
    const kc = JSON.parse(readFileSync(f, 'utf8'));
    const s = createSession(1, registerKernelCase(kc)), T = caseTables(s), B = T.behavior;
    for (const pid of Object.keys(s.world.npcs)) {
      if (s.world.player.location !== s.world.npcs[pid].location) dispatch(s, {type: 'move', to: s.world.npcs[pid].location});
      for (let round = 0; round < 6; round++) {   // ask everything the menu offers, a few times over
        const menu = [...(T.CASE.topicsFor?.[pid] ?? T.CASE.topics ?? []), ...B.followupOptions(s, pid)].map(([t]) => t);
        for (const t of menu) if (!t.startsWith('why:')) dispatch(s, {type: 'ask', person: pid, topic: t});
      }
      const held = new Set(s.world.player.evidence.map(e => e.clue));
      const stuck = kc.signs.filter(x => x.kind === 'testimony' && x.speaker === pid && !(x.requires || []).length && !held.has(x.id));
      assert.deepEqual(stuck.map(x => x.id), [], `${kc.id}: ${pid} has accounts the menu never reaches`);
    }
  }
});
