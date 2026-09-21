# Design note: depth by composition + recursion, certified by a thin solver

Status: **implemented through M5** (a first end-to-end vertical slice; local, not pushed). Extends
[primitive-algebra.md](primitive-algebra.md). This note records the architecture for getting
*Christie/Holmes-grade depth* out of generated cases, after we diagnosed that today's cases are shallow by
construction (all clues inspectable at t=0, each self-labelling and naming the culprit — see
primitive-algebra.md "Honest hard parts").

## Implementation status (M0–M9)

The architecture below is realized as a *parallel deep path riding the existing engine* (so the flat path
stays green — 253 JS + 10 Python tests):

- **M0 — case artifact** (`dist/case-artifact.mjs`): a deep case is data — neutral observations that don't
  announce their meaning, each grounded and carrying the typed claim it licenses (with `requires` for
  multi-hop inference), plus discovery gates, `forces`, and a declared inversion — compiled into a brick
  via the composition compiler.
- **M1 — fair-play** (`checkFairPlay`): every inference premise must be *earnable* (an acquirable clue, or
  reachable by unlocking a gate). Rejects an inference standing on an unreachable premise.
- **M2 — gated discovery** (`makeCase` gates + `acquisitionDomain` v2 + a runtime unlock hook +
  `checkDiscoveryDepth`): a clue's object stays locked until its prerequisites are acquired; the bounded
  search finds the gated path (gating reduces to the search's `requires` handling); depth is enforced only
  when a case declares a target.
- **M3 — operators + inversion contract** (`dist/operators.mjs` + `checkInversion`): pure artifact→artifact
  transforms (add/gate/interpolate/force/declare-inversion), and the inversion-anchor obligation
  (reachable + necessary + misdirects), which composes the existing obligations.
- **M4 — deep generator + composer** (`dist/deep-generator.mjs`, `composeDeepCase`): a deterministic,
  seed-driven, always-certified deep case (a delayed poisoning whose toxicology anchor is gated behind a
  washed-decanter → discarded-dregs chain, with the recorded time of death as a misdirecting alibi); the
  LLM composer picks who/why + flavor and falls back to it.
- **M5 — wired + playable**: `runtimeFor` routes `deep-*`; the case chooser offers "🧩 Generate a deep
  case"; verified end to end — the toxicology anchor is *locked* until the discovery chain is walked, then
  the case solves.
- **M6 — breadth (three shapes)**: the generator selects among three deep shapes, each gating a *different*
  forced anchor — **delayed-poison** (TIME: the toxicology time-of-death), **buried-motive** (MOTIVE: a
  reconstructed confrontation memo) and **hidden-means** (MEANS: a tool-mark trace that clears the obvious
  weapon).
- **M7 — deeper ladders + red-herring fog**: each anchor is buried behind a **~5-hop discovery ladder**
  (was two), and every case carries **red-herring fog** — neutral observations with no bearing on the
  crime, some hidden behind one another, *never* forced and *never* a premise of a forced clue, so the
  route ignores them while the player must sift them. The binding constraint is the bounded solver's
  30-clue bitset; a deep case uses ~23–24 of 30, and all sampled seeds certify at depth 5.
- **M8 — in-room disclosure** (`roomInspect` in `dist/ui.mjs`): the inspect panel groups reachable objects
  into **sections** by evidence kind and *hides* gated objects until their prerequisites are found —
  inspecting one lead reveals the next (removing the old inspect-and-reject on locked objects).
- **M9 — LLM authors a full artifact** (`composeArtifactCase` + `expandArtifact`): the model proposes a
  whole discovery chain of neutral observations gating a forced anchor plus the inversion; a safe expander
  rejects malformed structure and never admits ungrounded claims; the engine certifies every obligation,
  repairs from structured feedback, and falls back to the deterministic deep case.

Realized as a *parallel deep path riding the existing engine* (the flat path stays green): **253 JS + 10
Python tests**. Next: more axes (space/identity), a point-and-click *combine* verb, and persisting
LLM-authored artifacts across reload.

## 1. The thesis

Depth is **authorial**, not algorithmic. The LLM invents the tangled, deep mystery; a **thin symbolic
solver** certifies only that it is *coherent, fair and solvable*. The two have complementary failure
modes — the LLM has unbounded creativity and *zero* guarantee (it confabulates confidently and cannot see
its own holes); the solver has a perfect guarantee and *zero* creativity (it can only check, and strangles
the story if made to author). The novel combination lets each do only what it is uniquely good at, joined
by one seam: **reduction to primitives.** Closest analogy: modern theorem-proving, where an LLM proposes a
proof and Lean checks it — the checker doesn't make the mathematician less creative, it makes the
creativity *trusted*. We do that for stories.

Consequence: keep the symbolic layer **thin and general** (the laws of time/space/logic/knowledge), and
push all domain content up to the LLM (objects, motives, interactions). The solver must know about
*physics and knowledge*, not *murder*.

## 2. Three layers (only two are certifiable)

- **(F) True-history DAG** — the timed, caused occurrences. *Solver-certified.*
- **(E) Discovery / epistemic surface** — what is knowable, by whom, gated how. *Solver-certified.*
- **(P) Presentation** — what the player is shown, in what order, through whose eyes (unreliable narrator,
  inverted "howcatchem", limited POV). *Authorial, uncertified.*

Coherence = **reducibility to a grounded, timed, caused occurrence DAG (F) plus a reachable epistemic
surface (E).** If a mystery reduces, it is logically/temporally/causally coherent *by construction*.

## 3. L0 — the primitives (the laws), lean

Time · space `{occupancy, access, travel}` · causality/state/possession (preconditions, frame-persistence)
· epistemic access (perception, testimony, inference; provenance; no omniscience) · **identity (apparent
vs true)** — the one extension the canon forces (impersonation, misidentification), reconciled by an
unmasking occurrence.

Two **ingredients** are LLM-asserted but engine-grounded (fiat content, grounded use):
- **Affordances** — "this object can bludgeon / transfer poison / fake a sound." The solver never validates
  the affordance is realistic; it only checks that *using* it obeys the laws (present, holds it, at that time).
- **World-rules** — Holmes-style background premises ("this clay is only from Chiswick"). The solver does
  not check they are true; it checks the inference *chain uses them validly* and their observation is reachable.

**The reduction contract (two passes):** Pass 1, the LLM imagines a rich mystery freely (no format). Pass 2,
it encodes only the *load-bearing* facts as occurrences over the ontology + marks how each clue is reachable.
Prose never bends to logic; only the ~30 solution-bearing facts do.

## 4. The unifying principle (why the operator set is broad, distinct, general)

> **Every operator is the same move: make the *apparent* value diverge from the *true* value along one
> primitive axis, then gate the fact that reconciles them.**

| Axis | Divergence | Operator family |
|---|---|---|
| Time | apparent time ≠ true time | R2 displace-time |
| Space — access | "sealed / no way in" ≠ a real route | S1 hidden-route, S2 barrier-crossing agent |
| Space — occupancy | "not there" ≠ present; "only X" ≠ others | S4 concealed-presence, S6 exclusivity-defeater |
| Space — travel | "no time to cross" ≠ a shortcut exists | S5 route-timing |
| Identity | apparent actor ≠ true | R3 displace-identity |
| Possession | apparent owner ≠ true holder | R6 plant/remove, R7 provenance-chain |
| Knowledge | apparent reliability/absence ≠ true | R8 compromised-authority, R9 overlooked-witness, R12 rumor-provenance, R13 negative-clue, R15 abductive-trace |
| Motive/cause | apparent motive ≠ true root | R4 deepen-root, R11 camouflage-in-a-series |
| (axis-agnostic) | — | R1 interpolate, R5 gate-discovery |

This makes the set **distinct** (one family per axis-divergence; famous "tricks" like the locked room
resolve into *combinations* along axes), **broad** (the canon reconstructs from it), and **general** (axes
are primitives, not "murder"; crime-type and setting are parameters). **Completeness heuristic:** the
library is complete along an axis once every *sub-relation* of that axis has its displace-and-gate operator.
`S3 seal-timing` = R2 scoped to the seal boundary — a deliberate composition, evidence the axes interlock.

**Gradient of guarantee (important):** certainty is *not uniform*. Space/time/possession/occupancy are
**hard-checkable** (a travel graph + timeline lets the solver *prove* "exactly one person had
presence-with-access in the window" — which is why the impossible-crime family is where the solver is
strongest). Knowledge/identity are medium (grounding + reachability). Motive/aesthetics are **soft** (the
solver checks a motive clue is *reachable*, never *compelling*). Design rule: **put a case's certified
weight on the hard axes; let the LLM carry the soft ones.** The puzzle is provable; the soul is trusted.

## 5. L1 — composition blocks (content threads)

Additive units introducing a suspect/motive subgraph: **false-alibi · secret-relationship · blackmail ·
disputed-inheritance · past-crime · village-web.** Composition = union of independent threads sharing one
world. A case = one **spine** block (the real crime) + several **fog** blocks (independent, each a coherent
false story). Obligation over composition: **every fog block is excludable; exactly one spine survives.**

## 6. L2 — recursion operators (the depth generators)

Transforms that rewrite an existing edge to deepen it, each with a *local* check so depth never costs
coherence. The full family is the table in §4. Two mechanics:

- **Recursion** = coherence-preserving refinement: `A→B` ⇒ `A→C→B`, `C` grounded, both sub-edges valid.
  Recurse arbitrarily; the solver just checks more, smaller, local edges — it never gets smarter.
- **The depth engine:** *recurse the spine* (deepen the true story; every inserted event manufactures clue
  material) and *compose the fog* (independent false threads). Depth = spine × fog.

**Caveat — length ≠ difficulty.** Interpolating a *connector* adds a hop but no puzzle. A refinement only
deepens the mystery if `C` is **hidden**, **load-bearing** (the inference fails without it), and ideally
**misdirecting**. Prefer insertions that *repurpose an existing clue* — that is what makes difficulty
*emergent* (operators referencing each other's artifacts) rather than additive.

**Difficulty dial:** recurse/compose until the depth obligations are met, then stop. Tunable per axis.

## 7. L3 — presentation modes (uncertified)

Unreliable narrator (e.g. the narrator is the killer — a P-move, not an F-move), inverted reveal
("howcatchem": culprit known up front, find the one breakable seam), limited-witness POV. These shape
experience and difficulty; the solver never touches them.

## 8. The inversion-anchor contract (the keystone)

Half the "dangerous" operators (R2/R3/R7/R8/R11/R14/S*) end in the same clause — *the reconciler must be
reachable and forced.* Formalized, an **inversion** is fair iff there exist a surface set `S`, a
coherent-but-wrong naïve reading, and an `anchor` such that:

1. **Real misdirection** — face-value `S` uniquely/strongly supports some coherent `naïve ≠ truth`. *(new check)*
2. **Anchor reachable** — acquirable via a legitimate, possibly gated path. *(= reachability)*
3. **Anchor sufficient** — `S ∪ {anchor}` makes `truth` the unique supported solution. *(= distinguishability)*
4. **Anchor necessary** — `S ∪ (all-but-anchor)` does *not* uniquely support `truth`. *(= forced-insight)*
5. **Anchor grounded** — reduces to an occurrence-entailed fact; no deus ex machina. *(= grounding)*
6. **Re-read strength ≥ K** — incorporating `anchor` flips the *interpretation* of ≥K surface clues
   (revelation, not mere reveal). *(quality metric, soft)*

1–5 are hard-checkable and mostly reuse existing obligations; only 1 is new; 6 is a soft metric. So the
contract **composes existing obligations into one named guarantee.** It also gives the LLM composer exact
**repair signals:** no misdirection → add a red herring; unreachable → gate a discovery path; unnecessary →
a shortcut clue pins truth, weaken it; ungrounded → source it to an occurrence. A case may hold several
inversions (one anchor per axis); the **capstone** is the anchor that re-reads the most. This is the one
guarantee writing-well can never provide, and the thing that separates a real twist from a rug-pull.

## 9. Obligations (the referee), consolidated

coherence (laws) · reachability + **fair-play clueing** (every inference hop has a reachable grounding
clue) · **uniqueness + minimality** (exactly one culprit; no simpler explanation fits) · **inversion-anchor**
(§8) · **difficulty-depth** (min hop-count per axis; red-herring pressure; forced-insight density). Deliberate
non-goal for now: ambiguity-by-design (some literary endings) — currently forbidden by uniqueness.

## 10. Worked example — kindergarten → Christie by operators

Start: *"Silas poisons Edmund to hide he's been stealing."* Apply, each coherence-preserving and clued:
- **R2 displace-time** — doses at 20:50, "seen leaving" 21:05, dies 21:35 → a false alibi (apparent time ≠ true).
- **C1 fog** — nephew Rowan, disinherited, seen near the study at 21:30 → a second coherent suspect. The
  time-insight is what *clears Rowan and re-implicates Silas* (interaction).
- **C2 conceal + R5 gate** — Silas washes the decanter; the tox proof sits behind washed-cup → hidden
  dregs → lab test (a 3-rung discovery ladder).
- **R3 displace-identity** — the "man in Silas's coat" who left was wearing a *lent* coat (a witness's honest
  false belief).
- **R4 deepen-root** — the true motive is 20-year-old blackmail (over a forgery); the theft is derivative.
- **R9 + cascade** — an overlooked servant boy saw the yard; is silenced mid-investigation (escalation narrows access).
- **R6 double-bluff + R7 provenance** — the empty vial is *planted* on Rowan; its chain traces to Edmund's
  own prescribed heart tincture (means was the victim's own medicine).
- **R8 compromised authority (capstone)** — Dr Marsh falsified the time of death to protect the true
  blackmailer (Clara); the one authority the player trusted is the planted lie. **Fair only because the tox
  timing + the boy's account are an independent, reachable anchor that contradicts her finding.**

Final recap: a deep spine (blackmail → siphoning → confrontation → poisoning-with-the-victim's-own-medicine
→ staging → cover-ups) buried inside a fog (Rowan's affair sub-mystery; the suicide/accident scent; Marsh
in the frame), with two capstone inversions (the motive flip; the compromised authority) — every fact
grounded, timed, reachable; certifiable end to end.

## 11. Canon as operator expressions (expressiveness check)

- **Orient Express** ≈ false-alibi ⊗ N + R7 mutual-alibi ring + R4 deepen-root(kidnapping) + R10 conflate.
- **The ABC Murders** ≈ R11 camouflage-in-a-series + R14 reframe-the-question.
- **Hound of the Baskervilles** ≈ supernatural-fog + R3 impersonation(hidden heir) + inheritance-motive.
- **Silver Blaze** ≈ R13 negative-clue ("the dog didn't bark") + R3 mis-attribution.
- **Roger Ackroyd** ≈ R2 displace-time(dictaphone) + R6 omission, wrapped in a **P-layer** unreliable narrator
  (fact skeleton modest and fully certifiable; the genius is entirely presentation).
- **The Speckled Band** ≈ S2 barrier-crossing agent (snake via vent) + a lure; **Rue Morgue** ≈ S1
  hidden-route(window) + S2 non-human agent. Locked rooms **decompose** into space-axis operators — the sign
  the library is at the right granularity.
- **Midsomer** ≈ heavy village-web fog + R4 deepen-root(a covered-up death) + cascade.

## 12. Honest boundaries

- **Quality is never guaranteed.** The engine promises *coherent, fair, solvable, structurally deep*; it
  cannot promise *surprising* or *moving*. Obligations force Christie-*shape*, not Christie-*quality*.
- **The LLM confabulates.** Seeding the ontology + rubric makes it *more accurate*, never *correct*; the thin
  solver stays the hard floor, and its value *grows with ambition* (least needed at kindergarten depth,
  most needed at Christie depth under interactive, branch-wide play).
- **Cost.** Large webs + multiple timelines + identity uncertainty inflate the finite enumeration; tractable
  only because the load-bearing skeleton stays compact.

## 13. Build path (staged; substrate already exists)

The propose→compile→`validateCase`→repair→fallback loop already runs at small scale (Phases 1–4). What's
missing is depth on top of it. Order:
1. **The reduction schema** (Pass-2 occurrence/epistemic format) — the literal contract between free story
   and provable skeleton. The keystone artifact.
2. **Coherence-preserving operators** — recursion (spine) + composition (fog), each a local-checked transform.
3. **Depth + inversion obligations** — §8, §9 — as the composer's repair signals.
4. **Point the LLM composer at the schema**, obligations as feedback, deterministic sampler as fallback.
