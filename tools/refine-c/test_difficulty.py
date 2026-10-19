"""Tests for difficulty.py: features come from the certifier, the model is monotone, bands and fitting behave."""
import json
import os
import random
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import difficulty as D  # noqa: E402

FIXTURE = os.path.join(HERE, '..', '..', 'tests', 'fixtures', 'mk-rook.json')


class Difficulty(unittest.TestCase):
    def setUp(self):
        with open(FIXTURE, encoding='utf-8') as source:
            self.case = json.load(source)
        self.model = D.load_model()

    def test_features_from_the_certifier(self):
        f = D.features(self.case)
        self.assertEqual(set(f), set(D.FEATURES))
        self.assertTrue(all(isinstance(v, int) and v >= 0 for v in f.values()))
        self.assertGreaterEqual(f['depth'], 1)

    def test_rate_is_stable_and_banded(self):
        a, b = D.rate(self.case, model=self.model), D.rate(self.case, model=self.model)
        self.assertEqual(a, b)
        self.assertIn(a['level'], [name for _, name in self.model['bands']])

    def test_harder_features_never_score_lower(self):
        base = D.features(self.case)
        for k, w in self.model['weights'].items():
            more = {**base, k: base[k] + 1}
            cmp = self.assertGreaterEqual if w >= 0 else self.assertLessEqual
            cmp(D.score(more, self.model), D.score(base, self.model), k)

    def test_bands(self):
        m = {'bands': [[6.5, 'easy'], [8.0, 'medium'], [None, 'hard']]}
        self.assertEqual([D.level(s, m) for s in (3, 6.5, 7.9, 8.0, 20)], ['easy', 'medium', 'medium', 'hard', 'hard'])

    def test_logistic_fit_recovers_direction(self):
        rnd = random.Random(1)
        X, y = [], []
        for _ in range(200):   # synthetic plays: deeper cases are solved cleanly less often
            depth = rnd.randint(2, 8)
            X.append([depth, rnd.randint(0, 2), 0, 0, 0, 0])
            y.append(1.0 if rnd.random() < 1 / (1 + 2.718 ** (depth - 5)) else 0.0)
        bias, w = D.fit_logistic(X, y)
        self.assertLess(w[0], 0, 'depth lowers the chance of a clean solve')
        model = {'kind': 'logistic', 'bias': bias, 'weights': dict(zip(D.FEATURES, w))}
        easy, hard = dict(zip(D.FEATURES, [2, 0, 0, 0, 0, 0])), dict(zip(D.FEATURES, [8, 0, 0, 0, 0, 0]))
        self.assertLess(D.score(easy, model), D.score(hard, model))

    def test_rate_all_preserves_target_in_case_and_index(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            case_path = base / 'case.json'
            index_path = base / 'index.json'
            case_path.write_text(json.dumps({'difficulty': {'target': 'hard'}}), encoding='utf-8')
            index_path.write_text(json.dumps([{'id': 'case', 'file': 'case.json',
                                              'difficulty': {'level': 'easy', 'score': 0.1, 'target': 'hard'}}]),
                                  encoding='utf-8')
            fresh = {'v': 2, 'score': 0.75, 'level': 'medium', 'features': {'depth': 3}}
            with mock.patch.object(D, 'published', return_value=[(str(index_path), str(base))]), \
                    mock.patch.object(D, 'load_model', return_value={'v': 2}), \
                    mock.patch.object(D, 'rate', return_value=fresh):
                D.rate_all(log=lambda *_: None)
            saved_case = json.loads(case_path.read_text(encoding='utf-8'))
            saved_index = json.loads(index_path.read_text(encoding='utf-8'))
        self.assertEqual(saved_case['difficulty'], {**fresh, 'target': 'hard'})
        self.assertEqual(saved_index[0]['difficulty'], {'level': 'medium', 'score': 0.75, 'target': 'hard'})

    def test_rate_with_target_omits_absent_target(self):
        with mock.patch.object(D, 'rate', return_value={'v': 1, 'score': 0.2, 'level': 'easy', 'features': {}}):
            self.assertNotIn('target', D.rate_with_target({}))

    def test_targets_by_level(self):
        from refine import certify
        r = certify(self.case)
        self.assertEqual(D.targets_met(self.case, r, D.target('easy')), [], 'a deeper case meets the easy minimums')
        hard = D.targets_met(self.case, r, D.target('hard'))
        self.assertTrue(any('solve depth' in x for x in hard), hard)
        self.assertEqual(D.target('nonsense')['level'], 'medium')
        levels = self.model['levels']
        depths = [D.target(l)['depth'] for l in levels]
        self.assertEqual(depths, sorted(depths), 'harder levels ask for more depth')
        self.assertTrue(all(D.target(l)['seconds'] > 0 and D.target(l)['steps'] > 0 for l in levels))


if __name__ == '__main__':
    unittest.main()
