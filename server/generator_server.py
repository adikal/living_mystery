#!/usr/bin/env python3
"""Loopback-only generation server for Living Mystery (docs/mystery-kernel.md).

The browser starts a job, polls its progress events, and plays the case when it is published. One job runs at a time.
Like the LLM proxy, this is a development server: it binds to loopback and checks exact Origin, Host and a custom
header, which restricts browser pages but is not authentication against local programs.

  .venv/bin/python server/generator_server.py        # port 8789 (LM_GENERATOR_PORT to change)

Endpoints (all JSON; POST needs X-Living-Mystery: generator-v1):
  GET  /health
  GET  /jobs/current              -> the running or most recent job summary, or 404
  POST /jobs                      -> start a job (409 with the running job if one is already going)
  GET  /jobs/<id>?since=N         -> events[N:], status, result or error
  POST /jobs/<id>/cancel
"""
import datetime, json, logging, os, random, sys, threading, time, traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'refine-c'))
import difficulty  # noqa: E402
from local_origins import DEFAULT_ALLOWED_ORIGINS, allowed_hosts, parse_allowed_origins  # noqa: E402

HOST = os.environ.get('LM_GENERATOR_HOST', '127.0.0.1')
PORT = int(os.environ.get('LM_GENERATOR_PORT', '8789'))
ALLOWED_ORIGINS = parse_allowed_origins(os.environ.get('LM_ALLOWED_ORIGINS', DEFAULT_ALLOWED_ORIGINS))
ALLOWED_HOSTS = allowed_hosts(PORT)
SOCKET_TIMEOUT = 30   # seconds per socket read or write on a client connection
TIME_LIMIT = int(os.environ.get('LM_GENERATOR_TIME_LIMIT', str(12 * 60)))   # beyond the profile's own budget
STEPS, DEPTH = int(os.environ.get('LM_GENERATOR_STEPS', '16')), int(os.environ.get('LM_GENERATOR_DEPTH', '5'))
if HOST not in ('127.0.0.1', 'localhost'):
    raise ValueError('The generator server must bind to loopback')
os.makedirs(os.path.join(ROOT, 'logs'), exist_ok=True)
logging.basicConfig(filename=os.path.join(ROOT, 'logs', 'generator.log'), level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s')
LOG = logging.getLogger('generator')


def summarize(event):
    k = event.get('kind')
    if k == 'seed':
        c = event.get('case') or {}
        return f"seed: {len(c.get('people', []))} people, {len(c.get('events', []))} events, {len(c.get('signs', []))} clues, metrics {event.get('metrics')}"
    if k == 'step':
        return (f"layer {event.get('step')} {event.get('mode')} target={event.get('target')} accepted={event.get('accepted')} "
                f"op={event.get('operator')} {event.get('seconds')}s metrics={event.get('metrics')} story={str(event.get('story') or '')[:160]!r}")
    if k in ('draft_checked',):
        return f"draft checked ok={event.get('ok')} errors={event.get('errors')}"
    return f"{k}: " + json.dumps({x: y for x, y in event.items() if x not in ('kind', 'case', 'added')})[:400]


class Job:
    def __init__(self, brief, premise=None, level='medium'):
        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        Job.seq = getattr(Job, 'seq', 0) + 1
        self.id = stamp if stamp != getattr(Job, 'last', None) else f'{stamp}-{Job.seq}'
        Job.last = stamp
        self.brief = brief                    # (title, premise, place, generator brief)
        self.premise = premise                # drawn by code: victim, culprit, suspects, method, motive, place, shape
        self.profile = difficulty.target(level)   # targets, steps and time budget for the requested difficulty
        self.level = self.profile['level']
        self.events, self.lock = [], threading.Lock()
        self.status, self.result, self.error = 'running', None, None
        self.cancel = threading.Event()
        self.started = time.time()

    def emit(self, event):
        with self.lock:
            self.events.append(event)
        LOG.info('job %s +%ss %s', self.id, event.get('t'), summarize(event))

    def summary(self):
        return {'id': self.id, 'status': self.status, 'title': self.brief[0], 'premise': self.brief[1], 'difficulty': self.level,
                'elapsed': round(time.time() - self.started), 'events': len(self.events), 'result': self.result, 'error': self.error}


STATE = {'job': None}
STATE_LOCK = threading.Lock()


def default_runner(job):
    """Run the real generator (Bellweather fixed setting) and publish the result for play."""
    import refine, publish
    refine._client = None   # fresh credentials for every job; a long-lived server would otherwise keep expired ones
    refine.FIXED = json.load(open(os.path.join(ROOT, 'tools', 'refine-c', 'settings', 'bellweather.json')))
    outdir = os.path.join(ROOT, 'tools', 'refine-c', 'runs', f'live-{job.id}')
    logf = open(os.path.join(os.path.dirname(outdir), f'live-{job.id}.log'), 'a') if os.path.isdir(os.path.dirname(outdir)) else None
    def log(line):
        if logf:
            logf.write(f"{datetime.datetime.now():%H:%M:%S} {line}\n"); logf.flush()
    # the profile's budget ends refinement gracefully; TIME_LIMIT (budget + seed and publishing) is the hard stop
    limit = job.profile['seconds'] + TIME_LIMIT
    stop = lambda: job.cancel.is_set() or time.time() - job.started > limit
    result = refine.run_case('live', job.brief[3], STEPS, DEPTH, outdir, log, emit=job.emit, should_stop=stop, premise=job.premise,
                             profile=job.profile)
    if not result.get('ok') or 'case' not in result:
        raise RuntimeError(result.get('reason') or 'the generated case did not certify')
    job.emit({'kind': 'phase', 'phase': 'publish', 't': round(time.time() - job.started, 1),
              'message': 'Writing the questions you can ask and every suspect\u2019s account of the evening'})
    result['case']['difficulty_target'] = job.level
    # the whole-case review blocks publication unless LM_STRICT_PUBLICATION_REVIEW=0
    entry, cert = publish.publish_live(result['case'], job.brief, job.id,
                                       strict_publication_review=os.environ.get('LM_STRICT_PUBLICATION_REVIEW', '1') != '0')
    return {'file': entry['file'], 'id': entry['id'], 'title': entry['title'], 'solveDepth': cert['solveDepth'],
            'difficulty': entry.get('difficulty'), 'target': job.level, 'seconds': round(time.time() - job.started)}


RUNNER = default_runner


# One finished case is kept in reserve so "Generate" can hand it over at once and build the next in the background.
# The reserve starts only after the player has asked for a case (no spending until then); LM_GENERATOR_RESERVE=0 disables.
RESERVE = os.environ.get('LM_GENERATOR_RESERVE', '1') != '0'
STATE['reserve'] = None


def new_job(level='medium'):
    import premise as P
    pr = P.draw(history=P._history() + ([STATE['reserve'].premise] if STATE.get('reserve') and STATE['reserve'].premise else [])
                + ([STATE['job'].premise] if STATE.get('job') and STATE['job'].premise else []))
    return Job(('A new case', P.blurb(pr), pr['place'], P.brief(pr)), pr, level)


def launch(job):
    def work():
        try:
            job.result = RUNNER(job)
            job.status = 'done'
            LOG.info('job %s done: %s', job.id, job.result)
            job.emit({'kind': 'done', 't': round(time.time() - job.started, 1), 'result': job.result})
        except Exception as exc:  # includes refine.Cancelled
            cancelled = type(exc).__name__ == 'Cancelled'
            timed_out = cancelled and not job.cancel.is_set()
            job.status = 'cancelled' if cancelled and not timed_out else 'failed'
            job.error = ('The generation took too long and was stopped.' if timed_out
                         else 'Cancelled.' if cancelled else str(exc)[:300])
            job.emit({'kind': job.status, 't': round(time.time() - job.started, 1), 'message': job.error})
            LOG.error('job %s %s: %s', job.id, job.status, job.error)
            if not cancelled:
                LOG.error(traceback.format_exc())
        finally:
            with STATE_LOCK:
                if STATE.get('reserve') is job and job.status != 'done':
                    STATE['reserve'] = None          # a failed reserve is simply dropped
            ensure_reserve()
    threading.Thread(target=work, daemon=True).start()


def ensure_reserve():
    """Start building the next case in the background if there is no reserve and nothing is running."""
    if not RESERVE:
        return
    with STATE_LOCK:
        cur, res = STATE.get('job'), STATE.get('reserve')
        if res or (cur and cur.status == 'running') or not cur:
            return
        res = STATE['reserve'] = new_job()
        LOG.info('reserve %s started: %s', res.id, res.brief[1])
    launch(res)


def start_job(level='medium'):
    """Start a case of the requested difficulty; the reserve (always medium) is handed over when it matches."""
    with STATE_LOCK:
        current, res = STATE['job'], STATE.get('reserve')
        if current and current.status == 'running':
            return current, False
        if res and res.level == level:           # hand over the reserve: finished already, or partly built
            STATE['job'], STATE['reserve'] = res, None
            LOG.info('job %s taken from reserve (%s)', res.id, res.status)
            job, fresh = res, False
        else:
            job = STATE['job'] = new_job(level)
            LOG.info('job %s started: %s', job.id, job.brief[0])
            fresh = True
    if fresh:
        launch(job)
    else:
        ensure_reserve()
    return job, True


class Handler(BaseHTTPRequestHandler):
    server_version = 'LivingMysteryGenerator/1.0'
    timeout = SOCKET_TIMEOUT   # a client that declares a body and stalls cannot hold a thread

    def log_message(self, fmt, *args):  # keep polling quiet
        pass

    def _cors(self):
        origin = self.headers.get('Origin')
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'content-type, x-living-mystery')

    def _send(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self._cors()
        self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(body)))
        self.send_header('cache-control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _host_allowed(self):
        return self.headers.get('Host') in ALLOWED_HOSTS

    def _allowed(self):
        return self._host_allowed() and self.headers.get('Origin') in ALLOWED_ORIGINS

    def do_OPTIONS(self):
        if not self._allowed() or self.headers.get('Access-Control-Request-Method') not in ('GET', 'POST'):
            self._send(403, {'error': 'origin_not_allowed'}); return
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        if not self._host_allowed():
            self._send(403, {'error': 'host_not_allowed'}); return
        if url.path.rstrip('/') in ('', '/health'):
            self._send(200, {'ok': True}); return
        if not self._allowed():
            self._send(403, {'error': 'origin_not_allowed'}); return
        job = STATE['job']
        if url.path == '/jobs/current':
            self._send(200, job.summary()) if job else self._send(404, {'error': 'no_job'}); return
        parts = url.path.strip('/').split('/')
        if len(parts) == 2 and parts[0] == 'jobs':
            if not job or job.id != parts[1]:
                self._send(404, {'error': 'unknown_job'}); return
            try:
                since = max(0, int(parse_qs(url.query).get('since', ['0'])[0]))
            except ValueError:
                self._send(400, {'error': 'invalid_since'}); return
            with job.lock:
                events = job.events[since:]
            self._send(200, {**job.summary(), 'since': since, 'next': since + len(events), 'eventsNew': events}); return
        self._send(404, {'error': 'not_found'})

    def do_POST(self):
        if not self._allowed() or self.headers.get('X-Living-Mystery') != 'generator-v1':
            self._send(403, {'error': 'origin_not_allowed'}); return
        path = urlparse(self.path).path
        if path == '/jobs':
            try:
                body = json.loads(self.rfile.read(min(int(self.headers.get('content-length') or 0), 1000)) or b'{}')
            except ValueError:
                body = {}
            level = body.get('difficulty') if isinstance(body, dict) else None
            if level is not None and level not in difficulty.load_model()['targets']:
                self._send(400, {'error': 'unknown_difficulty'}); return
            job, started = start_job(level or 'medium')
            self._send(201 if started else 409, job.summary()); return
        parts = path.strip('/').split('/')
        if len(parts) == 3 and parts[0] == 'jobs' and parts[2] == 'cancel':
            job = STATE['job']
            if not job or job.id != parts[1]:
                self._send(404, {'error': 'unknown_job'}); return
            job.cancel.set()
            self._send(200, job.summary()); return
        self._send(404, {'error': 'not_found'})


def serve():
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f'Living Mystery generator on http://{HOST}:{PORT} (origins: {", ".join(sorted(ALLOWED_ORIGINS))})', flush=True)
    httpd.serve_forever()


if __name__ == '__main__':
    serve()
