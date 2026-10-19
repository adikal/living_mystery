# E3 offline generation-policy replay

This replay uses cohort `c3-e2-pilot-20261018-135950` and **292 retained candidates** from **12 predeclared slots**. It makes no model or network calls.

All three policies see the identical retained candidate pool. The LLM-only arm retains JSON-object parsing only for schema/safety handling.

## Acceptance

| Policy | Accepted | Rejected | Not evaluable |
|---|---:|---:|---:|
| Structurally parseable LLM-only | 291 | 1 | 0 |
| Deterministic code/kernel/refinement laws | 85 | 207 | 0 |
| Full kernel + typed model critic | 72 | 182 | 38 |

## Candidate transitions

| Parse → deterministic → full | Candidates |
|---|---:|
| `0->0->-` | 1 |
| `1->0->-` | 25 |
| `1->0->0` | 181 |
| `1->1->-` | 12 |
| `1->1->0` | 1 |
| `1->1->1` | 72 |

## Final-case boundary

- This is candidate-policy replay, not end-to-end quality evaluation.
- Alternative acceptance changes the case state and therefore later prompts and candidate pools; final cases cannot be counterfactually reconstructed from the observed pool.
- A selected winner can leave a sibling cancelled, unfinished, or completed after cancellation without deterministic evaluation or a typed critic outcome.
- Publish enrichment candidates are not generator acceptance candidates and are outside these three arms.
- Seed candidates have deterministic certification but no typed model-critic stage, so the full policy is not evaluable for them.

These transitions describe acceptance mechanics over observed candidates. They do **not** establish end-to-end mystery quality or counterfactual final-case quality.

Timing-independent normalized SHA-256: `9c1477e20d16130424007b949c33585f62dea2db1ab3c7f7ea04a4cc6ce1138b`
