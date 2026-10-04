"""Batch report: objective metrics and judged scores by profile and case, and problems grouped for the optimizer.

    .venv/bin/python tools/playtest/report.py tools/playtest/runs/<batch>
    .venv/bin/python tools/playtest/report.py tools/playtest/runs/<after> --baseline tools/playtest/runs/<before>

Writes report.md and report.json in the batch folder. With a baseline, episodes are paired by case, profile and seed,
and each metric's change is reported with a bootstrap 90% interval, so a change is judged on matched play.
"""
import argparse
import json
import os
import random
import statistics as st
from collections import defaultdict

METRICS = ['solved', 'correct', 'actions', 'hints', 'hints_that_helped', 'longest_stall', 'loops', 'character_fallbacks', 'neutral_replies', 'pressed_after_decline',
           'character_rejections', 'refused_actions', 'wrong_accusations', 'witnessed_village_per_hour', 'exceptions']
JUDGED = ['challenge', 'frustration', 'confusion', 'character_quality', 'fairness', 'liveliness', 'fun']


def load(folder):
    cards = {c['id']: c for c in json.load(open(os.path.join(folder, 'scores.json')))}
    judged_path = os.path.join(folder, 'judged.json')
    for v in (json.load(open(judged_path)) if os.path.exists(judged_path) else []):
        if v['id'] in cards:
            cards[v['id']]['judged'] = {d: (s or {}).get('score') for d, s in v['scores'].items()}
            cards[v['id']]['judged_problems'] = v['problems']
            cards[v['id']]['summary'] = v.get('summary')
    return cards


def row(cs):
    def mean(k, src='metrics'):
        vals = [float(c[src][k]) for c in cs if c.get(src) and c[src].get(k) is not None]   # None: not applicable
        return round(st.mean(vals), 2) if vals else None
    return {**{k: mean(k) for k in METRICS}, **{k: mean(k, 'judged') for k in JUDGED}, 'n': len(cs)}


def pair_key(c):
    """The same game before and after a change: case, profile, temperament and seed."""
    return (c['case'], c['profile'], c.get('temperament'), c['seed'])


def bootstrap(diffs, n=2000, seed=0):
    if not diffs:
        return None
    rng = random.Random(seed)
    means = sorted(st.mean(rng.choice(diffs) for _ in diffs) for _ in range(n))
    return round(st.mean(diffs), 3), round(means[int(.05 * n)], 3), round(means[int(.95 * n)], 3)


def compare(after, before):
    b = {pair_key(c): c for c in before.values() if c.get('metrics')}
    pairs = [(c, b[pair_key(c)]) for c in after.values() if c.get('metrics') and pair_key(c) in b]
    out = {}
    for k in METRICS:
        out[k] = bootstrap([float(x['metrics'][k]) - float(y['metrics'][k]) for x, y in pairs
                            if x['metrics'].get(k) is not None and y['metrics'].get(k) is not None])
    for k in JUDGED:
        out[k] = bootstrap([float(x['judged'][k]) - float(y['judged'][k]) for x, y in pairs
                            if x.get('judged', {}).get(k) is not None and y.get('judged', {}).get(k) is not None])
    return {'pairs': len(pairs), 'deltas': out}


def clusters(cards):
    """Problems grouped by (layer, kind), with how many episodes and profiles they touch, and examples."""
    groups = defaultdict(list)
    for c in cards.values():
        for p in c.get('problems', []) + c.get('judged_problems', []):
            groups[(p.get('layer'), p.get('kind'))].append((c, p))
    rows = []
    for (layer, kind), items in groups.items():
        eps, profiles = {c['id'] for c, _ in items}, {c['profile'] for c, _ in items}
        sev = st.mean([float(p.get('severity', 2)) for _, p in items])
        rows.append({'layer': layer, 'kind': kind, 'count': len(items), 'episodes': len(eps), 'profiles': sorted(profiles),
                     'severity': round(sev, 1), 'weight': round(len(eps) * sev * len(profiles), 1),
                     'examples': [{'episode': c['id'], 'step': p.get('step'), 'evidence': str(p.get('quote') or p.get('evidence') or '')[:240],
                                   'why': p.get('why')} for c, p in items[:6]]})
    return sorted(rows, key=lambda r: -r['weight'])


def markdown(name, cards, by_profile, by_case, groups, comparison):
    def table(title, rows):
        cols = ['n'] + METRICS + JUDGED
        lines = [f'### {title}', '', '| | ' + ' | '.join(cols) + ' |', '|' + '---|' * (len(cols) + 1)]
        lines += [f'| {k} | ' + ' | '.join('' if v.get(c) is None else str(v.get(c)) for c in cols) + ' |' for k, v in rows.items()]
        return lines + ['']
    out = [f'# Playtest report: {name}', '', f'{len(cards)} episodes.', '']
    out += table('By profile', by_profile) + table('By case', by_case)
    if comparison:
        out += [f"### Change against the baseline ({comparison['pairs']} matched pairs; mean, 90% interval)", '',
                '| metric | mean change | interval |', '|---|---|---|']
        out += [f'| {k} | {v[0]} | [{v[1]}, {v[2]}] |' for k, v in comparison['deltas'].items() if v]
        out.append('')
    out += ['### Problems, grouped (weight = episodes × severity × profiles)', '']
    for g in groups[:15]:
        out.append(f"- **{g['layer']} / {g['kind']}**: {g['count']} in {g['episodes']} episodes, profiles {', '.join(g['profiles'])}, "
                   f"severity {g['severity']}")
        out += [f"  - `{e['episode']}` step {e['step']}: {e['evidence']}" + (f" — {e['why']}" if e.get('why') else '') for e in g['examples'][:3]]
    return '\n'.join(out) + '\n'


def main():
    a = argparse.ArgumentParser()
    a.add_argument('folder')
    a.add_argument('--baseline')
    args = a.parse_args()
    cards = load(args.folder)
    by = lambda key: {k: row([c for c in cards.values() if c.get(key) == k]) for k in sorted({c.get(key) for c in cards.values() if c.get(key)})}
    by_case = {os.path.basename(k)[:-5]: v for k, v in by('case').items()}
    groups = clusters(cards)
    comparison = compare(cards, load(args.baseline)) if args.baseline else None
    name = os.path.basename(os.path.normpath(args.folder))
    json.dump({'by_profile': by('profile'), 'by_case': by_case, 'clusters': groups, 'comparison': comparison},
              open(os.path.join(args.folder, 'report.json'), 'w'), indent=1)
    open(os.path.join(args.folder, 'report.md'), 'w').write(markdown(name, cards, by('profile'), by_case, groups, comparison))
    print(open(os.path.join(args.folder, 'report.md')).read())


if __name__ == '__main__':
    main()
