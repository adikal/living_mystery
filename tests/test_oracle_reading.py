"""The Z3 oracle counts held evidence only once it can be read (as the game's kernel does)."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))
import case_oracle  # noqa: E402


def load():
    with open(os.path.join(ROOT, 'dist', 'cases', 'archive', '2026-10', 'mk-live-20261002-224855.json')) as f:
        return json.load(f)


def test_a_clue_whose_needs_are_missing_is_not_read():
    case = load()
    x = next(s for s in case['signs'] if s.get('needs') and all(n in {y['id'] for y in case['signs']} for n in s['needs']))
    assert x['id'] not in case_oracle.understood(case, [x['id']])
    signs = {y['id']: y for y in case['signs']}
    held, todo = {x['id']}, list(x['needs'])
    while todo:                       # everything it needs, and what those need
        n = todo.pop()
        if n in signs and n not in held:
            held.add(n); todo.extend(signs[n].get('needs') or [])
    assert x['id'] in case_oracle.understood(case, held)


def test_publish_gate_unchanged():
    assert case_oracle.check_case(load())['ok']
