#!/usr/bin/env python3
"""Serve dist/ on http://127.0.0.1:8000 with no-cache headers, so the browser revalidates every file on each load
and code changes appear on a normal refresh (unchanged files still come back as a cheap 304).

Also accepts POST /__log from the game page itself and appends it to logs/game.log (one JSON object per line), so
client-side events and errors can be read back when debugging.

Loopback only. Every request must carry the server's own Host (127.0.0.1:<port> or localhost:<port>; 403 otherwise),
which keeps a page on another name that resolves to 127.0.0.1 (DNS rebinding) from reading the game or writing the
log. Paths with a component starting with '.' (dotfiles such as live/.publication-transaction.json) are 404."""
import datetime, functools, json, os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

from local_origins import allowed_hosts

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dist'))
PORT = int(os.environ.get('LM_GAME_PORT', '8000'))
LOGS = os.path.abspath(os.path.join(ROOT, '..', 'logs'))
SOCKET_TIMEOUT = 30   # seconds per socket read or write on a client connection


def hidden(path):
    """Whether a request path names a dotfile or passes through a dot-directory (after percent-decoding)."""
    return any(part.startswith('.') for part in unquote(urlsplit(path).path).replace('\\', '/').split('/'))


class Handler(SimpleHTTPRequestHandler):
    timeout = SOCKET_TIMEOUT   # a client that declares a body and stalls cannot hold a thread

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass

    def _hosts(self):
        return allowed_hosts(self.server.server_address[1])

    def _admitted(self):
        """Refuse a foreign Host (403) or a hidden path (404); True when the request may be served."""
        if self.headers.get('Host') not in self._hosts():
            self.send_error(403)
            return False
        if hidden(self.path):
            self.send_error(404)
            return False
        return True

    def do_GET(self):
        if self._admitted():
            super().do_GET()

    def do_HEAD(self):
        if self._admitted():
            super().do_HEAD()

    def do_POST(self):
        if not self._admitted():
            return
        if self.path != '/__log' or self.headers.get('Origin') not in {'http://' + h for h in self._hosts()}:
            self.send_response(403); self.end_headers(); return
        n = int(self.headers.get('content-length') or 0)
        if not 0 < n <= 256_000:
            self.send_response(413); self.end_headers(); return
        raw = self.rfile.read(n)   # a socket timeout here propagates, and the server closes the connection
        try:
            batch = json.loads(raw)
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
