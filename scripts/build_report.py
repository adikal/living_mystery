#!/usr/bin/env python3
"""Build the local technical report using an explicitly bounded Markdown subset.

No third-party dependencies or network requests. --check verifies the generated
edition is current and validates local links, anchors, SVG metadata and source paths.
"""
import argparse
import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/report'
OUTPUT = ROOT / 'dist/report'
CONFIG = json.loads((SOURCE / 'report.json').read_text())
CHAPTERS = CONFIG['chapters']
SLUGS = {slug for slug, _ in CHAPTERS}


def escape(text):
    return html.escape(str(text), quote=True)


def heading_id(text):
    return re.sub(r'[^\w]+', '-', text.lower(), flags=re.UNICODE).strip('-')


def destination(url, chapter, complete):
    parsed = urlsplit(url)
    if parsed.scheme or parsed.netloc:
        if parsed.scheme not in ('http', 'https'):
            raise ValueError(f'Unsupported link scheme: {url}')
        return url
    if parsed.path.endswith('.md'):
        target = parsed.path[:-3]
        if target not in SLUGS:
            raise ValueError(f'Unknown chapter {url}')
        return (f'#{target}' + (f'--{parsed.fragment}' if parsed.fragment else '')) if complete else f'{target}.html' + (f'#{parsed.fragment}' if parsed.fragment else '')
    if not parsed.path and parsed.fragment and complete:
        return f'#{chapter}--{parsed.fragment}'
    return url


def inline(text, chapter, complete):
    # Tokenize trusted Markdown and escape every plain-text segment. No raw HTML.
    pattern = r'`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*'
    result = []
    cursor = 0
    for match in re.finditer(pattern, text):
        result.append(escape(text[cursor:match.start()]))
        code, label, url, bold = match.groups()
        if code is not None:
            result.append(f'<code>{escape(code)}</code>')
        elif label is not None:
            result.append(f'<a href="{escape(destination(url, chapter, complete))}">{escape(label)}</a>')
        else:
            result.append(f'<strong>{escape(bold)}</strong>')
        cursor = match.end()
    return ''.join(result) + escape(text[cursor:])


def render(markdown, chapter, complete=False):
    lines = markdown.splitlines()
    output, headings = [], []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith('```'):
            language = line[3:]
            block = []
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                block.append(lines[i]); i += 1
            if i == len(lines):
                raise ValueError(f'Unclosed code fence: {chapter}')
            output.append(f'<pre aria-label="{escape(language or "Notation")}"><code>{escape(chr(10).join(block))}</code></pre>')
            i += 1
            continue
        heading = re.match(r'^(#{1,6}) (.+)$', line)
        if heading:
            level, title = len(heading[1]), heading[2]
            anchor = (chapter + '--' if complete else '') + heading_id(title)
            if any(h[0] == anchor for h in headings):
                raise ValueError(f'Duplicate heading: {chapter}: {title}')
            headings.append((anchor, title, level))
            output.append(f'<h{level} id="{anchor}">{inline(title, chapter, complete)}</h{level}>')
            i += 1
            continue
        figure = re.fullmatch(r'!\[([^\]]+)\]\(([^)]+)\)', line)
        if figure:
            caption, src = figure.groups()
            output.append(f'<figure><a class="figure-link" href="{escape(src)}" aria-label="Open full-size diagram: {escape(caption)}"><img src="{escape(src)}" alt="{escape(caption)}" loading="lazy"></a><figcaption>{escape(caption)}</figcaption></figure>')
            i += 1
            continue
        if line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                cells = [cell.strip() for cell in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?', cell) for cell in cells):
                    rows.append(cells)
                i += 1
            width = len(rows[0])
            if any(len(row) != width for row in rows):
                raise ValueError(f'Uneven table: {chapter}')
            head = ''.join(f'<th scope="col">{inline(cell, chapter, complete)}</th>' for cell in rows[0])
            body = ''.join('<tr>' + ''.join(f'<td>{inline(cell, chapter, complete)}</td>' for cell in row) + '</tr>' for row in rows[1:])
            output.append(f'<div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable comparison table"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>')
            continue
        item = re.match(r'^(- |\d+\. )(.*)', line)
        if item:
            ordered = item[1] != '- '
            tag = 'ol' if ordered else 'ul'
            items = []
            while i < len(lines):
                match = re.match(r'^(\d+\. )(.*)' if ordered else r'^(- )(.*)', lines[i].strip())
                if not match:
                    break
                items.append(f'<li>{inline(match[2], chapter, complete)}</li>'); i += 1
            output.append(f'<{tag}>' + ''.join(items) + f'</{tag}>')
            continue
        paragraph = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r'^(#|```|!\[|\||- |\d+\. )', lines[i].strip()):
            paragraph.append(lines[i].strip()); i += 1
        text = ' '.join(paragraph)
        cls = ' class="status"' if text.startswith('**Status:') else ''
        output.append(f'<p{cls}>{inline(text, chapter, complete)}</p>')
    return '\n'.join(output), headings


def page(slug, title, body, headings, complete=False):
    nav = ''.join('<a href="' + name + '.html"' + (' aria-current="page"' if name == slug else '') + '>' + escape(label) + '</a>' for name, label in CHAPTERS)
    local = ''.join(f'<a href="#{anchor}">{escape(label)}</a>' for anchor, label, level in headings if level == 2)
    position = next((i for i, (name, _) in enumerate(CHAPTERS) if name == slug), None)
    adjacent = []
    if position is not None:
        for offset, label in [(-1, 'Previous'), (1, 'Next')]:
            index = position + offset
            if 0 <= index < len(CHAPTERS):
                name, chapter_title = CHAPTERS[index]
                adjacent.append(f'<a href="{name}.html"><small>{label}</small>{escape(chapter_title)}</a>')
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(title)} · Living Mystery Technical Report</title>
<meta name="description" content="{escape(CONFIG['subtitle'])}. An evolving architecture and research report.">
<link rel="stylesheet" href="report.css"></head>
<body><a class="skip" href="#main">Skip to report</a><header class="top"><a href="index.html" class="brand">Living Mystery <span>Technical report</span></a><a href="complete.html">Continuous / print edition ↗</a></header>
<div class="layout"><aside class="sidebar"><details open><summary>Contents</summary><nav aria-label="Chapters">{nav}</nav></details><p class="edition">Edition {escape(CONFIG['edition'])}<br>{escape(CONFIG['date'])}<br>Implementation + research agenda</p></aside>
<main id="main"><div class="paper-meta">LIVING TECHNICAL REPORT <span>EDITION {escape(CONFIG['edition'])}</span></div>{f'<nav class="local-nav" aria-label="On this page">{local}</nav>' if local and not complete else ''}<article>{body}</article><nav class="adjacent" aria-label="Adjacent chapters">{''.join(adjacent)}</nav><footer>Living Mystery · {escape(CONFIG['date'])} · Implemented, experimental and proposed work are distinguished throughout.<br>Generated from version-controlled Markdown and SVG. This report contains case spoilers.</footer></main></div></body></html>'''


class Inventory(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids = set(); self.links = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            if attrs['id'] in self.ids:
                raise ValueError(f'Duplicate HTML ID: {attrs["id"]}')
            self.ids.add(attrs['id'])
        for key in ('href', 'src'):
            if key in attrs:
                self.links.append(attrs[key])


def build(check=False):
    generated, combined = {}, []
    for slug, title in CHAPTERS:
        content = (SOURCE / f'{slug}.md').read_text()
        body, headings = render(content, slug)
        generated[f'{slug}.html'] = page(slug, title, body, headings).encode()
        full, _ = render(content, slug, complete=True)
        combined.append(f'<section class="chapter" id="{slug}">{full}</section>')
    toc = '<nav class="book-toc" aria-label="Complete report contents">' + ''.join(f'<a href="#{slug}">{escape(title)}</a>' for slug, title in CHAPTERS) + '</nav>'
    generated['complete.html'] = page('complete', 'Complete report', toc + '\n'.join(combined), [], True).encode()
    generated['report.css'] = (SOURCE / 'report.css').read_bytes()
    for path in sorted((SOURCE / 'figures').glob('*.svg')):
        svg = ET.fromstring(path.read_bytes())
        ns = '{http://www.w3.org/2000/svg}'
        if not svg.get('viewBox') or svg.find(ns + 'title') is None or svg.find(ns + 'desc') is None:
            raise ValueError(f'SVG missing accessibility metadata: {path}')
        generated['figures/' + path.name] = path.read_bytes()
    inventories = {}
    for name, data in generated.items():
        if name.endswith('.html'):
            parser = Inventory(); parser.feed(data.decode()); inventories[name] = parser
    for name, inventory in inventories.items():
        for link in inventory.links:
            parsed = urlsplit(link)
            if parsed.scheme or parsed.netloc:
                continue
            target = unquote(parsed.path) or name
            if target not in generated:
                raise ValueError(f'Broken local reference: {name} → {link}')
            if parsed.fragment and (target not in inventories or unquote(parsed.fragment) not in inventories[target].ids):
                raise ValueError(f'Broken anchor: {name} → {link}')
    reference = (SOURCE / 'reference.md').read_text()
    for path in re.findall(r'`((?:dist|server|tests|docs)/[^`]+\.(?:mjs|py|md))`', reference):
        if not (ROOT / path).is_file():
            raise ValueError(f'Missing source-map file: {path}')
    stale = []
    for name, data in generated.items():
        path = OUTPUT / name
        if not path.exists() or path.read_bytes() != data:
            stale.append(name)
            if not check:
                path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
    if check and stale:
        raise SystemExit('Report is stale; run python3 scripts/build_report.py: ' + ', '.join(stale))
    words = sum(len((SOURCE / f'{slug}.md').read_text().split()) for slug, _ in CHAPTERS)
    print(f'{"Checked" if check else "Built"} {len(CHAPTERS)} chapters + continuous edition; {len(generated) - len(inventories) - 1} SVG figures; {words:,} source words. Local links, anchors and source map valid.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    build(parser.parse_args().check)
