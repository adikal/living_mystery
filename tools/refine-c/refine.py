"""Variant C refinement harness (experiment, see docs/mystery-kernel.md).

Code decides WHERE a case gets harder (frontier + scheduler) and checks every step; the LLM decides HOW
and WHY (the story step). The LLM never declares what a sign eliminates: it writes propositions in fixed
sign kinds, and this file computes eliminations, truth, reachability, depth and the refinement laws.

Usage: python tools/refine-c/refine.py [--steps 8] [--depth 5] [--only NAME] [--model ID]
"""
import argparse, concurrent.futures as cf, copy, datetime, json, os, re, sys, time, traceback
import boto3
from botocore.config import Config
import difficulty as DF

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = 'us.anthropic.claude-opus-5-5'          # story steps and seed
CRITIC_MODEL = 'us.anthropic.claude-sonnet-5'     # plausibility review (short verdicts)
FAST_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'   # small checks (e.g. near-duplicate questions)
SEED_ROUNDS = 4                                  # draft, then up to three repairs of the best draft
CANDIDATES = 2                                     # parallel speculative patches per round
FIXED = None                                       # a fixed setting (e.g. Bellweather): its places, links and cast are locked
CLAIM_KINDS = {'place', 'time', 'trait', 'relation', 'possession', 'fact'}
SIGN_KINDS = {'trace', 'testimony', 'document', 'record', 'behavior', 'item', 'rule', 'observation', 'absence'}

# ----------------------------------------------------------------------------------------------------
# World model helpers
# ----------------------------------------------------------------------------------------------------

def travel_table(case):
    places = [p['id'] for p in case['setting']['places']]
    INF = 10 ** 9
    d = {a: {b: (0 if a == b else INF) for b in places} for a in places}
    for e in case['setting'].get('links', []):
        a, b, m = e['a'], e['b'], e['minutes']
        if a in d and b in d:
            d[a][b] = min(d[a][b], m); d[b][a] = min(d[b][a], m)
    for k in places:
        for i in places:
            for j in places:
                if d[i][k] + d[k][j] < d[i][j]:
                    d[i][j] = d[i][k] + d[k][j]
    return d


def presence(case):
    """True presence intervals per person, from events (agent + others)."""
    out = {}
    for ev in case['events']:
        for p in [ev.get('agent')] + list(ev.get('others', [])):
            if p:
                out.setdefault(p, []).append((ev['start'], ev['end'], ev['place'], ev['id']))
    for p in out:
        out[p].sort()
    return out


def people(case):
    return {p['id']: p for p in case['people']}


def hyp_map(case):
    return {h['id']: h for h in case['question']['candidates']}

# ----------------------------------------------------------------------------------------------------
# Sign semantics: computed by code, never declared by the LLM
# ----------------------------------------------------------------------------------------------------

def claim_of(sign):
    c = sign.get('claim')
    return c if isinstance(c, dict) and c.get('kind') in CLAIM_KINDS else None


def actor_of(h):
    return (h.get('facts') or {}).get('actor')


def eliminates(case, claim, h, window):
    """Does this (trusted) claim rule out hypothesis h? window = current crime window (start, end)."""
    ppl, k = people(case), claim['kind']
    actor = actor_of(h)
    if k == 'trait':
        if not actor or actor not in ppl:
            return False
        return str(ppl[actor].get('traits', {}).get(claim['trait'])) != str(claim['value'])
    if k == 'relation' and claim.get('a'):
        return False  # a fact about a named person (e.g. a motive); it establishes, it does not eliminate
    if k == 'possession' and claim.get('person'):
        return False
    if k == 'relation':
        rels = case.get('relations', [])
        if not actor:
            return False
        return not any(r['a'] == actor and r['rel'] == claim['rel'] and (not claim.get('b') or r.get('b') == claim['b']) for r in rels)
    if k == 'possession':
        if not actor:
            return False
        return not any(p['person'] == actor and p['item'] == claim['item'] for p in case.get('possession', []))
    if k == 'fact':
        facts = h.get('facts') or {}
        return claim['key'] in facts and str(facts[claim['key']]) != str(claim['value'])
    return False  # place/time are handled jointly by opportunity()


def opportunity_eliminated(case, place_claims, window, h, tt):
    """Place claims are alibis: the actor could not reach the crime scene at any minute in the window."""
    actor = actor_of(h)
    crime_place = case['question']['crime']['place']
    if not actor:
        return False
    ws, we = window
    if ws > we:
        return True
    blocked = []
    for c in place_claims:
        if c.get('person') != actor:
            continue
        if c['place'] == crime_place:
            continue
        gap = tt.get(c['place'], {}).get(crime_place, 0)
        blocked.append((c['start'] - gap, c['end'] + gap))
    # is every minute of [ws, we] blocked?
    t = ws
    for s, e in sorted(blocked):
        if s > t:
            break
        t = max(t, e + 1)
        if t > we:
            return True
    return t > we


def claim_true(case, claim, tt):
    """Truth value of a claim in the true history (used to detect lies and staged signs)."""
    truth = hyp_map(case)[case['question']['truth']]
    k = claim['kind']
    if k == 'place':
        pres = presence(case).get(claim['person'], [])
        s, e = claim['start'], claim['end']
        there = any(ps < e and pe > s and pl == claim['place'] for ps, pe, pl, _ in pres)
        elsewhere = any(ps < e and pe > s and pl != claim['place'] for ps, pe, pl, _ in pres)
        return there and not elsewhere
    if k == 'time':
        crime = next((ev for ev in case['events'] if ev['id'] == case['question']['crime']['event']), None)
        return bool(crime) and claim['start'] <= crime['start'] and crime['end'] <= claim['end']
    if k == 'relation' and claim.get('a'):
        return any(r['a'] == claim['a'] and r['rel'] == claim['rel'] and (not claim.get('b') or r.get('b') == claim['b'])
                   for r in case.get('relations', []))
    if k == 'possession' and claim.get('person'):
        return any(p['person'] == claim['person'] and p['item'] == claim['item'] for p in case.get('possession', []))
    return not eliminates(case, claim, truth, tuple(case['question']['crime']['window']))

# ----------------------------------------------------------------------------------------------------
# Access, reading, trust, depth
# ----------------------------------------------------------------------------------------------------

def analyse(case):
    tt = travel_table(case)
    signs = {s['id']: s for s in case['signs']}
    rules = {r['id']: r for r in case.get('rules', [])}
    # access reachability (monotone fixed point) + depth
    depth, changed = {}, True
    while changed:
        changed = False
        for sid, s in signs.items():
            if sid in depth:
                continue
            req = s.get('requires', [])
            if all(r in depth for r in req):
                depth[sid] = 0 if not req else 1 + max(depth[r] for r in req)
                changed = True
    reachable = set(depth)
    # rules known: common, or taught by a reachable rule sign
    known_rule_depth = {}
    for r in rules.values():
        if r.get('knowledge') == 'common':
            known_rule_depth[r['id']] = 0
    for sid in reachable:
        s = signs[sid]
        if s.get('kind') == 'rule' and s.get('rule') in rules:
            known_rule_depth[s['rule']] = min(known_rule_depth.get(s['rule'], 10 ** 6), depth[sid])
    # reading: a sign's claim is understood once its 'needs' (signs or rules) are available
    eff, changed = {}, True
    while changed:
        changed = False
        for sid in reachable:
            if sid in eff:
                continue
            needs = signs[sid].get('needs', [])
            ds = []
            ok = True
            for n in needs:
                if n in signs:
                    if n in eff:
                        ds.append(eff[n])
                    else:
                        ok = False
                elif n in known_rule_depth:
                    ds.append(known_rule_depth[n])
                else:
                    ok = False
            if ok:
                eff[sid] = (max([depth[sid]] + ds) + 1) if needs else depth[sid]
                changed = True
    understood = set(eff)
    truthval = {sid: claim_true(case, claim_of(signs[sid]), tt) for sid in signs if claim_of(signs[sid])}
    return dict(tt=tt, signs=signs, depth=depth, eff=eff, reachable=reachable, understood=understood,
                truthval=truthval, rules_known=known_rule_depth)


def survivors(case, A, max_depth=None, exclude=frozenset()):
    """Hypotheses surviving every understood, trusted claim with effective depth <= max_depth."""
    signs, eff = A['signs'], A['eff']
    visible = {sid for sid in A['understood'] if sid not in exclude and (max_depth is None or eff[sid] <= max_depth)}
    defeated = set()
    for sid in visible:
        for d in signs[sid].get('defeats', []):
            defeated.add(d)
    trusted = [signs[sid] for sid in visible if sid not in defeated and claim_of(signs[sid])]
    window = list(case['question']['crime']['window'])
    for s in trusted:
        c = claim_of(s)
        if c['kind'] == 'time':
            window = [max(window[0], c['start']), min(window[1], c['end'])]
    places = [claim_of(s) for s in trusted if claim_of(s)['kind'] == 'place']
    out = []
    for h in case['question']['candidates']:
        if opportunity_eliminated(case, places, tuple(window), h, A['tt']):
            continue
        if any(eliminates(case, claim_of(s), h, tuple(window)) for s in trusted if claim_of(s)['kind'] not in ('place', 'time')):
            continue
        out.append(h['id'])
    return out


def closure_dependent(case, root):
    """root plus every sign that (transitively) requires or needs it."""
    out, changed = {root}, True
    while changed:
        changed = False
        for s in case['signs']:
            if s['id'] not in out and any(x in out for x in s.get('requires', []) + s.get('needs', [])):
                out.add(s['id']); changed = True
    return frozenset(out)


def thread_depths(case, A, exclude=frozenset()):
    """A case is solved when every innocent candidate is ruled out AND the truth survives. Each of those is a
    thread: depth(innocent c) = shallowest depth at which c is ruled out; depth('truth') = shallowest depth
    from which the truth survives for good (after any lie against it is defeated). Solve depth = max thread."""
    q = case['question']
    maxd = max(A['eff'].values()) if A['eff'] else 0
    surv = [set(survivors(case, A, d, exclude)) for d in range(maxd + 1)]
    out = {}
    for h in q['candidates']:
        if h['id'] == q['truth']:
            ok = [d for d in range(maxd + 1) if all(q['truth'] in surv[k] for k in range(d, maxd + 1))]
            out['truth'] = min(ok) if ok else None
        else:
            gone = [d for d in range(maxd + 1) if all(h['id'] not in surv[k] for k in range(d, maxd + 1))]
            out[h['id']] = min(gone) if gone else None
    return out


def critical_signs(case, A, thread, depth):
    """Signs whose removal (with everything depending on them) makes this thread deeper or unsolvable."""
    out = []
    for sid in A['understood']:
        if A['eff'][sid] > depth:
            continue
        d = thread_depths(case, A, closure_dependent(case, sid)).get(thread)
        if d is None or d > depth:
            out.append(sid)
    return out

def account_backing(case, sign):
    """Why the speaker can give this account, from the case records alone, or None.
    source: an event the speaker took part in produced it; because: an attitude of the speaker (a reason or something
    they knew); self: a place claim about the speaker; witnessed: the speaker was at that place during that time.
    A claimless account (an evening summary) is backed by the speaker's own events."""
    sp = sign.get('speaker')
    evs = {e['id']: e for e in case['events']}
    part = lambda e: bool(e) and (e.get('agent') == sp or sp in (e.get('others') or []))
    if part(evs.get(sign.get('source'))):
        return 'source'
    if any(a['agent'] == sp and a['id'] in (sign.get('because') or []) for a in case.get('attitudes', [])):
        return 'because'
    c = claim_of(sign)
    if not c:
        return 'own_events' if any(part(e) for e in case['events']) else None
    if c['kind'] == 'place':
        if c.get('person') == sp:
            return 'self'
        if any(part(e) and e['place'] == c['place'] and e['start'] < c['end'] and e['end'] > c['start'] for e in case['events']):
            return 'witnessed'
    return None


def unbacked_accounts(case):
    return sorted(x['id'] for x in case['signs'] if x.get('kind') == 'testimony' and account_backing(case, x) is None)


def pillar_signs(case, A):
    """Motive and means evidence for the true culprit: understood, true signs that establish (not eliminate).
    motive: a relation claim whose subject is the culprit (or a fact keyed 'motive');
    means:  a possession or trait claim the culprit satisfies (named, or anonymous and true of the culprit)."""
    q = case['question']
    ta = actor_of(hyp_map(case)[q['truth']])
    return pillar_signs_for(case, A, ta)


def pillar_signs_for(case, A, actor, held=None):
    ppl = people(case)
    motive, means = [], []
    victim = case.get('victim') or next((e.get('agent') for e in case['events'] if e.get('type') == 'death' and e.get('agent')), None)
    for sid, s_ in A['signs'].items():
        if sid not in A['understood'] or not A['truthval'].get(sid) or (held is not None and sid not in held):
            continue
        c = claim_of(s_)
        if not c:
            continue
        if (c['kind'] == 'relation' and c.get('a') == actor) or (c['kind'] == 'relation' and victim and c.get('a') == victim and c.get('b') == actor) \
                or (c['kind'] == 'fact' and c.get('key') == 'motive' and c.get('person', actor) == actor):
            motive.append(sid)
        elif c['kind'] == 'possession' and (c.get('person') == actor or (not c.get('person') and
                any(p['person'] == actor and p['item'] == c['item'] for p in case.get('possession', [])))):
            means.append(sid)
        elif c['kind'] == 'trait' and actor in ppl and str(ppl[actor].get('traits', {}).get(c['trait'])) == str(c['value']):
            means.append(sid)
    # a motive is a reason to kill THIS victim: at least one motive sign must connect the culprit and the victim
    # (older cases with no recorded victim count any relation about the culprit)
    if victim:
        linked = lambda x: (claim_of(A['signs'][x]) or {}).get('kind') != 'relation' or victim in ((claim_of(A['signs'][x]) or {}).get('a'), (claim_of(A['signs'][x]) or {}).get('b'))
        motive = [x for x in motive if linked(x)]
    return {'motive': sorted(motive), 'means': sorted(means)}


# ----------------------------------------------------------------------------------------------------
# Certification: every check is code
# ----------------------------------------------------------------------------------------------------

def certify(case, require_pillars=True, require_backing=False):
    errs, A = [], None
    ids = [x['id'] for k in ('people', 'objects', 'attitudes', 'events', 'signs', 'rules') for x in case.get(k, [])]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        errs.append(f'duplicate ids: {sorted(dup)}')
    ppl = people(case)
    places = {p['id'] for p in case['setting']['places']}
    att = {a['id']: a for a in case.get('attitudes', [])}
    evs = {e['id']: e for e in case['events']}
    signs = {s['id']: s for s in case['signs']}
    q = case['question']
    hyps = hyp_map(case)
    if q.get('truth') not in hyps:
        errs.append('question.truth is not one of the candidates')
    if q['crime'].get('event') not in evs:
        errs.append('question.crime.event does not name an event')
    # references
    for e in case['events']:
        if e['place'] not in places:
            errs.append(f"event {e['id']}: unknown place {e['place']}")
        for p in [e.get('agent')] + list(e.get('others', [])):
            if p and p not in ppl:
                errs.append(f"event {e['id']}: unknown person {p}")
        if e['end'] < e['start']:
            errs.append(f"event {e['id']}: ends before it starts")
        # justification: an intentional event must cite an attitude of its agent
        if e.get('agent') and e.get('causedBy') != 'nature':
            a = att.get(e.get('causedBy'))
            if not a:
                errs.append(f"event {e['id']} ({e['agent']}) has no causing attitude")
            elif a['agent'] != e['agent']:
                errs.append(f"event {e['id']}: causing attitude {a['id']} belongs to {a['agent']}, not {e['agent']}")
    for a in case.get('attitudes', []):
        if a['agent'] not in ppl:
            errs.append(f"attitude {a['id']}: unknown agent {a['agent']}")
    for s in case['signs']:
        if s.get('kind') not in SIGN_KINDS:
            errs.append(f"sign {s['id']}: unknown kind {s.get('kind')}")
        for r in s.get('requires', []):
            if r not in signs:
                errs.append(f"sign {s['id']}: requires unknown sign {r}")
        for n in s.get('needs', []):
            if n not in signs and n not in {r['id'] for r in case.get('rules', [])}:
                errs.append(f"sign {s['id']}: needs unknown sign/rule {n}")
        for d in s.get('defeats', []):
            if d not in signs:
                errs.append(f"sign {s['id']}: defeats unknown sign {d}")
        if s.get('source') and s['source'] not in evs:
            errs.append(f"sign {s['id']}: source event {s['source']} missing")
        if s.get('at') and s['at'] not in places:
            errs.append(f"sign {s['id']}: unknown place {s['at']}")
        if s.get('requires') and not str(s.get('unlock', '')).strip():
            errs.append(f"sign {s['id']}: has 'requires' but no 'unlock' text saying why, in the world, those must come first")
        if s.get('needs') and not str(s.get('reading', '')).strip():
            errs.append(f"sign {s['id']}: has 'needs' but no 'reading' text saying how the other clue or rule makes sense of it")
        c = s.get('claim')
        if c is not None and claim_of(s) is None:
            errs.append(f"sign {s['id']}: claim kind must be one of {sorted(CLAIM_KINDS)}")
        if claim_of(s) and claim_of(s)['kind'] == 'place' and (c.get('person') not in ppl or c.get('place') not in places):
            errs.append(f"sign {s['id']}: place claim needs a known person and place")
        if s.get('kind') == 'testimony' and s.get('speaker') not in ppl:
            errs.append(f"sign {s['id']}: testimony needs a known speaker")
    # spoken times must match the timeline; a trace lies where its source event happened
    times = set()
    for e in case['events']:
        times |= {e['start'] % 1440, e['end'] % 1440}
    for s_ in case['signs']:
        c_ = s_.get('claim') or {}
        for k_ in ('start', 'end'):
            if isinstance(c_.get(k_), (int, float)):
                times.add(int(c_[k_]) % 1440)
    for s_ in case['signs']:
        if s_.get('kind') in ('testimony', 'behavior'):
            for m_ in re.finditer(r'\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(am|pm|a\.m\.|p\.m\.)?', s_.get('text', ''), re.I):
                h_, mi, ap = int(m_.group(1)), int(m_.group(2)), (m_.group(3) or '').lower()
                opts = [h_ * 60 + mi] if ap.startswith('a') and h_ != 12 else [(h_ % 12 + 12) * 60 + mi] if ap.startswith('p') else [h_ * 60 + mi, ((h_ + 12) % 24) * 60 + mi]
                if not any(min(abs(o - t_), 1440 - abs(o - t_)) <= 20 for o in opts for t_ in times):
                    errs.append(f"sign {s_['id']}: its text mentions {m_.group(0).strip()}, which matches no event or claim time (+-20 min); "
                                "fix the text or add the event (remember 1320 = 22:00)")
        if s_.get('kind') == 'trace' and s_.get('source') in evs and s_.get('at') and evs[s_['source']]['place'] != s_['at']:
            errs.append(f"trace {s_['id']} is at {s_['at']} but its source event {s_['source']} happened at {evs[s_['source']]['place']}; "
                        "a trace lies where it was made unless a later event (its source) moved it")
    if errs:
        return {'ok': False, 'errors': errs}
    # physical consistency: one place at a time, travel takes time
    tt = travel_table(case)
    for p, iv in presence(case).items():
        for (s1, e1, p1, id1), (s2, e2, p2, id2) in zip(iv, iv[1:]):
            if p1 != p2 and s2 < e1:
                errs.append(f"{p} is in two places at once: {id1}@{p1} and {id2}@{p2}")
            elif p1 != p2 and s2 - e1 < tt[p1][p2]:
                errs.append(f"{p} cannot travel {p1}->{p2} in {s2 - e1} min (needs {tt[p1][p2]})")
    crime = evs[q['crime']['event']]
    if crime.get('agent') != actor_of(hyps[q['truth']]):
        errs.append('the crime event agent is not the true culprit')
    A = analyse(case)
    # false signs must be lies/mistakes/staging, justified, and defeated deeper
    for sid, tv in A['truthval'].items():
        if tv:
            continue
        s = A['signs'][sid]
        if s['kind'] == 'testimony':
            sp = s['speaker']
            if not any(a['agent'] == sp for a in case['attitudes'] if a['id'] in s.get('because', [])):
                errs.append(f"false testimony {sid} by {sp} cites no attitude of {sp} explaining the lie or mistake")
        else:
            src = evs.get(s.get('source'))
            if not src or src.get('causedBy') in (None, 'nature'):
                errs.append(f"false physical sign {sid} is not produced by a deliberate (staging) event")
        dfs = [d for d in A['signs'].values() if sid in d.get('defeats', [])]
        good = [d for d in dfs if d['id'] in A['understood'] and A['eff'][d['id']] > A['eff'].get(sid, 0) and A['truthval'].get(d['id'], True)]
        if not good:
            errs.append(f"false sign {sid} has no reachable, true defeater deeper than it")
    for sid, s in A['signs'].items():
        if sid in A['truthval']:
            continue
    full = survivors(case, A)
    if full != [q['truth']]:
        errs.append(f"answer not unique from all reachable evidence: survivors {full}")
    if errs:
        return {'ok': False, 'errors': errs, 'A': A}
    maxd = max(A['eff'].values()) if A['eff'] else 0
    solve = next((d for d in range(maxd + 1) if survivors(case, A, d) == [q['truth']]), None)
    surface = survivors(case, A, 0)
    key = [sid for sid in A['understood'] if claim_of(A['signs'][sid]) and A['truthval'].get(sid)
           and survivors(case, A, None, closure_dependent(case, sid)) != [q['truth']]]
    innocent_actors = {actor_of(h) for h in q['candidates'] if h['id'] != q['truth']}
    herrings = [s['id'] for s in case['signs'] if s['kind'] == 'behavior' and s.get('about') in innocent_actors
                and any(e in A['understood'] and A['eff'][e] > A['eff'].get(s['id'], 0) for e in s.get('explainedBy', []))]
    threads = thread_depths(case, A)
    ta = actor_of(hyps[q['truth']])
    innocents = [h for h in q['candidates'] if h['id'] != q['truth']]
    def ok_sign(sid):
        return sid in A['understood'] and A['truthval'].get(sid)
    motive = sorted(sid for sid, s_ in A['signs'].items() if ok_sign(sid) and claim_of(s_) and
                    ((claim_of(s_)['kind'] == 'relation' and claim_of(s_).get('a') == ta) or
                     (claim_of(s_)['kind'] == 'fact' and claim_of(s_).get('key') == 'motive')))
    means = sorted(sid for sid, s_ in A['signs'].items() if ok_sign(sid) and claim_of(s_) and
                   claim_of(s_)['kind'] in ('trait', 'possession', 'relation') and not claim_of(s_).get('a') and not claim_of(s_).get('person')
                   and any(eliminates(case, claim_of(s_), h, tuple(q['crime']['window'])) for h in innocents))
    pil = pillar_signs(case, A)
    pd = {k: (min(A['eff'][x] for x in v) if v else None) for k, v in pil.items()}
    if require_pillars and not pil['motive']:
        errs.append("no reachable, true evidence of the culprit's MOTIVE (a relation claim with a = the culprit)")
    if require_pillars and not pil['means']:
        errs.append("no reachable, true evidence of the culprit's MEANS (a possession or trait claim the culprit satisfies)")
    if errs:
        return {'ok': False, 'errors': errs, 'A': A}
    unbacked = unbacked_accounts(case)
    if require_backing and unbacked:
        errs.append(f"accounts not backed by the true history (an event the speaker took part in or saw, or something "
                    f"they knew): {unbacked}; add the event, the speaker to it, or a 'knows' attitude and cite it in 'because'")
        return {'ok': False, 'errors': errs, 'A': A}
    pillars = {'opportunity': solve, 'means': pd['means'], 'motive': pd['motive']}
    return {'ok': True, 'A': A, 'solve_depth': solve, 'max_depth': maxd, 'surface': surface, 'threads': threads,
            'motive': motive, 'means': means, 'pillars': pillars, 'pillar_signs': pil, 'unbacked': unbacked,
            'mmo_depth': max(v for v in pillars.values() if v is not None),
            'twist': q['truth'] not in surface, 'key': sorted(key), 'herrings': herrings,
            'false_signs': sorted(k for k, v in A['truthval'].items() if not v)}

# ----------------------------------------------------------------------------------------------------
# LLM
# ----------------------------------------------------------------------------------------------------

_client = None
USAGE = {'in': 0, 'out': 0, 'calls': 0}

def llm(system, user, max_tokens=9000, model=None):
    global _client
    if _client is None:
        _client = boto3.client('bedrock-runtime', region_name='us-west-2',
                               config=Config(read_timeout=300, retries={'max_attempts': 2}, max_pool_connections=64))
    # the static system prompt (principles, schema, library, checklist) is cached across calls
    r = _client.converse(modelId=model or MODEL, system=[{'text': system}, {'cachePoint': {'type': 'default'}}],
                         messages=[{'role': 'user', 'content': [{'text': user}]}], inferenceConfig={'maxTokens': max_tokens})
    USAGE['in'] += r['usage']['inputTokens']; USAGE['out'] += r['usage']['outputTokens']; USAGE['calls'] += 1
    return ''.join(b.get('text', '') for b in r['output']['message']['content'])


FORCED_OK = {}


def llm_json(system, user, max_tokens=9000, model=None, schema=None):
    """Structured output: force a 'submit' tool call so the reply is a parsed object, never free-form JSON text."""
    global _client
    if _client is None:
        _client = boto3.client('bedrock-runtime', region_name='us-west-2',
                               config=Config(read_timeout=300, retries={'max_attempts': 2}, max_pool_connections=64))
    tool = {'toolSpec': {'name': 'submit', 'description': 'Submit the requested JSON object.',
                         'inputSchema': {'json': schema or {'type': 'object', 'additionalProperties': True}}}}
    m = model or MODEL
    forced = FORCED_OK.get(m, True)
    kw = dict(modelId=m, system=[{'text': system + ('' if forced else '\n\nAlways answer by calling the submit tool.')},
                                  {'cachePoint': {'type': 'default'}}],
              messages=[{'role': 'user', 'content': [{'text': user}]}], inferenceConfig={'maxTokens': max_tokens},
              toolConfig={'tools': [tool], 'toolChoice': {'tool': {'name': 'submit'}} if forced else {'auto': {}}})
    try:
        r = _client.converse(**kw)
    except Exception as e:
        if forced and 'tool_choice' in str(e):
            FORCED_OK[m] = False
            return llm_json(system, user, max_tokens, model, schema)
        raise
    USAGE['in'] += r['usage']['inputTokens']; USAGE['out'] += r['usage']['outputTokens']; USAGE['calls'] += 1
    text = ''
    for b in r['output']['message']['content']:
        if 'toolUse' in b:
            return b['toolUse']['input']
        text += b.get('text', '')
    if text.strip():
        return parse_json(text)
    raise ValueError('model did not call submit')


def parse_json(text):
    if isinstance(text, dict):
        return text
    t = re.sub(r'^```(?:json)?|```$', '', text.strip(), flags=re.M).strip()
    i, j = t.find('{'), t.rfind('}')
    if i < 0 or j < 0:
        raise ValueError('no JSON object in reply')
    return json.loads(t[i:j + 1])


BLOCKS = """Motive: Gain, Fear of exposure, Revenge, Protection, Jealousy, Ambition, Conviction, Desperation.
Mind: Secret, Lie, Mistake, Suspicion, Loyalty, Debt, Grudge, Shame.
Evidence: Trace, Testimony, Document, Record, Confession, Dying message, Absence, Alibi.
Deception: Staged scene, Frame-up, Cover-up, Forgery, Planted evidence, Impersonation, Time trick, Disguise.
Structure: Decoy, Red herring, Accomplice, Conspiracy, Second crime, Closed circle, Sealed place, Hidden relationship, Old wrong, Double bluff, Unlikely culprit.
Adventure: Item, Container, Lock and key, Tool, Recipe, Trade, Favour, Topic, Persuasion, Eavesdrop, Search."""

SCHEMA = """CASE SCHEMA (all times are integer minutes; 1320 = 22:00; values past 1440 are the next day)
{
 "setting": {"name","era","summary","places":[{"id","name"}],"links":[{"a","b","minutes"}]},
 "rules": [{"id","text","knowledge":"common"|"acquirable"}],      // acquirable rules must be taught by a sign of kind "rule"
 "people": [{"id","name","role","traits":{"<trait>":"<value>"}}],   // traits are what trait-claims test (handed, height, skill ...)
 "objects": [{"id","name","desc"}],
 "relations": [{"a","rel","b"}],                                    // e.g. owes, loves, rival_of, employed_by
 "possession": [{"person","item"}],                                 // who had access to an item (a key, a poison, a tool)
 "question": {"text","candidates":[{"id","label","facts":{"actor":"<person id>", "...":"..."}}],"truth":"<candidate id>",
              "crime":{"event":"<event id>","place":"<place id>","window":[start,end]}},
 "attitudes": [{"id","agent","mode":"believes|knows|wants|fears|intends|feels","content","because":[attitude ids]}],
 "events": [{"id","type","agent","others":[person ids],"place","start","end","causedBy":"<attitude id of the agent>"|"nature","summary"}],
 "signs": [{
   "id","kind":"trace|testimony|document|record|behavior|item|rule|observation|absence",
   "title","text",                          // what the player sees; neutral, never announces its own meaning
   "at":"<place id>",
   "requires":[sign ids],                   // ACCESS: signs/items/favours the player must already have to find this
   "unlock":"...",                          // REQUIRED with requires: the in-world reason (the key opens it; she trusts you once you show X)
   "needs":[sign ids or rule ids],          // READING: what is needed to understand it (a second clue, a rule)
   "reading":"...",                         // REQUIRED with needs: how the other clue or rule makes sense of this one
   "claim": {                               // the proposition it carries, in exactly ONE of these kinds (omit for none):
      "kind":"place","person","place","start","end"      // the person was at the place for that span (an alibi-type fact)
      "kind":"time","start","end"                         // the crime happened within this span
      "kind":"trait","trait","value"                     // the culprit has this trait
      "kind":"relation","rel","b"                        // the culprit stands in this relation (to b)
      "kind":"relation","a","rel","b"                    // a named person stands in this relation: a world fact (motive)
      "kind":"possession","person","item"                // a named person had access to an item: a world fact
      "kind":"possession","item"                         // the culprit had access to this item
      "kind":"fact","key","value"                        // a fact about the answer (method, motive, what happened)
   },
   "speaker":"<person id>","because":[attitude ids],   // testimony only; 'because' explains why a false testimony is false
   "ask":"...",                             // testimony only: the natural question the detective asks to hear it (no answer in it)
   "source":"<event id>",                   // the event that produced it (required for staged or planted physical signs)
   "defeats":[sign ids],                    // this sign overturns those (a lie, a staged scene)
   "about":"<person id>","explainedBy":[sign ids]   // behavior signs: whom it concerns and which deeper signs explain it
 }]
}
The kernel CODE computes eliminations: place claims are alibis (the person could not reach the crime place in the crime
window); time claims narrow the window; trait/relation/possession claims rule out candidates whose actor lacks them; fact
claims rule out candidates whose facts differ. A claim is FALSE if it contradicts the true history; false signs must be
lies/mistakes (testimony, with 'because') or staged (a deliberate source event), and must be defeated by a deeper true sign."""

PRINCIPLES = """You are the story engine of a mystery generator. Code controls where the case gets harder and checks every step;
you decide how and why, as a novelist would. Rules you must follow:
- Every complication has a cause: someone did something for a reason (an event caused by an attitude), or nature did.
- Signs are neutral: their text never names the culprit or announces what they prove.
- Never declare what a sign eliminates; write a claim in the fixed kinds and let the code compute its consequences.
- Every person a sign names or implicates (holds a key, was seen, owns an item) must be explained somewhere in the case
  (an attitude, event, possession or another sign); never leave an innocent looking guilty for a reason the case never resolves.
- An 'unlock' must be a real in-world reason the detective would go and look: the prerequisite must point to the new
  sign's place or person (a name, a key, a mention), not merely precede it.
- Keep times, places and travel physically consistent. People are at events you add; add events for new whereabouts.
- Respond with ONE JSON object only."""

CHECKLIST = """BEFORE ANSWERING, CHECK YOUR PATCH AGAINST WHAT THE REVIEWER WILL REJECT:
- Every 'unlock' follows in the world: obtaining the prerequisite would really lead to finding, or being given, this sign.
- Characters act from their attitudes. Someone who wants a thing hidden needs a stated reason to reveal it; a careful
  culprit does not keep damning evidence without a reason.
- Every clock time in text matches the events (1320 = 22:00, 1380 = 23:00, 1440 = midnight, 1500 = 01:00). Time-of-day
  words (morning, night) must fit too.
- A trace lies where its source event happened, unless a later event moved it (then that event is its source).
- A 'reading' really follows: the rule or clue named must make sense of this sign.
- Signs are neutral observations; they never name the culprit or say what they prove.
- Nothing contradicts an existing event or sign. If something must change, modify that event in the patch.
- Be concise: sign text at most 70 words, event summaries at most 25 words, story at most 2 sentences."""

SYSTEM_GEN = PRINCIPLES + '\n\n' + SCHEMA + '\n\nLIBRARY BLOCKS (use one or two per step): ' + BLOCKS + '\n\n' + CHECKLIST


SEED_TRIVIAL = """- A TRIVIAL SURFACE: 2 or 3 signs with no 'requires' and no 'needs', all TRUE, that together leave exactly the truth.
  (It is fine that this is too easy: later steps will refine it.)"""
SEED_RICH = """- A FIRST-LAYER CASE (later steps will deepen it; keep each part simple and certain):
  1. ONE DECEPTION on the surface that points away from the culprit: a false testimony (with 'because' = the speaker's
     attitude: love, fear, debt) or a staged physical sign (with 'source' = the deliberate staging event). It must rule
     the true culprit out on the surface (e.g. a false alibi: a place claim putting them elsewhere for the whole window).
  2. ITS DEFEATER one step deeper: a TRUE sign with 'requires' one item or sign the player can get, listing the
     deception in 'defeats'.
  3. A MOTIVE sign (claim {"kind":"relation","a":<culprit>,"rel":...,"b":<the victim>} with the matching 'relations' entry) and a
     MEANS sign (a culprit-centric possession or trait claim that only the culprit satisfies among the candidates, with
     the matching 'possession' entry or trait), each on the surface or one step deep.
  4. A RED HERRING: a surface 'behavior' sign about an innocent candidate (no claim), caused by an innocent secret, with
     a deeper sign that explains it in 'explainedBy'.
  5. Alibi signs (place claims) that, together with the above, leave exactly the truth once everything is found.
- A few domain rules for the setting (common or acquirable)."""
SEED_SURFACE_TEXT = SEED_TRIVIAL   # simple and quick; variety comes from the premise deck, depth from the steps


def seed_prompt(brief, premise=None):
    SEED_SURFACE = SEED_SURFACE_TEXT
    import premise as P
    fixed = '' if not FIXED else f"""
FIXED SETTING - use it exactly. Use these place ids and links unchanged. Use these people (same ids, names, roles,
pronouns and voices); you may give them 'traits', secrets, relationships and motives of your own invention, but do NOT
add people or places. You MAY invent any new objects and documents; these have pictures in the game, so prefer them
when they fit the story: {', '.join(o['label'] for o in FIXED.get('objects', []))}. The victim is '{(premise or {}).get('victim', FIXED['victim'])}'. Candidates are
{'exactly the suspects named in the premise' if premise else '4 or 5 of the living cast'}. Not everyone need take part: bystanders may simply have been at home. Testimony must sound like each person's voice. All true-history events fall between 1080
(18:00) and 1860 (07:00 next morning); the investigation begins the next morning.
{json.dumps({k: FIXED[k] for k in ('name', 'era', 'summary', 'places', 'links', 'people')})}
"""
    return f"""Create the SEED of a mystery for this brief: {brief}
{fixed}{P.seed_rules(premise) if premise else ''}

Requirements:
- 4 to 7 places with travel links; 4 to 6 people; 3 to 5 candidates (each a hypothesis with facts.actor, plus other facts
  if the question is not simply 'who'). One candidate is the truth.
- A true history: the crime event (agent = the true culprit, at question.crime.place, inside the window) caused by a
  motive attitude; plus evening whereabouts events for every candidate so that alibis can be tested.
- Attitudes for every intentional event.
- Every candidate has a surface testimony (no 'requires') giving their account of the evening in their own voice:
  vague and claimless, or a false alibi (the culprit), so that "Where were you last night?" always has an answer.
- PHYSICAL CONSISTENCY IS CHECKED BY CODE: for each person (including anyone listed in an event's 'others'), their events
  must not overlap in time at different places, and consecutive events at different places need at least the travel time
  between them (shortest path over links). Leave generous gaps. Before answering, list each person's timeline to yourself.
{SEED_SURFACE}
Return the complete case JSON."""


def step_prompt(case, report, target, mode, preferred, feedback=None):
    A = report['A']
    kinds = {}
    for x in case['signs']:
        kinds[x['kind']] = kinds.get(x['kind'], 0) + 1
    state = {'sign_depths': {k: A['eff'].get(k) for k in A['signs']}, 'thread_depths': report.get('threads'),
             'travel_minutes': {a: {b: m for b, m in row.items() if a < b} for a, row in A['tt'].items()},
             'surface_survivors': report['surface'],
             'solve_depth': report['solve_depth'], 'false_signs': report['false_signs'], 'key_signs': report['key']}
    if mode == 'twist':
        task = (f"TWIST STEP. The surface currently points at the truth. Apply MISLEAD around sign '{target}': using an existing "
                "attitude where possible, make the surface point AWAY from the true culprit - e.g. a false alibi from someone "
                "who protects or fears them, a staged scene, a time trick - so that the surface evidence excludes the truth. "
                "Add the justifying events/attitudes and a deeper TRUE sign that defeats the deception (list it in 'defeats').")
    elif mode == 'implicate':
        need = [n for n, v in (('MOTIVE', report.get('motive')), ('MEANS', report.get('means'))) if not v]
        task = (f"IMPLICATE STEP. The culprit '{target}' is currently identified only by elimination. Add positive evidence: "
                f"{' and '.join(need)}. MOTIVE = a TRUE sign whose claim is a relation fact connecting the culprit and the VICTIM "
                f"{{\"kind\":\"relation\",\"a\":\"{target}\",\"rel\":\"...\",\"b\":\"...\"}} (add the matching entry to 'relations'). "
                "MEANS = a TRUE culprit-centric claim that only the culprit satisfies among the candidates: {\"kind\":\"possession\",\"item\"} "
                "(add the 'possession' entry) or {\"kind\":\"trait\",\"trait\",\"value\"}. Other candidates may have motives too, but not the means. "
                "Do not put it on the surface: hide it (Conceal) or make it need another clue (Fragment), justified by someone's reason.")
    elif mode == 'herring':
        task = (f"RED HERRING STEP. Give innocent candidate '{target}' a suspicious visible behaviour (kind 'behavior', about "
                f"'{target}', on the surface) caused by an innocent secret (an attitude and, if needed, an event), and a deeper "
                "sign that explains it innocently (list it in 'explainedBy'). The behaviour sign carries no claim.")
    elif mode == 'pillar':
        pil = report.get('pillar_signs') or {}
        key = 'means' if target in (pil.get('means') or []) else 'motive'
        task = (f"DEEPEN THE {key.upper()} STEP. The culprit's {key} is shown too early (at depth {(report.get('pillars') or {}).get(key)}, "
                f"while the answer is only settled at depth {report['solve_depth']}) by these signs: {pil.get(key)}. Make ALL of them "
                "harder to reach: CONCEAL them behind something the player must first obtain, with a real in-world reason, "
                "or FRAGMENT them so they need another clue to be understood. Keep them TRUE and reachable.")
    else:
        settle = settling_signs(case, report, target)
        task = (f"REFINE sign '{target}' (the player currently gets it too easily). The thread it belongs to is currently settled "
                f"at depth {settle['depth']} by these signs: {settle['signs']}. To make progress ALL of them must end up deeper "
                "(you may hide or fragment several in one patch, or give them a shared deeper prerequisite). First answer the story question: who in "
                "this world would have a reason to make this sign harder to see, and why? Then apply one operator: "
                "CONCEAL (put it behind something the player must first obtain: an item, a favour, trust, a search - add those "
                "as new signs and list them in its 'requires'), FRAGMENT (make it need a second sign or a rule to be understood - "
                "add it to 'needs'; or split it), or MISLEAD (add a deception on the surface, defeated deeper). "
                f"Preferred operator this step: {preferred}. The case already has sign kinds {kinds}; prefer a kind it has little of "
                "(physical traces, behaviour, overheard talk, absences) over yet another record or document.")
    fb = f"\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED BY THE CHECKER. Fix exactly these problems:\n- " + "\n- ".join(feedback) if feedback else ''
    return f"""CURRENT CASE:
{json.dumps(case, separators=(',', ':'))}

KERNEL ANALYSIS (computed by code): {json.dumps(state)}

TASK: {task}

Return a PATCH as one JSON object:
{{"story":"one or two sentences: who acts, why, and what it leaves behind",
  "operator":"Conceal|Fragment|Mislead","blocks":["..."],
  "add":{{"people":[],"objects":[],"relations":[],"possession":[],"rules":[],"attitudes":[],"events":[],"signs":[]}},
  "modify":{{"signs":{{"<id>":{{"requires":[],"needs":[],"text":"...","title":"...","claim":{{}}}}}},"events":{{"<id>":{{}}}}}},
  "remove":["<sign id, only the target, only if you split it>"]}}
{('This case uses a FIXED setting: do not add people or places; new objects and documents are fine (prefer ones with pictures: ' + ', '.join(o['label'] for o in FIXED.get('objects', [])) + '). ' if FIXED else '')}Rules for the patch: the patch MUST add at least one event or attitude (the story beat that causes the change);
every new event must fit each participant's timeline (one place at a time, with travel time between places, and people
in 'others' are located there too); a false sign must list its speaker's reason in 'because' (testimony) or a deliberate
'source' event, and some deeper TRUE sign must list it in 'defeats'; new ids must be unique; 'modify' replaces only the fields you give; the answer must remain uniquely
determined by all evidence; do not make it solvable at a shallower depth than now (solve_depth {report['solve_depth']}).{fb}"""


CRITIC = """You are an independent reviewer of one step in a generated mystery. Logic, timing and uniqueness have ALREADY been
checked by code; do not re-check them. Judge only what code cannot: COMMON-SENSE PLAUSIBILITY, FAIRNESS and CRAFT.
You see the whole case; judge the step's new or changed signs (signs_touched) in that context.
Fail the step if any of these hold:
- LOCK: an 'unlock' reason is arbitrary (moon logic): obtaining the prerequisite would not, in this world, lead the
  detective to the new sign (e.g. an account at the inn opening a letter at the manor with no reason to go and look)
- READING: a 'reading' reason does not actually make sense of the clue
- CHARACTER: a character acts against their established attitudes or knowledge, or with no believable reason
- LOOSE END: a sign names or implicates a person (holds a key, was seen, owns an item) and nothing in the case explains
  it, so an innocent looks guilty for a reason the case never resolves
- GIVEAWAY: a sign's text names the culprit or announces what it proves, instead of being a neutral observation
- CONTRADICTION: the step contradicts something already established in the case
Be strict but fair; small stylistic issues are not failures. Every "fail" MUST list at least one issue that names the
sign id, the check (LOCK, READING, CHARACTER, LOOSE END, GIVEAWAY, CONTRADICTION) and what to change.
Reply with ONE JSON object: {"verdict":"pass"|"fail","issues":["<sign id>: <CHECK>: specific, actionable problem", ...]}"""

CRITIC_SCHEMA = {'type': 'object', 'properties': {'verdict': {'type': 'string', 'enum': ['pass', 'fail']},
                                                  'issues': {'type': 'array', 'items': {'type': 'string'}}},
                 'required': ['verdict', 'issues']}


def compact_sign(x):
    keep = ('id', 'kind', 'title', 'at', 'speaker', 'about', 'text', 'requires', 'unlock', 'needs', 'reading', 'claim', 'defeats', 'explainedBy', 'source')
    return {k: x[k] for k in keep if x.get(k) not in (None, [], '')}


def critic(case, patch):
    ids = {x['id'] for x in (patch.get('add') or {}).get('signs', [])} | set(((patch.get('modify') or {}).get('signs') or {}).keys())
    ctx = {'setting': case['setting'].get('summary'), 'question': case['question'].get('text'),
           'truth': hyp_map(case)[case['question']['truth']].get('label'),
           'people': [{k: p.get(k) for k in ('id', 'name', 'role', 'traits')} for p in case['people']],
           'relations': case.get('relations', []), 'possession': case.get('possession', []),
           'attitudes': case['attitudes'], 'events': case['events'],
           'signs_touched': [compact_sign(x) for x in case['signs'] if x['id'] in ids],
           'other_signs': [compact_sign(x) for x in case['signs'] if x['id'] not in ids]}
    prompt = f"STORY OF THIS STEP: {patch.get('story')}\n\nCASE:\n{json.dumps(ctx, separators=(',', ':'))}"
    try:
        for _ in range(2):
            out = llm_json(CRITIC, prompt, 2500, model=CRITIC_MODEL, schema=CRITIC_SCHEMA)
            issues = [str(i) for i in out.get('issues', []) if str(i).strip()][:6]
            if out.get('verdict') == 'pass':
                return True, [], out
            if issues:          # a failure without reasons gives the redraft nothing to act on: ask again
                return False, issues, out
        return True, ['reviewer failed without giving a reason twice; accepted'], out
    except Exception as e:
        return True, [f'critic unavailable: {e}'], {'error': str(e)}


def lock_setting(case):
    """Fixed setting by construction: places and links are the setting's; cast identity fields are the setting's."""
    if not FIXED:
        return case
    case['setting'] = {**case.get('setting', {}), 'places': FIXED['places'], 'links': FIXED['links'], 'name': FIXED['name'],
                       'roles': FIXED.get('roles', {}), 'day': FIXED.get('day', {})}
    ident = {p['id']: p for p in FIXED['people']}
    for person in case.get('people', []):
        if person['id'] in ident:
            person.update({k: v for k, v in ident[person['id']].items() if k != 'id'})
    have = {p['id'] for p in case.get('people', [])}
    case['people'] += [dict(p, traits={}) for p in FIXED['people'] if p['id'] not in have]
    return case


def unwrap_case(x):
    """Models sometimes wrap the case ({"case": {...}}) or return it as a JSON string inside a field."""
    for _ in range(3):
        if isinstance(x, str):
            x = parse_json(x)
        if isinstance(x, dict) and 'events' not in x and len(x) <= 3:
            inner = [v for v in x.values() if isinstance(v, (dict, str))]
            if inner:
                x = inner[0]; continue
        break
    return x


def premise_errors(case, premise):
    if not premise:
        return []
    import premise as P
    return P.seed_errors(case, premise)


def history_errors(case):
    """Requirements every generated case keeps after the seed: the morning (discovery and examination, typed) and
    that every account is backed by the history."""
    if not FIXED:
        return []
    import premise as P
    unb = unbacked_accounts(case)
    return P.morning_errors(case) + P.evening_errors(case) + ([f"accounts not backed by the true history (an event the speaker took part in or saw, or a 'knows' "
                                      f"attitude of theirs cited in 'because'): {unb}; back each one, or drop it"] if unb else [])


def setting_errors(case):
    if not FIXED:
        return []
    ids = {p['id'] for p in FIXED['people']}
    extra = [p['id'] for p in case.get('people', []) if p['id'] not in ids]
    errs = [f"Bellweather's cast is fixed: remove the invented people {extra}; use existing characters, objects or documents"] if extra else []
    if [pl['id'] for pl in case['setting']['places']] != [pl['id'] for pl in FIXED['places']]:
        errs.append("Bellweather's places are fixed: do not add, rename or remove places")
    return errs


def apply_patch(case, patch, target):
    c = copy.deepcopy(case)
    add = patch.get('add') or {}
    for k in ('people', 'objects', 'relations', 'possession', 'rules', 'attitudes', 'events', 'signs'):
        c.setdefault(k, [])
        c[k].extend(add.get(k) or [])
    mods = patch.get('modify') or {}
    for group in ('signs', 'events', 'people'):
        idx = {x['id']: x for x in c.get(group, [])}
        for i, fields in (mods.get(group) or {}).items():
            if i not in idx:
                raise ValueError(f'modify {group}: unknown id {i}')
            idx[i].update(fields)
    for r in patch.get('remove') or []:
        if r != target:
            raise ValueError(f'may only remove the target sign, not {r}')
        c['signs'] = [s for s in c['signs'] if s['id'] != r]
        for s in c['signs']:
            for f in ('requires', 'needs', 'defeats', 'explainedBy'):
                if r in s.get(f, []):
                    raise ValueError(f'removed {r} is still referenced by {s["id"]}.{f}')
    return c

# ----------------------------------------------------------------------------------------------------
# Scheduler (code)
# ----------------------------------------------------------------------------------------------------

def schedule(case, report, step, hist, D, profile=None):
    """The next step: what the case lacks for its difficulty profile (twist, implicate, herring, pillar), then
    deepening the shallowest thread. With no profile, the medium targets."""
    profile = profile or {'twist': True, 'herrings': [1, 2], 'herrings_aimed': 0}
    A, q = report['A'], case['question']
    truth_actor = actor_of(hyp_map(case)[q['truth']])
    ops = [h['operator'] for h in hist if h.get('accepted')]
    preferred = min(['Conceal', 'Fragment', 'Mislead'], key=ops.count)
    if profile['twist'] and step >= 2 and not report['twist'] and 'twist' not in [h['mode'] for h in hist if h.get('accepted')]:
        cand = [sid for sid in A['understood'] if claim_of(A['signs'][sid]) and A['truthval'].get(sid)]
        cand.sort(key=lambda s: (A['eff'][s], s))
        return 'twist', cand[0] if cand else None, 'Mislead', 'truth', None
    pil_now = report.get('pillars') or {}
    if step >= 3 and (pil_now.get('motive') is None or pil_now.get('means') is None) and \
            [h['mode'] for h in hist if h.get('accepted')].count('implicate') < 2 and \
            [h['mode'] for h in hist[-2:]].count('implicate') < 2:
        return 'implicate', actor_of(hyp_map(case)[q['truth']]), 'Conceal', None, None
    lo, hi = profile['herrings']
    if step >= 3 and len(report['herrings']) < max(lo, 1 if hi else 0):
        innocents = [h for h in q['candidates'] if h['id'] != q['truth'] and actor_of(h) and actor_of(h) != truth_actor]
        used = {s.get('about') for s in case['signs'] if s['kind'] == 'behavior'}
        # aimed misdirection: the suspect the obvious reading already points to
        obvious = [actor_of(h) for h in innocents if h['id'] in (report.get('surface') or [])]
        order = (obvious if profile.get('herrings_aimed') else []) + [actor_of(h) for h in innocents]
        pick = next((a for a in order if a not in used), order[0] if order else None)
        if pick and [h['mode'] for h in hist if h.get('accepted')].count('herring') < hi:
            return 'herring', pick, 'Mislead', None, None
    # The means or motive evidence must not be obvious long before the answer: deepen a pillar more than two levels
    # shallower than the solve depth (at most twice in a row).
    pil = report.get('pillars') or {}
    solve = report.get('solve_depth') or 0
    recent_modes = [h['mode'] for h in hist[-2:]]
    for key in ('means', 'motive'):
        pd = pil.get(key)
        if pd is not None and solve - pd > 2 and recent_modes.count('pillar') < 2:
            signs_ = (report.get('pillar_signs') or {}).get(key) or []
            shallow = [x for x in signs_ if A['eff'].get(x) == pd]
            if shallow:
                return 'pillar', shallow[0], 'Conceal', key, pd
    # Thread targeting: the case is solved when every innocent is ruled out and the truth survives. Deepen the
    # SHALLOWEST thread by refining its critical signs (removing them would make that thread harder), shallowest first.
    targeted = [h['target'] for h in hist if h.get('accepted')]
    recent = targeted[-2:] + [h['target'] for h in hist[-2:] if not h.get('accepted')]
    threads = {t: d for t, d in (report.get('threads') or {}).items() if d is not None and d < D}
    for thread, tdepth in sorted(threads.items(), key=lambda kv: (kv[1], kv[0])):
        crit = [c for c in critical_signs(case, A, thread, tdepth) if A['truthval'].get(c) is not False]
        if not crit:  # redundant evidence: take any shallow sign that bears on this thread
            crit = [sid for sid in A['understood'] if A['eff'][sid] <= tdepth and claim_of(A['signs'][sid]) and A['truthval'].get(sid)]
        crit = [c for c in crit if c not in recent and targeted.count(c) < 3]
        if crit:
            crit.sort(key=lambda c: (A['eff'][c], targeted.count(c), c))
            return 'refine', crit[0], preferred, thread, tdepth
    return None, None, None, None, None

def settling_signs(case, report, target):
    """The shallow signs that currently settle the thread the target belongs to (so the model can hide all of them)."""
    A, q = report['A'], case['question']
    for thread, d in sorted((report.get('threads') or {}).items(), key=lambda kv: (kv[1] if kv[1] is not None else 99)):
        if d is None:
            continue
        crit = critical_signs(case, A, thread, d)
        if target in crit or A['eff'].get(target, 99) <= d:
            if thread == 'truth':
                bearing = [sid for sid in A['understood'] if A['eff'][sid] <= d and A['signs'][sid].get('defeats')]
            else:
                actor = actor_of(hyp_map(case)[thread])
                bearing = [sid for sid in A['understood'] if A['eff'][sid] <= d and claim_of(A['signs'][sid]) and A['truthval'].get(sid)
                           and (claim_of(A['signs'][sid]).get('person') == actor or claim_of(A['signs'][sid])['kind'] in ('trait', 'possession', 'relation', 'fact', 'time'))]
            return {'thread': thread, 'depth': d, 'signs': sorted(set(crit) | set(bearing))}
    return {'thread': None, 'depth': A['eff'].get(target), 'signs': [target]}


def survivors_one(case, A, sid):
    only = {x for x in A['understood'] if x != sid}
    return survivors(case, A, None, frozenset(only))

# ----------------------------------------------------------------------------------------------------
# Run one case
# ----------------------------------------------------------------------------------------------------

def step_laws(case, report, new, rep, patch, mode, target, thread, tdepth):
    """The refinement laws, checked by code on a candidate patch that already certified."""
    law = []
    if (rep['solve_depth'] or 0) < (report['solve_depth'] or 0):
        law.append(f"shortcut: the answer is now settled at depth {rep['solve_depth']}, earlier than {report['solve_depth']}")
    if report['twist'] and not rep['twist']:
        law.append(f"the twist was lost: the surface now admits the truth again (surface survivors {rep['surface']}); "
                   "keep the surface deception intact and only make its defeat deeper")
    if mode == 'twist' and not rep['twist']:
        law.append(f"the surface still admits the truth (surface survivors {rep['surface']}); the deception must exclude it")
    # motive and means evidence, once reachable, must stay reachable (deepening may hide it further, never lose it)
    for key in ('motive', 'means'):
        if (report.get('pillars') or {}).get(key) is not None and (rep.get('pillars') or {}).get(key) is None:
            law.append(f"the culprit's {key.upper()} evidence is no longer reachable and true; keep a way to it (it may lie deeper)")
    add = patch.get('add') or {}
    if not (add.get('events') or add.get('attitudes') or (patch.get('modify') or {}).get('events')):
        law.append('no story beat: every refinement must add the event or attitude that causes it (who did what, and why)')
    if mode == 'implicate' and len([x for x in (rep.get('motive'), rep.get('means')) if x]) <= \
            len([x for x in (report.get('motive'), report.get('means')) if x]):
        law.append('no new positive evidence: add a TRUE motive (relation fact with a = the culprit) or means '
                   '(culprit-centric possession/trait that rules out another candidate) sign that is reachable and readable')
    if mode == 'herring' and not rep['herrings']:
        law.append(f"no surface behaviour sign about '{target}' with a deeper explainedBy sign was found")
    if mode == 'pillar':
        before, after = (report.get('pillars') or {}).get(thread), (rep.get('pillars') or {}).get(thread)
        if after is None:
            law.append(f"the {thread} evidence is no longer reachable; it must stay reachable, only deeper")
        elif before is not None and after <= before:
            law.append(f"no progress: the {thread} is still shown at depth {after} (was {before}); hide or fragment every sign that shows it")
    if mode == 'refine':
        A2, nd = rep['A'], (rep.get('threads') or {}).get(thread)
        if target in {x['id'] for x in new['signs']} and target not in A2['understood']:
            law.append(f"the target '{target}' is no longer obtainable or readable at all; it must stay obtainable, only deeper")
        elif nd is not None and tdepth is not None and nd <= tdepth:
            law.append(f"no progress: the '{thread}' thread is still settled at depth {nd} (was {tdepth}); "
                       f"another path still settles it that early - hide or fragment those signs too, or make the target's chain longer")
    return law


class Cancelled(Exception):
    pass


def metrics_of(rep):
    keys = ('solve_depth', 'max_depth', 'surface', 'twist', 'herrings', 'false_signs', 'threads', 'motive', 'means', 'pillars', 'mmo_depth')
    return {k: rep.get(k) for k in keys} if rep.get('ok') else {'ok': False}


def case_added(before, after):
    """Records present in `after` but not in `before` (by id), per group: what one iteration added to the story."""
    out = {}
    for group in ('people', 'objects', 'attitudes', 'events', 'signs', 'rules', 'relations', 'possession'):
        old = {json.dumps(x, sort_keys=True) if group in ('relations', 'possession') else x.get('id') for x in (before or {}).get(group, [])}
        new = [x for x in after.get(group, []) if (json.dumps(x, sort_keys=True) if group in ('relations', 'possession') else x.get('id')) not in old]
        if new:
            out[group] = new
    return out


def run_case(name, brief, steps, D, outdir, log, emit=None, should_stop=None, premise=None, profile=None):
    """emit(event: dict) receives progress events; should_stop() is polled between model calls to cancel.
    profile (difficulty.target(level)) sets the depth, the steps, the time budget and what the case must have; when the
    budget runs out, refinement stops and the case is what it has become (rated honestly at publish)."""
    if profile:
        steps, D = profile['steps'], profile['depth']
    os.makedirs(outdir, exist_ok=True)
    t0 = time.time()
    emit = emit or (lambda e: None)
    def check_stop():
        if should_stop and should_stop():
            raise Cancelled()
    def send(kind, **data):
        emit({'kind': kind, 't': round(time.time() - t0, 1), **data})
    hist = []
    pool = cf.ThreadPoolExecutor(max_workers=CANDIDATES * 2)

    # SEED: CANDIDATES in parallel per round; first that certifies wins
    case, fb, best_case, seen = None, None, None, []
    send('phase', phase='seed', message='Writing the setting, cast, secrets and what really happened')
    for rnd in range(SEED_ROUNDS):
        check_stop()
        # after the first round, repair the best draft so far rather than start again (a fresh draft fixes one error
        # and brings back another); every rule broken so far is listed, so none returns
        extra = '' if not fb else (
            '\n\nYOUR PREVIOUS DRAFT (the closest so far) BROKE THESE RULES. Return the COMPLETE corrected case: keep '
            'everything that was right, change only what these need:\n- ' + '\n- '.join(fb)
            + ('\n\nRULES BROKEN IN EARLIER DRAFTS (keep them too):\n- ' + '\n- '.join(x for x in seen if x not in fb)[:3000] if any(x not in fb for x in seen) else '')
            + ('\n\nTHE PREVIOUS DRAFT:\n' + json.dumps(best_case)[:60000] if best_case else ''))
        futs = [pool.submit(llm_json, SYSTEM_GEN, seed_prompt(brief, premise) + extra, 20000) for _ in range(CANDIDATES)]
        send('drafting', round=rnd + 1, drafts=CANDIDATES)
        best = None
        for f in cf.as_completed(futs):
            raw = None
            try:
                raw = f.result()
                cand = lock_setting(unwrap_case(parse_json(raw))); rep = certify(cand, False)
                pe = premise_errors(cand, premise) + history_errors(cand)
                if pe or (rep['ok'] and setting_errors(cand)):
                    rep = {'ok': False, 'errors': pe + setting_errors(cand) + (rep.get('errors') or [])}
            except Exception as e:
                try:
                    json.dump(raw, open(f'{outdir}/seed-draft-{rnd + 1}-failed.json', 'w'), indent=1, default=str)
                except Exception:
                    pass
                cand, rep = None, {'ok': False, 'errors': [f'the case JSON was incomplete or malformed ({type(e).__name__}: {e}); return ONE complete case with every top-level list (people, attitudes, events, signs, question) and keep texts short']}
            send('draft_checked', ok=rep['ok'], errors=(rep.get('errors') or [])[:2])
            if rep['ok']:
                case = cand; break
            if best is None or len(rep['errors']) < len(best):
                best = rep['errors']
                if cand is not None:
                    best_case = cand
        if case:
            break
        fb = (best or [])[:12]; seen += [x for x in fb if x not in seen]; log(f'[{name}] seed round {rnd+1} rejected: {fb[:2]}')
        send('seed_rejected', round=rnd + 1, errors=fb)
    if case is None:
        pool.shutdown(wait=False, cancel_futures=True)
        send('failed', message='The first draft of the case never passed the checks', errors=fb)
        return {'name': name, 'ok': False, 'reason': 'seed never certified', 'last_errors': fb, 'seconds': round(time.time() - t0)}
    if premise:
        case['premise'] = premise
    report = certify(case, False)
    json.dump(case, open(f'{outdir}/00-seed.json', 'w'), indent=1)
    send('seed', case=case, metrics=metrics_of(report))
    log(f"[{name}] seed ok at {time.time()-t0:.0f}s: surface {report['surface']} solve {report['solve_depth']} threads {report['threads']} "
        f"twist {report['twist']} motive {bool(report['motive'])} means {bool(report['means'])} herring {bool(report['herrings'])}")

    def evaluate(patch_text, mode, target, thread, tdepth):
        try:
            patch = parse_json(patch_text); new = apply_patch(case, patch, target); rep = certify(new, False)
        except Exception as e:
            return None, None, None, [f'patch could not be applied: {e}']
        errs = setting_errors(new) + premise_errors(new, premise) + history_errors(new) + (rep.get('errors') or []) + (step_laws(case, report, new, rep, patch, mode, target, thread, tdepth) if rep['ok'] else [])
        return patch, new, rep, errs

    for step in range(1, steps + 1):
        th = [d for d in (report.get('threads') or {}).values() if d is not None]
        truth_d = (report.get('threads') or {}).get('truth') or 0
        check_stop()
        lacking = DF.targets_met(case, report, profile) if profile else (
            [] if (report['solve_depth'] or 0) >= D and min(th or [0]) >= 2 and truth_d >= 3 and report['twist'] and report['herrings']
            and (report.get('pillar_signs') or {}).get('motive') and (report.get('pillar_signs') or {}).get('means') else ['targets'])
        if not lacking:
            send('phase', phase='targets', message='Every target met')
            log(f'[{name}] targets met at {time.time()-t0:.0f}s (solve depth {report["solve_depth"]}): stopping'); break
        if profile and time.time() - t0 > profile['seconds']:
            send('phase', phase='targets', message='Time budget reached: the case is finished as it stands')
            log(f'[{name}] time budget {profile["seconds"]}s reached at step {step}; still lacking: {lacking}'); break
        mode, target, preferred, thread, tdepth = schedule(case, report, step, hist, D, profile)
        if not target:
            log(f'[{name}] step {step}: no qualifying target, stopping'); break
        fb, entry = None, {'step': step, 'mode': mode, 'target': target, 'thread': thread, 'preferred': preferred, 'attempts': []}
        ts = time.time()
        before = case
        send('step_start', step=step, mode=mode, target=target, thread=thread, operator=preferred,
             target_title=next((x.get('title') for x in case['signs'] if x['id'] == target), target))
        for rnd in range(2):
            check_stop()
            prompt = step_prompt(case, report, target, mode, preferred, fb)
            # drafts from two models in parallel; the first one that passes the code checks AND the review wins,
            # so a step waits only for the fastest good draft (the slower one is cancelled)
            models = ([MODEL, CRITIC_MODEL] * CANDIDATES)[:CANDIDATES]
            gens = {pool.submit(llm_json, SYSTEM_GEN, prompt, 9000, m): m for m in models}
            send('drafting', step=step, round=rnd + 1, drafts=CANDIDATES)
            results, winner = [], None
            for g in cf.as_completed(gens):
                try:
                    r = evaluate(g.result(), mode, target, thread, tdepth)
                except Exception as e:
                    r = (None, None, None, [f'model call failed: {e}'])
                results.append(r)
                entry['attempts'].append(r[3])
                send('draft_checked', step=step, ok=not r[3], errors=r[3][:2])
                if r[3]:
                    continue
                send('reviewing', step=step, drafts=1)
                ok, issues, raw = critic(r[1], r[0])
                entry.setdefault('critic', []).append({'pass': ok, 'issues': issues, 'raw': raw, 'model': gens[g]})
                log(f"[{name}] step {step} review ({gens[g]}): {'pass' if ok else 'FAIL'} {issues[:3]}")
                if ok:
                    winner = r
                    break
                r[3].extend('plausibility review: ' + i for i in (issues or ['failed']))
            for g in gens:
                g.cancel()
            if winner:
                patch, new, rep, _ = winner
                case, report = new, rep
                entry.update(accepted=True, operator=patch.get('operator'), blocks=patch.get('blocks'), story=patch.get('story'),
                             solve_depth=rep['solve_depth'], surface=rep['surface'], threads=rep.get('threads'))
                break
            fb = min((r[3] for r in results), key=len)[:12]
        entry.setdefault('accepted', False)
        entry['seconds'] = round(time.time() - ts)
        hist.append(entry)
        send('step', step=step, mode=mode, target=target, thread=thread, accepted=entry['accepted'],
             operator=entry.get('operator'), blocks=entry.get('blocks'), story=entry.get('story'),
             attempts=[a[:4] for a in entry['attempts']], critic=entry.get('critic', []), seconds=entry['seconds'],
             added=case_added(before, case) if entry['accepted'] else {}, metrics=metrics_of(report))
        json.dump(case, open(f'{outdir}/{step:02d}-case.json', 'w'), indent=1)
        log(f"[{name}] step {step} {mode}:{target} -> {'OK ' + str(entry.get('operator')) if entry['accepted'] else 'REJECTED'}"
            f" ({len(entry['attempts'])} candidates, {entry['seconds']}s, solve {report['solve_depth']})")
    pool.shutdown(wait=False, cancel_futures=True)
    final = certify(case, False)
    result = {'name': name, 'brief': brief, 'ok': final['ok'], 'history': hist, 'seconds': round(time.time() - t0),
              'metrics': {k: final.get(k) for k in ('solve_depth', 'max_depth', 'surface', 'twist', 'key', 'herrings', 'false_signs', 'threads', 'motive', 'means', 'pillars', 'mmo_depth')},
              'signs': len(case['signs']), 'events': len(case['events']), 'people': len(case['people'])}
    json.dump(case, open(f'{outdir}/final-case.json', 'w'), indent=1)
    json.dump(result, open(f'{outdir}/result.json', 'w'), indent=1)
    open(f'{outdir}/report.md', 'w').write(render(case, final, result))
    log(f"[{name}] DONE in {result['seconds']}s: solve {final.get('solve_depth')} threads {final.get('threads')}")
    result['case'] = case
    send('generated', metrics=metrics_of(final), seconds=result['seconds'])
    return result

# ----------------------------------------------------------------------------------------------------
# Rendering
# ----------------------------------------------------------------------------------------------------

def hm(m):
    m = int(m) % 1440
    return f'{m // 60:02d}:{m % 60:02d}'


def render(case, rep, result):
    q, A = case['question'], rep.get('A')
    ppl = people(case)
    L = [f"# {case['setting']['name']}", '', f"*{case['setting'].get('era','')}* - {case['setting'].get('summary','')}", '',
         f"**Question:** {q['text']}", '', '**Candidates:** ' + '; '.join(f"{h['label']}" for h in q['candidates']), '',
         f"**Truth:** {hyp_map(case)[q['truth']]['label']}", '']
    m = result['metrics']
    L += ['## Certification (computed by code)', '',
          f"- certified: **{rep['ok']}**; solve depth **{m['solve_depth']}**; deepest sign **{m['max_depth']}**; generated in {result.get('seconds')}s",
          f"- surface survivors: {m['surface']} (twist: **{m['twist']}**); thread depths: {m.get('threads')}",
          f"- load-bearing signs: {m['key']}", f"- false signs (lies / staging): {m['false_signs']}",
          f"- red herrings: {m['herrings']}", f"- motive signs: {m.get('motive')}; means signs: {m.get('means')}", '']
    L += ['## Refinement log', '']
    for h in result['history']:
        mark = 'accepted' if h['accepted'] else 'rejected'
        L.append(f"{h['step']}. **{h['mode']}** on `{h['target']}` - {mark}"
                 + (f" ({h.get('operator')}; {', '.join(h.get('blocks') or [])}; {len(h['attempts'])} attempt(s))" if h['accepted'] else ''))
        if h.get('story'):
            L.append(f"   - {h['story']}")
        for i, errs in enumerate(h['attempts']):
            if errs:
                L.append(f"   - attempt {i+1} rejected: " + '; '.join(map(str, errs[:3])))
    L += ['', "## The player's peel (signs by depth)", '']
    if A:
        by = {}
        for sid, d in A['eff'].items():
            by.setdefault(d, []).append(A['signs'][sid])
        for d in sorted(by):
            L.append(f'### Depth {d}')
            for s in by[d]:
                tv = A['truthval'].get(s['id'])
                tag = '' if tv is None else (' [TRUE]' if tv else ' [FALSE]')
                extra = []
                if s.get('requires'): extra.append('needs access: ' + ', '.join(s['requires']))
                if s.get('needs'): extra.append('to read: ' + ', '.join(s['needs']))
                if s.get('defeats'): extra.append('defeats: ' + ', '.join(s['defeats']))
                who = f" ({ppl.get(s.get('speaker'), {}).get('name', s.get('speaker'))})" if s.get('speaker') else ''
                L.append(f"- **{s.get('title', s['id'])}** `{s['id']}` · {s['kind']}{who}{tag} @ {s.get('at','-')}: {s.get('text','')}"
                         + (f"  \n  _{'; '.join(extra)}_" if extra else ''))
            L.append('')
    L += ['## True history', '']
    for e in sorted(case['events'], key=lambda e: e['start']):
        L.append(f"- {hm(e['start'])}-{hm(e['end'])} @ {e['place']}: {e.get('summary', e['type'])}"
                 + (f" _(because: {e.get('causedBy')})_" if e.get('causedBy') else ''))
    return '\n'.join(L) + '\n'

# ----------------------------------------------------------------------------------------------------

BRIEFS = {
    'liner': 'A 1920s transatlantic ocean liner, mid-crossing. Question: who killed the financier found in the first-class smoking room?',
    'scriptorium': 'A medieval abbey scriptorium in winter. Question: who took the missing illuminated manuscript, and it was not stolen for money.',
    'station': 'An Antarctic research station during a six-day storm. Question: who sabotaged the generator that nearly killed the crew?',
    'studio': 'A 1960s Bombay film studio on the night before a premiere. Question: who poisoned the leading actress (she survived)?',
    'lighthouse': 'A lighthouse on the Cornish coast in the 1890s. Question: who caused the keeper to fall from the gallery in a storm?',
}


BELLWEATHER_BRIEFS = {
    'bw-ledger': 'Edmund Vale is found dead in his study at Vale Manor. Question: who killed him? The culprit is not the person the village first suspects.',
    'bw-poison': 'Edmund Vale dies in the night after a supper at Vale Manor; the doctor suspects poison. Question: who poisoned him?',
    'bw-pair': 'Edmund Vale is found at the foot of the greenhouse steps, apparently a fall. Question: who caused his death? Someone in the village is protecting the culprit.',
    'bw-vestry': 'Edmund Vale is found dead in St. Alden\u2019s vestry, where he had gone to amend his will. Question: who killed him? An old wrong from twenty years ago is behind it.',
    'bw-inn': 'Edmund Vale collapses and dies in the back parlour of the Rook & Lantern after a quarrel. Question: who killed him? More than one person lies that night, for different reasons.',
    'bw-letter': 'Edmund Vale is found dead in his study, a half-burned letter in the grate. Question: who killed him? The person with the most obvious motive did not do it.',
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--steps', type=int, default=8)
    ap.add_argument('--depth', type=int, default=5)
    ap.add_argument('--only', default=None)
    ap.add_argument('--model', default=None)
    ap.add_argument('--rich-seed', action='store_true')
    ap.add_argument('--setting', default=None, help='fixed setting name in settings/ (e.g. bellweather)')
    a = ap.parse_args()
    global MODEL
    if a.model:
        MODEL = a.model
    global SEED_SURFACE_TEXT
    if a.rich_seed:
        SEED_SURFACE_TEXT = SEED_RICH
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    root = f'{HERE}/runs/{stamp}'
    os.makedirs(root, exist_ok=True)
    lines = []
    def log(s):
        line = f"{datetime.datetime.now().strftime('%H:%M:%S')} {s}"
        print(line, flush=True); lines.append(line)
    global FIXED
    pool_briefs = BRIEFS
    if a.setting:
        FIXED = json.load(open(f'{HERE}/settings/{a.setting}.json'))
        pool_briefs = BELLWEATHER_BRIEFS if a.setting == 'bellweather' else BRIEFS
    briefs = {k: v for k, v in pool_briefs.items() if not a.only or k in a.only.split(',')}
    t0 = time.time()
    results = []
    with cf.ThreadPoolExecutor(max_workers=len(briefs)) as ex:
        futs = {ex.submit(run_case, k, v, a.steps, a.depth, f'{root}/{k}', log): k for k, v in briefs.items()}
        for f in cf.as_completed(futs):
            try:
                results.append(f.result())
            except Exception as e:
                results.append({'name': futs[f], 'ok': False, 'reason': repr(e), 'trace': traceback.format_exc()})
                log(f'[{futs[f]}] crashed: {e!r}')
    summary = {'model': MODEL, 'minutes': round((time.time() - t0) / 60, 1), 'usage': USAGE, 'results': results}
    json.dump(summary, open(f'{root}/summary.json', 'w'), indent=1)
    open(f'{root}/log.txt', 'w').write('\n'.join(lines) + '\n')
    print(f'\nRUN DIR {root}\n' + json.dumps({'minutes': summary['minutes'], 'usage': USAGE}), flush=True)


if __name__ == '__main__':
    main()
