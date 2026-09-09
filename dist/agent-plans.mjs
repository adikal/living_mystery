import {assessPlan,recordPlan,executePlanStep} from './world-director.mjs';

// Case policy grants capabilities; the model selects a plan ID rather than
// inventing object identifiers, disclosure permissions, or executable patches.
export function availablePlans(kernel,s,actor){
  const npc=s.world.npcs[actor];if(!npc||npc.travel||npc.pendingPlan)return [];
  const sources=[];
  const offers=Object.keys(kernel.model.LOCATIONS).map(to=>({id:`survey:${to}`,actor,label:`Look around ${kernel.model.LOCATIONS[to].name}`,sources,steps:[...(to===npc.location?[]:[{kind:'move',to}]),{kind:'observe',location:to}]}));
  for(const [object,holder]of Object.entries(s.world.objects)){
    if(holder!==actor)continue;
    for(const [recipient,p]of Object.entries(s.world.npcs))if(recipient!==actor&&!p.travel&&p.location===npc.location)offers.push({id:`give:${object}:${recipient}`,actor,label:`Give ${object} to ${kernel.model.PEOPLE[recipient].name}`,sources,steps:[{kind:'give',object,recipient,location:npc.location}]});
  }
  for(const permission of kernel.model.agentPermissions?.[actor]??[]){
    const belief=npc.beliefs.find(b=>b.key===permission.requires);
    if(!belief)continue;
    // Permission is case-owned. Private actual object locations are not sent to
    // the model: only admit a known starting location or the actor's own hands.
    const holder=s.world.objects[permission.object];
    if(holder!==actor&&holder!==npc.location)continue;
    offers.push({id:permission.id,actor,label:permission.label,sources:[belief.sourceId],steps:[...(holder===actor?[]:[{kind:'take',object:permission.object,from:npc.location}]),...(permission.location===npc.location?[]:[{kind:'move',to:permission.location}]),{kind:'conceal',object:permission.object,location:permission.location,to:permission.to}]});
  }
  // Only generic witnessed location observations are automatically shareable.
  // Case secrets and mistaken accounts require an explicit authored disclosure.
  for(const b of npc.beliefs.filter(b=>b.key.startsWith('observed_location_')))for(const [recipient,p]of Object.entries(s.world.npcs))if(recipient!==actor&&!p.travel&&p.location===npc.location)offers.push({id:`tell:${b.key}:${recipient}`,actor,label:`Tell ${kernel.model.PEOPLE[recipient].name}: ${b.text}`,sources:[b.sourceId],steps:[{kind:'communicate',recipient,location:npc.location,belief:b.key}]});
  return offers.filter(plan=>assessPlan(kernel,s,plan).status==='allow');
}

export function queuePlan(kernel,s,plan,cause){
  const current=availablePlans(kernel,s,plan.actor).find(p=>p.id===plan.id);
  if(!current||JSON.stringify(current)!==JSON.stringify(plan))throw Error('Plan capability is no longer available');
  const {audit,event}=recordPlan(kernel,s,plan,cause);
  if(audit.status!=='allow')throw Error('Plan failed admission');
  kernel.commit(s,{kind:'decision',actor:plan.actor,title:`${kernel.model.PEOPLE[plan.actor].name} plans to ${plan.label.toLowerCase()}`,parents:[event],data:{planStatus:'pending',planId:plan.id},changes:{[`npcs.${plan.actor}.pendingPlan`]:{plan,cursor:0,cause:event},[`npcs.${plan.actor}.intention`]:plan.label}});
}

export function resumePlan(kernel,s,actor,cause){
  const npc=s.world.npcs[actor],pending=npc.pendingPlan;
  if(!pending)return false;
  if(npc.travel||s.world.player.conversation===actor)return true;
  const {plan}=pending;
  const finish=(status,reason)=>kernel.commit(s,{kind:'decision',actor,title:`${kernel.model.PEOPLE[actor].name}: plan ${status}`,parents:[cause,pending.cause],data:{planStatus:status,planId:plan.id,reason},changes:{[`npcs.${actor}.pendingPlan`]:null,[`npcs.${actor}.intention`]:status==='completed'?`Completed: ${plan.label}`:`Reconsider: ${plan.label}`}});
  if(pending.cursor>=plan.steps.length){finish('completed');return true;}
  const remaining={...plan,steps:plan.steps.slice(pending.cursor)};
  const communication=remaining.steps.find(step=>step.kind==='communicate');
  if(communication&&!plan.sources.includes(npc.beliefs.find(b=>b.key===communication.belief)?.sourceId)){finish('blocked','The source belief changed; choose a fresh plan.');return true;}
  const {audit,event}=recordPlan(kernel,s,remaining,cause);
  if(audit.status!=='allow'){finish('blocked',audit.reason);return true;}
  const record=(step,changes={},kind='action',data={})=>kernel.commit(s,{kind,actor,title:`${kernel.model.PEOPLE[actor].name}: ${step.kind}${step.object?' '+step.object:''}`,parents:[event],data:{step,...data},changes,playerText:kernel.local(s,actor)?`${kernel.model.PEOPLE[actor].name} ${step.kind==='observe'?'looks around.':step.kind==='communicate'?`says: “${data.assertion}”`:`${step.kind==='conceal'?'puts away':step.kind==='give'?'hands over':'takes'} the ${step.object}.`}`:null});
  const transfer=(step,holder)=>{
    const e=record(step,{[`objects.${step.object}`]:holder});
    kernel.remember(s,actor,e);
    kernel.believe(s,actor,`holder_${step.object}`,`After ${step.kind}, ${step.object} is held by ${holder}.`,.99,'observation',e,true);
    for(const [witness,p]of Object.entries(s.world.npcs))if(witness!==actor&&!p.travel&&p.location===npc.location){
      const observation=kernel.commit(s,{kind:'observation',actor:witness,title:`${kernel.model.PEOPLE[witness].name} sees ${kernel.model.PEOPLE[actor].name} ${step.kind} ${step.object}`,parents:[e],data:{subject:actor,object:step.object,observedAction:step.kind,observedLocation:npc.location}});
      kernel.remember(s,witness,observation);
      kernel.believe(s,witness,`holder_${step.object}`,`I saw ${kernel.model.PEOPLE[actor].name} ${step.kind} ${step.object}; its holder became ${holder}.`,.99,'observation',observation,true);
    }
    kernel.afterTransfer?.(s,actor,step,e);
  };
  const handlers={
    observe:step=>{
      const visible=[...new Set([
        ...(kernel.model.LOCATIONS[npc.location].objects??[]).filter(id=>!Object.hasOwn(s.world.objects,id)||s.world.objects[id]===npc.location),
        ...Object.entries(s.world.objects).filter(([,holder])=>holder===npc.location||holder===actor).map(([id])=>id)
      ])];
      const labels=visible.map(id=>kernel.model.OBJECTS?.[id]?.label??id);
      const e=record(step,{},'observation',{observedLocation:npc.location,objects:visible});kernel.remember(s,actor,e);
      kernel.believe(s,actor,`observed_location_${npc.location}`,`At ${kernel.model.LOCATIONS[npc.location].name}, ${labels.length?`I saw ${labels.join(', ')}`:'I looked around'}.`,.99,'observation',e,true);
    },
    communicate:step=>{
      const b=npc.beliefs.find(b=>b.key===step.belief);
      const e=record(step,{},'speech',{listener:step.recipient,assertion:b.text,sourceEvents:[b.sourceId]});
      kernel.remember(s,actor,e);kernel.remember(s,step.recipient,e);
      kernel.believe(s,step.recipient,`report_${actor}_${b.key}`,`${kernel.model.PEOPLE[actor].name} says: ${b.text}`,.75,'testimony',e,null,{speaker:actor});
    },
    take:step=>transfer(step,actor),
    give:step=>transfer(step,step.recipient),
    conceal:step=>transfer(step,step.to),
    store:step=>transfer(step,step.to)
  };
  const result=executePlanStep(kernel,s,remaining,event,handlers);
  if(result.status!=='executed'){finish('blocked',result.reason);return true;}
  const next=pending.cursor+1;
  kernel.commit(s,{kind:'decision',actor,title:'Plan step committed',parents:[event],data:{planStatus:'step_committed',step:pending.cursor},changes:{[`npcs.${actor}.pendingPlan`]:{...pending,cursor:next,cause:event}}});
  // Zero-duration steps run immediately; movement resumes at its actual arrival.
  if(!npc.travel)resumePlan(kernel,s,actor,event);
  return true;
}
