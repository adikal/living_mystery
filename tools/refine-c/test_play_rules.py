"""Rules from the play of Paste Pearls at the Pump (25 October): the doctor's findings are never held behind another
account of hers; the step critic re-judges every clue whose gate a step changed; morning accounts never name a clue
still to be found; reactions are written for a record's keeper and anyone a clue names; and every claimless account is
judged for a cover story."""
import copy
import json
import os
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import publish  # noqa: E402
import refine  # noqa: E402
import roles  # noqa: E402

CASES = os.path.join(HERE, '..', '..', 'dist', 'cases')


def find(name):
    for d in ('generated', os.path.join('archive', '2026-10')):
        path = os.path.join(CASES, d, name)
        if os.path.exists(path):
            return path
    raise FileNotFoundError(name)


PEARLS = find('mk-live-20261002-235614.json')   # the doctor's patient confidence held the notebook and her notes
TRAIN = find('mk-live-20261003-100726.json')    # the same, through the dead man's effects


def load(path):
    with open(path) as f:
        return json.load(f)


class ExaminerRule(unittest.TestCase):
    def test_the_two_cases_played_are_refused(self):
        self.assertEqual(sorted(e.split(':')[1].strip().split()[0] for e in roles.examiner_errors(load(PEARLS))), ['s_notebook', 's_wound'])
        found = ' '.join(roles.examiner_errors(load(TRAIN)))
        self.assertIn('s_notebook', found)
        self.assertIn('s_case_notes', found, 'held behind her account through another of her own clues')

    def test_findings_behind_her_examination_account_or_another_clue_are_fine(self):
        case = load(PEARLS)
        exam = next(x['id'] for x in case['signs'] if x.get('speaker') == 'iris' and x.get('source') == 'e_exam')
        for x in case['signs']:
            if x['id'] in ('s_notebook', 's_wound'):
                x['requires'] = [exam]
        self.assertEqual(roles.examiner_errors(case), [])

    def test_a_doctor_who_is_a_suspect_is_not_bound(self):
        case = load(PEARLS)
        case['question']['candidates'][0]['facts']['actor'] = 'iris'
        self.assertEqual(roles.examiner_errors(case), [])

    def test_the_gate_and_the_generator_both_apply_it(self):
        self.assertIn('examiner_errors', open(os.path.join(HERE, 'publish.py')).read())
        self.assertIn('roles.examiner_errors(case)', open(os.path.join(HERE, 'refine.py')).read())


class CriticScope(unittest.TestCase):
    def test_a_sign_behind_a_touched_one_is_judged_again(self):
        case = load(PEARLS)
        seen = {}

        def fake(system, prompt, *a, **k):
            seen['ctx'] = json.loads(prompt.split('CASE:\n', 1)[1])
            return types.SimpleNamespace(payload={'verdict': 'pass', 'issues': []}, request_ids=(), inference_profile='m',
                                         logical_request_id=None)
        saved = refine.llm_json_audited
        refine.llm_json_audited = fake
        try:
            refine.critic(case, {'story': 'x', 'modify': {'signs': {'s_iris_test': {'requires': ['s_bandage']}}}})
        finally:
            refine.llm_json_audited = saved
        touched = {x['id'] for x in seen['ctx']['signs_touched']}
        self.assertTrue({'s_iris_test', 's_notebook', 's_wound', 's_daybook'} <= touched, touched)
        self.assertIn('BOTTLENECK', refine.CRITIC_CHECKS)
        self.assertIn('ALLY', refine.CRITIC_CHECKS)


class Wording(unittest.TestCase):
    def setUp(self):
        self.saved = refine.llm_json

    def tearDown(self):
        refine.llm_json = self.saved

    def test_a_morning_account_never_names_a_clue_still_to_be_found(self):
        case = load(PEARLS)
        case['signs'] = [x for x in case['signs'] if x['id'] != 's_morning_iris']
        case.pop('morning_dropped', None)
        prompts = []

        def fake(system, prompt, *a, **k):
            items = json.loads(prompt)
            if system == publish.MORNING:
                prompts.append(items)
                # the first draft names the notebook; the rewrite does not
                text = ('I examined the body and found a notebook in his pocket.' if len(prompts) == 1
                        else 'Mrs Finch fetched me at about twenty to seven, and I examined the body.')
                return {'accounts': {i['id']: text for i in items}}
            items = items['accounts'] if isinstance(items, dict) else items
            if system == publish.LEAK:
                return {'verdicts': {i['id']: {'leaks': False} for i in items}}
            return {'verdicts': {i['id']: {'v': 'honest'} for i in items}}
        refine.llm_json = fake
        publish.add_morning_accounts(case)
        iris = [i for i in prompts[0] if i['id'] == 'iris'][0]
        self.assertFalse(any('notebook' in m for m in iris['morning']), iris['morning'])
        told = next(x['text'] for x in case['signs'] if x.get('id') == 's_morning_iris')
        self.assertNotIn('notebook', told)
        self.assertIn('yet to find', json.dumps(prompts[1]))

    def test_reactions_cover_a_records_keeper_and_anyone_it_names(self):
        case = load(PEARLS)
        for x in case['signs']:
            x.pop('reactions', None)
        pairs = {(x['id'], pid) for x, pid in publish.involved_pairs(case)}
        self.assertIn(('s_docket', 'dora'), pairs, 'the postmistress and her own exchange docket')
        self.assertIn(('s_regbook', 'ada'), pairs, 'a record that names her')

    def test_every_claimless_account_is_judged(self):
        case = load(PEARLS)
        for x in case['signs']:
            x.pop('surface_checked', None)
        judged = []

        def fake(system, prompt, *a, **k):
            items = json.loads(prompt)
            items = items['accounts'] if isinstance(items, dict) else items
            judged.extend(i['id'] for i in items)
            return {'verdicts': {i['id']: {'v': 'cover' if i['id'] == 's_clara_test' else 'honest'} for i in items}}
        refine.llm_json = fake
        publish.mark_surface_truth(case)
        self.assertIn('s_clara_test', judged)
        self.assertTrue(next(x for x in case['signs'] if x['id'] == 's_clara_test')['deceptive'])
        self.assertFalse(any(x.get('sighting') for x in case['signs'] if x['id'] in judged))


class ParallelWording(unittest.TestCase):
    def test_phases_run_on_copies_and_their_changes_merge(self):
        case = {'signs': [{'id': 'a', 'text': 'x'}, {'id': 'b', 'text': 'y'}], 'moods': {}}

        def adds_front(c):
            c['signs'].insert(0, {'id': 's_surface_p', 'text': 'evening'})

        def sets_show(c):
            c['signs'][1]['show'] = 'shown'

        def drops_b_reaction_and_sets_moods(c):
            c['moods'] = {'p': 'calm'}
            c['signs'] = [x for x in c['signs'] if x['id'] != 'a']

        publish.parallel_phases(case, [adds_front, sets_show, drops_b_reaction_and_sets_moods], log=lambda *_: None)
        self.assertEqual([x['id'] for x in case['signs']], ['s_surface_p', 'b'])
        self.assertEqual(case['signs'][1]['show'], 'shown')
        self.assertEqual(case['moods'], {'p': 'calm'})


if __name__ == '__main__':
    unittest.main()
