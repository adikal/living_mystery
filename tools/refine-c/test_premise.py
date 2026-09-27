"""The premise deck: rotation, scene/method fit, and the seed check."""
import os, sys, unittest
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

    def test_seed_check(self):
        p = {'victim': 'dora', 'culprit': 'hugo', 'suspects': ['ada', 'clara', 'hugo', 'jonah'], 'bystanders': [],
             'method': 'drown', 'motive': 'blackmail', 'place': 'mill', 'shape': 'two_liars'}
        case = {'victim': 'dora', 'question': {'truth': 'h', 'crime': {'event': 'e', 'place': 'mill'},
                'candidates': [{'id': 'h', 'facts': {'actor': 'hugo'}}] + [{'id': a, 'facts': {'actor': a}} for a in ('ada', 'clara', 'jonah')]},
                'events': [{'id': 'e', 'agent': 'hugo', 'method': 'drown', 'causedBy': 'a2'}, {'id': 'd', 'type': 'death', 'agent': 'dora'}],
                'attitudes': [{'id': 'a2', 'because': ['a1']}, {'id': 'a1', 'motive': 'blackmail'}]}
        self.assertEqual(P.seed_errors(case, p), [])
        case['events'][0]['method'] = 'poison'
        case['question']['candidates'].pop()
        errs = P.seed_errors(case, p)
        self.assertTrue(any('method' in e for e in errs)); self.assertTrue(any('candidates' in e for e in errs))


if __name__ == '__main__':
    unittest.main()
