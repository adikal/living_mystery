// Executable authored prehistory. Each record is sourced to a checked occurrence,
// not a substituted paragraph. Times are day-one minutes; play begins day two.
import {recordPlan,executePlanStep} from './world-director.mjs';
import {structurePrehistory} from './cases/investigative-structures.mjs';
import {activeModules} from './modules/index.mjs';
export function executePrehistory(K,s,spec){
 const {culprit,minute,weapon,weaponName,motiveText}=spec,origins={},sources={};
 const origin=(key,event)=>{origins[key]=event;};
 const at=t=>{if(t<s.world.minute)throw Error('Prehistory time reversal');K.advance(s,t-s.world.minute,s.events[0]?.id);};
 const record=(actor,title,changes={},data={},parents=[])=>K.commit(s,{kind:'action',actor,title,location:data.location??s.world.npcs[actor]?.location??'manor',changes,data:{prehistory:true,...data},parents});
 const arrive=(actor,to)=>{
  const plan={actor,label:`Travel to ${to}`,sources:[],steps:[{kind:'move',to}]};
  const {audit,event}=recordPlan(K,s,plan,s.events[0]?.id);if(audit.status!=='allow')throw Error(audit.reason);
  executePlanStep(K,s,plan,event);return event;
 };
 const setup=record('world','Edmund prepares the documents for the evening meeting',{}, {occurrence:'estate_document',author:'Edmund Vale',location:'manor',motive:spec.motive,subject:culprit});
 origin('ledger',setup);origin('folio',setup);origin('appointment',setup);
 at(minute-45);
 const innocents=['clara','rowan','silas'].filter(id=>id!==culprit);
 for(const id of [...innocents,'iris'])arrive(id,'greenhouse');
 if(spec.structure==='cleanup')arrive('bell','manor');
 if(spec.structure==='clockwork'){
  arrive('bell','inn');at(minute-35);
  record('bell','Bell sets his pocket watch by the inn clock',{}, {occurrence:'watch_sync',offset:12,location:'inn'});
  arrive('bell','manor');
 }
 at(minute-25);
 for(const id of [...innocents,'iris'])if(s.world.npcs[id].location!=='greenhouse'||s.world.npcs[id].travel)throw Error('Unreachable alibi meeting');
 const meeting=record('iris','Dr Marsh begins a witnessed appointment at the greenhouse',{}, {people:innocents,start:s.world.minute});
 for(const id of innocents)sources[id]=meeting;
 const take={actor:culprit,label:'Collect the meeting object',sources:[setup],steps:[{kind:'take',object:'weapon',from:s.world.npcs[culprit].location}]};
 const admission=recordPlan(K,s,take,setup);if(admission.audit.status!=='allow')throw Error(admission.audit.reason);
 executePlanStep(K,s,take,admission.event,{take:()=>record(culprit,`${K.model.PEOPLE[culprit].name} takes the ${weaponName}`,{'objects.weapon':culprit},{object:'weapon'})});
 arrive(culprit,'manor');
 at(minute-5);
 if(s.world.npcs[culprit].location!=='manor'||s.world.npcs[culprit].travel)throw Error('Suspect cannot reach meeting');
 const signature=record(culprit,'The visitor signs the timed delivery receipt',{}, {person:culprit,location:'manor',signedAt:s.world.minute});origin('delivery',signature);
 record(culprit,'The visitor examines the carbon copy in the study',{}, {occurrence:'document_observation',location:'manor'},[setup]);
 if(['cleanup','clockwork'].includes(spec.structure))record('bell','Bell begins watching every entrance to the study',{}, {occurrence:'watch_start',subject:culprit,start:minute-5});
 at(minute);
 if(s.world.objects.weapon!==culprit||s.world.npcs[culprit].location!==s.world.flags.victimLocation||!s.world.flags.victimAlive)throw Error('Invalid fatal action');
 const strike=record(culprit,`${K.model.PEOPLE[culprit].name} fatally strikes Edmund`,{'flags.victimAlive':false,'flags.deathMinute':minute,'flags.weaponDamaged':true},{occurrence:'fatal_action',deathMinute:minute,weaponName,weapon,method:weapon,motive:spec.motive,motiveText},[setup,signature]);
 origin('fragment',strike);origin('seal',strike);sources[culprit]=strike;
 structurePrehistory({K,s,spec,record,origin,strike});
 at(minute+5);
 for(const id of innocents)if(s.world.npcs[id].location!=='greenhouse'||s.world.npcs[id].travel)throw Error('Alibi witness moved');
 const visit=record('iris','Dr Marsh closes the witnessed visit record',{}, {occurrence:'appointment_observation',people:innocents,start:minute-25,end:minute+5},[meeting]);origin('record',visit);origin('pump',visit);origin('letter',setup);
 for(const id of innocents)sources[id]=K.commit(s,{kind:'observation',actor:id,title:`${K.model.PEOPLE[id].name} witnesses the complete greenhouse appointment`,parents:[visit],data:{occurrence:'appointment_observation',prehistory:true,observedLocation:'greenhouse',observedAction:'attend appointment',start:minute-25,end:minute+5,people:innocents}});
 if(['cleanup','clockwork'].includes(spec.structure)){
  const gate=record('bell','Bell closes his continuous entrance watch',{}, {occurrence:'entrance_watch',subject:culprit,start:minute-4,end:minute+4,allEntrances:true},[signature,strike]);origin('gate',gate);
  if(spec.structure==='clockwork'){const watch=record('bell','Bell records his guarded interval using his pocket watch set by the inn clock',{}, {occurrence:'clock_watch',subject:culprit,start:minute+8,end:minute+16,offset:12},[gate,s.events.find(e=>e.data.occurrence==='watch_sync').id]);origin('watch',watch);}
  arrive('bell','square');
 }
 arrive(culprit,K.model.PEOPLE[culprit].home);
 at(minute+20);
 if(s.world.npcs[culprit].travel)throw Error('Return journey incomplete');
 record(culprit,'The damaged object is returned to its original room',{'objects.weapon':K.model.PEOPLE[culprit].home},{object:'weapon'},[strike]);
 arrive('iris','manor');at(minute+30);
 if(s.world.npcs.iris.location!=='manor')throw Error('Doctor cannot examine victim');
 const exam=record('iris','Dr Marsh examines the body and records the fatal injury',{}, {occurrence:'examination',people:innocents,deathMinute:minute,method:weapon,injury:spec.injury},[strike,visit]);origin('medical',exam);sources.iris=exam;
 // Reporting is delivered at a real meeting, not by remote belief mutation.
 arrive('iris','square');at(minute+40);
 const delivered=K.commit(s,{kind:'speech',actor:'iris',title:'Dr Marsh delivers the report in the square',data:{occurrence:'report',prehistory:true,listener:'bell',assertion:'Edmund Vale was found dead in the study.'},parents:[exam]});
 if(s.world.npcs.iris.location!==s.world.npcs.bell.location)throw Error('Report has no recipient');sources.bell=delivered;
 const clock=record('ada','Ada records the inn clock offset',{}, {occurrence:'clock_check',offset:12});origin('clock',clock);sources.ada=clock;
 if(spec.structure==='cleanup'){
  const lab=record('iris','Dr Marsh compares recovered cleaning residue',{}, {occurrence:'laboratory',method:weapon},[origins.cloth,exam]);origin('laboratory',lab);
 }
 for(const [id,p]of Object.entries(K.model.PEOPLE))arrive(id,p.home);
 at(1920);
 // Composed narrative bricks contribute their own sourced prehistory (events,
 // beliefs, capabilities) before the origins map is sealed.
 const mods=activeModules(spec);
 for(const {module,binding,roles} of mods)module.prehistory?.({binding,roles,spec,K,s,record,origin,peers:mods});
 K.commit(s,{kind:'history',title:'Prehistory complete; investigation opens',parents:[strike,visit,exam,delivered],changes:{'flags.evidenceOrigins':origins},data:{prehistory:true,caseId:spec.id,obligations:['Static evidence remains accessible','Bell returns to the square']}});
 return {origins,sources,strike};
}
