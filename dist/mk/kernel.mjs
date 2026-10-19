// Mystery kernel: certification over the general case model (docs/mystery-kernel.md).
//
// Pure ES module, no dependencies: runs in the browser (play-time grading) and in Node (generation-time
// certification, via tools/mk-certify.mjs). This is the single source of truth for sign semantics. The LLM
// never states what a sign eliminates; everything here is computed from typed records.
//
// Case records: setting{places,links}, rules, people{traits}, objects{supply?}, vocabulary{relations}, holdings,
// relations, question{candidates[{id,label,facts{actor,...}}],truth,crime{event,place,window}}, attitudes,
// events{effects?, facts? on the crime}, signs{claim}. Claims and their meaning: claims.mjs and docs/claims.md.

import {PREDICATES, claimOf, claimErrors, recordErrors, travelTable, history, truthOf, survivorsOf, instanceClaims,
  consistent, defeatFreeSets, CLAIMS_VERSION, relationReader, victimOf, actorOf, CULPRIT_PREDICATES} from './claims.mjs';
export {PREDICATES, claimOf, travelTable, actorOf};

// 'public' signs are what everyone in the setting knows: the player holds them from the start.
export const SIGN_KINDS = new Set(['trace', 'testimony', 'document', 'record', 'behavior', 'item', 'rule', 'observation', 'absence', 'public']);
const arr = v => (Array.isArray(v) ? v : []);
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

/** Truth of a claim in the true history: true, false, or null (undetermined). */
export const claimTrue = (c, claim) => truthOf(c, history(c), claim);

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
  const H = history(c, tt), truthval = {};
  for (const [sid, s] of Object.entries(signs)) if (claimOf(s)) truthval[sid] = truthOf(c, H, claimOf(s));
  return { tt, H, signs, depth, eff, reachable, understood, truthval, rulesKnown: known };
}

/** The trusted claims among the visible signs: those no visible sign defeats, as [[sid, claim], ...]. */
export function trustedClaims(A, visible) {
  const defeated = new Set(visible.flatMap(sid => arr(A.signs[sid].defeats)));
  return visible.filter(sid => !defeated.has(sid) && claimOf(A.signs[sid])).sort().map(sid => [sid, claimOf(A.signs[sid])]);
}

/** Candidates consistent with every understood, trusted claim with effective depth <= maxDepth (null = all). */
export function survivors(c, A, maxDepth = null, exclude = new Set()) {
  const visible = [...A.understood].filter(sid => !exclude.has(sid) && (maxDepth === null || A.eff[sid] <= maxDepth));
  return survivorsOf(c, trustedClaims(A, visible), A.tt);
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
    if (A.eff[sid] > depth || A.signs[sid].kind === 'public') continue;
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
/** Why the speaker can give this account, from the case records alone (mirrors refine.account_backing), or null. */
export function accountBacking(c, sign) {
  const sp = sign.speaker, evs = Object.fromEntries(c.events.map(e => [e.id, e]));
  const part = e => Boolean(e) && (e.agent === sp || arr(e.others).includes(sp));
  if (part(evs[sign.source])) return 'source';
  if (arr(c.attitudes).some(a => a.agent === sp && arr(sign.because).includes(a.id))) return 'because';
  const x = claimOf(sign);
  if (!x) return c.events.some(part) ? 'own_events' : null;
  if (x.pred === 'wasAt') {
    if (x.person === sp) return 'self';
    if (c.events.some(e => part(e) && e.place === x.place && e.start <= x.to && e.end >= x.from)) return 'witnessed';
  }
  return null;
}
export const unbackedAccounts = c => c.signs.filter(x => x.kind === 'testimony' && accountBacking(c, x) === null).map(x => x.id).sort();

export function pillarSignsFor(c, A, actor, held = null) {
  const victim = victimOf(c), read = relationReader(c), motive = [], means = [];
  const linked = (a, b) => !victim || a === victim || b === victim;
  for (const [sid, s] of Object.entries(A.signs)) {
    // what everyone knows is not evidence against anyone: only clues count
    if (!A.understood.has(sid) || A.truthval[sid] !== true || s.kind === 'public' || (held && !held.has(sid))) continue;
    const x = claimOf(s);
    if (!x || x.when === 'never' || x.not) continue;
    // culprit predicates count for the actor if the actor satisfies them in the history
    const satisfied = () => truthOf(c, A.H, x, actor) === true;
    if (x.pred === 'related') { const [a, , b] = read(x.a, x.rel, x.b); if ((a === actor || (b === actor && a === victim)) && linked(a, b)) motive.push(sid); }
    else if (x.pred === 'culpritRelated') { const [a, , b] = read(actor, x.rel, x.b); if (linked(a, b) && satisfied()) motive.push(sid); }
    else if (x.pred === 'crimeFact' && x.key === 'motive') motive.push(sid);
    else if ((x.pred === 'had' || x.pred === 'hasTrait') && x.person === actor) means.push(sid);
    else if ((x.pred === 'culpritHad' || x.pred === 'culpritTrait') && satisfied()) means.push(sid);
  }
  return { motive: motive.sort(), means: means.sort() };
}
export function pillarSigns(c, A) { return pillarSignsFor(c, A, actorOf(hypMap(c)[c.question.truth])); }

const describe = key => key.replace(/^at:/, 'the whereabouts of ').replace(/^holder:/, 'who had ').replace(/^has:([^:]+):/, "$1's access to ")
  .replace(/^rel:/, 'the relation ').replace(/^trait:/, 'the trait ').replace(/^crime$/, "the crime's minute and facts");

export function certify(c, requirePillars = true, requireBacking = false) {
  if (c.claims_version !== CLAIMS_VERSION) return { ok: false, errors: [`claims version ${c.claims_version ?? 1}: migrate the case to version ${CLAIMS_VERSION} (tools/refine-c/migrate.py)`] };
  const errs = [];
  const ids = ['people', 'objects', 'attitudes', 'events', 'signs', 'rules'].flatMap(k => arr(c[k]).map(x => x.id));
  const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].sort();
  if (dup.length) errs.push(`duplicate ids: ${JSON.stringify(dup)}`);
  const ppl = peopleOf(c), places = new Set(c.setting.places.map(p => p.id));
  const att = Object.fromEntries(arr(c.attitudes).map(a => [a.id, a]));
  const evs = Object.fromEntries(c.events.map(e => [e.id, e]));
  const signs = Object.fromEntries(c.signs.map(s => [s.id, s]));
  const rules = Object.fromEntries(arr(c.rules).map(r => [r.id, r]));
  const ruleIds = new Set(Object.keys(rules));
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
    if (s.kind === 'rule') {
      const rule = rules[s.rule];
      if (!rule || rule.knowledge !== 'acquirable') errs.push(`rule sign ${s.id}: rule must name an existing acquirable rule`);
      if (arr(s.needs).length) errs.push(`rule sign ${s.id}: must have no 'needs'; use 'requires' to model access`);
    }
    for (const r of arr(s.requires)) if (!(r in signs)) errs.push(`sign ${s.id}: requires unknown sign ${r}`);
    for (const n of arr(s.needs)) if (!(n in signs) && !ruleIds.has(n)) errs.push(`sign ${s.id}: needs unknown sign/rule ${n}`);
    for (const d of arr(s.defeats)) if (!(d in signs)) errs.push(`sign ${s.id}: defeats unknown sign ${d}`);
    if (s.source && !(s.source in evs)) errs.push(`sign ${s.id}: source event ${s.source} missing`);
    if (s.at && !places.has(s.at)) errs.push(`sign ${s.id}: unknown place ${s.at}`);
    if (arr(s.requires).length && !String(s.unlock ?? '').trim())
      errs.push(`sign ${s.id}: has 'requires' but no 'unlock' text saying why, in the world, those must come first`);
    if (arr(s.needs).length && !String(s.reading ?? '').trim())
      errs.push(`sign ${s.id}: has 'needs' but no 'reading' text saying how the other clue or rule makes sense of it`);
    if (s.claim != null && !claimOf(s)) errs.push(`sign ${s.id}: a claim's pred must be one of ${JSON.stringify(Object.keys(PREDICATES).sort())}`);
    else if (claimOf(s)) errs.push(...claimErrors(c, s.id, claimOf(s)));
    if (s.kind === 'public' && (arr(s.requires).length || arr(s.needs).length || !claimOf(s)))
      errs.push(`public sign ${s.id}: what everyone knows has a claim and no 'requires' or 'needs'`);
    if (s.kind === 'testimony' && !ppl[s.speaker]) errs.push(`sign ${s.id}: testimony needs a known speaker`);
    for (const d of arr(s.defeats)) if (signs[d]?.kind === 'public') errs.push(`sign ${s.id} defeats ${d}, but what everyone knows cannot be overturned`);
  }
  errs.push(...recordErrors(c));
  // spoken times must match the timeline; a trace lies where its source event happened
  const times = new Set();
  for (const e of c.events) { times.add(((e.start % 1440) + 1440) % 1440); times.add(((e.end % 1440) + 1440) % 1440); }
  for (const s of c.signs) for (const k of ['from', 'to']) if (typeof s.claim?.[k] === 'number') times.add(((Math.trunc(s.claim[k]) % 1440) + 1440) % 1440);
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
  // every claim is decided by the history; false ones are lies/mistakes (with the speaker's reason) or staging (a
  // deliberate source), defeated deeper
  for (const [sid, tv] of Object.entries(A.truthval)) {
    if (tv === null) errs.push(`the history does not decide the claim of ${sid} (${JSON.stringify(claimOf(A.signs[sid]))}): add the events that settle it, or change the claim`);
    if (tv === null || tv) continue;
    const s = A.signs[sid];
    if (s.kind === 'public') { errs.push(`public sign ${sid} is false, but what everyone knows must be true`); continue; }
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
  // consistency: claims the player can hold together that cannot all be true must include a defeat, so whatever the
  // player holds, what they trust is consistent (docs/claims.md section 5)
  // public knowledge is always held, so what it defeats is never trusted
  const defeats = Object.fromEntries(c.signs.map(x => [x.id, arr(x.defeats)]));
  const overturned = new Set(c.signs.filter(x => x.kind === 'public').flatMap(x => arr(x.defeats)));
  const readable = [...A.understood].filter(sid => claimOf(A.signs[sid]) && !overturned.has(sid)).sort().map(sid => [sid, claimOf(A.signs[sid])]);
  for (const [key, ids] of instanceClaims(c, readable)) for (const set of defeatFreeSets(ids, defeats)) {
    if (!consistent(c, readable.filter(([sid]) => set.includes(sid)), A.tt)) {
      errs.push(`${set.join(', ')} cannot all be true (${describe(key)}), but none of them defeats another: record which is false, and let the true one defeat it`);
      break;
    }
  }
  const full = survivors(c, A);
  if (!sameArr(full, [q.truth])) errs.push(`answer not unique from all reachable evidence: survivors ${JSON.stringify(full)}`);
  if (errs.length) return { ok: false, errors: errs, A };

  const maxd = maxEff(A);
  let solve = null;
  for (let d = 0; d <= maxd; d++) if (sameArr(survivors(c, A, d), [q.truth])) { solve = d; break; }
  const surface = survivors(c, A, 0);
  const key = [...A.understood].filter(sid => claimOf(A.signs[sid]) && A.truthval[sid] === true && A.signs[sid].kind !== 'public'
    && !sameArr(survivors(c, A, null, closureDependent(c, sid)), [q.truth])).sort();
  const innocentActors = new Set(q.candidates.filter(h => h.id !== q.truth).map(actorOf));
  const herrings = c.signs.filter(s => s.kind === 'behavior' && innocentActors.has(s.about)
    && arr(s.explainedBy).some(e => A.understood.has(e) && A.eff[e] > (A.eff[s.id] ?? 0))).map(s => s.id);
  const threads = threadDepths(c, A);
  const ta = actorOf(hyps[q.truth]), innocents = q.candidates.filter(h => h.id !== q.truth);
  const okSign = sid => A.understood.has(sid) && A.truthval[sid] === true && A.signs[sid].kind !== 'public';
  const read = relationReader(c);
  const motive = Object.keys(A.signs).filter(sid => {
    const x = claimOf(A.signs[sid]);
    return okSign(sid) && x && ((x.pred === 'related' && x.when !== 'never' && read(x.a, x.rel, x.b)[0] === ta) || (x.pred === 'crimeFact' && x.key === 'motive' && !x.not));
  }).sort();
  const means = Object.keys(A.signs).filter(sid => { const x = claimOf(A.signs[sid]); return okSign(sid) && x && CULPRIT_PREDICATES.has(x.pred) && !x.not; }).sort();
  const pil = pillarSigns(c, A);
  const pd = k => pil[k].length ? Math.min(...pil[k].map(x => A.eff[x])) : null;
  if (requirePillars && !pil.motive.length) errs.push("no reachable, true evidence of the culprit's MOTIVE (a related claim with a = the culprit, linked to the victim)");
  if (requirePillars && !pil.means.length) errs.push("no reachable, true evidence of the culprit's MEANS (a had or hasTrait claim about the culprit, or a culpritHad or culpritTrait claim the culprit satisfies)");
  if (errs.length) return { ok: false, errors: errs, A };
  const unbacked = unbackedAccounts(c);
  if (requireBacking && unbacked.length) {
    errs.push(`accounts not backed by the true history (an event the speaker took part in or saw, or something they knew): ${JSON.stringify(unbacked)}; add the event, the speaker to it, or a 'knows' attitude and cite it in 'because'`);
    return { ok: false, errors: errs, A };
  }
  const pillars = { opportunity: solve, means: pd('means'), motive: pd('motive') };
  return { ok: true, A, solveDepth: solve, maxDepth: maxd, surface, threads, motive, means, pillars, pillarSigns: pil, unbacked,
           mmoDepth: Math.max(...Object.values(pillars).filter(v => v != null)),
           twist: !surface.includes(q.truth), key, herrings,
           falseSigns: Object.entries(A.truthval).filter(([, v]) => v === false).map(([k]) => k).sort() };
}

/** JSON-safe summary of a certification report (drops the analysis internals). */
export function summarize(r) {
  if (!r.ok) return { ok: false, errors: r.errors };
  const { A, ...rest } = r;
  return { ...rest, depths: A.eff };
}
