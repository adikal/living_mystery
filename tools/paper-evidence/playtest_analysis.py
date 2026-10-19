#!/usr/bin/env python3
"""Build deterministic paper evidence from archived playtest episodes, entirely offline."""

from __future__ import annotations

import hashlib
import json
import math
import statistics
import subprocess
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable, Literal

ROOT = Path(__file__).resolve().parents[2]
RUN_DIR = ROOT / "tools" / "playtest" / "runs" / "e3c"
RESULT_DIR = Path(__file__).resolve().parent / "results"
JSON_PATH = RESULT_DIR / "playtest_analysis.json"
MARKDOWN_PATH = RESULT_DIR / "playtest_analysis.md"
STRUCTURAL_DEPTH_SCRIPT = Path(__file__).resolve().parent / "structural_depth.mjs"
ACCEPTED_VERDICT = "still solvable"
DisagreementPolicy = Literal["error", "flag"]


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def normalized_sha256(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def repository_relative(path: Path) -> str:
    return path.resolve().relative_to(ROOT).as_posix()


def raw_episode_paths(run_dir: Path = RUN_DIR) -> list[Path]:
    """Select episodes by schema, excluding batch and derived metadata files."""
    paths: list[Path] = []
    for path in sorted(run_dir.glob("*.json")):
        value = load_json(path)
        if isinstance(value, dict) and value.get("id") and isinstance((value.get("report") or {}).get("trace"), list):
            paths.append(path)
    return paths


def numeric(value: Any, field: str) -> float | int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be numeric, got {value!r}")
    return value


def boolean(value: Any, field: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{field} must be boolean, got {value!r}")
    return value


def range_summary(values: Iterable[float | int]) -> dict[str, Any]:
    items = list(values)
    if not items:
        return {"n": 0, "median": None, "range": None}
    return {"n": len(items), "median": statistics.median(items), "range": [min(items), max(items)]}


def average_ranks(values: list[float | int]) -> list[float]:
    ordered = sorted(enumerate(values), key=lambda item: item[1])
    ranks = [0.0] * len(values)
    start = 0
    while start < len(ordered):
        end = start + 1
        while end < len(ordered) and ordered[end][1] == ordered[start][1]:
            end += 1
        average_rank = (start + 1 + end) / 2
        for index, _ in ordered[start:end]:
            ranks[index] = average_rank
        start = end
    return ranks


def pearson(left: list[float], right: list[float]) -> float | None:
    left_mean = statistics.mean(left)
    right_mean = statistics.mean(right)
    numerator = sum((x - left_mean) * (y - right_mean) for x, y in zip(left, right))
    left_ss = sum((x - left_mean) ** 2 for x in left)
    right_ss = sum((y - right_mean) ** 2 for y in right)
    if left_ss == 0 or right_ss == 0:
        return None
    return round(numerator / math.sqrt(left_ss * right_ss), 6)


def spearman(left: list[float | int], right: list[float | int | None]) -> dict[str, Any]:
    pairs = [(x, y) for x, y in zip(left, right) if y is not None]
    if len(pairs) < 2:
        return {"rho": None, "n_cases": len(pairs)}
    x_values = [x for x, _ in pairs]
    y_values = [y for _, y in pairs]
    return {"rho": pearson(average_ranks(x_values), average_ranks(y_values)), "n_cases": len(pairs)}


def case_name(card: dict[str, Any]) -> str:
    return Path(card["case"]).stem


def load_structural_certificates(case_paths: Iterable[str]) -> dict[str, dict[str, Any]]:
    """Strictly certify archived case files with the current JS kernel, without network access."""
    unique_paths = sorted(set(case_paths))
    command = ["node", str(STRUCTURAL_DEPTH_SCRIPT), "--cases", *unique_paths]
    completed = subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)
    rows = json.loads(completed.stdout)
    by_path: dict[str, dict[str, Any]] = {}
    for row in rows:
        for source_path in row["source_paths"]:
            by_path[source_path] = row
    missing = sorted(set(unique_paths) - set(by_path))
    if missing:
        raise ValueError(f"current certifier returned no structural certificate for: {missing}")
    return by_path


def depth_analysis(
    episodes: dict[str, dict[str, Any]],
    scores: dict[str, dict[str, Any]],
    certificates: dict[str, dict[str, Any]],
    disagreement_policy: DisagreementPolicy = "error",
) -> dict[str, Any]:
    """Aggregate behavior by independent case and join current structural certificates."""
    if disagreement_policy not in ("error", "flag"):
        raise ValueError(f"unknown disagreement policy: {disagreement_policy}")
    by_case: dict[str, list[tuple[dict[str, Any], dict[str, Any]]]] = defaultdict(list)
    case_paths: dict[str, str] = {}
    for episode_id in sorted(episodes):
        card = scores[episode_id]
        name = case_name(card)
        source_path = card["case"]
        episode_case = episodes[episode_id].get("case")
        if episode_case is not None and episode_case != source_path:
            raise ValueError(f"episode {episode_id} case path disagrees with score card: {episode_case!r} != {source_path!r}")
        prior_path = case_paths.setdefault(name, source_path)
        if prior_path != source_path:
            raise ValueError(f"case ID {name} maps to multiple archived case paths: {prior_path!r}, {source_path!r}")
        by_case[name].append((episodes[episode_id], card))

    cases: list[dict[str, Any]] = []
    disagreements: list[dict[str, Any]] = []
    for name, rows in by_case.items():
        source_path = case_paths[name]
        certificate = certificates.get(source_path)
        if certificate is None:
            raise ValueError(f"missing structural certificate for {source_path}")
        if certificate["case_id"] != name:
            raise ValueError(f"archived case ID {certificate['case_id']} does not match score case {name}")
        snapshots = {numeric(episode["report"].get("solve_depth"), "report.solve_depth") for episode, _ in rows}
        certified_depth = numeric(certificate["instantaneous_solve_depth"], "certificate.instantaneous_solve_depth")
        agrees = snapshots == {certified_depth}
        agreement = {
            "status": "agree" if agrees else "disagree",
            "episode_snapshot_values": sorted(snapshots),
            "current_certified_instantaneous_solve_depth": certified_depth,
        }
        if not agrees:
            disagreement = {"case": name, "source_path": source_path, **agreement}
            disagreements.append(disagreement)
            if disagreement_policy == "error":
                raise ValueError(
                    f"case {name} episode solve_depth snapshots {sorted(snapshots)} disagree with "
                    f"current certified instantaneous solve depth {certified_depth}"
                )

        solved = [boolean(card["metrics"]["solved"], "metrics.solved") for _, card in rows]
        correct = [boolean(card["metrics"]["correct"], "metrics.correct") for _, card in rows]
        actions = [numeric(card["metrics"]["actions"], "metrics.actions") for _, card in rows]
        hints = [numeric(card["metrics"]["hints"], "metrics.hints") for _, card in rows]
        stalls = [numeric(card["metrics"]["longest_stall"], "metrics.longest_stall") for _, card in rows]
        solved_actions = [action for action, did_solve in zip(actions, solved) if did_solve]
        run_count = len(rows)
        solved_count = sum(solved)
        correct_count = sum(correct)
        cases.append(
            {
                "case": name,
                "archived_case_path": source_path,
                "normalized_case_sha256": certificate["normalized_sha256"],
                "structural_depth": {
                    "instantaneous_solve_depth": certified_depth,
                    "stable_depth": certificate["stable_depth"],
                    "thread_depths": certificate["thread_depths"],
                    "pillar_depths": certificate["pillar_depths"],
                    "snapshot_agreement": agreement,
                },
                "episodes": run_count,
                "solved": {"count": solved_count, "denominator": run_count, "rate": round(solved_count / run_count, 6)},
                "correct": {"count": correct_count, "denominator": run_count, "rate": round(correct_count / run_count, 6)},
                "right_censoring": {
                    "runs": run_count,
                    "solved_events": solved_count,
                    "right_censored_runs": run_count - solved_count,
                },
                "all_run": {
                    "actions": range_summary(actions),
                    "hints": range_summary(hints),
                    "longest_stall": range_summary(stalls),
                },
                "solved_only": {"actions": range_summary(solved_actions)},
            }
        )
    cases.sort(key=lambda row: (row["structural_depth"]["instantaneous_solve_depth"], row["case"]))

    depths = [row["structural_depth"]["instantaneous_solve_depth"] for row in cases]
    measures = {
        "solve_rate": [row["solved"]["rate"] for row in cases],
        "correct_rate": [row["correct"]["rate"] for row in cases],
        "median_all_run_actions": [row["all_run"]["actions"]["median"] for row in cases],
        "median_all_run_hints": [row["all_run"]["hints"]["median"] for row in cases],
        "median_all_run_longest_stall": [row["all_run"]["longest_stall"]["median"] for row in cases],
        "median_solved_only_actions": [row["solved_only"]["actions"]["median"] for row in cases],
    }
    total_runs = sum(row["episodes"] for row in cases)
    total_solved = sum(row["solved"]["count"] for row in cases)
    return {
        "unit_of_analysis": "case",
        "independence_note": (
            "Case is the independent unit for structural-depth association. Multiple episodes from one case are repeated "
            "behavioral observations and are aggregated before correlation."
        ),
        "exploratory": True,
        "case_count": len(cases),
        "episode_count": total_runs,
        "right_censoring": {
            "definition": (
                "Unsolved runs are right-censored: an out-of-budget or quit episode ends before a solve, so observed "
                "actions are a lower bound on actions-to-solve. All-run summaries remain descriptive, solved-only "
                "summaries are separate, and no survival-model inference is attempted."
            ),
            "runs": total_runs,
            "solved_events": total_solved,
            "right_censored_runs": total_runs - total_solved,
        },
        "depth_join": {
            "source": "archived score-card case path certified by the current strict JS certifier",
            "strict_certifier_arguments": [True, True],
            "snapshot_field": "episode.report.solve_depth",
            "comparison_target": "current certificate instantaneous_solve_depth",
            "disagreement_policy": disagreement_policy,
            "disagreement_count": len(disagreements),
            "disagreements": disagreements,
            "normalized_case_set_sha256": normalized_sha256(
                [{"case": row["case"], "sha256": row["normalized_case_sha256"]} for row in cases]
            ),
        },
        "cases": cases,
        "spearman_case_level": {
            "depth_variable": "current certified instantaneous_solve_depth",
            "n_cases": len(cases),
            "exploratory": True,
            "correlations": {name: spearman(depths, values) for name, values in measures.items()},
            "note": (
                f"Spearman correlations use {len(cases)} case aggregates; the {total_runs} episodes are not treated as "
                "independent structural-depth observations."
            ),
        },
    }


def split_opportunity(value: str) -> tuple[str, str]:
    person, separator, clue = value.partition(":")
    if not separator or not person or not clue:
        raise ValueError(f"invalid audit.solvable key: {value!r}")
    return person, clue


def opportunity_key(record: dict[str, Any]) -> tuple[str, str, str]:
    return record["episode_id"], record["person"], record["clue"]


def example_record(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "episode_id": record["episode_id"], "trace_index": record["trace_index"], "person": record["person"],
        "clue": record["clue"], "reason": record["verdict"], "director_status": record["director_status"],
    }


def runtime_gate_audit(episodes: dict[str, dict[str, Any]]) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    code_errors: list[dict[str, Any]] = []
    executions: list[dict[str, Any]] = []
    for episode_id in sorted(episodes):
        previous_concealed: set[str] = set()
        for trace_index, trace in enumerate(episodes[episode_id]["report"]["trace"]):
            director = trace.get("director") or {}
            audit = director.get("audit") or {}
            for composite, verdict in sorted((audit.get("solvable") or {}).items()):
                person, clue = split_opportunity(composite)
                candidates.append({"episode_id": episode_id, "trace_index": trace_index, "person": person, "clue": clue,
                                   "verdict": verdict, "director_status": director.get("status"),
                                   "surviving_plan": list(director.get("plan") or [])})
            for error in audit.get("code") or []:
                if "(conceal)" in error:
                    code_errors.append({"episode_id": episode_id, "trace_index": trace_index, "error": error})
            concealed = set(trace.get("concealed") or [])
            removed = previous_concealed - concealed
            if removed:
                raise ValueError(f"cumulative concealed set shrank in {episode_id} at trace {trace_index}: {sorted(removed)}")
            for clue in sorted(concealed - previous_concealed):
                executions.append({"episode_id": episode_id, "trace_index": trace_index, "clue": clue})
            previous_concealed = concealed

    verdict_counts = Counter(record["verdict"] for record in candidates)
    accepted = [record for record in candidates if record["verdict"] == ACCEPTED_VERDICT]
    refused = [record for record in candidates if record["verdict"] != ACCEPTED_VERDICT]
    opportunity_counts = Counter(opportunity_key(record) for record in candidates)
    repeated = [{"episode_id": key[0], "person": key[1], "clue": key[2], "proposals": count}
                for key, count in sorted(opportunity_counts.items()) if count > 1]
    execution_by_episode_clue = {(record["episode_id"], record["clue"]): record["trace_index"] for record in executions}
    associations = []
    for execution in executions:
        prior = [record for record in accepted if record["episode_id"] == execution["episode_id"]
                 and record["clue"] == execution["clue"] and record["trace_index"] <= execution["trace_index"]]
        associations.append({"episode_id": execution["episode_id"], "clue": execution["clue"],
                             "execution_trace_index": execution["trace_index"], "prior_accepted_audit": bool(prior),
                             "accepted_trace_indexes": sorted(record["trace_index"] for record in prior)})
    if not all(row["prior_accepted_audit"] for row in associations):
        raise ValueError("an observed concealment execution has no same-or-prior accepted episode/clue audit")

    accepted_not_executed_candidates = sorted(
        (record for record in accepted if (record["episode_id"], record["clue"]) not in execution_by_episode_clue),
        key=lambda record: (record["episode_id"], record["trace_index"], record["person"], record["clue"]),
    )
    refused_candidates = sorted(refused, key=lambda record: (record["episode_id"], record["trace_index"], record["person"], record["clue"]))
    mixed_candidates = sorted((record for record in refused if record["director_status"] == "accepted" and record["surviving_plan"]),
                              key=lambda record: (record["episode_id"], record["trace_index"], record["person"], record["clue"]))
    accepted_then_executed_candidates = []
    for record in accepted:
        execution_index = execution_by_episode_clue.get((record["episode_id"], record["clue"]))
        if execution_index is not None and execution_index > record["trace_index"]:
            accepted_then_executed_candidates.append((execution_index - record["trace_index"], record, execution_index))
    accepted_then_executed_candidates.sort(key=lambda item: (item[0], item[1]["episode_id"], item[1]["trace_index"], item[1]["person"], item[1]["clue"]))
    if not all((accepted_not_executed_candidates, refused_candidates, mixed_candidates, accepted_then_executed_candidates)):
        raise ValueError("could not discover all required representative example categories")

    accepted_not_executed = example_record(accepted_not_executed_candidates[0])
    accepted_not_executed["outcome"] = "accepted by the kernel audit but the clue was never added to concealed in this episode"
    refused_example = example_record(refused_candidates[0])
    refused_example["outcome"] = "refused by the kernel solvability audit"
    mixed_plan = example_record(mixed_candidates[0])
    mixed_plan["surviving_plan"] = mixed_candidates[0]["surviving_plan"]
    mixed_plan["outcome"] = "this concealment was refused while another person's plan survived and the director status remained accepted"
    _, accepted_record, execution_index = accepted_then_executed_candidates[0]
    accepted_then_executed = example_record(accepted_record)
    accepted_then_executed["execution_trace_index"] = execution_index
    accepted_then_executed["outcome"] = "accepted by the kernel audit and later observed as a cumulative concealed-set addition"

    return {
        "episodes": len(episodes),
        "kernel_audited_candidates": {"total": len(candidates), "accepted": len(accepted), "refused": len(refused),
            "verdict_counts": dict(sorted(verdict_counts.items(), key=lambda item: (item[0] != ACCEPTED_VERDICT, item[0])))},
        "opportunities": {"definition": "unique (episode_id, person, clue) among audit.solvable entries",
            "unique": len(opportunity_counts), "repeated_proposal_instances": len(candidates) - len(opportunity_counts),
            "opportunities_proposed_more_than_once": len(repeated), "repeated": repeated},
        "code_invalid_conceal_errors": {"count": len(code_errors), "definition": "final audit.code entries containing '(conceal)'"},
        "actual_concealment_executions": {"set_additions": len(executions),
            "unique_episode_clues": len({(record["episode_id"], record["clue"]) for record in executions}),
            "with_same_or_prior_accepted_episode_clue_audit": sum(row["prior_accepted_audit"] for row in associations),
            "association_scope": "episode and clue; compact execution traces do not retain the executing person",
            "associations": associations, "definition": "new clue IDs added between consecutive cumulative trace[i].concealed sets"},
        "separation_note": "Kernel-audited candidates, code-invalid conceal errors, and actual concealment executions are distinct events; none is used as a proxy for another.",
        "representative_examples": {"accepted_not_executed": accepted_not_executed, "refused": refused_example,
            "mixed_plan": mixed_plan, "accepted_then_executed": accepted_then_executed,
            "selection": "Examples are selected deterministically from parsed records, not by hardcoded episode IDs or trace indexes."},
    }


def build_analysis(run_dir: Path = RUN_DIR, disagreement_policy: DisagreementPolicy = "error") -> dict[str, Any]:
    episode_paths = raw_episode_paths(run_dir)
    episodes = {episode["id"]: episode for episode in (load_json(path) for path in episode_paths)}
    score_rows = load_json(run_dir / "scores.json")
    scores = {card["id"]: card for card in score_rows}
    if len(episodes) != len(episode_paths):
        raise ValueError("duplicate raw episode IDs")
    if len(scores) != len(score_rows):
        raise ValueError("duplicate score IDs")
    if set(episodes) != set(scores):
        raise ValueError(f"raw episode/score ID mismatch: raw-only={sorted(set(episodes) - set(scores))}, score-only={sorted(set(scores) - set(episodes))}")
    certificates = load_structural_certificates(card["case"] for card in scores.values())
    depth = depth_analysis(episodes, scores, certificates, disagreement_policy)
    return {
        "schema_version": 2,
        "title": "Archived playtest depth and run-time gate analysis",
        "scope": {"run_directory": repository_relative(run_dir), "raw_episodes": len(episodes),
                  "independent_cases": depth["case_count"], "score_join": "raw episode.id = scores.json[].id",
                  "structural_join": "scores.json[].case = archived case path; strict current certifier",
                  "excluded": ["batch.json", "report.json", "report.md", "scores.json as an episode", "judged.json"]},
        "depth_analysis": depth,
        "runtime_gate_audit": runtime_gate_audit(episodes),
        "data_completeness": [
            "Compact traces omit raw and revised director proposals.",
            "Compact traces omit removed closure and before/after solvability certificates.",
            "Accepted proposal rationale and full agenda steps are unavailable; example reasons therefore use the persisted audit.solvable verdict.",
            "Browser logs lack session IDs and are excluded rather than heuristically joined.",
            "Episodes do not embed an immutable case payload; the analysis certifies each currently referenced case file and records its normalized hash so later file drift is detectable but prior payloads cannot be reconstructed.",
            "Structural quantities describe certified case topology; they are not behavioral difficulty measurements.",
        ],
    }


def display_number(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"{value:g}" if isinstance(value, float) else str(value)


def display_range(summary: dict[str, Any]) -> str:
    bounds = summary["range"]
    if bounds is None:
        return "n/a"
    return f"{display_number(summary['median'])} ({display_number(bounds[0])}–{display_number(bounds[1])}); n={summary['n']}"


def markdown(analysis: dict[str, Any]) -> str:
    depth = analysis["depth_analysis"]
    audit = analysis["runtime_gate_audit"]
    case_counts = ", ".join(f"`{row['case']}` n={row['episodes']}" for row in depth["cases"])
    lines = [
        "# Archived playtest depth and run-time gate analysis", "", "## Depth association (case-level, exploratory)", "",
        f"The archive contains **{depth['episode_count']} episodes across {depth['case_count']} independent cases** ({case_counts}). "
        "Episodes join to scores by `id`; each score's archived case path is re-certified by the current strict certifier. "
        f"Snapshot disagreements: **{depth['depth_join']['disagreement_count']}/{depth['case_count']} cases**.", "",
        f"Normalized case-set SHA-256: `{depth['depth_join']['normalized_case_set_sha256']}`.", "",
        "| Case | Instantaneous depth | Stable depth | Solved | Correct | All-run actions median (range) | All-run hints median (range) | All-run stall median (range) | Solved-only actions median (range) | Censored |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in depth["cases"]:
        structural = row["structural_depth"]
        lines.append(
            f"| `{row['case']}` | {structural['instantaneous_solve_depth']} | {structural['stable_depth']} | "
            f"{row['solved']['count']}/{row['solved']['denominator']} ({row['solved']['rate'] * 100:.1f}%) | "
            f"{row['correct']['count']}/{row['correct']['denominator']} ({row['correct']['rate'] * 100:.1f}%) | "
            f"{display_range(row['all_run']['actions'])} | {display_range(row['all_run']['hints'])} | "
            f"{display_range(row['all_run']['longest_stall'])} | {display_range(row['solved_only']['actions'])} | "
            f"{row['right_censoring']['right_censored_runs']}/{row['right_censoring']['runs']} |"
        )
    censoring = depth["right_censoring"]
    lines.extend(["", f"Spearman correlations use **n={depth['case_count']} case aggregates**. The {depth['episode_count']} episodes are repeated observations, not independent depth units.", "",
                  "| Case-level measure | Spearman ρ | Independent cases |", "|---|---:|---:|"])
    for name, result in depth["spearman_case_level"]["correlations"].items():
        lines.append(f"| {name.replace('_', ' ')} | {display_number(result['rho'])} | {result['n_cases']} |")
    lines.extend(["", f"**Right-censoring ({censoring['right_censored_runs']}/{censoring['runs']} runs):** {censoring['definition']}", "",
                  "## Run-time gate audit", ""])
    candidates = audit["kernel_audited_candidates"]
    opportunities = audit["opportunities"]
    lines.extend([
        f"Across {audit['episodes']} episodes, **{candidates['accepted']}/{candidates['total']} candidates were accepted** and **{candidates['refused']}/{candidates['total']} refused**.", "",
        "| Distinct event | Count |", "|---|---:|", f"| Kernel-audited concealment candidates | {candidates['total']} |",
        f"| Final code-invalid `(conceal)` errors | {audit['code_invalid_conceal_errors']['count']} |",
        f"| Actual concealment executions | {audit['actual_concealment_executions']['set_additions']} |",
        f"| Executions with same-or-prior accepted episode/clue audit | {audit['actual_concealment_executions']['with_same_or_prior_accepted_episode_clue_audit']} |",
        "", audit["separation_note"], "", "### Kernel verdicts", "", "| `audit.solvable` value | Count | Classification |", "|---|---:|---|",
    ])
    for verdict, count in candidates["verdict_counts"].items():
        classification = "accepted" if verdict == ACCEPTED_VERDICT else "refused"
        lines.append(f"| {verdict.replace('|', chr(92) + '|')} | {count} | {classification} |")
    lines.extend(["", "### Opportunities and repeats", "",
                  f"There are **{opportunities['unique']} unique episode/person/clue opportunities**; {opportunities['repeated_proposal_instances']}/{candidates['total']} candidate verdicts are repeated proposal instances across {opportunities['opportunities_proposed_more_than_once']} opportunities."])
    if opportunities["repeated"]:
        lines.extend(["", "| Episode | Person | Clue | Proposals |", "|---|---|---|---:|"])
        for repeated in opportunities["repeated"]:
            lines.append(f"| `{repeated['episode_id']}` | `{repeated['person']}` | `{repeated['clue']}` | {repeated['proposals']} |")
    lines.extend(["", "### Representative parsed examples", ""])
    labels = {"accepted_not_executed": "Accepted, not executed", "refused": "Refused", "mixed_plan": "Mixed plan", "accepted_then_executed": "Accepted, then executed"}
    examples = audit["representative_examples"]
    for key, label in labels.items():
        example = examples[key]
        detail = f"episode `{example['episode_id']}`, trace {example['trace_index']}, person `{example['person']}`, clue `{example['clue']}`; reason: {example['reason']}. {example['outcome']}"
        if key == "mixed_plan":
            detail += f"; surviving plan: {', '.join(f'`{person}`' for person in example['surviving_plan'])}."
        elif key == "accepted_then_executed":
            detail += f"; execution trace: {example['execution_trace_index']}."
        lines.append(f"- **{label}:** {detail}")
    lines.extend(["", examples["selection"], "", "## Data completeness limitations", ""])
    lines.extend(f"- {limitation}" for limitation in analysis["data_completeness"])
    return "\n".join(lines) + "\n"


def main() -> None:
    analysis = build_analysis()
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    JSON_PATH.write_text(json.dumps(analysis, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    MARKDOWN_PATH.write_text(markdown(analysis), encoding="utf-8")
    print(f"Wrote {JSON_PATH.relative_to(ROOT)} and {MARKDOWN_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
