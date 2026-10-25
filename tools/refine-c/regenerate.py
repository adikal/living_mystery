#!/usr/bin/env python3
"""Generate a new case with the same premise and difficulty as a published one (the premise deck's who, how, why and
where, and the case's difficulty level), under the current generation and publication rules, and publish it to
dist/cases/generated/live/. Retries until a candidate passes every gate, including the strict whole-case review.

    .venv/bin/python tools/refine-c/regenerate.py dist/cases/archive/2026-10/mk-live-20261002-235614.json [--attempts 3]

Prints the published entry as JSON on the last line. Bedrock credentials come from the standard AWS chain.
"""
import argparse
import datetime
import json
import os
import re
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import difficulty  # noqa: E402
import premise as P  # noqa: E402
import publish  # noqa: E402
import refine  # noqa: E402
import timing  # noqa: E402

STEPS = int(os.environ.get('LM_GENERATOR_STEPS', '16'))
DEPTH = int(os.environ.get('LM_GENERATOR_DEPTH', '5'))


def regenerate(path, attempts=3, log=print):
    with open(path) as f:
        old = json.load(f)
    pr, level = old['premise'], (old.get('difficulty') or {}).get('level', 'medium')
    # the same targets, with more time: a case may not borrow depth from an arbitrary door any more, so reaching it takes
    # more refinement steps than the interactive generator allows (LM_REGEN_TIME_FACTOR, default 1)
    profile = difficulty.target(level)
    profile = {**profile, 'seconds': int(profile['seconds'] * float(os.environ.get('LM_REGEN_TIME_FACTOR', '1'))),
               'steps': profile['steps']}
    refine.FIXED = json.load(open(os.path.join(HERE, 'settings', 'bellweather.json')))
    for attempt in range(1, attempts + 1):
        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        outdir = os.path.join(HERE, 'runs', f'live-{stamp}')
        logf = open(os.path.join(HERE, 'runs', f'live-{stamp}.log'), 'a')
        line = lambda s: (logf.write(f'{datetime.datetime.now():%H:%M:%S} {s}\n'), logf.flush())
        log(f'[{old["id"]}] attempt {attempt}: {level}, {pr["culprit"]} kills {pr["victim"]} ({pr["method"]}, {pr["motive"]}) '
            f'at {pr["place"]}; log tools/refine-c/runs/live-{stamp}.log')
        started = time.time()
        try:
            refine._client = None
            limit = profile['seconds'] + 12 * 60
            result = refine.run_case('live', P.brief(pr), profile['steps'], DEPTH, outdir, line, premise=pr, profile=profile,
                                     should_stop=lambda: time.time() - started > limit)
            if not result.get('ok') or 'case' not in result:
                raise RuntimeError(result.get('reason') or 'the generated case did not certify')
            # publish only a case that reached its level's targets (depth, innocents, twist, herrings)
            lacking = difficulty.targets_met(result['case'], refine.certify(result['case']), profile)
            if lacking:
                raise RuntimeError(f'the case fell short of {level}: {lacking}')
            result['case']['difficulty_target'] = level
            # a model reply that fails while wording the case is not the case's fault: publish it once more first
            for tries in (1, 2):
                try:
                    with timing.phase('publish'):
                        entry, cert = publish.publish_live(result['case'], ('A new case', P.blurb(pr), pr['place'], P.brief(pr)), stamp,
                                                           strict_publication_review=True)
                    break
                except refine.LLMJSONResponseError as error:
                    if tries == 2:
                        raise
                    log(f'[{old["id"]}] publishing failed ({error}); trying once more')
            timing.save(outdir); line(timing.table())
            log(f'[{old["id"]}] published {entry["id"]} "{entry["title"]}" {entry.get("difficulty")} in {time.time() - started:.0f}s')
            return entry
        except Exception as error:
            line(traceback.format_exc())
            timing.save(outdir); line(timing.table())
            log(f'[{old["id"]}] attempt {attempt} failed after {time.time() - started:.0f}s: {type(error).__name__}: {str(error)[:400]}')
        finally:
            logf.close()
    raise SystemExit(f'{old["id"]}: no candidate passed in {attempts} attempts')


def publish_run(path, run_dir, log=print):
    """Publish a finished run's refined case (its final-case.json) for the same premise, when generation succeeded and
    only publishing failed (a model reply, the network): the refinement need not be repeated."""
    with open(path) as f:
        old = json.load(f)
    pr, level = old['premise'], (old.get('difficulty') or {}).get('level', 'medium')
    profile = difficulty.target(level)
    refine.FIXED = json.load(open(os.path.join(HERE, 'settings', 'bellweather.json')))
    with open(os.path.join(run_dir, 'final-case.json')) as f:
        case = json.load(f)
    lacking = difficulty.targets_met(case, refine.certify(case), profile)
    if lacking:
        raise SystemExit(f'{run_dir}: the case falls short of {level}: {lacking}')
    case['difficulty_target'] = level
    stamp = re.search(r'(\d{8}-\d{6})', os.path.basename(run_dir.rstrip('/'))).group(1)
    timing.reset()
    try:
        with timing.phase('publish'):
            entry, _ = publish.publish_live(case, ('A new case', P.blurb(pr), pr['place'], P.brief(pr)), stamp, strict_publication_review=True)
    finally:
        timing.save(os.path.join(run_dir, 'publish-timings')); log(timing.table())
    log(f'[{old["id"]}] published {entry["id"]} "{entry["title"]}" {entry.get("difficulty")} from {run_dir}')
    return entry


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('case')
    ap.add_argument('--attempts', type=int, default=3)
    ap.add_argument('--from-run', help='publish this finished run directory instead of generating')
    ap.add_argument('--from-kept', help='commit a reviewed candidate kept by a later gate (runs/scripted-rejected/<id>.json)')
    a = ap.parse_args()
    say = lambda s: print(s, flush=True)
    if a.from_kept:
        print(json.dumps(publish.publish_reviewed(json.load(open(a.from_kept)))[0]))
    else:
        print(json.dumps(publish_run(a.case, a.from_run, say) if a.from_run else regenerate(a.case, a.attempts, log=say)))
