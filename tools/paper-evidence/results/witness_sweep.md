# Executable acquisition witness sweep

Normalized SHA-256: `96a5e817c6b8f3bb0efa5dca40fb005d2965c165e8e5732aa386a121c0574d62`

## Result

PASS — 15/15 deduplicated claims v2 cases passed hard certification; all 225 deterministic autoplay executions and all 15 bounded testimony searches passed public engine replay, together with repeatability, save/import checks, and 30 omission controls.

## Corpus aggregates

| Corpus | Cases | Passing | Certified | Trials passing | Repeat exact | Negative controls | Native status |
|---|---:|---:|---:|---:|---:|---:|---|
| stable | 4 | 4 | 4 | 60/60 | 4/4 | 8/8 | route_found: 4 |
| live | 11 | 11 | 11 | 165/165 | 11/11 | 22/22 | route_found: 11 |
| all | 15 | 15 | 15 | 225/225 | 15/15 | 30/30 | route_found: 15 |

## Per-case evidence

| Corpus | Case | Cert | Autoplay trials | Repeatability | Bounded search | Testimony | Motive omitted | Means omitted | Wall ms (matrix) |
|---|---|---:|---:|---|---|---|---|---|---:|
| stable | mk-live-20261002-222517 — Sealing Wax and Steel | pass | 15/15 | exact | pass (14 actions, 60 min) | acquired | refused (no_motive) | refused (ambiguous) | 5493.741 |
| stable | mk-live-20261002-224855 — Death at Vale Manor | pass | 15/15 | exact | pass (17 actions, 61 min) | acquired | refused (no_motive) | refused (no_means) | 4300.457 |
| stable | mk-live-20261002-225824 — Death at the Post Office | pass | 15/15 | exact | pass (11 actions, 50 min) | acquired | refused (no_motive) | refused (no_means) | 10536.405 |
| stable | mk-live-20261002-235614 — Paste Pearls at the Pump | pass | 15/15 | exact | pass (15 actions, 57 min) | acquired | refused (no_motive) | refused (no_means) | 6209.485 |
| live | mk-live-20261003-082807 — Cocoa in the Vestry | pass | 15/15 | exact | pass (10 actions, 55 min) | acquired | refused (no_motive) | refused (ambiguous) | 4482.408 |
| live | mk-live-20261003-082809 — The Millpond Letters | pass | 15/15 | exact | pass (13 actions, 59 min) | acquired | refused (no_motive) | refused (ambiguous) | 5077.552 |
| live | mk-live-20261003-082813 — The Lamb Asleep Upstairs | pass | 15/15 | exact | pass (16 actions, 75 min) | acquired | refused (no_motive) | refused (no_means) | 9124.848 |
| live | mk-live-20261003-085134 — Death Among the Orchids | pass | 15/15 | exact | pass (24 actions, 88 min) | acquired | refused (no_motive) | refused (ambiguous) | 5423.329 |
| live | mk-live-20261003-100726 — The Last Train to Town | pass | 15/15 | exact | pass (25 actions, 116 min) | acquired | refused (no_motive) | refused (no_means) | 8556.64 |
| live | mk-live-20261003-130902 — The Boathouse at Michaelmas | pass | 15/15 | exact | pass (11 actions, 36 min) | acquired | refused (no_motive) | refused (no_means) | 4201.662 |
| live | mk-live-20261003-130906 — The Quarter-Past Watch | pass | 15/15 | exact | pass (24 actions, 75 min) | acquired | refused (no_motive) | refused (no_means) | 7391.848 |
| live | mk-live-20261003-133036 — A Fall Before Midnight | pass | 15/15 | exact | pass (19 actions, 84 min) | acquired | refused (no_motive) | refused (ambiguous) | 5607.277 |
| live | mk-live-20261003-135210 — Under the Memorial Lamp | pass | 15/15 | exact | pass (14 actions, 57 min) | acquired | refused (no_motive) | refused (ambiguous) | 7233.52 |
| live | mk-live-20261011-112405 — Still Water at Alder Mill | pass | 15/15 | exact | pass (14 actions, 60 min) | acquired | refused (inconsistent) | refused (ambiguous) | 4709.966 |
| live | mk-live-20261017-223841 — A Tin from Fortnum's | pass | 15/15 | exact | pass (16 actions, 66 min) | acquired | refused (no_motive) | refused (ambiguous) | 4927.094 |

## Bounded testimony search

`searchInvestigation(session, runtime)` was called once per case. Candidate goals are reduced mechanically from certifier-supported signs and their dependencies; testimony actions use each account’s actual speaker and sign topic. Every returned route was then dispatched again through the public guarded engine. An incomplete catalog or exhausted budget remains `unresolved`, never an impossibility finding.

| Case | Status | Physical / testimony catalog | Nodes | Search / replay failures | Selected evidence | Actions / minutes | Testimony acquired |
|---|---|---:|---:|---:|---:|---:|---|
| mk-live-20261002-222517 | route_found | 11 / 23 | 10 | 0 / 0 | 8: `s_forceps`, `s_letter`, `s_sand`, `s_steps`, `s_tip`, `t_bell_first`, `t_bell_found`, `t_iris_exam` | 14 / 60 | true |
| mk-live-20261002-224855 | route_found | 13 / 26 | 79 | 0 / 0 | 9: `s_ada_correct`, `s_ada_ring`, `s_bruise`, `s_hugo`, `s_iris_at_inn`, `s_letter`, `s_silas`, `s_surgery_door`, `s_surgery_note` | 17 / 61 | true |
| mk-live-20261002-225824 | route_found | 14 / 43 | 7 | 0 / 0 | 6: `s_diary`, `s_dora_account`, `s_gas_stair`, `s_silas_secret`, `s_stove`, `s_yard_gate` | 11 / 50 | true |
| mk-live-20261002-235614 | route_found | 13 / 30 | 20 | 0 / 0 | 7: `s_bandage`, `s_hound`, `s_iris_test`, `s_jonah_test`, `s_notebook`, `s_telegram`, `s_wound` | 15 / 57 | true |
| mk-live-20261003-082807 | route_found | 9 / 25 | 14 | 0 / 0 | 5: `s_ada_alibi`, `s_hooks`, `s_jonah`, `s_mug`, `s_notebook` | 10 / 55 | true |
| mk-live-20261003-082809 | route_found | 10 / 25 | 24 | 0 / 0 | 7: `s_bell`, `s_cloak`, `s_duckweed`, `s_letters`, `s_prints`, `s_slate`, `s_vera` | 13 / 59 | true |
| mk-live-20261003-082813 | route_found | 23 / 33 | 15 | 0 / 0 | 8: `s_bell_ok`, `s_bell_slate`, `s_button`, `s_cassock`, `s_key`, `s_letter`, `s_receipt`, `s_silas` | 16 / 75 | true |
| mk-live-20261003-085134 | route_found | 20 / 25 | 138 | 0 / 0 | 14: `s_apron`, `s_blot_read`, `s_choir_photo`, `s_dora_sight`, `s_iris_doubt`, `s_letter`, `s_note`, `s_old_blot`, `s_paper_match`, `s_rowan_bundle`, `s_silas_away`, `s_silas_t`, `s_strip`, `s_vicar_t` | 24 / 88 | true |
| mk-live-20261003-100726 | route_found | 16 / 34 | 145 | 0 / 0 | 15: `s_bandage`, `s_basin_ring`, `s_bootprint`, `s_boots`, `s_burnt`, `s_case_notes`, `s_halt_grit`, `s_iris`, `s_jonah_hand`, `s_jonah_knife`, `s_mill_print`, `s_notebook`, `s_notice`, `s_rowan_lantern`, `s_telegram` | 25 / 116 | true |
| mk-live-20261003-130902 | route_found | 13 / 19 | 51 | 0 / 0 | 8: `s_body_key`, `s_iris_visit`, `s_letter`, `s_locker`, `s_peg`, `s_powder`, `s_revolver`, `s_waste_book` | 11 / 36 | true |
| mk-live-20261003-130906 | route_found | 18 / 30 | 241 | 0 / 0 | 13: `b_ada_letter`, `s_bottle`, `s_chalk_ring`, `s_diary`, `s_door_notice`, `s_key`, `s_notes`, `s_scene`, `s_voss_copy`, `s_watch`, `s_wire`, `t_bell_morning`, `t_vicar_ink` | 24 / 75 | true |
| mk-live-20261003-133036 | route_found | 11 / 25 | 149 | 0 / 0 | 12: `s_call`, `s_key`, `s_line`, `s_netting`, `s_notebook`, `s_pad`, `s_phone_note`, `s_print`, `s_rowan`, `s_rowan_saw`, `s_tangle`, `s_waders` | 19 / 84 | true |
| mk-live-20261003-135210 | route_found | 12 / 38 | 12 | 0 / 0 | 7: `s_ada_jonah`, `s_bell_note`, `s_card`, `s_cordon`, `s_label`, `s_vera_alibi`, `s_wound` | 14 / 57 | true |
| mk-live-20261011-112405 | route_found | 12 / 23 | 35 | 0 / 0 | 10: `b_ada_case`, `b_jonah_cuff`, `s_brass_key`, `s_case_found`, `s_jonah_bandage`, `s_note`, `s_padlock`, `s_trap_wire`, `t_jonah_cut_ask`, `t_jonah_padlock` | 14 / 60 | true |
| mk-live-20261017-223841 | route_found | 12 / 21 | 11 | 0 / 0 | 9: `s_ada_tin`, `s_bell_slate`, `s_diary`, `s_exam`, `s_marsh_test`, `s_vera_coat`, `t_bell_key`, `t_vicar`, `t_vicar_word` | 16 / 66 | true |

## Repeatability

For every case, the seed 17 / initial wait 0 autoplay execution was run once in the matrix and twice more from pristine sessions. All runs for all 15 cases also passed export/import/re-export equality. This independent comparator covers the complete typed action log, final status/evidence, and byte-for-byte exported sessions.

| Case | Equality | Action log | Final status/evidence | Exported session | Imported session |
|---|---|---|---|---|---|
| mk-live-20261002-222517 | exact | true | true | true | true |
| mk-live-20261002-224855 | exact | true | true | true | true |
| mk-live-20261002-225824 | exact | true | true | true | true |
| mk-live-20261002-235614 | exact | true | true | true | true |
| mk-live-20261003-082807 | exact | true | true | true | true |
| mk-live-20261003-082809 | exact | true | true | true | true |
| mk-live-20261003-082813 | exact | true | true | true | true |
| mk-live-20261003-085134 | exact | true | true | true | true |
| mk-live-20261003-100726 | exact | true | true | true | true |
| mk-live-20261003-130902 | exact | true | true | true | true |
| mk-live-20261003-130906 | exact | true | true | true | true |
| mk-live-20261003-133036 | exact | true | true | true | true |
| mk-live-20261003-135210 | exact | true | true | true | true |
| mk-live-20261011-112405 | exact | true | true | true | true |
| mk-live-20261017-223841 | exact | true | true | true | true |

## Failures

None.

## Caveats

- Generated kernel cases use static, no-model schedules: `life` is disabled, characters remain findable, and the script performs no network or model calls.
- Bounded search proves an existential route only for the current deterministic schedule, finite catalog, action/time/node limits, and accusation rubric. Catalog incompleteness or budget exhaustion remains unresolved.
- The autoplay seed and initial-wait matrix remains independent of bounded search and exercises session initialization, engine time advancement, guarded dispatch, every evidence gate, accusation grading, diagnostics, and save/import replay.
- Wall-clock measurements are observational and intentionally excluded from the normalized SHA-256. Game minutes, action logs, verdicts, evidence, locks, diagnostics, and save data remain in the deterministic comparison.

