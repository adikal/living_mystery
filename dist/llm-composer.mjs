// Phase 4: the LLM composer (prep-time, cached).
//
// The LLM never mutates state, invents facts, or defines predicates. It COMPOSES a mystery by choosing
// values over a fixed, validated palette (the kernel's finite dimensions). We compile the proposal with
// buildSpec, validate it with validateCase (the same regression oracle the whole engine trusts), and on
// failure feed STRUCTURED feedback back for a bounded repair loop. If the LLM can't produce a valid case,
// we fall back to the deterministic sampler, which always yields a certified case. The LLM's prose
// (title/synopsis) is non-authoritative flavor that can never change a fact.
import {buildSpec,PROTECTOR,WEAPONS} from './cases/bellweather-configs.mjs';
import {validateCase,sampleCases} from './casegen.mjs';

// The validated palette — the ONLY things the composer may draw from. Not new physics: choices over the
// kernel. Widening this is a deliberate, human-authored act (a new dimension + predicate), never the LLM's.
export function palette(){
  return {
    suspects:['clara','rowan','silas'],
    weapons:Object.keys(WEAPONS),
    motives:['fraud','inheritance','eviction'],
    structures:['trace','cleanup','clockwork'],
    manners:['overt','accident','suicide'],
    minuteRange:[1200,1439],
    collusionCulprits:Object.keys(PROTECTOR),
    rules:[
      'weapon "poison" makes it a delayed-effect poisoning (toxicology + a tainted vessel).',
      'weapon "icicle" is a blunt weapon that melts — no weapon is found; a casting-mould/meltwater trace pins it.',
      'weapon "scarf" is a silk-ligature strangling — an everyday object as weapon; matching fibres pin it.',
      'weapon "chandelier" is a rigged set-and-leave fall — the killer sabotages the fixing earlier and is gone when it drops.',
      'manner "accident" stages the death to look like an ACCIDENTAL FALL — it only makes sense for a BLUNT weapon (seal, candlestick, icicle). Never pair it with poison, scarf, or chandelier (a chandelier already IS a fall).',
      'manner "suicide" stages a SELF-INFLICTED WOUND — it only makes sense for a SHARP weapon (knife). Never pair it with poison, blunt, or fall methods.',
      'if in doubt about a weapon+manner combination, use manner "overt".',
      'collusion:true needs a culprit in collusionCulprits — their protector gives a false alibi.',
      '"seen" (the misdirection sighting) must be a suspect different from the culprit.'
    ]
  };
}

// The instruction given to the model. On a repair round it carries the structured rejection feedback.
// `lead` is a soft, seed-driven suggestion (a culprit + weapon) that spreads generations across the
// palette; the model may override it for coherence and still owns motive, structure, manner and flavor.
export function composerPrompt({feedback,lead}={}){
  const p=palette();
  return [
    'You compose a deterministic detective mystery by CHOOSING values over a fixed, validated palette.',
    'You MUST NOT invent characters, methods, motives, locations, times outside the range, or any fact — only choose from the palette.',
    'Reply with ONLY one JSON object and nothing else:',
    '{"reasoning":"short","spec":{"culprit":"","weapon":"","motive":"","minute":0,"seen":"","structure":"","manner":"","collusion":false},"title":"","synopsis":""}',
    'Compose an interesting, coherent, DIVERGENT case — vary the crime shape using manner, poison, or collusion.',
    'Explore the WHOLE palette: vary the culprit, weapon, motive, structure and manner widely. Do NOT default to poison or the inheritance motive — pick freshly each time.',
    'Keep "reasoning" under 12 words and "synopsis" under 30 words so the JSON stays complete.',
    'Palette: '+JSON.stringify(p),
    lead?`For variety this time, lean toward culprit "${lead.culprit}" and weapon "${lead.weapon}" — change them only if you cannot make a coherent, plausible case; you still choose motive, structure, manner and collusion.`:'',
    feedback?('Your previous attempt was REJECTED. Fix exactly these problems and return a new JSON object:\n'+feedback):''
  ].filter(Boolean).join('\n\n');
}

// Small deterministic PRNG so a given seed yields a repeatable lead suggestion.
function seededPick(seed){
  let t=(seed>>>0)||1;
  return arr=>{t^=t<<13;t>>>=0;t^=t>>17;t^=t<<5;t>>>=0;return arr[t%arr.length];};
}

// Tolerantly extract the JSON object from model output (may be fenced or surrounded by prose).
export function parseComposition(text){
  if(typeof text!=='string')throw Error('model output was not text');
  const m=/\{[\s\S]*\}/.exec(text);
  if(!m)throw Error('no JSON object found in model output');
  const o=JSON.parse(m[0]);
  if(!o||typeof o!=='object'||typeof o.spec!=='object'||!o.spec)throw Error('missing "spec" object');
  return o;
}

// Structured, actionable feedback from a rejection — this is what makes the repair loop converge.
export function rejectionFeedback({error,report}){
  if(error)return `The components were invalid: ${error}`;
  const fails=Object.entries(report?.obligations||{}).filter(([,o])=>!o.ok).map(([k,o])=>`- ${k}: ${o.detail}`);
  return fails.length?`The case failed validation on:\n${fails.join('\n')}`:'The case failed validation.';
}

// Compose a validated case with the model, repairing on structured feedback; fall back to the sampler.
// `llm` is an async (prompt)=>string. `cache` is an optional Map for prep-time memoization.
export async function composeCase(llm,{seed,attempts=3,cache}={}){
  const key=`compose:${seed}`;
  if(cache&&cache.has(key))return cache.get(key);
  const p=palette(),pick=seededPick(Number.isInteger(seed)?seed:Date.now());
  const lead={culprit:pick(p.suspects),weapon:pick(p.weapons)};
  const trail=[];let feedback=null;
  for(let i=0;i<attempts;i++){
    let proposal;
    try{proposal=parseComposition(await llm(composerPrompt({feedback,lead})));}
    catch(e){feedback=`Your output could not be parsed: ${e.message}. Return ONLY a JSON object of the required shape.`;trail.push({attempt:i+1,rejected:'parse',detail:e.message});continue;}
    let spec;
    try{spec=buildSpec(proposal.spec);}
    catch(e){feedback=rejectionFeedback({error:e.message});trail.push({attempt:i+1,rejected:'buildSpec',detail:e.message});continue;}
    const report=validateCase(spec);
    if(report.ok){
      const result={source:'llm',spec,report,flavor:sanitizeFlavor(proposal),reasoning:String(proposal.reasoning||'').slice(0,600),attempts:i+1,trail};
      cache?.set(key,result);return result;
    }
    feedback=rejectionFeedback({report});trail.push({attempt:i+1,rejected:'validateCase',detail:feedback});
  }
  // Deterministic fallback — always certified.
  const s=Number.isInteger(seed)?seed:(Math.floor(Math.random()*0x7ffffffe)+1);
  const found=sampleCases(s,1)[0];
  const result={source:'fallback',spec:found.spec,report:found.report,flavor:null,attempts,trail};
  cache?.set(key,result);return result;
}

// Flavor is non-authoritative prose; clamp it and keep only display strings.
function sanitizeFlavor(proposal){
  const clamp=(v,n)=>typeof v==='string'?v.slice(0,n):null;
  const title=clamp(proposal.title,120),synopsis=clamp(proposal.synopsis,600);
  return (title||synopsis)?{title,synopsis}:null;
}

// Live adapter: POST {system,prompt,max_tokens} to the local proxy (contract in server/llm_proxy.py).
// The proxy only accepts its known profiles and caps max_tokens at 512 with a non-empty system.
export function llmFromProxy(endpoint,{system='You compose deterministic detective-mystery specifications and reply with strict JSON only.',max_tokens=500,profile='dialogue-v2',temperature,fetchImpl,signal}={}){
  const doFetch=fetchImpl??globalThis.fetch;
  return async prompt=>{
    const body={system,prompt,max_tokens:Math.min(max_tokens,512)};
    if(typeof temperature==='number')body.temperature=Math.max(0,Math.min(1,temperature));
    const res=await doFetch(endpoint,{method:'POST',headers:{'content-type':'application/json','X-Living-Mystery':profile},body:JSON.stringify(body),signal});
    if(!res.ok)throw Error(`proxy ${res.status}`);
    const data=await res.json();
    if(typeof data.text!=='string')throw Error('proxy returned no text');
    return data.text;
  };
}
