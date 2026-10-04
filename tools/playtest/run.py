"""Run playtest episodes: agent players with profiles play cases through the text interface.

    .venv/bin/python tools/playtest/run.py --batch e0-train --split train --profiles beginner amateur pro --seeds 1
    .venv/bin/python tools/playtest/run.py --batch e0-train --resume        # finish a batch that stopped
    .venv/bin/python tools/playtest/run.py --batch e1-heldout --plan-from e0-heldout   # the same episodes, after a change

Each episode is written to tools/playtest/runs/<batch>/<case>__<profile>__<temperament>__s<seed>.json with the player's
steps (what it did, thought and saw), its diary and questionnaire, and the game's private trace. Episodes run in
parallel threads (each has its own game process). Needs the language-model proxy for the characters (port 8787).
"""
import argparse
import concurrent.futures as cf
import json
import os
import random
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from game import ROOT, GameClient  # noqa: E402
from llm import USAGE  # noqa: E402
from player import PROFILES, Player  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, 'runs')
SPLITS = json.load(open(os.path.join(HERE, 'cases.json')))


def episode_id(case, profile, temperament, seed):
    return f"{os.path.basename(case)[:-5]}__{profile}__{temperament}__s{seed}"


def play(case, profile, temperament, seed, budget):
    """One episode, start to finish. Returns the episode record (never raises: a failure is recorded)."""
    t0, steps, player = time.time(), [], Player(profile, temperament)
    with GameClient() as game:
        try:
            obs = game.new(os.path.join(ROOT, case), seed=seed, budget=budget)
            news, error, done = [], None, False
            while not done:
                action, thinking = player.step(obs, news, len(steps), error)
                r = game.act(action)
                news, error, obs, done = r['observation']['just_happened'], r.get('error'), r['observation'], r.get('done')
                learned = len(obs['inventory']) > (len(steps[-1]['inventory']) if steps else 0)
                player.remember(action, news, learned)
                steps.append({'action': action, 'thinking': thinking, 'error': error, 'news': news, 'inventory': [e['title'] for e in obs['inventory']],
                              'place': obs['place'], 'time': obs['time']})
            outcome = r.get('outcome')
            report = game.report()
            questionnaire = player.questionnaire({'outcome': outcome, 'last_lines': news[-4:]})
            failure = None
        except Exception:
            report, questionnaire, outcome, failure = None, None, 'failed', traceback.format_exc()[-1500:]
    return {'id': episode_id(case, profile, temperament, seed), 'case': case, 'profile': profile, 'temperament': temperament,
            'seed': seed, 'outcome': outcome, 'seconds': round(time.time() - t0), 'steps': steps, 'diary': player.diary,
            'questionnaire': questionnaire, 'report': report, 'failure': failure}


def plan(cases, profiles, seeds, rng):
    """Every case × profile × seed, each with a temperament drawn for variety (fixed by the seed)."""
    temperaments = sorted(PROFILES['temperaments'])
    return [(c, p, rng.choice(temperaments), s) for c in cases for p in profiles for s in range(1, seeds + 1)]


def main():
    a = argparse.ArgumentParser()
    a.add_argument('--batch', required=True)
    a.add_argument('--split', choices=sorted(k for k in SPLITS if not k.startswith('_')))
    a.add_argument('--cases', nargs='*')
    a.add_argument('--profiles', nargs='*', default=['beginner', 'amateur', 'pro'])
    a.add_argument('--seeds', type=int, default=1)
    a.add_argument('--parallel', type=int, default=6)
    a.add_argument('--actions', type=int, default=100)
    a.add_argument('--minutes', type=int, default=480)
    a.add_argument('--resume', action='store_true')
    a.add_argument('--plan-from', help='play exactly the episodes of an earlier batch (same cases, profiles, temperaments, seeds), for a paired comparison')
    args = a.parse_args()
    out = os.path.join(RUNS, args.batch)
    os.makedirs(out, exist_ok=True)
    meta_path = os.path.join(out, 'batch.json')
    if args.resume and os.path.exists(meta_path):
        meta = json.load(open(meta_path))
    elif args.plan_from:
        base = json.load(open(os.path.join(RUNS, args.plan_from, 'batch.json')))
        meta = {**base, 'batch': args.batch, 'paired_with': args.plan_from}
        json.dump(meta, open(meta_path, 'w'), indent=1)
    else:
        cases = args.cases or SPLITS[args.split]
        meta = {'batch': args.batch, 'split': args.split, 'budget': {'actions': args.actions, 'minutes': args.minutes},
                'episodes': plan(cases, args.profiles, args.seeds, random.Random(args.batch))}
        json.dump(meta, open(meta_path, 'w'), indent=1)
    todo = [e for e in meta['episodes'] if not os.path.exists(os.path.join(out, episode_id(*e) + '.json'))]
    print(f"{args.batch}: {len(todo)} of {len(meta['episodes'])} episodes to play", flush=True)
    with cf.ThreadPoolExecutor(args.parallel) as ex:
        futures = {ex.submit(play, *e, meta['budget']): e for e in todo}
        for f in cf.as_completed(futures):
            ep = f.result()
            json.dump(ep, open(os.path.join(out, ep['id'] + '.json'), 'w'), indent=1)
            print(f"  {ep['id']}: {ep['outcome']} in {len(ep['steps'])} actions, {ep['seconds']}s"
                  + (f" FAILED {ep['failure'].splitlines()[-1]}" if ep['failure'] else ''), flush=True)
    print(f"model calls (players): {USAGE}", flush=True)


if __name__ == '__main__':
    main()
