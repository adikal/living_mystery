// Read-only inspector projections. Never feed these omniscient reports into playerView.
import {LOCATIONS,OBJECTS,CLUES,worldAt} from './engine.mjs';

export function perspectiveAt(session,index,person){
  const world=worldAt(session,index),seen={};
  if(!world.npcs[person])throw Error('Unknown perspective');
  for(const event of session.events.slice(0,index+1)){
    if(event.actor!==person||event.kind!=='observation'||!event.data.subject)continue;
    seen[event.data.subject]={location:event.location,minute:event.minute,departed:event.data.phase==='departure',sourceId:event.id};
  }
  return {self:world.npcs[person],seen,beliefs:world.npcs[person].beliefs};
}

export function missedAt(session,index){
  const world=worldAt(session,index),events=session.events.slice(0,index+1);
  const has=clue=>world.player.evidence.some(e=>e.clue===clue);
  const clues=[];
  for(const [location,place] of Object.entries(LOCATIONS)){
    if(!world.player.visited.includes(location))continue;
    for(const object of place.objects){
      const clue=OBJECTS[object].clue;
      if(has(clue))continue;
      if(object==='folio'&&world.objects.folio!=='manor')continue;
      if(object==='drawer'&&world.objects.folio!=='drawer')continue;
      clues.push({clue,title:CLUES[clue].title,location,status:world.status==='solved'?'Case closed · review only':'Still discoverable',object});
    }
  }
  const encounters=events.filter(e=>e.kind==='speech'&&e.actor!=='player'&&e.data.listener&&e.data.listener!=='player'&&!e.playerText);
  const followups=[{clue:'clock',person:'ada',label:'Challenge Ada’s reported time with the clock evidence.'},{clue:'letter',person:'clara',label:'Discuss the letter with Clara.'},{clue:'record',person:'rowan',label:'Discuss the visiting record with Rowan.'}].filter(f=>has(f.clue)&&!events.some(e=>e.kind==='speech'&&e.actor==='player'&&e.data.listener===f.person&&e.data.clue===f.clue));
  const moved=has('folio')||world.objects.folio==='manor'?null:{location:world.objects.folio,status:world.status==='solved'?'Case closed · review only':world.objects.folio==='drawer'?'Still discoverable at the vestry':'Currently carried; not inspectable yet'};
  return {clues,encounters,followups,moved};
}
