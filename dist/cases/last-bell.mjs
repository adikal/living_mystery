// The Last Bell — one authored case, expressed as data + behavior behind the
// Case contract (see schema.mjs). The generic kernel supplies the simulation
// verbs; this module supplies WHAT is true, WHO the cast is, and HOW they act
// and speak. A second (or procedurally generated) case is another module of
// this exact shape: `model` + `baseWorld` + `createBehavior(kernel)`.

import { CASE, LOCATIONS, PEOPLE, CLUES, OBJECTS } from '../case.mjs';
import { VERSION, timeLabel } from '../kernel.mjs';

export { CASE, LOCATIONS, PEOPLE, CLUES, OBJECTS };

// Initial world for this case: cast starting state, object placement, flags.
export function baseWorld(seed = 17) {
  const npcs = {};
  for (const [id, p] of Object.entries(PEOPLE)) npcs[id] = { location: p.home, travel: null, stress: id === 'silas' ? .57 : id === 'clara' ? .61 : .2, trust: p.relationships.player?.trust ?? .5, intention: 'Keep the morning appointment', plan: 'routine', beliefs: [], memories: [], warned: false, disclosed: false, concealed: false, lastDecision: null };
  return { version: VERSION, seed, minute: 480, status: 'playing', player: { location: 'square', evidence: [], pins: [], visited: ['square'], lastSeen: {}, notes: [] }, npcs, objects: { folio: 'manor' }, flags: { claraThreatened: false, claraReassured: false, rumorShared: false, clockCorrected: false }, ending: null };
}

// Static tables + world factory the kernel needs.
export const model = { PEOPLE, LOCATIONS, CLUES, OBJECTS, CASE, baseWorld, version: VERSION };

/**
 * Bind this case's behavior to a kernel instance.
 * @param {import('../schema.mjs').Kernel} K
 * @returns {import('../schema.mjs').CaseBehavior}
 */
export function createBehavior(K) {
  const { commit, believe, remember, speech, addEvidence, reject, startTravel, advance, local, has, nextId } = K;

  function routineDestination(s, id) {
    const t = (s.world.minute - 480) % 180, shift = s.seed % 7 - 3;
    if (id === 'clara') return t < 35 + shift ? 'manor' : t < 80 + shift ? 'inn' : 'manor';
    if (id === 'rowan') return t >= 45 + shift && t < 68 + shift ? 'square' : 'greenhouse';
    if (id === 'silas') return t >= 35 + shift && t < 68 + shift ? 'manor' : 'vestry';
    if (id === 'ada') return t >= 45 + shift && t < 60 + shift ? 'square' : 'inn';
    if (id === 'iris') return t >= 60 + shift && t < 90 + shift ? 'manor' : 'surgery';
    return 'square';
  }

  function decide(s, id, cause) {
    const a = s.world.npcs[id];
    if (a.travel) return;
    const candidates = [{ id: 'routine', label: 'Keep the morning routine', score: 40, reasons: ['A standing commitment remains active.'] }];
    const knowsAccounts = a.beliefs.find((b) => b.key === 'detective_knows_accounts');
    if (id === 'silas' && knowsAccounts && !a.concealed) candidates.push({ id: 'conceal', label: 'Conceal the forged folio', score: 88, reasons: ['The detective showed me the diverted payments.', 'The folio could expose the forgery.'], source: knowsAccounts.sourceId });
    const threatened = a.beliefs.find((b) => b.key === 'secret_threatened');
    if (id === 'clara' && threatened && !a.warned) candidates.push({ id: 'warn', label: 'Warn Rowan about the detective', score: 82, reasons: ['The detective threatened to expose our relationship.', 'Protecting Rowan outweighs my routine.'], source: threatened.sourceId });
    const winner = candidates.reduce((a, b) => (b.score > a.score ? b : a)), plan = winner.id;
    const decision = commit(s, { kind: 'decision', title: `${PEOPLE[id].name}: ${winner.label.toLowerCase()}`, actor: id, parents: [cause, winner.source], data: { candidates, selected: plan, reason: winner.reasons.join(' '), knowledgeUsed: a.beliefs.filter((b) => b.sourceId === winner.source).map((b) => b.key) }, changes: { [`npcs.${id}.intention`]: winner.label, [`npcs.${id}.plan`]: plan, [`npcs.${id}.lastDecision`]: nextId(s) } });
    if (plan === 'warn') {
      if (a.location !== 'greenhouse') startTravel(s, id, 'greenhouse', decision, 'Find Rowan');
      else if (s.world.npcs.rowan.location === 'greenhouse') {
        const text = 'Clara draws Rowan aside. “The detective found my letter. Be careful what you tell them.”';
        const e = commit(s, { kind: 'speech', title: 'Clara warns Rowan', actor: id, location: 'greenhouse', parents: [decision], data: { listener: 'rowan', assertion: 'The detective found my private letter.', intent: 'Protect Rowan', basis: 'secret_threatened' }, changes: { 'npcs.clara.warned': true }, playerText: local(s, id) ? text : null });
        believe(s, 'rowan', 'detective_threatened_clara', 'Clara says the detective threatened to expose us.', .91, 'testimony', e, true);
        commit(s, { kind: 'relationship', title: 'Rowan becomes guarded toward you', actor: 'rowan', parents: [e], changes: { 'npcs.rowan.trust': .12, 'npcs.rowan.stress': .66 } });
        remember(s, 'clara', e);
      }
    } else if (plan === 'conceal') {
      if (s.world.objects.folio === 'manor') {
        if (a.location !== 'manor') startTravel(s, id, 'manor', decision, 'Retrieve the forged folio');
        else { const e = commit(s, { kind: 'action', title: 'Silas takes the red folio', actor: id, parents: [decision], changes: { 'objects.folio': 'silas' }, data: { object: 'folio', reason: 'Conceal incriminating records' }, playerText: local(s, id) ? 'Silas slips the red folio inside his coat. He notices you watching, but says nothing.' : null }); believe(s, id, 'folio_at_manor', 'The folio is no longer in the study; I am carrying it.', .99, 'observation', e, true); startTravel(s, id, 'vestry', e, 'Hide the folio in the deed drawer'); }
      } else if (s.world.objects.folio === 'silas') {
        if (a.location !== 'vestry') startTravel(s, id, 'vestry', decision, 'Hide the forged folio');
        else { const e = commit(s, { kind: 'action', title: 'Silas hides the folio in the deed drawer', actor: id, parents: [decision], changes: { 'objects.folio': 'drawer', 'npcs.silas.concealed': true }, data: { object: 'folio', reachableAt: 'vestry', reason: 'Put the document among routine deeds' }, playerText: local(s, id) ? 'Silas pushes the red folio beneath a stack of deeds. The drawer closes with a soft scrape.' : null }); believe(s, id, 'folio_at_manor', 'I hid the forged folio in the deed drawer at the vestry.', .99, 'observation', e, true); }
      } else commit(s, { kind: 'decision', title: 'Silas cannot find the folio where he expected', actor: id, parents: [decision], data: { reason: 'The attempted plan encountered a changed object location.' }, changes: { 'npcs.silas.concealed': true } });
    } else startTravel(s, id, routineDestination(s, id), decision, 'A standing morning obligation');
    if (id === 'ada' && a.location === 'square' && s.world.npcs.bell.location === 'square' && !s.world.flags.rumorShared) {
      const b = a.beliefs.find((x) => x.key === 'saw_rowan');
      if (!b) return;
      const e = commit(s, { kind: 'speech', title: 'Ada passes her account to Bell', actor: 'ada', location: 'square', parents: [decision, b.sourceId], data: { listener: 'bell', assertion: b.text, intent: 'Help the investigation', basis: b.key }, changes: { 'flags.rumorShared': true }, playerText: s.world.player.location === 'square' ? `You overhear Ada telling Bell: “${b.text}”` : null });
      believe(s, 'bell', 'adas_account', `Ada reports: ${b.text}`, .72, 'testimony', e, b.truth);
      remember(s, 'ada', e);
    }
  }

  // A witness recounts only the arrivals/departures they actually observed, never a route or motive.
  function recountSightings(s, id) {
    const seen = [], keys = new Set();
    for (const mid of s.world.npcs[id].memories) {
      const ev = s.events.find((x) => x.id === mid);
      if (!ev || ev.kind !== 'observation' || !ev.data.subject || !LOCATIONS[ev.data.observedLocation]) continue;
      const key = `${ev.data.subject}:${ev.data.phase}:${ev.data.observedLocation}`;
      if (keys.has(key)) continue;
      keys.add(key);
      const who = ev.data.subject === 'player' ? 'you' : PEOPLE[ev.data.subject].name;
      seen.push(`${who} ${ev.data.phase === 'departure' ? 'leave' : 'arrive at'} ${LOCATIONS[ev.data.observedLocation].short.toLowerCase()} around ${timeLabel(ev.minute)}`);
    }
    return seen;
  }

  function ask(s, id, topic, cause) {
    if (!PEOPLE[id]) return reject(s, 'Unknown person', 'Choose someone from the people here.', cause);
    if (!local(s, id)) return reject(s, 'Conversation cannot reach its recipient', `${PEOPLE[id].name} is not here. Find them before asking.`, cause);
    const a = s.world.npcs[id];
    let e;
    if (topic === 'sightings') {
      const seen = recountSightings(s, id);
      e = speech(s, id, seen.length ? `Let me think. I saw ${seen.slice(-4).join('; ')}.` : `No one worth mentioning has passed me here.`, cause, { intent: 'Recount witnessed movements' });
    } else if (id === 'bell') {
      const rumor = a.beliefs.find((b) => b.key === 'adas_account');
      e = speech(s, id, topic === 'case' ? 'Bring me a suspect, a method, a motive, and the evidence that connects them. Check the study, the accounts, and the witnesses’ times.' : rumor ? `${rumor.text} I have not verified it. Her source matters as much as her confidence.` : 'A witness may be mistaken or hiding something unrelated. The surgery record could help you test an alibi.', cause, { intent: 'Guide a fair investigation' });
    } else if (id === 'ada') {
      e = speech(s, id, s.world.flags.clockCorrected ? 'I was wrong about the time—and I never saw the face. I saw a green coat at what must have been 21:03. I should have said that from the start.' : 'I saw Rowan’s green coat heading toward the manor. The clock said quarter past nine. His face? No, it was turned away. But everyone knows that coat.', cause, { intent: 'Report an observation and an inference', basis: 'saw_coat' });
      addEvidence(s, 'ada', e);
    } else if (id === 'clara') {
      if (a.disclosed) { e = speech(s, id, 'Edmund meant to confront Silas over the accounts. Rowan and I were in the greenhouse. Dr Marsh was there too; her record will tell you when.', cause, { intent: 'Cooperate', basis: 'heard_threat' }); addEvidence(s, 'clara', e); }
      else e = speech(s, id, topic === 'alibi' ? 'I spent the evening in the library. Alone. Please don’t drag my private life into this.' : 'Edmund’s accounts were his business. I have nothing useful to add. I would appreciate some discretion.', cause, { intent: 'Protect Rowan and conceal the affair', basis: 'rowan_innocent', deception: topic === 'alibi' ? 'Deliberate false alibi' : 'Withholding' });
    } else if (id === 'rowan') {
      if (a.trust < .2) e = speech(s, id, 'Clara told me what you threatened. Check the doctor’s ledger if you want my whereabouts. You won’t get our private life out of me.', cause, { intent: 'Protect Clara', basis: 'detective_threatened_clara' });
      else { e = speech(s, id, 'I lent my green coat to Silas outside the inn, just before nine. Then Dr Marsh came to dress this hand. Her visiting book will show it.', cause, { intent: 'Correct suspicion', basis: 'coat_lent' }); addEvidence(s, 'rowan', e); }
    } else if (id === 'silas') {
      e = speech(s, id, topic === 'accounts' ? 'Routine discrepancies. Edmund liked to dramatize bookkeeping. The old folio won’t tell you anything.' : 'I was in the vestry from nine until half past. Alone, unfortunately. I had no appointment worth mentioning.', cause, { intent: 'Conceal the crime', basis: 'committed_murder', deception: 'Deliberate false alibi' });
      addEvidence(s, 'alibi', e);
    } else if (id === 'iris') e = speech(s, id, 'Death was between 21:10 and 21:20. I was with Rowan and Clara at the greenhouse from 21:06 to 21:23. My visiting ledger is available at the surgery.', cause, { intent: 'Provide an accurate account', basis: 'treated_rowan' });
    advance(s, 3, cause);
    return e;
  }

  function present(s, id, clue, tone, cause) {
    if (!PEOPLE[id] || !local(s, id)) return reject(s, 'Recipient not present', 'You need to be in the same place as the person you want to address.', cause);
    if (!has(s, clue)) return reject(s, 'Evidence not acquired', 'You cannot show evidence you have not discovered.', cause);
    const e = commit(s, { kind: 'speech', title: `You show ${CLUES[clue].title.toLowerCase()} to ${PEOPLE[id].name}`, actor: 'player', parents: [cause, s.world.player.evidence.find((x) => x.clue === clue).eventId], data: { listener: id, clue, tone }, playerText: `You show ${PEOPLE[id].name} ${CLUES[clue].title.toLowerCase()}.` });
    believe(s, id, `player_has_${clue}`, `The detective has seen ${CLUES[clue].title.toLowerCase()}.`, .99, 'observation', e, true);
    if (id === 'clara' && (clue === 'letter' || clue === 'record')) {
      if (tone === 'press') {
        const threat = speech(s, 'clara', 'You would expose us to the whole village? Then I have nothing more to say.', e, { intent: 'Withhold information' });
        believe(s, 'clara', 'secret_threatened', 'The detective threatened to expose my relationship with Rowan.', .98, 'observation', e, true);
        commit(s, { kind: 'relationship', title: 'Clara loses trust and fears exposure', actor: 'clara', parents: [threat], changes: { 'npcs.clara.trust': .08, 'npcs.clara.stress': .92, 'flags.claraThreatened': true } });
        decide(s, 'clara', threat);
      } else {
        const response = speech(s, 'clara', 'If you will keep our relationship out of the gossip, I will tell you. Edmund said Silas had altered the accounts. He meant to confront him that night. Rowan and I were with Dr Marsh in the greenhouse.', e, { intent: 'Cooperate after an assurance of discretion', basis: 'heard_threat' });
        commit(s, { kind: 'relationship', title: 'Clara chooses to cooperate', actor: 'clara', parents: [response], changes: { 'npcs.clara.trust': .85, 'npcs.clara.stress': .35, 'npcs.clara.disclosed': true, 'flags.claraReassured': true } });
        addEvidence(s, 'clara', response);
      }
    } else if (id === 'silas' && ['ledger', 'folio'].includes(clue)) {
      const response = speech(s, id, 'Those papers belong in my office. I will see that the files are put in order.', e, { intent: 'Deflect scrutiny' });
      believe(s, id, 'detective_knows_accounts', 'The detective is investigating the diverted estate payments.', .99, 'observation', e, true);
      commit(s, { kind: 'emotion', title: 'Silas becomes anxious about the folio', actor: id, parents: [response], changes: { 'npcs.silas.stress': .9 } });
      decide(s, id, response);
    } else if (id === 'silas' && ['delivery', 'seal', 'fragment', 'medical'].includes(clue)) {
      // Physical/opportunity evidence. The delivery receipt directly contradicts his stated vestry alibi.
      const lines = { delivery: 'The courier’s book? I signed for a delivery in passing—a brief errand. It says nothing about the study.', seal: 'That seal never leaves my office. The broken corner is old wear. I won’t have a paperweight recast as a weapon.', fragment: 'A scrap of brass beneath a desk. Studies are full of such things. You reach, detective.', medical: 'A blow from a hard edge. Tragic. I am a solicitor, not a surgeon; I cannot help you there.' };
      const stress = { delivery: .9, seal: .95, fragment: .9, medical: .8 }, contradicts = clue === 'delivery';
      const response = speech(s, id, lines[clue], e, { intent: contradicts ? 'Explain away a contradiction' : 'Deflect physical evidence', basis: 'committed_murder', deception: contradicts ? 'Contradiction with stated alibi' : 'Minimizing physical evidence' });
      believe(s, id, 'detective_has_physical', 'The detective is pressing me with the physical evidence.', .9, 'observation', e, true);
      commit(s, { kind: 'emotion', title: 'Silas grows guarded under pressure', actor: id, parents: [response], changes: { 'npcs.silas.stress': stress[clue] } });
    } else if (id === 'ada' && clue === 'clock') {
      const response = speech(s, id, 'Twelve minutes fast? Then it was three minutes past nine. And I never saw his face. I’ve told the constable too much with too much certainty.', e, { intent: 'Correct an honest mistake' });
      commit(s, { kind: 'belief', title: 'Ada retracts her identification and time', actor: id, parents: [response], changes: { 'flags.clockCorrected': true } });
      believe(s, id, 'saw_rowan', 'I saw an unidentified person in a green coat at 21:03.', .96, 'inference', response, true);
      // A correction is not telepathic: Bell retains the old account until a later transfer.
    } else if (id === 'rowan' && clue === 'record') {
      speech(s, id, 'So you checked before deciding. Thank you. I lent Silas my coat at 20:55, outside the inn.', e, { intent: 'Cooperate after corroboration', basis: 'coat_lent' });
      commit(s, { kind: 'relationship', title: 'Rowan trusts your investigation more', actor: id, parents: [e], changes: { 'npcs.rowan.trust': .7 } });
      addEvidence(s, 'rowan', e);
    } else if (id === 'iris' && clue === 'medical') {
      speech(s, id, 'Yes—that is my examination. The wound took a small, hard, angled edge. Match that shape to an object and you have your weapon.', e, { intent: 'Confirm the medical findings', basis: 'death_window' });
    } else if (id === 'bell' && ['clock', 'record', 'delivery'].includes(clue)) {
      const rumor = s.world.npcs.bell.beliefs.find((b) => b.key === 'adas_account');
      speech(s, id, 'Noted. I will weigh this against what I have been told. A clock running fast would set Ada’s sighting a good deal earlier.', e, { intent: 'Reassess testimony against a record' });
      if (clue === 'clock' && rumor) believe(s, 'bell', 'adas_account', `${rumor.text} (Now in doubt: the inn clock ran fast.)`, .4, 'inference', e, rumor.truth);
    } else speech(s, id, id === 'bell' ? 'Keep that in your notebook. I will assess it alongside the rest when you make your case.' : 'I see. Compare it with the records before you draw a conclusion.', e, { intent: 'Acknowledge evidence' });
    advance(s, 4, cause);
  }

  // Seed a fresh session: origin history, per-character belief seeds, arrival.
  function seedSession(s) {
    const origin = commit(s, { kind: 'history', title: 'The case is established', data: { history: CASE.history, truth: CASE.truth }, location: 'manor' });
    for (const [id, p] of Object.entries(PEOPLE)) for (const b of p.beliefSeeds) believe(s, id, ...b.slice(0, 4), origin, b[4]);
    const arrival = commit(s, { kind: 'arrival', title: 'You arrive in Bellweather', actor: 'player', location: 'square', playerText: `${CASE.synopsis}\n\n“Start with the study,” Bell says. “Then listen carefully. A lie and a murder aren’t the same thing.”`, changes: { 'player.lastSeen.bell': { location: 'square', minute: 480 } }, data: { boundary: true } });
    K.witnessMovement(s, 'player', 'arrival', 'square', arrival);
  }

  function checkCase(s, accusation) {
    const selected = [...new Set(accusation.evidence ?? [])].filter((c) => has(s, c));
    const routes = CASE.proofRoutes.filter((r) => r.all.every((c) => selected.includes(c)));
    const supported = accusation.suspect === CASE.culprit && accusation.method === CASE.method && accusation.motive === CASE.motive && routes.length > 0;
    return { supported, routes: routes.map((r) => r.id), selected };
  }

  function caseHealth(s, world = s.world) {
    return CASE.proofRoutes.map((r) => ({ ...r, found: r.all.filter((c) => world.player.evidence.some((e) => e.clue === c)), available: r.all.every((c) => c !== 'folio' || ['manor', 'silas', 'drawer'].includes(world.objects.folio)) }));
  }

  function parseCommand(input) {
    const text = input.trim().toLowerCase().replace(/[?!.,]/g, '');
    const placeAliases = { square: 'square', village: 'square', manor: 'manor', study: 'manor', inn: 'inn', rook: 'inn', greenhouse: 'greenhouse', vestry: 'vestry', church: 'vestry', surgery: 'surgery', doctor: 'surgery' };
    const place = Object.entries(placeAliases).find(([k]) => new RegExp(`\\b${k}\\b`).test(text))?.[1];
    if (/^(go|walk|travel|visit|move)\b/.test(text) && place) return { type: 'move', to: place, label: input };
    if (/^wait\b/.test(text)) return { type: 'wait', minutes: Number(text.match(/\d+/)?.[0] || 10), label: input };
    if (/^(look|l)$/.test(text)) return { type: 'look', label: input };
    const person = Object.entries(PEOPLE).find(([id, p]) => text.includes(id) || p.name.toLowerCase().split(' ').some((n) => text.includes(n)))?.[0];
    if (/^(ask|talk|speak|question)\b/.test(text) && person) return { type: 'ask', person, topic: text.includes('alibi') ? 'alibi' : text.includes('account') ? 'accounts' : text.includes('case') ? 'case' : 'night', label: input };
    const objectAliases = { body: 'body', medical: 'body', diary: 'desk', desk: 'desk', accounts: 'accounts', ledger: 'accounts', carpet: 'carpet', fragment: 'carpet', folio: 'folio', clock: 'clock', letter: 'letter', envelope: 'letter', pump: 'pump', seal: 'seal', delivery: 'delivery', drawer: 'drawer', record: 'record', visiting: 'record' };
    if (/^(inspect|search|examine|read|check)\b/.test(text)) { const object = text.includes('visiting ledger') ? 'record' : Object.entries(objectAliases).find(([k]) => new RegExp(`\\b${k}\\b`).test(text))?.[1]; if (object) return { type: 'inspect', object, label: input }; }
    return { type: 'unknown', label: input };
  }

  function commandLabel(a) {
    return { move: `Travel to ${LOCATIONS[a.to]?.name ?? a.to}`, inspect: `Inspect ${OBJECTS[a.object]?.label ?? a.object}`, ask: `Ask ${PEOPLE[a.person]?.name ?? a.person} about ${a.topic ?? 'last night'}`, present: `Show evidence to ${PEOPLE[a.person]?.name ?? a.person}`, wait: `Wait ${a.minutes ?? 10} minutes`, pin: 'Update pinned evidence', note: 'Write a hypothesis', accuse: 'Present an accusation', look: 'Look around' }[a.type] ?? 'Unrecognized command';
  }

  return { routineDestination, decide, ask, present, seedSession, checkCase, caseHealth, parseCommand, commandLabel };
}
