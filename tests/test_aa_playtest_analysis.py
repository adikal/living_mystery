"""Offline tests for E6 paired A/A plan identity, joins, missingness, censoring, and determinism."""
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "paper-evidence" / "aa_playtest_analysis.py"
SPEC = importlib.util.spec_from_file_location("aa_playtest_analysis", MODULE_PATH)
assert SPEC and SPEC.loader
AA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AA)


def batch(name="a", paired=None):
    value = {"batch": name, "budget": {"actions": 10, "minutes": 60},
             "episodes": [["cases/low.json", "beginner", "literal", 1],
                          ["cases/high.json", "pro", "bold", 2]]}
    if paired:
        value["paired_with"] = paired
    return value


def test_plan_identity_requires_exact_order_budget_and_plan_from():
    a, b = batch(), batch("b", "a")
    assert AA.validate_plan(a, b, 2)["identical"]
    b["episodes"] = list(reversed(b["episodes"]))
    with pytest.raises(ValueError, match="not byte-for-byte identical"):
        AA.validate_plan(a, b)
    b = batch("b", "a")
    b["budget"]["actions"] = 11
    with pytest.raises(ValueError, match="budgets differ"):
        AA.validate_plan(a, b)


def test_paired_join_retains_missing_and_censoring():
    ep = {"outcome": "out_of_budget", "failure": None, "report": {"trace": [{"witnessed": ["x"]}]}}
    score = {"metrics": {"solved": False, "correct": False, "actions": 9, "hints_that_helped": None,
                         "longest_stall": 4, "character_turns": 2, "character_fallbacks": 1, "neutral_replies": 1}}
    values = AA.metric_values(ep, score, None, 10)
    assert values["actions_or_censored_action_budget"] == {"value": 10.0, "missing": None, "censored": True}
    assert values["witnessed_village_actions"]["value"] == 1.0
    assert values["hints_helped"]["missing"] == "no_hints_or_score_missing"
    assert values["judged_fairness"]["missing"] == "judge_missing"
    missing = AA.metric_values(None, None, None, 10)
    assert all(row["missing"] == "episode_missing" for row in missing.values())


def write_arm(folder: Path, meta, delta=0):
    folder.mkdir()
    plan_hash = AA.sha256({"budget": meta["budget"], "episodes": meta["episodes"]})
    provenance = {
        "plan_sha256": plan_hash, "started_at": "2026-01-01T00:00:00Z", "finished_at": "2026-01-01T00:01:00Z",
        "repository_at_start": {"revision": "abc", "worktree_sha256": "work"},
        "repository_at_end": {"revision": "abc", "worktree_sha256": "work"},
        "models_and_prompts": {"same": True}, "cases": [{"path": x, "raw_sha256": "h"} for x in ("cases/high.json", "cases/low.json")],
    }
    (folder / "batch.json").write_text(json.dumps(meta))
    (folder / "provenance.json").write_text(json.dumps(provenance))
    scores, judged = [], []
    for row in meta["episodes"]:
        identity = AA.episode_id(row)
        episode = {"id": identity, "case": row[0], "profile": row[1], "temperament": row[2], "seed": row[3],
                   "outcome": "solved", "failure": None, "report": {"trace": [{"witnessed": []}]}}
        (folder / f"{identity}.json").write_text(json.dumps(episode))
        scores.append({"id": identity, "metrics": {"solved": True, "correct": True, "actions": 5 + delta,
                       "hints_that_helped": 1, "longest_stall": 2, "character_turns": 2,
                       "character_fallbacks": 0, "neutral_replies": 0}})
        judged.append({"id": identity, "scores": {"fairness": {"score": 6 + delta}, "fun": {"score": 5}}})
    (folder / "scores.json").write_text(json.dumps(scores))
    (folder / "judged.json").write_text(json.dumps(judged))


def test_analysis_is_deterministic_and_joins_all_pairs(tmp_path, monkeypatch):
    class PassingAudit:
        def to_dict(self):
            return {"schema_version": "playtest-comparison-audit-v1", "status": "PASS", "reasons": [], "checks": {}}

    monkeypatch.setattr(AA, "require_passing_audit", lambda *_: PassingAudit())
    a, b = tmp_path / "a", tmp_path / "b"
    meta_a, meta_b = batch(), batch("b", "a")
    write_arm(a, meta_a)
    write_arm(b, meta_b, 1)
    prereg = tmp_path / "prereg.json"
    prereg.write_text(json.dumps({"expected_pairs": 2, "metrics": list(AA.METRICS), "budget": meta_a["budget"],
                                  "episodes": meta_a["episodes"],
                                  "cases": [{"path": "cases/low.json"}, {"path": "cases/high.json"}]}))
    first = AA.analyze(a, b, prereg)
    second = AA.analyze(a, b, prereg)
    assert first == second
    assert first["denominator"]["planned_pairs"] == 2
    assert first["metrics"]["actions_or_censored_action_budget"]["paired_complete"] == 2
    assert first["metrics"]["actions_or_censored_action_budget"]["paired_difference"]["equal_case_blocked_mean"] == 1
    assert first["metrics"]["judged_fairness"]["paired_difference"]["equal_case_blocked_mean"] == 1


def test_analysis_refuses_to_interpret_failed_preflight(tmp_path):
    arm_a, arm_b = tmp_path / "a", tmp_path / "b"
    arm_a.mkdir()
    arm_b.mkdir()
    prereg = tmp_path / "registration.json"
    prereg.write_text("{}")
    with pytest.raises(AA.ComparisonAuditError) as raised:
        AA.analyze(arm_a, arm_b, prereg)
    assert raised.value.audit.status == "FAIL"
    assert raised.value.audit.reasons
