// The text interface for agent playtesting (docs/self-improvement.md, section 3).
//
// A player sees exactly what the browser shows a person: where they are, who and what is here, the questions they can
// ask, what they carry, the map, and what was just said. Handles for things, questions and evidence are opaque per
// episode, so no record id (which can carry a name or a hint) ever reaches the player. Alongside each step the game
// keeps a private trace for scoring (what the certifier knows, how each character turn went); the player never sees it.
//
// Library:  const g = await PlaytestGame.create(caseFile, {seed, store, endpoint}); g.observe(); await g.act(action)
// Server:   node tools/playtest/game.mjs   (JSON lines on stdin/stdout: {"op":"new",...} {"op":"act",...} {"op":"trace"})
import {readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {registerKernelCase, createSession, dispatch, caseTables, timeLabel, inSentence} from '../../dist/engine.mjs';
import {prepareCharacterTurn, proposeCharacterTurn, applyCharacterTurn} from '../../dist/character-turn.mjs';
import {directMorning} from '../../dist/morning-director.mjs';
import {NEUTRAL_LINE} from '../../dist/kernel.mjs';

export const ACTIONS = ['move', 'examine', 'ask', 'say', 'show', 'wait', 'hint', 'accuse', 'note', 'quit'];
const DEFAULT_BUDGET = {actions: 100, minutes: 8 * 60};
const GAME_ORIGIN = 'http://127.0.0.1:8000';

// The language-model proxy admits only the game's own origin, as the browser sends it; outside the browser we send it
// ourselves, for the proxy only.
function speakAsTheGame(endpoint) {
  const send = globalThis.fetch;
  if (send.__playtest) return;
  const wrapped = (url, init = {}) => String(url).startsWith(endpoint)
    ? send(url, {...init, headers: {...init.headers, Origin: GAME_ORIGIN}}) : send(url, init);
  wrapped.__playtest = true;
  globalThis.fetch = wrapped;
}

function proxyStore(endpoint) {
  const mem = new Map([['living-mystery.llm.endpoint', endpoint], ['living-mystery.llm.enabled', '1']]);
  return {getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v)};
}

// Opaque handles: one namespace per kind ('t' things, 'q' questions, 'e' evidence), stable for the whole episode.
class Handles {
  constructor() { this.byReal = new Map(); this.byHandle = new Map(); this.count = {}; }
  of(kind, real) {
    const key = `${kind}:${real}`;
    if (!this.byReal.has(key)) {
      const h = `${kind}${(this.count[kind] = (this.count[kind] ?? 0) + 1)}`;
      this.byReal.set(key, h); this.byHandle.set(h, real);
    }
    return this.byReal.get(key);
  }
  real(handle) { return this.byHandle.get(handle); }
}

export class PlaytestGame {
  static async create(caseFile, {seed = 17, endpoint = 'http://127.0.0.1:8787/', budget = DEFAULT_BUDGET, ai = true, director = true} = {}) {
    const records = JSON.parse(readFileSync(caseFile, 'utf8'));
    return new PlaytestGame(records, {seed, endpoint, budget, ai, director});
  }

  constructor(records, {seed, endpoint, budget, ai, director}) {
    this.records = records;
    this.s = createSession(seed, registerKernelCase(records));
    this.T = caseTables(this.s);
    this.endpoint = endpoint; this.store = proxyStore(endpoint); speakAsTheGame(endpoint);
    this.budget = budget; this.ai = ai; this.director = director;
    this.handles = new Handles();
    this.actions = 0; this.startMinute = this.s.world.minute;
    this.hint = {key: null, level: 0};
    this.trace = [];                   // private: one entry per step
    this.done = false; this.outcome = null;
    this.seen = this.s.events.length;  // transcript lines already shown
  }

  // ---- what the player sees -----------------------------------------------------------------------------------
  observe(news = []) {
    const s = this.s, T = this.T, w = s.world, at = w.player.location, B = T.behavior;
    const locked = new Set(w.flags.lockedObjects ?? []);
    const present = o => (w.flags.evidenceExpiry?.[T.OBJECTS[o]?.clue] ?? Infinity) >= w.minute;
    const held = new Set(w.player.evidence.map(e => e.clue));
    const acting = id => Boolean((w.flags.morning?.agendas?.[id] ?? []).some(x => ['pending', 'active'].includes(x.state))
      || String(w.npcs[id]?.travel?.purpose ?? '').startsWith('Morning'));
    const here = Object.entries(w.npcs).filter(([, n]) => n.location === at && !n.travel).map(([id]) => id);
    // what the game itself offers here (objectsAt): a watched person's manner travels with them
    const things = (T.objectsAt ? T.objectsAt(w, at) : T.LOCATIONS[at]?.objects ?? []).filter(o => !locked.has(o) && present(o))
      .map(o => ({id: this.handles.of('t', o), label: T.OBJECTS[o].label, examined: held.has(T.OBJECTS[o].clue)}));
    const questions = Object.fromEntries(here.map(p => [p, [...(T.CASE.topicsFor?.[p] ?? []), ...B.followupOptions(s, p)]
      .map(([topic, label]) => ({id: this.handles.of('q', `${p}|${topic}`), text: label}))]));
    const map = Object.keys(T.LOCATIONS).map(pl => ({
      place: pl, name: T.LOCATIONS[pl].name, minutes: T.distance(at, pl),
      people: Object.entries(w.npcs).filter(([, n]) => (n.travel ? null : n.location) === pl).map(([id]) => T.PEOPLE[id].name),
      unexamined: (T.LOCATIONS[pl].objects ?? []).filter(o => !locked.has(o) && present(o) && !held.has(T.OBJECTS[o].clue)).length,
      lead: (w.flags.hinted ?? []).some(o => locked.has(o) && this.records.signs.find(x => x.id === o)?.at === pl)}));
    const walking = Object.entries(w.npcs).filter(([, n]) => n.travel).map(([id, n]) => `${T.PEOPLE[id].name} is walking to ${inSentence(T.LOCATIONS[n.travel.to])}`);
    return {
      time: timeLabel(w.minute), place: at, place_name: T.LOCATIONS[at]?.name, description: T.LOCATIONS[at]?.description,
      people_here: here.map(id => ({id, name: T.PEOPLE[id].name, role: T.PEOPLE[id].role, appearance: T.PEOPLE[id].public,
        acting_on_their_own: acting(id), questions: questions[id]})),
      things_here: things,
      inventory: w.player.evidence.map(e => ({id: this.handles.of('e', e.clue), title: T.CLUES[e.clue]?.title,
        text: String(e.text ?? T.CLUES[e.clue]?.text ?? '').slice(0, 400)})),
      map, walking,
      just_happened: news,
      accusation: {heard_by: T.PEOPLE[T.CASE.constable]?.name, where: inSentence(T.LOCATIONS[w.npcs[T.CASE.constable]?.location]),
        suspects: (T.CASE.suspects ?? []).map(p => ({id: p, name: T.PEOPLE[p].name})),
        methods: (T.CASE.methodOptions ?? []).map(([id, label]) => ({id, label})),
        motives: (T.CASE.motiveOptions ?? []).map(([id, label]) => ({id, label}))},
      status: w.status === 'solved' ? 'solved' : this.done ? 'ended' : 'playing',
      actions_left: this.budget.actions - this.actions,
    };
  }

  // ---- what the player does -----------------------------------------------------------------------------------
  async act(action) {
    if (this.done) return {ok: false, error: 'The episode has ended.', observation: this.observe()};
    const before = this.s.events.length, private_ = {kind: action?.type, minute: this.s.world.minute};
    let error = null;
    try {
      error = await this.#perform(action, private_);
    } catch (e) {
      error = `Something went wrong: ${String(e.message).slice(0, 200)}`; private_.exception = String(e.stack ?? e).slice(0, 600);
    }
    if (!error && action.type !== 'note' && action.type !== 'hint') this.actions++;
    // the living morning, as in the game: one detached round after the action
    if (this.director && this.ai && !this.done) {
      const d = await directMorning(this.s, {endpoint: this.endpoint}).catch(e => ({status: 'error', error: String(e.message)}));
      private_.director = {status: d.status, plan: d.plan ? Object.keys(d.plan) : [], audit: d.audit ? {code: d.audit.code, solvable: d.audit.solvable} : null};
    }
    const news = this.s.events.slice(Math.max(before, this.seen)).filter(e => e.playerText && !['clock', 'command'].includes(e.kind))
      .map(e => ({time: timeLabel(e.minute), speaker: e.kind === 'speech' ? this.T.PEOPLE[e.actor]?.name ?? (e.actor === 'player' ? 'You' : e.actor)
        : e.data?.speaker ? this.T.PEOPLE[e.data.speaker]?.name : null, text: e.playerText.replace(/^[^\n]*\n“/, '“')}));
    if (this.advice) { news.unshift(this.advice); this.advice = null; }
    this.seen = this.s.events.length;
    this.#record(action, private_, before, error);
    const spent = this.s.world.minute - this.startMinute;
    if (!this.done && (this.s.world.status === 'solved' || this.actions >= this.budget.actions || spent >= this.budget.minutes)) {
      this.done = true; this.outcome = this.outcome ?? (this.s.world.status === 'solved' ? 'solved' : 'out_of_budget');
    }
    return {ok: !error, error, observation: this.observe(news)};
  }

  async #perform(a, p) {
    const s = this.s, T = this.T, w = s.world;
    if (!a || !ACTIONS.includes(a.type)) return `Unknown action. Use one of: ${ACTIONS.join(', ')}.`;
    const presentPerson = id => w.npcs[id] && w.npcs[id].location === w.player.location && !w.npcs[id].travel;
    switch (a.type) {
      case 'move':
        if (!T.LOCATIONS[a.to]) return `There is no place "${a.to}". Places: ${Object.keys(T.LOCATIONS).join(', ')}.`;
        if (a.to === w.player.location) return 'You are already here.';
        dispatch(s, {type: 'move', to: a.to}); return null;
      case 'examine': {
        const o = this.handles.real(a.thing);
        const offered = T.objectsAt ? T.objectsAt(w, w.player.location) : T.LOCATIONS[w.player.location]?.objects ?? [];
        if (!o || !offered.includes(o) || (w.flags.lockedObjects ?? []).includes(o)) {
          const here = this.observe().things_here.map(t => `${t.label} (${t.id})`);
          const person = T.PEOPLE[a.thing] ? ` ${T.PEOPLE[a.thing].name} is a person: ask or say something to them.` : '';
          return `There is nothing like that here to examine.${person} ${here.length ? `Things here: ${here.join(', ')}.` : 'There is nothing here left to examine.'}`;
        }
        dispatch(s, {type: 'inspect', object: o}); return null;
      }
      case 'wait':
        dispatch(s, {type: 'wait', minutes: Math.max(1, Math.min(60, Number(a.minutes) || 10))}); return null;
      case 'note':
        p.note = String(a.text ?? '').slice(0, 1000); return null;
      case 'quit':
        this.done = true; this.outcome = 'quit'; return null;
      case 'hint': {
        const h = T.behavior.hints(s);
        if (this.hint.key !== h.id) this.hint = {key: h.id, level: 0};
        this.hint.level = Math.min(h.levels.length, this.hint.level + 1);
        p.hint = {id: h.id, level: this.hint.level};
        // a hint is advice, not an action in the world: it is shown with the step's news and costs no action
        this.advice = {time: timeLabel(w.minute), speaker: 'Hint', text: h.levels[this.hint.level - 1]};
        return null;
      }
      case 'accuse': {
        if (!presentPerson(T.CASE.constable)) return `The accusation is heard by ${T.PEOPLE[T.CASE.constable].name}, who is at ${inSentence(T.LOCATIONS[w.npcs[T.CASE.constable].location])}.`;
        const charge = {type: 'accuse', suspect: a.suspect, method: a.method, motive: a.motive};
        const verdict = T.behavior.checkCase(s, charge);   // pure: why the constable accepts or refuses, for the scorer
        dispatch(s, charge);
        p.accusation = {suspect: a.suspect, method: a.method, motive: a.motive, accepted: this.s.world.status === 'solved', status: verdict?.status ?? null};
        return null;
      }
      case 'ask': case 'say': case 'show': {
        if (!presentPerson(a.person)) return `${T.PEOPLE[a.person]?.name ?? 'That person'} is not here.`;
        let action = null, text = a.text;
        if (a.type === 'ask') {
          const real = this.handles.real(a.question);
          if (!real || !real.startsWith(`${a.person}|`)) return 'That is not one of the questions you can put to them now.';
          const topic = real.slice(a.person.length + 1);
          const label = [...(T.CASE.topicsFor?.[a.person] ?? []), ...T.behavior.followupOptions(s, a.person)].find(([t]) => t === topic)?.[1];
          if (!label) return 'That question is no longer open.';
          action = {type: 'ask', person: a.person, topic}; text = label;
        } else if (a.type === 'show') {
          const clue = this.handles.real(a.item);
          if (!clue || !w.player.evidence.some(e => e.clue === clue)) return 'You are not carrying that.';
          action = {type: 'present', person: a.person, clue, tone: 'private'};
          text = T.behavior.presentLine?.(s, a.person, clue) ?? 'Can you tell me about this?';
        } else if (!String(text ?? '').trim()) return 'Say something.';
        text = String(text).slice(0, 1200);
        if (!this.ai) { if (action) dispatch(s, action); else return 'Free text needs the AI characters.'; return null; }
        const t = prepareCharacterTurn(s, {person: a.person, text, action});
        const r = await proposeCharacterTurn(t, {store: this.store});
        const before = s.events.length;
        applyCharacterTurn(s, t, r);
        const reply = s.events.slice(before).find(e => e.kind === 'speech' && e.actor === a.person && e.data?.listener === 'player');
        p.character = {person: a.person, by: r.proposal ? 'ai' : 'fallback', reason: r.audit?.reason ?? null,
          neutral: Boolean(reply && (T.behavior.isDecline?.(a.person, reply.data?.assertion) ?? reply.data?.assertion === NEUTRAL_LINE)),
          rejected: (r.audit?.attempts ?? []).filter(x => x.validation !== 'pass' || /"reject"/.test(String(x.critic?.response ?? ''))).length,
          reasons: (r.audit?.attempts ?? []).map(x => x.validation !== 'pass' ? `validation: ${x.validation}` : String(x.critic?.response ?? '').match(/"violations"\s*:\s*\[\s*"([^"]{0,200})/)?.[1]).filter(Boolean),
          account: r.proposal?.account ?? null, intent: r.proposal?.intent ?? null, text};
        return null;
      }
    }
    return 'Unknown action.';
  }

  // ---- what the scorer sees -----------------------------------------------------------------------------------
  #record(action, p, before, error) {
    const s = this.s, B = this.T.behavior, st = B.caseStatus(s);
    const fresh = s.events.slice(before);
    p.error = error; p.action = action; p.location = s.world.player.location; p.minute_after = s.world.minute;
    p.status = st; p.held = s.world.player.evidence.length; p.read = (s.world.flags.read ?? []).length;
    p.new_evidence = fresh.filter(e => e.kind === 'evidence').map(e => e.data.clue);
    p.rejected = fresh.filter(e => e.kind === 'rejected').map(e => e.playerText?.slice(0, 200));
    p.witnessed = fresh.filter(e => e.data?.morning && e.playerText).map(e => e.playerText.slice(0, 160));
    p.concealed = [...(s.world.flags.morning?.concealed ?? [])];
    p.hint_now = B.hints(s).id;
    this.trace.push(p);
  }

  // the episode's private record, with what the scorer needs to know about the case
  report() {
    const kc = this.records, truth = kc.question.candidates.find(h => h.id === kc.question.truth).facts.actor;
    return {case: kc.id, title: kc.title, difficulty: kc.difficulty?.level ?? null, truth, suspects: this.T.CASE.suspects,
      start_minute: this.startMinute, end_minute: this.s.world.minute, actions: this.actions, outcome: this.outcome ?? (this.done ? 'ended' : 'running'),
      solve_depth: kc.difficulty?.features?.depth ?? null, signs: kc.signs.length, trace: this.trace};
  }
}

// ---- stdio server -------------------------------------------------------------------------------------------------
async function serve() {
  let game = null;
  const out = obj => process.stdout.write(JSON.stringify(obj) + '\n');
  const rl = createInterface({input: process.stdin});
  for await (const line of rl) {
    let msg;
    try { msg = JSON.parse(line); } catch { out({ok: false, error: 'bad json'}); continue; }
    try {
      if (msg.op === 'new') {
        game = await PlaytestGame.create(msg.case, msg.options ?? {});
        out({ok: true, observation: game.observe()});
      } else if (msg.op === 'act') {
        out({...await game.act(msg.action), done: game.done, outcome: game.outcome});
      } else if (msg.op === 'report') out({ok: true, report: game.report()});
      else if (msg.op === 'close') { out({ok: true}); break; }
      else out({ok: false, error: `unknown op ${msg.op}`});
    } catch (e) { out({ok: false, error: String(e.message).slice(0, 300)}); }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) serve();
