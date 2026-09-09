# Shared symbolic representation and solver integration

Status: first implementation delivered for Ada’s correction and Silas’s concealment. The shared finite constraint IR, local plan admission, optional transactional Z3 adapter and engine-replayed investigation witnesses are implemented. The broader architecture below remains the target; bounded AI-selected plans and dependency invalidation are also implemented. General planning, exhaustive reachability, automatic inference re-derivation, ASP and Lean remain future work. This design applies to both scripted and AI play; a symbolic solver does not require an LLM.

## Purpose and boundaries

Build one versioned symbolic vocabulary, translate supported fragments into appropriate logics, and feed attributed inferences back through the engine's knowledge-update rules. The three main product uses are:

1. Creating coherent and investigable mysteries during future procedural generation.
2. Validating structured agent outputs against world constraints and information permissions, including their global effects on continued investigation viability.
3. Evaluating the player's final argument to the constable, with explicit evidence and assumptions.

Start with Z3. Keep the representation independent of its API. Add an ASP adapter only when discrete plan/event selection provides a demonstrated benefit. Lean is an optional later target for independently checked proof certificates, not a prerequisite for readable case arguments. Finish The Last Bell as the reference case before enabling procedural generation.

The event log remains authoritative. A solver is a query service, not a second world engine. Its outputs are proposals for knowledge updates or validation results; they never directly patch canonical history.

## Shared vocabulary

Use stable entity, event, claim and rule IDs. Separate these concepts explicitly:

| Concept | Required meaning |
| --- | --- |
| Entities | People, locations, objects and clocks; finite domains for the initial adapter |
| Events and actions | Occurrence time or time bounds, participants, preconditions, effects and causal sources |
| Physical facts | Authoritative world state and recorded events, scoped to their valid times |
| Assertions | Claimant, proposition, asserted time, acquisition time, source and modality |
| Beliefs | Holder, accepted/doubted/considered stance, confidence, provenance and current status |
| Hypotheses | Explicit temporary assumptions for a query, not committed world facts |
| Rules | Versioned constraints or inference rules with declared scope and applicability |
| Derived conclusions | Proposition, dependencies, perspective, validity and verification metadata |

Propositions should support typed predicates such as location, possession, identity and event ordering, with explicit negation and Boolean combinations in the initial supported fragment. Represent continuous presence separately from a point observation with uncertain time. An intended appointment is not an arrival; observing a coat is not identifying its wearer. Define time units, clock offsets and interval endpoint semantics before translating constraints. Existing inclusive intervals must be deliberately migrated or mapped, not silently reinterpreted.

Unknown, false and assumed false are different. Confidence is metadata about belief, not automatically a probability or a truth assignment. Repeated testimony with common source ancestry is not independent corroboration.

## Separate query perspectives

- **World validation:** authoritative physical facts plus world rules. Used by the engine/debugger, not disclosed wholesale to characters or players.
- **Character reasoning:** only information available to the selected character at the query event, plus explicit assumptions and permitted general rules. Private solver explanations must not leak another character's location, intention or knowledge into this context.
- **Player reasoning:** acquired evidence and statements, selected assumptions and known rules. Never include the culprit key, hidden proof-route bundles or undiscovered evidence to derive the answer.
- **Generation:** a proposed case specification and design constraints. The output is a candidate history for validation and simulation, not a runtime alteration of the current case.

The fact that a speech event occurred is authoritative; its asserted contents need not be true. Conflicting testimony is valid mystery content. Characters can retain inconsistent beliefs; query selected assumption sets and report conflicts rather than treating all beliefs as global axioms or deriving arbitrary conclusions from an inconsistent base.

## Adapter and result contract

A query contains a schema version, query kind, perspective/holder, event cursor and state digest, rule-set version, referenced claims/events, explicit assumptions, requested conclusion or variables, and resource limits. An adapter declares supported predicates, domains and logical constructs. It must reject unsupported constructs explicitly; do not drop constraints to obtain an answer.

The initial Z3 fragment should use finite entity domains, Boolean choices and bounded integer times with linear constraints. Avoid arbitrary user/LLM-supplied solver code. Trusted translation code compiles validated structured data.

Results distinguish:

- `sat`: a compatible assignment exists. A returned assignment is a possible history, not established truth.
- `unsat`: the supplied assumptions cannot jointly hold, with a source-linked conflict subset when available.
- `unknown`, timeout, unavailable or unsupported: unresolved, never approval or evidence against a hypothesis.

Possibility, entailment and contradiction are separate query kinds. To establish that a conclusion follows, first check that the premises are consistent, then test whether the premises plus its negation are unsatisfiable. An inconsistent premise set must never certify guilt. Preserve raw solver status separately from the user-facing conclusion.

Record model/schema/rule/adapter/solver versions, query digest, perspective, assumptions, dependencies, bounds and result. Conflict subsets are not guaranteed to be smallest; simplify within a bounded explanation budget and avoid claiming minimality unless checked. Model assignments and explanations must remain tied to the exact query.

## Inference feedback and truth maintenance

Solver results pass through an engine-owned admission step:

1. Confirm that the query's state and premise versions are still applicable.
2. Validate the conclusion's type, scope, evidence dependencies and disclosure permissions.
3. Record a derived-knowledge event linked to the query, premises and rules.
4. Update only the appropriate holder's knowledge, hypothesis or conflict state.

For example: Bell concludes that Silas's alibi conflicts with the receipt **assuming the receipt is authentic**, only after Bell has received the relevant evidence. This is not a finding of guilt and does not change the physical past.

Retraction or revision triggers dependency-based reconsideration. Preserve historical conclusions and their justifications, marking current conclusions unsupported when all valid supports disappear. Alternate valid supports may retain a conclusion. Deduplicate by normalized conclusion, scope and justification; inference cycles must not manufacture new evidence or inflate confidence. A solver-proven consequence need not automatically become a psychologically accepted belief: character policy decides whether to attend to or accept an available inference.

## Use case 1: procedural mystery creation

Solve for event choices, times, routes, possession and witness opportunities under a proposed case specification. Require causal origins for evidence and physically executable crime/cover-up histories. Run the candidate through the deterministic simulator to check that the formal model matches executable behavior.

Check physical consistency, investigative distinguishability and evidence reachability separately. A coherent history may still be impossible to investigate. A generated solution should survive alternative-culprit queries using only discoverable premises, within the declared suspect/domain assumptions. One successful route does not establish robustness under normal player choices.

Z3 is the first backend for these constraints. ASP may later express discrete event selection, recursive rules, defaults and plan search more naturally. ASP stable-model semantics cannot be replaced with ordinary implications without an appropriate translation; adapters must declare such semantic differences.

## Use case 2: agent-output validation

Keep ordinary engine checks for immediate conditions such as co-location and acquired evidence. Use the solver for compound temporal, physical and causal constraints across a proposed action or bounded plan. Both scripted and LLM-generated actions use the same executor and constraints.

Dialogue is checked differently: a deliberate lie or mistaken report may contradict physical truth and still be permitted speech. Check attribution, knowledge sources and disclosure capabilities. The language critic still checks that the actual words match the structured proposal; Z3 cannot establish that a natural-language translation is faithful.

Allow reasonable attempts based on false expectations. A character can travel to meet someone who has left and discover the failed encounter. Enforce execution preconditions without granting omniscient planning. Hidden world failures must produce only feedback the agent could legitimately receive.

The proposed sequence is: structured proposal → immediate engine checks and applicable solver queries → semantic dialogue critic when needed → atomic engine execution. If a required solver check times out or is unsupported, defer/reject that proposal or use a separately validated authored fallback; never silently approve it. Existing scripted play must remain available independently of an optional solver service.

## World Director: global coordination within use case 2

The **Game Master** is the overall coordination concept; the **World Director** is the component responsible for world consistency, continued investigation viability and permitted progression/recovery policies. It is not a fourth solver use case or necessarily an LLM. Use case 1 establishes initial coherence and investigability; use case 2 preserves them as the world changes; use case 3 evaluates the player's eventual argument.

### Current implementation versus planned behavior

Before the first Director slice, these responsibilities were distributed:

- Engine action rules enforce travel, co-location, acquired evidence and authored effects.
- Kernel diagnostics validate causal references, source-event existence and replay consistency. A replayable history is not necessarily a physically possible history.
- Last Bell's scored character policies select routines, concealment, warnings and reports.
- `checkCase()` grades against the canonical answer and two authored evidence bundles.
- `caseHealth()` counts acquired evidence and performs a narrow folio-location availability check. It does not search for an executable investigative route.

The World Director records and checks the authored correction/concealment plans and shared capability plans. Optional Z3 checks run transactionally around a turn, and turns containing admitted take/store/give/conceal steps require a replay-validated witness from two authored investigation strategies. There is still no general reachability search or automatic recovery planner. Passing these checks is evidence for the modeled plans and witness routes, not a guarantee against every dead end.

### Responsibilities and ownership

| Component | Responsibility |
| --- | --- |
| Character policy or LLM agent | Propose intentions, actions and bounded plans from the character's own perspective |
| World Director | Coordinate local/global checks, apply declared viability policy and select permitted alternatives or recovery |
| Symbolic service | Answer scoped feasibility and bounded reachability queries; return results and evidence, never mutate state |
| Engine | Recheck immediate preconditions, execute accepted actions atomically and record actual events |
| Language critic | Check correspondence between dialogue wording and the permitted structured proposal |

Use identical Director rules for scripted and AI-generated proposals. Extend this same boundary to player actions that can close routes, without requiring model calls for scripted play. Keep simple local checks in ordinary code. The Director may access authoritative world state for private checks, but agent feedback is limited to legitimately available information; omniscient explanations belong only in the inspector.

### Two validation points

**Plan feasibility:** before adopting a new character plan, test the relevant combination of timing, travel, access, possession, causal prerequisites and committed interactions. Do not treat another agent's tentative plan or a character's expectation as a guaranteed future event. Revalidate before consequential execution because the world can change. Mistaken but reasonable attempts may fail naturally; physical feasibility is distinct from guaranteed achievement of the intention.

**Investigation viability:** before a transition that can remove or gate evidence, examine the proposed post-state. Triggers include future evidence destruction, permanent departure, permanent refusal, access restrictions, missed deadlines, and combinations of concealment/trust changes. These are future action categories, not a claim that all exist today. Passage of time can also cross a critical deadline, so this check cannot be limited to newly submitted NPC plans. Ordinary speech and harmless movement need no full route search unless their declared effects cross such a boundary.

Use effect/dependency metadata to invalidate relevant cached checks. Query the post-state on an isolated candidate session; reject stale results and recheck execution preconditions. Never accept a physical violation merely because it would preserve the story.

### Define what "a route remains" means

The first viability model should target the existing authored proof routes: can a sequence of legal player actions still acquire a sufficient evidence bundle and present it to Bell? Include time, locations, travel, object access, disclosure prerequisites and relevant trust thresholds. The final-case reasoning model can later replace the authored bundle goal without changing the Director interface.

Return a witness sequence of actions and its assumptions when a route is found. Replay that sequence through the deterministic engine to catch disagreement between the symbolic transition model and executable rules. An abstract route that assumes an unavailable action is not a viable route.

Use bounded, explicit results:

- **Route found:** a replay-validated route exists within the horizon, under the declared NPC behavior assumptions.
- **No route within this model and horizon:** the bounded search excludes a route; do not label this universal impossibility.
- **Unresolved:** timeout, unsupported effects, unavailable solver or incomplete transition coverage.

One witness route establishes existential reachability, not success for every player choice or resilience to every future NPC choice. Initially model deterministic NPC policies. As richer agents are introduced, state which choices are fixed, assumed or adversarial; later robustness checks may test recovery across selected branches. Finding no route in a bounded search must not trigger arbitrary story repair presented as logically necessary.

The goal is to preserve some meaningful investigation route, not every clue, conversation or player choice. Missing an optional overheard exchange is a valid consequence. The player still has to investigate and reason; Director knowledge must not become automatic hints or accusation evidence.

### Decisions, fallback and recovery

The Director records whether it allows a candidate, rejects a physical conflict, chooses an already validated alternative, defers an unresolved decision, or schedules a permitted recovery. On an unresolved required viability check, defer the route-closing transition or use a known-safe authored alternative. Existing scripted paths must not become dependent on an unavailable optional solver service.

Recovery is an authored policy catalog first, not unrestricted model improvisation. Examples include a later meeting opportunity or a legitimate alternate way to access an existing document. Each recovery needs preconditions, costs/delays, causal provenance and ordinary execution effects. It cannot silently resurrect destroyed evidence, invent corroborating testimony, teleport objects, overwrite established events or coerce a character into unexplained disclosure. Bound retries and avoid loops of repeated interventions. Preserve consequences such as delay and lost optional detail where appropriate.

Record the triggering action/deadline, candidate-state digest, affected evidence routes, query assumptions and horizon, solver/adapter/rule versions, witness or conflict explanation, chosen policy and any intervention event IDs. Director decisions and recovery actions must be replayable and visible in the inspector, with player-visible effects shown only when actually observed.

### First Director milestone

Prioritize use case 2. Introduce a small Director interface around candidate short plans; run Z3 checks in observational mode before enforcing them. Start with a few authored character behaviors as reference fixtures, then allow richer proposals through the same boundary. Add bounded viability checks for a small explicit set of route-closing transitions, initially using the current two proof bundles as goals.

Acceptance must cover: impossible plans fail with explanations; conflicting tentative plans do not become guarantees; hiding an optional clue is allowed; losing one proof route is allowed when another replay-validated route remains; a last-route threat invokes a permitted alternative or deferral; deadline crossings are checked; timeouts never mean approval; recovery leaves an ordinary causal history; no hidden information reaches NPCs or the notebook; equivalent scripted and AI proposals receive the same decision. Mutate a test fixture to close routes rather than adding destructive gameplay solely to demonstrate the checker.

## Use case 3: presenting the final case

Evaluate the player's selected evidence, claims and assumptions rather than matching only an authored evidence bundle. Test whether premises fit together, whether the proposed account remains possible, what conclusions actually follow, and whether materially different accounts remain compatible.

Show a readable argument with source links and explicit assumptions: receipt authenticity, witness reliability, clock calibration, domain completeness or other required premises. Disproving an alibi establishes neither the murder nor its motive. Plausibility, opportunity and guilt must be distinct conclusions. Removing a premise should reveal which steps stop being supported.

Keep hidden answer-key grading separate from player-visible reasoning. An alternative-model search must not start by asserting the canonical culprit. If the formal crime model is incomplete, report limited support rather than inventing a proof of guilt. Lean can be considered later if independently checked formal certificates become a product requirement; it would certify deductions from premises, not the premises' real-world credibility.

## First implementation and acceptance

1. Define and test precise temporal/assertion semantics and the query/result contract against Last Bell data.
2. Implement a local Python `z3-solver` adapter behind a separate logical interface from Bedrock. Keep offline scripted play working without it. Benchmark before deciding whether browser WASM is worth its deployment overhead.
3. Prioritize use case 2: introduce the World Director interface and observational Z3 checks for candidate short plans, with source-linked results in the inspector. Account-compatibility queries are useful supporting diagnostics, not a prerequisite player-facing feature.
4. Add inference admission, dependency invalidation and perspective isolation tests; enforce bounded plan checks, then add continued-viability checks for selected consequential transitions. Validate route witnesses by engine replay.
5. Extend to final-case reasoning and executable prehistory; apply to procedural generation only after validating the reference case.

Acceptance examples: uncertain sightings can remain compatible until another constraint rules them out; clock correction changes the result; permitted lies do not invalidate the world; impossible physical plans are rejected; remote characters learn nothing from private checks; withdrawn premises invalidate dependent conclusions; repeated inferences do not count as corroboration; unknown/timeouts do not pass validation; alternate explanations are explored without the solution key; scripted and AI modes obey the same physical constraints.

Bound query horizons and execution time. Cache by complete semantic query inputs, not only event count. Store enough inputs/results to replay recorded runs without rerunning a solver, while allowing explicit re-verification under a named version. Run expensive generation/reachability searches outside ordinary dialogue latency. A bounded search failure must be labeled with its horizon, not called a universal impossibility.


## Implemented first slice: September 2026

`dist/symbolic.mjs` compiles move/take/store/communicate steps into finite integer state transitions, linear time constraints and named source-linked conditions. `dist/world-director.mjs` admits a concrete witness and executes the first step through immediate precondition checks; case callbacks provide authored speech, perception and belief consequences. Plans are reconsidered on arrivals/decision opportunities. That initial slice used authored plans. The shared-actions extension below also supports bounded AI-selected plans; it remains a capability catalog, not general action search.

`server/symbolic_solver.py` translates the same version-1 IR to real Z3. The adapter supports integer variables and typed eq/ge/le/add/and/or/not expressions, rejects unsupported syntax, uses separate request contexts, and bounds variables, constraints, expression depth, time and solver resource usage. Results include solver/adapter versions, a query digest, a satisfying assignment or source-linked unsatisfiable core. Cores are not claimed to be minimal. The service accepts structured constraints only, never executable solver strings.

`dist/director-turn.mjs` checks a trial turn before committing its state. The browser can enable this independently of AI under World Director settings. Each query must match the returned query and its satisfying assignment must pass the local evaluator. Cancellation and stale histories cannot commit; unavailable/unknown/rejected required checks defer the candidate with an inspector audit. Disabling Z3 returns to the existing authored executor with local plan checks. This is optional development validation, not a secure server authority.

Meetings after travel carry an explicit recipient-presence assumption; reaching the destination does not prove the recipient will be there. The immediate executor rechecks presence and source knowledge before speech updates the recipient's belief. Ada cannot correct Bell remotely. The recorded speech is the source of Bell's update. General solver-derived belief admission/retraction is still planned.

For turns containing admitted take/store/give/conceal steps, viability is currently tested **after the candidate turn** by replaying up to two authored acquisition strategies through the real engine (180 simulated minutes and 32 commands per strategy). The physical route can preserve solvability when the folio is concealed. A successful witness includes its commands and the existing authored accusation goal. Failed candidate search is `unresolved`, not `unsat` or proof of a dead investigation; the strict optional boundary defers that turn. This search is not Z3 reachability and cannot certify all intermediate states or future NPC choices. General deadlines, destructive actions, last-route alternatives and authored recovery scheduling remain later milestones.

No change is made to final accusation grading. No procedural generation, ASP, Lean or unrestricted new LLM actions are enabled. Offline tests use real Z3 for constraint/compiler integration and engine replay for plan/route behavior. Real LLM quality and browser visual QA remain separate.


## Shared actions and knowledge lifecycle

The next implemented layer adds a closed action vocabulary (`dist/actions.mjs`)
and replayable agent queues (`dist/agent-plans.mjs`). The compiler expresses
preconditions, linear travel time, holder/location effects and frame constraints
for observation, gifts and concealment as well as the original steps. Live
participants and case-declared containers override untrusted presence claims.
Zero-duration actions are instantaneous; future recipient presence is an explicit
assumption rechecked at execution. Model-selected plans use capability IDs from
a trusted catalog; they do not submit solver expressions or effects. The current
catalog is bounded, not general-purpose planning or an exhaustive action search.

`dist/knowledge.mjs` records replacements with their previous belief and source,
retirement reasons, and explicit premise key/source dependencies. Changing a
premise retires transitive dependent inferences for reconsideration. Cyclic
support is rejected; repeated identical source-backed updates are idempotent.
Case rules may re-derive conclusions from the new premises, but there is no
automatic solver-driven re-derivation yet. Supersession does not erase history,
rewrite evidence in the notebook, or update another character's independent
belief without a new information transfer. Generic testimony keeps its speaker
and unknown truth rather than promoting the source's certainty into world truth.
Intention completion retires the pending belief through the same mechanism.
