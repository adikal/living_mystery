# Living Mystery

## A deterministic substrate for believable characters and investigable worlds

**Living technical report · Edition 0.9 · 20 September 2026**

### Abstract

A mystery game asks its player to reconstruct a hidden history from incomplete and sometimes deceptive evidence. A simulated social world complicates that task: witnesses move, documents change hands, beliefs evolve, and a conversation can change what happens next. Natural-language agents can make these interactions expressive, but expression alone does not establish causal consistency, legitimate knowledge acquisition, or continued investigability. Living Mystery explores an architecture in which a deterministic simulation owns state transitions, characters propose bounded actions and dialogue, and a World Director checks selected physical plans and investigation routes before committing them.

The current prototype includes the original Last Bell and configured/generated Bellweather cases. It combines an append-only event history, perspective-limited beliefs and memories, authored decision policies, optional language-model character turns, a shared action and forensic vocabulary, ordinary autonomous lives, finite competing explanations, and an optional Z3 adapter. The inspector reconstructs past states and exposes the provenance of decisions and knowledge. This report describes the implemented contracts, distinguishes their guarantees from their limitations, and develops a research agenda for generating coherent and playable mysteries. The central hypothesis is that expressive characters and rigorous world rules can reinforce one another when their authority and information boundaries are explicit. This hypothesis has not yet been established by a player study or a real-model evaluation.

### Report status

This is a design and implementation report, not a peer-reviewed paper or a claim of completed procedural generation. It documents the working-tree implementation at the date above. Test evidence is reported with its scope; planned evaluations are not presented as results. Worked examples reveal the solution and private character information in The Last Bell.

| Label | Meaning in this report |
| --- | --- |
| Implemented | A concrete path exists in the repository. This does not imply generality or empirical quality. |
| Experimental | Implemented, bounded functionality whose adequacy needs broader evaluation. |
| Proposed | An architectural target or experiment without a complete runtime implementation. |

### Contributions of the current prototype

- An event-based simulation that separates recorded physical history from character beliefs, speech assertions and player hypotheses.
- A common admission boundary for authored and bounded AI-selected physical plans, with local checks and optional independent solver execution.
- A provenance-preserving belief lifecycle, including explicit dependencies, retirement and completed intentions.
- An investigation debugger that makes temporal order, information flow and differing perspectives inspectable.
- Bounded acquisition search and mandatory transition admission in three authored configurations, with executed prehistory and source-linked morning evidence.
- A composable narrative-module ("brick") system with a case-general validator: each case is a base scaffold plus composed modules, and only cases that pass physical, epistemic, reachability and evidence-driven distinguishability obligations (plus each module's local invariant) are admitted. A seeded sampler yields validated, playable generated cases over the fixed cast.

These are engineering contributions of this prototype. We make no priority claim relative to the wider literature. The [research context](reference.md#research-context) identifies related approaches without implying that their methods or empirical results have been reproduced here.

### How to read the report

Start with [research questions and principles](foundations.md), then [architecture](architecture.md). The next three chapters detail [knowledge](knowledge.md), [character turns](characters.md) and [symbolic validation](symbolic.md). [World Director](director.md) explains the boundary between a feasible action and a viable investigation. [Worked examples](case-study.md) connect those mechanisms to actual play. The remaining chapters address [player and inspector experience](experience.md), [evaluation](evaluation.md), and [procedural generation](generation.md).

The [reference chapter](reference.md) contains a glossary, source map, bibliography and maintenance protocol. A single-page edition collects every chapter for continuous reading and printing. Markdown sources and SVG diagrams are maintained alongside the implementation; generated HTML is a reproducible reading format rather than the editing source.


### Edition 0.3 implementation

Three fixed same-cast configurations now vary culprit, means, motive and crime time. Their prehistories execute in the kernel; evidence and initial knowledge link to recorded events. A bounded acquisition search constructs and replays investigation witnesses. The new configurations enforce local transition admission even with AI and optional Z3 disabled, including relevant intermediate access/deadline checks. [Generation](generation.md#10-7-the-implemented-configuration-pipeline) explains the implemented pipeline and the bounded seeded sampler. The original case remains available with its existing richer authored behavior.

### Edition 0.4 implementation

A case is now a **base scaffold plus composed narrative modules** (`dist/modules/`): reusable bricks — misdirection, an honest-mistake correction delivered to the constable in person, a benign secret that makes an innocent evasive, and a live culprit concealment — that contribute clues, sourced prehistory, NPC capabilities and dialogue, and each declares a local coherence invariant. A **case-general validator** (`dist/casegen.mjs`) admits a specification only when it passes physical execution, epistemic sourcing, bounded reachability and **evidence-driven distinguishability** (selected acquired records exclude alternative suspect/method/motive combinations in the finite domain) obligations, plus every composed module's invariant. A **seeded sampler** returns only validated cases, and generated cases resolve from their id, so they are playable and save/reload-safe through a menu "generate a case" action. The capability system gained fetch and inform plan shapes, so concealment (the culprit hides a document it knows about) and correction (the witness travels to Bell and delivers her revised account) run as validated live plans. This advances the [staged plan](generation.md#10-5-staged-generation-and-exit-criteria) into a bounded slice of G2; new casts, maps and richly generated prose remain future work.


### Edition 0.6: persistent NPC lives

Ordinary responsibilities, fatigue, errands and social goals now coexist with mystery modules in configured cases. NPCs deliver invitations, accept appointments in person, reserve travel time and reconsider failed plans. Optional language-model deliberation selects bounded goal sequences through the same action and commitment checks. Scripted mode and deterministic replay remain complete paths. The [character chapter](characters.md#4-7-autonomous-daily-lives) describes implementation and limits.

### Edition 0.6: shared forensic reasoning

Configured and generated cases now use typed crime/evidence occurrences, registered belief-support rules, finite competing-explanation grading and three investigative structures. The browser and Z3 share the constraint representation. The original case retains its authored rubric; the new checks certify only the declared finite domain. See [symbolic validation](symbolic.md#5-6-shared-forensic-queries) and [structural generation](generation.md#10-9-investigative-structures).

### Edition 0.7: verified and hardened AI paths

The optional model paths were exercised against a live model and hardened. Life deliberation now runs **detached** after the player's action commits, so it never blocks the action or its reply, and it yields to any new player turn (an in-flight deliberation is aborted so it cannot stale the turn); its goal selection is parsed fence-tolerantly and passes the local investigation-admission check. A free-text question a character has no account for now produces a faithful **in-character decline** — the model may not answer or assert facts without a selected account — instead of a fallback. World Director deferrals in conversation now explain how to proceed. These are robustness and UX fixes; the underlying contracts and finite domains are unchanged.

### Edition 0.8: durable autosave and conversation-focused people view

Autosave now uses **IndexedDB** as the primary store, with `localStorage` kept as a synchronous mirror and fallback. A long investigation with the full AI reasoning trace could exceed the browser's ~5MB `localStorage` quota and fail to save; IndexedDB's far larger quota removes that cap, and the save degrades gracefully (compact gameplay-only `localStorage`, then an error) only if both stores fail. The Export file remains the durable off-browser copy. In the notebook's people view, the person you are currently speaking with is pinned to the top and marked, so their profile and live trust/stress meters stay visible as the conversation changes them.

### Edition 0.9: structural variety — the declarative forensic model and manner-of-death

The first step from *combinatorial* variety (the same puzzle with different fillers) toward *structural*
variety (different kinds of investigation). The finite forensic model is now **declarative**: dimensions
are data (integer domains with labels), evidence predicates are a compiler registry, and a single generic
enumerator ranges over whatever dimensions a case declares — a behaviour-preserving refactor that leaves
every prior case identical. On that substrate, **manner-of-death** adds the first new axis: some generated
cases are staged to look like an accident, and the accusation is **gated** until a coroner's finding
establishes that the death was murder. It is always ultimately a murder (staging is a disguise), manner is
an investigative gate rather than an accusation field, and the coroner finding is load-bearing on every
proof route. A separate design note (`docs/manner-of-death.md`) records the rationale, the declarative-model shape, and the safety rails.
