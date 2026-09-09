# Living Mystery

A playable, text-based Bellweather mystery with a visual simulation inspector and three alternate authored case configurations.

## Technical report

Read the [Living Mystery technical report](dist/report/index.html), or the
[continuous / print edition](dist/report/complete.html). With the game server
running, the reading edition is also available at `/report/`.

The report has twelve linked chapters and nine SVG diagrams covering the
architecture, knowledge model, character reasoning, symbolic checks, World
Director, worked examples, evaluation and procedural-generation research agenda.
It distinguishes implemented, experimental and proposed behavior.

Edit [the Markdown sources](docs/report/index.md) and figures, then rebuild:

```sh
npm run docs:build
npm run docs:check
```

See [the authoring guide](docs/report/README.md) for the update and validation
workflow. The report is local static documentation; building it makes no model
requests and does not change the game or its saves.

## Play

The browser application is in `dist/`. Scripted play needs only a static HTTP server; it makes no model requests. Optional AI character reasoning uses a local Bedrock proxy, and optional World Director verification uses a separate Z3 service. These settings are independent. A command-line adapter uses the same engine:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
# Open http://127.0.0.1:8000 and keep this server running.

# Terminal play and tests require Node.js 20 or newer:
node cli.mjs
node --test tests/*.test.mjs
```

The browser saves progress on the current device. Export/import includes the complete event history and current world. This is one authored case, **The Last Bell**. Seeds vary schedules; they do not generate a new culprit or crime.

## Optional AI characters

1. Install `boto3` in the Python environment used for the proxy and configure AWS credentials with Bedrock access.
2. Run `python3 server/llm_proxy.py` (restart it after code changes).
3. Serve the game at `http://127.0.0.1:8000` or `http://localhost:8000`, open the game menu → AI characters, and enable endpoint `http://127.0.0.1:8787`.
4. Enable **character reasoning** to get a free-text composer. Ask a question in your own words, or use the existing question/evidence buttons. This is the single AI toggle and is off by default.
5. In Inspector → Trace details, select the character's decision event and open **Character turn audit** to inspect its perspective, proposal, critic and fallback. Export/import preserves accepted words and state without another model call.

Character reasoning combines response selection and natural wording for all six NPCs. The model can choose a permitted account, refuse, challenge, ask for clarification, adjust trust, respond to a player allegation, or explicitly end the conversation. It receives the speaker's own beliefs, retained memories and conversation history. The engine validates a proposal on a session copy before committing the complete turn. Authored accounts still bound factual disclosures and consequential case actions; lies and mistaken beliefs are allowed. A separate model critic checks the prose, but is not a formal correctness guarantee.

With character reasoning disabled, the game gives immediate scripted responses and makes no AI requests. Historical wording-only audits remain readable in older saves. Failed explicit questions use their authored response; failed free-text turns ask for a supported question. See [the character-turn contract and test guide](docs/character-turns.md) for limits and scenarios.

The proxy is loopback-only and permits explicit game origins, valid Host headers, JSON payloads, and the `X-Living-Mystery: dialogue-v2` or `character-v1` request header. For another local game port, set `LM_ALLOWED_ORIGINS` to the exact origin(s). These checks are not authentication against local programs; this is a development proxy, not a public service.

Tests: `node --test tests/*.test.mjs` and `python3 -m unittest discover -s tests -p 'test_*.py'`. Proxy tests use a stub model client and need neither AWS credentials nor boto3. Real Bedrock behavior is a separate integration check.

## Implemented

- Six locations, six characters, three suspects, and fifteen evidence entries.
- Illustrated portraits, location scenes, and selected artifact icons share a consistent visual style; labels and gameplay states remain accessible text. See [the art and procedural asset design](docs/art-direction.md).
- Evidence-gated cross-examination, source questions tied to the preceding reply, persistent alibi revisions, refusals, and character-specific evidence reactions. Follow-ups require the relevant account to have been discussed.
- Conversation partners stay engaged across questions and evidence presentations. Closing the conversation or taking another valid world action releases their plans; other NPCs continue moving.
- A player-built Reasoning board: place acquired evidence under Motive, Means, Opportunity, or Alibi for each suspect and mark it supports/contradicts. Source links, objective account conflicts, and a timeline help compare evidence without grading guilt. The medical window appears only after it is established by discovered evidence or testimony.
- Knowledge-driven correction/reporting: Ada can seek Bell to correct her rumor; a cooperative Clara can report witnessing the folio retrieval.
- A clock that advances only on consequential actions, with travel and NPC routines.
- Bounded deterministic choices with recorded alternative scores and reasons.
- Structured beliefs with confidence, provenance, and explicit observation/testimony distinctions.
- Local NPC witnesses record arrivals and departures as causal observations and retained memories, including player movement.
- A replay-aware Memories tab shows time, location, and sensory observation/dialogue content in acquisition order, linking each memory to its source event.
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
- Export/import includes Reasoning board placements and dialogue audits alongside deterministic engine history. Import replaces the current board; legacy saves start with an empty board. Existing separate device-local board notes migrate when loading that device’s older investigation.

## Code map

| File | Role |
| --- | --- |
| `dist/claims.mjs` | Claim validation, player-visible claim history, revisions, and limited consistency relations |
| `dist/cases/last-bell-claims.mjs` | Authored evidence/testimony claims for this case |
| `tests/claims.test.mjs` | Cross-examination, revision, privacy, correction/report plans, and legacy-save scenarios |
| `dist/schema.mjs` | Typed contracts (JSDoc): Action/Effect/Belief/Event, the Model/Kernel/Case interfaces, and a declarative action catalog + `validateAction` |
| `dist/kernel.mjs` | Generic, case-agnostic simulation kernel: event log, reversible patches, replay, save/load, diagnostics, and the neutral verbs (`createKernel(model)` with an injected `decide` policy) |
| `dist/cases/last-bell.mjs` | The Last Bell as a Case: initial world, NPC decision policy, and authored dialogue (`model` + `baseWorld` + `createBehavior(kernel)`) |
| `dist/case.mjs` | Authored data tables: locations, characters, evidence, hidden history, case rubrics |
| `dist/engine.mjs` | Thin façade: assembles kernel + active case, hosts the generic action router, and re-exports the stable public API |
| `dist/inspector.mjs` | Read-only character sighting and missed-opportunity projections at a replay cursor |
| `dist/ui.mjs` | Game and visual inspector adapters (+ persisted optional AI delivery audit) |
| `dist/dialogue-save.mjs` | Saves and validates dialogue audits and Reasoning board annotations separately from deterministic world state |
| `dist/character-turn.mjs` | Perspective construction, character proposals, critic, bounded retries and atomic application |
| `dist/llm.mjs` | Free-form AI dialogue with entity/number checks, a separate semantic critic, and audited fallback |
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

The engine is authoritative within this single-player client, not a secure server. Source, exported saves and the inspector expose the solution. Optional AI character turns influence dialogue and bounded character state through validated proposals; the model cannot submit arbitrary world patches. Semantic critics can miss mistakes. Recorded runs replay deterministically; new AI runs may vary. An optional Z3 adapter validates authored correction/concealment plans and bounded AI-selected capabilities through the shared action contracts. There is no ASP solver, general LLM physical planning, procedural crime generation, automatic branching, spatial playable client, or cloud save synchronization yet.

Dialogue remains authored and bounded, with specific reactions for relevant evidence and explicit knowledge limits otherwise. Movement memories can be recounted through sightings; selected witnessed actions and learned corrections drive reporting plans. Claims cover selected assertions and support limited temporal/location comparisons, not a solver-backed proof of coherence. A Done marker means an option has been used successfully, not that repeating it cannot yield new information.

The evidence rubric is authored. It validates a playable case; it is not a proof of general logical solvability, evidence independence, or legal sufficiency. NPC policies cover a few explicit situations rather than a general planning system. Confidence values are authored scores, not calibrated probabilities. Initial social relationships are fixed; trust toward the player changes through interaction.

## Useful debugger exercises (spoilers)

1. Inspect the accounts at the manor. Find Silas at the vestry and present them. Wait while he retrieves the folio. Follow the speech event to the new belief, decision, movement, object transfer, and concealment. The folio remains discoverable in the vestry drawer.
2. Read Clara’s letter at the greenhouse. Present it to Clara and threaten exposure. Follow her journey to Rowan and inspect his new belief and reduced trust. Revisit the same history before the warning to see that he did not already know.
3. Wait in the square for Ada’s visit. Inspect the origin of Bell’s new belief, then challenge Ada with the clock evidence. Bell retains her original report until informed otherwise.
4. Travel from the square to the manor. In the inspector, open Bell’s Memories to find your departure, and Clara’s Memories to find your arrival. Follow each observation to the movement that caused it; seek backward to see when the memory was acquired.
5. Export, reload, and check that replay reproduces the same current world.

## Next development steps

See [the roadmap](docs/roadmap.md) for the sequence to finish The Last Bell before procedural generation, the more sophisticated inspector design, and a manual acceptance checklist. The current inspector opens on World, offers character perspectives and a milestone strip, and reveals missed opportunities only after a separate spoiler action.

The planned [shared symbolic layer](docs/symbolic-reasoning.md) maps a common model to solver adapters, starting with Z3, and feeds attributed conclusions back through engine validation. Its main uses are procedural case creation, agent-output checks and final-case arguments. Z3/World Director checks cover Ada’s correction, Silas’s concealment and the shared capability-plan queue; see [setup and testing](docs/director-testing.md).

## Toward a Stardew-style presentation

Keep commands, world events, and the public player projection independent of rendering. A future top-down town client can translate tile clicks into the existing actions and animate the resulting movements and observations. The next data-model work should introduce explicit spatial coordinates and route segments while preserving the same information boundary and inspector event contract.


## Optional World Director / Z3

This runs independently of AI and needs no AWS credentials. Create a Python virtual environment, install `server/requirements-solver.txt`, and run `.venv/bin/python server/director_server.py`. In the game menu choose **World Director → Enable Z3 turn checks**. Scripted mode stays immediate with local plan checks when this is off.

Z3 verifies recorded short-plan constraints before a candidate turn commits. Turns with admitted take, store, give or conceal steps additionally need an engine-replayed investigation witness when Director verification is enabled. Inspect decision events for the checks and their assumptions. This is a bounded first slice, not a general no-dead-ends guarantee. [Detailed test guide](docs/director-testing.md).


Character reasoning can now select bounded physical plans alongside dialogue.
Plans start after the conversation, share the scripted action checks, and survive
save/load. Belief revisions preserve their sources and invalidate explicitly
dependent inferences. See [the character contract](docs/character-turns.md) and
[Director testing](docs/director-testing.md) for the current scope and test steps.

## New: alternate Last Bell configurations

Menu → **Choose a case configuration** offers The Ledger, The Codicil and The Notice alongside the original case. Each has a different culprit, weapon, motive and crime time, executed evening history, sourced evidence and a fully scripted solution. Export your current investigation before replacing it. Restart and imported saves retain their case identity.

The new configurations enforce bounded investigation admission even with AI and optional Z3 off. Acquisition search builds and engine-replays a witness; unsupported or exhausted checks defer effects. These are handcrafted reference configurations, not random generation or a general proof of solvability. See [implementation and testing](docs/case-configurations.md).
