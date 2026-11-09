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

A turn records its intent, selected account, exact accepted words, sources, bounded trust change (±0.15 a turn when the model judges the exchange warmer or cooler: courtesy, belief and kept confidences warm; accusations, threats, disbelief and being caught out cool), dialogue-state progression and optional explicit ending. Conversation state retains prior disclosures and the latest topic, question and event links. The full perspective/proposal/validation audit lives on the decision event. Speech records the authored reference separately; acquired testimony uses the accepted words.

Saved event history replays without a model call. Fresh AI runs can differ. Audits are debugging records, not authenticated evidence against local save editing. The omniscient inspector and exported saves contain private information by design.

## Budgets and failures

A turn has at most three generation and three critic requests, within one client deadline (the turn timeout the proxy advertises: 45 seconds by default, 240 seconds with a local character or checker model). Input is limited to 1,200 characters; prompts to 32,000; model responses to 12,000. Generation requests cap output at 1,200 tokens and critic requests at 700. The proxy's separate `character-v1` profile bounds the request body to 128,000 bytes and output allowance to 1,500 tokens. Oversized contexts fail into authored fallback rather than silently removing constraints.

Failed explicit buttons retain their authored answer and case consequences. A failed plain question about last night gives the published night account the model chose, when that attempt passed every code check. A failed free-text turn that the model answered from something the person has already told the detective refers back to it in the engine's words ("As I told you: ...", quoting only the sentence the question is about when one plainly is), adding nothing to the notebook; any other failed free-text turn declines in the person's published, fact-free words. A fallback never repeats the person's last words: pressed again on what they have already answered, they say, in their own published words where the case has them, that they have answered as best they can and that they will look at anything the detective has to show. A character may ask the detective to be clearer once; a reply labelled clarify that asked nothing does not count as that request. The constable's verdict on an accusation is part of his side of the conversation, so he can be asked about it. A person may say where a record of their own making lies when the detective may look at it now (the doctor's notes at her surgery); never the culprit, and never anything still locked. The critic also rejects a reply that describes a person as someone they are not (a wrong kinship or role against the roster), including agreeing with the detective's wrong one. Rejected wording is never committed. A reply with no account is also screened by code: it may give no clock time, number or place the detective has not already mentioned. The generation prompt also directs a clean in-character decline (no account, intent clarify or refuse) for any question outside the character's perspective and accounts, so an out-of-scope question yields a graceful passing non-answer instead of speculation the critic must reject — a general mechanism, not per-character refusals. Intent answer and deceive require a selected account, so a null-account answer that invents facts fails validation, and that failure is fed back as a directive hint that steers the retry to a clean in-character decline. When the player presents evidence, its description is passed in context and the directive routes the other way — to selecting the character's authored reaction to that evidence — so a character acknowledges what it is shown (answering, or deceiving/evading its meaning) rather than feigning ignorance of it. Cancelled replies have no effects. These bounds control request volume; they do not measure actual provider spend. General memory retrieval, separate critic models and empirical quality evaluations remain roadmap work.

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
unrestricted composition remains future work. Bounded life-goal composition and optional NPC deliberation are now implemented; see [autonomous lives](autonomous-lives.md).

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


## Autonomous life implementation

Configured/generated cases now support persistent ordinary goals, timed activities, delivered social requests, accepted commitments and replanning. `life.mjs` drives scripted policies through shared move/activity constraints; `autonomy-turn.mjs` adds isolated optional model selection of bounded goal sequences. The original case retains its legacy policies. Z3 verification batches up to twelve queries per request under the existing atomic turn boundary. See [the complete implementation and test guide](autonomous-lives.md) for state, budgets, assumptions and limitations.

## Trust and stress (October 2026)

- **Trust** moves ±0.15 a turn in the direction the character's model chooses; the prompt says what warms and cools.
- **Stress follows the history and the pressure** (`kernel-case.mjs` `stressFor`): how much of what bears on a person
  the detective holds (clues about them, naming them, from what they did; clues that defeat their own stories count
  double), for a suspect still standing how far the evidence has narrowed the field, and how often they have been
  pressed in person (shown evidence that bears on them, asked why about their own behaviour, or an exchange that cooled
  them; each adds 0.15 of exposure, six at most, as a `pressure` step). Someone with something to fear feels it most:
  a `fears` or `hides` attitude, an untrue account of theirs, behaviour with a private reason behind it, or being the
  culprit. The constable is never pressed. It changes as an `emotion` event, so it replays, and the prompt sees it.
- **Caught in an untrue account**, an innocent concedes in the engine's words with the case's reasons for the lie (what
  they believed, feared or wanted, and what that rests on), whatever reaction was written for the clue; the culprit may
  still brazen it out with the written line. Shown the same clue again, they refer back to what they admitted.
- **A red herring put to its subject.** The first time, they turn it aside (the written reaction). Pressed again, or
  asked while the player holds what explains it, an innocent person gives the private reason behind it (the attitude
  that caused it, and what that rests on): words only, so the explaining clue is still the player's to find. Nobody may
  hide a clue that explains a red herring in the living morning, and the hints lead to it once the player has seen the
  behaviour (after the solution's own path).
- **The closing file** (a supported accusation) adds the motive and means evidence the player missed, why each person
  other than the culprit gave an untrue account, and what each red herring the player did not get to the bottom of
  really was, and why.
- **The fact-checker** is given what everyone knows (`publicFacts`: the public facts in the notebook) and what the
  person has already told the detective (`toldAccounts`, lie or truth). Saying either, or a person's role and home from
  the roster (who lodges where), is not an added fact; a decline with no account is never a fault for not answering.
  The account's claims and sources are filled in by code, so a reply is not lost for leaving them out.
- **What a person keeps goes with them.** A clue that comes from someone's own doing and waits behind an account of
  theirs (the doctor's notes, the dead man's effects she took) opens wherever that person is and is handed over then
  and there; one handover can open the next. A lead that points to such a clue names the person ("with Dr Marsh"), and
  so does its hint.
- **Experts read evidence.** Shown a clue that needs one of their own findings to be read (a possible weapon, and the
  doctor's notes on the wound), a person confirms that it fits when the player holds the finding, hands the finding over
  when it is theirs to give, and otherwise says it must wait. The clue just shown stays on the table for two exchanges,
  so a follow-up in the player's own words ("could that be the weapon?") can be answered with that comparison.
- **Replies are not lost** for repeating a figure written on the evidence shown, the question or the conversation, and
  a person with no reaction to a clue is offered only accounts that share a person, place or subject with it.
- **The constable's briefing** points to one person only in an easy case; in a medium or hard case (or one with no
  level) only to the doctor, so the briefing never hands over the investigation.
- With no account for a question, a character says plainly they have nothing to tell; they ask for clarification only
  when a question is genuinely ambiguous, never twice running, and never set conditions (authority, a reason): what
  makes people say more is being shown evidence.
