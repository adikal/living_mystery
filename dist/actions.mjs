// Shared, closed action vocabulary. Inputs describe actions, never world patches.
export const ACTION_CONTRACTS=Object.freeze({
  activity:{fields:['location','task'],optional:['duration','deadline'],duration:'activity',effects:['time','life']},
  move:{fields:['to'],optional:['duration'],duration:'route',effects:['location']},
  observe:{fields:['location'],optional:['object'],duration:0,effects:['memory','belief']},
  communicate:{fields:['recipient','location','belief'],optional:['recipientPresent'],duration:0,effects:['speech','testimony']},
  take:{fields:['object','from'],optional:[],duration:0,effects:['holder']},
  give:{fields:['object','recipient','location'],optional:['recipientPresent'],duration:0,effects:['holder']},
  conceal:{fields:['object','location','to'],optional:[],duration:0,effects:['holder']},
  store:{fields:['object','location','to'],optional:[],duration:0,effects:['holder']}
});
export function validateStep(step){
  const contract=ACTION_CONTRACTS[step?.kind];
  if(!contract)throw Error(`Unsupported action: ${step?.kind}`);
  if(contract.fields.some(k=>typeof step[k]!=='string'||!step[k]))throw Error('Missing action parameter');
  if(Object.keys(step).some(k=>!['kind','sources',...contract.fields,...contract.optional].includes(k)))throw Error('Unsupported action field');
  if(step.sources!==undefined&&(!Array.isArray(step.sources)||!step.sources.every(x=>typeof x==='string')))throw Error('Invalid action sources');
  return contract;
}
