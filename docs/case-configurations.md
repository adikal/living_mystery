# Authored case configurations and admission

The runtime supports the original case, three authored configurations and seeded generated cases over the existing cast/map. Configured/generated cases combine executable prehistory, typed forensic reasoning, independently replayed routes and ordinary autonomous lives. Optional bounded model deliberation supplements a complete deterministic policy.

## Try it without AI

Refresh the game, open the menu and choose **Choose a case configuration**. Export your current investigation first if you want to retain it: starting a configuration replaces the active browser save. Choose The Ledger, The Codicil or The Notice. The original Last Bell remains available, and existing saves retain its behavior. Restart preserves the selected configuration; import restores the configuration stored with that save.

Leave AI disabled. Ask Bell for guidance, inspect the study and follow the records to the other locations. The examination, trace, damaged object, timed receipt, estate papers and doctor's visit record supply the supported physical case. The method and motive menus contain all three choices. The correct choices differ between configurations. Inspector is omniscient: scrub before the morning boundary to inspect the actual evening journeys, meeting, crime and report, then follow the source of acquired evidence. Export/import and resume to check replay.

The terminal also accepts a configuration: `node cli.mjs bellweather-02`.

## Specification and execution

`dist/cases/bellweather-configs.mjs` declares fixed culprit, weapon, motive, injury and crime time. `makeCase` binds one specification to case tables and scripted behavior. `createRuntime` closes over its kernel and behavior; the façade selects that runtime from the session's case ID. Browser views and character perspectives resolve tables from that session, so concurrent saves cannot borrow another case's private facts.

`executePrehistory` advances the same kernel used in play. Suspects and the doctor travel to a witnessed appointment; the culprit takes a weapon, travels, signs a receipt, performs a guarded fatal action and returns the damaged weapon. The doctor examines the body and reports to Bell only after reaching him. Impossible timing, possession or meeting states fail construction. Travel and taking use the shared action/constraint pipeline. Fatal actions and document creation have explicit engine checks. The forensic IR additionally checks recorded possession, observation access, production ancestry and temporal consistency; it is not a complete SMT crime theory.

Evidence text is rendered from the authored specification. Its acquisition event links to the executed event that produced the relevant trace or record. Initial beliefs link to personal observations or a delivered report. The player begins the following morning and receives no prehistory transcript as player observation. The inspector can inspect that private history.

## Bounded continued investigation

`searchInvestigation` searches acquisition actions derived from the active locations, objects and proof routes. It tracks location, acquired evidence and elapsed time, uses prerequisite closure and a lower-bound heuristic, and appends an accusation at the square. Defaults are 180 simulated minutes, 32 commands, 16,000 explored nodes and at most five attempted witness replays. A positive result requires the full sequence to execute successfully in an isolated engine and reach an accepted accusation with valid replay integrity.

The original case also contributes two testimony-acquisition actions. There are no longer two fixed itineraries. Search exhaustion is **unresolved**, never proof that no investigation exists. Closed-location routing is unsupported and conservatively unresolved; arbitrary social planning and alternate future agent policies are outside this search. The private search goal uses the configured solution to choose an accusation candidate. The real configured grader then evaluates the acquired records against competing explanations; it does not use the hidden culprit as a premise. Search remains a developer-side existence check, separate from player-facing proof evaluation.

For configured/generated cases, every public player/character dispatch runs on a copy and requires a surviving witness before commit. Relevant intermediate changes to object access/possession and declared evidence deadlines are checked too. A failed required check leaves the attempted time and effects unapplied and records a deferral. Bell's public square commitment is enforced during morning plan admission. Static evidence and this reserved recipient keep the supported acquisition domain small and explicit. Optional evidence may become inaccessible if a supported route survives.

Capabilities receive a preliminary viability filter over their projected object effects and public commitments. That preview is conditional, not a complete timed plan certificate; actual execution is rechecked. Private witness details remain in Inspector audits, not NPC dialogue. The privileged kernel/runtime APIs remain developer tools and are not an adversarial security boundary.

These local acquisition checks stay enabled with AI and optional Z3 disabled. Optional Z3 continues to independently validate represented short-plan constraints. The original case retains its existing optional Director boundary; it has not been migrated to the new mandatory admission contract. No general guarantee is claimed for arbitrary effects, semantic dialogue, uncertain futures or infinite postponement.

## Scope and next gate

The three variants are deliberately small reference mysteries, now **composed from narrative modules** and enriched with a per-case misdirection thread (a mistaken sighting the sighter owns, the mis-seen innocent rebuts, and the alibi witness redirects to her record), an honest-mistake correction the witness carries to Bell in person, a benign-secret evasive innocent (interwoven with the misdirection), and a live culprit concealment — plus a second (documentary) proof route. Existing portraits and location art are reused; weapon illustrations fall back to text to avoid displaying the wrong object. No image or LLM requests are needed to create a case.

**Validated generation is implemented as a bounded slice of G2.** `dist/casegen.mjs` (`validateCase`) enforces physical execution, epistemic sourcing, bounded reachability, evidence-driven distinguishability and each composed brick's invariant; `sampleCases(seed,n)` varies culprit/weapon/motive/time/misdirection and `trace`/`cleanup`/`clockwork` structure over the fixed cast, returning specifications that pass every obligation. Current regressions exercise all three structures and seeded samples, not the entire expanded grid. A `gen-*` id reconstructs its spec via `specFromId`, so generated cases resolve lazily, play and save/reload like authored ones, and the menu offers a "generate a case" action. Prose is role-aware but templated. Distinguishability is checked over the declared suspect/method/motive/time domain using acquired evidence, and composition remains over the fixed cast.

Before broadening further, extend the existing evidence-production rules, alternative-explanation domain and prehistory vocabulary; add uncertain document reliability and social acquisition; and evaluate more configurations through human playthroughs. Then extend generation to new characters, relationships, maps and mystery structures with the same validator gating each new domain.


## Autonomous life implementation

Configured/generated cases now support persistent ordinary goals, timed activities, delivered social requests, accepted commitments and replanning. `life.mjs` drives scripted policies through shared move/activity constraints; `autonomy-turn.mjs` adds isolated optional model selection of bounded goal sequences. The original case retains its legacy policies. Z3 verification batches up to twelve queries per request under the existing atomic turn boundary. See [the complete implementation and test guide](autonomous-lives.md) for state, budgets, assumptions and limitations.

## Shared forensic milestone

New configured/generated cases now use typed source support, registered live belief rules, a shared crime/explanation IR, and a finite competing-explanation accusation grader. Generation varies `trace`, `cleanup` and `clockwork` structures and independently replays every declared route. Optional Z3 verifies recorded history and excludes competing explanations; local non-AI play uses the same finite rules. The original case retains its legacy rubric. See [the forensic model and testing contract](forensic-model.md) for exact scope, commands and limits.
