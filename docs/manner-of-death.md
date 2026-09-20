# Design note: manner-of-death, and a declarative forensic model

Status: **implemented** (v1: staged-accident only). See [forensic model](forensic-model.md) for the
existing contracts this extends.

## Goal

Move from **combinatorial** variety (the same puzzle with different culprit/weapon/motive fillers)
toward **structural** variety (genuinely different *kinds* of investigation). Today every one of the
~105 generated cases has the identical reasoning shape: *narrow suspect + method + motive to one and
establish the death-time window.* Manner-of-death is the first structural axis and the proof that
new axes can be added cheaply.

## What manner-of-death adds

A **question that comes before "who": was this even a murder?** In a manner-of-death case the culprit
**stages the scene** to look like an accident, so the death first reads as non-criminal. The player's
opening job is to **re-establish that a crime occurred**, via a forensic contradiction (the wound is
inconsistent with the apparent accident). Only then does the normal who/how/why/when deduction apply.

Safety rail: **it is always ultimately a murder** — staging is a disguise, never a real accident with
no culprit. This preserves the core promise (every case is a solvable murder) and the no-dead-end
invariant. We are not adding "sometimes nobody did it."

## Two product decisions (locked)

1. **v1 = staged-accident only.** Staged-suicide is a trivial second flavour once the dimension exists.
2. **Manner is an *investigative gate*, not an accusation field.** Proving murder unlocks the normal
   accusation; the accusation form is unchanged (no "manner" dropdown). Lighter UX, same deduction.

## The enabling refactor: a declarative finite forensic model

Manner is a new *dimension* the old model literally could not express — its variables, predicates and
enumerator were hardcoded. So v1 first makes the existing finite model **declarative**, behaviour-
preserving:

1. **Dimensions as data.** `crimeModel()` returns `variables: { suspect, method, motive, time[, manner] }`,
   each an integer domain with `labels`, instead of hardcoded lists. `time` is the swept window; the
   others are discrete.
2. **Predicates as a registry.** `PREDICATE_COMPILERS[predicate] -> formula` replaces the if-else chain
   in `compileExplanation`. Adding an evidence type is one entry.
3. **Generic enumerator.** `enumerateExplanations` takes the cartesian product of the discrete variables
   and sweeps `time` — exhaustive over the declared finite domain, same honesty, **no new solver**
   (no SAT/ASP/Lean; typed predicates only; small finite domains).

This is the minimal, extensible substrate the next structural axes (collusion, accomplice, frame-up)
will reuse: each becomes a dimension + a predicate compiler + a brick, not surgery on the core.

## Manner as a gate (mechanics)

- A staged case has `spec.manner === 'accident'`. `crimeModel` then declares
  `manner: { labels: ['murder','accident'] }`. Nothing constrains it until the manner clue is acquired,
  so **both values survive → the case reads as possibly-accidental → the accusation is *gated*.**
- The **`manner-of-death` brick** contributes: a staging occurrence in the prehistory (the culprit
  arranges the scene, sourced to the fatal action), a **coroner's manner-finding** clue at the surgery
  carrying a `manner_evidence: 'murder'` claim, an apparent-accident framing in the synopsis, and it
  places the coroner clue on **every** proof route.
- `assessAccusation` gates: if the model has a `manner` variable and the surviving `manner` set is not
  exactly `{murder}`, it returns `{ supported:false, status:'gated', feedback }` — surfaced through the
  existing accusation-reject path, no new UI. Once the coroner clue pins `manner=murder`, grading
  proceeds exactly as an overt case.

## Why it stays coherent and load-bearing

- **Provenance:** the staging and the coroner finding are recorded, sourced occurrences; the manner
  claim is entailed by its producer (`validateEvidence` gains a `manner_evidence` case).
- **Load-bearing / distinguishable:** because the coroner clue is on every proof route and is the only
  thing excluding `accident`, the existing reachability + distinguishability obligations already prove
  it is required — remove it and the case is unsolvable (gated). No new validation concept.
- **Backward compatible:** overt cases declare no `manner` variable and behave identically; all prior
  tests stay green.

## Scope / non-goals for v1

- Staged-accident only; one coroner clue; manner never enters the accusation.
- No new solver, no natural-language entailment, no manner "maybe it really was an accident".
- One dimension, validated by the finite grader and a playtest, before any further axis.
