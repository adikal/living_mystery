"""Hermetic tests for the final whole-case publication boundary; no model or network calls."""
import concurrent.futures as cf
import contextlib
import io
import json
import os
import stat
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import premise
import publish
import refine

_REAL_REVIEW_FOR_PUBLICATION = publish.review_for_publication
CALIBRATION = HERE / 'fixtures' / 'publication_critic_calibration.json'


def outcome(status, issues=()):
    raw = {'verdict': status.value.lower(), 'issues': list(issues)}
    attempt = refine.CriticAttempt(raw, ('request-1',))
    return refine.CriticOutcome(status, tuple(issues), raw, (attempt,), attempt.request_ids,
                                'us.test.publication-profile')


def candidate(case_id='case-1'):
    return {
        'id': case_id,
        'title': 'A coherent case',
        'synopsis': 'A victim is found dead.',
        'people': [{'id': 'victim', 'name': 'The Victim'}],
        'signs': [{'id': 's1', 'kind': 'record', 'text': 'A neutral clue.'}],
        'question': {'candidates': [{'id': 'h1'}]},
    }


def attach(case, status, issues=()):
    return _REAL_REVIEW_FOR_PUBLICATION(
        case,
        reviewer=lambda _case: outcome(status, issues),
        timestamp='2026-10-18T13:59:50.000Z',
    )


def attach_pass(case):
    return attach(case, refine.CriticStatus.PASS)


def deterministic_ok():
    return {
        'ok': True,
        'errors': [],
        'python': {'ok': True},
        'js': {'ok': True, 'solveDepth': 2, 'pillars': {'opportunity': 2, 'means': 1, 'motive': 1}},
        'z3': {'ok': True, 'errors': []},
    }


class CertificateSemantics(unittest.TestCase):
    def test_pass_certificate_is_hash_bound_typed_and_contains_no_private_issues(self):
        case = candidate()
        certificate = attach_pass(case)
        self.assertEqual(certificate['critic_status'], 'PASS')
        self.assertEqual(certificate['critic_issue_count'], 0)
        self.assertEqual(certificate['critic_issues_sha256'], publish.provenance.sha256([]))
        self.assertEqual(certificate['candidate_sha256'], publish.publication_candidate_sha256(case))
        self.assertEqual(certificate['digest'], publish.provenance.sha256(
            {key: value for key, value in certificate.items() if key != 'digest'}))
        self.assertNotIn('critic_issues', certificate)
        self.assertNotIn('raw', certificate)
        self.assertNotIn('raw_response', certificate)

    def test_shadow_mode_never_blocks_on_missing_fail_or_unavailable_review(self):
        issue = 'GLOBAL: FAIRNESS: a necessary inference is not available to the player'
        cases = [candidate('missing')]
        for status, issues in ((refine.CriticStatus.FAIL, (issue,)),
                               (refine.CriticStatus.UNAVAILABLE, ())):
            case = candidate(status.value)
            attach(case, status, issues)
            cases.append(case)
        for case in cases:
            with self.subTest(case=case['id']), \
                    mock.patch.object(publish, 'deterministic_gate', return_value=deterministic_ok()) as deterministic:
                result = publish.gate(case)
            self.assertTrue(result['ok'])
            self.assertEqual(result['publication_review_mode'], 'shadow')
            deterministic.assert_called_once_with(case)

    def test_strict_mode_blocks_missing_fail_and_unavailable_review(self):
        issue = 'GLOBAL: FAIRNESS: a necessary inference is not available to the player'
        cases = [candidate('missing')]
        for status, issues in ((refine.CriticStatus.FAIL, (issue,)),
                               (refine.CriticStatus.UNAVAILABLE, ())):
            case = candidate(status.value)
            attach(case, status, issues)
            cases.append(case)
        for case in cases:
            with self.subTest(case=case['id']), \
                    mock.patch.object(publish, 'deterministic_gate', return_value=deterministic_ok()) as deterministic:
                result = publish.gate(case, strict_publication_review=True)
            self.assertFalse(result['ok'])
            self.assertEqual(result['publication_review_mode'], 'strict')
            self.assertIn('not PASS', '; '.join(result['errors']))
            deterministic.assert_called_once_with(case)

    def test_deterministic_failure_blocks_even_when_review_passes(self):
        case = candidate()
        attach_pass(case)
        failed = deterministic_ok()
        failed.update(ok=False, errors=['python: impossible case'])
        with mock.patch.object(publish, 'deterministic_gate', return_value=failed):
            result = publish.gate(case)
        self.assertFalse(result['ok'])
        self.assertEqual(result['errors'], ['python: impossible case'])

    def test_stale_and_explicit_hash_mismatch_are_reported_and_strictly_blocked(self):
        stale = candidate('stale')
        attach_pass(stale)
        stale['title'] = 'Changed after review'
        self.assertIn('candidate hash is stale', '; '.join(publish.publication_certificate_errors(stale)))

        mismatch = candidate('mismatch')
        attach_pass(mismatch)
        mismatch['publication_review']['candidate_sha256'] = '0' * 64
        unsigned = {key: value for key, value in mismatch['publication_review'].items() if key != 'digest'}
        mismatch['publication_review']['digest'] = publish.provenance.sha256(unsigned)
        errors = publish.publication_certificate_errors(mismatch)
        self.assertIn('publication review certificate candidate hash is stale', errors)
        self.assertNotIn('publication review certificate digest mismatch', errors)
        with mock.patch.object(publish, 'deterministic_gate', return_value=deterministic_ok()):
            self.assertFalse(publish.gate(mismatch, strict_publication_review=True)['ok'])

    def test_tampered_certificate_digest_prompt_or_schema_is_reported(self):
        case = candidate()
        attach_pass(case)
        case['publication_review']['digest'] = 'bad'
        self.assertIn('publication review certificate digest mismatch', publish.publication_certificate_errors(case))

        case = candidate('prompt')
        attach_pass(case)
        case['publication_review']['prompt']['version'] = 'old'
        unsigned = {key: value for key, value in case['publication_review'].items() if key != 'digest'}
        case['publication_review']['digest'] = publish.provenance.sha256(unsigned)
        self.assertIn('publication review prompt hash or version mismatch', publish.publication_certificate_errors(case))


class PromptCalibration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixtures = {item['id']: item for item in json.loads(CALIBRATION.read_text())['fixtures']}

    def test_minute_conversion_regression(self):
        self.assertIn('complete 1932 English village mystery', publish.PUBLICATION_REVIEW_PROMPT)
        self.assertIn('1320 means 22:00', publish.PUBLICATION_REVIEW_PROMPT)
        self.assertIn('Values above 1440 are on the next day', publish.PUBLICATION_REVIEW_PROMPT)
        fixture = self.fixtures['minutes-after-midnight']
        self.assertEqual(fixture['expected_verdict'], 'pass')
        self.assertIn('1370 is 22:50', fixture['rationale'])

    def test_intentional_lie_regression(self):
        prompt = publish.PUBLICATION_REVIEW_PROMPT
        self.assertIn('Intentional false testimony and cover stories are allowed', prompt)
        self.assertIn('declared, reachable defeater', prompt)
        fixture = self.fixtures['declared-intentional-lie']
        self.assertEqual(fixture['expected_verdict'], 'pass')
        self.assertTrue(fixture['case_excerpt']['signs'][0]['deceptive'])

    def test_hidden_private_motive_regression(self):
        self.assertIn('not automatically player-facing loose ends', publish.PUBLICATION_REVIEW_PROMPT)
        self.assertEqual(self.fixtures['hidden-private-motive']['expected_verdict'], 'pass')

    def test_minor_and_taste_concerns_must_pass(self):
        self.assertIn('stylistic or taste concerns must pass', publish.PUBLICATION_REVIEW_PROMPT)

    def test_three_confirmed_prose_record_defects_remain_labeled_failures(self):
        confirmed = [item for item in self.fixtures.values()
                     if item['regression'] == 'confirmed-prose-record-defect']
        self.assertEqual(len(confirmed), 3)
        self.assertEqual({item['source']['blind_case_id'] for item in confirmed},
                         {'case-05', 'case-09', 'case-10'})
        self.assertTrue(all(item['expected_verdict'] == 'fail' for item in confirmed))
        self.assertTrue(all(len(item['source']['candidate_sha256']) == 64 for item in confirmed))


class EnrichmentPhases(unittest.TestCase):
    def test_sign_mutations_are_serial_and_keep_provenance_context(self):
        calls = []
        audit = object()

        def operation(name, result=0):
            def run(*_args, **_kwargs):
                calls.append((name, publish.provenance.current_audit(), publish.provenance.semantic_context()))
                return result
            return run

        patches = [
            mock.patch.object(premise, 'morning_errors', return_value=[]),
            mock.patch.object(publish, 'prune_people', side_effect=operation('prune', [])),
            mock.patch.object(publish, 'add_ordinary_evenings', side_effect=operation('evenings')),
            mock.patch.object(publish.enrich, 'add_answer', side_effect=operation('answer')),
            mock.patch.object(publish.enrich, 'add_accepted', side_effect=operation('accepted')),
            mock.patch.object(publish, 'add_surface_accounts', side_effect=operation('surface')),
            mock.patch.object(publish, 'add_morning_accounts', side_effect=operation('morning')),
            mock.patch.object(publish, 'add_medical', side_effect=operation('medical')),
            mock.patch.object(publish, 'add_concessions', side_effect=operation('concessions')),
            mock.patch.object(publish.enrich, 'add_knowledge', side_effect=operation('knowledge')),
            mock.patch.object(publish.enrich, 'add_moods', side_effect=operation('moods')),
            mock.patch.object(publish, 'add_show_lines', side_effect=operation('show')),
            mock.patch.object(publish.enrich, 'add_art', side_effect=operation('art')),
            mock.patch.object(publish, 'mark_surface_truth', side_effect=operation('truth')),
            mock.patch.object(publish, 'add_questions', side_effect=operation('questions')),
            mock.patch.object(publish, 'add_reactions', side_effect=operation('reactions')),
            mock.patch.object(publish, 'add_sightings', side_effect=operation('sightings')),
            mock.patch.object(publish, 'record_contradictions', side_effect=operation('contradictions')),
            mock.patch.object(publish, 'add_declines', side_effect=operation('declines')),
            mock.patch.object(publish, 'add_fallback_lines', side_effect=operation('fallbacks')),
            mock.patch.object(publish.enrich, 'add_unlock_groups', side_effect=operation('unlock')),
            mock.patch.object(publish.enrich, 'review_publish', side_effect=operation('review', {})),
            mock.patch.object(publish, 'finish_wording', side_effect=operation('finish')),
        ]
        with contextlib.ExitStack() as stack:
            for patcher in patches:
                stack.enter_context(patcher)
            with publish.provenance.activate(audit, phase='publication-enrichment'):
                publish.enrich_case({'synopsis': 'A neutral premise.', 'signs': []}, log=lambda *_: None)
        names = [name for name, _, _ in calls]
        # structure first, in order; then two waves of independent wording phases (any order within a wave, each on
        # its own copy, merged back); then the serial review and the last pass
        self.assertEqual(names[:4], ['prune', 'evenings', 'answer', 'accepted'])
        first = {'surface', 'morning', 'medical', 'concessions', 'knowledge', 'moods', 'declines', 'fallbacks', 'sightings', 'contradictions'}
        second = {'truth', 'questions', 'reactions', 'show', 'art'}
        self.assertEqual(set(names[4:4 + len(first)]), first)
        self.assertLess(names.index('sightings'), names.index('contradictions'))
        self.assertEqual(set(names[4 + len(first):4 + len(first) + len(second)]), second)
        self.assertEqual(names[-3:], ['unlock', 'review', 'finish'])
        self.assertTrue(all(seen is audit for _, seen, _ in calls))
        self.assertTrue(all(context['phase'] == 'publication-enrichment' for _, _, context in calls))


class OrdinaryPublicationPaths(unittest.TestCase):
    def patches(self):
        return (
            mock.patch.object(publish, 'review_for_publication', side_effect=lambda case: attach_pass(case)),
            mock.patch.object(publish, 'deterministic_gate', return_value=deterministic_ok()),
            mock.patch.object(publish.difficulty, 'rate', return_value={'v': 1, 'score': 1.0, 'level': 'easy', 'features': {}}),
        )

    def test_atomic_json_preserves_existing_file_when_serialization_fails(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root, 'case.json')
            original = b'{"old":true}\n'
            target.write_bytes(original)
            with self.assertRaises(TypeError):
                publish.pubio.atomic_json(str(target), {'bad': object()})
            self.assertEqual(target.read_bytes(), original)
            self.assertEqual(list(Path(root).glob('.publication-*')), [])

    def test_live_path_uses_shared_review_boundary_and_atomically_indexes(self):
        case = candidate('source')
        case['question']['crime'] = {'place': 'manor'}
        brief = ('Title', 'Blurb', 'manor', 'private brief')
        with tempfile.TemporaryDirectory() as root, \
                mock.patch.object(publish, 'LIVE', os.path.join(root, 'live')), \
                mock.patch.object(publish, 'enrich_case', side_effect=lambda value: value), \
                mock.patch.object(publish.enrich, 'victim_of', return_value='victim'), \
                self.patches()[0] as review, self.patches()[1], self.patches()[2]:
            entry, report = publish.publish_live(case, brief, 'stamp')
            served = json.loads(Path(root, 'live', 'mk-live-stamp.json').read_text())
            index = json.loads(Path(root, 'live', 'index.json').read_text())
        self.assertEqual(review.call_count, 1)
        self.assertEqual(served['publication_review']['critic_status'], 'PASS')
        self.assertEqual(index[0]['id'], entry['id'])
        self.assertEqual(report['solveDepth'], 2)

    def test_static_path_uses_same_shared_review_boundary(self):
        case = candidate('source')
        with tempfile.TemporaryDirectory() as root:
            source = Path(root, 'final-case.json')
            source.write_text(json.dumps(case))
            out = Path(root, 'out')

            def files(pattern):
                return [str(source)] if 'bw-ledger' in pattern else []

            with mock.patch.object(publish, 'OUT', str(out)), \
                    mock.patch.object(publish.glob, 'glob', side_effect=files), \
                    mock.patch.object(publish, 'js_certify', side_effect=lambda paths: [deterministic_ok()['js'] for _ in paths]), \
                    mock.patch.object(publish, 'enrich_case', side_effect=lambda value: value), \
                    self.patches()[0] as review, self.patches()[1], self.patches()[2]:
                publish.main()
            served = json.loads((out / 'mk-bw-ledger.json').read_text())
            index = json.loads((out / 'index.json').read_text())
        self.assertEqual(review.call_count, 1)
        self.assertEqual(served['publication_review']['critic_status'], 'PASS')
        self.assertEqual([entry['id'] for entry in index], ['mk-bw-ledger'])

    def test_enrich_live_does_not_report_success_after_failed_save(self):
        case = candidate('mk-live-failed')
        case['difficulty'] = {'target': 'hard'}
        with tempfile.TemporaryDirectory() as root:
            live = Path(root, 'live')
            live.mkdir()
            path = live / 'mk-live-failed.json'
            path.write_text(json.dumps(case), encoding='utf-8')
            (live / 'index.json').write_text(json.dumps([{'id': case['id'], 'file': 'live/mk-live-failed.json'}]))
            output = io.StringIO()
            with mock.patch.object(publish, 'LIVE', str(live)), \
                    mock.patch.object(publish, 'enrich_case', side_effect=lambda value: value), \
                    mock.patch.object(publish, '_review_gate_rate', side_effect=ValueError('gate failed')), \
                    contextlib.redirect_stdout(output):
                publish.enrich_live()
        self.assertIn('NOT saved: ValueError: gate failed', output.getvalue())
        self.assertNotIn('enriched mk-live-failed.json', output.getvalue())

    def test_enrich_live_continues_after_any_error_and_reads_only_indexed_cases(self):
        with tempfile.TemporaryDirectory() as root:
            live = Path(root, 'live')
            live.mkdir()
            listed = [candidate('mk-live-a'), candidate('mk-live-b')]
            for case in listed + [candidate('mk-live-unlisted')]:
                (live / f"{case['id']}.json").write_text(json.dumps(case), encoding='utf-8')
            (live / 'index.json').write_text(json.dumps(
                [{'id': case['id'], 'file': f"live/{case['id']}.json"} for case in listed]))
            seen = []

            def enrich(value):
                seen.append(value['id'])
                if value['id'] == 'mk-live-a':
                    raise KeyError('a model reply without its key')
                return value

            output = io.StringIO()
            with mock.patch.object(publish, 'LIVE', str(live)), \
                    mock.patch.object(publish, 'enrich_case', side_effect=enrich), \
                    self.patches()[0], self.patches()[1], self.patches()[2], contextlib.redirect_stdout(output):
                publish.enrich_live()
            saved_b = json.loads((live / 'mk-live-b.json').read_text())
        self.assertEqual(seen, ['mk-live-a', 'mk-live-b'])
        self.assertIn("mk-live-a.json NOT saved: KeyError: 'a model reply without its key'", output.getvalue())
        self.assertIn('enriched mk-live-b.json', output.getvalue())
        self.assertEqual(saved_b['publication_review']['critic_status'], 'PASS')

    def test_enrich_live_skips_a_case_changed_on_disk_meanwhile(self):
        case = candidate('mk-live-raced')
        with tempfile.TemporaryDirectory() as root:
            live = Path(root, 'live')
            live.mkdir()
            path = live / 'mk-live-raced.json'
            path.write_text(json.dumps(case), encoding='utf-8')
            (live / 'index.json').write_text(json.dumps([{'id': case['id'], 'file': 'live/mk-live-raced.json'}]))
            concurrent = {**case, 'title': 'Written by another process meanwhile'}

            def enrich(value):
                path.write_text(json.dumps(concurrent), encoding='utf-8')
                return value

            output = io.StringIO()
            with mock.patch.object(publish, 'LIVE', str(live)), \
                    mock.patch.object(publish, 'enrich_case', side_effect=enrich), \
                    self.patches()[0], self.patches()[1], self.patches()[2], contextlib.redirect_stdout(output):
                publish.enrich_live()
            self.assertEqual(json.loads(path.read_text()), concurrent)
        self.assertIn('changed on disk', output.getvalue())
        self.assertNotIn('enriched mk-live-raced.json', output.getvalue())

    def test_concurrent_live_commits_merge_index_and_history(self):
        cases, entries, premises = [], [], []
        for number in range(2):
            case = candidate(f'mk-live-{number}')
            case['difficulty'] = {'v': 1, 'score': number / 10, 'level': 'easy', 'features': {}}
            cases.append(case)
            entries.append({'id': case['id'], 'file': f"live/{case['id']}.json", 'title': case['title'],
                            'solveDepth': 2, 'blurb': case['synopsis'], 'generated': str(number),
                            'difficulty': {'level': 'easy', 'score': number / 10}})
            premises.append({'victim': f'victim-{number}', 'culprit': f'culprit-{number}', 'method': 'blow',
                             'motive': 'money', 'place': 'manor', 'shape': 'two_liars'})
        with tempfile.TemporaryDirectory() as root:
            live = Path(root, 'live')
            history = Path(root, 'premise-history.json')
            with mock.patch.object(publish, 'LIVE', str(live)), mock.patch.object(premise, 'HISTORY', str(history)):
                with cf.ThreadPoolExecutor(2) as executor:
                    list(executor.map(lambda args: publish._commit_live_case(*args), zip(cases, entries, premises)))
            index = json.loads(Path(live, 'index.json').read_text(encoding='utf-8'))
            history_rows = json.loads(history.read_text(encoding='utf-8'))
        self.assertEqual({entry['id'] for entry in index}, {case['id'] for case in cases})
        self.assertEqual({row['publication_id'] for row in history_rows}, {case['id'] for case in cases})

    def test_interrupted_live_commit_is_reconciled_index_last(self):
        case = candidate('mk-live-recovery')
        case['difficulty'] = {'v': 1, 'score': 0.4, 'level': 'easy', 'features': {}}
        entry = {'id': case['id'], 'file': f"live/{case['id']}.json", 'title': case['title'],
                 'solveDepth': 2, 'blurb': case['synopsis'], 'generated': 'stamp',
                 'difficulty': {'level': 'easy', 'score': 0.4}}
        premise_record = {'victim': 'ada', 'culprit': 'hugo', 'method': 'blow', 'motive': 'money',
                          'place': 'manor', 'shape': 'two_liars'}
        real_atomic = publish._atomic_json
        failed = False

        def interrupt_index(path, value):
            nonlocal failed
            if os.path.basename(path) == 'index.json' and not failed:
                failed = True
                raise OSError('simulated interruption')
            return real_atomic(path, value)

        with tempfile.TemporaryDirectory() as root:
            live = Path(root, 'live')
            history = Path(root, 'premise-history.json')
            with mock.patch.object(publish, 'LIVE', str(live)), \
                    mock.patch.object(premise, 'HISTORY', str(history)), \
                    mock.patch.object(publish, '_atomic_json', side_effect=interrupt_index):
                with self.assertRaisesRegex(OSError, 'simulated interruption'):
                    publish._commit_live_case(case, entry, premise_record)
            self.assertTrue(Path(live, f"{case['id']}.json").exists())
            self.assertTrue(Path(live, '.publication-transaction.json').exists())
            self.assertFalse(Path(live, 'index.json').exists())
            with mock.patch.object(publish, 'LIVE', str(live)), \
                    mock.patch.object(premise, 'HISTORY', str(history)):
                self.assertEqual(publish.recover_live_publication(), entry)
                self.assertIsNone(publish.recover_live_publication())
            index = json.loads(Path(live, 'index.json').read_text(encoding='utf-8'))
            history_rows = json.loads(history.read_text(encoding='utf-8'))
        self.assertEqual(index, [entry])
        self.assertEqual([row['publication_id'] for row in history_rows], [case['id']])

    def test_static_failure_keeps_previous_entry_and_reports_written_count(self):
        case = candidate('source')
        with tempfile.TemporaryDirectory() as root:
            source = Path(root, 'final-case.json')
            source.write_text(json.dumps(case), encoding='utf-8')
            out = Path(root, 'out')
            out.mkdir()
            previous_entry = {'id': 'mk-bw-ledger', 'file': 'mk-bw-ledger.json', 'title': 'Old title'}
            (out / 'index.json').write_text(json.dumps([previous_entry]), encoding='utf-8')
            (out / 'mk-bw-ledger.json').write_text(json.dumps(candidate('mk-bw-ledger')), encoding='utf-8')

            def files(pattern):
                return [str(source)] if 'bw-ledger' in pattern else []

            output = io.StringIO()
            with mock.patch.object(publish, 'OUT', str(out)), \
                    mock.patch.object(publish.glob, 'glob', side_effect=files), \
                    mock.patch.object(publish, 'js_certify', return_value=[deterministic_ok()['js']]), \
                    mock.patch.object(publish, 'enrich_case', side_effect=lambda value: value), \
                    mock.patch.object(publish, '_review_gate_rate', side_effect=ValueError('gate failed')), \
                    contextlib.redirect_stdout(output):
                publish.main()
            saved_index = json.loads((out / 'index.json').read_text(encoding='utf-8'))
        self.assertEqual(saved_index, [previous_entry])
        self.assertIn('kept previous index entry', output.getvalue())
        self.assertIn('0 written, 1 cases in', output.getvalue())

    def run_static(self, out, files, gate_side_effect=None):
        """Run publish.main() hermetically: one source run per brief in `files`, with an optional gate behaviour."""
        output = io.StringIO()
        gate_patch = (mock.patch.object(publish, '_review_gate_rate', side_effect=gate_side_effect)
                      if gate_side_effect else self.patches()[0])
        with mock.patch.object(publish, 'OUT', str(out)), \
                mock.patch.object(publish, 'LIVE', str(out / 'live')), \
                mock.patch.object(publish.glob, 'glob',
                                  side_effect=lambda pattern: [str(files[b]) for b in files if f'/{b}/' in pattern]), \
                mock.patch.object(publish, 'js_certify', side_effect=lambda paths: [deterministic_ok()['js'] for _ in paths]), \
                mock.patch.object(publish, 'enrich_case', side_effect=lambda value: value), \
                gate_patch, self.patches()[1], self.patches()[2], contextlib.redirect_stdout(output):
            publish.main()
        return output.getvalue(), json.loads((out / 'index.json').read_text(encoding='utf-8'))

    def test_static_brief_without_a_certified_run_keeps_its_entry_only_while_its_file_exists(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root, 'final-case.json')
            source.write_text(json.dumps(candidate('source')), encoding='utf-8')
            out = Path(root, 'out')
            out.mkdir()
            kept = {'id': 'mk-bw-pair', 'file': 'mk-bw-pair.json', 'title': 'Kept'}
            gone = {'id': 'mk-bw-vestry', 'file': 'mk-bw-vestry.json', 'title': 'File deleted'}
            (out / 'index.json').write_text(json.dumps([kept, gone]), encoding='utf-8')
            (out / 'mk-bw-pair.json').write_text(json.dumps(candidate('mk-bw-pair')), encoding='utf-8')
            output, index = self.run_static(out, {'bw-ledger': source})
        self.assertEqual([entry['id'] for entry in index], ['mk-bw-ledger', 'mk-bw-pair'])
        self.assertEqual(index[1], kept)
        self.assertIn('mk-bw-pair NOT replaced (no certified run); kept previous index entry', output)
        self.assertIn('mk-bw-vestry NOT replaced (no certified run); previous index entry dropped: its file is gone', output)
        self.assertNotIn('mk-bw-inn', output)
        self.assertIn('1 written, 2 cases in', output)

    def test_static_kept_entry_is_read_from_the_index_inside_the_lock(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root, 'final-case.json')
            source.write_text(json.dumps(candidate('source')), encoding='utf-8')
            out = Path(root, 'out')
            out.mkdir()
            stale = {'id': 'mk-bw-ledger', 'file': 'mk-bw-ledger.json', 'difficulty': {'level': 'easy'}}
            fresh = {**stale, 'difficulty': {'level': 'hard'}}
            (out / 'index.json').write_text(json.dumps([stale]), encoding='utf-8')
            (out / 'mk-bw-ledger.json').write_text(json.dumps(candidate('mk-bw-ledger')), encoding='utf-8')

            def concurrent_rerate_then_fail(*_args, **_kwargs):
                (out / 'index.json').write_text(json.dumps([fresh]), encoding='utf-8')   # e.g. difficulty.rate_all
                raise ValueError('gate failed')

            _, index = self.run_static(out, {'bw-ledger': source}, concurrent_rerate_then_fail)
        self.assertEqual(index, [fresh])

    def test_static_case_that_does_not_read_back_is_never_indexed(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root, 'final-case.json')
            source.write_text(json.dumps(candidate('source')), encoding='utf-8')
            out = Path(root, 'out')
            out.mkdir()
            previous = [{'id': 'mk-bw-ledger', 'file': 'mk-bw-ledger.json'}]
            (out / 'index.json').write_text(json.dumps(previous), encoding='utf-8')
            real_atomic = publish._atomic_json

            def corrupting_write(path, value):
                if path.endswith('mk-bw-ledger.json'):
                    value = {**value, 'title': 'not what was meant'}
                return real_atomic(path, value)

            with mock.patch.object(publish, '_atomic_json', side_effect=corrupting_write):
                with self.assertRaisesRegex(OSError, 'did not read back'):
                    self.run_static(out, {'bw-ledger': source})
            self.assertEqual(json.loads((out / 'index.json').read_text()), previous)

    def live_publication(self, root, review=None, gate=None, strict=False):
        """publish_live with enrichment, review, gate and rating mocked; returns the atomic_json call count."""
        case = candidate('source')
        case['question']['crime'] = {'place': 'manor'}
        writes = mock.Mock(side_effect=publish._atomic_json)
        with mock.patch.object(publish, 'LIVE', os.path.join(root, 'live')), \
                mock.patch.object(publish, 'enrich_case', side_effect=lambda value: value), \
                mock.patch.object(publish.enrich, 'victim_of', return_value='victim'), \
                mock.patch.object(publish, 'review_for_publication', side_effect=review or attach_pass), \
                (mock.patch.object(publish, 'gate', side_effect=gate) if gate else
                 mock.patch.object(publish, 'deterministic_gate', return_value=deterministic_ok())), \
                self.patches()[2], mock.patch.object(publish, '_atomic_json', writes):
            try:
                publish.publish_live(case, ('Title', 'Blurb', 'manor', 'private brief'), 'stamp',
                                     strict_publication_review=strict)
            finally:
                self.live_writes = writes.call_count

    def test_fail_issues_stay_out_of_browser_served_json_in_shadow_mode(self):
        issue = 's_secret: CONTRADICTION: private detail that must not be browser served'
        case = candidate('shadow-fail')

        def review(value):
            attach(value, refine.CriticStatus.FAIL, (issue,))

        with mock.patch.object(publish, 'review_for_publication', side_effect=review), \
                mock.patch.object(publish, 'deterministic_gate', return_value=deterministic_ok()), \
                self.patches()[2]:
            served, report = publish._review_gate_rate(case)
        raw = json.dumps(served, ensure_ascii=False)
        self.assertTrue(report['ok'])
        self.assertEqual(report['publication_review_mode'], 'shadow')
        self.assertEqual(served['publication_review']['critic_status'], 'FAIL')
        self.assertEqual(served['publication_review']['critic_issue_count'], 1)
        self.assertNotIn('critic_issues', served['publication_review'])
        self.assertNotIn(issue, raw)
        self.assertNotIn('private detail', raw)

    def test_strict_mode_raises_for_fail_and_unavailable_and_writes_nothing(self):
        issue = 'GLOBAL: FAIRNESS: strict experimental failure'
        for status, issues in ((refine.CriticStatus.FAIL, (issue,)), (refine.CriticStatus.UNAVAILABLE, ())):
            def review(value):
                attach(value, status, issues)

            with self.subTest(status=status.value):
                with mock.patch.object(publish, 'review_for_publication', side_effect=review), \
                        mock.patch.object(publish, 'deterministic_gate', return_value=deterministic_ok()), \
                        self.patches()[2]:
                    with self.assertRaisesRegex(ValueError, 'not PASS'):
                        publish._review_gate_rate(candidate(f'strict-{status.value}'), strict_publication_review=True)
                with tempfile.TemporaryDirectory() as root:
                    with self.assertRaisesRegex(ValueError, 'not PASS'):
                        self.live_publication(root, review=review, strict=True)
                    self.assertEqual(self.live_writes, 0)
                    self.assertEqual(list(Path(root).rglob('*')), [])

    def test_failed_post_serialization_gate_writes_nothing(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(ValueError, 'serialized published case failed'):
                self.live_publication(root, gate=[deterministic_ok(), {'ok': False, 'errors': ['post failed']}])
            self.assertEqual(self.live_writes, 0)
            self.assertFalse(Path(root, 'live', 'mk-live-stamp.json').exists())
            self.assertEqual(list(Path(root).rglob('.publication-*')), [])   # atomic_json's real temporary prefix

    def test_publish_live_refuses_to_overwrite_a_published_case(self):
        with tempfile.TemporaryDirectory() as root:
            live = Path(root, 'live')
            live.mkdir()
            existing = live / 'mk-live-stamp.json'
            original = b'{"published":true}\n'
            existing.write_bytes(original)
            with self.assertRaisesRegex(ValueError, 'already published'):
                self.live_publication(root)
            self.assertEqual(existing.read_bytes(), original)
            self.assertFalse((live / 'index.json').exists())
            # The commit re-checks under the lock, for a file that appears after the early check.
            with mock.patch.object(publish, 'LIVE', str(live)):
                with self.assertRaisesRegex(ValueError, 'already published'):
                    publish._commit_live_case({'id': 'mk-live-stamp'}, {'id': 'mk-live-stamp',
                                                                          'file': 'live/mk-live-stamp.json'})
            self.assertEqual(existing.read_bytes(), original)
            self.assertFalse(Path(live, '.publication-transaction.json').exists())

    def test_live_case_that_does_not_read_back_is_not_indexed_and_stays_recoverable(self):
        case = candidate('mk-live-readback')
        entry = {'id': case['id'], 'file': f"live/{case['id']}.json"}
        real_atomic = publish._atomic_json

        def corrupting_write(path, value):
            if path.endswith(f"{case['id']}.json"):
                value = {**value, 'title': 'not what was meant'}
            return real_atomic(path, value)

        with tempfile.TemporaryDirectory() as root:
            live = Path(root, 'live')
            with mock.patch.object(publish, 'LIVE', str(live)), \
                    mock.patch.object(publish, '_atomic_json', side_effect=corrupting_write):
                with self.assertRaisesRegex(OSError, 'did not read back'):
                    publish._commit_live_case(case, entry)
            self.assertFalse((live / 'index.json').exists())
            self.assertTrue((live / '.publication-transaction.json').exists())


def write_marker(live, case, entry, case_sha256=None):
    live.mkdir(parents=True, exist_ok=True)
    (live / f"{case['id']}.json").write_text(json.dumps(case), encoding='utf-8')
    marker = {'version': 1, 'case_file': f"{case['id']}.json", 'entry': entry, 'premise': None,
              'case_sha256': case_sha256 or publish.provenance.sha256(case)}
    (live / '.publication-transaction.json').write_text(json.dumps(marker), encoding='utf-8')


class RecoveryMarkers(unittest.TestCase):
    def quarantined(self, live):
        return sorted(live.glob('.publication-transaction.rejected-*.json'))

    def test_hash_mismatch_is_quarantined_and_publication_proceeds(self):
        orphan, fresh = candidate('mk-live-orphan'), candidate('mk-live-fresh')
        with tempfile.TemporaryDirectory() as root:
            live = Path(root, 'live')
            write_marker(live, orphan, {'id': orphan['id'], 'file': f"live/{orphan['id']}.json"}, case_sha256='0' * 64)
            errors = io.StringIO()
            with mock.patch.object(publish, 'LIVE', str(live)), contextlib.redirect_stderr(errors):
                publish._commit_live_case(fresh, {'id': fresh['id'], 'file': f"live/{fresh['id']}.json"})
            index = json.loads((live / 'index.json').read_text(encoding='utf-8'))
            rejected = self.quarantined(live)
            self.assertFalse((live / '.publication-transaction.json').exists())
            self.assertTrue((live / f"{orphan['id']}.json").exists())
            self.assertEqual(len(rejected), 1)
            self.assertEqual(json.loads(rejected[0].read_text())['case_sha256'], '0' * 64)
        self.assertEqual([entry['id'] for entry in index], [fresh['id']])   # the orphan stays unindexed
        self.assertIn('WARNING: live publication recovery marker rejected', errors.getvalue())
        self.assertIn('does not match its identity or hash', errors.getvalue())

    def test_identity_mismatch_is_quarantined(self):
        orphan = candidate('mk-live-orphan')
        with tempfile.TemporaryDirectory() as root:
            live = Path(root, 'live')
            write_marker(live, orphan, {'id': 'mk-live-other', 'file': f"live/{orphan['id']}.json"})
            with mock.patch.object(publish, 'LIVE', str(live)), contextlib.redirect_stderr(io.StringIO()):
                self.assertIsNone(publish.recover_live_publication())
            self.assertEqual(len(self.quarantined(live)), 1)
            self.assertFalse((live / 'index.json').exists())

    def test_invalid_marker_is_quarantined(self):
        for content in ('{not json', json.dumps({'version': 2}), json.dumps(['not', 'a', 'marker'])):
            with self.subTest(content=content), tempfile.TemporaryDirectory() as root:
                live = Path(root, 'live')
                live.mkdir()
                (live / '.publication-transaction.json').write_text(content, encoding='utf-8')
                errors = io.StringIO()
                with mock.patch.object(publish, 'LIVE', str(live)), contextlib.redirect_stderr(errors):
                    self.assertIsNone(publish.recover_live_publication())
                rejected = self.quarantined(live)
                self.assertEqual([path.read_text(encoding='utf-8') for path in rejected], [content])
                self.assertFalse((live / '.publication-transaction.json').exists())
                self.assertIn('recovery marker rejected', errors.getvalue())

    def test_corrupt_premise_history_raises_with_recovery_advice_and_keeps_the_marker(self):
        case = candidate('mk-live-history')
        entry = {'id': case['id'], 'file': f"live/{case['id']}.json"}
        with tempfile.TemporaryDirectory() as root:
            live = Path(root, 'live')
            write_marker(live, case, entry)
            marker = json.loads((live / '.publication-transaction.json').read_text())
            marker['premise'] = {'victim': 'ada', 'culprit': 'hugo', 'method': 'blow', 'motive': 'money',
                                 'place': 'manor', 'shape': 'two_liars'}
            (live / '.publication-transaction.json').write_text(json.dumps(marker))
            history = Path(root, 'premise-history.json')
            history.write_text('{not json', encoding='utf-8')
            with mock.patch.object(publish, 'LIVE', str(live)), mock.patch.object(premise, 'HISTORY', str(history)):
                with self.assertRaisesRegex(ValueError, 'To recover'):
                    publish.recover_live_publication()
                self.assertTrue((live / '.publication-transaction.json').exists())
                history.unlink()                     # the advised recovery: move the corrupt history aside
                self.assertEqual(publish.recover_live_publication(), entry)
            self.assertEqual(self.quarantined(live), [])


class PublicationIO(unittest.TestCase):
    def run_with_timeout(self, target, seconds=10):
        failures = []

        def guarded():
            try:
                target()
            except BaseException as error:   # reported to the test thread below
                failures.append(error)

        thread = threading.Thread(target=guarded, daemon=True)
        thread.start()
        thread.join(seconds)
        self.assertFalse(thread.is_alive(), 'publication_lock deadlocked')
        if failures:
            raise failures[0]

    def test_nested_lock_in_one_thread_does_not_deadlock(self):
        with tempfile.TemporaryDirectory() as root:
            Path(root, 'live').mkdir()
            alias = os.path.join(root, 'live', '..')       # the same root, spelled differently

            def nested():
                with publish.pubio.publication_lock(root):
                    with publish.pubio.publication_lock(alias):
                        with publish.pubio.publication_lock(root):
                            pass
                    with publish.pubio.publication_lock(root):
                        pass
                with publish.pubio.publication_lock(root):    # released completely: can be taken again
                    pass

            self.run_with_timeout(nested)

    def test_lock_still_excludes_other_threads(self):
        with tempfile.TemporaryDirectory() as root:
            entered = threading.Event()

            def other():
                with publish.pubio.publication_lock(root):
                    entered.set()

            with publish.pubio.publication_lock(root):
                with publish.pubio.publication_lock(root):
                    thread = threading.Thread(target=other, daemon=True)
                    thread.start()
                    self.assertFalse(entered.wait(0.3), 'another thread entered a held lock')
            self.assertTrue(entered.wait(10))
            thread.join(10)

    @unittest.skipIf(publish.pubio.fcntl is None, 'POSIX file locks')
    def test_legacy_live_index_lock_is_held_too(self):
        fcntl = publish.pubio.fcntl
        with tempfile.TemporaryDirectory() as root:
            Path(root, 'live').mkdir()
            with publish.pubio.publication_lock(root):
                with open(os.path.join(root, 'live', '.index.lock'), 'w') as legacy:   # as an old generator does
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(legacy, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with open(os.path.join(root, 'live', '.index.lock'), 'w') as legacy:
                fcntl.flock(legacy, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(legacy, fcntl.LOCK_UN)

    def test_lock_sweeps_only_stale_temporaries(self):
        with tempfile.TemporaryDirectory() as root:
            Path(root, 'live').mkdir()
            old = [Path(root, '.publication-abc.json.tmp'), Path(root, 'live', 'index.json.tmp')]
            young = Path(root, 'live', '.publication-def.json.tmp')
            kept = Path(root, 'live', '.publication-transaction.json')
            for path in old + [young, kept]:
                path.write_text('{}', encoding='utf-8')
            two_hours_ago = time.time() - 7200
            for path in old + [kept]:
                os.utime(path, (two_hours_ago, two_hours_ago))
            with publish.pubio.publication_lock(root):
                pass
            self.assertEqual([path.exists() for path in old], [False, False])
            self.assertTrue(young.exists())
            self.assertTrue(kept.exists())

    @unittest.skipIf(os.name == 'nt', 'POSIX permission bits')
    def test_atomic_json_keeps_the_destination_mode_or_uses_0644(self):
        with tempfile.TemporaryDirectory() as root:
            fresh = Path(root, 'fresh.json')
            publish.pubio.atomic_json(str(fresh), {'a': 1})
            self.assertEqual(stat.S_IMODE(fresh.stat().st_mode), 0o644)
            private = Path(root, 'private.json')
            private.write_text('{}', encoding='utf-8')
            private.chmod(0o600)
            publish.pubio.atomic_json(str(private), {'a': 2})
            self.assertEqual(stat.S_IMODE(private.stat().st_mode), 0o600)
            self.assertEqual(json.loads(private.read_text()), {'a': 2})

    def test_atomic_json_refuses_nan_and_keeps_the_existing_file(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root, 'case.json')
            target.write_bytes(b'{"old":true}\n')
            with self.assertRaises(ValueError):
                publish.pubio.atomic_json(str(target), {'score': float('nan')})
            self.assertEqual(target.read_bytes(), b'{"old":true}\n')
            self.assertEqual(list(Path(root).glob('.publication-*')), [])


if __name__ == '__main__':
    unittest.main()
