// Shared finite crime model. Both the browser evaluator and Z3 consume this IR.
// Evidence restricts explanations; hidden truth is used only by the authoring gate.
import {expr as x,term as v,evaluate} from './symbolic.mjs';
const eq=(a,b)=>x('eq',a,b),and=(...a)=>x('and',...a),or=(...a)=>x('or',...a),not=a=>x('not',a);
const domain=(max,min=0)=>({sort:'int',min,max});
export const STRUCTURES=['trace','cleanup','clockwork'];
export function crimeModel(spec,locations={}){
 const travel={manor:0};let changed=true;while(changed){changed=false;for(const [id,p]of Object.entries(locations))for(const [to,d]of Object.entries(p.links??{}))if((travel[id]??Infinity)>(travel[to]??Infinity)+d){travel[id]=travel[to]+d;changed=true;}}
 return {version:1,suspects:['clara','rowan','silas'],methods:['seal','candlestick','knife'],motives:['fraud','inheritance','eviction'],time:{start:1200,end:1439},travel,structure:spec.structure??'trace'};
}
// Rules are attached to acquired, source-checked records, never to CASE.culprit.
export function compileExplanation(model,claims,selected){
 const variables={suspect:domain(model.suspects.length-1),method:domain(model.methods.length-1),motive:domain(model.motives.length-1),time:domain(model.time.end,model.time.start)};
 const constraints=[];
 const rule=(id,label,formula,sources)=>constraints.push({id:`e_${id}`,label,formula,sources});
 const collected=selected.flatMap(id=>(claims[id]??[]).map(c=>({...c,evidence:id})));
 for(const [i,c] of collected.entries()){
  const interval=c.interval,t=v('time'),s=v('suspect');let f;
  if(c.predicate==='death_time')f=and(x('ge',t,interval.start),x('le',t,interval.end));
  if(c.predicate==='location'&&c.value!=='manor')f=not(and(eq(s,model.suspects.indexOf(c.subject)),x('ge',t,interval.start-(model.travel[c.value]??0)+1),x('le',t,interval.end+(model.travel[c.value]??0)-1)));
  if(c.predicate==='crime_method')f=eq(v('method'),model.methods.indexOf(c.value));
  if(c.predicate==='crime_motive')f=eq(v('motive'),model.motives.indexOf(c.value));
  // A trace comparison requires both independent records. Neither half suffices.
  if(c.predicate==='trace_match'&&selected.includes(c.requires))f=eq(v('method'),model.methods.indexOf(c.value));
  if(c.predicate==='exclusive_opportunity')f=and(eq(s,model.suspects.indexOf(c.subject)),x('ge',t,interval.start),x('le',t,interval.end));
  if(c.predicate==='clock_opportunity'&&selected.includes(c.requires)){
   const offset=collected.find(o=>o.predicate==='clock_offset'&&o.evidence===c.requires)?.value;
   if(Number.isInteger(offset))f=and(eq(s,model.suspects.indexOf(c.subject)),x('ge',t,interval.start-offset),x('le',t,interval.end-offset));
  }
  if(f)rule(String(i),c.label??`${c.evidence}: ${c.predicate}`,f,[c.evidence,...(c.requires?[c.requires]:[])]);
 }
 if(!constraints.length)rule('domain','No acquired evidence restricts the explanation',true,[]);
 return {version:1,kind:'crime-explanation',perspective:'world',minute:0,horizon:0,variables,constraints,assumptions:[{id:'closed_case_domain',text:'One killer, one listed method and motive, one fatal encounter at the study within the declared evening. Testimony is not automatically fact.'}]};
}
export function enumerateExplanations(query,model){
 // Exhaustive for this declared finite domain, not a claim about arbitrary stories.
 const result=[];
 for(let suspect=0;suspect<model.suspects.length;suspect++)for(let method=0;method<model.methods.length;method++)for(let motive=0;motive<model.motives.length;motive++){
  let first=null,last=null;
  for(let time=query.variables.time.min;time<=query.variables.time.max;time++){
   const values={suspect,method,motive,time};
   if(query.constraints.every(c=>evaluate(c.formula,values))){first??=time;last=time;}
  }
  if(first!==null)result.push({suspect:model.suspects[suspect],method:model.methods[method],motive:model.motives[motive],earliest:first,latest:last});
 }
 return result;
}
export function assessAccusation(session,action,model,claims,clues,routes,people={}){
 const selected=[...new Set(action.evidence??[])].filter(id=>session.world.player.evidence.some(e=>e.clue===id));
 const recorded=Object.fromEntries(selected.map(id=>{const acquired=session.world.player.evidence.find(e=>e.clue===id);const event=session.events.find(e=>e.id===acquired.eventId&&e.kind==='evidence'&&e.data.clue===id&&e.playerText);return [id,event?.data.claims??[]];}));
 const query=compileExplanation(model,recorded,selected),alternatives=enumerateExplanations(query,model);
 const matching=alternatives.filter(h=>h.suspect===action.suspect&&h.method===action.method&&h.motive===action.motive);
 const hasTime=selected.some(id=>(recorded[id]??[]).some(c=>c.predicate==='death_time'));
 const supported=hasTime&&alternatives.length===1&&matching.length===1;
 const status=!alternatives.length?'inconsistent':!matching.length?'contradicted':supported?'supported':'ambiguous';
 const dimensions=['suspect','method','motive'].filter(k=>new Set(alternatives.map(h=>h[k])).size>1);
 const guidance=dimensions.map(k=>({suspect:'independent whereabouts covering the fatal window',method:'a comparison linking the injury to the proposed weapon',motive:'a documented reason for the confrontation'})[k]);
 // Only acquired records can be named in feedback. No hidden clue locations/titles.
 const cited=selected.map(id=>clues[id]?.title??id);
 const settled=['suspect','method','motive'].filter(k=>alternatives.length&&new Set(alternatives.map(h=>h[k])).size===1).map(k=>`${k}: ${k==='suspect'?(people[alternatives[0][k]]?.name??alternatives[0][k]):alternatives[0][k]}`);
 const explanation=status==='supported'?`Within the tested explanations, your selected evidence supports ${people[action.suspect]?.name??action.suspect}, the ${action.method}, and ${action.motive}. No competing suspect, method or motive fits the fatal window.`
  :status==='inconsistent'?'The selected records conflict: no tested explanation fits them all. Recheck their timing and reliability.'
  :status==='contradicted'?'Your proposed explanation conflicts with the selected records. Reconsider the suspect, method or motive.'
  :`The evidence still permits ${alternatives.length} explanations.${settled.length?' The supported limits are '+settled.join('; ')+'.':''} Establish ${guidance.join('; ')||'the medical time window'}.`;
 return {supported,status,selected,routes:routes.filter(r=>r.all.every(id=>selected.includes(id))).map(r=>r.id),alternatives,query,feedback:`Bell reviews ${cited.length?cited.join(', '):'the empty evidence bundle'}. “${explanation}”`};
}

// Extract factual support from typed occurrences. Natural-language similarity is
// deliberately not an entailment rule. Testimony supports what was said, not truth.
export function occurrenceFacts(event){
 const d=event.data,f=[];
 if(d.occurrence==='fatal_action')f.push(['killing',event.actor,d.method,d.deathMinute]);
 if(d.occurrence==='appointment_observation')for(const person of d.people)f.push(['location',person,'greenhouse',d.start,d.end]);
 if(d.occurrence==='examination')f.push(['death_time','edmund',d.deathMinute-4,d.deathMinute+4],['injury',d.method]);
 if(d.occurrence==='clock_check')f.push(['clock_offset',d.offset]);
 if(d.occurrence==='document_observation')f.push(['document_location','folio','manor']);
 if(d.occurrence==='report')f.push(['said',event.actor,d.listener,d.assertion]);
 return f;
}
export function validateKnowledge(session,people){
 const errors=[];
 for(const [person,npc]of Object.entries(session.world.npcs))for(const b of npc.beliefs){
  const source=session.events.find(e=>e.id===b.sourceId);
  if(!source){errors.push(`${person}:${b.key}: missing source`);continue;}
  // The configured seed protocol declares exact supported content and premises.
  const declaration=session.events.find(e=>e.data.knowledgeSupport?.person===person&&e.data.knowledgeSupport.key===b.key);
  if(!declaration){errors.push(`${person}:${b.key}: no structured support rule`);continue;}
  const support=declaration.data.knowledgeSupport;
  if(support.text!==b.text||support.source!==b.sourceId||renderSupportedAccount(source,people)!==b.text){errors.push(`${person}:${b.key}: assertion differs from supported content`);continue;}
  if(source.actor!==person&&!(source.data.listener===person&&source.kind==='speech')){errors.push(`${person}:${b.key}: source was not experienced or received`);continue;}
  const allowed=new Set([source.id,...source.parents]);
  if(!support.premises.length||support.premises.some(p=>!allowed.has(p.source)||!occurrenceFacts(session.events.find(e=>e.id===p.source)??{data:{}}).some(f=>JSON.stringify(f)===JSON.stringify(p.fact))))errors.push(`${person}:${b.key}: source does not entail declared premises`);
 }
 return {ok:!errors.length,detail:errors.join('; ')||'Every initial belief matches a typed, personally accessible source and its declared premises',errors};
}
export function recordKnowledgeSupport(K,s,person,key,text,source){
 const e=s.events.find(e=>e.id===source),premises=[];
 for(const ev of [e,...e.parents.map(id=>s.events.find(e=>e.id===id))].filter(ev=>ev&&(ev.actor===person||ev.data.listener===person)))for(const fact of occurrenceFacts(ev))premises.push({source:ev.id,fact});
 K.commit(s,{kind:'history',actor:person,title:'Record structured knowledge support',parents:[source],data:{knowledgeSupport:{person,key,text,source,premises}}});
}

// World validation compiles the recorded physical state before the fatal action,
// production ordering and observation access into the same solver-neutral IR.
export function compileCrimeHistory(session,runtime){
 const constraints=[],variables={death:domain(1439,1200)};
 const add=(label,formula,sources=[])=>constraints.push({id:`history_${constraints.length}`,label,formula,sources});
 const fatal=session.events.filter(e=>e.data.occurrence==='fatal_action');
 add('Exactly one fatal action',eq(fatal.length,1));
 for(const event of fatal){
  const before=runtime.worldAt(session,event.index-1),d=event.data;
  add('Recorded fatal time',eq(v('death'),event.minute),[event.id]);
  add('Actor and living victim share the scene',before.npcs[event.actor]?.location===before.flags.victimLocation&&!before.npcs[event.actor]?.travel&&before.flags.victimAlive===true,[event.id]);
  add('Actor possesses the weapon',before.objects.weapon===event.actor,[event.id]);
  add('Fatal action time agrees with its payload',eq(v('death'),d.deathMinute),[event.id]);
 }
 for(const event of session.events){
  const d=event.data;
  if(d.occurrence==='entrance_watch'){
   const checkpoints=session.events.filter(e=>e.minute>=d.start&&e.minute<=d.end);
   const watchPossible=checkpoints.every(e=>{const w=runtime.worldAt(session,e.index);return w.npcs[event.actor]?.location==='manor'&&!w.npcs[event.actor]?.travel&&w.npcs[d.subject]?.location==='manor'&&!w.npcs[d.subject]?.travel&&runtime.SUSPECTS.filter(id=>id!==d.subject).every(id=>w.npcs[id]?.location!=='manor');});
   add('Continuous entrance watch has a present observer and visitor',checkpoints.length>0&&watchPossible&&d.allEntrances===true&&Number.isInteger(d.start)&&Number.isInteger(d.end)&&d.start<=d.end&&d.end<=event.minute,[event.id]);
  }
  if(d.occurrence==='clock_watch'){
   const sync=session.events.find(e=>event.parents.includes(e.id)&&e.data.occurrence==='watch_sync');
   const watched=session.events.find(e=>event.parents.includes(e.id)&&e.data.occurrence==='entrance_watch');
   add('Clocked watch refers to an observed interval and its calibration',Boolean(sync&&watched)&&sync.index<event.index&&watched.index<event.index&&sync.actor===event.actor&&watched.actor===event.actor&&watched.data.subject===d.subject&&sync.data.offset===d.offset&&watched.data.start+d.offset===d.start&&watched.data.end+d.offset===d.end,[event.id]);
  }
  if(d.occurrence==='watch_sync'){
   const before=runtime.worldAt(session,event.index-1);
   add('Watch synchronization requires presence at the inn clock',before.npcs[event.actor]?.location==='inn'&&!before.npcs[event.actor]?.travel,[event.id]);
  }
  if(d.occurrence==='document_observation'){
   const before=runtime.worldAt(session,event.index-1);
   add('Document observation requires access to the document',before.npcs[event.actor]?.location==='manor'&&!before.npcs[event.actor]?.travel&&before.objects.folio==='manor',[event.id]);
  }
  if(d.occurrence==='examination'){
   const before=runtime.worldAt(session,event.index-1);
   const visit=session.events.find(p=>event.parents.includes(p.id)&&p.data.occurrence==='appointment_observation');
   add('Examination account inherits only a personally witnessed visit',Boolean(visit)&&visit.actor===event.actor&&JSON.stringify(visit.data.people)===JSON.stringify(d.people),[event.id]);
   add('Examination describes the recorded fatal injury',fatal.length===1&&d.method===fatal[0].data.method&&d.deathMinute===fatal[0].data.deathMinute,[event.id]);
   add('Examination follows death at the body',and(x('ge',event.minute,v('death')),before.npcs[event.actor]?.location===before.flags.victimLocation&&!before.npcs[event.actor]?.travel&&before.flags.victimAlive===false),[event.id]);
  }
  if(d.occurrence==='report'){
   const before=runtime.worldAt(session,event.index-1);
   add('Testimony is delivered to a co-located listener',before.npcs[event.actor]?.location===before.npcs[d.listener]?.location&&!before.npcs[event.actor]?.travel&&!before.npcs[d.listener]?.travel,[event.id]);
  }
  if(d.occurrence==='appointment_observation'){
   const checkpoints=session.events.filter(e=>e.minute>=d.start&&e.minute<=d.end);
   const present=checkpoints.every(e=>{const w=runtime.worldAt(session,e.index);return [...d.people,event.actor].every(p=>w.npcs[p]?.location==='greenhouse'&&!w.npcs[p]?.travel);});
   add('Continuous appointment observation is physically possible',checkpoints.length>0&&present&&Number.isInteger(d.start)&&Number.isInteger(d.end)&&d.start<=d.end&&event.minute>=d.end,[event.id]);
  }
 }
 for(const [clue,id]of Object.entries(session.world.flags.evidenceOrigins??{})){
  const e=session.events.find(e=>e.id===id);
  add(`Evidence ${clue} has a recorded producer`,Boolean(e),[id]);
  if(e)for(const parent of e.parents){const p=session.events.find(x=>x.id===parent);add('Evidence production follows its causes',Boolean(p)&&p.index<e.index&&p.minute<=e.minute,[id,parent]);}
 }
 return {version:1,kind:'crime-history',perspective:'world',minute:0,horizon:0,variables,constraints,assumptions:[]};
}

export function validateEvidence(session,claims){
 const errors=[],origins=session.world.flags.evidenceOrigins??{};
 for(const [clue,items]of Object.entries(claims))for(const c of items){
  const e=session.events.find(e=>e.id===origins[clue]),d=e?.data??{};let ok=false;
  const interval=(start,end)=>c.interval?.start===start&&c.interval?.end===end;
  switch(c.predicate){
   case 'death_time':ok=d.occurrence==='examination'&&c.subject==='edmund'&&interval(d.deathMinute-4,d.deathMinute+4);break;
   case 'location':ok=d.occurrence==='appointment_observation'&&d.people.includes(c.subject)&&c.value==='greenhouse'&&interval(d.start,d.end)||d.person===c.subject&&c.value===e.location&&interval(d.signedAt,d.signedAt);break;
   case 'trace_match':{
    const other=session.events.find(e=>e.id===origins[c.requires]);
    ok=c.value===d.method&&(d.occurrence==='fatal_action'&&other?.id===e.id||d.occurrence==='laboratory'&&other?.data.occurrence==='cleanup'&&e.parents.includes(other.id)&&other.data.method===d.method);break;
   }
   case 'crime_motive':ok=d.occurrence==='estate_document'&&d.motive===c.value&&d.subject===c.subject;break;
   case 'clock_offset':ok=d.occurrence==='clock_check'&&d.offset===c.value;break;
   case 'exclusive_opportunity':ok=d.occurrence==='entrance_watch'&&d.allEntrances===true&&d.subject===c.subject&&interval(d.start,d.end);break;
   case 'clock_opportunity':ok=d.occurrence==='clock_watch'&&d.subject===c.subject&&interval(d.start,d.end)&&session.events.find(e=>e.id===origins[c.requires])?.data.offset===d.offset;break;
   default:ok=false;
  }
  if(!ok)errors.push(`${clue}: ${c.predicate} not entailed by its producer`);
 }
 return {ok:!errors.length,detail:errors.join('; ')||'Evidence claims follow typed production and comparison rules',errors};
}

const clock=m=>`${Math.floor(m/60)%24}:${String(m%60).padStart(2,'0')}`;
export function renderSupportedAccount(e,people){
 const d=e.data;
 if(d.occurrence==='fatal_action')return `I killed Edmund with the ${d.weaponName} at ${clock(d.deathMinute)}.`;
 if(d.occurrence==='appointment_observation')return `I was at the greenhouse with Dr Marsh from ${clock(d.start)} to ${clock(d.end)}.`;
 if(d.occurrence==='examination')return `I witnessed ${d.people.map(id=>people[id].name).join(' and ')} at the greenhouse and examined Edmund afterward.`;
 if(d.occurrence==='clock_check'&&d.offset===12)return 'I checked the inn clock; it runs twelve minutes fast.';
 if(d.occurrence==='report'&&d.assertion==='Edmund Vale was found dead in the study.')return 'Dr Marsh told me Edmund was found dead.';
 if(d.occurrence==='document_observation')return 'The carbon copy of the transfers is kept in Edmund’s study.';
 return null;
}

// Extensible support rules for live structured knowledge. No rule means no belief
// admission in configured cases. Testimony retains attribution and unknown truth.
export const knowledgeRules=[
 ({e,b,model})=>['night_account','knows_copy_location'].includes(b.key)&&renderSupportedAccount(e,model.PEOPLE)===b.text,
 ({e,b,model})=>e.kind==='speech'&&e.actor==='player'&&b.key===`player_has_${e.data.clue??e.data.presented}`&&[
  `The detective showed me ${model.CLUES[e.data.clue]?.title}.`,
  `The detective has shown me ${model.CLUES[e.data.presented]?.title.toLowerCase()}.`
 ].includes(b.text),
 ({e,b})=>e.kind==='speech'&&e.actor==='player'&&b.key===`player_report_${e.id}`&&b.text===`The detective claims: ${e.data.assertion}`&&b.sourceType==='testimony'&&b.truth===null,
 ({e,b,model})=>e.kind==='speech'&&b.key.startsWith(`report_${e.actor}_`)&&b.text===`${model.PEOPLE[e.actor]?.name} says: ${e.data.assertion}`&&b.sourceType==='testimony'&&b.truth===null,
 ({e,b,s,model})=>b.key==='receipt_challenged'&&b.text==='The receipt contradicts my earlier alibi.'&&(e.data.clue==='delivery'||e.data.assertion===model.CLUES.delivery.text)&&s.world.player.evidence.some(c=>c.clue==='delivery'),
 ({e,b,s})=>b.key==='senses_scrutiny'&&b.text==='The detective is pressing on the estate documents.'&&[e,...e.parents.map(id=>s.events.find(e=>e.id===id))].filter(Boolean).some(e=>e.data.clue==='ledger'||e.data.clue==='folio'||e.data.action?.topic==='accounts'),
 ({e,b})=>b.key==='sighting_corrected'&&(e.data.clue==='record'&&b.text==='I cannot stand by that sighting; the record shows where they actually were.'||e.data.clue==='clock'&&b.text==='The clock was fast. My sighting time needs correction; I still did not see a face.'),
 ({e,b,s,model})=>{
  if(!b.key.startsWith('holder_'))return false;
  const action=e.data.step?e:s.events.find(p=>e.parents.includes(p.id)&&p.data.step?.object===e.data.object);
  const step=action?.data.step,patch=action?.changes.find(p=>p.path===`objects.${step?.object}`);
  if(!patch)return false;
  return b.key===`holder_${step.object}`&&b.text===(e===action?`After ${step.kind}, ${step.object} is held by ${patch.after}.`:`I saw ${model.PEOPLE[action.actor].name} ${step.kind} ${step.object}; its holder became ${patch.after}.`);
 },
 ({e,b,model})=>{
  if(!b.key.startsWith('observed_location_')||!Array.isArray(e.data.objects))return false;
  const labels=e.data.objects.map(id=>model.OBJECTS[id]?.label??id);
  return b.key===`observed_location_${e.data.observedLocation}`&&b.text===`At ${model.LOCATIONS[e.data.observedLocation]?.name}, ${labels.length?`I saw ${labels.join(', ')}`:'I looked around'}.`;
 }
];
export function supportsBelief(s,person,b,model){
 const e=s.events.find(e=>e.id===b.sourceId);
 if(!e||e.actor!==person&&e.data.listener!==person&&!(e.kind==='command'&&e.data.action?.person===person&&s.world.npcs[person]?.location===s.world.player.location))return false;
 return knowledgeRules.some(rule=>rule({s,person,b,e,model}));
}

export function excludeExplanation(query,model,explanation){
 return {...structuredClone(query),constraints:[...query.constraints,{id:'different_explanation',label:'Seek a different suspect, method or motive',formula:not(and(eq(v('suspect'),model.suspects.indexOf(explanation.suspect)),eq(v('method'),model.methods.indexOf(explanation.method)),eq(v('motive'),model.motives.indexOf(explanation.motive)))),sources:[]}]};
}
