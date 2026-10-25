"""Bring a published live case up to the current publication checks, in place: judge its sightings and evening
accounts again, the doctor's accounts and the question aliases, then the strict whole-case review with its repair rounds. Writes only if the case then gates clean.

    python tools/refine-c/repair_live.py dist/cases/generated/live/<id>.json [--dry-run]
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import publish  # noqa: E402
import refine  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('case')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    case = json.load(open(args.case))
    t0 = time.time()
    target = (case.get('difficulty') or {}).get('target')
    with refine.effort('low'):
        publish.parallel_phases(case, [publish._sightings_and_contradictions, publish.add_surface_accounts, publish.add_medical], print)
        publish.mark_surface_truth(case)
    publish.mark_duplicate_questions(case)
    print(f'checks done in {time.time() - t0:.0f}s; reviewing')
    try:
        served, post = publish._review_gate_rate(case, difficulty_target=target, strict_publication_review=True)
    except ValueError as e:
        issues = publish.LAST_REVIEW_ISSUES.get((case.get('publication_review') or {}).get('candidate_sha256'), ())
        print('NOT CLEAN:', e, *issues, sep='\n  ')
        return 1
    print(f'clean in {time.time() - t0:.0f}s: {post["ok"]}')
    if not args.dry_run:
        publish._atomic_json(args.case, served)
        print('written', args.case)
        update_index(args.case, served, post)
    return 0


def update_index(path, case, post):
    """The index entry that lists this file gets the case's clue count and rating as they now are (the case first, its
    index entry last, as in publishing)."""
    import difficulty
    path = os.path.abspath(path)
    for idx in (os.path.join(os.path.dirname(path), 'index.json'), os.path.join(os.path.dirname(os.path.dirname(path)), 'index.json')):
        try:
            index = json.load(open(idx))
        except (OSError, ValueError):
            continue
        hit = [e for e in index if os.path.abspath(os.path.join(os.path.dirname(idx), e.get('file', ''))) == path]
        for e in hit:
            e['solveDepth'] = post['js']['solveDepth']
            e['blurb'] = (f"{case['synopsis']} Depth {post['js']['solveDepth']}, {len(case['signs'])} clues, "
                          f"{len(case['question']['candidates'])} suspects.")
            rating = difficulty.index_rating(case['difficulty'])
            e['difficulty'] = {k: v for k, v in rating.items() if k in e.get('difficulty', rating)}
        if hit:
            publish._atomic_json(idx, index)
            print('index updated', idx)
            return


if __name__ == '__main__':
    sys.exit(main())
