# Certifier experiments

All 15 unique claims-version-2 cases passed the strict baseline `certify(case, true, true)`: 4 stable and 11 live. Inputs were deep-cloned before every certification.

## Scaling

Environment: Node v22.14.0, darwin/arm64, Apple M3 Pro (12 logical CPUs). Each case used 10 warmups and 100 measured iterations; cloning was outside the timed interval.

| Case | Class | Signs | Events | Depth | Median ms | P90 ms | P99 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| mk-live-20261002-235614 | stable | 45 | 31 | 5 | 3.7039 | 4.3935 | 5.947 |
| mk-live-20261002-225824 | stable | 59 | 34 | 5 | 3.9179 | 4.1799 | 4.4652 |
| mk-live-20261002-224855 | stable | 41 | 28 | 5 | 1.6042 | 1.9882 | 2.8006 |
| mk-live-20261002-222517 | stable | 36 | 24 | 6 | 1.324 | 1.723 | 1.8511 |
| mk-live-20261017-223841 | live | 35 | 29 | 8 | 2.2555 | 2.7988 | 3.9819 |
| mk-live-20261011-112405 | live | 37 | 23 | 5 | 1.5378 | 1.803 | 1.8693 |
| mk-live-20261003-135210 | live | 55 | 35 | 5 | 4.292 | 4.6159 | 5.2262 |
| mk-live-20261003-133036 | live | 41 | 33 | 5 | 1.4589 | 1.7597 | 1.8317 |
| mk-live-20261003-130906 | live | 50 | 40 | 7 | 2.7944 | 2.969 | 3.1994 |
| mk-live-20261003-130902 | live | 34 | 34 | 3 | 1.1153 | 1.3749 | 1.4587 |
| mk-live-20261003-100726 | live | 52 | 29 | 7 | 2.9358 | 3.0824 | 3.2155 |
| mk-live-20261003-085134 | live | 47 | 42 | 8 | 2.2825 | 2.3995 | 2.4906 |
| mk-live-20261003-082813 | live | 58 | 39 | 7 | 3.0962 | 3.2565 | 3.3292 |
| mk-live-20261003-082807 | live | 36 | 23 | 3 | 1.4819 | 1.6791 | 1.8358 |
| mk-live-20261003-082809 | live | 40 | 29 | 3 | 1.6589 | 1.8954 | 1.9351 |

- Median timing vs. signs: r=0.844 (very strong positive association).
- Median timing vs. events: r=0.4557 (moderate positive association).
- Median timing vs. solveDepth: r=0.3086 (weak positive association).

## Fault injection

| Fault | Applied | Detected | Skipped | Detection rate (applied only) |
|---|---:|---:|---:|---:|
| impossible_travel | 15 | 15 | 0 | 100% |
| missing_event_cause | 15 | 15 | 0 | 100% |
| unsupported_account_backing | 15 | 15 | 0 | 100% |
| unreachable_load_bearing_clue | 15 | 15 | 0 | 100% |
| duplicate_true_candidate | 15 | 15 | 0 | 100% |
| no_twist_public_copies | 14 | 14 | 1 | 100% |
| missing_motive_pillar | 15 | 15 | 0 | 100% |
| missing_means_pillar | 15 | 15 | 0 | 100% |
| depth_shortcut_public_copies | 15 | 15 | 0 | 100% |
| inconsistent_claims_without_defeat | 9 | 9 | 6 | 100% |

Skipped mutations are not counted as passes.

Strict hard-invalid mutations: 114/114 produced the expected rejection.
Quality probes: 29/29 remained strictly certified and changed the expected twist/depth diagnostic.

### Skips

- `no_twist_public_copies` / `mk-live-20261003-130902`: Baseline already has twist=false.
- `inconsistent_claims_without_defeat` / `mk-live-20261002-235614`: No existing defeat edge joins a jointly inconsistent claimed pair.
- `inconsistent_claims_without_defeat` / `mk-live-20261002-224855`: No existing defeat edge joins a jointly inconsistent claimed pair.
- `inconsistent_claims_without_defeat` / `mk-live-20261002-222517`: No existing defeat edge joins a jointly inconsistent claimed pair.
- `inconsistent_claims_without_defeat` / `mk-live-20261003-135210`: No existing defeat edge joins a jointly inconsistent claimed pair.
- `inconsistent_claims_without_defeat` / `mk-live-20261003-130902`: No existing defeat edge joins a jointly inconsistent claimed pair.
- `inconsistent_claims_without_defeat` / `mk-live-20261003-082809`: No existing defeat edge joins a jointly inconsistent claimed pair.

Every applied mutation produced its expected signal. Hard-invalid and quality-diagnostic totals are reported separately above.

## Metamorphic checks

| Transform | Checked | Passed | Violations |
|---|---:|---:|---:|
| deterministic_sign_and_candidate_reorder | 15 | 15 | 0 |
| bijective_sign_id_rename | 15 | 15 | 0 |
| add_inert_claimless_sign | 15 | 15 | 0 |

No violations were observed across the selected semantic projection (ok, solveDepth, maxDepth, surface, threads, pillars, mmoDepth, twist, key, motive, means, pillarSigns, unbacked, herrings, falseSigns). Inert-sign checks separately verified one added effective-depth entry at depth 0 and unchanged depths for all original signs.

## Reproducibility

Semantic fingerprint (excludes timing samples and environment): `3bbd4932b0f62ba2f0c5ff920f0483754fda130d59689d48b1ddb9eb29bb37e0`.

The JSON artifact contains case hashes, all timing samples, every per-case fault outcome and collateral error, transformation mappings, canonical semantic outputs, skips, and violations.
