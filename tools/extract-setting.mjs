#!/usr/bin/env node
// Extract the Bellweather world (places, real walking times, cast identities and voices) as a FIXED setting
// for the case generator. Only public identity is carried over: each generated case invents its own secrets,
// relationships, motives, objects and documents, so the Last Bell's authored secrets are deliberately omitted.
// Usage: node tools/extract-setting.mjs > tools/refine-c/settings/bellweather.json
import {LOCATIONS, PEOPLE, CASE} from '../dist/case.mjs';

const links = [];
for (const [a, p] of Object.entries(LOCATIONS))
  for (const [b, minutes] of Object.entries(p.links || {}))
    if (!links.some(l => (l.a === b && l.b === a) || (l.a === a && l.b === b))) links.push({a, b, minutes});

const people = Object.entries(PEOPLE).map(([id, p]) => ({
  id, name: p.name, role: p.role, pronoun: p.pronoun, address: p.address, voice: p.voice, public: p.public, home: p.home,
}));
people.push({id: 'edmund', name: 'Edmund Vale', role: 'The victim', pronoun: 'he', address: 'Mr Vale',
  public: 'Master of Vale Manor, found dead the morning the investigation begins.', home: 'manor'});

const setting = {
  id: 'bellweather',
  name: 'Bellweather',
  era: 'An English village, 1920s',
  summary: 'A small village of a square, a manor, an inn, a greenhouse, a church vestry and a doctor\u2019s surgery. ' +
    'Edmund Vale of Vale Manor is dead; the investigation begins the next morning.',
  places: Object.entries(LOCATIONS).map(([id, p]) => ({id, name: p.name})),
  links,
  people,
  victim: 'edmund',
  investigator: CASE.investigator ?? 'Constable Bell assists the detective',
};
process.stdout.write(JSON.stringify(setting, null, 1) + '\n');
