// The morning director (docs/living-village.md). One model call plans the next hour for everyone in a generated case,
// reasoning over the whole story; three critics check it before anything happens:
//   1. code (morning.check): who can act, places, walking times, cited knowledge, concealment rules
//   2. a model, for what is said in each meeting: no new facts, nothing the speaker does not know
//   3. the certifying kernel, for each concealment: the case must still certify without that clue (and anything that
//      depends on it), so at least one playable solution remains
// What fails is dropped (that person keeps to their routine); what passes is installed as an event and replays exactly.
import {runtimeFor, copy, exportSession, diagnostics} from './engine.mjs';
import {certify} from './mk/kernel.mjs';
import {llmConfig, parseJsonLoose} from './llm.mjs';
import * as Morning from './morning.mjs';

export const EVERY = 15;          // minutes of game time between plans
export const SOONEST = 5;         // after something significant, re-plan once at least this long has passed

export const DIRECTOR_PROMPT = `You direct the morning in a 1932 English village mystery while a detective investigates a death. You get the whole story so far: every person in the case, what each of them really did last night and this morning (their private history), what they want, fear and hide, what they have told the detective, what the detective has asked or shown them, and what they have heard from others today; plus the map and where everyone is now.

Plan the next half hour for the two to five people the detective's progress affects most (see each person's 'stakes': someone whose own things lie where the detective has been, and who has reason to fear them, is affected most). Leave everyone else out: they simply carry on where they are. For each, choose what that person would really do now, given what they know and what the detective has just been doing: a worried person seeks out someone they trust or someone who shares their secret; someone who has heard something passes it on; someone with work goes to it; someone with something to hide, whose things lie where the detective has been, will usually try to move one out of the way before it is found (only a clue in their 'concealable' list, citing a fear or intent of theirs as the reason; the game checks the case stays solvable, so you need not hold back). 'earlierThisMorning' is what came of your previous plans: build on it, never repeat a meeting that has happened. Let the story move: people who were questioned talk about it; two people who told the detective the same story (one covering for the other) seek each other out to make sure it holds, saying only what they told the detective; and secrets make people act. Someone who has not been questioned yet may still have their own reasons to go somewhere (their private history and fears are reasons to act, never things to say). Be true to each person: their fears and wants drive them, and they act only on what they know.

Steps (at most three per person, in order):
  {"kind":"go","place":"<place id>","because":["<knowledge id>"]}
  {"kind":"stay","until":<minute>,"because":[...]}
  {"kind":"meet","with":"<person id>","place":"<place id>","say":"<one or two sentences>","because":[...]}
  {"kind":"conceal","clue":"<clue id from that person's concealable list>","because":["<their attitude id: the reason>"]}
Nobody hides anything in front of the detective or the constable. People react only to what they themselves know (their own lists): the detective's whereabouts and finds are yours to see, not theirs, unless their lists say so. Every step cites ids from THAT person's own knowledge list. What someone says in a meeting must cite ONLY 'sayable' ids: what they told the detective, what the detective asked or showed them, what they heard or saw today. Never their private history, never a new fact, never what they could not know. A liar may repeat their own story, not improve it. Times are minutes after midnight; the plan covers the next half hour, ending at the given 'until'. If 'trigger' says something just happened, the people it concerns react to it first. If 'previous_attempt' is given, some of its steps were rejected for the reasons in 'rejected': plan again without those faults.

Return ONLY JSON: {"agendas": {"<person id>": [steps]}, "why": "<one short line>"}.`;

export const LINE_CRITIC = `You check what people say to each other in a village mystery. Each item gives the speaker, whom they speak to, what they say, and the knowledge it rests on: all of it is what the speaker knows, and telling it to someone who has not heard it yet is the point (that is how news travels). Reject an item if it states a fact not in that knowledge, claims to know something the speaker could not know, or tells a lie better than the speaker's own story. Each item also lists what the speaker knows privately (their secrets, their reasons, what they did and arranged): reject an item that reveals or hints at any of it, even to a confidant, because whatever is said is passed on. Repeating, paraphrasing, guessing aloud, worrying, or asking are fine. Return ONLY JSON: {"verdicts": {"<id>": {"ok": true|false, "why": "<short>"}}}.`;

const arr = v => Array.isArray(v) ? v : [];

// Everything the model sees: the story, each person's knowledge with ids, the map, where everyone is.
export function context(s) {
  const r = runtimeFor(s), kc = s.world.caseRecords, ctx = r.behavior.morningCtx;
  const now = s.world.minute, actors = Morning.actors(s, kc, ctx.roles, ctx.victim);
  const people = Object.fromEntries(Object.keys(s.world.npcs).map(pid => {
    const p = ctx.people[pid], a = s.world.npcs[pid], k = Morning.knowledge(s, kc, pid, ctx.people, ctx.places);
    // what is at stake for them, as far as they know: clues of theirs where they saw the detective search or where the
    // detective is with them now, and the stories they told
    const seenAt = new Set([...(Morning.witnessed(s, ctx.people).searched[pid] ?? [])]);
    if (!a.travel && a.location === s.world.player.location) seenAt.add(a.location);
    const near = Morning.concealable(s, kc, pid).filter(id => seenAt.has(kc.signs.find(x => x.id === id)?.at)).map(id => r.CLUES[id]?.title);
    const told = s.events.filter(e => e.kind === 'speech' && e.actor === pid && e.data?.listener === 'player').length;
    const stakes = [told ? `questioned ${told} time(s)` : 'not yet questioned', ...(near.length ? [`the detective has been where these of theirs lie: ${near.join(', ')}`] : [])];
    return [pid, {name: p.name, role: p.role, voice: p.voice, at: a.travel ? `walking to ${a.travel.to}` : a.location, stakes,
      canAct: actors.includes(pid), concealable: Morning.concealable(s, kc, pid).map(id => ({id, what: r.CLUES[id]?.title, at: kc.signs.find(x => x.id === id)?.at})),
      private: k.private, sayable: k.sayable}];
  }));
  const places = Object.fromEntries(Object.entries(ctx.places).map(([id, l]) => [id, {name: l.name, walk: Object.fromEntries(Object.keys(ctx.places).map(o => [o, ctx.distance(id, o)]))}]));
  const detective = {at: s.world.player.location, found: s.world.player.evidence.map(e => r.CLUES[e.clue]?.title)};
  // what came of the plans so far this morning (so the next plan moves on rather than repeating itself)
  const earlier = Object.fromEntries(Object.entries(s.world.flags.morning?.agendas ?? {}).map(([pid, st]) =>
    [pid, st.map(x => `${x.kind}${x.with ? ' ' + x.with : ''} at ${x.place}${x.say ? `: “${x.say}”` : ''}${x.clue ? ' ' + x.clue : ''} (${x.state}${x.why ? ', ' + x.why : ''})`)]));
  return {now, until: now + Morning.HORIZON, trigger: Morning.significant(s, kc, ctx) ?? null, victim: ctx.people[ctx.victim]?.name ?? ctx.victim, constable: ctx.roles.constable, detective,
    earlierThisMorning: earlier, places, people};
}

// Critic 3: a concealment is allowed only if the case still certifies without the clue and what depends on it.
export function stillSolvable(kc, clues) {
  const gone = new Set(clues);
  for (let more = true; more;) {
    more = false;
    for (const x of kc.signs) if (!gone.has(x.id) && [...arr(x.requires), ...arr(x.needs)].some(r => gone.has(r))) { gone.add(x.id); more = true; }
  }
  const d = structuredClone(kc);
  d.signs = d.signs.filter(x => !gone.has(x.id));
  for (const x of d.signs) for (const f of ['defeats', 'explainedBy']) if (x[f]) x[f] = x[f].filter(r => !gone.has(r));
  const r = certify(d, true, true);
  return {ok: r.ok, errors: r.errors ?? [], removed: [...gone]};
}

// Apply all three critics; return the plan that survives (dropping only what failed) and an audit.
export async function criticise(s, proposal, {lineCritic}) {
  const r = runtimeFor(s), kc = s.world.caseRecords, ctx = r.behavior.morningCtx;
  const code = Morning.check(s, kc, ctx, proposal);
  // keep each person's steps up to the first that fails the code critic (check already does this per person)
  const plan = copy(code.plan), audit = {code: code.errors, lines: {}, solvable: {}};
  // critic 3: concealments, cumulatively with ones already done
  const done = s.world.flags.morning?.concealed ?? [];
  let hidden = [...done];
  for (const [pid, steps] of Object.entries(plan)) {
    const i = steps.findIndex(x => x.kind === 'conceal');
    if (i < 0) continue;
    const v = stillSolvable(kc, [...hidden, steps[i].clue]);
    audit.solvable[`${pid}:${steps[i].clue}`] = v.ok ? 'still solvable' : v.errors[0];
    if (v.ok) hidden.push(steps[i].clue); else plan[pid] = steps.slice(0, i);
  }
  // critic 2: what is said
  const items = {};
  for (const [pid, steps] of Object.entries(plan)) for (const [i, x] of steps.entries()) if (x.kind === 'meet') {
    const k = Morning.knowledge(s, kc, pid, ctx.people, ctx.places), all = [...k.private, ...k.sayable];
    items[`${pid}:${i}`] = {speaker: ctx.people[pid].name, says: x.say, to: ctx.people[x.with].name, knowledge: x.because.map(c => all.find(y => y.id === c)?.text).filter(Boolean),
      // what they must not let slip (a meeting cites only what they may say; the code critic refused any other): the hearer
      // may repeat the line to anyone, the detective included
      private: k.private.map(y => y.text)};
  }
  if (Object.keys(items).length) {
    const verdicts = (await lineCritic(items))?.verdicts ?? {};
    for (const [key, v] of Object.entries(items)) {
      const ok = verdicts[key]?.ok === true;
      audit.lines[key] = ok ? 'ok' : (verdicts[key]?.why ?? 'no verdict');
      if (!ok) { const [pid, i] = key.split(':'); plan[pid] = plan[pid].slice(0, Number(i)); }
    }
  }
  for (const pid of Object.keys(plan)) if (!plan[pid].length) delete plan[pid];
  // everyone the director planned for who can act, whatever survived
  const free = new Set(Morning.actors(s, kc, ctx.roles, ctx.victim));
  const replanned = Object.keys(proposal?.agendas && typeof proposal.agendas === 'object' ? proposal.agendas : {}).filter(p => free.has(p));
  return {plan, audit, replanned};
}

// One detached planning round: only with AI on, at most every EVERY minutes, committed only if the session is unchanged.
export async function directMorning(session, {fetchImpl = globalThis.fetch, signal, timeoutMs = 45000, endpoint = llmConfig().endpoint} = {}) {
  const r = runtimeFor(session);
  if (!r.CASE?.kernel || !r.behavior?.morningCtx || session.world.status === 'solved') return {status: 'not_needed'};
  // on the clock every EVERY minutes; sooner (after SOONEST) when something has happened that people would react to
  const last = session.world.flags.morning?.last, since = last == null ? Infinity : session.world.minute - last;
  const reason = since >= EVERY ? 'time' : since >= SOONEST ? Morning.significant(session, session.world.caseRecords, r.behavior.morningCtx) : null;
  if (!reason) return {status: 'not_needed'};
  if (session.world.minute < (session.world.caseRecords.setting?.day?.start ?? 0)) return {status: 'not_needed'};
  const base = exportSession(session), ctxt = context(session);
  const call = async (role, system, prompt, max_tokens) => {
    const res = await fetchImpl(endpoint, {method: 'POST', signal, headers: {'content-type': 'application/json', 'X-Living-Mystery': 'character-v1'},
      body: JSON.stringify({role, system, prompt: JSON.stringify(prompt), max_tokens})});
    if (!res.ok) throw Error(`director unavailable (${res.status})`);
    return parseJsonLoose((await res.json()).text);
  };
  const timer = new Promise((_, no) => setTimeout(() => no(Error('director timed out')), timeoutMs));
  let proposal, result, audit = {};
  try {
    proposal = await Promise.race([call('director', DIRECTOR_PROMPT, ctxt, 1500), timer]);
    // the code critic's reasons go back once, so a fault (a meeting resting on private history, say) is mended, not just cut
    const first = Morning.check(session, session.world.caseRecords, r.behavior.morningCtx, proposal);
    if (first.errors.length) {
      const again = await Promise.race([call('director', DIRECTOR_PROMPT, {...ctxt, previous_attempt: proposal, rejected: first.errors}, 1500), timer]).catch(() => null);
      if (again?.agendas) { audit.revised = first.errors; proposal = again; }
    }
    result = await Promise.race([criticise(session, proposal ?? {}, {lineCritic: items => call('line_critic', LINE_CRITIC, items, 800)}), timer]);
    audit = {trigger: reason, why: proposal?.why ?? '', ...(audit.revised ? {revised: audit.revised} : {}), ...result.audit};
  } catch (e) {
    if (signal?.aborted || exportSession(session) !== base) return {status: 'stale'};
    result = {plan: {}}; audit = {error: String(e.message).slice(0, 200)};
  }
  if (signal?.aborted || exportSession(session) !== base) return {status: 'stale'};
  const trial = copy(session);
  const decided = Morning.install(r.kernel, trial, result.plan, trial.events.at(-1)?.id, audit, result.replanned ?? Object.keys(result.plan));
  // a plan starts when it is made, not at the next periodic decision (which can be ten minutes off)
  for (const pid of Object.keys(result.plan)) if (!trial.world.npcs[pid]?.travel) r.kernel.decide(trial, pid, decided);
  if (!diagnostics(trial).ok) return {status: 'rejected'};
  session.events = trial.events; session.world = trial.world;
  return {status: Object.keys(result.plan).length ? 'accepted' : 'empty', plan: result.plan, audit};
}
