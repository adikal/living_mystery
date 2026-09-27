"""Publish generated Bellweather cases for the game: for each brief, take the deepest case that the JS kernel
certifies (across every run), give it a stable id and title, and write dist/cases/generated/{id}.json + index.json."""
import glob, json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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
    victim = (FIXED_VICTIM := 'edmund')
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
            case['signs'].insert(0, {'id': f's_surface_{pid}', 'kind': 'testimony', 'speaker': pid, 'surface': True, 'deceptive': pid == truth,
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


def involved_pairs(case):
    """(clue, person) pairs worth a written reaction: people who took part in the clue's source event, the subject of a
    behaviour clue, the teller of a contradicted account, and the culprit for any clue carrying a claim."""
    evs = {e['id']: e for e in case['events']}
    truth = next(h for h in case['question']['candidates'] if h['id'] == case['question']['truth'])['facts']['actor']
    pairs = []
    for x in case['signs']:
        if x['kind'] == 'testimony':
            continue
        who = set()
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
            if pid and pid != 'edmund' and not (x.get('reactions') or {}).get(pid):
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
what really happened (the fatal event) and the certified time window. Write two short texts:
- 'notes': the doctor's written examination notes (2-3 sentences): the general cause of death and the time window.
- 'says': what the doctor says aloud when asked about the body (1-2 sentences, in her voice). Write the placeholder
  {window} exactly where the time of death goes (for example '...sometime {window} last night'); do not write times.
Rules for both: state the cause only in general terms (e.g. 'a heavy blow to the back of the head', 'a poison taken by mouth');
never name or describe a specific weapon, substance or owner, and never name a suspect. Give the window using exactly the
two clock times provided, in words or figures. Return {"notes": "...", "says": "..."}."""


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
    """The body's examination: cause (in general terms) and the time window the kernel already assumes. The window
    claim equals the question's window, so it rules nobody out beyond what certification already assumed; it makes
    that window known to the player, which alibis need."""
    if any(x.get('medical') for x in case['signs']):
        return 0
    from refine import llm_json, CRITIC_MODEL
    q = case['question']
    crime = next(e for e in case['events'] if e['id'] == q['crime']['event'])
    w0, w1 = q['crime']['window']
    hm = lambda m: f"{(int(m) // 60) % 24:02d}:{int(m) % 60:02d}"
    out = llm_json(MEDICAL, json.dumps({'fatal_event': crime.get('summary'), 'window': [hm(w0), hm(w1)],
                                        'victim': 'Edmund Vale'}), 800, model=CRITIC_MODEL)
    notes, says = str(out.get('notes') or '').strip(), str(out.get('says') or '').strip()
    import re
    spoken = f"between {clock_words(w0)} and {clock_words(w1)}"
    says = re.sub(r'\d', '', says) if '{window}' in says else says
    says = says.replace('{window}', spoken) if '{window}' in says else f"{says.rstrip('.')} — sometime {spoken} last night." 
    names = [p['name'].split()[0] for p in case['people'] if p['id'] != 'edmund']
    if not notes or not says or any(n in notes + says for n in names):
        return 0
    claim = {'kind': 'time', 'start': w0, 'end': w1}
    doctor = 'iris' if any(p['id'] == 'iris' for p in case['people']) else None
    case['signs'].insert(0, {'id': 's_medical', 'kind': 'record', 'medical': True, 'at': 'surgery' if doctor else q['crime']['place'],
                             'title': 'The doctor\u2019s examination notes', 'text': notes, 'claim': claim})
    if doctor:
        case['signs'].insert(1, {'id': 's_medical_iris', 'kind': 'testimony', 'medical': True, 'speaker': doctor, 'claim': claim,
                                 'title': 'Dr Marsh on the body', 'text': says, 'ask': 'Doctor, what did you find when you examined Mr Vale?'})
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


def publish_live(case, brief_entry, stamp):
    """Publish one freshly generated case for play: premise, questions, evening accounts, JS certification."""
    title, blurb, place, _ = brief_entry
    case = json.loads(json.dumps(case))
    case['id'] = f'mk-live-{stamp}'
    case['title'] = title
    # the premise may only state what the case records: fall back to a neutral line if the crime moved elsewhere
    case['synopsis'] = blurb if case['question']['crime'].get('place') == place else 'Edmund Vale is dead.'
    add_questions(case, case['synopsis'])
    add_surface_accounts(case)
    add_medical(case)
    add_show_lines(case)
    add_reactions(case)
    os.makedirs(LIVE, exist_ok=True)
    path = f"{LIVE}/{case['id']}.json"
    json.dump(case, open(path, 'w'), indent=1)
    r = js_certify([path])[0]
    if not r['ok']:
        os.remove(path)
        raise ValueError('the published case failed certification: ' + '; '.join(r.get('errors', [])[:3]))
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
        add_questions(case, case.get('synopsis', ''))
        add_surface_accounts(case)
        add_medical(case)
        a, b = add_show_lines(case), add_reactions(case)
        if js_certify_obj(case):
            json.dump(case, open(path, 'w'), indent=1)
        print(f'enriched {os.path.basename(path)}: {a} show lines, {b} reactions')


def js_certify_obj(case):
    import tempfile
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump(case, f)
    try:
        return js_certify([f.name])[0]['ok']
    finally:
        os.remove(f.name)


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
        if os.path.exists(prev) and not os.environ.get('REASK'):   # keep questions already written for this case
            old = {x['id']: x.get('ask') for x in json.load(open(prev))['signs']}
            for x in case['signs']:
                if old.get(x['id']) and not x.get('ask'):
                    x['ask'] = old[x['id']]
        added = add_questions(case, blurb)
        if os.path.exists(prev) and not os.environ.get('RESURFACE'):   # keep surface accounts already written
            kept = [x for x in json.load(open(prev))['signs'] if x.get('surface')]
            truth_actor = next(h for h in case['question']['candidates'] if h['id'] == case['question']['truth'])['facts']['actor']
            for x in kept:
                x['deceptive'] = x['speaker'] == truth_actor   # the culprit's evening account hides the crime
            case['signs'] = kept + [x for x in case['signs'] if not x.get('surface')]
        surfaced = add_surface_accounts(case)
        if os.path.exists(prev):
            med = [x for x in json.load(open(prev))['signs'] if x.get('medical')]
            if med and not any(x.get('medical') for x in case['signs']):
                case['signs'] = med + case['signs']
        add_medical(case)
        if os.path.exists(prev):   # keep lines and reactions already written for this exact case
            old_signs = {x['id']: x for x in json.load(open(prev))['signs']}
            for x in case['signs']:
                o = old_signs.get(x['id'], {})
                for k in ('show', 'confront', 'reactions'):
                    if o.get(k) and not x.get(k):
                        x[k] = o[k]
        shown, reacted = add_show_lines(case), add_reactions(case)
        print(f"  {brief}: {shown} show lines, {reacted} reactions written")
        json.dump(case, open(f'{OUT}/mk-{brief}.json', 'w'), indent=1)
        index.append({'id': case['id'], 'file': f'mk-{brief}.json', 'title': title,
                      'blurb': f"{blurb} Depth {r['solveDepth']}, {len(case['signs'])} clues, {len(case['question']['candidates'])} suspects.",
                      'solveDepth': r['solveDepth'], 'source': os.path.relpath(f, ROOT)})
        print(f"published mk-{brief}: depth {r['solveDepth']}, {len(case['signs'])} clues, {added} questions, {surfaced} surface accounts written <- {os.path.relpath(f, ROOT)}")
    json.dump(index, open(f'{OUT}/index.json', 'w'), indent=1)
    print(f'{len(index)} cases in {os.path.relpath(OUT, ROOT)}/index.json')


if __name__ == '__main__':
    enrich_live() if '--live' in sys.argv else main()
