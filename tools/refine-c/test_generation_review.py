"""Hermetic tests for generation plausibility review and candidate selection (no model calls)."""
import copy
import os
import tempfile
import time
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
import sys
sys.path.insert(0, HERE)

import refine
from test_refine import base


def bedrock_reply(payload, request_id='request-1'):
    return {
        'usage': {'inputTokens': 1, 'outputTokens': 1},
        'output': {'message': {'content': [{'toolUse': {'input': payload}}]}},
        'ResponseMetadata': {'RequestId': request_id},
    }


def bedrock_text(text, request_id='request-1'):
    return {
        'usage': {'inputTokens': 1, 'outputTokens': 1},
        'output': {'message': {'content': [{'text': text}]}},
        'ResponseMetadata': {'RequestId': request_id},
    }


class FakeClient:
    def __init__(self, *results):
        self.results = list(results)
        self.calls = []

    def converse(self, **kwargs):
        self.calls.append(kwargs)
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def patch(story='candidate'):
    return {'story': story, 'operator': 'Conceal', 'blocks': [],
            'add': {'attitudes': [{'id': f'a_{story}', 'agent': 'tom', 'mode': 'knows', 'content': story}]},
            'modify': {'signs': {'s_wife': {'title': story}}}}


class CriticOutcomes(unittest.TestCase):
    def setUp(self):
        refine.FORCED_OK.clear()
        refine.USAGE.update({'in': 0, 'out': 0, 'calls': 0})

    def review(self, *results):
        refine._client = FakeClient(*results)
        return refine.critic(base(), patch())

    def test_valid_pass(self):
        out = self.review(bedrock_reply({'verdict': 'pass', 'issues': []}, 'pass-request'))
        self.assertEqual(out.status, refine.CriticStatus.PASS)
        self.assertEqual(out.issues, ())
        self.assertEqual(out.request_ids, ('pass-request',))
        self.assertEqual(out.history()['raw_response'], {'verdict': 'pass', 'issues': []})
        self.assertEqual(len(out.attempts), 1)

    def test_actionable_fail(self):
        issue = 's_wife: CHARACTER: align the action with the stated motive'
        out = self.review(bedrock_reply({'verdict': 'fail', 'issues': [issue, '  ']}))
        self.assertEqual(out.status, refine.CriticStatus.FAIL)
        self.assertEqual(out.issues, (issue,))
        accepted, feedback = refine.critic_feedback(out)
        self.assertFalse(accepted)
        self.assertEqual(feedback, ['plausibility review: ' + issue])

    def test_malformed_output_is_unavailable(self):
        out = self.review(bedrock_reply(['not', 'an', 'object']))
        self.assertEqual(out.status, refine.CriticStatus.UNAVAILABLE)
        self.assertEqual(len(out.attempts), 1)

    def test_malformed_free_form_response_retains_audit_evidence(self):
        out = self.review(bedrock_text('definitely not json', 'malformed-request'))
        self.assertEqual(out.status, refine.CriticStatus.UNAVAILABLE)
        self.assertEqual(out.raw_response, 'definitely not json')
        self.assertEqual(out.request_ids, ('malformed-request',))
        self.assertEqual(out.attempts[0].request_ids, ('malformed-request',))

    def test_unknown_verdict_is_unavailable(self):
        out = self.review(bedrock_reply({'verdict': 'maybe', 'issues': []}))
        self.assertEqual(out.status, refine.CriticStatus.UNAVAILABLE)

    def test_pass_with_issues_is_contradictory_and_unavailable(self):
        out = self.review(bedrock_reply({'verdict': 'pass', 'issues': ['s_wife: LOCK: change it']}))
        self.assertEqual(out.status, refine.CriticStatus.UNAVAILABLE)

    def test_two_reasonless_fails_are_unavailable(self):
        out = self.review(bedrock_reply({'verdict': 'fail', 'issues': []}, 'first'),
                          bedrock_reply({'verdict': 'fail', 'issues': ['  ']}, 'second'))
        self.assertEqual(out.status, refine.CriticStatus.UNAVAILABLE)
        self.assertEqual(len(out.attempts), 2)
        self.assertEqual(out.request_ids, ('first', 'second'))
        self.assertEqual([a.raw_response for a in out.attempts],
                         [{'verdict': 'fail', 'issues': []}, {'verdict': 'fail', 'issues': ['  ']}])

    def test_exception_is_unavailable(self):
        out = self.review(RuntimeError('provider down'))
        self.assertEqual(out.status, refine.CriticStatus.UNAVAILABLE)
        self.assertEqual(len(out.attempts), 1)
        self.assertIn('RuntimeError', out.attempts[0].error)
        accepted, feedback = refine.critic_feedback(out)
        self.assertFalse(accepted)
        self.assertEqual(feedback, [refine.CRITIC_UNAVAILABLE_REASON])

    def test_forced_tool_fallback_retains_both_request_ids(self):
        unsupported = RuntimeError('tool_choice is not supported')
        unsupported.response = {'ResponseMetadata': {'RequestId': 'forced-request'}}
        out = self.review(unsupported, bedrock_reply({'verdict': 'pass', 'issues': []}, 'automatic-request'))
        self.assertEqual(out.status, refine.CriticStatus.PASS)
        self.assertEqual(out.request_ids, ('forced-request', 'automatic-request'))
        self.assertEqual(out.attempts[0].request_ids, out.request_ids)
        self.assertEqual(len(refine._client.calls), 2)


class CandidateSelection(unittest.TestCase):
    def setUp(self):
        refine.FORCED_OK.clear()
        self.models = refine.DRAFT_MODELS
        refine.DRAFT_MODELS = (refine.MODEL, refine.CRITIC_MODEL)   # two draft models, so siblings differ by model

    def tearDown(self):
        refine.DRAFT_MODELS = self.models

    def generate_case(self, review_for, generation_for=None):
        initial = base()
        generation_for = generation_for or (lambda user, model: patch(model.rsplit('.', 1)[-1]))

        def seed_json(*args, **kwargs):
            return copy.deepcopy(initial)

        def generation_json(system, user, max_tokens=9000, model=None, schema=None, **kwargs):
            value = generation_for(user, model)
            return refine.LLMJSONResponse(value, model, (f'generation-{value["story"]}',))

        with tempfile.TemporaryDirectory() as outdir, \
                mock.patch.object(refine, 'llm_json', side_effect=seed_json), \
                mock.patch.object(refine, 'llm_json_audited', side_effect=generation_json), \
                mock.patch.object(refine, 'critic', side_effect=review_for), \
                mock.patch.object(refine, 'schedule', return_value=('refine', 's_wife', 'Conceal', 'h_wife', 0)), \
                mock.patch.object(refine, 'step_laws', return_value=[]):
            result = refine.run_case('test', 'brief', 1, 5, outdir, lambda _: None)
        return initial, result

    def test_unavailable_sibling_cannot_win_but_pass_can(self):
        def generate(user, model):
            story = 'unavailable' if model == refine.MODEL else 'passing'
            if story == 'passing':
                time.sleep(0.03)  # ensure the unavailable sibling is processed first
            return patch(story)

        def review(case, candidate_patch):
            story = candidate_patch['story']
            status = refine.CriticStatus.PASS if story == 'passing' else refine.CriticStatus.UNAVAILABLE
            attempt = refine.CriticAttempt({'verdict': status.value.lower(), 'issues': []}, (f'critic-{story}',))
            return refine.CriticOutcome(status, (), attempt.raw_response, (attempt,), attempt.request_ids)

        _, result = self.generate_case(review, generate)
        step = result['history'][0]
        self.assertTrue(step['accepted'])
        self.assertEqual(step['story'], 'passing')
        # drafts alternate between the two models: the story model's are unavailable, the other's passes and is chosen
        statuses = sorted(c['status'] for c in step['candidates'])
        self.assertEqual(statuses, ['PASS'] + ['UNAVAILABLE'] * (refine.CANDIDATES - 1))
        self.assertEqual([c['status'] for c in step['candidates'] if c['selected']], ['PASS'])
        self.assertIn(['critic-unavailable'], [c['request_ids'] for c in step['critic']])
        self.assertTrue(all('generation_request_ids' in c for c in step['candidates']))

    def test_unavailable_rounds_leave_case_unchanged(self):
        def review(case, candidate_patch):
            attempt = refine.CriticAttempt({'error': 'unavailable'})
            return refine.CriticOutcome(refine.CriticStatus.UNAVAILABLE, (), attempt.raw_response, (attempt,))

        initial, result = self.generate_case(review)
        step = result['history'][0]
        self.assertFalse(step['accepted'])
        self.assertEqual(result['case'], initial)
        self.assertEqual(len(step['attempts']), 2 * refine.CANDIDATES)   # every draft of both rounds
        self.assertTrue(all(errors == [refine.CRITIC_UNAVAILABLE_REASON] for errors in step['attempts']))
        self.assertEqual(result['generation_review']['status'], 'NOT_REVIEWED')
        self.assertFalse(result['generation_review']['final_whole_case_reviewed'])

    def test_a_rejected_draft_is_revised_in_the_same_round_with_its_own_patch(self):
        prompts = []

        def generate(user, model):
            prompts.append(user)
            return patch('revised' if 'THAT PATCH' in user else 'slip')

        def review(case, candidate_patch):
            ok = candidate_patch['story'] == 'revised'
            status = refine.CriticStatus.PASS if ok else refine.CriticStatus.FAIL
            issues = () if ok else ("s_wife: CONTRADICTION: the reading still names the old place",)
            attempt = refine.CriticAttempt({'verdict': status.value.lower(), 'issues': list(issues)})
            return refine.CriticOutcome(status, issues, attempt.raw_response, (attempt,))

        _, result = self.generate_case(review, generate)
        step = result['history'][0]
        self.assertTrue(step['accepted'])
        self.assertEqual(step['story'], 'revised')
        chosen = [c['candidate_id'] for c in step['candidates'] if c['selected']]
        self.assertTrue(chosen[0].endswith('r') and chosen[0].startswith('1.1.'), chosen)   # round 1, a revision
        revision = next(p for p in prompts if 'THAT PATCH' in p)
        self.assertIn('the reading still names the old place', revision)
        self.assertIn('"story":"slip"', revision)

    def test_passing_drafts_for_different_targets_are_stacked_and_recorded(self):
        real = refine.certify

        def deeper(case, *a, **k):   # the toy case's depth: one layer for each sign a draft has deepened
            rep = real(case, *a, **k)
            n = sum(1 for x in case['signs'] if str(x.get('title', '')).startswith('deep'))
            return {**rep, 'solve_depth': n, 'threads': {**(rep.get('threads') or {}), 'h_wife': n}}

        def generate(user, model):
            target = 's_cox' if "REFINE sign 's_cox'" in user else 's_wife'
            p = patch(f'deep-{target}')
            p['modify'] = {'signs': {target: {'title': f'deep-{target}'}}}
            return p

        def review(case, candidate_patch):
            attempt = refine.CriticAttempt({'verdict': 'pass', 'issues': []})
            return refine.CriticOutcome(refine.CriticStatus.PASS, (), attempt.raw_response, (attempt,))

        options = [('refine', 's_wife', 'Conceal', 'h_wife', 0), ('refine', 's_cox', 'Fragment', 'h_wife', 0)]
        initial = base()
        with tempfile.TemporaryDirectory() as outdir, \
                mock.patch.object(refine, 'llm_json', side_effect=lambda *a, **k: copy.deepcopy(initial)), \
                mock.patch.object(refine, 'llm_json_audited', side_effect=lambda system, user, mt=9000, model=None, schema=None, **k:
                                  refine.LLMJSONResponse(generate(user, model), model, ('g',))), \
                mock.patch.object(refine, 'critic', side_effect=review), \
                mock.patch.object(refine, 'certify', side_effect=deeper), \
                mock.patch.object(refine, 'schedule', return_value=options[0]), \
                mock.patch.object(refine, 'schedule_options', return_value=options), \
                mock.patch.object(refine, 'step_laws', return_value=[]):
            result = refine.run_case('test', 'brief', 1, 5, outdir, lambda _: None)
        step = result['history'][0]
        self.assertTrue(step['accepted'])
        self.assertEqual(len(step['stacked']), 1)
        self.assertEqual(step['stacked'][0]['story'].split('-')[0], 'deep')
        self.assertIsNotNone(step['stacked'][0]['critic'])
        titles = {x['id']: x.get('title') for x in result['case']['signs']}
        self.assertEqual((titles['s_wife'], titles['s_cox']), ('deep-s_wife', 'deep-s_cox'))   # both applied


if __name__ == '__main__':
    unittest.main()
