"""Sightings are read from the true history, certified solve-neutral, and worded under code checks."""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import publish  # noqa: E402
import refine  # noqa: E402
import enrich  # noqa: E402

CASE = os.path.join(HERE, '..', '..', 'dist', 'cases', 'archive', '2026-10', 'mk-live-20261002-225824.json')


class Sightings(unittest.TestCase):
    def setUp(self):
        self.case = json.load(open(CASE))
        self.case['signs'] = [x for x in self.case['signs'] if not x.get('sighting')]

    def test_candidates_are_true_copresence(self):
        pres = refine.presence(self.case)
        for a, b, pl, lo, hi, ev in publish.sighting_candidates(self.case):
            self.assertTrue(any(p == pl and s <= lo and e >= hi for s, e, p, _ in pres[a]), (a, pl))
            self.assertTrue(any(p == pl and s < hi and e > lo for s, e, p, _ in pres[b]), (b, pl))
            self.assertNotEqual(ev, self.case['question']['crime']['event'])

    def test_kept_sightings_leave_the_solve_unchanged(self):
        before = publish._solve_shape(self.case)
        saved = refine.llm_json
        refine.llm_json = lambda system, prompt, *a, **k: ({'problems': {}} if system == enrich.REVIEW else
                                                          {'verdicts': {i['id']: True for i in json.loads(prompt)}} if system == publish.VISIBLE else
                                                          {'lines': {i['id']: f"I saw {i['saw']} there about ten." for i in json.loads(prompt)}})
        try:
            n = publish.add_sightings(self.case, log=lambda *a: None)
        finally:
            refine.llm_json = saved
        self.assertGreater(n, 0)
        self.assertEqual(publish._solve_shape(self.case), before)
        for x in [x for x in self.case['signs'] if x.get('sighting')]:
            self.assertIn(refine.account_backing(self.case, x), ('source', 'witnessed'))   # their own event at that place
            self.assertFalse(x['deceptive'])

    def test_wording_that_names_someone_else_is_dropped(self):
        saved = refine.llm_json
        names = [p['name'] for p in self.case['people']]
        refine.llm_json = lambda system, prompt, *a, **k: {'lines': {i['id']: f"I saw {names[0]} and {names[1]} and {names[2]}." for i in json.loads(prompt)}}
        try:
            publish.add_sightings(self.case, log=lambda *a: None)
        finally:
            refine.llm_json = saved
        for x in [x for x in self.case['signs'] if x.get('sighting')]:
            seen = next(p['name'] for p in self.case['people'] if p['id'] == x['claim']['person'])
            self.assertTrue(all(n == seen or n.split()[-1] not in x['text'] for n in names if n != seen))


if __name__ == '__main__':
    unittest.main()
