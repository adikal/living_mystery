# Living Mystery

A first playable, text-based Bellweather mystery with a visual simulation inspector.

## Play

The browser application is in `dist/` and has no runtime dependencies, external services, or API keys. Serve that directory with any static HTTP server. A command-line adapter uses the same engine:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
# Open http://127.0.0.1:8000 and keep this server running.

# Terminal play and tests require Node.js 20 or newer:
node cli.mjs
node --test tests/*.test.mjs
```

The browser saves progress on the current device. Export/import includes the complete event history and current world. This is one authored case, **The Last Bell**. Seeds vary schedules; they do not generate a new culprit or crime.

## Implemented

- Six locations, six characters, three suspects, and fifteen evidence entries.
- A clock that advances only on consequential actions, with travel and NPC routines.
- Bounded deterministic choices with recorded alternative scores and reasons.
- Structured beliefs with confidence, provenance, and explicit observation/testimony distinctions.
- Local NPC witnesses record arrivals and departures as causal observations and retained memories, including player movement.
- A replay-aware Memories tab shows time, location, and belief/dialogue content in acquisition order, linking each memory to its source event.
- Clear scene-change banners, five recent transcript entries in chronological order, and paged full observed history.
- Inspect, Talk, and Wait action groups with explicit character-specific questions and highlighted local people.
- Previously completed inspection, question, and evidence-presentation options remain clickable with a Done marker derived from saved command history.
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
| `dist/schema.mjs` | Typed contracts (JSDoc): Action/Effect/Belief/Event, the Model/Kernel/Case interfaces, and a declarative action catalog + `validateAction` |
| `dist/kernel.mjs` | Generic, case-agnostic simulation kernel: event log, reversible patches, replay, save/load, diagnostics, and the neutral verbs (`createKernel(model)` with an injected `decide` policy) |
| `dist/cases/last-bell.mjs` | The Last Bell as a Case: initial world, NPC decision policy, and authored dialogue (`model` + `baseWorld` + `createBehavior(kernel)`) |
| `dist/case.mjs` | Authored data tables: locations, characters, evidence, hidden history, case rubrics |
| `dist/engine.mjs` | Thin façade: assembles kernel + active case, hosts the generic action router, and re-exports the stable public API |
| `dist/inspector.mjs` | Read-only character sighting and missed-opportunity projections at a replay cursor |
| `dist/ui.mjs` | Game and visual inspector adapters (+ optional LLM-voiced dialogue overlay) |
| `dist/llm.mjs` | Optional, boundary-respecting LLM dialogue realization (restyle-only, deterministic fallback) |
| `dist/styles.css` | Responsive text-game and inspector presentation |
| `server/llm_proxy.py` | Local Bedrock (Converse) proxy for AI-voiced dialogue; holds AWS creds server-side |
| `cli.mjs` | Terminal adapter using the same engine |
| `tests/inspector.test.mjs` | Perspective boundaries, replay-aware missed clues, and evidence relocation |
| `tests/ui.test.mjs` | Adapter regression tests for history, completion markers, scene rendering, and memories (no browser layout testing) |
| `tests/engine.test.mjs` | Investigative, causal, information-boundary, replay, and save scenarios |
| `tests/schema.test.mjs` | Action-catalog coverage and `validateAction` shape checks |
| `tests/llm.test.mjs` | Prompt building, output sanitization, and offline/error fallback for LLM realization |
| `docs/architecture.md` | Design boundaries, debugger model, and next implementation steps |

## Current boundaries

The engine is authoritative within this single-player client, not a secure server. Source and exported saves include the solution. The inspector intentionally reveals it. There is no live LLM, ASP/SMT solver, arbitrary natural-language conversation, procedural crime generation, automatic branching, graphics, or cloud save synchronization in this version.

Most evidence/person combinations still use a generic acknowledgement; only selected combinations have authored reactions. Movement memories are inspectable but do not yet inform dialogue or planning. A Done marker means an option has been used successfully, not that repeating it cannot yield new information.

The evidence rubric is authored. It validates a playable case; it is not a proof of general logical solvability, evidence independence, or legal sufficiency. NPC policies cover a few explicit situations rather than a general planning system. Confidence values are authored scores, not calibrated probabilities. Initial social relationships are fixed; trust toward the player changes through interaction.

## Useful debugger exercises (spoilers)

1. Inspect the accounts at the manor. Find Silas at the vestry and present them. Wait while he retrieves the folio. Follow the speech event to the new belief, decision, movement, object transfer, and concealment. The folio remains discoverable in the vestry drawer.
2. Read Clara’s letter at the greenhouse. Present it to Clara and threaten exposure. Follow her journey to Rowan and inspect his new belief and reduced trust. Revisit the same history before the warning to see that he did not already know.
3. Wait in the square for Ada’s visit. Inspect the origin of Bell’s new belief, then challenge Ada with the clock evidence. Bell retains her original report until informed otherwise.
4. Travel from the square to the manor. In the inspector, open Bell’s Memories to find your departure, and Clara’s Memories to find your arrival. Follow each observation to the movement that caused it; seek backward to see when the memory was acquired.
5. Export, reload, and check that replay reproduces the same current world.

## Next development steps

See [the roadmap](docs/roadmap.md) for the sequence to finish The Last Bell before procedural generation, the more sophisticated inspector design, and a manual acceptance checklist. The current inspector opens on World, offers character perspectives and a milestone strip, and reveals missed opportunities only after a separate spoiler action.

## Toward a Stardew-style presentation

Keep commands, world events, and the public player projection independent of rendering. A future top-down town client can translate tile clicks into the existing actions and animate the resulting movements and observations. The next data-model work should introduce explicit spatial coordinates and route segments while preserving the same information boundary and inspector event contract.
