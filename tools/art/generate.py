"""Generate Bellweather art for new people and places with Stability Style Guide on Amazon Bedrock.

Each asset uses an existing approved image of the same kind as the style reference (low fidelity, so style carries
over but identity does not), the recorded prompt template (docs/art/generation-manifest.json), and several
candidates. Candidates land in tools/art/out/<id>-<n>.jpg; pick with --choose id=n, which packages the chosen one
(256 px portraits, 640 px locations) into dist/assets/last-bell/ and records it in the manifest.

  .venv/bin/python tools/art/generate.py              # generate candidates for every missing asset
  .venv/bin/python tools/art/generate.py vicar mill   # only these
  .venv/bin/python tools/art/generate.py --choose vicar=2 mill=1
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
PLACE = ('Atmospheric establishing scene, landscape, large recognisable shapes, no people. {subject}. ' + STYLE + ' Full bleed.')
NEGATIVE = 'text, letters, words, caption, watermark, signature, frame, border, panel, collage, photo, 3d render, extra people, deformed hands'

SUBJECTS = {
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


def generate(aid, n=N):
    kind, ref, subject = SUBJECTS[aid]
    prompt = (PORTRAIT if kind == 'portrait' else PLACE).format(subject=subject)
    body = {'prompt': prompt, 'image': reference(ref), 'fidelity': 0.35, 'negative_prompt': NEGATIVE,
            'aspect_ratio': '1:1' if kind == 'portrait' else '3:2', 'output_format': 'jpeg'}
    c = client()
    os.makedirs(OUT, exist_ok=True)
    def one(i):
        import time
        for wait in (0, 10, 20, 40, 60):
            time.sleep(wait)
            try:
                r = c.invoke_model(modelId=MODEL, body=json.dumps({**body, 'seed': 1000 + i})); break
            except c.exceptions.ServiceUnavailableException:
                continue
        else:
            raise RuntimeError(f'{aid}-{i}: image service busy')
        img = json.loads(r['body'].read())['images'][0]
        path = os.path.join(OUT, f'{aid}-{i}.jpg')
        open(path, 'wb').write(base64.b64decode(img))
        return path
    paths = [one(i) for i in range(1, n + 1)]
    return {'id': aid, 'kind': kind, 'subject': subject, 'prompt': prompt, 'reference': f'dist/assets/last-bell/{ref}.jpg', 'candidates': paths}


def choose(aid, n):
    kind, ref, subject = SUBJECTS[aid]
    src = os.path.join(OUT, f'{aid}-{n}.jpg')
    dst = os.path.join(ASSETS, f'{aid}.jpg')
    size = '256' if kind == 'portrait' else '640'
    subprocess.run(['sips', '-Z', size, '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', src, '--out', dst], check=True, capture_output=True)
    m = json.load(open(MANIFEST))
    m['assets'] = [a for a in m['assets'] if a['id'] != aid] + [{
        'id': aid, 'kind': kind, 'subject': subject,
        'prompt': (PORTRAIT if kind == 'portrait' else PLACE).format(subject=subject),
        'source': f'Stability Style Guide ({MODEL}), style reference dist/assets/last-bell/{ref}.jpg, fidelity 0.35, candidate {n} of {N}',
        'output': f'dist/assets/last-bell/{aid}.jpg', 'packaging': f'{size} px JPEG q80', 'review': 'chosen from a contact sheet'}]
    json.dump(m, open(MANIFEST, 'w'), indent=1)
    return dst


if __name__ == '__main__':
    args = sys.argv[1:]
    if args and args[0] == '--choose':
        for pair in args[1:]:
            aid, n = pair.split('=')
            print('packaged', choose(aid, int(n)))
    else:
        ids = args or [a for a in SUBJECTS if not os.path.exists(os.path.join(ASSETS, f'{a}.jpg'))]
        for aid in ids:
            r = generate(aid)
            print(r['id'], r['candidates'], flush=True)
