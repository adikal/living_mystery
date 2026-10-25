# Generating and publishing a case

How a case goes from a premise to the menu, what each stage checks, and how to see where a run spends its time.
Generation is in `tools/refine-c/refine.py` (`run_case`), publishing in `tools/refine-c/publish.py`
(`publish_live`, `enrich_case`). The certifying kernel and the claim language are in
[mystery-kernel.md](mystery-kernel.md) and [claims.md](claims.md); difficulty targets in [difficulty.md](difficulty.md).

```
premise ─► seed: 6 drafts at once ─► steps: 3 drafts each, checked by code, then a critic
                                       │  a rejected draft is revised once in the same round
                                       │  passing drafts for different threads are applied together
                                       ▼
                          targets met ─► whole-case review (panel) ─► repair steps
                                       ▼
publishing: wording in two parallel waves ─► focused judges ─► review panel ─► wording repairs
                                       ▼
gates: Python kernel, JavaScript kernel and Z3 agree · review certificate · scripted players ─► menu
```

Three cases made this way (October 2026):

| Case | Level | Generation | Publishing |
|---|---|---|---|
| The Iron Hound | medium, depth 5 | 19 min | over 30 min, one call after another (before the waves) |
| The Last Train Waits | hard, depth 8 | 22.5 min | 13 min (judges at full effort) |
| A Glove in the Square | medium, depth 5 | 11 min | 6.5 min (judges at medium effort) |

Before this design a medium case took 40–80 minutes and often never reached its targets.

## Generation

**Seed.** `SEED_CANDIDATES` (6) drafts of the whole first case are written at once; the first that certifies wins.
When none does, the closest draft is repaired, with every rule broken so far listed. In the October runs the seed passed
in its first round, in about two minutes.

**Steps.** Code picks what the case lacks (`schedule`): a twist, a red herring, motive or means evidence, an innocent
cleared on evidence of their own, or a thread to deepen. `schedule_options` spreads the step over up to three options:
different targets on different threads for refinement, other innocents or operators for structural steps. Each option
gets a draft from Opus (`DRAFT_MODELS`; over the October runs Sonnet's drafts passed 3 of 41 times and Opus's 50 of
95). As each draft lands, code checks it: the patch applies, the case certifies, the setting and premise hold, and the
step laws hold. A draft that passes the code goes to the step critic at once, in parallel with drafts still being
written.

- **Revision in the round.** A draft rejected by code or by the critic is revised once, in the same round, with its
  own problems and its own patch (`revise`), if the round has at least `REVISE_MIN` (45) seconds left. Most rejections
  are one fixable slip, such as a reading that still names a place the step moved a clue from.
- **Grace and limits.** Once a draft passes, the others get half as long again as it took, at most 25 seconds; a round
  may take `ROUND_LIMIT` (150) seconds in all. A round that finds nothing gives each option its own feedback for a
  second round.
- **Stacking.** The winner is the passing draft that moves the case furthest. Each other passing draft for a different
  target is then applied on top of it, checked by code against the combined case and the current depth of its thread,
  and reviewed by the critic again; it is kept if it still passes and moves the case further (`stack`). A round often
  deepens two or three threads at once. Stacked drafts are recorded in the step's history with their story and review.

**Laws** (`step_laws`), checked by code on every draft: the answer is never reached sooner; an innocent's thread never
gets shallower; the twist and reachable motive and means evidence are kept; every step adds the event or attitude that
causes it; a refinement step makes some thread deeper; a clear step leaves its innocent ruled out without the evidence
against the culprit.

**Targets** (`difficulty.targets_met`) stop the loop: depth, how late innocents are cleared and the truth is clear,
twist, red herrings, motive and means, the rating, and the number of innocents cleared on evidence of their own
(`own`: 2 for medium and hard). `refine.cleared_alone` computes that last one: the innocents still ruled out once every
sign pointing at the culprit (culprit claims, and the signs certification counts as the culprit's motive and means,
with all that depends on them) is set aside. An innocent cleared only when the culprit is proven gives the player no
suspect to eliminate.

**Whole-case review.** With targets met, the review panel below reads the whole case. Its issues become a repair step
(up to `REVIEW_REPAIRS`, 2); a rejected repair ends the loop, since reviewing the same case again would only re-roll
the verdict.

## Publishing

Publishing adds only wording; the history and every claim stay as certified, and the gate checks that again.

**Waves.** Phases that do not depend on each other run at once, each on its own copy of the case, and their changes
are merged back (`parallel_phases`). Wave 1: evening and morning accounts, the doctor's findings, concessions,
everyday knowledge, moods, declines, sightings and the contradictions they make visible. Wave 2: honest-or-cover
labels, questions, reactions, show lines and pictures. Then shared opening lines, the line review
(`enrich.review_publish`) and the last pass over show lines. Chunked phases (reactions, show lines) send their chunks
in parallel (`in_parallel`).

**One record of what a person may say.** Every writer of a person's words is told the same things: who everyone is
and what the village knows (`village_brief`), what the person tells the detective as soon as asked (`first_tells`),
and what they admit only once a clue presses them (`kept_back`). Most publish-time contradictions found by reviewers
came from a writer that saw more or less than that: an evening account that gave away a locked admission, a reaction
that contradicted the public record.

**Writers and judges.** Writers run at low effort. Judges, whose job is to say whether a line contradicts, leaks or
misstates, run at their own effort inside the low-effort phases (`refine.FULL_EFFORT`; the wording model's judges at
medium, `JUDGE_EFFORT`): at low effort they passed what they should catch. Each judge answers one question:

| Judge | Asks |
|---|---|
| `AGREES` | does an evening account contradict what its speaker says, or who people are? |
| `LEAK` | does it give away something the speaker keeps back? |
| `SURFACE_TRUTH` | is a claimless account honest or a cover story (knowing who is who)? |
| `VISIBLE` | being at the same place, would one person really have seen the other? |
| `REACT_CHECK` | does a reaction or concession contradict what the person said, keeps back, everyone knows, how the clue was found or what it shows? |
| `LINES_AGREE`, `SAME` | do show lines say what their clue says; do two questions ask the same thing? |

A judge reply that judges none of its items is asked again once (`judge`); an item it leaves unjudged fails its check.
A line that fails is dropped (play has a fallback) or written again with the reason.

**Review panel.** The whole-case review is five narrow reviewers (`REVIEW_LENSES`: gates, facts, people, the player's
information, craft), each asked `REVIEW_VOTES` (2) times, all at once on the review model; every issue any of them
finds counts (`combine_reviews`). Each lens prompt is cut from `PUBLICATION_REVIEW_PROMPT` (`lens_prompt`), so the
checks are written once. On The Iron Hound with three of its original defects planted back, the panel found all three
in 34 seconds and one reviewer asked every question found two (`review_probe.py`). The generator's one-paragraph
summary of what really happened (`story`) is author-side and never shown in play, so reviewers do not see it. The
review certificate binds the exact case and records which reviewer ran (`reviewer`: the panel's lenses, votes and a
hash of every lens prompt).

**Repairs.** When the review fails, `repair_wording` repairs what publishing wrote: a named evening account is written
again with the reviewer's reason, a named morning account or sighting is dropped, named lines and reactions are dropped,
and a claimless account's honest-or-cover label is judged again. An issue is publishing's when it quotes the lines
publishing wrote or names them (a reaction, a show line, a concession). Anything else (a lock, a reading, the
structure) is not publishing's to change: the review stands and the case is not published. Up to `PUBLISH_REPAIRS` (3)
rounds.

**Gates** (strict publication): the Python kernel, the JavaScript kernel and Z3 certify the case and agree, every
account is backed, the review certificate is a PASS bound to this exact case, and the scripted players
(`tools/playtest/gate.mjs`) pass: a hint-following player solves the case, and following each testimony hint exactly
gives the account it points to. A candidate stopped only by the scripted players is kept in
`tools/refine-c/runs/scripted-rejected/` for diagnosis.

## Seeing progress and speed

Every model call is timed by phase and purpose (`tools/refine-c/timing.py`). A run writes `timings.md` and
`timings.json` into its directory after the seed, after every step and at the end: the phases with their start and wall
time, then the calls grouped by phase and purpose with count, median, 90th percentile, maximum, duplicates sent (and
won) and errors.

```sh
.venv/bin/python tools/refine-c/status.py                       # the newest run: milestones and timing table
.venv/bin/python tools/refine-c/status.py tools/refine-c/runs/live-<stamp>
```

**Duplicate slow calls.** A call still running past the 90th percentile of past calls of its kind (with room, at least
20 seconds) gets an identical second request, and the first reply wins (`refine._converse`). At most `LM_MAX_HEDGES`
(16) duplicates are in flight at once. Latencies are kept across runs in `tools/refine-c/runs/latency-history.json`;
duplicated calls are left out of it, and tests use a scratch copy (`tools/refine-c/conftest.py`). The audit ledger
records each request with the token budget and effort level actually sent, and whether a duplicate was sent.

## Tools

```sh
# a new case for a published case's premise and difficulty, published to dist/cases/generated/live/
.venv/bin/python tools/refine-c/regenerate.py <case.json> [--attempts N]
.venv/bin/python tools/refine-c/regenerate.py <case.json> --from-run tools/refine-c/runs/live-<stamp>   # publish a finished run
.venv/bin/python tools/refine-c/regenerate.py <case.json> --from-kept tools/refine-c/runs/scripted-rejected/<id>.json
.venv/bin/python tools/refine-c/repair_live.py <published.json> [--dry-run]   # bring a published case up to current checks
.venv/bin/python tools/refine-c/review_probe.py [--runs 2] [--mode panel|single|both]   # reviewer recall on planted defects
node tools/playtest/gate.mjs <case.json>                                       # the scripted players on one case
```

Run generation under `caffeinate -i` on a Mac: idle sleep stalls the model calls.

| Setting | Default | Effect |
|---|---|---|
| `LM_SEED_CANDIDATES` | 6 | seed drafts per round |
| `LM_DRAFT_MODELS` | Opus | models step drafts are spread over (comma-separated) |
| `LM_ROUND_LIMIT` | 150 | seconds a round of drafts may take |
| `LM_REVIEW_REPAIRS` | 2 | repair steps after a failed whole-case review at generation |
| `LM_REVIEW_PANEL`, `LM_REVIEW_VOTES` | 1, 2 | the panel (0: the single reviewer) and votes per lens |
| `LM_PUBLISH_REPAIRS` | 3 | review, repair, review rounds at publication |
| `LM_JUDGE_EFFORT` | medium | the wording model's effort for judges |
| `LM_HEDGE`, `LM_MAX_HEDGES` | 1, 16 | duplicate slow calls, and how many at once |
| `LM_SCRIPTED_GATE` | 1 | the scripted-player gate in strict publication |
| `LM_REGEN_TIME_FACTOR` | 1 | scales the profile's time budget in `regenerate.py` |
| `LM_LATENCY_HISTORY` | `runs/latency-history.json` | where call latencies are kept |

## What the measurements taught

- **One question per judge.** A judge asked several things at once (contradiction, kinship, leaks) missed a blatant
  leak at full effort; asked only about the leak, the same model caught it in 5 seconds at low effort.
- **Prevent by construction, then review.** The review model flags an issue in one run and passes it in the next, so
  the shared record, the focused judges and the scripted players stop what they can before the review sees the case.
- **Rules read the structure.** Lies written during generation carry no `deceptive` label until publishing
  writes one, so rules such as "a liar volunteers no sightings" read certification's false accounts.
- **A place is a whole building.** Two people at the inn at once need not have met: a lodger in her room is not seen
  from the bar. Sightings go through the `VISIBLE` judge.
- **Watch the slow tail.** Waiting the full grace after a pass cost about 25 seconds a step, and one serial whole-case
  review took over five minutes; the timing tables found both.
