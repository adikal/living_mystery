import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import publish  # noqa: E402
import refine  # noqa: E402


class Questions(unittest.TestCase):
    def setUp(self):
        self.saved = refine.llm_json

    def tearDown(self):
        refine.llm_json = self.saved

    @staticmethod
    def case(*signs):
        return {'signs': [
            {'id': sid, 'kind': 'testimony', 'speaker': speaker, 'ask': ask, **extra}
            for sid, speaker, ask, extra in signs
        ]}

    def test_deterministic_night_wording_is_aliased_without_model_judgment(self):
        case = self.case(
            ('t_where', 'vera', 'Where were you last night?', {}),
            ('t_spend', 'vicar', 'Reverend, how did you spend last evening?', {}),
            ('t_other', 'vera', 'What was the quarrel at the boathouse about?', {}),
        )
        refine.llm_json = lambda *args, **kwargs: {'duplicates': {}}
        self.assertEqual(publish.mark_duplicate_questions(case), 2)
        aliases = {sign['id']: sign.get('same_as') for sign in case['signs']}
        self.assertEqual(aliases['t_where'], 'night')
        self.assertEqual(aliases['t_spend'], 'night')
        self.assertIsNone(aliases['t_other'])
        self.assertEqual(publish.question_alias_errors(case), [])

    def test_model_groups_residual_rewording_and_unknown_ids_are_ignored(self):
        case = self.case(
            ('t_first', 'vera', 'What caused the argument by the river?', {}),
            ('t_second', 'vera', 'Why did you quarrel beside the water?', {}),
        )
        seen = []

        def fake(system, prompt, *args, **kwargs):
            items = json.loads(prompt)
            seen.append(items)
            return {'duplicates': {'vera': [['t_first', 't_second'], ['t_first', 'missing']]}}

        refine.llm_json = fake
        self.assertEqual(publish.mark_duplicate_questions(case), 1)
        self.assertEqual(case['signs'][1]['same_as'], 't_first')
        self.assertTrue(any(item['id'] == 'std0' for item in seen[0]['vera']))

    def test_model_failure_preserves_prior_alias_and_still_marks_obvious_duplicate(self):
        case = self.case(
            ('t_where', 'vera', 'Where were you last night?', {}),
            ('t_prior', 'vera', 'Why were you carrying the parcel?', {'same_as': 't_where'}),
        )

        def boom(*args, **kwargs):
            raise RuntimeError('model down')

        refine.llm_json = boom
        self.assertEqual(publish.mark_duplicate_questions(case), 2)
        self.assertEqual(case['signs'][0]['same_as'], 'night')
        self.assertEqual(case['signs'][1]['same_as'], 't_where')
        self.assertEqual(publish.question_alias_errors(case), [])

    def test_only_plain_whereabouts_questions_are_aliased_to_night(self):
        names = ['Vera Lacey', 'Mrs Lacey']
        for ask in ('Where were you last night, Mrs Lacey?', 'Tell me, Mrs Lacey, what did you do last night?',
                    'Where exactly were you last evening?'):
            self.assertTrue(publish.is_plain_night_question(ask, names), ask)
        for ask in ('What did you do with the key after supper last night?', 'Where were you when the bell rang last night?',
                    'Where were you last night after supper?', 'Did you see anyone last night?'):
            self.assertFalse(publish.is_plain_night_question(ask, names), ask)

    def test_a_successful_judge_drops_an_alias_it_no_longer_confirms(self):
        case = self.case(('t_first', 'vera', 'What caused the argument by the river?', {}),
                         ('t_second', 'vera', 'Who rowed the boat back?', {'same_as': 't_first'}))
        refine.llm_json = lambda *args, **kwargs: {'duplicates': {}}
        self.assertEqual(publish.mark_duplicate_questions(case), 0)
        self.assertNotIn('same_as', case['signs'][1])

    def test_judge_groups_are_kept_within_a_speaker_and_to_delivering_targets(self):
        case = self.case(('t_vera', 'vera', 'Did you notice anyone in the lane?', {}),
                         ('t_jonah', 'jonah', 'Did you notice anyone in the lane?', {}))
        refine.llm_json = lambda *args, **kwargs: {'duplicates': {'vera': [['std2', 't_vera'], ['t_vera', 't_jonah']]}}
        publish.mark_duplicate_questions(case)   # std2 is the sightings question, and t_jonah is another speaker's
        self.assertNotIn('same_as', case['signs'][0])
        self.assertNotIn('same_as', case['signs'][1])

    def test_network_free_repair_keeps_valid_aliases_and_drops_invalid_ones(self):
        case = self.case(('t_where', 'vera', 'Where were you last night?', {}),
                         ('t_kept', 'vera', 'Why were you carrying the parcel?', {'same_as': 't_where'}),
                         ('t_bad', 'vera', 'Did you notice anyone?', {'same_as': 'seen'}))
        refine.llm_json = lambda *args, **kwargs: self.fail('repair must not call the model')
        publish.mark_duplicate_questions(case, judge=False)
        aliases = {sign['id']: sign.get('same_as') for sign in case['signs']}
        self.assertEqual(aliases, {'t_where': 'night', 't_kept': 't_where', 't_bad': None})
        self.assertEqual(publish.question_alias_errors(case), [])

    def test_exact_same_speaker_wording_is_deterministic(self):
        case = self.case(
            ('t_first', 'iris', 'What time did you leave the surgery?', {}),
            ('t_second', 'iris', 'What time did you leave the surgery?', {}),
        )
        refine.llm_json = lambda *args, **kwargs: {'duplicates': {}}
        publish.mark_duplicate_questions(case)
        self.assertNotIn('same_as', case['signs'][0])
        self.assertEqual(case['signs'][1]['same_as'], 't_first')

    def test_publication_errors_cover_missing_undeliverable_and_cyclic_aliases(self):
        missing = self.case(('t_where', 'vera', 'Where were you last night?', {}))
        self.assertIn('question t_where duplicates night but is not aliased to it', publish.question_alias_errors(missing))

        unknown = self.case(('t_one', 'vera', 'What was in the parcel?', {'same_as': 'absent'}))
        self.assertIn('question t_one aliases absent, which does not deliver it', publish.question_alias_errors(unknown))

        for target in ('seen', 'morning', 'news', 'case'):   # these questions deliver only their own kind of account
            wrong = self.case(('t_one', 'vera', 'Did you notice anyone by the lane?', {'same_as': target}))
            self.assertIn(f'question t_one aliases {target}, which does not deliver it', publish.question_alias_errors(wrong))

        cross = self.case(('t_one', 'vera', 'What was in the parcel?', {'same_as': 't_two'}),
                          ('t_two', 'jonah', 'What was in the parcel?', {}))
        self.assertIn('question t_one aliases t_two, which does not deliver it', publish.question_alias_errors(cross))

        cyclic = self.case(
            ('t_one', 'vera', 'What was in the parcel?', {'same_as': 't_two'}),
            ('t_two', 'vera', 'Why did it matter?', {'same_as': 't_one'}),
        )
        errors = publish.question_alias_errors(cyclic)
        self.assertTrue(any('question alias cycle' in error for error in errors))


if __name__ == '__main__':
    unittest.main()
