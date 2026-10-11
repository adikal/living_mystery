# 12. A worked example: knowledge and reasoning in one case

Status: **Implemented.** Every record, refusal and solver result below is taken from the case *Death Among the Orchids* (`mk-live-20261003-085134`), from the generator's log of 3 October 2026 and from a play-through of 10 October 2026. Nothing has been simplified except that minutes are also given as clock times.

## 12.1 Overview

In this chapter we follow one case through its whole life: first as it is written, and then as it is played. The aim is to make concrete three things that the earlier chapters describe in general: how the game world is represented, which component reasons over which part of it, and what happens when a language model proposes something that the representation does not allow.

The design rests on a single principle. A case is one true history, and that history is the only source of facts. Language models do most of the authoring and all of the acting: they write the events, the motives and the clues, voice every character, and decide what people do during the morning. They never decide what is true or whether the case can still be solved. Those questions are answered by code over the history: a kernel of plain algorithms, which runs everywhere, and an independent encoding in the Z3 SMT solver, which must agree with it. A second model is used only where code cannot judge, for wording and commonsense. We refer to code, the second model and the kernel together as the *critics*.

![Figure 13. Knowledge and reasoning in one case. At design time (top) Opus proposes a refinement of the case; the kernel certifies the result and checks the refinement laws, and a refused proposal is sent back with the reasons; Sonnet then reviews the beat for plausibility; at the end the Python kernel, the JavaScript kernel and Z3 must all certify the case. At run time (bottom) the director, a character or the player proposes; code, a model and the kernel or Z3 decide. Both phases read their facts from, and write only accepted changes to, the one true history.](figures/worked-example.svg)

## 12.2 The case

Bellweather, an English village, in 1932. Ada Finch, the landlady of the Rook & Lantern, is found dead in the greenhouse beside the overturned potting steps. It looks like a fall. In truth Silas Voss, the solicitor, had embezzled £400 she lodged with him; she found out, and at 22:35 he struck her head against the iron staging so that it would pass for a fall. He had already left a draft on his desk in the vestry with times pencilled through the evening, and afterwards asked his friend the vicar to say he never left it.

Four people are in question: Dorothy Pruett (the postmistress), Rowan Pike (the gardener), Silas Voss and Vera Lacey (a lodger at the inn). The case has 9 people, 10 places, 42 events, 36 attitudes and 45 signs. The player solved it by accusing Silas Voss of a blow to the head for money.

## 12.3 The representation

A case is four kinds of record and a question. The kinds are deliberately few, so that every later check can be written once for any case.

- **Entities.** People and places come from the setting: each person has a name, a form of address, a role and a home; each place has walking times to its neighbours (the vestry to the greenhouse is 11 minutes).
- **Events.** Who did what, where, from when to when, and why. The *why* is a reference to an attitude.
- **Attitudes.** What a person intends, wants, fears or believes. They are the motives of the events, and the reasons for any lie.
- **Signs.** The clues: anything the player can examine or be told. A sign records how it is reached (`requires`), what else it needs in order to be understood (`needs`), what it claims, and which other signs it defeats.

The question names the candidates, the true answer, and the crime's place and time window. Below are real records from the case; times are minutes after midnight on the first day (1345 is 22:25).

```json
event    { "id": "e_crime", "agent": "silas", "place": "greenhouse", "start": 1355, "end": 1365,
           "summary": "Silas strikes Ada's head against the iron staging so it will pass for a fall.",
           "causedBy": "a_silas_intends" }
event    { "id": "e_silas_square", "agent": "silas", "place": "square", "start": 1387, "end": 1390,
           "summary": "Silas hurries across the square from the Manor lane, back toward the vestry …" }
attitude { "id": "a_vicar_loyal", "agent": "vicar", "mode": "wants",
           "content": "Protect his old friend Silas from gossip by saying he was at his desk all evening." }
sign     { "id": "s_draft", "kind": "document",
           "claim": { "kind": "place", "person": "silas", "place": "vestry", "start": 1320, "end": 1395 } }
sign     { "id": "s_vicar_t", "kind": "testimony", "speaker": "vicar", "requires": ["s_silas_t"],
           "claim": { "kind": "place", "person": "silas", "place": "vestry", "start": 1320, "end": 1420 },
           "because": ["a_vicar_loyal", "a_vicar_believes"] }
sign     { "id": "s_dora_sight", "kind": "testimony", "speaker": "dora", "requires": ["s_vicar_t"],
           "claim": { "kind": "place", "person": "silas", "place": "square", "start": 1387, "end": 1390 },
           "defeats": ["s_vicar_t", "s_draft"], "source": "e_dora_square" }
question { "text": "Who killed Ada Finch?", "truth": "c_silas",
           "candidates": ["c_dora", "c_rowan", "c_silas", "c_vera"],
           "crime": { "event": "e_crime", "place": "greenhouse", "window": [1345, 1385] } }
```

A sign carries at most one *claim*: a single, atomic statement of fact. Each claim is an instance of one of eight predicates, with fixed arguments. Times appear as arguments (a whereabouts claim has an interval), so one claim can mention a person, a place and a span of time together. The record's `kind` field names the predicate's family; two families have a second form in which the culprit, unnamed, is the subject.

| Predicate | Record | Meaning | When trusted, it… |
| --- | --- | --- | --- |
| `wasAt(person, place, from, to)` | `place` | the person was at the place throughout [from, to] | is an alibi: rules the person out if they could not reach the scene at any minute of the crime window |
| `crimeBetween(from, to)` | `time` | the crime happened within [from, to] | narrows the crime window for every candidate |
| `culpritTrait(trait, value)` | `trait` | the culprit has the trait (e.g. left-handed) | rules out candidates without it |
| `holds(person, item)` | `possession` with a person | the person has the item | establishes who has it; rules no one out |
| `culpritHolds(item)` | `possession` with no person | whoever did it had the item | rules out candidates who did not have it (evidence of means) |
| `related(a, rel, b)` | `relation` with `a` | a stands in that relation to b (e.g. embezzled from) | establishes a fact (with the culprit as a, evidence of motive); rules no one out |
| `culpritRelated(rel, b)` | `relation` with no `a` | the culprit stands in that relation to b | rules out candidates who do not |
| `crimeFact(key, value)` | `fact` | a fact of the crime itself (e.g. the method) | rules out candidates whose account of the crime differs |

For example, the faked draft is `wasAt(silas, vestry, 22:00, 23:15)`, Miss Pruett's sighting is `wasAt(silas, square, 23:07, 23:10)`, the lure note on vestry paper is `culpritHolds(vestry_paper)`, and the building society's letter is `related(silas, embezzled_from, ada)`. Of the 45 signs in this case, 13 carry a claim: seven `wasAt`, two `crimeBetween`, two possession claims and two relation claims. The others (a behaviour, an absence, a trace) matter through what they unlock, need or defeat.

A clue that says two things is recorded as two signs, each with one claim. The reason is defeat: when one sign defeats another, the whole defeated sign stops being trusted, so a sign that mixed a false whereabouts with a true relation would lose its true part with its false one. One claim per sign keeps defeat, the solver's tracked constraints and the agreement between the two kernels simple; the cost is that the generator and publishing must split compound statements.

Note that no record states whether a claim is true; the kernel decides it. For `wasAt` and `crimeBetween` it is computed from the events: the vicar's claim that Silas was in the vestry from 22:00 to 23:40 is false because the events place Silas in the greenhouse at 22:35 and in the square at 23:07. A false sign must cite an attitude of its speaker that explains it (here `a_vicar_loyal`: he wants to protect his friend); a false physical sign must come from a deliberate event (here the draft, written by Silas so that "his own papers seem to show him at work"). The other six predicates are judged against tables the case declares: who holds which item, the relations between people, each person's traits, and each candidate's facts of the crime. The generator writes those tables and the certifier checks them for consistency, but they are not yet derived from the events (see the limits in 12.7).

## 12.4 What reasons over it

Three components reason over the records, and each has its own job.

**The kernel** (`dist/mk/kernel.mjs`, with the same functions in Python in `tools/refine-c/refine.py`; a parity check runs both over 443 cases and requires them to agree). Its functions are plain algorithms:

```text
analyse(C)                  → reachable signs   (a fixed point over requires)
                              understood signs  (every sign it needs, and every rule it needs, is known)
                              truthval(s)       (the claim compared with the events)
                              eff(s)            (the depth at which s can be understood)
survivors(C, A, d)          → the candidates not ruled out by the trusted claims understood at depth ≤ d
certify(C)                  → ok, solve depth, surface survivors, false signs, motive, means, opportunity
```

A claim is *trusted* if it is understood and no other understood sign defeats it. A trusted `wasAt` claim is an alibi: a candidate is ruled out if, at every minute of the crime window, a trusted claim puts them elsewhere, widened by the walk to the scene (`opportunityEliminated`). A trusted `culpritTrait`, `culpritHolds`, `culpritRelated` or `crimeFact` claim rules out a candidate whose facts contradict it (`eliminates`); `holds` and `related` establish facts about a named person and rule no one out. Motive is shown by a trusted `related` claim with the culprit as its subject (or a `crimeFact` about the motive); means by a culprit-centric claim that rules out an innocent. The *surface* is what the player can understand before following any lead (depth 0), and the *solve depth* is the depth at which only the truth survives.

**Z3** (`server/case_oracle.py`). The oracle re-derives the same semantics independently of the kernel's code, so that a shared bug in both kernels shows up as a disagreement. It answers two questions. First, `feasible(C)`: is the true history physically possible (one place at a time, travel takes time, the crime inside its window)? Second, `candidates(C, held)`: given only the evidence held, which candidates could still have done it? For each candidate it asserts the crime minute `t` inside the window, and one tracked constraint per trusted claim. An unsatisfiable result comes with an *unsat core*, i.e. the claims that together rule the candidate out; a satisfiable one comes with a witness minute, which is an alternative story ("could have been there at 22:25"). The alibi constraint for a place claim is:

```text
t ∈ [w₀, w₁]                                             crime window
claim: wasAt(person, p, s, e), walk g from p to the scene
       ⇒  t < s − g  ∨  t > e + g                        tracked under the claim's id
claim: crimeBetween(s, e)  ⇒  s ≤ t ≤ e
```

**Model critics.** A second model checks what code cannot: whether a refinement is plausible for these people (at design time), whether a character's reply adds a fact that its account does not give, and whether what one person tells another in the morning rests only on what they know (at run time). Their verdicts carry a reason, which is sent back to the proposer.

## 12.5 At design time: writing the vicar's false alibi

The generator builds a case in layers. Code chooses, at each step, which operator to apply and to what: *Conceal* (hide a sign behind another), *Fragment* (split a sign into parts that must be put together) or *Mislead* (add a false account that the evidence later defeats). It always deepens the shallowest thread, i.e. the suspect who is cleared earliest. Opus writes the beat as a patch to the records; the kernel certifies the patched case and checks the refinement laws; Sonnet reviews the beat for plausibility. A refused patch is sent back with the reasons, and Opus tries again.

For this case the generator ran 15 layers in about 19 minutes and accepted 13; code refused 26 drafts along the way. The seed (the first draft of the history, also written by Opus and certified) already contained the vicar's false alibi, but only as an answer to a later question (it requires the solicitor's own account), so at the surface Silas was still a suspect. We follow step 2, a *Mislead* aimed at the truth: the twist that keeps Silas out of suspicion at first.

1. **Opus's first patch is refused.** The kernel certifies the patched case and computes its surface survivors: Dora, Rowan, Silas and Vera. The twist law requires that the deception exclude the truth at the surface, so the patch is refused with the reason: "the surface still admits the truth (surface survivors ['c_dora', 'c_rowan', 'c_silas', 'c_vera']); the deception must exclude it".
2. **The second is refused for the same reason, and one more:** "no story beat: every refinement must add the event or attitude that causes it (who did what, and why)". A deception with no cause in the history is not allowed, because the player could never work out why it exists.
3. **The third patch is accepted.** It adds the draft with pencilled times (`s_draft`, a document claiming `wasAt(silas, vestry, 22:00, 23:15)`), the event that produced it, and the attitude behind it: "Leave a draft marked with times through the late evening, so his own papers seem to show he never left his desk." The draft is on the desk from the start, so it is part of the surface. The kernel certifies the result: the surface survivors are now Dora, Rowan and Vera, so the twist holds; the draft is a false sign produced by a deliberate event, and it has a true defeater deeper in the case. Sonnet then reviews the beat, and it is accepted.

In Z3's terms, the draft alone now rules Silas out. With the crime window 22:25 to 23:05 and an 11-minute walk from the vestry:

```text
t ∈ [1345, 1385]
s_draft: wasAt(silas, vestry, 1320, 1395)   ⇒   t < 1309 ∨ t > 1406
→ unsat; core [s_draft]
```

Code checks more than the laws. In step 11, a draft that had Constable Bell walk from the inn to the square in one minute was refused as physically impossible ("bell cannot travel inn->square in 1 min (needs 3)").

Before the case could be published, all three certifiers had to agree on the finished case. The kernel's certificate:

| Property | Value |
| --- | --- |
| Solve depth | 8 (Vera's thread is the deepest; Dora and Rowan are cleared at 5, the truth survives from 6) |
| Surface survivors | Dora, Rowan, Vera (the truth is hidden at first) |
| False signs | `s_draft`, `s_vicar_t`, each with a true defeater deeper than it |
| Key signs | `s_dora_sight`, `s_note` |
| Motive, means, opportunity | reachable at depths 4, 8 and 8 |

Z3's publish check found the true history feasible, and with all reachable evidence only Silas survives; the others are ruled out with the cores Dora `[s_note]`, Rowan `[s_bell]`, Vera `[s_note]`. Note that an unsat core is one sufficient reason, not the only one: Dora is also ruled out by the doctor's daybook, which puts her in the surgery from 22:10 to 23:04.

## 12.6 At run time: a play-through

The same records drive the game. Four kinds of proposal reach the history during play, and each is checked before it is committed.

**A concealment refused by the kernel (08:44).** Every quarter of an hour, the morning director (a model) plans what the people the investigation affects will do. At 08:44 it planned for the vicar, who wants to protect Silas, to hide the older sheet of blotting paper in the vestry. The code critic (place, time, what the vicar knows, and nobody hiding anything in front of the detective or the constable) accepted the plan. The kernel then certified the case as it would stand without that clue, and refused: "false sign s_draft has no reachable, true defeater deeper than it". Without the blotter the player could never show that the draft was faked, so the concealment, and the vicar's later steps, were cut. At 09:42 the director planned for Rowan to hide the label on the orchid crate; the kernel found the case "still solvable" without it, and the concealment went ahead.

**A line refused by the line critic (10:19).** The director planned for Vera to seek out Dorothy Pruett about her visit to the surgery. The line critic (a model) refused what Vera was to say: "Vera has no knowledge that Dorothy was at Dr Marsh's surgery or injured her hand - this fact is not in her listed knowledge". Whatever one person tells another may later reach the detective, so it must rest only on what the speaker knows.

**A reply refused by code, and one refused by the fact-checker.** Each free-text question is answered by a model speaking as the character, from the accounts the history allows that character to give; each reply is checked by code and then by a second model before it is spoken. When the player asked Constable Bell "what time did you play dominoes and who did you play with?", the first reply was refused by code because it gave a time ("half nine") that no account gives Bell. That reply also said Bell had played with Silas Voss, which is false (he played with Rowan Pike) and would have handed the culprit an alibi; the second reply, which declined to name anyone, passed. When the player asked Vera whether she had seen anyone, the fact-checker refused a reply that added "Ada came up the stairs with her keys jangling", since her account says only that she saw Ada at the inn at quarter past nine.

**The accusation, checked by Z3 (15:37).** The player accused Silas Voss, holding 40 clues. The constable's check runs the oracle over the trusted claims among them. Miss Pruett's sighting of Silas in the square at 23:07 defeats both the vicar's alibi and the draft, so neither is trusted, and:

```text
c_dora   unsat   core [s_note]        culpritHolds(vestry_paper): only Silas and the vicar hold it
c_rowan  unsat   core [s_bell]        wasAt(rowan, inn, 21:40, 23:45), six minutes from the scene
c_vera   unsat   core [s_note]
c_silas  sat     t = 1345 (22:25)     could have been in the greenhouse at 22:25
```

Only Silas survives, and the player's evidence also shows the motive, `related(silas, embezzled_from, ada)`, and the means, so the charge was accepted. The same query without the sighting shows why that clue is the key:

```text
c_silas  unsat   core [s_vicar_t]     the vicar's alibi is trusted again and rules Silas out
… and every other candidate unsat as well
```

Holding everything but the sighting, the player's evidence rules out everyone. This is what the constable reports in that situation: "Your evidence rules out everyone, including the person you accuse. One of the accounts you are relying on must be false."

## 12.7 Discussion

The example shows the division of labour on which the design rests. The models proposed everything in this chapter: the lie, the draft, the concealments, the lines, the replies. None of it entered the history until code had checked what can be checked mechanically, a second model had checked the wording, and the kernel (with Z3 at publication and at the accusation) had checked that the case stayed solvable with one answer.

Three limits are worth stating. First, the model critics are fallible: in the same play the fact-checker passed a reply in which the vicar said the vestry study was Silas's and not his, after saying earlier that it was his study. The guarantee about solvability is computed; the guarantee about what characters say is only as good as the fact-checker, and a check of the claims extracted from each reply against the records would make it symmetric. Second, an unsat core explains one reason a candidate is ruled out, not every reason; the constable's feedback names only evidence the player holds, so it can differ from the core while remaining correct. Third, the predicates leave out context that the events have. Possession, relations and traits carry no time (Silas takes the passbook only after the crime, yet the possession table says simply that he holds it), and a kind of item (vestry paper, which anyone in the vestry can use) is held in the same way as a single object (the passbook). `wasAt` is weaker than its reading: it holds if the person was at the place at some point in the interval and nowhere else, so minutes the events do not cover count in its favour. `crimeFact` is compared with the candidates' declared facts, not with the crime event. Deriving possession, relations and changing traits from events (who gives, takes or uses what, and when) would make every claim's truth computed from the history.
