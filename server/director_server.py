#!/usr/bin/env python3
"""Optional local symbolic service; no AWS credentials or model calls required.
Run: .venv/bin/python server/director_server.py (port 8788)
"""
import json
from http.server import ThreadingHTTPServer
from llm_proxy import Handler as BaseHandler, ALLOWED_ORIGINS
from symbolic_solver import solve


class Handler(BaseHandler):
    server_version = 'LivingMysteryDirector/1.0'

    def _allowed(self):
        return self.headers.get('Host') in ('127.0.0.1:8788', 'localhost:8788') and self.headers.get('Origin') in ALLOWED_ORIGINS

    def do_GET(self):
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
            self._send(200, {'results': answers})
        except (ValueError, TypeError, KeyError, RecursionError):
            self._send(400, {'error': 'invalid_symbolic_query'})
        except Exception:
            self._send(503, {'error': 'solver_unavailable'})


if __name__ == '__main__':
    print('World Director → http://127.0.0.1:8788 (Z3; independent of AI)', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8788), Handler).serve_forever()
