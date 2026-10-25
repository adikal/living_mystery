// Scripted players for a published case, without any model: shared by the tests and by the publication gate
// (gate.mjs), so a case that a scripted player cannot finish is never written.
import {PlaytestGame} from './game.mjs';

// A player that follows the most explicit hint, choosing by what it can see (labels, question texts, names).
export async function hintFollower(g, maxSteps = 200) {
  for (let i = 0; i < maxSteps && !g.done; i++) {
    let r = await g.act({type: 'hint'});
    while (g.hint.level < 3) r = await g.act({type: 'hint'});
    const hint = r.observation.just_happened.find(n => n.speaker === 'Hint').text, o = r.observation;
    g.lastHint = hint;
    const quoted = (hint.match(/“([^”]+)”/) ?? [])[1];
    const place = o.map.find(m => hint.includes(m.name) || hint.toLowerCase().includes(m.name.toLowerCase().replace(/^the /, '')));
    // the person the hint addresses is the first one it names (a quoted question may name someone else)
    const person = Object.values(g.T.PEOPLE).filter(p => hint.includes(p.name)).sort((a, b) => hint.indexOf(a.name) - hint.indexOf(b.name))[0];
    const pid = person && Object.keys(g.T.PEOPLE).find(k => g.T.PEOPLE[k] === person);
    if (/^Take your notebook/.test(hint) || g.hint.key === 'accuse') {
      const post = g.s.world.npcs[g.T.CASE.constable].location;
      if (o.place !== post) await g.act({type: 'move', to: post});
      const kc = g.records;
      await g.act({type: 'accuse', suspect: g.T.behavior.caseStatus(g.s).lead, method: kc.answer.method, motive: kc.answer.motive});
      continue;
    }
    if (/^Examine/.test(hint)) {
      if (place && o.place !== place.place) { await g.act({type: 'move', to: place.place}); continue; }
      const thing = g.observe().things_here.find(t => t.label === quoted || hint.includes(t.label));
      if (thing) { await g.act({type: 'examine', thing: thing.id}); continue; }
    }
    if (pid && /^(Ask|Show)/.test(hint)) {
      const where = g.s.world.npcs[pid].travel?.to ?? g.s.world.npcs[pid].location;
      if (o.place !== where) { await g.act({type: 'move', to: where}); continue; }
      const here = g.observe().people_here.find(p => p.id === pid);
      const q = here?.questions.find(x => x.text === quoted);
      if (q) { await g.act({type: 'ask', person: pid, question: q.id}); continue; }
      const item = g.observe().inventory.find(e => hint.includes(e.title));
      if (item) { await g.act({type: 'show', person: pid, item: item.id}); continue; }
    }
    if (place && o.place !== place.place) { await g.act({type: 'move', to: place.place}); continue; }
    await g.act({type: 'wait', minutes: 5});
  }
  return g;
}

// Follows every testimony hint exactly (the quoted questions, of the named person) and reports each one that does not
// give the account it points to. Other hints are followed the plain way, so the walk reaches every hint in turn.
export async function hintRoute(file) {
  const g = await PlaytestGame.create(file, {ai: false, director: false, budget: {actions: 400, minutes: 100000}});
  let followed = 0; const bad = [];
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
      if (missing) { bad.push([sign.id, 'question not offered', missing]); }
      else {
        followed++;
        if (!g.s.world.player.evidence.some(e => e.clue === sign.id)) bad.push([sign.id, 'asked, not given', q]);
        continue;
      }
    }
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
  return {followed, bad};
}

// Everything the gate asks of a case: a hint-following player solves it, and every testimony hint gives its account.
export async function scriptedChecks(file) {
  const problems = [];
  const g = await hintFollower(await PlaytestGame.create(file, {ai: false, director: false, budget: {actions: 400, minutes: 24 * 60}}), 400);
  if (g.outcome !== 'solved') {
    problems.push(`a hint-following player did not solve it: ${g.outcome} after ${g.actions} actions, last hint ${g.hint.key} (“${g.lastHint ?? ''}”)`);
  }
  const route = await hintRoute(file);
  for (const [sid, what, q] of route.bad) problems.push(`${sid}: following its hint (“${q}”): ${what}`);
  return {ok: problems.length === 0, problems, solved_in: g.actions, hints_followed: route.followed};
}
