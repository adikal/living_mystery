// Headless player for kernel cases: follow every lead as it opens, question people where they are, then
// accuse. Used by tests and smoke checks; it plays through the real engine (dispatch), never around it.
import {registerKernelCase, createSession, dispatch, caseTables, followupOptions} from '../dist/engine.mjs';

export function autoplay(records, {accuse = null, maxSteps = 400, method = records.answer?.method, motive = records.answer?.motive, drop = []} = {}) {
  const id = registerKernelCase(records), s = createSession(17, id), rt = caseTables(s);
  const held = () => new Set(s.world.player.evidence.map(e => e.clue));
  const log = [];
  for (let step = 0; step < maxSteps; step++) {
    const have = held(), locked = new Set(s.world.flags.lockedObjects || []);
    // 1. an unlocked, unexamined object anywhere
    const earned = o => (records.signs.find(x => x.id === o)?.requires || []).every(r => have.has(r));
    const obj = Object.keys(rt.LOCATIONS).flatMap(loc => rt.objectsAt(s.world, loc).map(o => [loc, o]))
      .find(([, o]) => (!locked.has(o) || earned(o)) && !have.has(rt.OBJECTS[o].clue));
    if (obj) {
      // an earned-but-closed lead opens when you get there
      if (s.world.player.location !== obj[0]) dispatch(s, {type: 'move', to: obj[0]});
      dispatch(s, {type: 'inspect', object: obj[1]}); log.push(`inspect ${obj[1]}`); continue;
    }
    // 2. an account someone can now give (go to wherever they are)
    const talk = Object.keys(rt.PEOPLE).flatMap(pid => {
      const where = s.world.npcs[pid].location;
      if (!rt.LOCATIONS[where]) return [];
      if (s.world.player.location !== where) return [[pid, where, null]];
      return records.signs.filter(x => x.kind === 'testimony' && x.speaker === pid && !have.has(x.id)
        && (x.requires || []).every(r => have.has(r))).map(x => [pid, where, x.id]);
    });
    const ready = talk.find(t => t[2]);
    const pending = records.signs.filter(x => x.kind === 'testimony' && !have.has(x.id) && (x.requires || []).every(r => have.has(r)));
    if (ready) { dispatch(s, {type: 'ask', person: ready[0], topic: ready[2]}); log.push(`ask ${ready[0]} ${ready[2]}`); continue; }
    const target = pending.map(x => [x.speaker, s.world.npcs[x.speaker]?.location]).find(([, w]) => rt.LOCATIONS[w]);
    if (target && s.world.player.location !== target[1]) { dispatch(s, {type: 'move', to: target[1]}); continue; }
    if (pending.length) { dispatch(s, {type: 'wait', minutes: 10}); if (step > maxSteps - 5) break; continue; }
    break;
  }
  const result = {session: s, runtime: rt, log, evidence: [...held()]};
  if (accuse) {
    const post = s.world.npcs[rt.CASE.constable].location;   // the accusation is heard by the constable, where he is
    if (s.world.player.location !== post) dispatch(s, {type: 'move', to: post});
    for (let i = 0; i < 12 && s.world.npcs.bell.location !== 'square'; i++) dispatch(s, {type: 'wait', minutes: 10});
    dispatch(s, {type: 'accuse', suspect: accuse, method, motive, evidence: [...held()].filter(c => !drop.includes(c))});
    result.verdict = rt.behavior.checkCase(s, {suspect: accuse, method, motive, evidence: [...held()].filter(c => !drop.includes(c))});
    result.solved = s.world.status === 'solved';
    result.reply = s.events.findLast(e => e.playerText && ['resolution', 'rejected'].includes(e.kind))?.playerText;
  }
  return result;
}
