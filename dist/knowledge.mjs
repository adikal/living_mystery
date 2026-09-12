// Belief revisions are append-only events. A retracted premise invalidates only
// explicitly dependent inferences, never another person's independent testimony.
export function createKnowledge({commit,remember,model}){
  function retireBelief(s,id,key,cause,reason='superseded'){
    const old=s.world.npcs[id].beliefs.find(b=>b.key===key);
    if(!old)return null;
    if(!s.events.some(e=>e.id===cause))throw Error('Retirement requires an existing source event');
    const event=commit(s,{kind:'belief',actor:id,title:`${model.PEOPLE[id].name} retires a belief`,parents:[cause,old.sourceId],data:{retiredBelief:key,previous:old,reason},changes:{[`npcs.${id}.beliefs`]:s.world.npcs[id].beliefs.filter(b=>b.key!==key)}});
    invalidate(s,id,key,event);return event;
  }
  function invalidate(s,id,key,cause){
    for(const belief of [...s.world.npcs[id].beliefs])if(belief.supports?.some(p=>p.key===key))retireBelief(s,id,belief.key,cause,'premise_changed; needs re-derivation');
  }
  function believe(s,id,key,text,confidence,sourceType,sourceId,truth=null,meta={}){
    if(model.validateBelief&&!model.validateBelief(s,id,{key,text,confidence,sourceType,sourceId,truth,meta}))throw Error('Belief is not supported by its source and an admitted inference rule');
    if(!s.events.some(e=>e.id===sourceId))throw Error('Belief requires an existing source event');
    const npc=s.world.npcs[id],old=npc.beliefs.find(b=>b.key===key);
    const supports=(meta.supports??[]).map(key=>{
      const b=npc.beliefs.find(b=>b.key===key);if(!b)throw Error('Inference requires an active premise');
      return {key,sourceId:b.sourceId};
    });
    const dependsOn=(premise,seen=new Set())=>{if(premise===key)return true;if(seen.has(premise))return false;seen.add(premise);return (npc.beliefs.find(b=>b.key===premise)?.supports??[]).some(p=>dependsOn(p.key,seen));};
    if(supports.some(p=>dependsOn(p.key)))throw Error('Cyclic belief support');
    const belief={key,text,confidence,sourceType,sourceId,truth,acquired:s.world.minute,...(supports.length?{supports}:{}),...(meta.speaker?{speaker:meta.speaker}:{})};
    if(old&&['text','confidence','sourceType','sourceId','truth'].every(k=>old[k]===belief[k])&&JSON.stringify(old.supports??[])===JSON.stringify(supports)&&old.speaker===meta.speaker)return null;
    // Revision of the premise retires its downstream conclusions for re-evaluation.
    if(old)invalidate(s,id,key,sourceId);
    for(const prior of meta.supersedes??[])if(prior!==key)retireBelief(s,id,prior,sourceId);
    const event=commit(s,{kind:'belief',title:`${model.PEOPLE[id].name} updates a belief`,actor:id,parents:[sourceId,old?.sourceId,...supports.map(p=>p.sourceId)],data:{belief,...(old?{supersedes:old}:{})},changes:{[`npcs.${id}.beliefs`]:[...npc.beliefs.filter(b=>b.key!==key),belief]}});
    remember(s,id,event);return event;
  }
  function completeIntention(s,id,{key,completedKey,text,sourceId}){
    retireBelief(s,id,key,sourceId,'intention_completed');
    if(!s.world.npcs[id].beliefs.some(b=>b.key===completedKey))believe(s,id,completedKey,text,.99,'observation',sourceId,true);
  }
  return {believe,retireBelief,completeIntention};
}
