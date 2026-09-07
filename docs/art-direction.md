# Visual identity and generated asset contract

Living Mystery remains text-first. Artwork should help players recognize people, places, and objects without obscuring the investigation or disclosing hidden facts.

## The Last Bell

The initial visual family is Bellweather gouache v1: restrained ink and painted texture, muted jewel colors, warm lamplight against slate shadows, recognizable silhouettes, and human, non-caricatured faces. The concept sheet is a style reference, not a production atlas. Separate portraits, location scenes, and artifact images are generated against that same reference.

`dist/art.mjs` maps stable case entity IDs to packaged local assets. The renderer uses portraits anywhere an avatar appears, locations in navigation and the scene/world views, and selected artifact illustrations in inspection controls and acquired-evidence cards. Images are decorative alongside accessible text. Missing assets retain text/initials; image failures hide the image. Artwork never participates in saves, simulation decisions, claim validation, or replay.

Location art represents persistent architecture and atmosphere. It does not assert current NPC occupancy, evidence possession, weather simulation, or a particular timeline state. Those remain explicit engine/UI data. Evidence art is a visual identifier, not an additional inspectable clue. Exact lettering, signatures, damage, times, and forensic details come from validated game text.

## Required design for future procedural cases

1. Generate and validate the case and its stable entity IDs first. Separate public appearance descriptions from secret facts, culpability, relationships, and deduction routes.
2. Choose a versioned visual style and approve one portrait, one location, and one artifact reference. Fix palette, medium, framing, lighting, object angle, margins, and backgrounds.
3. Build an asset manifest from the public descriptions. Every entry records entity ID, category, public brief, prompt, style-reference identity, generation method, output path, and review status. Do not pass the whole private case bible into an image prompt.
4. Generate one production asset per request, using the approved references and the same prompt template. Generate small batches and review them together. Reuse generic object art where appropriate; a unique image for every paper is unnecessary.
5. Preserve character identity when adding expressions: edit the approved portrait. Never select expressions from hidden guilt, truthfulness, or relationship state. Expressions must reflect player-observable behavior and have explicit engine-driven conditions.
6. Review in contact sheets and at real display sizes: 32–64 px portraits and 48–96 px objects. Check distinct silhouettes, identity consistency, period coherence, incidental text, spoiler leaks, and safe circular crops. Locations need recognizable landmarks at thumbnail size.
7. Package approved static files with the case and validate all manifest paths. Record the prompt/reference recipe for reproducibility of the workflow; do not assume image regeneration will be pixel-identical.
8. Keep generation out of ordinary play. For future on-demand case creation, create art during preparation and allow text/initials while assets are pending. Cache approved assets under case/style/version IDs; never regenerate on reload, timeline scrub, or conversation.

## Interface responsibilities

HTML/CSS owns names, badges, selection/focus rings, Here indicators, Done states, evidence counts, and any frames. Generated images contain no UI labels or embedded status. Keep functional UI icons in SVG/CSS. Do not use baked-in text from generated documents as canonical evidence.

Use a stable asset root per case. Unknown entity IDs gracefully fall back to text. Image availability must never affect action validity, gameplay determinism, offline save restoration, or the ability to solve a case.

## Current scope and future work

The first set contains six portraits, six location illustrations, and four artifact identifiers. There are no generated expression variants or dynamically changing scenes yet. The runtime uses compressed JPEG derivatives: 256 px portraits/objects and 640 px locations. Full generation paths and packaging settings are recorded in `docs/art/generation-manifest.json`. Future generated-case tooling must implement the manifest/review pipeline above; documenting it does not mean procedural generation is implemented.
