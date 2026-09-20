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
| `tests/case-configurations.test.mjs` | Configuration, admission, provenance and real-Z3 regressions | [Evaluation](evaluation.md) |
| `dist/case.mjs` | Authored people, places, evidence and case solution | [Worked examples](case-study.md) |
| `dist/cases/last-bell.mjs` | Scripted policy, dialogue, case consequences and reconciliation | [Worked examples](case-study.md) |
| `dist/schema.mjs` | JSDoc contracts and player-action catalog | [Architecture](architecture.md) |
| `dist/knowledge.mjs` | Belief revisions, explicit supports, retirement, intention completion | [Knowledge](knowledge.md) |
| `dist/claims.mjs` | Structured claims and bounded comparison | [Knowledge](knowledge.md) |
| `dist/cases/last-bell-claims.mjs` | Authored case-night claim annotations | [Knowledge](knowledge.md) |
| `dist/character-turn.mjs` | Tickets, model proposal, critic and application checks | [Character turns](characters.md) |
| `dist/modules/` | Composable narrative bricks: `contract.mjs`, `index.mjs` (registry + `activeModules`), and `misdirection`/`correction`/`secret-affair`/`concealment` | [Generation](generation.md) |
| `dist/casegen.mjs` | Case-general validator (four obligations + module invariants) and the seeded validated sampler | [Generation](generation.md) |
| `dist/life.mjs` | Persistent daily goals, timed activities, social commitments and replanning | [Characters](characters.md) |
| `dist/cases/bellweather-life.mjs` | Public work and personal interests independent of culprit assignment | [Characters](characters.md) |
| `dist/autonomy-turn.mjs` | Bounded model goal selection, stale checks and scripted fallback | [Characters](characters.md) |
| `tests/life.test.mjs` | Daily-life, social, model-boundary and solver regressions | [Evaluation](evaluation.md) |
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
| `tests/modules.test.mjs` | Brick composition, invariants, `peers` interweave and live correction delivery | [Evaluation](evaluation.md) |
| `tests/casegen.test.mjs` | Validator obligations, seeded sampler and generated-case lifecycle | [Evaluation](evaluation.md) |
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

### Forensic milestone source map

- `dist/forensics.mjs`: source rules, history/explanation IR, finite enumeration and alternative exclusion.
- `dist/cases/investigative-structures.mjs`: cleanup and clock-dependent evidence structures.
- `dist/casegen.mjs`: local generation obligations and optional Z3 certification.
- `tools/validate-case.mjs`: reproducible offline certification command.
- `tests/forensics.test.mjs`: source forgery, ambiguity, route replay, real-Z3 and unresolved-result regressions.

Edition 0.6 adds these bounded forensic contracts; it does not claim general formal verification of narrative prose.
