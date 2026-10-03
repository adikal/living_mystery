"""Generate Bellweather art for new people and places with Stability Style Guide on Amazon Bedrock.

Each asset uses an existing approved image of the same kind as the style reference (low fidelity, so style carries
over but identity does not), the recorded prompt template (docs/art/generation-manifest.json), and several
candidates. Candidates land in tools/art/out/<id>-<n>.jpg; pick with --choose id=n, which packages the chosen one
(256 px portraits, 640 px locations) into dist/assets/last-bell/ and records it in the manifest.

  .venv/bin/python tools/art/generate.py              # generate candidates for every missing asset
  .venv/bin/python tools/art/generate.py vicar mill   # only these
  .venv/bin/python tools/art/generate.py --choose vicar=2 mill=1
  .venv/bin/python tools/art/generate.py --auto obj-coin vera   # generate, a vision model picks, package if it passes
"""
import base64
import concurrent.futures as cf
import json
import os
import subprocess
import sys

import boto3

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'tools', 'art', 'out')
ASSETS = os.path.join(ROOT, 'dist', 'assets', 'last-bell')
MANIFEST = os.path.join(ROOT, 'docs', 'art', 'generation-manifest.json')
MODEL = 'us.stability.stable-image-style-guide-v1:0'
N = 3

STYLE = ('Hand painted gouache and ink illustration, subdued jewel colours, warm lamplight and cool slate shadows, '
         'clear silhouettes, inviting mysterious English village atmosphere, 1932.')
PORTRAIT = ('Head and shoulders portrait, centred, eyes at 38 percent height, head about half the width, plain muted '
            'slate backdrop with soft vignette. {subject}. ' + STYLE + ' Square, full bleed, no frame.')
OBJECT = ('Still life of ONE single object only, isolated on plain parchment, centred, filling the frame, soft warm daylight. No buildings, no street, no houses, no landscape, no people, no hands. {subject}. ' + STYLE + ' Square, full bleed, generous margin.')
PLACE = ('Atmospheric establishing scene, landscape, large recognisable shapes, no people. {subject}. ' + STYLE + ' Full bleed.')
NEGATIVE = ['houses', 'buildings', 'street', 'village', 'landscape', 'sky', 'person', 'face', 'hands', 'text', 'letters', 'words', 'caption',
            'watermark', 'signature', 'frame', 'border', 'panel', 'collage', 'photo', '3d render', 'extra people', 'deformed hands']
WRITING = ['letters', 'text', 'words']          # an object that carries writing must be allowed to show it


LIGHTS = ['lamp', 'light bulb', 'candle', 'flame']   # objects only: the painted style otherwise adds a lamp to every still life
OBJECT_STYLE = STYLE.replace('warm lamplight', 'warm light')


def negative(allow=(), kind='object'):
    terms = NEGATIVE + (LIGHTS if kind == 'object' else [])
    return ', '.join(t for t in terms if t not in set(allow))

SUBJECTS = {
    'detective': ('portrait', 'silas', 'The detective, a sharp-eyed investigator in their forties, calm and attentive, dark overcoat with raised collar and a grey trilby hat, a notebook in the breast pocket'),
    'obj-note': ('object', 'obj-bottle', 'a small torn scrap of notepaper with pencil writing'),
    'obj-key': ('object', 'obj-bottle', 'an old iron door key on a ring'),
    'obj-glove': ('object', 'obj-bottle', 'a single grey kid leather lady’s glove'),
    'obj-bottle': ('object', 'obj-bottle', 'a small brown glass medicine bottle with a paper label and cork'),
    'obj-footprint': ('object', 'obj-bottle', 'a muddy boot print on a flagstone floor, seen from above'),
    'obj-ledger': ('object', 'obj-bottle', 'a thick open account ledger with columns of ink figures'),
    'obj-watch': ('object', 'obj-bottle', 'a brass pocket watch with a cracked glass'),
    'obj-cloak': ('object', 'obj-bottle', 'a grey wool hooded cloak folded over a chair'),
    'obj-knife': ('object', 'obj-bottle', 'a small folding pocket knife, closed'),
    'obj-tin': ('object', 'obj-bottle', 'a small round tin with a pressed lid'),
    'obj-basin': ('object', 'obj-bottle', 'an enamel washbasin with a jug'),
    'obj-lamp': ('object', 'obj-bottle', 'a brass oil lamp with a glass chimney', ['lamp', 'flame']),
    'obj-rope': ('object', 'obj-bottle', 'a coil of old hemp rope'),
    'obj-oar': ('object', 'obj-bottle', 'a wooden rowing oar lying flat'),
    'obj-book': ('object', 'obj-bottle', 'a closed leather-bound book'),
    'obj-diary': ('object', 'obj-bottle', 'a small open diary with ribbon marker and handwriting'),
    'obj-candle': ('object', 'obj-bottle', 'a half-burnt candle in a brass candlestick', ['candle', 'flame']),
    'obj-bag': ('object', 'obj-bottle', 'a battered leather doctor’s bag, closed'),
    'obj-glass': ('object', 'obj-bottle', 'an empty cut-glass brandy tumbler'),
    'obj-gun': ('object', 'obj-bottle', 'an old service revolver lying on a cloth'),
    'obj-flowers': ('object', 'obj-bottle', 'a small bunch of garden flowers tied with string'),
    'obj-register': ('object', 'obj-bottle', 'a large open parish register'),
    # objects that first came out wrong, redone (October 2026), and twenty new ones
    'obj-letter': ('object', 'obj-bottle', 'a folded handwritten letter on cream paper with a broken red wax seal, lying flat', ['letters', 'text', 'words']),
    'obj-slate': ('object', 'obj-bottle', 'a small wooden-framed school slate lying flat, white chalk tally marks on it', ['letters', 'text', 'words']),
    'obj-ticket': ('object', 'obj-bottle', 'a small stiff pasteboard railway ticket with printing and a punched hole, lying flat', ['letters', 'text', 'words']),
    'obj-receipt': ('object', 'obj-bottle', 'a small torn paper receipt with a pencilled sum and a scrawled signature, lying flat', ['letters', 'text', 'words']),
    'obj-envelope': ('object', 'obj-bottle', 'a sealed cream envelope with a red wax seal and a postage stamp, addressed in ink, lying flat', ['letters', 'text', 'words']),
    'obj-photo': ('object', 'obj-bottle', 'an old sepia photograph of a couple in a small standing silver frame', ['frame', 'photo']),
    'obj-button': ('object', 'obj-bottle', 'one large brass coat button with an anchor emblem, close-up, filling the frame', []),
    'obj-handkerchief': ('object', 'obj-bottle', 'a neatly folded white linen handkerchief with lace edging and an embroidered initial in one corner', []),
    'obj-notes': ('object', 'obj-bottle', 'a doctor’s case notes: a few handwritten sheets clipped together, a fountain pen lying across them', ['letters', 'text', 'words']),
    'obj-coin': ('object', 'obj-bottle', 'a painted study of one worn silver coin with a king\u2019s profile, seen from above, flat brushwork', []),
    'obj-ashes': ('object', 'obj-bottle', 'a single sheet of old paper lying flat, its edges blackened and crumbling brown, a dark scorched hole in one corner, on bare parchment', []),
    'obj-telephone': ('object', 'obj-bottle', 'an old black upright desk telephone of the 1920s, a tall stem with a mouthpiece, its earpiece hanging on a cord', []),
    'obj-telegram': ('object', 'obj-bottle', 'a buff Post Office telegram form folded once, with pasted strips of printed tape', ['letters', 'text', 'words']),
    'obj-cashbox': ('object', 'obj-bottle', 'a small black japanned metal cash box with a brass handle, lid closed', []),
    'obj-notebook': ('object', 'obj-bottle', 'a small black pocket notebook held shut with an elastic band, a stub of pencil beside it', []),
    'obj-door': ('object', 'obj-bottle', 'a heavy oak door seen close up, with an iron lock plate and a dark keyhole', []),
    'obj-hook': ('object', 'obj-bottle', 'an empty iron hook on a whitewashed wall, a pale outline on the wall where something used to hang', []),
    'obj-sacking': ('object', 'obj-bottle', 'a lumpy bundle wrapped in rough hessian sacking and tied with twine', []),
    'obj-stairs': ('object', 'obj-bottle', 'the foot of a narrow wooden staircase with worn treads, seen from below', []),
    'obj-card': ('object', 'obj-bottle', 'a small printed scoring card with pencilled tallies in its columns, lying flat', ['letters', 'text', 'words']),
    'obj-timetable': ('object', 'obj-bottle', 'a printed railway timetable sheet pinned to a small wooden board', ['letters', 'text', 'words']),
    'obj-suitcase': ('object', 'obj-bottle', 'a battered leather travelling suitcase with brass catches and old paper luggage labels', ['letters', 'text', 'words']),
    'obj-badge': ('object', 'obj-bottle', 'one small brass regimental badge on its own, a crown above a wreath, close-up (only the badge, no cap)', []),
    'obj-cigarette-case': ('object', 'obj-bottle', 'a slim engraved silver cigarette case, closed', []),
    'obj-spectacles': ('object', 'obj-bottle', 'a pair of round wire-rimmed spectacles, folded', []),
    'obj-inkwell': ('object', 'obj-bottle', 'a glass inkwell and a dip pen standing on an ink-stained blotter', []),
    'obj-spade': ('object', 'obj-bottle', 'a garden spade with a worn wooden handle, clods of earth on the blade', []),
    'obj-matchbox': ('object', 'obj-bottle', 'a small open matchbox of the 1930s with a few red-tipped matches spilling out', []),
    # the newcomer (October 2026)
    'vera': ('portrait', 'clara', 'Mrs Vera Lacey, a handsome, self-possessed widow of about forty, dark bobbed hair touched with grey, arched brows and a knowing half-smile, a plum cloche hat and a fur-collared travelling coat, pearl earrings'),
    'edmund': ('portrait', 'bell', 'Edmund Vale, a stout, broad-faced, heavy-set proud country squire in his fifties, round ruddy cheeks and double chin, thinning sandy-grey hair, big walrus moustache, brown checked tweed shooting jacket and mustard waistcoat, no tie'),
    'vicar': ('portrait', 'bell', 'The Reverend Thomas Hale, a gentle elderly village vicar, thin and stooped, white hair, round wire spectacles, black cassock with a white clerical dog collar, no tie'),
    'dora': ('portrait', 'iris', 'Dorothy Pruett, a prim thin postmistress in her forties, hair in a tight bun, pince-nez spectacles, high-collared navy blouse with a cameo brooch'),
    'jonah': ('portrait', 'rowan', 'Jonah Reed, a weathered old river boatman, grey stubble, deep lines, knitted navy fisherman\u2019s sweater and a flat cap'),
    'hugo': ('portrait', 'clara', 'Hugo Vale, a boyish clean-shaven young man of twenty-two from London, fair blond hair falling over his forehead, cheeky grin, cream-and-navy striped boating blazer, open white shirt collar with a loosely knotted red silk cravat, no tie, no dark suit'),
    'halt': ('location', 'square', 'A tiny rural railway halt at dusk: a single wooden platform, a gas lamp, a timetable board, a small brick lamp room, rails curving into misty fields'),
    'post': ('location', 'surgery', 'Interior of a small village post office: wooden counter with brass scales, wall of sorting pigeonholes, a telegraph key on the desk, warm lamplight'),
    'mill': ('location', 'greenhouse', 'A disused stone watermill on a river at twilight: a still wooden waterwheel, a rusted sluice gate, fast dark water in the mill race'),
    'boathouse': ('location', 'manor', 'Interior of an old timber boathouse on a river: skiffs on trestles, oars racked on the wall, a punt moored at a wooden landing stage, lantern light on dark water'),
}


def client():
    return boto3.client('bedrock-runtime', region_name='us-west-2')


def reference(ref_id):
    return base64.b64encode(open(os.path.join(ASSETS, f'{ref_id}.jpg'), 'rb').read()).decode()


def generate(aid, n=None):
    n = n or N
    kind, ref, subject, allow = spec(aid)
    prompt = template(kind).format(subject=subject)
    model, body = request(kind, ref, prompt, allow)
    c = client()
    os.makedirs(OUT, exist_ok=True)
    def one(i):
        import time
        for wait in (0, 10, 20, 40, 60):
            time.sleep(wait)
            try:
                r = c.invoke_model(modelId=model, body=json.dumps({**body, 'seed': 1000 + i})); break
            except (c.exceptions.ServiceUnavailableException, c.exceptions.ThrottlingException):
                continue
        else:
            raise RuntimeError(f'{aid}-{i}: image service busy')
        img = json.loads(r['body'].read())['images'][0]
        path = os.path.join(OUT, f'{aid}-{i}.jpg')
        open(path, 'wb').write(base64.b64decode(img))
        return path
    paths = [one(i) for i in range(1, n + 1)]
    return {'id': aid, 'kind': kind, 'subject': subject, 'prompt': prompt, 'reference': f'dist/assets/last-bell/{ref}.jpg', 'candidates': paths}


# Objects are drawn from text alone: with a style reference the Style Guide copies the reference's content (a bottle or a
# lamp turns up in every still life). The library's look is spelled out in the prompt instead.
OBJECT_MODEL = 'stability.stable-image-ultra-v1:1'
OBJECT_LOOK = ('Vintage storybook illustration painted in muted gouache with fine ink outlines on an aged sepia parchment '
               'ground, dusty red, slate grey, olive and brass tones, visible brush texture, soft grey drop shadow, gently worn edges. 1932.')
OBJECT_TEXT = 'A single object, centred and filling most of the frame, isolated on plain parchment: {subject}. Nothing else in the picture. ' + OBJECT_LOOK


def template(kind):
    return {'portrait': PORTRAIT, 'location': PLACE, 'object': OBJECT_TEXT}[kind]


def request(kind, ref, prompt, allow):
    """(model, body) for an asset: text-to-image for objects, the style-referenced Style Guide for portraits and places."""
    if kind == 'object':
        return OBJECT_MODEL, {'prompt': prompt, 'negative_prompt': negative(allow, kind) + ', photograph, photorealistic',
                              'aspect_ratio': '1:1', 'output_format': 'jpeg'}
    return MODEL, {'prompt': prompt, 'image': reference(ref), 'fidelity': 0.35, 'negative_prompt': negative(allow, kind),
                   'aspect_ratio': '3:2' if kind == 'location' else '1:1', 'output_format': 'jpeg'}


def spec(aid):
    """(kind, style reference, subject, negative-prompt terms allowed) for an asset."""
    kind, ref, subject, *rest = SUBJECTS[aid]
    return kind, ref, subject, set(rest[0]) if rest else set()


def choose(aid, n, review='chosen from a contact sheet'):
    kind, ref, subject, _ = spec(aid)
    src = os.path.join(OUT, f'{aid}-{n}.jpg')
    dst = os.path.join(ASSETS, f'{aid}.jpg')
    size = '640' if kind == 'location' else '256'
    subprocess.run(['sips', '-Z', size, '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', src, '--out', dst], check=True, capture_output=True)
    m = json.load(open(MANIFEST))
    m['assets'] = [a for a in m['assets'] if a['id'] != aid] + [{
        'id': aid, 'kind': kind, 'subject': subject,
        'prompt': template(kind).format(subject=subject),
        'source': (f'Stability Image Ultra ({OBJECT_MODEL}), text only, candidate {n} of {N}' if kind == 'object' else
                   f'Stability Style Guide ({MODEL}), style reference dist/assets/last-bell/{ref}.jpg, fidelity 0.35, candidate {n} of {N}'),
        'output': f'dist/assets/last-bell/{aid}.jpg', 'packaging': f'{size} px JPEG q80', 'review': review}]
    json.dump(m, open(MANIFEST, 'w'), indent=1)
    return dst


JUDGE_MODEL = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
JUDGE = """You judge candidate illustrations for a 1930s English village mystery game. The intended subject is: {subject}.
It is a {kind}, shown small (about 250 pixels) beside a clue. Score each candidate from 0 to 10 for what matters at that
size: a player recognises it at a glance as the subject (minor details of the description do not matter); it is ONE main
object (or for a portrait, one person matching the description, head and shoulders); it looks painted, not photographed;
no people, hands or deformities in an object picture. Score below 5 if it shows the wrong thing. Return only JSON: {{"scores": [<one number per image, in order>], "why": "<one short line>"}}."""
PASS = 6   # below this nothing is packaged: the asset stays as it was and is listed for review


def judge(aid, paths):
    """A vision model scores the candidates against the subject; returns (best index from 1, score, scores, why)."""
    kind, _, subject, _ = spec(aid)
    content = [{'text': JUDGE.format(subject=subject, kind=kind)}]
    for i, p in enumerate(paths, 1):
        content += [{'text': f'Candidate {i}:'}, {'image': {'format': 'jpeg', 'source': {'bytes': open(p, 'rb').read()}}}]
    r = client().converse(modelId=JUDGE_MODEL, messages=[{'role': 'user', 'content': content}],
                          inferenceConfig={'maxTokens': 300, 'temperature': 0})
    text = r['output']['message']['content'][0]['text']
    out = json.loads(text[text.index('{'):text.rindex('}') + 1])
    scores = [float(x) for x in out['scores']][:len(paths)]
    best = max(range(len(scores)), key=lambda i: scores[i])
    return best + 1, scores[best], scores, out.get('why', '')


def auto(ids, workers=4, log=print):
    """Generate candidates for each asset in parallel, let the judge pick, package the winner if it passes."""
    def one(aid):
        r = generate(aid)
        n, score, scores, why = judge(aid, r['candidates'])
        if score >= PASS:
            choose(aid, n, review=f'chosen by vision judge ({JUDGE_MODEL}): candidate {n}, scores {scores}: {why}')
            return aid, f'packaged candidate {n} ({score}): {why}'
        return aid, f'NOT packaged, best {score} (scores {scores}): {why}'
    with cf.ThreadPoolExecutor(workers) as ex:
        for f in cf.as_completed([ex.submit(one, a) for a in ids]):
            try:
                aid, msg = f.result()
                log(f'{aid}: {msg}', flush=True)
            except Exception as e:  # one failed asset does not stop the rest
                log(f'failed: {e}', flush=True)


if __name__ == '__main__':
    args = sys.argv[1:]
    if args and args[0] == '--auto':
        auto(args[1:] or [a for a in SUBJECTS if not os.path.exists(os.path.join(ASSETS, f'{a}.jpg'))])
    elif args and args[0] == '--choose':
        for pair in args[1:]:
            aid, n = pair.split('=')
            print('packaged', choose(aid, int(n)))
    else:
        ids = args or [a for a in SUBJECTS if not os.path.exists(os.path.join(ASSETS, f'{a}.jpg'))]
        for aid in ids:
            r = generate(aid)
            print(r['id'], r['candidates'], flush=True)
