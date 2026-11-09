"""Bring a published case up to the current publication checks, in place: judge its sightings, evening and morning
accounts again, the doctor's accounts, the detective's lines and the question aliases, then the strict whole-case review
with its repair rounds. The history is untouched; sightings may be added or dropped (they are evidence, certified like
any account). Writes only if the case then gates clean.

    python tools/refine-c/repair_live.py dist/cases/generated/live/<id>.json [--dry-run] [--wording-only]

--wording-only is for a case published before the whole-case review (it carries no review certificate): the same
checks bring its wording up to date (its evening and morning accounts, the doctor's, the reactions, the last-resort lines and the detective's lines; not the
sightings, which are evidence), and it is written only if it keeps the same accounts and certifies exactly as before (the
same solve, depths and verdicts), without the review. What the review would still find is printed, never hidden, and no certificate is added.
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
    ap.add_argument('--wording-only', action='store_true')
    args = ap.parse_args()
    case = json.load(open(args.case))
    before = certification(case) if args.wording_only else None
    ids = [x['id'] for x in case['signs']]
    records = evidence_records(case)
    t0 = time.time()
    target = (case.get('difficulty') or {}).get('target')
    with refine.effort('low'):
        # sightings add accounts and record contradictions: the case's evidence, not its wording
        sightings = [] if args.wording_only else [publish._sightings_and_contradictions]
        # an account that fails its checks is written again, and dropped only after the last round: a published case
        # keeps its accounts, so it gets more rounds than a new one
        rounds = 4 if args.wording_only else 2
        def add_surface_accounts(c):
            return publish.add_surface_accounts(c, rounds=rounds)
        publish.parallel_phases(case, [*sightings, add_surface_accounts, publish.add_morning_accounts, publish.add_medical,
                                       publish.add_fallback_lines], print)
        publish.remove_promises(case)                  # no account offers what the case never gives
        publish.mark_surface_truth(case)
        publish.add_reactions(case)                    # reactions judged under the current check; those dropped written again
        publish.add_show_lines(case)                   # lines for any account written again
        publish.finish_wording(case)                   # every line checked under the current line check
    publish.mark_duplicate_questions(case)
    print(f'checks done in {time.time() - t0:.0f}s; reviewing')
    if args.wording_only:
        if case.get('publication_review'):
            print('NOT WRITTEN: the case carries a review certificate; repair it with the review')
            return 1
        after = certification(case)
        if sorted(x['id'] for x in case['signs']) != sorted(ids):
            print('NOT WRITTEN: the repair changed which accounts the case has:',
                  sorted(set(ids) ^ {x['id'] for x in case['signs']}))
            return 1
        changed = sorted(i for i in records if evidence_records(case).get(i) != records[i])
        if changed:
            print('NOT WRITTEN: the repair changed what these accounts claim or rest on:', changed)
            return 1
        if after != before:
            diff = {k: {'before': before.get(k), 'after': after.get(k)} for k in sorted(set(before) | set(after)) if before.get(k) != after.get(k)}
            print('NOT WRITTEN: the wording changed how the case certifies:', json.dumps(diff))
            return 1
        served, _ = publish._serialized_case(case)
        print(f'wording up to date in {time.time() - t0:.0f}s; certifies as before: {after}')
        if not args.dry_run:
            publish._atomic_json(args.case, served)
            print('written', args.case)
        return 0
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


def evidence_records(case):
    """What each sign is as evidence: its claim, what it requires and needs, its source, what it defeats."""
    return {x['id']: json.dumps({k: x.get(k) for k in ('claim', 'requires', 'needs', 'source', 'defeats')}, sort_keys=True)
            for x in case['signs']}


def certification(case):
    """What the deterministic gate concludes about a case, without timings: whether it certifies, its solve and depth."""
    g = publish.gate(json.loads(json.dumps(case, ensure_ascii=False)))
    js = {k: v for k, v in (g.get('js') or {}).items() if k != 'file'}
    return {'ok': g['ok'], 'errors': g.get('errors', []), 'z3': (g.get('z3') or {}).get('ok'), **js}


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
