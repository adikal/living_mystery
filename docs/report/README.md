# Authoring the Living Mystery report

Edit chapter Markdown and SVG figures here; generate the reading edition with:

```sh
python3 scripts/build_report.py
python3 scripts/build_report.py --check
```

Open `dist/report/index.html` locally or `/report/` on a server serving `dist`.
`dist/report/complete.html` is the continuous, print-styled edition. The output
has no network dependency and does not modify or initialize the game.

Chapter order and edition metadata live in `report.json`. Update the edition and
milestone record together. Keep source filenames stable so external bookmarks
survive. Figures use SVG with a viewBox, title and description; prefer readable
labels at the report's normal width over dense diagrams.

The dependency-free renderer supports headings, paragraphs, flat unordered and
ordered lists, pipe tables, fenced code, links, images, inline code and bold.
It intentionally does not implement the whole CommonMark specification: no raw
HTML, nested lists, inline math engine or HTML directives. Use Unicode symbols
and fenced notation for equations, or add a deliberate renderer enhancement.
Chapter-relative Markdown links are rewritten to HTML, including cross-chapter
fragments. Heading IDs are generated from visible text: lower case, non-word
characters converted to hyphens. Image alt text supplies the figure caption.

The builder validates internal links and fragments, figure XML/accessibility
metadata, listed source paths, and checked-in generated output in --check mode.
External references are recorded in the bibliography; network checking is not
part of a reproducible local build. Existing generated files are replaced only
when their content changes. Unrelated output files are not deleted.
