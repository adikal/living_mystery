"""Offline tests for the code-side checker in refine.py (no LLM calls)."""
import copy, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from refine import certify, apply_patch, survivors, analyse


def base():
    # claims follow docs/claims.md (version 2); what everyone knows (the crime window here) is a public sign
    return {
        'claims_version': 2,
        'setting': {'name': 'Test', 'places': [{'id': 'gallery', 'name': 'Gallery'}, {'id': 'cottage', 'name': 'Cottage'}, {'id': 'inn', 'name': 'Inn'}],
                    'links': [{'a': 'gallery', 'b': 'cottage', 'minutes': 10}, {'a': 'cottage', 'b': 'inn', 'minutes': 15}]},
        'rules': [{'id': 'r_trim', 'text': 'wicks are trimmed hourly', 'knowledge': 'acquirable'}],
        'people': [{'id': 'tom', 'name': 'Tom', 'traits': {'handed': 'left'}}, {'id': 'wife', 'name': 'Wife', 'traits': {'handed': 'right'}},
                   {'id': 'cox', 'name': 'Coxswain', 'traits': {'handed': 'right'}}, {'id': 'keeper', 'name': 'Keeper', 'traits': {}}],
        'objects': [{'id': 'gallery_key'}, {'id': 'smugglers'}], 'vocabulary': {'relations': [{'rel': 'owes'}, {'rel': 'paid_by'}, {'rel': 'hates'}]},
        'relations': [{'a': 'tom', 'rel': 'owes', 'b': 'keeper'}], 'holdings': [{'person': 'tom', 'item': 'gallery_key'}],
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
            {'id': 's_wife', 'kind': 'testimony', 'speaker': 'cox', 'text': 'She never left the cottage.', 'claim': {'pred': 'wasAt', 'person': 'wife', 'place': 'cottage', 'from': 1310, 'to': 1450}},
            {'id': 's_cox', 'kind': 'record', 'text': 'The inn ledger.', 'claim': {'pred': 'wasAt', 'person': 'cox', 'place': 'inn', 'from': 1310, 'to': 1450}},
            {'id': 's_debt', 'kind': 'document', 'text': 'An IOU from Tom to the keeper.', 'claim': {'pred': 'related', 'a': 'tom', 'rel': 'owes', 'b': 'keeper'}},
            {'id': 's_holds', 'kind': 'record', 'text': 'Tom holds the gallery key.', 'claim': {'pred': 'had', 'person': 'tom', 'item': 'gallery_key'}},
            {'id': 'pub_window', 'kind': 'public', 'text': 'The keeper died between ten and midnight.', 'claim': {'pred': 'crimeBetween', 'from': 1320, 'to': 1440}},
        ]}


class Checker(unittest.TestCase):
    def test_trivial_surface_unique(self):
        r = certify(base())
        self.assertTrue(r['ok'], r.get('errors'))
        self.assertEqual(r['surface'], ['h_tom'])
        self.assertEqual(r['solve_depth'], 0)
        self.assertFalse(r['twist'])

    def test_not_unique(self):
        c = base(); c['signs'] = [x for x in c['signs'] if x['id'] in ('s_wife', 'pub_window')]
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
                           # with a 10-minute walk, at the cottage from 22:09 to 23:51 leaves no minute of 22:00 to 24:00 for the gallery
                           'claim': {'pred': 'wasAt', 'person': 'tom', 'place': 'cottage', 'from': 1329, 'to': 1431}})
        c['signs'].append({'id': 's_key', 'kind': 'item', 'text': 'A key.'})
        c['signs'].append({'id': 's_log', 'kind': 'record', 'text': 'Lamp log.', 'requires': ['s_key'], 'needs': ['r_rule'], 'unlock': 'the key opens the log cabinet', 'reading': 'the manual says wicks are trimmed hourly',
                           'claim': {'pred': 'wasAt', 'person': 'tom', 'place': 'gallery', 'from': 1400, 'to': 1402}, 'defeats': ['s_alibi']})
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
        c['relations'].append({'a': 'tom', 'rel': 'paid_by', 'b': 'smugglers'})
        c['signs'].append({'id': 's_pay', 'kind': 'document', 'text': 'A payment note.', 'requires': ['s_key'], 'unlock': 'the key opens his chest',
                           'claim': {'pred': 'related', 'a': 'tom', 'rel': 'paid_by', 'b': 'smugglers'}})
        c['signs'].append({'id': 's_keyring', 'kind': 'trace', 'text': 'Whoever did it had the gallery key.',
                           'claim': {'pred': 'culpritHad', 'item': 'gallery_key'}})
        r = certify(c)
        self.assertTrue(r['ok'], r.get('errors'))
        self.assertEqual(r['motive'], ['s_debt', 's_pay']); self.assertEqual(r['means'], ['s_keyring'])
        # a world-fact relation claim establishes a motive but rules nobody out
        self.assertEqual(r['threads']['h_wife'], 0)

    def test_false_world_fact_is_caught(self):
        c = self.twist()
        c['signs'].append({'id': 's_bad', 'kind': 'document', 'text': 'A note.', 'claim': {'pred': 'related', 'a': 'wife', 'rel': 'paid_by', 'b': 'smugglers'}})
        r = certify(c); self.assertFalse(r['ok']); self.assertTrue(any('s_bad' in e for e in r['errors']))

    def test_edges_need_in_world_reasons(self):
        c = self.twist(); next(x for x in c['signs'] if x['id'] == 's_log').pop('unlock')
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
        c = self.twist(); next(x for x in c['signs'] if x['id'] == 's_alibi').pop('because')
        r = certify(c); self.assertFalse(r['ok']); self.assertTrue(any('cites no attitude' in e for e in r['errors']))
        c = self.twist(); next(x for x in c['signs'] if x['id'] == 's_log').pop('defeats')
        r = certify(c); self.assertFalse(r['ok']); self.assertTrue(any('no reachable, true defeater' in e for e in r['errors']))

    def test_trait_clue_rules_out_only_those_known_to_lack_it(self):
        glove = {'id': 's_glove', 'kind': 'trace', 'text': 'A left-hand glove.', 'claim': {'pred': 'culpritTrait', 'trait': 'handed', 'value': 'left'}}
        c = base(); c['signs'] = [x for x in c['signs'] if x['id'] in ('s_debt', 's_holds')] + [glove]
        self.assertFalse(certify(c)['ok'], 'nothing the player knows says who is right-handed')
        c['signs'] += [{'id': f'pub_{p}', 'kind': 'public', 'text': f'{p} is right-handed.', 'claim': {'pred': 'hasTrait', 'person': p, 'trait': 'handed', 'value': 'right'}} for p in ('wife', 'cox')]
        r = certify(c); self.assertTrue(r['ok'], r.get('errors')); self.assertEqual(r['surface'], ['h_tom'])

    def test_undecided_claims_and_old_cases_are_refused(self):
        c = self.twist(); next(x for x in c['signs'] if x['id'] == 's_log')['claim'].update({'from': 1395, 'to': 1405})
        self.assertTrue(any('does not decide the claim of s_log' in e for e in certify(c)['errors']))
        old = base(); old.pop('claims_version')
        self.assertIn('migrate the case', certify(old)['errors'][0])

    def test_any_contradiction_needs_a_recorded_defeat(self):
        c = base(); c['signs'].append({'id': 's_gone', 'kind': 'record', 'text': 'The key was handed in at nine.',
                                       'claim': {'pred': 'had', 'person': 'tom', 'item': 'gallery_key', 'when': 'never', 'from': 1300, 'to': 1500}})
        self.assertTrue(any('s_gone, s_holds cannot all be true' in e for e in certify(c)['errors']))

    def test_patch_remove_only_target(self):
        with self.assertRaises(ValueError):
            apply_patch(base(), {'remove': ['s_cox']}, 's_wife')


class Pillars(unittest.TestCase):
    def test_pillars_reported(self):
        r = certify(base())
        self.assertTrue(r['ok'], r.get('errors'))
        self.assertEqual(r['pillar_signs'], {'motive': ['s_debt'], 'means': ['s_holds']})
        self.assertEqual(r['pillars'], {'opportunity': 0, 'means': 0, 'motive': 0})

    def test_missing_motive_fails(self):
        c = base(); c['signs'] = [x for x in c['signs'] if x['id'] != 's_debt']
        r = certify(c)
        self.assertFalse(r['ok']); self.assertTrue(any('MOTIVE' in e for e in r['errors']))

    def test_innocent_motive_is_not_the_culprits(self):
        c = base(); c['signs'] = [x for x in c['signs'] if x['id'] != 's_debt']
        c['relations'].append({'a': 'wife', 'rel': 'hates', 'b': 'keeper'})
        c['signs'].append({'id': 's_hate', 'kind': 'testimony', 'speaker': 'cox', 'text': 'She hated him.', 'claim': {'pred': 'related', 'a': 'wife', 'rel': 'hates', 'b': 'keeper'}})
        self.assertFalse(certify(c)['ok'])

    def test_deep_motive_sets_mmo_depth(self):
        c = base(); d = next(x for x in c['signs'] if x['id'] == 's_debt')
        c['signs'].append({'id': 's_drawer', 'kind': 'item', 'text': 'A drawer.'})
        d.update(requires=['s_drawer'], unlock='the IOU is in the drawer')
        r = certify(c)
        self.assertTrue(r['ok'], r.get('errors')); self.assertEqual(r['pillars']['motive'], 1); self.assertEqual(r['mmo_depth'], 1)


if __name__ == '__main__':
    unittest.main()
