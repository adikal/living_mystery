import {guardedDispatch,filterPlans,assessTransition} from './admission.mjs';
// Session-scoped case assembly. Legacy sessions keep the original Last Bell.
import * as Original from './cases/last-bell.mjs';
import {makeCase} from './cases/bellweather.mjs';
import {CONFIGS,specFromId} from './cases/bellweather-configs.mjs';
import {deepFromId,generateDeepCase} from './deep-generator.mjs';
export {generateDeepCase};
import {createRuntime} from './engine-runtime.mjs';
import {sampleCases} from './casegen.mjs';
export {VERSION,copy,timeLabel} from './kernel.mjs';
export const {CASE,LOCATIONS,PEOPLE,CLUES,OBJECTS,SUSPECTS,PILLARS,suspectMeta,suspectBoard}=Original;
const definitions=new Map([[CASE.id,Original],...CONFIGS.map(c=>[c.id,makeCase(c)])]);
const runtimes=new Map();
// Generated cases resolve lazily: a gen-* id reconstructs its spec via specFromId,
// so sampled cases play (and save/reload) like any authored configuration.
export function runtimeFor(s){const id=typeof s==='string'?s:s?.world?.caseId??CASE.id;if(!definitions.has(id)){const spec=typeof id==='string'?(id.startsWith('gen-')?specFromId(id):id.startsWith('deep-')?deepFromId(id):null):null;if(!spec)throw Error('Unknown case configuration');definitions.set(id,makeCase(spec));}if(!runtimes.has(id))runtimes.set(id,createRuntime(definitions.get(id)));return runtimes.get(id);}
// Sample a validated case and return its id/title for the UI to start.
export function generateCase(seed,{structure,manner}={}){const s=Number.isInteger(seed)?seed:(Math.floor(Math.random()*0x7ffffffe)+1);const found=sampleCases(s,1,{...(structure?{structures:[structure]}:{}),...(manner?{manners:[manner]}:{})});return found.length?{id:found[0].spec.id,title:found[0].spec.title,seed:s}:null;}
export const caseTables=s=>runtimeFor(s);
// Register a fully-built spec (e.g. an LLM-authored deep artifact) so it is playable this session; on a
// fresh reload a deep-* id regenerates deterministically (LLM-authored artifacts are not yet persisted).
export function registerCase(spec){definitions.set(spec.id,makeCase(spec));runtimes.delete(spec.id);return spec.id;}
export const CASE_OPTIONS=[{id:CASE.id,title:CASE.title+' — original'},...CONFIGS.map(({id,title})=>({id,title}))];
export const createSession=(seed=17,caseId=CASE.id)=>runtimeFor(caseId).createSession(seed);
export function importSession(text){if(typeof text!=='string'||text.length>20000000)throw Error('Save file is too large.');const raw=JSON.parse(text);return runtimeFor(raw).importSession(text);}
export const exportSession=s=>runtimeFor(s).exportSession(s);
export const baseWorld=Original.baseWorld;
export const distance=(from,to)=>runtimeFor(CASE.id).distance(from,to);
export const parseCommand=(text,s)=>runtimeFor(s).parseCommand(text);
export const publicPerson=(id,s)=>runtimeFor(s).publicPerson(id);
export const commit=(s,...args)=>runtimeFor(s).commit(s,...args);
export const worldAt=(s,...args)=>runtimeFor(s).worldAt(s,...args);
export const diagnostics=(s,...args)=>runtimeFor(s).diagnostics(s,...args);
export const followupOptions=(s,...args)=>runtimeFor(s).followupOptions(s,...args);
export const playerClaims=(s,...args)=>runtimeFor(s).playerClaims(s,...args);
export const checkCase=(s,...args)=>runtimeFor(s).checkCase(s,...args);
export const caseHealth=(s,...args)=>runtimeFor(s).caseHealth(s,...args);
export const characterPlans=(s,...args)=>{const r=runtimeFor(s),plans=r.characterPlans(s,...args);return s.world.caseId?filterPlans(r,s,plans):plans;};
export const scheduleCharacterPlan=(s,...args)=>runtimeFor(s).scheduleCharacterPlan(s,...args);
export const dispatch=(s,action)=>{const r=runtimeFor(s);return s.world.caseId?guardedDispatch(r,s,action):r.dispatch(s,action);};
export const dispatchCharacter=(s,...args)=>{const r=runtimeFor(s);if(!s.world.caseId)return r.dispatchCharacter(s,...args);const trial=structuredClone(s);r.dispatchCharacter(trial,...args);const audit=assessTransition(r,s,trial);if(audit.status!=='allow')throw Error(audit.reason);s.world=trial.world;s.events=trial.events;return s;};
export const playerView=(s,...args)=>runtimeFor(s).playerView(s,...args);
