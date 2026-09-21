// The object catalog — the SURFACE layer. An object is data: a name, a narrative injury, and a bundle
// of affordances drawn from the finite grammar in primitives.mjs. This layer is unbounded in principle
// (any object, transformed creatively) while the affordances it references are the bounded, validated
// kernel. The four existing methods are expressed here as affordance bundles, proving the grammar
// subsumes them; new objects (an icicle that melts, a gramophone that fakes presence, a rigged
// chandelier, tampered medicine) are added the same way, and the LLM will eventually propose them.
//
// How each maps to the grammar:
//   seal / candlestick  → harm(blunt) + marks     (a blunt weapon that leaves a matching trace)
//   knife               → harm(sharp) + marks
//   poison (decanter)   → transfer + harm(toxic) + times   (delivers a dose; toxicology fixes the hour)
import {AFFORDANCES,affordanceLeaves} from './primitives.mjs';

export const OBJECTS={
 seal:       {name:'brass seal',         injury:'a blunt impact with an angled brass edge', affords:[{a:'harm',kind:'blunt'},{a:'marks'}]},
 candlestick:{name:'silver candlestick', injury:'a blunt impact with a rounded silver rim',  affords:[{a:'harm',kind:'blunt'},{a:'marks'}]},
 knife:      {name:'pruning knife',      injury:'a deep wound from a narrow steel blade',    affords:[{a:'harm',kind:'sharp'},{a:'marks'}]},
 poison:     {name:'tainted decanter',   injury:'a lethal dose of a bitter alkaloid',        affords:[{a:'transfer'},{a:'harm',kind:'toxic'},{a:'times'}]},
 icicle:     {name:'icicle',              injury:'a blunt impact from a smooth, hard object that left no fragment', affords:[{a:'harm',kind:'blunt'},{a:'marks'},{a:'vanishes'}]},
 scarf:      {name:'silk scarf',          injury:'ligature marks from a soft, broad band', affords:[{a:'harm',kind:'asphyxiant'},{a:'marks'}]},
 chandelier: {name:'chandelier',           injury:'crushing injuries from a heavy fall',    affords:[{a:'harm',kind:'fall'},{a:'marks'},{a:'times'}]},
};

// Fail-closed validation at load: every object may reference only known affordances and harm kinds.
// This keeps the catalog honest against the kernel without constraining how many objects exist.
for(const [id,o] of Object.entries(OBJECTS)){
 if(!o.name||!o.injury||!Array.isArray(o.affords))throw Error(`object ${id}: malformed catalog entry`);
 for(const af of o.affords){
  if(!AFFORDANCES[af.a])throw Error(`object ${id}: unknown affordance "${af.a}"`);
  if(af.a==='harm'&&!AFFORDANCES.harm.kinds.includes(af.kind))throw Error(`object ${id}: unknown harm kind "${af.kind}"`);
 }
}

// An object's evidence signature: the kernel predicates its murder leaves behind.
export const mechanismSignature=id=>({object:id,affords:OBJECTS[id].affords,leaves:affordanceLeaves(OBJECTS[id].affords)});
