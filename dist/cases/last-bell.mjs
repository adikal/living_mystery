// The Last Bell — one authored case, expressed as data + behavior behind the
// Case contract (see schema.mjs). The generic kernel supplies the simulation
// verbs; this module supplies WHAT is true, WHO the cast is, and HOW they act
// and speak. A second (or procedurally generated) case is another module of
// this exact shape: `model` + `baseWorld` + `createBehavior(kernel)`.

import { CASE, LOCATIONS, PEOPLE, CLUES, OBJECTS } from '../case.mjs';
import {evidenceClaims,testimonyClaims,at} from './last-bell-claims.mjs';
import {claimsAt,claimRelations} from '../claims.mjs';
import { VERSION, timeLabel } from '../kernel.mjs';

export { CASE, LOCATIONS, PEOPLE, CLUES, OBJECTS };

// Initial world for this case: cast starting state, object placement, flags.
export function baseWorld(seed = 17) {
  const npcs = {};
  for (const [id, p] of Object.entries(PEOPLE)) npcs[id] = { location: p.home, travel: null, stress: id === 'silas' ? .57 : id === 'clara' ? .61 : .2, trust: p.relationships.player?.trust ?? .5, intention: 'Keep the morning appointment', plan: 'routine', beliefs: [], memories: [], warned: false, disclosed: false, concealed: false, lastDecision: null };
  return { version: VERSION, seed, minute: 480, status: 'playing', player: { location: 'square', evidence: [], pins: [], visited: ['square'], lastSeen: {}, notes: [] }, npcs, objects: { folio: 'manor' }, flags: { claraThreatened: false, claraReassured: false, rumorShared: false, clockCorrected: false }, ending: null };
}

// Static tables + world factory the kernel needs.
export const model = { PEOPLE, LOCATIONS, CLUES, OBJECTS, CASE, baseWorld, evidenceClaims, testimonyClues:['ada','alibi'], version: VERSION };

/**
 * Bind this case's behavior to a kernel instance.
 * @param {import('../schema.mjs').Kernel} K
 * @returns {import('../schema.mjs').CaseBehavior}
 */
export function createBehavior(K) {
  const { commit, believe, remember, addEvidence, reject, startTravel, advance, local, has, nextId } = K;

  // Structured claims and communicative plans remain case-authored; AI only realizes the line.
  function speech(s,id,text,cause,data={}){
    const claims=(data.claims??[]).map(c=>({...c,claimant:id}));
    const action=s.events.findLast(e=>e.kind==='command')?.data.action;
    return K.speech(s,id,text,cause,{...(action?.type==='ask'?{topic:action.topic??'night'}:{}),...data,sourceEvents:data.evidenceParents??[],claims,plan:{intent:data.intent??'Respond',basis:data.basis??null,disclosure:data.deception?'withhold_or_mislead':'stated_account'}});
  }
  function known(s,id,key){return s.world.npcs[id].beliefs.find(b=>b.key===key)}
  function said(s,id){return s.events.some(e=>e.kind==='speech'&&e.actor===id&&e.data.listener==='player')}
  function sourceAccount(s,id){
    // Explain the last actual reply, not the character's private background.
    // Skip source replies so repeating the question retains its referent.
    const reply=s.events.findLast(e=>e.kind==='speech'&&e.actor===id&&e.data.listener==='player'&&e.data.topic!=='source');
    const d=reply?.data??{};
    if(d.topic==='sightings'||d.topic==='observations'||d.intent==='Recount witnessed movements')return 'That is what I personally observed today. I cannot tell you what happened outside my sight.';
    if(id==='clara'){
      if(d.claims?.some(c=>c.key==='clara_alibi'&&c.value==='manor')||d.deception==='Deliberate false alibi')return 'It is my own recollection of where I spent the evening. As I said, I was alone; I have no witness to offer.';
      if(d.claims?.some(c=>c.key==='clara_alibi'&&c.value==='greenhouse'))return d.basis==='heard_threat'?'I was present at the greenhouse meeting. Edmund told me about his intended confrontation; I did not witness the killing.':'I was there myself. The visiting record can corroborate the meeting and its time.';
      return 'I have not offered an account I can substantiate further. I do not want to speculate.';
    }
    if(id==='ada'&&(d.basis==='saw_coat'||d.topic==='identity'))return 'I saw a green coat, not a face. The identity was my inference; the time came from the inn clock.';
    if(id==='silas'&&d.claims?.some(c=>c.key==='silas_alibi'))return known(s,id,'alibi_challenged')?'The receipt records the errand I acknowledged. It does not account for my whole evening.':'No witness can confirm my whole evening. You have my word, and you are entitled to test it.';
    if(id==='silas'&&d.topic==='accounts')return 'That is my assessment of the accounts. You can examine the entries yourself.';
    if(id==='rowan'&&d.basis==='coat_lent')return 'The loan is my own recollection. The doctor’s record can corroborate the treatment afterward, not the loan itself.';
    if(id==='iris'&&d.basis==='treated_rowan')return 'The death window is a medical estimate. The treatment and presence I described are my direct observations.';
    if(id==='iris'&&d.topic==='weapon')return 'That limitation comes from the examination: the injury does not identify one unique object.';
    if(id==='bell')return 'My guidance is to compare testimony with records. A lead is something to investigate, not a verified conclusion.';
    return 'I cannot substantiate that any further. Compare what I have said with the evidence you can inspect.';
  }
  const followupTopics=['observations','source','identity','correction','challenge_delivery','appointment','challenge_record','coat','weapon','contradictions'];
  function canAsk(s,id,topic='night'){return Boolean(PEOPLE[id]&&local(s,id)&&(!followupTopics.includes(topic)||topic==='observations'||followupOptions(s,id).some(([key])=>key===topic)));}
  function followupOptions(s,id){
    const options=[];
    if(said(s,id))options.push(['source','What is your account based on?']);
    if(id==='ada'&&s.events.some(e=>e.kind==='speech'&&e.actor===id&&e.data.listener==='player'&&(e.data.basis==='saw_coat'||e.data.topic==='identity')))options.push(['identity','Did you actually recognize the person’s face?']);
    if(id==='ada'&&known(s,id,'needs_correction'))options.push(['correction','Will you correct your account to Bell?']);
    if(id==='silas'&&has(s,'delivery')&&claimsAt(s,s.events.length-1,evidenceClaims).some(c=>c.key==='silas_alibi'&&c.value==='vestry'))options.push(['challenge_delivery','Your alibi conflicts with the 21:12 receipt. Explain.']);
    if(id==='silas'&&known(s,id,'alibi_challenged'))options.push(['appointment','Why were you meeting Edmund?']);
    if(id==='clara'&&has(s,'record')&&said(s,id))options.push(['challenge_record','The visiting record places you in the greenhouse.']);
    if(id==='rowan'&&s.events.some(e=>e.kind==='speech'&&e.actor===id&&e.data.listener==='player'&&e.data.basis==='coat_lent'))options.push(['coat','Who could confirm the coat loan?']);
    if(id==='iris'&&has(s,'medical'))options.push(['weapon','Can the examination identify the exact weapon?']);
    if(id==='bell'&&claimsAt(s,s.events.length-1,evidenceClaims).length)options.push(['contradictions','Which statements conflict with my records?']);
    return options;
  }
  function followup(s,id,topic,cause){
    if(!followupTopics.includes(topic))return null;
    if(topic!=='observations'&&!followupOptions(s,id).some(([key])=>key===topic)){reject(s,'Follow-up not available','Establish the account and acquire the relevant evidence first.',cause);return true;}
    let text,claims=[],parents=[],intent='Explain the source of an account';
    if(topic==='observations')text=known(s,id,'saw_folio_taken')?'I saw Silas take the red folio at the manor. I do not know where it went afterward.':recountSightings(s,id).length?`I can report movements I witnessed: ${recountSightings(s,id).slice(-4).join('; ')}.`:'I have no additional retained observation to report.';
    if(topic==='source'){text=sourceAccount(s,id);const reply=s.events.findLast(e=>e.kind==='speech'&&e.actor===id&&e.data.listener==='player'&&e.data.topic!=='source');if(reply)parents=[reply.id];}
    if(topic==='identity'){claims=(s.world.flags.clockCorrected?testimonyClaims.ada_corrected:testimonyClaims.ada_original).map(c=>({...c,value:'unidentified',attribution:'clarified observation',confidence:.99}));text='No. I never saw the face. I recognized the coat and assumed Rowan was wearing it. That identification is not something I directly witnessed.';}
    if(topic==='correction')text=s.world.flags.adaCorrectionDelivered?'I have told Bell that my identification was uncertain and my time was wrong.':'Yes. I need to find Bell and correct what I told him. He cannot know I changed my mind until I tell him.';
    if(topic==='coat')text=s.world.npcs.rowan.trust<.2?'You threatened Clara. I have already told you to check the medical record; I will not discuss more until you do.':'I handed Silas the coat outside the inn at 20:55. I cannot promise someone else saw the exchange. Ask him, and compare his account with mine.';
    if(topic==='weapon')text='No. The examination constrains the size and shape of the striking edge. A compatible object is a lead; it is not, by itself, proof that the object caused the wound.';
    if(topic==='challenge_delivery'){
      const receipt=s.world.player.evidence.find(e=>e.clue==='delivery');parents=[receipt.eventId];
      text='Then my earlier account was too broad. I was at the manor at 21:12 to sign for that delivery. I will concede the errand. That is not an admission that I entered the study.';claims=testimonyClaims.silas_revision;intent='Revise an exposed alibi while withholding the crime';
      const e=speech(s,id,text,cause,{intent,claims,basis:'player_has_delivery',deception:'Partial admission',evidenceParents:parents});
      // Link the challenged assertion and document explicitly, not merely the command.
      commit(s,{kind:'observation',title:'You connect Silas’s alibi to the delivery receipt',actor:'player',parents:[e,...parents,...claimsAt(s,s.events.length-1,evidenceClaims).filter(c=>c.key==='silas_alibi'&&c.value==='vestry').map(c=>c.eventId)],data:{comparison:'overlapping locations'},playerText:'Silas has revised his account. The receipt contradicts his original claim to have spent the entire interval in the vestry.'});
      believe(s,id,'alibi_challenged','The detective has demonstrated that my all-evening vestry alibi conflicts with the receipt.',.99,'observation',e,true);
      commit(s,{kind:'relationship',title:'Silas becomes less cooperative after the challenge',actor:id,parents:[e],changes:{'npcs.silas.trust':.1,'npcs.silas.stress':.95}});advance(s,3,cause);return true;
    }
    if(topic==='appointment')text='Edmund wanted an explanation of the estate accounts. You have the papers; I will not speculate further. Bring a specific entry if you want an answer.';
    if(topic==='challenge_record'){
      parents=[s.world.player.evidence.find(e=>e.clue==='record').eventId];
      if(s.world.npcs.clara.trust<.2)text='The record can speak for itself. After your threat, I will not volunteer more about Rowan. You can still offer discretion when we discuss the record.';
      else {text='The library story was false. I was with Rowan in the greenhouse from 21:06 to 21:23. I concealed the meeting to protect our privacy, not to explain away the death.';claims=testimonyClaims.clara_truth;}
    }
    if(topic==='contradictions'){
      const conflicts=claimRelations(claimsAt(s,s.events.length-1,evidenceClaims)).filter(r=>r.kind==='conflicts');
      text=conflicts.length?'Your recorded statements place the same person in different locations during overlapping times. Challenge the speaker with the relevant document. A contradiction undermines that account; it does not alone establish murder.':'I cannot identify an overlapping-location contradiction from the structured statements you have recorded so far. That does not establish that every account is correct.';
    }
    const e=speech(s,id,text,cause,{intent,claims,topic,evidenceParents:parents});
    if(topic==='identity')believe(s,id,'identity_uncertain','I inferred the wearer was Rowan from the coat; I did not see a face.',.99,'inference',e,true);
    if(topic==='challenge_record'&&claims.length){commit(s,{kind:'relationship',title:'Clara retracts her false alibi',actor:id,parents:[e],changes:{'npcs.clara.disclosed':true,'npcs.clara.trust':.7}});addEvidence(s,'clara',e);}
    advance(s,3,cause);return true;
  }

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
    if (a.travel || s.world.player.conversation === id) return;
    const candidates = [{ id: 'routine', label: 'Keep the morning routine', score: 40, reasons: ['A standing commitment remains active.'] }];
    const knowsAccounts = a.beliefs.find((b) => b.key === 'detective_knows_accounts');
    if (id === 'silas' && knowsAccounts && !a.concealed) candidates.push({ id: 'conceal', label: 'Conceal the forged folio', score: 88, reasons: ['The detective showed me the diverted payments.', 'The folio could expose the forgery.'], source: knowsAccounts.sourceId });
    const threatened = a.beliefs.find((b) => b.key === 'secret_threatened');
    if (id === 'clara' && threatened && !a.warned) candidates.push({ id: 'warn', label: 'Warn Rowan about the detective', score: 82, reasons: ['The detective threatened to expose our relationship.', 'Protecting Rowan outweighs my routine.'], source: threatened.sourceId });
    const correction=known(s,id,'needs_correction');
    if(id==='ada'&&correction&&!s.world.flags.adaCorrectionDelivered)candidates.push({id:'correct',label:'Correct my report to Bell',score:76,reasons:['I learned that my reported time and identification were unreliable.','Bell heard my earlier account and needs the correction.'],source:correction.sourceId});
    const witnessed=known(s,id,'saw_folio_taken');
    if(id==='clara'&&witnessed&&a.trust>=.6&&!s.world.flags.claraReportedFolio)candidates.push({id:'report',label:'Tell Bell what I saw Silas take',score:65,reasons:['I personally saw Silas take the folio.','The detective earned my cooperation.'],source:witnessed.sourceId});
    const winner = candidates.reduce((a, b) => (b.score > a.score ? b : a)), plan = winner.id;
    const decision = commit(s, { kind: 'decision', title: `${PEOPLE[id].name}: ${winner.label.toLowerCase()}`, actor: id, parents: [cause, winner.source], data: { candidates, selected: plan, reason: winner.reasons.join(' '), knowledgeUsed: a.beliefs.filter((b) => b.sourceId === winner.source).map((b) => b.key) }, changes: { [`npcs.${id}.intention`]: winner.label, [`npcs.${id}.plan`]: plan, [`npcs.${id}.lastDecision`]: nextId(s) } });
    if(plan==='correct'||plan==='report'){
      if(a.location!=='square')startTravel(s,id,'square',decision,plan==='correct'?'Find Bell to correct my testimony':'Report my observation to Bell');
      else if(s.world.npcs.bell.location==='square'){
        const text=plan==='correct'?'I must correct my account. The inn clock was twelve minutes fast. I saw an unidentified person in a green coat at 21:03, not an identified Rowan at 21:15.':'I saw Silas take the red folio at the manor. I cannot say what he intended or where he put it afterward.';
        const e=commit(s,{kind:'speech',title:plan==='correct'?'Ada corrects her report to Bell':'Clara reports the folio movement to Bell',actor:id,location:'square',parents:[decision,winner.source],data:{listener:'bell',assertion:text,intent:plan==='correct'?'Correct testimony':'Share a witnessed action',claims:plan==='correct'?testimonyClaims.ada_corrected:[]},changes:{[plan==='correct'?'flags.adaCorrectionDelivered':'flags.claraReportedFolio']:true},playerText:s.world.player.location==='square'?`You overhear ${PEOPLE[id].name}: “${text}”`:null});
        believe(s,'bell',plan==='correct'?'adas_account':'clara_folio_report',text,plan==='correct'?.85:.8,'testimony',e,true);remember(s,id,e);
      }
    }else if (plan === 'warn') {
      if (a.location !== 'greenhouse') startTravel(s, id, 'greenhouse', decision, 'Find Rowan');
      else if (s.world.npcs.rowan.location === 'greenhouse') {
        const text = 'Clara draws Rowan aside. “The detective threatened to expose us. Be careful what you tell them.”';
        const e = commit(s, { kind: 'speech', title: 'Clara warns Rowan', actor: id, location: 'greenhouse', parents: [decision], data: { listener: 'rowan', assertion: 'The detective threatened to expose our relationship.', intent: 'Protect Rowan', basis: 'secret_threatened' }, changes: { 'npcs.clara.warned': true }, playerText: local(s, id) ? text : null });
        believe(s, 'rowan', 'detective_threatened_clara', 'Clara says the detective threatened to expose us.', .91, 'testimony', e, true);
        commit(s, { kind: 'relationship', title: 'Rowan becomes guarded toward you', actor: 'rowan', parents: [e], changes: { 'npcs.rowan.trust': .12, 'npcs.rowan.stress': .66 } });
        remember(s, 'clara', e);
      }
    } else if (plan === 'conceal') {
      if (s.world.objects.folio === 'manor') {
        if (a.location !== 'manor') startTravel(s, id, 'manor', decision, 'Retrieve the forged folio');
        else { const e = commit(s, { kind: 'action', title: 'Silas takes the red folio', actor: id, parents: [decision], changes: { 'objects.folio': 'silas' }, data: { object: 'folio', reason: 'Conceal incriminating records' }, playerText: local(s, id) ? 'Silas slips the red folio inside his coat. He notices you watching, but says nothing.' : null }); for(const [witness,npc]of Object.entries(s.world.npcs)){if(witness!==id&&npc.location===a.location&&!npc.travel){const observed=commit(s,{kind:'observation',title:`${PEOPLE[witness].name} sees Silas take the red folio`,actor:witness,location:a.location,parents:[e],data:{subject:'silas',object:'folio',observedAction:'take',observedLocation:a.location}});remember(s,witness,observed);believe(s,witness,'saw_folio_taken','I saw Silas take the red folio at the manor.',.99,'observation',observed,true);}}believe(s, id, 'folio_at_manor', 'The folio is no longer in the study; I am carrying it.', .99, 'observation', e, true); startTravel(s, id, 'vestry', e, 'Hide the folio in the deed drawer'); }
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
    for (const mid of s.world.npcs[id].memories.slice().reverse()) {
      const ev = s.events.find((x) => x.id === mid);
      if (!ev || ev.kind !== 'observation' || !ev.data.subject || !['arrival','departure'].includes(ev.data.phase) || !LOCATIONS[ev.data.observedLocation]) continue;
      const key = `${ev.data.subject}:${ev.data.phase}:${ev.data.observedLocation}`;
      if (keys.has(key)) continue;
      keys.add(key);
      const who = ev.data.subject === 'player' ? 'you' : PEOPLE[ev.data.subject].name;
      seen.push(`${who} ${ev.data.phase === 'departure' ? 'leave' : 'arrive at'} ${LOCATIONS[ev.data.observedLocation].short.toLowerCase()} around ${timeLabel(ev.minute)}`);
    }
    return seen.reverse();
  }

  function ask(s, id, topic, cause) {
    if (!PEOPLE[id]) return reject(s, 'Unknown person', 'Choose someone from the people here.', cause);
    if (!local(s, id)) return reject(s, 'Conversation cannot reach its recipient', `${PEOPLE[id].name} is not here. Find them before asking.`, cause);
    if(followup(s,id,topic,cause))return;
    const a = s.world.npcs[id];
    let e;
    if (topic === 'sightings') {
      if (known(s,id,'saw_folio_taken')) return followup(s,id,'observations',cause);
      const seen = recountSightings(s, id);
      e = speech(s, id, seen.length ? `Let me think. I saw ${seen.slice(-4).join('; ')}.` : `No one worth mentioning has passed me here.`, cause, { intent: 'Recount witnessed movements' });
    } else if (id === 'bell') {
      const rumor = a.beliefs.find((b) => b.key === 'adas_account');
      e = speech(s, id, topic === 'case' ? 'Bring me a suspect, a method, a motive, and the evidence that connects them. Check the study, the accounts, and the witnesses’ times.' : rumor ? `${rumor.text} I have not verified it. Her source matters as much as her confidence.` : 'A witness may be mistaken or hiding something unrelated. The surgery record could help you test an alibi.', cause, { intent: 'Guide a fair investigation' });
    } else if (id === 'ada') {
      e = speech(s, id, s.world.flags.clockCorrected ? 'I was wrong about the time—and I never saw the face. I saw a green coat at what must have been 21:03. I should have said that from the start.' :known(s,id,'identity_uncertain')?'I saw an unidentified person in a green coat heading toward the manor. The clock read 21:15; I never saw a face.': 'I saw Rowan’s green coat heading toward the manor. The clock said quarter past nine. His face? No, it was turned away. But everyone knows that coat.', cause, { intent: 'Report an observation and an inference', basis: 'saw_coat',claims:s.world.flags.clockCorrected?testimonyClaims.ada_corrected:known(s,id,'identity_uncertain')?testimonyClaims.ada_original.map(c=>({...c,value:'unidentified',attribution:'clarified observation'})):testimonyClaims.ada_original });
      addEvidence(s, 'ada', e);
    } else if (id === 'clara') {
      if (a.disclosed) { e = speech(s, id, 'Edmund meant to confront Silas over the accounts. Rowan and I were in the greenhouse. Dr Marsh was there too; her record will tell you when.', cause, { intent: 'Cooperate', basis: 'heard_threat',claims:testimonyClaims.clara_truth }); addEvidence(s, 'clara', e); }
      else e = speech(s, id, topic === 'alibi' ? 'I spent the evening in the library. Alone. Please don’t drag my private life into this.' : 'Edmund’s accounts were his business. I have nothing useful to add. I would appreciate some discretion.', cause, { intent: 'Protect Rowan and conceal the affair', basis: 'rowan_innocent', deception: topic === 'alibi' ? 'Deliberate false alibi' : 'Withholding',claims:topic==='alibi'?testimonyClaims.clara_alibi:[] });
    } else if (id === 'rowan') {
      if (a.trust < .2) e = speech(s, id, 'Clara told me what you threatened. Check the doctor’s ledger if you want my whereabouts. You won’t get our private life out of me.', cause, { intent: 'Protect Clara', basis: 'detective_threatened_clara' });
      else { e = speech(s, id, 'I lent my green coat to Silas outside the inn, just before nine. Then Dr Marsh came to dress this hand. Her visiting book will show it.', cause, { intent: 'Correct suspicion', basis: 'coat_lent' }); addEvidence(s, 'rowan', e); }
    } else if (id === 'silas') {
      e = speech(s, id, known(s,id,'alibi_challenged')&&topic!=='accounts'?'As I acknowledged, I was at the manor at 21:12 for the delivery. I will not claim I stayed in the vestry throughout.':topic === 'accounts' ? 'Routine discrepancies. Edmund liked to dramatize bookkeeping. The old folio won’t tell you anything.' : 'I was in the vestry from nine until half past. Alone, unfortunately. I had no appointment worth mentioning.', cause, { intent: 'Conceal the crime', basis: 'committed_murder', deception: 'Deliberate false alibi',claims:topic==='accounts'?[]:known(s,id,'alibi_challenged')?testimonyClaims.silas_revision:testimonyClaims.silas_alibi });
      if(topic!=='accounts')addEvidence(s, 'alibi', e);
    } else if (id === 'iris') e = speech(s, id, 'Death was between 21:10 and 21:20. I was with Rowan and Clara at the greenhouse from 21:06 to 21:23. My visiting ledger is available at the surgery.', cause, { intent: 'Provide an accurate account', basis: 'treated_rowan',claims:evidenceClaims.record });
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
        const response = speech(s, 'clara', 'If you will keep our relationship out of the gossip, I will tell you. Edmund said Silas had altered the accounts. He meant to confront him that night. Rowan and I were with Dr Marsh in the greenhouse.', e, { intent: 'Cooperate after an assurance of discretion', basis: 'heard_threat',claims:testimonyClaims.clara_truth });
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
      const response = speech(s, id, 'Twelve minutes fast? Then it was three minutes past nine. And I never saw his face. I’ve told the constable too much with too much certainty.', e, { intent: 'Correct an honest mistake',claims:testimonyClaims.ada_corrected });
      commit(s, { kind: 'belief', title: 'Ada retracts her identification and time', actor: id, parents: [response], changes: { 'flags.clockCorrected': true } });
      believe(s, id, 'saw_rowan', 'I saw an unidentified person in a green coat at 21:03.', .96, 'inference', response, true);
      if(s.world.flags.rumorShared)believe(s,id,'needs_correction','Bell heard my earlier mistaken account; I need to correct it in person.',.99,'inference',response,true);
      // Bell retains his old account until Ada travels to him and speaks.
    } else if (id === 'rowan' && clue === 'record') {
      speech(s, id, 'So you checked before deciding. Thank you. I lent Silas my coat at 20:55, outside the inn.', e, { intent: 'Cooperate after corroboration', basis: 'coat_lent' });
      commit(s, { kind: 'relationship', title: 'Rowan trusts your investigation more', actor: id, parents: [e], changes: { 'npcs.rowan.trust': .7 } });
      addEvidence(s, 'rowan', e);
    } else if (id === 'iris' && clue === 'medical') {
      speech(s, id, 'Yes—that is my examination. The wound took a small, hard, angled edge. Match that shape to an object and you have your weapon.', e, { intent: 'Confirm the medical findings', basis: 'death_window' });
    } else if (id === 'bell' && ['clock', 'record', 'delivery'].includes(clue)) {
      const rumor = s.world.npcs.bell.beliefs.find((b) => b.key === 'adas_account');
      speech(s, id, {clock:'The clock evidence moves Ada’s reported time earlier. Her identification still needs independent support.',record:'The visiting record corroborates Rowan and Clara at the greenhouse during the medical window.',delivery:'The receipt places Silas at the manor at 21:12. Compare it with any alibi he has given you.'}[clue], e, { intent: 'Reassess testimony against a record' });
      if (clue === 'clock' && rumor) believe(s, 'bell', 'adas_account', `${rumor.text} (Now in doubt: the inn clock ran fast.)`, .4, 'inference', e, rumor.truth);
    } else {
      const reactions={
        bell:{medical:'The medical window tells us when, not who. Compare it with each suspect’s whereabouts.',seal:'A damaged seal is a candidate weapon. Compare its broken edge with the fragment and the examination.',fragment:'Record where the fragment was found. A matching object and a reason for its presence matter more than an isolated piece of brass.',ledger:'The diverted payments suggest a motive. They do not establish who was in the study.',folio:'The countersignature strengthens the financial link. We still need reliable whereabouts and evidence of the act.',rowan:'That is Rowan’s account of a loan. Ask Silas about it; do not count repeated testimony as independent confirmation.',ada:'Separate the coat, the inferred identity, and the time on the clock. Those are three different claims.'},
        iris:{record:'That is my signed visiting entry. Rowan was my patient and Clara remained present throughout the recorded interval.',seal:'The angled edge could be compatible with the injury. I cannot identify the weapon from compatibility alone.',fragment:'Compare the fragment physically with a missing corner. The injury describes an edge; it does not identify an owner.',clock:'Correct the witness time before comparing it with my death estimate. My examination does not depend on the inn clock.',pump:'Rowan wrote this log himself. My visiting record independently corroborates the treatment interval, not every entry in his log.'},
        ada:{medical:'I did not witness the death. My glimpse of the coat needs its own time and identification checks.',record:'If that record places Rowan elsewhere, my identification is in doubt. I recognized clothing, not a face.',rowan:'If someone borrowed the coat, it need not have been Rowan wearing it. I cannot confirm the loan myself.',letter:'Private meetings invite gossip, but I did not witness this one. Do not treat my curiosity as evidence.'},
        rowan:{letter:'That is private. If you want to establish where I was, use the doctor’s visiting record.',pump:'I wrote the work log. The doctor can independently confirm when she treated my hand; the rest is my own account.',medical:'Compare that window with Dr Marsh’s visiting record before deciding where I could have been.',ada:'A coat is not a face. I told you I lent mine to Silas; you should ask him for his account.'},
        clara:{medical:'I did not witness the blow. The medical estimate should be tested against records of where people were.',ledger:'Those entries concern Edmund’s business. Show me that you will handle private matters discreetly before expecting me to discuss what I heard.',folio:'The papers deserve careful attention. I will not turn a financial suspicion into an eyewitness claim.',ada:'Ada should distinguish what she saw from whom she assumed she saw. A rumor is not a reliable alibi.'},
        silas:{rowan:'Rowan is responsible for his own story. A loan of clothing would establish neither my whereabouts nor a visit to the study.',record:'Then ask the doctor about her patients. That entry is not a record of my movements.',letter:'Other people’s private correspondence has nothing to do with my professional records.',clock:'A faulty clock makes a confident witness less reliable. You should be cautious about every account.'},
      };
      const limits={bell:'Keep the source attached to this entry. I can assess a connected case, not settle it from one item.',iris:'That is outside what I personally examined or witnessed. I can explain the injury and my visiting record.',ada:'I cannot independently confirm what this document describes. I can tell you what I saw and which parts I inferred.',rowan:'I cannot speak for everyone involved in that record. Ask about the loan or compare my treatment with the doctor’s ledger.',clara:'I will not speculate about things I did not witness. Ask me for the source of my own account.',silas:'I am not volunteering an interpretation of that. Put a specific inconsistency in my own account to me.'};
      speech(s,id,reactions[id]?.[clue]??limits[id],e,{intent:'Respond within the witness’s knowledge',basis:`player_has_${clue}`});
      if(id==='ada'&&['record','rowan'].includes(clue))believe(s,id,'identity_uncertain','The coat does not establish that its wearer was Rowan.',.99,'inference',e,true);
    }
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
    return { move: `Travel to ${LOCATIONS[a.to]?.name ?? a.to}`, inspect: `Inspect ${OBJECTS[a.object]?.label ?? a.object}`, ask: `Ask ${PEOPLE[a.person]?.name ?? a.person} about ${a.topic ?? 'last night'}`, present: `Show evidence to ${PEOPLE[a.person]?.name ?? a.person}`, wait: `Wait ${a.minutes ?? 10} minutes`, pin: 'Update pinned evidence', note: 'Write a hypothesis', accuse: 'Present an accusation', endConversation: 'End conversation', look: 'Look around' }[a.type] ?? 'Unrecognized command';
  }

  return { canAsk, followupOptions, routineDestination, decide, ask, present, seedSession, checkCase, caseHealth, parseCommand, commandLabel };
}
