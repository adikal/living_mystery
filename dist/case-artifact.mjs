// The case artifact — the reduction target for deep cases (docs/depth-operators.md).
//
// An artifact is pure data describing the fact-bearing spine of a case as the LLM/composer will emit it:
// neutral OBSERVATIONS (clues whose text does not announce their meaning), each grounded and each carrying
// the typed CLAIM it licenses (with `requires` for multi-hop inference), optional DISCOVERY GATES
// (an observation's object stays locked until prerequisites are acquired), the load-bearing observations
// (`forces`), and a declared INVERSION (a coherent-but-wrong naive reading + the reachable anchor that
// flips it). It compiles into an ordinary brick via the composition compiler, so it rides the existing
// engine (validateCase, reachability, NPC/dialogue) rather than a parallel one. Depth metadata (gates,
// inversion, hop-depth) is attached for the depth obligations in casegen.
import {moduleFromComposition} from './composition.mjs';

// Compile an artifact into a brick module (+ an `.artifact` metadata handle for the depth obligations).
export function artifactModule(artifact){
  const clues=[],claims=[];
  for(const o of artifact.observations??[]){
    clues.push({id:o.id,title:o.title??o.id,text:o.text,tags:o.tags,meta:o.meta,at:o.at,object:o.object});
    if(o.claim)claims.push({clue:o.id,...o.claim});
  }
  const comp={
    id:artifact.id,
    requires:artifact.requires,
    bind:artifact.bind??(()=>({})),
    clues,claims,
    resetClaims:artifact.resetClaims,
    origins:artifact.origins,
    routes:artifact.routes,
    methodOptions:artifact.methodOptions,
    synopsis:artifact.synopsis,
    occurrences:artifact.occurrences,
    dialogue:artifact.dialogue,
    forces:artifact.forces?(ctx=>(typeof artifact.forces==='function'?artifact.forces(ctx):artifact.forces)):undefined,
    invariant:artifact.invariant
  };
  const mod=moduleFromComposition(comp);
  // Depth metadata consumed by the obligations (M2/M3) and the runtime gate hook (M2).
  mod.artifact={
    gates:[...(artifact.observations??[]).filter(o=>o.gate).map(o=>({clue:o.id,requires:[].concat(o.gate.requires||[])})),
           ...Object.entries(artifact.extraGates||{}).map(([clue,requires])=>({clue,requires:[].concat(requires)}))],
    inversion:artifact.inversion??null,
    // A rough inference-hop depth per clue: 1 + number of clues it requires (multi-hop chains score higher).
    hops:Object.fromEntries((artifact.observations??[]).map(o=>[o.id,1+([].concat(o.claim?.requires||o.claim?.requiresAny||[])).length])),
  };
  return mod;
}

// Aggregate the artifact metadata attached to a case's composed modules (used by the depth obligations).
export function caseArtifacts(caseModule){
  return (caseModule.model.modules??[]).map(m=>m.module?.artifact).filter(Boolean);
}

// Safely expand an LLM-emitted artifact JSON into an artifact object. To stay certifiable-by-construction,
// LLM observations are NEUTRAL discovery stepping-stones (no claims of their own — grounding stays the
// engine's job); the model only invents their prose, the discovery-gate chain onto an existing FORCED
// anchor clue, and the inversion framing. Anything malformed throws (the composer repairs or falls back).
const DEEP_LOCS=['square','manor','inn','greenhouse','vestry','surgery'];
export function expandArtifact(json,{id='llm-art',locations=DEEP_LOCS}={}){
  if(!json||typeof json!=='object')throw Error('artifact is not an object');
  const obs=Array.isArray(json.observations)?json.observations:[];
  if(obs.length<2||obs.length>6)throw Error('need 2–6 observations');
  const observations=obs.map(o=>{
    if(!o||typeof o.id!=='string'||!/^[a-z][a-z0-9_]{1,24}$/.test(o.id))throw Error(`bad observation id: ${o&&o.id}`);
    if(typeof o.text!=='string'||!o.text.trim()||o.text.length>240)throw Error(`bad observation text for ${o.id}`);
    const at=locations.includes(o.at)?o.at:'manor';
    const title=(typeof o.title==='string'&&o.title.trim()?o.title:o.id).slice(0,60);
    return {id:o.id,title,text:o.text,tags:['Trace'],meta:{kind:'Physical trace'},at,object:{label:title.toLowerCase().slice(0,48),description:`Examine ${title.toLowerCase()}`}};
  });
  const ownIds=new Set(observations.map(o=>o.id));
  const extraGates={};
  for(const [clue,reqs] of Object.entries(json.gates&&typeof json.gates==='object'?json.gates:{})){
    const rr=[].concat(reqs).filter(x=>typeof x==='string');
    if(ownIds.has(clue)){observations.find(o=>o.id===clue).gate={requires:rr};}
    else extraGates[clue]=rr;
  }
  const forces=(Array.isArray(json.forces)?json.forces:[]).filter(x=>typeof x==='string');
  if(!forces.length)throw Error('artifact declares no load-bearing (forces) clue');
  const iv=json.inversion;
  const inversion=iv&&typeof iv==='object'&&typeof iv.anchor==='string'
    ?{anchor:iv.anchor,naive:String(iv.naive||'').slice(0,180),reReads:(Array.isArray(iv.reReads)?iv.reReads:[]).filter(x=>typeof x==='string')}
    :null;
  if(!inversion)throw Error('artifact declares no inversion');
  return {id,observations,extraGates,forces,inversion,bind:()=>({})};
}
