import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,dispatch,exportSession,importSession,diagnostics,worldAt} from '../dist/engine.mjs';
import {prepareCharacterTurn,validateCharacterProposal,proposeCharacterTurn,applyCharacterTurn,CHARACTER_CRITIC} from '../dist/character-turn.mjs';
import {setLlmConfig} from '../dist/llm.mjs';
const active=()=>{const m=new Map(),store={getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)};setLlmConfig({endpoint:'http://127.0.0.1:8787',enabled:true},store);return store;};
const ticket=(s,person,text='Tell me about last night.',action=null)=>prepareCharacterTurn(s,{person,text,action});
const proposal=(t,id)=>{const a=t.context.accounts.find(a=>a.id===id);return {intent:a?(a.deceptive?'deceive':'answer'):'clarify',account:id,utterance:a?.statement??'Which part of your question would you like me to address?',claims:a?.claims??[],sources:a?.sources??[],trust:'unchanged',belief:'remember_only',engagement:'continue',rationale:'Respond to the current question.'};};
async function accepted(t,p){return proposeCharacterTurn(t,{store:active(),fetchImpl:async(_url,init)=>({ok:true,json:async()=>({text:JSON.parse(init.body).system===CHARACTER_CRITIC?'{"verdict":"pass","violations":[]}':JSON.stringify(p)})})});}
const here=(to)=>{const s=createSession();dispatch(s,{type:'move',to});return s;};

test('Character context contains own beliefs without truth labels, other minds or future events',()=>{
 const s=here('manor'),before=exportSession(s),t=ticket(s,'clara');
 assert.equal(exportSession(s),before);
 assert.ok(t.context.character.beliefs.some(b=>b.key==='rowan_innocent'));
 const json=JSON.stringify(t.context);
 assert.doesNotMatch(json,/committed_murder|I killed Edmund|forged transfer|"truth"|"npcs"/);
 assert.ok(t.context.accounts.some(a=>a.id==='ask:alibi'&&a.deceptive));
 assert.ok(!t.context.accounts.some(a=>a.id==='ask:challenge_record'));
 assert.throws(()=>ticket(s,'silas'),/Find this person/);
});

test('Accepted deceptive account records chosen speech, causal history and deterministic replay',async()=>{
 const s=here('vestry'),t=ticket(s,'silas'),p=proposal(t,'ask:alibi');
 p.utterance='As I recall it, '+p.utterance;p.trust='cooler';
 const result=await accepted(t,p);assert.equal(result.audit.status,'accepted');
 applyCharacterTurn(s,t,result);
 const reply=s.events.findLast(e=>e.kind==='speech'&&e.actor==='silas');
 assert.equal(reply.data.assertion,p.utterance);assert.equal(reply.data.intent,'deceive');
 assert.ok(reply.data.authoredAssertion);
 assert.equal(s.world.player.evidence.find(e=>e.clue==='alibi').text,p.utterance);
 assert.equal(s.world.npcs.silas.dialogueState.turns,1);
 assert.ok(s.world.npcs.silas.memories.some(id=>s.events.find(e=>e.id===id)?.data.unverified));
 assert.equal(s.world.npcs.silas.location,'vestry');assert.deepEqual(diagnostics(s).errors,[]);
 const restored=importSession(exportSession(s));assert.deepEqual(restored,s);
 dispatch(s,{type:'wait',minutes:10});dispatch(restored,{type:'wait',minutes:10});assert.deepEqual(restored,s);
});

test('Evidence-gated model decision revises an alibi and uses the authored downstream effects',async()=>{
 const s=here('vestry');dispatch(s,{type:'ask',person:'silas',topic:'alibi'});dispatch(s,{type:'inspect',object:'delivery'});
 const t=ticket(s,'silas','Your receipt puts you at the manor at 21:12. Explain that.'),p=proposal(t,'ask:challenge_delivery');
 const before=s.events.length-1;applyCharacterTurn(s,t,await accepted(t,p));
 assert.ok(s.world.npcs.silas.beliefs.some(b=>b.key==='alibi_challenged'));
 assert.ok(!worldAt(s,before).npcs.silas.beliefs.some(b=>b.key==='alibi_challenged'));
 const next=ticket(s,'silas','What did you tell me earlier?');
 assert.ok(next.context.character.history.some(e=>e.text.includes('receipt')));
 assert.equal(next.context.character.conversation.turns,1);
 assert.deepEqual(diagnostics(s).errors,[]);
});

test('Model may clarify or refuse without acquiring evidence; explicit ending releases the speaker',async()=>{
 const s=here('manor'),t=ticket(s,'clara','Who killed Edmund?'),p=proposal(t,null);
 p.intent='refuse';p.utterance='I will not discuss that. Goodbye.';p.engagement='end';
 applyCharacterTurn(s,t,await accepted(t,p));
 assert.equal(s.world.player.evidence.length,0);assert.equal(s.world.player.conversation,null);
 assert.equal(s.world.npcs.clara.dialogueState.lastIntent,'refuse');
 assert.ok(!s.world.npcs.clara.disclosed);assert.deepEqual(diagnostics(s).errors,[]);
});

test('Invalid proposals cannot inject raw patches, fabricated claims, unavailable disclosures or times',()=>{
 const s=here('manor'),t=ticket(s,'clara'),p=proposal(t,'ask:alibi');
 for(const bad of [{...p,changes:{'status':'solved'}},{...p,claims:['secret']},{...p,sources:['e99999']},{...p,account:'ask:challenge_record'},{...p,utterance:p.utterance+' At 21:14.'},{...p,intent:'teleport'}])assert.equal(validateCharacterProposal(t,bad).ok,false);
});

test('Critic rejection gets one repair attempt, then falls back without applying the rejected words',async()=>{
 const s=here('manor'),t=ticket(s,'clara','Where were you?',{type:'ask',person:'clara',topic:'alibi'}),p=proposal(t,'ask:alibi');
 p.utterance='I did it. I confess to everything.';let calls=0;
 const r=await proposeCharacterTurn(t,{store:active(),fetchImpl:async(_url,init)=>{calls++;return {ok:true,json:async()=>({text:JSON.parse(init.body).system===CHARACTER_CRITIC?'{"verdict":"reject","violations":["private disclosure and invented admission"]}':JSON.stringify(p)})};}});
 assert.equal(calls,4);assert.equal(r.proposal,null);applyCharacterTurn(s,t,r);
 assert.doesNotMatch(s.events.filter(e=>e.playerText).map(e=>e.playerText).join(' '),/confess|I did it/i);
 assert.match(s.events.findLast(e=>e.actor==='clara'&&e.kind==='speech').data.assertion,/library/);
 assert.ok(!s.world.npcs.clara.disclosed);
});

test('Timeout, offline fallback, cancellation and stale responses cannot partially apply a turn',async()=>{
 const s=here('manor'),t=ticket(s,'clara'),before=exportSession(s);
 const timed=await proposeCharacterTurn(t,{store:active(),timeoutMs:5,fetchImpl:()=>new Promise(()=>{})});
 assert.equal(timed.audit.reason,'timeout');assert.equal(exportSession(s),before);
 const controller=new AbortController();controller.abort();
 const cancelled=await proposeCharacterTurn(t,{store:active(),signal:controller.signal,fetchImpl:()=>{throw Error('must not call')}});
 assert.equal(cancelled.audit.reason,'cancelled');applyCharacterTurn(s,t,cancelled);assert.equal(exportSession(s),before);
 const valid=await accepted(t,proposal(t,'ask:alibi'));dispatch(s,{type:'wait',minutes:1});const after=exportSession(s);
 assert.throws(()=>applyCharacterTurn(s,t,valid),/world changed/);assert.equal(exportSession(s),after);
 const fresh=ticket(s,'clara');const offline=await proposeCharacterTurn(fresh);applyCharacterTurn(s,fresh,offline);
 assert.equal(s.world.player.evidence.length,0);assert.deepEqual(diagnostics(s).errors,[]);
});

test('Every character can take an accepted turn without another actor owning the response',async()=>{
 for(const [person,to,topic]of [['clara','manor','alibi'],['rowan','greenhouse','night'],['silas','vestry','alibi'],['ada','inn','night'],['iris','surgery','night'],['bell','square','case']]){
  const s=person==='bell'?createSession():here(to),t=ticket(s,person),p=proposal(t,`ask:${topic}`);
  applyCharacterTurn(s,t,await accepted(t,p));
  assert.equal(s.world.npcs[person].dialogueState.turns,1);
  const next=ticket(s,person,'How do you know?');assert.ok(next.context.character.history.some(e=>e.text===p.utterance));
  assert.deepEqual(diagnostics(s).errors,[]);
 }
});

test('Clara disclosure and Ada correction retain their engine consequences under model decisions',async()=>{
 const s=createSession();dispatch(s,{type:'move',to:'surgery'});dispatch(s,{type:'inspect',object:'record'});dispatch(s,{type:'move',to:'manor'});dispatch(s,{type:'ask',person:'clara',topic:'alibi'});
 let t=ticket(s,'clara','The visiting record puts you with Rowan.');let p=proposal(t,'ask:challenge_record');
 applyCharacterTurn(s,t,await accepted(t,p));assert.equal(s.world.npcs.clara.disclosed,true);
 const a=here('inn');dispatch(a,{type:'inspect',object:'clock'});
 t=ticket(a,'ada','Look at this clock record.',{type:'present',person:'ada',clue:'clock',tone:'private'});p=proposal(t,'present:clock:private');
 applyCharacterTurn(a,t,await accepted(t,p));assert.equal(a.world.flags.clockCorrected,true);assert.deepEqual(diagnostics(a).errors,[]);
});

test('Audit from another prompt cannot authorize a proposal in this turn',async()=>{
 const s=here('manor'),t=ticket(s,'clara'),p=proposal(t,'ask:alibi'),result=await accepted(t,p),before=exportSession(s);
 result.audit.attempts[0].critic.request.prompt='unrelated';
 assert.throws(()=>applyCharacterTurn(s,t,result),/Unvalidated/);assert.equal(exportSession(s),before);
});

test('Player allegations can become attributed uncertain beliefs, never canonical facts',async()=>{
 const s=here('vestry'),t=ticket(s,'silas','I believe the doctor is hiding something.'),p=proposal(t,null);
 p.intent='challenge';p.utterance='What evidence supports your allegation?';p.belief='doubt';
 const before=JSON.stringify(s.world.objects);applyCharacterTurn(s,t,await accepted(t,p));
 const belief=s.world.npcs.silas.beliefs.find(b=>b.key.startsWith('player_report_'));
 assert.equal(belief.sourceType,'testimony');assert.equal(belief.truth,null);assert.equal(belief.confidence,.2);
 assert.equal(s.events.find(e=>e.id===belief.sourceId).actor,'player');assert.equal(JSON.stringify(s.world.objects),before);
 assert.ok(ticket(s,'silas').context.character.beliefs.some(b=>b.key===belief.key&&!Object.hasOwn(b,'truth')));
 assert.deepEqual(diagnostics(s).errors,[]);
});

test('A complete testimony investigation remains solvable through accepted character turns',async()=>{
 const s=createSession();
 for(const action of [{type:'move',to:'greenhouse'},{type:'inspect',object:'letter'},{type:'move',to:'manor'}])dispatch(s,action);
 let t=ticket(s,'clara','Let us discuss this letter privately.',{type:'present',person:'clara',clue:'letter',tone:'private'});
 applyCharacterTurn(s,t,await accepted(t,proposal(t,'present:letter:private')));
 for(const object of ['body','folio'])dispatch(s,{type:'inspect',object});
 dispatch(s,{type:'move',to:'vestry'});
 t=ticket(s,'silas','Where were you last night?',{type:'ask',person:'silas',topic:'alibi'});
 applyCharacterTurn(s,t,await accepted(t,proposal(t,'ask:alibi')));
 for(const action of [{type:'inspect',object:'delivery'},{type:'move',to:'surgery'},{type:'inspect',object:'record'},{type:'move',to:'square'}])dispatch(s,action);
 dispatch(s,{type:'accuse',suspect:'silas',method:'seal',motive:'fraud',evidence:s.world.player.evidence.map(e=>e.clue)});
 assert.equal(s.world.status,'solved');assert.deepEqual(s.world.ending.routes,['testimony']);assert.deepEqual(diagnostics(s).errors,[]);
});


test('Ambiguous critic verdicts exhaust the retry budget and cannot commit model speech',async()=>{
 const s=here('manor'),t=ticket(s,'clara','Where were you?',{type:'ask',person:'clara',topic:'alibi'}),p=proposal(t,'ask:alibi');
 p.utterance='As I recall it, '+p.utterance;let calls=0;
 const result=await proposeCharacterTurn(t,{store:active(),fetchImpl:async(_url,init)=>{
   calls++;return {ok:true,json:async()=>({text:JSON.parse(init.body).system===CHARACTER_CRITIC
     ? 'Example: {"verdict":"pass","violations":[]} Actual verdict: reject.'
     : JSON.stringify(p)})};
 }});
 assert.equal(calls,4);assert.equal(result.proposal,null);
 applyCharacterTurn(s,t,result);
 assert.notEqual(s.events.findLast(e=>e.actor==='clara'&&e.kind==='speech').data.assertion,p.utterance);
 assert.deepEqual(diagnostics(s).errors,[]);
});
