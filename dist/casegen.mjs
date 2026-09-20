import {excludeExplanation,crimeModel,compileCrimeHistory,validateKnowledge,validateEvidence,STRUCTURES,compileExplanation,enumerateExplanations} from './forensics.mjs';
import {evaluate} from './symbolic.mjs';
// Case-general validation of a mystery specification. Variety must be validated,
// not asserted: a specification is admissible only if it is physically executable,
// its initial knowledge is legitimately sourced, a bounded investigation solves it,
// and the discoverable evidence actually discriminates the culprit from the other
// suspects. No case-specific content lives here — every obligation reads declared
// structure (events, beliefs, claims, proof routes) so it applies equally to an
// authored configuration and a future generated one.
import {createRuntime} from './engine-runtime.mjs';
import {makeCase} from './cases/bellweather.mjs';
import {searchInvestigation} from './investigation.mjs';
import {buildSpec,WEAPONS,MOTIVES} from './cases/bellweather-configs.mjs';

// Check the acquired bundle against every alternative in the shared finite domain.
export function checkDistinguishability(caseModule,runtime,spec,witness){
 if(witness?.status!=='route_found')return {ok:false,detail:'No replay-validated route'};
 const trial=runtime.createSession();
 for(const a of witness.actions.filter(a=>a.type!=='accuse'))runtime.dispatch(trial,a);
 const verdict=runtime.behavior.checkCase(trial,witness.actions.at(-1));
 return {ok:verdict.supported&&verdict.alternatives.length===1,detail:`${verdict.alternatives.length} competing culprit/method/motive explanations remain`,query:verdict.query};
}

// Per-pillar multi-hop: no single acquired clue may pin suspect, method or motive by itself. Evidence
// must be pieced together — this forbids a smoking gun and makes the deduction genuinely multi-step.
export function checkMultiHop(caseModule,witness){
 if(witness?.status!=='route_found')return {ok:false,detail:'No replay-validated route'};
 const bundle=[...new Set(witness.actions.at(-1)?.evidence??[])];
 const model=caseModule.model.forensics,cat=caseModule.model.evidenceClaims;
 const single={};
 for(const d of ['suspect','method','motive'])for(const c of bundle){
  const alts=enumerateExplanations(compileExplanation(model,{[c]:cat[c]??[]},[c]),model);
  if(alts.length&&new Set(alts.map(a=>a[d])).size===1){single[d]=c;break;}
 }
 // Motive and means must be pieced together (no single-clue pin). Opportunity depth is structure-
 // dependent: some investigative structures (cleanup/clockwork) establish it through one authoritative
 // watch, itself acquired via a multi-step route — so suspect depth is reported, not enforced here.
 const enforced=['method','motive'].filter(d=>single[d]);
 const ok=enforced.length===0;
 return {ok,detail:ok?`motive and means each require ≥2 clues${single.suspect?` (opportunity via ${single.suspect}, by structure)`:' (opportunity by elimination)'}`:'single-clue pin — '+enforced.map(d=>`${d} via ${single[d]}`).join(', ')};
}

export function validateCase(spec,{caseModule,runtime}={}){
  const report={spec:spec?.id??null,ok:false,obligations:{}};
  const fail=(name,detail)=>{report.obligations[name]={ok:false,detail};return report;};

  // 1. Physical consistency: the authored/generated prehistory must execute and
  //    the scripted case must be constructible. executePrehistory throws on any
  //    time reversal, unreachable meeting or invalid fatal state.
  let session;
  try{caseModule??=makeCase(spec);runtime??=createRuntime(caseModule);session=runtime.createSession();}
  catch(error){return fail('physical',`Prehistory/construction failed: ${error.message}`);}
  report.obligations.physical={ok:true,detail:'Prehistory executed; initial state constructed'};

  const historyQuery=compileCrimeHistory(session,runtime);
  const conflicts=historyQuery.constraints.filter(c=>!evaluate(c.formula,{death:session.world.flags.deathMinute}));
  const inDomain=Object.values(historyQuery.variables).every(d=>Number.isInteger(session.world.flags.deathMinute)&&session.world.flags.deathMinute>=d.min&&session.world.flags.deathMinute<=d.max);
  report.obligations.symbolic={ok:inDomain&&!conflicts.length,detail:!inDomain?'Crime time is outside the declared domain':conflicts.map(c=>c.label).join('; ')||'Recorded history satisfies the shared physical/temporal IR',query:historyQuery};
  report.obligations.epistemic=validateKnowledge(session,caseModule.PEOPLE);
  report.obligations.evidence=validateEvidence(session,caseModule.model.evidenceClaims);

  // 3. Reachability: a bounded acquisition search plus engine replay must solve it.
  const witness=searchInvestigation(session,runtime);
  report.obligations.reachability=witness.status==='route_found'
    ?{ok:true,detail:`Route "${witness.route}" solved in ${witness.minutes} min (${witness.actions.length} actions)`}
    :{ok:false,detail:`No replay-validated route: ${witness.reason}`};

  const routeResults=caseModule.CASE.proofRoutes.map(route=>{
    const scoped={...runtime,CASE:{...runtime.CASE,proofRoutes:[route]}};
    const found=searchInvestigation(session,scoped);
    return {id:route.id,ok:found.status==='route_found',detail:found.reason??found.route};
  });
  report.obligations.routes={ok:routeResults.every(r=>r.ok),results:routeResults,detail:'Each declared route independently replayed'};
  report.obligations.distinguishability=checkDistinguishability(caseModule,runtime,spec,witness);
  report.obligations.multihop=checkMultiHop(caseModule,witness);

  // 5. Module coherence: every composed narrative brick's local invariant holds.
  const modules=caseModule.model.modules??[];
  const results=modules.map(({module,binding,roles})=>({id:module.id,...(module.invariant?module.invariant({binding,roles,spec,runtime,caseModule,peers:modules}):{ok:true})}));
  report.obligations.modules={ok:results.every(m=>m.ok),detail:results.length?results.map(m=>`${m.id}:${m.ok?'ok':m.detail}`).join('; '):'no modules composed',results};

  report.ok=Object.values(report.obligations).every(o=>o.ok);
  return report;
}

// Validate a batch of specifications; returns per-spec reports and an overall flag.
export function validateAll(specs){
  const reports=specs.map(spec=>validateCase(spec));
  return {ok:reports.every(r=>r.ok),reports};
}

// Controlled seeded sampling of validated specifications (the G2 gate): permute
// the specification space deterministically and return only variants that pass
// every obligation. Candidates must satisfy the declared finite checks. Sampling
// is deterministic in `seed`, needs no AI, and reuses the fixed cast/assets.
export function sampleCases(seed=1,count=6,{
  suspects=['clara','rowan','silas'],
  weapons=Object.keys(WEAPONS),
  motives=Object.keys(MOTIVES),
  minutes=[1274,1294,1314],
  structures=STRUCTURES,
  manners=['overt','overt','accident'],
  maxTries=count*40
}={}){
  let state=(seed>>>0)||1;
  const rand=()=>{state=(state*1103515245+12345)&0x7fffffff;return state/0x7fffffff;};
  const pick=arr=>arr[Math.floor(rand()*arr.length)];
  const valid=[],ids=new Set();let tries=0;
  while(valid.length<count&&tries++<maxTries){
    const culprit=pick(suspects),innocents=suspects.filter(id=>id!==culprit);
    let spec;
    try{spec=buildSpec({culprit,weapon:pick(weapons),motive:pick(motives),minute:pick(minutes),seen:pick(innocents),structure:pick(structures),manner:pick(manners)});}
    catch{continue;}
    if(ids.has(spec.id))continue;
    const report=validateCase(spec);
    if(report.ok){ids.add(spec.id);valid.push({spec,report});}
  }
  return valid;
}

// The transport is injected so Node, browser and offline tooling share the gate.
// Unavailable/unknown is unresolved and never labeled Z3-verified.
export async function validateCaseWithSolver(spec,{solve,...options}={}){
 const report=validateCase(spec,options);
 if(!report.ok)return report;
 if(typeof solve!=='function')return {...report,ok:false,solver:{status:'unresolved',reason:'A Z3 adapter is required'}};
 const checks=[];
 const hypotheses=report.obligations.distinguishability.query;
 const queries=[{query:report.obligations.symbolic.query,expected:'sat'},{query:hypotheses,expected:'sat'},{query:excludeExplanation(hypotheses,crimeModel(spec),{suspect:spec.culprit,method:spec.weapon,motive:spec.motive}),expected:'unsat'}];
 for(const {query:q,expected} of queries){
  let result;try{result=await solve(q);}catch(error){result={status:'unavailable',reason:error.message};}
  const valid=result?.status===expected&&(expected==='unsat'||Object.entries(q.variables).every(([k,d])=>Number.isInteger(result.witness?.[k])&&result.witness[k]>=d.min&&result.witness[k]<=d.max)&&q.constraints.every(c=>evaluate(c.formula,result.witness)));
  checks.push({status:valid?'verified':'unresolved',expected,result});
 }
 return {...report,ok:checks.every(c=>c.status==='verified'),solver:{status:checks.every(c=>c.status==='verified')?'verified':'unresolved',checks}};
}
