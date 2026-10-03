// End-to-end dialogue check: every character in a case is asked a standard set of questions through the real character
// pipeline (proxy, AI, code guards, fact-checker), from a session that holds every clue. Reports, per reply: AI or
// scripted, why, how many attempts were rejected, and the text; then a summary of what went wrong.
//
//   node tools/e2e_dialogue.mjs dist/cases/generated/live/<case>.json [--out /tmp/e2e.json] [--parallel 4]
// Needs the language-model proxy on :8787 (server/llm_proxy.py).
import {readFileSync, writeFileSync} from 'node:fs';
import {registerKernelCase, dispatch, caseTables, copy} from '../dist/engine.mjs';
import {prepareCharacterTurn, proposeCharacterTurn, applyCharacterTurn} from '../dist/character-turn.mjs';
import {NEUTRAL_LINE} from '../dist/kernel.mjs';
import {autoplay} from '../tests/kernel-autoplay.mjs';

const args = process.argv.slice(2), file = args.find(a => !a.startsWith('--'));
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const out = opt('--out'), par = Number(opt('--parallel') ?? 4);
const mem = new Map([['living-mystery.llm.endpoint', 'http://127.0.0.1:8787/'], ['living-mystery.llm.enabled', '1']]);
const store = {getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v)};
const F = globalThis.fetch; globalThis.fetch = (u, i = {}) => F(u, {...i, headers: {...i.headers, Origin: 'http://127.0.0.1:8000'}});

const kc = JSON.parse(readFileSync(file, 'utf8'));
registerKernelCase(kc);
const base = autoplay(kc, {}).session;                     // every clue found, nobody accused
const T = caseTables(base), people = Object.keys(base.world.npcs);
const clues = base.world.player.evidence.map(e => e.clue);
const signs = Object.fromEntries(kc.signs.map(x => [x.id, x]));
const culprit = kc.question.candidates.find(h => h.id === kc.question.truth).facts.actor;

const FREE = ['Where were you last night?', 'Did anyone see you last night?', 'Who found the body?', 'Are you sure about that?'];
function plan(pid) {
  const menu = (T.CASE.topicsFor?.[pid] ?? T.CASE.topics ?? []).map(([topic, label]) => ({text: label, action: {type: 'ask', person: pid, topic}}));
  const more = menu.some(m => m.action.topic === 'night') ? [{text: 'Is there anything else you remember about last night?', action: {type: 'ask', person: pid, topic: 'more'}}] : [];
  // clues about this person first, then others (at most three shown)
  const mine = clues.filter(c => [signs[c]?.about, signs[c]?.to, signs[c]?.claim?.person].includes(pid));
  const shown = [...new Set([...mine, ...clues.filter(c => signs[c]?.kind !== 'testimony')])].slice(0, 3)
    .map(c => ({text: `[shows ${signs[c]?.title}]`, action: {type: 'present', person: pid, clue: c, tone: 'private'}}));
  const repeat = menu.length ? [menu[menu.length - 1]] : [];
  return [...menu, ...more, ...FREE.map(text => ({text, action: null})), ...shown, ...repeat];
}

async function talk(pid) {
  const s = copy(base), rows = [];
  if (s.world.player.location !== s.world.npcs[pid].location) dispatch(s, {type: 'move', to: s.world.npcs[pid].location});
  let last = null;
  for (const q of plan(pid)) {
    try {
      if (s.world.player.location !== s.world.npcs[pid].location) dispatch(s, {type: 'move', to: s.world.npcs[pid].location});
      const t = prepareCharacterTurn(s, {person: pid, text: q.text.startsWith('[') ? 'What can you tell me about this?' : q.text, action: q.action});
      const r = await proposeCharacterTurn(t, {store});
      applyCharacterTurn(s, t, r);
      const said = s.events.findLast(e => e.kind === 'speech' && e.actor === pid)?.data.assertion ?? '';
      const rejected = (r.audit.attempts || []).filter(a => a.validation !== 'pass' || /"verdict"\s*:\s*"reject"/.test(String(a.critic?.response ?? '')));
      rows.push({pid, q: q.text, ai: Boolean(r.proposal), reason: r.audit.reason, accounts: t.context.accounts.length, rejected: rejected.length,
        why: rejected.map(a => a.validation !== 'pass' ? a.validation : String(a.critic?.response ?? '').replace(/\s+/g, ' ').slice(0, 220)),
        said, neutral: said === NEUTRAL_LINE, repeat: Boolean(last) && said === last});
      last = said;
    } catch (e) { rows.push({pid, q: q.text, error: String(e.message).slice(0, 200)}); }
  }
  return rows;
}

const queue = [...people], results = [];
await Promise.all(Array.from({length: par}, async () => { while (queue.length) results.push(...await talk(queue.shift())); }));
const n = results.length, count = f => results.filter(f).length;
const summary = {case: kc.id, title: kc.title, culprit, replies: n, ai: count(r => r.ai), scripted: count(r => !r.ai && !r.error),
  scriptedWithAccounts: count(r => !r.ai && r.accounts > 0), neutral: count(r => r.neutral), errors: count(r => r.error),
  anyRejected: count(r => r.rejected > 0), allRejected: count(r => r.reason === 'rejected'), repeats: count(r => r.repeat)};
console.log(JSON.stringify(summary));
for (const r of results.filter(r => r.error || r.reason === 'rejected' || r.neutral || r.repeat || r.rejected >= 2))
  console.log(`  ${r.pid}${r.pid === culprit ? '*' : ''} | ${r.q} | ${r.error ? 'ERROR ' + r.error : (r.ai ? 'AI' : 'SCRIPTED ' + r.reason) + `, ${r.rejected} rejected`}${r.neutral ? ', neutral' : ''}${r.repeat ? ', repeat' : ''}\n      ${r.said?.slice(0, 200) ?? ''}${(r.why || []).slice(0, 2).map(w => '\n      x ' + w).join('')}`);
if (out) writeFileSync(out, JSON.stringify({summary, results}, null, 1));
