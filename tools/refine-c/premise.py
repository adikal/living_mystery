"""The premise deck: code, not the model, decides who dies, who did it, why, how and where; the model writes the story.

draw() picks a premise that differs from recent ones (a history file in runs/ remembers the last cases), brief()
turns it into the generator's brief, and seed_errors() checks the seed honours it, so the model cannot swap in
its favourite story (the solicitor, the embezzlement, the candlestick).
"""
import json
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
SETTING = json.load(open(os.path.join(HERE, 'settings', 'bellweather.json')))
TYPES = json.load(open(os.path.join(HERE, 'settings', 'answer-types.json')))
HISTORY = os.path.join(HERE, 'runs', 'premise-history.json')

PEOPLE = {p['id']: p for p in SETTING['people']}
PLACES = {p['id']: p['name'] for p in SETTING['places']}
HELPERS = set(SETTING.get('not_victim', ['bell', 'iris'])) | set(SETTING.get('not_culprit', ['bell', 'iris']))
CAST = [p for p in PEOPLE if p not in HELPERS]            # who can die, or be a suspect

MOTIVES = {m[0]: m[1] for m in TYPES['motives']}
METHODS = {m[0]: m[1] for m in TYPES['methods']}
# where each method can plausibly happen in Bellweather (and be found there)
METHOD_PLACES = {
    'poison': ['manor', 'inn', 'vestry', 'post'], 'blow': ['manor', 'vestry', 'greenhouse', 'square', 'halt', 'mill'],
    'fall': ['greenhouse', 'mill', 'halt', 'manor'], 'smother': ['manor', 'inn'], 'drown': ['mill', 'boathouse'],
    'blade': ['boathouse', 'halt', 'greenhouse', 'square'], 'gun': ['manor', 'mill', 'boathouse'],
    'gas': ['manor', 'post'], 'staged': ['mill', 'boathouse', 'greenhouse', 'halt'],
}
SHAPES = {
    'two_liars': 'More than one person lies that night, for different and innocent reasons.',
    'protector': 'Someone in the village protects the culprit, without knowing the whole truth.',
    'misread': 'Two people saw something and each misunderstood it.',
    'obvious_wrong': 'The person with the most obvious motive did not do it.',
    'false_time': 'The culprit makes the death seem to happen at a different time.',
    'accomplice_after': 'Someone innocent of the killing helps hide something afterwards, for a reason of their own.',
}


def _history():
    try:
        return json.load(open(HISTORY))
    except (OSError, ValueError):
        return []


def _fresh(options, used, rng):
    """Prefer the options used least recently (never used first); break ties at random."""
    last = {v: i for i, v in enumerate(used)}
    rng.shuffle(options)
    return min(options, key=lambda v: last.get(v, -1))


def draw(seed=None, history=None):
    rng = random.Random(seed)
    hist = _history() if history is None else history
    col = lambda k: [h.get(k) for h in hist]
    victim = _fresh(list(CAST), col('victim'), rng)
    culprit = _fresh([p for p in CAST if p != victim], col('culprit'), rng)
    method = _fresh(list(METHODS), col('method'), rng)
    motive = _fresh(list(MOTIVES), col('motive'), rng)
    place = _fresh(list(METHOD_PLACES[method]), col('place'), rng)
    shape = _fresh(list(SHAPES), col('shape'), rng)
    others = [p for p in CAST if p not in (victim, culprit)]
    rng.shuffle(others)
    suspects = sorted([culprit] + others[:3])
    return {'victim': victim, 'culprit': culprit, 'suspects': suspects, 'bystanders': others[3:], 'method': method,
            'motive': motive, 'place': place, 'shape': shape}


def remember(premise):
    hist = _history() + [{k: premise[k] for k in ('victim', 'culprit', 'method', 'motive', 'place', 'shape')}]
    os.makedirs(os.path.dirname(HISTORY), exist_ok=True)
    json.dump(hist[-40:], open(HISTORY, 'w'), indent=1)


def name(pid):
    return PEOPLE[pid]['name']


def at(place):
    """A place name mid-sentence: 'the greenhouse', 'the village square', 'St. Alden’s vestry'."""
    n = PLACES[place]
    return 'the ' + n[4:] if n.startswith('The ') else 'the village square' if place == 'square' else n


def blurb(p):
    """The public premise: only who is dead and where they were found (the case certifies both)."""
    return f"{name(p['victim'])} was found dead at {at(p['place'])}."


def brief(p):
    v, c = name(p['victim']), name(p['culprit'])
    return (f"{v} ({PEOPLE[p['victim']]['role'].lower()}) dies at {at(p['place'])}. The culprit is {c}. "
            f"Method: {METHODS[p['method']]} (method id '{p['method']}'). Motive: {MOTIVES[p['motive']]} (motive id '{p['motive']}'). "
            f"The suspects (candidates) are exactly: {', '.join(name(s) for s in p['suspects'])}. "
            f"Other villagers may appear as witnesses: {', '.join(name(s) for s in p['bystanders'])}, Constable Bell, Dr Marsh. "
            f"Shape: {SHAPES[p['shape']]} Question: who killed {v}?")


def seed_rules(p):
    return f"""
PREMISE (fixed by code; the seed is rejected unless it matches):
- the victim is '{p['victim']}': set "victim": "{p['victim']}" at the top level; the victim takes no part after their death,
  and a 'death' event (type "death", agent "{p['victim']}") records when they died;
- question.crime.place is '{p['place']}'; the crime event's agent is '{p['culprit']}' and it carries "method": "{p['method']}";
- the attitude that causes the crime (its causedBy, or what that attitude is 'because' of) carries "motive": "{p['motive']}";
- question.candidates are exactly the actors {json.dumps(p['suspects'])}; the truth is '{p['culprit']}';
- give the case a short evocative "title" (3-5 words) that names no suspect.
- The motive evidence must connect the culprit to the victim (a relation claim with a = the culprit and b = the victim,
  or a = the victim and b = the culprit): why kill THIS person.
- Every other suspect needs a believable motive or means of their own, so no single pillar gives the answer away.
"""


def seed_errors(case, p):
    errs = []
    q = case.get('question') or {}
    if case.get('victim') != p['victim']:
        errs.append(f"premise: set \"victim\": \"{p['victim']}\" at the top level")
    death = [e for e in case.get('events', []) if e.get('type') == 'death' and e.get('agent') == p['victim']]
    if not death:
        errs.append(f"premise: add a 'death' event (type death, agent {p['victim']})")
    crime = next((e for e in case.get('events', []) if e.get('id') == (q.get('crime') or {}).get('event')), {})
    if crime.get('agent') != p['culprit']:
        errs.append(f"premise: the crime event's agent must be {p['culprit']}")
    if crime.get('method') != p['method']:
        errs.append(f"premise: the crime event must carry \"method\": \"{p['method']}\"")
    if (q.get('crime') or {}).get('place') != p['place']:
        errs.append(f"premise: question.crime.place must be {p['place']}")
    actors = sorted(((h.get('facts') or {}).get('actor') for h in q.get('candidates', [])), key=str)
    if actors != p['suspects']:
        errs.append(f"premise: the candidates must be exactly {p['suspects']} (got {actors})")
    truth = next((h for h in q.get('candidates', []) if h.get('id') == q.get('truth')), {})
    if (truth.get('facts') or {}).get('actor') != p['culprit']:
        errs.append(f"premise: the truth must be the candidate for {p['culprit']}")
    atts = {a['id']: a for a in case.get('attitudes', [])}
    chain, todo = [], [crime.get('causedBy')]
    while todo:
        a = atts.get(todo.pop())
        if a and a not in chain:
            chain.append(a); todo += list(a.get('because') or [])
    if not any(a.get('motive') == p['motive'] for a in chain):
        errs.append(f"premise: the attitude behind the crime must carry \"motive\": \"{p['motive']}\"")
    return errs
