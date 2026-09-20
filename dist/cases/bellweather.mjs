import {crimeModel,assessAccusation,recordKnowledgeSupport,supportsBelief} from '../forensics.mjs';
import {configureStructure} from './investigative-structures.mjs';
import {BELLWEATHER_LIFE} from './bellweather-life.mjs';
import * as Original from '../case.mjs';
import {VERSION} from '../kernel.mjs';
import {executePrehistory} from '../prehistory.mjs';
import {METHOD_OPTIONS,MOTIVE_OPTIONS} from './bellweather-configs.mjs';
import {activeModules} from '../modules/index.mjs';
import {buildPersonas} from '../personas.mjs';
const clone=x=>structuredClone(x),time=m=>`${Math.floor(m/60)%24}:${String(m%60).padStart(2,'0')}`;
export function makeCase(spec){
 const PEOPLE=clone(Original.PEOPLE),LOCATIONS=clone(Original.LOCATIONS),OBJECTS=clone(Original.OBJECTS),CLUES=clone(Original.CLUES);
 const name=PEOPLE[spec.culprit].name,innocents=['clara','rowan','silas'].filter(id=>id!==spec.culprit),names=innocents.map(id=>PEOPLE[id].name).join(' and '),t=time(spec.minute),home=PEOPLE[spec.culprit].home;
 for(const [id,p]of Object.entries(PEOPLE)){
  p.secret=id===spec.culprit?`I killed Edmund at ${t} with the ${spec.weaponName} to ${spec.motiveText}.`:innocents.includes(id)?`I was at the greenhouse with Dr Marsh during the fatal encounter.`:id==='iris'?`I witnessed ${names} at the greenhouse and later examined Edmund.`:'I have no privileged knowledge of the culprit.';
  p.goals=id===spec.culprit?['Avoid admitting the killing','Maintain an ordinary routine']:['Keep my appointments','Give an accurate account of my own experience'];p.beliefSeeds=[];
 }
 PEOPLE.ada.public='The innkeeper. She keeps a careful eye on the clock and the morning trade.';
 PEOPLE.iris.public='The village doctor. She attended a greenhouse appointment and later examined Edmund.';
 for(const l of Object.values(LOCATIONS)){l.objects=l.objects.filter(x=>!['seal','drawer'].includes(x));l.description=`${l.name} is quiet this morning. The constable has authorized inspection of the relevant records and objects.`;}
 LOCATIONS[home].objects.push('seal');LOCATIONS.manor.description='Edmund Vale was found dead in the study. His desk, papers and the floor beneath it have been left undisturbed.';
 OBJECTS.seal={label:spec.weaponName,clue:'seal',description:'Examine the damaged object'};
 const set=(id,title,text,tags,extra={})=>{CLUES[id]={title,text,tags,kind:'Document',source:title,...extra};};
 set('medical','The medical examination',`Dr Marsh places death between ${time(spec.minute-4)} and ${time(spec.minute+4)}. The fatal injury is ${spec.injury}.`,['Time','Method'],{kind:'Observation'});
 set('appointment','The scheduled meeting',`Edmund's diary records a meeting with ${name} shortly before ${t}. A scheduled meeting alone does not prove attendance.`,['Time',name]);
 set('ledger','The disputed estate decision',`Edmund's signed papers establish why ${name} wanted to ${spec.motiveText}. The decision was to be put into effect after their meeting.`,['Motive',name],{subject:spec.culprit,motive:spec.motive});
 set('folio','The retained carbon copy',`The carbon copy preserves the decision described in Edmund's papers: ${name} faced ${spec.motiveText.replace(/^prevent |^conceal /,'')}.`,['Motive',name]);
 set('fragment','The trace beneath the desk',`A fresh trace under the desk matches the damaged edge of the ${spec.weaponName}. It is compatible with the injury recorded by Dr Marsh.`,['Weapon'],{kind:'Physical trace'});
 set('seal','The damaged meeting object',`The ${spec.weaponName} kept in ${LOCATIONS[home].name} has a fresh damaged edge and residue consistent with the trace and fatal injury. Its keeper is ${name}.`,['Weapon',name],{subject:spec.culprit,method:spec.weapon,kind:'Physical trace'});
 set('delivery','The timed delivery receipt',`A dated receipt places ${name} inside Vale Manor at ${time(spec.minute-5)}, shortly before the medical window. The visitor signed it personally.`,['Opportunity',name],{subject:spec.culprit});
 set('record','Dr Marsh’s witnessed visit',`Dr Marsh's signed record places ${names} at the greenhouse continuously from ${time(spec.minute-25)} to ${time(spec.minute+5)}. Both were away from the study during the fatal encounter.`,['Alibi',...names.split(' and ')]);
 set('letter','The appointment letter',`The letter requests a greenhouse appointment for ${names}. It establishes an intention; Dr Marsh's signed record establishes who attended.`,['Appointment']);
 set('pump','The greenhouse appointment log',`The greenhouse log corroborates the appointment described in Dr Marsh's record. Check that signed record for the participants and exact interval.`,['Time']);
 set('clock','The inn clock offset','The clockmaker’s service note records that the inn clock runs twelve minutes fast. No identified crime-night sighting is established by this note alone.',['Time'],{kind:'Observation'});
 for(const id of ['ada','clara','alibi','rowan'])set(id,'A recorded witness account','Ask the witness for their own account.',['Testimony'],{kind:'Testimony'});
 const claim=(key,subject,predicate,value,interval=null)=>({key,subject,predicate,value,interval,confidence:.99,attribution:'recorded evidence'});
 const evidenceClaims={medical:[claim('death','edmund','death_time','window',{start:spec.minute-4,end:spec.minute+4})],delivery:[claim('receipt',spec.culprit,'location','manor',{start:spec.minute-5,end:spec.minute-5})],record:innocents.map(id=>claim(`visit_${id}`,id,'location','greenhouse',{start:spec.minute-25,end:spec.minute+5}))};
 const CASE={id:spec.id,title:spec.title,date:'18 November 1932',victim:'Edmund Vale',culprit:spec.culprit,method:spec.weapon,motive:spec.motive,synopsis:'Edmund Vale is dead. Compare the physical traces, the estate decision, and the independent accounts of last night.',truth:`${name} killed Edmund at ${t} with the ${spec.weaponName} to ${spec.motiveText}.`,history:[],proofRoutes:[{id:'physical',title:'Physical traces and independent records',all:['medical','fragment','seal','delivery','ledger','record']},{id:'documents',title:'The carbon copy and the records',all:['medical','fragment','seal','delivery','folio','record']}],methodOptions:METHOD_OPTIONS,motiveOptions:MOTIVE_OPTIONS,resolutionText:`Bell checks the physical traces against the records. “The evidence supports your case against ${name}: the ${spec.weaponName}, the estate decision, and the opportunity. We can proceed.”`};
 evidenceClaims.fragment=[];
 evidenceClaims.seal=[{predicate:'trace_match',value:spec.weapon,requires:'fragment'}];
 // Motive is a 2-hop chain: an estate document only *narrows* the motive (rules one out), and Edmund's
 // confrontation memo pins the exact motive — but only alongside a document. Neither settles it alone.
 const ruledOut=['fraud','inheritance','eviction'].find(m=>m!==spec.motive);
 evidenceClaims.ledger=[{predicate:'motive_class',value:ruledOut}];
 evidenceClaims.folio=[{predicate:'motive_class',value:ruledOut}];
 evidenceClaims.intent=[{predicate:'crime_motive',subject:spec.culprit,value:spec.motive,requiresAny:['ledger','folio']}];
 set('intent','Edmund’s confrontation memo',`In his own hand, Edmund noted he meant to confront ${name} that evening — but the note names only the grievance, not its nature. Read it against the estate documents to see what he was truly acting on.`,['Motive'],{kind:'Document'});
 OBJECTS.intent={label:'The confrontation memo',clue:'intent',description:'Read Edmund’s note on the confrontation'};
 if(!LOCATIONS.manor.objects.includes('intent'))LOCATIONS.manor.objects.push('intent');
 evidenceClaims.clock=[{predicate:'clock_offset',value:12}];
 configureStructure({spec,CASE,CLUES,OBJECTS,LOCATIONS,evidenceClaims});
 const modules=activeModules(spec);
 // Modules may contribute forensic claims (e.g. the manner-of-death coroner finding), so compose
 // their content BEFORE normalization, and normalize the merged set uniformly afterward.
 for(const {module,binding,roles} of modules)module.content?.({binding,roles,spec,CLUES,OBJECTS,LOCATIONS,PEOPLE,set,time,CASE,evidenceClaims,peers:modules});
 // Motive's bridging memo is load-bearing on every route, whatever the structure or composed bricks
 // (added after configureStructure/modules, which can replace or extend the route set).
 for(const route of CASE.proofRoutes)if(!route.all.includes('intent'))route.all.push('intent');
 for(const [id,claims]of Object.entries(evidenceClaims))evidenceClaims[id]=claims.map((c,i)=>({key:`${id}_${i}`,subject:'edmund',interval:null,confidence:.99,attribution:'recorded evidence',...c}));
 const agentPermissions={},commitments={bell:{location:'square',from:1920}};
 for(const {module,binding,roles} of modules){const cap=module.capabilities?.({binding,roles,spec,peers:modules});if(cap?.agentPermissions)for(const [k,v]of Object.entries(cap.agentPermissions))agentPermissions[k]=[...(agentPermissions[k]??[]),...v];if(cap?.commitments)Object.assign(commitments,cap.commitments);}
 function baseWorld(seed=17){const npcs={};for(const [id,p]of Object.entries(PEOPLE))npcs[id]={location:p.home,travel:null,stress:.2,trust:p.relationships.player.trust,intention:'Attend to the evening',plan:'routine',beliefs:[],memories:[],lastDecision:null};return {version:VERSION,seed,caseId:spec.id,minute:1200,status:'playing',player:{location:'transit',evidence:[],pins:[],visited:['square'],lastSeen:{},notes:[]},npcs,objects:{weapon:home,folio:'manor'},flags:{victimAlive:true,victimLocation:'manor',evidenceOrigins:{},lockedObjects:[]},ending:null};}
 const model={validateBelief:(s,id,b)=>supportsBelief(s,id,b,model),CASE,PEOPLE,LOCATIONS,OBJECTS,CLUES,baseWorld,evidenceClaims,containers:{drawer:'vestry'},testimonyClues:['ada','clara','alibi','rowan'],version:VERSION,commitments,agentPermissions,forensics:crimeModel(spec,LOCATIONS),boundedInvestigation:true,modules,life:BELLWEATHER_LIFE,personas:buildPersonas(spec,{PEOPLE})};
 function createBehavior(K){
  const known=(s,id,key)=>s.world.npcs[id].beliefs.find(b=>b.key===key);
  const source=(s,id)=>known(s,id,'night_account')?.sourceId;
  const line=(s,id,text,cause,topic='night',deception=false)=>{
   // Type the spoken account as claims: a lying suspect asserts its public stance (the false alibi),
   // a truthful or revised one asserts its private truth. This puts testimony in the shared claim
   // space, so a contradiction with the physical record surfaces (and a revision supersedes the lie).
   const persona=model.personas?.[id];
   const claims=persona&&['night','alibi'].includes(topic)?(deception?persona.publicStance:persona.privateTruth):[];
   return K.speech(s,id,text,cause,{topic,intent:deception?'Protect my secret':'Answer from my own experience',basis:'night_account',deception:deception?'False alibi':false,sourceEvents:[source(s,id)].filter(Boolean),claims});
  };
  function decide(s,id,cause){if(s.world.minute<1920||s.world.npcs[id].travel||s.world.player.conversation===id)return;for(const {module,binding,roles} of modules)if(module.decide?.({K,s,id,cause,binding,roles,peers:modules}))return;if(K.life.decide(s,id))return;K.startTravel(s,id,PEOPLE[id].home,cause,'Return to my morning duties');}
  function seedSession(s){
   const pre=executePrehistory(K,s,spec);
   for(const [id,p]of Object.entries(PEOPLE)){
    const text=id===spec.culprit?`I killed Edmund with the ${spec.weaponName} at ${t}.`:innocents.includes(id)?`I was at the greenhouse with Dr Marsh from ${time(spec.minute-25)} to ${time(spec.minute+5)}.`:id==='iris'?`I witnessed ${names} at the greenhouse and examined Edmund afterward.`:id==='ada'?'I checked the inn clock; it runs twelve minutes fast.':'Dr Marsh told me Edmund was found dead.';
    recordKnowledgeSupport(K,s,id,'night_account',text,pre.sources[id]);
    K.believe(s,id,'night_account',text,.99,id==='bell'?'testimony':'observation',pre.sources[id],true);
    K.remember(s,id,pre.sources[id]);
   }
   K.commit(s,{kind:'arrival',actor:'player',title:'You begin the investigation',data:{boundary:true},changes:{'player.location':'square'},playerText:CASE.synopsis});
  }
  // Bind source questions to a recorded account, never to undisclosed case facts.
  function sourceFollowup(s,id){
   const reply=s.events.findLast(e=>e.kind==='speech'&&e.actor===id&&e.data.listener==='player'&&e.data.topic!=='source');
   if(!reply||!['night','alibi','case','challenge_delivery'].includes(reply.data.topic))return null;
   if(id==='bell')return null; // Investigative guidance is not a witness account.
   if(id==='iris')return {reply,label:'Did you personally witness the greenhouse appointment?',text:'Yes. I was present throughout the appointment. My signed visit record records the participants and interval; the examination of Edmund was a separate, later observation.'};
   if(id==='ada')return {reply,label:'How did you establish the inn clock’s offset?',text:'I checked the clock against the clockmaker’s service note. That establishes its offset, not the identity or movements of anyone that night.'};
   if(reply.data.deception)return {reply,label:'Can anyone corroborate your whereabouts?',text:'No witness can corroborate my account of the whole evening. You will have to compare it with the independent records.'};
   if(reply.data.topic==='challenge_delivery'||(reply.data.authoredAssertion??reply.data.assertion).includes('receipt establishes'))return {reply,label:'What confirms your meeting at the manor?',text:'The timed receipt records my attendance. It does not account for everything that happened at the meeting.'};
   if(innocents.includes(id))return {reply,label:'Who can corroborate your greenhouse appointment?',text:'Dr Marsh was there with me. Her signed visit record can corroborate my presence and the interval; I did not witness what happened in the study.'};
   return null;
  }
  const canAsk=(s,id,topic)=>Boolean(PEOPLE[id]&&K.local(s,id)&&!s.world.npcs[id].travel&&['case','night','alibi','accounts','sightings','observations','source','challenge_delivery'].includes(topic)&&(topic!=='source'||sourceFollowup(s,id)));
  function ask(s,id,topic,cause){
   if(!canAsk(s,id,topic)){K.reject(s,'Conversation unavailable','Find this person and choose an available question.',cause);return;}
   let text,deception=false;
   if(topic==='challenge_delivery'&&id===spec.culprit&&K.has(s,'delivery')){
    const received=K.commit(s,{kind:'speech',actor:'player',title:'You challenge the recorded attendance',parents:[cause],data:{listener:id,assertion:CLUES.delivery.text},playerText:`You challenge the alibi with the timed receipt.`});
    K.believe(s,id,'receipt_challenged','The receipt contradicts my earlier alibi.',.99,'observation',received,true);
   }

   if(topic==='source'){const followup=sourceFollowup(s,id);K.speech(s,id,followup.text,cause,{topic:'source',intent:'Explain the preceding account',sourceEvents:[followup.reply.id],claims:[]});K.advance(s,3,cause);return;}
   else if(id==='bell')text='Compare the examination, the trace, the damaged object, the timed receipt, the estate papers and Dr Marsh’s independent visit record. A motive alone does not establish guilt.';
   else if(id==='iris')text=`I place the death between ${time(spec.minute-4)} and ${time(spec.minute+4)}; the fatal injury is ${spec.injury}. My signed record places ${names} at the greenhouse continuously from ${time(spec.minute-25)} to ${time(spec.minute+5)}, so both were away from the study during the fatal encounter.`;
   else if(id==='ada')text=known(s,id,'night_account').text;
   else if(id===spec.culprit){deception=!known(s,id,'receipt_challenged')&&!known(s,id,'alibi_broken');text=deception?`I remained at ${LOCATIONS[home].name} all evening. I have no witness to offer.`:`The receipt establishes I attended the manor meeting. ${CLUES.ledger.text} Attendance does not by itself prove a killing.`;}
   else text=known(s,id,'night_account').text;
   if(topic==='accounts')text=id===spec.culprit?'Edmund’s decision affected me. I intended to discuss it with him. That does not establish who killed him.':'I cannot offer an independent account of the estate dispute. Inspect Edmund’s papers.';
   if(topic==='sightings'||topic==='observations')text='My retained observations can establish only the movements I actually saw; they do not reveal anyone’s private purpose.';
   if(topic==='accounts')deception=false;
   for(const {module,binding,roles} of modules){const t=module.dialogue?.({binding,roles,spec,PEOPLE,id,topic,K,s,peers:modules});if(t!=null)text=t;}
   line(s,id,text,cause,topic,deception);K.advance(s,3,cause);
   for(const {module,binding,roles} of modules)module.onInteract?.({K,s,id,topic,binding,roles,event:cause,peers:modules});
  }
  function present(s,id,clue,tone,cause){
   if(!K.local(s,id)||!K.has(s,clue)){K.reject(s,'Presentation unavailable','Discover the clue and find the person first.',cause);return;}
   const heard=K.commit(s,{kind:'speech',actor:'player',title:`You show ${PEOPLE[id].name} ${CLUES[clue].title}`,parents:[cause],data:{listener:id,clue,assertion:CLUES[clue].text},playerText:K.presentLineHidden(s)?null:`You show ${PEOPLE[id].name} ${CLUES[clue].title.toLowerCase()}.`});
   K.believe(s,id,`player_has_${clue}`,`The detective showed me ${CLUES[clue].title}.`,.99,'observation',heard,true);
   // Break-a-lie (generic): a presented physical fact placing a suspect where they truly were, against
   // the whereabouts they claimed, forces them to concede. The conceding reply records the corrected
   // (true) alibi claim, which supersedes the lie and clears the contradiction.
   const persona=model.personas?.[id];
   const stance=persona?.publicStance.find(c=>c.predicate==='location'&&c.subject===id);
   const truth=persona?.privateTruth.find(c=>c.predicate==='location'&&c.subject===id);
   const shownAt=(evidenceClaims[clue]||[]).find(c=>c.predicate==='location'&&c.subject===id);
   const breaksAlibi=Boolean(stance&&truth&&shownAt&&stance.value!==truth.value&&shownAt.value===truth.value&&!known(s,id,'alibi_broken'));
   let text,revised=false;
   if(breaksAlibi){revised=true;K.believe(s,id,'alibi_broken',`The ${CLUES[clue].title} places me at ${LOCATIONS[shownAt.value].name}; my earlier account was false.`,.99,'observation',heard,true);if(clue==='delivery')K.believe(s,id,'receipt_challenged','The receipt contradicts my earlier alibi.',.99,'inference',heard,true);text='I did attend. My earlier claim was false — but attendance is not a killing. You must still establish what happened.';}
   else if(id==='iris'&&clue==='medical')text=`I place the death between ${time(spec.minute-4)} and ${time(spec.minute+4)}; the fatal injury is ${spec.injury}.`;
   else if(id==='iris'&&clue==='record')text=`My signed record places ${names} at the greenhouse from ${time(spec.minute-25)} to ${time(spec.minute+5)}. Both were away from the study during the fatal encounter.`;
   else if(innocents.includes(id)&&clue==='record')text=`That matches my recollection. ${known(s,id,'night_account').text}`;
   else if(id===spec.culprit&&['ledger','folio'].includes(clue))text=`Edmund and I did not see eye to eye about the estate. A disagreement is not a killing, and I won’t be led into saying otherwise.`;
   else text=`I’ve seen ${CLUES[clue].title.toLowerCase()}. I can speak only to what I witnessed myself; I won’t claim more than that.`;
   for(const {module,binding,roles} of modules){const t=module.dialogue?.({binding,roles,spec,PEOPLE,id,topic:'present',clue,K,s});if(t!=null)text=t;}
   // A conceding revision speaks as an alibi (so the corrected claim is recorded); otherwise as a present reply.
   line(s,id,text,heard,revised?'alibi':'present');K.advance(s,4,cause);
   for(const {module,binding,roles} of modules)module.onInteract?.({K,s,id,topic:'present',clue,binding,roles,event:heard,peers:modules});
  }
  function checkCase(s,a){return assessAccusation(s,a,model.forensics,evidenceClaims,CLUES,CASE.proofRoutes,PEOPLE);}
  const followupOptions=(s,id)=>{const followup=sourceFollowup(s,id);return [...(followup?[['source',followup.label]]:[]),...(id===spec.culprit&&K.has(s,'delivery')?[['challenge_delivery','Explain the receipt and your alibi.']]:[])];};
  function parseCommand(text){const words=text.toLowerCase().trim().split(/\s+/);if(['go','move','walk'].includes(words[0]))return {type:'move',to:words[1]};if(['inspect','search'].includes(words[0]))return {type:'inspect',object:words[1]};if(words[0]==='wait')return {type:'wait',minutes:Number(words[1])};if(words[0]==='ask')return {type:'ask',person:words[1],topic:words.at(-1)};return {type:'look'};}
  function caseHealth(s){return CASE.proofRoutes.map(r=>({...r,found:r.all.filter(c=>K.has(s,c)),available:r.all.every(c=>Object.entries(OBJECTS).some(([o,v])=>v.clue===c&&!s.world.flags.lockedObjects.includes(o)))}));}
  return {seedSession,decide,canAsk,ask,present,checkCase,followupOptions,parseCommand,reconcileKnowledge(){},commandLabel:a=>`${a.type} ${a.person??a.object??a.to??''}`,caseHealth};
 }
 return {CASE,LOCATIONS,PEOPLE,CLUES,OBJECTS,model,baseWorld,createBehavior,SUSPECTS:['clara','rowan','silas'],PILLARS:[['motive','Motive'],['means','Means'],['opportunity','Opportunity'],['alibi','Alibi']]};
}
