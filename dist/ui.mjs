import {deliberateWorld} from './autonomy-turn.mjs';
import {directMorning} from './morning-director.mjs';
import {directorEnabled,setDirectorEnabled,commitDirectedTurn} from './director-turn.mjs';
import {prepareCharacterTurn,proposeCharacterTurn,applyCharacterTurn} from './character-turn.mjs';
import {ART,clueArt} from './art.mjs';
import {claimsAt,claimRelations} from './claims.mjs';
import {exportDialogueSave,importDialogueSave,dialogueEntities,normalizeBoardNotes} from './dialogue-save.mjs';
import {idbGet,idbSet} from './idb-save.mjs';
import {perspectiveAt,missedAt} from './inspector.mjs';
import {registerKernelCase,caseTables,CASE_OPTIONS,SUSPECTS,PILLARS,copy,createSession,dispatch,followupOptions,playerClaims,parseCommand,playerView,worldAt,timeLabel,distance,diagnostics,caseHealth,exportSession,importSession,inSentence} from './engine.mjs';
import {llmActive,llmConfig,setLlmConfig,parseCritic,turnTimeout} from './llm.mjs';

const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storageKey='living-mystery.bellweather.v1';
const BOARD_KEY='living-mystery.board.v1';
let session,loadedAudit=new Map(),loadedBoard={},saveError=false,hadLocalSave=false;
try{const saved=localStorage.getItem(storageKey);if(saved){hadLocalSave=true;const restored=importDialogueSave(saved);session=restored.session;loadedAudit=restored.audit;loadedBoard=restored.boardNotes;if(!restored.hasBoard){try{loadedBoard=normalizeBoardNotes(session,JSON.parse(localStorage.getItem(BOARD_KEY)));}catch{}}}else session=createSession(17);}catch{session=createSession(17);saveError=true;}
const BASE_PILLARS=PILLARS;
let {CASE,LOCATIONS,PEOPLE,CLUES,OBJECTS}=caseTables(session),BOARD_PILLARS=caseTables(session).PILLARS??BASE_PILLARS;
function syncCase(){({CASE,LOCATIONS,PEOPLE,CLUES,OBJECTS}=caseTables(session));BOARD_PILLARS=caseTables(session).PILLARS??BASE_PILLARS;}
let perspective='world',detailPanel=null,missedRevealed=false;
// Player-built reasoning board: { [suspect]: { [clue]: {pillar,polarity} } }.
// Saved in the investigation envelope, independently of simulation events.
let boardNotes=loadedBoard;
function saveBoardNotes(){persist();}
let actionGroup='inspect',sceneTransition=null,historyPage=0;
let chatSince={id:null,from:0},villageView='map',invSort='time',mode='game',notebook='talk',evidenceKind='All',reasonSuspect=null,chat=null,chosenClue=null,inspectorTab='world',person='clara',personTab='profile',cursor=null,typeFilter='all',actorFilter='all',query='',includeClock=false,timer=null,healthCache=null,forecast=null;
// Persisted presentation audit is separate from deterministic engine events.
const dialogueAudit=loadedAudit;
const realized=new Map([...dialogueAudit].map(([id,r])=>[id,`${actorName(session.events.find(e=>e.id===id).actor)}\n"${r.text}"`]));
let characterBusy=false,characterController=null,characterEpoch=0,characterDraft='',characterPending=null,directorPending=false,autonomyRunning=false,autonomyController=null;
function cancelCharacter(){characterEpoch++;characterController?.abort();characterController=null;autonomyController?.abort();characterBusy=false;characterPending=null;directorPending=false;}
// Ordinary NPC life deliberation runs detached after the player's turn commits, so
// it never blocks the action or its reply. It commits only if the session is
// unchanged (else the model selection is stale and discarded); a failed or
// cancelled deliberation simply leaves that NPC on its scripted policy.
async function scheduleAutonomy(){
  if(autonomyRunning||characterBusy)return;
  // generated cases: the morning director plans the next hour (docs/living-village.md); checked, detached, never blocking
  if(CASE.kernel&&llmActive()&&llmConfig().reasoning){
    autonomyRunning=true;autonomyController=new AbortController();
    try{const res=await directMorning(session,{signal:autonomyController.signal,endpoint:llmConfig().endpoint});
      if(res.status!=='not_needed')dlog('morning_director',{status:res.status,plan:res.plan,audit:res.audit});
      if(!characterBusy&&['accepted','empty'].includes(res.status)){healthCache=null;persist();render();}
    }catch(e){dlog('morning_director',{status:'error',error:String(e.message)});}finally{autonomyRunning=false;autonomyController=null;}
    return;
  }
  if(!(llmActive()&&llmConfig().reasoning&&session.world.flags?.lifeVersion))return;
  autonomyRunning=true;autonomyController=new AbortController();
  try{const res=await deliberateWorld(session,{signal:autonomyController.signal,endpoint:llmConfig().endpoint});
    if(!characterBusy&&['accepted','fallback'].includes(res.status)){healthCache=null;persist();render();}
  }catch{}finally{autonomyRunning=false;autonomyController=null;}
}
const pending=new Set();let realizeGen=0;
// When AI voice is on, a line we've dispatched for restyling shows a brief
// placeholder until it lands (never the written line first); once voiced, the
// written line is available on hover. Lines we never dispatched (history,
// AI off) just show the authored text.
function displayText(e){if(realized.has(e.id))return realized.get(e.id);if(pending.has(e.id))return `${actorName(e.actor)}\n“…”`;return e.text;}
function authoredLineOnly(e){return e.text.replace(/^[^\n]*\n/,'');}
function resetRealized(){cancelCharacter();realized.clear();dialogueAudit.clear();pending.clear();realizeGen++;forecast=null;}
function stopRealizing(){pending.clear();realizeGen++;}
function renderVoiceResult(){const drafts=['#command','#note','#character-question'].map(selector=>({selector,value:$(selector)?.value}));const focus=document.activeElement?.id;render();for(const d of drafts){const el=$(d.selector);if(el&&d.value!==undefined)el.value=d.value;}if(focus&&['command','note','character-question'].includes(focus))$('#'+focus)?.focus({preventScroll:true});}
// Event index from its id (`e00001` -> 0), matching engine's nextId format.
function eventIndexOf(id){return (+String(id).slice(1))-1;}
// While a voiced line is pending, hold back everything that happened AFTER it
// (e.g. the clue it produced) so the reveal is speech-first, then evidence.
// Resolves progressively: as each pending line lands, the next content appears.
function visibleTranscript(transcript){
  if(!pending.size)return transcript;
  let cutoff=Infinity;for(const id of pending){const i=eventIndexOf(id);if(i<cutoff)cutoff=i;}
  return transcript.filter(e=>eventIndexOf(e.id)<=cutoff);
}
const glyphs={history:'◇',arrival:'↳',command:'›',action:'◆',movement:'↗',decision:'⑂',belief:'◈',speech:'“',relationship:'↔',emotion:'≈',evidence:'+',notebook:'⌑',observation:'◉',rejected:'!',resolution:'✓',clock:'·',checkpoint:'·',memory:'⋮'};
const typeNames={history:'Case history',arrival:'Arrival',command:'Player command',action:'Action',movement:'Movement',decision:'Decision',belief:'Belief',speech:'Conversation',relationship:'Relationship',emotion:'Emotion',evidence:'Evidence',notebook:'Notebook',observation:'Observation',rejected:'Rejected action',resolution:'Resolution',clock:'Clock',checkpoint:'Checkpoint',memory:'Memory'};
function artImage(src,kind){return src?`<img class="game-art ${kind}" src="${esc(src)}" alt="" loading="lazy" decoding="async">`:'';}
function avatar(id,size=''){const p=PEOPLE[id];return `<span class="avatar ${size}" style="--person:${p.color}">${p.initials}${artImage(ART.people[id],'portrait-art')}</span>`;}
function locationArt(id,kind='place-art'){return artImage(ART.locations[id],kind);}
function artifactArt(id,kind='artifact-art'){
  if(!CASE.kernel)return session.world.caseId?'':artImage(ART.artifacts[id],kind);
  const c=CLUES[id];if(!c)return '';
  const who=['testimony','behavior'].includes(c.raw)?(c.speaker??c.about):null;   // accounts and behaviour: the person
  return artImage(who&&ART.people[who]?ART.people[who]:clueArt(c.title,c.raw,c.art),`${kind}${who?' clue-person-art':''}`)||`<span class="${kind} art-placeholder" aria-hidden="true">${c.raw==='behavior'?'👁':'✦'}</span>`;
}
function actorName(id){return PEOPLE[id]?.name??(id==='player'?'You':id==='world'?'World':'Simulation');}
function placeName(id){return LOCATIONS[id]?.name??(id==='transit'?'In transit':id==='drawer'?'Vestry · deed drawer':id==='silas'?'Carried by Silas':id??'—');}
function eventById(id){return session.events.find(e=>e.id===id);}
function selectedIndex(){return cursor===null?session.events.length-1:Math.min(cursor,session.events.length-1);}
function selectedWorld(){return cursor===null?session.world:worldAt(session,selectedIndex());}
function selectEvent(index){cursor=Number(index);if(cursor<0||cursor>=session.events.length)cursor=null;stopReplay();render();}
// Debug log: batched to the game server (logs/game.log). Best-effort; never affects play.
const dlogQueue=[];let dlogTimer=null;
function dlog(kind,data={}){
  try{dlogQueue.push({t:new Date().toISOString(),kind,caseId:session?.world?.caseId??null,minute:session?.world?.minute??null,at:session?.world?.player?.location??null,...data});}catch{}
  if(!dlogTimer)dlogTimer=setTimeout(dlogFlush,800);
}
function dlogFlush(){
  dlogTimer=null;if(!dlogQueue.length)return;
  const batch=dlogQueue.splice(0,dlogQueue.length);
  try{fetch('/__log',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(batch),keepalive:true}).catch(()=>{});}catch{}
}
function toast(message,{ms}={}){dlog('toast',{message});const el=$('#toast');el.innerHTML=`<span class="toast-text">${esc(message)}</span><button type="button" class="toast-close" aria-label="Dismiss">×</button>`;el.classList.add('visible');clearTimeout(toast.timer);
  // long enough to read: ~70 ms per character, 4–16 s; hovering pauses it, clicking closes it
  const wait=ms??Math.min(16000,Math.max(4200,String(message).length*70));
  const hide=()=>el.classList.remove('visible');toast.timer=setTimeout(hide,wait);
  if(!toast.wired&&el.addEventListener){toast.wired=true;
    el.addEventListener('mouseenter',()=>clearTimeout(toast.timer));
    el.addEventListener('mouseleave',()=>{toast.timer=setTimeout(hide,2500);});
    el.addEventListener('click',()=>{clearTimeout(toast.timer);hide();});}
}
function persist(){
  const full=exportDialogueSave(session,dialogueAudit,boardNotes,{pretty:false});
  // Synchronous mirror to localStorage for instant boot and browsers without IndexedDB.
  // If the full blob exceeds the ~5MB quota, keep a compact gameplay-only copy (audits dropped).
  let localFull=false,localOk=false;
  try{localStorage.setItem(storageKey,full);localStorage.removeItem?.(BOARD_KEY);localFull=localOk=true;}
  catch{try{localStorage.setItem(storageKey,exportDialogueSave(session,new Map(),boardNotes,{pretty:false}));localStorage.removeItem?.(BOARD_KEY);localOk=true;}catch{}}
  // Primary large-capacity durable store: IndexedDB. Keeps the full AI trace even when the
  // localStorage mirror had to drop it under quota.
  const idb=idbSet(storageKey,full);
  if(localFull){saveError=false;idb.catch(()=>{});return;}
  if(localOk){saveError=false;idb.catch(()=>toast('Low on browser storage: your progress was saved, but AI reasoning traces were dropped from autosave. Use Export to keep the full record.'));return;}
  // localStorage rejected everything — depend entirely on IndexedDB.
  idb.then(()=>{if(saveError){saveError=false;render();}}).catch(()=>{const was=saveError;saveError=true;if(!was){toast('This browser could not save the investigation. Use Export to keep a copy.');render();}});
}
function presentClue(person,clue,tone){act({type:'present',person,clue,tone});}
function act(action){dlog('action',{action});const before=session.events.length;globalThis.queueMicrotask?.(()=>{for(const e of session.events.slice(before))if(e.kind==='rejected')dlog('rejected',{title:e.title,text:e.playerText,reason:e.data?.reason,admission:e.data?.admission?.reason});});if(characterBusy){toast('Wait for the reply or cancel it before acting.');return;}if(llmActive()&&llmConfig().reasoning&&['ask','present'].includes(action.type)){const label=action.type==='present'?`${caseTables(session).behavior?.presentLine?.(session,action.person,action.clue)??`I'd like to discuss ${CLUES[action.clue]?.title?.toLowerCase()}.`}${action.tone==='press'?' If you refuse, I will expose your private affairs.':''}`:([...topicsFor(action.person),...followupOptions(session,action.person)].find(([topic])=>topic===action.topic)?.[1]??action.topic??'Tell me about last night.');runCharacter(action.person,label,action);return;}if(directorEnabled()||(llmActive()&&llmConfig().reasoning&&session.world.flags.lifeVersion)){return runDirectedAction(action);}stopReplay();cursor=null;try{const from=session.world.player.location;dispatch(session,action);sceneTransition=from!==session.world.player.location?{from,to:session.world.player.location}:null;if(sceneTransition){chat=null;actionGroup='inspect';}healthCache=null;persist();render();if(sceneTransition){$('.scene-heading')?.focus({preventScroll:true});}setTimeout(scheduleAutonomy,0);}catch(error){toast(`The action could not be completed: ${error.message}`);}}
async function runDirectedAction(action){
  autonomyController?.abort(); // cancel any detached NPC deliberation before staging this turn
  stopReplay();cursor=null;const target=session,epoch=++characterEpoch,from=session.world.player.location,useDirector=directorEnabled();
  characterController=new AbortController();characterBusy=true;directorPending=false;
  try{
    const trial=copy(target);
    dispatch(trial,action);
    const result=useDirector?await commitDirectedTurn(target,trial,{signal:characterController.signal,onChecking:()=>{if(epoch===characterEpoch&&session===target){directorPending=true;render();}}}):{status:'not_needed'};
    if(!useDirector&&epoch===characterEpoch&&session===target){target.world=trial.world;target.events=trial.events;}
    if(epoch!==characterEpoch||session!==target)return;
    if(!['verified','not_needed','cancelled'].includes(result.status))toast(`${result.reason}. Turn deferred; disable Z3 checks to continue scripted play.`);
    sceneTransition=from!==session.world.player.location?{from,to:session.world.player.location}:null;
    if(sceneTransition){chat=null;actionGroup='inspect';}healthCache=null;persist();setTimeout(scheduleAutonomy,0);
  }catch(error){if(epoch===characterEpoch)toast(error.message);}
  finally{if(epoch===characterEpoch){characterBusy=false;characterController=null;directorPending=false;render();}}
}
async function runCharacter(person,text,action=null){
  if(characterBusy)return;
  if(!llmActive()||!llmConfig().reasoning){toast('Enable character reasoning in AI settings to ask in your own words.');return;}
  autonomyController?.abort(); // a detached NPC deliberation must not commit under this turn's ticket
  let ticket;try{ticket=prepareCharacterTurn(session,{person,text,action});}catch(error){toast(error.message);return;}
  stopReplay();cursor=null;const target=session,epoch=++characterEpoch,useDirector=directorEnabled();
  characterController=new AbortController();characterBusy=true;characterPending={person,text};renderVoiceResult();
  try{
    const result=await proposeCharacterTurn(ticket,{signal:characterController.signal,timeoutMs:turnTimeout(undefined,fetch)});
    dlog('character_turn',{person,text,action,status:result.audit?.status,reason:result.audit?.reason,
      accounts:ticket.context.accounts.map(a=>a.id+(a.deceptive?'[lie]':'')),
      attempts:(result.audit?.attempts||[]).map(a=>({validation:a.validation,critic:String(a.critic?.response??'').slice(0,400),reply:String(a.generation?.response??'').slice(0,400)})),
      chosen:result.proposal?{intent:result.proposal.intent,account:result.proposal.account,utterance:result.proposal.utterance}:null,
      spoken:result.proposal?.utterance??null,
      rejections:(result.audit?.attempts||[]).map(a=>{if(a.validation&&a.validation!=='pass')return `check: ${String(a.validation).slice(0,160)}`;
        const v=parseCritic(a.critic?.response??'');return v?.verdict==='reject'?`critic: ${(v.violations||[]).join(' | ').slice(0,300)}`:null;}).filter(Boolean)});
    if(epoch!==characterEpoch||session!==target)return;
    const candidate=copy(session);
    const applied=applyCharacterTurn(candidate,ticket,result);
    // a fallback's words are chosen when the turn is applied: log what the player was actually told
    if(!result.proposal&&!applied.cancelled)dlog('character_fallback',{person,text,spoken:candidate.events.findLast(e=>e.kind==='speech'&&e.actor===person&&e.data?.listener==='player')?.data?.assertion??null});
    if(!applied.cancelled){
      const checked=useDirector?await commitDirectedTurn(target,candidate,{signal:characterController.signal,onChecking:()=>{if(epoch===characterEpoch&&session===target){directorPending=true;render();}}}):{status:'not_needed'};
      if(epoch!==characterEpoch||session!==target)return;
      if(!['verified','not_needed'].includes(checked.status)){healthCache=null;persist();if(checked.status!=='cancelled')toast(`${checked.reason??'Turn deferred'}. Disable World Director Z3 checks (or run the Z3 service on :8788) to continue.`);return;}
      if(!useDirector){target.world=candidate.world;target.events=candidate.events;}
    }
    if(!applied.cancelled){characterDraft='';if($('#character-question'))$('#character-question').value='';healthCache=null;persist();if(result.proposal?.engagement==='end')chat=null;if(applied.fallback&&!['rejected','disabled'].includes(result.audit?.reason)&&result.audit?.context?.accounts?.length)toast(`Used the scripted line: ${fallbackReason(result.audit)}.`,{ms:12000});setTimeout(scheduleAutonomy,0);}
  }catch(error){if(epoch===characterEpoch)toast(`The character turn was not applied: ${error.message}`);}
  finally{if(epoch===characterEpoch){characterBusy=false;characterController=null;characterPending=null;directorPending=false;renderVoiceResult();}}
}
const VALIDATION_REASON={invalid_json:'the reply was not in the expected format',invalid_shape:'the reply was malformed',invalid_choice:'the reply was malformed',
 invalid_text:'the reply was malformed',unavailable_account:'it tried to use an account this character cannot give yet',unavailable_plan:'it proposed an action the character cannot take',
 unsupported_claims_or_sources:'it changed the facts of the account',invalid_deception:'it lied where the character tells the truth, or the other way round',
 changed_numbers:'it added a time or number that is not in the account',invalid_belief_choice:'the reply was malformed'};
function fallbackReason(audit){
  const r=audit?.reason;
  if(r==='timeout')return 'the AI took too long to answer';
  if(r==='disabled')return 'AI is turned off';
  if(r&&r!=='rejected')return `the AI was unavailable (${String(r).slice(0,60)})`;
  const last=(audit?.attempts||[]).at(-1);
  if(last&&last.validation&&last.validation!=='pass')return `the AI reply was rejected because ${VALIDATION_REASON[last.validation.split(':')[0]]||'it stated facts this character does not know'}`;
  const crit=last?.critic?.response;let v=null;try{v=JSON.parse(String(crit).replace(/^[^{]*/,'').replace(/[^}]*$/,''))?.violations?.[0];}catch{}
  if(v&&/memor|not (present|contained|in) (in )?the (selected )?account|added (a )?fact/i.test(String(v)))return 'the AI reply revealed something the character remembers but has not told you yet, so they kept it to themselves';
  return v?`the fact-checker rejected the AI reply (${String(v).slice(0,140)})`:'the AI reply could not be checked';
}
function characterComposer(){if(llmActive())turnTimeout(undefined,fetch);return llmActive()&&llmConfig().reasoning?`<form id="character-form" class="character-composer"><label for="character-question">Speak in your own words</label><textarea id="character-question" maxlength="1200" rows="2" placeholder="Ask anything… (Enter to send)" ${characterBusy?'disabled':''}>${esc(characterDraft)}</textarea><button class="sr-only" ${characterBusy?'disabled':''} tabindex="-1">Send</button></form>`:'';}
// While a character turn is in flight, show the player's question and a spinner
// in the main feed (below the question, before the reply arrives).
function pendingEntries(){
  if(directorPending)return '<article class="journal-entry pending-turn"><div class="journal-prose character-status"><span class="spinner" aria-hidden="true"></span><span role="status">World Director is checking the turn…</span><button class="subtle-button" data-do="cancel-character">Cancel</button></div></article>';
  if(!characterBusy||!characterPending)return '';
  const {person,text}=characterPending;
  return `<article class="journal-entry"><div class="journal-meta"><span>${timeLabel(session.world.minute)}</span><span>YOU</span></div><div class="journal-prose"><p>${esc(text)}</p></div></article><article class="journal-entry spoken pending-turn"><div class="journal-meta"><span>${esc(PEOPLE[person].name)}</span></div><div class="journal-prose character-status"><span class="spinner" aria-hidden="true"></span><span role="status">considering…</span><button type="button" class="subtle-button" data-do="cancel-character">Cancel</button></div></article>`;
}
function getHealth(){if(!healthCache||healthCache.eventCount!==session.events.length)healthCache=diagnostics(session);return healthCache;}
function paragraphs(text){return String(text).split('\n\n').map(p=>`<p>${esc(p).replaceAll('\n','<br>')}</p>`).join('');}

function header(){return `<header class="topbar">
  <button class="brand" data-do="mode" data-value="game" aria-label="Return to the investigation"><span class="brand-mark">L<span>M</span></span><span><strong>Living Mystery</strong><small>${esc(CASE.title)}</small></span></button>
  <nav class="mode-switch" aria-label="Application mode"><button class="${mode==='game'?'active':''}" data-do="mode" data-value="game" aria-pressed="${mode==='game'}">Investigation</button><button class="${mode==='reasoning'?'active':''}" data-do="mode" data-value="reasoning" aria-pressed="${mode==='reasoning'}">Clue Board</button><button class="${mode==='inspector'?'active':''}" data-do="mode" data-value="inspector" aria-pressed="${mode==='inspector'}">Inspector <span class="small-symbol">⌘</span></button></nav>
  <div class="top-tools">${saveError?'<button class="save-warning" data-do="export" title="Saving failed on this device. Export keeps a copy.">⚠ Not saved · Export</button>':''}<button class="accuse-button" data-do="accusation">${session.world.status==='solved'?'Review your accusation':'⚖ Accuse'}</button><div class="world-time"><strong>${timeLabel(session.world.minute)}</strong><span>${CASE.date}</span></div><button class="icon-button" data-do="menu" aria-label="Save, import, restart, and help">•••</button></div>
</header>`;}

function game(){chat??=session.world.player.conversation??null;const v=playerView(session);if(chat&&!v.people.some(p=>p.id===chat))chat=null;return `<div class="game-shell">
  <div class="left-col">
  <aside class="village-panel panel" aria-label="Village navigation"><div class="panel-heading"><span class="eyebrow">BELLWEATHER</span><span class="map-toggle">${[['map','Map'],['list','List']].map(([id,l])=>`<button class="${villageView===id?'active':''}" data-do="village-view" data-id="${id}" aria-pressed="${villageView===id}">${l}</button>`).join('')}</span></div>
  ${villageView==='map'?mapView(v):placeList(v)}
  <div class="side-rule"></div><section class="room-left" aria-label="Things to examine here"><div class="panel-heading"><span class="eyebrow">LOOK AROUND</span><span class="meta">examine · 3 min</span></div>${v.status==='solved'?'':roomInspect(v)}</section>
  <div class="village-footer">${v.status==='solved'?`<div class="solved-actions"><span class="gold">✓ Your evidence supported the accusation.</span><button class="primary" data-do="mode" data-value="inspector">Explore the full history</button></div>`:`<div class="wait-row"><span class="meta">◷ Wait</span>${[5,10,30].map(n=>`<button class="wait-chip" data-do="wait" data-minutes="${n}" aria-label="Wait ${n} minutes">${n} min</button>`).join('')}</div>`}</div></aside>
  ${llmActive()&&llmConfig().reasoning?'':`<details class="command-disclosure"><summary>Type a command (optional)</summary><form class="command-line" id="command-form"><span aria-hidden="true">›</span><label for="command" class="sr-only">Type a supported game command</label><input id="command" name="command" autocomplete="off" placeholder="Try ‘go manor’ or ‘ask Clara about alibi’" ${v.status==='solved'?'disabled':''}><button type="submit" aria-label="Run command">↵</button></form></details>`}
  </div>
  <main class="story-panel panel ${chat?'in-dialogue':''}"><div class="scene-heading scene-stage" tabindex="-1">${locationArt(v.location,'scene-art')}${sceneTransition?`<div class="scene-transition" role="status">${esc(placeName(sceneTransition.from))} → <strong>${esc(v.scene.name)}</strong> · ${timeLabel(v.minute)}</div>`:''}<div class="scene-title"><div class="eyebrow gold">${esc(CASE.kernel?(CASE.title||'A generated case').toUpperCase():'THE LAST BELL')} <span class="divider">/</span> ${v.status==='solved'?'CASE CLOSED':timeLabel(v.minute)}</div><h1>${v.status==='solved'?'A case made.':v.scene.name}</h1><p class="scene-atmosphere">${v.status==='solved'?'The village will remember how you found the truth.':v.scene.atmosphere}</p><div class="scene-description">${paragraphs(v.scene.description)}</div></div></div>
  ${chat&&v.status!=='solved'?dialogueView(v):`<div class="journal" id="journal" role="log" aria-label="What has happened here" aria-live="polite">${(()=>{const here=sinceArrival(visibleTranscript(v.transcript));return here.map(journalEntry).join('')+pendingEntries()||(v.status==='solved'?'':nextSteps(v));})()}</div>`}
  </main>
  <aside class="side-panel panel" aria-label="Your notebook">
  <div class="notebook-region"><div class="panel-heading"><span class="eyebrow">YOUR CASE FILE</span><span class="meta">${v.evidence.length} entries</span></div><h2 class="section-heading">The notebook</h2><div class="small-tabs" role="tablist" aria-label="Notebook views">${[['talk',chat?`Talk · ${esc(PEOPLE[chat]?.name.split(' ').slice(-1)[0]??'')}`:'Talk'],['evidence','Evidence'],['hints','Hints']].map(([id,label])=>`<button role="tab" aria-selected="${notebook===id}" class="${notebook===id?'active':''}" data-do="notebook" data-id="${id}">${label}</button>`).join('')}</div><div class="notebook-content ${notebook==='talk'?'is-talk':''}">${notebookContent(v)}</div></div>
  </aside>
</div>`;}

// ---------------------------------------------------------------------------------------------------------------
// The visible village (docs/visual-world.md): map, scene, dialogue, inventory. Everything here reads the session and
// the case tables; nothing reveals what the player could not see (no guilt, lies or unfound clues).
const MAP_POS={manor:[20,6],surgery:[62,4],vestry:[94,30],greenhouse:[4,36],square:[48,30],inn:[24,62],post:[72,58],boathouse:[6,92],mill:[46,94],halt:[92,88]};
// Layout positions (0-100) are fitted inside a margin so pins, names and faces never spill over the edge.
function mapPos(id,i,n){const [x,y]=MAP_POS[id]??[50+36*Math.cos(2*Math.PI*i/n),50+36*Math.sin(2*Math.PI*i/n)];return [9+x*.82,9+y*.78];}
// What the player knows about a place: things left to examine, a lead pointing there, or done.
function placeState(id){
  const locked=new Set(session.world.flags.lockedObjects||[]),hinted=new Set(session.world.flags.hinted||[]);
  const have=new Set(session.world.player.evidence.map(e=>e.clue)),visited=(session.world.player.visited||[]).includes(id);
  const objs=(LOCATIONS[id]?.objects||[]).filter(o=>OBJECTS[o]&&(session.world.flags.evidenceExpiry?.[OBJECTS[o].clue]??Infinity)>=session.world.minute);
  if(objs.some(o=>locked.has(o)&&hinted.has(o)))return 'lead';
  const open=objs.filter(o=>!locked.has(o)&&!have.has(OBJECTS[o].clue));
  if(open.length)return visited?'open':'new';
  return visited?(objs.length?'done':'visited'):'new';
}
const STATE_MARK={lead:'!',open:'?',new:'',done:'✓',visited:''};
const STATE_LABEL={lead:'A lead points here',open:'Things left to examine',new:'Not yet visited',done:'Everything here examined',visited:'Visited'};
// Where each person is shown on the map. In generated cases people move about the village during the morning, so the
// map shows where they really are: someone walking is drawn on the path between the two places, as far along as the
// walk has gone. The classic case shows only where the player can see them or last saw them.
function shownAt(v,id){const n=session.world.npcs[id];if(!n)return null;if(CASE.kernel)return n.travel?null:n.location;
  if(n.location===v.location&&!n.travel)return n.location;const seen=v.lastSeen[id];if(seen&&!seen.departed)return seen.location;return null;}
// Someone acting on their own this morning: a plan of theirs is under way (a step pending or in progress) or they are
// walking for it. Read from the recorded agendas, never guessed.
function actingNow(id){const n=session.world.npcs[id],steps=session.world.flags.morning?.agendas?.[id]??[];
  return Boolean(CASE.kernel&&n&&(steps.some(x=>x.state==='pending'||x.state==='active')||String(n.travel?.purpose??'').startsWith('Morning')));}
function mapFace(id){const acting=actingNow(id);
  return `<span class="map-face ${acting?'acting':''}" data-face="${id}"${acting?` title="${esc(PEOPLE[id].name)} is acting on their own"`:''}>${avatar(id,'tiny')}${acting?'<i class="acting-mark" aria-hidden="true">●</i>':''}</span>`;}
// The way someone walks from one place to another: the quickest route along the village's paths (Dijkstra over the
// links and their minutes), as a list of [place, minutes from the start].
function walkRoute(from,to){
  const best={[from]:0},prev={},todo=new Set(Object.keys(LOCATIONS));
  while(todo.size){let u=null;for(const x of todo)if(best[x]!==undefined&&(u===null||best[x]<best[u]))u=x;if(u===null||u===to)break;todo.delete(u);
    for(const [w,m] of Object.entries(LOCATIONS[u]?.links??{}))if(LOCATIONS[w]&&(best[w]===undefined||best[u]+m<best[w])){best[w]=best[u]+m;prev[w]=u;}}
  if(best[to]===undefined)return [[from,0],[to,1]];
  const path=[to];while(path[0]!==from)path.unshift(prev[path[0]]);
  return path.map(x=>[x,best[x]]);
}
function alongRoute(pos,from,to,f){
  const r=walkRoute(from,to),total=r.at(-1)[1]||1,t=f*total;
  for(let i=1;i<r.length;i++)if(t<=r[i][1]||i===r.length-1){const [a,ta]=r[i-1],[b,tb]=r[i],g=tb>ta?Math.max(0,Math.min(1,(t-ta)/(tb-ta))):1;
    return [pos[a][0]+g*(pos[b][0]-pos[a][0]),pos[a][1]+g*(pos[b][1]-pos[a][1])];}
  return pos[to];
}
function walkers(pos){
  if(!CASE.kernel)return '';
  return Object.entries(session.world.npcs).filter(([id,n])=>n.travel&&PEOPLE[id]&&pos[n.travel.from]&&pos[n.travel.to]).map(([id,n])=>{
    const {from,to,arrival}=n.travel,left=n.travel.departed??arrival-distance(from,to),f=Math.max(0,Math.min(1,(session.world.minute-left)/Math.max(1,arrival-left)));
    const [x,y]=alongRoute(pos,from,to,f);
    return `<span class="map-walker" style="left:${x}%;top:${y}%" role="img" aria-label="${esc(PEOPLE[id].name)}, walking to ${esc(LOCATIONS[to].name)}">${mapFace(id)}<b class="walk-arrow" aria-hidden="true">→</b></span>`;}).join('');
}
function mapView(v){
  const ids=Object.keys(LOCATIONS),pos=Object.fromEntries(ids.map((id,i)=>[id,mapPos(id,i,ids.length)]));
  const edges=[];for(const [a,l] of Object.entries(LOCATIONS))for(const [b,m] of Object.entries(l.links||{}))if(a<b&&LOCATIONS[b])edges.push([a,b,m]);
  const here=v.location,people={};for(const id of Object.keys(PEOPLE)){const at=shownAt(v,id);if(at&&LOCATIONS[at])(people[at]??=[]).push(id);}
  const lines=edges.map(([a,b])=>`<line x1="${pos[a][0]}" y1="${pos[a][1]}" x2="${pos[b][0]}" y2="${pos[b][1]}" class="${a===here||b===here?'near':''}"/>`).join('');
  const mins=edges.map(([a,b,m])=>`<span class="map-min ${a===here||b===here?'near':''}" style="left:${(pos[a][0]+pos[b][0])/2}%;top:${(pos[a][1]+pos[b][1])/2}%">${m}′</span>`).join('');
  const pins=ids.map(id=>{const [x,y]=pos[id],st=placeState(id),cur=id===here,ppl=people[id]||[];
    return `<button class="map-pin s-${st} ${cur?'current':''}" style="left:${x}%;top:${y}%" data-do="move" data-id="${id}" ${v.status==='solved'||cur?'disabled':''}
      aria-label="${esc(LOCATIONS[id].name)}${cur?', you are here':`, ${distance(here,id)} minute walk`}. ${STATE_LABEL[st]}${ppl.length?`. ${ppl.map(p=>PEOPLE[p].name+(actingNow(p)?' (acting on their own)':'')).join(', ')}`:''}">
      <span class="pin-art">${locationArt(id,'pin-img')}${cur?'<span class="you-marker" aria-hidden="true">You</span>':''}<i class="pin-state" title="${STATE_LABEL[st]}" aria-hidden="true">${STATE_MARK[st]}</i></span>
      ${ppl.length?`<span class="pin-people">${ppl.slice(0,4).map(mapFace).join('')}${ppl.length>4?`<small>+${ppl.length-4}</small>`:''}</span>`:''}</button>`;}).join('');
  // names on their own top layer so no neighbouring picture can cover them
  const names=ids.map(id=>{const [x,y]=pos[id];return `<span class="map-label ${id===here?'current':''}" style="left:${x}%;top:${y}%" aria-hidden="true">${esc(LOCATIONS[id].short??LOCATIONS[id].name)}</span>`;}).join('');
  return `<div class="village-map" role="group" aria-label="Village map"><svg class="map-paths" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${mins}${pins}${walkers(pos)}${names}</div>
    <div class="map-legend meta"><span><i class="pin-state s-lead">!</i>a lead points here</span><span><i class="pin-state s-open">?</i>things to examine</span><span><i class="pin-state s-done">✓</i>done</span>${CASE.kernel?'<span><i class="legend-acting" aria-hidden="true">●</i>acting on their own</span><span>→ walking</span>':''}<span>′ minutes on foot</span></div>`;
}
// Smooth movement: each face on the map glides from where it was drawn last time to where it is now (FLIP), so a walk
// shows as movement along the path rather than a jump. Skipped when the reader prefers reduced motion.
const lastFaces=new Map();
function rememberFaces(){const map=document.querySelector?.('.village-map');if(!map?.getBoundingClientRect)return;
  const m=map.getBoundingClientRect();lastFaces.clear();
  for(const el of map.querySelectorAll('[data-face]')){const r=el.getBoundingClientRect();lastFaces.set(el.dataset.face,{x:r.left-m.left,y:r.top-m.top});}}
function animateFaces(){const map=document.querySelector?.('.village-map');if(!map?.getBoundingClientRect||!lastFaces.size)return;
  if(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)return;
  const m=map.getBoundingClientRect();
  for(const el of map.querySelectorAll('[data-face]')){const was=lastFaces.get(el.dataset.face);if(!was||!el.animate)continue;
    const r=el.getBoundingClientRect(),dx=was.x-(r.left-m.left),dy=was.y-(r.top-m.top);
    if(Math.hypot(dx,dy)>2)el.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],{duration:Math.min(2200,400+Math.hypot(dx,dy)*6),easing:'ease-in-out'});}}
function placeList(v){return `<nav class="places">${Object.entries(LOCATIONS).map(([id,p])=>`<button data-do="move" data-id="${id}" class="place ${v.location===id?'current':''}" ${v.status==='solved'?'disabled':''} aria-current="${v.location===id?'location':'false'}">${locationArt(id)}<span class="place-num">${p.glyph}</span><span><strong>${p.name}</strong><small>${v.location===id?'You are here':`${distance(v.location,id)} min walk`}</small></span>${v.location===id?'<span class="here-mark" aria-hidden="true"></span>':''}</button>`).join('')}</nav>`;}
// Game-style conversation: their portrait and lines on the left, yours on the right; free text first, then chips.
function dialogueLines(v){
  const lines=[];
  // finds made during THIS conversation only (earlier ones are in the Evidence tab, ready to drag in)
  if(chatSince.id!==chat)chatSince={id:chat,from:session.events.length};
  const since=new Set(visibleTranscript(v.transcript).filter(t=>t.kind==='evidence'&&eventIndexOf(t.id)>=chatSince.from).map(t=>t.id));
  // a reply that was recorded as evidence is shown once: as the evidence card, on their side
  const all=visibleTranscript(v.transcript),recorded=new Map();
  for(const t of all){const e=session.events.find(x=>x.id===t.id);if(e?.kind!=='evidence')continue;
    const said=(e.parents||[]).map(pid=>session.events.find(x=>x.id===pid)).find(x=>x?.kind==='speech'&&x.actor===chat&&x.data?.listener==='player');
    if(said)recorded.set(said.id,t);}
  const merged=new Set([...recorded.values()].map(t=>t.id));
  for(const t of all){const e=session.events.find(x=>x.id===t.id);if(!e)continue;
    if(recorded.has(e.id)){lines.push(`<div class="bubble-row theirs recorded">${avatar(chat,'tiny')}${journalEntry(recorded.get(e.id))}</div>`);continue;}
    // what you find while talking (here, since the conversation began) appears in the conversation as a boxed card
    if(e.kind==='evidence'){if(since.has(t.id)&&!merged.has(t.id))lines.push(`<div class="bubble-row found">${journalEntry(t)}</div>`);continue;}
    if(e.kind!=='speech')continue;
    const mine=e.actor==='player'&&e.data?.listener===chat,theirs=e.actor===chat&&e.data?.listener==='player';if(!mine&&!theirs)continue;
    lines.push(`<div class="bubble-row ${mine?'mine':'theirs'}">${theirs?avatar(chat,'tiny'):''}<div class="bubble"><span class="bubble-meta">${timeLabel(e.minute)}</span>${paragraphs(String(displayText(t)).replace(/^[^\n]*\n/,'').replace(/^“|”$/g,''))}</div></div>`);}
  const typing=characterBusy&&characterPending?.person===chat;
  return lines.slice(-14).join('')+(typing?`<div class="bubble-row mine"><div class="bubble">${paragraphs(characterPending.text)}</div></div><div class="bubble-row theirs">${avatar(chat,'tiny')}<div class="bubble typing" aria-label="${esc(PEOPLE[chat].name)} is replying"><i></i><i></i><i></i></div></div>`:'')
    ||`<p class="meta dialogue-empty">Ask ${esc(PEOPLE[chat].name)} anything, in your own words, or pick a question below.</p>`;
}
function dialogueView(v){
  const p=PEOPLE[chat];
  return `<section class="dialogue" data-drop-person="${chat}" aria-label="Conversation with ${esc(p.name)}">
    <header class="dialogue-head"><div class="dlg-side theirs" data-drop-person="${chat}" title="Drop evidence here to show it">${artImage(ART.people[chat],'dlg-portrait')||avatar(chat,'large')}<span><strong>${esc(p.name)}</strong><small>${esc(p.role)}</small></span>${(()=>{const n=session.world.npcs[chat];return n?`<div class="dlg-meters">${meter('Trust in you',n.trust,'teal')}${meter('Stress',n.stress,'amber')}</div>`:'';})()}</div>
      <button class="icon-button close-small" data-do="close-chat" aria-label="End the conversation">×</button>
      <div class="dlg-side mine">${ART.detective?artImage(ART.detective,'detective-portrait'):'<span class="detective-badge" aria-hidden="true">D</span>'}<span><strong>You</strong><small>the detective</small></span></div></header>
    <div class="journal dialogue-feed" id="journal" role="log" aria-live="polite" aria-label="Conversation">${dialogueLines(v)}</div>
    </section>`;
}

// The middle panel shows this place only: everything since the latest arrival (earlier places are in the history).
// With nothing happening here yet, say what the player can do.
function nextSteps(v){const locked=new Set(session.world.flags.lockedObjects||[]),have=new Set(v.evidence.map(e=>e.clue));
  const toSee=(v.scene.objects||[]).filter(o=>OBJECTS[o]&&!locked.has(o)&&!have.has(OBJECTS[o].clue)).length;
  const items=[toSee?`<li><b>Look around</b> (left): ${toSee} thing${toSee===1?'':'s'} here you have not examined.</li>`:'',
    v.people.length?`<li><b>Talk</b> (right) to ${v.people.map(p=>esc(p.name)).join(', ')}.</li>`:'',
    `<li><b>Walk</b> somewhere else on the map; a <b>!</b> marks a place a lead points to.</li>`,
    `<li>Stuck? The <b>Hints</b> tab has a nudge.</li>`].filter(Boolean).join('');
  return `<div class="next-steps"><h3>What now?</h3><ul>${items}</ul></div>`;}
function sinceArrival(entries){let i=entries.length-1;while(i>0&&!['arrival','movement'].includes(entries[i].kind))i--;
  // the scene description and the Talk panel already show the place and who is here
  const here=new RegExp(`^(${Object.values(PEOPLE).map(p=>p.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')}) (is|are) here\\.?$`);
  return entries.slice(Math.max(0,i)).filter(e=>!['arrival','movement'].includes(e.kind)&&!here.test(String(e.text).trim())).slice(-12);}
function journalEntry(e){const voiced=realized.has(e.id);const tip=voiced?` title="Written line: ${esc(authoredLineOnly(e))}"`:'';return `<article class="journal-entry ${e.kind==='speech'?'spoken':''} ${e.kind==='evidence'?'clue-found':''} ${e.kind==='arrival'?'scene-entry':''}"><div class="journal-meta"><span>${timeLabel(e.minute)}</span><span>${e.kind==='arrival'?'SCENE CHANGE':e.kind==='speech'?esc(actorName(e.actor)):e.speaker&&PEOPLE[e.speaker]?esc(actorName(e.speaker)):esc(typeNames[e.kind]??'Observation')}${voiced?(dialogueAudit.get(e.id)?.status==='accepted'?' · AI delivery':' · Written fallback'):''}</span></div>${e.kind==='evidence'?evidenceBody(e):`<div class="journal-prose"${tip}>${paragraphs(displayText(e))}</div>`}</article>`;}
// A discovery in the chat: the clue's picture beside its title and text.
function evidenceBody(e){const ev=session.events.find(x=>x.id===e.id),clue=ev?.data?.clue,[title,...rest]=String(displayText(e)).split('\n');
  return `<div class="journal-prose clue-body">${clue?artifactArt(clue,'clue-found-art'):''}<div><strong class="clue-found-title">${esc(title)}</strong>${paragraphs(rest.join('\n').trim())}</div></div>`;}
function historyModal(){const entries=playerView(session).transcript,pages=Math.max(1,Math.ceil(entries.length/20));historyPage=Math.max(0,Math.min(historyPage,pages-1));openModal(`<h2>Investigation history</h2><p class="meta">Oldest to newest · page ${historyPage+1} of ${pages}. Your complete observed history is preserved.</p><div class="two-actions"><button class="soft-button" data-do="history-older" ${historyPage===0?'disabled':''}>← Older</button><button class="soft-button" data-do="history-newer" ${historyPage===pages-1?'disabled':''}>Newer →</button></div>${entries.slice(historyPage*20,(historyPage+1)*20).map(journalEntry).join('')}`,'Investigation history');$('#modal').scrollTop=0;}
// Derive completion from successful commands so existing saves and typed commands count.
function actionDone(action){
  return session.events.some(e=>{
    const d=e.kind==='command'?e.data:null;
    const a=d?(d.action?.type==='converse'?d.origin:d.action):null;
    if(!a||a.type!==action.type)return false;
    const matches=action.type==='inspect'?a.object===action.object:
      action.type==='ask'?a.person===action.person&&(a.topic||'night')===action.topic:
      action.type==='present'?a.person===action.person&&a.clue===action.clue&&(a.tone||'private')===action.tone:false;
    return matches&&!session.events.some(result=>result.kind==='rejected'&&result.parents.includes(e.id));
  });
}
function doneLabel(done){return done?'<small class="done-label">✓ Done · repeat anytime</small>':'';}
function presentButton(person,tone,label){const done=actionDone({type:'present',person,clue:chosenClue,tone});return `<button class="soft-button ${tone==='press'?'danger-soft':''} ${done?'action-done':''}" data-do="present" data-person="${person}" data-tone="${tone}" title="${done?'Already shown; you can show it again':''}"><span>${CASE.kernel&&label==='Present & discuss'?'Show':label}${done?' ✓':''}</span></button>`;}

// In-room progressive disclosure. Objects that are still gated (locked) are HIDDEN until their
// prerequisites are found — inspecting a lead reveals the next (the engine fires "A further lead opens
// up"). The reachable objects are grouped into sections by the kind of evidence they yield, so a room is
// a set of areas to work rather than one flat rack of cards.
function roomInspect(v){
 const locked=new Set(session.world.flags.lockedObjects||[]);
 const all=(v.scene.objects||[]).filter(id=>OBJECTS[id]);
 const visible=all.filter(id=>!locked.has(id));
 const hiddenLeads=all.length-visible.length;
 const head=`<div class="panel-heading"><span class="meta">Choose something to examine · 3 min each</span></div>`;
 const hint=hiddenLeads?`<p class="room-hint meta">Some things here only come to light once you examine what is in plain sight.</p>`:'';
 if(!visible.length)return `${head}<div class="object-actions"><p class="meta">${hiddenLeads?'Nothing is within reach yet — follow a lead elsewhere, then return.':'Nothing to inspect here. Talk to someone nearby or choose another place in the village.'}</p></div>${hint}`;
 const card=id=>{const done=actionDone({type:'inspect',object:id});return `<button class="object-button ${done?'action-done':''}" data-do="inspect" data-id="${id}" draggable="true" data-drag-object="${id}">${artifactArt(OBJECTS[id].clue)}<span>${esc(OBJECTS[id].label)}</span><small>${esc(OBJECTS[id].description)}</small>${doneLabel(done)}</button>`;};
 const sections=new Map();
 for(const id of visible){const kind=CLUES[OBJECTS[id]?.clue]?.kind||'Around the room';(sections.get(kind)||sections.set(kind,[]).get(kind)).push(id);}
 if(sections.size<=1)return `${head}<div class="object-actions">${visible.map(card).join('')}</div>${hint}`;
 const html=[...sections].map(([label,ids])=>`<section class="room-section"><h3 class="room-section-head">${esc(label)} <span class="room-section-count">${ids.length}</span></h3><div class="object-actions">${ids.map(card).join('')}</div></section>`).join('');
 return `${head}${html}${hint}`;
}
function gameActions(v){return `<nav class="small-tabs action-tabs" aria-label="Action groups">${[['inspect','Inspect'],['talk',`Talk (${v.people.length})`],['wait','Wait']].map(([id,label])=>`<button data-do="action-group" data-id="${id}" class="${actionGroup===id?'active':''}" aria-pressed="${actionGroup===id}">${label}</button>`).join('')}</nav>${actionGroup==='talk'?(chat?conversation(v):`<p class="meta">Choose someone here to see what you can ask.</p><div class="people-here">${v.people.map(p=>`<button class="person-row present-person" data-do="chat" data-id="${p.id}">${avatar(p.id)}<span><strong>${p.name}</strong><small>View conversation options →</small></span></button>`).join('')||'<p class="muted">No one is here. Travel or wait for someone to arrive.</p>'}</div>`):actionGroup==='wait'?`<p class="meta">Let the village carry on. People may arrive or leave.</p><div class="two-actions">${[5,10,30].map(n=>`<button class="soft-button" data-do="wait" data-minutes="${n}">Wait ${n} min</button>`).join('')}</div>`:roomInspect(v)}`;}
const dialogueTopics={bell:[['case','What makes a convincing case?'],['night','Can you give me a lead?'],['sightings','What have you observed around town today?']],clara:[['alibi','Where were you last night?'],['accounts','What can you tell me about Edmund’s accounts?'],['sightings','What have you observed around town today?']],rowan:[['night','Tell me about the coat and your whereabouts.'],['sightings','What have you observed around town today?']],silas:[['alibi','Where were you last night?'],['accounts','Explain the account discrepancies.'],['sightings','What have you observed around town today?']],ada:[['night','What did you see last night?'],['sightings','What have you observed around town today?']],iris:[['night','What do the medical findings and your visit establish?'],['sightings','What have you observed around town today?']]};

function topicsFor(id){if(CASE.topics)return CASE.topicsFor?.[id]??CASE.topics;return session.world.caseId?[['night','What is your account of last night?'],['accounts','What can you tell me about the estate dispute?'],['sightings','What have you observed today?']]:dialogueTopics[id];}
function conversation(v){const p=PEOPLE[chat];if(!v.evidence.some(e=>e.clue===chosenClue))chosenClue=v.evidence[0]?.clue??null;
  // free text always comes first; the questions are shortcuts beside it
  return `<div class="dlg-choices"><div class="dialogue-options chips" aria-label="Suggested questions">${[...topicsFor(chat),...followupOptions(session,chat)].map(([topic,label])=>{const done=actionDone({type:'ask',person:chat,topic});return `<button class="text-action chip ${done?'action-done':''}" data-do="ask" data-person="${chat}" data-topic="${topic}"${characterBusy?' disabled aria-disabled="true"':''}><span>${label}${doneLabel(done)}</span><span>3 min</span></button>`;}).join('')}</div>${v.evidence.length&&CASE.kernel?`<p class="drag-hint">To show ${esc(p.address??p.name)} something, drag a card from “Evidence” or an object from “Look around” onto the conversation.</p>`:v.evidence.length?`<div class="present-controls"><label for="present-clue">Show evidence · 4 min <small class="meta">or drag a card from “Evidence” onto a face</small></label><select id="present-clue">${v.evidence.map(e=>`<option value="${e.clue}" ${e.clue===chosenClue?'selected':''}>${e.title}</option>`).join('')}</select>${chat==='clara'&&['letter','record'].includes(chosenClue)?`<div class="two-actions">${presentButton('clara','private','Offer discretion')}${presentButton('clara','press','Threaten exposure')}</div>`:`${presentButton(chat,'private','Present & discuss')}`}</div>`:'<p class="meta">Discover evidence to present it in conversation.</p>'}</div>`;}

const humanLabel=v=>LOCATIONS[v]?.name??PEOPLE[v]?.name??String(v).replaceAll('_',' ');
// The board's night: the case's own span (generated cases) or the Last Bell's authored one.
const nightSpan=()=>CASE.night??[1255,1290];
const PILLAR_ABBR={motive:'Mot',means:'Mns',opportunity:'Opp'};
const clip=(t,n)=>{t=String(t);return t.length>n?t.slice(0,n-1)+'…':t;};
function notesFor(id){return boardNotes[id]||(boardNotes[id]={});}
// Objective, fair aid: factual clashes in the record (does NOT judge guilt).
function objectiveConflicts(id,claims){const rels=claimRelations(claims).filter(r=>r.kind==='conflicts'&&(r.left.subject===id||r.right.subject===id));if(!rels.length)return '';return rels.map(r=>`<p>“${esc(CLUES[r.left.clue]?.title??r.left.attribution)}” vs “${esc(CLUES[r.right.clue]?.title??r.right.attribution)}” — ${esc(humanLabel(r.left.value))} vs ${esc(humanLabel(r.right.value))}.</p>`).join('');}
function suspectStripCard(id,selected){
  const notes=boardNotes[id]||{},acq=new Set(session.world.player.evidence.map(e=>e.clue));
  const placed=Object.keys(notes).filter(c=>acq.has(c));
  const sup=placed.filter(c=>notes[c].polarity==='supports').length,con=placed.length-sup;
  const filled=new Set(placed.map(c=>notes[c].pillar));
  const chips=BOARD_PILLARS.map(([k])=>`<span class="pstat ${filled.has(k)?'s-filled':'s-open'}">${PILLAR_ABBR[k]}</span>`).join('');
  return `<button class="suspect-card ${selected===id?'selected':''}" data-do="reason-suspect" data-id="${id}">${artImage(ART.people[id],'suspect-face')}<span class="suspect-id">${avatar(id,'tiny')}<strong>${PEOPLE[id].name}</strong></span><small>${PEOPLE[id].role}</small><span class="pstat-row">${chips}</span><span class="tally">${placed.length?`<b class="sup">${sup} support</b> · <b class="con">${con} contradict</b>`:'<span class="meta">no cards pinned</span>'}</span></button>`;
}
// Distinct whereabouts for the timeline: collapse identical location+interval
// claims (a spoken alibi and its recorded copy are the same bar), preferring
// the current account over a superseded one.
function placementsFor(id,claims){
  const seen=new Set();
  return claims.filter(c=>c.subject===id&&c.predicate==='location'&&c.interval)
    .slice().sort((a,b)=>Number(a.superseded)-Number(b.superseded))
    .filter(c=>{const k=`${c.value}:${c.interval.start}:${c.interval.end}`;if(seen.has(k))return false;seen.add(k);return true;});
}
function suspectTimeline(id,claims,x0,w,y0,h){
  const [NIGHT_START,NIGHT_END]=nightSpan(),span=NIGHT_END-NIGHT_START,px=t=>x0+((Math.max(NIGHT_START,Math.min(NIGHT_END,t))-NIGHT_START)/span)*w;
  const death=claims.find(c=>c.predicate==='death_time'&&c.interval&&!c.superseded)?.interval??null;
  const places=placementsFor(id,claims);
  const trackH=Math.max(42,24+places.length*22+8);
  const step=span>90?30:span>45?15:10,first=Math.ceil(NIGHT_START/step)*step,ticks=Array.from({length:Math.floor((NIGHT_END-first)/step)+1},(_,i)=>first+i*step).map(t=>`<span class="tl-tick" style="left:${px(t)-x0}px">${timeLabel(t)}</span>`).join('');
  const band=death?`<div class="tl-death" style="left:${px(death.start)-x0}px;width:${Math.max(4,px(death.end)-px(death.start))}px"></div>`:'';
  const bars=places.map((c,i)=>{const left=px(c.interval.start)-x0,wd=Math.max(10,px(c.interval.end)-px(c.interval.start)),scene=c.value===(CASE.scene??'manor'),label=`${humanLabel(c.value)} · ${timeLabel(c.interval.start)}–${timeLabel(c.interval.end)}`;return `<div class="tl-bar ${scene?'scene':'away'}${c.superseded?' sup':''}${wd<52?' point':''}" style="left:${left}px;width:${wd}px;top:${24+i*22}px" title="${esc(label)}">${wd<52?'':esc(humanLabel(c.value))}</div>`;}).join('')||'<span class="tl-none">No recorded whereabouts yet.</span>';
  return `<div class="board-timeline" style="left:${x0}px;top:${y0}px;width:${w}px;height:${h}px"><div class="tl-head">The night · ${death?'death window highlighted in red':'medical window not yet established'}</div><div class="tl-track" style="height:${trackH}px">${band}${bars}</div><div class="tl-axis">${ticks}</div></div>`;
}
function workspaceView(id,claims){
  const notes=boardNotes[id]||{},ev=session.world.player.evidence,acq=[...new Set(ev.map(e=>e.clue))];
  const keys=new Set(BOARD_PILLARS.map(([k])=>k)),pillarOf=c=>keys.has(notes[c].pillar)?notes[c].pillar:'opportunity';
  const placed=acq.filter(c=>notes[c]),unplaced=acq.filter(c=>!notes[c]);
  const padX=30,colW=248,verdW=300,verdH=80,pillarH=54,cardW=214,cardH=134,gap=16,cardTop=252;
  const boardW=padX*2+BOARD_PILLARS.length*colW,colCenter=i=>padX+i*colW+colW/2,verdCX=boardW/2,verdBottom=18+verdH;
  const byPillar=Object.fromEntries(BOARD_PILLARS.map(([k])=>[k,placed.filter(c=>pillarOf(c)===k)]));
  const maxCards=Math.max(1,...BOARD_PILLARS.map(([k])=>byPillar[k].length||1));
  const nPlace=placementsFor(id,claims).length;
  const timelineTop=cardTop+maxCards*(cardH+gap)+18,timelineH=Math.max(42,24+nPlace*22+8)+58,boardH=timelineTop+timelineH+26;
  // established = the same check Bell uses, on the evidence the player holds (never on anything unfound)
  const held=caseTables(session).behavior?.pillarsHeld?.(session,id)??null;
  let paths='',chips='';const cluePos={};
  const pillarNodes=BOARD_PILLARS.map(([k,label],i)=>{const cx=colCenter(i),n=byPillar[k].length,col=n?'#c8b48c':'#6a5a3f';paths+=`<path class="edge2" stroke="${col}" d="M${cx} 150 Q${(cx+verdCX)/2} ${(150+verdBottom)/2-8} ${verdCX} ${verdBottom}"/>`;const ok=held?.[k];return `<div class="pillar-node s-${n?'filled':'open'}${ok?' s-established':''}" style="left:${cx-90}px;top:150px" data-drop-pillar="${k}" data-suspect="${id}" title="${ok?`Your evidence establishes ${label.toLowerCase()} for ${esc(PEOPLE[id].name)}`:`Your evidence does not yet establish ${label.toLowerCase()}`}">${ok?'<b class="est-mark" aria-label="established">✓</b> ':''}${label}<span>${n?`${n} card${n===1?'':'s'}`:'drop evidence here'}</span></div>`;}).join('');
  const cardsHtml=BOARD_PILLARS.map(([k],i)=>{const cx=colCenter(i),list=byPillar[k];if(!list.length)return `<div class="board-empty" style="left:${cx-cardW/2}px;top:${cardTop}px;width:${cardW}px">Place evidence here from the tray below.</div>`;return list.map((c,r)=>{const pol=notes[c].polarity,x=cx-cardW/2,y=cardTop+r*(cardH+gap);cluePos[c]={cx,cy:y+cardH/2};paths+=`<path class="edge2 e-${pol}" d="M${cx} ${y} L${cx} ${150+pillarH}"/>`;const src=ev.find(z=>z.clue===c);return `<article class="board-card e-${pol}" style="left:${x}px;top:${y}px;width:${cardW}px;min-height:${cardH}px"><span class="pin p-${pol}"></span><strong>${esc(CLUES[c].title)}</strong><p>${esc(clip(src?.text??CLUES[c].text,88))}</p><div class="card-controls"><button class="mini pol-${pol}" data-do="board-flip" data-suspect="${id}" data-clue="${c}">${pol==='supports'?'Supports':'Contradicts'} ⇄</button>${src?`<button class="mini" data-do="claim-source" data-id="${src.eventId}" title="Read source">↗</button>`:''}<button class="mini danger" data-do="board-remove" data-suspect="${id}" data-clue="${c}" title="Return to tray">✕</button></div></article>`;}).join('');}).join('');
  for(const rl of claimRelations(claims).filter(r=>r.kind==='conflicts'&&(r.left.subject===id||r.right.subject===id))){const a=cluePos[rl.left.clue],b=cluePos[rl.right.clue];if(!a||!b||a===b)continue;const mx=(a.cx+b.cx)/2,my=(a.cy+b.cy)/2+18;paths+=`<path class="edge2 e-conflict-dyn" d="M${a.cx} ${a.cy} Q${mx} ${my} ${b.cx} ${b.cy}"/>`;chips+=`<span class="edge-chip chip-conflicts" style="left:${mx}px;top:${my}px">accounts conflict</span>`;}
  const sup=placed.filter(c=>notes[c].polarity==='supports').length,con=placed.length-sup;
  const canvas=`<div class="reason-canvas" style="width:${boardW}px;height:${boardH}px"><svg class="reason-edges" width="${boardW}" height="${boardH}" aria-hidden="true">${paths}</svg><div class="verdict-node" style="left:${(boardW-verdW)/2}px;top:18px;width:${verdW}px;min-height:${verdH}px"><strong>Your case against ${esc(PEOPLE[id].name)}</strong><span>Pinned ${placed.length}/${acq.length} clues — <b class="sup">${sup} support</b>, <b class="con">${con} contradict</b> (your call).</span><span class="verdict-meter">You decide what each clue means.</span></div>${pillarNodes}${cardsHtml}${chips}${suspectTimeline(id,claims,padX,boardW-2*padX,timelineTop,timelineH)}</div>`;
  const objConf=objectiveConflicts(id,claims);
  const tray=`<div class="evidence-tray"><h3>Evidence to place${unplaced.length?` · ${unplaced.length}`:''}</h3>${unplaced.length?`<div class="tray-cards">${unplaced.map(c=>`<div class="tray-card" draggable="true" data-drag-clue="${c}"><div class="tray-info"><strong>${esc(CLUES[c].title)}</strong><small>${esc(CLUES[c].kind)}</small></div><div class="tray-place">${BOARD_PILLARS.map(([k,label])=>`<button class="mini" data-do="board-place" data-suspect="${id}" data-clue="${c}" data-pillar="${k}" title="Place under ${label}">${PILLAR_ABBR[k]}</button>`).join('')}</div></div>`).join('')}</div>`:'<p class="meta">Every acquired clue is placed. Remove one to re-file it.</p>'}${objConf?`<div class="obj-conflicts"><h3>Contradictions in the accounts</h3><p class="meta">Objective clashes in the record — a reason to dig, not a verdict.</p>${objConf}</div>`:''}</div>`;
  return `<div class="workspace">${canvas}${tray}</div>`;
}
// The Clue Board: a player-built detective evidence board. You place each
// acquired clue under Motive / Means / Opportunity / Alibi and mark it supports
// or contradicts the case — the app never classifies for you. It only surfaces
// objective conflicts in the record and the night timeline. Reads only your
// evidence; the deduction is yours.
// A person's public profile on the Clue Board: who they are, their manner, where they usually are, when last seen,
// and (if met) trust and stress. Never secrets, lies or guilt.
function profileCard(id,compact=false){
  const p=PEOPLE[id],v=playerView(session),n=session.world.npcs[id],seen=v.lastSeen[id],here=v.people.some(x=>x.id===id),sh=p.sheet||{};
  const met=session.events.some(e=>e.kind==='speech'&&e.actor===id&&e.data?.listener==='player');
  return `<section class="profile-card ${compact?'compact':''}">${artImage(ART.people[id],'profile-art')||avatar(id,'large')}<div class="profile-body"><h2>${esc(p.name)}</h2><p class="meta">${esc(p.role)}</p><p>${esc(p.public??'')}</p>
    ${sh.temperament&&!compact?`<p class="profile-manner"><b>Manner:</b> ${esc(sh.temperament)}${sh.pet_subject?` · talks about ${esc(sh.pet_subject)}`:''}</p>`:''}
    <p class="meta">${here?'● Here with you':CASE.kernel&&n?(n.travel?`On the way to ${esc(placeName(n.travel.to))}`:`Now at ${esc(placeName(n.location))}`):seen?`Last seen at ${esc(placeName(seen.location))}, ${timeLabel(seen.minute)}`:'Not yet met'}</p>
    ${met&&n?`<div class="profile-meters">${meter('Trust in you',n.trust,'teal')}${meter('Stress',n.stress,'amber')}</div>`:''}
    ${here&&v.status!=='solved'?`<button class="soft-button" data-do="talk-from-board" data-id="${id}">Talk to ${esc(p.address??p.name)} →</button>`:''}</div></section>`;
}
// The whole investigation so far, oldest first: every conversation and discovery in one place.
function historySection(){const all=playerView(session).transcript;if(!all.length)return '';
  return `<details class="board-history" data-open-key="board-history"><summary>The investigation so far <span class="meta">${all.length} entries · oldest first</span></summary><div class="board-history-list">${all.map(journalEntry).join('')}</div></details>`;}
function victimChip(){const id=CASE.victimId;return `<span class="cast-chip victim" title="${esc(CASE.victimPublic??'')}">${artImage(ART.people[id],'chip-art')}<span>${esc(CASE.victim??'Edmund Vale')} · deceased</span></span>`;}
function reasoning(){
  const claims=playerClaims(session);
  const suspects=caseTables(session).SUSPECTS??SUSPECTS,others=Object.keys(PEOPLE).filter(id=>!suspects.includes(id));
  const strip=suspects.map(id=>suspectStripCard(id,reasonSuspect)).join('');
  const castStrip=`<div class="cast-strip"><span class="eyebrow">ALSO IN THE VILLAGE</span>${victimChip()}${others.map(id=>`<button class="cast-chip ${reasonSuspect===id?'selected':''}" data-do="reason-suspect" data-id="${id}">${avatar(id,'tiny')}<span>${esc(PEOPLE[id].name)}</span></button>`).join('')}</div>`;
  const body=!session.world.player.evidence.length&&!reasonSuspect?`<div class="reason-empty2"><h2>The board is bare</h2><p>Question the village and inspect records. As you gather evidence, place it here and build your own case for or against each suspect.</p></div>`:reasonSuspect&&!suspects.includes(reasonSuspect)?profileCard(reasonSuspect):reasonSuspect?profileCard(reasonSuspect,true)+workspaceView(reasonSuspect,claims):`<div class="reason-empty2"><h2>Pick a suspect</h2><p>Choose someone above, then drag each clue you’ve gathered onto Motive, Means or Opportunity (or use the small buttons) and mark whether it supports or contradicts the case. The board draws the conflicts between accounts; a ✓ appears when what you hold really establishes a pillar.</p></div>`;
  return `<main class="reason-board"><div class="reason-toolbar"><div><div class="eyebrow gold">THE EVIDENCE BOARD</div><h1>Clue Board</h1><p class="meta">Your board. Place clues and decide what each one means — <b class="sup">supports</b> or <b class="con">contradicts</b> the case. A ✓ shows when your evidence really establishes a pillar.</p></div><div class="reason-legend"><span class="legend-item"><i class="dot supports"></i>you marked supports</span><span class="legend-item"><i class="dot contradicts"></i>contradicts</span></div></div>${contradictionSpine(claims)}<div class="suspect-strip">${strip}</div>${castStrip}<div class="reason-scroll">${body}${historySection()}</div></main>`;
}

// The deduction spine: the current, unresolved contradictions among everything the player has learned
// (testimony vs the physical record, or two accounts). A lie surfaces here as a clash; resolving it
// (a revision that supersedes the false claim) removes it from the list — visible progress.
function contradictionSpine(claims){
  if(!session.world.player.evidence.length&&!claims.length)return '';
  const conflicts=claimRelations(claims).filter(r=>r.kind==='conflicts');
  const src=c=>c.sourceKind==='speech'?`${actorName(c.speaker)} says`:(CLUES[c.clue]?.title??esc(c.attribution));
  if(!conflicts.length)return `<div class="deduction-spine"><h3>Contradictions</h3><p class="meta">No unresolved conflicts among what you’ve gathered. Keep questioning — a lie shows up here as a clash between an account and the record.</p></div>`;
  return `<div class="deduction-spine has-conflicts"><h3>Contradictions to resolve <span class="conflict-count">${conflicts.length}</span></h3><p class="meta">Two things you’ve learned can’t both be true. Press the account, or find the fact that settles it.</p><ul class="conflict-list">${conflicts.map(r=>`<li><strong>${esc(PEOPLE[r.left.subject]?.name??r.left.subject)}</strong> — ${esc(src(r.left))}: “${esc(humanLabel(r.left.value))}” vs ${esc(src(r.right))}: “${esc(humanLabel(r.right.value))}”</li>`).join('')}</ul></div>`;
}

function notebookContent(v){
  if(notebook==='evidence'){
    if(!v.evidence.length)return `<div class="empty-notebook"><span class="empty-symbol">⌑</span><h3>A fresh page.</h3><p>What you discover and what people tell you will appear here.</p><p class="meta">${CASE.kernel?'Look around the village and question its people.':'Begin with the study at Vale Manor.'}</p></div>`;
    const kinds=[...new Set(v.evidence.map(e=>e.kind))];
    const tabs=['All',...kinds];
    const active=tabs.includes(evidenceKind)?evidenceKind:'All';
    const sortBar=`<div class="inv-sort" role="group" aria-label="Arrange evidence">${[['time','Newest first'],['type','By type']].map(([id,l])=>`<button class="${invSort===id?'active':''}" data-do="inv-sort" data-id="${id}" aria-pressed="${invSort===id}">${l}</button>`).join('')}</div>`;
    const subtabs=`<div class="sub-tabs" role="tablist" aria-label="Evidence types">${tabs.map(k=>`<button role="tab" aria-selected="${active===k}" class="${active===k?'active':''}" data-do="evkind" data-id="${esc(k)}">${esc(k)} <span>${k==='All'?v.evidence.length:v.evidence.filter(e=>e.kind===k).length}</span></button>`).join('')}</div>`;
    const shown=v.evidence.map((e,i)=>({...e,order:i})).filter(e=>active==='All'||e.kind===active);
    const newest=v.evidence.at(-1)?.clue;
    const mentions=e=>Object.entries(PEOPLE).filter(([id,p])=>id!==CLUES[e.clue]?.speaker&&[p.name,p.address].filter(Boolean).some(n=>String(e.text??'').includes(n))).map(([id])=>id);
    const where=e=>{const at=CLUES[e.clue]?.at??session.events.find(x=>x.id===e.eventId)?.location;return LOCATIONS[at]?.name??null;};
    const card=e=>`<article class="evidence-card ${v.pins.includes(e.clue)?'pinned':''} ${e.clue===newest?'newest':''}" draggable="true" data-drag-clue="${e.clue}"><button class="evidence-open" data-do="clue" data-id="${e.clue}">${artifactArt(e.clue)}<span class="eyebrow kind-label">${e.kind} · ${timeLabel(e.minute)}</span><strong>${e.title}</strong><small>${esc(e.source)}${where(e)?` · ${esc(where(e))}`:''}</small></button>${(()=>{const m=mentions(e);return m.length?`<span class="mention-row">${m.slice(0,4).map(id=>`<button class="mention" data-do="notebook-person" data-id="${id}" title="See ${esc(PEOPLE[id].name)}">${esc(PEOPLE[id].address??PEOPLE[id].name)}</button>`).join('')}</span>`:'';})()}${chat&&CASE.kernel&&v.status!=='solved'?`<button class="show-to" data-do="show-to" data-id="${e.clue}" aria-label="Show ${esc(e.title)} to ${esc(PEOPLE[chat].name)}">Show</button>`:''}<button class="pin-button ${v.pins.includes(e.clue)?'on':''}" data-do="pin" data-id="${e.clue}" aria-label="${v.pins.includes(e.clue)?'Unpin':'Pin'} ${e.title}" aria-pressed="${v.pins.includes(e.clue)}">${v.pins.includes(e.clue)?'◆':'◇'}</button></article>`;
    let cards;
    if(invSort==='time')cards=shown.slice().reverse().map(card).join('');
    else{const groups=new Map();for(const e of shown)(groups.get(e.kind)||groups.set(e.kind,[]).get(e.kind)).push(e);
      cards=[...groups].map(([k,list])=>`<section class="inv-group"><h3 class="inv-head">${esc(k)} <span>${list.length}</span></h3>${list.map(card).join('')}</section>`).join('');}
    return sortBar+subtabs+(cards||`<p class="empty-state">No ${esc(active.toLowerCase())} evidence recorded yet.</p>`)+'<p class="meta inv-tip">Drag a card (or something from Look around) onto the conversation or a face to show it.</p>';
  }
  if(notebook==='talk'){
    if(v.status==='solved')return '<p class="meta">The case is closed.</p>';
    const faces=v.people.length?`<div class="talk-faces" aria-label="People at this location">${v.people.map(p=>`<button class="talk-face ${chat===p.id?'selected':''}" data-do="chat" data-id="${p.id}" data-drop-person="${p.id}" title="Talk to ${esc(p.name)} · drop evidence to show it">${artImage(ART.people[p.id],'talk-face-art')||avatar(p.id,'large')}<span>${esc(p.name.replace(/^(Dr|The Reverend) /,'').split(' ')[0])}</span></button>`).join('')}</div>`:'<p class="muted">No one is here. Walk somewhere on the map, or wait.</p>';
    if(chat)return `<div class="talk-panel">${faces}<h3 class="talk-sub">Questions for ${esc(PEOPLE[chat].address??PEOPLE[chat].name)} <span class="meta">3 min each</span></h3><div class="talk-questions">${conversation(v)}</div><div class="talk-compose"><h3 class="talk-sub">In your own words</h3>${characterComposer()||'<p class="meta">Turn on AI characters (menu) to speak in your own words.</p>'}</div></div>`;
    return `<div class="talk-panel">${faces}${v.people.length?'<p class="meta">Choose someone to talk to.</p>':''}</div>`;
  }
  return hintsPanel();
}

function inspector(){const w=selectedWorld(),health=getHealth();return `<main class="inspector-shell">
  <div class="inspector-heading"><div><div class="eyebrow teal">SIMULATION INSPECTOR</div><h1>Behind the story</h1><p>Follow what happened, who knew, and why they acted.</p></div><div class="inspector-summary"><div><strong>${session.events.length}</strong><span>recorded events</span></div><div><strong>${Object.values(w.npcs).reduce((n,a)=>n+a.beliefs.length,0)}</strong><span>traced beliefs</span></div><button class="health-pill ${health.ok?'good':'bad'}" data-do="inspector-tab" data-id="checks">${health.ok?'✓ Replay verified':'! Check failed'}</button></div></div>
  <div class="inspector-nav"><nav class="wide-tabs" aria-label="Inspector views">${[['world','World'],['missed','Missed opportunities'],['timeline','Trace details'],['checks','Checks']].map(([id,label])=>`<button class="${inspectorTab===id?'active':''}" data-do="inspector-tab" data-id="${id}">${label}</button>`).join('')}</nav><span class="spoiler-label">Hidden case facts visible</span><button class="subtle-button export-trace" data-do="export">Export full trace ↗</button></div>
  <div class="inspector-workspace ${inspectorTab!=='timeline'?`alternate-view ${detailPanel?'with-detail':'without-detail'}`:'trace-view'}">${inspectorTab==='timeline'?`<aside class="event-list-panel"><div class="event-filters"><label class="sr-only" for="history-search">Search event history</label><input id="history-search" placeholder="Search the history…" value="${esc(query)}"><div class="filter-row"><label class="sr-only" for="actor-filter">Filter by person</label><select id="actor-filter"><option value="all">Everyone</option><option value="player" ${actorFilter==='player'?'selected':''}>You</option>${Object.entries(PEOPLE).map(([id,p])=>`<option value="${id}" ${actorFilter===id?'selected':''}>${p.name}</option>`).join('')}</select><label class="sr-only" for="type-filter">Filter by event type</label><select id="type-filter"><option value="all">All activity</option>${Object.entries(typeNames).filter(([id])=>!['clock','checkpoint','memory'].includes(id)).map(([id,n])=>`<option value="${id}" ${typeFilter===id?'selected':''}>${n}</option>`).join('')}</select></div><label class="clock-filter"><input type="checkbox" id="clock-filter" ${includeClock?'checked':''}> Include clock, memory & checkpoints</label></div><div id="event-list" class="event-list">${eventList()}</div></aside><section class="event-detail" id="event-detail">${eventDetail()}</section>`:inspectorTab==='world'?worldPanel(w):inspectorTab==='missed'?missedPanel(w):checksPanel(health)}${detailPanel&&inspectorTab!=='timeline'?`<aside class="character-panel" id="character-panel"><button class="subtle-button full" data-do="close-detail">Close details ×</button>${detailPanel==='event'?eventDetail():characterPanel(w)}</aside>`:''}</div>
  <div class="milestone-strip" id="milestones">${milestones()}</div>
  ${replayBar()}
</main>`;}

function filteredEvents(){return session.events.filter(e=>(includeClock||!['clock','memory','checkpoint'].includes(e.kind))&&(typeFilter==='all'||e.kind===typeFilter)&&(actorFilter==='all'||e.actor===actorFilter||e.data.listener===actorFilter)&&(query===''||`${e.title} ${actorName(e.actor)} ${e.data.reason??''} ${e.id}`.toLowerCase().includes(query.toLowerCase())));}
// The detective's arrival is the boundary: everything before it (the authored
// origin history + seeded beliefs, e.g. the culprit's own knowledge) is pre-game
// setup, not something the player witnessed.
function entryEventIndex(){const e=session.events.find(x=>x.kind==='arrival'&&x.data&&x.data.boundary);return e?e.index:0;}
// The executed crime arc (how the murder actually happened), read from the prehistory occurrences.
// Populated for every case — including generated ones — so a mystery's setup is legible in the
// inspector for diversity checking, not only for the hand-authored original.
function crimeArc(){const b=entryEventIndex();return session.events.filter(e=>e.index<b&&e.data&&e.data.occurrence&&e.title).map(e=>[timeLabel(e.minute),e.title]);}
// Forward projection: forecast what each character would do next from their current state, routines,
// goals and personality — by simulating the scripted life forward on a throwaway clone (no player, no
// mutation of the real session). A prediction, not canonical history.
function projectForward(minutes=90,step=15){
  let clone;try{clone=copy(session);}catch{return [];}
  if(clone.world.status==='solved')return [];
  const start=clone.events.length;
  try{for(let t=0;t<minutes;t+=step)dispatch(clone,{type:'wait',minutes:step});}catch{}
  const raw=clone.events.slice(start).filter(e=>PEOPLE[e.actor]&&e.title&&['decision','movement','arrival','speech'].includes(e.kind)&&!/^World Director|Plan step|invariant|completed/i.test(e.title));
  const out=[];for(const e of raw){const last=out[out.length-1];if(last&&last.actor===e.actor&&last.title===e.title)continue;out.push({minute:e.minute,actor:e.actor,title:e.title});}
  return out.slice(0,16);
}
function eventRow(e){return `<button class="event-row ${selectedIndex()===e.index?'selected':''} ${e.index>selectedIndex()?'future':''} ${e.index<entryEventIndex()?'pregame':''}" data-do="event" data-index="${e.index}"><span class="event-dot kind-${e.kind}">${glyphs[e.kind]??'·'}</span><span class="event-row-copy"><span class="event-row-meta"><time>${timeLabel(e.minute)}</time></span><strong>${esc(e.title)}</strong><small>${typeNames[e.kind]}${e.playerText?' · observed':''}</small></span></button>`;}
function eventList(){
  const events=filteredEvents(),entry=entryEventIndex();
  const post=events.filter(e=>e.index>=entry).reverse(), pre=events.filter(e=>e.index<entry).reverse();
  const divider=`<div class="event-list-divider" role="separator"><span class="gold-line">▲ &nbsp;The investigation · the detective is present</span><span>▼ &nbsp;Before you arrived · authored case setup (hidden truth &amp; seeded beliefs)</span></div>`;
  let body;
  if(post.length&&pre.length)body=post.map(eventRow).join('')+divider+pre.map(eventRow).join('');
  else if(pre.length)body=`<div class="event-list-divider solo" role="separator"><span>Before you arrived · authored case setup</span></div>`+pre.map(eventRow).join('');
  else body=post.map(eventRow).join('');
  return `<div class="event-list-label"><span>${events.length} events</span><span>Newest first</span></div>${body||'<p class="empty-state">No events match these filters.</p>'}`;
}
function compact(value){if(value===null||value===undefined)return '—';if(typeof value==='boolean')return value?'Yes':'No';if(typeof value==='number')return Number.isInteger(value)?String(value):value.toFixed(2);if(typeof value==='string')return value;if(Array.isArray(value)){if(value.length===0)return 'Empty';if(value[0]?.key)return value.map(x=>x.text).join(' • ');if(value[0]?.clue)return value.map(x=>CLUES[x.clue]?.title??x.clue).join(', ');return value.map(x=>typeof x==='object'?JSON.stringify(x):x).join(', ');}return JSON.stringify(value);}
function pathLabel(path){const parts=path.split('.');if(parts[0]==='npcs')return `${PEOPLE[parts[1]]?.name??parts[1]} / ${parts.slice(2).join(' / ')}`;return path.replaceAll('.',' / ');}
function eventLink(e,label){return e?`<button class="event-link" data-do="event" data-index="${e.index}">${esc(label??e.title)} <b>↗</b></button>`:'';}

function eventDetail(){const e=session.events[selectedIndex()];if(!e)return '<p>Select an event.</p>';const children=session.events.filter(x=>x.parents.includes(e.id)&&!['clock','checkpoint','memory'].includes(x.kind));const candidates=e.data.candidates;
  return `<div class="detail-kicker"><span class="type-badge kind-${e.kind}">${glyphs[e.kind]??'·'} &nbsp; ${typeNames[e.kind]??e.kind}</span><span class="meta">${timeLabel(e.minute)}</span></div><h2>${esc(e.title)}</h2><div class="event-context"><button class="actor-chip" data-do="person" data-id="${PEOPLE[e.actor]?e.actor:person}">${PEOPLE[e.actor]?avatar(e.actor,'tiny'):''}${esc(actorName(e.actor))}</button><span>${esc(placeName(e.location))}</span><span class="visibility-badge">${e.playerText?'Player observed':'Internal / offstage'}</span></div>${e.index<entryEventIndex()?'<p class="pre-game-note">Before the detective arrived — case prehistory (executed events in the alternate configurations; authored setup in the original), not something you witnessed.</p>':''}
  ${e.playerText?`<blockquote class="event-quote">${paragraphs(e.playerText)}</blockquote>`:''}
  ${e.data.reason||e.data.intent?`<section class="detail-section"><h3>${e.data.intent?'Communicative intent':'Recorded reason'}</h3><p>${esc(e.data.intent??e.data.reason)}</p>${e.data.basis?`<p class="meta">Belief used: ${esc(e.data.basis)}</p>`:''}${e.data.deception?`<span class="warning-label">${esc(e.data.deception)}</span>`:''}</section>`:''}
  ${e.data.assertion?`<section class="detail-section"><h3>Assertion</h3><p>${esc(e.data.assertion)}</p><span class="meta">Addressed to ${esc(actorName(e.data.listener))}. An assertion is not automatically a fact.</span></section>`:''}
  ${e.data.claims?.length?`<section class="detail-section"><h3>Structured assertions</h3><pre>${esc(JSON.stringify(e.data.claims,null,2))}</pre></section>`:''}
  ${e.data.belief?`<section class="detail-section"><h3>Belief acquired</h3>${beliefCard(e.data.belief)}</section>`:''}
  ${candidates?`<section class="detail-section"><h3>Alternatives considered</h3><p class="meta">Scores are recorded policy values, not reconstructed explanations.</p><div class="candidate-list">${candidates.map(c=>`<article class="candidate ${c.id===e.data.selected?'chosen':''}"><div><strong>${esc(c.label)}</strong><span>${c.score}</span></div><div class="score-track"><span style="width:${c.score}%"></span></div><p>${c.reasons.map(esc).join(' ')}</p>${c.id===e.data.selected?'<span class="chosen-label">✓ Chosen</span>':''}</article>`).join('')}</div></section>`:''}
  ${e.changes.length?`<section class="detail-section"><div class="panel-heading"><h3>What changed</h3><span class="meta">${e.changes.length} ${e.changes.length===1?'field':'fields'}</span></div><div class="changes">${e.changes.map(p=>`<div class="change"><strong>${esc(pathLabel(p.path))}</strong><div class="before-after"><span class="before"><small>BEFORE</small>${esc(compact(p.before))}</span><span class="after"><small>AFTER</small>${esc(compact(p.after))}</span></div></div>`).join('')}</div></section>`:`<p class="no-mutation">This event records context or intent without changing a world field.</p>`}
  <section class="detail-section causal-section"><h3>Follow the causes</h3>${e.parents.length?e.parents.map(id=>eventLink(eventById(id))).join(''):'<p class="meta">This is an initial case event.</p>'}</section>
  ${children.length?`<section class="detail-section causal-section"><h3>What followed from this</h3>${children.slice(0,12).map(child=>eventLink(child)).join('')}${children.length>12?`<p class="meta">${children.length-12} additional events in the full trace.</p>`:''}</section>`:''}
  ${dialogueAudit.has(e.id)?`<section class="detail-section"><h3>Dialogue audit</h3><p>${esc(dialogueAudit.get(e.id).text)}</p><span class="meta">${esc(dialogueAudit.get(e.id).status)} · ${esc(dialogueAudit.get(e.id).reason??dialogueAudit.get(e.id).variant)}</span><details><summary>Request and response</summary><pre>${esc(JSON.stringify(dialogueAudit.get(e.id),null,2))}</pre></details></section>`:''}
  ${e.data.autonomy?`<section class="detail-section"><h3>Autonomous life decision</h3><p>${esc(e.data.autonomy.status)} · ${esc(e.data.autonomy.reason??'Validated goal selection')}</p><details><summary>Perspective and model audit</summary><pre>${esc(JSON.stringify(e.data.autonomy,null,2))}</pre></details></section>`:''}${e.data.characterAudit?`<section class="detail-section"><h3>Character turn audit</h3><p>${esc(e.data.characterAudit.status)} · ${esc(e.data.characterAudit.reason)}</p><details><summary>Perspective, proposal and validation</summary><pre>${esc(JSON.stringify(e.data.characterAudit,null,2))}</pre></details></section>`:''}${directorDetail(e)}<details class="raw-event"><summary>Inspect structured event</summary><pre>${esc(JSON.stringify(e,null,2))}</pre></details>`;
}

function beliefCard(b){return `<article class="belief-card"><div><span class="truth-badge ${b.truth===true?'true':b.truth===false?'false':'unknown'}">${b.truth===true?'Matches case truth':b.truth===false?'Mistaken belief':'Not established'}</span><span class="meta">${Math.round(b.confidence*100)}% confidence</span></div><p>${esc(b.text)}</p><small>${esc(b.sourceType)} · acquired ${timeLabel(b.acquired)}</small>${eventLink(eventById(b.sourceId),'View the source event')}</article>`;}
// Memories tab = the episodic sensory log (what they SAW and HEARD): movement
// sightings + conversations. Belief-updates live under Beliefs (current state),
// so they're excluded here to avoid duplicating that tab.
function sensoryMemories(a){return a.memories.map(id=>eventById(id)).filter(e=>e&&(e.kind==='observation'||e.kind==='speech'));}
function memoryCard(id){
  const e=eventById(id);if(!e)return '';
  let content=e.data.belief?.text??e.data.assertion;
  if(!content&&e.kind==='observation'&&e.data.subject){
    const who=e.data.subject==='player'?'the detective':(PEOPLE[e.data.subject]?.name??e.data.subject);
    content=`Saw ${who} ${e.data.phase==='departure'?'leave':'arrive at'} ${LOCATIONS[e.data.observedLocation]?.short?.toLowerCase()??e.data.observedLocation}.`;
  }
  return `<article class="personal-event memory-card"><span class="meta">${timeLabel(e.minute)} · ${esc(placeName(e.location))} · ${esc(typeNames[e.kind]??e.kind)}</span>${eventLink(e)}${content?`<p>${esc(content)}</p>`:''}</article>`;
}
function directorDetail(e){
  const d=e.data.director,r=e.data.directorResult;if(!d&&!r)return '';
  const value=d??r;
  return `<section class="detail-section"><h3>World Director</h3><p>${esc(value.status)} · ${esc(value.reason??'Z3 verified the recorded constraints')}</p>${d?`<ol>${d.plan.steps.map(step=>`<li>${esc(step.kind)} · ${esc(step.to??step.object??step.recipient)}</li>`).join('')}</ol><p class="meta">${esc(d.mode)} · ${d.query?.horizon??120}-minute plan horizon. Future recipient presence is conditional.</p>`:''}${r?.viability?`<p>Investigation route: ${esc(r.viability.status)} · ${esc(r.viability.route??'unresolved')} · engine-replayed witness</p>`:''}<details><summary>Constraints, sources and validation record</summary><pre>${esc(JSON.stringify(value,null,2))}</pre></details></section>`;
}
function directorModal(){openModal(`<div class="eyebrow teal">WORLD DIRECTOR</div><h2>Symbolic plan checks</h2><p>Mystery plans and ordinary NPC activities use shared short-plan constraints. Local checks always run. Enable Z3 to verify their constraints before a turn commits, independently of AI.</p><p>Run <code>.venv/bin/python server/director_server.py</code> after installing <code>server/requirements-solver.txt</code>. The local solver listens on port 8788.</p><button class="primary full" data-do="toggle-director">${directorEnabled()?'Disable Z3 turn checks':'Enable Z3 turn checks'}</button><p class="meta">${directorEnabled()?'Z3 checks enabled. Unavailable or unresolved required checks defer the turn.':'Scripted play works without a solver service.'} Concealment turns also require an engine-replayed investigation route. This uses bounded acquisition search and actual engine replay; it does not cover every possible future. Inspect decision events for plans and results.</p>`,'World Director settings');}
function lifePanel(w,id){
 const l=w.npcs[id].life;if(!l)return '';
 const appointments=Object.values(w.flags.lifeRequests??{}).filter(r=>r.people.includes(id));
 return `<div class="profile-section"><h3>Daily life</h3>${meter('Energy',Math.max(0,l.energy-Math.floor((w.minute-l.energyAt)/4))/100,'teal')}<p>${esc(l.active?`${l.active.task}${l.active.paused?' · paused for conversation':''}`:'Between activities')}</p><ul>${l.goals.map(g=>`<li>${esc(g.label)}</li>`).join('')}</ul><h3>Commitments</h3>${appointments.map(r=>`<p>${esc(r.label)} · ${esc(r.status)}${r.start?` · ${timeLabel(r.start)}–${timeLabel(r.end)}`:''}${eventLink(eventById(r.completedSource??r.acceptedSource??r.source),'Source')}</p>`).join('')||'<p class="meta">No invitations or appointments yet.</p>'}<details><summary>Completed tasks and retry state</summary><pre>${esc(JSON.stringify({completed:l.completed,failures:l.failures},null,2))}</pre></details></div>`;
}
function characterPanel(w){const p=PEOPLE[person],a=w.npcs[person],idx=selectedIndex();return `<div class="character-top"><span class="eyebrow">CHARACTER INSPECTOR</span><label class="sr-only" for="character-select">Choose a character</label><select id="character-select">${Object.entries(PEOPLE).map(([id,p])=>`<option value="${id}" ${person===id?'selected':''}>${p.name}</option>`).join('')}</select></div><div class="profile-heading">${avatar(person,'large')}<h2>${p.name}</h2><p>${p.role}</p><span class="meta">${esc(a.travel?`${placeName(a.travel.from)} → ${placeName(a.travel.to)}`:placeName(a.location))}</span><span class="at-time">${cursor===null?'PRESENT':'PAST'} · ${timeLabel(w.minute)}</span></div>
  <div class="small-tabs profile-tabs" role="tablist" aria-label="Character views">${[['profile','Profile'],['beliefs',`Beliefs (${a.beliefs.length})`],['memories',`Memories (${sensoryMemories(a).length})`],['history','History']].map(([id,n])=>`<button class="${personTab===id?'active':''}" role="tab" aria-selected="${personTab===id}" data-do="person-tab" data-id="${id}">${n}</button>`).join('')}</div><div class="profile-content">${personTab==='beliefs'?a.beliefs.map(beliefCard).join(''):personTab==='memories'?`<p class="meta">What ${p.name.split(' ')[0]} has seen and heard — movement sightings and conversations, oldest to newest. Their current conclusions are under Beliefs. Sightings record who was seen here, without revealing a destination or intention.</p>${sensoryMemories(a).map(e=>memoryCard(e.id)).join('')||'<p class="meta">No sightings or conversations recorded yet.</p>'}`:personTab==='history'?`<p class="meta">Actions, perceptions, and updates involving ${p.name.split(' ')[0]}, through the selected moment.</p><button class="soft-button full" data-do="filter-person" data-id="${person}">Filter the full timeline</button>${session.events.filter(e=>e.index<=idx&&(e.actor===person||e.data.listener===person)&&!['memory','clock'].includes(e.kind)).slice(-25).reverse().map(e=>`<div class="personal-event"><span class="meta">${timeLabel(e.minute)} · ${typeNames[e.kind]}</span>${eventLink(e)}</div>`).join('')}`:`<p class="profile-bio">${p.public}</p>${lifePanel(w,person)}<details class="private-background" open><summary>Private background</summary><p>${p.secret}</p></details><div class="profile-section"><h3>Current intention</h3><p class="intention">${esc(a.intention)}</p>${eventLink(eventById(a.lastDecision),'See the decision')}</div><div class="profile-section"><h3>Current state</h3>${meter('Trust in you',a.trust,'teal')}${meter('Stress',a.stress,'amber')}</div><div class="profile-section"><h3>Competing goals</h3><ol class="goal-list">${p.goals.map(g=>`<li>${g}</li>`).join('')}</ol></div><div class="profile-section"><h3>Disposition</h3>${Object.entries(p.traits).map(([k,v])=>meter(k==='riskAversion'?'Risk aversion':k[0].toUpperCase()+k.slice(1),v,'muted-meter')).join('')}</div><div class="profile-section"><h3>Values</h3><div class="value-tags">${p.values.map(v=>`<span>${v}</span>`).join('')}</div></div><div class="profile-section"><h3>Relationships</h3>${Object.entries(p.relationships).filter(([id])=>id!=='player').map(([id,r])=>`<button class="relationship-row" data-do="person" data-id="${id}">${avatar(id,'tiny')}<span>${PEOPLE[id].name}</span><small>${Math.round(r.trust*100)}% trust</small></button>`).join('')}<p class="meta">These are initial ties. Trust in you changes through play.</p></div>`}</div>`;}
function meter(label,value,kind){return `<div class="meter ${kind}"><div><span>${label}</span><strong>${Math.round(value*100)}<small>/100</small></strong></div><div class="meter-track"><span style="width:${Math.max(0,Math.min(100,value*100))}%"></span></div></div>`;}

function cluePillar(clue,claims){const pick=preds=>{if(preds.includes('manner_evidence'))return 'Was it murder?';if(preds.some(p=>['crime_motive','motive_class'].includes(p)))return 'Motive';if(preds.some(p=>['crime_method','trace_match','method_class'].includes(p)))return 'Means';if(preds.includes('death_time'))return 'When';if(preds.some(p=>['exclusive_opportunity','clock_opportunity','location'].includes(p)))return 'Opportunity';return null;};let tag=pick((claims[clue]||[]).map(c=>c.predicate));if(!tag)for(const cs of Object.values(claims)){for(const c of cs)if((c.requires===clue||(c.requiresAny||[]).includes(clue))&&pick([c.predicate])){tag=pick([c.predicate]);break;}if(tag)break;}return tag||'Context';}
function casePanel(w){const ecl=caseTables(session).kernel?.model?.evidenceClaims||{};return `<div class="detail-section">${session.world.caseId?.startsWith('gen-')&&CASE.synopsis?`<p class="case-premise">${esc(CASE.synopsis)}</p>`:''}<h3>How the case can be proven</h3><p class="meta">Each card below is a <strong>complete, independent route</strong> to a supported accusation — you only need to finish <strong>one</strong>. ✓ marks evidence already gathered; the tag on each item shows what that clue helps establish. (These are this case's explicit requirements, not a general solvability proof.)</p><div class="proof-routes">${caseHealth(session,w).map(r=>`<article><div class="panel-heading"><strong>${r.title}</strong><span class="teal">${r.found.length}/${r.all.length} gathered</span></div><div class="route-track"><span style="width:${100*r.found.length/r.all.length}%"></span></div><ul>${r.all.map(c=>`<li class="${r.found.includes(c)?'found':''}"><span>${r.found.includes(c)?'✓':'○'}</span><span class="route-clue">${CLUES[c].title}</span><span class="pillar-tag">${cluePillar(c,ecl)}</span></li>`).join('')}</ul></article>`).join('')}</div><p class="meta">${session.world.caseId?.startsWith('gen-')?`Generated case · seed ${session.seed} · certified by the validator (physical, epistemic, reachability, distinguishability, multi-hop, multi-path).`:CASE.id==='last-bell'?`Schedule seed ${session.seed} · authored case.`:`Configured case · seed ${session.seed}.`}</p></div>`;}

function worldPanel(w){
  const idx=selectedIndex(),p=perspective==='world'?null:perspectiveAt(session,idx,perspective);
  const e=session.events[idx];
  const changes=session.events.slice(0,idx+1).filter(x=>x.kind==='belief'&&x.data.belief&&(!p||x.actor===perspective)).slice(-4);
  return `<section class="world-panel"><div class="perspective-toolbar"><div><span class="eyebrow teal">${timeLabel(w.minute)}</span><h2>${p?`${esc(PEOPLE[perspective].name)}’s perspective`:'Bellweather at this moment'}</h2></div><label>View through<select id="world-perspective"><option value="world">Actual world</option>${Object.entries(PEOPLE).map(([id,n])=>`<option value="${id}" ${perspective===id?'selected':''}>${n.name}</option>`).join('')}</select></label></div><p class="meta">${p?'Other positions are last witnessed, not live tracking. Absence of a marker means no recorded movement observation. Beliefs below may be mistaken.':'Actual positions and travel. Choose a character to explore their recorded observations and beliefs. Standing beliefs are established as the case opens (~evening’s end); memories accrue live through the evening.'}</p>
  <div class="moment-caption">${eventLink(e,(p?'Recorded event (world trace): ':'At this event: ')+e.title)}</div>
  ${p?'':`<details class="truth-panel" data-open-key="crime" open><summary>How the murder happened <span>the canonical crime history</span></summary><p>${esc(CASE.truth)}</p><div class="crime-timeline">${(CASE.history.length?CASE.history:crimeArc()).map(([t,txt])=>`<div><time>${esc(t)}</time><p>${esc(txt)}</p></div>`).join('')}</div></details>
  <details class="truth-panel projection" data-open-key="forecast"><summary>What happens next <span>forecast from personalities</span></summary>${cursor===null?`<p class="meta">What each character would do next if left alone — from their state, goals and disposition. A prediction, not canonical history.</p>${forecast?`${forecast.length?`<div class="crime-timeline">${forecast.map(pf=>`<div><time>${esc(timeLabel(pf.minute))}</time><p><strong>${esc(actorName(pf.actor))}</strong> — ${esc(pf.title)}</p></div>`).join('')}</div>`:'<p class="meta">No further activity projected in the next hour.</p>'}<button class="soft-button" data-do="forecast">Re-run forecast</button>`:'<button class="soft-button" data-do="forecast">Forecast the next hour →</button>'}`:'<p class="meta">A forecast only makes sense from the present. Use “Return to present” below, then forecast the next hour.</p>'}</details>`}
  <div class="location-grid town-grid">${Object.entries(LOCATIONS).map(([id,place])=>{
    const occupants=p?Object.entries(p.seen).filter(([,n])=>n.location===id):Object.entries(w.npcs).filter(([,n])=>n.location===id);
    return `<article class="location-card ${e.location===id?'moment-location':''}">${locationArt(id,'world-place-art')}<h3>${place.name}</h3><div class="occupants">${p&&p.self.location===id?`<button class="self-marker" data-do="person" data-id="${perspective}">${avatar(perspective,'tiny')} ${PEOPLE[perspective].name} · self</button>`:''}${occupants.map(([subject,n])=>`<div class="town-person ${p?'last-observed':''}">${subject==='player'?'<span class="player-occupant">Detective</span>':`<button data-do="person" data-id="${subject}">${avatar(subject,'tiny')}${PEOPLE[subject].name}</button>`}${p?`<small>${n.departed?'Seen leaving':'Seen arriving'} · ${timeLabel(n.minute)}<br>May have moved since</small>${eventLink(eventById(n.sourceId),'Observation')}`:`<small class="npc-counts">${n.beliefs.length?`${n.beliefs.length} beliefs · `:''}${sensoryMemories(n).length} memories</small>`}</div>`).join('')}${!p&&w.player.location===id?'<span class="player-occupant">Detective</span>':''}</div></article>`;
  }).join('')}</div>
  ${(()=>{const rows=Object.entries(w.npcs).filter(([id,n])=>n.travel&&(!p||id===perspective));return rows.length?`<div class="transit-list"><h3>${p?'Your travel':'Travel underway'}</h3>${rows.map(([id,n])=>`<p>${PEOPLE[id].name} · ${placeName(n.travel.from)} → ${placeName(n.travel.to)} · arrives ${timeLabel(n.travel.arrival)}</p>`).join('')}</div>`:'';})()}
  ${p?`<section class="detail-section"><div class="panel-heading"><h3>Beliefs held now (${p.beliefs.length})</h3><button class="subtle-button" data-do="person" data-id="${perspective}">Memories & profile ↗</button></div>${p.beliefs.map(b=>`<article class="belief-card"><p>${esc(b.text)}</p><small>${Math.round(b.confidence*100)}% confidence · ${esc(b.sourceType)} · ${timeLabel(b.acquired)}</small>${eventLink(eventById(b.sourceId),'Why they believe this')}</article>`).join('')}</section>`:``}
  ${changes.length?`<section class="detail-section"><h3>Recent belief changes</h3>${changes.map(change=>{const b=change.data.belief,patch=change.changes.find(c=>c.path===`npcs.${change.actor}.beliefs`),before=patch?.before?.find(x=>x.key===b.key);return `<article class="belief-change"><small>${timeLabel(change.minute)} · ${PEOPLE[change.actor].name}</small><p><span class="muted">${esc(before?.text??'No previous belief recorded')}</span><br>↓<br>${esc(b.text)}</p>${eventLink(change,'Follow this change')}</article>`;}).join('')}</section>`:''}
  <details class="advanced-case" data-open-key="advanced"><summary>Authored case requirements & solution (spoilers)</summary>${p?'<p class="meta">Switch to Actual world to inspect canonical case details.</p>':casePanel(w)}</details></section>`;
}
function missedPanel(w){
  if(!missedRevealed)return `<section class="world-panel"><h2>What went unseen?</h2><p>This review reveals unexamined clues, offstage conversations, and unused follow-ups up to the selected event. It contains spoilers.</p><button class="primary" data-do="reveal-missed">Reveal missed opportunities</button></section>`;
  const report=missedAt(session,selectedIndex());
  return `<section class="world-panel"><div class="panel-heading"><h2>Missed by ${timeLabel(w.minute)}</h2><button class="subtle-button" data-do="hide-missed">Hide spoilers</button></div><p class="meta">A review of this recorded run, not a score or a list of required actions. Scrub backward to review earlier opportunities.</p><h3>Unexamined evidence at places you visited</h3>${report.clues.map(c=>`<article class="opportunity"><strong>${esc(c.title)}</strong><p>${placeName(c.location)} · ${c.status}</p></article>`).join('')||'<p class="meta">No unrecorded physical clues at visited places in the current state.</p>'}<h3>Conversations you did not overhear</h3>${report.encounters.map(e=>`<article class="opportunity"><span class="meta">${timeLabel(e.minute)} · ${placeName(e.location)} · Past encounter, no longer observable</span>${eventLink(e)}</article>`).join('')||'<p class="meta">None recorded by this moment.</p>'}<h3>Evidence follow-ups not yet tried</h3>${report.followups.map(f=>`<article class="opportunity">${f.label}<p class="meta">${w.status==='solved'?'Case closed · review only.':`Try when you encounter ${PEOPLE[f.person].name}.`}</p></article>`).join('')||'<p class="meta">No outstanding follow-ups in this small authored checklist.</p>'}${report.moved?`<h3>Evidence that moved</h3><p>The red folio: ${report.moved.status}.</p>`:''}</section>`;
}

function checksPanel(h){return `<section class="checks-panel"><span class="eyebrow teal">INTEGRITY & REPLAY</span><h2>${h.ok?'Replay integrity checks pass.':'There is something to inspect.'}</h2><p class="muted">These checks run against the full current history, even when you are inspecting the past.</p><button class="soft-button" data-do="director">World Director · ${directorEnabled()?'Z3 enabled':'local checks'}</button><div class="check-summary"><strong>${h.eventCount}</strong><span>events</span><strong>${h.patchCount}</strong><span>state changes</span></div><div class="check-list">${h.checks.map(c=>`<article><span class="check-icon ${c.ok?'good':'bad'}">${c.ok?'✓':'!'}</span><div><strong>${c.name}</strong><p>${c.ok?'Pass':'Needs attention'}</p></div></article>`).join('')}</div>${h.errors.length?`<pre class="error-list">${esc(h.errors.join('\n'))}</pre>`:''}<div class="check-explanation"><h3>What replay verification means</h3><p>Starting with the initial world, the inspector applies every recorded state change in order. The result must exactly match the current world. Every “before” value must also match the reconstructed state.</p><h3>What it does not establish</h3><p>Replay consistency alone does not establish that the mystery is fair or that the rules mean what the author intended. This prototype uses a small authored case, deterministic decisions, and scripted conversations.</p><h3>Follow a useful example</h3><p>Show the estate accounts to Silas, then let time pass. In the history, follow the conversation to his new belief, his concealment decision, and the red folio’s movement. Or threaten Clara and follow the warning to Rowan.</p><button class="soft-button" data-do="export">Export events and current state</button></div></section>`;}

function milestones(){const idx=selectedIndex();const key=session.events.filter(e=>e.index<=idx&&e.title&&(['arrival','movement','speech','belief','evidence','resolution'].includes(e.kind)||e.data?.occurrence)&&(perspective==='world'||e.actor===perspective||e.data.listener===perspective));const shown=key;return `<span class="meta">Story so far · through ${timeLabel(session.events[idx].minute)}</span>${shown.map(e=>`<button class="milestone ${e.index===idx?'current':''}" data-do="event" data-index="${e.index}" title="${esc(e.title)}">${glyphs[e.kind]??'·'} ${timeLabel(e.minute)}<small>${esc(actorName(e.actor))}: ${esc(e.title)}</small></button>`).join('')||'<span class="meta">Nothing has happened yet at this point.</span>'}`;}

function replayBar(){const idx=selectedIndex(),e=session.events[idx],entry=entryEventIndex(),len=session.events.length,pct=len>1?(entry/(len-1))*100:0;return `<div class="replay-bar"><div class="replay-state"><span class="${cursor===null?'live-dot':'past-dot'}"></span><strong>${timeLabel(e.minute)}${cursor===null?' · present':''}</strong><span class="replay-what">${esc(actorName(e.actor))} — ${esc(clip(e.title,54))}</span></div><div class="replay-controls"><button class="icon-button" data-do="first" aria-label="Go to the first event">|‹</button><button class="icon-button" data-do="previous" aria-label="Previous event">‹</button><button class="play-replay" data-do="play-replay" aria-label="${timer?'Pause':'Play'} recorded history">${timer?'Ⅱ':'▶'}</button><button class="icon-button" data-do="next" aria-label="Next event">›</button></div><div class="replay-slider"><label for="history-cursor" class="sr-only">Inspect event in history</label><div class="slider-wrap"><input id="history-cursor" type="range" min="0" max="${len-1}" value="${idx}">${len>1?`<button class="entry-marker" data-do="event" data-index="${entry}" style="left:${pct}%" title="The detective enters Bellweather · ${timeLabel(session.events[entry].minute)}" aria-label="Jump to the detective's arrival"></button>`:''}</div><span>${idx+1} / ${len} events${cursor!==null&&idx<entry?' · before you arrived':''}</span></div><button class="soft-button" data-do="live" ${cursor===null?'disabled':''}>Return to present</button></div>`;}

function followTraceCursor(){
  if(mode!=='inspector'||inspectorTab!=='timeline'||timer)return;
  const list=$('#event-list'),idx=selectedIndex(),events=filteredEvents();
  if(!list||!events.length)return;
  // Filtered-out clock/memory events still have a nearby place in the visible trace.
  const nearest=events.reduce((best,e)=>Math.abs(e.index-idx)<Math.abs(best.index-idx)?e:best);
  const row=list.querySelector?.(`[data-index="${nearest.index}"]`);
  if(!row)return;
  const bounds=list.getBoundingClientRect(),item=row.getBoundingClientRect();
  list.scrollTop=Math.max(0,Math.min(list.scrollHeight-list.clientHeight,
    list.scrollTop+item.top-bounds.top-(list.clientHeight-item.height)/2));
}

let renderedJournal=null;
function render(){
  syncCase();
  globalThis.queueMicrotask?.(()=>{if(tourStep>=0)renderTour();});
  const journal=mode==='game'?JSON.stringify([visibleTranscript(playerView(session).transcript).slice(-5).map(e=>[e.id,displayText(e)]),pendingEntries()]):null;
  const scrolls={};
  for(const selector of ['#journal','#event-list','#event-detail','#character-panel','.notebook-content','.reason-scroll','.action-area','.world-panel','.checks-panel','.inspector-workspace']){const el=$(selector);if(el)scrolls[selector]=el.scrollTop;}
  const opens={};for(const el of (document.querySelectorAll?document.querySelectorAll('details[data-open-key]'):[]))opens[el.dataset.openKey]=el.open;
  const winY=(typeof window!=='undefined'&&window.scrollY)||0;
  rememberFaces();
  $('#app').innerHTML=header()+(mode==='game'?game():mode==='reasoning'?reasoning():inspector());
  animateFaces();
  document.body.dataset.mode=mode;
  for(const [selector,value]of Object.entries(scrolls)){const el=$(selector);if(el)el.scrollTop=value;}
  for(const el of (document.querySelectorAll?document.querySelectorAll('details[data-open-key]'):[]))if(el.dataset.openKey in opens)el.open=opens[el.dataset.openKey];
  if(typeof window!=='undefined'&&window.scrollTo)window.scrollTo(0,winY);
  // All delivery paths (scripted, Director, AI) follow new feed content. Merely
  // opening a panel preserves the player's reading position and side-panel scroll.
  if(journal!==null&&journal!==renderedJournal){const feed=$('#journal');if(feed)feed.scrollTop=feed.scrollHeight;}
  renderedJournal=journal;
  followTraceCursor();
}

function openModal(content,label){stopReplay();const m=$('#modal');m.innerHTML=`<button class="dialog-close icon-button" data-do="close-modal" aria-label="Close dialog">×</button>${content}`;m.setAttribute('aria-label',label);if(!m.open)m.showModal();}
function clueModal(id){const c=CLUES[id],entry=session.world.player.evidence.find(e=>e.clue===id);if(!entry)return;openModal(`${artifactArt(id,'artifact-detail-art')}<div class="eyebrow gold">${c.kind}</div><h2>${c.title}</h2><p class="clue-source">${esc(entry.source)} · ${timeLabel(entry.minute)}</p><div class="dialog-prose"><p>${esc(entry.text??c.text)}</p></div><div class="value-tags">${c.tags.map(t=>`<span>${t}</span>`).join('')}</div><button class="primary full" data-do="pin-close" data-id="${id}">${session.world.player.pins.includes(id)?'Unpin from your case':'Pin for your accusation'}</button>`,'Evidence detail');}
// where the constable who hears the accusation is now (or where they are walking to)
function officerPost(){const n=session.world.npcs[CASE.constable];return n?.travel?.to??n?.location;}
function accusationModal(){const w=session.world;if(w.status==='solved'){openModal(`<div class="eyebrow gold">CASE CLOSED</div><h2>Your accusation</h2><p>Your accusation was supported by the recorded evidence.</p><div class="dialog-prose"><p>${CASE.truth}</p></div><h3>Your supporting evidence</h3><ul>${w.ending.evidence.map(c=>`<li>${CLUES[c].title}</li>`).join('')}</ul>`,'Your completed accusation');return;}
  const officer=CASE.constable,post=officerPost();
  if(w.player.location!==post){const who=PEOPLE[officer];openModal(`<div class="eyebrow gold">PRESENT YOUR CASE</div><h2>Speak to ${esc(who.address??who.name)}.</h2><p>${esc(who.name)} is at ${esc(inSentence(LOCATIONS[post]))}. Bring your notebook and explain the connection between the suspect, the act, and the motive.</p><button class="primary full" data-do="visit-bell">Go to ${esc(inSentence(LOCATIONS[post]))} · ${distance(w.player.location,post)} min</button>`,'Visit the constable');return;}
  if(!w.player.evidence.length){openModal(`<h2>A case needs evidence.</h2><p>${CASE.kernel?'Look around the village and question its people.':'Begin in the study at Vale Manor.'} Record what you find before making an accusation.</p>`,'Evidence needed');return;}
  const selected=w.player.pins.length?w.player.pins:w.player.evidence.map(e=>e.clue);openModal(`<div class="eyebrow gold">CONSTABLE BELL’S CASE FILE</div><h2>Make the connections.</h2><p>Select the evidence supporting your account. An unsupported accusation will not end the investigation.</p>${caseStatusStrip()}<form id="accusation-form"><div class="accusation-fields"><label>Who killed ${esc(CASE.victimFirst??'Edmund')}?<select name="suspect" required><option value="">Choose a suspect</option>${(CASE.suspects??['clara','rowan','silas']).map(id=>`<option value="${id}">${PEOPLE[id].name}</option>`).join('')}</select></label>${CASE.askMethod===false?'':`<label>How?<select name="method" required><option value="">Choose a method</option>${(CASE.methodOptions??[["poison","Poison in his drink"],["seal","A blow from the brass seal"],["knife","A concealed knife"]]).map(([id,label])=>`<option value="${id}">${esc(label)}</option>`).join('')}</select></label><label>Why?<select name="motive" required><option value="">Choose a motive</option>${(CASE.motiveOptions??[["jealousy","Jealousy over a relationship"],["inheritance","An inheritance dispute"],["fraud","Conceal the diverted estate payments"]]).map(([id,label])=>`<option value="${id}">${esc(label)}</option>`).join('')}</select></label>`}</div><fieldset class="evidence-selection"><legend>Supporting evidence</legend>${w.player.evidence.map(e=>`<label><input type="checkbox" name="evidence" value="${e.clue}" ${selected.includes(e.clue)?'checked':''}><span>${CLUES[e.clue].title}<small>${CLUES[e.clue].kind}</small></span></label>`).join('')}</fieldset><button class="primary full" type="submit">Present the accusation</button></form>`,'Present an accusation');}
// Synchronous core: generate one validated case and start it. Returns false if none was found.
// Certified cases produced offline by the mystery-kernel generator (tools/refine-c), shipped as full records.
// ---- Case generation (the mystery-kernel generator, via the local generator server) -------------------------
// Finished cases: shipped examples (cases/generated/index.json) and cases generated on this machine (live/).
const GENERATOR='http://127.0.0.1:8789';
let genJob=null,genEvents=[],genNext=0,genTimer=null,genSpoiler=false,genError=null;
async function listCases(){
  const read=async u=>{try{const r=await fetch(u,{cache:'no-store'});return r.ok?await r.json():[];}catch{return [];}};
  const [live,shipped]=await Promise.all([read('cases/generated/live/index.json'),read('cases/generated/index.json')]);
  return [...live.map(c=>({...c,live:true})),...shipped];
}
// Difficulty: a level computed from the certified case (tools/refine-c/difficulty.py). Pips and a word, never colour alone.
const DIFFICULTY={easy:['●○○','Easy'],medium:['●●○','Medium'],hard:['●●●','Hard']};
const GEN_TIME={easy:'~5 min',medium:'~10 min',hard:'~25 min'};
function difficultyBadge(d){const l=DIFFICULTY[d?.level];return l?` <span class="difficulty ${d.level}" title="Difficulty: ${l[1]} (score ${d.score})"><span aria-hidden="true">${l[0]}</span> ${l[1]}</span>`:'';}
// The case list, filtered by difficulty (the filter survives reopening the menu).
let caseFilter='all',caseItems=[],caseItem=null;
function caseListHTML(cases,item){
  caseItems=cases;caseItem=item;
  const shown=cases.filter(c=>caseFilter==='all'||c.difficulty?.level===caseFilter);
  return shown.map(item).join('')||`<p class="meta">${cases.length?'No cases at this difficulty yet. Generate one above.':'No generated cases yet.'}</p>`;
}
async function chooseCaseModal(){
  const cases=(await listCases()).sort((a,b)=>(a.difficulty?.score??99)-(b.difficulty?.score??99));
  const item=c=>`<button class="soft-button case-choice" data-do="start-generated" data-file="${esc(c.file)}"><span class="case-title"><strong>${esc(c.title)}</strong>${difficultyBadge(c.difficulty)}${c.live?' <span class="meta">· generated here</span>':''}</span><small>${esc(c.blurb||'')}</small></button>`;
  openModal(`<h2>Choose a case</h2><p>Generate a new mystery, or play one that was generated before. Every case is written by the generator and certified before you play it: every clue can be reached and exactly one suspect fits all the evidence. Harder cases hide the answer deeper, behind lies you must see through and behaviour meant to mislead. Starting a case replaces your current investigation, so export it first if you want to keep it.</p><button class="soft-button" data-do="export">Export current investigation</button><div class="menu-actions">${genJob?.status==='running'?`<button class="primary" data-do="show-generation">⏳ Generating “${esc(genJob.title)}” — show progress</button>`:`<h3 class="case-list-head" id="gen-head">Generate a new case</h3><div class="generate-choice" role="group" aria-labelledby="gen-head">${Object.entries(DIFFICULTY).map(([k,[pips,word]])=>`<button class="soft-button" data-do="generate-new" data-level="${k}"><span aria-hidden="true">${pips}</span> ${word}<small>${GEN_TIME[k]}</small></button>`).join('')}</div>`}</div><h3 class="case-list-head">Play a generated case</h3><label class="case-filter">Difficulty <select id="case-filter">${[['all','All'],...Object.entries(DIFFICULTY).map(([k,[pips,w]])=>[k,`${pips} ${w}`])].map(([k,l])=>`<option value="${k}"${caseFilter===k?' selected':''}>${l}</option>`).join('')}</select></label><div class="menu-actions case-list" id="case-list">${caseListHTML(cases,item)}</div><h3 class="case-list-head">The original</h3><div class="menu-actions">${CASE_OPTIONS.slice(0,1).map(c=>`<button class="soft-button" data-do="start-case" data-id="${c.id}">${esc(c.title)}</button>`).join('')}</div>`,'Choose a case');
}
// Restart a generated case: find its file in the case lists by id (a case keeps its id when it moves between them).
async function restartKernelCase(id){
  const entry=(await listCases()).find(c=>c.id===id);
  if(entry){startKernelCase(entry.file);return;}
  toast('That case is no longer in the case list. Choose another from Menu \u2192 Choose a case.');
}
async function startKernelCase(file){
  try{const r=await fetch(`cases/generated/${file}`,{cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);const records=await r.json();const id=registerKernelCase(records);startGenerated(id,records.title);}
  catch(e){toast(`Could not load that case: ${e.message}`);}
}
// ---------------------------------------------------------------------------------------------------------------
// Opening scene: the case, the cast (public faces only: never secrets, lies or guilt), where to start, how to play,
// and an optional tour. Shown once per case; reopened from the menu.
const OPENING_KEY=id=>`living-mystery.opening.${id}`;
let openingPage=0,tourStep=-1;
function openingSeen(){try{return globalThis.localStorage?.getItem(OPENING_KEY(session.world.caseId??'last-bell'))==='1';}catch{return true;}}
function markOpeningSeen(){try{globalThis.localStorage?.setItem(OPENING_KEY(session.world.caseId??'last-bell'),'1');}catch{}}
function firstStep(){
  const h=caseTables(session).behavior?.hints?.(session);const x=h&&CLUES[h.id];
  const at=x?.at??(x?.speaker?session.world.npcs[x.speaker]?.location:null)??CASE.scene??'manor';
  return LOCATIONS[at]?at:Object.keys(LOCATIONS)[0];
}
function openingModal(page=0){
  openingPage=page;const pages=4,victim=CASE.victimId,vname=CASE.victim??'the deceased',vfirst=CASE.victimFirst??vname.split(' ')[0];
  const dots=`<div class="opening-dots">${Array.from({length:pages},(_,i)=>`<button class="${i===page?'on':''}" data-do="opening-page" data-id="${i}" aria-label="Page ${i+1}"></button>`).join('')}</div>`;
  const nav=`<div class="opening-nav">${page?`<button class="soft-button" data-do="opening-page" data-id="${page-1}">← Back</button>`:'<span></span>'}${dots}${page<pages-1?`<button class="primary" data-do="opening-page" data-id="${page+1}">Next →</button>`:`<span class="two-actions"><button class="soft-button" data-do="opening-tour">Take the tour</button><button class="primary" data-do="opening-done">Begin</button></span>`}</div>`;
  const cast=Object.keys(PEOPLE).map(id=>{const p=PEOPLE[id],sh=p.sheet||{};return `<article class="cast-card">${artImage(ART.people[id],'cast-art')||avatar(id,'large')}<div><strong>${esc(p.name)}</strong><small>${esc(p.role)}</small><p>${esc(p.public??'')}</p>${sh.temperament?`<p class="meta">${esc(sh.temperament)}${sh.pet_subject?` · talks about ${esc(sh.pet_subject)}`:''}</p>`:''}</div></article>`;}).join('');
  const start=firstStep();
  const body=[
    `<div class="opening-title">${artImage(ART.people[victim],'opening-victim')}<div><div class="eyebrow gold">${esc((CASE.kernel?'A generated case':'The Last Bell').toUpperCase())}</div><h2>${esc(CASE.title??'The Last Bell')}</h2><p class="opening-synopsis">${esc(CASE.synopsis??'')}</p><p class="opening-question">Who killed ${esc(vname)}? How was it done, and why?</p><p class="meta">Constable Bell has asked you to investigate. He will hear your accusation in the village square when you can show all three.</p></div></div>`,
    `<h2>Meet the village</h2><p class="meta">Everyone here has a life, a manner and something on their mind. What they are hiding is for you to find.</p><div class="cast-grid"><article class="cast-card victim">${artImage(ART.people[victim],'cast-art')}<div><strong>${esc(vname)}</strong><small>${esc(CASE.victimRole??'The victim')} · deceased</small><p>${esc(CASE.victimPublic??'')}</p></div></article>${cast}</div>`,
    `<h2>Where to start</h2><div class="opening-bell">${artImage(ART.people.bell,'cast-art')}<blockquote>“Right then. ${esc(vfirst)}'s dead, and I want it settled properly. Have a look round ${esc(LOCATIONS[start]?.name??'the village')} first, then talk to folk. They'll tell you more than they mean to.”</blockquote></div><p>The map on the left shows every place, the minutes on foot between them, who is where, and where there is something left to examine. The people at your place are in the Talk panel on the right.</p><button class="soft-button" data-do="opening-go" data-id="${start}">Go to ${esc(LOCATIONS[start]?.name??'')} · ${distance(session.world.player.location,start)} min</button>`,
    `<h2>How to investigate</h2><ul class="opening-howto"><li><b>Walk</b> on the village map (left). Faces show who is where; <b>!</b> marks a lead, <b>?</b> something to examine, <b>✓</b> done.</li><li><b>Look around</b> (bottom left) and examine what is there. New leads appear as you find what points to them.</li><li><b>Talk</b> (right): click a face, then pick a question or type anything in your own words and press Enter. The conversation fills the middle.</li><li><b>Show</b> something by dragging an evidence card, or a thing from Look around, onto the conversation.</li><li><b>Think</b> on the Clue Board: everyone's profile, your case under Motive, Means and Opportunity (a ✓ when your evidence really establishes one), and the full history.</li><li><b>Stuck?</b> The Hints tab: a nudge, a clue, then the answer.</li><li><b>Accuse</b> (top right) when you can show who, how and why. Bell tells you what is missing if you cannot yet.</li></ul>`,
  ][page];
  openModal(`<div class="opening">${body}${nav}</div>`,'Case introduction');
}
// The tour follows the layout: map and Look around (left), the conversation (middle), Talk / Evidence / Hints (right),
// the Clue Board and Accuse (top). Each step may switch the right panel so its target is visible.
const TOUR=[
  {sel:'.village-map, .places',title:'The village',text:'Click a place to walk there. The numbers on the paths are minutes on foot. A ! marks a place a lead points to, ? means there is something left to examine, ✓ means done.'},
  {sel:'.room-left',title:'Look around',text:'What you can examine here. Click to examine; new leads appear as you find what points to them. While talking to someone you can also drag a thing from here into the conversation.'},
  {sel:'.talk-faces, .talk-panel',tab:'talk',title:'Talk',text:'The people at this place. Click a face to start a conversation; it fills the middle panel.'},
  {sel:'.talk-questions, .talk-panel',tab:'talk',title:'Ask',text:'Pick a suggested question, or type anything in your own words at the bottom and press Enter.'},
  {sel:'[data-do="notebook"][data-id="evidence"]',tab:'evidence',title:'Evidence',text:'Everything you have found, newest first (or grouped by type). Drag a card onto the conversation to show it to the person you are talking to.'},
  {sel:'[data-do="notebook"][data-id="hints"]',title:'Hints',text:'Stuck? A nudge, then a clue, then the answer, one at a time.'},
  {sel:'[data-value="reasoning"]',title:'Clue Board',text:'Everyone in the village with their profile, your case against each suspect under Motive, Means and Opportunity (a ✓ appears when your evidence really establishes one), and the full history.'},
  {sel:'.accuse-button',title:'Accuse',text:'When your evidence shows who, how and why, accuse here. A wrong accusation does not end the case: Bell tells you what is missing.'}];
function renderTour(){
  document.querySelectorAll?.('.tour-target').forEach(el=>el.classList.remove('tour-target'));document.getElementById?.('tour-tip')?.remove();
  if(tourStep<0||tourStep>=TOUR.length||mode!=='game')return;
  const step=TOUR[tourStep],{sel,title,text}=step;
  if(step.tab&&notebook!==step.tab){notebook=step.tab;render();return;}   // render() re-runs the tour on the new layout
  const el=document.querySelector?.(sel);if(!el){tourStep++;return renderTour();}
  el.classList.add('tour-target');const r=el.getBoundingClientRect(),tip=document.createElement('div');tip.id='tour-tip';tip.className='tour-tip';tip.setAttribute('role','dialog');
  tip.innerHTML=`<strong>${title}</strong><p>${text}</p><div class="two-actions"><button class="subtle-button" data-do="tour-end">Skip</button><button class="primary" data-do="tour-next">${tourStep<TOUR.length-1?'Next':'Done'} (${tourStep+1}/${TOUR.length})</button></div>`;
  document.body.appendChild(tip);
  const top=Math.min(innerHeight-tip.offsetHeight-12,Math.max(12,r.bottom+10)),left=Math.min(innerWidth-tip.offsetWidth-12,Math.max(12,r.left));
  tip.style.top=`${top}px`;tip.style.left=`${left}px`;el.scrollIntoView?.({block:'nearest'});
}
function maybeOpening(){if(!$('#modal')?.open&&!openingSeen()&&session.world.status!=='solved'&&!session.events.some(e=>e.kind==='command'))openingModal(0);}

function startGenerated(id,title){
  dlog('case_start',{id,title});
  const fresh=createSession(17,id);
  cancelCharacter();stopReplay();session=fresh;resetRealized();boardNotes={};healthCache=null;cursor=null;chat=null;chosenClue=null;reasonSuspect=null;detailPanel=null;missedRevealed=false;sceneTransition=null;actionGroup='inspect';mode='game';persist();$('#modal')?.close?.();render();toast(`Case ready: ${title}`);maybeOpening();
}
async function genFetch(path,method='GET',payload=null){
  const r=await fetch(`${GENERATOR}${path}`,{method,cache:'no-store',headers:method==='POST'?{'X-Living-Mystery':'generator-v1',...(payload?{'content-type':'application/json'}:{})}:{},...(payload?{body:JSON.stringify(payload)}:{})});
  const body=await r.json().catch(()=>({}));
  if(!r.ok&&r.status!==409)throw Error(body.error||`HTTP ${r.status}`);
  return {status:r.status,body};
}
let genLevel='medium';
async function startGeneration(level=genLevel){
  genError=null;genLevel=level;
  try{
    const {status,body}=await genFetch('/jobs','POST',{difficulty:level});
    if(status===409)toast('A case is already being generated — showing its progress.');
    genJob=body;genEvents=[];genNext=0;dlog('generation_start',{job:body?.id,title:body?.title,difficulty:level,httpStatus:status});
  }catch(e){dlog('generation_error',{error:String(e.message)});genJob=null;genError='The case generator is not running. Start it with: .venv/bin/python server/generator_server.py';}
  renderGeneration();if(genJob)pollGeneration();
}
async function resumeGeneration(){
  try{const {body}=await genFetch('/jobs/current');if(body?.id&&body.status==='running'){genJob=body;genEvents=[];genNext=0;renderGeneration();pollGeneration();return true;}}catch{}
  return false;
}
async function pollGeneration(){
  clearTimeout(genTimer);
  if(!genJob)return;
  try{
    const {body}=await genFetch(`/jobs/${encodeURIComponent(genJob.id)}?since=${genNext}`);
    const prev=genJob?.status;
    for(const e of body.eventsNew||[])dlog('generation_event',{job:genJob.id,event:e.kind,t:e.t,step:e.step,mode:e.mode,accepted:e.accepted,ok:e.ok,message:e.message,errors:e.errors});
    genEvents.push(...(body.eventsNew||[]));genNext=body.next??genNext;genJob={...genJob,...body};delete genJob.eventsNew;
    if(prev!==genJob.status)dlog('generation_status',{job:genJob.id,status:genJob.status,error:genJob.error,result:genJob.result});
  }catch(e){dlog('generation_error',{error:String(e.message)});genError='Lost contact with the case generator.';}
  if($('#modal')?.open&&$('#gen-panel'))renderGeneration();
  if(genJob?.status==='running'&&!genError)genTimer=setTimeout(pollGeneration,1500);
}
async function cancelGeneration(){
  if(!genJob)return;
  try{await genFetch(`/jobs/${encodeURIComponent(genJob.id)}/cancel`,'POST');}catch{}
  pollGeneration();
}
// Progressive hints: one gentle nudge at a time; each further level says more.
let hintState={key:null,level:0};
// Motive, means and opportunity as the player's own evidence stands, for the only suspect it leaves (if any).
function caseStatusStrip(){
  const st=caseTables(session).behavior?.caseStatus?.(session);if(!st)return '';
  const who=st.lead?PEOPLE[st.lead]?.name:null;
  const cell=(ok,label,detail)=>`<span class="pillar-cell ${ok?'s-filled':'s-open'}" title="${esc(detail)}"><b>${ok?'✓':'…'}</b> ${label}</span>`;
  return `<div class="pillar-strip" role="status" aria-label="Your case so far">
    ${cell(st.opportunity,'Opportunity',who?`Only ${who} could have done it`:`${st.remaining.length} people could still have done it`)}
    ${cell(st.means,'Means',st.means?`You can show how ${who} did it`:'Nothing yet shows how it was done')}
    ${cell(st.motive,'Motive',st.motive?`You can show why ${who} did it`:'Nothing yet shows why')}
    <span class="meta">${who?`Leading suspect: ${esc(who)}`:`${st.remaining.length} still possible`}</span></div>`;
}
// Kernel cases: ask the Z3 service (if running) for an alternative story first, so Bell can name the gap concretely.
async function submitAccusation(action){
  const B=caseTables(session).behavior;
  if(B?.caseStatus){
    try{
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),2500);
      const r=await fetch('http://127.0.0.1:8788/case',{method:'POST',signal:ctrl.signal,headers:{'content-type':'application/json','X-Living-Mystery':'director-v1'},
        body:JSON.stringify({caseId:session.world.caseId,held:(action.evidence?.length?action.evidence:session.world.player.evidence.map(e=>e.clue)),accused:action.suspect||''})});
      clearTimeout(timer);
      if(r.ok){const z=await r.json();if(z.alternative)action={...action,alternative:{actor:z.alternative.actor,minute:z.alternative.minute}};dlog('z3_case',{survivors:z.survivors,ruledOut:z.ruledOut,alternative:z.alternative});}
    }catch(e){dlog('z3_case',{unavailable:String(e?.name||e)});}
    const v=B.checkCase(session,action);
    dlog('accusation',{suspect:action.suspect,method:action.method,motive:action.motive,status:v.status,supported:v.supported,pillars:v.pillars,alternative:v.alternative,remaining:v.alternatives});
  }
  act(action);
}
function hintsPanel(){
  const h=caseTables(session).behavior?.hints?.(session);
  if(!h)return '<p class="muted">Hints are available in generated cases.</p>';
  const key=`${session.world.caseId}:${h.id}`;
  if(hintState.key!==key)hintState={key,level:0};
  const shown=h.levels.slice(0,hintState.level);
  const labels=['Give me a hint','A little more','Just tell me'];
  return `${caseStatusStrip()}<p class="muted">Stuck? Hints come one at a time, from a gentle nudge to a plain answer. They update as you make progress.</p>
   <div class="hint-list">${shown.map((t,i)=>`<article class="hint-card level-${i+1}"><span class="meta">${['Nudge','Clue','Answer'][i]}</span><p>${esc(t)}</p></article>`).join('')}</div>
   ${hintState.level<h.levels.length?`<button class="soft-button full" data-do="hint-more">${labels[hintState.level]}</button>`:'<p class="meta">That is everything for this step. Hints move on when you do.</p>'}`;
}
function mmss(t){t=Math.max(0,Math.round(t||0));return `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;}
const STAGE_LABEL={twist:'Planting the misdirection',implicate:'Hiding the motive and the means',herring:'Adding a red herring',refine:'Deepening the investigation'};
const OP_LABEL={Conceal:'hidden',Fragment:'split into pieces',Mislead:'made misleading'};
function genSummary(){
  const seed=genEvents.find(e=>e.kind==='seed'),steps=genEvents.filter(e=>e.kind==='step'),last=[...genEvents].reverse().find(e=>e.metrics&&e.metrics.solve_depth!=null);
  const started=[...genEvents].reverse().find(e=>e.kind==='step_start'),done=genEvents.find(e=>['done','failed','cancelled'].includes(e.kind));
  const pending=started&&!steps.some(e=>e.step===started.step)?started:null;
  return {seed,steps,last,pending,done,publishing:genEvents.some(e=>e.phase==='publish')&&!done};
}
function genProgress(){
  const {seed,steps,last,pending,done,publishing}=genSummary(),m=last?.metrics||{};
  const accepted=steps.filter(e=>e.accepted).length;
  const stage=done?(done.kind==='done'?'Your case is ready.':done.kind==='cancelled'?'Generation cancelled.':'Generation failed.')
    :publishing?'Writing the questions you can ask and each suspect’s account of the evening…'
    :pending?`Layer ${pending.step}: ${STAGE_LABEL[pending.mode]||'Refining'}…`
    :seed?'Choosing what to deepen next…':'Writing the setting, the cast and what really happened…';
  const activity=done?'':genActivity(pending,seed,publishing);
  const rows=[['The story',seed?'written':'writing'],['Layers added',`${accepted}${steps.length>accepted?` (${steps.length-accepted} rejected)`:''}`],
    ['Solve depth',m.solve_depth??'—'],['Misdirection',m.twist?'yes':'not yet'],['Red herring',m.herrings?.length?'yes':'not yet'],
    ['Motive and means',m.motive?.length&&m.means?.length?'hidden':'not yet']];
  return `<div class="gen-stage">${done?'':'<span class="spinner"></span>'}<strong>${esc(stage)}</strong><span class="meta">${mmss(genJob?.elapsed)}</span></div>${activity?`<p class="meta gen-activity">${esc(activity)}</p>`:''}
   <div class="gen-meter"><span style="width:${Math.min(100,done?.kind==='done'?100:Math.round(((seed?1:0)+accepted)/12*100))}%"></span></div>
   <dl class="gen-facts">${rows.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join('')}</dl>`;
}
// What the generator is doing right now, from the fine-grained events since the current stage began.
function genActivity(pending,seed,publishing){
  if(publishing)return 'Usually under a minute.';
  const from=pending?genEvents.lastIndexOf(pending):seed?genEvents.lastIndexOf(seed):0;
  const recent=genEvents.slice(from+1),t=(genJob?.elapsed??0)-(genEvents[from]?.t??0);
  const drafting=recent.filter(e=>e.kind==='drafting').at(-1),checked=recent.filter(e=>e.kind==='draft_checked'),review=recent.some(e=>e.kind==='reviewing');
  if(!seed&&!pending)return drafting?`${drafting.round>1?'Revising after the checks rejected the first drafts. ':''}Writing ${drafting.drafts} drafts in parallel — the first draft usually takes 1–2 minutes (${mmss(t)} so far).`:'Starting…';
  if(!pending)return '';
  const ok=checked.filter(e=>e.ok).length,bad=checked.length-ok;
  if(review)return `${ok} draft(s) passed the logic checks; a second model is reviewing them for plausibility…`;
  if(checked.length)return `${checked.length} of ${drafting?.drafts??2} drafts back: ${ok} passed the checks${bad?`, ${bad} rejected`:''}…`;
  return drafting?`${drafting.round>1?'Revising: ':''}the model is writing ${drafting.drafts} drafts of this layer — usually 30–60 seconds (${mmss(t)} so far).`:'';
}
function spoilerHtml(){
  const {seed,steps,pending}=genSummary();
  if(!seed)return '<p class="meta">Nothing yet: the story appears here as soon as the first draft passes its checks.</p>';
  const c=seed.case,P=Object.fromEntries((c.people||[]).map(p=>[p.id,p]));
  const name=id=>P[id]?.name??id,hm=x=>`${String(Math.floor(x/60)%24).padStart(2,'0')}:${String(Math.round(x)%60).padStart(2,'0')}`;
  const truth=(c.question?.candidates||[]).find(h=>h.id===c.question.truth),culprit=truth?.facts?.actor;
  const att=id=>(c.attitudes||[]).filter(a=>a.agent===id);
  const list=(arr,f)=>arr.length?`<ul>${arr.map(f).join('')}</ul>`:'';
  const signLine=x=>`<li><b>${esc(x.title||x.id)}</b> <span class="meta">${esc(x.kind||'')}${x.at?' · '+esc(x.at):''}${x.speaker?' · '+esc(name(x.speaker)):''}${(x.requires||[]).length?' · hidden until: '+esc(x.requires.join(', ')):''}</span><br>${esc(x.text||'')}</li>`;
  const cast=`<h4>The cast</h4><div class="spoil-cast">${(c.people||[]).map(p=>`<div class="spoil-person${p.id===culprit?' culprit':''}"><strong>${esc(p.name)}</strong> <span class="meta">${esc(p.role||'')}${p.id===culprit?' · THE CULPRIT':''}</span>${Object.keys(p.traits||{}).length?`<div class="meta">${esc(Object.entries(p.traits).map(([k,v])=>`${k}: ${v}`).join(' · '))}</div>`:''}${list(att(p.id),a=>`<li><i>${esc(a.mode)}</i> ${esc(a.content)}</li>`)}</div>`).join('')}</div>`;
  const question=`<h4>The question</h4><p><b>${esc(c.question?.text||'')}</b><br>Truth: <b>${esc(truth?.label||name(culprit))}</b> · suspects: ${esc((c.question?.candidates||[]).map(h=>h.label).join(', '))}</p>`;
  const history=`<h4>What really happened (first draft)</h4>${list([...(c.events||[])].sort((a,b)=>a.start-b.start),e=>`<li><span class="meta">${hm(e.start)} · ${esc(e.place)}</span> ${esc(e.summary||e.type)}</li>`)}`;
  const surface=`<h4>The first, easy clues</h4>${list(c.signs||[],signLine)}`;
  const iter=steps.map(e=>{
    const add=e.added||{},counts=Object.entries(add).map(([k,v])=>`${v.length} ${k}`).join(', ');
    const tried=(e.attempts||[]).filter(a=>a&&a.length).length,review=(e.critic||[]).filter(r=>!r.pass).length;
    return `<details class="spoil-step ${e.accepted?'ok':'no'}" data-step="${e.step}"><summary><b>Layer ${e.step}</b> · ${esc(STAGE_LABEL[e.mode]||e.mode)} · ${e.accepted?`${esc(e.operator||'')}${e.operator&&OP_LABEL[e.operator]?` (${OP_LABEL[e.operator]})`:''}`:'rejected'} <span class="meta">· ${e.seconds}s${e.metrics?.solve_depth!=null?` · solve depth ${e.metrics.solve_depth}`:''}</span></summary>
      ${e.story?`<p class="spoil-story">${esc(e.story)}</p>`:''}
      ${e.blocks?.length?`<p class="meta">Blocks: ${esc(e.blocks.join(', '))}</p>`:''}
      ${counts?`<p class="meta">Added: ${esc(counts)}</p>`:''}
      ${list(add.attitudes||[],a=>`<li><b>${esc(name(a.agent))}</b> <i>${esc(a.mode)}</i> ${esc(a.content)}</li>`)}
      ${list(add.events||[],x=>`<li><span class="meta">${hm(x.start)} · ${esc(x.place)}</span> ${esc(x.summary||x.type)}</li>`)}
      ${list(add.signs||[],signLine)}
      ${tried||review?`<p class="meta">${tried?`${tried} candidate(s) failed the checks`:''}${tried&&review?'; ':''}${review?`${review} rejected by the plausibility review`:''}</p>`:''}
      ${!e.accepted?list((e.attempts||[]).flat().slice(0,4),x=>`<li class="meta">${esc(String(x))}</li>`):''}
    </details>`;}).join('');
  const now=pending?`<p class="meta"><span class="spinner"></span> Layer ${pending.step}: ${esc(STAGE_LABEL[pending.mode]||pending.mode)} around “${esc(pending.target_title||pending.target)}”…</p>`:'';
  return question+cast+history+surface+`<h4>How the story was deepened</h4>${iter||'<p class="meta">No layers yet.</p>'}${now}`;
}
function renderGeneration(){
  const prevBody=$('.gen-spoiler-body'),keepScroll=prevBody?prevBody.scrollTop:0,prevOpen=$('.gen-spoiler');
  if(prevOpen&&typeof prevOpen.open==='boolean')genSpoiler=prevOpen.open;
  const openSteps=new Set([...(document.querySelectorAll?document.querySelectorAll('.spoil-step[open]'):[])].map(d=>d.dataset?.step));
  const job=genJob,done=['done','failed','cancelled'].includes(job?.status);
  const head=job?`<div class="eyebrow gold">GENERATING A NEW CASE</div><h2>${esc(job.title||'A new mystery')}</h2><p class="meta">${esc(job.premise||'')}</p>`:'<div class="eyebrow gold">GENERATING A NEW CASE</div><h2>Generate a new deep case</h2>';
  const body=genError?`<p class="gen-error">${esc(genError)}</p>`:job?genProgress():'<p class="meta">Starting…</p>';
  const actions=job?.status==='done'&&job.result?`<button class="primary" data-do="start-generated" data-file="${esc(job.result.file)}">Play this case</button>`
    :job?.status==='running'?`<button class="soft-button" data-do="cancel-generation">Cancel</button><button class="soft-button" data-do="close-modal">Keep going in the background</button>`
    :`<button class="soft-button" data-do="generate-new">Try again</button>`;
  const err=job?.status==='failed'||job?.status==='cancelled'?`<p class="gen-error">${esc(job.error||'')}</p>`:'';
  const note=job?.status==='running'?'<p class="meta">This takes several minutes. A language model writes the story one layer at a time, and every layer is checked before it is kept.</p>':'';
  const inner=`${head}${body}${err}${note}<div class="menu-actions gen-actions">${actions}</div>
    <details class="gen-spoiler" data-open-key="gen-spoiler"${genSpoiler?' open':''}><summary>⚠️ Spoiler: watch the story being built (for testing)</summary><div class="gen-spoiler-body">${job?spoilerHtml():''}</div></details>`;
  const m=$('#modal'),panel=m?.open&&String(m.innerHTML||'').includes('id="gen-panel"')?$('#gen-panel'):null;
  if(panel)panel.innerHTML=inner;else openModal(`<div id="gen-panel">${inner}</div>`,'Generating a case');
  const d=$('.gen-spoiler');if(d?.addEventListener)d.addEventListener('toggle',()=>{genSpoiler=d.open;});
  for(const el of (document.querySelectorAll?document.querySelectorAll('.spoil-step'):[]))if(openSteps.has(el.dataset?.step))el.open=true;
  const nb=$('.gen-spoiler-body');if(nb)nb.scrollTop=keepScroll;
}
function menuModal(){openModal(`<div class="eyebrow gold">THE BELLWEATHER CASE</div><h2>Your investigation</h2><p>Progress is saved on this device. Export keeps a portable copy, including the full inspector history.</p><div class="menu-actions"><button class="soft-button" data-do="export">Export investigation & trace</button><button class="soft-button" data-do="import">Import saved investigation</button><button class="soft-button" data-do="llm">AI characters…</button><button class="soft-button" data-do="director">World Director…</button><button class="soft-button" data-do="choose-case">Choose a case configuration…</button><button class="soft-button" data-do="restart-confirm">Restart this case</button><button class="soft-button" data-do="opening">Case introduction and tour</button><button class="soft-button" data-do="flag-issue">🐞 Flag an issue</button></div>`,'Investigation options');}
function flagIssueModal(){openModal(`<div class="eyebrow gold">DEBUG</div><h2>Flag an issue</h2><p class="meta">What went wrong? Your note is saved to the debug log with a snapshot of the current game state.</p><form id="issue-form"><textarea id="issue-note" rows="4" maxlength="2000" placeholder="e.g. Ada answered about the wrong night"></textarea><button class="primary full" type="submit">Save to the debug log</button></form>`,'Flag an issue');}
function flagIssue(note){
  const w=session.world,recent=playerView(session).transcript.slice(-12).map(e=>({minute:e.minute,kind:e.kind,actor:e.actor,text:String(e.text).slice(0,500)}));
  dlog('issue',{note,status:w.status,evidence:w.player.evidence.map(e=>e.clue),locked:w.flags?.lockedObjects??[],conversation:w.player.conversation,
    npcs:Object.fromEntries(Object.entries(w.npcs).map(([id,n])=>[id,n.travel?'transit':n.location])),mode,notebook,recent});
  dlogFlush();toast('Saved to the debug log. Tell me what you flagged and I can look it up.');
}
function llmModal(){const c=llmConfig();openModal(`<div class="eyebrow teal">OPTIONAL · EXPERIMENTAL</div><h2>AI characters</h2><p>Character reasoning combines response decisions with natural dialogue. Characters receive their own beliefs, memories, goals and conversation history. They can answer, evade, clarify, challenge, refuse or end a conversation. The engine limits disclosures and consequences; a separate critic checks the proposal before it is recorded. Failed turns use an authored fallback. The critic can still make mistakes.</p><form id="llm-form"><div class="accusation-fields"><label>Proxy endpoint URL<input name="endpoint" autocomplete="off" placeholder="http://127.0.0.1:8787" value="${esc(c.endpoint||'http://127.0.0.1:8787')}"></label><label style="flex-direction:row;align-items:center;gap:10px"><input type="checkbox" name="reasoning" ${c.enabled&&c.reasoning?'checked':''} style="width:16px;height:16px;accent-color:var(--teal)"> Enable character reasoning and free-text conversation</label></div><button class="primary full" type="submit">Save settings</button></form><p class="meta">With this setting off, responses are immediate and scripted; no AI requests are made. Reasoning permits up to two proposals and two critic calls per turn, with a 30-second total timeout. Accepted turns and audits survive export and replay. In configured cases this also enables occasional autonomous goal selection: at most one additional request per player turn, a five-second timeout, and a twenty-minute cooldown per NPC. Scripted life continues when the request fails. Your local proxy receives this character’s private perspective, not the full world. Restart the proxy after updating its code.</p>`,'AI character settings');}

function exportFile(){const blob=new Blob([exportDialogueSave(session,dialogueAudit,boardNotes)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`bellweather-investigation-${session.events.length}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Investigation and full history exported.');}
function stopReplay(){if(timer){clearInterval(timer);timer=null;}}
function step(direction){stopReplay();const events=filteredEvents(),idx=selectedIndex();if(events.length){const target=direction<0?[...events].reverse().find(e=>e.index<idx):events.find(e=>e.index>idx);cursor=target?target.index:(direction<0?events[0].index:events[events.length-1].index);}else cursor=Math.max(0,Math.min(session.events.length-1,idx+direction));render();}

// Board filing by drag and drop; the per-pillar buttons remain for keyboard use.
const DRAG_TYPE='application/x-living-mystery-clue';
const dragged=e=>e.dataTransfer?.getData(DRAG_TYPE)||'';
document.addEventListener('dragstart',event=>{const c=event.target.closest?.('[data-drag-clue]'),o=event.target.closest?.('[data-drag-object]');
  if(c){event.dataTransfer.setData(DRAG_TYPE,c.dataset.dragClue);event.dataTransfer.effectAllowed='copy';}
  else if(o&&OBJECTS[o.dataset.dragObject]){event.dataTransfer.setData(DRAG_TYPE,`object:${o.dataset.dragObject}`);event.dataTransfer.effectAllowed='copy';}});
document.addEventListener('dragover',event=>{if(!event.dataTransfer?.types?.includes(DRAG_TYPE))return;const t=event.target.closest?.('[data-drop-person],[data-drop-pillar]');if(t){event.preventDefault();event.dataTransfer.dropEffect='copy';t.classList.add('drop-over');}});
document.addEventListener('dragleave',event=>{event.target.closest?.('[data-drop-person]')?.classList.remove('drop-over');});
document.addEventListener('drop',event=>{const t=event.target.closest?.('[data-drop-person]');let clue=dragged(event);
  // an object from Look around: examine it first (if not yet), then show what it is
  if(t&&clue.startsWith('object:')){const obj=clue.slice(7);event.preventDefault();event.stopPropagation();const c=OBJECTS[obj]?.clue;if(!c)return;
    const pid=t.dataset.dropPerson;document.querySelectorAll('.drop-over').forEach(el=>el.classList.remove('drop-over'));
    if(!session.world.player.evidence.some(e=>e.clue===c))act({type:'inspect',object:obj});
    if(session.world.player.evidence.some(e=>e.clue===c)&&session.world.npcs[pid]?.location===session.world.player.location){chat=pid;chosenClue=c;notebook='talk';presentClue(pid,c,'private');}
    return;}
  if(!t||!clue||!CLUES[clue])return;event.preventDefault();
  const pid=t.dataset.dropPerson;if(!PEOPLE[pid]||session.world.npcs[pid]?.location!==session.world.player.location)return;
  event.stopPropagation();document.querySelectorAll('.drop-over').forEach(el=>el.classList.remove('drop-over'));chat=pid;chosenClue=clue;presentClue(pid,clue,'private');});
document.addEventListener('drop',event=>{const t=event.target.closest?.('[data-drop-pillar]');const clue=dragged(event);if(!t||!clue||!CLUES[clue])return;event.preventDefault();
  const n=notesFor(t.dataset.suspect);n[clue]={pillar:t.dataset.dropPillar,polarity:n[clue]?.polarity||'supports'};saveBoardNotes();render();});
document.addEventListener('click',event=>{const b=event.target.closest('[data-do]');if(!b||b.disabled)return;const id=b.dataset.id,action=b.dataset.do;
  if(action==='mode'){
    if(b.dataset.value==='inspector'&&mode!=='inspector'){openModal(`<div class="eyebrow teal">SIMULATION INSPECTOR</div><h2>See behind the story.</h2><p>The inspector exposes the culprit, private beliefs, and offstage events. You can return to the investigation at any time.</p><button class="primary full" data-do="enter-inspector">Open inspector</button>`,'Open inspector with hidden case information');}
    else{mode=b.dataset.value;stopReplay();render();}return;
  }
  switch(action){
    case 'enter-inspector':$('#modal').close();mode='inspector';cursor=0;inspectorTab='world';render();break;
    case 'move':chat=null;act({type:'move',to:id});break;
    case 'inspect':act({type:'inspect',object:id});break;
    case 'wait':act({type:'wait',minutes:Number(b.dataset.minutes)||10});break;
    case 'history':historyPage=0;historyModal();break;
    case 'history-newer':historyPage++;historyModal();break;
    case 'history-older':historyPage--;historyModal();break;
    case 'action-group':actionGroup=id;render();break;
    case 'chat':if(characterBusy){toast('Wait for the reply or cancel it before changing conversations.');break;}actionGroup='talk';chat=id;chatSince={id,from:session.events.length};chosenClue=null;notebook='talk';render();break;
    case 'cancel-character':cancelCharacter();render();break;
    case 'close-chat':cancelCharacter();chat=null;act({type:'endConversation'});break;
    case 'ask':act({type:'ask',person:b.dataset.person,topic:b.dataset.topic});break;
    case 'present':if(chosenClue)act({type:'present',person:b.dataset.person,clue:chosenClue,tone:b.dataset.tone});break;
    case 'notebook':notebook=id;render();break;
    case 'village-view':villageView=id;render();break;
    case 'show-to':if(chat){chosenClue=id;presentClue(chat,id,'private');}break;
    case 'opening-page':openingModal(+id);break;
    case 'opening-done':markOpeningSeen();$('#modal').close();break;
    case 'opening-go':markOpeningSeen();$('#modal').close();act({type:'move',to:id});break;
    case 'opening-tour':markOpeningSeen();$('#modal').close();tourStep=0;renderTour();break;
    case 'opening':openingModal(0);break;
    case 'tour-next':tourStep++;if(tourStep>=TOUR.length)tourStep=-1;renderTour();break;
    case 'tour-end':tourStep=-1;renderTour();break;
    case 'inv-sort':invSort=id;render();break;
    case 'notebook-person':mode='reasoning';reasonSuspect=id;render();break;
    case 'reason-suspect':reasonSuspect=reasonSuspect===id?null:id;render();break;
    case 'talk-from-board':mode='game';chat=id;notebook='talk';render();break;
    case 'board-place':{const n=notesFor(b.dataset.suspect);n[b.dataset.clue]={pillar:b.dataset.pillar,polarity:n[b.dataset.clue]?.polarity||'supports'};saveBoardNotes();render();break;}
    case 'board-flip':{const n=notesFor(b.dataset.suspect)[b.dataset.clue];if(n){n.polarity=n.polarity==='supports'?'contradicts':'supports';saveBoardNotes();render();}break;}
    case 'board-remove':{delete notesFor(b.dataset.suspect)[b.dataset.clue];saveBoardNotes();render();break;}
    case 'claim-source':{const source=eventById(id);if(source?.playerText)openModal(`<h2>Recorded source · ${timeLabel(source.minute)}</h2>${paragraphs(source.playerText)}`,'Claim source');break;}
    case 'evkind':evidenceKind=id;render();break;
    case 'pin':act({type:'pin',clue:id});break;
    case 'pin-close':$('#modal').close();act({type:'pin',clue:id});break;
    case 'clue':clueModal(id);break;
    case 'accusation':accusationModal();break;
    case 'visit-bell':$('#modal').close();chat=null;
      // the walk may run asynchronously (director checks): open the case file once the detective has arrived
      {const post=officerPost();Promise.resolve(session.world.player.location===post?null:act({type:'move',to:post})).then(()=>{if(session.world.player.location===officerPost())accusationModal();});}break;
    case 'menu':menuModal();break;
    case 'start-generated':startKernelCase(b.dataset.file);break;
    case 'choose-case':chooseCaseModal();break;
    case 'start-case':{const fresh=createSession(17,id);cancelCharacter();stopReplay();session=fresh;resetRealized();boardNotes={};healthCache=null;cursor=null;chat=null;chosenClue=null;reasonSuspect=null;detailPanel=null;missedRevealed=false;sceneTransition=null;actionGroup='inspect';mode='game';persist();$('#modal').close();render();maybeOpening();break;}
    case 'generate-new':startGeneration(b.dataset.level||genLevel);break;
    case 'cancel-generation':cancelGeneration();break;
    case 'hint-more':hintState.level++;dlog('hint',{level:hintState.level,key:hintState.key});render();break;
    case 'flag-issue':flagIssueModal();break;
    case 'show-generation':renderGeneration();pollGeneration();break;

    case 'close-modal':$('#modal').close();break;
    case 'director':directorModal();break;
    case 'toggle-director':cancelCharacter();setDirectorEnabled(!directorEnabled());directorModal();render();break;
    case 'llm':llmModal();break;
    case 'export':exportFile();break;
    case 'import':$('#import-file').click();break;
    case 'restart-confirm':openModal(`<div class="eyebrow gold">RESTART THE LAST BELL</div><h2>Return to the beginning?</h2><p>Your current investigation will be replaced on this device. Export it first if you want to keep its history. This remains the same authored case.</p><div class="menu-actions"><button class="soft-button" data-do="export">Export current investigation</button><button class="primary" data-do="restart">Restart from 08:00</button></div>`,'Restart this investigation');break;
    case 'restart':if(String(session.world.caseId).startsWith('mk-')){const id=session.world.caseId;$('#modal').close();restartKernelCase(id);break;}missedRevealed=false;detailPanel=null;sceneTransition=null;actionGroup='inspect';session=createSession(session.seed,session.world.caseId??'last-bell');healthCache=null;cursor=null;chat=null;resetRealized();boardNotes={};reasonSuspect=null;stopReplay();persist();$('#modal').close();render();toast('A new morning in Bellweather.');break;
    case 'close-detail':detailPanel=null;render();break;
    case 'reveal-missed':missedRevealed=true;render();break;
    case 'hide-missed':missedRevealed=false;detailPanel=null;render();break;
    case 'event':detailPanel='event';selectEvent(b.dataset.index);break;
    case 'person':if(PEOPLE[id]){if(inspectorTab==='timeline')inspectorTab='world';detailPanel='character';person=id;personTab='profile';render();}break;
    case 'person-tab':personTab=id;render();break;
    case 'filter-person':actorFilter=id;typeFilter='all';query='';inspectorTab='timeline';render();break;
    case 'inspector-tab':inspectorTab=id;render();break;
    case 'first':{const f=filteredEvents()[0];selectEvent(f?f.index:0);break;}
    case 'previous':step(-1);break;
    case 'next':step(1);break;
    case 'live':stopReplay();cursor=null;render();break;
    case 'forecast':forecast=projectForward();render();break;
    case 'play-replay':if(timer){stopReplay();render();}else{const f=filteredEvents()[0];if(cursor===null||cursor>=session.events.length-1)cursor=f?f.index:0;timer=setInterval(()=>{const events=filteredEvents(),idx=selectedIndex(),next=events.find(e=>e.index>idx);if(next)cursor=next.index;else stopReplay();render();},1300);render();}break;
  }
});
// Enter sends a free-text question; Shift+Enter starts a new line.
document.addEventListener('keydown',event=>{if(event.target?.id==='character-question'&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('#character-form')?.requestSubmit?.();}});
document.addEventListener('submit',event=>{event.preventDefault();if(event.target.id==='character-form'){characterDraft=$('#character-question').value;if(chat&&characterDraft.trim())runCharacter(chat,characterDraft);}else if(event.target.id==='command-form'){const input=$('#command');if(input.value.trim())act(parseCommand(input.value,session));$('#command')?.focus();}else if(event.target.id==='note-form'){const val=$('#note').value;if(val.trim())act({type:'note',text:val});}else if(event.target.id==='llm-form'){const m=$('#modal');const endpoint=(m.querySelector('[name=endpoint]')?.value||'').trim();const reasoning=!!m.querySelector('[name=reasoning]')?.checked;const enabled=reasoning;setLlmConfig({endpoint,enabled,reasoning});cancelCharacter();stopRealizing();const active=llmActive();m.close();render();toast(active?'AI character reasoning enabled.':enabled?'Saved — but add a valid proxy URL (http://…) to turn it on.':'Scripted mode enabled. Responses are immediate; saved dialogue is retained.');}else if(event.target.id==='issue-form'){const note=$('#issue-note')?.value??'';$('#modal').close();flagIssue(note);
  }else if(event.target.id==='accusation-form'){const f=new FormData(event.target);$('#modal').close();submitAccusation({type:'accuse',suspect:f.get('suspect'),method:f.get('method'),motive:f.get('motive'),evidence:f.getAll('evidence')});}});
document.addEventListener('change',event=>{const el=event.target;if(el.id==='case-filter'){caseFilter=el.value;const list=$('#case-list');if(list&&caseItem)list.innerHTML=caseListHTML(caseItems,caseItem);return;}if(el.id==='world-perspective'){perspective=el.value;detailPanel=null;render();}else if(el.id==='present-clue'){chosenClue=el.value;render();}else if(el.id==='character-select'){person=el.value;render();}else if(el.id==='actor-filter'){actorFilter=el.value;render();}else if(el.id==='type-filter'){typeFilter=el.value;render();}else if(el.id==='clock-filter'){includeClock=el.checked;render();}else if(el.id==='import-file'&&el.files[0]){const file=el.files[0];if(file.size>20_000_000){toast('Choose a save smaller than 20 MB.');return;}file.text().then(text=>{const imported=importDialogueSave(text);session=imported.session;boardNotes=imported.boardNotes;reasonSuspect=null;missedRevealed=false;detailPanel=null;sceneTransition=null;actionGroup='inspect';healthCache=null;cursor=null;chat=null;resetRealized();for(const [id,r]of imported.audit){dialogueAudit.set(id,r);realized.set(id,`${actorName(eventById(id).actor)}\n"${r.text}"`);}stopReplay();persist();$('#modal').close();render();toast('Saved investigation restored, with its full history.');}).catch(err=>toast(`Could not import: ${err.message}`));el.value='';}});
document.addEventListener('input',event=>{if(event.target.id==='character-question'){characterDraft=event.target.value;}else if(event.target.id==='history-search'){query=event.target.value;$('#event-list').innerHTML=eventList();followTraceCursor();}else if(event.target.id==='history-cursor'){
  // Keep the range input itself mounted while dragging so pointer capture is preserved.
  stopReplay();cursor=Number(event.target.value);const w=selectedWorld(),e=session.events[selectedIndex()];
  if($('#event-detail'))$('#event-detail').innerHTML=eventDetail();
  if($('#character-panel'))$('#character-panel').innerHTML=`<button class="subtle-button full" data-do="close-detail">Close details ×</button>${detailPanel==='event'?eventDetail():characterPanel(w)}`;
  $('.replay-state').innerHTML=`<span class="past-dot"></span><strong>${timeLabel(e.minute)}</strong><span class="replay-what">${esc(actorName(e.actor))} — ${esc(clip(e.title,54))}</span>`;
  $('.replay-slider>span').textContent=`${selectedIndex()+1} / ${session.events.length} events${selectedIndex()<entryEventIndex()?' · before you arrived':''}`;
  $('.replay-bar>.soft-button').disabled=false;
  $('.play-replay').textContent='▶';$('.play-replay').setAttribute('aria-label','Play recorded history');
  $('.inspector-summary>div:nth-child(2)>strong').textContent=Object.values(w.npcs).reduce((n,a)=>n+a.beliefs.length,0);
  if($('#event-list')){$('#event-list').innerHTML=eventList();followTraceCursor();}
  if($('#milestones'))$('#milestones').innerHTML=milestones();
  if($('.world-panel')){const wp=$('.world-panel'),_st=wp.scrollTop,_o={};for(const d of (wp.querySelectorAll?wp.querySelectorAll('details[data-open-key]'):[]))_o[d.dataset.openKey]=d.open;wp.outerHTML=inspectorTab==='missed'?missedPanel(w):worldPanel(w);const _np=$('.world-panel');if(_np){_np.scrollTop=_st;for(const d of (_np.querySelectorAll?_np.querySelectorAll('details[data-open-key]'):[]))if(d.dataset.openKey in _o)d.open=_o[d.dataset.openKey];}}
}});
$('#modal').addEventListener('click',event=>{if(event.target===$('#modal')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
render();globalThis.setTimeout?.(()=>maybeOpening(),0);if(saveError)toast('A previous save could not be loaded. The original remains until your next action; you are starting a fresh case.');
// Best-effort async upgrade to the IndexedDB copy. It holds the full AI reasoning trace even when
// the synchronous localStorage mirror had to drop it under quota (or was cleared). No-op without
// IndexedDB. Written together with localStorage in persist(), so this only ever adds detail.
(async()=>{
  const full=await idbGet(storageKey);
  if(typeof full!=='string'||!full)return;
  let imported;try{imported=importDialogueSave(full);}catch{return;}
  const richer=!hadLocalSave
    ||imported.session.events.length>session.events.length
    ||(imported.session.events.length===session.events.length&&imported.audit.size>dialogueAudit.size);
  if(!richer)return;
  session=imported.session;boardNotes=imported.boardNotes;syncCase();
  resetRealized();
  for(const [id,r]of imported.audit){dialogueAudit.set(id,r);const e=session.events.find(ev=>ev.id===id);if(e)realized.set(id,`${actorName(e.actor)}\n"${r.text}"`);}
  render();
})();

// A generation keeps running in the background; after a reload, offer to reopen its progress.
setTimeout(async()=>{try{const r=await fetch(`${GENERATOR}/jobs/current`,{cache:'no-store'});if(!r.ok)return;const j=await r.json();
  if(j?.status==='running'){genJob=j;genEvents=[];genNext=0;toast(`Still generating “${j.title}” — open Menu → Choose a case to watch it.`);pollGeneration();}}catch{}},400);

globalThis.window?.addEventListener?.('error',e=>{if(e?.message)dlog('js_error',{message:e.message,source:e.filename,line:e.lineno,stack:String(e.error?.stack??'').slice(0,1500)});});
globalThis.window?.addEventListener?.('unhandledrejection',e=>dlog('js_error',{message:String(e?.reason?.message??e?.reason),stack:String(e?.reason?.stack??'').slice(0,1500)}));
globalThis.window?.addEventListener?.('pagehide',dlogFlush);

// Asset failures must never prevent play or remove accessible text labels.
document.addEventListener('error',event=>{if(event.target?.classList?.contains('game-art'))event.target.hidden=true;},true);
