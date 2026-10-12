#!/usr/bin/env python3
"""Title graphics for the product video, in the game's own visual language: Baskerville headlines (the in-game
serif), small tracked Avenir Next labels, the game's antique-gold accent, and soft scrims instead of boxes.

Outputs 1920x1080 PNGs to overlays/: feature titles (transparent, lower-left), and opaque open/end cards.
Legibility never depends on hue: gold is decoration only; all meaning is carried by the words.
Run from docs/showcase/: python3 make_titles.py
"""
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'overlays')
os.makedirs(OUT, exist_ok=True)
W, H = 1920, 1080
IVORY, GOLD, BG = '#f3ede1', '#d6b06a', '#0b151b'
SERIF = "font-family:Baskerville,'Baskerville Old Face',Georgia,serif"
SANS = "font-family:'Avenir Next',Avenir,Helvetica,sans-serif"

DEFS = f'''<defs>
  <radialGradient id="scrim" cx="0" cy="1" r="1" gradientTransform="scale(1.15 0.62) translate(0 0.61)">
    <stop offset="0" stop-color="#05090c" stop-opacity="0.82"/>
    <stop offset="0.55" stop-color="#05090c" stop-opacity="0.45"/>
    <stop offset="1" stop-color="#05090c" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="vignette" cx="0.5" cy="0.46" r="0.75">
    <stop offset="0" stop-color="#16262f"/>
    <stop offset="1" stop-color="{BG}"/>
  </radialGradient>
  <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#04080b" stop-opacity="0"/>
    <stop offset="0.45" stop-color="#04080b" stop-opacity="0.78"/>
    <stop offset="1" stop-color="#04080b" stop-opacity="0.94"/>
  </linearGradient>
  <filter id="feather" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="55"/></filter>
  <filter id="soft" x="-5%" y="-20%" width="110%" height="140%">
    <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.55"/>
  </filter>
</defs>'''


def write(name, body):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">{DEFS}{body}</svg>'
    path = os.path.join(OUT, name + '.svg')
    with open(path, 'w') as f:
        f.write(svg)
    subprocess.run(['rsvg-convert', '-w', str(W), '-h', str(H), path, '-o', os.path.join(OUT, name + '.png')],
                   check=True)


def feature(name, label, headline):
    """Lower-left feature title: gold hairline + tracked label, Baskerville headline, over a soft corner scrim."""
    x, y = 132, 1004
    b = f'<rect x="0" y="{H-330}" width="{W}" height="330" fill="url(#band)"/>'
    b += f'<g filter="url(#soft)">'
    b += f'<rect x="{x}" y="{y-60}" width="44" height="2" fill="{GOLD}"/>'
    b += (f'<text x="{x+62}" y="{y-52}" style="{SANS};font-weight:600" font-size="21" letter-spacing="5.5" '
          f'fill="{GOLD}">{label.upper()}</text>')
    b += f'<text x="{x}" y="{y+8}" style="{SERIF}" font-size="54" fill="{IVORY}">{headline}</text>'
    b += '</g>'
    write(name, b)


def monogram(cx, cy, s):
    """The in-game 'LM' mark: serif letters inside a thin square."""
    return (f'<rect x="{cx-s/2}" y="{cy-s/2}" width="{s}" height="{s}" fill="none" stroke="{GOLD}" '
            f'stroke-width="2"/><text x="{cx}" y="{cy+s*0.2}" text-anchor="middle" style="{SERIF}" '
            f'font-size="{s*0.56}" fill="{GOLD}">L<tspan font-size="{s*0.42}">M</tspan></text>')


def card(name, title, kicker, tagline):
    b = f'<rect width="{W}" height="{H}" fill="url(#vignette)"/>'
    b += monogram(W/2, 330, 92)
    b += (f'<text x="{W/2}" y="470" text-anchor="middle" style="{SANS};font-weight:600" font-size="22" '
          f'letter-spacing="9" fill="{GOLD}">{kicker.upper()}</text>')
    b += f'<text x="{W/2}" y="600" text-anchor="middle" style="{SERIF}" font-size="132" fill="{IVORY}" letter-spacing="1">{title}</text>'
    b += f'<rect x="{W/2-60}" y="650" width="120" height="2" fill="{GOLD}"/>'
    if tagline:
        b += (f'<text x="{W/2}" y="722" text-anchor="middle" style="{SERIF};font-style:italic" font-size="38" '
              f'fill="{IVORY}" fill-opacity="0.88">{tagline}</text>')
    write(name, b)


card('p_open', 'Living Mystery', 'A detective game', '')
card('p_end', 'Living Mystery', 'A living village', 'Infinite cases, coherent and airtight.')

FEATURES = {
    't_characters': ('Living characters', 'Their own memories, motives and secrets'),
    't_world': ('A living world', 'The village moves while the clock runs'),
    't_talk': ('Talk to anyone', 'In your own words'),
    't_examine': ('Examine the scene', 'Every find goes into your notebook'),
    't_piece': ('Piece it together', 'Not every lead points to the killer'),
    't_confront': ('Confront suspects', 'Live reactions to new evidence'),
    't_pressure': ('Trust and pressure', 'Every answer moves the needle'),
    't_accuse': ('Make your case', 'Who, how and why'),
    't_generated': ('A new case every time', 'Generated fresh, directed for drama'),
    't_certified': ('Every case certified', 'Fair and solvable before you play'),
}
for n, (lab, head) in FEATURES.items():
    feature(n, lab, head)
print('titles in', OUT)
