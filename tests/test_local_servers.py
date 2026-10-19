"""The loopback servers' shared guards: Host checks, hidden paths, the shared origin parser and socket timeouts.

Servers run in-process on ephemeral 127.0.0.1 ports (never the live game's 8000/8787/8788); no model calls."""
import functools, http.client, importlib, logging, os, socket, sys, threading, time

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(ROOT, 'server'))
import local_origins  # noqa: E402
import llm_proxy  # noqa: E402
import director_server  # noqa: E402
import static_server  # noqa: E402

QUIET = logging.getLogger('local_servers.tests')   # keep test requests out of the live logs/
QUIET.addHandler(logging.NullHandler())
QUIET.propagate = False


@pytest.fixture()
def serve():
    servers = []

    def start(handler):
        httpd = static_server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        servers.append(httpd)
        return httpd.server_address[1]
    yield start
    for httpd in servers:
        httpd.shutdown()
        httpd.server_close()


def request(port, method, path, host=None, headers=None, body=None):
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    try:
        conn.request(method, path, body=body, headers={'Host': f'127.0.0.1:{port}' if host is None else host, **(headers or {})})
        response = conn.getresponse()
        return response.status, response.read()
    finally:
        conn.close()


def stalled_body(port, path, headers, wait=5):
    """Send headers that declare a body, send no body, and return how long the server took to hang up."""
    with socket.create_connection(('127.0.0.1', port), timeout=wait) as sock:
        lines = [f'POST {path} HTTP/1.1', *(f'{k}: {v}' for k, v in headers.items()), 'Content-Length: 100', '', '']
        sock.sendall('\r\n'.join(lines).encode())
        t0 = time.time()
        assert sock.recv(4096) == b'', 'the server closes the connection without answering'
        return time.time() - t0


class FakeHandler:
    """A request handler's state without a socket: headers, path, and the responses it sends."""
    def __init__(self, cls, path, host, origin=None, header=None):
        self.h = object.__new__(cls)
        self.h.headers = {'Host': host, **({'Origin': origin} if origin else {}), **({'X-Living-Mystery': header} if header else {})}
        self.h.path, self.results = path, []
        self.h._send = lambda code, body: self.results.append((code, body))


# --- static server ----------------------------------------------------------------------------------------------

@pytest.fixture()
def site(tmp_path, serve, monkeypatch):
    (tmp_path / 'index.html').write_text('game')
    (tmp_path / '.secret').write_text('secret')
    (tmp_path / 'live').mkdir()
    (tmp_path / 'live' / 'case.json').write_text('{}')
    (tmp_path / 'live' / '.publication-transaction.json').write_text('{"pending": true}')
    (tmp_path / '.git').mkdir()
    (tmp_path / '.git' / 'config').write_text('[core]')
    logs = tmp_path / 'logs'
    monkeypatch.setattr(static_server, 'LOGS', str(logs))
    return serve(functools.partial(static_server.Handler, directory=str(tmp_path))), logs


def test_static_server_serves_its_own_host_only(site):
    port, _ = site
    assert request(port, 'GET', '/index.html') == (200, b'game')
    assert request(port, 'GET', '/index.html', host=f'localhost:{port}') == (200, b'game')
    for host in (f'evil.example:{port}', 'evil.example', f'127.0.0.1:{port + 1}', f'localhost.evil.example:{port}',
                 f'127.0.0.1:{port}.evil.example', f'[::1]:{port}', ''):
        assert request(port, 'GET', '/index.html', host=host)[0] == 403, host
        assert request(port, 'HEAD', '/index.html', host=host)[0] == 403, host


def test_static_server_hides_dotfiles(site):
    port, _ = site
    assert request(port, 'GET', '/live/case.json')[0] == 200
    for path in ('/.secret', '/live/.publication-transaction.json', '/%2esecret', '/live/%2Epublication-transaction.json',
                 '/.git/config', '/.git/', '/live/.publication-transaction.json?x=1', '/live/..%2f.secret'):
        assert request(port, 'GET', path)[0] == 404, path
        assert request(port, 'HEAD', path)[0] == 404, path
    assert static_server.hidden('/a/.b/c') and not static_server.hidden('/a/b.c/d.json')


def test_static_log_endpoint_checks_host_and_origin(site):
    port, logs = site
    origin = {'Origin': f'http://127.0.0.1:{port}', 'Content-Type': 'application/json'}
    assert request(port, 'POST', '/__log', host=f'evil.example:{port}', headers=origin, body=b'{"kind":"x"}')[0] == 403
    assert request(port, 'POST', '/__log', headers={'Origin': 'http://evil.example'}, body=b'{"kind":"x"}')[0] == 403
    assert not logs.exists()
    assert request(port, 'POST', '/__log', headers=origin, body=b'{"kind":"x"}')[0] == 204
    assert '"kind": "x"' in (logs / 'game.log').read_text()


def test_static_server_drops_a_stalled_body(site, serve, tmp_path):
    _, logs = site
    port = serve(functools.partial(type('Quick', (static_server.Handler,), {'timeout': 0.3}), directory=str(tmp_path)))
    elapsed = stalled_body(port, '/__log', {'Host': f'127.0.0.1:{port}', 'Origin': f'http://127.0.0.1:{port}'})
    assert elapsed < 4
    assert not logs.exists()


# --- socket timeouts -----------------------------------------------------------------------------------------------

def test_every_server_sets_a_socket_timeout():
    gs = importlib.import_module('generator_server')
    for handler in (llm_proxy.Handler, director_server.Handler, gs.Handler, static_server.Handler):
        assert handler.timeout == 30, handler


class SlowBackend:
    def __init__(self, seconds):
        self.seconds = seconds

    def complete(self, model, system, prompt, max_tokens, temperature):
        time.sleep(self.seconds)
        return 'a considered reply'


@pytest.fixture()
def quick_proxy(serve, monkeypatch):
    monkeypatch.setattr(llm_proxy, 'ROUTES', llm_proxy.parse_routes('dialogue=ollama:m'))
    monkeypatch.setattr(llm_proxy, 'BACKENDS', {'ollama': SlowBackend(0.8)})
    monkeypatch.delenv('LM_AUDIT_FILE', raising=False)
    monkeypatch.setattr(llm_proxy, 'LOG', QUIET)
    port = serve(type('Quick', (llm_proxy.Handler,), {'timeout': 0.3}))
    headers = {'Origin': 'http://127.0.0.1:8000', 'X-Living-Mystery': 'dialogue-v2', 'Content-Type': 'application/json'}
    return port, headers


def test_socket_timeout_does_not_cut_off_a_model_call(quick_proxy):
    port, headers = quick_proxy
    body = b'{"system": "S", "prompt": "P", "max_tokens": 10}'
    status, reply = request(port, 'POST', '/', host=f'127.0.0.1:{llm_proxy.PORT}', headers=headers, body=body)
    assert (status, reply) == (200, b'{"text": "a considered reply"}'), 'a 0.8 s model call outlives a 0.3 s socket timeout'


def test_proxy_drops_a_stalled_body(quick_proxy):
    port, headers = quick_proxy
    assert stalled_body(port, '/', {'Host': f'127.0.0.1:{llm_proxy.PORT}', **headers}) < 4


# --- director and generator ----------------------------------------------------------------------------------------

def test_director_health_checks_host():
    for host in ('evil.example:8788', '127.0.0.1:8787', 'localhost', ''):
        f = FakeHandler(director_server.Handler, '/health', host)
        f.h.do_GET()
        assert f.results == [(403, {'error': 'host_not_allowed'})], host
    for host in ('127.0.0.1:8788', 'localhost:8788'):
        f = FakeHandler(director_server.Handler, '/health', host)
        f.h.do_GET()
        assert f.results[0][0] in (200, 503), 'admitted: the solver answers or reports itself unavailable'
    f = FakeHandler(director_server.Handler, '/solve', 'evil.example:8788', origin='http://127.0.0.1:8000', header='director-v1')
    f.h.do_POST()
    assert f.results[0][0] == 403


def test_director_uses_the_shared_origin_parser():
    assert director_server.parse_allowed_origins is local_origins.parse_allowed_origins
    assert director_server.ALLOWED_HOSTS == local_origins.allowed_hosts(8788)


@pytest.fixture()
def generator(monkeypatch):
    monkeypatch.setenv('LM_GENERATOR_PORT', '8789')

    def load(origins=None):
        if origins is None:
            monkeypatch.delenv('LM_ALLOWED_ORIGINS', raising=False)
        else:
            monkeypatch.setenv('LM_ALLOWED_ORIGINS', origins)
        return importlib.reload(importlib.import_module('generator_server'))
    yield load
    load()


def test_generator_uses_the_shared_origin_parser(generator):
    gs = generator(' http://LOCALHOST:8000, http://127.0.0.1:80 ')
    assert gs.parse_allowed_origins is local_origins.parse_allowed_origins
    assert gs.ALLOWED_ORIGINS == {'http://localhost:8000', 'http://127.0.0.1'}
    for bad in ('*', 'null', 'https://localhost:8000', 'http://localhost:8000/x', 'http://evil.example:8000', 'http://localhost'):
        with pytest.raises(ValueError):
            generator(bad)
    assert generator().ALLOWED_ORIGINS == {'http://127.0.0.1:8000', 'http://localhost:8000'}


def test_generator_health_checks_host(generator):
    gs = generator()
    f = FakeHandler(gs.Handler, '/health', 'evil.example:8789')
    f.h.do_GET()
    assert f.results == [(403, {'error': 'host_not_allowed'})]
    f = FakeHandler(gs.Handler, '/health', '127.0.0.1:8789')
    f.h.do_GET()
    assert f.results == [(200, {'ok': True})]
