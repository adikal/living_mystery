# Autonomous NPC lives

The configured and generated Bellweather cases now combine ordinary lives with mystery-specific modules. The original Last Bell retains its legacy policies. All six NPCs in the configured cases have persistent responsibilities, energy, completed tasks, retry state and social goals. Scripted policies use these without any service; the existing AI setting optionally enables bounded life deliberation.

## Try it

1. Refresh and choose a configured or generated case. Existing configured saves initialize life state on import without rewriting their history.
2. Leave AI off and wait for several 30-minute intervals. NPCs work, run errands, rest, deliver invitations and keep or miss appointments. Time advances only when you act; there is no wall-clock background simulation.
3. Open Inspector, select Ada and view Profile → Daily life. Read her goals, energy, current activity, commitments and retry state. Follow source links and inspect the scored decision events. Scrub back to compare earlier states.
4. Talk to someone during an activity. Their work pauses while the conversation lasts, other NPCs continue, and their activity resumes after release. An appointment can expire if you keep someone occupied.
5. Enable the existing AI character setting with the model proxy running. A player turn can additionally request one NPC's next goal sequence. Inspector decision events retain the private context, selection or fallback reason. With the proxy unavailable, ordinary scripted life continues.
6. Export during work or travel, import, and resume. Accepted plans and commitments replay without new model requests.

## State and responsibilities

`bellweather-life.mjs` declares public responsibilities and personal interests independently of culprit assignment. Ada serves customers and arranges produce deliveries; Rowan tends plants and visits the inn; Iris attends patients and arranges a welfare visit; Clara handles correspondence and seeks a consultation; Silas handles paperwork and seeks an administrative meeting; Bell attends village reports. Bell's public square commitment remains enforced.

`life.mjs` owns event-based life state under each NPC: energy and its reference time, goals, completed tasks, current timed activity, retry counts, next decision opportunity and the last model opportunity. Shared invitations live in `flags.lifeRequests`, with offered, accepted, declined, expired and completed states. Every change is a kernel event, and historical inspection reads only the selected prefix.

Energy declines with simulated time and activity; rest restores it. Policy scores combine urgency of duties, elapsed time, fatigue and social obligations. Accepted appointments constrain admissible plans before scoring. These are explicit game mechanics, not psychological estimates. Work and errands currently have timed completion records, not a detailed inventory, finance or production economy.

## Planning and execution

Relevant opportunities include periodic decision checkpoints, arrival, changed knowledge and completed or failed plans. A busy NPC retains its current plan; information can prompt reconsideration at the next available decision. Mystery modules retain priority when selecting a new plan. This is not unrestricted interruption of ongoing work.

Life choices compile into the shared `move` and new `activity` contracts. Activities require an authorized task, the correct location and an exact permitted duration. Time and location frames use the existing solver-neutral IR; a meeting also carries its deadline. Execution retains the pending plan until the timed activity completes. Conversation engagement pauses/resumes remaining activity time explicitly.

The optional model selects one to three distinct current goal IDs. Ordinary work, rest and errands can compose into a longer sequence. Social goals must stand alone because arrival, consent and availability determine their outcome. The complete composition is rechecked against plan horizon and accepted commitments. Execution checks actual conditions again. A capability preview is not permanent permission.

## Lives intersect through real encounters

An NPC seeks a partner using actual local perception, their own recorded sightings, or a public workplace as an uncertain expectation. They do not receive the partner's current remote location. If the partner is absent, the NPC waits for a bounded interval; failure produces a recorded reason and increasing retry delay, capped at sixty simulated minutes.

An invitation exists only after co-located speech. The requester waits for an answer until expiry. The recipient travels if necessary and accepts or declines in person, based on energy and conflicting commitments. Acceptance records a mutually known place and time window; appointments involving Bell use the square. The scheduler reserves travel time, and ordinary or mystery plans cannot override an accepted appointment simply by having a higher utility score.

Participants must both arrive and begin the meeting before it can be fulfilled. A meeting consumes six simulated minutes and can pause for player conversation. Missing the window records expiry; it never fabricates successful contact or a completed promise. Invitations are not case evidence, and private commitment records are not exposed through the player's notebook.

## Optional model boundary and cost

`autonomy-turn.mjs` prepares a separate perspective for one NPC: their goals, energy, own beliefs, retained memories, delivered commitments and available choices. It excludes other NPCs' private state and the hidden solution specification. The response is a closed JSON goal selection with a short private rationale. No generated dialogue, arbitrary actions or world patches are executed, so prose criticism is not the admission mechanism for these decisions.

The browser makes at most one additional life request per player turn, with an eight-second timeout and a twenty-simulated-minute cooldown for the selected NPC, including failed requests. Eligible NPCs rotate by their oldest model opportunity. The model uses the existing local character proxy; no second setting or new service is required. This request budget is in addition to the existing character-conversation budget.

A malformed, unauthorized, stale or infeasible selection cannot apply. Failure records a private audit and leaves goal selection to the scripted policy. Cancellation discards the whole pending player turn. Both the model and scripted policies use the same plan/commitment machinery; model selection additionally receives the configured-world investigation admission check. No model calls occur during engine replay or generation validation.

## World Director and limits

Configured public dispatches still require an engine-replayed acquisition witness. Optional Z3 verifies the recorded short-plan constraints independently. A busy town can generate more than twelve queries in a wait, so the client sends sequential batches of at most twelve under one total timeout and commits only after every batch passes. Turns exceeding 96 queries remain unresolved and require a shorter action. The service's per-request limit is unchanged.

This does not establish general semantic correctness, arbitrary future-agent robustness or an economy-wide invariant. Investigation admission retains its finite evidence-acquisition domain. Social preferences, task durations and knowledge hooks are authored. Failed appointments are permitted because the supported solution does not rely on these optional social meetings. The model chooses bounded actions; it does not invent new responsibilities or rewrite the mystery.

## Regression evidence and next extensions

Tests cover unattended days, all six NPCs, save continuation, exact timed activities, conversation pauses, actual meeting sources, retry delays, compositional appointment conflicts, invalid tasks, private perspective boundaries, stale/cancelled/failed model requests, actual Z3 feasibility and contradiction, bounded solver batches and solution witnesses after varied generated-case schedules. Mock model tests establish orchestration, not real-provider quality.

Next extend ordinary tasks with shared inventories and resource accounting; make personal relationships evolve through these encounters; allow conditionally generated goals and richer information-seeking plans; and validate wider module combinations and contingent evidence access before granting more freedom. Keep measured model-quality evaluation separate from deterministic regression tests.
