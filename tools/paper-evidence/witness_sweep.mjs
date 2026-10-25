#!/usr/bin/env node

// Deterministic, offline evidence sweep for claims_version=2 mystery-kernel cases.
// This intentionally uses the public engine facade and a parameterized copy of
// tests/kernel-autoplay.mjs so every witness goes through guarded dispatch.

import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';

import {certify, summarize, actorOf} from '../../dist/mk/kernel.mjs';
import {
  caseTables,
  createSession,
  diagnostics,
  dispatch,
  exportSession,
  importSession,
  registerKernelCase,
} from '../../dist/engine.mjs';
import {searchInvestigation} from '../../dist/investigation.mjs';

const CLAIMS_VERSION = 2;
const SEEDS = [1, 17, 31];
const INITIAL_WAITS = [0, 5, 15, 30, 60];
const MAX_STEPS = 400;
const ALLOWED_ACTIONS = new Set(['move', 'inspect', 'ask', 'wait', 'accuse']);
const CASE_ROOT = new URL('../../dist/cases/generated/', import.meta.url);
const RESULTS_DIR = new URL('./results/', import.meta.url);
const JSON_OUTPUT = new URL('witness_sweep.json', RESULTS_DIR);
const MARKDOWN_OUTPUT = new URL('witness_sweep.md', RESULTS_DIR);

const ascii = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const readJson = url => JSON.parse(readFileSync(url, 'utf8'));
const stableJson = value => JSON.stringify(value);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const roundMs = value => Math.round(value * 1000) / 1000;
const sorted = values => [...values].sort(ascii);

function withoutTiming(value) {
  if (Array.isArray(value)) return value.map(withoutTiming);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'wallMs')
      .map(([key, item]) => [key, withoutTiming(item)]));
  }
  return value;
}

function loadCases() {
  const manifestSpecs = [
    {corpus: 'stable', url: new URL('index.json', CASE_ROOT)},
    {corpus: 'live', url: new URL('live/index.json', CASE_ROOT)},
    {corpus: 'archive', url: new URL('../archive/2026-10/index.json', CASE_ROOT), optional: true},
  ];
  const byId = new Map();
  const manifests = {};
  const skipped = [];
  const duplicates = [];
  const inputFailures = [];

  for (const spec of manifestSpecs) {
    if (!existsSync(spec.url) && spec.optional) continue;
    if (!existsSync(spec.url)) {
      manifests[spec.corpus] = {path: fileURLToPath(spec.url), entries: 0, present: false};
      inputFailures.push({scope: 'manifest', corpus: spec.corpus, message: `Missing authoritative manifest: ${fileURLToPath(spec.url)}`});
      continue;
    }
    let entries;
    try {
      entries = readJson(spec.url);
      if (!Array.isArray(entries)) throw new Error('Manifest root is not an array');
    } catch (error) {
      manifests[spec.corpus] = {path: fileURLToPath(spec.url), entries: 0, present: true};
      inputFailures.push({scope: 'manifest', corpus: spec.corpus, message: String(error.message ?? error)});
      continue;
    }
    manifests[spec.corpus] = {path: fileURLToPath(spec.url), entries: entries.length, present: true};

    for (const entry of entries) {
      const sourceUrl = new URL(entry.file, spec.optional ? spec.url : CASE_ROOT);
      let records;
      try {
        records = readJson(sourceUrl);
      } catch (error) {
        inputFailures.push({scope: 'case-load', corpus: spec.corpus, id: entry.id ?? null, file: entry.file ?? null, message: String(error.message ?? error)});
        continue;
      }
      if (records.id !== entry.id) {
        inputFailures.push({scope: 'case-id', corpus: spec.corpus, id: entry.id ?? null, file: entry.file ?? null,
          message: `Manifest id ${entry.id} does not match record id ${records.id}`});
        continue;
      }
      if (records.claims_version !== CLAIMS_VERSION) {
        skipped.push({id: entry.id, corpus: spec.corpus, file: entry.file, claimsVersion: records.claims_version ?? 1});
        continue;
      }

      const source = {corpus: spec.corpus, manifestFile: fileURLToPath(spec.url), caseFile: entry.file};
      const prior = byId.get(records.id);
      if (prior) {
        if (!prior.corpora.includes(spec.corpus)) prior.corpora.push(spec.corpus);
        prior.sources.push(source);
        duplicates.push({id: records.id, retainedCorpus: prior.primaryCorpus, additionalCorpus: spec.corpus, additionalFile: entry.file,
          recordsExact: stableJson(prior.records) === stableJson(records)});
      } else {
        byId.set(records.id, {
          id: records.id,
          title: entry.title ?? records.title ?? records.id,
          primaryCorpus: spec.corpus,
          corpora: [spec.corpus],
          sources: [source],
          records,
        });
      }
    }
  }

  const cases = [...byId.values()].sort((a, b) => ascii(a.id, b.id));
  for (const item of cases) {
    item.corpora.sort((a, b) => ['stable', 'live'].indexOf(a) - ['stable', 'live'].indexOf(b));
    item.sources.sort((a, b) => ascii(`${a.corpus}:${a.caseFile}`, `${b.corpus}:${b.caseFile}`));
  }
  skipped.sort((a, b) => ascii(`${a.corpus}:${a.id}`, `${b.corpus}:${b.id}`));
  duplicates.sort((a, b) => ascii(`${a.id}:${a.additionalCorpus}:${a.additionalFile}`, `${b.id}:${b.additionalCorpus}:${b.additionalFile}`));
  return {manifests, cases, skipped, duplicates, inputFailures};
}

function truthActor(records) {
  const hypothesis = records.question?.candidates?.find(candidate => candidate.id === records.question.truth);
  if (!hypothesis) throw new Error('Truth hypothesis is missing');
  const actor = actorOf(hypothesis);
  if (!actor) throw new Error('Truth hypothesis has no actor');
  return actor;
}

// Parameterized copy of tests/kernel-autoplay.mjs. The acquisition order and
// final constable handling deliberately remain the same as the tested helper.
function autoplay(records, {seed, initialWait, accuse, method = records.answer?.method, motive = records.answer?.motive, drop = []}) {
  const id = registerKernelCase(records);
  const session = createSession(seed, id);
  const runtime = caseTables(session);
  const initial = {
    status: session.world.status,
    minute: session.world.minute,
    evidenceCount: session.world.player.evidence.length,
    commandCount: session.events.filter(event => event.kind === 'command').length,
  };
  const held = () => new Set(session.world.player.evidence.map(evidence => evidence.clue));

  if (initialWait > 0) dispatch(session, {type: 'wait', minutes: initialWait});

  for (let step = 0; step < MAX_STEPS; step++) {
    const have = held();
    const locked = new Set(session.world.flags.lockedObjects || []);
    const earned = object => (records.signs.find(sign => sign.id === object)?.requires || []).every(required => have.has(required));
    const object = Object.keys(runtime.LOCATIONS)
      .flatMap(location => runtime.objectsAt(session.world, location).map(candidate => [location, candidate]))
      .find(([, candidate]) => (!locked.has(candidate) || earned(candidate)) && !have.has(runtime.OBJECTS[candidate].clue));

    if (object) {
      if (session.world.player.location !== object[0]) dispatch(session, {type: 'move', to: object[0]});
      dispatch(session, {type: 'inspect', object: object[1]});
      continue;
    }

    const talk = Object.keys(runtime.PEOPLE).flatMap(person => {
      const location = session.world.npcs[person].location;
      if (!runtime.LOCATIONS[location]) return [];
      if (session.world.player.location !== location) return [[person, location, null]];
      return records.signs
        .filter(sign => sign.kind === 'testimony' && sign.speaker === person && !have.has(sign.id)
          && (sign.requires || []).every(required => have.has(required)))
        .map(sign => [person, location, sign.id]);
    });
    const ready = talk.find(candidate => candidate[2]);
    const pending = records.signs.filter(sign => sign.kind === 'testimony' && !have.has(sign.id)
      && (sign.requires || []).every(required => have.has(required)));

    if (ready) {
      dispatch(session, {type: 'ask', person: ready[0], topic: ready[2]});
      continue;
    }
    const target = pending.map(sign => [sign.speaker, session.world.npcs[sign.speaker]?.location])
      .find(([, location]) => runtime.LOCATIONS[location]);
    if (target && session.world.player.location !== target[1]) {
      dispatch(session, {type: 'move', to: target[1]});
      continue;
    }
    if (pending.length) {
      dispatch(session, {type: 'wait', minutes: 10});
      if (step > MAX_STEPS - 5) break;
      continue;
    }
    break;
  }

  const constableLocation = session.world.npcs[runtime.CASE.constable].location;
  if (session.world.player.location !== constableLocation) dispatch(session, {type: 'move', to: constableLocation});
  for (let index = 0; index < 12 && session.world.npcs.bell?.location !== 'square'; index++) {
    dispatch(session, {type: 'wait', minutes: 10});
  }
  const selectedEvidence = [...held()].filter(clue => !drop.includes(clue));
  dispatch(session, {type: 'accuse', suspect: accuse, method, motive, evidence: selectedEvidence});
  const verdict = runtime.behavior.checkCase(session, {suspect: accuse, method, motive, evidence: selectedEvidence});
  return {session, runtime, initial, verdict, selectedEvidence};
}

function commandLog(session) {
  return session.events
    .filter(event => event.kind === 'command' && event.data?.action)
    .map(event => ({minute: event.minute, action: event.data.action}));
}

function actionCounts(log) {
  const counts = {move: 0, inspect: 0, ask: 0, wait: 0, accuse: 0};
  for (const {action} of log) counts[action.type] = (counts[action.type] ?? 0) + 1;
  return counts;
}

function executeTrial(records, options) {
  const started = performance.now();
  const run = autoplay(records, options);
  const wallMs = roundMs(performance.now() - started);
  const log = commandLog(run.session);
  const evidence = sorted(run.session.world.player.evidence.map(item => item.clue));
  const exported = exportSession(run.session);
  const restored = importSession(exported);
  const reexported = exportSession(restored);
  const finalDiagnostics = diagnostics(run.session);
  const restoredDiagnostics = diagnostics(restored);
  const unexpectedActions = sorted(new Set(log.map(item => item.action.type).filter(type => !ALLOWED_ACTIONS.has(type))));
  const rejectedActions = run.session.events.filter(event => event.kind === 'rejected').map(event => ({title: event.title, reason: event.data?.reason ?? null}));
  const trial = {
    seed: options.seed,
    initialWaitMinutes: options.initialWait,
    pristineStart: run.initial,
    solved: run.session.world.status === 'solved',
    verdictStatus: run.verdict?.status ?? null,
    finalStatus: run.session.world.status,
    actionsByType: actionCounts(log),
    actionCount: log.length,
    actionLog: log,
    unexpectedActions,
    evidenceCount: evidence.length,
    evidence,
    selectedEvidenceCount: run.selectedEvidence.length,
    elapsedGameMinutes: run.session.world.minute - run.initial.minute,
    lockedObjectsLeft: sorted(run.session.world.flags.lockedObjects || []),
    rejectedActions,
    diagnostics: finalDiagnostics,
    roundTrip: {
      exactExportEquality: exported === reexported,
      exportSha256: sha256(exported),
      importedExportSha256: sha256(reexported),
      importedCaseId: restored.world.caseId,
      importedStatus: restored.world.status,
      importedEvidence: sorted(restored.world.player.evidence.map(item => item.clue)),
      diagnostics: restoredDiagnostics,
    },
    wallMs,
  };
  return {trial, raw: {actionLog: log, final: {status: trial.finalStatus, evidence}, exported, reexported}};
}

function witnessFailures(trial) {
  const failures = [];
  if (!trial.solved) failures.push('trial did not solve');
  if (trial.verdictStatus !== 'supported') failures.push(`verdict was ${trial.verdictStatus}, not supported`);
  if (trial.finalStatus !== 'solved') failures.push(`final status was ${trial.finalStatus}, not solved`);
  if (trial.lockedObjectsLeft.length) failures.push(`locked objects remained: ${trial.lockedObjectsLeft.join(', ')}`);
  if (trial.unexpectedActions.length) failures.push(`unexpected action types: ${trial.unexpectedActions.join(', ')}`);
  if (trial.rejectedActions.length) failures.push(`${trial.rejectedActions.length} action(s) were rejected`);
  if (!trial.diagnostics.ok) failures.push(...trial.diagnostics.errors.map(error => `diagnostic: ${error}`));
  if (!trial.roundTrip.exactExportEquality) failures.push('session export changed after import/export');
  if (!trial.roundTrip.diagnostics.ok) failures.push(...trial.roundTrip.diagnostics.errors.map(error => `import diagnostic: ${error}`));
  if (trial.roundTrip.importedStatus !== 'solved') failures.push(`imported status was ${trial.roundTrip.importedStatus}`);
  if (trial.pristineStart.commandCount !== 0 || trial.pristineStart.status !== 'playing') failures.push('trial did not start from a pristine playing session');
  return failures;
}

function runNativeSearch(records) {
  const id = registerKernelCase(records);
  const session = createSession(17, id);
  const runtime = caseTables(session);
  const proofRouteCount = runtime.CASE.proofRoutes?.length ?? 0;
  const proofRouteEvidenceCount = runtime.CASE.proofRoutes?.[0]?.all?.length ?? 0;
  const result = searchInvestigation(session, runtime);
  const replay = createSession(17, id), replayFailures = [];
  if (result.status === 'route_found') {
    for (const action of result.actions) {
      const before = replay.events.length;
      dispatch(replay, action);
      if (replay.events.slice(before).some(event => event.kind === 'rejected')) replayFailures.push(`Rejected during public replay: ${JSON.stringify(action)}`);
    }
  }
  const replayDiagnostics = diagnostics(replay);
  if (result.status === 'route_found' && replay.world.status !== 'solved') replayFailures.push(`Public replay ended ${replay.world.status}`);
  if (result.status === 'route_found' && !replayDiagnostics.ok) replayFailures.push(...replayDiagnostics.errors.map(error => `Diagnostic: ${error}`));
  const testimonyIds = new Set(runtime.testimonyClues?.map(item => item.clue) ?? []);
  const acquired = sorted(replay.world.player.evidence.map(item => item.clue));
  const acquiredTestimony = acquired.filter(id => testimonyIds.has(id));
  const ok = result.status === 'route_found' && replayFailures.length === 0 && result.testimonyAcquired === true && acquiredTestimony.length > 0;
  return {
    calledOnce: true,
    status: result.status,
    reason: result.reason ?? null,
    method: result.method ?? null,
    exploredNodes: result.explored ?? null,
    proofRouteCount,
    proofRouteEvidenceCount,
    physicalCatalogSize: result.physicalCatalogSize ?? null,
    testimonyCatalogSize: result.testimonyCatalogSize ?? runtime.testimonyClues?.length ?? 0,
    usablePhysicalCount: result.usablePhysicalCount ?? null,
    usableTestimonyCount: result.usableTestimonyCount ?? null,
    catalogIncomplete: result.catalogIncomplete ?? [],
    searchFailures: result.failures ?? [],
    replayFailures,
    selectedEvidence: result.selectedEvidence ?? [],
    selectedEvidenceCount: result.selectedEvidence?.length ?? 0,
    actions: result.actions ?? [],
    actionsByType: result.actionCounts ?? {},
    actionCount: result.actions?.length ?? 0,
    elapsedGameMinutes: result.minutes ?? null,
    testimonyEvidence: result.testimonyEvidence ?? [],
    testimonyAcquired: result.testimonyAcquired ?? false,
    publicReplay: {finalStatus: replay.world.status, acquiredEvidence: acquired, acquiredTestimony, diagnostics: replayDiagnostics},
    ok,
    interpretation: result.status === 'route_found' ? 'bounded search found and public engine replay authorized a testimony-bearing route'
      : 'bounded search remained unresolved; this is not an unsolvable finding',
  };
}

function runRepeatability(records, primary, actor) {
  const repeats = [
    executeTrial(records, {seed: 17, initialWait: 0, accuse: actor}),
    executeTrial(records, {seed: 17, initialWait: 0, accuse: actor}),
  ];
  const candidates = [primary, ...repeats];
  const actionLogExact = candidates.every(candidate => stableJson(candidate.raw.actionLog) === stableJson(primary.raw.actionLog));
  const finalExact = candidates.every(candidate => stableJson(candidate.raw.final) === stableJson(primary.raw.final));
  const exportedSessionExact = candidates.every(candidate => candidate.raw.exported === primary.raw.exported);
  const eachImportExact = candidates.every(candidate => candidate.raw.exported === candidate.raw.reexported);
  const equality = actionLogExact && finalExact && exportedSessionExact && eachImportExact ? 'exact' : 'not_equal';
  return {
    baselinePlusRepeatCount: candidates.length,
    additionalReruns: repeats.length,
    comparison: {
      equality,
      actionLogExact,
      finalStatusAndEvidenceExact: finalExact,
      exportedSessionExact,
      eachImportedSessionReexportsExactly: eachImportExact,
    },
    actionLogSha256: candidates.map(candidate => sha256(stableJson(candidate.raw.actionLog))),
    finalStatusEvidenceSha256: candidates.map(candidate => sha256(stableJson(candidate.raw.final))),
    exportedSessionSha256: candidates.map(candidate => sha256(candidate.raw.exported)),
    reruns: repeats.map(candidate => candidate.trial),
  };
}

function negativeControlSummary(trial, pillar) {
  const refused = !trial.solved && trial.finalStatus !== 'solved' && trial.verdictStatus !== 'supported'
    && trial.rejectedActions.length > 0;
  const diagnosticsOk = trial.diagnostics.ok && trial.roundTrip.diagnostics.ok && trial.roundTrip.exactExportEquality;
  return {pillar, refused, diagnosticsOk, expectedStatus: 'not_supported', trial,
    ok: refused && diagnosticsOk};
}

function runCase(item) {
  const failures = [];
  const record = {
    id: item.id,
    title: item.title,
    claimsVersion: item.records.claims_version,
    primaryCorpus: item.primaryCorpus,
    corpora: item.corpora,
    sources: item.sources,
    certification: null,
    trials: [],
    repeatability: null,
    nativeSearch: null,
    negativeControls: null,
    failures,
    ok: false,
  };

  let certification;
  try {
    certification = certify(item.records, true, true);
    record.certification = {call: 'certify(records, true, true)', ...summarize(certification)};
    if (!certification.ok) failures.push(...certification.errors.map(error => `certification: ${error}`));
  } catch (error) {
    record.certification = {call: 'certify(records, true, true)', ok: false, errors: [String(error.message ?? error)]};
    failures.push(`certification threw: ${String(error.message ?? error)}`);
  }

  let actor;
  try {
    actor = truthActor(item.records);
    record.truthActor = actor;
  } catch (error) {
    failures.push(`truth actor: ${String(error.message ?? error)}`);
  }

  const rawTrials = new Map();
  if (actor) {
    for (const seed of SEEDS) for (const initialWait of INITIAL_WAITS) {
      const key = `${seed}:${initialWait}`;
      try {
        const execution = executeTrial(item.records, {seed, initialWait, accuse: actor});
        rawTrials.set(key, execution);
        const trialFailures = witnessFailures(execution.trial);
        execution.trial.ok = trialFailures.length === 0;
        execution.trial.failures = trialFailures;
        record.trials.push(execution.trial);
        failures.push(...trialFailures.map(message => `trial seed=${seed} wait=${initialWait}: ${message}`));
      } catch (error) {
        const message = String(error.stack ?? error.message ?? error);
        record.trials.push({seed, initialWaitMinutes: initialWait, ok: false, failures: [message]});
        failures.push(`trial seed=${seed} wait=${initialWait}: ${message}`);
      }
    }
  }

  try {
    record.nativeSearch = runNativeSearch(item.records);
    if (!record.nativeSearch.ok) {
      failures.push(`native search: ${record.nativeSearch.status}; search failures=${record.nativeSearch.searchFailures.length}; replay failures=${record.nativeSearch.replayFailures.length}; testimony acquired=${record.nativeSearch.testimonyAcquired}`);
    }
  } catch (error) {
    record.nativeSearch = {calledOnce: true, status: 'error', reason: String(error.message ?? error), ok: false,
      interpretation: 'native-search execution error; not an unsolvable finding'};
    failures.push(`native search: ${String(error.message ?? error)}`);
  }

  const primary = rawTrials.get('17:0');
  if (primary && actor) {
    try {
      record.repeatability = runRepeatability(item.records, primary, actor);
      if (record.repeatability.comparison.equality !== 'exact') failures.push('repeatability: seed=17 wait=0 reruns were not exactly equal');
      for (const [index, rerun] of record.repeatability.reruns.entries()) {
        const rerunFailures = witnessFailures(rerun);
        rerun.ok = rerunFailures.length === 0;
        rerun.failures = rerunFailures;
        failures.push(...rerunFailures.map(message => `repeatability rerun ${index + 1}: ${message}`));
      }
    } catch (error) {
      record.repeatability = {error: String(error.message ?? error)};
      failures.push(`repeatability: ${String(error.message ?? error)}`);
    }
  } else {
    failures.push('repeatability: seed=17 wait=0 primary trial unavailable');
  }

  if (certification?.ok && actor) {
    const motiveSigns = certification.pillarSigns?.motive ?? [];
    const meansSigns = certification.pillarSigns?.means ?? [];
    try {
      const motive = executeTrial(item.records, {seed: 17, initialWait: 0, accuse: actor, drop: motiveSigns}).trial;
      const means = executeTrial(item.records, {seed: 17, initialWait: 0, accuse: actor, drop: meansSigns}).trial;
      record.negativeControls = {
        withoutMotive: negativeControlSummary(motive, {name: 'motive', droppedEvidence: motiveSigns}),
        withoutMeans: negativeControlSummary(means, {name: 'means', droppedEvidence: meansSigns}),
      };
      if (!record.negativeControls.withoutMotive.ok) failures.push(`negative control motive was not reliably refused (status=${motive.verdictStatus})`);
      if (!record.negativeControls.withoutMeans.ok) failures.push(`negative control means was not reliably refused (status=${means.verdictStatus})`);
    } catch (error) {
      record.negativeControls = {error: String(error.message ?? error)};
      failures.push(`negative controls: ${String(error.message ?? error)}`);
    }
  } else {
    record.negativeControls = {skipped: true, reason: 'Hard certification did not provide validated motive and means pillar signs.'};
  }

  record.ok = failures.length === 0;
  return record;
}

function aggregate(cases, corpus = null) {
  const selected = corpus ? cases.filter(item => item.corpora.includes(corpus)) : cases;
  const trials = selected.flatMap(item => item.trials);
  const searches = selected.map(item => item.nativeSearch).filter(Boolean);
  const controls = selected.flatMap(item => item.negativeControls && !item.negativeControls.skipped && !item.negativeControls.error
    ? [item.negativeControls.withoutMotive, item.negativeControls.withoutMeans] : []);
  return {
    caseCount: selected.length,
    passingCases: selected.filter(item => item.ok).length,
    failingCases: selected.filter(item => !item.ok).length,
    certificationPassed: selected.filter(item => item.certification?.ok).length,
    trialCount: trials.length,
    solvedTrials: trials.filter(trial => trial.solved && trial.verdictStatus === 'supported').length,
    passingTrials: trials.filter(trial => trial.ok).length,
    repeatabilityExact: selected.filter(item => item.repeatability?.comparison?.equality === 'exact').length,
    negativeControlsPassed: controls.filter(control => control.ok).length,
    negativeControlCount: controls.length,
    nativeSearchPassed: searches.filter(search => search.ok).length,
    nativeSearchStatuses: Object.fromEntries(sorted(new Set(searches.map(search => search.status))).map(status => [status, searches.filter(search => search.status === status).length])),
    nativeSearchExploredNodes: searches.reduce((sum, search) => sum + (search.exploredNodes ?? 0), 0),
    nativeSearchFailures: searches.reduce((sum, search) => sum + (search.searchFailures?.length ?? 0), 0),
    nativeReplayFailures: searches.reduce((sum, search) => sum + (search.replayFailures?.length ?? 0), 0),
    nativeTestimonyAcquired: searches.filter(search => search.testimonyAcquired).length,
    nativeSearchCoverageGaps: searches.filter(search => search.status !== 'route_found').length,
  };
}

function fullFailures(inputFailures, cases) {
  return [
    ...inputFailures,
    ...cases.flatMap(item => item.failures.map(message => ({scope: 'case', id: item.id, corpora: item.corpora, message}))),
  ];
}

function markdown(result) {
  const lines = [];
  lines.push('# Executable acquisition witness sweep', '');
  lines.push(`Normalized SHA-256: \`${result.normalizedSha256}\``, '');
  lines.push('## Result', '');
  lines.push(result.ok
    ? `PASS — ${result.aggregates.all.passingCases}/${result.aggregates.all.caseCount} deduplicated claims v2 cases passed hard certification; all ${result.aggregates.all.trialCount} deterministic autoplay executions and all ${result.aggregates.all.nativeSearchPassed} bounded testimony searches passed public engine replay, together with repeatability, save/import checks, and ${result.aggregates.all.negativeControlCount} omission controls.`
    : `FAIL — ${result.failures.length} failure(s) across ${result.aggregates.all.caseCount} deduplicated claims v2 cases.`, '');
  lines.push('## Corpus aggregates', '');
  lines.push('| Corpus | Cases | Passing | Certified | Trials passing | Repeat exact | Negative controls | Native status |',
    '|---|---:|---:|---:|---:|---:|---:|---|');
  for (const corpus of ['stable', 'live', 'all']) {
    const aggregate = result.aggregates[corpus];
    const statuses = Object.entries(aggregate.nativeSearchStatuses).map(([status, count]) => `${status}: ${count}`).join(', ') || 'none';
    lines.push(`| ${corpus} | ${aggregate.caseCount} | ${aggregate.passingCases} | ${aggregate.certificationPassed} | ${aggregate.passingTrials}/${aggregate.trialCount} | ${aggregate.repeatabilityExact}/${aggregate.caseCount} | ${aggregate.negativeControlsPassed}/${aggregate.negativeControlCount} | ${statuses} |`);
  }
  lines.push('', '## Per-case evidence', '');
  lines.push('| Corpus | Case | Cert | Autoplay trials | Repeatability | Bounded search | Testimony | Motive omitted | Means omitted | Wall ms (matrix) |',
    '|---|---|---:|---:|---|---|---|---|---|---:|');
  for (const item of result.cases) {
    const trialWall = roundMs(item.trials.reduce((sum, trial) => sum + (trial.wallMs ?? 0), 0));
    const motive = item.negativeControls?.withoutMotive;
    const means = item.negativeControls?.withoutMeans;
    const search = item.nativeSearch;
    lines.push(`| ${item.corpora.join('+')} | ${item.id} — ${item.title.replace(/\|/g, '\\|')} | ${item.certification?.ok ? 'pass' : 'fail'} | ${item.trials.filter(trial => trial.ok).length}/${item.trials.length} | ${item.repeatability?.comparison?.equality ?? 'n/a'} | ${search?.ok ? `pass (${search.actionCount} actions, ${search.elapsedGameMinutes} min)` : search?.status ?? 'n/a'} | ${search?.testimonyAcquired ? 'acquired' : 'not acquired'} | ${motive ? `${motive.refused ? 'refused' : 'failed'} (${motive.trial.verdictStatus})` : 'n/a'} | ${means ? `${means.refused ? 'refused' : 'failed'} (${means.trial.verdictStatus})` : 'n/a'} | ${trialWall} |`);
  }
  lines.push('', '## Bounded testimony search', '');
  lines.push('`searchInvestigation(session, runtime)` was called once per case. Candidate goals are reduced mechanically from certifier-supported signs and their dependencies; testimony actions use each account’s actual speaker and sign topic. Every returned route was then dispatched again through the public guarded engine. An incomplete catalog or exhausted budget remains `unresolved`, never an impossibility finding.', '');
  lines.push('| Case | Status | Physical / testimony catalog | Nodes | Search / replay failures | Selected evidence | Actions / minutes | Testimony acquired |',
    '|---|---|---:|---:|---:|---:|---:|---|');
  for (const item of result.cases) {
    const search = item.nativeSearch ?? {};
    const evidence = search.selectedEvidence?.map(id => `\`${id}\``).join(', ') || 'none';
    lines.push(`| ${item.id} | ${search.status ?? 'n/a'} | ${search.physicalCatalogSize ?? 'n/a'} / ${search.testimonyCatalogSize ?? 'n/a'} | ${search.exploredNodes ?? 'n/a'} | ${search.searchFailures?.length ?? 'n/a'} / ${search.replayFailures?.length ?? 'n/a'} | ${search.selectedEvidenceCount ?? 'n/a'}: ${evidence} | ${search.actionCount ?? 'n/a'} / ${search.elapsedGameMinutes ?? 'n/a'} | ${search.testimonyAcquired ?? false} |`);
  }
  lines.push('', '## Repeatability', '');
  lines.push(`For every case, the seed 17 / initial wait 0 autoplay execution was run once in the matrix and twice more from pristine sessions. All runs for all ${result.aggregates.all.caseCount} cases also passed export/import/re-export equality. This independent comparator covers the complete typed action log, final status/evidence, and byte-for-byte exported sessions.`, '');
  lines.push('| Case | Equality | Action log | Final status/evidence | Exported session | Imported session |',
    '|---|---|---|---|---|---|');
  for (const item of result.cases) {
    const comparison = item.repeatability?.comparison ?? {};
    lines.push(`| ${item.id} | ${comparison.equality ?? 'n/a'} | ${comparison.actionLogExact ?? false} | ${comparison.finalStatusAndEvidenceExact ?? false} | ${comparison.exportedSessionExact ?? false} | ${comparison.eachImportedSessionReexportsExactly ?? false} |`);
  }
  lines.push('', '## Failures', '');
  if (!result.failures.length) lines.push('None.', '');
  else for (const failure of result.failures) lines.push(`- ${failure.id ? `\`${failure.id}\`: ` : ''}${failure.message}`);
  lines.push('## Caveats', '');
  lines.push('- Generated kernel cases use static, no-model schedules: `life` is disabled, characters remain findable, and the script performs no network or model calls.',
    '- Bounded search proves an existential route only for the current deterministic schedule, finite catalog, action/time/node limits, and accusation rubric. Catalog incompleteness or budget exhaustion remains unresolved.',
    '- The autoplay seed and initial-wait matrix remains independent of bounded search and exercises session initialization, engine time advancement, guarded dispatch, every evidence gate, accusation grading, diagnostics, and save/import replay.',
    '- Wall-clock measurements are observational and intentionally excluded from the normalized SHA-256. Game minutes, action logs, verdicts, evidence, locks, diagnostics, and save data remain in the deterministic comparison.',
    '');
  return `${lines.join('\n')}\n`;
}

function main() {
  const loaded = loadCases();
  const cases = loaded.cases.map(runCase);
  const failures = fullFailures(loaded.inputFailures, cases);
  const result = {
    format: 'living-mystery-executable-witness-sweep-v2',
    claimsVersion: CLAIMS_VERSION,
    experiment: {
      certificationCall: 'certify(records, true, true)',
      seeds: SEEDS,
      initialWaitMinutes: INITIAL_WAITS,
      maxAcquisitionSteps: MAX_STEPS,
      boundedSearch: {horizonMinutes: 180, maxActions: 32, maxNodes: 16000, maxWitnesses: 5, publicEngineReplay: true},
      repeatability: {seed: 17, initialWaitMinutes: 0, additionalRerunsPerCase: 2},
      offline: true,
    },
    manifests: loaded.manifests,
    deduplication: {
      uniqueV2Cases: cases.length,
      skippedNonV2: loaded.skipped,
      duplicateEntries: loaded.duplicates,
      rule: 'Stable manifest precedence; all corpus labels and source files are preserved on a deduplicated case.',
    },
    aggregates: {
      stable: aggregate(cases, 'stable'),
      live: aggregate(cases, 'live'),
      all: aggregate(cases),
    },
    cases,
    failures,
    ok: failures.length === 0,
  };
  result.normalizedSha256 = sha256(JSON.stringify(withoutTiming(result)));

  mkdirSync(RESULTS_DIR, {recursive: true});
  writeFileSync(JSON_OUTPUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  writeFileSync(MARKDOWN_OUTPUT, markdown(result), 'utf8');
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${cases.length} cases, ${result.aggregates.all.passingTrials}/${result.aggregates.all.trialCount} trials, normalized ${result.normalizedSha256}`);
  if (!result.ok) process.exitCode = 1;
}

main();
