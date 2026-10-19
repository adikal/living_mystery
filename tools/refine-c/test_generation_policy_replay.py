"""Hermetic E3 policy replay tests; no model or network calls."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools" / "paper-evidence" / "generation_policy_replay.py"
spec = importlib.util.spec_from_file_location("generation_policy_replay", SCRIPT)
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)


class PolicyReplay(unittest.TestCase):
    def test_identical_pool_acceptance_transitions_and_determinism(self):
        with tempfile.TemporaryDirectory() as root:
            cohort = Path(root)
            slots = [{"slot_id": "slot-01-easy"}]
            (cohort / "cohort.json").write_text(json.dumps({"cohort_id": "cohort", "slots": slots}))
            slot_dir = cohort / "slots" / "slot-01-easy"
            slot_dir.mkdir(parents=True)
            requests = [
                {"logical_request_id": "r1", "status": "response", "semantic": {"purpose": "seed-generation", "phase": "seed", "round": 1, "candidate": 1},
                 "parse_result": {"ok": True, "object": True}, "candidate_hash": "a", "code_verdict": "PASS", "selection": "selected"},
                {"logical_request_id": "r2", "status": "response", "semantic": {"purpose": "refinement-candidate", "phase": "refinement", "step": 1, "round": 1, "candidate": "1.1.1"},
                 "parse_result": {"ok": True, "object": True}, "candidate_hash": "b", "code_verdict": "PASS", "typed_critic_outcome": "FAIL", "selection": "not-selected"},
                {"logical_request_id": "r3", "status": "response", "semantic": {"purpose": "refinement-candidate", "phase": "refinement", "step": 1, "round": 1, "candidate": "1.1.2"},
                 "parse_result": {"ok": True, "object": True}, "candidate_hash": "c", "code_verdict": "PASS", "typed_critic_outcome": "PASS", "selection": "selected"},
                {"logical_request_id": "r4", "status": "error", "semantic": {"purpose": "refinement-candidate", "phase": "refinement", "step": 2, "round": 1, "candidate": "2.1.1"},
                 "parse_result": {"ok": False}, "code_verdict": "FAIL", "selection": "not-selected"},
            ]
            (slot_dir / "manifest.json").write_text(json.dumps({"requests": requests}))
            first = replay.build(cohort)
            second = replay.build(cohort)
            self.assertEqual(replay.normalized(first), replay.normalized(second))
            self.assertEqual(first["denominator"]["retained_candidates"], 4)
            self.assertEqual(first["policy_counts"]["structurally_parseable_llm_only"],
                             {"accepted": 3, "rejected": 1, "not_evaluable": 0})
            self.assertEqual(first["policy_counts"]["deterministic_code_kernel_refinement"],
                             {"accepted": 3, "rejected": 1, "not_evaluable": 0})
            self.assertEqual(first["policy_counts"]["full_kernel_typed_model_critic"],
                             {"accepted": 1, "rejected": 2, "not_evaluable": 1})
            self.assertEqual(first["transition_counts"], {"0->0->0": 1, "1->1->-": 1, "1->1->0": 1, "1->1->1": 1})


if __name__ == "__main__":
    unittest.main()
