// A hint you can act on: following a testimony hint exactly (the quoted questions, of the named person) gives the
// account it points to. A scripted player follows hints through every published case (playtests: 13 of 36 such hints
// quoted the evening question, which gave a different account).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hintRoute} from '../tools/playtest/scripted.mjs';
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const dir = join(root, 'dist/cases/generated');
test('following a testimony hint exactly gives its account, in every case', async () => {
const files = [...readdirSync(dir).filter(f => f.startsWith('mk-')).map(f => join(dir, f)), ...(existsSync(join(dir, 'live')) ? readdirSync(join(dir, 'live')).filter(f => f.startsWith('mk-')).map(f => join(dir, 'live', f)) : [])];
let followed = 0; const bad = [];
for (const f of files) {
  const r = await hintRoute(f);
  followed += r.followed;
  bad.push(...r.bad.map(([sid, what, q]) => [f.split('/').pop().slice(8, 24), sid, what, q]));
}
assert.ok(followed > 0, 'some testimony hints were followed');
assert.deepEqual(bad, [], `${bad.length} of ${followed + bad.filter(b => b[2] === 'question not offered').length} followed hints did not give their account`);
});
