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
import {VERSION} from '../kernel.mjs';
import {BELLWEATHER_LIFE} from './bellweather-life.mjs';
import {analyse, survivors, actorOf, claimTrue, claimOf} from '../mk/kernel.mjs';

const clone = x => structuredClone(x), arr = v => (Array.isArray(v) ? v : []);
const KIND = {trace: 'Physical trace', document: 'Document', record: 'Record', item: 'Item', rule: 'Reference',
  observation: 'Observation', absence: 'Observation', behavior: 'Observation', testimony: 'Testimony'};
const MODE = {believes: 'I believe', knows: 'I know', wants: 'I want', fears: 'I fear', intends: 'I intend', feels: 'I feel'};
const START = 1920; // 08:00 the next morning, when the investigation begins
const LEAD = {wants: 'I wanted to', intends: 'I meant to', fears: 'I was afraid that', believes: 'I believed that', knows: 'I knew that', feels: 'I feel'};
const NAMES = new Set(Object.values(Original.PEOPLE).map(p => p.name.split(' ')[0]).concat(['Edmund', 'Dr', 'Mr', 'Mrs', 'Miss', 'Constable']));
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
  const PEOPLE = clone(Original.PEOPLE), LOCATIONS = clone(Original.LOCATIONS), OBJECTS = {}, CLUES = {};
  const signs = Object.fromEntries(kc.signs.map(s => [s.id, s]));
  const hyps = Object.fromEntries(kc.question.candidates.map(h => [h.id, h]));
  const truthActor = actorOf(hyps[kc.question.truth]);
  const crime = kc.events.find(e => e.id === kc.question.crime.event);
  const suspects = [...new Set(kc.question.candidates.map(actorOf).filter(p => PEOPLE[p]))];
  const attitudesOf = p => arr(kc.attitudes).filter(a => a.agent === p);

  for (const l of Object.values(LOCATIONS)) {
    l.objects = [];
    l.description = `${l.name} is quiet this morning. Constable Bell has authorised you to examine anything here.`;
  }
  for (const s of kc.signs) {
    CLUES[s.id] = {title: s.title || s.id, text: s.text, tags: [KIND[s.kind] || 'Observation'], kind: KIND[s.kind] || 'Observation', source: s.title || s.id,
      // what the detective says when showing it (the clue's content travels with it as the presented description)
      presentLine: s.kind === 'testimony'
        ? `This is what ${PEOPLE[s.speaker]?.name ?? 'someone'} told me: “${s.text}” What do you make of that?`
        : `Take a look at this: ${String(s.title || 'this').toLowerCase()}. ${s.text} What do you make of it?`};
    if (s.kind === 'testimony') continue;
    const at = LOCATIONS[s.at] ? s.at : 'square';
    OBJECTS[s.id] = {label: s.title || s.id, clue: s.id, description: s.kind === 'behavior' ? 'Watch more closely' : 'Examine this'};
    LOCATIONS[at].objects.push(s.id);
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
  const CASE = {
    id, title: kc.title || `${kc.setting.name} — ${kc.question.text}`, date: 'the morning after', victim: 'Edmund Vale',
    culprit: truthActor, synopsis: kc.synopsis || `${kc.question.text} Search the village, question its people, and see what holds up.`,
    truth: `${truthLabel}. ${crime?.summary ?? ''}`.trim(), history: [], proofRoutes: [], kernel: true, askMethod: false,
    suspects, topics: [['night', 'What is your account of last night?']],
    topicsFor: {bell: [['case', 'What do we know so far?'], ['night', 'What is your account of last night?']]},
    resolutionText: `Bell reads your notes twice. “Every other account falls away, and nothing you rely on is a lie. ${PEOPLE[truthActor]?.name ?? 'The culprit'} it is.”`,
  };

  function baseWorld(seed = 17) {
    const npcs = {};
    for (const [pid, p] of Object.entries(PEOPLE))
      npcs[pid] = {location: p.home, travel: null, stress: .2, trust: p.relationships.player.trust, intention: 'Attend to the evening',
        plan: 'routine', beliefs: [], memories: [], lastDecision: null};
    const first = Math.min(START, ...kc.events.map(e => e.start));
    return {version: VERSION, seed, caseId: id, caseRecords: kc, minute: first - 1, status: 'playing',
      player: {location: 'transit', evidence: [], pins: [], visited: ['square'], lastSeen: {}, notes: []}, npcs, objects: {},
      flags: {victimAlive: false, victimLocation: 'manor', evidenceOrigins: {}, lockedObjects: [...gatedObjects], history: {}, read: []}, ending: null};
  }

  const model = {CASE, PEOPLE, LOCATIONS, OBJECTS, CLUES, baseWorld, evidenceClaims: {}, testimonyClues: [], version: VERSION,
    commitments: {bell: {location: 'square', from: START}}, agentPermissions: {}, boundedInvestigation: false, modules: [],
    life: BELLWEATHER_LIFE, kernelCase: kc};

  function createBehavior(K) {
    const held = s => new Set(s.world.player.evidence.map(e => e.clue));
    const earned = (s, sid) => arr(signs[sid]?.requires).every(r => held(s).has(r));
    const ruleKnown = (s, rid) => kc.rules?.find(r => r.id === rid)?.knowledge === 'common'
      || kc.signs.some(x => x.kind === 'rule' && x.rule === rid && held(s).has(x.id));
    const accounts = (s, pid) => kc.signs.filter(x => x.kind === 'testimony' && x.speaker === pid && earned(s, x.id));
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
          playerText: [...new Set(point.map(o => LOCATIONS[signs[o].at].name))].map(n => `What you now know should open something at ${n}.`).join(' ')});
      if (opened.length)
        K.commit(s, {kind: 'observation', actor: 'player', title: 'A further lead opens up', parents: [cause],
          changes: {'flags.lockedObjects': locked.filter(o => !opened.includes(o))},
          playerText: opened.map(o => signs[o].unlock || `You can now examine ${CLUES[o].title.toLowerCase()}.`).join('\n\n')});
      const read = arr(s.world.flags.read);
      const ready = [...have].filter(sid => arr(signs[sid]?.needs).length && !read.includes(sid)
        && arr(signs[sid].needs).every(n => (signs[n] ? have.has(n) : ruleKnown(s, n))));
      if (ready.length)
        K.commit(s, {kind: 'observation', actor: 'player', title: 'You put it together', parents: [cause],
          changes: {'flags.read': [...read, ...ready]},
          playerText: ready.map(sid => `${CLUES[sid].title}: ${signs[sid].reading || 'it makes sense now.'}`).join('\n\n')});
    }

    function decide(s, pid, cause) {
      if (s.world.minute < START || s.world.npcs[pid].travel || s.world.player.conversation === pid) return;
      if (K.life.decide(s, pid)) return;
      K.startTravel(s, pid, PEOPLE[pid].home, cause, 'Return to my morning duties');
    }

    const GENERIC = new Set(['night', 'case', 'alibi', 'accounts', 'sightings', 'observations']);
    const canAsk = (s, pid, topic) => Boolean(PEOPLE[pid] && K.local(s, pid) && !s.world.npcs[pid].travel
      && (GENERIC.has(topic) || accounts(s, pid).some(x => x.id === topic)));

    function ask(s, pid, topic, cause) {
      if (!canAsk(s, pid, topic)) { K.reject(s, 'Conversation unavailable', 'Find this person and choose an available question.', cause); return; }
      const sign = signs[topic];
      const conceded = sign && s.world.npcs[pid].beliefs.find(b => b.key === `mk_conceded_${sign.id}`);
      const give = x => {   // speak a testimony sign and record it (its truth is computed, never declared)
        // a claim's truth is computed; a claimless account is deceptive only when it hides the speaker's crime
        const deceptive = claimOf(x) ? !claimTrue(kc, claimOf(x)) : Boolean(x.deceptive);
        const ev = K.speech(s, pid, x.text, cause, {topic: x.id, intent: deceptive ? 'Protect my secret' : 'Answer from my own experience',
          basis: `mk_${arr(x.because)[0] ?? ''}`, deception: deceptive ? 'False account' : false,
          sourceEvents: [historySource(s, x.source)].filter(Boolean), claims: []});
        K.addEvidence(s, x.id, ev, `${PEOPLE[pid].name}`);
      };
      if (conceded) {
        K.speech(s, pid, 'You already know that account was not true. I have nothing to add to what I admitted.', cause, {topic, intent: 'Stand by the concession', claims: []});
      } else if (sign && sign.kind === 'testimony') {
        give(sign);
      } else if (topic === 'case' || (pid === 'bell' && !accounts(s, pid).length)) {
        K.speech(s, pid, briefing(s), cause, {topic, intent: 'Brief the detective', claims: []});
      } else {
        const fresh = accounts(s, pid).filter(x => !K.has(s, x.id) && !s.world.npcs[pid].beliefs.some(b => b.key === `mk_conceded_${x.id}`));
        if (fresh.length) give(fresh[0]);
        else if (accounts(s, pid).length) K.speech(s, pid, `I have told you what I know about last night. ${accounts(s, pid).map(x => x.title).filter(Boolean).slice(0, 3).join('; ')}.`, cause, {topic, intent: 'Recap', claims: []});
        else K.speech(s, pid, 'There is nothing much to tell. It was an ordinary evening for me, and I did not see Mr Vale.', cause, {topic, intent: 'Say little', claims: []});
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
        .filter(p => PEOPLE[p] && p !== 'bell').map(p => PEOPLE[p].name);
      return [CASE.synopsis,
        `The people with reason or chance to be near him last night are ${names.slice(0, -1).join(', ')} and ${names.at(-1)}.`,
        places.length ? `There is something worth examining at ${places.slice(0, 4).join(', ')}.` : 'You have examined everything I know of.',
        talkers.length ? `${talkers.slice(0, 4).join(', ')} may be willing to talk.` : '',
        'Bring me a case where everyone else is ruled out, and where nothing you rely on turns out to be a lie.'].filter(Boolean).join(' ');
    }

    function present(s, pid, clue, tone, cause) {
      if (!K.local(s, pid) || !K.has(s, clue)) { K.reject(s, 'Presentation unavailable', 'Discover the clue and find the person first.', cause); return; }
      const heard = K.commit(s, {kind: 'speech', actor: 'player', title: `You show ${PEOPLE[pid].name} ${CLUES[clue].title}`, parents: [cause],
        data: {listener: pid, clue, assertion: CLUES[clue].text}, playerText: K.presentLineHidden(s) ? null : `You show ${PEOPLE[pid].name} ${CLUES[clue].title.toLowerCase()}.`});
      K.believe(s, pid, `player_has_${clue}`, `The detective showed me ${CLUES[clue].title}.`, .99, 'observation', heard, true);
      const caught = kc.signs.find(x => x.kind === 'testimony' && x.speaker === pid && arr(signs[clue].defeats).includes(x.id));
      // the player shows the innocent explanation of this person's suspicious behaviour (a red herring's payoff)
      const cleared = kc.signs.find(x => x.kind === 'behavior' && x.about === pid && arr(x.explainedBy).includes(clue));
      const unlocks = kc.signs.find(x => x.kind === 'testimony' && x.speaker === pid && arr(x.requires).includes(clue) && !K.has(s, x.id));
      const secret = attitudesOf(pid).find(a => ['fears', 'wants', 'feels'].includes(a.mode) && !kc.events.some(e => e.causedBy === a.id && e.id === kc.question.crime.event));
      let text, intent = 'Respond to evidence';
      if (caught) {
        const why = arr(kc.attitudes).find(a => arr(caught.because).includes(a.id));
        text = `…That is not what I told you, I know. ${why ? reason(why) : 'I was mistaken.'} I will not pretend otherwise now.`;
        intent = 'Concede';
        K.believe(s, pid, `mk_conceded_${caught.id}`, `My account (${caught.title || caught.id}) has been shown to be untrue: ${text}`, .99, 'observation', heard, true);
      } else if (cleared) {
        text = `So you know. Yes. ${secret ? reason(secret) : 'I had a private reason.'} It is nothing to do with Mr Vale's death, and I would thank you to keep it quiet.`;
        intent = 'Admit an innocent secret';
        K.believe(s, pid, `mk_explained_${cleared.id}`, `The detective knows the innocent reason for my behaviour: ${text}`, .99, 'observation', heard, true);
      } else if (unlocks) {
        text = pid === truthActor ? 'Where did you get that? …Very well. Ask me what you want to know.' : 'Ah. Then I suppose I had better tell you what I know. Ask me.';
        intent = 'Agree to talk';
      } else if (signs[clue].kind === 'testimony' && signs[clue].speaker === pid) {
        text = 'That is what I told you, and I have nothing to add to it.';
      } else if (pid === 'bell') {
        text = `I've read it. ${signs[clue].kind === 'testimony' ? `That is ${PEOPLE[signs[clue].speaker]?.name ?? 'their'}'s account, and an account is only as good as what bears it out.` : 'Keep it in your notes; it may matter when you bring me your case.'}`;
      } else {
        // react from the character's own position: were they part of what the clue records?
        const src = kc.events.find(e => e.id === signs[clue].source);
        const there = src && (src.agent === pid || arr(src.others).includes(pid));
        const about = signs[clue].kind === 'testimony' ? `So that is what ${PEOPLE[signs[clue].speaker]?.name ?? 'they'} says.` : `I see what it says.`;
        text = pid === truthActor
          ? `${about} I don't see what it has to do with me.`
          : there ? `${about} Yes, that is how it was; I was there.`
          : `${about} I wasn't there, so I can't tell you whether it's right.`;
      }
      K.speech(s, pid, text, heard, {topic: 'present', intent, claims: []});
      K.advance(s, 4, cause);
    }

    // Accusation: the kernel filters candidates using only the evidence the player holds (and selected).
    function checkCase(s, action) {
      const have = held(s), chosen = arr(action.evidence).filter(c => have.has(c));
      const use = new Set(chosen.length ? chosen : [...have]);
      const sub = {...kc, signs: kc.signs.filter(x => use.has(x.id)).map(x => ({...x, requires: [], unlock: 'held', reading: x.reading || 'held'}))};
      const sv = survivors(sub, analyse(sub));
      const names = ids => ids.map(h => PEOPLE[actorOf(hyps[h])]?.name ?? hyps[h]?.label).join(', ');
      const accused = kc.question.candidates.find(h => actorOf(h) === action.suspect);
      const supported = sv.length === 1 && accused && sv[0] === accused.id;
      const feedback = supported ? null
        : !sv.length ? '“Your evidence rules out everyone, including the person you accuse. One of the accounts you are relying on must be false.”'
        : accused && !sv.includes(accused.id) ? `“Your own evidence clears ${PEOPLE[action.suspect]?.name}.”`
        : `“This still leaves ${names(sv)} possible. I need evidence that rules the others out.”`;
      return {supported, selected: [...use], routes: [], feedback, status: supported ? 'supported' : !sv.length ? 'inconsistent' : 'ambiguous', alternatives: sv};
    }

    // the surface account is what 'What is your account of last night?' gives, so it is not listed twice
    const followupOptions = (s, pid) => accounts(s, pid).filter(x => !x.surface || K.has(s, x.id)).filter(x => !x.surface).map(x => [x.id, x.ask || `What can you tell me about ${String(x.title || 'that').replace(/^(\S+ \S+|\S+) on /, '')}?`]);
    function parseCommand(text) {
      const w = text.toLowerCase().trim().split(/\s+/);
      if (['go', 'move', 'walk'].includes(w[0])) return {type: 'move', to: w[1]};
      if (['inspect', 'search'].includes(w[0])) return {type: 'inspect', object: w[1]};
      if (w[0] === 'wait') return {type: 'wait', minutes: Number(w[1])};
      if (w[0] === 'ask') return {type: 'ask', person: w[1], topic: w.at(-1)};
      return {type: 'look'};
    }
    return {seedSession, afterAction, decide, canAsk, ask, present, checkCase, followupOptions, parseCommand, reconcileKnowledge() {},
      commandLabel: a => `${a.type} ${a.person ?? a.object ?? a.to ?? ''}`, caseHealth: () => []};
  }
  return {CASE, LOCATIONS, PEOPLE, CLUES, OBJECTS, model, baseWorld, createBehavior, SUSPECTS: suspects,
    PILLARS: [['motive', 'Motive'], ['means', 'Means'], ['opportunity', 'Opportunity'], ['alibi', 'Alibi']]};
}
