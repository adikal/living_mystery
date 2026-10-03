"""Case difficulty: computed features of the certified case, a model over them, and a level (easy / medium / hard).

    features(case)   what the certifier measures: depth of reasoning, lies to see through, misdirection, leniency
    score(f, model)  the model's number: a weighted sum (the hand-set prior), or 1 - P(clean solve) once fitted
    level(s, model)  the band the score falls in
    rate(case)       {'v', 'score', 'level', 'features'}: stored on the case and its index entry at publish

The model is data (settings/difficulty.json). `fit` replaces it with a logistic regression on logged plays, once there
are enough of them. See docs/difficulty.md.

    .venv/bin/python tools/refine-c/difficulty.py rate          # rate every published case and its index entry
    .venv/bin/python tools/refine-c/difficulty.py plays         # the plays the logs record, with their labels
    .venv/bin/python tools/refine-c/difficulty.py fit [--force] # fit the logistic model on those plays
"""
import glob
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
MODEL_PATH = os.path.join(HERE, 'settings', 'difficulty.json')
MIN_ACTIONS = 10
FEATURES = ('depth', 'lies_on_path', 'lies_other', 'herrings_aimed', 'herrings_other', 'lenient_motives')


def load_model(path=MODEL_PATH):
    return json.load(open(path))


# ---- features ----------------------------------------------------------------------------------------------------

def features(case, report=None):
    """Every feature comes from the certifier's report on the true history; nothing is read from wording."""
    sys.path.insert(0, HERE)
    from refine import certify, actor_of, hyp_map
    r = report or certify(case)
    signs = {x['id']: x for x in case['signs']}
    false, key = set(r['false_signs']), set(r['key'])
    # a lie on the path: the solution uses a clue that defeats it, so the player must see through it to solve
    on_path = {d for k in key for d in (signs.get(k, {}).get('defeats') or []) if d in false}
    # misdirection aimed at the suspect the obvious reading points to
    hyps = hyp_map(case)
    obvious = {actor_of(hyps[h]) for h in r['surface'] if h != case['question']['truth'] and h in hyps}
    aimed = [h for h in r['herrings'] if signs[h].get('about') in obvious]
    accepted = (case.get('answer') or {}).get('motives') or [None]
    return {'depth': max(r['solve_depth'] or 0, r['mmo_depth'] or 0),
            'lies_on_path': len(on_path), 'lies_other': len(false - on_path),
            'herrings_aimed': len(aimed), 'herrings_other': len(r['herrings']) - len(aimed),
            'lenient_motives': max(0, len(accepted) - 1)}


# ---- model -------------------------------------------------------------------------------------------------------

def linear(f, model):
    return model.get('bias', 0.0) + sum(model['weights'].get(k, 0.0) * f.get(k, 0) for k in FEATURES)


def score(f, model):
    """Higher is harder. A fitted logistic model predicts P(clean solve); difficulty is its complement."""
    z = linear(f, model)
    return 1.0 - 1.0 / (1.0 + math.exp(-z)) if model['kind'] == 'logistic' else z


def level(s, model):
    for upper, name in model['bands']:
        if upper is None or s < upper:
            return name
    return model['bands'][-1][1]


def rate(case, report=None, model=None):
    model = model or load_model()
    f = features(case, report)
    s = score(f, model)
    return {'v': model['v'], 'score': round(s, 3), 'level': level(s, model), 'features': f}


# ---- generation targets ------------------------------------------------------------------------------------------

def target(name=None, model=None):
    """The generation profile for a level (settings/difficulty.json 'targets'); medium when unnamed or unknown."""
    model = model or load_model()
    name = name if name in model['targets'] else 'medium'
    return {'level': name, **model['targets'][name]}


def rank(name, model=None):
    return (model or load_model())['levels'].index(name)


def targets_met(case, report, profile, model=None):
    """What a case still lacks for its target, as plain reasons (empty: stop). Structural minimums first, then the
    rating: a medium or hard case keeps going until it rates at least that hard."""
    model = model or load_model()
    th = report.get('threads') or {}
    innocents = [d for h, d in th.items() if h != 'truth']
    f = features(case, report)
    need = []
    if (report.get('solve_depth') or 0) < profile['depth']:
        need.append(f"solve depth {report.get('solve_depth')} < {profile['depth']}")
    if not innocents or None in innocents or min(innocents) < profile['innocents']:
        need.append(f"an innocent is cleared by layer {min([d for d in innocents if d is not None] or [0])} (< {profile['innocents']})")
    if (th.get('truth') or 0) < profile['truth']:
        need.append(f"the truth is clear by layer {th.get('truth')} (< {profile['truth']})")
    if profile['twist'] and not report.get('twist'):
        need.append('no twist')
    if len(report.get('herrings') or []) < profile['herrings'][0]:
        need.append(f"{len(report.get('herrings') or [])} red herrings (< {profile['herrings'][0]})")
    if f['herrings_aimed'] < profile['herrings_aimed']:
        need.append('no red herring aimed at the obvious suspect')
    pil = report.get('pillar_signs') or {}
    if not pil.get('motive') or not pil.get('means'):
        need.append('motive and means evidence')
    got = level(score(f, model), model)
    if not need and rank(got, model) < rank(profile['level'], model):
        need.append(f'rates {got}, target {profile["level"]}')
    return need


# ---- backfill ----------------------------------------------------------------------------------------------------

def published():
    out = f'{ROOT}/dist/cases/generated'
    return [(f'{out}/index.json', out), (f'{out}/live/index.json', out)]


def rate_all(log=print):
    """Rate every published case and copy the rating into its index entry (adds no fact: a measurement)."""
    model = load_model()
    for idx_path, base in published():
        if not os.path.exists(idx_path):
            continue
        index = json.load(open(idx_path))
        for entry in index:
            path = f"{base}/{entry['file']}"
            case = json.load(open(path))
            case['difficulty'] = rate(case, model=model)
            json.dump(case, open(path, 'w'), indent=1)
            entry['difficulty'] = {'level': case['difficulty']['level'], 'score': case['difficulty']['score']}
            log(f"{entry['id']:30} {entry['difficulty']['level']:7} {entry['difficulty']['score']}")
        json.dump(index, open(idx_path, 'w'), indent=1)


# ---- plays and fitting -------------------------------------------------------------------------------------------

def plays(log_path=f'{ROOT}/logs/game.log', model=None):
    """One row per play in the game log (a case_start up to the next one): the case's features and whether it was
    solved cleanly (solved, within the hint and wrong-accusation limits the model names)."""
    model = model or load_model()
    limit = model['clean_solve']
    rows, cur = [], None
    def close():
        if cur and cur['case']:
            rows.append(cur)
    for line in open(log_path):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        kind = r.get('kind')
        if kind == 'case_start':
            if cur and cur['case'] == r.get('id') and not cur['solved']:
                continue                      # the same investigation resumed (a reload), not a new play
            close()
            cur = {'case': r.get('id'), 'hints': 0, 'wrong': 0, 'solved': False, 'actions': 0}
        elif cur and r.get('caseId') == cur['case']:
            if kind == 'action':
                cur['actions'] += 1
            elif kind == 'hint':
                cur['hints'] += 1
            elif kind == 'accusation':
                if r.get('status') == 'supported':
                    cur['solved'] = True
                elif not cur['solved']:
                    cur['wrong'] += 1
    close()
    files = {os.path.basename(f)[:-5]: f for f in glob.glob(f'{ROOT}/dist/cases/generated/**/mk-*.json', recursive=True)}
    out = []
    for p in rows:
        if p['case'] not in files or p['actions'] < MIN_ACTIONS:
            continue                          # a case opened and left is not a play
        case = json.load(open(files[p['case']]))
        p['features'] = (case.get('difficulty') or {}).get('features') or features(case)
        p['clean'] = p['solved'] and p['hints'] <= limit['max_hints'] and p['wrong'] <= limit['max_wrong_accusations']
        out.append(p)
    return out


def fit_logistic(X, y, l2=1.0, steps=4000, rate_=0.05):
    """Plain gradient descent on the L2-regularised log loss (features standardised); returns (bias, weights) in the
    original feature units. Small and dependency-free: the data are tens of plays, not millions."""
    n, d = len(X), len(X[0])
    mu = [sum(r[j] for r in X) / n for j in range(d)]
    sd = [math.sqrt(sum((r[j] - mu[j]) ** 2 for r in X) / n) or 1.0 for j in range(d)]
    Z = [[(r[j] - mu[j]) / sd[j] for j in range(d)] for r in X]
    b, w = 0.0, [0.0] * d
    for _ in range(steps):
        gb, gw = 0.0, [l2 * wj / n for wj in w]
        for z, t in zip(Z, y):
            p = 1.0 / (1.0 + math.exp(-(b + sum(wj * zj for wj, zj in zip(w, z)))))
            gb += (p - t) / n
            for j in range(d):
                gw[j] += (p - t) * z[j] / n
        b -= rate_ * gb
        w = [wj - rate_ * g for wj, g in zip(w, gw)]
    weights = [w[j] / sd[j] for j in range(d)]
    return b - sum(weights[j] * mu[j] for j in range(d)), weights


def fit(force=False, log=print):
    model = load_model()
    rows = plays(model=model)
    if len(rows) < model['min_plays_to_fit'] and not force:
        log(f"{len(rows)} plays logged; the model needs {model['min_plays_to_fit']} to fit (use --force to fit anyway)")
        return None
    if len({r['clean'] for r in rows}) < 2:
        log('every play has the same outcome: nothing to fit')
        return None
    X = [[r['features'][k] for k in FEATURES] for r in rows]
    bias, weights = fit_logistic(X, [1.0 if r['clean'] else 0.0 for r in rows])
    fitted = {**model, 'v': model['v'] + 1, 'kind': 'logistic', 'source': f'logistic fit on {len(rows)} plays',
              'bias': round(bias, 4), 'weights': {k: round(w, 4) for k, w in zip(FEATURES, weights)},
              'bands': [[0.4, 'easy'], [0.7, 'medium'], [None, 'hard']]}
    json.dump(fitted, open(MODEL_PATH, 'w'), indent=1)
    log(f"fitted on {len(rows)} plays: {fitted['weights']} bias {fitted['bias']}; run `rate` to re-rate the cases")
    return fitted


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'rate'
    if cmd == 'rate':
        rate_all()
    elif cmd == 'plays':
        for p in plays():
            print(p['case'], 'solved' if p['solved'] else 'unsolved', 'hints', p['hints'], 'wrong', p['wrong'], 'clean' if p['clean'] else '')
    elif cmd == 'fit':
        fit(force='--force' in sys.argv)
    else:
        sys.exit(__doc__)
