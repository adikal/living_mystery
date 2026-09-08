import {exportSession,importSession,PEOPLE,LOCATIONS,SUSPECTS,PILLARS} from './engine.mjs';
import {REALIZATION_VERSION,SYSTEM_PROMPT,CRITIC_PROMPT,checkAnchors,parseCritic} from './llm.mjs';
export const dialogueEntities=[...new Set([...Object.values(PEOPLE).flatMap(p=>p.name.split(/\s+/).filter(n=>n.length>2&&!n.endsWith('.'))),...Object.keys(LOCATIONS),'Edmund','Bellweather'])];
// Board annotations travel with the investigation but never enter engine state.
export function normalizeBoardNotes(session,input){
  const out={},acquired=new Set(session.world.player.evidence.map(e=>e.clue));
  const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
  if(!object(input))return out;
  for(const id of SUSPECTS){
    const entries=Object.hasOwn(input,id)?input[id]:null;
    if(!object(entries))continue;
    for(const clue of acquired){
      const n=Object.hasOwn(entries,clue)?entries[clue]:null;
      if(object(n)&&PILLARS.some(([key])=>key===n.pillar)&&['supports','contradicts'].includes(n.polarity)){
        (out[id]??={})[clue]={pillar:n.pillar,polarity:n.polarity};
      }
    }
  }
  return out;
}
export function exportDialogueSave(session,audit,boardNotes={}){
  const save=JSON.parse(exportSession(session));
  save.reasoning={version:1,notes:normalizeBoardNotes(session,boardNotes)};
  save.dialogue={version:1,records:[...audit.entries()].map(([eventId,record])=>({eventId,...record}))};
  return JSON.stringify(save,null,2);
}
export function importDialogueSave(text){
  const session=importSession(text),save=JSON.parse(text),audit=new Map();
  if(save.dialogue?.version===1&&Array.isArray(save.dialogue.records)){
    const events=new Map(session.events.map(e=>[e.id,e]));
    for(const r of save.dialogue.records.slice(0,50000)){
      const e=events.get(r?.eventId);
      if(!e||e.kind!=='speech'||e.data.listener!=='player'||!e.playerText||r.version!==REALIZATION_VERSION||r.authored!==e.data.assertion)continue;
      if(!['accepted','fallback'].includes(r.status)||typeof r.text!=='string'||r.status==='fallback'&&r.text!==r.authored)continue;
      if(r.response!==null&&(typeof r.response!=='string'||r.response.length>4000))continue;
      if(typeof r.reason!=='string'||r.reason.length>100)continue;
      if(r.request?.system!==SYSTEM_PROMPT||typeof r.request.prompt!=='string'||r.request.prompt.length>20000)continue;
      if(r.status==='accepted'){
        if(typeof r.response!=='string'||r.text!==r.response.trim()||checkAnchors(r.authored,r.text,dialogueEntities))continue;
        if(r.text!==r.authored){
          if(r.critic?.request?.system!==CRITIC_PROMPT||r.critic.request.prompt!==JSON.stringify({authored:r.authored,candidate:r.text})||parseCritic(r.critic.response)?.verdict!=='pass')continue;
        }
      }
      // Keep bounded metadata, never arbitrary imported fields. Model audits are not signed.
      if(r.critic!==null&&(typeof r.critic!=='object'||JSON.stringify(r.critic).length>30000))continue;
      audit.set(e.id,{version:r.version,authored:r.authored,request:{system:SYSTEM_PROMPT,prompt:r.request.prompt,max_tokens:512},response:r.response,critic:r.critic,entities:dialogueEntities,text:r.text,status:r.status,reason:r.reason});
    }
  }
  return {session,audit,boardNotes:save.reasoning?.version===1?normalizeBoardNotes(session,save.reasoning.notes):{},hasBoard:Object.hasOwn(save,'reasoning')};
}
