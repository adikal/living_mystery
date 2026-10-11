"""Claims, version 2: the temporal language of clues, their truth in the history, and reasoning from what the player
knows. Specification: docs/claims.md. JavaScript twin: dist/mk/claims.mjs (parity.py keeps them identical); reference
semantics in Z3: server/case_oracle.py.
"""
CLAIMS_VERSION = 2
INF = 10 ** 9

PREDICATES = {
    'wasAt': ['person', 'place'], 'had': ['person', 'item'], 'related': ['a', 'rel', 'b'],
    'hasTrait': ['person', 'trait', 'value'], 'nobodyAt': ['place'], 'onlyHad': ['item', 'people'], 'crimeBetween': [],
    'crimeFact': ['key', 'value'], 'culpritHad': ['item'], 'culpritRelated': ['rel', 'b'], 'culpritTrait': ['trait', 'value'],
}
FLUENT = {'wasAt', 'had', 'related', 'hasTrait'}
NEGATABLE = {'crimeFact', 'culpritHad', 'culpritRelated', 'culpritTrait'}
NEEDS_INTERVAL = {'wasAt', 'nobodyAt', 'crimeBetween'}
WHEN = {'throughout', 'sometime', 'never'}
CULPRIT_PREDICATES = {'culpritHad', 'culpritRelated', 'culpritTrait'}
T = 'T'   # the crime minute, until it is fixed


def py_str(v):
    """Python-compatible stringification for value comparison (as the JS twin's pyStr)."""
    return 'True' if v is True else 'False' if v is False else 'None' if v is None else str(v)


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def claim_of(sign):
    x = (sign or {}).get('claim')
    return x if isinstance(x, dict) and x.get('pred') in PREDICATES else None


# ----------------------------------------------------------------------------------------------------
# The setting and the case's vocabulary
# ----------------------------------------------------------------------------------------------------

def travel_table(case):
    places = [p['id'] for p in case['setting']['places']]
    d = {a: {b: (0 if a == b else INF) for b in places} for a in places}
    for e in case['setting'].get('links', []):
        if e['a'] in d and e['b'] in d:
            d[e['a']][e['b']] = d[e['b']][e['a']] = min(d[e['a']][e['b']], e['minutes'])
    for k in places:
        for i in places:
            for j in places:
                if d[i][k] + d[k][j] < d[i][j]:
                    d[i][j] = d[i][k] + d[k][j]
    return d


def _separation(tt, metric):
    return lambda x, y: 0 if x == y else (max(1, tt.get(x, {}).get(y, INF)) if metric else 1)


def span(case):
    evs = case.get('events') or []
    return [min(e['start'] for e in evs), max(e['end'] for e in evs)] if evs else [0, 0]


def relation_reader(case):
    inverse = {r['inverse']: r['rel'] for r in ((case.get('vocabulary') or {}).get('relations') or []) if r.get('inverse')}
    return lambda a, rel, b: (b, inverse[rel], a) if rel in inverse else (a, rel, b)


def _supply(case, item):
    return bool(next((o for o in case.get('objects') or [] if o['id'] == item), {}).get('supply'))


def crime_event(case):
    return next((e for e in case.get('events') or [] if e['id'] == ((case.get('question') or {}).get('crime') or {}).get('event')), None)


def crime_minute(case):
    e = crime_event(case)
    return e['start'] if e else None


def actor_of(h):
    return ((h or {}).get('facts') or {}).get('actor')


def truth_actor(case):
    q = case.get('question') or {}
    return actor_of(next((h for h in q.get('candidates') or [] if h['id'] == q.get('truth')), None))


def victim_of(case):
    return case.get('victim') or next((e['agent'] for e in case.get('events') or [] if e.get('type') == 'death' and e.get('agent')), None)


def _key(parts):
    return ':'.join('' if v is None else str(v) for v in parts)


def _interval(case, x):
    s0, s1 = span(case)
    return [x['from'] if _num(x.get('from')) else s0, x['to'] if _num(x.get('to')) else s1]


# ----------------------------------------------------------------------------------------------------
# Validation of claims and of the records they are judged against
# ----------------------------------------------------------------------------------------------------

def _rel_names(case):
    return {n for r in ((case.get('vocabulary') or {}).get('relations') or []) for n in (r.get('rel'), r.get('inverse')) if n}


def claim_errors(case, sid, x):
    errs = []
    people = {p['id'] for p in case.get('people') or []}
    places = {p['id'] for p in case['setting']['places']}
    items = {o['id'] for o in case.get('objects') or []}
    rels = _rel_names(case)
    err = lambda m: errs.append(f"sign {sid}: {x['pred']} claim {m}")
    for a in PREDICATES[x['pred']]:
        if x.get(a) is None or x.get(a) == '':
            err(f"needs '{a}'")
    if errs:
        return errs
    for k in ('person', 'a'):
        if x.get(k) is not None and x[k] not in people:
            err(f'names unknown person {x[k]}')
    # the other party of a relation may be a person, a thing or a place (a debt to the building society)
    if x.get('b') is not None and x['b'] not in people and x['b'] not in items and x['b'] not in places:
        err(f"names {x['b']}, which is not a person, object or place of the case")
    if x['pred'] == 'onlyHad':
        for p in x['people'] if isinstance(x['people'], list) else []:
            if p not in people:
                err(f'names unknown person {p}')
    if x.get('place') is not None and x['place'] not in places:
        err(f"names unknown place {x['place']}")
    if x.get('item') is not None and x['item'] not in items:
        err(f"names {x['item']}, which is not among the case's objects")
    if x.get('rel') is not None and x['rel'] not in rels:
        err(f"uses relation {x['rel']}, which is not in vocabulary.relations")
    if x['pred'] == 'onlyHad' and not isinstance(x['people'], list):
        err("needs 'people' as a list")
    has = lambda k: _num(x.get(k))
    if x['pred'] in NEEDS_INTERVAL and not (has('from') and has('to')):
        err("needs 'from' and 'to' (minutes)")
    if (x.get('from') is not None and not has('from')) or (x.get('to') is not None and not has('to')):
        err("has non-numeric 'from' or 'to'")
    if has('from') and has('to') and x['from'] > x['to']:
        err('ends before it starts')
    if x.get('when') is not None and not (x['pred'] in FLUENT and x['when'] in WHEN):
        err(f"'when' must be throughout, sometime or never, on {', '.join(sorted(FLUENT, key=['wasAt', 'had', 'related', 'hasTrait'].index))}")
    if x.get('not') is not None and not (x['pred'] in NEGATABLE and isinstance(x['not'], bool)):
        err(f"'not' is allowed only on {', '.join(sorted(NEGATABLE, key=['crimeFact', 'culpritHad', 'culpritRelated', 'culpritTrait'].index))}")
    return errs


EFFECT_KEYS = {'take': 'take', 'give': 'give,to', 'lose': 'lose', 'relate': 'relate,to', 'trait': 'trait,value'}


def record_errors(case):
    errs = []
    people = {p['id'] for p in case.get('people') or []}
    items = {o['id'] for o in case.get('objects') or []}
    rels = _rel_names(case)
    held = {}
    for h in case.get('holdings') or []:
        if h['person'] not in people:
            errs.append(f"holdings: unknown person {h['person']}")
        if h['item'] not in items:
            errs.append(f"holdings: {h['item']} is not among the case's objects")
        held.setdefault(h['item'], []).append(h['person'])
    for i, ps in held.items():
        if len(ps) > 1 and not _supply(case, i):
            errs.append(f"holdings: {i} is a single object but is held by {' and '.join(ps)}; mark it \"supply\": true if many may have it")
    for r in case.get('relations') or []:
        if r['rel'] not in rels:
            errs.append(f"relations: {r['rel']} is not in vocabulary.relations")
    for e in case.get('events') or []:
        for f in e.get('effects') or []:
            keys = ','.join(sorted(f))
            kind = next((k for k in EFFECT_KEYS if k in f), None)
            if not kind or keys != EFFECT_KEYS[kind]:
                errs.append(f"event {e['id']}: effect {_js(f)} must be one of {{take}}, {{give, to}}, {{lose}}, {{relate, to}}, {{trait, value}}")
                continue
            if not e.get('agent'):
                errs.append(f"event {e['id']}: an effect needs the event's agent")
            if kind in ('take', 'give', 'lose') and f[kind] not in items:
                errs.append(f"event {e['id']}: {f[kind]} is not among the case's objects")
            if f.get('to') is not None and f['to'] not in people:
                errs.append(f"event {e['id']}: effect names unknown person {f['to']}")
            if kind == 'relate' and f['relate'] not in rels:
                errs.append(f"event {e['id']}: relation {f['relate']} is not in vocabulary.relations")
    crime = crime_event(case)
    q = case.get('question') or {}
    truth = next((h for h in q.get('candidates') or [] if h['id'] == q.get('truth')), None)
    if crime and truth:
        for k, v in (truth.get('facts') or {}).items():
            if k == 'actor':
                continue
            if k not in (crime.get('facts') or {}):
                errs.append(f"crime event {crime['id']}: its facts must give '{k}' (the true candidate's {k} is {py_str(v)})")
            elif py_str(crime['facts'][k]) != py_str(v):
                errs.append(f"crime event {crime['id']}: its {k} is {py_str(crime['facts'][k])}, but the true candidate's is {py_str(v)}")
    w = (q.get('crime') or {}).get('window')
    if crime and w and not (w[0] <= crime['start'] <= w[1]):
        errs.append(f"the crime event starts at {crime['start']}, outside the crime window")
    return errs


def _js(v):
    import json
    return json.dumps(v, separators=(',', ':'), ensure_ascii=False)


# ----------------------------------------------------------------------------------------------------
# The history: fluents read from the records (docs/claims.md section 3)
# ----------------------------------------------------------------------------------------------------

def _timeline(initial, changes):
    tl = [[-INF, initial]]
    for m, v in sorted(changes, key=lambda p: p[0]):
        if tl[-1][0] == m:
            tl[-1][1] = v
        else:
            tl.append([m, v])
    return tl


def _values_in(tl, s, e):
    out = []
    for i, (frm, v) in enumerate(tl):
        to = tl[i + 1][0] - 1 if i + 1 < len(tl) else INF
        if frm <= e and to >= s and v not in out:
            out.append(v)
    return out


def _value_at(tl, m):
    v = _values_in(tl, m, m)
    return v[0] if v else None


def _merge(iv):
    out = []
    for s, e in sorted((x for x in iv if x[0] <= x[1]), key=lambda p: (p[0], p[1])):
        if out and s <= out[-1][1] + 1:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return out


def _covers(iv, s, e):
    return any(a <= s and e <= b for a, b in _merge(iv))


def _meets(iv, s, e):
    return any(a <= e and b >= s for a, b in iv)


class History:
    """Everything the claims are judged against, read once from the records."""

    def __init__(self, case, tt=None):
        self.case, self.tt = case, tt or travel_table(case)
        sep, victim = _separation(self.tt, True), victim_of(case)
        self.people = [p['id'] for p in case.get('people') or []]
        by_person = {}
        for ev in case.get('events') or []:
            for p in [ev.get('agent')] + list(ev.get('others') or []):
                if p:
                    by_person.setdefault(p, []).append(ev)
        self.certain, self._evs, self._sep, self._victim = {}, {}, sep, victim
        for p in self.people:
            evs = sorted(by_person.get(p, []), key=lambda e: (e['start'], e['end']))
            cert = [[e['start'], e['end'], e['place']] for e in evs]
            for a, b in zip(evs, evs[1:]):
                if a['place'] == b['place']:
                    cert.append([a['end'] + 1, b['start'] - 1, a['place']])
            if p == victim and evs:
                cert.append([evs[-1]['end'] + 1, INF, evs[-1]['place']])
            self.certain[p], self._evs[p] = cert, evs
        self._read = relation_reader(case)

    def possible(self, p, l):
        """Where p may be in the minutes the events leave undetermined, as intervals of minutes at place l."""
        cert, evs, sep = self.certain.get(p, []), self._evs.get(p, []), self._sep
        iv = [[s, e] for s, e, pl in cert if pl == l]
        if not evs:
            return [[-INF, INF]]
        first, last = evs[0], evs[-1]
        iv.append([-INF, first['start'] - sep(l, first['place']) - (1 if l == first['place'] else 0)])
        for a, b in zip(evs, evs[1:]):
            x, y, e1, s2 = a['place'], b['place'], a['end'], b['start']
            if x == y:
                continue
            iv.append([e1 + 1, s2 - sep(x, y)] if l == x else [e1 + sep(x, y), s2 - 1] if l == y else [e1 + sep(x, l), s2 - sep(l, y)])
        if p != self._victim:
            iv.append([last['end'] + (1 if l == last['place'] else sep(last['place'], l)), INF])
        return _merge(iv)

    def _effects(self, kind):
        return [(ev, f) for ev in self.case.get('events') or [] for f in ev.get('effects') or [] if kind in f]

    def holder(self, item):
        c = self.case
        first = next((h['person'] for h in c.get('holdings') or [] if h['item'] == item), None)
        return _timeline(first, [[ev['start'], ev['agent']] for ev, f in self._effects('take') if f['take'] == item] +
                         [[ev['end'] + 1, f['to']] for ev, f in self._effects('give') if f['give'] == item] +
                         [[ev['end'] + 1, None] for ev, f in self._effects('lose') if f['lose'] == item])

    def access(self, p, item):
        c = self.case
        return _timeline(any(h['item'] == item and h['person'] == p for h in c.get('holdings') or []),
                         [[ev['start'], True] for ev, f in self._effects('take') if f['take'] == item and ev['agent'] == p] +
                         [[ev['end'] + 1, True] for ev, f in self._effects('give') if f['give'] == item and f['to'] == p] +
                         [[ev['end'] + 1, False] for ev, f in self._effects('lose') if f['lose'] == item and ev['agent'] == p])

    def related(self, a, rel, b):
        key = self._read(a, rel, b)
        return _timeline(any(self._read(r['a'], r['rel'], r.get('b')) == key for r in self.case.get('relations') or []),
                         [[ev['start'], True] for ev, f in self._effects('relate') if self._read(ev['agent'], f['relate'], f['to']) == key])

    def trait(self, p, k):
        person = next((x for x in self.case.get('people') or [] if x['id'] == p), {})
        return _timeline(py_str((person.get('traits') or {}).get(k)),
                         [[ev['end'] + 1, py_str(f['value'])] for ev, f in self._effects('trait') if ev['agent'] == p and f['trait'] == k])


def _mode(vals, target, when):
    if when == 'throughout':
        return len(vals) == 1 and target in vals
    return target not in vals if when == 'never' else target in vals


def truth_of(case, H, x, culprit=None):
    """Truth of a claim in the history: True, False, or None when the history does not decide it. culprit: whom the
    culprit predicates are read about (default the true culprit)."""
    culprit = truth_actor(case) if culprit is None else culprit
    s, e = _interval(case, x)
    when, t = x.get('when') or 'throughout', crime_minute(case)
    neg = lambda v: None if v is None else (not v if x.get('not') else v)
    p = x['pred']
    if p == 'wasAt':
        cert = [[a, b] for a, b, pl in H.certain.get(x['person'], []) if pl == x['place']]
        poss = H.possible(x['person'], x['place']) if x['person'] in H.certain else []
        some = True if _meets(cert, s, e) else False if not _meets(poss, s, e) else None
        if when == 'throughout':
            return True if _covers(cert, s, e) else False if not _covers(poss, s, e) else None
        return (None if some is None else not some) if when == 'never' else some
    if p == 'nobodyAt':
        if any(_meets([[a, b] for a, b, pl in H.certain[q] if pl == x['place']], s, e) for q in H.people):
            return False
        return True if all(not _meets(H.possible(q, x['place']), s, e) for q in H.people) else None
    if p == 'had':
        if _supply(case, x['item']):
            return _mode(_values_in(H.access(x['person'], x['item']), s, e), True, when)
        return _mode(_values_in(H.holder(x['item']), s, e), x['person'], when)
    if p == 'onlyHad':
        if _supply(case, x['item']):
            return all(True not in _values_in(H.access(q, x['item']), s, e) for q in H.people if q not in x['people'])
        return all(v is None or v in x['people'] for v in _values_in(H.holder(x['item']), s, e))
    if p == 'related':
        return _mode(_values_in(H.related(x['a'], x['rel'], x['b']), s, e), True, when)
    if p == 'hasTrait':
        return _mode(_values_in(H.trait(x['person'], x['trait']), s, e), py_str(x['value']), when)
    if p == 'crimeBetween':
        return t is not None and x['from'] <= t <= x['to']
    if p == 'crimeFact':
        facts = (crime_event(case) or {}).get('facts') or {}
        return neg(py_str(facts[x['key']]) == py_str(x['value'])) if x['key'] in facts else None
    if p == 'culpritHad':
        a, b = (x['from'], x['to']) if _num(x.get('from')) else (t, t)
        if _supply(case, x['item']):
            return neg(True in _values_in(H.access(culprit, x['item']), a, b))
        return neg(culprit in _values_in(H.holder(x['item']), a, b))
    if p == 'culpritRelated':
        return neg(_value_at(H.related(culprit, x['rel'], x['b']), t) is True)
    if p == 'culpritTrait':
        return neg(_value_at(H.trait(culprit, x['trait']), t) == py_str(x['value']))
    return None


# ----------------------------------------------------------------------------------------------------
# Reasoning from what the player knows (docs/claims.md sections 4 to 6)
# ----------------------------------------------------------------------------------------------------

def instances(case, trusted, actor=None, scene=None):
    """Constraint instances from trusted claims [(sid, claim), ...], with culprit(h) when actor is given."""
    scene = scene or case['question']['crime']['place']
    inst, between, facts = {}, [], []
    read, people = relation_reader(case), [p['id'] for p in case.get('people') or []]

    def add(key, metric, sid, kind, value, s, e, witness=False, hyp=False):
        i = inst.setdefault(key, {'key': key, 'metric': metric, 'pos': [], 'neg': []})
        if kind == 'pos':
            i['pos'].append({'s': s, 'e': e, 'value': value, 'sid': sid, 'witness': witness, 'hyp': hyp})
        else:
            i['neg'].append({'s': s, 'e': e, 'value': value, 'sid': sid, 'hyp': hyp})

    def fluent(key, metric, sid, value, s, e, when):
        if when == 'never':
            add(key, metric, sid, 'neg', value, s, e)
        else:
            add(key, metric, sid, 'pos', value, s, e, when == 'sometime')

    def holding(item, p):
        return (f'has:{p}:{item}', True) if _supply(case, item) else (f'holder:{item}', p)

    for sid, x in trusted:
        s, e = _interval(case, x)
        when, p = x.get('when') or 'throughout', x['pred']
        if p == 'wasAt':
            fluent(f"at:{x['person']}", True, sid, x['place'], s, e, when)
        elif p == 'nobodyAt':
            for q in people:
                add(f'at:{q}', True, sid, 'neg', x['place'], s, e)
        elif p == 'had':
            k, v = holding(x['item'], x['person'])
            fluent(k, False, sid, v, s, e, when)
        elif p == 'onlyHad':
            for q in [q for q in people if q not in x['people']]:
                k, v = holding(x['item'], q)
                add(k, False, sid, 'neg', v, s, e)
        elif p == 'related':
            fluent('rel:' + _key(read(x['a'], x['rel'], x['b'])), False, sid, True, s, e, when)
        elif p == 'hasTrait':
            fluent(f"trait:{x['person']}:{x['trait']}", False, sid, py_str(x['value']), s, e, when)
        elif p == 'crimeBetween':
            between.append([sid, x['from'], x['to']])
        elif p == 'crimeFact':
            facts.append([sid, x])
        elif actor:
            # culprit predicates: about the actor at the crime minute (culpritHad may name an interval instead)
            if p == 'culpritHad':
                key, value = holding(x['item'], actor)
            elif p == 'culpritRelated':
                key, value = 'rel:' + _key(read(actor, x['rel'], x['b'])), True
            else:
                key, value = f"trait:{actor}:{x['trait']}", py_str(x['value'])
            ranged = p == 'culpritHad' and _num(x.get('from'))
            a, b = (x['from'], x['to']) if ranged else (T, T)
            if x.get('not'):
                add(key, False, sid, 'neg', value, a, b, False, True)
            else:
                add(key, False, sid, 'pos', value, a, b, ranged, True)
    if actor:
        add(f'at:{actor}', True, 'culprit', 'pos', scene, T, T, False, True)
    return {'inst': inst, 'between': between, 'facts': facts}


def _fix_t(inst, t):
    return {**inst, 'pos': [{**a, 's': t, 'e': t} if a['s'] == T else a for a in inst['pos']],
            'neg': [{**n, 's': t, 'e': t} if n['s'] == T else n for n in inst['neg']]}


def _touched(inst):
    return any(a['hyp'] for a in inst['pos']) or any(n['hyp'] for n in inst['neg'])


def _subtract(iv, blocks):
    out = iv
    for bs, be in blocks:
        out = [y for s, e in out for y in ([[s, e]] if be < s or bs > e else [z for z in ([s, bs - 1], [be + 1, e]) if z[0] <= z[1]])]
    return out


def satisfiable(inst, tt):
    """Can the instance's anchors all hold together under the background laws? (t already fixed)"""
    sep = _separation(tt, inst['metric'])
    fixed = [a for a in inst['pos'] if not a['witness']]
    wit = [a for a in inst['pos'] if a['witness']]
    for i, a in enumerate(fixed):
        for b in fixed[i + 1:]:
            d = sep(a['value'], b['value'])
            if a['value'] != b['value'] and not (b['s'] >= a['e'] + d or a['s'] >= b['e'] + d):
                return False
    for a in fixed:
        for n in inst['neg']:
            if n['value'] == a['value'] and not (a['e'] < n['s'] or a['s'] > n['e']):
                return False
    if not wit:
        return True
    allowed = [_subtract([[w['s'], w['e']]],
                         [[f['s'] - sep(f['value'], w['value']) + 1, f['e'] + sep(f['value'], w['value']) - 1] for f in fixed if f['value'] != w['value']] +
                         [[n['s'], n['e']] for n in inst['neg'] if n['value'] == w['value']]) for w in wit]
    if any(not a for a in allowed):
        return False

    def earliest(k, lb):
        for s, e in allowed[k]:
            if e >= lb:
                return max(s, lb)
        return None

    # witnesses in time order: the earliest placement of each subset ending in a given witness dominates
    n, best = len(wit), {}
    for k in range(n):
        m = earliest(k, -INF)
        if m is not None:
            best[(1 << k, k)] = m
    for mask in range(1, 1 << n):
        for last in range(n):
            cur = best.get((mask, last))
            if cur is None:
                continue
            if mask == (1 << n) - 1:
                return True
            for k in range(n):
                if mask & (1 << k):
                    continue
                m = earliest(k, cur + sep(wit[last]['value'], wit[k]['value']))
                if m is not None and best.get((mask | (1 << k), k), INF) > m:
                    best[(mask | (1 << k), k)] = m
    return False


def _crime_consistent(case, between, facts, own=None):
    """The crime has one minute, within the case and in every crimeBetween; and one value for each fact (a candidate's
    own facts, when given, are values too)."""
    ws, we = span(case)
    for _, s, e in between:
        ws, we = max(ws, s), min(we, e)
    if ws > we:
        return False
    pos, neg = {}, {}
    for _, x in facts:
        (neg if x.get('not') else pos).setdefault(x['key'], set()).add(py_str(x['value']))
    for k, v in (own or {}).items():
        if k != 'actor':
            pos.setdefault(k, set()).add(py_str(v))
    return all(len(vs) <= 1 and not (vs & neg.get(k, set())) for k, vs in pos.items())


def consistent(case, claims, tt=None):
    """Is a set of claims [(sid, claim), ...] consistent under the background laws? (Culprit predicates are about
    whoever did it: if they conflict, every candidate is ruled out, which survivors_of reports.)"""
    tt = tt or travel_table(case)
    base = instances(case, claims)
    return _crime_consistent(case, base['between'], base['facts']) and all(satisfiable(i, tt) for i in base['inst'].values())


def survivors_of(case, trusted, tt=None):
    """Candidates h for which B, the trusted claims and culprit(h) are satisfiable (docs/claims.md section 5)."""
    tt = tt or travel_table(case)
    base = instances(case, trusted)
    if not all(satisfiable(i, tt) for i in base['inst'].values()):
        return []
    # all the player knows of the crime's minute is that it falls within the case, and what the claims say
    ws, we = span(case)
    for _, s, e in base['between']:
        ws, we = max(ws, s), min(we, e)
    out = []
    for h in case['question']['candidates']:
        if not _crime_consistent(case, base['between'], base['facts'], h.get('facts') or {}):
            continue
        a = actor_of(h)
        if not a:
            out.append(h['id'])
            continue
        touched = [i for i in instances(case, trusted, a)['inst'].values() if _touched(i)]
        if any(all(satisfiable(_fix_t(i, t), tt) for i in touched) for t in range(ws, we + 1)):
            out.append(h['id'])
    return out


def instance_claims(case, claims):
    """For the consistency law: the claims that bear on each instance (and on the crime's minute and facts), by key."""
    base = instances(case, claims)
    out = {k: sorted({a['sid'] for a in i['pos'] + i['neg']}) for k, i in base['inst'].items()}
    crime = sorted([sid for sid, _, _ in base['between']] + [sid for sid, _ in base['facts']])
    if crime:
        out['crime'] = crime
    return out


def defeat_free_sets(ids, defeats):
    """Maximal subsets of ids in which no sign defeats another."""
    edge = lambda a, b: b in (defeats.get(a) or []) or a in (defeats.get(b) or [])
    loose = [a for a in ids if not any(b != a and edge(a, b) for b in ids)]
    tied = [a for a in ids if a not in loose]
    if len(tied) > 16:
        return [list(ids)]
    sets = []
    for m in range(1 << len(tied)):
        s = [a for i, a in enumerate(tied) if m & (1 << i)]
        if any(edge(a, b) for i, a in enumerate(s) for b in s[i + 1:]):
            continue
        if any(a not in s and not any(edge(a, b) for b in s) for a in tied):
            continue
        sets.append(sorted(loose + s))
    return sets
