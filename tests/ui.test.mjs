import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as engine from '../dist/engine.mjs';
import * as inspector from '../dist/inspector.mjs';

// Exercise the adapter's rendering and handlers without pretending to test browser layout.
function adapter(){
  const nodes=new Map(),listeners={};
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',scrollTop:0,dataset:{},addEventListener(){},setAttribute(){},focus(){},showModal(){this.open=true},classList:{add(){},remove(){}}});
    return nodes.get(selector);
  };
  const context=vm.createContext({...engine,...inspector,structuredClone,setTimeout,clearTimeout,setInterval,clearInterval,
    localStorage:{getItem(){return null},setItem(){}},
    document:{querySelector:node,addEventListener(type,fn){listeners[type]=fn},body:{dataset:{}}}});
  vm.runInContext(readFileSync(new URL('../dist/ui.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
  return {run:code=>vm.runInContext(code,context),node,click(action){listeners.click({target:{closest(){return {dataset:{do:action}}}}})}};
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
  assert.ok(ui.run("const seen=[];const old=memoryCard;memoryCard=id=>{seen.push(id);return old(id)};person='clara';personTab='memories';characterPanel(session.world);memoryCard=old;JSON.stringify(seen)===JSON.stringify(session.world.npcs.clara.memories)"));
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
