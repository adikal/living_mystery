// Secret-affair brick (lying ≠ guilt): the two alibied innocents were meeting
// privately — an embarrassment, not a crime. One gives an evasive account; a
// discoverable note explains it. The note is a red herring for motive, never a
// proof-route clue, and the pair remain alibied by the greenhouse record.
import {resolveRoles} from './contract.mjs';

export const secretAffair={
  id:'secret-affair',
  requires:['misdirection'],
  bind(spec){
    const {innocents}=resolveRoles(spec);
    if(innocents.length!==2)return null;
    // Interweave: the evasive innocent is the one Ada mistakenly sighted, so the
    // red herring and the secret reinforce each other, then resolve together.
    const teller=innocents.includes(spec.misdirection?.seen)?spec.misdirection.seen:innocents[0];
    return {pair:innocents,teller};
  },

  content({binding,peers,CLUES,OBJECTS,LOCATIONS,PEOPLE,set}){
    OBJECTS.liaison={label:'A folded private note',clue:'liaison',description:'Read the folded note'};
    if(!LOCATIONS.greenhouse.objects.includes('liaison'))LOCATIONS.greenhouse.objects.push('liaison');
    const mis=peers?.find(p=>p.module.id==='misdirection')?.binding;
    const tie=mis?` It also undercuts the ${mis.item} sighting: ${PEOPLE[binding.teller].name} was at the greenhouse throughout, per Dr Marsh’s record.`:'';
    set('liaison','A private arrangement',
      `A folded note shows ${PEOPLE[binding.pair[0]].name} and ${PEOPLE[binding.pair[1]].name} arranged to meet privately — an embarrassment they would rather keep quiet, not a crime.${tie} Dr Marsh’s record already places them together at the greenhouse.`,
      ['Private']);
  },

  prehistory({binding,K,record,origin}){
    const e=record(binding.teller,'A private note is left at the greenhouse',{},{location:'greenhouse'});
    origin('liaison',e);
  },

  // The teller is evasive about *why* they were at the greenhouse, but does not lie
  // about *being* there — deception is left false so the account stays checkable.
  dialogue({binding,id,topic}){
    if(id===binding.teller&&(topic==='night'||topic==='alibi'))
      return 'I was at the greenhouse the whole time — Dr Marsh can confirm it. I would rather not go into why, and it has nothing to do with Edmund’s death.';
    return null;
  },

  invariant({runtime}){
    const ok=!runtime.CASE.proofRoutes.some(r=>r.all.includes('liaison'));
    return {ok,detail:ok?'the private note is never a required clue':'a benign secret must not be load-bearing'};
  }
};
