# Archived playtest depth and run-time gate analysis

## Depth association (case-level, exploratory)

The archive contains **27 episodes across 3 independent cases** (`mk-live-20261003-082809` n=9, `mk-live-20261003-135210` n=9, `mk-live-20261003-130906` n=9). Episodes join to scores by `id`; each score's archived case path is re-certified by the current strict certifier. Snapshot disagreements: **0/3 cases**.

Normalized case-set SHA-256: `4e6afa3cd8e950758474f63b2c210855a752b7ea8624548735570ac59e79e668`.

| Case | Instantaneous depth | Stable depth | Solved | Correct | All-run actions median (range) | All-run hints median (range) | All-run stall median (range) | Solved-only actions median (range) | Censored |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `mk-live-20261003-082809` | 3 | 3 | 3/9 (33.3%) | 3/9 (33.3%) | 103 (39–110); n=9 | 2 (0–12); n=9 | 17 (0–34); n=9 | 70 (39–88); n=3 | 6/9 |
| `mk-live-20261003-135210` | 5 | 5 | 4/9 (44.4%) | 4/9 (44.4%) | 99 (61–110); n=9 | 2 (0–16); n=9 | 18 (0–29); n=9 | 79 (61–91); n=4 | 5/9 |
| `mk-live-20261003-130906` | 7 | 7 | 2/9 (22.2%) | 2/9 (22.2%) | 103 (67–105); n=9 | 3 (0–8); n=9 | 14 (0–28); n=9 | 81.5 (67–96); n=2 | 7/9 |

Spearman correlations use **n=3 case aggregates**. The 27 episodes are repeated observations, not independent depth units.

| Case-level measure | Spearman ρ | Independent cases |
|---|---:|---:|
| solve rate | -0.5 | 3 |
| correct rate | -0.5 | 3 |
| median all run actions | 0 | 3 |
| median all run hints | 0.866025 | 3 |
| median all run longest stall | -0.5 | 3 |
| median solved only actions | 1 | 3 |

**Right-censoring (18/27 runs):** Unsolved runs are right-censored: an out-of-budget or quit episode ends before a solve, so observed actions are a lower bound on actions-to-solve. All-run summaries remain descriptive, solved-only summaries are separate, and no survival-model inference is attempted.

## Run-time gate audit

Across 27 episodes, **26/48 candidates were accepted** and **22/48 refused**.

| Distinct event | Count |
|---|---:|
| Kernel-audited concealment candidates | 48 |
| Final code-invalid `(conceal)` errors | 9 |
| Actual concealment executions | 15 |
| Executions with same-or-prior accepted episode/clue audit | 15 |

Kernel-audited candidates, code-invalid conceal errors, and actual concealment executions are distinct events; none is used as a proxy for another.

### Kernel verdicts

| `audit.solvable` value | Count | Classification |
|---|---:|---|
| still solvable | 26 | accepted |
| answer not unique from all reachable evidence: survivors ["c_rowan","c_vera","c_vicar"] | 1 | refused |
| false sign s_ada_lie has no reachable, true defeater deeper than it | 6 | refused |
| false sign s_vera has no reachable, true defeater deeper than it | 4 | refused |
| false sign s_watch has no reachable, true defeater deeper than it | 4 | refused |
| no reachable, true evidence of the culprit's MEANS (a possession or trait claim the culprit satisfies) | 7 | refused |

### Opportunities and repeats

There are **45 unique episode/person/clue opportunities**; 3/48 candidate verdicts are repeated proposal instances across 3 opportunities.

| Episode | Person | Clue | Proposals |
|---|---|---|---:|
| `mk-live-20261003-082809__pro__suspicious__s1` | `vera` | `s_burnt` | 2 |
| `mk-live-20261003-135210__amateur__impatient__s2` | `dora` | `s_burnt_pages` | 2 |
| `mk-live-20261003-135210__beginner__literal__s3` | `vera` | `s_envelope` | 2 |

### Representative parsed examples

- **Accepted, not executed:** episode `mk-live-20261003-082809__beginner__literal__s1`, trace 23, person `iris`, clue `s_medical`; reason: still solvable. accepted by the kernel audit but the clue was never added to concealed in this episode
- **Refused:** episode `mk-live-20261003-082809__amateur__literal__s1`, trace 43, person `jonah`, clue `s_duckweed`; reason: false sign s_vera has no reachable, true defeater deeper than it. refused by the kernel solvability audit
- **Mixed plan:** episode `mk-live-20261003-082809__amateur__methodical__s2`, trace 50, person `jonah`, clue `s_duckweed`; reason: false sign s_vera has no reachable, true defeater deeper than it. this concealment was refused while another person's plan survived and the director status remained accepted; surviving plan: `hugo`.
- **Accepted, then executed:** episode `mk-live-20261003-082809__amateur__chatty__s3`, trace 34, person `vera`, clue `s_burnt`; reason: still solvable. accepted by the kernel audit and later observed as a cumulative concealed-set addition; execution trace: 35.

Examples are selected deterministically from parsed records, not by hardcoded episode IDs or trace indexes.

## Data completeness limitations

- Compact traces omit raw and revised director proposals.
- Compact traces omit removed closure and before/after solvability certificates.
- Accepted proposal rationale and full agenda steps are unavailable; example reasons therefore use the persisted audit.solvable verdict.
- Browser logs lack session IDs and are excluded rather than heuristically joined.
- Episodes do not embed an immutable case payload; the analysis certifies each currently referenced case file and records its normalized hash so later file drift is detectable but prior payloads cannot be reconstructed.
- Structural quantities describe certified case topology; they are not behavioral difficulty measurements.
