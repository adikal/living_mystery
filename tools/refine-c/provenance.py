"""Thread-safe, per-run provenance for generation experiments.

Raw prompts and provider responses live only below the ignored experiment run root.  The
public paper-evidence reports consume compact hashes and terminal outcomes from these manifests.
"""
from __future__ import annotations

import contextlib
import contextvars
import copy
import datetime as dt
import hashlib
import json
import os
import platform
import sys
import tempfile
import threading
import time
from pathlib import Path

SCHEMA_VERSION = "c3-generation-provenance-v1"
REGION = "us-west-2"
_ACTIVE = contextvars.ContextVar("generation_audit", default=None)
_SEMANTIC = contextvars.ContextVar("generation_semantic_context", default={})


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def sha256(value):
    if not isinstance(value, bytes):
        value = value.encode("utf-8") if isinstance(value, str) else _canonical(value).encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def exact_inference_config(max_tokens):
    return {
        "maxTokens": max_tokens,
        "temperature": {"state": "omitted/provider-default"},
        "topP": {"state": "omitted/provider-default"},
        "stopSequences": {"state": "omitted/provider-default"},
    }


def current_audit():
    return _ACTIVE.get()


def semantic_context():
    return dict(_SEMANTIC.get() or {})


@contextlib.contextmanager
def activate(audit, **semantic):
    token_a = _ACTIVE.set(audit)
    token_s = _SEMANTIC.set({**semantic_context(), **semantic})
    try:
        yield audit
    finally:
        _SEMANTIC.reset(token_s)
        _ACTIVE.reset(token_a)


@contextlib.contextmanager
def semantics(**values):
    token = _SEMANTIC.set({**semantic_context(), **values})
    try:
        yield
    finally:
        _SEMANTIC.reset(token)


def submit_with_context(executor, fn, *args, **kwargs):
    context = contextvars.copy_context()
    return executor.submit(context.run, fn, *args, **kwargs)


class RunAudit:
    """A lock-protected request ledger persisted atomically after every transition."""

    def __init__(self, run_dir, run_id, parent_operation, metadata=None, clock=time.monotonic, wall_clock=utc_now):
        self.run_dir = Path(run_dir)
        self.private_dir = self.run_dir / "private"
        self.blob_dir = self.private_dir / "blobs"
        self.manifest_path = self.run_dir / "manifest.json"
        self.blob_dir.mkdir(parents=True, exist_ok=True)
        self.run_id = run_id
        self.clock = clock
        self.wall_clock = wall_clock
        self._started_mono = clock()
        self._lock = threading.RLock()
        self._sequence = 0
        self._requests = {}
        self._request_started = {}
        self._manifest = {
            "schema_version": SCHEMA_VERSION,
            "run": {
                "run_id": run_id,
                "parent_operation": parent_operation,
                "started_at": wall_clock(),
                "status": "running",
                **copy.deepcopy(metadata or {}),
            },
            "requests": [],
            "usage": {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0, "calls": 0},
            "legacy_usage": {"in": 0, "out": 0, "calls": 0},
        }
        self._write_locked()

    def _event(self, name, **extra):
        return {"event": name, "at": self.wall_clock(), **extra}

    def _blob(self, kind, value, suffix="json"):
        raw = value if isinstance(value, bytes) else (
            value.encode("utf-8") if isinstance(value, str) else _canonical(value).encode("utf-8")
        )
        digest = sha256(raw)
        path = self.blob_dir / f"{kind}-{digest}.{suffix}"
        if not path.exists():
            path.write_bytes(raw)
        return {"sha256": digest, "path": path.relative_to(self.run_dir).as_posix(), "bytes": len(raw)}

    def _write_locked(self):
        self._manifest["requests"] = [copy.deepcopy(self._requests[key]) for key in sorted(self._requests)]
        semantic = copy.deepcopy(self._manifest)
        semantic["run"].pop("started_at", None)
        semantic["run"].pop("finished_at", None)
        semantic["run"].pop("wall_latency_seconds", None)
        for request in semantic["requests"]:
            request.pop("scheduled_at", None)
            request.pop("started_at", None)
            request.pop("finished_at", None)
            request.pop("wall_latency_seconds", None)
            for event in request.get("lifecycle", []):
                event.pop("at", None)
        semantic.pop("semantic_sha256", None)
        self._manifest["semantic_sha256"] = sha256(semantic)
        self.run_dir.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix="manifest-", suffix=".json", dir=self.run_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(self._manifest, handle, ensure_ascii=False, indent=2, sort_keys=True)
                handle.write("\n")
            os.replace(name, self.manifest_path)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def schedule(self, system, user, schema, model, max_tokens, metadata=None):
        with self._lock:
            self._sequence += 1
            request_id = f"{self.run_id}-r{self._sequence:04d}"
            context = {**semantic_context(), **(metadata or {})}
            now = self.wall_clock()
            self._requests[request_id] = {
                "logical_request_id": request_id,
                "run_id": self.run_id,
                "parent_operation": context.pop("parent_operation", self._manifest["run"]["parent_operation"]),
                "semantic": context,
                "requested_inference_profile": model,
                "requested_model": model,
                "effective_serving_model": "unknown",
                "region": REGION,
                "prompt": {
                    "system": self._blob("system-prompt", system, "txt"),
                    "user": self._blob("user-prompt", user, "txt"),
                    "combined_sha256": sha256(system + "\0" + user),
                },
                "schema": self._blob("schema", schema or {"type": "object", "additionalProperties": True}),
                "inference_config": exact_inference_config(max_tokens),
                "scheduled_at": now,
                "status": "scheduled",
                "lifecycle": [self._event("scheduled")],
                "provider_attempts": [],
                "semantic_repairs": [],
            }
            self._write_locked()
            return request_id

    def start(self, request_id):
        with self._lock:
            row = self._requests[request_id]
            if row["status"] == "cancelled-before-start":
                return False
            row["status"] = "started"
            row["started_at"] = self.wall_clock()
            self._request_started[request_id] = self.clock()
            row["lifecycle"].append(self._event("started"))
            self._write_locked()
            return True

    def provider_attempt(self, request_id, response=None, error=None, semantic_repair=None):
        with self._lock:
            row = self._requests[request_id]
            metadata = response.get("ResponseMetadata", {}) if isinstance(response, dict) else {}
            attempt = {
                "ordinal": len(row["provider_attempts"]) + 1,
                "bedrock_request_id": metadata.get("RequestId"),
                "http_status": metadata.get("HTTPStatusCode"),
                "sdk_retry_metadata": {"retry_attempts": metadata.get("RetryAttempts", 0)},
            }
            if error is not None:
                attempt["error"] = {"type": type(error).__name__, "message": str(error)[:1000]}
                error_response = getattr(error, "response", None)
                if isinstance(error_response, dict):
                    em = error_response.get("ResponseMetadata", {})
                    attempt.update({
                        "bedrock_request_id": em.get("RequestId"),
                        "http_status": em.get("HTTPStatusCode"),
                        "sdk_retry_metadata": {"retry_attempts": em.get("RetryAttempts", 0)},
                        "provider_error_code": (error_response.get("Error") or {}).get("Code"),
                    })
            row["provider_attempts"].append(attempt)
            if semantic_repair:
                repair = {"kind": semantic_repair, "after_provider_attempt": attempt["ordinal"]}
                row["semantic_repairs"].append(repair)
            self._write_locked()
            return attempt

    def response(self, request_id, response, raw_response, parsed_response, parse_result):
        with self._lock:
            row = self._requests[request_id]
            metadata = response.get("ResponseMetadata", {}) if isinstance(response, dict) else {}
            usage = copy.deepcopy(response.get("usage", {})) if isinstance(response, dict) else {}
            metrics = copy.deepcopy(response.get("metrics", {})) if isinstance(response, dict) else {}
            row.update({
                "bedrock_request_id": metadata.get("RequestId"),
                "http_status": metadata.get("HTTPStatusCode"),
                "sdk_retry_aggregate": sum((a.get("sdk_retry_metadata") or {}).get("retry_attempts", 0) or 0 for a in row["provider_attempts"]),
                "stop_reason": response.get("stopReason") if isinstance(response, dict) else None,
                "usage": usage,
                "provider_metrics": metrics,
                "raw_response": self._blob("raw-response", raw_response),
                "parsed_response": self._blob("parsed-response", parsed_response) if parsed_response is not None else None,
                "parse_result": copy.deepcopy(parse_result),
                "finished_at": self.wall_clock(),
                "wall_latency_seconds": round(self.clock() - self._request_started.pop(request_id, self.clock()), 6),
            })
            if isinstance(response, dict):
                stated_model = response.get("modelId") or metadata.get("ModelId")
                if stated_model:
                    row["effective_serving_model"] = stated_model
            cancelled = any(event["event"] == "cancel-requested" for event in row["lifecycle"])
            row["lifecycle"].append(self._event("response"))
            row["status"] = "completed-after-cancel" if cancelled else "response"
            if cancelled:
                row["lifecycle"].append(self._event("completed-after-cancel"))
            self._accumulate_usage(usage)
            self._write_locked()

    def error(self, request_id, error):
        with self._lock:
            row = self._requests[request_id]
            response = getattr(error, "response", None)
            metadata = response.get("ResponseMetadata", {}) if isinstance(response, dict) else {}
            row.update({
                "status": "error",
                "error": {
                    "type": type(error).__name__,
                    "message": str(error)[:2000],
                    "provider_code": ((response.get("Error") or {}).get("Code") if isinstance(response, dict) else None),
                },
                "bedrock_request_id": metadata.get("RequestId"),
                "http_status": metadata.get("HTTPStatusCode"),
                "sdk_retry_aggregate": sum((a.get("sdk_retry_metadata") or {}).get("retry_attempts", 0) or 0 for a in row["provider_attempts"]),
                "finished_at": self.wall_clock(),
                "wall_latency_seconds": round(self.clock() - self._request_started.pop(request_id, self.clock()), 6),
            })
            row["lifecycle"].append(self._event("error"))
            self._write_locked()

    def cancel_requested(self, request_id):
        with self._lock:
            row = self._requests.get(request_id)
            if row and row["status"] not in ("response", "error", "completed-after-cancel", "cancelled-before-start"):
                row["lifecycle"].append(self._event("cancel-requested"))
                self._write_locked()

    def cancelled_before_start(self, request_id):
        with self._lock:
            row = self._requests.get(request_id)
            if row and row["status"] == "scheduled":
                row["status"] = "cancelled-before-start"
                row["finished_at"] = self.wall_clock()
                row["lifecycle"].extend([self._event("cancel-requested"), self._event("cancelled-before-start")])
                self._write_locked()

    def annotate(self, request_id, **fields):
        with self._lock:
            if request_id in self._requests:
                self._requests[request_id].update(copy.deepcopy(fields))
                self._write_locked()

    def _accumulate_usage(self, usage):
        totals = self._manifest["usage"]
        totals["calls"] += 1
        for key, value in usage.items():
            if isinstance(value, (int, float)):
                totals[key] = totals.get(key, 0) + value
        totals["inputTokens"] = totals.get("inputTokens", 0)
        totals["outputTokens"] = totals.get("outputTokens", 0)
        if "totalTokens" not in usage:
            totals["totalTokens"] = totals["inputTokens"] + totals["outputTokens"]
        self._manifest["legacy_usage"] = {"in": totals["inputTokens"], "out": totals["outputTokens"], "calls": totals["calls"]}

    def finish(self, status, stop_reason=None, **fields):
        with self._lock:
            now = self.wall_clock()
            for row in self._requests.values():
                if row["status"] in ("scheduled", "started"):
                    row["status"] = "unfinished"
                    row["finished_at"] = now
                    row["lifecycle"].append(self._event("unfinished"))
            self._manifest["run"].update({
                "status": status,
                "stop_reason": stop_reason,
                "finished_at": now,
                "wall_latency_seconds": round(self.clock() - self._started_mono, 6),
                **copy.deepcopy(fields),
            })
            self._write_locked()
            return copy.deepcopy(self._manifest)

    def snapshot(self):
        with self._lock:
            return copy.deepcopy(self._manifest)


def mark_manifest_unfinished(path, reason):
    """Parent-process repair for a worker terminated at a hard deadline."""
    path = Path(path)
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    now = utc_now()
    for request in data.get("requests", []):
        if request.get("status") in ("scheduled", "started"):
            request["status"] = "unfinished"
            request.setdefault("lifecycle", []).append({"event": "unfinished", "at": now, "reason": reason})
    data.setdefault("run", {}).update({"status": "unfinished", "stop_reason": reason, "finished_at": now})
    semantic = copy.deepcopy(data)
    semantic.pop("semantic_sha256", None)
    data["semantic_sha256"] = sha256(semantic)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    return data


def environment_metadata():
    try:
        import boto3
        import botocore
        versions = {"boto3": boto3.__version__, "botocore": botocore.__version__}
    except Exception:
        versions = {}
    return {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "machine": platform.machine(),
        "region": REGION,
        "aws_profile_name": os.environ.get("AWS_PROFILE"),
        **versions,
    }
