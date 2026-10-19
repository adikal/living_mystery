# Generation funnel evidence

## Corpus

The parser enumerated `tools/refine-c/runs`. The strict completed cohort requires a parsed `final-case.json` or `00-seed.json` with `claims_version == 2` before joining `result.json`. It found 2 completed v2 run(s). The curated attempted-job view also includes the explicitly selected provider-censored `live-20261011-132544`; its claims version is unknown and this is not an exhaustive job cohort.

## Jobs

| Run | Row | Status | Success | Seconds | Target | Failure classification |
|---|---|---|---:|---:|---|---|
| live-20261011-112405 | completed_v2 | completed | yes | 552 | medium | completed_claims_v2 |
| live-20261017-223841 | completed_v2 | completed | yes | 463 | hard | completed_claims_v2 |
| live-20261011-132544 | attempted_job | censored | unavailable | unavailable | unavailable | external_provider_unavailable |

## Completed v2 results

| Run | Name | Signs | Events | People | Solve/max depth | Twist | Threads | Pillars |
|---|---|---:|---:|---:|---|---|---|---|
| live-20261011-112405 | live | 21 | 23 | 12 | 5/5 | yes | `{"c_dora":5,"c_edmund":5,"c_silas":5,"truth":5}` | `{"means":5,"motive":3,"opportunity":5}` |
| live-20261017-223841 | live | 21 | 29 | 12 | 8/8 | yes | `{"c_jonah":6,"c_silas":6,"c_vicar":6,"truth":8}` | `{"means":6,"motive":7,"opportunity":8}` |

## Funnel

| Measure | Count |
|---|---:|
| Attempted jobs | 3 |
| Completed v2 jobs | 2 |
| Completed v2 successes | 2 |
| Externally censored provider jobs | 1 |
| Algorithmic generation failures | 0 |
| Completed v2 history steps | 14 |
| Accepted steps | 14 |
| Recorded refinement candidate outcomes | 30 |
| Accepted refinement candidate outcomes | 14 |
| Rejected refinement candidates | 16 |
| Critic calls | 14 |
| Critic rejections | 0 |
| Provider-censored seed rounds | 4 |

## Rejection reasons

Counts are raw persisted reason strings; a candidate may have multiple reasons and categories. The JSON report preserves every raw string.

| Category | Completed v2 refinement | Provider-censored seed attempt | All |
|---|---:|---:|---:|
| `provider_call` | 0 | 4 | 4 |
| `patch_application` | 1 | 0 | 1 |
| `model_critic` | 0 | 0 | 0 |
| `refinement_law` | 27 | 0 | 27 |
| `hard_certification` | 0 | 0 | 0 |

## Availability and interpretation

- Exact LLM calls, tokens, and cost are unavailable because the live result artifacts do not persist them.
- The externally censored job has no persisted duration; timestamps in its log are not treated as an elapsed-duration measurement.
- Requested target is reported only when joined to published `difficulty.target`; it is not inferred from computed difficulty.
- The provider-censored attempt has no case object, so no claims version is inferred for it.
- Recorded candidate outcomes do not include cancelled or unfinished parallel model requests.

## Conclusion

The sample is too small for reliability claims.
