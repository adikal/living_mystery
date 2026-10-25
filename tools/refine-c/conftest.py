"""Tests never touch the real latency history (it sets when slow calls are hedged): each session gets a scratch one."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_SCRATCH = tempfile.mkdtemp(prefix='lm-latency-')
os.environ['LM_LATENCY_HISTORY'] = os.path.join(_SCRATCH, 'latency-history.json')

import timing  # noqa: E402

timing.HISTORY = os.environ['LM_LATENCY_HISTORY']
timing._HISTORY.clear()
