#!/usr/bin/env python3
"""Bounded, blinded final-publication-critic pilot over one frozen C3/E2 cohort.

One review operation is attempted per availability-selected completed case. Raw prompts, responses and issue text remain
under the ignored cohort directory; public evidence contains only typed outcomes, issue counts/digests, usage and hashes.
"""
from __future__ import annotations

import argparse
import collections
import copy
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
RESULTS = ROOT / 'tools' / 'paper-evidence' / 'results'
sys.path.insert(0, str(HERE))

import generation_cohort
import provenance
import publish
import refine

SCHEMA_VERSION = 'publication-critic-pilot-v1'
DEFAULT_COHORT = HERE / 'runs' / 'experiments' / 'c3-e2-pilot-20261018-135950'
MAX_WALL_SECONDS = 60 * 60


def git(*args):
    return subprocess.run(['git', *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()


def completed_cases(cohort):
    manifest = json.loads((cohort / 'cohort.json').read_text())
    rows = []
    for slot in sorted(manifest['slots'], key=lambda value: value['ordinal']):
        private = cohort / 'slots' / slot['slot_id'] / 'private'
        result_path = private / 'slot-result.json'
        case_path = private / 'final-experiment-case.json'
        result = json.loads(result_path.read_text()) if result_path.exists() else {}
        if result.get('outcome') == 'completed-strictly-gateable' and case_path.exists():
            rows.append({'slot': slot, 'result': result, 'case_path': case_path})
    if len(rows) != 11:
        raise RuntimeError(f'expected exactly 11 completed strictly gateable cases, found {len(rows)}')
    return rows


def normalized_projection(evidence):
    value = copy.deepcopy(evidence)
    value.pop('generated_at', None)
    value.pop('normalized_sha256', None)
    value.get('execution', {}).pop('wall_seconds', None)
    for row in value.get('cases', []):
        row.pop('request_ids', None)
        row.pop('certificate_timestamp', None)
        row.pop('certificate_digest', None)
        row.pop('audit_manifest_sha256', None)
        row.pop('audit_semantic_sha256', None)
    return value


def review_one(cohort, blind_ordinal, selected):
    blind_id = f'case-{blind_ordinal:02d}'
    private_root = cohort / 'publication-critic-pilot-v1' / blind_id
    result_path = private_root / 'result.json'
    if result_path.exists():
        # Durable resume is not a retry: a case already reviewed is always reused verbatim.
        return json.loads(result_path.read_text())

    source = selected['case_path']
    raw = source.read_bytes()
    case = json.loads(raw)
    candidate_hash = publish.publication_candidate_sha256(case)
    audit = provenance.RunAudit(
        private_root,
        f'publication-critic-{blind_id}',
        'publication-critic-pilot',
        {
            'blind_case_id': blind_id,
            'candidate_sha256': candidate_hash,
            'source_file_sha256': provenance.sha256(raw),
            'prompt_version': publish.PUBLICATION_REVIEW_VERSION,
            'prompt_sha256': provenance.sha256(publish.PUBLICATION_REVIEW_PROMPT),
            'schema_version': publish.PUBLICATION_REVIEW_SCHEMA_VERSION,
            'schema_sha256': provenance.sha256(publish.PUBLICATION_REVIEW_SCHEMA),
            'blinding': ['requested difficulty level', 'deterministic gate outcome'],
        },
    )
    with provenance.activate(audit, parent_operation='publication-critic-pilot', phase='blinded-final-review',
                             blind_case_id=blind_id):
        certificate, outcome = publish.review_for_publication(case, return_outcome=True)
    manifest = audit.finish(
        certificate['critic_status'],
        '; '.join(outcome.issues) or None,
        candidate_sha256=candidate_hash,
        certificate_digest=certificate['digest'],
    )
    requests = manifest.get('requests', [])
    row = {
        'blind_case_id': blind_id,
        'slot_id': selected['slot']['slot_id'],
        'slot_ordinal': selected['slot']['ordinal'],
        'requested_level': selected['slot']['requested_level'],
        'selection_outcome': selected['result']['outcome'],
        'status': certificate['critic_status'],
        'issue_count': certificate['critic_issue_count'],
        'issues_sha256': certificate['critic_issues_sha256'],
        'source_file_sha256': provenance.sha256(raw),
        'canonical_case_sha256': provenance.sha256(json.loads(raw)),
        'candidate_sha256': candidate_hash,
        'cohort_recorded_case_sha256': selected['result'].get('case_sha256'),
        'prompt_version': certificate['prompt']['version'],
        'prompt_sha256': certificate['prompt']['sha256'],
        'schema_version': certificate['schema']['version'],
        'schema_sha256': certificate['schema']['sha256'],
        'requested_inference_profile': certificate['requested_inference_profile'],
        'request_ids': certificate['request_ids'],
        'certificate_timestamp': certificate['timestamp'],
        'certificate_digest': certificate['digest'],
        'usage': manifest.get('usage', {}),
        'logical_requests': len(requests),
        'provider_attempts': sum(len(request.get('provider_attempts', [])) for request in requests),
        'sdk_retry_attempts': sum(request.get('sdk_retry_aggregate', 0) or 0 for request in requests),
        'semantic_repairs': [repair.get('kind') for request in requests for repair in request.get('semantic_repairs', [])],
        'audit_semantic_sha256': manifest.get('semantic_sha256'),
    }
    generation_cohort.atomic_json(result_path, row)
    row['audit_manifest_sha256'] = provenance.sha256((private_root / 'manifest.json').read_bytes())
    generation_cohort.atomic_json(result_path, row)
    return row


def build(cohort, wall_seconds=MAX_WALL_SECONDS):
    cohort = Path(cohort).resolve()
    if wall_seconds <= 0 or wall_seconds > MAX_WALL_SECONDS:
        raise ValueError('wall bound must be between 1 and 3600 seconds')
    selected = completed_cases(cohort)
    started = time.monotonic()
    rows = []
    for ordinal, case in enumerate(selected, start=1):
        if time.monotonic() - started >= wall_seconds:
            # Preserve the complete availability-selected denominator without making extra calls after the bound.
            rows.append({
                'blind_case_id': f'case-{ordinal:02d}',
                'slot_id': case['slot']['slot_id'],
                'slot_ordinal': case['slot']['ordinal'],
                'requested_level': case['slot']['requested_level'],
                'selection_outcome': case['result']['outcome'],
                'status': 'UNAVAILABLE',
                'issue_count': 1,
                'issues_sha256': provenance.sha256(['GLOBAL: AVAILABILITY: pilot wall-clock bound reached before review']),
                'source_file_sha256': provenance.sha256(case['case_path'].read_bytes()),
                'canonical_case_sha256': provenance.sha256(json.loads(case['case_path'].read_bytes())),
                'candidate_sha256': publish.publication_candidate_sha256(json.loads(case['case_path'].read_bytes())),
                'cohort_recorded_case_sha256': case['result'].get('case_sha256'),
                'logical_requests': 0,
                'provider_attempts': 0,
                'sdk_retry_attempts': 0,
                'semantic_repairs': [],
                'usage': {},
            })
            continue
        rows.append(review_one(cohort, ordinal, case))

    statuses = collections.Counter(row['status'] for row in rows)
    usage = collections.Counter()
    requests = collections.Counter()
    usage_by_profile = collections.defaultdict(collections.Counter)
    for row in rows:
        requests['logical_requests'] += row.get('logical_requests', 0)
        requests['provider_attempts'] += row.get('provider_attempts', 0)
        requests['sdk_retry_attempts'] += row.get('sdk_retry_attempts', 0)
        requests['request_ids'] += len(row.get('request_ids', []))
        for key, value in row.get('usage', {}).items():
            if isinstance(value, (int, float)):
                usage[key] += value
                usage_by_profile[row.get('requested_inference_profile', 'none')][key] += value
    evidence = {
        'schema_version': SCHEMA_VERSION,
        'generated_at': provenance.utc_now(),
        'cohort_id': cohort.name,
        'selection': {
            'rule': 'all cases whose frozen slot result is completed-strictly-gateable and has a serialized final case',
            'availability_selected': True,
            'selected': len(rows),
            'retained': len(rows),
            'excluded_slots': ['slot-07-easy'],
            'replacement_policy': 'none',
        },
        'blinding': {
            'critic_hidden_fields': list(publish.PUBLICATION_REVIEW_BLIND_FIELDS),
            'requested_level_hidden': True,
            'deterministic_gate_outcome_hidden': True,
            'note': 'Blinding applies to the model prompt; requested level is restored only in this report after each verdict.',
        },
        'execution': {
            'review_operations_per_case': 1,
            'normal_policy': 'one structured call; one semantic retry only for a schema-valid fail without an actionable issue; normal SDK policy unchanged',
            'hard_wall_seconds': wall_seconds,
            'wall_seconds': round(time.monotonic() - started, 3),
            'region': provenance.REGION,
            'playable_publication': False,
            'aws_resource_mutations': 0,
        },
        'outcomes': dict(sorted(statuses.items())),
        'request_totals': dict(sorted(requests.items())),
        'usage_totals': dict(sorted(usage.items())),
        'usage_by_requested_inference_profile': {
            profile: dict(sorted(totals.items())) for profile, totals in sorted(usage_by_profile.items())
        },
        'prompt': {
            'version': publish.PUBLICATION_REVIEW_VERSION,
            'sha256': provenance.sha256(publish.PUBLICATION_REVIEW_PROMPT),
            'schema_version': publish.PUBLICATION_REVIEW_SCHEMA_VERSION,
            'schema_sha256': provenance.sha256(publish.PUBLICATION_REVIEW_SCHEMA),
        },
        'repository': {
            'commit': git('rev-parse', 'HEAD'),
            'branch': git('branch', '--show-current') or None,
            'worktree_dirty': bool(git('status', '--porcelain=v1', '--untracked-files=all')),
        },
        'cases': rows,
        'claims_boundary': [
            'This is an availability-selected pilot over the 11 completed strictly gateable E2 cases, not accuracy evidence.',
            'Every selected case is retained regardless of PASS, FAIL or UNAVAILABLE outcome.',
            'The critic was blinded to requested level and deterministic gate outcome; no model verdict was retried beyond normal critic policy.',
            'No reviewed case or pilot provenance was made playable; raw prompts and responses remain in the ignored cohort tree.',
        ],
    }
    evidence['normalized_sha256'] = provenance.sha256(normalized_projection(evidence))
    return evidence


def write(evidence):
    RESULTS.mkdir(parents=True, exist_ok=True)
    generation_cohort.atomic_json(RESULTS / 'publication_critic_pilot.json', evidence)
    lines = [
        '# Final whole-case publication critic pilot', '',
        f"Cohort `{evidence['cohort_id']}` contributed all **{evidence['selection']['selected']}** availability-selected completed strictly gateable cases; all **{evidence['selection']['retained']}** are retained. This is an availability pilot, **not accuracy evidence**.", '',
        'The model prompt hid requested difficulty level and deterministic gate outcome. Each case received one review operation, with no retry beyond the normal typed-critic policy.', '',
        '## Outcomes', '',
        '| Status | Cases |', '|---|---:|',
        *[f'| {status} | {count} |' for status, count in sorted(evidence['outcomes'].items())], '',
        '## Cases', '',
        '| Blind case | Slot | Requested | Status | Issue count | Issue SHA-256 | Candidate SHA-256 | Certificate digest |',
        '|---|---|---|---|---:|---|---|---|',
    ]
    for row in evidence['cases']:
        digest = row.get('certificate_digest') or '—'
        lines.append(f"| {row['blind_case_id']} | {row['slot_id']} | {row['requested_level']} | {row['status']} | {row.get('issue_count', 0)} | `{row.get('issues_sha256', '—')}` | `{row['candidate_sha256']}` | `{digest}` |")
    lines.extend([
        '', '## Requests and usage', '',
        f"Request totals: `{json.dumps(evidence['request_totals'], sort_keys=True, separators=(',', ':'))}`.", '',
        f"Usage totals: `{json.dumps(evidence['usage_totals'], sort_keys=True, separators=(',', ':'))}`.", '',
        f"Prompt `{evidence['prompt']['version']}` SHA-256: `{evidence['prompt']['sha256']}`; schema `{evidence['prompt']['schema_version']}` SHA-256: `{evidence['prompt']['schema_sha256']}`.", '',
        '## Interpretation boundary', '',
        'This is an availability-selected pilot, not evidence that the critic is accurate. The 11 cases had already survived deterministic gates, so PASS rates cannot estimate error detection, and FAIL findings are model judgments requiring independent adjudication before any quality claim.', '',
        'Raw prompts/responses and full audited request lifecycles remain under the ignored private cohort tree. No case was made playable and no AWS resource was modified.', '',
        f"Timing-independent normalized SHA-256: `{evidence['normalized_sha256']}`", '',
    ])
    (RESULTS / 'publication_critic_pilot.md').write_text('\n'.join(lines))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cohort', type=Path, default=DEFAULT_COHORT)
    parser.add_argument('--wall-seconds', type=int, default=MAX_WALL_SECONDS)
    args = parser.parse_args()
    evidence = build(args.cohort, args.wall_seconds)
    write(evidence)
    print(json.dumps({'outcomes': evidence['outcomes'], 'request_totals': evidence['request_totals'],
                      'usage_totals': evidence['usage_totals'], 'normalized_sha256': evidence['normalized_sha256']},
                     sort_keys=True))


if __name__ == '__main__':
    main()
