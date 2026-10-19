"""Hermetic C3/E2 provenance tests; no model or network calls."""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import generation_cohort
import provenance
import refine


class Clock:
    def __init__(self):
        self.value = 10.0
        self.wall_value = 0

    def mono(self):
        self.value += 0.25
        return self.value

    def wall(self):
        self.wall_value += 1
        return f"2026-01-01T00:00:{self.wall_value:02d}.000Z"


class FakeClient:
    def __init__(self, *results):
        self.results = list(results)

    def converse(self, **_kwargs):
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def reply(payload, request_id="request-1", retries=0):
    return {
        "usage": {"inputTokens": 7, "outputTokens": 3, "totalTokens": 10,
                  "cacheReadInputTokens": 2},
        "metrics": {"latencyMs": 42},
        "stopReason": "tool_use",
        "output": {"message": {"content": [{"toolUse": {"input": payload}}]}},
        "ResponseMetadata": {"RequestId": request_id, "HTTPStatusCode": 200, "RetryAttempts": retries},
    }


class ProvenanceLifecycle(unittest.TestCase):
    def make_audit(self, root, run_id="run-1"):
        clock = Clock()
        return provenance.RunAudit(root, run_id, "test", {"requested_level": "easy"},
                                   clock=clock.mono, wall_clock=clock.wall)

    def test_success_captures_usage_request_id_and_complete_lifecycle(self):
        with tempfile.TemporaryDirectory() as root:
            audit = self.make_audit(root)
            refine._client = FakeClient(reply({"ok": True}, "bedrock-1", retries=1))
            with provenance.activate(audit, parent_operation="generation", round=1, candidate="1.1"):
                response = refine.llm_json_audited("system", "user", 123, model="profile")
            manifest = audit.finish("done")
            request = manifest["requests"][0]
            self.assertEqual(response.logical_request_id, request["logical_request_id"])
            self.assertEqual(request["status"], "response")
            self.assertEqual([event["event"] for event in request["lifecycle"]], ["scheduled", "started", "response"])
            self.assertEqual(request["bedrock_request_id"], "bedrock-1")
            self.assertEqual(request["http_status"], 200)
            self.assertEqual(request["sdk_retry_aggregate"], 1)
            self.assertEqual(request["usage"]["cacheReadInputTokens"], 2)
            self.assertEqual(manifest["legacy_usage"], {"in": 7, "out": 3, "calls": 1})
            self.assertEqual(request["inference_config"]["temperature"]["state"], "omitted/provider-default")
            self.assertTrue((Path(root) / request["prompt"]["system"]["path"]).exists())

    def test_error_cancel_and_unfinished_states_are_terminalized(self):
        with tempfile.TemporaryDirectory() as root:
            audit = self.make_audit(root)
            scheduled = audit.schedule("s", "u", {}, "m", 1)
            cancelled = audit.schedule("s2", "u2", {}, "m", 1)
            audit.cancelled_before_start(cancelled)
            errored = audit.schedule("s3", "u3", {}, "m", 1)
            audit.start(errored)
            error = RuntimeError("provider down")
            audit.provider_attempt(errored, error=error)
            audit.error(errored, error)
            completed = audit.schedule("s4", "u4", {}, "m", 1)
            audit.start(completed)
            audit.cancel_requested(completed)
            response = reply({"ok": True})
            audit.provider_attempt(completed, response=response)
            audit.response(completed, response, response["output"], {"ok": True}, {"ok": True, "object": True})
            manifest = audit.finish("timeout")
            statuses = {row["logical_request_id"]: row["status"] for row in manifest["requests"]}
            self.assertEqual(statuses[scheduled], "unfinished")
            self.assertEqual(statuses[cancelled], "cancelled-before-start")
            self.assertEqual(statuses[errored], "error")
            self.assertEqual(statuses[completed], "completed-after-cancel")

    def test_semantic_tool_repair_is_separate_from_sdk_retry_metadata(self):
        with tempfile.TemporaryDirectory() as root:
            audit = self.make_audit(root)
            unsupported = RuntimeError("tool_choice is not supported")
            unsupported.response = {"ResponseMetadata": {"RequestId": "forced", "HTTPStatusCode": 400,
                                                           "RetryAttempts": 0}, "Error": {"Code": "ValidationException"}}
            refine._client = FakeClient(unsupported, reply({"ok": True}, "auto", retries=2))
            refine.FORCED_OK.clear()
            with provenance.activate(audit):
                refine.llm_json_audited("system", "user", model="profile")
            request = audit.finish("done")["requests"][0]
            self.assertEqual(request["semantic_repairs"], [{"kind": "forced-tool-choice-to-auto", "after_provider_attempt": 1}])
            self.assertEqual([a["sdk_retry_metadata"]["retry_attempts"] for a in request["provider_attempts"]], [0, 2])
            self.assertEqual(request["sdk_retry_aggregate"], 2)

    def test_semantic_hash_is_deterministic_for_identical_run(self):
        hashes = []
        for _ in range(2):
            with tempfile.TemporaryDirectory() as root:
                audit = self.make_audit(root, "same-run")
                request = audit.schedule("system", "user", {"type": "object"}, "profile", 50,
                                         {"purpose": "seed-generation", "round": 1})
                audit.start(request)
                response = reply({"case": 1}, "request-fixed")
                audit.provider_attempt(request, response=response)
                audit.response(request, response, response["output"], {"case": 1}, {"ok": True, "object": True})
                hashes.append(audit.finish("done")["semantic_sha256"])
        self.assertEqual(hashes[0], hashes[1])


class CohortDesign(unittest.TestCase):
    def test_predeclares_fixed_complete_denominator_without_replacement(self):
        first = generation_cohort.predeclare("cohort")
        second = generation_cohort.predeclare("cohort")
        self.assertEqual(first, second)
        self.assertEqual(len(first), 12)
        self.assertEqual({level: sum(slot["requested_level"] == level for slot in first)
                          for level in ("easy", "medium", "hard")}, {"easy": 4, "medium": 4, "hard": 4})
        self.assertEqual(len({slot["premise_sha256"] for slot in first}), 12)

    def test_invalid_prepublication_case_is_not_rated(self):
        with mock.patch.object(generation_cohort.difficulty, "rate", side_effect=AssertionError("must not rate")):
            achieved, deficits = generation_cohort.rate_if_gateable({}, {"ok": False}, {"level": "easy"})
        self.assertIsNone(achieved)
        self.assertIsNone(deficits)

    def test_compact_result_preserves_requested_vs_achieved_difficulty(self):
        with tempfile.TemporaryDirectory() as root:
            cohort = Path(root)
            slot = generation_cohort.predeclare("cohort")[0]
            private = cohort / "slots" / slot["slot_id"] / "private"
            private.mkdir(parents=True)
            (private / "slot-result.json").write_text(json.dumps({
                "outcome": "completed-strictly-gateable", "seconds": 12.5,
                "achieved_difficulty": {"level": "medium", "score": 5.0},
                "requested_target_deficits": ["rates medium, target hard"],
            }))
            manifest = cohort / "slots" / slot["slot_id"] / "manifest.json"
            manifest.parent.mkdir(parents=True, exist_ok=True)
            manifest.write_text(json.dumps({"requests": [], "usage": {}, "legacy_usage": {}, "semantic_sha256": "abc"}))
            row = generation_cohort.compact_slot(cohort, slot)
            self.assertEqual(row["requested_level"], "easy")
            self.assertEqual(row["achieved_difficulty"]["level"], "medium")
            self.assertIn("requested_target_deficits", row)


if __name__ == "__main__":
    unittest.main()
