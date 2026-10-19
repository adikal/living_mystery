#!/usr/bin/env node

// E0: direct post-commit certification of every cumulative concealment set observed in the defensible e3c cohort.

import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {certifyConcealments, concealmentAvailability} from '../../dist/morning.mjs';
import {addNormalizedSha256, ascii, collectProvenance, sortedUnique} from './paper_evidence_helpers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RUN_DIR = resolve(ROOT, 'tools/playtest/runs/e3c');
const RESULTS_DIR = resolve(ROOT, 'tools/paper-evidence/results');
const JSON_OUTPUT = resolve(RESULTS_DIR, 'committed_concealment_audit.json');
const MARKDOWN_OUTPUT = resolve(RESULTS_DIR, 'committed_concealment_audit.md');
const ACCEPTED = 'still solvable';

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const rel = path => relative(ROOT, path).split('\\').join('/');
const rootsKey = roots => JSON.stringify(roots);

export function selectE3cEpisodes() {
  const paths = readdirSync(RUN_DIR).filter(name => name.endsWith('.json')).sort(ascii).map(name => resolve(RUN_DIR, name));
  const selected = [];
  for (const path of paths) {
    const value = readJson(path);
    if (value && typeof value === 'object' && !Array.isArray(value) && value.id && Array.isArray(value.report?.trace)) selected.push({path, value});
  }
  const scorePath = resolve(RUN_DIR, 'scores.json');
  const scoreRows = readJson(scorePath);
  const scores = new Map(scoreRows.map(row => [row.id, row]));
  if (new Set(selected.map(item => item.value.id)).size !== selected.length) throw new Error('duplicate raw episode IDs');
  if (scores.size !== scoreRows.length) throw new Error('duplicate score IDs');
  const episodeIds = selected.map(item => item.value.id).sort(ascii);
  const scoreIds = [...scores.keys()].sort(ascii);
  if (JSON.stringify(episodeIds) !== JSON.stringify(scoreIds)) throw new Error('raw episode and score IDs differ');
  const counts = new Map();
  for (const id of episodeIds) {
    const caseId = scores.get(id).case.split('/').at(-1).replace(/\.json$/, '');
    counts.set(caseId, (counts.get(caseId) ?? 0) + 1);
  }
  if (counts.size !== 3 || [...counts.values()].some(count => count !== 9)) {
    throw new Error('e3c defensible subset must contain exactly three cases with nine episodes each');
  }
  return {selected, scores, scorePath};
}

function planningRows(trace, episodeId, traceIndex) {
  const director = trace.director ?? {};
  return Object.entries(director.audit?.solvable ?? {}).sort(([a], [b]) => ascii(a, b)).map(([composite, verdict]) => {
    const separator = composite.indexOf(':');
    if (separator < 1 || separator === composite.length - 1) throw new Error(`invalid audit.solvable key ${composite}`);
    return {
      episodeId,
      traceIndex,
      actor: composite.slice(0, separator),
      clue: composite.slice(separator + 1),
      verdict,
      accepted: verdict === ACCEPTED,
      directorStatus: director.status ?? null,
    };
  });
}

function auditEpisode(item, score) {
  const episode = item.value;
  const casePath = resolve(ROOT, score.case);
  if (!existsSync(casePath)) throw new Error(`missing case for ${episode.id}: ${score.case}`);
  const records = readJson(casePath);
  if (records.id !== episode.report.case || records.id !== score.case.split('/').at(-1).replace(/\.json$/, '')) {
    throw new Error(`case identity mismatch for ${episode.id}`);
  }
  const acquired = new Set();
  const planning = [];
  const seen = new Set();
  const states = [];
  let previous = new Set();
  for (const [traceIndex, trace] of episode.report.trace.entries()) {
    planning.push(...planningRows(trace, episode.id, traceIndex));
    for (const clue of trace.new_evidence ?? []) acquired.add(clue);
    const roots = sortedUnique(trace.concealed ?? []);
    const current = new Set(roots);
    const shrank = [...previous].filter(clue => !current.has(clue));
    if (shrank.length) throw new Error(`cumulative concealed set shrank in ${episode.id} at trace ${traceIndex}`);
    previous = current;
    const key = rootsKey(roots);
    if (seen.has(key)) continue;
    seen.add(key);
    const session = {
      world: {
        player: {evidence: sortedUnique([...acquired]).map(clue => ({clue}))},
        flags: {morning: {concealed: roots, agendas: {}}},
      },
    };
    const availability = concealmentAvailability(session, records);
    const certificate = certifyConcealments(session, records, {phase: 'post_commit'});
    const priorPlanningAudits = planning.filter(row => roots.includes(row.clue) && row.traceIndex <= traceIndex)
      .sort((a, b) => a.traceIndex - b.traceIndex || ascii(a.actor, b.actor) || ascii(a.clue, b.clue));
    states.push({
      roots,
      firstTraceIndex: traceIndex,
      acquiredAtFirstTrace: availability.acquired,
      dependencyClosureRemoved: certificate.removed,
      certificate,
      priorPlanningAssociation: {
        classification: 'historical planning association; not used as the post-commit certificate',
        matchingAuditCount: priorPlanningAudits.length,
        hasSameOrPriorAcceptedAuditForEveryRoot: roots.length > 0 && roots.every(root => priorPlanningAudits.some(row => row.clue === root && row.accepted)),
        matches: priorPlanningAudits,
      },
    });
  }
  return {
    episodeId: episode.id,
    caseId: records.id,
    caseFile: rel(casePath),
    traceCount: episode.report.trace.length,
    uniqueCommittedSetCount: states.length,
    states,
  };
}

export function buildAudit() {
  const cohort = selectE3cEpisodes();
  const episodes = cohort.selected.map(item => auditEpisode(item, cohort.scores.get(item.value.id)))
    .sort((a, b) => ascii(a.episodeId, b.episodeId));
  const unique = new Map();
  for (const episode of episodes) for (const state of episode.states) {
    const key = rootsKey(state.roots);
    const row = unique.get(key) ?? {roots: state.roots, observations: 0, episodes: new Set()};
    row.observations += 1;
    row.episodes.add(episode.episodeId);
    unique.set(key, row);
  }
  const uniqueCommittedSets = [...unique.values()].map(row => ({
    roots: row.roots,
    firstStateObservations: row.observations,
    episodeCount: row.episodes.size,
  })).sort((a, b) => ascii(rootsKey(a.roots), rootsKey(b.roots)));
  const states = episodes.flatMap(episode => episode.states);
  return {
    format: 'living-mystery-e0-committed-concealment-audit-v1',
    title: 'E0 committed concealment post-commit audit',
    scope: {
      cohort: 'The same schema-selected e3c cohort as playtest_analysis.py: object root, truthy id, and report.trace array; score IDs must match; exactly three cases with nine episodes each.',
      episodeCount: episodes.length,
      certification: 'Direct session-aware certifyConcealments(session, caseRecords, {phase: "post_commit"}) on the first observation of every distinct cumulative concealed-root set in each episode.',
      planningAssociation: 'Persisted audit.solvable rows are historical planning associations only. They are reported but never substituted for direct post-commit certification.',
      offline: true,
    },
    aggregates: {
      episodeCount: episodes.length,
      episodeCommittedSetStates: states.length,
      globallyUniqueRootSets: uniqueCommittedSets.length,
      nonEmptyStates: states.filter(state => state.roots.length).length,
      strictCertificatesPassed: states.filter(state => state.certificate.ok).length,
      strictCertificatesFailed: states.filter(state => !state.certificate.ok).length,
      statesWithPriorAcceptedAuditForEveryRoot: states.filter(state => state.priorPlanningAssociation.hasSameOrPriorAcceptedAuditForEveryRoot).length,
    },
    uniqueCommittedSets,
    episodes,
  };
}

function markdown(result) {
  const lines = [
    '# E0 committed concealment post-commit audit', '',
    `Normalized SHA-256: \`${result.normalizedSha256}\``, '',
    `Status: **${result.provenance.repository.archivalStatus}**.`, '',
    result.provenance.repository.archivalReason ?? '',
    '## Result', '',
    `${result.aggregates.strictCertificatesPassed}/${result.aggregates.episodeCommittedSetStates} directly reconstructed, session-aware committed-set states passed strict certification; ${result.aggregates.strictCertificatesFailed} failed. The cohort contains ${result.aggregates.episodeCount} episodes and ${result.aggregates.globallyUniqueRootSets} globally unique root sets.`, '',
    'Planning association and post-commit certification are separate: `audit.solvable` only associates a persisted planning decision with a root; every certificate below was recomputed directly from the case, acquired evidence at first observation, and the observed cumulative concealed set.', '',
    '## States', '',
    '| Episode | Case | First trace | Concealed roots | Removed closure | Strict certificate | Prior planning audits |',
    '|---|---|---:|---|---|---|---:|',
  ];
  for (const episode of result.episodes) for (const state of episode.states) {
    const roots = state.roots.map(value => `\`${value}\``).join(', ') || 'none';
    const removed = state.dependencyClosureRemoved.map(value => `\`${value}\``).join(', ') || 'none';
    lines.push(`| \`${episode.episodeId}\` | \`${episode.caseId}\` | ${state.firstTraceIndex} | ${roots} | ${removed} | ${state.certificate.ok ? 'pass' : `fail: ${(state.certificate.errors[0] ?? 'unknown').replace(/\|/g, '\\|')}`} | ${state.priorPlanningAssociation.matchingAuditCount} |`);
  }
  lines.push('', '## Provenance', '',
    `- Commit: \`${result.provenance.repository.commit}\``,
    `- Branch: \`${result.provenance.repository.branch ?? '(detached)'}\``,
    `- Node: \`${result.provenance.environment.node}\``,
    `- Worktree dirty: \`${result.provenance.repository.worktreeDirty}\``,
    `- Tracked dirty paths: ${result.provenance.repository.trackedDirtyPaths.length}`,
    `- Untracked evidence paths: ${result.provenance.repository.untrackedEvidencePaths.length}`,
    `- Hashed manifests: ${result.provenance.manifests.length}; hashed inputs: ${result.provenance.inputs.length}`, '',
    'The JSON contains exact paths and SHA-256 values for all manifests and inputs, plus every matching prior planning audit.', '');
  return `${lines.filter((line, index) => line || index !== 6).join('\n')}\n`;
}

function main() {
  mkdirSync(RESULTS_DIR, {recursive: true});
  const result = buildAudit();
  const cohort = selectE3cEpisodes();
  const casePaths = sortedUnique([...cohort.scores.values()].map(row => resolve(ROOT, row.case)));
  result.provenance = collectProvenance(ROOT, {
    commands: ['node tools/paper-evidence/committed_concealment_audit.mjs'],
    manifests: [resolve(RUN_DIR, 'batch.json'), cohort.scorePath, resolve(ROOT, 'dist/cases/generated/live/index.json')],
    inputs: [
      fileURLToPath(import.meta.url),
      resolve(ROOT, 'tools/paper-evidence/paper_evidence_helpers.mjs'),
      resolve(ROOT, 'tools/paper-evidence/playtest_analysis.py'),
      resolve(ROOT, 'dist/morning.mjs'),
      resolve(ROOT, 'dist/mk/kernel.mjs'),
      cohort.scorePath,
      ...cohort.selected.map(item => item.path),
      ...casePaths,
    ],
    evidenceOutputs: [JSON_OUTPUT, MARKDOWN_OUTPUT],
  });
  addNormalizedSha256(result);
  writeFileSync(JSON_OUTPUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  writeFileSync(MARKDOWN_OUTPUT, markdown(result), 'utf8');
  console.log(`${result.aggregates.strictCertificatesFailed ? 'FAIL' : 'PASS'} ${result.aggregates.episodeCount} episodes, ${result.aggregates.episodeCommittedSetStates} committed-set states, normalized ${result.normalizedSha256}, ${result.provenance.repository.archivalStatus}`);
  if (result.aggregates.strictCertificatesFailed) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
