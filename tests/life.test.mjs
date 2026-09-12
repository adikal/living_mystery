import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createSession,runtimeFor,dispatch,commit,diagnostics,worldAt,exportSession,importSession,playerView,generateCase} from '../dist/engine.mjs';
import {prepareAutonomy,applyAutonomy,deliberateWorld} from '../dist/autonomy-turn.mjs';
import {assessPlan} from '../dist/world-director.mjs';
import {investigateReachability,verifyDirectorTurn} from '../dist/director-turn.mjs';
const create=()=>createSession(17,'bellweather-01');
const wait=(s,n)=>{while(n>0){dispatch(s,{type:'wait',minutes:Math.min(30,n)});n-=30;}};
const fallback=async()=>({ok:false});

test('Every NPC lives an ordinary day without player investigation; replay preserves plans and commitments',()=>{
 const s=create();wait(s,180);
 for(const [id,n]of Object.entries(s.world.npcs)){
  assert.ok(Object.keys(n.life.completed).length,id);
  assert.ok(s.events.some(e=>e.actor===id&&e.data.life&&e.data.candidates?.length>1),id);
 }
 assert.ok(Object.values(s.world.flags.lifeRequests).some(r=>r.status==='completed'));
 assert.ok(s.events.some(e=>e.data.life&&e.data.task==='rest'));
 assert.ok(diagnostics(s).ok);assert.equal(investigateReachability(s).status,'route_found');
 const restored=importSession(exportSession(s));wait(s,60);wait(restored,60);assert.deepEqual(restored,s);
 assert.equal(s.world.player.evidence.length,0);
 assert.doesNotMatch(JSON.stringify(playerView(s)),/lifeRequests|lastAI|candidates/);
});

test('Work consumes simulated time, pauses for conversation, and resumes without duplicate completion',()=>{
 const s=create(),r=runtimeFor(s);dispatch(s,{type:'move',to:'inn'});
 r.kernel.life.choose(s,'ada',['work']);const start=s.world.minute;
 assert.equal(s.world.npcs.ada.life.active.until,start+8);
 dispatch(s,{type:'ask',person:'ada',topic:'night'});
 assert.equal(s.world.npcs.ada.life.active.paused,true);
 for(let i=0;i<4;i++)dispatch(s,{type:'ask',person:'ada',topic:'night'});
 assert.equal(s.world.npcs.ada.life.completed.work,undefined);
 dispatch(s,{type:'endConversation'});wait(s,10);
 assert.ok(s.world.npcs.ada.life.completed.work>start+8);
 assert.equal(s.events.filter(e=>e.actor==='ada'&&e.data.task==='work'&&e.data.outcome==='completed').length,1);
 assert.ok(diagnostics(s).ok);
});

test('Invitations, acceptance and fulfillment are real co-located encounters with sources',()=>{
 const s=create();wait(s,180);
 const completed=Object.values(s.world.flags.lifeRequests).filter(r=>r.status==='completed');assert.ok(completed.length>=2);
 for(const r of completed){
  for(const source of [r.source,r.acceptedSource,r.completedSource]){
   const e=s.events.find(e=>e.id===source),w=worldAt(s,e.index);
   assert.equal(w.npcs[e.actor].location,w.npcs[e.data.listener].location);
   assert.equal(w.npcs[e.actor].travel,null);assert.equal(w.npcs[e.data.listener].travel,null);
  }
  const meeting=s.events.find(e=>e.title==='Both participants begin their appointment'&&e.data.request===r.id);
  const done=s.events.find(e=>e.id===r.completedSource);
  assert.ok(done.minute-meeting.minute>=6);assert.ok(done.minute<=r.end);
 }
 assert.equal(s.world.npcs.bell.location,'square');
});

test('Failed encounters back off and preserve an unfinished goal for replanning',()=>{
 const s=create(),r=runtimeFor(s);
 commit(s,{kind:'world',title:'Social goal becomes due',changes:{'npcs.ada.life.socialAfter':s.world.minute}});
 r.kernel.life.choose(s,'ada',['invite:rowan']);
 commit(s,{kind:'world',title:'Rowan unavailable fixture',changes:{'npcs.rowan.location':'manor','player.conversation':'rowan'}});
 wait(s,1); // wait releases conversation, so hold him with an active appointment instead
 commit(s,{kind:'world',title:'Long busy task fixture',changes:{'npcs.rowan.life.active':{task:'work',location:'manor',until:s.world.minute+100,paused:false}}});
 wait(s,30);
 const failed=s.world.npcs.ada.life.failures['invite:rowan'];
 assert.ok(failed?.attempts>=1);assert.ok(failed.retryAt>s.events.findLast(e=>e.actor==='ada'&&e.data.outcome==='blocked').minute);
 assert.ok(s.world.npcs.ada.life.goals.some(g=>g.id==='social'));
 assert.equal(Object.values(s.world.flags.lifeRequests).filter(r=>r.sender==='ada').length,0);
});

test('Appointment commitments constrain all plan kinds and reject individually safe compositions',()=>{
 const s=create(),r=runtimeFor(s),now=s.world.minute;
 commit(s,{kind:'world',title:'Delivered appointment fixture',changes:{'flags.lifeRequests.fixture':{id:'fixture',sender:'ada',recipient:'rowan',people:['ada','rowan'],status:'accepted',location:'inn',start:now+15,end:now+30,source:s.events[0].id}}});
 assert.ok(r.kernel.life.choices(s,'ada').some(c=>c.id==='work'));
 assert.ok(r.kernel.life.choices(s,'ada').some(c=>c.id==='rest'));
 assert.throws(()=>r.kernel.life.planFor(s,'ada',['work','rest']),/appointment/);
 assert.notEqual(assessPlan(r.kernel,s,{actor:'ada',label:'Long survey',sources:[],steps:[{kind:'move',to:'manor'},{kind:'move',to:'vestry'},{kind:'move',to:'surgery'}]}).status,'allow');
 assert.notEqual(assessPlan(r.kernel,s,{actor:'ada',label:'Invent task',steps:[{kind:'activity',task:'destroy_evidence',location:'inn',duration:1}]}).status,'allow');
});

test('Optional model selects a composed plan; malformed and stale proposals cannot mutate state',()=>{
 const s=create(),ticket=prepareAutonomy(s,'ada');
 assert.doesNotMatch(JSON.stringify(ticket.context),/I killed Edmund|evidenceOrigins|culprit|caseId/);
 for(const goals of [['teleport'],['work','work'],['work','rest','work','rest']]){
  const before=exportSession(s);assert.throws(()=>applyAutonomy(s,ticket,{goals,rationale:'test'}));assert.equal(exportSession(s),before);
 }
 applyAutonomy(s,ticket,{goals:['work','rest'],rationale:'Finish serving, then recover.'});
 assert.equal(s.world.npcs.ada.life.active.task,'work');assert.equal(s.world.npcs.ada.pendingPlan.plan.goals.length,2);
 assert.throws(()=>applyAutonomy(s,ticket,{goals:['rest'],rationale:'old'}),/Stale/);
 const restored=importSession(exportSession(s));wait(s,30);wait(restored,30);assert.deepEqual(restored,s);
 assert.ok(s.world.npcs.ada.life.completed.rest);
});

test('Autonomy request budgets, fallback, cancellation and stale responses are bounded',async()=>{
 const s=create();let calls=0;
 const good=async(_url,init)=>{calls++;const context=JSON.parse(JSON.parse(init.body).prompt);return {ok:true,json:async()=>({text:JSON.stringify({goals:[context.choices[0].id],rationale:'Attend to my current priority.'})})};};
 assert.equal((await deliberateWorld(s,{fetchImpl:good})).status,'accepted');assert.equal(calls,1);
 const asked=s.events.findLast(e=>e.data.autonomy).actor;
 assert.equal(s.world.npcs[asked].life.lastAI,s.world.minute);
 assert.equal((await deliberateWorld(s,{fetchImpl:fallback})).status,'fallback');
 const timeout=await deliberateWorld(s,{fetchImpl:()=>new Promise(()=>{}),timeoutMs:5});assert.equal(timeout.status,'fallback');
 const controller=new AbortController(),before=exportSession(s);
 const pending=deliberateWorld(s,{signal:controller.signal,fetchImpl:()=>new Promise(()=>{})});controller.abort();assert.equal((await pending).status,'cancelled');assert.equal(exportSession(s),before);
 let release;const changing=deliberateWorld(s,{fetchImpl:()=>new Promise(resolve=>{release=resolve;})});
 dispatch(s,{type:'look'});const changed=exportSession(s);release({ok:true,json:async()=>({text:'{"goals":["work"],"rationale":"late"}'})});
 assert.equal((await changing).status,'stale');assert.equal(exportSession(s),changed);
});

test('Solver verification batches a living-town wait within the service request limit',async()=>{
 const s=create(),trial=structuredClone(s);wait(trial,30);const count=trial.events.slice(s.events.length).filter(e=>e.data.director?.status==='allow').length;assert.ok(count>12);
 const queries=[];
 const result=await verifyDirectorTurn(s,trial,{fetchImpl:async(_url,init)=>{
  const batch=JSON.parse(init.body).queries;assert.ok(batch.length<=12);queries.push(...batch);
  return {ok:true,json:async()=>({results:batch.map(({id,query})=>({id,query,result:{status:'sat',witness:query.kind==='crime-history'?{death:trial.world.flags.deathMinute}:trial.events.find(e=>e.id===id).data.director.witness}}))})};
 }});
 assert.equal(result.status,'verified');assert.equal(queries.length,count+1);
});

test('Timed activity constraints are checked by actual Z3, including impossible deadlines', {skip:spawnSync('.venv/bin/python',['-c','import z3']).status!==0},()=>{
 const s=create(),r=runtimeFor(s),plan=r.kernel.life.planFor(s,'ada',['work','rest']).plan;
 const q=assessPlan(r.kernel,s,plan).query;
 const impossible=structuredClone(q);impossible.constraints.push({id:'impossible_finish',label:'Impossible deadline',sources:[],formula:{op:'le',args:[{var:'t2'},s.world.minute+1]}});
 const run=spawnSync('.venv/bin/python',['-c','import json,sys;from server.symbolic_solver import solve;print(json.dumps([solve(q)["status"] for q in json.load(sys.stdin)]))'],{input:JSON.stringify([q,impossible]),encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),['sat','unsat']);
});

test('Seeded cases retain solvability through different unattended days and interrupted schedules',()=>{
 for(const seed of [3,11,42]){
  const gen=generateCase(seed);assert.ok(gen);assert.doesNotMatch(gen.title,/\((clara|rowan|silas)\)/);
  const s=createSession(seed,gen.id);for(let i=0;i<8;i++){wait(s,17+i);assert.ok(diagnostics(s).ok);}
  const route=investigateReachability(s);assert.equal(route.status,'route_found');for(const action of route.actions)dispatch(s,action);assert.equal(s.world.status,'solved');
 }
});

test('An interrupted meeting expires rather than being falsely fulfilled',()=>{
 const s=create();wait(s,53);
 const r=Object.values(s.world.flags.lifeRequests).find(r=>r.status==='accepted'&&r.people.includes('bell'));assert.ok(r);
 for(let i=0;i<18;i++)dispatch(s,{type:'ask',person:'bell',topic:'case'});
 assert.equal(s.world.flags.lifeRequests[r.id].status,'expired');
 assert.equal(s.world.flags.lifeRequests[r.id].completedSource,undefined);
 dispatch(s,{type:'endConversation'});wait(s,20);
 assert.ok(diagnostics(s).ok);assert.equal(investigateReachability(s).status,'route_found');
});

test('A recipient ticking before the sender cannot complete an expired appointment',()=>{
 const s=create(),r=runtimeFor(s),now=s.world.minute,task='meet:review';
 const active={task,location:'inn',remaining:1,until:now+1,paused:false,meeting:true,started:true,deadline:now+20};
 commit(s,{kind:'decision',title:'A meeting at its deadline',changes:{
  'flags.lifeRequests.review':{id:'review',sender:'ada',recipient:'rowan',people:['ada','rowan'],status:'accepted',start:now-6,end:now,location:'inn',label:'Produce meeting',source:s.events[0].id,acceptedSource:s.events[0].id},
  'npcs.ada.location':'inn','npcs.rowan.location':'inn','npcs.ada.life.active':active,'npcs.rowan.life.active':active
 }});
 r.kernel.advance(s,1,s.events.at(-1).id);
 assert.equal(s.world.flags.lifeRequests.review.status,'expired');
 assert.ok(!s.events.some(e=>e.title==='Appointment fulfilled'));
});

test('Finishing a task never pushes exhausted energy below zero',()=>{
 const s=create(),r=runtimeFor(s);r.kernel.life.choose(s,'ada',['work']);
 commit(s,{kind:'decision',title:'Exhaustion fixture',changes:{'npcs.ada.life.energy':0}});
 r.kernel.advance(s,8,s.events.at(-1).id);
 assert.equal(s.world.npcs.ada.life.energy,0);
});
