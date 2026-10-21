"""Public knowledge about who held the culprit's item is held back until a clue about the item is understood."""
import glob
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import migrate  # noqa: E402
import publish  # noqa: E402

CASE = os.path.join(HERE, '..', '..', 'dist', 'cases', 'generated', 'mk-live-20261002-235614.json')


class PublicKnowledge(unittest.TestCase):
    def setUp(self):
        with open(CASE) as handle:
            self.case = json.load(handle)
        self.public = next(x for x in self.case['signs'] if x.get('kind') == 'public' and (x.get('claim') or {}).get('pred') == 'onlyHad')

    def test_item_holder_fact_is_held_back_behind_its_clue(self):
        held = publish.held_back_public(self.case)
        self.assertIn(self.public['id'], held)
        self.assertTrue(all((next(x for x in self.case['signs'] if x['id'] == t).get('claim') or {}).get('item')
                            == self.public['claim']['item'] for t in held[self.public['id']]))
        self.assertEqual(publish.public_spoiler_errors(self.case), [])

    def test_a_holder_fact_that_decides_something_on_its_own_is_refused(self):
        # with the clue about the item made public too, the pair names the culprit from the start
        trigger = publish.held_back_public(self.case)[self.public['id']][0]
        sign = next(x for x in self.case['signs'] if x['id'] == trigger)
        sign.update(kind='public', requires=[], needs=[])
        self.assertTrue(any(self.public['id'] in e for e in publish.public_spoiler_errors(self.case)))

    def test_every_published_case_passes(self):
        files = glob.glob(os.path.join(HERE, '..', '..', 'dist', 'cases', 'generated', 'mk-*.json'))
        files += glob.glob(os.path.join(HERE, '..', '..', 'dist', 'cases', 'generated', 'live', 'mk-*.json'))
        for f in files:
            with open(f) as handle:
                self.assertEqual(publish.public_spoiler_errors(json.load(handle)), [], f)

    def test_holder_wording_reads_naturally(self):
        case = {'objects': [{'id': 'b', 'name': 'A coat button'}, {'id': 'r', 'name': "Hugo's boar signet ring"},
                            {'id': 'm', 'name': 'Rook & Lantern mug'}],
                'people': [{'id': 'vicar', 'name': 'The Reverend Thomas Hale'}], 'setting': {'places': []}}
        self.assertEqual(migrate.holder_wording(case, 'b', ['vicar']),
                         ('Who had the coat button', 'Everyone knows only the Reverend Thomas Hale had the coat button.'))
        self.assertEqual(migrate.holder_wording(case, 'r', [])[0], "Who had Hugo's boar signet ring")
        self.assertEqual(migrate.holder_wording(case, 'm', [])[0], 'Who had the Rook & Lantern mug')


if __name__ == '__main__':
    unittest.main()
