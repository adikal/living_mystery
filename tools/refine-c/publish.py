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


SURFACE = """You write what each suspect in a 1920s English village mystery says when first asked "Where were you last
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
    todo = [h['facts']['actor'] for h in q['candidates'] if h['facts']['actor'] not in have]
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
        json.dump(case, open(f'{OUT}/mk-{brief}.json', 'w'), indent=1)
        index.append({'id': case['id'], 'file': f'mk-{brief}.json', 'title': title,
                      'blurb': f"{blurb} Depth {r['solveDepth']}, {len(case['signs'])} clues, {len(case['question']['candidates'])} suspects.",
                      'solveDepth': r['solveDepth'], 'source': os.path.relpath(f, ROOT)})
        print(f"published mk-{brief}: depth {r['solveDepth']}, {len(case['signs'])} clues, {added} questions, {surfaced} surface accounts written <- {os.path.relpath(f, ROOT)}")
    json.dump(index, open(f'{OUT}/index.json', 'w'), indent=1)
    print(f'{len(index)} cases in {os.path.relpath(OUT, ROOT)}/index.json')


if __name__ == '__main__':
    main()
