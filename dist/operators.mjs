// Operators — pure artifact -> artifact transforms that deepen a case (docs/depth-operators.md §6).
// Each is coherence-preserving at the structural level (it only adds grounded observations, gates, and
// declared inversions); validity is still enforced by validateCase after the artifact is compiled.
// The deterministic deep generator (M4) and the LLM composer both build a deep artifact by piping these.

const clone=a=>({...a,observations:(a.observations||[]).map(o=>({...o})),routes:a.routes?{all:[...(a.routes.all||[])]}:a.routes,forces:[...(a.forces||[])]});

export const emptyArtifact=(id,bind)=>({id,bind:bind??(()=>({})),observations:[],routes:{all:[]},forces:[],origins:{},resetClaims:[]});

// Add a neutral observation (a clue whose text does not announce its meaning), optionally with the typed
// claim it licenses and a placement. Optionally put it on a proof route.
export function addObservation(artifact,obs,{onRoute=false}={}){
 const a=clone(artifact);a.observations.push({...obs});
 if(onRoute&&!a.routes.all.includes(obs.id))a.routes.all.push(obs.id);
 return a;
}

// Gate a clue behind prerequisite clues (physically hidden until they are acquired). The clue may be one
// of this artifact's own observations or an external clue contributed by another brick (extraGates).
export function gate(artifact,clueId,requires){
 const a=clone(artifact);const o=a.observations.find(o=>o.id===clueId);
 if(o)o.gate={requires:[].concat(requires)};
 else a.extraGates={...(a.extraGates||{}),[clueId]:[].concat(requires)};
 return a;
}

// R1 Interpolate — insert a hidden intermediate observation C so a decisive clue is reached via one more
// hop: C is gated behind `after`, and the decisive clue is re-gated behind C (deepening the chain by one).
export function interpolate(artifact,{id,title,text,at,object,tags,after,decisive}){
 let a=addObservation(artifact,{id,title,text,at,object,tags,gate:{requires:[].concat(after||[])}});
 const d=a.observations.find(o=>o.id===decisive);
 if(d)d.gate={requires:[...new Set([...(d.gate?.requires||[]).filter(r=>!(after||[]).includes(r)),id])]};
 return a;
}

// Mark observations load-bearing (their removal must drop the true accusation's support).
export function forceClues(artifact,ids){const a=clone(artifact);for(const id of [].concat(ids))if(!a.forces.includes(id))a.forces.push(id);return a;}

// C3 Declare the inversion: the reachable anchor that flips a coherent-but-wrong naive reading.
export function declareInversion(artifact,{anchor,naive,reReads}){const a=clone(artifact);a.inversion={anchor,naive,reReads:[].concat(reReads||[])};return a;}

// Move a claim's grounding onto an existing occurrence (e.g., toxicology grounded on the examination).
export function groundOn(artifact,clueId,occurrenceType){const a=clone(artifact);a.origins={...a.origins,[clueId]:occurrenceType};return a;}

// Reset a base clue's claims before an observation re-states them (e.g., strip the death_time off medical).
export function resetClaims(artifact,clueIds){const a=clone(artifact);a.resetClaims=[...new Set([...(a.resetClaims||[]),...[].concat(clueIds)])];return a;}

export const pipe=(artifact,...ops)=>ops.reduce((a,op)=>op(a),artifact);
