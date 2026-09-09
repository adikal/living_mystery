import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createSession,dispatch,caseTables,runtimeFor,exportSession,importSession,diagnostics,playerView,worldAt,characterPlans,commit,followupOptions} from '../dist/engine.mjs';
import {investigateReachability} from '../dist/director-turn.mjs';
import {assessTransition} from '../dist/admission.mjs';
import {prepareCharacterTurn} from '../dist/character-turn.mjs';
import {makeCase} from '../dist/cases/bellweather.mjs';
import {createRuntime} from '../dist/engine-runtime.mjs';
import {CONFIGS} from '../dist/cases/bellweather-configs.mjs';

test('All authored configurations execute a sourced prehistory and solve in scripted mode',()=>{
 for(const spec of CONFIGS){
  const s=createSession(17,spec.id),r=runtimeFor(s),entry=s.events.find(e=>e.kind==='arrival'&&e.data.boundary);
  assert.ok(entry);assert.ok(s.events.slice(0,entry.index).every(e=>!e.playerText),'Prehistory is not player observation');
  assert.equal(s.world.minute,1920);assert.equal(s.world.flags.deathMinute,spec.minute);assert.equal(s.world.flags.victimAlive,false);
  const death=s.events.find(e=>e.title.includes('fatally strikes'));assert.equal(death.actor,spec.culprit);assert.equal(death.data.weapon,spec.weapon);
  const before=worldAt(s,death.index-1);assert.equal(before.flags.victimAlive,true);assert.equal(before.objects.weapon,spec.culprit);assert.equal(before.npcs[spec.culprit].location,'manor');
  for(const npc of Object.values(s.world.npcs))for(const belief of npc.beliefs)assert.ok(s.events.some(e=>e.id===belief.sourceId));
  assert.equal(playerView(s).evidence.length,0);assert.doesNotMatch(JSON.stringify(playerView(s)),/I killed|fatally strikes|evidenceOrigins/);
  const route=investigateReachability(s);assert.equal(route.status,'route_found');
  for(const action of route.actions)dispatch(s,action);
  assert.equal(s.world.status,'solved');assert.equal(s.world.ending.suspect,spec.culprit);assert.ok(diagnostics(s).ok);
  for(const e of s.events.filter(e=>e.kind==='evidence'))assert.ok(e.parents.includes(s.world.flags.evidenceOrigins[e.data.clue]),e.data.clue);
  assert.deepEqual(importSession(exportSession(s)),s);
  assert.match(s.events.findLast(e=>e.kind==='resolution').playerText,new RegExp(r.PEOPLE[spec.culprit].name));
 }
});

test('Concurrent sessions, reload, profiles and AI perspectives never borrow another case solution',()=>{
 const a=createSession(17,'bellweather-02'),b=createSession(17,'bellweather-03'),old=createSession();
 assert.equal(caseTables(a).CASE.culprit,'clara');assert.equal(caseTables(b).CASE.culprit,'rowan');assert.equal(caseTables(old).CASE.culprit,'silas');
 dispatch(a,{type:'move',to:'manor'});const ticket=prepareCharacterTurn(a,{person:'clara',text:'What happened?'});
 assert.match(ticket.context.character.beliefs.find(b=>b.key==='night_account').text,/silver candlestick/);
 assert.doesNotMatch(JSON.stringify(ticket.context),/diverted estate payments|brass seal at 21:14/);
 const restored=importSession(exportSession(a));dispatch(a,{type:'wait',minutes:5});dispatch(restored,{type:'wait',minutes:5});assert.deepEqual(a,restored);
 const wrong=JSON.parse(exportSession(a));wrong.world.caseId='bellweather-03';assert.throws(()=>importSession(JSON.stringify(wrong)),/integrity/);
 wrong.world.caseId='unknown';assert.throws(()=>importSession(JSON.stringify(wrong)),/Unknown case/);
});

test('Bounded search constructs routes from acquisition locations and rejects wrong hypotheses',()=>{
 const s=createSession(17,'bellweather-03');const r=runtimeFor(s),route=investigateReachability(s);
 assert.ok(route.actions.some(a=>a.type==='move'&&a.to==='greenhouse'));assert.ok(route.explored>1);
 for(const action of route.actions.slice(0,-1))dispatch(s,action);
 const evidence=s.world.player.evidence.map(e=>e.clue);
 for(const suspect of ['clara','silas']){dispatch(s,{type:'accuse',suspect,method:'knife',motive:'eviction',evidence});assert.equal(s.world.status,'playing');}
 dispatch(s,{type:'accuse',suspect:'rowan',method:'seal',motive:'eviction',evidence});assert.equal(s.world.status,'playing');
 dispatch(s,route.actions.at(-1));assert.equal(s.world.status,'solved');
 assert.equal(investigateReachability(createSession(),{maxNodes:1}).status,'unresolved');
});

test('Admission blocks intermediate last-route loss even when restored by turn end',()=>{
 const s=createSession(17,'bellweather-01'),r=runtimeFor(s),trial=structuredClone(s);
 commit(trial,{kind:'action',actor:'silas',title:'Lose last weapon access',changes:{'flags.lockedObjects':['seal']}});
 commit(trial,{kind:'action',actor:'silas',title:'Restore access',changes:{'flags.lockedObjects':[]}});
 assert.equal(assessTransition(r,s,trial).status,'defer');
 commit(trial,{kind:'resolution',title:'Terminal-state fixture',changes:{status:'solved'}});
 assert.equal(assessTransition(r,s,trial).status,'defer','A terminal flag must not bypass intermediate checks');
 const optional=structuredClone(s);commit(optional,{kind:'action',title:'Close optional clock access',changes:{'flags.lockedObjects':['clock']}});
 assert.equal(assessTransition(r,s,optional).status,'allow');
 assert.deepEqual(s.world.flags.lockedObjects,[]);
 const closed=structuredClone(s);commit(closed,{kind:'world',title:'Closed route fixture',changes:{'flags.closedLocations':['square']}});
 assert.equal(assessTransition(r,s,closed).status,'defer');
});

test('Time advancement cannot consume a declared last evidence deadline',()=>{
 const s=createSession(17,'bellweather-02');commit(s,{kind:'world',title:'Finite access fixture',changes:{'flags.evidenceExpiry':{seal:s.world.minute+60}}});
 assert.equal(investigateReachability(s).status,'route_found');
 const minute=s.world.minute;dispatch(s,{type:'wait',minutes:60});
 assert.equal(s.world.minute,minute);assert.ok(s.events.at(-1).data.admission);assert.ok(diagnostics(s).ok);
});

test('Capability filtering honors public constable availability and inaccessible weapon consequences',()=>{
 const s=createSession(17,'bellweather-02');
 assert.ok(!characterPlans(s,'bell').some(p=>p.steps.some(step=>step.kind==='move')));
 assert.ok(characterPlans(s,'clara').some(p=>p.id==='survey:inn'));
 const r=runtimeFor(s),trial=structuredClone(s);commit(trial,{kind:'world',title:'Carried weapon fixture',changes:{'objects.weapon':'clara'}});
 assert.ok(!characterPlans(trial,'clara').some(p=>p.id.startsWith('give:weapon')));
 assert.equal(r.CASE.culprit,'clara');
});

test('Contradictory authored prehistory fails construction, and real Z3 checks recorded plans',()=>{
 assert.throws(()=>createRuntime(makeCase({...CONFIGS[0],minute:1201})).createSession(),/time reversal/);
 const s=createSession(17,'bellweather-02');const queries=s.events.filter(e=>e.data.director?.query).map(e=>e.data.director.query);
 const run=spawnSync('.venv/bin/python',['-c','import json,sys; from server.symbolic_solver import solve; print(json.dumps([solve(q)["status"] for q in json.load(sys.stdin)]))'],{input:JSON.stringify(queries),encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);assert.ok(JSON.parse(run.stdout).every(s=>s==='sat'));
});


test('Configured source questions follow disclosed accounts and survive replay',()=>{
 const s=createSession(17,'bellweather-01');
 for(const id of ['clara','rowan','silas','iris','ada','bell'])assert.ok(!followupOptions(s,id).some(([key])=>key==='source'));
 dispatch(s,{type:'move',to:'manor'});
 dispatch(s,{type:'ask',person:'clara',topic:'source'});
 assert.ok(s.events.some(e=>e.kind==='rejected'));
 dispatch(s,{type:'ask',person:'clara',topic:'night'});
 assert.match(followupOptions(s,'clara').find(([key])=>key==='source')[1],/corroborate your greenhouse appointment/);
 const account=s.events.findLast(e=>e.kind==='speech'&&e.actor==='clara');
 dispatch(s,{type:'ask',person:'clara',topic:'source'});
 const answer=s.events.findLast(e=>e.kind==='speech'&&e.actor==='clara');
 assert.match(answer.data.assertion,/Dr Marsh was there/);assert.ok(answer.parents.includes(account.id));
 assert.deepEqual(followupOptions(importSession(exportSession(s)),'clara'),followupOptions(s,'clara'));
 dispatch(s,{type:'ask',person:'clara',topic:'accounts'});
 assert.ok(!followupOptions(s,'clara').some(([key])=>key==='source'),'An unrelated answer must retire the preceding source question');
 dispatch(s,{type:'move',to:'vestry'});dispatch(s,{type:'ask',person:'silas',topic:'alibi'});
 assert.match(followupOptions(s,'silas').find(([key])=>key==='source')[1],/corroborate your whereabouts/);
 dispatch(s,{type:'ask',person:'silas',topic:'source'});
 assert.doesNotMatch(s.events.findLast(e=>e.kind==='speech'&&e.actor==='silas').data.assertion,/greenhouse|killed|brass seal/);
});
