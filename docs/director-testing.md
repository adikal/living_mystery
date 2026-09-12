# Testing the first World Director slice

This feature works in scripted mode. Leave the AI character checkbox off.

## Setup

Use a Python 3 installation with SSL support (the solver integration is tested with Python 3.12):

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r server/requirements-solver.txt
.venv/bin/python server/director_server.py
```

The solver service listens on `http://127.0.0.1:8788`, independently of the Bedrock service on port 8787. It needs no credentials and makes no LLM calls. The pinned Z3 package is MIT-licensed. Serve the game on localhost:8000 as before. Other game origins can be configured with `LM_ALLOWED_ORIGINS` (exact comma-separated origins). Do not publish this local development service.

Refresh the game, open the menu, choose **World Director**, and enable Z3 turn checks. A pending check has a Cancel button. If a required check is unavailable or unresolved, the candidate turn is deferred; disable Z3 to continue ordinary authored play. Local typed-plan checks remain active in either setting. Old saves remain readable; older events are not backfilled with audits.

## Ada: knowledge, travel and a real conversation

1. Start a new case and wait 60 minutes at the square so Ada has passed her original account to Bell.
2. Visit the inn, inspect the clock, and present it to Ada.
3. End the conversation. Her correction plan should appear in the inspector with travel and communicate steps.
4. Wait a few minutes. Bell learns the correction only when Ada reaches him and speaks. Inspect the source event of his updated belief.
5. In Trace details, inspect the character's **World Director: allow** decision and the turn's **World Director: Z3 verified** event. The future meeting is explicitly conditional; it is not proof that Bell must remain at the square.

## Silas: possession and a remaining investigation route

1. Start a new case. Visit the manor and inspect the estate accounts.
2. Visit the vestry and present the ledger to Silas.
3. End the conversation; wait long enough for his manor trip and return (30 minutes suffices in the reference scenario).
4. Follow Director decisions: travel to the manor, take the folio, return to the vestry and store it in the drawer. Inspect source-linked constraints and Z3 results.
5. The verified turn includes an investigation witness: actual commands replayed on a copy that reach a supported accusation. Concealing the folio can leave the physical-evidence route viable. The witness is omniscient inspector data, not a player hint or evidence grant.

## Failure and replay checks

- Stop the solver and trigger a directed plan with Z3 enabled: no candidate world effects should commit. A deferred/unresolved audit explains why.
- Cancel while pending or restart: late results cannot overwrite the current session.
- Export/import and scrub the timeline: accepted decisions, solver results and character outcomes replay without model or solver calls.
- Turn Z3 off: the same authored plans and both existing solution routes remain playable with local checks.

Automated fixtures additionally check impossible travel, storage without possession, missing source knowledge, absent recipients, unsupported expressions, invalid witnesses, stale history and unresolved route search. There is no player-facing way to teleport NPCs or destroy all clues merely for testing.

## Automated checks

```sh
npm test
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

The Director integration tests require the local `.venv` with Z3 installed and invoke the real solver without HTTP or AWS. They compare constraint results with local evaluation and replay route witnesses through the engine. Existing JavaScript tests require Node 20 or newer. These are not real-LLM quality tests or browser layout tests.

The original plan fixtures cover two authored plan families; investigation validation now searches acquisition actions and replays candidate witnesses. It does not yet implement unrestricted AI physical plans, general symbolic route search, general recovery scheduling, ASP or Lean. Seeded structural sampling is implemented separately in `casegen.mjs`. No witness found within the bounded candidate search means unresolved, not a proven dead end.


## Original-case AI-selected plans and dependency revisions

1. Refresh the game and enable AI characters. Optionally enable World Director
   for independent Z3 checks (the local action checks always run).
2. At the square, ask Bell: “Please look around the inn after we finish talking.”
   A cooperative accepted reply can select `survey:inn`. The model may also
   decline; inspect its decision audit to distinguish those outcomes.
3. Bell should stay until you end the conversation or leave. After release,
   inspect his pending plan, travel, arrival observation and completed decision.
   He knows only what was visible when he arrived. Export during travel and
   import again: the plan continues without asking the model again.
4. Repeat the existing Ada clock-correction scenario in scripted mode. Her
   corrected sighting now records explicit premises; completion retires the
   pending correction through the generic knowledge API. Bell's received account
   stays attributed. Scrubbing backward still shows the original beliefs.
5. Automated `tests/agent-plans.test.mjs` exercises the same queue without an LLM,
   recipient departure, changed message sources, gifts/concealment, witness
   locality, inference dependency chains, cycles, and save/load. Director tests
   additionally compare the new action constraints with real Z3.

The conversation model chooses among offered plans and cannot invent physical verbs. In configured/generated cases, a separate optional activity-selection request and deterministic life replanning are implemented; the original-case examples above retain their legacy scheduling. Real-model willingness, wording and critic quality require manual
playtesting beyond the mocked model tests.

## Configured mysteries, no AI or solver service required

See [configuration testing](case-configurations.md). The three new configurations preserve a bounded acquisition witness at the public dispatch boundary even with the optional Director toggle disabled. Tests cover optional clue loss, intermediate loss restored by turn end, a deadline crossed by waiting, unavailable weapon transfers, save isolation and contradictory prehistory. Z3 still independently checks represented short plans; it does not perform the acquisition search. The original case retains its prior optional admission behavior.


## Autonomous life implementation

Configured/generated cases now support persistent ordinary goals, timed activities, delivered social requests, accepted commitments and replanning. `life.mjs` drives scripted policies through shared move/activity constraints; `autonomy-turn.mjs` adds isolated optional model selection of bounded goal sequences. The original case retains its legacy policies. Z3 verification batches up to twelve queries per request under the existing atomic turn boundary. See [the complete implementation and test guide](autonomous-lives.md) for state, budgets, assumptions and limitations.

## Shared forensic milestone

New configured/generated cases now use typed source support, registered live belief rules, a shared crime/explanation IR, and a finite competing-explanation accusation grader. Generation varies `trace`, `cleanup` and `clockwork` structures and independently replays every declared route. Optional Z3 verifies recorded history and excludes competing explanations; local non-AI play uses the same finite rules. The original case retains its legacy rubric. See [the forensic model and testing contract](forensic-model.md) for exact scope, commands and limits.
