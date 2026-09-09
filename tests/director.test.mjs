import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createSession,dispatch,copy,exportSession,importSession,diagnostics,commit,playerView} from '../dist/engine.mjs';
import {compilePlan} from '../dist/symbolic.mjs';
import {verifyDirectorTurn,commitDirectedTurn,investigateReachability} from '../dist/director-turn.mjs';

function fixture(steps,extra={}){return compilePlan({actor:'actor',location:'a',objects:{paper:'a'},knowledge:['correction'],locations:{a:{},b:{}},distances:{'a:a':0,'a:b':8,'b:a':8,'b:b':0},minute:480,steps,...extra});}
function z3(query){
 const child=spawnSync('.venv/bin/python',['-c','import json,sys; from server.symbolic_solver import solve; print(json.dumps(solve(json.load(sys.stdin))))'],{input:JSON.stringify(query),encoding:'utf8'});
 assert.equal(child.status,0,child.stderr||'Install server/requirements-solver.txt into .venv');
 const result=JSON.parse(child.stdout);assert.notEqual(result.status,'unavailable','Install Z3 to run integration tests');return result;
}
const realFetch=async(_url,init)=>{const {queries}=JSON.parse(init.body);return {ok:true,json:async()=>({results:queries.map(({id,query})=>({id,query,result:z3(query)}))})};};
function concealment(){const s=createSession();dispatch(s,{type:'move',to:'manor'});dispatch(s,{type:'inspect',object:'accounts'});dispatch(s,{type:'move',to:'vestry'});dispatch(s,{type:'present',person:'silas',clue:'ledger'});return s;}

test('Shared constraints and real Z3 agree on feasible transfers and impossible travel/possession',()=>{
 for(const [steps,status]of [
  [[{kind:'take',object:'paper',from:'a'},{kind:'move',to:'b'},{kind:'store',object:'paper',location:'b',to:'drawer'}],'sat'],
  [[{kind:'move',to:'b',duration:2}],'unsat'],
  [[{kind:'move',to:'b'},{kind:'store',object:'paper',location:'b',to:'drawer'}],'unsat']
 ]){
  const f=fixture(steps),result=z3(f.query);assert.equal(result.status,status);
  assert.equal(f.failures.length===0,status==='sat');
  if(status==='unsat')assert.ok(result.conflicts.every(c=>c.label&&c.id));
 }
 assert.throws(()=>fixture([{kind:'teleport',to:'b'}]),/Unsupported/);
});

test('Knowledge and actual recipient presence are required; future meetings remain conditional',()=>{
 const speak={kind:'communicate',recipient:'recipient',location:'a',belief:'correction',recipientPresent:true};
 assert.equal(z3(fixture([speak]).query).status,'sat');
 assert.equal(z3(fixture([speak],{knowledge:[]}).query).status,'unsat');
 assert.equal(z3(fixture([{...speak,recipientPresent:false}]).query).status,'unsat');
 const future=fixture([{kind:'move',to:'b'},{...speak,location:'b',recipientPresent:false}]);
 assert.equal(z3(future.query).status,'sat');assert.equal(future.query.assumptions.length,1);
});

test('Scripted Ada executes a source-linked correction only after meeting Bell, with deterministic replay',()=>{
 const s=createSession();dispatch(s,{type:'wait',minutes:60});dispatch(s,{type:'move',to:'inn'});dispatch(s,{type:'inspect',object:'clock'});dispatch(s,{type:'present',person:'ada',clue:'clock'});
 assert.ok(!s.world.flags.adaCorrectionDelivered);
 dispatch(s,{type:'endConversation'});
 const audit=s.events.findLast(e=>e.data.director?.plan.actor==='ada');assert.equal(audit.data.director.status,'allow');
 assert.equal(z3(audit.data.director.query).status,'sat');
 dispatch(s,{type:'wait',minutes:5});assert.equal(s.world.flags.adaCorrectionDelivered,true);
 const speech=s.events.find(e=>e.title==='Ada corrects her report to Bell');
 assert.ok(s.events.find(e=>e.id===speech.parents[0]).data.director);
 assert.equal(s.world.npcs.bell.beliefs.find(b=>b.key==='adas_account').sourceId,speech.id);
 assert.deepEqual(importSession(exportSession(s)),s);assert.ok(diagnostics(s).ok);
 assert.ok(!JSON.stringify(playerView(s)).includes('directorResult'));
});

test('Silas concealment is validated transactionally with a replayed surviving investigation route',async()=>{
 const s=concealment(),before=exportSession(s),trial=copy(s);dispatch(trial,{type:'endConversation'});
 const result=await verifyDirectorTurn(s,trial,{fetchImpl:realFetch});
 assert.equal(result.status,'verified');assert.equal(exportSession(s),before);
 assert.equal(result.viability.status,'route_found');
 const result2=await commitDirectedTurn(s,trial,{fetchImpl:realFetch});assert.equal(result2.status,'verified');
 assert.ok(s.events.some(e=>e.data.directorResult?.status==='verified'));
 dispatch(s,{type:'wait',minutes:30});assert.equal(s.world.objects.folio,'drawer');
 assert.deepEqual(importSession(exportSession(s)),s);
 const witness=investigateReachability(s),play=copy(s);assert.equal(witness.status,'route_found');
 for(const action of witness.actions)dispatch(play,action);assert.equal(play.world.status,'solved');
});

test('Unresolved route search defers the candidate rather than claiming a dead end',async()=>{
 const s=concealment(),trial=copy(s);dispatch(trial,{type:'endConversation'});
 const r=await verifyDirectorTurn(s,trial,{fetchImpl:realFetch,reachability:()=>({status:'unresolved'})});assert.equal(r.status,'defer');
 assert.equal(investigateReachability(s,{horizon:1}).status,'unresolved');
});

test('Solver failure, forged witnesses, cancellation and stale state never commit candidate effects',async()=>{
 const s=concealment(),trial=copy(s);dispatch(trial,{type:'endConversation'});
 const unchanged=JSON.stringify(s.world);
 const failure=await commitDirectedTurn(s,trial,{fetchImpl:async()=>{throw Error('offline')}});
 assert.equal(failure.status,'unresolved');assert.equal(JSON.stringify(s.world),unchanged);
 assert.ok(diagnostics(s).ok);
 const fresh=copy(s);dispatch(fresh,{type:'endConversation'});
 const forged=await verifyDirectorTurn(s,fresh,{fetchImpl:async(_u,i)=>({ok:true,json:async()=>({results:JSON.parse(i.body).queries.map(q=>({...q,result:{status:'sat',witness:{}}}))})})});assert.equal(forged.status,'unresolved');
 const controller=new AbortController();controller.abort();assert.equal((await commitDirectedTurn(s,fresh,{signal:controller.signal})).status,'cancelled');
 const timed=await verifyDirectorTurn(s,fresh,{timeoutMs:5,fetchImpl:()=>new Promise(()=>{})});assert.equal(timed.status,'unresolved');
 await assert.rejects(commitDirectedTurn(s,fresh,{fetchImpl:async()=>{dispatch(s,{type:'look'});throw Error('offline')}}),/world changed/);
});

test('Unmet immediate meetings defer without remotely updating recipient beliefs',()=>{
 const s=createSession();dispatch(s,{type:'wait',minutes:60});dispatch(s,{type:'move',to:'inn'});dispatch(s,{type:'inspect',object:'clock'});dispatch(s,{type:'present',person:'ada',clue:'clock'});
 // A fixture changes Bell's position through a recorded event, not hidden mutation.
 commit(s,{kind:'action',actor:'bell',title:'Bell is elsewhere for the fixture',changes:{'npcs.bell.location':'manor'}});
 dispatch(s,{type:'endConversation'});dispatch(s,{type:'wait',minutes:4});
 assert.ok(!s.world.flags.adaCorrectionDelivered);
 assert.ok(s.events.some(e=>e.data.director?.status==='reject'));
 assert.ok(diagnostics(s).ok);
});

test('New observation, gift and concealment contracts agree with real Z3',()=>{
 const extra={participants:{actor:{location:'a'},recipient:{location:'a'}},containers:{drawer:'b'}};
 for(const [steps,status]of [
  [[{kind:'observe',location:'a',object:'paper'}],'sat'],
  [[{kind:'observe',location:'b',object:'paper'}],'unsat'],
  [[{kind:'take',object:'paper',from:'a'},{kind:'give',object:'paper',recipient:'recipient',location:'a'}],'sat'],
  [[{kind:'give',object:'paper',recipient:'recipient',location:'a'}],'unsat'],
  [[{kind:'take',object:'paper',from:'a'},{kind:'move',to:'b'},{kind:'conceal',object:'paper',location:'b',to:'drawer'}],'sat']
 ]){const compiled=fixture(steps,extra);assert.equal(z3(compiled.query).status,status);assert.equal(compiled.failures.length===0,status==='sat');}
 assert.throws(()=>fixture([{kind:'conceal',object:'paper',location:'a',to:'drawer'}],extra),/container/);
});

test('A queued shared survey is admitted through the real transactional Z3 boundary',async()=>{
 const {characterPlans,scheduleCharacterPlan}=await import('../dist/engine.mjs');
 const s=createSession(),trial=copy(s);
 scheduleCharacterPlan(trial,characterPlans(trial,'bell').find(p=>p.id==='survey:inn'),trial.events[0].id);
 const result=await commitDirectedTurn(s,trial,{fetchImpl:realFetch});
 assert.equal(result.status,'verified');assert.equal(s.world.npcs.bell.pendingPlan.plan.id,'survey:inn');
 assert.ok(diagnostics(s).ok);
});
