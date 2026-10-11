"""Reword behaviour clues so a person's live manner carries no place, and mark it so the game can follow the person.

A behaviour sign about a person is one of two things: the person's own manner, which the detective sees by watching
them (a look, a gesture, something on them), or a reaction about them / an object they left behind. The first is seen
wherever the person is now, so its text must not pin them to a place and it is marked ``watch: true``; the second has
a fixed place and keeps it. A model makes the call and rewords the first kind; code sets the flag and leaves the rest.

    .venv/bin/python tools/refine-c/rewrite_behaviours.py FILE [FILE ...] [--write]
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

SYSTEM = """You edit one clue in a 1932 detective game. A clue of kind "behavior" is about a named person. Decide which
of two kinds it is:
- MANNER: the person's own bearing that a detective sees by watching them now — a look, a flush, a gesture, a hand kept
  in a pocket, a thing on their person (a stain on a cuff). The detective could notice it wherever the person is.
- FIXED: a reaction when the person is mentioned by someone else, or a thing they left behind (a trunk, a letter under
  a till, a padlocked gate, a locked drawer, a fire in a grate). It belongs to a place.

For a MANNER clue, rewrite its title and text so they describe only the bearing, naming NO room, counter, door, window,
desk or other place, and not implying the person is at any particular spot; keep the same observation, tone and any
clock time, and keep it to the original length. For a FIXED clue, leave the title and text unchanged.

Return {"kind": "manner"|"fixed", "title": "<title>", "text": "<text>"}: for FIXED, return the title and text verbatim."""

SCHEMA = {'type': 'object', 'required': ['kind', 'title', 'text'], 'properties': {
    'kind': {'type': 'string', 'enum': ['manner', 'fixed']}, 'title': {'type': 'string'}, 'text': {'type': 'string'}}}


def rewrite(case):
    """Returns (case, notes). Marks manner behaviours watch:true and rewords them; leaves the rest."""
    from refine import llm_json, CRITIC_MODEL
    victim = case.get('victim')
    people = {p['id']: p for p in case['people']}
    notes = []
    for x in case['signs']:
        if x.get('kind') != 'behavior' or not x.get('about') or x['about'] == victim or x['about'] not in people:
            continue
        who = people[x['about']]
        item = {'person': who.get('name'), 'role': who.get('role'), 'title': x.get('title', ''), 'text': x.get('text', '')}
        out = llm_json(SYSTEM, json.dumps(item), 700, model=CRITIC_MODEL, schema=SCHEMA)
        if out.get('kind') == 'manner' and out.get('text'):
            x['watch'] = True
            x['title'], x['text'] = out.get('title') or x['title'], out['text']
            notes.append(f"{x['id']}: watch (reworded place-free)")
        else:
            x.pop('watch', None)
    return case, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--write', action='store_true')
    o = ap.parse_args()
    for f in o.files:
        case, notes = rewrite(json.load(open(f)))
        print(f, '|', '; '.join(notes) or 'no manner behaviours')
        if o.write:
            json.dump(case, open(f, 'w'), indent=1, ensure_ascii=False)


if __name__ == '__main__':
    main()
