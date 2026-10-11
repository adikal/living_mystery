# Claims: a temporal language for clues, and what reasoning over it guarantees

Status: **Implemented** (claims version 2). Code: `dist/mk/claims.mjs` (JavaScript) and `tools/refine-c/claims.py`
(Python), kept identical by `tools/refine-c/parity.py`; the reference semantics in Z3 is `server/case_oracle.py`,
written without either. This note is the specification all three implement.

## 1. Two questions, two models

Reasoning over a case answers two different questions, over two different models.

- **Is a claim true?** It is evaluated in the *history* H: the case's events, read with the rules of §3. A claim the
  history does not decide is *undetermined*, and certification refuses it.
- **Who could have done it?** It is evaluated over *every* history consistent with what the player knows: the background
  laws B (§4), the public knowledge, and the trusted claims among the clues the player holds (together, K). A candidate
  h survives iff B ∧ K ∧ culprit(h) is satisfiable.

The second question never consults H. In version 1 it did: a clue that "whoever did it had vestry paper" ruled out
everyone the hidden possession table left out, which the player was never told. In version 2 a candidate is ruled out
only by what the player knows, so every elimination is one the player can make.

## 2. The language

Times are integer minutes (1320 = 22:00; values past 1440 are the next day). Intervals [s, e] are closed. A claim is a
JSON object `{"pred": P, …arguments}`; a sign carries at most one claim.

**Fluents** are facts that hold or not at each minute:

| Fluent | Values | Meaning |
|---|---|---|
| `at(p)` | a place, or none | where person p is; none means on the way, or at no place |
| `holder(i)` for a single object i | a person, or none | who has the object (at most one person) |
| `has(p, i)` for a supply i | true, false | p has access to the supply (vestry paper, the surgery's morphine) |
| `rel(a, r, b)` | true, false | a stands in relation r to b |
| `trait(p, k)` | a value | p's trait k (foot size, handedness, an injury) |

**Predicates over fluents** take an interval and a temporal mode: `throughout` (at every minute of [s, e]), `sometime`
(at some minute of it) or `never` (at no minute of it). `from` and `to` default to the whole span of the case.

| Predicate | Arguments | Fluent condition |
|---|---|---|
| `wasAt` | person, place, from, to, when | at(person) = place |
| `had` | person, item, from, to, when | holder(item) = person, or has(person, item) |
| `related` | a, rel, b, from, to, when | rel(a, rel, b) |
| `hasTrait` | person, trait, value, from, to, when | trait(person, trait) = value |
| `nobodyAt` | place, from, to | for every person p, at(p) ≠ place throughout |
| `onlyHad` | item, people, from, to | throughout, everyone who has the item is in people |

**Predicates about the crime** refer to the crime minute t and the culprit c (the actor of the true candidate):

| Predicate | Arguments | Condition (with `not`: its negation) |
|---|---|---|
| `crimeBetween` | from, to | from ≤ t ≤ to |
| `crimeFact` | key, value, not? | the crime's fact key is value |
| `culpritHad` | item, not?, from?, to? | c had the item at t (or, with an interval, at some minute of it) |
| `culpritRelated` | rel, b, not? | rel(c, rel, b) at t |
| `culpritTrait` | trait, value, not? | trait(c, trait) = value at t |

Relation names come from the case's `vocabulary.relations`, where each name may declare its inverse
(`blackmailed_by` is the inverse of `blackmailing`); a claim or record in the inverse is read in the declared direction.

## 3. The history

The history H is read from the case's records:

- **Whereabouts.** During an event a person is at its place. Between two consecutive events at the same place they
  stay there. Between events at different places, and before their first or after their last event, they may be on
  the way or anywhere they could reach in time, so those minutes are undetermined; the victim stays at the place of
  their last event. A `wasAt … throughout` claim is true if every minute is determined to be at the place, false if
  some minute is determined elsewhere or the place cannot be reached at that minute, and undetermined otherwise
  (`sometime`, `never` and `nobodyAt` likewise).
- **Objects and supplies.** `holdings` give who has what when the history begins; an event's `effects` change it:
  `{"take": i}` (the agent has i from the event's start), `{"give": i, "to": q}` (q has it from the minute after the
  event ends), `{"lose": i}` (no one, from the minute after the event ends). Objects listed with `"supply": true` may
  have many holders; `take` and `lose` add and remove the agent's access.
- **Relations and traits.** `relations` and people's `traits` hold from the start; effects `{"relate": r, "to": b}`
  (from the event's start) and `{"trait": k, "value": v}` (from the minute after the event ends) change them.
- **The crime.** The crime minute t* is the crime event's start; its facts are the crime event's `facts`
  (e.g. `{"method": "blow", "motive": "money"}`), which must agree with the true candidate's facts.

Possession, relations and traits are complete: what the records do not state did not happen. Whereabouts are not, which
is why they alone can be undetermined.

## 4. The background laws B

Over a possible history, a model gives every fluent a value at every minute, subject to:

1. **Travel.** If at(p) = x at minute m₁ and at(p) = y at m₂ > m₁, with x ≠ y, then m₂ − m₁ ≥ walk(x, y), the shortest
   walking time in the setting. Being on the way is unconstrained.
2. **One holder.** A single object has at most one holder at each minute (the fluent is a function).
3. **One value.** A trait has one value at each minute.
4. Nothing else: objects change hands, relations start and end, traits change, at any minute, as far as B is concerned.

culprit(h), for a candidate h with actor a: at(a) = the crime's place at t; t lies in the crime window; for every
`crimeFact` known, h's own facts do not contradict it; and the culprit predicates hold with c = a.

## 5. Guarantees

- **Sound and complete elimination.** survivors(K) = { h : B ∧ K ∧ culprit(h) is satisfiable }. Z3 decides this exactly:
  every condition above is linear integer arithmetic over finitely many minutes, with one witness minute per
  `sometime` claim. The kernels compute the same set by a direct procedure (§6), and the equivalence tests require them
  to agree with Z3 on every candidate, both ways.
- **Consistency.** Certification requires every set of reachable claims that is inconsistent under B to contain a
  defeat (a sign in it that defeats another in it). Then every trusted set, the clues held minus those they defeat, is
  consistent, whatever the player holds.
- **The truth survives true evidence.** If every trusted claim is true in H, the true candidate survives: H, with its
  undetermined minutes spent on the way, is a model of B ∧ K ∧ culprit(truth). Certification ensures the premises:
  the history is feasible under B, the crime minute is in the window at the crime's place, and the crime's facts agree
  with the true candidate's.

## 6. The procedure

Fluents interact only through the crime minute t. Each *instance* (one person's whereabouts, one object's holder, one
person's access to one supply, one relation triple, one person's trait) collects its constraints from K and from
culprit(h): positive anchors (an interval or a witness minute with a value), and forbidden intervals for a value.
Anchors with different values must be separated (by the walk, for whereabouts; by a minute otherwise); a witness must
avoid the forbidden intervals of its value. With the anchors fixed, pairwise separation is enough (walking times are a
metric). Witnesses are placed by trying each order of them and placing each at its earliest allowed minute, which is
exact for a given order. A candidate survives iff some minute t of the window satisfies every instance.

## 7. Limits

One crime and one culprit: accomplices and second crimes cannot be expressed. Travel ignores the route (passing through
a place is not being there). Clue texts that are vague ("about ten") must be given as intervals by the author. What a
character could know when they speak is checked by account backing, not by this logic.
