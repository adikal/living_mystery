// Persistent daily-life goals and social commitments. No model calls in the kernel.
// Plans use the shared move/activity contracts; every consequence is an event.
import {assessPlan,recordPlan} from './world-director.mjs';
import {timeLabel} from './kernel.mjs';
const clone=x=>structuredClone(x);
const active=r=>['offered','accepted'].includes(r.status);
export function createLife(K){
 const definitions=K.model.life;
 const state=(s,id)=>s.world.npcs[id]?.life;
 const requests=s=>Object.values(s.world.flags.lifeRequests??{});
 const energy=(s,id)=>Math.max(0,state(s,id).energy-Math.floor((s.world.minute-state(s,id).energyAt)/4));
 const write=(s,id,title,changes,data={},parents=[])=>K.commit(s,{kind:'decision',actor:id,title,changes,data:JSON.parse(JSON.stringify({life:true,...data})),parents});
 const rendezvous=(a,b)=>K.model.commitments?.[a]?.location??K.model.commitments?.[b]?.location??'inn';
 function wake(s,id,cause){if(state(s,id)&&cause)write(s,id,'New information prompts reconsideration',{[`npcs.${id}.life.nextAt`]:s.world.minute},{trigger:'knowledge'},[cause]);}
 function permitsPlan(s,id,plan,projected){return requests(s).filter(r=>r.status==='accepted'&&r.people.includes(id)).every(r=>(plan.life&&plan.goals?.includes(`meet:${r.id}`)&&plan.steps.every(step=>step.task===`meet:${r.id}`||step.kind==='move'&&step.to===r.location)&&projected.minute+(plan.steps.every(step=>step.kind==='move')?6:0)<=r.end)||projected.minute+K.distance(projected.location,r.location)<=r.start);}
 function engagement(s,id,cause){const a=state(s,id)?.active;if(!a)return;const paused=s.world.player.conversation===id;if(paused===a.paused)return;write(s,id,paused?'Activity paused for conversation':'Activity resumes after conversation',{[`npcs.${id}.life.active`]:paused?{...a,paused:true,remaining:Math.max(1,a.until-s.world.minute)}:{...a,paused:false,until:s.world.minute+a.remaining}},{trigger:'conversation'},[cause]);}
 function initialize(s){
  if(!definitions||s.world.flags.lifeVersion)return;
  const changes={'flags.lifeVersion':1,'flags.lifeRequests':{}};
  for(const [id,d]of Object.entries(definitions))changes[`npcs.${id}.life`]={energy:80,energyAt:s.world.minute,nextAt:s.world.minute+10,lastAI:-1,active:null,completed:{},failures:{},socialAfter:s.world.minute+20,goals:[{id:'work',label:d.work},{id:'errand',label:d.errand.label},{id:'rest',label:'Rest and recover'},{id:'social',label:d.social.label}]};
  write(s,'world','Ordinary lives begin',changes,{version:1});
 }
 function knownPlace(s,actor,recipient){
  // Actual co-location is observable. Otherwise use the most recent witnessed
  // movement, or the person's public workplace as an explicitly uncertain guess.
  const npc=s.world.npcs[recipient];
  if(!npc.travel&&npc.location===s.world.npcs[actor].location)return npc.location;
  const seen=s.events.findLast(e=>e.actor===actor&&e.kind==='observation'&&e.data.subject===recipient&&e.data.observedLocation);
  return seen?.data.observedLocation??K.model.PEOPLE[recipient].home;
 }
 function choices(s,id){
  const l=state(s,id),npc=s.world.npcs[id],d=definitions?.[id],now=s.world.minute;
  if(!l||!d||requests(s).some(r=>r.status==='offered'&&r.sender===id&&s.world.minute<=r.expires)||npc.travel||npc.pendingPlan||l.active||s.world.player.conversation===id||s.world.status==='solved')return [];
  const candidates=[],add=(key,label,location,duration,score,reasons)=>{
   if((l.failures[key]?.retryAt??0)>now)return;
   candidates.push({id:key,label,location,duration,score,reasons});
  };
  const en=energy(s,id);
  add('rest','Rest and recover',K.model.PEOPLE[id].home,10,en<35?110:5,[`Energy ${en}/100`]);
  add('work',d.work,K.model.PEOPLE[id].home,8,30+Math.min(50,(now-(l.completed.work??now-20))/2),['Ordinary responsibility','Time since last completed work']);
  if(now-(l.completed.errand??s.events.find(e=>e.data.life&&e.data.version)?.minute??now)>=25)
   add('errand',d.errand.label,d.errand.location,6,45+Math.min(45,(now-(l.completed.errand??now-30))/3),['Personal responsibility outside the investigation']);
  for(const r of requests(s)){
   if(r.status==='offered'&&r.recipient===id&&r.expires>=now)
    add(`reply:${r.id}`,`Respond to ${K.model.PEOPLE[r.sender].name}'s invitation`,knownPlace(s,id,r.sender),2,85,['A delivered request awaits a response']);
   if(r.status==='accepted'&&r.people.includes(id)&&now+K.distance(npc.location,r.location)>=r.start-5)
    add(`meet:${r.id}`,r.label,r.location,6,150,['An accepted commitment has priority',`Meet by ${r.end}`]);
  }
  if(d.social.initiates!==false&&now>=l.socialAfter&&!requests(s).some(r=>active(r)&&(r.people.includes(id)||r.people.includes(d.social.partner))))
   add(`invite:${d.social.partner}`,d.social.label,knownPlace(s,id,d.social.partner),2,60,['A personal goal involves another person','Their presence must be checked on arrival']);
  // Reserve enough time for accepted appointments, rather than weighing a promise
  // against an optional errand. Uncertain meetings remain execution-time checks.
  return candidates.filter(c=>{
   const end=now+K.distance(npc.location,c.location)+c.duration;
   return requests(s).filter(r=>r.status==='accepted'&&r.people.includes(id)).every(r=>c.id===`meet:${r.id}`||end+K.distance(c.location,r.location)<=r.start)
     && assessPlan(K,s,buildPlan(s,id,[c])).status==='allow';
  }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
 }
 function buildPlan(s,id,selected){
  let at=s.world.npcs[id].location;const steps=[];
  for(const c of selected){if(at!==c.location)steps.push({kind:'move',to:c.location});steps.push({kind:'activity',location:c.location,task:c.id,duration:c.duration,...(c.id.startsWith('meet:')?{deadline:s.world.flags.lifeRequests[c.id.slice(5)].end}:{})});at=c.location;}
  return {id:`life:${selected.map(c=>c.id).join('+')}`,actor:id,label:selected.map(c=>c.label).join('; then '),sources:[],steps,life:true,goals:selected.map(c=>c.id)};
 }
 function planFor(s,id,ids){
  if(!Array.isArray(ids)||ids.length<1||ids.length>3||new Set(ids).size!==ids.length)throw Error('Choose 1–3 distinct available goals');
  const available=choices(s,id),selected=ids.map(key=>available.find(c=>c.id===key));
  if(selected.some(c=>!c))throw Error('Life choice is no longer available');
  if(ids.length>1&&ids.some(key=>key.includes(':')))throw Error('Social plans must be reconsidered after their outcome');
  const plan=buildPlan(s,id,selected),audit=assessPlan(K,s,plan);
  if(audit.status!=='allow')throw Error(audit.reason);
  // Composition can consume more time than each individually admissible choice.
  for(const r of requests(s).filter(r=>r.status==='accepted'&&r.people.includes(id)))
   if(!ids.includes(`meet:${r.id}`)&&audit.projected.minute+K.distance(audit.projected.location,r.location)>r.start)throw Error('Composed plan conflicts with an accepted appointment');
  return {plan,available};
 }
 function choose(s,id,ids,policy='scripted',rationale='Highest current priority'){
  const {plan,available}=planFor(s,id,ids),{event}=recordPlan(K,s,plan);
  write(s,id,`${K.model.PEOPLE[id].name} chooses ${plan.label.toLowerCase()}`,{[`npcs.${id}.lastDecision`]:K.nextId(s),[`npcs.${id}.pendingPlan`]:{plan,cursor:0,cause:event},[`npcs.${id}.intention`]:plan.label,[`npcs.${id}.life.nextAt`]:s.world.minute+10},
   {policy,selected:ids[0],sequence:ids,candidates:available.map(c=>({...c,score:Math.min(100,c.score)})),rationale},[event]);
  K.runPending(s,id,event);
  return plan;
 }
 function decide(s,id){
  const l=state(s,id);if(!l)return false;
  if(l.active)return true;
  if(requests(s).some(r=>r.status==='offered'&&r.sender===id&&s.world.minute<=r.expires))return true;
  if(s.world.minute<l.nextAt)return true;
  const c=choices(s,id);if(c.length)choose(s,id,[c[0].id]);return true;
 }
 function validateActivity(s,id,step){
  const d=definitions?.[id];if(!d)return false;
  if(step.task==='work')return step.location===K.model.PEOPLE[id].home&&step.duration===8;
  if(step.task==='rest')return step.location===K.model.PEOPLE[id].home&&step.duration===10;
  if(step.task==='errand')return step.location===d.errand.location&&step.duration===6;
  if(step.task===`invite:${d.social.partner}`)return Boolean(K.model.LOCATIONS[step.location])&&step.duration===2;
  const [kind,rid]=step.task.split(':'),r=s.world.flags.lifeRequests?.[rid];
  if(kind==='reply')return r?.recipient===id&&r.status==='offered'&&s.world.minute<=r.expires&&step.duration===2;
  return kind==='meet'&&r?.status==='accepted'&&r.people.includes(id)&&r.location===step.location&&s.world.minute<=r.end&&step.duration===6&&step.deadline===r.end;
 }
 function start(s,id,step,cause){
  if(!validateActivity(s,id,step)||state(s,id).active)throw Error('Activity is no longer permitted');
  const meeting=step.task.startsWith('meet:');
  const e=K.commit(s,{kind:'action',actor:id,title:`${K.model.PEOPLE[id].name} begins ${step.task}`,parents:[cause],data:{life:true,phase:'started',task:step.task},changes:{[`npcs.${id}.life.active`]:{task:step.task,location:step.location,remaining:step.duration,until:s.world.minute+step.duration,paused:false,meeting,started:false,deadline:s.world.minute+20},[`npcs.${id}.life.energy`]:energy(s,id),[`npcs.${id}.life.energyAt`]:s.world.minute},playerText:K.local(s,id)?`${K.model.PEOPLE[id].name} ${step.task==='work'?definitions[id].work.toLowerCase():step.task==='rest'?'takes a short rest':step.task==='errand'?definitions[id].errand.label.toLowerCase():'attends to a personal appointment'}.`:null});
  K.remember(s,id,e);
 }
 function finished(s,id,status,reason){
  const l=state(s,id);if(!l)return;
  const plan=s.world.npcs[id].pendingPlan?.plan;
  const changes={[`npcs.${id}.life.nextAt`]:s.world.minute+(status==='blocked'?5:1)};
  if(status==='blocked')for(const key of plan?.goals??[]){const attempts=(l.failures[key]?.attempts??0)+1;changes[`npcs.${id}.life.failures.${key}`]={attempts,retryAt:s.world.minute+Math.min(60,5*2**Math.min(attempts,4)),reason};}
  write(s,id,`${K.model.PEOPLE[id].name} will reconsider priorities`,changes,{planStatus:status,reason});
 }
 function deliver(s,from,to,text,cause){
  const a=s.world.npcs[from],b=s.world.npcs[to];if(a.travel||b.travel||a.location!==b.location)return null;
  const e=K.commit(s,{kind:'speech',actor:from,title:`${K.model.PEOPLE[from].name} speaks to ${K.model.PEOPLE[to].name}`,parents:[cause],data:{life:true,listener:to,assertion:text},playerText:K.local(s,from)?`You overhear ${K.model.PEOPLE[from].name}: “${text}”`:null});
  K.remember(s,from,e);K.remember(s,to,e);return e;
 }
 function complete(s,id,a,cause){
  const l=state(s,id),now=s.world.minute,[kind,target]=a.task.split(':');let success=true;
  if(kind==='invite'){
   if(requests(s).some(r=>active(r)&&(r.people.includes(id)||r.people.includes(target))))success=false;
   else{
    const location=rendezvous(id,target);
    const e=deliver(s,id,target,`Could we meet at ${K.model.LOCATIONS[location].name} shortly to ${definitions[id].social.purpose}?`,cause);
    if(!e)success=false;
    else write(s,id,'Invitation delivered',{[`flags.lifeRequests.${e}`]:{id:e,sender:id,recipient:target,people:[id,target],status:'offered',location,label:definitions[id].social.label,expires:now+45,source:e},[`npcs.${id}.life.socialAfter`]:now+180},{request:e},[e]);
   }
  }else if(kind==='reply'){
   const r=s.world.flags.lifeRequests[target];
   if(!r||r.status!=='offered'||now>r.expires)success=false;
   else{
   const start=now+Math.max(...r.people.map(p=>K.distance(s.world.npcs[p].location,r.location)))+12,end=start+15;
   const conflict=requests(s).some(other=>other.id!==r.id&&other.status==='accepted'&&other.people.some(p=>r.people.includes(p))&&other.start<end&&other.end>start);
   const accepted=energy(s,id)>=25&&!conflict;
   const e=deliver(s,id,r.sender,accepted?`Yes. Let us meet at ${K.model.LOCATIONS[r.location].name} at ${timeLabel(start)}, finishing by ${timeLabel(end)}.`:'I cannot make that commitment just now.',r.source);
   if(!e)success=false;
   else write(s,id,accepted?'Appointment accepted in person':'Invitation declined',{[`flags.lifeRequests.${target}`]:{...r,status:accepted?'accepted':'declined',start,end,acceptedSource:e},[`npcs.${id}.life.socialAfter`]:now+180}, {request:target},[e]);
   }
  }
  const changes={[`npcs.${id}.life.active`]:null,[`npcs.${id}.life.energy`]:Math.max(0,Math.min(100,energy(s,id)+(a.task==='rest'?45:-5))),[`npcs.${id}.life.energyAt`]:now};
  if(success)changes[`npcs.${id}.life.completed.${a.task}`]=now;
  const e=write(s,id,`${K.model.PEOPLE[id].name}: ${a.task} ${success?'completed':'blocked'}`,changes,{task:a.task,outcome:success?'completed':'blocked'},[cause]);
  if(!success){finished(s,id,'blocked','The other person was unavailable or the request changed');K.commit(s,{kind:'decision',actor:id,title:'Replan after failed encounter',parents:[e],changes:{[`npcs.${id}.pendingPlan`]:null}});}
 }
 function tick(s,id,cause){
  const l=state(s,id);if(!l)return;
  const now=s.world.minute,a=l.active;
  // One expiration record; no retries create promises retroactively.
  for(const r of requests(s).filter(r=>active(r)&&r.people.includes(id)))if(now>(r.status==='offered'?r.expires:r.end))write(s,id,'Appointment expired',{[`flags.lifeRequests.${r.id}.status`]:'expired'},{request:r.id},[r.source]);
  if(!a)return;
  if(s.world.player.conversation===id){if(!a.paused)write(s,id,'Activity paused for conversation',{[`npcs.${id}.life.active`]:{...a,paused:true,remaining:Math.max(1,a.until-now)}});return;}
  if(a.paused){write(s,id,'Activity resumes after conversation',{[`npcs.${id}.life.active`]:{...a,paused:false,until:now+a.remaining}});return;}
  if(a.meeting){
   const r=s.world.flags.lifeRequests[a.task.slice(5)];
   if(r?.status==='completed'){complete(s,id,a,r.completedSource);return;}
   if(!r||r.status!=='accepted'){finished(s,id,'blocked','Appointment expired or was cancelled');write(s,id,'Unfulfilled appointment released',{[`npcs.${id}.life.active`]:null,[`npcs.${id}.pendingPlan`]:null},{task:a.task,outcome:'blocked'},[cause]);return;}
   const other=r.people.find(p=>p!==id),partner=state(s,other)?.active;
   if(!a.started){
    if(now<r.start||partner?.task!==a.task||partner.paused||s.world.npcs[other].travel||s.world.npcs[other].location!==a.location||s.world.player.conversation===other)return;
    write(s,id,'Both participants begin their appointment',Object.fromEntries(r.people.map(p=>[`npcs.${p}.life.active`,{...state(s,p).active,started:true,until:now+6}])),{request:r.id},[r.acceptedSource]);return;
   }
   if(partner?.paused||s.world.player.conversation===other||s.world.npcs[other].location!==a.location){write(s,id,'Meeting waits for both participants',{[`npcs.${id}.life.active.until`]:now+6});return;}
   if(now>=a.until){const e=deliver(s,id,other,'Thank you. We have finished what we agreed to discuss.',r.acceptedSource);if(e)write(s,id,'Appointment fulfilled',{[`flags.lifeRequests.${r.id}.status`]:'completed',[`flags.lifeRequests.${r.id}.completedSource`]:e},{request:r.id},[e]);}
  }else if(now>=a.until){
   const [kind,target]=a.task.split(':');
   const recipient=kind==='invite'?target:kind==='reply'?s.world.flags.lifeRequests[target]?.sender:null;
   if(recipient&&now<a.deadline&&(s.world.npcs[recipient].travel||s.world.npcs[recipient].location!==a.location))return;
   complete(s,id,a,cause);
  }
 }
 function perspective(s,id){
  const npc=s.world.npcs[id],l=state(s,id);if(!l)return null;
  return {id,name:K.model.PEOPLE[id].name,minute:s.world.minute,location:npc.location,energy:energy(s,id),goals:clone(l.goals),commitments:clone(requests(s).filter(r=>r.people.includes(id))),beliefs:npc.beliefs.slice(-12).map(({key,text,sourceId})=>({key,text,sourceId})),recent: s.events.filter(e=>npc.memories.includes(e.id)).slice(-6).map(e=>({id:e.id,kind:e.kind,text:e.data.assertion??e.title})),choices:choices(s,id)};
 }
 return {initialize,choices,choose,planFor,decide,validateActivity,start,finished,tick,perspective,wake,permitsPlan,engagement};
}
