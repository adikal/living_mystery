"""Structured model calls for the playtest loop (Amazon Bedrock Converse, a forced 'submit' tool for JSON).

One small client, shared by the player, the judge and the questionnaire. Usage is counted per process, so a batch can
report its cost.

The optional request audit is a JSON-lines ledger of request metadata and hashes, never prompt or response text; a
failure records the exception class and HTTP status, not its message. Its path is, in order: the ``audit_file``
argument of ``call_json``, the innermost ``audit_to(path)`` block, or the PLAYTEST_AUDIT_FILE environment variable. A
failure to write it is reported on stderr and never replaces the call's own result or error.
"""
from __future__ import annotations

import contextlib
import contextvars
import datetime as dt
import hashlib
import json
import os
import sys
import threading
import time

import boto3
from botocore.config import Config

PLAYER_MODEL = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
JUDGE_MODEL = 'us.anthropic.claude-sonnet-5'
TRANSIENT = ('ThrottlingException', 'ServiceUnavailableException', 'InternalServerException', 'ModelNotReadyException')

_client, _lock = None, threading.Lock()
_CONTEXT = contextvars.ContextVar('playtest_request_context', default={})
_AUDIT_FILE = contextvars.ContextVar('playtest_audit_file', default=None)
_AUDIT_FAILURES_REPORTED = set()
USAGE = {'calls': 0, 'in': 0, 'out': 0, 'by_role': {}}


def _utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def _sha256(value):
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(value.encode()).hexdigest()


@contextlib.contextmanager
def request_context(**values):
    token = _CONTEXT.set({**_CONTEXT.get(), **values})
    try:
        yield
    finally:
        _CONTEXT.reset(token)


@contextlib.contextmanager
def audit_to(path):
    """Audit the calls made in this block (in this thread or task) to ``path``; None leaves the outer choice."""
    token = _AUDIT_FILE.set(os.fspath(path) if path is not None else _AUDIT_FILE.get())
    try:
        yield
    finally:
        _AUDIT_FILE.reset(token)


def _audit(record, path=None):
    path = path or _AUDIT_FILE.get() or os.environ.get('PLAYTEST_AUDIT_FILE')
    if not path:
        return
    line = json.dumps(record, ensure_ascii=False, sort_keys=True) + '\n'
    with _lock:
        try:
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
            with open(path, 'a', encoding='utf-8') as handle:
                handle.write(line)
        except OSError as exc:
            if path not in _AUDIT_FAILURES_REPORTED:
                _AUDIT_FAILURES_REPORTED.add(path)
                print(f'playtest llm: cannot write the request audit ({type(exc).__name__}); its records are being dropped',
                      file=sys.stderr, flush=True)


def _provider_metadata(response):
    """Request id, status and SDK retries from a Converse response or a botocore error response."""
    metadata = (response or {}).get('ResponseMetadata') or {}
    return {'bedrock_request_id': metadata.get('RequestId'), 'http_status': metadata.get('HTTPStatusCode'),
            'sdk_retry_attempts': metadata.get('RetryAttempts')}


def client():
    global _client
    with _lock:
        if _client is None:
            _client = boto3.client('bedrock-runtime', region_name='us-west-2',
                                   config=Config(read_timeout=180, retries={'max_attempts': 2}, max_pool_connections=64))
    return _client


def decoded(value):
    """Models sometimes put a JSON object or list inside a string field; decode such fields, recursively."""
    if isinstance(value, str) and value.strip()[:1] in ('{', '['):
        try:
            return decoded(json.JSONDecoder().raw_decode(value.strip())[0])
        except ValueError:
            return value
    if isinstance(value, dict):
        return {k: decoded(v) for k, v in value.items()}
    if isinstance(value, list):
        return [decoded(v) for v in value]
    return value


def unwrapped(value):
    """Some models wrap the object in one extra key; return the object itself."""
    while isinstance(value, dict) and len(value) == 1 and isinstance(next(iter(value.values())), dict) \
            and next(iter(value)) in ('answer', 'result', 'response', 'output', 'submission', 'input'):
        value = next(iter(value.values()))
    return value


def call_json(system, user, model, max_tokens=1500, temperature=None, schema=None, attempts=4, role='unspecified',
              audit_file=None):
    """The model answers by calling ``submit`` with a JSON object; transient service errors are retried. Each attempt
    is audited to ``audit_file`` (see the module docstring for the default)."""
    schema = schema or {'type': 'object', 'additionalProperties': True}
    tool = {'toolSpec': {'name': 'submit', 'description': 'Submit the answer.', 'inputSchema': {'json': schema}}}
    cfg = {'maxTokens': max_tokens, **({'temperature': temperature} if temperature is not None else {})}
    base = {
        'role': role, 'context': dict(_CONTEXT.get()), 'requested_model': model,
        'effective_serving_model': 'unknown', 'region': 'us-west-2',
        'prompt_hashes': {'system_sha256': _sha256(system), 'user_sha256': _sha256(user),
                          'combined_sha256': _sha256(system + '\0' + user)},
        'schema_sha256': _sha256(schema),
        'inference_config': {**cfg, 'temperature_state': 'explicit' if temperature is not None else 'omitted/provider-default'},
    }
    for i in range(attempts):
        started, r, usage = _utc_now(), None, None
        try:
            r = client().converse(modelId=model, system=[{'text': system}], messages=[{'role': 'user', 'content': [{'text': user}]}],
                                  inferenceConfig=cfg, toolConfig={'tools': [tool], 'toolChoice': {'tool': {'name': 'submit'}}})
            usage = r.get('usage') or {}      # the call is billed from here on, whether or not its reply parses
            with _lock:
                USAGE['calls'] += 1
                USAGE['in'] += usage.get('inputTokens', 0)
                USAGE['out'] += usage.get('outputTokens', 0)
                by_role = USAGE['by_role'].setdefault(role, {'calls': 0, 'in': 0, 'out': 0})
                by_role['calls'] += 1
                by_role['in'] += usage.get('inputTokens', 0)
                by_role['out'] += usage.get('outputTokens', 0)
            content = r['output']['message']['content']
            for block in content:
                if 'toolUse' in block:
                    out = unwrapped(decoded(block['toolUse']['input']))
                    break
            else:
                text = ''.join(b.get('text', '') for b in content)
                out = json.loads(text[text.index('{'):text.rindex('}') + 1])
        except Exception as exc:
            billed = r is not None             # a reply came back and was billed, but could not be read
            response = r if billed else getattr(exc, 'response', None)
            response = response if isinstance(response, dict) else {}
            retry = not billed and i < attempts - 1 and any(t in str(exc) for t in TRANSIENT)
            _audit({**base, 'attempt': i + 1, 'started_at': started, 'finished_at': _utc_now(),
                    'status': 'transient_error_retry' if retry else 'failed', **_provider_metadata(response),
                    'provider_error_code': (response.get('Error') or {}).get('Code'),
                    'error': {'type': type(exc).__name__, 'http_status': _provider_metadata(response)['http_status'],
                              'stage': 'parse' if billed else 'request'},
                    'usage': usage}, audit_file)
            if not retry:
                raise
            time.sleep(4 * (i + 1))
            continue
        _audit({**base, 'attempt': i + 1, 'started_at': started, 'finished_at': _utc_now(), 'status': 'completed',
                **_provider_metadata(r), 'usage': usage, 'response_sha256': _sha256(out)}, audit_file)
        return out
