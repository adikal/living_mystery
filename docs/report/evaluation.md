# 9. Evaluation, evidence and reproducibility

**Status: automated regression evidence; player studies and real-model quality experiments are proposed.**

## 9.1 What current tests establish

The implementation was validated on 2026-09-27 with 198 passing JavaScript tests and 22 passing Python tests (plus the harness and premise-deck tests). The real-solver JavaScript subset is opt-in: it skips cleanly when the `.venv`/Z3 dependency is absent, so a checkout without the solver still reports a green suite. The suite covers engine behavior, claims, saved dialogue, character orchestration, shared plans, solver integration, configured cases, composable narrative modules, case generation and UI adapter logic, and now the primitive algebra, the declarative composition compiler, the affordance grammar and mechanism compiler (including the icicle/scarf/chandelier objects and forced-insight), and the LLM composer's propose→compile→validate→repair→fallback loop under a scripted mock model, and now the deep-case path: the fair-play, discovery-depth and inversion-anchor obligations, the three-shape generator certified at a five-hop discovery depth with load-free red-herring fog, the full-artifact composer (`composeArtifactCase`) and its safe expander, and the in-room disclosure UI (sectioning and hidden gated leads). The legacy generation-pipeline tests were retired with those generators; the suite now covers the engine, characters, Director, UI and the mystery kernel. The mystery kernel adds its own tests: kernel semantics, a playthrough of every published generated case (gated start, solved only by the truth, every wrong suspect rejected, save/reload), and a parity check in which the Python and JavaScript checkers agree on every generated case (443 at last run), and the Z3 case oracle agrees with the kernel on every depth-bounded survivor set tested (1,110 checks). These are engineering regression results for this working tree, not player-study or model-quality measurements.

| Property | Representative evidence | Boundary of the conclusion |
| --- | --- | --- |
| Replay integrity | Event-prefix reconstruction, import/export, save continuation | Replay can faithfully reproduce a wrongly modeled event. |
| Physical admission | Invalid travel, possession, containers and recipient checks | Only represented constraints are covered. |
| Knowledge locality | Ada correction, local folio witnesses, no remote transfer | General line of sight and hearing are not modeled. |
| Belief lifecycle | Transitive retirement, source changes, cycles, historical snapshots | Dependencies must be explicitly declared. |
| AI orchestration | Mocked generation/critic, fallback, cancellation, stale tickets | Does not measure real-model semantic accuracy. |
| Z3 integration | Actual Python Z3 execution, satisfiable and inconsistent fixtures | Shares the compiler's modeling assumptions. |
| Investigation route | Acquisition search plus engine replay solves all three configurations | Finite catalog, authored goal and deterministic scheduling; no universal proof. |
| Admission preservation | Last-route loss, intermediate restoration, deadline waiting, optional loss and weapon-capability filtering | Narrow declared access/expiry domain; no general social or adversarial future coverage. |
| Executed prehistory | Actual travel, possession, crime state, evidence ancestry and save continuation | Typed plan fragments plus direct guards, not a complete SMT crime theory. |
| Module composition | Brick activation/omission, additive content, `peers` interweave, each brick's invariant, and the live correction delivered to Bell | Role-based over the fixed cast; not arbitrary-cast composition. |
| Case generation | Seeded-sampler determinism/validity, per-structure route replay, acquired-evidence explanation checks and save/reload | Current coverage is not exhaustive over the expanded structural domain; finite crime assumptions remain explicit. |
| Interface behavior | DOM-stub rendering and event-handler regressions | Does not establish browser layout or accessibility. |

The build for this report separately checks chapter and figure references, internal anchors, source-map paths and generated output. Documentation validation does not rerun the game or establish a new simulation result.

## 9.2 Reproduction commands

Use Node 20 or newer for the JavaScript suite. Real-solver integration tests expect the repository's Python virtual environment with the pinned solver dependency installed.

```sh
python3 -m venv .venv
.venv/bin/pip install -r server/requirements-solver.txt
npm test
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

For interactive Z3 checks, run `.venv/bin/python server/director_server.py`, refresh the game, and enable World Director. AI character testing additionally requires the configured model proxy and credentials described in the repository README. No live model requests were made to write this report. The [case studies](case-study.md) provide manual scenarios; acceptance should be judged from actual committed events, not merely whether a character says it agreed.

## 9.3 Proposed evaluation program

A first real-model dataset should cover truthful answers, permitted lies, uncertain observations, evidence-backed revisions, irrelevant questions, injection attempts, unsupported promises and explicit conversation endings. Human annotations should identify allowed disclosures and concrete semantic violations independently of the tested critic. Measure false acceptance and false rejection separately; a critic that rejects every reply is safe only in a narrow and unhelpful sense.

Record acceptance/fallback rates, semantic violation categories, end-to-end latency distributions, request counts and provider-reported usage. Stratify by character, account type and model configuration. Compare scripted baseline, generation without the critic, the current critic pipeline, and plan validation variants. Any ablation that removes safeguards belongs in isolated evaluation runs, not ordinary saves.

For the Director, generate counterexample families by varying departure times, travel durations, object holders, recipient availability and evidence accessibility. Measure invalid commits, unnecessary deferrals and the fraction of admitted witness routes that replay. Separate compiler failures from adapter failures and executor mismatches. A passing collection of hand-selected examples is insufficient evidence for domain completeness.

For user experience, ask players to explain an apparent contradiction and authors to diagnose a failed plan. Compare task accuracy, time and confidence with and without focused provenance views. Also measure play outcomes: abandonment, repeated unproductive questions, perceived agency and whether missed opportunities feel understandable. Small early studies should be reported as exploratory rather than universal estimates.

## 9.4 Threats to validity

The case is authored around known scenarios, so test success may reflect favorable coverage. The same model route generates and criticizes dialogue, allowing correlated error. Bounds and fallback policies change the effective task distribution. Scripted witness replay assumes current NPC policies. Confidence labels may invite stronger interpretations than their derivation warrants. Inspector access can contaminate a player study unless spoiler exposure is controlled.

A future evaluation release should archive code revision, configuration, case specification, seeds, command traces, solver versions, evaluation prompts and scoring rubrics. Model version and date matter because fresh requests are not guaranteed to reproduce prior wording. Event-log replay remains the reproducible record of an accepted run.


## 9.5 Acceptance for constrained autonomy

The proposed next evaluation must include player actions, clock/deadline effects
and competing NPC transitions. Check that optional losses remain possible while
last-route losses are blocked before commit, stale certificates cannot authorize
changed effects, and composed plans are checked beyond their individual actions.
Compare equivalent scripted and AI proposals under identical world states.

Test required-check timeouts, unsupported actions, safe deferral at deadlines,
future-meeting assumptions and repeated postponement. Inspect both returned text
and capability availability for private-information leakage. Report how each
witness depends on its horizon, scheduler and observable acquisition policy.
The current suite covers selected access/deadline counterexamples and configuration isolation. Robust futures, broad leakage analysis, repeated postponement and real-model evaluations remain acceptance obligations.


## 9.6 Daily-life regressions

The new suite exercises unattended ordinary days, social delivery and fulfillment, timed work and conversation pauses, save continuation, unsuccessful encounters and retry delay, composed-plan appointment conflicts, unauthorized tasks, stale model responses, timeout/cancellation, solver batching and preserved solution witnesses after varied generated schedules. Actual Z3 checks cover satisfiable activity sequences and an impossible completion deadline. UI adapter checks cover historical life inspection and cancellation of background deliberation. Model requests are mocked; no live-provider quality result is claimed.

## 9.7 Forensic regression evidence

The expanded suite passed with 162 JavaScript tests, zero skips, and 10 Python tests on 2026-09-12. New checks cover unrelated source IDs, unsupported live beliefs, altered evidence producers, clock calibration, every declared route in each structure, acquired-evidence-only accusations, wrong methods, unresolved motives, save/reload, and structure selection in the UI adapter. Real Z3 checks confirm history feasibility and alternative exclusion for all three structures, reject inconsistent death timing, and exercise the optional Director path with AI off. Offline certification was also run for a seeded clock-dependent case.

These tests exercise structured logic and orchestration. They do not measure human puzzle quality, full generated-space coverage, browser visual layout, or live LLM dialogue quality. Earlier full-grid claims apply only to their earlier smaller configuration domain.
