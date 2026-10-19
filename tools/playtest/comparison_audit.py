"""Offline, fail-closed preflight for paired playtest comparisons."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

AuditStatus = Literal["PASS", "FAIL"]
_HEX = frozenset("0123456789abcdef")
_REQUEST_FIELDS = (
    "role", "requested_model", "effective_serving_model", "region", "inference_config",
    "prompt_hashes", "started_at", "finished_at", "status", "usage",
)
_PROMPT_HASH_FIELDS = ("system_sha256", "user_sha256", "combined_sha256")
_CONFIG_PATHS = (
    ("direct_routes", "player"), ("direct_routes", "questionnaire"), ("direct_routes", "judge"),
    ("direct_inference", "player"), ("direct_inference", "questionnaire"), ("direct_inference", "judge"),
    ("prompt_hashes", "player_template_sha256"), ("prompt_hashes", "questionnaire_sha256"),
    ("prompt_hashes", "judge_system_sha256"), ("prompt_hashes", "judge_schema_sha256"),
    ("prompt_hashes", "rendered_player_systems"), ("profiles_sha256",), ("proxy", "routes"),
)


@dataclass(frozen=True)
class AuditReason:
    code: str
    message: str
    arm: str | None = None
    artifact: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {key: value for key, value in (
            ("code", self.code), ("message", self.message), ("arm", self.arm), ("artifact", self.artifact)
        ) if value is not None}


@dataclass(frozen=True)
class ComparisonAudit:
    status: AuditStatus
    reasons: tuple[AuditReason, ...]
    checks: dict[str, Any]
    schema_version: str = "playtest-comparison-audit-v1"

    @property
    def passed(self) -> bool:
        return self.status == "PASS"

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "status": self.status,
            "reasons": [reason.to_dict() for reason in self.reasons],
            "checks": self.checks,
        }


class ComparisonAuditError(RuntimeError):
    """Raised when a gate-eligible comparison fails its offline preflight."""

    def __init__(self, audit: ComparisonAudit):
        self.audit = audit
        super().__init__("playtest comparison audit FAIL: " + "; ".join(
            f"{reason.code}: {reason.message}" for reason in audit.reasons
        ))


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256(value: Any) -> str:
    if isinstance(value, bytes):
        raw = value
    elif isinstance(value, Path):
        raw = value.read_bytes()
    else:
        raw = (value if isinstance(value, str) else canonical(value)).encode()
    return hashlib.sha256(raw).hexdigest()


def episode_id(row: list[Any] | tuple[Any, ...]) -> str:
    case, profile, temperament, seed = row
    return f"{Path(case).stem}__{profile}__{temperament}__s{seed}"


def _valid_hash(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and set(value) <= _HEX


def _get(value: Any, path: tuple[str, ...]) -> Any:
    for key in path:
        if not isinstance(value, dict) or key not in value:
            return None
        value = value[key]
    return value


def audit_comparison(arm_a_dir: Path, arm_b_dir: Path, registration_path: Path | None) -> ComparisonAudit:
    """Validate local artifacts only. This function performs no network or model calls."""
    arm_a_dir, arm_b_dir = Path(arm_a_dir), Path(arm_b_dir)
    reasons: list[AuditReason] = []
    loaded: dict[str, dict[str, Any]] = {"A": {}, "B": {}}
    checks: dict[str, Any] = {"network_access": False, "arms": {"A": arm_a_dir.name, "B": arm_b_dir.name}}

    def fail(code: str, message: str, arm: str | None = None, artifact: str | None = None) -> None:
        reasons.append(AuditReason(code, message, arm, artifact))

    def load_json(path: Path, code: str, arm: str | None = None) -> Any:
        try:
            with path.open(encoding="utf-8") as handle:
                return json.load(handle)
        except Exception as exc:
            fail(code, f"cannot read valid JSON from {path}: {type(exc).__name__}: {exc}", arm, path.name)
            return None

    registration = None
    if registration_path is None:
        fail("registration_missing", "a comparison registration is required for gate-eligible paired reporting")
    else:
        registration = load_json(Path(registration_path), "registration_invalid")
        checks["registration_sha256"] = sha256(Path(registration_path)) if registration is not None else None
    if registration is not None:
        if registration.get("registered_before_model_calls") is not True:
            fail("registration_timing_invalid", "registration must explicitly state registered_before_model_calls=true")
        for field in ("arm_a_batch", "arm_b_batch"):
            if not isinstance(registration.get(field), str) or not registration[field]:
                fail("registration_arm_missing", f"registration field {field} is required")

    for label, folder in (("A", arm_a_dir), ("B", arm_b_dir)):
        loaded[label]["batch"] = load_json(folder / "batch.json", "batch_invalid", label)
        loaded[label]["provenance"] = load_json(folder / "provenance.json", "provenance_invalid", label)

    a_batch, b_batch = loaded["A"].get("batch"), loaded["B"].get("batch")
    a_prov, b_prov = loaded["A"].get("provenance"), loaded["B"].get("provenance")
    batches = {"A": a_batch, "B": b_batch}
    provenances = {"A": a_prov, "B": b_prov}

    if registration is not None and all(isinstance(x, dict) for x in (a_batch, b_batch, a_prov, b_prov)):
        expected_names = {"A": registration.get("arm_a_batch"), "B": registration.get("arm_b_batch")}
        for label in ("A", "B"):
            expected = expected_names[label]
            if batches[label].get("batch") != expected or provenances[label].get("batch") != expected:
                fail("registered_arm_mismatch", f"Arm {label} batch/provenance does not identify registered batch {expected!r}", label)
            comparison = provenances[label].get("comparison")
            other = expected_names["B" if label == "A" else "A"]
            expected_declaration = {
                "registration_sha256": checks["registration_sha256"], "registered_arm": label,
                "comparator_batch": other,
            }
            if comparison != expected_declaration or batches[label].get("comparison") != expected_declaration:
                fail("comparator_declaration_mismatch", f"Arm {label} batch/provenance comparator declarations do not match registration", label)
        if b_batch.get("paired_with") != expected_names["A"] or b_prov.get("paired_with") != expected_names["A"]:
            fail("comparator_identity_mismatch", "Arm B batch and provenance must both declare registered Arm A as paired_with", "B")
        if a_batch.get("paired_with") not in (None, "") or a_prov.get("paired_with") not in (None, ""):
            fail("comparator_identity_mismatch", "registered Arm A must be the independent comparator, not a derived arm", "A")

    plans: dict[str, list[list[Any]]] = {}
    plan_ids: dict[str, list[str]] = {}
    if isinstance(a_batch, dict) and isinstance(b_batch, dict):
        for label in ("A", "B"):
            raw_plan = batches[label].get("episodes")
            if not isinstance(raw_plan, list) or any(not isinstance(row, list) or len(row) != 4 for row in raw_plan):
                fail("plan_invalid", f"Arm {label} episode plan must be a list of four-field rows", label)
                continue
            try:
                ids = [episode_id(row) for row in raw_plan]
                for row in raw_plan:
                    int(row[3])
            except (TypeError, ValueError) as exc:
                fail("plan_invalid", f"Arm {label} episode plan has an invalid identity: {exc}", label)
                continue
            plans[label], plan_ids[label] = raw_plan, ids
            if len(set(ids)) != len(ids):
                fail("duplicate_planned_episode", f"Arm {label} episode plan contains duplicate IDs", label)
        if "A" in plans and "B" in plans and plans["A"] != plans["B"]:
            fail("plan_order_or_identity_mismatch", "arm plans differ in exact episode order or identity")
        if a_batch.get("budget") != b_batch.get("budget"):
            fail("budget_mismatch", "arm budgets differ")
        if registration is not None and "A" in plans:
            if registration.get("episodes") != plans["A"]:
                fail("registered_plan_mismatch", "Arm A plan differs from the registered exact episode order and identities")
            if registration.get("budget") != a_batch.get("budget"):
                fail("registered_budget_mismatch", "Arm A budget differs from the registered budget")
            if registration.get("expected_pairs") != len(plans["A"]):
                fail("registered_pair_count_mismatch", "registered expected_pairs differs from the exact plan length")
            if registration.get("expected_episodes") != len(plans["A"]) * 2:
                fail("registered_episode_count_mismatch", "registered expected_episodes differs from two complete arms")

    if "A" in plans and isinstance(a_batch, dict):
        expected_plan_hash = sha256({"budget": a_batch.get("budget"), "episodes": plans["A"]})
        checks["plan_sha256"] = expected_plan_hash
        for label in ("A", "B"):
            if isinstance(provenances[label], dict) and provenances[label].get("plan_sha256") != expected_plan_hash:
                fail("provenance_plan_hash_mismatch", f"Arm {label} provenance plan hash differs from analyzed plan", label)
            if isinstance(provenances[label], dict) and (
                    provenances[label].get("episodes") != plans.get(label)
                    or provenances[label].get("budget") != batches[label].get("budget")
                    or provenances[label].get("planned_episodes") != len(plans.get(label, []))):
                fail("provenance_plan_manifest_mismatch", f"Arm {label} provenance does not repeat the exact plan, budget, and count", label)

    records: dict[str, dict[str, dict[str, Any]]] = {"A": {}, "B": {}}
    for label, folder in (("A", arm_a_dir), ("B", arm_b_dir)):
        by_id: dict[str, dict[str, Any]] = {}
        for path in sorted(folder.glob("*.json")):
            value = load_json(path, "episode_artifact_invalid", label)
            if not isinstance(value, dict) or "id" not in value or "outcome" not in value:
                continue
            identity = value.get("id")
            if not isinstance(identity, str):
                fail("episode_identity_invalid", f"episode record {path.name} has no string id", label, path.name)
                continue
            if identity in by_id:
                fail("duplicate_episode_record", f"multiple episode records declare id {identity}", label, path.name)
            else:
                by_id[identity] = value
        records[label] = by_id
        if label in plan_ids:
            planned = set(plan_ids[label])
            extra = sorted(set(by_id) - planned)
            if extra:
                fail("unplanned_episode_record", f"Arm {label} contains unplanned episode records: {extra}", label)
            for identity, row in by_id.items():
                if identity not in planned:
                    continue
                planned_row = plans[label][plan_ids[label].index(identity)]
                actual = [row.get("case"), row.get("profile"), row.get("temperament"), row.get("seed")]
                if actual != planned_row:
                    fail("episode_record_identity_mismatch", f"episode {identity} fields differ from its planned identity", label, identity)

    for label in ("A", "B"):
        if label not in plan_ids or not isinstance(provenances[label], dict):
            continue
        expected_ids = plan_ids[label]
        early = (registration.get("early_stops") or {}).get(label) if isinstance(registration, dict) else None
        if early is None:
            if set(records[label]) != set(expected_ids):
                missing = sorted(set(expected_ids) - set(records[label]))
                fail("arm_incomplete", f"Arm {label} lacks exactly one record per planned episode; missing={missing}", label)
            if provenances[label].get("status") != "completed":
                fail("arm_not_completed", f"Arm {label} provenance status is not completed", label)
        else:
            registered_ids = early.get("expected_episode_ids") if isinstance(early, dict) else None
            if not isinstance(registered_ids, list) or not early.get("reason"):
                fail("early_stop_registration_invalid", f"Arm {label} early stop needs reason and expected_episode_ids", label)
            elif any(identity not in expected_ids for identity in registered_ids) or set(records[label]) != set(registered_ids):
                fail("early_stop_records_mismatch", f"Arm {label} records do not exactly match the registered early-stop IDs", label)
            if provenances[label].get("status") != "early_stopped" or provenances[label].get("early_stop_registration_sha256") != sha256(early):
                fail("early_stop_provenance_mismatch", f"Arm {label} provenance does not attest the registered early stop", label)

    for label in ("A", "B"):
        provenance = provenances[label]
        if not isinstance(provenance, dict):
            continue
        start, end = provenance.get("repository_at_start"), provenance.get("repository_at_end")
        valid_fingerprint = lambda value: (isinstance(value, dict) and isinstance(value.get("revision"), str)
                                           and bool(value.get("revision")) and isinstance(value.get("branch"), str)
                                           and _valid_hash(value.get("worktree_sha256")))
        if not valid_fingerprint(start) or not valid_fingerprint(end):
            fail("repository_fingerprint_missing", f"Arm {label} needs valid start and end repository fingerprints", label)
        else:
            stable_fields = ("revision", "branch", "worktree_sha256")
            if any(start.get(field) != end.get(field) for field in stable_fields) or provenance.get("repository_unchanged_during_arm") is not True:
                fail("repository_changed_during_arm", f"Arm {label} repository/worktree changed during acquisition", label)
    if all(isinstance(p, dict) for p in (a_prov, b_prov)):
        a_start, b_start = a_prov.get("repository_at_start"), b_prov.get("repository_at_start")
        if isinstance(a_start, dict) and isinstance(b_start, dict):
            if any(a_start.get(field) != b_start.get(field) for field in ("revision", "branch", "worktree_sha256")):
                fail("arm_repository_mismatch", "arms did not start from the identical repository revision, branch, and worktree")

    if all(isinstance(p, dict) for p in (a_prov, b_prov)):
        cases_a, cases_b = a_prov.get("cases"), b_prov.get("cases")
        planned_cases = sorted({row[0] for row in plans.get("A", [])})
        valid_cases_a = isinstance(cases_a, list) and all(
            isinstance(row, dict) and isinstance(row.get("path"), str) and _valid_hash(row.get("raw_sha256")) for row in cases_a
        )
        valid_cases_b = isinstance(cases_b, list) and all(
            isinstance(row, dict) and isinstance(row.get("path"), str) and _valid_hash(row.get("raw_sha256")) for row in cases_b
        )
        if not valid_cases_a or sorted(row["path"] for row in cases_a) != planned_cases:
            fail("case_hash_manifest_invalid", "Arm A case hash manifest is incomplete or malformed", "A")
        if not valid_cases_b or sorted(row["path"] for row in cases_b) != planned_cases:
            fail("case_hash_manifest_invalid", "Arm B case hash manifest is incomplete or malformed", "B")
        if valid_cases_a and valid_cases_b and cases_a != cases_b:
            fail("case_hash_mismatch", "arm case paths or raw hashes differ")

        configs = {"A": a_prov.get("models_and_prompts"), "B": b_prov.get("models_and_prompts")}
        for label in ("A", "B"):
            missing = [".".join(path) for path in _CONFIG_PATHS if _get(configs[label], path) is None]
            if missing:
                fail("model_prompt_configuration_missing", f"Arm {label} lacks required configuration: {missing}", label)
        if canonical(configs["A"]) != canonical(configs["B"]):
            fail("model_prompt_configuration_mismatch", "configured models, prompts, inference settings, or proxy routes differ")

    for label, folder in (("A", arm_a_dir), ("B", arm_b_dir)):
        provenance = provenances[label]
        if not isinstance(provenance, dict):
            continue
        config = provenance.get("models_and_prompts") or {}
        for kind, field in (("direct", "direct_request_audit"), ("proxy", "proxy_request_audit")):
            declared = provenance.get(field)
            # a file name in the arm directory, or an external artifact record {path, producer, present}
            name = declared.get("path") if isinstance(declared, dict) else declared
            if not isinstance(name, str) or not name:
                fail("request_audit_not_declared", f"Arm {label} does not declare {field}", label)
                continue
            path = (folder / name).resolve()
            if path.parent != folder.resolve():
                fail("request_audit_path_invalid", f"Arm {label} request audit must stay inside the arm directory", label, name)
                continue
            try:
                rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
            except Exception as exc:
                fail("request_audit_invalid", f"cannot read {name}: {type(exc).__name__}: {exc}", label, name)
                continue
            if not rows:
                fail("request_audit_empty", f"Arm {label} {kind} request audit is empty", label, name)
                continue
            for index, row in enumerate(rows, start=1):
                artifact = f"{name}:{index}"
                if not isinstance(row, dict):
                    fail("request_audit_row_invalid", "request audit row is not an object", label, artifact)
                    continue
                missing = [field_name for field_name in _REQUEST_FIELDS if field_name not in row]
                if missing:
                    fail("request_audit_fields_missing", f"request audit row lacks fields {missing}", label, artifact)
                    continue
                serving = row.get("effective_serving_model")
                if not isinstance(serving, str) or not serving:
                    fail("effective_serving_model_not_explicit", "effective serving model must be a model ID or the string 'unknown'", label, artifact)
                hashes = row.get("prompt_hashes")
                if not isinstance(hashes, dict) or any(not _valid_hash(hashes.get(key)) for key in _PROMPT_HASH_FIELDS):
                    fail("request_prompt_hashes_invalid", "request prompt hashes are missing or malformed", label, artifact)
                if not isinstance(row.get("inference_config"), dict) or not row["inference_config"]:
                    fail("request_inference_config_invalid", "request inference configuration is missing", label, artifact)
                if row.get("status") == "completed":
                    required_completed = ("response_sha256", "bedrock_request_id", "http_status", "sdk_retry_attempts")
                    if any(field_name not in row for field_name in required_completed) or not _valid_hash(row.get("response_sha256")):
                        fail("completed_request_fields_missing", "completed request lacks response/provider audit fields", label, artifact)
                elif row.get("status") not in ("failed", "transient_error_retry"):
                    fail("request_status_invalid", f"unsupported request status {row.get('status')!r}", label, artifact)
                if kind == "direct":
                    context = row.get("context")
                    if not isinstance(context, dict) or any(key not in context for key in ("episode_id", "case", "profile", "temperament", "seed")):
                        fail("direct_request_context_missing", "direct request lacks complete episode context", label, artifact)
                    elif label in plan_ids and context.get("episode_id") not in set(plan_ids[label]):
                        fail("direct_request_episode_unplanned", "direct request refers to an unplanned episode", label, artifact)
                    role = str(row.get("role"))
                    expected_model = _get(config, ("direct_routes", role))
                    if expected_model is None or row.get("requested_model") != expected_model:
                        fail("request_model_mismatch", "direct requested model differs from declared route", label, artifact)
                    expected_inference = _get(config, ("direct_inference", role))
                    actual_inference = row.get("inference_config") or {}
                    inference_matches = isinstance(expected_inference, dict) and actual_inference.get("maxTokens") == expected_inference.get("maxTokens")
                    expected_temperature = (expected_inference or {}).get("temperature") if isinstance(expected_inference, dict) else None
                    if isinstance(expected_temperature, (int, float)):
                        inference_matches = inference_matches and actual_inference.get("temperature") == expected_temperature
                    elif expected_temperature == "omitted/provider-default":
                        inference_matches = inference_matches and actual_inference.get("temperature_state") == expected_temperature
                    if not inference_matches:
                        fail("request_inference_mismatch", "direct request inference settings differ from declared configuration", label, artifact)
                    if not _valid_hash(row.get("schema_sha256")):
                        fail("request_schema_hash_invalid", "direct request schema hash is missing or malformed", label, artifact)
                    system_hash = (row.get("prompt_hashes") or {}).get("system_sha256")
                    if role == "player":
                        rendered = _get(config, ("prompt_hashes", "rendered_player_systems")) or []
                        expected_hashes = {
                            item.get("sha256") for item in rendered if isinstance(item, dict) and isinstance(context, dict)
                            and item.get("profile") == context.get("profile")
                            and item.get("temperament") == context.get("temperament")
                        }
                    elif role == "questionnaire":
                        expected_hashes = {_get(config, ("prompt_hashes", "questionnaire_sha256"))}
                    elif role == "judge":
                        expected_hashes = set(_get(config, ("prompt_hashes", "judge_system_sha256")) or [])
                        if row.get("schema_sha256") != _get(config, ("prompt_hashes", "judge_schema_sha256")):
                            fail("request_schema_mismatch", "judge request schema differs from declared configuration", label, artifact)
                    else:
                        expected_hashes = set()
                    if system_hash not in expected_hashes:
                        fail("request_system_prompt_mismatch", "direct request system prompt differs from declared prompt hashes", label, artifact)
                else:
                    route = _get(config, ("proxy", "routes", str(row.get("role"))))
                    if not isinstance(route, str) or row.get("requested_model") != route.split(":", 1)[-1]:
                        fail("request_model_mismatch", "proxy requested model differs from declared route", label, artifact)

    checks["reason_count"] = len(reasons)
    checks["planned_pairs"] = len(plans.get("A", []))
    checks["records"] = {label: len(records[label]) for label in ("A", "B")}
    return ComparisonAudit("FAIL" if reasons else "PASS", tuple(reasons), checks)


def require_passing_audit(arm_a_dir: Path, arm_b_dir: Path, registration_path: Path | None) -> ComparisonAudit:
    audit = audit_comparison(arm_a_dir, arm_b_dir, registration_path)
    if not audit.passed:
        raise ComparisonAuditError(audit)
    return audit
