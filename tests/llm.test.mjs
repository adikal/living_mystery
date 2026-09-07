import test from 'node:test';
import assert from 'node:assert/strict';
import {SYSTEM_PROMPT,buildUserPrompt,sanitizeRealization,llmConfig,setLlmConfig,llmActive,realizeLine} from '../dist/llm.mjs';

// A minimal in-memory localStorage stand-in.
function fakeStore(init={}){const m=new Map(Object.entries(init));return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};}

test('The system prompt states the non-negotiable fact-preservation boundary',()=>{
  assert.match(SYSTEM_PROMPT,/preserve every fact/i);
  assert.match(SYSTEM_PROMPT,/do not add new claims/i);
  assert.match(SYSTEM_PROMPT,/one to three sentences/i);
});

test('buildUserPrompt includes persona, manner, mood and the authored line, but only what it is given',()=>{
  const p=buildUserPrompt({speaker:'Silas Voss',role:'the estate solicitor',persona:'A precise, courteous solicitor.',manner:'guarded and evasive',traits:['very private','cautious'],mood:{trust:0.18,stress:0.9},authoredLine:'I was in the vestry from nine until half past. Alone.'});
  assert.match(p,/Silas Voss, the estate solicitor/);
  assert.match(p,/guarded and evasive/);
  assert.match(p,/very private, cautious/);
  assert.match(p,/trust in the detective 18%/);
  assert.match(p,/stress 90%/);
  assert.match(p,/I was in the vestry from nine until half past\. Alone\./);
});

test('sanitizeRealization keeps a good restyle but strips wrapping quotes and collapses newlines',()=>{
  const authored='I was in the vestry all evening.';
  assert.equal(sanitizeRealization(authored,'  "I kept to the vestry the whole evening, as I said."  '),'I kept to the vestry the whole evening, as I said.');
  assert.equal(sanitizeRealization(authored,'Line one.\n\nLine two.'),'Line one. Line two.');
});

test('sanitizeRealization falls back to the authored line on empty, refusal, code, or overlong output',()=>{
  const authored='The clock runs twelve minutes fast.';
  assert.equal(sanitizeRealization(authored,''),authored);
  assert.equal(sanitizeRealization(authored,'   '),authored);
  assert.equal(sanitizeRealization(authored,'As an AI language model, I cannot roleplay.'),authored);
  assert.equal(sanitizeRealization(authored,'```js\nconsole.log(1)\n```'),authored);
  assert.equal(sanitizeRealization(authored,'x'.repeat(5000)),authored);
  assert.equal(sanitizeRealization(authored,42),authored);
});

test('llmConfig / setLlmConfig / llmActive round-trip through an injected store',()=>{
  const store=fakeStore();
  assert.equal(llmActive(store),false);
  setLlmConfig({endpoint:'http://127.0.0.1:8787',enabled:true},store);
  assert.deepEqual(llmConfig(store),{endpoint:'http://127.0.0.1:8787',enabled:true});
  assert.equal(llmActive(store),true);
  setLlmConfig({enabled:false},store);
  assert.equal(llmActive(store),false);
  // enabled but no/invalid endpoint is not active
  setLlmConfig({endpoint:'not-a-url',enabled:true},store);
  assert.equal(llmActive(store),false);
});

test('realizeLine returns the authored line unchanged when the LLM is inactive (offline default)',async()=>{
  const store=fakeStore();
  let called=false;const fetchImpl=async()=>{called=true;return {ok:true,json:async()=>({text:'nope'})};};
  const out=await realizeLine({speaker:'Ada',authoredLine:'I saw a green coat.'},{store,fetchImpl});
  assert.equal(out,'I saw a green coat.');
  assert.equal(called,false,'must not call the network when inactive');
});

test('realizeLine uses the endpoint when active and sanitizes the response',async()=>{
  const store=fakeStore({'living-mystery.llm.endpoint':'http://127.0.0.1:8787','living-mystery.llm.enabled':'1'});
  let seen=null;
  const fetchImpl=async(url,init)=>{seen={url,body:JSON.parse(init.body)};return {ok:true,json:async()=>({text:'"I kept to the vestry, as I told you."'})};};
  const out=await realizeLine({speaker:'Silas Voss',authoredLine:'I was in the vestry.'},{store,fetchImpl,AbortControllerImpl:AbortController});
  assert.equal(out,'I kept to the vestry, as I told you.');
  assert.equal(seen.url,'http://127.0.0.1:8787');
  assert.equal(seen.body.system,SYSTEM_PROMPT);
  assert.match(seen.body.prompt,/I was in the vestry\./);
});

test('realizeLine falls back to the authored line on HTTP error or network throw',async()=>{
  const store=fakeStore({'living-mystery.llm.endpoint':'http://127.0.0.1:8787','living-mystery.llm.enabled':'1'});
  const authored='I lent Silas my green coat at 20:55.';
  assert.equal(await realizeLine({speaker:'Rowan',authoredLine:authored},{store,fetchImpl:async()=>({ok:false})}),authored);
  assert.equal(await realizeLine({speaker:'Rowan',authoredLine:authored},{store,fetchImpl:async()=>{throw new Error('network down');}}),authored);
});
