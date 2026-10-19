#!/usr/bin/env python3
"""Deterministic paired A/A playtest analysis for E6.

The acquisition runs are model-calling; this analyzer is offline. Every planned episode remains in the
denominator, including missing and failed episodes. Case is an equal-weight blocking factor, and intervals are
nominal calibration descriptors rather than treatment-effect claims.
"""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[2]
PLAYTEST_DIR = ROOT / "tools" / "playtest"
if str(PLAYTEST_DIR) not in sys.path:
    sys.path.insert(0, str(PLAYTEST_DIR))
from comparison_audit import ComparisonAuditError, require_passing_audit  # noqa: E402
RESULT_DIR = Path(__file__).resolve().parent / "results"
DEFAULT_JSON = RESULT_DIR / "aa_playtest_analysis.json"
DEFAULT_MARKDOWN = RESULT_DIR / "aa_playtest_analysis.md"

METRICS = (
    "solved", "correct", "actions_or_censored_action_budget", "hints_helped", "longest_stall",
    "fallback_or_decline_rate", "witnessed_village_actions", "judged_fairness", "judged_fun",
)


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256(value: Any) -> str:
    if isinstance(value, Path):
        value = value.read_bytes()
    elif not isinstance(value, bytes):
        value = value.encode() if isinstance(value, str) else canonical(value).encode()
    return hashlib.sha256(value).hexdigest()


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def episode_id(row: list[Any]) -> str:
    case, profile, temperament, seed = row
    return f"{Path(case).stem}__{profile}__{temperament}__s{seed}"


def plan_key(row: list[Any]) -> tuple[str, str, str, int]:
    return row[0], row[1], row[2], int(row[3])


def validate_plan(batch_a: dict[str, Any], batch_b: dict[str, Any], expected_pairs: int | None = None) -> dict[str, Any]:
    plan_a, plan_b = batch_a.get("episodes") or [], batch_b.get("episodes") or []
    keys_a, keys_b = [plan_key(row) for row in plan_a], [plan_key(row) for row in plan_b]
    if len(set(keys_a)) != len(keys_a) or len(set(keys_b)) != len(keys_b):
        raise ValueError("duplicate pair identity in an arm plan")
    if keys_a != keys_b:
        raise ValueError("arm plans are not byte-for-byte identical in episode order and identity")
    if batch_a.get("budget") != batch_b.get("budget"):
        raise ValueError("arm budgets differ")
    if expected_pairs is not None and len(keys_a) != expected_pairs:
        raise ValueError(f"expected {expected_pairs} planned pairs, found {len(keys_a)}")
    if batch_b.get("paired_with") != batch_a.get("batch"):
        raise ValueError("Arm B was not created with --plan-from Arm A")
    return {"identical": True, "planned_pairs": len(keys_a), "plan_sha256": sha256({"budget": batch_a["budget"], "episodes": plan_a})}


def records_by_id(folder: Path) -> dict[str, dict[str, Any]]:
    records = {}
    for path in sorted(folder.glob("*.json")):
        value = load_json(path)
        if isinstance(value, dict) and value.get("id") and "outcome" in value:
            if value["id"] in records:
                raise ValueError(f"duplicate episode record {value['id']} in {folder}")
            records[value["id"]] = value
    return records


def list_by_id(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    rows = load_json(path)
    result = {}
    for row in rows:
        if row["id"] in result:
            raise ValueError(f"duplicate {path.name} row {row['id']}")
        result[row["id"]] = row
    return result


def audit_summary(folder: Path) -> dict[str, Any]:
    rows = load_jsonl(folder / "direct_requests.jsonl") + load_jsonl(folder / "proxy_requests.jsonl")
    roles: dict[str, dict[str, Any]] = {}
    for role in sorted({row.get("role", "unspecified") for row in rows}):
        selected = [row for row in rows if row.get("role", "unspecified") == role]
        completed = [row for row in selected if row.get("status") == "completed"]
        with_usage = [row for row in completed if isinstance(row.get("usage"), dict)]
        token_keys = sorted({key for row in with_usage for key in row["usage"] if isinstance(row["usage"][key], (int, float))})
        roles[role] = {
            "requests": len(selected), "completed": len(completed), "failed_or_retried": len(selected) - len(completed),
            "requests_with_usage": len(with_usage), "requests_missing_usage": len(completed) - len(with_usage),
            "usage": {key: sum(row["usage"].get(key, 0) for row in with_usage) for key in token_keys},
            "requested_models": sorted({row.get("requested_model") for row in selected if row.get("requested_model")}),
            "effective_serving_models": sorted({row.get("effective_serving_model") for row in selected if row.get("effective_serving_model")}),
            "prompt_hashes": {
                "unique_system": len({(row.get("prompt_hashes") or {}).get("system_sha256") for row in selected}),
                "unique_user": len({(row.get("prompt_hashes") or {}).get("user_sha256") for row in selected}),
                "unique_combined": len({(row.get("prompt_hashes") or {}).get("combined_sha256") for row in selected}),
            },
        }
    return {
        "requests": len(rows), "roles": roles,
        "missing_usage_note": "Usage is explicitly counted as missing when the configured backend does not expose provider usage metadata.",
    }


def number(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def metric_values(ep: dict[str, Any] | None, score: dict[str, Any] | None, judged: dict[str, Any] | None,
                  action_budget: int) -> dict[str, dict[str, Any]]:
    if ep is None:
        return {metric: {"value": None, "missing": "episode_missing", "censored": False} for metric in METRICS}
    if ep.get("failure"):
        return {metric: {"value": None, "missing": "episode_failed", "censored": False} for metric in METRICS}
    metrics = (score or {}).get("metrics") or {}
    trace = ((ep.get("report") or {}).get("trace") or [])
    outcome = ep.get("outcome")
    censored = outcome in ("out_of_budget", "quit")
    action_value = action_budget if outcome == "out_of_budget" else number(metrics.get("actions"))
    turns = number(metrics.get("character_turns"))
    fallback = number(metrics.get("character_fallbacks"))
    decline = number(metrics.get("neutral_replies"))
    fallback_rate = None if not turns else ((fallback or 0) + (decline or 0)) / turns
    witness_count = sum(len(row.get("witnessed") or []) for row in trace)
    judge_scores = (judged or {}).get("scores") or {}

    def entry(value: Any, missing: str, is_censored: bool = False) -> dict[str, Any]:
        if isinstance(value, bool):
            value = float(value)
        value = number(value)
        return {"value": value, "missing": None if value is not None else missing, "censored": is_censored}

    return {
        "solved": entry(metrics.get("solved"), "score_missing"),
        "correct": entry(metrics.get("correct"), "score_missing"),
        "actions_or_censored_action_budget": entry(action_value, "score_missing", censored),
        "hints_helped": entry(metrics.get("hints_that_helped"), "no_hints_or_score_missing"),
        "longest_stall": entry(metrics.get("longest_stall"), "score_missing"),
        "fallback_or_decline_rate": entry(fallback_rate, "no_character_turns_or_score_missing"),
        "witnessed_village_actions": entry(witness_count, "trace_missing"),
        "judged_fairness": entry(((judge_scores.get("fairness") or {}).get("score")), "judge_missing"),
        "judged_fun": entry(((judge_scores.get("fun") or {}).get("score")), "judge_missing"),
    }


def quantile(values: list[float], probability: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower, upper = math.floor(position), math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def blocked_mean(values: list[tuple[str, float]]) -> tuple[float | None, dict[str, float]]:
    grouped: dict[str, list[float]] = defaultdict(list)
    for case, value in values:
        grouped[case].append(value)
    case_means = {case: statistics.mean(items) for case, items in sorted(grouped.items())}
    return (statistics.mean(case_means.values()) if case_means else None), case_means


def empirical_null(values: list[tuple[str, float]]) -> dict[str, Any]:
    if not values:
        return {"method": "within-pair sign flips of the equal-case blocked mean", "draws": 0, "sd": None,
                "central_95_range": None, "two_sided_tail_fraction": None}
    observed, _ = blocked_mean(values)
    distributions = []
    if len(values) <= 20:
        signs = itertools.product((-1, 1), repeat=len(values))
    else:
        raise ValueError("exact sign-flip calibration is limited to 20 complete pairs")
    for sign in signs:
        statistic, _ = blocked_mean([(case, delta * direction) for (case, delta), direction in zip(values, sign)])
        distributions.append(statistic)
    return {
        "method": "exact within-pair sign flips of the equal-case blocked mean",
        "draws": len(distributions), "sd": statistics.pstdev(distributions),
        "central_95_range": [quantile(distributions, 0.025), quantile(distributions, 0.975)],
        "two_sided_tail_fraction": sum(abs(value) >= abs(observed) for value in distributions) / len(distributions),
    }


def nominal_case_interval(case_means: dict[str, float]) -> list[float] | None:
    values = list(case_means.values())
    if len(values) < 2:
        return None
    critical = {2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776}.get(len(values), 1.96)
    center = statistics.mean(values)
    half = critical * statistics.stdev(values) / math.sqrt(len(values))
    return [center - half, center + half]


def summarize_metric(pairs: list[dict[str, Any]], metric: str) -> dict[str, Any]:
    arm_present = {"A": 0, "B": 0}
    missing = {"A": Counter(), "B": Counter()}
    censored = {"A": 0, "B": 0}
    deltas: list[tuple[str, float]] = []
    raw = []
    for row in pairs:
        a, b = row["metrics"][metric]["A"], row["metrics"][metric]["B"]
        for label, value in (("A", a), ("B", b)):
            if value["value"] is None:
                missing[label][value["missing"] or "unknown"] += 1
            else:
                arm_present[label] += 1
            censored[label] += bool(value["censored"])
        delta = b["value"] - a["value"] if a["value"] is not None and b["value"] is not None else None
        if delta is not None:
            deltas.append((row["case"], delta))
        raw.append({"pair_id": row["pair_id"], "case": row["case"], "A": a["value"], "B": b["value"],
                    "B_minus_A": delta, "A_censored": a["censored"], "B_censored": b["censored"]})
    mean, case_means = blocked_mean(deltas)
    return {
        "planned_pairs": len(pairs), "paired_complete": len(deltas), "paired_missing": len(pairs) - len(deltas),
        "arm_denominators": {label: {"present": arm_present[label], "missing": sum(missing[label].values()),
                                      "missing_reasons": dict(sorted(missing[label].items())), "censored": censored[label]}
                             for label in ("A", "B")},
        "raw_pair_distribution": raw,
        "paired_difference": {
            "direction": "Arm B minus Arm A", "equal_case_blocked_mean": mean,
            "case_block_means": case_means, "median": statistics.median(value for _, value in deltas) if deltas else None,
            "range": [min(value for _, value in deltas), max(value for _, value in deltas)] if deltas else None,
            "nominal_95_t_interval_over_case_means": nominal_case_interval(case_means),
            "empirical_null_dispersion": empirical_null(deltas),
        },
    }


def display_path(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def arm_data(folder: Path) -> dict[str, Any]:
    return {
        "folder": folder, "batch": load_json(folder / "batch.json"), "provenance": load_json(folder / "provenance.json"),
        "episodes": records_by_id(folder), "scores": list_by_id(folder / "scores.json"),
        "judged": list_by_id(folder / "judged.json"), "audit": audit_summary(folder),
    }


def validate_preregistration(prereg: dict[str, Any], batch: dict[str, Any]) -> dict[str, Any]:
    if tuple(prereg.get("metrics") or ()) != METRICS:
        raise ValueError("preregistered metrics do not exactly match the analyzer metric set")
    cases = sorted({row[0] for row in batch["episodes"]})
    registered = sorted(case["path"] for case in prereg.get("cases") or [])
    if cases != registered:
        raise ValueError("planned cases do not match the preregistered case paths")
    if [plan_key(row) for row in prereg.get("episodes") or []] != [plan_key(row) for row in batch["episodes"]]:
        raise ValueError("planned episodes do not exactly match the preregistered plan")
    if prereg.get("budget") != batch.get("budget"):
        raise ValueError("planned budget does not match the preregistered budget")
    return {"sha256": sha256(prereg), "cases_match": True, "metrics_match": True, "episodes_match": True,
            "budget_match": True}


def analyze(arm_a_dir: Path, arm_b_dir: Path, preregistration_path: Path) -> dict[str, Any]:
    comparison_audit = require_passing_audit(arm_a_dir, arm_b_dir, preregistration_path)
    a, b = arm_data(arm_a_dir), arm_data(arm_b_dir)
    prereg = load_json(preregistration_path)
    identity = validate_plan(a["batch"], b["batch"], prereg.get("expected_pairs"))
    prereg_check = validate_preregistration(prereg, a["batch"])
    if a["provenance"]["plan_sha256"] != identity["plan_sha256"] or b["provenance"]["plan_sha256"] != identity["plan_sha256"]:
        raise ValueError("arm provenance plan hash differs from the analyzed plan")
    config_a, config_b = a["provenance"]["models_and_prompts"], b["provenance"]["models_and_prompts"]
    if canonical(config_a) != canonical(config_b):
        raise ValueError("effective configured model routes, prompts, or temperatures differ between arms")
    if a["provenance"]["repository_at_start"]["worktree_sha256"] != b["provenance"]["repository_at_start"]["worktree_sha256"]:
        raise ValueError("arm worktree fingerprints differ")
    if a["provenance"]["cases"] != b["provenance"]["cases"]:
        raise ValueError("arm case hashes differ")

    pairs = []
    action_budget = int(a["batch"]["budget"]["actions"])
    for planned in a["batch"]["episodes"]:
        pair_id = episode_id(planned)
        ep_a, ep_b = a["episodes"].get(pair_id), b["episodes"].get(pair_id)
        metrics_a = metric_values(ep_a, a["scores"].get(pair_id), a["judged"].get(pair_id), action_budget)
        metrics_b = metric_values(ep_b, b["scores"].get(pair_id), b["judged"].get(pair_id), action_budget)
        pairs.append({"pair_id": pair_id, "case": planned[0], "profile": planned[1], "temperament": planned[2],
                      "seed": planned[3], "episode_present": {"A": ep_a is not None, "B": ep_b is not None},
                      "failure": {"A": (ep_a or {}).get("failure"), "B": (ep_b or {}).get("failure")},
                      "outcome": {"A": (ep_a or {}).get("outcome"), "B": (ep_b or {}).get("outcome")},
                      "metrics": {metric: {"A": metrics_a[metric], "B": metrics_b[metric]} for metric in METRICS}})
    metrics = {metric: summarize_metric(pairs, metric) for metric in METRICS}
    episode_failures = [{"pair_id": row["pair_id"], "arm": label, "failure": row["failure"][label]}
                        for row in pairs for label in ("A", "B") if row["failure"][label]]
    missing_episodes = [{"pair_id": row["pair_id"], "arm": label} for row in pairs for label in ("A", "B")
                        if not row["episode_present"][label]]
    result = {
        "schema_version": "e6-aa-analysis-v1", "title": "E6 independently executed paired A/A playtest calibration",
        "comparison_audit": comparison_audit.to_dict(),
        "interpretation": "A/A calibration of pipeline and model stochasticity. Case is an equal-weight block. No treatment effect is claimed.",
        "preregistration": {"path": display_path(preregistration_path), **prereg_check, "content": prereg},
        "identity": {**identity, "arm_b_plan_from_arm_a": True, "same_repository_worktree": True,
                     "same_models_prompts_temperatures": True, "same_case_hashes": True},
        "arms": {
            "A": {"batch": a["batch"]["batch"], "folder": display_path(arm_a_dir),
                  "provenance": a["provenance"], "request_usage": a["audit"]},
            "B": {"batch": b["batch"]["batch"], "folder": display_path(arm_b_dir),
                  "provenance": b["provenance"], "request_usage": b["audit"]},
        },
        "denominator": {"planned_pairs": len(pairs), "planned_episodes": len(pairs) * 2,
                        "episodes_present": sum(row["episode_present"][label] for row in pairs for label in ("A", "B")),
                        "missing_episodes": missing_episodes, "failed_episodes": episode_failures,
                        "right_censored_by_arm": {label: sum(row["metrics"]["actions_or_censored_action_budget"][label]["censored"] for row in pairs)
                                                  for label in ("A", "B")}},
        "metrics": metrics, "pairs": pairs,
        "limitations": [
            "Only three independent cases are represented; profiles and seeds are repeated observations within case.",
            "Nominal intervals and sign-flip tails are calibration descriptors, not confirmatory treatment-effect inference.",
            "A/A variation includes model sampling and any unreported provider-side serving variation; effective serving model is unknown when Bedrock omits it.",
            "Hints-helped is missing when no hint was requested; fallback/decline rate is missing when no character turn occurred.",
            "Out-of-budget and quit episodes are right-censored for actions-to-solve; no survival-model inference is attempted.",
        ],
    }
    semantic = json.loads(canonical(result))
    for arm in semantic["arms"].values():
        for key in ("started_at", "finished_at"):
            arm["provenance"].pop(key, None)
        for repo_key in ("repository_at_start", "repository_at_end"):
            if repo_key in arm["provenance"]:
                pass
    result["normalized_analysis_sha256"] = sha256(semantic)
    return result


def fmt(value: Any) -> str:
    return "missing" if value is None else f"{value:.4f}" if isinstance(value, float) else str(value)


def markdown(report: dict[str, Any]) -> str:
    d = report["denominator"]
    lines = ["# E6 paired A/A playtest calibration", "", report["interpretation"], "",
             f"Plan identity: **{report['identity']['planned_pairs']}/{report['identity']['planned_pairs']} exact pairs**; "
             f"Arm B used `--plan-from` Arm A. Present episodes: **{d['episodes_present']}/{d['planned_episodes']}**; "
             f"failed: **{len(d['failed_episodes'])}/{d['planned_episodes']}**; right-censored A/B: "
             f"**{d['right_censored_by_arm']['A']}/{d['right_censored_by_arm']['B']}**.", "",
             "## Paired calibration descriptors", "",
             "All differences are Arm B minus Arm A. The blocked mean weights each of the three cases equally.", "",
             "| Metric | Complete/planned | Blocked mean | Median | Range | Null SD | Exact sign-flip central 95% | Nominal case-level 95% |",
             "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for name, row in report["metrics"].items():
        diff, null = row["paired_difference"], row["paired_difference"]["empirical_null_dispersion"]
        lines.append(f"| {name.replace('_', ' ')} | {row['paired_complete']}/{row['planned_pairs']} | {fmt(diff['equal_case_blocked_mean'])} | "
                     f"{fmt(diff['median'])} | {fmt(diff['range'])} | {fmt(null['sd'])} | {fmt(null['central_95_range'])} | "
                     f"{fmt(diff['nominal_95_t_interval_over_case_means'])} |")
    lines += ["", "## Exact denominators and missingness", ""]
    for name, row in report["metrics"].items():
        a, b = row["arm_denominators"]["A"], row["arm_denominators"]["B"]
        lines.append(f"- **{name}:** paired {row['paired_complete']}/{row['planned_pairs']}; A present/missing/censored "
                     f"{a['present']}/{a['missing']}/{a['censored']}; B {b['present']}/{b['missing']}/{b['censored']}; "
                     f"missing A={a['missing_reasons'] or '{}'}, B={b['missing_reasons'] or '{}'}.")
    lines += ["", "## Usage and provenance", ""]
    for label in ("A", "B"):
        arm = report["arms"][label]
        p = arm["provenance"]
        lines.append(f"- **Arm {label}:** `{arm['batch']}`; {p['started_at']} to {p['finished_at']}; revision "
                     f"`{p['repository_at_start']['revision']}`; worktree `{p['repository_at_start']['worktree_sha256']}`; "
                     f"plan `{p['plan_sha256']}`; requests {arm['request_usage']['requests']}.")
        for role, usage in arm["request_usage"]["roles"].items():
            lines.append(f"  - {role}: {usage['completed']}/{usage['requests']} completed; usage={usage['usage'] or 'missing'}; "
                         f"missing usage {usage['requests_missing_usage']}.")
    lines += ["", "## Failures", "", f"Missing episodes: {len(d['missing_episodes'])}. Failed episodes: {len(d['failed_episodes'])}."]
    if d["failed_episodes"]:
        lines += [f"- `{row['pair_id']}` arm {row['arm']}: {row['failure']}" for row in d["failed_episodes"]]
    lines += ["", "## Interpretation limits", ""] + [f"- {item}" for item in report["limitations"]]
    lines += ["", f"Normalized analysis SHA-256: `{report['normalized_analysis_sha256']}`."]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--arm-a", required=True, type=Path)
    parser.add_argument("--arm-b", required=True, type=Path)
    parser.add_argument("--preregistration", required=True, type=Path)
    parser.add_argument("--json", type=Path, default=DEFAULT_JSON)
    parser.add_argument("--markdown", type=Path, default=DEFAULT_MARKDOWN)
    args = parser.parse_args()
    try:
        report = analyze(args.arm_a.resolve(), args.arm_b.resolve(), args.preregistration.resolve())
    except ComparisonAuditError as exc:
        print(json.dumps(exc.audit.to_dict(), ensure_ascii=False, indent=2, sort_keys=True), file=sys.stderr)
        raise SystemExit(2) from None
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    args.markdown.write_text(markdown(report), encoding="utf-8")
    print(f"Wrote {args.json} and {args.markdown}; normalized SHA-256 {report['normalized_analysis_sha256']}")


if __name__ == "__main__":
    main()
