import {validateStep} from './actions.mjs';
// Versioned, solver-neutral finite integer/Boolean constraint language.
// No executable strings, world patches, or case-specific solver code.
export const SYMBOLIC_VERSION=1;
export const term=(name)=>({var:name});
export const expr=(op,...args)=>({op,args});
export function evaluate(node,values){
  if(typeof node==='number'||typeof node==='boolean')return node;
  if(node&&Object.keys(node).length===1&&typeof node.var==='string'){
    if(!Object.hasOwn(values,node.var))throw Error('Unknown variable');return values[node.var];
  }
  if(!node||Object.keys(node).sort().join(',')!=='args,op'||!Array.isArray(node.args))throw Error('Unsupported expression');
  const a=node.args.map(x=>evaluate(x,values));
  switch(node.op){
    case 'eq':return a.length===2&&typeof a[0]===typeof a[1]&&a[0]===a[1];
    case 'ge':return a.length===2&&a[0]>=a[1];
    case 'le':return a.length===2&&a[0]<=a[1];
    case 'add':if(a.every(x=>typeof x==='number'))return a.reduce((x,y)=>x+y,0);break;
    case 'and':if(a.every(x=>typeof x==='boolean'))return a.every(Boolean);break;
    case 'or':if(a.every(x=>typeof x==='boolean'))return a.some(Boolean);break;
    case 'not':if(a.length===1&&typeof a[0]==='boolean')return !a[0];break;
  }
  throw Error('Unsupported expression');
}

/** Compile a sequential plan to explicit finite-state transitions and linear time constraints.
 * Actions describe both preconditions and effects. Concrete execution adapters consume
 * the same steps; the solver only answers feasibility under the named assumptions.
 */
export function compilePlan({actor,location,objects,knowledge,locations,distances,steps,minute,horizon=120,sourceEvents=[],participants=null,containers=null}){
  if(!Array.isArray(steps)||steps.length<1||steps.length>8)throw Error('Use 1–8 plan steps');
  const placeIds=Object.keys(locations),values=Object.fromEntries(placeIds.map((p,i)=>[p,i]));
  const symbols=[...new Set([...placeIds,actor,...Object.values(objects),...steps.flatMap(s=>[s.to,s.from,s.object,s.recipient]).filter(Boolean)])];
  const code=x=>{const n=symbols.indexOf(x);if(n<0)throw Error('Unknown symbol');return n;};
  const variables={},witness={},constraints=[],assumptions=[];
  function variable(id,value){variables[id]={sort:'int',min:0,max:1000000};witness[id]=value;return term(id);}
  function rule(id,label,formula,sources=sourceEvents){constraints.push({id,label,formula,sources:[...new Set(sources.filter(Boolean))]});}
  let at=location,clock=minute,held={...objects};
  variable('t0',clock);variable('loc0',code(at));
  rule('initial_time','Plan starts at the recorded time',expr('eq',term('t0'),minute));
  rule('initial_location','Actor starts at the recorded location',expr('eq',term('loc0'),code(at)));
  for(const [key,value]of Object.entries(held)){variable(`obj_${key}_0`,code(value));rule(`initial_${key}`,`Recorded holder of ${key}`,expr('eq',term(`obj_${key}_0`),code(value)));}
  steps.forEach((step,i)=>{
    validateStep(step);
    const n=i+1,prefix=`step${n}`,oldAt=at,oldHeld={...held};let duration=0;
    const condition=(suffix,label,formula)=>rule(`${prefix}_${suffix}`,label,formula,step.sources??sourceEvents);
    if(step.kind==='move'){
      if(!Object.hasOwn(values,step.to))throw Error('Unknown destination');
      duration=distances[`${at}:${step.to}`];
      if(!Number.isInteger(duration)||duration<0)throw Error('Unreachable destination');
      if(step.duration!==undefined)duration=step.duration;
      condition('travel',`Travel from ${at} to ${step.to} requires ${distances[`${at}:${step.to}`]} minutes`,expr('eq',duration,distances[`${at}:${step.to}`]));at=step.to;
    }else if(step.kind==='take'){
      if(!Object.hasOwn(held,step.object))throw Error('Unknown object');
      condition('access',`${step.object} must be at ${step.from}`,expr('eq',term(`obj_${step.object}_${i}`),code(step.from)));
      condition('location',`Actor must be at ${step.from} to take ${step.object}`,expr('eq',term(`loc${i}`),code(step.from)));held[step.object]=actor;
    }else if(['store','conceal','give'].includes(step.kind)){
      if(!Object.hasOwn(held,step.object)||!Object.hasOwn(values,step.location))throw Error('Unknown store target');
      condition('possession',`Actor must carry ${step.object}`,expr('eq',term(`obj_${step.object}_${i}`),code(actor)));
      condition('location',`Actor must be at ${step.location}`,expr('eq',term(`loc${i}`),code(step.location)));if(step.kind==='give'){
        if(participants&&!Object.hasOwn(participants,step.recipient))throw Error('Unknown recipient');
        if(i===0)condition('recipient','Recipient must be present for transfer',participants?participants[step.recipient]?.location===at&&!participants[step.recipient]?.travel:step.recipientPresent===true);
        else assumptions.push({id:`${prefix}_meeting`,text:`${step.recipient} must be present at execution; transfer rechecks this.`});
        held[step.object]=step.recipient;
      }else{
        if(containers&&containers[step.to]!==step.location)throw Error('Unknown or inaccessible container');
        held[step.object]=step.to;
      }
    }else if(step.kind==='observe'){
      if(!Object.hasOwn(values,step.location))throw Error('Unknown observation location');
      condition('location','Observation requires physical presence',expr('eq',term(`loc${i}`),code(step.location)));
      if(step.object){
        if(!Object.hasOwn(held,step.object))throw Error('Unknown object');
        condition('access','Observation requires a visible object',expr('or',expr('eq',term(`obj_${step.object}_${i}`),code(step.location)),expr('eq',term(`obj_${step.object}_${i}`),code(actor))));
      }
    }else if(step.kind==='communicate'){
      if(!Object.hasOwn(values,step.location)||!step.recipient)throw Error('Invalid communication');
      condition('knowledge',`Actor must have the source belief ${step.belief}`,knowledge.includes(step.belief));
      condition('location',`Speaker must reach ${step.location}`,expr('eq',term(`loc${i}`),code(step.location)));
      // Future recipient presence is an expectation, never remote knowledge.
      if(participants&&!Object.hasOwn(participants,step.recipient))throw Error('Unknown recipient');
      if(i===0)condition('recipient','Recipient must be present for immediate communication',participants?participants[step.recipient]?.location===at&&!participants[step.recipient]?.travel:step.recipientPresent===true);
      else assumptions.push({id:`${prefix}_meeting`,text:`${step.recipient} must be present at ${step.location} when communication is attempted; execution rechecks this.`});
    }else throw Error(`Unsupported action: ${step.kind}`);
    if(!Number.isInteger(duration)||duration<0||duration>120)throw Error('Invalid duration');
    clock+=duration;variable(`t${n}`,clock);variable(`loc${n}`,code(at));
    condition('time','Actions execute sequentially',expr('eq',term(`t${n}`),expr('add',term(`t${i}`),duration)));
    condition('effect_location',step.kind==='move'?`Arrive at ${at}`:`Remain at ${oldAt}`,expr('eq',term(`loc${n}`),step.kind==='move'?code(at):term(`loc${i}`)));
    for(const key of Object.keys(held)){
      variable(`obj_${key}_${n}`,code(held[key]));
      condition(`effect_${key}`,`${key} holder after step ${n}`,expr('eq',term(`obj_${key}_${n}`),held[key]===oldHeld[key]?term(`obj_${key}_${i}`):code(held[key])));
    }
  });
  rule('horizon',`Plan must finish within ${horizon} minutes`,expr('le',term(`t${steps.length}`),minute+horizon));
  const query={version:SYMBOLIC_VERSION,kind:'plan-feasibility',perspective:'world',variables,constraints,assumptions,horizon,minute};
  const failures=constraints.filter(c=>evaluate(c.formula,witness)!==true);
  return {query,witness,failures,projected:{location:at,objects:held,minute:clock}};
}
