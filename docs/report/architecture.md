# 2. System architecture and authority boundaries

**Status: implemented architecture with experimental AI and Director paths.**

![Figure 1. Implemented components and proposed solver extensions. Only the engine commits simulation events.](figures/architecture.svg)

## 2.1 Three implementation layers

The kernel, case and engine façade divide mechanics from content. `dist/kernel.mjs` supplies event commits, replay, travel, minute-by-minute time advancement, perception and persistence checks. `createKernel(model)` binds those mechanisms to case tables. The kernel's decision policy is injected by the engine rather than imported from a particular mystery.

`dist/cases/last-bell.mjs` supplies the world factory, initial beliefs, routines, scored decision candidates, authored dialogue, evidence reactions and accusation rubric. Its data tables live in `dist/case.mjs`; structured claim definitions and reasoning-board metadata are separate modules. `dist/engine-runtime.mjs` assembles a case-bound kernel and command API. `dist/engine.mjs` selects the runtime by session case ID and applies admission at public dispatch boundaries. `dist/cases/bellweather.mjs` builds three variants from explicit configurations; `dist/prehistory.mjs` executes their evening history.

This separation is a useful generation target, not proof of complete case independence. The variants share Last Bell entity IDs, graph and an authored evidence rubric; legacy exports and some presentation assumptions still refer to that cast. A procedural case must eventually replace those assumptions with declared capabilities or explicit case adapters. Merely swapping a data table would not yet produce a complete new game.

## 2.2 State as a fold of events

Let W₀ be the case's initial world and Δᵢ the patches on event eᵢ. State at an event prefix is defined operationally by:

```text
Wᵢ₊₁ = apply(Wᵢ, Δᵢ)
Wₙ   = fold(apply, W₀, [Δ₀, …, Δₙ₋₁])
```

An event includes an ID, index, simulation minute, actor, location, kind, causal parent IDs, structured data, before/after patches and optional player-visible text. Parents express recorded causal links; chronological adjacency alone is not a causal explanation. Events at the same minute retain a total order through their indices. The implementation does not claim that a parent list is a complete causal model of every effect.

A player command establishes a root event. Dialogue, movement, observations and NPC decisions create descendants, followed by a completion checkpoint. `worldAt` reconstructs a prefix from the base world. It does not run the scheduler, regenerate dialogue, or change the live session. Import validates the event/patch history against the saved world. Selected legacy repairs, such as a completed correction intention, append repair events rather than silently modifying earlier events.

## 2.3 The two transactional boundaries

The AI character pipeline prepares a ticket containing the serialized starting session and a restricted context. An accepted proposal runs on a candidate copy; diagnostics must pass before that candidate replaces the live state. If the session changed while the model was working, the ticket is stale and cannot authorize the turn.

When World Director is enabled, the UI stages the whole candidate turn on a copy. The Director inspects newly recorded, locally admitted plans, checks their queries, and optionally searches for an investigation witness. Only a successful result commits the candidate's world and events. Cancellation leaves candidate effects unapplied. A rejected or unresolved Director check may append a private decision audit to the original session while leaving the attempted action's time and effects uncommitted.

Consequently, a displayed “checking” indicator belongs to pending validation, not post hoc approval of a response already made authoritative. The UI now shows it only when a real symbolic check begins. [Character turns](characters.md) details generation and criticism; [Director](director.md) details the outer boundary.

## 2.4 Runtime and deployment boundary

The browser loads ES modules and retains the local investigation. A Python proxy serves optional model requests; a separate Python service exposes Z3 on loopback port 8788. The solver service has no need to call an LLM. These local services check request shape and browser-origin conditions, but they are not a production authentication system.

The public player projection and omniscient inspector are presentation boundaries within a local single-player application. Source files and exported saves contain secrets. Preventing a technically curious player from reading the solution is outside the current security model. A future hosted multiplayer or adversarial setting would need a different server-authority and access-control design.

## 2.5 Scaling implications

Full reconstruction from W₀ is simple and auditable, but repeatedly scanning a growing event history will not scale indefinitely. Proposed improvements include periodic snapshots, indexed event lookup and causality queries, and bounded perspective retrieval. Each optimization must preserve prefix semantics: an index must not accidentally return a later observation while inspecting an earlier world. This is a correctness requirement before it is a performance feature.


## 2.6 Proposed admission boundary

The refined target adds an explicit pre-deliberation filtering boundary before
scripted or AI choice, followed by a latest-state execution boundary. Certificates
or constrained capabilities carry semantic dependencies, assumptions, horizon and
rule/adapter versions; they are invalidated by relevant state or time changes.
All admitted transitions must preserve hard invariants, using direct checks,
applicable symbolic queries or a sound preservation argument. This extends the
current selected-plan transaction rather than claiming it already covers the
whole simulation. See [Figure 8](director.md#6-7-two-stage-admission-for-autonomous-agents).

## 2.7 Configuration-specific admission

New configurations stage every public player or character action on a copy and require a replayed acquisition witness before committing it. Relevant intermediate access/possession and declared expiry changes receive separate prefix checks. A terminal flag cannot bypass an earlier failed check. This local boundary is active independently of the optional solver; Z3 can additionally verify represented short plans. Original saves retain the original optional Director boundary.

`investigation.mjs` constructs candidate acquisition routes; `admission.mjs` governs their use in transition and capability checks. Engine-internal witness execution uses the raw case runtime to avoid recursive admission. This is trusted developer machinery, not a security interface. See [the Director chapter](director.md) for model bounds and unresolved semantics.
