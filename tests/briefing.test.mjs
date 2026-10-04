// The constable's first briefing is bite-sized for a newcomer: beyond the premise, one person to talk to and at most two
// places, and no list of suspects.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {registerKernelCase, createSession, dispatch, caseTables} from '../dist/engine.mjs';
import {inSentence} from '../dist/places.mjs';

const dir = new URL('../dist/cases/generated/', import.meta.url);
const files = [...readdirSync(dir).filter(f => f.startsWith('mk-')), ...readdirSync(new URL('live/', dir)).filter(f => f.startsWith('mk-')).map(f => `live/${f}`)];
for (const f of files) test(`${f}: a bite-sized briefing`, () => {
  const kc = JSON.parse(readFileSync(new URL(f, dir), 'utf8')), s = createSession(1, registerKernelCase(kc)), T = caseTables(s), c = T.CASE.constable;
  if (s.world.player.location !== s.world.npcs[c].location) dispatch(s, {type: 'move', to: s.world.npcs[c].location});
  dispatch(s, {type: 'ask', person: c, topic: 'case'});
  const said = s.events.findLast(e => e.kind === 'speech' && e.actor === c).data.assertion;
  assert.ok(said.startsWith(T.CASE.synopsis));
  const rest = said.slice(T.CASE.synopsis.length);
  const places = Object.values(T.LOCATIONS).filter(l => rest.includes(inSentence(l)) || rest.includes(l.name));
  // a place may be named after a person ("Dr Marsh's surgery"): count people in what is left
  const bare = places.reduce((t, l) => t.replaceAll(inSentence(l), '').replaceAll(l.name, ''), rest);
  const people = Object.values(T.PEOPLE).filter(p => [p.name, p.address].some(n => n && bare.includes(n)));
  assert.ok(people.length <= 1, `${people.length} people named: ${rest}`);
  assert.ok(places.length <= 2, `${places.length} places named: ${rest}`);
});
