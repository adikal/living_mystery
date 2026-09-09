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

const covers=(iv,win)=>Boolean(iv)&&iv.start<=win.start&&iv.end>=win.end;
const near=(iv,win,margin)=>Boolean(iv)&&iv.start>=win.start-margin&&iv.start<=win.end+margin;

// Distinguishability is the keystone obligation for principled variety: the
// discoverable structured claims must place every innocent suspect elsewhere for
// the whole death window, leave the culprit without such an alibi, and put the
// culprit at the scene near the window. It is checked on the claims (name-neutral
// evidence), then confirmed against the real accusation grader, so a case cannot
// pass merely by naming the culprit inside a clue's prose.
export function checkDistinguishability(caseModule,runtime,spec,witness,{margin=15}={}){
  const claims=caseModule.model.evidenceClaims??{};
  const victimLocation=caseModule.baseWorld().flags.victimLocation;
  const death=(claims.medical??[]).find(c=>c.predicate==='death_time')?.interval;
  if(!death)return {ok:false,detail:'No discoverable death window (medical claim missing)'};
  const suspects=runtime.SUSPECTS,innocents=suspects.filter(id=>id!==spec.culprit);
  const locationClaims=Object.values(claims).flat().filter(c=>c.predicate==='location');
  const alibied=new Set(locationClaims.filter(c=>c.value!==victimLocation&&covers(c.interval,death)).map(c=>c.subject));
  const innocentsAlibied=innocents.every(id=>alibied.has(id));
  const culpritAlibied=alibied.has(spec.culprit);
  const opportunity=locationClaims.some(c=>c.subject===spec.culprit&&c.value===victimLocation&&near(c.interval,death,margin));

  // Behavioral confirmation: replay the acquisition witness, then grade the exact
  // discoverable bundle for the culprit (must pass) and each innocent (must fail).
  let graderOk=false,graderDetail='witness unavailable';
  if(witness?.status==='route_found'){
    const accuse=witness.actions.find(a=>a.type==='accuse');
    const session=runtime.createSession();
    for(const action of witness.actions.filter(a=>a.type!=='accuse'))runtime.dispatch(session,action);
    const grade=suspect=>runtime.behavior.checkCase(session,{...accuse,suspect}).supported;
    const culpritSupported=grade(spec.culprit);
    const innocentSupported=innocents.filter(grade);
    graderOk=culpritSupported&&innocentSupported.length===0;
    graderDetail=graderOk?`grader: only ${spec.culprit} supported by the discoverable bundle`
      :`grader: culpritSupported=${culpritSupported}, innocentsSupported=[${innocentSupported.join(', ')}]`;
  }
  const ok=innocentsAlibied&&!culpritAlibied&&opportunity&&graderOk;
  return {ok,alibied:[...alibied],detail:ok
    ?`Innocents ${innocents.join(', ')} alibied across the death window; ${spec.culprit} unalibied with scene opportunity; ${graderDetail}`
    :`innocentsAlibied=${innocentsAlibied} culpritAlibied=${culpritAlibied} opportunity=${opportunity}; ${graderDetail}`};
}

export function validateCase(spec,{caseModule=makeCase(spec),runtime=createRuntime(caseModule)}={}){
  const report={spec:spec.id,ok:false,obligations:{}};
  const fail=(name,detail)=>{report.obligations[name]={ok:false,detail};return report;};

  // 1. Physical consistency: the authored/generated prehistory must execute and
  //    the scripted case must be constructible. executePrehistory throws on any
  //    time reversal, unreachable meeting or invalid fatal state.
  let session;
  try{session=runtime.createSession();}
  catch(error){return fail('physical',`Prehistory/construction failed: ${error.message}`);}
  report.obligations.physical={ok:true,detail:'Prehistory executed; initial state constructed'};

  // 2. Epistemic legitimacy: every seeded belief must be sourced to a real event.
  const orphans=[];
  for(const [id,npc]of Object.entries(session.world.npcs))
    for(const b of npc.beliefs)
      if(!session.events.some(e=>e.id===b.sourceId))orphans.push(`${id}:${b.key}`);
  report.obligations.epistemic=orphans.length
    ?{ok:false,detail:`Unsourced initial beliefs: ${orphans.join(', ')}`}
    :{ok:true,detail:'All seeded beliefs reference recorded events'};

  // 3. Reachability: a bounded acquisition search plus engine replay must solve it.
  const witness=searchInvestigation(session,runtime);
  report.obligations.reachability=witness.status==='route_found'
    ?{ok:true,detail:`Route "${witness.route}" solved in ${witness.minutes} min (${witness.actions.length} actions)`}
    :{ok:false,detail:`No replay-validated route: ${witness.reason}`};

  // 4. Distinguishability: discoverable evidence discriminates the culprit.
  report.obligations.distinguishability=witness.status==='route_found'
    ?checkDistinguishability(caseModule,runtime,spec,witness)
    :{ok:false,detail:'No route to evaluate discrimination'};

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
// every obligation. Variety is generated, then proven — never asserted. Sampling
// is deterministic in `seed`, needs no AI, and reuses the fixed cast/assets.
export function sampleCases(seed=1,count=6,{
  suspects=['clara','rowan','silas'],
  weapons=Object.keys(WEAPONS),
  motives=Object.keys(MOTIVES),
  minutes=[1274,1294,1314],
  maxTries=count*40
}={}){
  let state=(seed>>>0)||1;
  const rand=()=>{state=(state*1103515245+12345)&0x7fffffff;return state/0x7fffffff;};
  const pick=arr=>arr[Math.floor(rand()*arr.length)];
  const valid=[],ids=new Set();let tries=0;
  while(valid.length<count&&tries++<maxTries){
    const culprit=pick(suspects),innocents=suspects.filter(id=>id!==culprit);
    let spec;
    try{spec=buildSpec({culprit,weapon:pick(weapons),motive:pick(motives),minute:pick(minutes),seen:pick(innocents)});}
    catch{continue;}
    if(ids.has(spec.id))continue;
    const report=validateCase(spec);
    if(report.ok){ids.add(spec.id);valid.push({spec,report});}
  }
  return valid;
}
