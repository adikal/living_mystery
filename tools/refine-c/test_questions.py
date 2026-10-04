"""Questions that reword a standard question (or each other) are marked same_as, never rewritten or dropped."""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import publish  # noqa: E402
import refine  # noqa: E402

CASE = os.path.join(HERE, '..', '..', 'dist', 'cases', 'generated', 'mk-live-20261002-224855.json')


class Questions(unittest.TestCase):
    def setUp(self):
        with open(CASE) as f:
            self.case = json.load(f)
        self.saved = refine.llm_json

    def tearDown(self):
        refine.llm_json = self.saved

    def test_rewordings_are_marked_with_what_they_reword(self):
        asks = [x for x in self.case['signs'] if x.get('ask') and x['kind'] == 'testimony'
                and not (x.get('surface') or x.get('morning') or x.get('sighting'))]
        a, b = asks[0], asks[1]
        seen = []
        def fake(system, prompt, *args, **kw):
            items = json.loads(prompt)
            seen.append(items)
            return {'duplicates': {a['speaker']: [['std0', a['id']]], b['speaker']: [[b['id'], 'nonsense-id']]}}
        refine.llm_json = fake
        n = publish.mark_duplicate_questions(self.case)
        self.assertEqual(n, 1, 'a group with an unknown id is not a group')
        self.assertEqual(a['same_as'], 'night')
        self.assertNotIn('same_as', b)
        self.assertEqual(a['ask'], next(x for x in asks if x['id'] == a['id'])['ask'], 'the question itself is kept')
        self.assertTrue(all(any(i['id'] == 'std0' for i in v) for v in seen[0].values()), 'standard questions are shown to the judge')

    def test_a_failed_check_marks_nothing(self):
        def boom(*a, **k):
            raise RuntimeError('model down')
        refine.llm_json = boom
        self.assertEqual(publish.mark_duplicate_questions(self.case), 0)


if __name__ == '__main__':
    unittest.main()
