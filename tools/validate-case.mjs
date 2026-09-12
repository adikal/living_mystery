// Offline Z3 certification; no HTTP service, credentials or LLM required.
import {spawnSync} from 'node:child_process';
import {sampleCases,validateCaseWithSolver} from '../dist/casegen.mjs';
const seed=Number(process.argv[2]??17),structure=process.argv[3]??'trace';
if(!Number.isInteger(seed)||!['trace','cleanup','clockwork'].includes(structure))throw Error('Usage: node tools/validate-case.mjs [integer seed] [trace|cleanup|clockwork]');
const candidate=sampleCases(seed,1,{structures:[structure]})[0];
if(!candidate)throw Error('No admissible candidate within the sampling budget');
const report=await validateCaseWithSolver(candidate.spec,{solve:query=>{
 const result=spawnSync(process.env.LIVING_MYSTERY_PYTHON??'.venv/bin/python',['-c','import json,sys; from server.symbolic_solver import solve; print(json.dumps(solve(json.load(sys.stdin))))'],{input:JSON.stringify(query),encoding:'utf8',timeout:5000});
 if(result.status!==0)throw Error(result.error?.message??result.stderr??'Solver failed');
 return JSON.parse(result.stdout);
}});
console.log(JSON.stringify({id:candidate.spec.id,structure,ok:report.ok,obligations:Object.fromEntries(Object.entries(report.obligations).map(([k,v])=>[k,{ok:v.ok,detail:v.detail}])),solver:report.solver},null,2));
process.exitCode=report.ok?0:1;
