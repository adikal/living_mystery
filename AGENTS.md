# Living Mystery — agent guide

A zero-build browser detective game. A deterministic engine owns all state; language models write cases and play
characters, and everything they produce is checked by code. Read this before changing code or debugging a report.

## Ground rules

- **Do not push** to the remote unless the user asks. Commit locally at green milestones.
- **The model proposes; the engine decides.** Models never state what a clue proves, never mutate state directly, and
  never invent facts at play time. Meaning lives in typed records (`dist/mk/kernel.mjs` computes it); prose is generated
  from records and checked against them.
- **Zero build.** `dist/` is served as-is (ES modules). No bundler, no TypeScript.
- Keep the core suite green (see Testing). Prefer fixing the general mechanism over patching one case.

## Run everything

```
.venv/bin/python server/static_server.py      # :8000  game (no-cache) + browser log endpoint
.venv/bin/python server/llm_proxy.py          # :8787  Bedrock proxy for dialogue/character turns
.venv/bin/python server/director_server.py    # :8788  Z3: case oracle (/case) and plan checks (/solve)
.venv/bin/python server/generator_server.py   # :8789  case generation jobs
```

Open http://127.0.0.1:8000. Model calls need valid AWS credentials for Bedrock (us-west-2). The proxy rebuilds its
client on failure; the generator creates a fresh client per job. Python modules are cached per process: **restart the
generator server after changing `tools/refine-c/*.py`**, and the proxy after changing `server/llm_proxy.py`.

## Logs (read these first when the user reports a problem)

All under `logs/` (gitignored):

| File | Contents |
|---|---|
| `logs/game.log` | one JSON object per line from the browser: `action`, `rejected`, `toast`, `character_turn` (question, accounts offered, each attempt's validation and fact-checker verdict, the reply chosen), `hint`, `case_start`, `generation_*`, `js_error`, and `issue` (a user-flagged problem with a game-state snapshot) |
| `logs/generator.log` | job lifecycle, every layer and draft check, tracebacks |
| `logs/proxy.log` | every model call: profile, model, sizes, latency, failures |
| `logs/director.log` | Z3 requests: accusation checks (survivors, alternative story) and plan checks |
| `logs/replay-*.txt` | transcripts from `tools/replay-dialogue.mjs` (character model comparisons) |
| `tools/refine-c/runs/live-<job>/` and `.log` | per-generation working files and harness log |

Typical lookups:

```
grep '"kind": "issue"' logs/game.log | tail -3                 # what the user flagged, with state
grep '"kind": "character_turn"' logs/game.log | tail -3        # why an AI reply was rejected (see 'spoken', 'rejections')
grep '"kind": "accusation"' logs/game.log | tail -3            # verdict, pillars, Z3 alternative
tail -50 logs/generator.log                                    # a stuck or failed generation
```

The user's screenshots are on `~/Desktop` (names contain a narrow no-break space; copy with a glob before reading).

## Where things are

| Area | Files |
|---|---|
| Engine | `dist/kernel.mjs` (event log, replay, knowledge), `dist/engine-runtime.mjs` (action router), `dist/engine.mjs` (case routing, saves) |
| Mystery kernel | `dist/mk/kernel.mjs` (sign semantics, certification incl. motive/means/opportunity pillars), `tools/mk-certify.mjs`, `dist/mk/answer-types.mjs` (methods, motives) |
| Z3 case oracle | `server/case_oracle.py` (independent feasibility and uniqueness, unsat cores, alternative stories); publish gate in `publish.gate` |
| Village | `dist/cases/village.mjs` (10 places, 12 people, character sheets) → `node tools/extract-setting.mjs > tools/refine-c/settings/bellweather.json`; art in `dist/assets/last-bell/`, made with `tools/art/generate.py` |
| Generated cases in play | `dist/cases/kernel-case.mjs` (records → runtime: history, beliefs, gated clues, accounts, showing evidence, hints, grading) |
| Characters | `dist/character-turn.mjs` (free-text turns: perspective with character sheet and mood, validation incl. name and spoken-time guards, critic, fallback); `tools/replay-dialogue.mjs` replays a playtest through the proxy |
| UI | `dist/ui.mjs`, `dist/styles.css` |
| Generation | `tools/refine-c/premise.py` (premise deck: who, how, why, where; rotation; seed checks), `tools/refine-c/refine.py` (harness, reviewer), `tools/refine-c/publish.py` (`enrich_case` pipeline + `gate`), `tools/refine-c/enrich.py` (answer, loose ends, everyday knowledge, moods, publish review), `server/generator_server.py` |
| Cases | `dist/cases/generated/*.json` (shipped), `dist/cases/generated/live/` (generated on this machine, gitignored) |
| Design | `docs/visual-world.md` (next: map, scenes, dialogue, inventory; free-form dialogue is never dropped), `docs/mystery-kernel.md`, `docs/difficulty.md` (case difficulty: features, model, fitting), `docs/architecture.md`, `docs/roadmap.md`, report in `docs/report/`, deck in `docs/deck/` |

## Testing

```
perl -e 'alarm 150; exec @ARGV' node --test --test-timeout=60000 tests/*.test.mjs   # ~20 s
.venv/bin/python -m pytest tests/ -q
.venv/bin/python tools/refine-c/test_refine.py          # harness checker
.venv/bin/python tools/refine-c/test_premise.py         # premise deck
.venv/bin/python tools/refine-c/test_difficulty.py      # difficulty features, model, targets, fitting
.venv/bin/python tools/refine-c/test_art.py             # clue picture keys
.venv/bin/python tools/refine-c/parity.py               # Python and JS checkers agree on every generated case
.venv/bin/python scripts/build_report.py --check        # after editing docs/report
node tools/e2e_dialogue.mjs dist/cases/generated/live/<case>.json   # every character, standard questions, real AI
.venv/bin/python tools/refine-c/batch.py easy medium hard           # generate cases in parallel (one process each)
```

Always use a time limit: a UI test that fails before clearing a polling timer can keep Node alive. Live checks against
the proxy (`prepareCharacterTurn` → `proposeCharacterTurn` → `applyCharacterTurn`) are the way to verify dialogue fixes.

## Pitfalls seen before

- **Saved games keep their case records.** A fix to a published case's content only appears after starting it again
  from Choose a case (or Restart this case, which reloads the file). Code fixes appear on a normal refresh.
- **Model output shapes vary** (nested wrapper keys, lists instead of maps). Normalise, and retry once on empty output.
- **Anything a player must reason with has to be visible** (time window, traits). If certification assumes a fact, the
  player must be able to learn it.
- **Free-text replies may only use accounts** (including 'everyday'). Memories are private; the guarded third attempt keeps them so. Menu questions must use their own account.
- **A case publishes only through `publish.gate`**: Python kernel, JS kernel and Z3 must all certify it and agree, with every account backed. Publish-time content is wording only (evening and morning summaries, the examination's words, concessions, everyday facts, lines, reactions, pictures) and must not change the solve; the gate re-checks.
- **The history is the only source of facts.** Every account must be backed: an event its speaker took part in or saw, or a 'knows' attitude cited in 'because' (`account_backing` in both kernels; the publish gate requires it). Generation writes the discovery and the examination as typed events (`premise.morning_errors`); publishing adds only wording. Roles (examiner, constable) and the day come from the setting (`enrich.role`, `enrich.day`); never name a person in code. Old cases were brought up to this once with `tools/refine-c/repair_history.py` (now archived). People the history never mentions are not in the case (`publish.prune_people`), and everyone involved has an evening (`premise.evening_errors`). With no account, a character may only decline or ask (`NEUTRAL_LINE` in `dist/kernel.mjs`; never offered as an account), and asks what the detective means at most once in a row. The accusation accepts every method and motive the player's evidence fairly supports (`answer.methods`/`answer.motives`, `enrich.add_accepted`).
- **Motive = culprit ↔ victim.** Motive evidence must connect the culprit to the victim; generation must write it (certification checks it). The accusation accepts every method and motive the evidence supports as well as the truth (`enrich.add_accepted`, scored per option).
- **Text written for play must not mention clues or lies** (`enrich.clue_nouns`); the culprit's mood never comes from their attitudes.
- **Bedrock image calls throttle**: `tools/art/generate.py --auto` runs four assets at a time with backoff. Objects are drawn from text (Stable Image Ultra; a style reference makes the Style Guide copy its content); a vision judge picks the candidate.
- **Accounts and questions**: the evening summary answers "last night", the morning summary (`morning: true`) only "this morning"; every other account is offered by its own question or "anything else". `tests/kernel-case.test.mjs` checks every account is reachable from the menu in every case. With nothing in the history, a character may say they don't know, react or ask, never invent; whereabouts questions use the night account (lies included).
- **Who is in a case** is one definition (`premise.involved`): the cast at publish and the evening rule at generation both use it. Everyone involved must have an evening in the history.
- **Retired cases** live in `dist/cases/archive/` (not in the menu); see its README.
- **Clue pictures**: a library of painted objects (`OBJECT_LIBRARY`, `dist/art.mjs`) that the generator knows; each clue's picture key is chosen at publish (`enrich.add_art`, checked by code). See docs/visual-world.md.
- **Difficulty** is computed from the certifier's report (`tools/refine-c/difficulty.py`; model as data in `settings/difficulty.json`), stored at publish, shown as pips + a word. Never ask a model to rate a case.
- **UI layout** (docs/visual-world.md, "As built"): map and Look around (left); scene and conversation (middle); Talk, Evidence, Hints (right); Clue Board with every villager; Accuse in the top bar. Free-form dialogue must always stay available; drag and drop shows evidence (keyboard: Show buttons). A pressed-button transform must never move absolutely positioned pins (use `translate`).
- **Generated cases use their own cast and places** (`caseTables(s)`), never the Last Bell's `PEOPLE`/`LOCATIONS` imports.
- Browser caching is handled by `static_server.py`; do not serve `dist/` with `python -m http.server`.
