# Architecture and inspection contract

## Product boundary

This version prioritizes a complete investigation and a causal debugger. It includes an original authored mystery, three configured reference variants, seeded structural generation and bounded autonomous lives. New configured/generated cases use typed forensic reasoning; broader generation and cognition remain research targets.

The deterministic engine and case data are ES modules independent of the DOM. The browser and terminal are adapters. The browser renders `playerView(session)` during play; inspector code deliberately reads full state. Source secrecy is not a goal for this local single-player prototype.

## Module architecture (kernel / case / engine)

The simulation is split into three layers so that content and generation can grow without touching mechanics:

- **Kernel** (`dist/kernel.mjs`) — generic, case-agnostic mechanics: the append-only event log, reversible patches, deterministic replay (`worldAt`), save/load + integrity checks (`diagnostics`), and the neutral "simulation verbs" (`commit`, `believe`, `speech`, `witnessMovement`, `advance`, …). It knows nothing about a specific mystery. `createKernel(model)` binds it to a case's data tables and world factory; the NPC decision policy is **injected** via `kernel.decide` so the clock can drive character behavior without the kernel importing any content.
- **Case** (`dist/cases/last-bell.mjs`, data in `dist/case.mjs`) — one mystery as data + behavior: `model` (people/locations/clues/objects/case), `baseWorld(seed)`, and `createBehavior(kernel)` returning the policy (`decide`, `routineDestination`), the authored dialogue (`ask`, `present`), session seeding, `checkCase`/`caseHealth`, and the command parser. Configured/generated cases are assembled by `cases/bellweather.mjs` from a specification and narrative modules, preserving that interface.
- **Engine** (`dist/engine.mjs`) — a session-scoped façade that resolves the case ID and re-exports the public API. `engine-runtime.mjs` assembles the selected kernel/behavior and owns command routing. Generated IDs reconstruct their specification. Original-case special handling remains explicit in the investigation adapter.

**Typed contracts** live in `dist/schema.mjs` (JSDoc typedefs — no build step): `Event`, `Belief`, `Action`, `Model`, `Kernel`, `CaseBehavior`, `Case`, plus a declarative `ACTIONS` catalog and `validateAction()`. This is the shared vocabulary a generator, a symbolic verifier, and an LLM action-proposer target: a proposed action can be shape-validated against the catalog before the kernel executes it. Deeper semantic/precondition validation still lives in the kernel/case.

This is the foundation for the roadmap's harder phases: generation produces a new Case `model`; verification checks the event log + action catalog; and the optional character-turn pipeline now proposes bounded conversation decisions behind validation. See [Character turns](character-turns.md) for the implemented contract.

## Wording-only dialogue, critic, and audit

This section describes the retired delivery mode for compatibility with saved audits. The UI now has one character-reasoning toggle; when off, all new responses are scripted without model calls. Character reasoning is a separate opt-in path: its accepted speech, decisions, attributed player memories, belief stance and dialogue state are engine events, with the full audit attached to the decision. It uses a 30-second combined budget and atomic trial execution. Neither mode is a symbolic proof of coherence.

The generator freely rewrites the authored statement using character persona and event-time mood. Deterministic checks first enforce matching numeric tokens and presence/absence of known person/place terms. These checks intentionally reject some harmless paraphrases (e.g. converting numeric times to words) and do not detect all semantic changes. A second, separate-context model call compares source and candidate for added or omitted claims, changed certainty, negation, attribution, alibis, or disclosures. The authored statement is the reference even when it is a deliberate lie. Both requests currently use the same configured model; this is not an independent formal verifier.

Only a strictly parsed passing verdict with an empty violations list releases a changed response. Rejection, malformed verdicts, either request failing, or the combined 16-second timeout returns the authored line. An exactly unchanged response skips the critic. A model critic can still approve an incorrect paraphrase; future structured assertions, solver-backed constraints, and empirical critic evaluations remain necessary. The current mocked tests verify orchestration and rejection behavior, not model judgment accuracy.

`realizeDialogue` returns versioned presentation metadata: generation request/response, critic request/response/verdict, actual displayed text, and status/reason. Completed attempts are attached to save envelopes as optional `dialogue` metadata, separate from deterministic events and beliefs. Restore checks the source speech, deterministic anchors, and saved critic verdict before redisplaying a rewrite; it does not call a model. Saved verdicts are not authenticated against local save editing. Older saves without audits remain readable. Reloaded in-flight attempts are not resumed and retain authored lines. Disabling AI affects future requests and retains completed historical output.

Inspector speech details expose Dialogue audit separately from the engine statement. Requests include public persona, authored dialogue, and private mood/delivery cues, excluding the canonical solution and private backstory. The critic receives only authored/candidate text and its validation instructions. UI text is escaped. Async updates preserve unfinished command and hypothesis text.

The loopback-only Python proxy checks exact Origin, Host, custom request header, content type, and bounded request shape. SDK timeouts are bounded and retries disabled. These browser-origin restrictions are not authentication against local programs or a production security boundary. Offline tests stub model calls; real Bedrock and critic-quality evaluations remain separate integration work.

## Event model

Every simulation mutation passes through `commit`. An event contains:

- Stable ID and sequential index.
- Simulation minute, actor, location, and event kind.
- A title and structured payload.
- Causal parent IDs, distinct from mere chronological adjacency.
- Before/after patches for changed world paths.
- Player-facing text only when an observation or conversation is accessible to the player at that moment.

Player commands create a causal root and a completion checkpoint. Advancing time emits clock events; schedules and pending arrivals are processed minute by minute. Decisions store all considered candidates, policy scores, their reasons, and the selected candidate. Memory and belief events refer to acquisition events. Explanations in the inspector are recorded factors, not a retrospective language-model reconstruction.

The original case anchors summarized pre-game memories. Configured/generated cases instead execute the evening prehistory through the kernel: travel, possession, crime actions, evidence production, observation and report delivery. Their typed sources and physical history are checked by the forensic model before a sampled case is admitted.

## Replay

`worldAt(session, index)` starts with `baseWorld(seed)` and reapplies patches through the selected event. It does not change the current state, create events, or query a model. The inspector uses that result for positions, intentions, trust, stress, and beliefs. It can still display later events as future entries in the recorded history.

Replaying recorded patches and rerunning the same commands are different checks. Tests cover both. Save restoration validates patches, causal references, supported event identifiers, source IDs, world consistency, and unsafe paths before accepting a state.

The current implementation reconstructs from the start, which is sufficient for a short case. Add periodic snapshots and indexed causal/actor lookups as histories grow. Replay is read-only; branching, diffing two runs, and editing state are deliberately not implemented yet.

## Knowledge

Beliefs record proposition keys, human-readable content, confidence, source type and event, acquisition time, and an inspector-only relation to authored case truth. Observation, testimony, inference, and speech assertions remain distinguishable. A false statement never becomes a physical world fact.

Movement perception is emitted at each arrival or departure boundary, including the detective’s initial arrival. Every other stationary NPC at that location receives an internal observation linked to the movement, then a memory event retaining that observation ID. Witnesses record the subject, arrival/departure phase, and observed location; they do not acquire the route, destination, or private purpose. Transit is not a shared perceptible location. Events within the same minute follow stable character iteration order. Movement observations can be recounted through sightings. A local folio-retrieval observation creates a belief that can enable Clara’s reporting plan; knowledge of a mistaken report enables Ada’s correction plan.

The inspector’s Memories tab reads the selected replay world’s retained IDs (currently capped at 80 per character), while the full timeline preserves all historical observations. Existing version-1 saves remain readable; past movement observations are not backfilled.

Initial belief provenance uses the case-history event. New knowledge travels via a real interaction. A later correction updates the recipient of that correction, not every person who heard the original rumor.

`playerView` exposes public character descriptions, current trust and stress only for stationary characters in the player’s scene (no remote metrics), people currently encountered, previously observed locations, discovered evidence, personal hypotheses, and observed text. Local last-seen information can become stale. The inspector is a separately entered omniscient view.

## Investigation adapter

The main transcript renders only the five most recent player-visible entries, oldest to newest. A modal pages the complete observed transcript in groups of 20, also chronologically. Full engine history is retained for export and replay. Desktop panels constrain their own scrolling; the mobile transcript has a bounded height.

Scene changes show a from/to banner and arrivals have a distinct transcript treatment. Inspect, Talk, and Wait expose supported actions directly; the text parser remains optional. Local character highlights use the public projection. Question labels map to the deterministic engine's authored topics, with evidence presentation available separately.

Done markers are derived from matching command events without a directly caused rejection. Inspections match the object, questions match person/topic, and presentations match person/clue/tone. These markers work with existing saves and typed commands, do not disable actions, and do not imply an exhausted topic. Relevant evidence has case-authored reactions, with explicit limits for unsupported interpretations. Follow-ups are gated by acquired evidence, previous dialogue, and the recipient’s beliefs.

Memories display oldest to newest in acquisition order, with timestamps, locations, event IDs, and belief or speech content where available. Repeated conversations remain distinct episodes. An arrival followed immediately by departure may share a simulation minute because reading and choosing do not advance time; event order resolves that sequence. The debugger's full event timeline remains newest first.

## Meaningful verification

The test suite covers complete investigations using both evidence rubrics, unsupported accusations, unavailable actions, goal-driven concealment, information transfer and correction, knowledge retention after object movement, a limited hidden-state counterfactual, exact replay, save/load continuation, and corrupt-save rejection.

Adapter regression tests exercise bounded chronological history, pagination, successful/rejected option markers and restore behavior, scene rendering, and chronological memories using a minimal DOM stub. They do not validate browser layout or accessibility.

Kernel diagnostics establish trace integrity. Configured-case validation additionally checks typed source support, finite alternative explanations and replayed routes. These are distinct obligations: neither replay integrity nor one successful investigation proves universal fairness. The original case retains authored evidence requirements.

## World-centered inspection

`dist/inspector.mjs` computes character sightings and missed opportunities from a selected event prefix and its reconstructed world. It never mutates the session or contributes to the player projection. A character's map uses their own movement observations; it does not substitute other characters' actual positions. Self position and travel are exact. Beliefs and recent belief changes are shown with their recorded sources. Full trace details remain explicitly omniscient.

The default inspector has no character sidebar. Selecting an event or character opens one contextual panel; the actual-world / character selector controls the main projection. The bottom slider remains event-index based, preserving order within a minute. Nearby meaningful milestones are shortcuts; future recorded milestones are labeled. No temporal compression or spatial routing is implemented in this iteration.

Missed opportunities require a separate spoiler reveal. They include unacquired physical evidence currently at visited places, unobserved recorded NPC speech, three authored evidence follow-ups, and a special moving-folio status. They are not a comprehensive solvability assessment or a judgment that every clue is required. All reports stop at the replay cursor; they do not use future acquisitions or encounters. Existing saves remain compatible without backfilling perception.

See [roadmap.md](roadmap.md) for the staged plan and manual acceptance checklist.

## Structured claims and case dialogue

`claims.mjs` validates attributed assertions and compares selected predicates. `last-bell-claims.mjs` supplies case-night presence intervals, document facts, and testimony. Acquisition time is separate from the asserted time. Speech records its authored reference and communicative metadata. The active character pipeline selects an account, bounded stance changes and an optional physical-plan capability; engine-owned handlers apply all consequences. Historical wording-only realization remains presentation metadata.

The claim projection used by Reasoning processes only player-visible events. It preserves old assertions and marks earlier claims by the same claimant/key as superseded. Overlapping location assertions with different values conflict; matching values agree. Disjoint death windows conflict. A planned appointment is a distinct predicate and does not establish presence. These are bounded comparisons, not a semantic solver, a confidence calculation, or proof of independent corroboration.

Claims are optional event metadata so version-1 saves remain readable. New claim payloads are validated on import. Older acquired evidence can be projected using the case catalog, without changing the saved history; old speech is not parsed retrospectively. Selected testimony notebook entries preserve actual source speech. Both claim revisions and retained original notebook evidence remain accessible as historical records.

Knowledge-driven correction/report actions compete with existing routines/warnings/concealment using recorded scores. Ada’s correction reaches Bell only after travel and speech; Clara’s report requires an actual local observation and sufficient trust. Perception does not reveal Silas’s intent or later object location. No broadcast correction or omniscient belief update is performed.

## Next milestones

See [roadmap.md](roadmap.md) for implementation status, the manual case checklist, and the eleven-part sequence toward richer cognition, symbolic validation, executable prehistory, improved deduction, and eventually procedural generation.

Conversation engagement is stored in `player.conversation` through event patches. The addressed NPC defers autonomous decisions across questions and evidence presentations while the rest of the town advances. Ending the conversation, switching speakers, or taking a valid movement, inspection, wait, or local accusation action releases the previous speaker and reevaluates their plans. Notebook and inspector browsing do not end engagement. Legacy saves without this optional field start disengaged.

Rejected movement, inspection, and unavailable follow-up requests preserve engagement. Source replies link to the preceding substantive speech event and explain that account; repeating a source question retains the same referent. Identity and coat follow-ups require prior relevant testimony, not merely any conversation with that NPC.

## Case artwork

`dist/art.mjs` is a presentation-only manifest keyed by case entity IDs. Local illustrations decorate avatars, navigation, scenes, inspector locations, inspection actions, and acquired evidence. Images never supply facts or mutate simulation state. Text remains available when images are absent or fail. Future procedural cases must follow the public-description asset-generation and packaging contract in [Art direction](art-direction.md).

## Player-built Reasoning board

The top-level Reasoning view replaces the notebook Claims tab. Players assign acquired clues to Motive, Means, Opportunity, or Alibi and choose supports/contradicts for each suspect. The UI does not consume the authored grading key. Automatic aids are limited to structured account conflicts and a timeline of acquired whereabouts. The death-window band requires a current player-visible death-time claim, acquired through the examination or Dr Marsh’s testimony; there is no fallback to hidden case constants. Board excerpts prefer the saved evidence entry’s text, preserving corrections made before testimony was acquired. Later revisions remain distinct historical statements rather than silently rewriting an earlier source.

`dist/dialogue-save.mjs` includes optional `reasoning: {version: 1, notes}` metadata in the save envelope. Notes never enter engine events or affect replay. Validation retains only known suspects, acquired clue IDs, valid pillars, and supports/contradicts values. Reload restores notes; explicit import replaces them, using an empty board for legacy or unsupported board metadata. Startup alone may migrate the former separate localStorage board for an existing legacy device save. Once the combined save succeeds, the old key is removed. Restart clears notes, and save failures use the existing visible warning instead of silently losing edits.


## Shared symbolic layer and remaining extensions

[Shared symbolic representation and solver integration](symbolic-reasoning.md) specifies the next architecture: versioned facts, events, assertions, beliefs, hypotheses and rules; perspective-scoped queries; adapters to multiple logics starting with Z3; and engine-owned admission of attributed inferences. World truth, testimony and belief remain separate. Derived conclusions retain dependencies and are reconsidered when premises change; possible models never silently become world facts.

The three main uses are future mystery generation, structured agent-output validation, and evaluation of the player's final case. Prioritize agent-output validation (use case 2): begin with observational plan checks, then add inference feedback, enforcement and bounded investigation-viability checks. ASP is an optional later adapter for discrete planning/generation; Lean is an optional certificate target. The Z3 adapter, two authored plan integrations and shared AI-selectable action capabilities are implemented; ASP and Lean are not. The symbolic service is independent of generative AI and must support scripted play as well.


## World Director: implementation and planned extensions

The World Director coordinates the Game Master's consistency, investigation viability and recovery responsibilities. This expands symbolic use case 2 rather than introducing a fourth use case: generation establishes an initial viable world; the Director checks whether consequential actions preserve a viable investigation; final-case evaluation checks the submitted argument.

The implementation now adds a bounded Director to engine preconditions, kernel diagnostics and authored policies: authored and bounded AI-selected plans use a common constraint compiler, and optional Z3 validates trial turns. A bounded acquisition search with engine replay checks an investigative witness for turns containing admitted take/store/give/conceal steps. New configurations additionally enforce local witness admission on all public dispatches and relevant intermediate access/deadline effects; robust global route search remains planned. The proposed Director evaluates isolated candidate post-states, calls the shared symbolic service, and returns an auditable allow/reject/alternative/defer/recovery decision. The engine remains the only executor. Agents receive no hidden-world facts from Director checks.

Check short-plan feasibility first. Then check evidence reachability before route-closing actions or deadline transitions, using the current proof bundles as initial search goals. Replay returned witness routes against the actual engine. Distinguish a found route, no route within stated bounds, and unresolved; never equate a finite search with a guarantee over all playthroughs. Recovery uses permitted authored actions and cannot rewrite the past. Both scripted and AI modes share these rules. See the [World Director contract](symbolic-reasoning.md#world-director-global-coordination-within-use-case-2) for ownership, failure policy, audit fields and acceptance criteria.


### Director implementation boundary

The synchronous engine records local admission for the authored integrations and shared queued plans, with immediate precondition checks at execution. Browser adapters opt into `commitDirectedTurn`: execute on a copy, query the independent Z3 service, verify returned witnesses and optionally replay an investigation route, then atomically replace state. Rejected local plans do not execute and do not make an otherwise harmless wait fail remote validation. Unknown service results defer required candidate turns. Full audits are non-public decision data, persisted in event history and excluded from player/character projections.

The solver-neutral compiler and immediate executor share typed steps; narrative effects stay in case callbacks. This is not a complete declarative replacement of the case behavior layer. The first version checks candidate plans under explicit assumptions, not arbitrary history or guaranteed future meetings. See [implemented scope](symbolic-reasoning.md#implemented-first-slice-september-2026) and [testing](director-testing.md).


## Shared plans and belief revisions

`actions.mjs` is the closed NPC action contract; `symbolic.mjs` compiles its
preconditions and effects, and `world-director.mjs` rechecks each executable step.
`agent-plans.mjs` builds perspective-limited capabilities and owns the replayable
pending-plan queue. Character turns may select a capability alongside dialogue;
engine scheduling executes it after conversation release. Actor observations and
attributed testimony are recorded at execution, never at proposal time. Case
transfer callbacks preserve the authored consequences in both modes.

`knowledge.mjs` owns source-linked replacement, retirement, explicit premise
support, transitive inference invalidation and intention completion. Retired
conclusions remain in historical snapshots. Automatic re-derivation and general
solver-to-knowledge inference admission remain roadmap items.

Director progress UI is tied to actual symbolic verification: ordinary scripted turns with no admitted plan query show no checking indicator. The pending message clears on completion or cancellation; no timed progress toast remains. AI and Director settings are independent.


## Refined target: dynamic admissibility and hard invariants

The full design treats physical/temporal coherence, legitimate information flow
and continued solvability as hard invariants across every admitted transition.
Character goals and narrative pacing rank choices only inside the legal space;
they cannot outweigh these invariants. Scripted opportunities and commitments
provide mystery structure while agents choose how to act within it.

The target has two stages: solver-assisted capability filtering before agent
deliberation, then concrete composition/next-effect validation before atomic
commit. Filter results carry dependencies and assumptions; changed world state
invalidates them. This applies to player, NPC and clock/deadline transitions,
including intermediate effects, not just whole turn snapshots. Preserve a route
the player can still achieve, not every optional encounter or inevitable victory.

A valid witness must account for future scheduling and cooperation; hypothetical
meetings cannot certify guaranteed access. Private constraint feedback and menus
must not introduce new character knowledge. Required unknown checks use valid
local alternatives, safe deferral or verified recovery, never silent approval.
The optional Z3 boundary and bounded acquisition/admission domain are only a partial
implementation of this general target. See the [formal design contract](symbolic-reasoning.md#governing-contract-autonomy-within-hard-invariants).

## Session-scoped configurations and executed history

`engine.mjs` now selects a cached runtime by session case ID. `engine-runtime.mjs` contains the case-bound façade and kernel assembly. `bellweather.mjs` builds three variants from explicit specifications; `prehistory.mjs` executes their evening events before the player arrives. UI tables, dialogue perspectives, replay and import follow the selected case. Legacy saves continue using the original case.

`investigation.mjs` searches observable acquisition actions and replays candidate solutions. `admission.mjs` provides mandatory local dispatch checks and preliminary capability filtering for the new configurations. Optional Z3 checks plans, new typed crime histories and accepted configured accusations. See [configuration design](case-configurations.md) for exact bounds, assumptions, compatibility and limitations.

## Composable narrative modules and validated generation

A case is a **base scaffold plus composed narrative modules** ("bricks"). `dist/modules/contract.mjs` defines the `NarrativeModule` interface and `resolveRoles`; `dist/modules/index.mjs` is the registry + `activeModules(spec)` composer (honoring a `requires` order and passing sibling `peers` so bricks can interweave). Each brick implements a subset of: `bind` (resolve role slots or sit out), `content` (additive clues/objects/proof routes), `prehistory` (sourced events/beliefs), `capabilities` (agentPermissions/commitments), `decide`/`onInteract` (drive and react to NPC behavior), `dialogue` (topic and present-reaction responses), and `invariant` (a brick-local coherence check). Four bricks exist: `misdirection` (an ambiguous sighting; the sighter, mis-seen innocent and alibi witness each speak to it faithfully), `correction` (the witness revises and travels to Bell to deliver it in person), `secret-affair` (a benign secret makes an innocent evasive; interwoven with misdirection via `peers`), and `concealment` (the culprit hides a document it knows about when pressed). `bellweather.makeCase` composes active bricks into the case tables, merges their capabilities, and consults them in `ask`/`present` and `decide`; `prehistory.mjs` runs their sourced prehistory before sealing provenance.

`dist/casegen.mjs` validates physical construction, the recorded crime IR, typed initial knowledge and evidence sources, bounded reachability, every declared route, finite competing explanations and module invariants. `sampleCases(seed, n)` varies culprit, weapon, motive, time, misdirection and structure, returning only candidates passing these local obligations. `validateCaseWithSolver` adds explicit Z3 certification. Current tests cover seeded samples and all three structures, not the whole expanded grid.

`buildSpec` and `specFromId` preserve generated parameters in the ID, including an optional structure suffix; older generated IDs mean `trace`. Runtime reconstruction is a separate API from sampling and does not itself rerun the full generation gate. Case assembly, validation and selection should therefore remain distinct contracts.


## Autonomous life implementation

Configured/generated cases now support persistent ordinary goals, timed activities, delivered social requests, accepted commitments and replanning. `life.mjs` drives scripted policies through shared move/activity constraints; `autonomy-turn.mjs` adds isolated optional model selection of bounded goal sequences. The original case retains its legacy policies. Z3 verification batches up to twelve queries per request under the existing atomic turn boundary. See [the complete implementation and test guide](autonomous-lives.md) for state, budgets, assumptions and limitations.

## Shared forensic milestone

New configured/generated cases now use typed source support, registered live belief rules, a shared crime/explanation IR, and a finite competing-explanation accusation grader. Generation varies `trace`, `cleanup` and `clockwork` structures and independently replays every declared route. Optional Z3 verifies recorded history and excludes competing explanations; local non-AI play uses the same finite rules. The original case retains its legacy rubric. See [the forensic model and testing contract](forensic-model.md) for exact scope, commands and limits.
