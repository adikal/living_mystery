import {createLife} from './life.mjs';
import {availablePlans,queuePlan,resumePlan} from './agent-plans.mjs';
// A case-bound kernel and command router. Each runtime closes over its own
// tables and behavior; engine.mjs selects it using the session's case identity.
// Legacy Last Bell routing remains explicitly scoped to that case.

import {claimsAt} from './claims.mjs';
import { createKernel, VERSION, copy, timeLabel } from './kernel.mjs';


export function createRuntime(ActiveCase) {
// --- Case data (re-exported for adapters/tests) ---------------------------
const { CASE, LOCATIONS, PEOPLE, CLUES, OBJECTS } = ActiveCase;
const { SUSPECTS, PILLARS, suspectMeta, suspectBoard } = ActiveCase;

const baseWorld = ActiveCase.baseWorld;

// --- Assemble kernel + case ------------------------------------------------
const K = createKernel(ActiveCase.model);
K.life=createLife(K);
K.runPending=(s,id,cause)=>resumePlan(K,s,id,cause);
const B = ActiveCase.createBehavior(K);
K.afterTransfer=B.afterTransfer;
K.decide = (s,id,cause)=>{if(!resumePlan(K,s,id,cause))B.decide(s,id,cause);}; // inject the NPC decision policy into the kernel's clock

// --- Kernel mechanics (re-exported) ---------------------------------------
const commit = K.commit;
const distance = K.distance;
const worldAt = K.worldAt;
const diagnostics = K.diagnostics;
const exportSession = K.exportSession;
function importSession(text){const s=K.importSession(text);B.reconcileKnowledge(s);K.life.initialize(s);return s;}

// --- Case behavior (re-exported) ------------------------------------------
const parseCommand = B.parseCommand;
const followupOptions=B.followupOptions;
const playerClaims=(s,index=s.events.length-1)=>claimsAt(s,index,ActiveCase.model.evidenceClaims);
const checkCase = B.checkCase;
const caseHealth = B.caseHealth;
const characterPlans=(s,actor)=>availablePlans(K,s,actor);
const scheduleCharacterPlan=(s,plan,cause)=>queuePlan(K,s,plan,cause);

function createSession(seed = 17) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 999999) throw Error('Seed must be an integer from 0 to 999999.');
  const s = { version: VERSION, seed, events: [], world: ActiveCase.baseWorld(seed) };
  B.seedSession(s);
  K.life.initialize(s);
  return s;
}

// Generic action router: player intents → kernel verbs + case behavior. The
// per-action semantics that are case-neutral (move, inspect, wait, pin, note,
// look, accuse) live here; ask/present/accuse delegate to the active case.
function dispatch(s, action) {
  if (!action || typeof action.type !== 'string') throw Error('Expected a typed action.');
  const start = commit(s, { kind: 'command', title: action.label || B.commandLabel(action), actor: 'player', data: { action: copy(action) } });
  // Engagement is replayable state: only the addressed NPC pauses autonomous work.
  const previous = s.world.player.conversation ?? null;
  const talking = action.type === 'ask' ? B.canAsk(s, action.person, action.topic || 'night')
    : action.type === 'present' && K.local(s, action.person) && K.has(s, action.clue);
  const releases = ['wait', 'endConversation'].includes(action.type)
    || action.type === 'move' && Boolean(LOCATIONS[action.to]) && action.to !== s.world.player.location
    || action.type === 'inspect' && Boolean(OBJECTS[action.object]) && LOCATIONS[s.world.player.location]?.objects.includes(action.object)
    || action.type === 'accuse' && K.local(s, 'bell');
  const next = talking ? action.person : releases ? null : previous;
  if (s.world.status !== 'solved' && previous !== next) {
    const engagement = commit(s, { kind: 'action', title: next ? `You engage ${PEOPLE[next].name} in conversation` : 'You end the conversation', actor: 'player', parents: [start], data: { conversation: next }, changes: { 'player.conversation': next } });
    if(next)K.life.engagement(s,next,engagement);
    if(previous){K.life.engagement(s,previous,engagement);K.decide(s,previous,engagement);}
  }
  if (s.world.status === 'solved' && !['pin', 'note', 'look'].includes(action.type)) {
    K.reject(s, 'The case is closed', 'The case is closed. You can review the notebook and inspect the full history, or begin again.', start);
  } else switch (action.type) {
    case 'move': {
      if (!LOCATIONS[action.to] || s.world.flags.closedLocations?.includes(action.to)) { K.reject(s, 'Unknown destination', 'Choose a place on the village list.', start); break; }
      const from = s.world.player.location;
      if (from === action.to) { K.reject(s, 'Already at destination', 'You are already here.', start); break; }
      const duration = K.distance(from, action.to);
      const departure = commit(s, { kind: 'movement', title: `You leave for ${LOCATIONS[action.to].short}`, actor: 'player', location: from, parents: [start], changes: { 'player.location': 'transit' }, data: { from, to: action.to, duration } });
      K.witnessMovement(s, 'player', 'departure', from, departure);
      K.advance(s, duration, start);
      const arr = commit(s, { kind: 'arrival', title: `You reach ${LOCATIONS[action.to].name}`, actor: 'player', location: action.to, parents: [start], changes: { 'player.location': action.to, 'player.visited': [...new Set([...s.world.player.visited, action.to])] }, playerText: LOCATIONS[action.to].description });
      K.witnessMovement(s, 'player', 'arrival', action.to, arr);
      for (const id of Object.keys(PEOPLE)) K.notice(s, id, arr, `${PEOPLE[id].name} is here.`);
      break;
    }
    case 'inspect': {
      const obj = OBJECTS[action.object], at = s.world.player.location;
      if (!obj || !LOCATIONS[at]?.objects.includes(action.object) || s.world.flags.lockedObjects?.includes(action.object) || (s.world.flags.evidenceExpiry?.[obj?.clue]??Infinity)<s.world.minute || action.object==='seal'&&CASE.id!=='last-bell'&&s.world.objects.weapon!==at) { K.reject(s, 'Object outside your reach', 'That object is not here. Choose something in your current surroundings.', start); break; }
      const inspected = commit(s, { kind: 'action', title: `You inspect ${obj.label.toLowerCase()}`, actor: 'player', parents: [start], data: { object: action.object } });
      if (CASE.id==='last-bell' && action.object === 'folio' && s.world.objects.folio !== 'manor') commit(s, { kind: 'observation', title: 'The red folio is missing', actor: 'player', parents: [inspected], playerText: 'A clean rectangle in the dust marks where the red folio lay. It has been moved. The estate solicitor keeps related files at the vestry.' });
      else if (CASE.id==='last-bell' && action.object === 'drawer' && s.world.objects.folio !== 'drawer') commit(s, { kind: 'observation', title: 'Routine deeds in the drawer', actor: 'player', parents: [inspected], playerText: 'The drawer contains routine parish deeds. The red estate folio is not here.' });
      else if (!K.addEvidence(s, obj.clue, inspected, `${LOCATIONS[at].name} · ${obj.label}`)) commit(s, { kind: 'observation', title: 'You review an existing clue', actor: 'player', parents: [inspected], playerText: `You have already recorded ${obj.label.toLowerCase()}. ${CLUES[obj.clue].text}` });
      // Discovery gates: acquiring a clue can unlock a previously hidden object whose prerequisites are met.
      const gates = ActiveCase.model.gates;
      if (gates && s.world.flags.lockedObjects?.length) {
        const acq = new Set(s.world.player.evidence.map(e => e.clue));
        const stillLocked = s.world.flags.lockedObjects.filter(o => !(gates[o] && gates[o].every(r => acq.has(r))));
        if (stillLocked.length !== s.world.flags.lockedObjects.length)
          commit(s, { kind: 'observation', actor: 'player', title: 'A further lead opens up', parents: [inspected], changes: { 'flags.lockedObjects': stillLocked }, playerText: 'What you just found points you to something you had overlooked — a new lead is now within reach.' });
      }
      K.advance(s, 3, start);
      break;
    }
    case 'endConversation': break;
    case 'ask': B.ask(s, action.person, action.topic || 'night', start); break;
    case 'present': B.present(s, action.person, action.clue, action.tone || 'private', start); break;
    case 'wait': { const n = Math.max(1, Math.min(60, Math.round(Number(action.minutes) || 10))); commit(s, { kind: 'observation', title: `You wait ${n} minutes`, actor: 'player', parents: [start], playerText: `You wait for ${n} minutes. The village continues around you.` }); K.advance(s, n, start); break; }
    case 'pin': {
      if (!K.has(s, action.clue)) { K.reject(s, 'Unknown notebook entry', 'Discover the evidence before pinning it.', start); break; }
      const pins = s.world.player.pins;
      commit(s, { kind: 'notebook', title: `${pins.includes(action.clue) ? 'Unpinned' : 'Pinned'}: ${CLUES[action.clue].title}`, actor: 'player', parents: [start], changes: { 'player.pins': pins.includes(action.clue) ? pins.filter((x) => x !== action.clue) : [...pins, action.clue] } });
      break;
    }
    case 'note': { const value = String(action.text || '').trim().slice(0, 1000); if (value) commit(s, { kind: 'notebook', title: 'You record a hypothesis', actor: 'player', parents: [start], changes: { 'player.notes': [...s.world.player.notes, { text: value, minute: s.world.minute }].slice(-30) } }); break; }
    case 'accuse': {
      if (!K.local(s, 'bell')) { K.reject(s, 'The constable is not here', 'Bring your case to Constable Bell at the village square.', start); break; }
      const result = B.checkCase(s, action);
      if (result.supported) { const ending = { suspect: action.suspect, method: action.method, motive: action.motive, evidence: result.selected, routes: result.routes }; commit(s, { kind: 'resolution', title: 'Bell accepts your case', actor: 'bell', parents: [start, ...result.selected.map((c) => s.world.player.evidence.find((e) => e.clue === c).eventId)], changes: { status: 'solved', ending }, data: { rubric: result.query?'Finite competing explanations':'Authored case evidence requirements', ...(result.query?{forensicQuery:result.query,alternatives:result.alternatives}:{}), ...ending }, playerText: result.feedback ?? CASE.resolutionText ?? 'Bell reads your notes twice, then closes the folder. “The accounts explain why. The records establish when. And the evidence connects Silas to the crime. We have our case.”\n\nBell opens a clean page in his ledger. The investigation has a conclusion supported by evidence, and the village’s favorite rumor has not survived it.' }); }
      else K.reject(s, 'The accusation is not sufficiently supported', result.feedback ?? 'Bell sets the file down. “I need a connected case: the medical window, reliable whereabouts, and evidence linking the suspect to the act and its motive. Compare the documents with the testimony, and make sure the relevant entries are selected.”', start, { ...(result.status?{assessment:result.status,alternatives:result.alternatives}:{}), selected: result.selected, suspect: action.suspect, method: action.method, motive: action.motive });
      break;
    }
    case 'look': commit(s, { kind: 'observation', title: 'You look around', actor: 'player', parents: [start], playerText: LOCATIONS[s.world.player.location].description }); break;
    default: K.reject(s, 'Command not understood', 'Try “go manor”, “inspect desk”, “ask Clara about alibi”, “wait 10”, or choose an action on screen.', start);
  }
  commit(s, { kind: 'checkpoint', title: 'Action complete', actor: 'player', parents: [start], data: { boundary: true } });
  return s;
}

// Called by the validated character pipeline on an isolated session copy.
function dispatchCharacter(s,{person,text,proposal,action,audit,useAuthored=false,presented=null,origin=null,queuedPlan=null}){
  if(s.world.status==='solved'||!PEOPLE[person]||!K.local(s,person)||s.world.npcs[person].travel)throw Error('Conversation is no longer available.');
  const command=commit(s,{kind:'command',title:`Speak to ${PEOPLE[person].name}`,actor:'player',data:{action:{type:'converse',person,text},origin:origin?copy(origin):null}});
  const previous=s.world.player.conversation;
  const engagement=commit(s,{kind:'action',title:`You engage ${PEOPLE[person].name}`,actor:'player',parents:[command],changes:{'player.conversation':person}});
  K.life.engagement(s,person,engagement);
  if(previous&&previous!==person){K.life.engagement(s,previous,engagement);K.decide(s,previous,engagement);}
  const heard=commit(s,{kind:'speech',title:`You address ${PEOPLE[person].name}`,actor:'player',parents:[command],data:{listener:person,assertion:text,unverified:true,presented},playerText:`You
“${text}”`});
  K.remember(s,person,heard);
  if(presented){if(!K.has(s,presented))throw Error('Unacquired evidence.');K.believe(s,person,`player_has_${presented}`,`The detective has shown me ${CLUES[presented].title.toLowerCase()}.`,.99,'observation',heard,true);}
  const decision=commit(s,{kind:'decision',title:`${PEOPLE[person].name} chooses how to respond`,actor:person,parents:[heard,...proposal.sources],data:{selected:proposal.intent,candidates:[],reason:proposal.rationale,proposal:copy(proposal),characterAudit:copy(audit)}});
  if(!useAuthored&&['tentatively_accept','doubt'].includes(proposal.belief)){
    // Player reports stay attributed and uncertain; they cannot replace case facts.
    const existing=s.world.npcs[person].beliefs;
    const reports=existing.filter(b=>b.key.startsWith('player_report_'));
    if(reports.length>=12)commit(s,{kind:'belief',title:`${PEOPLE[person].name} archives an older player report`,actor:person,parents:[decision],changes:{[`npcs.${person}.beliefs`]:existing.filter(b=>!reports.slice(0,reports.length-11).includes(b))}});
    K.believe(s,person,`player_report_${heard}`,`The detective claims: ${text}`,proposal.belief==='tentatively_accept'?.6:.2,'testimony',heard,null);
  }
  const start=s.events.length;
  if(action){
    if(useAuthored)K.withoutPlayerPresentLine(s,()=>dispatch(s,action));
    else K.withSpeech(s,{...proposal,person,parents:[heard,decision]},()=>K.withoutPlayerPresentLine(s,()=>dispatch(s,action)));
  }else{
    K.speech(s,person,proposal.utterance,decision,{intent:proposal.intent,topic:proposal.intent,claims:[],characterTurn:true});
    K.advance(s,3,command);
  }
  const reply=s.events.slice(start).find(e=>e.kind==='speech'&&e.actor===person&&e.data.listener==='player');
  if(!reply||s.events.slice(start).some(e=>e.kind==='rejected'))throw Error('The selected account became unavailable.');
  const npc=s.world.npcs[person],prior=npc.dialogueState??{turns:0,disclosures:[]};
  const dialogueState={turns:prior.turns+1,lastIntent:proposal.intent,lastPlayerEvent:heard,lastReplyEvent:reply.id,
    topic:proposal.account??prior.topic??null,openQuestion:proposal.intent==='clarify'?reply.data.assertion:null,
    disclosures:[...new Set([...prior.disclosures,...(proposal.account?[proposal.account]:[])])],lastDecision:decision};
  const delta=useAuthored?0:proposal.trust==='warmer'?.03:proposal.trust==='cooler'?-.03:0;
  commit(s,{kind:'relationship',title:`${PEOPLE[person].name} retains this exchange`,actor:person,parents:[decision,reply.id],changes:{[`npcs.${person}.dialogueState`]:dialogueState,[`npcs.${person}.trust`]:Math.max(0,Math.min(1,npc.trust+delta))}});
  if(queuedPlan)scheduleCharacterPlan(s,queuedPlan,decision);
  if(proposal.engagement==='end'&&!useAuthored)dispatch(s,{type:'endConversation'});
  commit(s,{kind:'checkpoint',title:'Character turn complete',actor:'player',parents:[command,decision],data:{boundary:true}});
  return s;
}

function playerView(s) {
  const w = s.world, at = w.player.location;
  return { minute: w.minute, status: w.status, location: at, scene: LOCATIONS[at], profiles: Object.entries(w.npcs).map(([id,npc])=>({id,...publicPerson(id),metrics:npc.location===at&&!npc.travel?{trust:npc.trust,stress:npc.stress}:null})), people: Object.entries(w.npcs).filter(([, p]) => p.location === at).map(([id]) => ({ id, ...publicPerson(id) })), evidence: w.player.evidence.map((e) => ({ ...e, ...CLUES[e.clue],text:e.text??CLUES[e.clue].text })), pins: copy(w.player.pins), notes: copy(w.player.notes), lastSeen: copy(w.player.lastSeen), transcript: s.events.filter((e) => e.playerText).map((e) => ({ id: e.id, minute: e.minute, kind: e.kind, text: e.playerText, actor: e.actor })), ending: copy(w.ending) };
}
const publicPerson = (id) => ({ name: PEOPLE[id].name, initials: PEOPLE[id].initials, role: PEOPLE[id].role, color: PEOPLE[id].color, public: PEOPLE[id].public });

return {CASE,LOCATIONS,PEOPLE,CLUES,OBJECTS,gates:ActiveCase.model.gates,SUSPECTS,PILLARS,baseWorld,commit,distance,worldAt,diagnostics,exportSession,importSession,parseCommand,followupOptions,playerClaims,checkCase,caseHealth,characterPlans,scheduleCharacterPlan,createSession,dispatch,dispatchCharacter,playerView,publicPerson,kernel:K,behavior:B};
}
