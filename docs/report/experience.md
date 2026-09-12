# 8. Player experience, inspection and visual identity

**Status: implemented text-first interface; richer spatial play and evaluation are proposed.**

## 8.1 Two audiences for the same history

The player needs actionable, limited information. The author or developer needs enough context to diagnose the whole simulation. Living Mystery serves these audiences through different projections, rather than making an omniscient debugger the normal game interface.

The investigation view shows current surroundings, locally available people, discovered evidence and observed history. Supported dialogue options are explicit in scripted mode. Completed options are visually marked but remain clickable because repeated questions may matter after new evidence. Scene transitions receive distinct treatment, and the recent transcript remains bounded while the complete observed history is preserved separately.

The People notebook exposes public profiles and local trust/stress metrics. Private values and relationships to other characters remain outside that projection. Trust and stress are game state variables, not measured psychological attributes. Their presentation is a design choice whose effect on player inference should be tested.

## 8.2 World-first debugging

The inspector reconstructs the world at an event cursor. The world view and bottom timeline form the main surface; selecting an event or character opens contextual detail. A character perspective uses that person's recorded sightings and beliefs instead of substituting the actual locations of everyone else.

The timeline is event-index based. Events sharing a minute remain distinguishable, and trace details follow the selected cursor. Memory lists and claim histories answer different questions: what a character currently retains, what occurred at all, and what assertion was superseded. Filtering must not turn a partial view into a claim of complete knowledge.

A good diagnostic interaction should answer: What changed? Who observed it? What did they infer? What action did it enable? Which check rejected the next step? The existing event and audit surfaces expose much of this data, but focused causal graphs, branch comparison and better belief-evolution visualization remain proposed improvements.

## 8.3 Missed opportunities are not a score

The spoiler-revealed missed-opportunity view reports selected unacquired clues, recorded but unheard speech, authored follow-ups and moving-folio information. It uses the replay prefix rather than future discoveries. These are useful review aids, not an exhaustive measure of fairness or a claim that every missed event was necessary.

An unheard conversation may be permanently in the past. A clue can remain available by another route. A future player hint system should distinguish expired optional content, current possibilities and actual blockers without exposing private truth. The omniscient debrief and spoiler-light assistance should remain separate products.

## 8.4 Art is a presentation layer

Portraits, locations and selected artifacts use a shared illustration family keyed by stable entity IDs. Labels, evidence availability and interaction state remain in code. Missing images should not remove a clue or change a fact. Art must not inadvertently reveal a hidden identity, weapon or relationship before the corresponding knowledge is acquired.

For procedural cases, visual consistency becomes part of the case-production contract. The proposed pipeline uses public appearance descriptions, style references, a reusable asset library, cache lookup, bounded generation and revision budgets, and usage records. Today's packaged assets are reused without runtime image calls; automated cross-case generation, cache accounting and spend enforcement are not yet implemented.

## 8.5 Toward a spatial town

A top-down, Stardew Valley–like playable town is a long-term interface direction. Movement animation should eventually reflect actual route segments and elapsed time, while text commands remain available for tests and accessibility. Spatial presentation will require stronger perception rules than current scene co-location. Visibility, audibility, room boundaries and travel interruption should enter the shared model before animation implies those mechanics exist.

## 8.5 Current forensic and life interactions

The case menu exposes explicit cleanup and clock-dependent generation choices, alongside general sampling and authored configurations. A new investigation replaces the active local save, so export remains available before selection. AI-off play uses the same finite case reasoning.

Bell names only selected acquired records and distinguishes supported, ambiguous, contradicted and internally inconsistent bundles. Partial feedback identifies unresolved dimensions and the kind of corroboration needed; it does not reveal undiscovered clue locations. The Reasoning board remains player-organized rather than automatically placing evidence from hidden truth.

The character inspector's Daily life view follows the selected history prefix: activities, energy, goals, accepted commitments, completion and retries change with the timeline. Private goals and social requests do not appear in the regular player projection. Pending model-selection and solver indicators represent unfinished transactions; cancellation cannot leave a hidden background action committed.
