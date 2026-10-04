import {inSentence} from './places.mjs';
// A morning that moves (docs/living-village.md). People in a generated case follow short agendas during the
// investigation: go somewhere, stay a while, meet someone and tell them something, or conceal a clue that is theirs to
// hide. A director (morning-director.mjs) proposes the agendas; everything here is deterministic and replayable:
//   knowledge(s, kc, pid)   what a person knows (private) and may say (sayable), each item with an id to cite
//   check(s, kc, plan)      the code critic: ids, places, timing and travel, citations, concealment rules
//   install(s, plan, cause) records the accepted agendas as an event
//   step(s, pid, cause)     the executor, called from the case's decide(): follows the agenda on the game clock
// Nothing here adds a fact about last night: meetings pass on only what the speaker may say (what they told the
// detective, what they were shown or asked, what they heard or saw today); concealment is admitted only if the case
// still certifies without the clue (the director checks that with the kernel).

const arr = v => Array.isArray(v) ? v : [];
export const STEP_KINDS = ['go', 'stay', 'meet', 'conceal'];
export const HORIZON = 30;                 // an agenda covers the next half hour
// a place name written mid-sentence ("reaches the post office"), as kernel-case writes them
const placeIn = (ctx, p) => ctx.places[p] ? inSentence(ctx.places[p]) : p;
const PHYSICAL = new Set(['document', 'item', 'record', 'trace']);                 // physical clues: what a hand can move

// ---- knowledge ----------------------------------------------------------------------------------------------------

export function knowledge(s, kc, pid, people, places) {
  const name = q => people[q]?.name ?? q;
  const place = p => places[p]?.name ?? p;
  const clock = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
  const priv = [], say = [];
  // private: their own true history and their reasons (drives what they do; never repeated as gossip)
  for (const e of kc.events) if (e.agent === pid || arr(e.others).includes(pid))
    priv.push({id: `k_ev_${e.id}`, text: `${clock(e.start)} at ${place(e.place)}: ${e.summary ?? ''}`});
  for (const a of arr(kc.attitudes)) if (a.agent === pid) priv.push({id: `k_att_${a.id}`, text: `${a.mode}: ${a.content}`});
  // sayable: what they have said to the detective, what the detective did with them, and what they heard or saw today
  for (const e of s.events) {
    if (e.kind === 'speech' && e.actor === pid && e.data?.listener === 'player')
      say.push({id: `k_said_${e.id}`, text: `I told the detective: ${e.data.assertion}`});
    else if (e.kind === 'speech' && e.actor === 'player' && e.data?.listener === pid)
      say.push({id: `k_asked_${e.id}`, text: `The detective said to me: ${e.data.assertion}`});
    else if (e.kind === 'speech' && e.data?.listener === pid && e.actor !== 'player')
      say.push({id: `k_heard_${e.id}`, text: `${name(e.actor)} told me: ${e.data.assertion}`});
    else if (e.kind === 'observation' && e.actor === pid && e.data?.morning)
      say.push({id: `k_saw_${e.id}`, text: e.title});
  }
  // what they saw the detective do: whom the detective questioned and where they searched, while this person was there
  // (it reaches anyone else only by being told, which is a meeting and so a 'heard' item above)
  const w = witnessed(s, people);
  const visits = [...(w.questioned[pid] ?? [])].map(name), searched = [...(w.searched[pid] ?? [])].map(place);
  if (visits.length) say.push({id: 'k_village_questioned', text: `I saw the detective questioning ${visits.join(', ')} this morning.`});
  if (searched.length) say.push({id: 'k_village_searched', text: `I saw the detective searching at ${searched.join(', ')}.`});
  return {private: priv, sayable: say};
}

// Who saw the detective question whom, and search where: everyone at the detective's place at the time (replayed from
// the event log, so it is exactly what happened; someone walking between places sees nothing).
const WITNESSED = new WeakMap();
export function witnessed(s, people) {
  const hit = WITNESSED.get(s);
  if (hit && hit.n === s.events.length) return hit.w;
  const loc = Object.fromEntries(Object.keys(s.world.npcs).map(p => [p, people[p]?.home ?? null]));
  let at = null;
  const w = {questioned: {}, searched: {}};
  const add = (k, q, v) => ((w[k][q] ??= new Set()).add(v));
  for (const e of s.events) {
    for (const c of e.changes ?? []) {
      const m = /^npcs\.([^.]+)\.location$/.exec(c.path);
      if (m) loc[m[1]] = c.after; else if (c.path === 'player.location') at = c.after;
    }
    const by = q => q !== 'player' && loc[q] === at && at && at !== 'transit';
    if (e.kind === 'speech' && e.data?.listener === 'player' && people[e.actor])
      for (const q of Object.keys(loc)) if (q !== e.actor && by(q)) add('questioned', q, e.actor);
    if (e.kind === 'evidence')
      for (const q of Object.keys(loc)) if (by(q)) add('searched', q, at);
  }
  WITNESSED.set(s, {n: s.events.length, w});
  return w;
}

// ---- the code critic ----------------------------------------------------------------------------------------------

// Who is free to act: people in the case, alive, not the victim. The constable keeps his post (the accusation is heard
// there); he may still be visited.
export function actors(s, kc, roles, victim) {
  return Object.keys(s.world.npcs).filter(pid => pid !== victim && pid !== roles.constable);
}

// The clues a person may conceal: not yet found, made by them (its source event is theirs) or about them, and the
// person has a reason in their own attitudes (one of their fears or wants is cited).
export function concealable(s, kc, pid) {
  const held = new Set(s.world.player.evidence.map(e => e.clue));
  // gone already, or refused by the kernel (the case needs it; more hidden only makes that worse)
  const gone = [...(s.world.flags.morning?.concealed ?? []), ...(s.world.flags.morning?.refused ?? [])];
  // only things a hand can move: documents, items, records, traces (not behaviour, absences or observations)
  // (a lead not yet open to the detective is still there to be moved: locked only means not yet reachable for them)
  return kc.signs.filter(x => PHYSICAL.has(x.kind) && !held.has(x.id) && !gone.includes(x.id)
    && (kc.events.find(e => e.id === x.source)?.agent === pid || x.about === pid
      || [x.claim?.person, x.claim?.a, x.claim?.b].includes(pid))).map(x => x.id);
}

// Returns {ok, errors, plan} with the plan normalised (unknown fields dropped). Steps run in order; each has an
// earliest start (`at`, minutes) and its timing is checked against walking times from where the person will be.
export function check(s, kc, ctx, proposal) {
  const {people, places, distance, roles, victim} = ctx;
  const errors = [], plan = {};
  const now = s.world.minute, end = now + HORIZON;
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal) || typeof proposal.agendas !== 'object')
    return {ok: false, errors: ['expected {"agendas": {"<person id>": [steps]}}'], plan};
  const free = new Set(actors(s, kc, roles, victim));
  for (const [pid, steps] of Object.entries(proposal.agendas)) {
    if (!free.has(pid)) { errors.push(`${pid}: not someone who can act now`); continue; }
    if (!Array.isArray(steps) || steps.length > 3) { errors.push(`${pid}: at most three steps`); continue; }
    const k = knowledge(s, kc, pid, people, places), ids = new Set([...k.private, ...k.sayable].map(x => x.id));
    const sayIds = new Set(k.sayable.map(x => x.id));
    let where = s.world.npcs[pid].travel?.to ?? s.world.npcs[pid].location, t = Math.max(now, s.world.npcs[pid].travel?.arrival ?? now);
    const out = [];
    for (const [i, st] of steps.entries()) {
      const bad = m => errors.push(`${pid} step ${i + 1} (${st?.kind}): ${m}`);
      if (!st || !STEP_KINDS.includes(st.kind)) { bad('unknown kind'); break; }
      const cites = arr(st.because);
      // every citation must be theirs; meetings and concealments must cite (their reasons are what make them valid)
      if (cites.some(c => !ids.has(c)) || (['meet', 'conceal'].includes(st.kind) && !cites.length)) { bad('must cite their own knowledge ids in "because"'); break; }
      const to = st.kind === 'go' ? st.place : st.kind === 'meet' ? st.place : st.kind === 'conceal' ? kc.signs.find(x => x.id === st.clue)?.at : where;
      if (!places[to]) { bad(`unknown place ${to}`); break; }
      if (st.kind === 'go' && to === where) continue;                             // already there: nothing to do
      const arrive = t + distance(where, to);
      if (!Number.isFinite(arrive) || arrive > end) { bad(`cannot get to ${to} within the plan (${HORIZON} minutes)`); break; }
      const step = {kind: st.kind, place: to, because: cites};
      if (st.kind === 'stay') {
        const until = Math.min(Number(st.until) || t + 20, end);
        if (until <= t) { bad('stay must end after it starts'); break; }
        step.until = until; t = until;
      } else if (st.kind === 'meet') {
        if (!people[st.with] || st.with === pid || st.with === victim) { bad(`cannot meet ${st.with}`); break; }
        const said = String(st.say ?? '').trim();
        if (!said || said.length > 300) { bad('a meeting needs one or two sentences to say'); break; }
        // what is passed on rests only on what they may say, never on their private history or reasons
        if (!cites.every(c => sayIds.has(c))) { bad('what they say must rest only on what they may say (told, asked, heard, seen today), not on private history or reasons'); break; }
        Object.assign(step, {with: st.with, say: said, until: Math.min(arrive + 20, end)});
        t = arrive + 6;
      } else if (st.kind === 'conceal') {
        if (!concealable(s, kc, pid).includes(st.clue)) { bad(`${st.clue} is not theirs to hide, or already found or gone`); break; }
        // the constable keeps to his post (he is never planned for), so nothing there can be hidden from him
        const post = roles?.constable && s.world.npcs[roles.constable]?.location;
        if (post && to === post) { bad(`${people[roles.constable]?.name ?? 'the constable'} is at ${places[to]?.name ?? to}: nobody hides anything in front of the constable`); break; }
        if (!cites.some(c => c.startsWith('k_att_') && ['fears', 'wants', 'hides', 'intends'].includes(kc.attitudes.find(a => `k_att_${a.id}` === c)?.mode)))
          { bad('concealing needs a reason of theirs (a fear or want) cited'); break; }
        step.clue = st.clue; t = arrive + 3;
      } else t = arrive;
      out.push(step); where = to;
    }
    const start = s.world.npcs[pid].travel?.to ?? s.world.npcs[pid].location;
    if (out.some(x => x.kind !== 'stay' || x.place !== start)) plan[pid] = out;     // only staying put is no plan at all
  }
  return {ok: errors.length === 0, errors, plan};
}

// ---- execution ----------------------------------------------------------------------------------------------------

// `replanned`: everyone this round planned for. Their new plan replaces the old even when nothing of it survived the
// critics (the newest judgement wins: a step judged unsound now does not run on from an earlier round).
export function install(K, s, plan, cause, audit = {}, replanned = Object.keys(plan)) {
  const m = s.world.flags.morning ?? {agendas: {}, concealed: [], last: null};
  const agendas = {...m.agendas};
  for (const pid of replanned) if (agendas[pid]) agendas[pid] = agendas[pid].filter(x => !['pending', 'active'].includes(x.state));
  for (const [pid, steps] of Object.entries(plan)) agendas[pid] = steps.map(x => ({...x, state: 'pending'}));
  // clues the kernel refused to let go this round: never offered to the director again
  const refused = [...new Set([...(m.refused ?? []), ...Object.entries(audit.solvable ?? {}).filter(([, v]) => v !== 'still solvable').map(([k]) => k.split(':')[1])])];
  return K.commit(s, {kind: 'decision', title: 'The village goes about its morning', actor: 'world', parents: [cause ?? s.events.at(-1)?.id].filter(Boolean),
    data: {morning: true, plan, audit}, changes: {'flags.morning': {...m, agendas, refused, last: s.world.minute, lastIndex: s.events.length}}});
}

const setStep = (K, s, pid, i, patch, cause, title, extra = {}) => {
  const m = s.world.flags.morning, steps = m.agendas[pid].map((x, j) => j === i ? {...x, ...patch} : x);
  const e = K.commit(s, {kind: 'action', title, actor: pid, parents: [cause].filter(Boolean), location: s.world.npcs[pid].location,
    data: {morning: true, step: steps[i], ...extra.data}, changes: {'flags.morning': {...m, agendas: {...m.agendas, [pid]: steps}}, ...extra.changes},
    playerText: extra.playerText ?? null});
  if (patch.state === 'done') K.remember(s, pid, e);        // what they did is theirs to remember (and tell, or not)
  return e;
};

// The executor: one step at a time, on the game clock. Returns true if it acted (the case's own routine then waits).
// A finished step hands straight on to the next (go, then stay, then a meeting) within the same minute.
export function step(K, s, ctx, pid, cause) {
  for (let n = 0; n < 4; n++) {
    const before = (s.world.flags.morning?.agendas?.[pid] ?? []).filter(x => ['done', 'missed'].includes(x.state)).length;
    const acted = stepOnce(K, s, ctx, pid, cause);
    const after = (s.world.flags.morning?.agendas?.[pid] ?? []).filter(x => ['done', 'missed'].includes(x.state)).length;
    if (after === before || s.world.npcs[pid].travel) return acted;
  }
  return true;
}

function stepOnce(K, s, ctx, pid, cause) {
  const m = s.world.flags.morning, steps = m?.agendas?.[pid];
  if (!steps) return false;
  const a = s.world.npcs[pid], i = steps.findIndex(x => x.state === 'pending' || x.state === 'active');
  if (i < 0) return true;                                                  // done for now: stays where they are
  if (a.travel || s.world.player.conversation === pid) return true;          // on the way, or talking to the detective
  const x = steps[i], here = a.location, playerHere = s.world.player.location === here;
  const name = q => ctx.people[q]?.name ?? q;
  if (here !== x.place) { K.startTravel(s, pid, x.place, cause, `Morning: ${x.kind}`); return true; }
  if (x.kind === 'go') { setStep(K, s, pid, i, {state: 'done'}, cause, `${name(pid)} reaches ${placeIn(ctx, x.place)}`); return true; }
  if (x.kind === 'stay') {
    if (s.world.minute >= x.until) setStep(K, s, pid, i, {state: 'done'}, cause, `${name(pid)} leaves off at ${placeIn(ctx, x.place)}`);
    return true;
  }
  if (x.kind === 'conceal') {
    const held = s.world.player.evidence.some(e => e.clue === x.clue);
    if (held) { setStep(K, s, pid, i, {state: 'missed', why: 'already found'}, cause, `${name(pid)} finds it already taken`); return true; }
    // nobody hides something in front of the law: the detective or the constable. They wait (seen to linger, if the
    // detective is there), until the plan runs out. The line names the clue only if the detective can already see it.
    const constable = ctx.roles?.constable, lawHere = playerHere || (constable && constable !== pid
      && s.world.npcs[constable]?.location === here && !s.world.npcs[constable]?.travel);
    if (lawHere) {
      const until = x.until ?? s.world.minute + 30;
      const visible = s.world.player.evidence.some(e => e.clue === x.clue) || !(s.world.flags.lockedObjects ?? []).includes(x.clue);
      if (s.world.minute >= until) setStep(K, s, pid, i, {state: 'missed', why: playerHere ? 'the detective stayed' : 'the constable stayed'}, cause, `${name(pid)} gives up and leaves it`);
      else if (x.state !== 'active') setStep(K, s, pid, i, {state: 'active', until}, cause, `${name(pid)} lingers`, {
        playerText: playerHere ? `${name(pid)} lingers${visible ? ` near ${ctx.clueTitle(x.clue)}` : ''}, glancing at you, and seems in no hurry to leave.` : null});
      return true;
    }
    const concealed = [...(m.concealed ?? []), x.clue];
    const expiry = {...(s.world.flags.evidenceExpiry ?? {}), [x.clue]: s.world.minute - 1};
    const e = setStep(K, s, pid, i, {state: 'done'}, cause, `${name(pid)} takes ${ctx.clueTitle(x.clue)} away from ${placeIn(ctx, here)}`, {
      changes: {'flags.evidenceExpiry': expiry},
      playerText: null});
    K.commit(s, {kind: 'action', title: 'A clue is gone', actor: 'world', parents: [e],
      changes: {'flags.morning': {...s.world.flags.morning, concealed}}});
    // anyone present saw it (the detective too, if there)
    for (const [q, b] of Object.entries(s.world.npcs)) if (q !== pid && b.location === here)
      K.commit(s, {kind: 'observation', title: `I saw ${name(pid)} take ${ctx.clueTitle(x.clue)} away from ${placeIn(ctx, here)}`, actor: q, parents: [e], data: {morning: true}});
    return true;
  }
  if (x.kind === 'meet') {
    const other = s.world.npcs[x.with];
    const there = other && !other.travel && other.location === here && s.world.player.conversation !== x.with;
    if (!there) {
      if (s.world.minute >= x.until) setStep(K, s, pid, i, {state: 'missed', why: `${name(x.with)} was not there`}, cause, `${name(pid)} waits in vain for ${name(x.with)}`);
      else if (x.state !== 'active') setStep(K, s, pid, i, {state: 'active'}, cause, `${name(pid)} waits for ${name(x.with)}`);
      return true;
    }
    const e = setStep(K, s, pid, i, {state: 'done'}, cause, `${name(pid)} speaks with ${name(x.with)}`, {
      playerText: playerHere ? `${name(pid)} draws ${name(x.with)} aside: “${x.say}”` : null});
    // the listener now knows what they were told (they may pass it on, or tell the detective)
    const said = K.commit(s, {kind: 'speech', title: `${name(pid)} speaks to ${name(x.with)}`, actor: pid, location: here, parents: [e],
      data: {listener: x.with, assertion: x.say, morning: true, because: x.because}});
    K.remember(s, pid, said); K.remember(s, x.with, said);
    for (const [q, b] of Object.entries(s.world.npcs)) if (![pid, x.with].includes(q) && b.location === here)
      K.commit(s, {kind: 'observation', title: `I saw ${name(pid)} talking with ${name(x.with)} at ${placeIn(ctx, here)}`, actor: q, parents: [e], data: {morning: true}});
    return true;
  }
  return false;
}

// What a person heard or saw this morning, as something they can tell the detective (newest last).
export function news(s, pid, people) {
  const name = q => people[q]?.name ?? q;
  return s.events.filter(e => (e.kind === 'speech' && e.data?.listener === pid && e.actor !== 'player' && e.data?.morning)
    || (e.kind === 'observation' && e.actor === pid && e.data?.morning))
    .map(e => ({id: e.id, text: e.kind === 'speech' ? `${name(e.actor)} told me this morning: “${e.data.assertion}”` : `${e.title}.`}));
}

// Something has happened since the last plan that the people it concerns would react to at once: the detective showed
// someone a clue, found a clue that concerns someone, or someone conceded a story or admitted a secret. What concerns
// whom is read from the case (a clue's claim, subject, addressee, speaker or source), never from its words.
const ADMISSIONS = /^mk_(conceded|named|explained)_/;
// A found clue counts when it concerns someone who can act, other than its own speaker: hearing someone's own account
// is ordinary questioning (the clock covers it); what they say about another, or a thing that points at someone, is news.
export function significant(s, kc, ctx) {
  const from = s.world.flags.morning?.lastIndex ?? 0;
  const free = new Set(ctx ? actors(s, kc, ctx.roles, ctx.victim) : Object.keys(s.world.npcs).filter(p => p !== kc.victim));
  const concerns = id => { const x = kc.signs.find(y => y.id === id); if (!x) return [];
    return [...new Set([x.about, x.to, x.claim?.person, x.claim?.a, x.claim?.b, kc.events.find(e => e.id === x.source)?.agent])]
      .filter(p => p && p !== x.speaker && free.has(p)); };
  for (const e of s.events.slice(from)) {
    if (e.kind === 'speech' && e.actor === 'player' && e.data?.clue) return `the detective showed ${e.data.listener} ${e.data.clue}`;
    if (e.kind === 'evidence' && concerns(e.data?.clue).length) return `the detective found ${e.data.clue}, which concerns ${concerns(e.data.clue).join(', ')}`;
    if (e.kind === 'belief' && ADMISSIONS.test(e.data?.belief?.key ?? '')) return `${e.actor} conceded or admitted something to the detective`;
  }
  return null;
}
