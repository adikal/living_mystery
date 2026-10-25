"""An evening account never contradicts what its speaker also tells the detective: rewritten once, else dropped."""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import publish  # noqa: E402
import refine  # noqa: E402

CASE = os.path.join(HERE, '..', '..', 'dist', 'cases', 'generated', 'mk-live-20261003-133036.json')


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
            if system == publish.LEAK:
                return {'verdicts': {i['id']: {'leaks': False} for i in items}}
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




class WhoIsWho(unittest.TestCase):
    """The evening-account check is told who everyone is, so 'my wife' for a sister fails; older checks are redone."""
    def test_who_is_given_and_old_checks_redone(self):
        import json as _json, publish as P, refine as R
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'dist', 'cases', 'archive', '2026-10', 'mk-live-20261002-235614.json')
        case = _json.load(open(path))
        x = next(s for s in case['signs'] if s.get('surface'))
        x['agrees_checked'] = True                       # an older version of the check
        seen, saved = [], R.llm_json
        R.llm_json = lambda system, prompt, *a, **k: (seen.append(_json.loads(prompt)) or
                                                      {'verdicts': {i['id']: {'agrees': True, 'leaks': False} for i in _json.loads(prompt)}})
        try:
            P.surface_disagreements(case, [x])
        finally:
            R.llm_json = saved
        self.assertTrue(seen and all(i.get('who') for i in seen[0]), 'each item carries who everyone is')
        self.assertNotEqual(x.get('agrees_checked'), P.SURFACE_CHECK)


class FromTheIronHound(unittest.TestCase):
    """Play review of The Iron Hound: Dora's evening account gave away what her lamp testimony is locked behind, and
    sightings had Vera seen at the Rook while she kept to her back bedroom there."""
    PATH = os.path.join(HERE, '..', '..', 'dist', 'cases', 'archive', '2026-10', 'mk-live-20261025-114526.json')
    LEAKY = ('I was behind my counter sorting the evening post, and later took a turn out with my lamp when I heard a clatter '
             'in the fog. Picked up a thing or two that had no business lying in the gutter, and then home to bed.')

    def setUp(self):
        self.case = json.load(open(self.PATH))
        self.fresh = json.load(open(self.PATH))
        self.saved = refine.llm_json

    def tearDown(self):
        refine.llm_json = self.saved

    def test_a_locked_admission_is_kept_back_from_the_evening_account(self):
        back = publish.kept_back(self.case, 'dora')
        self.assertTrue(any('picks up the iron hound' in b for b in back))
        seen = []
        def fake(system, prompt, *a, **k):
            items = json.loads(prompt); seen.append((system, items))
            if system == publish.AGREES:
                return {'verdicts': {i['id']: {'agrees': True} for i in items}}
            if system == publish.LEAK:
                return {'verdicts': {i['id']: {'leaks': 'lamp' in i['account'], 'what': 'the lamp'} for i in items}}
            if system == publish.SURFACE_TRUTH:
                return {'verdicts': {i['id']: {'v': 'honest'} for i in items['accounts']}}
            return {'accounts': {i['id']: 'I sorted the post and went to bed.' for i in items}}
        refine.llm_json = fake
        next(x for x in self.case['signs'] if x['id'] == 's_surface_dora')['text'] = self.LEAKY
        self.assertEqual(publish.repair_wording(self.case, ['s_surface_dora: LOCK: admits she went out with a lamp and picked something up']), (True, []))
        write = next(i for system, items in seen if system == publish.SURFACE for i in items if i['id'] == 'dora')
        self.assertIn('lamp', write['previous_attempt']['rejected_because'])
        self.assertEqual(write['keeps_back'], back)
        self.assertFalse(set(back) & set(write['events']), 'the writer is not handed what she keeps back as her evening')
        check = next(i for system, items in seen if system == publish.LEAK for i in items if i['id'] == 's_surface_dora')
        self.assertEqual(check['keeps_back'], back, 'a focused check asks whether the account gives that away')
        # and the old wording is caught by that check on its own, without a reviewer
        leaky = dict(next(x for x in self.fresh['signs'] if x['id'] == 's_surface_dora'), text=self.LEAKY)
        self.assertIn('s_surface_dora', publish.surface_disagreements(self.fresh, [leaky]))
        x = next(x for x in self.case['signs'] if x['id'] == 's_surface_dora')
        self.assertEqual(x['text'], 'I sorted the post and went to bed.')

    def test_sightings_are_judged_for_whether_they_met(self):
        cands = publish.sighting_candidates(self.case)
        upstairs = [c for c in cands if 'vera' in c[:2] and c[2] == 'inn' and c[3] < 1788]
        self.assertTrue(upstairs, 'co-presence alone puts her with the bar')
        seen = []
        def fake(system, prompt, *a, **k):
            items = json.loads(prompt); seen.extend(items)
            return {'verdicts': {i['id']: 'Vera' not in (i['first'] + i['second']) for i in items}}
        refine.llm_json = fake
        kept = publish.visible(self.case, cands)
        self.assertFalse([c for c in kept if c in upstairs])
        lodger = next(i for i in seen if i['first'] == 'Vera Lacey')
        self.assertTrue(any('back bedroom' in d for d in lodger['first_doing']), 'the judge sees what each was doing')
        # a published sighting from before the judgement is judged, and dropped if they would not have met
        a, b, pl, lo, hi, ev = next(c for c in upstairs if c[0] == 'ada')
        self.case['signs'].append({'id': 's_saw_ada_vera_inn', 'kind': 'testimony', 'speaker': a, 'sighting': True, 'source': ev,
                                   'claim': {'pred': 'wasAt', 'person': b, 'place': pl, 'from': lo, 'to': hi},
                                   'title': 'Ada Finch saw Vera Lacey', 'text': 'I saw Mrs Lacey at the Rook.'})
        before = ['s_saw_ada_vera_inn']
        refine.llm_json = lambda system, prompt, *a, **k: (fake(system, prompt) if system == publish.VISIBLE else {'lines': {}, 'problems': {}})
        publish.add_sightings(self.case, log=lambda *a: None)
        self.assertFalse([x for x in self.case['signs'] if x['id'] in before])

    def test_the_doctor_does_not_give_the_same_account_twice(self):
        exam = next(x for x in self.case['signs'] if x['id'] == 's_exam')
        self.case['signs'] = [x for x in self.case['signs'] if not x.get('medical')]
        self.case['signs'][:0] = [{'id': 's_medical', 'kind': 'record', 'medical': True, 'medical_v': publish.MEDICAL_V, 'text': 'notes', 'claim': exam['claim']},
                                  {'id': 's_medical_iris', 'kind': 'testimony', 'medical': True, 'medical_v': publish.MEDICAL_V, 'speaker': 'iris',
                                   'claim': exam['claim'], 'text': 'Death was from a blow.', 'ask': 'Doctor, what did you find?'}]
        self.assertEqual(publish.add_medical(self.case), 0, 'the notes are current: nothing is written again')
        ids = [x['id'] for x in self.case['signs']]
        self.assertIn('s_medical', ids)
        self.assertIn('s_exam', ids)
        self.assertNotIn('s_medical_iris', ids, "the structure's examination account is the doctor's account")

    def test_question_aliases_are_judged_at_full_effort(self):
        efforts = []
        refine.llm_json = lambda *a, **k: (efforts.append(refine._EFFORT.get()) or {'duplicates': {}})
        with refine.effort('low'):
            publish.duplicate_questions(self.case)
        self.assertEqual(efforts, [None])
    def test_reaction_writers_see_what_the_village_knows_and_how_the_clue_was_found(self):
        seen = []
        refine.llm_json = lambda system, prompt, *a, **k: (seen.append(json.loads(prompt)) or {'reactions': {}})
        publish.add_reactions(self.case)
        self.assertTrue(seen)
        self.assertTrue(any('sitting-room door' in f for f in seen[0]['village']['public']), 'the hound lives in her locked room')
        item = next(i for p in seen for i in p['items'] if i['key'] == 's_doorstop|dora')
        self.assertIn('parcel cupboard', item['how_found'])
        self.assertTrue(item['keep_back'] and 'tells' in item)
    def test_scripted_players_catch_a_hint_that_asks_the_wrong_question(self):
        self.assertEqual(publish.scripted_problems(self.fresh), [])
        exam = next(s for s in self.fresh['signs'] if s['id'] == 's_exam')
        exam['same_as'] = 'night'
        self.fresh['signs'].insert(1, {'id': 's_medical_iris', 'kind': 'testimony', 'medical': True, 'speaker': 'iris', 'claim': exam['claim'],
                                       'text': 'Death was from a heavy blow to the head, between nine and half past.',
                                       'ask': 'Doctor, what did you find when you examined Mr Hugo?', 'same_as': 'night'})
        self.assertEqual(publish.scripted_problems(self.fresh), ['s_exam: following its hint (“What is your account of last night?”): asked, not given'])
    def test_someone_whose_account_is_false_volunteers_no_sightings(self):
        for x in self.case['signs']:
            x.pop('deceptive', None)                         # labels come late; certification knows the lie
        asked = []
        refine.llm_json = lambda system, prompt, *a, **k: (asked.append(json.loads(prompt)) or {'verdicts': {}, 'lines': {}})
        publish.add_sightings(self.case, log=lambda *a: None)
        speakers = {i['first'] for p in asked if isinstance(p, list) for i in p if 'first' in i}
        self.assertTrue(speakers)
        self.assertNotIn('Edmund Vale', speakers, "his alibi for Clara is false: he does not volunteer where he was")

    def test_a_reaction_that_fails_its_own_check_is_not_kept(self):
        def fake(system, prompt, *a, **k):
            p = json.loads(prompt)
            if system == publish.REACT:
                return {'reactions': {i['key']: 'I never touched it.' for i in p['items']}}
            self.assertTrue(p['public'] and p['who'])
            return {'verdicts': {i['key']: {'ok': i['key'] != 's_doorstop|clara', 'why': 'against the public record'} for i in p['items']}}
        refine.llm_json = fake
        for x in self.case['signs']:
            x.pop('reactions', None)
        publish.add_reactions(self.case)
        hound = next(x for x in self.case['signs'] if x['id'] == 's_doorstop')
        self.assertNotIn('clara', hound.get('reactions', {}))
        self.assertIn('dora', hound.get('reactions', {}))

    def test_judges_think_at_full_effort_inside_a_low_effort_phase(self):
        self.assertIn(publish.REACT_CHECK, refine.FULL_EFFORT)
        self.assertIn(publish.LEAK, refine.FULL_EFFORT)
        self.assertNotIn(publish.REACT, refine.FULL_EFFORT)
        sent = []
        class Client:
            def converse(self, **kw):
                sent.append(kw.get('additionalModelRequestFields'))
                return {'output': {'message': {'content': [{'toolUse': {'input': {'verdicts': {}}}}]}}, 'usage': {}}
        saved = refine._client
        refine._client = Client()
        try:
            with refine.effort('low'):
                self.saved(publish.LEAK, '[]', 100, model='m')
                self.saved(publish.REACT, '[]', 100, model='m')
                self.saved(publish.LEAK, '[]', 100, model=refine.CRITIC_MODEL)
        finally:
            refine._client = saved
        # a judge at its own effort (the wording model's judges at medium), the writer at the phase's
        self.assertEqual(sent, [None, {'output_config': {'effort': 'low'}}, {'output_config': {'effort': 'medium'}}])

    def test_publishing_repairs_only_its_own_words(self):
        hound = next(x for x in self.case['signs'] if x['id'] == 's_doorstop')
        hound['reactions'] = {'clara': 'Missing from the hall for days.'}
        sighting = next((x['id'] for x in self.case['signs'] if x.get('sighting')), None)
        refine.llm_json = lambda system, prompt, *a, **k: {'verdicts': {}}
        changed, left = publish.repair_wording(self.case, [
            "s_doorstop: CONTRADICTION: Clara's reaction says the hound was missing from the hall for days",
            's_letter: LOCK: finding the hat would not lead the detective to the letter',
            'GLOBAL: CRAFT: the case is confusing'] + ([f'{sighting}: CONTRADICTION: she was upstairs'] if sighting else []))
        self.assertFalse(changed, 'with a problem in the structure, publishing changes nothing')
        self.assertEqual(hound['reactions'], {'clara': 'Missing from the hall for days.'})
        self.assertEqual(left, ['s_letter: LOCK: finding the hat would not lead the detective to the letter', 'GLOBAL: CRAFT: the case is confusing'])
        changed, left = publish.repair_wording(self.case, [
            "s_doorstop: CONTRADICTION: Clara's reaction says the hound was missing from the hall for days"]
            + ([f'{sighting}: CONTRADICTION: she was upstairs'] if sighting else []))
        self.assertEqual((changed, left), (True, []))
        self.assertNotIn('reactions', hound)
        if sighting:
            self.assertNotIn(sighting, {x['id'] for x in self.case['signs']})

    def test_an_issue_is_publishings_when_it_quotes_or_names_its_lines(self):
        x = {'concede': {'d': 'Twenty past ten to twenty to twelve, not quarter past as I told you.'}, 'show': 'Death between ten and eleven?',
             'text': 'I was at the boathouse all night.'}
        self.assertTrue(publish._wording_issue(x, " CHARACTER: his concession says 'twenty past ten to twenty to twelve, not quarter past'"))
        self.assertTrue(publish._wording_issue(x, ' CRAFT: the show prompt gives the wrong window'))
        self.assertFalse(publish._wording_issue(x, " LOCK: 'I was at the boathouse all night' leads nowhere"))
        self.assertFalse(publish._wording_issue({'text': 'x'}, ' CONTRADICTION: the reaction is wrong'), 'no lines of its own to drop')

    def test_a_reaction_the_judge_leaves_unjudged_is_not_kept_and_no_verdicts_is_a_failed_reply(self):
        def fake(system, prompt, *a, **k):
            p = json.loads(prompt)
            if system == publish.REACT:
                return {'reactions': {i['key']: 'Well I never.' for i in p['items']}}
            return {'verdicts': {i['key']: {'ok': True} for i in p['items'] if i['key'] != 's_doorstop|dora'}}
        refine.llm_json = fake
        for x in self.case['signs']:
            x.pop('reactions', None)
        publish.add_reactions(self.case)
        hound = next(x for x in self.case['signs'] if x['id'] == 's_doorstop')
        self.assertNotIn('dora', hound.get('reactions', {}))
        self.assertIn('clara', hound.get('reactions', {}))
        with self.assertRaises(refine.LLMJSONResponseError):
            publish._verdicts({'verdicts': {}}, ['a', 'b'])
        # a reply that wraps its verdicts twice is read as it means
        self.assertEqual(publish._verdicts({'verdicts': {'verdicts': {'a': {'ok': True}}}}, ['a']), {'a': {'ok': True}})


if __name__ == '__main__':
    unittest.main()
