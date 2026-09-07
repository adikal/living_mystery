import test from 'node:test';
import assert from 'node:assert/strict';
import {CASE,CLUES,createSession,dispatch,commit,diagnostics,worldAt,playerView,exportSession,importSession,parseCommand} from '../dist/engine.mjs';

const move=(s,to)=>{if(s.world.player.location!==to)dispatch(s,{type:'move',to});};
const inspect=(s,object)=>dispatch(s,{type:'inspect',object});
const evidence=s=>s.world.player.evidence.map(e=>e.clue);
const accuse=s=>dispatch(s,{type:'accuse',suspect:'silas',method:'seal',motive:'fraud',evidence:evidence(s)});
function healthy(s){assert.deepEqual(diagnostics(s).errors,[]);}
function collectPhysicalRoute(s){move(s,'manor');for(const obj of ['body','carpet','accounts'])inspect(s,obj);move(s,'vestry');inspect(s,'seal');inspect(s,'delivery');move(s,'surgery');inspect(s,'record');move(s,'square');}

test('A complete physical investigation supports the correct accusation',()=>{
  const s=createSession();collectPhysicalRoute(s);assert.equal(s.world.status,'playing');accuse(s);assert.equal(s.world.status,'solved');assert.deepEqual(s.world.ending.routes,['physical']);healthy(s);
});

test('A second route combines supported testimony, whereabouts, and financial evidence',()=>{
  const s=createSession();move(s,'greenhouse');inspect(s,'letter');move(s,'manor');
  dispatch(s,{type:'present',person:'clara',clue:'letter',tone:'private'});
  for(const obj of ['body','folio'])inspect(s,obj);
  move(s,'vestry');dispatch(s,{type:'ask',person:'silas',topic:'alibi'});inspect(s,'delivery');
  move(s,'surgery');inspect(s,'record');move(s,'square');accuse(s);
  assert.equal(s.world.status,'solved');assert.deepEqual(s.world.ending.routes,['testimony']);healthy(s);
});

test('Guessing the culprit, an incorrect theory, or unacquired evidence cannot win',()=>{
  const s=createSession();dispatch(s,{type:'accuse',suspect:'silas',method:'seal',motive:'fraud',evidence:Object.keys(CLUES)});assert.equal(s.world.status,'playing');
  collectPhysicalRoute(s);dispatch(s,{type:'accuse',suspect:'rowan',method:'seal',motive:'fraud',evidence:evidence(s)});assert.equal(s.world.status,'playing');
  dispatch(s,{type:'accuse',suspect:'silas',method:'poison',motive:'fraud',evidence:evidence(s)});assert.equal(s.world.status,'playing');healthy(s);
});

test('A threat travels through an actual encounter and changes Rowan’s attitude',()=>{
  const s=createSession();move(s,'greenhouse');inspect(s,'letter');move(s,'manor');
  const before=s.events.length-1;
  dispatch(s,{type:'present',person:'clara',clue:'letter',tone:'press'});
  dispatch(s,{type:'wait',minutes:10});
  assert.equal(s.world.npcs.clara.warned,true);assert.equal(s.world.npcs.rowan.trust,.12);
  const b=s.world.npcs.rowan.beliefs.find(b=>b.key==='detective_threatened_clara');
  const source=s.events.find(e=>e.id===b.sourceId);assert.equal(source.kind,'speech');assert.equal(source.location,'greenhouse');assert.equal(source.data.listener,'rowan');
  assert.equal(source.playerText,null);assert.equal(worldAt(s,before).npcs.rowan.trust,.38);
  assert.ok(!playerView(s).transcript.some(e=>e.text.includes('Clara draws Rowan aside')));healthy(s);
});

test('Showing Silas the accounts creates a traceable concealment plan and moves a real object',()=>{
  const s=createSession();move(s,'manor');inspect(s,'accounts');move(s,'vestry');
  assert.equal(s.world.objects.folio,'manor');dispatch(s,{type:'present',person:'silas',clue:'ledger'});
  dispatch(s,{type:'wait',minutes:25});assert.equal(s.world.objects.folio,'drawer');
  const decision=s.events.find(e=>e.kind==='decision'&&e.actor==='silas'&&e.data.selected==='conceal');assert.ok(decision);
  assert.ok(decision.data.candidates.length>=2);assert.equal(decision.data.candidates.find(c=>c.id==='conceal').score,88);
  const take=s.events.find(e=>e.title==='Silas takes the red folio');assert.equal(take.playerText,null);assert.equal(worldAt(s,take.index).objects.folio,'silas');
  const locationBelief=s.world.npcs.silas.beliefs.find(b=>b.key==='folio_at_manor');
  assert.match(locationBelief.text,/deed drawer/);assert.equal(s.events.find(e=>e.id===locationBelief.sourceId).title,'Silas hides the folio in the deed drawer');
  inspect(s,'drawer');assert.ok(evidence(s).includes('folio'));healthy(s);
});

test('Moving an already recorded document does not erase the detective’s knowledge',()=>{
  const s=createSession();move(s,'manor');inspect(s,'folio');inspect(s,'accounts');move(s,'vestry');
  dispatch(s,{type:'present',person:'silas',clue:'ledger'});dispatch(s,{type:'wait',minutes:25});
  assert.equal(s.world.objects.folio,'drawer');assert.ok(evidence(s).includes('folio'));healthy(s);
});

test('An honest mistake propagates, and a correction is not telepathic',()=>{
  const s=createSession();dispatch(s,{type:'wait',minutes:60});
  const rumor=s.world.npcs.bell.beliefs.find(b=>b.key==='adas_account');assert.equal(rumor.truth,false);
  assert.equal(s.events.find(e=>e.id===rumor.sourceId).data.listener,'bell');
  move(s,'inn');inspect(s,'clock');dispatch(s,{type:'present',person:'ada',clue:'clock'});
  assert.equal(s.world.npcs.ada.beliefs.find(b=>b.key==='saw_rowan').truth,true);
  assert.equal(s.world.npcs.bell.beliefs.find(b=>b.key==='adas_account').truth,false);healthy(s);
});

test('Distant speech and inaccessible inspections are rejected without advancing time',()=>{
  const s=createSession(),initial=structuredClone(s.world);
  dispatch(s,{type:'ask',person:'silas',topic:'alibi'});dispatch(s,{type:'inspect',object:'seal'});
  assert.deepEqual(s.world,initial);assert.equal(s.events.filter(e=>e.kind==='rejected').length,2);healthy(s);
});

test('The player projection excludes canonical truth and private NPC state',()=>{
  const s=createSession(),view=playerView(s),text=JSON.stringify(view);
  assert.equal(view.people.length,1);assert.equal(view.people[0].id,'bell');
  assert.ok(!text.includes(CASE.truth));assert.ok(!text.includes('committed_murder'));assert.ok(!text.includes('beliefs'));assert.equal(view.evidence.length,0);
});

test('An unobserved object change does not change Clara’s answer',()=>{
  const a=createSession(),b=createSession();move(a,'manor');move(b,'manor');
  commit(b,{kind:'action',title:'Counterfactual offstage relocation',actor:'world',changes:{'objects.folio':'drawer'}});
  dispatch(a,{type:'ask',person:'clara',topic:'alibi'});dispatch(b,{type:'ask',person:'clara',topic:'alibi'});
  const response=s=>s.events.findLast(e=>e.kind==='speech'&&e.actor==='clara').playerText;
  assert.equal(response(a),response(b));assert.equal(a.world.npcs.clara.trust,b.world.npcs.clara.trust);
});

test('Equal seeds and commands produce identical event histories; seeking is read-only',()=>{
  const a=createSession(22),b=createSession(22);const actions=[{type:'move',to:'manor'},{type:'inspect',object:'accounts'},{type:'move',to:'vestry'},{type:'present',person:'silas',clue:'ledger'},{type:'wait',minutes:50}];
  for(const action of actions){dispatch(a,action);dispatch(b,action);}assert.deepEqual(a,b);
  const frozen=JSON.stringify(a);for(const index of [0,15,40,70,a.events.length-1])worldAt(a,index);
  assert.equal(JSON.stringify(a),frozen);assert.deepEqual(worldAt(a,a.events.length-1),a.world);healthy(a);
});

test('Save/load preserves every event and permits the same deterministic continuation',()=>{
  const original=createSession(31);move(original,'manor');inspect(original,'accounts');
  const restored=importSession(exportSession(original));assert.deepEqual(restored,original);
  const action={type:'wait',minutes:60};dispatch(original,action);dispatch(restored,action);assert.deepEqual(restored,original);healthy(restored);
});

test('Tampered state, unsafe paths, and malformed event IDs fail save validation',()=>{
  const text=exportSession(createSession());const a=JSON.parse(text);a.world.minute=900;assert.throws(()=>importSession(JSON.stringify(a)),/integrity/);
  const b=JSON.parse(text);b.events[0].changes.push({path:'__proto__.polluted',after:true});assert.throws(()=>importSession(JSON.stringify(b)),/state change/);
  const c=JSON.parse(text);c.events[0].id='<img src=x>';assert.throws(()=>importSession(JSON.stringify(c)),/Malformed/);
  assert.equal({}.polluted,undefined);
});

test('Published command examples map to the intended actions',()=>{
  assert.equal(parseCommand('go manor').to,'manor');assert.equal(parseCommand('inspect desk').object,'desk');assert.equal(parseCommand('read visiting ledger').object,'record');
  assert.equal(parseCommand('ask Clara about alibi').person,'clara');assert.equal(parseCommand('wait 10').minutes,10);assert.equal(parseCommand('look').type,'look');
});


test('Local NPCs remember player arrivals and departures without learning the destination',()=>{
  const s=createSession();
  const initial=s.events.find(e=>e.actor==='bell'&&e.data.subject==='player');
  assert.equal(initial.data.phase,'arrival');
  assert.ok(s.world.npcs.bell.memories.includes(initial.id));
  move(s,'manor');
  const departure=s.events.find(e=>e.actor==='bell'&&e.data.phase==='departure');
  const arrival=s.events.find(e=>e.actor==='clara'&&e.data.subject==='player');
  assert.deepEqual(departure.data,{subject:'player',phase:'departure',observedLocation:'square',sourceType:'observation'});
  assert.equal(arrival.data.phase,'arrival');
  assert.equal(arrival.location,'manor');
  assert.equal(s.events.find(e=>e.id===departure.parents[0]).location,'square');
  assert.ok(!s.events.some(e=>e.actor==='silas'&&e.data.subject==='player'));
  assert.ok(!worldAt(s,arrival.index-1).npcs.clara.memories.includes(arrival.id));
  assert.ok(s.world.npcs.clara.memories.includes(arrival.id));
  assert.ok(!playerView(s).transcript.some(e=>e.id===arrival.id||e.id===departure.id));
  healthy(s);
});

test('NPC movement produces exactly the local witnesses at each event boundary',()=>{
  const s=createSession();dispatch(s,{type:'wait',minutes:60});
  const movements=s.events.filter(e=>e.kind==='movement'&&e.actor!=='player');
  assert.ok(movements.length>0);
  for(const movement of movements){
    const at=worldAt(s,movement.index);
    const witnesses=Object.entries(at.npcs).filter(([id,n])=>id!==movement.actor&&n.location===movement.location&&!n.travel).map(([id])=>id);
    const observations=s.events.filter(e=>e.kind==='observation'&&e.data.subject===movement.actor&&e.parents.includes(movement.id));
    assert.deepEqual(observations.map(e=>e.actor),witnesses);
    for(const observation of observations){
      assert.equal(observation.data.phase,movement.data.arrival?'departure':'arrival');
      assert.equal(observation.playerText,null);
      assert.equal(observation.data.purpose,undefined);
      assert.equal(observation.data.to,undefined);
      assert.ok(s.world.npcs[observation.actor].memories.includes(observation.id));
    }
  }
  const adaArrival=s.events.find(e=>e.actor==='ada'&&e.kind==='movement'&&!e.data.arrival);
  assert.ok(s.events.some(e=>e.actor==='bell'&&e.data.subject==='ada'&&e.parents.includes(adaArrival.id)));
  const restored=importSession(exportSession(s));
  dispatch(restored,{type:'wait',minutes:30});dispatch(s,{type:'wait',minutes:30});
  assert.deepEqual(restored,s);healthy(s);
});

test('Confronting Silas with physical evidence deepens stress with an authored, non-generic reaction',()=>{
  const s=createSession();move(s,'vestry');inspect(s,'seal');
  dispatch(s,{type:'present',person:'silas',clue:'seal'});
  const said=s.events.findLast(e=>e.kind==='speech'&&e.actor==='silas');
  assert.equal(said.data.intent,'Deflect physical evidence');
  assert.equal(s.world.npcs.silas.stress,.95);
  assert.ok(s.world.npcs.silas.beliefs.some(b=>b.key==='detective_has_physical'));
  healthy(s);
});

test('The delivery receipt is presented as a contradiction of Silas\u2019s stated alibi',()=>{
  const s=createSession();move(s,'vestry');inspect(s,'delivery');
  dispatch(s,{type:'present',person:'silas',clue:'delivery'});
  const said=s.events.findLast(e=>e.kind==='speech'&&e.actor==='silas');
  assert.equal(said.data.deception,'Contradiction with stated alibi');
  assert.equal(s.world.npcs.silas.stress,.9);
  healthy(s);
});

test('A witness recounts sightings drawn from memory, without revealing where anyone was headed',()=>{
  const s=createSession();
  dispatch(s,{type:'ask',person:'bell',topic:'sightings'});
  const said=s.events.findLast(e=>e.kind==='speech'&&e.actor==='bell').playerText;
  assert.match(said,/\byou\b/i);
  assert.doesNotMatch(said,/the detective/i);
  assert.doesNotMatch(said,/headed|toward|destination/i);
  healthy(s);
});

test('Showing Bell the fast clock casts doubt on Ada\u2019s account without silently rewriting it',()=>{
  const s=createSession();dispatch(s,{type:'wait',minutes:60});
  const before=s.world.npcs.bell.beliefs.find(b=>b.key==='adas_account');
  assert.ok(before&&before.confidence>=.7);
  move(s,'inn');inspect(s,'clock');move(s,'square');
  dispatch(s,{type:'present',person:'bell',clue:'clock'});
  const after=s.world.npcs.bell.beliefs.find(b=>b.key==='adas_account');
  assert.ok(after.confidence<=.5);
  assert.equal(after.truth,false);
  healthy(s);
});
