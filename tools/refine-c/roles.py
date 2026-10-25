"""Rules about who people are in a case that certification cannot see, checked by code on every generated step and at
publication (so they hold for newly generated cases as well as published ones).

ally_errors: the constable is the detective's ally. He is never a suspect, never says anything untrue, never hides,
moves or tampers with evidence, and never holds anything back: what he knows and keeps is the detective's when first
asked (no account of his and nothing in his keeping waits behind 'requires').

examiner_errors: what the doctor found on the body, her notes on it and the dead man's effects she took are never held
behind another account of hers (a patient's call, her own evening): only behind her account of the examination, or a
clue that gives the detective reason to ask. A patient's confidence covers that patient, never the dead. (Unless the
doctor is herself a suspect.)

herring_errors: a red herring must be explainable. Its innocent reason is an attitude of the person it concerns (the
cause of what they did, or a reason cited for it), so the person can say why when pressed and the closing file can
tell the player what was left.
"""
import os
import json

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'settings', 'bellweather.json')) as source:
    _SETTING = json.load(source)


def constable_of(case):
    """The constable's id, from the case's setting or the shared one (whether or not the case lists him)."""
    return ((case.get('setting') or {}).get('roles') or _SETTING.get('roles') or {}).get('constable')


def _truth_actor(case):
    q = case['question']
    return next(h for h in q['candidates'] if h['id'] == q['truth'])['facts']['actor']


def role_of(case, name):
    """The id holding a setting role (constable, examiner), from the case's setting or the shared one."""
    return ((case.get('setting') or {}).get('roles') or _SETTING.get('roles') or {}).get(name)


def examiner_errors(case):
    ex = role_of(case, 'examiner')
    if not ex or any(h['facts'].get('actor') == ex for h in case['question']['candidates']):
        return []
    morning = ((case.get('setting') or {}).get('day') or _SETTING.get('day') or {}).get('morning', 1740)
    events = {e['id']: e for e in case.get('events', [])}
    signs = {x['id']: x for x in case['signs']}
    duty = lambda x: (events.get(x.get('source')) or {}).get('agent') == ex and (events.get(x.get('source')) or {}).get('start', 0) >= morning
    # her account of the examination: her own testimony from this morning's duties
    exam_accounts = {x['id'] for x in case['signs'] if x.get('kind') == 'testimony' and x.get('speaker') == ex and duty(x)}
    other = lambda r: r not in exam_accounts and (signs.get(r) or {}).get('kind') == 'testimony' and (signs.get(r) or {}).get('speaker') == ex

    def held_behind(x, seen):
        """Her other accounts this sign waits behind, directly or through more of her own duty signs."""
        out = []
        for r in x.get('requires', []):
            if r in seen:
                continue
            seen.add(r)
            if other(r):
                out.append(r)
            elif r in signs and duty(signs[r]):
                out += held_behind(signs[r], seen)
        return out
    errors = []
    for x in case['signs']:
        if x.get('kind') == 'public' or not duty(x):
            continue
        held_by_her = sorted(set(held_behind(x, set())))
        if held_by_her:
            errors.append(f"EXAMINER: {x['id']} comes from the doctor's examination duties but waits behind her other account "
                          f"{held_by_her}; a patient's confidence or her own evening never covers what she found on the dead. "
                          "Let her account of the examination, or a clue that gives the detective reason to ask, lead to it")
    return errors


def ally_errors(case):
    from refine import claim_true
    from claims import claim_of
    con = constable_of(case)
    if not con:
        return []
    errors = []
    if any(h['facts'].get('actor') == con for h in case['question']['candidates']):
        errors.append(f"ALLY: the constable ({con}) is a candidate; he is the detective's ally and is never a suspect")
    events = {e['id']: e for e in case.get('events', [])}
    defeated = {d for x in case['signs'] for d in x.get('defeats', [])}
    for x in case['signs']:
        c = claim_of(x)
        if x.get('speaker') == con and x.get('kind') == 'testimony':
            if (c is not None and not claim_true(case, c)) or x['id'] in defeated:
                errors.append(f"ALLY: {x['id']} is a false account by the constable; he never lies (give the lie to someone with a reason to tell it)")
            if x.get('requires'):
                errors.append(f"ALLY: {x['id']} is an account the constable holds back until {x['requires']}; he tells what he knows "
                              "when first asked (drop its 'requires', or give it to someone with a reason to withhold it)")
        source = events.get(x.get('source')) or {}
        if source.get('agent') == con and x.get('kind') not in ('testimony', 'public'):
            if x.get('requires'):
                errors.append(f"ALLY: {x['id']} comes from the constable's own doing ({source['id']}) and waits behind {x['requires']}; "
                              "nothing in his keeping is held back (drop its 'requires', or make someone else keep it)")
            if c is not None and not claim_true(case, c):
                errors.append(f"ALLY: {x['id']} is a false sign the constable made ({source['id']}); he never stages, hides or tampers with evidence")
    return errors


def _reason_ids(case, b):
    """Attitudes of the behaviour's subject that explain it: the cause of its source event (and of the events that one
    stems from), else attitudes it cites, else the same for what explains it; the same walk as the game's
    innocentReason."""
    pid = b.get('about')
    mine = {a['id'] for a in case.get('attitudes', []) if a.get('agent') == pid}
    events = {e['id']: e for e in case.get('events', [])}
    signs = {x['id']: x for x in case['signs']}

    def walk(x):
        seen, e = set(), events.get((x or {}).get('source'))
        while e and e['id'] not in seen:
            seen.add(e['id'])
            if e.get('causedBy') in mine:
                return [e['causedBy']]
            e = events.get(e.get('causedBy'))
        return [a for a in (x or {}).get('because', []) if a in mine]
    for x in [b, *(signs.get(e) for e in b.get('explainedBy', []))]:
        found = walk(x)
        if found:
            return found
    return []


def herring_errors(case, A=None):
    """Every red herring (behaviour about an innocent, explained by a deeper sign the player can understand: the
    certifier's definition) has a stated reason of its subject's."""
    from refine import analyse
    A = A or analyse(case)
    truth = _truth_actor(case)
    errors = []
    for b in case['signs']:
        if b.get('kind') != 'behavior' or b.get('about') in (None, truth):
            continue
        if not any(e in A['understood'] and A['eff'][e] > A['eff'].get(b['id'], 0) for e in b.get('explainedBy', [])):
            continue
        if not _reason_ids(case, b):
            errors.append(f"HERRING: {b['id']} has no stated reason: its source event (or that of what explains it) must be "
                          f"caused by an attitude of {b['about']} (what they feared, wanted or believed), so they can say why when pressed")
    return errors
