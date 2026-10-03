"""add_art gives object clues a picture key from the library; code rejects keys that are not in it."""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import enrich  # noqa: E402
import refine  # noqa: E402


class Art(unittest.TestCase):
    def test_keys_are_checked(self):
        case = json.load(open(os.path.join(HERE, '..', '..', 'tests', 'fixtures', 'mk-rook.json')))
        for x in case['signs']:
            x.pop('art', None)
        objs = [x for x in case['signs'] if x['kind'] not in ('testimony', 'behavior')]
        fake = {objs[0]['id']: 'notes', objs[1]['id']: 'a dragon', objs[2]['id']: None}
        saved = refine.llm_json
        refine.llm_json = lambda *a, **k: {'art': fake}
        try:
            enrich.add_art(case)
        finally:
            refine.llm_json = saved
        self.assertEqual(objs[0]['art'], 'notes')
        self.assertIsNone(objs[1]['art'], 'an unknown key is no picture')
        self.assertIsNone(objs[2]['art'])
        self.assertNotIn('art', objs[3], 'clues the model did not answer are asked again next time')
        self.assertTrue(all('art' not in x for x in case['signs'] if x['kind'] in ('testimony', 'behavior')))
        self.assertIn('notes', {o['id'] for o in enrich.SETTING['objects']})


if __name__ == '__main__':
    unittest.main()
