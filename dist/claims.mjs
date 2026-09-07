// Claims describe assertions, not canonical truth. No narrative parsing or solver here.
/** @typedef {{key:string,subject:string,predicate:string,value:string|number,interval:{start:number,end:number}|null,confidence:number,attribution:string}} Claim */
export function validateClaim(c){return !!c&&typeof c.key==='string'&&typeof c.subject==='string'&&typeof c.predicate==='string'&&['string','number'].includes(typeof c.value)&&Number.isFinite(c.confidence)&&c.confidence>=0&&c.confidence<=1&&typeof c.attribution==='string'&&(c.interval===null||Number.isInteger(c.interval?.start)&&Number.isInteger(c.interval?.end)&&c.interval.start<=c.interval.end)}
export function relation(a,b){
  if(!validateClaim(a)||!validateClaim(b)||a.subject!==b.subject||a.predicate!==b.predicate)return null;
  if(a.predicate==='death_time'&&a.interval&&b.interval&&Math.max(a.interval.start,b.interval.start)>Math.min(a.interval.end,b.interval.end))return 'conflicts';
  if(a.interval||b.interval){if(!a.interval||!b.interval||Math.max(a.interval.start,b.interval.start)>Math.min(a.interval.end,b.interval.end))return null;}
  if(a.value===b.value)return 'supports';
  return ['location','clock_offset','identity','death_time'].includes(a.predicate)?'conflicts':null;
}
export function claimsAt(session,index=session.events.length-1,evidenceCatalog={}){
  const claims=[];
  for(const e of session.events.slice(0,index+1)){
    // The notebook can only use statements actually made available to the player.
    if(!e.playerText)continue;
    for(const [i,c]of (e.data.claims??(e.kind==='evidence'?evidenceCatalog[e.data.clue]:[])??[]).entries())if(validateClaim(c))claims.push({...structuredClone(c),id:`${e.id}:${i}`,eventId:e.id,minute:e.minute,speaker:c.claimant??e.actor,sourceKind:e.kind,clue:e.data.clue??null});
  }
  const latest=new Map();for(const c of claims)latest.set(`${c.speaker}:${c.key}`,c.id);
  return claims.map(c=>({...c,superseded:latest.get(`${c.speaker}:${c.key}`)!==c.id}));
}
export function claimRelations(claims){
  const links=[];
  for(let i=0;i<claims.length;i++)for(let j=i+1;j<claims.length;j++){
    const a=claims[i],b=claims[j];if(a.eventId===b.eventId||a.superseded||b.superseded)continue;
    const kind=relation(a,b);if(kind)links.push({kind,left:a,right:b});
  }
  return links;
}
