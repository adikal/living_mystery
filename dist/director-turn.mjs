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
  if(!plans.length)return {status:'not_needed',results:[]};
  if(plans.length>12)return {status:'unresolved',reason:'Too many plan checks in one turn. Try a shorter wait.'};
  if(signal?.aborted)return {status:'cancelled'};
  onChecking?.();
  const queries=plans.map(e=>({id:e.id,query:e.data.director.query}));
  const controller=new AbortController();let timer;
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  try{
    if(signal?.aborted)return {status:'cancelled'};
    const interrupted=new Promise(resolve=>{controller.signal.addEventListener('abort',()=>resolve({status:signal?.aborted?'cancelled':'unresolved',reason:'Solver request timed out'}),{once:true});timer=setTimeout(abort,timeoutMs);});
    const request=(async()=>{
      try{
        const response=await fetchImpl(endpoint,{method:'POST',headers:{'content-type':'application/json','X-Living-Mystery':'director-v1'},body:JSON.stringify({queries}),signal:controller.signal});
        if(!response.ok)return {status:'unresolved',reason:'Symbolic service unavailable'};
        const body=await response.json();
        if(!Array.isArray(body.results)||body.results.length!==queries.length)throw Error('Invalid solver response');
        for(let i=0;i<queries.length;i++){
          const r=body.results[i],q=queries[i];
          if(r.id!==q.id||JSON.stringify(r.query)!==JSON.stringify(q.query))throw Error('Mismatched symbolic query');
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
  if(result.status==='verified')commit(trial,{kind:'decision',actor:'world',title:'World Director: Z3 verified the turn',parents:result.results.map(r=>r.id),data:{directorResult:result,reason:'Plan constraints passed; any future meeting remains conditional.'}});
  if(!diagnostics(trial).ok)throw Error('Director candidate failed replay integrity');
  session.world=trial.world;session.events=trial.events;
  return result;
}
