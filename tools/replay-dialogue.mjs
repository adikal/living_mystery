// Replay a playtest's questions through the real character pipeline (proxy on :8787) and print the replies.
// Usage: node tools/replay-dialogue.mjs [case.json]
import {readFileSync} from 'node:fs';
import {registerKernelCase, createSession, dispatch} from '../dist/engine.mjs';
import {prepareCharacterTurn, proposeCharacterTurn, applyCharacterTurn} from '../dist/character-turn.mjs';

const path = process.argv[2] || new URL('../tests/fixtures/mk-supper.json', import.meta.url);
const kc = JSON.parse(readFileSync(path, 'utf8'));
const mem = new Map([['living-mystery.llm.endpoint', process.env.LLM_ENDPOINT || 'http://127.0.0.1:8787/'], ['living-mystery.llm.enabled', '1']]);
const store = {getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v)};
const Origin = globalThis.fetch;
globalThis.fetch = (url, init = {}) => Origin(url, {...init, headers: {...init.headers, Origin: 'http://127.0.0.1:8000'}});

const s = createSession(17, registerKernelCase(kc));
const go = to => { if (s.world.player.location !== to) dispatch(s, {type: 'move', to}); };
const look = (at, ...ids) => { go(at); for (const id of ids) dispatch(s, {type: 'inspect', object: id}); };

const times = [];
process.on('beforeExit', () => { if (times.length) { const v = times.sort((a, b) => a - b); console.log(`\n${v.length} turns: median ${v[v.length >> 1].toFixed(1)} s, max ${v.at(-1).toFixed(1)} s`); times.length = 0; } });
async function say(person, text, action = null) {
  go(s.world.npcs[person].location);
  const t = prepareCharacterTurn(s, {person, text, action});
  if (process.env.DEBUG) console.log('  accounts:', t.context.accounts.map(a => a.id).join(', '));
  const t0 = Date.now(), r = await proposeCharacterTurn(t, {store});
  times.push((Date.now() - t0) / 1000);
  applyCharacterTurn(s, t, r);
  const line = s.events.findLast(e => e.kind === 'speech' && e.actor === person)?.data?.assertion;
  const why = r.audit.attempts.map(a => a.validation !== 'pass' ? a.validation : (/"reject"/.test(a.critic?.response ?? '') ? 'critic reject' : 'ok'));
  console.log(`\n[${person}] ${action ? `(menu ${action.topic ?? action.clue}) ` : ''}${text}\n  ${r.proposal ? 'AI' : 'FALLBACK'} [${why.join(', ')}]: ${line}`);
}

look('manor', 's_body');
await say('rowan', 'What do you do here, Mr Pike?');
await say('bell', 'Who found the body this morning?');
look('inn', 'b_ada_thumb', 'x_bare_nail', 's_slate', 's_parlour_glove');
await say('ada', 'Did anyone from the manor come by the inn last night?', {type: 'ask', person: 'ada', topic: 's_ada_clara'});
await say('ada', 'was she here or not?');
await say('ada', 'the initials are CV and Clara Vale said she was here. Who else could it be');
await say('silas', 'what time did you leave the manor');
look('greenhouse', 't_rowan_pots', 'x_sacking', 's_greenhouse_stool');
dispatch(s, {type: 'ask', person: 'rowan', topic: 'night'}); dispatch(s, {type: 'ask', person: 'rowan', topic: 'more'});
await say('iris', 'Mr Pike says he cut his hand and the doctor was called. Does that match what you know?', {type: 'present', person: 'iris', clue: 't_rowan', tone: 'private'});
await say('iris', 'well did you attend to him or not?');
await say('bell', 'Where were you yourself last night, Constable?', {type: 'ask', person: 'bell', topic: 's_bell_ada'});
look('vestry', 's_vestry_cupboard');
await say('bell', 'do you have the duplicate key?');
await say('silas', 'The constable says he saw you at your lamp at twenty past ten, not before. What do you say?', {type: 'present', person: 'silas', clue: 's_bell_ada', tone: 'private'});
