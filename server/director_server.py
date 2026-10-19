#!/usr/bin/env python3
"""Optional local symbolic service; no AWS credentials or model calls required.
Run: .venv/bin/python server/director_server.py (port 8788)

Loopback only. Every request must carry the director's own Host (127.0.0.1:8788 or localhost:8788); POSTs also need an
LM_ALLOWED_ORIGINS Origin and X-Living-Mystery: director-v1.
"""
import json
import logging
import os
import re
import time
from http.server import ThreadingHTTPServer
from llm_proxy import Handler as BaseHandler
from local_origins import DEFAULT_ALLOWED_ORIGINS, allowed_hosts, parse_allowed_origins
from symbolic_solver import solve
import case_oracle

HOST, PORT = '127.0.0.1', 8788
ALLOWED_ORIGINS = parse_allowed_origins(os.environ.get('LM_ALLOWED_ORIGINS', DEFAULT_ALLOWED_ORIGINS))
ALLOWED_HOSTS = allowed_hosts(PORT)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CASES = [os.path.join(ROOT, 'dist', 'cases', 'generated'), os.path.join(ROOT, 'dist', 'cases', 'generated', 'live')]
CASE_ID = re.compile(r'^mk-[a-z0-9-]{1,60}$')
SIGN_ID = re.compile(r'^[A-Za-z0-9_:-]{1,80}$')
os.makedirs(os.path.join(ROOT, 'logs'), exist_ok=True)
LOG = logging.getLogger('director')
LOG.setLevel(logging.INFO)
_h = logging.FileHandler(os.path.join(ROOT, 'logs', 'director.log'))
_h.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
LOG.addHandler(_h)


def load_case(case_id):
    """Only published generated cases, by id; never an arbitrary path."""
    if not isinstance(case_id, str) or not CASE_ID.fullmatch(case_id):
        raise ValueError('bad case id')
    for d in CASES:
        path = os.path.join(d, case_id + '.json')
        if os.path.isfile(path):
            return json.load(open(path))
    raise ValueError('unknown case')


class Handler(BaseHandler):
    server_version = 'LivingMysteryDirector/1.0'

    def _host_allowed(self):
        return self.headers.get('Host') in ALLOWED_HOSTS

    def _allowed(self):
        return self._host_allowed() and self.headers.get('Origin') in ALLOWED_ORIGINS

    def do_GET(self):
        if not self._host_allowed():
            self._send(403, {'error': 'host_not_allowed'}); return
        if self.path == '/health':
            try:
                import z3
                self._send(200, {'ok': True, 'solver': 'z3', 'version': z3.get_version_string()})
            except ImportError:
                self._send(503, {'ok': False, 'error': 'solver_unavailable'})
        else:
            self._send(404, {'error': 'not_found'})

    def do_POST(self):
        if not self._allowed() or self.headers.get('X-Living-Mystery') != 'director-v1':
            self._send(403, {'error': 'origin_not_allowed'}); return
        if self.path == '/case':
            self._case(); return
        try:
            if self.path != '/solve' or self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
                raise ValueError('Invalid request')
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 500000:
                raise ValueError('Body limit exceeded')
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict) or set(body) != {'queries'} or not isinstance(body['queries'], list) or not 1 <= len(body['queries']) <= 12:
                raise ValueError('Use 1–12 queries')
            answers = []
            for item in body['queries']:
                if not isinstance(item, dict) or set(item) != {'id', 'query'} or not isinstance(item['id'], str) or len(item['id']) > 80:
                    raise ValueError('Invalid query entry')
                answers.append({'id': item['id'], 'query': item['query'], 'result': solve(item['query'])})
            LOG.info('solve %d queries: %s', len(answers), [a['result'].get('status') for a in answers])
            self._send(200, {'results': answers})
        except TimeoutError:   # the client stalled mid-body; the server closes the connection
            raise
        except (ValueError, TypeError, KeyError, RecursionError) as e:
            LOG.warning('solve rejected: %s', e)
            self._send(400, {'error': 'invalid_symbolic_query'})
        except Exception as e:
            LOG.error('solve failed: %s: %s', type(e).__name__, e)
            self._send(503, {'error': 'solver_unavailable'})

    def _case(self):
        """Accusation check on a published case: who the held evidence still allows, why the others are ruled
        out, and (if the accused is not the only one) a concrete alternative story."""
        t0 = time.time()
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 20000 or self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
                raise ValueError('Invalid request')
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict) or set(body) != {'caseId', 'held', 'accused'}:
                raise ValueError('Invalid body')
            held = body['held']
            if not isinstance(held, list) or len(held) > 400 or not all(isinstance(x, str) and SIGN_ID.fullmatch(x) for x in held):
                raise ValueError('Invalid evidence')
            if not isinstance(body['accused'], str) or len(body['accused']) > 40:
                raise ValueError('Invalid accused')
            case = load_case(body['caseId'])
            public = [x['id'] for x in case['signs'] if x.get('kind') == 'public']   # what everyone knows is held
            held = sorted(case_oracle.understood(case, set(held) | set(public)))   # evidence counts once it can be read
            cand = case_oracle.candidates(case, held)
            alt = case_oracle.alternative(case, held, body['accused'])
            out = {'survivors': sorted(h for h, r in cand.items() if r['status'] != 'unsat'),
                   'ruledOut': {h: r['because'] for h, r in cand.items() if r['status'] == 'unsat'}, 'alternative': alt}
            LOG.info('case %s accused=%s held=%d survivors=%s alternative=%s %.2fs', body['caseId'], body['accused'],
                     len(held), out['survivors'], alt, time.time() - t0)
            self._send(200, out)
        except TimeoutError:   # the client stalled mid-body; the server closes the connection
            raise
        except (ValueError, TypeError, KeyError) as e:
            LOG.warning('case rejected: %s', e)
            self._send(400, {'error': 'invalid_case_query'})
        except Exception as e:
            LOG.error('case failed: %s: %s', type(e).__name__, e)
            self._send(503, {'error': 'solver_unavailable'})


if __name__ == '__main__':
    print(f'World Director → http://{HOST}:{PORT} (Z3; independent of AI); log: logs/director.log', flush=True)
    LOG.info('director server started')
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
