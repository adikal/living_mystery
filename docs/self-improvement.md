# Playtesting itself: a self-improvement loop for the game

Status: **milestones 1–5 built, plus a bug track** (October 2026): the text interface, player agents, scorecard, judge
and report are in `tools/playtest/`, with invariant detectors (`bugs.mjs`) and a correctness judge (`correctness.py`)
for bugs. Epochs 0–3 have been played (ledger: `tools/playtest/ledger.jsonl`); results in section 12.

```
.venv/bin/python tools/playtest/run.py --batch e0-train --split train      # play (cases in tools/playtest/cases.json)
.venv/bin/python tools/playtest/score.py tools/playtest/runs/e0-train      # objective scorecard and problem records
.venv/bin/python tools/playtest/judge.py tools/playtest/runs/e0-train      # judged scores and problems
.venv/bin/python tools/playtest/report.py tools/playtest/runs/e1-heldout --baseline tools/playtest/runs/e0-heldout \
    --comparison-registration <registration.json>                          # paired comparison (audit must pass)
.venv/bin/python tools/playtest/run.py --batch e1-heldout --plan-from e0-heldout \
    --comparison-registration <registration.json> --registered-arm B       # the same episodes after a change
node tools/playtest/replay.mjs --root <checkout> --sample 80 tools/playtest/runs/e1-*/*__*.json   # offline check
node tools/playtest/replay.mjs --targets turns.json ...                    # re-ask given turns ([{file, step}])
node tools/playtest/replay.mjs --endpoint http://127.0.0.1:8797/ --timeout 300000 --parallel 1 ...   # another proxy
.venv/bin/python tools/playtest/replay_judge.py /tmp/replay-A.json        # independent judge of accepted replies
.venv/bin/python tools/playtest/replay_compare.py /tmp/replay-A.json /tmp/replay-B.json   # paired comparison
node tools/playtest/bugs.mjs --out bugs.json tools/playtest/runs/e*/      # bug detectors, ranked by severity
.venv/bin/python tools/playtest/correctness.py tools/playtest/runs/<batch>   # correctness judge
```

Models: players `claude-sonnet-4-5`, judge `claude-sonnet-5`, characters through the game's proxy, the optimizer an
assistant session. Budget per episode: 100 actions or 8 game hours. Epoch 0: 3 training and 3 held-out cases × 3 profiles,
one seed (18 episodes, about 30 minutes in parallel).

The game is improved today by a person (or an assistant) playing a case, noticing what goes wrong, and fixing the
general cause. This note makes that loop systematic: many agent players with fresh contexts and player profiles play
cases through a text interface; their trajectories are scored; an optimizer agent with access to the code reads the
batch and proposes general changes; a gate keeps only changes that improve held-out play without breaking anything;
and the loop runs for K epochs. The same playthroughs also improve the offline generator, not only the runtime.

It follows the principle used everywhere else in the system: a model proposes, critics decide. Here the proposer is the
optimizer, and the critics are the test suite, a generality check and measured play on held-out cases.

## 1. Why this can work here

Most self-improvement loops lack ground truth. This one has a good deal of it:

- **The certifier knows the solution**, the signs each step needs (`criticalSigns`), and what the player still lacks at
  any point (`caseStatus`, `hints`). "Was the player stuck?" and "did the hint help?" are measurable.
- **The event log records everything**: every action, reply, rejected attempt, fallback, director round, concealment.
  A trajectory costs nothing extra.
- **The game is text.** It can be played without the browser (`tools/play.mjs` already does this), so an episode is
  fast and cheap compared with a visual game.

## 2. Roles and data flow

```
  cases (training / held-out)          personas (beginner / amateur / pro, with variants)
            │                                        │
            └──────────────► player agents ◄─────────┘      fresh context; sees only the text interface
                                   │  actions
                                   ▼
                        game (text interface, real character AI, director)
                                   │  event log + player diary + questionnaire
                                   ▼
                        scorecard: objective metrics (code)  +  judged metrics (judge model)
                                   │  batch of trajectories and scores
                                   ▼
                        optimizer agent (code access, design principles)
                                   │  proposed changes, each with evidence and a test
                                   ▼
                        gate: tests · generality · held-out play · guardrails
                                   │  accepted changes
                                   ▼
                        next epoch  (ledger: issue → change → measured effect)
```

| Role | Model | Sees | Does not see |
|---|---|---|---|
| Player | a mid-size model, temperature for variety | the text interface only | case files, code, logs, the solution |
| Judge | a different model from the player | the trajectory, diary and questionnaire; the solution | the code |
| Optimizer | the strongest model | everything: code, scorecards, trajectories, design notes | — |
| Human | the author | a scorecard summary per epoch; plays one case per epoch | — |

## 3. The text interface (the player's whole world)

A JSON line protocol, one step at a time, so any agent runtime can drive it.

**Observation** (after every action):

```json
{"time": "Day 2 · 09:12", "place": "Vale Manor", "description": "...",
 "people_here": [{"id": "edmund", "name": "Edmund Vale", "role": "...", "manner": "...", "acting": false}],
 "things_here": [{"id": "s_pad", "label": "The hall telephone pad"}],
 "questions": {"edmund": [["night", "What is your account of last night?"], ["s_call", "..."]]},
 "inventory": [{"id": "s_phone_note", "title": "A scrap in the study grate"}],
 "map": [{"place": "The post office", "minutes": 6, "people": ["Dorothy Pruett"], "marks": ["things to examine"]}],
 "transcript": ["Edmund Vale: “Private business ...”", "..."],
 "status": "playing"}
```

It contains exactly what the browser shows a player: no record ids beyond the handles needed to act, no certifier
output, no solution. A test checks that no observation contains a truth value, a hidden sign, or text from a locked lead.

**Actions:** `move`, `examine`, `ask` (a menu question), `say` (free text to a person here), `show` (a clue to a
person), `wait`, `hint` (asks for the next hint level, as the in-game hint does), `accuse` (suspect, method, motive,
evidence), `notes` (the player's own note, kept for the diary), `quit`.

**Budget per episode:** a cap in actions (default 120) and in game hours (default 8); exceeding either ends the episode
as unsolved, recorded as such.

Implementation: a `tools/playtest/` package. `game.mjs` wraps the engine exactly as `tools/play.mjs` does today (real
character pipeline and the morning director), exposes `observe()` and `act(action)`, and writes the episode's event log.

## 4. Player profiles

Profiles are behavioural instructions plus parameters, not labels. Each has variants (temperament) for diversity.

| | Beginner | Amateur | Pro |
|---|---|---|---|
| Experience | has never played an adventure game | some detective or puzzle games | many; knows the genre's tricks |
| Reading | skims; often misses a detail in a long passage | reads most things | reads everything; keeps notes |
| Questions | mostly menu buttons; plain free text when stuck | mixes both | pointed free text, confronts with evidence |
| Hints | asks early and follows literally | after about 10 actions without progress | only after about 25, or never |
| Patience | gives up after about 20 actions without progress | about 40 | about 80 |
| Accusation | early, on a hunch | when it feels right | only when every other suspect is ruled out |

Temperament variants: methodical, chatty, impatient, suspicious, and literal-minded.

**Calibration against people.** LLM players are more patient and more literal than people. Profiles are calibrated
against real play: the author's logs in `logs/game.log` (and any other human plays) give hint timing, how often free
text is used, how long people stay stuck before asking, and where they give up. A profile is acceptable when its
distribution of these quantities on a calibration set falls within the human range. This is re-checked every few
epochs so the profiles do not drift.

## 5. The scorecard

Objective metrics are computed by code from the event log and the certifier; judged metrics come from the judge model
reading the trajectory, the player's in-character diary and a fixed end-of-game questionnaire. The player never grades
its own episode.

| Dimension | Objective (code) | Judged |
|---|---|---|
| Outcome | solved; correct; wrong accusations; actions and game minutes to solve | — |
| Challenge | solve depth reached without hints; how far the evidence had narrowed before the first hint | too easy / right / too hard |
| Frustration | stalls (actions with no new evidence or understanding); loops (the same question or move repeated); back-and-forth walks | moments of being stuck, with what was happening |
| Confusion | fallback and neutral replies; replies rejected by the critics; clues never understood (`needs` unmet) at the end | lines that did not make sense, with quotes |
| Correctness of characters | contradictions with a character's own accounts (judge on the transcript, checked against the history) | believability and distinct voices |
| Fairness | was the accepted solution deducible from what the player held; did a hint ever endorse a false account | did the answer feel earned |
| Liveliness | director actions the player witnessed per game hour; meetings and concealments seen | did the village feel alive |
| Fun | pacing: new understanding over time (a steady rise with surprises, not a flat line or a cliff) | short questionnaire adapted from standard player-experience scales |
| Bugs | engine diagnostics failures; Python/JS/Z3 disagreements; errors; impossible states | anything that seemed broken, with evidence |
| Cost | model calls and tokens per episode; latency per turn | — |

Each judged item has a written rubric and anchored examples, and is scored on a fixed scale with a short reason.

**Problem records.** Besides scores, every episode yields problem records: `{episode, minute, kind, evidence (event ids
and quotes), layer}`. `layer` is where it originates, found from provenance in the event log: generation (the case's
records), publishing (wording), runtime dialogue, runtime director, hints, interface. The optimizer works from these.

## 6. The optimizer

Input: the batch's problem records, scorecards and trajectories; the code; the design notes and AGENTS.md (the
principles: general rules only, no word matching, no fixed ids, the history is the only source of facts, free dialogue is
never dropped).

Each epoch is one turn of the scientific method. A change is an experiment, and its write-up is fixed before the
result is known.

1. **Observe.** Cluster problem records across the batch; rank clusters by frequency × severity × number of profiles
   affected. Read the transcripts of the top clusters, not only the counts.
2. **Explain.** For each top cluster, state a cause: a mechanism in the code or the case data, not a symptom. "Players
   found the stock line repetitive" is a symptom; "characters cannot answer follow-ups the history does not cover" is a
   cause. Check the cause against the data before proposing anything (for example: do the failing hints name a person?
   do declines lead to more questions to the same person?). Drop a cluster whose cause the data does not support.
3. **Predict.** For each change, write in the ledger (`tools/playtest/ledger.jsonl`), before running it: the
   hypothesis, the mechanism, the metrics it should move and by roughly how much, the side effects it could have
   (including how players will react: a characterful decline invites pressing), and the result that would refute it.
   The target metric must measure the goal (turns that leave the player with nothing), not a proxy for it (how many
   stock lines there are).
4. **Design narrowly.** Prefer a mechanical change with a clear scope over a broad prompt rule. A rule that widens
   what the critics reject is the riskiest kind of change: read the whole prompt for rules it contradicts, and give
   examples of what stays allowed. Keep to the principles: general rules, no case words or ids, the history the only
   source of facts, free dialogue never dropped.
5. **Test cheaply first.** Unit tests that fail before and pass after; then the offline replay
   (`tools/playtest/replay.mjs`), which puts the same recorded questions to the old and the new pipeline. A change
   that fails offline does not go to play.
6. **Experiment.** Play held-out cases paired with the baseline (same cases, profiles, temperaments, seeds;
   `run.py --plan-from` with a comparison registration), with at least two seeds. Changes are applied cumulatively, one per arm (A, A+B, A+B+C), so
   each is compared with the arm before it; two changes are never measured only together.
7. **Conclude.** Compare the result with the prediction. Keep a change that meets its prediction and passes the gate;
   revert one that does not, and record why, so a later epoch does not propose it again in another form. A result that
   contradicts the stated mechanism is itself a finding: write down the new explanation and test it next.

Changes are limited per epoch (default 3–5) so their effects can be told apart.

**Epoch 1, as an example of what this guards against.** Two changes were measured together, and the target was a
proxy. The stock line disappeared, as intended, but turns ending in a refusal rose from 9.9% to 13.1%, players pressed
the same person more after an in-voice decline (1.99 against 1.53 of the next five actions), and the solve rate on
held-out cases fell 44 points. The second change, a rule against promises, contradicted an existing prompt rule ("say
who might"). Neither side effect was predicted, and an offline replay would have shown the rise in rejections before
any play.

## 7. The gate

A change is accepted only if all of these hold:

1. **Tests:** every existing test, harness and the parity check pass, plus the change's own new test.
2. **Generality:** no case ids, person ids, place ids or case-specific words in the change (a code check, plus a
   review against the principles).
3. **Held-out play improves:** on held-out cases and seeds, paired with the same cases, profiles and seeds before the
   change, the targeted metrics improve with a confidence interval that excludes zero.
4. **Guardrails do not regress:** correctness of characters, fairness, bugs and solvability are non-negotiable; cost may
   rise only within a set budget.

Rejected changes are reverted and recorded with the reason, so the next epoch does not propose them again.

## 8. Epochs, data and statistics

- **Splits.** Training cases (the optimizer may look at them), held-out cases (only their scores are reported), and a
  held-out profile variant. Each epoch also adds freshly generated cases, so no fix can depend on a fixed set.
- **Batch size.** About 3 seeds × 3 profiles × 6 training cases per epoch (54 episodes), and the same on held-out cases
  for the gate. Paired comparisons (same case, profile and seed) cut the noise of LLM players.
- **Ledger.** `tools/playtest/ledger.jsonl`: each issue cluster, the change, the gate's measurements, and the decision.
  The report and the paper draw on it.
- **Stopping.** When held-out scores plateau for two epochs, or no proposed change passes the gate.
- **Human anchor.** Each epoch the author plays one case; if the human experience and the agents' scorecard disagree,
  the profiles are re-calibrated before the next epoch.

## 9. Improving the generator as well as the runtime

Problem records whose layer is generation or publishing point at the offline loop:

| What players experienced | What to improve |
|---|---|
| solved too quickly; too easy | refinement targets and the scheduler; the anti-shortcut laws |
| saw through the twist at once, or never suspected the obvious suspect | how misdirection is built (strength of the surface reading and of the lie) |
| ignored a red herring, or met a dead end that felt unfair | herring construction and its innocent explanation |
| did not see why a lead opened | how unlock reasons are written |
| a clue made no sense | publish wording and its checks |
| every case felt the same | the premise deck and diversity across a batch |

Two further uses:

- **Fitting difficulty.** `docs/difficulty.md` keeps the rating as data so a later fit can replace it. Playthroughs give
  the data to fit it (solve rate, time, hints and wrong accusations per profile), so "Hard" means hard for players.
- **Curation.** Generate several candidates per premise, have agents play them, and publish the best.

Runtime and generator changes run in separate epochs (or are measured separately), so their effects are not confused.
Generator epochs are slower (7–20 minutes per case to generate) and are judged on freshly generated cases only.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Overfitting fixes to the cases they were found on | held-out cases and profiles; fresh cases each epoch; the gate |
| Players unlike people (too patient, too literal) | calibration against human play; a human anchor each epoch |
| Gaming the metrics (the optimizer pleasing the judge) | objective metrics first; judge different from player; guardrails; human anchor |
| Spoilers reaching the player | the interface is the only channel; an automated test on observations |
| Noise | paired comparisons; enough seeds; confidence intervals |
| Cost | a cheaper player model; caps per episode; parallel episodes; a budget per epoch |
| A change that helps one profile and hurts another | per-profile reporting; the gate requires no regression on any profile's guardrails |

## 11. Implementation plan

Each milestone has an acceptance test. Status as of 4 October 2026 in the last column.

| # | Milestone | Work | Done when | Status |
|---|---|---|---|---|
| 1 | Text interface | `tools/playtest/game.mjs`: `observe()`/`act()`, budgets, episode log; a no-spoiler test on observations; a scripted player that solves a case through it | a hint-following script solves 3 cases through the interface; the no-spoiler test passes | done |
| 2 | Player agents | `tools/playtest/player.mjs`: a player agent with a fresh context per episode (the language-model proxy, a player profile, the diary and questionnaire); three profiles with variants; an episode runner with parallelism | 9 episodes (3 cases × 3 profiles) complete and are logged; no episode reads anything outside the interface | done (`player.py`, Python) |
| 3 | Objective scorecard | `tools/playtest/score.mjs`: every objective metric of section 5 from the event log and the certifier; problem records with their layer | on the 9 episodes, the scorecard flags the problems found by hand in October 2026 (a character with no options; duplicate questions; hints going in circles; stonewalling) | done (`score.py`) |
| 4 | Calibration and judged scorecard | profile calibration against the author's logs; the judge with rubrics; per-profile reports | profile statistics fall in the human range; judged scores agree with the author on 2 cases | judge done; calibration against the author open |
| 5 | One manual epoch | 54 training and 54 held-out episodes; the optimizer (an assistant session) proposes changes from the batch; the gate is applied by hand | at least one accepted change with a measured held-out gain and no guardrail regression; the ledger records it | done: epochs 0–2 (18 episodes per split, not 54; see section 12) |
| 6 | Automated loop | `tools/playtest/epoch.py`: run batch → score → optimizer → gate → ledger, for K epochs, with a budget and a stop rule; human approval of each accepted change by default | 3 epochs run unattended; held-out scores reported per epoch | open |
| 7 | Generator epochs | generation-layer problem records drive generator changes, judged on fresh cases; difficulty refit from play data | one generator change accepted; the refit difficulty model predicts solve time better than the prior on held-out cases | open |

Decisions taken (October 2026): players `claude-sonnet-4-5` (temperature 0.8), judge `claude-sonnet-5`, optimizer an
assistant session; 100 actions or 8 game hours per episode; guardrails are correctness of characters, fairness, bugs and
solvability; the author approves every change.

## 12. Results so far

Held-out cases: Death at the Post Office (hard), Sealing Wax and Steel (medium), Cocoa in the Vestry (easy); 3
profiles; training cases are three others. Intervals are bootstrap 90% intervals of the paired difference.

| Epoch | Change (cumulative arm) | Prediction | Result on held-out cases | Decision |
|---|---|---|---|---|
| 0 | none (baseline) | — | solved 0.78–1.0 by profile; 10% of character turns end in the stock line | — |
| 1 | in-voice declines + a rule against unbacked promises, together (1 seed) | fewer stock-line replies, fewer stalls | stock line 67 → 4, but solved −44 points (−67 to −22), rejected replies +23 per game, frustration +1.3 | rejected; promise rule reverted |
| 2A | declines alone (2 seeds) | back to baseline | rejections per turn back to 0.58 (promise rule was the cause); players pressed the same person more after a decline (+0.72 of next 5 actions, 0.28 to 1.11) | superseded by 2B |
| 2B | A + the chosen account given as written + declines that close the subject | declines down a third, less pressing | turns ending in a decline 8.4% → 6.7%; pressing −0.39 (−0.94 to 0.14) | kept (no metric differs from baseline beyond noise) |
| 2C | B + hints that name whom, then the question | more hints help | hints that helped +35 points (19 to 53), fun +0.5 (0.1 to 0.9); against baseline 57% → 87% | accepted |
| 3 (fresh held-out cases, 3 seeds, 27 pairs) | A: fixes from the author's play (briefing, contradiction law, guarded third attempt only after a fact-checker rejection, line critic sees private knowledge) | first evidence sooner; fewer refused accusations | fairness +0.41 [0, +0.85]; declines +1.15 per game [+0.33, +2.0] | kept as fixes |
| 3 | C: hints name the action that gives the account (scripted check: 13 of 36 hints were wrong) | more hints help | no change (0.00) | kept as a fix |
| 3 | D: a plain "nothing to tell" third attempt after code checks | fewer declines | declines −0.56 (n.s.); pressing after a decline +0.75 [+0.20, +1.38] | rejected |

### The bug track

Tuning experiments found few bugs, while the author found five in two plays. The signals were often in the agents'
data, but players read anomalies as clues, the judge saw only the first 9,000 characters and was asked about the
experience, and clustering by frequency buried single serious faults. The bug track is separate from tuning: a fix needs
a test that reproduces the fault, a general fix, all tests and parity, and a sweep of all cases, but no measured
effect. It runs over games already recorded:

1. **Detectors** (`bugs.mjs`): invariants checked against the case as it was played: an accusation refused while the
   held evidence contains an unrecorded contradiction; a hint followed that does not give its clue; every attempt
   refused by the name check; the same words three times; a hint shown three times without its clue; a static scan
   for contradictions between reachable accounts. Ranked by severity, then by games.
2. **Correctness judge** (`correctness.py`): a model reads the full transcript, the game's internals at each turn and
   the true records, and lists only breaches of eight written rules of the game.
3. **Investigation**: each top finding is reproduced (`replay.mjs --targets`), traced to its cause and confirmed against
   the records; many of the judge's 382 raw findings did not survive.

Six general bugs found this way in 156 games and fixed: hints that quoted the wrong question; sightings that broke an
alibi without the case counting it; a name check that did not know "the Rook" or that the examiner is known to all;
spoken times compared by spelling; evening accounts that misstated kinship; the same words three times. Of the five bugs
the author found by hand, the agents' data contained two.

### Dead ends and blocked replies

The same 120 recorded questions put to three versions: turns that leave the player with nothing 28% (before the loop)
→ 9% (after epoch 2) → 7% (now), a difference of −22 points [−28, −15]; rejected attempts per question 1.32 → 1.18
(−11%, not significant); replies written freely by the model 72% → 74% (no change). On 106 turns the correctness judge
called unfair refusals, re-asking them after the fixes changed nothing: most are the fact-checker refusing a fact no
account gives, which is what keeps characters from solving the case early.

### A local open-weight model for the characters and the fact-checker

Gemma 4 26B (a mixture of experts with 4B active parameters, run by Ollama 0.40 on an M3 Pro with 36 GB) replaced Claude
Sonnet 4.5 as both the character and its fact-checker; everything else stayed on Bedrock. The same 120 recorded
questions (`--sample 120 --seed 11` over `e3-base` and `e3a-train`) were put to both, and an independent judge
(`replay_judge.py`, Claude Sonnet 5) read every accepted reply with the character's accounts and the village's
who-is-who, and listed each fact the accounts do not give.

The first run found two faults in the game, not in the model, both fixed and general: the character prompt did not say
that the spoken words go inside the one JSON object (Gemma wrote them after it, and 150 attempts failed the shape
check, whose reason now names the missing and unexpected fields); and the verdict parser refused a bare
`{"verdict":"pass"}`, so every reply Gemma's checker passed was thrown away. After the fixes:

| On 120 questions | Sonnet 4.5 (Bedrock) | Gemma 4 26B (local) | Qwen3.6 35B (local) |
|---|---|---|---|
| Free replies written by the model | 76% | 95% | 94% |
| Dead ends | 8% | 4% | 1% |
| Refused attempts per question | 1.23 | 0.33 | 0.46 |
| Replies refused by the fact-checker | 100 of 191 checked | **0 of 115** | **7 of 120** |
| Malformed replies (retried) | 0 | 16 | 4 |
| Accepted replies the judge found a fact in | 53% | 46% | 65% |
| Accepted replies the judge found a contradiction in | 11% (10) | 16% (18) | 15% (17) |
| Seconds per call: character / checker (median) | 5.3 / 3.4 | 9.1 / 5.2 | 8.8 / 5.4 |
| Seconds per turn, median / 90th percentile | 16.4 / 29.4 | 15.7 / 35.7 | 14.8 / 33.2 |

The difference is the fact-checker. Gemma's checker passed every reply put to it (115 checks), where Sonnet refused about half, so its
higher rate of free replies is the absence of a check, not better replies: the replies it accepted contradict the
accounts more often (the solicitor claiming the vicar's study; the constable denying words the detective quotes back
to him). Gemma as the character is close to Sonnet: the judge finds slightly fewer added facts per reply (0.63 against
0.88), its replies are about twice as slow per call, and about one attempt in ten is malformed and asked again. Turn
times are similar here only because Gemma's turns are rarely refused; the Bedrock times are for six questions at a
time, and the Mac slept three times during the night run (once for a thermal emergency), so 8 questions were re-asked.
A second Bedrock run differed from the first by 3 points in free replies and 4 in dead ends, which is the noise between
runs. Qwen3.6 35B (a mixture of experts with about 3B active parameters, 23 GB) was then run the same way. Its checker refused
7 of 120 replies, against Sonnet's 100 of 191, so it is lenient too, if less so than Gemma's; as the character it adds
more facts than either (1.00 per accepted reply, against 0.88 for Sonnet and 0.63 for Gemma), with fewer malformed
replies than Gemma (4 against 16). Neither local model is yet a fact-checker the game can rely on. The next step is a
local character with Sonnet as the fact-checker (`LM_ROUTES=character=ollama:gemma4:26b`).

Open after epoch 2: judged liveliness 0.33 lower than baseline (−0.67 to −0.06); rejected replies per turn 0.65 against
0.59 (not significant). Neither the players nor the judge has yet been calibrated against human play; with 18 pairs, only
per-turn and per-hint rates have the power to show modest effects (a 10-point change in solve rate needs about 100
pairs).
