"""Migrate a mystery-kernel case from claims version 1 to version 2 (docs/claims.md).

The migration is mechanical and keeps what version 1 meant wherever version 2 can say it:

- claims: place -> wasAt (throughout), time -> crimeBetween, trait -> culpritTrait, relation -> related (named) or
  culpritRelated, possession -> had (named) or culpritHad, fact -> crimeFact (dropped when no candidate declares the
  key, since it then rules no one out);
- possession -> holdings; an item held by more than one person becomes a supply; relation names -> vocabulary;
- the crime event's facts come from the true candidate's (and from fact claims the true candidate says nothing about),
  and an event's own 'method' moves into its facts;
- what version 1 read from hidden tables becomes public knowledge, which the player holds from the start: the crime
  window, each candidate's tested traits, who had each item a culpritHad claim names, and that a candidate does not
  stand in a relation a culpritRelated claim names; public knowledge overturns (defeats) any clue that contradicts it.

Version 2 judges whereabouts more strictly (a claim over minutes no event accounts for is undetermined), so a migrated
case may need its history completed before it certifies; that is a change to the case, not to the migration.

    .venv/bin/python tools/refine-c/migrate.py FILE [FILE ...] [--write]
"""
import argparse
import copy
import json

from claims import claim_of, consistent

VERSION = 2


def _words(s):
    return str(s).replace('_', ' ')


def _names(case, ids):
    names = {p['id']: p.get('name', p['id']) for p in case['people']}
    out = [names.get(i, i) for i in ids]
    return out[0] if len(out) == 1 else ', '.join(out[:-1]) + ' and ' + out[-1]


def _claim(case, c, notes, sid):
    k = c.get('kind')
    if k == 'place':
        return {'pred': 'wasAt', 'person': c['person'], 'place': c['place'], 'from': c['start'], 'to': c['end']}
    if k == 'time':
        return {'pred': 'crimeBetween', 'from': c['start'], 'to': c['end']}
    if k == 'trait':
        return {'pred': 'culpritTrait', 'trait': c['trait'], 'value': c['value']}
    if k == 'relation':
        if c.get('a'):
            return {'pred': 'related', 'a': c['a'], 'rel': c['rel'], 'b': c.get('b')}
        return {'pred': 'culpritRelated', 'rel': c['rel'], 'b': c.get('b')}
    if k == 'possession':
        if c.get('person'):
            return {'pred': 'had', 'person': c['person'], 'item': c['item']}
        return {'pred': 'culpritHad', 'item': c['item']}
    if k == 'fact':
        if any(c['key'] in (h.get('facts') or {}) for h in case['question']['candidates']):
            return {'pred': 'crimeFact', 'key': c['key'], 'value': c['value']}
        notes.append(f"{sid}: fact claim '{c['key']}' dropped (no candidate declares it, so it rules no one out)")
        return None
    return c


def _clock(m):
    return f'{(m // 60) % 24:02d}:{m % 60:02d}'


def public_sign(case, sid, title, text, claim):
    """Add a public sign (what everyone knows) unless one with this id exists; returns it, or None."""
    if any(x['id'] == sid for x in case['signs']):
        return None
    x = {'id': sid, 'kind': 'public', 'title': title, 'text': text, 'claim': claim}
    case['signs'].append(x)
    return x


def public_knowledge(case):
    """What the game shows everyone from the start, as public signs: when the crime happened (the crime window), and
    each candidate's traits that a clue tests (their descriptions show them). Returns the signs added."""
    people = {p['id']: p for p in case['people']}
    q, added = case['question'], []
    w0, w1 = q['crime']['window']
    victim = people.get(case.get('victim') or '', {}).get('name')
    added.append(public_sign(case, 'pub_window', 'When it happened', f"{victim or 'The victim'} died between {_clock(w0)} and {_clock(w1)}.",
                             {'pred': 'crimeBetween', 'from': w0, 'to': w1}))
    actors = [a for a in ((h.get('facts') or {}).get('actor') for h in q['candidates']) if a in people]
    tested = sorted({x['claim']['trait'] for x in case['signs'] if isinstance(x.get('claim'), dict) and x['claim'].get('pred') == 'culpritTrait'})
    for k in tested:
        for a in actors:
            v = (people[a].get('traits') or {}).get(k)
            if v is not None:
                added.append(public_sign(case, f'pub_trait_{a}_{k}', f"{people[a]['name']}: {_words(k)}",
                                         f"{people[a]['name']}: {_words(k)} {_words(v)}.", {'pred': 'hasTrait', 'person': a, 'trait': k, 'value': v}))
    return [x for x in added if x]


def migrate(case):
    """Returns (version-2 case, notes). A version-2 case is returned unchanged."""
    if case.get('claims_version') == VERSION:
        return case, []
    c, notes = copy.deepcopy(case), []
    rows = c.pop('possession', []) or []
    holders = {}
    for r in rows:
        holders.setdefault(r['item'], [])
        if r['person'] not in holders[r['item']]:
            holders[r['item']].append(r['person'])
    c['holdings'] = [{'person': p, 'item': i} for i, ps in holders.items() for p in ps]
    for o in c.get('objects', []):
        if len(holders.get(o['id'], [])) > 1:
            o['supply'] = True
    rels = sorted({r['rel'] for r in c.get('relations', [])} |
                  {x['claim']['rel'] for x in c['signs'] if isinstance(x.get('claim'), dict) and x['claim'].get('kind') == 'relation'})
    known = {r['rel'] for r in (c.get('vocabulary') or {}).get('relations', [])}
    c.setdefault('vocabulary', {}).setdefault('relations', [])
    c['vocabulary']['relations'] += [{'rel': r} for r in rels if r not in known]

    q = c['question']
    truth = next(h for h in q['candidates'] if h['id'] == q['truth'])
    crime = next(e for e in c['events'] if e['id'] == q['crime']['event'])
    facts = {k: v for k, v in (truth.get('facts') or {}).items() if k != 'actor'}
    for x in c['signs']:
        old = x.get('claim')
        if isinstance(old, dict) and old.get('kind') == 'fact' and old['key'] not in facts and \
                any(old['key'] in (h.get('facts') or {}) for h in q['candidates']):
            facts[old['key']] = old['value']      # version 1 held such a claim true for the truth
    for e in c['events']:            # version 1 kept the crime's method on the event itself
        if 'method' in e:
            e.setdefault('facts', {}).setdefault('method', e.pop('method'))
    if facts:
        crime['facts'] = {**facts, **(crime.get('facts') or {})}
    for x in c['signs']:
        if isinstance(x.get('claim'), dict):
            new = _claim(c, x['claim'], notes, x['id'])
            if new is None:
                x.pop('claim')
            else:
                x['claim'] = new

    # what version 1 read from hidden tables, made public
    public = public_knowledge(c)
    people = {p['id']: p for p in c['people']}
    actors = [a for a in ((h.get('facts') or {}).get('actor') for h in q['candidates']) if a in people]
    items = {o['id']: o.get('name', _words(o['id'])) for o in c.get('objects', [])}
    claims = [x['claim'] for x in c['signs'] if isinstance(x.get('claim'), dict)]

    def add(sid, title, text, claim):
        x = public_sign(c, sid, title, text, claim)
        if x:
            public.append(x)

    for i in sorted({x['item'] for x in claims if x['pred'] == 'culpritHad'}):
        ps = holders.get(i, [])
        add(f'pub_holders_{i}', f'Who had {items.get(i, _words(i))}',
            f"Only {_names(c, ps)} had {items.get(i, _words(i))}." if ps else f"No one had {items.get(i, _words(i))}.",
            {'pred': 'onlyHad', 'item': i, 'people': ps})
    for x in [x for x in claims if x['pred'] == 'culpritRelated']:
        for a in actors:
            if not any(r['a'] == a and r['rel'] == x['rel'] and (not x.get('b') or r.get('b') == x['b']) for r in c.get('relations', [])):
                add(f"pub_not_{a}_{x['rel']}_{x.get('b')}", f"{people[a]['name']} and {_words(x['rel'])}",
                    f"{people[a]['name']} was not {_words(x['rel'])} {_names(c, [x['b']]) if x.get('b') else 'anyone'}.",
                    {'pred': 'related', 'a': a, 'rel': x['rel'], 'b': x.get('b'), 'when': 'never'})
    # a clue that contradicts what everyone knows is overturned by it
    for p in public:
        for x in c['signs']:
            if x['kind'] != 'public' and claim_of(x) and not consistent(c, [(p['id'], p['claim']), (x['id'], x['claim'])]):
                p.setdefault('defeats', []).append(x['id'])
                notes.append(f"{p['id']} defeats {x['id']}, which contradicts it")
    if public:
        notes.append(f"{len(public)} public signs added: {', '.join(p['id'] for p in public)}")
    c['claims_version'] = VERSION
    return c, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--write', action='store_true', help='replace each file with its migrated case')
    o = ap.parse_args()
    for f in o.files:
        new, notes = migrate(json.load(open(f)))
        print(f, '|', '; '.join(notes) or 'no notes')
        if o.write:
            json.dump(new, open(f, 'w'), indent=1, ensure_ascii=False)


if __name__ == '__main__':
    main()
