#!/usr/bin/env python3
"""Serve dist/ on http://127.0.0.1:8000 with no-cache headers, so the browser revalidates every file on each load
and code changes appear on a normal refresh (unchanged files still come back as a cheap 304).

Also accepts POST /__log from the game page itself and appends it to logs/game.log (one JSON object per line), so
client-side events and errors can be read back when debugging."""
import datetime, functools, json, os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dist'))
PORT = int(os.environ.get('LM_GAME_PORT', '8000'))
LOGS = os.path.abspath(os.path.join(ROOT, '..', 'logs'))
SAME_ORIGIN = {f'http://127.0.0.1:{PORT}', f'http://localhost:{PORT}'}


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass

    def do_POST(self):
        if self.path != '/__log' or self.headers.get('Origin') not in SAME_ORIGIN:
            self.send_response(403); self.end_headers(); return
        n = int(self.headers.get('content-length') or 0)
        if not 0 < n <= 256_000:
            self.send_response(413); self.end_headers(); return
        try:
            batch = json.loads(self.rfile.read(n))
            os.makedirs(LOGS, exist_ok=True)
            path = os.path.join(LOGS, 'game.log')
            if os.path.exists(path) and os.path.getsize(path) > 5_000_000:
                os.replace(path, path + '.1')
            with open(path, 'a') as f:
                for entry in (batch if isinstance(batch, list) else [batch])[:200]:
                    f.write(json.dumps({'server': datetime.datetime.now().isoformat(timespec='seconds'), **entry}) + '\n')
            self.send_response(204)
        except Exception:
            self.send_response(400)
        self.end_headers()


if __name__ == '__main__':
    httpd = ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=ROOT))
    print(f'Living Mystery on http://127.0.0.1:{PORT}', flush=True)
    httpd.serve_forever()
