"""The playtest harness's audit and provenance plumbing, offline (no model calls, no game, no network).

    .venv/bin/python -W ignore tools/playtest/test_harness.py
"""
import contextlib
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import comparison_audit  # noqa: E402
import judge  # noqa: E402
import llm  # noqa: E402
import player  # noqa: E402
import run  # noqa: E402

BILLED = {'usage': {'inputTokens': 11, 'outputTokens': 7},
          'ResponseMetadata': {'RequestId': 'req-1', 'HTTPStatusCode': 200, 'RetryAttempts': 0}}


class FakeClient:
    def __init__(self, *replies):
        self.replies = list(replies)

    def converse(self, **kwargs):
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def rows(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines()]


class CallJsonAudit(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        llm._AUDIT_FAILURES_REPORTED.clear()

    def call(self, *replies, audit_file=None):
        with mock.patch.object(llm, 'client', return_value=FakeClient(*replies)), mock.patch.object(llm.time, 'sleep'):
            return llm.call_json('System', 'the secret prompt', 'model-x', max_tokens=50, role='player',
                                 audit_file=audit_file)

    def test_an_unparseable_reply_keeps_its_request_id_and_usage(self):
        audit = self.tmp / 'direct.jsonl'
        reply = {**BILLED, 'output': {'message': {'content': [{'text': 'no object here'}]}}}
        with self.assertRaises(ValueError):
            self.call(reply, audit_file=audit)
        [row] = rows(audit)
        self.assertEqual((row['status'], row['bedrock_request_id'], row['http_status'], row['usage']),
                         ('failed', 'req-1', 200, BILLED['usage']))
        self.assertEqual(row['error'], {'type': 'ValueError', 'http_status': 200, 'stage': 'parse'})

    def test_failures_keep_the_class_and_status_not_the_message(self):
        class ThrottlingError(Exception):
            response = {'ResponseMetadata': {'RequestId': 'req-2', 'HTTPStatusCode': 429}, 'Error': {'Code': 'ThrottlingException'}}
        audit = self.tmp / 'direct.jsonl'
        out = self.call(ThrottlingError('ThrottlingException: the secret prompt was too long'),
                        {**BILLED, 'output': {'message': {'content': [{'toolUse': {'input': {'ok': True}}}]}}},
                        audit_file=audit)
        self.assertEqual(out, {'ok': True})
        retry, done = rows(audit)
        self.assertEqual((retry['status'], retry['provider_error_code'], retry['bedrock_request_id']),
                         ('transient_error_retry', 'ThrottlingException', 'req-2'))
        self.assertEqual(retry['error'], {'type': 'ThrottlingError', 'http_status': 429, 'stage': 'request'})
        self.assertEqual((done['status'], done['bedrock_request_id'], done['usage']), ('completed', 'req-1', BILLED['usage']))
        self.assertNotIn('secret prompt', audit.read_text())

    def test_an_audit_write_failure_masks_neither_result_nor_error(self):
        blocker = self.tmp / 'file'
        blocker.write_text('')
        stderr = io.StringIO()
        good = {**BILLED, 'output': {'message': {'content': [{'toolUse': {'input': {'ok': 1}}}]}}}
        bad = {**BILLED, 'output': {'message': {'content': [{'text': 'no object'}]}}}
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(self.call(good, audit_file=blocker / 'audit.jsonl'), {'ok': 1})
            with self.assertRaises(ValueError):
                self.call(bad, audit_file=blocker / 'audit.jsonl')
        self.assertEqual(stderr.getvalue().count('request audit'), 1)

    def test_the_audit_path_is_explicit_then_contextual_then_environment(self):
        reply = {**BILLED, 'output': {'message': {'content': [{'toolUse': {'input': {}}}]}}}
        explicit, scoped, env = self.tmp / 'explicit.jsonl', self.tmp / 'scoped.jsonl', self.tmp / 'env.jsonl'
        with mock.patch.dict(os.environ, {'PLAYTEST_AUDIT_FILE': str(env)}):
            self.call(reply)
            with llm.audit_to(scoped):
                self.call(reply)
                with llm.audit_to(None):
                    self.call(reply)
                self.call(reply, audit_file=explicit)
        self.assertEqual([len(rows(p)) for p in (env, scoped, explicit)], [1, 2, 1])


class JudgeAudit(unittest.TestCase):
    def test_judge_batch_passes_its_audit_file_without_touching_the_environment(self):
        scores = {'scores': {d: {'score': 4, 'reason': 'r'} for d in judge.DIMENSIONS}, 'problems': [], 'summary': 's'}
        ep = {'id': 'c__amateur__literal__s1', 'case': 'dist/x.json', 'profile': 'amateur', 'temperament': 'literal',
              'seed': 1, 'outcome': 'solved', 'diary': [], 'questionnaire': {}, 'steps': [], 'failure': None}
        with tempfile.TemporaryDirectory() as folder, \
                mock.patch.dict(os.environ, {}, clear=False), \
                mock.patch.object(judge, 'solution', return_value={}), \
                mock.patch.object(judge, 'call_json', return_value=scores) as call:
            os.environ.pop('PLAYTEST_AUDIT_FILE', None)
            json.dump([{'id': ep['id'], 'metrics': {}}], open(os.path.join(folder, 'scores.json'), 'w'))
            json.dump(ep, open(os.path.join(folder, ep['id'] + '.json'), 'w'))
            [verdict] = judge.judge_batch(folder, parallel=2)
            self.assertNotIn('PLAYTEST_AUDIT_FILE', os.environ)
            self.assertEqual(call.call_args.kwargs['audit_file'], os.path.join(folder, judge.AUDIT_NAME))
            self.assertEqual((call.call_args.kwargs['max_tokens'], call.call_args.kwargs['temperature']),
                             (judge.MAX_TOKENS, judge.TEMPERATURE))
        self.assertEqual(verdict['scores']['fun']['score'], 4.0)


class Provenance(unittest.TestCase):
    def test_summary_counts_episodes_without_an_outcome(self):
        records = [{'id': 'a', 'outcome': None, 'failure': None}, {'id': 'b', 'outcome': 'solved', 'failure': None},
                   {'id': 'c', 'outcome': 'quit', 'failure': None}, {'id': 'd', 'outcome': 'failed', 'failure': 'Trace'}]
        summary = run.summarise(records)
        self.assertEqual(list(summary['outcomes']), ['failed', 'quit', 'solved', 'null'])
        self.assertEqual((summary['right_censored'], summary['failures']), (1, [{'id': 'd', 'failure': 'Trace'}]))
        json.dumps(summary, sort_keys=True)

    def test_inference_settings_come_from_the_callers(self):
        with mock.patch.object(run, 'proxy_configuration', return_value={'routes': {}}):
            config = run.model_configuration([('dist/x.json', 'amateur', 'literal', 1)])
        self.assertEqual(config['direct_inference'], {
            'player': {'maxTokens': player.PLAYER_MAX_TOKENS, 'temperature': player.PLAYER_TEMPERATURE},
            'questionnaire': {'maxTokens': player.QUESTIONNAIRE_MAX_TOKENS, 'temperature': player.QUESTIONNAIRE_TEMPERATURE},
            'judge': {'maxTokens': judge.MAX_TOKENS, 'temperature': 'omitted/provider-default'}})

    def test_the_proxy_endpoint_is_configurable_and_loopback(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(run.proxy_url(), 'http://127.0.0.1:8787/')
        with mock.patch.dict(os.environ, {'LM_PROXY_URL': 'http://LOCALHOST:8797'}):
            self.assertEqual(run.proxy_url(), 'http://localhost:8797/')
        self.assertEqual(run.proxy_url('http://[::1]:9/'), 'http://[::1]:9/')
        for bad in ('https://127.0.0.1:8787/', 'http://proxy.example:8787/', 'http://127.0.0.1:8787/api',
                    'http://u@127.0.0.1:8787/', 'http://127.0.0.1:8787/?q', 'http://127.0.0.1:99999/', '127.0.0.1:8787'):
            with self.subTest(url=bad), self.assertRaises(ValueError):
                run.proxy_url(bad)
        with mock.patch.object(run.urllib.request, 'urlopen', side_effect=OSError('refused')) as urlopen:
            config = run.proxy_configuration('http://127.0.0.1:8797/')
        self.assertEqual(urlopen.call_args.args[0], 'http://127.0.0.1:8797/health')
        self.assertEqual((config['endpoint'], config['available']), ('http://127.0.0.1:8797/health', False))


class ComparisonAuditArtifact(unittest.TestCase):
    """The comparison preflight reads the proxy audit from run.py's external-artifact record."""

    def setUp(self):
        spec = importlib.util.spec_from_file_location(
            'comparison_audit_fixtures', Path(run.ROOT) / 'tests' / 'test_playtest_comparison_audit.py')
        self.fixtures = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.fixtures)
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.a, self.b, self.reg = self.fixtures.write_fixture(self.tmp)

    def declare(self, folder, path):
        provenance = json.loads((folder / 'provenance.json').read_text())
        provenance['proxy_request_audit'] = {'path': str(path), 'producer': run.PROXY_AUDIT_PRODUCER, 'present': True}
        (folder / 'provenance.json').write_text(json.dumps(provenance))

    def codes(self):
        return {reason.code for reason in comparison_audit.audit_comparison(self.a, self.b, self.reg).reasons}

    def test_an_artifact_record_inside_the_arm_passes(self):
        for folder in (self.a, self.b):
            self.declare(folder, folder / run.PROXY_AUDIT_NAME)
        self.assertEqual(self.codes(), set())

    def test_an_artifact_outside_the_arm_or_missing_fails(self):
        self.declare(self.a, self.tmp / run.PROXY_AUDIT_NAME)
        self.assertIn('request_audit_path_invalid', self.codes())
        self.declare(self.a, self.a / run.PROXY_AUDIT_NAME)
        (self.a / run.PROXY_AUDIT_NAME).unlink()
        self.assertIn('request_audit_invalid', self.codes())


class Arm(unittest.TestCase):
    """main() end to end with the game, git and the proxy replaced."""

    def setUp(self):
        self.runs = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.runs)
        fingerprint = {'revision': 'r', 'branch': 'b', 'dirty': False, 'worktree_sha256': 'w'}
        self.patches = [mock.patch.object(run, 'RUNS', str(self.runs)),
                        mock.patch.object(run, 'repository_fingerprint', return_value=fingerprint),
                        mock.patch.object(run, 'model_configuration', return_value={'proxy': {}}),
                        mock.patch.object(run, 'case_records', return_value=[]),
                        mock.patch.dict(os.environ, {'LM_PROXY_URL': 'http://127.0.0.1:8797/'})]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def main(self, play):
        argv = ['run.py', '--batch', 'arm', '--cases', 'dist/x.json', '--profiles', 'amateur', '--parallel', '1']
        with mock.patch.object(run, 'play', side_effect=play) as played, mock.patch.object(sys, 'argv', argv), \
                contextlib.redirect_stdout(io.StringIO()):
            try:
                run.main()
            finally:
                self.provenance = json.loads((self.runs / 'arm' / 'provenance.json').read_text())
        return played

    @staticmethod
    def episode(case, profile, temperament, seed, budget, **kwargs):
        return {'id': run.episode_id(case, profile, temperament, seed), 'outcome': None, 'steps': [], 'seconds': 0,
                'failure': None}

    def test_a_completed_arm_records_the_proxy_audit_as_an_external_artifact(self):
        played = self.main(self.episode)
        kwargs = played.call_args.kwargs
        self.assertEqual((kwargs['audit_file'], kwargs['endpoint']),
                         (self.runs / 'arm' / 'direct_requests.jsonl', 'http://127.0.0.1:8797/'))
        self.assertEqual(self.provenance['status'], 'completed')
        self.assertEqual(self.provenance['outcomes'], {'null': 1})
        self.assertEqual(self.provenance['proxy_request_audit'], {
            'path': str(self.runs / 'arm' / 'proxy_requests.jsonl'),
            'producer': 'proxy LM_AUDIT_FILE (operator-configured)', 'present': False})

    def test_the_proxy_audit_presence_is_checked_when_the_arm_finishes(self):
        def play(*args, **kwargs):
            (self.runs / 'arm' / 'proxy_requests.jsonl').write_text('{}\n')
            return self.episode(*args, **kwargs)
        self.main(play)
        self.assertTrue(self.provenance['proxy_request_audit']['present'])

    def test_a_failing_summary_still_ends_the_arm(self):
        with mock.patch.object(run, 'summarise', side_effect=RuntimeError('boom')), self.assertRaises(RuntimeError):
            self.main(self.episode)
        self.assertEqual((self.provenance['status'], self.provenance['failure_stage']), ('failed', 'summary'))
        self.assertIn('finished_at', self.provenance)

    def test_a_failing_episode_aborts_the_arm(self):
        with self.assertRaises(KeyError):
            self.main(mock.Mock(side_effect=KeyError('x')))
        self.assertEqual(self.provenance['status'], 'aborted')


if __name__ == '__main__':
    unittest.main()
