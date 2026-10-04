"""Structured model calls for the playtest loop (Amazon Bedrock Converse, a forced 'submit' tool for JSON).

One small client, shared by the player, the judge and the questionnaire. Usage is counted per process, so a batch can
report its cost.
"""
import json
import threading
import time

import boto3
from botocore.config import Config

PLAYER_MODEL = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'   # plays (a different model from the judge)
JUDGE_MODEL = 'us.anthropic.claude-sonnet-5'                     # scores trajectories
TRANSIENT = ('ThrottlingException', 'ServiceUnavailableException', 'InternalServerException', 'ModelNotReadyException')

_client, _lock = None, threading.Lock()
USAGE = {'calls': 0, 'in': 0, 'out': 0}


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
        try:   # raw_decode tolerates text after the object (models sometimes add a stray brace or a remark)
            return decoded(json.JSONDecoder().raw_decode(value.strip())[0])
        except ValueError:
            return value
    if isinstance(value, dict):
        return {k: decoded(v) for k, v in value.items()}
    if isinstance(value, list):
        return [decoded(v) for v in value]
    return value


def unwrapped(value):
    """Some models wrap the object in one extra key ({"answer": {...}}); return the object itself."""
    while isinstance(value, dict) and len(value) == 1 and isinstance(next(iter(value.values())), dict) \
            and next(iter(value)) in ('answer', 'result', 'response', 'output', 'submission', 'input'):
        value = next(iter(value.values()))
    return value


def call_json(system, user, model, max_tokens=1500, temperature=None, schema=None, attempts=4):
    """The model answers by calling 'submit' with a JSON object; returns that object. Retries transient errors."""
    tool = {'toolSpec': {'name': 'submit', 'description': 'Submit the answer.',
                         'inputSchema': {'json': schema or {'type': 'object', 'additionalProperties': True}}}}
    cfg = {'maxTokens': max_tokens, **({'temperature': temperature} if temperature is not None else {})}
    for i in range(attempts):
        try:
            r = client().converse(modelId=model, system=[{'text': system}], messages=[{'role': 'user', 'content': [{'text': user}]}],
                                  inferenceConfig=cfg, toolConfig={'tools': [tool], 'toolChoice': {'tool': {'name': 'submit'}}})
            with _lock:
                USAGE['calls'] += 1; USAGE['in'] += r['usage']['inputTokens']; USAGE['out'] += r['usage']['outputTokens']
            for block in r['output']['message']['content']:
                if 'toolUse' in block:
                    return unwrapped(decoded(block['toolUse']['input']))
            text = ''.join(b.get('text', '') for b in r['output']['message']['content'])
            return json.loads(text[text.index('{'):text.rindex('}') + 1])
        except Exception as e:  # transient service errors are retried with backoff; anything else is raised
            if i == attempts - 1 or not any(t in str(e) for t in TRANSIENT):
                raise
            time.sleep(4 * (i + 1))
