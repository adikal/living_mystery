// Bounded search over acquisition actions, not a fixed list of itineraries.
// This abstraction is optimistic about future NPC presence; only actual replay
// authorizes a witness. Exhaustion is unresolved unless the domain is complete.
export function acquisitionCatalog(model, world) {
 const locked=new Set(world.flags.lockedObjects??[]),gates=model.investigationGates??model.gates??{},entries=[],incomplete=[];
 let physicalCatalogSize=0;
 for(const [listedAt,place]of Object.entries(model.LOCATIONS))for(const object of place.objects){
  const item=model.OBJECTS[object],clue=item?.clue;if(!clue){incomplete.push(`physical:${object}:missing-clue`);continue;}physicalCatalogSize++;
  const location=item.follows?(world.npcs[item.follows]?.travel?.to??world.npcs[item.follows]?.location):listedAt;
  if(!model.LOCATIONS[location]){incomplete.push(`physical:${object}:missing-location`);continue;}
  if(world.flags.closedLocations?.includes(location))continue;
  // A locked object is skipped UNLESS it is a discovery gate — then it enters the domain gated by its
  // prerequisites (reachability v2: acquire the prerequisite clue, and the hidden object becomes reachable).
  if(locked.has(object)&&!gates[object])continue;
  if(object==='folio'&&world.objects.folio!=='manor')continue;
  if(object==='drawer'&&world.objects.folio!=='drawer')continue;
  if(object==='seal'&&model.CASE.id!=='last-bell'&&world.objects.weapon!==location)continue;
  entries.push({id:`inspect:${object}`,kind:'physical',location,clue,duration:3,requires:gates[object]??[],action:{type:'inspect',object},expires:world.flags.evidenceExpiry?.[clue]??null});
 }
 const testimony=model.testimonyClues??[];
 // A plain string names a testimony clue without saying who gives it or how (the hand-authored cases); it has no
 // acquisition action of its own, so it is not part of the searchable catalog (Last Bell's are listed below).
 const described=testimony.filter(account=>account&&typeof account==='object');
 for(const account of described){
  const clue=account.clue??account.id,speaker=account.speaker,topic=account.topic??account.id;
  const npc=world.npcs[speaker],location=account.location??npc?.travel?.to??npc?.location;
  if(!clue||!speaker||!topic||!model.LOCATIONS[location]){incomplete.push(`testimony:${clue??account.id??'unknown'}:missing-speaker-or-location`);continue;}
  if(world.flags.closedLocations?.includes(location))continue;
  entries.push({id:`ask:${speaker}:${topic}`,kind:'testimony',location,clue,duration:account.duration??3,
   requires:account.requires??[],action:{type:'ask',person:speaker,topic},expires:account.expires??null});
 }
 if(model.CASE.id==='last-bell')entries.push(
  {id:'clara-letter',kind:'testimony',location:'manor',clue:'clara',requires:['letter'],duration:4,action:{type:'present',person:'clara',clue:'letter',tone:'private'}},
  {id:'silas-alibi',kind:'testimony',location:'vestry',clue:'alibi',requires:[],duration:3,action:{type:'ask',person:'silas',topic:'alibi'}});
 return {entries,physicalCatalogSize,testimonyCatalogSize:described.length+(model.CASE.id==='last-bell'?2:0),usablePhysicalCount:entries.filter(x=>x.kind==='physical').length,
  usableTestimonyCount:entries.filter(x=>x.kind==='testimony').length,incomplete};
}
export function acquisitionDomain(model,world){return acquisitionCatalog(model,world).entries;}
const counts=actions=>actions.reduce((out,action)=>(out[action.type]=(out[action.type]??0)+1,out),{});
export function searchInvestigation(session,runtime,{horizon=180,maxActions=32,maxNodes=16000,maxWitnesses=5}={}){
 // The current distance oracle assumes the whole graph is open. Do not certify
 // paths through closed intermediate locations until blocked-edge routing exists.
 if(session.world.flags.closedLocations?.length)return {status:'unresolved',reason:'Closed-location routing is outside the supported search domain'};
 const model=runtime,catalog=acquisitionCatalog(model,session.world),domain=catalog.entries,goals=model.CASE.proofRoutes??[];
 const catalogReport={physicalCatalogSize:catalog.physicalCatalogSize,testimonyCatalogSize:catalog.testimonyCatalogSize,
  usablePhysicalCount:catalog.usablePhysicalCount,usableTestimonyCount:catalog.usableTestimonyCount,catalogIncomplete:catalog.incomplete};
 const unresolved=(reason,extra={})=>({status:'unresolved',method:'bounded-acquisition-search-and-engine-replay',horizon,maxActions,maxNodes,
  explored:0,failures:[],replayFailures:0,...catalogReport,reason,...extra,scope:'Incomplete abstraction: no universal impossibility claim.'});
 if(!goals.length)return unresolved('No mechanically supported evidence goal is available');
 const relevant=new Set(goals.flatMap(r=>r.all));let changed=true;while(changed){changed=false;for(const d of domain)if(relevant.has(d.clue))for(const c of d.requires)if(!relevant.has(c)){relevant.add(c);changed=true;}}
 const acquisitions=domain.filter(d=>relevant.has(d.clue));
 const keys=[...relevant];
 if(keys.length>30)return unresolved('Evidence domain exceeds bitset budget',{evidenceKeyCount:keys.length});
 const bit=c=>1<<keys.indexOf(c),maskFor=cs=>cs.reduce((m,c)=>keys.includes(c)?m|bit(c):m,0);
 const goalMasks=goals.map(r=>maskFor(r.all)),initial=maskFor(session.world.player.evidence.map(e=>e.clue));
 const heuristic=mask=>Math.min(...goalMasks.map(g=>{let bits=g&~mask,n=0;while(bits){n++;bits&=bits-1;}return n*3;}));
 const start=session.world.minute,queue=[{at:session.world.player.location,mask:initial,cost:0,actions:[]}],seen=new Map();let explored=0,witnesses=0;const failures=[];
 while(queue.length&&explored<maxNodes){
  queue.sort((a,b)=>(a.cost+heuristic(a.mask))-(b.cost+heuristic(b.mask))||a.actions.length-b.actions.length);
  const node=queue.shift(),key=`${node.at}:${node.mask}`;
  if((seen.get(key)??Infinity)<=node.cost)continue;seen.set(key,node.cost);explored++;
  const goal=goalMasks.findIndex(g=>(node.mask&g)===g);
  if(goal!==-1){
   const post=session.world.npcs[model.CASE.constable]?.location;   // the accusation is heard where the constable is
   const travel=node.at===post?[]:[{type:'move',to:post}],cost=node.cost+runtime.distance(node.at,post);
   const selectedEvidence=keys.filter(c=>(node.mask&bit(c))!==0);
   const actions=[...node.actions,...travel,{type:'accuse',suspect:model.CASE.culprit,method:model.CASE.method,motive:model.CASE.motive,evidence:selectedEvidence}];
   if(cost<=horizon&&actions.length<=maxActions&&witnesses++<maxWitnesses){
    const trial=structuredClone(session);let failed=null;
    for(const action of actions){const before=trial.events.length;runtime.dispatch(trial,action);if(trial.events.slice(before).some(e=>e.kind==='rejected')){failed='Acquisition action rejected during replay';break;}if(trial.world.minute-start>horizon){failed='Replay exceeded time horizon';break;}}
    if(!failed&&trial.world.status==='solved'&&runtime.diagnostics(trial).ok){
     const testimonyEvidence=[...new Set(actions.filter(a=>a.type==='ask').map(a=>domain.find(d=>d.action.type==='ask'&&d.action.person===a.person&&d.action.topic===a.topic)?.clue).filter(Boolean))];
     return {status:'route_found',method:'bounded-acquisition-search-and-engine-replay',route:goals[goal].id,actions,actionCounts:counts(actions),minutes:trial.world.minute-start,
      selectedEvidence,testimonyEvidence,testimonyAcquired:testimonyEvidence.some(id=>trial.world.player.evidence.some(e=>e.clue===id)),horizon,maxActions,maxNodes,explored,
      failures,replayFailures:failures.length,...catalogReport,assumptions:['Current deterministic scheduling and case rubric','Finite acquisition catalog; real engine witness checked'],
      scope:'Existential bounded witness, not universal future-agent robustness.'};
    }
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
 const reason=explored>=maxNodes?'Search node budget exhausted':catalog.incomplete.length?'Acquisition catalog incomplete; no replay-validated route in the supported search':'No replay-validated route in the supported acquisition search';
 return unresolved(reason,{explored,failures,replayFailures:failures.length,evidenceKeyCount:keys.length});
}
export function invariantSignature(world){return JSON.stringify({objects:world.objects,locked:world.flags.lockedObjects??[],closed:world.flags.closedLocations??[],expiry:world.flags.evidenceExpiry??{},time:Object.keys(world.flags.evidenceExpiry??{}).length?world.minute:null});}
