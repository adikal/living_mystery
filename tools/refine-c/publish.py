"""Publish generated Bellweather cases for the game: for each brief, take the deepest case that the JS kernel
certifies (across every run), give it a stable id and title, and write dist/cases/generated/{id}.json + index.json."""
import copy, datetime, glob, json, os, re, subprocess, sys, tempfile, time
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
PUBLICATION_REVIEW_VERSION = 'whole-case-publication-review-v3'
PUBLICATION_REVIEW_SCHEMA_VERSION = 'whole-case-publication-review-schema-v1'
PUBLICATION_CERTIFICATE_VERSION = 'publication-review-certificate-v2'
PUBLICATION_REVIEW_PROMPT = """You are the final independent publication reviewer for a complete 1932 English village mystery.
The deterministic logic, timing, reachability and uniqueness checks are separate and their outcome is hidden from you.
Integer times are minutes after midnight, not HHMM: 1320 means 22:00. Values above 1440 are on the next day;
for example, 1770 means 05:30 the next day. Convert every integer time this way before comparing chronology or prose.
Judge the WHOLE case only for common-sense plausibility, fairness and craft. Fail if any material problem remains:
- LOCK: obtaining a prerequisite would not naturally lead the detective to the gated clue; or the reason a person
  withholds a clue does not cover that clue (a doctor's confidence to a living patient never covers the dead man's
  effects or her notes on his body); or a clue someone hands over is placed somewhere they are not.
- BOTTLENECK: one narrow reason (a confidence, a promise, a locked drawer) holds back several unrelated kinds of evidence,
  so the case's depth comes from one arbitrary door rather than from the story.
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
PUBLICATION_REVIEW_CHECKS = ('LOCK', 'BOTTLENECK', 'READING', 'CHARACTER', 'LOOSE END', 'GIVEAWAY', 'CONTRADICTION', 'FAIRNESS', 'CRAFT')
# Blinding removes labels that reveal a requested experimental level. They remain in the candidate hash when present.
PUBLICATION_REVIEW_BLIND_FIELDS = ('id', 'difficulty', 'difficulty_target', 'publication_review')
# Author-side text the game never shows the player: the generator's one-paragraph summary of what really happened.
# Reviewers read it as a player-facing blurb and fail it as a giveaway (Last Train, October 25), and no repair can
# change it. It stays in the candidate hash; the history it summarises is in the events.
PUBLICATION_REVIEW_AUTHOR_FIELDS = ('story',)
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
    for key in PUBLICATION_REVIEW_BLIND_FIELDS + PUBLICATION_REVIEW_AUTHOR_FIELDS:
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


# The whole-case review as a panel: one reviewer per group of checks, each asked twice, all at once, and every issue any
# of them finds is kept. One reviewer asked every question misses what a reviewer asked one question finds (a leaked
# lock in The Iron Hound), and the same reviewer flags an issue in one run and passes it in the next. Each lens prompt is
# cut from PUBLICATION_REVIEW_PROMPT (which the certificate binds), so the checks are written once.
REVIEW_PANEL = os.environ.get('LM_REVIEW_PANEL', '1') == '1'
REVIEW_VOTES = int(os.environ.get('LM_REVIEW_VOTES', '2'))
REVIEW_LENSES = (('gates', ('LOCK', 'BOTTLENECK', 'READING')), ('facts', ('CONTRADICTION',)),
                 ('people', ('CHARACTER', 'LOOSE END')), ('player', ('GIVEAWAY', 'FAIRNESS')), ('craft', ('CRAFT',)))
_JUDGE_LINE = 'Judge the WHOLE case only for common-sense plausibility, fairness and craft. Fail if any material problem remains:'


def lens_prompt(checks):
    """PUBLICATION_REVIEW_PROMPT narrowed to some of its checks: the same preamble and reply format, only those bullets."""
    lines = PUBLICATION_REVIEW_PROMPT.split('\n')
    first = next(i for i, l in enumerate(lines) if l.startswith('- '))
    last = max(i for i, l in enumerate(lines) if l.startswith('- ') or (l.startswith('  ') and i > first))
    bullets, current = [], None
    for l in lines[first:last + 1]:
        if l.startswith('- '):
            current = l[2:].split(':', 1)[0]
        if current in checks:
            bullets.append(l)
    head = [l if l != _JUDGE_LINE else
            (f"Judge the WHOLE case, but only for {', '.join(checks)}: other reviewers check everything else, so report "
             "nothing else. Fail if any material problem of these kinds remains:") for l in lines[:first]]
    return '\n'.join(head + bullets + ['Minor, borderline, optional-subplot, stylistic or taste concerns must pass and must not '
                                        'appear as fail issues.'] + lines[last + 1:])


def publication_critic(case):
    """The whole-case review: the panel of narrow reviewers (REVIEW_PANEL), or the single reviewer."""
    if not REVIEW_PANEL:
        return _publication_critic(case, PUBLICATION_REVIEW_PROMPT, 'final-whole-case-publication-critic')
    import concurrent.futures as cf
    import refine
    jobs = [(lens, checks, vote) for lens, checks in REVIEW_LENSES for vote in range(REVIEW_VOTES)]
    with cf.ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        futures = [provenance.submit_with_context(pool, _publication_critic, case, lens_prompt(checks), f'whole-case-review:{lens}')
                   for lens, checks, _ in jobs]
        outcomes = [f.result() for f in futures]
    return combine_reviews(outcomes, [f'{lens}.{vote + 1}' for lens, _, vote in jobs])


def combine_reviews(outcomes, names):
    """Every issue any reviewer found (one per record and check); FAIL if any, else UNAVAILABLE if any reviewer could not
    answer, else PASS."""
    import refine
    issues, seen = [], set()
    for o in outcomes:
        for issue in o.issues:
            parts = [p.strip().upper() for p in issue.split(':', 2)]
            key = tuple(parts[:2])
            if key not in seen:
                seen.add(key); issues.append(issue)
    if issues:
        status = refine.CriticStatus.FAIL
    elif any(o.status is not refine.CriticStatus.PASS for o in outcomes):
        status = refine.CriticStatus.UNAVAILABLE
    else:
        status = refine.CriticStatus.PASS
    return refine.CriticOutcome(status, tuple(issues[:24]), {n: o.raw_response for n, o in zip(names, outcomes)},
                                tuple(a for o in outcomes for a in o.attempts), tuple(r for o in outcomes for r in o.request_ids),
                                refine.REVIEW_MODEL)


def _publication_critic(case, system, purpose):
    """One typed whole-case review operation; only a reasonless fail receives the normal single semantic retry."""
    import refine
    prompt = json.dumps(_publication_prompt_case(case), ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    attempts = []
    for semantic_attempt in range(2):
        try:
            # the review model at its own effort, outside any lower effort set for wording (refine.REVIEW_MODEL)
            with refine.effort(None):
                response = refine.llm_json_audited(
                system,
                prompt,
                16000,   # it reads the whole case and thinks first: a small budget comes back empty
                model=refine.REVIEW_MODEL,
                schema=PUBLICATION_REVIEW_SCHEMA,
                audit_metadata={'purpose': purpose,
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


def reviewer_descriptor():
    """What reviewed a case, for its certificate: the panel (its lenses, votes and the hash of every lens prompt) or the
    single reviewer, and the author-side fields hidden from it. The prompt field alone cannot tell them apart."""
    import refine
    if not REVIEW_PANEL:
        return {'kind': 'single', 'model': refine.REVIEW_MODEL, 'hidden_author_fields': list(PUBLICATION_REVIEW_AUTHOR_FIELDS)}
    return {'kind': 'panel', 'model': refine.REVIEW_MODEL, 'votes': REVIEW_VOTES,
            'lenses': {lens: list(checks) for lens, checks in REVIEW_LENSES},
            'lens_prompts_sha256': provenance.sha256([lens_prompt(c) for _, c in REVIEW_LENSES]),
            'hidden_author_fields': list(PUBLICATION_REVIEW_AUTHOR_FIELDS)}


def _certificate(outcome, candidate_hash, timestamp=None, reviewer=None):
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
        **({'reviewer': reviewer} if reviewer else {}),
    }
    certificate['digest'] = provenance.sha256(certificate)
    return certificate


LAST_REVIEW_ISSUES = {}


def _register_judges():
    import refine
    refine.FULL_EFFORT.update({VISIBLE, LINES_AGREE, SURFACE_TRUTH, NO_FACT, AGREES, LEAK, SAME, REACT_CHECK, PROMISE, SAME_BUT, MEDICAL_AGREES,
                               PUBLICATION_REVIEW_PROMPT, *(lens_prompt(c) for _, c in REVIEW_LENSES), enrich.REVIEW, enrich.KNOW_CHECK})


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
    certificate = _certificate(outcome, candidate_hash, timestamp, reviewer_descriptor() if reviewer is None else {'kind': 'supplied'})
    LAST_REVIEW_ISSUES[candidate_hash] = tuple(outcome.issues)   # private findings, for repair in this process only
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


def claim_subject(c):
    """What a claim is about, for public knowledge that matters only alongside a clue: an item or a trait (kernel.mjs
    claimSubject)."""
    if not c:
        return None
    if c.get('item'):
        return f"item:{c['item']}"
    if c.get('trait') and c.get('pred') in ('hasTrait', 'culpritTrait'):
        return f"trait:{c['trait']}"
    return None


def held_back_public(case, A=None):
    """{public sign id: [trigger ids]} for public knowledge about an item or a trait that decides nothing until a clue about
    it is understood. The game records such a sign only when a trigger is understood (kernel.mjs heldBackPublic, which
    this mirrors): told at the start it would name a suspect before any such clue is found."""
    from refine import analyse, survivors, closure_dependent
    from claims import claim_of
    A = A or analyse(case)
    maxd = max(A['eff'].values()) if A['eff'] else 0
    out = {}
    for p in case['signs']:
        c = claim_of(p) if p.get('kind') == 'public' else None
        if not claim_subject(c) or p.get('defeats'):
            continue
        triggers = sorted(x['id'] for x in case['signs'] if x.get('kind') != 'public' and claim_subject(claim_of(x)) == claim_subject(c))
        if not triggers:
            continue
        without = frozenset().union(*(closure_dependent(case, t) for t in triggers))
        also = without | {p['id']}
        if all(sorted(survivors(case, A, d, without)) == sorted(survivors(case, A, d, also)) for d in [*range(maxd + 1), None]):
            out[p['id']] = triggers
    return out


def public_spoiler_errors(case):
    """Public knowledge shown at the start must not tie a suspect to the culprit: a public sign about an item or trait a
    culprit claim names is allowed only when the game can hold it back until a clue about it is understood."""
    from claims import claim_of
    culprit = {claim_subject(claim_of(x)) for x in case['signs']
               if (claim_of(x) or {}).get('pred') in ('culpritHad', 'culpritTrait')} - {None}
    held = held_back_public(case)
    return [f"public sign {p['id']} tells everyone about {claim_subject(claim_of(p))}, which a culprit clue tests, from the "
            f"start: carry it on a clue the player finds, or make it decide nothing until a clue about it is understood"
            for p in case['signs'] if p.get('kind') == 'public' and claim_subject(claim_of(p)) in culprit and p['id'] not in held]


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
    import roles
    errors = ([f'python: {error}' for error in py.get('errors', [])]
              + [f'js: {error}' for error in js.get('errors', [])]
              + z['errors'] + question_alias_errors(case) + public_spoiler_errors(case)
              # the constable is the detective's ally, and every red herring has a reason its subject can give
              + roles.ally_errors(case) + roles.examiner_errors(case) + roles.herring_errors(case))
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


SCRIPTED_GATE = os.environ.get('LM_SCRIPTED_GATE', '1') == '1'


def scripted_problems(case):
    """What scripted players (no model) find wrong with a case as the game will serve it: a hint-following player must
    solve it, and every testimony hint must give its account (tools/playtest/scripted.mjs). Seconds, and it catches what
    reviewers pass (a hint that asked the wrong question in The Iron Hound)."""
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump(case, f, ensure_ascii=False)
    try:
        out = subprocess.run(['node', f'{ROOT}/tools/playtest/gate.mjs', f.name], capture_output=True, text=True, timeout=300)
        if out.returncode:
            return [f'the scripted players could not run: {out.stderr.strip()[-300:]}']
        return json.loads(out.stdout)['problems']
    finally:
        os.unlink(f.name)


def _serialized_case(case, strict_publication_review=False):
    """Round-trip the exact served object and gate that representation before any write (strictly: also the scripted
    players)."""
    serialized = json.loads(json.dumps(case, ensure_ascii=False))
    post = gate(serialized, strict_publication_review=strict_publication_review)
    if not post['ok']:
        raise ValueError('the serialized published case failed certification: ' + '; '.join(post['errors'][:3]))
    if strict_publication_review and SCRIPTED_GATE:
        import timing
        with timing.phase('scripted players'):
            problems = scripted_problems(serialized)
        if problems:
            # kept for diagnosis (tools/playtest/gate.mjs <file> replays it); nothing is published
            kept = os.path.join(HERE, 'runs', 'scripted-rejected', f"{serialized.get('id', 'case')}.json")
            os.makedirs(os.path.dirname(kept), exist_ok=True)
            pubio.atomic_json(kept, serialized)
            raise ValueError('scripted players: ' + '; '.join(problems[:3]) + f' (the candidate is kept at {os.path.relpath(kept, ROOT)})')
    return serialized, post


WORDING_FIELDS = ('show', 'confront', 'direct', 'reactions', 'concede')
PUBLISH_REPAIRS = int(os.environ.get('LM_PUBLISH_REPAIRS', '3'))   # review -> repair -> review rounds at publication


WORDING_WORDS = re.compile(r"\b(reactions?|repl(y|ies)|show (line|prompt|text)s?|'show'|'confront'|'direct'|confront(s|ation)?|"
                           r"conce(de|des|ded|ssion|ssions)|the detective says|detective's line|lines?)\b", re.I)


def _wording_issue(x, why):
    """Whether a review issue on sign x is about what publishing wrote on it: it quotes words from those lines, or it
    names them (a reaction, a show line, a concession) and the sign has them."""
    written = ' '.join(json.dumps(x.get(f), ensure_ascii=False) for f in WORDING_FIELDS if x.get(f)).lower()
    if not written:
        return False
    quoted = [q for q in re.findall(r"['\u2018\u201c\"]([^'\u2019\u201d\"]{12,})['\u2019\u201d\"]", why) if len(q.split()) >= 3]
    if any(q.lower().strip(' .,') in written for q in quoted):
        return True
    return bool(WORDING_WORDS.search(why))


def repair_wording(case, issues):
    """What publishing can repair of what a failed review found: only its own words. An evening account it names is
    written again with the reviewer's reason; a morning account or a sighting it names is dropped (each is optional); a
    named line or reaction is dropped (play has a fallback). Anything else (a lock, a reading, the story itself) is the
    structure's, which publishing never touches. Returns (changed, unaddressed issues)."""
    signs = {x['id']: x for x in case['signs']}
    rewrite, unaddressed, drop, unword, relabel = {}, [], set(), set(), set()
    for issue in issues:
        sid, _, why = str(issue).partition(':')
        x = signs.get(sid.strip())
        if not x:
            unaddressed.append(issue)
        elif x.get('surface'):
            # an evening account is publishing's own words: written again with the reviewer's reason
            rewrite[x['speaker']] = {'text': x['text'], 'rejected_because': why.strip()[:300]}
        elif x.get('morning') or x.get('sighting'):
            drop.add(x['id'])
        elif _wording_issue(x, why):
            unword.add(x['id'])
        elif 'surface_checked' in x and not x.get('claim'):
            relabel.add(x['id'])            # publishing's honest/cover label on a claimless account: judged again
        else:
            unaddressed.append(issue)
    if unaddressed:   # the structure's problem: publishing changes nothing, and the review stands
        return False, unaddressed
    changed = bool(drop or unword or relabel or rewrite)
    for sid in unword | relabel:
        x = signs[sid]
        for field in WORDING_FIELDS if sid in unword else ():
            x.pop(field, None)
        if x.get('kind') == 'testimony' and not x.get('claim'):
            x.pop('surface_checked', None); x.pop('surface_why', None)
    case.setdefault('morning_dropped', []).extend(sorted(d for d in drop if signs[d].get('morning')))
    if drop:
        with SIGNS:
            case['signs'][:] = [x for x in case['signs'] if x['id'] not in drop]
    if rewrite:
        add_surface_accounts(case, feedback=rewrite)
    if changed:
        mark_surface_truth(case)
    return changed, unaddressed


def _review_gate_rate(case, difficulty_target=None, strict_publication_review=False):
    """The shared publication boundary: review, deterministically gate, rate, and validate the exact serializable
    candidate (strict critic enforcement is opt-in). Writes nothing; callers commit what it returns."""
    import timing
    with timing.phase('final review'):
        certificate = review_for_publication(case)
    for _ in range(PUBLISH_REPAIRS if strict_publication_review else 0):
        issues = LAST_REVIEW_ISSUES.get((certificate or {}).get('candidate_sha256'), ())
        if (certificate or {}).get('critic_status') != 'FAIL' or not issues:
            break
        # what publishing wrote can be at fault (a line, a reaction, an evening account): repair that and review once
        # more. A problem in the structure is not publishing's to repair, and reviewing the same structure again would
        # only re-roll the verdict: the review stands as it is, and the case is not published.
        with timing.phase('review repair'):
            changed, unaddressed = repair_wording(case, issues)
        if unaddressed:
            print('  the review found what publishing cannot repair: ' + '; '.join(str(i)[:160] for i in unaddressed[:4]))
        if unaddressed or not changed:
            break
        with timing.phase('final review'):
            certificate = review_for_publication(case)
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
    from refine import effort
    try:
        with effort(None):   # at low effort the judge finds no groups at all (The Iron Hound)
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
- 'keeps_back' is what they admit only later, once evidence presses them: leave it out entirely, without a hint.
- If 'previous_attempt' is given, it was rejected for the reason stated: write it again without that.
Return {"accounts": {"<person id>": "<what they say>"}}."""

AGREES = """For each person in a 1920s village mystery you get a short account of their evening and the statements they also
give the detective ('tells'). Does the account contradict any statement (a different place, leaving when a statement
says they stayed, a different reason, and so on), or misstate who someone is ('who' gives each person's role and
description: calling a sister a wife is a contradiction), or speak of the victim as alive now ('who' marks them: "ask
the landlady" when the landlady is dead is a contradiction)? Being vaguer or leaving things out is not a contradiction.
Return {"verdicts": {"<id>": {"agrees": true | false, "why": "<for a contradiction: what differs>"}}}."""

LEAK = """Each item is a person's first, vague account of their evening or their morning in a village mystery, and
'keeps_back': what they admit only later, once evidence presses them, and what is still hidden behind what they will say
then. Does the account already tell or plainly point to something in keeps_back (the act, the object, a detail of it,
where they went for it)? Leaving it out, or being merely vague, is fine.
Return {"verdicts": {"<id>": {"leaks": true | false, "what": "<the kept-back thing it gives away>"}}}."""


def own_statements(case, pid):
    """What a person tells the detective as soon as asked, in the case's own statements (their claims, true or false). Not
    what they say only once something is proven (a statement that requires a clue): before that they hold it back."""
    return [x['text'] for x in case['signs'] if x.get('speaker') == pid and x.get('kind') == 'testimony' and x.get('claim')
            and not x.get('requires') and not x.get('surface') and not x.get('morning') and not x.get('sighting')]


SURFACE_CHECK = 6   # 2: accounts are also checked for who people are (kinship, roles); 3: the victim is dead;
                    # 5: nothing they keep back is given away (its own focused check); 6: nor what is still hidden behind
                    # their own later account (withheld)
MORNING_CHECK = 1   # 1: a morning account gives away nothing withheld (the print Pike covered, A Fall Before Midnight)


def village_brief(case):
    """What every writer of a person's words is told about the village: who everyone is, and what everyone knows (the
    case's public facts). One record, so no phase writes a line against a fact another phase was shown."""
    return {'who': who_is_who(case), 'public': [x['text'] for x in case['signs'] if x.get('kind') == 'public']}


def person_brief(case, pid):
    """What a writer is told about one person before writing what they say: their voice and attitudes, what they have
    already told the detective, and what they keep back until pressed."""
    p = next(q for q in case['people'] if q['id'] == pid)
    return {'character': p['name'], 'voice': p.get('voice'),
            'attitudes': [f"{a['mode']}: {a['content']}" for a in case['attitudes'] if a['agent'] == pid],
            'tells': first_tells(case, pid), 'keep_back': kept_back(case, pid)}


def first_tells(case, pid):
    """Everything a person tells the detective as soon as asked: their evening and morning accounts and every other
    account that waits on nothing (claimless ones included; own_statements has only those with a claim)."""
    return [x['text'] for x in case['signs'] if x.get('speaker') == pid and x.get('kind') == 'testimony' and not x.get('requires')
            and not x.get('sighting') and x.get('text')]


def kept_back_events(case, pid):
    """The ids of the events a person admits only once a clue presses them: the events behind locked clues they speak
    or that came of their own doings, and, for the culprit, the crime itself (never admitted: playtests, November 8, a
    written reaction had the culprit say he "only talked on the landing" where she fell)."""
    evs = {e['id']: e for e in case['events']}
    mine = lambda e: pid == e.get('agent') or pid in e.get('others', [])
    ids = {x['source'] for x in case['signs'] if x.get('requires') and x.get('source') in evs
           and (x.get('speaker') == pid or mine(evs[x['source']]))}
    crime = case['question']['crime']['event']
    if pid == enrich.truth_actor(case) and crime in evs:
        ids.add(crime)
    return sorted(ids, key=lambda i: evs[i]['start'])


def kept_back(case, pid):
    """What a person admits only once a clue presses them (kept_back_events, as their summaries). Their first account
    of the evening leaves these out."""
    evs = {e['id']: e for e in case['events']}
    return [evs[i]['summary'] for i in kept_back_events(case, pid)]


TOLD_EVENTS = ('discovery', 'examination')   # always told (the morning writer sees them by their type alone)


def withheld(case, pid):
    """What a person's first accounts (evening and morning) must not give away: what they admit only once pressed
    (kept_back; finding the body and examining it are told, but not what came of them that is still to be found), and
    every physical clue locked behind an account they themselves give only once pressed (Pike's covered print opens
    only once he has owned up to the boathouse, so he cannot mention it this morning). A clue that an account they
    tell freely leads to is a lead, not a secret."""
    signs, evs = {x['id']: x for x in case['signs']}, {e['id']: e for e in case['events']}
    held = kept_back_events(case, pid)
    told = {i for i in held if evs[i].get('type') in TOLD_EVENTS}
    pressed = lambda r: signs.get(r, {}).get('kind') == 'testimony' and signs[r].get('speaker') == pid and signs[r].get('requires')
    behind = [x for x in case['signs'] if x.get('kind') not in ('testimony', 'public') and x.get('text') and x.get('requires')
              and (x.get('source') in told or any(pressed(r) for r in x['requires']))]
    return [evs[i]['summary'] for i in held if i not in told] + [f"{x.get('title') or 'a clue'}: {x['text']}" for x in behind]


def who_is_who(case):
    """Each person in the case as the setting describes them: name, role and public description (kinship lives there)."""
    setting = {p['id']: p for p in enrich.SETTING.get('people', [])}
    victim = enrich.victim_of(case)
    return [{'id': p['id'], 'name': setting.get(p['id'], {}).get('name', p.get('name')), 'role': setting.get(p['id'], {}).get('role'),
             'description': setting.get(p['id'], {}).get('public'),
             **({'status': 'the victim: dead since last night'} if p['id'] == victim else {})} for p in case['people']]


def _verdicts(raw, keys):
    """A judge's verdicts, by key. A reply that judges none of the items asked about is a failed reply (asked again by
    the phase); an item it leaves out simply fails its check, so a missing verdict never passes text."""
    import refine
    out = _as_map((raw or {}).get('verdicts', {}))
    if keys and not any(k in out for k in keys):
        raise refine.LLMJSONResponseError('the judge returned no verdicts for the items asked about', raw, refine.CRITIC_MODEL)
    return out


def judge(system, payload, keys, max_tokens):
    """One judge call on the wording model and its verdicts by key, asked once more if it judged none of them."""
    import refine
    for attempt in (1, 2):
        try:
            return _verdicts(refine.llm_json(system, payload, max_tokens, model=refine.CRITIC_MODEL), keys)
        except refine.LLMJSONResponseError:
            if attempt == 2:
                raise


def surface_disagreements(case, signs):
    """{sign id: why} for evening accounts that contradict their speaker's own statements, or give away what the speaker
    admits only once pressed. Two focused questions, asked at once (one judge asked both misses the leak)."""
    from refine import llm_json, CRITIC_MODEL
    from concurrent.futures import ThreadPoolExecutor
    items = [{'id': x['id'], 'speaker': x['speaker'], 'account': x['text'], 'tells': own_statements(case, x['speaker']), 'who': who_is_who(case)}
             for x in signs]
    if not items:
        return {}
    with ThreadPoolExecutor(2) as pool:
        agrees = provenance.submit_with_context(pool, judge, AGREES, json.dumps(items), [i['id'] for i in items], 1500)
        leaked = provenance.submit_with_context(pool, leaks, case, signs)
        out = agrees.result()
        gave = leaked.result()
    bad = {}
    for i in items:
        v = out.get(i['id'])
        if not isinstance(v, dict) or v.get('agrees') is not True:
            bad[i['id']] = str((v or {}).get('why', '') if isinstance(v, dict) else 'not judged')[:300] or 'not judged'
        elif i['id'] in gave:
            bad[i['id']] = gave[i['id']]
    return bad


def leaks(case, signs):
    """{sign id: why} for first accounts (evening or morning) that give away what their speaker withholds. An account
    the judge leaves unjudged fails (a missing verdict never passes text)."""
    items = [{'id': x['id'], 'account': x['text'], 'keeps_back': withheld(case, x['speaker'])} for x in signs if withheld(case, x['speaker'])]
    if not items:
        return {}
    gave = judge(LEAK, json.dumps(items), [i['id'] for i in items], 1500)
    return {i['id']: ('gives away what they admit only once pressed: ' + str((w or {}).get('what', '') if isinstance(w, dict) else 'not judged'))[:300]
            for i in items for w in [gave.get(i['id'])] if not isinstance(w, dict) or w.get('leaks') is not False}


def add_surface_accounts(case, rounds=2, feedback=None):
    """Each person's first account of the evening: true but vague for an innocent, a vague cover for the culprit, and never
    against what they themselves tell the detective. One that contradicts their statements is rewritten, else dropped.
    feedback ({person: {'text', 'rejected_because'}}, from a review) rewrites those people's accounts with the reason."""
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
    failed = dict(feedback or {})
    with SIGNS: case['signs'][:] = [x for x in case['signs'] if not (x.get('surface') and x['speaker'] in failed)]
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
                  'events': [e.get('summary') for e in case['events'] if (pid == e.get('agent') or pid in e.get('others', [])) and e['start'] < morning
                             and e.get('summary') not in kept_back(case, pid)],
                  'keeps_back': kept_back(case, pid),
                  'attitudes': [f"{a['mode']}: {a['content']}" for a in case['attitudes'] if a['agent'] == pid],
                  'tells': own_statements(case, pid), 'who': who_is_who(case), **({'previous_attempt': failed[pid]} if pid in failed else {})} for pid in todo]
        out = _accounts(llm_json(SURFACE, json.dumps(items), 2500, model=CRITIC_MODEL), todo)
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
    # (nor what they admit only once pressed)
    sources = {x.get('source') for x in case['signs']}
    held = {pid: set(kept_back_events(case, pid)) for pid in people}
    own = lambda pid: sorted([e for e in case['events'] if (pid == e.get('agent') or pid in (e.get('others') or []))
                              and morning <= e['start'] < start and e['id'] != crime
                              and (e.get('type') in ('discovery', 'examination') or (e['id'] not in sources and e['id'] not in held[pid]))],
                             key=lambda e: e['start'])
    # The discovery and the examination are always told, but what they produced that the detective must still find
    # (the notebook from the pockets) is not: the writer sees them by their type alone, and code rejects a line that
    # names a clue still to be found.
    locked = [x for x in case['signs'] if x.get('requires') and x.get('kind') not in ('testimony', 'public')]
    locked_sources = {x.get('source') for x in locked}
    nouns = enrich.clue_nouns({**case, 'signs': locked})
    said = lambda e: (f"{'found the body' if e.get('type') == 'discovery' else 'examined the body'}"
                      if e['id'] in locked_sources else e.get('summary'))
    n, failed = 0, {}
    # accounts already published are checked too (a case published before the check): one that gives away what its
    # speaker withholds is written again with the reason
    old = [x for x in case['signs'] if x.get('morning') and x.get('leak_checked') != MORNING_CHECK]
    gave = {**leaks(case, old), **{x['id']: x.get('surface_why') or 'an innocent account that is not true' for x in old
                                   if x['speaker'] != truth and x.get('surface_checked') == 'cover'}}
    failed.update({x['speaker']: {'text': x['text'], 'not_true_because': gave[x['id']]} for x in old if x['id'] in gave})
    with SIGNS: case['signs'][:] = [x for x in case['signs'] if x['id'] not in gave]
    for x in old:
        if x['id'] not in gave:
            x['leak_checked'] = MORNING_CHECK
    for _ in range(rounds):
        have = {x['speaker'] for x in case['signs'] if x.get('morning')}
        todo = [pid for pid in people if pid != victim and pid not in have and own(pid)
                and f's_morning_{pid}' not in case.get('morning_dropped', [])]
        if not todo:
            break
        items = [{'id': pid, 'name': people[pid]['name'], 'voice': people[pid].get('voice'), 'culprit': pid == truth,
                  'morning': [f"at {spoken_about(e['start'])}: {said(e)}" for e in own(pid)],
                  **({'previous_attempt': failed[pid]} if pid in failed else {}),
                  # only the culprit needs to know what to hide
                  'hides': [a['content'] for a in case['attitudes'] if a['agent'] == pid] if pid == truth else []} for pid in todo]
        out = _accounts(llm_json(MORNING, json.dumps(items), 2500, model=CRITIC_MODEL), todo)
        named = {}
        for pid in todo:
            text = str(out.get(pid, '')).strip()
            # a word of what they were given to tell is theirs to say ("the foot of the terrace steps" where the body lay,
            # though a print by the steps is still to be found)
            given = {w for e in own(pid) for w in re.findall(r'[a-z]+', str(said(e)).lower())}
            if text and enrich.mentions_clue(text, {n for n in nouns if n not in given}):
                named[pid] = {'text': text, 'not_true_because': 'it names something the detective has yet to find; leave it out'}
                continue
            if text and not re.search(r'\d', text) and len(text.split()) <= 80:
                with SIGNS: case['signs'].insert(0, {'id': f's_morning_{pid}', 'kind': 'testimony', 'speaker': pid, 'morning': True,
                                                     'deceptive': pid == truth, 'title': f"{people[pid]['name']} on the morning",
                                                     'text': text, 'ask': 'What did you do this morning?'})
                n += 1
        mark_surface_truth(case)
        # an innocent's morning that is not honest is the wording's fault, not a lie with a reason: rewrite, then drop;
        # anyone's that gives away what they withhold, likewise
        fresh = [x for x in case['signs'] if x.get('morning') and x['speaker'] in todo]
        gave = leaks(case, fresh)
        bad = [x['id'] for x in fresh if x['id'] in gave or (x['speaker'] != truth and x.get('surface_checked') == 'cover')]
        failed = {**named, **{x['speaker']: {'text': x['text'], 'not_true_because': gave.get(x['id']) or x.get('surface_why', '')}
                              for x in fresh if x['id'] in bad}}
        for x in fresh:
            if x['id'] not in bad:
                x['leak_checked'] = MORNING_CHECK
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


VISIBLE = """Two people in a 1920s English village mystery were at the same place at overlapping times. A place is a whole
building or area, so being there together does not mean they met: a lodger keeping to her bedroom upstairs is not seen by
the drinkers in the bar below. From what each was doing, would the first person have seen the second there?
Return {"verdicts": {"<id>": true | false}}."""


def visible(case, cands):
    """The co-presences in which the first person would really have seen the second (one judgement on the two events)."""
    from refine import llm_json, presence, CRITIC_MODEL
    if not cands:
        return []
    evs, pres = {e['id']: e for e in case['events']}, presence(case)
    names = {p['id']: p['name'] for p in case['people']}
    def doing(pid, pl, lo, hi):
        return [evs[ev]['summary'] for (s0, e0, pl1, ev) in pres.get(pid, []) if pl1 == pl and s0 < hi and lo < e0 and ev in evs]
    items = [{'id': f'v{i}', 'first': names.get(a, a), 'first_doing': doing(a, pl, lo, hi), 'second': names.get(b, b),
              'second_doing': doing(b, pl, lo, hi), 'place': pl, 'when': spoken_about((lo + hi) / 2)}
             for i, (a, b, pl, lo, hi, _) in enumerate(cands)]
    out = _as_map(llm_json(VISIBLE, json.dumps(items), 1500, model=CRITIC_MODEL).get('verdicts', {}))
    return [c for i, c in enumerate(cands) if out.get(f'v{i}') is True]


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
    # a published sighting from before the visibility judgement is judged now, and dropped if they would not have met
    old = [x for x in case['signs'] if x.get('sighting') and not x.get('seen_checked')]
    if old:
        tup = lambda x: (x['speaker'], x['claim']['person'], x['claim']['place'], x['claim']['from'], x['claim']['to'], x.get('source'))
        ok = {c[:3] for c in visible(case, [tup(x) for x in old])}
        unseen = [x for x in old if tup(x)[:3] not in ok]
        for x in old:
            x['seen_checked'] = True
        if unseen:
            with SIGNS: case['signs'][:] = [x for x in case['signs'] if x not in unseen]
            log(f'  sightings: {len(unseen)} were of people who would not have seen each other; dropped')
    have = {(x.get('speaker'), (x.get('claim') or {}).get('person')) for x in case['signs'] if x.get('sighting')}
    ok0, shape0 = _solve_shape(case)
    if not ok0:
        return 0
    names = {p['id']: p['name'] for p in case['people']}
    truth = enrich.truth_actor(case)
    # someone lying about their own night does not volunteer where they were (a sighting would say it)
    # (read from the structure, not from labels other phases may not have written yet: certification's false accounts
    # and the culprit, who lies about the night); nor does anyone say where they were while doing what they keep back
    false = set(__import__('refine').certify(case, False).get('false_signs') or [])
    liars = {truth} | {x['speaker'] for x in case['signs'] if x.get('kind') == 'testimony' and (x.get('deceptive') or x['id'] in false)}
    hidden = {p['id']: set(kept_back_events(case, p['id'])) for p in case['people']}
    cands = visible(case, [c for c in sighting_candidates(case) if (c[0], c[1]) not in have and c[0] not in liars
                           and c[5] not in hidden.get(c[0], ())])
    # people of interest first: suspects, then anyone; a speaker gives at most a few
    suspects = {(h.get('facts') or {}).get('actor') for h in case['question']['candidates']}
    cands.sort(key=lambda c: (c[1] not in suspects, c[0], c[3]))
    kept, per = [], {}
    for a, b, pl, lo, hi, ev in cands:
        if per.get(a, 0) >= SIGHTINGS_PER_PERSON:
            continue
        sid = f's_saw_{a}_{b}_{pl}'
        sign = {'id': sid, 'kind': 'testimony', 'speaker': a, 'sighting': True, 'seen_checked': True, 'source': ev,
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
- 'who' says how each person is addressed: name people exactly that way (two people may share a surname: "Mr Vale"
  is only the one 'who' calls that).
- Each line is said to one person (show: a third person; confront: the speaker or the person behaving; direct: 'to').
  "You" and "your" mean that listener only, and "your" only for what the clue shows is theirs. Only 'confront' may
  refer to what the listener told the detective: the others cannot know the listener has said anything yet.
- Add no facts that are not in the clue. At most 35 words each. End with a question mark.
Return {"lines": {"<clue id>": {"show": "...", "confront": "...", "to": "<person id or null>", "direct": "..."}}}."""

REACT_CHECK = """Each item is what a character in a 1920s village mystery says when the detective shows them a clue, with
what they have already told the detective ('tells'), what they admit only once pressed ('keep_back'), what everyone
knows ('public'), how the detective came by the clue ('how_found') and the clue itself (for an account, 'said_by' is who
told it). Is the reply consistent? It fails if it contradicts 'tells', 'public' or 'how_found' (unless the clue itself
disproves what they told), gives away something in 'keep_back' that neither the clue nor how it was found shows, or
names someone by a form of address 'who' does not give them, or contradicts 'reading' (what the clue truly shows, when
given), or gets wrong who did or said what in the clue (taking another person's act or words as the character's own: "I
posted it myself" of a letter someone else posted). A culprit deflecting or minimising is fine; so is a reply that says
little.
Return {"verdicts": {"<key>": {"ok": true | false, "why": "<for a failure: what is wrong>"}}}."""

REACT = """You write how characters in a 1920s English village mystery react when the detective shows them a clue.
'village' says who everyone is and what everyone in the village knows ('public'). Each item gives the character (voice,
what they want, fear or hide, what they did that night, what they have told the detective, what they keep back), the
clue, how the detective came by it ('how_found'), and how the character relates to it. Write their spoken reply: one to three sentences in their voice, spoken words only (first
person, no narration or stage directions such as "she laughs"). Rules:
- React to what the clue actually is, from the character's own position and knowledge.
- If the clue contradicts something they told the detective, they concede it, giving their real reason if they have one.
- The culprit never confesses; they deflect or minimise. An innocent keeps their private secret unless the clue exposes it.
- Add no facts about anyone's whereabouts, times or actions beyond the character's own listed events and the clue.
- Never contradict 'public', 'how_found' or what they have told the detective ('tells'), unless this clue disproves it.
- What they 'keep_back' they admit only as far as this clue (or how it was found) already shows it.
- No clock times or numbers unless they appear in the clue. At most 60 words.
Return {"reactions": {"<clue id>|<person id>": "..."}}."""


def _as_map(value, key_names=('id', 'key'), text_names=('text', 'reaction', 'line', 'reply')):
    """Models return either {id: value} or [{id: .., ...}]: normalise to a dict."""
    while isinstance(value, dict) and len(value) == 1 and next(iter(value)) in ('lines', 'reactions', 'clues', 'items', 'verdicts', 'accounts'):
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


def _accounts(raw, todo):
    """{person id: text} from a writer's reply. Asked for one person, a model sometimes returns the text itself in place
    of the map (A Fall Before Midnight's repair, November 8)."""
    out = (raw or {}).get('accounts', raw) if isinstance(raw, dict) else raw
    if isinstance(out, str):
        return {todo[0]: out} if len(todo) == 1 else {}
    return {k: v for k, v in _as_map(out, text_names=('text', 'account', 'reply')).items() if isinstance(v, str)}


def in_parallel(work, chunks):
    """work(chunk) for each chunk at once (the calls of one wording phase), results in chunk order. A phase's single big
    call was its long pole (show lines 51 s, reactions 69 s in sequential chunks, Last Train, October 25)."""
    import concurrent.futures as cf
    if len(chunks) <= 1:
        return [work(c) for c in chunks]
    with cf.ThreadPoolExecutor(max_workers=len(chunks)) as pool:
        return [f.result() for f in [provenance.submit_with_context(pool, work, c) for c in chunks]]


def _digits_ok(text, allowed):
    import re
    have = set(re.findall(r'\d+', allowed))
    return all(d in have for d in re.findall(r'\d+', text))


LINES_AGREE = """For each clue of a 1920s village mystery you get its text, whose account or behaviour it is ('speaker',
'about'), and the lines the detective says about it: 'show' (said to a third person), 'confront' (said to the speaker of
an account or the person behaving) and 'direct' (said to 'to', the person the clue concerns). Does each line say only what
the text says (it may be shorter, and may name the speaker)? A line that adds or changes a fact (a place, a time, a
person, an action, another account's content) does not agree. Nor does a line that gets wrong who said or did what for
its listener: "you" or "your" for anyone but that listener ("You told me..." said to someone who is not the speaker; "your
letter" for someone else's), or, outside 'confront', anything the listener is supposed to have told the detective.
Return {"verdicts": {"<id>": {"agrees": true | false, "why": "<for a disagreement: which line, and what differs>"}}}."""

# The version of the line check: lines checked under an earlier one are checked again (version 2 added who each line
# is said to, after a 'direct' line put Pike's account to Miss Vale as her own, A Fall Before Midnight, November 8).
LINES_CHECK_VERSION = 2


def lines_key(x):
    """What a clue's lines were checked against: its text, under the current line check."""
    return text_key(f"lines-v{LINES_CHECK_VERSION}|{x.get('text')}")


# A line said to someone other than an account's speaker that gives the account to its listener ("You told me...").
_LISTENER_SAID = re.compile(r"\byou('ve| have| had| now)? (told|said|say|mentioned|claimed|claim)\b", re.I)


def misaddressed(x, key, line):
    """True when a line about an account gives the account to its listener: 'show' and 'direct' are said to someone who
    did not give it (only 'confront' is said to its speaker)."""
    return x.get('kind') == 'testimony' and key in ('show', 'direct') and bool(_LISTENER_SAID.search(str(line or '')))


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


def check_lines(case, final=False):
    """Lines written for a clue's text are kept only while they say what the text says: lines not yet checked against
    the current text are checked, and dropped if they add or change a fact, so add_show_lines writes them again.
    final: the last check, after which nothing is written again: a line the judge left unjudged is dropped too (a
    missing verdict never passes text; the game then uses its plain line for that clue). Returns the number dropped."""
    from refine import llm_json, CRITIC_MODEL
    n = 0
    for x in case['signs']:     # a form of address no one answers to, or an account given to its listener: written again
        if any(wrong_addresses(x.get(k), f"{x.get('text')} {history_text(case)}") or misaddressed(x, k, x.get(k))
               for k in ('show', 'confront', 'direct')):
            for k in ('show', 'confront', 'direct', 'lines_for'):
                x.pop(k, None)
            n += 1
    todo = [x for x in case['signs'] if (x.get('show') or x.get('confront') or x.get('direct')) and x.get('lines_for') != lines_key(x)]
    if not todo:
        return n
    names = {p['id']: p['name'] for p in case['people']}
    items = [{'id': x['id'], 'text': x.get('text'), **{k: names.get(x.get(k)) for k in ('speaker', 'about', 'to') if names.get(x.get(k))},
              **{k: x[k] for k in ('show', 'confront', 'direct') if x.get(k)}} for x in todo]
    out = {}
    for raw in in_parallel(lambda chunk: llm_json(LINES_AGREE, json.dumps(chunk), 4000, model=CRITIC_MODEL),
                           [items[i:i + 20] for i in range(0, len(items), 20)]):
        out.update(_as_map(raw.get('verdicts', {})))
    for x in todo:
        v = out.get(x['id'])
        if not isinstance(v, dict) and not final:
            continue                                   # no verdict: checked again next time
        if not isinstance(v, dict) or v.get('agrees') is False:
            for k in ('show', 'confront', 'direct'):
                x.pop(k, None)
            n += 1
        else:
            x['lines_for'] = lines_key(x)
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
    out = {}
    who = who_is_who(case)
    for raw in in_parallel(lambda chunk: llm_json(SHOW, json.dumps({'people': names, 'who': who, 'clues': chunk}), 8000, model=CRITIC_MODEL),
                           [items[i:i + 12] for i in range(0, len(items), 12)]):
        out.update(_as_map(raw.get('lines', raw.get('clues', {}))))
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
        if subject and direct.endswith('?') and len(direct.split()) <= 40 and _digits_ok(direct, x.get('text', '')) \
                and not wrong_addresses(direct, x.get('text')) and not misaddressed(x, 'direct', direct):
            x['direct'] = direct; n += 1
            x.pop('lines_for', None)
        for key in ('show', 'confront'):
            if x.get(key):
                continue
            line = str(got.get(key) or '').strip()
            if key == 'confront' and x['kind'] not in ('behavior', 'testimony'):
                continue
            # a line said to a third person must not address the speaker or subject as "you"
            if key == 'show' and x['kind'] in ('behavior', 'testimony') and (misaddressed(x, key, line) or re.search(r"^you\b|\byou('ve| have| had)? (told|said|mentioned|claimed|were|went)\b|\byour\b", line, re.I)):
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
'who' says who everyone is: one person may be named several ways (first name, surname, title).
Return {"verdicts": {"<id>": {"v": "honest" | "cover", "why": "<for a cover story: what in it is false>"}}}."""


def mark_surface_truth(case):
    """An evening account is deceptive when the speaker's true history contradicts it (not only the culprit's)."""
    from refine import llm_json, CRITIC_MODEL
    import enrich
    ta = enrich.truth_actor(case)
    # every account without a checkable claim (a claim's truth is computed) and that is not a sighting (read from the
    # history): the evening and morning summaries, and any other claimless account, such as a culprit's cover story
    todo = [x for x in case['signs'] if x.get('kind') == 'testimony' and not x.get('claim') and not x.get('sighting')
            and 'surface_checked' not in x]
    if not todo:
        return 0
    # An evening account is judged against the speaker's evening, a morning account against their morning: leaving out
    # what the other question covers (the discovery of the body, in an evening account) is not a cover story.
    morning = enrich.day(case, 'morning')
    in_window = lambda x, e: ((e['start'] >= morning) == bool(x.get('morning'))
                              if morning is not None and (x.get('surface') or x.get('morning')) else True)
    items = [{'id': x['id'], 'account': x['text'],
              'really': [e.get('summary') for e in case['events'] if (x['speaker'] == e.get('agent') or x['speaker'] in e.get('others', []))
                         and in_window(x, e)]}
             for x in todo]
    # judged a dozen at a time: one long batch can run out of room and come back with no verdicts at all
    import concurrent.futures as cf
    out = {}
    batches = [items[i:i + 12] for i in range(0, len(items), 12)]
    with cf.ThreadPoolExecutor(max_workers=max(1, len(batches))) as pool:
        who = who_is_who(case)
        futures = [provenance.submit_with_context(pool, lambda b: llm_json(SURFACE_TRUTH, json.dumps({'who': who, 'accounts': b}), 2500, model=CRITIC_MODEL), b)
                   for b in batches]
        for f in futures:
            out.update(_as_map(f.result().get('verdicts', {})))
    n = 0
    for x in todo:
        got = out.get(x['id'], out.get(x['speaker'], ''))
        v = str(got.get('v', '') if isinstance(got, dict) else got).lower()
        if isinstance(got, dict) and got.get('why'):
            x['surface_why'] = str(got['why'])[:300]
        if v not in ('honest', 'cover'):
            continue
        # an account is a cover story only where it misstates (the culprit's honest morning is honest; the writer gives
        # the culprit a cover story where one is needed, and the judge sees it)
        x['deceptive'] = v == 'cover'
        x['surface_checked'] = v
        n += 1
    return n


CONCEDE = """In a 1920s English village mystery, a character gave the detective an account that held something back (a name,
or what their words really meant). The detective now shows them a piece of evidence that settles it. Write what the
character says (1-2 sentences, in their voice): they concede plainly what the evidence shows, as the 'meaning' states,
perhaps with a word about why they held back. Add no fact beyond 'meaning' and the evidence; no clock times or numbers
unless they are in the account. Never contradict 'reading' (what the evidence truly shows, when given). Return {"lines": {"<key>": "..."}}."""


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
        if c['pred'] == 'crimeBetween':   # minutes in a JSON claim were read as the wrong hour (Paste Pearls, October 25)
            return f"the fatal act happened between {clock_words(c['from'])} and {clock_words(c['to'])}"
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
                              'account': x['text'], 'meaning': meaning(c), 'evidence': {'title': signs[n].get('title'), 'text': signs[n].get('text')},
                              **({'reading': x['reading']} if x.get('reading') else {})})
    if not items:
        return 0
    out = _as_map(llm_json(CONCEDE, json.dumps(items), 4000, model=CRITIC_MODEL).get('lines', {}))
    lines = [(x, n, k, str(out.get(k) or '').strip()) for x, n, k in keys]
    lines = [(x, n, k, line) for x, n, k, line in lines if line and len(line.split()) <= 60 and _digits_ok(line, x.get('text', ''))]
    ok = replies_that_hold(case, [(k, x['speaker'], line, signs[n], ' '.join(filter(None, [meaning(claim_of(x)), x.get('reading')])))
                                  for x, n, k, line in lines])
    k_ = 0
    for x, n, k, line in lines:
        if k in ok:
            x.setdefault('concede', {})[n] = line; k_ += 1
    return k_


def involved_pairs(case):
    """(clue, person) pairs worth a written reaction: people who took part in the clue's source event, the subject of a
    behaviour clue, the teller of a contradicted account, and the culprit for any clue carrying a claim."""
    evs = {e['id']: e for e in case['events']}
    truth = next(h for h in case['question']['candidates'] if h['id'] == case['question']['truth'])['facts']['actor']
    setting_people = {p['id']: p for p in enrich.SETTING.get('people', [])}
    in_case = {p['id'] for p in case['people']}
    def name_forms(p):
        full = setting_people.get(p['id'], {}).get('name') or p.get('name') or ''
        parts = [w for w in full.split() if w not in ('Dr', 'The', 'Reverend', 'Mr', 'Mrs', 'Miss', 'Constable')]
        return [f for f in {full, setting_people.get(p['id'], {}).get('address'), *(parts[:1] + parts[-1:])} if f and len(f) > 2]
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
        # whoever keeps the place a record or document is found in (the postmistress and her own docket), and anyone
        # the clue's words name (a letter about a man's pearls and his sister)
        if x['kind'] in ('record', 'document', 'item'):
            who |= {pid for pid, p in setting_people.items() if p.get('home') == x.get('at') and pid in in_case}
        text = str(x.get('text') or '')
        who |= {p['id'] for p in case['people'] if any(re.search(rf"\b{re.escape(n)}\b", text) for n in name_forms(p))}
        for pid in who:
            if pid and pid in in_case and pid != enrich.victim_of(case) and not (x.get('reactions') or {}).get(pid):
                pairs.append((x, pid))
    return pairs


def add_reactions(case):
    from refine import llm_json, CRITIC_MODEL
    check_reactions(case)              # reactions from an earlier check are judged again first (those dropped are written again)
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
    village = village_brief(case)
    def work(chunk):
        items = [{'key': f"{x['id']}|{pid}", **person_brief(case, pid), 'their_events': own_events(pid),
                  'clue': {'kind': x['kind'], 'title': x.get('title'), 'text': x.get('text')},
                  **({'how_found': x['unlock']} if x.get('unlock') else {}), 'relation': relation(x, pid)} for x, pid in chunk]
        return llm_json(REACT, json.dumps({'village': village, 'items': items}), 8000, model=CRITIC_MODEL)
    for raw in in_parallel(work, [pairs[i:i + 10] for i in range(0, len(pairs), 10)]):
        out.update({k: (v if isinstance(v, str) else (v or {}).get('text', '')) for k, v in _as_map(raw.get('reactions', {})).items()})
    written = []
    for x, pid in pairs:
        text = str(out.get(f"{x['id']}|{pid}") or '').strip()
        allowed = ' '.join([x.get('text', '')] + [str(e) for e in own_events(pid)])
        if text and len(text.split()) <= 70 and _digits_ok(text, allowed):
            written.append((x, pid, text))
    ok = replies_that_hold(case, [(f"{x['id']}|{pid}", pid, text, x, None) for x, pid, text in written])
    n = 0
    for x, pid, text in written:
        if f"{x['id']}|{pid}" in ok:
            x.setdefault('reactions', {})[pid] = text; n += 1
    for x, pid, _text in written:       # what is on the clue now has been judged under the current check
        if f"{x['id']}|{pid}" in ok:
            x['reactions_checked'] = REACT_CHECK_VERSION
    return n


# The version of the reaction check: reactions checked under an earlier one are checked again (2: who did or said what in
# the clue, after the postmistress took the squire's unanswered call as her own, A Fall Before Midnight, November 8;
# 3: the culprit keeps back the crime itself).
REACT_CHECK_VERSION = 3


def check_reactions(case):
    """Written reactions not yet checked under the current reaction check are checked, and dropped if they do not hold
    (add_reactions writes them again). Returns the number dropped."""
    todo = [(f"{x['id']}|{pid}", pid, text, x, None) for x in case['signs'] if x.get('reactions_checked') != REACT_CHECK_VERSION
            for pid, text in (x.get('reactions') or {}).items()]
    if not todo:
        return 0
    ok = replies_that_hold(case, todo)
    n = 0
    for x in {id(t[3]): t[3] for t in todo}.values():
        gone = [pid for pid in x['reactions'] if f"{x['id']}|{pid}" not in ok]
        for pid in gone:
            del x['reactions'][pid]
        n += len(gone)
        x['reactions_checked'] = REACT_CHECK_VERSION
    return n


def replies_that_hold(case, replies):
    """The keys of the replies that pass their own check: each (key, person, reply, clue, reading) against what the
    person tells as soon as asked, keeps back, what everyone knows, how the clue was found and what it truly shows. A
    reply that fails, or that the judge leaves unjudged, does not hold (play falls back to a plain reply)."""
    village = village_brief(case)
    names = {p['id']: p['name'] for p in case['people']}
    def check(chunk):
        items = [{'key': k, 'reply': text, 'tells': first_tells(case, pid), 'keep_back': kept_back(case, pid),
                  'clue': {'title': x.get('title'), 'text': x.get('text'), **({'said_by': names[x['speaker']]} if names.get(x.get('speaker')) else {})},
                  **({'how_found': x['unlock']} if x.get('unlock') else {}),
                  **({'reading': reading} if reading else {})}
                 for k, pid, text, x, reading in chunk]
        return judge(REACT_CHECK, json.dumps({'public': village['public'], 'who': village['who'], 'items': items}),
                     [i['key'] for i in items], 3000)
    verdicts = {}
    for v in in_parallel(check, [replies[i:i + 12] for i in range(0, len(replies), 12)]):
        verdicts.update(v)
    return {k for k, v in verdicts.items() if isinstance(v, dict) and v.get('ok') is True}


MEDICAL = """You write the village doctor's findings after examining the body in a 1920s English village mystery. You get
what really happened (the fatal event), whether death came at once or some time after it (delayed), and the method type.
Write two short texts:
- 'notes': the doctor's written examination notes (2-3 sentences).
- 'says': what the doctor says aloud when asked about the body (1-2 sentences, in her voice).
Use these placeholders exactly and write no clock times or numbers yourself:
  {death}  - when death occurred (only if delayed is true)
  {window} - when the fatal act happened: the blow, the fall, or (if delayed) when the poison was taken or the cause began
If delayed is true, say he died around {death} and that the poison was taken (or the cause began) earlier, {window},
as the time such a cause takes to work allows (a doctor reasons back from the death; she cannot read the hour of a dose
from the body itself).
If delayed is false, say death occurred {window}. Never say "shortly before death" for a delayed death.
State the cause only in general terms (e.g. 'a heavy blow to the back of the head', 'a poison taken by mouth'); never
name or describe a specific weapon, substance, container or owner, and never name anyone but the deceased.
'her_accounts' is what the doctor has already said about the body: agree with it (the cause, what she found, how sure
she is of the time) and add nothing it does not support. If 'previous_attempt' is given, it was judged to disagree with
her accounts for the reason stated: write it again without that.
Return {"notes": "...", "says": "..."}."""

MEDICAL_AGREES = """A village doctor's examination notes and words ('medical') and what she has already said about the body
('her_accounts'). Do they disagree: a different cause, a different detail of the body or of what was found on it, a
different time of death, or more certainty about the time than her accounts allow? Saying less is not a disagreement.
Return {"verdicts": {"medical": {"agrees": true | false, "why": "<for a disagreement: what differs>"}}}."""

MEDICAL_V = 4   # 3: a death after the window is delayed however short the gap (a poison that took forty minutes was
                #    worded as death in the window, against the death event: regeneration reviews, November 8);
                # 4: one doctor, one set of findings: the notes keep to her own accounts (their window, what she found)

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
    time claim is the question's crime window, or the doctor's own true word on it when the case already has one (one
    doctor, one set of findings); either way certification checks it like any record. It makes the window known to the
    player, which alibis need. For a delayed death (poison) the doctor
    gives the time of death and places the fatal dose (or the cause) earlier, in the window."""
    import re
    from refine import llm_json, CRITIC_MODEL, claim_true
    import enrich
    old = [x for x in case['signs'] if x.get('medical')]
    # the case's own examination account (a clue the structure placed) is the doctor's word on the body: a second
    # one would be the same account behind two questions
    doctor = enrich.role(case, 'examiner')
    own = any(x.get('kind') == 'testimony' and x.get('speaker') == doctor and not x.get('medical')
              and (x.get('claim') or {}).get('pred') == 'crimeBetween' for x in case['signs'])
    if own and any(x.get('kind') == 'testimony' for x in old):
        with SIGNS:
            case['signs'][:] = [x for x in case['signs'] if not (x.get('medical') and x.get('kind') == 'testimony')]
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
    # One doctor, one set of findings: when the case already has her word on the body, the notes keep to it. Her own
    # time of death is the notes' window (regeneration reviews, November 8: her account put death between ten and twenty
    # past eleven, the notes between twenty to eleven and ten past), and the writer is held to what she said.
    her = [x for x in case['signs'] if x.get('kind') == 'testimony' and x.get('speaker') == doctor and not x.get('medical')
           and x.get('text')]
    # only her true word: a doctor who lies (one who is a suspect may) never makes a record of the lie
    timed = next(((x['claim']['from'], x['claim']['to']) for x in her if (x.get('claim') or {}).get('pred') == 'crimeBetween'
                  and isinstance(x['claim'].get('from'), (int, float)) and isinstance(x['claim'].get('to'), (int, float))
                  and doctor != enrich.truth_actor(case) and claim_true(case, x['claim'])), None)
    if timed:
        w0, w1 = timed
    her_accounts = [x['text'] for x in her]
    death = next((e for e in case['events'] if (e.get('type') == 'death' or e.get('kind') == 'death') and e.get('agent') == victim), None)
    delayed = bool(death and death['start'] > max(w1, crime['end']))   # death after the fatal act's window
    method = (case.get('answer') or {}).get('method')
    failed = None
    for _ in range(3):
        out = llm_json(MEDICAL, json.dumps({'fatal_event': crime.get('summary'), 'delayed': delayed, 'method': method,
                                            'victim': vname, 'her_accounts': her_accounts,
                                            **({'previous_attempt': failed} if failed else {})}), 800, model=CRITIC_MODEL)
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
        if her_accounts:
            v = judge(MEDICAL_AGREES, json.dumps({'medical': {'notes': notes, 'says': says}, 'her_accounts': her_accounts}),
                      ['medical'], 600).get('medical')
            if not isinstance(v, dict) or v.get('agrees') is not True:
                failed = {'notes': notes, 'says': says, 'disagrees_because': str((v or {}).get('why', 'not judged'))[:300]}
                continue
        break
    else:   # the model's text failed the checks three times: the doctor's findings are written by code
        cause = {'poison': 'a poison taken by mouth', 'blow': 'a heavy blow to the head', 'fall': 'injuries from a fall',
                 'smother': 'suffocation', 'drown': 'drowning', 'blade': 'a stab wound', 'gun': 'a gunshot wound',
                 'gas': 'breathing gas or fumes', 'staged': 'injuries made to look like an accident'}.get(method, 'unnatural causes')
        span = f"between {clock_words(w0)} and {clock_words(w1)}"
        if delayed:
            says = f"Death came at about {clock_words(death['start'])}, from {cause}; from the time such a cause takes to work, it began {span}."
        else:
            says = f"Death was from {cause}, and it occurred {span}."
        notes = f"Examination of the deceased shows {cause}. " + says
    with SIGNS:
        case['signs'][:] = [x for x in case['signs'] if not x.get('medical')]
    claim = {'pred': 'crimeBetween', 'from': w0, 'to': w1}
    doctor = doctor if doctor != victim else None
    with SIGNS:
        home = next((p.get('home') for p in case['people'] if p['id'] == doctor), None)
        case['signs'].insert(0, {'id': 's_medical', 'kind': 'record', 'medical': True, 'medical_v': MEDICAL_V, 'source': exam['id'],
                                 'at': home or q['crime']['place'],
                                 'title': 'The doctor\u2019s examination notes', 'text': notes, 'claim': claim})
        if doctor and not own:
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


FALLBACKS = """For each person in a 1920s English village mystery you get their voice and character, and whether they are
the culprit. In their own voice and manner, at most 18 words each, write:
- 'pressed': two different ways of telling the detective, who keeps asking about something they have already answered,
  that they have answered as best they can and will look at anything the detective has to show them;
- 'minimise' (only for the culprit; otherwise an empty list): two different ways of brushing off being caught out in
  something they said: they may have had it wrong, it proves nothing, and they have nothing more to say about it.
Each must state no fact at all: no place, time, person, event, object or reason that is a fact, and no denial.
Return {"lines": {"<id>": {"pressed": ["...", "..."], "minimise": [...]}}}."""
FALLBACKS_VERSION = 1


def add_fallback_lines(case):
    """case['pressed'][pid] and case['minimise'][culprit]: the play's last-resort lines, in each person's voice, for being
    pressed again on what they have answered and (the culprit) for being caught in an untrue account with nothing written
    for it. Fact-free like the declines: code rejects digits and names, a model drops any line that states a fact; play
    has plain lines for anyone left without."""
    from refine import llm_json, CRITIC_MODEL
    import premise
    if case.get('fallbacks_version') == FALLBACKS_VERSION:
        return 0
    setting = {q['id']: q for q in premise.SETTING.get('people', [])}
    truth = enrich.truth_actor(case) if case.get('question') else None
    roles = (case.get('setting') or {}).get('roles') or {}
    people = [p['id'] for p in case['people'] if p['id'] != enrich.victim_of(case)]
    people += [r for r in roles.values() if r not in people]
    items = [{'id': pid, 'name': setting.get(pid, {}).get('name', pid), 'voice': setting.get(pid, {}).get('voice'),
              'role': setting.get(pid, {}).get('role'), 'culprit': pid == truth} for pid in people]
    out = _field(llm_json(FALLBACKS, json.dumps(items), 3000, model=CRITIC_MODEL), 'lines')
    names = {w.lower() for q in setting.values() for w in str(q.get('name', '')).split() + [str(q.get('address', '')).split()[-1] if q.get('address') else '']
             if len(w) > 2 and w not in ('The', 'Reverend')}
    fine = lambda x: isinstance(x, str) and x.strip() and not re.search(r'\d', x) and len(x.split()) <= 18 \
        and not any(re.search(r'\b' + re.escape(w) + r'\b', x.lower()) for w in names)
    lines = {kind: {pid: [x.strip() for x in (_field(_field(out, pid) or {}, kind) or []) if fine(x)]
                    for pid in people if kind == 'pressed' or pid == truth} for kind in ('pressed', 'minimise')}
    flat = {f'{kind}|{pid}': ls for kind, by in lines.items() for pid, ls in by.items() if ls}
    if not flat:
        return 0
    verdicts = _field(llm_json(NO_FACT, json.dumps(flat), 2000, model=CRITIC_MODEL), 'verdicts')
    n = 0
    for kind in ('pressed', 'minimise'):
        case[kind] = {}
        for pid, ls in lines[kind].items():
            ok = _field(verdicts, f'{kind}|{pid}')
            kept = [x for x, v in zip(ls, ok if isinstance(ok, list) else []) if v is True or str(v).lower() == 'true']
            if kept:
                case[kind][pid] = kept; n += 1
    case['fallbacks_version'] = FALLBACKS_VERSION
    return n


def prune_people(case):
    """People the true history never mentions have nothing true to say about the night, so they are not part of the
    case (premise.involved, the same definition the generator's evening rule uses). Returns the ids removed."""
    import premise
    keep = premise.involved(case)
    gone = [p['id'] for p in case['people'] if p['id'] not in keep]
    case['people'] = [p for p in case['people'] if p['id'] not in gone]
    return gone


def _sightings_and_contradictions(case, log=lambda *a: None):
    """Who saw whom (read from the history, certified solve-neutral), then the contradictions that makes visible."""
    return add_sightings(case, log), record_contradictions(case, log)


_MISSING = object()


def parallel_phases(case, phases, log=print):
    """Run independent wording phases at once, each on its own copy of the case, and merge what each changed into the
    case: signs it added or removed, fields it set on signs, and top-level entries (knowledge, moods, declines, events).
    Phases in one call must write different things; a field two phases both change keeps the later phase's value (and
    is logged). Each phase gets the usual retry and timing (_phase)."""
    import concurrent.futures as cf
    import provenance
    base = copy.deepcopy(case)
    copies = [(getattr(ph, '__name__', 'phase'), copy.deepcopy(base)) for ph in phases]
    with cf.ThreadPoolExecutor(max_workers=len(phases)) as pool:
        futures = [provenance.submit_with_context(pool, _phase, ph, mine, log=log) for ph, (_, mine) in zip(phases, copies)]
        for f in futures:
            f.result()                       # a phase's own error, after its retry, stops the publication
    return _merge_copies(case, base, copies, log)


def _merge_copies(case, base, copies, log):
    before = {x['id']: x for x in base['signs']}
    owner = {}
    for name, res in copies:
        after = {x['id']: x for x in res['signs']}
        gone = [i for i in before if i not in after]
        new = [x for x in res['signs'] if x['id'] not in before]
        if gone:
            case['signs'] = [x for x in case['signs'] if x['id'] not in gone]
        have = {x['id'] for x in case['signs']}
        # keep where the phase put them: signs it added ahead of every existing one go first, the rest at the end
        first_old = next((k for k, x in enumerate(res['signs']) if x['id'] in before), len(res['signs']))
        front = [copy.deepcopy(x) for x in res['signs'][:first_old] if x['id'] not in before and x['id'] not in have]
        back = [copy.deepcopy(x) for x in new if x['id'] not in have and all(x['id'] != y['id'] for y in front)]
        case['signs'][:0] = front
        case['signs'].extend(back)
        live = {x['id']: x for x in case['signs']}
        for i, x in after.items():
            if i not in before or i not in live:
                continue
            for k in set(x) | set(before[i]):
                v = x.get(k, _MISSING)
                if v != before[i].get(k, _MISSING):
                    if (i, k) in owner and owner[(i, k)] != name:
                        log(f'  {name} and {owner[(i, k)]} both changed {i}.{k}; keeping {name}')
                    owner[(i, k)] = name
                    if v is _MISSING:
                        live[i].pop(k, None)
                    else:
                        live[i][k] = copy.deepcopy(v)
        for k in set(res) | set(base):
            if k == 'signs':
                continue
            v = res.get(k, _MISSING)
            if v != base.get(k, _MISSING):
                if v is _MISSING:
                    case.pop(k, None)
                else:
                    case[k] = copy.deepcopy(v)
    return case


def _phase(operation, *args, log=print, tries=2):
    """One wording phase: timed, and run again once when a model reply fails (an empty or unreadable reply is not the
    case's fault; one failure must not cost the whole publication)."""
    import refine, timing
    for attempt in range(1, tries + 1):
        started = time.time()
        try:
            with timing.phase(getattr(operation, '__name__', 'phase')):
                result = operation(*args)
            log(f'  {getattr(operation, "__name__", "phase")}: {time.time() - started:.0f}s')
            return result
        except (refine.LLMJSONResponseError, ConnectionError, TimeoutError) as error:
            if attempt == tries:
                raise
            log(f'  {getattr(operation, "__name__", "phase")} failed ({type(error).__name__}: {str(error)[:80]}); once more')


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
    # The wording is written in waves. Within a wave the phases do not depend on each other, so each runs at once on its
    # own copy of the case and what it wrote is merged back (they write different signs or different fields).
    import refine
    with refine.effort('low'):                         # wording needs no long deliberation; the reviews below check it
        parallel_phases(case, [add_surface_accounts, add_morning_accounts, add_medical, add_concessions,
                               enrich.add_knowledge, enrich.add_moods, add_declines, add_fallback_lines,
                               _sightings_and_contradictions], log)
        _phase(remove_promises, case, log=log)         # accounts final before the lines and reactions written for them
        parallel_phases(case, [mark_surface_truth, lambda c: add_questions(c, c.get('synopsis', '')), add_reactions,
                               add_show_lines, enrich.add_art], log)
        _phase(enrich.add_unlock_groups, case, log=log)   # leads that open together share one opening line
        for round_ in range(2):
            problems = _phase(enrich.review_publish, case, log=log)
            if problems:
                log(f'  review round {round_ + 1}: {len(problems)} lines dropped: ' + '; '.join(f'{k}: {v}' for k, v in list(problems.items())[:4]))
            if not problems:
                break
            parallel_phases(case, [add_medical, add_concessions, add_show_lines, add_reactions], log)
        _phase(finish_wording, case, log=log)
    return case


PROMISE = """Each item is something a person in a 1920s English village mystery tells the detective; 'clues' lists everything
the detective can find or be given in this case. Does the item offer the detective a thing to have, be shown or look at
(an object, a sample, a note, an envelope: "I've put them in an envelope for you", "I'll show you later") that is none of
the clues? Mentioning a thing is fine; offering it is the fault.
Return {"verdicts": {"<id>": {"offers": true | false, "what": "<for an offer: the thing offered>"}}}."""

REWORD = """Each item is an account a person in a 1920s English village mystery gives the detective, and 'drop': an offer in it
of something the detective will never be given. Rewrite the account without that offer. Keep everything else it says
(every fact, time, place, person and finding) and its voice and manner; add nothing.
Return {"accounts": {"<id>": "<the account without the offer>"}}."""

SAME_BUT = """Each item has an account ('before'), a rewrite ('after') and the offer the rewrite was to leave out ('drop'). Does
the rewrite say everything the account says except that offer, and nothing it does not say?
Return {"verdicts": {"<id>": {"same": true | false, "why": "<for a difference: what changed>"}}}."""
PROMISE_CHECK = 1


def remove_promises(case):
    """No account offers the detective something the case never gives them (playtest, November 8: the doctor said "I've
    put them in an envelope for you", and no envelope existed, so every answer to "where is it?" was invented). Each
    account not yet checked is judged; one that offers such a thing is reworded without the offer, kept only if a second
    judge finds it says the same otherwise. Wording only: claims are untouched. Returns the number reworded."""
    from refine import llm_json, CRITIC_MODEL
    todo = [x for x in case['signs'] if x.get('kind') == 'testimony' and x.get('text') and x.get('promise_checked') != PROMISE_CHECK]
    if not todo:
        return 0
    clues = sorted({x.get('title') for x in case['signs'] if x.get('kind') not in ('testimony', 'public') and x.get('title')})
    verdicts = judge(PROMISE, json.dumps({'clues': clues, 'items': [{'id': x['id'], 'text': x['text']} for x in todo]}),
                     [x['id'] for x in todo], 2000)
    offers = {x['id']: str(verdicts[x['id']].get('what') or 'the offer') for x in todo
              if isinstance(verdicts.get(x['id']), dict) and verdicts[x['id']].get('offers') is True}
    for x in todo:                                       # judged and offering nothing: checked
        v = verdicts.get(x['id'])
        if isinstance(v, dict) and v.get('offers') is False:
            x['promise_checked'] = PROMISE_CHECK
    if not offers:
        return 0
    by = {x['id']: x for x in todo}
    out = _accounts(llm_json(REWORD, json.dumps([{'id': i, 'account': by[i]['text'], 'drop': w} for i, w in offers.items()]),
                             2500, model=CRITIC_MODEL), list(offers))
    new = {i: str(out.get(i) or '').strip() for i in offers if str(out.get(i) or '').strip()}
    if not new:
        return 0
    same = judge(SAME_BUT, json.dumps([{'id': i, 'before': by[i]['text'], 'after': t, 'drop': offers[i]} for i, t in new.items()]),
                 list(new), 2000)
    n = 0
    for i, t in new.items():
        if isinstance(same.get(i), dict) and same[i].get('same') is True:
            by[i]['text'] = t; by[i]['promise_checked'] = PROMISE_CHECK; n += 1
    return n


def start_place(case, pid):
    """Where a person is when the investigation starts, as play places them (kernel-case.mjs): where they were watched
    behaving oddly, else the place of their latest event since the morning began, else their home."""
    places = {p['id'] for p in (case.get('setting') or {}).get('places', [])} or None
    ok = lambda pl: pl and (places is None or pl in places)
    watched = next((x['at'] for x in case['signs'] if x.get('kind') == 'behavior' and x.get('about') == pid and ok(x.get('at'))), None)
    if watched:
        return watched
    morning = enrich.day(case, 'morning')
    mine = [e for e in case['events'] if (e.get('agent') == pid or pid in (e.get('others') or [])) and morning is not None
            and e['start'] >= morning and ok(e.get('place'))]
    if mine:
        return max(enumerate(mine), key=lambda p: (p[1]['start'], p[0]))[1]['place']   # the last on a tie, as play
    return next((p.get('home') for p in case['people'] if p['id'] == pid), None) or \
        next((p.get('home') for p in enrich.SETTING.get('people', []) if p['id'] == pid), None)


def place_accounts(case):
    """An account is told wherever its speaker is, so its record names the place they are when the investigation starts
    (regeneration reviews, November 8: the doctor's findings were set at the scene she had left, which the review read as
    a clue no one could reach). Play does not use an account's place; the record only says where it is told. Returns the
    number moved."""
    n = 0
    for x in case['signs']:
        if x.get('kind') == 'testimony' and x.get('speaker'):
            where = start_place(case, x['speaker'])
            if where and x.get('at') != where:
                x['at'] = where; n += 1
    return n


def finish_wording(case, rounds=3):
    """Last over the wording, after every step that writes it: lines that do not say what their clue says are written
    again (each line is kept only once checked against its clue's text), and forms of address no one answers to are put
    right where the person meant is plain."""
    for _ in range(rounds):
        if not check_lines(case):
            break
        add_show_lines(case)
    check_lines(case, final=True)                      # what the last round wrote is checked too, and kept only if it agrees
    place_accounts(case)
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


def publish_reviewed(case):
    """Commit a candidate that already passed the strict whole-case review but was stopped by a later gate that has
    since been fixed (a kept runs/scripted-rejected case): every deterministic gate, the certificate binding and the
    scripted players are checked again on it as it is, and nothing is reworded."""
    serialized, post = _serialized_case(case, strict_publication_review=True)
    r, stamp = post['js'], case['id'].removeprefix('mk-live-')
    entry = {'id': case['id'], 'file': f"live/{case['id']}.json", 'title': case['title'], 'solveDepth': r['solveDepth'],
             'blurb': f"{case['synopsis']} Depth {r['solveDepth']}, {len(case['signs'])} clues, {len(case['question']['candidates'])} suspects.",
             'generated': stamp, 'difficulty': difficulty.index_rating(case['difficulty'])}
    _commit_live_case(serialized, entry, case.get('premise'))
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


_register_judges()
