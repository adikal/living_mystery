# Making the Living Mystery product video

A 2:10, 1080p showcase for a VP of GenAI for Games, built entirely by script from silent QuickTime captures.
This note records how it was made and what we learned getting it to production quality.

## Pipeline

```
footage/*.mov  (QuickTime, 3446x1760, silent)
      │  shot list: source in/out, framing, cut-off point          build_product.py · SECTIONS
      ▼
shots  ── sub-pixel push-ins (Pillow affine) or letterboxed full screen, cached in .cache/shots
      │
narr/<voice>/pNN.mp3 (ElevenLabs) ── tidy: trim edges, shorten long pauses, crossfade, fade to zero
      │   each section = one narration line; the section stretches to fit its line
      ▼
composite ── 0.45 s dissolves · feature titles (overlays/t_*.png) · end card
      │      music bed with a precomputed ducking envelope
      ▼
loudness pass ── measured linear gain to -16 LUFS + peak limiter      →  product.mp4
```

Rebuild: `python3 make_titles.py && python3 build_product.py` (about 2 min with a warm shot cache, about 6 min cold).
`VOICE=<name>` picks `narr/<name>/`, `SCORE=<name>` picks `music/<name>.mp3`, and `--plan` prints the timeline
without rendering.

## Assets and settings

- **Script.** 10 lines in `narration-final.txt`. Every line describes something on screen at that moment.
- **Voice.** ElevenLabs "Lily" (British female, `pFZP5JQG7iQjIQuC4Bku`), model `eleven_multilingual_v2`, with
  stability 0.45, similarity 0.75, style 0.2 and speaker boost on. Each line is generated with `previous_text` and
  `next_text` (its neighbouring lines) so the delivery flows across cuts. We auditioned 8 British voices on line 1
  first; George was the runner-up.
- **Music.** ElevenLabs Music `music_v2_5`, instrumental, generated to the exact cut length (132 s). Prompt: an
  understated 1930s-village mystery underscore at about 84 BPM, low piano ostinato, strings, pizzicato and celesta,
  no drums, a gentle lift in the final 30 s and a resolving chord at the end. We generated two takes and chose take A.
- **Titles.** `make_titles.py` uses the game's own visual language: Baskerville headlines, tracked Avenir labels, the
  antique-gold accent and a soft bottom gradient band. All meaning is carried by the words, never by hue
  (colour-blind safe).
- **Not in git.** Footage (349 MB), voice and music audio, the render cache and `product.mp4`. They are large, and
  the audio is paid output that we regenerate rather than version.

## Lessons learned

**Writing**
1. Write for the audience and list the must-mention features before you write a word: living characters with their
   own memories, procedurally generated cases, a story director that keeps cases fair and solvable, and the verbs
   (talk, examine, piece together, confront, accuse). The first draft left most of them out.
2. Use the audience's vocabulary, not the builder's: "autonomous agents" and "a living world", never "LLM".
3. Avoid stock AI phrasing ("watch it land", "every soul"). Describe the concrete thing on screen instead, for example
   "Show Edmund Vale his nephew's torn letter, and he realises…".
4. Narration should fill about 85% of the runtime. Long silent stretches read as unfinished.
5. End on the argument, then let a silent end card carry the tagline. A spoken punchline after a long final line made
   the ending drag.

**Picture**
6. Log the footage with contact sheets (one frame every 2 s) before cutting. They showed the real hero beats
   (Edmund's "Good God. Blackmail.", Clara's trust falling from 30 to 22, the case menu with different victims) and
   the dead time to cut, such as 15–20 s of typing indicators.
7. Never crop a full-screen UI to fill 16:9; letterbox it instead. Use deliberate push-ins where text has to be read
   at 1080p.
8. Motion must be sub-pixel. Pushes built from ffmpeg `crop` step in whole pixels and judder: frame-to-frame motion
   went 0, 1.1, 0, 1.6, 0…. A Pillow affine transform per frame gives smooth 0.5 px steps, cutting the jitter from
   0.83 to 0.03.
9. Keep motion continuous. Static full-screen shots between moving close-ups felt jerky, so full shots get a slow 2%
   push. 3.5% began to trim the left map panel.
10. Start shots after the app's own animations have finished. A dissolve that begins while an in-game menu is still
    fading blends three images instead of two.
11. When narration lengthens a shot, hold the last good frame instead of reading further into the recording. Each
    shot has a source cut-off just before the next player action; without it, clicks on the next character leaked
    into dissolves.
12. Titles should look native: the game's own fonts, no boxes, a gradient band, and timing that never covers the line
    being read.

**Sound**
13. Built-in macOS voices are fine for timing drafts but too monotone for a final.
14. ElevenLabs takes contain long internal pauses. Shorten pauses over 0.5 s to about 0.4 s. Make every cut inside
    silence, crossfade the splices and fade each line to true zero. Trimming with ffmpeg `silenceremove` cut into the
    sound and caused audible clicks at line edges.
15. Don't use a reactive sidechain duck. It let the music surge about 10 dB in every one-second gap between lines.
    Compute the duck from the narration timeline instead, so the music stays down through each run of lines and
    rises only on the cards and genuine pauses.
16. Normalise loudness linearly, with a measured gain and a limiter. Single-pass dynamic `loudnorm` acts like
    automatic gain control and pulls the music up between lines.
17. Generate the music to the cut's length and line its final swell up with the last spoken word.

**Process**
18. Use numbers where you can't watch or listen. Frame-difference spikes find bad dissolves, phase correlation finds
    jitter, and level profiles find music surges and edge clicks. A human pass still caught what the numbers didn't
    (the glitch after "what they share"), so plan for both.
19. Make rebuilds cheap: render shots in parallel, cache them by their parameters, and use a `--plan` mode, so voice
    and music changes take minutes.
20. Bound every looped ffmpeg input with `-t`. An unbounded `-loop 1` input renders forever.
21. Keep the API key in a `chmod 600` file. Scope its permissions (text to speech, voices read, music), cap its
    credits, set an expiry, and never paste it into chat or the repo.
