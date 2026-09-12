# Shared forensic model and investigative structures

This implementation applies to newly created Bellweather configurations and generated cases. The original `last-bell` keeps its authored accusation rubric and legacy knowledge policies. AI mode is not required. The finite model is experimental: its explicit assumptions are part of every query, not a universal proof of mystery fairness.

## Three consumers of one representation

`dist/forensics.mjs` compiles recorded crime history and acquired evidence to the same versioned integer/Boolean expression language used by physical plans. There are three query kinds: `plan-feasibility`, `crime-history`, and `crime-explanation`. The browser evaluates expressions locally; `server/symbolic_solver.py` translates them to Z3 without case-specific Python code.

1. **Creation:** execute the prehistory; check physical state and time; validate typed evidence producers and initial belief support; replay every declared solution route; require the acquired bundle to distinguish culprit, method and motive.
2. **Runtime:** configured belief updates require a registered support rule. Optional Director verification checks the recorded crime history once per verified session as well as new physical plans. Existing local plan and investigation admission still applies with both AI and Z3 off.
3. **Accusation:** compile only selected, acquired evidence; enumerate all compatible explanations; accept only a unique suspect/method/motive combination with an established medical window. If Director verification is on, independently ask Z3 for a consistent explanation and then for an alternative. Certification requires `sat` followed by `unsat`.

## Typed occurrences and knowledge

The prehistory now distinguishes fatal actions, appointment observations, examinations, document observations, clock checks, reports, cleanup and entrance-watch records. Evidence origins point to these occurrences. Claim validation checks predicate-specific production rules: a location record must match its observed participants and interval; a medical window must agree with the examination; a residue comparison must reference the recovered sample and matching method. Unknown evidence predicates fail validation.

Initial belief declarations preserve the exact rendered account and typed supporting premises. Merely pointing Clara's belief at Ada's valid clock event fails. A source must belong to the observer or be testimony actually delivered to them. The world query checks possession and co-location at the fatal action, continuous observed appointments, document access, examination ordering, and physical delivery of the report. Examinations may cite only a personally witnessed appointment.

Configured live beliefs pass through `model.validateBelief` before they can enter state. The extensible `knowledgeRules` registry covers seeded accounts, presented evidence, attributed player/NPC reports, witnessed transfers, local surveys, and the current correction and scrutiny inferences. An unknown rule or unsupported assertion fails closed. This validates the structured knowledge update; the dialogue critic remains responsible for the semantics of freely generated prose.

Testimony supports **that a speaker made an assertion**, not its truth. Player reports retain `truth: null`. Ada's fast-clock correction no longer concludes where another person was: the clock establishes timing only. The independent visit record is needed for a whereabouts correction.

## Competing explanations

The present domain contains three suspects, three methods, three motives and integer minutes from 20:00 through 23:59. It assumes one killer, one listed method and motive, and a fatal encounter in the study. The compiler reads public domains and evidence claims; it does not compare the accusation to `CASE.culprit`.

A medical window restricts the fatal time. A continuous location claim excludes a suspect when travel back to the study is impossible within that interval. Paired trace records restrict method only when both records are selected. Estate documents constrain motive. An entrance watch can constrain opportunity; a clock-dependent watch requires the separately acquired offset before it restricts any hypothesis. These are authored inference rules over structured records, not natural-language entailment.

The finite evaluator exhaustively tests this domain. It groups compatible times by suspect/method/motive and records their earliest and latest feasible times; those bounds are not a promise that every intermediate minute is feasible. Bell returns `supported`, `ambiguous`, `contradicted`, or `inconsistent`, names only selected acquired records, and identifies unresolved dimensions. Suggestions describe the kind of support needed rather than revealing hidden clues or locations. A complete route checklist no longer overrides ambiguity.

The optional Z3 path uses the same query and an additional constraint excluding the proposed suspect/method/motive combination. A solver timeout, unknown result, missing adapter or invalid witness never counts as certification. Browser play without the service still uses exhaustive finite evaluation.

## Structural variation

| Structure | Crime history and investigative work | Independent routes |
| --- | --- | --- |
| `trace` | Fatal blow damages the weapon and leaves a trace; compare the weapon, examination and independent whereabouts. | Physical records with original papers or their carbon copy. These two routes intentionally share most evidence. |
| `cleanup` | The killer additionally attempts to wipe the weapon, leaving a discarded cloth in the study. Recover the cloth and compare its residue with the laboratory record. | The existing physical route survives; a residue-and-continuous-watch route bypasses the damaged-object and alibi-record chain. |
| `clockwork` | Bell observes the study entrances, but one record uses the fast inn clock. Determine its offset before using that record as timed opportunity evidence. | Calibrated watch plus original papers, or an independently timed watch record plus the carbon copy. |

Bell travels to the manor before the watch, remains there through the observed interval, and returns to the square before receiving the doctor's report. Watching the entrances does not mean witnessing the killing inside the study. The clock uncertainty concerns timestamp calibration; it does not invent an identified face from Ada's ambiguous garment sighting.

Generated IDs encode the structure in an optional suffix. Old generated IDs continue to mean `trace`. The sampler includes all three structures and rejects candidates failing any obligation. This is bounded structural composition over a fixed cast/map, not arbitrary plot generation. All declared routes are independently searched and replayed; that is an existential witness under current scheduling, not universal robustness against every future action sequence.

## Testing and certification

In the game menu, choose **Generate a cleanup investigation** or **Generate a clock-dependent investigation**. Leave AI off. Collect only part of a proof and submit it to Bell; then add the missing support. Export and reload before resolving to test persistence. To exercise Z3 in play, start the existing Director service and enable its separate setting.

For reproducible offline certification, with Node and the repository's Z3 virtual environment installed:

```sh
npm run cases:verify -- 17 cleanup
npm run cases:verify -- 17 clockwork
node --test tests/forensics.test.mjs
```

`cases:verify` samples a candidate, runs the local generation obligations, then runs Z3 on history, explanation existence and alternative exclusion. It exits unsuccessfully on an unresolved solver result. `LIVING_MYSTERY_PYTHON` can select another Python interpreter. No HTTP server, credentials or LLM is needed for this command.

The browser's synchronous generation gate performs the local checks. It does not claim Z3 certification at creation; the optional Director verifies on play, or offline tooling certifies explicitly. Imported older histories are not rewritten to invent typed occurrences. Start a new configured/generated case to exercise the full crime-history certification contract.

## Limits and next extensions

The model excludes accomplices, unlisted weapons, multiple fatal acts, forged forensic documents, and alternative crime locations. Continuous entrance coverage and the reliability of signed forensic records are declared scenario assumptions. The current Z3 history query checks a recorded execution; it does not synthesize an arbitrary trajectory. Physical plans retain their separate transition queries.

Next work should add explicit reliability/forgery alternatives, richer event sequences and methods, evidence destruction and access prerequisites, social acquisition routes, and planner repair certificates. Expand the finite domain and its support rules before broadening generated prose. ASP may later search discrete story structures; no ASP, SMT-to-belief discovery loop, or Lean proof export has been added here.
