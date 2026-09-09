# Living Mystery

## A deterministic substrate for believable characters and investigable worlds

**Living technical report · Edition 0.1 · 8 September 2026**

### Abstract

A mystery game asks its player to reconstruct a hidden history from incomplete and sometimes deceptive evidence. A simulated social world complicates that task: witnesses move, documents change hands, beliefs evolve, and a conversation can change what happens next. Natural-language agents can make these interactions expressive, but expression alone does not establish causal consistency, legitimate knowledge acquisition, or continued investigability. Living Mystery explores an architecture in which a deterministic simulation owns state transitions, characters propose bounded actions and dialogue, and a World Director checks selected physical plans and investigation routes before committing them.

The current prototype, The Last Bell, combines an append-only event history, perspective-limited beliefs and memories, authored decision policies, optional language-model character turns, a shared action vocabulary, and an optional Z3 adapter. The inspector reconstructs past states and exposes the provenance of decisions and knowledge. This report describes the implemented contracts, distinguishes their guarantees from their limitations, and develops a research agenda for generating coherent and playable mysteries. The central hypothesis is that expressive characters and rigorous world rules can reinforce one another when their authority and information boundaries are explicit. This hypothesis has not yet been established by a player study or a real-model evaluation.

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
- A concrete, limited experiment in continued investigation viability: replaying candidate solution routes after selected consequential turns.

These are engineering contributions of this prototype. We make no priority claim relative to the wider literature. The [research context](reference.md#research-context) identifies related approaches without implying that their methods or empirical results have been reproduced here.

### How to read the report

Start with [research questions and principles](foundations.md), then [architecture](architecture.md). The next three chapters detail [knowledge](knowledge.md), [character turns](characters.md) and [symbolic validation](symbolic.md). [World Director](director.md) explains the boundary between a feasible action and a viable investigation. [Worked examples](case-study.md) connect those mechanisms to actual play. The remaining chapters address [player and inspector experience](experience.md), [evaluation](evaluation.md), and [procedural generation](generation.md).

The [reference chapter](reference.md) contains a glossary, source map, bibliography and maintenance protocol. A single-page edition collects every chapter for continuous reading and printing. Markdown sources and SVG diagrams are maintained alongside the implementation; generated HTML is a reproducible reading format rather than the editing source.
