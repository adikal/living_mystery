#!/usr/bin/env python3
"""Assemble the product showcase video (1920x1080, 30 fps, ~2 min).

Edit model: SECTIONS, each = one narration line + a run of shots + an optional feature title.
  * Shots are dissolved together (XF seconds), with slow push-ins on detail shots so on-screen dialogue reads at
    1080p, and full-screen (letterboxed, never cropped) framing for establishing shots.
  * Each section is at least lead + narration + tail long; if its shots are shorter the last shot is extended.
  * Narration prefers ElevenLabs files narr/pNN.mp3 and falls back to the macOS draft narr/pNN.aiff.
Run from docs/showcase/: python3 build_product.py
"""
import os
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image
import tempfile
import time
import hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
FOOT, OVL, NARR = (os.path.join(HERE, d) for d in ('footage', 'overlays', 'narr'))
VOICE = os.environ.get('VOICE', 'lily')                # narr/<VOICE>/pNN.mp3 (ElevenLabs); falls back to narr/pNN.aiff
MUSIC = os.path.join(HERE, 'music', os.environ.get('SCORE', 'score_a') + '.mp3')  # optional bed, ducked under narration
MUSIC_LUFS = -27                                     # bed level before ducking (voice ends up ~11 LU above)
OUT = os.path.join(HERE, os.environ.get('OUT', 'product.mp4'))
CACHE = os.path.join(HERE, '.cache', 'shots')         # rendered shots keyed by their parameters
TMP = tempfile.mkdtemp(prefix='lmvid-')
W, H, FPS, BG = 1920, 1080, 30, '0x0b151b'
BG_RGB = (0x0b, 0x15, 0x1b)
BAR = round((H - W * 1760 / 3446) / 2)          # letterbox bar height for the full-screen capture
XF = 0.45                  # dissolve length between shots
LEAD, TAIL = 0.45, 0.75    # narration starts this far into a section; this much air after it
SRC_W, SRC_H = 3446, 1760  # QuickTime capture size

# Source-pixel framing rectangles (x, y, width; height = width*9/16).
CONV = ((600, 300, 2400), (680, 360, 2240))          # conversation column + trust/stress header
CONV_LOW = ((600, 420, 2400), (680, 500, 2240))      # same, lower in the scroll
MODAL = ((223, 45, 3000), (423, 160, 2600))          # centred dialogs (title, cast, accusation, case menu)
PAGE = ((600, 110, 2400), (680, 170, 2240))          # a location page: header + narrative + evidence cards
DRAFT = ((700, 600, 2000), (780, 620, 1880))         # lower page, where the torn draft is read
LIE = ((560, 250, 2700), (600, 298, 2600))           # wide enough for the trust meter and the bottom reply together


def full():
    # whole screen, letterboxed, with a slow 2% push so motion never stops between shot types
    w0, w1 = SRC_W, SRC_W * 0.98
    rect = lambda w: ((SRC_W - w) / 2, (SRC_H - w * 9 / 16) / 2, w)
    return ('push', rect(w0), rect(w1), 'letterbox')


def push(rects):
    return ('push',) + rects


SECTIONS = [
    dict(narr=None, shots=[('card', 'p_open', 0, 3.6, push(((0, 0, 1920), (40, 22, 1840))))]),
    dict(narr='p01', shots=[('src', 'game-intro', 0.2, 3.8, push(MODAL)),
                            ('src', 'game-dialog-clues-red-herring', 2.8, 5.6, full(), 7.6)]),
    dict(narr='p02', title='t_characters', shots=[('src', 'game-intro', 4.2, 7.6, push(((323, 110, 2800), (473, 190, 2500)))),
                                                  ('src', 'game-intro', 12.4, 3.0, push(MODAL))]),
    dict(narr='p03', title='t_world', shots=[('src', 'game-surprise', 12.0, 5.0, full()),
                                             ('src', 'game-surprise', 24.0, 5.0, full())]),
    dict(narr='p04', title='t_talk', shots=[('src', 'game-dialog-clues-red-herring', 15.5, 6.5, push(CONV)),
                                            ('src', 'game-dialog-clues-red-herring', 24.0, 6.4, push(CONV_LOW), 29.4)]),
    dict(narr='p05', title='t_examine', shots=[('src', 'game-dialog-clues-red-herring', 108.0, 4.8, push(PAGE)),
                                               ('src', 'game-surprise', 4.0, 5.6, push(PAGE), 9.8)]),
    dict(narr='p06', title='t_piece', shots=[('src', 'game-dialog-clues-red-herring', 59.5, 3.6, push(CONV_LOW)),
                                             ('src', 'game-dialog-clues-red-herring', 78.0, 5.0, push(CONV_LOW)),
                                             ('src', 'game-dialog-clues-red-herring', 95.4, 4.0, push(CONV_LOW), 99.6)]),
    dict(narr='p07', title='t_confront', title_at=3.3, shots=[('src', 'game-surprise', 32.0, 3.6, push(DRAFT)),
                                                ('src', 'game-surprise', 47.2, 3.2, full()),
                                                ('src', 'game-surprise', 70.2, 6.0, push(CONV))]),
    dict(narr='p08', title='t_pressure', shots=[('src', 'game-murderer-lie', 0.3, 3.2, push(CONV)),
                                                ('src', 'game-murderer-lie', 21.5, 5.0, push(CONV_LOW)),
                                                ('src', 'game-murderer-lie', 31.6, 5.8, push(LIE))]),
    dict(narr='p09', title='t_accuse', shots=[('src', 'game-accuse', 0.2, 2.6, push(MODAL)),
                                              ('src', 'game-accuse', 3.0, 4.2, push(MODAL)),
                                              ('src', 'game-accuse', 9.0, 4.4, push(MODAL), 14.6)]),
    dict(narr='p10', tail=3.8, title='t_generated', title_at=4.4, title2='t_certified', title2_at=9.4,
         shots=[('src', 'game-accuse', 15.5, 4.4, push(PAGE)),
                ('src', 'game-intro', 63.3, 9.5, push(MODAL)),
                ('card', 'p_end', 0, 6.0, push(((40, 22, 1840), (0, 0, 1920))))]),
]


def run(a):
    r = subprocess.run(a, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr[-3000:])


def media_dur(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True).stdout.strip()
    return float(out) if out else 0.0


def lufs(path):
    """Integrated loudness (EBU R128) of a file's audio."""
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', path, '-af', 'ebur128', '-f', 'null', '-'],
                       capture_output=True, text=True).stderr
    return float(r.rsplit('I:', 1)[1].split('LUFS')[0])


def tidy_voice(src, out, sr=48000, floor_db=-50.0, max_pause=0.5, keep_pause=0.42, xf=0.03):
    """Trim edge silence and shorten long pauses without clicks: every cut lands inside a pause, splices are
    crossfaded, and the line fades in/out over its kept silence so it starts and ends at true zero."""
    import numpy as np
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-ac', '2', '-ar', str(sr), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    a = np.frombuffer(raw, np.float32).reshape(-1, 2).copy()
    hop = int(0.01 * sr)
    env = np.sqrt(np.convolve((a ** 2).mean(1), np.ones(hop) / hop, 'same'))[::hop]
    loud = 20 * np.log10(env + 1e-9) > floor_db + 20 * np.log10(np.abs(a).max() + 1e-9)
    idx = np.flatnonzero(loud)
    lo = max(0, idx[0] * hop - int(0.08 * sr)); hi = min(len(a), idx[-1] * hop + int(0.25 * sr))
    pieces, cur, f = [], lo, idx[0]
    runs = np.split(np.arange(idx[0], idx[-1] + 1)[~loud[idx[0]:idx[-1] + 1]],
                    np.flatnonzero(np.diff(np.arange(idx[0], idx[-1] + 1)[~loud[idx[0]:idx[-1] + 1]]) > 1) + 1)
    n_xf = int(xf * sr); ramp = np.linspace(0, 1, n_xf)[:, None]
    out_a = a[lo:lo]
    for r in runs:
        if len(r) == 0 or len(r) * hop / sr <= max_pause:
            continue
        s0, s1 = r[0] * hop, (r[-1] + 1) * hop            # the pause, in samples
        keep = int(keep_pause * sr)
        cut_a, cut_b = s0 + keep // 2, s1 - keep // 2      # drop the middle of the pause
        seg = a[cur:cut_a + n_xf]
        if len(out_a) >= n_xf:                            # crossfade the splice
            seg = seg.copy(); seg[:n_xf] = out_a[-n_xf:] * (1 - ramp) + seg[:n_xf] * ramp
            out_a = np.concatenate([out_a[:-n_xf], seg])
        else:
            out_a = np.concatenate([out_a, seg])
        cur = cut_b
    seg = a[cur:hi]
    if len(out_a) >= n_xf:
        seg = seg.copy(); seg[:n_xf] = out_a[-n_xf:] * (1 - ramp) + seg[:n_xf] * ramp
        out_a = np.concatenate([out_a[:-n_xf], seg])
    else:
        out_a = seg
    fi, fo = int(0.06 * sr), int(0.2 * sr)                # fade over the kept edge silence
    out_a[:fi] *= np.linspace(0, 1, fi)[:, None]; out_a[-fo:] *= np.linspace(1, 0, fo)[:, None]
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', '2', '-i', '-', out],
                   input=out_a.astype(np.float32).tobytes(), check=True)


def music_stem(cues, total, out, sr=48000, duck_db=-11.0, pre=0.5, post=1.0, ramp=0.6):
    """Music bed at MUSIC_LUFS with a smooth ducking envelope computed from the narration timeline: it stays down
    through each run of lines (short gaps never let it surge) and rises only where the voice truly rests."""
    import numpy as np
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', MUSIC, '-ac', '2', '-ar', str(sr), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    m = np.frombuffer(raw, np.float32).reshape(-1, 2).copy()
    n = int(total * sr)
    m = np.pad(m, ((0, max(0, n - len(m))), (0, 0)))[:n]
    m *= 10 ** ((MUSIC_LUFS - lufs(MUSIC)) / 20)
    mask = np.zeros(n, np.float32)
    for _, at, d in cues:
        mask[max(0, int((at - pre) * sr)):min(n, int((at + d + post) * sr))] = 1
    k = int(ramp * sr); win = np.hanning(k); win /= win.sum()
    mask = np.convolve(mask, win, 'same')[:n]          # smooth ramps in and out of the duck
    gain = 1 + (10 ** (duck_db / 20) - 1) * mask
    fi, fo = int(1.5 * sr), int(3.0 * sr)
    gain[:fi] *= np.linspace(0, 1, fi); gain[-fo:] *= np.linspace(1, 0, fo)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', '2', '-i', '-', out],
                   input=(m * gain[:, None]).astype(np.float32).tobytes(), check=True)


def narr_file(n):
    """ElevenLabs take for the chosen voice, tidied (cached; rebuilt when the source or this code changes)."""
    src = f'{NARR}/{VOICE}/{n}.mp3'
    if not os.path.exists(src):
        return f'{NARR}/{n}.aiff'
    out = f'{NARR}/_proc/{VOICE}/v2_{n}.wav'
    if not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(src):
        os.makedirs(os.path.dirname(out), exist_ok=True)
        tidy_voice(src, out)
    return out


FULL_VF = (f"scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,"
           f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={BG}")
ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', str(FPS)]


def render_push(src_args, sw, sh, d, rects, out, letterbox=False):
    """Smooth push: decode frames raw, place each with a sub-pixel affine transform (Pillow, bicubic), re-encode.
    ffmpeg's crop snaps to whole pixels, which made slow moves judder; this does not."""
    (x0, y0, w0), (x1, y1, w1) = rects
    n = max(1, round(d * FPS))
    dec = subprocess.Popen(['ffmpeg', '-v', 'error', *src_args, '-vf', f'fps={FPS}', '-frames:v', str(n), '-f', 'rawvideo',
                            '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
                            '-r', str(FPS), '-i', '-', *ENC, out], stdin=subprocess.PIPE)
    size, frame = sw * sh * 3, None
    for k in range(n):
        buf = dec.stdout.read(size)
        if len(buf) == size:
            frame = Image.frombuffer('RGB', (sw, sh), buf, 'raw', 'RGB', 0, 1)
        p = k / max(1, n - 1)
        w = w0 + (w1 - w0) * p
        sc = w / W                                     # source pixels per output pixel
        x, y = x0 + (x1 - x0) * p, y0 + (y1 - y0) * p
        img = frame.transform((W, H), Image.AFFINE, (sc, 0, x, 0, sc, y), resample=Image.BICUBIC, fillcolor=BG_RGB)
        if letterbox:                                  # fixed bars, so the frame edge never creeps during the push
            img.paste(BG_RGB, (0, 0, W, BAR)); img.paste(BG_RGB, (0, H - BAR, W, H))
        enc.stdin.write(img.tobytes())
    dec.stdout.close(); dec.wait()
    enc.stdin.close()
    if enc.wait():
        raise SystemExit(f'encode failed: {out}')


def render_shot(shot, d, i):
    kind, name, ss, _, fr = shot[:5]
    until = shot[5] if len(shot) > 5 else None          # last usable source second; beyond it the frame holds
    os.makedirs(CACHE, exist_ok=True)
    out = os.path.join(CACHE, hashlib.sha1(repr((shot, round(d, 3), W, H, FPS)).encode()).hexdigest()[:16] + '.mp4')
    if os.path.exists(out):
        return out
    if kind == 'card':
        src, sw, sh = ['-loop', '1', '-framerate', str(FPS), '-t', f'{d}', '-i', f'{OVL}/{name}.png'], W, H
    else:
        take = min(d, until - ss) if until else d
        src, sw, sh = ['-ss', f'{ss}', '-t', f'{take:.3f}', '-i', f'{FOOT}/{name}.mov'], SRC_W, SRC_H
    if fr[0] == 'push':
        render_push(src, sw, sh, d, fr[1:3], out + '.tmp.mp4', letterbox=len(fr) > 3)
        os.replace(out + '.tmp.mp4', out)
    else:
        vf = (f"fps={FPS},tpad=stop_mode=clone:stop_duration=3,trim=duration={d},setpts=PTS-STARTPTS,"
              f"{FULL_VF},setsar=1,format=yuv420p")
        run(['ffmpeg', '-y', *src, '-vf', vf, '-an', *ENC, out + '.tmp.mp4'])
        os.replace(out + '.tmp.mp4', out)
        return out
    return out


def main():
    # ---- plan the timeline ----
    shots, narr_cues, title_cues = [], [], []
    t = 0.0
    for sec in SECTIONS:
        nd = media_dur(narr_file(sec['narr'])) if sec.get('narr') else 0.0
        durs = [s[3] for s in sec['shots']]
        span = sum(durs) - XF * len(durs)                     # time this section occupies on the timeline
        lead, tail = sec.get('lead', LEAD), sec.get('tail', TAIL)
        need = lead + nd + tail if nd else span
        if need > span:
            durs[-1] += need - span                           # extend the last shot (holds/drifts if source runs out)
            span = need
        if sec.get('narr'):
            narr_cues.append((narr_file(sec['narr']), t + lead, nd))
        if sec.get('title'):
            title_cues.append((sec['title'], t + sec.get('title_at', 0.7)))
        if sec.get('title2'):
            title_cues.append((sec['title2'], t + sec['title2_at']))
        for s, d in zip(sec['shots'], durs):
            shots.append((s, d))
        print(f"{sec.get('narr') or 'open':5s} at {t:6.2f}s  span {span:5.2f}s  narr {nd:5.2f}s")
        t += span
    total = sum(d for _, d in shots) - XF * (len(shots) - 1)
    print(f'total {total:.2f}s, {len(shots)} shots')
    if '--plan' in sys.argv:
        return

    # ---- render shots (in parallel; each push shot is CPU-bound) ----
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=max(2, (os.cpu_count() or 4) - 1)) as pool:
        paths = list(pool.map(render_shot, [s for s, _ in shots], [d for _, d in shots], range(len(shots))))
    print(f'{len(paths)} shots rendered in {time.time() - t0:.1f}s')

    # ---- final composite: dissolves, titles, narration ----
    inp, fc = [], []
    for p in paths:
        inp += ['-i', p]
    last, off = '0:v', 0.0
    for i in range(1, len(paths)):
        off += shots[i - 1][1] - XF
        fc.append(f"[{last}][{i}:v]xfade=transition=fade:duration={XF}:offset={off:.3f}[x{i}]")
        last = f'x{i}'
    fc.append(f"[{last}]fade=t=in:st=0:d=0.8,fade=t=out:st={total - 1.2:.3f}:d=1.2[base]")
    last = 'base'
    TD = 3.8
    for k, (name, at) in enumerate(title_cues):
        idx = len(paths) + k
        inp += ['-loop', '1', '-framerate', str(FPS), '-t', f'{TD}', '-i', f'{OVL}/{name}.png']
        fc.append(f"[{idx}:v]format=rgba,fade=t=in:st=0:d=0.5:alpha=1,fade=t=out:st={TD - 0.6}:d=0.6:alpha=1,"
                  f"setpts=PTS-STARTPTS+{at:.3f}/TB[t{k}]")
        fc.append(f"[{last}][t{k}]overlay=0:0:eof_action=pass[o{k}]")
        last = f'o{k}'
    a0 = len(paths) + len(title_cues)
    alabels = []
    for k, (f, at, _) in enumerate(narr_cues):
        inp += ['-i', f]
        ms = int(at * 1000)
        fc.append(f"[{a0 + k}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay={ms}|{ms}[a{k}]")
        alabels.append(f'[a{k}]')
    fc.append(f"{''.join(alabels)}amix=inputs={len(alabels)}:normalize=0,apad,atrim=0:{total:.3f}[vox]")
    if os.path.exists(MUSIC):
        mi = a0 + len(narr_cues)
        stem = f'{TMP}/music.wav'
        music_stem(narr_cues, total, stem)
        inp += ['-i', stem]
        fc.append(f"[{mi}:a]aformat=sample_rates=48000:channel_layouts=stereo[mus]")
        fc.append("[vox][mus]amix=inputs=2:normalize=0[aout]")
        print('music bed:', MUSIC)
    else:
        fc.append("[vox]anull[aout]")
    t0 = time.time()
    run(['ffmpeg', '-y', *inp, '-filter_complex', ';'.join(fc), '-map', f'[{last}]', '-map', '[aout]',
         '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', str(FPS),
         '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', f'{total:.3f}', OUT + '.pre.mp4'])
    gain = -16.0 - lufs(OUT + '.pre.mp4')
    run(['ffmpeg', '-y', '-i', OUT + '.pre.mp4', '-c:v', 'copy', '-af', f'volume={gain:.2f}dB,alimiter=limit=0.84:level=false',
         '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', OUT])
    os.remove(OUT + '.pre.mp4')
    print(f'loudness gain {gain:+.1f} dB')
    print(f'composite in {time.time() - t0:.1f}s')
    print('WROTE', OUT)


if __name__ == '__main__':
    main()
