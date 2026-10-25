"""Measure a whole-case reviewer: time and recall on a case with known planted defects, and false alarms on the clean
case. Prints one JSON line per reviewer and run; for iterating on the review design, not part of publishing.

    python tools/refine-c/review_probe.py [--runs 2] [--mode panel|single|both]
"""
import argparse
import copy
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import publish  # noqa: E402

CASE = os.path.join(HERE, '..', '..', 'dist', 'cases', 'archive', '2026-10', 'mk-live-20261025-114526.json')

# defects The Iron Hound shipped with before its repair, planted back: (sign id, what a reviewer should flag)
PLANTED = {
    's_surface_dora': ('I was behind my counter sorting the evening post, and later took a turn out with my lamp when I heard '
                       'a clatter in the fog. Picked up a thing or two that had no business lying in the gutter, and then home to bed.'),
    's_doorstop': {'clara': 'That old hound has been missing from the hall for days; anyone might have taken it.'},
    's_saw_ada_vera_inn': "I saw Mrs Lacey in the bar at the Rook & Lantern round about quarter to seven, love.",
}


def broken(case):
    case = copy.deepcopy(case)
    s = {x['id']: x for x in case['signs']}
    s['s_surface_dora']['text'] = PLANTED['s_surface_dora']
    s['s_doorstop'].setdefault('reactions', {}).update(PLANTED['s_doorstop'])
    case['signs'].append({'id': 's_saw_ada_vera_inn', 'kind': 'testimony', 'speaker': 'ada', 'sighting': True,
                          'claim': {'pred': 'wasAt', 'person': 'vera', 'place': 'inn', 'from': 1110, 'to': 1200},
                          'title': 'Ada Finch saw Vera Lacey', 'text': PLANTED['s_saw_ada_vera_inn'], 'ask': 'Did you see anyone last night?'})
    return case


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--runs', type=int, default=1)
    ap.add_argument('--mode', default='both')
    a = ap.parse_args()
    clean = json.load(open(CASE))
    bad = broken(clean)
    modes = ['panel', 'single'] if a.mode == 'both' else [a.mode]
    for _ in range(a.runs):
        for mode in modes:
            publish.REVIEW_PANEL = mode == 'panel'
            for label, case in (('broken', bad), ('clean', clean)):
                t = time.time()
                out = publish.publication_critic(case)
                found = sorted({i.split(':', 1)[0].strip() for i in out.issues} & set(PLANTED)) if label == 'broken' else []
                print(json.dumps({'mode': mode, 'case': label, 'seconds': round(time.time() - t), 'status': out.status.value,
                                  'planted_found': found, 'issues': list(out.issues)}), flush=True)


if __name__ == '__main__':
    main()
