# A visible, living Bellweather: design note and implementation plan

Status: steps 1–5 implemented, September 2026 (see "As built" below); steps 6–8 proposed. Owner: game UI. Related: `docs/mystery-kernel.md`, `docs/architecture.md`,
`docs/art-direction.md`.

## As built (steps 1–5)

Playtesting reshaped the plan; this is the layout in the game now.

| Where | What |
|---|---|
| Top bar | case title; **Investigation · Clue Board · Inspector**; **⚖ Accuse**; the clock; a "Not saved" marker if saving fails; the menu |
| Left | the **village map** (pins with place art, paths with minutes on foot, who is where, a You marker; place states as symbols: **!** a lead points here, **?** something to examine, **✓** done) with a List view; **Look around**: what can be examined here, as rows with clue art (draggable into a conversation) |
| Middle | the **scene** (place art, name, atmosphere, description); then either **What now?** guidance and what has happened here since you arrived, or the **conversation** with the person you are talking to, full height: their portrait, trust and stress on the left, yours on the right; finds made during the conversation appear in it as boxed cards, and a reply recorded as evidence appears once, as its card |
| Right | **Talk** (faces of the people here; questions for the person you are talking to, scrollable; your own words below, Enter sends) · **Evidence** (newest first or by type, clue art, who each mentions; drag onto the conversation to show; a Show button while talking) · **Hints** |
| Clue Board | every villager with a profile (and the victim), the case against each suspect under Motive, Means and Opportunity with an honest ✓, conflicts between accounts, the night timeline from the case, and the full history |
| Opening | the case, the cast, where to start, how to investigate, and an optional tour of the layout |

Free-form dialogue is always available in the Talk panel; drag and drop is the way to show evidence (with a keyboard Show button). The detective has a painted portrait; clue art comes from a 30-object library matched by title (`dist/art.mjs`).

Known limits: touch screens have no drag and drop (Show buttons work) and no send button (Enter only); clue art matching is by keyword.

## Why

Generated cases are now fair (motive, means and opportunity, checked by two kernels and Z3), varied (the premise deck)
and deep. Most of what the engine knows is still shown as lists: where people are, what is in a room, what someone is
doing, what the player holds. The next step is to show the world rather than describe it. With one rich village and a
generator that varies victim, culprit, method, motive and shape, a strong visual layer is what turns each case into a
distinct place to be. It is the last large piece before the north star for this setting: endless, fair Bellweather
mysteries that look and feel alive.

## Principles

1. **Free-form dialogue is never dropped.** The player can always type anything to anyone who is present. Open-ended,
   model-voiced conversation, checked against the case records, is one of the game's unique aspects. Suggested
   questions, drag-to-show and menus are shortcuts beside the text box, never replacements for it. No design here
   reduces conversation to a fixed verb set; adventure verbs (take, use, combine) are not planned.
2. **Show only what the player could see.** Visuals never reveal hidden facts: no portrait, colour, badge or animation
   may depend on guilt, on a line being a lie, or on a clue the player has not found. Lies and concessions look the
   same as any other line.
3. **Everything visual is derived from engine state.** The map, scene, inventory and board read the session and the
   case tables (`caseTables(s)`); they never hold their own copy of the world. Art is decoration keyed by id, with a
   text fallback, and never affects what an action does.
4. **Generated cases are first-class.** Nothing may be hard-coded to the Last Bell (its times, its crime scene, its six
   people). The Last Bell keeps working unchanged.
5. **Accessible and calm.** Keyboard parity for every pointer action, reduced-motion support, readable contrast, and
   screen-reader labels. Motion is brief and purposeful.

## The plan

Each step ends in a working, tested state and a visual check (headless Chrome screenshots at 1440×900 and a narrow
width) shown to the user before the next step.

### Step 1: Reasoning board, made correct and general

The board already exists (suspect strip, corkboard columns, conflict strings, night timeline, evidence tray). Fix:

- **Timeline window from the case**, not the Last Bell's fixed 20:55–21:30: span the certified crime window with a
  margin, and the time of death if different.
- **Crime scene from the case** (`question.crime.place`), not `manor`, for the "at the scene" colouring.
- **Columns match Bell's questions:** Motive, Means, Opportunity (fold "Alibi" into Opportunity as whereabouts).
- **An honest check mark per column:** shown when the evidence the player holds really establishes that pillar for
  that suspect, using the same code Bell uses (`pillarSignsFor`, `caseStatus`). It uses only held evidence, so it
  spoils nothing; the player's own filing stays theirs.
- **Filing by one click on a column or by drag**, with the four small buttons kept for keyboard use.

Acceptance: every published case renders a correct timeline and scene; the check marks agree with Bell's verdict;
UI tests cover a generated case and the Last Bell.

### Step 2: The village map, the scene view, and object art

**Map.** An illustrated village map replaces the place list (the list stays available as a compact view). Places are
pins with their illustrations; paths are labelled with walking times; the player is a marker; people are small
portraits at their current place. Each place shows its state: things left to examine, a newly opened lead, or done.
Clicking a place walks there, with a short travel animation as the clock advances.

**Scene.** Arriving somewhere changes the centre view: the place illustration fills the top, the people present stand
in it as portraits (labelled, with what they are doing if known), and examinable objects appear as pinned cards around
the room. The chat and actions sit below. Hidden (not yet earned) objects never appear.

**Object art.** A library of about 25 illustrations for common clue types (letter, note, key, glove, slate, bottle,
footprint, ledger, watch, cloak, ticket, receipt, photograph, knife, tin, basin, lamp, rope, oar, book, diary, cuff
button, handkerchief, candle, bag), made with the existing art tool (`tools/art/generate.py`) in the approved style
and chosen from contact sheets. Each clue maps to an illustration by code (keywords in its title, then its kind); a
clue with no match gets its kind's icon. No per-case art generation.

Acceptance: every place in every published case is reachable from the map; people and objects shown equal the engine's
view; screenshots at wide and narrow widths.

### Step 3: Game-style dialogue

- Two-sided conversation: the other person's portrait and lines on the left, the detective's on the right, the place as
  a soft backdrop.
- A typing indicator while the character model is thinking; the existing fallback and rejection behaviour unchanged.
- **The free-text box is always present and first**; suggested questions appear as chips beneath it.
- Showing evidence from the conversation (drag a card onto the portrait, or pick from a list).
- Lies, concessions and fallbacks look identical to other lines (the audit remains in the inspector).

Acceptance: free-text turns work exactly as before (same pipeline, same checks); chips and drag produce the same
actions as the existing menu; UI tests for both.

### Step 4: Inventory panel

- The Evidence tab becomes an inventory: items grouped by type (documents, objects, traces, accounts, behaviour), or
  sorted by when they were found (a toggle), newest marked.
- Each item shows its art, where and when it was found, and who it mentions (tap a name to find them).
- **Drag an item onto a person** (in the scene or the conversation) to show it to them; keyboard alternative kept.

Acceptance: every held clue appears exactly once; drag-to-show dispatches the same `present` action as the menu.

### Step 5: Opening scene and tutorial

- A title card for the case: the victim's portrait greyed out, where they were found, the question.
- **Meet the cast:** an overlay of everyone in the case with portraits, roles and personalities from their public
  description and character sheet (never secrets, lies or culpability), and the victim.
- **Where to start:** Bell's opening words and one suggested first place.
- **How hints work:** one screen on the Hints tab and its three levels.
- **Optional tutorial:** a short, fixed click-through (examine something, ask someone, show a clue, type your own
  question, open the board), skippable and shown once.

Acceptance: a first-time player can start the first action within a minute; the tutorial never blocks play.

### Step 6: A living world in generated cases

Today generated cases keep everyone at one place (`life: null`) so the player can always find them. With the map
showing where everyone is, movement can return:

- A daily routine for each villager (all eleven), with activity labels ("repotting seedlings", "chalking the slate").
- NPCs move between places on their own; the map and scene show where they are and what they are doing.
- **Findability rule:** a person whose account the player has earned is always reachable (at a known place, or shown
  on the map); certification of playability covers this.
- Later, culprit reactions driven by the case's attitudes (hiding something, visiting a witness), checked the same way.

Acceptance: autoplay still solves every case with movement on; no earned account becomes unreachable.

### Step 7: Expressions

- Prototype first with one character (Ada: neutral, wary, relieved, annoyed), generated from the approved portrait with
  the art tool so the face stays the same; accept only if identity holds at thumbnail size.
- Expressions are driven only by what the player can see (the line's intent: evading, conceding, cooperating) plus the
  character's sheet and mood, never by hidden truth.
- Fallback if identity drifts: a mood word under the portrait and small overlays.

### Step 8 (optional): one or two more places or people

At most two more of each, with art and character sheets, extracted into the generator's setting as today.

## What does not change

- The engine, certification (both kernels and Z3), the premise deck and publishing.
- The character pipeline: perspective, validation, fact-checker, guards and fallbacks.
- Saves: visual state (map layout, board filing, tutorial seen) is stored beside the session, never inside it.

## Testing

- Unit and UI tests for each step, including one Last Bell and at least two generated cases.
- Visual checks: headless Chrome screenshots of the map, a scene, a conversation, the inventory, the board and the
  opening, at two widths, reviewed before moving on.
- A playtest by the user after steps 2, 3 and 5, with the logs read afterwards.
