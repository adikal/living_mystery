"""An evening account never contradicts what its speaker also tells the detective: rewritten once, else dropped."""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import publish  # noqa: E402
import refine  # noqa: E402

CASE = os.path.join(HERE, '..', '..', 'dist', 'cases', 'generated', 'live', 'mk-live-20261003-133036.json')


class Surface(unittest.TestCase):
    def setUp(self):
        self.case = json.load(open(CASE))
        for x in self.case['signs']:
            x.pop('agrees_checked', None)
        self.case.pop('surface_dropped', None)
        self.liar = next(x['speaker'] for x in self.case['signs'] if x.get('surface') and publish.own_statements(self.case, x['speaker']))
        self.saved = refine.llm_json

    def tearDown(self):
        refine.llm_json = self.saved

    def run_with(self, writer, critic):
        seen = []
        def fake(system, prompt, *a, **k):
            items = json.loads(prompt)
            seen.append((system, items))
            if system == publish.AGREES:
                return {'verdicts': {i['id']: critic(i) for i in items}}
            return {'accounts': {i['id']: writer(i) for i in items}}
        refine.llm_json = fake
        return publish.add_surface_accounts(self.case), seen

    def test_a_contradicting_account_is_rewritten_with_the_reason(self):
        sid = f's_surface_{self.liar}'
        _, seen = self.run_with(lambda i: 'I kept to my room all evening.',
                                lambda i: {'agrees': i['account'].startswith('I kept'), 'why': 'says she went out'})
        x = next(x for x in self.case['signs'] if x['id'] == sid)
        self.assertEqual(x['text'], 'I kept to my room all evening.')
        self.assertTrue(x['agrees_checked'])
        writes = [items for system, items in seen if system == publish.SURFACE]
        asked = next(i for i in writes[0] if i['id'] == self.liar)
        self.assertEqual(asked['previous_attempt']['rejected_because'], 'says she went out')
        self.assertTrue(asked['tells'], 'the writer sees what they tell the detective')

    def test_one_that_never_agrees_is_dropped(self):
        self.run_with(lambda i: 'I walked by the river.', lambda i: {'agrees': False, 'why': 'different place'})
        self.assertFalse(any(x.get('surface') and x['speaker'] == self.liar for x in self.case['signs']))
        self.assertIn(self.liar, self.case['surface_dropped'])
        # and is not written again
        n, seen = self.run_with(lambda i: 'x', lambda i: {'agrees': True})
        self.assertFalse(any(i['id'] == self.liar for system, items in seen if system == publish.SURFACE for i in items))

    def test_accounts_that_agree_are_kept_and_not_checked_again(self):
        before = [x['text'] for x in self.case['signs'] if x.get('surface')]
        self.run_with(lambda i: 'x', lambda i: {'agrees': True})
        self.assertEqual([x['text'] for x in self.case['signs'] if x.get('surface')], before)
        _, seen = self.run_with(lambda i: 'x', lambda i: {'agrees': True})
        self.assertEqual(seen, [])


if __name__ == '__main__':
    unittest.main()
