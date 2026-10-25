"""Every model call is timed by phase and purpose; a call slower than usual for its kind is hedged, first reply wins."""
import os
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import refine  # noqa: E402
import timing  # noqa: E402


class SlowThenFast:
    """The first call hangs; any later copy answers at once."""
    def __init__(self, first_delay=0.6):
        self.n, self.first_delay, self.lock = 0, first_delay, threading.Lock()

    def converse(self, **kw):
        with self.lock:
            self.n += 1; n = self.n
        time.sleep(self.first_delay if n == 1 else 0.01)
        return {'usage': {'inputTokens': 10, 'outputTokens': 5}, 'copy': n}


class Hedging(unittest.TestCase):
    def setUp(self):
        timing.reset()
        self.saved = refine._client

    def tearDown(self):
        refine._client = self.saved

    def test_a_slow_call_is_hedged_and_the_faster_copy_wins(self):
        refine._client = SlowThenFast()
        with mock.patch.object(timing, 'hedge_after', return_value=0.05), timing.phase('step 1'):
            r, info = refine._converse({}, 'm', 'refinement-candidate')
        self.assertEqual(info, {'hedged': True, 'hedge_won': True})
        self.assertEqual(r['copy'], 2)
        call = timing.CALLS[-1]
        self.assertTrue(call['hedged'] and call['hedge_won'])
        self.assertEqual((call['phase'], call['purpose']), ('step 1', 'refinement-candidate'))
        self.assertLess(call['seconds'], 0.5)

    def test_without_a_usual_time_nothing_is_hedged(self):
        refine._client = SlowThenFast(first_delay=0.05)
        with mock.patch.object(timing, 'hedge_after', return_value=None):
            r, info = refine._converse({}, 'm', 'seed-generation')
        self.assertEqual(info, {})
        self.assertEqual((r['copy'], refine._client.n), (1, 1))
        self.assertFalse(timing.CALLS[-1]['hedged'])

    def test_usual_time_comes_from_past_calls_of_the_same_kind(self):
        with mock.patch.dict(timing._HISTORY, {}, clear=True):
            self.assertIsNone(timing.hedge_after('m', 'p'))
            for s in [30, 32, 35, 40, 41, 44, 50, 52, 60, 100]:
                timing.record_call('m', 'p', s)
            self.assertEqual(timing.hedge_after('m', 'p'), 100 * 1.25)
            self.assertIsNone(timing.hedge_after('m', 'other'))

    def test_a_hedged_time_is_not_taken_as_usual_and_hedges_are_capped(self):
        with mock.patch.dict(timing._HISTORY, {}, clear=True):
            timing.record_call('m', 'p', 3.0, hedged=True)
            timing.record_call('m', 'p', 9.0)
            self.assertEqual(timing._HISTORY, {'m|p': [9.0]})
        refine._client = SlowThenFast(first_delay=0.3)
        with mock.patch.object(timing, 'hedge_after', return_value=0.05), mock.patch.object(refine, 'HEDGES', threading.BoundedSemaphore(1)) as cap:
            cap.acquire()                                # the one allowed hedge is in flight elsewhere
            r, info = refine._converse({}, 'm', 'p')
        self.assertEqual((r['copy'], info), (1, {}))     # waited for the first reply instead of adding load

    def test_the_table_shows_phases_and_calls_and_is_saved(self):
        with mock.patch.dict(timing._HISTORY, {}, clear=True), mock.patch.object(timing, 'HISTORY', os.devnull + '.x'):
            with timing.phase('publish'), timing.phase('add_reactions'):
                timing.record_call('us.anthropic.claude-sonnet-5', 'add_reactions', 12.0, {'inputTokens': 1000, 'outputTokens': 200})
            with tempfile.TemporaryDirectory() as d:
                timing.save(d)
                md = open(os.path.join(d, 'timings.md')).read()
        self.assertIn('| publish/add_reactions | add_reactions | sonnet-5 | 1 |', md)
        self.assertIn('| publish |', md)


if __name__ == '__main__':
    unittest.main()
