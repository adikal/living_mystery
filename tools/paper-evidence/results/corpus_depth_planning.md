# Current typed-claim corpus structural-depth planning report

This offline report strictly re-certifies **15 independent claims-v2 cases** (4 stable, 11 live; excluded 0/15 indexed cases).

Normalized corpus SHA-256: `33584a9555fee4a4a772ebe057a04a031d4da63c9fcee00a8c0c28f759d76d00`.

**Interpretation boundary:** These are structural properties of certified case records. They do not measure or imply behavioral difficulty for agents or people. A future experiment must estimate behavior directly, treat case as the independent unit, and block or randomize nuisance structure such as lies, herrings, pillars, and corpus classification.

## Structural distributions

Every count below has denominator **15 independent cases**.

| Quantity | Distribution (value: count/15) | Median | Range |
|---|---|---:|---:|
| instantaneous solve depth | 3: 3/15, 5: 6/15, 6: 1/15, 7: 3/15, 8: 2/15 | 5 | 3–8 |
| stable depth | 3: 3/15, 5: 6/15, 6: 1/15, 7: 3/15, 8: 2/15 | 5 | 3–8 |
| lies | 0: 1/15, 1: 10/15, 2: 3/15, 3: 1/15 | 1 | 0–3 |
| other false signs | 0: 12/15, 1: 3/15 | 0 | 0–1 |
| herrings | 1: 8/15, 2: 6/15, 4: 1/15 | 1 | 1–4 |
| pillar opportunity depth | 3: 3/15, 5: 6/15, 6: 1/15, 7: 3/15, 8: 2/15 | 5 | 3–8 |
| pillar means depth | 2: 1/15, 3: 2/15, 4: 1/15, 5: 5/15, 6: 2/15, 7: 2/15, 8: 1/15, 9: 1/15 | 5 | 2–9 |
| pillar motive depth | 1: 1/15, 2: 2/15, 3: 1/15, 4: 7/15, 5: 1/15, 6: 1/15, 7: 1/15, 8: 1/15 | 4 | 1–8 |
| maximum pillar depth | 3: 3/15, 5: 6/15, 6: 1/15, 7: 2/15, 8: 2/15, 9: 1/15 | 5 | 3–9 |

Instantaneous and stable depth disagree for **0/15 cases**.

## Per-case audit

| Case | Class | Instantaneous | Stable | Lies | Other false | Herrings | Pillars O/Mn/Mt/Max | Normalized SHA-256 |
|---|---|---:|---:|---:|---:|---:|---|---|
| `mk-live-20261002-222517` | stable | 6 | 6 | 2 | 0 | 1 | 6/6/6/6 | `e2ffb5b8b3f742c6490867e64a06b6edd4ce09c446003392d118c9e5bb362753` |
| `mk-live-20261002-224855` | stable | 5 | 5 | 2 | 0 | 1 | 5/5/4/5 | `6592d79c6e7cb273a2d1caf83063878896471f4c203199560427d0fba9463162` |
| `mk-live-20261002-225824` | stable | 5 | 5 | 1 | 0 | 2 | 5/5/4/5 | `d4b3c2cb3ddb242e8aa828d95f9082767d752954186ae75808079284c5db278e` |
| `mk-live-20261002-235614` | stable | 5 | 5 | 1 | 0 | 2 | 5/4/4/5 | `b1cf6de709f0bc654b2b3be9938197c2299c896e7a7d40d8acba3071f0469716` |
| `mk-live-20261003-082807` | live | 3 | 3 | 1 | 1 | 1 | 3/3/1/3 | `3a8d103c3c608037f547e0f0cffa5b3274c497bf40c26048787efc15fdc931ee` |
| `mk-live-20261003-082809` | live | 3 | 3 | 1 | 0 | 1 | 3/2/2/3 | `a3a36477ffba5d45c5023f4cf848146916e92eb0efde0ef9531773307a7960af` |
| `mk-live-20261003-082813` | live | 7 | 7 | 1 | 0 | 4 | 7/7/4/7 | `a8030f736a50be1b78472f40ae50e17b51da62078ebf63e27e2d14e7e3cc2df5` |
| `mk-live-20261003-085134` | live | 8 | 8 | 1 | 1 | 2 | 8/8/4/8 | `07abdcb67f5d7b5598a855aabe0c199a0b45aafa3882799a0271b88d62a18f9f` |
| `mk-live-20261003-100726` | live | 7 | 7 | 2 | 0 | 1 | 7/9/8/9 | `6d4a788f2064b4e001835c313fabe246bd29031753989d0b903e54b1d2813f00` |
| `mk-live-20261003-130902` | live | 3 | 3 | 0 | 0 | 2 | 3/3/2/3 | `0751273193b517682e99d2e3947e63e21b9dc7e88a401a1a34a57cd290e4087c` |
| `mk-live-20261003-130906` | live | 7 | 7 | 1 | 1 | 2 | 7/7/5/7 | `142e331e21abb10a1e09aa3b4a55b393f5708e0f5572011cdababebc6dad3337` |
| `mk-live-20261003-133036` | live | 5 | 5 | 3 | 0 | 1 | 5/5/4/5 | `e48703cc64b6a989a9638b3ea8ed1f0b03cb20252dd63cf5114cc5f36e897182` |
| `mk-live-20261003-135210` | live | 5 | 5 | 1 | 0 | 1 | 5/5/4/5 | `483f0951f7426115fa57a6805b6638728f30b14935e4f07e56c632e315765faf` |
| `mk-live-20261011-112405` | live | 5 | 5 | 1 | 0 | 1 | 5/5/3/5 | `639c5bab93abd949506ef0f2f5664957a4049fb9875cb94d2ca7edff899919d6` |
| `mk-live-20261017-223841` | live | 8 | 8 | 1 | 0 | 2 | 8/6/7/8 | `f14ba5e90c01da8d3144eaddeefdb3de96ac48d3ca032d6d39522bb6b845a37c` |

## Feasible structural strata

Rule: three contiguous instantaneous-depth strata with at least 3 independent cases each. A balanced design can sample **3 cases per stratum (9 total)** from the current corpus.

| Stratum | Instantaneous depth | Cases/corpus | Stable | Lies | Herrings | Max pillar | Stable/live |
|---|---:|---:|---:|---:|---:|---:|---:|
| lower structural depth | 3 | 3/15 | 3 | 0–1 | 1–2 | 3 | 0/3 |
| middle structural depth | 5 | 6/15 | 5 | 1–3 | 1–2 | 5 | 3/3 |
| higher structural depth | 6–8 | 6/15 | 6–8 | 1–2 | 1–4 | 6–9 | 1/5 |

Case membership:
- **lower structural depth (3/15):** `mk-live-20261003-082807`, `mk-live-20261003-082809`, `mk-live-20261003-130902`
- **middle structural depth (6/15):** `mk-live-20261002-224855`, `mk-live-20261002-225824`, `mk-live-20261002-235614`, `mk-live-20261003-133036`, `mk-live-20261003-135210`, `mk-live-20261011-112405`
- **higher structural depth (6/15):** `mk-live-20261002-222517`, `mk-live-20261003-082813`, `mk-live-20261003-085134`, `mk-live-20261003-100726`, `mk-live-20261003-130906`, `mk-live-20261017-223841`

## Limitations

- The corpus contains only 15 independent cases; the feasible strata are a sampling frame, not a power analysis.
- Stratum sizes are unequal, so a fully balanced three-stratum comparison can use only the smallest stratum unless new cases are added.
- Stable and live manifest classifications may encode generation-time differences and should be balanced or modeled.
- Repeated runs by an agent or person do not increase the independent case denominator for depth effects.
