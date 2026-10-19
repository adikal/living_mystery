# E1 offline/local kernel-gate mechanism ablation

Normalized SHA-256: `d1400f9ed4e535ea3164c2b33406ea16b27d2fcf904d3225f88337f51014371d`

Status: **preliminary/non-archival**.

**Scope: mechanism experiment, not model-policy frequency.** Fixed captured/synthetic proposals establish causal mechanism behavior; these counts do not estimate proposal frequency from any model.

## Aggregate outcomes

| Mode | Opportunities | Planning refusals | Execution refusals | Kernel execution refusals | Acquired cancellations | Unsafe committed states | Final strict pass |
|---|---:|---:|---:|---:|---:|---:|---:|
| planning_execution | 7 | 3 | 2 | 1 | 1 | 0 | 8/8 |
| planning_only | 7 | 3 | 1 | 0 | 1 | 1 | 7/8 |
| no_kernel_gate | 7 | 0 | 1 | 0 | 1 | 3 | 5/8 |

## Scenario outcomes

| Scenario | Mode | Code errors | Line refusals | Planning refusals | Execution refusals | Unsafe commits | Final strict | Concealed roots |
|---|---|---:|---:|---:|---:|---:|---|---|
| safe_concealment | planning_execution | 0 | 0 | 0 | 0 | 0 | pass | `s_telegram` |
| safe_concealment | planning_only | 0 | 0 | 0 | 0 | 0 | pass | `s_telegram` |
| safe_concealment | no_kernel_gate | 0 | 0 | 0 | 0 | 0 | pass | `s_telegram` |
| individually_unsafe_clue | planning_execution | 0 | 0 | 1 | 0 | 0 | pass | none |
| individually_unsafe_clue | planning_only | 0 | 0 | 1 | 0 | 0 | pass | none |
| individually_unsafe_clue | no_kernel_gate | 0 | 0 | 0 | 0 | 1 | fail | `s_letter` |
| cumulative_pair_unsafe_only_together | planning_execution | 0 | 0 | 1 | 0 | 0 | pass | `s_hound` |
| cumulative_pair_unsafe_only_together | planning_only | 0 | 0 | 1 | 0 | 0 | pass | `s_hound` |
| cumulative_pair_unsafe_only_together | no_kernel_gate | 0 | 0 | 0 | 0 | 1 | fail | `s_hound`, `s_hound_backup` |
| false_sign_defeater_cancellation_race | planning_execution | 0 | 0 | 0 | 1 | 0 | pass | `s_rowan_test` |
| false_sign_defeater_cancellation_race | planning_only | 0 | 0 | 0 | 0 | 1 | fail | `s_rowan_retract`, `s_rowan_test` |
| false_sign_defeater_cancellation_race | no_kernel_gate | 0 | 0 | 0 | 0 | 1 | fail | `s_rowan_retract`, `s_rowan_test` |
| acquired_clue_cancellation | planning_execution | 0 | 0 | 0 | 1 | 0 | pass | none |
| acquired_clue_cancellation | planning_only | 0 | 0 | 0 | 1 | 0 | pass | none |
| acquired_clue_cancellation | no_kernel_gate | 0 | 0 | 0 | 1 | 0 | pass | none |
| retained_pending_concealment | planning_execution | 0 | 0 | 1 | 0 | 0 | pass | none |
| retained_pending_concealment | planning_only | 0 | 0 | 1 | 0 | 0 | pass | none |
| retained_pending_concealment | no_kernel_gate | 0 | 0 | 0 | 0 | 0 | pass | `s_hound_backup` |
| line_validation_control | planning_execution | 0 | 1 | 0 | 0 | 0 | pass | none |
| line_validation_control | planning_only | 0 | 1 | 0 | 0 | 0 | pass | none |
| line_validation_control | no_kernel_gate | 0 | 1 | 0 | 0 | 0 | pass | none |
| code_validation_control | planning_execution | 1 | 0 | 0 | 0 | 0 | pass | none |
| code_validation_control | planning_only | 1 | 0 | 0 | 0 | 0 | pass | none |
| code_validation_control | no_kernel_gate | 1 | 0 | 0 | 0 | 0 | pass | none |

## Isolation and interpretation

- Every arm in a scenario starts from the same canonical session hash and has the same code/line validation hash.
- The line critic is a fixed local verdict map; no model or network call occurs.
- Unsafe modes exist only inside this process and never call UI, persistence, import/export, or save APIs.
- Strict certificates are still computed observationally in ablated arms so unsafe commits are measured directly.

## Provenance

- Commit: `a2716a8643d8177914a5decb94edf474bf9c77f5`
- Branch: `main`
- Node: `v22.14.0`
- Worktree dirty: `true`
- Hashed manifests: 1; hashed inputs: 6

