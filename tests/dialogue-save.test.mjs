import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,dispatch,exportSession,importSession} from '../dist/engine.mjs';
import {realizeDialogue,setLlmConfig} from '../dist/llm.mjs';
import {exportDialogueSave,importDialogueSave,dialogueEntities} from '../dist/dialogue-save.mjs';
async function fixture(){
  const session=createSession();dispatch(session,{type:'ask',person:'bell',topic:'case'});
  const event=session.events.find(e=>e.kind==='speech'&&e.data.listener==='player');
  const settings=new Map(),store={getItem:k=>settings.get(k),setItem:(k,v)=>settings.set(k,v)};
  setLlmConfig({endpoint:'http://127.0.0.1:8787',enabled:true},store);
  const record=await realizeDialogue({speaker:'Bell',authoredLine:event.data.assertion,entities:dialogueEntities},{store,fetchImpl:async(url,init)=>({ok:true,json:async()=>({text:JSON.parse(init.body).system.includes('independent')?'{"verdict":"pass","violations":[]}':'Let me think. '+event.data.assertion})})});
  return {session,event,record,audit:new Map([[event.id,record]])};
}
test('Dialogue audit round-trips separately without changing engine replay or continuation',async()=>{
  const f=await fixture(),before=exportSession(f.session),text=exportDialogueSave(f.session,f.audit),restored=importDialogueSave(text);
  assert.equal(exportSession(f.session),before);assert.deepEqual(restored.audit,f.audit);assert.deepEqual(importSession(text),f.session);
  dispatch(f.session,{type:'wait',minutes:10});dispatch(restored.session,{type:'wait',minutes:10});assert.deepEqual(restored.session,f.session);
});
test('Legacy saves load with no dialogue records',()=>assert.equal(importDialogueSave(exportSession(createSession())).audit.size,0));
test('Unapproved text or mismatched event assertions cannot be restored as AI dialogue',async()=>{
  const f=await fixture();
  for(const patch of [{text:'I killed Edmund.'},{authored:'Some other statement'},{eventId:'e00001'},{critic:null},{version:1}]){
    const save=JSON.parse(exportDialogueSave(f.session,f.audit));Object.assign(save.dialogue.records[0],patch);
    const restored=importDialogueSave(JSON.stringify(save));assert.equal(restored.audit.size,0);assert.deepEqual(restored.session,f.session);
  }
});


test('Board metadata round-trips without changing the engine and discards invalid placements',()=>{
  const session=createSession();dispatch(session,{type:'move',to:'vestry'});dispatch(session,{type:'inspect',object:'delivery'});
  const before=exportSession(session),notes={silas:{delivery:{pillar:'opportunity',polarity:'contradicts'},folio:{pillar:'motive',polarity:'supports'}},clara:{delivery:{pillar:'invalid',polarity:'supports'}},unknown:{delivery:{pillar:'means',polarity:'supports'}}};
  const saved=exportDialogueSave(session,new Map(),notes),restored=importDialogueSave(saved);
  assert.deepEqual(restored.boardNotes,{silas:{delivery:{pillar:'opportunity',polarity:'contradicts'}}});
  assert.equal(exportSession(restored.session),before);
  const malformed=JSON.parse(saved);malformed.reasoning.notes={silas:{delivery:null}};
  assert.deepEqual(importDialogueSave(JSON.stringify(malformed)).boardNotes,{});
  assert.deepEqual(importDialogueSave(before).boardNotes,{});
});
