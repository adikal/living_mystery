// Offline check of a dialogue change: replay recorded free-text questions from earlier playtests through a version of the
// character pipeline, without playing whole games. Each episode's actions are re-applied without AI or director (so the
// state is close to, not identical with, the original: people stay where the history left them, and the player walks to
// the person asked), and at each sampled question the real pipeline answers it on a copy of that state.
//
//   node tools/playtest/replay.mjs --root <checkout> --sample 80 --out /tmp/replay-A.json tools/playtest/runs/e1-*/*__*.json
//
// The same --sample and --seed give the same questions for every checkout, so two versions can be compared turn by turn.
// Outcome per question: 'ai' (a reply passed the critics), 'account' (all rejected; a published account was given),
// 'decline' (all rejected; nothing was given).
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';

function args(argv) {
  const o = {root: process.cwd(), sample: 80, seed: 1, parallel: 6, out: null, files: []};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') o.root = resolve(argv[++i]);
    else if (a === '--sample') o.sample = Number(argv[++i]);
    else if (a === '--seed') o.seed = Number(argv[++i]);
    else if (a === '--parallel') o.parallel = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else o.files.push(a);
  }
  return o;
}

// a small seeded generator, so the sample is the same for every checkout
function rng(seed) { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

// Half the sample from questions that fell back in play, half from those answered: both kinds of change show.
function pick(episodes, n, seed) {
  const fell = [], answered = [];
  for (const [e, ep] of episodes.entries()) ep.report.trace.forEach((t, i) => {
    if (t.action?.type !== 'say' || !t.character || t.error) return;
    (t.character.by === 'fallback' ? fell : answered).push({e, i});
  });
  const r = rng(seed), take = (xs, k) => { const c = [...xs]; for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c.slice(0, k); };
  const half = Math.min(fell.length, Math.ceil(n / 2));
  return [...take(fell, half), ...take(answered, n - half)].sort((a, b) => a.e - b.e || a.i - b.i);
}

async function main() {
  const o = args(process.argv.slice(2));
  const {PlaytestGame} = await import(join(o.root, 'tools/playtest/game.mjs'));
  const {dispatch, caseTables} = await import(join(o.root, 'dist/engine.mjs'));
  const {NEUTRAL_LINE} = await import(join(o.root, 'dist/kernel.mjs'));
  const {prepareCharacterTurn, proposeCharacterTurn, applyCharacterTurn} = await import(join(o.root, 'dist/character-turn.mjs'));
  const episodes = o.files.map(f => JSON.parse(readFileSync(f, 'utf8')));
  const targets = pick(episodes, o.sample, o.seed);
  const byEpisode = Map.groupBy(targets, t => t.e);

  // rebuild each episode's states at its sampled questions (no model calls), then answer them in parallel
  const jobs = [];
  for (const [e, ts] of byEpisode) {
    const ep = episodes[e], g = await PlaytestGame.create(join(o.root, ep.case), {seed: ep.seed, ai: false, director: false});
    const at = new Set(ts.map(t => t.i));
    for (const [i, t] of ep.report.trace.entries()) {
      if (g.done) break;
      if (at.has(i)) jobs.push({episode: ep.id, step: i, person: t.character.person, text: t.character.text, was: t.character.by,
        state: structuredClone(g.s), store: g.store});
      if (t.action && !['say', 'hint', 'note', 'quit', 'accuse'].includes(t.action.type)) await g.act(t.action);
    }
  }
  const results = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const j = jobs[next++], s = j.state, row = {episode: j.episode, step: j.step, person: j.person, text: j.text, was: j.was};
      try {
        const where = s.world.npcs[j.person].travel?.to ?? s.world.npcs[j.person].location;
        if (s.world.player.location !== where) dispatch(s, {type: 'move', to: where});
        const ticket = prepareCharacterTurn(s, {person: j.person, text: j.text, action: null});
        const r = await proposeCharacterTurn(ticket, {store: j.store});
        const before = s.events.length;
        applyCharacterTurn(s, ticket, r);
        const reply = s.events.slice(before).find(e => e.kind === 'speech' && e.actor === j.person && e.data?.listener === 'player');
        const B = caseTables(s).behavior, said = reply?.data?.assertion;
        const declined = B.isDecline ? B.isDecline(j.person, said) : said === NEUTRAL_LINE;
        Object.assign(row, {outcome: r.proposal ? 'ai' : declined ? 'decline' : 'account', reason: r.audit.reason, reply: reply?.data?.assertion ?? null,
          rejected: r.audit.attempts.filter(x => x.validation !== 'pass' || /"reject"/.test(String(x.critic?.response ?? ''))).length,
          reasons: r.audit.attempts.map(x => x.validation !== 'pass' ? `validation: ${String(x.validation).slice(0, 120)}`
            : String(x.critic?.response ?? '').match(/"violations"\s*:\s*\[\s*"([^"]{0,200})/)?.[1]).filter(Boolean)});
      } catch (err) { row.outcome = 'error'; row.reason = String(err.message).slice(0, 200); }
      results.push(row);
    }
  }
  await Promise.all(Array.from({length: o.parallel}, worker));
  results.sort((a, b) => a.episode.localeCompare(b.episode) || a.step - b.step);
  const count = k => results.filter(r => r.outcome === k).length;
  const summary = {root: o.root, questions: results.length, ai: count('ai'), account: count('account'), decline: count('decline'), error: count('error'),
    rejected_per_question: +(results.reduce((n, r) => n + (r.rejected ?? 0), 0) / Math.max(1, results.length)).toFixed(2)};
  console.log(JSON.stringify(summary));
  if (o.out) writeFileSync(o.out, JSON.stringify({summary, results}, null, 1));
  process.exit(0);
}

main();
