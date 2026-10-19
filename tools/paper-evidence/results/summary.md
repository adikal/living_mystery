# SleuthCraft offline evidence: summary

No paper text was changed. These results use existing cases, logs, and traces, plus deterministic mutations and engine replay. They make no model or network calls.

## Corpus

The stable and live manifests contain 15 unique claims-version-2 cases: 4 stable and 11 live. All 15 pass strict `certify(case, true, true)`, which enables both pillar and account-backing checks. The newly generated hard case, *A Tin from Fortnum's*, has solve depth 8.

Two completed generation runs now have persisted claims-v2 run artifacts (`live-20261011-112405` and
`live-20261017-223841`). A curated evidence view also includes one explicitly selected same-day attempt that was externally censored before producing a case
because Bedrock returned service-unavailable errors. It is not an algorithmic failure, an exhaustive job cohort, or a
success-rate denominator. Earlier completed run
folders contain claims-v1 artifacts and are excluded from claims-v2 generation reliability estimates.

## Generation funnel

The two completed claims-v2 runs:

- reached their requested targets: medium at depth 5 and hard at depth 8;
- completed in 552 and 463 seconds;
- accepted all 14 scheduled refinement steps;
- persisted 30 completed candidate outcomes: 14 accepted and 16 rejected;
- recorded 14 model-critic calls and 0 model-critic rejections;
- rejection reasons: 27 refinement-law reasons and 1 patch-application reason (candidates can carry multiple reasons);
- persisted no exact model-call total, token usage, or cost.

The selected same-day attempt was censored before producing a case because Bedrock returned service-unavailable
errors. This is an external availability event, not an algorithmic generation failure, and it is excluded from any
success-rate denominator. Two completed runs are still too few for a generation reliability estimate.

## Prospective C3/E2 bounded cohort

Cohort `c3-e2-pilot-20261018-135950` predeclared 12 fixed slots (4 easy, 4 medium, 4 hard), retained every slot without replacement or manual inclusion, used at most three workers, and completed in 3,304.219 seconds under the 3,600-second hard wall. The worktree was dirty throughout, so this evidence is preliminary/non-archival.

Eleven of 12 slots completed generation, publish-time wording, the strict Python/JavaScript/Z3 pre-publication gate, serialization, and the same post-serialization gate. Every completed case achieved its requested level: easy 3/4 (one crash), medium 4/4, and hard 4/4. Per-slot times were 391.201–981.436 seconds. No cases or manifests were published for play and premise history was not changed.

The cohort recorded 739 logical requests: 720 normal responses and 19 completions after cancellation was requested, with 0 unfinished requests. Complete usage was 5,371,669 input tokens, 1,310,767 output tokens, 1,011,714 cache-read input tokens, 24,736 cache-write input tokens, and 7,718,886 provider-reported total tokens. There were 0 SDK retry attempts. Twenty-four forced-tool-choice validation failures (HTTP 400) were retained as semantic repairs to automatic tool choice, separate from the 739 successful HTTP 200 responses. Effective serving models remained unknown because response metadata did not state them.

One easy slot crashed after its generated case had certified: publish enrichment left an invalid intermediate report, then difficulty rating accessed the absent `false_signs` field (`KeyError`). The harness now gates enriched cases before rating them, so this condition becomes an algorithmic pre-publication-gate failure rather than a crash. The frozen cohort outcome remains unchanged.

## E3 acceptance-policy replay

The offline replay evaluated 292 retained generator candidates over the identical candidate pool. Parse-only LLM acceptance retained 291/292; deterministic code/kernel/refinement laws retained 85/292; and the full typed-critic policy retained 72/292, rejected 182, and marked 38 not evaluable. Of those 38, 26 were seed candidates without a typed critic stage (one unparseable and 25 deterministic failures) and 12 were deterministically valid seed candidates; one deterministically valid refinement candidate was rejected by the typed critic. The replay made no model or network calls.

This is candidate-policy replay only. Alternative selections change later state and prompts, cancelled siblings can lack deterministic or critic outcomes, and seed candidates have no critic stage; therefore it cannot construct counterfactual final cases or establish end-to-end mystery quality.

## Certifier scaling

The recorded benchmark uses 10 warmups and 100 measurements per case on Node v22.14.0, Apple M3 Pro, with input
cloning excluded. Every per-case median and P90 was below 10 ms. Sign count had the strongest descriptive association
with median time; event count and solve depth were weaker. Timing samples vary with machine load, so the exact current
samples and correlations are reported in `certifier_experiments.json` and `.md`, while the reproducibility fingerprint
covers semantic outcomes only.

Certification is fast at the current case sizes.

## Fault injection

Ten mutation classes were applied independently to deep-cloned certified cases. The results separate strict
hard-invalid mutations from quality diagnostics:

- **114/114 applicable hard-invalid mutations** were rejected with the expected signal.
- **29/29 applicable quality probes** remained strictly certified but changed the expected twist or depth diagnostic.
- Seven precondition skips were excluded from both denominators.

| Fault/probe | Applied / expected signal | Skips |
|---|---:|---:|
| impossible travel | 15/15 | 0 |
| missing event cause | 15/15 | 0 |
| unsupported account backing | 15/15 | 0 |
| unreachable load-bearing clue | 15/15 | 0 |
| duplicate true candidate / non-unique answer | 15/15 | 0 |
| no twist (hard certificate remains valid; target signal fails) | 14/14 | 1 baseline already had no twist |
| missing motive pillar | 15/15 | 0 |
| missing means pillar | 15/15 | 0 |
| depth shortcut (hard certificate remains valid; depth drops) | 15/15 | 0 |
| inconsistent claims without a defeat | 9/9 | 6 had no suitable existing pair |

These are controlled synthetic faults on 15 cases. They establish detection for the implemented mutation operators, not complete recall over all possible malformed cases.

## Metamorphic checks

All 45 checks passed (15 cases × 3 transformations):

- deterministic sign and candidate reordering;
- bijective sign-ID renaming (outputs inverse-mapped before comparison);
- adding an inert claimless sign (only its expected depth-0 entry changes).

No field changed unexpectedly in the selected 15-field semantic projection (`ok`, depths, surface, threads, pillars,
twist, key evidence, motive/means evidence, backing, herrings and false signs). The inert-sign check separately
verified unchanged per-sign depths for every original sign.

## Executable engine replay

A deterministic real-engine autoplay execution was run for every case with 3 seeds and 5 initial-wait offsets (0, 5,
15, 30, 60 minutes): 225 executions under fixed NPC placement.

- 225/225 solved with the true accusation;
- 15/15 seed-17 baseline repeats were byte-for-byte identical in action log and exported session;
- all 15 cases had exact export/import/re-export round trips in every matrix, repeat and omission-control run;
- 30/30 motive/means evidence-omission controls were refused;
- all final diagnostics passed and all gated physical leads were eventually opened.

This is executable real-engine evidence under static, no-model schedules and fixed NPC placement. It exercises guarded
dispatch, travel, clue gates, testimony, accusation, diagnostics, and persistence. The three seeds do not create
distinct character schedules; robustness to model-driven movement or arbitrary future schedules remains untested.

The generic `searchInvestigation` API now found a replay-validated, testimony-bearing route for all 15 kernel cases. Across the cases, the physical catalogs contain 9–23 entries and the testimony catalogs 19–43 actual speaker/topic accounts. The searches explored 951 nodes in total with 0 search failures and 0 public-engine replay failures; selected 5–15 evidence signs; used 10–25 actions and 36–116 game minutes; and acquired testimony in every case. Candidate goals are reduced mechanically from certifier support and dependency closures rather than authored per-case itineraries. These are bounded existential witnesses under the current static schedule, 180-minute/32-action/16,000-node limits, finite catalogs, and current accusation rubric. Catalog incompleteness or budget exhaustion remains unresolved rather than establishing impossibility.

## Run-time concealment gate

In 27 e3c episodes (three cases, nine games each), compact traces contain:

- 48 code-valid, kernel-audited concealment candidates;
- 26 accepted as still solvable;
- 22 refused by the hard certificate;
- 9 additional final code-invalid concealment errors;
- 15 observed concealment set additions; every one has a same-or-prior accepted audit for the same episode and clue
  (the compact execution trace omits the executing person, so the association is scoped to episode/clue);
- 45 unique episode/person/clue opportunities and 3 repeated proposals.

The 22 kernel refusals comprise:

- 1 non-unique-answer result;
- 14 cases where a false sign would lose its reachable true defeater;
- 7 cases where culprit means evidence would be lost.

This directly establishes that the run-time gate fires in recorded play and refuses concrete certificate failures.
The 9 code-invalid entries are only the final persisted errors; compact traces omit revised first attempts. They also
omit raw/revised proposals, removed dependency closures, and before/after certificate reports.

## Depth and player behavior

The defensible e3c subset has only three independent cases (depths 3, 5, 7), with nine model-player episodes per case. Descriptive results do not establish monotonic difficulty:

| Depth | Solved | Median actions (all) | Median hints | Median solved-only actions |
|---:|---:|---:|---:|---:|
| 3 | 3/9 | 103 | 2 | 70 (n=3) |
| 5 | 4/9 | 99 | 2 | 79 (n=4) |
| 7 | 2/9 | 103 | 3 | 81.5 (n=2) |

Solved-only actions rise with depth in this sample, but n=3 cases and right-censoring make any correlation exploratory. More independent cases are required.

## Existing parity validation

The retained parity artifact reports 443 historical case artifacts compared, 0 Python/JavaScript mismatches, and 150
certified artifacts. This mixes claims versions and measures implementation conformance; it is not a claims-v2
generation-rate estimate. See `parity.json` and `parity.md`.

## Findings that affect the paper

1. The manifests contain 15 v2 cases (4 stable, 11 live); all pass strict certification.
2. Fault injection provides stronger central evidence than the current playtest headline: 114/114 applicable
   hard-invalid mutations were rejected, and 29/29 quality probes changed the expected diagnostic while remaining
   strictly certified. Metamorphic checks passed for all 45 selected-projection comparisons.
3. The run-time gate has direct aggregate evidence: 22 of 48 kernel-audited concealment proposals were refused; 15
   concealment set additions each had a same-or-prior accepted audit for the episode/clue.
4. Real-engine autoplay succeeds across all 225 static executions, independently of the generic bounded search. The bounded search now also finds testimony-bearing routes for all 15 cases, with 0 search or public-replay failures; this is existential evidence under the recorded finite bounds, not universal schedule robustness.
5. The prospective C3/E2 cohort improves generation evidence to a fixed denominator: 11/12 strictly gateable completions, with all 11 matching requested difficulty; one harness crash remains a real negative outcome.
6. E3 shows the deterministic layer is highly selective over raw parseable candidates (85/292 versus 291/292 parse-only), while the typed critic adds one observed rejection among deterministically valid refinement candidates. This is policy-mechanism evidence, not final-case quality evidence.
7. Current depth data are insufficient to validate depth as a behavioral difficulty measure; requested-versus-achieved structural agreement in E2 does not replace player-outcome validation.

## Reproducibility

- generation JSON SHA-256: `cee3acb149560206051439be0f937fecea0fa03987b8508112d5301d26d0587d`
- playtest JSON SHA-256: `5d9d0ecdc4bb0bd53a88288a6285dd684976abfe4c0a230015a70c3f0fef54a1`
- parity JSON SHA-256: `5bb9e125343948631a23f0bc88149c81c85258ceeb7cf52727d026c06e1e03d1`
- certifier semantic fingerprint (timings excluded): `3bbd4932b0f62ba2f0c5ff920f0483754fda130d59689d48b1ddb9eb29bb37e0`
- witness normalized fingerprint (timings excluded): `96a5e817c6b8f3bb0efa5dca40fb005d2965c165e8e5732aa386a121c0574d62`
- C3/E2 cohort normalized fingerprint (timings and provider request ids excluded): `0d4b02dbb7e516b0a7bd9f0be6ed11535e8c958c811dbc385c0359b9ab588369`
- E3 policy replay normalized fingerprint: `9c1477e20d16130424007b949c33585f62dea2db1ab3c7f7ea04a4cc6ce1138b`
