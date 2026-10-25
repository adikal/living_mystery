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

    def test_trait_facts_are_held_back_behind_the_clue_that_tests_them(self):
        # every suspect's trait made public, beside a culprit clue that tests it
        culprit = next(h for h in self.case['question']['candidates'] if h['id'] == self.case['question']['truth'])['facts']['actor']
        actors = [h['facts']['actor'] for h in self.case['question']['candidates']]
        clue = next(x for x in self.case['signs'] if x.get('kind') not in ('public', 'testimony') and (x.get('requires') or []) and not x.get('claim'))
        clue['claim'] = {'pred': 'culpritTrait', 'trait': 'gait', 'value': 'limping'}
        for p in self.case['people']:
            if p['id'] in actors:
                p.setdefault('traits', {})['gait'] = 'limping' if p['id'] == culprit else 'steady'
                self.case['signs'].append({'id': f"pub_trait_{p['id']}_gait", 'kind': 'public', 'title': 't', 'text': 't',
                                           'claim': {'pred': 'hasTrait', 'person': p['id'], 'trait': 'gait', 'value': p['traits']['gait']}})
        held = publish.held_back_public(self.case)
        for p in self.case['people']:
            if p['id'] in actors:
                self.assertEqual(held.get(f"pub_trait_{p['id']}_gait"), [clue['id']])

    def test_trait_wording_reads_naturally(self):
        self.assertEqual(migrate.trait_wording('Vera Lacey', 'foot', 'small'), ("Vera Lacey's feet", 'Vera Lacey has small feet.'))
        self.assertEqual(migrate.trait_wording('Jonah Reed', 'handed', 'left'), ("Jonah Reed's hand", 'Jonah Reed is left-handed.'))
        self.assertEqual(migrate.trait_wording('Clara Vale', 'shoe', 'small'), ("Clara Vale's shoes", 'Clara Vale wears small shoes.'))

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
