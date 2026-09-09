// Narrative modules ("bricks"): reusable, parameterized units of detective fiction
// that snap onto a base case. A case is a base scaffold (cast, map, victim,
// physical crime + alibi) plus a composed set of modules. Adding fiction = adding
// one module file conforming to the contract below.
//
// Fundamental tenets a module MUST honor (enforced by casegen.validateCase):
//   1. The deterministic engine is authoritative. A module contributes content and
//      emits events through the kernel; it never mutates live world state directly
//      and never invents a fact without a recorded source event (provenance).
//   2. Composition is additive and order-independent for content. A module reads
//      declared roles and writes its own clues/objects/beliefs; it does not depend
//      on another module's private details.
//   3. Coherence is proven, not asserted. Each module declares a local `invariant`;
//      the case as a whole must still pass physical/epistemic/reachability/
//      distinguishability. A red-herring brick may not become a required clue, and
//      no brick may remove the last investigation route.
//
/**
 * @typedef {Object} Roles
 * @property {string} culprit
 * @property {string[]} innocents
 * @property {string} victim
 * @property {string[]} suspects
 *
 * @typedef {Object} NarrativeModule
 * @property {string} id
 * @property {string[]} [requires]                         ids of bricks that must compose first (for peer reads)
 * @property {(spec:Object)=>(Object|null)} bind          resolve slot bindings, or null to sit out
 * @property {(ctx:Object)=>void} [content]               additive clues/objects/placement/proof routes
 * @property {(ctx:Object)=>void} [prehistory]            sourced events/beliefs/capabilities via the kernel
 * @property {(ctx:Object)=>(Object|void)} [capabilities] contributed agentPermissions/commitments merged into the model
 * @property {(ctx:Object)=>(boolean|void)} [decide]      NPC decision hook; return true to claim the turn (queue a plan)
 * @property {(ctx:Object)=>void} [onInteract]            react to a player ask/present (e.g. set a trigger belief)
 * @property {(ctx:Object)=>(string|null)} [dialogue]     topic response for (id, topic), or null
 * @property {(ctx:Object)=>{ok:boolean,detail?:string}} [invariant]  module-local coherence check
 */

// Resolve the standard role slots for the fixed Bellweather cast. A future
// generated cast would supply its own suspect list; the shape stays the same.
export function resolveRoles(spec,suspects=['clara','rowan','silas']){
  const culprit=spec.culprit;
  return {culprit,innocents:suspects.filter(id=>id!==culprit),victim:'edmund',suspects};
}
