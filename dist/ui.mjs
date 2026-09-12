import {deliberateWorld} from './autonomy-turn.mjs';
import {directorEnabled,setDirectorEnabled,commitDirectedTurn} from './director-turn.mjs';
import {prepareCharacterTurn,proposeCharacterTurn,applyCharacterTurn} from './character-turn.mjs';
import {ART} from './art.mjs';
import {claimsAt,claimRelations} from './claims.mjs';
import {exportDialogueSave,importDialogueSave,dialogueEntities,normalizeBoardNotes} from './dialogue-save.mjs';
import {perspectiveAt,missedAt} from './inspector.mjs';
import {caseTables,CASE_OPTIONS,SUSPECTS,PILLARS,copy,createSession,dispatch,followupOptions,playerClaims,parseCommand,playerView,worldAt,timeLabel,distance,diagnostics,caseHealth,exportSession,importSession,generateCase} from './engine.mjs';
import {llmActive,llmConfig,setLlmConfig} from './llm.mjs';

const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storageKey='living-mystery.bellweather.v1';
const BOARD_KEY='living-mystery.board.v1';
let session,loadedAudit=new Map(),loadedBoard={},saveError=false;
try{const saved=localStorage.getItem(storageKey);if(saved){const restored=importDialogueSave(saved);session=restored.session;loadedAudit=restored.audit;loadedBoard=restored.boardNotes;if(!restored.hasBoard){try{loadedBoard=normalizeBoardNotes(session,JSON.parse(localStorage.getItem(BOARD_KEY)));}catch{}}}else session=createSession(17);}catch{session=createSession(17);saveError=true;}
let {CASE,LOCATIONS,PEOPLE,CLUES,OBJECTS}=caseTables(session);
function syncCase(){({CASE,LOCATIONS,PEOPLE,CLUES,OBJECTS}=caseTables(session));}
let perspective='world',detailPanel=null,missedRevealed=false;
// Player-built reasoning board: { [suspect]: { [clue]: {pillar,polarity} } }.
// Saved in the investigation envelope, independently of simulation events.
let boardNotes=loadedBoard;
function saveBoardNotes(){persist();}
let actionGroup='inspect',sceneTransition=null,historyPage=0;
let mode='game',notebook='evidence',evidenceKind='All',reasonSuspect=null,chat=null,chosenClue=null,inspectorTab='world',person='clara',personTab='profile',cursor=null,typeFilter='all',actorFilter='all',query='',includeClock=false,timer=null,healthCache=null;
// Persisted presentation audit is separate from deterministic engine events.
const dialogueAudit=loadedAudit;
const realized=new Map([...dialogueAudit].map(([id,r])=>[id,`${actorName(session.events.find(e=>e.id===id).actor)}\n"${r.text}"`]));
let characterBusy=false,characterController=null,characterEpoch=0,characterDraft='',characterPending=null,directorPending=false,autonomyPending=false;
function cancelCharacter(){characterEpoch++;characterController?.abort();characterController=null;characterBusy=false;characterPending=null;directorPending=false;autonomyPending=false;}
const pending=new Set();let realizeGen=0;
// When AI voice is on, a line we've dispatched for restyling shows a brief
// placeholder until it lands (never the written line first); once voiced, the
// written line is available on hover. Lines we never dispatched (history,
// AI off) just show the authored text.
function displayText(e){if(realized.has(e.id))return realized.get(e.id);if(pending.has(e.id))return `${actorName(e.actor)}\n“…”`;return e.text;}
function authoredLineOnly(e){return e.text.replace(/^[^\n]*\n/,'');}
function resetRealized(){cancelCharacter();realized.clear();dialogueAudit.clear();pending.clear();realizeGen++;}
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
function artifactArt(id,kind='artifact-art'){if(session.world.caseId)return '';return artImage(ART.artifacts[id],kind);}
function actorName(id){return PEOPLE[id]?.name??(id==='player'?'You':id==='world'?'World':'Simulation');}
function placeName(id){return LOCATIONS[id]?.name??(id==='transit'?'In transit':id==='drawer'?'Vestry · deed drawer':id==='silas'?'Carried by Silas':id??'—');}
function eventById(id){return session.events.find(e=>e.id===id);}
function selectedIndex(){return cursor===null?session.events.length-1:Math.min(cursor,session.events.length-1);}
function selectedWorld(){return cursor===null?session.world:worldAt(session,selectedIndex());}
function selectEvent(index){cursor=Number(index);if(cursor<0||cursor>=session.events.length)cursor=null;stopReplay();render();}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),4200);}
function persist(){try{localStorage.setItem(storageKey,exportDialogueSave(session,dialogueAudit,boardNotes));saveError=false;localStorage.removeItem?.(BOARD_KEY);}catch{saveError=true;toast('This browser could not save the investigation. Use Export to keep a copy.');}}
function act(action){if(characterBusy){toast('Wait for the reply or cancel it before acting.');return;}if(llmActive()&&llmConfig().reasoning&&['ask','present'].includes(action.type)){const label=action.type==='present'?`I'd like to discuss ${CLUES[action.clue]?.title?.toLowerCase()}.${action.tone==='press'?' If you refuse, I will expose your private affairs.':''}`:([...topicsFor(action.person),...followupOptions(session,action.person)].find(([topic])=>topic===action.topic)?.[1]??action.topic??'Tell me about last night.');runCharacter(action.person,label,action);return;}if(directorEnabled()||(llmActive()&&llmConfig().reasoning&&session.world.flags.lifeVersion)){runDirectedAction(action);return;}stopReplay();cursor=null;try{const from=session.world.player.location;dispatch(session,action);sceneTransition=from!==session.world.player.location?{from,to:session.world.player.location}:null;if(sceneTransition){chat=null;actionGroup='inspect';}healthCache=null;persist();render();if(sceneTransition){$('.scene-heading')?.focus({preventScroll:true});}}catch(error){toast(`The action could not be completed: ${error.message}`);}}
async function runDirectedAction(action){
  stopReplay();cursor=null;const target=session,epoch=++characterEpoch,from=session.world.player.location,useDirector=directorEnabled();
  characterController=new AbortController();characterBusy=true;directorPending=false;
  try{
    const trial=copy(target);
    if(llmActive()&&llmConfig().reasoning&&trial.world.flags.lifeVersion){autonomyPending=true;render();await deliberateWorld(trial,{signal:characterController.signal});if(epoch!==characterEpoch||session!==target)return;autonomyPending=false;}
    dispatch(trial,action);
    const result=useDirector?await commitDirectedTurn(target,trial,{signal:characterController.signal,onChecking:()=>{if(epoch===characterEpoch&&session===target){directorPending=true;render();}}}):{status:'not_needed'};
    if(!useDirector&&epoch===characterEpoch&&session===target){target.world=trial.world;target.events=trial.events;}
    if(epoch!==characterEpoch||session!==target)return;
    if(!['verified','not_needed','cancelled'].includes(result.status))toast(`${result.reason}. Turn deferred; disable Z3 checks to continue scripted play.`);
    sceneTransition=from!==session.world.player.location?{from,to:session.world.player.location}:null;
    if(sceneTransition){chat=null;actionGroup='inspect';}healthCache=null;persist();
  }catch(error){if(epoch===characterEpoch)toast(error.message);}
  finally{if(epoch===characterEpoch){characterBusy=false;characterController=null;directorPending=false;autonomyPending=false;render();}}
}
async function runCharacter(person,text,action=null){
  if(characterBusy)return;
  if(!llmActive()||!llmConfig().reasoning){toast('Enable character reasoning in AI settings to ask in your own words.');return;}
  let ticket;try{ticket=prepareCharacterTurn(session,{person,text,action});}catch(error){toast(error.message);return;}
  stopReplay();cursor=null;const target=session,epoch=++characterEpoch,useDirector=directorEnabled();
  characterController=new AbortController();characterBusy=true;characterPending={person,text};renderVoiceResult();
  try{
    const result=await proposeCharacterTurn(ticket,{signal:characterController.signal});
    if(epoch!==characterEpoch||session!==target)return;
    const candidate=copy(session);
    const applied=applyCharacterTurn(candidate,ticket,result);
    if(!applied.cancelled){
      if(llmActive()&&llmConfig().reasoning&&candidate.world.flags.lifeVersion){autonomyPending=true;render();await deliberateWorld(candidate,{signal:characterController.signal});if(epoch!==characterEpoch||session!==target)return;autonomyPending=false;}
      const checked=useDirector?await commitDirectedTurn(target,candidate,{signal:characterController.signal,onChecking:()=>{if(epoch===characterEpoch&&session===target){directorPending=true;render();}}}):{status:'not_needed'};
      if(epoch!==characterEpoch||session!==target)return;
      if(!['verified','not_needed'].includes(checked.status)){healthCache=null;persist();toast(checked.reason??'Turn cancelled');return;}
      if(!useDirector){target.world=candidate.world;target.events=candidate.events;}
    }
    if(!applied.cancelled){characterDraft='';if($('#character-question'))$('#character-question').value='';healthCache=null;persist();if(result.proposal?.engagement==='end')chat=null;if(applied.fallback)toast('Using an authored response because the AI turn could not be validated.');}
  }catch(error){if(epoch===characterEpoch)toast(`The character turn was not applied: ${error.message}`);}
  finally{if(epoch===characterEpoch){characterBusy=false;characterController=null;characterPending=null;autonomyPending=false;directorPending=false;renderVoiceResult();}}
}
function characterComposer(){return llmActive()&&llmConfig().reasoning?`<form id="character-form" class="character-composer"><label for="character-question">Speak in your own words</label><textarea id="character-question" maxlength="1200" rows="2" placeholder="Ask a question or challenge an account…" ${characterBusy?'disabled':''}>${esc(characterDraft)}</textarea><button class="primary" ${characterBusy?'disabled':''}>Send</button></form>`:'';}
// While a character turn is in flight, show the player's question and a spinner
// in the main feed (below the question, before the reply arrives).
function pendingEntries(){
  if(autonomyPending)return '<article class="journal-entry pending-turn"><div class="journal-prose character-status"><span role="status">A town character is considering their next activity…</span><button data-do="cancel-character" class="subtle-button">Cancel</button></div></article>';
  if(directorPending)return '<article class="journal-entry pending-turn"><div class="journal-prose character-status"><span class="spinner" aria-hidden="true"></span><span role="status">World Director is checking the turn…</span><button class="subtle-button" data-do="cancel-character">Cancel</button></div></article>';
  if(!characterBusy||!characterPending)return '';
  const {person,text}=characterPending;
  return `<article class="journal-entry"><div class="journal-meta"><span>${timeLabel(session.world.minute)}</span><span>YOU</span></div><div class="journal-prose"><p>${esc(text)}</p></div></article><article class="journal-entry spoken pending-turn"><div class="journal-meta"><span>${esc(PEOPLE[person].name)}</span></div><div class="journal-prose character-status"><span class="spinner" aria-hidden="true"></span><span role="status">considering…</span><button type="button" class="subtle-button" data-do="cancel-character">Cancel</button></div></article>`;
}
function getHealth(){if(!healthCache||healthCache.eventCount!==session.events.length)healthCache=diagnostics(session);return healthCache;}
function paragraphs(text){return String(text).split('\n\n').map(p=>`<p>${esc(p).replaceAll('\n','<br>')}</p>`).join('');}

function header(){return `<header class="topbar">
  <button class="brand" data-do="mode" data-value="game" aria-label="Return to the investigation"><span class="brand-mark">L<span>M</span></span><span><strong>Living Mystery</strong><small>${esc(CASE.title)}</small></span></button>
  <nav class="mode-switch" aria-label="Application mode"><button class="${mode==='game'?'active':''}" data-do="mode" data-value="game" aria-pressed="${mode==='game'}">Investigation</button><button class="${mode==='reasoning'?'active':''}" data-do="mode" data-value="reasoning" aria-pressed="${mode==='reasoning'}">Reasoning</button><button class="${mode==='inspector'?'active':''}" data-do="mode" data-value="inspector" aria-pressed="${mode==='inspector'}">Inspector <span class="small-symbol">⌘</span></button></nav>
  <div class="top-tools"><div class="world-time"><strong>${timeLabel(session.world.minute)}</strong><span>${CASE.date}</span></div><button class="icon-button" data-do="menu" aria-label="Save, import, restart, and help">•••</button></div>
</header>`;}

function game(){chat??=session.world.player.conversation??null;const v=playerView(session);if(chat&&!v.people.some(p=>p.id===chat))chat=null;return `<div class="game-shell">
  <div class="left-col">
  <aside class="village-panel panel" aria-label="Village navigation"><div class="panel-heading"><span class="eyebrow">BELLWEATHER</span><span class="meta">6 places</span></div><h2 class="section-heading">The village</h2><nav class="places">${Object.entries(LOCATIONS).map(([id,p])=>`<button data-do="move" data-id="${id}" class="place ${v.location===id?'current':''}" ${v.status==='solved'?'disabled':''} aria-current="${v.location===id?'location':'false'}">${locationArt(id)}<span class="place-num">${p.glyph}</span><span><strong>${p.name}</strong><small>${v.location===id?'You are here':`${distance(v.location,id)} min walk`}</small></span>${v.location===id?'<span class="here-mark" aria-hidden="true"></span>':''}</button>`).join('')}</nav>
  <div class="side-rule"></div><div class="panel-heading"><span class="eyebrow">WITHIN EARSHOT</span><span class="meta">${v.people.length} here</span></div><div class="people-here">${v.people.map(p=>`<button class="person-row ${chat===p.id?'selected':''}" data-do="chat" data-id="${p.id}">${avatar(p.id)}<span><strong>${p.name}</strong><small>${p.role}</small></span><span class="chevron">›</span></button>`).join('')||'<p class="muted quiet">No one else is here.</p>'}</div>
  <div class="village-footer"><button class="subtle-button" data-do="wait">◷ &nbsp; Wait 10 minutes</button><p class="meta">Time passes when you act.<br>Read and think at your own pace.</p></div></aside>
  <section class="action-area action-dock" aria-label="Available actions">${v.status==='solved'?`<div class="solved-actions"><span class="gold">✓ &nbsp; Your evidence supported the accusation.</span><button class="primary" data-do="mode" data-value="inspector">Explore the full history</button></div>`:gameActions(v)}</section>
  ${llmActive()&&llmConfig().reasoning?'':`<details class="command-disclosure"><summary>Type a command (optional)</summary><form class="command-line" id="command-form"><span aria-hidden="true">›</span><label for="command" class="sr-only">Type a supported game command</label><input id="command" name="command" autocomplete="off" placeholder="Try ‘go manor’ or ‘ask Clara about alibi’" ${v.status==='solved'?'disabled':''}><button type="submit" aria-label="Run command">↵</button></form></details>`}
  </div>
  <main class="story-panel panel"><div class="scene-heading" tabindex="-1">${locationArt(v.location,'scene-art')}${sceneTransition?`<div class="scene-transition" role="status">${esc(placeName(sceneTransition.from))} → <strong>${esc(v.scene.name)}</strong> · ${timeLabel(v.minute)}</div>`:''}<div class="eyebrow gold">THE LAST BELL <span class="divider">/</span> ${v.status==='solved'?'CASE CLOSED':'AN INVESTIGATION'}</div><h1>${v.status==='solved'?'A case made.':v.scene.name}</h1><p class="scene-atmosphere">${v.status==='solved'?'The village will remember how you found the truth.':v.scene.atmosphere}</p><details class="scene-description"><summary>Look at the scene</summary>${paragraphs(v.scene.description)}</details></div>
  <div class="recent-heading"><span class="eyebrow">RECENT ACTIVITY · OLDEST TO NEWEST</span><button class="subtle-button" data-do="history">Full history (${v.transcript.length}) ↗</button></div>
  <div class="journal" id="journal" role="log" aria-label="Recent investigation activity" aria-live="polite">${visibleTranscript(v.transcript).slice(-5).map(journalEntry).join('')}${pendingEntries()}</div>
  </main>
  <aside class="side-panel panel" aria-label="Your notebook">
  <div class="notebook-region"><div class="panel-heading"><span class="eyebrow">YOUR CASE FILE</span><span class="meta">${v.evidence.length} entries</span></div><h2 class="section-heading">The notebook</h2><div class="small-tabs" role="tablist" aria-label="Notebook views">${[['evidence','Evidence'],['people','People'],['notes','Hypotheses']].map(([id,label])=>`<button role="tab" aria-selected="${notebook===id}" class="${notebook===id?'active':''}" data-do="notebook" data-id="${id}">${label}</button>`).join('')}</div><div class="notebook-content">${notebookContent(v)}</div><div class="notebook-footer"><span class="meta">${v.pins.length} pinned for your case</span><button class="primary full" data-do="accusation">${v.status==='solved'?'Review your accusation':'Make an accusation'} <span>↗</span></button><span class="save-note">${saveError?'Not saved · export a copy':'Saved on this device'}</span></div></div>
  </aside>
</div>`;}

function journalEntry(e){const voiced=realized.has(e.id);const tip=voiced?` title="Written line: ${esc(authoredLineOnly(e))}"`:'';return `<article class="journal-entry ${e.kind==='speech'?'spoken':''} ${e.kind==='evidence'?'clue-found':''} ${e.kind==='arrival'?'scene-entry':''}"><div class="journal-meta"><span>${timeLabel(e.minute)}</span><span>${e.kind==='arrival'?'SCENE CHANGE':e.kind==='speech'?esc(actorName(e.actor)):esc(typeNames[e.kind]??'Observation')}${voiced?(dialogueAudit.get(e.id)?.status==='accepted'?' · AI delivery':' · Written fallback'):''}</span></div><div class="journal-prose"${tip}>${paragraphs(displayText(e))}</div></article>`;}
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
function presentButton(person,tone,label){const done=actionDone({type:'present',person,clue:chosenClue,tone});return `<button class="soft-button ${tone==='press'?'danger-soft':''} ${done?'action-done':''}" data-do="present" data-person="${person}" data-tone="${tone}"><span>${label}${doneLabel(done)}</span></button>`;}

function gameActions(v){return `<nav class="small-tabs action-tabs" aria-label="Action groups">${[['inspect','Inspect'],['talk',`Talk (${v.people.length})`],['wait','Wait']].map(([id,label])=>`<button data-do="action-group" data-id="${id}" class="${actionGroup===id?'active':''}" aria-pressed="${actionGroup===id}">${label}</button>`).join('')}</nav>${actionGroup==='talk'?(chat?conversation(v):`<p class="meta">Choose someone here to see what you can ask.</p><div class="people-here">${v.people.map(p=>`<button class="person-row present-person" data-do="chat" data-id="${p.id}">${avatar(p.id)}<span><strong>${p.name}</strong><small>View conversation options →</small></span></button>`).join('')||'<p class="muted">No one is here. Travel or wait for someone to arrive.</p>'}</div>`):actionGroup==='wait'?`<p class="meta">Let the village carry on. People may arrive or leave.</p><div class="two-actions">${[5,10,30].map(n=>`<button class="soft-button" data-do="wait" data-minutes="${n}">Wait ${n} min</button>`).join('')}</div>`:`<div class="panel-heading"><span class="meta">Choose something to examine · 3 min each</span></div><div class="object-actions">${v.scene.objects.map(id=>{const done=actionDone({type:'inspect',object:id});return `<button class="object-button ${done?'action-done':''}" data-do="inspect" data-id="${id}">${artifactArt(OBJECTS[id].clue)}<span>${OBJECTS[id].label}</span><small>${OBJECTS[id].description}</small>${doneLabel(done)}</button>`;}).join('')||'<p class="meta">Nothing to inspect here. Talk to someone nearby or choose another place in the village.</p>'}</div>`}`;}
const dialogueTopics={bell:[['case','What makes a convincing case?'],['night','Can you give me a lead?'],['sightings','What have you observed around town today?']],clara:[['alibi','Where were you last night?'],['accounts','What can you tell me about Edmund’s accounts?'],['sightings','What have you observed around town today?']],rowan:[['night','Tell me about the coat and your whereabouts.'],['sightings','What have you observed around town today?']],silas:[['alibi','Where were you last night?'],['accounts','Explain the account discrepancies.'],['sightings','What have you observed around town today?']],ada:[['night','What did you see last night?'],['sightings','What have you observed around town today?']],iris:[['night','What do the medical findings and your visit establish?'],['sightings','What have you observed around town today?']]};

function topicsFor(id){return session.world.caseId?[['night','What is your account of last night?'],['accounts','What can you tell me about the estate dispute?'],['sightings','What have you observed today?']]:dialogueTopics[id];}
function conversation(v){const p=PEOPLE[chat];if(!v.evidence.some(e=>e.clue===chosenClue))chosenClue=v.evidence[0]?.clue??null;return `<div class="conversation-head">${avatar(chat)}<span><strong>${p.name}</strong><small>${p.role}</small></span><button class="icon-button close-small" data-do="close-chat" aria-label="Close conversation">×</button></div><div class="dialogue-options">${[...topicsFor(chat),...followupOptions(session,chat)].map(([topic,label])=>{const done=actionDone({type:'ask',person:chat,topic});return `<button class="text-action ${done?'action-done':''}" data-do="ask" data-person="${chat}" data-topic="${topic}"><span>${label}${doneLabel(done)}</span><span>3 min</span></button>`;}).join('')}</div>${v.evidence.length?`<div class="present-controls"><label for="present-clue">Show evidence · 4 min</label><select id="present-clue">${v.evidence.map(e=>`<option value="${e.clue}" ${e.clue===chosenClue?'selected':''}>${e.title}</option>`).join('')}</select>${chat==='clara'&&['letter','record'].includes(chosenClue)?`<div class="two-actions">${presentButton('clara','private','Offer discretion')}${presentButton('clara','press','Threaten exposure')}</div>`:`${presentButton(chat,'private','Present & discuss')}`}</div>`:'<p class="meta">Discover evidence to present it in conversation.</p>'}${characterComposer()}`;}

const humanLabel=v=>LOCATIONS[v]?.name??PEOPLE[v]?.name??String(v).replaceAll('_',' ');
const NIGHT_START=1255,NIGHT_END=1290;
const PILLAR_ABBR={motive:'Mot',means:'Mns',opportunity:'Opp',alibi:'Alb'};
const clip=(t,n)=>{t=String(t);return t.length>n?t.slice(0,n-1)+'…':t;};
function notesFor(id){return boardNotes[id]||(boardNotes[id]={});}
// Objective, fair aid: factual clashes in the record (does NOT judge guilt).
function objectiveConflicts(id,claims){const rels=claimRelations(claims).filter(r=>r.kind==='conflicts'&&(r.left.subject===id||r.right.subject===id));if(!rels.length)return '';return rels.map(r=>`<p>“${esc(CLUES[r.left.clue]?.title??r.left.attribution)}” vs “${esc(CLUES[r.right.clue]?.title??r.right.attribution)}” — ${esc(humanLabel(r.left.value))} vs ${esc(humanLabel(r.right.value))}.</p>`).join('');}
function suspectStripCard(id,selected){
  const notes=boardNotes[id]||{},acq=new Set(session.world.player.evidence.map(e=>e.clue));
  const placed=Object.keys(notes).filter(c=>acq.has(c));
  const sup=placed.filter(c=>notes[c].polarity==='supports').length,con=placed.length-sup;
  const filled=new Set(placed.map(c=>notes[c].pillar));
  const chips=PILLARS.map(([k])=>`<span class="pstat ${filled.has(k)?'s-filled':'s-open'}">${PILLAR_ABBR[k]}</span>`).join('');
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
  const span=NIGHT_END-NIGHT_START,px=t=>x0+((Math.max(NIGHT_START,Math.min(NIGHT_END,t))-NIGHT_START)/span)*w;
  const death=claims.find(c=>c.predicate==='death_time'&&c.interval&&!c.superseded)?.interval??null;
  const places=placementsFor(id,claims);
  const trackH=Math.max(42,24+places.length*22+8);
  const ticks=[1260,1270,1280,1290].map(t=>`<span class="tl-tick" style="left:${px(t)-x0}px">${timeLabel(t)}</span>`).join('');
  const band=death?`<div class="tl-death" style="left:${px(death.start)-x0}px;width:${Math.max(4,px(death.end)-px(death.start))}px"></div>`:'';
  const bars=places.map((c,i)=>{const left=px(c.interval.start)-x0,wd=Math.max(10,px(c.interval.end)-px(c.interval.start)),scene=c.value==='manor',label=`${humanLabel(c.value)} · ${timeLabel(c.interval.start)}–${timeLabel(c.interval.end)}`;return `<div class="tl-bar ${scene?'scene':'away'}${c.superseded?' sup':''}${wd<52?' point':''}" style="left:${left}px;width:${wd}px;top:${24+i*22}px" title="${esc(label)}">${wd<52?'':esc(humanLabel(c.value))}</div>`;}).join('')||'<span class="tl-none">No recorded whereabouts yet.</span>';
  return `<div class="board-timeline" style="left:${x0}px;top:${y0}px;width:${w}px;height:${h}px"><div class="tl-head">The night · ${death?'death window highlighted in red':'medical window not yet established'}</div><div class="tl-track" style="height:${trackH}px">${band}${bars}</div><div class="tl-axis">${ticks}</div></div>`;
}
function workspaceView(id,claims){
  const notes=boardNotes[id]||{},ev=session.world.player.evidence,acq=[...new Set(ev.map(e=>e.clue))];
  const placed=acq.filter(c=>notes[c]),unplaced=acq.filter(c=>!notes[c]);
  const padX=30,colW=248,verdW=300,verdH=80,pillarH=54,cardW=214,cardH=134,gap=16,cardTop=252;
  const boardW=padX*2+PILLARS.length*colW,colCenter=i=>padX+i*colW+colW/2,verdCX=boardW/2,verdBottom=18+verdH;
  const byPillar=Object.fromEntries(PILLARS.map(([k])=>[k,placed.filter(c=>notes[c].pillar===k)]));
  const maxCards=Math.max(1,...PILLARS.map(([k])=>byPillar[k].length||1));
  const nPlace=placementsFor(id,claims).length;
  const timelineTop=cardTop+maxCards*(cardH+gap)+18,timelineH=Math.max(42,24+nPlace*22+8)+58,boardH=timelineTop+timelineH+26;
  let paths='',chips='';const cluePos={};
  const pillarNodes=PILLARS.map(([k,label],i)=>{const cx=colCenter(i),n=byPillar[k].length,col=n?'#c8b48c':'#6a5a3f';paths+=`<path class="edge2" stroke="${col}" d="M${cx} 150 Q${(cx+verdCX)/2} ${(150+verdBottom)/2-8} ${verdCX} ${verdBottom}"/>`;return `<div class="pillar-node s-${n?'filled':'open'}" style="left:${cx-90}px;top:150px">${label}<span>${n?`${n} card${n===1?'':'s'}`:'empty'}</span></div>`;}).join('');
  const cardsHtml=PILLARS.map(([k],i)=>{const cx=colCenter(i),list=byPillar[k];if(!list.length)return `<div class="board-empty" style="left:${cx-cardW/2}px;top:${cardTop}px;width:${cardW}px">Place evidence here from the tray below.</div>`;return list.map((c,r)=>{const pol=notes[c].polarity,x=cx-cardW/2,y=cardTop+r*(cardH+gap);cluePos[c]={cx,cy:y+cardH/2};paths+=`<path class="edge2 e-${pol}" d="M${cx} ${y} L${cx} ${150+pillarH}"/>`;const src=ev.find(z=>z.clue===c);return `<article class="board-card e-${pol}" style="left:${x}px;top:${y}px;width:${cardW}px;min-height:${cardH}px"><span class="pin p-${pol}"></span><strong>${esc(CLUES[c].title)}</strong><p>${esc(clip(src?.text??CLUES[c].text,88))}</p><div class="card-controls"><button class="mini pol-${pol}" data-do="board-flip" data-suspect="${id}" data-clue="${c}">${pol==='supports'?'Supports':'Contradicts'} ⇄</button>${src?`<button class="mini" data-do="claim-source" data-id="${src.eventId}" title="Read source">↗</button>`:''}<button class="mini danger" data-do="board-remove" data-suspect="${id}" data-clue="${c}" title="Return to tray">✕</button></div></article>`;}).join('');}).join('');
  for(const rl of claimRelations(claims).filter(r=>r.kind==='conflicts'&&(r.left.subject===id||r.right.subject===id))){const a=cluePos[rl.left.clue],b=cluePos[rl.right.clue];if(!a||!b||a===b)continue;const mx=(a.cx+b.cx)/2,my=(a.cy+b.cy)/2+18;paths+=`<path class="edge2 e-conflict-dyn" d="M${a.cx} ${a.cy} Q${mx} ${my} ${b.cx} ${b.cy}"/>`;chips+=`<span class="edge-chip chip-conflicts" style="left:${mx}px;top:${my}px">accounts conflict</span>`;}
  const sup=placed.filter(c=>notes[c].polarity==='supports').length,con=placed.length-sup;
  const canvas=`<div class="reason-canvas" style="width:${boardW}px;height:${boardH}px"><svg class="reason-edges" width="${boardW}" height="${boardH}" aria-hidden="true">${paths}</svg><div class="verdict-node" style="left:${(boardW-verdW)/2}px;top:18px;width:${verdW}px;min-height:${verdH}px"><strong>Your case against ${esc(PEOPLE[id].name)}</strong><span>Pinned ${placed.length}/${acq.length} clues — <b class="sup">${sup} support</b>, <b class="con">${con} contradict</b> (your call).</span><span class="verdict-meter">You decide what each clue means.</span></div>${pillarNodes}${cardsHtml}${chips}${suspectTimeline(id,claims,padX,boardW-2*padX,timelineTop,timelineH)}</div>`;
  const objConf=objectiveConflicts(id,claims);
  const tray=`<div class="evidence-tray"><h3>Evidence to place${unplaced.length?` · ${unplaced.length}`:''}</h3>${unplaced.length?`<div class="tray-cards">${unplaced.map(c=>`<div class="tray-card"><div class="tray-info"><strong>${esc(CLUES[c].title)}</strong><small>${esc(CLUES[c].kind)}</small></div><div class="tray-place">${PILLARS.map(([k,label])=>`<button class="mini" data-do="board-place" data-suspect="${id}" data-clue="${c}" data-pillar="${k}" title="Place under ${label}">${PILLAR_ABBR[k]}</button>`).join('')}</div></div>`).join('')}</div>`:'<p class="meta">Every acquired clue is placed. Remove one to re-file it.</p>'}${objConf?`<div class="obj-conflicts"><h3>Contradictions in the accounts</h3><p class="meta">Objective clashes in the record — a reason to dig, not a verdict.</p>${objConf}</div>`:''}</div>`;
  return `<div class="workspace">${canvas}${tray}</div>`;
}
// The Reasoning board: a player-built detective evidence board. You place each
// acquired clue under Motive / Means / Opportunity / Alibi and mark it supports
// or contradicts the case — the app never classifies for you. It only surfaces
// objective conflicts in the record and the night timeline. Reads only your
// evidence; the deduction is yours.
function reasoning(){
  const claims=playerClaims(session);
  const strip=SUSPECTS.map(id=>suspectStripCard(id,reasonSuspect)).join('');
  const body=!session.world.player.evidence.length?`<div class="reason-empty2"><h2>The board is bare</h2><p>Question the village and inspect records. As you gather evidence, place it here and build your own case for or against each suspect.</p></div>`:reasonSuspect?workspaceView(reasonSuspect,claims):`<div class="reason-empty2"><h2>Pick a suspect</h2><p>Choose someone above, then place each clue you’ve gathered under Motive, Means, Opportunity, or Alibi — and mark whether it supports or contradicts the case against them. The board draws the objective conflicts; the reasoning is yours.</p></div>`;
  return `<main class="reason-board"><div class="reason-toolbar"><div><div class="eyebrow gold">THE EVIDENCE BOARD</div><h1>Reasoning</h1><p class="meta">Your board. Place clues and decide what each one means — <b class="sup">supports</b> or <b class="con">contradicts</b> the case. Nothing here is graded for you.</p></div><div class="reason-legend"><span class="legend-item"><i class="dot supports"></i>you marked supports</span><span class="legend-item"><i class="dot contradicts"></i>contradicts</span></div></div><div class="suspect-strip">${strip}</div><div class="reason-scroll">${body}</div></main>`;
}

function notebookContent(v){
  if(notebook==='evidence'){
    if(!v.evidence.length)return `<div class="empty-notebook"><span class="empty-symbol">⌑</span><h3>A fresh page.</h3><p>What you discover and what people tell you will appear here.</p><p class="meta">Begin with the study at Vale Manor.</p></div>`;
    const kinds=[...new Set(v.evidence.map(e=>e.kind))];
    const tabs=['All',...kinds];
    const active=tabs.includes(evidenceKind)?evidenceKind:'All';
    const subtabs=`<div class="sub-tabs" role="tablist" aria-label="Evidence types">${tabs.map(k=>`<button role="tab" aria-selected="${active===k}" class="${active===k?'active':''}" data-do="evkind" data-id="${esc(k)}">${esc(k)} <span>${k==='All'?v.evidence.length:v.evidence.filter(e=>e.kind===k).length}</span></button>`).join('')}</div>`;
    const shown=v.evidence.filter(e=>active==='All'||e.kind===active); // acquisition order: oldest first, newest last
    const cards=shown.map(e=>`<article class="evidence-card ${v.pins.includes(e.clue)?'pinned':''}"><button class="evidence-open" data-do="clue" data-id="${e.clue}">${artifactArt(e.clue)}<span class="eyebrow kind-label">${e.kind} · ${timeLabel(e.minute)}</span><strong>${e.title}</strong><small>${esc(e.source)}</small></button><button class="pin-button ${v.pins.includes(e.clue)?'on':''}" data-do="pin" data-id="${e.clue}" aria-label="${v.pins.includes(e.clue)?'Unpin':'Pin'} ${e.title}" aria-pressed="${v.pins.includes(e.clue)}">${v.pins.includes(e.clue)?'◆':'◇'}</button></article>`).join('')||`<p class="empty-state">No ${esc(active.toLowerCase())} evidence recorded yet.</p>`;
    return subtabs+cards;
  }
  if(notebook==='people')return v.profiles.map(p=>{const id=p.id,seen=v.lastSeen[id],here=v.people.some(x=>x.id===id);return `<div class="notebook-person ${here?'present-person':''}">${avatar(id)}<div><strong>${p.name}</strong><span>${p.role}</span><p>${esc(p.public)}</p>${p.metrics?`<div class="notebook-metrics">${meter('Trust in you',p.metrics.trust,'teal')}${meter('Stress factor',p.metrics.stress,'amber')}</div>`:'<p class="meta">Meet in person to see trust and stress.</p>'}<small>${v.people.some(x=>x.id===id)?'● Here with you':seen?`Last seen: ${placeName(seen.location)} · ${timeLabel(seen.minute)}${seen.departed?' (departed)':''}`:'Not yet encountered'}</small>${here&&v.status!=='solved'?`<button class="soft-button full" data-do="chat" data-id="${id}">Conversation options →</button>`:''}</div></div>`;}).join('');
  return `<p class="muted">Keep your own theories. A hypothesis stays separate from a discovered fact.</p><form id="note-form"><label class="sr-only" for="note">Your hypothesis</label><textarea id="note" name="note" rows="4" maxlength="1000" placeholder="What do you think happened?"></textarea><button class="soft-button full" type="submit">Add hypothesis</button></form><div class="notes-list">${v.notes.slice().reverse().map(n=>`<article><span class="meta">${timeLabel(n.minute)}</span><p>${esc(n.text)}</p></article>`).join('')}</div>`;
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
function eventRow(e){return `<button class="event-row ${selectedIndex()===e.index?'selected':''} ${e.index>selectedIndex()?'future':''} ${e.index<entryEventIndex()?'pregame':''}" data-do="event" data-index="${e.index}"><span class="event-dot kind-${e.kind}">${glyphs[e.kind]??'·'}</span><span class="event-row-copy"><span class="event-row-meta"><time>${timeLabel(e.minute)}</time><span>${e.id}</span></span><strong>${esc(e.title)}</strong><small>${typeNames[e.kind]}${e.playerText?' · observed':''}</small></span></button>`;}
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
function eventLink(e,label){return e?`<button class="event-link" data-do="event" data-index="${e.index}"><span>${e.id}</span>${esc(label??e.title)} <b>↗</b></button>`:'';}

function eventDetail(){const e=session.events[selectedIndex()];if(!e)return '<p>Select an event.</p>';const children=session.events.filter(x=>x.parents.includes(e.id)&&!['clock','checkpoint','memory'].includes(x.kind));const candidates=e.data.candidates;
  return `<div class="detail-kicker"><span class="type-badge kind-${e.kind}">${glyphs[e.kind]??'·'} &nbsp; ${typeNames[e.kind]??e.kind}</span><span class="meta">${e.id} · ${timeLabel(e.minute)}</span></div><h2>${esc(e.title)}</h2><div class="event-context"><button class="actor-chip" data-do="person" data-id="${PEOPLE[e.actor]?e.actor:person}">${PEOPLE[e.actor]?avatar(e.actor,'tiny'):''}${esc(actorName(e.actor))}</button><span>${esc(placeName(e.location))}</span><span class="visibility-badge">${e.playerText?'Player observed':'Internal / offstage'}</span></div>${e.index<entryEventIndex()?'<p class="pre-game-note">Before the detective arrived — case prehistory (executed events in the alternate configurations; authored setup in the original), not something you witnessed.</p>':''}
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
function characterPanel(w){const p=PEOPLE[person],a=w.npcs[person],idx=selectedIndex();return `<div class="character-top"><span class="eyebrow">CHARACTER INSPECTOR</span><label class="sr-only" for="character-select">Choose a character</label><select id="character-select">${Object.entries(PEOPLE).map(([id,p])=>`<option value="${id}" ${person===id?'selected':''}>${p.name}</option>`).join('')}</select></div><div class="profile-heading">${avatar(person,'large')}<h2>${p.name}</h2><p>${p.role}</p><span class="meta">${esc(a.travel?`${placeName(a.travel.from)} → ${placeName(a.travel.to)}`:placeName(a.location))}</span><span class="at-time">${cursor===null?'PRESENT':`AT EVENT ${session.events[idx].id}`} · ${timeLabel(w.minute)}</span></div>
  <div class="small-tabs profile-tabs" role="tablist" aria-label="Character views">${[['profile','Profile'],['beliefs',`Beliefs (${a.beliefs.length})`],['memories',`Memories (${sensoryMemories(a).length})`],['history','History']].map(([id,n])=>`<button class="${personTab===id?'active':''}" role="tab" aria-selected="${personTab===id}" data-do="person-tab" data-id="${id}">${n}</button>`).join('')}</div><div class="profile-content">${personTab==='beliefs'?a.beliefs.map(beliefCard).join(''):personTab==='memories'?`<p class="meta">What ${p.name.split(' ')[0]} has seen and heard — movement sightings and conversations, oldest to newest. Their current conclusions are under Beliefs. Sightings record who was seen here, without revealing a destination or intention.</p>${sensoryMemories(a).map(e=>memoryCard(e.id)).join('')||'<p class="meta">No sightings or conversations recorded yet.</p>'}`:personTab==='history'?`<p class="meta">Actions, perceptions, and updates involving ${p.name.split(' ')[0]}, through the selected moment.</p><button class="soft-button full" data-do="filter-person" data-id="${person}">Filter the full timeline</button>${session.events.filter(e=>e.index<=idx&&(e.actor===person||e.data.listener===person)&&!['memory','clock'].includes(e.kind)).slice(-25).reverse().map(e=>`<div class="personal-event"><span class="meta">${timeLabel(e.minute)} · ${typeNames[e.kind]}</span>${eventLink(e)}</div>`).join('')}`:`<p class="profile-bio">${p.public}</p>${lifePanel(w,person)}<details class="private-background" open><summary>Private background</summary><p>${p.secret}</p></details><div class="profile-section"><h3>Current intention</h3><p class="intention">${esc(a.intention)}</p>${eventLink(eventById(a.lastDecision),'See the decision')}</div><div class="profile-section"><h3>Current state</h3>${meter('Trust in you',a.trust,'teal')}${meter('Stress',a.stress,'amber')}</div><div class="profile-section"><h3>Competing goals</h3><ol class="goal-list">${p.goals.map(g=>`<li>${g}</li>`).join('')}</ol></div><div class="profile-section"><h3>Disposition</h3>${Object.entries(p.traits).map(([k,v])=>meter(k==='riskAversion'?'Risk aversion':k[0].toUpperCase()+k.slice(1),v,'muted-meter')).join('')}</div><div class="profile-section"><h3>Values</h3><div class="value-tags">${p.values.map(v=>`<span>${v}</span>`).join('')}</div></div><div class="profile-section"><h3>Relationships</h3>${Object.entries(p.relationships).filter(([id])=>id!=='player').map(([id,r])=>`<button class="relationship-row" data-do="person" data-id="${id}">${avatar(id,'tiny')}<span>${PEOPLE[id].name}</span><small>${Math.round(r.trust*100)}% trust</small></button>`).join('')}<p class="meta">These are initial ties. Trust in you changes through play.</p></div>`}</div>`;}
function meter(label,value,kind){return `<div class="meter ${kind}"><div><span>${label}</span><strong>${Math.round(value*100)}<small>/100</small></strong></div><div class="meter-track"><span style="width:${Math.max(0,Math.min(100,value*100))}%"></span></div></div>`;}

function casePanel(w){return `<section class="world-panel"><div class="world-panel-heading"><span class="eyebrow teal">WORLD AT ${timeLabel(w.minute)}</span><h2>A single world. Different accounts.</h2><p class="muted">The locations below show actual positions at the selected event.</p></div><div class="location-grid">${Object.entries(LOCATIONS).map(([id,p])=>`<article class="location-card"><div><span class="place-num">${p.glyph}</span><h3>${p.name}</h3></div><div class="occupants">${Object.entries(w.npcs).filter(([,a])=>a.location===id).map(([id])=>`<button data-do="person" data-id="${id}">${avatar(id,'tiny')}${PEOPLE[id].name}</button>`).join('')}${w.player.location===id?'<span class="player-occupant">You are here</span>':''}${!Object.values(w.npcs).some(a=>a.location===id)&&w.player.location!==id?'<span class="meta">Unoccupied</span>':''}</div></article>`).join('')}</div>${Object.entries(w.npcs).some(([,a])=>a.travel)?`<div class="transit-list"><h3>In transit</h3>${Object.entries(w.npcs).filter(([,a])=>a.travel).map(([id,a])=>`<p>${PEOPLE[id].name}: ${placeName(a.travel.from)} → ${placeName(a.travel.to)} <span class="meta">arrives ${timeLabel(a.travel.arrival)}</span></p>`).join('')}</div>`:''}<section class="detail-section"><h3>Evidence that can move</h3><div class="object-state"><span class="folio-mark">F</span><div><strong>The red transfer folio</strong><p>${placeName(w.objects.folio)}</p></div><span class="meta">${w.player.evidence.some(e=>e.clue==='folio')?'Contents recorded in your notebook':'Contents not yet recorded'}</span></div></section><section class="detail-section"><h3>Authored evidence routes</h3><p class="meta">These are explicit requirements for this case. They do not constitute a general solvability proof.</p><div class="proof-routes">${caseHealth(session,w).map(r=>`<article><div class="panel-heading"><strong>${r.title}</strong><span class="teal">${r.found.length}/${r.all.length}</span></div><div class="route-track"><span style="width:${100*r.found.length/r.all.length}%"></span></div><ul>${r.all.map(c=>`<li class="${r.found.includes(c)?'found':''}"><span>${r.found.includes(c)?'✓':'○'}</span>${CLUES[c].title}</li>`).join('')}</ul></article>`).join('')}</div></section><details class="truth-panel"><summary>The canonical crime history <span>Reveals the complete solution</span></summary><p>${CASE.truth}</p><div class="crime-timeline">${CASE.history.map(([t,txt])=>`<div><time>${t}</time><p>${txt}</p></div>`).join('')}</div></details><p class="meta">Schedule seed ${session.seed} · This first case is authored; changing the seed varies routines, not the culprit.</p></section>`;}

function worldPanel(w){
  const idx=selectedIndex(),p=perspective==='world'?null:perspectiveAt(session,idx,perspective);
  const e=session.events[idx];
  const changes=session.events.slice(0,idx+1).filter(x=>x.kind==='belief'&&x.data.belief&&(!p||x.actor===perspective)).slice(-4);
  return `<section class="world-panel"><div class="perspective-toolbar"><div><span class="eyebrow teal">${timeLabel(w.minute)} · ${e.id}</span><h2>${p?`${esc(PEOPLE[perspective].name)}’s perspective`:'Bellweather at this moment'}</h2></div><label>View through<select id="world-perspective"><option value="world">Actual world</option>${Object.entries(PEOPLE).map(([id,n])=>`<option value="${id}" ${perspective===id?'selected':''}>${n.name}</option>`).join('')}</select></label></div><p class="meta">${p?'Other positions are last witnessed, not live tracking. Absence of a marker means no recorded movement observation. Beliefs below may be mistaken.':'Actual positions and travel. Choose a character to explore their recorded observations and beliefs.'}</p>
  <div class="moment-caption">${eventLink(e,(p?'Recorded event (world trace): ':'At this event: ')+e.title)}</div>
  <div class="location-grid town-grid">${Object.entries(LOCATIONS).map(([id,place])=>{
    const occupants=p?Object.entries(p.seen).filter(([,n])=>n.location===id):Object.entries(w.npcs).filter(([,n])=>n.location===id);
    return `<article class="location-card ${e.location===id?'moment-location':''}">${locationArt(id,'world-place-art')}<h3>${place.name}</h3><div class="occupants">${p&&p.self.location===id?`<button class="self-marker" data-do="person" data-id="${perspective}">${avatar(perspective,'tiny')} ${PEOPLE[perspective].name} · self</button>`:''}${occupants.map(([subject,n])=>`<div class="town-person ${p?'last-observed':''}">${subject==='player'?'<span class="player-occupant">Detective</span>':`<button data-do="person" data-id="${subject}">${avatar(subject,'tiny')}${PEOPLE[subject].name}</button>`}${p?`<small>${n.departed?'Seen leaving':'Seen arriving'} · ${timeLabel(n.minute)}<br>May have moved since</small>${eventLink(eventById(n.sourceId),'Observation')}`:`<small class="npc-counts">${n.beliefs.length} beliefs · ${sensoryMemories(n).length} memories</small>`}</div>`).join('')}${!p&&w.player.location===id?'<span class="player-occupant">Detective</span>':''}</div></article>`;
  }).join('')}</div>
  <div class="transit-list"><h3>${p?'Your travel':'Travel underway'}</h3>${Object.entries(w.npcs).filter(([id,n])=>n.travel&&(!p||id===perspective)).map(([id,n])=>`<p>${PEOPLE[id].name} · ${placeName(n.travel.from)} → ${placeName(n.travel.to)} · arrives ${timeLabel(n.travel.arrival)}</p>`).join('')||'<p class="meta">No recorded travel underway for this view.</p>'}${!p&&w.player.location==='transit'?'<p>Detective · in transit</p>':''}</div>
  ${p?`<section class="detail-section"><div class="panel-heading"><h3>Beliefs held now (${p.beliefs.length})</h3><button class="subtle-button" data-do="person" data-id="${perspective}">Memories & profile ↗</button></div>${p.beliefs.map(b=>`<article class="belief-card"><p>${esc(b.text)}</p><small>${Math.round(b.confidence*100)}% confidence · ${esc(b.sourceType)} · ${timeLabel(b.acquired)}</small>${eventLink(eventById(b.sourceId),'Why they believe this')}</article>`).join('')}</section>`:`<details class="detail-section"><summary>Moving evidence: the red folio</summary><p>${esc(placeName(w.objects.folio))}</p></details>`}
  <section class="detail-section"><h3>Recent belief changes</h3>${changes.map(change=>{const b=change.data.belief,patch=change.changes.find(c=>c.path===`npcs.${change.actor}.beliefs`),before=patch?.before?.find(x=>x.key===b.key);return `<article class="belief-change"><small>${timeLabel(change.minute)} · ${PEOPLE[change.actor].name}</small><p><span class="muted">${esc(before?.text??'No previous belief recorded')}</span><br>↓<br>${esc(b.text)}</p>${eventLink(change,'Follow this change')}</article>`;}).join('')||'<p class="meta">No belief changes recorded yet.</p>'}</section>
  <details class="advanced-case"><summary>Authored case requirements & solution (spoilers)</summary>${p?'<p class="meta">Switch to Actual world to inspect canonical case details.</p>':casePanel(w)}</details></section>`;
}
function missedPanel(w){
  if(!missedRevealed)return `<section class="world-panel"><h2>What went unseen?</h2><p>This review reveals unexamined clues, offstage conversations, and unused follow-ups up to the selected event. It contains spoilers.</p><button class="primary" data-do="reveal-missed">Reveal missed opportunities</button></section>`;
  const report=missedAt(session,selectedIndex());
  return `<section class="world-panel"><div class="panel-heading"><h2>Missed by ${timeLabel(w.minute)}</h2><button class="subtle-button" data-do="hide-missed">Hide spoilers</button></div><p class="meta">A review of this recorded run, not a score or a list of required actions. Scrub backward to review earlier opportunities.</p><h3>Unexamined evidence at places you visited</h3>${report.clues.map(c=>`<article class="opportunity"><strong>${esc(c.title)}</strong><p>${placeName(c.location)} · ${c.status}</p></article>`).join('')||'<p class="meta">No unrecorded physical clues at visited places in the current state.</p>'}<h3>Conversations you did not overhear</h3>${report.encounters.map(e=>`<article class="opportunity"><span class="meta">${timeLabel(e.minute)} · ${placeName(e.location)} · Past encounter, no longer observable</span>${eventLink(e)}</article>`).join('')||'<p class="meta">None recorded by this moment.</p>'}<h3>Evidence follow-ups not yet tried</h3>${report.followups.map(f=>`<article class="opportunity">${f.label}<p class="meta">${w.status==='solved'?'Case closed · review only.':`Try when you encounter ${PEOPLE[f.person].name}.`}</p></article>`).join('')||'<p class="meta">No outstanding follow-ups in this small authored checklist.</p>'}${report.moved?`<h3>Evidence that moved</h3><p>The red folio: ${report.moved.status}.</p>`:''}</section>`;
}

function checksPanel(h){return `<section class="checks-panel"><span class="eyebrow teal">INTEGRITY & REPLAY</span><h2>${h.ok?'Replay integrity checks pass.':'There is something to inspect.'}</h2><p class="muted">These checks run against the full current history, even when you are inspecting the past.</p><button class="soft-button" data-do="director">World Director · ${directorEnabled()?'Z3 enabled':'local checks'}</button><div class="check-summary"><strong>${h.eventCount}</strong><span>events</span><strong>${h.patchCount}</strong><span>state changes</span></div><div class="check-list">${h.checks.map(c=>`<article><span class="check-icon ${c.ok?'good':'bad'}">${c.ok?'✓':'!'}</span><div><strong>${c.name}</strong><p>${c.ok?'Pass':'Needs attention'}</p></div></article>`).join('')}</div>${h.errors.length?`<pre class="error-list">${esc(h.errors.join('\n'))}</pre>`:''}<div class="check-explanation"><h3>What replay verification means</h3><p>Starting with the initial world, the inspector applies every recorded state change in order. The result must exactly match the current world. Every “before” value must also match the reconstructed state.</p><h3>What it does not establish</h3><p>Replay consistency alone does not establish that the mystery is fair or that the rules mean what the author intended. This prototype uses a small authored case, deterministic decisions, and scripted conversations.</p><h3>Follow a useful example</h3><p>Show the estate accounts to Silas, then let time pass. In the history, follow the conversation to his new belief, his concealment decision, and the red folio’s movement. Or threaten Clara and follow the warning to Rowan.</p><button class="soft-button" data-do="export">Export events and current state</button></div></section>`;}

function milestones(){const idx=selectedIndex();const entries=session.events.filter(e=>['movement','speech','belief','evidence','resolution'].includes(e.kind)&&(perspective==='world'||e.actor===perspective||e.data.listener===perspective));let at=entries.findIndex(e=>e.index>=idx);if(at<0)at=entries.length;return `<span class="meta">Recorded milestones</span>${entries.slice(Math.max(0,at-4),at+4).map(e=>`<button class="milestone ${e.index>idx?'future':''}" data-do="event" data-index="${e.index}" title="${esc(e.title)}">${glyphs[e.kind]} ${timeLabel(e.minute)}<small>${esc(e.title)}${e.index>idx?' · later in trace':''}</small></button>`).join('')||'<span class="meta">No milestones in this view.</span>'}`;}

function replayBar(){const idx=selectedIndex(),e=session.events[idx],entry=entryEventIndex(),len=session.events.length,pct=len>1?(entry/(len-1))*100:0;return `<div class="replay-bar"><div class="replay-state"><span class="${cursor===null?'live-dot':'past-dot'}"></span><strong>${cursor===null?'Present':'Inspecting the past'}</strong><span>${timeLabel(e.minute)}</span></div><div class="replay-controls"><button class="icon-button" data-do="first" aria-label="Go to the first event">|‹</button><button class="icon-button" data-do="previous" aria-label="Previous event">‹</button><button class="play-replay" data-do="play-replay" aria-label="${timer?'Pause':'Play'} recorded history">${timer?'Ⅱ':'▶'}</button><button class="icon-button" data-do="next" aria-label="Next event">›</button></div><div class="replay-slider"><label for="history-cursor" class="sr-only">Inspect event in history</label><div class="slider-wrap"><input id="history-cursor" type="range" min="0" max="${len-1}" value="${idx}">${len>1?`<button class="entry-marker" data-do="event" data-index="${entry}" style="left:${pct}%" title="The detective enters Bellweather · ${timeLabel(session.events[entry].minute)}" aria-label="Jump to the detective's arrival"></button>`:''}</div><span>${idx+1} / ${len} events${cursor!==null&&idx<entry?' · before you arrived':''}</span></div><button class="soft-button" data-do="live" ${cursor===null?'disabled':''}>Return to present</button></div>`;}

function followTraceCursor(){
  if(mode!=='inspector'||inspectorTab!=='timeline')return;
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
  const journal=mode==='game'?JSON.stringify([visibleTranscript(playerView(session).transcript).slice(-5).map(e=>[e.id,displayText(e)]),pendingEntries()]):null;
  const scrolls={};
  for(const selector of ['#journal','#event-list','#event-detail','#character-panel','.notebook-content','.reason-scroll','.action-area']){const el=$(selector);if(el)scrolls[selector]=el.scrollTop;}
  $('#app').innerHTML=header()+(mode==='game'?game():mode==='reasoning'?reasoning():inspector());
  document.body.dataset.mode=mode;
  for(const [selector,value]of Object.entries(scrolls)){const el=$(selector);if(el)el.scrollTop=value;}
  // All delivery paths (scripted, Director, AI) follow new feed content. Merely
  // opening a panel preserves the player's reading position and side-panel scroll.
  if(journal!==null&&journal!==renderedJournal){const feed=$('#journal');if(feed)feed.scrollTop=feed.scrollHeight;}
  renderedJournal=journal;
  followTraceCursor();
}

function openModal(content,label){stopReplay();const m=$('#modal');m.innerHTML=`<button class="dialog-close icon-button" data-do="close-modal" aria-label="Close dialog">×</button>${content}`;m.setAttribute('aria-label',label);if(!m.open)m.showModal();}
function clueModal(id){const c=CLUES[id],entry=session.world.player.evidence.find(e=>e.clue===id);if(!entry)return;openModal(`${artifactArt(id,'artifact-detail-art')}<div class="eyebrow gold">${c.kind}</div><h2>${c.title}</h2><p class="clue-source">${esc(entry.source)} · ${timeLabel(entry.minute)}</p><div class="dialog-prose"><p>${esc(entry.text??c.text)}</p></div><div class="value-tags">${c.tags.map(t=>`<span>${t}</span>`).join('')}</div><button class="primary full" data-do="pin-close" data-id="${id}">${session.world.player.pins.includes(id)?'Unpin from your case':'Pin for your accusation'}</button>`,'Evidence detail');}
function accusationModal(){const w=session.world;if(w.status==='solved'){openModal(`<div class="eyebrow gold">CASE CLOSED</div><h2>Your accusation</h2><p>Your accusation was supported by the recorded evidence.</p><div class="dialog-prose"><p>${CASE.truth}</p></div><h3>Your supporting evidence</h3><ul>${w.ending.evidence.map(c=>`<li>${CLUES[c].title}</li>`).join('')}</ul>`,'Your completed accusation');return;}
  if(w.player.location!=='square'){openModal(`<div class="eyebrow gold">PRESENT YOUR CASE</div><h2>Speak to Constable Bell.</h2><p>Bell is at the village square. Bring your notebook and explain the connection between the suspect, the act, and the motive.</p><button class="primary full" data-do="visit-bell">Go to the square · ${distance(w.player.location,'square')} min</button>`,'Visit the constable');return;}
  if(!w.player.evidence.length){openModal('<h2>A case needs evidence.</h2><p>Begin in the study at Vale Manor. Record what you find before making an accusation.</p>','Evidence needed');return;}
  const selected=w.player.pins.length?w.player.pins:w.player.evidence.map(e=>e.clue);openModal(`<div class="eyebrow gold">CONSTABLE BELL’S CASE FILE</div><h2>Make the connections.</h2><p>Select the evidence supporting your account. An unsupported accusation will not end the investigation.</p><form id="accusation-form"><div class="accusation-fields"><label>Who killed Edmund?<select name="suspect" required><option value="">Choose a suspect</option>${['clara','rowan','silas'].map(id=>`<option value="${id}">${PEOPLE[id].name}</option>`).join('')}</select></label><label>How?<select name="method" required><option value="">Choose a method</option>${(CASE.methodOptions??[["poison","Poison in his drink"],["seal","A blow from the brass seal"],["knife","A concealed knife"]]).map(([id,label])=>`<option value="${id}">${esc(label)}</option>`).join('')}</select></label><label>Why?<select name="motive" required><option value="">Choose a motive</option>${(CASE.motiveOptions??[["jealousy","Jealousy over a relationship"],["inheritance","An inheritance dispute"],["fraud","Conceal the diverted estate payments"]]).map(([id,label])=>`<option value="${id}">${esc(label)}</option>`).join('')}</select></label></div><fieldset class="evidence-selection"><legend>Supporting evidence</legend>${w.player.evidence.map(e=>`<label><input type="checkbox" name="evidence" value="${e.clue}" ${selected.includes(e.clue)?'checked':''}><span>${CLUES[e.clue].title}<small>${CLUES[e.clue].kind}</small></span></label>`).join('')}</fieldset><button class="primary full" type="submit">Present the accusation</button></form>`,'Present an accusation');}
function menuModal(){openModal(`<div class="eyebrow gold">THE BELLWEATHER CASE</div><h2>Your investigation</h2><p>Progress is saved on this device. Export keeps a portable copy, including the full inspector history.</p><div class="menu-actions"><button class="soft-button" data-do="export">Export investigation & trace</button><button class="soft-button" data-do="import">Import saved investigation</button><button class="soft-button" data-do="llm">AI characters…</button><button class="soft-button" data-do="director">World Director…</button><button class="soft-button" data-do="help">How to investigate</button><button class="soft-button" data-do="choose-case">Choose a case configuration…</button><button class="soft-button" data-do="restart-confirm">Restart this case</button></div>`,'Investigation options');}
function llmModal(){const c=llmConfig();openModal(`<div class="eyebrow teal">OPTIONAL · EXPERIMENTAL</div><h2>AI characters</h2><p>Character reasoning combines response decisions with natural dialogue. Characters receive their own beliefs, memories, goals and conversation history. They can answer, evade, clarify, challenge, refuse or end a conversation. The engine limits disclosures and consequences; a separate critic checks the proposal before it is recorded. Failed turns use an authored fallback. The critic can still make mistakes.</p><form id="llm-form"><div class="accusation-fields"><label>Proxy endpoint URL<input name="endpoint" autocomplete="off" placeholder="http://127.0.0.1:8787" value="${esc(c.endpoint||'http://127.0.0.1:8787')}"></label><label style="flex-direction:row;align-items:center;gap:10px"><input type="checkbox" name="reasoning" ${c.enabled&&c.reasoning?'checked':''} style="width:16px;height:16px;accent-color:var(--teal)"> Enable character reasoning and free-text conversation</label></div><button class="primary full" type="submit">Save settings</button></form><p class="meta">With this setting off, responses are immediate and scripted; no AI requests are made. Reasoning permits up to two proposals and two critic calls per turn, with a 30-second total timeout. Accepted turns and audits survive export and replay. In configured cases this also enables occasional autonomous goal selection: at most one additional request per player turn, a five-second timeout, and a twenty-minute cooldown per NPC. Scripted life continues when the request fails. Your local proxy receives this character’s private perspective, not the full world. Restart the proxy after updating its code.</p>`,'AI character settings');}

function helpModal(){openModal(`<div class="eyebrow gold">FIELD NOTES</div><h2>Follow the evidence.</h2><p>Choose a place, inspect its objects, and speak to the people you encounter. Their whereabouts can change while you act. Time stands still while you read.</p><p>Click a notebook entry to read it, or pin it for your accusation. Present evidence in conversations to challenge a story or build trust. You can recover from a poor approach.</p><h3>Supported text commands</h3><div class="command-examples"><code>go manor</code><code>inspect desk</code><code>ask Clara about alibi</code><code>wait 10</code><code>look</code></div><p>Use the on-screen controls to present evidence and make an accusation. This first version uses authored conversations and a command parser.</p><h3>The inspector</h3><p>Inspector reveals the complete case. Select any event to see its causes and changes, move the history slider to inspect past state, and open a character’s beliefs to trace their sources.</p>`,'How to investigate');}
function exportFile(){const blob=new Blob([exportDialogueSave(session,dialogueAudit,boardNotes)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`bellweather-investigation-${session.events.length}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Investigation and full history exported.');}
function stopReplay(){if(timer){clearInterval(timer);timer=null;}}
function step(direction){stopReplay();cursor=Math.max(0,Math.min(session.events.length-1,selectedIndex()+direction));render();}

document.addEventListener('click',event=>{const b=event.target.closest('[data-do]');if(!b||b.disabled)return;const id=b.dataset.id,action=b.dataset.do;
  if(action==='mode'){
    if(b.dataset.value==='inspector'&&mode!=='inspector'){openModal(`<div class="eyebrow teal">SIMULATION INSPECTOR</div><h2>See behind the story.</h2><p>The inspector exposes the culprit, private beliefs, and offstage events. You can return to the investigation at any time.</p><button class="primary full" data-do="enter-inspector">Open inspector</button>`,'Open inspector with hidden case information');}
    else{mode=b.dataset.value;stopReplay();render();}return;
  }
  switch(action){
    case 'enter-inspector':$('#modal').close();mode='inspector';render();break;
    case 'move':chat=null;act({type:'move',to:id});break;
    case 'inspect':act({type:'inspect',object:id});break;
    case 'wait':act({type:'wait',minutes:Number(b.dataset.minutes)||10});break;
    case 'history':historyPage=0;historyModal();break;
    case 'history-newer':historyPage++;historyModal();break;
    case 'history-older':historyPage--;historyModal();break;
    case 'action-group':actionGroup=id;render();break;
    case 'chat':if(characterBusy){toast('Wait for the reply or cancel it before changing conversations.');break;}actionGroup='talk';chat=id;chosenClue=null;render();break;
    case 'cancel-character':cancelCharacter();render();break;
    case 'close-chat':cancelCharacter();chat=null;act({type:'endConversation'});break;
    case 'ask':act({type:'ask',person:b.dataset.person,topic:b.dataset.topic});break;
    case 'present':if(chosenClue)act({type:'present',person:b.dataset.person,clue:chosenClue,tone:b.dataset.tone});break;
    case 'notebook':notebook=id;render();break;
    case 'reason-suspect':reasonSuspect=reasonSuspect===id?null:id;render();break;
    case 'board-place':{const n=notesFor(b.dataset.suspect);n[b.dataset.clue]={pillar:b.dataset.pillar,polarity:n[b.dataset.clue]?.polarity||'supports'};saveBoardNotes();render();break;}
    case 'board-flip':{const n=notesFor(b.dataset.suspect)[b.dataset.clue];if(n){n.polarity=n.polarity==='supports'?'contradicts':'supports';saveBoardNotes();render();}break;}
    case 'board-remove':{delete notesFor(b.dataset.suspect)[b.dataset.clue];saveBoardNotes();render();break;}
    case 'claim-source':{const source=eventById(id);if(source?.playerText)openModal(`<h2>Recorded source · ${timeLabel(source.minute)}</h2>${paragraphs(source.playerText)}`,'Claim source');break;}
    case 'evkind':evidenceKind=id;render();break;
    case 'pin':act({type:'pin',clue:id});break;
    case 'pin-close':$('#modal').close();act({type:'pin',clue:id});break;
    case 'clue':clueModal(id);break;
    case 'accusation':accusationModal();break;
    case 'visit-bell':$('#modal').close();chat=null;act({type:'move',to:'square'});accusationModal();break;
    case 'menu':menuModal();break;
    case 'choose-case':openModal(`<h2>Choose a Bellweather case</h2><p>The same cast; authored configurations plus procedurally generated cases. Generated cases must pass source checks, finite explanation checks and a played-through solution route before they start. Starting one replaces the current investigation; export it first to retain it.</p><button class="soft-button" data-do="export">Export current investigation</button><div class="menu-actions"><button class="soft-button" data-do="generate-case">🎲 Generate a new validated case</button><button class="soft-button" data-do="generate-case" data-structure="cleanup">Generate a cleanup investigation</button><button class="soft-button" data-do="generate-case" data-structure="clockwork">Generate a clock-dependent investigation</button>${CASE_OPTIONS.map(c=>`<button class="soft-button" data-do="start-case" data-id="${c.id}">${esc(c.title)}</button>`).join('')}</div>`,'Choose case configuration');break;
    case 'start-case':{const fresh=createSession(17,id);cancelCharacter();stopReplay();session=fresh;resetRealized();boardNotes={};healthCache=null;cursor=null;chat=null;chosenClue=null;reasonSuspect=null;detailPanel=null;missedRevealed=false;sceneTransition=null;actionGroup='inspect';mode='game';persist();$('#modal').close();render();break;}
    case 'generate-case':{const gen=generateCase(undefined,{structure:b.dataset.structure});if(!gen){toast('Could not generate a valid case. Try again.');break;}const fresh=createSession(17,gen.id);cancelCharacter();stopReplay();session=fresh;resetRealized();boardNotes={};healthCache=null;cursor=null;chat=null;chosenClue=null;reasonSuspect=null;detailPanel=null;missedRevealed=false;sceneTransition=null;actionGroup='inspect';mode='game';persist();$('#modal').close();render();toast(`New case generated: ${gen.title}`);break;}

    case 'close-modal':$('#modal').close();break;
    case 'help':helpModal();break;
    case 'director':directorModal();break;
    case 'toggle-director':cancelCharacter();setDirectorEnabled(!directorEnabled());directorModal();render();break;
    case 'llm':llmModal();break;
    case 'export':exportFile();break;
    case 'import':$('#import-file').click();break;
    case 'restart-confirm':openModal(`<div class="eyebrow gold">RESTART THE LAST BELL</div><h2>Return to the beginning?</h2><p>Your current investigation will be replaced on this device. Export it first if you want to keep its history. This remains the same authored case.</p><div class="menu-actions"><button class="soft-button" data-do="export">Export current investigation</button><button class="primary" data-do="restart">Restart from 08:00</button></div>`,'Restart this investigation');break;
    case 'restart':missedRevealed=false;detailPanel=null;sceneTransition=null;actionGroup='inspect';session=createSession(session.seed,session.world.caseId??'last-bell');healthCache=null;cursor=null;chat=null;resetRealized();boardNotes={};reasonSuspect=null;stopReplay();persist();$('#modal').close();render();toast('A new morning in Bellweather.');break;
    case 'close-detail':detailPanel=null;render();break;
    case 'reveal-missed':missedRevealed=true;render();break;
    case 'hide-missed':missedRevealed=false;detailPanel=null;render();break;
    case 'event':detailPanel='event';selectEvent(b.dataset.index);break;
    case 'person':if(PEOPLE[id]){if(inspectorTab==='timeline')inspectorTab='world';detailPanel='character';person=id;personTab='profile';render();}break;
    case 'person-tab':personTab=id;render();break;
    case 'filter-person':actorFilter=id;typeFilter='all';query='';inspectorTab='timeline';render();break;
    case 'inspector-tab':inspectorTab=id;render();break;
    case 'first':selectEvent(0);break;
    case 'previous':step(-1);break;
    case 'next':step(1);break;
    case 'live':stopReplay();cursor=null;render();break;
    case 'play-replay':if(timer){stopReplay();render();}else{if(cursor===null||cursor>=session.events.length-1)cursor=0;timer=setInterval(()=>{cursor++;if(cursor>=session.events.length-1){cursor=session.events.length-1;stopReplay();}render();},550);render();}break;
  }
});
document.addEventListener('submit',event=>{event.preventDefault();if(event.target.id==='character-form'){characterDraft=$('#character-question').value;if(chat&&characterDraft.trim())runCharacter(chat,characterDraft);}else if(event.target.id==='command-form'){const input=$('#command');if(input.value.trim())act(parseCommand(input.value,session));$('#command')?.focus();}else if(event.target.id==='note-form'){const val=$('#note').value;if(val.trim())act({type:'note',text:val});}else if(event.target.id==='llm-form'){const m=$('#modal');const endpoint=(m.querySelector('[name=endpoint]')?.value||'').trim();const reasoning=!!m.querySelector('[name=reasoning]')?.checked;const enabled=reasoning;setLlmConfig({endpoint,enabled,reasoning});cancelCharacter();stopRealizing();const active=llmActive();m.close();render();toast(active?'AI character reasoning enabled.':enabled?'Saved — but add a valid proxy URL (http://…) to turn it on.':'Scripted mode enabled. Responses are immediate; saved dialogue is retained.');}else if(event.target.id==='accusation-form'){const f=new FormData(event.target);$('#modal').close();act({type:'accuse',suspect:f.get('suspect'),method:f.get('method'),motive:f.get('motive'),evidence:f.getAll('evidence')});}});
document.addEventListener('change',event=>{const el=event.target;if(el.id==='world-perspective'){perspective=el.value;detailPanel=null;render();}else if(el.id==='present-clue'){chosenClue=el.value;render();}else if(el.id==='character-select'){person=el.value;render();}else if(el.id==='actor-filter'){actorFilter=el.value;render();}else if(el.id==='type-filter'){typeFilter=el.value;render();}else if(el.id==='clock-filter'){includeClock=el.checked;render();}else if(el.id==='import-file'&&el.files[0]){const file=el.files[0];if(file.size>20_000_000){toast('Choose a save smaller than 20 MB.');return;}file.text().then(text=>{const imported=importDialogueSave(text);session=imported.session;boardNotes=imported.boardNotes;reasonSuspect=null;missedRevealed=false;detailPanel=null;sceneTransition=null;actionGroup='inspect';healthCache=null;cursor=null;chat=null;resetRealized();for(const [id,r]of imported.audit){dialogueAudit.set(id,r);realized.set(id,`${actorName(eventById(id).actor)}\n"${r.text}"`);}stopReplay();persist();$('#modal').close();render();toast('Saved investigation restored, with its full history.');}).catch(err=>toast(`Could not import: ${err.message}`));el.value='';}});
document.addEventListener('input',event=>{if(event.target.id==='character-question'){characterDraft=event.target.value;}else if(event.target.id==='history-search'){query=event.target.value;$('#event-list').innerHTML=eventList();followTraceCursor();}else if(event.target.id==='history-cursor'){
  // Keep the range input itself mounted while dragging so pointer capture is preserved.
  stopReplay();cursor=Number(event.target.value);const w=selectedWorld(),e=session.events[selectedIndex()];
  if($('#event-detail'))$('#event-detail').innerHTML=eventDetail();
  if($('#character-panel'))$('#character-panel').innerHTML=`<button class="subtle-button full" data-do="close-detail">Close details ×</button>${detailPanel==='event'?eventDetail():characterPanel(w)}`;
  $('.replay-state').innerHTML=`<span class="past-dot"></span><strong>Inspecting the past</strong><span>${timeLabel(e.minute)}</span>`;
  $('.replay-slider>span').textContent=`${selectedIndex()+1} / ${session.events.length} events${selectedIndex()<entryEventIndex()?' · before you arrived':''}`;
  $('.replay-bar>.soft-button').disabled=false;
  $('.play-replay').textContent='▶';$('.play-replay').setAttribute('aria-label','Play recorded history');
  $('.inspector-summary>div:nth-child(2)>strong').textContent=Object.values(w.npcs).reduce((n,a)=>n+a.beliefs.length,0);
  if($('#event-list')){$('#event-list').innerHTML=eventList();followTraceCursor();}
  if($('#milestones'))$('#milestones').innerHTML=milestones();
  if($('.world-panel'))$('.world-panel').outerHTML=inspectorTab==='missed'?missedPanel(w):worldPanel(w);
}});
$('#modal').addEventListener('click',event=>{if(event.target===$('#modal')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
render();if(saveError)toast('A previous save could not be loaded. The original remains until your next action; you are starting a fresh case.');

// Asset failures must never prevent play or remove accessible text labels.
document.addEventListener('error',event=>{if(event.target?.classList?.contains('game-art'))event.target.hidden=true;},true);
