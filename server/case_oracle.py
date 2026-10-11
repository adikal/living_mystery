"""Z3 case oracle: an independent check of a mystery-kernel case, written without the kernel's code.

It answers three questions with Z3 (real clock minutes and walking times):
  feasible(case)          - is the true history physically possible? (one place at a time, travel takes time,
                            the crime lies in its window, the culprit is at the scene)
  candidates(case, ids)   - using only the listed evidence, which candidates could still have done it? For each
                            ruled-out candidate, the unsat core names the evidence that rules them out; for each
                            surviving one, a witness minute is an alternative story ("could have been there at T").
  check_case(case)        - publish gate: feasibility + uniqueness with all reachable evidence.

Semantics are re-derived here from the case records (claims, trust and defeat), so a shared bug in the Python
and JavaScript kernels would show up as a disagreement with this oracle. This is the reference semantics of claims
(docs/claims.md, section 4): a candidate survives iff the background laws, the trusted claims and "this candidate did
it" are satisfiable; consistent(case, ids) asks whether a set of claims can all be true.
"""
import json

HORIZON = 4 * 1440


def _z3():
    import z3
    return z3


def travel(case):
    places = [p['id'] for p in case['setting']['places']]
    inf = 10 ** 6
    d = {a: {b: 0 if a == b else inf for b in places} for a in places}
    for link in case['setting'].get('links', []):
        a, b, m = link['a'], link['b'], int(link['minutes'])
        if a in d and b in d:
            d[a][b] = d[b][a] = min(d[a][b], m)
    for k in places:
        for i in places:
            for j in places:
                d[i][j] = min(d[i][j], d[i][k] + d[k][j])
    return d


PREDICATES = ('wasAt', 'had', 'related', 'hasTrait', 'nobodyAt', 'onlyHad', 'crimeBetween', 'crimeFact',
              'culpritHad', 'culpritRelated', 'culpritTrait')


def _claim(sign):
    c = sign.get('claim')
    return c if isinstance(c, dict) and c.get('pred') in PREDICATES else None


def reachable(case):
    """Signs the player can obtain (access fixed point over 'requires')."""
    signs = {s['id']: s for s in case['signs']}
    got, changed = set(), True
    while changed:
        changed = False
        for sid, s in signs.items():
            if sid not in got and all(r in got for r in s.get('requires', []) or []):
                got.add(sid); changed = True
    return understood(case, got)


def understood(case, got):
    """Of the obtained signs `got`, those that can be read: every sign a sign needs is itself read, and every rule it
    needs is known (common, or taught by an obtained rule sign)."""
    signs = {s['id']: s for s in case['signs']}
    got = {sid for sid in got if sid in signs}
    rules = {r['id']: r for r in case.get('rules', [])}
    known = {rid for rid, r in rules.items() if r.get('knowledge') == 'common'}
    known |= {signs[sid].get('rule') for sid in got if signs[sid].get('kind') == 'rule'}
    read, changed = set(), True
    while changed:
        changed = False
        for sid in got - read:
            if all((n in read) if n in signs else (n in known) for n in signs[sid].get('needs', []) or []):
                read.add(sid); changed = True
    return read


def trusted(case, visible):
    """Visible claims that no visible sign defeats."""
    signs = {s['id']: s for s in case['signs']}
    vis = [sid for sid in visible if sid in signs]
    defeated = {d for sid in vis for d in (signs[sid].get('defeats') or [])}
    return [(sid, _claim(signs[sid])) for sid in vis if sid not in defeated and _claim(signs[sid])]


def feasible(case):
    """Z3: the true history is physically possible. Returns (ok, conflicts)."""
    z3 = _z3()
    tt = travel(case)
    s = z3.Solver(); s.set(timeout=4000)
    by_person = {}
    for e in case['events']:
        for p in [e.get('agent')] + list(e.get('others') or []):
            if p:
                by_person.setdefault(p, []).append(e)
    for p, evs in by_person.items():
        evs = sorted(evs, key=lambda e: (e['start'], e['end']))
        for a, b in zip(evs, evs[1:]):
            if a['place'] == b['place']:
                continue
            gap = tt[a['place']][b['place']]
            # b must start after a ends plus the walk (or a starts after b ends plus the walk)
            s.assert_and_track(z3.Or(z3.IntVal(b['start']) >= a['end'] + gap, z3.IntVal(a['start']) >= b['end'] + gap),
                               f"{p}:{a['id']}->{b['id']}")
    q = case['question']
    crime = next((e for e in case['events'] if e['id'] == q['crime']['event']), None)
    if not crime:
        return False, ['crime event missing']
    t = z3.Int('t_crime')
    w0, w1 = q['crime']['window']
    s.assert_and_track(z3.And(t >= crime['start'], t <= crime['end']), 'crime:during_event')
    s.assert_and_track(z3.And(t >= w0, t <= w1), 'crime:in_window')
    s.assert_and_track(z3.BoolVal(crime['place'] == q['crime']['place']), 'crime:at_scene')
    r = s.check()
    return (r == z3.sat), ([] if r == z3.sat else [str(x) for x in s.unsat_core()])


def _text(v):
    return 'True' if v is True else 'False' if v is False else 'None' if v is None else str(v)


def _encode(case, claims, h=None):
    """B, the claims and (when a candidate h is given) culprit(h), as Z3 constraints. Returns (solver, t, literals): each
    claim is assumed through its own Boolean literal, so an unsat core names claims."""
    z3 = _z3()
    walk = travel(case)
    q = case['question']
    actor = ((h or {}).get('facts') or {}).get('actor')
    people = [p['id'] for p in case['people']]
    supplies = {o['id'] for o in case.get('objects', []) if o.get('supply')}
    starts = [e['start'] for e in case['events']]
    ends = [e['end'] for e in case['events']]
    whole = (min(starts), max(ends)) if starts else (0, 0)
    inverse = {r['inverse']: r['rel'] for r in (case.get('vocabulary') or {}).get('relations', []) if r.get('inverse')}

    def triple(a, rel, b):
        return (b, inverse[rel], a) if rel in inverse else (a, rel, b)

    s = z3.Solver(); s.set(timeout=8000)
    t = z3.Int('t')
    s.add(t >= whole[0], t <= whole[1])          # the crime falls within the case; anything more comes from claims
    lits, facts = {}, {}

    def fact(key):            # the crime's value for a fact: one value each
        return facts.setdefault(key, z3.String(f'fact:{key}'))

    for k, v in ((h or {}).get('facts') or {}).items():
        if k != 'actor':
            s.add(fact(k) == z3.StringVal(_text(v)))
    # per fluent: anchors (start, end, value, literal) where the fluent has the value throughout, and forbidden
    # (start, end, value, literal) where it never has it; a literal of True is part of the hypothesis
    pos, neg, metric = {}, {}, {}

    def anchor(fluent, start, end, value, lit, walks=False):
        pos.setdefault(fluent, []).append((start, end, value, lit)); metric[fluent] = walks

    def forbid(fluent, start, end, value, lit, walks=False):
        neg.setdefault(fluent, []).append((start, end, value, lit)); metric.setdefault(fluent, walks)

    def span(c):
        return (c['from'] if isinstance(c.get('from'), int) else whole[0], c['to'] if isinstance(c.get('to'), int) else whole[1])

    def owned(item, person):
        return ((('has', person, item), True) if item in supplies else (('holder', item), person))

    def state(fluent, value, c, lit, walks=False):
        a, b = span(c)
        when = c.get('when', 'throughout')
        if when == 'never':
            forbid(fluent, a, b, value, lit, walks)
        elif when == 'sometime':
            w = z3.Int(f'w_{len(lits)}_{len(pos.get(fluent, []))}_{fluent}')
            s.add(z3.Implies(lit, z3.And(w >= a, w <= b)))
            anchor(fluent, w, w, value, lit, walks)
        else:
            anchor(fluent, a, b, value, lit, walks)

    for sid, c in claims:
        lit = lits[sid] = z3.Bool(f'claim:{sid}')
        p = c['pred']
        if p == 'wasAt':
            state(('at', c['person']), c['place'], c, lit, True)
        elif p == 'nobodyAt':
            for person in people:
                forbid(('at', person), c['from'], c['to'], c['place'], lit, True)
        elif p == 'had':
            state(*owned(c['item'], c['person']), c, lit)
        elif p == 'onlyHad':
            a, b = span(c)
            for person in people:
                if person not in c['people']:
                    fluent, value = owned(c['item'], person)
                    forbid(fluent, a, b, value, lit)
        elif p == 'related':
            state(('rel',) + triple(c['a'], c['rel'], c['b']), True, c, lit)
        elif p == 'hasTrait':
            state(('trait', c['person'], c['trait']), _text(c['value']), c, lit)
        elif p == 'crimeBetween':
            s.add(z3.Implies(lit, z3.And(t >= c['from'], t <= c['to'])))
        elif p == 'crimeFact':
            is_value = fact(c['key']) == z3.StringVal(_text(c['value']))
            s.add(z3.Implies(lit, z3.Not(is_value) if c.get('not') else is_value))
        elif actor:
            if p == 'culpritHad':
                fluent, value = owned(c['item'], actor)
            elif p == 'culpritRelated':
                fluent, value = ('rel',) + triple(actor, c['rel'], c['b']), True
            else:
                fluent, value = ('trait', actor, c['trait']), _text(c['value'])
            if isinstance(c.get('from'), int):          # culpritHad over an interval: at some minute of it
                if c.get('not'):
                    forbid(fluent, c['from'], c['to'], value, lit)
                else:
                    w = z3.Int(f'w_{sid}')
                    s.add(z3.Implies(lit, z3.And(w >= c['from'], w <= c['to'])))
                    anchor(fluent, w, w, value, lit)
            elif c.get('not'):
                forbid(fluent, t, t, value, lit)
            else:
                anchor(fluent, t, t, value, lit)
    if actor:
        anchor(('at', actor), t, t, q['crime']['place'], z3.BoolVal(True), True)

    def gap(fluent, x, y):
        if x == y:
            return 0
        return max(1, walk.get(x, {}).get(y, 10 ** 6)) if metric[fluent] else 1

    for fluent, anchors in pos.items():
        for i, (s1, e1, v1, l1) in enumerate(anchors):
            for s2, e2, v2, l2 in anchors[i + 1:]:
                if v1 != v2:
                    d = gap(fluent, v1, v2)
                    s.add(z3.Implies(z3.And(l1, l2), z3.Or(s2 >= e1 + d, s1 >= e2 + d)))
            for s2, e2, v2, l2 in neg.get(fluent, []):
                if v1 == v2:
                    s.add(z3.Implies(z3.And(l1, l2), z3.Or(e1 < s2, s1 > e2)))
    return s, t, lits


def consistent(case, ids):
    """Can the claims of these signs all be true together under the background laws?"""
    signs = {x['id']: x for x in case['signs']}
    claims = [(sid, _claim(signs[sid])) for sid in sorted(ids) if sid in signs and _claim(signs[sid])]
    s, _, lits = _encode(case, claims)
    return s.check(*lits.values()) == _z3().sat


def candidates(case, visible):
    """For each candidate: sat (with a witness minute) or unsat (with the evidence that rules them out), using only
    the trusted claims among `visible`."""
    z3 = _z3()
    claims = trusted(case, visible)
    out = {}
    for h in case['question']['candidates']:
        actor = (h.get('facts') or {}).get('actor')
        s, t, lits = _encode(case, claims, h)
        r = s.check(*lits.values())
        if r == z3.sat:
            out[h['id']] = {'status': 'sat', 'actor': actor, 'minute': s.model().eval(t, model_completion=True).as_long()}
        elif r == z3.unsat:
            out[h['id']] = {'status': 'unsat', 'actor': actor,
                            'because': sorted(str(x).removeprefix('claim:') for x in s.unsat_core())}
        else:
            out[h['id']] = {'status': 'unknown', 'actor': actor}
    return out


def survivors(case, visible):
    return sorted(h for h, r in candidates(case, visible).items() if r['status'] != 'unsat')


def check_case(case):
    """Publish gate: the true history is feasible and all reachable evidence leaves only the truth."""
    ok_f, conflicts = feasible(case)
    reach = reachable(case)
    cand = candidates(case, reach)
    surv = sorted(h for h, r in cand.items() if r['status'] != 'unsat')
    truth = case['question']['truth']
    errors = []
    if not ok_f:
        errors.append(f'Z3: the true history is not physically possible: {conflicts[:4]}')
    if surv != [truth]:
        errors.append(f'Z3: with all reachable evidence the survivors are {surv}, not [{truth}]')
    return {'ok': not errors, 'errors': errors, 'feasible': ok_f, 'survivors': surv,
            'ruled_out': {h: r['because'] for h, r in cand.items() if r['status'] == 'unsat'}}


def alternative(case, held, accused_actor):
    """Accusation feedback: another candidate who, on the held evidence alone, could have done it, with a minute."""
    cand = candidates(case, held)
    for hid, r in cand.items():
        if r['status'] == 'sat' and r['actor'] != accused_actor:
            return {'candidate': hid, 'actor': r['actor'], 'minute': r['minute']}
    return None


if __name__ == '__main__':
    import sys
    for path in sys.argv[1:]:
        print(path, json.dumps(check_case(json.load(open(path)))))
