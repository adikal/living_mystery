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


def victim_of(case):
    """The dead person: the case's stated victim, else the subject of the death event, else the setting's."""
    if case.get('victim'):
        return case['victim']
    death = next((e for e in case['events'] if e.get('type') == 'death' or e.get('kind') == 'death'), None)
    if death and death.get('agent'):
        return death['agent']
    return 'edmund'


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


LOOSE = """You check a finished 1920s village mystery for LOOSE ENDS. You get the true history and a list of (person, clue)
pairs: each clue mentions that person (by name or role) although they took no part in what produced it. For each pair,
decide whether the case explains why the clue mentions them (the true history or their role makes it obvious). If not,
write what that person would plainly say if the detective asked about it: 1-2 sentences in their voice, true to the
history, adding only harmless everyday detail (where a thing is kept, why they have it). It must not say where anyone
was or what anyone did last night, name anyone as guilty, give any clock time or number, or reveal anything about the crime.
Return {"loose_ends": [{"person": "<id>", "clue": "<clue id>", "explained": true|false,
"question": "<the detective's short question about it>", "answer": "<their reply, only if unexplained>"}]}"""

ROLE_WORDS = {'bell': ['constable'], 'iris': ['doctor'], 'vicar': ['vicar', 'rector', 'parson'], 'dora': ['postmistress'],
              'jonah': ['boatman', 'boathouse keeper', 'ferryman'], 'rowan': ['groundskeeper', 'gardener'], 'ada': ['innkeeper', 'landlady'],
              'silas': ['solicitor'], 'hugo': ['nephew'], 'clara': []}


def mentions(case, x):
    """People a clue's text names (full name, address, surname or role) - computed, not guessed."""
    text = ' ' + str(x.get('text', '')) + ' ' + str(x.get('title', '')) + ' '
    out = set()
    for p in case['people']:
        forms = [p['name'], p.get('address') or ''] + ROLE_WORDS.get(p['id'], [])
        sur = p['name'].split()[-1]
        if sur not in {q['name'].split()[-1] for q in case['people'] if q['id'] != p['id']}:
            forms.append(sur)
        if any(f and re.search(rf"\b{re.escape(f)}\b", text, re.I) for f in forms):
            out.add(p['id'])
    return out


def add_loose_ends(case):
    """A physical clue that names an innocent who took no part in producing it must be explained. Code finds those
    (person, clue) pairs; the model says whether the case explains them and, if not, writes the person's plain answer,
    available once the clue is held. Claimless, so certification is unchanged (the gate re-checks)."""
    from refine import llm_json, CRITIC_MODEL
    if case.get('loose_ends_checked'):
        return 0
    people = {p['id']: p for p in case['people']}
    victim, culprit = victim_of(case), truth_actor(case)
    evs = {e['id']: e for e in case['events']}
    pairs = []
    for x in case['signs']:
        if x['kind'] == 'testimony':
            continue
        src = evs.get(x.get('source')) or {}
        took_part = {src.get('agent'), *src.get('others', []), x.get('about')}
        for pid in mentions(case, x) - took_part - {victim, culprit}:
            if pid in people:
                pairs.append((pid, x))
    case['loose_ends_checked'] = True
    if not pairs:
        return 0
    item = {'history': _history(case), 'people': [{'id': p['id'], 'name': p['name'], 'voice': p.get('voice')} for p in case['people']],
            'pairs': [{'person': pid, 'name': people[pid]['name'], 'clue': _public_sign(x)} for pid, x in pairs]}
    out = llm_json(LOOSE, json.dumps(item), 3000, model=CRITIC_MODEL).get('loose_ends') or []
    signs = {x['id']: x for x in case['signs']}
    wanted = {(pid, x['id']) for pid, x in pairs}
    n = 0
    for le in out if isinstance(out, list) else []:
        pid, clue, ans = le.get('person'), le.get('clue'), str(le.get('answer') or '').strip()
        if le.get('explained') or (pid, clue) not in wanted or not ans or re.search(r'\d', ans) or len(ans.split()) > 60 \
                or re.search(r'\b(last night|yesterday|this morning|evening|went|was at|stepped|left the)\b', ans, re.I):
            continue
        sid = f"s_loose_{pid}_{clue}"[:60]
        if sid in signs:
            continue
        import publish
        with publish.SIGNS: case['signs'].append({'id': sid, 'kind': 'testimony', 'speaker': pid, 'loose_end': True, 'requires': [clue],
                              'unlock': f"once you have {signs[clue].get('title', 'that')}, you can ask {people[pid]['name']} about it",
                              'title': f"{people[pid]['name']} on {str(signs[clue].get('title', 'it')).lower()}", 'text': ans,
                              'ask': str(le.get('question') or '').strip()[:140] or None, 'deceptive': False})
        n += 1
    return n


REVIEW = """You review text written for a 1920s village mystery game against the TRUE history of the night. Each item is a
line the game will show or a character will say. Flag an item only for a concrete fault:
- it contradicts the true history (wrong time of death, wrong person, wrong place, an event that did not happen),
- it names a person wrongly (e.g. calls the victim by another person's name),
- an innocent character confesses to something they did not do, or the culprit confesses to the crime,
- it reveals who the culprit is where the item is not itself proof.
Characters may lie where the item says 'lie': true, and accounts may be honestly mistaken: repeating, quoting or
reacting to an account is NOT a fault because the account itself is wrong. For the detective's lines ('said_by' the
detective) check only that they add no fact beyond the clue in 'about'. Vague is fine. Report only definite faults. Return
{"problems": {"<key>": "<what is wrong>"}} with only the faulty items (empty object if none)."""


def review_publish(case):
    """Check everything publish wrote against the true history; drop faulty lines (the game falls back to templates)."""
    from refine import llm_json, CRITIC_MODEL
    victim = victim_of(case)
    items = {}
    for x in case['signs']:
        if x.get('medical') or x.get('surface') or x.get('loose_end') or x.get('motive_link') or x.get('secret'):
            items[f"{x['id']}|text"] = {'text': x['text'], 'speaker': x.get('speaker'), 'lie': bool(x.get('deceptive'))}
        for pid, t in (x.get('reactions') or {}).items():
            items[f"{x['id']}|reactions|{pid}"] = {'text': t, 'speaker': pid, 'shown': _public_sign(x)}
        for n, t in (x.get('concede') or {}).items():
            items[f"{x['id']}|concede|{n}"] = {'text': t, 'speaker': x.get('speaker')}
    todo = {k: v for k, v in items.items() if k not in set(case.get('reviewed', []))}
    if not todo:
        return {}
    ctx = {'victim': victim, 'culprit': truth_actor(case), 'history': _history(case),
           'people': [{'id': p['id'], 'name': p['name']} for p in case['people']]}
    problems = {}
    keys = list(todo)
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
        if field in ('show', 'confront'):
            x.pop(field, None)
        elif field == 'reactions':
            (x.get('reactions') or {}).pop(rest[0], None)
        elif field == 'concede':
            (x.get('concede') or {}).pop(rest[0], None)
        elif field == 'text' and x.get('medical'):
            x['medical_v'] = 0          # rewritten on the next publish
        elif field == 'text' and x.get('loose_end'):
            case['signs'] = [y for y in case['signs'] if y['id'] != sid]
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
        if c and c['kind'] in ('possession', 'relation', 'trait', 'fact'):
            forbidden.append(json.dumps(c))
    forbidden += [f"{a['agent']} {a['mode']}: {a['content']}" for a in case['attitudes'] if a['mode'] in ('fears', 'intends', 'wants', 'knows')]
    people = [{'id': p['id'], 'name': p['name'], 'role': p.get('role'), 'public': p.get('public'), 'home': p.get('home'),
               'holds': [q['item'] for q in case.get('possession', []) if q['person'] == p['id']
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


LINK = """In a finished 1920s village mystery the player can learn the culprit's secret, but nothing yet tells them why the
culprit would kill THIS victim. Using the true history and the attitudes, write ONE piece of evidence the player can find
that shows how the victim was a threat to the culprit (they knew the secret, meant to expose it, demanded money, stood in
the way...). It must be TRUE to the history, add no new event, and must not name the culprit as the killer.
Choose either a TESTIMONY (a person, not the culprit or victim, who knew: what they plainly say, 1-3 sentences in their
voice) or a DOCUMENT (a letter, note or diary entry the victim left, found at a place; 1-3 sentences, quoted).
Return {"kind": "testimony"|"document", "speaker": "<person id, testimony only>", "place": "<place id, document only>",
"title": "<short title>", "text": "...", "rel": "<snake_case relation from the victim to the culprit, e.g. meant_to_expose>",
"ask": "<the detective's short question for a testimony>"}"""


def add_motive_link(case):
    """If the motive evidence never connects the culprit to the victim, add one true sign that does: a relation from the
    victim to the culprit, reachable only after the existing motive evidence (so the case does not get easier)."""
    from refine import llm_json, CRITIC_MODEL, certify, claim_of
    victim, culprit = victim_of(case), truth_actor(case)
    rep = certify(case)
    if rep.get('ok') or not any('MOTIVE' in e for e in rep.get('errors', [])):
        return 0
    A = rep['A']
    raw = [sid for sid in A['understood'] if (claim_of(A['signs'][sid]) or {}).get('kind') == 'relation'
           and (claim_of(A['signs'][sid]) or {}).get('a') == culprit and A['truthval'].get(sid)]
    if not raw:
        return 0
    anchor = max(raw, key=lambda x: A['eff'][x])        # the deepest existing motive clue
    people = {p['id']: p for p in case['people']}
    item = {'history': _history(case), 'victim': victim, 'culprit': culprit,
            'attitudes': [f"{a['agent']} {a['mode']}: {a['content']}" for a in case['attitudes'] if a['agent'] in (victim, culprit)],
            'culprit_secret_clue': A['signs'][anchor].get('text'),
            'people': [{'id': p['id'], 'name': p['name'], 'voice': p.get('voice')} for p in case['people'] if p['id'] not in (victim, culprit)],
            'places': [p['id'] for p in case['setting']['places']]}
    for _ in range(2):
        out = llm_json(LINK, json.dumps(item), 1500, model=CRITIC_MODEL)
        kind, rel, text = out.get('kind'), re.sub(r'[^a-z_]', '', str(out.get('rel') or '').lower()), str(out.get('text') or '').strip()
        if kind not in ('testimony', 'document') or not rel or not text or re.search(r'\d', text) or len(text.split()) > 80:
            continue
        if kind == 'testimony' and out.get('speaker') not in people or out.get('speaker') in (victim, culprit):
            if kind == 'testimony':
                continue
        if kind == 'document' and out.get('place') not in {p['id'] for p in case['setting']['places']}:
            continue
        sid = 's_motive_link'
        sign = {'id': sid, 'kind': kind, 'title': str(out.get('title') or 'What the victim knew')[:60], 'text': text,
                'requires': [anchor], 'motive_link': True,
                'unlock': f"once you know {str(A['signs'][anchor].get('title') or 'the secret').lower()}, you know what to look for",
                'claim': {'kind': 'relation', 'a': victim, 'rel': rel, 'b': culprit}}
        if kind == 'testimony':
            sign.update(speaker=out['speaker'], ask=str(out.get('ask') or '').strip()[:140] or None)
        else:
            sign['at'] = out['place']
        trial = json.loads(json.dumps(case))
        trial['relations'] = trial.get('relations', []) + [{'a': victim, 'rel': rel, 'b': culprit}]
        trial['signs'].append(sign)
        r2 = certify(trial)
        if r2.get('ok') and r2['solve_depth'] >= (rep.get('solve_depth') or 0):
            case['relations'], case['signs'] = trial['relations'], trial['signs']
            return 1
    return 0


SECRET = """In a finished 1920s village mystery, decide whether the player can learn the SUBSTANCE of the culprit's motive
from the clues (what the secret actually is: e.g. "her husband is alive", "he forged the will", "the oak was sold from
the boy's trust" - not merely that money changed hands or that someone was threatened). If they can, return
{"discoverable": true, "by": "<clue id>"}. If not, write ONE true clue that reveals it, found only after the given anchor
clue: a TESTIMONY from someone who knew (not the culprit or the victim; 1-3 sentences in their voice) or a DOCUMENT
(letter, note, register entry; 1-3 quoted sentences) at a place. True to the history, no new events, no clock times or
numbers, and it must not say who killed anyone. Return {"discoverable": false, "kind": "testimony"|"document",
"speaker": "<person id>", "place": "<place id>", "title": "...", "text": "...", "ask": "<the detective's question>"}"""


def add_secret_clue(case):
    """The culprit's secret itself must be discoverable in play, not only in the ending. If no clue reveals it, add a
    true, claimless clue reachable after the deepest motive clue (so certification and depth are unchanged)."""
    from refine import llm_json, CRITIC_MODEL, certify
    if case.get('secret_checked'):
        return 0
    victim, culprit = victim_of(case), truth_actor(case)
    rep = certify(case)
    if not rep.get('ok'):
        return 0
    A, crime = rep['A'], crime_event(case)
    atts = {a['id']: a for a in case.get('attitudes', [])}
    chain, todo = [], [crime.get('causedBy')]
    while todo:
        a = atts.get(todo.pop())
        if a and a not in chain:
            chain.append(a); todo += list(a.get('because') or [])
    chain += [a for a in case['attitudes'] if a['agent'] == culprit and a['mode'] in ('knows', 'fears') and a not in chain]
    motive = rep['pillar_signs']['motive']
    anchor = max(motive, key=lambda x: A['eff'][x]) if motive else None
    people = {p['id']: p for p in case['people']}
    places = {p['id'] for p in case['setting']['places']}
    item = {'history': _history(case), 'culprit': culprit, 'victim': victim,
            'culprit_reasons': [f"{a['agent']} {a['mode']}: {a['content']}" for a in chain],
            'victim_reasons': [f"{a['mode']}: {a['content']}" for a in case['attitudes'] if a['agent'] == victim],
            'clues': [_public_sign(x) for x in case['signs']], 'anchor': anchor,
            'people': [{'id': p['id'], 'name': p['name'], 'voice': p.get('voice')} for p in case['people'] if p['id'] not in (victim, culprit)],
            'places': sorted(places)}
    def ask(extra=''):
        for _ in range(2):
            o = llm_json(SECRET + extra, json.dumps(item), 5000, model=(CRITIC_MODEL if _ == 0 else __import__("refine").MODEL))
            while isinstance(o, dict) and 'discoverable' not in o and len(o) == 1 and isinstance(next(iter(o.values())), dict):
                o = next(iter(o.values()))
            if isinstance(o, dict) and ('discoverable' in o or o.get('kind')):
                o.setdefault('discoverable', False)
                return o
        return {}
    out = ask()
    # the model's "yes" is checked by code: the clue it cites must share the secret's key words
    names = {w.lower() for p in case['people'] for w in p['name'].split()}
    STOPW = {'about', 'their', 'there', 'which', 'would', 'could', 'before', 'after', 'tonight', 'every', 'being', 'truth', 'secret'}
    key = {w for a in chain if a['mode'] in ('knows', 'fears', 'believes') for w in re.findall(r'[a-z]{5,}', a['content'].lower())
           if w not in names and w not in STOPW}
    signs = {x['id']: x for x in case['signs']}
    cited = signs.get(out.get('by')) if out.get('discoverable') is True else None
    shown = cited and len(key & set(re.findall(r'[a-z]{5,}', (cited.get('text', '') + ' ' + cited.get('title', '')).lower()))) >= 2
    if out.get('discoverable') is True and not shown:
        out = ask('\nA reviewer found that no clue states the substance of the secret: set discoverable false and write the clue.')
    import os
    if os.environ.get('DEBUG_SECRET'): print('  key', sorted(key), 'cited', out.get('by') if cited else None, 'shown', shown, 'out', str(out)[:200])
    case['secret_checked'] = True
    if shown or out.get('discoverable') is True or not anchor:
        return 0
    kind, text = out.get('kind'), str(out.get('text') or '').strip()
    if kind not in ('testimony', 'document') or len(text.split()) < 8 or re.search(r'\d|placeholder|lorem', text, re.I) or len(text.split()) > 80:
        return 0
    sign = {'id': 's_secret', 'kind': kind, 'title': str(out.get('title') or 'The secret')[:60], 'text': text, 'secret': True,
            'requires': [anchor], 'unlock': f"once you have {str(A['signs'][anchor].get('title') or 'that').lower()}, you know what to ask"}
    if kind == 'testimony':
        if out.get('speaker') not in people or out.get('speaker') in (victim, culprit):
            return 0
        sign.update(speaker=out['speaker'], ask=str(out.get('ask') or '').strip()[:140] or None)
    else:
        if out.get('place') not in places:
            return 0
        sign['at'] = out['place']
    import publish
    with publish.SIGNS:
        case['signs'].append(sign)
    return 1
