# 11. Self-improvement by playtesting

Status: **Experimental.** Built in `tools/playtest/` and run for four epochs in October 2026, with a separate bug track. The optimizer is an assistant session and the author approves every change; nothing is automated end to end yet.

## 11.1 Why playtesting can be automated here

Most self-improvement loops lack ground truth. This one has a good deal: the kernel knows the truth and the solution path, every event has a cause, and the scorecard can be computed from the event log rather than guessed. What it cannot compute (whether a game is fun, fair-feeling or confusing) is judged by a separate model against rubrics and is treated as weaker evidence.

![Figure 12. One epoch of the loop. Agent players play; the trace is scored and judged; the optimizer explains a cause, registers a prediction and proposes a narrow change; the change is tested offline and then played on held-out cases against the same games before it; the gate keeps or reverts it.](figures/playtest-loop.svg)

## 11.2 Components

| Component | File | What it does |
| --- | --- | --- |
| Text interface | `game.mjs` | The game as a player sees it: places, people, things, questions, inventory and map, with opaque per-game handles (`t3`, `q7`, `e2`), never record ids. The real character pipeline and the morning director run as in the browser. A private trace records, per step, what the scorer needs. |
| Player agents | `player.py`, `profiles.json` | `claude-sonnet-4-5` at temperature 0.8, a fresh context per game, a profile (beginner, amateur, pro: reading, asking, hint use, patience 20/40/80 actions) and a temperament; an in-character diary and an end-of-game questionnaire. |
| Runner | `run.py` | Batches in parallel; `--plan-from` replays the exact episodes of an earlier batch (case, profile, temperament, seed) for a paired comparison. Budget: 100 actions or 8 game hours. |
| Scorecard | `score.py` | Solved and correct, actions, hints, hints that helped (something learned within 5 actions), longest stall, loops, character fallbacks, declines, questions to the same person after a decline, rejected replies, refused actions, exceptions; problem records with their layer. |
| Judge | `judge.py` | `claude-sonnet-5`: seven dimensions (challenge, frustration, confusion, character quality, fairness, liveliness, fun), each cited to the transcript; problems with layer and severity. |
| Report | `report.py` | Per profile and case; problem clusters weighted by episodes × severity × profiles; paired differences with bootstrap 90% intervals. |
| Offline replay | `replay.mjs` | Puts the same recorded free-text questions to two versions of the dialogue pipeline, without playing whole games. |
| Ledger | `ledger.jsonl` | For each change: hypothesis, mechanism, prediction, refutation, then the result and the decision; for each bug, how it was found, its cause and its fix. |
| Bug detectors | `bugs.mjs` | Invariants of the game checked against the case as played, over every recorded game, ranked by severity. |
| Correctness judge | `correctness.py` | A model reads the full transcript, the game's internals per turn and the true records, and lists only breaches of the game's rules. |

## 11.3 The method

Each epoch is one turn of the scientific method: observe (cluster problems and read their transcripts), explain (state a mechanism and check it in the data), predict (write the expected effect, side effects and refuting result to the ledger before running), design narrowly (a general rule, no case words or ids, the history the only source of facts), test cheaply (tests, parity, offline replay), experiment (held-out cases paired with the baseline, at least two seeds, one change per arm), and conclude (keep, revert, or explain anew). The gate requires all tests, generality, an improvement on the targeted metric, and no regression on the guardrails: correctness of characters, fairness, bugs and solvability.

## 11.4 Results

Training and held-out splits each have three cases (one easy, one medium, one hard) and three profiles; epoch 0 and 1 used one seed (9 games per split), epoch 2 two seeds (18 games per arm).

| Epoch | Change | Result on held-out cases | Decision |
| --- | --- | --- | --- |
| 0 | baseline | 10% of character turns ended in one stock line, the same for every character; level-1 hints that named no one helped 26% of the time | — |
| 1 | in-voice declines and a rule against unbacked promises, together | stock line 67 → 4, but solved −44 points (−67 to −22) and rejected replies +23 per game | rejected |
| 2A | declines alone | rejected replies per turn back to the baseline (0.58): the promise rule had contradicted an existing prompt rule; players pressed the same person more after an in-voice decline (+0.72 of the next 5 actions, 0.28 to 1.11) | superseded |
| 2B | the account the model chose, given as written, before declining; declines that close the subject | turns ending in a decline 8.4% → 6.7%; pressing −0.39 (−0.94 to 0.14) | kept |
| 2C | hints that name whom at level 1 and the exact question at level 2 | hints that helped +35 points (19 to 53); judged fun +0.5 (0.1 to 0.9) | accepted |

Against the baseline, the three kept changes raise hints that helped from 57% to 87% with no guardrail lower beyond noise; judged liveliness is 0.33 lower (−0.67 to −0.06), which is open.

Epoch 3 used three held-out cases no agent had played and three seeds (27 pairs per arm). The author's fixes (arm A) raised judged fairness by 0.41 (0 to 0.85) but also declines; hints that name the action that works (arm C) removed a fault a scripted player hit in 13 of 36 hints yet changed nothing in agent play; a plain "nothing to tell" (arm D) made players press harder again and was rejected.

## 11.5 The bug track

Tuning found few bugs; the author found five in two plays. A separate track checks every recorded game: invariant detectors in code, a correctness judge that sees the true records, and an investigation step that reproduces each top finding before it counts. A bug fix needs a reproducing test and a general fix, not a measured effect.

| Bug | Found by | Fix |
| --- | --- | --- |
| A followed hint does not give its clue | detectors (13 games); scripted follower (13 of 36 hints) | the hint names the action that gives the account |
| An accusation refused although held evidence breaks the alibi | detectors (5 games); static scan (4 pairs in 3 cases) | a contradiction law in both kernels |
| A character cannot name the innkeeper or the doctor | detectors (8 instances) | every form of a place counts; the setting's roles are always in play |
| A time already given is refused | correctness judge (5 games) | times compared by the time they name |
| An account misstates kinship | correctness judge | accounts written and checked knowing who everyone is |
| The same words three times | detectors | such a reply is refused |

Of the five bugs found by hand, the agents' data contained two.

## 11.6 Dead ends and blocked replies

The same 120 recorded questions put to three versions of the game:

| Measure | Before the loop | After epoch 2 | Now |
| --- | --- | --- | --- |
| Turns that leave the player with nothing | 28% | 9% | 7% |
| Rejected attempts per question | 1.32 | 1.24 | 1.18 |
| Replies written freely by the model | 72% | 75% | 74% |

Dead ends fell by 22 points (−28 to −15); the other two changes are within noise. Most remaining refusals are the fact-checker refusing a fact no account gives, which keeps characters from solving the case early.

## 11.7 Threats to validity

- **Power.** With 18 pairs only large effects on solve rate and judged scores can be seen (a 10-point change in solve rate needs about 100 pairs). Per-turn and per-hint rates are the measurable primary metrics.
- **Players and judge are models.** Neither is yet calibrated against human play; the judge is close to the players' model. Reactions such as pressing after a decline may be properties of the agents.
- **Many comparisons.** About 20 metrics per comparison at 90% intervals: one or two apparent effects per comparison are expected by chance.
- **Reused held-out cases** become training cases over epochs; fresh ones are needed.
- **The offline replay is approximate**: it rebuilds each state without the director, so people stay where the history left them.
