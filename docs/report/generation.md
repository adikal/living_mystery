# 10. From a reference case to procedural mysteries

**Status: proposed development program. No procedural mystery generator is implemented.**

## 10.1 Complete the reference case first

The Last Bell should become an adequately evaluated reference for dialogue, causality, investigation and debugging before the system generates entire mysteries. Otherwise generation multiplies unclear mechanics and makes failures harder to attribute. Completion means more than an accepted accusation: alternative investigative paths, failed interactions, timing variations and explanation quality need explicit coverage.

The next generalization steps are broader character capabilities, automatic rule-driven re-derivation, general bounded investigation search and explicit recovery policies. Executable prehistory is another prerequisite. Current case-night knowledge is largely anchored to authored background summaries; a generated crime should leave evidence through simulated actions rather than prose retrospectively describing convenient traces.

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
| G1: parameter variation | Schedules and evidence placement | Executed prehistory; solution witnesses across variations |
| G2: structural variation | Motive, method, culprit and relationships | Alternative-explanation and information-origin checks |
| G3: generative authoring | New case structures within a declared domain | Artifact validation, bounded repair and diverse playtests |
| G4: richer playable world | Spatial actions and larger social networks | Perception semantics, performance budgets and recovery coverage |

These are development gates, not delivery dates. At every stage the deterministic mode remains a playable and testable path. Procedural cases must include sufficient authored or generated-and-validated scripted dialogue to remain usable when runtime AI is disabled.

## 10.6 Visual and operational budgets

Before enabling automatic image production, implement persistent asset caching, reusable approved imagery, deduplicated requests, per-case budgets, bounded retries and usage accounting. Key assets by public appearance, style version and output specification. Prefer existing approved assets or text fallbacks when budgets are exhausted. Reloading a case must not cause regeneration.

Similar discipline applies to reasoning: bound model deliberation, solver requests and recovery attempts; expose unresolved outcomes; retain enough provenance to investigate failures. The aim is a game whose costs and correctness boundaries remain understandable as its expressive range increases.
