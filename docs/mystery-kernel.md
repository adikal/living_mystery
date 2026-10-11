# Design note: a general mystery kernel — four primitives, a block library, and recursive refinement

Slides: docs/deck/living-mystery-deck.html (open in a browser; arrow keys to navigate, #N opens slide N).

Status: **implemented through the playable slice** (kernel, generator, bridge, five playable Bellweather cases; see sections 14–16). This note steps back from the current engine and designs a case
model from first principles. The existing code (primitive algebra, bricks, depth operators, the bounded
investigation search) is useful background, not a foundation. Nothing here is specific to Bellweather, its
cast, its map or its weapons.

## Summary

A mystery is a hidden true history, a visible surface, a question, and a process by which the player gains
knowledge until one answer survives. We model it with:

- **A closed kernel**: four primitives — **Entity, Event, Attitude, Rule** — plus a **Question**, a small
  fixed set of commonsense rules, and a fixed set of **sign kinds** whose meaning is computed by kernel code.
- **An open library** of general, reusable **blocks** in genre vocabulary (alibi, decoy, motive, secret,
  lie, red herring, cover-up, …). The LLM writes in blocks; each block compiles to primitives.
- **One recursive operator family, Refine** — **Conceal, Fragment, Mislead** — that turns something the
  player gets for free into a small sub-mystery yielding the same thing, and must be justified by an event
  in the true history. Recursion depth is the difficulty dial; each refinement is a story beat.
- **Certification by plain algorithms** (interval checks, graph reachability, dominators, set filtering).
  No general logic engine unless a real need appears.

## 1. Principles

1. **Meaning lives in data, never in prose.** Every fact the game depends on is a typed record. Prose is
   generated from records and checked against them. This is what lets a deterministic kernel check a
   model it cannot trust.
2. **The LLM proposes; the kernel checks.** The LLM supplies settings, people, histories, motives and
   craft. The kernel decides whether the result is consistent, fair, solvable and deep.
3. **Small closed kernel, large open library.** Primitives, sign kinds and commonsense rules are
   human-authored and versioned. Blocks can be added freely, but every block must compile to the kernel;
   a block that cannot compile is evidence the kernel is missing something.
4. **Logic only where it adds value.** The kernel computes anything the LLM could get wrong by inference —
   which candidates a clue rules out, whether an alibi is physically possible, whether a clue is
   load-bearing. It does this with fixed code per sign kind, not a general reasoner. See section 9.
5. **Every complication has a cause.** Nothing is hidden, ambiguous or misleading without an event in the
   true history, performed by someone for a reason. This is what makes a case read as a story rather than
   a puzzle box.

## 2. What a mystery is

| Part | Meaning |
|---|---|
| True history | what actually happened, including any cover-up |
| Surface | what the world shows when play begins |
| Question | what the player must determine: who, how, why, when, where, which, what happened |
| Process | the player acquires signs and reasons until exactly one answer to the question survives |

Detective fiction is the controlled release of information plus misdirection. Adventure play means that
acquiring information requires acting on the world. Neither depends on murder, a manor or a fixed cast: a
theft on a train, a forged will, a vanished guide and sabotage aboard a ship have the same shape.

## 3. The kernel

### 3.1 Four primitives and a frame

| | Primitive | What it is |
|---|---|---|
| Being | **Entity** | anything with identity: person, place, object, document, group |
| Becoming | **Event** | something that happens over a time span, with participants in roles, preconditions and effects; done by an agent or by nature |
| Mind | **Attitude** | an agent's stance toward a proposition — believes, knows, wants, fears, intends, feels — with a strength |
| Law | **Rule** | how things generally go: strict, or a default ("normally …, unless …") |
| Frame | **Question** | a variable with a finite set of candidate answers |

The currency is the **proposition**: a typed statement about entities that holds over a time span. The
glue is **causation**: events cause effects; attitudes cause intentional events (I want X, I believe this
act gets X, so I act); events cause attitudes (I saw it, so I believe it). Minds act on the world and the
world changes minds.

The player is an agent, and their actions are events. The past the player infers and the present the
player acts in are one kind of thing: events on one timeline.

### 3.2 Record shapes

Illustrative, not final:

```js
// Entity
{id:'keeper', kind:'person', props:{name:'Ezra Hale', handed:'right', pledge:'temperance'}}
{id:'gallery', kind:'place', links:{lamproom:1, stair:2}}

// Event: roles, time span, place, preconditions, effects, and (if intentional) the attitude that caused it
{id:'e_push', type:'push', agent:'tom', patient:'keeper', at:'gallery', time:[1420,1422],
 pre:['at(tom,gallery)','at(keeper,gallery)'], effects:['dead(keeper)'], causedBy:'a_tom_silence'}

// Attitude
{id:'a_tom_silence', agent:'tom', mode:'intends', content:'not knows(keeper, signalling(tom))', strength:0.9,
 because:['a_tom_money','a_tom_fear']}

// Rule (domain, from the setting)
{id:'r_trim', kind:'default', text:'wicks are trimmed about once an hour',
 when:'trimmed(T1) & trimmed(T2) & T2-T1 < 30', then:'abnormal(lamp_use)', knowledge:'acquirable'}

// Question
{id:'q_who', ask:'who caused the keeper to fall?', candidates:['tom','wife','coxswain','accident'], truth:'tom'}
```

Attitudes may be about another agent's attitude (she believes he knows), capped at two levels. That covers
deception and fear of exposure without unbounded theory-of-mind. Attitudes are **data**: they justify
events, drive character behaviour, and appear in blocks. The kernel does not run a belief logic over them.

### 3.3 Fixed commonsense rules

Shipped with the kernel as code, versioned, not authored per case:

| Area | Rule |
|---|---|
| Time | a proposition persists until an event ends it; causes precede effects |
| Space | one place at a time; travel between places takes time |
| Perception | an agent present at an event normally perceives it, subject to light, distance and attention |
| Communication | hearing a claim normally produces belief, in proportion to trust in the speaker |
| Intention | agents normally act on their strongest desire given their beliefs |
| Memory | beliefs normally persist, and may fade or drift with time |
| Emotion | strong attitudes normally show in behaviour: nervousness, avoidance, tears, anger |

Each setting adds **domain rules** as data (the LLM proposes them; the kernel validates their shape): "this
poison acts after hours", "the tide covers the causeway at dusk", "a gold-seam repair is unique". A domain
rule that a clue depends on must be either **common knowledge** or **acquirable** as a sign (a manual, an
expert's testimony). The player is never expected to know a rule they could not have learned.

### 3.4 Signs and their fixed meanings

A **sign** is not a primitive. It is any observable effect of an event: a mark on an entity (a trace), or a
speech event's content (testimony). Reading a sign means inferring the event that caused it. Signs refer
to things by **description** ("a tall man in a grey coat"), never directly by identity; working out which
entity fits is part of the puzzle.

The LLM never states what a sign rules out. It chooses a **sign kind** and fills the slots; the kernel
computes the eliminations against each candidate hypothesis with fixed code. (Implemented as claims version 2: eleven
predicates over facts that change with events, with their truth computed in the history and eliminations computed only
from what the player knows, checked against Z3 both ways; see [the claims specification](claims.md). The table below
is the original design.)

| Sign kind | Carries | Rules out candidates who… |
|---|---|---|
| Place | a description was at a place during a span | could not have been there then, given their known whereabouts and travel time |
| Time | an event happened within a bound | had no opportunity within that bound |
| Trait | the actor had a property (left-handed, tall, knew the code) | lack the property |
| Possession | an item was held or accessed during a span | had no access to it |
| Capability | the act needed a skill, strength, tool or knowledge | lack it |
| Relation | two parties stood in a relation (owed money, were lovers) | lack the relation a motive requires |
| Testimony | a speaker asserts a proposition | are ruled out by that proposition — only while the testimony is trusted |
| Identity | two descriptions pick out the same entity | are excluded once descriptions are linked |
| Absence | an event a rule predicts did not happen | are ruled out by the rule's failed precondition (the dog did not bark, so the visitor was known to it) |

A candidate is a **hypothesis**: an answer to the question (a person, a set of people, a time, or a short
alternative history for "what happened"). Uniqueness means exactly one hypothesis survives every reachable,
trusted sign.

## 4. Refine: the recursive operator

### 4.1 Three operators

A player learns a proposition through a chain: **access** a sign, **read** it, **trust** it. Difficulty can
live only in those three links, so there are three operators.

| Operator | Link | What it does |
|---|---|---|
| **Conceal** | access | the event that reveals the sign gains a precondition: physical (a key, a tool, a search), social (trust, leverage, a trade, the right question), or temporal (moved, fading, destroyed, only available for a while) |
| **Fragment** | reading | the sign no longer settles the proposition on its own; a second sign plus a rule is needed, and optionally another candidate fits the first sign too |
| **Mislead** | trust | a default fires on the surface and points to a wrong answer; a deeper sign triggers the exception |

### 4.2 Two laws

1. **Output preserved.** The refined chain still delivers exactly the same proposition. It never delivers
   it earlier (no shortcut), and it adds nothing that settles a parent question early.
2. **Justified by the true history.** Every refinement adds at least one event caused by an attitude. The
   letter is concealed because someone who loves the son hid it. The alibi misleads because a sister
   protects her brother. The justifying event leaves new signs of its own (the hider's nervousness), which
   are the next leaves to refine.

### 4.3 Recursion

Construction runs **top-down**: start from the truth and a trivial surface where one sign gives the answer
away; repeatedly pick a leaf the player gets for free and refine it. Play runs **bottom-up**: the player
peels the surface back towards the truth. Depth of recursion is the difficulty dial.

Because every refinement is justified by an event, refining writes plot, and plot creates more to refine.
No separate composition operators are needed:

- A **red herring** is a Mislead whose correction is itself a small nested question ("why was he
  nervous?").
- **Background noise** comes free: a living world's ordinary events leave signs everywhere.
- **Acts** come free: agents keep acting on their attitudes during play (a culprit who comes to fear a
  witness acts against them).

### 4.4 Misdirection, precisely

Misdirection is a **defeated default**. On the surface, the player's natural commonsense reading fires and
points to a wrong answer; a deeper sign triggers the exception.

| Default | Defeated by |
|---|---|
| people tell the truth | a false alibi, broken by a record |
| the recorded time of death is when the attack happened | a poison that acts after hours |
| the nervous one is guilty | an innocent secret |
| a fall in a storm is an accident | evidence of motive and staging |
| the narrator is honest | the narrator's own contradictions |

This is checkable: the hypotheses surviving the **surface** signs (with misleading testimony trusted)
exclude the truth, and the hypotheses surviving **all** reachable signs (with the defeater applied) contain
only the truth.

## 5. The block library

Blocks are the authoring vocabulary: general genre terms that apply in any setting. The setting supplies its
own nouns; blocks supply the craft. Each block has typed **slots**, compiles to primitives, requires its
**justification**, and realizes one or more operators.

### 5.1 Three blocks in full

**Alibi** — slots: *subject, claimed place, claimed span, source, truth (true/false), reason if false,
defeater if false*. Compiles to a testimony sign of kind Place from the source. If false: the source's
attitude that the subject was elsewhere is not held (a lie) or is mistaken (a misperception); the reason
for lying is a required attitude (love, fear, debt); the defeater is a required sign that contradicts the
claim. Realizes **Mislead**. Compilation fails if a false alibi has no defeater: an unbreakable alibi is
unfair by construction.

**Secret** — slots: *holder, hidden proposition, what they fear, how it shows*. Compiles to a desire to keep
the proposition hidden, a fear of exposure, a behaviour sign from the emotion rule (nervousness,
avoidance), and a Conceal on every sign of the hidden proposition. Realizes **Conceal**, and **Mislead**
when the behaviour sign looks like guilt. One secret is a ready-made red herring.

**Decoy** — slots: *second candidate, the sign they share with the truth, the discriminating sign*.
Compiles to a widening of an existing sign so it fits both candidates, plus a required second sign that
separates them. Realizes **Fragment**. The discriminating sign is itself a leaf for further refinement.

### 5.2 The library

| Family | Block | Slots (abridged) | Operator |
|---|---|---|---|
| Motive | Gain | who, what they gain, from whom | justification |
| | Fear of exposure | who, what would be exposed, by whom | justification |
| | Revenge | who, the old wrong, the wronged party | justification |
| | Protection | who, whom they protect, from what | justification |
| | Jealousy | who, of whom, over what | justification |
| | Ambition | who, the position, the obstacle | justification |
| | Conviction | who, the cause, the act it demands | justification |
| | Desperation | who, the pressure, the deadline | justification |
| Mind | Secret | holder, hidden fact, fear, how it shows | Conceal, Mislead |
| | Lie | speaker, false claim, audience, reason, defeater | Mislead |
| | Mistake | witness, what they saw or recall, why it is wrong, correction | Mislead |
| | Suspicion | who, of whom, why | justification, testimony |
| | Loyalty | who, to whom, what they would do | justification |
| | Debt | debtor, creditor, what is owed | justification, leverage |
| | Grudge | who, against whom, origin | justification |
| | Shame | who, over what, how it shows | Conceal, Mislead |
| Evidence | Trace | event, bearer, what it shows, kind | sign |
| | Testimony | speaker, claim, basis (saw, heard, inferred) | sign |
| | Document | author, content, date, where kept | sign |
| | Record | keeper, entries, reliability | sign |
| | Confession | who, what, condition that triggers it | sign |
| | Dying message | who, fragment, what it meant | Fragment |
| | Absence | the expected event, the rule, what its absence implies | sign |
| | Alibi | subject, place, span, source, true or false, defeater | Mislead |
| Deception | Staged scene | stager, the false reading intended, the traces it leaves | Mislead |
| | Frame-up | framer, target, planted signs, the flaw that exposes it | Mislead |
| | Cover-up | who, the sign removed, moved or cleaned, what the act leaves | Conceal |
| | Forgery | forger, document, the tell | Mislead |
| | Planted evidence | who, what, where, the tell | Mislead |
| | Impersonation | impostor, the identity taken, the signs that differ | Mislead, Fragment |
| | Time trick | who, the altered time sign, the true time sign | Mislead |
| | Disguise | who, the description presented, the tell | Fragment |
| Structure | Decoy | second candidate, shared sign, discriminating sign | Fragment |
| | Red herring | suspect, innocent secret, how it looks like guilt | Mislead |
| | Accomplice | helper, their part, their reason | justification |
| | Conspiracy | members, shared intention, the coordination that shows | Mislead, Fragment |
| | Second crime | who, against whom, the belief that triggers it | act |
| | Closed circle | the set of people who could have done it, why no one else | Question |
| | Sealed place | the place, how it appears sealed, how it really was not | Mislead |
| | Hidden relationship | parties, relation, how it is concealed | Conceal |
| | Old wrong | the past event, who remembers, what it set in motion | justification |
| | Double bluff | who, the suspicion they invite, why it clears them | Mislead |
| | Unlikely culprit | who, the default that shields them, the defeater | Mislead |
| Adventure | Item | entity, where, who can take it | access |
| | Container | what, what it holds, how it opens | Conceal |
| | Lock and key | what is locked, the key, where the key is | Conceal |
| | Tool | the tool, what it lets you read or open | Fragment, Conceal |
| | Recipe | inputs, output, the rule that justifies it | Fragment |
| | Trade | who wants what, what they give | Conceal |
| | Favour | who asks, the task, the reward | Conceal |
| | Topic | who, the subject, the proposition you must know to raise it | Conceal |
| | Persuasion | who, what moves them (reassure, press, show), what they yield | Conceal |
| | Eavesdrop | speakers, place, time, what can be overheard | sign |
| | Search | place, what is hidden, what the search requires | Conceal |

Motive blocks are not operators: they are the required justifications that every other block cites. The
library is expected to grow; each new block earns its place by appearing in a real case and compiling
without kernel changes.

### 5.3 Validation feedback speaks the library

Kernel failures are translated back into block terms. The LLM hears "the false alibi from the sister has
no defeater" or "the key to the sea chest is never obtainable", not "precondition p17 unreachable". Models
repair far better when feedback uses their vocabulary.

## 6. The adventure layer

Player verbs are events with preconditions and effects: **go, examine, take, use X on Y, combine X with Y,
show or give X to someone, ask someone about a topic, choose a tone.** The setting supplies specific verbs
(rub, develop, decode, pour); the kernel supplies the generic ones.

| Mechanic | Comes from |
|---|---|
| Pick up an item | take: precondition that the item is reachable; effect that you hold it |
| Use an item on something | an event needing the item; it changes the world or reveals a sign |
| Combine items | an event justified by a rule (pencil and indented page give a readable impression) |
| Locked things | Conceal with an item precondition |
| Asking the right question | a Topic exists only once you know the proposition behind it |
| Getting someone to talk | their attitudes: what they know, trust, fear and want |
| Trades and favours | Conceal with a social precondition |
| Catching a lie | showing the sign that defeats a claim |
| Tone | emotion rules: pressing a frightened witness shuts them down; reassuring an ashamed one draws a confession |

Two consequences:

- **No moon logic.** Every combination must be justified by a rule, so every puzzle solution is something
  a thoughtful person could reason out — fair play applied to objects.
- **No dead ends.** Certification checks that no required item can be consumed or lost before it is
  needed, and that no combination shortcuts a key deduction.

## 7. Certification

| Check | Question | How it is computed |
|---|---|---|
| Possible | is the true history physically consistent? | interval and travel-time checks over events and places |
| Justified | does every intentional event and every block have its cause? | structural check: required attitudes exist and precede the events they cause |
| Solvable | can the answer be reached from the surface? | reachability over access preconditions (monotone: a found sign stays found) |
| Unique | does exactly one hypothesis survive? | filter hypotheses by every reachable, trusted sign using the fixed sign-kind semantics |
| Fair | is every rule and sign a conclusion needs obtainable? | reachability of each rule and premise; common-knowledge rules marked |
| Load-bearing | does every path to the answer pass through the key signs? | dominators in the access graph |
| Misleading | does the surface point elsewhere? | surface filter (misleading testimony trusted) excludes the truth; full filter leaves only the truth |
| No dead ends | can the player get stuck? | local check inside each non-monotone refinement (consumables, expiring signs) |
| Faithful prose | does each clue's text say no more and no less than its record? | extract the claim back from the generated text and compare it to the source record |

Access is monotone, so the core checks are linear-time graph and set operations regardless of how many
parallel threads a case has. A timed walkthrough ("can a player do this in reasonable time?") is kept as a
separate **playability** check, not the correctness oracle.

Checks are also **local**: because each refinement preserves its output, it can be certified when it is
applied — its output is reachable only through it, and it settles no parent question early — and the whole
case re-checked cheaply at the end.

## 8. Generation pipeline

1. **Setting.** The LLM proposes a setting ontology: places and links, entity kinds, event types with
   effects, domain rules. The kernel validates shapes and rule references.
2. **Question and cast.** A question type and a candidate set (a closed circle).
3. **Truth.** The culprit's motive and plan, written as events caused by attitudes, plus any cover-up.
4. **Trivial surface.** One sign that gives the answer away.
5. **Refine loop.** The LLM chooses a block, fills its slots and names its justification; the kernel
   compiles it, applies it, and certifies locally; failures come back in block vocabulary for repair.
   Repeat until the depth target is met.
6. **Realize prose** for signs, places and people from their records; run the faithful-prose check.
7. **Certify** the whole case. On repeated failure, fall back to a deterministic template case, as the
   current composers do.

## 9. Logic policy

Use formal logic only where it adds value that fixed code cannot, and where we cannot rely on the LLM to
infer accurately.

- **Now:** fixed code per sign kind, interval arithmetic, graph algorithms. The LLM never performs the
  inference the kernel depends on; it only chooses kinds and fills slots.
- **Keep Z3** for what it already does well: arithmetic over time and travel when constraints get dense.
- **Reach for answer set programming** (for example `clingo`) only if a real case needs eliminations the
  fixed sign kinds cannot express, or reasoning over many interacting defaults. That is the trigger, not a
  plan.

## 10. Five examples

Each example uses the same kernel, the same three operators and blocks from the same library. What changes
is the setting's domain rules, the question type and the attitudes driving the plot.

### 10.1 The Lighthouse at Gull Point (Cornwall, 1890s) — *who, and was it an accident?*

**Truth.** Tom, the assistant keeper, dims the lamp to signal smugglers (Gain). The keeper notices. Tom
pushes him from the gallery in a storm (Fear of exposure).

**Construction, one refinement at a time:**

1. Trivial surface: Tom's cap on the gallery.
2. **Staged scene** (Mislead). Default: a fall in a storm is an accident. Justification: Tom fears
   exposure and breaks a whisky bottle by the body. New sign: the bottle.
3. **Lie** (Mislead). Tom says the keeper drank. Defeater: the temperance pledge card in the keeper's Bible,
   and his wife's testimony.
4. **Record + Recipe** (Fragment). The lamp log shows trims at 1:10, 1:20, 1:30, meaningless until the
   domain rule "wicks are trimmed hourly" is learned from the keeper's manual (acquirable rule).
5. **Cover-up** (Conceal). Tom tears out the page and burns it. It leaves a stub; the pencil pressure left an
   impression on the page beneath. Combine: rub the pencil over the page.
6. **Topic + Persuasion** (Conceal). Who was he signalling? The lifeboat coxswain saw lights at sea but fears
   the smugglers. The topic exists only after the log is read; he talks once shown Tom's payment note
   (Lock and key: the key in the keeper's coat opens Tom's sea chest).
7. **Second crime** (act). If Tom comes to believe the coxswain has talked, he acts; the coxswain's boat is
   found adrift.

**Defaults defeated:** accident, truth-telling. **Shows:** a full recursive construction, where each layer
is a story beat and creates the next.

### 10.2 The Raku Bowl (Kyoto, 1920s) — *when was it stolen?*

**Truth.** No one stole it. A month ago the restorer's apprentice broke the bowl; out of love for the boy
(Protection), the restorer made a replica with a gold-seam repair.

- **Time trick** (Mislead). Default: it was stolen when last seen — at the tea gathering, where every guest
  becomes a suspect.
- **Document + Tool** (Fragment). An old photograph shows the seam; a jeweller's loupe reveals its pattern.
  Domain rule: every gold-seam repair is unique.
- **Shame + Persuasion** (Conceal). The photograph belongs to the apprentice, who avoids you; reassuring
  him draws a confession, pressing him shuts him down.
- **Red herring.** A guest's nervousness comes from a pawned heirloom of his own.

**Shows:** a "when" question, an answer of "no one", and kindness as the engine of both cover-up and
misdirection.

### 10.3 The Archivist of the *Anselm* (a generation ship, year 212) — *who is she, and why?*

**Truth.** The ship's archivist died forty years ago; her sister took her identity to keep the archive keys,
because the sealed records show the destination world is dead (Conviction: the truth would break the
crew).

- **Impersonation** (Mislead). Default: biometric records identify people. Domain rule: records were copied
  after the fire of year 171, and copying preserves whatever was in the file.
- **Trait** (Fragment). Pre-fire handwritten logs slant left-handed; the present archivist writes
  right-handed. Handedness only helps once you know which logs predate the fire.
- **Lock and key + Favour** (Conceal). The sealed records need two officers' keys; one officer trades hers
  for help with a quarrel, a small nested question.

**Shows:** an identity question, signs that refer to descriptions, a motive made of a belief and a
protective desire, and an ending that is a choice about what to reveal.

### 10.4 The Last Commit (a software company, present day) — *who wiped the customer database?*

**Truth.** The three founders did it together, each running one harmless step, to bury a fraud the data
would have exposed (Conspiracy, Fear of exposure).

- **Alibi ×3** (Mislead). Default: one change, one author. Each founder has a true alibi for the final step.
- **Absence** (sign). Domain rule: the deploy system normally announces every release in the team chat. It
  stayed silent because someone muted it an hour earlier.
- **Recipe** (Fragment). Three partial scripts, each harmless alone, destroy the data only when run in
  order; assembling the order is the deduction.

**Shows:** an answer that is a set of people, true alibis that still mislead, and an absence as the key
clue.

### 10.5 The Salt Road (a Saharan caravan, 1900s) — *what happened to the guide?*

**Truth.** The guide is alive. Owing a blood debt to a rival clan (Debt, Desperation), he faked his death in
a sandstorm with the help of a water-seller who loved his sister (Accomplice, Protection).

- **Staged scene** (Mislead). Default: a man lost in a sandstorm dies. His torn headcloth and a dead camel
  are found.
- **Trait + Recipe** (Fragment). The camel's hobble was cut, not torn; the cut matches a blade. Domain rule:
  guides never cut a hobble, they untie it.
- **Mistake** (Mislead). A boy swears he saw the guide walk into the storm; he saw the water-seller wearing
  the guide's cloak (Disguise).
- **Trade** (Conceal). The water-seller's ledger shows extra water sold the night of the storm, enough for
  two days alone; its owner shows it only in exchange for his debt being settled.
- **Old wrong.** The blood debt itself, remembered by an elder, is why anyone would want to vanish.

**Questions of the "what happened" kind.** Hypotheses are short alternative histories: died in the storm,
murdered by the rival clan, fled alive. Signs filter histories, not just people.

**Shows:** a victim who is not dead, a disguise behind an honest mistake, and hypotheses as whole
histories.

## 11. Relation to the current code

| Current | In this design |
|---|---|
| Event-log kernel, replay, save/load | kept as the play runtime |
| Typed claims, `primitives.mjs` constraint primitives | become the fixed sign-kind semantics |
| Discovery gates | Conceal |
| Bricks and depth operators | early, case-specific blocks and a partial Refine |
| Forensic enumeration (culprit × method × motive) | replaced by the general Question and hypotheses |
| Obligations in `casegen.mjs` | replaced by the certification table (section 7) |
| Bounded search as correctness oracle | demoted to a playability check |
| LLM composers with repair and fallback | kept; they now write blocks |
| Bellweather cast, map, weapons | become one setting among many |

## 12. Risks and open questions

- **Fun is not certifiable.** The kernel certifies fair, solvable, deep and misleading; elegance and pace
  need playtesting and LLM taste.
- **Prose leakage.** Clue text can say more than its record. The faithful-prose check is essential and its
  reliability needs measuring.
- **Sign-kind coverage.** The fixed kinds must cover real cases; a case that needs a new kind is the
  trigger to extend the kernel or revisit the logic policy.
- **Setting quality.** Domain rules proposed by the LLM must be plausible as well as well-formed; common
  sense about plausibility stays with the LLM, coherence stays with the kernel.
- **Non-monotone mechanics.** Consumables and expiring signs need step-by-step checks; keep them inside
  individual refinements.
- **Question as primitive or frame.** Kept as a frame here; it could be modelled as the player's desire to
  know.

## 13. Build plan

1. **Kernel records and sign kinds** as a standalone module with the certification checks, tested on one
   hand-written case in a new setting (the Lighthouse) to prove generality.
2. **Refine and the first blocks** (Alibi, Secret, Decoy, Staged scene, Cover-up, Lock and key, Recipe,
   Topic), each with a test that compiles and certifies.
3. **The remaining five examples** hand-built from blocks, as the library's acceptance suite.
4. **LLM authoring** over blocks, with feedback in block vocabulary and deterministic fallback.
5. **Adventure verbs and UI** (take, use, combine, give, tone, inventory) on the existing play runtime.
6. **Prose realization** with the faithful-prose check.

## 14. Experiment: the variant C harness (September 2026)

`tools/refine-c/refine.py` implements the loop: code picks the target and checks every step; Opus 5.5 writes
each story step; Sonnet 5 reviews plausibility. Offline checker tests: `tools/refine-c/test_refine.py`.
Outputs go to `tools/refine-c/runs/` (gitignored). Five briefs: liner, scriptorium, Antarctic station,
film studio, lighthouse.

| Run | Change | Outcome |
|---|---|---|
| 1 | first loop | 4/5 certified, solve depth 2–4; one seed never passed timing checks |
| 2 | thread targeting + progress law | 5/5 certified at depth 5–6; culprit found only by elimination |
| 3 | motive + means obligations | 5/5 met every target (depth 5, twist, herring, motive, means); ~10 min/case |
| 4 | plausibility critic, unlock/reading reasons | 5/5 certified; critic caught real contradictions; ~27 min/case; two cases lost their twist |
| 5–6 | twist-preservation law; speed work (cached prompts, Sonnet critic, code checks for common critic failures, parallel candidates, richer seed) | stopped early; the richer seed became the bottleneck (~4 min, frequent malformed JSON) |

Findings:
- The loop works: code-controlled targeting plus LLM story steps reliably reaches depth 5+ with a certified
  twist, red herring, motive and means, and every layer carries a stated in-world reason.
- The thread model (each innocent's clearance and the truth's survival as separate depths) is what made
  depth grow; targeting individual signs did not.
- The critic is necessary: about 40% of code-valid steps had common-sense problems code cannot see. Many are
  mechanical (spoken times vs the timeline, a trace placed away from its source) and moved into code.
- Open: seed reliability and time. Next options: keep the trivial seed (reliable) and parallelize steps, or
  split the rich seed into smaller calls; use a JSON-schema tool call instead of free-form JSON.

## 15. Migration plan

The new model is built alongside the current engine and compiled into the case interface the engine already
consumes, so the UI, event log, saves and character system keep working while the old generation path is
retired piece by piece. The suite stays green at every phase.

### Decisions

- **Languages.** The kernel is JavaScript (`dist/mk/`): one implementation of sign semantics serves both
  generation-time certification and play-time grading in the zero-build browser app. Generation
  orchestration stays Python (`tools/refine-c/`: boto3, parallel calls, retries), next to the existing
  Python LLM proxy and Z3 server. The bridge is `tools/mk-certify.mjs`.
- **Parity until one checker remains.** The harness still carries a Python mirror of the checker for its
  scheduler; `tools/refine-c/parity.py` certifies every generated case with both and must report zero
  mismatches. The mirror goes away when the scheduler moves onto the JS kernel.
- **Saves store full case records** rather than a regeneration seed, so LLM-authored cases survive reload.
- **The Last Bell** stays as a legacy authored case until porting it is worth the effort.

### Phases

| # | Phase | Status |
|---|---|---|
| 1 | Kernel core in JS: records, sign kinds, certification (`dist/mk/kernel.mjs`), CLI bridge, unit tests | **done**: 12 tests; parity with the Python checker on 296 generated cases, 0 mismatches |
| 2 | Blocks and Refine as library code; the five examples as an acceptance suite | open: blocks are prompt vocabulary checked by the kernel, not yet code |
| 3 | Decouple engine and UI from Bellweather | **partial**: topics, suspects, accusation fields and briefing come from the case; last-bell/seal/folio special cases remain |
| 4 | Bridge: kernel case → runtime case (`cases/kernel-case.mjs`). **Milestone: a generated case is playable in today's UI** | **done**: five certified Bellweather cases (depth 4–7) play end to end; saves carry records |
| 5 | Adventure verbs: take, use, combine, give, tone; inventory; dead-end check | |
| 6 | LLM authoring over blocks in production: the harness loop behind the proxy, faithful-prose check | |
| 7 | Port Bellweather as one setting; retire bricks, depth artifact, forensic enumeration, old obligations; search becomes a playability check | |

### Risks

- Characters are the deepest coupling: personas and character turns are built around authored accounts.
  Early kernel cases can use simpler characters that answer from their testimony and attitudes.
- The UI's Bellweather assumptions may be wider than the known list; phase 3 will tell.
- New settings have no art; text fallback works but looks sparse.

## 16. Playing generated cases (implemented)

Generation runs in a **fixed setting**: `tools/extract-setting.mjs` exports Bellweather's places, real walking times and
cast identities and voices (not their secrets) to `tools/refine-c/settings/bellweather.json`. The harness (`--setting
bellweather`) locks places, links and identities by construction and rejects invented people, while the model invents
every object, document, secret, relationship and motive. `tools/refine-c/publish.py` picks the deepest case per brief
that the JS kernel certifies, adds player-facing questions and each suspect's evening account, and writes
`dist/cases/generated/`.

`dist/cases/kernel-case.mjs` compiles a case into the runtime interface:

| Case record | In play |
|---|---|
| true-history events | executed before the morning; everyone present remembers them (memories for character turns) |
| attitudes | each character's beliefs, goals and fears, sourced to the events they caused |
| non-testimony signs | inspectable objects in their room; `requires` keeps them hidden until earned |
| gated leads | open only at their own location, with the case's `unlock` text; elsewhere the journal points you there |
| `needs` | "You put it together" shows the case's `reading` once the prerequisite is in the notebook |
| testimony | accounts a character can give once earned; false ones are flagged deceptive so the character lies in character |
| surface accounts | every suspect's vague evening account (the culprit's false), so "where were you?" always has an answer; claimless, so certification is unchanged |
| presenting evidence | a defeater forces a concession (remembered, so the lie is not repeated); the innocent explanation of a herring draws out the secret; a prerequisite opens the account; otherwise a stance by relation (witnessed it, wasn't there, culprit deflects) |
| accusation | the kernel filters candidates using only the evidence the player holds |

Free-text dialogue uses the existing character pipeline unchanged: the model chooses among the character's available
accounts and phrases one in their voice; validation and an independent critic reject invented facts. Bell briefs the
detective from the case frame and navigation only.

The admission guard (which re-runs the bounded investigation search after each action) accepts kernel cases on their
certificate: evidence access is monotone and no character plan can move or destroy evidence, so solvability cannot be
lost during play. Cases with non-monotone mechanics will need the step check again.

Tests: `tests/mk-kernel.test.mjs` (kernel), `tests/kernel-case.test.mjs` (every published case certifies, starts gated,
is solved only by the truth, rejects every wrong suspect, and survives save/reload), a UI test for the chooser and
accusation form, and `tools/refine-c/parity.py` (Python and JS checkers agree on every generated case).

Known gaps: characters know only what the case records (no public facts of the morning, thin reactions to evidence
that does not concern them); no take/use/combine verbs; no art for new objects; generation takes about 8–10 minutes per
case; the question is always "who".

### On-demand generation and hints

`server/generator_server.py` (loopback, port 8789; exact Origin/Host and an `X-Living-Mystery: generator-v1` header)
runs one generation at a time with the harness in Bellweather mode and streams progress events: the first draft of
the case, then each layer with its story, blocks, the records it added, rejected candidates and review verdicts, and
the certification metrics. The UI polls it, shows a high-level progress view, and keeps the full story in a collapsed
spoiler section. On completion the case is published to `dist/cases/generated/live/` (JS-certified again) and played.

Conversation topics never reveal an account's content: a character's ungated accounts come one at a time through the
night question and "anything else?", and an account earned by a clue is asked about in terms of that clue. Every
character has a claimless evening account.

Hints (`hints()` in the bridge) pick the shallowest thing the player can do next — an account someone will now give,
an object to examine, a lead that points elsewhere, or the accusation — and phrase it at three levels: a nudge, a
clue, and the plain answer.

### Play-time refinements (September 2026)

- **Showing evidence.** Each clue carries a spoken `show` line written at publish time (a third-person line for accounts
  and behaviour, which names the speaker or subject) and a `confront` line said to that person. Characters involved in a
  clue get a written `reactions[person]`. Fallbacks are templates by clue kind and by the listener's relation (took part,
  subject, was at that place, uninvolved; the culprit deflects).
- **Concessions.** A false account the speaker believed is conceded as a mistake; one given to protect someone as a lie.
- **The doctor's examination.** Every case gets examination notes and an account from Dr Marsh: cause of death in general
  terms and the time window the certification already assumes (so depth and verdicts are unchanged). Spoken times are
  written by code.
- **Observable traits.** Traits that clues test (shoe size, handedness) are shown in each person's public description.
- **Stationary people.** Generated cases disable the wandering routines; everyone keeps to their own place, and the
  notebook says where each person is usually found.
- **Free-text dialogue.** A question may draw on every account the character can give now; a character's own observed
  behaviour can be put to them. After two rejected replies, a guarded third attempt keeps untold memories private in
  character; the rejection message says why in story terms.
- **Inspector.** The canonical crime history is every true event in order, with the culprit, time and motive.
- **Debugging.** The browser logs actions, dialogue turns (with audit detail), toasts, generation events and errors to
  `logs/game.log` via the game server; the generator and proxy log to `logs/generator.log` and `logs/proxy.log`.
  Menu → Flag an issue saves a note with a snapshot of the game state.


### Motive, means, opportunity and variety (September 2026)

- `certify` reports `pillars` {opportunity, means, motive} with depths and requires means and motive to be reachable
  (`certify(case, false)` skips that for intermediate generation steps). `pillarSignsFor(case, A, actor, held)` gives a
  person's means and motive evidence among the held signs; the accusation uses it.
- **The history is the only source of facts.** Each account is backed by the history (`account_backing`: a source
  event with the speaker, being present at that place and time, a claim about themselves, or a 'knows' attitude cited in
  'because'); unbacked accounts fail certification at publish. Generation writes the discovery and examination as typed
  events by the setting's roles; publishing only words them. In play, a clue from someone's own doing (same source event)
  draws their own account; other replies are worked out from the history, with one neutral line when nothing applies.
  People the history never mentions are not in the case, and everyone it involves has an evening (`premise.involved`,
  one definition for the cast and the generation rule).
- **What people can say.** Each person has an evening summary (from their evening events only) and, if they did
  something this morning, a morning summary (from their own morning events that are not evidence, plus the discovery
  and the examination). Both are claimless, backed by the speaker's own events, and marked honest or a cover story by a
  reviewer that gives its reason; an innocent's account that is not honest is rewritten with that reason, then dropped.
  "Last night" questions never give the morning summary; every other account has its own question or comes with
  "anything else". A question already answered is answered "As I told you: …", or with what was admitted once a story
  has fallen.
- **The fact-checker** compares a reply with the selected account and everything the character can say (their true
  accounts, and the stories they tell). It allows restating any of them, what an account plainly implies, and, with
  nothing to go on, saying "I don't know" or asking back; it rejects invented facts, names nobody has mentioned (role
  words and a shown clue's title and subject count as mentions), and contradictions of their own accounts. It knows the
  game time, so "quarter to seven" is this morning. The accusation accepts every method and motive the held
  evidence fairly supports (`answer.methods`, `answer.motives`).
- Motive evidence must connect the culprit and the victim (a relation with the victim on either side); a secret about
  the culprit alone is not a motive. `enrich.add_motive_link` adds one true, deeper clue when a case lacks the link.
- `server/case_oracle.py` is an independent Z3 check; `publish.gate` requires Python, JavaScript and Z3 to agree.
- `tools/refine-c/premise.py` draws who, how, why and where; `seed_errors` rejects a seed that does not honour it.
- Publishing (`publish.enrich_case`): questions, evening accounts (checked against the true history), the examination
  (by crime kind), the answer, concessions (`concede[clue]`), loose ends, everyday knowledge (`knowledge[pid]`, free-text
  topic `everyday`), moods, show lines and reactions, then `enrich.review_publish`.
- Play: a completing clue delivers the account; proof draws a concession; people are where their behaviour is seen;
  hints never endorse a lead that rests on a false account; the ending gives the full chain of motive.
