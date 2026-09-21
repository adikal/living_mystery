# 10. From a reference case to procedural mysteries

**Status: three authored configurations, a composable narrative-module system, a named primitive algebra with a declarative composition compiler, an affordance grammar for means, a forced-insight obligation, a seeded sampler and a prep-time LLM composer (with deterministic fallback) are implemented over the fixed cast; new-cast, relationship and map generation, richer prose, and machine-checkable difficulty remain proposed.**

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
| G3: generative authoring — implemented slice | New case structures within a declared domain; a prep-time LLM composer that proposes over the validated palette, plus an affordance grammar for open object/means | Now implemented: compile→validateCase→structured-feedback repair with a deterministic fallback, per-seed cache, and forced-insight for load-bearing twists. Remaining: new casts/maps, richer prose, and machine-checkable difficulty grading |
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

## 10.10 The primitive algebra and the composition compiler

The forensic checks were refactored into a named, versioned **primitive algebra** (`dist/primitives.mjs`,
`PRIMITIVE_ALGEBRA_VERSION`): a typed entity ontology and a small set of `CONSTRAINT` primitives
(`within`, `is`, `isNot`, `elsewhere`, `soleAt`, `soleAtOffset`) over the finite IR. Every claim
predicate (`death_time`, `location`, `crime_method`, `trace_match`, `exclusive_opportunity`,
`manner_evidence`, …) is now a thin composition of those primitives. This is the human-authored kernel:
compositions may combine primitives without limit but may not redefine them, because an oracle cannot be
produced by the thing it validates.

On top of the kernel, a **declarative composition compiler** (`dist/composition.mjs`) turns a
composition — pure data: clues, typed claims, proof-route membership, method options, and a prehistory
occurrence-DAG (with links to existing occurrence types or intra-composition ids), plus an *optional,
non-authoritative* dialogue passthrough — into the same brick hooks a hand-authored module provides.
Adequacy was demonstrated by re-expressing two live bricks (`manner-of-death`, `poisoning`) as
compositions with the whole suite still green. This is the data format the LLM composer targets: every
fact lives in the validated fields, and prose can never change a fact.

## 10.11 An affordance grammar: means as an open object catalog

The "means" axis was generalized from a fixed enum to a finite **affordance grammar** so that new murder
objects are mostly data. `dist/primitives.mjs` declares a small vocabulary of affordances —
`harm(kind)`, `transfer`, `times`, `gates`, `marks`, `conceals`, `vanishes`, `fakes` — and each reduces
to a validated kernel predicate (for example `harm`/`transfer`/`marks → trace_match`, `times →
death_time`, `gates → exclusive_opportunity`, `conceals → manner_evidence`). `dist/objects.mjs` is the
*surface*: an object is a name, a narrative injury, and a bundle of affordances, validated fail-closed
against the grammar at load. `dist/mechanism.mjs` compiles an affordance-typed composition, first
checking that each affordance-tagged clue leaves exactly the predicate its affordance is allowed to
leave, then reusing the composition compiler.

This is the seam that lets creativity expand at the object/narrative layer while correctness stays
bounded in a finite, decidable kernel. Three genuinely new objects were added this way, each roughly one
data entry plus a small mechanism: an **icicle** (a blunt weapon that *vanishes* — no weapon is found,
so a casting-mould/meltwater trace pins the method), a **silk scarf** (an everyday object as an
asphyxiant ligature, pinned by matching fibres), and a **rigged chandelier** (a *set-and-leave* fall
where the culprit sabotages the fixing and is gone before it drops — the sabotage timing, not the death,
fixes the crime window). The crime-history narration is now harm-kind-aware, so the method's act is
visible in the timeline ("rigs the chandelier to fall", "administers a fatal dose") rather than a generic
strike. `crimeModel`'s method dimension is generic (the three base weapons plus the spec's own object),
so new objects join the sampler and the LLM palette automatically.

## 10.12 Forced insight: making a twist load-bearing

Solvability is table stakes; depth needs a machine-checkable property. The `forcedInsight` obligation
(`checkForcedInsight` in `dist/casegen.mjs`) certifies that each clue a brick declares via `forces` is
*load-bearing*: it replays the winning route and re-grades the bundle with that clue removed, and rejects
the case if the true accusation still holds. Manner-of-death declares the coroner finding forced; poison
declares the toxicology finding forced (its delayed death is real — the medical exam carries no time pin,
and toxicology fixes the administration window on the examination occurrence); the icicle declares its
meltwater trace forced. A manner×method coherence guardrail (in the manner brick's invariant) additionally
rejects logically contradictory combinations — staging a fall (chandelier) as a fall, or a poisoning as a
self-inflicted wound — following the split "LLM common sense for plausibility, symbolic layer for
logical/causal/temporal coherence".

## 10.13 The LLM composer

`dist/llm-composer.mjs` closes the loop the pipeline was built for. The model **composes** a mystery by
choosing values over the fixed, validated **palette** (never inventing characters, methods, motives, or
predicates): `composeCase` parses the proposal, compiles it with `buildSpec`, validates it with the same
`validateCase` oracle the whole engine trusts, and on rejection feeds **structured feedback** (the failing
obligations by name, or the `buildSpec` error) back for a bounded repair loop. If the model cannot produce
a valid case within its attempts, it falls back to the deterministic sampler, which is always certified;
results are cached per seed. Model prose (title/synopsis) is threaded through as non-authoritative flavor.
A live proxy adapter (`llmFromProxy`, contract in `server/llm_proxy.py`) carries the request; the app
exposes it as "Generate with AI", and the composer was verified live producing validated, divergent cases.
Variety is driven by a per-generation temperature and a seed-derived "lead" so repeated generations spread
across the palette rather than collapsing to one favourite combination.

This realizes the trust boundary end to end: **the LLM proposes with world knowledge inside the palette
guardrails; the symbolic engine enforces logical, causal and temporal coherence and hands back structured
feedback when something does not hold.** What remains is richer *machine-checkable difficulty* — obligations
that grade inference depth and red-herring pressure so generated cases are scored on being genuinely
hard to solve, not merely valid — and generation of new casts, maps and settings.
