"""The constable is the detective's ally, and every red herring has a reason its subject can give (roles.py): checked on
every generated step and at publication, so newly generated cases keep them."""
import copy
import glob
import json
import os
import unittest

import roles

HERE = os.path.dirname(os.path.abspath(__file__))
CASES = os.path.join(HERE, '..', '..', 'dist', 'cases')
MENU = sorted(glob.glob(os.path.join(CASES, 'generated', 'mk-*.json')))
SEALING_WAX = os.path.join(CASES, 'archive', '2026-10', 'mk-live-20261002-222517.json')   # the constable lies and keeps the evidence
ORCHIDS = os.path.join(CASES, 'archive', '2026-10', 'mk-live-20261003-085134.json')


def load(path):
    with open(path) as f:
        return json.load(f)


class Roles(unittest.TestCase):
    def test_every_case_on_the_menu_keeps_both_rules(self):
        self.assertEqual(len(MENU), 6)
        for path in MENU:
            case = load(path)
            self.assertEqual(roles.ally_errors(case), [], os.path.basename(path))
            self.assertEqual(roles.herring_errors(case), [], os.path.basename(path))

    def test_a_constable_who_lies_or_keeps_evidence_back_is_refused(self):
        errors = roles.ally_errors(load(SEALING_WAX))
        self.assertTrue(any('t_bell_first' in e and 'false account' in e for e in errors), errors)
        self.assertTrue(any('s_tip' in e and "constable's own doing" in e for e in errors), errors)
        self.assertTrue(any('t_bell_found' in e and 'holds back' in e for e in errors), errors)
        self.assertTrue(roles.ally_errors(load(ORCHIDS)))

    def test_a_constable_suspect_is_refused(self):
        case = copy.deepcopy(load(MENU[0]))
        case['question']['candidates'][0]['facts']['actor'] = roles.constable_of(case)
        self.assertTrue(any('candidate' in e for e in roles.ally_errors(case)))

    def test_a_red_herring_without_a_reason_is_refused(self):
        from refine import analyse
        for path in MENU:
            case = copy.deepcopy(load(path))
            A = analyse(case)
            herring = next((b for b in case['signs'] if b.get('kind') == 'behavior' and any(
                e in A['understood'] and A['eff'][e] > A['eff'].get(b['id'], 0) for e in b.get('explainedBy', []))), None)
            if not herring:
                continue
            mine = {a['id'] for a in case['attitudes'] if a['agent'] == herring['about']}
            # cut every link from the herring (and what explains it) to its subject's attitudes
            for x in case['signs']:
                if x['id'] == herring['id'] or x['id'] in herring['explainedBy']:
                    x.pop('because', None)
                    x.pop('source', None)
            for e in case['events']:
                if e.get('causedBy') in mine:
                    e['causedBy'] = 'nature'
            self.assertTrue(any(herring['id'] in e for e in roles.herring_errors(case)), path)
            return
        self.fail('no menu case has a red herring')


if __name__ == '__main__':
    unittest.main()
