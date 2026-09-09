# 1. Research questions and design principles

**Status: implemented principles; proposed empirical evaluation.**

## 1.1 The problem is inference in a changing world

A conventional puzzle can hold its evidence still while the player reasons. A living mystery must permit change without making inference meaningless. A witness may correct an honest mistake; a frightened suspect may conceal a document; a player may miss an encounter that really occurred. These developments should have causes the player can eventually understand. They should not be arbitrary repairs to a story produced after the fact.

We distinguish four desirable properties. **Physical coherence** concerns locations, possession, durations and event order. **Epistemic coherence** concerns how an actor obtained and revised information. **Investigative viability** concerns whether an executable route to a supported conclusion remains. The refined target makes physical/temporal coherence, epistemic legitimacy and continued solvability hard admission invariants, while agent goals and dramatic pacing rank choices within the admissible space. **Experiential quality** concerns whether the investigation is understandable, engaging and fair. Satisfying any one does not establish the others. In particular, a satisfiable temporal model may describe a dull or practically undiscoverable mystery.

## 1.2 Research questions

| Question | Current instrument | Evidence still needed |
| --- | --- | --- |
| RQ1: Can expressive dialogue remain within explicit information and action boundaries? | Immutable turn tickets, account capabilities, critic, atomic application | Real-model disclosure and semantic-error evaluation |
| RQ2: Can beliefs change without rewriting history or spreading knowledge remotely? | Provenance, dependencies, local observations, real conversations | Wider correction networks and conflicting-source scenarios |
| RQ3: Can character agency coexist with a reachable investigation? | Feasible plans, bounded acquisition search and configured admission | Contingent search and broader player-choice robustness |
| RQ4: Can a debugger explain failures with enough precision to guide authoring? | Timeline, character perspective, causal parents, solver audits | Diagnostic task studies and authoring-time measurements |
| RQ5: Can the same contracts validate generated cases? | Case interface, executed configured prehistory and action/query fragments | A generator and general distinguishability checks |

The Last Bell is a reference case for developing these instruments. It is not a representative sample of generated mysteries. Success in one carefully authored world should lead to harder counterexamples, not an immediate claim of generality.

## 1.3 Authority and uncertainty

The engine owns committed world changes. A character's statement is an event; its contents may be false. A model proposes a reply or plan, but cannot submit an unrestricted world patch. The inspector may display private facts, but a character context must be constructed from that character's perspective. A solver may find a possible model, but that model does not automatically become an NPC's knowledge.

These distinctions deliberately preserve useful uncertainty. An unidentified coat wearer is not an identified suspect. A plan to meet someone is not evidence that the meeting occurred. A copied rumor is not an independent corroborating source. A failed search for a solution is not a proof of impossibility unless the search and its completeness boundary justify that conclusion.

## 1.4 Determinism as an experimental control

With AI disabled, authored dialogue and NPC policy run without generative calls. The optional symbolic service is independent of AI: a scripted turn can still request Z3 verification. Given the same recorded events, replay reconstructs the same state without invoking either service. Rerunning commands with fresh AI responses is a different experiment and need not reproduce the same event sequence.

This distinction permits controlled comparisons. A proposed AI action can be replayed as a structured action; a failing trace can be restored without reproducing stochastic wording; and a solver result can be inspected against the exact query that produced it. Determinism supports diagnosis, but it is not a substitute for testing that the model of the world is correct.

## 1.5 Relation to prior work

Generative Agents describes agents whose recorded experiences support retrieval, reflection and planning. Living Mystery shares the interest in persistent experience, but presently uses bounded contexts and authored disclosure capabilities rather than a general reflection architecture. [Park et al., 2023](https://arxiv.org/abs/2304.03442).

Narrative planning research explicitly connects causal plot structure with understandable character intentions. That distinction motivates recording why a character chose an action in addition to checking whether the action can occur; the current scored policies are not an implementation of IPOCL. [Riedl and Young, 2010](https://faculty.cc.gatech.edu/~riedl/pubs/jair.pdf).

Our research program is therefore an integration and evaluation problem: how much expressive freedom can a useful shared model support, and which failures require richer representation rather than another natural-language instruction?


## 1.6 Hybrid autonomy as the governing objective

Scripted structure defines hidden history, evidence origins and required
investigative opportunities. Character policies choose how to pursue goals within
those constraints. The target is solver-assisted filtering before deliberation
and concrete validation immediately before commitment, with shared enforcement
for scripted agents, AI agents, players and time-dependent effects. See the
[refined Director contract](director.md#6-6-refined-governing-contract) for its
formal scope, assumptions and current implementation gap.
