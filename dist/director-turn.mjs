// Transactional optional solver boundary, shared by scripted and AI turns.
import {copy,dispatch,commit,exportSession,diagnostics,CASE} from './engine.mjs';
import {evaluate} from './symbolic.mjs';
const KEY='living-mystery.director.enabled';
export function directorEnabled(){try{return globalThis.localStorage?.getItem(KEY)==='1';}catch{return false;}}
export function setDirectorEnabled(value){try{globalThis.localStorage?.setItem(KEY,value?'1':'0');}catch{}}

// Authored candidate routes, verified by actual engine execution. This is bounded
// witness search, not a complete solver search or proof that all paths are safe.
export function investigateReachability(session,{horizon=180,maxActions=32}={}){
  const base=session.world.minute;
  const routes=[{id:'physical',stops:[['manor',['body','carpet','accounts']],['vestry',['seal','delivery']],['surgery',['record']],['square',[]]]},
    {id:'testimony',stops:[['greenhouse',['letter']],['manor',['body']],['vestry',['delivery']],['surgery',['record']],['square',[]]]}];
  const attempts=[];
  for(const route of routes){
    const trial=copy(session),actions=[];
    const act=action=>{actions.push(action);if(actions.length>maxActions)throw Error('Action horizon exceeded');dispatch(trial,action);if(trial.world.minute-base>horizon)throw Error('Time horizon exceeded');};
    const move=to=>{if(trial.world.player.location!==to)act({type:'move',to});};
    try{
      if(route.id==='physical')for(const [to,objects]of route.stops){move(to);for(const object of objects)act({type:'inspect',object});}
      else{
        move('greenhouse');act({type:'inspect',object:'letter'});move('manor');act({type:'present',person:'clara',clue:'letter',tone:'private'});act({type:'inspect',object:'body'});
        if(trial.world.objects.folio==='manor')act({type:'inspect',object:'folio'});
        move('vestry');act({type:'ask',person:'silas',topic:'alibi'});act({type:'inspect',object:'delivery'});act({type:'inspect',object:'drawer'});
        move('surgery');act({type:'inspect',object:'record'});move('square');
      }
      // Existing rubric is the goal only; no inference of guilt from hidden truth.
      const evidence=trial.world.player.evidence.map(e=>e.clue);
      // The case supplies the accusation goal through an exported helper below.
      const goal=caseGoal(trial,evidence);
      act(goal);
      if(trial.world.status==='solved'&&diagnostics(trial).ok)return {status:'route_found',method:'authored-candidate-engine-replay',horizon,maxActions,
        route:route.id,actions,minutes:trial.world.minute-base,assumptions:['Current deterministic NPC policies','Existing authored accusation rubric'],scope:'Two authored candidate strategies; not exhaustive.'};
      attempts.push({route:route.id,reason:'Candidate did not produce a supported accusation'});
    }catch(error){attempts.push({route:route.id,reason:error.message});}
  }
  return {status:'unresolved',method:'authored-candidate-engine-replay',horizon,maxActions,attempts,reason:'No witness found among these authored candidates. This is not proof of a dead end.'};
}
// This module is currently the Last Bell integration adapter, not the shared IR.
function caseGoal(_session,evidence){return {type:'accuse',suspect:CASE.culprit,method:CASE.method,motive:CASE.motive,evidence};}

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
