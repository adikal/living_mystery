# Roadmap: finish The Last Bell before generating mysteries

## Direction

The long-term goal is a playable town with simulated characters and generated, investigable mysteries. First make The Last Bell a complete reference case: believable interactions, actionable memories, executable history, and explanations for every consequential event. Keep the deterministic engine as the regression oracle. Optional AI character turns now combine response decisions and natural wording through perspective-limited context, a separate critic and atomic engine validation. Authored accounts bound disclosures and story consequences. Optional Z3 checks validate authored and bounded AI-selected plans; ASP and general symbolic cognition remain future work.

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

All six characters support optional free-text turns, combined intent/account/wording proposals, attributed player memories, bounded trust and belief updates, explicit endings, audited critic/revision attempts, atomic commits and deterministic replay. Existing action buttons use the same pipeline when enabled. See [contract and testing](character-turns.md). The World Director now checks bounded AI-selected physical plans as well as authored plans. Autonomous background LLM decisions and unrestricted plan composition remain future work.

The next quality milestone is broader structured-claim coverage, rule-driven re-derivation and solver-derived knowledge admission, followed by general bounded investigation search, executable prehistory and richer character planning. The finite action IR, Z3 admission, capability queue and explicit dependency invalidation are already implemented. Introduce ASP for discrete plan/generation search only when those domains are explicit. Neither solver replaces semantic dialogue evaluation. Complete and playtest The Last Bell before procedural generation.

## Next architecture milestone: shared symbolic reasoning

Design: [Shared symbolic representation and solver integration](symbolic-reasoning.md). First bounded Director/Z3 slice implemented; broader architecture remains planned.

Build one versioned model for physical events, assertions, beliefs, hypotheses and rules, with explicit perspective, time semantics and provenance. Translate supported fragments through adapters, starting with Z3; unsupported semantics must be reported rather than omitted. Add ASP only for a demonstrated discrete planning/generation need, and consider Lean only for independently checked proof certificates.

The three main uses are **procedural mystery/world creation**, **validation of structured agent outputs**, and **evaluation of the final argument to the constable**. Speech may be false without being an invalid action. Final-case reasoning must expose assumptions and explore alternatives without using the hidden culprit key. Generation must check physical consistency, distinguishability and reachable evidence separately.

Prioritize **use case 2**. The first shared IR, plan checks and bounded witness-replay slice is complete; continue through: precise shared schema and query contract → observational Z3 checks for character short plans through a small World Director → inference admission and enforced plan validation → bounded continued-viability checks for selected route-closing transitions → richer final-case reasoning and executable prehistory → procedural generation. Solver conclusions carry premises, perspective, applicable time, versions and status; possible, entailed, inconsistent and unresolved remain distinct. Preserve complete scripted play; symbolic checks do not require an LLM.

### World Director and continued investigation viability

The planned World Director is the global coordinator within use case 2, not another solver or a fourth use case. The Director checks authored and bounded capability plans and, when Z3 is enabled, requires an engine-replayed investigation witness for turns containing admitted take/store/give/conceal steps. The legacy `caseHealth()` indicator remains limited; neither it nor the new two-strategy witness check performs general reachability search.

First check candidate short plans for compound physical/temporal feasibility. Then check proposed route-closing effects and deadline crossings against bounded investigative reachability, initially using the existing proof bundles. A route must include executable acquisition and accusation actions, and its witness sequence must replay successfully in the engine. Keep one viable route rather than guaranteeing that all choices or optional encounters succeed.

Return explicit found/bounded-no-route/unresolved results with horizons and assumptions. Required unresolved checks defer a consequential transition or select a known-safe authored alternative; they never silently approve it. Recovery uses an explicit authored policy catalog, valid preconditions and recorded consequences. No retroactive evidence repair, hidden omniscient feedback, fabricated corroboration or intervention loops. Preserve failures and meaningful costs where a route remains.

Acceptance: equivalent scripted/AI proposals get the same validation; optional losses remain allowed; another valid route can sustain an investigation; last-route threats produce a permitted alternative or deferral; missed deadlines trigger reconsideration; witness routes survive engine replay; stale queries and solver failures cannot authorize changes; inspector audits explain all interventions. Broader adversarial/branch robustness comes later. See the [full Director design](symbolic-reasoning.md#world-director-global-coordination-within-use-case-2).

### Implemented Director slice and next work

- Ada’s correction and Silas’s folio concealment produce inspectable typed short plans in scripted mode.
- The shared IR and local witness evaluator check timing, location, possession and source knowledge. Immediate execution rechecks preconditions; future meetings remain conditional.
- Optional Z3 service on port 8788 verifies candidate turns independently of Bedrock. Query/result matching, witness validation, cancellation, stale-state checks and atomic application are covered by tests.
- Concealment turns require one engine-replayed investigation witness from two authored strategies. This preserves an explicit route under current deterministic policies, not all possible playthroughs.
- Inspector decisions show plans, constraints, source events, solver results and witness actions. See [setup and test scenarios](director-testing.md).

Implemented next layer:

- A closed action contract for move, observe, communicate, take, give and conceal (plus legacy store), shared by compilation and execution.
- AI-selected bounded physical plans, capability-checked against the current perspective and case policy, queued after validated dialogue, and rechecked at execution. The same queue/executor supports deterministic policies without any model calls.
- Generic source-linked belief supersession, transitive invalidation of explicitly supported inferences, cycle rejection, and completed-intention retirement. Ada's revised inference declares its premises; her correction uses the generic completion API. Independent testimony does not change remotely.

Next: broaden case-authored plan capabilities and real-model playtesting; move beyond the authored witness strategies to bounded symbolic reachability; add rule-driven re-derivation and solver-derived knowledge admission; add explicit last-route alternatives and recovery policies; extend validation to deadline crossings and intermediate states. Keep unsupported/unknown results explicit. Unrestricted plan composition, autonomous background AI turns, procedural generation and general final-case proofs remain future work.

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

## Next development sequence

1. **Playtest and evaluate the real AI pipeline; complete dialogue coverage.** Measure accepted replies, unnecessary fallbacks, unrelated answers, unsupported disclosures and latency using truthful, deceptive and uncertain scenarios. Extend communicative plans, follow-up chains, refusals, interruptions, and evidence reactions based on observed stalls. Expand the implemented account-selection and natural-response pipeline through playtesting; retain engine-validated disclosure capabilities.
2. **Build the shared symbolic representation and strengthen claims.** Implement the versioned vocabulary, adapter capabilities, perspective-scoped query contract and inference provenance described in the symbolic design. Add spatial rooms, clock-relative observations, uncertainty intervals, explicit retraction links, shared source ancestry, and structured assertion coverage of all consequential dialogue. Generalize the current presence/window comparisons.
3. **Z3 integration and inference feedback.** Prioritize use case 2 through observational and then enforced World Director plan checks, engine-admitted conclusions with dependency invalidation, and bounded evidence-route checks for selected consequential actions. Return source-linked explanations and explicit unresolved results. Check action preconditions, travel feasibility, object possession, ordering, and knowledge provenance against the shared schema. Permit false beliefs and lies while keeping physical history coherent.
4. **Execute the authored prehistory.** Simulate meetings, crime, cover-up, and evidence creation, replacing background summaries with inspectable events.
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
