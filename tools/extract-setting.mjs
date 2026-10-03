#!/usr/bin/env node
// Extract the Bellweather world for the case generator: places, real walking times, and the cast's PUBLIC identity
// and voice (dist/cases/village.mjs). Each generated case invents its own victim, culprit, secrets, relationships,
// motives, objects and documents; the premise deck picks who is who. The Last Bell's authored data is not used.
// Usage: node tools/extract-setting.mjs > tools/refine-c/settings/bellweather.json
import {OBJECT_LIBRARY} from '../dist/art.mjs';
import {BW_LOCATIONS, BW_PEOPLE, BW_NOT_VICTIM, BW_NOT_CULPRIT, BW_ROLES, BW_ROLE_WORDS, BW_DAY, BW_DEFAULT_VICTIM} from '../dist/cases/village.mjs';

const links = [];
for (const [a, p] of Object.entries(BW_LOCATIONS))
  for (const [b, minutes] of Object.entries(p.links || {}))
    if (!links.some(l => (l.a === b && l.b === a) || (l.a === a && l.b === b))) links.push({a, b, minutes});

const people = Object.entries(BW_PEOPLE).map(([id, p]) => ({
  id, name: p.name, role: p.role, pronoun: p.pronoun, address: p.address, voice: p.voice, public: p.public, home: p.home,
  role_words: BW_ROLE_WORDS[id] ?? [],
}));
const setting = {
  id: 'bellweather',
  name: 'Bellweather',
  era: 'An English village, 1932',
  summary: 'A small English village: a square, a manor with its greenhouse and boathouse on the river, an inn, the church ' +
    'vestry, a doctor\u2019s surgery, a post office, a railway halt and a disused mill. Someone is dead; the investigation begins the next morning.',
  places: Object.entries(BW_LOCATIONS).map(([id, p]) => ({id, name: p.name})),
  links,
  people,
  victim: BW_DEFAULT_VICTIM,
  investigator: 'Constable Bell assists the detective',
  roles: BW_ROLES,
  day: BW_DAY,
  not_victim: [...BW_NOT_VICTIM],
  not_culprit: [...BW_NOT_CULPRIT],
  // objects that have pictures: the generator prefers them when they fit, and may invent others
  objects: Object.entries(OBJECT_LIBRARY).map(([id, label]) => ({id, label})),
};
process.stdout.write(JSON.stringify(setting, null, 1) + '\n');
