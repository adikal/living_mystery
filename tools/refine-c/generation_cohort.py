#!/usr/bin/env python3
"""Prospective C3/E2 generation cohort runner.

The acquisition path writes only below the ignored runs/experiments tree.  It never calls
publish_live, updates premise history, or touches playable manifests.  Public outputs contain
compact outcomes and hashes only.
"""
from __future__ import annotations

import argparse
import collections
import copy
import datetime as dt
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
RESULTS = ROOT / "tools" / "paper-evidence" / "results"
EXPERIMENTS = HERE / "runs" / "experiments"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "server"))

import difficulty
import premise
import provenance

SCHEMA_VERSION = "e2-generation-cohort-v1"
LEVEL_ORDER = ("easy", "medium", "hard") * 4
DRAW_SEED_PREFIX = "sleuthcraft-c3-e2-pilot-v1"
MAX_PARALLEL = 3
MAX_WALL_SECONDS = 60 * 60
EXTRA_SLOT_SECONDS = 12 * 60
INPUT_PATHS = (
    "tools/refine-c/refine.py",
    "tools/refine-c/provenance.py",
    "tools/refine-c/publish.py",
    "tools/refine-c/enrich.py",
    "tools/refine-c/premise.py",
    "tools/refine-c/difficulty.py",
    "tools/refine-c/settings/bellweather.json",
    "tools/refine-c/settings/difficulty.json",
)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def sha(value):
    if not isinstance(value, bytes):
        value = value.encode() if isinstance(value, str) else canonical(value).encode()
    return hashlib.sha256(value).hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, default=str) + "\n")
    os.replace(temporary, path)


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def repository_provenance():
    status = git("status", "--porcelain=v1", "--untracked-files=all").splitlines()
    tracked_diff = subprocess.run(["git", "diff", "--binary", "HEAD"], cwd=ROOT, check=True, capture_output=True).stdout
    untracked = sorted(line[3:] for line in status if line.startswith("?? "))
    untracked_rows = []
    for relative in untracked:
        path = ROOT / relative
        if path.is_file():
            untracked_rows.append({"path": relative, "sha256": sha(path.read_bytes())})
    inputs = [{"path": relative, "sha256": sha((ROOT / relative).read_bytes())} for relative in INPUT_PATHS]
    return {
        "commit": git("rev-parse", "HEAD").strip(),
        "branch": git("branch", "--show-current").strip() or None,
        "worktree_dirty": bool(status),
        "archival_status": "preliminary/non-archival" if status else "archival",
        "tracked_dirty_paths": sorted(line[3:] for line in status if not line.startswith("?? ")),
        "untracked_paths": untracked,
        "tracked_diff_sha256": sha(tracked_diff),
        "untracked_content_sha256": sha(untracked_rows),
        "input_files": inputs,
    }


def predeclare(cohort_id):
    chosen = []
    slots = []
    for index, level in enumerate(LEVEL_ORDER, start=1):
        draw_seed = f"{DRAW_SEED_PREFIX}:{index:02d}"
        pr = premise.draw(seed=draw_seed, history=chosen)
        if pr in chosen:
            raise RuntimeError(f"deterministic premise draw repeated at slot {index}")
        chosen.append(pr)
        profile = difficulty.target(level)
        slots.append({
            "slot_id": f"slot-{index:02d}-{level}",
            "ordinal": index,
            "requested_level": level,
            "requested_difficulty_profile": profile,
            "draw_seed": draw_seed,
            "draw_history_sha256": sha(chosen[:-1]),
            "premise": pr,
            "premise_sha256": sha(pr),
            "status": "predeclared",
            "outcome": None,
            "per_slot_wall_seconds": profile["seconds"] + EXTRA_SLOT_SECONDS,
        })
    return slots


def build_manifest(cohort_id, wall_seconds):
    started = provenance.utc_now()
    return {
        "schema_version": SCHEMA_VERSION,
        "cohort_id": cohort_id,
        "started_at": started,
        "status": "predeclared",
        "design": {
            "denominator": 12,
            "levels": {"easy": 4, "medium": 4, "hard": 4},
            "fixed_order": list(LEVEL_ORDER),
            "draw_seed_prefix": DRAW_SEED_PREFIX,
            "replacement_policy": "none",
            "manual_inclusion_policy": "none",
            "playable_publication": False,
            "max_parallel": MAX_PARALLEL,
            "hard_wall_seconds": wall_seconds,
            "region": provenance.REGION,
            "requested_models": {
                "generation": "us.anthropic.claude-opus-5-5",
                "alternate_and_critic": "us.anthropic.claude-sonnet-5",
                "fast_checks": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            },
            "effective_serving_model_policy": "unknown unless response metadata states it",
        },
        "repository_at_start": repository_provenance(),
        "environment": provenance.environment_metadata(),
        "slots": predeclare(cohort_id),
    }


def certificate_projection(certificate):
    py = certificate.get("python") or {}
    js = certificate.get("js") or {}
    z3 = certificate.get("z3") or {}
    return {
        "ok": certificate.get("ok"),
        "errors": list(certificate.get("errors") or []),
        "python": {key: py.get(key) for key in ("ok", "solve_depth", "max_depth", "threads", "pillars", "motive", "means", "twist")},
        "javascript": {key: js.get(key) for key in ("ok", "solveDepth", "maxDepth", "threads", "pillars")},
        "oracle": {"ok": z3.get("ok"), "errors": list(z3.get("errors") or [])},
        "full_sha256": sha(certificate),
    }


def rate_if_gateable(case, certificate, requested_profile):
    """Rate only a valid pre-publication case; invalid enrichment remains an algorithmic gate failure."""
    if not certificate.get("ok"):
        return None, None
    achieved = {**difficulty.rate(case, report=certificate["python"]), "target": requested_profile["level"]}
    deficits = difficulty.targets_met(case, certificate["python"], requested_profile)
    return achieved, deficits


def provider_censored(audit_snapshot):
    generation = [r for r in audit_snapshot.get("requests", [])
                  if (r.get("semantic") or {}).get("purpose") in ("seed-generation", "refinement-candidate")]
    errors = [r for r in generation if r.get("status") == "error"]
    responses = [r for r in generation if r.get("status") in ("response", "completed-after-cancel")]
    return bool(errors) and not responses


def worker(cohort_dir, slot):
    import refine
    import publish

    slot_dir = Path(cohort_dir) / "slots" / slot["slot_id"]
    audit = provenance.RunAudit(
        slot_dir,
        slot["slot_id"],
        "e2-generation-pilot",
        {
            "cohort_id": Path(cohort_dir).name,
            "requested_level": slot["requested_level"],
            "requested_difficulty_profile": slot["requested_difficulty_profile"],
            "premise_sha256": slot["premise_sha256"],
            "draw_seed": slot["draw_seed"],
            "environment": provenance.environment_metadata(),
            "prompt_schema_versions": {
                "claims_version": refine.CLAIMS_VERSION,
                "system_generation_sha256": sha(refine.SYSTEM_GEN),
                "critic_sha256": sha(refine.CRITIC),
                "critic_schema_sha256": sha(refine.CRITIC_SCHEMA),
                "case_schema_sha256": sha(refine.SCHEMA),
            },
        },
    )
    private = slot_dir / "private"
    result_path = private / "slot-result.json"
    started = time.monotonic()
    refine._client = None
    refine.FORCED_OK.clear()
    with refine._USAGE_LOCK:
        refine.USAGE.update({"in": 0, "out": 0, "calls": 0})
    refine.FIXED = json.loads((HERE / "settings" / "bellweather.json").read_text())
    brief = ("A new case", premise.blurb(slot["premise"]), slot["premise"]["place"], premise.brief(slot["premise"]))
    output = {
        "slot_id": slot["slot_id"],
        "requested_level": slot["requested_level"],
        "requested_difficulty_profile": slot["requested_difficulty_profile"],
        "premise_sha256": slot["premise_sha256"],
        "outcome": None,
    }
    try:
        with provenance.activate(audit, parent_operation="generation", phase="generation", slot_id=slot["slot_id"]):
            generated = refine.run_case("experiment", brief[3], 16, 5, private / "generation", lambda line: print(line, flush=True),
                                        premise=slot["premise"], profile=slot["requested_difficulty_profile"])
        output["generation"] = {key: value for key, value in generated.items() if key != "case"}
        if not generated.get("ok") or "case" not in generated:
            output["outcome"] = "provider-censored" if provider_censored(audit.snapshot()) else "algorithmic-stage-failure"
            output["failure_stage"] = "generation"
            output["failure"] = generated.get("reason") or "generation did not certify"
        else:
            generation_case = generated["case"]
            generation_cert = refine.certify(generation_case, False)
            output["generation_certificate"] = {
                "ok": generation_cert.get("ok"),
                "errors": list(generation_cert.get("errors") or []),
                "metrics": refine.metrics_of(generation_cert),
                "full_sha256": sha(generation_cert),
            }
            with provenance.activate(audit, parent_operation="publish-enrichment", phase="pre-publication", slot_id=slot["slot_id"]):
                published_case = publish.prepare_experiment_case(generation_case, brief, slot["slot_id"])
            pre = publish.deterministic_gate(published_case)
            output["pre_publication_certificate"] = certificate_projection(pre)
            achieved, deficits = rate_if_gateable(published_case, pre, slot["requested_difficulty_profile"])
            if achieved is not None:
                published_case["difficulty"] = achieved
                output["achieved_difficulty"] = achieved
                output["requested_target_deficits"] = deficits
            case_path = private / "final-experiment-case.json"
            atomic_json(case_path, published_case)
            serialized = json.loads(case_path.read_text())
            post = publish.deterministic_gate(serialized)
            output["post_serialization_certificate"] = certificate_projection(post)
            output["case_sha256"] = sha(serialized)
            if pre["ok"] and post["ok"]:
                output["outcome"] = "completed-strictly-gateable"
            else:
                output["outcome"] = "algorithmic-stage-failure"
                output["failure_stage"] = "pre-publication-gate" if not pre["ok"] else "post-serialization-gate"
                output["failure"] = "; ".join((pre if not pre["ok"] else post).get("errors", [])[:5])
        output["seconds"] = round(time.monotonic() - started, 3)
        atomic_json(result_path, output)
        audit.finish(output["outcome"], output.get("failure"),
                     achieved_difficulty=output.get("achieved_difficulty"),
                     certificates={key: output.get(key) for key in ("generation_certificate", "pre_publication_certificate", "post_serialization_certificate")})
        return 0
    except Exception as error:
        output.update({"outcome": "crash", "seconds": round(time.monotonic() - started, 3),
                       "failure": f"{type(error).__name__}: {error}", "traceback": traceback.format_exc()})
        atomic_json(result_path, output)
        audit.finish("crash", output["failure"])
        return 1


def load_result(cohort_dir, slot):
    path = Path(cohort_dir) / "slots" / slot["slot_id"] / "private" / "slot-result.json"
    return json.loads(path.read_text()) if path.exists() else None


def terminate(process):
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def acquire(cohort_id, wall_seconds=MAX_WALL_SECONDS):
    if wall_seconds > MAX_WALL_SECONDS:
        raise ValueError("The cohort hard wall cannot exceed 60 minutes")
    cohort_dir = EXPERIMENTS / cohort_id
    cohort_dir.mkdir(parents=True, exist_ok=False)
    manifest = build_manifest(cohort_id, wall_seconds)
    manifest_path = cohort_dir / "cohort.json"
    # The complete 12-slot denominator is durable before the first child (and first model call) starts.
    atomic_json(manifest_path, manifest)
    started = time.monotonic()
    pending = list(range(len(manifest["slots"])))
    running = {}
    interrupted = False
    try:
        while pending or running:
            elapsed = time.monotonic() - started
            if elapsed >= wall_seconds:
                break
            while pending and len(running) < MAX_PARALLEL:
                index = pending.pop(0)
                slot = manifest["slots"][index]
                slot_dir = cohort_dir / "slots" / slot["slot_id"]
                slot_dir.mkdir(parents=True, exist_ok=True)
                slot_path = slot_dir / "slot.json"
                atomic_json(slot_path, slot)
                stdout = open(slot_dir / "worker.log", "w", encoding="utf-8")
                process = subprocess.Popen([sys.executable, __file__, "--worker", str(cohort_dir), str(slot_path)],
                                           cwd=ROOT, stdout=stdout, stderr=subprocess.STDOUT)
                slot.update({"status": "running", "started_at": provenance.utc_now(), "worker_pid": process.pid})
                running[index] = {"process": process, "started": time.monotonic(), "stdout": stdout}
                atomic_json(manifest_path, manifest)
            time.sleep(1)
            for index, state in list(running.items()):
                process = state["process"]
                slot = manifest["slots"][index]
                exceeded = time.monotonic() - state["started"] >= slot["per_slot_wall_seconds"]
                if process.poll() is None and not exceeded:
                    continue
                if exceeded and process.poll() is None:
                    terminate(process)
                    result = {"slot_id": slot["slot_id"], "outcome": "timeout",
                              "seconds": round(time.monotonic() - state["started"], 3),
                              "failure": "per-slot wall-clock budget reached"}
                    atomic_json(Path(cohort_dir) / "slots" / slot["slot_id"] / "private" / "slot-result.json", result)
                    provenance.mark_manifest_unfinished(Path(cohort_dir) / "slots" / slot["slot_id"] / "manifest.json", "per-slot-timeout")
                else:
                    result = load_result(cohort_dir, slot) or {
                        "slot_id": slot["slot_id"], "outcome": "crash",
                        "seconds": round(time.monotonic() - state["started"], 3),
                        "failure": f"worker exited {process.returncode} without a result",
                    }
                state["stdout"].close()
                slot.update({"status": "terminal", "finished_at": provenance.utc_now(),
                             "outcome": result["outcome"], "result_sha256": sha(result)})
                running.pop(index)
                atomic_json(manifest_path, manifest)
    except KeyboardInterrupt:
        interrupted = True
    finally:
        reason = "operator-cancelled" if interrupted else "cohort-wall-clock-bound"
        for index, state in list(running.items()):
            terminate(state["process"])
            state["stdout"].close()
            slot = manifest["slots"][index]
            result = {"slot_id": slot["slot_id"], "outcome": "cancelled" if interrupted else "unfinished",
                      "seconds": round(time.monotonic() - state["started"], 3), "failure": reason}
            atomic_json(cohort_dir / "slots" / slot["slot_id"] / "private" / "slot-result.json", result)
            provenance.mark_manifest_unfinished(cohort_dir / "slots" / slot["slot_id"] / "manifest.json", reason)
            slot.update({"status": "terminal", "finished_at": provenance.utc_now(), "outcome": result["outcome"],
                         "result_sha256": sha(result)})
        for index in pending:
            slot = manifest["slots"][index]
            result = {"slot_id": slot["slot_id"], "outcome": "cancelled" if interrupted else "unfinished",
                      "seconds": 0, "failure": reason + " before scheduling"}
            atomic_json(cohort_dir / "slots" / slot["slot_id"] / "private" / "slot-result.json", result)
            slot.update({"status": "terminal", "finished_at": provenance.utc_now(), "outcome": result["outcome"],
                         "result_sha256": sha(result)})
        manifest.update({"status": "cancelled" if interrupted else "complete", "finished_at": provenance.utc_now(),
                         "wall_seconds": round(time.monotonic() - started, 3),
                         "repository_at_finish": repository_provenance()})
        atomic_json(manifest_path, manifest)
    write_evidence(cohort_dir)
    return cohort_dir


def normalized_projection(evidence):
    value = copy.deepcopy(evidence)
    value.pop("generated_at", None)
    value.pop("normalized_sha256", None)
    value.get("cohort", {}).pop("started_at", None)
    value.get("cohort", {}).pop("finished_at", None)
    value.get("cohort", {}).pop("wall_seconds", None)
    provenance_row = value.get("provenance", {})
    provenance_row.pop("cohort_manifest_sha256", None)
    provenance_row.pop("private_cohort_directory", None)
    for slot in value.get("slots", []):
        slot.pop("seconds", None)
        slot.pop("bedrock_request_ids", None)
        slot.pop("audit_manifest_sha256", None)
        slot.pop("audit_semantic_sha256", None)
    return value


def compact_slot(cohort_dir, slot):
    result = load_result(cohort_dir, slot) or {"outcome": slot.get("outcome") or "unfinished"}
    audit_path = Path(cohort_dir) / "slots" / slot["slot_id"] / "manifest.json"
    audit = json.loads(audit_path.read_text()) if audit_path.exists() else {"requests": [], "usage": {}}
    requests = audit.get("requests", [])
    statuses = collections.Counter(request.get("status") for request in requests)
    return {
        "slot_id": slot["slot_id"],
        "ordinal": slot["ordinal"],
        "requested_level": slot["requested_level"],
        "requested_difficulty_profile": slot["requested_difficulty_profile"],
        "draw_seed": slot["draw_seed"],
        "premise_sha256": slot["premise_sha256"],
        "outcome": result.get("outcome", "unfinished"),
        "failure_stage": result.get("failure_stage"),
        "failure": result.get("failure"),
        "seconds": result.get("seconds", 0),
        "achieved_difficulty": result.get("achieved_difficulty"),
        "requested_target_deficits": result.get("requested_target_deficits"),
        "usage": audit.get("usage", {}),
        "legacy_usage": audit.get("legacy_usage", {}),
        "request_count": len(requests),
        "request_statuses": dict(sorted(statuses.items())),
        "bedrock_request_ids": [r["bedrock_request_id"] for r in requests if r.get("bedrock_request_id")],
        "effective_serving_models": sorted({r.get("effective_serving_model", "unknown") for r in requests}),
        "generation_certificate": result.get("generation_certificate"),
        "pre_publication_certificate": result.get("pre_publication_certificate"),
        "post_serialization_certificate": result.get("post_serialization_certificate"),
        "case_sha256": result.get("case_sha256"),
        "audit_manifest_sha256": sha(audit_path.read_bytes()) if audit_path.exists() else None,
        "audit_semantic_sha256": audit.get("semantic_sha256"),
    }


def write_evidence(cohort_dir):
    cohort_dir = Path(cohort_dir).resolve()
    manifest = json.loads((cohort_dir / "cohort.json").read_text())
    rows = [compact_slot(cohort_dir, slot) for slot in manifest["slots"]]
    outcomes = collections.Counter(row["outcome"] for row in rows)
    aggregate_usage = collections.Counter()
    request_statuses = collections.Counter()
    provider_http_statuses = collections.Counter()
    semantic_repairs = collections.Counter()
    usage_by_profile = collections.defaultdict(collections.Counter)
    sdk_retry_attempts = 0
    level_outcomes = {}
    for row in rows:
        level = row["requested_level"]
        level_row = level_outcomes.setdefault(level, {"attempted": 0, "completed_strictly_gateable": 0,
                                                      "other_outcomes": {}, "achieved_levels": {}})
        level_row["attempted"] += 1
        if row["outcome"] == "completed-strictly-gateable":
            level_row["completed_strictly_gateable"] += 1
        else:
            level_row["other_outcomes"][row["outcome"]] = level_row["other_outcomes"].get(row["outcome"], 0) + 1
        achieved = (row.get("achieved_difficulty") or {}).get("level")
        if achieved:
            level_row["achieved_levels"][achieved] = level_row["achieved_levels"].get(achieved, 0) + 1
        for key, value in row["usage"].items():
            if isinstance(value, (int, float)):
                aggregate_usage[key] += value
        audit_path = cohort_dir / "slots" / row["slot_id"] / "manifest.json"
        if not audit_path.exists():
            continue
        for request in json.loads(audit_path.read_text()).get("requests", []):
            request_statuses[request.get("status", "missing")] += 1
            sdk_retry_attempts += request.get("sdk_retry_aggregate", 0) or 0
            for attempt in request.get("provider_attempts", []):
                provider_http_statuses[str(attempt.get("http_status"))] += 1
            for repair in request.get("semantic_repairs", []):
                semantic_repairs[repair.get("kind", "unknown")] += 1
            usage = request.get("usage") or {}
            profile = request.get("requested_inference_profile", "unknown")
            if usage:
                usage_by_profile[profile]["calls"] += 1
            for key, value in usage.items():
                if isinstance(value, (int, float)):
                    usage_by_profile[profile][key] += value
    evidence = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": provenance.utc_now(),
        "cohort": {key: manifest.get(key) for key in ("cohort_id", "started_at", "finished_at", "wall_seconds", "status", "design")},
        "provenance": {"start": manifest["repository_at_start"], "finish": manifest.get("repository_at_finish"),
                       "environment": manifest["environment"], "cohort_manifest_sha256": sha((cohort_dir / "cohort.json").read_bytes()),
                       "private_cohort_directory": str(cohort_dir.relative_to(ROOT))},
        "denominator": {"predeclared_slots": 12, "retained_slots": len(rows), "outcomes": dict(sorted(outcomes.items())),
                        "by_requested_level": level_outcomes},
        "aggregate_usage": dict(sorted(aggregate_usage.items())),
        "usage_by_requested_inference_profile": {key: dict(sorted(value.items())) for key, value in sorted(usage_by_profile.items())},
        "request_lifecycle": {"scheduled_requests": sum(request_statuses.values()),
                              "terminal_statuses": dict(sorted(request_statuses.items())),
                              "unfinished": request_statuses.get("unfinished", 0)},
        "retry_taxonomy": {"sdk_retry_attempts": sdk_retry_attempts,
                           "semantic_repairs": dict(sorted(semantic_repairs.items())),
                           "provider_attempt_http_statuses": dict(sorted(provider_http_statuses.items()))},
        "slots": rows,
        "claims_boundary": [
            "This is a prospective bounded generation pilot, not a publication set; no case or manifest was made playable.",
            "Dirty-worktree evidence is preliminary/non-archival.",
            "Unfinished slots remain in the denominator.",
        ],
    }
    evidence["normalized_sha256"] = sha(normalized_projection(evidence))
    RESULTS.mkdir(parents=True, exist_ok=True)
    atomic_json(RESULTS / "generation_cohort_pilot.json", evidence)
    lines = [
        "# C3/E2 bounded generation cohort pilot", "",
        f"Cohort `{manifest['cohort_id']}` predeclared **12** slots (4 easy, 4 medium, 4 hard) before the first call. "
        f"All {len(rows)} remain in the denominator. The run used at most {MAX_PARALLEL} workers and a {manifest['design']['hard_wall_seconds']}-second hard cohort bound.", "",
        f"Repository status: **{manifest['repository_at_start']['archival_status']}**; tracked diff `{manifest['repository_at_start']['tracked_diff_sha256']}`; untracked content `{manifest['repository_at_start']['untracked_content_sha256']}`.", "",
        "## Outcomes", "", "| Outcome | Slots |", "|---|---:|",
        *[f"| {key} | {value} |" for key, value in sorted(outcomes.items())], "",
        "## Slot results", "", "| Slot | Requested | Outcome | Achieved | Seconds | Calls | Input tokens | Output tokens |", "|---|---|---|---|---:|---:|---:|---:|",
    ]
    for row in rows:
        achieved = (row.get("achieved_difficulty") or {}).get("level", "—")
        usage = row["usage"]
        lines.append(f"| {row['slot_id']} | {row['requested_level']} | {row['outcome']} | {achieved} | {row['seconds']} | {usage.get('calls', 0)} | {usage.get('inputTokens', 0)} | {usage.get('outputTokens', 0)} |")
    lines.extend(["", "## Usage and interpretation", "",
                  f"Complete recorded usage: `{canonical(dict(sorted(aggregate_usage.items())))}`.", "",
                  f"All {sum(request_statuses.values())} scheduled requests reached a recorded terminal state: `{canonical(dict(sorted(request_statuses.items())))}`. "
                  f"SDK retry attempts: {sdk_retry_attempts}; semantic repairs: `{canonical(dict(sorted(semantic_repairs.items())))}`; "
                  f"provider-attempt HTTP statuses: `{canonical(dict(sorted(provider_http_statuses.items())))}`.", "",
                  f"Usage by requested inference profile: `{canonical({key: dict(sorted(value.items())) for key, value in sorted(usage_by_profile.items())})}`.", "",
                  "Every request has a private lifecycle ledger, prompt/schema hashes and blobs, exact inference configuration including omitted defaults, provider request/HTTP/retry metadata, stop reason, complete usage, response hashes, parse result, and candidate/critic/selection fields when applicable. SDK retries and semantic repairs are separate.", "",
                  "No replacement, deletion, manual inclusion, playable publication, or premise-history update occurred. Unfinished and censored outcomes are retained. This pilot measures acquisition outcomes only; it does not establish end-to-end mystery quality.", "",
                  f"Timing-independent normalized SHA-256: `{evidence['normalized_sha256']}`", ""])
    (RESULTS / "generation_cohort_pilot.md").write_text("\n".join(lines))
    return evidence


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cohort-id")
    parser.add_argument("--wall-seconds", type=int, default=MAX_WALL_SECONDS)
    parser.add_argument("--worker", nargs=2, metavar=("COHORT_DIR", "SLOT_JSON"))
    parser.add_argument("--summarize", type=Path)
    args = parser.parse_args()
    if args.worker:
        cohort_dir, slot_path = args.worker
        raise SystemExit(worker(cohort_dir, json.loads(Path(slot_path).read_text())))
    if args.summarize:
        write_evidence(args.summarize)
        return
    cohort_id = args.cohort_id or "c3-e2-" + dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    directory = acquire(cohort_id, args.wall_seconds)
    print(directory)


if __name__ == "__main__":
    main()
