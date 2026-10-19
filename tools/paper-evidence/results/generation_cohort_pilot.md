# C3/E2 bounded generation cohort pilot

Cohort `c3-e2-pilot-20261018-135950` predeclared **12** slots (4 easy, 4 medium, 4 hard) before the first call. All 12 remain in the denominator. The run used at most 3 workers and a 3600-second hard cohort bound.

Repository status: **preliminary/non-archival**; tracked diff `a85f1e13a13c92196ce136740ddda720403a7d968d3d18e9074f6960c400251e`; untracked content `5df49b03a3c3eb7edb12cdd5a06d31fcc5b8c03b57ce0cb8a2998e7ac06ec86c`.

## Outcomes

| Outcome | Slots |
|---|---:|
| completed-strictly-gateable | 11 |
| crash | 1 |

## Slot results

| Slot | Requested | Outcome | Achieved | Seconds | Calls | Input tokens | Output tokens |
|---|---|---|---|---:|---:|---:|---:|
| slot-01-easy | easy | completed-strictly-gateable | easy | 391.201 | 41 | 222816 | 56236 |
| slot-02-medium | medium | completed-strictly-gateable | medium | 796.152 | 60 | 412125 | 121251 |
| slot-03-hard | hard | completed-strictly-gateable | hard | 981.436 | 74 | 690122 | 154235 |
| slot-04-easy | easy | completed-strictly-gateable | easy | 552.035 | 50 | 308046 | 95923 |
| slot-05-medium | medium | completed-strictly-gateable | medium | 946.794 | 78 | 600550 | 136229 |
| slot-06-hard | hard | completed-strictly-gateable | hard | 979.066 | 96 | 858686 | 138728 |
| slot-07-easy | easy | crash | — | 677.999 | 40 | 178631 | 106077 |
| slot-08-medium | medium | completed-strictly-gateable | medium | 552.684 | 56 | 375550 | 83676 |
| slot-09-hard | hard | completed-strictly-gateable | hard | 967.741 | 85 | 719099 | 124694 |
| slot-10-easy | easy | completed-strictly-gateable | easy | 608.219 | 52 | 297704 | 94594 |
| slot-11-medium | medium | completed-strictly-gateable | medium | 528.046 | 47 | 232650 | 82658 |
| slot-12-hard | hard | completed-strictly-gateable | hard | 769.524 | 60 | 475690 | 116466 |

## Usage and interpretation

Complete recorded usage: `{"cacheReadInputTokens":1011714,"cacheWriteInputTokens":24736,"calls":739,"inputTokens":5371669,"outputTokens":1310767,"totalTokens":7718886}`.

All 739 scheduled requests reached a recorded terminal state: `{"completed-after-cancel":19,"response":720}`. SDK retry attempts: 0; semantic repairs: `{"forced-tool-choice-to-auto":24}`; provider-attempt HTTP statuses: `{"200":739,"400":24}`.

Usage by requested inference profile: `{"us.anthropic.claude-opus-5-5":{"cacheReadInputTokens":560634,"cacheWriteInputTokens":21156,"calls":165,"inputTokens":1890315,"outputTokens":991574,"totalTokens":3463679},"us.anthropic.claude-sonnet-5":{"cacheReadInputTokens":451080,"cacheWriteInputTokens":3580,"calls":574,"inputTokens":3481354,"outputTokens":319193,"totalTokens":4255207}}`.

Every request has a private lifecycle ledger, prompt/schema hashes and blobs, exact inference configuration including omitted defaults, provider request/HTTP/retry metadata, stop reason, complete usage, response hashes, parse result, and candidate/critic/selection fields when applicable. SDK retries and semantic repairs are separate.

No replacement, deletion, manual inclusion, playable publication, or premise-history update occurred. Unfinished and censored outcomes are retained. This pilot measures acquisition outcomes only; it does not establish end-to-end mystery quality.

Timing-independent normalized SHA-256: `0d4b02dbb7e516b0a7bd9f0be6ed11535e8c958c811dbc385c0359b9ab588369`
