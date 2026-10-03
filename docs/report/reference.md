# 11. Glossary, source map and report maintenance

## 11.1 Glossary

| Term | Meaning here |
| --- | --- |
| Account capability | An authored statement and permitted claims/consequences offered to a character turn. |
| Action contract | Closed action shape, with shared compiler and execution semantics. |
| Assertion | Attributed contents of speech or evidence, potentially mistaken or deceptive. |
| Belief | A character's retained proposition with confidence and provenance. |
| Candidate turn | Isolated execution whose effects are not yet authoritative. |
| Case model | Content and policies for a particular mystery, bound to the kernel. |
| Causal parent | An event ID recorded as a cause or support, distinct from simple earlier occurrence. |
| Case validator | The case-general check (`casegen.validateCase`) admitting only physically executable, legitimately sourced, solvable, distinguishing and module-coherent specifications. |
| Critic | A model call assessing a proposed reply against permitted content and context. |
| Dependency invalidation | Retirement of conclusions whose explicitly recorded premises changed. |
| Distinguishability | Whether discoverable evidence discriminates the intended culprit from alternatives; checked on structured claims and confirmed against the accusation grader. |
| Event prefix | History through a particular event index, including order within a minute. |
| Frame constraint | A condition preserving an entity's state across an action that does not change it. |
| Intention | A character's desired future behavior; not evidence of its completion. |
| Narrative module (brick) | A reusable, parameterized unit of detective fiction composed onto a base case, contributing content, sourced prehistory, capabilities and dialogue and declaring a local coherence invariant. |
| Plan capability | A trusted bounded sequence of typed actions available to a policy. |
| Provenance | Recorded sources and dependencies supporting an event, belief or conclusion. |
| Replay witness | A concrete sequence of commands that reaches a goal in the engine. |
| Shared IR | An intermediate representation translated into a supported solver fragment. |
| World Director | Coordinator of selected plan admission and continued-investigation checks. |

## 11.2 Source map

These paths are relative to the repository root. The report build checks their existence. Follow the associated chapter for the interpretation of each implementation boundary; code remains the authority if a document becomes stale.

| Repository path | Responsibility | Chapter |
| --- | --- | --- |
| `dist/kernel.mjs` | Event commits, replay, time, travel, perception, import checks | [Architecture](architecture.md) |
| `dist/engine.mjs` | Case assembly, action routing, transactional character execution | [Architecture](architecture.md) |
| `dist/engine-runtime.mjs` | Case-bound command runtime and kernel assembly | [Architecture](architecture.md) |
| `dist/prehistory.mjs` | Executable evening events and evidence origins | [Generation](generation.md) |
| `dist/cases/bellweather-configs.mjs` | Three authored case specifications | [Worked examples](case-study.md) |
| `dist/cases/bellweather.mjs` | Configured tables, scripted dialogue and evidence rubric | [Generation](generation.md) |
| `dist/investigation.mjs` | Bounded acquisition search and witness replay | [Director](director.md) |
| `dist/admission.mjs` | Mandatory configured transition checks and capability previews | [Director](director.md) |
| `dist/case.mjs` | Authored people, places, evidence and case solution | [Worked examples](case-study.md) |
| `dist/cases/last-bell.mjs` | Scripted policy, dialogue, case consequences and reconciliation | [Worked examples](case-study.md) |
| `dist/schema.mjs` | JSDoc contracts and player-action catalog | [Architecture](architecture.md) |
| `dist/knowledge.mjs` | Belief revisions, explicit supports, retirement, intention completion | [Knowledge](knowledge.md) |
| `dist/claims.mjs` | Structured claims and bounded comparison | [Knowledge](knowledge.md) |
| `dist/cases/last-bell-claims.mjs` | Authored case-night claim annotations | [Knowledge](knowledge.md) |
| `dist/character-turn.mjs` | Tickets, model proposal, critic and application checks | [Character turns](characters.md) |
| `dist/modules/` | Composable narrative bricks: `contract.mjs`, `index.mjs` (registry + `activeModules`), and `misdirection`/`correction`/`secret-affair`/`concealment`/`manner-of-death`/`poisoning`/`icicle`/`scarf`/`chandelier` | [Generation](generation.md) |
| `dist/casegen.mjs` | Case-general validator (four obligations + module invariants + forced-insight) and the seeded validated sampler | [Generation](generation.md) |
| `dist/primitives.mjs` | The versioned primitive algebra (entity ontology, CONSTRAINT primitives, claim-predicate compilers, occurrence facts) and the affordance grammar | [Generation](generation.md#10-10-the-primitive-algebra-and-the-composition-compiler) |
| `dist/composition.mjs` | Declarative composition compiler: composition data → brick hooks (clues, typed claims, routes, occurrence-DAG) | [Generation](generation.md#10-10-the-primitive-algebra-and-the-composition-compiler) |
| `dist/objects.mjs` | Object catalog — names/injuries/affordance bundles, validated fail-closed against the grammar | [Generation](generation.md#10-11-an-affordance-grammar-means-as-an-open-object-catalog) |
| `dist/mechanism.mjs` | Mechanism compiler: an affordance-typed composition validated against the grammar | [Generation](generation.md#10-11-an-affordance-grammar-means-as-an-open-object-catalog) |
| `dist/llm-composer.mjs` | Prep-time LLM composer: propose over the palette → compile → validateCase → repair → fallback; live proxy adapter | [Generation](generation.md#10-13-the-llm-composer) |
| `dist/case-artifact.mjs` | Deep-case artifact schema + compiler (neutral observations, gates, forces, inversion) and `expandArtifact` (safe LLM-artifact expander) | Depth note (docs/depth-operators.md) |
| `dist/operators.mjs` | Coherence-preserving artifact→artifact depth operators (add/gate/interpolate/force/declare-inversion) | Depth note (docs/depth-operators.md) |
| `dist/deep-generator.mjs` | Deterministic seed-driven deep-case generator: three shapes (time/motive/means), ~5-hop discovery ladders + load-free red-herring fog | Depth note (docs/depth-operators.md) |
| `dist/mk/kernel.mjs` | Mystery kernel: sign semantics, access/reading depth, thread depths and certification | Mystery kernel note (docs/mystery-kernel.md) |
| `dist/cases/kernel-case.mjs` | Bridge from certified kernel records to the runtime case interface (history, beliefs, gated signs, accounts, grading) | Mystery kernel note (docs/mystery-kernel.md) |
| `tools/refine-c/refine.py` | Refinement harness: code-scheduled, model-written, code-certified generation with a plausibility critic | Mystery kernel note (docs/mystery-kernel.md) |
| `tools/refine-c/publish.py` | Selects certified cases, adds questions and evening accounts, publishes to `dist/cases/generated/` | Mystery kernel note (docs/mystery-kernel.md) |
| `tools/mk-certify.mjs` | Command-line certification with the JS kernel (used by the harness and parity check) | Mystery kernel note (docs/mystery-kernel.md) |
| `docs/visual-world.md` | The visible village: design, plan and the layout as built | Technical report (index) |
| `tools/refine-c/repair_history.py` | One-off repair of cases published before the history-only rule (typed morning events, backing) | Technical report (generation) |
| `tools/refine-c/difficulty.py` | Difficulty features, model, targets and fitting | docs/difficulty.md |
| `tools/refine-c/batch.py` | Generate several cases in parallel and report how they came out | docs/difficulty.md |
| `tools/e2e_dialogue.mjs` | Ask every character a standard question set with the real AI; report fallbacks | Technical report (generation) |
| `server/case_oracle.py` | Z3 case oracle: feasibility, per-candidate satisfiability with unsat cores, alternative stories; publish gate | Technical report (generation) |
| `tools/refine-c/premise.py` | Premise deck: victim, culprit, suspects, method, motive, scene and shape with rotation and seed checks | Technical report (generation) |
| `tools/refine-c/enrich.py` | Publish-time enrichment: answer, loose ends, everyday knowledge, moods, review against the true history | Technical report (generation) |
| `dist/cases/village.mjs` | Bellweather for generated cases: ten places, eleven people with character sheets | Architecture |
| `tests/test_case_oracle.py` | Z3 oracle agrees with the kernel at every depth; endpoint boundary | Technical report (evaluation) |
| `server/generator_server.py` | Loopback generation server: one job at a time, incremental progress events, publish on completion | Mystery kernel note (docs/mystery-kernel.md) |
| `server/static_server.py` | Game server for `dist/` with no-cache headers; accepts the browser's debug log at `POST /__log` | Mystery kernel note (docs/mystery-kernel.md) |
| `logs/` (not committed) | `game.log` (browser actions, dialogue audits, toasts, generation events, errors, flagged issues), `generator.log`, `proxy.log` | Mystery kernel note (docs/mystery-kernel.md) |
| `dist/life.mjs` | Persistent daily goals, timed activities, social commitments and replanning | [Characters](characters.md) |
| `dist/cases/bellweather-life.mjs` | Public work and personal interests independent of culprit assignment | [Characters](characters.md) |
| `dist/autonomy-turn.mjs` | Bounded model goal selection, stale checks and scripted fallback | [Characters](characters.md) |
| `tests/life.test.mjs` | Daily-life, social, model-boundary and solver regressions | [Evaluation](evaluation.md) |
| `tests/kernel-case.test.mjs` | Every published generated case: certified, gated, solved only by the truth, save-safe; showing evidence | [Evaluation](evaluation.md) |
| `tests/mk-kernel.test.mjs` | Mystery-kernel sign semantics, depth, threads and certification | [Evaluation](evaluation.md) |
| `tests/test_generator_server.py` | Generator server: origin checks, jobs, incremental events, cancel, failure | [Evaluation](evaluation.md) |
| `dist/actions.mjs` | Shared NPC action vocabulary | [Symbolic layer](symbolic.md) |
| `dist/agent-plans.mjs` | Available capabilities, queue, execution and observations | [Character turns](characters.md) |
| `dist/symbolic.mjs` | Finite query compiler and concrete witness evaluator | [Symbolic layer](symbolic.md) |
| `dist/world-director.mjs` | Local plan admission and immediate step checks | [Director](director.md) |
| `dist/director-turn.mjs` | Optional solver boundary and acquisition witness validation | [Director](director.md) |
| `server/symbolic_solver.py` | Bounded Z3 translation and solving | [Symbolic layer](symbolic.md) |
| `server/director_server.py` | Loopback solver endpoint | [Director](director.md) |
| `server/llm_proxy.py` | Optional model request proxy | [Character turns](characters.md) |
| `dist/inspector.mjs` | Prefix-limited perspective and missed-opportunity projections | [Experience](experience.md) |
| `dist/ui.mjs` | Browser interaction, pending status and rendered views | [Experience](experience.md) |
| `dist/dialogue-save.mjs` | Saved dialogue and reasoning-board envelope | [Architecture](architecture.md) |
| `dist/art.mjs` | Presentation asset manifest | [Experience](experience.md) |
| `tests/agent-plans.test.mjs` | Queue, transfer, provenance and dependency regressions | [Evaluation](evaluation.md) |
| `tests/director.test.mjs` | Actual Z3 and transactional Director scenarios | [Evaluation](evaluation.md) |
| `tests/character-turn.test.mjs` | Mocked character generation and critic orchestration | [Evaluation](evaluation.md) |
| `tests/ui.test.mjs` | UI adapter regression checks | [Evaluation](evaluation.md) |
| `tests/test_symbolic_solver.py` | Solver translation and service boundaries | [Evaluation](evaluation.md) |
| `tools/debug-session.mjs` | Reads an exported investigation and prints per-turn AI audits (debugging) | [Evaluation](evaluation.md) |

## Research context

This is a small selected bibliography, not a systematic literature review. Links were checked while preparing this edition. Summaries elsewhere in the report indicate the specific architectural connection; cited systems' empirical results are not evidence for this prototype.

1. Park, J. S., O'Brien, J., Cai, C. J., Morris, M. R., Liang, P., and Bernstein, M. S. (2023). **Generative Agents: Interactive Simulacra of Human Behavior.** [Author paper on arXiv](https://arxiv.org/abs/2304.03442). Relevant to experience, retrieval and character planning.
2. Riedl, M. O., and Young, R. M. (2010). **Narrative Planning: Balancing Plot and Character.** Journal of Artificial Intelligence Research, 39. [Author-hosted paper](https://faculty.cc.gatech.edu/~riedl/pubs/jair.pdf). Relevant to causality and character intentionality.
3. de Moura, L., and Bjørner, N. (2008). **Z3: An Efficient SMT Solver.** TACAS. [Microsoft Research publication](https://www.microsoft.com/en-us/research/publication/z3-an-efficient-smt-solver/). Background for the chosen SMT implementation.
4. Potassco. **clingo: an ASP system.** [Official project documentation](https://potassco.org/clingo/). Reference for a possible future adapter, not an implemented dependency.

## 11.4 Maintaining a living report

The Markdown chapters in `docs/report/` are the editing source. SVG figures in its `figures/` directory are source assets. `scripts/build_report.py` produces linked HTML chapters and a single-page edition in `dist/report/`, with no runtime JavaScript, remote fonts, CDN dependencies or model calls. It supports the deliberately small Markdown subset documented in the authoring guide. Do not hand-edit generated HTML.

```sh
python3 scripts/build_report.py
python3 scripts/build_report.py --check
```

For each major implementation milestone:

1. Update the relevant narrative and source map, not just the roadmap checklist.
2. Move a feature from proposed to implemented only when an executable path exists; retain its actual scope and limitations.
3. Update affected diagrams, examples, interface contracts and failure semantics together.
4. Record what was tested, when, with which configuration, and what remains unmeasured.
5. Increment the report edition and append a milestone entry below. Rebuild and validate links before committing with the implementation.

The standalone design docs remain useful operational references: `docs/architecture.md`, `docs/character-turns.md`, `docs/symbolic-reasoning.md`, `docs/director-testing.md`, `docs/art-direction.md` and `docs/roadmap.md`. The report provides the connected argument; those files provide implementation notes and working checklists. Changes to either should trigger a consistency review of the other.

For a research or external-review snapshot, associate a report edition with a real code commit or release tag after the user's review. Do not invent a commit identifier for an uncommitted working tree. Preserve older editions through version control. PDF publication and archival releases are future packaging steps; the single-page HTML already supplies print styling.

## 11.5 Milestone record

| Edition | Date | Scope |
| --- | --- | --- |
| 0.1 | 2026-09-08 | Initial integrated report: deterministic simulation, bounded character plans, Z3 admission, belief dependencies, inspector and procedural-generation research agenda. |
| 0.2 | 2026-09-08 | Refined hard-invariant contract, two-stage dynamic admissibility, hybrid autonomy, future-opportunity obligations and acceptance criteria; design changes only. |
| 0.3 | 2026-09-08 | Bounded acquisition/admission, parameterized executable prehistory, three selectable authored configurations, provenance and save isolation; generation remains future work. |
| 0.4 | 2026-09-09 | Composable narrative modules (misdirection/correction/secret-affair/concealment); case-general validator (physical/epistemic/reachability/distinguishability + module invariants); seeded validated sampler and playable generated cases; fetch/inform capabilities (live concealment and in-person correction); critic JSON-only output and a general clean-decline for out-of-knowledge questions; role-aware prose and clue-kind fixes. |
| 0.5 | 2026-09-12 | Persistent ordinary lives, real social commitments, bounded optional model deliberation, composed-plan admission and replanning tests. |
| 0.6 | 2026-09-12 | Typed crime/evidence sources, configured belief support, finite competing accusations, cleanup/clockwork structures and explicit Z3 certification. |
| 0.7 | 2026-09-12 | Live-verified AI paths: detached non-blocking life deliberation with turn-abort race safety and fence-tolerant selection parsing; in-character declines for out-of-account free-text questions; presented-evidence recognition (a character acknowledges shown evidence instead of feigning ignorance); actionable World Director deferral guidance. Robustness/UX only. |
| 0.8 | 2026-09-20 | Durable IndexedDB autosave (removes the ~5MB localStorage cap; localStorage kept as a synchronous mirror/fallback, Export as the off-browser copy); notebook people view pins the active conversation partner with live trust/stress. |
| 0.9 | 2026-09-20 | First structural-variety axis: declarative finite forensic model (dimensions-as-data + predicate-compiler registry + generic enumerator, behaviour-preserving) and a manner-of-death brick. Some generated cases are staged to look like an accident; the accusation is gated until the coroner finding establishes murder. Manner is a gate, not an accusation field. |
| 0.10 | 2026-09-20 | Deeper deduction + NPC personas: systematic personas with an enforced consistency contract; typed testimony + a contradiction engine (catch the lie) surfaced as the reasoning board's spine; multi-hop motive (document narrows, memo pins); per-pillar multi-hop + multi-path (>=2 independent routes, blockable clues have alternatives) generation obligations; a generalized break-a-lie loop (present an adjudicating fact -> deterministic concession that supersedes the lie). |
| 0.11 | 2026-09-20 | The primitive-algebra pipeline: a named/versioned primitive kernel (`primitives.mjs`), a declarative composition compiler (`composition.mjs`), three divergent types (staged-suicide, collusion, delayed poisoning), and a prep-time LLM composer (`llm-composer.mjs`, "Generate with AI") with a validateCase repair loop and deterministic fallback. An affordance grammar makes means an open object catalog (`objects.mjs` + `mechanism.mjs`; icicle/scarf/chandelier). A forced-insight obligation makes twists load-bearing; a manner×method guardrail rejects incoherent stagings. Dialogue naturalness: per-character pronoun/address/voice, warmer generation, no record-reciting, witnesses confirm objective records, and a relaxed number gate that allows natural time phrasing. 232 JS + 10 Python tests. |
| 0.12 | 2026-09-21 | Depth (M0–M5): a deep-case artifact (neutral observations + discovery gates + declared inversion) compiled onto the existing engine; obligations for fair-play, discovery-depth and the inversion-anchor contract; a coherence-preserving operator library; a deterministic always-certified deep generator (a delayed poisoning whose toxicology anchor is gated behind a washed-decanter→dregs chain, the recorded death-time a misdirecting alibi) plus an LLM deep composer with deterministic fallback; reachability extended to traverse gates; wired as "Generate a deep case". 247 JS + 10 Python tests. |
| 0.13 | 2026-09-21 | Breadth, depth and disclosure. Three deep shapes (time/motive/means), each gating a different forced anchor; the anchor is now buried behind a ~5-hop discovery ladder (was two); every deep case carries load-free red-herring fog (neutral, never forced, never a premise of a forced clue) within the solver's 30-clue bitset (~23–24 used). In-room disclosure: the inspect panel groups reachable objects into sections by evidence kind and hides gated objects until their prerequisites are found. The LLM can author a full deep artifact (`composeArtifactCase` + safe `expandArtifact`), certified/repaired/fallen-back. Local LLM proxy self-heals a stale cached credential. 253 JS + 10 Python tests. |
| 0.14 | 2026-09-26 | The mystery kernel: four primitives, computed sign kinds, Conceal/Fragment/Mislead with two laws, misdirection as a defeated default; a refinement harness (code schedules and certifies, a model writes each beat, a second model reviews it); the kernel in JS with parity against the Python checker; five certified Bellweather cases (depth 4–7) playable through a bridge, with free-text dialogue grounded in each character's memories and beliefs. 277 JS + 10 Python tests. |
| 0.15 | 2026-09-27 | Generation in the game: one generator button, a local generator server with streamed progress and a collapsed spoiler view; published cases gain the doctor's examination, evening accounts for everyone, observable traits, spoken lines and reactions for showing evidence; mistakes conceded apart from lies; free-text access to all earned accounts with a guarded third attempt; stationary people; progressive hints; debug logs in `logs/` and a Flag-an-issue button. 178 JS + 14 Python tests. |
| 0.16 | 2026-09-27 | Motive/means/opportunity certification and accusation; Z3 case oracle as a publish gate and source of alternative stories; premise deck for variety; ten-place, eleven-person village with new art; everyday knowledge, moods, loose ends and concessions; one case kept in reserve |
| 0.17 | 2026-09-27 | The visible village: map, scene, full-height conversation, Talk panel, inventory with clue art and drag-to-show, Clue Board with every villager, opening and tour; clue art library and detective portrait |
| 0.18 | 2026-10-02 | The history is the only source of facts: account backing certified in both kernels; typed discovery and examination; roles from the setting; publishing adds only wording; replies from the history |
| 0.19 | 2026-10-03 | Difficulty (computed, and generated to); the newcomer; 50 clue pictures with keys chosen at publish |
| 0.20 | 2026-10-03 | Evening and morning accounts for everyone involved; question routing; fact-checker rules; end-to-end tests |

### Forensic milestone source map

- `dist/forensics.mjs`: source rules, history/explanation IR, finite enumeration and alternative exclusion.
- `dist/cases/investigative-structures.mjs`: cleanup and clock-dependent evidence structures.
- `dist/casegen.mjs`: local generation obligations and optional Z3 certification.
- `tools/validate-case.mjs`: reproducible offline certification command.

Edition 0.6 adds these bounded forensic contracts; it does not claim general formal verification of narrative prose.
