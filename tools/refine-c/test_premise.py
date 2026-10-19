"""The premise deck: rotation, scene/method fit, and the seed check."""
import concurrent.futures as cf
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import premise as P


class Deck(unittest.TestCase):
    def test_draws_are_valid_and_rotate(self):
        hist, seen = [], {'victim': set(), 'culprit': set(), 'method': set(), 'motive': set()}
        for i in range(12):
            p = P.draw(seed=i, history=hist)
            self.assertNotIn(p['victim'], P.HELPERS); self.assertNotIn(p['culprit'], P.HELPERS)
            self.assertNotEqual(p['victim'], p['culprit'])
            self.assertIn(p['culprit'], p['suspects']); self.assertEqual(len(p['suspects']), 4); self.assertNotIn(p['victim'], p['suspects'])
            self.assertIn(p['place'], P.METHOD_PLACES[p['method']])
            hist.append(p)
            for k in seen: seen[k].add(p[k])
        # twelve draws cover most options: no favourite story
        self.assertGreaterEqual(len(seen['victim']), 8); self.assertGreaterEqual(len(seen['method']), 9)
        self.assertEqual(len(seen['motive']), 8); self.assertGreaterEqual(len(seen['culprit']), 8)

    def test_remember_is_atomic_locked_and_recovery_idempotent(self):
        base = {'victim': 'ada', 'culprit': 'hugo', 'method': 'blow', 'motive': 'money',
                'place': 'manor', 'shape': 'two_liars'}
        other = {**base, 'victim': 'clara', 'culprit': 'jonah', 'method': 'poison'}
        with tempfile.TemporaryDirectory() as root:
            history = Path(root, 'runs', 'premise-history.json')
            publication_root = Path(root, 'published')
            with mock.patch.object(P, 'HISTORY', str(history)), \
                    mock.patch.object(P, 'PUBLICATION_ROOT', str(publication_root)):
                with cf.ThreadPoolExecutor(2) as executor:
                    list(executor.map(lambda item: P.remember(*item),
                                      [(base, 'publication-a'), (other, 'publication-b')]))
                self.assertFalse(P.remember(base, publication_id='publication-a'))
            saved = json.loads(history.read_text(encoding='utf-8'))
        self.assertEqual({item['publication_id'] for item in saved}, {'publication-a', 'publication-b'})
        self.assertEqual(len(saved), 2)

    def test_idempotency_scans_the_whole_history(self):
        base = {'victim': 'ada', 'culprit': 'hugo', 'method': 'blow', 'motive': 'money',
                'place': 'manor', 'shape': 'two_liars'}
        with tempfile.TemporaryDirectory() as root:
            history = Path(root, 'premise-history.json')
            with mock.patch.object(P, 'HISTORY', str(history)), \
                    mock.patch.object(P, 'PUBLICATION_ROOT', str(Path(root, 'published'))):
                self.assertTrue(P.remember(base, publication_id='oldest'))
                for number in range(P.RECENT + 5):
                    P.remember(base, publication_id=f'later-{number}')
                self.assertFalse(P.remember(base, publication_id='oldest'), 'an old publication id is still known')
            saved = json.loads(history.read_text(encoding='utf-8'))
        self.assertEqual(len(saved), P.RECENT + 6)
        self.assertEqual([row['publication_id'] for row in saved].count('oldest'), 1)

    def test_draw_rotates_against_the_recent_window_only(self):
        old = [{'victim': 'ada', 'culprit': 'hugo', 'method': 'blow', 'motive': 'money', 'place': 'manor',
                'shape': 'two_liars'}] * 5
        recent = [P.draw(seed=i, history=[]) for i in range(P.RECENT)]
        self.assertEqual(P.draw(seed=7, history=old + recent), P.draw(seed=7, history=recent))

    def test_corrupt_history_is_not_silently_treated_as_empty(self):
        with tempfile.TemporaryDirectory() as root:
            history = Path(root, 'premise-history.json')
            for content in ('{not json', '{"a": 1}'):
                history.write_text(content, encoding='utf-8')
                with self.subTest(content=content), mock.patch.object(P, 'HISTORY', str(history)):
                    with self.assertRaisesRegex(ValueError, 'corrupt.*To recover.*move it aside'):
                        P._history()

    def test_seed_check(self):
        p = {'victim': 'dora', 'culprit': 'hugo', 'suspects': ['ada', 'clara', 'hugo', 'jonah'], 'bystanders': [],
             'method': 'drown', 'motive': 'blackmail', 'place': 'mill', 'shape': 'two_liars'}
        case = {'victim': 'dora', 'question': {'truth': 'h', 'crime': {'event': 'e', 'place': 'mill'},
                'candidates': [{'id': 'h', 'facts': {'actor': 'hugo'}}] + [{'id': a, 'facts': {'actor': a}} for a in ('ada', 'clara', 'jonah')]},
                'events': [{'id': 'e', 'agent': 'hugo', 'facts': {'method': 'drown'}, 'causedBy': 'a2'}, {'id': 'd', 'type': 'death', 'agent': 'dora', 'start': 1500, 'end': 1505},
                           {'id': 'f', 'type': 'discovery', 'agent': 'jonah', 'start': 1800, 'end': 1805},
                           {'id': 'x', 'type': 'examination', 'agent': 'iris', 'start': 1830, 'end': 1850}],
                'attitudes': [{'id': 'a2', 'because': ['a1']}, {'id': 'a1', 'motive': 'blackmail'}]}
        self.assertEqual(P.seed_errors(case, p), [])
        case['events'][0]['facts'] = {'method': 'poison'}
        case['question']['candidates'].pop()
        errs = P.seed_errors(case, p)
        self.assertTrue(any('method' in e for e in errs)); self.assertTrue(any('candidates' in e for e in errs))
        case['events'] = [e for e in case['events'] if e.get('type') != 'examination']
        self.assertTrue(any('examination' in e for e in P.seed_errors(case, p)), 'the examination is required')


if __name__ == '__main__':
    unittest.main()
