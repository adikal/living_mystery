// Mystery kernel: certification over the general case model (docs/mystery-kernel.md).
//
// Pure ES module, no dependencies: runs in the browser (play-time grading) and in Node (generation-time
// certification, via tools/mk-certify.mjs). This is the single source of truth for sign semantics. The LLM
// never states what a sign eliminates; everything here is computed from typed records.
//
// Case records: setting{places,links}, rules, people{traits}, objects, relations, possession,
// question{candidates[{id,label,facts{actor,...}}],truth,crime{event,place,window}}, attitudes, events, signs.

export const CLAIM_KINDS = new Set(['place', 'time', 'trait', 'relation', 'possession', 'fact']);
export const SIGN_KINDS = new Set(['trace', 'testimony', 'document', 'record', 'behavior', 'item', 'rule', 'observation', 'absence']);
const INF = 1e9;

// Python-compatible stringification for value comparison (traits may be strings, numbers or booleans).
const pyStr = v => v === true ? 'True' : v === false ? 'False' : v == null ? 'None' : String(v);
const arr = v => (Array.isArray(v) ? v : []);

// ---------------------------------------------------------------------------------------------------
// World model
// ---------------------------------------------------------------------------------------------------

export function travelTable(c) {
  const places = c.setting.places.map(p => p.id), d = {};
  for (const a of places) { d[a] = {}; for (const b of places) d[a][b] = a === b ? 0 : INF; }
  for (const e of arr(c.setting.links)) {
    if (d[e.a] && d[e.b]) { d[e.a][e.b] = Math.min(d[e.a][e.b], e.minutes); d[e.b][e.a] = Math.min(d[e.b][e.a], e.minutes); }
  }
  for (const k of places) for (const i of places) for (const j of places)
    if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j];
  return d;
}

const cmpTuple = (x, y) => { for (let i = 0; i < x.length; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; } return 0; };

/** True presence intervals per person, from events (agent + others): [start, end, place, eventId], sorted. */
export function presence(c) {
  const out = {};
  for (const ev of c.events) for (const p of [ev.agent, ...arr(ev.others)]) if (p) (out[p] ??= []).push([ev.start, ev.end, ev.place, ev.id]);
  for (const p in out) out[p].sort(cmpTuple);
  return out;
}

const peopleOf = c => Object.fromEntries(c.people.map(p => [p.id, p]));
const hypMap = c => Object.fromEntries(c.question.candidates.map(h => [h.id, h]));
export const actorOf = h => (h.facts || {}).actor;
export function claimOf(sign) {
  const x = sign.claim;
  return x && typeof x === 'object' && !Array.isArray(x) && CLAIM_KINDS.has(x.kind) ? x : null;
}

// ---------------------------------------------------------------------------------------------------
// Sign semantics
// ---------------------------------------------------------------------------------------------------

/** Does this trusted claim rule out hypothesis h? (place/time are handled jointly by opportunity) */
export function eliminates(c, claim, h) {
  const ppl = peopleOf(c), k = claim.kind, actor = actorOf(h);
  if (k === 'trait') {
    if (!actor || !ppl[actor]) return false;
    return pyStr((ppl[actor].traits || {})[claim.trait]) !== pyStr(claim.value);
  }
  if (k === 'relation' && claim.a) return false;           // a fact about a named person: establishes, never eliminates
  if (k === 'possession' && claim.person) return false;
  if (k === 'relation') {
    if (!actor) return false;
    return !arr(c.relations).some(r => r.a === actor && r.rel === claim.rel && (!claim.b || r.b === claim.b));
  }
  if (k === 'possession') {
    if (!actor) return false;
    return !arr(c.possession).some(p => p.person === actor && p.item === claim.item);
  }
  if (k === 'fact') {
    const facts = h.facts || {};
    return claim.key in facts && pyStr(facts[claim.key]) !== pyStr(claim.value);
  }
  return false;
}

/** Place claims are alibis: the actor could not reach the crime scene at any minute in the window. */
export function opportunityEliminated(c, placeClaims, window, h, tt) {
  const actor = actorOf(h), crimePlace = c.question.crime.place;
  if (!actor) return false;
  const [ws, we] = window;
  if (ws > we) return true;
  const blocked = [];
  for (const x of placeClaims) {
    if (x.person !== actor || x.place === crimePlace) continue;
    const gap = tt[x.place]?.[crimePlace] ?? 0;
    blocked.push([x.start - gap, x.end + gap]);
  }
  blocked.sort(cmpTuple);
  let t = ws;
  for (const [s, e] of blocked) {
    if (s > t) break;
    t = Math.max(t, e + 1);
    if (t > we) return true;
  }
  return t > we;
}

/** Truth value of a claim in the true history (detects lies and staged signs). */
export function claimTrue(c, claim) {
  const truth = hypMap(c)[c.question.truth], k = claim.kind;
  if (k === 'place') {
    const pres = presence(c)[claim.person] || [], s = claim.start, e = claim.end;
    const there = pres.some(([ps, pe, pl]) => ps < e && pe > s && pl === claim.place);
    const elsewhere = pres.some(([ps, pe, pl]) => ps < e && pe > s && pl !== claim.place);
    return there && !elsewhere;
  }
  if (k === 'time') {
    const crime = c.events.find(ev => ev.id === c.question.crime.event);
    return Boolean(crime) && claim.start <= crime.start && crime.end <= claim.end;
  }
  if (k === 'relation' && claim.a)
    return arr(c.relations).some(r => r.a === claim.a && r.rel === claim.rel && (!claim.b || r.b === claim.b));
  if (k === 'possession' && claim.person)
    return arr(c.possession).some(p => p.person === claim.person && p.item === claim.item);
  return !eliminates(c, claim, truth);
}

// ---------------------------------------------------------------------------------------------------
// Access, reading, trust, depth
// ---------------------------------------------------------------------------------------------------

export function analyse(c) {
  const tt = travelTable(c);
  const signs = Object.fromEntries(c.signs.map(s => [s.id, s]));
  const rules = Object.fromEntries(arr(c.rules).map(r => [r.id, r]));
  // access: monotone fixed point; depth = 1 + deepest prerequisite
  const depth = {};
  for (let changed = true; changed;) {
    changed = false;
    for (const [sid, s] of Object.entries(signs)) {
      if (sid in depth) continue;
      const req = arr(s.requires);
      if (req.every(r => r in depth)) { depth[sid] = req.length ? 1 + Math.max(...req.map(r => depth[r])) : 0; changed = true; }
    }
  }
  const reachable = new Set(Object.keys(depth));
  // rules known: common, or taught by a reachable rule sign
  const known = {};
  for (const r of Object.values(rules)) if (r.knowledge === 'common') known[r.id] = 0;
  for (const sid of reachable) {
    const s = signs[sid];
    if (s.kind === 'rule' && s.rule in rules) known[s.rule] = Math.min(known[s.rule] ?? 1e6, depth[sid]);
  }
  // reading: understood once every 'need' (sign or rule) is available; combining costs one step
  const eff = {};
  for (let changed = true; changed;) {
    changed = false;
    for (const sid of reachable) {
      if (sid in eff) continue;
      const needs = arr(signs[sid].needs), ds = [];
      let ok = true;
      for (const n of needs) {
        if (n in signs) { if (n in eff) ds.push(eff[n]); else ok = false; }
        else if (n in known) ds.push(known[n]);
        else ok = false;
      }
      if (ok) { eff[sid] = needs.length ? Math.max(depth[sid], ...ds) + 1 : depth[sid]; changed = true; }
    }
  }
  const understood = new Set(Object.keys(eff));
  const truthval = {};
  for (const [sid, s] of Object.entries(signs)) if (claimOf(s)) truthval[sid] = claimTrue(c, claimOf(s));
  return { tt, signs, depth, eff, reachable, understood, truthval, rulesKnown: known };
}

/** Candidates surviving every understood, trusted claim with effective depth <= maxDepth (null = all). */
export function survivors(c, A, maxDepth = null, exclude = new Set()) {
  const { signs, eff } = A;
  const visible = [...A.understood].filter(sid => !exclude.has(sid) && (maxDepth === null || eff[sid] <= maxDepth));
  const defeated = new Set();
  for (const sid of visible) for (const d of arr(signs[sid].defeats)) defeated.add(d);
  const trusted = visible.filter(sid => !defeated.has(sid) && claimOf(signs[sid])).map(sid => claimOf(signs[sid]));
  let window = [...c.question.crime.window];
  for (const x of trusted) if (x.kind === 'time') window = [Math.max(window[0], x.start), Math.min(window[1], x.end)];
  const places = trusted.filter(x => x.kind === 'place'), others = trusted.filter(x => x.kind !== 'place' && x.kind !== 'time');
  return c.question.candidates
    .filter(h => !opportunityEliminated(c, places, window, h, A.tt) && !others.some(x => eliminates(c, x, h)))
    .map(h => h.id);
}

/** root plus every sign that (transitively) requires or needs it. */
export function closureDependent(c, root) {
  const out = new Set([root]);
  for (let changed = true; changed;) {
    changed = false;
    for (const s of c.signs)
      if (!out.has(s.id) && [...arr(s.requires), ...arr(s.needs)].some(x => out.has(x))) { out.add(s.id); changed = true; }
  }
  return out;
}

const maxEff = A => { const v = Object.values(A.eff); return v.length ? Math.max(...v) : 0; };

/** Each innocent's clearance depth and the truth's survival depth; solve depth = the deepest thread. */
export function threadDepths(c, A, exclude = new Set()) {
  const q = c.question, maxd = maxEff(A);
  const surv = [];
  for (let d = 0; d <= maxd; d++) surv.push(new Set(survivors(c, A, d, exclude)));
  const from = pred => { for (let d = 0; d <= maxd; d++) { let all = true; for (let k = d; k <= maxd; k++) if (!pred(surv[k])) { all = false; break; } if (all) return d; } return null; };
  const out = {};
  for (const h of q.candidates) {
    if (h.id === q.truth) out.truth = from(s => s.has(q.truth));
    else out[h.id] = from(s => !s.has(h.id));
  }
  return out;
}

/** Signs whose removal (with their dependants) makes this thread deeper or unsolvable. */
export function criticalSigns(c, A, thread, depth) {
  const out = [];
  for (const sid of A.understood) {
    if (A.eff[sid] > depth) continue;
    const d = threadDepths(c, A, closureDependent(c, sid))[thread];
    if (d === null || d === undefined || d > depth) out.push(sid);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Certification
// ---------------------------------------------------------------------------------------------------

const TIME_RE = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(am|pm|a\.m\.|p\.m\.)?/gi;
const sameArr = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);

/** Motive and means evidence for an actor: understood, true signs that establish rather than eliminate.
 *  motive: a relation claim whose subject is the actor (or a fact keyed 'motive');
 *  means: a possession or trait claim the actor satisfies. held (optional Set) limits to the player's evidence. */
export function pillarSignsFor(c, A, actor, held = null) {
  const ppl = peopleOf(c), means = [];
  let motive = [];
  const victim = c.victim || c.events.find(e => e.type === 'death' && e.agent)?.agent || null;
  for (const [sid, s] of Object.entries(A.signs)) {
    if (!A.understood.has(sid) || !A.truthval[sid] || (held && !held.has(sid))) continue;
    const x = claimOf(s);
    if (!x) continue;
    if ((x.kind === 'relation' && x.a === actor) || (x.kind === 'relation' && victim && x.a === victim && x.b === actor)
      || (x.kind === 'fact' && x.key === 'motive' && (x.person ?? actor) === actor)) motive.push(sid);
    else if (x.kind === 'possession' && (x.person === actor || (!x.person && arr(c.possession).some(p => p.person === actor && p.item === x.item)))) means.push(sid);
    else if (x.kind === 'trait' && ppl[actor] && String(ppl[actor].traits?.[x.trait]) === String(x.value)) means.push(sid);
  }
  // a motive is a reason to kill THIS victim: at least one motive sign must connect the culprit and the victim
  if (victim) motive = motive.filter(x => claimOf(A.signs[x])?.kind !== 'relation' || [claimOf(A.signs[x]).a, claimOf(A.signs[x]).b].includes(victim));
  return { motive: motive.sort(), means: means.sort() };
}
export function pillarSigns(c, A) { return pillarSignsFor(c, A, actorOf(hypMap(c)[c.question.truth])); }

export function certify(c, requirePillars = true) {
  const errs = [];
  const ids = ['people', 'objects', 'attitudes', 'events', 'signs', 'rules'].flatMap(k => arr(c[k]).map(x => x.id));
  const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].sort();
  if (dup.length) errs.push(`duplicate ids: ${JSON.stringify(dup)}`);
  const ppl = peopleOf(c), places = new Set(c.setting.places.map(p => p.id));
  const att = Object.fromEntries(arr(c.attitudes).map(a => [a.id, a]));
  const evs = Object.fromEntries(c.events.map(e => [e.id, e]));
  const signs = Object.fromEntries(c.signs.map(s => [s.id, s]));
  const ruleIds = new Set(arr(c.rules).map(r => r.id));
  const q = c.question, hyps = hypMap(c);
  if (!(q.truth in hyps)) errs.push('question.truth is not one of the candidates');
  if (!(q.crime?.event in evs)) errs.push('question.crime.event does not name an event');
  for (const e of c.events) {
    if (!places.has(e.place)) errs.push(`event ${e.id}: unknown place ${e.place}`);
    for (const p of [e.agent, ...arr(e.others)]) if (p && !ppl[p]) errs.push(`event ${e.id}: unknown person ${p}`);
    if (e.end < e.start) errs.push(`event ${e.id}: ends before it starts`);
    if (e.agent && e.causedBy !== 'nature') {
      const a = att[e.causedBy];
      if (!a) errs.push(`event ${e.id} (${e.agent}) has no causing attitude`);
      else if (a.agent !== e.agent) errs.push(`event ${e.id}: causing attitude ${a.id} belongs to ${a.agent}, not ${e.agent}`);
    }
  }
  for (const a of arr(c.attitudes)) if (!ppl[a.agent]) errs.push(`attitude ${a.id}: unknown agent ${a.agent}`);
  for (const s of c.signs) {
    if (!SIGN_KINDS.has(s.kind)) errs.push(`sign ${s.id}: unknown kind ${s.kind}`);
    for (const r of arr(s.requires)) if (!(r in signs)) errs.push(`sign ${s.id}: requires unknown sign ${r}`);
    for (const n of arr(s.needs)) if (!(n in signs) && !ruleIds.has(n)) errs.push(`sign ${s.id}: needs unknown sign/rule ${n}`);
    for (const d of arr(s.defeats)) if (!(d in signs)) errs.push(`sign ${s.id}: defeats unknown sign ${d}`);
    if (s.source && !(s.source in evs)) errs.push(`sign ${s.id}: source event ${s.source} missing`);
    if (s.at && !places.has(s.at)) errs.push(`sign ${s.id}: unknown place ${s.at}`);
    if (arr(s.requires).length && !String(s.unlock ?? '').trim())
      errs.push(`sign ${s.id}: has 'requires' but no 'unlock' text saying why, in the world, those must come first`);
    if (arr(s.needs).length && !String(s.reading ?? '').trim())
      errs.push(`sign ${s.id}: has 'needs' but no 'reading' text saying how the other clue or rule makes sense of it`);
    if (s.claim != null && !claimOf(s)) errs.push(`sign ${s.id}: claim kind must be one of ${JSON.stringify([...CLAIM_KINDS].sort())}`);
    if (claimOf(s)?.kind === 'place' && (!ppl[s.claim.person] || !places.has(s.claim.place)))
      errs.push(`sign ${s.id}: place claim needs a known person and place`);
    if (s.kind === 'testimony' && !ppl[s.speaker]) errs.push(`sign ${s.id}: testimony needs a known speaker`);
  }
  // spoken times must match the timeline; a trace lies where its source event happened
  const times = new Set();
  for (const e of c.events) { times.add(((e.start % 1440) + 1440) % 1440); times.add(((e.end % 1440) + 1440) % 1440); }
  for (const s of c.signs) for (const k of ['start', 'end']) if (typeof s.claim?.[k] === 'number') times.add(((Math.trunc(s.claim[k]) % 1440) + 1440) % 1440);
  for (const s of c.signs) {
    if (s.kind === 'testimony' || s.kind === 'behavior') {
      for (const m of String(s.text ?? '').matchAll(TIME_RE)) {
        const h = Number(m[1]), mi = Number(m[2]), ap = (m[3] || '').toLowerCase();
        const opts = ap.startsWith('a') && h !== 12 ? [h * 60 + mi] : ap.startsWith('p') ? [(h % 12 + 12) * 60 + mi] : [h * 60 + mi, ((h + 12) % 24) * 60 + mi];
        if (!opts.some(o => [...times].some(t => Math.min(Math.abs(o - t), 1440 - Math.abs(o - t)) <= 20)))
          errs.push(`sign ${s.id}: its text mentions ${m[0].trim()}, which matches no event or claim time (+-20 min); fix the text or add the event (remember 1320 = 22:00)`);
      }
    }
    if (s.kind === 'trace' && s.source in evs && s.at && evs[s.source].place !== s.at)
      errs.push(`trace ${s.id} is at ${s.at} but its source event ${s.source} happened at ${evs[s.source].place}; a trace lies where it was made unless a later event (its source) moved it`);
  }
  if (errs.length) return { ok: false, errors: errs };

  // physical consistency: one place at a time, travel takes time
  const tt = travelTable(c);
  for (const [p, iv] of Object.entries(presence(c))) {
    for (let i = 0; i + 1 < iv.length; i++) {
      const [, e1, p1, id1] = iv[i], [s2, , p2, id2] = iv[i + 1];
      if (p1 !== p2 && s2 < e1) errs.push(`${p} is in two places at once: ${id1}@${p1} and ${id2}@${p2}`);
      else if (p1 !== p2 && s2 - e1 < tt[p1][p2]) errs.push(`${p} cannot travel ${p1}->${p2} in ${s2 - e1} min (needs ${tt[p1][p2]})`);
    }
  }
  if (evs[q.crime.event].agent !== actorOf(hyps[q.truth])) errs.push('the crime event agent is not the true culprit');
  const A = analyse(c);
  // false signs: lies/mistakes (with the speaker's reason) or staging (a deliberate source), defeated deeper
  for (const [sid, tv] of Object.entries(A.truthval)) {
    if (tv) continue;
    const s = A.signs[sid];
    if (s.kind === 'testimony') {
      if (!arr(c.attitudes).some(a => a.agent === s.speaker && arr(s.because).includes(a.id)))
        errs.push(`false testimony ${sid} by ${s.speaker} cites no attitude of ${s.speaker} explaining the lie or mistake`);
    } else {
      const src = evs[s.source];
      if (!src || src.causedBy == null || src.causedBy === 'nature') errs.push(`false physical sign ${sid} is not produced by a deliberate (staging) event`);
    }
    const good = Object.values(A.signs).filter(d => arr(d.defeats).includes(sid) && A.understood.has(d.id)
      && A.eff[d.id] > (A.eff[sid] ?? 0) && (A.truthval[d.id] ?? true));
    if (!good.length) errs.push(`false sign ${sid} has no reachable, true defeater deeper than it`);
  }
  const full = survivors(c, A);
  if (!sameArr(full, [q.truth])) errs.push(`answer not unique from all reachable evidence: survivors ${JSON.stringify(full)}`);
  if (errs.length) return { ok: false, errors: errs, A };

  const maxd = maxEff(A);
  let solve = null;
  for (let d = 0; d <= maxd; d++) if (sameArr(survivors(c, A, d), [q.truth])) { solve = d; break; }
  const surface = survivors(c, A, 0);
  const key = [...A.understood].filter(sid => claimOf(A.signs[sid]) && A.truthval[sid]
    && !sameArr(survivors(c, A, null, closureDependent(c, sid)), [q.truth])).sort();
  const innocentActors = new Set(q.candidates.filter(h => h.id !== q.truth).map(actorOf));
  const herrings = c.signs.filter(s => s.kind === 'behavior' && innocentActors.has(s.about)
    && arr(s.explainedBy).some(e => A.understood.has(e) && A.eff[e] > (A.eff[s.id] ?? 0))).map(s => s.id);
  const threads = threadDepths(c, A);
  const ta = actorOf(hyps[q.truth]), innocents = q.candidates.filter(h => h.id !== q.truth);
  const okSign = sid => A.understood.has(sid) && A.truthval[sid];
  const motive = Object.keys(A.signs).filter(sid => {
    const x = claimOf(A.signs[sid]);
    return okSign(sid) && x && ((x.kind === 'relation' && x.a === ta) || (x.kind === 'fact' && x.key === 'motive'));
  }).sort();
  const means = Object.keys(A.signs).filter(sid => {
    const x = claimOf(A.signs[sid]);
    return okSign(sid) && x && ['trait', 'possession', 'relation'].includes(x.kind) && !x.a && !x.person
      && innocents.some(h => eliminates(c, x, h));
  }).sort();
  const pil = pillarSigns(c, A);
  const pd = k => pil[k].length ? Math.min(...pil[k].map(x => A.eff[x])) : null;
  if (requirePillars && !pil.motive.length) errs.push("no reachable, true evidence of the culprit's MOTIVE (a relation claim with a = the culprit)");
  if (requirePillars && !pil.means.length) errs.push("no reachable, true evidence of the culprit's MEANS (a possession or trait claim the culprit satisfies)");
  if (errs.length) return { ok: false, errors: errs, A };
  const pillars = { opportunity: solve, means: pd('means'), motive: pd('motive') };
  return { ok: true, A, solveDepth: solve, maxDepth: maxd, surface, threads, motive, means, pillars, pillarSigns: pil,
           mmoDepth: Math.max(...Object.values(pillars).filter(v => v != null)),
           twist: !surface.includes(q.truth), key, herrings,
           falseSigns: Object.entries(A.truthval).filter(([, v]) => !v).map(([k]) => k).sort() };
}

/** JSON-safe summary of a certification report (drops the analysis internals). */
export function summarize(r) {
  if (!r.ok) return { ok: false, errors: r.errors };
  const { A, ...rest } = r;
  return { ...rest, depths: A.eff };
}
