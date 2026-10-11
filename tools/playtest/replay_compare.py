"""Compare two replays of the same questions (replay.mjs with the same --sample and --seed), question by question.

    .venv/bin/python tools/playtest/replay_compare.py /tmp/replay-A.json /tmp/replay-B.json

Prints, for each replay: replies the model wrote freely ('ai'), published accounts given after every reply was refused,
declines (dead ends), refused attempts per question, malformed replies, timeouts, seconds per turn, and the findings of
replay_judge.py per accepted reply; then B - A on the paired questions, with 95% bootstrap intervals.
"""
import json
import random
import statistics as st
import sys


def load(path):
    d = json.load(open(path))
    return {(r['episode'], r['step']): r for r in d['results']}


def rates(rows):
    n = len(rows)
    secs = sorted(r['seconds'] for r in rows if r.get('seconds') is not None)
    accepted = [r for r in rows if r.get('outcome') == 'ai']
    judged = [r for r in accepted if 'judged' in r]
    return {
        'questions': n,
        'free reply (ai)': sum(r['outcome'] == 'ai' for r in rows) / n,
        'account given': sum(r['outcome'] == 'account' for r in rows) / n,
        'dead end (decline)': sum(r['outcome'] == 'decline' for r in rows) / n,
        'errors': sum(r['outcome'] == 'error' for r in rows),
        'refused attempts / question': sum(r.get('rejected', 0) for r in rows) / n,
        'malformed replies': sum(r.get('invalid_json', 0) for r in rows),
        'timeouts': sum(r.get('reason') == 'timeout' for r in rows),
        'seconds / turn, median': st.median(secs) if secs else None,
        'seconds / turn, 90th pct': secs[int(0.9 * (len(secs) - 1))] if secs else None,
        'turns over 45 s': sum(s > 45 for s in secs),
        'accepted replies judged': len(judged),
        'judged with a finding': (sum(bool(r['judged']) for r in judged) / len(judged)) if judged else None,
        'findings / accepted reply': (sum(len(r['judged']) for r in judged) / len(judged)) if judged else None,
    }


def paired_ci(a, b, keys, f, n=4000, seed=7):
    rnd, diffs = random.Random(seed), []
    for _ in range(n):
        s = [rnd.choice(keys) for _ in keys]
        diffs.append(sum(f(b[k]) - f(a[k]) for k in s) / len(s))
    diffs.sort()
    return sum(f(b[k]) - f(a[k]) for k in keys) / len(keys), diffs[int(0.025 * n)], diffs[int(0.975 * n)]


def main():
    pa, pb = sys.argv[1:3]
    a, b = load(pa), load(pb)
    keys = sorted(set(a) & set(b))
    ra, rb = rates([a[k] for k in keys]), rates([b[k] for k in keys])
    print(f'{"":32} {"A":>10} {"B":>10}')
    for k in ra:
        fmt = lambda v: '-' if v is None else f'{v:.0%}' if isinstance(v, float) and v <= 1 and 'seconds' not in k \
            and '/' not in k else f'{v:.2f}' if isinstance(v, float) else str(v)
        print(f'{k:32} {fmt(ra[k]):>10} {fmt(rb[k]):>10}')
    print(f'\nB - A on {len(keys)} paired questions (95% bootstrap interval):')
    for name, f in [('dead end', lambda r: r['outcome'] == 'decline'), ('free reply', lambda r: r['outcome'] == 'ai'),
                    ('refused attempts', lambda r: r.get('rejected', 0))]:
        d, lo, hi = paired_ci(a, b, keys, f)
        print(f'  {name:18} {d:+.2f}  [{lo:+.2f}, {hi:+.2f}]')


if __name__ == '__main__':
    main()
