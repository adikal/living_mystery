"""Wording that must agree with the records: the victim is dead in evening accounts; a sighting names whom it saw;
lines about a clue say only what its text says (checked once per text, redone when they do not)."""
import copy
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import enrich  # noqa: E402
import publish  # noqa: E402
import refine  # noqa: E402

CASE = os.path.join(HERE, '..', '..', 'dist', 'cases', 'archive', '2026-10', 'mk-live-20261002-235614.json')


class Wording(unittest.TestCase):
    def setUp(self):
        self.case = json.load(open(CASE))
        self.saved = refine.llm_json

    def tearDown(self):
        refine.llm_json = self.saved

    def test_victim_is_marked_dead(self):
        who = {p['id']: p for p in publish.who_is_who(self.case)}
        self.assertIn('dead', who[enrich.victim_of(self.case)].get('status', ''))
        self.assertTrue(all('status' not in p for pid, p in who.items() if pid != enrich.victim_of(self.case)))

    def test_a_sighting_must_name_whom_it_saw(self):
        x = next(s for s in self.case['signs'] if s.get('sighting'))
        person = next(p for p in enrich.SETTING['people'] if p['id'] == x['claim']['person'])
        self.assertTrue(publish.names_seen(self.case, x, f"I saw {person['address']} by the pump."))
        self.assertFalse(publish.names_seen(self.case, x, 'I saw her by the pump, if you must know.'))

    def test_lines_that_disagree_are_dropped_and_checked_ones_stamped(self):
        c = copy.deepcopy(self.case)
        lined = [x for x in c['signs'] if x.get('show')][:2]
        for x in lined:
            x.pop('lines_for', None)
        bad, good = lined
        refine.llm_json = lambda system, prompt, *a, **k: {'verdicts': {bad['id']: {'agrees': False, 'why': 'adds a place'},
                                                                        good['id']: {'agrees': True}}}
        self.assertGreaterEqual(publish.check_lines(c), 1)
        self.assertNotIn('show', bad)
        self.assertEqual(good['lines_for'], publish.text_key(good['text']))
        refine.llm_json = lambda *a, **k: self.fail('a line already checked against this text is not checked again')
        publish.check_lines({**c, 'signs': [good]})


    def test_a_form_of_address_no_one_answers_to(self):
        self.assertEqual(publish.wrong_addresses('Miss Lacey says she stayed in her room.'), ['Miss Lacey'])
        self.assertEqual(publish.wrong_addresses('Mrs Lacey says so, and Mr Vale, Miss Vale, Dr Marsh and the Reverend Hale agree.'), [])
        self.assertEqual(publish.wrong_addresses('Mrs Vale and Miss Lacey'), ['Mrs Vale', 'Miss Lacey'])
        self.assertEqual(publish.wrong_addresses('when Mrs Hale drowned', source='the night Mrs Hale drowned'), [], 'named in the clue itself')


    def test_a_wrong_address_is_dropped_even_from_a_checked_line(self):
        c = copy.deepcopy(self.case)
        x = next(s for s in c['signs'] if s.get('show'))
        x['show'], x['lines_for'] = 'Mrs Vale says so. Do you know if that is true?', publish.text_key(x.get('text'))
        refine.llm_json = lambda *a, **k: {'verdicts': {}}
        publish.check_lines(c)
        self.assertNotIn('show', x)


    def test_forms_of_address_are_put_right_where_the_person_is_plain(self):
        c = copy.deepcopy(self.case)
        x = next(s for s in c['signs'] if s.get('text'))
        x['text'] = 'Miss Lacey came by, and Mrs Hale too.'
        c['events'].append({'id': 'e_test', 'summary': 'Mrs Hale drowned years ago.', 'start': 0, 'end': 0})
        fixed, left = publish.correct_addresses(c)
        self.assertEqual(x['text'], 'Mrs Lacey came by, and Mrs Hale too.', 'a name the history uses is kept')
        self.assertGreaterEqual(fixed, 1)

    def test_new_lines_are_not_trusted_until_checked(self):
        c = copy.deepcopy(self.case)
        x = next(s for s in c['signs'] if s.get('kind') == 'testimony' and s.get('speaker'))
        for k in ('show', 'confront', 'direct', 'to', 'lines_for'):
            x.pop(k, None)
        refine.llm_json = lambda system, prompt, *a, **k: {'lines': {x['id']: {'show': 'They say so. Is that true?'}}}
        publish.add_show_lines(c)
        self.assertIn('show', x)
        self.assertNotIn('lines_for', x, 'a line just written is stamped only by the check')


if __name__ == '__main__':
    unittest.main()
