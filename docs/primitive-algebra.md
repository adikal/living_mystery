# Design note: a primitive algebra + certified LLM composition for mystery generation

Status: **blueprint for review** (local; not committed). This is the architecture behind "the LLM
imagines mysteries, the deterministic engine certifies them." It extends
[deduction-and-personas.md](deduction-and-personas.md), the [forensic model](forensic-model.md), and
the [symbolic-reasoning](symbolic-reasoning.md) contract. Every tenet holds: the engine owns reality,
the LLM never asserts a fact, and the symbolic layer is an *independent* oracle.

## The core idea

Mysteries are **compositions** over a small, human-authored **primitive algebra** (the physics and
epistemics of any investigation). The LLM composes new links/tropes and narrative from that algebra;
the engine compiles each composition to executable prehistory and **certifies** it (physical,
epistemic, reachability, distinguishability, multi-hop, multi-path). Nothing the LLM emits becomes a
fact until it reduces to grounded primitives and passes validation.

The **trust boundary** (non-negotiable): the LLM may *compose over* primitives without limit, but may
not *define* the primitives or their entailment checks — because an oracle cannot be produced by the
thing it validates, or "provably fair / no invented facts" becomes unverifiable.

## What already exists (≈60% of the substrate)

- Deterministic event-sourced engine + seed/log replay (ground truth).
- Finite IR + Z3 adapter: declarative dimensions, predicate-compiler registry, generic enumerator.
- `validateCase` obligations: physical, symbolic, epistemic, evidence, reachability, routes,
  distinguishability, **multi-hop**, **multi-path**, module invariants.
- `compileCrimeHistory` — already a physics-primitive checker (co-presence, possession, access,
  ordering, observation).
- Composable **bricks** — already a proto-composition system (hand-authored).
- "LLM proposes, engine disposes" — already the pattern for dialogue + NPC plans.

Missing: a **named primitive algebra**, a **general composition schema + compiler**, the **LLM composer**.

## Layer 1 — Entity ontology (typed)

`person · place · object · document · time · belief`. Every primitive is a relation over these types;
this shared ontology is what makes compositions chain (one link's effects feed the next's preconditions).

## Layer 2 — The primitive algebra (human-authored kernel, versioned)

~10–12 primitives, extracted from what `compileCrimeHistory` + the predicate compilers already check.
Each declares: **signature · preconditions · effects (on world state) · entailment (the claim it yields
and how the finite model / Z3 checks it)**. Candidate set:

| Primitive | Meaning (domain-invariant) |
|---|---|
| `Present(person, place, interval)` | an entity is at a place over a time interval |
| `Move(person, from, to)` | travel; consumes travel-time |
| `Holds(object, holder, interval)` / `Transfer(object, from, to, t)` | possession and its change |
| `Observe(observer, fact, t)` | perception; requires co-presence/access to the observed |
| `Author(person, document, t, content)` | who created an artifact and its content |
| `Trace(object, property)` | a physical property (material, shape, injury class) |
| `Believe(person, fact, source)` | belief with provenance; testimony ≠ truth |
| `Act(actor, preconditions, effects, t)` | a general action; effects follow causes in time |
| `Relation(person, person, kind)` | social tie (allegiance/interest) — the thin root of "motive" |

**Litmus (enforced): a primitive may name no specific noun.** `Present` is a primitive; `at_the_manor`
is content. "Brass seal," "estate fraud," "blackmail" are **compositions**, never primitives.

The algebra is **versioned** (`PRIMITIVE_ALGEBRA_VERSION`) and grows only by rare, reviewed, test-gated
additions — never per-mystery, never by the runtime LLM (which may *suggest* an extension, not adopt it).

## Layer 3 — Compositions (LLM-generated, engine-certified)

A case (or trope) is declared data: a set of **links** (primitive instances with role-bindings) +
`requires`/`requiresAny` chaining + clue/route mapping. Examples that are compositions, not primitives:
- **false-alibi** = `Present`(claimed) diverging from `Present`(true), contradicted by a `Transfer`/`Observe`.
- **blackmail** = `Author`(letter) + `Transfer`(payment) + `Observe`(the meeting).
- **forged-will** = `Author`(document) + `Trace`(signature mismatch) + a `Relation` adverse interest.

## Layer 4 — The compiler

`composition + cast/map bindings → executable prehistory occurrences (via the kernel) + typed claims +
proof-route membership`, reducing every link to grounded primitives. The existing `validateCase`
obligations then run unchanged. Proof of adequacy: re-express today's bricks as compositions.

## Layer 5 — The LLM composer (prep-time, gated, cached)

`LLM proposes a composition (strict JSON schema: link DAG + narrative + indirection) → compile →
validateCase → structured failure feedback → repair (bounded retries) → cache`. Deterministic sampler
stays as fallback and offline oracle. **Never runs at play time.**

## Build phases (each independently valuable; kernel earns trust before the LLM leans on it)

1. **Extract & name the primitive algebra** — behavior-preserving refactor of `compileCrimeHistory` +
   predicate compilers; all tests stay green. (Low risk; the real intellectual work is the minimal set.)
2. **Composition schema + compiler** — declarative links; re-express existing bricks as compositions
   (the closure check against real content).
3. **Prove generality** — author 2–3 *deliberately divergent* mysteries (delayed-effect poisoning,
   locked-room, two-person collusion); require they all reduce to the same kernel. This suite is the
   permanent cross-mystery regression gate; anything forcing a new primitive is a reviewed extension.
4. **LLM composer** — schema-constrained generation + compile/validate/repair loop + cache; sampler fallback.
5. **New settings** (later) — new casts/maps/relations reuse the kernel + composer; add the asset
   pipeline with cost budgets.

## Cross-cutting requirements ("designing it right")

- **Trust boundary in code**: kernel (primitives + entailment + compiler) is authored/versioned;
  compositions are generated + certified. The validator trusts only primitives.
- **Versioning + migration**: algebra and schema versioned; saved cases record versions; additive,
  regression-gated growth.
- **Machine-actionable validator feedback**: each obligation returns a structured, specific failure so
  the repair loop converges.
- **Determinism preserved**: compositions compile to the same event-sourced prehistory; replay unchanged.
- **Property-based tests**: every sampled/generated composition passes all obligations; divergent-case
  suite; regression on every kernel change.
- **Cost controls**: composition is prep-time, cached, budgeted (generalize the asset-gen controls).

## Honest hard parts

- Choosing the minimal-complete primitive set (converge via divergent cases + the no-nouns litmus).
- Compiler reduction correctness (compositions must faithfully reduce to grounded prehistory).
- LLM repair convergence (many invalid proposals; needs good feedback + bounded retries + fallback).
- Motive/psychology only partially primitivizes; keep pure narrative as *uncertified dressing* over a
  certified physical/epistemic skeleton.
- Kernel scope creep (guarded by the litmus, versioning, and human review).

## Deliverables

1. Entity-ontology spec · 2. Primitive-algebra spec (versioned) · 3. Composition-schema spec ·
4. Compiler · 5. Divergent-case generality suite · 6. LLM composer + repair loop + cache ·
7. Trust-boundary + versioning doc.

## Recommended first step

Phase 1: extract the primitive algebra from what is already implicit in `compileCrimeHistory` and the
predicate compilers — a behavior-preserving refactor that forces us to name the primitives precisely.
