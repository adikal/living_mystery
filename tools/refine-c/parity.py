"""Parity: certify every case produced by the runs with the Python checker and the JS kernel; compare results."""
import glob, json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from refine import certify

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
files = sorted(glob.glob(f'{HERE}/runs/*/*/*.json'))
files = [f for f in files if not f.endswith('result.json')]
FIELDS = [('solve_depth', 'solveDepth'), ('max_depth', 'maxDepth'), ('surface', 'surface'), ('threads', 'threads'),
          ('twist', 'twist'), ('key', 'key'), ('herrings', 'herrings'), ('false_signs', 'falseSigns'),
          ('motive', 'motive'), ('means', 'means'), ('pillars', 'pillars'), ('pillar_signs', 'pillarSigns'),
          ('mmo_depth', 'mmoDepth'), ('unbacked', 'unbacked')]
js = []
for i in range(0, len(files), 40):
    out = subprocess.run(['node', f'{ROOT}/tools/mk-certify.mjs', *files[i:i + 40]], capture_output=True, text=True, check=True)
    js += json.loads(out.stdout)
mismatch = 0
for f, j in zip(files, js):
    p = certify(json.load(open(f)))
    diffs = []
    if p['ok'] != j['ok']:
        diffs.append(f"ok py={p['ok']} js={j['ok']} | py={p.get('errors', [])[:2]} js={j.get('errors', [])[:2]}")
    elif not p['ok'] and len(p['errors']) != len(j['errors']):
        diffs.append(f"error count py={len(p['errors'])} js={len(j['errors'])}")
    elif p['ok']:
        for pk, jk in FIELDS:
            if p[pk] != j[jk]:
                diffs.append(f'{pk}: py={p[pk]} js={j[jk]}')
        if {k: v for k, v in p['A']['eff'].items()} != j['depths']:
            diffs.append('sign depths differ')
    if diffs:
        mismatch += 1
        print('MISMATCH', os.path.relpath(f, HERE), diffs[:3])
print(f'{len(files)} cases compared, {mismatch} mismatches, {sum(1 for j in js if j["ok"])} certified')
sys.exit(1 if mismatch else 0)
