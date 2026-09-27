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
.venv/bin/python server/director_server.py    # :8788  optional Z3 checks
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
| `tools/refine-c/runs/live-<job>/` and `.log` | per-generation working files and harness log |

Typical lookups:

```
grep '"kind": "issue"' logs/game.log | tail -3                 # what the user flagged, with state
grep '"kind": "character_turn"' logs/game.log | tail -3        # why an AI reply was rejected
tail -50 logs/generator.log                                    # a stuck or failed generation
```

The user's screenshots are on `~/Desktop` (names contain a narrow no-break space; copy with a glob before reading).

## Where things are

| Area | Files |
|---|---|
| Engine | `dist/kernel.mjs` (event log, replay, knowledge), `dist/engine-runtime.mjs` (action router), `dist/engine.mjs` (case routing, saves) |
| Mystery kernel | `dist/mk/kernel.mjs` (sign semantics, certification), `tools/mk-certify.mjs` |
| Generated cases in play | `dist/cases/kernel-case.mjs` (records → runtime: history, beliefs, gated clues, accounts, showing evidence, hints, grading) |
| Characters | `dist/character-turn.mjs` (free-text turns: perspective, validation, critic, guarded third attempt, fallback) |
| UI | `dist/ui.mjs`, `dist/styles.css` |
| Generation | `tools/refine-c/refine.py` (harness), `tools/refine-c/publish.py` (questions, evening accounts, examination, show lines, reactions, live publish), `server/generator_server.py` |
| Cases | `dist/cases/generated/*.json` (shipped), `dist/cases/generated/live/` (generated on this machine, gitignored) |
| Design | `docs/mystery-kernel.md`, `docs/architecture.md`, `docs/roadmap.md`, report in `docs/report/`, deck in `docs/deck/` |

## Testing

```
perl -e 'alarm 150; exec @ARGV' node --test --test-timeout=60000 tests/*.test.mjs   # ~20 s
.venv/bin/python -m pytest tests/ -q
.venv/bin/python tools/refine-c/test_refine.py          # harness checker
.venv/bin/python tools/refine-c/parity.py               # Python and JS checkers agree on every generated case
.venv/bin/python scripts/build_report.py --check        # after editing docs/report
```

Always use a time limit: a UI test that fails before clearing a polling timer can keep Node alive. Live checks against
the proxy (`prepareCharacterTurn` → `proposeCharacterTurn` → `applyCharacterTurn`) are the way to verify dialogue fixes.

## Pitfalls seen before

- **Saved games keep their case records.** A fix to a published case's content only appears after starting it again
  from Choose a case (or Restart this case, which reloads the file). Code fixes appear on a normal refresh.
- **Model output shapes vary** (nested wrapper keys, lists instead of maps). Normalise, and retry once on empty output.
- **Anything a player must reason with has to be visible** (time window, traits). If certification assumes a fact, the
  player must be able to learn it.
- **Free-text replies may only use accounts.** Characters' memories are private; the guarded third attempt keeps them so.
- Browser caching is handled by `static_server.py`; do not serve `dist/` with `python -m http.server`.
