"""What a generation or publication run spends its time on: every model call (its phase, purpose, model, seconds,
tokens, and whether a hedge copy was sent and won) and every phase's wall time, written as a table next to the run so
each iteration starts from measurements. Also keeps recent call latencies across runs, which set when a slow call is
hedged (refine._converse)."""
import contextvars
import json
import os
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
HISTORY = os.environ.get('LM_LATENCY_HISTORY') or os.path.join(HERE, 'runs', 'latency-history.json')
KEEP = 60                      # latencies kept per (model, purpose)
_LOCK = threading.Lock()
_PHASE = contextvars.ContextVar('timing_phase', default=())
CALLS, PHASES = [], []
_DIRTY = [False]               # the history changed in this process (tests that never call a model leave it alone)
T0 = time.time()


def _load():
    try:
        with open(HISTORY) as f:
            return {k: list(v)[-KEEP:] for k, v in json.load(f).items()}
    except (OSError, ValueError):
        return {}


_HISTORY = _load()


def reset():
    """Start a new run's record (the latency history is kept)."""
    global T0
    with _LOCK:
        CALLS.clear(); PHASES.clear()
        T0 = time.time()


def current():
    return '/'.join(_PHASE.get()) or '-'


class phase:
    """`with timing.phase('seed'):` names the calls made inside (threads included, when submitted with the context) and
    records the phase's wall time. Phases nest: 'publish/add_reactions'."""
    def __init__(self, name):
        self.name = name

    def __enter__(self):
        self.token = _PHASE.set(_PHASE.get() + (self.name,))
        self.started = time.time()
        return self

    def __exit__(self, *exc):
        name = current()
        _PHASE.reset(self.token)
        with _LOCK:
            PHASES.append({'phase': name, 'start': round(self.started - T0, 1), 'seconds': round(time.time() - self.started, 1),
                           'failed': exc[0] is not None})


def _key(model, purpose):
    return f'{model}|{purpose}'


def record_call(model, purpose, seconds, usage=None, hedged=False, hedge_won=False, error=None):
    usage = usage or {}
    with _LOCK:
        CALLS.append({'phase': current(), 'purpose': purpose, 'model': model, 'start': round(time.time() - seconds - T0, 1),
                      'seconds': round(seconds, 1), 'in': usage.get('inputTokens', 0), 'out': usage.get('outputTokens', 0),
                      'hedged': hedged, 'hedge_won': hedge_won, 'error': error})
        # a hedged call's time is cut short by its copy: it says nothing about how long such a call usually takes
        if not error and not hedged:
            _DIRTY[0] = True
            _HISTORY.setdefault(_key(model, purpose), []).append(round(seconds, 1))
            del _HISTORY[_key(model, purpose)][:-KEEP]


def quantile(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))] if xs else None


def hedge_after(model, purpose, min_samples=5, factor=1.25, floor=20.0):
    """Seconds after which a call of this kind is slower than usual (its 90th percentile, with room), or None while
    too few calls of this kind have been seen to say what usual is."""
    xs = _HISTORY.get(_key(model, purpose), [])
    if len(xs) < min_samples:
        return None
    return max(floor, quantile(xs, 0.9) * factor)


def _short(model):
    return model.split('.')[-1].replace('anthropic.', '').replace('claude-', '')


def table():
    """The run as Markdown: phases in order, then model calls grouped by phase and purpose."""
    with _LOCK:
        calls, phases = list(CALLS), list(PHASES)
    wall = time.time() - T0
    lines = [f'# Timing ({wall:.0f}s so far, {len(calls)} model calls, '
             f'{sum(c["in"] for c in calls) // 1000}k in / {sum(c["out"] for c in calls) // 1000}k out tokens)', '',
             '| phase | start s | wall s |', '|---|---:|---:|']
    for p in sorted(phases, key=lambda p: p['start']):
        lines.append(f"| {p['phase']}{' (failed)' if p['failed'] else ''} | {p['start']:.0f} | {p['seconds']:.0f} |")
    groups = {}
    for c in calls:
        groups.setdefault((c['phase'], c['purpose'], _short(c['model'])), []).append(c)
    lines += ['', '| phase | purpose | model | n | p50 s | p90 s | max s | hedged (won) | errors |', '|---|---|---|---:|---:|---:|---:|---:|---:|']
    for (ph, purpose, model), cs in sorted(groups.items(), key=lambda kv: min(c['start'] for c in kv[1])):
        xs = [c['seconds'] for c in cs]
        lines.append(f"| {ph} | {purpose} | {model} | {len(cs)} | {quantile(xs, .5):.0f} | {quantile(xs, .9):.0f} | {max(xs):.0f} | "
                     f"{sum(c['hedged'] for c in cs)} ({sum(c['hedge_won'] for c in cs)}) | {sum(bool(c['error']) for c in cs)} |")
    return '\n'.join(lines) + '\n'


def save(directory):
    """Write timings.md and timings.json into a run directory, and the latency history; safe to call after every step."""
    os.makedirs(directory, exist_ok=True)
    with _LOCK:
        data = {'calls': list(CALLS), 'phases': list(PHASES)}
        history = {k: list(v) for k, v in _HISTORY.items()}
    with open(os.path.join(directory, 'timings.json'), 'w') as f:
        json.dump(data, f, indent=1)
    with open(os.path.join(directory, 'timings.md'), 'w') as f:
        f.write(table())
    if not _DIRTY[0]:
        return
    try:
        os.makedirs(os.path.dirname(HISTORY), exist_ok=True)
        tmp = HISTORY + f'.{os.getpid()}.tmp'
        with open(tmp, 'w') as f:
            json.dump(history, f)
        os.replace(tmp, HISTORY)
    except OSError:
        pass
