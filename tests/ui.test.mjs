import * as autonomy from '../dist/autonomy-turn.mjs';
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
  const modules={'./autonomy-turn.mjs':autonomy,'./director-turn.mjs':directorTurns,'./character-turn.mjs':characterTurns,'./art.mjs':art,'./engine.mjs':engine,'./inspector.mjs':inspector,'./claims.mjs':claims,'./llm.mjs':llm,'./dialogue-save.mjs':dialogueSave,'./idb-save.mjs':idbSave};
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
  assert.equal((html.match(/class="journal-entry /g)||[]).length,5);
  assert.ok(ui.run("const ids=playerView(session).transcript.slice(-5).map(e=>e.id);const calls=[];const original=journalEntry;journalEntry=e=>{calls.push(e.id);return original(e)};game();journalEntry=original;JSON.stringify(calls)===JSON.stringify(ids)"));
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
  ui.run("notebook='people';act({type:'move',to:'manor'})");
  assert.match(ui.node('#app').innerHTML,/scene-transition/);
  assert.match(ui.node('#app').innerHTML,/Here with you/);
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
  ui.run("dispatch(session,{type:'move',to:'manor'});dispatch(session,{type:'inspect',object:'folio'});render()");
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
 assert.match(html,/Trust in you/);assert.match(html,/Stress factor/);
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
 const ui=adapter(null,{llmActive:()=>false});ui.click('choose-case');assert.match(ui.node('#modal').innerHTML,/Generate a new validated case/);
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

test('Structure generation still works with AI off',()=>{
 const ui=adapter(null,{llmActive:()=>false});
 for(const structure of ['cleanup','clockwork']){
  ui.run(`generateAndStart({structure:'${structure}'})`);
  assert.equal(ui.run('caseTables(session).kernel.model.forensics.structure'),structure);
  assert.equal(ui.run('session.world.status'),'playing');
  assert.equal(ui.run('session.world.player.evidence.length'),0);
 }
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
