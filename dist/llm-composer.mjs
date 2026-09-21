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
import {deepSpec,deepSpecWith} from './deep-generator.mjs';
import {expandArtifact} from './case-artifact.mjs';

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
function sanitizeFlavor(proposal){  const clamp=(v,n)=>typeof v==='string'?v.slice(0,n):null;
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

// A deep case: the deterministic artifact supplies the certified DEPTH (a gated toxicology anchor behind a
// washed-vessel -> dregs discovery chain, with the recorded time of death as a misdirecting alibi). The
// model contributes only who/why + flavor over the validated palette; validity and depth never depend on
// it, and it always falls back to the fully-certified deterministic deep case.
export function deepComposerPrompt({feedback}={}){
 return [
  'You are seeding a DEEP detective case: a delayed poisoning where the recorded time of death is a false',
  'alibi and the true window is fixed by a toxicology finding hidden behind a discovery chain.',
  'Choose only WHO and WHY over this palette; the puzzle structure is fixed by the engine.',
  'Reply with ONLY one JSON object: {"reasoning":"short","spec":{"culprit":"clara|rowan|silas","motive":"fraud|inheritance|eviction"},"title":"","synopsis":""}',
  'Pick a fresh, plausible culprit + motive; keep title/synopsis short.',
  feedback?('Your previous attempt was rejected: '+feedback):''
 ].filter(Boolean).join('\n\n');
}

export async function composeDeepCase(llm,{seed,attempts=3,cache}={}){
 const s=Number.isInteger(seed)?(seed>>>0):(Math.floor(Math.random()*0x7ffffffe)+1);
 const key=`deep:${s}`;if(cache&&cache.has(key))return cache.get(key);
 let feedback=null;
 for(let i=0;i<attempts;i++){
  let proposal;
  try{proposal=parseComposition(await llm(deepComposerPrompt({feedback})));}
  catch(e){feedback=`Return ONLY the required JSON object: ${e.message}`;continue;}
  const {culprit,motive}=proposal.spec||{};
  const spec=deepSpecWith(s,{culprit,motive});
  const report=validateCase(spec);
  if(report.ok){const r={source:'llm',spec,report,flavor:sanitizeFlavor(proposal),reasoning:String(proposal.reasoning||'').slice(0,600),attempts:i+1};cache?.set(key,r);return r;}
  feedback=rejectionFeedback({report});
 }
 const spec=deepSpec(s);const r={source:'fallback',spec,report:validateCase(spec),flavor:null,attempts};cache?.set(key,r);return r;
}

// (b) LLM authors a FULL deep artifact: the true crime + a discovery chain of neutral observations that
// gate an existing forced ANCHOR, plus the inversion framing. The engine certifies it (all obligations);
// on failure it repairs from structured feedback, and always falls back to a deterministic deep case.
export function artifactComposerPrompt({feedback}={}){
 return [
  'Author a DEEP detective case: the decisive clue is HIDDEN behind a chain of other clues, and the obvious reading is a trap. Emit ONE JSON object only:',
  '{"reasoning":"short","spec":{"culprit":"clara|rowan|silas","weapon":"seal|candlestick|knife|poison","motive":"fraud|inheritance|eviction","minute":1290,"seen":"a suspect different from culprit","structure":"trace","manner":"overt"},',
  '"observations":[{"id":"snake_case_id","title":"short","text":"a NEUTRAL clue that does not name the culprit or announce its meaning","at":"manor|surgery|vestry|inn|greenhouse|square"}],',
  '"gates":{"clueId":["prereqId"]},"forces":["anchorId"],"inversion":{"anchor":"anchorId","naive":"the coherent WRONG reading before the anchor is found","reReads":["clueId"]},"title":"","synopsis":""}',
  'RULES: add exactly 2 neutral discovery observations that CHAIN to a forced ANCHOR which is an EXISTING clue —',
  'if weapon is "poison" the anchor is "toxicology"; otherwise the anchor is "intent" (a motive memo) or "seal" (the weapon trace).',
  'gates must chain them, e.g. {"obsB":["obsA"],"anchor":["obsB"]}: the anchor is reachable only after obsA then obsB.',
  'forces=[anchor]; inversion.anchor=anchor. Observations carry NO claims (they are stepping-stones). "seen" != "culprit". Keep texts under ~30 words and never name the culprit.',
  feedback?('Your previous attempt was rejected: '+feedback):''
 ].filter(Boolean).join('\n');
}

export async function composeArtifactCase(llm,{seed,attempts=3,cache}={}){
 const s=Number.isInteger(seed)?(seed>>>0):(Math.floor(Math.random()*0x7ffffffe)+1);
 const key=`artifact:${s}`;if(cache&&cache.has(key))return cache.get(key);
 let feedback=null;
 for(let i=0;i<attempts;i++){
  let json;
  try{json=parseComposition(await llm(artifactComposerPrompt({feedback})));}
  catch(e){feedback=`Return ONLY the required JSON object: ${e.message}`;continue;}
  let spec;
  try{const base=buildSpec(json.spec||{});const art=expandArtifact(json,{id:`deep-${s}-art`});spec={...base,id:`deep-${s}`,deep:true,depthTarget:2,shape:'llm',artifact:art};}
  catch(e){feedback=`Invalid spec or artifact: ${e.message}`;continue;}
  const report=validateCase(spec);
  if(report.ok){const r={source:'llm-artifact',spec,report,flavor:sanitizeFlavor(json),reasoning:String(json.reasoning||'').slice(0,600),attempts:i+1};cache?.set(key,r);return r;}
  feedback=rejectionFeedback({report});
 }
 const spec=deepSpec(s);const r={source:'fallback',spec,report:validateCase(spec),flavor:null,attempts};cache?.set(key,r);return r;
}
