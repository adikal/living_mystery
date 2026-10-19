#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
  analyse,
  certify,
  claimOf,
  presence,
  summarize,
  travelTable,
} from '../../dist/mk/kernel.mjs';
import { consistent } from '../../dist/mk/claims.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '../..');
const GENERATED_DIR = path.join(ROOT, 'dist/cases/generated');
const RESULTS_DIR = path.join(SCRIPT_DIR, 'results');
const JSON_RESULT = path.join(RESULTS_DIR, 'certifier_experiments.json');
const MARKDOWN_RESULT = path.join(RESULTS_DIR, 'certifier_experiments.md');
const WARMUP_ITERATIONS = 10;
const MEASURED_ITERATIONS = 100;
const HARD_OPTIONS = { requirePillars: true, requireBacking: true };
const clone = value => structuredClone(value);
const arr = value => (Array.isArray(value) ? value : []);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const round = (value, digits = 4) => Number(value.toFixed(digits));

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function runCertify(input, requirePillars = true, requireBacking = true) {
  return certify(clone(input), requirePillars, requireBacking);
}

function loadCases() {
  const indexes = [
    { classification: 'stable', file: 'index.json' },
    { classification: 'live', file: 'live/index.json' },
  ];
  const byId = new Map();
  const excluded = [];
  for (const index of indexes) {
    const indexPath = path.join(GENERATED_DIR, index.file);
    const entries = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    for (const entry of entries) {
      const sourcePath = path.join(GENERATED_DIR, entry.file);
      const sourceText = fs.readFileSync(sourcePath, 'utf8');
      const payload = JSON.parse(sourceText);
      if (payload.claims_version !== 2) {
        excluded.push({ classification: index.classification, id: entry.id, file: entry.file, claimsVersion: payload.claims_version ?? null });
        continue;
      }
      if (entry.id !== payload.id) throw new Error(`Index ID ${entry.id} does not match payload ID ${payload.id}`);
      const digest = sha256(stableJson(payload));
      const prior = byId.get(payload.id);
      if (prior) {
        if (prior.sha256 !== digest) throw new Error(`Duplicate case ID ${payload.id} has different payloads`);
        if (!prior.classifications.includes(index.classification)) prior.classifications.push(index.classification);
        if (!prior.files.includes(entry.file)) prior.files.push(entry.file);
        continue;
      }
      byId.set(payload.id, {
        id: payload.id,
        title: payload.title,
        classification: index.classification,
        classifications: [index.classification],
        files: [entry.file],
        indexSolveDepth: entry.solveDepth,
        sha256: digest,
        payload,
      });
    }
  }
  return { cases: [...byId.values()], excluded };
}

function mapSorted(values, mapId = id => id) {
  return arr(values).map(mapId).sort();
}

function sortedObject(object, mapKey = key => key) {
  return Object.fromEntries(Object.entries(object ?? {}).map(([key, value]) => [mapKey(key), value]).sort(([a], [b]) => a.localeCompare(b)));
}

function semanticReport(report, inverseSignIds = new Map()) {
  if (!report.ok) return { ok: false, errors: [...arr(report.errors)].sort() };
  const restoreSign = id => inverseSignIds.get(id) ?? id;
  return {
    ok: true,
    solveDepth: report.solveDepth,
    maxDepth: report.maxDepth,
    surface: mapSorted(report.surface),
    threads: sortedObject(report.threads),
    pillars: sortedObject(report.pillars),
    mmoDepth: report.mmoDepth,
    twist: report.twist,
    key: mapSorted(report.key, restoreSign),
    motive: mapSorted(report.motive, restoreSign),
    means: mapSorted(report.means, restoreSign),
    pillarSigns: {
      motive: mapSorted(report.pillarSigns?.motive, restoreSign),
      means: mapSorted(report.pillarSigns?.means, restoreSign),
    },
    unbacked: mapSorted(report.unbacked, restoreSign),
    herrings: mapSorted(report.herrings, restoreSign),
    falseSigns: mapSorted(report.falseSigns, restoreSign),
  };
}

function percentile(sorted, q) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower + 1] === undefined ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

function pearson(rows, xKey, yKey) {
  const xs = rows.map(row => row[xKey]);
  const ys = rows.map(row => row[yKey]);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const numerator = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0);
  const dx = Math.sqrt(xs.reduce((sum, x) => sum + (x - mx) ** 2, 0));
  const dy = Math.sqrt(ys.reduce((sum, y) => sum + (y - my) ** 2, 0));
  return dx && dy ? numerator / (dx * dy) : 0;
}

function correlationDescription(value) {
  const magnitude = Math.abs(value);
  const strength = magnitude < 0.2 ? 'negligible' : magnitude < 0.4 ? 'weak' : magnitude < 0.6 ? 'moderate' : magnitude < 0.8 ? 'strong' : 'very strong';
  const direction = value < 0 ? 'negative' : value > 0 ? 'positive' : 'flat';
  return `${strength} ${direction} association`;
}

function runScaling(cases) {
  const rows = [];
  for (const item of cases) {
    for (let i = 0; i < WARMUP_ITERATIONS; i += 1) runCertify(item.payload, true, true);
    const samplesMs = [];
    for (let i = 0; i < MEASURED_ITERATIONS; i += 1) {
      const input = clone(item.payload);
      const start = performance.now();
      const report = certify(input, true, true);
      samplesMs.push(performance.now() - start);
      if (!report.ok) throw new Error(`Scaling baseline failed for ${item.id}: ${report.errors.join('; ')}`);
    }
    const sorted = [...samplesMs].sort((a, b) => a - b);
    rows.push({
      caseId: item.id,
      classification: item.classification,
      signs: item.payload.signs.length,
      events: item.payload.events.length,
      solveDepth: item.baseline.solveDepth,
      medianMs: round(percentile(sorted, 0.5)),
      p90Ms: round(percentile(sorted, 0.9)),
      p99Ms: round(percentile(sorted, 0.99)),
      minMs: round(sorted[0]),
      maxMs: round(sorted.at(-1)),
      samplesMs: samplesMs.map(value => round(value)),
    });
  }
  const correlations = ['signs', 'events', 'solveDepth'].map(metric => {
    const coefficient = round(pearson(rows, metric, 'medianMs'));
    return { metric, timingMetric: 'per-case medianMs', coefficient, description: correlationDescription(coefficient) };
  });
  return {
    warmupIterationsPerCase: WARMUP_ITERATIONS,
    measuredIterationsPerCase: MEASURED_ITERATIONS,
    timer: 'performance.now()',
    cloneTiming: 'excluded (each input is deep-cloned immediately before the timed certify call)',
    percentileMethod: 'linear interpolation at index (n - 1) * q',
    certifyArguments: [true, true],
    cases: rows,
    correlations,
  };
}

function findImpossibleTravelMutation(input) {
  const tt = travelTable(input);
  const intervals = presence(input);
  const attitudesByAgent = new Map();
  for (const attitude of arr(input.attitudes)) if (!attitudesByAgent.has(attitude.agent)) attitudesByAgent.set(attitude.agent, attitude.id);
  for (const person of Object.keys(intervals).sort()) {
    const cause = attitudesByAgent.get(person);
    if (!cause) continue;
    const last = intervals[person].at(-1);
    if (!last) continue;
    const [, end, fromPlace, sourceEvent] = last;
    const destination = input.setting.places.map(place => place.id).sort().find(place => place !== fromPlace && tt[fromPlace][place] > 1 && tt[fromPlace][place] < 1e9);
    if (!destination) continue;
    const id = `__paper_fault_travel_${person}`;
    input.events.push({ id, type: 'ordinary', agent: person, others: [], place: destination, start: end + 1, end: end + 1, causedBy: cause, summary: 'Synthetic travel probe.' });
    return { person, sourceEvent, addedEvent: id, fromPlace, destination, availableMinutes: 1, requiredMinutes: tt[fromPlace][destination] };
  }
  return null;
}

function findMissingCauseMutation(input) {
  const event = input.events.find(candidate => candidate.agent && candidate.causedBy !== 'nature');
  if (!event) return null;
  const priorCause = event.causedBy;
  delete event.causedBy;
  return { eventId: event.id, agent: event.agent, removedCause: priorCause ?? null };
}

function addUnsupportedAccount(input) {
  const personId = '__paper_fault_unsupported_speaker';
  const signId = '__paper_fault_unsupported_account';
  input.people.push({ id: personId, name: 'Synthetic unsupported speaker', role: 'test witness', traits: {} });
  input.signs.push({ id: signId, kind: 'testimony', title: 'Unsupported synthetic account', text: 'I offer an account with no historical basis.', speaker: personId });
  return { personId, signId };
}

function makeComprehensivePublicCopies(input, baseline, prefix) {
  const originals = [...input.signs];
  const benignSource = originals.find(sign => claimOf(sign) && baseline.A.truthval[sign.id] === true);
  if (!benignSource) return [];
  const benignClaim = clone(claimOf(benignSource));
  const copies = [];
  for (const original of originals.filter(sign => sign.kind !== 'public' && (!claimOf(sign) || baseline.A.truthval[sign.id] === true)).sort((a, b) => a.id.localeCompare(b.id))) {
    const copy = clone(original);
    copy.id = `${prefix}_${copies.length.toString().padStart(3, '0')}`;
    copy.kind = 'public';
    copy.title = `Public copy of ${original.title ?? original.id}`;
    const claimSource = claimOf(copy) ? original.id : benignSource.id;
    if (!claimOf(copy)) copy.claim = clone(benignClaim);
    delete copy.requires;
    delete copy.needs;
    delete copy.unlock;
    delete copy.reading;
    input.signs.push(copy);
    copies.push({ source: original.id, copy: copy.id, claimSource });
  }
  return copies;
}

function hardFaultRecord(item, fault, mutation, expectedSubstring, report, extra = {}) {
  const errors = arr(report.errors);
  const matchedErrors = errors.filter(error => error.includes(expectedSubstring));
  return {
    caseId: item.id,
    classification: item.classification,
    fault,
    status: 'applied',
    baselineGreen: item.baseline.ok,
    mutation,
    expectedSignal: expectedSubstring,
    mutantDetection: !report.ok && matchedErrors.length > 0,
    mutantHardOk: report.ok,
    matchedErrors,
    collateralErrors: errors.filter(error => !matchedErrors.includes(error)),
    ...extra,
  };
}

function skippedFaultRecord(item, fault, reason, precondition) {
  return {
    caseId: item.id,
    classification: item.classification,
    fault,
    status: 'skipped',
    baselineGreen: item.baseline.ok,
    precondition,
    skipReason: reason,
    expectedSignal: null,
    mutantDetection: null,
    collateralErrors: [],
  };
}

function runFault(item, fault) {
  const original = item.payload;
  if (fault === 'impossible_travel') {
    const mutant = clone(original);
    const mutation = findImpossibleTravelMutation(mutant);
    if (!mutation) return skippedFaultRecord(item, fault, 'No person had both a causing attitude and a reachable destination requiring more than one minute.', 'A participant with an attitude, a recorded event, and a finite travel path longer than one minute.');
    return hardFaultRecord(item, fault, mutation, 'cannot travel', certify(mutant, true, true));
  }

  if (fault === 'missing_event_cause') {
    const mutant = clone(original);
    const mutation = findMissingCauseMutation(mutant);
    if (!mutation) return skippedFaultRecord(item, fault, 'No agent event with a non-nature cause exists.', 'An event with an agent and causedBy other than nature.');
    return hardFaultRecord(item, fault, mutation, 'has no causing attitude', certify(mutant, true, true));
  }

  if (fault === 'unsupported_account_backing') {
    const mutant = clone(original);
    const mutation = addUnsupportedAccount(mutant);
    const strict = certify(clone(mutant), true, true);
    const permissive = certify(clone(mutant), true, false);
    const expectedSubstring = 'accounts not backed by the true history';
    const matchedErrors = arr(strict.errors).filter(error => error.includes(expectedSubstring));
    const permissiveIdentified = permissive.ok && arr(permissive.unbacked).includes(mutation.signId);
    return {
      caseId: item.id,
      classification: item.classification,
      fault,
      status: 'applied',
      baselineGreen: item.baseline.ok,
      mutation,
      expectedSignal: `${expectedSubstring}; permissive unbacked includes ${mutation.signId}`,
      mutantDetection: !strict.ok && matchedErrors.length > 0 && permissiveIdentified,
      mutantHardOk: strict.ok,
      strictMatchedErrors: matchedErrors,
      permissiveOk: permissive.ok,
      permissiveUnbacked: permissive.ok ? permissive.unbacked : [],
      permissiveErrors: arr(permissive.errors),
      collateralErrors: arr(strict.errors).filter(error => !matchedErrors.includes(error)),
    };
  }

  if (fault === 'unreachable_load_bearing_clue') {
    const attempted = [];
    for (const signId of item.baseline.key) {
      const mutant = clone(original);
      const sign = mutant.signs.find(candidate => candidate.id === signId);
      if (!sign) continue;
      sign.requires = [...new Set([...arr(sign.requires), sign.id])];
      sign.unlock = String(sign.unlock ?? '').trim() || 'Synthetic self-dependency makes this clue unreachable.';
      const report = certify(mutant, true, true);
      const unreachable = Boolean(report.A) && !report.A.reachable.has(signId);
      const consequence = arr(report.errors).find(error => error.includes('answer not unique') || error.includes("no reachable, true evidence of the culprit's"));
      attempted.push({ signId, unreachable, errors: arr(report.errors) });
      if (!report.ok && unreachable && consequence) {
        const matchedErrors = arr(report.errors).filter(error => error === consequence);
        return {
          caseId: item.id,
          classification: item.classification,
          fault,
          status: 'applied',
          baselineGreen: item.baseline.ok,
          mutation: { signId, addedSelfRequirement: true },
          expectedSignal: 'sign absent from A.reachable plus a hard uniqueness/pillar consequence',
          reachableField: false,
          mutantDetection: true,
          mutantHardOk: false,
          matchedErrors,
          collateralErrors: arr(report.errors).filter(error => !matchedErrors.includes(error)),
          attemptedSignIds: attempted.map(value => value.signId),
        };
      }
    }
    return skippedFaultRecord(item, fault, `No baseline key sign produced both unreachability and a hard consequence. Attempts: ${JSON.stringify(attempted)}`, 'A load-bearing sign from baseline.key whose removal from the reachable closure breaks uniqueness or a required pillar.');
  }

  if (fault === 'duplicate_true_candidate') {
    const mutant = clone(original);
    const truth = mutant.question.candidates.find(candidate => candidate.id === mutant.question.truth);
    if (!truth) return skippedFaultRecord(item, fault, 'The truth candidate is missing.', 'A candidate matching question.truth.');
    const duplicate = clone(truth);
    duplicate.id = '__paper_fault_duplicate_truth';
    duplicate.label = `${truth.label ?? truth.id} (duplicate)`;
    mutant.question.candidates.push(duplicate);
    return hardFaultRecord(item, fault, { sourceCandidate: truth.id, duplicateCandidate: duplicate.id }, 'answer not unique', certify(mutant, true, true));
  }

  if (fault === 'no_twist_public_copies') {
    if (!item.baseline.twist) return skippedFaultRecord(item, fault, 'Baseline already has twist=false.', 'A baseline report with twist=true.');
    const mutant = clone(original);
    const copies = makeComprehensivePublicCopies(mutant, item.baseline, '__paper_fault_no_twist');
    if (!copies.length) return skippedFaultRecord(item, fault, 'No true claim was available to make structurally valid public copies.', 'At least one true claimed sign, plus non-public true or claimless signs to copy.');
    const report = certify(mutant, true, true);
    return {
      caseId: item.id,
      classification: item.classification,
      fault,
      status: 'applied',
      baselineGreen: item.baseline.ok,
      mutation: { copies },
      expectedSignal: 'hard certification remains green and report.twist becomes false',
      mutantDetection: report.ok && report.twist === false,
      mutantHardOk: report.ok,
      observedReport: report.ok ? { solveDepth: report.solveDepth, surface: [...report.surface], twist: report.twist } : null,
      collateralErrors: arr(report.errors),
    };
  }

  if (fault === 'missing_motive_pillar' || fault === 'missing_means_pillar') {
    const pillar = fault === 'missing_motive_pillar' ? 'motive' : 'means';
    const signIds = item.baseline.pillarSigns[pillar];
    if (!signIds.length) return skippedFaultRecord(item, fault, `Baseline has no ${pillar} pillar signs.`, `At least one baseline pillarSigns.${pillar} entry.`);
    const mutant = clone(original);
    for (const sign of mutant.signs.filter(candidate => signIds.includes(candidate.id))) {
      sign.kind = 'public';
      delete sign.requires;
      delete sign.needs;
      delete sign.unlock;
      delete sign.reading;
    }
    const expectedSubstring = pillar === 'motive' ? "no reachable, true evidence of the culprit's MOTIVE" : "no reachable, true evidence of the culprit's MEANS";
    return hardFaultRecord(item, fault, { publicizedPillarSigns: [...signIds] }, expectedSubstring, certify(mutant, true, true));
  }

  if (fault === 'depth_shortcut_public_copies') {
    if (!(item.baseline.solveDepth > 0)) return skippedFaultRecord(item, fault, 'Baseline solveDepth is not positive.', 'A baseline solveDepth greater than zero.');
    const mutant = clone(original);
    const copies = makeComprehensivePublicCopies(mutant, item.baseline, '__paper_fault_depth_shortcut');
    if (!copies.length) return skippedFaultRecord(item, fault, 'No true claim was available to make structurally valid public copies.', 'At least one true claimed sign, plus non-public true or claimless signs to copy.');
    const report = certify(mutant, true, true);
    return {
      caseId: item.id,
      classification: item.classification,
      fault,
      status: 'applied',
      baselineGreen: item.baseline.ok,
      mutation: { copies, baselineSolveDepth: item.baseline.solveDepth },
      expectedSignal: 'hard certification remains green and solveDepth is lower than baseline',
      mutantDetection: report.ok && report.solveDepth < item.baseline.solveDepth,
      mutantHardOk: report.ok,
      observedReport: report.ok ? { solveDepth: report.solveDepth, surface: [...report.surface], twist: report.twist } : null,
      collateralErrors: arr(report.errors),
    };
  }

  if (fault === 'inconsistent_claims_without_defeat') {
    const A = analyse(clone(original));
    const tt = travelTable(original);
    const pairs = [];
    for (const source of [...original.signs].sort((a, b) => a.id.localeCompare(b.id))) {
      for (const targetId of [...arr(source.defeats)].sort()) {
        const target = A.signs[targetId];
        if (!claimOf(source) || !claimOf(target)) continue;
        if (!consistent(original, [[source.id, claimOf(source)], [target.id, claimOf(target)]], tt)) pairs.push([source.id, target.id]);
      }
    }
    if (!pairs.length) return skippedFaultRecord(item, fault, 'No existing defeat edge joins a jointly inconsistent claimed pair.', 'A defeat edge between two claimed signs for which consistent(...) is false.');
    const [sourceId, targetId] = pairs[0];
    const mutant = clone(original);
    for (const sign of mutant.signs) {
      if (sign.id === sourceId) sign.defeats = arr(sign.defeats).filter(id => id !== targetId);
      if (sign.id === targetId) sign.defeats = arr(sign.defeats).filter(id => id !== sourceId);
    }
    return hardFaultRecord(item, fault, { removedDefeatBetween: [sourceId, targetId], suitablePairs: pairs }, 'cannot all be true', certify(mutant, true, true));
  }

  throw new Error(`Unknown fault ${fault}`);
}

const FAULTS = [
  'impossible_travel',
  'missing_event_cause',
  'unsupported_account_backing',
  'unreachable_load_bearing_clue',
  'duplicate_true_candidate',
  'no_twist_public_copies',
  'missing_motive_pillar',
  'missing_means_pillar',
  'depth_shortcut_public_copies',
  'inconsistent_claims_without_defeat',
];

const QUALITY_FAULTS = new Set(['no_twist_public_copies', 'depth_shortcut_public_copies']);

function runFaults(cases) {
  const records = cases.flatMap(item => FAULTS.map(fault => runFault(item, fault)));
  const summary = FAULTS.map(fault => {
    const relevant = records.filter(record => record.fault === fault);
    const applied = relevant.filter(record => record.status === 'applied');
    const skipped = relevant.filter(record => record.status === 'skipped');
    const detected = applied.filter(record => record.mutantDetection).length;
    return {
      fault,
      totalCases: relevant.length,
      applied: applied.length,
      detected,
      skipped: skipped.length,
      detectionRateAmongApplied: applied.length ? round(detected / applied.length, 4) : null,
      missedCases: applied.filter(record => !record.mutantDetection).map(record => record.caseId),
      skippedCases: skipped.map(record => ({ caseId: record.caseId, reason: record.skipReason })),
    };
  });
  const aggregate = group => {
    const rows = records.filter(record => record.status === 'applied' && (group === 'quality' ? QUALITY_FAULTS.has(record.fault) : !QUALITY_FAULTS.has(record.fault)));
    return {applied: rows.length, expectedSignalObserved: rows.filter(record => record.mutantDetection).length,
      strictRejections: rows.filter(record => record.mutantHardOk === false).length,
      strictGreen: rows.filter(record => record.mutantHardOk === true).length};
  };
  return { definitions: [...FAULTS], groups: {hardInvalid: aggregate('hard'), qualityDiagnostics: aggregate('quality')}, summary, records };
}

function compareSemantic(expected, actual) {
  return stableJson(expected) === stableJson(actual);
}

function renameSignIds(input) {
  const signIds = new Set(input.signs.map(sign => sign.id));
  const forward = new Map([...signIds].sort().map((id, index) => [id, `__paper_sign_${index.toString().padStart(4, '0')}`]));
  const inverse = new Map([...forward].map(([oldId, newId]) => [newId, oldId]));
  const mapSign = id => forward.get(id) ?? id;
  for (const sign of input.signs) {
    sign.id = mapSign(sign.id);
    if (Array.isArray(sign.requires)) sign.requires = sign.requires.map(mapSign);
    if (Array.isArray(sign.needs)) sign.needs = sign.needs.map(id => signIds.has(id) ? mapSign(id) : id);
    if (Array.isArray(sign.defeats)) sign.defeats = sign.defeats.map(mapSign);
    if (Array.isArray(sign.explainedBy)) sign.explainedBy = sign.explainedBy.map(id => signIds.has(id) ? mapSign(id) : id);
  }
  return { forward, inverse };
}

function metamorphicRecord(item, transform, report, expected, actual, details = {}) {
  const passed = report.ok && compareSemantic(expected, actual) && details.depthAccountingOk !== false;
  return {
    caseId: item.id,
    classification: item.classification,
    transform,
    status: passed ? 'passed' : 'violation',
    baselineGreen: item.baseline.ok,
    mutantGreen: report.ok,
    semanticMatch: compareSemantic(expected, actual),
    expected,
    actual,
    errors: arr(report.errors),
    ...details,
  };
}

function runMetamorphic(cases) {
  const records = [];
  for (const item of cases) {
    const expected = semanticReport(item.baseline);

    const reordered = clone(item.payload);
    reordered.signs.reverse();
    reordered.question.candidates.reverse();
    const reorderReport = certify(reordered, true, true);
    records.push(metamorphicRecord(item, 'deterministic_sign_and_candidate_reorder', reorderReport, expected, semanticReport(reorderReport), {
      mutation: { signs: 'reversed', candidates: 'reversed' },
      canonicalization: 'Candidate and sign-ID arrays sorted; object keys sorted.',
    }));

    const renamed = clone(item.payload);
    const { forward, inverse } = renameSignIds(renamed);
    const renameReport = certify(renamed, true, true);
    records.push(metamorphicRecord(item, 'bijective_sign_id_rename', renameReport, expected, semanticReport(renameReport, inverse), {
      mutation: { mapping: Object.fromEntries([...forward].sort(([a], [b]) => a.localeCompare(b))) },
      canonicalization: 'All reported sign IDs inverse-mapped, then sign-ID arrays sorted.',
    }));

    const inert = clone(item.payload);
    const inertId = '__paper_inert_claimless_sign';
    inert.signs.push({ id: inertId, kind: 'item', title: 'Inert synthetic sign', text: 'This sign carries no claim and has no dependencies.' });
    const inertReport = certify(inert, true, true);
    const baselineDepths = item.baseline.A.eff;
    const mutantDepths = inertReport.A?.eff ?? {};
    const originalDepthsUnchanged = Object.entries(baselineDepths).every(([id, depth]) => mutantDepths[id] === depth);
    const depthAccounting = {
      expectedAddedDepth: { [inertId]: 0 },
      observedAddedDepth: Object.hasOwn(mutantDepths, inertId) ? { [inertId]: mutantDepths[inertId] } : {},
      originalDepthsUnchanged,
      baselineDepthCount: Object.keys(baselineDepths).length,
      mutantDepthCount: Object.keys(mutantDepths).length,
    };
    const depthAccountingOk = inertReport.ok && mutantDepths[inertId] === 0 && originalDepthsUnchanged && Object.keys(mutantDepths).length === Object.keys(baselineDepths).length + 1;
    records.push(metamorphicRecord(item, 'add_inert_claimless_sign', inertReport, expected, semanticReport(inertReport), {
      mutation: { addedSign: inertId },
      canonicalization: 'The requested semantic outputs are compared directly; A.eff is checked separately for exactly one depth-0 addition.',
      depthAccounting,
      depthAccountingOk,
    }));
  }
  const violations = records.filter(record => record.status === 'violation').map(record => ({
    caseId: record.caseId,
    classification: record.classification,
    transform: record.transform,
    mutantGreen: record.mutantGreen,
    semanticMatch: record.semanticMatch,
    errors: record.errors,
    expected: record.expected,
    actual: record.actual,
    depthAccounting: record.depthAccounting,
  }));
  const summary = [...new Set(records.map(record => record.transform))].map(transform => {
    const relevant = records.filter(record => record.transform === transform);
    return { transform, checked: relevant.length, passed: relevant.filter(record => record.status === 'passed').length, violations: relevant.filter(record => record.status === 'violation').length };
  });
  return { comparedFields: Object.keys(semanticReport(cases[0].baseline)), summary, records, violations };
}

function markdownEscape(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function renderMarkdown(result) {
  const lines = [
    '# Certifier experiments',
    '',
    `All ${result.corpus.uniqueClaimsV2Cases} unique claims-version-2 cases passed the strict baseline \`certify(case, true, true)\`: ${result.corpus.stableCases} stable and ${result.corpus.liveCases} live. Inputs were deep-cloned before every certification.`,
    '',
    '## Scaling',
    '',
    `Environment: Node ${result.environment.node}, ${result.environment.platform}/${result.environment.arch}, ${result.environment.cpuModel} (${result.environment.logicalCpus} logical CPUs). Each case used ${result.scaling.warmupIterationsPerCase} warmups and ${result.scaling.measuredIterationsPerCase} measured iterations; cloning was outside the timed interval.`,
    '',
    '| Case | Class | Signs | Events | Depth | Median ms | P90 ms | P99 ms |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const row of result.scaling.cases) lines.push(`| ${markdownEscape(row.caseId)} | ${row.classification} | ${row.signs} | ${row.events} | ${row.solveDepth} | ${row.medianMs} | ${row.p90Ms} | ${row.p99Ms} |`);
  lines.push('', ...result.scaling.correlations.map(item => `- Median timing vs. ${item.metric}: r=${item.coefficient} (${item.description}).`));

  lines.push('', '## Fault injection', '', '| Fault | Applied | Detected | Skipped | Detection rate (applied only) |', '|---|---:|---:|---:|---:|');
  for (const row of result.faults.summary) lines.push(`| ${row.fault} | ${row.applied} | ${row.detected} | ${row.skipped} | ${row.detectionRateAmongApplied == null ? 'n/a' : `${round(row.detectionRateAmongApplied * 100, 2)}%`} |`);
  const skips = result.faults.summary.flatMap(row => row.skippedCases.map(item => ({ fault: row.fault, ...item })));
  const misses = result.faults.summary.flatMap(row => row.missedCases.map(caseId => ({ fault: row.fault, caseId })));
  lines.push('', 'Skipped mutations are not counted as passes.', '',
    `Strict hard-invalid mutations: ${result.faults.groups.hardInvalid.expectedSignalObserved}/${result.faults.groups.hardInvalid.applied} produced the expected rejection.`,
    `Quality probes: ${result.faults.groups.qualityDiagnostics.expectedSignalObserved}/${result.faults.groups.qualityDiagnostics.applied} remained strictly certified and changed the expected twist/depth diagnostic.`);
  if (skips.length) {
    lines.push('', '### Skips', '');
    for (const skip of skips) lines.push(`- \`${skip.fault}\` / \`${skip.caseId}\`: ${markdownEscape(skip.reason)}`);
  } else lines.push('', 'No fault mutations were skipped.');
  if (misses.length) {
    lines.push('', '### Missed detections', '');
    for (const miss of misses) lines.push(`- \`${miss.fault}\` / \`${miss.caseId}\``);
  } else lines.push('', 'Every applied mutation produced its expected signal. Hard-invalid and quality-diagnostic totals are reported separately above.');

  lines.push('', '## Metamorphic checks', '', '| Transform | Checked | Passed | Violations |', '|---|---:|---:|---:|');
  for (const row of result.metamorphic.summary) lines.push(`| ${row.transform} | ${row.checked} | ${row.passed} | ${row.violations} |`);
  if (result.metamorphic.violations.length) {
    lines.push('', '### Violations', '');
    for (const violation of result.metamorphic.violations) lines.push(`- \`${violation.transform}\` / \`${violation.caseId}\`: mutantGreen=${violation.mutantGreen}, semanticMatch=${violation.semanticMatch}`);
  } else lines.push('', `No violations were observed across the selected semantic projection (${result.metamorphic.comparedFields.join(', ')}). Inert-sign checks separately verified one added effective-depth entry at depth 0 and unchanged depths for all original signs.`);

  lines.push('', '## Reproducibility', '', `Semantic fingerprint (excludes timing samples and environment): \`${result.semanticFingerprint}\`.`, '', 'The JSON artifact contains case hashes, all timing samples, every per-case fault outcome and collateral error, transformation mappings, canonical semantic outputs, skips, and violations.', '');
  return lines.join('\n');
}

function main() {
  const loaded = loadCases();
  const cases = loaded.cases;
  if (!cases.length) throw new Error('No claims-version-2 cases were found');
  for (const item of cases) {
    const baseline = certify(clone(item.payload), true, true);
    item.baseline = baseline;
    if (!baseline.ok) throw new Error(`Strict baseline failed for ${item.id}: ${baseline.errors.join('; ')}`);
  }

  const scaling = runScaling(cases);
  const faults = runFaults(cases);
  const metamorphic = runMetamorphic(cases);
  const corpusCases = cases.map(item => ({
    id: item.id,
    title: item.title,
    classification: item.classification,
    classifications: item.classifications,
    files: item.files,
    claimsVersion: item.payload.claims_version,
    sha256: item.sha256,
    signs: item.payload.signs.length,
    events: item.payload.events.length,
    candidates: item.payload.question.candidates.length,
    baselineGreen: item.baseline.ok,
    baseline: semanticReport(item.baseline),
  }));
  const semanticEvidence = {
    corpus: corpusCases,
    faultSummary: faults.summary,
    faultRecords: faults.records,
    metamorphicSummary: metamorphic.summary,
    metamorphicRecords: metamorphic.records,
  };
  const result = {
    schemaVersion: 1,
    experiment: 'claims-version-2 certifier scaling, fault injection, and metamorphic checks',
    environment: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      cpuModel: os.cpus()[0]?.model ?? 'unknown',
      logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    configuration: {
      caseIndexes: ['dist/cases/generated/index.json', 'dist/cases/generated/live/index.json'],
      requiredClaimsVersion: 2,
      hardCertification: HARD_OPTIONS,
      deepClone: 'structuredClone before every certify/analyse mutation boundary',
      networkCalls: false,
    },
    corpus: {
      uniqueClaimsV2Cases: cases.length,
      stableCases: cases.filter(item => item.classifications.includes('stable')).length,
      liveCases: cases.filter(item => item.classifications.includes('live')).length,
      excluded: loaded.excluded,
      cases: corpusCases,
    },
    scaling,
    faults,
    metamorphic,
    semanticFingerprint: sha256(stableJson(semanticEvidence)),
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(JSON_RESULT, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(MARKDOWN_RESULT, renderMarkdown(result));

  const undetected = faults.summary.reduce((sum, row) => sum + row.applied - row.detected, 0);
  const violations = metamorphic.violations.length;
  console.log(JSON.stringify({
    cases: cases.length,
    faultMutationsApplied: faults.summary.reduce((sum, row) => sum + row.applied, 0),
    faultMutationsSkipped: faults.summary.reduce((sum, row) => sum + row.skipped, 0),
    undetected,
    metamorphicChecks: metamorphic.records.length,
    metamorphicViolations: violations,
    semanticFingerprint: result.semanticFingerprint,
    json: path.relative(ROOT, JSON_RESULT),
    markdown: path.relative(ROOT, MARKDOWN_RESULT),
  }));
  if (undetected || violations) process.exitCode = 1;
}

main();
