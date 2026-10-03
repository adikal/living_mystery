"""Generate several cases at chosen difficulties, in parallel, through the generator server's own job code, and report
how each came out: rating against target, and what makes the set diverse (victim, culprit, method, motive, scene, objects).

    .venv/bin/python tools/refine-c/batch.py easy easy hard hard [--parallel 4]
"""
import collections
import json
import os
import sys
import subprocess
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'server'))
sys.path.insert(0, HERE)
import generator_server as gs  # noqa: E402
import enrich  # noqa: E402

def one(level, pr):
    """Run one case in this process (Z3 is not thread-safe, so each case gets its own process)."""
    import premise as P
    job = gs.Job(('A new case', P.blurb(pr), pr['place'], P.brief(pr)), pr, level)
    t0 = time.time()
    try:
        res = gs.default_runner(job)
        out = {'level': level, 'job': job.id, 'premise': job.brief[1], **res, 'seconds': round(time.time() - t0)}
    except Exception as e:  # a failed case is reported, not fatal
        out = {'level': level, 'job': job.id, 'premise': job.brief[1], 'error': str(e)[:300], 'seconds': round(time.time() - t0)}
    print('RESULT ' + json.dumps(out), flush=True)


def describe(results):
    print('\n== how they came out')
    rows = []
    for r in results:
        if 'error' in r:
            print(f"{r['level']:6} FAILED {r['premise']}: {r['error']}")
            continue
        c = json.load(open(f"{ROOT}/dist/cases/generated/{r['file']}"))
        d = c['difficulty']
        cast = sorted({p['id'] for p in c['people']})
        arts = [x.get('art') for x in c['signs'] if x.get('art')]
        rows.append((c, arts))
        print(f"{r['level']:6} -> {d['level']:6} score {d['score']:5} {'OK ' if d['level'] == r['level'] else 'OFF'} {c.get('title')!r} "
              f"victim {enrich.victim_of(c)} culprit {enrich.truth_actor(c)} {c['answer']['method']}/{c['answer']['motive']} "
              f"@{c['question']['crime']['place']} newcomer {'vera' in cast} {r['seconds']}s features {d['features']}")
    if rows:
        arts = collections.Counter(a for _, xs in rows for a in xs)
        print('pictures used:', len(arts), 'distinct:', dict(arts.most_common()))


if __name__ == '__main__':
    if sys.argv[1:2] == ['--one']:          # a worker: --one <level> <premise, json>
        one(sys.argv[2], json.loads(sys.argv[3]))
        sys.exit(0)
    import premise as P
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    par = int(sys.argv[sys.argv.index('--parallel') + 1]) if '--parallel' in sys.argv else 4
    levels = [a for a in args if not a.isdigit()]
    procs, chosen = [], []
    for level in levels:
        while sum(p.poll() is None for p in procs) >= par:
            time.sleep(5)
        # premises are drawn here, one at a time, so the set differs from each other and from recent cases
        pr = P.draw(history=P._history() + chosen)
        chosen.append(pr)
        procs.append(subprocess.Popen([sys.executable, __file__, '--one', level, json.dumps(pr)], stdout=subprocess.PIPE, text=True))
        time.sleep(2)                         # job ids are timestamps
    results = []
    for p in procs:
        out, _ = p.communicate()
        results += [json.loads(l[7:]) for l in out.splitlines() if l.startswith('RESULT ')]
    for r in results:
        print(json.dumps(r))
    describe(results)
