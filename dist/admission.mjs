import {searchInvestigation,invariantSignature} from './investigation.mjs';
// Guaranteed domain for authored configurations: persistent inspected evidence,
// declared locks/expiry, public travel graph, and a reserved constable. This does
// not claim coverage of arbitrary generated effects or future nondeterminism.
export function assessTransition(runtime,base,candidate,options={}){
 // Mystery-kernel cases are certified before play (docs/mystery-kernel.md): evidence access only grows and no
 // character holds a plan that can move or destroy evidence, so solvability cannot be lost during play.
 if(runtime.kernel?.model?.kernelCase)return {status:'allow',reason:'Certified kernel case: monotone evidence access',checked:0};
 let previous=base.world,checked=0;
 // Intermediate changes to access, possession or deadlines also require a witness.
 for(const event of candidate.events.slice(base.events.length)){
  if(!event.changes.some(p=>p.path.startsWith('objects.')||p.path.startsWith('flags.')||p.path==='minute'&&Object.keys(previous.flags.evidenceExpiry??{}).length))continue;
  const world=runtime.worldAt(candidate,event.index);
  // A mid-move prefix (player in transit) is not a committable resting state and
  // cannot be routed from; its persistent effects are re-checked at a resting
  // prefix or at the turn-end terminal check below. Skipping avoids spuriously
  // deferring a harmless move that merely coincides with an NPC's object change.
  if(world.player.location==='transit'){previous=world;continue;}
  if(invariantSignature(previous)===invariantSignature(world)){previous=world;continue;}
  const prefix={...candidate,world,events:candidate.events.slice(0,event.index+1)};
  const witness=searchInvestigation(prefix,runtime,options);checked++;
  if(witness.status!=='route_found')return {status:'defer',reason:'No validated investigation remains after an intermediate effect',eventId:event.id,witness};
  previous=world;
 }
 if(candidate.world.status==='solved')return {status:'allow',reason:'Supported terminal state',checked};
 const witness=searchInvestigation(candidate,runtime,options);checked++;
 return witness.status==='route_found'?{status:'allow',reason:'A bounded executable investigation remains',witness,checked}:{status:'defer',reason:'No validated investigation route; effects were not committed',witness,checked};
}
export function guardedDispatch(runtime,session,action){
 const trial=structuredClone(session);runtime.dispatch(trial,action);
 const health=runtime.diagnostics(trial);if(!health.ok)throw Error(health.errors[0]);
 const audit=assessTransition(runtime,session,trial);
 if(audit.status==='allow'){runtime.commit(trial,{kind:'decision',actor:'world',title:'Investigation invariant preserved',data:{admission:audit}});session.world=trial.world;session.events=trial.events;}
 else runtime.commit(session,{kind:'rejected',actor:'world',title:'Action deferred by investigation constraints',data:{admission:audit},playerText:'That action cannot be completed while preserving the investigation. Its time and effects have not been applied.'});
 return session;
}
export function filterPlans(runtime,session,plans){
 return plans.filter(plan=>{
  const projected=structuredClone(session);
  // Check concrete effects without telling the character which hidden evidence
  // matters. Execution still rechecks the full turn and actual action effects.
  for(const step of plan.steps){
   if(step.kind==='move'&&runtime.kernel.model.commitments?.[plan.actor]?.location&&step.to!==runtime.kernel.model.commitments[plan.actor].location)return false;
   if(step.kind==='take')projected.world.objects[step.object]=plan.actor;
   if(['store','conceal'].includes(step.kind))projected.world.objects[step.object]=step.to;
   if(step.kind==='give')projected.world.objects[step.object]=step.recipient;
  }
  // A preview with changed state is only a search hypothesis; make it replayable
  // before using any witness as evidence of admission.
  const changes={};for(const [object,holder]of Object.entries(projected.world.objects))if(holder!==session.world.objects[object])changes[`objects.${object}`]=holder;
  projected.world=structuredClone(session.world);
  if(Object.keys(changes).length)runtime.commit(projected,{kind:'decision',actor:plan.actor,title:'Plan effect hypothesis',changes,data:{hypothetical:true}});
  return searchInvestigation(projected,runtime).status==='route_found';
 });
}
