"""Offline tests for generalized playtest structural-depth analysis."""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "paper-evidence" / "playtest_analysis.py"
SPEC = importlib.util.spec_from_file_location("playtest_analysis", MODULE_PATH)
assert SPEC and SPEC.loader
ANALYSIS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ANALYSIS)


def certificate(name, depth):
    return {
        "case_id": name,
        "normalized_sha256": f"hash-{name}",
        "instantaneous_solve_depth": depth,
        "stable_depth": depth,
        "thread_depths": {"innocent": depth, "truth": max(0, depth - 1)},
        "pillar_depths": {"opportunity": depth, "means": depth - 1, "motive": depth - 1, "maximum": depth},
    }


def row(case, index, depth, *, solved=False, correct=False, actions=10, hints=0, stall=1):
    episode_id = f"{case}__{index}"
    path = f"dist/cases/generated/live/{case}.json"
    episode = {"id": episode_id, "case": path, "report": {"solve_depth": depth, "trace": []}}
    score = {
        "id": episode_id,
        "case": path,
        "metrics": {"solved": solved, "correct": correct, "actions": actions, "hints": hints, "longest_stall": stall},
    }
    return episode, score


def analyze(rows, depths, policy="error"):
    episodes = {episode["id"]: episode for episode, _ in rows}
    scores = {score["id"]: score for _, score in rows}
    certificates = {
        f"dist/cases/generated/live/{name}.json": certificate(name, depth)
        for name, depth in depths.items()
    }
    return ANALYSIS.depth_analysis(episodes, scores, certificates, policy)


def test_generalizes_to_unequal_run_counts_and_more_than_three_cases():
    depths = {"case-a": 2, "case-b": 3, "case-c": 4, "case-d": 5}
    rows = []
    for case_index, (case, depth) in enumerate(depths.items(), start=1):
        for run_index in range(case_index):
            rows.append(row(case, run_index, depth, solved=run_index == 0, correct=run_index == 0, actions=10 + run_index))

    result = analyze(rows, depths)

    assert result["unit_of_analysis"] == "case"
    assert result["case_count"] == 4
    assert result["episode_count"] == 10
    assert [case["episodes"] for case in result["cases"]] == [1, 2, 3, 4]
    assert [case["solved"]["denominator"] for case in result["cases"]] == [1, 2, 3, 4]
    assert result["spearman_case_level"]["n_cases"] == 4
    assert all(item["n_cases"] == 4 for item in result["spearman_case_level"]["correlations"].values())


def test_records_right_censoring_and_separates_all_run_from_solved_only():
    rows = [
        row("case-a", 0, 3, solved=True, correct=True, actions=12),
        row("case-a", 1, 3, solved=False, actions=40),
        row("case-a", 2, 3, solved=False, actions=50),
    ]

    result = analyze(rows, {"case-a": 3})
    case = result["cases"][0]

    assert result["right_censoring"] == {
        "definition": result["right_censoring"]["definition"],
        "runs": 3,
        "solved_events": 1,
        "right_censored_runs": 2,
    }
    assert case["right_censoring"] == {"runs": 3, "solved_events": 1, "right_censored_runs": 2}
    assert case["all_run"]["actions"] == {"n": 3, "median": 40, "range": [12, 50]}
    assert case["solved_only"]["actions"] == {"n": 1, "median": 12, "range": [12, 12]}


def test_depth_snapshot_disagreement_fails_by_default_or_is_flagged():
    rows = [row("case-a", 0, 2, solved=True)]
    episodes = {rows[0][0]["id"]: rows[0][0]}
    scores = {rows[0][1]["id"]: rows[0][1]}
    path = "dist/cases/generated/live/case-a.json"
    certificates = {path: certificate("case-a", 3)}

    with pytest.raises(ValueError, match="snapshots.*disagree"):
        ANALYSIS.depth_analysis(episodes, scores, certificates)

    result = ANALYSIS.depth_analysis(episodes, scores, certificates, "flag")
    assert result["depth_join"]["disagreement_count"] == 1
    assert result["depth_join"]["disagreements"] == [
        {
            "case": "case-a",
            "source_path": path,
            "status": "disagree",
            "episode_snapshot_values": [2],
            "current_certified_instantaneous_solve_depth": 3,
        }
    ]
    assert result["cases"][0]["structural_depth"]["snapshot_agreement"]["status"] == "disagree"
