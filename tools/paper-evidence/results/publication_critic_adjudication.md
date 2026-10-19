# Agentic record-level adjudication of publication-critic findings

## Scope

Two independent codebase reviews checked all 20 issues raised by the final whole-case critic for the six failed cases
in `publication_critic_pilot.json`. Each issue was traced to the frozen case records, formal claims, links, events,
attitudes, player-facing prose, clock conversion, travel graph and certifier behavior. This is agentic adjudication,
not blind human annotation. It can identify factual critic errors and candidate defects, but it does not establish
critic accuracy.

## Aggregate result

| Classification | Issues |
|---|---:|
| Confirmed prose-record defects | 3/20 |
| Plausible narrative/craft concerns | 5/20 |
| Critic errors | 12/20 |

At case level, three of the six FAIL cases contained a confirmed player-facing defect. Three had only craft concerns or
critic errors. The five PASS cases were not independently searched for false negatives, so recall cannot be estimated.

## Per-case result

| Blind case | Requested level | Confirmed | Plausible | Critic errors | Main conclusion |
|---|---|---:|---:|---:|---|
| case-02 | medium | 0 | 1 | 4 | Compatible broad/narrow medical windows; four findings relied on incorrect minute-to-clock conversions or misread an alibi. |
| case-04 | easy | 0 | 2 | 2 | Envelope provenance and a soft deceptive phrase are reasonable craft concerns; private unused motives are not player-facing loose ends. |
| case-05 | medium | 1 | 0 | 2 | `t_hugo.show` says “ten past ten” while the claim, attitude and testimony mean “ten past nine.” Other timing/staging findings were misread. |
| case-07 | medium | 0 | 1 | 1 | Silas deliberately maintains a cover story; attribution of who closed the tap remains an optional subplot-closure concern. |
| case-09 | easy | 1 | 0 | 2 | `s_rowan_door.show` says Rowan opened the greenhouse next morning, while the event/testimony say he opened it near midnight and found the body at dawn. |
| case-10 | medium | 1 | 1 | 1 | Dora’s final prose changes a source event at 22:55 to 22:40 while its structured claim remains 22:54–22:56; characterization makes the correction weakly motivated. |

## Interpretation

The pilot established complete critic availability (11/11 reviewed, 0 unavailable) and exposed genuine publication
problems in three cases. Its raw FAIL verdicts are too noisy for a blocking production gate: 12/20 issue statements
were factual critic errors, often caused by treating integer minutes as HHMM or mistaking intentional false testimony
for a contradiction. The critic should therefore remain shadow/evaluation-only until its prompt is calibrated against
a blinded labeled set. The three confirmed defects should be retained as regression examples for that calibration.
