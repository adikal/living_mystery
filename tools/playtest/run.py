"""Run model-player playtest episodes through the text interface.

``--plan-from`` independently executes the exact immutable episode plan from an earlier batch.
Each run writes hash-only provenance and direct Bedrock request auditing (direct_requests.jsonl) below its ignored run
directory. The game's characters speak through the model proxy at LM_PROXY_URL (default http://127.0.0.1:8787/, a
loopback root URL); the harness does not write the proxy's request audit. To keep one, start the proxy with
LM_AUDIT_FILE=<run dir>/proxy_requests.jsonl; provenance records it as an operator-supplied artifact and whether it was
present when the arm finished.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import hashlib
import json
import os
import random
import subprocess
import sys
import time
import traceback
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from game import ROOT, GameClient  # noqa: E402
from judge import (AUDIT_NAME as DIRECT_AUDIT_NAME, BRIEF_RETRY as JUDGE_BRIEF_RETRY,  # noqa: E402
                   MAX_TOKENS as JUDGE_MAX_TOKENS, RUBRIC as JUDGE_RUBRIC, SCHEMA as JUDGE_SCHEMA,
                   TEMPERATURE as JUDGE_TEMPERATURE)
from llm import JUDGE_MODEL, PLAYER_MODEL, USAGE, audit_to, request_context  # noqa: E402
from player import (PLAYER_MAX_TOKENS, PLAYER_TEMPERATURE, PROFILES, QUESTIONNAIRE,  # noqa: E402
                    QUESTIONNAIRE_MAX_TOKENS, QUESTIONNAIRE_TEMPERATURE, SYSTEM, Player, profile_text)

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, 'runs')
SPLITS = json.load(open(os.path.join(HERE, 'cases.json')))
DEFAULT_PROXY_URL = 'http://127.0.0.1:8787/'
PROXY_AUDIT_NAME = 'proxy_requests.jsonl'
PROXY_AUDIT_PRODUCER = 'proxy LM_AUDIT_FILE (operator-configured)'


def proxy_url(value=None):
    """The model proxy the game's characters use: LM_PROXY_URL, a loopback HTTP root URL, with a trailing slash."""
    value = value if value is not None else os.environ.get('LM_PROXY_URL', DEFAULT_PROXY_URL)
    try:
        parsed = urlsplit(value)
        parsed.port   # raises for a malformed port
    except ValueError as exc:
        raise ValueError(f'LM_PROXY_URL is malformed: {value!r}') from exc
    if (parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1')
            or parsed.username is not None or parsed.password is not None
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise ValueError(f'LM_PROXY_URL must be a loopback http root URL such as {DEFAULT_PROXY_URL}: {value!r}')
    host = '[::1]' if parsed.hostname == '::1' else parsed.hostname
    return f'http://{host}:{parsed.port}/' if parsed.port is not None else f'http://{host}/'


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def sha256(value):
    if isinstance(value, Path):
        value = value.read_bytes()
    elif not isinstance(value, bytes):
        value = value.encode() if isinstance(value, str) else canonical(value).encode()
    return hashlib.sha256(value).hexdigest()


def repository_fingerprint():
    def git(*args, text=False):
        return subprocess.run(['git', *args], cwd=ROOT, check=True, capture_output=True, text=text).stdout
    revision = git('rev-parse', 'HEAD', text=True).strip()
    branch = git('branch', '--show-current', text=True).strip()
    status = git('status', '--porcelain=v1', '-z')
    tracked_diff = git('diff', '--binary', 'HEAD')
    names = git('ls-files', '--others', '--exclude-standard', '-z', text=True).split('\0')
    untracked = []
    for name in sorted(filter(None, names)):
        path = Path(ROOT) / name
        if path.is_file():
            untracked.append({'path': name, 'sha256': sha256(path), 'bytes': path.stat().st_size})
    dirty = {'status_sha256': sha256(status), 'tracked_diff_sha256': sha256(tracked_diff), 'untracked': untracked}
    return {'revision': revision, 'branch': branch, 'dirty': bool(status), **dirty,
            'worktree_sha256': sha256(dirty)}


def proxy_configuration(endpoint=None):
    """What the proxy at ``endpoint`` (default: proxy_url()) reports at /health: its routes, region and timeouts."""
    health = (endpoint or proxy_url()) + 'health'
    try:
        with urllib.request.urlopen(health, timeout=5) as response:
            return {'endpoint': health, 'available': True, **json.load(response)}
    except Exception as exc:
        return {'endpoint': health, 'available': False, 'error': f'{type(exc).__name__}: {exc}'}


def episode_id(case, profile, temperament, seed):
    return f"{os.path.basename(case)[:-5]}__{profile}__{temperament}__s{seed}"


def play(case, profile, temperament, seed, budget, audit_file=None, endpoint=None):
    """One episode, start to finish. A failure is retained as an episode record. Direct model calls are audited to
    ``audit_file``; the game's characters use the proxy at ``endpoint`` (default: proxy_url())."""
    identity = episode_id(case, profile, temperament, seed)
    t0, steps, player = time.time(), [], Player(profile, temperament)
    with request_context(episode_id=identity, case=case, profile=profile, temperament=temperament, seed=seed), \
            audit_to(audit_file):
        with GameClient() as game:
            try:
                obs = game.new(os.path.join(ROOT, case), seed=seed, budget=budget, endpoint=endpoint or proxy_url())
                news, error, done = [], None, False
                while not done:
                    action, thinking = player.step(obs, news, len(steps), error)
                    r = game.act(action)
                    news, error, obs, done = r['observation']['just_happened'], r.get('error'), r['observation'], r.get('done')
                    learned = len(obs['inventory']) > (len(steps[-1]['inventory']) if steps else 0)
                    player.remember(action, news, learned)
                    steps.append({'action': action, 'thinking': thinking, 'error': error, 'news': news,
                                  'inventory': [e['title'] for e in obs['inventory']], 'place': obs['place'], 'time': obs['time']})
                outcome = r.get('outcome')
                report = game.report()
                questionnaire = player.questionnaire({'outcome': outcome, 'last_lines': news[-4:]})
                failure = None
            except Exception:
                report, questionnaire, outcome, failure = None, None, 'failed', traceback.format_exc()[-1500:]
    return {'id': identity, 'case': case, 'profile': profile, 'temperament': temperament, 'seed': seed,
            'outcome': outcome, 'seconds': round(time.time() - t0), 'steps': steps, 'diary': player.diary,
            'questionnaire': questionnaire, 'report': report, 'failure': failure}


def plan(cases, profiles, seeds, rng):
    """Every case × profile × seed, each with a temperament drawn from the batch-name RNG."""
    temperaments = sorted(PROFILES['temperaments'])
    return [(c, p, rng.choice(temperaments), s) for c in cases for p in profiles for s in range(1, seeds + 1)]


def inference(max_tokens, temperature):
    return {'maxTokens': max_tokens, 'temperature': 'omitted/provider-default' if temperature is None else temperature}


def model_configuration(episodes, endpoint=None):
    rendered = sorted({(p, t, sha256(SYSTEM.format(profile=profile_text(p, t)))) for _, p, t, _ in episodes})
    return {
        'direct_routes': {'player': PLAYER_MODEL, 'questionnaire': PLAYER_MODEL, 'judge': JUDGE_MODEL},
        'direct_inference': {
            'player': inference(PLAYER_MAX_TOKENS, PLAYER_TEMPERATURE),
            'questionnaire': inference(QUESTIONNAIRE_MAX_TOKENS, QUESTIONNAIRE_TEMPERATURE),
            'judge': inference(JUDGE_MAX_TOKENS, JUDGE_TEMPERATURE),
        },
        'prompt_hashes': {'player_template_sha256': sha256(SYSTEM), 'questionnaire_sha256': sha256(QUESTIONNAIRE),
                          'judge_system_sha256': [sha256(JUDGE_RUBRIC), sha256(JUDGE_RUBRIC + JUDGE_BRIEF_RETRY)],
                          'judge_schema_sha256': sha256(JUDGE_SCHEMA),
                          'rendered_player_systems': [{'profile': p, 'temperament': t, 'sha256': h} for p, t, h in rendered]},
        'profiles_sha256': sha256(Path(HERE) / 'profiles.json'),
        'proxy': proxy_configuration(endpoint),
    }


def case_records(episodes):
    return [{'path': case, 'raw_sha256': sha256(Path(ROOT) / case)} for case in sorted({row[0] for row in episodes})]


def write_json(path, value):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    os.replace(temp, path)


def outcome_key(outcome):
    """An outcome as a JSON object key; an episode that ended without one counts as 'null'."""
    return 'null' if outcome is None else str(outcome)


def summarise(records):
    """The completed arm's outcome counts, failures and right-censored episodes."""
    outcomes = [ep.get('outcome') for ep in records]
    return {'outcomes': {outcome_key(name): outcomes.count(name)
                         for name in sorted(set(outcomes), key=lambda v: (v is None, str(v)))},
            'failures': [{'id': ep['id'], 'failure': ep['failure']} for ep in records if ep.get('failure')],
            'right_censored': sum(name in ('out_of_budget', 'quit') for name in outcomes)}


def repository_end(started_fingerprint):
    """The repository at the end of an arm, and whether it is unchanged; a fingerprint failure is recorded, not raised,
    so the arm still reaches a terminal status."""
    try:
        end = repository_fingerprint()
    except Exception as exc:
        return {'repository_at_end': {'error': type(exc).__name__}, 'repository_unchanged_during_arm': False}
    return {'repository_at_end': end,
            'repository_unchanged_during_arm': end['worktree_sha256'] == started_fingerprint['worktree_sha256']}


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
    a.add_argument('--plan-from', help='play exactly the episodes of an earlier batch')
    a.add_argument('--comparison-registration', type=Path,
                   help='frozen JSON registration for a gate-eligible paired comparison')
    a.add_argument('--registered-arm', choices=('A', 'B'), help='this batch arm in the comparison registration')
    args = a.parse_args()
    try:
        endpoint = proxy_url()
    except ValueError as exc:
        a.error(str(exc))
    if bool(args.comparison_registration) != bool(args.registered_arm):
        a.error('--comparison-registration and --registered-arm must be supplied together')
    if args.plan_from and not args.comparison_registration:
        a.error('--plan-from requires --comparison-registration and --registered-arm; historical output is descriptive only')

    registration, comparison = None, None
    if args.comparison_registration:
        registration = json.loads(args.comparison_registration.read_text(encoding='utf-8'))
        field = 'arm_a_batch' if args.registered_arm == 'A' else 'arm_b_batch'
        other = 'arm_b_batch' if args.registered_arm == 'A' else 'arm_a_batch'
        if registration.get('registered_before_model_calls') is not True or registration.get(field) != args.batch:
            a.error(f'batch {args.batch!r} is not preregistered as Arm {args.registered_arm}')
        if args.registered_arm == 'A' and args.plan_from:
            a.error('registered Arm A must be independently planned, not created with --plan-from')
        if args.registered_arm == 'B' and args.plan_from != registration.get('arm_a_batch'):
            a.error('registered Arm B --plan-from must name registered Arm A')
        comparison = {'registration_sha256': sha256(args.comparison_registration),
                      'registered_arm': args.registered_arm, 'comparator_batch': registration.get(other)}

    out = Path(RUNS) / args.batch
    meta_path = out / 'batch.json'
    if out.exists() and any(out.iterdir()) and not args.resume:
        a.error(f'batch directory already exists and is not empty: {out}')
    out.mkdir(parents=True, exist_ok=True)
    if args.resume and meta_path.exists():
        meta = json.loads(meta_path.read_text())
    elif args.plan_from:
        base_path = Path(RUNS) / args.plan_from / 'batch.json'
        if not base_path.exists():
            a.error(f'base batch does not exist: {base_path}')
        base = json.loads(base_path.read_text())
        meta = {**base, 'batch': args.batch, 'paired_with': args.plan_from}
        meta.pop('comparison', None)
    else:
        if bool(args.cases) == bool(args.split):
            a.error('choose exactly one of --cases or --split')
        cases = args.cases or SPLITS[args.split]
        meta = {'batch': args.batch, 'split': args.split, 'budget': {'actions': args.actions, 'minutes': args.minutes},
                'episodes': plan(cases, args.profiles, args.seeds, random.Random(args.batch))}
    if comparison:
        if meta.get('comparison') not in (None, comparison):
            a.error('resumed batch comparison declaration differs from the requested registration')
        if meta.get('episodes') != registration.get('episodes') or meta.get('budget') != registration.get('budget'):
            a.error('batch plan or budget differs from the frozen comparison registration')
        meta['comparison'] = comparison
    write_json(meta_path, meta)
    if len({episode_id(*row) for row in meta['episodes']}) != len(meta['episodes']):
        raise ValueError('episode plan contains duplicate pair identities')

    audit_path = out / DIRECT_AUDIT_NAME
    proxy_audit_path = out / PROXY_AUDIT_NAME
    current_fingerprint = repository_fingerprint()
    configuration = model_configuration(meta['episodes'], endpoint)
    cases = case_records(meta['episodes'])
    plan_hash = sha256({'budget': meta['budget'], 'episodes': meta['episodes']})
    provenance_path = out / 'provenance.json'
    prior = json.loads(provenance_path.read_text()) if args.resume and provenance_path.exists() else None
    if prior:
        immutable = {'batch': args.batch, 'paired_with': meta.get('paired_with'), 'comparison': comparison,
                     'plan_sha256': plan_hash, 'budget': meta['budget'], 'episodes': meta['episodes'],
                     'models_and_prompts': configuration, 'cases': cases}
        if any(prior.get(key) != value for key, value in immutable.items()):
            a.error('resumed batch provenance differs from the current plan, registration, cases, or model configuration')
        started_fingerprint = prior.get('repository_at_start')
        if not isinstance(started_fingerprint, dict) or any(
                started_fingerprint.get(key) != current_fingerprint.get(key)
                for key in ('revision', 'branch', 'worktree_sha256')):
            a.error('repository/worktree changed since this arm started; resume would invalidate the comparison')
        started_at = prior.get('started_at')
    else:
        started_fingerprint, started_at = current_fingerprint, utc_now()
    provenance = {
        'schema_version': 'e6-aa-arm-v1', 'batch': args.batch, 'paired_with': meta.get('paired_with'),
        'comparison': comparison, 'started_at': started_at, 'status': 'running', 'plan_sha256': plan_hash,
        'budget': meta['budget'], 'planned_episodes': len(meta['episodes']), 'episodes': meta['episodes'],
        'repository_at_start': started_fingerprint, 'models_and_prompts': configuration,
        'cases': cases, 'direct_request_audit': audit_path.name,
        # written by the proxy, not by this harness, and only if the operator pointed its LM_AUDIT_FILE here
        'proxy_request_audit': {'path': str(proxy_audit_path), 'producer': PROXY_AUDIT_PRODUCER,
                                'present': proxy_audit_path.is_file()},
    }
    write_json(provenance_path, provenance)
    todo = [e for e in meta['episodes'] if not (out / (episode_id(*e) + '.json')).exists()]
    print(f"{args.batch}: {len(todo)} of {len(meta['episodes'])} episodes to play", flush=True)

    status, summary = 'running', {}
    try:
        try:
            with cf.ThreadPoolExecutor(args.parallel) as ex:
                futures = {ex.submit(play, *e, meta['budget'], audit_file=audit_path, endpoint=endpoint): e
                           for e in todo}
                for f in cf.as_completed(futures):
                    ep = f.result()
                    write_json(out / (ep['id'] + '.json'), ep)
                    print(f"  {ep['id']}: {ep['outcome']} in {len(ep['steps'])} actions, {ep['seconds']}s"
                          + (f" FAILED {ep['failure'].splitlines()[-1]}" if ep['failure'] else ''), flush=True)
        except BaseException:
            status = 'aborted'
            early = ((registration or {}).get('early_stops') or {}).get(args.registered_arm)
            present = {episode_id(*row) for row in meta['episodes'] if (out / (episode_id(*row) + '.json')).exists()}
            if early and present == set(early.get('expected_episode_ids') or ()):
                status = 'early_stopped'
                provenance['early_stop_registration_sha256'] = sha256(early)
            raise
        try:
            records = [json.loads((out / (episode_id(*row) + '.json')).read_text()) for row in meta['episodes']]
            summary = {**summarise(records), 'direct_usage': USAGE}
        except BaseException as exc:
            status, summary = 'failed', {'failure_stage': 'summary', 'failure_type': type(exc).__name__}
            raise
        status = 'completed'
    finally:
        # every exit, including a failure while summarising, leaves a terminal status
        provenance.update({'finished_at': utc_now(), 'status': status, **repository_end(started_fingerprint), **summary})
        provenance['proxy_request_audit']['present'] = proxy_audit_path.is_file()
        write_json(provenance_path, provenance)
    print(f"model calls (players): {USAGE}", flush=True)


if __name__ == '__main__':
    main()
