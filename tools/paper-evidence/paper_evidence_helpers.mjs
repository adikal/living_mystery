import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {relative, resolve, sep} from 'node:path';

export const ascii = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const sortedUnique = values => [...new Set(values)].sort(ascii);
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(ascii).map(key => [key, stableValue(value[key])]));
  }
  return value;
}

export const canonicalJson = value => JSON.stringify(stableValue(value));

export function addNormalizedSha256(result) {
  const normalized = structuredClone(result);
  delete normalized.normalizedSha256;
  result.normalizedSha256 = sha256(canonicalJson(normalized));
  return result;
}

const posixRelative = (root, path) => relative(root, path).split(sep).join('/');
const gitOutput = (root, args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'});
const git = (root, args) => gitOutput(root, args).trim();

export function collectProvenance(root, {commands, manifests = [], inputs = [], evidenceOutputs = []}) {
  for (const path of evidenceOutputs) if (!existsSync(path)) writeFileSync(path, '', 'utf8');
  const lines = gitOutput(root, ['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter(Boolean);
  const entries = lines.map(line => ({status: line.slice(0, 2), path: line.slice(3)}));
  const trackedDirtyPaths = entries.filter(item => item.status !== '??').map(item => item.path).sort(ascii);
  const untrackedEvidencePaths = entries.filter(item => item.status === '??' && item.path.startsWith('tools/paper-evidence/'))
    .map(item => item.path).sort(ascii);
  const hashRows = paths => sortedUnique(paths.map(path => resolve(path))).map(path => ({
    path: posixRelative(root, path),
    sha256: sha256(readFileSync(path)),
  }));
  const dirty = entries.length > 0;
  return {
    repository: {
      commit: git(root, ['rev-parse', 'HEAD']),
      branch: git(root, ['branch', '--show-current']) || null,
      trackedDirtyPaths,
      untrackedEvidencePaths,
      worktreeDirty: dirty,
      archivalStatus: dirty ? 'preliminary/non-archival' : 'archival',
      archivalReason: dirty ? 'The result was generated from a dirty worktree and must not be treated as an archival repository snapshot.' : null,
    },
    environment: {node: process.version, offline: true},
    commands,
    manifests: hashRows(manifests),
    inputs: hashRows(inputs),
  };
}

// The paper's case corpus as of its evidence date (paper_corpus.json): id -> {classification, sha256}. The analyses of
// the paper's cases keep to exactly these, and report where each was listed then, so a later menu change or a newly
// generated case never changes their population.
export function paperCorpus() {
  const file = new URL('./paper_corpus.json', import.meta.url);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  return new Map(data.cases.map((c, order) => [c.id, {classification: c.classification, sha256: c.sha256, order}]));
}

export function missingFromCorpus(corpus, foundIds) {
  const found = new Set(foundIds);
  const missing = [...corpus.keys()].filter(id => !found.has(id)).sort(ascii);
  if (missing.length) throw new Error(`paper corpus cases not found in any manifest: ${missing.join(', ')}`);
}

// Sort found cases into the corpus's own order (the order the paper's analyses reported them in).
export const inCorpusOrder = (corpus, idOf) => (a, b) => corpus.get(idOf(a)).order - corpus.get(idOf(b)).order;
