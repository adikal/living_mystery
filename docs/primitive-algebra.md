# Design note: a primitive algebra + certified LLM composition for mystery generation

Status: **implemented through Phase 4 + an affordance grammar** (Edition 0.11; local, not pushed). This
is the architecture behind "the LLM imagines mysteries, the deterministic engine certifies them." It
extends [deduction-and-personas.md](deduction-and-personas.md), the [forensic model](forensic-model.md),
and the [symbolic-reasoning](symbolic-reasoning.md) contract. Every tenet holds: the engine owns reality,
the LLM never asserts a fact, and the symbolic layer is an *independent* oracle.

## Implementation status (Edition 0.11)

All five layers of the blueprint below are now built, plus an **affordance grammar** that generalizes
the "means" axis from a fixed enum to an open object catalog:

- **Phase 1 — primitive kernel** — `dist/primitives.mjs`: `PRIMITIVE_ALGEBRA_VERSION`, the typed entity
  ontology, the `CONSTRAINT` primitives (`within/is/isNot/elsewhere/soleAt/soleAtOffset`), the claim
  predicates re-expressed as thin compositions of them, and `occurrenceFacts`. `forensics.mjs` imports
  from it; behaviour-preserving.
- **Phase 2 — composition compiler** — `dist/composition.mjs`: a composition is pure data (clues, typed
  claims, proof-route membership, method options, a prehistory occurrence-DAG, optional non-authoritative
  dialogue); `moduleFromComposition()` compiles it into brick hooks. `manner-of-death` and `poisoning`
  are re-expressed as compositions, proving adequacy.
- **Phase 3 — divergent types** — staged-suicide (a second manner), **collusion** (a shielding ally's
  false alibi, caught by the contradiction engine), and **delayed-effect poisoning** (toxicology fixes
  the administration window, not the death) — all in the sampler and certified.
- **Phase 4 — LLM composer** — `dist/llm-composer.mjs`: proposes a spec over the validated palette →
  `buildSpec` → `validateCase` → structured-feedback repair loop → deterministic sampler fallback;
  per-seed cache; a seed-driven "lead" + varied temperature for spread. Wired into the app as
  "Generate with AI". Verified live.
- **Affordance grammar (means as data)** — `dist/primitives.mjs` `AFFORDANCES` (harm/transfer/times/
  gates/marks/conceals/vanishes/fakes, each reducing to a kernel predicate) + `dist/objects.mjs` (the
  object catalog) + `dist/mechanism.mjs` (an affordance-typed composition, validated against the
  grammar). New objects — icicle (a vanishing blunt weapon), silk scarf (asphyxiant), rigged chandelier
  (a set-and-leave fall) — are ~one data entry each.
- **Forced-insight obligation** — `checkForcedInsight` in `casegen.mjs`: a clue a brick declares via
  `forces` must be load-bearing (removing it drops the true accusation's support), so a twist is
  required rather than decorative.

Remaining from the blueprint: new **settings/casts** (the world is still the one Bellweather cast), and
richer *machine-checkable difficulty* (see "Honest hard parts").

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

Missing at blueprint time — a **named primitive algebra**, a **general composition schema + compiler**,
the **LLM composer** — are all now built (see Implementation status). What remains is new **settings**
and richer machine-checkable difficulty.

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

1. ✅ **Extract & name the primitive algebra** — `dist/primitives.mjs`; behaviour-preserving refactor of
   `compileCrimeHistory` + predicate compilers; all tests stayed green.
2. ✅ **Composition schema + compiler** — `dist/composition.mjs`; `manner-of-death` and `poisoning`
   re-expressed as compositions (the closure check against real content).
3. ✅ **Prove generality** — staged-suicide, two-person collusion, and delayed-effect poisoning authored
   as divergent types, all reducing to the same kernel and passing every obligation.
4. ✅ **LLM composer** — `dist/llm-composer.mjs`; schema-constrained proposal + compile/validate/repair +
   cache + sampler fallback; wired into the app.
4a. ✅ **Affordance grammar (means as data)** — a finite grammar of object affordances (`AFFORDANCES`) +
   an object catalog (`objects.mjs`) + a mechanism compiler (`mechanism.mjs`). New murder objects are
   mostly data; each affordance reduces to a validated kernel predicate, so creativity is unbounded at
   the object/narrative layer while correctness stays bounded in the grammar.
5. ⏳ **New settings** (later) — new casts/maps/relations reuse the kernel + composer; add the asset
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

- Choosing the minimal-complete primitive set (converge via divergent cases + the no-nouns litmus). *Now
  grounded: three divergent types + the affordance grammar reduce to the same kernel.*
- Compiler reduction correctness (compositions must faithfully reduce to grounded prehistory). *Enforced
  by the unchanged `validateCase` obligations running on every compiled composition.*
- LLM repair convergence (many invalid proposals; needs good feedback + bounded retries + fallback).
  *Built: structured obligation feedback + a deterministic sampler fallback that is always certified.*
- **Machine-checkable difficulty/depth (open).** `forcedInsight` makes a declared twist *load-bearing*,
  but "solvability" is still table stakes: many sampled cases remain shallow (a single obvious means).
  The next lever is obligations that grade *inference depth* (minimum hop count on the means/motive/
  time axes), *red-herring pressure* (tempting wrong paths), and *required-insight density*, so the
  generator/composer is scored on being genuinely hard-to-solve, not merely valid.
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
