// A contradiction the player can see is one the case records: two reachable accounts that put one person in two places
// at once must have one defeating the other (a human play: two witnesses put the vicar at the inn, against his alibi,
// and the constable would not count it).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {certify} from '../dist/mk/kernel.mjs';

const kc = JSON.parse(readFileSync(new URL('../dist/cases/generated/mk-live-20261002-222517.json', import.meta.url), 'utf8'));
// true from the history (Miss Pruett was home at the post office from 22:55), against her false account (the inn)
const seen = {id: 's_test_seen', kind: 'testimony', speaker: 'silas', title: 'x', text: '',
  claim: {kind: 'place', person: 'dora', place: 'post', start: 1380, end: 1390}};

test('the kernel refuses an unrecorded contradiction, and accepts it once recorded', () => {
  assert.ok(certify(kc).ok, 'the published case certifies');
  const broken = structuredClone(kc);
  broken.signs.push(structuredClone(seen));
  const out = certify(broken);
  assert.ok(!out.ok && out.errors.some(e => /s_test_seen put dora in two places at once/.test(e) || /put dora in two places at once/.test(e)), JSON.stringify(out.errors));
  const mended = structuredClone(broken);
  const lies = mended.signs.filter(x => x.kind === 'testimony' && x.claim?.person === 'dora' && x.claim?.place === 'inn').map(x => x.id);
  mended.signs.find(x => x.id === 's_test_seen').defeats = lies;
  assert.ok(certify(mended).ok, JSON.stringify(certify(mended).errors));
});
