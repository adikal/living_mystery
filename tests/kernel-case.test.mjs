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
    assert.ok(rt.CASE.kernel && rt.PEOPLE.clara && rt.LOCATIONS.manor, 'plays in the Bellweather setting');
    assert.deepEqual(run.session.world.flags.lockedObjects, [], 'every hidden lead was eventually earned');
    assert.ok(run.session.events.some(e => e.title === 'A further lead opens up'), 'leads open during play');
    assert.equal(run.solved, true, `the true culprit is accepted: ${run.reply}`);

    for (const h of kc.question.candidates.filter(h => h.id !== kc.question.truth)) {
      const wrong = autoplay(kc, {accuse: h.facts.actor});
      assert.equal(wrong.solved, false, `accusing ${h.facts.actor} must fail`);
    }
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
  const kc = JSON.parse(readFileSync(new URL('../dist/cases/generated/mk-bw-letter.json', import.meta.url), 'utf8'));
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
  assert.match(said('ada'), /know|recognise|seen/i);
});
