"""Publishing makes every visible contradiction a recorded one: a sighting that would break a lie is dropped; otherwise
the true account is recorded as defeating the false one. The Python kernel refuses an unrecorded one."""
import copy
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import publish  # noqa: E402
from refine import certify  # noqa: E402

CASE = os.path.join(HERE, '..', '..', 'dist', 'cases', 'generated', 'mk-live-20261002-222517.json')
# true from the history (Miss Pruett was home at the post office from 22:55), against her false accounts (the inn)
SEEN = {'id': 's_test_seen', 'kind': 'testimony', 'speaker': 'silas', 'title': 'x', 'text': '',
        'claim': {'pred': 'wasAt', 'person': 'dora', 'place': 'post', 'from': 1380, 'to': 1390}}


class Contradictions(unittest.TestCase):
    def setUp(self):
        with open(CASE) as f:
            self.case = json.load(f)

    def test_a_true_account_is_recorded_as_defeating_the_lie(self):
        c = copy.deepcopy(self.case)
        c['signs'].append(copy.deepcopy(SEEN))
        self.assertTrue(any('cannot all be true (the whereabouts of dora)' in e for e in certify(c)['errors']), certify(c)['errors'])
        self.assertGreater(publish.record_contradictions(c, log=lambda *a: None), 0)
        seen = next(x for x in c['signs'] if x['id'] == 's_test_seen')
        self.assertTrue(seen['defeats'])
        self.assertTrue(certify(c)['ok'], certify(c).get('errors'))

    def test_a_sighting_that_breaks_a_lie_is_dropped(self):
        c = copy.deepcopy(self.case)
        c['signs'].append({**copy.deepcopy(SEEN), 'sighting': True})
        publish.record_contradictions(c, log=lambda *a: None)
        self.assertFalse(any(x['id'] == 's_test_seen' for x in c['signs']))
        self.assertTrue(certify(c)['ok'])

if __name__ == '__main__':
    unittest.main()
