# Living Mystery

## A deterministic substrate for believable characters and investigable worlds

**Living technical report · Edition 0.26 · 11 October 2026**

### Abstract

A mystery game asks its player to reconstruct a hidden history from incomplete and sometimes deceptive evidence. A simulated social world complicates that task: witnesses move, documents change hands, beliefs evolve, and a conversation can change what happens next. Natural-language agents can make these interactions expressive, but expression alone does not establish causal consistency, legitimate knowledge acquisition, or continued investigability. Living Mystery explores an architecture in which a deterministic simulation owns state transitions, characters propose bounded actions and dialogue, and a World Director checks selected physical plans and investigation routes before committing them.

The current prototype includes the original Last Bell and configured/generated Bellweather cases. It combines an append-only event history, perspective-limited beliefs and memories, authored decision policies, optional language-model character turns, a shared action and forensic vocabulary, ordinary autonomous lives, finite competing explanations, and an optional Z3 adapter. The inspector reconstructs past states and exposes the provenance of decisions and knowledge. This report describes the implemented contracts, distinguishes their guarantees from their limitations, and develops a research agenda for generating coherent and playable mysteries. The central hypothesis is that expressive characters and rigorous world rules can reinforce one another when their authority and information boundaries are explicit. This hypothesis has not yet been established by a player study or a real-model evaluation.

### Report status

This is a design and implementation report, not a peer-reviewed paper or a claim of completed procedural generation. It documents the working-tree implementation at the date above. Test evidence is reported with its scope; planned evaluations are not presented as results. Worked examples reveal the solution and private character information in The Last Bell.

| Label | Meaning in this report |
| --- | --- |
| Implemented | A concrete path exists in the repository. This does not imply generality or empirical quality. |
| Experimental | Implemented, bounded functionality whose adequacy needs broader evaluation. |
| Proposed | An architectural target or experiment without a complete runtime implementation. |

### Contributions of the current prototype

- An event-based simulation that separates recorded physical history from character beliefs, speech assertions and player hypotheses.
- A common admission boundary for authored and bounded AI-selected physical plans, with local checks and optional independent solver execution.
- A provenance-preserving belief lifecycle, including explicit dependencies, retirement and completed intentions.
- An investigation debugger that makes temporal order, information flow and differing perspectives inspectable.
- Bounded acquisition search and mandatory transition admission in three authored configurations, with executed prehistory and source-linked morning evidence.
- A composable narrative-module ("brick") system with a case-general validator: each case is a base scaffold plus composed modules, and only cases that pass physical, epistemic, reachability and evidence-driven distinguishability obligations (plus each module's local invariant) are admitted. A seeded sampler yields validated, playable generated cases over the fixed cast.

These are engineering contributions of this prototype. We make no priority claim relative to the wider literature. The [research context](reference.md#research-context) identifies related approaches without implying that their methods or empirical results have been reproduced here.

### How to read the report

Start with [research questions and principles](foundations.md), then [architecture](architecture.md). The next three chapters detail [knowledge](knowledge.md), [character turns](characters.md) and [symbolic validation](symbolic.md). [World Director](director.md) explains the boundary between a feasible action and a viable investigation. [Worked examples](case-study.md) connect those mechanisms to actual play. The remaining chapters address [player and inspector experience](experience.md), [evaluation](evaluation.md), and [procedural generation](generation.md).

The [reference chapter](reference.md) contains a glossary, source map, bibliography and maintenance protocol. A single-page edition collects every chapter for continuous reading and printing. Markdown sources and SVG diagrams are maintained alongside the implementation; generated HTML is a reproducible reading format rather than the editing source.


### Edition 0.3 implementation

Three fixed same-cast configurations now vary culprit, means, motive and crime time. Their prehistories execute in the kernel; evidence and initial knowledge link to recorded events. A bounded acquisition search constructs and replays investigation witnesses. The new configurations enforce local transition admission even with AI and optional Z3 disabled, including relevant intermediate access/deadline checks. [Generation](generation.md#10-7-the-implemented-configuration-pipeline) explains the implemented pipeline and the bounded seeded sampler. The original case remains available with its existing richer authored behavior.

### Edition 0.4 implementation

A case is now a **base scaffold plus composed narrative modules** (`dist/modules/`): reusable bricks — misdirection, an honest-mistake correction delivered to the constable in person, a benign secret that makes an innocent evasive, and a live culprit concealment — that contribute clues, sourced prehistory, NPC capabilities and dialogue, and each declares a local coherence invariant. A **case-general validator** (`dist/casegen.mjs`) admits a specification only when it passes physical execution, epistemic sourcing, bounded reachability and **evidence-driven distinguishability** (selected acquired records exclude alternative suspect/method/motive combinations in the finite domain) obligations, plus every composed module's invariant. A **seeded sampler** returns only validated cases, and generated cases resolve from their id, so they are playable and save/reload-safe through a menu "generate a case" action. The capability system gained fetch and inform plan shapes, so concealment (the culprit hides a document it knows about) and correction (the witness travels to Bell and delivers her revised account) run as validated live plans. This advances the [staged plan](generation.md#10-5-staged-generation-and-exit-criteria) into a bounded slice of G2; new casts, maps and richly generated prose remain future work.


### Edition 0.6: persistent NPC lives

Ordinary responsibilities, fatigue, errands and social goals now coexist with mystery modules in configured cases. NPCs deliver invitations, accept appointments in person, reserve travel time and reconsider failed plans. Optional language-model deliberation selects bounded goal sequences through the same action and commitment checks. Scripted mode and deterministic replay remain complete paths. The [character chapter](characters.md#4-7-autonomous-daily-lives) describes implementation and limits.

### Edition 0.6: shared forensic reasoning

Configured and generated cases now use typed crime/evidence occurrences, registered belief-support rules, finite competing-explanation grading and three investigative structures. The browser and Z3 share the constraint representation. The original case retains its authored rubric; the new checks certify only the declared finite domain. See [symbolic validation](symbolic.md#5-6-shared-forensic-queries) and [structural generation](generation.md#10-9-investigative-structures).

### Edition 0.7: verified and hardened AI paths

The optional model paths were exercised against a live model and hardened. Life deliberation now runs **detached** after the player's action commits, so it never blocks the action or its reply, and it yields to any new player turn (an in-flight deliberation is aborted so it cannot stale the turn); its goal selection is parsed fence-tolerantly and passes the local investigation-admission check. A free-text question a character has no account for now produces a faithful **in-character decline** — the model may not answer or assert facts without a selected account — instead of a fallback. World Director deferrals in conversation now explain how to proceed. These are robustness and UX fixes; the underlying contracts and finite domains are unchanged.

### Edition 0.8: durable autosave and conversation-focused people view

Autosave now uses **IndexedDB** as the primary store, with `localStorage` kept as a synchronous mirror and fallback. A long investigation with the full AI reasoning trace could exceed the browser's ~5MB `localStorage` quota and fail to save; IndexedDB's far larger quota removes that cap, and the save degrades gracefully (compact gameplay-only `localStorage`, then an error) only if both stores fail. The Export file remains the durable off-browser copy. In the notebook's people view, the person you are currently speaking with is pinned to the top and marked, so their profile and live trust/stress meters stay visible as the conversation changes them.

### Edition 0.9: structural variety — the declarative forensic model and manner-of-death

The first step from *combinatorial* variety (the same puzzle with different fillers) toward *structural*
variety (different kinds of investigation). The finite forensic model is now **declarative**: dimensions
are data (integer domains with labels), evidence predicates are a compiler registry, and a single generic
enumerator ranges over whatever dimensions a case declares — a behaviour-preserving refactor that leaves
every prior case identical. On that substrate, **manner-of-death** adds the first new axis: some generated
cases are staged to look like an accident, and the accusation is **gated** until a coroner's finding
establishes that the death was murder. It is always ultimately a murder (staging is a disguise), manner is
an investigative gate rather than an accusation field, and the coroner finding is load-bearing on every
proof route. A separate design note (`docs/manner-of-death.md`) records the rationale, the declarative-model shape, and the safety rails.

### Edition 0.11: the primitive-algebra pipeline, an affordance grammar, and an LLM composer

Generation now runs on a named, versioned **primitive algebra** (`dist/primitives.mjs`) with a
**declarative composition compiler** (`dist/composition.mjs`): a composition is pure data that compiles
to the same certified prehistory/claims/routes a hand-authored brick produces (two live bricks were
re-expressed as compositions to prove adequacy). Three deliberately **divergent** case types exercise it —
staged-suicide, two-person **collusion** (a shielding ally's false alibi, caught by the contradiction
engine), and **delayed-effect poisoning** (toxicology fixes the administration window, not the death).
The "means" axis became an **affordance grammar** (`AFFORDANCES` in `primitives.mjs` + an object catalog
in `dist/objects.mjs` + a mechanism compiler in `dist/mechanism.mjs`): each affordance reduces to a
validated kernel predicate, so new murder objects — an icicle that melts, a silk-scarf ligature, a rigged
set-and-leave chandelier — are mostly data. A **forced-insight** obligation certifies that a declared
twist is load-bearing (removing its clue drops the true accusation's support), and a manner×method
coherence guardrail rejects logically contradictory stagings. A prep-time **LLM composer**
(`dist/llm-composer.mjs`, surfaced as "Generate with AI") proposes specifications over the validated
palette, compiles and validates them with the same oracle, repairs from structured feedback, caches per
seed, and falls back to the deterministic sampler when the model cannot produce a valid case. Character
dialogue was made markedly more natural: per-character pronoun/address/voice, a warmer generation
temperature, an explicit "don't recite records" instruction, witnesses that confirm the objective records
shown to them, and a relaxed number gate that permits natural time phrasing while still blocking invented
figures. See [Generation](generation.md#10-10-the-primitive-algebra-and-the-composition-compiler) and the
design note `docs/primitive-algebra.md`.

### Edition 0.12: depth — gated discovery, inference chains, and a certified inversion

A first end-to-end **deep** case model, built as a parallel path that rides the existing engine (the flat
path stays green). A case is now expressible as an **artifact** (`dist/case-artifact.mjs`): *neutral*
observations that don't announce their meaning, each grounded and carrying the typed claim it licenses,
with **discovery gates** (a clue's object stays locked until its prerequisites are acquired) and a
declared **inversion**. New obligations certify depth: **fair-play** (every inference premise is
earnable), **discovery-depth** (a load-bearing clue sits N gate-hops deep), and the **inversion-anchor**
contract (the anchor is reachable, necessary, and overturns a coherent naive reading). A library of
coherence-preserving **operators** (`dist/operators.mjs`) deepens an artifact, and a deterministic
generator (`dist/deep-generator.mjs`) produces an always-certified deep case — a delayed poisoning whose
decisive toxicology finding is hidden behind a washed-decanter → discarded-dregs chain, with the recorded
time of death as a misdirecting alibi the toxicology overturns. The LLM composer picks who/why and falls
back to the deterministic deep case. The chooser offers "🧩 Generate a deep case"; reachability was
extended so the bounded search finds the gated path. See the design note `docs/depth-operators.md`.

### Edition 0.13: breadth, deeper ladders, red-herring fog, and in-room disclosure

Edition 0.12's single deep shape becomes a family. The generator now selects among **three deep shapes**,
each hiding a *different* forced anchor: **delayed-poison** (the toxicology time-of-death), **buried-motive**
(a reconstructed confrontation memo), and **hidden-means** (a tool-mark trace that clears the obvious
weapon). Each anchor is now buried behind a **~5-hop discovery ladder** rather than two, so investigation
becomes a point-and-click chain — examine one lead to reveal the next. Every deep case also carries
**red-herring fog**: neutral observations with no bearing on the crime (a hidden love-letter, an unpaid
wine bill, a stopped clock), some hidden behind one another, which are *never* forced and *never* a premise
of a forced clue — so the solver's route ignores them while the player must sift them. The binding
constraint is the bounded solver's 30-clue bitset; a deep case now uses ~23–24 of 30, and all sampled seeds
certify at depth 5 across all three shapes.

The interface gains **in-room disclosure**: the inspect panel groups reachable objects into **sections** by
the kind of evidence they yield, and *hides* gated objects until their prerequisites are found (removing the
old inspect-and-reject on locked objects). A quiet hint signals that hidden leads remain. Finally the LLM
can author a **full deep artifact** (`composeArtifactCase`): it proposes a whole discovery chain of neutral
observations gating a forced anchor plus the inversion; a safe expander (`expandArtifact`) rejects
malformed structure and never admits ungrounded claims; the engine certifies every obligation, repairs from
structured feedback, and falls back to the deterministic deep case. A small operational fix lets the local
LLM proxy self-heal a stale cached credential by rebuilding its client once on failure. See
`docs/depth-operators.md`.

### Edition 0.14: a general mystery kernel, recursive refinement, and playable generated cases

Case generation was redesigned from first principles as a setting-independent **mystery kernel**: four primitives
(entity, event, attitude, rule) plus a question, a fixed set of sign kinds whose meaning is computed by code, and one
recursive operator family — **Conceal, Fragment, Mislead** — under two laws (the refined chain delivers the same
proposition, and every refinement is justified by an event caused by someone's attitude). Misdirection is defined as a
defeated default. A refinement harness lets code choose where a case gets harder and check every step while a
language model writes the story beat and a second model reviews its plausibility. The kernel is implemented in
JavaScript (`dist/mk/kernel.mjs`) and agrees with the harness's Python checker on every generated case. Run in the
Bellweather setting with the original cast, map and art, the generator produced five certified cases at solve depth
4–7 (14–24 clues, 27–35 history events, a certified twist, lies and red herrings), which play in the existing game
through a bridge (`dist/cases/kernel-case.mjs`) including free-text character dialogue grounded in each character's
memories and beliefs. See `docs/mystery-kernel.md`.

### Edition 0.27: fairness found in human play

Three human plays led to general rules (see [4.9](characters.md#4-9-fairness-rules-from-human-play)). The constable is
the detective's ally: never a suspect, never untrue, holding nothing back, which code checks on every generation step
and at publication; his briefing names only the doctor in medium and hard cases. An innocent caught lying says why; a
red herring pressed twice gives its reason, its explanation is hinted and cannot be hidden in the morning, and the
closing file explains the lies and herrings left. The fact-checker allows common knowledge and what a person has
already said; stress follows confrontation. The characters can run on a Claude or OpenAI API key as well as on Bedrock
(generation stays on Bedrock). A later play led to a doctor's rule (her findings never wait behind another account of
hers), a step critic that re-judges every clue whose gate changed, a blocking whole-case review, clues that go with the
person who keeps them, and an expert's comparison when evidence is shown; its two affected cases were regenerated. The menu offers six cases, one easy, two medium and three hard, that keep
these rules; public knowledge of who had an item or a trait enters the notebook only once a clue about it is
understood ([10](generation.md)).

### Edition 0.26: claims that are sound and complete

The language of clues was audited predicate by predicate and replaced. A claim is now an instance of one of eleven
predicates over *fluents* (where someone is, who holds an object, a relation, a trait), each with a temporal mode
(throughout, at some minute, at no minute); events change fluents through their effects, and a claim's truth is computed
in the history (a claim the history does not decide is refused). Suspects are ruled out only by what the player knows:
the clues they hold and trust, and *public signs* (what everyone in the village knows, held from the start). The
direct procedure in both kernels agrees with a Z3 reference both ways on every case and on 5,600 random sets of
evidence. All published cases were migrated; their certificates are unchanged except where the crime window, now
public, overturns a stopped watch. Specification: `docs/claims.md`. See [chapter 12](worked-example.md).

### Edition 0.25: a worked example

Chapter 12 follows one case, *Death Among the Orchids*, through its life: the records that represent it, how the generator's proposals were refused and accepted by the kernel, and how the director, the characters and the accusation were checked during a play-through, with the solver's actual results. See [chapter 12](worked-example.md).

### Edition 0.24: a bug track, and a fourth epoch

A bug track checks every recorded game with invariant detectors and a correctness judge that sees the true records; six general bugs were found from the agents' games and fixed. A fourth epoch on fresh cases rejected one change and kept two as fixes. Turns that leave the player with nothing fell from 28% to 7%. See [chapter 11](playtest.md).

### Edition 0.23: playtesting itself

Agent players with profiles play cases through a text interface; the games are scored from the event log and judged by a separate model; changes are proposed as hypotheses with registered predictions and kept only if paired experiments on held-out cases support them. Three epochs have run: one change failed and was reverted, and the kept changes raised the share of hints that help from 57% to 87%. See [chapter 11](playtest.md).

### Edition 0.22: playing it as a player

Five cases were played end to end, one by the author, and every problem found was fixed as a general rule. Everyone
starts where the history leaves them, and the detective starts with the constable, who is the setting's role rather
than a named person. People know what the detective did only if they saw it or were told, worked out from the event log.
Stress follows the history: how much of what bears on a person the detective holds, and how far the field has narrowed
on a suspect still standing. Questions that reword another are found at publish and asked through it. Hints follow the
signs the kernel finds critical to the solution. The play-time Z3 check counts held evidence only once it can be read,
as the game's kernel does. See docs/living-village.md.

### Edition 0.21: a living village

Witnesses say whom they saw last night, from the true history and only where that cannot shortcut the puzzle. The
morning moves: a model plans the next half hour over the whole story, and three critics check each plan first (code for
knowledge, place and time; a model for what is said; the certifying kernel for every concealment, so at least one
solution always remains). Two cases were played to a correct accusation with culprits hiding evidence along the way.
See docs/living-village.md.

### Edition 0.20: what people can say

Every person in a case has an evening in the history; each says what they did last night and this morning from their own
events (the culprit may give a cover story), and the questions keep night and morning apart. The fact-checker knows the
time, lets characters restate their own stories and say when they do not know, and every account is checked to be
reachable from the Talk menu. Cases are tested end to end: generation, certification, a solved play-through, and every
character asked a standard set of questions with the real AI. See generation §10.17.

### Edition 0.19: difficulty, a newcomer and more objects

Cases carry a computed difficulty (easy, medium or hard, from the certifier's measures) and can be generated to one;
the village gains a twelfth person, Mrs Vera Lacey, a newcomer lodging at the Rook; and the clue library grows to 50
painted objects that the generator knows, with each clue's picture chosen at publish. See docs/difficulty.md and
docs/visual-world.md.

### Edition 0.18: the history is the only source of facts

Characters can only say what the generated history lets them know: every account is backed by an event they took part in
or saw, or by something the case records they knew, and both kernels certify it. The examination of the body is part of
the history, so the doctor remembers it. Publishing no longer adds facts after the story is written, and code names roles,
not people. See generation §10.17.

### Edition 0.17: a visible village

The game now shows the world instead of listing it: an illustrated village map with who is where and what is left to
do, the scene of the current place, a full-height two-sided conversation, a Talk panel (people here, questions, free
text), an inventory with clue art and drag-to-show, a Clue Board with every villager's profile and the full history,
and an opening with the cast and a tour. Everything is drawn from engine state and never reveals hidden facts. Art for
new places, people, the detective and a 30-object clue library was generated in the game's style. The design is in
`docs/visual-world.md`.

### Edition 0.16: fair, varied cases and characters that talk like people

Certification now requires **motive, means and opportunity**: a case publishes only if the player can reach evidence of
the culprit's motive and means as well as rule out every other suspect. The accusation asks who, how and why; Bell names
the missing pillar. A **Z3 case oracle** re-derives feasibility and uniqueness independently of both kernels, and a case
is published only when all three agree; for an unproven accusation it supplies a concrete alternative story.

A **premise deck** chosen by code (victim, culprit, suspects, method, motive, scene and shape, rotated against recent
cases) replaces the fixed briefs, so the model writes the story but cannot fall back on its favourite one. The village
grew to ten places and eleven people with character sheets and new art. Publishing adds everyday knowledge, per-case
moods, loose-end explanations and concessions, then reviews every written line against the true history. Characters
use their everyday facts, hold back openly instead of playing dumb, and are guarded against wrong names and invented
times. One finished case is kept in reserve so a new case can be started at once.

### Edition 0.15: generation in the game, and a playable generated case

The case chooser now has a single generator. It starts a job on a local generator server, which runs the refinement
harness in the Bellweather setting and streams progress: the first draft, then every layer with its story beat, the
records it added, rejected candidates and the plausibility verdicts. The player sees a high-level progress view; a
collapsed spoiler section shows the cast with their secrets, the hidden history and each layer, for testing. Finished
cases are published for play.

Playing generated cases exposed gaps that are now closed: every case includes the doctor's examination (cause of death
and the time window, needed to judge alibis; certification unchanged), every character has an evening account, the
physical traits clues test are visible, showing evidence uses spoken lines and per-character reactions written at
generation time (with kind- and relation-aware templates as fallback), honest mistakes are conceded differently from
lies, free-text questions can draw on every account a character can give, and a guarded third attempt keeps untold
memories private in character. People keep to their places, a progressive hints tab replaces hypotheses, and every
layer writes debug logs to `logs/` (see the reference chapter).
