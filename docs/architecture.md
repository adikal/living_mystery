# Architecture and inspection contract

## Product boundary

This version prioritizes a complete investigation and a causal debugger. It uses one authored mystery and bounded policies to make failures understandable before expanding generation or cognition.

The deterministic engine and case data are ES modules independent of the DOM. The browser and terminal are adapters. The browser renders `playerView(session)` during play; inspector code deliberately reads full state. Source secrecy is not a goal for this local single-player prototype.

## Module architecture (kernel / case / engine)

The simulation is split into three layers so that content and generation can grow without touching mechanics:

- **Kernel** (`dist/kernel.mjs`) — generic, case-agnostic mechanics: the append-only event log, reversible patches, deterministic replay (`worldAt`), save/load + integrity checks (`diagnostics`), and the neutral "simulation verbs" (`commit`, `believe`, `speech`, `witnessMovement`, `advance`, …). It knows nothing about a specific mystery. `createKernel(model)` binds it to a case's data tables and world factory; the NPC decision policy is **injected** via `kernel.decide` so the clock can drive character behavior without the kernel importing any content.
- **Case** (`dist/cases/last-bell.mjs`, data in `dist/case.mjs`) — one mystery as data + behavior: `model` (people/locations/clues/objects/case), `baseWorld(seed)`, and `createBehavior(kernel)` returning the policy (`decide`, `routineDestination`), the authored dialogue (`ask`, `present`), session seeding, `checkCase`/`caseHealth`, and the command parser. A second or **procedurally generated** case is another module of this exact shape.
- **Engine** (`dist/engine.mjs`) — a thin façade that assembles kernel + active case, hosts the generic action router (`dispatch`), and re-exports the stable public API the adapters and tests use. Swapping the active case is a one-line change here.

**Typed contracts** live in `dist/schema.mjs` (JSDoc typedefs — no build step): `Event`, `Belief`, `Action`, `Model`, `Kernel`, `CaseBehavior`, `Case`, plus a declarative `ACTIONS` catalog and `validateAction()`. This is the shared vocabulary a generator, a symbolic verifier, and an LLM action-proposer target: a proposed action can be shape-validated against the catalog before the kernel executes it. Deeper semantic/precondition validation still lives in the kernel/case.

This is the foundation for the roadmap's harder phases: generation produces a new Case `model`; verification checks the event log + action catalog; and an LLM may (later, behind validation) propose typed actions rather than only restyle dialogue.

## Generated dialogue, critic, and audit

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

The first history event anchors authored pre-game memories. Pre-game history is summarized, not generated by replaying action schemas in this version. This remains a future implementation task from the original design.

## Replay

`worldAt(session, index)` starts with `baseWorld(seed)` and reapplies patches through the selected event. It does not change the current state, create events, or query a model. The inspector uses that result for positions, intentions, trust, stress, and beliefs. It can still display later events as future entries in the recorded history.

Replaying recorded patches and rerunning the same commands are different checks. Tests cover both. Save restoration validates patches, causal references, supported event identifiers, source IDs, world consistency, and unsafe paths before accepting a state.

The current implementation reconstructs from the start, which is sufficient for a short case. Add periodic snapshots and indexed causal/actor lookups as histories grow. Replay is read-only; branching, diffing two runs, and editing state are deliberately not implemented yet.

## Knowledge

Beliefs record proposition keys, human-readable content, confidence, source type and event, acquisition time, and an inspector-only relation to authored case truth. Observation, testimony, inference, and speech assertions remain distinguishable. A false statement never becomes a physical world fact.

Movement perception is emitted at each arrival or departure boundary, including the detective’s initial arrival. Every other stationary NPC at that location receives an internal observation linked to the movement, then a memory event retaining that observation ID. Witnesses record the subject, arrival/departure phase, and observed location; they do not acquire the route, destination, or private purpose. Transit is not a shared perceptible location. Events within the same minute follow stable character iteration order. Movement observations can be recounted through sightings. A local folio-retrieval observation creates a belief that can enable Clara’s reporting plan; knowledge of a mistaken report enables Ada’s correction plan.

The inspector’s Memories tab reads the selected replay world’s retained IDs (currently capped at 80 per character), while the full timeline preserves all historical observations. Existing version-1 saves remain readable; past movement observations are not backfilled.

Initial belief provenance uses the case-history event. New knowledge travels via a real interaction. A later correction updates the recipient of that correction, not every person who heard the original rumor.

`playerView` exposes only public character descriptions, people currently encountered, previously observed locations, discovered evidence, personal hypotheses, and observed text. Local last-seen information can become stale. The inspector is a separately entered omniscient view.

## Investigation adapter

The main transcript renders only the five most recent player-visible entries, oldest to newest. A modal pages the complete observed transcript in groups of 20, also chronologically. Full engine history is retained for export and replay. Desktop panels constrain their own scrolling; the mobile transcript has a bounded height.

Scene changes show a from/to banner and arrivals have a distinct transcript treatment. Inspect, Talk, and Wait expose supported actions directly; the text parser remains optional. Local character highlights use the public projection. Question labels map to the deterministic engine's authored topics, with evidence presentation available separately.

Done markers are derived from matching command events without a directly caused rejection. Inspections match the object, questions match person/topic, and presentations match person/clue/tone. These markers work with existing saves and typed commands, do not disable actions, and do not imply an exhausted topic. Relevant evidence has case-authored reactions, with explicit limits for unsupported interpretations. Follow-ups are gated by acquired evidence, previous dialogue, and the recipient’s beliefs.

Memories display oldest to newest in acquisition order, with timestamps, locations, event IDs, and belief or speech content where available. Repeated conversations remain distinct episodes. An arrival followed immediately by departure may share a simulation minute because reading and choosing do not advance time; event order resolves that sequence. The debugger's full event timeline remains newest first.

## Meaningful verification

The test suite covers complete investigations using both evidence rubrics, unsupported accusations, unavailable actions, goal-driven concealment, information transfer and correction, knowledge retention after object movement, a limited hidden-state counterfactual, exact replay, save/load continuation, and corrupt-save rejection.

Adapter regression tests exercise bounded chronological history, pagination, successful/rejected option markers and restore behavior, scene rendering, and chronological memories using a minimal DOM stub. They do not validate browser layout or accessibility.

The built-in checks establish trace integrity, not fairness or completeness. General solver-backed identification and investigative reachability remain future work. The UI labels case routes as authored requirements.

## World-centered inspection

`dist/inspector.mjs` computes character sightings and missed opportunities from a selected event prefix and its reconstructed world. It never mutates the session or contributes to the player projection. A character's map uses their own movement observations; it does not substitute other characters' actual positions. Self position and travel are exact. Beliefs and recent belief changes are shown with their recorded sources. Full trace details remain explicitly omniscient.

The default inspector has no character sidebar. Selecting an event or character opens one contextual panel; the actual-world / character selector controls the main projection. The bottom slider remains event-index based, preserving order within a minute. Nearby meaningful milestones are shortcuts; future recorded milestones are labeled. No temporal compression or spatial routing is implemented in this iteration.

Missed opportunities require a separate spoiler reveal. They include unacquired physical evidence currently at visited places, unobserved recorded NPC speech, three authored evidence follow-ups, and a special moving-folio status. They are not a comprehensive solvability assessment or a judgment that every clue is required. All reports stop at the replay cursor; they do not use future acquisitions or encounters. Existing saves remain compatible without backfilling perception.

See [roadmap.md](roadmap.md) for the staged plan and manual acceptance checklist.

## Structured claims and case dialogue

`claims.mjs` validates attributed assertions and compares selected predicates. `last-bell-claims.mjs` supplies case-night presence intervals, document facts, and testimony. Acquisition time is separate from the asserted time. Speech contains an authored communicative plan (intent, belief basis, disclosure policy); LLM realization does not choose state changes.

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
