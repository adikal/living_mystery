import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {registerKernelCase, createSession, caseTables, dispatch, diagnostics} from '../dist/engine.mjs';
import {acquisitionCatalog, searchInvestigation} from '../dist/investigation.mjs';

const root = new URL('../dist/cases/generated/', import.meta.url);
function currentCases() {
  const found = new Map();
  for (const manifest of ['index.json', 'live/index.json']) {
    const url = new URL(manifest, root);
    if (!existsSync(url)) continue;
    for (const entry of JSON.parse(readFileSync(url, 'utf8'))) {
      const records = JSON.parse(readFileSync(new URL(entry.file, root), 'utf8'));
      if (records.claims_version === 2 && !found.has(records.id)) found.set(records.id, records);
    }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}
const cases = currentCases();

test('kernel testimony catalog preserves every concrete speaker, topic, and prerequisite', () => {
  assert.ok(cases.length > 0);
  for (const records of cases) {
    const id = registerKernelCase(records), session = createSession(17, id), runtime = caseTables(session);
    const catalog = acquisitionCatalog(runtime, session.world);
    const expected = records.signs.filter(sign => sign.kind === 'testimony');
    assert.equal(runtime.testimonyClues.length, expected.length, records.id);
    assert.equal(catalog.testimonyCatalogSize, expected.length, records.id);
    assert.deepEqual(catalog.incomplete, [], records.id);
    for (const sign of expected) {
      const item = runtime.testimonyClues.find(candidate => candidate.clue === sign.id);
      assert.deepEqual(item, {id: sign.id, clue: sign.id, speaker: sign.speaker, topic: sign.id,
        requires: [...(sign.requires ?? [])], duration: 3}, `${records.id}:${sign.id}`);
      const acquisition = catalog.entries.find(candidate => candidate.clue === sign.id);
      assert.deepEqual(acquisition.action, {type: 'ask', person: sign.speaker, topic: sign.id}, `${records.id}:${sign.id}`);
      assert.equal(acquisition.location, session.world.npcs[sign.speaker].location, `${records.id}:${sign.id}`);
    }
  }
});

test('kernel testimony keeps the published record in the notebook and creates no physical-discovery memories', () => {
  const records = cases[0], id = registerKernelCase(records), session = createSession(17, id), runtime = caseTables(session);
  const descriptor = runtime.testimonyClues.find(item => runtime.kernel.model.evidenceClaims[item.clue]?.length);
  assert.ok(descriptor, `${records.id}: expected structured testimony claims`);
  const speaker = descriptor.speaker;
  const bystander = Object.keys(session.world.npcs).find(id => id !== speaker);
  assert.ok(bystander, `${records.id}: expected a testimony bystander`);
  const location = session.world.npcs[speaker].location;
  const setup = runtime.kernel.commit(session, {kind: 'movement', title: 'Testimony memory fixture', changes: {
    'player.location': location,
    [`npcs.${bystander}.location`]: location,
    [`npcs.${bystander}.travel`]: null,
  }});
  const assertion = 'This is the exact account spoken during the investigation.';
  const claims = runtime.kernel.model.evidenceClaims[descriptor.clue].map(claim => ({...claim, attribution: 'Spoken account'}));
  const speech = runtime.kernel.speech(session, speaker, assertion, setup, {claims});
  assert.equal(runtime.kernel.addEvidence(session, descriptor.clue, speech, speaker), true);
  const evidence = session.world.player.evidence.find(item => item.clue === descriptor.clue);
  const discovery = session.events.find(event => event.id === evidence.eventId);
  assert.equal(evidence.text, undefined, 'a generated case records the published account, never the spoken wording');
  assert.ok(discovery.playerText.endsWith(runtime.CLUES[descriptor.clue].text));
  assert.deepEqual(discovery.data.claims, claims);
  assert.ok(discovery.parents.includes(speech));
  assert.ok(session.world.npcs[speaker].memories.includes(speech), 'the speaker remembers speaking');
  assert.ok(!session.world.npcs[speaker].memories.includes(discovery.id), 'the speaker does not remember a physical discovery');
  assert.ok(!session.world.npcs[bystander].memories.includes(discovery.id), 'a bystander does not remember hearing a physical discovery');
});

test('bounded search mechanically discovers a testimony-bearing route for every current kernel case', () => {
  for (const records of cases) {
    const id = registerKernelCase(records), session = createSession(17, id), runtime = caseTables(session);
    const result = searchInvestigation(session, runtime);
    assert.equal(result.status, 'route_found', `${records.id}: ${result.reason ?? result.failures?.join('; ')}`);
    assert.equal(result.route, 'kernel-certifier-support', records.id);
    assert.ok(result.actions.some(action => action.type === 'ask'), `${records.id}: route must acquire testimony`);
    assert.ok(result.testimonyEvidence.length > 0, records.id);
    assert.equal(result.testimonyAcquired, true, records.id);
    assert.ok(result.explored <= result.maxNodes, records.id);
    assert.ok(result.minutes <= result.horizon, records.id);
    assert.ok(result.actions.length <= result.maxActions, records.id);
  }
});

test('bounded kernel routes replay through the public engine dispatcher', () => {
  for (const records of cases) {
    const id = registerKernelCase(records), source = createSession(17, id), runtime = caseTables(source);
    const result = searchInvestigation(source, runtime), replay = createSession(17, id);
    for (const action of result.actions) {
      const before = replay.events.length;
      dispatch(replay, action);
      assert.ok(!replay.events.slice(before).some(event => event.kind === 'rejected'), `${records.id}: ${JSON.stringify(action)}`);
    }
    assert.equal(replay.world.status, 'solved', records.id);
    assert.ok(result.testimonyEvidence.every(clue => replay.world.player.evidence.some(item => item.clue === clue)), records.id);
    assert.ok(diagnostics(replay).ok, `${records.id}: ${diagnostics(replay).errors.join('; ')}`);
  }
});

test('bounded kernel search preserves unresolved semantics when its node budget is exhausted', () => {
  const records = cases[0], id = registerKernelCase(records), session = createSession(17, id);
  const result = searchInvestigation(session, caseTables(session), {maxNodes: 1});
  assert.equal(result.status, 'unresolved');
  assert.equal(result.reason, 'Search node budget exhausted');
  assert.match(result.scope, /no universal impossibility claim/i);
});


test('plain-string testimony descriptors are not reported as an incomplete catalog', async () => {
  const {acquisitionCatalog} = await import('../dist/investigation.mjs');
  const s = createSession(17), catalog = acquisitionCatalog(caseTables(s), s.world);
  assert.deepEqual(catalog.incomplete, []);
  assert.equal(catalog.testimonyCatalogSize, catalog.usableTestimonyCount);
});

test('a rejected kernel save leaves no definition and no cached case behind', async () => {
  const {importSession, exportSession} = await import('../dist/engine.mjs');
  const records = structuredClone(cases[0]);
  records.id = 'mk-test-rejected-import';
  records.title = 'Only in a tampered save';
  const source = createSession(17, registerKernelCase(structuredClone(records)));
  const tampered = JSON.parse(exportSession(source));
  tampered.events.at(-1).title = 'tampered';
  tampered.world.caseRecords = {...records, id: 'mk-test-rejected-import-2', title: 'Never valid'};
  tampered.world.caseId = 'mk-test-rejected-import-2';
  assert.throws(() => importSession(JSON.stringify(tampered)));
  assert.throws(() => caseTables('mk-test-rejected-import-2'), /Unknown case/);
});

test('records and their JSON round trip share one runtime', () => {
  const records = structuredClone(cases[0]);
  records.id = 'mk-test-identity-undefined';
  const a = createSession(3, registerKernelCase({...records, extra: undefined}));
  const b = createSession(3, registerKernelCase(JSON.parse(JSON.stringify(records))));
  assert.equal(caseTables(a), caseTables(b));
});
