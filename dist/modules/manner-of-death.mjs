// Manner-of-death brick: the culprit stages the scene to look like an accident, so the death first
// reads as non-criminal. Before the normal accusation is accepted, the player must establish that it
// was murder — via Dr Marsh's finding that the injury is inconsistent with a fall. It is always
// ultimately a murder: staging is a disguise, never a real accident with no culprit. This brick is
// the first structural-variety axis and rides the declarative forensic model (a `manner` dimension +
// the `manner_evidence` predicate); the gate itself lives in assessAccusation.
export const mannerOfDeath={
  id:'manner-of-death',
  bind(spec){return spec.manner==='accident'?{apparent:'accident'}:null;},

  content({CLUES,OBJECTS,LOCATIONS,set,CASE,evidenceClaims}){
    set('coroner','Dr Marsh’s finding on the death',
      `The wound’s depth and angle are inconsistent with a fall on the study steps. Whatever the scene was arranged to suggest, this injury was deliberately inflicted — Edmund was killed.`,
      ['Manner of death'],{kind:'Observation'});
    OBJECTS.coroner={label:'Dr Marsh’s manner finding',clue:'coroner',description:'Read the coroner’s conclusion on the death'};
    if(!LOCATIONS.surgery.objects.includes('coroner'))LOCATIONS.surgery.objects.push('coroner');
    // The finding pins the death to murder. It is load-bearing: added to every declared route, so
    // no accusation is accepted until the crime itself is established.
    evidenceClaims.coroner=[{predicate:'manner_evidence',value:'murder'}];
    for(const route of CASE.proofRoutes)if(!route.all.includes('coroner'))route.all.push('coroner');
    CASE.synopsis=`Edmund Vale was found at the foot of the study steps — at first glance, a fall. ${CASE.synopsis}`;
  },

  prehistory({spec,K,s,record,origin}){
    // A real additional act in the crime sequence: after the fatal blow the culprit arranges the
    // scene. Dr Marsh's later examination yields the finding that contradicts the staged accident.
    const fatal=s.events.find(e=>e.data.occurrence==='fatal_action');
    const exam=s.events.find(e=>e.data.occurrence==='examination');
    const staged=record(spec.culprit,`${K.model.PEOPLE[spec.culprit].name} arranges the study to look like a fall`,
      {'flags.apparentManner':'accident'},{occurrence:'stage_scene',apparent:'accident',location:'manor'},fatal?[fatal.id]:[]);
    const finding=record('iris','Dr Marsh finds the injury inconsistent with a fall',
      {},{occurrence:'manner_finding',manner:'murder',apparent:'accident'},[exam?.id,staged.id].filter(Boolean));
    origin('coroner',finding);
  },

  dialogue({id,topic,clue}){
    // Dr Marsh owns the manner finding, whether asked about the death or shown her own conclusion.
    if(id==='iris'&&(topic==='night'||topic==='sightings'||(topic==='present'&&clue==='coroner')))
      return 'I examined Edmund myself. The scene was made to look like a fall, but the wound tells another story — the angle and depth are wrong for it. This was no accident.';
    return null;
  },

  // Coherence: the coroner finding must be load-bearing — present on every declared proof route, so
  // establishing murder gates the whole case (removing it re-opens the apparent accident).
  invariant({runtime}){
    const routes=runtime.CASE.proofRoutes;
    const ok=routes.length>0&&routes.every(r=>r.all.includes('coroner'));
    return {ok,detail:ok?'coroner finding gates every proof route (murder must be established first)':'coroner finding is not required on every proof route'};
  }
};
