# Living Mystery

A text-first mystery game in a simulated town. Characters have beliefs, memories, daily goals and inspectable histories. A deterministic engine owns world changes; optional language models choose bounded responses and activities; symbolic checks constrain represented actions and explanations.

The prototype includes the original **The Last Bell**, three authored Bellweather configurations, and a seeded generator over the same cast and map. Generated cases vary culprit, method, motive, time, misdirection and investigative structure. This is a bounded procedural domain, not arbitrary mystery generation.

## Play

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
# Keep the server running; open http://127.0.0.1:8000
```

Scripted play requires only the static server. It makes no LLM requests. The clock advances through player actions rather than wall time. Node.js 20 or newer also supports terminal play: `node cli.mjs`, or `node cli.mjs bellweather-02` for a configured case.

Open the game menu → **Choose a case configuration** to select an authored case or generate one. Export your current investigation first if you want to retain it: starting a case replaces the active browser save. Generated IDs preserve their parameters for reload; simulation seeds and generation seeds serve different purposes.

## What is implemented

| Area | Current behavior |
| --- | --- |
| Investigation | Explicit scripted questions, contextual follow-ups, evidence presentation, a player-built Reasoning board and final accusations |
| Player UX | Clear scene transitions, five recent entries in chronological order, paged history, local-person highlights and reusable Done-marked options |
| Ordinary lives | Six configured-case NPCs pursue timed work, errands and rest; invitations and appointments require real encounters; failed plans expire or retry |
| Knowledge | Beliefs retain sources and revisions. Configured live updates require registered support rules; attributed testimony is distinct from established fact |
| Crime history | Configured prehistories execute travel, possession, the fatal action, observations, evidence production and report delivery before play begins |
| Forensic reasoning | Configured accusations test selected acquired evidence against competing suspect/method/motive explanations in a finite time domain |
| Generation | `trace`, `cleanup` and `clockwork` structures; typed source checks and a separately replayed witness for every declared solution route |
| Inspector | World and character perspectives, event timeline, beliefs, memories, daily-life state, causal sources, trace audits and separately revealed missed opportunities |
| Persistence | Event replay, save integrity checks, Reasoning board annotations and accepted dialogue/audits restore without new model calls |
| Artwork | Packaged portraits, locations and selected artifacts; no runtime image generation |

The original Last Bell retains its richer legacy case policies and authored accusation rubric. Newly created configured/generated cases use the autonomous-life and forensic contracts. Older histories are not rewritten to invent the new typed occurrences; start a new case to test full crime-history certification.

## Try the latest features without AI

1. Choose **Generate a cleanup investigation**. Compare the discarded cloth with the laboratory record, or follow the surviving physical-evidence route.
2. Choose **Generate a clock-dependent investigation**. Calibrate the clocked watch, or use the independently timed record.
3. Submit a partial evidence bundle to Bell, then add support. He distinguishes ambiguity, contradiction, internally inconsistent records and a supported explanation. Feedback names only selected acquired records.
4. Wait, visit other locations and inspect **Daily life**. Characters work, rest and attempt appointments while mystery-related policies retain priority when selecting new plans.
5. Export and reload mid-investigation; scrub the inspector timeline to compare earlier beliefs and activities with the present.

See [forensic contracts and testing](docs/forensic-model.md) and [autonomous lives](docs/autonomous-lives.md).

## Optional AI characters

Install `boto3` in the proxy's Python environment, configure AWS credentials with Bedrock access, and run:

```sh
python3 server/llm_proxy.py
```

Serve the game at `http://127.0.0.1:8000` or `http://localhost:8000`. In **AI characters**, configure `http://127.0.0.1:8787` and enable the single character-reasoning toggle. Restart the proxy after its code changes.

AI interprets free-text questions, selects available accounts and intents, and generates natural replies. A separate semantic critic and engine validation precede atomic commitment. Authored accounts still bound consequential disclosures; characters may lie or be mistaken. Conversation generation/criticism has a combined 30-second budget. A critic is not a formal guarantee about prose.

In configured/generated cases, the same toggle also enables at most one additional NPC activity-selection request per player turn: a five-second request selecting one to three available goals, with a twenty-simulated-minute cooldown per NPC. The model receives that NPC's perspective. Deterministic execution, commitment checks and fallback remain in the engine; there are no model calls on every simulation tick.

Disabling AI gives immediate scripted dialogue and deterministic life choices. Inspector decision audits preserve proposals, checks and fallbacks. See [the character contract](docs/character-turns.md) for details.

The proxy is loopback-only with explicit Origin, Host and request-header checks. Set `LM_ALLOWED_ORIGINS` for another local game origin. These development restrictions are not authentication against local programs; do not treat the proxy as a public service.

## Optional World Director / Z3

Z3 is independent of AI and requires no model credentials:

```sh
python3 -m venv .venv
.venv/bin/pip install -r server/requirements-solver.txt
.venv/bin/python server/director_server.py
```

In the game menu choose **World Director → Enable Z3 turn checks**. The service independently checks represented physical plans, typed crime history in new configured sessions, and alternative-explanation exclusion for accepted accusations. The client verifies at most 96 queries in batches of twelve within one ten-second turn deadline. Timeout, unavailable and unknown results do not count as certification.

Configured local belief, plan and investigation admission remains active when Z3 is off. The synchronous browser generator performs local finite checks; it does not claim Z3 certification at creation. For reproducible offline certification with Node and the solver installed:

```sh
npm run cases:verify -- 17 cleanup
npm run cases:verify -- 17 clockwork
```

See [Director setup and scenarios](docs/director-testing.md).

## Technical documentation

Read the [living technical report](dist/report/index.html), or its [continuous / print edition](dist/report/complete.html). With the game server running, open `/report/`. Edition 0.6 contains twelve linked chapters and eleven SVG diagrams, with implemented behavior, experimental guarantees and proposed extensions labeled separately.

- [Architecture](docs/architecture.md): engine, case, knowledge and admission boundaries.
- [Forensic model](docs/forensic-model.md): typed sources, finite explanations, structural routes and certification limits.
- [Autonomous lives](docs/autonomous-lives.md): goals, meetings, model budgets and replanning.
- [Case configurations](docs/case-configurations.md): assembly, generation and replayed investigation witnesses.
- [Symbolic design](docs/symbolic-reasoning.md): shared representation, Z3 and future multi-logic extensions.
- [Roadmap](docs/roadmap.md): remaining work toward broader procedural worlds.
- [Artwork design](docs/art-direction.md): consistency, reuse and future generation-cost controls.

Edit the [report sources](docs/report/index.md), then run `npm run docs:build` and `npm run docs:check`. The [authoring guide](docs/report/README.md) describes the workflow. Building documentation makes no model requests and changes no game saves.

## Code map

| Modules | Responsibility |
| --- | --- |
| `kernel.mjs`, `knowledge.mjs` | Events, reversible state, replay, belief lifecycle and injected support validation |
| `engine.mjs`, `engine-runtime.mjs` | Session-specific case selection, runtime assembly and command routing |
| `cases/last-bell.mjs`, `case.mjs` | Original case behavior and data |
| `cases/bellweather*.mjs`, `cases/investigative-structures.mjs` | Configured case assembly, public lives, specs and structural variation |
| `modules/` | Misdirection, correction, private-secret and concealment modules |
| `life.mjs`, `autonomy-turn.mjs` | Deterministic goals/appointments and optional bounded model selection |
| `character-turn.mjs`, `llm.mjs`, `dialogue-save.mjs` | Conversation orchestration, transport/legacy realization support and saved audits |
| `actions.mjs`, `agent-plans.mjs`, `symbolic.mjs` | Shared physical vocabulary, queued execution and solver-neutral constraints |
| `forensics.mjs`, `casegen.mjs` | Typed provenance, explanation queries, finite grading and generation gates |
| `admission.mjs`, `investigation.mjs`, `world-director.mjs`, `director-turn.mjs` | Candidate checks, route search, plan admission and optional transactional Z3 |
| `claims.mjs`, `inspector.mjs`, `ui.mjs`, `styles.css` | Player claims, debugger projections and browser interface |

JavaScript modules above live under `dist/`. Python adapters live under `server/`; `tools/validate-case.mjs` provides offline certification, and `tools/debug-session.mjs` inspects exported sessions.

## Validation and limits

```sh
npm test
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
npm run docs:check
```

The latest implementation run passed **173 JavaScript tests and 10 Python tests**, including real Z3 checks with zero skips. Without `.venv`/Z3, real-solver JavaScript tests skip; a green suite alone does not imply solver coverage. Model tests use mocked responses. Browser layout, live model quality and human puzzle quality need separate evaluation.

The forensic domain assumes one killer, listed methods/motives, reliable forensic records and a study encounter. Route replay proves a bounded successful investigation under current scheduling, not universal freedom from dead ends. No ASP, Lean certificate export, general solver-derived cognition, arbitrary new-cast/map generation, resource economy or spatial playable client is implemented. Confidence values are authored scores, not calibrated probabilities.

The local client, source, inspector and saves expose hidden truth. The engine is the authority for gameplay transitions, not an adversarial security boundary. New AI runs may differ; recorded history replays without calling either external service.
