# 6. World Director and investigation viability

**Status: experimental bounded admission and witness search; general viability and recovery are proposed.**

## 6.1 The coordinator's role

World Director is the term used for the global coordination layer. It belongs within runtime agent-output validation, the second of the three symbolic use cases. The other two are future case creation and evaluation of the player's final argument. The Director is not an omniscient character who whispers private truths to NPCs, and it is not itself a solver.

Its intended obligation is twofold: candidate actions must respect the physical model, and selected consequential transitions must preserve an acceptable route through the investigation. Those are separate checks. Hiding a document can be physically possible yet destructive to a particular evidence route. Conversely, a surviving route cannot justify teleporting a document into an inaccessible room.

## 6.2 What exists today

`assessPlan` constructs local constraints; `recordPlan` emits an inspectable decision; `executePlanStep` rechecks immediate conditions before calling the executor or case consequence handler. With Z3 enabled, `verifyDirectorTurn` collects new locally allowed plans from a candidate turn and requests symbolic verification. Rejected local plans do not make an otherwise harmless waiting command fail solely because an NPC considered an impossible action.

Turns with take, store, give or conceal steps also trigger `investigateReachability`. It tries up to two authored strategies on copies of the post-turn state, with a 180-minute horizon and 32-command limit per strategy. Those strategies acquire evidence and submit the case-authored suspect, method and motive. A route succeeds only if actual engine execution reaches a solved state and passes integrity checks.

```text
candidate turn
  → local plan admission
  → optional Z3 verification of admitted plans
  → if relevant transfers: replay candidate investigation strategies
  → verify unchanged starting session and candidate integrity
  → commit candidate, or retain original world with a private failure audit
```

This is stronger than checking whether a clue identifier remains in a list: the candidate includes movement, acquisition and accusation commands. However, it uses the authored solution goal and only two strategies. It is a developer-side viability instrument, not the player's reasoning process or a proof of guilt inferred from discovered evidence.

## 6.3 Formal target and current approximation

Let G be the supported-investigation goal, A the available investigative actions and H a finite horizon. A future bounded viability query could ask:

```text
Does there exist π = [a₁, …, aₖ], k ≤ H,
such that execute(W, π) is legal and satisfies G?
```

Today's implementation substitutes a small authored set of candidate π for a general search over A. Finding a witness establishes existence under the replayed policies. Finding no witness produces `unresolved`, not a proof that every sequence fails. The result is also conditional on what future NPC policies do during that replay.

A more robust problem would quantify over selected NPC branches or player mistakes. It must explicitly state which choices are fixed, nondeterministic or adversarial. Universal success across all conceivable player actions would erase much of the game's agency and is not the target.

## 6.4 Recovery without retroactive fabrication

Proposed recovery policies should be authored or generated as explicit actions: a witness can seek another meeting, a document can be retrieved from a known place, or another legitimate evidence route can become accessible. The first response to a blocked AI plan should generally be reconsideration, not changing the past to make it succeed.

A recovery catalog needs prerequisites, costs, effects, disclosure rules and retry limits. The Director should record why a recovery was selected and what it assumes. Lost optional conversations may remain lost. Removing all negative consequences would make player choice cosmetic; allowing an unannounced unavoidable dead end would make the investigation unfair. Determining that balance needs player evaluation in addition to satisfiability checks.

## 6.5 Present limitations

Checks currently inspect selected plans and the candidate turn's post-state, not every intermediate state or every deadline crossing. There is no general destructive-action policy, no exhaustive last-route detector and no automatic recovery scheduler. Z3 being disabled preserves deterministic local checks but removes the optional solver and witness-search boundary. “AI off” and “Director off” therefore have different meanings.
