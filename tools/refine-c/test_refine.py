"""Offline tests for the code-side checker in refine.py (no LLM calls)."""
import copy, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from refine import certify, apply_patch, survivors, analyse


def base():
    return {
        'setting': {'name': 'Test', 'places': [{'id': 'gallery', 'name': 'Gallery'}, {'id': 'cottage', 'name': 'Cottage'}, {'id': 'inn', 'name': 'Inn'}],
                    'links': [{'a': 'gallery', 'b': 'cottage', 'minutes': 10}, {'a': 'cottage', 'b': 'inn', 'minutes': 15}]},
        'rules': [{'id': 'r_trim', 'text': 'wicks are trimmed hourly', 'knowledge': 'acquirable'}],
        'people': [{'id': 'tom', 'name': 'Tom', 'traits': {'handed': 'left'}}, {'id': 'wife', 'name': 'Wife', 'traits': {'handed': 'right'}},
                   {'id': 'cox', 'name': 'Coxswain', 'traits': {'handed': 'right'}}, {'id': 'keeper', 'name': 'Keeper', 'traits': {}}],
        'objects': [], 'relations': [], 'possession': [],
        'question': {'text': 'who pushed the keeper?', 'truth': 'h_tom',
                     'candidates': [{'id': 'h_tom', 'label': 'Tom', 'facts': {'actor': 'tom'}}, {'id': 'h_wife', 'label': 'Wife', 'facts': {'actor': 'wife'}},
                                    {'id': 'h_cox', 'label': 'Cox', 'facts': {'actor': 'cox'}}],
                     'crime': {'event': 'e_push', 'place': 'gallery', 'window': [1320, 1440]}},
        'attitudes': [{'id': 'a_tom', 'agent': 'tom', 'mode': 'fears', 'content': 'exposure'},
                      {'id': 'a_wife', 'agent': 'wife', 'mode': 'intends', 'content': 'sleep'},
                      {'id': 'a_cox', 'agent': 'cox', 'mode': 'intends', 'content': 'drink'},
                      {'id': 'a_kp', 'agent': 'keeper', 'mode': 'intends', 'content': 'tend lamp'}],
        'events': [{'id': 'e_push', 'type': 'push', 'agent': 'tom', 'others': ['keeper'], 'place': 'gallery', 'start': 1400, 'end': 1402, 'causedBy': 'a_tom'},
                   {'id': 'e_wife', 'type': 'sleep', 'agent': 'wife', 'place': 'cottage', 'start': 1300, 'end': 1500, 'causedBy': 'a_wife'},
                   {'id': 'e_cox', 'type': 'drink', 'agent': 'cox', 'place': 'inn', 'start': 1300, 'end': 1500, 'causedBy': 'a_cox'}],
        'signs': [
            {'id': 's_wife', 'kind': 'testimony', 'speaker': 'cox', 'text': 'She never left the cottage.', 'claim': {'kind': 'place', 'person': 'wife', 'place': 'cottage', 'start': 1310, 'end': 1450}},
            {'id': 's_cox', 'kind': 'record', 'text': 'The inn ledger.', 'claim': {'kind': 'place', 'person': 'cox', 'place': 'inn', 'start': 1310, 'end': 1450}},
        ]}


class Checker(unittest.TestCase):
    def test_trivial_surface_unique(self):
        r = certify(base())
        self.assertTrue(r['ok'], r.get('errors'))
        self.assertEqual(r['surface'], ['h_tom'])
        self.assertEqual(r['solve_depth'], 0)
        self.assertFalse(r['twist'])

    def test_not_unique(self):
        c = base(); c['signs'] = c['signs'][:1]
        r = certify(c)
        self.assertFalse(r['ok']); self.assertTrue(any('not unique' in e for e in r['errors']))

    def test_two_places_at_once(self):
        c = base(); c['events'].append({'id': 'e_x', 'type': 'walk', 'agent': 'tom', 'place': 'inn', 'start': 1395, 'end': 1405, 'causedBy': 'a_tom'})
        r = certify(c); self.assertFalse(r['ok']); self.assertTrue(any('two places' in e for e in r['errors']))

    def test_travel_too_fast(self):
        c = base(); c['events'].append({'id': 'e_x', 'type': 'walk', 'agent': 'tom', 'place': 'inn', 'start': 1380, 'end': 1395, 'causedBy': 'a_tom'})
        r = certify(c); self.assertFalse(r['ok']); self.assertTrue(any('cannot travel' in e for e in r['errors']))

    def test_unjustified_event(self):
        c = base(); c['events'][1]['causedBy'] = None
        r = certify(c); self.assertFalse(r['ok']); self.assertTrue(any('no causing attitude' in e for e in r['errors']))

    def twist(self):
        c = base()
        c['attitudes'].append({'id': 'a_wife_protect', 'agent': 'wife', 'mode': 'wants', 'content': 'protect tom'})
        c['signs'].append({'id': 's_alibi', 'kind': 'testimony', 'speaker': 'wife', 'because': ['a_wife_protect'], 'text': 'Tom was with me all night.',
                           'claim': {'kind': 'place', 'person': 'tom', 'place': 'cottage', 'start': 1330, 'end': 1430}})
        c['signs'].append({'id': 's_key', 'kind': 'item', 'text': 'A key.'})
        c['signs'].append({'id': 's_log', 'kind': 'record', 'text': 'Lamp log.', 'requires': ['s_key'], 'needs': ['r_rule'], 'unlock': 'the key opens the log cabinet', 'reading': 'the manual says wicks are trimmed hourly',
                           'claim': {'kind': 'place', 'person': 'tom', 'place': 'gallery', 'start': 1395, 'end': 1405}, 'defeats': ['s_alibi']})
        c['signs'].append({'id': 'r_rule', 'kind': 'rule', 'rule': 'r_trim', 'text': 'The keeper manual.'})
        return c

    def test_false_alibi_twist(self):
        r = certify(self.twist())
        self.assertTrue(r['ok'], r.get('errors'))
        self.assertTrue(r['twist']); self.assertNotIn('h_tom', r['surface'])
        self.assertEqual(r['false_signs'], ['s_alibi'])
        self.assertEqual(r['solve_depth'], 2)  # key (0) -> log access (1) -> read with the manual rule (+1)
        self.assertIn('s_log', r['key'])

    def test_thread_depths(self):
        r = certify(self.twist())
        # both innocents are cleared on the surface; the truth only survives once the lie is defeated (depth 2)
        self.assertEqual(r['threads'], {'truth': 2, 'h_wife': 0, 'h_cox': 0})

    def test_motive_and_means(self):
        c = self.twist()
        c['relations'] = [{'a': 'tom', 'rel': 'paid_by', 'b': 'smugglers'}]
        c['possession'] = [{'person': 'tom', 'item': 'gallery_key'}]
        c['signs'].append({'id': 's_pay', 'kind': 'document', 'text': 'A payment note.', 'requires': ['s_key'], 'unlock': 'the key opens his chest',
                           'claim': {'kind': 'relation', 'a': 'tom', 'rel': 'paid_by', 'b': 'smugglers'}})
        c['signs'].append({'id': 's_keyring', 'kind': 'trace', 'text': 'Only one gallery key was issued.',
                           'claim': {'kind': 'possession', 'item': 'gallery_key'}})
        r = certify(c)
        self.assertTrue(r['ok'], r.get('errors'))
        self.assertEqual(r['motive'], ['s_pay']); self.assertEqual(r['means'], ['s_keyring'])
        # a world-fact relation claim establishes a motive but rules nobody out
        self.assertEqual(r['threads']['h_wife'], 0)

    def test_false_world_fact_is_caught(self):
        c = self.twist()
        c['signs'].append({'id': 's_bad', 'kind': 'document', 'text': 'A note.', 'claim': {'kind': 'relation', 'a': 'wife', 'rel': 'paid_by', 'b': 'smugglers'}})
        r = certify(c); self.assertFalse(r['ok']); self.assertTrue(any('s_bad' in e for e in r['errors']))

    def test_edges_need_in_world_reasons(self):
        c = self.twist(); c['signs'][4].pop('unlock')
        r = certify(c); self.assertFalse(r['ok']); self.assertTrue(any("no 'unlock'" in e for e in r['errors']))

    def test_spoken_times_must_match_timeline(self):
        c = base(); c['signs'][0]['text'] = 'She was home by 9:00 in the morning.'
        r = certify(c); self.assertFalse(r['ok']); self.assertTrue(any('matches no event' in e for e in r['errors']))
        c = base(); c['signs'][0]['text'] = 'She never left after 23:20.'   # 1400 = 23:20, the push
        self.assertTrue(certify(c)['ok'])

    def test_trace_lies_where_made(self):
        c = base(); c['signs'].append({'id': 's_mark', 'kind': 'trace', 'text': 'A scuff.', 'at': 'inn', 'source': 'e_push'})
        r = certify(c); self.assertFalse(r['ok']); self.assertTrue(any('lies where it was made' in e for e in r['errors']))

    def test_lie_needs_reason_and_defeater(self):
        c = self.twist(); c['signs'][2].pop('because')
        r = certify(c); self.assertFalse(r['ok']); self.assertTrue(any('cites no attitude' in e for e in r['errors']))
        c = self.twist(); c['signs'][4].pop('defeats')
        r = certify(c); self.assertFalse(r['ok']); self.assertTrue(any('no reachable, true defeater' in e for e in r['errors']))

    def test_trait_claim_computed(self):
        c = base(); c['signs'] = [{'id': 's_glove', 'kind': 'trace', 'text': 'A left-hand glove.', 'claim': {'kind': 'trait', 'trait': 'handed', 'value': 'left'}}]
        r = certify(c); self.assertTrue(r['ok'], r.get('errors')); self.assertEqual(r['surface'], ['h_tom'])

    def test_patch_remove_only_target(self):
        with self.assertRaises(ValueError):
            apply_patch(base(), {'remove': ['s_cox']}, 's_wife')


if __name__ == '__main__':
    unittest.main()
