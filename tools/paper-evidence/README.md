# Paper evidence experiments

Offline, reproducible analyses supporting the SleuthCraft paper. The analysis commands below do not call a model or network service.
The separately bounded C3/E2 acquisition command does call Bedrock Runtime `Converse` in `us-west-2`; it writes raw
prompts/responses only below the ignored `tools/refine-c/runs/experiments/` tree and never publishes playable cases.
Run from the repository root:

```sh
python3 tools/paper-evidence/generation_funnel.py
.venv/bin/python tools/paper-evidence/generation_policy_replay.py --cohort tools/refine-c/runs/experiments/<cohort-id>
node tools/paper-evidence/certifier_experiments.mjs
node tools/paper-evidence/witness_sweep.mjs
node tools/paper-evidence/committed_concealment_audit.mjs
node tools/paper-evidence/e1_gate_ablation.mjs
.venv/bin/python tools/paper-evidence/playtest_analysis.py
.venv/bin/python tools/paper-evidence/corpus_depth_planning.py
.venv/bin/python tools/paper-evidence/parity_capture.py
```

To acquire a new fixed 12-slot C3/E2 cohort (4 easy, 4 medium, 4 hard; maximum three workers; hard one-hour wall):

```sh
.venv/bin/python tools/refine-c/generation_cohort.py --cohort-id <cohort-id> --wall-seconds 3600
```

To evaluate the final whole-case publication critic once on every completed strictly gateable case in a frozen cohort
(the model prompt is blinded to requested level and deterministic gate outcome; raw evidence stays private):

```sh
.venv/bin/python tools/refine-c/publication_critic_pilot.py \
  --cohort tools/refine-c/runs/experiments/<cohort-id> --wall-seconds 3600
```

Outputs are written to `tools/paper-evidence/results/` as JSON (full audit trail) and Markdown (readable report).

- `generation_funnel`: strict claims-v2 generation artifacts only; legacy claims-v1 runs are excluded.
- `generation_cohort_pilot`: prospective C3/E2 denominator, terminal outcomes, requested-versus-achieved difficulty, request lifecycle, usage, certificates and hashes for the bounded cohort; raw prompts and cases remain private/ignored.
- `publication_critic_pilot`: availability-selected, blinded final whole-case critic outcomes over every completed strictly gateable case in a frozen cohort; retains PASS/FAIL/UNAVAILABLE, issue counts/digests, request/usage totals, exact hashes and private audited provenance with finding text, and is not accuracy evidence.
- `generation_policy_replay`: E3 offline replay of parse-only, deterministic code/kernel/refinement, and full typed-critic acceptance over the identical retained candidate pool; it does not reconstruct counterfactual final cases or measure end-to-end quality.
- `certifier_experiments`: strict certification timing, fault injection, and metamorphic checks on every unique v2 case in the stable and live manifests.
- `witness_sweep`: deterministic real-engine autoplay under fixed NPC placement across seeds and initial-wait offsets, repeatability/save-import checks, pillar omission controls, and a native-search coverage-gap probe.
- `committed_concealment_audit`: direct session-aware strict certification of every cumulative concealed-set state observed in the schema-selected 27-episode `e3c` cohort, kept separate from historical planning-audit association.
- `e1_gate_ablation`: deterministic offline mechanism ablation over fixed captured/synthetic proposals, comparing planning+execution, planning-only, and no-kernel-gate enforcement without exposing unsafe modes to game saves or UI.
- `playtest_analysis`: case-level depth descriptives and run-time concealment-gate audit on archived episodes, with structural depths re-certified by the current kernel.
- `corpus_depth_planning`: structural distributions and feasible sampling strata across all current unique claims-v2 cases; it makes no behavioral-difficulty claims.

Timing samples vary between runs. Each script records or reports a timing-independent semantic fingerprint where applicable.
The concise cross-experiment interpretation is in `results/summary.md`.
