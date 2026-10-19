"""The judge: a separate model reads an episode (the transcript, the player's diary and questionnaire, the objective
metrics, and the case's solution) and scores the experience against fixed rubrics, citing evidence. It also lists
problems with the step, a quote, and the layer it most likely comes from. The player never grades itself.

    .venv/bin/python tools/playtest/judge.py tools/playtest/runs/<batch> [--parallel 6]
"""
import argparse
import concurrent.futures as cf
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from game import ROOT  # noqa: E402
from llm import JUDGE_MODEL, USAGE, call_json, request_context  # noqa: E402

DIMENSIONS = ['challenge', 'frustration', 'confusion', 'character_quality', 'fairness', 'liveliness', 'fun']
LAYERS = ['generation', 'publishing', 'dialogue', 'director', 'hints', 'interface', 'engine', 'player']
SCHEMA = {'type': 'object', 'required': ['scores', 'problems', 'summary'], 'properties': {
    'scores': {'type': 'object', 'required': DIMENSIONS, 'properties': {d: {'type': 'object', 'required': ['score', 'reason'],
               'properties': {'score': {'type': 'integer', 'minimum': 1, 'maximum': 7}, 'reason': {'type': 'string'}}} for d in DIMENSIONS}},
    'problems': {'type': 'array', 'items': {'type': 'object', 'required': ['kind', 'layer', 'severity', 'why'], 'properties': {
        'kind': {'type': 'string'}, 'step': {'type': ['integer', 'null']}, 'quote': {'type': 'string'}, 'layer': {'type': 'string', 'enum': LAYERS},
        'severity': {'type': 'integer', 'minimum': 1, 'maximum': 3}, 'why': {'type': 'string'}}}},
    'summary': {'type': 'string'}}}

RUBRIC = """You judge one play-through of a text detective game, for the people who make the game. You get the case's
solution (the player did not), the transcript (the player's actions and what the game showed), the player's diary and
end-of-game questionnaire, and objective metrics computed from the game's records.

Score each dimension from 1 to 7 and give a one-sentence reason citing the transcript:
- challenge: 1 = trivial (solved without thinking), 4 = about right for this player, 7 = impossible for them.
- frustration: 1 = never stuck, 7 = stuck most of the time with no idea what to do.
- confusion: 1 = everything made sense, 7 = characters or clues often made no sense, contradicted each other, or ignored
  the question.
- character_quality: 1 = wooden, evasive for no reason, or inconsistent; 7 = distinct, believable people who react
  sensibly to what the detective says and shows.
- fairness: 1 = the answer could not be worked out from what the player saw; 7 = every step was earned from clues.
- liveliness: 1 = a static world; 7 = people visibly go about their own business and react to the investigation.
- fun: 1 = tedious; 7 = engaging throughout (curiosity, surprise, satisfying deductions).
Judge from the transcript, not from the player's ratings alone; where they disagree, say so.
An episode may stop at a fixed number of actions: that is the test harness, not the game; do not count it against
the game or list it as a problem.

Then list problems for the makers: each with "kind" (one of: stuck, confusing_reply, contradiction, stonewall,
unfair_clue, too_easy, repetitive, dull, broken, other), "step" (the step number in the transcript, or null),
"quote" (the exact words from the transcript that show it), "layer" (where the cause most likely lies: generation =
how the case was built; publishing = how clues and accounts are worded; dialogue = how characters answer; director =
what characters do on their own; hints; interface = what the game shows or allows; engine; player = the player's own
mistake), "severity" (1 minor, 2 noticeable, 3 spoils the game), and "why" (one sentence). Only real problems.

Return {"scores": {"<dimension>": {"score": n, "reason": "..."}}, "problems": [...], "summary": "<two sentences>"}."""
BRIEF_RETRY = '\n\nKeep it brief: at most 8 problems, one sentence each.'
MAX_TOKENS = 8000
TEMPERATURE = None    # this model takes no temperature: the provider default applies
AUDIT_NAME = 'direct_requests.jsonl'   # the batch's direct request audit, shared with run.py


def transcript(ep, limit=9000):
    lines = []
    for i, s in enumerate(ep['steps']):
        a = s['action'] or {}
        act = {'say': lambda: f"says to {a.get('person')}: “{a.get('text')}”", 'ask': lambda: f"asks {a.get('person')} ({a.get('question')})",
               'show': lambda: f"shows {a.get('person')} {a.get('item')}", 'move': lambda: f"goes to {a.get('to')}"}.get(a.get('type'), lambda: json.dumps(a))()
        lines.append(f"[{i}] {s['time']} YOU {act}" + (f"  (refused: {s['error']})" if s.get('error') else ''))
        lines += [f"     {n.get('speaker') + ': ' if n.get('speaker') else ''}{n['text'][:300]}" for n in s['news']]
    text = '\n'.join(lines)
    return text if len(text) <= limit else text[:limit // 3] + '\n…\n' + text[-2 * limit // 3:]


def solution(case_file):
    kc = json.load(open(os.path.join(ROOT, case_file)))
    truth = next(h for h in kc['question']['candidates'] if h['id'] == kc['question']['truth'])['facts']['actor']
    names = {p['id']: p.get('name', p['id']) for p in kc['people']}
    return {'title': kc.get('title'), 'culprit': names.get(truth, truth), 'method': (kc.get('answer') or {}).get('method'),
            'motive': (kc.get('answer') or {}).get('motive'), 'synopsis': kc.get('synopsis'),
            'crime': next((e.get('summary') for e in kc['events'] if e['id'] == kc['question']['crime']['event']), None)}


def normal(v):
    """A score as {score, reason}, whether the model gave an object, a number or a numeric string."""
    if isinstance(v, dict):
        v = {'score': v.get('score'), 'reason': v.get('reason')}
    else:
        v = {'score': v, 'reason': None}
    try:
        v['score'] = float(v['score'])
    except (TypeError, ValueError):
        v['score'] = None
    return v


def judge(ep, card, audit_file=None):
    user = json.dumps({'solution': solution(ep['case']), 'player': {'profile': ep['profile'], 'temperament': ep['temperament']},
                       'outcome': ep['outcome'], 'metrics': card.get('metrics'), 'diary': ep['diary'],
                       'questionnaire': ep['questionnaire'], 'transcript': transcript(ep)})
    for attempt in range(2):          # an answer cut short (too many problems listed) is asked for again, briefer
        with request_context(episode_id=ep['id'], case=ep['case'], profile=ep['profile'],
                             temperament=ep['temperament'], seed=ep['seed']):
            out = call_json(RUBRIC + ('' if not attempt else BRIEF_RETRY), user, JUDGE_MODEL, max_tokens=MAX_TOKENS,
                            temperature=TEMPERATURE, schema=SCHEMA, role='judge', audit_file=audit_file)
        raw = out.get('scores') if isinstance(out.get('scores'), dict) else {}
        scores = {d: normal(raw.get(d)) for d in DIMENSIONS}
        if all(v['score'] is not None for v in scores.values()):
            break
    probs = [p for p in out.get('problems') or [] if isinstance(p, dict) and p.get('layer') in LAYERS]
    return {'id': ep['id'], 'scores': scores, 'problems': probs, 'summary': out.get('summary')}


def judge_batch(folder, parallel=6):
    audit_file = os.path.join(folder, AUDIT_NAME)
    cards = {c['id']: c for c in json.load(open(os.path.join(folder, 'scores.json')))}
    eps = [json.load(open(os.path.join(folder, f))) for f in sorted(os.listdir(folder)) if '__' in f and f.endswith('.json')]
    eps = [e for e in eps if not e.get('failure')]
    with cf.ThreadPoolExecutor(parallel) as ex:
        verdicts = list(ex.map(lambda e: judge(e, cards[e['id']], audit_file), eps))
    json.dump(verdicts, open(os.path.join(folder, 'judged.json'), 'w'), indent=1)
    return verdicts


if __name__ == '__main__':
    a = argparse.ArgumentParser()
    a.add_argument('folder')
    a.add_argument('--parallel', type=int, default=6)
    args = a.parse_args()
    for v in judge_batch(args.folder, args.parallel):
        print(v['id'], {d: (s or {}).get('score') for d, s in v['scores'].items()}, len(v['problems']), 'problems')
    print('model calls (judge):', USAGE)
