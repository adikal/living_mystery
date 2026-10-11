import test from 'node:test';
import assert from 'node:assert/strict';
import {SYSTEM_PROMPT,CRITIC_PROMPT,buildUserPrompt,checkAnchors,llmConfig,setLlmConfig,llmActive,realizeLine,realizeDialogue,parseCritic,turnTimeout,turnTimeoutKnown} from '../dist/llm.mjs';
const authored='I lent Silas my green coat at 20:55.',payload={speaker:'Rowan',authoredLine:authored,entities:['Silas','Rowan']};
function fakeStore(){const m=new Map();return {getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)}}
function active(){const store=fakeStore();setLlmConfig({endpoint:'http://127.0.0.1:8787',enabled:true},store);return store}
function sequence(...responses){let n=0;return async()=>({ok:true,json:async()=>({text:responses[n++]})})}
const pass='{"verdict":"pass","violations":[]}';
test('Generator and critic have separate instructions and critic receives source and candidate',async()=>{
  const requests=[],candidate='At 20:55, I lent my green coat to Silas.';
  const r=await realizeDialogue(payload,{store:active(),fetchImpl:async(url,init)=>{requests.push(JSON.parse(init.body));return {ok:true,json:async()=>({text:requests.length===1?candidate:pass})}}});
  assert.equal(r.text,candidate);assert.equal(r.status,'accepted');assert.equal(requests[0].system,SYSTEM_PROMPT);assert.equal(requests[1].system,CRITIC_PROMPT);
  assert.deepEqual(JSON.parse(requests[1].prompt),{authored,candidate});assert.equal(r.critic.verdict.verdict,'pass');
  assert.equal(JSON.parse(buildUserPrompt(payload)).authoredLine,authored);
});
test('Changed numeric anchors and named entities fail before critic',async()=>{
  for(const candidate of ['I lent Silas my green coat at 21:30.','I lent Rowan my green coat at 20:55.']){
    let calls=0;const r=await realizeDialogue(payload,{store:active(),fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({text:candidate})}}});
    assert.equal(r.text,authored);assert.equal(calls,1);assert.match(r.reason,/changed_/);
  }
});
test('Critic rejection catches semantic changes left to the critic, and preserves audit',async()=>{
  const candidate='I did not lend Silas my green coat at 20:55.';
  assert.equal(checkAnchors(authored,candidate,payload.entities),null);
  const r=await realizeDialogue(payload,{store:active(),fetchImpl:sequence(candidate,'{"verdict":"reject","violations":["Negated the original claim"]}')});
  assert.equal(r.text,authored);assert.equal(r.reason,'critic_rejected');assert.equal(r.response,candidate);
});
test('Malformed, contradictory, or unavailable critic never releases generated text',async()=>{
  for(const verdict of ['yes','{"verdict":"pass","violations":["Changed claim"]}','{"verdict":"pass","violations":[],"extra":true}']){
    const r=await realizeDialogue(payload,{store:active(),fetchImpl:sequence('Well, '+authored,verdict)});assert.equal(r.reason,'invalid_critic');assert.equal(r.text,authored);
  }
  let count=0;const r=await realizeDialogue(payload,{store:active(),fetchImpl:async()=>{if(count++)throw Error('down');return {ok:true,json:async()=>({text:'Well, '+authored})}}});assert.equal(r.text,authored);assert.equal(r.reason,'network_error');
});
test('Settings validate URL and disabled mode makes no request',async()=>{
  const store=fakeStore();assert.equal(llmActive(store),false);setLlmConfig({endpoint:'http://127.0.0.1:8787',enabled:true},store);assert.equal(llmActive(store),true);assert.equal(llmConfig(store).enabled,true);
  for(const endpoint of ['not-a-url','http://user:pass@localhost:8787','javascript:foo']){setLlmConfig({endpoint},store);assert.equal(llmActive(store),false)}
  assert.equal(await realizeLine(payload,{store,fetchImpl:()=>{throw Error('must not call')}}),authored);
});
test('Timeout resolves even when transport ignores abort',async()=>{
  const r=await realizeDialogue(payload,{store:active(),timeoutMs:5,fetchImpl:()=>new Promise(()=>{})});assert.equal(r.reason,'timeout');assert.equal(r.text,authored);
});
test('Exact authored response needs no critic',async()=>{
  const r=await realizeDialogue(payload,{store:active(),fetchImpl:sequence(authored)});assert.equal(r.reason,'unchanged');assert.equal(r.critic,null);
});


test('Critic accepts a complete JSON verdict, optionally in a single code fence',()=>{
  for(const raw of [pass,`  ${pass}\n`,`\`\`\`json\n${pass}\n\`\`\``,`\`\`\`\n${pass}\n\`\`\``]){
    assert.deepEqual(parseCritic(raw),{verdict:'pass',violations:[]});
  }
});

test('A bare pass verdict is a pass; a bare reject or a pass with other fields is unclear, so not a pass',()=>{
  assert.deepEqual(parseCritic('{"verdict":"pass"}'),{verdict:'pass',violations:[]});
  assert.deepEqual(parseCritic('```json\n{"verdict": "pass"}\n```'),{verdict:'pass',violations:[]});
  for(const raw of ['{"verdict":"reject"}','{"verdict":"pass","note":"fine"}','{"verdict":"maybe"}'])assert.equal(parseCritic(raw),null);
});

test('Ambiguous critic prose cannot authorize a generated line',async()=>{
  const ambiguous=[
    `Example output: ${pass}\nActual verdict: reject. The reply invents evidence.`,
    `${pass}\nHowever, the reply changes the account.`,
    `Here is my verdict:\n\`\`\`json\n${pass}\n\`\`\``,
    `${pass} ${pass}`,
    `\`\`\`json\n${pass}\n\`\`\`\nRejected.`,
  ];
  for(const raw of ambiguous){
    assert.equal(parseCritic(raw),null);
    const result=await realizeDialogue(payload,{store:active(),fetchImpl:sequence('Well, '+authored,raw)});
    assert.equal(result.status,'fallback');assert.equal(result.reason,'invalid_critic');assert.equal(result.text,authored);
  }
});

test('The turn timeout comes from the proxy, once per endpoint, and is 45 s until it answers or if it cannot',async()=>{
  const mem=new Map();const store={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,v)};
  setLlmConfig({endpoint:'http://127.0.0.1:8797/',enabled:true},store);
  const asked=[];const fetchImpl=async url=>{asked.push(String(url));return {json:async()=>({turn_timeout_ms:240000})};};
  assert.equal(turnTimeout(store,fetchImpl),45000);
  await turnTimeoutKnown(store);
  assert.equal(turnTimeout(store,fetchImpl),240000);
  assert.deepEqual(asked,['http://127.0.0.1:8797/health']);
  setLlmConfig({endpoint:'http://127.0.0.1:8798/'},store);
  turnTimeout(store,async()=>{throw Error('down');});await turnTimeoutKnown(store);
  assert.equal(turnTimeout(store),45000);
});
