# Roadmap: finish The Last Bell before generating mysteries

## Direction

The long-term goal is a playable town with simulated characters and generated, investigable mysteries. First make The Last Bell a complete reference case: believable interactions, actionable memories, executable history, and explanations for every consequential event. Keep the deterministic engine as the regression oracle. No runtime LLM, ASP, or SMT integration is implemented yet.

## Current inspector iteration

- World is the default view, controlled by the bottom event slider.
- A location grid highlights the selected event's location and shows actual occupants and travel.
- Character perspectives show self position, archived movement sightings of others with timestamps and staleness labels, current beliefs, and recent belief changes with source links.
- One optional detail panel shows an event or character. Trace details and integrity checks remain separate views.
- A milestone strip exposes nearby recorded movement, speech, belief, evidence, and resolution events. Later milestones are explicitly labeled as later in the trace.
- A separate spoiler reveal shows unrecorded physical clues at visited places, unheard conversations, selected unused evidence follow-ups, and the moved folio. Reports use the replay cursor.

This is a read-only debugger, not a player hint system. Character perspectives are a partial observation projection: they do not infer sightings from mere co-location, decode narrative belief text into map positions, or model forgetting. Object knowledge remains in beliefs; only the actual-world view reveals the folio's physical position. The selected-event caption and optional trace details are omniscient debugger context, not character knowledge. The movement archive includes all past observations even when older memory IDs leave the 80-entry retained memory list.

## Development sequence

1. **Complete authored interactions.** Meaningful evidence/person responses, follow-up questions, contradictions, and changing cooperation. Most evidence combinations currently have a generic acknowledgement.
2. **Make memories actionable.** Questions about who was seen, where, when, and from what source. Preserve honest mistakes and stale testimony.
3. **Expand character decisions.** Competing obligations, relationships, self-protection, interrupted plans, and explanations for failures. Maintain bounded deterministic policies.
4. **Define shared action and assertion schemas.** Preconditions, effects, duration, resource use, observations, recipients, and claim semantics shared by execution and validation.
5. **Introduce symbolic validation incrementally.** Check individual action feasibility, temporal/spatial consistency, information provenance, and global investigative reachability. False testimony and inconsistent beliefs remain permitted; physical truth must remain coherent. Evaluate solver choice against concrete reference cases rather than adding a solver to every UI interaction.
6. **Introduce bounded LLM dialogue.** Interpret questions into supported intents and realize engine-approved assertions in character. Validate consequential claims, handle unsupported topics without inventing evidence, record model inputs/outputs, and retain a deterministic fallback. Saved replay must not require another model call.
7. **Execute the authored prehistory.** Run the crime, encounters, travel, and cover-up through action schemas instead of relying only on narrative background. Derive evidence from those events.
8. **Playtest and compare branches.** Reassurance versus threats, early versus late visits, failed plans, and alternative investigative routes. Add branch-from-command-boundary, trace comparison, and reference scenarios independent of the implementation.
9. **Generate controlled variations, then new cases.** Begin with schedules and evidence placement, later motives, methods, culprits, and relationships. Check both consistency and whether available evidence distinguishes plausible suspects.
10. **Add spatial play.** Explicit coordinates/routes and a top-down client, preserving the text adapter, public projection, and debugger contracts.

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
