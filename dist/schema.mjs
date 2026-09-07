// Typed contracts for the simulation — the shared vocabulary the kernel, the
// cases, and (soon) a procedural generator, a symbolic verifier, and an LLM
// action-proposer all speak. These are JSDoc typedefs (no build step) plus a
// small runtime action catalog + validator.
//
// Design intent (see docs/architecture.md): the deterministic kernel owns
// reality; a Case supplies content + policy + dialogue; Actions are the only
// way to drive the world, and Effects (event kinds) are the only way the world
// changes. Making these explicit is what unblocks generation, verification, and
// safe LLM autonomy — a proposed action can be validated against this catalog
// before the kernel ever executes it.

// ---------------------------------------------------------------------------
// Core domain types
// ---------------------------------------------------------------------------

/**
 * A reversible state patch recorded on an event.
 * @typedef {{path:string, before?:any, after?:any}} Patch
 */

/**
 * An append-only event. The world is the fold of every event's patches.
 * @typedef {Object} Event
 * @property {string} id                 Stable id, `eNNNNN`.
 * @property {number} index              0-based position in the log.
 * @property {number} minute             Simulation minute.
 * @property {EventKind} kind
 * @property {string} title
 * @property {string} actor              'player' | 'world' | a character id.
 * @property {string|null} location
 * @property {Object} data               Kind-specific structured payload.
 * @property {Patch[]} changes           Reversible world patches.
 * @property {string[]} parents          Causal parent event ids.
 * @property {string|null} playerText    Present only when observable by the player.
 * @property {'internal'|'observed'} visibility
 */

/**
 * @typedef {'history'|'memory'|'belief'|'observation'|'arrival'|'movement'|'decision'|'speech'|'relationship'|'action'|'clock'|'evidence'|'rejected'|'emotion'|'command'|'notebook'|'resolution'|'checkpoint'} EventKind
 */

/**
 * A structured, provenance-bearing belief held by a character.
 * @typedef {Object} Belief
 * @property {string} key                 Stable proposition key.
 * @property {string} text                Human-readable content.
 * @property {number} confidence          0..1.
 * @property {'observation'|'testimony'|'inference'|'memory'|'seed'} sourceType
 * @property {string} sourceId            Event id the belief came from.
 * @property {boolean|null} truth         Inspector-only: matches case truth?
 * @property {number} acquired            Minute acquired.
 */

/**
 * A scored NPC decision candidate (kept for the inspector's "why").
 * @typedef {Object} Candidate
 * @property {string} id
 * @property {string} label
 * @property {number} score
 * @property {string[]} reasons
 * @property {string} [source]            Belief/event id that enabled it.
 */

/**
 * A typed player (or agent) intent. `type` selects the handler; the remaining
 * fields are per-type (see ACTIONS).
 * @typedef {Object} Action
 * @property {PlayerActionType} type
 * @property {string} [label]
 * @property {string} [to]                move: destination location id.
 * @property {string} [object]           inspect: object id.
 * @property {string} [person]           ask/present: character id.
 * @property {string} [topic]            ask: topic key.
 * @property {string} [clue]             present: clue id.
 * @property {string} [tone]             present: 'private' | 'press'.
 * @property {number} [minutes]          wait: minutes.
 * @property {string} [text]             note: hypothesis text.
 * @property {string} [suspect]          accuse.
 * @property {string} [method]           accuse.
 * @property {string} [motive]           accuse.
 * @property {string[]} [evidence]       accuse: selected clue ids.
 */

/** @typedef {'move'|'inspect'|'ask'|'present'|'wait'|'pin'|'note'|'accuse'|'look'|'endConversation'} PlayerActionType */

// ---------------------------------------------------------------------------
// Case / Kernel interfaces
// ---------------------------------------------------------------------------

/**
 * Static content tables + world factory a case gives the kernel.
 * @typedef {Object} Model
 * @property {Object} PEOPLE
 * @property {Object} LOCATIONS
 * @property {Object} CLUES
 * @property {Object} OBJECTS
 * @property {Object} CASE
 * @property {(seed:number)=>Object} baseWorld
 * @property {string[]} [stateRoots]     Allowed top-level state paths.
 * @property {EventKind[]} [eventKinds]  Allowed event kinds.
 */

/**
 * The neutral simulation verbs the kernel exposes to a case's behavior.
 * @typedef {Object} Kernel
 * @property {Model} model
 * @property {(s:any)=>string} nextId
 * @property {(s:any,clue:string)=>boolean} has
 * @property {(s:any,id:string)=>boolean} local
 * @property {(s:any,opts:Object)=>string} commit
 * @property {(s:any,id:string,eventId:string)=>void} remember
 * @property {(s:any,id:string,key:string,text:string,confidence:number,sourceType:string,sourceId:string,truth?:boolean|null)=>string} believe
 * @property {(s:any,id:string,cause:string,text:string)=>void} notice
 * @property {(s:any,subject:string,phase:'arrival'|'departure',location:string,cause:string)=>void} witnessMovement
 * @property {(from:string,to:string)=>number} distance
 * @property {(s:any,id:string,to:string,cause:string,purpose:string)=>void} startTravel
 * @property {(s:any,minutes:number,cause:string)=>void} advance
 * @property {(s:any,clue:string,cause:string,source?:string)=>boolean} addEvidence
 * @property {(s:any,title:string,text:string,cause:string,data?:Object)=>string} reject
 * @property {(s:any,id:string,text:string,cause:string,data?:Object)=>string} speech
 * @property {(s:any,index:number)=>Object} worldAt
 * @property {(s:any)=>Object} diagnostics
 * @property {(s:any)=>string} exportSession
 * @property {(text:string)=>Object} importSession
 * @property {(seed:number)=>Object} baseWorld
 * @property {(s:any,id:string,cause:string)=>void} decide  Injected policy.
 */

/**
 * The behavior a case implements on top of a kernel.
 * @typedef {Object} CaseBehavior
 * @property {(s:any,id:string)=>string} routineDestination
 * @property {(s:any,id:string,cause:string)=>void} decide
 * @property {(s:any,id:string,topic:string,cause:string)=>string} ask
 * @property {(s:any,id:string,clue:string,tone:string,cause:string)=>void} present
 * @property {(s:any)=>void} seedSession
 * @property {(s:any,accusation:Action)=>{supported:boolean,routes:string[],selected:string[]}} checkCase
 * @property {(s:any,world?:Object)=>Object[]} caseHealth
 * @property {(input:string)=>Action} parseCommand
 * @property {(a:Action)=>string} commandLabel
 */

/**
 * A full case module: data + world factory + behavior factory.
 * @typedef {Object} Case
 * @property {Model} model
 * @property {(seed:number)=>Object} baseWorld
 * @property {(k:Kernel)=>CaseBehavior} createBehavior
 */

// ---------------------------------------------------------------------------
// Declarative action catalog (runtime)
// ---------------------------------------------------------------------------

/**
 * The canonical description of every player action: which fields it requires,
 * and whether executing it advances the clock. A generator/LLM can consult this
 * to propose only well-formed actions; `validateAction` enforces shape before
 * the kernel runs anything. (The engine's router remains the executor.)
 * @type {Record<PlayerActionType,{required:string[],optional:string[],advancesTime:boolean,summary:string}>}
 */
export const ACTIONS = Object.freeze({
  move:    { required: ['to'],                       optional: [],            advancesTime: true,  summary: 'Travel to a location.' },
  inspect: { required: ['object'],                   optional: [],            advancesTime: true,  summary: 'Examine an object in the current place.' },
  ask:     { required: ['person'],                   optional: ['topic'],     advancesTime: true,  summary: 'Question a co-located character.' },
  present: { required: ['person', 'clue'],           optional: ['tone'],      advancesTime: true,  summary: 'Show a clue to a co-located character.' },
  wait:    { required: [],                           optional: ['minutes'],   advancesTime: true,  summary: 'Let time pass.' },
  pin:     { required: ['clue'],                      optional: [],            advancesTime: false, summary: 'Pin/unpin a clue for the accusation.' },
  note:    { required: ['text'],                      optional: [],            advancesTime: false, summary: 'Record a hypothesis.' },
  accuse:  { required: ['suspect', 'method', 'motive'], optional: ['evidence'], advancesTime: false, summary: 'Present a final accusation to the constable.' },
  endConversation: { required: [], optional: [], advancesTime: false, summary: 'End the conversation and release the speaker to their plans.' },
  look:    { required: [],                           optional: [],            advancesTime: false, summary: 'Re-read the current scene.' },
});

/** @type {Set<string>} */
export const PLAYER_ACTION_TYPES = new Set(Object.keys(ACTIONS));

/**
 * Shape-check an action against the catalog (does NOT check semantic validity
 * like reachability — that stays in the kernel/case). Returns {ok, errors}.
 * @param {Action} action
 */
export function validateAction(action) {
  const errors = [];
  if (!action || typeof action.type !== 'string') return { ok: false, errors: ['Action must be an object with a string `type`.'] };
  const spec = ACTIONS[action.type];
  if (!spec) return { ok: false, errors: [`Unknown action type: ${action.type}`] };
  for (const field of spec.required) if (action[field] === undefined || action[field] === null || action[field] === '') errors.push(`Action '${action.type}' requires '${field}'.`);
  return { ok: errors.length === 0, errors };
}

/** Event kinds that represent a world-changing effect (vs. a marker/log). */
export const EFFECT_KINDS = Object.freeze(['belief', 'memory', 'observation', 'movement', 'action', 'evidence', 'relationship', 'emotion', 'resolution', 'notebook']);

/**
 * A claim is an attributed assertion, never an automatic world fact.
 * Intervals are inclusive minute offsets on the authored case-night clock;
 * simulation acquisition time is recorded separately on the source event.
 * @typedef {Object} Claim
 * @property {string} key
 * @property {string} subject
 * @property {string} predicate
 * @property {string|number} value
 * @property {{start:number,end:number}|null} interval
 * @property {number} confidence Authored confidence, not calibrated probability.
 * @property {string} attribution Observation, inference, record, or testimony description.
 * @property {string} [claimant] Speaker whose account is being recorded/revised.
 *
 * @typedef {{intent:string,basis:string|null,disclosure:'withhold_or_mislead'|'stated_account'}} CommunicativePlan
 */
export {validateClaim} from './claims.mjs';
