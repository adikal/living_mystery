import {guardedDispatch,filterPlans,assessTransition} from './admission.mjs';
// Session-scoped case assembly. Legacy sessions keep the original Last Bell.
import * as Original from './cases/last-bell.mjs';
import {makeCase} from './cases/bellweather.mjs';
import {CONFIGS,specFromId} from './cases/bellweather-configs.mjs';
import {deepFromId,generateDeepCase} from './deep-generator.mjs';
export {generateDeepCase};
import {createRuntime} from './engine-runtime.mjs';
import {makeKernelCase,sanitizeRecords} from './cases/kernel-case.mjs';
import {sampleCases} from './casegen.mjs';
export {VERSION,copy,timeLabel} from './kernel.mjs';
export const {CASE,LOCATIONS,PEOPLE,CLUES,OBJECTS,SUSPECTS,PILLARS,suspectMeta,suspectBoard}=Original;
const definitions=new Map([[CASE.id,Original],...CONFIGS.map(c=>[c.id,makeCase(c)])]);
const runtimes=new Map();
// Kernel cases by canonical record identity. Entries a definition registered are kept; others (cases bound only by a
// loaded save) are evicted least-recently-used beyond KERNEL_CACHE_LIMIT. A live session keeps its own runtime through
// sessionRuntimes regardless, so eviction only costs a rebuild for a new copy of an old session.
const kernelCases=new Map();
const KERNEL_CACHE_LIMIT=16;
const definitionIdentities=new Map();
const sessionRuntimes=new WeakMap();
// Canonical JSON of the records: keys sorted, and undefined members dropped exactly as JSON does, so a record and its
// JSON round trip share one identity.
function recordIdentity(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value)??'null';
  if(Array.isArray(value))return `[${value.map(item=>item===undefined||typeof item==='function'?'null':recordIdentity(item)).join(',')}]`;
  return `{${Object.keys(value).filter(key=>value[key]!==undefined&&typeof value[key]!=='function').sort().map(key=>`${JSON.stringify(key)}:${recordIdentity(value[key])}`).join(',')}}`;
}
function touchKernel(identity,entry){
  kernelCases.delete(identity);kernelCases.set(identity,entry);
  const pinned=new Set(definitionIdentities.values());
  for(const key of kernelCases.keys()){
    if(kernelCases.size<=KERNEL_CACHE_LIMIT+pinned.size)break;
    if(!pinned.has(key)&&key!==identity)kernelCases.delete(key);
  }
}
function kernelEntry(records,expectedId,{admit=true}={}){
  const normalized=sanitizeRecords(records);
  if(!normalized?.id?.startsWith('mk-'))throw Error('Kernel case ids start with mk-');
  if(expectedId!==undefined&&normalized.id!==expectedId)throw Error('Kernel case records do not match the save case id');
  const identity=recordIdentity(normalized);
  let entry=kernelCases.get(identity),created=false;
  if(!entry){entry={definition:makeKernelCase(normalized),runtime:null};created=true;}
  if(admit)touchKernel(identity,entry);   // an import is admitted only after its save validates
  return {identity,entry,created,id:normalized.id};
}
const runtimeForKernel=entry=>entry.runtime??(entry.runtime=createRuntime(entry.definition));
// A session's embedded case becomes the definition for its id only if none is registered (so `caseTables(id)` works
// for a case that came from a save). Imports call this only after the save has been validated.
function adoptDefinition(id,identity,entry){if(!definitions.has(id)){definitions.set(id,entry.definition);definitionIdentities.set(id,identity);}}
// Generated cases resolve lazily: gen-* and deep-* ids reconstruct deterministic specs, while mk-* sessions bind
// to the exact records embedded in their world. The WeakMap avoids re-fingerprinting or rebuilding on every call.
export function runtimeFor(s){
  if(s&&typeof s==='object'&&sessionRuntimes.has(s))return sessionRuntimes.get(s);
  const id=typeof s==='string'?s:s?.world?.caseId??CASE.id;
  let runtime;
  if(typeof id==='string'&&id.startsWith('mk-')){
    if(s?.world?.caseRecords){
      const {identity,entry}=kernelEntry(s.world.caseRecords,id);
      adoptDefinition(id,identity,entry);
      runtime=runtimeForKernel(entry);
    }else{
      const identity=definitionIdentities.get(id),entry=identity&&kernelCases.get(identity);
      if(entry)runtime=runtimeForKernel(entry);
      else if(definitions.has(id)){if(!runtimes.has(id))runtimes.set(id,createRuntime(definitions.get(id)));runtime=runtimes.get(id);}
      else throw Error('Unknown case configuration');
    }
  }else{
    if(!definitions.has(id)){
      const spec=typeof id==='string'?(id.startsWith('gen-')?specFromId(id):id.startsWith('deep-')?deepFromId(id):null):null;
      if(!spec)throw Error('Unknown case configuration');
      definitions.set(id,makeCase(spec));
    }
    if(!runtimes.has(id))runtimes.set(id,createRuntime(definitions.get(id)));
    runtime=runtimes.get(id);
  }
  if(s&&typeof s==='object')sessionRuntimes.set(s,runtime);
  return runtime;
}
// Sample a validated case and return its id/title for the UI to start.
export function generateCase(seed,{structure,manner}={}){const s=Number.isInteger(seed)?seed:(Math.floor(Math.random()*0x7ffffffe)+1);const found=sampleCases(s,1,{...(structure?{structures:[structure]}:{}),...(manner?{manners:[manner]}:{})});return found.length?{id:found[0].spec.id,title:found[0].spec.title,seed:s}:null;}
export const caseTables=s=>runtimeFor(s);
// Register a fully-built spec (e.g. an LLM-authored deep artifact) so it is playable this session; on a
// fresh reload a deep-* id regenerates deterministically (LLM-authored artifacts are not yet persisted).
export function registerCase(spec){definitions.set(spec.id,makeCase(spec));definitionIdentities.delete(spec.id);runtimes.delete(spec.id);return spec.id;}
// Register a certified mystery-kernel case (full records). Saves carry the records, so it survives reload.
export function registerKernelCase(records){const {identity,entry,id}=kernelEntry(records);definitions.set(id,entry.definition);definitionIdentities.set(id,identity);runtimes.delete(id);return id;}
export const CASE_OPTIONS=[{id:CASE.id,title:CASE.title+' — original'},...CONFIGS.map(({id,title})=>({id,title}))];
export function createSession(seed=17,caseId=CASE.id){const runtime=runtimeFor(caseId),session=runtime.createSession(seed);sessionRuntimes.set(session,runtime);return session;}
// A save is validated (format, version, full replay) before its embedded case is adopted or cached: a rejected save
// leaves no definition and no cache entry behind.
export function importSession(text){
  if(typeof text!=='string'||text.length>20000000)throw Error('Save file is too large.');
  const raw=JSON.parse(text),id=raw?.world?.caseId;
  if(typeof id==='string'&&id.startsWith('mk-')&&raw.world.caseRecords){
    const {identity,entry}=kernelEntry(raw.world.caseRecords,id,{admit:false}),runtime=runtimeForKernel(entry);
    const session=runtime.importSession(text);   // throws for a rejected save, before anything is cached
    touchKernel(identity,entry);adoptDefinition(id,identity,entry);sessionRuntimes.set(session,runtime);return session;
  }
  const runtime=runtimeFor(raw),session=runtime.importSession(text);sessionRuntimes.set(session,runtime);return session;
}
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

export {inSentence} from './places.mjs';
