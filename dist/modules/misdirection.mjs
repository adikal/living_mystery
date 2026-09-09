// Misdirection brick: an ambiguous crime-night sighting — a garment, not a face,
// read on the fast inn clock — that superficially implicates an innocent but is
// cleared by the greenhouse record. It is a red herring: never a required clue and
// never a location claim placing the accused innocent at the scene.
export const misdirection={
  id:'misdirection',
  bind(spec){return spec.misdirection?{seen:spec.misdirection.seen,item:spec.misdirection.item}:null;},

  content({binding,spec,CLUES,OBJECTS,LOCATIONS,PEOPLE,set,time}){
    OBJECTS.sighting={label:'Ada’s sighting note',clue:'sighting',description:'Read what the innkeeper saw'};
    if(!LOCATIONS.inn.objects.includes('sighting'))LOCATIONS.inn.objects.push('sighting');
    const h=[...spec.id].reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0,7);
    const opener=['Ada saw','Around dusk, Ada glimpsed','Ada is sure she saw'][h%3];
    set('sighting','A sighting near the manor',
      `${opener} ${PEOPLE[binding.seen].name}’s ${binding.item} heading toward the manor around ${time(spec.minute+12)} by the inn clock. She did not see the wearer’s face, and the inn clock runs twelve minutes fast. Dr Marsh’s visit record should be checked against this.`,
      ['Sighting',PEOPLE[binding.seen].name],{kind:'Observation'});
  },

  prehistory({binding,K,record,origin}){
    const ev=record('ada',`Ada glimpses a familiar ${binding.item} near the manor`,{},{location:'inn',ambiguous:true,item:binding.item,seen:binding.seen});
    origin('sighting',ev);
  },

  dialogue({binding,PEOPLE,id,topic,clue}){
    // Applies whether the player asks about sightings or *presents* the sighting note.
    const aboutSighting=topic==='sightings'||topic==='observations'||(topic==='present'&&clue==='sighting');
    if(!aboutSighting)return null;
    // Ada owns the sighting (it is her own account); the mis-seen innocent rebuts it
    // from their alibi; the alibi witness can speak to it only through her record.
    if(id==='ada')
      return `Yes — that is my account. I saw ${PEOPLE[binding.seen].name}’s ${binding.item} heading toward the manor last night, by our clock, which runs fast. I never saw the wearer’s face, so Dr Marsh’s visit record is what will tell you where ${PEOPLE[binding.seen].name} actually was.`;
    if(id===binding.seen)
      return `I have heard what Ada believes she saw. Whatever ${binding.item} passed near the manor, it was not me — I was at the greenhouse the whole evening, and Dr Marsh’s record shows it.`;
    if(id==='iris')
      return `I record who attended my appointment and when, not what they wore. Whatever Ada believes she saw, ${PEOPLE[binding.seen].name} was at the greenhouse with me throughout.`;
    return null;
  },

  // Coherence: the sighting must implicate an innocent and must never be a required
  // clue (a red herring cannot be load-bearing for the solution).
  invariant({binding,roles,runtime}){
    const required=runtime.CASE.proofRoutes.some(r=>r.all.includes('sighting'));
    const ok=binding.seen!==roles.culprit&&roles.innocents.includes(binding.seen)&&!required;
    return {ok,detail:ok
      ?`sighting implicates innocent ${binding.seen}; not a required clue`
      :`seen=${binding.seen} culprit=${roles.culprit} required=${required}`};
  }
};
