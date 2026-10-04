// Hints you can act on: a hint to talk to someone names them at the first level, and the next level quotes a question
// that is among the options offered when the player is with them (playtests: "someone has more to tell" rarely helped).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerKernelCase, createSession, caseTables} from '../dist/engine.mjs';

const read = rel => JSON.parse(readFileSync(new URL(`../dist/cases/generated/${rel}`, import.meta.url), 'utf8'));
const listed = dir => { try { return read(`${dir}index.json`).map(e => e.file?.startsWith(dir) ? e.file : `${dir}${e.file ?? `${e.id}.json`}`); } catch { return []; } };
const files = [...listed(''), ...listed('live/')];
let checked = 0;
test.after(() => assert.ok(checked > 0, 'at least one case starts with a testimony hint'));
for (const rel of files) test(`${rel}: testimony hints name whom, then the question`, () => {
  const kc = read(rel);
  const s = createSession(1, registerKernelCase(kc)), T = caseTables(s), B = T.behavior;
  const h = B.hints(s), x = kc.signs.find(g => g.id === h.id);
  if (x?.kind !== 'testimony') return;
  checked++;
  const who = T.PEOPLE[x.speaker].name;
  assert.ok(h.levels[0].includes(who), `level 1 names ${who}: ${h.levels[0]}`);
  const quoted = h.levels[1].match(/“([^”]+)”/)?.[1];
  const offered = [...(T.CASE.topicsFor?.[x.speaker] ?? []), ...B.followupOptions(s, x.speaker)].map(([, label]) => label);
  assert.ok(offered.includes(quoted), `level 2 quotes an offered question: ${h.levels[1]}`);
});
