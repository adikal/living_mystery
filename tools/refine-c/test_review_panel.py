"""The whole-case review as a panel of narrow reviewers, each asked twice at once; every issue any of them finds counts."""
import json
import os
import sys
import threading
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import publish  # noqa: E402
import refine  # noqa: E402

CASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'dist', 'cases', 'archive', '2026-10', 'mk-live-20261025-114526.json')


class Panel(unittest.TestCase):
    def test_each_lens_asks_only_its_checks_and_together_they_ask_all(self):
        asked = set()
        for _, checks in publish.REVIEW_LENSES:
            p = publish.lens_prompt(checks)
            bullets = {l[2:].split(':', 1)[0] for l in p.split('\n') if l.startswith('- ')}
            self.assertEqual(bullets, set(checks))
            self.assertIn('1320 means 22:00', p)                       # the shared preamble
            self.assertIn('stylistic or taste concerns must pass', p)  # and the bar for an issue
            self.assertTrue(p.rstrip().endswith('"issues":["<id>: <CHECK>: <problem>", ...]}'))
            asked |= bullets
        self.assertEqual(asked, set(publish.PUBLICATION_REVIEW_CHECKS))

    def run_panel(self, answer):
        calls, lock = [], threading.Lock()
        def fake(system, user, max_tokens=9000, model=None, schema=None, **kw):
            with lock:
                calls.append((kw.get('audit_metadata') or {}).get('purpose'))
            return refine.LLMJSONResponse(answer(system, len(calls)), model, (f'r{len(calls)}',))
        with mock.patch.object(refine, 'llm_json_audited', side_effect=fake):
            out = publish.publication_critic(json.load(open(CASE)))
        return out, calls

    def test_an_issue_one_vote_finds_fails_the_case(self):
        def answer(system, n):
            if 'only for CONTRADICTION' in system and n % 2:
                return {'verdict': 'fail', 'issues': ['s_doorstop: CONTRADICTION: the hound never leaves her room']}
            return {'verdict': 'pass', 'issues': []}
        out, calls = self.run_panel(answer)
        self.assertEqual(len(calls), len(publish.REVIEW_LENSES) * publish.REVIEW_VOTES)
        self.assertEqual(sorted(set(calls)), sorted(f'whole-case-review:{l}' for l, _ in publish.REVIEW_LENSES))
        self.assertIs(out.status, refine.CriticStatus.FAIL)
        self.assertEqual(out.issues, ('s_doorstop: CONTRADICTION: the hound never leaves her room',))

    def test_all_pass_is_a_pass_and_one_unavailable_is_not(self):
        out, _ = self.run_panel(lambda system, n: {'verdict': 'pass', 'issues': []})
        self.assertIs(out.status, refine.CriticStatus.PASS)
        out, _ = self.run_panel(lambda system, n: {'verdict': 'pass', 'issues': []} if 'only for CRAFT' not in system else {'nonsense': 1})
        self.assertIs(out.status, refine.CriticStatus.UNAVAILABLE)

    def test_the_same_issue_from_two_votes_is_kept_once(self):
        a = refine.CriticOutcome(refine.CriticStatus.FAIL, ('s_x: LOCK: one',), {}, ())
        b = refine.CriticOutcome(refine.CriticStatus.FAIL, ('s_x: lock: the same, worded otherwise', 's_y: LOCK: two'), {}, ())
        self.assertEqual(publish.combine_reviews([a, b], ['a', 'b']).issues, ('s_x: LOCK: one', 's_y: LOCK: two'))

    def test_the_author_summary_is_not_shown_to_reviewers(self):
        case = json.load(open(CASE))
        case['story'] = 'Clara killed her nephew with the iron hound.'
        self.assertNotIn('story', publish._publication_prompt_case(case))
        self.assertNotEqual(publish.publication_candidate_sha256(case), publish.publication_candidate_sha256({**case, 'story': 'x'}))


if __name__ == '__main__':
    unittest.main()
