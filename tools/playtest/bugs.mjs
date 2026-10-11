// Bug detectors over recorded playtests: invariants of the game checked against the case records, with no model
// calls and no reading of wording. Each finding is a candidate bug with its evidence; findings with the same signature
// are one bug seen several times. Ranked by severity first, then by how many games show it.
//
//   node tools/playtest/bugs.mjs --out bugs.json [--before <cases dir>] [--current b1,b2] tools/playtest/runs/e*/
//
// Games are checked against the case they were played on: --before is a copy of the case files from before later case
// changes, used for every batch not listed in --current. Copies of older cases must first be migrated to the current
// claims version (.venv/bin/python tools/refine-c/migrate.py --write <copies>).
import {readFileSync, readdirSync, existsSync, writeFileSync} from 'node:fs';
import {join, basename, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyse, survivors, claimOf} from '../../dist/mk/kernel.mjs';
import {consistent, instanceClaims, CLAIMS_VERSION} from '../../dist/mk/claims.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FOLLOW = 5;       // actions after a hint within which following it should give its clue
const REPEATS = 3;      // the same words from the same person this many times in one game
const OCCASIONS = 3;    // the same hint shown on this many separate occasions without its clue
const SEVERITY = {unrecorded_contradiction: 3, case_contradiction: 3, hint_followed_no_yield: 3, exception: 3,
  name_refused: 2, repeated_line: 2, hint_loop: 2};

function args(argv) {
  const o = {out: null, before: null, current: new Set(), dirs: []};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') o.out = argv[++i];
    else if (argv[i] === '--before') o.before = argv[++i];
    else if (argv[i] === '--current') o.current = new Set(argv[++i].split(','));
    else o.dirs.push(argv[i]);
  }
  return o;
}

function caseFor(rel, batch, o, cache) {
  const key = `${batch}|${rel}`;
  if (!cache.has(key)) {
    const old = o.before && !o.current.has(batch) ? join(o.before, rel.replace(/^dist\/cases\/generated\//, '')) : null;
    const file = old && existsSync(old) ? old : join(ROOT, rel), kc = JSON.parse(readFileSync(file, 'utf8'));
    if (kc.claims_version !== CLAIMS_VERSION) throw Error(`${file}: claims version ${kc.claims_version ?? 1}; migrate it (tools/refine-c/migrate.py --write)`);
    cache.set(key, kc);
  }
  return cache.get(key);
}

// pairs of held claims that cannot both be true, neither recorded as defeating the other (the kernels' consistency law;
// conflicts needing three or more claims are the kernels' to report)
function contradictions(kc, ids) {
  const S = Object.fromEntries(kc.signs.map(x => [x.id, x])), out = [], seen = new Set();
  const held = [...ids].filter(id => S[id] && claimOf(S[id])).sort().map(id => [id, claimOf(S[id])]), claim = Object.fromEntries(held);
  for (const [key, group] of instanceClaims(kc, held)) for (const [i, a] of group.entries()) for (const b of group.slice(i + 1)) {
    if (seen.has(`${a}|${b}`) || (S[a].defeats ?? []).includes(b) || (S[b].defeats ?? []).includes(a)) continue;
    seen.add(`${a}|${b}`);
    if (!consistent(kc, [[a, claim[a]], [b, claim[b]]])) out.push([a, b, key]);
  }
  return out;
}

// survivors over the evidence held, read as the constable reads it (every held sign understood)
function standing(kc, held) {
  const sub = {...kc, signs: kc.signs.filter(x => held.has(x.id) || x.kind === 'public').map(x => ({...x, requires: [], unlock: 'held', reading: x.reading || 'held'}))};
  return survivors(sub, analyse(sub));
}

function detect(ep, kc, batch) {
  const tr = ep.report.trace, steps = ep.steps, S = Object.fromEntries(kc.signs.map(x => [x.id, x]));
  const names = Object.fromEntries(kc.people.map(p => [p.id, p.name]));
  const found = [];
  const add = (kind, step, signature, evidence) => found.push({kind, severity: SEVERITY[kind], batch, episode: ep.id,
    case: kc.id, title: kc.title, step, signature: `${kind}|${kc.id}|${signature}`, evidence});
  const held = new Set(), lines = {}, hintSeen = {};
  for (const [i, t] of tr.entries()) {
    const before = new Set(held);
    for (const e of t.new_evidence ?? []) held.add(e);
    if (t.exception) add('exception', i, String(t.exception).split('\n')[0].slice(0, 120), String(t.exception).slice(0, 300));
    // an accusation refused while the player holds a contradiction the case does not count
    if (t.accusation && !t.accusation.accepted)
      for (const [a, b, p] of contradictions(kc, before))
        add('unrecorded_contradiction', i, `${a}|${b}`, {accused: t.accusation.suspect, about: p, signs: [a, b],
          texts: [S[a]?.text, S[b]?.text].map(x => String(x ?? '').slice(0, 200)), survivors: standing(kc, before)});
    const c = t.character;
    if (c) {
      const said = (steps[i]?.news ?? []).filter(n => n.speaker === names[c.person]).map(n => n.text);
      const earlier = (lines[c.person] ??= []).slice(-3).map(x => x.text.slice(0, 200));
      lines[c.person].push(...said.map(text => ({step: i, text})));
      // every attempt refused by the name check: the person could not name someone in their own words
      const rs = c.reasons ?? [];
      if (c.by === 'fallback' && rs.length && rs.every(r => /wrong_or_new_name/.test(r)))
        add('name_refused', i, c.person, {person: c.person, question: c.text, reasons: rs.map(r => r.slice(0, 200)), earlier});
    }
    // a hint to talk to someone, followed (the player asks that person a listed question or shows them something soon
    // after), that does not give its clue
    if (t.hint && S[t.hint.id]?.kind === 'testimony') {
      const who = S[t.hint.id].speaker, next = tr.slice(i + 1, i + 1 + FOLLOW);
      (hintSeen[t.hint.id] ??= new Set()).add(i);
      const followed = next.filter(x => x.character?.person === who && ['ask', 'show'].includes(x.action?.type));
      if (t.hint.level >= 2 && followed.length && !next.some(x => (x.new_evidence ?? []).includes(t.hint.id)))
        add('hint_followed_no_yield', i, t.hint.id, {hint: (steps[i]?.news ?? []).find(n => n.speaker === 'Hint')?.text,
          followed: followed.map(x => x.character.text), gave: followed.flatMap(x => x.new_evidence ?? [])});
    }
  }
  // the same words from the same person several times in one game
  for (const [p, ls] of Object.entries(lines)) {
    const n = {};
    for (const l of ls) (n[l.text] ??= []).push(l.step);
    for (const [text, at] of Object.entries(n)) if (at.length >= REPEATS)
      add('repeated_line', at[0], `${p}|${text.slice(0, 60)}`, {person: p, times: at.length, text: text.slice(0, 200)});
  }
  // the same hint shown on several separate occasions without the player getting its clue
  for (const [id, at] of Object.entries(hintSeen)) {
    const occasions = [...at].sort((a, b) => a - b).filter((s, k, a) => k === 0 || s - a[k - 1] > 2);
    if (occasions.length >= OCCASIONS && !held.has(id)) add('hint_loop', occasions[0], id, {hint: id, occasions: occasions.length});
  }
  return found;
}

function main() {
  const o = args(process.argv.slice(2)), cache = new Map(), findings = [], seen = new Set(), cases = new Map();
  let games = 0;
  for (const dir of o.dirs) {
    const batch = basename(dir.replace(/\/$/, ''));
    for (const f of readdirSync(dir).filter(f => f.includes('__') && f.endsWith('.json')).sort()) {
      const ep = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const key = `${ep.id}|${JSON.stringify(ep.steps.slice(0, 5).map(s => s.action))}`;   // a game copied into two batches counts once
      if (seen.has(key)) continue;
      seen.add(key); games++;
      const kc = caseFor(ep.case, batch, o, cache);
      cases.set(`${batch}|${ep.case}`, kc);
      findings.push(...detect(ep, kc, batch));
    }
  }
  // the static scan: each case as played, every pair of reachable accounts that contradict without a recorded defeat
  const scanned = new Set();
  for (const [key, kc] of cases) {
    const sig = JSON.stringify(kc.signs.map(x => [x.id, x.defeats ?? []]));
    if (scanned.has(sig)) continue;
    scanned.add(sig);
    for (const [a, b, p] of contradictions(kc, analyse(kc).understood))
      findings.push({kind: 'case_contradiction', severity: SEVERITY.case_contradiction, batch: key.split('|')[0], episode: null,
        case: kc.id, title: kc.title, step: null, signature: `case_contradiction|${kc.id}|${a}|${b}`, evidence: {about: p, signs: [a, b]}});
  }
  const bugs = {};
  for (const x of findings) {
    const b = bugs[x.signature] ??= {signature: x.signature, kind: x.kind, severity: x.severity, case: x.case, title: x.title,
      episodes: new Set(), occurrences: 0, examples: []};
    b.occurrences++;
    if (x.episode) b.episodes.add(x.episode);
    if (b.examples.length < 3) b.examples.push(x);
  }
  const ranked = Object.values(bugs).map(b => ({...b, episodes: b.episodes.size}))
    .sort((a, b) => b.severity - a.severity || b.episodes - a.episodes || b.occurrences - a.occurrences);
  const summary = {games, findings: findings.length, bugs: ranked.length,
    byKind: Object.fromEntries(Object.keys(SEVERITY).map(k => [k, ranked.filter(b => b.kind === k).length]))};
  console.log(JSON.stringify(summary));
  if (o.out) writeFileSync(o.out, JSON.stringify({summary, bugs: ranked}, null, 1));
}

main();
