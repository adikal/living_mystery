"""Publish generated Bellweather cases for the game: for each brief, take the deepest case that the JS kernel
certifies (across every run), give it a stable id and title, and write dist/cases/generated/{id}.json + index.json."""
import glob, json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import enrich
import threading
SIGNS = threading.Lock()   # publish steps run in parallel; sign-list changes are serialised
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = f'{ROOT}/dist/cases/generated'
# Blurbs state only the certified public premise (who is dead, where they were found). Anything more
# (a quarrel, a suspicion) would be an uncertified fact the characters could never confirm.
TITLES = {
    'bw-ledger': ('The Study Door', 'Edmund Vale is found dead in his study at Vale Manor.'),
    'bw-poison': ('A Supper at Vale Manor', 'Edmund Vale died in the night, after supper at Vale Manor.'),
    'bw-pair': ('The Greenhouse Steps', 'Edmund Vale was found at the foot of the greenhouse steps.'),
    'bw-vestry': ('The Vestry Will', 'Edmund Vale was found dead in St. Alden\u2019s vestry.'),
    'bw-inn': ('The Back Parlour', 'Edmund Vale collapsed and died in the back parlour of the Rook & Lantern.'),
    'bw-letter': ('The Half-Burned Letter', 'Edmund Vale was found dead in his study at Vale Manor.'),
}


sys.path.insert(0, os.path.join(ROOT, 'server'))


def gate(case):
    """A case publishes only when the Python kernel, the JS kernel and the Z3 oracle all certify it and agree:
    motive, means and opportunity reachable; the true history possible; only the truth survives."""
    import tempfile
    import case_oracle
    from refine import certify
    py = certify(case)
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump(case, f)
    try:
        js = js_certify([f.name])[0]
    finally:
        os.remove(f.name)
    z = case_oracle.check_case(case)
    errors = [f'python: {e}' for e in py.get('errors', [])] + [f'js: {e}' for e in js.get('errors', [])] + z['errors']
    if py['ok'] and js['ok'] and (py['solve_depth'], py['pillars']) != (js['solveDepth'], js['pillars']):
        errors.append(f"python and js disagree: {py['solve_depth']}/{py['pillars']} vs {js['solveDepth']}/{js['pillars']}")
    return {'ok': not errors, 'errors': errors, 'js': js, 'z3': z}


def js_certify(paths):
    out = subprocess.run(['node', f'{ROOT}/tools/mk-certify.mjs', *paths], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


ASK = """You write the player's lines for a 1920s English village mystery. For each item, write the short, natural
question the detective says aloud to the named character to hear their account. The detective knows ONLY: the premise,
the topic, and the 'known' clues listed with the item. The question must not reveal or presuppose anything from the
account itself. Address the character directly; at most 14 words; end with a question mark. Good: "Mrs Finch, what
did you see in the yard last night?" Bad: "Mrs Finch, what time did Mr Voss leave?" (presupposes the account).
Return {"questions": {"<id>": "<question>"}}."""
TITLE_WORDS = {'Mr', 'Mrs', 'Miss', 'Dr', 'Doctor', 'Constable', 'I', 'Edmund', 'Vale'}


def add_questions(case, synopsis):
    from refine import llm_json, CRITIC_MODEL
    import re
    signs = {x['id']: x for x in case['signs']}
    todo = [x for x in case['signs'] if x['kind'] == 'testimony' and not x.get('ask')]
    if not todo:
        return 0
    names = {p['id']: p['name'] for p in case['people']}
    def known(x):
        return ' '.join([synopsis, x.get('title', '')] + [signs[r].get('text', '') for r in x.get('requires', []) if r in signs])
    items = [{'id': x['id'], 'character': names.get(x['speaker'], x['speaker']), 'topic': x.get('title'), 'known': known(x)} for x in todo]
    out = llm_json(ASK, json.dumps({'premise': synopsis, 'items': items}), 2000, model=CRITIC_MODEL).get('questions', {})
    n = 0
    for x in todo:
        q = str(out.get(x['id'], '')).strip()
        caps = [w for w in re.findall(r"[A-Z][a-z]+", q)[1:] if w not in TITLE_WORDS and w not in names.get(x['speaker'], '')]
        leak = [w for w in caps if w not in known(x)]
        if q.endswith('?') and 3 <= len(q.split()) <= 16 and not leak:
            x['ask'] = q; n += 1
    return n


SURFACE = """You write what each person in a 1920s English village mystery says when first asked "Where were you last
night?". You are given their voice, what they actually did (their own true events), what they want, fear or hide, and
whether they are the culprit. Write 1 to 3 sentences in their voice. Rules:
- The culprit gives a false but vague account that hides the crime and does not prove anything.
- An innocent gives a true but vague account that keeps their private secret hidden.
- No clock times, no numbers, no named witnesses who could confirm it; nothing that would clear or convict anyone.
- Stay consistent with their events and attitudes; do not mention the investigation's clues.
Return {"accounts": {"<person id>": "<what they say>"}}."""


def add_surface_accounts(case):
    from refine import llm_json, CRITIC_MODEL
    import re
    have = {x['speaker'] for x in case['signs'] if x.get('surface')}
    q = case['question']
    truth = next(h for h in q['candidates'] if h['id'] == q['truth'])['facts']['actor']
    people = {p['id']: p for p in case['people']}
    victim = enrich.victim_of(case)
    todo = [p['id'] for p in case['people'] if p['id'] != victim and p['id'] not in have]
    if not todo:
        return 0
    items = [{'id': pid, 'name': people[pid]['name'], 'voice': people[pid].get('voice'), 'culprit': pid == truth,
              'events': [e.get('summary') for e in case['events'] if pid == e.get('agent') or pid in e.get('others', [])],
              'attitudes': [f"{a['mode']}: {a['content']}" for a in case['attitudes'] if a['agent'] == pid]} for pid in todo]
    out = llm_json(SURFACE, json.dumps(items), 2500, model=CRITIC_MODEL).get('accounts', {})
    n = 0
    for pid in todo:
        text = str(out.get(pid, '')).strip()
        if text and not re.search(r'\d', text) and len(text.split()) <= 70:
            with SIGNS: case['signs'].insert(0, {'id': f's_surface_{pid}', 'kind': 'testimony', 'speaker': pid, 'surface': True, 'deceptive': pid == truth,
                                     'title': f"{people[pid]['name']} on the evening", 'text': text, 'ask': 'Where were you last night?'})
            n += 1
    return n


SHOW = """You write the detective's lines for a 1920s English village mystery. For each clue, write what the detective
says aloud when showing it to someone: one or two natural sentences that name what it is and ask about it. Rules:
- Do not read the clue out. Mention only what the detective can see or has read, in their own words.
- 'show' is said to someone OTHER than the person the clue is about: for an account (testimony), it is said to a
  third person and names the speaker ("Constable Bell says he spent the evening at the Rook. Do you know if that's
  true?"); for behaviour, it names the person behaving that way.
- 'confront' is said TO that person: to the speaker of an account ("You told me you went straight home. Is that the
  whole of it?") or to the person whose behaviour it is. Write 'confront' only for accounts and behaviour.
- Add no facts that are not in the clue. At most 35 words each. End with a question mark.
Return {"lines": {"<clue id>": {"show": "...", "confront": "..."}}}."""

REACT = """You write how characters in a 1920s English village mystery react when the detective shows them a clue.
Each item gives the character (voice, what they want, fear or hide, what they did that night), the clue, and how the
character relates to it. Write their spoken reply: one to three sentences in their voice. Rules:
- React to what the clue actually is, from the character's own position and knowledge.
- If the clue contradicts something they told the detective, they concede it, giving their real reason if they have one.
- The culprit never confesses; they deflect or minimise. An innocent keeps their private secret unless the clue exposes it.
- Add no facts about anyone's whereabouts, times or actions beyond the character's own listed events and the clue.
- No clock times or numbers unless they appear in the clue. At most 60 words.
Return {"reactions": {"<clue id>|<person id>": "..."}}."""


def _as_map(value, key_names=('id', 'key'), text_names=('text', 'reaction', 'line', 'reply')):
    """Models return either {id: value} or [{id: .., ...}]: normalise to a dict."""
    while isinstance(value, dict) and len(value) == 1 and next(iter(value)) in ('lines', 'reactions', 'clues', 'items'):
        value = next(iter(value.values()))   # models sometimes nest the wrapper key twice
    if isinstance(value, dict):
        return value
    out = {}
    for item in value or []:
        if isinstance(item, dict):
            k = next((item[n] for n in key_names if n in item), None)
            if k is not None:
                v = next((item[n] for n in text_names if n in item), None)
                out[str(k)] = v if v is not None else item
    return out


def _digits_ok(text, allowed):
    import re
    have = set(re.findall(r'\d+', allowed))
    return all(d in have for d in re.findall(r'\d+', text))


def add_show_lines(case, _retry=True):
    import re
    from refine import llm_json, CRITIC_MODEL
    todo = [x for x in case['signs'] if not x.get('show')]
    if not todo:
        return 0
    names = {p['id']: p['name'] for p in case['people']}
    items = [{'id': x['id'], 'kind': x['kind'], 'title': x.get('title'), 'text': x.get('text'), 'place': x.get('at'),
              'speaker': names.get(x.get('speaker')), 'about': names.get(x.get('about'))} for x in todo]
    raw = llm_json(SHOW, json.dumps(items), 6000, model=CRITIC_MODEL)
    out = _as_map(raw.get('lines', raw.get('clues', {})))
    n = 0
    for x in todo:
        got = out.get(x['id']) or {}
        if isinstance(got, str):
            got = {'show': got}
        for key in ('show', 'confront'):
            line = str(got.get(key) or '').strip()
            if key == 'confront' and x['kind'] not in ('behavior', 'testimony'):
                continue
            # a line said to a third person must not address the speaker or subject as "you"
            if key == 'show' and x['kind'] in ('behavior', 'testimony') and re.search(r"^you\b|\byou('ve| have| had)? (told|said|mentioned|claimed|were|went)\b|\byour\b", line, re.I):
                continue
            if line.endswith('?') and len(line.split()) <= 40 and _digits_ok(line, x.get('text', '')):
                x[key] = line; n += 1
    if n == 0 and _retry:   # an occasional malformed reply: try once more
        return add_show_lines(case, _retry=False)
    return n


SURFACE_TRUTH = """For each person in a 1920s village mystery you get their evening account (what they tell the detective) and what
they really did that evening. Decide whether the account is HONEST (true, even if vague or incomplete: leaving things out
is honest) or a COVER story (it states or clearly implies something false about where they were or what they did).
Return {"verdicts": {"<id>": "honest" | "cover"}}."""


def mark_surface_truth(case):
    """An evening account is deceptive when the speaker's true history contradicts it (not only the culprit's)."""
    from refine import llm_json, CRITIC_MODEL
    import enrich
    ta = enrich.truth_actor(case)
    todo = [x for x in case['signs'] if x.get('surface') and 'surface_checked' not in x]
    if not todo:
        return 0
    items = [{'id': x['speaker'], 'account': x['text'],
              'really': [e.get('summary') for e in case['events'] if x['speaker'] == e.get('agent') or x['speaker'] in e.get('others', [])]}
             for x in todo]
    out = _as_map(llm_json(SURFACE_TRUTH, json.dumps(items), 1500, model=CRITIC_MODEL).get('verdicts', {}))
    n = 0
    for x in todo:
        v = str(out.get(x['speaker'], '')).lower()
        if v not in ('honest', 'cover'):
            continue
        x['deceptive'] = x['speaker'] == ta or v == 'cover'
        x['surface_checked'] = v
        n += 1
    return n


CONCEDE = """In a 1920s English village mystery, a character gave the detective an account that held something back (a name,
or what their words really meant). The detective now shows them a piece of evidence that settles it. Write what the
character says (1-2 sentences, in their voice): they concede plainly what the evidence shows, as the 'meaning' states,
perhaps with a word about why they held back. Add no fact beyond 'meaning' and the evidence; no clock times or numbers
unless they are in the account. Return {"lines": {"<key>": "..."}}."""


def add_concessions(case):
    """x.concede[clue] for every true account with 'needs': what its speaker says when shown the clue that completes it.
    The same sign, so certification is unchanged; it lets the speaker name what they withheld once it is proven."""
    from refine import llm_json, CRITIC_MODEL, claim_true, travel_table, claim_of
    names = {p['id']: p for p in case['people']}
    places = {p['id']: p['name'] for p in case['setting']['places']}
    signs = {x['id']: x for x in case['signs']}
    tt = travel_table(case)
    def meaning(c):
        if c['kind'] == 'place':
            return f"{names[c['person']]['name']} was at {places.get(c['place'], c['place'])} from {clock_words(c['start'])} to {clock_words(c['end'])}"
        return json.dumps(c)
    items, keys = [], []
    for x in case['signs']:
        c = claim_of(x)
        if x['kind'] != 'testimony' or not c or not claim_true(case, c, tt):
            continue
        for n in x.get('needs', []):
            if n in signs and not (x.get('concede') or {}).get(n):
                k = f"{x['id']}|{n}"
                keys.append((x, n, k))
                items.append({'key': k, 'character': names[x['speaker']]['name'], 'voice': names[x['speaker']].get('voice'),
                              'account': x['text'], 'meaning': meaning(c), 'evidence': {'title': signs[n].get('title'), 'text': signs[n].get('text')}})
    if not items:
        return 0
    out = _as_map(llm_json(CONCEDE, json.dumps(items), 4000, model=CRITIC_MODEL).get('lines', {}))
    k_ = 0
    for x, n, k in keys:
        line = str(out.get(k) or '').strip()
        if line and len(line.split()) <= 60 and _digits_ok(line, x.get('text', '')):
            x.setdefault('concede', {})[n] = line; k_ += 1
    return k_


def involved_pairs(case):
    """(clue, person) pairs worth a written reaction: people who took part in the clue's source event, the subject of a
    behaviour clue, the teller of a contradicted account, and the culprit for any clue carrying a claim."""
    evs = {e['id']: e for e in case['events']}
    truth = next(h for h in case['question']['candidates'] if h['id'] == case['question']['truth'])['facts']['actor']
    pairs = []
    for x in case['signs']:
        who = set()
        if x['kind'] == 'testimony':
            # an account shown to others: the person it places, the culprit if it bears on them, anyone it contradicts
            c = x.get('claim') or {}
            if c.get('person') and c['person'] != x.get('speaker'):
                who.add(c['person'])
            if x.get('defeats'):
                who.add(truth)
            for d in x.get('defeats', []):
                t = next((y for y in case['signs'] if y['id'] == d and y['kind'] == 'testimony'), None)
                if t:
                    who.add(t['speaker'])
            who.discard(x.get('speaker'))
            for pid in who:
                if pid and pid != enrich.victim_of(case) and not (x.get('reactions') or {}).get(pid):
                    pairs.append((x, pid))
            continue
        src = evs.get(x.get('source'))
        if src:
            who |= {src.get('agent'), *src.get('others', [])}
        if x['kind'] == 'behavior' and x.get('about'):
            who.add(x['about'])
        for d in x.get('defeats', []):
            t = next((y for y in case['signs'] if y['id'] == d and y['kind'] == 'testimony'), None)
            if t:
                who.add(t['speaker'])
        if x.get('claim'):
            who.add(truth)
        for pid in who:
            if pid and pid != enrich.victim_of(case) and not (x.get('reactions') or {}).get(pid):
                pairs.append((x, pid))
    return pairs


def add_reactions(case):
    from refine import llm_json, CRITIC_MODEL
    pairs = involved_pairs(case)
    if not pairs:
        return 0
    people = {p['id']: p for p in case['people']}
    evs = {e['id']: e for e in case['events']}
    truth = next(h for h in case['question']['candidates'] if h['id'] == case['question']['truth'])['facts']['actor']
    def own_events(pid):
        return [e.get('summary') for e in case['events'] if e.get('agent') == pid or pid in e.get('others', [])]
    def relation(x, pid):
        r = []
        src = evs.get(x.get('source'))
        if src and (src.get('agent') == pid or pid in src.get('others', [])):
            r.append(f"took part in what produced it: {src.get('summary')}")
        if x['kind'] == 'behavior' and x.get('about') == pid:
            r.append('it describes their own behaviour')
        for d in x.get('defeats', []):
            t = next((y for y in case['signs'] if y['id'] == d and y.get('speaker') == pid), None)
            if t:
                r.append(f"it contradicts what they told the detective: {t.get('text')}")
            u = next((y for y in case['signs'] if y['id'] == d), None)
            if u and (u.get('claim') or {}).get('person') == pid and pid == truth:
                r.append(f"it breaks the account that placed them elsewhere: {u.get('text')}")
        if x['kind'] == 'testimony':
            r.append(f"it is what {people[x['speaker']]['name']} told the detective")
        if pid == truth:
            r.append('they are the culprit')
        return r
    out = {}
    for i in range(0, len(pairs), 18):
        chunk = pairs[i:i + 18]
        items = [{'key': f"{x['id']}|{pid}", 'character': people[pid]['name'], 'voice': people[pid].get('voice'),
                  'attitudes': [f"{a['mode']}: {a['content']}" for a in case['attitudes'] if a['agent'] == pid],
                  'their_events': own_events(pid), 'clue': {'kind': x['kind'], 'title': x.get('title'), 'text': x.get('text')},
                  'relation': relation(x, pid)} for x, pid in chunk]
        raw = llm_json(REACT, json.dumps(items), 8000, model=CRITIC_MODEL)
        out.update({k: (v if isinstance(v, str) else (v or {}).get('text', '')) for k, v in _as_map(raw.get('reactions', {})).items()})
    n = 0
    for x, pid in pairs:
        text = str(out.get(f"{x['id']}|{pid}") or '').strip()
        allowed = ' '.join([x.get('text', '')] + [str(e) for e in own_events(pid)])
        if text and len(text.split()) <= 70 and _digits_ok(text, allowed):
            x.setdefault('reactions', {})[pid] = text; n += 1
    return n


MEDICAL = """You write the village doctor's findings after examining the body in a 1920s English village mystery. You get
what really happened (the fatal event), whether death came at once or hours later (delayed), and the method type.
Write two short texts:
- 'notes': the doctor's written examination notes (2-3 sentences).
- 'says': what the doctor says aloud when asked about the body (1-2 sentences, in her voice).
Use these placeholders exactly and write no clock times or numbers yourself:
  {death}  - when death occurred (only if delayed is true)
  {window} - when the fatal act happened: the blow, the fall, or (if delayed) when the poison was taken
If delayed is true, say he died around {death} and that the poison (or cause) was taken some hours earlier, {window}.
If delayed is false, say death occurred {window}. Never say "shortly before death" for a delayed death.
State the cause only in general terms (e.g. 'a heavy blow to the back of the head', 'a poison taken by mouth'); never
name or describe a specific weapon, substance, container or owner, and never name anyone but the deceased.
Return {"notes": "...", "says": "..."}."""

MEDICAL_V = 2

NUM = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
       'fourteen', 'quarter', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two',
       'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine', 'half']


def clock_words(minute):
    """Minutes after midnight -> spoken 1920s clock time ('five to eleven', 'twenty past eleven'), computed, never guessed."""
    m = int(round(minute)) % 1440
    h, mm = (m // 60) % 12 or 12, m % 60
    nxt = h % 12 + 1
    if mm == 0:
        return f"{NUM[h]} o'clock"
    return f"{NUM[mm]} past {NUM[h]}" if mm <= 30 else f"{NUM[60 - mm]} to {NUM[nxt]}"


def add_medical(case):
    """The body's examination: cause (in general terms), when death came and when the fatal act happened. The
    time claim equals the question's crime window, so it rules nobody out beyond what certification already
    assumed; it makes that window known to the player, which alibis need. For a delayed death (poison) the doctor
    gives the time of death and places the fatal dose hours earlier, in the window."""
    import re
    from refine import llm_json, CRITIC_MODEL
    import enrich
    old = [x for x in case['signs'] if x.get('medical')]
    if old and all(x.get('medical_v') == MEDICAL_V for x in old):
        return 0
    q = case['question']
    crime = enrich.crime_event(case)
    victim = enrich.victim_of(case)
    vname = next((p['name'] for p in case['people'] if p['id'] == victim), 'the deceased')
    vaddr = next((p.get('address') or p['name'] for p in case['people'] if p['id'] == victim), 'the body')
    w0, w1 = q['crime']['window']
    death = next((e for e in case['events'] if (e.get('type') == 'death' or e.get('kind') == 'death') and e.get('agent') == victim), None)
    delayed = bool(death and death['start'] - crime['end'] > 45)
    method = (case.get('answer') or {}).get('method')
    for _ in range(3):
        out = llm_json(MEDICAL, json.dumps({'fatal_event': crime.get('summary'), 'delayed': delayed, 'method': method,
                                            'victim': vname}), 800, model=CRITIC_MODEL)
        notes, says = str(out.get('notes') or '').strip(), str(out.get('says') or '').strip()
        if not notes or not says or '{window}' not in says or (delayed and '{death}' not in says) or re.search(r'\d', notes + says):
            continue
        if not delayed and '{death}' in notes + says:
            continue
        if delayed and re.search(r'shortly before (his |her )?death', notes + says, re.I):
            continue
        fill = lambda t: t.replace('{window}', f"between {clock_words(w0)} and {clock_words(w1)}").replace(
            '{death}', clock_words(death['start']) if death else '')
        notes, says = fill(notes), fill(says)
        mine = set(vname.split())
        others = [w for p in case['people'] if p['id'] != victim for w in p['name'].replace('Dr ', '').split() if w not in mine]
        if any(re.search(rf'\b{re.escape(w)}\b', notes + says) for w in others):
            continue
        break
    else:   # the model's text failed the checks three times: the doctor's findings are written by code
        cause = {'poison': 'a poison taken by mouth', 'blow': 'a heavy blow to the head', 'fall': 'injuries from a fall',
                 'smother': 'suffocation', 'drown': 'drowning', 'blade': 'a stab wound', 'gun': 'a gunshot wound',
                 'gas': 'breathing gas or fumes', 'staged': 'injuries made to look like an accident'}.get(method, 'unnatural causes')
        span = f"between {clock_words(w0)} and {clock_words(w1)}"
        if delayed:
            says = f"Death came at about {clock_words(death['start'])}, from {cause}, but it was taken some hours before that, {span}."
        else:
            says = f"Death was from {cause}, and it occurred {span}."
        notes = f"Examination of the deceased shows {cause}. " + says
    with SIGNS:
        case['signs'][:] = [x for x in case['signs'] if not x.get('medical')]
    claim = {'kind': 'time', 'start': w0, 'end': w1}
    doctor = 'iris' if any(p['id'] == 'iris' for p in case['people']) and victim != 'iris' else None
    SIGNS.acquire()
    case['signs'].insert(0, {'id': 's_medical', 'kind': 'record', 'medical': True, 'medical_v': MEDICAL_V,
                             'at': 'surgery' if doctor else q['crime']['place'],
                             'title': 'The doctor\u2019s examination notes', 'text': notes, 'claim': claim})
    if doctor:
        case['signs'].insert(1, {'id': 's_medical_iris', 'kind': 'testimony', 'medical': True, 'medical_v': MEDICAL_V,
                                 'speaker': doctor, 'claim': claim, 'title': 'Dr Marsh on the body', 'text': says,
                                 'ask': f"Doctor, what did you find when you examined {vaddr}?"})
    SIGNS.release()
    return 1


LIVE = f'{OUT}/live'
# Briefs for on-demand generation: (title, public premise, where the body is found, brief for the generator).
LIVE_BRIEFS = [
    ('The Study Door', 'Edmund Vale is found dead in his study at Vale Manor.', 'manor',
     'Edmund Vale is found dead in his study at Vale Manor. Question: who killed him? The culprit is not the person the village first suspects.'),
    ('A Supper at Vale Manor', 'Edmund Vale died in the night, after supper at Vale Manor.', 'manor',
     'Edmund Vale dies in the night after a supper at Vale Manor; the doctor suspects poison. Question: who poisoned him?'),
    ('The Greenhouse Steps', 'Edmund Vale was found at the foot of the greenhouse steps.', 'greenhouse',
     'Edmund Vale is found at the foot of the greenhouse steps, apparently a fall. Question: who caused his death? Someone in the village is protecting the culprit.'),
    ('The Vestry Will', 'Edmund Vale was found dead in St. Alden\u2019s vestry.', 'vestry',
     'Edmund Vale is found dead in St. Alden\u2019s vestry, where he had gone to amend his will. Question: who killed him? An old wrong from twenty years ago is behind it.'),
    ('The Back Parlour', 'Edmund Vale collapsed and died in the back parlour of the Rook & Lantern.', 'inn',
     'Edmund Vale collapses and dies in the back parlour of the Rook & Lantern. Question: who killed him? More than one person lies that night, for different reasons.'),
    ('The Surgery Night', 'Edmund Vale was found dead outside Dr Marsh\u2019s surgery.', 'surgery',
     'Edmund Vale is found dead on the step of Dr Marsh\u2019s surgery, where he had gone late at night. Question: who killed him? The person with the most obvious motive did not do it.'),
    ('Market Morning', 'Edmund Vale was found dead in the village square at first light.', 'square',
     'Edmund Vale is found dead in the village square at first light. Question: who killed him? Two people saw something and each misunderstood it.'),
]


def enrich_case(case, log=print):
    """Every publish-time step, in order; each only fills what is missing. Then review what was written against the
    true history, repair once, and drop anything still faulty (the game falls back to templates)."""
    import concurrent.futures as cf
    enrich.add_answer(case)                            # the examination wording depends on the method
    enrich.add_motive_link(case)                       # the motive must connect the culprit to THIS victim
    enrich.add_secret_clue(case)                       # and what the secret is must be discoverable in play
    # independent steps, in parallel: each writes to its own part of the case
    with cf.ThreadPoolExecutor(8) as ex:
        for f in [ex.submit(fn, case) for fn in (add_surface_accounts, add_medical, add_concessions, enrich.add_knowledge,
                                                  enrich.add_moods, enrich.add_loose_ends, add_show_lines)]:
            f.result()
    with cf.ThreadPoolExecutor(3) as ex:               # these need the accounts written above
        for f in [ex.submit(mark_surface_truth, case), ex.submit(add_questions, case, case.get('synopsis', '')), ex.submit(add_reactions, case)]:
            f.result()
    add_show_lines(case)                               # lines for accounts added above
    for round_ in range(2):
        problems = enrich.review_publish(case)
        if problems:
            log(f'  review round {round_ + 1}: {len(problems)} lines dropped: ' + '; '.join(f'{k}: {v}' for k, v in list(problems.items())[:4]))
        if not problems:
            break
        add_medical(case); add_concessions(case); add_show_lines(case); add_reactions(case)
    return case


def publish_live(case, brief_entry, stamp):
    """Publish one freshly generated case for play: premise, questions, evening accounts, JS certification."""
    title, blurb, place, _ = brief_entry
    case = json.loads(json.dumps(case))
    case['id'] = f'mk-live-{stamp}'
    pr = case.get('premise')
    if pr:   # the premise deck fixed who, how and why: the answer is known, the title comes from the story
        case['answer'] = {'method': pr['method'], 'motive': pr['motive']}
        case['victim'] = pr['victim']
        title = str(case.get('title') or '').strip()[:60] or title
        if any(n in title for n in {w for p in case['people'] for w in p['name'].split()}):
            import premise as P
            where = P.at(place)
            title = 'Death at ' + (' '.join(w[:1].upper() + w[1:] if i else w for i, w in enumerate(where.split())) if where.startswith('the ') else where)
    case['title'] = title
    # the premise may only state what the case records: fall back to a neutral line if the crime moved elsewhere
    vname = next((p['name'] for p in case['people'] if p['id'] == enrich.victim_of(case)), 'Edmund Vale')
    case['synopsis'] = blurb if case['question']['crime'].get('place') == place else f'{vname} is dead.'
    enrich_case(case)
    os.makedirs(LIVE, exist_ok=True)
    path = f"{LIVE}/{case['id']}.json"
    g = gate(case)
    if not g['ok']:
        raise ValueError('the published case failed certification: ' + '; '.join(g['errors'][:3]))
    r = g['js']
    json.dump(case, open(path, 'w'), indent=1)
    if pr:
        import premise as P
        P.remember(pr)
    idx_path = f'{LIVE}/index.json'
    index = json.load(open(idx_path)) if os.path.exists(idx_path) else []
    entry = {'id': case['id'], 'file': f"live/{case['id']}.json", 'title': title, 'solveDepth': r['solveDepth'],
             'blurb': f"{case['synopsis']} Depth {r['solveDepth']}, {len(case['signs'])} clues, {len(case['question']['candidates'])} suspects.",
             'generated': stamp}
    index = [entry] + [e for e in index if e['id'] != case['id']]
    json.dump(index[:30], open(idx_path, 'w'), indent=1)
    return entry, r


def enrich_live():
    """Add show lines and reactions to cases already generated on this machine."""
    for path in sorted(glob.glob(f'{LIVE}/mk-live-*.json')):
        case = json.load(open(path))
        enrich_case(case)
        a = sum(1 for x in case['signs'] if x.get('show')); b = sum(len(x.get('reactions') or {}) for x in case['signs'])
        g = gate(case)
        if g['ok']:
            json.dump(case, open(path, 'w'), indent=1)
        else:
            print('  NOT saved:', g['errors'][:3])
        print(f'enriched {os.path.basename(path)}: {a} show lines, {b} reactions')


def js_certify_obj(case):
    import tempfile
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump(case, f)
    try:
        return js_certify([f.name])[0]['ok']
    finally:
        os.remove(f.name)


CARRY_SIGN_KEYS = ('ask', 'show', 'confront', 'reactions', 'concede', 'surface_checked')
CARRY_CASE_KEYS = ('answer', 'reviewed', 'loose_ends_checked', 'secret_checked', 'knowledge', 'moods', 'victim', 'premise')


def carry_over(case, prev):
    """Keep what publishing already wrote for this exact case: added signs and per-sign lines."""
    added = [x for x in prev['signs'] if (x.get('surface') or x.get('medical') or x.get('loose_end') or x.get('motive_link') or x.get('secret'))
             and not any(y['id'] == x['id'] for y in case['signs'])]
    case['signs'] = added + case['signs']
    for x in added:   # a linking clue's relation is part of the case's world facts
        c = x.get('claim') or {}
        if x.get('motive_link') and c.get('kind') == 'relation':
            rel = {'a': c['a'], 'rel': c['rel'], 'b': c['b']}
            if rel not in case.get('relations', []):
                case.setdefault('relations', []).append(rel)
    old = {x['id']: x for x in prev['signs']}
    for x in case['signs']:
        o = old.get(x['id'], {})
        for k in CARRY_SIGN_KEYS:
            if o.get(k) and not x.get(k):
                x[k] = o[k]
        if o.get('surface_checked'):
            x['deceptive'] = o.get('deceptive')
    for k in CARRY_CASE_KEYS:
        if prev.get(k) is not None and case.get(k) is None:
            case[k] = prev[k]
    return case


def main():
    best = {}
    for brief in TITLES:
        files = sorted(glob.glob(f'{HERE}/runs/*/{brief}/final-case.json'))
        if not files:
            continue
        for f, r in zip(files, js_certify(files)):
            if r['ok'] and (brief not in best or (r['solveDepth'], len(json.load(open(f))['signs'])) > best[brief][1]):
                best[brief] = (f, (r['solveDepth'], len(json.load(open(f))['signs'])), r)
    os.makedirs(OUT, exist_ok=True)
    index = []
    for brief, (f, _, r) in sorted(best.items()):
        case = json.load(open(f))
        title, blurb = TITLES[brief]
        case['id'], case['title'], case['synopsis'] = f'mk-{brief}', title, blurb
        prev = f'{OUT}/mk-{brief}.json'
        if os.path.exists(prev):
            carry_over(case, json.load(open(prev)))
        enrich_case(case)
        g = gate(case)
        if not g['ok']:
            print(f'  mk-{brief} NOT published: {g["errors"][:3]}')
            if os.path.exists(prev):
                index.append(next((e for e in json.load(open(f'{OUT}/index.json')) if e['id'] == case['id']), None))
            continue
        r = g['js']
        json.dump(case, open(prev, 'w'), indent=1)
        index.append({'id': case['id'], 'file': f'mk-{brief}.json', 'title': title,
                      'blurb': f"{blurb} Depth {r['solveDepth']}, {len(case['signs'])} clues, {len(case['question']['candidates'])} suspects.",
                      'solveDepth': r['solveDepth'], 'source': os.path.relpath(f, ROOT)})
        print(f"published mk-{brief}: depth {r['solveDepth']}, pillars {r['pillars']}, {len(case['signs'])} clues <- {os.path.relpath(f, ROOT)}")
    json.dump([e for e in index if e], open(f'{OUT}/index.json', 'w'), indent=1)
    print(f'{len(index)} cases in {os.path.relpath(OUT, ROOT)}/index.json')


if __name__ == '__main__':
    enrich_live() if '--live' in sys.argv else main()
