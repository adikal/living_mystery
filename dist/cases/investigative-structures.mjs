// Reusable investigative structures bind to the existing cast and physical map.
export function configureStructure({spec,CASE,CLUES,OBJECTS,LOCATIONS,evidenceClaims}){
 const type=spec.structure??'trace',name=spec.culprit;
 const add=(id,title,text,location,claims)=>{
  CLUES[id]={title,text,kind:'Document',source:title,tags:['Investigation']};
  OBJECTS[id]={label:title,clue:id,description:`Examine ${title.toLowerCase()}`};
  LOCATIONS[location].objects.push(id);evidenceClaims[id]=claims;
 };
 const opportunity={subject:name,predicate:'exclusive_opportunity',value:'manor',interval:{start:spec.minute-4,end:spec.minute+4}};
 if(type==='cleanup'){
  add('cloth','The discarded cleaning cloth',`A cloth discarded after the encounter carries blood and metal particles. Its composition must be compared with the laboratory record; a stain alone identifies no weapon.`,'manor',[]);
  add('laboratory','The laboratory comparison',`The particles on the discarded cloth match the ${spec.weaponName}, including its damaged edge. The comparison is meaningful only with the recovered cloth.`,'surgery',[{predicate:'trace_match',value:spec.weapon,requires:'cloth'}]);
  add('gate','The constable’s continuous watch',`The signed watch record identifies ${CASE.culprit==='clara'?'Clara Vale':CASE.culprit==='rowan'?'Rowan Pike':'Silas Voss'} as the only visitor admitted to the study during the fatal window. The watch covered every entrance.`,'square',[opportunity]);
  CASE.proofRoutes.push({id:'cleanup',title:'Reconstruct the cleanup from recovered residue',all:['medical','cloth','laboratory','gate','ledger']});
  CASE.synopsis+=' Someone tried to wipe away the physical trace. A discarded cloth may preserve a second path to the truth.';
 }
 if(type==='clockwork'){
  const person={clara:'Clara Vale',rowan:'Rowan Pike',silas:'Silas Voss'}[name];
  add('watch','The constable’s clocked watch',`Bell identified ${person} as the only person admitted to the study, with every entrance watched. His interval was ${Math.floor((spec.minute+8)/60)}:${String((spec.minute+8)%60).padStart(2,'0')}–${Math.floor((spec.minute+16)/60)}:${String((spec.minute+16)%60).padStart(2,'0')} by the inn clock. Establish that clock’s offset before comparing it with the examination.`,'inn',[{...opportunity,predicate:'clock_opportunity',interval:{start:spec.minute+8,end:spec.minute+16},requires:'clock'}]);
  add('gate','The independently timed watch record',`An independently synchronized watch record places ${person} as the sole study visitor throughout the medical window. Every entrance was watched. This record does not use the inn clock.`,'vestry',[opportunity]);
  CASE.proofRoutes=[{id:'calibrated-witness',title:'Calibrate the constable’s uncertain timing',all:['medical','fragment','seal','watch','clock','ledger']},{id:'independent-register',title:'Bypass the uncertain clock using an independent register',all:['medical','fragment','seal','gate','folio']}];
  // The ordinary receipt records an appointment, not the continuous guarded window.
  // Existing innocent alibis remain useful but are no longer a declared solution route.
  CASE.synopsis+=' One witness used a clock that was running fast. Calibrate that account or seek an independently timed record.';
 }
}
export function structurePrehistory({K,s,spec,record,origin,strike}){
 const type=spec.structure??'trace';
 if(type==='cleanup'){
  // A real additional action in the crime sequence, before the culprit departs.
  const e=record(spec.culprit,'The killer wipes the weapon and discards a cleaning cloth',{'flags.weaponWiped':true,'objects.cloth':'manor'},{occurrence:'cleanup',method:spec.weapon,location:'manor'},[strike]);
  origin('cloth',e);
 }
}
