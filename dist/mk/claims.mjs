// Claims, version 2: the temporal language of clues, their truth in the history, and reasoning from what the player
// knows. Specification: docs/claims.md. Python twin: tools/refine-c/claims.py (tools/refine-c/parity.py keeps them
// identical); reference semantics in Z3: server/case_oracle.py.
//
// Pure ES module, no dependencies (runs in the browser and in Node).

export const CLAIMS_VERSION = 2;
const INF = 1e9;
const arr = v => (Array.isArray(v) ? v : []);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// Python-compatible stringification for value comparison (traits may be strings, numbers or booleans).
export const pyStr = v => v === true ? 'True' : v === false ? 'False' : v == null ? 'None' : String(v);

// Predicate -> required arguments (besides from, to, when, not).
export const PREDICATES = {
  wasAt: ['person', 'place'], had: ['person', 'item'], related: ['a', 'rel', 'b'], hasTrait: ['person', 'trait', 'value'],
  nobodyAt: ['place'], onlyHad: ['item', 'people'], crimeBetween: [], crimeFact: ['key', 'value'],
  culpritHad: ['item'], culpritRelated: ['rel', 'b'], culpritTrait: ['trait', 'value'],
};
const FLUENT = new Set(['wasAt', 'had', 'related', 'hasTrait']);                     // take an interval and a mode
const NEGATABLE = new Set(['crimeFact', 'culpritHad', 'culpritRelated', 'culpritTrait']);
const NEEDS_INTERVAL = new Set(['wasAt', 'nobodyAt', 'crimeBetween']);
const WHEN = new Set(['throughout', 'sometime', 'never']);
export const CULPRIT_PREDICATES = new Set(['culpritHad', 'culpritRelated', 'culpritTrait']);

export function claimOf(sign) {
  const x = sign?.claim;
  return x && typeof x === 'object' && !Array.isArray(x) && own(PREDICATES, x.pred) ? x : null;
}

// ---------------------------------------------------------------------------------------------------
// The setting and the case's vocabulary
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

/** Minutes that must separate two different values of a fluent: the walk between places, otherwise one minute. */
const separation = (tt, metric) => (x, y) => x === y ? 0 : metric ? Math.max(1, tt[x]?.[y] ?? INF) : 1;

/** The case's span: from the first event's start to the last event's end (the default interval of a fluent claim). */
export function span(c) {
  const evs = arr(c.events);
  return evs.length ? [Math.min(...evs.map(e => e.start)), Math.max(...evs.map(e => e.end))] : [0, 0];
}

/** Reads a relation in its declared direction: an inverse name is turned round. */
export function relationReader(c) {
  const inverse = {};
  for (const r of arr(c.vocabulary?.relations)) if (r.inverse) inverse[r.inverse] = r.rel;
  return (a, rel, b) => own(inverse, rel) ? [b, inverse[rel], a] : [a, rel, b];
}

const isSupply = (c, item) => Boolean(arr(c.objects).find(o => o.id === item)?.supply);
export const crimeEvent = c => arr(c.events).find(e => e.id === c.question?.crime?.event) ?? null;
export const crimeMinute = c => crimeEvent(c)?.start ?? null;
export const actorOf = h => (h?.facts || {}).actor;
export const truthActor = c => actorOf(arr(c.question?.candidates).find(h => h.id === c.question.truth));
export const victimOf = c => c.victim || arr(c.events).find(e => e.type === 'death' && e.agent)?.agent || null;

/** The claim's interval: its own, or the case's span. */
function interval(c, x) {
  const [s0, s1] = span(c);
  return [typeof x.from === 'number' ? x.from : s0, typeof x.to === 'number' ? x.to : s1];
}

// ---------------------------------------------------------------------------------------------------
// Validation of claims and of the records they are judged against
// ---------------------------------------------------------------------------------------------------

/** Errors in one sign's claim (empty when it is well formed). */
export function claimErrors(c, sid, x) {
  const errs = [], people = new Set(arr(c.people).map(p => p.id)), places = new Set(c.setting.places.map(p => p.id));
  const items = new Set(arr(c.objects).map(o => o.id)), rels = new Set(arr(c.vocabulary?.relations).flatMap(r => [r.rel, r.inverse].filter(Boolean)));
  const err = m => errs.push(`sign ${sid}: ${x.pred} claim ${m}`);
  for (const a of PREDICATES[x.pred]) if (x[a] == null || x[a] === '') err(`needs '${a}'`);
  if (errs.length) return errs;
  for (const k of ['person', 'a']) if (x[k] != null && !people.has(x[k])) err(`names unknown person ${x[k]}`);
  // the other party of a relation may be a person, a thing or a place (a debt to the building society)
  if (x.b != null && !people.has(x.b) && !items.has(x.b) && !places.has(x.b)) err(`names ${x.b}, which is not a person, object or place of the case`);
  if (x.pred === 'onlyHad') for (const p of arr(x.people)) if (!people.has(p)) err(`names unknown person ${p}`);
  if (x.place != null && !places.has(x.place)) err(`names unknown place ${x.place}`);
  if (x.item != null && !items.has(x.item)) err(`names ${x.item}, which is not among the case's objects`);
  if (x.rel != null && !rels.has(x.rel)) err(`uses relation ${x.rel}, which is not in vocabulary.relations`);
  if (x.pred === 'onlyHad' && !Array.isArray(x.people)) err(`needs 'people' as a list`);
  const has = k => typeof x[k] === 'number';
  if (NEEDS_INTERVAL.has(x.pred) && !(has('from') && has('to'))) err(`needs 'from' and 'to' (minutes)`);
  if ((x.from != null && !has('from')) || (x.to != null && !has('to'))) err(`has non-numeric 'from' or 'to'`);
  if (has('from') && has('to') && x.from > x.to) err(`ends before it starts`);
  if (x.when != null && !(FLUENT.has(x.pred) && WHEN.has(x.when))) err(`'when' must be throughout, sometime or never, on ${[...FLUENT].join(', ')}`);
  if (x.not != null && !(NEGATABLE.has(x.pred) && typeof x.not === 'boolean')) err(`'not' is allowed only on ${[...NEGATABLE].join(', ')}`);
  return errs;
}

/** Errors in the records claims are judged against: objects, holdings, relations, effects and the crime's facts. */
export function recordErrors(c) {
  const errs = [], people = new Set(arr(c.people).map(p => p.id)), items = new Set(arr(c.objects).map(o => o.id));
  const rels = new Set(arr(c.vocabulary?.relations).flatMap(r => [r.rel, r.inverse].filter(Boolean)));
  const held = {};
  for (const h of arr(c.holdings)) {
    if (!people.has(h.person)) errs.push(`holdings: unknown person ${h.person}`);
    if (!items.has(h.item)) errs.push(`holdings: ${h.item} is not among the case's objects`);
    (held[h.item] ??= []).push(h.person);
  }
  for (const [i, ps] of Object.entries(held))
    if (ps.length > 1 && !isSupply(c, i)) errs.push(`holdings: ${i} is a single object but is held by ${ps.join(' and ')}; mark it "supply": true if many may have it`);
  for (const r of arr(c.relations)) if (!rels.has(r.rel)) errs.push(`relations: ${r.rel} is not in vocabulary.relations`);
  for (const e of arr(c.events)) for (const f of arr(e.effects)) {
    const keys = Object.keys(f).sort().join(',');
    const ok = {take: 'take', give: 'give,to', lose: 'lose', relate: 'relate,to', trait: 'trait,value'};
    const kind = Object.keys(ok).find(k => own(f, k));
    if (!kind || keys !== ok[kind]) { errs.push(`event ${e.id}: effect ${JSON.stringify(f)} must be one of {take}, {give, to}, {lose}, {relate, to}, {trait, value}`); continue; }
    if (!e.agent) errs.push(`event ${e.id}: an effect needs the event's agent`);
    if (['take', 'give', 'lose'].includes(kind) && !items.has(f[kind])) errs.push(`event ${e.id}: ${f[kind]} is not among the case's objects`);
    if (f.to != null && !people.has(f.to)) errs.push(`event ${e.id}: effect names unknown person ${f.to}`);
    if (kind === 'relate' && !rels.has(f.relate)) errs.push(`event ${e.id}: relation ${f.relate} is not in vocabulary.relations`);
  }
  const crime = crimeEvent(c), truth = arr(c.question?.candidates).find(h => h.id === c.question?.truth);
  if (crime && truth) for (const [k, v] of Object.entries(truth.facts || {})) {
    if (k === 'actor') continue;
    if (!own(crime.facts || {}, k)) errs.push(`crime event ${crime.id}: its facts must give '${k}' (the true candidate's ${k} is ${pyStr(v)})`);
    else if (pyStr(crime.facts[k]) !== pyStr(v)) errs.push(`crime event ${crime.id}: its ${k} is ${pyStr(crime.facts[k])}, but the true candidate's is ${pyStr(v)}`);
  }
  if (crime && c.question.crime.window && !(c.question.crime.window[0] <= crime.start && crime.start <= c.question.crime.window[1]))
    errs.push(`the crime event starts at ${crime.start}, outside the crime window`);
  return errs;
}

// ---------------------------------------------------------------------------------------------------
// The history: fluents read from the records (docs/claims.md section 3)
// ---------------------------------------------------------------------------------------------------

// A timeline is a sorted list of [from, value]: the value holds from that minute until the next entry.
function timeline(initial, changes) {
  const tl = [[-INF, initial]];
  for (const [m, v] of [...changes].sort((p, q) => p[0] - q[0])) {
    if (tl[tl.length - 1][0] === m) tl[tl.length - 1][1] = v; else tl.push([m, v]);
  }
  return tl;
}
function valuesIn(tl, s, e) {
  const out = new Set();
  for (let i = 0; i < tl.length; i++) {
    const from = tl[i][0], to = i + 1 < tl.length ? tl[i + 1][0] - 1 : INF;
    if (from <= e && to >= s) out.add(tl[i][1]);
  }
  return out;
}
const valueAt = (tl, m) => valuesIn(tl, m, m).values().next().value;

function mergeIntervals(iv) {
  const out = [];
  for (const [s, e] of [...iv].filter(([s, e]) => s <= e).sort((p, q) => p[0] - q[0] || p[1] - q[1])) {
    if (out.length && s <= out[out.length - 1][1] + 1) out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    else out.push([s, e]);
  }
  return out;
}
const covers = (iv, s, e) => mergeIntervals(iv).some(([a, b]) => a <= s && e <= b);
const meets = (iv, s, e) => iv.some(([a, b]) => a <= e && b >= s);

/** Everything the claims are judged against, read once from the records. */
export function history(c, tt = travelTable(c)) {
  const sep = separation(tt, true), victim = victimOf(c), byPerson = {};
  for (const ev of arr(c.events)) for (const p of [ev.agent, ...arr(ev.others)]) if (p) (byPerson[p] ??= []).push(ev);
  const certain = {}, possible = {};
  for (const p of arr(c.people).map(x => x.id)) {
    const evs = arr(byPerson[p]).slice().sort((x, y) => x.start - y.start || x.end - y.end);
    const cert = evs.map(e => [e.start, e.end, e.place]);
    for (let i = 0; i + 1 < evs.length; i++) if (evs[i].place === evs[i + 1].place) cert.push([evs[i].end + 1, evs[i + 1].start - 1, evs[i].place]);
    if (p === victim && evs.length) cert.push([evs[evs.length - 1].end + 1, INF, evs[evs.length - 1].place]);
    certain[p] = cert;
    // where they may be in the undetermined minutes: before the first event, between events at different places,
    // after the last: any place they could reach and still keep to their events
    possible[p] = l => {
      const iv = cert.filter(x => x[2] === l).map(([s, e]) => [s, e]);
      if (!evs.length) return [[-INF, INF]];
      const first = evs[0], last = evs[evs.length - 1];
      iv.push([-INF, first.start - sep(l, first.place) - (l === first.place ? 1 : 0)]);
      for (let i = 0; i + 1 < evs.length; i++) {
        const x = evs[i].place, y = evs[i + 1].place, e1 = evs[i].end, s2 = evs[i + 1].start;
        if (x === y) continue;
        iv.push(l === x ? [e1 + 1, s2 - sep(x, y)] : l === y ? [e1 + sep(x, y), s2 - 1] : [e1 + sep(x, l), s2 - sep(l, y)]);
      }
      if (p !== victim) iv.push([last.end + (l === last.place ? 1 : sep(last.place, l)), INF]);
      return mergeIntervals(iv);
    };
  }
  const read = relationReader(c), events = arr(c.events), people = arr(c.people);
  const effects = kind => events.flatMap(ev => arr(ev.effects).filter(f => own(f, kind)).map(f => ({ev, f})));
  const holder = item => timeline(arr(c.holdings).find(h => h.item === item)?.person ?? null, [
    ...effects('take').filter(({f}) => f.take === item).map(({ev}) => [ev.start, ev.agent]),
    ...effects('give').filter(({f}) => f.give === item).map(({ev, f}) => [ev.end + 1, f.to]),
    ...effects('lose').filter(({f}) => f.lose === item).map(({ev}) => [ev.end + 1, null])]);
  const access = (p, item) => timeline(arr(c.holdings).some(h => h.item === item && h.person === p), [
    ...effects('take').filter(({ev, f}) => f.take === item && ev.agent === p).map(({ev}) => [ev.start, true]),
    ...effects('give').filter(({f}) => f.give === item && f.to === p).map(({ev}) => [ev.end + 1, true]),
    ...effects('lose').filter(({ev, f}) => f.lose === item && ev.agent === p).map(({ev}) => [ev.end + 1, false])]);
  const related = (a, rel, b) => {
    const key = read(a, rel, b).join('|');
    return timeline(arr(c.relations).some(r => read(r.a, r.rel, r.b).join('|') === key),
      effects('relate').filter(({ev, f}) => read(ev.agent, f.relate, f.to).join('|') === key).map(({ev}) => [ev.start, true]));
  };
  const trait = (p, k) => timeline(pyStr((people.find(x => x.id === p)?.traits || {})[k]),
    effects('trait').filter(({ev, f}) => ev.agent === p && f.trait === k).map(({ev, f}) => [ev.end + 1, pyStr(f.value)]));
  return {certain, possible, holder, access, related, trait, people: people.map(p => p.id), tt};
}

const mode = (vals, target, when) => when === 'throughout' ? vals.size === 1 && vals.has(target)
  : when === 'never' ? !vals.has(target) : vals.has(target);

/** Truth of a claim in the history: true, false, or null when the history does not decide it. culprit: whom the
 *  culprit predicates are read about (default the true culprit; another person to ask whether they satisfy them). */
export function truthOf(c, H, x, culprit = truthActor(c)) {
  const [s, e] = interval(c, x), when = x.when ?? 'throughout', t = crimeMinute(c);
  const neg = v => (v === null ? null : x.not ? !v : v);
  switch (x.pred) {
    case 'wasAt': {
      const cert = arr(H.certain[x.person]).filter(q => q[2] === x.place).map(([a, b]) => [a, b]), poss = H.possible[x.person]?.(x.place) ?? [];
      const some = meets(cert, s, e) ? true : !meets(poss, s, e) ? false : null;
      if (when === 'throughout') return covers(cert, s, e) ? true : !covers(poss, s, e) ? false : null;
      return when === 'never' ? (some === null ? null : !some) : some;
    }
    case 'nobodyAt': {
      if (H.people.some(p => meets(arr(H.certain[p]).filter(q => q[2] === x.place).map(([a, b]) => [a, b]), s, e))) return false;
      return H.people.every(p => !meets(H.possible[p](x.place), s, e)) ? true : null;
    }
    case 'had': return mode(isSupply(c, x.item) ? valuesIn(H.access(x.person, x.item), s, e) : valuesIn(H.holder(x.item), s, e),
      isSupply(c, x.item) ? true : x.person, when);
    case 'onlyHad': return isSupply(c, x.item)
      ? H.people.filter(p => !arr(x.people).includes(p)).every(p => !valuesIn(H.access(p, x.item), s, e).has(true))
      : [...valuesIn(H.holder(x.item), s, e)].every(v => v === null || arr(x.people).includes(v));
    case 'related': return mode(valuesIn(H.related(x.a, x.rel, x.b), s, e), true, when);
    case 'hasTrait': return mode(valuesIn(H.trait(x.person, x.trait), s, e), pyStr(x.value), when);
    case 'crimeBetween': return t !== null && x.from <= t && t <= x.to;
    case 'crimeFact': {
      const facts = crimeEvent(c)?.facts || {};
      return own(facts, x.key) ? neg(pyStr(facts[x.key]) === pyStr(x.value)) : null;
    }
    case 'culpritHad': {
      const [a, b] = typeof x.from === 'number' ? [x.from, x.to] : [t, t];
      return neg(isSupply(c, x.item) ? valuesIn(H.access(culprit, x.item), a, b).has(true) : valuesIn(H.holder(x.item), a, b).has(culprit));
    }
    case 'culpritRelated': return neg(valueAt(H.related(culprit, x.rel, x.b), t) === true);
    case 'culpritTrait': return neg(valueAt(H.trait(culprit, x.trait), t) === pyStr(x.value));
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Reasoning from what the player knows (docs/claims.md sections 4 to 6)
// ---------------------------------------------------------------------------------------------------
//
// Each fluent instance collects anchors {s, e, value, sid, witness} (the fluent has the value throughout [s, e];
// a witness is one minute somewhere in [s, e]) and forbidden intervals {s, e, value, sid}. 'T' stands for the
// crime minute until it is fixed.

const T = 'T';

/** Constraint instances from trusted claims [[sid, claim], ...], with culprit(h) when actor is given. */
export function instances(c, trusted, actor = null, scene = c.question.crime.place) {
  const inst = new Map(), between = [], facts = [], read = relationReader(c), people = arr(c.people).map(p => p.id);
  const get = (key, metric = false) => { if (!inst.has(key)) inst.set(key, {key, metric, pos: [], neg: []}); return inst.get(key); };
  // hyp marks what culprit(h) adds, so that the instances it touches are checked for each crime minute
  const add = (key, metric, sid, kind, value, s, e, witness = false, hyp = false) =>
    get(key, metric)[kind === 'pos' ? 'pos' : 'neg'].push(kind === 'pos' ? {s, e, value, sid, witness, hyp} : {s, e, value, sid, hyp});
  const fluent = (key, metric, sid, value, s, e, when) =>
    when === 'never' ? add(key, metric, sid, 'neg', value, s, e) : add(key, metric, sid, 'pos', value, s, e, when === 'sometime');
  const holding = (item, p) => isSupply(c, item) ? [`has:${p}:${item}`, true] : [`holder:${item}`, p];
  for (const [sid, x] of trusted) {
    const [s, e] = interval(c, x), when = x.when ?? 'throughout';
    switch (x.pred) {
      case 'wasAt': fluent(`at:${x.person}`, true, sid, x.place, s, e, when); break;
      case 'nobodyAt': for (const p of people) add(`at:${p}`, true, sid, 'neg', x.place, s, e); break;
      case 'had': { const [k, v] = holding(x.item, x.person); fluent(k, false, sid, v, s, e, when); break; }
      case 'onlyHad': for (const p of people.filter(q => !arr(x.people).includes(q))) { const [k, v] = holding(x.item, p); add(k, false, sid, 'neg', v, s, e); } break;
      case 'related': fluent(`rel:${read(x.a, x.rel, x.b).join(':')}`, false, sid, true, s, e, when); break;
      case 'hasTrait': fluent(`trait:${x.person}:${x.trait}`, false, sid, pyStr(x.value), s, e, when); break;
      case 'crimeBetween': between.push([sid, x.from, x.to]); break;
      case 'crimeFact': facts.push([sid, x]); break;
      default: if (actor) {
        // culprit predicates: about the actor at the crime minute (culpritHad may name an interval instead)
        const [key, value] = x.pred === 'culpritHad' ? holding(x.item, actor)
          : x.pred === 'culpritRelated' ? [`rel:${read(actor, x.rel, x.b).join(':')}`, true] : [`trait:${actor}:${x.trait}`, pyStr(x.value)];
        const ranged = x.pred === 'culpritHad' && typeof x.from === 'number';
        if (x.not) add(key, false, sid, 'neg', value, ranged ? x.from : T, ranged ? x.to : T, false, true);
        else add(key, false, sid, 'pos', value, ranged ? x.from : T, ranged ? x.to : T, ranged, true);
      }
    }
  }
  if (actor) add(`at:${actor}`, true, 'culprit', 'pos', scene, T, T, false, true);
  return {inst, between, facts};
}

const fixT = (inst, t) => ({...inst, pos: inst.pos.map(a => a.s === T ? {...a, s: t, e: t} : a), neg: inst.neg.map(n => n.s === T ? {...n, s: t, e: t} : n)});
const touchedByHypothesis = inst => inst.pos.some(a => a.hyp) || inst.neg.some(n => n.hyp);

function subtract(iv, blocks) {
  let out = iv;
  for (const [bs, be] of blocks) out = out.flatMap(([s, e]) => be < s || bs > e ? [[s, e]] : [[s, bs - 1], [be + 1, e]].filter(([a, b]) => a <= b));
  return out;
}

/** Can the instance's anchors all hold together under the background laws? (t already fixed) */
export function satisfiable(inst, tt) {
  const sep = separation(tt, inst.metric), fixed = inst.pos.filter(a => !a.witness), wit = inst.pos.filter(a => a.witness);
  for (let i = 0; i < fixed.length; i++) for (let j = i + 1; j < fixed.length; j++) {
    const a = fixed[i], b = fixed[j], d = sep(a.value, b.value);
    if (a.value !== b.value && !(b.s >= a.e + d || a.s >= b.e + d)) return false;
  }
  for (const a of fixed) for (const n of inst.neg) if (n.value === a.value && !(a.e < n.s || a.s > n.e)) return false;
  if (!wit.length) return true;
  // where each witness may fall, given the fixed anchors and the forbidden intervals
  const allowed = wit.map(w => subtract([[w.s, w.e]], [
    ...fixed.filter(f => f.value !== w.value).map(f => [f.s - sep(f.value, w.value) + 1, f.e + sep(f.value, w.value) - 1]),
    ...inst.neg.filter(n => n.value === w.value).map(n => [n.s, n.e])]));
  if (allowed.some(a => !a.length)) return false;
  const earliest = (k, lb) => { for (const [s, e] of allowed[k]) if (e >= lb) return Math.max(s, lb); return null; };
  // witnesses in time order: the earliest placement of each subset ending in a given witness dominates (walking
  // times are a metric, so separating consecutive witnesses is enough)
  const n = wit.length, best = new Map();
  for (let k = 0; k < n; k++) { const m = earliest(k, -INF); if (m !== null) best.set(`${1 << k}:${k}`, m); }
  for (let mask = 1; mask < 1 << n; mask++) for (let last = 0; last < n; last++) {
    const cur = best.get(`${mask}:${last}`);
    if (cur === undefined) continue;
    if (mask === (1 << n) - 1) return true;
    for (let k = 0; k < n; k++) {
      if (mask & (1 << k)) continue;
      const m = earliest(k, cur + sep(wit[last].value, wit[k].value));
      const key = `${mask | (1 << k)}:${k}`;
      if (m !== null && (best.get(key) ?? INF) > m) best.set(key, m);
    }
  }
  return false;
}

/** The crime has one minute, within the case and in every crimeBetween; and one value for each fact (a candidate's own
 *  facts, when given, are values too). */
function crimeConsistent(c, between, facts, own = {}) {
  let [ws, we] = span(c);
  for (const [, s, e] of between) { ws = Math.max(ws, s); we = Math.min(we, e); }
  if (ws > we) return false;
  const pos = {}, neg = {};
  for (const [, x] of facts) ((x.not ? neg : pos)[x.key] ??= new Set()).add(pyStr(x.value));
  for (const [k, v] of Object.entries(own)) if (k !== 'actor') (pos[k] ??= new Set()).add(pyStr(v));
  return Object.entries(pos).every(([k, vs]) => vs.size <= 1 && ![...vs].some(v => neg[k]?.has(v)));
}

/** Is a set of claims [[sid, claim], ...] consistent under the background laws? (Culprit predicates are about whoever
 *  did it: if they conflict, every candidate is ruled out, which survivorsOf reports.) */
export function consistent(c, claims, tt = travelTable(c)) {
  const {inst, between, facts} = instances(c, claims);
  return crimeConsistent(c, between, facts) && [...inst.values()].every(i => satisfiable(i, tt));
}

/** Candidates h for which B, the trusted claims and culprit(h) are satisfiable (docs/claims.md section 5). */
export function survivorsOf(c, trusted, tt = travelTable(c)) {
  const base = instances(c, trusted);
  if (![...base.inst.values()].every(i => satisfiable(i, tt))) return [];
  // all the player knows of the crime's minute is that it falls within the case, and what the claims say
  let [ws, we] = span(c);
  for (const [, s, e] of base.between) { ws = Math.max(ws, s); we = Math.min(we, e); }
  return arr(c.question.candidates).filter(h => {
    if (!crimeConsistent(c, base.between, base.facts, h.facts || {})) return false;
    const a = actorOf(h);
    if (!a) return true;
    const touched = [...instances(c, trusted, a).inst.values()].filter(touchedByHypothesis);
    for (let t = ws; t <= we; t++) if (touched.every(i => satisfiable(fixT(i, t), tt))) return true;
    return false;
  }).map(h => h.id);
}

/** For the consistency law: the claims that bear on each instance (and on the crime's minute and facts), by key. */
export function instanceClaims(c, claims) {
  const out = new Map(), {inst, between, facts} = instances(c, claims);
  for (const [key, i] of inst) out.set(key, [...new Set([...i.pos, ...i.neg].map(a => a.sid))].sort());
  const crime = [...between.map(([sid]) => sid), ...facts.map(([sid]) => sid)].sort();
  if (crime.length) out.set('crime', crime);
  return out;
}

/** Maximal subsets of ids in which no sign defeats another. */
export function defeatFreeSets(ids, defeats) {
  const edge = (a, b) => arr(defeats[a]).includes(b) || arr(defeats[b]).includes(a);
  const loose = ids.filter(a => !ids.some(b => b !== a && edge(a, b))), tied = ids.filter(a => !loose.includes(a));
  if (tied.length > 16) return [ids];   // not met in practice; checking the whole set is then the conservative choice
  const sets = [];
  for (let m = 0; m < 1 << tied.length; m++) {
    const s = tied.filter((_, i) => m & (1 << i));
    if (s.some((a, i) => s.slice(i + 1).some(b => edge(a, b)))) continue;
    if (tied.some(a => !s.includes(a) && !s.some(b => edge(a, b)))) continue;   // not maximal
    sets.push([...loose, ...s].sort());
  }
  return sets;
}
