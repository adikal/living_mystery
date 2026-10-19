"""Publish generated Bellweather cases for the game: for each brief, take the deepest case that the JS kernel
certifies (across every run), give it a stable id and title, and write dist/cases/generated/{id}.json + index.json."""
import copy, datetime, glob, json, os, re, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import enrich
import difficulty  # noqa: E402
import provenance  # noqa: E402
import publication_io as pubio  # noqa: E402
import threading
SIGNS = threading.Lock()   # individual maintenance helpers can also be called directly
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = f'{ROOT}/dist/cases/generated'
PUBLICATION_REVIEW_VERSION = 'whole-case-publication-review-v2'
PUBLICATION_REVIEW_SCHEMA_VERSION = 'whole-case-publication-review-schema-v1'
PUBLICATION_CERTIFICATE_VERSION = 'publication-review-certificate-v2'
PUBLICATION_REVIEW_PROMPT = """You are the final independent publication reviewer for a complete 1932 English village mystery.
The deterministic logic, timing, reachability and uniqueness checks are separate and their outcome is hidden from you.
Integer times are minutes after midnight, not HHMM: 1320 means 22:00. Values above 1440 are on the next day;
for example, 1770 means 05:30 the next day. Convert every integer time this way before comparing chronology or prose.
Judge the WHOLE case only for common-sense plausibility, fairness and craft. Fail if any material problem remains:
- LOCK: obtaining a prerequisite would not naturally lead the detective to the gated clue.
- READING: a prerequisite does not actually make sense of the clue.
- CHARACTER: a person acts or speaks against their established attitudes, knowledge, events or voice.
- LOOSE END: a player-facing person or suspicion is materially implicated without a fair explanation or resolution. Hidden
  private motives, fears, attitudes and events are author-side context, not automatically player-facing loose ends.
- GIVEAWAY: wording names the culprit or announces what evidence proves.
- CONTRADICTION: player-facing prose or story facts conflict. Intentional false testimony and cover stories are allowed:
  do not compare them directly to private true events as if they should be honest. Instead check that each declared lie is
  faithful to its structured false claim or stated cover story and that its declared, reachable defeater can expose it.
- FAIRNESS: a necessary inference depends on information the player cannot learn, or prose materially overstates records.
- CRAFT: a material whole-case coherence defect would make the mystery confusing or implausible. Minor, borderline,
  optional-subplot, stylistic or taste concerns must pass and must not appear as fail issues.
Every fail issue must name the relevant record id (or GLOBAL), one check label, and a specific actionable problem.
Reply with exactly one JSON object: {"verdict":"pass"|"fail","issues":["<id>: <CHECK>: <problem>", ...]}"""
PUBLICATION_REVIEW_SCHEMA = {
    'type': 'object',
    'properties': {
        'verdict': {'type': 'string', 'enum': ['pass', 'fail']},
        'issues': {'type': 'array', 'items': {'type': 'string'}},
    },
    'required': ['verdict', 'issues'],
}
PUBLICATION_REVIEW_CHECKS = ('LOCK', 'READING', 'CHARACTER', 'LOOSE END', 'GIVEAWAY', 'CONTRADICTION', 'FAIRNESS', 'CRAFT')
# Blinding removes labels that reveal a requested experimental level. They remain in the candidate hash when present.
PUBLICATION_REVIEW_BLIND_FIELDS = ('id', 'difficulty', 'difficulty_target', 'publication_review')
# Blurbs state only the certified public premise (who is dead, where they were found). Anything more
# (a quarrel, a suspicion) would be an uncertified fact the characters could never confirm.
CASE_TITLES = {
    'bw-ledger': ('The Study Door', 'Edmund Vale is found dead in his study at Vale Manor.'),
    'bw-poison': ('A Supper at Vale Manor', 'Edmund Vale died in the night, after supper at Vale Manor.'),
    'bw-pair': ('The Greenhouse Steps', 'Edmund Vale was found at the foot of the greenhouse steps.'),
    'bw-vestry': ('The Vestry Will', 'Edmund Vale was found dead in St. Alden\u2019s vestry.'),
    'bw-inn': ('The Back Parlour', 'Edmund Vale collapsed and died in the back parlour of the Rook & Lantern.'),
    'bw-letter': ('The Half-Burned Letter', 'Edmund Vale was found dead in his study at Vale Manor.'),
}


sys.path.insert(0, os.path.join(ROOT, 'server'))


def publication_candidate(case):
    """The exact enriched candidate reviewed by the model, without metadata added after that boundary."""
    candidate = copy.deepcopy(case)
    candidate.pop('publication_review', None)
    candidate.pop('difficulty', None)
    return candidate


def publication_candidate_sha256(case):
    return provenance.sha256(publication_candidate(case))


def _publication_prompt_case(case):
    """Hide requested-level labels and prior certificates from the reviewer, without changing the bound candidate."""
    candidate = publication_candidate(case)
    for key in PUBLICATION_REVIEW_BLIND_FIELDS:
        candidate.pop(key, None)
    return candidate


def _publication_review_shape(raw):
    """Return a typed terminal verdict, or None for a reasonless fail eligible for one semantic retry."""
    from refine import CriticStatus
    if not isinstance(raw, dict):
        return CriticStatus.UNAVAILABLE, ()
    verdict, supplied = raw.get('verdict'), raw.get('issues')
    if verdict not in ('pass', 'fail') or not isinstance(supplied, list) or any(not isinstance(i, str) for i in supplied):
        return CriticStatus.UNAVAILABLE, ()
    if verdict == 'pass':
        return (CriticStatus.PASS, ()) if not supplied else (CriticStatus.UNAVAILABLE, ())
    pattern = re.compile(r'^\S[^:]*:\s*(?:' + '|'.join(re.escape(check) for check in PUBLICATION_REVIEW_CHECKS) + r'):\s*\S', re.I)
    issues = tuple(issue.strip() for issue in supplied if issue.strip() and pattern.match(issue.strip()))[:12]
    return (CriticStatus.FAIL, issues) if issues else None


def publication_critic(case):
    """One typed whole-case review operation; only a reasonless fail receives the normal single semantic retry."""
    import refine
    prompt = json.dumps(_publication_prompt_case(case), ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    attempts = []
    for semantic_attempt in range(2):
        try:
            response = refine.llm_json_audited(
                PUBLICATION_REVIEW_PROMPT,
                prompt,
                4000,
                model=refine.CRITIC_MODEL,
                schema=PUBLICATION_REVIEW_SCHEMA,
                audit_metadata={'purpose': 'final-whole-case-publication-critic',
                                'semantic_retry': semantic_attempt,
                                'prompt_version': PUBLICATION_REVIEW_VERSION,
                                'schema_version': PUBLICATION_REVIEW_SCHEMA_VERSION},
            )
        except Exception as error:
            message = f'{type(error).__name__}: {error}'
            raw = getattr(error, 'raw_response', {'error': message})
            attempt = refine.CriticAttempt(raw, refine._exception_request_ids(error), message)
            attempts.append(attempt)
            audit = provenance.current_audit()
            if audit and getattr(error, 'logical_request_id', None):
                audit.annotate(error.logical_request_id, typed_critic_outcome='UNAVAILABLE')
            request_ids = tuple(rid for item in attempts for rid in item.request_ids)
            return refine.CriticOutcome(refine.CriticStatus.UNAVAILABLE, (), raw, tuple(attempts), request_ids,
                                        getattr(error, 'inference_profile', refine.CRITIC_MODEL))
        attempt = refine.CriticAttempt(response.payload, response.request_ids)
        attempts.append(attempt)
        shaped = _publication_review_shape(response.payload)
        audit = provenance.current_audit()
        if shaped is None:
            if audit and response.logical_request_id:
                audit.annotate(response.logical_request_id, typed_critic_outcome='UNAVAILABLE_REASONLESS_RETRY')
            continue
        status, issues = shaped
        if audit and response.logical_request_id:
            audit.annotate(response.logical_request_id, typed_critic_outcome=status.value, critic_issues=list(issues))
        request_ids = tuple(rid for item in attempts for rid in item.request_ids)
        return refine.CriticOutcome(status, issues, response.payload, tuple(attempts), request_ids,
                                    response.inference_profile)
    if audit and response.logical_request_id:
        audit.annotate(response.logical_request_id, typed_critic_outcome='UNAVAILABLE')
    request_ids = tuple(rid for item in attempts for rid in item.request_ids)
    return refine.CriticOutcome(refine.CriticStatus.UNAVAILABLE, (), attempts[-1].raw_response, tuple(attempts),
                                request_ids, response.inference_profile)


def _certificate(outcome, candidate_hash, timestamp=None):
    """Build a public, hash-bound typed certificate without private critic issue text."""
    issue_digest = provenance.sha256(list(outcome.issues))
    certificate = {
        'version': PUBLICATION_CERTIFICATE_VERSION,
        'candidate_sha256': candidate_hash,
        'critic_status': outcome.status.value,
        'critic_issue_count': len(outcome.issues),
        'critic_issues_sha256': issue_digest,
        'prompt': {'version': PUBLICATION_REVIEW_VERSION, 'sha256': provenance.sha256(PUBLICATION_REVIEW_PROMPT)},
        'schema': {'version': PUBLICATION_REVIEW_SCHEMA_VERSION, 'sha256': provenance.sha256(PUBLICATION_REVIEW_SCHEMA)},
        'requested_inference_profile': outcome.inference_profile,
        'request_ids': list(outcome.request_ids),
        'timestamp': timestamp or provenance.utc_now(),
    }
    certificate['digest'] = provenance.sha256(certificate)
    return certificate


def review_for_publication(case, reviewer=None, timestamp=None, return_outcome=False):
    """Attach a safe hash-bound certificate; keep detailed findings in the ignored private audit."""
    candidate_hash = publication_candidate_sha256(case)
    if reviewer is not None:
        outcome = reviewer(case)
    elif provenance.current_audit() is not None:
        outcome = publication_critic(case)
    else:
        run_id = f'publication-{candidate_hash[:16]}-{os.getpid()}-{provenance.utc_now().replace(":", "").replace(".", "")}'
        audit = provenance.RunAudit(
            os.path.join(HERE, 'runs', 'publication-reviews', run_id), run_id, 'ordinary-publication',
            {'candidate_sha256': candidate_hash,
             'prompt_version': PUBLICATION_REVIEW_VERSION,
             'prompt_sha256': provenance.sha256(PUBLICATION_REVIEW_PROMPT),
             'schema_version': PUBLICATION_REVIEW_SCHEMA_VERSION,
             'schema_sha256': provenance.sha256(PUBLICATION_REVIEW_SCHEMA)},
        )
        with provenance.activate(audit, parent_operation='ordinary-publication', phase='final-whole-case-review'):
            outcome = publication_critic(case)
        audit.finish(outcome.status.value, '; '.join(outcome.issues) or None,
                     candidate_sha256=candidate_hash, request_ids=list(outcome.request_ids))
    certificate = _certificate(outcome, candidate_hash, timestamp)
    case['publication_review'] = certificate
    return (certificate, outcome) if return_outcome else certificate


def publication_certificate_errors(case):
    """Validate a certificate and its exact enriched-candidate binding without exposing private findings."""
    from refine import CriticStatus
    certificate = case.get('publication_review')
    if not isinstance(certificate, dict):
        return ['publication review certificate is missing']
    errors = []
    digest = certificate.get('digest')
    unsigned = {key: value for key, value in certificate.items() if key != 'digest'}
    if not isinstance(digest, str) or digest != provenance.sha256(unsigned):
        errors.append('publication review certificate digest mismatch')
    if certificate.get('version') != PUBLICATION_CERTIFICATE_VERSION:
        errors.append('publication review certificate version mismatch')
    if certificate.get('candidate_sha256') != publication_candidate_sha256(case):
        errors.append('publication review certificate candidate hash is stale')
    status = certificate.get('critic_status')
    valid_statuses = {item.value for item in CriticStatus}
    if status not in valid_statuses:
        errors.append('publication critic status is invalid or missing')
    issue_count = certificate.get('critic_issue_count')
    if isinstance(issue_count, bool) or not isinstance(issue_count, int) or issue_count < 0:
        errors.append('publication review issue count is invalid or missing')
    issue_digest = certificate.get('critic_issues_sha256')
    if not isinstance(issue_digest, str) or not re.fullmatch(r'[0-9a-f]{64}', issue_digest):
        errors.append('publication review issue digest is invalid or missing')
    if status == CriticStatus.PASS.value and (issue_count != 0 or issue_digest != provenance.sha256([])):
        errors.append('publication PASS certificate must bind an empty critic issue list')
    if status == CriticStatus.FAIL.value and issue_count == 0:
        errors.append('publication FAIL certificate must bind at least one critic issue')
    expected_prompt = {'version': PUBLICATION_REVIEW_VERSION, 'sha256': provenance.sha256(PUBLICATION_REVIEW_PROMPT)}
    expected_schema = {'version': PUBLICATION_REVIEW_SCHEMA_VERSION, 'sha256': provenance.sha256(PUBLICATION_REVIEW_SCHEMA)}
    if certificate.get('prompt') != expected_prompt:
        errors.append('publication review prompt hash or version mismatch')
    if certificate.get('schema') != expected_schema:
        errors.append('publication review schema hash or version mismatch')
    if not isinstance(certificate.get('requested_inference_profile'), str) or not certificate['requested_inference_profile']:
        errors.append('publication review inference profile is missing')
    if not isinstance(certificate.get('request_ids'), list):
        errors.append('publication review request IDs are missing')
    if not isinstance(certificate.get('timestamp'), str) or not certificate['timestamp']:
        errors.append('publication review timestamp is missing')
    return errors


def deterministic_gate(case):
    """Network-free Python/JavaScript/Z3 certification: the ordinary blocking publication gate."""
    import case_oracle
    from refine import certify
    py = certify(case, require_backing=True)
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as handle:
        json.dump(case, handle)
    try:
        js = js_certify([handle.name])[0]
    finally:
        os.remove(handle.name)
    z = case_oracle.check_case(case)
    errors = ([f'python: {error}' for error in py.get('errors', [])]
              + [f'js: {error}' for error in js.get('errors', [])]
              + z['errors'] + question_alias_errors(case))
    if py['ok'] and js['ok'] and (py['solve_depth'], py['pillars']) != (js['solveDepth'], js['pillars']):
        errors.append(f"python and js disagree: {py['solve_depth']}/{py['pillars']} vs {js['solveDepth']}/{js['pillars']}")
    return {'ok': not errors, 'errors': errors, 'python': py, 'js': js, 'z3': z}


def gate(case, strict_publication_review=False):
    """Run the deterministic gate; optionally promote whole-case review findings to blocking errors."""
    result = deterministic_gate(case)
    certificate_errors = publication_certificate_errors(case)
    certificate = case.get('publication_review')
    status = certificate.get('critic_status') if isinstance(certificate, dict) else None
    if strict_publication_review and status != 'PASS':
        certificate_errors.append(f"publication critic status is {status or 'missing'}, not PASS")
    # Deduplicate while preserving diagnostic order.
    certificate_errors = list(dict.fromkeys(certificate_errors))
    if strict_publication_review and certificate_errors:
        result['errors'] = [*result.get('errors', []), *certificate_errors]
        result['ok'] = False
    result['publication_review_mode'] = 'strict' if strict_publication_review else 'shadow'
    result['publication_review'] = certificate
    result['publication_review_errors'] = certificate_errors
    return result


def _read_json(path):
    """Read JSON while deterministically closing the file descriptor."""
    return pubio.read_json(path)


def _atomic_json(path, value):
    """Durably replace complete JSON through a same-directory temporary."""
    return pubio.atomic_json(path, value)


def _serialized_case(case, strict_publication_review=False):
    """Round-trip the exact served object and gate that representation before any write."""
    serialized = json.loads(json.dumps(case, ensure_ascii=False))
    post = gate(serialized, strict_publication_review=strict_publication_review)
    if not post['ok']:
        raise ValueError('the serialized published case failed certification: ' + '; '.join(post['errors'][:3]))
    return serialized, post


def _review_gate_rate(case, difficulty_target=None, strict_publication_review=False):
    """The shared publication boundary: review, deterministically gate, rate, and validate the exact serializable
    candidate (strict critic enforcement is opt-in). Writes nothing; callers commit what it returns."""
    review_for_publication(case)
    pre = gate(case, strict_publication_review=strict_publication_review)
    if not pre['ok']:
        raise ValueError('the published case failed certification: ' + '; '.join(pre['errors'][:3]))
    case['difficulty'] = difficulty.rate_with_target(case, report=pre['python'], target=difficulty_target)
    return _serialized_case(case, strict_publication_review=strict_publication_review)


def disk_sha256(path):
    """The provenance hash of the JSON now at path (None if it is gone): what optimistic checks and read-backs compare."""
    try:
        return provenance.sha256(_read_json(path))
    except FileNotFoundError:
        return None


def _require_on_disk(path, expected_sha256):
    """Read a just-written file back and refuse to advertise it unless it is exactly what was meant to be written."""
    if disk_sha256(path) != expected_sha256:
        raise OSError(f'{os.path.basename(path)} did not read back as written; the index was not updated')


def js_certify(paths):
    out = subprocess.run(['node', f'{ROOT}/tools/mk-certify.mjs', *paths], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


ASK = """You write the player's lines for a 1920s English village mystery. For each item, write the short, natural
question the detective says aloud to the named character to hear their account. The detective knows ONLY: the premise,
the topic, and the 'known' clues listed with the item. The question must not reveal or presuppose anything from the
account itself. Address the character directly; at most 14 words; end with a question mark. Good: "Mrs Finch, what
did you see in the yard last night?" Bad: "Mrs Finch, what time did Mr Voss leave?" (presupposes the account).
Each item lists 'already_asked': questions the detective can already put to everyone. Where this account answers
one of those, it will be asked that way; otherwise ask about this account's own topic.
Return {"questions": {"<id>": "<question>"}}."""
# What the detective can ask anyone (kernel-case.mjs topicsFor / followupOptions): account questions must differ from these.
def _question_rules():
    """The standard questions and the alias rules, read from the game's own module (dist/cases/questions.mjs), so
    publishing and play classify questions identically."""
    url = 'file://' + os.path.join(ROOT, 'dist', 'cases', 'questions.mjs')
    script = (f'import({json.dumps(url)}).then(m => console.log(JSON.stringify({{standard: m.STANDARD_QUESTIONS, '
              'aliasTopics: m.ALIAS_TOPICS, filler: m.QUESTION_FILLER, nightCore: m.NIGHT_QUESTION_CORE})))')
    out = subprocess.run(['node', '--input-type=module', '-e', script], capture_output=True, text=True, check=True)
    rules = json.loads(out.stdout)
    q = dict(rules['standard'])
    q.pop('case', None)                       # the constable's briefing is not an account question
    q.pop('everyday', None)                   # nor is the plain-facts question (it never brings out an account)
    return q, tuple(rules['aliasTopics']), tuple(rules['filler']), rules['nightCore']


_STANDARD, ALIAS_TOPICS, _QUESTION_FILLER, _NIGHT_CORE = _question_rules()
STANDARD_TOPICS, STANDARD_QUESTIONS = list(_STANDARD), list(_STANDARD.values())
SAME = """For each character you get the questions a detective can ask them, with ids. Group the questions that ask for the
same thing in different words: any question asking where they were or what they did last night asks the same as
"What is your account of last night?", however it is addressed.
Questions about different topics, times, people or objects are different, even if they look alike.
Return {"duplicates": {"<character id>": [["<id>", "<id>", ...], ...]}} listing only groups of two or more."""
TITLE_WORDS = {'Mr', 'Mrs', 'Miss', 'Dr', 'Doctor', 'Constable', 'Reverend', 'I'}


def _question_key(value):
    """Case- and punctuation-insensitive wording. Must stay identical to questions.mjs `questionKey`."""
    return ' '.join(re.findall(r"[a-z0-9]+", str(value).lower().replace('’', "'")))


_ALIAS_STANDARD_BY_KEY = {_question_key(_STANDARD[topic]): topic for topic in ALIAS_TOPICS if topic in _STANDARD}


def _case_names(case):
    """Every name and form of address in the case, for recognising a vocative around a plain question."""
    import premise
    setting = {p['id']: p for p in premise.SETTING.get('people', [])}
    out = []
    for person in case.get('people', []):
        out += [person.get('name', ''), setting.get(person['id'], {}).get('name', ''), setting.get(person['id'], {}).get('address', '')]
    return [name for name in out if name]


def is_plain_night_question(question, names=()):
    """Whether a question asks only where the person was last night (questions.mjs `isPlainNightQuestion`)."""
    words = set(_QUESTION_FILLER) | {w for name in names for w in _question_key(name).split() if w}
    filler = '|'.join(sorted(re.sub(r'[^a-z0-9]', '', w) for w in words if re.sub(r'[^a-z0-9]', '', w)))
    return re.fullmatch(rf'(?:(?:{filler}) )*{_NIGHT_CORE}(?: (?:{filler}))*', _question_key(question)) is not None


def _alias_signs(case):
    """Account questions that may carry an alias: own-question testimony (summaries and sightings have fixed questions)."""
    return {sign['id']: sign for sign in case.get('signs', [])
            if sign.get('kind') == 'testimony' and sign.get('ask') and sign.get('id')
            and not (sign.get('surface') or sign.get('morning') or sign.get('sighting'))}


def _valid_alias_target(case_signs, sid, target):
    """An alias target must deliver the account: a night-delivering standard topic or the same speaker's account."""
    if target in ALIAS_TOPICS:
        return True
    other = case_signs.get(target)
    return bool(other and other.get('kind') == 'testimony' and other.get('speaker') == case_signs[sid].get('speaker')
                and target != sid)


def deterministic_duplicate_questions(case):
    """Aliases that do not need a model: plain whereabouts questions, exact night-question wording, and exact
    same-speaker rewordings."""
    names = _case_names(case)
    people = {}
    for sign in _alias_signs(case).values():
        people.setdefault(sign.get('speaker'), []).append(sign)
    aliases = {}
    for questions in people.values():
        first_by_wording = {}
        for sign in questions:
            key = _question_key(sign['ask'])
            standard = _ALIAS_STANDARD_BY_KEY.get(key) or ('night' if is_plain_night_question(sign['ask'], names) else None)
            if standard:
                aliases[sign['id']] = standard
            elif key in first_by_wording:
                aliases[sign['id']] = first_by_wording[key]
            else:
                first_by_wording[key] = sign['id']
    return aliases


def _resolved_alias(topic, aliases):
    seen = set()
    while topic in aliases:
        if topic in seen:
            return None
        seen.add(topic)
        topic = aliases[topic]
    return topic


def question_alias_errors(case):
    """Publication errors for unsafe, cyclic, or missing deterministic question aliases."""
    case_signs = {sign.get('id'): sign for sign in case.get('signs', []) if sign.get('id')}
    aliases = {sid: sign['same_as'] for sid, sign in case_signs.items() if sign.get('same_as')}
    eligible = _alias_signs(case)
    errors = []
    for sid, target in aliases.items():
        if sid not in eligible:
            errors.append(f'question {sid} has an alias but no own question')
        elif not _valid_alias_target(case_signs, sid, target):
            errors.append(f'question {sid} aliases {target}, which does not deliver it')
        elif _resolved_alias(sid, aliases) is None:
            errors.append(f'question alias cycle at {sid}')
    for sid, target in deterministic_duplicate_questions(case).items():
        resolved = _resolved_alias(sid, aliases)
        expected = _resolved_alias(target, aliases) if target in aliases else target
        if resolved != expected:
            errors.append(f'question {sid} duplicates {target} but is not aliased to it')
    return list(dict.fromkeys(errors))


def add_questions(case, synopsis):
    """A question for every account a person can be asked about (written not to give its content away), then a check
    for questions that ask the same as a standard question or as another of theirs (`mark_duplicate_questions`)."""
    from refine import llm_json, CRITIC_MODEL
    import re
    signs = {x['id']: x for x in case['signs']}
    names = {p['id']: p['name'] for p in case['people']}
    victim_words = set(names.get(enrich.victim_of(case), '').split())   # the dead are named in every premise
    def known(x):
        return ' '.join([synopsis, x.get('title', '')] + [signs[r].get('text', '') for r in x.get('requires', []) if r in signs])
    todo = [x for x in case['signs'] if x['kind'] == 'testimony' and not x.get('ask')]
    n = 0
    if todo:
        items = [{'id': x['id'], 'character': names.get(x['speaker'], x['speaker']), 'topic': x.get('title'), 'known': known(x),
                  'already_asked': STANDARD_QUESTIONS} for x in todo]
        out = llm_json(ASK, json.dumps({'premise': synopsis, 'items': items}), 2000, model=CRITIC_MODEL).get('questions', {})
        for x in todo:
            q = str(out.get(x['id'], '')).strip()
            caps = [w for w in re.findall(r"[A-Z][a-z]+", q)[1:] if w not in TITLE_WORDS | victim_words and w not in names.get(x['speaker'], '')]
            leak = [w for w in caps if w not in known(x)]
            if q.endswith('?') and 3 <= len(q.split()) <= 16 and not leak:
                x['ask'] = q; n += 1
    mark_duplicate_questions(case)
    return n


def mark_duplicate_questions(case, judge=True):
    """Attach aliases (same_as) so the menu never shows two questions asking the same thing.

    Aliases are recomputed on every run: deterministic aliases always apply, and the semantic judge adds the rest.
    Only when the judge is unavailable (or `judge=False`, the network-free repair used by maintenance tools) are
    earlier aliases kept, still subject to validation, so a transient model failure never removes a reviewed alias
    while a successful run can drop an alias it no longer confirms."""
    case_signs = {sign['id']: sign for sign in case['signs'] if sign.get('id')}
    eligible = _alias_signs(case)
    judged = duplicate_questions(case) if judge else None
    if judged is None:   # judge unavailable: keep what earlier runs established
        aliases = {sid: sign['same_as'] for sid, sign in case_signs.items() if sign.get('same_as')}
    else:
        aliases = dict(judged)
    aliases.update(deterministic_duplicate_questions(case))
    aliases = {sid: target for sid, target in aliases.items()
               if sid in eligible and _valid_alias_target(case_signs, sid, target)}
    # Drop chains that cycle rather than serialise an alias the runtime cannot resolve.
    aliases = {sid: target for sid, target in aliases.items() if _resolved_alias(sid, aliases) is not None}
    for sign in case['signs']:
        sign.pop('same_as', None)
        if sign.get('id') in aliases:
            sign['same_as'] = aliases[sign['id']]
    return len(aliases)


def duplicate_questions(case, model=None):
    """Model-judged aliases for semantic rewordings the deterministic rules cannot identify safely, or None when the
    judge is unavailable. Groups are per speaker; a target must deliver the account (see `_valid_alias_target`)."""
    from refine import llm_json, CRITIC_MODEL
    eligible = _alias_signs(case)
    people = {}
    for sign in eligible.values():
        people.setdefault(sign['speaker'], []).append(sign)
    if not people:
        return {}
    items = {pid: [{'id': f'std{i}', 'question': q} for i, q in enumerate(STANDARD_QUESTIONS)]
             + [{'id': x['id'], 'question': x['ask']} for x in xs] for pid, xs in people.items()}
    try:
        groups = llm_json(SAME, json.dumps(items), 1200, model=model or CRITIC_MODEL).get('duplicates', {})
    except Exception:
        return None
    if not isinstance(groups, dict):
        return None
    case_signs = {sign['id']: sign for sign in case['signs'] if sign.get('id')}
    out = {}
    for pid, gs in groups.items():
        own = {i['id'] for i in items.get(pid, [])}
        for g in gs if isinstance(gs, list) else []:
            g = [i for i in g if isinstance(i, str) and i in own] if isinstance(g, list) else []
            if len(g) < 2:
                continue
            standard = [i for i in g if i.startswith('std')]
            if standard:
                topic = STANDARD_TOPICS[int(standard[0][3:])]
                if topic not in ALIAS_TOPICS:   # that standard question does not deliver an account: no alias
                    continue
                keep = topic
            else:
                keep = g[0]
            for i in g:
                if not i.startswith('std') and i != keep and _valid_alias_target(case_signs, i, keep):
                    out[i] = keep
    return out


SURFACE = """You write what each person in a 1920s English village mystery says when first asked "Where were you last
night?". You are given their voice, what they actually did (their own true events), what they want, fear or hide, and
whether they are the culprit. Write 1 to 3 sentences in their voice, about the evening and night only (up to when they slept), never this morning. Rules:
- The culprit gives a false but vague account that hides the crime and does not prove anything.
- An innocent gives a true but vague account that keeps their private secret hidden.
- No clock times, no numbers, no named witnesses who could confirm it; nothing that would clear or convict anyone.
- Stay consistent with their events and attitudes; do not mention the investigation's clues.
- 'who' says who everyone is (role, family, description): refer to people only as that allows. The victim is dead
  this morning: never speak of them as able to do anything now (not "ask her", not "she'll tell you").
- 'tells' is what they also tell the detective when asked more closely. Never contradict it, even where it is untrue (a
  person keeps to their own story). Do not repeat it either: this is the vaguer first answer, without its details.
- If 'previous_attempt' is given, it was rejected for the reason stated: write it again without that.
Return {"accounts": {"<person id>": "<what they say>"}}."""

AGREES = """For each person in a 1920s village mystery you get a short account of their evening and the statements they also
give the detective ('tells'). Does the account contradict any statement (a different place, leaving when a statement
says they stayed, a different reason, and so on), or misstate who someone is ('who' gives each person's role and
description: calling a sister a wife is a contradiction), or speak of the victim as alive now ('who' marks them: "ask
the landlady" when the landlady is dead is a contradiction)? Being vaguer or leaving things out is not a contradiction.
Return {"verdicts": {"<id>": {"agrees": true | false, "why": "<for a contradiction: what differs>"}}}."""


def own_statements(case, pid):
    """What a person tells the detective as soon as asked, in the case's own statements (their claims, true or false). Not
    what they say only once something is proven (a statement that requires a clue): before that they hold it back."""
    return [x['text'] for x in case['signs'] if x.get('speaker') == pid and x.get('kind') == 'testimony' and x.get('claim')
            and not x.get('requires') and not x.get('surface') and not x.get('morning') and not x.get('sighting')]


SURFACE_CHECK = 3   # 2: accounts are also checked for who people are (kinship, roles); 3: the victim is dead


def who_is_who(case):
    """Each person in the case as the setting describes them: name, role and public description (kinship lives there)."""
    setting = {p['id']: p for p in enrich.SETTING.get('people', [])}
    victim = enrich.victim_of(case)
    return [{'id': p['id'], 'name': setting.get(p['id'], {}).get('name', p.get('name')), 'role': setting.get(p['id'], {}).get('role'),
             'description': setting.get(p['id'], {}).get('public'),
             **({'status': 'the victim: dead since last night'} if p['id'] == victim else {})} for p in case['people']]


def surface_disagreements(case, signs):
    """{sign id: why} for evening accounts that contradict their speaker's own statements."""
    from refine import llm_json, CRITIC_MODEL
    items = [{'id': x['id'], 'speaker': x['speaker'], 'account': x['text'], 'tells': own_statements(case, x['speaker']), 'who': who_is_who(case)}
             for x in signs]
    if not items:
        return {}
    out = _as_map(llm_json(AGREES, json.dumps(items), 1500, model=CRITIC_MODEL).get('verdicts', {}))
    bad = {}
    for i in items:
        v = out.get(i['id'], {})
        if isinstance(v, dict) and v.get('agrees') is False:
            bad[i['id']] = str(v.get('why', ''))[:300]
    return bad


def add_surface_accounts(case, rounds=2):
    """Each person's first account of the evening: true but vague for an innocent, a vague cover for the culprit, and never
    against what they themselves tell the detective. One that contradicts their statements is rewritten, else dropped."""
    from refine import llm_json, CRITIC_MODEL
    import re
    q = case['question']
    truth = next(h for h in q['candidates'] if h['id'] == q['truth'])['facts']['actor']
    people = {p['id']: p for p in case['people']}
    victim = enrich.victim_of(case)
    # only people the history gives an evening to: a summary of nothing would be a fact the case never recorded
    morning = enrich.day(case, 'morning')
    active = {q for e in case['events'] if e['start'] < morning for q in [e.get('agent'), *e.get('others', [])] if q}
    # accounts already published are checked too (a case published before this check)
    failed = {}
    old = [x for x in case['signs'] if x.get('surface') and x.get('agrees_checked') != SURFACE_CHECK]
    for sid, why in surface_disagreements(case, old).items():
        x = next(y for y in case['signs'] if y['id'] == sid)
        failed[x['speaker']] = {'text': x['text'], 'rejected_because': why}
    with SIGNS: case['signs'][:] = [x for x in case['signs'] if not (x.get('surface') and x['speaker'] in failed)]
    for x in old:
        if x['speaker'] not in failed:
            x['agrees_checked'] = SURFACE_CHECK
    n = 0
    for r in range(rounds):
        have = {x['speaker'] for x in case['signs'] if x.get('surface')}
        todo = [p['id'] for p in case['people'] if p['id'] != victim and p['id'] not in have and p['id'] in active
                and p['id'] not in case.get('surface_dropped', [])]
        if not todo:
            break
        items = [{'id': pid, 'name': people[pid]['name'], 'voice': people[pid].get('voice'), 'culprit': pid == truth,
                  'events': [e.get('summary') for e in case['events'] if (pid == e.get('agent') or pid in e.get('others', [])) and e['start'] < morning],
                  'attitudes': [f"{a['mode']}: {a['content']}" for a in case['attitudes'] if a['agent'] == pid],
                  'tells': own_statements(case, pid), 'who': who_is_who(case), **({'previous_attempt': failed[pid]} if pid in failed else {})} for pid in todo]
        out = llm_json(SURFACE, json.dumps(items), 2500, model=CRITIC_MODEL).get('accounts', {})
        new = []
        for pid in todo:
            text = str(out.get(pid, '')).strip()
            if text and not re.search(r'\d', text) and len(text.split()) <= 70:
                x = {'id': f's_surface_{pid}', 'kind': 'testimony', 'speaker': pid, 'surface': True, 'deceptive': pid == truth,
                     'title': f"{people[pid]['name']} on the evening", 'text': text, 'ask': 'Where were you last night?'}
                with SIGNS: case['signs'].insert(0, x)
                new.append(x)
        bad = surface_disagreements(case, new)
        failed = {x['speaker']: {'text': x['text'], 'rejected_because': bad[x['id']]} for x in new if x['id'] in bad}
        with SIGNS: case['signs'][:] = [x for x in case['signs'] if x['id'] not in bad]
        for x in new:
            if x['id'] not in bad:
                x['agrees_checked'] = SURFACE_CHECK
                n += 1
        if r == rounds - 1 and failed:
            case.setdefault('surface_dropped', []).extend(failed)
    return n


MORNING = """You write what each person in a 1920s English village mystery says when asked "What did you do this morning?".
You are given their voice, what they actually did this morning (their own true events, each with its time in words),
what they want, fear or hide, and whether they are the culprit. Write 1 to 3 sentences in their voice. Rules:
- Speak ONLY of: where they were and when; finding the body or examining it, if they did; who fetched them or told them
  of the death, if an event says so. Nothing else anyone did (no letters, wires, purchases or conversations), nothing
  about the evening, nothing that is evidence, no cause of death, no opinions about anyone.
- An innocent says only what is true; the times as given (in words, never digits).
- The culprit gives a plausible account that leaves out anything they did in secret (it may be a cover story).
- If 'previous_attempt' is given, it was judged untrue for the reason stated: write it again without that.
Return {"accounts": {"<person id>": "<what they say>"}}."""


def spoken_about(minute):
    """A time as people say it: to the nearest five minutes ('about twenty to seven'), exact when it is."""
    r = int(round(minute / 5.0) * 5)
    return clock_words(r) if r == int(round(minute)) else 'about ' + clock_words(r)


def add_morning_accounts(case, rounds=3):
    """Each person's morning, worded from their own events between the morning and the investigation, like the evening
    summary: claimless, backed by their own events, and checked against the true history. An innocent's account must come
    out honest (rewritten once, else dropped); only the culprit may give a cover story."""
    from refine import llm_json, CRITIC_MODEL
    import re
    people = {p['id']: p for p in case['people']}
    victim, truth = enrich.victim_of(case), enrich.truth_actor(case)
    morning, start = enrich.day(case, 'morning'), enrich.day(case, 'start')
    crime = case['question']['crime']['event']
    # what the writer may see: the person's own morning events that are not the source of any clue (the discovery and the
    # examination always), so the account cannot reveal evidence it was never shown
    sources = {x.get('source') for x in case['signs']}
    own = lambda pid: sorted([e for e in case['events'] if (pid == e.get('agent') or pid in (e.get('others') or []))
                              and morning <= e['start'] < start and e['id'] != crime
                              and (e.get('type') in ('discovery', 'examination') or e['id'] not in sources)], key=lambda e: e['start'])
    n, failed = 0, {}
    for _ in range(rounds):
        have = {x['speaker'] for x in case['signs'] if x.get('morning')}
        todo = [pid for pid in people if pid != victim and pid not in have and own(pid)
                and f's_morning_{pid}' not in case.get('morning_dropped', [])]
        if not todo:
            break
        items = [{'id': pid, 'name': people[pid]['name'], 'voice': people[pid].get('voice'), 'culprit': pid == truth,
                  'morning': [f"at {spoken_about(e['start'])}: {e.get('summary')}" for e in own(pid)],
                  **({'previous_attempt': failed[pid]} if pid in failed else {}),
                  # only the culprit needs to know what to hide
                  'hides': [a['content'] for a in case['attitudes'] if a['agent'] == pid] if pid == truth else []} for pid in todo]
        out = llm_json(MORNING, json.dumps(items), 2500, model=CRITIC_MODEL).get('accounts', {})
        for pid in todo:
            text = str(out.get(pid, '')).strip()
            if text and not re.search(r'\d', text) and len(text.split()) <= 80:
                with SIGNS: case['signs'].insert(0, {'id': f's_morning_{pid}', 'kind': 'testimony', 'speaker': pid, 'morning': True,
                                                     'deceptive': pid == truth, 'title': f"{people[pid]['name']} on the morning",
                                                     'text': text, 'ask': 'What did you do this morning?'})
                n += 1
        mark_surface_truth(case)
        # an innocent's morning that is not honest is the wording's fault, not a lie with a reason: rewrite, then drop
        bad = [x['id'] for x in case['signs'] if x.get('morning') and x['speaker'] != truth and x.get('surface_checked') == 'cover']
        failed = {x['speaker']: {'text': x['text'], 'not_true_because': x.get('surface_why', '')} for x in case['signs'] if x['id'] in bad}
        case['signs'] = [x for x in case['signs'] if x['id'] not in bad]
        if _ == rounds - 1 and bad:
            case.setdefault('morning_dropped', []).extend(bad)
        n -= len(bad)
    return n


SIGHT = """You write what a person in a 1920s English village mystery says when asked "Did you see anyone last night?",
about ONE person they saw. You get the speaker's voice, who they saw, where, and roughly when (in words). Write one
sentence in the speaker's voice saying they saw that person there at about that time, using 'their_pronoun' for
them. Nothing else: no reason, no opinion, no manner ("slipping in", "bold as you please"), no other person, no digits. Return {"lines": {"<id>": "<sentence>"}}."""
SIGHTINGS_PER_PERSON = 3


def sighting_candidates(case):
    """(speaker, seen, place, start, end, event) for every pair of people at the same place at overlapping times in the
    true history, from the evening until the investigation starts (never the crime). Read from the history: facts."""
    from refine import presence
    victim, crime = enrich.victim_of(case), case['question']['crime']['event']
    evening, start = enrich.day(case, 'evening'), enrich.day(case, 'morning')   # last night: the evening to the morning
    pres = presence(case)
    people = {p['id'] for p in case['people']}
    out, seen = [], set()
    for a in sorted(pres):
        for b in sorted(pres):
            if a == b or a == victim or a not in people or b not in people:
                continue
            for (s0, e0, pl, ea) in pres[a]:
                for (s1, e1, pl1, eb) in pres[b]:
                    lo, hi = max(s0, s1, evening), min(e0, e1, start)
                    if pl != pl1 or lo >= hi or crime in (ea, eb) or (a, b, pl) in seen:
                        continue
                    seen.add((a, b, pl))
                    out.append((a, b, pl, lo, hi, ea))
    return out


def _solve_shape(case):
    from refine import certify
    r = certify(case, require_backing=True)
    return r['ok'], (r.get('solve_depth'), tuple(sorted((r.get('threads') or {}).items())), tuple(sorted(r.get('surface') or [])),
                     tuple(r.get('false_signs') or []), r.get('twist'))


def contradictions(case):
    """Pairs of reachable claims that cannot both be true (one person in two places, one object with two holders, two
    values of a trait, ...) with neither recorded as defeating the other: the kernels refuse such a case. Conflicts
    that need three or more claims are left for the kernels to report."""
    from refine import analyse
    from claims import claim_of, consistent, instance_claims
    A = analyse(case)
    overturned = {d for x in case['signs'] if x.get('kind') == 'public' for d in x.get('defeats', [])}
    readable = [(sid, claim_of(A['signs'][sid])) for sid in sorted(A['understood']) if claim_of(A['signs'][sid]) and sid not in overturned]
    claim = dict(readable)
    out, seen = [], set()
    for ids in instance_claims(case, readable).values():
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                if (a, b) in seen or b in A['signs'][a].get('defeats', []) or a in A['signs'][b].get('defeats', []):
                    continue
                seen.add((a, b))
                if not consistent(case, [(a, claim[a]), (b, claim[b])], A['tt']):
                    out.append((a, b, A['truthval'].get(a), A['truthval'].get(b)))
    return out


def record_contradictions(case, log=print):
    """Make every contradiction the player could see one the case records. A sighting is published only if it changes
    nothing, so one that would break a lie is dropped; otherwise the true account is recorded as defeating the false one
    (the history already makes it so). Returns the number of changes; a contradiction between two false accounts is
    left for the gate to refuse."""
    n = 0
    for _ in range(len(case['signs'])):
        found = contradictions(case)
        if not found:
            break
        a, b, ta, tb = found[0]
        signs = {x['id']: x for x in case['signs']}
        sighting = next((x for x in (a, b) if signs[x].get('sighting')), None)
        if sighting:
            case['signs'] = [x for x in case['signs'] if x['id'] != sighting]
            log(f'  dropped sighting {sighting}: it contradicts {b if sighting == a else a}')
        elif ta != tb:
            true, false = (a, b) if ta else (b, a)
            signs[true].setdefault('defeats', []).append(false)
            log(f'  {true} now defeats {false} (they contradict, and {true} is true)')
        else:
            break
        n += 1
    return n


def names_seen(case, x, text):
    """Whether a sighting's words name the person seen (by name, surname, first name or form of address): an answer to
    'did you see anyone?' must say whom."""
    import re
    p = {q['id']: q for q in enrich.SETTING.get('people', [])}.get(x['claim']['person'], {})
    name = p.get('name') or next((q['name'] for q in case['people'] if q['id'] == x['claim']['person']), '')
    forms = {name, p.get('address') or '', *name.split()} - {'', 'The', 'Reverend', 'Dr'}
    return any(re.search(rf"\b{re.escape(f)}\b", text) for f in forms if len(f) > 2)


def add_sightings(case, log=print):
    """Who saw whom last night, as accounts: read from the history, kept only if the case certifies with the same solve
    (depth, every thread, the surface reading, the false accounts), worded by a model, checked by code and reviewed.
    A sighting may never shortcut or break the puzzle."""
    from refine import llm_json, CRITIC_MODEL
    import re
    # a published sighting that does not say whom it saw is written again (or dropped, if no wording passes)
    unnamed = [x for x in case['signs'] if x.get('sighting') and not names_seen(case, x, x.get('text', ''))]
    if unnamed:
        case['signs'] = [x for x in case['signs'] if x not in unnamed]
        log(f'  sightings: {len(unnamed)} did not name whom they saw; written again')
    have = {(x.get('speaker'), (x.get('claim') or {}).get('person')) for x in case['signs'] if x.get('sighting')}
    ok0, shape0 = _solve_shape(case)
    if not ok0:
        return 0
    names = {p['id']: p['name'] for p in case['people']}
    truth = enrich.truth_actor(case)
    # someone lying about their own night does not volunteer where they were (a sighting would say it)
    liars = {x['speaker'] for x in case['signs'] if x.get('kind') == 'testimony' and x.get('deceptive')}
    cands = [c for c in sighting_candidates(case) if (c[0], c[1]) not in have and c[0] not in liars]
    # people of interest first: suspects, then anyone; a speaker gives at most a few
    suspects = {(h.get('facts') or {}).get('actor') for h in case['question']['candidates']}
    cands.sort(key=lambda c: (c[1] not in suspects, c[0], c[3]))
    kept, per = [], {}
    for a, b, pl, lo, hi, ev in cands:
        if per.get(a, 0) >= SIGHTINGS_PER_PERSON:
            continue
        sid = f's_saw_{a}_{b}_{pl}'
        sign = {'id': sid, 'kind': 'testimony', 'speaker': a, 'sighting': True, 'source': ev,
                'claim': {'pred': 'wasAt', 'person': b, 'place': pl, 'from': lo, 'to': hi},
                'title': f"{names[a]} saw {names[b]}", 'text': '', 'ask': 'Did you see anyone last night?'}
        case['signs'].append(sign)
        ok, shape = _solve_shape(case)
        if ok and shape == shape0:     # solve-neutral: kept
            kept.append(sign); per[a] = per.get(a, 0) + 1
        else:
            case['signs'].remove(sign)
    if not kept:
        return 0
    when = lambda x: spoken_about((x['claim']['from'] + min(x['claim']['to'], x['claim']['from'] + 30)) / 2)
    setting = {p['id']: p for p in enrich.SETTING.get('people', [])}
    places = {p['id']: p['name'] for p in enrich.SETTING.get('places', [])}
    items = [{'id': x['id'], 'speaker': names[x['speaker']], 'voice': setting.get(x['speaker'], {}).get('voice', ''),
              'saw': setting.get(x['claim']['person'], {}).get('address') or names[x['claim']['person']],
              'their_pronoun': setting.get(x['claim']['person'], {}).get('pronoun', 'they'),
              'where': places.get(x['claim']['place'], x['claim']['place']), 'when': when(x)} for x in kept]
    out = _as_map(llm_json(SIGHT, json.dumps(items), 3000, model=CRITIC_MODEL).get('lines', {}))
    # another person named in the line: their name as whole words (not 'Lacey' inside 'Mrs Lacey' of the person seen,
    # or a place named after someone: 'the Rook & Lantern', 'Dr Marsh's surgery')
    seen_forms = lambda x: ' '.join([names[x['claim']['person']], setting.get(x['claim']['person'], {}).get('address', ''), places.get(x['claim']['place'], '')])
    def others(x):
        line = str(out.get(x['id'], ''))
        for f in seen_forms(x).split():
            line = re.sub(rf"\b{re.escape(f)}\b", '', line)
        return [n for pid, n in names.items() if pid not in (x['speaker'], x['claim']['person'])
                and any(re.search(rf"\b{re.escape(w)}\b", line) for w in n.split() if len(w) > 2 and w not in ('The', 'Reverend'))]
    n = 0
    for x in kept:
        text = str(out.get(x['id']) or '').strip()
        if not text or re.search(r'\d', text) or len(text.split()) > 40 or others(x) or not names_seen(case, x, text):
            case['signs'].remove(x)      # no wording that passes the checks: no sighting
            continue
        x['text'] = text; x['deceptive'] = False
        n += 1
    probs = enrich.review_publish(case)
    bad = {k.split('|')[0] for k in probs if k.endswith('|text')}
    gone = [x for x in kept if x['id'] in bad]
    case['signs'] = [x for x in case['signs'] if x not in gone]
    n -= len(gone)
    log(f'  sightings: {n} kept of {len(cands)} candidates')
    return n


SHOW = """You write the detective's lines for a 1920s English village mystery. For each clue, write what the detective
says aloud when showing it to someone: one or two natural sentences that name what it is and ask about it. Rules:
- Do not read the clue out. Mention only what the detective can see or has read, in their own words.
- 'show' is said to someone OTHER than the person the clue is about: for an account (testimony), it is said to a
  third person and names the speaker ("Constable Bell says he spent the evening at the Rook. Do you know if that's
  true?"); for behaviour, it names the person behaving that way.
- 'confront' is said TO that person: to the speaker of an account ("You told me you went straight home. Is that the
  whole of it?") or to the person whose behaviour it is. Write 'confront' only for accounts and behaviour.
- 'to' and 'direct': if the clue concerns one particular person other than an account's speaker (the person an account
  is about, or the owner of a belonging, letter or mark it names), 'to' is that person's id (from 'people') and 'direct' is
  what the detective says TO them, addressing them as "you" ("Dr Marsh says you were at her surgery until ten. Is that
  so?"). Otherwise 'to' is null and there is no 'direct'.
- Add no facts that are not in the clue. At most 35 words each. End with a question mark.
Return {"lines": {"<clue id>": {"show": "...", "confront": "...", "to": "<person id or null>", "direct": "..."}}}."""

REACT = """You write how characters in a 1920s English village mystery react when the detective shows them a clue.
Each item gives the character (voice, what they want, fear or hide, what they did that night), the clue, and how the
character relates to it. Write their spoken reply: one to three sentences in their voice, spoken words only (first
person, no narration or stage directions such as "she laughs"). Rules:
- React to what the clue actually is, from the character's own position and knowledge.
- If the clue contradicts something they told the detective, they concede it, giving their real reason if they have one.
- The culprit never confesses; they deflect or minimise. An innocent keeps their private secret unless the clue exposes it.
- Add no facts about anyone's whereabouts, times or actions beyond the character's own listed events and the clue.
- No clock times or numbers unless they appear in the clue. At most 60 words.
Return {"reactions": {"<clue id>|<person id>": "..."}}."""


def _as_map(value, key_names=('id', 'key'), text_names=('text', 'reaction', 'line', 'reply')):
    """Models return either {id: value} or [{id: .., ...}]: normalise to a dict."""
    while isinstance(value, dict) and len(value) == 1 and next(iter(value)) in ('lines', 'reactions', 'clues', 'items'):
        value = next(iter(value.values()))   # models sometimes nest the wrapper key twice
    if isinstance(value, dict):
        return value
    out = {}
    for item in value or []:
        if isinstance(item, dict):
            k = next((item[n] for n in key_names if n in item), None)
            if k is not None:
                v = next((item[n] for n in text_names if n in item), None)
                out[str(k)] = v if v is not None else item
    return out


def _digits_ok(text, allowed):
    import re
    have = set(re.findall(r'\d+', allowed))
    return all(d in have for d in re.findall(r'\d+', text))


LINES_AGREE = """For each clue of a 1920s village mystery you get its text and the lines the detective says about it: 'show'
(putting it to someone else) and 'confront' (putting a person's own account back to them). Does each line say only what
the text says (it may be shorter, and may name the speaker)? A line that adds or changes a fact (a place, a time, a
person, an action, another account's content) does not agree.
Return {"verdicts": {"<id>": {"agrees": true | false, "why": "<for a disagreement: what differs>"}}}."""


TITLES = ('Mr', 'Mrs', 'Miss', 'Dr', 'Constable', 'Reverend')


def wrong_addresses(text, source=''):
    """Forms of address in `text` that no one in the setting answers to: a title with a surname ("Miss Lacey") where no
    person of that surname carries the title in their name or form of address ("Mrs Lacey", "The Reverend Thomas Hale").
    A form the clue's own text uses (`source`) is allowed: it may name someone outside the cast (a late "Mrs Hale")."""
    import re
    titles = {}
    for p in enrich.SETTING.get('people', []):
        titles.setdefault(p['name'].split()[-1], set()).update(f"{p['name']} {p.get('address') or ''}".split())
    return [f'{t} {sn}' for t, sn in re.findall(rf"\b({'|'.join(TITLES)})\.? ([A-Z][a-z]+)\b", str(text or ''))
            if sn in titles and t not in titles[sn] and f'{t} {sn}' not in str(source or '')]


def history_text(case):
    """The history's own words (events, intentions): names in it, such as a late wife, are not wording faults."""
    return ' '.join([str(e.get('summary') or '') for e in case['events']] + [str(a.get('content') or '') for a in case.get('attitudes', [])])


def correct_addresses(case):
    """Put right a form of address that no one answers to, in every published text of the case, where the person meant is
    plain: the one person of that surname the title fits ("Miss Lacey" -> "Mrs Lacey", the only Lacey). Wording only.
    Returns (corrected, left): forms put right and forms that fit no one or more than one person."""
    import re
    people = enrich.SETTING.get('people', [])
    history = history_text(case)
    female, male = {'Mrs', 'Miss'}, {'Mr'}

    def fix(text):
        nonlocal fixed, left
        def one(m):
            nonlocal fixed, left
            t, sn = m.group(1), m.group(2)
            if not wrong_addresses(m.group(0), history):
                return m.group(0)
            fits = [p for p in people if p['name'].split()[-1] == sn and (t not in female | male
                    or (t in female) == (p.get('pronoun') == 'she'))]
            if len(fits) == 1 and fits[0].get('address', '').endswith(sn):
                fixed += 1
                return fits[0]['address']
            left += 1
            return m.group(0)
        return re.sub(rf"\b({'|'.join(TITLES)})\.? ([A-Z][a-z]+)\b", one, text) if isinstance(text, str) else text

    fixed = left = 0
    for x in case['signs']:
        for k in ('text', 'show', 'confront', 'direct', 'ask', 'title'):
            if isinstance(x.get(k), str):
                x[k] = fix(x[k])
        for k in ('reactions', 'concede'):
            if isinstance(x.get(k), dict):
                x[k] = {a: fix(t) for a, t in x[k].items()}
    for pid, lines in (case.get('declines') or {}).items():
        case['declines'][pid] = [fix(t) for t in lines]
    return fixed, left


def text_key(text):
    import hashlib
    return hashlib.sha1(str(text or '').encode()).hexdigest()[:12]


def check_lines(case):
    """Lines written for a clue's text are kept only while they say what the text says: lines not yet checked against
    the current text are checked, and dropped if they add or change a fact, so add_show_lines writes them again.
    Returns the number dropped."""
    from refine import llm_json, CRITIC_MODEL
    n = 0
    for x in case['signs']:                            # a form of address no one answers to: written again
        if any(wrong_addresses(x.get(k), f"{x.get('text')} {history_text(case)}") for k in ('show', 'confront', 'direct')):
            for k in ('show', 'confront', 'direct', 'lines_for'):
                x.pop(k, None)
            n += 1
    todo = [x for x in case['signs'] if (x.get('show') or x.get('confront')) and x.get('lines_for') != text_key(x.get('text'))]
    if not todo:
        return n
    items = [{'id': x['id'], 'text': x.get('text'), **{k: x[k] for k in ('show', 'confront') if x.get(k)}} for x in todo]
    out = _as_map(llm_json(LINES_AGREE, json.dumps(items), 4000, model=CRITIC_MODEL).get('verdicts', {}))
    for x in todo:
        v = out.get(x['id'])
        if not isinstance(v, dict):
            continue                                   # no verdict: checked again next time
        if v.get('agrees') is False:
            for k in ('show', 'confront', 'direct'):
                x.pop(k, None)
            n += 1
        else:
            x['lines_for'] = text_key(x.get('text'))
    return n


def add_show_lines(case, _retry=True):
    import re
    from refine import llm_json, CRITIC_MODEL
    todo = [x for x in case['signs'] if not x.get('show') or 'to' not in x or (x.get('to') and not x.get('direct'))]
    if not todo:
        return 0
    names = {p['id']: p['name'] for p in case['people']}
    items = [{'id': x['id'], 'kind': x['kind'], 'title': x.get('title'), 'text': x.get('text'), 'place': x.get('at'),
              'speaker': names.get(x.get('speaker')), 'about': names.get(x.get('about'))} for x in todo]
    raw = llm_json(SHOW, json.dumps({'people': names, 'clues': items}), 8000, model=CRITIC_MODEL)
    out = _as_map(raw.get('lines', raw.get('clues', {})))
    n = 0
    for x in todo:
        got = out.get(x['id']) or {}
        if isinstance(got, str):
            got = {'show': got}
        if not got:
            continue                  # no reply for this clue: try again on the next pass
        # who the clue concerns: an account's subject is structural; for other clues the model names them
        if x['kind'] == 'testimony':
            subject = (x.get('claim') or {}).get('person')
        else:   # the model names the person the clue concerns; review_publish drops the addressed line (and 'to') unless
            #     the clue or the history supports it ("your ledger" only if the clue says it is theirs)
            subject = x.get('about') or got.get('to')
        if subject not in names or subject == x.get('speaker'):
            subject = None
        direct = str(got.get('direct') or '').strip()
        x['to'] = subject
        if subject and direct.endswith('?') and len(direct.split()) <= 40 and _digits_ok(direct, x.get('text', '')) and not wrong_addresses(direct, x.get('text')):
            x['direct'] = direct; n += 1
        for key in ('show', 'confront'):
            if x.get(key):
                continue
            line = str(got.get(key) or '').strip()
            if key == 'confront' and x['kind'] not in ('behavior', 'testimony'):
                continue
            # a line said to a third person must not address the speaker or subject as "you"
            if key == 'show' and x['kind'] in ('behavior', 'testimony') and re.search(r"^you\b|\byou('ve| have| had)? (told|said|mentioned|claimed|were|went)\b|\byour\b", line, re.I):
                continue
            if line.endswith('?') and len(line.split()) <= 40 and _digits_ok(line, x.get('text', '')) and not wrong_addresses(line, x.get('text')):
                x[key] = line; n += 1
                x.pop('lines_for', None)                       # new lines are checked by check_lines
    if n == 0 and _retry:   # an occasional malformed reply: try once more
        return add_show_lines(case, _retry=False)
    return n


SURFACE_TRUTH = """For each account in a 1920s village mystery you get what a person tells the detective about their evening or their
morning, and what they really did (their true events). Decide whether the account is HONEST (true, even if vague or incomplete: leaving things out
is honest) or a COVER story (it states or clearly implies something false about where they were or what they did).
Return {"verdicts": {"<id>": {"v": "honest" | "cover", "why": "<for a cover story: what in it is false>"}}}."""


def mark_surface_truth(case):
    """An evening account is deceptive when the speaker's true history contradicts it (not only the culprit's)."""
    from refine import llm_json, CRITIC_MODEL
    import enrich
    ta = enrich.truth_actor(case)
    todo = [x for x in case['signs'] if (x.get('surface') or x.get('morning')) and 'surface_checked' not in x]
    if not todo:
        return 0
    items = [{'id': x['id'], 'account': x['text'],
              'really': [e.get('summary') for e in case['events'] if x['speaker'] == e.get('agent') or x['speaker'] in e.get('others', [])]}
             for x in todo]
    out = _as_map(llm_json(SURFACE_TRUTH, json.dumps(items), 1500, model=CRITIC_MODEL).get('verdicts', {}))
    n = 0
    for x in todo:
        got = out.get(x['id'], out.get(x['speaker'], ''))
        v = str(got.get('v', '') if isinstance(got, dict) else got).lower()
        if isinstance(got, dict) and got.get('why'):
            x['surface_why'] = str(got['why'])[:300]
        if v not in ('honest', 'cover'):
            continue
        x['deceptive'] = x['speaker'] == ta or v == 'cover'
        x['surface_checked'] = v
        n += 1
    return n


CONCEDE = """In a 1920s English village mystery, a character gave the detective an account that held something back (a name,
or what their words really meant). The detective now shows them a piece of evidence that settles it. Write what the
character says (1-2 sentences, in their voice): they concede plainly what the evidence shows, as the 'meaning' states,
perhaps with a word about why they held back. Add no fact beyond 'meaning' and the evidence; no clock times or numbers
unless they are in the account. Return {"lines": {"<key>": "..."}}."""


def add_concessions(case):
    """x.concede[clue] for every true account with 'needs': what its speaker says when shown the clue that completes it.
    The same sign, so certification is unchanged; it lets the speaker name what they withheld once it is proven."""
    from refine import llm_json, CRITIC_MODEL, claim_true, travel_table, claim_of
    names = {p['id']: p for p in case['people']}
    places = {p['id']: p['name'] for p in case['setting']['places']}
    signs = {x['id']: x for x in case['signs']}
    tt = travel_table(case)
    def meaning(c):
        if c['pred'] == 'wasAt' and c.get('when', 'throughout') == 'throughout':
            return f"{names[c['person']]['name']} was at {places.get(c['place'], c['place'])} from {clock_words(c['from'])} to {clock_words(c['to'])}"
        return json.dumps(c)
    items, keys = [], []
    for x in case['signs']:
        c = claim_of(x)
        if x['kind'] != 'testimony' or not c or not claim_true(case, c, tt):
            continue
        for n in x.get('needs', []):
            if n in signs and not (x.get('concede') or {}).get(n):
                k = f"{x['id']}|{n}"
                keys.append((x, n, k))
                items.append({'key': k, 'character': names[x['speaker']]['name'], 'voice': names[x['speaker']].get('voice'),
                              'account': x['text'], 'meaning': meaning(c), 'evidence': {'title': signs[n].get('title'), 'text': signs[n].get('text')}})
    if not items:
        return 0
    out = _as_map(llm_json(CONCEDE, json.dumps(items), 4000, model=CRITIC_MODEL).get('lines', {}))
    k_ = 0
    for x, n, k in keys:
        line = str(out.get(k) or '').strip()
        if line and len(line.split()) <= 60 and _digits_ok(line, x.get('text', '')):
            x.setdefault('concede', {})[n] = line; k_ += 1
    return k_


def involved_pairs(case):
    """(clue, person) pairs worth a written reaction: people who took part in the clue's source event, the subject of a
    behaviour clue, the teller of a contradicted account, and the culprit for any clue carrying a claim."""
    evs = {e['id']: e for e in case['events']}
    truth = next(h for h in case['question']['candidates'] if h['id'] == case['question']['truth'])['facts']['actor']
    pairs = []
    for x in case['signs']:
        who = set()
        if x['kind'] == 'testimony':
            # an account shown to others: the person it places, the culprit if it bears on them, anyone it contradicts
            c = x.get('claim') or {}
            if c.get('person') and c['person'] != x.get('speaker'):
                who.add(c['person'])
            if x.get('defeats'):
                who.add(truth)
            for d in x.get('defeats', []):
                t = next((y for y in case['signs'] if y['id'] == d and y['kind'] == 'testimony'), None)
                if t:
                    who.add(t['speaker'])
            who.discard(x.get('speaker'))
            for pid in who:
                if pid and pid != enrich.victim_of(case) and not (x.get('reactions') or {}).get(pid):
                    pairs.append((x, pid))
            continue
        src = evs.get(x.get('source'))
        if src:
            who |= {src.get('agent'), *src.get('others', [])}
        # the people the clue is about: its claim names them, or it is addressed to them
        c = x.get('claim') or {}
        who |= {c.get('person'), c.get('a'), c.get('b'), x.get('to')} - {None}
        if x['kind'] == 'behavior' and x.get('about'):
            who.add(x['about'])
        for d in x.get('defeats', []):
            t = next((y for y in case['signs'] if y['id'] == d and y['kind'] == 'testimony'), None)
            if t:
                who.add(t['speaker'])
        if x.get('claim'):
            who.add(truth)
        for pid in who:
            if pid and pid != enrich.victim_of(case) and not (x.get('reactions') or {}).get(pid):
                pairs.append((x, pid))
    return pairs


def add_reactions(case):
    from refine import llm_json, CRITIC_MODEL
    pairs = involved_pairs(case)
    if not pairs:
        return 0
    people = {p['id']: p for p in case['people']}
    evs = {e['id']: e for e in case['events']}
    truth = next(h for h in case['question']['candidates'] if h['id'] == case['question']['truth'])['facts']['actor']
    def own_events(pid):
        return [e.get('summary') for e in case['events'] if e.get('agent') == pid or pid in e.get('others', [])]
    def relation(x, pid):
        r = []
        src = evs.get(x.get('source'))
        if src and (src.get('agent') == pid or pid in src.get('others', [])):
            r.append(f"took part in what produced it: {src.get('summary')}")
        if x['kind'] == 'behavior' and x.get('about') == pid:
            r.append('it describes their own behaviour')
        c = x.get('claim') or {}
        if pid in (c.get('person'), c.get('a'), c.get('b')) or x.get('to') == pid:
            r.append('it is about them')
        for d in x.get('defeats', []):
            t = next((y for y in case['signs'] if y['id'] == d and y.get('speaker') == pid), None)
            if t:
                r.append(f"it contradicts what they told the detective: {t.get('text')}")
            u = next((y for y in case['signs'] if y['id'] == d), None)
            if u and (u.get('claim') or {}).get('person') == pid and pid == truth:
                r.append(f"it breaks the account that placed them elsewhere: {u.get('text')}")
        if x['kind'] == 'testimony':
            r.append(f"it is what {people[x['speaker']]['name']} told the detective")
        if pid == truth:
            r.append('they are the culprit')
        return r
    out = {}
    for i in range(0, len(pairs), 18):
        chunk = pairs[i:i + 18]
        items = [{'key': f"{x['id']}|{pid}", 'character': people[pid]['name'], 'voice': people[pid].get('voice'),
                  'attitudes': [f"{a['mode']}: {a['content']}" for a in case['attitudes'] if a['agent'] == pid],
                  'their_events': own_events(pid), 'clue': {'kind': x['kind'], 'title': x.get('title'), 'text': x.get('text')},
                  'relation': relation(x, pid)} for x, pid in chunk]
        raw = llm_json(REACT, json.dumps(items), 8000, model=CRITIC_MODEL)
        out.update({k: (v if isinstance(v, str) else (v or {}).get('text', '')) for k, v in _as_map(raw.get('reactions', {})).items()})
    n = 0
    for x, pid in pairs:
        text = str(out.get(f"{x['id']}|{pid}") or '').strip()
        allowed = ' '.join([x.get('text', '')] + [str(e) for e in own_events(pid)])
        if text and len(text.split()) <= 70 and _digits_ok(text, allowed):
            x.setdefault('reactions', {})[pid] = text; n += 1
    return n


MEDICAL = """You write the village doctor's findings after examining the body in a 1920s English village mystery. You get
what really happened (the fatal event), whether death came at once or hours later (delayed), and the method type.
Write two short texts:
- 'notes': the doctor's written examination notes (2-3 sentences).
- 'says': what the doctor says aloud when asked about the body (1-2 sentences, in her voice).
Use these placeholders exactly and write no clock times or numbers yourself:
  {death}  - when death occurred (only if delayed is true)
  {window} - when the fatal act happened: the blow, the fall, or (if delayed) when the poison was taken
If delayed is true, say he died around {death} and that the poison (or cause) was taken some hours earlier, {window}.
If delayed is false, say death occurred {window}. Never say "shortly before death" for a delayed death.
State the cause only in general terms (e.g. 'a heavy blow to the back of the head', 'a poison taken by mouth'); never
name or describe a specific weapon, substance, container or owner, and never name anyone but the deceased.
Return {"notes": "...", "says": "..."}."""

MEDICAL_V = 2

NUM = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
       'fourteen', 'quarter', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two',
       'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine', 'half']


def clock_words(minute):
    """Minutes after midnight -> spoken 1920s clock time ('five to eleven', 'twenty past eleven'), computed, never guessed."""
    m = int(round(minute)) % 1440
    h, mm = (m // 60) % 12 or 12, m % 60
    nxt = h % 12 + 1
    if mm == 0:
        return f"{NUM[h]} o'clock"
    return f"{NUM[mm]} past {NUM[h]}" if mm <= 30 else f"{NUM[60 - mm]} to {NUM[nxt]}"


def add_medical(case):
    """The body's examination: cause (in general terms), when death came and when the fatal act happened. The
    time claim equals the question's crime window, so it rules nobody out beyond what certification already
    assumed; it makes that window known to the player, which alibis need. For a delayed death (poison) the doctor
    gives the time of death and places the fatal dose hours earlier, in the window."""
    import re
    from refine import llm_json, CRITIC_MODEL
    import enrich
    old = [x for x in case['signs'] if x.get('medical')]
    if old and all(x.get('medical_v') == MEDICAL_V for x in old):
        return 0
    q = case['question']
    crime = enrich.crime_event(case)
    victim = enrich.victim_of(case)
    exam = next((e for e in case['events'] if e.get('type') == 'examination' and e.get('agent') == enrich.role(case, 'examiner')), None)
    if exam is None:
        raise ValueError('no examination event to word (generation must write it)')
    vname = next((p['name'] for p in case['people'] if p['id'] == victim), 'the deceased')
    vaddr = next((p.get('address') or p['name'] for p in case['people'] if p['id'] == victim), 'the body')
    w0, w1 = q['crime']['window']
    death = next((e for e in case['events'] if (e.get('type') == 'death' or e.get('kind') == 'death') and e.get('agent') == victim), None)
    delayed = bool(death and death['start'] - crime['end'] > 45)
    method = (case.get('answer') or {}).get('method')
    for _ in range(3):
        out = llm_json(MEDICAL, json.dumps({'fatal_event': crime.get('summary'), 'delayed': delayed, 'method': method,
                                            'victim': vname}), 800, model=CRITIC_MODEL)
        notes, says = str(out.get('notes') or '').strip(), str(out.get('says') or '').strip()
        if not notes or not says or '{window}' not in says or (delayed and '{death}' not in says) or re.search(r'\d', notes + says):
            continue
        if not delayed and '{death}' in notes + says:
            continue
        if delayed and re.search(r'shortly before (his |her )?death', notes + says, re.I):
            continue
        fill = lambda t: t.replace('{window}', f"between {clock_words(w0)} and {clock_words(w1)}").replace(
            '{death}', clock_words(death['start']) if death else '')
        notes, says = fill(notes), fill(says)
        mine = set(vname.split())
        others = [w for p in case['people'] if p['id'] != victim for w in p['name'].replace('Dr ', '').split() if w not in mine]
        if any(re.search(rf'\b{re.escape(w)}\b', notes + says) for w in others):
            continue
        break
    else:   # the model's text failed the checks three times: the doctor's findings are written by code
        cause = {'poison': 'a poison taken by mouth', 'blow': 'a heavy blow to the head', 'fall': 'injuries from a fall',
                 'smother': 'suffocation', 'drown': 'drowning', 'blade': 'a stab wound', 'gun': 'a gunshot wound',
                 'gas': 'breathing gas or fumes', 'staged': 'injuries made to look like an accident'}.get(method, 'unnatural causes')
        span = f"between {clock_words(w0)} and {clock_words(w1)}"
        if delayed:
            says = f"Death came at about {clock_words(death['start'])}, from {cause}, but it was taken some hours before that, {span}."
        else:
            says = f"Death was from {cause}, and it occurred {span}."
        notes = f"Examination of the deceased shows {cause}. " + says
    with SIGNS:
        case['signs'][:] = [x for x in case['signs'] if not x.get('medical')]
    claim = {'pred': 'crimeBetween', 'from': w0, 'to': w1}
    doctor = enrich.role(case, 'examiner')
    doctor = doctor if doctor != victim else None
    with SIGNS:
        home = next((p.get('home') for p in case['people'] if p['id'] == doctor), None)
        case['signs'].insert(0, {'id': 's_medical', 'kind': 'record', 'medical': True, 'medical_v': MEDICAL_V, 'source': exam['id'],
                                 'at': home or q['crime']['place'],
                                 'title': 'The doctor\u2019s examination notes', 'text': notes, 'claim': claim})
        if doctor:
            case['signs'].insert(1, {'id': f's_medical_{doctor}', 'kind': 'testimony', 'medical': True, 'medical_v': MEDICAL_V,
                                     'speaker': doctor, 'source': exam['id'], 'claim': claim, 'title': f"{next(p['address'] or p['name'] for p in case['people'] if p['id'] == doctor)} on the body", 'text': says,
                                     'ask': f"Doctor, what did you find when you examined {vaddr}?"})
    return 1


LIVE = f'{OUT}/live'
# Briefs for on-demand generation: (title, public premise, where the body is found, brief for the generator).
LIVE_BRIEFS = [
    ('The Study Door', 'Edmund Vale is found dead in his study at Vale Manor.', 'manor',
     'Edmund Vale is found dead in his study at Vale Manor. Question: who killed him? The culprit is not the person the village first suspects.'),
    ('A Supper at Vale Manor', 'Edmund Vale died in the night, after supper at Vale Manor.', 'manor',
     'Edmund Vale dies in the night after a supper at Vale Manor; the doctor suspects poison. Question: who poisoned him?'),
    ('The Greenhouse Steps', 'Edmund Vale was found at the foot of the greenhouse steps.', 'greenhouse',
     'Edmund Vale is found at the foot of the greenhouse steps, apparently a fall. Question: who caused his death? Someone in the village is protecting the culprit.'),
    ('The Vestry Will', 'Edmund Vale was found dead in St. Alden\u2019s vestry.', 'vestry',
     'Edmund Vale is found dead in St. Alden\u2019s vestry, where he had gone to amend his will. Question: who killed him? An old wrong from twenty years ago is behind it.'),
    ('The Back Parlour', 'Edmund Vale collapsed and died in the back parlour of the Rook & Lantern.', 'inn',
     'Edmund Vale collapses and dies in the back parlour of the Rook & Lantern. Question: who killed him? More than one person lies that night, for different reasons.'),
    ('The Surgery Night', 'Edmund Vale was found dead outside Dr Marsh\u2019s surgery.', 'surgery',
     'Edmund Vale is found dead on the step of Dr Marsh\u2019s surgery, where he had gone late at night. Question: who killed him? The person with the most obvious motive did not do it.'),
    ('Market Morning', 'Edmund Vale was found dead in the village square at first light.', 'square',
     'Edmund Vale is found dead in the village square at first light. Question: who killed him? Two people saw something and each misunderstood it.'),
]


EVENINGS = """For each person in a 1920s English village mystery you get who they are, where they live, what they know of their
own life, and the places in the village. The case's history gives them no evening yesterday. Give each an ordinary
evening: one place they were (their home or their work, or a public place a person like them would go), and one plain
sentence of what they did there. Nothing to do with the crime; name nobody else, not even by role ("the innkeeper"); no clock times. Also the plain wish that
took them there. Return {"evenings": {"<id>": {"place": "<place id>", "summary": "<sentence>", "intent": "<wish>"}}}."""


def add_ordinary_evenings(case, log=lambda *a: None):
    """Everyone in the case has something true to say about last night (premise.evening_errors, the generator's own
    rule). A case that leaves someone without an evening (made before the rule, or the constable) gets an ordinary one
    from a model: one event and the intention behind it, at a real place. It is kept only if the case still certifies
    with the identical solve (depth, every thread, the surface, the false accounts), so it can never touch the puzzle."""
    from refine import llm_json, CRITIC_MODEL
    import premise
    # an ordinary evening names nobody else: not by name, address or role (the innkeeper is a person in the case)
    def words(q):
        out = [*str(q.get('name', '')).split(), str(q.get('address', '')).split()[-1] if q.get('address') else '', *(q.get('role_words') or [])]
        return {w.lower() for w in out if len(w) > 2 and w not in ('The', 'Reverend', 'Thomas')}
    def names_someone(pid, text):
        others = set().union(*[words(q) for q in premise.SETTING.get('people', []) if q['id'] != pid]) - words(premise.PEOPLE.get(pid, {}))
        return any(re.search(r'\b' + re.escape(w) + r'\b', text.lower()) for w in others)
    for ev in [e for e in case['events'] if e.get('ordinary') and names_someone(e['agent'], e.get('summary', ''))]:
        with SIGNS:
            case['events'].remove(ev)
            case['attitudes'] = [x for x in case['attitudes'] if x['id'] != ev.get('causedBy')]
            case['signs'][:] = [x for x in case['signs'] if not (x.get('surface') and x.get('speaker') == ev['agent'])]
    need = sorted({m.split()[1] for m in premise.evening_errors(case)})
    people = {p['id']: p for p in case['people']}
    setting = {p['id']: p for p in premise.SETTING.get('people', [])}
    need = [pid for pid in need if pid in people or pid in setting]
    if not need:
        return 0
    day = case['setting']['day']
    places = {p['id']: p['name'] for p in case['setting']['places']}
    items = [{'id': pid, 'name': (people.get(pid) or setting.get(pid, {})).get('name', pid), 'role': setting.get(pid, {}).get('role'),
              'home': setting.get(pid, {}).get('home'), 'knows_of_own_life': (case.get('knowledge') or {}).get(pid, [])} for pid in need]
    out = llm_json(EVENINGS, json.dumps({'places': places, 'people': items}), 1500, model=CRITIC_MODEL).get('evenings', {})
    before, n = _solve_shape(case), 0
    for pid in need:
        v = out.get(pid) or {}
        place, summary, intent = v.get('place'), str(v.get('summary', '')).strip(), str(v.get('intent', '')).strip()
        if place not in places or not summary or not intent or re.search(r'\d', summary) or names_someone(pid, summary):
            continue
        att = {'id': f'a_{pid}_evening', 'agent': pid, 'mode': 'intends', 'content': intent, 'strength': 0.6}
        ev = {'id': f'e_{pid}_evening', 'type': 'routine', 'agent': pid, 'others': [], 'place': place, 'start': day['evening'],
              'end': min(day['morning'], day['evening'] + 300), 'causedBy': att['id'], 'summary': summary, 'ordinary': True}
        with SIGNS:
            case['attitudes'].append(att); case['events'].append(ev)
            if pid not in people and pid in setting:
                case['people'].append({'id': pid, 'name': setting[pid]['name']})
        if _solve_shape(case) == before:
            n += 1
        else:                                   # it would change the puzzle (a new witness, an alibi): not added
            with SIGNS:
                case['attitudes'].remove(att); case['events'].remove(ev)
            log(f'  evening for {pid} at {place} changes the solve: not added')
    return n


DECLINES_VERSION = 3   # 2: they close the topic, never suggest a secret or send the detective on; 3: never deny anything
DECLINES = """For each person in a 1920s English village mystery you get their voice and character. Write four short ways
(at most 16 words each) in which they would tell the detective that they have nothing to tell on what was asked: they
cannot say, have nothing to tell about it, or have nothing more to add on it. In their own voice and manner, all four
different, each plainly closing the subject. They must not suggest they are keeping something back (no "I'd rather not
say", no "that's private"), and must not send the detective to anyone or anywhere. Each must state no fact at all: no
place, time, person, event, object or reason that is a fact (not "I was at home", not "ask the vicar"), and no denial
(not "I saw nothing", not "nobody came by", not "it never crossed my counter"): what they did or did not see is in the
history, not in a decline.
Return {"declines": {"<id>": ["...", ...]}}."""

NO_FACT = """For each line, decide whether it states or implies any fact about the world: a place, a time, a person, an event,
an object, or a reason that is a fact. A denial that something happened, was seen, noticed or recorded ("I saw nothing",
"nothing passed my counter") states a fact. Saying one cannot say, has nothing to tell or nothing more to add, or a
feeling, is not a fact.
Return {"verdicts": {"<id>": [true | false, ...]}} with true where the line states NO fact, in order."""


def _field(obj, key):
    """obj[key], tolerating the shapes models return: the key nested twice ({"verdicts": {"verdicts": ...}}) or its value
    encoded as a JSON string."""
    v = obj.get(key) if isinstance(obj, dict) else None
    while isinstance(v, dict) and set(v) == {key}:
        v = v[key]
    if isinstance(v, str) and v.strip()[:1] in '{[':
        try:
            v = json.loads(v)
        except ValueError:
            pass
    return v if v is not None else {}


def add_declines(case):
    """case['declines'][pid]: four in-voice ways of saying there is nothing to tell on a question, so a turn the critics
    rejected ends in character instead of the same stock line for everyone. They close the subject: a decline that hints
    at a secret makes players press the same person (epoch 1). Wording only: code rejects digits and
    any name; a model drops any line that states a fact."""
    from refine import llm_json, CRITIC_MODEL
    import premise
    setting = {q['id']: q for q in premise.SETTING.get('people', [])}
    if case.get('declines_version') != DECLINES_VERSION:
        case['declines'] = {}                          # written to an older brief: write them again
    have = case.get('declines') or {}
    people = [p['id'] for p in case['people'] if p['id'] != enrich.victim_of(case) and p['id'] not in have]
    roles = (case.get('setting') or {}).get('roles') or {}
    people += [r for r in roles.values() if r not in people and r not in have]
    if not people:
        return 0
    items = [{'id': pid, 'name': setting.get(pid, {}).get('name', pid), 'voice': setting.get(pid, {}).get('voice'),
              'role': setting.get(pid, {}).get('role')} for pid in people]
    out = _field(llm_json(DECLINES, json.dumps(items), 2500, model=CRITIC_MODEL), 'declines')
    names = {w.lower() for q in setting.values() for w in str(q.get('name', '')).split() + [str(q.get('address', '')).split()[-1] if q.get('address') else '']
             if len(w) > 2 and w not in ('The', 'Reverend')}
    clean = {pid: [str(x).strip() for x in (_field(out, pid) or []) if isinstance(x, str) and str(x).strip()
                   and not re.search(r'\d', x) and len(str(x).split()) <= 16
                   and not any(re.search(r'\b' + re.escape(w) + r'\b', str(x).lower()) for w in names)] for pid in people}
    clean = {pid: lines for pid, lines in clean.items() if lines}
    if not clean:
        return 0
    verdicts = _field(llm_json(NO_FACT, json.dumps(clean), 1500, model=CRITIC_MODEL), 'verdicts')
    case.setdefault('declines', {})
    case['declines_version'] = DECLINES_VERSION
    n = 0
    for pid, lines in clean.items():
        ok = _field(verdicts, pid) if isinstance(_field(verdicts, pid), list) else []
        kept = [x for x, v in zip(lines, ok) if v is True or str(v).lower() == 'true']
        if kept:
            case['declines'][pid] = kept; n += 1
    return n


def prune_people(case):
    """People the true history never mentions have nothing true to say about the night, so they are not part of the
    case (premise.involved, the same definition the generator's evening rule uses). Returns the ids removed."""
    import premise
    keep = premise.involved(case)
    gone = [p['id'] for p in case['people'] if p['id'] not in keep]
    case['people'] = [p for p in case['people'] if p['id'] not in gone]
    return gone


def enrich_case(case, log=print):
    """Publishing adds only WORDING to a certified case: the history is the only source of facts.
    Questions, evening summaries (claimless, of the speaker's own events), the examination's notes and account (worded
    from the examination event), the answer's method and motive, concessions, everyday facts, moods, show lines and
    reactions. Then everything written is reviewed against the true history and faulty lines are dropped."""
    missing = __import__('premise').morning_errors(case)
    if missing:
        raise ValueError('the case has no morning to word: ' + '; '.join(missing))
    removed = prune_people(case)                       # nobody the history never mentions is in the case
    if removed:
        log(f'  not in the history, so not in the case: {removed}')
    add_ordinary_evenings(case, log)                   # everyone in the case has an evening (certified solve-neutral)
    enrich.add_answer(case)                            # the examination wording depends on the method
    enrich.add_accepted(case)                          # every answer the player's evidence fairly supports
    # These phases all read or mutate the shared sign list, often across a model call. Keep them ordered so each
    # phase sees a complete predecessor state. Running in the caller also preserves the active provenance context.
    for operation in (add_surface_accounts, add_morning_accounts, add_medical, add_concessions,
                      enrich.add_knowledge, enrich.add_moods, add_show_lines, enrich.add_art):
        operation(case)
    for operation, args in ((mark_surface_truth, (case,)),
                            (add_questions, (case, case.get('synopsis', ''))),
                            (add_reactions, (case,))):
        operation(*args)
    add_sightings(case, log)                           # who saw whom, read from the history, certified solve-neutral
    record_contradictions(case, log)                   # a contradiction the player can see is one the case records
    add_declines(case)                                 # in-voice ways to decline, stating no fact
    add_show_lines(case)                               # lines for accounts added above
    enrich.add_art(case)                               # pictures for any clue added above
    enrich.add_unlock_groups(case)                     # leads that open together share one opening line
    for round_ in range(2):
        problems = enrich.review_publish(case)
        if problems:
            log(f'  review round {round_ + 1}: {len(problems)} lines dropped: ' + '; '.join(f'{k}: {v}' for k, v in list(problems.items())[:4]))
        if not problems:
            break
        add_medical(case); add_concessions(case); add_show_lines(case); add_reactions(case)
    finish_wording(case)
    return case


def finish_wording(case, rounds=3):
    """Last over the wording, after every step that writes it: lines that do not say what their clue says are written
    again (each line is kept only once checked against its clue's text), and forms of address no one answers to are put
    right where the person meant is plain."""
    for _ in range(rounds):
        if not check_lines(case):
            break
        add_show_lines(case)
    return correct_addresses(case)


def prepare_experiment_case(case, brief_entry, stamp):
    """Apply publish-time wording in memory without writing a playable case or mutating premise history."""
    title, blurb, place, _ = brief_entry
    case = json.loads(json.dumps(case))
    case['id'] = f'experiment-{stamp}'
    pr = case.get('premise')
    if pr:
        case['answer'] = {'method': pr['method'], 'motive': pr['motive']}
        case['victim'] = pr['victim']
        title = str(case.get('title') or '').strip()[:60] or title
        name_words = {w for p in case['people'] for w in p['name'].split()} - {'The', 'Reverend', 'Dr', 'Mr', 'Mrs', 'Miss', 'Constable'}
        if set(re.findall(r"[A-Za-z]+", title)) & name_words:
            import premise as P
            where = P.at(place)
            title = 'Death at ' + (' '.join(w[:1].upper() + w[1:] if i else w for i, w in enumerate(where.split())) if where.startswith('the ') else where)
    case['title'] = title
    vname = next((p['name'] for p in case['people'] if p['id'] == enrich.victim_of(case)), 'Edmund Vale')
    case['synopsis'] = blurb if case['question']['crime'].get('place') == place else f'{vname} is dead.'
    enrich_case(case)
    return case


def _live_transaction_path():
    return os.path.join(LIVE, '.publication-transaction.json')


def _quarantine_marker(transaction_path, reason):
    """Move a recovery marker that cannot be trusted aside (kept for inspection) so it never blocks publication."""
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    rejected = os.path.join(os.path.dirname(transaction_path), f'.publication-transaction.rejected-{stamp}.json')
    pubio.durable_rename(transaction_path, rejected)
    print(f'WARNING: live publication recovery marker rejected ({reason}); moved to {rejected}. Any case file it '
          'names stays unindexed; publication continues.', file=sys.stderr)


def _recover_live_publication_locked():
    """Finish an interrupted index-last live commit while the shared publication lock is held.

    Only a marker that names a case file whose identity and hash match it is finished. Any other marker (unreadable,
    malformed, or naming a different file) is quarantined: the case it names is left unindexed and publication goes
    on, since refusing would block every later publication on a file no one can vouch for. A corrupt premise history
    still raises (premise._history says how to recover): the marker stays, so the commit finishes on the next run."""
    transaction_path = _live_transaction_path()
    if not os.path.exists(transaction_path):
        return None
    try:
        transaction = _read_json(transaction_path)
    except ValueError as error:
        return _quarantine_marker(transaction_path, f'unreadable: {error}')
    entry = transaction.get('entry') if isinstance(transaction, dict) else None
    filename = transaction.get('case_file') if isinstance(transaction, dict) else None
    if (not isinstance(entry, dict) or transaction.get('version') != 1 or not isinstance(filename, str) or
            os.path.basename(filename) != filename or not isinstance(entry.get('id'), str) or
            entry.get('file') != f'live/{filename}' or not isinstance(transaction.get('case_sha256'), str)):
        return _quarantine_marker(transaction_path, 'invalid marker')
    path = os.path.join(LIVE, filename)
    if not os.path.exists(path):
        pubio.durable_unlink(transaction_path)  # interrupted before the case became visible
        return None
    try:
        case = _read_json(path)
    except ValueError:
        case = None
    if not isinstance(case, dict) or case.get('id') != entry['id'] or provenance.sha256(case) != transaction['case_sha256']:
        return _quarantine_marker(transaction_path, f'{filename} does not match its identity or hash')
    premise_record = transaction.get('premise')
    if premise_record:
        import premise as P
        P.remember(premise_record, publication_id=entry['id'], lock_held=True)
    idx_path = os.path.join(LIVE, 'index.json')
    index = _read_json(idx_path) if os.path.exists(idx_path) else []
    index = [entry] + [item for item in index if item.get('id') != entry['id']]
    _atomic_json(idx_path, index[:30])             # index is always the visibility commit
    pubio.durable_unlink(transaction_path)
    return entry


def recover_live_publication():
    """Reconcile an orphan case left by an interrupted live publication."""
    os.makedirs(LIVE, exist_ok=True)
    with pubio.publication_lock(os.path.dirname(LIVE)):
        return _recover_live_publication_locked()


def _commit_live_case(case, entry, premise_record=None):
    """Commit case, premise history, then index under one lock with recovery metadata. A new publication never
    replaces a published case: a reused stamp is refused."""
    os.makedirs(LIVE, exist_ok=True)
    filename = f"{case['id']}.json"
    path = os.path.join(LIVE, filename)
    marker = {'version': 1, 'case_file': filename, 'case_sha256': provenance.sha256(case),
              'entry': entry, 'premise': premise_record}
    with pubio.publication_lock(os.path.dirname(LIVE)):
        _recover_live_publication_locked()
        if os.path.exists(path):
            raise ValueError(f'{filename} is already published; a live case is never overwritten')
        _atomic_json(_live_transaction_path(), marker)
        _atomic_json(path, case)
        _require_on_disk(path, marker['case_sha256'])   # the marker stays, so a failure here is recoverable
        if premise_record:
            import premise as P
            P.remember(premise_record, publication_id=case['id'], lock_held=True)
        idx_path = os.path.join(LIVE, 'index.json')
        index = _read_json(idx_path) if os.path.exists(idx_path) else []
        index = [entry] + [item for item in index if item.get('id') != case['id']]
        _atomic_json(idx_path, index[:30])         # index-last: never advertise an absent case
        pubio.durable_unlink(_live_transaction_path())
    return path


def publish_live(case, brief_entry, stamp, strict_publication_review=False):
    """Publish a generated case; deterministic checks block and strict critic enforcement is opt-in."""
    title, blurb, place, _ = brief_entry
    case = json.loads(json.dumps(case))
    case['id'] = f'mk-live-{stamp}'
    if os.path.exists(os.path.join(LIVE, f"{case['id']}.json")):   # fail before enrichment; the commit checks again
        raise ValueError(f"{case['id']} is already published; a live case is never overwritten")
    pr = case.get('premise')
    if pr:   # the premise deck fixed who, how and why: the answer is known, the title comes from the story
        case['answer'] = {'method': pr['method'], 'motive': pr['motive']}
        case['victim'] = pr['victim']
        title = str(case.get('title') or '').strip()[:60] or title
        # a title must not name anyone (it would give a suspect away): whole words, not honorifics or articles
        name_words = {w for p in case['people'] for w in p['name'].split()} - {'The', 'Reverend', 'Dr', 'Mr', 'Mrs', 'Miss', 'Constable'}
        if set(re.findall(r"[A-Za-z]+", title)) & name_words:
            import premise as P
            where = P.at(place)
            title = 'Death at ' + (' '.join(w[:1].upper() + w[1:] if i else w for i, w in enumerate(where.split())) if where.startswith('the ') else where)
    case['title'] = title
    # the premise may only state what the case records: fall back to a neutral line if the crime moved elsewhere
    vname = next((p['name'] for p in case['people'] if p['id'] == enrich.victim_of(case)), 'Edmund Vale')
    case['synopsis'] = blurb if case['question']['crime'].get('place') == place else f'{vname} is dead.'
    enrich_case(case)
    target = case.pop('difficulty_target', None)
    if target is None:
        target = (case.get('difficulty') or {}).get('target')
    case, g = _review_gate_rate(case, target, strict_publication_review)
    r = g['js']
    entry = {'id': case['id'], 'file': f"live/{case['id']}.json", 'title': title, 'solveDepth': r['solveDepth'],
             'blurb': f"{case['synopsis']} Depth {r['solveDepth']}, {len(case['signs'])} clues, {len(case['question']['candidates'])} suspects.",
             'generated': stamp, 'difficulty': difficulty.index_rating(case['difficulty'])}
    _commit_live_case(case, entry, pr)
    return entry, r


def enrich_live(strict_publication_review=False):
    """Re-enrich the indexed live cases through deterministic publication, optionally enforcing a strict critic
    verdict. Files the index no longer lists (truncated away) are left alone. Each case is written only if it is
    unchanged on disk since it was read (optimistic concurrency: enrichment runs outside the lock), and one case's
    failure never stops the next."""
    root, idx_path = os.path.dirname(LIVE), os.path.join(LIVE, 'index.json')
    with pubio.publication_lock(root):
        _recover_live_publication_locked()
        listed = _read_json(idx_path) if os.path.exists(idx_path) else []
    for listed_entry in listed:
        name = os.path.basename(str(listed_entry.get('file') or ''))
        path = os.path.join(LIVE, name)
        try:
            case = _read_json(path)
            read_sha256 = provenance.sha256(case)
            enrich_case(case)
            a = sum(1 for x in case['signs'] if x.get('show')); b = sum(len(x.get('reactions') or {}) for x in case['signs'])
            target = (case.get('difficulty') or {}).get('target')
            saved, _ = _review_gate_rate(case, target, strict_publication_review)
            with pubio.publication_lock(root):
                _recover_live_publication_locked()
                if disk_sha256(path) != read_sha256:
                    print(f'  {name} NOT saved: it changed on disk while it was enriched; run again')
                    continue
                index = _read_json(idx_path) if os.path.exists(idx_path) else []
                if not any(entry.get('id') == saved.get('id') for entry in index):
                    print(f'  {name} NOT saved: the index no longer lists it')
                    continue
                _atomic_json(path, saved)
                for entry in index:
                    if entry.get('id') == saved.get('id'):
                        entry['difficulty'] = difficulty.index_rating(saved['difficulty'])
                _atomic_json(idx_path, index)         # case first, matching index metadata last
        except Exception as error:   # a model, gate or I/O failure on one case must not stop the others
            print(f'  {name} NOT saved: {type(error).__name__}: {error}')
            continue
        print(f'enriched {name}: {a} show lines, {b} reactions')


def js_certify_obj(case):
    import tempfile
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump(case, f)
    try:
        return js_certify([f.name])[0]['ok']
    finally:
        os.remove(f.name)


CARRY_SIGN_KEYS = ('ask', 'show', 'confront', 'reactions', 'concede', 'surface_checked')
CARRY_CASE_KEYS = ('answer', 'reviewed', 'knowledge', 'moods', 'victim', 'premise')


def carry_over(case, prev):
    """Keep what publishing already wrote for this exact case: added signs and per-sign lines."""
    added = [x for x in prev['signs'] if (x.get('surface') or x.get('morning') or x.get('sighting') or x.get('medical'))
             and not any(y['id'] == x['id'] for y in case['signs'])]
    case['signs'] = added + case['signs']

    old = {x['id']: x for x in prev['signs']}
    for x in case['signs']:
        o = old.get(x['id'], {})
        for k in CARRY_SIGN_KEYS:
            if o.get(k) and not x.get(k):
                x[k] = o[k]
        if o.get('surface_checked'):
            x['deceptive'] = o.get('deceptive')
    for k in CARRY_CASE_KEYS:
        if prev.get(k) is not None and case.get(k) is None:
            case[k] = prev[k]
    return case


def main(strict_publication_review=False):
    best = {}
    for brief in CASE_TITLES:
        files = sorted(glob.glob(f'{HERE}/runs/*/{brief}/final-case.json'))
        if not files:
            continue
        for f, r in zip(files, js_certify(files)):
            if r['ok'] and (brief not in best or (r['solveDepth'], len(_read_json(f)['signs'])) > best[brief][1]):
                best[brief] = (f, (r['solveDepth'], len(_read_json(f)['signs'])), r)
    os.makedirs(OUT, exist_ok=True)
    index_path = f'{OUT}/index.json'
    prepared, not_replaced = {}, {}     # brief -> (path, case, entry, report, source); brief -> why it was not
    for brief in sorted(CASE_TITLES):
        if brief not in best:
            not_replaced[brief] = 'no certified run'
            continue
        f = best[brief][0]
        case = _read_json(f)
        title, blurb = CASE_TITLES[brief]
        case['id'], case['title'], case['synopsis'] = f'mk-{brief}', title, blurb
        path = f'{OUT}/mk-{brief}.json'
        previous_case = _read_json(path) if os.path.exists(path) else None
        if previous_case:
            carry_over(case, previous_case)
        enrich_case(case)
        target = case.pop('difficulty_target', None)
        if target is None:
            target = ((case.get('difficulty') or {}).get('target') or
                      ((previous_case or {}).get('difficulty') or {}).get('target'))
        try:
            case, g = _review_gate_rate(case, target, strict_publication_review)
        except ValueError as error:
            not_replaced[brief] = str(error)
            continue
        r = g['js']
        entry = {'id': case['id'], 'file': f'mk-{brief}.json', 'title': title,
                 'blurb': f"{blurb} Depth {r['solveDepth']}, {len(case['signs'])} clues, {len(case['question']['candidates'])} suspects.",
                 'solveDepth': r['solveDepth'], 'source': os.path.relpath(f, ROOT),
                 'difficulty': difficulty.index_rating(case['difficulty'])}
        prepared[brief] = (path, case, entry, r, f)
    kept = {}
    with pubio.publication_lock(OUT):
        if os.path.dirname(LIVE) == OUT and os.path.exists(_live_transaction_path()):
            _recover_live_publication_locked()
        for path, case, _, _, _ in prepared.values():
            _atomic_json(path, case)
        for path, case, _, _, _ in prepared.values():
            _require_on_disk(path, provenance.sha256(case))   # every advertised file reads back before the index
        # Entries not replaced come from the index as it is now, not as it was read before enrichment: another
        # maintenance run (difficulty, backfill) may have updated them meanwhile. One whose file is gone is dropped.
        current = _read_json(index_path) if os.path.exists(index_path) else []
        on_disk = {entry.get('id'): entry for entry in current}
        index = []
        for brief in sorted(CASE_TITLES):
            if brief in prepared:
                index.append(prepared[brief][2])
            elif brief in not_replaced:
                old = on_disk.get(f'mk-{brief}')
                if old and old.get('file') and os.path.isfile(os.path.join(OUT, old['file'])):
                    index.append(old)
                    kept[brief] = 'kept previous index entry'
                elif old:
                    kept[brief] = 'previous index entry dropped: its file is gone'
        _atomic_json(index_path, index)          # index-last batch commit
    for brief, reason in not_replaced.items():
        if brief in kept:
            print(f'  mk-{brief} NOT replaced ({reason}); {kept[brief]}')
        elif reason != 'no certified run':      # a brief that never had a run and never had a case is not news
            print(f'  mk-{brief} NOT published ({reason}); no previous entry to keep')
    for brief, (_, case, _, r, source) in prepared.items():
        print(f"published mk-{brief}: depth {r['solveDepth']}, pillars {r['pillars']}, {len(case['signs'])} clues <- {os.path.relpath(source, ROOT)}")
    print(f'{len(prepared)} written, {len(index)} cases in {os.path.relpath(OUT, ROOT)}/index.json')


if __name__ == '__main__':
    strict_review = '--strict-publication-review' in sys.argv
    enrich_live(strict_review) if '--live' in sys.argv else main(strict_review)
