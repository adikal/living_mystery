"""Scorecard and report on synthetic episodes (no model calls)."""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import report  # noqa: E402
import score  # noqa: E402


def step(action, news=(), error=None, place='square'):
    return {'action': action, 'thinking': '', 'error': error, 'news': list(news), 'inventory': [], 'place': place, 'time': 'Day 2 · 08:00'}


def trace(held, remaining, **extra):
    return {'kind': 'ask', 'held': held, 'read': 0, 'status': {'remaining': remaining}, 'new_evidence': [], 'witnessed': [], **extra}


def episode(n_stall=14, solved=True):
    steps, tr = [], []
    for i in range(n_stall):                           # a long stretch learning nothing
        steps.append(step({'type': 'ask', 'person': 'ada', 'question': 'q1'}))
        tr.append(trace(1, ['a', 'b', 'c']))
    steps.append(step({'type': 'say', 'person': 'ada', 'text': 'Where were you?'}, [{'speaker': 'Ada', 'text': 'I can’t help you with that.'}]))
    tr.append(trace(1, ['a', 'b', 'c'], character={'person': 'ada', 'by': 'ai', 'neutral': True, 'rejected': 2, 'text': 'Where were you?'}))
    steps.append(step({'type': 'accuse', 'suspect': 'a'}))
    tr.append(trace(3, ['a'], accusation={'suspect': 'a', 'accepted': solved}))
    return {'id': 'case__amateur__literal__s1', 'case': 'dist/x/case.json', 'profile': 'amateur', 'temperament': 'literal', 'seed': 1,
            'outcome': 'solved' if solved else 'out_of_budget', 'steps': steps, 'diary': [], 'questionnaire': {}, 'failure': None,
            'report': {'truth': 'a', 'start_minute': 1920, 'end_minute': 2040, 'trace': tr}}


class Scorecard(unittest.TestCase):
    def test_metrics_and_problems(self):
        c = score.score(episode())
        m = c['metrics']
        self.assertTrue(m['solved'] and m['correct'])
        self.assertGreaterEqual(m['longest_stall'], score.STALL)
        self.assertEqual(m['neutral_replies'], 1)
        self.assertEqual(m['loops'], 1, 'the same question fourteen times')
        kinds = {p['kind'] for p in c['problems']}
        self.assertTrue({'stall', 'loop', 'stonewall'} <= kinds, kinds)

    def test_a_failed_episode_is_a_harness_bug(self):
        c = score.score({'id': 'x', 'failure': 'Traceback ...', 'steps': [], 'report': None})
        self.assertTrue(c['failed'])
        self.assertEqual(c['problems'][0]['layer'], 'harness')

    def test_paired_comparison(self):
        with tempfile.TemporaryDirectory() as before, tempfile.TemporaryDirectory() as after:
            json.dump([score.score(episode(14))], open(os.path.join(before, 'scores.json'), 'w'))
            json.dump([score.score(episode(2))], open(os.path.join(after, 'scores.json'), 'w'))
            cmp = report.compare(report.load(after), report.load(before))
            self.assertEqual(cmp['pairs'], 1)
            self.assertLess(cmp['deltas']['longest_stall'][0], 0, 'the stall got shorter')


if __name__ == '__main__':
    unittest.main()
