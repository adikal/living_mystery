// Bounded search over acquisition actions, not a fixed list of itineraries.
// This abstraction is optimistic about future NPC presence; only actual replay
// authorizes a witness. Exhaustion is unresolved unless the domain is complete.
export function acquisitionDomain(model,world){
 const locked=new Set(world.flags.lockedObjects??[]),gates=model.gates??{},domain=[];
 for(const [location,place]of Object.entries(model.LOCATIONS))for(const object of place.objects){
  if(world.flags.closedLocations?.includes(location))continue;
  // A locked object is skipped UNLESS it is a discovery gate — then it enters the domain gated by its
  // prerequisites (reachability v2: acquire the prerequisite clue, and the hidden object becomes reachable).
  if(locked.has(object)&&!gates[object])continue;
  if(object==='folio'&&world.objects.folio!=='manor')continue;
  if(object==='drawer'&&world.objects.folio!=='drawer')continue;
  if(object==='seal'&&model.CASE.id!=='last-bell'&&world.objects.weapon!==location)continue;
  const clue=model.OBJECTS[object]?.clue;if(clue)domain.push({id:`inspect:${object}`,location,clue,duration:3,requires:gates[object]??[],action:{type:'inspect',object},expires:world.flags.evidenceExpiry?.[clue]??null});
 }
 if(model.CASE.id==='last-bell')domain.push(
  {id:'clara-letter',location:'manor',clue:'clara',requires:['letter'],duration:4,action:{type:'present',person:'clara',clue:'letter',tone:'private'}},
  {id:'silas-alibi',location:'vestry',clue:'alibi',requires:[],duration:3,action:{type:'ask',person:'silas',topic:'alibi'}});
 return domain;
}
export function searchInvestigation(session,runtime,{horizon=180,maxActions=32,maxNodes=16000,maxWitnesses=5}={}){
 // The current distance oracle assumes the whole graph is open. Do not certify
 // paths through closed intermediate locations until blocked-edge routing exists.
 if(session.world.flags.closedLocations?.length)return {status:'unresolved',reason:'Closed-location routing is outside the supported search domain'};
 const model=runtime,domain=acquisitionDomain(model,session.world),goals=model.CASE.proofRoutes;
 const keys=[...new Set([...goals.flatMap(r=>r.all),...domain.flatMap(d=>[d.clue,...d.requires])])];
 if(keys.length>30)return {status:'unresolved',reason:'Evidence domain exceeds bitset budget'};
 const bit=c=>1<<keys.indexOf(c),maskFor=cs=>cs.reduce((m,c)=>keys.includes(c)?m|bit(c):m,0);
 const goalMasks=goals.map(r=>maskFor(r.all)),initial=maskFor(session.world.player.evidence.map(e=>e.clue));
 const relevant=new Set(goals.flatMap(r=>r.all));let changed=true;while(changed){changed=false;for(const d of domain)if(relevant.has(d.clue))for(const c of d.requires)if(!relevant.has(c)){relevant.add(c);changed=true;}}
 const acquisitions=domain.filter(d=>relevant.has(d.clue));
 const heuristic=mask=>Math.min(...goalMasks.map(g=>{let bits=g&~mask,n=0;while(bits){n++;bits&=bits-1;}return n*3;}));
 const start=session.world.minute,queue=[{at:session.world.player.location,mask:initial,cost:0,actions:[]}],seen=new Map();let explored=0,witnesses=0;const failures=[];
 while(queue.length&&explored<maxNodes){
  queue.sort((a,b)=>(a.cost+heuristic(a.mask))-(b.cost+heuristic(b.mask))||a.actions.length-b.actions.length);
  const node=queue.shift(),key=`${node.at}:${node.mask}`;
  if((seen.get(key)??Infinity)<=node.cost)continue;seen.set(key,node.cost);explored++;
  const goal=goalMasks.findIndex(g=>(node.mask&g)===g);
  if(goal!==-1){
   const travel=node.at==='square'?[]:[{type:'move',to:'square'}],cost=node.cost+runtime.distance(node.at,'square');
   const actions=[...node.actions,...travel,{type:'accuse',suspect:model.CASE.culprit,method:model.CASE.method,motive:model.CASE.motive,evidence:keys.filter(c=>(node.mask&bit(c))!==0)}];
   if(cost<=horizon&&actions.length<=maxActions&&witnesses++<maxWitnesses){
    const trial=structuredClone(session);let failed=null;
    for(const action of actions){const before=trial.events.length;runtime.dispatch(trial,action);if(trial.events.slice(before).some(e=>e.kind==='rejected')){failed='Acquisition action rejected during replay';break;}if(trial.world.minute-start>horizon){failed='Replay exceeded time horizon';break;}}
    if(!failed&&trial.world.status==='solved'&&runtime.diagnostics(trial).ok)return {status:'route_found',method:'bounded-acquisition-search-and-engine-replay',route:goals[goal].id,actions,minutes:trial.world.minute-start,horizon,maxActions,maxNodes,explored,assumptions:['Current deterministic scheduling and case rubric','Finite acquisition catalog; real engine witness checked'],scope:'Existential bounded witness, not universal future-agent robustness.'};
    failures.push(failed??'Replay did not solve the case');
   }
  }
  if(node.actions.length>=maxActions-1)continue;
  for(const d of acquisitions){
   if(node.mask&bit(d.clue)||d.requires.some(c=>!(node.mask&bit(c))))continue;
   const travel=runtime.distance(node.at,d.location),cost=node.cost+travel+d.duration;
   if(!Number.isFinite(cost)||cost>horizon||d.expires!==null&&d.expires!==undefined&&start+cost>d.expires)continue;
   const actions=[...node.actions,...(node.at===d.location?[]:[{type:'move',to:d.location}]),d.action];
   if(actions.length>=maxActions)continue;
   queue.push({at:d.location,mask:node.mask|bit(d.clue),cost,actions});
  }
 }
 return {status:'unresolved',method:'bounded-acquisition-search-and-engine-replay',horizon,maxActions,maxNodes,explored,reason:explored>=maxNodes?'Search node budget exhausted':'No replay-validated route in the supported acquisition search',failures,scope:'Incomplete abstraction: no universal impossibility claim.'};
}
export function invariantSignature(world){return JSON.stringify({objects:world.objects,locked:world.flags.lockedObjects??[],closed:world.flags.closedLocations??[],expiry:world.flags.evidenceExpiry??{},time:Object.keys(world.flags.evidenceExpiry??{}).length?world.minute:null});}
