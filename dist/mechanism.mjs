// Mechanism = a murder expressed as a causal composition whose evidence-bearing clues are TAGGED with
// affordances from the finite grammar (primitives.mjs). It is the bridge between "any creative object"
// and the validated kernel: a mechanism validates that each affordance-tagged clue leaves exactly the
// predicate its affordance is allowed to leave, then compiles through the same Phase-2 composition
// compiler into brick hooks. So an icicle, a gramophone or a rigged chandelier are all just mechanisms
// over the same finite grammar — unbounded surface, bounded, checkable core.
import {AFFORDANCES} from './primitives.mjs';
import {moduleFromComposition} from './composition.mjs';

// Fail-closed grammar check: an affordance-tagged clue may carry only a claim whose predicate is the
// predicate that affordance leaves. This is what keeps a creative object honest against the kernel.
export function validateMechanism(mech){
 for(const clue of mech.clues??[]){
  if(!clue.affords)continue;
  const spec=AFFORDANCES[clue.affords];
  if(!spec)throw Error(`mechanism ${mech.id}: clue "${clue.id}" declares unknown affordance "${clue.affords}"`);
  const claim=(mech.claims??[]).find(c=>c.clue===clue.id);
  if(claim&&spec.leaves&&claim.predicate!==spec.leaves)
   throw Error(`mechanism ${mech.id}: clue "${clue.id}" affordance "${clue.affords}" leaves ${spec.leaves}, but its claim is ${claim.predicate}`);
 }
 return true;
}

// The set of affordances a mechanism exercises (its "shape").
export const mechanismAffordances=mech=>[...new Set((mech.clues??[]).map(c=>c.affords).filter(Boolean))];

// Compile a mechanism into a brick module. The `affords` tags are metadata for validation + inspection;
// the composition compiler ignores them. `forces` (load-bearing clues) flows straight through.
export function mechanismModule(mech){
 validateMechanism(mech);
 return moduleFromComposition(mech);
}
