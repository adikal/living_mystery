import * as autonomy from '../dist/autonomy-turn.mjs';
import * as morningDirector from '../dist/morning-director.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as directorTurns from '../dist/director-turn.mjs';
import * as characterTurns from '../dist/character-turn.mjs';
import * as art from '../dist/art.mjs';
import * as engine from '../dist/engine.mjs';
import * as claims from '../dist/claims.mjs';
import * as inspector from '../dist/inspector.mjs';
import * as llm from '../dist/llm.mjs';
import * as dialogueSave from '../dist/dialogue-save.mjs';
import * as idbSave from '../dist/idb-save.mjs';

// Exercise the adapter's rendering and handlers without pretending to test browser layout.
function adapter(saved=null,overrides={}){
  let savedText=saved;
  const nodes=new Map(),listeners={};
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',scrollTop:0,dataset:{},addEventListener(){},setAttribute(){},focus(){},showModal(){this.open=true},close(){this.open=false},classList:{add(){},remove(){}}});
    return nodes.get(selector);
  };
  // Expose only explicitly imported names, matching browser module scope.
  // Injecting every engine export previously masked missing UI imports.
  const source=readFileSync(new URL('../dist/ui.mjs',import.meta.url),'utf8');
  const modules={'./autonomy-turn.mjs':autonomy,'./morning-director.mjs':morningDirector,'./director-turn.mjs':directorTurns,'./character-turn.mjs':characterTurns,'./art.mjs':art,'./engine.mjs':engine,'./inspector.mjs':inspector,'./claims.mjs':claims,'./llm.mjs':llm,'./dialogue-save.mjs':dialogueSave,'./idb-save.mjs':idbSave};
  const bindings={};
  for(const match of source.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)){
    for(const name of match[1].split(',').map(s=>s.trim())){
      assert.ok(Object.hasOwn(modules[match[2]],name),`Missing module export: ${name}`);
      bindings[name]=modules[match[2]][name];
    }
  }
  const context=vm.createContext({...bindings,URL,structuredClone,setTimeout,clearTimeout,setInterval,clearInterval,
    fetch:async()=>({ok:false,json:async()=>({})}),AbortController,
    localStorage:{getItem(key){return key==='living-mystery.bellweather.v1'?savedText:null},setItem(key,value){if(key==='living-mystery.bellweather.v1')savedText=value}},
    document:{querySelector:node,addEventListener(type,fn){listeners[type]=fn},body:{dataset:{}}},...overrides});
  vm.runInContext(source.replace(/^import .*;\n/gm,''),context);
  return {submit:id=>listeners.submit({preventDefault(){},target:{id}}),saved:()=>savedText,run:code=>vm.runInContext(code,context),node,change(target){listeners.change({target})},click(action,data={}){listeners.click({target:{closest(){return {dataset:{do:action,...data}}}}})}};
}

test('Recent history stays bounded and chronological; full history pages preserve order',()=>{
  const ui=adapter();
  ui.run("for(let n=0;n<45;n++)dispatch(session,{type:'look'});render()");
  const html=ui.node('#app').innerHTML;
  assert.ok((html.match(/class="journal-entry /g)||[]).length<=12);
  assert.ok(ui.run("const ids=playerView(session).transcript.slice(-12).map(e=>e.id);const calls=[];const original=journalEntry;journalEntry=e=>{calls.push(e.id);return original(e)};game();journalEntry=original;JSON.stringify(calls)===JSON.stringify(ids)"));
  ui.click('history');assert.match(ui.node('#modal').innerHTML,/page 1 of 3/);
  ui.click('history-newer');assert.match(ui.node('#modal').innerHTML,/page 2 of 3/);
  ui.click('history-older');assert.match(ui.node('#modal').innerHTML,/page 1 of 3/);
});

test('Done markers distinguish options, ignore rejection, survive restore, and allow repetition',()=>{
  const ui=adapter();
  assert.equal(ui.run("actionDone({type:'ask',person:'bell',topic:'case'})"),false);
  ui.run("dispatch(session,{type:'ask',person:'bell',topic:'case'});dispatch(session,{type:'inspect',object:'seal'});session=importSession(exportSession(session))");
  assert.equal(ui.run("actionDone({type:'ask',person:'bell',topic:'case'})"),true);
  assert.equal(ui.run("actionDone({type:'ask',person:'bell',topic:'night'})"),false);
  assert.equal(ui.run("actionDone({type:'inspect',object:'seal'})"),false);
  const html=ui.run("chat='bell';conversation(playerView(session))");
  assert.match(html,/action-done/);assert.match(html,/repeat anytime/);assert.doesNotMatch(html,/disabled/);
  ui.run("dispatch(session,{type:'ask',person:'bell',topic:'case'})");
  assert.equal(ui.run('session.world.minute'),486);
});

test('Movement updates the scene and local people; memories render in acquisition order',()=>{
  const ui=adapter();
  ui.run("act({type:'move',to:'manor'})");
  assert.match(ui.node('#app').innerHTML,/scene-transition/);
  assert.doesNotMatch(ui.node('#journal').innerHTML,/SCENE CHANGE| is here\./,'no repeated scene text or who-is-here lines');
  assert.match(ui.node('#app').innerHTML,/talk-faces[\s\S]*data-id="clara"/,'people here are in the Talk tab');
  ui.run("mode='reasoning';reasonSuspect='clara';render()");assert.match(ui.node('#app').innerHTML,/profile-card[\s\S]*Here with you/);ui.run("mode='game';reasonSuspect=null;render()");
  assert.ok(ui.run("const exp=session.world.npcs.clara.memories.map(id=>session.events.find(e=>e.id===id)).filter(e=>e&&(e.kind==='observation'||e.kind==='speech')).map(e=>e.id);const seen=[];const old=memoryCard;memoryCard=id=>{seen.push(id);return old(id)};person='clara';personTab='memories';characterPanel(session.world);memoryCard=old;JSON.stringify(seen)===JSON.stringify(exp)"));
  for(const person of Object.keys(engine.PEOPLE))assert.doesNotThrow(()=>ui.run(`chat=${JSON.stringify(person)};conversation(playerView(session))`));
});

test('World-first inspector has no default side panel and missed opportunities require a reveal',()=>{
  const ui=adapter();ui.run("mode='inspector';render()");
  assert.match(ui.node('#app').innerHTML,/Bellweather at this moment/);
  assert.doesNotMatch(ui.node('#app').innerHTML,/id="character-panel"/);
  ui.run("dispatch(session,{type:'move',to:'manor'});inspectorTab='missed';render()");
  assert.match(ui.node('#app').innerHTML,/Reveal missed opportunities/);
  assert.doesNotMatch(ui.node('#app').innerHTML,/Unexamined evidence at places/);
  ui.click('reveal-missed');assert.match(ui.node('#app').innerHTML,/Unexamined evidence at places/);
  ui.run("inspectorTab='world';perspective='clara';render()");
  assert.match(ui.node('#app').innerHTML,/Clara Vale’s perspective/);
  assert.match(ui.node('#app').innerHTML,/Beliefs held now/);
  ui.run("detailPanel='character';person='clara';render()");
  assert.match(ui.node('#app').innerHTML,/id="character-panel"/);
  ui.click('close-detail');assert.doesNotMatch(ui.node('#app').innerHTML,/id="character-panel"/);
});

test('Trace list follows the cursor and falls back to the nearest filtered event',()=>{
  const ui=adapter();
  ui.run("mode='inspector';inspectorTab='timeline';dispatch(session,{type:'wait',minutes:10});cursor=session.events.findLast(e=>e.kind==='clock').index");
  const list=ui.node('#event-list');let selected;
  list.scrollHeight=2000;list.clientHeight=400;list.scrollTop=0;
  list.getBoundingClientRect=()=>({top:100});
  list.querySelector=selector=>{selected=selector;return {getBoundingClientRect:()=>({top:900,height:60})}};
  ui.run('followTraceCursor()');
  assert.equal(list.scrollTop,630);
  const index=ui.run('filteredEvents().reduce((best,e)=>Math.abs(e.index-cursor)<Math.abs(best.index-cursor)?e:best).index');
  assert.equal(selected,`[data-index="${index}"]`);
  ui.run("query='no matching event anywhere';followTraceCursor()");
  assert.equal(list.scrollTop,630);
});

test('Hiding missed-opportunity spoilers also dismisses the contextual detail panel',()=>{
  const ui=adapter();ui.run("mode='inspector';inspectorTab='missed';missedRevealed=true;detailPanel='event';render()");
  assert.match(ui.node('#app').innerHTML,/id="character-panel"/);
  ui.click('hide-missed');
  assert.doesNotMatch(ui.node('#app').innerHTML,/id="character-panel"/);
  assert.match(ui.node('#app').innerHTML,/Reveal missed opportunities/);
});

test('Completed AI delivery persists across reload and is visible in event audit',async()=>{
  const ui=adapter();
  ui.run("act({type:'ask',person:'bell',topic:'case'})");
  const event=JSON.parse(ui.run("JSON.stringify(session.events.find(e=>e.kind==='speech'&&e.data.listener==='player'))"));
  const record=await llm.realizeDialogue({authoredLine:event.data.assertion},{store:{getItem:k=>k.endsWith('.enabled')?'1':'http://127.0.0.1:8787'},fetchImpl:async(url,init)=>({ok:true,json:async()=>({text:JSON.parse(init.body).system.includes('independent')?'{"verdict":"pass","violations":[]}':'Well. '+event.data.assertion})})});
  ui.run(`dialogueAudit.set(${JSON.stringify(event.id)},${JSON.stringify(record)});persist()`);
  const restored=adapter(ui.saved());
  assert.equal(restored.run('dialogueAudit.size'),1);
  assert.equal(restored.run('realized.size'),1);
  assert.match(restored.node('#app').innerHTML,/Well\./);
  const details=restored.run("cursor=session.events.find(e=>e.kind==='speech'&&e.data.listener==='player').index;eventDetail()");
  assert.match(details,/Dialogue audit/);assert.match(details,/accepted/);
});

test('Reasoning is a player-built workspace; nothing is pre-classified; placing a clue renders it',()=>{
  const ui=adapter();
  ui.run("dispatch(session,{type:'move',to:'vestry'});dispatch(session,{type:'ask',person:'silas',topic:'alibi'});dispatch(session,{type:'inspect',object:'delivery'});mode='reasoning';reasonSuspect='silas';render()");
  const html=ui.node('#app').innerHTML;
  assert.match(html,/suspect-card/);
  assert.match(html,/evidence-tray/);
  assert.match(html,/data-do="board-place"/);
  assert.doesNotMatch(html,/board-card /); // nothing auto-placed
  ui.run("notesFor('silas')['delivery']={pillar:'opportunity',polarity:'supports'};render()");
  const placed=ui.node('#app').innerHTML;
  assert.match(placed,/board-card e-supports/);
  assert.match(placed,/verdict-node/);assert.match(placed,/pillar-node/);assert.match(placed,/board-timeline/);
  const menu=ui.run("chat='silas';conversation(playerView(session))");assert.match(menu,/challenge_delivery/);
});

test('Case artwork decorates views without changing text labels or revealing unacquired evidence',()=>{
  const ui=adapter();
  const html=ui.node('#app').innerHTML;
  assert.match(html,/assets\/last-bell\/square\.jpg/);
  assert.match(html,/assets\/last-bell\/bell\.jpg/);
  assert.match(html,/Village square/);
  assert.doesNotMatch(ui.run('notebookContent(playerView(session))'),/artifact-art/);
  ui.run("notebook='evidence';dispatch(session,{type:'move',to:'manor'});dispatch(session,{type:'inspect',object:'folio'});render()");
  assert.match(ui.run('notebookContent(playerView(session))'),/assets\/last-bell\/folio\.jpg/);
  assert.match(ui.run("avatar('clara')"),/CV<img[^>]*alt=""/);
  assert.equal(ui.run("artImage(undefined,'artifact-art')"),'');
});


test('Reasoning cards preserve corrected testimony and do not invent a death window',()=>{
  const ui=adapter();
  ui.run("dispatch(session,{type:'move',to:'inn'});dispatch(session,{type:'inspect',object:'clock'});mode='reasoning';reasonSuspect='clara';render()");
  assert.doesNotMatch(ui.node('#app').innerHTML,/class="tl-death"/);
  assert.match(ui.node('#app').innerHTML,/medical window not yet established/);
  ui.run("dispatch(session,{type:'present',person:'ada',clue:'clock'});dispatch(session,{type:'ask',person:'ada',topic:'night'});notesFor('rowan').ada={pillar:'opportunity',polarity:'supports'};reasonSuspect='rowan';render()");
  const card=ui.node('#app').innerHTML.match(/<article class="board-card[\s\S]*?<\/article>/)[0];
  assert.match(card,/I was wrong about the time/);assert.doesNotMatch(card,/Ada says she saw Rowan/);
  ui.run("dispatch(session,{type:'move',to:'manor'});dispatch(session,{type:'inspect',object:'body'});render()");
  assert.match(ui.node('#app').innerHTML,/class="tl-death"/);
});

test('Doctor testimony establishes the timeline window without requiring the notebook examination',()=>{
  const ui=adapter();ui.run("dispatch(session,{type:'move',to:'surgery'});dispatch(session,{type:'ask',person:'iris',topic:'night'})");
  assert.equal(ui.run("session.world.player.evidence.some(e=>e.clue==='medical')"),false);
  assert.match(ui.run("suspectTimeline('clara',playerClaims(session),0,500,0,100)"),/class="tl-death"/);
});

test('Board placements persist with the save and imports replace rather than mix investigations',async()=>{
  const ui=adapter();ui.run("dispatch(session,{type:'move',to:'vestry'});dispatch(session,{type:'inspect',object:'delivery'})");
  ui.click('board-place',{suspect:'silas',clue:'delivery',pillar:'opportunity'});
  const saved=ui.saved();assert.equal(JSON.parse(saved).reasoning.notes.silas.delivery.polarity,'supports');
  const reloaded=adapter(saved);assert.equal(reloaded.run("boardNotes.silas.delivery.pillar"),'opportunity');
  const importFile=async(text)=>{ui.change({id:'import-file',files:[{size:text.length,text:async()=>text}],value:'fixture'});await new Promise(r=>setTimeout(r,0));};
  await importFile(engine.exportSession(engine.createSession()));
  assert.equal(ui.run('JSON.stringify(boardNotes)'),'{}');
  await importFile(saved);assert.equal(ui.run("boardNotes.silas.delivery.pillar"),'opportunity');
  ui.click('restart');assert.equal(ui.run('JSON.stringify(boardNotes)'),'{}');
  assert.deepEqual(JSON.parse(ui.saved()).reasoning.notes,{});
});

test('Legacy device board migrates only on startup of its existing save',()=>{
  const session=engine.createSession();engine.dispatch(session,{type:'move',to:'vestry'});engine.dispatch(session,{type:'inspect',object:'delivery'});
  const store=new Map([['living-mystery.bellweather.v1',engine.exportSession(session)],['living-mystery.board.v1',JSON.stringify({silas:{delivery:{pillar:'opportunity',polarity:'supports'}}})]]);
  const ui=adapter(null,{localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}});
  assert.equal(ui.run('boardNotes.silas.delivery.pillar'),'opportunity');
  ui.run('saveBoardNotes()');assert.equal(store.has('living-mystery.board.v1'),false);
  assert.equal(JSON.parse(store.get('living-mystery.bellweather.v1')).reasoning.notes.silas.delivery.polarity,'supports');
});

test('Character mode renders free-text input and commits one audited turn without a second voice pass',async()=>{
  const settings=new Map(),store={getItem:k=>settings.get(k),setItem:(k,v)=>settings.set(k,v)};
  llm.setLlmConfig({endpoint:'http://127.0.0.1:8787',enabled:true,reasoning:true},store);
  const ui=adapter(null,{llmActive:()=>true,llmConfig:()=>({reasoning:true}),
    proposeCharacterTurn:t=>characterTurns.proposeCharacterTurn(t,{store,fetchImpl:async(_url,init)=>{
      const body=JSON.parse(init.body),a=t.context.accounts.find(a=>a.id==='ask:alibi');
      const p={intent:'deceive',account:a.id,utterance:a.statement,claims:a.claims,sources:a.sources,trust:'unchanged',belief:'remember_only',engagement:'continue',rationale:'Give my account.'};
      return {ok:true,json:async()=>({text:body.system===characterTurns.CHARACTER_CRITIC?'{"verdict":"pass","violations":[]}':JSON.stringify(p)})};
    }})});
  ui.run("dispatch(session,{type:'move',to:'vestry'});chat='silas';actionGroup='talk';render()");
  assert.match(ui.node('#app').innerHTML,/Speak in your own words/);
  await ui.run("runCharacter('silas','Where were you last night?')");
  assert.equal(ui.run('characterBusy'),false);
  assert.equal(ui.run('session.world.npcs.silas.dialogueState.turns'),1);
  assert.equal(ui.run('dialogueAudit.size'),0);
  ui.run("cursor=session.events.findLast(e=>e.data.characterAudit).index");
  assert.match(ui.run('eventDetail()'),/Character turn audit/);
  assert.equal(engine.importSession(ui.saved()).world.npcs.silas.dialogueState.turns,1);
});

test('Pending character requests block world actions and cannot overwrite a restarted session',async()=>{
  let resolve;
  const ui=adapter(null,{llmActive:()=>true,llmConfig:()=>({reasoning:true}),proposeCharacterTurn:()=>new Promise(r=>resolve=r)});
  ui.run("dispatch(session,{type:'move',to:'vestry'})");
  const pending=ui.run("runCharacter('silas','Where were you?')");
  const before=ui.run('session.world.minute');ui.run("act({type:'wait',minutes:10})");assert.equal(ui.run('session.world.minute'),before);
  ui.click('restart');const count=ui.run('session.events.length');
  resolve({proposal:null,audit:{reason:'cancelled'}});await pending;
  assert.equal(ui.run('session.events.length'),count);assert.equal(ui.run('characterBusy'),false);
});


test('Scripted mode never calls a stylist, including legacy voice-only settings',()=>{
 for(const enabled of [false,true]){
  const ui=adapter(null,{llmActive:()=>enabled,llmConfig:()=>({enabled,reasoning:false}),realizeDialogue:()=>{throw Error('No stylist calls allowed')},proposeCharacterTurn:()=>{throw Error('No character calls allowed')}});
  ui.run("act({type:'ask',person:'bell',topic:'case'})");
  assert.equal(ui.run('session.world.minute'),483);
  assert.equal(ui.run('dialogueAudit.size'),0);
  assert.match(ui.node('#app').innerHTML,/Bring me a suspect/);
  ui.click('llm');const settings=ui.node('#modal').innerHTML;
  assert.equal((settings.match(/type="checkbox"/g)||[]).length,1);
  assert.doesNotMatch(settings,/name="enabled"/);
 }
});

test('Notebook profiles expose only public descriptions and local trust and stress',()=>{
 const ui=adapter();ui.run("notebook='people';render()");
 const profiles=JSON.parse(ui.run('JSON.stringify(playerView(session).profiles)'));
 assert.deepEqual(Object.keys(profiles.find(p=>p.id==='bell')).sort(),['color','id','initials','metrics','name','public','role']);
 assert.ok(profiles.find(p=>p.id==='bell').metrics);
 assert.equal(profiles.find(p=>p.id==='clara').metrics,null);
 const html=ui.node('#app').innerHTML;
 assert.doesNotMatch(html,/Stress factor/,'meters moved to the conversation');
 ui.run("chat='bell';render()");const talk=ui.node('#app').innerHTML;assert.match(talk,/dlg-meters[\s\S]*Trust in you[\s\S]*Stress/);ui.run("chat=null;render()");
 for(const p of Object.values(engine.PEOPLE))assert.ok(!html.includes(p.secret));
 assert.doesNotMatch(html,/Private background|Competing goals|Relationships/);
 ui.run("act({type:'move',to:'manor'})");
 assert.ok(ui.run("playerView(session).profiles.find(p=>p.id==='clara').metrics!==null"));
 assert.equal(ui.run("playerView(session).profiles.find(p=>p.id==='bell').metrics"),null);
});


test('The single AI checkbox enables both character settings and disables them together',()=>{
 const config={endpoint:'http://127.0.0.1:8787',enabled:false,reasoning:false};
 const ui=adapter(null,{llmConfig:()=>config,llmActive:()=>config.enabled,setLlmConfig:next=>Object.assign(config,next)});
 const endpoint={value:config.endpoint},toggle={checked:true};
 ui.node('#modal').querySelector=selector=>selector==='[name=endpoint]'?endpoint:selector==='[name=reasoning]'?toggle:null;
 ui.submit('llm-form');assert.equal(config.enabled,true);assert.equal(config.reasoning,true);
 toggle.checked=false;ui.submit('llm-form');assert.equal(config.enabled,false);assert.equal(config.reasoning,false);
});

test('World Director settings are independent of AI; successful checks persist and render audits',async()=>{
 let on=false;
 const ui=adapter(null,{directorEnabled:()=>on,setDirectorEnabled:v=>{on=v},llmActive:()=>false,
   commitDirectedTurn:(s,t,opts)=>directorTurns.commitDirectedTurn(s,t,{...opts,fetchImpl:async(_url,init)=>({ok:true,json:async()=>({results:JSON.parse(init.body).queries.map(({id,query})=>({id,query,result:{status:'sat',witness:t.events.find(e=>e.id===id).data.director.witness}}))})})})});
 ui.click('director');assert.match(ui.node('#modal').innerHTML,/independently of AI/);
 ui.click('toggle-director');assert.equal(on,true);
 ui.run("dispatch(session,{type:'move',to:'manor'});dispatch(session,{type:'inspect',object:'accounts'});dispatch(session,{type:'move',to:'vestry'});dispatch(session,{type:'present',person:'silas',clue:'ledger'})");
 await ui.run("runDirectedAction({type:'endConversation'})");
 assert.ok(ui.run("session.events.some(e=>e.data.directorResult?.status==='verified')"));
 assert.match(ui.run("cursor=session.events.findLast(e=>e.data.directorResult).index;eventDetail()"),/Investigation route: route_found/);
 const restored=adapter(ui.saved());assert.ok(restored.run("session.events.some(e=>e.data.directorResult?.status==='verified')"));
});

test('Cancelling a pending symbolic turn leaves the world unchanged and clears the pending UI',async()=>{
 let resolve;
 const ui=adapter(null,{directorEnabled:()=>true,commitDirectedTurn:(_s,_t,{signal,onChecking})=>new Promise(r=>{onChecking();resolve=r;signal.addEventListener('abort',()=>r({status:'cancelled'}))})});
 const before=ui.run('JSON.stringify(session.world)');
 const pending=ui.run("runDirectedAction({type:'wait',minutes:5})");
 assert.match(ui.node('#app').innerHTML,/World Director is checking the turn/);
 ui.click('cancel-character');await pending;
 assert.equal(ui.run('JSON.stringify(session.world)'),before);
 assert.equal(ui.run('directorPending'),false);
});


test('Wait 30 minutes with Director enabled clones and commits through actual UI imports',async()=>{
 const ui=adapter(null,{directorEnabled:()=>true,llmActive:()=>false});
 await ui.run("runDirectedAction({type:'wait',minutes:30})");
 assert.equal(ui.run('session.world.minute'),510);
 assert.notEqual(ui.node('#toast').textContent,'copy is not defined');
 assert.equal(ui.run('characterBusy'),false);
});

test('Director progress exists only while checking, with no lingering timed notification',async()=>{
 let finish;
 const ui=adapter(null,{directorEnabled:()=>true,llmActive:()=>false,
   commitDirectedTurn:(s,t,{onChecking})=>new Promise(resolve=>{onChecking();finish=()=>{s.world=t.world;s.events=t.events;resolve({status:'verified'});};})});
 const pending=ui.run("runDirectedAction({type:'wait',minutes:5})");
 assert.match(ui.node('#app').innerHTML,/World Director is checking the turn/);
 assert.doesNotMatch(ui.node('#toast').textContent??'',/World Director is checking the turn/);
 assert.equal(ui.run('session.world.minute'),480);
 finish();await pending;
 assert.equal(ui.run('session.world.minute'),485);
 assert.doesNotMatch(ui.node('#app').innerHTML,/World Director is checking the turn/);
 assert.doesNotMatch(ui.node('#toast').textContent??'',/World Director is checking the turn/);
 assert.equal(ui.run('characterBusy'),false);
});


test('Scripted turns with no symbolic plans never display a checking indicator',async()=>{
 const ui=adapter(null,{directorEnabled:()=>true,llmActive:()=>false});
 ui.run("const shown=[];const renderBeforeCheck=render;render=()=>{renderBeforeCheck();shown.push(document.querySelector('#app').innerHTML);}");
 await ui.run("runDirectedAction({type:'ask',person:'bell',topic:'case'})");
 assert.ok(ui.run("session.events.some(e=>e.kind==='speech'&&e.actor==='bell')"));
 assert.equal(ui.run("shown.some(html=>html.includes('World Director is checking the turn'))"),false);
 assert.equal(ui.run('characterBusy'),false);
});

test('Case selection, restart and restore keep scenario-specific evidence and accusation options',()=>{
 const ui=adapter(null,{llmActive:()=>false});
 ui.click('start-case',{id:'bellweather-02'});
 assert.equal(ui.run('session.world.caseId'),'bellweather-02');assert.match(ui.node('#app').innerHTML,/The Codicil/);
 ui.run("act({type:'move',to:'manor'});act({type:'inspect',object:'body'});act({type:'move',to:'square'})");ui.click('accusation');
 assert.match(ui.node('#modal').innerHTML,/candlestick/);assert.match(ui.node('#modal').innerHTML,/eviction/);
 const saved=ui.saved(),restored=adapter(saved);assert.equal(restored.run('CASE.culprit'),'clara');
 assert.match(restored.run("CLUES.medical.text"),/silver rim/);
 restored.click('restart');assert.equal(restored.run('session.world.caseId'),'bellweather-02');assert.equal(restored.run('session.world.player.evidence.length'),0);
});

test('Alternate case renders scoped profiles, missed clues and prehistory',()=>{
 const ui=adapter(null,{llmActive:()=>false});ui.click('start-case',{id:'bellweather-03'});
 assert.doesNotMatch(ui.node('#app').innerHTML,/fatally strikes|I killed/);
 assert.equal(ui.run('missedAt(session,session.events.length-1).encounters.length'),0,'Prehistory was never available to overhear');
 ui.run("mode='inspector';person='silas';personTab='profile';detailPanel='character';render()");
 assert.doesNotMatch(ui.node('#app').innerHTML,/He killed Edmund with his brass seal/);
 ui.run("dispatch(session,{type:'move',to:'greenhouse'});cursor=null;inspectorTab='missed';missedRevealed=true;render()");
 assert.match(ui.node('#app').innerHTML,/damaged meeting object/i);
});


test('New feed content scrolls after scripted, Director and AI turns; panel renders preserve reading position',async()=>{
 const ui=adapter(null,{llmActive:()=>true,llmConfig:()=>({reasoning:true}),proposeCharacterTurn:async(ticket)=>({proposal:null,audit:{reason:'offline',context:ticket.context,attempts:[]}})});
 const feed=ui.node('#journal'),side=ui.node('.notebook-content');feed.scrollHeight=1500;feed.scrollTop=20;side.scrollTop=87;
 ui.run('render()');assert.equal(feed.scrollTop,20);assert.equal(side.scrollTop,87);
 ui.run("act({type:'look'})");assert.equal(feed.scrollTop,1500);assert.equal(side.scrollTop,87);
 feed.scrollTop=12;feed.scrollHeight=1750;
 await ui.run("runDirectedAction({type:'wait',minutes:5})");assert.equal(feed.scrollTop,1750);
 feed.scrollTop=30;feed.scrollHeight=2000;
 await ui.run("runCharacter('bell','What makes a convincing case?',{type:'ask',person:'bell',topic:'case'})");
 assert.ok(ui.run("session.events.some(e=>e.kind==='speech'&&e.actor==='bell')"));
 assert.equal(feed.scrollTop,2000);assert.equal(side.scrollTop,87);
 feed.scrollTop=42;ui.run('render()');assert.equal(feed.scrollTop,42);
});

test('Life inspector follows the selected time and scripted mode never calls autonomous models',()=>{
 const ui=adapter(null,{llmActive:()=>false,deliberateWorld:()=>{throw Error('AI must be off')}});
 ui.click('start-case',{id:'bellweather-01'});ui.run("act({type:'wait',minutes:30});mode='inspector';person='ada';detailPanel='character';render()");
 assert.match(ui.node('#app').innerHTML,/Daily life/);assert.match(ui.node('#app').innerHTML,/Serve customers/);
 ui.run("cursor=0;render()");assert.doesNotMatch(ui.node('#app').innerHTML,/<h3>Daily life<\/h3>/);
});

test('Background deliberation never blocks or discards the player turn',async()=>{
 let started=false;const ui=adapter(null,{llmActive:()=>true,llmConfig:()=>({reasoning:true}),directorEnabled:()=>false,deliberateWorld:()=>{started=true;return new Promise(()=>{});}});
 ui.click('start-case',{id:'bellweather-01'});const before=ui.run('exportSession(session)');
 await ui.run("runDirectedAction({type:'wait',minutes:5})");
 // The turn commits immediately; deliberation is detached, not awaited, and shows no blocking spinner.
 assert.notEqual(ui.run('exportSession(session)'),before);
 assert.equal(ui.run('characterBusy'),false);
 assert.doesNotMatch(ui.node('#app').innerHTML,/considering their next activity/);
 await new Promise(r=>setTimeout(r,0)); // let the detached deliberation start
 assert.equal(started,true);
 ui.click('cancel-character'); // aborting the detached deliberation leaves the applied turn intact
 assert.notEqual(ui.run('exportSession(session)'),before);
});

test('A new player turn aborts in-flight background deliberation so it cannot stale the ticket',async()=>{
 let sig;const ui=adapter(null,{llmActive:()=>true,llmConfig:()=>({reasoning:true}),directorEnabled:()=>false,
  deliberateWorld:(_s,{signal})=>{sig=signal;return new Promise(()=>{});},
  proposeCharacterTurn:async(ticket)=>({proposal:null,audit:{reason:'offline',context:ticket.context,attempts:[]}})});
 ui.click('start-case',{id:'bellweather-01'});
 await ui.run("runDirectedAction({type:'wait',minutes:5})");
 await new Promise(r=>setTimeout(r,0)); // let the detached deliberation start and capture its signal
 assert.equal(sig?.aborted,false);
 await ui.run("runCharacter('bell','What makes a case?',{type:'ask',person:'bell',topic:'case'})");
 assert.equal(sig?.aborted,true,'the new turn aborted the detached deliberation');
 assert.ok(ui.run("session.events.some(e=>e.kind==='speech'&&e.actor==='bell')"),'the character turn applied, not stale');
});

test('A settings change cannot bypass an in-flight Director deferral',async()=>{
 let enabled=true;
 const ui=adapter(null,{directorEnabled:()=>enabled,commitDirectedTurn:async()=>{enabled=false;return {status:'defer',reason:'No valid route'};},llmActive:()=>false});
 ui.click('start-case',{id:'bellweather-01'});const before=ui.run('exportSession(session)');
 await ui.run("runDirectedAction({type:'wait',minutes:5})");
 assert.equal(ui.run('exportSession(session)'),before);
});

test('In-room disclosure groups objects into sections and hides gated leads until they are reached',()=>{
 const ui=adapter(null,{llmActive:()=>false});
 // deep-1 is a delayed-poison case: at the manor only the decanter is reachable; the tray ring is gated behind it.
 ui.run("session=createSession(1,'deep-1');syncCase();actionGroup='inspect';act({type:'move',to:'manor'});render()");
 const html=ui.node('#app').innerHTML;
 assert.match(html,/room-section-head/,'reachable objects are grouped into sections');
 assert.match(html,/the rinsed decanter/,'the first, reachable ladder step is shown');
 assert.doesNotMatch(html,/a faint tray ring/,'the gated next step is hidden until its prerequisite is found');
 assert.match(html,/only come to light/,'a hint signals that hidden leads remain');
 // Inspecting the prerequisite reveals the next lead in place (progressive disclosure).
 ui.run("act({type:'inspect',object:'vessel'});render()");
 assert.match(ui.node('#app').innerHTML,/a faint tray ring/,'the next lead appears once its prerequisite is examined');
});

test('A generated kernel case plays in the Bellweather UI: case suspects, how and why pickers, pillar status, hidden leads, case topics',()=>{
 const records=JSON.parse(readFileSync(new URL('../dist/cases/archive/mk-bw-pair.json',import.meta.url),'utf8'));
 const ui=adapter(null,{llmActive:()=>false});
 ui.run(`startGenerated(registerKernelCase(${JSON.stringify(records)}),'Test')`);
 assert.equal(ui.run('session.world.caseId'),'mk-bw-pair');
 assert.ok(ui.run('CASE.kernel'),'the runtime case is the kernel case');
 const surface=records.signs.find(s=>s.kind!=='testimony'&&!(s.requires||[]).length);
 ui.run(`act({type:'move',to:${JSON.stringify(surface.at)}});act({type:'inspect',object:${JSON.stringify(surface.id)}});if(session.world.player.location!==session.world.npcs[CASE.constable].location)act({type:'move',to:session.world.npcs[CASE.constable].location})`);
 ui.click('accusation');
 const form=ui.node('#modal').innerHTML;
 for(const h of records.question.candidates)assert.match(form,new RegExp(`value="${h.facts.actor}"`),'every candidate is accusable');
 assert.match(form,/name="method"/,'the player names how it was done');
 assert.match(form,/name="motive"/,'and why');
 assert.match(form,/pillar-strip/,'motive, means and opportunity status from the held evidence');
 const hidden=records.signs.find(s=>s.kind!=='testimony'&&(s.requires||[]).length);
 ui.run(`act({type:'move',to:${JSON.stringify(hidden.at)}});actionGroup='inspect';render()`);
 assert.ok(!ui.node('#app').innerHTML.includes(`data-id="${hidden.id}"`),'a gated clue is hidden until earned');
 assert.deepEqual(JSON.parse(ui.run('JSON.stringify(topicsFor("bell"))')).map(([t])=>t),['case','night'],'Bell briefs the detective');
 assert.deepEqual(JSON.parse(ui.run('JSON.stringify(topicsFor("clara"))')).map(([t])=>t),['night',...((records.knowledge||{}).clara?.length?['everyday']:[])]);
});

test('Every UI mode and inspector tab renders for a generated kernel case, before and after play',()=>{
 const records=JSON.parse(readFileSync(new URL('../dist/cases/archive/mk-bw-poison.json',import.meta.url),'utf8'));
 const ui=adapter(null,{llmActive:()=>false});
 ui.run(`startGenerated(registerKernelCase(${JSON.stringify(records)}),'Test')`);
 const surface=records.signs.find(s=>s.kind!=='testimony'&&!(s.requires||[]).length);
 ui.run(`act({type:'move',to:${JSON.stringify(surface.at)}});act({type:'inspect',object:${JSON.stringify(surface.id)}})`);
 for(const code of ["mode='game';notebook='evidence';render()","notebook='people';render()","notebook='hints';render()",
   "mode='reasoning';reasonSuspect=null;render()","reasonSuspect='silas';render()",
   "mode='inspector';inspectorTab='world';render()","inspectorTab='timeline';render()","inspectorTab='missed';missedRevealed=true;render()",
   "detailPanel='character';person='ada';personTab='profile';render()","personTab='memories';render()"])
  assert.doesNotThrow(()=>ui.run(code),code);
 const restored=adapter(ui.saved(),{llmActive:()=>false});
 assert.equal(restored.run('session.world.caseId'),'mk-bw-poison');
 assert.match(restored.node('#app').innerHTML,/Vale Manor|Rook/);
});

// A stub of the static server + generator server for the generation UI.
function genStub(records){
 const events=[{kind:'phase',phase:'seed',t:0},{kind:'seed',t:40,case:records,metrics:{solve_depth:0,twist:false}},
  {kind:'step_start',t:41,step:1,mode:'twist',target:records.signs[0].id,target_title:records.signs[0].title},
  {kind:'step',t:90,step:1,mode:'twist',accepted:true,operator:'Mislead',blocks:['Lie','Alibi'],story:'Ada lies to protect Miss Vale.',
   attempts:[[]],critic:[{pass:true,issues:[]}],seconds:49,added:{attitudes:[{id:'a_x',agent:'ada',mode:'wants',content:'protect Miss Vale'}]},metrics:{solve_depth:2,twist:true,herrings:[],motive:[],means:[]}}];
 let status='running',started=false;
 const job=()=>({id:'j1',status,title:'The Study Door',premise:'Edmund Vale is found dead.',elapsed:95,result:status==='done'?{file:'live/mk-live-j1.json',id:'mk-live-j1',title:'The Study Door'}:null});
 const json=(obj,ok=true,code=200)=>Promise.resolve({ok,status:code,json:async()=>obj});
 const fetch=async(url,opts={})=>{
  if(url.endsWith('cases/generated/index.json'))return json([{id:'mk-bw-pair',file:'mk-bw-pair.json',title:'The Greenhouse Steps',blurb:'b'}]);
  if(url.endsWith('cases/generated/live/index.json'))return json([],false,404);
  if(url.includes('cases/generated/live/mk-live-j1.json'))return json({...records,id:'mk-live-j1',title:'The Study Door'});
  if(url.endsWith('/jobs')&&opts.method==='POST'){started=true;return json(job(),true,201);}
  if(url.includes('/jobs/current'))return started?json(job()):json({error:'no_job'},false,404);
  if(url.includes('/jobs/j1')){const since=Number(new URL(url).searchParams.get('since')||0);return json({...job(),since,next:events.length,eventsNew:events.slice(since)});}
  return json({},false,404);
 };
 return {fetch,finish:()=>{status='done';events.push({kind:'done',t:120,result:job().result});}};
}

test('The chooser offers one generator, the shipped cases and the original — no old generators',async()=>{
 const records=JSON.parse(readFileSync(new URL('../dist/cases/archive/mk-bw-pair.json',import.meta.url),'utf8'));
 const stub=genStub(records),ui=adapter(null,{llmActive:()=>false,fetch:stub.fetch});
 ui.click('choose-case');await new Promise(r=>setTimeout(r,5));
 const html=ui.node('#modal').innerHTML;
 assert.deepEqual([...html.matchAll(/data-do="generate-new" data-level="(\w+)"/g)].map(m=>m[1]),['easy','medium','hard'],'one generator, one button per difficulty');
 assert.doesNotMatch(html,/generate-ai|generate-deep|generate-case|validated case|with AI/i);
 assert.match(html,/The Greenhouse Steps/);assert.match(html,/data-do="start-case"/);
});

test('Generation shows high-level progress with the spoiler collapsed, full detail inside it, and plays the result',async()=>{
 const records=JSON.parse(readFileSync(new URL('../dist/cases/archive/mk-bw-pair.json',import.meta.url),'utf8'));
 const stub=genStub(records),ui=adapter(null,{llmActive:()=>false,fetch:stub.fetch});
 ui.click('generate-new');await new Promise(r=>setTimeout(r,10));
 // progress updates are written into the open panel (inside #modal in a real DOM)
 const html=ui.node('#gen-panel').innerHTML||ui.node('#modal').innerHTML;
 assert.match(html,/The Study Door/);assert.match(html,/Solve depth/);assert.match(html,/Misdirection/);
 assert.match(html,/<details class="gen-spoiler" data-open-key="gen-spoiler">/,'the spoiler is closed by default');
 const culprit=records.question.candidates.find(h=>h.id===records.question.truth).facts.actor;
 const spoiler=html.slice(html.indexOf('gen-spoiler-body'));
 assert.match(spoiler,/THE CULPRIT/);assert.match(spoiler,/Layer 1/);assert.match(spoiler,/Ada lies to protect Miss Vale/);
 assert.match(spoiler,/What really happened/);assert.ok(spoiler.includes(records.people.find(p=>p.id===culprit).name));
 assert.doesNotMatch(html.slice(0,html.indexOf('gen-spoiler')),/THE CULPRIT/,'nothing is revealed outside the spoiler');
 ui.run('clearTimeout(genTimer)');stub.finish();await ui.run('pollGeneration()');
 // updates land inside the open panel (in a real DOM that is part of #modal)
 assert.match(ui.node('#modal').innerHTML+ui.node('#gen-panel').innerHTML,/Play this case/);
 ui.click('start-generated',{file:'live/mk-live-j1.json'});await new Promise(r=>setTimeout(r,10));
 assert.equal(ui.run('session.world.caseId'),'mk-live-j1');
});

test('Generation reports a missing generator server clearly',async()=>{
 const ui=adapter(null,{llmActive:()=>false,fetch:async()=>{throw Error('connection refused');}});
 ui.click('generate-new');await new Promise(r=>setTimeout(r,5));
 assert.match(ui.node('#modal').innerHTML,/generator is not running/);
});

test('Right panel is Talk, Evidence, Hints; the victim is on the Clue Board; new evidence is boxed in the chat and added to the Evidence tab',()=>{
 const records=JSON.parse(readFileSync(new URL('../dist/cases/archive/mk-bw-pair.json',import.meta.url),'utf8'));
 const ui=adapter(null,{llmActive:()=>false});
 ui.run(`startGenerated(registerKernelCase(${JSON.stringify(records)}),'Test')`);
 const app=ui.node('#app').innerHTML,tabs=app.slice(app.indexOf('Notebook views'));
 ui.run(`mode='reasoning';render()`);
 assert.ok(tabs.indexOf('Talk')>=0&&tabs.indexOf('Talk')<tabs.indexOf('Evidence')&&!/data-id="people"/.test(tabs),`Talk, Evidence, Hints (no People): ${tabs.slice(0,200)}`);
 assert.match(ui.node('#app').innerHTML,/cast-chip victim[\s\S]*?Edmund Vale · deceased/,'the victim, greyed out, on the Clue Board');ui.run(`mode='game';render()`);
 const surface=records.signs.find(s=>s.kind!=='testimony'&&!(s.requires||[]).length);
 ui.run(`act({type:'move',to:${JSON.stringify(surface.at)}});act({type:'inspect',object:${JSON.stringify(surface.id)}})`);
 assert.match(ui.run('visibleTranscript(playerView(session).transcript).slice(-5).map(journalEntry).join("")'),/clue-found/,'the discovery appears in the chat, as a boxed card');
 assert.ok(ui.run('session.world.player.evidence.length')>0,'and in the Evidence tab');
});

test('Reasoning board is correct for a generated case: its own night, scene and three pillars, honest check marks',()=>{
 const records=JSON.parse(readFileSync(new URL('./fixtures/mk-cordial.json',import.meta.url),'utf8'));
 const ui=adapter(null,{llmActive:()=>false});
 ui.run(`startGenerated(registerKernelCase(${JSON.stringify(records)}),'Test')`);
 // play the whole case headlessly, then open the board on the culprit
 ui.run(`(()=>{const B=caseTables(session).behavior;for(let i=0;i<160;i++){const h=B.hints(session);const x=caseTables(session).CLUES[h.id]&&${JSON.stringify(records.signs)}.find(z=>z.id===h.id);if(!x)break;
   if(x.kind==='testimony'){dispatch(session,{type:'move',to:session.world.npcs[x.speaker].location});dispatch(session,{type:'ask',person:x.speaker,topic:x.id});}
   else{dispatch(session,{type:'move',to:x.at});dispatch(session,{type:'inspect',object:x.id});}}})()`);
 ui.run(`mode='reasoning';reasonSuspect='ada';render()`);
 const html=ui.node('#app').innerHTML;
 assert.doesNotMatch(html,/data-drop-pillar="alibi"/,'three columns: motive, means, opportunity');
 for(const k of ['motive','means','opportunity'])assert.match(html,new RegExp(`data-drop-pillar="${k}"`));
 assert.equal((html.match(/s-established/g)||[]).length,3,'all three established for the culprit once everything is found');
 assert.match(html,/tl-death/,'the time window comes from the examination');
 assert.match(html,/tl-bar/,'whereabouts appear on the timeline');
 ui.run(`reasonSuspect='clara';render()`);
 assert.ok((ui.node('#app').innerHTML.match(/s-established/g)||[]).length<3,'an innocent is not fully established');
 ui.run(`notesFor('ada')[session.world.player.evidence[0].clue]={pillar:'alibi',polarity:'supports'};reasonSuspect='ada';render()`);
 assert.match(ui.node('#app').innerHTML,/board-card/,'an old "alibi" filing still shows (under opportunity)');
});

test('The visible village: map, scene cast, pinned objects, two-sided dialogue with free text first, inventory, opening',()=>{
 const records=JSON.parse(readFileSync(new URL('./fixtures/mk-cordial.json',import.meta.url),'utf8'));
 const ui=adapter(null,{llmActive:()=>true,llmConfig:()=>({reasoning:true})});
 ui.run(`startGenerated(registerKernelCase(${JSON.stringify(records)}),'Test')`);
 // the opening scene opens once, with the cast and the victim but no secrets
 const opening=ui.node('#modal').innerHTML;
 assert.match(opening,/Who killed Dorothy Pruett\?/);
 ui.run('openingModal(1)');const cast=ui.node('#modal').innerHTML;
 assert.match(cast,/cast-card victim/);assert.match(cast,/Ada Finch/);
 for(const a of records.attitudes)assert.ok(!cast.includes(a.content),'no attitude (secret) is shown in the cast');
 ui.click('opening-done');
 // map: every place is a pin; the current place is marked
 ui.run("mode='game';render()");
 let html=ui.node('#app').innerHTML;
 for(const pl of records.setting.places)assert.match(html,new RegExp(`class="map-pin[^"]*"[^>]*data-id="${pl.id}"`),`pin for ${pl.id}`);
 assert.match(html,/you-marker/);
 // scene: go where someone is; they stand in the scene; objects are pinned; hidden leads are not shown
 ui.run("act({type:'move',to:'inn'})");html=ui.node('#app').innerHTML;
 assert.match(html,/class="talk-face[^"]*" data-do="chat" data-id="ada" data-drop-person="ada"/,'people here are faces in the Talk tab');
 assert.match(html,/room-left[\s\S]*LOOK AROUND/,'the left panel lists what to examine here');assert.match(html,/<div class="scene-description">/);assert.doesNotMatch(html,/Look at the scene/);

 const hidden=records.signs.filter(x=>x.at==='inn'&&x.kind!=='testimony'&&(x.requires||[]).length).map(x=>x.title);
 for(const t of hidden)assert.ok(!html.includes(`<span>${t}</span>`),`hidden lead not shown: ${t}`);
 // dialogue: two-sided, free text first, then question chips; lines neutral
 ui.run("chat='ada';render()");html=ui.node('#app').innerHTML;
 assert.match(html,/class="dialogue"/);assert.match(html,/Speak in your own words/,'free text is always there');assert.match(html,/dialogue-options chips/);
 ui.run("act({type:'ask',person:'ada',topic:'night'})");html=ui.node('#app').innerHTML;
 assert.match(html,/bubble-row mine[\s\S]*bubble-row theirs/,'your line on the right, theirs on the left');
 assert.doesNotMatch(html,/bubble[^"]*(lie|decept)/i,'nothing marks a lie');
 // inventory: grouped by type, or newest first; draggable onto people
 ui.run("invSort='type';dispatch(session,{type:'endConversation'});dispatch(session,{type:'move',to:'surgery'});dispatch(session,{type:'inspect',object:'s_medical'});chat=null;notebook='evidence';invSort='type';render()");
 html=ui.node('#app').innerHTML;assert.match(html,/inv-group/,`notebook=${ui.run('notebook')} evidence=${ui.run('session.world.player.evidence.length')} ${html.slice(html.indexOf('notebook-content'),html.indexOf('notebook-content')+300)}`);assert.match(html,/draggable="true" data-drag-clue=/);
 ui.run("invSort='time';render()");assert.doesNotMatch(ui.node('#app').innerHTML,/inv-group/);
 assert.match(ui.node('#app').innerHTML,/data-drag-object=|Nothing to inspect|no longer/,'objects in Look around are draggable');
});

test('A pending line in the conversation is escaped once (apostrophes show as apostrophes)',()=>{
 const ui=adapter(null,{llmActive:()=>true,llmConfig:()=>({reasoning:true})});
 ui.run("dispatch(session,{type:'move',to:'manor'});chat='clara';characterBusy=true;characterPending={person:'clara',text:\"I've seen your skirt <b>\"};render()");
 const html=ui.node('#app').innerHTML;
 assert.match(html,/I&#39;ve seen your skirt &lt;b&gt;/,'escaped once');assert.doesNotMatch(html,/&amp;#39;|&amp;lt;/,'not twice');
 ui.run('characterBusy=false;characterPending=null');
});

test('Conversation: the middle is the conversation; your words and the questions are in the Talk panel',()=>{
 const ui=adapter(null,{llmActive:()=>true,llmConfig:()=>({reasoning:true})});
 ui.run("dispatch(session,{type:'move',to:'manor'});chat='clara';render()");
 const html=ui.node('#app').innerHTML;
 assert.match(html,/class="talk-panel"[\s\S]*Speak in your own words/,'your own words in the Talk panel');assert.doesNotMatch(html.slice(html.indexOf('class="dialogue"'),html.indexOf('</section>',html.indexOf('class="dialogue"'))),/Speak in your own words/,'the middle is the conversation only');
 assert.match(html,/class="talk-panel"[\s\S]*dialogue-options chips/,'the question choices in the Talk panel');
});

test('A discovery in the chat shows the clue picture and a separate title',()=>{
 const records=JSON.parse(readFileSync(new URL('./fixtures/mk-cordial.json',import.meta.url),'utf8'));
 const ui=adapter(null,{llmActive:()=>false});
 ui.run(`startGenerated(registerKernelCase(${JSON.stringify(records)}),'Test')`);
 const x=records.signs.find(s=>s.kind!=='testimony'&&!(s.requires||[]).length&&s.at);
 ui.run(`$('#modal')?.close?.();dispatch(session,{type:'move',to:'${x.at}'});dispatch(session,{type:'inspect',object:'${x.id}'});render()`);
 const html=ui.run('visibleTranscript(playerView(session).transcript).slice(-5).map(journalEntry).join("")');
 assert.match(html,/clue-found[\s\S]*clue-body[\s\S]*(clue-found-art|art-placeholder)[\s\S]*clue-found-title/);
});

test('The middle panel shows only what happened since arriving at this place',()=>{
 const ui=adapter();
 ui.run("act({type:'move',to:'manor'});act({type:'move',to:'inn'})");
 const html=ui.node('#journal').innerHTML;
 assert.doesNotMatch(ui.node('#app').innerHTML,/HERE SINCE YOU ARRIVED/);
 assert.doesNotMatch(html,/You reach Vale Manor|The manor is quiet/,'nothing from the manor visit');
});

test('An empty place tells the player what to do; no history bar in the middle',()=>{
 const ui=adapter();ui.run("act({type:'move',to:'manor'})");
 const html=ui.run('nextSteps(playerView(session))');
 assert.match(html,/What now\?[\s\S]*Look around[\s\S]*Talk[\s\S]*Walk/);
 assert.doesNotMatch(ui.node('#app').innerHTML,/Full history \(/);
});

test('Examining something during a conversation shows the find in the conversation',()=>{
 const records=JSON.parse(readFileSync(new URL('./fixtures/mk-cordial.json',import.meta.url),'utf8'));
 const ui=adapter(null,{llmActive:()=>false});
 ui.run(`startGenerated(registerKernelCase(${JSON.stringify(records)}),'Test')`);
 const x=records.signs.find(s=>s.kind!=='testimony'&&!(s.requires||[]).length&&s.at);
 const who=Object.entries(records.people).length&&ui.run(`(()=>{dispatch(session,{type:'move',to:'${x.at}'});return playerView(session).people[0]?.id??null})()`);
 if(!who)return;
 ui.run(`$('#modal')?.close?.();chat='${who}';chatSince={id:'${who}',from:session.events.length};notebook='talk';render();act({type:'inspect',object:'${x.id}'});chat='${who}';render()`);
 assert.match(ui.run('dialogueLines(playerView(session))'),/bubble-row found[\s\S]*clue-found/,'the find is in the conversation');
});

test('A find made before the conversation began is not shown in it (it is in Evidence)',()=>{
 const records=JSON.parse(readFileSync(new URL('./fixtures/mk-cordial.json',import.meta.url),'utf8'));
 const ui=adapter(null,{llmActive:()=>false});
 ui.run(`startGenerated(registerKernelCase(${JSON.stringify(records)}),'Test')`);
 const x=records.signs.find(s=>s.kind!=='testimony'&&!(s.requires||[]).length&&s.at);
 const who=ui.run(`(()=>{$('#modal')?.close?.();dispatch(session,{type:'move',to:'${x.at}'});return playerView(session).people[0]?.id??null})()`);
 if(!who)return;
 ui.run(`act({type:'inspect',object:'${x.id}'});chat=null;render()`);
 ui.click('chat',{id:who});
 assert.doesNotMatch(ui.run('dialogueLines(playerView(session))'),/bubble-row found/,'the earlier find is not in the conversation');
});

test('A reply that becomes evidence appears once in the conversation, as the evidence card',()=>{
 const records=JSON.parse(readFileSync(new URL('./fixtures/mk-cordial.json',import.meta.url),'utf8'));
 const ui=adapter(null,{llmActive:()=>false});
 ui.run(`startGenerated(registerKernelCase(${JSON.stringify(records)}),'Test')`);
 ui.run(`$('#modal')?.close?.();dispatch(session,{type:'move',to:'square'})`);
 ui.click('chat',{id:'bell'});ui.run(`act({type:'ask',person:'bell',topic:'night'})`);
 const html=ui.run('dialogueLines(playerView(session))');
 const recorded=(html.match(/bubble-row theirs recorded/g)||[]).length;
 assert.equal(recorded,1,'the account is shown as one evidence card');
 const text=records.signs.find(x=>x.id==='s_surface_bell').text.slice(0,30);
 assert.equal(html.split(text).length-1,1,'and not repeated as a plain bubble');
});

test('Restart reloads a generated case from wherever the case list says it now is (shipped or generated here)',async()=>{
 const records=JSON.parse(readFileSync(new URL('../dist/cases/generated/mk-live-20261002-235614.json',import.meta.url),'utf8'));
 const asked=[];const json=(o,ok=true)=>Promise.resolve({ok,status:ok?200:404,json:async()=>o});
 const fetch=async url=>{asked.push(url);
  if(url.endsWith('cases/generated/index.json'))return json([{id:records.id,file:`${records.id}.json`,title:'T'}]);
  if(url.endsWith('cases/generated/live/index.json'))return json([]);
  if(url.endsWith(`cases/generated/${records.id}.json`))return json(records);
  return json({},false);};
 const ui=adapter(null,{llmActive:()=>false,fetch});
 ui.run(`startGenerated(registerKernelCase(${JSON.stringify(records)}),'T')`);
 ui.click('restart');await new Promise(r=>setTimeout(r,20));
 assert.ok(asked.some(u=>u.endsWith(`cases/generated/${records.id}.json`)),asked.join(' '));
 assert.ok(!asked.some(u=>u.includes(`live/${records.id}`)),'not the old live path');
 assert.equal(ui.run('session.world.caseId'),records.id);
});

test('The case menu: three generate buttons in one row, and a difficulty filter over the case list',async()=>{
 const json=o=>Promise.resolve({ok:true,status:200,json:async()=>o});
 const list=[{id:'a',file:'a.json',title:'Alpha',difficulty:{level:'easy',score:3}},{id:'b',file:'b.json',title:'Beta',difficulty:{level:'hard',score:11}},
   {id:'c',file:'c.json',title:'Gamma',difficulty:{level:'medium',score:7}}];
 const fetch=async url=>url.endsWith('cases/generated/index.json')?json(list):url.endsWith('live/index.json')?json([]):json({error:'no_job'});
 const ui=adapter(null,{llmActive:()=>false,fetch});
 ui.click('choose-case');await new Promise(r=>setTimeout(r,5));
 const html=ui.node('#modal').innerHTML;
 assert.match(html,/<div class="generate-choice"[^>]*>(<button[^>]*data-do="generate-new"[^>]*>.*?<\/button>){3}<\/div>/,'the three buttons sit together in one group');
 assert.match(html,/<select id="case-filter">/);
 for(const t of ['Alpha','Beta','Gamma'])assert.match(html,new RegExp(t));
 ui.run(`document.querySelector=(s=>s==='#case-list'?globalThis.__list??(globalThis.__list={innerHTML:''}):null)`);
 ui.change({id:'case-filter',value:'hard'});
 const shown=ui.run('globalThis.__list.innerHTML');
 assert.match(shown,/Beta/);assert.doesNotMatch(shown,/Alpha|Gamma/);
 ui.change({id:'case-filter',value:'easy'});assert.match(ui.run('globalThis.__list.innerHTML'),/Alpha/);
});

test('The map shows where people really are: someone walking is on the path between the places, and a plan shows as a ring', () => {
  const records = JSON.parse(readFileSync(new URL('./fixtures/mk-cordial.json', import.meta.url), 'utf8'));
  const ui = adapter(null, {llmActive: () => false});
  ui.run(`startGenerated(registerKernelCase(${JSON.stringify(records)}),'Test');mode='game'`);
  const pinPeople = (html, place) => { const i = html.search(new RegExp(`class="map-pin[^"]*"[^>]*data-id="${place}"`)); const j = html.indexOf('</button>', i); return html.slice(i, j); };
  const pid = ui.run("Object.keys(session.world.npcs).find(p=>p!=='bell'&&session.world.npcs[p].location!==session.world.player.location)");
  const home = ui.run(`session.world.npcs['${pid}'].location`), name = ui.run(`PEOPLE['${pid}'].name`);
  const away = ui.run(`Object.keys(LOCATIONS).find(l=>l!=='${home}'&&l!==session.world.player.location)`);
  ui.run(`caseTables(session).kernel.startTravel(session,'${pid}','${away}',session.events.at(-1).id,'Morning: go');render()`);
  let html = ui.node('#app').innerHTML;
  assert.match(html, new RegExp(`class="map-walker"[^>]*aria-label="${name}, walking to`), 'drawn walking on the path');
  assert.doesNotMatch(pinPeople(html, home), new RegExp(`data-face="${pid}"`), 'no longer at the place they left');
  assert.doesNotMatch(pinPeople(html, away), new RegExp(`data-face="${pid}"`), 'not yet at the place they are going');
  assert.match(html, new RegExp(`class="map-face acting" data-face="${pid}"`), 'walking for a plan of their own: the acting ring');
});


test('Done markers use canonical question identity in legacy saved cases',()=>{
  const kc=JSON.parse(readFileSync(new URL('./fixtures/mk-cordial.json',import.meta.url),'utf8'));
  kc.id='mk-test-ui-night-alias';
  kc.signs.push({id:'t_duplicate_night',kind:'testimony',speaker:'iris',source:'e_chess',title:'Chess detail',
    text:'We played chess at my surgery.',ask:'Where were you last night?'});
  const s=engine.createSession(2,engine.registerKernelCase(kc));
  if(s.world.player.location!==s.world.npcs.iris.location)engine.dispatch(s,{type:'move',to:s.world.npcs.iris.location});
  engine.dispatch(s,{type:'ask',person:'iris',topic:'t_duplicate_night'});
  const saved=dialogueSave.exportDialogueSave(s,new Map(),{},{}),ui=adapter(saved);
  assert.equal(ui.run("actionDone({type:'ask',person:'iris',topic:'night'})"),true);
  assert.equal(ui.run("actionDone({type:'ask',person:'iris',topic:'t_duplicate_night'})"),true);
});
