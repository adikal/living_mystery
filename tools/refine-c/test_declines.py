"""Declines are in voice, state no fact: code drops digits and names; the model's no-fact verdicts drop the rest."""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import publish  # noqa: E402
import refine  # noqa: E402

CASE = os.path.join(HERE, '..', '..', 'dist', 'cases', 'archive', '2026-10', 'mk-live-20261002-235614.json')


class Declines(unittest.TestCase):
    def setUp(self):
        with open(CASE) as f:
            self.case = json.load(f)
        self.case.pop('declines', None)
        self.case.pop('declines_version', None)
        self.saved = refine.llm_json

    def tearDown(self):
        refine.llm_json = self.saved

    def test_code_and_model_checks(self):
        def fake(system, prompt, *a, **k):
            items = json.loads(prompt)
            if system == publish.DECLINES:
                return {'declines': {i['id']: ['Couldn\u2019t say.', 'Ask Mrs Finch.', 'At 9 I was out.', 'I was at home.'] for i in items}}
            return {'verdicts': {pid: [True, False][:len(lines)] + [False] * (len(lines) - 2) for pid, lines in items.items()}}
        refine.llm_json = fake
        n = publish.add_declines(self.case)
        self.assertGreater(n, 0)
        for pid, lines in self.case['declines'].items():
            self.assertEqual(lines, ['Couldn\u2019t say.'], 'a name and a digit are dropped by code; a fact by the model')


    def test_older_declines_are_rewritten(self):
        refine.llm_json = lambda system, prompt, *a, **k: ({'declines': {i['id']: ['Nothing I could tell you.'] for i in json.loads(prompt)}}
                                                         if system == publish.DECLINES else {'verdicts': {pid: [True] for pid in json.loads(prompt)}})
        self.case['declines'], self.case['declines_version'] = {'old': ["I'd rather not say."]}, 1
        publish.add_declines(self.case)
        self.assertNotIn('old', self.case['declines'])
        self.assertEqual(self.case['declines_version'], publish.DECLINES_VERSION)
        self.assertEqual(publish.add_declines(self.case), 0, 'current declines are kept')

if __name__ == '__main__':
    unittest.main()
