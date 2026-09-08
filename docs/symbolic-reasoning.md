# Shared symbolic representation and solver integration

Status: proposed design, not implemented. The game currently has typed claims, deterministic case rules, event provenance and replay checks, plus an optional language critic. No Z3, ASP or Lean runtime is integrated. This design applies to both scripted and AI play; a symbolic solver does not require an LLM.

## Purpose and boundaries

Build one versioned symbolic vocabulary, translate supported fragments into appropriate logics, and feed attributed inferences back through the engine's knowledge-update rules. The three main product uses are:

1. Creating coherent and investigable mysteries during future procedural generation.
2. Validating structured agent outputs against world constraints and information permissions.
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

## Use case 3: presenting the final case

Evaluate the player's selected evidence, claims and assumptions rather than matching only an authored evidence bundle. Test whether premises fit together, whether the proposed account remains possible, what conclusions actually follow, and whether materially different accounts remain compatible.

Show a readable argument with source links and explicit assumptions: receipt authenticity, witness reliability, clock calibration, domain completeness or other required premises. Disproving an alibi establishes neither the murder nor its motive. Plausibility, opportunity and guilt must be distinct conclusions. Removing a premise should reveal which steps stop being supported.

Keep hidden answer-key grading separate from player-visible reasoning. An alternative-model search must not start by asserting the canonical culprit. If the formal crime model is incomplete, report limited support rather than inventing a proof of guilt. Lean can be considered later if independently checked formal certificates become a product requirement; it would certify deductions from premises, not the premises' real-world credibility.

## First implementation and acceptance

1. Define and test precise temporal/assertion semantics and the query/result contract against Last Bell data.
2. Implement a local Python `z3-solver` adapter behind a separate logical interface from Bedrock. Keep offline scripted play working without it. Benchmark before deciding whether browser WASM is worth its deployment overhead.
3. Build a read-only inspector check for selected accounts, returning possible timelines or source-linked conflicts. This exercises the shared layer before it can mutate knowledge or gate actions.
4. Add inference admission, dependency invalidation and perspective isolation tests; then use validated results for bounded agent plans and optional player argument checks.
5. Extend to final-case reasoning and executable prehistory; apply to procedural generation only after validating the reference case.

Acceptance examples: uncertain sightings can remain compatible until another constraint rules them out; clock correction changes the result; permitted lies do not invalidate the world; impossible physical plans are rejected; remote characters learn nothing from private checks; withdrawn premises invalidate dependent conclusions; repeated inferences do not count as corroboration; unknown/timeouts do not pass validation; alternate explanations are explored without the solution key; scripted and AI modes obey the same physical constraints.

Bound query horizons and execution time. Cache by complete semantic query inputs, not only event count. Store enough inputs/results to replay recorded runs without rerunning a solver, while allowing explicit re-verification under a named version. Run expensive generation/reachability searches outside ordinary dialogue latency. A bounded search failure must be labeled with its horizon, not called a universal impossibility.
