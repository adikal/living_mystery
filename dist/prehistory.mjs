// Executable authored prehistory. Each record is sourced to a checked occurrence,
// not a substituted paragraph. Times are day-one minutes; play begins day two.
import {recordPlan,executePlanStep} from './world-director.mjs';
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
 const setup=record('world','Edmund prepares the documents for the evening meeting',{}, {author:'Edmund Vale',location:'manor'});
 origin('ledger',setup);origin('folio',setup);origin('appointment',setup);
 at(minute-45);
 const innocents=['clara','rowan','silas'].filter(id=>id!==culprit);
 for(const id of [...innocents,'iris'])arrive(id,'greenhouse');
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
 at(minute);
 if(s.world.objects.weapon!==culprit||s.world.npcs[culprit].location!==s.world.flags.victimLocation||!s.world.flags.victimAlive)throw Error('Invalid fatal action');
 const strike=record(culprit,`${K.model.PEOPLE[culprit].name} fatally strikes Edmund`,{'flags.victimAlive':false,'flags.deathMinute':minute,'flags.weaponDamaged':true},{weapon,method:weapon,motive:spec.motive,motiveText},[setup,signature]);
 origin('fragment',strike);origin('seal',strike);sources[culprit]=strike;
 at(minute+5);
 for(const id of innocents)if(s.world.npcs[id].location!=='greenhouse'||s.world.npcs[id].travel)throw Error('Alibi witness moved');
 const visit=record('iris','Dr Marsh closes the witnessed visit record',{}, {people:innocents,start:minute-25,end:minute+5},[meeting]);origin('record',visit);origin('pump',visit);origin('letter',setup);
 for(const id of innocents)sources[id]=K.commit(s,{kind:'observation',actor:id,title:`${K.model.PEOPLE[id].name} witnesses the complete greenhouse appointment`,parents:[visit],data:{prehistory:true,observedLocation:'greenhouse',observedAction:'attend appointment',start:minute-25,end:minute+5,people:innocents}});
 arrive(culprit,K.model.PEOPLE[culprit].home);
 at(minute+20);
 if(s.world.npcs[culprit].travel)throw Error('Return journey incomplete');
 record(culprit,'The damaged object is returned to its original room',{'objects.weapon':K.model.PEOPLE[culprit].home},{object:'weapon'},[strike]);
 arrive('iris','manor');at(minute+30);
 if(s.world.npcs.iris.location!=='manor')throw Error('Doctor cannot examine victim');
 const exam=record('iris','Dr Marsh examines the body and records the fatal injury',{}, {deathMinute:minute,injury:spec.injury},[strike,visit]);origin('medical',exam);sources.iris=exam;
 // Reporting is delivered at a real meeting, not by remote belief mutation.
 arrive('iris','square');at(minute+40);
 const delivered=K.commit(s,{kind:'speech',actor:'iris',title:'Dr Marsh delivers the report in the square',data:{prehistory:true,listener:'bell',assertion:'Edmund Vale was found dead in the study.'},parents:[exam]});
 if(s.world.npcs.iris.location!==s.world.npcs.bell.location)throw Error('Report has no recipient');sources.bell=delivered;
 const clock=record('ada','Ada records the inn clock offset',{}, {offset:12});origin('clock',clock);sources.ada=clock;
 for(const [id,p]of Object.entries(K.model.PEOPLE))arrive(id,p.home);
 at(1920);
 // Composed narrative bricks contribute their own sourced prehistory (events,
 // beliefs, capabilities) before the origins map is sealed.
 const mods=activeModules(spec);
 for(const {module,binding,roles} of mods)module.prehistory?.({binding,roles,spec,K,s,record,origin,peers:mods});
 K.commit(s,{kind:'history',title:'Prehistory complete; investigation opens',parents:[strike,visit,exam,delivered],changes:{'flags.evidenceOrigins':origins},data:{prehistory:true,caseId:spec.id,obligations:['Static evidence remains accessible','Bell returns to the square']}});
 return {origins,sources,strike};
}
