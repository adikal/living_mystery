"""One-off repair of cases published before 'the history is the only source of facts' (October 2026).

New cases get all of this from generation. Older ones are brought up to the same rules here, once:
  1. the setting's roles and day go into the case;
  2. the body's discovery and the examination become typed events (an existing event is relabelled; if none exists,
     a minimal one is added for the examiner, fitted into their timeline); the examination notes and account cite it;
  3. evening summaries for people the history gives no events are dropped;
  4. any account still unbacked is backed by an event its speaker took part in or saw (never one involving the
     culprit) or a 'knows' attitude; a model proposes, code checks;
then each case must pass publish.gate (both kernels, Z3, and backing) or it is not written.

  .venv/bin/python tools/refine-c/repair_history.py [--dry-run]
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import enrich  # noqa: E402
import premise as P  # noqa: E402
import publish  # noqa: E402
import publication_io as pubio  # noqa: E402
from refine import travel_table, presence, unbacked_accounts, llm_json, CRITIC_MODEL  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SETTING = pubio.read_json(os.path.join(HERE, 'settings', 'bellweather.json'))


def part(e, p):
    return bool(e) and (e.get('agent') == p or p in (e.get('others') or []))


def fits(case, who, place, start, end, skip=None):
    tt = travel_table(case)
    for (s0, e0, pl, eid) in presence(case).get(who, []):
        if eid == skip:
            continue
        gap = 0 if pl == place else tt.get(pl, {}).get(place, 0)
        if not (end + gap <= s0 or e0 + gap <= start):
            return False
    return True


def type_morning(case):
    """Relabel the existing discovery and examination events by type (this is the one place words are read, once);
    add the examination for the examiner if the case has none."""
    victim, examiner = enrich.victim_of(case), enrich.role(case, 'examiner')
    death = next((e for e in case['events'] if e.get('type') == 'death'), None)
    after = death['start'] if death else case['question']['crime']['window'][0]
    changes = []
    # an examination the generator wrote wins over one an earlier backfill added
    gen_exam = [e for e in case['events'] if e.get('agent') == examiner and e['id'] != 'e_examination' and e['start'] >= after
                and re.search(r'\bexamin|post-?mortem', str(e.get('type', '')) + ' ' + str(e.get('summary', '')).lower())]
    if gen_exam and any(e['id'] == 'e_examination' for e in case['events']):
        case['events'] = [e for e in case['events'] if e['id'] != 'e_examination']
        case['attitudes'] = [a for a in case['attitudes'] if a['id'] != f'a_{examiner}_called']
        changes.append('removed the backfilled examination (the case has its own)')
    if not any(e.get('type') == 'discovery' for e in case['events']):
        e = next((e for e in sorted(case['events'], key=lambda e: e['start']) if e['start'] >= after and e.get('agent') != victim
                  and re.search(r'\b(finds?|found|discovers?)\b[^.]*\b(dead|body)\b', str(e.get('summary', '')).lower())), None)
        if e:
            e['type'] = 'discovery'; changes.append(f'discovery: {e["id"]}')
    disc = next((e for e in case['events'] if e.get('type') == 'discovery'), None)
    if not disc:
        constable, scene = enrich.role(case, 'constable'), case['question']['crime']['place']
        ex_first = min([e['start'] for e in case['events'] if e.get('agent') == examiner and e['start'] >= after
                        and re.search(r'\bexamin|post-?mortem', str(e.get('type', '')) + ' ' + str(e.get('summary', '')).lower())] or [enrich.day(case, 'start') - 60])
        for who in [constable] + [p['id'] for p in case['people'] if p['id'] not in (victim, examiner, constable, enrich.truth_actor(case))]:
            slot = next((t for t in range(ex_first - 20, after, -5) if t >= after and fits(case, who, scene, t, t + 5)), None)
            if slot is not None:
                att = f'a_{who}_finds'
                case['attitudes'].append({'id': att, 'agent': who, 'mode': 'intends', 'content': 'Raise the alarm on finding the body.'})
                vname = next((p['name'] for p in case['people'] if p['id'] == victim), 'the deceased')
                disc = {'id': 'e_discovery', 'type': 'discovery', 'agent': who, 'others': [], 'place': scene, 'start': slot, 'end': slot + 5,
                        'causedBy': att, 'summary': f'{next(p["name"] for p in case["people"] if p["id"] == who)} finds {vname} dead and sends for the doctor.'}
                case['events'].append(disc); changes.append(f'discovery added: {who} at {slot}')
                break
    exam = next((e for e in case['events'] if e.get('type') == 'examination' and e.get('agent') == examiner), None)
    if not exam and examiner and examiner != victim:
        exam = next((e for e in sorted(case['events'], key=lambda e: e['start']) if e.get('agent') == examiner and e['start'] >= after
                     and re.search(r'\bexamin|post-?mortem', str(e.get('type', '')) + ' ' + str(e.get('summary', '')).lower())), None)
        if exam:
            exam['type'] = 'examination'; changes.append(f'examination: {exam["id"]}')
        else:
            start = enrich.day(case, 'start')
            earliest = max(after + 30, (disc['end'] + 10) if disc else enrich.day(case, 'morning'))
            scene = case['question']['crime']['place']
            slot = next((t for t in range(earliest, start - 25, 5) if fits(case, examiner, scene, t, t + 25)), None)
            if slot is None:
                return changes + ['NO SLOT for the examination']
            att = f'a_{examiner}_duty'
            if not any(a['id'] == att for a in case['attitudes']):
                case['attitudes'].append({'id': att, 'agent': examiner, 'mode': 'intends', 'content': 'Examine the body when sent for.'})
            vname = next((p['name'] for p in case['people'] if p['id'] == victim), 'the deceased')
            exam = {'id': 'e_examination', 'type': 'examination', 'agent': examiner, 'others': [], 'place': scene,
                    'start': slot, 'end': slot + 25, 'causedBy': att, 'summary': f'The doctor is sent for and examines the body of {vname}.'}
            case['events'].append(exam); changes.append(f'examination added at {slot}')
    if exam:
        for x in case['signs']:
            if x.get('medical'):
                x['source'] = exam['id']
    return changes


BACK = """Some accounts in a finished 1920s village mystery are not yet backed by the true history. For each, choose ONE:
{"event": "<id>"}: an event the speaker took part in, or could plainly have witnessed by being in that place at that time,
which the account is about (never the crime, never an event the culprit takes part in); or
{"knew": "<one sentence, third person: what the speaker knew before the night and how they knew it>"}.
Return {"backing": {"<sign id>": {...}}}."""


def back_remaining(case):
    """A model proposes; code checks presence, travel and the culprit rule. Returns what it did."""
    ids = unbacked_accounts(case)
    if not ids:
        return []
    evs = {e['id']: e for e in case['events']}
    signs = {x['id']: x for x in case['signs']}
    culprit, crime = enrich.truth_actor(case), case['question']['crime']['event']
    item = {'history': [{'id': e['id'], 'at': e['place'], 'start': e['start'], 'who': [e.get('agent')] + list(e.get('others', [])),
                         'what': e.get('summary', '')} for e in sorted(case['events'], key=lambda e: e['start'])],
            'items': [{'id': i, 'speaker': signs[i]['speaker'], 'account': signs[i]['text']} for i in ids]}
    out = enrich._unwrap(llm_json(BACK, json.dumps(item), 3000, model=CRITIC_MODEL), 'backing')
    done = []
    for i in ids:
        x, b = signs[i], (out.get(i) if isinstance(out.get(i), dict) else {})
        sp, e = x['speaker'], evs.get(b.get('event'))
        if e and (e['id'] == crime or part(e, culprit) and not part(e, sp)):
            e = None
        if e and not part(e, sp):
            if fits(case, sp, e['place'], e['start'], e['end']):
                e.setdefault('others', []).append(sp)
            else:
                e = None
        if e:
            x['source'] = e['id']; done.append(f'{i}: event {e["id"]}'); continue
        knew = str(b.get('knew') or '').strip()
        if not knew:
            done.append(f'{i}: UNRESOLVED'); continue
        att = f'a_{sp}_knew_{i}'[:70]
        case['attitudes'].append({'id': att, 'agent': sp, 'mode': 'knows', 'content': knew[:300]})
        x['because'] = sorted(set((x.get('because') or []) + [att])); done.append(f'{i}: knew')
    return done


def repair(case):
    log = []
    case['setting']['roles'] = SETTING.get('roles', {})
    case['setting']['day'] = SETTING.get('day', {})
    log += type_morning(case)
    active = {q for e in case['events'] if e['start'] < enrich.day(case, 'morning') for q in [e.get('agent'), *e.get('others', [])] if q}
    dropped = [x['id'] for x in case['signs'] if x.get('surface') and x.get('speaker') not in active]
    case['signs'] = [x for x in case['signs'] if x['id'] not in dropped]
    if dropped:
        log.append(f'dropped evening summaries of nobody: {dropped}')
    log += back_remaining(case)
    if unbacked_accounts(case):          # one more round for anything the first proposal left unresolved
        log += back_remaining(case)
    return log


if __name__ == '__main__':
    dry = '--dry-run' in sys.argv
    files = sorted(glob.glob(f'{ROOT}/dist/cases/archive/mk-*.json') + glob.glob(f'{ROOT}/dist/cases/archive/live/mk-*.json'))
    for f in files:
        case = pubio.read_json(f)
        log = repair(case)
        publish.mark_duplicate_questions(case, judge=False)   # network-free alias repair: legacy cases meet the alias gate
        g = publish.deterministic_gate(case)  # explicit archived-repair bypass, never an ordinary publication path
        problems = P.morning_errors(case)
        ok = g['ok'] and not problems
        print(os.path.basename(f), 'OK' if ok else 'NOT WRITTEN', log, (g['errors'] + problems)[:2], flush=True)
        if ok and not dry:
            # Archived deterministic-only repair cannot claim an ordinary whole-case publication review.
            case.pop('publication_review', None)
            with pubio.publication_lock(pubio.PUBLICATION_ROOT):
                pubio.atomic_json(f, case)
