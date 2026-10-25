#!/usr/bin/env python3
"""README media for the two showcase videos, in the videos' own visual language (Baskerville headline, tracked Avenir
Next label, antique gold on the game's night blue):

  docs/media/teaser.gif        a looping 12 s montage for the top of the README (case card, a conversation, the
                               solver's verdict, the accusation), small enough to load at once
  docs/media/card-game.jpg     poster cards for the two videos, with the running time and a play badge
  docs/media/card-tech.jpg
  web/product-720.mp4          the videos re-encoded under GitHub's 10 MB upload limit for videos (free plans), to
  web/technical-720.mp4        drag into the README editor on github.com: the link it gives plays inline

The videos themselves stay out of git (docs/showcase/* is ignored); full quality belongs on a GitHub Release.
Run from docs/showcase/ after the videos are built: python3 make_readme_media.py [--no-video]
"""
import base64
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
MEDIA = os.path.join(HERE, '..', 'media')
WEB = os.path.join(HERE, 'web')
IVORY, GOLD, BG = '#f3ede1', '#d6b06a', '#0b151b'
SERIF = "font-family:Baskerville,'Baskerville Old Face',Georgia,serif"
SANS = "font-family:'Avenir Next',Avenir,Helvetica,sans-serif"
LIMIT = 10 * 1024 * 1024          # GitHub's video upload limit on a free plan
W, H = 1280, 720

CARDS = [   # (file, video, poster frame (s), kicker, headline, subline)
    ('card-game.jpg', 'product.mp4', 42.0, 'Watch the game', 'Living Mystery', 'A case, from the first clue to the accusation'),
    ('card-tech.jpg', 'technical.mp4', 141.0, 'Watch how it works', 'Under the hood', 'Language models invent; a solver keeps every case fair'),
]
TEASER = [  # (video, start, length): the case card, a conversation and its evidence, the solver's verdict, the accusation
    ('product.mp4', 4.0, 2.8), ('product.mp4', 38.5, 3.5), ('technical.mp4', 136.0, 4.5), ('product.mp4', 99.0, 2.6)]


def run(*cmd):
    subprocess.run(cmd, check=True)


def frame(video, t, out, width=W):
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(t), '-i', os.path.join(HERE, video),
        '-frames:v', '1', '-vf', f'scale={width}:-2:flags=lanczos', out)


def card(name, video, t, kicker, headline, subline, minutes):
    with tempfile.TemporaryDirectory() as tmp:
        shot = os.path.join(tmp, 'shot.png')
        frame(video, t, shot)
        href = 'data:image/png;base64,' + base64.b64encode(open(shot, 'rb').read()).decode()
        cx, cy, r = W - 120, H - 120, 54          # the play badge sits in the title band, clear of the picture
        svg = f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#04080b" stop-opacity="0.15"/>
      <stop offset="0.5" stop-color="#04080b" stop-opacity="0.3"/>
      <stop offset="0.68" stop-color="#04080b" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#04080b" stop-opacity="0.97"/>
    </linearGradient>
  </defs>
  <rect width="{W}" height="{H}" fill="{BG}"/>
  <image href="{href}" xlink:href="{href}" width="{W}" height="{H}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="{W}" height="{H}" fill="url(#scrim)"/>
  <rect x="1" y="1" width="{W - 2}" height="{H - 2}" fill="none" stroke="{GOLD}" stroke-opacity="0.55" stroke-width="2"/>
  <circle cx="{cx}" cy="{cy}" r="{r}" fill="{BG}" fill-opacity="0.78" stroke="{GOLD}" stroke-width="3"/>
  <path d="M {cx - r * 0.28} {cy - r * 0.42} L {cx + r * 0.46} {cy} L {cx - r * 0.28} {cy + r * 0.42} Z" fill="{GOLD}"/>
  <rect x="64" y="{H - 196}" width="44" height="2" fill="{GOLD}"/>
  <text x="122" y="{H - 189}" style="{SANS};font-size:19px;font-weight:600;letter-spacing:5px" fill="{GOLD}">{kicker.upper()} · {minutes}</text>
  <text x="62" y="{H - 112}" style="{SERIF};font-size:68px" fill="{IVORY}">{headline}</text>
  <text x="64" y="{H - 62}" style="{SERIF};font-size:27px;font-style:italic" fill="{IVORY}" fill-opacity="0.86">{subline}</text>
</svg>'''
        path = os.path.join(tmp, 'card.svg')
        open(path, 'w').write(svg)
        png = os.path.join(tmp, 'card.png')
        run('rsvg-convert', '-w', str(W), '-h', str(H), path, '-o', png)
        run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', png, '-q:v', '3', os.path.join(MEDIA, name))


def minutes(video):
    s = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0',
                              os.path.join(HERE, video)], capture_output=True, text=True, check=True).stdout)
    return f'{int(s // 60)}:{int(round(s % 60)):02d}'


def teaser(width=720, fps=8, fade=0.4):
    """The montage as a GIF: clips joined by short dissolves, one palette for the whole loop."""
    inputs, chains, last, offset = [], [], None, 0.0
    for i, (video, start, length) in enumerate(TEASER):
        inputs += ['-ss', str(start), '-t', str(length), '-i', os.path.join(HERE, video)]
        chains.append(f'[{i}:v]fps={fps},scale={width}:-2:flags=lanczos,setsar=1,format=yuv420p[c{i}]')
    graph, prev = list(chains), 'c0'
    for i in range(1, len(TEASER)):
        offset += TEASER[i - 1][2] - fade
        graph.append(f'[{prev}][c{i}]xfade=transition=fade:duration={fade}:offset={offset:.2f}[x{i}]')
        prev = f'x{i}'
    graph.append(f'[{prev}]split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];'
                 f'[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle[out]')
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *inputs, '-filter_complex', ';'.join(graph),
        '-map', '[out]', '-loop', '0', os.path.join(MEDIA, 'teaser.gif'))


def web(video, out, video_kbps, audio_kbps):
    """Two-pass H.264 at 720p under the upload limit; checked after encoding."""
    src, dst = os.path.join(HERE, video), os.path.join(WEB, out)
    common = ['-vf', 'scale=1280:-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'animation',
              '-b:v', f'{video_kbps}k', '-g', '600', '-passlogfile', os.path.join(WEB, out + '.pass')]
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', src, *common, '-pass', '1', '-an', '-f', 'mp4', os.devnull)
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', src, *common, '-pass', '2', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', f'{audio_kbps}k', '-movflags', '+faststart', dst)
    for f in os.listdir(WEB):
        if f.startswith(out + '.pass'):
            os.remove(os.path.join(WEB, f))
    size = os.path.getsize(dst)
    if size >= LIMIT:
        raise SystemExit(f'{out} is {size} bytes, over the {LIMIT}-byte upload limit: lower its bitrate')
    print(f'{out}: {size / 1e6:.1f} MB')


if __name__ == '__main__':
    os.makedirs(MEDIA, exist_ok=True)
    os.makedirs(WEB, exist_ok=True)
    for name, video, t, kicker, headline, subline in CARDS:
        card(name, video, t, kicker, headline, subline, minutes(video))
    teaser()
    print('teaser.gif:', f"{os.path.getsize(os.path.join(MEDIA, 'teaser.gif')) / 1e6:.1f} MB")
    if '--no-video' not in sys.argv:
        web('product.mp4', 'product-720.mp4', 505, 64)
        web('technical.mp4', 'technical-720.mp4', 275, 48)
