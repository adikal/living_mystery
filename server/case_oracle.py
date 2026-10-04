"""Z3 case oracle: an independent check of a mystery-kernel case, written without the kernel's code.

It answers three questions with Z3 (real clock minutes and walking times):
  feasible(case)          - is the true history physically possible? (one place at a time, travel takes time,
                            the crime lies in its window, the culprit is at the scene)
  candidates(case, ids)   - using only the listed evidence, which candidates could still have done it? For each
                            ruled-out candidate, the unsat core names the evidence that rules them out; for each
                            surviving one, a witness minute is an alternative story ("could have been there at T").
  check_case(case)        - publish gate: feasibility + uniqueness with all reachable evidence.

Semantics are re-derived here from the case records (claims, trust and defeat), so a shared bug in the Python
and JavaScript kernels would show up as a disagreement with this oracle.
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


def _claim(sign):
    c = sign.get('claim')
    return c if isinstance(c, dict) and c.get('kind') in ('place', 'time', 'trait', 'relation', 'possession', 'fact') else None


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


def _attr_ok(case, claim, actor):
    """Is a non-place, non-time claim compatible with this actor being the culprit? None = says nothing about them."""
    ppl = {p['id']: p for p in case['people']}
    k = claim['kind']
    if k == 'trait':
        return str((ppl.get(actor) or {}).get('traits', {}).get(claim['trait'])) == str(claim['value'])
    if k == 'possession' and not claim.get('person'):
        return any(p['person'] == actor and p['item'] == claim['item'] for p in case.get('possession', []))
    if k == 'relation' and not claim.get('a'):
        return any(r['a'] == actor and r['rel'] == claim['rel'] and (not claim.get('b') or r.get('b') == claim['b'])
                   for r in case.get('relations', []))
    return None


def candidates(case, visible):
    """For each candidate: sat (with a witness minute and where they could have come from) or unsat (with the
    evidence that rules them out), using only the trusted claims among `visible`."""
    z3 = _z3()
    tt = travel(case)
    q = case['question']
    scene = q['crime']['place']
    claims = trusted(case, visible)
    out = {}
    for h in q['candidates']:
        actor = (h.get('facts') or {}).get('actor')
        s = z3.Solver(); s.set(timeout=4000)
        t = z3.Int('t')
        w0, w1 = q['crime']['window']
        s.add(t >= w0, t <= w1)
        for sid, c in claims:
            if c['kind'] == 'time':
                s.assert_and_track(z3.And(t >= c['start'], t <= c['end']), sid)
            elif c['kind'] == 'place' and c.get('person') == actor and c['place'] != scene:
                gap = tt[c['place']][scene]
                # alibi: at c.place during [start, end], so at the scene only outside that span widened by the walk
                s.assert_and_track(z3.Or(t < c['start'] - gap, t > c['end'] + gap), sid)
            elif c['kind'] == 'fact':
                facts = h.get('facts') or {}
                if c['key'] in facts:
                    s.assert_and_track(z3.BoolVal(str(facts[c['key']]) == str(c['value'])), sid)
            else:
                ok = _attr_ok(case, c, actor)
                if ok is not None:
                    s.assert_and_track(z3.BoolVal(ok), sid)
        r = s.check()
        if r == z3.sat:
            m = s.model().eval(t, model_completion=True).as_long()
            out[h['id']] = {'status': 'sat', 'actor': actor, 'minute': m}
        elif r == z3.unsat:
            out[h['id']] = {'status': 'unsat', 'actor': actor, 'because': sorted(str(x) for x in s.unsat_core())}
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
