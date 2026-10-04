"""Everyone in a case gets an evening: an ordinary event and its intention, kept only if the solve is unchanged."""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import premise  # noqa: E402
import publish  # noqa: E402
import refine  # noqa: E402

CASE = os.path.join(HERE, '..', '..', 'dist', 'cases', 'generated', 'mk-live-20261002-235614.json')


class Evenings(unittest.TestCase):
    def setUp(self):
        with open(CASE) as f:
            self.case = json.load(f)
        # as published before evenings were added: without them (and without their accounts)
        added = [e for e in self.case['events'] if e.get('ordinary')]
        self.case['events'] = [e for e in self.case['events'] if not e.get('ordinary')]
        self.case['attitudes'] = [a for a in self.case['attitudes'] if a['id'] not in {e['causedBy'] for e in added}]
        self.case['signs'] = [x for x in self.case['signs'] if not (x.get('surface') and x['speaker'] in {e['agent'] for e in added})]
        self.saved = refine.llm_json

    def tearDown(self):
        refine.llm_json = self.saved

    def test_people_without_an_evening_get_one_and_the_solve_is_unchanged(self):
        need = {m.split()[1] for m in premise.evening_errors(self.case)}
        self.assertTrue(need, 'this case has people with no evening')
        home = {p['id']: p['home'] for p in premise.SETTING['people']}
        refine.llm_json = lambda system, prompt, *a, **k: {'evenings': {
            i['id']: {'place': home[i['id']], 'summary': 'Spent a quiet evening at home.', 'intent': 'A quiet evening.'}
            for i in json.loads(prompt)['people']}}
        before = publish._solve_shape(self.case)
        n = publish.add_ordinary_evenings(self.case)
        self.assertGreater(n, 0)
        self.assertEqual(publish._solve_shape(self.case), before)
        left = {m.split()[1] for m in premise.evening_errors(self.case)}
        self.assertTrue(left < need, f'still without an evening: {left}')
        self.assertTrue(refine.certify(self.case, require_backing=True)['ok'])

    def test_an_evening_that_names_someone_else_is_refused(self):
        refine.llm_json = lambda system, prompt, *a, **k: {'evenings': {
            i['id']: {'place': 'inn', 'summary': 'Chatted with the innkeeper by the fire.', 'intent': 'Company.'}
            for i in json.loads(prompt)['people'] if i['id'] != 'ada'}}
        publish.add_ordinary_evenings(self.case)
        self.assertFalse(any('innkeeper' in e['summary'] for e in self.case['events'] if e.get('ordinary') and e['agent'] != 'ada'))

    def test_bad_proposals_are_ignored(self):
        refine.llm_json = lambda *a, **k: {'evenings': {i['id']: {'place': 'nowhere', 'summary': 'At 9 I left.', 'intent': ''}
                                                        for i in json.loads(a[1])['people']}}
        self.assertEqual(publish.add_ordinary_evenings(self.case), 0)


if __name__ == '__main__':
    unittest.main()
