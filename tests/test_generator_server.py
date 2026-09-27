"""Generator server tests with a stub runner (no model calls)."""
import importlib, json, os, socket, sys, threading, time, urllib.request, urllib.error

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(ROOT, 'server'))


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); return s.getsockname()[1]


@pytest.fixture()
def server(monkeypatch):
    port = free_port()
    monkeypatch.setenv('LM_GENERATOR_PORT', str(port))
    import generator_server as gs
    gs = importlib.reload(gs)
    gate = threading.Event()

    def stub(job):
        job.emit({'kind': 'phase', 'phase': 'seed', 't': 0})
        job.emit({'kind': 'seed', 't': 1, 'case': {'people': []}, 'metrics': {'solve_depth': 0}})
        while not gate.is_set():
            if job.cancel.is_set():
                import refine
                raise refine.Cancelled()
            time.sleep(0.02)
        if getattr(job, 'fail', False):
            raise RuntimeError('boom')
        job.emit({'kind': 'step', 't': 2, 'step': 1, 'accepted': True})
        return {'file': 'live/x.json', 'id': 'mk-live-x', 'title': 'T', 'solveDepth': 5, 'seconds': 3}

    gs.RUNNER = stub
    httpd = gs.ThreadingHTTPServer(('127.0.0.1', port), gs.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield gs, port, gate
    httpd.shutdown()


def call(port, method, path, headers=None, origin='http://127.0.0.1:8000'):
    h = {'Origin': origin, **(headers or {})}
    if method == 'POST':
        h.setdefault('X-Living-Mystery', 'generator-v1')
    req = urllib.request.Request(f'http://127.0.0.1:{port}{path}', method=method, headers=h, data=b'' if method == 'POST' else None)
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def wait_for(fn, timeout=3):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(0.02)
    raise AssertionError('condition not met')


def test_rejects_foreign_origin_and_missing_header(server):
    gs, port, _ = server
    assert call(port, 'POST', '/jobs', origin='http://evil.example')[0] == 403
    assert call(port, 'POST', '/jobs', headers={'X-Living-Mystery': 'nope'})[0] == 403
    assert call(port, 'GET', '/jobs/current', origin='http://evil.example')[0] == 403


def test_start_poll_incrementally_and_finish(server):
    gs, port, gate = server
    code, job = call(port, 'POST', '/jobs')
    assert code == 201 and job['status'] == 'running'
    first = wait_for(lambda: (lambda r: r if r[1]['next'] >= 2 else None)(call(port, 'GET', f"/jobs/{job['id']}?since=0")))[1]
    assert [e['kind'] for e in first['eventsNew']][:2] == ['phase', 'seed']
    assert call(port, 'POST', '/jobs')[0] == 409, 'only one job at a time'
    gate.set()
    done = wait_for(lambda: (lambda r: r if r[1]['status'] == 'done' else None)(call(port, 'GET', f"/jobs/{job['id']}?since={first['next']}")))[1]
    assert done['result']['file'] == 'live/x.json'
    assert [e['kind'] for e in done['eventsNew']][-1] == 'done', 'only new events are returned'
    assert call(port, 'GET', '/jobs/current')[1]['status'] == 'done'


def test_cancel(server):
    gs, port, gate = server
    job = call(port, 'POST', '/jobs')[1]
    assert call(port, 'POST', f"/jobs/{job['id']}/cancel")[0] == 200
    st = wait_for(lambda: (lambda r: r if r[1]['status'] != 'running' else None)(call(port, 'GET', f"/jobs/{job['id']}")))[1]
    assert st['status'] == 'cancelled'
    assert call(port, 'POST', '/jobs')[0] == 201, 'a new job may start after cancellation'
    gate.set()


def test_failure_is_reported(server):
    gs, port, gate = server
    job = call(port, 'POST', '/jobs')[1]
    gs.STATE['job'].fail = True
    gate.set()
    st = wait_for(lambda: (lambda r: r if r[1]['status'] != 'running' else None)(call(port, 'GET', f"/jobs/{job['id']}")))[1]
    assert st['status'] == 'failed' and 'boom' in st['error']
