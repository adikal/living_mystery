"""Tests for difficulty.py: features come from the certifier, the model is monotone, bands and fitting behave."""
import json
import os
import random
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import difficulty as D  # noqa: E402

FIXTURE = os.path.join(HERE, '..', '..', 'tests', 'fixtures', 'mk-rook.json')


class Difficulty(unittest.TestCase):
    def setUp(self):
        self.case = json.load(open(FIXTURE))
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
