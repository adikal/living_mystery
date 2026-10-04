// Play a case turn by turn from the command line, the way the game does: each call loads the saved session, runs one
// action (talk goes through the real character pipeline), then the morning director, and prints what the player sees.
//   node tools/play.mjs new <case.json>
//   node tools/play.mjs <action json>        e.g. '{"type":"move","to":"inn"}'  '{"say":"Where were you?","person":"ada"}'
//   node tools/play.mjs look                 where everyone is, what is here, the menu for whoever is here
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {registerKernelCase, createSession, dispatch, caseTables, exportSession, importSession, timeLabel} from '../dist/engine.mjs';
import {prepareCharacterTurn, proposeCharacterTurn, applyCharacterTurn} from '../dist/character-turn.mjs';
import {directMorning} from '../dist/morning-director.mjs';

const SAVE = '/tmp/lm-play.json', ENDPOINT = 'http://127.0.0.1:8787/';
const mem = new Map([['living-mystery.llm.endpoint', ENDPOINT], ['living-mystery.llm.enabled', '1']]);
const store = {getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v)};
const F = globalThis.fetch; globalThis.fetch = (u, i = {}) => F(u, {...i, headers: {...i.headers, Origin: 'http://127.0.0.1:8000'}});
const [cmd, arg] = process.argv.slice(2);

let s;
if (cmd === 'new') {
  const kc = JSON.parse(readFileSync(arg, 'utf8'));
  s = createSession(17, registerKernelCase(kc));
} else {
  const saved = JSON.parse(readFileSync(SAVE, 'utf8'));
  registerKernelCase(saved.records);
  s = importSession(saved.session);
}
const T = caseTables(s), name = p => T.PEOPLE[p]?.name ?? p;
const before = s.events.length;
const out = [];

if (cmd !== 'new' && cmd !== 'look') {
  const a = JSON.parse(cmd);
  if (a.person && s.world.player.location !== s.world.npcs[a.person].location && !s.world.npcs[a.person].travel)
    dispatch(s, {type: 'move', to: s.world.npcs[a.person].location});
  if (a.say !== undefined || ['ask', 'present'].includes(a.type)) {
    const action = a.say !== undefined ? null : a;
    const text = a.say ?? (a.type === 'ask' ? (T.CASE.topicsFor?.[a.person] ?? []).concat(T.behavior.followupOptions(s, a.person)).find(([t]) => t === a.topic)?.[1] ?? a.topic : 'Can you tell me about this?');
    const t = prepareCharacterTurn(s, {person: a.person, text, action});
    const r = await proposeCharacterTurn(t, {store});
    applyCharacterTurn(s, t, r);
    out.push(`(${r.proposal ? 'AI' : 'scripted: ' + r.audit.reason})`);
  } else dispatch(s, a);
  const d = await directMorning(s, {endpoint: ENDPOINT});
  if (d.status !== 'not_needed') out.push(`[director: ${d.status}${d.audit?.why ? ' — ' + d.audit.why : ''}${d.audit?.code?.length ? ' | code dropped: ' + d.audit.code.join('; ') : ''}${Object.entries(d.audit?.lines ?? {}).filter(([, v]) => v !== 'ok').map(([k, v]) => ' | line dropped ' + k + ': ' + v).join('')}${Object.entries(d.audit?.solvable ?? {}).map(([k, v]) => ' | conceal ' + k + ': ' + v).join('')}]`);
  for (const [p, st] of Object.entries(d.plan ?? {})) out.push(`   plan ${name(p)}: ${st.map(x => x.kind + (x.with ? ' ' + name(x.with) : '') + ' @' + x.place + (x.say ? ` “${x.say}”` : '') + (x.clue ? ' ' + x.clue : '')).join(' → ')}`);
}
for (const e of s.events.slice(before)) {
  if (e.playerText && !['clock', 'command'].includes(e.kind)) out.push(`${timeLabel(e.minute)} ${e.playerText.replace(/\n/g, ' ').slice(0, 400)}`);
  else if (e.data?.morning && e.kind !== 'decision') out.push(`   (offstage ${timeLabel(e.minute)}: ${e.title}${e.data.assertion ? ` “${e.data.assertion.slice(0, 160)}”` : ''})`);
}
const here = s.world.player.location;
out.push(`— ${timeLabel(s.world.minute)} at ${T.LOCATIONS[here]?.name ?? here}. Here: ${Object.entries(s.world.npcs).filter(([, a]) => a.location === here).map(([p]) => name(p)).join(', ') || 'nobody'}.`);
out.push(`  Elsewhere: ${Object.entries(s.world.npcs).filter(([, a]) => a.location !== here).map(([p, a]) => `${name(p).split(' ')[0]}@${a.travel ? '→' + a.travel.to : a.location}`).join(' ')}`);
const locked = new Set(s.world.flags.lockedObjects ?? []), gone = new Set(s.world.flags.morning?.concealed ?? []);
out.push(`  Objects here: ${(T.LOCATIONS[here]?.objects ?? []).filter(o => !locked.has(o)).map(o => `${o}${s.world.player.evidence.some(e => e.clue === o) ? '✓' : ''}${gone.has(o) ? '(gone)' : ''}`).join(', ') || '-'}`);
for (const p of Object.keys(s.world.npcs).filter(p => s.world.npcs[p].location === here))
  out.push(`  ${name(p)} menu: ${[...(T.CASE.topicsFor?.[p] ?? []), ...T.behavior.followupOptions(s, p)].map(([t]) => t).join(', ')}`);
out.push(`  Evidence: ${s.world.player.evidence.length} | ${JSON.stringify(T.behavior.caseStatus(s))}`);
console.log(out.join('\n'));
writeFileSync(SAVE, JSON.stringify({records: s.world.caseRecords, session: exportSession(s)}));
