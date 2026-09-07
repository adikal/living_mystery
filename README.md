# Living Mystery

A first playable, text-based Bellweather mystery with a visual simulation inspector.

## Play

The browser application is in `dist/` and has no runtime dependencies, external services, or API keys. Serve that directory with any static HTTP server. A command-line adapter uses the same engine:

```sh
node cli.mjs
node --test tests/*.test.mjs
```

The browser saves progress on the current device. Export/import includes the complete event history and current world. This is one authored case, **The Last Bell**. Seeds vary schedules; they do not generate a new culprit or crime.

## Implemented

- Six locations, six characters, three suspects, and fifteen evidence entries.
- A clock that advances only on consequential actions, with travel and NPC routines.
- Bounded deterministic choices with recorded alternative scores and reasons.
- Structured beliefs with confidence, provenance, and explicit observation/testimony distinctions.
- Clara can disclose information after reassurance or travel to warn Rowan after a threat.
- Showing Silas the accounts changes his beliefs and prompts him to retrieve and hide a real document.
- Ada can pass an honest mistake to Bell. Correcting Ada does not silently correct Bell.
- Two authored evidence rubrics, checked against evidence the player actually acquired and submits.
- A filtered player view; no private profiles or hidden actions enter the investigation transcript.
- A visual inspector with search, actor/type filters, causal links, state diffs, decision scores, character profiles, beliefs and source events, per-character history, world positions, case history, and integrity checks.
- Read-only replay to any event, without mutating the live simulation.
- Export/import and deterministic continuation after restoring a save.

## Code map

| File | Role |
| --- | --- |
| `dist/case.mjs` | Authored locations, characters, evidence, hidden history, case rubrics |
| `dist/engine.mjs` | Simulation, action execution, event records, replay, projections, save validation |
| `dist/ui.mjs` | Game and visual inspector adapters |
| `dist/styles.css` | Responsive text-game and inspector presentation |
| `cli.mjs` | Terminal adapter using the same engine |
| `tests/engine.test.mjs` | Investigative, causal, information-boundary, replay, and save scenarios |
| `docs/architecture.md` | Design boundaries, debugger model, and next implementation steps |

## Current boundaries

The engine is authoritative within this single-player client, not a secure server. Source and exported saves include the solution. The inspector intentionally reveals it. There is no live LLM, ASP/SMT solver, arbitrary natural-language conversation, procedural crime generation, automatic branching, graphics, or cloud save synchronization in this version.

The evidence rubric is authored. It validates a playable case; it is not a proof of general logical solvability, evidence independence, or legal sufficiency. NPC policies cover a few explicit situations rather than a general planning system. Confidence values are authored scores, not calibrated probabilities. Initial social relationships are fixed; trust toward the player changes through interaction.

## Useful debugger exercises (spoilers)

1. Inspect the accounts at the manor. Find Silas at the vestry and present them. Wait while he retrieves the folio. Follow the speech event to the new belief, decision, movement, object transfer, and concealment. The folio remains discoverable in the vestry drawer.
2. Read Clara’s letter at the greenhouse. Present it to Clara and threaten exposure. Follow her journey to Rowan and inspect his new belief and reduced trust. Revisit the same history before the warning to see that he did not already know.
3. Wait in the square for Ada’s visit. Inspect the origin of Bell’s new belief, then challenge Ada with the clock evidence. Bell retains her original report until informed otherwise.
4. Export, reload, and check that replay reproduces the same current world.

## Toward a Stardew-style presentation

Keep commands, world events, and the public player projection independent of rendering. A future top-down town client can translate tile clicks into the existing actions and animate the resulting movements and observations. The next data-model work should introduce explicit spatial coordinates and route segments while preserving the same information boundary and inspector event contract.
