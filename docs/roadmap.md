# Roadmap: finish The Last Bell before generating mysteries

## Direction

The long-term goal is a playable town with simulated characters and generated, investigable mysteries. First make The Last Bell a complete reference case: believable interactions, actionable memories, executable history, and explanations for every consequential event. Keep the deterministic engine as the regression oracle. Optional AI dialogue now generates free-form wording with deterministic anchor checks, a separate model critic, and a saved audit. It has no authority over world state; ASP and SMT are not implemented.

## Current inspector iteration

- World is the default view, controlled by the bottom event slider.
- A location grid highlights the selected event's location and shows actual occupants and travel.
- Character perspectives show self position, archived movement sightings of others with timestamps and staleness labels, current beliefs, and recent belief changes with source links.
- One optional detail panel shows an event or character. Trace details and integrity checks remain separate views.
- A milestone strip exposes nearby recorded movement, speech, belief, evidence, and resolution events. Later milestones are explicitly labeled as later in the trace.
- A separate spoiler reveal shows unrecorded physical clues at visited places, unheard conversations, selected unused evidence follow-ups, and the moved folio. Reports use the replay cursor.

This is a read-only debugger, not a player hint system. Character perspectives are a partial observation projection: they do not infer sightings from mere co-location, decode narrative belief text into map positions, or model forgetting. Object knowledge remains in beliefs; only the actual-world view reveals the folio's physical position. The selected-event caption and optional trace details are omniscient debugger context, not character knowledge. The movement archive includes all past observations even when older memory IDs leave the 80-entry retained memory list.

## Latest quality milestone: dialogue, claims, and knowledge-driven reactions

Implemented for The Last Bell:

- Evidence-gated follow-ups for source attribution, uncertain identification, documentary cross-examination, appointment motives, witness limits, and medical uncertainty.
- Silas retains a revised alibi after being challenged with the receipt; Clara may retract her cover story or refuse after a threat; Ada retains a clarified identification.
- Character-specific reactions to relevant evidence and explicit limits for evidence outside a witness's knowledge. Newly acquired testimony preserves the actual statement rather than an outdated stock summary.
- Typed attributed claims on evidence and selected speech, with subjects, predicates, values, inclusive case-night intervals, confidence, and source event IDs. Revised accounts supersede earlier claims without erasing them.
- A player-facing Claims notebook showing overlapping-location conflicts, incompatible death windows, and agreements with source links. Agreement is not automatically independent corroboration; planned meetings are not physical-presence evidence.
- Ada seeks Bell to correct an already-shared rumor. A cooperative Clara may report seeing Silas take the folio. Plans use beliefs and trust, travel to a real recipient, and record scored reasons and causal sources.
- Local observation of the folio retrieval; remote characters learn nothing. Sightings report the most recent retained occurrence of repeated movements.

The implementation is authored and bounded. It does not interpret arbitrary player dialogue, model general cognition, or formally prove consistency. Claim annotations cover selected case assertions, not every sentence. Old acquired evidence can be projected through the case catalog without mutating its save; old free-text speech is not retroactively parsed. Earlier stock testimony and source events remain historical records.

## Next development sequence

1. **Complete dialogue coverage and playtest the new branches.** Extend communicative plans, follow-up chains, refusals, interruptions, and evidence reactions based on observed stalls. Keep the engine responsible for disclosure and the LLM responsible for realization.
2. **Strengthen structured claims.** Add spatial rooms, clock-relative observations, uncertainty intervals, explicit retraction links, shared source ancestry, and structured assertion coverage of all consequential dialogue. Generalize the current presence/window comparisons.
3. **Expand knowledge-driven decisions.** Information seeking, conflicting testimony, mistaken expectations, interrupted plans, explicit perception and memory policies, and communication goals beyond this case's correction/report/warning situations.
4. **Symbolic causal and temporal validation.** Check action preconditions, travel feasibility, object possession, ordering, and knowledge provenance against the shared schema. Permit false beliefs and lies while keeping physical history coherent.
5. **Execute the authored prehistory.** Simulate meetings, crime, cover-up, and evidence creation, replacing background summaries with inspectable events.
6. **Improve deduction play.** Player-built timelines, claim comparison, targeted challenges, and explanations of how evidence supports a theory beyond the current accusation rubric.
7. **Evaluate and improve AI dialogue.** Build adversarial truthful/lying/uncertain reference sets; measure critic false acceptance and rejection, voice consistency, and latency. Support a separately configured critic model. Mocked orchestration tests are not model-quality evaluations.
8. **Check solvability and recovery.** Different investigative choices should retain viable routes. Distinguish optional clues, expired encounters, essential evidence, and believable recovery from damaged trust.
9. **Deepen the inspector and debrief.** Belief-evolution tracks, focused causal graphs, bookmarks, branch-from-command-boundary, run comparisons, and failed-plan explanations. Keep player hints separate from omniscient debugging.
10. **Build a spatial playable town.** Coordinates, route segments, visible journeys, routines, environmental interactions, and a top-down client; retain text play and debugging contracts.
11. **Controlled procedural generation.** Vary schedules/evidence placement first, then motives/methods/culprits/relationships, validating both physical consistency and investigative distinguishability.

## Test the latest case work

- Visit the vestry, ask Silas for his alibi, inspect the delivery register, then open Notebook → Claims. Use the new receipt challenge in Talk, and ask for his alibi again to check the retained revision.
- Acquire the surgery record, ask Clara about her alibi, then challenge it. Compare a cooperative approach with a threat; presenting the record privately offers a recovery path.
- Let Ada report to Bell, then show her the clock evidence at the inn. Wait and inspect her correction plan and the later conversation at the square. Bell should retain the old report until that encounter.
- Reassure Clara, expose the accounts to Silas, and follow his retrieval. Clara only reports it if she was present to see it and remains cooperative.
- Ask witnesses how they know, what they actually recognized, and what their evidence cannot establish. Ask Iris whether the examination identifies a specific weapon.

## More sophisticated inspector

- A meaningful-event timeline that compresses quiet intervals while retaining exact time and ordering; searchable bookmarks and event-density markers.
- Movement animation and route segments on a spatial town map, with reduced-motion support.
- Belief evolution tracks across time, confidence changes, retractions, and source chains distinguishing observation, testimony, inference, and deception.
- A focused causal graph on demand rather than a permanently visible graph of everything.
- Compare actual state, character understanding, and two branches without conflating them.
- Structured object-location knowledge, relationship changes, perception/forgetting policies, and explicit knowledge coverage for older saves.
- A richer missed-opportunity review: opportunities that genuinely expired, remaining routes, recovery paths, and optional versus necessary evidence. Current reports are authored heuristics, not a proof of fairness or a completion score.
- A spoiler-light player hint system separate from the omniscient inspector, and a post-case debrief tracing discoveries and missed encounters.
- Replay checkpoints, indexed event queries, and performance budgets for long histories.

## Manual acceptance pass for this iteration

1. Refresh, enter Inspector, and confirm World opens without a side panel.
2. Scrub from the start through several journeys; verify positions and travel change. Step through arrival/departure events sharing a minute.
3. Select Bell's perspective after leaving the square. The detective should remain a last-seen departure from the square, not appear at their current location elsewhere.
4. Select Clara, review beliefs, and follow a source. Close the detail panel and return to the live moment.
5. Reveal Missed opportunities after visiting the manor; inspect a clue in play and return. It should disappear from the live missed list but reappear when scrubbing before acquisition.
6. Check Trace details, character memories, milestone navigation, and Checks remain reachable.
7. Export/import, repeat the checks, and confirm play remains deterministic. Existing saves lack backfilled movement observations.

Do not commit or push this iteration until the user's test pass is complete.
