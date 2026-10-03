// Bridge: a certified mystery-kernel case (docs/mystery-kernel.md) -> the runtime case interface the engine
// already plays. The case uses the Bellweather setting, so places, portraits and voices carry over; every
// object, document, secret, motive and layer comes from the generated case.
//
// What each part becomes:
//   true history events -> executed before the morning, remembered by the people who were there
//   attitudes           -> each character's beliefs (what they know, fear, want), used by free-text dialogue
//   non-testimony signs -> inspectable objects in their room; 'requires' keeps them hidden until earned
//   testimony signs     -> accounts a character can give (topics), available only once their gate opens;
//                          false testimony is flagged as deceptive so the character lies in character
//   'needs'             -> a clue's reading is revealed once what it needs is in the notebook
//   accusation          -> graded by the kernel over the evidence the player actually holds
import * as Original from '../case.mjs';
import {BW_PEOPLE, BW_LOCATIONS, BW_ROLES, BW_DEFAULT_VICTIM} from './village.mjs';
import {VERSION, NEUTRAL_LINE} from '../kernel.mjs';
import {analyse, survivors, actorOf, claimTrue, claimOf, pillarSigns, pillarSignsFor} from '../mk/kernel.mjs';
import {METHODS, MOTIVES} from '../mk/answer-types.mjs';

const clone = x => structuredClone(x), arr = v => (Array.isArray(v) ? v : []);
const KIND = {trace: 'Physical trace', document: 'Document', record: 'Record', item: 'Item', rule: 'Reference',
  observation: 'Observation', absence: 'Observation', behavior: 'Observation', testimony: 'Testimony'};
const MODE = {believes: 'I believe', knows: 'I know', wants: 'I want', fears: 'I fear', intends: 'I intend', feels: 'I feel'};
const START = 1920; // 08:00 the next morning, when the investigation begins
const LEAD = {wants: 'I wanted to', intends: 'I meant to', fears: 'I was afraid that', believes: 'I believed that', knows: 'I knew that', feels: 'I feel'};
const NAMES = new Set(Object.values(BW_PEOPLE).flatMap(p => p.name.split(' ')).concat(['Dr', 'Mr', 'Mrs', 'Miss', 'Constable', 'The', 'Reverend']));
function reason(a) {
  const text = String(a.content || '').trim().replace(/[.]+$/, '');
  const first = text.split(/\s+/)[0] || '';
  const body = NAMES.has(first) || /^[A-Z]{2,}/.test(first) ? text : text.charAt(0).toLowerCase() + text.slice(1);
  return `${LEAD[a.mode] || 'I had my reasons:'} ${body.replace(/^to /, '')}.`;
}

// Case records come from a model or from an imported save, and much of the UI renders case strings as HTML.
// Neutralise markup characters in every string so no record can inject HTML or attributes.
const SAFE = {'<': '‹', '>': '›', '"': '”', '`': '’'};
export function sanitizeRecords(value) {
  if (typeof value === 'string') return value.replace(/"([^"]*)"/g, '“$1”').replace(/[<>"`]/g, ch => SAFE[ch]);
  if (Array.isArray(value)) return value.map(sanitizeRecords);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeRecords(v)]));
  return value;
}

export function makeKernelCase(records) {
  const kc = sanitizeRecords(records);
  const id = kc.id;
  // The victim: stated by the case, else the subject of its death event, else the setting's default (data, not code).
  const death = kc.events.find(e => (e.type === 'death' || e.kind === 'death') && e.agent);
  const ROLES = {...BW_ROLES, ...(kc.setting?.roles || {})};
  const constable = ROLES.constable, examiner = ROLES.examiner;
  const NEUTRAL = NEUTRAL_LINE;   // the one stock line that claims nothing
  const victim = kc.victim || death?.agent || kc.setting?.victim || BW_DEFAULT_VICTIM;
  if (!victim) throw new Error(`case ${kc.id}: no victim (no death event)`);
  // Whether the history gives a person something true to say about last night: an event before the morning, or an account.
  const MORNING = kc.setting?.day?.morning ?? Infinity;
  const hasEvening = pid => kc.events.some(e => (e.agent === pid || (e.others || []).includes(pid)) && e.start < MORNING
    && e.id !== kc.question.crime.event) || kc.signs.some(x => x.kind === 'testimony' && x.speaker === pid);
  // People: those the case names (minus the victim), plus the constable; identity and character from Bellweather.
  const PEOPLE = {};
  for (const pid of [...new Set([...kc.people.map(p => p.id), constable])]) {
    if (pid === victim || !BW_PEOPLE[pid]) continue;
    const bw = clone(BW_PEOPLE[pid]), old = Original.PEOPLE[pid];
    PEOPLE[pid] = {...bw, traits: old ? clone(old.traits) : {loyalty: .5, secrecy: .4, riskAversion: .5},
      relationships: old ? clone(old.relationships) : {player: {trust: .6, affection: .2}}, values: [], goals: [], beliefSeeds: [],
      today: kc.moods?.[pid] ?? null};
  }
  // Places: the case's own setting (older cases have six; newer ones the whole village), with walking times.
  const placeIds = new Set(kc.setting.places.map(p => p.id).filter(p => BW_LOCATIONS[p]));
  const LOCATIONS = {}, OBJECTS = {}, CLUES = {};
  for (const pl of placeIds) {
    const l = clone(BW_LOCATIONS[pl]);
    l.links = Object.fromEntries(Object.entries(l.links).filter(([b]) => placeIds.has(b)));
    LOCATIONS[pl] = l;
  }
  // Someone watched behaving oddly at a place is at that place this morning (people keep to one place in play).
  for (const b of kc.signs.filter(x => x.kind === 'behavior' && x.about && PEOPLE[x.about] && BW_LOCATIONS[x.at])) {
    if (!PEOPLE[b.about].movedFor) { PEOPLE[b.about].home = b.at; PEOPLE[b.about].movedFor = b.id; }
  }
  const victimName = BW_PEOPLE[victim]?.name ?? 'the deceased', victimAddr = BW_PEOPLE[victim]?.address ?? 'Mr Vale';
  const signs = Object.fromEntries(kc.signs.map(s => [s.id, s]));
  const hyps = Object.fromEntries(kc.question.candidates.map(h => [h.id, h]));
  const truthActor = actorOf(hyps[kc.question.truth]);
  const crime = kc.events.find(e => e.id === kc.question.crime.event);
  const suspects = [...new Set(kc.question.candidates.map(actorOf).filter(p => PEOPLE[p]))];
  const attitudesOf = p => arr(kc.attitudes).filter(a => a.agent === p);

  for (const l of Object.values(LOCATIONS)) {
    l.objects = [];
    l.description = `${l.description} Constable Bell has authorised you to examine anything here.`;
  }
  for (const s of kc.signs) {
    CLUES[s.id] = {title: s.title || s.id, text: s.text, tags: [KIND[s.kind] || 'Observation'], kind: KIND[s.kind] || 'Observation', source: s.title || s.id,
      raw: s.kind, at: s.at ?? null, speaker: s.speaker ?? null, about: s.about ?? null, art: 'art' in s ? s.art : undefined,
      to: s.to ?? null};
    if (s.kind === 'testimony') continue;
    const at = LOCATIONS[s.at] ? s.at : 'square';
    OBJECTS[s.id] = {label: s.title || s.id, clue: s.id, description: s.kind === 'behavior' ? 'Watch more closely' : 'Examine this'};
    LOCATIONS[at].objects.push(s.id);
  }
  // Physical traits that clues test (shoe size, handedness...) are observable: add them to each public description.
  const TRAIT_WORDS = {shoe_size: v => `wears size ${v} shoes`, handed: v => `${v}-handed`};
  const tested = [...new Set(kc.signs.map(x => claimOf(x)).filter(c => c?.kind === 'trait').map(c => c.trait))];
  for (const kp of kc.people) {
    const P = PEOPLE[kp.id], t = kp.traits || {};
    const seen = tested.filter(k => t[k] != null).map(k => (TRAIT_WORDS[k] ?? (v => `${k.replace(/_/g, ' ')}: ${v}`))(t[k]));
    if (P && seen.length) P.public = `${P.public} You notice: ${seen.join(', ')}.`;
  }
  // Characters: public identity stays; private life comes from the generated case.
  for (const [pid, p] of Object.entries(PEOPLE)) {
    const mine = attitudesOf(pid);
    p.secret = mine.length ? mine.map(a => `${MODE[a.mode] || a.mode}: ${a.content}`).join('. ') : 'I have nothing to hide about last night.';
    p.goals = mine.filter(a => ['wants', 'intends'].includes(a.mode)).map(a => a.content).slice(0, 4);
    p.values = mine.filter(a => ['fears', 'feels'].includes(a.mode)).map(a => a.content).slice(0, 3);
    p.beliefSeeds = [];
  }
  const gatedObjects = kc.signs.filter(s => s.kind !== 'testimony' && arr(s.requires).length).map(s => s.id);
  const truthLabel = hyps[kc.question.truth]?.label ?? PEOPLE[truthActor]?.name;
  const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
  // The inspector's canonical history: every event of the true night, in order, with its place.
  function historyTimeline() {
    return [...kc.events].sort((a, b) => a.start - b.start)
      .map(e => [hhmm(e.start), `${e.summary || e.type}${LOCATIONS[e.place] ? ` (${LOCATIONS[e.place].name})` : ''}`]);
  }
  function truthSummary() {
    const who = PEOPLE[truthActor]?.name ?? truthLabel;
    // the whole chain of reasons behind the crime (what they knew, feared, wanted), not only the final intention
    const atts = Object.fromEntries(arr(kc.attitudes).map(a => [a.id, a])), chain = [], todo = [crime?.causedBy];
    while (todo.length) { const a = atts[todo.shift()]; if (a && !chain.includes(a)) { chain.push(a); todo.push(...arr(a.because)); } }
    // and what the culprit knew, feared or wanted about the victim, when the chain does not say
    const extra = arr(kc.attitudes).filter(a => a.agent === truthActor && ['knows', 'fears'].includes(a.mode) && !chain.includes(a)).slice(0, 2);
    const ORDER = {knows: 0, believes: 1, feels: 2, fears: 3, wants: 4, intends: 5};
    const reasons = [...chain, ...extra].sort((a, b) => (ORDER[a.mode] ?? 9) - (ORDER[b.mode] ?? 9));
    const why = reasons.length ? ` Why: ${reasons.map(a => a.content.replace(/[.]+$/, '')).join('; ')}.` : '';
    return `${who} killed ${victimName} at ${hhmm(crime?.start ?? 0)}.${why} ${crime?.summary ?? ''}`.trim();
  }
  const CASE = {
    id, title: kc.title || `${kc.setting.name} — ${kc.question.text}`, date: 'the morning after', victim: victimName, victimId: victim, victimFirst: victimAddr,
    victimRole: BW_PEOPLE[victim]?.role ?? 'The victim', victimPublic: BW_PEOPLE[victim]?.public ?? '',
    culprit: truthActor, synopsis: kc.synopsis || `${kc.question.text} Search the village, question its people, and see what holds up.`,
    truth: truthSummary(), history: historyTimeline(), proofRoutes: [], kernel: true, askMethod: Boolean(kc.answer?.method),
    methodOptions: METHODS, motiveOptions: MOTIVES, dayMorning: kc.setting?.day?.morning ?? null,
    suspects, topics: [['night', 'What is your account of last night?']],
    // the night question only for people the history gives an evening or an account (else there is nothing to tell)
    topicsFor: Object.fromEntries(Object.keys(PEOPLE).map(pid => [pid, [
      ...(pid === constable ? [['case', 'What do we know so far?']] : []),
      ...(hasEvening(pid) ? [['night', 'What is your account of last night?']] : []),
      ...(kc.signs.some(x => x.morning && x.speaker === pid) ? [['morning', 'What did you do this morning?']] : [])]])),
    resolutionText: `Bell reads your notes twice. “Every other account falls away. You have shown me how it was done and why, and nothing you rely on is a lie. ${PEOPLE[truthActor]?.name ?? 'The culprit'} it is.”`,
  };

  function baseWorld(seed = 17) {
    const npcs = {};
    for (const [pid, p] of Object.entries(PEOPLE))
      npcs[pid] = {location: p.home, travel: null, stress: .2, trust: p.relationships.player.trust, intention: 'Attend to the evening',
        plan: 'routine', beliefs: [], memories: [], lastDecision: null};
    const first = Math.min(START, ...kc.events.map(e => e.start));
    return {version: VERSION, seed, caseId: id, caseRecords: kc, minute: first - 1, status: 'playing',
      player: {location: 'transit', evidence: [], pins: [], visited: ['square'], lastSeen: {}, notes: []}, npcs, objects: {},
      flags: {victimAlive: false, victimLocation: kc.question.crime.place, evidenceOrigins: {}, lockedObjects: [...gatedObjects], history: {}, read: []}, ending: null};
  }

  // The reasoning board reads claims in the notebook's format: whereabouts and the time of death, from the typed claims.
  const evidenceClaims = {};
  for (const x of kc.signs) {
    const c = claimOf(x);
    if (c?.kind === 'place' && PEOPLE[c.person] !== undefined || c?.kind === 'place' && c.person === victim)
      evidenceClaims[x.id] = [{key: x.id, subject: c.person, predicate: 'location', value: c.place,
        interval: {start: Math.round(c.start), end: Math.round(c.end)}, confidence: .9, attribution: x.title || x.id}];
    else if (c?.kind === 'time')
      evidenceClaims[x.id] = [{key: 'time_of_crime', subject: victim, predicate: 'death_time', value: 'window',
        interval: {start: Math.round(c.start), end: Math.round(c.end)}, confidence: .95, attribution: x.title || x.id}];
  }
  const [w0, w1] = kc.question.crime.window;
  CASE.night = [Math.floor((w0 - 45) / 15) * 15, Math.ceil((w1 + 45) / 15) * 15];   // the board's timeline span
  CASE.scene = kc.question.crime.place;
  const model = {CASE, PEOPLE, LOCATIONS, OBJECTS, CLUES, baseWorld, evidenceClaims, testimonyClues: [], version: VERSION,
    commitments: {[constable]: {location: BW_PEOPLE[constable]?.home ?? 'square', from: START}}, agentPermissions: {}, boundedInvestigation: false, modules: [],
    // No wandering routines in generated cases: everyone keeps to their own place through the morning, so the
    // player can always find them (the notebook says where). Only the case's own events move people.
    life: null, kernelCase: kc};

  function createBehavior(K) {
    const held = s => new Set(s.world.player.evidence.map(e => e.clue));
    const earned = (s, sid) => arr(signs[sid]?.requires).every(r => held(s).has(r));
    const ruleKnown = (s, rid) => kc.rules?.find(r => r.id === rid)?.knowledge === 'common'
      || kc.signs.some(x => x.kind === 'rule' && x.rule === rid && held(s).has(x.id));
    const accounts = (s, pid) => kc.signs.filter(x => x.kind === 'testimony' && x.speaker === pid && earned(s, x.id));
    const DAY_MORNING = kc.setting?.day?.morning ?? START;
    // A person's account of this morning (written at publish from their own morning events, like the evening one).
    const morningAccount = (s, pid) => accounts(s, pid).find(x => x.morning) ?? null;
    // Evening accounts before morning ones (the doctor's findings are not her account of last night).
    // The morning summary belongs to the morning question. Every other account is for the night's questions, whatever
    // event it came from (the doctor's findings come from this morning's examination but are about the death).
    const ofMorning = x => Boolean(x.morning);
    const fromMorning = x => (kc.events.find(e => e.id === x.source)?.start ?? 0) >= DAY_MORNING && !x.surface;
    const eveningFirst = (a, b) => fromMorning(a) - fromMorning(b);   // the evening first, then what came from the morning
    const historySource = (s, eid) => s.world.flags.history?.[eid] ?? null;

    function seedSession(s) {
      // Execute the true history: each event is committed at its minute and remembered by everyone present.
      const sources = {};
      for (const e of [...kc.events].sort((a, b) => a.start - b.start)) {
        if (e.start > s.world.minute) K.advance(s, e.start - s.world.minute, null);
        const present = [...new Set([e.agent, ...arr(e.others)].filter(p => PEOPLE[p]))];
        const ev = K.commit(s, {kind: 'observation', actor: e.agent && PEOPLE[e.agent] ? e.agent : 'world', location: e.place,
          title: e.summary || e.type, data: {history: e.id, subject: e.agent ?? null, observedLocation: e.place, observedAction: e.summary}});
        sources[e.id] = ev;
        for (const p of present) K.remember(s, p, ev);
      }
      K.commit(s, {kind: 'observation', actor: 'world', title: 'The night is over', changes: {'flags.history': sources}});
      // Attitudes become beliefs, sourced to the event they caused (or the person's first remembered event).
      for (const pid of Object.keys(PEOPLE)) {
        const own = s.world.npcs[pid].memories;
        for (const a of attitudesOf(pid)) {
          const caused = kc.events.find(e => e.causedBy === a.id);
          const src = (caused && sources[caused.id]) || own[0] || Object.values(sources)[0];
          if (src) K.believe(s, pid, `mk_${a.id}`, `${MODE[a.mode] || a.mode}: ${a.content}`, Math.min(.99, a.strength ?? .9), 'observation', src, true);
        }
      }
      if (s.world.minute < START) K.advance(s, START - s.world.minute, null);
      K.commit(s, {kind: 'arrival', actor: 'player', title: 'You begin the investigation', data: {boundary: true},
        changes: {'player.location': 'square'}, playerText: CASE.synopsis});
    }

    // After any action: open earned gates (with their in-world reason) and reveal completed readings.
    function afterAction(s, cause) {
      const have = held(s), locked = arr(s.world.flags.lockedObjects), here = s.world.player.location;
      const earnedLeads = locked.filter(o => arr(signs[o]?.requires).every(r => have.has(r)));
      // A lead opens only where it is: its unlock text describes what happens there (a door, a person).
      const opened = earnedLeads.filter(o => signs[o].at === here || !LOCATIONS[signs[o].at]);
      const hinted = arr(s.world.flags.hinted), point = earnedLeads.filter(o => !opened.includes(o) && !hinted.includes(o));
      if (point.length)
        K.commit(s, {kind: 'observation', actor: 'player', title: 'A lead points elsewhere', parents: [cause],
          changes: {'flags.hinted': [...hinted, ...point]},
          // one sentence for every place a new lead points to: 'at the post office, the greenhouse and Village square'
          playerText: (names => `What you now know should open something ${names.length > 1 ? 'in several places' : 'at ' + names[0]}`
            + (names.length > 1 ? `: ${names.slice(0, -1).join(', ')} and ${names.at(-1)}.` : '.'))(
            [...new Set(point.map(o => String(LOCATIONS[signs[o].at].name).replace(/^The /, 'the ')))])});
      if (opened.length)
        K.commit(s, {kind: 'observation', actor: 'player', title: 'A further lead opens up', parents: [cause],
          changes: {'flags.lockedObjects': locked.filter(o => !opened.includes(o))},
          // leads that open together say what opened once (their shared lead line), then each its own line
          playerText: [...new Set(opened.map(o => signs[o].unlock_lead).filter(Boolean))].concat(
            opened.map(o => signs[o].unlock || `You can now examine ${CLUES[o].title.toLowerCase()}.`)).join('\n\n')});
      const read = arr(s.world.flags.read);
      const ready = [...have].filter(sid => arr(signs[sid]?.needs).length && !read.includes(sid)
        && arr(signs[sid].needs).every(n => (signs[n] ? have.has(n) : ruleKnown(s, n))));
      if (ready.length)
        K.commit(s, {kind: 'observation', actor: 'player', title: 'You put it together', parents: [cause],
          changes: {'flags.read': [...read, ...ready]},
          playerText: ready.map(sid => `${CLUES[sid].title}: ${signs[sid].reading || 'it makes sense now.'}`).join('\n\n')});
    }

    // A scripted, claimless evening account from the person's own true events (never evidence).
    // What this person can say of last night with no written account: only where the history puts them in the evening
    // (their own events before the morning), otherwise the one neutral line. Never a denial the history does not support.
    function eveningAccount(pid) {
      const morning = kc.setting?.day?.morning ?? Infinity;
      const mine = kc.events.filter(e => (e.agent === pid || arr(e.others).includes(pid)) && e.start < morning
          && e.causedBy !== 'nature' && e.id !== kc.question.crime.event)
        .sort((a, b) => a.start - b.start).map(e => e.place).filter(pl => LOCATIONS[pl]);
      const places = [...new Set(mine)].slice(0, 2).map(pl => String(LOCATIONS[pl].name).replace(/^The /, 'the '));
      return places.length ? `I was at ${places.join(', and later at ')} last evening.` : NEUTRAL;
    }

    // Progressive hints: the next thing the player can do, told gently first (level 1), then more plainly.
    function hints(s) {
      if (s.world.status === 'solved') return {id: 'solved', levels: ['The case is closed. Open the inspector to see everything that happened that night.']};
      const have = held(s);
      const A = analyse(kc), depth = id => A.eff[id] ?? 99;
      const st = caseStatus(s);
      // once opportunity is settled, steer toward the missing means or motive evidence (and what leads to it)
      const P = pillarSigns(kc, A);
      // Held evidence can point at an innocent (a lie or a mistake the player has not yet seen through). Hints never
      // endorse that: they steer toward what defeats the false account the player is relying on.
      const misled = st.lead && st.lead !== truthActor;
      const defeaters = misled ? kc.signs.filter(d => arr(d.defeats).some(f => have.has(f) && A.truthval[f] === false)).map(d => d.id) : [];
      const missing = misled ? defeaters : st.opportunity ? [...(st.means ? [] : P.means), ...(st.motive ? [] : P.motive)] : [];
      const toward = new Set();
      const walk = id => { if (toward.has(id) || !signs[id]) return; toward.add(id); for (const r of [...arr(signs[id].requires), ...arr(signs[id].needs)]) walk(r); };
      missing.forEach(walk);
      const next = kc.signs.filter(x => !have.has(x.id) && earned(s, x.id))
        .sort((a, b) => (toward.has(b.id) ? 1 : 0) - (toward.has(a.id) ? 1 : 0) || depth(a.id) - depth(b.id) || (claimOf(b) ? 1 : 0) - (claimOf(a) ? 1 : 0));
      const x = missing.length && !next.some(n => toward.has(n.id)) ? null : next[0];
      const lead = PEOPLE[st.lead]?.name;
      if (misled && x && toward.has(x.id)) {
        const base = hintText(s, x);
        return {id: x.id, levels: [`What you hold points at ${lead}, but one of the things you are relying on may not be true.`, ...base.levels.slice(1)]};
      }
      if (st.opportunity && missing.length && x && toward.has(x.id)) {
        const need = !st.means ? 'how it was done' : 'why';
        const base = hintText(s, x);
        return {id: x.id, levels: [`On what you hold, only ${lead} could have done it. You still need to show ${need}.`, ...base.levels.slice(1)]};
      }
      if (!x) {
        const sv = st.remaining;
        return {id: 'accuse', levels: [
          'You may already know more than you think. Look back over what you have found.',
          sv.length === 1 && sv[0] === truthActor ? `What you hold rules out every suspect but ${PEOPLE[sv[0]]?.name}, and shows how and why.` : 'Compare each account with the records; one of them does not hold up.',
          'Take your notebook to Constable Bell in the square: name the one person your evidence does not clear, how it was done, and why.']};
      }
      return hintText(s, x);
    }
    function hintText(s, x) {
      const here = s.world.player.location;
      const kindWord = k => ({trace: 'a mark or trace', document: 'a document', record: 'a record', item: 'an object', behavior: 'someone behaving oddly',
        observation: 'something worth a closer look', absence: 'something that is missing', rule: 'a reference or notice'}[k] || 'something');
      const place = n => { const x = LOCATIONS[n]?.name ?? 'the village'; return n === 'square' ? 'the village square' : x.startsWith('The ') ? 'the ' + x.slice(4) : x; };
      if (x.kind === 'testimony') {
        const who = PEOPLE[x.speaker]?.name ?? 'someone', where = s.world.npcs[x.speaker]?.location;
        const prereq = arr(x.requires).map(r => signs[r]).find(Boolean);
        const topic = followupOptions(s, x.speaker).find(([t]) => t === x.id || t === 'more')?.[1] ?? 'What is your account of last night?';
        return {id: x.id, levels: [
          prereq ? `Something you found may loosen someone's tongue.` : `Someone has more to tell you than they have said so far.`,
          `${who}${LOCATIONS[where] ? ` (now at ${place(where)})` : ''} is worth talking to${prereq ? ` now that you have ${String(prereq.title || 'that').toLowerCase()}` : ''}.`,
          `Ask ${who}: “${topic}”`]};
      }
      if (arr(s.world.flags.lockedObjects).includes(x.id))
        return {id: x.id, levels: ['What you have found points somewhere you have not looked yet.', `Go to ${place(x.at)}.`,
          `At ${place(x.at)}: ${x.unlock || `examine ${String(x.title).toLowerCase()}`}`]};
      return {id: x.id, levels: [
        x.at === here ? 'There is still something here worth your attention.' : `There is still something worth examining at ${place(x.at)}.`,
        `Look around ${place(x.at)} for ${kindWord(x.kind)} you have not examined yet.`,
        `Examine “${x.title}” at ${place(x.at)}.`]};
    }

    function decide(s, pid, cause) {
      if (s.world.minute < START || s.world.npcs[pid].travel || s.world.player.conversation === pid) return;
      K.startTravel(s, pid, PEOPLE[pid].home, cause, 'Return to my morning duties');
    }

    const GENERIC = new Set(['night', 'more', 'case', 'alibi', 'accounts', 'sightings', 'observations']);
    const canAsk = (s, pid, topic) => Boolean(PEOPLE[pid] && K.local(s, pid) && !s.world.npcs[pid].travel
      && (GENERIC.has(topic) || (topic === 'everyday' && everyday(pid)) || (topic === 'morning' && morningAccount(s, pid)) || accounts(s, pid).some(x => x.id === topic)
        || (String(topic).startsWith('why:') && ownBehaviour(s, pid).some(x => `why:${x.id}` === topic))));

    const everyday = pid => arr(kc.knowledge?.[pid]).join(' ') || null;
    // Speak a testimony sign and record it (its truth is computed, never declared). A claimless account's
    // deception is its published flag; the AI may voice a claimless account either way (flexible).
    function giveAccount(s, pid, x, cause) {
      const deceptive = claimOf(x) ? !claimTrue(kc, claimOf(x)) : Boolean(x.deceptive);
      const named = x.concede && s.world.npcs[pid].beliefs.some(b => b.key === `mk_named_${x.id}`);
      const text = named ? Object.values(x.concede)[0] : x.text;
      const ev = K.speech(s, pid, text, cause, {topic: x.id, intent: deceptive ? 'Protect my secret' : 'Answer from my own experience',
        basis: `mk_${arr(x.because)[0] ?? ''}`, deception: deceptive ? 'False account' : false, deceptionFlexible: !claimOf(x),
        sourceEvents: [historySource(s, x.source)].filter(Boolean), claims: []});
      if (!K.has(s, x.id)) K.addEvidence(s, x.id, ev, `${PEOPLE[pid].name}`);
      return ev;
    }
    function ask(s, pid, topic, cause) {
      if (!canAsk(s, pid, topic)) { K.reject(s, 'Conversation unavailable', 'Find this person and choose an available question.', cause); return; }
      if (String(topic).startsWith('why:')) { present(s, pid, topic.slice(4), 'private', cause); return; }
      const sign = signs[topic];
      const conceded = sign && s.world.npcs[pid].beliefs.find(b => b.key === `mk_conceded_${sign.id}`);
      const give = x => giveAccount(s, pid, x, cause);
      if (topic === 'morning') {
        const m = morningAccount(s, pid);
        if (K.has(s, m.id)) K.speech(s, pid, `As I told you: ${m.text}`, cause, {topic, intent: 'Recap', claims: [], deceptionFlexible: Boolean(m.deceptive)});
        else give(m);
        K.advance(s, 2, cause);
        return;
      }
      if (topic === 'everyday') {
        // plain facts of this person's life (routine, work, keys, who found the body): certified not to affect the solve
        K.speech(s, pid, everyday(pid), cause, {topic, intent: 'Answer plainly', claims: [], deceptionFlexible: false});
        K.advance(s, 2, cause);
        return;
      }
      if (conceded) {
        K.speech(s, pid, mistaken(sign) ? 'I only went by what I was told at the time. I would not swear to it now.'
          : 'I have told you the truth of it now, and I have nothing more to add.', cause, {topic, intent: 'Stand by the concession', claims: []});
      } else if (sign && sign.kind === 'testimony') {
        give(sign);
      } else if (topic === 'case') {
        K.speech(s, pid, briefing(s), cause, {topic, intent: 'Brief the detective', claims: []});
      } else {
        // questions about last night: never the morning account (it has its own question)
        const night = accounts(s, pid).filter(x => !ofMorning(x));
        const fresh = night.filter(x => !K.has(s, x.id) && !s.world.npcs[pid].beliefs.some(b => b.key === `mk_conceded_${x.id}`)).sort(eveningFirst);
        if (fresh.length) give(fresh[0]);
        else if (night.length) {
          const told = night.find(x => K.has(s, x.id) && !x.surface) ?? night.find(x => K.has(s, x.id)) ?? night[0];
          const admitted = s.world.npcs[pid].beliefs.find(b => b.key === `mk_admitted_${told.id}`);
          // once a story has been admitted untrue, the reference back is to what was admitted, never the old story
          K.speech(s, pid, admitted ? `As I have admitted: ${admitted.text}` : `As I told you: ${told.text}`, cause,
            {topic, intent: 'Recap', claims: [], deceptionFlexible: !admitted && night.some(x => x.deceptive)});
        }
        else K.speech(s, pid, eveningAccount(pid), cause, {topic, intent: 'Say little', claims: []});
      }
      K.advance(s, 3, cause);
    }

    // Bell's briefing uses only the case frame and navigation: the premise, who is under suspicion, and where
    // there is something to examine or someone willing to talk. It never states evidence.
    function briefing(s) {
      const names = suspects.map(p => PEOPLE[p].name);
      const open = new Set(s.world.flags.lockedObjects || []);
      const places = [...new Set(kc.signs.filter(x => x.kind !== 'testimony' && !open.has(x.id) && !K.has(s, x.id)).map(x => x.at))]
        .filter(pl => LOCATIONS[pl]).map(pl => LOCATIONS[pl].name);
      const talkers = [...new Set(kc.signs.filter(x => x.kind === 'testimony' && !K.has(s, x.id) && earned(s, x.id)).map(x => x.speaker))]
        .filter(p => PEOPLE[p] && p !== constable).map(p => PEOPLE[p].name);
      return [CASE.synopsis,
        `The people with reason or chance to be near him last night are ${names.slice(0, -1).join(', ')} and ${names.at(-1)}.`,
        places.length ? `There is something worth examining at ${places.slice(0, 4).join(', ')}.` : 'You have examined everything I know of.',
        talkers.length ? `${talkers.slice(0, 4).join(', ')} may be willing to talk.` : '',
        'Bring me a case where everyone else is ruled out, and where nothing you rely on turns out to be a lie.'].filter(Boolean).join(' ');
    }

    // ---- Showing evidence ------------------------------------------------------------------------------------
    // What the detective says: the line written for this clue when the case was generated (a confrontation when the
    // clue is this person's own behaviour), otherwise a short template by clue kind. Never the clue's full text.
    // A clue title inside a sentence: its own article or possessive kept (lower-cased), else "the" (names stay capitalised)
    const lower = t => {
      const s = String(t || 'this');
      if (/^(The|A|An|This|That|These|Those|His|Her|Their|Its|Some|Two|Three|Several) /.test(s)) return s.charAt(0).toLowerCase() + s.slice(1);
      const first = s.split(/[\s’']/)[0];
      if (NAMES.has(first) || /’s |'s /.test(s.split(' ').slice(0, 3).join(' ') + ' ')) return s;
      return 'the ' + s.charAt(0).toLowerCase() + s.slice(1);
    };
    // a place inside a sentence: 'the post office', not 'The post office' (proper names keep their capitals)
    const placeName = pl => String(LOCATIONS[pl]?.name ?? 'the village').replace(/^The /, 'the ');
    function mistaken(testimony) {
      const why = arr(kc.attitudes).filter(a => arr(testimony?.because).includes(a.id));
      return why.length > 0 && why.every(a => ['believes', 'knows'].includes(a.mode));
    }
    function presentLine(s, pid, clue) {
      const x = signs[clue];
      if (!x) return 'Take a look at this. What do you make of it?';
      if (x.kind === 'behavior' && x.about === pid) return x.confront || `About ${lower(x.title)} — why?`;
      if (x.kind === 'testimony' && x.speaker === pid) return x.confront || 'You told me this earlier. Do you stand by it?';
      // said to the person the clue concerns: addressed to them, never about them in the third person
      const madeBy = kc.events.find(e => e.id === x.source)?.agent;
      if (pid === (x.kind === 'testimony' ? claimOf(x)?.person : x.about ?? x.to) || pid === x.to || (pid === madeBy && x.kind !== 'testimony')) {
        if (x.direct && pid === x.to) return x.direct;
        if (x.kind === 'testimony') return `${PEOPLE[x.speaker]?.name ?? 'Someone'} has told me something about you. Is that right?`;
        return `I found ${lower(x.title)}. Can you tell me about it?`;
      }
      if (x.show) return x.show;
      if (x.kind === 'testimony') return `${PEOPLE[x.speaker]?.name ?? 'Someone'} told me something about last night. What do you make of it?`;
      if (x.kind === 'behavior') return `I noticed ${lower(x.title)}. Why would ${PEOPLE[x.about]?.name ?? 'they'} behave like that?`;
      if (x.kind === 'document' || x.kind === 'record') return `I found ${lower(x.title)}. Do you know anything about it?`;
      if (x.kind === 'item') return `I found this: ${lower(x.title)}. Have you seen it before?`;
      return `I noticed ${lower(x.title)} at ${placeName(x.at)}. What do you make of that?`;
    }
    // How the listener relates to the clue: they are its subject, took part in the event that produced it, spoke it,
    // or are uninvolved. Templates pick words that fit the clue's kind.
    // A reply worked out from the history only: what this person did, where they were, or one neutral line that claims
    // nothing. Never a denial the history does not support.
    function relationReply(pid, clue) {
      const x = signs[clue], src = kc.events.find(e => e.id === x.source);
      const mine = e => e && (e.agent === pid || arr(e.others).includes(pid));
      const where = placeName(x.at), thing = lower(x.title);
      if (pid === constable) return x.kind === 'testimony'
        ? `That is ${PEOPLE[x.speaker]?.name ?? 'their'}'s account. An account is only as good as what bears it out.`
        : 'Keep that in your notes. It may matter when you bring me your case.';
      if (x.kind === 'testimony') return x.speaker === pid ? 'That is what I told you, and I have nothing to add to it.'
        : `So that is what ${PEOPLE[x.speaker]?.name ?? 'they'} says. I can only tell you what I saw myself.`;
      if (x.kind === 'behavior') return x.about === pid ? 'I would rather not say.' : `You would have to ask ${PEOPLE[x.about]?.name ?? 'them'} about that.`;
      if (mine(src)) return pid === truthActor ? 'I don’t see what that proves.'
        : x.kind === 'document' || x.kind === 'record' ? `Yes, I know ${thing}.` : `Yes. I was at ${where} then.`;
      // true from the history: elsewhere for the whole time the clue was made
      const away = src && kc.events.some(e => mine(e) && e.place !== src.place && e.start <= src.start && e.end >= src.end);
      if (away && pid !== truthActor) return `I wasn’t at ${where} then, so I can’t tell you anything about it.`;
      return NEUTRAL;
    }

    function present(s, pid, clue, tone, cause) {
      if (!K.local(s, pid) || !K.has(s, clue)) { K.reject(s, 'Presentation unavailable', 'Discover the clue and find the person first.', cause); return; }
      const line = presentLine(s, pid, clue);
      const heard = K.commit(s, {kind: 'speech', actor: 'player', title: `You show ${PEOPLE[pid].name} ${CLUES[clue].title}`, parents: [cause],
        data: {listener: pid, clue, assertion: line}, playerText: K.presentLineHidden(s) ? null : `You\n“${line}”`});
      K.believe(s, pid, `player_has_${clue}`, `The detective showed me ${CLUES[clue].title}.`, .99, 'observation', heard, true);
      const caught = kc.signs.find(x => x.kind === 'testimony' && x.speaker === pid && arr(signs[clue].defeats).includes(x.id));
      // the player shows the innocent explanation of this person's suspicious behaviour (a red herring's payoff)
      const cleared = kc.signs.find(x => x.kind === 'behavior' && x.about === pid && arr(x.explainedBy).includes(clue));
      const have = held(s);
      // an account this clue completes: it was the last thing the account required, or it makes sense of it
      const unlocks = kc.signs.find(x => x.kind === 'testimony' && x.speaker === pid && !K.has(s, x.id)
        && (arr(x.requires).includes(clue) || arr(x.needs).includes(clue)) && arr(x.requires).every(r => have.has(r)));
      // an account already given that withheld something this clue now proves: the speaker concedes it
      const concedes = kc.signs.find(x => x.kind === 'testimony' && x.speaker === pid && K.has(s, x.id) && x.concede?.[clue]
        && !s.world.npcs[pid].beliefs.some(b => b.key === `mk_named_${x.id}`));
      // a clue that comes from this person's own doing (the doctor's own notes; a trace of what they did) draws their
      // own account of it, never a stranger's "I know nothing about that"
      const own = kc.signs.find(x => x.kind === 'testimony' && x.speaker === pid && earned(s, x.id)
        && x.source && x.source === signs[clue].source);
      // the culprit shown something that breaks the account that placed them elsewhere
      const alibiBroken = pid === truthActor && arr(signs[clue].defeats).some(d => claimOf(signs[d])?.person === pid);
      const secret = attitudesOf(pid).find(a => ['fears', 'wants', 'feels'].includes(a.mode) && !kc.events.some(e => e.causedBy === a.id && e.id === kc.question.crime.event));
      const written = signs[clue].reactions?.[pid];   // written for this person when the case was generated
      let text, intent = 'Respond to evidence';
      if (caught) {
        const why = arr(kc.attitudes).find(a => arr(caught.because).includes(a.id));
        text = written || (mistaken(caught)
          ? `Oh — then I had it wrong. ${why ? reason(why) : ''} I only went by what I was told at the time.`.replace(/\s+/g, ' ')
          : `…That is not what I told you, I know. ${why ? reason(why) : 'I was mistaken.'} I will not pretend otherwise now.`);
        intent = 'Concede';
        K.believe(s, pid, `mk_conceded_${caught.id}`, `My account (${caught.title || caught.id}) has been shown to be untrue: ${text}`, .99, 'observation', heard, true);
        K.believe(s, pid, `mk_admitted_${caught.id}`, text, .99, 'observation', heard, true);   // the words, for references back
      } else if (cleared) {
        text = written || `So you know. Yes. ${secret ? reason(secret) : 'I had a private reason.'} It is nothing to do with ${victimAddr}'s death, and I would thank you to keep it quiet.`;
        intent = 'Admit an innocent secret';
        K.believe(s, pid, `mk_explained_${cleared.id}`, `The detective knows the innocent reason for my behaviour: ${text}`, .99, 'observation', heard, true);
      } else if (own && !(pid === truthActor && arr(signs[clue].defeats).length)) {
        giveAccount(s, pid, own, heard);
        K.advance(s, 4, cause);
        return;
      } else if (concedes) {
        text = concedes.concede[clue];
        intent = 'Concede what the evidence shows';
        K.believe(s, pid, `mk_named_${concedes.id}`, `The detective has proof of what I held back; I have admitted it: ${text}`, .99, 'observation', heard, true);
        K.believe(s, pid, `mk_admitted_${concedes.id}`, text, .99, 'observation', heard, true);
      } else if (unlocks) {
        giveAccount(s, pid, unlocks, heard);
        K.advance(s, 4, cause);
        return;
      } else if (alibiBroken && written) {
        text = written; intent = 'Deflect';
      } else {
        text = written || relationReply(pid, clue);
      }
      // a reaction carries no claim: the character may meet the evidence honestly or with a lie (the culprit usually lies)
      K.speech(s, pid, text, heard, {topic: 'present', intent, claims: [], deceptionFlexible: true});
      K.advance(s, 4, cause);
    }

    // Accusation: motive, means and opportunity, each shown by evidence the player holds (and selected).
    //  opportunity: the kernel's survivors over that evidence are exactly the accused;
    //  means / motive: a held, true sign establishes the accused's means / motive;
    //  and the named method and motive match what happened. Z3's alternative story (fetched by the UI and
    //  passed in the action) is used for feedback only when the kernel agrees that person is still possible.
    const pron = pid => PEOPLE[pid]?.pronoun === 'she' ? ['she', 'her'] : ['he', 'his'];
    function standing(use) {
      const sub = {...kc, signs: kc.signs.filter(x => use.has(x.id)).map(x => ({...x, requires: [], unlock: 'held', reading: x.reading || 'held'}))};
      const A = analyse(sub);
      return {A, sv: survivors(sub, A), sub};
    }
    function pillarsFor(use, pid) {
      const {A, sv, sub} = standing(use);
      const h = kc.question.candidates.find(c => actorOf(c) === pid);
      const pil = pid ? pillarSignsFor(sub, A, pid, use) : {motive: [], means: []};
      return {sv, opportunity: Boolean(h) && sv.length === 1 && sv[0] === h.id, means: pil.means, motive: pil.motive};
    }
    const clock = m => { const h = Math.floor(m / 60) % 24, mi = Math.round(m % 60), hh = ((h + 11) % 12) + 1;
      return mi === 0 ? `${hh} o’clock` : mi === 30 ? `half past ${hh}` : mi === 15 ? `quarter past ${hh}` : mi === 45 ? `quarter to ${((h + 12) % 12) + 1}`
        : mi < 30 ? `${mi} past ${hh}` : `${60 - mi} to ${((h + 12) % 12) + 1}`; };
    function epilogue(have) {
      const P = pillarSigns(kc, analyse(kc));
      const missed = [...new Set([...P.motive, ...P.means])].filter(id => !have.has(id)).map(id => signs[id]);
      const herrings = kc.signs.filter(x => x.kind === 'behavior' && suspects.includes(x.about) && x.about !== truthActor && arr(x.explainedBy).length);
      const lines = [];
      for (const x of missed.slice(0, 3)) lines.push(`${x.title}: ${String(x.text).split(/(?<=[.!?])\s/)[0]}`);
      for (const b of herrings.slice(0, 3)) {
        const why = arr(b.explainedBy).map(e => signs[e]).find(Boolean);
        if (why && !have.has(why.id)) lines.push(`${PEOPLE[b.about]?.name}: ${String(why.text).split(/(?<=[.!?])\s/)[0]}`);
      }
      return lines.length ? `\n\nWhat the file adds, for the record:\n${lines.map(l => `• ${l}`).join('\n')}` : '';
    }
    function checkCase(s, action) {
      const have = held(s), chosen = arr(action.evidence).filter(c => have.has(c));
      const use = new Set(chosen.length ? chosen : [...have]);
      const pid = action.suspect, name = PEOPLE[pid]?.name ?? 'them', [he, his] = pron(pid);
      const accused = kc.question.candidates.find(h => actorOf(h) === pid);
      const st = pillarsFor(use, pid), sv = st.sv;
      const names = ids => ids.map(h => PEOPLE[actorOf(hyps[h])]?.name ?? hyps[h]?.label).join(', ');
      const pillars = {opportunity: st.opportunity, means: st.means.length > 0, motive: st.motive.length > 0};
      const answer = kc.answer || {};
      const askHow = Boolean(answer.method), howOk = !askHow || (answer.methods ?? [answer.method]).includes(action.method), whyOk = !askHow || (answer.motives ?? [answer.motive]).includes(action.motive);
      const alt = action.alternative && PEOPLE[action.alternative.actor] && action.alternative.actor !== pid
        && sv.some(h => actorOf(hyps[h]) === action.alternative.actor) && Number.isFinite(action.alternative.minute) ? action.alternative : null;
      let feedback = null, status = 'supported';
      if (!accused) { feedback = '“Name one of the people who could have done it.”'; status = 'ambiguous'; }
      else if (!sv.length) { feedback = '“Your evidence rules out everyone, including the person you accuse. One of the accounts you are relying on must be false.”'; status = 'inconsistent'; }
      else if (!sv.includes(accused.id)) { feedback = `“Your own evidence clears ${name}.”`; status = 'cleared'; }
      else if (!pillars.opportunity) {
        feedback = alt ? `“${PEOPLE[alt.actor].name} could still have been at ${placeName(kc.question.crime.place)} at ${clock(alt.minute)}, and nothing you have shown me says otherwise. Rule that out and I’ll listen.”`
          : `“This still leaves ${names(sv)} possible. I need evidence that rules the others out.”`;
        status = 'ambiguous';
      } else if (!pillars.means) { feedback = `“You have shown me ${name} could have been there. Now show me how: what put the means in ${his} hands?”`; status = 'no_means'; }
      else if (!pillars.motive) { feedback = `“You have shown me ${name} could have done it, and how. But why would ${he}? Find me the reason.”`; status = 'no_motive'; }
      else if (!howOk) { feedback = '“Your evidence does not bear out that it was done that way. Look again at how he died.”'; status = 'wrong_method'; }
      else if (!whyOk) { feedback = `“The evidence you hold points to a different reason. Read ${st.motive.map(id => `‘${signs[id]?.title}’`).join(' and ')} again.”`; status = 'wrong_motive'; }
      else if (pid !== truthActor) { feedback = '“It hangs together on paper, but something you rely on has not been tested. Check every account against the evidence before I charge anyone.”'; status = 'untested'; }
      const supported = status === 'supported';
      if (supported) feedback = CASE.resolutionText + `\n\nWhat happened: ${CASE.truth}` + epilogue(have);
      return {supported, selected: [...use], routes: [], feedback, status, alternatives: sv, pillars,
              pillarEvidence: {means: st.means, motive: st.motive}, alternative: alt};
    }
    // What the held evidence establishes so far, for the leading suspect (the only one left, if any).
    // For the board: which pillars the held evidence really establishes for this suspect (same check as Bell's).
    function pillarsHeld(s, pid) {
      const st = pillarsFor(held(s), pid);
      return {opportunity: st.opportunity, means: st.means.length > 0, motive: st.motive.length > 0,
              evidence: {means: st.means, motive: st.motive}, remaining: st.sv.map(h => actorOf(hyps[h]))};
    }
    function caseStatus(s) {
      const have = held(s), {sv} = standing(have);
      const lead = sv.length === 1 ? actorOf(hyps[sv[0]]) : null;
      const st = lead ? pillarsFor(have, lead) : null;
      return {remaining: sv.map(h => actorOf(hyps[h])), lead, opportunity: Boolean(st?.opportunity),
              means: Boolean(st?.means.length), motive: Boolean(st?.motive.length)};
    }

    // Topics never reveal an account's content. Ungated accounts come one at a time through the night question
    // ('more' after the first); an account earned by a clue is asked about in terms of that clue.
    const heardAny = (s, pid) => s.events.some(e => e.kind === 'speech' && e.actor === pid && e.data?.listener === 'player' && signs[e.data.topic]);
    // behaviour you have observed in this person can be put to them directly ("why:<clue>")
    const ownBehaviour = (s, pid) => kc.signs.filter(x => x.kind === 'behavior' && x.about === pid && K.has(s, x.id));
    const followupOptions = (s, pid) => {
      const open = accounts(s, pid).filter(x => !K.has(s, x.id));
      const out = ownBehaviour(s, pid).map(x => [`why:${x.id}`, presentLine(s, pid, x.id)]);
      // every open account with its own question is offered by that question (the evening and morning summaries have
      // theirs in the menu already); "anything else" stays for what has no question of its own
      const own = x => !x.surface && !x.morning && (arr(x.requires).length || x.ask);
      if (heardAny(s, pid) && open.some(x => !own(x) && !x.surface && !x.morning)) out.push(['more', 'Is there anything else you remember about last night?']);
      for (const x of open.filter(own)) {
        const prereq = arr(x.requires).length ? signs[arr(x.requires).find(r => signs[r] && signs[r].kind !== 'testimony') ?? x.requires[0]] : null;
        const about = prereq ? String(prereq.title || 'what I found').replace(/^(the|a|an) /i, '').toLowerCase() : 'what I found';
        // the account's own question (written not to give its content away), else a question about what earned it
        let label = x.ask || (prereq?.kind === 'testimony' ? 'Someone told me something about you. Can you explain?' : `What can you tell me about the ${about}?`);
        if (out.some(([, l]) => l === label)) label = `${label.replace(/\?$/, '')} — and anything else about it?`;
        if (!out.some(([, l]) => l === label)) out.push([x.id, label]);
      }
      return out;
    };
    function parseCommand(text) {
      const w = text.toLowerCase().trim().split(/\s+/);
      if (['go', 'move', 'walk'].includes(w[0])) return {type: 'move', to: w[1]};
      if (['inspect', 'search'].includes(w[0])) return {type: 'inspect', object: w[1]};
      if (w[0] === 'wait') return {type: 'wait', minutes: Number(w[1])};
      if (w[0] === 'ask') return {type: 'ask', person: w[1], topic: w.at(-1)};
      return {type: 'look'};
    }
    // Free-text questions may draw on every account this person can give now (the buttons still offer them one at a
    // time), so "did you see Voss?" can be answered from the account about Voss.
    const freeTextTopics = (s, pid) => [...(everyday(pid) ? ['everyday'] : []), ...accounts(s, pid).map(x => x.id)];
    return {seedSession, afterAction, decide, canAsk, ask, present, presentLine, checkCase, caseStatus, pillarsHeld, followupOptions, freeTextTopics, hints, parseCommand, reconcileKnowledge() {},
      commandLabel: a => `${a.type} ${a.person ?? a.object ?? a.to ?? ''}`, caseHealth: () => []};
  }
  return {CASE, LOCATIONS, PEOPLE, CLUES, OBJECTS, model, baseWorld, createBehavior, SUSPECTS: suspects,
    PILLARS: [['motive', 'Motive'], ['means', 'Means'], ['opportunity', 'Opportunity']]};
}
