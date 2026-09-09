# Character turns

The optional browser character mode combines response selection and natural dialogue for all six Last Bell characters. Enable character reasoning in **AI characters** after restarting `python3 server/llm_proxy.py`. Existing saves work; the setting remains a local preference. No credentials enter the browser.

## Authority and flow

1. Prepare an immutable turn ticket from the current session. Supply only the speaker's own beliefs (without omniscient truth labels), personality, goals, relationships, mood, last 18 retained memories, last 12 direct speech entries and persistent conversation state.
2. Compile currently legal authored accounts on isolated session copies. An explicit question/evidence button offers its corresponding account; free text offers available topics and follow-ups. Source IDs and claim keys are capabilities, not generated references. Preview consequences exclude unrelated NPC activity.
3. Generate one structured proposal: `intent`, `account`, `utterance`, `claims`, `sources`, `trust`, `belief`, `engagement`, optional `plan`, and a short `rationale`. The rationale is an inspectable decision explanation, not private chain-of-thought. With no account, the character may clarify, challenge, refuse or state an intention from the selected plan without asserting new past or present case facts.
4. Check exact fields, enums, account availability, claim/source equality, numeric tokens and size bounds. A separate-context critic checks relevance, continuity, disclosure, factual equivalence, permitted deception, belief stance and explicit endings. A strict pass with no violations is required. Critic verdicts accept plain JSON or one enclosing JSON/unlabelled code fence; surrounding prose and multiple objects are rejected. The critic is instructed to return only that JSON object — no code fence and no text before or after — so a verdict followed by explanatory commentary is treated as ambiguous and refused rather than parsed. The critic checks clearly unrelated answers and unexplained contradictions while allowing supported revisions, indirect replies, deliberate deflection and permitted lies. Both calls currently use the same configured model.
5. Execute the accepted proposal on a fresh session copy through the existing case actions. Validate replay/world integrity, then atomically commit. With World Director enabled, the browser retains an outer candidate copy until applicable Z3 and investigation-witness checks finish. A changed session invalidates the ticket. Cancellation commits nothing; restarting/importing invalidates pending replies. The world does not advance while waiting for the model.

The model chooses a permitted account and its delivery, or a non-disclosure response, and may select a bounded physical-plan capability. It cannot invent new case facts, submit patches, invent arbitrary physical actions or rewrite past events. Permitted lies remain lies; private beliefs are not automatically permitted disclosures. Existing case rules gate evidence, relationships and story consequences. Diagnostics are integrity checks, not a formal proof of semantic correctness or global solvability.

## Persistent character state

Player speech becomes an explicitly unverified memory. A character may remember an assertion without endorsing it, tentatively accept it (confidence 0.6), or doubt it (0.2). These create attributed `player_report_*` beliefs with unknown truth, linked to the player's speech. They never overwrite canonical case beliefs. The latest 12 report beliefs remain active; history is preserved. Questions should use `remember_only`, checked by the critic.

A turn records its intent, selected account, exact accepted words, sources, bounded trust change (at most ±0.03 beyond authored case effects), dialogue-state progression and optional explicit ending. Conversation state retains prior disclosures and the latest topic, question and event links. The full perspective/proposal/validation audit lives on the decision event. Speech records the authored reference separately; acquired testimony uses the accepted words.

Saved event history replays without a model call. Fresh AI runs can differ. Audits are debugging records, not authenticated evidence against local save editing. The omniscient inspector and exported saves contain private information by design.

## Budgets and failures

A turn has at most two generation and two critic requests, within one 30-second client deadline. Input is limited to 1,200 characters; prompts to 32,000; model responses to 12,000. Generation requests cap output at 1,200 tokens and critic requests at 700. The proxy's separate `character-v1` profile bounds the request body to 128,000 bytes and output allowance to 1,500 tokens. Oversized contexts fail into authored fallback rather than silently removing constraints.

Failed explicit buttons retain their authored answer and case consequences. Failed free-text turns ask for a specific supported question rather than guessing an evidence presentation, accusation or threat. The generation prompt also directs a clean in-character decline (no account, intent clarify or refuse) for any question outside the character's perspective and accounts, so an out-of-scope question yields a graceful passing non-answer instead of speculation the critic must reject — a general mechanism, not per-character refusals. Cancelled replies have no effects. These bounds control request volume; they do not measure actual provider spend. General memory retrieval, separate critic models and empirical quality evaluations remain roadmap work.

## Manual test guide

- Restart the proxy, refresh the game, enable character reasoning, and talk to a local character. Try both free text and a question button.
- Ask Silas about his alibi, acquire the delivery register, then challenge the contradiction. Ask again: his revised account should persist.
- Challenge Clara with acquired evidence, comparing discretion and a threat. Private disclosure should follow the existing case gates.
- Make an allegation; inspect whether the character remembered or doubted it. The allegation must remain attributed to you, not become world truth.
- Ask follow-ups and repeat questions. Look for continuity, relevance and varied delivery; these require real-model playtesting.
- While a reply is pending, try another world action, cancel, or restart. No late reply should alter a replaced session. A person stays engaged until conversation ends.
- Inspect the decision's Character turn audit, export/import, and scrub the timeline. Accepted words and state should survive without fresh calls.
- Stop the proxy: explicit questions should fall back to authored answers; free text should ask for clarification. Disable AI and complete an ordinary offline investigation.

Automated tests use mocked model responses. They cover all six characters, legal consequences, deceptive accounts, uncertain player beliefs, critic rejection, budgets, stale/cancelled turns, UI wiring and deterministic replay. They do not establish real-model critic accuracy, voice quality or latency. Physical scheduling remains deterministic. Optional Z3 checks use the separate Director service; ASP is not included.

## Shared physical plans (September 2026)

Character proposal version 2 adds optional `plan: null | capabilityId`. Older
version-1 proposals without the field still mean “no physical plan.” Tickets
contain perspective-safe available plans: survey a public location, give a held
object to someone present, share a newly witnessed location observation, or use
a case-granted concealment capability. Silas's folio capability requires his
existing knowledge that the detective knows the accounts. Private starting
beliefs are not automatically shareable. The LLM chooses a bounded multi-step
plan, not arbitrary patches or newly invented entities. Unrestricted plan
composition and autonomous background LLM turns remain future work.

The semantic critic checks relevance and promises against the selected plan.
The plan's physical constraints are checked locally during admission and again
at each execution step; with World Director enabled the same query also goes to
Z3 before the candidate turn commits. Source, capability and stale-ticket checks
remain mandatory even when Z3 is off. A failed generated turn cannot leave a
queued plan behind. The queue is created only after the dialogue validates, and
conversation engagement prevents execution until the player releases the NPC.
Movement resumes at actual arrival; transfer and observation are instantaneous
at the current minute. A changed recipient, object or message source blocks the
remaining plan with an audit rather than inventing success. Completed/blocked
intentions are replayable, and pending plans survive export/import.

`actions.mjs` defines the closed vocabulary consumed by the symbolic compiler
and executor: move, observe, communicate, take, give, conceal, and the legacy
store alias. `agent-plans.mjs` supplies capability generation, queueing, generic
execution, and local perception. Case callbacks retain special narrative effects
(such as Clara learning she saw Silas take the folio). No new model calls are
needed in scripted mode, and no model call is needed to finish a queued plan.


## Proposed extension: autonomy inside a dynamically admissible space

The next design replaces a merely predefined plan menu with capabilities or
parameter domains filtered before deliberation by local and applicable symbolic
checks. Scripted candidates and event-triggered AI candidates share this boundary.
Characters choose according to their own goals among admitted alternatives; hard
world and investigation invariants cannot be traded against utility scores.
After selection, composition and the next transition are rechecked on current
state before commit. Conditions and cached results expire when their supports
change. General autonomous deliberation and this broader filtering stage are
proposed, not enabled by the current capability catalog. Private Director
feedback, including observable menu differences, must not expose hidden facts.
