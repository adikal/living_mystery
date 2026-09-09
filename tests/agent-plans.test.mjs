import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,dispatch,characterPlans,scheduleCharacterPlan,exportSession,importSession,diagnostics,commit,worldAt} from '../dist/engine.mjs';
import {createKernel} from '../dist/kernel.mjs';
import {model,createBehavior} from '../dist/cases/last-bell.mjs';
import {prepareCharacterTurn,proposeCharacterTurn,applyCharacterTurn,validateCharacterProposal,CHARACTER_CRITIC} from '../dist/character-turn.mjs';
import {setLlmConfig} from '../dist/llm.mjs';
import {resumePlan} from '../dist/agent-plans.mjs';
import {assessPlan,executePlanStep} from '../dist/world-director.mjs';

const kernel=createKernel(model);kernel.afterTransfer=createBehavior(kernel).afterTransfer;
function queue(s,actor,id){const plan=characterPlans(s,actor).find(p=>p.id===id);assert.ok(plan,id);scheduleCharacterPlan(s,plan,s.events[0].id);return plan;}

test('Scripted plan waits for conversation release, executes at arrival, and survives save/load',()=>{
 const s=createSession();dispatch(s,{type:'ask',person:'bell',topic:'case'});
 queue(s,'bell','survey:inn');assert.equal(s.world.npcs.bell.travel,null);
 const old=exportSession(s),restored=importSession(old);
 for(const target of [s,restored]){dispatch(target,{type:'endConversation'});assert.ok(target.world.npcs.bell.travel);dispatch(target,{type:'wait',minutes:5});}
 assert.deepEqual(s,restored);assert.ok(diagnostics(s).ok);
 assert.equal(s.world.npcs.bell.pendingPlan,null);
 assert.ok(s.world.npcs.bell.beliefs.some(b=>b.key==='observed_location_inn'));
 assert.ok(s.events.some(e=>e.data.planStatus==='completed'));
});

test('Queued transfer cannot remotely give an object when the recipient has left',()=>{
 const s=createSession();commit(s,{kind:'world',title:'Transfer fixture',changes:{'objects.folio':'bell','npcs.ada.location':'square'}});
 queue(s,'bell','give:folio:ada');
 commit(s,{kind:'world',title:'Ada leaves',changes:{'npcs.ada.location':'inn'}});
 dispatch(s,{type:'wait',minutes:10});
 assert.equal(s.world.objects.folio,'bell');assert.equal(s.world.npcs.bell.pendingPlan,null);
 assert.ok(s.events.some(e=>e.data.planStatus==='blocked'));assert.ok(diagnostics(s).ok);
});

test('World checks ignore claimed recipient presence and reject fabricated containers or fields',()=>{
 const s=createSession(),base={actor:'bell',label:'test',sources:[]};
 for(const step of [
  {kind:'communicate',recipient:'ada',location:'square',belief:'murder_report',recipientPresent:true},
  {kind:'conceal',object:'folio',location:'square',to:'invented'},
  {kind:'move',to:'inn',changes:{status:'solved'}},
  {kind:'observe',object:'folio',location:'square'}
 ]){assert.notEqual(assessPlan(kernel,s,{...base,steps:[step]}).status,'allow');const before=exportSession(s);assert.notEqual(executePlanStep(kernel,s,{...base,steps:[step]},s.events[0].id).status,'executed');assert.equal(exportSession(s),before);}
});

test('AI selects a checked physical plan and cannot invent a capability or patch',async()=>{
 const s=createSession(),t=prepareCharacterTurn(s,{person:'bell',text:'Please look around the inn after we finish talking.'});
 const p={plan:'survey:inn',intent:'clarify',account:null,utterance:'I can look around the inn after we finish.',claims:[],sources:[],trust:'unchanged',belief:'remember_only',engagement:'continue',rationale:'Investigate the requested place.'};
 assert.equal(validateCharacterProposal(t,{...p,plan:'teleport:inn'}).ok,false);
 assert.equal(validateCharacterProposal(t,{...p,plan:{steps:[]}}).ok,false);
 const m=new Map(),store={getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)};setLlmConfig({endpoint:'http://127.0.0.1:8787',enabled:true},store);
 const result=await proposeCharacterTurn(t,{store,fetchImpl:async(_,init)=>({ok:true,json:async()=>({text:JSON.parse(init.body).system===CHARACTER_CRITIC?'{"verdict":"pass","violations":[]}':JSON.stringify(p)})})});
 assert.equal(result.audit.status,'accepted');applyCharacterTurn(s,t,result);
 assert.equal(s.world.npcs.bell.pendingPlan.plan.id,'survey:inn');assert.equal(s.world.npcs.bell.travel,null);
 dispatch(s,{type:'endConversation'});assert.ok(s.world.npcs.bell.travel);
 assert.ok(diagnostics(s).ok);
});

test('Premise revisions retire transitive inferences, preserve old history, and reject support cycles',()=>{
 const s=createSession(),source=s.events[0].id;
 kernel.believe(s,'bell','premise','An initial account.',.8,'testimony',source,null);
 kernel.believe(s,'bell','inference','A tentative conclusion.',.6,'inference',source,null,{supports:['premise']});
 kernel.believe(s,'bell','dependent','Another conclusion.',.5,'inference',source,null,{supports:['inference']});
 assert.throws(()=>kernel.believe(s,'bell','premise','Circular.',.5,'inference',source,null,{supports:['dependent']}),/Cyclic/);
 const cursor=s.events.length-1;
 kernel.believe(s,'bell','premise','A corrected account.',.8,'testimony',source,null);
 assert.ok(!s.world.npcs.bell.beliefs.some(b=>['inference','dependent'].includes(b.key)));
 assert.ok(worldAt(s,cursor).npcs.bell.beliefs.some(b=>b.key==='dependent'));
 assert.ok(s.events.some(e=>e.data.reason?.includes('needs re-derivation')));
 assert.deepEqual(importSession(exportSession(s)),s);assert.ok(diagnostics(s).ok);
});

test('Knowledge remains attributed and unknown after another character shares an observation',()=>{
 const s=createSession();queue(s,'bell','survey:square');dispatch(s,{type:'wait',minutes:10});
 commit(s,{kind:'world',title:'Ada meets Bell',changes:{'npcs.ada.location':'square','npcs.ada.travel':null}});
 queue(s,'bell','tell:observed_location_square:ada');resumePlan(kernel,s,'bell',s.events.at(-1).id);
 const report=s.world.npcs.ada.beliefs.find(b=>b.key==='report_bell_observed_location_square');
 assert.ok(report);assert.equal(report.speaker,'bell');assert.equal(report.truth,null);assert.match(report.text,/Arthur Bell says:/);
 assert.ok(diagnostics(s).ok);
});

test('Case-granted concealment runs shared transfers and witnesses learn only local actions',()=>{
 const s=createSession();commit(s,{kind:'world',title:'Concealment fixture',changes:{'npcs.silas.location':'manor','npcs.clara.location':'manor','npcs.clara.travel':null}});
 kernel.believe(s,'silas','detective_knows_accounts','The detective knows the accounts.',.99,'observation',s.events[0].id,true);
 queue(s,'silas','conceal:folio');resumePlan(kernel,s,'silas',s.events.at(-1).id);
 assert.equal(s.world.objects.folio,'silas');assert.ok(s.world.npcs.silas.travel);
 assert.ok(s.world.npcs.clara.beliefs.some(b=>b.key==='holder_folio'));
 assert.ok(!s.world.npcs.bell.beliefs.some(b=>b.key==='holder_folio'));
 dispatch(s,{type:'wait',minutes:15});assert.equal(s.world.objects.folio,'drawer');assert.equal(s.world.npcs.silas.concealed,true);assert.ok(s.world.npcs.clara.beliefs.some(b=>b.key==='saw_folio_taken'));
 assert.equal(s.world.npcs.silas.pendingPlan,null);assert.ok(diagnostics(s).ok);
});

test('A revised communication source invalidates the queued message instead of sharing stale testimony',()=>{
 const s=createSession();queue(s,'bell','survey:square');resumePlan(kernel,s,'bell',s.events.at(-1).id);
 commit(s,{kind:'world',title:'Meeting fixture',changes:{'npcs.ada.location':'square'}});
 queue(s,'bell','tell:observed_location_square:ada');
 const revised=commit(s,{kind:'observation',actor:'bell',title:'A new observation'});
 kernel.believe(s,'bell','observed_location_square','A changed observation.',.99,'observation',revised,true);
 resumePlan(kernel,s,'bell',revised);
 assert.ok(!s.world.npcs.ada.beliefs.some(b=>b.key==='report_bell_observed_location_square'));
 assert.ok(s.events.some(e=>e.data.planStatus==='blocked'&&e.data.reason.includes('source belief changed')));
 assert.ok(diagnostics(s).ok);
});
