// A hint you can act on: following a testimony hint exactly (the quoted questions, of the named person) gives the
// account it points to. A scripted player follows hints through every published case (playtests: 13 of 36 such hints
// quoted the evening question, which gave a different account).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PlaytestGame} from '../tools/playtest/game.mjs';
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const dir = join(root, 'dist/cases/generated');
test('following a testimony hint exactly gives its account, in every case', async () => {
const files = [...readdirSync(dir).filter(f => f.startsWith('mk-')).map(f => join(dir, f)), ...(existsSync(join(dir, 'live')) ? readdirSync(join(dir, 'live')).filter(f => f.startsWith('mk-')).map(f => join(dir, 'live', f)) : [])];
let followed = 0, failed = 0, other = 0; const bad = [];
for (const f of files) {
  const g = await PlaytestGame.create(f, {ai: false, director: false, budget: {actions: 400, minutes: 100000}});
  for (let i = 0; i < 120 && !g.done; i++) {
    let r = await g.act({type: 'hint'}); while (g.hint.level < 2) r = await g.act({type: 'hint'});
    const hint = r.observation.just_happened.find(n => n.speaker === 'Hint')?.text ?? '';
    const sign = g.records.signs.find(x => x.id === g.hint.key);
    const qs = [...hint.matchAll(/“([^”]+)”/g)].map(m => m[1]), q = qs[0];
    if (sign?.kind === 'testimony' && q) {
      const pid = sign.speaker, where = g.s.world.npcs[pid].travel?.to ?? g.s.world.npcs[pid].location;
      if (g.s.world.player.location !== where) await g.act({type: 'move', to: where});
      let missing = null;
      for (const one of qs) {
        const opt = g.observe().people_here.find(p => p.id === pid)?.questions.find(x => x.text === one);
        if (!opt) { missing = one; break; }
        await g.act({type: 'ask', person: pid, question: opt.id});
      }
      if (missing) { other++; bad.push([f.split('/').pop().slice(8, 24), sign.id, 'question not offered', missing]); }
      else {
        followed++;
        if (!g.s.world.player.evidence.some(e => e.clue === sign.id)) { failed++; bad.push([f.split('/').pop().slice(8, 24), sign.id, 'asked, not given', q]); }
        continue;
      }
    }
    // otherwise follow the plainest level in the usual way: examine / go
    while (g.hint.level < 3) r = await g.act({type: 'hint'});
    const h3 = r.observation.just_happened.find(n => n.speaker === 'Hint')?.text ?? '';
    const o = g.observe(), place = o.map.find(m => h3.includes(m.name));
    if (g.hint.key === 'accuse' || /^Take your notebook/.test(h3)) {
      const post = g.s.world.npcs[g.T.CASE.constable].location; if (o.place !== post) await g.act({type: 'move', to: post});
      await g.act({type: 'accuse', suspect: g.T.behavior.caseStatus(g.s).lead, method: g.records.answer.method, motive: g.records.answer.motive}); continue;
    }
    if (place && o.place !== place.place) { await g.act({type: 'move', to: place.place}); continue; }
    const thing = o.things_here.find(t => h3.includes(t.label)); if (thing) { await g.act({type: 'examine', thing: thing.id}); continue; }
    const pres = sign && sign.kind === 'testimony' ? sign.speaker : null;
    const item = pres && o.inventory.find(e => h3.includes(e.title));
    if (item && o.people_here.some(p => p.id === pres)) { await g.act({type: 'show', person: pres, item: item.id}); continue; }
    await g.act({type: 'wait', minutes: 5});
  }
}
assert.ok(followed > 0, 'some testimony hints were followed');
assert.deepEqual(bad, [], `${failed + other} of ${followed + other} followed hints did not give their account`);
});
