"""The doctor's stated time of death agrees with her own claim (regeneration, November 8)."""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import refine  # noqa: E402


def case(text, claim=(1220, 1290)):
    return {'setting': {'roles': {'examiner': 'iris'}, 'day': {'morning': 1800, 'start': 1920}},
            'people': [{'id': 'iris'}],
            'signs': [{'id': 's_doctor', 'kind': 'testimony', 'speaker': 'iris', 'text': text,
                       'claim': {'pred': 'crimeBetween', 'from': claim[0], 'to': claim[1]}}]}


class ClaimTimes(unittest.TestCase):
    def test_clock_phrases_are_read(self):
        self.assertEqual([m for _, m in refine.spoken_times("twenty past nine, a quarter to ten, eleven o'clock, 9.30, midnight")],
                         [560, 585, 660, 570, 0])

    def test_a_stated_span_outside_her_claim_is_an_error(self):
        self.assertTrue(refine.claim_time_errors(case('By the stiffening she died between twenty past nine and a quarter to ten.')))

    def test_a_span_inside_her_claim_and_what_she_observed_are_fine(self):
        self.assertEqual(refine.claim_time_errors(case('She was still warm at a quarter to eleven. I put it between half past '
                                                       'eight and twenty past nine.')), [])

    def test_only_the_doctors_accounts_are_checked(self):
        c = case('Between twenty past ten and eleven, they say. Rot.')
        c['signs'][0]['speaker'] = 'hugo'
        self.assertEqual(refine.claim_time_errors(c), [])


if __name__ == '__main__':
    unittest.main()
