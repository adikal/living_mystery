import {createKnowledge} from './knowledge.mjs';
// Generic, case-agnostic simulation kernel.
//
// Owns the mechanics every mystery shares: the append-only event log, reversible
// state patches, deterministic replay, save/load with integrity checks, and the
// neutral "simulation verbs" (commit, believe, speech, advance, …). It knows
// NOTHING about a specific mystery — characters, places, clues, the initial
// world, and the NPC decision policy are all injected through `model` and the
// `decide` hook. This is the layer a procedural generator and a symbolic
// verifier target; a concrete case (see cases/) supplies the content.
//
// See schema.mjs for the typed contracts (Model, Kernel, Event, Belief).

import {validateClaim} from './claims.mjs';
export const VERSION = 1;
export const copy = (x) => structuredClone(x);
export const timeLabel = (m) =>
  `${String(Math.floor(m / 1440) + 1).padStart(1, '0') !== '1' ? `Day ${Math.floor(m / 1440) + 1} · ` : ''}${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const get = (o, path) => path.split('.').reduce((v, k) => v?.[k], o);
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
function set(o, path, value) {
  const keys = path.split('.');
  if (keys.some((k) => unsafe.has(k))) throw Error('Invalid state path');
  let t = o;
  for (const k of keys.slice(0, -1)) {
    if (t[k] === undefined) t[k] = {};
    t = t[k];
  }
  if (value === undefined) delete t[keys.at(-1)];
  else t[keys.at(-1)] = copy(value);
}

// The state roots and event kinds this kernel's world-shape supports. Cases may
// extend these via model.stateRoots / model.eventKinds; defaults match the
// original single-world schema so existing saves validate unchanged.
const DEFAULT_STATE_ROOTS = ['minute', 'status', 'player', 'npcs', 'objects', 'flags', 'ending'];
const DEFAULT_EVENT_KINDS = ['history', 'memory', 'belief', 'observation', 'arrival', 'movement', 'decision', 'speech', 'relationship', 'action', 'clock', 'evidence', 'rejected', 'emotion', 'command', 'notebook', 'resolution', 'checkpoint'];

/**
 * Build a kernel bound to one case `model`.
 * @param {import('./schema.mjs').Model} model
 * @returns {import('./schema.mjs').Kernel}
 */
export function createKernel(model) {
  const { PEOPLE, LOCATIONS, CLUES } = model;
  const baseWorld = model.baseWorld;
  const stateRoots = model.stateRoots || DEFAULT_STATE_ROOTS;
  const eventKinds = new Set(model.eventKinds || DEFAULT_EVENT_KINDS);

  const speechOverrides=new WeakMap();
  function withSpeech(s,override,run){speechOverrides.set(s,override);try{return run();}finally{speechOverrides.delete(s);}}
  const hidePresentLine=new WeakSet();
  function withoutPlayerPresentLine(s,run){hidePresentLine.add(s);try{return run();}finally{hidePresentLine.delete(s);}}
  function presentLineHidden(s){return hidePresentLine.has(s);}
  const nextId = (s) => `e${String(s.events.length + 1).padStart(5, '0')}`;
  const has = (s, c) => s.world.player.evidence.some((e) => e.clue === c);
  const local = (s, id) => s.world.npcs[id]?.location === s.world.player.location;

  // All world mutations pass through commit. Events carry reversible patches.
  function commit(s, { kind = 'world', title, actor = 'world', location = null, data = {}, changes = {}, parents = [], playerText = null, visibility = 'internal', minute } = {}) {
    const id = nextId(s), patches = [];
    for (const [path, after] of Object.entries(changes)) {
      const before = get(s.world, path);
      if (!same(before, after)) patches.push({ path, ...(before === undefined ? {} : { before: copy(before) }), ...(after === undefined ? {} : { after: copy(after) }) });
    }
    for (const p of patches) set(s.world, p.path, p.after);
    const event = { id, index: s.events.length, minute: minute ?? s.world.minute, kind, title, actor, location: location ?? (s.world.npcs[actor]?.location || s.world.player.location), data: copy(data), changes: patches, parents: [...new Set(parents.filter(Boolean))], playerText, visibility: playerText ? 'observed' : visibility };
    s.events.push(event);
    return id;
  }

  function remember(s, id, eventId) {
    const a = s.world.npcs[id];
    if (!a) return;
    commit(s, { kind: 'memory', title: `${PEOPLE[id].name} remembers an event`, actor: id, parents: [eventId], changes: { [`npcs.${id}.memories`]: [...a.memories, eventId].slice(-80) } });
  }
  const {believe,retireBelief,completeIntention}=createKnowledge({commit,remember,model});
  function notice(s, id, cause, text) {
    if (local(s, id)) commit(s, { kind: 'observation', title: `You notice ${PEOPLE[id].name}`, actor: 'player', parents: [cause], playerText: text, changes: { [`player.lastSeen.${id}`]: { location: s.world.player.location, minute: s.world.minute } } });
  }

  // Witnesses learn only the movement visible at their location, not a route or motive.
  function witnessMovement(s, subject, phase, location, cause) {
    if (!LOCATIONS[location]) return;
    const name = subject === 'player' ? 'The detective' : PEOPLE[subject].name;
    for (const [id, npc] of Object.entries(s.world.npcs)) {
      if (id === subject || npc.location !== location || npc.travel) continue;
      const observation = commit(s, { kind: 'observation', title: `${PEOPLE[id].name} sees ${name} ${phase === 'departure' ? 'leave' : 'arrive'}`, actor: id, location, parents: [cause], data: { subject, phase, observedLocation: location, sourceType: 'observation' } });
      remember(s, id, observation);
    }
  }

  function distance(from, to) {
    if (from === to) return 0;
    if (!LOCATIONS[from] || !LOCATIONS[to]) return Infinity;
    const costs = { [from]: 0 }, todo = new Set(Object.keys(LOCATIONS));
    while (todo.size) {
      const at = [...todo].sort((a, b) => (costs[a] ?? Infinity) - (costs[b] ?? Infinity))[0];
      todo.delete(at);
      if (at === to) return costs[at] ?? Infinity;
      for (const [n, c] of Object.entries(LOCATIONS[at].links)) if ((costs[at] ?? Infinity) + c < (costs[n] ?? Infinity)) costs[n] = costs[at] + c;
    }
    return Infinity;
  }

  function startTravel(s, id, to, cause, purpose) {
    const a = s.world.npcs[id], from = a.location;
    if (a.travel || from === to) return;
    const arrival = s.world.minute + distance(from, to);
    if (!Number.isFinite(arrival)) return;
    const e = commit(s, { kind: 'movement', title: `${PEOPLE[id].name} sets out for ${LOCATIONS[to].short}`, actor: id, location: from, parents: [cause], data: { from, to, arrival, purpose }, changes: { [`npcs.${id}.location`]: 'transit', [`npcs.${id}.travel`]: { from, to, arrival, cause, purpose } }, playerText: from === s.world.player.location ? `${PEOPLE[id].name} leaves for ${LOCATIONS[to].short}.` : null });
    witnessMovement(s, id, 'departure', from, e);
    if (from === s.world.player.location) commit(s, { kind: 'observation', title: `You see ${PEOPLE[id].name} leave`, actor: 'player', parents: [e], changes: { [`player.lastSeen.${id}`]: { location: from, minute: s.world.minute, departed: true } } });
  }

  // Advance the clock minute-by-minute; process arrivals and periodic NPC
  // decisions via the injected policy (api.decide, set by the assembling engine).
  function advance(s, minutes, cause) {
    for (let n = 0; n < minutes; n++) {
      const e = commit(s, { kind: 'clock', title: 'A minute passes', parents: [cause], changes: { minute: s.world.minute + 1 } });
      for (const [id, a] of Object.entries(s.world.npcs)) {
        if (a.travel && a.travel.arrival <= s.world.minute) {
          const tr = copy(a.travel);
          const arrival = commit(s, { kind: 'movement', title: `${PEOPLE[id].name} arrives at ${LOCATIONS[tr.to].short}`, actor: id, location: tr.to, parents: [tr.cause, e], changes: { [`npcs.${id}.location`]: tr.to, [`npcs.${id}.travel`]: null }, data: { from: tr.from, to: tr.to }, playerText: s.world.player.location === tr.to ? `${PEOPLE[id].name} arrives from ${LOCATIONS[tr.from].short}.` : null });
          witnessMovement(s, id, 'arrival', tr.to, arrival);
          notice(s, id, arrival, `${PEOPLE[id].name} is here now.`);
          api.decide(s, id, arrival);
        } else if (!a.travel && s.world.minute % 10 === 0) {
          api.decide(s, id, e);
        }
      }
    }
  }

  function addEvidence(s, clue, cause, source) {
    if (has(s, clue)) return false;
    const d = CLUES[clue], event = nextId(s);
    const testimony=model.testimonyClues?.includes(clue)?s.events.find(e=>e.id===cause)?.data.assertion:null;
    const text=testimony??d.text;
    commit(s, { kind: 'evidence', title: `Recorded: ${d.title}`, actor: 'player', parents: [cause], data: { clue, source: source ?? d.source, claims: model.testimonyClues?.includes(clue)?(s.events.find(e=>e.id===cause)?.data.claims??model.evidenceClaims?.[clue]??[]):(model.evidenceClaims?.[clue]??[]) }, changes: { 'player.evidence': [...s.world.player.evidence, { clue, eventId: event, minute: s.world.minute, source: source ?? d.source,...(testimony?{text}:{}) }] }, playerText: `${d.title}\n${text}` });
    return true;
  }
  function reject(s, title, text, cause, data = {}) {
    return commit(s, { kind: 'rejected', title, actor: 'player', parents: [cause], data: { reason: text, ...data }, playerText: text });
  }
  function speech(s, id, text, cause, data = {}) {
    const override=speechOverrides.get(s);
    if(override&&override.person===id){data={...data,authoredAssertion:text,intent:override.intent,plan:{...(data.plan??{}),intent:override.intent},characterTurn:true,sourceEvents:[...(data.sourceEvents??[]),...override.parents]};text=override.utterance;}
    const e = commit(s, { kind: 'speech', title: `${PEOPLE[id].name} speaks to you`, actor: id, parents: [cause,...(data.sourceEvents??[])], data: { listener: 'player', assertion: text, ...data }, playerText: `${PEOPLE[id].name}\n“${text}”` });
    remember(s, id, e);
    return e;
  }

  function worldAt(s, index) {
    if (!Number.isInteger(index) || index < -1 || index >= s.events.length) throw Error('Invalid history cursor');
    const world = baseWorld(s.seed);
    for (let i = 0; i <= index; i++) for (const p of s.events[i].changes) set(world, p.path, p.after);
    return world;
  }

  function diagnostics(s) {
    const ids = new Set(), errors = [];
    let patchCount = 0;
    const replay = baseWorld(s.seed);
    for (const e of s.events) {
      if (ids.has(e.id)) errors.push(`Duplicate event ${e.id}`);
      for (const p of e.parents) if (!ids.has(p)) errors.push(`${e.id} references a missing or future cause ${p}`);
      ids.add(e.id);
      for (const p of e.changes) {
        if (!same(get(replay, p.path), p.before)) errors.push(`Patch mismatch at ${e.id}: ${p.path}`);
        set(replay, p.path, p.after);
        patchCount++;
      }
    }
    if (!same(replay, s.world)) errors.push('Replay differs from current world');
    for (const [id, a] of Object.entries(s.world.npcs)) {
      if (!PEOPLE[id] || (a.location !== 'transit' && !LOCATIONS[a.location])) errors.push(`Invalid location for ${id}`);
      if ((a.location === 'transit') !== Boolean(a.travel)) errors.push(`Travel mismatch for ${id}`);
      for (const b of a.beliefs) {
        if (!ids.has(b.sourceId)) errors.push(`Untraced belief for ${id}`);
        if(b.supports!==undefined&&(!Array.isArray(b.supports)||b.supports.some(p=>!p||!a.beliefs.some(premise=>premise.key===p.key&&premise.sourceId===p.sourceId))))errors.push(`Untraced active premise for ${id}`);
      }
    }
    for (const e of s.world.player.evidence) if (!CLUES[e.clue] || !ids.has(e.eventId)) errors.push('Untraced evidence');
    if (s.world.player.location !== 'transit' && !LOCATIONS[s.world.player.location]) errors.push('Invalid player location');
    return { ok: errors.length === 0, errors, eventCount: s.events.length, patchCount, beliefCount: Object.values(s.world.npcs).reduce((n, a) => n + a.beliefs.length, 0), checks: [{ name: 'Event ordering and causal references', ok: !errors.some((e) => /Duplicate|cause/.test(e)) }, { name: 'Replay matches the current world', ok: !errors.some((e) => /Replay|Patch/.test(e)) }, { name: 'Characters have valid locations and travel', ok: !errors.some((e) => /location|Travel/.test(e)) }, { name: 'Beliefs and evidence have source events', ok: !errors.some((e) => /Untraced/.test(e)) }] };
  }

  function exportSession(s) {
    return JSON.stringify({ format: 'living-mystery', version: VERSION, seed: s.seed, events: s.events, world: s.world }, null, 2);
  }
  function importSession(text) {
    if (typeof text !== 'string' || text.length > 20_000_000) throw Error('Save file is too large.');
    const s = JSON.parse(text);
    if (s.format !== 'living-mystery' || s.version !== VERSION || !Array.isArray(s.events) || s.events.length > 50000 || !Number.isInteger(s.seed) || s.seed < 0 || s.seed > 999999) throw Error('This is not a supported Living Mystery save.');
    const actors = ['player', 'world', ...Object.keys(PEOPLE)];
    for (const [i, e] of s.events.entries()) {
      if (!e || e.id !== `e${String(i + 1).padStart(5, '0')}` || e.index !== i || !eventKinds.has(e.kind) || !actors.includes(e.actor) || !Array.isArray(e.changes) || !Array.isArray(e.parents) || !Number.isFinite(e.minute) || e.minute < 480 || typeof e.title !== 'string' || !e.data || typeof e.data !== 'object' || (e.playerText !== null && typeof e.playerText !== 'string')) throw Error('Malformed event in save.');
      if(e.data.claims!==undefined&&(!Array.isArray(e.data.claims)||!e.data.claims.every(validateClaim)))throw Error('Malformed structured claim in save.');
      for (const p of e.changes) if (typeof p.path !== 'string' || !p.path.split('.').every((k) => k && !unsafe.has(k)) || !stateRoots.includes(p.path.split('.')[0])) throw Error('Invalid state change in save.');
    }
    const out = { version: s.version, seed: s.seed, events: s.events, world: s.world };
    const d = diagnostics(out);
    if (!d.ok) throw Error(`Save failed integrity checks: ${d.errors[0]}`);
    return out;
  }

  const api = {
    model, withSpeech, withoutPlayerPresentLine, presentLineHidden, nextId, has, local, commit, remember, believe, retireBelief, completeIntention, notice, witnessMovement,
    distance, startTravel, advance, addEvidence, reject, speech,
    worldAt, diagnostics, exportSession, importSession, baseWorld,
    // Injected NPC decision policy — set by the assembling engine to the active
    // case's decide(). Defaults to a no-op so the kernel is usable standalone.
    decide: () => {},
  };
  return api;
}
