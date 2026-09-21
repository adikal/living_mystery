// The primitive algebra — the human-authored, versioned kernel of trust for the mystery model.
// Design: docs/primitive-algebra.md. Everything the engine certifies reduces to these primitives.
// Compositions (today's bricks; tomorrow's LLM-proposed cases) may combine primitives without limit
// but may NOT redefine them or their entailment — an oracle cannot be produced by the thing it
// validates. A primitive names no specific noun; concrete people/places/objects come from a composition.
import {expr as x,term as v} from './symbolic.mjs';
export const PRIMITIVE_ALGEBRA_VERSION=1;

// Typed entity ontology every primitive ranges over.
export const ENTITY_SORTS=['person','place','object','document','time','belief'];

const eq=(a,b)=>x('eq',a,b),and=(...a)=>x('and',...a),not=a=>x('not',a);
// Index of a label within a declared dimension's finite domain.
export const IDX=(model,dim,label)=>model.variables[dim].labels.indexOf(label);

// Constraint primitives: the physics/epistemics reduced to the shared finite IR (eq/ge/le/and/not over
// integer variables). A claim predicate is a thin composition of these.
export const CONSTRAINT={
 // A ranged variable lies within an interval (e.g. the death-time window).
 within:(varName,interval)=>and(x('ge',v(varName),interval.start),x('le',v(varName),interval.end)),
 // A dimension equals / does not equal a labelled value.
 is:(model,dim,label)=>eq(v(dim),IDX(model,dim,label)),
 isNot:(model,dim,label)=>not(eq(v(dim),IDX(model,dim,label))),
 // A subject placed elsewhere over an interval cannot be the killer inside the travel-padded window.
 elsewhere:(model,subject,place,interval)=>not(and(eq(v('suspect'),IDX(model,'suspect',subject)),x('ge',v('time'),interval.start-(model.travel[place]??0)+1),x('le',v('time'),interval.end+(model.travel[place]??0)-1))),
 // A subject is the sole party present through an interval (an authoritative opportunity witness).
 soleAt:(model,subject,interval)=>and(eq(v('suspect'),IDX(model,'suspect',subject)),x('ge',v('time'),interval.start),x('le',v('time'),interval.end)),
 // As soleAt, but the interval was read on an offset (uncalibrated) clock and must be shifted.
 soleAtOffset:(model,subject,interval,offset)=>and(eq(v('suspect'),IDX(model,'suspect',subject)),x('ge',v('time'),interval.start-offset),x('le',v('time'),interval.end-offset)),
};

// Claim predicates as compositions of the constraint primitives. Each returns a finite constraint, or
// null when the claim adds none (a parameter-only claim, or a comparison whose partner isn't selected).
// Adding an evidence type is one entry here.
export const PREDICATE_COMPILERS={
 death_time:(c)=>CONSTRAINT.within('time',c.interval),
 location:(c,model)=>c.value==='manor'?null:CONSTRAINT.elsewhere(model,c.subject,c.value,c.interval),
 crime_method:(c,model)=>CONSTRAINT.is(model,'method',c.value),
 crime_motive:(c,model,{selected})=>{if(c.requires&&!selected.includes(c.requires))return null;if(c.requiresAny&&!c.requiresAny.some(id=>selected.includes(id)))return null;return CONSTRAINT.is(model,'motive',c.value);},
 // Narrowing predicates only *exclude* one value of a dimension; several intersect, none pins alone.
 motive_class:(c,model)=>CONSTRAINT.isNot(model,'motive',c.value),
 method_class:(c,model)=>CONSTRAINT.isNot(model,'method',c.value),
 // A trace comparison requires both independent records; neither half suffices.
 trace_match:(c,model,{selected})=>selected.includes(c.requires)?CONSTRAINT.is(model,'method',c.value):null,
 exclusive_opportunity:(c,model)=>CONSTRAINT.soleAt(model,c.subject,c.interval),
 clock_opportunity:(c,model,{selected,collected})=>{if(!selected.includes(c.requires))return null;const offset=collected.find(o=>o.predicate==='clock_offset'&&o.evidence===c.requires)?.value;return Number.isInteger(offset)?CONSTRAINT.soleAtOffset(model,c.subject,c.interval,offset):null;},
 // Manner-of-death: a coroner finding pins manner to murder, excluding the staged accident.
 manner_evidence:(c,model)=>CONSTRAINT.is(model,'manner',c.value),
 // clock_offset is a parameter consumed by clock_opportunity, not a standalone constraint.
 clock_offset:()=>null,
};

// Occurrence → entailed facts. The prehistory records typed occurrences; this is how a recorded
// occurrence grounds the belief/claim it can legitimately support (used by the epistemic validator).
export function occurrenceFacts(event){
 const d=event.data,f=[];
 if(d.occurrence==='fatal_action')f.push(['killing',event.actor,d.method,d.deathMinute]);
 if(d.occurrence==='appointment_observation')for(const person of d.people)f.push(['location',person,'greenhouse',d.start,d.end]);
 if(d.occurrence==='examination')f.push(['death_time','edmund',d.deathMinute-4,d.deathMinute+4],['injury',d.method]);
 if(d.occurrence==='clock_check')f.push(['clock_offset',d.offset]);
 if(d.occurrence==='entrance_watch')f.push(['sole_admittance',d.subject,d.start,d.end]);
 if(d.occurrence==='document_observation')f.push(['document_location','folio','manor']);
 if(d.occurrence==='report')f.push(['said',event.actor,d.listener,d.assertion]);
 return f;
}

// ── Affordance grammar (v1) ─────────────────────────────────────────────────────────────────────
// The finite vocabulary of what an object can DO in a crime. Objects (unbounded — see objects.mjs)
// declare which affordances they exercise; a mechanism wires them into a causal chain. Every affordance
// REDUCES to a validated kernel predicate (the `leaves` field), so a murder built from any arbitrary
// object still projects onto the decidable IR the solver checks. This is the seam that lets creativity
// explode at the object/narrative layer while correctness stays bounded here. Growing this vocabulary is
// a deliberate, human-authored, versioned act — never the LLM's, or the oracle collapses.
export const AFFORDANCE_VERSION=1;
export const HARM_KINDS=['blunt','sharp','toxic','asphyxiant','thermal','electrical','ballistic','fall'];
export const AFFORDANCES={
 harm:    {role:'inflicts the fatal injury',                kinds:HARM_KINDS, leaves:'trace_match'},
 transfer:{role:'moves a lethal substance into the victim', leaves:'trace_match'},
 times:   {role:'fixes when the fatal act occurred',        leaves:'death_time'},
 gates:   {role:'controls who could reach the victim',      leaves:'exclusive_opportunity'},
 marks:   {role:'links an object to an actor or place',     leaves:'trace_match'},
 conceals:{role:'stages or hides the true manner of death', leaves:'manner_evidence'},
 vanishes:{role:'the object/weapon itself is not recoverable', leaves:null},
 fakes:   {role:'manufactures apparent presence or time',   leaves:null},
};
// The set of kernel predicates an affordance bundle leaves behind — the bridge from an object to the IR.
export function affordanceLeaves(affords){
 const out=new Set();
 for(const af of affords){const spec=AFFORDANCES[af.a];if(spec&&spec.leaves)out.add(spec.leaves);}
 return [...out];
}
