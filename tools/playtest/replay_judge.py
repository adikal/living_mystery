"""Judge the replies a replay accepted: does a reply state a fact that the character's accounts do not give?

The game's own fact-checker decides, during play, whether a reply may be spoken. This judge reads the same inputs (the
character's accounts, the detective's words, the reply) with a separate, stronger model, so that two replays, for
example one with a local model as the fact-checker and one with Bedrock, are scored by the same standard.

    .venv/bin/python tools/playtest/replay_judge.py /tmp/replay-A.json [/tmp/replay-B.json ...] [--parallel 8]

Adds a 'judged' entry to each accepted row and a 'judged' summary, written back to each file.
"""
import argparse
import concurrent.futures as cf
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from llm import JUDGE_MODEL, call_json  # noqa: E402

SYSTEM = """You audit one line of dialogue in a detective game. A character may state only facts that their accounts
give, that the detective's own words already contain, or that everyone in the village knows (who each person is: their
name, form of address and role, listed under 'village'); they may add feelings, opinions, manner and in-character
colour (weather, tea, complaints) freely. A deceptive account is the character's lie, and repeating it is allowed.

List each factual detail in the reply (a person's presence or action, a place, a time, an object, a relationship, an
event) that is NOT given by the accounts or the detective's words, and each that CONTRADICTS them. Do not list
paraphrases, vaguer restatements, refusals, or names used correctly for people already mentioned. Be strict but fair:
if a detail is a plain rewording of an account, it is not a finding."""

SCHEMA = {'type': 'object', 'properties': {
    'findings': {'type': 'array', 'items': {'type': 'object', 'properties': {
        'kind': {'type': 'string', 'enum': ['invented', 'contradicts']},
        'detail': {'type': 'string'}}, 'required': ['kind', 'detail']}}},
    'required': ['findings']}


def judge(row):
    user = json.dumps({'village': row['village'], 'character': row['speaker'], 'detective_said': row['text'],
                       'accounts': row['allowed'],
                       'reply': row['reply']}, ensure_ascii=False)
    return call_json(SYSTEM, user, JUDGE_MODEL, max_tokens=800, schema=SCHEMA)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--parallel', type=int, default=8)
    o = ap.parse_args()
    for f in o.files:
        d = json.load(open(f))
        rows = [r for r in d['results'] if r.get('outcome') == 'ai' and r.get('reply') and r.get('allowed') is not None]
        with cf.ThreadPoolExecutor(o.parallel) as ex:
            for r, verdict in zip(rows, ex.map(judge, rows)):
                r['judged'] = verdict.get('findings', [])
        flagged = [r for r in rows if r['judged']]
        d['summary']['judged'] = {'accepted': len(rows), 'with_findings': len(flagged),
                                  'invented': sum(x['kind'] == 'invented' for r in rows for x in r['judged']),
                                  'contradicts': sum(x['kind'] == 'contradicts' for r in rows for x in r['judged'])}
        json.dump(d, open(f, 'w'), indent=1)
        print(f, json.dumps(d['summary']['judged']))


if __name__ == '__main__':
    main()
