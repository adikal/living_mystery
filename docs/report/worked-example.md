# 12. A worked example: knowledge and reasoning in one case

Status: **Implemented.** Every record, refusal and solver result below is taken from the case *Death Among the Orchids* (`mk-live-20261003-085134`), from the generator's log of 3 October 2026 and from a play-through of 10 October 2026. Nothing has been simplified except that minutes are also given as clock times. The case was written and played with the first version of the claim language; the records and solver results below are those of the case after its migration to version 2 (the claims specification, `docs/claims.md`), which left its certificate unchanged.

## 12.1 Overview

In this chapter we follow one case through its whole life: first as it is written, and then as it is played. The aim is to make concrete three things that the earlier chapters describe in general: how the game world is represented, which component reasons over which part of it, and what happens when a language model proposes something that the representation does not allow.

The design rests on a single principle. A case is one true history, and that history is the only source of facts. Language models do most of the authoring and all of the acting: they write the events, the motives and the clues, voice every character, and decide what people do during the morning. They never decide what is true or whether the case can still be solved. Those questions are answered by code over the history: an independent encoding in the Z3 SMT solver, which is the reference definition of who could have done it, and a kernel of plain algorithms, which runs everywhere and must agree with Z3 on every suspect. Whether a claim is true is computed from the history; who could have done it is computed only from what the player knows. A second model is used only where code cannot judge, for wording and commonsense. We refer to code, the second model and the kernel together as the *critics*.

![Figure 13. Knowledge and reasoning in one case. At design time (top) Opus proposes a refinement of the case; the kernel certifies the result and checks the refinement laws, and a refused proposal is sent back with the reasons; Sonnet then reviews the beat for plausibility; at the end the Python kernel, the JavaScript kernel and Z3 must all certify the case. At run time (bottom) the director, a character or the player proposes; code, a model and the kernel or Z3 decide. Both phases read their facts from, and write only accepted changes to, the one true history.](figures/worked-example.svg)

## 12.2 The case

Bellweather, an English village, in 1932. Ada Finch, the landlady of the Rook & Lantern, is found dead in the greenhouse beside the overturned potting steps. It looks like a fall. In truth Silas Voss, the solicitor, had embezzled £400 she lodged with him; she found out, and at 22:35 he struck her head against the iron staging so that it would pass for a fall. He had already left a draft on his desk in the vestry with times pencilled through the evening, and afterwards asked his friend the vicar to say he never left it.

Four people are in question: Dorothy Pruett (the postmistress), Rowan Pike (the gardener), Silas Voss and Vera Lacey (a lodger at the inn). The case has 9 people, 10 places, 42 events, 36 attitudes and 45 signs. The player solved it by accusing Silas Voss of a blow to the head for money.

## 12.3 The representation

A case is four kinds of record and a question. The kinds are deliberately few, so that every later check can be written once for any case.

- **Entities.** People, places and objects come from the setting: each person has a name, a form of address, a role and a home; each place has walking times to its neighbours (the vestry to the greenhouse is 11 minutes); an object is a single thing (the passbook) or a supply many may have (the vestry's letter paper).
- **Events.** Who did what, where, from when to when, and why. The *why* is a reference to an attitude. An event may also have *effects*: someone takes, gives or loses an object, enters a relation, or acquires a trait (a scalded hand).
- **Attitudes.** What a person intends, wants, fears or believes. They are the motives of the events, and the reasons for any lie.
- **Signs.** The clues: anything the player can examine or be told. A sign records how it is reached (`requires`), what else it needs in order to be understood (`needs`), what it claims, and which other signs it defeats. A *public* sign is what everyone in the village knows; the player holds it from the start.

The question names the candidates, the true answer, and the crime's place and time window. Below are real records from the case; times are minutes after midnight on the first day (1345 is 22:25).

```json
event    { "id": "e_crime", "agent": "silas", "place": "greenhouse", "start": 1355, "end": 1365,
           "summary": "Silas strikes Ada's head against the iron staging so it will pass for a fall.",
           "causedBy": "a_silas_intends", "facts": { "method": "blow", "motive": "money" } }
event    { "id": "e_silas_square", "agent": "silas", "place": "square", "start": 1387, "end": 1390,
           "summary": "Silas hurries across the square from the Manor lane, back toward the vestry …" }
attitude { "id": "a_vicar_loyal", "agent": "vicar", "mode": "wants",
           "content": "Protect his old friend Silas from gossip by saying he was at his desk all evening." }
sign     { "id": "s_draft", "kind": "document",
           "claim": { "pred": "wasAt", "person": "silas", "place": "vestry", "from": 1320, "to": 1395 } }
sign     { "id": "s_vicar_t", "kind": "testimony", "speaker": "vicar", "requires": ["s_silas_t"],
           "claim": { "pred": "wasAt", "person": "silas", "place": "vestry", "from": 1320, "to": 1420 },
           "because": ["a_vicar_loyal", "a_vicar_believes"] }
sign     { "id": "s_dora_sight", "kind": "testimony", "speaker": "dora", "requires": ["s_vicar_t"],
           "claim": { "pred": "wasAt", "person": "silas", "place": "square", "from": 1387, "to": 1390 },
           "defeats": ["s_vicar_t", "s_draft"], "source": "e_dora_square" }
sign     { "id": "s_note", "kind": "item", "requires": ["s_iris_doubt"],
           "claim": { "pred": "culpritHad", "item": "vestry_paper" } }
sign     { "id": "pub_holders_vestry_paper", "kind": "public",
           "text": "Only Silas Voss and the Reverend Thomas Hale had vestry letter paper.",
           "claim": { "pred": "onlyHad", "item": "vestry_paper", "people": ["silas", "vicar"] } }
question { "text": "Who killed Ada Finch?", "truth": "c_silas",
           "candidates": ["c_dora", "c_rowan", "c_silas", "c_vera"],
           "crime": { "event": "e_crime", "place": "greenhouse", "window": [1345, 1385] } }
```

A sign carries at most one *claim*: a single, atomic statement of fact. A claim is an instance of one of eleven predicates. Seven are about named people, places and objects, and four about the crime and its culprit, who is unnamed:

| Predicate | Meaning |
| --- | --- |
| `wasAt(person, place, from, to, when)` | the person was at the place `throughout` [from, to], at some minute of it (`sometime`) or at no minute of it (`never`) |
| `nobodyAt(place, from, to)` | no one was at the place throughout [from, to] |
| `had(person, item, from, to, when)` | the person had the item (in the same three modes) |
| `onlyHad(item, people, from, to)` | no one outside the list had the item |
| `related(a, rel, b, when)` | a stands in the relation to b (e.g. embezzled from) |
| `hasTrait(person, trait, value, from, to, when)` | the person has the trait (e.g. left-handed) |
| `crimeBetween(from, to)` | the crime happened within [from, to] |
| `crimeFact(key, value, not)` | a fact of the crime (e.g. the method), or with `not` its negation |
| `culpritHad(item, not)` | whoever did it had the item when they did it |
| `culpritRelated(rel, b, not)` | whoever did it stands in the relation to b |
| `culpritTrait(trait, value, not)` | whoever did it has the trait |

Each of the facts these predicates speak of (where a person is, who holds an object, a relation, a trait) is a *fluent*: it has a value at every minute, and events change it. The temporal modes `throughout`, `sometime` and `never` are all the temporal logic the game needs: there is one history, not branching futures, so a discrete event calculus over integer minutes suffices, and it stays within linear integer arithmetic, which Z3 decides exactly.

For example, the faked draft is `wasAt(silas, vestry, 22:00, 23:15)`, Miss Pruett's sighting is `wasAt(silas, square, 23:07, 23:10)`, the lure note on vestry paper is `culpritHad(vestry_paper)`, and the building society's letter is `related(silas, embezzled_from, ada)`.

A clue that says two things is recorded as two signs, each with one claim. The reason is defeat: when one sign defeats another, the whole defeated sign stops being trusted, so a sign that mixed a false whereabouts with a true relation would lose its true part with its false one. One claim per sign keeps defeat, the solver's tracked constraints and the agreement between the two kernels simple; the cost is that the generator and publishing must split compound statements.

Note that no record states whether a claim is true; the kernel computes it from the history. A person is where their events put them, stays put between two events at the same place, and may be anywhere they could reach in the minutes between events at different places; objects, relations and traits change only through events' effects. The vicar's claim that Silas was in the vestry from 22:00 to 23:40 is false because the events place Silas in the greenhouse at 22:35. A claim the history does not decide (one about minutes no event accounts for) is refused at certification. A false sign must cite an attitude of its speaker that explains it (here `a_vicar_loyal`: he wants to protect his friend); a false physical sign must come from a deliberate event (here the draft, written by Silas so that "his own papers seem to show he never left his desk").

## 12.4 What reasons over it

Three components reason over the records, and each has its own job.

**The kernel** (`dist/mk/kernel.mjs` and `dist/mk/claims.mjs`, with the same functions in Python in `tools/refine-c/refine.py` and `claims.py`; a parity check runs both over 443 cases and requires them to agree). Its functions are plain algorithms:

```text
analyse(C)                  → reachable signs   (a fixed point over requires)
                              understood signs  (every sign it needs, and every rule it needs, is known)
                              truthval(s)       (true, false or undecided in the history)
                              eff(s)            (the depth at which s can be understood)
survivors(C, A, d)          → the candidates consistent with the trusted claims understood at depth ≤ d
certify(C)                  → ok, solve depth, surface survivors, false signs, motive, means, opportunity
```

A claim is *trusted* if it is understood and no other understood sign defeats it. A candidate survives if the background laws (walking takes the setting's times; an object has one holder at a time; a trait has one value), the trusted claims and "this candidate did it" can all be true together. The reasoning uses only what the player knows: the trusted claims and the public signs, never the case's hidden records. So `culpritHad(vestry_paper)` clears no one by itself; it clears Dora, Rowan and Vera together with the public fact that only Silas and the vicar had vestry paper. The *surface* is what the player can understand before following any lead (depth 0), and the *solve depth* is the depth at which only the truth survives.

The kernel decides satisfiability directly: each fluent is checked separately (alibis are separated by the walk; a sighting at some minute of an interval is placed at the earliest minute it can be), and the fluents meet only at the crime minute, which is tried minute by minute. Certification also requires that any claims the player could hold together that cannot all be true include a defeat, so that whatever the player holds, what they trust is consistent.

**Z3** (`server/case_oracle.py`). The oracle encodes the same semantics in Z3 independently of the kernel's code, and is the reference: an equivalence test requires the kernel and Z3 to agree on every candidate, both ways, over every published and recorded case and over random cases that use every predicate and mode (5,600 sets of evidence, 0 disagreements). It answers two questions. First, `feasible(C)`: is the true history physically possible (one place at a time, travel takes time, the crime inside its window)? Second, `candidates(C, held)`: given only the evidence held, which candidates could still have done it? For each candidate it declares the crime minute `t` and one Boolean per trusted claim, assumed for the check. An unsatisfiable result comes with an *unsat core*, i.e. claims that together rule the candidate out; a satisfiable one comes with a witness minute, which is an alternative story ("could have been there at 22:25"). For a candidate with actor `a`, two of the constraints are:

```text
crimeBetween(s, e)                       ⇒  s ≤ t ≤ e
a at the scene at t,  wasAt(a, p, s, e)  ⇒  t ≤ s − g  ∨  t ≥ e + g      g = the walk from p to the scene
```

**Model critics.** A second model checks what code cannot: whether a refinement is plausible for these people (at design time), whether a character's reply adds a fact that its account does not give, and whether what one person tells another in the morning rests only on what they know (at run time). Their verdicts carry a reason, which is sent back to the proposer.

## 12.5 At design time: writing the vicar's false alibi

The generator builds a case in layers. Code chooses, at each step, which operator to apply and to what: *Conceal* (hide a sign behind another), *Fragment* (split a sign into parts that must be put together) or *Mislead* (add a false account that the evidence later defeats). It always deepens the shallowest thread, i.e. the suspect who is cleared earliest. Opus writes the beat as a patch to the records; the kernel certifies the patched case and checks the refinement laws; Sonnet reviews the beat for plausibility. A refused patch is sent back with the reasons, and Opus tries again.

For this case the generator ran 15 layers in about 19 minutes and accepted 13; code refused 26 drafts along the way. The seed (the first draft of the history, also written by Opus and certified) already contained the vicar's false alibi, but only as an answer to a later question (it requires the solicitor's own account), so at the surface Silas was still a suspect. We follow step 2, a *Mislead* aimed at the truth: the twist that keeps Silas out of suspicion at first.

1. **Opus's first patch is refused.** The kernel certifies the patched case and computes its surface survivors: Dora, Rowan, Silas and Vera. The twist law requires that the deception exclude the truth at the surface, so the patch is refused with the reason: "the surface still admits the truth (surface survivors ['c_dora', 'c_rowan', 'c_silas', 'c_vera']); the deception must exclude it".
2. **The second is refused for the same reason, and one more:** "no story beat: every refinement must add the event or attitude that causes it (who did what, and why)". A deception with no cause in the history is not allowed, because the player could never work out why it exists.
3. **The third patch is accepted.** It adds the draft with pencilled times (`s_draft`, a document claiming `wasAt(silas, vestry, 22:00, 23:15)`), the event that produced it, and the attitude behind it: "Leave a draft marked with times through the late evening, so his own papers seem to show he never left his desk." The draft is on the desk from the start, so it is part of the surface. The kernel certifies the result: the surface survivors are now Dora, Rowan and Vera, so the twist holds; the draft is a false sign produced by a deliberate event, and it has a true defeater deeper in the case. Sonnet then reviews the beat, and it is accepted.

In Z3's terms, the draft and the public crime window now rule Silas out. With the crime window 22:25 to 23:05 and an 11-minute walk from the vestry:

```text
pub_window: crimeBetween(1345, 1385)      ⇒   1345 ≤ t ≤ 1385
s_draft: wasAt(silas, vestry, 1320, 1395)  ⇒   t ≤ 1309 ∨ t ≥ 1406
→ unsat; core [pub_window, s_draft]
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

Z3's publish check found the true history feasible, and with all reachable evidence only Silas survives; Dora, Rowan and Vera are each ruled out with the core `[pub_holders_vestry_paper, s_note]` (whoever did it had vestry paper, and only Silas and the vicar had it). Note that an unsat core is one sufficient reason, not the only one: without the public fact about the paper, Dora is still ruled out by the doctor's daybook, which puts her in the surgery from 22:10 to 23:04 (`[pub_window, s_casenotes]`), and Rowan by the constable's account of the dominoes (`[pub_window, s_bell]`), but Vera then survives.

## 12.6 At run time: a play-through

The same records drive the game. Four kinds of proposal reach the history during play, and each is checked before it is committed.

**A concealment refused by the kernel (08:44).** Every quarter of an hour, the morning director (a model) plans what the people the investigation affects will do. At 08:44 it planned for the vicar, who wants to protect Silas, to hide the older sheet of blotting paper in the vestry. The code critic (place, time, what the vicar knows, and nobody hiding anything in front of the detective or the constable) accepted the plan. The kernel then certified the case as it would stand without that clue, and refused: "false sign s_draft has no reachable, true defeater deeper than it". Without the blotter the player could never show that the draft was faked, so the concealment, and the vicar's later steps, were cut. At 09:42 the director planned for Rowan to hide the label on the orchid crate; the kernel found the case "still solvable" without it, and the concealment went ahead.

**A line refused by the line critic (10:19).** The director planned for Vera to seek out Dorothy Pruett about her visit to the surgery. The line critic (a model) refused what Vera was to say: "Vera has no knowledge that Dorothy was at Dr Marsh's surgery or injured her hand - this fact is not in her listed knowledge". Whatever one person tells another may later reach the detective, so it must rest only on what the speaker knows.

**A reply refused by code, and one refused by the fact-checker.** Each free-text question is answered by a model speaking as the character, from the accounts the history allows that character to give; each reply is checked by code and then by a second model before it is spoken. When the player asked Constable Bell "what time did you play dominoes and who did you play with?", the first reply was refused by code because it gave a time ("half nine") that no account gives Bell. That reply also said Bell had played with Silas Voss, which is false (he played with Rowan Pike) and would have handed the culprit an alibi; the second reply, which declined to name anyone, passed. When the player asked Vera whether she had seen anyone, the fact-checker refused a reply that added "Ada came up the stairs with her keys jangling", since her account says only that she saw Ada at the inn at quarter past nine.

**The accusation, checked by Z3 (15:37).** The player accused Silas Voss, holding 40 clues. The constable's check runs the oracle over the trusted claims among them. In the play (with the first version of the claims) it ruled out Dora by the daybook, Rowan by the dominoes and Vera by the note, and found that Silas could have been in the greenhouse at 22:25. With version 2, over every reachable clue and the public signs, Miss Pruett's sighting of Silas in the square at 23:07 defeats both the vicar's alibi and the draft, so neither is trusted, and:

```text
c_dora   unsat   core [pub_holders_vestry_paper, s_note]   whoever did it had vestry paper; only Silas and the vicar had it
c_rowan  unsat   core [pub_holders_vestry_paper, s_note]
c_vera   unsat   core [pub_holders_vestry_paper, s_note]
c_silas  sat     t = 1345 (22:25)                          could have been in the greenhouse at 22:25
```

Only Silas survives, and the player's evidence also shows the motive, `related(silas, embezzled_from, ada)`, and the means, so the charge was accepted. The same query without the sighting shows why that clue is the key:

```text
c_silas  unsat   core [pub_window, s_draft]   the draft is trusted again and rules Silas out
… and every other candidate unsat as well
```

Holding everything but the sighting, the player's evidence rules out everyone. This is what the constable reports in that situation: "Your evidence rules out everyone, including the person you accuse. One of the accounts you are relying on must be false."

## 12.7 Discussion

The example shows the division of labour on which the design rests. The models proposed everything in this chapter: the lie, the draft, the concealments, the lines, the replies. None of it entered the history until code had checked what can be checked mechanically, a second model had checked the wording, and the kernel (with Z3 at publication and at the accusation) had checked that the case stayed solvable with one answer.

Three limits are worth stating. First, the model critics are fallible: in the same play the fact-checker passed a reply in which the vicar said the vestry study was Silas's and not his, after saying earlier that it was his study. The guarantee about solvability is computed; the guarantee about what characters say is only as good as the fact-checker, and a check of the claims extracted from each reply against the records would make it symmetric. Second, an unsat core explains one reason a candidate is ruled out, not every reason; the constable's feedback names only evidence the player holds, so it can differ from the core while remaining correct. Third, the claim language is sound and complete only for what it can say: one crime and one culprit (no accomplices or second crimes), travel without routes (passing through a place is not being there), and times as intervals, so a vague "about ten" must be given its interval by the author. What a character could know when they speak is checked by account backing, not by the logic.
