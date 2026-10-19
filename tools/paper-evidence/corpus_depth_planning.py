#!/usr/bin/env python3
"""Describe structural depth in the current typed-claim corpus for experiment planning."""

from __future__ import annotations

import json
import statistics
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = Path(__file__).resolve().parent
STRUCTURAL_DEPTH_SCRIPT = SCRIPT_DIR / "structural_depth.mjs"
RESULT_DIR = SCRIPT_DIR / "results"
JSON_PATH = RESULT_DIR / "corpus_depth_planning.json"
MARKDOWN_PATH = RESULT_DIR / "corpus_depth_planning.md"
MIN_CASES_PER_STRATUM = 3


def load_corpus() -> dict[str, Any]:
    completed = subprocess.run(
        ["node", str(STRUCTURAL_DEPTH_SCRIPT), "--corpus"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def distribution(values: Iterable[int]) -> dict[str, Any]:
    items = list(values)
    counts = Counter(items)
    return {
        "denominator_cases": len(items),
        "values": [
            {"value": value, "count": count, "denominator": len(items), "proportion": round(count / len(items), 6)}
            for value, count in sorted(counts.items())
        ],
        "median": statistics.median(items),
        "range": [min(items), max(items)],
    }


def value_range(values: Iterable[int]) -> list[int]:
    items = list(values)
    return [min(items), max(items)]


def choose_depth_strata(cases: list[dict[str, Any]]) -> dict[str, Any]:
    """Choose three contiguous instantaneous-depth strata with at least three independent cases each."""
    depths = sorted({case["instantaneous_solve_depth"] for case in cases})
    candidates: list[tuple[tuple[int, int, int, int], list[list[dict[str, Any]]]]] = []
    for lower_index in range(len(depths) - 2):
        for upper_index in range(lower_index + 1, len(depths) - 1):
            lower_cut = depths[lower_index]
            upper_cut = depths[upper_index]
            groups = [
                [case for case in cases if case["instantaneous_solve_depth"] <= lower_cut],
                [case for case in cases if lower_cut < case["instantaneous_solve_depth"] <= upper_cut],
                [case for case in cases if case["instantaneous_solve_depth"] > upper_cut],
            ]
            sizes = [len(group) for group in groups]
            if min(sizes) < MIN_CASES_PER_STRATUM:
                continue
            imbalance = max(sizes) - min(sizes)
            squared_error = sum((size - len(cases) / 3) ** 2 for size in sizes)
            candidates.append(((imbalance, round(squared_error), lower_cut, upper_cut), groups))
    if not candidates:
        return {
            "feasible": False,
            "criterion": f"three contiguous instantaneous-depth strata with at least {MIN_CASES_PER_STRATUM} independent cases each",
            "reason": "No two observed-depth cut points satisfy the minimum case count.",
            "strata": [],
        }
    _, groups = min(candidates, key=lambda item: item[0])
    labels = ["lower structural depth", "middle structural depth", "higher structural depth"]
    strata = []
    for label, group in zip(labels, groups):
        ordered = sorted(group, key=lambda case: case["case_id"])
        classifications = Counter(case["classification"] for case in ordered)
        strata.append(
            {
                "label": label,
                "instantaneous_depth_range": value_range(case["instantaneous_solve_depth"] for case in ordered),
                "cases": len(ordered),
                "denominator_corpus_cases": len(cases),
                "case_ids": [case["case_id"] for case in ordered],
                "classification_counts": dict(sorted(classifications.items())),
                "stable_depth_range": value_range(case["stable_depth"] for case in ordered),
                "lies_range": value_range(case["lies"]["count"] for case in ordered),
                "herrings_range": value_range(case["herrings"]["count"] for case in ordered),
                "maximum_pillar_depth_range": value_range(case["pillar_depths"]["maximum"] for case in ordered),
            }
        )
    balanced_per_stratum = min(stratum["cases"] for stratum in strata)
    return {
        "feasible": True,
        "criterion": f"three contiguous instantaneous-depth strata with at least {MIN_CASES_PER_STRATUM} independent cases each",
        "selection_rule": "Among feasible observed-depth cut pairs, minimize stratum-size imbalance, then squared deviation from equal thirds, then choose lower cut points.",
        "balanced_cases_per_stratum": balanced_per_stratum,
        "balanced_total_cases": balanced_per_stratum * len(strata),
        "strata": strata,
    }


def build_report(corpus: dict[str, Any]) -> dict[str, Any]:
    cases = corpus["cases"]
    if not cases:
        raise ValueError("current manifests contain no unique claims-v2 cases")
    classifications = Counter(case["classification"] for case in cases)
    distributions = {
        "instantaneous_solve_depth": distribution(case["instantaneous_solve_depth"] for case in cases),
        "stable_depth": distribution(case["stable_depth"] for case in cases),
        "lies": distribution(case["lies"]["count"] for case in cases),
        "other_false_signs": distribution(case["other_false_signs"]["count"] for case in cases),
        "herrings": distribution(case["herrings"]["count"] for case in cases),
        "pillar_opportunity_depth": distribution(case["pillar_depths"]["opportunity"] for case in cases),
        "pillar_means_depth": distribution(case["pillar_depths"]["means"] for case in cases),
        "pillar_motive_depth": distribution(case["pillar_depths"]["motive"] for case in cases),
        "maximum_pillar_depth": distribution(case["pillar_depths"]["maximum"] for case in cases),
    }
    return {
        "schema_version": 1,
        "title": "Current typed-claim corpus structural-depth planning report",
        "scope": {
            "unique_claims_v2_cases": len(cases),
            "classification_counts": dict(sorted(classifications.items())),
            "manifest_paths": corpus["manifest_paths"],
            "excluded_cases": len(corpus["excluded"]),
            "strict_current_certifier_arguments": corpus["strict_certifier_arguments"],
            "normalized_corpus_sha256": corpus["normalized_corpus_sha256"],
            "network_or_model_calls": False,
        },
        "definitions": {
            "instantaneous_solve_depth": "First effective-depth layer at which only the true candidate survives (current certifier solveDepth).",
            "stable_depth": "Deepest permanent candidate-thread resolution depth: the maximum of current certifier thread depths.",
            "lies": "False testimony signs among the current certifier's falseSigns; false physical staging or other false signs are reported separately.",
            "herrings": "Current certifier behavior signs about innocents with a deeper reachable explanation.",
            "pillar_depths": "Earliest certified opportunity, means, and motive evidence depths; maximum is current certifier mmoDepth.",
        },
        "distributions": distributions,
        "instantaneous_stable_disagreements": {
            "count": sum(not case["instantaneous_equals_stable"] for case in cases),
            "denominator_cases": len(cases),
            "case_ids": [case["case_id"] for case in cases if not case["instantaneous_equals_stable"]],
        },
        "feasible_strata": choose_depth_strata(cases),
        "cases": cases,
        "interpretation_boundary": (
            "These are structural properties of certified case records. They do not measure or imply behavioral "
            "difficulty for agents or people. A future experiment must estimate behavior directly, treat case as the "
            "independent unit, and block or randomize nuisance structure such as lies, herrings, pillars, and corpus classification."
        ),
        "planning_limitations": [
            "The corpus contains only 15 independent cases; the feasible strata are a sampling frame, not a power analysis.",
            "Stratum sizes are unequal, so a fully balanced three-stratum comparison can use only the smallest stratum unless new cases are added.",
            "Stable and live manifest classifications may encode generation-time differences and should be balanced or modeled.",
            "Repeated runs by an agent or person do not increase the independent case denominator for depth effects.",
        ],
    }


def format_range(bounds: list[int]) -> str:
    return str(bounds[0]) if bounds[0] == bounds[1] else f"{bounds[0]}–{bounds[1]}"


def markdown(report: dict[str, Any]) -> str:
    scope = report["scope"]
    lines = [
        "# Current typed-claim corpus structural-depth planning report", "",
        f"This offline report strictly re-certifies **{scope['unique_claims_v2_cases']} independent claims-v2 cases** "
        f"({scope['classification_counts'].get('stable', 0)} stable, {scope['classification_counts'].get('live', 0)} live; "
        f"excluded {scope['excluded_cases']}/{scope['unique_claims_v2_cases'] + scope['excluded_cases']} indexed cases).", "",
        f"Normalized corpus SHA-256: `{scope['normalized_corpus_sha256']}`.", "",
        f"**Interpretation boundary:** {report['interpretation_boundary']}", "", "## Structural distributions", "",
        f"Every count below has denominator **{scope['unique_claims_v2_cases']} independent cases**.", "",
        "| Quantity | Distribution (value: count/15) | Median | Range |", "|---|---|---:|---:|",
    ]
    for name, result in report["distributions"].items():
        values = ", ".join(f"{row['value']}: {row['count']}/{row['denominator']}" for row in result["values"])
        lines.append(f"| {name.replace('_', ' ')} | {values} | {result['median']:g} | {format_range(result['range'])} |")
    disagreement = report["instantaneous_stable_disagreements"]
    lines.extend(["", f"Instantaneous and stable depth disagree for **{disagreement['count']}/{disagreement['denominator_cases']} cases**.", "", "## Per-case audit", "",
                  "| Case | Class | Instantaneous | Stable | Lies | Other false | Herrings | Pillars O/Mn/Mt/Max | Normalized SHA-256 |",
                  "|---|---|---:|---:|---:|---:|---:|---|---|"])
    for case in report["cases"]:
        p = case["pillar_depths"]
        lines.append(f"| `{case['case_id']}` | {case['classification']} | {case['instantaneous_solve_depth']} | {case['stable_depth']} | "
                     f"{case['lies']['count']} | {case['other_false_signs']['count']} | {case['herrings']['count']} | "
                     f"{p['opportunity']}/{p['means']}/{p['motive']}/{p['maximum']} | `{case['normalized_sha256']}` |")
    strata = report["feasible_strata"]
    lines.extend(["", "## Feasible structural strata", ""])
    if strata["feasible"]:
        lines.extend([f"Rule: {strata['criterion']}. A balanced design can sample **{strata['balanced_cases_per_stratum']} cases per stratum ({strata['balanced_total_cases']} total)** from the current corpus.", "",
                      "| Stratum | Instantaneous depth | Cases/corpus | Stable | Lies | Herrings | Max pillar | Stable/live |",
                      "|---|---:|---:|---:|---:|---:|---:|---:|"])
        for stratum in strata["strata"]:
            classes = stratum["classification_counts"]
            lines.append(f"| {stratum['label']} | {format_range(stratum['instantaneous_depth_range'])} | {stratum['cases']}/{stratum['denominator_corpus_cases']} | "
                         f"{format_range(stratum['stable_depth_range'])} | {format_range(stratum['lies_range'])} | {format_range(stratum['herrings_range'])} | "
                         f"{format_range(stratum['maximum_pillar_depth_range'])} | {classes.get('stable', 0)}/{classes.get('live', 0)} |")
        lines.extend(["", "Case membership:"])
        for stratum in strata["strata"]:
            lines.append(f"- **{stratum['label']} ({stratum['cases']}/{scope['unique_claims_v2_cases']}):** " + ", ".join(f"`{case_id}`" for case_id in stratum["case_ids"]))
    else:
        lines.append(strata["reason"])
    lines.extend(["", "## Limitations", ""])
    lines.extend(f"- {item}" for item in report["planning_limitations"])
    return "\n".join(lines) + "\n"


def main() -> None:
    report = build_report(load_corpus())
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    JSON_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    MARKDOWN_PATH.write_text(markdown(report), encoding="utf-8")
    print(f"Wrote {JSON_PATH.relative_to(ROOT)} and {MARKDOWN_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
