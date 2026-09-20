// Module registry + composer. Adding a narrative brick = importing it here and
// listing it in MODULES. activeModules(spec) resolves the bricks whose slots the
// specification fills, each with its binding and the shared role assignment.
import {resolveRoles} from './contract.mjs';
import {misdirection} from './misdirection.mjs';
import {correction} from './correction.mjs';
import {secretAffair} from './secret-affair.mjs';
import {concealment} from './concealment.mjs';
import {mannerOfDeath} from './manner-of-death.mjs';

// Order matters only for dialogue precedence: correction is registered after
// misdirection so its withdrawal line overrides the original sighting once made.
export const MODULES=[misdirection,correction,secretAffair,concealment,mannerOfDeath];

export function activeModules(spec){
  const roles=resolveRoles(spec);
  const bound=[];
  for(const module of MODULES){const binding=module.bind(spec);if(binding)bound.push({module,binding,roles});}
  // Order honoring `requires`: a depended-on brick composes first. Registry order
  // is otherwise preserved. Missing (inactive) dependencies are simply skipped.
  const byId=new Map(bound.map(b=>[b.module.id,b])),ordered=[],seen=new Set();
  const visit=b=>{if(seen.has(b.module.id))return;seen.add(b.module.id);for(const dep of b.module.requires??[]){const d=byId.get(dep);if(d)visit(d);}ordered.push(b);};
  for(const b of bound)visit(b);
  return ordered;
}
