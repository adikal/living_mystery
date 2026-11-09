"""Innocents cleared on evidence of their own, not only by the culprit's conviction: measured, targeted and enforced."""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import difficulty  # noqa: E402
import refine  # noqa: E402

GEN = os.path.join(HERE, '..', '..', 'dist', 'cases', 'generated')
HOUND = json.load(open(os.path.join(GEN, '..', 'archive', '2026-10', 'mk-live-20261025-114526.json')))   # off the menu: none cleared alone
POST_OFFICE = json.load(open(os.path.join(GEN, '..', 'archive', '2026-10', 'mk-live-20261002-225824.json')))


class OwnEvidence(unittest.TestCase):
    def test_the_iron_hound_clears_nobody_on_their_own_evidence(self):
        self.assertEqual(refine.cleared_alone(HOUND, refine.certify(HOUND, False)), [])

    def test_alibis_clear_innocents_without_the_case_against_the_culprit(self):
        self.assertEqual(refine.cleared_alone(POST_OFFICE, refine.certify(POST_OFFICE, False)), ['c_clara', 'c_hugo', 'c_rowan'])

    def test_a_medium_case_needs_two(self):
        need = difficulty.targets_met(HOUND, refine.certify(HOUND, False), difficulty.target('medium'))
        self.assertIn('0 innocents cleared on evidence of their own (< 2)', need)

    def test_the_scheduler_gives_an_innocent_their_own_evidence(self):
        rep = refine.certify(HOUND, False)
        hist = [{'mode': m, 'target': None, 'accepted': True, 'operator': 'Conceal'} for m in ('twist', 'herring', 'implicate')]
        profile = {**difficulty.target('medium'), 'herrings': [0, 0]}
        options = refine.schedule_options(HOUND, rep, 4, hist, 5, profile)
        self.assertEqual(options[0][0], 'clear')
        self.assertEqual({o[1] for o in options if o[0] == 'clear'}, {'ada', 'jonah', 'silas'})
        prompt = refine.step_prompt(HOUND, rep, options[0][1], 'clear', 'Fragment')
        self.assertIn('CLEAR STEP', prompt)

    def test_a_clear_step_that_clears_nobody_is_rejected(self):
        rep = refine.certify(HOUND, False)
        law = refine.step_laws(HOUND, rep, HOUND, rep, {'add': {'events': [{}]}}, 'clear', 'ada', 'ada', 5)
        self.assertTrue(any("still ruled out only by the evidence against the culprit" in x for x in law))


if __name__ == '__main__':
    unittest.main()
