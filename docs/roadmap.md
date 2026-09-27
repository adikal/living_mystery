# Roadmap: finish The Last Bell before generating mysteries

## Direction

The long-term goal is a playable town with simulated characters and generated, investigable mysteries. First make The Last Bell a complete reference case: believable interactions, actionable memories, executable history, and explanations for every consequential event. Keep the deterministic engine as the regression oracle. Optional AI character turns now combine response decisions and natural wording through perspective-limited context, a separate critic and atomic engine validation. Authored accounts bound disclosures and story consequences. Optional Z3 checks validate authored and bounded AI-selected plans; ASP and general symbolic cognition remain future work.

## Implemented now: steps 1–3 toward controlled variation

1. **Bounded admission foundation:** acquisition search replaces fixed itineraries; every public dispatch in the new configurations and relevant intermediate access/deadline effects require a replayed solution witness. Capabilities receive preliminary effect filtering; Bell's availability is a public commitment.
2. **Parameterized executable prehistory:** case-scoped runtimes, actual evening travel, possession, crime, examination and report events, with initial knowledge and evidence linked to their sources.
3. **Three authored configurations:** The Ledger, The Codicil and The Notice vary culprit, means, motive and opportunity with the existing cast. All work without AI and have save/restore isolation and browser selection.

See [implementation and testing](case-configurations.md). This is a bounded reference domain. Bounded hybrid autonomy, finite forensic modeling and seeded structural sampling are now implemented. Complete symbolic cognition and arbitrary world generation remain future work.

## Implemented now: composable modules and validated generation (partial G2)

Building on the three configurations:

4. **Composable narrative modules ("bricks").** A case is a base scaffold plus composed modules (`dist/modules/`): misdirection, correction (the witness travels to Bell and corrects him in person), secret-affair (interwoven with misdirection), and concealment (a live culprit plan). Each brick contributes clues, sourced prehistory, capabilities and dialogue, and declares a local coherence invariant. Adding a trope is one module file.
5. **Case-general validator + seeded sampler.** `dist/casegen.mjs` admits a specification only if it passes physical, epistemic, reachability and evidence-driven distinguishability obligations plus every brick invariant; `sampleCases(seed,n)` returns only validated same-cast cases (the earlier parameter-only grid was validated; the expanded structural domain has seeded and per-structure regression coverage).
6. **Playable generated cases.** `gen-*` ids reconstruct their spec, so a sampled case resolves lazily, plays and saves/reloads like any configuration; a browser "generate a case" action starts one.
7. **Extended capability system.** Fetch (`from`/`knownBy`) and inform permission shapes let concealment and correction run as validated live plans, not scripted one-offs.

This is a bounded slice of G2 over the fixed cast with role-aware templated prose; new casts, relationships, maps and richly generated prose remain future work.

## Implemented: ordinary lives and bounded hybrid autonomy

1. All six configured-case NPCs have timed responsibilities, errands, energy/rest and persistent goal/plan state.
2. Invitations, acceptance and appointments are delivered and fulfilled through actual encounters, with conflicts, expiry and backoff.
3. The existing AI setting optionally selects one to three available goals under a one-request-per-turn budget, isolated NPC perspectives and atomic admission. Scripted policy remains the default.
4. Execution rechecks activity permissions, composed-plan timing and accepted commitments. Tests cover interrupted/unattended days, stale choices, failures, solver batches and preserved investigation routes.

See [Autonomous lives](autonomous-lives.md). Next broaden task effects to actual resource/relationship systems and richer contingent plans. General unrestricted autonomy and a universal no-dead-end guarantee remain research targets.

## Next major milestone: richer hybrid autonomy under hard invariants

**Proposed.** Preserve physical and temporal consistency, legitimate knowledge
acquisition and continued solvability across admitted transitions. Scripted
structure defines mystery facts and investigative opportunities; character goals
rank choices inside the admissible space. Missing optional content is allowed;
an unwinnable committed state is not. This is an explicit target, not today's
bounded acquisition/admission domain.

1. Specify viability goals, observable acquisition actions, transition coverage,
   horizons and future availability/cooperation obligations.
2. Add pre-deliberation capability filtering: cheap local checks followed by
   applicable symbolic queries, with source-limited feedback and dependency-aware
   certificates or constrained parameter domains.
3. Extend the implemented event-triggered life deliberation to richer social and investigative alternatives, with explicit resource effects and recovery choices.
4. Broaden existing composed-plan and next-effect validation, including player,
   clock and deadline effects. Unknown results require a verified alternative or
   safe deferral; do not assume waiting is harmless.
5. Expand witness search and recovery, testing last-route threats, stale results,
   competing agent choices, information leaks and repeated postponement.

Executable prehistory and preliminary effect filtering now exist for three authored configurations. General solver-assisted choice filtering, robust contingent investigation and exhaustive no-dead-end enforcement remain unimplemented. See the
[refined symbolic contract](symbolic-reasoning.md#governing-contract-autonomy-within-hard-invariants).

## Current inspector iteration

- World is the default view, controlled by the bottom event slider.
- A location grid highlights the selected event's location and shows actual occupants and travel.
- Character perspectives show self position, archived movement sightings of others with timestamps and staleness labels, current beliefs, and recent belief changes with source links.
- One optional detail panel shows an event or character. Trace details and integrity checks remain separate views.
- A milestone strip exposes nearby recorded movement, speech, belief, evidence, and resolution events. Later milestones are explicitly labeled as later in the trace.
- A separate spoiler reveal shows unrecorded physical clues at visited places, unheard conversations, selected unused evidence follow-ups, and the moved folio. Reports use the replay cursor.

This is a read-only debugger, not a player hint system. Character perspectives are a partial observation projection: they do not infer sightings from mere co-location, decode narrative belief text into map positions, or model forgetting. Object knowledge remains in beliefs; only the actual-world view reveals the folio's physical position. The selected-event caption and optional trace details are omniscient debugger context, not character knowledge. The movement archive includes all past observations even when older memory IDs leave the 80-entry retained memory list.

## Latest quality milestone: dialogue, claims, and knowledge-driven reactions

Implemented for The Last Bell:

- Evidence-gated follow-ups for source attribution, uncertain identification, documentary cross-examination, appointment motives, witness limits, and medical uncertainty.
- Silas retains a revised alibi after being challenged with the receipt; Clara may retract her cover story or refuse after a threat; Ada retains a clarified identification.
- Character-specific reactions to relevant evidence and explicit limits for evidence outside a witness's knowledge. Newly acquired testimony preserves the actual statement rather than an outdated stock summary.
- Typed attributed claims on evidence and selected speech, with subjects, predicates, values, inclusive case-night intervals, confidence, and source event IDs. Revised accounts supersede earlier claims without erasing them.
- A player-built Reasoning board replaces the Claims notebook tab. Players organize acquired clues by suspect and pillar, choosing supports/contradicts themselves. Objective account conflicts and recorded whereabouts remain available; the medical window requires discovered evidence or testimony. Cards preserve recorded testimony, and source links provide the full account. Board placements travel with exported saves. Planned meetings are not physical-presence evidence.
- Ada seeks Bell to correct an already-shared rumor. A cooperative Clara may report seeing Silas take the folio. Plans use beliefs and trust, travel to a real recipient, and record scored reasons and causal sources.
- Local observation of the folio retrieval; remote characters learn nothing. Sightings report the most recent retained occurrence of repeated movements.

The implementation is authored and bounded. The optional character mode accepts free-text questions but remains bounded by available authored accounts; it does not model general cognition or formally prove consistency. Claim annotations cover selected case assertions, not every sentence. Old acquired evidence can be projected through the case catalog without mutating its save; old free-text speech is not retroactively parsed. Earlier stock testimony and source events remain historical records.

## Implemented: character decisions and natural dialogue

All six characters support optional free-text turns, combined intent/account/wording proposals, attributed player memories, bounded trust and belief updates, explicit endings, audited critic/revision attempts, atomic commits and deterministic replay. Existing action buttons use the same pipeline when enabled. See [contract and testing](character-turns.md). The World Director now checks bounded AI-selected physical plans as well as authored plans. Configured cases also have optional background goal selection and bounded composition. Unrestricted physical planning remains future work.

The next quality milestone is broader structured-claim coverage, rule-driven re-derivation and solver-derived knowledge admission, followed by broader investigation planning, richer evidence-producing prehistory and character autonomy. Bounded acquisition search and three executed prehistories are now implemented. The finite action IR, Z3 admission, capability queue and explicit dependency invalidation are already implemented. Introduce ASP for discrete plan/generation search only when those domains are explicit. Neither solver replaces semantic dialogue evaluation. Playtest the bounded same-cast generator before expanding its domain.

## Shared symbolic reasoning: implemented slice and next extensions

Design: [Shared symbolic representation and solver integration](symbolic-reasoning.md). Plan, crime-history and finite explanation queries share the IR and Z3 adapter. General inference discovery, richer domains and multiple solver adapters remain planned.

Build one versioned model for physical events, assertions, beliefs, hypotheses and rules, with explicit perspective, time semantics and provenance. Translate supported fragments through adapters, starting with Z3; unsupported semantics must be reported rather than omitted. Add ASP only for a demonstrated discrete planning/generation need, and consider Lean only for independently checked proof certificates.

The three main uses are **procedural mystery/world creation**, **validation of structured agent outputs**, and **evaluation of the final argument to the constable**. Speech may be false without being an invalid action. Final-case reasoning must expose assumptions and explore alternatives without using the hidden culprit key. Generation must check physical consistency, distinguishability and reachable evidence separately.

All three use cases now have bounded implementations: generated-case validation, runtime plan/belief admission, and competing final explanations. Next extend their domains together: uncertain evidence and crime alternatives → social/contingent acquisition → recovery and robustness checks → richer structural generation. Solver conclusions carry premises, perspective, applicable time, versions and status; possible, entailed, inconsistent and unresolved remain distinct. Preserve complete scripted play; symbolic checks do not require an LLM.

### World Director and continued investigation viability

The World Director is the global coordinator within use case 2, not another solver or a fourth use case. The Director checks authored and bounded capability plans and, when Z3 is enabled, requires an engine-replayed investigation witness for turns containing admitted take/store/give/conceal steps. The legacy `caseHealth()` indicator remains limited. Acquisition search now constructs routes; its finite catalog and replayed deterministic policies do not cover arbitrary future branches. New configurations enforce this local admission independently of the optional solver.

First check candidate short plans for compound physical/temporal feasibility. Then check proposed route-closing effects and deadline crossings against bounded investigative reachability, initially using the existing proof bundles. A route must include executable acquisition and accusation actions, and its witness sequence must replay successfully in the engine. Keep one viable route rather than guaranteeing that all choices or optional encounters succeed.

Return explicit found/bounded-no-route/unresolved results with horizons and assumptions. Required unresolved checks defer a consequential transition or select a known-safe authored alternative; they never silently approve it. Recovery uses an explicit authored policy catalog, valid preconditions and recorded consequences. No retroactive evidence repair, hidden omniscient feedback, fabricated corroboration or intervention loops. Preserve failures and meaningful costs where a route remains.

Acceptance: equivalent scripted/AI proposals get the same validation; optional losses remain allowed; another valid route can sustain an investigation; last-route threats produce a permitted alternative or deferral; missed deadlines trigger reconsideration; witness routes survive engine replay; stale queries and solver failures cannot authorize changes; inspector audits explain all interventions. Broader adversarial/branch robustness comes later. See the [full Director design](symbolic-reasoning.md#world-director-global-coordination-within-use-case-2).

### Implemented Director slice and next work

- Ada’s correction and Silas’s folio concealment produce inspectable typed short plans in scripted mode.
- The shared IR and local witness evaluator check timing, location, possession and source knowledge. Immediate execution rechecks preconditions; future meetings remain conditional.
- Optional Z3 service on port 8788 verifies candidate turns independently of Bedrock. Query/result matching, witness validation, cancellation, stale-state checks and atomic application are covered by tests.
- Concealment turns require one engine-replayed investigation witness from bounded acquisition search. This preserves an explicit route under current deterministic policies, not all possible playthroughs.
- Inspector decisions show plans, constraints, source events, solver results and witness actions. See [setup and test scenarios](director-testing.md).

Implemented next layer:

- A closed action contract for move, observe, communicate, take, give and conceal (plus legacy store), shared by compilation and execution.
- AI-selected bounded physical plans, capability-checked against the current perspective and case policy, queued after validated dialogue, and rechecked at execution. The same queue/executor supports deterministic policies without any model calls.
- Generic source-linked belief supersession, transitive invalidation of explicitly supported inferences, cycle rejection, and completed-intention retirement. Ada's revised inference declares its premises; her correction uses the generic completion API. Independent testimony does not change remotely.

Next: broaden case-authored plan capabilities and real-model playtesting; broaden acquisition search to social actions and contingent futures; add rule-driven re-derivation and solver-derived knowledge admission; add explicit last-route alternatives and recovery policies; extend the new configurations’ access/deadline and intermediate checks to richer effects and the original case. Keep unsupported/unknown results explicit. Unrestricted plans, arbitrary world generation and general final-case proofs remain future work. Bounded life-goal composition, optional NPC model choices, same-cast sampling and finite competing-explanation grading are implemented.

## Visual identity for authored and procedural cases

The Last Bell now uses a shared illustrated art family for people, places, and selected artifacts, resolved by stable entity IDs. Every future procedural-case design must include the public-appearance asset manifest, fixed style references, identity-preserving variants, spoiler review, small-size review, and packaged static output described in [Art direction](art-direction.md). Image generation belongs in case preparation, never ordinary play. UI labels and interaction states remain in code. Expression variants and automatic procedural asset generation remain future work.

### Image-generation cost controls

Already implemented: generate once during development, package static assets, reuse portraits across views, illustrate selected artifacts, and keep UI labels and states in code. Image compression reduces storage and delivery costs; it does not reduce generation charges.

Before automatic procedural asset generation, implement:

- **Reusable approved asset library.** Share generic buildings, documents, tools, and clothing across cases within compatible styles. Generate new artwork only where it adds meaningful visual distinction.
- **Cache lookup before generation.** Match normalized public appearance, category, style/reference version, and asset specification. Persist approved results across cases and deduplicate identical pending requests; reloads and retries must not accidentally submit duplicate generations.
- **Per-case budgets.** Cap new assets, generation requests, and retries; enforce a spend ceiling where pricing/usage is available. Prioritize recognizable portraits and important locations. Use approved library assets or text/initials when the budget is exhausted.
- **Selective generation and revision.** Generate only library gaps. Review small batches, retry only failed assets within the budget, and edit approved portraits for required expressions instead of regenerating entire sets.
- **Usage and cost records.** Track requests, cache hits, retries, provider/model, and actual provider usage/cost when available. Label estimates as estimates and unknown costs as unknown; report totals per case and asset category.

Acceptance: preparing an unchanged case twice makes no new image requests; shared approved assets are reused across compatible cases; retry and budget limits hold under failures; a case remains playable with fallback artwork. These automated controls are planned, not yet implemented.

## Broader development sequence

1. **Playtest and evaluate the real AI pipeline; complete dialogue coverage.** Measure accepted replies, unnecessary fallbacks, unrelated answers, unsupported disclosures and latency using truthful, deceptive and uncertain scenarios. Extend communicative plans, follow-up chains, refusals, interruptions, and evidence reactions based on observed stalls. Expand the implemented account-selection and natural-response pipeline through playtesting; retain engine-validated disclosure capabilities.
2. **Build the shared symbolic representation and strengthen claims.** Implement the versioned vocabulary, adapter capabilities, perspective-scoped query contract and inference provenance described in the symbolic design. Add spatial rooms, clock-relative observations, uncertainty intervals, explicit retraction links, shared source ancestry, and structured assertion coverage of all consequential dialogue. Generalize the current presence/window comparisons.
3. **Z3 integration and inference feedback.** Prioritize use case 2 through observational and then enforced World Director plan checks, engine-admitted conclusions with dependency invalidation, and bounded evidence-route checks for selected consequential actions. Return source-linked explanations and explicit unresolved results. Check action preconditions, travel feasibility, object possession, ordering, and knowledge provenance against the shared schema. Permit false beliefs and lies while keeping physical history coherent.
4. **Deepen executable prehistory.** Three configured evening histories are implemented. Extend their action/evidence rules to richer cover-ups, ambiguous observations and the original case’s intrigue.
5. **Expand knowledge-driven decisions.** Information seeking, conflicting testimony, mistaken expectations, interrupted plans, explicit perception and memory policies, and communication goals beyond this case's correction/report/warning situations.
6. **Improve deduction play.** Extend the implemented player-built Reasoning board with editable timelines, richer claim comparison, targeted challenges, and explanations of how evidence supports a theory beyond the current accusation rubric. Keep optional grading separate from the ungraded workspace.
7. **Evaluate and improve AI dialogue.** Build adversarial truthful/lying/uncertain reference sets; measure critic false acceptance and rejection, voice consistency, and latency. Support a separately configured critic model. Mocked orchestration tests are not model-quality evaluations.
8. **Broaden solvability and recovery.** Extend the first Director checks from milestone 3 across more investigative branches and uncertain NPC choices; test recovery-policy coverage and bounded-search limitations. Different investigative choices should retain viable routes. Distinguish optional clues, expired encounters, essential evidence, and believable recovery from damaged trust.
9. **Deepen the inspector and debrief.** Belief-evolution tracks, focused causal graphs, bookmarks, branch-from-command-boundary, run comparisons, and failed-plan explanations. Keep player hints separate from omniscient debugging.
10. **Build a spatial playable town.** Coordinates, route segments, visible journeys, routines, environmental interactions, and a top-down client; retain text play and debugging contracts.
11. **Controlled procedural generation.** Vary schedules/evidence placement first, then motives/methods/culprits/relationships, validating both physical consistency and investigative distinguishability. Apply the asset-library, caching, budget, retry, and usage controls above before enabling automatic image generation for new cases.

## Test the latest case work

- Visit the vestry, ask Silas for his alibi, inspect the delivery register, then open Reasoning and select Silas. Place the alibi and receipt under pillars of your choice and compare the accounts. Use the new receipt challenge in Talk, and ask for his alibi again to check the retained revision.
- Acquire the surgery record, ask Clara about her alibi, then challenge it. Compare a cooperative approach with a threat; presenting the record privately offers a recovery path.
- Let Ada report to Bell, then show her the clock evidence at the inn. Wait and inspect her correction plan and the later conversation at the square. Bell should retain the old report until that encounter.
- Reassure Clara, expose the accounts to Silas, and follow his retrieval. Clara only reports it if she was present to see it and remains cooperative.
- Ask witnesses how they know, what they actually recognized, and what their evidence cannot establish. Ask Iris whether the examination identifies a specific weapon.

## Reasoning board acceptance checks

- Acquire only the inn-clock clue: the board must not reveal the medical window. Read the examination or hear Dr Marsh’s account to establish it.
- Correct Ada before first recording her testimony; place her evidence on the board. Its excerpt and source must use the recorded correction rather than the static original account.
- Place and flip cards, export, import elsewhere, and confirm the board returns. Importing a legacy save clears unrelated board notes; restarting clears all placements.

## More sophisticated inspector

- A meaningful-event timeline that compresses quiet intervals while retaining exact time and ordering; searchable bookmarks and event-density markers.
- Movement animation and route segments on a spatial town map, with reduced-motion support.
- Belief evolution tracks across time, confidence changes, retractions, and source chains distinguishing observation, testimony, inference, and deception.
- A focused causal graph on demand rather than a permanently visible graph of everything.
- Compare actual state, character understanding, and two branches without conflating them.
- Structured object-location knowledge, relationship changes, perception/forgetting policies, and explicit knowledge coverage for older saves.
- A richer missed-opportunity review: opportunities that genuinely expired, remaining routes, recovery paths, and optional versus necessary evidence. Current reports are authored heuristics, not a proof of fairness or a completion score.
- A spoiler-light player hint system separate from the omniscient inspector, and a post-case debrief tracing discoveries and missed encounters.
- Replay checkpoints, indexed event queries, and performance budgets for long histories.

## Manual acceptance pass for this iteration

1. Refresh, enter Inspector, and confirm World opens without a side panel.
2. Scrub from the start through several journeys; verify positions and travel change. Step through arrival/departure events sharing a minute.
3. Select Bell's perspective after leaving the square. The detective should remain a last-seen departure from the square, not appear at their current location elsewhere.
4. Select Clara, review beliefs, and follow a source. Close the detail panel and return to the live moment.
5. Reveal Missed opportunities after visiting the manor; inspect a clue in play and return. It should disappear from the live missed list but reappear when scrubbing before acquisition.
6. Check Trace details, character memories, milestone navigation, and Checks remain reachable.
7. Export/import, repeat the checks, and confirm play remains deterministic. Existing saves lack backfilled movement observations.

Do not commit or push this iteration until the user's test pass is complete.

## Implemented forensic milestone

The shared forensic representation, finite competing-explanation grader and three investigative structures are implemented for newly created configured/generated cases. See [the exact contracts and limits](forensic-model.md). Typed source checks replace source-ID-only admission; configured live beliefs require registered inference rules. Z3 can check recorded crime history and exclude alternative culprit/method/motive explanations. The browser still supports a fully local non-AI path.

Every declared route is independently replayed. This milestone does not establish arbitrary story synthesis, universal no-dead-end guarantees, automatic theorem discovery, or natural-language entailment. The original case retains its authored grader.

## Next sequence toward broader procedural worlds

1. Playtest all three structures and autonomous lives. Measure clue clarity, difficulty and whether alternative routes feel different. Add accessibility and regression cases from playtests.
2. Extend the crime domain to alternative locations, multiple acts, forgery, uncertain forensic reliability and additional opportunity constraints. Require counterexample tests and provenance rules for every new predicate.
3. Add social acquisition, appointment-dependent evidence, explicit recovery routes and contingent investigation search. Validate robustness against bounded autonomous disruptions, beyond one successful replay.
4. Compose more distinct evidence-production sequences and relationships, with rejection diagnostics and bounded repair. Use symbolic planning when it adds measurable value over the finite sampler.
5. Broaden to new casts and maps after those contracts hold. Apply cached artwork and generation cost budgets during preparation; runtime image generation remains unnecessary.

## North star and next steps (September 2026)

North star: an endless supply of mysteries as rich as Christie's, in any setting, whose characters live and talk
believably, and where the engine guarantees every case stays fair and solvable however the player behaves.

1. **Richer case content from the generator**: the doctor's examination, evening accounts, observable traits and
   per-character reactions are in place; still to do: who found the body, what the village knows, and more witness detail.
2. **Adventure verbs**: take, use, combine, give, and tone, with an inventory and a dead-end check in certification.
3. **Generation speed and scale**: in-game generation works but takes 10–20 minutes; target 5–7 (parallel steps,
   smaller prompts), then a pool of cases generated in the background so a fresh one is always ready.
4. **Blocks as code**: the block library compiled and tested, with the five design-note examples as acceptance cases.
5. **Beyond "who"**: how, why, when, identity and "what happened" questions in play, with matching accusation forms.
6. **Living characters in generated cases**: daily lives and autonomous plans driven by the case's attitudes (a culprit
   who fears a witness acts), re-admitted by the step search because such plans can change evidence.
7. **New settings**: generate setting ontologies and art, not only Bellweather.
8. **Evaluation**: blind-solve agents and player tests measuring whether the twist misleads and the solution satisfies.
