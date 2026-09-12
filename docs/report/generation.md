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

The original case rejects accusations through its authored rubric. Configured/generated cases now test finite competing explanations from acquired evidence. A broader final-case interface should expose the player's premises, their sources and uncertainties, the conclusions claimed, and relevant alternative explanations. It should not secretly use the known culprit as a premise in the player's proof.

The current finite layer tests alternative assignments and produces bounded explanations. A broader multi-logic layer could extend the supported domain. A Lean certificate might later provide independently checked derivations for an explicitly formalized argument. It would certify the derivation from assumptions, not the authenticity of a witness statement or the faithfulness of its language-to-logic translation. Lean is therefore optional rather than a prerequisite for a better accusation system.

## 10.5 Staged generation and exit criteria

| Stage | New freedom | Evidence required before broadening |
| --- | --- | --- |
| G0: reference case | Finish authored mechanics and interactions | Repeatable case paths and clearly explained failures |
| G1: authored variation — implemented slice | Three same-cast culprit/method/motive/time configurations | Executed prehistory and replayed solutions; richer narrative playtests remain |
| G2: controlled sampling — implemented slice | Seeded sampling of validated same-cast specifications, composed from narrative modules | Now enforced: physical, epistemic, reachability and distinguishability obligations plus per-module invariants, over the fixed cast. Implemented additionally: typed crime/evidence rules and finite alternative-explanation checks with optional Z3 certification. Remaining: broader domains, richer prose and human playtests |
| G3: generative authoring | New case structures within a declared domain | Artifact validation, bounded repair and diverse playtests |
| G4: richer playable world | Spatial actions and larger social networks | Perception semantics, performance budgets and recovery coverage |

These are development gates, not delivery dates. At every stage the deterministic mode remains a playable and testable path. Procedural cases must include sufficient authored or generated-and-validated scripted dialogue to remain usable when runtime AI is disabled.

## 10.6 Visual and operational budgets

Before enabling automatic image production, implement persistent asset caching, reusable approved imagery, deduplicated requests, per-case budgets, bounded retries and usage accounting. Key assets by public appearance, style version and output specification. Prefer existing approved assets or text fallbacks when budgets are exhausted. Reloading a case must not cause regeneration.

Similar discipline applies to reasoning: bound model deliberation, solver requests and recovery attempts; expose unresolved outcomes; retain enough provenance to investigate failures. The aim is a game whose costs and correctness boundaries remain understandable as its expressive range increases.

## 10.7 The implemented configuration pipeline

![Figure 9. Implemented configured-case execution and admission pipeline, also used by the seeded sampler. General alternative-explanation proof remains outside the finite contract.](figures/configurations.svg)

A specification supplies culprit, weapon, motive, injury and crime minute. A case factory renders consistent evidence and scripted accounts, then the kernel executes evening journeys, possession changes, a guarded fatal action, medical examination and a report delivered at a real meeting. Evidence acquisition records causal parents from that executed history; initial beliefs cite personal observations or received testimony. These source links establish the recorded origins within the authored model, not a complete theory of physical evidence or perception.

Travel and taking use shared typed plan checks, which the tests also submit to actual Z3. The fatal event and document production currently use direct engine preconditions. Calling the complete prehistory “SMT-proved” would overstate the implementation. The next formalization should represent those additional actions and evidence-production rules explicitly before expanding the specification domain.

The browser selects a configuration and keeps its ID in the save. Scripted play, views and optional character context all bind to that case. The original mystery remains selectable for compatibility and its richer correction/concealment threads. Portraits and location imagery are reused; alternate artifact imagery uses text fallback. No runtime AI or image requests are required.

The next generation gate is controlled seeded sampling of validated specifications. It must reject inconsistent histories, test discoverable discrimination among alternative suspects/methods/motives, replay an acquisition witness and package sufficient scripted content. Merely choosing a different culprit field would not satisfy these obligations.

## 10.8 Composable narrative modules and validated sampling

**Status: implemented over the fixed cast; new-cast composition and richer prose proposed.**

A case is now assembled as a **base scaffold plus composed narrative modules** ("bricks"), each a reusable unit of detective fiction conforming to one contract (`dist/modules/contract.mjs`): `bind` resolves the brick's role slots or sits out; `content` additively contributes clues, objects and proof-route entries; `prehistory` emits sourced events, beliefs and capabilities through the kernel; `capabilities` supplies NPC plan permissions; `decide`/`onInteract` drive and react to behavior; `dialogue` contributes topic responses; and `invariant` is a brick-local coherence check. `activeModules(spec)` composes them (honoring a `requires` order and passing sibling `peers` so bricks can interweave). Four bricks exist today — misdirection, correction, secret-affair and concealment — and adding a trope is one module file plus a registry line.

The **case-general validator** executes the prehistory, checks the shared physical IR, verifies typed initial belief and evidence support, replays every declared solution route, tests the acquired bundle against competing culprit/method/motive explanations, and checks module invariants. It rejects ambiguity rather than relying on the old clue checklist.

`sampleCases(seed, n)` varies culprit, weapon, motive, time, misdirection target and investigative structure. It returns candidates that pass these bounded checks. Generated IDs encode those components and reconstruct the same case on reload. Earlier full-grid results concerned the smaller parameter-only domain; they are not exhaustive coverage of the expanded structural domain.

## 10.9 Investigative structures

The `trace` structure preserves the physical comparison and independent-alibi investigation. `cleanup` adds a real post-strike wiping action, discarded residue, and a laboratory-plus-entrance-watch route that bypasses the damaged-object and alibi chain. `clockwork` requires either a calibrated timed watch or an independently timed record, paired with different motive-document routes. Bell's entrance watch is a physically executed appointment, not remote knowledge of the killing.

Each declared route is separately searched and replayed. Multiple routes can share premises; the original physical/carbon-copy pair intentionally shares most clues. The new branches provide different acquisition and inference work, but still use the same cast, map, fatal-action family and trusted-document assumptions. Broader story synthesis, uncertain forensic reliability, social acquisition and contingent recovery remain research work.
