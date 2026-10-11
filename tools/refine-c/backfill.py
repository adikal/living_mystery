"""Re-run publish-time wording steps on cases already published, so they gain what new cases get (wording only: each
step adds no fact, and every case must still pass publish.gate before it is written).

    .venv/bin/python tools/refine-c/backfill.py sightings [--dry-run] [files...]

Steps: review, linecheck, concessions, contradictions, declines, evenings, questions, surface, sightings, morning, reactions, lines, art, unlock, accepted. One process per case (the Z3 checks are not
thread-safe); with no files, every case in dist/cases/generated and its live/ folder.
"""
import concurrent.futures as cf
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)


def steps():
    import enrich
    import publish
    return {'review': lambda c: len(enrich.review_publish(c)), 'linecheck': lambda c: (publish.check_lines(c), publish.add_show_lines(c))[0], 'contradictions': lambda c: publish.record_contradictions(c, log=print), 'declines': publish.add_declines, 'evenings': lambda c: (publish.add_ordinary_evenings(c), publish.add_surface_accounts(c), publish.mark_surface_truth(c))[0], 'questions': publish.mark_duplicate_questions, 'surface': lambda c: (publish.add_surface_accounts(c), publish.mark_surface_truth(c))[0], 'sightings': lambda c: publish.add_sightings(c, log=lambda *a: None),
            'morning': publish.add_morning_accounts, 'reactions': publish.add_reactions, 'concessions': publish.add_concessions, 'lines': publish.add_show_lines,
            'art': lambda c: enrich.add_art(c, retry_none=True), 'unlock': enrich.add_unlock_groups, 'accepted': enrich.add_accepted}


def one(args):
    path, names, dry = args
    import difficulty
    import enrich
    import publish
    case = json.load(open(path))
    done = {n: steps()[n](case) for n in names}
    publish.add_show_lines(case)                 # lines for anything added
    enrich.review_publish(case)
    publish.finish_wording(case)                 # lines checked against their clue; forms of address
    g = publish.gate(case)
    if g['ok'] and not dry:
        target = (case.get('difficulty') or {}).get('target')
        case['difficulty'] = {**difficulty.rate(case), 'target': target}
        json.dump(case, open(path, 'w'), indent=1)
    return os.path.relpath(path, ROOT), done, g['ok'], g['errors'][:2]


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    names = [a for a in args if a in steps()]
    files = [a for a in args if a not in names] or sorted(glob.glob(f'{ROOT}/dist/cases/generated/mk-*.json')
                                                          + glob.glob(f'{ROOT}/dist/cases/generated/live/mk-*.json'))
    if not names:
        sys.exit(__doc__)
    with cf.ProcessPoolExecutor(4) as ex:
        for path, done, ok, errs in ex.map(one, [(f, names, '--dry-run' in sys.argv) for f in files]):
            print(path, done, 'OK' if ok else f'NOT WRITTEN {errs}', flush=True)
    if not '--dry-run' in sys.argv:
        import difficulty
        difficulty.rate_all(log=lambda *a: None)
