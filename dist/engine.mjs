import {CASE,LOCATIONS,PEOPLE,CLUES,OBJECTS} from './case.mjs';
export {CASE,LOCATIONS,PEOPLE,CLUES,OBJECTS};
export const VERSION=1;
export const copy=x=>structuredClone(x);
export const timeLabel=m=>`${String(Math.floor(m/1440)+1).padStart(1,'0') !== '1' ? `Day ${Math.floor(m/1440)+1} · ` : ''}${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const has=(s,c)=>s.world.player.evidence.some(e=>e.clue===c);
const nextId=s=>`e${String(s.events.length+1).padStart(5,'0')}`;
const get=(o,path)=>path.split('.').reduce((v,k)=>v?.[k],o);
const unsafe=new Set(['__proto__','prototype','constructor']);
function set(o,path,value){const keys=path.split('.');if(keys.some(k=>unsafe.has(k)))throw Error('Invalid state path');let t=o;for(const k of keys.slice(0,-1)){if(t[k]===undefined)t[k]={};t=t[k];}if(value===undefined)delete t[keys.at(-1)];else t[keys.at(-1)]=copy(value);}

export function baseWorld(seed=17){
  const npcs={};for(const [id,p] of Object.entries(PEOPLE))npcs[id]={location:p.home,travel:null,stress:id==='silas'?.57:id==='clara'?.61:.2,trust:p.relationships.player?.trust??.5,intention:'Keep the morning appointment',plan:'routine',beliefs:[],memories:[],warned:false,disclosed:false,concealed:false,lastDecision:null};
  return {version:VERSION,seed,minute:480,status:'playing',player:{location:'square',evidence:[],pins:[],visited:['square'],lastSeen:{},notes:[]},npcs,objects:{folio:'manor'},flags:{claraThreatened:false,claraReassured:false,rumorShared:false,clockCorrected:false},ending:null};
}

// All world mutations pass through this function. Events contain reversible patches.
export function commit(s,{kind='world',title,actor='world',location=null,data={},changes={},parents=[],playerText=null,visibility='internal',minute}){
  const id=nextId(s),patches=[];
  for(const [path,after] of Object.entries(changes)){const before=get(s.world,path);if(!same(before,after))patches.push({path,...(before===undefined?{}:{before:copy(before)}),...(after===undefined?{}:{after:copy(after)})});}
  for(const p of patches)set(s.world,p.path,p.after);
  const event={id,index:s.events.length,minute:minute??s.world.minute,kind,title,actor,location:location??(s.world.npcs[actor]?.location||s.world.player.location),data:copy(data),changes:patches,parents:[...new Set(parents.filter(Boolean))],playerText,visibility:playerText?'observed':visibility};
  s.events.push(event);return id;
}
function remember(s,id,eventId){const a=s.world.npcs[id];if(!a)return;commit(s,{kind:'memory',title:`${PEOPLE[id].name} remembers an event`,actor:id,parents:[eventId],changes:{[`npcs.${id}.memories`]:[...a.memories,eventId].slice(-80)}});}
function believe(s,id,key,text,confidence,sourceType,sourceId,truth=null){
  const a=s.world.npcs[id],belief={key,text,confidence,sourceType,sourceId,truth,acquired:s.world.minute};const list=a.beliefs.filter(b=>b.key!==key);list.push(belief);
  const event=commit(s,{kind:'belief',title:`${PEOPLE[id].name} updates a belief`,actor:id,parents:[sourceId],data:{belief},changes:{[`npcs.${id}.beliefs`]:list}});remember(s,id,event);return event;
}
function local(s,id){return s.world.npcs[id]?.location===s.world.player.location;}
function notice(s,id,cause,text){if(local(s,id)){commit(s,{kind:'observation',title:`You notice ${PEOPLE[id].name}`,actor:'player',parents:[cause],playerText:text,changes:{[`player.lastSeen.${id}`]:{location:s.world.player.location,minute:s.world.minute}}});}}

// Witnesses learn only the movement visible at their location, not a route or motive.
function witnessMovement(s,subject,phase,location,cause){
  if(!LOCATIONS[location])return;
  const name=subject==='player'?'The detective':PEOPLE[subject].name;
  for(const [id,npc] of Object.entries(s.world.npcs)){
    if(id===subject||npc.location!==location||npc.travel)continue;
    const observation=commit(s,{kind:'observation',title:`${PEOPLE[id].name} sees ${name} ${phase==='departure'?'leave':'arrive'}`,actor:id,location,parents:[cause],data:{subject,phase,observedLocation:location,sourceType:'observation'}});
    remember(s,id,observation);
  }
}

export function createSession(seed=17){
  if(!Number.isInteger(seed)||seed<0||seed>999999)throw Error('Seed must be an integer from 0 to 999999.');
  const s={version:VERSION,seed,events:[],world:baseWorld(seed)};
  const origin=commit(s,{kind:'history',title:'The case is established',data:{history:CASE.history,truth:CASE.truth},location:'manor'});
  for(const [id,p]of Object.entries(PEOPLE))for(const b of p.beliefSeeds)believe(s,id,...b.slice(0,4),origin,b[4]);
  const arrival=commit(s,{kind:'arrival',title:'You arrive in Bellweather',actor:'player',location:'square',playerText:`${CASE.synopsis}\n\n“Start with the study,” Bell says. “Then listen carefully. A lie and a murder aren’t the same thing.”`,changes:{'player.lastSeen.bell':{location:'square',minute:480}},data:{boundary:true}});
  witnessMovement(s,'player','arrival','square',arrival);
  return s;
}

export function distance(from,to){
  if(from===to)return 0;if(!LOCATIONS[from]||!LOCATIONS[to])return Infinity;
  const costs={[from]:0},todo=new Set(Object.keys(LOCATIONS));while(todo.size){const at=[...todo].sort((a,b)=>(costs[a]??Infinity)-(costs[b]??Infinity))[0];todo.delete(at);if(at===to)return costs[at]??Infinity;for(const [n,c]of Object.entries(LOCATIONS[at].links))if((costs[at]??Infinity)+c<(costs[n]??Infinity))costs[n]=costs[at]+c;}return Infinity;
}
function routineDestination(s,id){const t=(s.world.minute-480)%180,shift=s.seed%7-3;
  if(id==='clara')return t<35+shift?'manor':t<80+shift?'inn':'manor';
  if(id==='rowan')return t>=45+shift&&t<68+shift?'square':'greenhouse';
  if(id==='silas')return t>=35+shift&&t<68+shift?'manor':'vestry';
  if(id==='ada')return t>=45+shift&&t<60+shift?'square':'inn';
  if(id==='iris')return t>=60+shift&&t<90+shift?'manor':'surgery';
  return 'square';
}
function startTravel(s,id,to,cause,purpose){const a=s.world.npcs[id],from=a.location;if(a.travel||from===to)return;
  const arrival=s.world.minute+distance(from,to);if(!Number.isFinite(arrival))return;
  const e=commit(s,{kind:'movement',title:`${PEOPLE[id].name} sets out for ${LOCATIONS[to].short}`,actor:id,location:from,parents:[cause],data:{from,to,arrival,purpose},changes:{[`npcs.${id}.location`]:'transit',[`npcs.${id}.travel`]:{from,to,arrival,cause,purpose}},playerText:from===s.world.player.location?`${PEOPLE[id].name} leaves for ${LOCATIONS[to].short}.`:null});
  witnessMovement(s,id,'departure',from,e);
  if(from===s.world.player.location)commit(s,{kind:'observation',title:`You see ${PEOPLE[id].name} leave`,actor:'player',parents:[e],changes:{[`player.lastSeen.${id}`]:{location:from,minute:s.world.minute,departed:true}}});
}
function decide(s,id,cause){
  const a=s.world.npcs[id];if(a.travel)return;
  const candidates=[{id:'routine',label:'Keep the morning routine',score:40,reasons:['A standing commitment remains active.']}];
  const knowsAccounts=a.beliefs.find(b=>b.key==='detective_knows_accounts');
  if(id==='silas'&&knowsAccounts&&!a.concealed)candidates.push({id:'conceal',label:'Conceal the forged folio',score:88,reasons:['The detective showed me the diverted payments.','The folio could expose the forgery.'],source:knowsAccounts.sourceId});
  const threatened=a.beliefs.find(b=>b.key==='secret_threatened');
  if(id==='clara'&&threatened&&!a.warned)candidates.push({id:'warn',label:'Warn Rowan about the detective',score:82,reasons:['The detective threatened to expose our relationship.','Protecting Rowan outweighs my routine.'],source:threatened.sourceId});
  const winner=candidates.reduce((a,b)=>b.score>a.score?b:a),plan=winner.id;
  const decision=commit(s,{kind:'decision',title:`${PEOPLE[id].name}: ${winner.label.toLowerCase()}`,actor:id,parents:[cause,winner.source],data:{candidates,selected:plan,reason:winner.reasons.join(' '),knowledgeUsed:a.beliefs.filter(b=>b.sourceId===winner.source).map(b=>b.key)},changes:{[`npcs.${id}.intention`]:winner.label,[`npcs.${id}.plan`]:plan,[`npcs.${id}.lastDecision`]:nextId(s)}});
  if(plan==='warn'){
    if(a.location!=='greenhouse')startTravel(s,id,'greenhouse',decision,'Find Rowan');
    else if(s.world.npcs.rowan.location==='greenhouse'){
      const text='Clara draws Rowan aside. “The detective found my letter. Be careful what you tell them.”';
      const e=commit(s,{kind:'speech',title:'Clara warns Rowan',actor:id,location:'greenhouse',parents:[decision],data:{listener:'rowan',assertion:'The detective found my private letter.',intent:'Protect Rowan',basis:'secret_threatened'},changes:{'npcs.clara.warned':true},playerText:local(s,id)?text:null});
      believe(s,'rowan','detective_threatened_clara','Clara says the detective threatened to expose us.',.91,'testimony',e,true);
      commit(s,{kind:'relationship',title:'Rowan becomes guarded toward you',actor:'rowan',parents:[e],changes:{'npcs.rowan.trust':.12,'npcs.rowan.stress':.66}});remember(s,'clara',e);
    }
  }else if(plan==='conceal'){
    if(s.world.objects.folio==='manor'){
      if(a.location!=='manor')startTravel(s,id,'manor',decision,'Retrieve the forged folio');
      else {const e=commit(s,{kind:'action',title:'Silas takes the red folio',actor:id,parents:[decision],changes:{'objects.folio':'silas'},data:{object:'folio',reason:'Conceal incriminating records'},playerText:local(s,id)?'Silas slips the red folio inside his coat. He notices you watching, but says nothing.':null});believe(s,id,'folio_at_manor','The folio is no longer in the study; I am carrying it.',.99,'observation',e,true);startTravel(s,id,'vestry',e,'Hide the folio in the deed drawer');}
    }else if(s.world.objects.folio==='silas'){
      if(a.location!=='vestry')startTravel(s,id,'vestry',decision,'Hide the forged folio');
      else {const e=commit(s,{kind:'action',title:'Silas hides the folio in the deed drawer',actor:id,parents:[decision],changes:{'objects.folio':'drawer','npcs.silas.concealed':true},data:{object:'folio',reachableAt:'vestry',reason:'Put the document among routine deeds'},playerText:local(s,id)?'Silas pushes the red folio beneath a stack of deeds. The drawer closes with a soft scrape.':null});believe(s,id,'folio_at_manor','I hid the forged folio in the deed drawer at the vestry.',.99,'observation',e,true);}
    }else commit(s,{kind:'decision',title:'Silas cannot find the folio where he expected',actor:id,parents:[decision],data:{reason:'The attempted plan encountered a changed object location.'},changes:{'npcs.silas.concealed':true}});
  }else startTravel(s,id,routineDestination(s,id),decision,'A standing morning obligation');
  if(id==='ada'&&a.location==='square'&&s.world.npcs.bell.location==='square'&&!s.world.flags.rumorShared){
    const b=a.beliefs.find(x=>x.key==='saw_rowan');
    if(!b)return;
    const e=commit(s,{kind:'speech',title:'Ada passes her account to Bell',actor:'ada',location:'square',parents:[decision,b.sourceId],data:{listener:'bell',assertion:b.text,intent:'Help the investigation',basis:b.key},changes:{'flags.rumorShared':true},playerText:s.world.player.location==='square'?`You overhear Ada telling Bell: “${b.text}”`:null});
    believe(s,'bell','adas_account',`Ada reports: ${b.text}`,.72,'testimony',e,b.truth);remember(s,'ada',e);
  }
}

function advance(s,minutes,cause){
  for(let n=0;n<minutes;n++){
    const e=commit(s,{kind:'clock',title:'A minute passes',parents:[cause],changes:{minute:s.world.minute+1}});
    for(const [id,a]of Object.entries(s.world.npcs)){
      if(a.travel&&a.travel.arrival<=s.world.minute){const tr=copy(a.travel);const arrival=commit(s,{kind:'movement',title:`${PEOPLE[id].name} arrives at ${LOCATIONS[tr.to].short}`,actor:id,location:tr.to,parents:[tr.cause,e],changes:{[`npcs.${id}.location`]:tr.to,[`npcs.${id}.travel`]:null},data:{from:tr.from,to:tr.to},playerText:s.world.player.location===tr.to?`${PEOPLE[id].name} arrives from ${LOCATIONS[tr.from].short}.`:null});witnessMovement(s,id,'arrival',tr.to,arrival);notice(s,id,arrival,`${PEOPLE[id].name} is here now.`);decide(s,id,arrival);}
      else if(!a.travel&&s.world.minute%10===0)decide(s,id,e);
    }
  }
}

function addEvidence(s,clue,cause,source){
  if(has(s,clue))return false;
  const d=CLUES[clue],event=nextId(s);
  commit(s,{kind:'evidence',title:`Recorded: ${d.title}`,actor:'player',parents:[cause],data:{clue,source:source??d.source},changes:{'player.evidence':[...s.world.player.evidence,{clue,eventId:event,minute:s.world.minute,source:source??d.source}]},playerText:`${d.title}\n${d.text}`});return true;
}
function reject(s,title,text,cause,data={}){return commit(s,{kind:'rejected',title,actor:'player',parents:[cause],data:{reason:text,...data},playerText:text});}
function speech(s,id,text,cause,data={}){const e=commit(s,{kind:'speech',title:`${PEOPLE[id].name} speaks to you`,actor:id,parents:[cause],data:{listener:'player',assertion:text,...data},playerText:`${PEOPLE[id].name}\n“${text}”`});remember(s,id,e);return e;}
function ask(s,id,topic,cause){
  if(!PEOPLE[id])return reject(s,'Unknown person','Choose someone from the people here.',cause);
  if(!local(s,id))return reject(s,'Conversation cannot reach its recipient',`${PEOPLE[id].name} is not here. Find them before asking.`,cause);
  const a=s.world.npcs[id];let e;
  if(id==='bell'){
    const rumor=a.beliefs.find(b=>b.key==='adas_account');
    e=speech(s,id,topic==='case'?'Bring me a suspect, a method, a motive, and the evidence that connects them. Check the study, the accounts, and the witnesses’ times.':rumor?`${rumor.text} I have not verified it. Her source matters as much as her confidence.`:'A witness may be mistaken or hiding something unrelated. The surgery record could help you test an alibi.',cause,{intent:'Guide a fair investigation'});
  }else if(id==='ada'){
    e=speech(s,id,s.world.flags.clockCorrected?'I was wrong about the time—and I never saw the face. I saw a green coat at what must have been 21:03. I should have said that from the start.':'I saw Rowan’s green coat heading toward the manor. The clock said quarter past nine. His face? No, it was turned away. But everyone knows that coat.',cause,{intent:'Report an observation and an inference',basis:'saw_coat'});addEvidence(s,'ada',e);
  }else if(id==='clara'){
    if(a.disclosed){e=speech(s,id,'Edmund meant to confront Silas over the accounts. Rowan and I were in the greenhouse. Dr Marsh was there too; her record will tell you when.',cause,{intent:'Cooperate',basis:'heard_threat'});addEvidence(s,'clara',e);}
    else e=speech(s,id,topic==='alibi'?'I spent the evening in the library. Alone. Please don’t drag my private life into this.':'Edmund’s accounts were his business. I have nothing useful to add. I would appreciate some discretion.',cause,{intent:'Protect Rowan and conceal the affair',basis:'rowan_innocent',deception:topic==='alibi'?'Deliberate false alibi':'Withholding'});
  }else if(id==='rowan'){
    if(a.trust<.2)e=speech(s,id,'Clara told me what you threatened. Check the doctor’s ledger if you want my whereabouts. You won’t get our private life out of me.',cause,{intent:'Protect Clara',basis:'detective_threatened_clara'});
    else{e=speech(s,id,'I lent my green coat to Silas outside the inn, just before nine. Then Dr Marsh came to dress this hand. Her visiting book will show it.',cause,{intent:'Correct suspicion',basis:'coat_lent'});addEvidence(s,'rowan',e);}
  }else if(id==='silas'){
    e=speech(s,id,topic==='accounts'?'Routine discrepancies. Edmund liked to dramatize bookkeeping. The old folio won’t tell you anything.':'I was in the vestry from nine until half past. Alone, unfortunately. I had no appointment worth mentioning.',cause,{intent:'Conceal the crime',basis:'committed_murder',deception:'Deliberate false alibi'});addEvidence(s,'alibi',e);
  }else if(id==='iris')e=speech(s,id,'Death was between 21:10 and 21:20. I was with Rowan and Clara at the greenhouse from 21:06 to 21:23. My visiting ledger is available at the surgery.',cause,{intent:'Provide an accurate account',basis:'treated_rowan'});
  advance(s,3,cause);return e;
}
function present(s,id,clue,tone,cause){
  if(!PEOPLE[id]||!local(s,id))return reject(s,'Recipient not present','You need to be in the same place as the person you want to address.',cause);
  if(!has(s,clue))return reject(s,'Evidence not acquired','You cannot show evidence you have not discovered.',cause);
  const e=commit(s,{kind:'speech',title:`You show ${CLUES[clue].title.toLowerCase()} to ${PEOPLE[id].name}`,actor:'player',parents:[cause,s.world.player.evidence.find(x=>x.clue===clue).eventId],data:{listener:id,clue,tone},playerText:`You show ${PEOPLE[id].name} ${CLUES[clue].title.toLowerCase()}.`});
  believe(s,id,`player_has_${clue}`,`The detective has seen ${CLUES[clue].title.toLowerCase()}.`,.99,'observation',e,true);
  if(id==='clara'&&(clue==='letter'||clue==='record')){
    if(tone==='press'){
      const threat=speech(s,'clara','You would expose us to the whole village? Then I have nothing more to say.',e,{intent:'Withhold information'});
      believe(s,'clara','secret_threatened','The detective threatened to expose my relationship with Rowan.',.98,'observation',e,true);
      commit(s,{kind:'relationship',title:'Clara loses trust and fears exposure',actor:'clara',parents:[threat],changes:{'npcs.clara.trust':.08,'npcs.clara.stress':.92,'flags.claraThreatened':true}});decide(s,'clara',threat);
    }else{
      const response=speech(s,'clara','If you will keep our relationship out of the gossip, I will tell you. Edmund said Silas had altered the accounts. He meant to confront him that night. Rowan and I were with Dr Marsh in the greenhouse.',e,{intent:'Cooperate after an assurance of discretion',basis:'heard_threat'});
      commit(s,{kind:'relationship',title:'Clara chooses to cooperate',actor:'clara',parents:[response],changes:{'npcs.clara.trust':.85,'npcs.clara.stress':.35,'npcs.clara.disclosed':true,'flags.claraReassured':true}});addEvidence(s,'clara',response);
    }
  }else if(id==='silas'&&['ledger','folio'].includes(clue)){
    const response=speech(s,id,'Those papers belong in my office. I will see that the files are put in order.',e,{intent:'Deflect scrutiny'});
    believe(s,id,'detective_knows_accounts','The detective is investigating the diverted estate payments.',.99,'observation',e,true);
    commit(s,{kind:'emotion',title:'Silas becomes anxious about the folio',actor:id,parents:[response],changes:{'npcs.silas.stress':.9}});decide(s,id,response);
  }else if(id==='ada'&&clue==='clock'){
    const response=speech(s,id,'Twelve minutes fast? Then it was three minutes past nine. And I never saw his face. I’ve told the constable too much with too much certainty.',e,{intent:'Correct an honest mistake'});
    commit(s,{kind:'belief',title:'Ada retracts her identification and time',actor:id,parents:[response],changes:{'flags.clockCorrected':true}});
    believe(s,id,'saw_rowan','I saw an unidentified person in a green coat at 21:03.',.96,'inference',response,true);
    // A correction is not telepathic: Bell retains the old account until a later transfer.
  }else if(id==='rowan'&&clue==='record'){
    speech(s,id,'So you checked before deciding. Thank you. I lent Silas my coat at 20:55, outside the inn.',e,{intent:'Cooperate after corroboration',basis:'coat_lent'});
    commit(s,{kind:'relationship',title:'Rowan trusts your investigation more',actor:id,parents:[e],changes:{'npcs.rowan.trust':.7}});addEvidence(s,'rowan',e);
  }else speech(s,id,id==='bell'?'Keep that in your notebook. I will assess it alongside the rest when you make your case.':'I see. Compare it with the records before you draw a conclusion.',e,{intent:'Acknowledge evidence'});
  advance(s,4,cause);
}

export function checkCase(s,accusation){
  const selected=[...new Set(accusation.evidence??[])].filter(c=>has(s,c));
  const routes=CASE.proofRoutes.filter(r=>r.all.every(c=>selected.includes(c)));
  const supported=accusation.suspect===CASE.culprit&&accusation.method===CASE.method&&accusation.motive===CASE.motive&&routes.length>0;
  return {supported,routes:routes.map(r=>r.id),selected};
}

export function dispatch(s,action){
  if(!action||typeof action.type!=='string')throw Error('Expected a typed action.');
  const start=commit(s,{kind:'command',title:action.label||commandLabel(action),actor:'player',data:{action:copy(action)}});
  if(s.world.status==='solved'&&!['pin','note','look'].includes(action.type)){reject(s,'The case is closed','The case is closed. You can review the notebook and inspect the full history, or begin again.',start);}
  else switch(action.type){
    case 'move':{
      if(!LOCATIONS[action.to]){reject(s,'Unknown destination','Choose a place on the village list.',start);break;}
      const from=s.world.player.location;if(from===action.to){reject(s,'Already at destination','You are already here.',start);break;}
      const duration=distance(from,action.to);const departure=commit(s,{kind:'movement',title:`You leave for ${LOCATIONS[action.to].short}`,actor:'player',location:from,parents:[start],changes:{'player.location':'transit'},data:{from,to:action.to,duration}});witnessMovement(s,'player','departure',from,departure);advance(s,duration,start);
      const arr=commit(s,{kind:'arrival',title:`You reach ${LOCATIONS[action.to].name}`,actor:'player',location:action.to,parents:[start],changes:{'player.location':action.to,'player.visited':[...new Set([...s.world.player.visited,action.to])]},playerText:LOCATIONS[action.to].description});
      witnessMovement(s,'player','arrival',action.to,arr);
      for(const id of Object.keys(PEOPLE))notice(s,id,arr,`${PEOPLE[id].name} is here.`);break;
    }
    case 'inspect':{
      const obj=OBJECTS[action.object],at=s.world.player.location;if(!obj||!LOCATIONS[at]?.objects.includes(action.object)){reject(s,'Object outside your reach','That object is not here. Choose something in your current surroundings.',start);break;}
      const inspected=commit(s,{kind:'action',title:`You inspect ${obj.label.toLowerCase()}`,actor:'player',parents:[start],data:{object:action.object}});
      if(action.object==='folio'&&s.world.objects.folio!=='manor')commit(s,{kind:'observation',title:'The red folio is missing',actor:'player',parents:[inspected],playerText:'A clean rectangle in the dust marks where the red folio lay. It has been moved. The estate solicitor keeps related files at the vestry.'});
      else if(action.object==='drawer'&&s.world.objects.folio!=='drawer')commit(s,{kind:'observation',title:'Routine deeds in the drawer',actor:'player',parents:[inspected],playerText:'The drawer contains routine parish deeds. The red estate folio is not here.'});
      else if(!addEvidence(s,obj.clue,inspected,`${LOCATIONS[at].name} · ${obj.label}`))commit(s,{kind:'observation',title:'You review an existing clue',actor:'player',parents:[inspected],playerText:`You have already recorded ${obj.label.toLowerCase()}. ${CLUES[obj.clue].text}`});
      advance(s,3,start);break;
    }
    case 'ask':ask(s,action.person,action.topic||'night',start);break;
    case 'present':present(s,action.person,action.clue,action.tone||'private',start);break;
    case 'wait':{const n=Math.max(1,Math.min(60,Math.round(Number(action.minutes)||10)));commit(s,{kind:'observation',title:`You wait ${n} minutes`,actor:'player',parents:[start],playerText:`You wait for ${n} minutes. The village continues around you.`});advance(s,n,start);break;}
    case 'pin':{
      if(!has(s,action.clue)){reject(s,'Unknown notebook entry','Discover the evidence before pinning it.',start);break;}
      const pins=s.world.player.pins;commit(s,{kind:'notebook',title:`${pins.includes(action.clue)?'Unpinned':'Pinned'}: ${CLUES[action.clue].title}`,actor:'player',parents:[start],changes:{'player.pins':pins.includes(action.clue)?pins.filter(x=>x!==action.clue):[...pins,action.clue]}});break;
    }
    case 'note':{const value=String(action.text||'').trim().slice(0,1000);if(value)commit(s,{kind:'notebook',title:'You record a hypothesis',actor:'player',parents:[start],changes:{'player.notes':[...s.world.player.notes,{text:value,minute:s.world.minute}].slice(-30)}});break;}
    case 'accuse':{
      if(!local(s,'bell')){reject(s,'The constable is not here','Bring your case to Constable Bell at the village square.',start);break;}
      const result=checkCase(s,action);
      if(result.supported){const ending={suspect:action.suspect,method:action.method,motive:action.motive,evidence:result.selected,routes:result.routes};commit(s,{kind:'resolution',title:'Bell accepts your case',actor:'bell',parents:[start,...result.selected.map(c=>s.world.player.evidence.find(e=>e.clue===c).eventId)],changes:{status:'solved',ending},data:{rubric:'Authored case evidence requirements',...ending},playerText:'Bell reads your notes twice, then closes the folder. “The accounts explain why. The records establish when. And the evidence connects Silas to the crime. We have our case.”\n\nBell opens a clean page in his ledger. The investigation has a conclusion supported by evidence, and the village’s favorite rumor has not survived it.'});}
      else reject(s,'The accusation is not sufficiently supported','Bell sets the file down. “I need a connected case: the medical window, reliable whereabouts, and evidence linking the suspect to the act and its motive. Compare the documents with the testimony, and make sure the relevant entries are selected.”',start,{selected:result.selected,suspect:action.suspect,method:action.method,motive:action.motive});break;
    }
    case 'look':commit(s,{kind:'observation',title:'You look around',actor:'player',parents:[start],playerText:LOCATIONS[s.world.player.location].description});break;
    default:reject(s,'Command not understood','Try “go manor”, “inspect desk”, “ask Clara about alibi”, “wait 10”, or choose an action on screen.',start);
  }
  commit(s,{kind:'checkpoint',title:'Action complete',actor:'player',parents:[start],data:{boundary:true}});return s;
}
function commandLabel(a){return {move:`Travel to ${LOCATIONS[a.to]?.name??a.to}`,inspect:`Inspect ${OBJECTS[a.object]?.label??a.object}`,ask:`Ask ${PEOPLE[a.person]?.name??a.person} about ${a.topic??'last night'}`,present:`Show evidence to ${PEOPLE[a.person]?.name??a.person}`,wait:`Wait ${a.minutes??10} minutes`,pin:'Update pinned evidence',note:'Write a hypothesis',accuse:'Present an accusation',look:'Look around'}[a.type]??'Unrecognized command';}

export function parseCommand(input){
  const text=input.trim().toLowerCase().replace(/[?!.,]/g,'');
  const placeAliases={square:'square',village:'square',manor:'manor',study:'manor',inn:'inn',rook:'inn',greenhouse:'greenhouse',vestry:'vestry',church:'vestry',surgery:'surgery',doctor:'surgery'};
  const place=Object.entries(placeAliases).find(([k])=>new RegExp(`\\b${k}\\b`).test(text))?.[1];
  if(/^(go|walk|travel|visit|move)\b/.test(text)&&place)return {type:'move',to:place,label:input};
  if(/^wait\b/.test(text))return {type:'wait',minutes:Number(text.match(/\d+/)?.[0]||10),label:input};
  if(/^(look|l)$/.test(text))return {type:'look',label:input};
  const person=Object.entries(PEOPLE).find(([id,p])=>text.includes(id)||p.name.toLowerCase().split(' ').some(n=>text.includes(n)))?.[0];
  if(/^(ask|talk|speak|question)\b/.test(text)&&person)return {type:'ask',person,topic:text.includes('alibi')?'alibi':text.includes('account')?'accounts':text.includes('case')?'case':'night',label:input};
  const objectAliases={body:'body',medical:'body',diary:'desk',desk:'desk',accounts:'accounts',ledger:'accounts',carpet:'carpet',fragment:'carpet',folio:'folio',clock:'clock',letter:'letter',envelope:'letter',pump:'pump',seal:'seal',delivery:'delivery',drawer:'drawer',record:'record',visiting:'record'};
  if(/^(inspect|search|examine|read|check)\b/.test(text)){const object=text.includes('visiting ledger')?'record':Object.entries(objectAliases).find(([k])=>new RegExp(`\\b${k}\\b`).test(text))?.[1];if(object)return {type:'inspect',object,label:input};}
  return {type:'unknown',label:input};
}

export function worldAt(s,index){
  if(!Number.isInteger(index)||index< -1||index>=s.events.length)throw Error('Invalid history cursor');
  const world=baseWorld(s.seed);for(let i=0;i<=index;i++)for(const p of s.events[i].changes)set(world,p.path,p.after);return world;
}
export function playerView(s){const w=s.world,at=w.player.location;return {minute:w.minute,status:w.status,location:at,scene:LOCATIONS[at],people:Object.entries(w.npcs).filter(([,p])=>p.location===at).map(([id])=>({id,...publicPerson(id)})),evidence:w.player.evidence.map(e=>({...e,...CLUES[e.clue]})),pins:copy(w.player.pins),notes:copy(w.player.notes),lastSeen:copy(w.player.lastSeen),transcript:s.events.filter(e=>e.playerText).map(e=>({id:e.id,minute:e.minute,kind:e.kind,text:e.playerText,actor:e.actor})),ending:copy(w.ending)};}
export const publicPerson=id=>({name:PEOPLE[id].name,initials:PEOPLE[id].initials,role:PEOPLE[id].role,color:PEOPLE[id].color,public:PEOPLE[id].public});
export function caseHealth(s,world=s.world){return CASE.proofRoutes.map(r=>({...r,found:r.all.filter(c=>world.player.evidence.some(e=>e.clue===c)),available:r.all.every(c=>c!=='folio'||['manor','silas','drawer'].includes(world.objects.folio))}));}

export function diagnostics(s){
  const ids=new Set(),errors=[];let patchCount=0;const replay=baseWorld(s.seed);
  for(const e of s.events){if(ids.has(e.id))errors.push(`Duplicate event ${e.id}`);for(const p of e.parents)if(!ids.has(p))errors.push(`${e.id} references a missing or future cause ${p}`);ids.add(e.id);
    for(const p of e.changes){if(!same(get(replay,p.path),p.before))errors.push(`Patch mismatch at ${e.id}: ${p.path}`);set(replay,p.path,p.after);patchCount++;}
  }
  if(!same(replay,s.world))errors.push('Replay differs from current world');
  for(const [id,a]of Object.entries(s.world.npcs)){if(!PEOPLE[id]||(a.location!=='transit'&&!LOCATIONS[a.location]))errors.push(`Invalid location for ${id}`);if((a.location==='transit')!==Boolean(a.travel))errors.push(`Travel mismatch for ${id}`);for(const b of a.beliefs)if(!ids.has(b.sourceId))errors.push(`Untraced belief for ${id}`);}
  for(const e of s.world.player.evidence)if(!CLUES[e.clue]||!ids.has(e.eventId))errors.push('Untraced evidence');
  if(s.world.player.location!=='transit'&&!LOCATIONS[s.world.player.location])errors.push('Invalid player location');
  return {ok:errors.length===0,errors,eventCount:s.events.length,patchCount,beliefCount:Object.values(s.world.npcs).reduce((n,a)=>n+a.beliefs.length,0),checks:[{name:'Event ordering and causal references',ok:!errors.some(e=>/Duplicate|cause/.test(e))},{name:'Replay matches the current world',ok:!errors.some(e=>/Replay|Patch/.test(e))},{name:'Characters have valid locations and travel',ok:!errors.some(e=>/location|Travel/.test(e))},{name:'Beliefs and evidence have source events',ok:!errors.some(e=>/Untraced/.test(e))}]};
}
export function exportSession(s){return JSON.stringify({format:'living-mystery',version:VERSION,seed:s.seed,events:s.events,world:s.world},null,2);}
export function importSession(text){
  if(typeof text!=='string'||text.length>20_000_000)throw Error('Save file is too large.');
  const s=JSON.parse(text);if(s.format!=='living-mystery'||s.version!==VERSION||!Array.isArray(s.events)||s.events.length>50000||!Number.isInteger(s.seed)||s.seed<0||s.seed>999999)throw Error('This is not a supported Living Mystery save.');
  const kinds=new Set(['history','memory','belief','observation','arrival','movement','decision','speech','relationship','action','clock','evidence','rejected','emotion','command','notebook','resolution','checkpoint']);
  for(const [i,e] of s.events.entries()){if(!e||e.id!==`e${String(i+1).padStart(5,'0')}`||e.index!==i||!kinds.has(e.kind)||!['player','world',...Object.keys(PEOPLE)].includes(e.actor)||!Array.isArray(e.changes)||!Array.isArray(e.parents)||!Number.isFinite(e.minute)||e.minute<480||typeof e.title!=='string'||!e.data||typeof e.data!=='object'||(e.playerText!==null&&typeof e.playerText!=='string'))throw Error('Malformed event in save.');for(const p of e.changes)if(typeof p.path!=='string'||!p.path.split('.').every(k=>k&&!unsafe.has(k))||!['minute','status','player','npcs','objects','flags','ending'].includes(p.path.split('.')[0]))throw Error('Invalid state change in save.');}
  const out={version:s.version,seed:s.seed,events:s.events,world:s.world};const d=diagnostics(out);if(!d.ok)throw Error(`Save failed integrity checks: ${d.errors[0]}`);return out;
}
