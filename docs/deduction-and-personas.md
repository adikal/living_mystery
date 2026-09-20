# Design note: personas, consistency, deep deduction, and resilient multi-path cases

Status: **implemented (slices 1–6)**. Extends [forensic model](forensic-model.md),
[character turns](character-turns.md), [autonomous lives](autonomous-lives.md) and the
[manner-of-death note](manner-of-death.md). Nothing here weakens the tenets: the deterministic
engine owns reality, the LLM only interprets/expresses, symbolic checks preserve validity.

## Goal

Deepen two stages together, because they are the same system seen from two sides:
- **Stage 4 (deduction):** move from "one clue per pillar → fill dropdowns" to **piecing together
  multi-hop chains and catching lies** by resolving contradictions.
- **Stage 5 (NPC life):** give each NPC an explicit **persona they must stay consistent with**, so
  their statements and actions are personality- and memory-driven, durable, and *catchable* when false.

The bridge: **a persona with a private truth and a public stance produces typed claims — some true,
some lies. Those claims form a web. Deduction is resolving the web.** Consistency is what makes lies
durable enough to catch. Add a hard **multi-path** guarantee so the case stays solvable even as NPCs act.

## 1. The persona model  *(mostly data; much already exists in `PEOPLE`)*

Today `PEOPLE[id]` already carries `traits`, `values`, `goals`, `relationships`, `secret`,
`beliefSeeds`. Make the behavioral contract **explicit** as a `persona` record:

```
persona = {
  disposition,                 // from traits/values (voice, nerve, pride, warmth)
  allegiance: { protects:[ids], distrusts:[ids] },   // who they shield / resist
  stance: 'truthful' | 'self-protective' | 'shielding-ally',
  privateTruth: [typed claims],   // what they actually did / saw / know (from beliefSeeds + role)
  publicStance: [typed claims],   // what they will say unpressed (may diverge from privateTruth = a lie)
}
```

`privateTruth` vs `publicStance` divergence **is** the lie. A culprit's publicStance places them
elsewhere; a shielding ally's publicStance covers for someone. This is data, generated per role, not
prose.

## 2. The consistency contract  *(engine-authoritative; deterministic where possible)*

An NPC utterance/plan is admissible only if it satisfies three layers. Layers 1–2 partly exist; layer 3
is the new keystone.

1. **Belief-consistency** *(exists — `knowledge.believe` fail-closed):* asserts only what a sourced
   belief supports, or a *permitted* deception account.
2. **Persona-consistency** *(new, mostly deterministic + critic-assisted):* obeys allegiance/stance —
   e.g. a `shielding-ally` never *volunteers* evidence against a protected person; a proud persona
   won't grovel. Hard rules are deterministic gates; voice is a critic check.
3. **Statement-consistency** *(new, the crux for Stage 4):* every claim an NPC makes to the player is
   appended to a durable **statement ledger**. A later turn may **not contradict its own prior claims**
   *unless* the player has presented an adjudicating fact that forces a revision (generalising today's
   Silas-receipt mechanic). So a lie, once told, **sticks** — the NPC must defend it or be caught.

`validatePersonaConsistency(session)` — analogous to `validateKnowledge` — checks the whole ledger
offline, so consistency is a *verifiable property*, not a hope about the LLM.

## 3. Multi-hop clues — the "not obvious" upgrade  *(Stage 4a)*

Replace one-clue-per-pillar with **partial constraints that only pin a pillar in combination**
(the declarative model already intersects constraints — no new solver):

- **Narrowing predicates** (subset, not equality): `method_class:blunt` → {seal,candlestick};
  a material fragment → {seal}; the weapon's damage confirms. Three insufficient clues intersect to one.
- **Chained predicates** (`requires`, exists): a clue constrains only once its prerequisite is in hand
  — "follow the thread" (ledger anomaly → beneficiary record → relationship ⇒ motive + culprit).
- **Elimination**: alibi records remove suspects; the survivor is the opportunity.

**Per-pillar minimality obligation** (new, checkable with the existing enumerator): the winning bundle
pins each dimension to one value, but **removing any single clue re-introduces ambiguity**. This
*guarantees* genuine multi-hop and forbids a smoking gun. Generation admits only cases that satisfy it.

Discoverability rail: each chain needs authored **indirection** (a clue names where the next one is),
or it's a scavenger hunt.

## 4. The contradiction engine + break-a-lie loop  *(Stage 4b)*

- **Type the public stances as claims** (today the generated culprit's alibi is prose with `claims:[]`
  — fill that gap). Now testimony lives in the same claim space as physical facts.
- **`findContradictions(session)`**: over {acquired physical claims} ∪ {heard testimony claims},
  return the **jointly-infeasible sets** under the finite model ("Silas says vestry all night; the
  receipt puts him at the manor — one is false"). Reuses the enumerator/Z3.
- **Reasoning board becomes the spine**: it already draws objective conflicts; make those edges the
  load-bearing view where the player assembles chains and spots contradictions.
- **Break-a-lie loop**: presenting an adjudicating fact to a lying NPC forces, via the consistency
  contract, a *revision* (recorded — exposes the next thread) or a *deeper lie* (recorded — catchable
  later). Generalises Silas-receipt to every persona and pillar.

## 5. Stage 5 — personality + memory → probabilistic decision within the admissible space

NPC decisions become: enumerate available goals/plans → **rank by persona** (traits/values/allegiance)
and **memory/beliefs** (what they think is happening, incl. the player's pressure) → choose
probabilistically (seeded, deterministic-replayable) → **the World Director admits or defers** the
choice. The LLM path (`deliberateWorld`) proposes a ranking/selection; it never mutates state. New:
pressure-reactive behavior (warn an ally, move/hide, revise a story) as *admissible plans*, so
"living complexity" is expressed as choices inside the firewall, not new powers.

## 6. Resilient multi-path solvability  *(the new hard invariant)*

Elevate "keep one viable route" from the Director's runtime rule to a **generation obligation + a
runtime guarantee**:

- **Generation:** a case is admissible only if it has **≥ 2 independent solution routes** (already true
  in spirit — `proofRoutes: physical | documents`, clockwork's two routes). "Independent" = they don't
  share a single choke clue; formalise with a route-cover check on the existing `proofRoutes`.
- **Runtime:** the World Director already validates that an NPC plan (e.g. concealment) preserves an
  investigation witness. Strengthen to: **no admitted NPC action may drop the number of open
  independent routes below 1.** An action that would close the last route is **deferred** (the tenet:
  unknown/last-route → defer, never silently approve). NPC blocking then creates *tension and forces
  the alternate route* rather than a dead end.
- This makes NPC freedom (Stage 5) and fairness compatible: the culprit can hide the folio, wipe a
  trace, or lean on a witness — and the case is still winnable by another chain.

## 7. Tenets preserved (non-negotiable)

Engine owns reality; deterministic replay from seed+log; fail-closed knowledge; LLM proposal-only;
typed predicates only (no NL entailment, no new solver); every consequential transition inspectable;
**no reachable dead-ends**. Consistency and multi-path are *verifiable obligations*, not narrative hopes.

## 8. Build sequence (each slice additive, tested, keeps the suite green)

1. **Persona records + statement ledger + `validatePersonaConsistency`** — data + an offline verifier;
   no behavior change yet. *(Foundational, safe.)*
2. **Type public stances as claims + `findContradictions`** — the deduction substrate; expose it read-
   only (inspector) and add tests that a culprit's false alibi conflicts with the physical record.
3. **Multi-hop**: narrowing/chained predicates + the **per-pillar minimality** generation obligation +
   author bridging clues/indirection for motive & opportunity on the current cast.
4. **Multi-path obligation**: ≥2 independent routes at generation; Director preserves ≥1 at runtime;
   tests that blocking one route leaves another open.
5. **Reasoning board = the spine**: surface chains + contradiction edges as the primary solving view.
6. **Break-a-lie loop + pressure-reactive NPC plans** — the live Stage-5 behavior, on the firewall.

Slices 1–2 are pure substrate (low risk); 3–4 change generation (validated); 5–6 change the felt loop.

## 9. Decisions (locked)

- **Win condition:** catching lies / resolving contradictions is a **richer path *into* the existing
  accusation**, not a replacement. The accusation stays the capstone.
- **Consistency strictness:** **deterministic** allegiance/stance gates (verifiable offline); critic-
  judged voice is deferred.
- **Lie authoring:** **systematic**, from the `privateTruth` ↔ `publicStance` divergence per persona.
- **Difficulty:** a **progressive-disclosure hint ladder** (modern adventure-game style: nudge → focus
  → concrete next step, revealed only on request), kept separate from the omniscient inspector.
