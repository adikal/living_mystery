"""The premise deck: code, not the model, decides who dies, who did it, why, how and where; the model writes the story.

draw() picks a premise that differs from recent ones (a history file in runs/ remembers the last cases), brief()
turns it into the generator's brief, and seed_errors() checks the seed honours it, so the model cannot swap in
its favourite story (the solicitor, the embezzlement, the candlestick).
"""
import json
import os
import random
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SETTING = json.load(open(os.path.join(HERE, 'settings', 'bellweather.json')))
TYPES = json.load(open(os.path.join(HERE, 'settings', 'answer-types.json')))
HISTORY = os.path.join(HERE, 'runs', 'premise-history.json')

PEOPLE = {p['id']: p for p in SETTING['people']}
PLACES = {p['id']: p['name'] for p in SETTING['places']}
HELPERS = set(SETTING.get('not_victim', [])) | set(SETTING.get('not_culprit', [])) | set((SETTING.get('roles') or {}).values())
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
    examiner, morning, start = (SETTING.get('roles') or {}).get('examiner'), (SETTING.get('day') or {}).get('morning', 1740), (SETTING.get('day') or {}).get('start', 1920)
    return f"""
PREMISE (fixed by code; the seed is rejected unless it matches):
- the victim is '{p['victim']}': set "victim": "{p['victim']}" at the top level; the victim takes no part after their death,
  and a 'death' event (type "death", agent "{p['victim']}") records when they died;
- question.crime.place is '{p['place']}'; the crime event's agent is '{p['culprit']}' and it carries "method": "{p['method']}";
- the attitude that causes the crime (its causedBy, or what that attitude is 'because' of) carries "motive": "{p['motive']}";
- question.candidates are exactly the actors {json.dumps(p['suspects'])}; the truth is '{p['culprit']}';
- give the case a short evocative "title" (3-5 words) that names no suspect.
- THE MORNING: a 'discovery' event (type "discovery") in which someone finds the body, and after it an 'examination' event
  (type "examination", agent "{examiner}", at the place of the body) in which the doctor examines it. Both after the
  death and before {start} (the investigation begins at {start}). Every person who learns of the death must have an event
  that tells them, or be present at one.
- Everyone the case involves (anyone in an event or a clue, the suspects, the constable and the doctor) has an evening:
  at least one event before the morning saying where they were (an evening at home is fine). Anyone the history does
  not mention is not in the case.
- Every testimony must be something its speaker took part in, saw (was at that place at that time), or knew: cite the
  event as 'source', or a 'knows' attitude of the speaker in 'because'. Nobody may say anything they could not know.
- The substance of the culprit's motive (what the secret actually is) must be stated in some true sign, not only hinted.
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
    return errs + morning_errors(case)


def morning_errors(case):
    """Every case: the body is found (a 'discovery' event) and then examined by the setting's examiner (an
    'examination' event at the body), both in the morning before the investigation starts. Checked by type, not words."""
    errs = []
    examiner = ((case.get('setting') or {}).get('roles') or SETTING.get('roles') or {}).get('examiner')
    day = (case.get('setting') or {}).get('day') or SETTING.get('day') or {}
    morning, start = day.get('morning', 1740), day.get('start', 1920)
    victim = case.get('victim')
    scene = ((case.get('question') or {}).get('crime') or {}).get('place')
    evs = case.get('events', [])
    disc = [e for e in evs if e.get('type') == 'discovery']
    exam = [e for e in evs if e.get('type') == 'examination' and e.get('agent') == examiner]
    if not disc:
        errs.append(f"add a 'discovery' event (type \"discovery\") in which someone finds {victim or 'the body'}, after the death and before {start}")
    if examiner and examiner != victim and not exam:
        errs.append(f"add an 'examination' event (type \"examination\", agent \"{examiner}\") after the discovery, at the body, before {start}")
    death = next((e for e in evs if e.get('type') == 'death' and (not victim or e.get('agent') == victim)), None)
    for e in disc + exam:
        if e.get('end', 0) > start or (death and e.get('start', 0) < death.get('start', 0)):
            errs.append(f"event {e['id']} ({e.get('type')}) must come after the death and end before the investigation starts ({start})")
    if disc and exam and min(e.get('start', 0) for e in exam) < min(e.get('start', 0) for e in disc):
        errs.append("the examination must come after the body is found")
    return errs


def involved(case):
    """Who is in the case: anyone an event, clue, attitude or relation names (structurally or by name in its text), the
    suspects, and the role-holders. One definition, used for the cast (publish.prune_people) and the evening rule."""
    keep = {(h.get('facts') or {}).get('actor') for h in case['question'].get('candidates', [])}
    keep |= set(((case.get('setting') or {}).get('roles') or SETTING.get('roles') or {}).values())
    for e in case['events']:
        keep |= {e.get('agent'), *(e.get('others') or [])}
    for x in case['signs']:
        c = x.get('claim') or {}
        keep |= {x.get('speaker'), x.get('about'), x.get('to'), c.get('person'), c.get('a'), c.get('b')}
    keep |= {a.get('agent') for a in case.get('attitudes', [])}
    keep |= {q for r in case.get('relations', []) for q in (r.get('a'), r.get('b'))}
    texts = ' '.join([str(e.get('summary', '')) for e in case['events']] + [str(x.get('text', '')) for x in case['signs']]
                     + [str(a.get('content', '')) for a in case.get('attitudes', [])])
    for p in SETTING.get('people', []):
        forms = {p.get('name'), p.get('address'), str(p.get('name', '')).split(' ')[0]} - {None, ''}
        if any(re.search(rf"\b{re.escape(f)}\b", texts) for f in forms):
            keep.add(p['id'])
    return keep & {p['id'] for p in case['people']}


def evening_errors(case):
    """Everyone the history mentions (who will be in the case) has an evening in the history: something true to say
    about last night. People it never mentions are not in the case at all (publish.prune_people)."""
    morning = (case.get('setting', {}).get('day') or {}).get('morning') or (SETTING.get('day') or {}).get('morning', 1740)
    actors = involved(case)
    victim = case.get('victim') or next((e.get('agent') for e in case['events'] if e.get('type') == 'death'), None)
    busy = {q for e in case['events'] if e.get('start', 0) < morning for q in [e.get('agent'), *(e.get('others') or [])]}
    return [f"give {a} an evening: at least one event before the morning ({morning}) saying where they were"
            for a in sorted(actors - busy - {victim, None})]
