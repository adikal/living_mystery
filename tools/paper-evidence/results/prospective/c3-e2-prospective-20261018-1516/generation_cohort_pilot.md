# C3/E2 bounded generation cohort pilot

Cohort `c3-e2-prospective-20261018-1516` predeclared **12** slots (4 easy, 4 medium, 4 hard) before the first call. All 12 remain in the denominator. The run used at most 3 workers and a 3600-second hard cohort bound.

Repository status: **preliminary/non-archival**; tracked diff `c771f83c6f2ace5e753401f47796cc890d3e2cd0120109acd1503ce713e185f1`; untracked content `bb6c33f022dfe3d1da89289933787c0c80cf5337c4b7cfffd6de56a8c22a9d36`.

## Outcomes

| Outcome | Slots |
|---|---:|
| completed-strictly-gateable | 11 |
| unfinished | 1 |

## Slot results

| Slot | Requested | Outcome | Achieved | Seconds | Calls | Input tokens | Output tokens |
|---|---|---|---|---:|---:|---:|---:|
| slot-01-easy | easy | completed-strictly-gateable | easy | 607.202 | 55 | 370252 | 96084 |
| slot-02-medium | medium | completed-strictly-gateable | hard | 749.189 | 65 | 393109 | 114097 |
| slot-03-hard | hard | completed-strictly-gateable | hard | 901.315 | 81 | 748409 | 138597 |
| slot-04-easy | easy | completed-strictly-gateable | easy | 687.048 | 52 | 299717 | 109350 |
| slot-05-medium | medium | completed-strictly-gateable | easy | 671.836 | 60 | 435919 | 105155 |
| slot-06-hard | hard | completed-strictly-gateable | hard | 1089.95 | 85 | 790537 | 147173 |
| slot-07-easy | easy | completed-strictly-gateable | easy | 656.03 | 62 | 380353 | 107672 |
| slot-08-medium | medium | completed-strictly-gateable | hard | 746.574 | 68 | 475081 | 97792 |
| slot-09-hard | hard | completed-strictly-gateable | hard | 947.232 | 78 | 725228 | 126214 |
| slot-10-easy | easy | completed-strictly-gateable | easy | 563.942 | 53 | 346961 | 83083 |
| slot-11-medium | medium | completed-strictly-gateable | easy | 1020.518 | 71 | 488800 | 137431 |
| slot-12-hard | hard | unfinished | — | 1042.681 | 44 | 528097 | 160082 |

## Usage and interpretation

Complete recorded usage: `{"cacheReadInputTokens":1249738,"cacheWriteInputTokens":24736,"calls":774,"inputTokens":5982463,"outputTokens":1422730,"totalTokens":8679667}`.

All 779 scheduled requests reached a recorded terminal state: `{"completed-after-cancel":17,"error":4,"response":757,"unfinished":1}`. SDK retry attempts: 0; semantic repairs: `{"forced-tool-choice-to-auto":24}`; provider-attempt HTTP statuses: `{"200":774,"400":24,"403":4}`.

Usage by requested inference profile: `{"us.anthropic.claude-opus-5-5":{"cacheReadInputTokens":680518,"cacheWriteInputTokens":21156,"calls":199,"inputTokens":2303575,"outputTokens":1092811,"totalTokens":4098060},"us.anthropic.claude-sonnet-5":{"cacheReadInputTokens":569220,"cacheWriteInputTokens":3580,"calls":575,"inputTokens":3678888,"outputTokens":329919,"totalTokens":4581607}}`.

Every request has a private lifecycle ledger, prompt/schema hashes and blobs, exact inference configuration including omitted defaults, provider request/HTTP/retry metadata, stop reason, complete usage, response hashes, parse result, and candidate/critic/selection fields when applicable. SDK retries and semantic repairs are separate.

No replacement, deletion, manual inclusion, playable publication, or premise-history update occurred. Unfinished and censored outcomes are retained. This pilot measures acquisition outcomes only; it does not establish end-to-end mystery quality.

Timing-independent normalized SHA-256: `c12c34e08d22172366c60524a877970adfae378fbf3f332f1589f0157248ec48`
