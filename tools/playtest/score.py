"""Objective scorecard for a playtest episode, from its steps and the game's private trace (docs/self-improvement.md, 5).

Everything here is computed by code; nothing is asked of a model. Each episode also yields problem records, each
with the step it happened at, its evidence and the layer it most likely comes from, for the optimizer to cluster.

    .venv/bin/python tools/playtest/score.py tools/playtest/runs/<batch>
"""
import json
import os
import sys
from collections import Counter
from statistics import mean as st_mean

STALL = 12          # actions without learning anything new: a stall worth reporting
HINT_WINDOW = 5     # a hint helped if the player learned something within this many actions after it
LOOP_REPEATS = 3    # the same action this many times: a loop


def _key(action):
    return json.dumps({k: v for k, v in (action or {}).items() if k != 'thinking'}, sort_keys=True)


def progress_points(trace):
    """Indices of steps where the player learned something: new evidence, a new reading, or fewer suspects left."""
    out, held, read, left = [], 0, 0, None
    for i, t in enumerate(trace):
        n = len((t.get('status') or {}).get('remaining') or [])
        if t.get('held', 0) > held or t.get('read', 0) > read or (left is not None and n < left):
            out.append(i)
        held, read, left = max(held, t.get('held', 0)), max(read, t.get('read', 0)), n
    return out


def pressed_after_decline(trace, window=5):
    """Mean number of the next `window` actions spent talking to the same person after they declined: a decline that
    closes the subject should send the player elsewhere."""
    after = [sum(1 for t in trace[i + 1:i + 1 + window] if (t.get('character') or {}).get('person') == c['person'])
             for i, c in ((i, t.get('character')) for i, t in enumerate(trace)) if c and c.get('neutral')]
    return round(sum(after) / len(after), 2) if after else None


def stalls(trace, points):
    """Runs of at least STALL steps between progress points: (start, end)."""
    edges, out = [-1] + points + [len(trace)], []
    for a, b in zip(edges, edges[1:]):
        if b - a - 1 >= STALL:
            out.append((a + 1, b - 1))
    return out


def loops(steps):
    """Actions repeated LOOP_REPEATS times or more (asking the same question, the same move, the same line)."""
    c = Counter(_key(s['action']) for s in steps if (s['action'] or {}).get('type') not in ('hint', 'wait', 'note'))
    return [(json.loads(k), n) for k, n in c.items() if n >= LOOP_REPEATS]


def score(ep):
    rep, steps = ep.get('report') or {}, ep.get('steps') or []
    trace = rep.get('trace') or []
    if ep.get('failure') or not trace:
        return {'id': ep['id'], 'failed': True, 'problems': [{'kind': 'bug', 'layer': 'harness', 'step': len(steps),
                                                              'evidence': (ep.get('failure') or 'no trace')[-300:]}]}
    points, chars = progress_points(trace), [t['character'] for t in trace if t.get('character')]
    accusations = [t['accusation'] for t in trace if t.get('accusation')]
    hints = [t['hint'] for t in trace if t.get('hint')]
    acts = [t for t in trace if t.get('kind') not in ('hint', 'note')]
    remaining = [len((t.get('status') or {}).get('remaining') or []) for t in trace]
    witnessed = sum(len(t.get('witnessed') or []) for t in trace)
    hours = max(1e-9, (rep['end_minute'] - rep['start_minute']) / 60)
    first_hint = next((i for i, t in enumerate(trace) if t.get('hint')), None)
    st = stalls(trace, points)
    hint_steps = [i for i, t in enumerate(trace) if t.get('hint')]
    helped = [i for i in hint_steps if any(i < j <= i + HINT_WINDOW for j in points)]
    metrics = {
        'solved': ep['outcome'] == 'solved',
        'correct': ep['outcome'] == 'solved' and bool(accusations) and accusations[-1]['suspect'] == rep['truth'],
        'outcome': ep['outcome'],
        'wrong_accusations': len(accusations) - (1 if ep['outcome'] == 'solved' else 0),
        'actions': len(acts), 'game_minutes': rep['end_minute'] - rep['start_minute'],
        'hints': len(hints), 'hint_max_level': max([h['level'] for h in hints], default=0),
        'narrowed_before_first_hint': (remaining[0] - remaining[first_hint]) if first_hint is not None else (remaining[0] - remaining[-1]),
        'hints_that_helped': round(len(helped) / len(hint_steps), 2) if hint_steps else None,
        'hint_level_needed': round(st_mean([t['hint']['level'] for i, t in enumerate(trace) if i in helped]), 2) if helped else None,
        'progress_steps': len(points), 'longest_stall': max([b - a + 1 for a, b in st], default=0), 'stalls': len(st),
        'loops': len(loops(steps)),
        'refused_actions': sum(1 for t in trace if t.get('error')),
        'character_turns': len(chars), 'character_fallbacks': sum(1 for c in chars if c['by'] == 'fallback'),
        'character_rejections': sum(c['rejected'] for c in chars),
        'neutral_replies': sum(1 for c in chars if c.get('neutral')),
        'pressed_after_decline': pressed_after_decline(trace),
        'witnessed_village_per_hour': round(witnessed / hours, 2),
        'suspects_left_at_end': remaining[-1], 'held_at_end': trace[-1].get('held', 0),
        'exceptions': sum(1 for t in trace if t.get('exception')),
    }
    return {'id': ep['id'], 'case': ep['case'], 'profile': ep['profile'], 'temperament': ep['temperament'], 'seed': ep['seed'],
            'metrics': metrics, 'problems': problems(ep, trace, steps, st, hint_steps, helped)}


def problems(ep, trace, steps, st, hint_steps=(), helped=()):
    """Problem records: what went wrong, where, with evidence, and the layer it most likely comes from."""
    out = []
    for a, b in st:
        out.append({'kind': 'stall', 'layer': 'hints' if any(t.get('hint') for t in trace[a:b + 1]) else 'generation',
                    'step': a, 'evidence': f'{b - a + 1} actions without learning anything; last hint {trace[b].get("hint_now")}',
                    'actions': [_key(s['action']) for s in steps[a:b + 1]][-6:]})
    for i in hint_steps:
        if i not in helped:
            out.append({'kind': 'hint_no_help', 'layer': 'hints', 'step': i,
                        'evidence': f"hint {trace[i]['hint']['id']} level {trace[i]['hint']['level']}: nothing learned in the next {HINT_WINDOW} actions"})
    for action, n in loops(steps):
        out.append({'kind': 'loop', 'layer': 'interface', 'step': None, 'evidence': f'{json.dumps(action)} repeated {n} times'})
    for i, (t, s) in enumerate(zip(trace, steps)):
        c = t.get('character')
        said = ' '.join(n['text'] for n in s['news'] if n.get('speaker') not in (None, 'You', 'Hint'))[:300]
        if c and c['by'] == 'fallback':
            out.append({'kind': 'fallback', 'layer': 'dialogue', 'step': i, 'person': c['person'], 'evidence': f"{c['text'][:160]} → {said}"})
        elif c and c.get('neutral'):
            out.append({'kind': 'stonewall', 'layer': 'dialogue', 'step': i, 'person': c['person'], 'evidence': f"{c['text'][:160]} → {said}"})
        if t.get('error'):
            out.append({'kind': 'refused', 'layer': 'interface', 'step': i, 'evidence': f"{json.dumps(s['action'])[:160]} → {t['error'][:160]}"})
        if t.get('exception'):
            out.append({'kind': 'bug', 'layer': 'engine', 'step': i, 'evidence': t['exception'][:300]})
        if t.get('accusation') and not (ep['outcome'] == 'solved' and i == len(trace) - 1):
            out.append({'kind': 'wrong_accusation', 'layer': 'player', 'step': i, 'evidence': json.dumps(t['accusation']) + ' → ' + said[:200]})
    if ep['outcome'] in ('quit', 'out_of_budget'):
        out.append({'kind': ep['outcome'], 'layer': 'generation', 'step': len(steps), 'evidence': f"{len((trace[-1].get('status') or {}).get('remaining') or [])} suspects left"})
    return out


def score_batch(folder):
    eps = [json.load(open(os.path.join(folder, f))) for f in sorted(os.listdir(folder)) if '__' in f and f.endswith('.json')]
    cards = [score(e) for e in eps]
    json.dump(cards, open(os.path.join(folder, 'scores.json'), 'w'), indent=1)
    return cards


if __name__ == '__main__':
    for c in score_batch(sys.argv[1]):
        print(c['id'], json.dumps(c.get('metrics'))[:300], len(c['problems']), 'problems')
