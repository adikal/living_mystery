"""Offline contract tests for fail-closed paired playtest comparison auditing."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PLAYTEST = ROOT / "tools" / "playtest"
sys.path.insert(0, str(PLAYTEST))
from comparison_audit import ComparisonAuditError, audit_comparison, episode_id, sha256  # noqa: E402

REPORT_SPEC = importlib.util.spec_from_file_location("playtest_report_audit", PLAYTEST / "report.py")
assert REPORT_SPEC and REPORT_SPEC.loader
REPORT = importlib.util.module_from_spec(REPORT_SPEC)
REPORT_SPEC.loader.exec_module(REPORT)

HASH = "a" * 64
PLAN = [
    ["cases/one.json", "beginner", "literal", 1],
    ["cases/two.json", "pro", "bold", 2],
]


def registration(early_stops=None):
    value = {
        "registered_before_model_calls": True,
        "arm_a_batch": "arm-a", "arm_b_batch": "arm-b",
        "expected_pairs": 2, "expected_episodes": 4,
        "budget": {"actions": 10, "minutes": 60}, "episodes": PLAN,
    }
    if early_stops is not None:
        value["early_stops"] = early_stops
    return value


def config():
    return {
        "direct_routes": {"player": "player-model", "questionnaire": "player-model", "judge": "judge-model"},
        "direct_inference": {
            "player": {"maxTokens": 600, "temperature": 0.8},
            "questionnaire": {"maxTokens": 800, "temperature": 0.3},
            "judge": {"maxTokens": 8000, "temperature": "omitted/provider-default"},
        },
        "prompt_hashes": {
            "player_template_sha256": HASH, "questionnaire_sha256": HASH,
            "judge_system_sha256": [HASH], "judge_schema_sha256": HASH,
            "rendered_player_systems": [{"profile": "beginner", "temperament": "literal", "sha256": HASH}],
        },
        "profiles_sha256": HASH,
        "proxy": {"routes": {"character": "bedrock:character-model"}},
    }


def audit_row(kind, identity):
    row = {
        "role": "player" if kind == "direct" else "character",
        "requested_model": "player-model" if kind == "direct" else "character-model",
        "effective_serving_model": "unknown", "region": "us-west-2",
        "inference_config": {"maxTokens": 600, "temperature": 0.8},
        "prompt_hashes": {"system_sha256": HASH, "user_sha256": HASH, "combined_sha256": HASH},
        "started_at": "2026-01-01T00:00:00Z", "finished_at": "2026-01-01T00:00:01Z",
        "status": "completed", "usage": {"inputTokens": 1}, "response_sha256": HASH,
        "bedrock_request_id": "request", "http_status": 200, "sdk_retry_attempts": 0,
        "schema_sha256": HASH,
    }
    if kind == "direct":
        planned = next(row for row in PLAN if episode_id(row) == identity)
        row["context"] = {"episode_id": identity, "case": planned[0], "profile": planned[1],
                          "temperament": planned[2], "seed": planned[3]}
    return row


def write_fixture(tmp_path, early_stops=None):
    reg_path = tmp_path / "registration.json"
    reg = registration(early_stops)
    reg_path.write_text(json.dumps(reg))
    reg_hash = sha256(reg_path)
    folders = {label: tmp_path / label.lower() for label in ("A", "B")}
    for label, folder in folders.items():
        folder.mkdir()
        batch_name = "arm-a" if label == "A" else "arm-b"
        declaration = {"registration_sha256": reg_hash, "registered_arm": label,
                       "comparator_batch": "arm-b" if label == "A" else "arm-a"}
        batch = {"batch": batch_name, "budget": reg["budget"], "episodes": PLAN, "comparison": declaration}
        if label == "B":
            batch["paired_with"] = "arm-a"
        (folder / "batch.json").write_text(json.dumps(batch))
        early = (early_stops or {}).get(label)
        expected_ids = early["expected_episode_ids"] if early else [episode_id(row) for row in PLAN]
        status = "early_stopped" if early else "completed"
        fingerprint = {"revision": "rev", "branch": "main", "worktree_sha256": HASH}
        provenance = {
            "batch": batch_name, "paired_with": "arm-a" if label == "B" else None,
            "comparison": declaration,
            "plan_sha256": sha256({"budget": reg["budget"], "episodes": PLAN}),
            "budget": reg["budget"], "episodes": PLAN, "planned_episodes": len(PLAN),
            "status": status, "repository_at_start": fingerprint, "repository_at_end": fingerprint,
            "repository_unchanged_during_arm": True,
            "cases": [{"path": path, "raw_sha256": HASH} for path in ("cases/one.json", "cases/two.json")],
            "models_and_prompts": config(), "direct_request_audit": "direct_requests.jsonl",
            "proxy_request_audit": "proxy_requests.jsonl",
        }
        if early:
            provenance["early_stop_registration_sha256"] = sha256(early)
        (folder / "provenance.json").write_text(json.dumps(provenance))
        for planned in PLAN:
            identity = episode_id(planned)
            if identity not in expected_ids:
                continue
            record = {"id": identity, "case": planned[0], "profile": planned[1],
                      "temperament": planned[2], "seed": planned[3], "outcome": "solved", "failure": None}
            (folder / f"{identity}.json").write_text(json.dumps(record))
        first = expected_ids[0]
        (folder / "direct_requests.jsonl").write_text(json.dumps(audit_row("direct", first)) + "\n")
        (folder / "proxy_requests.jsonl").write_text(json.dumps(audit_row("proxy", first)) + "\n")
    return folders["A"], folders["B"], reg_path


def reason_codes(result):
    return {reason.code for reason in result.reasons}


def rewrite(path, mutate):
    value = json.loads(path.read_text())
    mutate(value)
    path.write_text(json.dumps(value))


def test_valid_comparison_returns_typed_pass(tmp_path):
    a, b, reg = write_fixture(tmp_path)
    result = audit_comparison(a, b, reg)
    assert result.status == "PASS"
    assert result.passed and result.reasons == ()
    assert result.to_dict()["checks"]["network_access"] is False
    metadata = REPORT.comparison_preflight(b, a, reg)
    assert metadata["mode"] == "audited_paired"
    assert metadata["gate_result_allowed"] is True
    assert metadata["audit"]["status"] == "PASS"


@pytest.mark.parametrize(("mutation", "code"), [
    (lambda a, b, r: rewrite(b / "batch.json", lambda x: x.update(paired_with="other")), "comparator_identity_mismatch"),
    (lambda a, b, r: rewrite(a / "provenance.json", lambda x: x["comparison"].update(registered_arm="B")), "comparator_declaration_mismatch"),
    (lambda a, b, r: rewrite(b / "provenance.json", lambda x: x.update(batch="other")), "registered_arm_mismatch"),
    (lambda a, b, r: rewrite(b / "batch.json", lambda x: x.update(episodes=list(reversed(x["episodes"])))), "plan_order_or_identity_mismatch"),
    (lambda a, b, r: rewrite(b / "batch.json", lambda x: x["budget"].update(actions=11)), "budget_mismatch"),
    (lambda a, b, r: rewrite(r, lambda x: x.update(episodes=list(reversed(x["episodes"])))), "registered_plan_mismatch"),
    (lambda a, b, r: rewrite(a / "provenance.json", lambda x: x.update(plan_sha256="b" * 64)), "provenance_plan_hash_mismatch"),
    (lambda a, b, r: rewrite(a / "provenance.json", lambda x: x.update(planned_episodes=1)), "provenance_plan_manifest_mismatch"),
    (lambda a, b, r: (a / f"copy-{episode_id(PLAN[0])}.json").write_text((a / f"{episode_id(PLAN[0])}.json").read_text()), "duplicate_episode_record"),
    (lambda a, b, r: (a / f"{episode_id(PLAN[1])}.json").unlink(), "arm_incomplete"),
    (lambda a, b, r: (a / "extra.json").write_text(json.dumps({"id": "extra", "outcome": "solved"})), "unplanned_episode_record"),
    (lambda a, b, r: rewrite(a / f"{episode_id(PLAN[0])}.json", lambda x: x.update(seed=99)), "episode_record_identity_mismatch"),
    (lambda a, b, r: rewrite(a / "provenance.json", lambda x: x["repository_at_end"].update(worktree_sha256="b" * 64)), "repository_changed_during_arm"),
    (lambda a, b, r: rewrite(b / "provenance.json", lambda x: x["repository_at_start"].update(worktree_sha256="b" * 64)), "arm_repository_mismatch"),
    (lambda a, b, r: rewrite(b / "provenance.json", lambda x: x["cases"][0].update(raw_sha256="b" * 64)), "case_hash_mismatch"),
    (lambda a, b, r: rewrite(a / "provenance.json", lambda x: x["models_and_prompts"].pop("profiles_sha256")), "model_prompt_configuration_missing"),
    (lambda a, b, r: rewrite(b / "provenance.json", lambda x: x["models_and_prompts"]["direct_routes"].update(player="other")), "model_prompt_configuration_mismatch"),
    (lambda a, b, r: (a / "proxy_requests.jsonl").unlink(), "request_audit_invalid"),
    (lambda a, b, r: rewrite(a / "direct_requests.jsonl", lambda x: x.pop("usage")), "request_audit_fields_missing"),
    (lambda a, b, r: rewrite(a / "direct_requests.jsonl", lambda x: x.update(effective_serving_model=None)), "effective_serving_model_not_explicit"),
    (lambda a, b, r: rewrite(a / "direct_requests.jsonl", lambda x: x["prompt_hashes"].update(system_sha256="bad")), "request_prompt_hashes_invalid"),
    (lambda a, b, r: rewrite(a / "direct_requests.jsonl", lambda x: x.update(requested_model="other")), "request_model_mismatch"),
    (lambda a, b, r: rewrite(a / "direct_requests.jsonl", lambda x: x["inference_config"].update(maxTokens=999)), "request_inference_mismatch"),
    (lambda a, b, r: rewrite(a / "direct_requests.jsonl", lambda x: x["prompt_hashes"].update(system_sha256="b" * 64)), "request_system_prompt_mismatch"),
])
def test_each_comparison_mismatch_fails_closed(tmp_path, mutation, code):
    a, b, reg = write_fixture(tmp_path)
    mutation(a, b, reg)
    result = audit_comparison(a, b, reg)
    assert result.status == "FAIL"
    assert code in reason_codes(result)


def test_missing_registration_fails_closed(tmp_path):
    a, b, _ = write_fixture(tmp_path)
    result = audit_comparison(a, b, None)
    assert result.status == "FAIL"
    assert "registration_missing" in reason_codes(result)


def test_registered_early_stop_is_valid_but_unregistered_stop_fails(tmp_path):
    first = episode_id(PLAN[0])
    early = {"A": {"reason": "predeclared cost bound", "expected_episode_ids": [first]}}
    a, b, reg = write_fixture(tmp_path, early)
    assert audit_comparison(a, b, reg).status == "PASS"
    rewrite(a / "provenance.json", lambda x: x.pop("early_stop_registration_sha256"))
    result = audit_comparison(a, b, reg)
    assert result.status == "FAIL"
    assert "early_stop_provenance_mismatch" in reason_codes(result)


def test_historical_comparison_requires_explicit_descriptive_mode(tmp_path):
    before, after = tmp_path / "before", tmp_path / "after"
    before.mkdir()
    after.mkdir()
    with pytest.raises(ComparisonAuditError):
        REPORT.comparison_preflight(after, before)
    metadata = REPORT.comparison_preflight(after, before, legacy_descriptive=True)
    assert metadata["mode"] == "legacy_descriptive"
    assert metadata["gate_result_allowed"] is False
    assert metadata["audit"]["status"] == "FAIL"
    assert "not a gate result" in metadata["label"]
    rendered = REPORT.markdown("historical", {}, {}, {}, [], {**metadata, "pairs": 0, "deltas": {}})
    assert "Legacy descriptive comparison — not a gate result" in rendered
