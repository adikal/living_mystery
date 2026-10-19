from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "paper-evidence" / "export_representation_fidelity.py"
SPEC = importlib.util.spec_from_file_location("export_representation_fidelity", MODULE_PATH)
assert SPEC and SPEC.loader
EXPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORTER)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def forbidden_keys(value):
    forbidden = {
        "case_id",
        "episode_id",
        "step",
        "model",
        "arm",
        "verdict",
        "critic",
        "code_verdict",
        "model_verdict",
        "source_hashes",
        "deceptive",
        "truth",
        "accepted",
        "pass",
    }
    found = set()
    if isinstance(value, dict):
        found.update(forbidden.intersection(value))
        for child in value.values():
            found.update(forbidden_keys(child))
    elif isinstance(value, list):
        for child in value:
            found.update(forbidden_keys(child))
    return found


class RepresentationFidelityExportTest(unittest.TestCase):
    def run_export(self, directory: Path):
        report = EXPORTER.build_export(directory)
        files = {path.name: path for path in directory.iterdir() if path.is_file()}
        return report, files

    def test_export_is_deterministic_and_blinded(self):
        with tempfile.TemporaryDirectory() as first_name, tempfile.TemporaryDirectory() as second_name:
            first = Path(first_name)
            second = Path(second_name)
            report, first_files = self.run_export(first)
            _, second_files = self.run_export(second)

            self.assertEqual(set(first_files), set(second_files))
            for name in first_files:
                self.assertEqual(first_files[name].read_bytes(), second_files[name].read_bytes(), name)

            items = [json.loads(line) for line in first_files["representation_fidelity_items.jsonl"].read_text().splitlines()]
            key = json.loads(first_files["representation_fidelity_key.json"].read_text())
            self.assertEqual(report["export"]["items"], len(items))
            self.assertEqual(report["export"]["by_type"], {"case_record": 666, "generation_candidate": 14})
            self.assertEqual(len(items), 680)
            self.assertEqual(len(key["items"]), len(items))
            self.assertEqual([item["id"] for item in items], sorted(item["id"] for item in items))
            self.assertEqual(set(key["items"]), {item["id"] for item in items})
            self.assertTrue(all(re.fullmatch(r"RF-[0-9A-F]{20}", item["id"]) for item in items))
            self.assertEqual(set().union(*(forbidden_keys(item) for item in items)), set())
            self.assertTrue(all(item["candidate_prose"] for item in items))
            self.assertTrue(all(set(item["source"]) == {"record", "account", "links"} for item in items))

    def test_report_counts_hashes_and_codebook_are_self_consistent(self):
        with tempfile.TemporaryDirectory() as name:
            output = Path(name)
            report, files = self.run_export(output)
            population = report["population"]

            self.assertEqual(population["case_records"]["sign_records"], 666)
            self.assertEqual(population["case_records"]["excluded"], 0)
            self.assertEqual(population["generation_candidates"]["history_entries"], 573)
            self.assertEqual(population["generation_candidates"]["exported"], 14)
            self.assertEqual(population["dialogue_audits"]["candidate_attempts"], 1460)
            self.assertEqual(population["dialogue_audits"]["exported"], 0)
            self.assertEqual(population["playtest_traces"]["raw_episodes"], 223)
            self.assertEqual(population["playtest_traces"]["dialogue_steps"], 11798)
            self.assertEqual(population["playtest_traces"]["exported"], 0)

            for filename, expected in report["hashes"]["artifacts"].items():
                self.assertEqual(digest(files[filename]), expected)
            for relative_path, expected in report["hashes"]["evidence_source_files"].items():
                self.assertEqual(digest(ROOT / relative_path), expected)

            codebook = files["representation_fidelity_codebook.md"].read_text()
            required_terms = (
                "claim_fidelity",
                "requires_correspondence",
                "needs_correspondence",
                "defeats_correspondence",
                "claimless_unsupported_implication",
                "added_fact",
                "dropped_fact",
                "altered_fact",
                "private_disclosure",
                "naturalness_rating",
                "relevance_rating",
                "adjudicator",
            )
            for term in required_terms:
                self.assertIn(term, codebook)


if __name__ == "__main__":
    unittest.main()
