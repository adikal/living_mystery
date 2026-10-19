#!/usr/bin/env python3
"""E3 offline acceptance-policy replay over one frozen C3 cohort."""
from __future__ import annotations

import argparse
import collections
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESULTS = Path(__file__).resolve().parent / "results"
EXPERIMENTS = ROOT / "tools" / "refine-c" / "runs" / "experiments"
SCHEMA_VERSION = "e3-generation-policy-replay-v1"


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def sha(value):
    if not isinstance(value, bytes):
        value = value.encode() if isinstance(value, str) else canonical(value).encode()
    return hashlib.sha256(value).hexdigest()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def latest_cohort():
    candidates = sorted(path for path in EXPERIMENTS.glob("*/cohort.json"))
    if not candidates:
        raise FileNotFoundError("No C3 cohort manifest found")
    return candidates[-1].parent


def candidate_row(slot_id, request):
    semantic = request.get("semantic") or {}
    phase = semantic.get("phase")
    purpose = semantic.get("purpose")
    parse = request.get("parse_result") or {}
    parseable = request.get("status") in ("response", "completed-after-cancel") and parse.get("ok") is True and parse.get("object") is True
    deterministic = parseable and request.get("code_verdict") == "PASS"
    critic = request.get("typed_critic_outcome")
    if purpose == "seed-generation":
        full = None
        full_reason = "not-evaluable: seed candidates have no typed model-critic stage"
    else:
        full = deterministic and critic == "PASS"
        full_reason = None if critic is not None else "not-accepted: no retained typed critic outcome"
    return {
        "slot_id": slot_id,
        "logical_request_id": request.get("logical_request_id"),
        "candidate_id": semantic.get("candidate"),
        "phase": phase,
        "purpose": purpose,
        "step": semantic.get("step"),
        "round": semantic.get("round"),
        "candidate_hash": request.get("candidate_hash") or ((request.get("parsed_response") or {}).get("sha256")),
        "request_status": request.get("status"),
        "online_selection": request.get("selection"),
        "typed_critic_outcome": critic,
        "policies": {
            "structurally_parseable_llm_only": {"accepted": parseable, "retained_checks": ["JSON object parsing"]},
            "deterministic_code_kernel_refinement": {"accepted": deterministic, "code_verdict": request.get("code_verdict"),
                                                     "errors": request.get("code_errors", [])},
            "full_kernel_typed_model_critic": {"accepted": full, "reason": full_reason},
        },
        "transition": f"{int(parseable)}->{int(deterministic)}->{'-' if full is None else int(full)}",
    }


def normalized(evidence):
    value = copy.deepcopy(evidence)
    value.pop("generated_at", None)
    value.pop("normalized_sha256", None)
    value.pop("cohort_manifest_sha256", None)
    return value


def build(cohort_dir):
    cohort_dir = Path(cohort_dir)
    cohort = json.loads((cohort_dir / "cohort.json").read_text())
    candidates = []
    missing_manifests = []
    for slot in cohort["slots"]:
        manifest_path = cohort_dir / "slots" / slot["slot_id"] / "manifest.json"
        if not manifest_path.exists():
            missing_manifests.append(slot["slot_id"])
            continue
        manifest = json.loads(manifest_path.read_text())
        for request in manifest.get("requests", []):
            if (request.get("semantic") or {}).get("purpose") in ("seed-generation", "refinement-candidate"):
                candidates.append(candidate_row(slot["slot_id"], request))
    candidates.sort(key=lambda row: (row["slot_id"], row.get("phase") or "", row.get("step") or 0,
                                     row.get("round") or 0, row.get("logical_request_id") or ""))
    transitions = collections.Counter(row["transition"] for row in candidates)
    policy_counts = {}
    for policy in ("structurally_parseable_llm_only", "deterministic_code_kernel_refinement", "full_kernel_typed_model_critic"):
        values = [row["policies"][policy]["accepted"] for row in candidates]
        policy_counts[policy] = {"accepted": sum(value is True for value in values),
                                 "rejected": sum(value is False for value in values),
                                 "not_evaluable": sum(value is None for value in values)}
    decisions = collections.defaultdict(list)
    for row in candidates:
        decisions[(row["slot_id"], row["phase"], row["step"], row["round"])].append(row)
    decision_rows = []
    for key, rows in sorted(decisions.items(), key=lambda item: tuple("" if value is None else str(value) for value in item[0])):
        selected = {}
        for policy in policy_counts:
            selected[policy] = next((row["candidate_id"] for row in rows if row["policies"][policy]["accepted"] is True), None)
        decision_rows.append({"slot_id": key[0], "phase": key[1], "step": key[2], "round": key[3],
                              "retained_candidates": len(rows), "first_accepted_candidate": selected})
    evidence = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "cohort_id": cohort["cohort_id"],
        "cohort_manifest_sha256": sha((cohort_dir / "cohort.json").read_bytes()),
        "offline": True,
        "network_calls": 0,
        "identical_pool_rule": "All policies are evaluated over the same retained C3 candidate rows, in logical-request order.",
        "policies": {
            "structurally_parseable_llm_only": "Accept a retained response iff it parses to a JSON object. Parsing is retained only for schema/safety handling; no code, kernel, refinement-law, or critic judgment is applied.",
            "deterministic_code_kernel_refinement": "Accept iff the same retained candidate passed parsing and the recorded deterministic code/kernel/refinement laws.",
            "full_kernel_typed_model_critic": "For refinement candidates, accept iff deterministic checks passed and the retained typed critic outcome is PASS. Seed candidates are not evaluable because the online design has no seed critic.",
        },
        "denominator": {"cohort_slots": len(cohort["slots"]), "retained_candidates": len(candidates),
                        "slots_without_request_manifests": missing_manifests},
        "policy_counts": policy_counts,
        "transition_counts": dict(sorted(transitions.items())),
        "candidates": candidates,
        "decision_replay": decision_rows,
        "final_case_construction_limitations": [
            "This is candidate-policy replay, not end-to-end quality evaluation.",
            "Alternative acceptance changes the case state and therefore later prompts and candidate pools; final cases cannot be counterfactually reconstructed from the observed pool.",
            "A selected winner can leave a sibling cancelled, unfinished, or completed after cancellation without deterministic evaluation or a typed critic outcome.",
            "Publish enrichment candidates are not generator acceptance candidates and are outside these three arms.",
            "Seed candidates have deterministic certification but no typed model-critic stage, so the full policy is not evaluable for them.",
        ],
    }
    evidence["normalized_sha256"] = sha(normalized(evidence))
    return evidence


def render(evidence):
    lines = [
        "# E3 offline generation-policy replay", "",
        f"This replay uses cohort `{evidence['cohort_id']}` and **{evidence['denominator']['retained_candidates']} retained candidates** from **{evidence['denominator']['cohort_slots']} predeclared slots**. It makes no model or network calls.", "",
        "All three policies see the identical retained candidate pool. The LLM-only arm retains JSON-object parsing only for schema/safety handling.", "",
        "## Acceptance", "", "| Policy | Accepted | Rejected | Not evaluable |", "|---|---:|---:|---:|",
    ]
    labels = {
        "structurally_parseable_llm_only": "Structurally parseable LLM-only",
        "deterministic_code_kernel_refinement": "Deterministic code/kernel/refinement laws",
        "full_kernel_typed_model_critic": "Full kernel + typed model critic",
    }
    for policy, counts in evidence["policy_counts"].items():
        lines.append(f"| {labels[policy]} | {counts['accepted']} | {counts['rejected']} | {counts['not_evaluable']} |")
    lines.extend(["", "## Candidate transitions", "", "| Parse → deterministic → full | Candidates |", "|---|---:|"])
    for transition, count in evidence["transition_counts"].items():
        lines.append(f"| `{transition}` | {count} |")
    lines.extend(["", "## Final-case boundary", ""])
    lines.extend(f"- {item}" for item in evidence["final_case_construction_limitations"])
    lines.extend(["", "These transitions describe acceptance mechanics over observed candidates. They do **not** establish end-to-end mystery quality or counterfactual final-case quality.", "",
                  f"Timing-independent normalized SHA-256: `{evidence['normalized_sha256']}`", ""])
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cohort", type=Path)
    args = parser.parse_args()
    evidence = build(args.cohort or latest_cohort())
    atomic_json(RESULTS / "generation_policy_replay.json", evidence)
    (RESULTS / "generation_policy_replay.md").write_text(render(evidence))
    print(evidence["normalized_sha256"])


if __name__ == "__main__":
    main()
