# 10. From a reference case to procedural mysteries

**Status: three authored configurations, a composable narrative-module system, a case-general validator and a seeded sampler are implemented (a bounded slice of G2 over the fixed cast); new-cast, relationship and map generation, and richly generated prose, remain proposed.**

## 10.1 Complete the reference case first

The Last Bell should become an adequately evaluated reference for dialogue, causality, investigation and debugging before the system generates entire mysteries. Otherwise generation multiplies unclear mechanics and makes failures harder to attribute. Completion means more than an accepted accusation: alternative investigative paths, failed interactions, timing variations and explanation quality need explicit coverage.

The first three implementation steps now provide a bounded admission foundation, parameterized executable prehistory and three hand-authored same-cast configurations. These are deliberately small reference cases. Broader hybrid autonomy, automatic rule-driven re-derivation, social investigation planning and explicit recovery policies remain prerequisites for larger domains. The original case still uses authored background summaries; the new variants create inspectable evening occurrences and source their morning evidence and knowledge to those events.

## 10.2 Proposed case-production pipeline

![Figure 7. Proposed procedural pipeline with separate physical, epistemic, investigative and presentation obligations.](figures/generation.svg)

A future case specification should define entities, locations, routes, clocks, relationships, motives, allowable actions, evidence-production rules and observation opportunities. Generation would choose a hidden history within those constraints, execute it, derive each character's initial knowledge from actual perceptions, and construct the player-facing evidence surface.

The output should include the case model, executable prehistory trace, evidence provenance, disclosure capabilities, plan permissions, bounded solution witnesses, alternative-explanation checks and an asset manifest. Every artifact should refer to stable entity and event IDs. Generated natural-language descriptions can render this structure; they should not silently become its authority.

## 10.3 Four separate obligations

**Physical consistency:** Can the crime, cover-up and subsequent routines occur given time, travel and possession constraints? An executable witness should reproduce the intended prehistory.

**Epistemic legitimacy:** Can each witness obtain the information assigned to them? False beliefs need plausible origins, such as ambiguous perception or received misinformation. A lie requires an intentional communicative policy, not an accidental contradiction in generated prose.

**Investigative distinguishability:** Does discoverable evidence discriminate the intended explanation from relevant alternatives? A unique hidden model is not enough if all distinguishing facts are inaccessible to the player. Conversely, ambiguity may be an intentional case property, but the ending should acknowledge it rather than demand certainty unsupported by evidence.

**Reachability and playability:** Can a player acquire and connect adequate evidence within the modeled action space, and does the path remain practical under selected variations? Solver existence must be followed by engine replay and ultimately human playtesting.

## 10.4 The third use case: the final argument

Bell currently rejects accusations that fail the authored evidence rubric. That is useful gameplay, but it does not prove a general argument. A future final-case interface should expose the player's premises, their sources and uncertainties, the conclusions claimed, and relevant alternative explanations. It should not secretly use the known culprit as a premise in the player's proof.

The proposed multi-logic layer could test alternative assignments or produce explanations in a supported finite domain. A Lean certificate might later provide independently checked derivations for an explicitly formalized argument. It would certify the derivation from assumptions, not the authenticity of a witness statement or the faithfulness of its language-to-logic translation. Lean is therefore optional rather than a prerequisite for a better accusation system.

## 10.5 Staged generation and exit criteria

| Stage | New freedom | Evidence required before broadening |
| --- | --- | --- |
| G0: reference case | Finish authored mechanics and interactions | Repeatable case paths and clearly explained failures |
| G1: authored variation — implemented slice | Three same-cast culprit/method/motive/time configurations | Executed prehistory and replayed solutions; richer narrative playtests remain |
| G2: controlled sampling — implemented slice | Seeded sampling of validated same-cast specifications, composed from narrative modules | Now enforced: physical, epistemic, reachability and distinguishability obligations plus per-module invariants, over the fixed cast. Still remaining: symbolic crime rules, independent alternative-explanation proof, richer prose and human playtests |
| G3: generative authoring | New case structures within a declared domain | Artifact validation, bounded repair and diverse playtests |
| G4: richer playable world | Spatial actions and larger social networks | Perception semantics, performance budgets and recovery coverage |

These are development gates, not delivery dates. At every stage the deterministic mode remains a playable and testable path. Procedural cases must include sufficient authored or generated-and-validated scripted dialogue to remain usable when runtime AI is disabled.

## 10.6 Visual and operational budgets

Before enabling automatic image production, implement persistent asset caching, reusable approved imagery, deduplicated requests, per-case budgets, bounded retries and usage accounting. Key assets by public appearance, style version and output specification. Prefer existing approved assets or text fallbacks when budgets are exhausted. Reloading a case must not cause regeneration.

Similar discipline applies to reasoning: bound model deliberation, solver requests and recovery attempts; expose unresolved outcomes; retain enough provenance to investigate failures. The aim is a game whose costs and correctness boundaries remain understandable as its expressive range increases.

## 10.7 The implemented configuration pipeline

![Figure 9. Implemented authored-configuration pipeline; random sampling and general alternative-explanation proof remain future work.](figures/configurations.svg)

A specification supplies culprit, weapon, motive, injury and crime minute. A case factory renders consistent evidence and scripted accounts, then the kernel executes evening journeys, possession changes, a guarded fatal action, medical examination and a report delivered at a real meeting. Evidence acquisition records causal parents from that executed history; initial beliefs cite personal observations or received testimony. These source links establish the recorded origins within the authored model, not a complete theory of physical evidence or perception.

Travel and taking use shared typed plan checks, which the tests also submit to actual Z3. The fatal event and document production currently use direct engine preconditions. Calling the complete prehistory “SMT-proved” would overstate the implementation. The next formalization should represent those additional actions and evidence-production rules explicitly before expanding the specification domain.

The browser selects a configuration and keeps its ID in the save. Scripted play, views and optional character context all bind to that case. The original mystery remains selectable for compatibility and its richer correction/concealment threads. Portraits and location imagery are reused; alternate artifact imagery uses text fallback. No runtime AI or image requests are required.

The next generation gate is controlled seeded sampling of validated specifications. It must reject inconsistent histories, test discoverable discrimination among alternative suspects/methods/motives, replay an acquisition witness and package sufficient scripted content. Merely choosing a different culprit field would not satisfy these obligations.

## 10.8 Composable narrative modules and validated sampling

**Status: implemented over the fixed cast; new-cast composition and richer prose proposed.**

A case is now assembled as a **base scaffold plus composed narrative modules** ("bricks"), each a reusable unit of detective fiction conforming to one contract (`dist/modules/contract.mjs`): `bind` resolves the brick's role slots or sits out; `content` additively contributes clues, objects and proof-route entries; `prehistory` emits sourced events, beliefs and capabilities through the kernel; `capabilities` supplies NPC plan permissions; `decide`/`onInteract` drive and react to behavior; `dialogue` contributes topic responses; and `invariant` is a brick-local coherence check. `activeModules(spec)` composes them (honoring a `requires` order and passing sibling `peers` so bricks can interweave). Four bricks exist today — misdirection, correction, secret-affair and concealment — and adding a trope is one module file plus a registry line.

The **case-general validator** (`dist/casegen.mjs`, `validateCase`) turns the four obligations of §10.3 into executable checks and adds a fifth: **physical** (the prehistory executes and the case constructs), **epistemic** (every seeded belief references a recorded event), **reachability** (a bounded acquisition search plus engine replay solves it), **distinguishability**, and **module coherence** (each composed brick's invariant holds). Distinguishability is checked at the level of discoverable structured claims, not clue prose: every innocent must be placed elsewhere across the death window, the culprit must be unalibied with scene opportunity, and the real accusation grader must convict only the culprit with the discoverable bundle. A red-herring brick therefore cannot become load-bearing, and a concealment brick cannot remove the last route — the invariant and the validator reject such compositions.

`sampleCases(seed, n)` permutes culprit, weapon, motive, crime time and the misdirection target over the fixed cast with a deterministic PRNG and returns **only** specifications that pass every obligation. The full same-cast grid (162 candidates at the current parameters) validates end to end. Generated cases are playable: a `gen-*` identifier encodes every component `buildSpec` needs, so the engine resolves the runtime lazily and the case saves and reloads like any authored configuration; a browser "generate a case" action samples one and starts it. This is variety that is **generated and proven**, not asserted — but it remains bounded to the fixed cast, templated (role-aware) prose, and the current crime shape, so distinguishability rests on the alibi/opportunity claim structure rather than a general symbolic crime theory.
