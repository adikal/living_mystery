# Living Mystery

A detective game in an English village in 1932, where every case is new, every character can be questioned in your
own words, and the village goes about its morning while you investigate. Language models write the cases, voice the
characters and decide what people do; a certifying engine makes sure that, whatever they produce, **the case stays
fair: there is always a way to the one true answer, and nothing anyone says breaks the true history.**

The research behind it is called **SleuthCraft**: certified living mysteries with solver-checked language models.

## What is different

Most games that use language models let the model invent freely and hope it stays consistent. In a mystery that
fails quickly: a character contradicts an earlier answer, a clue points nowhere, or the case becomes unsolvable.
Living Mystery is built the other way round.

| Idea | What it means in play |
| --- | --- |
| **One true history** | Each case is a history of events, motives and clues. It is the only source of facts; everything shown to the player is checked against it. |
| **A model proposes, critics decide** | At every layer (writing the case, wording it, a character's reply, what the village does) a model proposes and a bank of critics decides: plain code for what can be checked mechanically, a second model for commonsense and wording, and a certifying kernel, cross-checked by the Z3 solver, for the case remaining solvable with a unique answer. |
| **Cases certified before you play** | A generated case is published only if it is solvable, its answer is unique, and it has real depth: lies and misdirection that the evidence later defeats. Difficulty is computed from the case's structure. |
| **Characters who speak freely, from what they know** | You can ask anyone anything. They answer in their own voice, but only from what they know; they lie only where the case says they lie, and a lie can always be broken by evidence. |
| **A living village that cannot trap you** | Each half hour a director plans what people do: they seek each other out, pass on what they heard, and a culprit may hide evidence, but only if the case can still be solved without it. |
| **A game that improves by playing itself** | Agent players with player profiles play the cases; their games are scored, judged and turned into experiments with registered predictions, and a bug track checks every recorded game against the true history. |

## How it works

```
 before play                                     during play
 ┌─────────┐  ┌────────────┐  ┌────────────┐     ┌──────────────┐  ┌───────────────┐  ┌───────────────────┐
 │ Premise │→ │ Generation │→ │ Publishing │  →  │ Conversation │  │ Living morning│  │ Accusation, hints │
 └────┬────┘  └─────┬──────┘  └─────┬──────┘     └──────┬───────┘  └───────┬───────┘  └─────────┬─────────┘
      │ a model proposes; code, a second model and the certifying kernel (with Z3) decide, at every layer │
      └──────────────────────────────┴─────────────── one true history ───────────────┴─────────────────┘
```

The [living technical report](dist/report/index.html) explains each layer; [docs/architecture.md](docs/architecture.md)
gives the engine contracts.

## Play

```sh
python3 server/static_server.py          # the game, at http://127.0.0.1:8000
```

That is enough for scripted play with the original case, *The Last Bell*, and the shipped generated cases; it makes no
model requests. For AI characters, the living morning and case generation, run the local servers as well (they need
AWS credentials with Bedrock access, and a Python environment with the solver):

```sh
python3 -m venv .venv && .venv/bin/pip install -r server/requirements-solver.txt boto3
.venv/bin/python server/llm_proxy.py          # characters and director     :8787
.venv/bin/python server/director_server.py    # Z3 checks                   :8788
.venv/bin/python server/generator_server.py   # new cases (several minutes) :8789
```

**A local open-weight model instead of Bedrock.** Each in-game call has a role (`character`, `checker`, `director`,
`line_critic`, `autonomy`, `dialogue`), and the proxy sends each role to the backend and model in `LM_ROUTES`; roles not
named stay on Bedrock. For example, with [Ollama](https://ollama.com) and Gemma 4 for the characters and their
fact-checker:

```sh
ollama serve &  ollama pull gemma4:26b
LM_ROUTES="character=ollama:gemma4:26b,checker=ollama:gemma4:26b" .venv/bin/python server/llm_proxy.py
```

The proxy prints its routes on start and reports them at `GET /health`, with the turn timeout the game should use
(240 s when the character or checker is local, 45 s on Bedrock). Stop it and start it without `LM_ROUTES` to go back.
Case generation and the playtest tools always use Bedrock.

In the game: choose a case from the menu, or **✨ Generate a new deep case**. Talk to people with the listed questions
or in your own words, examine what you find, show it to people, and take your case to the constable. The notebook's
**Hints** tab gives one nudge at a time. **Menu → 🐞 Flag an issue** saves a note and the game state to `logs/game.log`.

## Improving the game by playing it

`tools/playtest/` runs the game through a text interface for agent players (beginner, amateur and pro profiles) and
treats every change as an experiment: a cause checked in the data, a prediction written down first, a cheap offline
check, then paired games on held-out cases. A separate bug track checks every recorded game with invariant detectors
and a correctness judge, and each finding is reproduced and confirmed before it counts.

What it has found so far ([details](docs/self-improvement.md)):

- **Hints** that name whom to see and the question to ask: hints that lead to their clue rose from 57% to 87%.
- **Six general bugs**, found from the agents' own games and fixed, from hints that quoted the wrong question to
  sightings that broke an alibi without the case counting it.
- **Dead ends**: on the same recorded questions, turns that leave the player with nothing fell from 28% to 7%.
- **Changes it rejected**: two changes that looked like improvements made the game worse in paired play.

```sh
.venv/bin/python tools/playtest/run.py --batch e0-heldout --split heldout --parallel 9    # play
.venv/bin/python tools/playtest/score.py tools/playtest/runs/e0-heldout                   # scorecard
.venv/bin/python tools/playtest/judge.py tools/playtest/runs/e0-heldout                   # judged experience
.venv/bin/python tools/playtest/report.py tools/playtest/runs/e1-heldout --baseline tools/playtest/runs/e0-heldout
node tools/playtest/bugs.mjs --out bugs.json tools/playtest/runs/e*/                      # bug detectors
.venv/bin/python tools/playtest/correctness.py tools/playtest/runs/e0-heldout             # correctness judge
```

## Documentation

- [Technical report](dist/report/index.html) (edition 0.25; [continuous edition](dist/report/complete.html)): the
  connected argument, with diagrams; sources in [docs/report/](docs/report/index.md).
- [A worked example](dist/report/worked-example.html) ([source](docs/report/worked-example.md)): one case's records, and how the kernel, Z3 and the model critics reason over them, at design time and at run time.
- [Self-improvement by playtesting](docs/self-improvement.md): the method, the tools and every result.
- [The living village](docs/living-village.md): sightings, the morning director and the rules found by playing.
- [Mystery kernel](docs/mystery-kernel.md): the history's four record types, certification and refinement.
- [Character turns](docs/character-turns.md): how a free-text reply is proposed, checked and committed.
- [Architecture](docs/architecture.md) and [roadmap](docs/roadmap.md).
- [AGENTS.md](AGENTS.md): where things are and how to test them, for anyone (or any agent) changing the code.

## Code map

| Where | What |
| --- | --- |
| `dist/kernel.mjs`, `dist/engine.mjs`, `dist/engine-runtime.mjs` | Event log, replay, saves and action routing |
| `dist/mk/kernel.mjs`, `server/case_oracle.py` | The certifying kernel (reachability, elimination, depth) and the Z3 cross-check |
| `dist/cases/kernel-case.mjs`, `dist/cases/village.mjs` | A generated case in play (accounts, evidence, hints, the constable) and the village setting |
| `dist/character-turn.mjs` | Free-text conversation: the character's perspective, code checks, the fact-checker and fallbacks |
| `dist/morning.mjs`, `dist/morning-director.mjs` | The living morning and its director with code, model and kernel critics |
| `dist/ui.mjs`, `dist/styles.css` | The browser interface |
| `tools/refine-c/` | Case generation (`premise.py`, `refine.py`) and publishing (`publish.py`, `enrich.py`) |
| `tools/playtest/` | Agent playtesting, scoring, judging, experiments and the bug track |

## Tests and limits

```sh
npm test                                         # 281 JavaScript tests
.venv/bin/python -m pytest tests/ -q             # 25 Python tests
(cd tools/refine-c && ../../.venv/bin/python parity.py)   # the Python and JS kernels agree on 443 cases
npm run docs:check
```

The guarantees are about the records: solvability, a unique answer, depth, and that what characters say agrees with
the history as far as the critics can tell. The fact-checker is a model, so a reply can still slip through; hints and
difficulty are measured on agent players, not yet calibrated against people. Generating a case takes several minutes.
The local client, its saves and the inspector expose the hidden truth; the servers are for local use only.
