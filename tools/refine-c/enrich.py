"""Publish-time enrichment of a certified case: content the game needs that the generator does not write.

Every step here either adds records that cannot change the solve (checked by re-certifying with both kernels and
Z3 in publish.gate), or adds play-time text (questions, lines, reactions). Each step is idempotent: it only fills
what is missing, so republishing keeps what was already written.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
TYPES = json.load(open(os.path.join(HERE, 'settings', 'answer-types.json')))
METHOD_IDS = [m[0] for m in TYPES['methods']]
MOTIVE_IDS = [m[0] for m in TYPES['motives']]


def truth_actor(case):
    q = case['question']
    return next(h for h in q['candidates'] if h['id'] == q['truth'])['facts']['actor']


SETTING = json.load(open(os.path.join(HERE, 'settings', 'bellweather.json')))


def role(case, name):
    """The person holding a role (examiner, constable): from the case's setting, else the shared setting."""
    pid = ((case.get('setting') or {}).get('roles') or SETTING.get('roles') or {}).get(name)
    return pid if any(p['id'] == pid for p in case.get('people', [])) else None


def day(case, key):
    return ((case.get('setting') or {}).get('day') or SETTING.get('day') or {}).get(key)


def victim_of(case):
    """The dead person: the case's stated victim, else the subject of the death event, else the setting's."""
    if case.get('victim'):
        return case['victim']
    death = next((e for e in case['events'] if e.get('type') == 'death' or e.get('kind') == 'death'), None)
    if death and death.get('agent'):
        return death['agent']
    return SETTING.get('victim')


def crime_event(case):
    return next(e for e in case['events'] if e['id'] == case['question']['crime']['event'])


ANSWER = """You classify how and why a death came about in a generated mystery, for the accusation form. You get the
fatal event, the culprit's attitudes (their reasons) and the relations the case records. Choose exactly one METHOD id
and one MOTIVE id from the lists (use the definitions; 'money' covers theft, fraud or debt about to come out, even when
the culprit fears exposure; 'secret' is only for secrets that are not about money).
Return {"method": "<id>", "motive": "<id>", "why": "<one short sentence>"}."""


def add_answer(case):
    """case['answer'] = {method, motive}: what the player must name. The premise deck sets it directly for new cases."""
    if (case.get('answer') or {}).get('method') in METHOD_IDS and case['answer'].get('motive') in MOTIVE_IDS:
        return 0
    from refine import llm_json, CRITIC_MODEL
    ta = truth_actor(case)
    crime = crime_event(case)
    chain, todo = [], [crime.get('causedBy')]
    atts = {a['id']: a for a in case.get('attitudes', [])}
    while todo:
        a = atts.get(todo.pop())
        if a and a not in chain:
            chain.append(a); todo += list(a.get('because') or [])
    item = {'fatal_event': crime.get('summary'), 'culprit_reasons': [f"{a['mode']}: {a['content']}" for a in chain] or
            [f"{a['mode']}: {a['content']}" for a in case['attitudes'] if a['agent'] == ta],
            'relations': [r for r in case.get('relations', []) if r['a'] == ta],
            'METHOD': TYPES['methods'], 'MOTIVE': TYPES['motives']}
    for _ in range(2):
        out = llm_json(ANSWER, json.dumps(item), 600, model=CRITIC_MODEL)
        if out.get('method') in METHOD_IDS and out.get('motive') in MOTIVE_IDS:
            case['answer'] = {'method': out['method'], 'motive': out['motive']}
            return 1
    raise ValueError('could not classify the method and motive')


def _history(case):
    return [f"{e['start'] // 60 % 24:02d}:{e['start'] % 60:02d} {e.get('summary', e['id'])}" for e in sorted(case['events'], key=lambda e: e['start'])]


def _public_sign(x):
    return {k: x[k] for k in ('id', 'kind', 'title', 'at', 'speaker', 'about', 'text') if x.get(k)}


REVIEW = """You review text written for a 1920s village mystery game against the TRUE history of the night. Each item is a
line the game will show or a character will say. Flag an item only for a concrete fault:
- it contradicts the true history (wrong time of death, wrong person, wrong place, an event that did not happen),
- it names a person wrongly (e.g. calls the victim by another person's name) or gets a relationship wrong (calls a
  sister a wife: 'people' says who everyone is),
- an innocent character confesses to something they did not do, or the culprit confesses to the crime,
- it reveals who the culprit is where the item is not itself proof,
- it speaks of the victim as alive now ('victim' is dead since last night): "ask the landlady" when she is the victim.
Characters may lie where the item says 'lie': true, and accounts may be honestly mistaken: repeating, quoting or
reacting to an account is NOT a fault because the account itself is wrong. For the detective's lines ('said_by' the
detective) check only that they add no fact beyond the clue in 'about'. Vague is fine. Report only definite faults. Return
{"problems": {"<key>": "<what is wrong>"}} with only the faulty items (empty object if none)."""


REVIEW_VERSION = 2   # 2: the victim is dead; forms of address checked in code


def review_publish(case):
    """Check everything publish wrote against the true history; drop faulty lines (the game falls back to templates).
    Items reviewed under an older version of the review are reviewed again."""
    from refine import llm_json, CRITIC_MODEL
    import publish
    if case.get('review_version') != REVIEW_VERSION:
        case['reviewed'], case['review_version'] = [], REVIEW_VERSION
    victim = victim_of(case)
    items = {}
    for x in case['signs']:
        if x.get('medical') or x.get('surface') or x.get('morning') or x.get('sighting'):
            items[f"{x['id']}|text"] = {'text': x['text'], 'speaker': x.get('speaker'), 'lie': bool(x.get('deceptive'))}
        for pid, t in (x.get('reactions') or {}).items():
            items[f"{x['id']}|reactions|{pid}"] = {'text': t, 'speaker': pid, 'shown': _public_sign(x)}
        if x.get('direct'):
            items[f"{x['id']}|direct"] = {'text': x['direct'], 'said_by': 'detective', 'said_to': x.get('to'), 'about': _public_sign(x),
                                          'check': "said TO 'said_to'; a fault if the clue and history do not connect this person to it"}
        for n, t in (x.get('concede') or {}).items():
            items[f"{x['id']}|concede|{n}"] = {'text': t, 'speaker': x.get('speaker')}
    todo = {k: v for k, v in items.items() if k not in set(case.get('reviewed', []))}
    if not todo:
        return {}
    ctx = {'victim': victim, 'culprit': truth_actor(case), 'history': _history(case),
           'people': [{'id': p['id'], 'name': p['name'], 'who': next((q.get('public') for q in SETTING.get('people', []) if q['id'] == p['id']), '')}
                      for p in case['people']]}
    # a form of address no one in the setting answers to (and the history does not use) is a fault, found by code
    problems = {k: f"wrong form of address: {', '.join(w)}" for k, v in todo.items()
                if (w := publish.wrong_addresses(v['text'], publish.history_text(case)))}
    keys = [k for k in todo if k not in problems]
    for i in range(0, len(keys), 40):
        chunk = {k: todo[k] for k in keys[i:i + 40]}
        out = llm_json(REVIEW, json.dumps({**ctx, 'items': chunk}), 4000, model=CRITIC_MODEL).get('problems') or {}
        if isinstance(out, dict):
            problems.update({k: str(v) for k, v in out.items() if k in chunk and not re.search(r'no (clear )?fault|upon reflection|is plausible', str(v), re.I)})
    signs = {x['id']: x for x in case['signs']}
    for key in problems:
        sid, field, *rest = key.split('|')
        x = signs.get(sid)
        if not x:
            continue
        if field in ('show', 'confront', 'direct'):
            x.pop(field, None)
            if field == 'direct':
                x.pop('to', None)     # a fresh 'to' and line on the next pass
        elif field == 'reactions':
            (x.get('reactions') or {}).pop(rest[0], None)
        elif field == 'concede':
            (x.get('concede') or {}).pop(rest[0], None)
        elif field == 'text' and x.get('medical'):
            x['medical_v'] = 0          # rewritten on the next publish
    case['reviewed'] = sorted(set(case.get('reviewed', [])) | (set(todo) - set(problems)))
    return problems


KNOW = """You write what each person in a 1920s village mystery would plainly and truthfully tell a detective about their
EVERYDAY life, so that they answer ordinary questions like a real person instead of stonewalling. For each person write
3-6 short first-person facts (one sentence each) covering: their work and routine, how they know the others (as the
village knows it), where they live and keep their things, any keys or duplicates they hold and why, and anything the whole
village already knows this morning (for example who found the body and who sent for the doctor, if the history says so).
STRICT LIMITS - never write:
- where anyone was, or what anyone did, during last night (after supper) - that is testimony the game controls;
- anything in the FORBIDDEN list (items, relations or facts that are evidence in the case);
- any object or document in CLUE_OBJECTS (they are for the detective to find), or anything touching LIES (what people
  are hiding: e.g. if someone lies about being at the inn, do not mention their habits at the inn);
- any secret, motive, fear or suspicion; any clock time or number.
Return {"knowledge": {"<person id>": ["...", "..."]}}."""

KNOW_CHECK = """You check 'everyday facts' written for characters in a mystery game. Each must be harmless: it may not say where
anyone was or what anyone did last night (except the public facts of the morning: who found the body, who sent for the
doctor), may not state or hint at any FORBIDDEN fact, secret or motive, may not mention a CLUE_OBJECT or touch what
someone LIES about (a habit that would give the lie away), and may not contradict the true history. Return
{"bad": {"<person id>": [<index of each bad fact>, ...]}} (empty object if all are fine)."""


STOP = {'the', 'with', 'from', 'behind', 'under', 'along', 'into', 'about', 'notes', 'body', 'doctor', 'night', 'miss',
        'mrs', 'mr', 'dr', 'room', 'study', 'house', 'manor', 'vestry', 'inn', 'square', 'surgery', 'greenhouse', 'their', 'account'}


def clue_nouns(case):
    """Content words of every physical clue's title: text written for play must not mention them (they are to be found)."""
    names = {w.lower() for p in case['people'] for w in p['name'].split()}
    titles = [x.get('title') for x in case['signs'] if x['kind'] != 'testimony' and x.get('title')]
    return {w for t in titles for w in (re.sub(r"[^a-z]", '', x.lower()) for x in str(t).split())
            if len(w) > 3 and w not in STOP and w not in names}


def mentions_clue(text, nouns):
    return any(re.search(rf'\b{n[:max(4, len(n) - 1)]}', text, re.I) for n in nouns)


def _unwrap(value, key):
    """Models sometimes nest the wrapper key twice ({"knowledge": {"knowledge": {...}}})."""
    while isinstance(value, dict) and key in value and len(value) == 1:
        value = value[key]
    return value if isinstance(value, dict) else {}


def add_knowledge(case):
    """case.knowledge[pid]: plain everyday facts for free-text questions. They carry no claim (certification is
    unchanged by construction) and are checked by a reviewer and by code not to touch the case's evidence."""
    from refine import llm_json, CRITIC_MODEL, claim_of
    if case.get('knowledge') is not None:
        return 0
    victim = victim_of(case)
    public_morning = [e.get('summary') for e in case['events'] if e['start'] >= 1700]
    forbidden = []
    for x in case['signs']:
        c = claim_of(x)
        if c and c['pred'] not in ('wasAt', 'nobodyAt', 'crimeBetween'):
            forbidden.append(json.dumps(c))
    forbidden += [f"{a['agent']} {a['mode']}: {a['content']}" for a in case['attitudes'] if a['mode'] in ('fears', 'intends', 'wants', 'knows')]
    people = [{'id': p['id'], 'name': p['name'], 'role': p.get('role'), 'public': p.get('public'), 'home': p.get('home'),
               'holds': [q['item'] for q in case.get('holdings', []) if q['person'] == p['id']
                         and not any(q['item'] in f for f in forbidden)]}
              for p in case['people'] if p['id'] != victim]
    from refine import claim_true, travel_table
    tt = travel_table(case)
    clue_objects = [x.get('title') for x in case['signs'] if x['kind'] != 'testimony' and x.get('title')]
    lies = [x.get('text') for x in case['signs'] if x.get('deceptive') or (claim_of(x) and not claim_true(case, claim_of(x), tt))]
    nouns = clue_nouns(case)
    item = {'setting': case['setting'].get('summary'), 'victim': victim, 'morning': public_morning, 'people': people,
            'FORBIDDEN': forbidden, 'CLUE_OBJECTS': clue_objects, 'LIES': lies}
    out = _unwrap(llm_json(KNOW, json.dumps(item), 4000, model=CRITIC_MODEL), 'knowledge')
    know = {}
    for p in people:
        facts = [str(f).strip() for f in (out.get(p['id']) or []) if isinstance(f, str)]
        know[p['id']] = [f for f in facts if f and not re.search(r'\d', f) and len(f.split()) <= 30
                         and not mentions_clue(f, nouns)
                         and not re.search(r'\b(last night|yesterday evening|after supper|this evening)\b', f, re.I)][:6]
    check = _unwrap(llm_json(KNOW_CHECK, json.dumps({'history': _history(case), 'FORBIDDEN': forbidden, 'CLUE_OBJECTS': clue_objects,
                                                      'LIES': lies, 'facts': know}), 1500, model=CRITIC_MODEL), 'bad')
    for pid, bad in (check.items() if isinstance(check, dict) else []):
        if pid in know and isinstance(bad, list):
            know[pid] = [f for i, f in enumerate(know[pid]) if i not in bad]
    case['knowledge'] = {k: v for k, v in know.items() if v}
    return sum(len(v) for v in case['knowledge'].values())


MOOD = """For each person in a 1920s village mystery, write 'today': how they are this morning, the day after the death, in one
short sentence an actor could play (e.g. "Tired and short-tempered; worried the bank will call in the loan"). Base it on
their attitudes and what they did, but state no fact about last night, name no one as guilty, and give no times or numbers.
Anyone with no attitudes listed is simply going about their day (tired, busy, saddened), with no hint of anything. Return {"moods": {"<id>": "..."}}."""


def add_moods(case):
    """case.moods[pid]: each person's state of mind this morning, so the same villager is not the same in every case."""
    from refine import llm_json, CRITIC_MODEL
    if case.get('moods'):
        return 0
    victim = victim_of(case)
    culprit, nouns = truth_actor(case), clue_nouns(case)
    # the culprit's mood comes from their public role only: any hint of nerves would be a giveaway
    items = [{'id': p['id'], 'name': p['name'], 'role': p.get('role'),
              'attitudes': [] if p['id'] == culprit else [f"{a['mode']}: {a['content']}" for a in case['attitudes'] if a['agent'] == p['id']]}
             for p in case['people'] if p['id'] != victim]
    out = _unwrap(llm_json(MOOD, json.dumps(items), 1500, model=CRITIC_MODEL), 'moods')
    case['moods'] = {k: str(v).strip() for k, v in out.items() if isinstance(v, str) and not re.search(r'\d', v) and len(v.split()) <= 30
                     and not mentions_clue(v, nouns) and not re.search(r'\b(last night|where (he|she) (was|went)|eager to explain|alibi)\b', v, re.I)}
    return len(case['moods'])




ACCEPT = """A player of a 1920s village mystery must name HOW the victim died and WHY the culprit did it, choosing from fixed
lists, going only by the evidence they find. You get that evidence (the clues that establish means and motive, and the
doctor's findings) and the two lists. Score EVERY id in each list from 0 to 3 for how well THIS evidence supports it:
3 = a careful reader would name it; 2 = a fair reading; 1 = possible but a stretch; 0 = not supported. Judge only by the
evidence, not by what you guess the author intended. Return {"methods": {"<id>": n, ...}, "motives": {"<id>": n, ...}}."""
ACCEPTED_V = 3


def add_accepted(case):
    """answer.methods / answer.motives: the true answer plus every answer the player's evidence supports as well as it
    supports the truth (scored by a reviewer that sees only the evidence), so a case is never lost on overlapping
    categories, and never won on a stretch. Wording of what the evidence says; adds no fact."""
    ans = case.get('answer') or {}
    if ans.get('accepted_v') == ACCEPTED_V:
        return 0
    from refine import analyse, pillar_signs, llm_json, CRITIC_MODEL
    A = analyse(case)
    P = pillar_signs(case, A)
    signs = {x['id']: x for x in case['signs']}
    show = lambda ids: [signs[i]['text'] for i in ids if i in signs]
    item = {'means_evidence': show(P['means']), 'motive_evidence': show(P['motive']),
            'doctor': show([x['id'] for x in case['signs'] if x.get('medical')]),
            'METHOD': TYPES['methods'], 'MOTIVE': TYPES['motives']}
    out = llm_json(ACCEPT, json.dumps(item), 800, model=CRITIC_MODEL)

    def pick(key, ids, truth):
        scores = {k: v for k, v in (out.get(key) or {}).items() if k in ids and isinstance(v, (int, float))}
        bar = max(2, scores.get(truth, 0))           # as well supported as the truth, and at least a fair reading
        return sorted({truth, *[k for k, v in scores.items() if v >= bar]} - {None})
    ans['methods'] = pick('methods', METHOD_IDS, ans.get('method'))
    ans['motives'] = pick('motives', MOTIVE_IDS, ans.get('motive'))
    ans['accepted_scores'] = {k: out.get(k) for k in ('methods', 'motives')}
    ans['accepted_v'] = ACCEPTED_V
    case['answer'] = ans
    return 1


ART = """Each clue in a 1920s village mystery game is shown with a small painted picture from a fixed library. For each clue,
choose the ONE library picture that shows what the clue is or is about (the object a player would picture), or null if
none fits well. Choose by meaning, not by a shared word: "the doctor's notes" is case notes, not a letter; "the surgery
door" is a door. A clue about a body, a wound or a mark on a person takes the doctor's examination picture if the
library has one; a place or scene takes the object that best stands for it (a sorting room: a mail sack; the foot of
the steps: stairs; an empty pocket: the garment). Null only if nothing in the library fits at all.
Return {"art": {"<clue id>": "<library id>" | null}}."""


def add_art(case, retry_none=False):
    """x['art']: the library picture for each object clue (presentation only; never a fact). Code checks every key.
    retry_none: also clues that had no fitting picture before (after the library has grown)."""
    lib = {o['id']: o['label'] for o in SETTING.get('objects', [])}
    todo = [x for x in case['signs'] if x['kind'] not in ('testimony', 'behavior') and ('art' not in x or (retry_none and x['art'] is None))]
    if not todo or not lib:
        return 0
    from refine import llm_json, CRITIC_MODEL
    item = {'library': lib, 'clues': [{'id': x['id'], 'kind': x['kind'], 'title': x.get('title'), 'text': str(x.get('text', ''))[:300]}
                                      for x in todo]}
    out = _unwrap(llm_json(ART, json.dumps(item), 3000, model=CRITIC_MODEL), 'art')
    n = 0
    for x in todo:
        key = out.get(x['id']) if isinstance(out, dict) else None
        if x['id'] in (out or {}):
            x['art'] = key if key in lib else None     # an unknown key is no picture: the game falls back to the clue's kind
            n += 1
    return n


UNLOCK = """In a 1920s village mystery game, several leads open at the same moment (the same thing unlocks them, in the same
place). Each has its own line, and they all start the same way. Rewrite them as ONE opening sentence said once (what
opens), and for each lead one short sentence of what the detective then finds or hears, without repeating the opening.
Keep every fact; add none. Return {"lead": "<opening sentence>", "lines": {"<id>": "<sentence>"}}."""


def add_unlock_groups(case):
    """Leads that open together (same requirements, same place) share one opening line: x['unlock_lead'] is said once,
    x['unlock'] is each lead's own line (the original stays in 'unlock_full'). Wording only."""
    from collections import defaultdict
    from refine import llm_json, CRITIC_MODEL
    groups = defaultdict(list)
    for x in case['signs']:
        if x.get('unlock') and x.get('requires') and 'unlock_lead' not in x:
            groups[(tuple(sorted(x['requires'])), x.get('at'))].append(x)
    n = 0
    for xs in groups.values():
        if len(xs) < 2:
            continue
        out = llm_json(UNLOCK, json.dumps({x['id']: x['unlock'] for x in xs}), 800, model=CRITIC_MODEL)
        lead, lines = str(out.get('lead') or '').strip(), out.get('lines') or {}
        if not lead or not all(str(lines.get(x['id']) or '').strip() for x in xs):
            continue                                   # keep the separate lines rather than a partial rewrite
        for x in xs:
            x['unlock_full'], x['unlock_lead'], x['unlock'] = x['unlock'], lead, str(lines[x['id']]).strip()
        n += 1
    return n
