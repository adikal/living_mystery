# Case difficulty

Every published case carries a difficulty level (easy, medium or hard) shown in the case menu as pips and a word
(●○○ Easy, ●●○ Medium, ●●● Hard; never colour alone). The level is computed from the certified case, never asked of a
model, so it is the same each time and follows the case's true history.

Code: `tools/refine-c/difficulty.py`. Model: `tools/refine-c/settings/difficulty.json`. Tests:
`tools/refine-c/test_difficulty.py`.

## Features

Each feature is read from the certifier's report (`refine.certify`), which already reasons over the true history:

| Feature | What it measures | Report source |
|---|---|---|
| `depth` | fewest deductions to a solution only the truth survives, including motive, means and opportunity | `max(solve_depth, mmo_depth)` |
| `lies_on_path` | false accounts the solution must see through (a clue on the solution defeats them) | `false_signs` ∩ defeated by `key` |
| `lies_other` | false accounts elsewhere in the case | the rest of `false_signs` |
| `herrings_aimed` | red herrings about the suspect the obvious reading points to | `herrings` about a `surface` suspect |
| `herrings_other` | other red herrings | the rest of `herrings` |
| `lenient_motives` | extra motives the accusation accepts (makes the case easier) | `len(answer.motives) - 1` |

Twists are not a separate feature: the generator gives every case one, so as a yes/no it separates nothing. Its cost
is what varies, and that is captured by `depth` (how long the obvious suspect takes to clear) and `lies_on_path`.

## Model

The model is data, so it can be replaced without code changes. Two kinds:

- **linear** (the current prior, set by hand): `score = bias + Σ weight × feature`, higher is harder.
  Weights: depth 1.0, lies on the path 1.5, other lies 0.5, aimed herrings 0.75, other herrings 0.25,
  lenient motives −0.5. Bands: easy < 6.5 ≤ medium < 8 ≤ hard.
- **logistic** (once fitted): the same weighted sum predicts P(clean solve); `score = 1 − P`. Bands: easy < 0.4 ≤
  medium < 0.7 ≤ hard.

A play is a **clean solve** when the case is solved with at most 3 hints and at most 1 wrong accusation (both in the
model file).

## Data and fitting

`difficulty.py plays` rebuilds plays from `logs/game.log`: a `case_start` up to the next start of a different case
(a reload resumes the same play), counting hints, wrong accusations and the outcome; plays with fewer than 10 actions are
ignored. `difficulty.py fit` fits an L2-regularised logistic regression (dependency-free gradient descent on
standardised features) once there are at least 30 plays, writes the fitted model with a new version, and
`difficulty.py rate` re-rates every published case and its index entry.

The prior's weights are a guess. Six plays exist today, all by one player, so a fit now would follow noise; more plays,
from more than one player, are the way to replace the guess. Plays by an AI player would give data faster but measure
what is hard for a model, not a person.

## Where it runs

- At publish (`publish.publish_live` and the shipped-case publish): `case['difficulty'] = difficulty.rate(case)`, and
  the index entry gets `{level, score}`.
- The case menu (`dist/ui.mjs`, `difficultyBadge`) reads the index entry and sorts by score.

## Generating to a difficulty

The difficulty is also an input. "Generate a new case" offers Easy, Medium and Hard; the request (`POST /jobs` with
`{"difficulty": "hard"}`) selects a profile from `targets` in the model file:

| Target | Easy | Medium | Hard |
|---|---|---|---|
| solve depth | 3 | 5 | 7 |
| innocents cleared no earlier than layer / truth clear from layer | 0 / 0 | 2 / 3 | 3 / 4 |
| innocents cleared on evidence of their own (`own`) | 0 | 2 | 2 |
| twist | no | yes | yes |
| red herrings (min–max) / aimed at the obvious suspect | 0–1 / 0 | 1–2 / 0 | 2–3 / 1 |
| step limit / time budget | 8 / 8 min | 16 / 15 min | 28 / 25 min |

The generator (`refine.run_case(..., profile=)`) explores until `difficulty.targets_met` returns nothing: the
structural minimums above, motive and means evidence, and a rating at least as hard as the target. An innocent is
cleared on evidence of their own when they are still ruled out once every sign pointing at the culprit is set aside
(`refine.cleared_alone`); a `clear` step gives one who is not an alibi or a witness
([generation-and-publishing.md](generation-and-publishing.md)). The scheduler
follows the profile (no twist step for Easy; herrings up to the profile's maximum, aimed first at the suspect the
obvious reading points to). Limits: the step limit, the profile's time budget (refinement stops and the case is
finished as it stands), and the server's hard stop (budget plus 12 minutes for the seed and publishing). Every case
still passes the same certification; the published case records its rating and its `target`, and the menu shows the
rating, so a Hard run that only reached Medium is labelled Medium.

## Tuning so far (October 2026)

Generated with `tools/refine-c/batch.py`: every case so far rated at its target (Easy 2.75–4.75, Medium 6.75–7.75, Hard
10.5–12.75). Easy no longer asks innocents to stay plausible or a lie to protect the culprit (a simple case has neither).
Hard overshoots the band (depth 7–8): playtests should tell whether Hard should stop earlier. A step may never lose
reachable motive or means evidence, and seed rounds repair the best draft with every rule broken so far.

## Next

- Fit the model on plays once there are enough (above), and adjust the targets if ratings and targets disagree.
