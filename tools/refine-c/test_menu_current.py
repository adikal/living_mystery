"""Every case on the menu has its wording checked under the current checks (November 8: two cases published on
October 3, before the leak checks, told what their speakers keep back). A check made stricter bumps its version; this
test then names the menu cases to bring up to date (repair_live.py)."""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import publish  # noqa: E402

GENERATED = os.path.join(HERE, '..', '..', 'dist', 'cases', 'generated')
# Menu cases kept as published while a replacement is made: changing a reviewed case's wording needs a new review.
PENDING = {}


def menu():
    return [(e['file'], json.load(open(os.path.join(GENERATED, e['file'])))) for e in json.load(open(os.path.join(GENERATED, 'index.json')))
            if e['file'] not in PENDING]


class MenuIsCurrent(unittest.TestCase):
    def test_first_accounts_are_checked_under_the_current_checks(self):
        for f, case in menu():
            with self.subTest(case=f):
                stale = [x['id'] for x in case['signs'] if x.get('surface') and x.get('agrees_checked') != publish.SURFACE_CHECK]
                stale += [x['id'] for x in case['signs'] if x.get('morning') and x.get('leak_checked') != publish.MORNING_CHECK]
                self.assertEqual(stale, [], 'repair_live.py brings these up to date')

    def test_written_reactions_are_checked_under_the_current_check(self):
        for f, case in menu():
            with self.subTest(case=f):
                self.assertEqual([x['id'] for x in case['signs'] if x.get('reactions') and x.get('reactions_checked') != publish.REACT_CHECK_VERSION], [])

    def test_no_account_is_unchecked_for_offers_the_case_never_keeps(self):
        for f, case in menu():
            with self.subTest(case=f):
                self.assertEqual([x['id'] for x in case['signs'] if x.get('kind') == 'testimony' and x.get('text')
                                  and x.get('promise_checked') != publish.PROMISE_CHECK], [])

    def test_the_detectives_lines_are_checked_under_the_current_check(self):
        for f, case in menu():
            with self.subTest(case=f):
                stale = [x['id'] for x in case['signs'] if (x.get('show') or x.get('confront') or x.get('direct'))
                         and x.get('lines_for') != publish.lines_key(x)]
                self.assertEqual(stale, [])


if __name__ == '__main__':
    unittest.main()
