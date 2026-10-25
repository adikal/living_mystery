"""Variant C refinement harness (experiment, see docs/mystery-kernel.md).

Code decides WHERE a case gets harder (frontier + scheduler) and checks every step; the LLM decides HOW
and WHY (the story step). The LLM never declares what a sign eliminates: it writes propositions in fixed
sign kinds, and this file computes eliminations, truth, reachability, depth and the refinement laws.

Usage: python tools/refine-c/refine.py [--steps 8] [--depth 5] [--only NAME] [--model ID]
"""
import argparse, concurrent.futures as cf, copy, datetime, json, os, re, sys, threading, time, traceback
from dataclasses import dataclass
from enum import Enum
import boto3
from botocore.config import Config
import difficulty as DF
import provenance
import timing
from migrate import public_knowledge
from claims import (CLAIMS_VERSION, PREDICATES, CULPRIT_PREDICATES, History, claim_errors, claim_of, consistent, defeat_free_sets,
                    instance_claims, record_errors, relation_reader, survivors_of, travel_table, truth_of, victim_of, actor_of)

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = 'us.anthropic.claude-opus-5-5'          # story steps and seed
CRITIC_MODEL = 'us.anthropic.claude-sonnet-5'     # short wording and judging calls in publishing
# Reviews of a step and of the whole case use the story model. Measured on 25 October on a case with six real
# problems: it found three in 33 s; Sonnet found one in 57 s at medium effort, and at its default effort thought through
# a 16,000-token budget without answering.
REVIEW_MODEL = MODEL
FAST_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'   # small checks (e.g. near-duplicate questions)
SEED_ROUNDS = 4                                  # draft, then up to three repairs of the best draft
SEED_CANDIDATES = int(os.environ.get('LM_SEED_CANDIDATES', '6'))   # parallel seed drafts per round: a first round that
                                                   # passes saves a whole repair round (about a minute and a half)
CANDIDATES = 3                                     # parallel drafts per round, spread over the step's options
# the models step drafts are spread over: diversity comes from the options (targets, operators). Over the October runs
# Sonnet's drafts passed 3 of 41 times and Opus's 50 of 95, and Sonnet's took longer
DRAFT_MODELS = tuple(os.environ.get('LM_DRAFT_MODELS', MODEL).split(','))
STACK_MODES = ('refine', 'clear')                  # steps whose passing drafts for different targets are applied together
REVISE_MIN = 45                                    # seconds a round must still have for a rejected draft to be revised in it
STEP_GRACE = 25                                    # at most this many seconds for the other drafts once one has passed


def grace(elapsed):
    """How long the other drafts get once one has passed, `elapsed` seconds into the round: half as long again as the
    winner took, at most STEP_GRACE. Siblings started together; one still thinking at 1.5 times the winner's time is
    a long thinker, and waiting the full grace for it cost about 25 s a step (timings, October 25)."""
    return min(STEP_GRACE, 0.5 * elapsed)
ROUND_LIMIT = int(os.environ.get('LM_ROUND_LIMIT', '150'))   # seconds a round of drafts may take in all
FIXED = None                                       # a fixed setting (e.g. Bellweather): its places, links and cast are locked
# 'public' signs are what everyone in the setting knows: the player holds them from the start.
SIGN_KINDS = {'trace', 'testimony', 'document', 'record', 'behavior', 'item', 'rule', 'observation', 'absence', 'public'}

# ----------------------------------------------------------------------------------------------------
# World model helpers
# ----------------------------------------------------------------------------------------------------

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

def claim_true(case, claim, tt=None):
    """Truth of a claim in the true history: True, False, or None (undetermined)."""
    return truth_of(case, History(case, tt), claim)

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
    H = History(case, tt)
    truthval = {sid: truth_of(case, H, claim_of(signs[sid])) for sid in signs if claim_of(signs[sid])}
    return dict(tt=tt, H=H, signs=signs, depth=depth, eff=eff, reachable=reachable, understood=understood,
                truthval=truthval, rules_known=known_rule_depth)


def trusted_claims(A, visible):
    """The trusted claims among the visible signs: those no visible sign defeats, as [(sid, claim), ...]."""
    defeated = {d for sid in visible for d in A['signs'][sid].get('defeats', [])}
    return [(sid, claim_of(A['signs'][sid])) for sid in sorted(visible) if sid not in defeated and claim_of(A['signs'][sid])]


def survivors(case, A, max_depth=None, exclude=frozenset()):
    """Candidates consistent with every understood, trusted claim with effective depth <= max_depth."""
    visible = [sid for sid in A['understood'] if sid not in exclude and (max_depth is None or A['eff'][sid] <= max_depth)]
    return survivors_of(case, trusted_claims(A, visible), A['tt'])


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


def cleared_alone(case, report):
    """The innocents still ruled out without any evidence that points at the culprit (claims about the culprit, and the
    signs certification counts as the culprit's motive and means, with everything that depends on them): cleared on
    evidence of their own, an alibi or a witness, so the player has suspects to eliminate rather than one chain that
    convicts and clears everyone at once (The Iron Hound: none of its three)."""
    A = report['A']
    pillars = report.get('pillar_signs') or {}
    pos = [s for s in A['understood'] if (claim_of(A['signs'][s]) or {}).get('pred') in CULPRIT_PREDICATES
           or s in (pillars.get('motive') or []) or s in (pillars.get('means') or [])]
    ex = frozenset().union(*[closure_dependent(case, s) for s in pos]) if pos else frozenset()
    return sorted(t for t, d in thread_depths(case, A, ex).items() if t != 'truth' and d is not None)


def critical_signs(case, A, thread, depth):
    """Signs whose removal (with everything depending on them) makes this thread deeper or unsolvable."""
    out = []
    for sid in A['understood']:
        if A['eff'][sid] > depth or A['signs'][sid].get('kind') == 'public':
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
    if c['pred'] == 'wasAt':
        if c.get('person') == sp:
            return 'self'
        if any(part(e) and e['place'] == c['place'] and e['start'] <= c['to'] and e['end'] >= c['from'] for e in case['events']):
            return 'witnessed'
    return None


def unbacked_accounts(case):
    return sorted(x['id'] for x in case['signs'] if x.get('kind') == 'testimony' and account_backing(case, x) is None)


def pillar_signs(case, A):
    """Motive and means evidence for the true culprit: understood, true signs that establish (not eliminate).
    motive: a related claim whose subject is the culprit, linked to the victim (or a crimeFact keyed 'motive');
    means:  a had or hasTrait claim about the culprit, or a culpritHad or culpritTrait claim the culprit satisfies."""
    q = case['question']
    ta = actor_of(hyp_map(case)[q['truth']])
    return pillar_signs_for(case, A, ta)


def pillar_signs_for(case, A, actor, held=None):
    victim, read, motive, means = victim_of(case), relation_reader(case), [], []
    linked = lambda a, b: not victim or victim in (a, b)
    for sid, s_ in A['signs'].items():
        # what everyone knows is not evidence against anyone: only clues count
        if sid not in A['understood'] or A['truthval'].get(sid) is not True or s_.get('kind') == 'public' or (held is not None and sid not in held):
            continue
        c = claim_of(s_)
        if not c or c.get('when') == 'never' or c.get('not'):
            continue
        # culprit predicates count for the actor if the actor satisfies them in the history
        satisfied = lambda: truth_of(case, A['H'], c, actor) is True
        p = c['pred']
        if p == 'related':
            a, _, b = read(c['a'], c['rel'], c['b'])
            if (a == actor or (b == actor and a == victim)) and linked(a, b):
                motive.append(sid)
        elif p == 'culpritRelated':
            a, _, b = read(actor, c['rel'], c['b'])
            if linked(a, b) and satisfied():
                motive.append(sid)
        elif p == 'crimeFact' and c['key'] == 'motive':
            motive.append(sid)
        elif p in ('had', 'hasTrait') and c['person'] == actor:
            means.append(sid)
        elif p in ('culpritHad', 'culpritTrait') and satisfied():
            means.append(sid)
    return {'motive': sorted(motive), 'means': sorted(means)}


def _describe(key):
    key = re.sub(r'^at:', 'the whereabouts of ', key)
    key = re.sub(r'^holder:', 'who had ', key)
    key = re.sub(r'^has:([^:]+):', r"\1's access to ", key)
    key = re.sub(r'^crime$', "the crime's minute and facts", key)
    return re.sub(r'^trait:', 'the trait ', re.sub(r'^rel:', 'the relation ', key))


# ----------------------------------------------------------------------------------------------------
# Certification: every check is code
# ----------------------------------------------------------------------------------------------------

def certify(case, require_pillars=True, require_backing=False):
    if case.get('claims_version') != CLAIMS_VERSION:
        return {'ok': False, 'errors': [f"claims version {case.get('claims_version', 1)}: migrate the case to version {CLAIMS_VERSION} (tools/refine-c/migrate.py)"]}
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
    rules = {r['id']: r for r in case.get('rules', [])}
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
        if s.get('kind') == 'rule':
            rule = rules.get(s.get('rule'))
            if not rule or rule.get('knowledge') != 'acquirable':
                errs.append(f"rule sign {s['id']}: rule must name an existing acquirable rule")
            if s.get('needs'):
                errs.append(f"rule sign {s['id']}: must have no 'needs'; use 'requires' to model access")
        for r in s.get('requires', []):
            if r not in signs:
                errs.append(f"sign {s['id']}: requires unknown sign {r}")
        for n in s.get('needs', []):
            if n not in signs and n not in rules:
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
        if s.get('claim') is not None and claim_of(s) is None:
            errs.append(f"sign {s['id']}: a claim's pred must be one of {_js(sorted(PREDICATES))}")
        elif claim_of(s):
            errs += claim_errors(case, s['id'], claim_of(s))
        if s.get('kind') == 'public' and (s.get('requires') or s.get('needs') or not claim_of(s)):
            errs.append(f"public sign {s['id']}: what everyone knows has a claim and no 'requires' or 'needs'")
        if s.get('kind') == 'testimony' and s.get('speaker') not in ppl:
            errs.append(f"sign {s['id']}: testimony needs a known speaker")
        for d in s.get('defeats', []):
            if (signs.get(d) or {}).get('kind') == 'public':
                errs.append(f"sign {s['id']} defeats {d}, but what everyone knows cannot be overturned")
    errs += record_errors(case)
    # spoken times must match the timeline; a trace lies where its source event happened
    times = set()
    for e in case['events']:
        times |= {e['start'] % 1440, e['end'] % 1440}
    for s_ in case['signs']:
        c_ = s_.get('claim') or {}
        for k_ in ('from', 'to'):
            if isinstance(c_.get(k_), (int, float)) and not isinstance(c_.get(k_), bool):
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
    # every claim is decided by the history; false ones are lies/mistakes (with the speaker's reason) or staging (a
    # deliberate source), defeated deeper
    for sid, tv in A['truthval'].items():
        if tv is None:
            errs.append(f"the history does not decide the claim of {sid} ({_js(claim_of(A['signs'][sid]))}): add the events that settle it, or change the claim")
        if tv is None or tv:
            continue
        s = A['signs'][sid]
        if s['kind'] == 'public':
            errs.append(f"public sign {sid} is false, but what everyone knows must be true")
            continue
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
    # consistency: claims the player can hold together that cannot all be true must include a defeat, so whatever the
    # player holds, what they trust is consistent (docs/claims.md section 5)
    # public knowledge is always held, so what it defeats is never trusted
    defeats = {x['id']: x.get('defeats', []) for x in case['signs']}
    overturned = {d for x in case['signs'] if x.get('kind') == 'public' for d in x.get('defeats', [])}
    readable = [(sid, claim_of(A['signs'][sid])) for sid in sorted(A['understood']) if claim_of(A['signs'][sid]) and sid not in overturned]
    for key, ids in instance_claims(case, readable).items():
        for subset in defeat_free_sets(ids, defeats):
            if not consistent(case, [x for x in readable if x[0] in subset], A['tt']):
                errs.append(f"{', '.join(subset)} cannot all be true ({_describe(key)}), but none of them defeats another: record which is false, and let the true one defeat it")
                break
    full = survivors(case, A)
    if full != [q['truth']]:
        errs.append(f"answer not unique from all reachable evidence: survivors {full}")
    if errs:
        return {'ok': False, 'errors': errs, 'A': A}
    maxd = max(A['eff'].values()) if A['eff'] else 0
    solve = next((d for d in range(maxd + 1) if survivors(case, A, d) == [q['truth']]), None)
    surface = survivors(case, A, 0)
    key = [sid for sid in A['understood'] if claim_of(A['signs'][sid]) and A['truthval'].get(sid) is True
           and A['signs'][sid].get('kind') != 'public' and survivors(case, A, None, closure_dependent(case, sid)) != [q['truth']]]
    innocent_actors = {actor_of(h) for h in q['candidates'] if h['id'] != q['truth']}
    herrings = [s['id'] for s in case['signs'] if s['kind'] == 'behavior' and s.get('about') in innocent_actors
                and any(e in A['understood'] and A['eff'][e] > A['eff'].get(s['id'], 0) for e in s.get('explainedBy', []))]
    threads = thread_depths(case, A)
    ta = actor_of(hyps[q['truth']])
    def ok_sign(sid):
        return sid in A['understood'] and A['truthval'].get(sid) is True and A['signs'][sid].get('kind') != 'public'
    read = relation_reader(case)
    motive = sorted(sid for sid, s_ in A['signs'].items() if ok_sign(sid) and claim_of(s_) and
                    ((claim_of(s_)['pred'] == 'related' and claim_of(s_).get('when') != 'never' and read(claim_of(s_)['a'], claim_of(s_)['rel'], claim_of(s_)['b'])[0] == ta) or
                     (claim_of(s_)['pred'] == 'crimeFact' and claim_of(s_)['key'] == 'motive' and not claim_of(s_).get('not'))))
    means = sorted(sid for sid, s_ in A['signs'].items() if ok_sign(sid) and claim_of(s_) and claim_of(s_)['pred'] in CULPRIT_PREDICATES and not claim_of(s_).get('not'))
    pil = pillar_signs(case, A)
    pd = {k: (min(A['eff'][x] for x in v) if v else None) for k, v in pil.items()}
    if require_pillars and not pil['motive']:
        errs.append("no reachable, true evidence of the culprit's MOTIVE (a related claim with a = the culprit, linked to the victim)")
    if require_pillars and not pil['means']:
        errs.append("no reachable, true evidence of the culprit's MEANS (a had or hasTrait claim about the culprit, or a culpritHad or culpritTrait claim the culprit satisfies)")
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
            'false_signs': sorted(k for k, v in A['truthval'].items() if v is False)}


def _js(v):
    return json.dumps(v, separators=(',', ':'), ensure_ascii=False)

# ----------------------------------------------------------------------------------------------------
# LLM
# ----------------------------------------------------------------------------------------------------

_client = None
USAGE = {'in': 0, 'out': 0, 'calls': 0}
_USAGE_LOCK = threading.Lock()


def _add_usage(usage):
    """Preserve the historical aggregate while making concurrent updates safe."""
    with _USAGE_LOCK:
        USAGE['in'] += usage.get('inputTokens', 0)
        USAGE['out'] += usage.get('outputTokens', 0)
        USAGE['calls'] += 1


_CLIENT_LOCK = threading.Lock()


def _ensure_client():
    """Create the shared Bedrock client once, even when the first calls come from several threads at once."""
    global _client
    if _client is None:
        with _CLIENT_LOCK:
            if _client is None:
                _client = boto3.client('bedrock-runtime', region_name=provenance.REGION,
                                       config=Config(connect_timeout=10, read_timeout=240, retries={'max_attempts': 1}, max_pool_connections=64))
    return _client


def llm(system, user, max_tokens=9000, model=None):
    """Legacy text call. Structured generation uses the fully audited path below."""
    r = _ensure_client().converse(modelId=model or MODEL,
                                  system=[{'text': system}, {'cachePoint': {'type': 'default'}}],
                                  messages=[{'role': 'user', 'content': [{'text': user}]}],
                                  inferenceConfig={'maxTokens': max_tokens})
    _add_usage(r.get('usage', {}))
    return ''.join(b.get('text', '') for b in r['output']['message']['content'])


HEDGE = os.environ.get('LM_HEDGE', '1') == '1'   # send a copy of a call that runs past its usual time; the first reply wins
_HEDGE_POOL = cf.ThreadPoolExecutor(max_workers=128, thread_name_prefix='converse')
HEDGES = threading.BoundedSemaphore(int(os.environ.get('LM_MAX_HEDGES', '16')))   # extra copies in flight at once: at most
_INTERNAL = ('llm_json', 'llm_json_audited', '_converse', 'run', '_phase', 'submit_with_context', '<lambda>',
             'in_parallel', 'work', 'check')


def _caller():
    """The function a model call is made for (for timings), past the call helpers and thread-pool frames; in a pool
    thread, where the caller's frames are gone, the innermost timing phase."""
    f = sys._getframe(2)
    while f and (f.f_code.co_name in _INTERNAL or 'concurrent' in f.f_code.co_filename or 'threading' in f.f_code.co_filename
                 or f.f_code.co_filename.endswith('provenance.py')):
        f = f.f_back
    return f.f_code.co_name if f else timing.current().split('/')[-1]


def _converse(kw, model, purpose):
    """One provider call, timed. A call still running past the usual time for its kind (timing.hedge_after) gets a
    second, identical copy, and the first reply wins: the slow tail of each phase is what most of a run waits for. The
    copy that loses is left to finish (a call cannot be stopped); its tokens are still counted."""
    started = time.time()
    after = timing.hedge_after(model, purpose) if HEDGE else None
    if after is None:
        try:
            r = _ensure_client().converse(**kw)
        except Exception as e:
            timing.record_call(model, purpose, time.time() - started, error=type(e).__name__)
            raise
        timing.record_call(model, purpose, time.time() - started, r.get('usage'))
        return r, {}
    client = _ensure_client()
    first = _HEDGE_POOL.submit(client.converse, **kw)
    done, _ = cf.wait([first], timeout=after)
    futures, hedged = [first], False
    if not done and HEDGES.acquire(blocking=False):   # when many calls are slow at once, the provider is: do not add load
        second = _HEDGE_POOL.submit(client.converse, **kw)
        second.add_done_callback(lambda _: HEDGES.release())
        futures.append(second); hedged = True
    error = None
    while futures:
        done, _ = cf.wait(futures, return_when=cf.FIRST_COMPLETED)
        for f in done:
            futures.remove(f)
            if f.exception() is None:
                for loser in futures:   # the other copy's tokens are spent either way
                    loser.add_done_callback(lambda g: g.exception() is None and _add_usage(g.result().get('usage', {})))
                r = f.result()
                timing.record_call(model, purpose, time.time() - started, r.get('usage'), hedged=hedged, hedge_won=hedged and f is not first)
                return r, ({'hedged': True, 'hedge_won': f is not first} if hedged else {})
            error = error or f.exception()
    timing.record_call(model, purpose, time.time() - started, hedged=hedged, error=type(error).__name__)
    raise error


TOKEN_FLOOR = 8000   # a model that thinks first returns nothing when a small budget is used up
FORCED_OK = {MODEL: False, CRITIC_MODEL: False}  # these inference profiles reject forced tool choice; use audited auto directly


@dataclass(frozen=True)
class LLMJSONResponse:
    """A structured model reply plus provider metadata available at the inference-profile boundary."""
    payload: object
    inference_profile: str
    request_ids: tuple[str, ...] = ()
    logical_request_id: str | None = None


class LLMJSONResponseError(ValueError):
    """A completed provider response whose structured payload could not be recovered."""
    def __init__(self, message, raw_response, inference_profile, request_ids=(), logical_request_id=None):
        super().__init__(message)
        self.raw_response = raw_response
        self.inference_profile = inference_profile
        self.request_ids = tuple(request_ids)
        self.logical_request_id = logical_request_id


def _request_id(response):
    metadata = response.get('ResponseMetadata') if isinstance(response, dict) else None
    request_id = metadata.get('RequestId') if isinstance(metadata, dict) else None
    return str(request_id) if request_id else None


def _exception_request_ids(error):
    if getattr(error, 'request_ids', None):
        return tuple(str(request_id) for request_id in error.request_ids)
    request_id = _request_id(getattr(error, 'response', None))
    return (request_id,) if request_id else ()


def _audit_metadata(metadata=None):
    if metadata:
        return metadata
    try:
        caller = sys._getframe(2).f_code.co_name
    except (AttributeError, ValueError):
        caller = 'unknown'
    return {'purpose': caller}


def _schedule_audit_request(system, user, max_tokens, model, schema, metadata=None):
    """Pre-register a request with the configuration it is sent with: the token floor, and the effort level."""
    audit = provenance.current_audit()
    if not audit:
        return None
    level = _effort_for(system, model or MODEL)
    return audit.schedule(system, user, schema, model or MODEL, max(max_tokens, TOKEN_FLOOR),
                          {**_audit_metadata(metadata), 'effort': level or 'default'})


_EFFORT = __import__('contextvars').ContextVar('effort', default=None)
# Judges (does this line contradict that, did this leak, would they have met) always think at the model's own effort,
# inside a low-effort wording phase too: writing is cheap to get roughly right, a judge that does not think passes what
# it should catch (the alias judge found nothing at low effort; the leak and cover-story judges missed). Registered by
# the modules that define them.
FULL_EFFORT = set()
# ... at medium effort on the wording model: on a dozen reactions it took 13 s and flagged one, at its default 58 s and
# none (October 25); low effort is what made judges pass what they should catch. The review model keeps its own.
JUDGE_EFFORT = {CRITIC_MODEL: os.environ.get('LM_JUDGE_EFFORT', 'medium')}


def _effort_for(system, model):
    """The effort a call is made at: a judge's own (JUDGE_EFFORT, else the model's default), else the phase's."""
    return JUDGE_EFFORT.get(model) if system in FULL_EFFORT else _EFFORT.get()
_NO_EFFORT = set()   # models that refused the effort setting


class effort:
    """`with effort('low'):` asks every structured call made inside (threads included, through provenance's context
    copies) to deliberate less: for short wording and judging calls, where thinking only adds minutes."""
    def __init__(self, level):
        self.level = level

    def __enter__(self):
        self.token = _EFFORT.set(self.level)

    def __exit__(self, *exc):
        _EFFORT.reset(self.token)


def llm_json_audited(system, user, max_tokens=9000, model=None, schema=None, _prior_request_ids=(),
                     _audit_request_id=None, audit_metadata=None):
    """Structured output with complete per-logical-request provider provenance."""
    audit = provenance.current_audit()
    m = model or MODEL
    purpose = (audit_metadata or {}).get('purpose') or _caller()
    inherited_request_id = provenance.semantic_context().get('_audit_request_id')
    logical_request_id = _audit_request_id or inherited_request_id or _schedule_audit_request(system, user, max_tokens, m, schema, audit_metadata)
    if audit and logical_request_id:
        audit.start(logical_request_id)
    tool = {'toolSpec': {'name': 'submit', 'description': 'Submit the requested JSON object.',
                         'inputSchema': {'json': schema or {'type': 'object', 'additionalProperties': True}}}}
    forced = FORCED_OK.get(m, True)
    request_ids = tuple(_prior_request_ids)
    # the cap is only a ceiling: a model that thinks first returns nothing when a small one is used up
    max_tokens = max(max_tokens, TOKEN_FLOOR)
    empty_retries = 0   # an empty reply (no tool call, no text; often out of room) is asked again with twice the room
    while True:
        kw = dict(modelId=m,
                  system=[{'text': system + ('' if forced else '\n\nAlways answer by calling the submit tool.')},
                          {'cachePoint': {'type': 'default'}}],
                  messages=[{'role': 'user', 'content': [{'text': user}]}],
                  inferenceConfig={'maxTokens': max_tokens},
                  toolConfig={'tools': [tool], 'toolChoice': {'tool': {'name': 'submit'}} if forced else {'auto': {}}})
        level = _effort_for(system, m)
        if level and m not in _NO_EFFORT:
            kw['additionalModelRequestFields'] = {'output_config': {'effort': level}}
        try:
            r, hedge = _converse(kw, m, purpose)
            if audit and logical_request_id:
                audit.provider_attempt(logical_request_id, response=r)
                if hedge:   # a second identical request was sent; the reply recorded is the one that came first
                    audit.annotate(logical_request_id, **hedge)
        except Exception as e:
            if 'additionalModelRequestFields' in kw and ('output_config' in str(e) or 'effort' in str(e)):
                _NO_EFFORT.add(m)
                continue
            if forced and 'tool_choice' in str(e):
                FORCED_OK[m] = False
                request_ids += _exception_request_ids(e)
                if audit and logical_request_id:
                    audit.provider_attempt(logical_request_id, error=e, semantic_repair='forced-tool-choice-to-auto')
                forced = False
                continue
            if audit and logical_request_id:
                audit.provider_attempt(logical_request_id, error=e)
                audit.error(logical_request_id, e)
            raise
        request_id = _request_id(r)
        request_ids += ((request_id,) if request_id else ())
        _add_usage(r.get('usage', {}))
        content = r['output']['message']['content']
        text = ''
        for block in content:
            if 'toolUse' in block:
                payload = block['toolUse']['input']
                if audit and logical_request_id:
                    audit.response(logical_request_id, r, content, payload,
                                   {'ok': True, 'mode': 'tool-use', 'object': isinstance(payload, dict)})
                return LLMJSONResponse(payload, m, request_ids, logical_request_id)
            text += block.get('text', '')
        if text.strip():
            try:
                payload = parse_json(text)
            except Exception as e:
                if audit and logical_request_id:
                    audit.response(logical_request_id, r, text, None,
                                   {'ok': False, 'mode': 'text-json', 'error': f'{type(e).__name__}: {e}'})
                raise LLMJSONResponseError(str(e), text, m, request_ids, logical_request_id) from e
            if audit and logical_request_id:
                audit.response(logical_request_id, r, text, payload,
                               {'ok': True, 'mode': 'text-json', 'object': isinstance(payload, dict)})
            return LLMJSONResponse(payload, m, request_ids, logical_request_id)
        if audit and logical_request_id:
            audit.response(logical_request_id, r, content, None,
                           {'ok': False, 'mode': 'empty', 'error': 'model did not call submit'})
        # Out of room: ask again with twice the room. Declined (a refusal or filter on mystery content): ask the story
        # model instead, once. Either way the attempt is recorded above.
        stop = r.get('stopReason')
        if stop == 'max_tokens' and empty_retries < 2:
            empty_retries += 1
            max_tokens = min(max_tokens * 2, 32000)
            continue
        if m != MODEL and empty_retries < 3:
            empty_retries = 3
            m = MODEL
            forced = FORCED_OK.get(m, True)
            continue
        raise LLMJSONResponseError(f'model did not call submit (stop reason {stop})', content, m, request_ids, logical_request_id)


def schedule_llm_json_audited(executor, system, user, max_tokens=9000, model=None, schema=None, audit_metadata=None):
    """Pre-register a logical request, then schedule it with the active audit context."""
    logical_request_id = _schedule_audit_request(system, user, max_tokens, model or MODEL, schema, audit_metadata)
    with provenance.semantics(_audit_request_id=logical_request_id):
        future = provenance.submit_with_context(executor, llm_json_audited, system, user, max_tokens, model, schema,
                                                audit_metadata=audit_metadata)
    return future, logical_request_id


def cancel_audited_future(future, logical_request_id):
    audit = provenance.current_audit()
    if not audit or not logical_request_id:
        return future.cancel()
    if future.cancel():
        audit.cancelled_before_start(logical_request_id)
        return True
    if not future.done():
        audit.cancel_requested(logical_request_id)
    return False


def schedule_llm_json(executor, system, user, max_tokens=9000, model=None, schema=None, audit_metadata=None):
    """Pre-register a payload-only compatibility call before scheduling it."""
    logical_request_id = _schedule_audit_request(system, user, max_tokens, model or MODEL, schema, audit_metadata)
    with provenance.semantics(_audit_request_id=logical_request_id):
        future = provenance.submit_with_context(executor, llm_json, system, user, max_tokens, model, schema,
                                                audit_metadata=audit_metadata)
    return future, logical_request_id


def llm_json(system, user, max_tokens=9000, model=None, schema=None, audit_metadata=None, _audit_request_id=None):
    """Payload-only compatibility wrapper; provenance remains active for all structured callers."""
    return llm_json_audited(system, user, max_tokens, model, schema, _audit_request_id=_audit_request_id,
                            audit_metadata=audit_metadata).payload


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
 "people": [{"id","name","role","traits":{"<trait>":"<value>"}}],   // traits when the night began (handed, foot size ...)
 "objects": [{"id","name","desc","supply":true?}],                   // every item a claim or holding names; supply: a stock
                                                                     // many may have (vestry paper, the surgery's morphine)
 "vocabulary": {"relations":[{"rel","inverse"?}]},                   // every relation name used; inverse: its converse name
 "relations": [{"a","rel","b"}],                                     // true when the night began: owes, blackmailing, heir_of
 "holdings": [{"person","item"}],                                    // who had what when the night began
 "question": {"text","candidates":[{"id","label","facts":{"actor":"<person id>","method":"...","motive":"..."}}],
              "truth":"<candidate id>","crime":{"event":"<event id>","place":"<place id>","window":[start,end]}},
 "attitudes": [{"id","agent","mode":"believes|knows|wants|fears|intends|feels","content","because":[attitude ids]}],
 "events": [{"id","type","agent","others":[person ids],"place","start","end","causedBy":"<attitude id of the agent>"|"nature","summary",
             "effects":[{"take":item} | {"give":item,"to":person} | {"lose":item} | {"relate":rel,"to":person} | {"trait":trait,"value":v}],
             "facts":{...}}],                                        // the crime event's facts: the true candidate's (method, motive)
 "signs": [{
   "id","kind":"trace|testimony|document|record|behavior|item|rule|observation|absence|public",
   "title","text",                          // what the player sees; neutral, never announces its own meaning
   "at":"<place id>",
   "requires":[sign ids],                   // ACCESS: signs/items/favours the player must already have to find this
   "unlock":"...",                          // REQUIRED with requires: the in-world reason (the key opens it; she trusts you once you show X)
   "needs":[sign ids or rule ids],          // READING: what is needed to understand it (a second clue, a rule)
   "reading":"...",                         // REQUIRED with needs: how the other clue or rule makes sense of this one
   "claim": {"pred": ..., ...},             // the ONE proposition it carries (omit for none); see CLAIMS below
   "speaker":"<person id>","because":[attitude ids],   // testimony only; 'because' explains why a false testimony is false
   "ask":"...",                             // testimony only: the natural question the detective asks to hear it (no answer in it)
   "source":"<event id>",                   // the event that produced it (required for staged or planted physical signs)
   "defeats":[sign ids],                    // this sign overturns those (a lie, a staged scene)
   "about":"<person id>","explainedBy":[sign ids],  // behavior: whom it concerns, and the deeper signs that explain it
   "watch":true   // ONLY on a behavior that is the person's live manner the detective sees by watching them (a look, a
                  // gesture, a thing on them). Its text is that manner, NEVER naming a place: it is watched wherever
                  // they are now, and they may have moved. Omit 'watch' for a reaction about someone, or an object left
                  // behind (a trunk, a letter under the till): those have a fixed place and keep it in their text.
 }]
}
CLAIMS (from, to: minutes, both included; when: throughout (default) | sometime | never; not: true negates):
  {"pred":"wasAt","person","place","from","to","when"?}     // whereabouts (an alibi when it keeps them from the scene)
  {"pred":"nobodyAt","place","from","to"}                    // no one was there
  {"pred":"had","person","item","from"?,"to"?,"when"?}        // a named person had an item
  {"pred":"onlyHad","item","people":[...],"from"?,"to"?}      // no one else had it (e.g. only two keys exist)
  {"pred":"related","a","rel","b","when"?}                   // a named person stands in a relation (a motive)
  {"pred":"hasTrait","person","trait","value","from"?,"to"?,"when"?}   // a named person's trait
  {"pred":"crimeBetween","from","to"}                        // the crime happened in this span
  {"pred":"crimeFact","key","value","not"?}                  // a fact of the crime: method, motive, ...
  {"pred":"culpritHad","item","not"?,"from"?,"to"?}           // whoever did it had the item (at the crime, or in the span)
  {"pred":"culpritRelated","rel","b","not"?}                 // whoever did it stands in the relation
  {"pred":"culpritTrait","trait","value","not"?}             // whoever did it has the trait
The kernel CODE computes what follows, from what the PLAYER KNOWS: the claims of the clues they hold and trust, and the
public signs (kind "public": what everyone in the village knows, held from the start; no requires or needs). A culprit
claim rules a candidate out only when other claims the player has say the candidate lacks it: "whoever did it had vestry
paper" clears no one until a sign says who had vestry paper (e.g. a public sign {"pred":"onlyHad",...}; the game shows such
a public sign only once the player understands a clue about that item, so it must decide nothing on its own). A whereabouts
claim is an alibi when, with the walking times, the person could not have been at the scene at any minute the claims
allow for the crime. Truth is computed from the events: a person is where their events put them, stays put between
events at the same place, and may be anywhere they can reach between events at different places; a claim over minutes
the events leave open is UNDECIDED and refused, so add the events that settle it. Holdings, relations and traits change
only through event effects. A claim is FALSE if it contradicts the history; false signs must be lies/mistakes (testimony,
with 'because') or staged (a deliberate source event), and must be defeated by a deeper true sign. Claims the player
could hold together that cannot all be true must include a defeat (the true one defeats the false one)."""

PRINCIPLES = """You are the story engine of a mystery generator. Code controls where the case gets harder and checks every step;
you decide how and why, as a novelist would. Rules you must follow:
- Every complication has a cause: someone did something for a reason (an event caused by an attitude), or nature did.
- Signs are neutral: their text never names the culprit or announces what they prove.
- Never declare what a sign eliminates; write a claim with the fixed predicates and let the code compute its consequences.
- Every person a sign names or implicates (holds a key, was seen, owns an item) must be explained somewhere in the case
  (an attitude, event, holding or another sign); never leave an innocent looking guilty for a reason the case never resolves.
- An 'unlock' must be a real in-world reason the detective would go and look: the prerequisite must point to the new
  sign's place or person (a name, a key, a mention), not merely precede it.
- Keep times, places and travel physically consistent. People are at events you add; add events for new whereabouts.
- The constable is the detective's ally: never a candidate, never the speaker of a false account, never the one who
  hides, moves, stages or tampers with evidence, and never the one who holds anything back. What he knows or keeps is
  given when first asked: no 'requires' on his accounts, and none on signs that come from his own events. When evidence
  must be earned, someone else keeps it, for a reason of their own.
- An item someone took away (the doctor emptying the dead man's pockets) lies where that person keeps it, not where it
  was taken; the doctor's findings on the body come with her account of the examination.
- A red herring's innocent secret is an attitude of the person it concerns (what they fear, want or believe), and the
  event behind the behaviour (or behind what explains it) is caused by that attitude, so they can say why when pressed.
- Respond with ONE JSON object only."""

CHECKLIST = """BEFORE ANSWERING, CHECK YOUR PATCH AGAINST WHAT THE REVIEWER WILL REJECT:
- Every 'unlock' follows in the world: obtaining the prerequisite would really lead to finding, or being given, this sign.
- Characters act from their attitudes. Someone who wants a thing hidden needs a stated reason to reveal it; a careful
  culprit does not keep damning evidence without a reason.
- The constable neither lies nor holds anything back: none of his accounts, and nothing from his own doing, has 'requires'.
- A keeper's reason covers only what it is about. When you make a sign harder to reach, check every sign that requires
  it: its unlock must still make sense behind the new gate. Never hold the doctor's findings on the body, her notes on
  it or the dead man's effects behind her confidence to a living patient or any other account of hers.
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
     the true culprit out on the surface (e.g. a false alibi: a wasAt claim putting them elsewhere for the whole window).
  2. ITS DEFEATER one step deeper: a TRUE sign with 'requires' one item or sign the player can get, listing the
     deception in 'defeats'.
  3. A MOTIVE sign (claim {"pred":"related","a":<culprit>,"rel":...,"b":<the victim>} with the matching 'relations' entry)
     and a MEANS sign (a culpritHad or culpritTrait claim the culprit satisfies, with the matching holding or trait, and
     public signs that say who else had it or what the others' traits are, so that it rules out the other candidates),
     each on the surface or one step deep.
  4. A RED HERRING: a surface 'behavior' sign about an innocent candidate (no claim), caused by an innocent secret (an
     attitude of theirs that causes the behaviour's source event), with a deeper sign that explains it in 'explainedBy'. If it is the person's own manner (a look, a gesture, something on
     them), set "watch":true and name no place in its text (it is watched wherever they are); if it is an object they
     left, omit 'watch' and it keeps its place.
  5. Alibi signs (wasAt claims) that, together with the above, leave exactly the truth once everything is found.
  6. A public sign giving the crime window ({"pred":"crimeBetween"}): when it happened is known to everyone.
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


def step_prompt(case, report, target, mode, preferred, feedback=None, previous=None):
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
                f"{' and '.join(need)}. MOTIVE = a TRUE sign whose claim is a relation connecting the culprit and the VICTIM "
                f"{{\"pred\":\"related\",\"a\":\"{target}\",\"rel\":\"...\",\"b\":\"...\"}} (add the matching entry to 'relations' and the name to 'vocabulary'). "
                "MEANS = a TRUE culprit claim the culprit satisfies: {\"pred\":\"culpritHad\",\"item\"} (add the 'holdings' entry or the effect that gives it) "
                "or {\"pred\":\"culpritTrait\",\"trait\",\"value\"}; it rules out others only with claims saying who else had the item or what their "
                "traits are (public signs, or clues). Other candidates may have motives too, but not the means. "
                "Do not put it on the surface: hide it (Conceal) or make it need another clue (Fragment), justified by someone's reason.")
    elif mode == 'herring':
        task = (f"RED HERRING STEP. Give innocent candidate '{target}' a suspicious visible behaviour (kind 'behavior', about "
                f"'{target}', on the surface, with 'source' an event of theirs caused by an innocent secret: an attitude of "
                f"'{target}'s), and a deeper sign that explains it innocently (list it in 'explainedBy'). The behaviour sign carries no claim. If it is "
                f"'{target}'s own manner (a look, a gesture, something on them), set \"watch\":true and name no place in its "
                "text (it is watched wherever they are); if it is an object they left behind, omit 'watch' and keep its place.")
    elif mode == 'pillar':
        pil = report.get('pillar_signs') or {}
        key = 'means' if target in (pil.get('means') or []) else 'motive'
        task = (f"DEEPEN THE {key.upper()} STEP. The culprit's {key} is shown too early (at depth {(report.get('pillars') or {}).get(key)}, "
                f"while the answer is only settled at depth {report['solve_depth']}) by these signs: {pil.get(key)}. Make ALL of them "
                "harder to reach: CONCEAL them behind something the player must first obtain, with a real in-world reason, "
                "or FRAGMENT them so they need another clue to be understood. Keep them TRUE and reachable.")
    elif mode == 'clear':
        who = actor_of(hyp_map(case)[target])
        task = (f"CLEAR STEP. Innocent candidate '{target}' ({who}) is ruled out only because the evidence against the true "
                f"culprit is found: without the means and motive evidence nothing clears them. Give them evidence of their own "
                f"that rules them out by itself: a TRUE sign whose claim the kernel can check - e.g. {{\"pred\":\"wasAt\",\"person\":\"{who}\",...}} "
                "placing them elsewhere during the crime window, from a witness who was with them or saw them, a record, or "
                "a physical trace - with the events that make it true (who was there, and why). It must not make their thread "
                f"shallower (now settled at depth {(report.get('threads') or {}).get(target)}): put it behind something the "
                "player must first obtain (Conceal), or make it need another clue to be read (Fragment), with a reason "
                f"of the keeper's own. Preferred operator this step: {preferred}.")
    elif mode == 'repair':
        task = ("REPAIR STEP. The case is deep enough; an independent whole-case reviewer found these problems. Fix every one "
                "with the smallest change that does it (rewording a text, moving a sign, giving a person a stated reason, or "
                "changing a gate to one whose reason really covers the sign), keeping every sign's depth, the twist, the "
                "motive and the means as they are:\n- " + '\n- '.join(target))
    else:
        settle = settling_signs(case, report, target)
        limits = lock_limits(case)
        fixed = {s: limits[s] for s in settle['signs'] if s in limits}
        note = ('' if not fixed else " Some of these may not be locked: " + '; '.join(f"'{s}': {why}" for s, why in fixed.items())
                + ". Deepen them by making them need another clue (Fragment), or deepen the thread through its other signs, or "
                "carry the same fact on a new sign someone keeps for a reason of their own and remove the target.")
        task = (f"REFINE sign '{target}' (the player currently gets it too easily). The thread it belongs to is currently settled "
                f"at depth {settle['depth']} by these signs: {settle['signs']}.{note} To make progress ALL of them must end up deeper "
                "(you may hide or fragment several in one patch, or give them a shared deeper prerequisite). First answer the story question: who in "
                "this world would have a reason to make this sign harder to see, and why? The reason must be that keeper's own "
                "and must be about this sign: do not reuse a gate that exists for something else. Then apply one operator: "
                "CONCEAL (put it behind something the player must first obtain: an item, a favour, trust, a search - add those "
                "as new signs and list them in its 'requires'), FRAGMENT (make it need a second sign or a rule to be understood - "
                "add it to 'needs'; or split it), or MISLEAD (add a deception on the surface, defeated deeper). "
                f"Preferred operator this step: {preferred}. The case already has sign kinds {kinds}; prefer a kind it has little of "
                "(physical traces, behaviour, overheard talk, absences) over yet another record or document.")
    fb = f"\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED BY THE CHECKER. Fix exactly these problems:\n- " + "\n- ".join(feedback) if feedback else ''
    if previous is not None:
        fb += ("\n\nTHAT PATCH (revise it: keep what was right, change only what those problems need, and return the "
               "complete revised patch):\n" + json.dumps(previous, separators=(',', ':'))[:40000])
    return f"""CURRENT CASE:
{json.dumps(case, separators=(',', ':'))}

{case_rules(case)}

KERNEL ANALYSIS (computed by code): {json.dumps(state)}

TASK: {task}

Return a PATCH as one JSON object:
{{"story":"one or two sentences: who acts, why, and what it leaves behind",
  "operator":"Conceal|Fragment|Mislead","blocks":["..."],
  "add":{{"people":[],"objects":[],"vocabulary":{{"relations":[]}},"relations":[],"holdings":[],"rules":[],"attitudes":[],"events":[],"signs":[]}},
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
  detective to the new sign (e.g. an account at the inn opening a letter at the manor with no reason to go and look);
  or the reason someone withholds a sign does not cover THAT sign. A keeper's reason covers only what it is about: a
  doctor's duty of confidence to a living patient covers that patient's treatment, never the dead man's effects or her
  notes on his body; a promise to one person covers that person's secret, nothing else. Judge every touched sign's
  unlock against what its prerequisite now is (a sign whose prerequisite this step changed is touched too)
- BOTTLENECK: one narrow reason (a confidence, a promise, a locked drawer) now holds back several unrelated kinds of
  evidence at once, so the case's depth comes from one arbitrary door rather than from the story
- READING: a 'reading' reason does not actually make sense of the clue
- CHARACTER: a character acts against their established attitudes or knowledge, or with no believable reason
- LOOSE END: a sign names or implicates a person (holds a key, was seen, owns an item) and nothing in the case explains
  it, so an innocent looks guilty for a reason the case never resolves
- GIVEAWAY: a sign's text names the culprit or announces what it proves, instead of being a neutral observation
- CONTRADICTION: the step contradicts something already established in the case
- ALLY: the constable lies, hides, moves or tampers with evidence, or withholds what he knows or keeps until the detective
  earns it (he is the detective's ally; give the deception or the keeping to someone with a reason)
Be strict but fair; small stylistic issues are not failures. Every "fail" MUST list at least one issue that names the
sign id, the check (LOCK, READING, CHARACTER, LOOSE END, GIVEAWAY, CONTRADICTION, ALLY, BOTTLENECK) and what to change.
Reply with ONE JSON object: {"verdict":"pass"|"fail","issues":["<sign id>: <CHECK>: specific, actionable problem", ...]}"""

CRITIC_SCHEMA = {'type': 'object', 'properties': {'verdict': {'type': 'string', 'enum': ['pass', 'fail']},
                                                  'issues': {'type': 'array', 'items': {'type': 'string'}}},
                 'required': ['verdict', 'issues']}
CRITIC_UNAVAILABLE_REASON = 'plausibility review: unavailable'
REVIEW_REPAIRS = int(os.environ.get('LM_REVIEW_REPAIRS', '2'))   # repair steps after a failed whole-case review
CRITIC_CHECKS = ('LOCK', 'READING', 'CHARACTER', 'LOOSE END', 'GIVEAWAY', 'CONTRADICTION', 'ALLY', 'BOTTLENECK')


class CriticStatus(str, Enum):
    PASS = 'PASS'
    FAIL = 'FAIL'
    UNAVAILABLE = 'UNAVAILABLE'


@dataclass(frozen=True)
class CriticAttempt:
    raw_response: object
    request_ids: tuple[str, ...] = ()
    error: str | None = None

    def history(self):
        row = {'raw_response': self.raw_response, 'request_ids': list(self.request_ids)}
        if self.error:
            row['error'] = self.error
        return row


@dataclass(frozen=True)
class CriticOutcome:
    status: CriticStatus
    issues: tuple[str, ...]
    raw_response: object
    attempts: tuple[CriticAttempt, ...]
    request_ids: tuple[str, ...] = ()
    inference_profile: str = CRITIC_MODEL

    def history(self, candidate_id=None):
        """Persist enough evidence to distinguish a substantive verdict from reviewer unavailability."""
        row = {'status': self.status.value, 'pass': self.status is CriticStatus.PASS,
               'issues': list(self.issues), 'raw': self.raw_response, 'raw_response': self.raw_response,
               'attempts': [a.history() for a in self.attempts], 'request_ids': list(self.request_ids),
               'inference_profile': self.inference_profile, 'model': self.inference_profile}
        if candidate_id is not None:
            row['candidate_id'] = candidate_id
        return row


def compact_sign(x):
    keep = ('id', 'kind', 'title', 'at', 'speaker', 'about', 'text', 'requires', 'unlock', 'needs', 'reading', 'claim', 'defeats', 'explainedBy', 'source')
    return {k: x[k] for k in keep if x.get(k) not in (None, [], '')}


def _critic_shape(raw):
    """Return a terminal typed verdict, or None only for a schema-valid fail without a usable reason."""
    if not isinstance(raw, dict):
        return CriticStatus.UNAVAILABLE, ()
    verdict, supplied = raw.get('verdict'), raw.get('issues')
    if verdict not in ('pass', 'fail') or not isinstance(supplied, list) or any(not isinstance(i, str) for i in supplied):
        return CriticStatus.UNAVAILABLE, ()
    if verdict == 'pass':
        return (CriticStatus.PASS, ()) if not supplied else (CriticStatus.UNAVAILABLE, ())
    issue_pattern = re.compile(r'^\S[^:]*:\s*(?:' + '|'.join(re.escape(check) for check in CRITIC_CHECKS) + r'):\s*\S', re.I)
    issues = tuple(i.strip() for i in supplied if i.strip() and issue_pattern.match(i.strip()))[:6]
    return (CriticStatus.FAIL, issues) if issues else None


def critic(case, patch):
    ids = {x['id'] for x in (patch.get('add') or {}).get('signs', [])} | set(((patch.get('modify') or {}).get('signs') or {}).keys())
    # A sign behind a touched one now waits behind whatever that one waits behind: its unlock is judged again.
    ids |= {x['id'] for x in case['signs'] if set(x.get('requires') or []) & ids}
    ctx = {'setting': case['setting'].get('summary'), 'question': case['question'].get('text'),
           'truth': hyp_map(case)[case['question']['truth']].get('label'),
           'people': [{k: p.get(k) for k in ('id', 'name', 'role', 'traits')} for p in case['people']],
           'relations': case.get('relations', []), 'holdings': case.get('holdings', []),
           'attitudes': case['attitudes'], 'events': case['events'],
           'signs_touched': [compact_sign(x) for x in case['signs'] if x['id'] in ids],
           'other_signs': [compact_sign(x) for x in case['signs'] if x['id'] not in ids]}
    prompt = f"STORY OF THIS STEP: {patch.get('story')}\n\nCASE:\n{json.dumps(ctx, separators=(',', ':'))}"
    attempts = []
    for semantic_attempt in range(2):
        try:
            response = llm_json_audited(CRITIC, prompt, 8000, model=REVIEW_MODEL, schema=CRITIC_SCHEMA,
                                        audit_metadata={'purpose': 'typed-model-critic',
                                                        'semantic_retry': semantic_attempt})
        except Exception as e:
            error = f'{type(e).__name__}: {e}'
            raw_response = getattr(e, 'raw_response', {'error': error})
            attempts.append(CriticAttempt(raw_response, _exception_request_ids(e), error))
            request_ids = tuple(rid for item in attempts for rid in item.request_ids)
            inference_profile = getattr(e, 'inference_profile', CRITIC_MODEL)
            audit = provenance.current_audit()
            if audit and getattr(e, 'logical_request_id', None):
                audit.annotate(e.logical_request_id, typed_critic_outcome='UNAVAILABLE')
            return CriticOutcome(CriticStatus.UNAVAILABLE, (), raw_response, tuple(attempts), request_ids,
                                 inference_profile)
        attempt = CriticAttempt(response.payload, response.request_ids)
        attempts.append(attempt)
        shaped = _critic_shape(response.payload)
        if shaped is None:       # a reasonless fail gets one semantic retry so a redraft can receive useful feedback
            audit = provenance.current_audit()
            if audit and response.logical_request_id:
                audit.annotate(response.logical_request_id, typed_critic_outcome='UNAVAILABLE_REASONLESS_RETRY')
            continue
        status, issues = shaped
        audit = provenance.current_audit()
        if audit and response.logical_request_id:
            audit.annotate(response.logical_request_id, typed_critic_outcome=status.value,
                           critic_issues=list(issues))
        request_ids = tuple(rid for item in attempts for rid in item.request_ids)
        return CriticOutcome(status, issues, response.payload, tuple(attempts), request_ids, response.inference_profile)
    audit = provenance.current_audit()
    if audit and response.logical_request_id:
        audit.annotate(response.logical_request_id, typed_critic_outcome='UNAVAILABLE')
    request_ids = tuple(rid for item in attempts for rid in item.request_ids)
    return CriticOutcome(CriticStatus.UNAVAILABLE, (), attempts[-1].raw_response, tuple(attempts), request_ids,
                         response.inference_profile)

def critic_feedback(outcome):
    """Only a substantive PASS accepts a candidate; every other status gives deterministic redraft feedback."""
    if outcome.status is CriticStatus.PASS:
        return True, []
    if outcome.status is CriticStatus.FAIL:
        return False, ['plausibility review: ' + issue for issue in outcome.issues]
    return False, [CRITIC_UNAVAILABLE_REASON]


def final_case_review_status(history):
    """Explicitly report the current review boundary; layer reviews are not a final whole-case review certificate."""
    rows = [row for step in history for row in (step.get('critic') or [])]
    return {'status': 'NOT_REVIEWED', 'final_whole_case_reviewed': False,
            'layer_candidate_reviews': len(rows),
            'layer_candidate_passes': sum(row.get('status') == CriticStatus.PASS.value for row in rows)}


def normalise(case):
    """Every draft is a claims-version-2 case, every relation name it uses is in its vocabulary (an inverse it does not
    declare is simply another relation), and it holds as public signs what the game shows everyone."""
    if not isinstance(case, dict):
        return case
    case['claims_version'] = CLAIMS_VERSION
    vocab = case.setdefault('vocabulary', {}).setdefault('relations', [])
    known = {n for r in vocab for n in (r.get('rel'), r.get('inverse')) if n}
    used = [r.get('rel') for r in case.get('relations') or []] + [f.get('relate') for e in case.get('events') or [] for f in e.get('effects') or []] \
        + [(x.get('claim') or {}).get('rel') for x in case.get('signs') or [] if isinstance(x.get('claim'), dict)]
    vocab += [{'rel': r} for r in dict.fromkeys(u for u in used if isinstance(u, str) and u and u not in known)]
    if isinstance(case.get('signs'), list) and isinstance(case.get('people'), list) and (case.get('question') or {}).get('crime'):
        public_knowledge(case)    # what the game shows everyone: the crime window, the traits clues test
    return case


def lock_setting(case):
    """Fixed setting by construction: places and links are the setting's; cast identity fields are the setting's."""
    case = normalise(case)
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
    import roles
    unb = unbacked_accounts(case)
    return P.morning_errors(case) + P.evening_errors(case) + roles.ally_errors(case) + roles.examiner_errors(case) + roles.herring_errors(case) + ([f"accounts not backed by the true history (an event the speaker took part in or saw, or a 'knows' "
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
    for k in ('people', 'objects', 'relations', 'holdings', 'rules', 'attitudes', 'events', 'signs'):
        c.setdefault(k, [])
        c[k].extend(add.get(k) or [])
    for r in (add.get('vocabulary') or {}).get('relations') or []:
        c.setdefault('vocabulary', {}).setdefault('relations', []).append(r)
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
    return normalise(c)

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
    # innocents cleared on evidence of their own (not only by the culprit's conviction): give one that has none its own
    own = profile.get('own', 0)
    if step >= 3 and own:
        alone = cleared_alone(case, report)
        threads = report.get('threads') or {}
        todo = [t for t in sorted(threads, key=lambda t: -(threads[t] or 0)) if t != 'truth' and t not in alone and threads[t] is not None]
        tried = [h['target'] for h in hist if h['mode'] == 'clear']
        todo = [t for t in todo if tried.count(t) < 2]
        if len(alone) < own and todo and [h['mode'] for h in hist[-2:]].count('clear') < 2:
            return 'clear', todo[0], 'Fragment', todo[0], threads[todo[0]]
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
    options = refine_options(case, report, hist, D, preferred)
    if options:
        return ('refine',) + options[0]
    return None, None, None, None, None


def refine_options(case, report, hist, D, preferred):
    """Refinement options, best first and spread across threads: each thread's critical signs (removing them would make
    that thread harder), the shallowest thread first, a sign that may only be fragmented after one that may be locked.
    Thread targeting: the case is solved when every innocent is ruled out and the truth survives."""
    A = report['A']
    per_thread = []
    targeted = [h['target'] for h in hist if h.get('accepted')]
    recent = targeted[-2:] + [h['target'] for h in hist[-2:] if not h.get('accepted')]
    threads = {t: d for t, d in (report.get('threads') or {}).items() if d is not None and d < D}
    for thread, tdepth in sorted(threads.items(), key=lambda kv: (kv[1], kv[0])):
        crit = [c for c in critical_signs(case, A, thread, tdepth) if A['truthval'].get(c) is not False]
        if not crit:  # redundant evidence: take any shallow sign that bears on this thread
            crit = [sid for sid in A['understood'] if A['eff'][sid] <= tdepth and claim_of(A['signs'][sid]) and A['truthval'].get(sid)]
        crit = [c for c in crit if c not in recent and targeted.count(c) < 3]
        # never aim at what everyone knows (it can only stay); a sign that may not be locked can still be fragmented
        limits = lock_limits(case)
        crit = [c for c in crit if A['signs'][c]['kind'] != 'public']
        crit.sort(key=lambda c: (c in limits, A['eff'][c], targeted.count(c), c))
        per_thread.append([(c, 'Fragment' if c in limits else preferred, thread, tdepth) for c in crit])
    # interleave: the best option of each thread, then the second of each, so parallel drafts try different threads
    out, seen = [], set()
    for rank in range(max((len(x) for x in per_thread), default=0)):
        for options in per_thread:
            if rank < len(options) and options[rank][0] not in seen:
                seen.add(options[rank][0]); out.append(options[rank])
    return out


def schedule_options(case, report, step, hist, D, profile=None, k=None):
    """The step's options for parallel drafts: the scheduled one first, then other refinement targets (other threads
    first) or, for a structural step (twist, implicate, herring, pillar), the same task under other operators."""
    k = k or CANDIDATES
    first = schedule(case, report, step, hist, D, profile)
    if not first[1]:
        return []
    options = [first]
    if first[0] == 'refine':
        for o in refine_options(case, report, hist, D, first[2]):
            if len(options) >= k:
                break
            if all(o[0] != x[1] for x in options):
                options.append(('refine',) + o)
    elif first[0] == 'clear':
        # the other innocents without evidence of their own, then other operators for the first
        alone, threads = cleared_alone(case, report), report.get('threads') or {}
        for t in sorted(threads, key=lambda t: -(threads[t] or 0)):
            if len(options) < k and t not in ('truth', first[1]) and t not in alone and threads[t] is not None:
                options.append(('clear', t, 'Fragment', t, threads[t]))
        for op in ('Conceal', 'Mislead'):
            if len(options) < k:
                options.append(('clear', first[1], op, first[3], first[4]))
    else:
        for op in ('Conceal', 'Fragment', 'Mislead'):
            if len(options) >= k:
                break
            if op != first[2]:
                options.append((first[0], first[1], op, first[3], first[4]))
    return options

def lock_limits(case):
    """{sign id: why it may not wait behind 'requires'} for signs the rules forbid locking: what everyone knows, the
    constable's accounts and what comes from his own doing (roles.ally_errors), and the doctor's examination account
    (her findings are given when she is asked about it; roles.examiner_errors)."""
    import roles
    con, ex = roles.role_of(case, 'constable'), roles.role_of(case, 'examiner')
    ex_suspect = any((h.get('facts') or {}).get('actor') == ex for h in case['question']['candidates'])
    morning = ((case.get('setting') or {}).get('day') or {}).get('morning', 1740)
    events = {e['id']: e for e in case['events']}
    out = {}
    for x in case['signs']:
        src = events.get(x.get('source')) or {}
        if x['kind'] == 'public':
            out[x['id']] = 'what everyone knows: it can never be hidden or need another clue'
        elif con and (x.get('speaker') == con or (src.get('agent') == con and x['kind'] != 'testimony')):
            out[x['id']] = 'the constable holds nothing back: it may need another clue to be read (Fragment), never wait behind one'
        elif ex and not ex_suspect and x['kind'] == 'testimony' and x.get('speaker') == ex and src.get('agent') == ex and src.get('start', 0) >= morning:
            out[x['id']] = "the doctor's account of her examination is given when asked: it may need another clue to be read, never wait behind one"
    return out


def case_rules(case):
    """The rules code will check every patch against, stated for this case before the model drafts."""
    import roles
    con, ex = roles.role_of(case, 'constable'), roles.role_of(case, 'examiner')
    return '\n'.join([
        "CASE RULES (code checks every patch against these; a patch that breaks one is rejected):",
        f"- The constable ('{con}') is the detective's ally: no false account of his, no 'requires' on his accounts or on signs "
        "from his own events, never a candidate, never staging or hiding evidence.",
        f"- The doctor ('{ex}') gives her findings on the body, her notes on it and the dead man's effects when asked about "
        "the examination: never behind a patient's confidence or any other account of hers.",
        "- Public signs (what everyone knows) carry no 'requires' and no 'needs'.",
        "- A keeper's reason covers only what it is about; never reuse one gate for unrelated evidence.",
        "- Every testimony is backed: its speaker took part in or saw its 'source' event, or a 'knows' attitude of theirs is cited "
        "in 'because'. A rule sign names an existing acquirable rule id.",
        "- Every claim must be decided by the events (add the events that place people where a claim says).",
        "- Anyone you newly involve gets an ordinary evening at home automatically if they have none; give them one yourself "
        "if they were somewhere else.",
    ])


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
                           and (actor in (claim_of(A['signs'][sid]).get('person'), claim_of(A['signs'][sid]).get('a'))
                                or claim_of(A['signs'][sid])['pred'] in ('culpritHad', 'culpritRelated', 'culpritTrait', 'crimeFact', 'crimeBetween', 'onlyHad', 'nobodyAt'))]
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
    before_threads, after_threads = report.get('threads') or {}, rep.get('threads') or {}
    # an innocent's thread never gets shallower (the truth's may: positive evidence is meant to be found)
    shallower = [t for t, d in before_threads.items() if t != 'truth' and d is not None and (after_threads.get(t) is None or after_threads[t] < d)]
    if shallower:
        law.append(f"a thread got shallower ({', '.join(f'{t} {before_threads[t]}->{after_threads.get(t)}' for t in shallower)}): keep every thread at least as deep")
    if mode != 'repair' and not (add.get('events') or add.get('attitudes') or (patch.get('modify') or {}).get('events')):
        law.append('no story beat: every refinement must add the event or attitude that causes it (who did what, and why)')
    if mode == 'implicate' and len([x for x in (rep.get('motive'), rep.get('means')) if x]) <= \
            len([x for x in (report.get('motive'), report.get('means')) if x]):
        law.append('no new positive evidence: add a TRUE motive (a related claim with a = the culprit) or means '
                   '(a culpritHad or culpritTrait claim the culprit satisfies) sign that is reachable and readable')
    if mode == 'clear' and target not in cleared_alone(new, rep):
        law.append(f"'{target}' is still ruled out only by the evidence against the culprit: add a TRUE sign of their own "
                   "(an alibi or witness: a wasAt claim placing them elsewhere in the crime window) that clears them without it")
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
        elif nd is not None and tdepth is not None and nd <= tdepth and \
                sum(d or 0 for d in after_threads.values()) <= sum(d or 0 for d in before_threads.values()):
            # progress is any thread getting deeper; when none does, say exactly which signs still settle the target's
            still = settling_signs(new, rep, target)['signs']
            law.append(f"no progress: no thread got deeper; the '{thread}' thread is still settled at depth {nd} by {still}. "
                       f"Every one of those must end up deeper (hide it behind something, make it need another clue, or "
                       f"carry its fact on a deeper sign instead)")
    return law


class Cancelled(Exception):
    pass


INFRA_ERROR = ('model call failed', 'patch could not be applied: Expecting', 'critic unavailable')


def step_feedback(results):
    """What the next round is told: every distinct problem the drafts had with the case (the draft closest to passing
    first), never a failed model call or an unavailable reviewer, which say nothing about the case."""
    lists = sorted((r[3] for r in results if r[3]), key=len)
    out = []
    for errs in lists:
        for e in errs:
            if not any(str(e).startswith(x) for x in INFRA_ERROR) and str(e) != CRITIC_UNAVAILABLE_REASON and e not in out:
                out.append(e)
    return out[:12] or None


def with_ordinary_evenings(case):
    """Everyone involved has an evening (premise.evening_errors): anyone without one spends it at home, done by code
    (the model is not asked to repair a bookkeeping rule). Kept only when it changes nothing in the solve."""
    import premise as P
    need = sorted({m.split()[1] for m in P.evening_errors(case)})
    if not need:
        return case
    day = (case.get('setting') or {}).get('day') or (FIXED or {}).get('day') or {}
    homes = {p['id']: p.get('home') for p in (FIXED or {}).get('people', [])}
    places = {pl['id'] for pl in case['setting']['places']}
    out = copy.deepcopy(case)
    for pid in need:
        home = homes.get(pid)
        if home not in places or not day.get('evening') or not day.get('morning'):
            continue
        name = next((p['name'] for p in out['people'] if p['id'] == pid), pid)
        out['attitudes'].append({'id': f'a_{pid}_evening', 'agent': pid, 'mode': 'intends', 'content': 'To spend a quiet evening at home.', 'strength': 0.6})
        out['events'].append({'id': f'e_{pid}_evening', 'type': 'routine', 'agent': pid, 'others': [], 'place': home,
                              'start': day['evening'], 'end': day['morning'] - 1, 'causedBy': f'a_{pid}_evening',
                              'summary': f'{name} spends the evening at home.', 'ordinary': True})
    def shape(c):
        r = certify(c, False)
        return r['ok'], r.get('solve_depth'), tuple(sorted((r.get('threads') or {}).items())), tuple(sorted(r.get('surface') or []))
    return out if shape(out) == shape(case) else case


def metrics_of(rep):
    keys = ('solve_depth', 'max_depth', 'surface', 'twist', 'herrings', 'false_signs', 'threads', 'motive', 'means', 'pillars', 'mmo_depth')
    return {k: rep.get(k) for k in keys} if rep.get('ok') else {'ok': False}


def case_added(before, after):
    """Records present in `after` but not in `before` (by id), per group: what one iteration added to the story."""
    out = {}
    for group in ('people', 'objects', 'attitudes', 'events', 'signs', 'rules', 'relations', 'holdings'):
        old = {json.dumps(x, sort_keys=True) if group in ('relations', 'holdings') else x.get('id') for x in (before or {}).get(group, [])}
        new = [x for x in after.get(group, []) if (json.dumps(x, sort_keys=True) if group in ('relations', 'holdings') else x.get('id')) not in old]
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
    # room for drafts that lost and are still finishing (a thread cannot be stopped mid-call), so they never queue the next step
    pool = cf.ThreadPoolExecutor(max_workers=CANDIDATES * 8)

    # SEED: SEED_CANDIDATES in parallel per round; first that certifies wins
    case, fb, best_case, seen, seed_candidates = None, None, None, [], []
    send('phase', phase='seed', message='Writing the setting, cast, secrets and what really happened')
    timing.reset()
    seed_phase = timing.phase('seed').__enter__()
    for rnd in range(SEED_ROUNDS):
        check_stop()
        # after the first round, repair the best draft so far rather than start again (a fresh draft fixes one error
        # and brings back another); every rule broken so far is listed, so none returns
        extra = '' if not fb else (
            '\n\nYOUR PREVIOUS DRAFT (the closest so far) BROKE THESE RULES. Return the COMPLETE corrected case: keep '
            'everything that was right, change only what these need:\n- ' + '\n- '.join(fb)
            + ('\n\nRULES BROKEN IN EARLIER DRAFTS (keep them too):\n- ' + '\n- '.join(x for x in seen if x not in fb)[:3000] if any(x not in fb for x in seen) else '')
            + ('\n\nTHE PREVIOUS DRAFT:\n' + json.dumps(best_case)[:60000] if best_case else ''))
        prompt = seed_prompt(brief, premise) + extra
        futs = {}
        for candidate_index in range(1, SEED_CANDIDATES + 1):
            future, logical_request_id = schedule_llm_json(
                pool, SYSTEM_GEN, prompt, 20000, MODEL,
                audit_metadata={'purpose': 'seed-generation', 'phase': 'seed', 'round': rnd + 1,
                                'candidate': candidate_index})
            futs[future] = {'candidate_id': f'seed.{rnd + 1}.{candidate_index}',
                            'logical_request_id': logical_request_id}
        send('drafting', round=rnd + 1, drafts=SEED_CANDIDATES)
        best, winner_future = None, None
        for f in cf.as_completed(futs):
            raw, response = None, None
            meta = futs[f]
            try:
                response = f.result()
                raw = response.payload if isinstance(response, LLMJSONResponse) else response
                cand = lock_setting(unwrap_case(parse_json(raw)))
                if FIXED:
                    cand = with_ordinary_evenings(cand)
                rep = certify(cand, False)
                pe = premise_errors(cand, premise) + history_errors(cand)
                if pe or (rep['ok'] and setting_errors(cand)):
                    rep = {'ok': False, 'errors': pe + setting_errors(cand) + (rep.get('errors') or [])}
            except Exception as e:
                try:
                    json.dump(raw, open(f'{outdir}/seed-draft-{rnd + 1}-failed.json', 'w'), indent=1, default=str)
                except Exception:
                    pass
                cand, rep = None, {'ok': False, 'errors': [f'the case JSON was incomplete or malformed ({type(e).__name__}: {e}); return ONE complete case with every top-level list (people, attitudes, events, signs, question) and keep texts short']}
            candidate_row = {'candidate_id': meta['candidate_id'], 'round': rnd + 1,
                             'logical_request_id': meta['logical_request_id'],
                             'candidate_hash': provenance.sha256(raw) if raw is not None else None,
                             'parseable': raw is not None, 'code_verdict': 'PASS' if rep['ok'] else 'FAIL',
                             'code_errors': list(rep.get('errors') or []), 'selected': False}
            seed_candidates.append(candidate_row)
            audit = provenance.current_audit()
            if audit and meta['logical_request_id']:
                audit.annotate(meta['logical_request_id'], candidate_hash=candidate_row['candidate_hash'],
                               code_verdict=candidate_row['code_verdict'], code_errors=candidate_row['code_errors'],
                               selection='not-selected')
            send('draft_checked', ok=rep['ok'], errors=(rep.get('errors') or [])[:2])
            if rep['ok']:
                case, winner_future = cand, f
                candidate_row['selected'] = True
                if audit and meta['logical_request_id']:
                    audit.annotate(meta['logical_request_id'], selection='selected')
                break
            if best is None or len(rep['errors']) < len(best):
                best = rep['errors']
                if cand is not None:
                    best_case = cand
        if case:
            for future, meta in futs.items():
                if future is not winner_future:
                    cancel_audited_future(future, meta['logical_request_id'])
            break
        fb = (best or [])[:12]; seen += [x for x in fb if x not in seen]; log(f'[{name}] seed round {rnd+1} rejected: {fb[:2]}')
        send('seed_rejected', round=rnd + 1, errors=fb)
    seed_phase.__exit__(None, None, None)
    timing.save(outdir)
    if case is None:
        pool.shutdown(wait=False, cancel_futures=True)
        send('failed', message='The first draft of the case never passed the checks', errors=fb)
        return {'name': name, 'ok': False, 'reason': 'seed never certified', 'last_errors': fb,
                'seed_candidates': seed_candidates, 'seconds': round(time.time() - t0)}
    if premise:
        case['premise'] = premise
    report = certify(case, False)
    with open(f'{outdir}/00-seed.json', 'w') as output:
        json.dump(case, output, indent=1)
    send('seed', case=case, metrics=metrics_of(report))
    log(f"[{name}] seed ok at {time.time()-t0:.0f}s: surface {report['surface']} solve {report['solve_depth']} threads {report['threads']} "
        f"twist {report['twist']} motive {bool(report['motive'])} means {bool(report['means'])} herring {bool(report['herrings'])}")

    def evaluate(patch_text, mode, target, thread, tdepth, base=None):
        base_case, base_report = base or (case, report)
        try:
            patch = parse_json(patch_text); new = with_ordinary_evenings(apply_patch(base_case, patch, target)); rep = certify(new, False)
        except Exception as e:
            return None, None, None, [f'patch could not be applied: {e}']
        errs = setting_errors(new) + premise_errors(new, premise) + history_errors(new) + (rep.get('errors') or []) + (step_laws(base_case, base_report, new, rep, patch, mode, target, thread, tdepth) if rep['ok'] else [])
        return patch, new, rep, errs

    def annotate(meta, **fields):
        audit = provenance.current_audit()
        if audit and meta.get('logical_request_id'):
            audit.annotate(meta['logical_request_id'], **fields)

    def stack(passed, options, log_id):
        """The passing drafts of one round, applied together: the winner, then each other passing draft for a different
        target on top of it, kept if it still passes the code (its laws against the combined case and its thread's depth
        now) and the critic on the combined case, and moves it further. Drafts aim at different threads, so a round often
        deepens two at once instead of one. For a clear step, further means more innocents cleared on their own evidence."""
        def gain(new_, rep_, mode_):
            return ((len(cleared_alone(new_, rep_)) if mode_ == 'clear' else 0),) + progress(rep_)
        passed = sorted(passed, key=lambda pm: gain(pm[0][1], pm[0][2], options[pm[1]['option']][0]), reverse=True)
        (patch, new, rep, _), meta = passed[0]
        stacked, first = [], options[meta['option']]
        for (p2, _, _, _), m2 in passed[1:]:
            o = options[m2['option']]
            if o[0] not in STACK_MODES or first[0] not in STACK_MODES or o[1] in [first[1]] + [options[x['option']][1] for x in stacked]:
                continue
            _, new2, rep2, errs = evaluate(p2, o[0], o[1], o[3], (rep.get('threads') or {}).get(o[3]), base=(new, rep))
            if errs or gain(new2, rep2, o[0]) <= gain(new, rep, o[0]):
                continue
            try:
                with provenance.semantics(parent_operation='refinement-critic', phase='refinement', candidate=m2['candidate_id'], stacked=True):
                    outcome = critic(new2, p2)
                accepted, _ = critic_feedback(outcome)
                m2['stack_review'] = outcome.history(m2['candidate_id'])
            except Exception:
                accepted = False
            if accepted:
                new, rep = new2, rep2
                m2['patch'] = p2
                stacked.append(m2)
                m2['candidate']['selected'] = True
                log(f"[{name}] {log_id}: stacked {m2['candidate_id']} ({o[0]}:{o[1]}) on the winner: solve {rep['solve_depth']} threads {rep.get('threads')}")
        return (patch, new, rep), meta, stacked

    def progress(rep):
        """How far a case has come: its solve depth, then how deep its threads are in all."""
        return (rep.get('solve_depth') or 0, sum(d or 0 for d in (rep.get('threads') or {}).values()))

    def run_step(step, options):
        """One step, explored in parallel: each option (a mode, target and operator) gets its own draft, drafts from two
        models; code checks each as it lands and the critic reviews every draft that passes, in parallel. Once one
        passes, the others have a short grace to finish, and the passing draft that moves the case furthest wins. A
        round that finds nothing passes each option its own feedback (the code's and the critic's), and tries again."""
        nonlocal case, report
        mode, target, preferred, thread, tdepth = options[0]
        fbs = [None] * len(options)
        entry = {'step': step, 'mode': mode, 'target': target, 'thread': thread, 'preferred': preferred, 'attempts': [],
                 'options': [list(o[:3]) for o in options]}
        ts = time.time()
        before = case
        send('step_start', step=step, mode=mode, target=target, thread=thread, operator=preferred,
             target_title=next((x.get('title') for x in case['signs'] if x['id'] == target), target) if isinstance(target, str) else 'repair')
        for rnd in range(2):
            check_stop()
            models = DRAFT_MODELS
            n = max(CANDIDATES, len(options))
            futures = {}
            for i in range(n):
                k = i % len(options)
                o_mode, o_target, o_pref, o_thread, o_tdepth = options[k]
                candidate_id = f'{step}.{rnd + 1}.{i + 1}'
                inference_profile = models[i % len(models)]
                future, logical_request_id = schedule_llm_json_audited(
                    pool, SYSTEM_GEN, step_prompt(case, report, o_target, o_mode, o_pref, fbs[k]), 9000, inference_profile,
                    audit_metadata={'purpose': 'refinement-candidate', 'phase': 'refinement', 'step': step, 'round': rnd + 1,
                                    'candidate': candidate_id, 'mode': o_mode, 'target': o_target if isinstance(o_target, str) else 'repair'})
                futures[future] = {'kind': 'draft', 'candidate_id': candidate_id, 'option': k,
                                   'inference_profile': inference_profile, 'logical_request_id': logical_request_id}
            send('drafting', step=step, round=rnd + 1, drafts=n)
            # a round has a hard limit (a draft that thinks for minutes is abandoned, its siblings' feedback still used);
            # once one draft passes, the others get only a short grace
            round_start = time.time()
            results, passed, deadline = [[] for _ in options], [], round_start + ROUND_LIMIT
            pending = set(futures)

            def revise(meta, r, response):
                """A rejected draft is revised once, in this round, with its own problems and its own patch: most
                rejections are one fixable slip (a reading still naming the old place), and starting over costs a round."""
                patch_ = r[0] if r[0] is not None else (parse_json(response.payload) if response is not None and isinstance(response.payload, (dict, str)) else None)
                problems = step_feedback([r])
                if meta.get('revision') or passed or not problems or patch_ is None or deadline - time.time() < REVISE_MIN:
                    return
                o_mode, o_target, o_pref, _, _ = options[meta['option']]
                candidate_id = meta['candidate_id'] + 'r'
                future, logical_request_id = schedule_llm_json_audited(
                    pool, SYSTEM_GEN, step_prompt(case, report, o_target, o_mode, o_pref, problems, previous=patch_), 9000, MODEL,
                    audit_metadata={'purpose': 'refinement-revision', 'phase': 'refinement', 'step': step, 'round': rnd + 1,
                                    'candidate': candidate_id, 'mode': o_mode, 'target': o_target if isinstance(o_target, str) else 'repair'})
                futures[future] = {'kind': 'draft', 'candidate_id': candidate_id, 'option': meta['option'], 'revision': 1,
                                   'inference_profile': MODEL, 'logical_request_id': logical_request_id}
                pending.add(future)
                send('drafting', step=step, round=rnd + 1, drafts=1, revision=True)
            while pending:
                wait = max(0.0, deadline - time.time())
                done, pending = cf.wait(pending, timeout=wait, return_when=cf.FIRST_COMPLETED)
                if not done:          # the grace after the first passing draft is over
                    break
                for f in done:
                    meta = futures[f]
                    o_mode, o_target, o_pref, o_thread, o_tdepth = options[meta['option']]
                    if meta['kind'] == 'draft':
                        response, ids, raw_error = None, (), None
                        try:
                            response = f.result(); ids = response.request_ids
                            r = evaluate(response.payload, o_mode, o_target, o_thread, o_tdepth)
                        except Exception as error:
                            ids = response.request_ids if response else _exception_request_ids(error)
                            raw_error = getattr(error, 'raw_response', None)
                            r = (None, None, None, [f'model call failed: {error}'])
                        candidate = {'candidate_id': meta['candidate_id'], 'round': rnd + 1, 'option': meta['option'],
                                     'logical_request_id': meta['logical_request_id'],
                                     'generation_inference_profile': meta['inference_profile'],
                                     'generation_request_ids': list(ids),
                                     'candidate_hash': provenance.sha256(response.payload) if response else None,
                                     'parseable': response is not None, 'code_errors': list(r[3]), 'selected': False,
                                     **({'revision_of': meta['candidate_id'][:-1]} if meta.get('revision') else {})}
                        if raw_error is not None:
                            candidate['generation_error_raw_response'] = raw_error
                        entry.setdefault('candidates', []).append(candidate)
                        entry['attempts'].append(r[3])
                        annotate(meta, candidate_hash=candidate['candidate_hash'], code_verdict='PASS' if not r[3] else 'FAIL',
                                 code_errors=list(r[3]), selection='not-selected')
                        send('draft_checked', step=step, ok=not r[3], errors=r[3][:2])
                        if r[3]:
                            log(f"[{name}] step {step} draft {meta['candidate_id']} ({o_mode}:{o_target if isinstance(o_target, str) else 'repair'}) "
                                f"rejected by code: {[str(e)[:140] for e in r[3][:2]]}")
                            candidate['status'] = 'CODE_REJECTED'
                            results[meta['option']].append(r)
                            revise(meta, r, response)
                            continue
                        # passed the code: the critic reviews it in parallel with the drafts still being written
                        send('reviewing', step=step, drafts=1)
                        with provenance.semantics(parent_operation='refinement-critic', phase='refinement', step=step, round=rnd + 1,
                                                  candidate=meta['candidate_id'], mode=o_mode, target=o_target if isinstance(o_target, str) else 'repair'):
                            cfut = provenance.submit_with_context(pool, critic, r[1], r[0])
                        futures[cfut] = {**meta, 'kind': 'critic', 'result': r, 'candidate': candidate}
                        pending.add(cfut)
                    else:
                        r, candidate = meta['result'], meta['candidate']
                        try:
                            outcome = f.result()
                        except Exception as error:
                            outcome = None
                            annotate(meta, typed_critic_outcome='UNAVAILABLE', code_verdict='PASS', refinement_verdict='FAIL')
                            candidate['status'] = 'UNAVAILABLE'
                            r[3].append(CRITIC_UNAVAILABLE_REASON)
                            results[meta['option']].append(r)
                            continue
                        review = outcome.history(meta['candidate_id'])
                        entry.setdefault('critic', []).append(review)
                        candidate['critic'] = review
                        candidate['status'] = outcome.status.value
                        accepted, review_errors = critic_feedback(outcome)
                        annotate(meta, typed_critic_outcome=outcome.status.value, critic_issues=list(outcome.issues),
                                 code_verdict='PASS', refinement_verdict='PASS' if accepted else 'FAIL')
                        log(f"[{name}] step {step} review ({meta['inference_profile']} draft for {o_mode}:{o_target if isinstance(o_target, str) else 'repair'}): "
                            f"{outcome.status.value} {list(outcome.issues)[:3]}")
                        if accepted:
                            passed.append((r, meta))
                            deadline = min(deadline, time.time() + grace(time.time() - round_start))
                        else:
                            r[3].extend(review_errors)
                            candidate['code_errors'] = list(r[3])
                            results[meta['option']].append(r)
                            revise(meta, r, None)
            for f, meta in futures.items():
                if not f.done():
                    f.cancel()
                    if meta['kind'] == 'draft':
                        cancel_audited_future(f, meta['logical_request_id'])
            if passed:
                (patch, new, rep), meta, stacked = stack(passed, options, f'step {step}')
                meta['candidate']['selected'] = True
                for m in [meta] + stacked:
                    annotate(m, selection='selected' if m is meta else 'stacked')
                case, report = new, rep
                entry['stacked'] = [{'candidate_id': m['candidate_id'], 'mode': options[m['option']][0], 'target': options[m['option']][1],
                                     'story': m['patch'].get('story'), 'operator': m['patch'].get('operator'), 'critic': m.get('stack_review')}
                                    for m in stacked]
                o_mode, o_target, o_pref, o_thread, _ = options[meta['option']]
                entry.update(accepted=True, mode=o_mode, target=o_target, thread=o_thread, preferred=o_pref,
                             operator=patch.get('operator'), blocks=patch.get('blocks'), story=patch.get('story'),
                             solve_depth=rep['solve_depth'], surface=rep['surface'], threads=rep.get('threads'))
                break
            fbs = [step_feedback(rs) for rs in results]
        entry.setdefault('accepted', False)
        entry['seconds'] = round(time.time() - ts)
        hist.append(entry)
        send('step', step=step, mode=entry['mode'], target=entry['target'], thread=entry['thread'], accepted=entry['accepted'],
             operator=entry.get('operator'), blocks=entry.get('blocks'), story=entry.get('story'),
             attempts=[a[:4] for a in entry['attempts']], critic=entry.get('critic', []), seconds=entry['seconds'],
             added=case_added(before, case) if entry['accepted'] else {}, metrics=metrics_of(report))
        with open(f'{outdir}/{step:02d}-case.json', 'w') as output:
            json.dump(case, output, indent=1)
        shown = entry['target'] if isinstance(entry['target'], str) else 'repair'
        log(f"[{name}] step {step} {entry['mode']}:{shown} -> {'OK ' + str(entry.get('operator')) if entry['accepted'] else 'REJECTED'}"
            f"{' +' + str(len(entry['stacked'])) + ' stacked' if entry.get('stacked') else ''}"
            f" ({len(entry['attempts'])} drafts over {len(options)} option(s), {entry['seconds']}s, solve {report['solve_depth']})")

    def timed_step(step, options, name='step'):
        with timing.phase(f'{name} {step}'):
            run_step(step, options)
        timing.save(outdir)

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
        timed_step(step, schedule_options(case, report, step, hist, D, profile))
    # The whole-case review sees what step reviews cannot (a gate inherited across steps, a lie mislabelled): run it now
    # and repair what it finds with ordinary steps, instead of rejecting the finished case at publication.
    review_rounds = []
    if FIXED and REVIEW_REPAIRS:
        import publish
        for round_ in range(REVIEW_REPAIRS + 1):
            check_stop()
            send('phase', phase='review', message='An independent reviewer reads the whole case')
            with timing.phase(f'review {round_ + 1}'):
                outcome = publish.publication_critic(case)
            review_rounds.append({'round': round_ + 1, 'status': outcome.status.value, 'issues': list(outcome.issues)})
            log(f"[{name}] whole-case review {round_ + 1}: {outcome.status.value} {list(outcome.issues)[:4]}")
            if outcome.status is not CriticStatus.FAIL or round_ == REVIEW_REPAIRS:
                break
            timed_step(len(hist) + 1, [('repair', list(outcome.issues), 'Repair', None, None)], 'repair')
            if not hist[-1].get('accepted'):   # nothing changed: reviewing the same case again would only re-roll it
                log(f"[{name}] repair rejected; the case stands as reviewed")
                break
    pool.shutdown(wait=False, cancel_futures=True)
    final = certify(case, False)
    result = {'name': name, 'brief': brief, 'ok': final['ok'], 'history': hist, 'review_rounds': review_rounds,
              'seed_candidates': seed_candidates,
              'requested_difficulty_profile': copy.deepcopy(profile),
              'generation_certificate': {'ok': final['ok'], 'errors': list(final.get('errors') or []),
                                         'semantic_sha256': provenance.sha256(metrics_of(final))},
              'requested_target_deficits': DF.targets_met(case, final, profile) if profile else [],
              'generation_review': final_case_review_status(hist), 'seconds': round(time.time() - t0),
              'metrics': {k: final.get(k) for k in ('solve_depth', 'max_depth', 'surface', 'twist', 'key', 'herrings', 'false_signs', 'threads', 'motive', 'means', 'pillars', 'mmo_depth')},
              'signs': len(case['signs']), 'events': len(case['events']), 'people': len(case['people'])}
    with open(f'{outdir}/final-case.json', 'w') as output:
        json.dump(case, output, indent=1)
    with open(f'{outdir}/result.json', 'w') as output:
        json.dump(result, output, indent=1)
    with open(f'{outdir}/report.md', 'w') as output:
        output.write(render(case, final, result))
    timing.save(outdir)
    log(f"[{name}] DONE in {result['seconds']}s: solve {final.get('solve_depth')} threads {final.get('threads')}")
    log(timing.table())
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
