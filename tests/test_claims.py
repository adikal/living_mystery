"""Claims version 2 (docs/claims.md): truth in the history, and reasoning from what the player knows.

The reasoning procedure (tools/refine-c/claims.py, and its JavaScript twin dist/mk/claims.mjs) must agree exactly with
the reference semantics in Z3 (server/case_oracle.py), both ways: a candidate is ruled out by one iff by the other. This
is checked on every published and recorded case, on many sets of evidence each, and on random cases that use every
predicate and mode. The truth must survive whenever every trusted claim is true in the history.
"""
import glob
import json
import os
import random
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'server'), str(ROOT / 'tools' / 'refine-c')]
import case_oracle as O  # noqa: E402
import claims as C  # noqa: E402
from migrate import migrate  # noqa: E402
from refine import analyse, certify, trusted_claims  # noqa: E402


def claims_of(case, ids):
    signs = {s['id']: s for s in case['signs']}
    return [(i, C.claim_of(signs[i])) for i in sorted(ids) if C.claim_of(signs[i])]


def z3_survivors(case, ids):
    cand = O.candidates(case, ids)
    assert all(r['status'] != 'unknown' for r in cand.values()), cand
    return sorted(h for h, r in cand.items() if r['status'] == 'sat')


def js(case, sets):
    out = subprocess.run(['node', str(ROOT / 'tools/mk-claims.mjs')], input=json.dumps({'case': case, 'sets': sets}),
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


# ----------------------------------------------------------------------------------------------------
# A small hand-built history, to check truth by hand
# ----------------------------------------------------------------------------------------------------

def village():
    places = ['inn', 'church', 'mill', 'farm']
    return {
        'setting': {'places': [{'id': p} for p in places],
                    'links': [{'a': 'inn', 'b': 'church', 'minutes': 5}, {'a': 'church', 'b': 'mill', 'minutes': 10},
                              {'a': 'mill', 'b': 'farm', 'minutes': 5}]},
        'people': [{'id': 'ann', 'traits': {'handed': 'left'}}, {'id': 'bob', 'traits': {'handed': 'right'}},
                   {'id': 'vic', 'traits': {}}],
        'objects': [{'id': 'knife'}, {'id': 'flour', 'supply': True}],
        'vocabulary': {'relations': [{'rel': 'owes', 'inverse': 'owed_by'}]},
        'holdings': [{'person': 'bob', 'item': 'knife'}, {'person': 'bob', 'item': 'flour'}],
        'relations': [{'a': 'bob', 'rel': 'owes', 'b': 'vic'}],
        'victim': 'vic',
        'question': {'truth': 'h_ann', 'candidates': [{'id': 'h_ann', 'facts': {'actor': 'ann', 'method': 'stab'}},
                                                       {'id': 'h_bob', 'facts': {'actor': 'bob', 'method': 'stab'}}],
                     'crime': {'event': 'e_stab', 'place': 'mill', 'window': [1300, 1400]}},
        'events': [
            {'id': 'e_ann1', 'agent': 'ann', 'place': 'inn', 'start': 1200, 'end': 1230},
            {'id': 'e_ann2', 'agent': 'ann', 'place': 'inn', 'start': 1260, 'end': 1270},       # stays at the inn between
            {'id': 'e_take', 'agent': 'ann', 'place': 'church', 'start': 1300, 'end': 1305, 'effects': [{'take': 'knife'}]},
            {'id': 'e_stab', 'agent': 'ann', 'others': ['vic'], 'place': 'mill', 'start': 1330, 'end': 1335,
             'facts': {'method': 'stab'}, 'effects': [{'trait': 'handed', 'value': 'bloodied'}]},
            {'id': 'e_bob', 'agent': 'bob', 'place': 'farm', 'start': 1250, 'end': 1450},
            {'id': 'e_vic0', 'agent': 'vic', 'place': 'inn', 'start': 1100, 'end': 1290},
            {'id': 'e_vic', 'agent': 'vic', 'place': 'mill', 'start': 1310, 'end': 1320}],
        'signs': []}


class Truth(unittest.TestCase):
    def truth(self, claim):
        c = village()
        return C.truth_of(c, C.History(c), claim)

    def test_whereabouts_are_three_valued(self):
        at = lambda p, l, a, b, when='throughout': self.truth({'pred': 'wasAt', 'person': p, 'place': l, 'from': a, 'to': b, 'when': when})
        self.assertIs(at('ann', 'inn', 1200, 1270), True)              # an event, a stay, an event
        self.assertIs(at('ann', 'inn', 1260, 1290), None)              # 1271..1290 she may still be there, or walking
        self.assertIs(at('ann', 'inn', 1260, 1299), False)             # at 1296..1299 she cannot be at the inn and reach the church by 1300
        self.assertIs(at('ann', 'farm', 1240, 1250), False)            # at the inn then
        self.assertIs(at('ann', 'farm', 1280, 1290, 'sometime'), False)   # cannot reach the farm and be at the church by 1300
        self.assertIs(at('ann', 'church', 1280, 1290, 'sometime'), None)
        self.assertIs(at('vic', 'mill', 1400, 1500), True)             # the victim stays where they died
        self.assertIs(at('bob', 'mill', 1300, 1400, 'never'), True)
        self.assertIs(self.truth({'pred': 'nobodyAt', 'place': 'farm', 'from': 1300, 'to': 1310}), False)
        self.assertIs(self.truth({'pred': 'nobodyAt', 'place': 'church', 'from': 1250, 'to': 1255}), True)

    def test_objects_relations_traits_follow_events(self):
        self.assertIs(self.truth({'pred': 'had', 'person': 'bob', 'item': 'knife', 'from': 1200, 'to': 1299}), True)
        self.assertIs(self.truth({'pred': 'had', 'person': 'bob', 'item': 'knife', 'from': 1200, 'to': 1300}), False)
        self.assertIs(self.truth({'pred': 'culpritHad', 'item': 'knife'}), True)
        self.assertIs(self.truth({'pred': 'onlyHad', 'item': 'flour', 'people': ['bob']}), True)
        self.assertIs(self.truth({'pred': 'related', 'a': 'vic', 'rel': 'owed_by', 'b': 'bob'}), True)   # the inverse
        self.assertIs(self.truth({'pred': 'culpritRelated', 'rel': 'owes', 'b': 'vic'}), False)
        self.assertIs(self.truth({'pred': 'culpritTrait', 'trait': 'handed', 'value': 'left'}), True)  # changed after the crime
        self.assertIs(self.truth({'pred': 'hasTrait', 'person': 'ann', 'trait': 'handed', 'value': 'bloodied', 'from': 1336, 'to': 1400}), True)

    def test_crime_claims(self):
        self.assertIs(self.truth({'pred': 'crimeBetween', 'from': 1325, 'to': 1340}), True)
        self.assertIs(self.truth({'pred': 'crimeBetween', 'from': 1331, 'to': 1340}), False)   # the crime minute is its start
        self.assertIs(self.truth({'pred': 'crimeFact', 'key': 'method', 'value': 'stab'}), True)
        self.assertIs(self.truth({'pred': 'crimeFact', 'key': 'weapon', 'value': 'knife'}), None)


class Reasoning(unittest.TestCase):
    """Hand-made cases for each kind of reasoning, checked against Z3 as well as by hand."""

    def check(self, signs, expected):
        # what the player is told of the crime's time is a claim like any other (the case's window, here)
        c = village()
        signs = [{'pred': 'crimeBetween', 'from': 1300, 'to': 1400}] + signs
        c['signs'] = [{'id': f's{i}', 'kind': 'record', 'claim': x} for i, x in enumerate(signs)]
        ids = [s['id'] for s in c['signs']]
        self.assertEqual(sorted(C.survivors_of(c, claims_of(c, ids))), expected)
        self.assertEqual(z3_survivors(c, ids), expected)

    def test_an_alibi_needs_the_walk(self):
        # bob at the farm until 1395: the mill is 5 minutes away, the window ends at 1400
        self.check([{'pred': 'wasAt', 'person': 'bob', 'place': 'farm', 'from': 1250, 'to': 1395}], ['h_ann', 'h_bob'])
        self.check([{'pred': 'wasAt', 'person': 'bob', 'place': 'farm', 'from': 1250, 'to': 1396}], ['h_ann'])

    def test_a_vague_sighting_is_an_alibi_only_if_every_placement_is(self):
        farm = lambda a, b, when: {'pred': 'wasAt', 'person': 'bob', 'place': 'farm', 'from': a, 'to': b, 'when': when}
        window = {'pred': 'crimeBetween', 'from': 1333, 'to': 1337}
        self.check([window, farm(1320, 1400, 'sometime')], ['h_ann', 'h_bob'])   # seen at the farm at 1320 fits
        self.check([window, farm(1333, 1337, 'sometime')], ['h_ann'])        # seen at the farm then: cannot be at the mill
        self.check([window, {'pred': 'wasAt', 'person': 'bob', 'place': 'mill', 'from': 1300, 'to': 1400, 'when': 'never'}], ['h_ann'])

    def test_what_the_player_does_not_know_rules_no_one_out(self):
        knife = {'pred': 'culpritHad', 'item': 'knife'}
        self.check([knife], ['h_ann', 'h_bob'])                                # nothing says who had it
        self.check([knife, {'pred': 'had', 'person': 'ann', 'item': 'knife', 'from': 1300, 'to': 1400}], ['h_ann'])   # one holder
        self.check([{'pred': 'culpritHad', 'item': 'flour'}, {'pred': 'onlyHad', 'item': 'flour', 'people': ['ann']}], ['h_ann'])
        self.check([{'pred': 'culpritHad', 'item': 'flour'}, {'pred': 'had', 'person': 'ann', 'item': 'flour'}], ['h_ann', 'h_bob'])   # a supply: many may have it

    def test_relations_traits_and_facts(self):
        self.check([{'pred': 'culpritRelated', 'rel': 'owes', 'b': 'vic', 'not': True},
                    {'pred': 'related', 'a': 'vic', 'rel': 'owed_by', 'b': 'bob'}], ['h_ann'])    # read through the inverse
        self.check([{'pred': 'culpritTrait', 'trait': 'handed', 'value': 'left'},
                    {'pred': 'hasTrait', 'person': 'bob', 'trait': 'handed', 'value': 'right'}], ['h_ann'])
        self.check([{'pred': 'culpritTrait', 'trait': 'handed', 'value': 'left'},
                    {'pred': 'hasTrait', 'person': 'bob', 'trait': 'handed', 'value': 'right', 'from': 1200, 'to': 1320}], ['h_ann', 'h_bob'])
        self.check([{'pred': 'crimeFact', 'key': 'method', 'value': 'poison'}], [])

    def test_inconsistent_knowledge_rules_out_everyone(self):
        self.check([{'pred': 'wasAt', 'person': 'bob', 'place': 'farm', 'from': 1200, 'to': 1210},
                    {'pred': 'wasAt', 'person': 'bob', 'place': 'inn', 'from': 1205, 'to': 1220}], [])


# ----------------------------------------------------------------------------------------------------
# Random cases that use every predicate and mode
# ----------------------------------------------------------------------------------------------------

def random_case(seed):
    r = random.Random(seed)
    places = [f'l{i}' for i in range(4)]
    links = [{'a': places[i], 'b': places[i + 1], 'minutes': r.randint(2, 12)} for i in range(3)]
    if r.random() < .5:
        links.append({'a': 'l0', 'b': 'l3', 'minutes': r.randint(4, 20)})
    walk = O.travel({'setting': {'places': [{'id': p} for p in places], 'links': links}})
    people = ['p0', 'p1', 'p2', 'p3', 'vic']
    culprit, scene = r.choice(people[:4]), r.choice(places)
    items = ['knife', 'key', 'paper']
    events, n = [], 0
    for p in people:
        t, here = r.randint(1150, 1250), r.choice(places)
        plan = r.randint(1, 4)
        for k in range(plan):
            if p == culprit and k == plan // 2:
                place = scene
            elif p == 'vic' and k == plan - 1:
                place = scene
            else:
                place = r.choice(places)
            t += (walk[here][place] if place != here else 0) + r.randint(0, 25)
            length = r.randint(0, 30)
            ev = {'id': f'e{n}', 'agent': p, 'place': place, 'start': t, 'end': t + length, 'causedBy': 'nature'}
            if r.random() < .3:
                ev['effects'] = [r.choice([{'take': r.choice(items)}, {'lose': r.choice(items)},
                                           {'give': r.choice(items), 'to': r.choice(people)},
                                           {'relate': r.choice(['owes', 'hates']), 'to': r.choice(people)},
                                           {'trait': 'handed', 'value': r.choice(['left', 'right'])}])]
            if p == culprit and k == plan // 2:
                ev['id'], ev['facts'] = 'e_crime', {'method': 'blow'}
            events.append(ev); n += 1; t += length; here = place
    crime = next(e for e in events if e['id'] == 'e_crime')
    cand = [{'id': f'h_{p}', 'facts': {'actor': p, **({'method': r.choice(['blow', 'blow', 'poison'])} if p != culprit else {'method': 'blow'})}}
            for p in people[:4]]
    case = {
        'setting': {'places': [{'id': p} for p in places], 'links': links},
        'people': [{'id': p, 'traits': {'handed': r.choice(['left', 'right'])}} for p in people],
        'objects': [{'id': 'knife'}, {'id': 'key'}, {'id': 'paper', 'supply': True}],
        'vocabulary': {'relations': [{'rel': 'owes', 'inverse': 'owed_by'}, {'rel': 'hates'}]},
        'holdings': [{'person': r.choice(people), 'item': 'knife'}, {'person': r.choice(people), 'item': 'key'}] +
                    [{'person': p, 'item': 'paper'} for p in r.sample(people, 2)],
        'relations': [{'a': r.choice(people), 'rel': r.choice(['owes', 'hates']), 'b': r.choice(people)} for _ in range(3)],
        'victim': 'vic',
        'question': {'truth': f'h_{culprit}', 'candidates': cand,
                     'crime': {'event': 'e_crime', 'place': scene, 'window': [crime['start'] - r.randint(0, 40), crime['start'] + r.randint(0, 40)]}},
        'events': events, 'signs': []}

    def interval():
        a = r.randint(1150, 1500)
        return a, a + r.randint(0, 90)

    def claim():
        a, b = interval()
        when = r.choice(['throughout', 'throughout', 'sometime', 'never'])
        k = r.choice(['wasAt'] * 5 + ['had', 'related', 'hasTrait', 'nobodyAt', 'onlyHad', 'crimeBetween', 'crimeFact',
                                      'culpritHad', 'culpritRelated', 'culpritTrait'])
        p, item = r.choice(people), r.choice(items)
        x = {'wasAt': {'person': p, 'place': r.choice(places), 'from': a, 'to': b, 'when': when},
             'had': {'person': p, 'item': item, 'from': a, 'to': b, 'when': when},
             'related': {'a': p, 'rel': r.choice(['owes', 'owed_by', 'hates']), 'b': r.choice(people), 'when': when},
             'hasTrait': {'person': p, 'trait': 'handed', 'value': r.choice(['left', 'right']), 'from': a, 'to': b, 'when': when},
             'nobodyAt': {'place': r.choice(places), 'from': a, 'to': b},
             'onlyHad': {'item': item, 'people': r.sample(people, r.randint(0, 3)), 'from': a, 'to': b},
             'crimeBetween': {'from': a, 'to': b},
             'crimeFact': {'key': 'method', 'value': r.choice(['blow', 'poison']), 'not': r.random() < .3},
             'culpritHad': {'item': item, 'not': r.random() < .3, **({'from': a, 'to': b} if r.random() < .3 else {})},
             'culpritRelated': {'rel': r.choice(['owes', 'owed_by', 'hates']), 'b': r.choice(people), 'not': r.random() < .3},
             'culpritTrait': {'trait': 'handed', 'value': r.choice(['left', 'right']), 'not': r.random() < .3}}[k]
        return {'pred': k, **x}

    # half the claims are read off the history (so many are true), half are random
    for i in range(r.randint(6, 14)):
        case['signs'].append({'id': f's{i:02d}', 'kind': 'record', 'claim': claim()})
    H = C.History(case)
    for ev in r.sample(events, min(4, len(events))):
        x = {'pred': 'wasAt', 'person': ev['agent'], 'place': ev['place'], 'from': ev['start'], 'to': ev['end']}
        case['signs'].append({'id': f't{len(case["signs"]):02d}', 'kind': 'record', 'claim': x})
    for s in case['signs']:
        errs = C.claim_errors(case, s['id'], s['claim'])
        assert not errs, errs
    return case, H, r


class Equivalence(unittest.TestCase):
    def test_random_cases_agree_with_z3_and_javascript(self):
        n = 0
        for seed in range(120):
            case, H, r = random_case(seed)
            ids = [s['id'] for s in case['signs']]
            sets = [sorted(r.sample(ids, r.randint(0, len(ids)))) for _ in range(6)]
            # the truth survives every set of true claims
            true = [s['id'] for s in case['signs'] if C.truth_of(case, H, s['claim']) is True]
            sets += [sorted(r.sample(true, r.randint(0, len(true)))) for _ in range(3)] + [true]
            out = js(case, sets)
            for sid, v in out['truth'].items():
                self.assertEqual(v, C.truth_of(case, H, next(s['claim'] for s in case['signs'] if s['id'] == sid)), (seed, sid))
            for k, ids_ in enumerate(sets):
                py = sorted(C.survivors_of(case, claims_of(case, ids_)))
                self.assertEqual(py, z3_survivors(case, ids_), (seed, ids_))
                self.assertEqual(sorted(out['sets'][k]['survivors']), py, (seed, ids_))
                ok = C.consistent(case, claims_of(case, ids_))
                self.assertEqual(ok, O.consistent(case, ids_), (seed, ids_))
                self.assertEqual(out['sets'][k]['consistent'], ok, (seed, ids_))
                if k >= 6:
                    self.assertIn(case['question']['truth'], py, (seed, ids_))
                n += 1
        self.assertGreater(n, 1000)

    def test_recorded_cases_agree_with_z3(self):
        files = sorted(glob.glob(str(ROOT / 'dist/cases/generated/**/mk-*.json'), recursive=True))
        runs = sorted(f for f in glob.glob(str(ROOT / 'tools/refine-c/runs/*/*/*.json')) if not f.endswith('result.json'))
        r, checked = random.Random(5), 0
        for f in files + runs:
            case = json.load(open(f))
            if 'signs' not in case or 'question' not in case:
                continue
            case = migrate(case)[0]
            A = analyse(case)
            if not A['understood']:
                continue
            und = sorted(A['understood'])
            sets = [[x for x in und if A['eff'][x] <= d] for d in range(max(A['eff'].values()) + 1)]
            sets += [sorted(r.sample(und, r.randint(1, len(und)))) for _ in range(3 if f in files else 1)]
            if f in files:
                sets += [[x for x in und if x != y] for y in und]
            for ids in sets:
                vis = [x for x in ids if x in A['understood']]
                self.assertEqual(sorted(C.survivors_of(case, trusted_claims(A, vis), A['tt'])), z3_survivors(case, vis), (f, vis))
                checked += 1
        self.assertGreater(checked, 2000)

    def test_published_cases_still_certify(self):
        for f in glob.glob(str(ROOT / 'dist/cases/generated/**/mk-*.json'), recursive=True):
            r = certify(migrate(json.load(open(f)))[0], require_backing=True)
            self.assertTrue(r['ok'], (f, r.get('errors')))


if __name__ == '__main__':
    unittest.main()
