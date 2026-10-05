"""The correctness judge: a model reads one recorded game in full (the transcript, what the game did inside each
character turn, and the case's true records) and lists only what contradicts the history or the game's own rules. It
does not score the experience (judge.py does); its findings feed the bug track.

    .venv/bin/python tools/playtest/correctness.py tools/playtest/runs/<batch> [--cases-dir DIR] [--parallel 6]

--cases-dir is a copy of the case files as they were when the batch was played (default: the current files).
Writes <batch>/correctness.json.
"""
import argparse
import concurrent.futures as cf
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'refine-c'))
from game import ROOT  # noqa: E402
from llm import JUDGE_MODEL, call_json  # noqa: E402
from refine import analyse  # noqa: E402

CATEGORIES = ['history_contradiction', 'unfair_refusal', 'hint_wrong', 'secret_leak', 'wrong_reason', 'identity',
              'game_rule', 'other']
RULES = """The game's rules, which the game is meant to keep:
1. The case's records are the true history. A character may lie or be mistaken only where the records give that account
   as deceptive or mistaken; anything else a character states must agree with the history and with what they could know.
2. A character's own secrets (their attitudes and private actions) are not revealed, even by hints in passing, until
   evidence or a recorded account brings them out.
3. When evidence clears an innocent person's suspicious behaviour, the reason they give is the one the history records
   for that behaviour.
4. People are named and addressed as the setting names them, with their own pronouns and roles.
5. A hint leads to the clue it points at: doing what it says gives that clue.
6. The constable accepts a charge the evidence held supports, and a refusal says truly why; evidence the player can see
   contradicting an account counts against that account.
7. A character may tell only what their accounts give, what the detective or the conversation has already said, and
   their own feelings; a true fact outside those is withheld on purpose (it could solve the case early). So the game's
   checks may refuse any reply that adds a fact. A refusal is a fault only when the refused reply added nothing: the
   same fact or time in other words, a correct name for someone already in play, or a plain refusal.
8. Everything shown to the player is consistent with everything shown before."""
RUBRIC = """You audit one recorded play-through of a text detective game for its makers. You get the case's true records
(events, attitudes, and every sign with whether its claim is true), the transcript with step numbers, and for each
character turn what happened inside the game: whether the reply came from the model or a fallback, the account used,
and why earlier attempts were refused.

""" + RULES + """

List every place where the game broke one of these rules. Not problems of taste, pacing or difficulty; not the player's
own mistakes; not lies or mistakes the records give as deceptive or mistaken. For each: "step" (the transcript step),
"quote" (the exact words shown), "category" (one of: """ + ', '.join(CATEGORIES) + """), "rule" (its number),
"record" (the id of the record it contradicts, or null), "person" (the id of the person concerned, or null), "severity"
(1 minor, 2 noticeable, 3 misleads the player or blocks the case) and "why" (one sentence, citing the record).
Return {"issues": [...]}; an empty list if the game kept every rule."""
SCHEMA = {'type': 'object', 'required': ['issues'], 'properties': {'issues': {'type': 'array', 'items': {
    'type': 'object', 'required': ['step', 'quote', 'category', 'rule', 'severity', 'why'], 'properties': {
        'step': {'type': ['integer', 'null']}, 'quote': {'type': 'string'}, 'category': {'type': 'string', 'enum': CATEGORIES},
        'rule': {'type': 'integer'}, 'record': {'type': ['string', 'null']}, 'person': {'type': ['string', 'null']},
        'severity': {'type': 'integer', 'minimum': 1, 'maximum': 3}, 'why': {'type': 'string'}}}}}}


def case_as_played(rel, cases_dir):
    old = os.path.join(cases_dir, rel.replace('dist/cases/generated/', '')) if cases_dir else None
    return json.load(open(old if old and os.path.exists(old) else os.path.join(ROOT, rel)))


def records(kc):
    """The true history, compactly: events, attitudes and signs with the truth of each claim."""
    A = analyse(kc)
    keep = ('id', 'kind', 'speaker', 'about', 'at', 'title', 'text', 'claim', 'requires', 'defeats', 'deceptive', 'mistaken', 'because')
    return {'people': [{k: p.get(k) for k in ('id', 'name')} for p in kc['people']], 'victim': kc.get('victim'),
            'answer': kc.get('answer'), 'truth': kc['question']['truth'],
            'events': [{k: e.get(k) for k in ('id', 'agent', 'others', 'place', 'start', 'end', 'summary', 'causedBy') if e.get(k) is not None}
                       for e in kc['events']],
            'attitudes': kc.get('attitudes', []),
            'signs': [{**{k: x[k] for k in keep if x.get(k) not in (None, [], '')}, **({'claim_true': A['truthval'][x['id']]} if x['id'] in A['truthval'] else {})}
                      for x in kc['signs']]}


def transcript(ep, limit=60000):
    lines = []
    for i, (s, t) in enumerate(zip(ep['steps'], ep['report']['trace'])):
        a = s['action'] or {}
        lines.append(f"[{i}] {s['time']} DETECTIVE {json.dumps(a)}" + (f"  (refused: {s['error']})" if s.get('error') else ''))
        lines += [f"     {n.get('speaker') + ': ' if n.get('speaker') else ''}{n['text']}" for n in s['news']]
        c = t.get('character')
        if c:
            lines.append(f"     [game: reply by {c['by']}; account {c.get('account')}; intent {c.get('intent')}"
                         + (f"; refused attempts: {' | '.join(r[:160] for r in c.get('reasons') or [])}" if c.get('reasons') else '') + ']')
        if t.get('accusation'):
            lines.append(f"     [game: charge {t['accusation']}]")
    text = '\n'.join(lines)
    return text if len(text) <= limit else text[:limit // 2] + '\n…\n' + text[-limit // 2:]


def audit(ep, cases_dir):
    kc = case_as_played(ep['case'], cases_dir)
    user = json.dumps({'records': records(kc)}) + '\n\nTRANSCRIPT\n' + transcript(ep)
    out = call_json(RUBRIC, user, JUDGE_MODEL, max_tokens=8000, schema=SCHEMA)
    issues = [x for x in out.get('issues') or [] if isinstance(x, dict) and x.get('category') in CATEGORIES]
    return {'id': ep['id'], 'case': kc['id'], 'title': kc['title'], 'issues': issues}


def main():
    a = argparse.ArgumentParser()
    a.add_argument('batch')
    a.add_argument('--cases-dir')
    a.add_argument('--parallel', type=int, default=6)
    args = a.parse_args()
    eps = [json.load(open(os.path.join(args.batch, f))) for f in sorted(os.listdir(args.batch)) if '__' in f and f.endswith('.json')]
    with cf.ThreadPoolExecutor(args.parallel) as pool:
        results = list(pool.map(lambda ep: audit(ep, args.cases_dir), eps))
    json.dump(results, open(os.path.join(args.batch, 'correctness.json'), 'w'), indent=1)
    print(args.batch, sum(len(r['issues']) for r in results), 'issues in', len(results), 'games')


if __name__ == '__main__':
    main()
