# A living village: what people saw, and a morning that moves

Two extensions of "the history is the only source of facts", built on the same principles: a model makes the
decisions and writes the words; critics (code, a model, and the certifying kernels) check every decision for logical
consistency, causal and temporal validity, and that at least one playable solution remains.

## 1. What people saw (written at publish, certified)

People in the history were in places with each other. That is fact, and it is what a witness naturally knows ("I saw
Hugo at the Rook about nine"). Until now a person could only say what generation happened to write as testimony, so
asked "did you see anyone?" most had nothing.

- **Candidates (code).** From every person's timeline in the true history (`refine.presence`), every pair of people at
  the same place at overlapping times, from the evening until the investigation starts (the crime itself excluded).
  Each candidate is a place claim about the person seen, backed by the speaker's own event (they were there).
- **Solve-neutral critic (code: both certifying kernels).** A sighting may not change the puzzle. Each candidate is added
  to the case as an account available from the start and the case is certified again: it is kept only if certification
  still passes and the solve depth, every thread's depth, the surface reading and the false accounts are all unchanged.
  So a sighting can never shortcut the solution or break it; sightings that would (the culprit near the scene in the
  window) are not given, because the history's own testimony and clues carry that weight.
- **Wording (model) and review (model).** A model writes each kept sighting in the speaker's voice, with the time spoken
  to the nearest five minutes; code rejects digits and names other than the person seen; the publish reviewer checks it
  against the true history like every other line. At most three per person, people of interest first.
- **In play.** "Did you see anyone last night?" gives them one at a time; free text can use them; the fact-checker
  counts them as the character's true accounts.

## 2. A morning that moves (decided in play, checked before it happens)

The village used to wait: everyone went home at eight and stayed. Now, as the investigation goes on, people go about
the morning and react to it: they go where they would go, seek each other out, pass on what they have heard, and a
person with something to hide may act on it.

### The director (model)

Every fifteen game minutes, and sooner (after five) when something has just happened that people would react to, one
model call plans the next half hour for everyone in the case (after a player action, never blocking it, only with AI
on). What counts as happening is read from the case, not from words: the detective showed someone a clue, found a clue
that concerns someone (its claim, subject, addressee or source), or someone conceded a story or admitted a secret. The
plan is told what triggered it, so the people concerned react first. It sees, per person: who they are, their true history (what they did last night and this
morning), what they want and fear, what they have told the detective, what they have seen the detective do or been shown,
and what they have heard from others today; plus the map and where everyone is now. Long context is the point: the
model reasons over the whole story at once.

For each person it returns zero to three steps:

- `go` to a place (by a time),
- `meet` someone, with what they say (one or two sentences) and the knowledge it rests on,
- `stay` somewhere until a time,
- `conceal` one clue that is theirs to hide (only for someone with a reason in their own attitudes).

Every step cites the knowledge it rests on, by id from that person's own knowledge list.

### The critics

1. **Code (epistemic, causal, temporal).** Ids, places and people exist; the victim does nothing; steps start after now,
   in order, within the half hour, with travel time between them; the constable keeps his post; every citation is from that
   person's own knowledge (a person cannot act on what they do not know); `conceal` only for a clue the person made or
   that is about them, not yet found, by someone whose attitudes give a reason, and never a clue that explains a red
   herring (hidden, it would leave an innocent looking guilty with nothing in the village to settle it). The doctor,
   like the constable, hides nothing unless she is a suspect.
2. **Model (what is said).** Each `meet` line is checked against the knowledge it cites: no new facts, nothing the
   speaker does not know; their own cover story may be repeated, never improved.
3. **Kernels (at least one playable solution).** A `conceal` is admitted only if the case still certifies without that
   clue (both kernels, with motive, means and opportunity): the player can still solve it, by another route.

A plan that fails a check is dropped (the person keeps to their scripted policy); one that passes is recorded as an
event, so a save replays it exactly.

### Execution (code, deterministic)

Steps run on the game clock like any travel: people leave and arrive with real walking times. A meeting happens only if
both are actually there and free (not talking to the detective); otherwise it is recorded as missed, never assumed. When
it happens, the listener remembers what they were told ("Ada told me …"), anyone present sees the two talking, and the
detective, if there, hears it. A concealment happens only if the person is at the clue and the detective has not taken
it; the clue is gone, and anyone present saw it happen (the detective too, if there).

What people heard becomes something they can say: "What have you heard this morning?" gives it, and the fact-checker
counts it as theirs.

## What stays true

Nothing here adds a fact about last night: sightings are read from the history and certified neutral, and everything in
the morning is something that happens in play, recorded as an event with its causes. Meetings and concealments are
causally grounded (cited knowledge), temporally valid (walking times, the clock, actual presence) and never leave the
case unsolvable.

## As built (October 2026)

- **Sightings**: `publish.add_sightings` (candidates `sighting_candidates`, critic `_solve_shape`), at most three per
  person, never from someone lying about their own night; worded with the person's pronoun, reviewed; "Did you see
  anyone last night?" (`seen`). Typically a third to a half of candidates are kept: the rest would shorten or change the
  solve (a doctor who stitched a suspect's hand would clear him at once), so the history's own clues carry them.
  `tools/refine-c/backfill.py sightings` adds them to published cases.
- **Engine**: `dist/morning.mjs` (knowledge, the code critic, install, the executor, news). Knowledge a person may *say*
  is what they told the detective, what the detective asked or showed them, what they heard or saw today, and what the
  village sees (whom the detective has questioned, where they searched); a meeting may cite **only** that. Concealment
  is of physical clues (documents, items, records, traces) that are theirs or about them, with a fear or intent cited;
  nobody hides something in front of the detective (they linger, visibly, and give up when the plan runs out). A clue that
  is gone disappears from the scene, the map, Bell's briefing, hints and leads, with everything reachable only through it.
- **Director**: `dist/morning-director.mjs` (`context`, `criticise`, `stillSolvable`, `directMorning`); scheduled in the
  UI after every committed action when AI is on: every fifteen game minutes, or after five when something significant
  happened (`morning.significant`: the detective shows someone a clue, finds one that concerns someone who can act
  other than its own speaker, or draws a concession). The code critic's reasons go back to the director once, so a
  fault is mended rather than only cut. A plan starts when it is made. The newest judgement wins: someone re-planned
  whose new steps all fail keeps nothing of the earlier plan. Going where one already is, or only staying put, is no
  plan. A finished agenda leaves the person where they are.
- **The map shows where people are** in generated cases (someone walking is shown at where they are going, marked
  with an arrow); the person card says "Now at …".
- **Questions**: an account whose own question rewords another is marked `same_as` the question that delivers it, so
  the menu never shows two questions asking the same thing. A target must deliver the account: the night question or
  "anything else" (`ALIAS_TOPICS`), or another account of the same speaker; an alias to the morning, sightings or news
  question, or to another speaker, is invalid and the account keeps its own button. Code aliases plain whereabouts
  questions ("Where were you last night, Mr Pike?": the core phrase with only forms of address and filler) and identical
  wording; a model judge (`publish.mark_duplicate_questions`, Sonnet) adds semantic rewordings, and when it is
  unavailable the earlier aliases are kept, still validated. The publish gate rejects missing, undeliverable or cyclic
  aliases; `backfill.py` and `repair_history.py` repair them network-free (`judge=False`) first. In play an aliased
  account comes out through the night question and "anything else", or, when a clue earns it, it is asked about that
  clue; play applies the same rule to cases published earlier. Rewriting the questions does not work (rewrites ask about
  something else or give the account away). The standard questions and these rules live in one place,
  `dist/cases/questions.mjs`; publishing reads them from there.
- **What people know of the detective is what they saw**: whom the detective questioned and where they searched is
  known to those who were there at the time (replayed from the event log, `morning.witnessed`); anyone else learns it
  only by being told. A person's stakes (their clues where the detective has been) use what they know, and the
  director is told people react only to what their own lists say.
- **The map shows the village moving**: someone walking is drawn on the path, as far along their quickest route as the
  walk has gone (the walk records when it began), and every face glides from where it was drawn to where it is now
  (skipped for reduced motion). Someone acting on a plan of their own (a step pending or under way) has a pulsing ring
  and a dot, with "acting on their own" in its label and the legend.
- **Pictures for every object clue**: 24 more objects in the library (`dist/art.mjs`, made with
  `tools/art/generate.py --auto`; a vision model picks among three candidates), and `backfill.py art` gives clues that
  had no fitting picture another look. Every object clue in the published cases now has a picture.
- **Everyone has an evening** (`publish.add_ordinary_evenings`, the generator's own rule `premise.evening_errors`): a
  case that leaves someone in it without an evening (older cases, the constable) gets an ordinary one from a model, one
  event and the intention behind it, naming nobody else, kept only if the solve is identical; their evening account
  follows. `backfill.py evenings`. Everyone with everyday facts also has a question for them, so nobody stands there with
  nothing to be asked. A character may ask the detective to be clearer once, never twice running (checked in code).
- **Bystanders remember what they saw the detective find** (`kernel.addEvidence`): a person present when the detective
  examines something (their own behaviour included) has it in their memories, so they do not later deny it. Spoken
  testimony is remembered by its speaker only.
- **The ending explains the red herrings from the history**: what each innocent did and the reason that made them.
- **Where people start**: where the history leaves them this morning (the place of their latest event since the
  morning began; someone seen behaving oddly, where they are seen; otherwise home). The detective arrives where the
  constable is, who hands over the case.
- **Concealment**: nobody hides anything in front of the detective or the constable (the code critic rejects it at
  the constable's post; at run time they wait, and a step that runs out is recorded as blocked by whoever stayed). A
  lingering line names the clue only if the detective can already see it. The rules:
  - *One projection.* Evidence the detective holds is a retained root. A held sign keeps its place (its requirements on
    a concealed sign are dropped), but a held sign that needs a concealed sign can no longer be read; unheld signs that
    require or need a concealed sign go with it. Certification (`projectAvailability`) and the engine's hints, menus and
    accounts (`Morning.unavailableSigns`) use the same projection, so they agree.
  - *Once.* Nobody may plan a clue already in another person's pending plan (re-planning one's own is allowed); of two
    plans for one clue in a round only the first is kept; a clue already gone when the person arrives is missed
    ("already gone").
  - *In time.* The clue must be reachable before the plan's deadline. Deadlines are absolute and fixed when planned;
    older saved steps get one from the round that made them.
  - *Refused for good* only when the case as it actually stands cannot spare the clue (remembered and kept out of the
    director's options from then on). A failure that depends on another person's still-pending concealment is cut for
    that round only.
- **Director failures** (transport, timeout, malformed output) change nothing and leave the round due; the browser
  backs off before trying again (30 s, doubling to 5 minutes, in memory only). The error audit keeps the critic's
  reasons a revision was mending.
- **Hints follow the solution**: toward the signs the kernel finds critical to clearing each suspect still standing
  and to keeping the truth (on the case as it now stands), and what leads to them; neutral accounts come last. A
  testimony hint names the question that actually leads to the account, found by trying it on a copy of the game (one
  question, two in a row, or one asked "more than once: they tell it a piece at a time"); when none does, it says to
  talk to the person again in their own words, and it never quotes a question the player has already finished.
- **No fixed person or place in the shared code**: the accusation goes to the case's `constable` (the setting's role)
  wherever they are; generated cases start at the constable's post; place names mid-sentence come from one helper
  (`dist/places.mjs`), which uses a place's own `called` phrase when the setting gives one.
- **Evening accounts** (`publish.add_surface_accounts`): the writer sees what the person tells the detective as soon
  as asked (`own_statements`), and a critic (`AGREES`) rejects an account that contradicts it (a liar keeps to their
  own lie); rewritten once with the reason, else dropped. `backfill.py surface` checks published cases.
- **Tested**: `tests/morning.test.mjs`, `tests/morning-director.test.mjs` (critics, execution, missed meetings,
  concealment in and out of sight, solving by the hints after a concealment), `tools/refine-c/test_sightings.py`, `test_surface.py`; and by
  playing three cases to a correct accusation with the real director (`tools/play.mjs`): culprits hid evidence, the kernel
  confirmed the cases stayed solvable, and they were.

Limits: the director is a model's judgement and often lets people carry on quietly; some plans repeat a missed meeting.
The line critic is a model too. What a person passes on is limited to what they may say, so news never carries a fact
about last night that the detective has not been given.
