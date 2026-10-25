#!/usr/bin/env node
/** Deterministic local bridge from archived case JSON to the current strict certifier. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {certify} from '../../dist/mk/kernel.mjs';
import {paperCorpus, missingFromCorpus} from './paper_evidence_helpers.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(SCRIPT_DIR, '../..');
const GENERATED_DIR = path.join(ROOT, 'dist/cases/generated');

const arr = value => (Array.isArray(value) ? value : []);

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function normalizedSha256(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function relativeSource(sourcePath) {
  const absolute = path.resolve(ROOT, sourcePath);
  const relative = path.relative(ROOT, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`case path escapes repository: ${sourcePath}`);
  return relative.split(path.sep).join('/');
}

export function certifyCase(sourcePath, metadata = {}) {
  const source = relativeSource(sourcePath);
  const payload = JSON.parse(fs.readFileSync(path.join(ROOT, source), 'utf8'));
  const report = certify(structuredClone(payload), true, true);
  if (!report.ok) throw new Error(`strict certification failed for ${source}: ${arr(report.errors).join('; ')}`);
  const threadDepths = Object.fromEntries(Object.entries(report.threads).sort(([left], [right]) => left.localeCompare(right)));
  const stableDepth = Math.max(...Object.values(threadDepths).filter(Number.isFinite));
  const falseSet = new Set(report.falseSigns);
  const lieIds = payload.signs.filter(sign => sign.kind === 'testimony' && falseSet.has(sign.id)).map(sign => sign.id).sort();
  const otherFalseSignIds = report.falseSigns.filter(id => !lieIds.includes(id)).sort();
  return {
    case_id: payload.id,
    title: payload.title,
    classification: metadata.classification ?? null,
    classifications: [...new Set(metadata.classifications ?? [])].sort(),
    source_paths: [...new Set(metadata.source_paths ?? [source])].sort(),
    claims_version: payload.claims_version,
    normalized_sha256: normalizedSha256(payload),
    signs: payload.signs.length,
    events: payload.events.length,
    candidates: payload.question.candidates.length,
    instantaneous_solve_depth: report.solveDepth,
    stable_depth: stableDepth,
    instantaneous_equals_stable: report.solveDepth === stableDepth,
    thread_depths: threadDepths,
    pillar_depths: {
      opportunity: report.pillars.opportunity,
      means: report.pillars.means,
      motive: report.pillars.motive,
      maximum: report.mmoDepth,
    },
    lies: {count: lieIds.length, ids: lieIds},
    other_false_signs: {count: otherFalseSignIds.length, ids: otherFalseSignIds},
    false_signs: {count: report.falseSigns.length, ids: [...report.falseSigns].sort()},
    herrings: {count: report.herrings.length, ids: [...report.herrings].sort()},
  };
}

export function loadCurrentCorpus() {
  // the paper's cases (paper_corpus.json), wherever they are listed now, under the manifest that listed them then
  const corpus = paperCorpus();
  const indexes = [
    {classification: 'stable', source: 'dist/cases/generated/index.json'},
    {classification: 'live', source: 'dist/cases/generated/live/index.json'},
    {classification: 'archive', source: 'dist/cases/archive/2026-10/index.json', base: 'dist/cases/archive/2026-10'},
  ];
  const byId = new Map();
  const excluded = [];
  for (const index of indexes) {
    if (!fs.existsSync(path.join(ROOT, index.source))) continue;
    const entries = JSON.parse(fs.readFileSync(path.join(ROOT, index.source), 'utf8'));
    for (const entry of entries) {
      if (!corpus.has(entry.id)) continue;
      const classification = corpus.get(entry.id).classification;
      const source = `${index.base ?? 'dist/cases/generated'}/${entry.file}`;
      const payload = JSON.parse(fs.readFileSync(path.join(ROOT, source), 'utf8'));
      if (payload.claims_version !== 2) {
        excluded.push({case_id: entry.id, source_path: source, claims_version: payload.claims_version ?? null});
        continue;
      }
      if (entry.id !== payload.id) throw new Error(`index ID ${entry.id} does not match payload ID ${payload.id}`);
      const digest = normalizedSha256(payload);
      const prior = byId.get(payload.id);
      if (prior) {
        if (prior.normalized_sha256 !== digest) throw new Error(`duplicate case ID ${payload.id} has different payloads`);
        prior.classifications.add(classification);
        prior.source_paths.add(source);
        continue;
      }
      byId.set(payload.id, {
        payload,
        classification,
        classifications: new Set([classification]),
        source_paths: new Set([source]),
        normalized_sha256: digest,
      });
    }
  }
  missingFromCorpus(corpus, [...byId.keys(), ...excluded.map(x => x.case_id)]);
  const cases = [...byId.values()].map(item => certifyCase([...item.source_paths][0], {
    classification: item.classification,
    classifications: [...item.classifications],
    source_paths: [...item.source_paths],
  })).sort((left, right) => left.case_id.localeCompare(right.case_id));
  return {
    manifest_paths: indexes.map(index => index.source),
    required_claims_version: 2,
    strict_certifier_arguments: [true, true],
    cases,
    excluded: excluded.sort((left, right) => left.case_id.localeCompare(right.case_id)),
    normalized_corpus_sha256: normalizedSha256(cases.map(item => ({case_id: item.case_id, normalized_sha256: item.normalized_sha256}))),
  };
}

function main() {
  const args = process.argv.slice(2);
  let output;
  if (args[0] === '--corpus' && args.length === 1) {
    output = loadCurrentCorpus();
  } else if (args[0] === '--cases' && args.length > 1) {
    output = args.slice(1).map(source => certifyCase(source)).sort((left, right) => left.case_id.localeCompare(right.case_id));
  } else {
    throw new Error('usage: structural_depth.mjs --corpus | --cases CASE.json [...]');
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
