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
        self.assertEqual(good['lines_for'], publish.lines_key(good))
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
        x['show'], x['lines_for'] = 'Mrs Vale says so. Do you know if that is true?', publish.lines_key(x)
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

    def test_an_account_put_to_its_subject_stays_the_speakers(self):
        """A Fall Before Midnight (November 8): Pike's account was put to Miss Vale as "You told me you were fishing"."""
        acct = {'kind': 'testimony'}
        self.assertTrue(publish.misaddressed(acct, 'direct', 'You told me you were fishing by the boathouse. Is that the whole of it?'))
        self.assertTrue(publish.misaddressed(acct, 'direct', 'You now say Miss Vale sat with you. Is that the truth?'))
        self.assertFalse(publish.misaddressed(acct, 'direct', 'Mr Pike says you went down the path near ten. Is that so?'))
        self.assertFalse(publish.misaddressed(acct, 'confront', 'You told me you were fishing. Is that the whole of it?'), 'said to the speaker')
        self.assertFalse(publish.misaddressed({'kind': 'behavior'}, 'direct', 'You told me the key was lost. Why?'), 'the behaviour itself')
        c = copy.deepcopy(self.case)
        x = next(s for s in c['signs'] if s.get('kind') == 'testimony' and s.get('speaker'))
        x['direct'], x['lines_for'] = 'You told me you were out. Is that so?', publish.lines_key(x)
        refine.llm_json = lambda *a, **k: {'verdicts': {}}
        publish.check_lines(c)
        self.assertNotIn('direct', x, 'dropped even once checked, so it is written again')

    def test_lines_checked_under_an_earlier_check_are_checked_again(self):
        c = copy.deepcopy(self.case)
        x = next(s for s in c['signs'] if s.get('show'))
        x['lines_for'] = publish.text_key(x.get('text'))          # stamped by the first version of the check
        seen = []
        refine.llm_json = lambda system, prompt, *a, **k: seen.append(json.loads(prompt)) or {'verdicts': {x['id']: {'agrees': True}}}
        publish.check_lines({**c, 'signs': [x]})
        self.assertTrue(seen and seen[0][0]['id'] == x['id'])
        self.assertEqual(x['lines_for'], publish.lines_key(x))

    def test_the_last_check_keeps_only_lines_it_judged_to_agree(self):
        c = copy.deepcopy(self.case)
        lined = [x for x in c['signs'] if x.get('show')][:2]
        for x in lined:
            x.pop('lines_for', None)
        judged, unjudged = lined
        refine.llm_json = lambda *a, **k: {'verdicts': {judged['id']: {'agrees': True}}}
        publish.check_lines(c)
        self.assertIn('show', unjudged, 'unjudged: checked again next time')
        publish.check_lines(c, final=True)
        self.assertNotIn('show', unjudged, 'after the last check nothing unjudged is kept')
        self.assertIn('show', judged)

    def test_a_death_after_the_fatal_window_is_worded_as_delayed(self):
        """Regeneration reviews, November 8: a death forty minutes after the window was worded as death in the window."""
        c = json.load(open(os.path.join(HERE, '..', '..', 'dist', 'cases', 'archive', '2026-10', 'mk-live-20261002-225824.json')))
        for x in c['signs']:
            x.pop('medical_v', None)
        seen = []
        def fake(system, prompt, *a, **k):
            if system == publish.MEDICAL_AGREES:
                return {'verdicts': {'medical': {'agrees': True}}}
            seen.append(json.loads(prompt))
            return {'notes': 'He breathed gas.', 'says': 'He died around {death}; the cause began {window}.'}
        refine.llm_json = fake
        publish.add_medical(c)
        self.assertTrue(seen and seen[0]['delayed'])
        said = next(x for x in c['signs'] if x.get('medical') and x.get('kind') == 'testimony')['text']
        self.assertIn('ten to eleven', said)

    def test_last_resort_lines_are_written_in_voice_and_kept_only_if_fact_free(self):
        c = copy.deepcopy(self.case)
        c.pop('fallbacks_version', None)
        truth = enrich.truth_actor(c)
        def fake(system, prompt, *a, **k):
            items = json.loads(prompt)
            if system == publish.FALLBACKS:
                return {'lines': {i['id']: {'pressed': ['I have said what I can.', 'I was at home at 9.'],
                                            'minimise': ['Perhaps I had it wrong; it proves nothing.'] if i['culprit'] else []} for i in items}}
            return {'verdicts': {k: [True] * len(v) for k, v in items.items()}}
        refine.llm_json = fake
        publish.add_fallback_lines(c)
        self.assertTrue(all(lines == ['I have said what I can.'] for lines in c['pressed'].values()), 'a line with a digit is dropped by code')
        self.assertEqual(list(c['minimise']), [truth], 'only the culprit minimises')
        self.assertEqual(c['fallbacks_version'], publish.FALLBACKS_VERSION)

    def test_the_doctors_notes_keep_to_her_own_word_on_the_body(self):
        """Regeneration reviews, November 8: her account put death between ten and twenty past eleven, the notes in the
        case's narrower window; the notes now take her window and are held to what she said."""
        c = copy.deepcopy(self.case)
        doctor = enrich.role(c, 'examiner')
        c['signs'] = [x for x in c['signs'] if not x.get('medical') and x.get('speaker') != doctor]
        c['signs'].append({'id': 's_her_exam', 'kind': 'testimony', 'speaker': doctor, 'title': 'On the body',
                           'text': 'Death came between ten and twenty past eleven, I would say.',
                           'claim': {'pred': 'crimeBetween', 'from': 1320, 'to': 1400}})
        seen, verdicts = [], iter([False, True])
        def fake(system, prompt, *a, **k):
            if system == publish.MEDICAL_AGREES:
                return {'verdicts': {'medical': {'agrees': next(verdicts), 'why': 'a different cause'}}}
            seen.append(json.loads(prompt))
            return {'notes': 'Injuries from a fall.', 'says': 'She died {window}.'}
        refine.llm_json = fake
        publish.add_medical(c)
        notes = next(x for x in c['signs'] if x['id'] == 's_medical')
        self.assertEqual((notes['claim']['from'], notes['claim']['to']), (1320, 1400), 'her window')
        self.assertIn('Death came between ten', seen[0]['her_accounts'][0])
        self.assertIn('different cause', seen[1]['previous_attempt']['disagrees_because'])

    def test_an_account_is_placed_where_its_speaker_is_when_the_investigation_starts(self):
        c = copy.deepcopy(self.case)
        doctor = enrich.role(c, 'examiner')
        exam = next(e for e in c['events'] if e.get('type') == 'examination')
        acct = next(x for x in c['signs'] if x.get('kind') == 'testimony' and x.get('speaker') == doctor)
        acct['at'] = 'nowhere-in-particular'
        publish.place_accounts(c)
        self.assertEqual(acct['at'], publish.start_place(c, doctor))
        self.assertTrue(all(x['at'] == publish.start_place(c, x['speaker']) for x in c['signs'] if x.get('kind') == 'testimony' and x.get('speaker')))

    def test_an_account_that_offers_what_the_case_never_gives_is_reworded(self):
        """November 8 play: "I've put them in an envelope for you", and no envelope existed."""
        c = json.load(open(os.path.join(HERE, '..', '..', 'dist', 'cases', 'generated', 'mk-live-20261108-121102.json')))
        for x in c['signs']:
            x.pop('promise_checked', None)
        exam = next(x for x in c['signs'] if x['id'] == 's_exam')
        exam['text'] = exam['text'].rstrip('"') + ' I\'ve put them in an envelope for you."'
        def fake(system, prompt, *a, **k):
            data = json.loads(prompt)
            if system == publish.PROMISE:
                assert 'clues' in data
                return {'verdicts': {i['id']: {'offers': 'envelope' in i['text'], 'what': 'an envelope of fibres'} for i in data['items']}}
            if system == publish.REWORD:
                return {'accounts': {i['id']: i['account'].replace(" I've put them in an envelope for you.", '') for i in data}}
            return {'verdicts': {i['id']: {'same': True} for i in data}}
        refine.llm_json = fake
        self.assertEqual(publish.remove_promises(c), 1)
        self.assertNotIn('envelope', exam['text'])
        self.assertTrue(all(x.get('promise_checked') == publish.PROMISE_CHECK for x in c['signs'] if x.get('kind') == 'testimony' and x.get('text')))
        refine.llm_json = lambda *a, **k: self.fail('checked once')
        publish.remove_promises(c)

    def test_a_doctor_who_lies_about_the_time_never_makes_a_record_of_it(self):
        c = copy.deepcopy(self.case)
        doctor = enrich.role(c, 'examiner')
        c['signs'] = [x for x in c['signs'] if not x.get('medical') and x.get('speaker') != doctor]
        c['signs'].append({'id': 's_her_lie', 'kind': 'testimony', 'speaker': doctor, 'title': 'On the body',
                           'text': 'Death came between six and seven.', 'claim': {'pred': 'crimeBetween', 'from': 1080, 'to': 1140}})
        refine.llm_json = lambda system, prompt, *a, **k: ({'verdicts': {'medical': {'agrees': True}}} if system == publish.MEDICAL_AGREES
                                                         else {'notes': 'A fall.', 'says': 'Death came {window}.'})
        publish.add_medical(c)
        notes = next(x for x in c['signs'] if x['id'] == 's_medical')
        self.assertEqual((notes['claim']['from'], notes['claim']['to']), tuple(c['question']['crime']['window']))


if __name__ == '__main__':
    unittest.main()
