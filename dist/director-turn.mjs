import {compileCrimeHistory,excludeExplanation} from './forensics.mjs';
import {searchInvestigation} from './investigation.mjs';
// Transactional optional solver boundary, shared by scripted and AI turns.
import {copy,dispatch,commit,exportSession,diagnostics,CASE,runtimeFor} from './engine.mjs';
import {evaluate} from './symbolic.mjs';
const KEY='living-mystery.director.enabled';
export function directorEnabled(){try{return globalThis.localStorage?.getItem(KEY)==='1';}catch{return false;}}
export function setDirectorEnabled(value){try{globalThis.localStorage?.setItem(KEY,value?'1':'0');}catch{}}

// Search the declared acquisition domain and validate each returned witness by replay.
export function investigateReachability(session,options={}){
 return searchInvestigation(session,runtimeFor(session),options);
}

export async function verifyDirectorTurn(base,trial,{fetchImpl=globalThis.fetch,signal,timeoutMs=10000,endpoint='http://127.0.0.1:8788/solve',reachability=investigateReachability,onChecking}={}){
  const start=base.events.length;
  const plans=trial.events.slice(start).filter(e=>e.data.director?.query&&e.data.director.status==='allow');
  const runtime=runtimeFor(trial),extras=[];
  if(runtime.kernel.model.forensics){
    if(!base.events.some(e=>e.data.directorResult?.status==='verified'&&e.data.directorResult.results?.some(r=>r.query?.kind==='crime-history'&&r.result?.status==='sat')))extras.push({id:trial.events[start]?.id??trial.events.at(-1).id,query:compileCrimeHistory(trial,runtime)});
    for(const e of trial.events.slice(start).filter(e=>e.data.forensicQuery)){
      extras.push({id:e.id,query:e.data.forensicQuery});
      extras.push({id:`${e.id}_alternatives`,query:excludeExplanation(e.data.forensicQuery,runtime.kernel.model.forensics,{suspect:e.data.suspect,method:e.data.method,motive:e.data.motive}),expected:'unsat'});
    }
  }
  if(!plans.length&&!extras.length)return {status:'not_needed',results:[]};
  if(plans.length+extras.length>96)return {status:'unresolved',reason:'Too many plan checks in one turn. Try a shorter wait.'};
  if(signal?.aborted)return {status:'cancelled'};
  onChecking?.();
  const queries=[...plans.map(e=>({id:e.id,query:e.data.director.query})),...extras];
  const controller=new AbortController();let timer;
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  try{
    if(signal?.aborted)return {status:'cancelled'};
    const interrupted=new Promise(resolve=>{controller.signal.addEventListener('abort',()=>resolve({status:signal?.aborted?'cancelled':'unresolved',reason:'Solver request timed out'}),{once:true});timer=setTimeout(abort,timeoutMs);});
    const request=(async()=>{
      try{
        const results=[];
        // The local service retains a 12-query request bound. A living town can
        // produce more plans in one wait, so validate sequential bounded batches
        // under the same whole-turn timeout and atomic commit boundary.
        for(let start=0;start<queries.length;start+=12){
          if(controller.signal.aborted)throw Error('Solver request cancelled');
          const response=await fetchImpl(endpoint,{method:'POST',headers:{'content-type':'application/json','X-Living-Mystery':'director-v1'},body:JSON.stringify({queries:queries.slice(start,start+12).map(({id,query})=>({id,query}))}),signal:controller.signal});
          if(!response.ok)throw Error('Symbolic service unavailable');
          const batch=await response.json();
          if(!Array.isArray(batch.results)||batch.results.length!==Math.min(12,queries.length-start))throw Error('Invalid solver response');
          results.push(...batch.results);
        }
        const body={results};
        for(let i=0;i<queries.length;i++){
          const r=body.results[i],q=queries[i];
          if(r.id!==q.id||JSON.stringify(r.query)!==JSON.stringify(q.query))throw Error('Mismatched symbolic query');
          if(q.expected==='unsat'){if(r.result?.status!=='unsat')return {status:'unresolved',reason:'Z3 did not exclude competing explanations',results:body.results};continue;}
          if(r.result?.status==='unsat')return {status:'reject',reason:'Z3 found incompatible plan constraints',results:body.results};
          if(r.result?.status!=='sat')return {status:'unresolved',reason:r.result?.reason??'Solver did not establish feasibility',results:body.results};
          const values=r.result.witness;
          if(!values||!Object.entries(q.query.variables).every(([name,d])=>Number.isInteger(values[name])&&values[name]>=d.min&&values[name]<=d.max)||!q.query.constraints.every(c=>evaluate(c.formula,values)===true))throw Error('Invalid solver witness');
        }
        return {status:'verified',results:body.results};
      }catch(error){return {status:'unresolved',reason:error.message};}
    })();
    const result=await Promise.race([request,interrupted]);
    if(signal?.aborted)return {status:'cancelled'};
    if(result.status!=='verified')return result;
    if(plans.some(e=>e.data.director.plan.steps.some(a=>['take','store','give','conceal'].includes(a.kind)))){
      result.viability=reachability(trial);
      if(result.viability.status!=='route_found')return {...result,status:'defer',reason:'No replay-validated investigation route found within the candidate search'};
    }
    return result;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export async function commitDirectedTurn(session,trial,options={}){
  if(JSON.stringify(trial.events.slice(0,session.events.length))!==JSON.stringify(session.events))throw Error('Candidate is not based on the current history.');
  const before=exportSession(session),result=await verifyDirectorTurn(session,trial,options);
  if(exportSession(session)!==before)throw Error('The world changed during symbolic validation.');
  if(result.status==='cancelled')return result;
  if(!['verified','not_needed'].includes(result.status)){
    commit(session,{kind:'decision',actor:'world',title:`World Director: ${result.status} turn`,data:{directorResult:result,reason:result.reason}});
    return result;
  }
  if(result.status==='verified')commit(trial,{kind:'decision',actor:'world',title:'World Director: Z3 verified the turn',parents:result.results.map(r=>r.id).filter(id=>trial.events.some(e=>e.id===id)),data:{directorResult:result,reason:'Plan constraints passed; any future meeting remains conditional.'}});
  if(!diagnostics(trial).ok)throw Error('Director candidate failed replay integrity');
  session.world=trial.world;session.events=trial.events;
  return result;
}
