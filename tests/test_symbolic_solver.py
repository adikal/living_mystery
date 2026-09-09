"""Exercise the real Z3 compiler and the HTTP boundary without model calls."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from email.message import Message

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from symbolic_solver import solve
from director_server import Handler


def query():
    return {'version': 1, 'kind': 'plan-feasibility', 'perspective': 'world', 'variables': {'time': {'sort': 'int', 'min': 0, 'max': 100}},
            'constraints': [{'id': 'arrival', 'label': 'Must arrive after travel', 'formula': {'op': 'ge', 'args': [{'var': 'time'}, 8]}, 'sources': ['e00001']}], 'assumptions': [], 'horizon': 100, 'minute': 0}


class SymbolicTests(unittest.TestCase):
    def test_real_z3_witness_and_conflict_provenance(self):
        q = query(); r = solve(q)
        self.assertEqual(r['status'], 'sat'); self.assertGreaterEqual(r['witness']['time'], 8)
        q['constraints'].append({'id': 'deadline', 'label': 'Meeting ends too soon', 'formula': {'op': 'le', 'args': [{'var': 'time'}, 4]}, 'sources': ['e00002']})
        r = solve(q); self.assertEqual(r['status'], 'unsat')
        self.assertEqual({x['id'] for x in r['conflicts']}, {'arrival', 'deadline'})
        self.assertEqual(len(r['queryDigest']), 64)

    def test_unsupported_language_and_types_are_not_ignored(self):
        for formula in [{'op': 'eval', 'args': ['arbitrary code']}, {'op': 'ge', 'args': [True, 5]}, {'var': 'missing'}, {'op': 'eq', 'args': [1]}, {'op': 'add', 'args': [1, 2]}]:
            q = query();q['constraints'][0]['formula'] = formula
            with self.assertRaises(ValueError): solve(q)
        q=query();q['version']=2
        with self.assertRaises(ValueError): solve(q)

    def test_request_bounds_and_origin_are_enforced(self):
        def handler():
            h = object.__new__(Handler);h.headers = Message();h.path='/solve'
            for key, value in {'Host':'localhost:8788','Origin':'http://localhost:8000','Content-Type':'application/json','X-Living-Mystery':'director-v1'}.items():h.headers[key]=value
            body=json.dumps({'queries':[{'id':'e001','query':query()}]}).encode()
            h.headers['Content-Length']=str(len(body));h.rfile=io.BytesIO(body);h.results=[];h._send=lambda status,body:h.results.append((status,body))
            return h
        h=handler();h.do_POST();self.assertEqual(h.results[0][0],200);self.assertEqual(h.results[0][1]['results'][0]['result']['status'],'sat')
        h=handler();h.headers.replace_header('Origin','https://unrelated.example');h.do_POST();self.assertEqual(h.results[0][0],403)
        h=handler();h.headers.replace_header('Content-Length','500001');h.do_POST();self.assertEqual(h.results[0][0],400)
        h=handler();h.headers.replace_header('X-Living-Mystery','character-v1');h.do_POST();self.assertEqual(h.results[0][0],403)

if __name__ == '__main__': unittest.main()
