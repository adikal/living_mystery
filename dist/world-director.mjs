import {compilePlan,SYMBOLIC_VERSION} from './symbolic.mjs';

// Case-independent plan admission. Z3 independently checks this exact query when
// enabled by the adapter; the local concrete witness keeps authored play offline.
export function assessPlan(kernel,session,plan){
  const npc=session.world.npcs[plan.actor];
  try{
    const commitment=kernel.model.commitments?.[plan.actor];
    if(commitment&&session.world.minute>=commitment.from&&plan.steps.some(step=>step.kind==='move'&&step.to!==commitment.location))return {version:SYMBOLIC_VERSION,mode:'local-witness',status:'reject',reason:'A standing public commitment requires this character to remain available here.',plan};
    if(plan.steps.some(step=>step.kind==='activity'&&!kernel.life?.validateActivity(session,plan.actor,step)))throw Error('Activity is outside this character’s capabilities');
    const distances={};for(const a of Object.keys(kernel.model.LOCATIONS))for(const b of Object.keys(kernel.model.LOCATIONS))distances[`${a}:${b}`]=kernel.distance(a,b);
    const compiled=compilePlan({actor:plan.actor,location:npc.location,objects:session.world.objects,
      knowledge:npc.beliefs.map(b=>b.key),locations:kernel.model.LOCATIONS,distances,steps:plan.steps,minute:session.world.minute,
      horizon:plan.horizon??120,sourceEvents:plan.sources,participants:session.world.npcs,containers:kernel.model.containers??{}});
    if(kernel.life&&!kernel.life.permitsPlan(session,plan.actor,plan,compiled.projected))throw Error('Plan conflicts with an accepted appointment');
    return {version:SYMBOLIC_VERSION,mode:'local-witness',status:compiled.failures.length?'reject':'allow',
      reason:compiled.failures.length?compiled.failures.map(c=>c.label).join('; '):'Concrete plan satisfies the supported constraints; future meetings remain conditional.',
      plan,query:compiled.query,witness:compiled.witness,conflicts:compiled.failures.map(c=>c.id),projected:compiled.projected};
  }catch(error){return {version:SYMBOLIC_VERSION,mode:'local-witness',status:'defer',reason:error.message,plan};}
}

export function recordPlan(kernel,session,plan,cause){
  const audit=assessPlan(kernel,session,plan);
  const event=kernel.commit(session,{kind:'decision',actor:plan.actor,title:`World Director: ${audit.status} ${plan.label}`,parents:[cause,...(plan.sources??[])],data:{director:audit,reason:audit.reason}});
  return {audit,event};
}

// Executor consumes the same typed step used by the compiler. Case callbacks
// supply narrative/perception consequences only after physical preconditions pass.
export function executePlanStep(kernel,session,plan,cause,handlers={}){
  const step=plan.steps[0],npc=session.world.npcs[plan.actor];
  const checked=assessPlan(kernel,session,{...plan,steps:[step]});
  if(checked.status!=='allow')return {status:checked.status,reason:checked.reason};
  if(npc.travel)return {status:'defer',reason:'Actor is travelling'};
  if(step.kind==='move'){
    kernel.startTravel(session,plan.actor,step.to,cause,plan.label);return {status:'executed'};
  }
  if(step.kind==='communicate'){
    const recipient=session.world.npcs[step.recipient];
    if(npc.location!==step.location||!recipient||recipient.travel||recipient.location!==npc.location)return {status:'defer',reason:'Recipient is not present'};
    if(!npc.beliefs.some(b=>b.key===step.belief))return {status:'defer',reason:'Source belief is unavailable'};
  }else if(step.kind==='take'){
    if(npc.location!==step.from||session.world.objects[step.object]!==step.from)return {status:'defer',reason:'Object is not accessible'};
  }else if(['store','conceal','give'].includes(step.kind)){
    if(npc.location!==step.location||session.world.objects[step.object]!==plan.actor)return {status:'defer',reason:'Actor must carry the object at the destination'};
  }else if(!['observe','activity'].includes(step.kind))return {status:'defer',reason:'Unsupported step'};
  if(!handlers[step.kind])return {status:'defer',reason:'No execution handler'};
  handlers[step.kind](step,cause);return {status:'executed'};
}
