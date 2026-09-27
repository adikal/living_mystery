"""The Z3 case oracle: feasibility, uniqueness with unsat cores, alternative stories, and the /case endpoint."""
import copy
import glob
import io
import json
import os
import sys
import unittest
from email.message import Message
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'server'), str(ROOT / 'tools' / 'refine-c')]
import case_oracle as O  # noqa: E402
from refine import certify, survivors  # noqa: E402
import director_server  # noqa: E402

SHIPPED = sorted(glob.glob(str(ROOT / 'dist/cases/generated/mk-*.json')))


def small():
    return {
        'setting': {'places': [{'id': 'gallery'}, {'id': 'cottage'}, {'id': 'inn'}],
                    'links': [{'a': 'gallery', 'b': 'cottage', 'minutes': 10}, {'a': 'cottage', 'b': 'inn', 'minutes': 15}]},
        'people': [{'id': 'tom', 'traits': {'handed': 'left'}}, {'id': 'wife', 'traits': {'handed': 'right'}}, {'id': 'keeper', 'traits': {}}],
        'relations': [], 'possession': [],
        'question': {'truth': 'h_tom', 'candidates': [{'id': 'h_tom', 'facts': {'actor': 'tom'}}, {'id': 'h_wife', 'facts': {'actor': 'wife'}}],
                     'crime': {'event': 'e_push', 'place': 'gallery', 'window': [1320, 1440]}},
        'events': [{'id': 'e_push', 'agent': 'tom', 'place': 'gallery', 'start': 1400, 'end': 1402},
                   {'id': 'e_wife', 'agent': 'wife', 'place': 'cottage', 'start': 1300, 'end': 1500}],
        'signs': [{'id': 's_wife', 'kind': 'testimony', 'claim': {'kind': 'place', 'person': 'wife', 'place': 'cottage', 'start': 1310, 'end': 1450}}]}


class Oracle(unittest.TestCase):
    def test_feasibility_catches_impossible_travel(self):
        c = small()
        self.assertTrue(O.feasible(c)[0])
        c['events'].append({'id': 'e_bad', 'agent': 'tom', 'place': 'inn', 'start': 1405, 'end': 1410})   # 25 min walk in 3
        ok, conflicts = O.feasible(c)
        self.assertFalse(ok); self.assertTrue(any('e_bad' in x for x in conflicts))

    def test_alibi_rules_out_with_core_and_alternative_story(self):
        c = small()
        cand = O.candidates(c, ['s_wife'])
        self.assertEqual(cand['h_wife'], {'status': 'unsat', 'actor': 'wife', 'because': ['s_wife']})
        self.assertEqual(cand['h_tom']['status'], 'sat')
        # without the alibi the wife could have been at the gallery: a concrete minute inside the window
        alt = O.alternative(c, [], 'tom')
        self.assertEqual(alt['actor'], 'wife'); self.assertTrue(1320 <= alt['minute'] <= 1440)

    def test_alibi_with_gap_leaves_a_window(self):
        c = small(); c['signs'][0]['claim'].update(start=1310, end=1380)   # home until 23:00, 10 min walk
        alt = O.alternative(c, ['s_wife'], 'tom')
        self.assertEqual(alt['actor'], 'wife'); self.assertGreater(alt['minute'], 1390)

    def test_defeated_claims_are_not_trusted(self):
        c = small()
        c['signs'].append({'id': 's_log', 'kind': 'record', 'defeats': ['s_wife']})
        self.assertEqual(O.survivors(c, ['s_wife', 's_log']), ['h_tom', 'h_wife'])

    def test_shipped_cases_pass_and_agree_with_the_kernel_at_every_depth(self):
        self.assertTrue(SHIPPED)
        for f in SHIPPED:
            case = json.load(open(f))
            z = O.check_case(case)
            self.assertTrue(z['ok'], (f, z['errors']))
            A = certify(case)['A']
            for d in range(max(A['eff'].values()) + 1):
                vis = [s for s in A['understood'] if A['eff'][s] <= d]
                self.assertEqual(sorted(survivors(case, A, d)), O.survivors(case, vis), (f, d))


class Endpoint(unittest.TestCase):
    def call(self, body, origin='http://127.0.0.1:8000'):
        raw = json.dumps(body).encode()
        h = director_server.Handler.__new__(director_server.Handler)
        h.headers = Message()
        for k, v in {'Host': '127.0.0.1:8788', 'Origin': origin, 'X-Living-Mystery': 'director-v1',
                     'Content-Type': 'application/json', 'Content-Length': str(len(raw))}.items():
            h.headers[k] = v
        h.path, h.rfile, h.wfile = '/case', io.BytesIO(raw), io.BytesIO()
        sent = {}
        h._send = lambda code, payload: sent.update(code=code, payload=payload)
        h.do_POST()
        return sent

    def test_case_query_names_an_alternative(self):
        case_id = json.load(open(SHIPPED[0]))['id']
        r = self.call({'caseId': case_id, 'held': [], 'accused': 'silas'})
        self.assertEqual(r['code'], 200)
        self.assertGreater(len(r['payload']['survivors']), 1)
        self.assertIsNotNone(r['payload']['alternative'])

    def test_rejects_paths_bad_origins_and_extra_fields(self):
        self.assertEqual(self.call({'caseId': '../../etc/passwd', 'held': [], 'accused': 'x'})['code'], 400)
        self.assertEqual(self.call({'caseId': 'mk-bw-inn', 'held': [], 'accused': 'x', 'more': 1})['code'], 400)
        self.assertEqual(self.call({'caseId': 'mk-bw-inn', 'held': [], 'accused': 'x'}, origin='http://evil.test')['code'], 403)


if __name__ == '__main__':
    unittest.main()
